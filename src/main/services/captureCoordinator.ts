import { BrowserWindow, Notification } from "electron";
import { randomUUID } from "node:crypto";
import type { CaptureEvent, CaptureHealth, GamePlatform, MatchDraft, PrivateHubSyncResult, ReplayRecord, ReplayScreenshotFrame } from "../../shared/types.js";
import { CaptureDiagnostics } from "./captureDiagnostics.js";
import { DeckService } from "./deckService.js";
import { DeckTrackerService } from "./deckTrackerService.js";
import { FirebaseSyncService } from "./firebaseSync.js";
import { MatchSessionTracker } from "./matchSessionTracker.js";
import { RiftLiteStore } from "./store.js";
import { TcgaResolver } from "./tcgaResolver.js";

const DEFAULT_HEALTH: CaptureHealth = {
  platform: "none",
  state: "idle",
  message: "Waiting for TCGA or Atlas",
  eventCount: 0
};

type ReplayFrameCapture = (platform: GamePlatform, label: string, capturedAt: string, options?: { force?: boolean }) => Promise<ReplayScreenshotFrame | null>;

interface TimedReplayState {
  timer: ReturnType<typeof setInterval> | null;
  frames: ReplayScreenshotFrame[];
  capturing: boolean;
  tick: number;
  nextAllowedAt: number;
  slowCaptureStreak: number;
  lastCaptureDurationMs: number;
  attemptedCaptures: number;
  skippedCaptures: number;
  slowCaptures: number;
  failedCaptures: number;
}

const REPLAY_FRAME_INTERVAL_MS_BY_PRESET = {
  light: 5_000,
  standard: 4_000,
  detailed: 2_000
} as const;
const MAX_REPLAY_FRAMES = 600;
const REPLAY_SLOW_CAPTURE_MS = 1_100;
const REPLAY_FAST_CAPTURE_MS = 650;
const REPLAY_SLOW_CAPTURE_COOLDOWN_MS = 5_000;
const REPLAY_MAX_CAPTURE_COOLDOWN_MS = 20_000;
const RECENT_CAPTURE_EVENT_TTL_MS = 30_000;
const RECENT_CAPTURE_EVENT_LIMIT = 2_000;
const HEALTH_EMIT_MIN_MS = 900;

function replayFrameIntervalMs(settings: Awaited<ReturnType<RiftLiteStore["getSettings"]>> | null): number {
  const preset = settings?.replayFramePreset ?? "standard";
  return REPLAY_FRAME_INTERVAL_MS_BY_PRESET[preset] ?? REPLAY_FRAME_INTERVAL_MS_BY_PRESET.standard;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

export class CaptureCoordinator {
  private health: CaptureHealth = { ...DEFAULT_HEALTH };
  private readonly tracker = new MatchSessionTracker();
  private readonly deckService: DeckService;
  private readonly closingPlatforms = new Set<GamePlatform>();
  private readonly timedReplayState = new Map<GamePlatform, TimedReplayState>();
  private readonly recentEventIds = new Map<string, number>();
  private readonly platformEventQueues = new Map<GamePlatform, Promise<void>>();
  private lastHealthEmitAt = 0;
  private lastHealthSignature = "";

  constructor(
    private readonly store: RiftLiteStore,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly tcgaResolver: TcgaResolver,
    private readonly syncService: FirebaseSyncService,
    private readonly diagnostics: CaptureDiagnostics,
    private readonly captureReplayFrame?: ReplayFrameCapture,
    private readonly deckTracker?: DeckTrackerService
  ) {
    this.deckService = new DeckService(store);
  }

  getHealth(): CaptureHealth {
    return { ...this.health };
  }

  getLiveOverlayMatch(): Record<string, unknown> | null {
    return this.tracker.getLiveOverlayMatch();
  }

  handleEvent(event: CaptureEvent): Promise<void> {
    const previous = this.platformEventQueues.get(event.platform) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.handleEventNow(event));
    this.platformEventQueues.set(event.platform, next);
    return next.finally(() => {
      if (this.platformEventQueues.get(event.platform) === next) {
        this.platformEventQueues.delete(event.platform);
      }
    });
  }

  private async handleEventNow(event: CaptureEvent): Promise<void> {
    if (this.isDuplicateEvent(event)) {
      return;
    }
    const settings = await this.store.getSettings().catch(() => null);
    const trackedEvent = withConfiguredCaptureContext(event, settings?.username ?? "");
    await this.deckTracker?.ingestCaptureEvent(trackedEvent, settings).catch(() => undefined);
    void this.diagnostics.record(compactCaptureEvent(trackedEvent)).catch(() => undefined);
    const currentCount = this.health.eventCount + 1;
    this.health = {
      platform: event.platform,
      state: event.kind === "match-end" ? "review-needed" : event.kind === "match-start" ? "match-detected" : "watching",
      message: this.messageFor(event),
      lastEventAt: event.capturedAt,
      eventCount: currentCount
    };
    if (this.shouldEmitRendererEvent(trackedEvent)) {
      this.emit("capture:event", compactCaptureEvent(trackedEvent));
    }
    if (event.kind !== "match-end") {
      this.emitHealth(event.kind === "match-start");
    }

    await this.finalizeSessionBeforeRollover(trackedEvent, settings);
    const session = this.tracker.ingest(trackedEvent);
    if (session && event.kind !== "capture-ready") {
      this.ensureTimedReplayCapture(trackedEvent.platform, settings);
    }

    if (event.kind === "match-end") {
      if (this.closingPlatforms.has(trackedEvent.platform)) {
        this.health = {
          ...this.health,
          state: "watching",
          message: `${label(event.platform)} duplicate match end ignored`
        };
        this.emitHealth(true);
        return;
      }
      if (!session) {
        this.health = {
          ...this.health,
          state: "watching",
          message: `${label(event.platform)} stale match end ignored`
        };
        this.emitHealth(true);
        return;
      }
      if (this.shouldIgnoreEmptyAtlasEnd(trackedEvent) || this.shouldIgnoreEmptyTcgaEnd(trackedEvent)) {
        this.tracker.clear(trackedEvent.platform);
        await this.stopTimedReplayCapture(trackedEvent.platform, false);
        this.health = {
          ...this.health,
          state: "watching",
          message: `${label(trackedEvent.platform)} lobby or pre-game event ignored`
        };
        this.emitHealth(true);
        return;
      }
      const finalEvent = this.withRetainedEndEvidence(trackedEvent, session);
      this.closingPlatforms.add(trackedEvent.platform);
      try {
        if (this.tracker.shouldHoldForBo3(finalEvent.platform, finalEvent)) {
          this.tracker.holdCurrentGame(finalEvent.platform, finalEvent);
          this.health = {
            ...this.health,
            state: "match-detected",
            message: `${label(event.platform)} BO3 game captured, waiting for next game`
          };
          this.emitHealth(true);
          return;
        }
        const draft = await this.createDraftFromEvent(finalEvent);
        const replayEvents = this.tracker.getReplayEvents(finalEvent.platform);
        const deckTrackerSnapshots = settings?.deckTrackerSaveToReplay === false ? [] : this.deckTracker?.replaySnapshots(finalEvent.platform) ?? [];
        const savedDraft = await this.saveDraftForReview(draft, finalEvent);
        this.emit("match:draft", savedDraft);
        this.emitHealth(true);
        void this.notifyDraft(savedDraft);
        this.tracker.clear(finalEvent.platform);
        void this.finalizeReplayForDraft(savedDraft, finalEvent, replayEvents, settings, deckTrackerSnapshots).finally(() => {
          this.deckTracker?.clear(finalEvent.platform);
        }).catch(() => undefined);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.health = {
          ...this.health,
          state: "error",
          message: `${label(event.platform)} match review failed: ${errorMessage}. Force review can retry from retained data.`
        };
        this.emitHealth(true);
        void this.diagnostics.record({
          id: randomUUID(),
          platform: trackedEvent.platform,
          kind: "debug",
          capturedAt: new Date().toISOString(),
          url: trackedEvent.url,
          payload: {
            reason: "match-end-review-error",
            errorMessage
          }
        }).catch(() => undefined);
      } finally {
        this.closingPlatforms.delete(trackedEvent.platform);
      }
    }
  }

  private async saveDraftForReview(draft: MatchDraft, event: CaptureEvent): Promise<MatchDraft> {
    try {
      return await this.store.saveMatch(draft);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      void this.diagnostics.record({
        id: randomUUID(),
        platform: event.platform,
        kind: "debug",
        capturedAt: new Date().toISOString(),
        url: event.url,
        payload: {
          reason: "match-draft-storage-warning",
          errorMessage
        }
      }).catch(() => undefined);
      this.health = {
        ...this.health,
        platform: event.platform,
        state: "review-needed",
        message: `${label(event.platform)} review opened; local storage will retry when you save.`
      };
      return draft;
    }
  }

  private async finalizeReplayForDraft(
    draft: MatchDraft,
    endEvent: CaptureEvent,
    replayEvents: NonNullable<ReplayRecord["structuredEvents"]>,
    settings: Awaited<ReturnType<RiftLiteStore["getSettings"]>> | null,
    deckTrackerSnapshots: ReplayRecord["deckTrackerSnapshots"] = []
  ): Promise<void> {
    const [resolvedReplayEvents, visualFrames] = await Promise.all([
      this.resolveReplayEventCards(endEvent.platform, replayEvents),
      this.stopTimedReplayCapture(endEvent.platform, true, endEvent.capturedAt)
    ]);
    if (settings?.replayCaptureEnabled === false) {
      return;
    }
    const latest = (await this.store.getMatches()).find((match) => match.id === draft.id);
    if (latest?.keepReplay === false) {
      return;
    }
    await this.store.saveReplay(this.createReplay(draft, resolvedReplayEvents, visualFrames, deckTrackerSnapshots)).catch(() => undefined);
  }

  async confirmMatch(draft: MatchDraft): Promise<MatchDraft> {
    const saved: MatchDraft = {
      ...draft,
      status: "saved",
      updatedAt: new Date().toISOString()
    };
    const result = await this.store.saveMatch(saved);
    if (draft.keepReplay === false) {
      await this.store.deleteReplayByMatch(draft.id).catch(() => undefined);
    }
    const synced = await this.syncService.syncMatch(result);
    this.health = {
      ...this.health,
      state: "saved",
      message: "Match saved locally"
    };
    this.emitHealth(true);
    return synced;
  }

  async forceReview(platform: GamePlatform): Promise<MatchDraft | null> {
    await this.platformEventQueues.get(platform)?.catch(() => undefined);
    const targetPlatform = this.tracker.getLatestSessionPlatform(platform);
    if (targetPlatform && targetPlatform !== platform) {
      await this.platformEventQueues.get(targetPlatform)?.catch(() => undefined);
    }
    const activePlatform = targetPlatform ?? platform;
    const session = this.tracker.get(activePlatform);
    if (!session) {
      this.health = {
        ...this.health,
        platform,
        state: "watching",
        message: `${label(platform)} has no active capture data to review`
      };
      this.emitHealth(true);
      return null;
    }
    if (this.closingPlatforms.has(activePlatform)) {
      return null;
    }

    this.closingPlatforms.add(activePlatform);
    const capturedAt = new Date().toISOString();
    const latestEvidence = session.evidence[session.evidence.length - 1];
    const forcedEnd: CaptureEvent = {
      id: randomUUID(),
      platform: activePlatform,
      kind: "match-end",
      capturedAt,
      url: latestEvidence?.url ?? "",
      payload: {
        ...session.sticky,
        active: false,
        forceReview: true,
        reason: "manual-force-review"
      }
    };

    try {
      const replayEvents = this.tracker.getReplayEvents(activePlatform);
      const settings = await this.store.getSettings().catch(() => null);
      const deckTrackerSnapshots = settings?.deckTrackerSaveToReplay === false ? [] : this.deckTracker?.replaySnapshots(activePlatform) ?? [];
      const draft = await this.createDraftFromEvent(forcedEnd);
      const savedDraft = await this.saveDraftForReview(draft, forcedEnd);
      this.emit("match:draft", savedDraft);
      void this.notifyDraft(savedDraft);
      this.tracker.clear(activePlatform);
      this.health = {
        ...this.health,
        platform: activePlatform,
        state: "review-needed",
        message: `${label(activePlatform)} review opened from retained capture data`,
        lastEventAt: capturedAt
      };
      this.emitHealth(true);
      void this.finalizeReplayForDraft(savedDraft, forcedEnd, replayEvents, settings, deckTrackerSnapshots).finally(() => {
        this.deckTracker?.clear(activePlatform);
      }).catch(() => undefined);
      return savedDraft;
    } finally {
      this.closingPlatforms.delete(activePlatform);
    }
  }

  async syncPrivateHubs(): Promise<PrivateHubSyncResult> {
    const settings = await this.store.getSettings();
    const activeHubs = settings.activeHubs.filter((hub) => hub.sync);
    const matches = await this.store.getMatches();
    return this.syncMatchesToHubIds(matches.map((match) => match.id), activeHubs.map((hub) => hub.id), true);
  }

  async syncMatchesToHubs(matchIds: string[], hubIds: string[]): Promise<PrivateHubSyncResult> {
    return this.syncMatchesToHubIds(matchIds, hubIds, true);
  }

  private async syncMatchesToHubIds(matchIds: string[], hubIds: string[], disableCommunity: boolean): Promise<PrivateHubSyncResult> {
    const settings = await this.store.getSettings();
    const requestedHubIds = new Set(hubIds.filter(Boolean));
    const activeHubs = settings.activeHubs.filter((hub) => hub.sync && requestedHubIds.has(hub.id));
    if (!activeHubs.length) {
      return {
        matched: 0,
        synced: 0,
        failed: 0,
        skipped: 0,
        message: "Join or enable a private hub first."
      };
    }

    const matches = await this.store.getMatches();
    const requestedMatchIds = new Set(matchIds.filter(Boolean));
    let matched = 0;
    let synced = 0;
    let failed = 0;
    let skipped = 0;

    for (const match of matches) {
      if (!requestedMatchIds.has(match.id)) {
        continue;
      }
      if (match.status !== "saved" || match.result === "Incomplete") {
        skipped += 1;
        continue;
      }
      const hubs = { ...match.sync.hubs };
      let needsSync = false;
      for (const hub of activeHubs) {
        if (hubs[hub.id] !== "synced") {
          hubs[hub.id] = "pending";
          needsSync = true;
        }
      }
      if (!needsSync) {
        skipped += 1;
        continue;
      }
      matched += 1;
      const prepared = await this.store.saveMatch({
        ...match,
        sync: {
          community: disableCommunity ? "disabled" : match.sync.community,
          hubs
        }
      });
      const result = await this.syncService.syncMatch(prepared);
      const hubStates = activeHubs.map((hub) => result.sync.hubs[hub.id]);
      if (hubStates.some((state) => state === "synced")) {
        synced += 1;
      }
      if (hubStates.some((state) => state === "failed")) {
        failed += 1;
      }
    }

    return {
      matched,
      synced,
      failed,
      skipped,
      message: matched
        ? `Private hub sync finished: ${synced} synced${failed ? `, ${failed} failed` : ""}.`
        : "No saved local matches needed private hub sync."
    };
  }

  private async finalizeSessionBeforeRollover(
    event: CaptureEvent,
    settings: Awaited<ReturnType<RiftLiteStore["getSettings"]>> | null
  ): Promise<void> {
    if (!this.tracker.shouldFinalizeBeforeNewSession(event) || this.closingPlatforms.has(event.platform)) {
      return;
    }
    const session = this.tracker.get(event.platform);
    if (!session) {
      return;
    }
    const eventTime = new Date(event.capturedAt).getTime();
    const capturedAt = new Date(Number.isFinite(eventTime) ? Math.max(0, eventTime - 1) : Date.now()).toISOString();
    const rolloverEnd: CaptureEvent = {
      id: randomUUID(),
      platform: event.platform,
      kind: "match-end",
      capturedAt,
      url: event.url,
      payload: {
        ...session.sticky,
        active: false,
        reason: "new-match-started-before-review"
      }
    };

    this.closingPlatforms.add(event.platform);
    try {
      const replayEvents = this.tracker.getReplayEvents(event.platform);
      const deckTrackerSnapshots = settings?.deckTrackerSaveToReplay === false ? [] : this.deckTracker?.replaySnapshots(event.platform) ?? [];
      const draft = await this.createDraftFromEvent(rolloverEnd);
      const savedDraft = await this.saveDraftForReview(draft, rolloverEnd);
      this.emit("match:draft", savedDraft);
      void this.notifyDraft(savedDraft);
      this.tracker.clear(event.platform);
      this.health = {
        ...this.health,
        platform: event.platform,
        state: "review-needed",
        message: `${label(event.platform)} previous match was kept for review before a new opponent started`,
        lastEventAt: capturedAt
      };
      this.emitHealth(true);
      await this.finalizeReplayForDraft(savedDraft, rolloverEnd, replayEvents, settings, deckTrackerSnapshots).finally(() => {
        this.deckTracker?.clear(event.platform);
      }).catch(() => undefined);
    } finally {
      this.closingPlatforms.delete(event.platform);
    }
  }

  private async createDraftFromEvent(
    event: CaptureEvent
  ): Promise<MatchDraft> {
    const settings = await this.store.getSettings();
    const snapshot = this.tracker.get(event.platform)?.sticky ?? event.payload;
    const resolved = await this.resolveSnapshot(event.platform, snapshot).catch(() => ({
      myChampion: "",
      opponentChampion: "",
      myBattlefield: "",
      opponentBattlefield: ""
    }));
    const draft = this.tracker.buildDraft(event.platform, event, settings, resolved);
    const resolvedDraft = await this.resolveDraftGameBattlefields(event.platform, draft).catch(() => draft);
    return this.deckService.attachBestDeck(resolvedDraft, snapshot, settings).catch(() => resolvedDraft);
  }

  private withRetainedEndEvidence(
    endEvent: CaptureEvent,
    session: NonNullable<ReturnType<MatchSessionTracker["get"]>>
  ): CaptureEvent {
    return {
      ...endEvent,
      payload: mergeRetainedPayload(session.sticky, endEvent.payload)
    };
  }

  private async notifyDraft(draft: MatchDraft): Promise<void> {
    if (!Notification.isSupported()) {
      return;
    }
    const settings = await this.store.getSettings();
    if (!settings.confirmationEnabled) {
      return;
    }
    const notification = new Notification({
      title: "Match captured",
      body: `${draft.platform === "tcga" ? "TCGA" : "Atlas"} match is ready to review`
    });
    notification.on("click", () => this.emit("match:draft", draft));
    notification.show();
  }

  private shouldIgnoreEmptyAtlasEnd(event: CaptureEvent): boolean {
    if (event.platform !== "atlas") {
      return false;
    }
    const snapshot = this.tracker.get(event.platform)?.sticky ?? event.payload;
    const resultText = readPayloadString(snapshot.endText);
    const resultKind = readPayloadString(snapshot.atlasResultKind);
    const resultEvidence = Boolean(resultKind) && !isAtlasCancelLobbyText(resultText);
    const identityEvidence = [
      snapshot.myName,
      snapshot.opponentName,
      snapshot.myChampion,
      snapshot.opponentChampion,
      snapshot.myChampionImage,
      snapshot.opponentChampionImage,
      snapshot.myBattlefield,
      snapshot.opponentBattlefield,
      snapshot.myBattlefieldImage,
      snapshot.opponentBattlefieldImage
    ].some(hasPayloadValue);
    const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    const gameplayRows = rows.some((row) => {
      const text = row && typeof row === "object" ? readPayloadString((row as Record<string, unknown>).text) : readPayloadString(row);
      return /starting turn|mulligan|played|wins!|reported|combat|attack|block|left the game|opponent.*left/i.test(text) &&
        !/sideboarding|locked in sideboarding|lock in sideboard/i.test(text);
    });
    return !resultEvidence && !identityEvidence && !gameplayRows;
  }

  private shouldIgnoreEmptyTcgaEnd(event: CaptureEvent): boolean {
    if (event.platform !== "tcga" || readPayloadString(event.payload.reason) !== "inactive-debounce") {
      return false;
    }
    const snapshot = this.tracker.get(event.platform)?.sticky ?? event.payload;
    const resultText = readPayloadString(snapshot.endText);
    const identityEvidence = [
      snapshot.opponentName,
      snapshot.myChampion,
      snapshot.opponentChampion,
      snapshot.myChampionImage,
      snapshot.opponentChampionImage,
      snapshot.myBattlefield,
      snapshot.opponentBattlefield,
      snapshot.myBattlefieldImage,
      snapshot.opponentBattlefieldImage
    ].some(hasPayloadValue);
    const pairedCounterEvidence = Array.isArray(snapshot.counterPlayers) &&
      snapshot.counterPlayers.filter((item) => {
        const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
        return hasPayloadValue(record.name) && hasPayloadValue(record.score);
      }).length >= 2;
    return !resultText && !identityEvidence && !pairedCounterEvidence;
  }

  private async resolveSnapshot(platform: GamePlatform, snapshot: Record<string, unknown>): Promise<{
    myChampion: string;
    opponentChampion: string;
    myBattlefield: string;
    opponentBattlefield: string;
  }> {
    if (platform !== "tcga" && platform !== "atlas") {
      return { myChampion: "", opponentChampion: "", myBattlefield: "", opponentBattlefield: "" };
    }
    const [myChampion, opponentChampion, myBattlefield, opponentBattlefield] = await Promise.all([
      this.tcgaResolver.resolveLegend(snapshot.myChampionImage),
      this.tcgaResolver.resolveLegend(snapshot.opponentChampionImage),
      this.tcgaResolver.resolveBattlefield(snapshot.myBattlefieldImage),
      this.tcgaResolver.resolveBattlefield(snapshot.opponentBattlefieldImage)
    ]);
    return { myChampion, opponentChampion, myBattlefield, opponentBattlefield };
  }

  private async resolveDraftGameBattlefields(platform: GamePlatform, draft: MatchDraft): Promise<MatchDraft> {
    if (platform !== "tcga" && platform !== "atlas") {
      return draft;
    }
    const games = await Promise.all(draft.games.map(async (game) => {
      const [myBattlefield, oppBattlefield] = await Promise.all([
        game.myBattlefield ? Promise.resolve(game.myBattlefield) : this.tcgaResolver.resolveBattlefield(game.myBattlefieldImage),
        game.oppBattlefield ? Promise.resolve(game.oppBattlefield) : this.tcgaResolver.resolveBattlefield(game.oppBattlefieldImage)
      ]);
      return {
        ...game,
        myBattlefield: myBattlefield || game.myBattlefield,
        oppBattlefield: oppBattlefield || game.oppBattlefield
      };
    }));
    return {
      ...draft,
      games,
      myBattlefield: draft.myBattlefield || games[0]?.myBattlefield || "",
      opponentBattlefield: draft.opponentBattlefield || games[0]?.oppBattlefield || ""
    };
  }

  private async resolveReplayEventCards(
    platform: GamePlatform,
    events: NonNullable<ReplayRecord["structuredEvents"]>
  ): Promise<NonNullable<ReplayRecord["structuredEvents"]>> {
    if (platform !== "tcga" && platform !== "atlas") {
      return events;
    }
    return Promise.all(events.map(async (event) => {
      const battlefields = event.battlefields?.length
        ? await Promise.all(event.battlefields.map(async (battlefield) => {
          const resolvedName = battlefield.name && !isUnresolvedCardCode(battlefield.name)
            ? battlefield.name
            : await this.tcgaResolver.resolveBattlefield(battlefield.code || battlefield.image);
          return {
            ...battlefield,
            name: resolvedName || (isUnresolvedCardCode(battlefield.name) ? "" : battlefield.name)
          };
        }))
        : undefined;
      if (platform !== "tcga" || (event.type !== "play" && event.type !== "move") || !event.cardName) {
        return battlefields ? { ...event, battlefields } : event;
      }
      const resolved = await this.tcgaResolver.resolveCard(event.cardName);
      if (!resolved) {
        return battlefields ? { ...event, battlefields } : event;
      }
      const verb = event.type === "move" ? "Moved" : "Played";
      const destination = event.destination ? ` to ${event.destination}` : "";
      return {
        ...event,
        ...(battlefields ? { battlefields } : {}),
        cardName: resolved,
        text: `${verb} ${resolved}${destination}.`
      };
    }));
  }

  private ensureTimedReplayCapture(
    platform: GamePlatform,
    settings: Awaited<ReturnType<RiftLiteStore["getSettings"]>> | null
  ): void {
    if (
      (platform !== "atlas" && platform !== "tcga") ||
      !this.captureReplayFrame ||
      settings?.replayCaptureEnabled === false ||
      settings?.replayKeyframesEnabled === false ||
      settings?.replayVideoEnabled === true ||
      this.timedReplayState.has(platform)
    ) {
      return;
    }
    const state: TimedReplayState = {
      timer: null,
      frames: [],
      capturing: false,
      tick: 0,
      nextAllowedAt: 0,
      slowCaptureStreak: 0,
      lastCaptureDurationMs: 0,
      attemptedCaptures: 0,
      skippedCaptures: 0,
      slowCaptures: 0,
      failedCaptures: 0
    };
    this.timedReplayState.set(platform, state);
    const intervalMs = replayFrameIntervalMs(settings);
    state.timer = setInterval(() => {
      void this.captureTimedReplayFrame(platform);
    }, intervalMs);
    this.recordReplayCaptureDiagnostic(platform, {
      reason: "replay-session-start",
      framePreset: settings?.replayFramePreset ?? "standard",
      intervalMs,
      maxFrames: MAX_REPLAY_FRAMES
    });
  }

  private async captureTimedReplayFrame(platform: GamePlatform, label = "", force = false): Promise<void> {
    const state = this.timedReplayState.get(platform);
    if (!state || state.capturing || !this.captureReplayFrame || state.frames.length >= MAX_REPLAY_FRAMES) {
      return;
    }
    const now = Date.now();
    if (!force && state.nextAllowedAt > now) {
      state.skippedCaptures += 1;
      this.recordReplayCaptureDiagnostic(platform, {
        reason: "replay-frame-skipped",
        cooldownMs: state.nextAllowedAt - now,
        frameCount: state.frames.length,
        tick: state.tick,
        slowCaptureStreak: state.slowCaptureStreak,
        skippedCaptures: state.skippedCaptures
      });
      return;
    }
    state.capturing = true;
    const startedAt = Date.now();
    let frameCaptured = false;
    let errorMessage = "";
    try {
      state.tick += 1;
      state.attemptedCaptures += 1;
      const capturedAt = new Date().toISOString();
      const frame = await this.captureReplayFrame(
        platform,
        label || `Replay frame ${state.tick}`,
        capturedAt,
        { force }
      );
      if (frame) {
        state.frames.push(frame);
        frameCaptured = true;
      }
    } catch (error) {
      state.failedCaptures += 1;
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      state.lastCaptureDurationMs = Date.now() - startedAt;
      if (!force) {
        if (state.lastCaptureDurationMs > REPLAY_SLOW_CAPTURE_MS) {
          state.slowCaptureStreak += 1;
          state.slowCaptures += 1;
          state.nextAllowedAt = Date.now() + Math.min(
            REPLAY_MAX_CAPTURE_COOLDOWN_MS,
            REPLAY_SLOW_CAPTURE_COOLDOWN_MS * state.slowCaptureStreak
          );
        } else if (state.lastCaptureDurationMs < REPLAY_FAST_CAPTURE_MS && state.slowCaptureStreak > 0) {
          state.slowCaptureStreak -= 1;
          state.nextAllowedAt = 0;
        }
      }
      this.recordReplayCaptureDiagnostic(platform, {
        reason: "replay-frame-capture",
        captureMs: state.lastCaptureDurationMs,
        frameCaptured,
        frameCount: state.frames.length,
        tick: state.tick,
        force,
        slow: state.lastCaptureDurationMs > REPLAY_SLOW_CAPTURE_MS,
        cooldownMs: Math.max(0, state.nextAllowedAt - Date.now()),
        slowCaptureStreak: state.slowCaptureStreak,
        attemptedCaptures: state.attemptedCaptures,
        slowCaptures: state.slowCaptures,
        failedCaptures: state.failedCaptures,
        errorMessage
      });
      state.capturing = false;
    }
  }

  private async stopTimedReplayCapture(platform: GamePlatform, captureFinal: boolean, capturedAt = new Date().toISOString()): Promise<ReplayScreenshotFrame[]> {
    const state = this.timedReplayState.get(platform);
    if (!state) {
      return [];
    }
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    this.timedReplayState.delete(platform);
    if (captureFinal && this.captureReplayFrame && state.frames.length < MAX_REPLAY_FRAMES) {
      const startedAt = Date.now();
      const finalFrame = await withTimeout(
        this.captureReplayFrame(platform, "Final result", capturedAt, { force: true }),
        2500,
        null
      );
      if (finalFrame) {
        state.frames.push(finalFrame);
      }
      state.lastCaptureDurationMs = Date.now() - startedAt;
    }
    this.recordReplayCaptureDiagnostic(platform, {
      reason: "replay-session-end",
      captureFinal,
      captureMs: state.lastCaptureDurationMs,
      frameCount: state.frames.length,
      maxFrames: MAX_REPLAY_FRAMES,
      attemptedCaptures: state.attemptedCaptures,
      skippedCaptures: state.skippedCaptures,
      slowCaptures: state.slowCaptures,
      failedCaptures: state.failedCaptures,
      slowCaptureStreak: state.slowCaptureStreak
    });
    return [...state.frames];
  }

  private recordReplayCaptureDiagnostic(platform: GamePlatform, payload: Record<string, unknown>): void {
    const capturedAt = new Date().toISOString();
    const event: CaptureEvent = {
      id: `replay-diagnostic-${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      platform,
      kind: "debug",
      capturedAt,
      url: "",
      payload
    };
    void this.diagnostics.record(compactCaptureEvent(event)).catch(() => undefined);
  }

  private emit(channel: string, payload: unknown): void {
    this.getWindow()?.webContents.send(channel, payload);
  }

  private isDuplicateEvent(event: CaptureEvent): boolean {
    const id = event.id?.trim();
    if (!id) {
      return false;
    }
    const now = Date.now();
    const existing = this.recentEventIds.get(id);
    if (existing && now - existing < RECENT_CAPTURE_EVENT_TTL_MS) {
      return true;
    }
    this.recentEventIds.set(id, now);
    if (this.recentEventIds.size > RECENT_CAPTURE_EVENT_LIMIT) {
      const cutoff = now - RECENT_CAPTURE_EVENT_TTL_MS;
      for (const [key, value] of this.recentEventIds) {
        if (value < cutoff || this.recentEventIds.size > RECENT_CAPTURE_EVENT_LIMIT) {
          this.recentEventIds.delete(key);
        }
      }
    }
    return false;
  }

  private shouldEmitRendererEvent(event: CaptureEvent): boolean {
    return event.kind === "match-start" || event.kind === "match-end" || event.kind === "capture-ready";
  }

  private emitHealth(force = false): void {
    const now = Date.now();
    const signature = `${this.health.platform}|${this.health.state}|${this.health.message}`;
    if (!force && signature === this.lastHealthSignature && now - this.lastHealthEmitAt < HEALTH_EMIT_MIN_MS) {
      return;
    }
    if (!force && this.health.state === "watching" && now - this.lastHealthEmitAt < HEALTH_EMIT_MIN_MS) {
      return;
    }
    this.lastHealthSignature = signature;
    this.lastHealthEmitAt = now;
    this.emit("capture:health", this.health);
  }

  private createReplay(
    draft: MatchDraft,
    structuredEvents: ReplayRecord["structuredEvents"] = [],
    visualFrames: ReplayScreenshotFrame[] = [],
    deckTrackerSnapshots: ReplayRecord["deckTrackerSnapshots"] = []
  ): ReplayRecord {
    return {
      id: `replay-${draft.id}`,
      matchId: draft.id,
      platform: draft.platform,
      capturedAt: draft.capturedAt,
      schemaVersion: structuredEvents.length ? 2 : 1,
      title: `${draft.myChampion || "Unknown"} vs ${draft.opponentChampion || "Unknown"}`,
      players: {
        me: draft.myName,
        opponent: draft.opponentName
      },
      events: draft.rawEvidence.slice(-24).map(compactCaptureEvent),
      structuredEvents,
      visualFrames,
      deckTrackerSnapshots
    };
  }

  private messageFor(event: CaptureEvent): string {
    if (event.kind === "capture-ready") {
      return `${label(event.platform)} capture bridge connected`;
    }
    if (event.kind === "match-start") {
      return `${label(event.platform)} match detected`;
    }
    if (event.kind === "match-end") {
      return `${label(event.platform)} match captured, review needed`;
    }
    if (event.kind.startsWith("network")) {
      return `${label(event.platform)} network activity captured`;
    }
    return `${label(event.platform)} watcher active`;
  }
}

function label(platform: GamePlatform): string {
  if (platform === "tcga") {
    return "TCGA";
  }
  if (platform === "sim") {
    return "Riftbound Sim";
  }
  return "Atlas";
}

function withConfiguredCaptureContext(event: CaptureEvent, configuredUsername: string): CaptureEvent {
  const payload: Record<string, unknown> = configuredUsername
    ? { ...event.payload, configuredUsername }
    : { ...event.payload };
  if (event.platform !== "atlas") {
    return { ...event, payload };
  }

  const knownLocal = [
    configuredUsername,
    readPayloadString(payload.myName),
    readPayloadString(payload.localPlayerName)
  ].filter(Boolean);
  const directOpponent = readPayloadString(payload.opponentName);
  if (!isDistinctCaptureName(directOpponent, knownLocal)) {
    const candidate = chooseAtlasOpponentFromCandidates(payload.atlasPlayerCandidates, knownLocal);
    if (candidate) {
      payload.opponentName = candidate;
    }
  }
  if (!readPayloadString(payload.myName) && configuredUsername) {
    payload.myName = configuredUsername;
  }
  return { ...event, payload };
}

function chooseAtlasOpponentFromCandidates(value: unknown, localNames: string[]): string {
  if (!Array.isArray(value)) {
    return "";
  }
  const localKeys = localNames.map(normalizeCaptureNameKey).filter(Boolean);
  const candidates = value
    .map((item) => {
      const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
      const name = readPayloadString(record.name ?? item);
      return {
        name,
        side: readPayloadString(record.side),
        score: typeof record.score === "number" && Number.isFinite(record.score) ? record.score : 0
      };
    })
    .filter((candidate) =>
      isDistinctCaptureName(candidate.name, localNames) &&
      !localKeys.includes(normalizeCaptureNameKey(candidate.name)) &&
      !/^(unknown|player|opponent|riftlite player)$/i.test(candidate.name)
    )
    .sort((a, b) => b.score - a.score);
  return candidates.find((candidate) => candidate.side === "opponent")?.name ?? (candidates.length === 1 ? candidates[0].name : "");
}

function isDistinctCaptureName(candidate: string, localNames: string[]): boolean {
  const key = normalizeCaptureNameKey(candidate);
  return Boolean(key) && !localNames.some((name) => normalizeCaptureNameKey(name) === key);
}

function normalizeCaptureNameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function mergeRetainedPayload(
  retained: Record<string, unknown>,
  latest: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...retained };
  for (const [key, value] of Object.entries(latest)) {
    if (key === "active" || key === "reason" || key === "forceReview" || key === "atlasResultKind") {
      if (value !== undefined) {
        merged[key] = value;
      }
      continue;
    }
    if (key === "score") {
      if (scorePayloadHasValue(value)) {
        merged[key] = value;
      }
      continue;
    }
    if (key === "counterPlayers") {
      if (counterPlayersHaveScores(value)) {
        merged[key] = value;
      }
      continue;
    }
    if (hasPayloadValue(value)) {
      merged[key] = value;
    }
  }
  merged.active = latest.active === false ? false : merged.active;
  return merged;
}

function scorePayloadHasValue(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return hasPayloadValue(value);
  }
  const score = value as Record<string, unknown>;
  return hasPayloadValue(score.me) || hasPayloadValue(score.opp);
}

function counterPlayersHaveScores(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.some((item) => {
    const row = item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {};
    return hasPayloadValue(row.name) && hasPayloadValue(row.score);
  });
}

function compactCaptureEvent(event: CaptureEvent): CaptureEvent {
  return {
    ...event,
    payload: compactPayload(event.payload)
  };
}

function compactPayload(payload: Record<string, unknown> = {}): Record<string, unknown> {
  const keepKeys = [
    "reason",
    "active",
    "format",
    "atlasResultKind",
    "endText",
    "localPlayerName",
    "configuredUsername",
    "myName",
    "opponentName",
    "myChampion",
    "opponentChampion",
    "myChampionImage",
    "opponentChampionImage",
    "myBattlefield",
    "opponentBattlefield",
    "myBattlefieldImage",
    "opponentBattlefieldImage",
    "roomCode",
    "phase",
    "turnText",
    "wentFirst",
    "deckName",
    "deckSourceId",
    "score",
    "scoreSource",
    "captureMs",
    "frameCaptured",
    "frameCount",
    "tick",
    "force",
    "slow",
    "cooldownMs",
    "slowCaptureStreak",
    "attemptedCaptures",
    "skippedCaptures",
    "slowCaptures",
    "failedCaptures",
    "maxFrames",
    "captureFinal",
    "errorMessage",
    "activeView",
    "mode",
    "quality",
    "source",
    "sourceName",
    "codec",
    "recorderMimeType",
    "fileMimeType",
    "requestedWidth",
    "requestedHeight",
    "requestedFps",
    "actualWidth",
    "actualHeight",
    "actualFps",
    "sourceWidth",
    "sourceHeight",
    "sourceFps",
    "bitrateKbps",
    "actualBitrateKbps",
    "chunkMs",
    "hasAudio",
    "resampled",
    "constantFps",
    "message",
    "name",
    "targetAlreadyPrepared"
  ];
  const next: Record<string, unknown> = {};
  for (const key of keepKeys) {
    if (payload[key] !== undefined) {
      next[key] = compactValue(payload[key]);
    }
  }
  next.payloadKeys = Object.keys(payload).sort();
  if (payload.selectorCounts && typeof payload.selectorCounts === "object" && !Array.isArray(payload.selectorCounts)) {
    next.selectorCounts = compactValue(payload.selectorCounts);
  }
  if (Array.isArray(payload.deckTrackerCards)) {
    next.deckTrackerCardCount = payload.deckTrackerCards.length;
    next.deckTrackerCards = payload.deckTrackerCards.slice(0, 8).map(compactValue);
  }
  if (Array.isArray(payload.counterPlayers)) {
    next.counterPlayers = payload.counterPlayers.slice(0, 4).map(compactValue);
  }
  if (Array.isArray(payload.battlefieldCandidates)) {
    next.battlefieldCandidates = payload.battlefieldCandidates.slice(0, 8).map(compactBattlefieldCandidate);
  }
  if (Array.isArray(payload.atlasScoreCandidates)) {
    next.atlasScoreCandidates = payload.atlasScoreCandidates.slice(0, 8).map(compactValue);
  }
  if (Array.isArray(payload.atlasPlayerCandidates)) {
    next.atlasPlayerCandidates = payload.atlasPlayerCandidates.slice(0, 8).map(compactValue);
  }
  if (Array.isArray(payload.rows)) {
    next.rows = payload.rows.slice(-10).map((row) => {
      const record = row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : {};
      return {
        key: truncateValue(record.key, 80),
        text: truncateValue(record.text, 180)
      };
    });
  }
  if (Array.isArray(payload.games)) {
    next.games = payload.games.slice(0, 3).map(compactValue);
  }
  return next;
}

function compactBattlefieldCandidate(value: unknown): Record<string, unknown> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    side: truncateValue(record.side, 20),
    text: truncateValue(record.text, 120),
    code: truncateValue(record.code, 40),
    image: truncateValue(record.image, 260),
    hidden: record.hidden === true,
    capturedAt: truncateValue(record.capturedAt, 40)
  };
}

function compactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return truncateValue(value, 300);
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 12).map(compactValue);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 20)
        .map(([key, nested]) => [key, compactValue(nested)])
    );
  }
  return "";
}

function truncateValue(value: unknown, limit: number): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function isUnresolvedCardCode(value: string): boolean {
  return /^(?:OGN|OGS|SFD|UNL)-\d+[A-Z]?$/i.test(value.trim());
}

function hasPayloadValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return Boolean(value);
}

function readPayloadString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isAtlasCancelLobbyText(value: string): boolean {
  return /^cancel\b.*\breturn to lobby$/i.test(value.trim());
}
