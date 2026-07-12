import { BrowserWindow, Notification } from "electron";
import { randomUUID } from "node:crypto";
import type { CaptureEvent, CaptureHealth, GamePlatform, MatchDraft, MatchGame, PrivateHubSyncResult, ReplayRecord, ReplayScreenshotFrame } from "../../shared/types.js";
import { CaptureDiagnostics } from "./captureDiagnostics.js";
import { DeckService } from "./deckService.js";
import { DeckTrackerService } from "./deckTrackerService.js";
import { FirebaseSyncService } from "./firebaseSync.js";
import { MatchSessionTracker } from "./matchSessionTracker.js";
import { rawCaptureMatchSummaryFromDraft, type RawCaptureFinishIdentity } from "./rawCaptureService.js";
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

interface PendingAtlasReview {
  timer: ReturnType<typeof setTimeout>;
  endEvent: CaptureEvent;
  settings: Awaited<ReturnType<RiftLiteStore["getSettings"]>> | null;
}

export interface MatchCapturePopupState {
  format: "bo1" | "bo3";
  currentGameNumber: number;
  playerGameWins: number;
  opponentGameWins: number;
  gameResults: Array<"Win" | "Loss" | "Draw" | "Incomplete">;
  lastDetectedGameWinner: "player" | "opponent" | "draw" | "unknown";
  isSideboarding: boolean;
  isMatchComplete: boolean;
}

export interface MatchCapturePopupDecision {
  shouldOpen: boolean;
  reason:
    | "BO1_GAME_COMPLETE"
    | "BO3_IN_PROGRESS_SIDEBOARDING"
    | "BO3_MATCH_NOT_COMPLETE"
    | "BO3_MATCH_COMPLETE";
}

interface AtlasBo3CaptureDecision extends MatchCapturePopupDecision {
  action: "open" | "hold" | "defer";
  debugState: MatchCapturePopupState;
  gameNumber: number;
  games: MatchGame[];
}

type MatchDraftPublicationCallSite =
  | "automatic-match-end"
  | "atlas-final-landing"
  | "force-review"
  | "rollover-before-new-session"
  | "pending-atlas-review"
  | "notification-click";

interface MatchDraftFinalGuardDecision {
  suppressed: boolean;
  reason: string;
  hasAtlasBo3Evidence: boolean;
  debugState: MatchCapturePopupState | null;
}

interface RecentAtlasDraftPublication {
  publishedAtMs: number;
  opponentName: string;
  myChampion: string;
  opponentChampion: string;
  score: string;
  gameCount: number;
}

const CAPTURE_COORDINATOR_GUARD_MARKER = "atlas-bo3-final-guard-v2-2026-06-07";
const REPLAY_FRAME_INTERVAL_MS_BY_PRESET = {
  light: 5_000,
  standard: 4_000,
  detailed: 2_000
} as const;
// Atlas often returns to the landing page between manual BO3 games without a result marker.
// Keep this long enough for sideboarding / next-game setup so those games stay one match.
const ATLAS_CONTINUATION_GRACE_MS = 45_000;
const ATLAS_ROOT_SINGLE_GAME_SETTLE_MS = 8_000;
const MAX_REPLAY_FRAMES = 600;
const REPLAY_SLOW_CAPTURE_MS = 1_100;
const REPLAY_FAST_CAPTURE_MS = 650;
const REPLAY_SLOW_CAPTURE_COOLDOWN_MS = 5_000;
const REPLAY_MAX_CAPTURE_COOLDOWN_MS = 20_000;
const RECENT_CAPTURE_EVENT_TTL_MS = 30_000;
const RECENT_CAPTURE_EVENT_LIMIT = 2_000;
// Atlas can emit a delayed "Match Complete" landing event well after the final BO3 game result.
const RECENT_ATLAS_DRAFT_PUBLICATION_TTL_MS = 120_000;
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

export function shouldOpenMatchCapturePopup(state: MatchCapturePopupState): MatchCapturePopupDecision {
  if (state.format === "bo1") {
    return { shouldOpen: true, reason: "BO1_GAME_COMPLETE" };
  }
  if (state.isSideboarding) {
    return { shouldOpen: false, reason: "BO3_IN_PROGRESS_SIDEBOARDING" };
  }
  if (!state.isMatchComplete) {
    return { shouldOpen: false, reason: "BO3_MATCH_NOT_COMPLETE" };
  }
  return { shouldOpen: true, reason: "BO3_MATCH_COMPLETE" };
}

export class CaptureCoordinator {
  private health: CaptureHealth = { ...DEFAULT_HEALTH };
  private readonly tracker = new MatchSessionTracker();
  private readonly deckService: DeckService;
  private readonly closingPlatforms = new Set<GamePlatform>();
  private readonly timedReplayState = new Map<GamePlatform, TimedReplayState>();
  private readonly recentEventIds = new Map<string, number>();
  private readonly platformEventQueues = new Map<GamePlatform, Promise<void>>();
  private readonly pendingAtlasReviews = new Map<GamePlatform, PendingAtlasReview>();
  private readonly recentAtlasDraftPublications = new Map<GamePlatform, RecentAtlasDraftPublication>();
  private lastHealthEmitAt = 0;
  private lastHealthSignature = "";

  constructor(
    private readonly store: RiftLiteStore,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly tcgaResolver: TcgaResolver,
    private readonly syncService: FirebaseSyncService,
    private readonly diagnostics: CaptureDiagnostics,
    private readonly captureReplayFrame?: ReplayFrameCapture,
    private readonly deckTracker?: DeckTrackerService,
    private readonly finalizeRawCaptureForMatch?: (
      identity: RawCaptureFinishIdentity,
      replay?: ReplayRecord
    ) => Promise<ReplayRecord | null>
  ) {
    this.deckService = new DeckService(store);
  }

  getHealth(): CaptureHealth {
    return { ...this.health };
  }

  recordBuildMarker(appVersion: string): void {
    void this.diagnostics.record({
      id: randomUUID(),
      platform: "atlas",
      kind: "debug",
      capturedAt: new Date().toISOString(),
      url: "",
      payload: {
        reason: "riftlite-build-marker",
        appVersion,
        bo3GuardActive: true,
        captureCoordinatorGuardMarker: CAPTURE_COORDINATOR_GUARD_MARKER
      }
    }).catch(() => undefined);
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
    if (this.shouldIgnoreAtlasNonGameEvent(trackedEvent)) {
      const currentCount = this.health.eventCount + 1;
      void this.diagnostics.record(compactCaptureEvent(trackedEvent)).catch(() => undefined);
      this.health = {
        platform: trackedEvent.platform,
        state: "watching",
        message: "Atlas deck or collection page ignored",
        lastEventAt: trackedEvent.capturedAt,
        eventCount: currentCount
      };
      this.emitHealth(true);
      return;
    }
    await this.resolvePendingAtlasReviewBeforeEvent(trackedEvent, settings);
    void this.diagnostics.record(compactCaptureEvent(trackedEvent)).catch(() => undefined);
    const currentCount = this.health.eventCount + 1;
    if (this.shouldIgnoreFalseTcgaResultEnd(trackedEvent)) {
      this.health = {
        platform: trackedEvent.platform,
        state: "watching",
        message: "TCGA in-game overlay ignored",
        lastEventAt: trackedEvent.capturedAt,
        eventCount: currentCount
      };
      this.emitHealth(true);
      return;
    }
    await this.deckTracker?.ingestCaptureEvent(trackedEvent, settings).catch(() => undefined);
    this.health = {
      platform: event.platform,
      state: event.kind === "match-end" ? "review-needed" : event.kind === "match-start" ? "match-detected" : "watching",
      message: this.messageFor(event),
      lastEventAt: event.capturedAt,
      eventCount: currentCount
    };
    if (event.kind !== "match-end" && this.shouldEmitRendererEvent(trackedEvent)) {
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
    if (
      event.kind !== "match-end" &&
      trackedEvent.platform === "atlas" &&
      this.pendingAtlasReviews.has(trackedEvent.platform) &&
      isAtlasBlankInactiveEnd(trackedEvent) &&
      isAtlasRootLanding(trackedEvent.url)
    ) {
      if (this.shouldFlushPendingAtlasLanding(trackedEvent.platform, trackedEvent)) {
        await this.flushPendingAtlasReview(trackedEvent.platform, "atlas-final-landing", settings);
      } else {
        this.health = {
          ...this.health,
          state: "match-detected",
          message: "Atlas game captured, waiting briefly for a next BO3 game",
          lastEventAt: trackedEvent.capturedAt
        };
        this.emitHealth(true);
      }
      return;
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
      if (this.shouldReleaseAtlasFinalLandingReview(trackedEvent)) {
        const finalEvent = this.withRetainedEndEvidence(trackedEvent, session);
        await this.releaseAtlasFinalLandingReview(finalEvent, settings);
        return;
      }
      if (trackedEvent.platform === "atlas" && this.pendingAtlasReviews.has(trackedEvent.platform) && isAtlasBlankInactiveEnd(trackedEvent)) {
        if (isAtlasRootLanding(trackedEvent.url)) {
          if (this.shouldFlushPendingAtlasLanding(trackedEvent.platform, trackedEvent)) {
            await this.flushPendingAtlasReview(trackedEvent.platform, "atlas-final-landing", settings);
          } else {
            this.health = {
              ...this.health,
              state: "match-detected",
              message: "Atlas game captured, waiting briefly for a next BO3 game",
              lastEventAt: trackedEvent.capturedAt
            };
            this.emitHealth(true);
          }
          return;
        }
        this.health = {
          ...this.health,
          state: "match-detected",
          message: "Atlas transition detected, waiting for the next BO3 game",
          lastEventAt: trackedEvent.capturedAt
        };
        this.emitHealth(true);
        return;
      }
      if (isAtlasSideboardingTransition(trackedEvent)) {
        const finalEvent = this.withRetainedEndEvidence(trackedEvent, session);
        if (this.tracker.shouldWaitForAtlasContinuation(finalEvent.platform, finalEvent)) {
          this.deferAtlasReview(finalEvent, settings);
          this.health = {
            ...this.health,
            state: "match-detected",
            message: "Atlas sideboarding detected, waiting for the next BO3 game"
          };
          this.emitHealth(true);
          return;
        }
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
      const atlasDecision = this.decideAtlasBo3MatchEnd(trackedEvent, finalEvent);
      if (atlasDecision) {
        this.recordMatchCaptureDecision(trackedEvent, atlasDecision);
        if (atlasDecision.action === "hold") {
          this.tracker.holdCurrentGame(finalEvent.platform, finalEvent);
          this.deferAtlasReview(finalEvent, settings);
          this.health = {
            ...this.health,
            state: "match-detected",
            message: atlasDecision.gameNumber
              ? `Atlas BO3 game ${atlasDecision.gameNumber} captured, waiting for next game`
              : "Atlas BO3 game captured, waiting for next game"
          };
          this.emitHealth(true);
          return;
        }
        if (atlasDecision.action === "defer") {
          this.deferAtlasReview(finalEvent, settings);
          this.health = {
            ...this.health,
            state: "match-detected",
            message: "Atlas BO3 transition detected, waiting for the next game"
          };
          this.emitHealth(true);
          return;
        }
      }
      const atlasDecisionOpens = atlasDecision?.action === "open";
      this.closingPlatforms.add(trackedEvent.platform);
      try {
        if (!atlasDecisionOpens && this.tracker.shouldWaitForAtlasContinuation(finalEvent.platform, finalEvent)) {
          this.deferAtlasReview(finalEvent, settings);
          this.health = {
            ...this.health,
            state: "match-detected",
            message: "Atlas game captured, checking briefly for a next BO3 game"
          };
          this.emitHealth(true);
          return;
        }
        if (!atlasDecisionOpens && this.tracker.shouldHoldForBo3(finalEvent.platform, finalEvent)) {
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
        const savedDraft = await this.saveAndPublishDraftForReview(draft, finalEvent, "automatic-match-end");
        if (!savedDraft) {
          if (finalEvent.platform === "atlas") {
            this.deferAtlasReview(finalEvent, settings);
          }
          this.health = {
            ...this.health,
            state: "match-detected",
            message: "Atlas BO3 game captured, popup suppressed until the match is complete"
          };
          this.emitHealth(true);
          return;
        }
        this.emitHealth(true);
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

  private async saveAndPublishDraftForReview(
    draft: MatchDraft,
    event: CaptureEvent,
    callSite: MatchDraftPublicationCallSite,
    options: { emitCaptureEvent?: boolean; notify?: boolean } = {}
  ): Promise<MatchDraft | null> {
    const guard = this.evaluateMatchDraftFinalGuard(draft, event, callSite);
    if (guard.suppressed) {
      this.recordMatchDraftFinalGuard(event, draft, callSite, guard);
      return null;
    }

    const savedDraft = await this.saveDraftForReview(draft, event);
    if (options.emitCaptureEvent !== false && this.shouldEmitRendererEvent(event)) {
      this.emit("capture:event", compactCaptureEvent(event));
    }
    this.recordMatchDraftFinalGuard(event, savedDraft, callSite, guard);
    this.emit("match:draft", savedDraft);
    this.rememberAtlasDraftPublication(savedDraft, event);
    if (options.notify !== false) {
      void this.notifyDraft(savedDraft, event, callSite);
    }
    return savedDraft;
  }

  private evaluateMatchDraftFinalGuard(
    draft: MatchDraft,
    event: CaptureEvent,
    callSite: MatchDraftPublicationCallSite
  ): MatchDraftFinalGuardDecision {
    const isAtlasDraft = event.platform === "atlas" || draft.platform === "atlas";
    if (!isAtlasDraft) {
      return {
        suppressed: false,
        reason: "FINAL_GUARD_NON_ATLAS",
        hasAtlasBo3Evidence: false,
        debugState: null
      };
    }
    if (callSite === "force-review" || readPayloadBoolean(event.payload.forceReview)) {
      return {
        suppressed: false,
        reason: "FINAL_GUARD_MANUAL_FORCE_REVIEW",
        hasAtlasBo3Evidence: true,
        debugState: null
      };
    }

    const trackerGames = this.tracker.previewGames(event.platform);
    const draftGames = draft.games ?? [];
    const games = trackerGames.length >= draftGames.length ? trackerGames : draftGames;
    const gameNumber = atlasConfirmGameNumber(event);
    const isChildGameResult = readPayloadString(event.payload.atlasResultKind) === "game-result" ||
      gameNumber > 0 ||
      isAtlasConfirmWinnerText(event);
    const isSideboarding = !isChildGameResult && isAtlasSideboardPayload(event);
    const resultKind = readPayloadString(event.payload.atlasResultKind);
    const endText = readPayloadString(event.payload.endText);
    const hasAtlasBo3Evidence = hasExplicitAtlasBo3Signal(event, event, games, draft);

    if (this.isDuplicateAtlasTerminalEcho(draft, event)) {
      return {
        suppressed: true,
        reason: "FINAL_GUARD_ATLAS_DUPLICATE_TERMINAL_ECHO",
        hasAtlasBo3Evidence: true,
        debugState: buildMatchCapturePopupState("bo3", games, gameNumber, false)
      };
    }

    if (!hasAtlasBo3Evidence || resultKind === "match-terminal" || /match complete/i.test(endText)) {
      return {
        suppressed: false,
        reason: hasAtlasBo3Evidence ? "FINAL_GUARD_ATLAS_TERMINAL_OR_NO_BO3_HOLD" : "FINAL_GUARD_ATLAS_NO_BO3_EVIDENCE",
        hasAtlasBo3Evidence,
        debugState: null
      };
    }

    if (this.isAtlasFinalLandingReviewRelease(event, games, callSite)) {
      return {
        suppressed: false,
        reason: "FINAL_GUARD_ATLAS_FINAL_LANDING_RELEASE",
        hasAtlasBo3Evidence,
        debugState: buildMatchCapturePopupState("bo3", games, gameNumber, false)
      };
    }

    const debugState = buildMatchCapturePopupState("bo3", games, gameNumber, isSideboarding);
    const popupDecision = shouldOpenMatchCapturePopup(debugState);
    if (!popupDecision.shouldOpen) {
      return {
        suppressed: true,
        reason: `FINAL_GUARD_${popupDecision.reason}`,
        hasAtlasBo3Evidence,
        debugState
      };
    }

    return {
      suppressed: false,
      reason: "FINAL_GUARD_ATLAS_BO3_COMPLETE",
      hasAtlasBo3Evidence,
      debugState
    };
  }

  private rememberAtlasDraftPublication(draft: MatchDraft, event: CaptureEvent): void {
    if (draft.platform !== "atlas" && event.platform !== "atlas") {
      return;
    }
    if (draft.format !== "Bo3") {
      return;
    }
    const gameCount = draft.games?.length ?? 0;
    if (gameCount <= 0) {
      return;
    }
    const publishedAtMs = Date.parse(event.capturedAt);
    this.recentAtlasDraftPublications.set("atlas", {
      publishedAtMs: Number.isFinite(publishedAtMs) ? publishedAtMs : Date.now(),
      opponentName: normalizeCaptureNameKey(draft.opponentName),
      myChampion: normalizeCaptureNameKey(draft.myChampion),
      opponentChampion: normalizeCaptureNameKey(draft.opponentChampion),
      score: draft.score,
      gameCount
    });
  }

  private isDuplicateAtlasTerminalEcho(draft: MatchDraft, event: CaptureEvent): boolean {
    if (event.platform !== "atlas" && draft.platform !== "atlas") {
      return false;
    }
    const resultKind = readPayloadString(event.payload.atlasResultKind);
    const endText = readPayloadString(event.payload.endText);
    if (resultKind !== "match-terminal" && !/match complete/i.test(endText)) {
      return false;
    }
    const recent = this.recentAtlasDraftPublications.get("atlas");
    if (!recent || recent.gameCount < 2) {
      return false;
    }
    const eventAtMs = Date.parse(event.capturedAt);
    const currentAtMs = Number.isFinite(eventAtMs) ? eventAtMs : Date.now();
    if (currentAtMs - recent.publishedAtMs > RECENT_ATLAS_DRAFT_PUBLICATION_TTL_MS) {
      return false;
    }
    const opponentName = normalizeCaptureNameKey(draft.opponentName || readPayloadString(event.payload.opponentName));
    const myChampion = normalizeCaptureNameKey(draft.myChampion || readPayloadString(event.payload.myChampion));
    const opponentChampion = normalizeCaptureNameKey(draft.opponentChampion || readPayloadString(event.payload.opponentChampion));
    const sameOpponent = !recent.opponentName || !opponentName || recent.opponentName === opponentName;
    const sameMyChampion = !recent.myChampion || !myChampion || recent.myChampion === myChampion;
    const sameOpponentChampion = !recent.opponentChampion || !opponentChampion || recent.opponentChampion === opponentChampion;
    return sameOpponent && sameMyChampion && sameOpponentChampion;
  }

  private evaluateAtlasBo3PreDraftFinalGuard(
    event: CaptureEvent,
    callSite: MatchDraftPublicationCallSite
  ): MatchDraftFinalGuardDecision | null {
    if (event.platform !== "atlas") {
      return null;
    }
    if (callSite === "force-review" || readPayloadBoolean(event.payload.forceReview)) {
      return null;
    }
    const gameNumber = atlasConfirmGameNumber(event);
    const resultKind = readPayloadString(event.payload.atlasResultKind);
    const isChildGameResult = resultKind === "game-result" ||
      gameNumber > 0 ||
      isAtlasConfirmWinnerText(event);
    const isSideboarding = !isChildGameResult && isAtlasSideboardPayload(event);
    const endText = readPayloadString(event.payload.endText);
    const games = this.tracker.previewGames(event.platform);
    const hasAtlasBo3Evidence = hasExplicitAtlasBo3Signal(event, event, games);

    if (!hasAtlasBo3Evidence || resultKind === "match-terminal" || /match complete/i.test(endText)) {
      return null;
    }

    const debugState = buildMatchCapturePopupState("bo3", games, gameNumber, isSideboarding);
    const popupDecision = shouldOpenMatchCapturePopup(debugState);
    if (popupDecision.shouldOpen) {
      return null;
    }
    return {
      suppressed: true,
      reason: `FINAL_GUARD_${popupDecision.reason}`,
      hasAtlasBo3Evidence,
      debugState
    };
  }

  private recordMatchDraftFinalGuard(
    event: CaptureEvent,
    draft: MatchDraft | null,
    callSite: MatchDraftPublicationCallSite,
    decision: MatchDraftFinalGuardDecision
  ): void {
    const trackerGames = this.tracker.previewGames(event.platform);
    const payload = event.payload;
    void this.diagnostics.record({
      id: randomUUID(),
      platform: event.platform,
      kind: "debug",
      capturedAt: new Date().toISOString(),
      url: event.url,
      payload: {
        reason: decision.suppressed ? "match-draft-final-guard-suppressed" : "match-draft-final-guard",
        channel: "match:draft",
        callSite,
        guardMarker: CAPTURE_COORDINATOR_GUARD_MARKER,
        guardReason: decision.reason,
        hasAtlasBo3Evidence: decision.hasAtlasBo3Evidence,
        emittedToRenderer: !decision.suppressed,
        draftId: draft?.id ?? "",
        draftFormat: draft?.format ?? "",
        draftScore: draft?.score ?? "",
        draftResult: draft?.result ?? "",
        draftGameCount: draft?.games?.length ?? 0,
        draftGames: (draft?.games ?? []).map((game) => ({
          gameNumber: game.gameNumber,
          result: game.result,
          myPoints: game.myPoints,
          oppPoints: game.oppPoints,
          myBattlefield: game.myBattlefield,
          oppBattlefield: game.oppBattlefield
        })),
        trackerPreviewGames: trackerGames.map((game) => ({
          gameNumber: game.gameNumber,
          result: game.result,
          myPoints: game.myPoints,
          oppPoints: game.oppPoints
        })),
        detectedFormat: decision.debugState?.format ?? draft?.format ?? "",
        currentGameNumber: decision.debugState?.currentGameNumber ?? atlasConfirmGameNumber(event),
        playerGameWins: decision.debugState?.playerGameWins ?? (draft?.games ?? []).filter((game) => game.result === "Win").length,
        opponentGameWins: decision.debugState?.opponentGameWins ?? (draft?.games ?? []).filter((game) => game.result === "Loss").length,
        gameResults: decision.debugState?.gameResults ?? (draft?.games ?? []).map((game) => game.result),
        isSideboarding: decision.debugState?.isSideboarding ?? isAtlasSideboardPayload(event),
        isMatchComplete: decision.debugState?.isMatchComplete ?? false,
        atlasResultKind: readPayloadString(payload.atlasResultKind),
        atlasBo3GameNumber: atlasConfirmGameNumber(event),
        endText: readPayloadString(payload.endText),
        eventReason: readPayloadString(payload.reason),
        rawFormat: readPayloadString(payload.format),
        playerName: readPayloadString(payload.myName),
        opponentName: readPayloadString(payload.opponentName),
        payloadKeys: Object.keys(payload).sort(),
        callStack: new Error().stack?.split("\n").slice(1, 7).map((line) => line.trim()) ?? []
      }
    }).catch(() => undefined);
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
    const rawCaptureIdentity = rawCaptureFinishIdentity(draft, endEvent);
    let replay: ReplayRecord | undefined;
    if (settings?.replayCaptureEnabled !== false) {
      const latest = (await this.store.getMatches()).find((match) => match.id === draft.id);
      if (latest?.keepReplay !== false) {
        replay = await this.store.saveReplay(
          this.createReplay(draft, resolvedReplayEvents, visualFrames, deckTrackerSnapshots)
        ).catch(() => undefined);
      }
    }
    await this.finalizeRawCaptureForMatch?.(rawCaptureIdentity, replay).catch(() => undefined);
  }

  private shouldReleaseAtlasFinalLandingReview(event: CaptureEvent): boolean {
    if (!isAtlasBlankInactiveEnd(event) || !isAtlasRootLanding(event.url)) {
      return false;
    }
    return this.hasMultipleMeaningfulAtlasGames(event);
  }

  private shouldFlushPendingAtlasLanding(platform: GamePlatform, landingEvent: CaptureEvent): boolean {
    if (countMeaningfulReviewGames(this.tracker.previewGames(platform)) >= 2) {
      return true;
    }
    const pending = this.pendingAtlasReviews.get(platform);
    if (!pending) {
      return false;
    }
    const pendingAt = new Date(pending.endEvent.capturedAt).getTime();
    const landingAt = new Date(landingEvent.capturedAt).getTime();
    if (!Number.isFinite(pendingAt) || !Number.isFinite(landingAt)) {
      return false;
    }
    return landingAt - pendingAt >= ATLAS_ROOT_SINGLE_GAME_SETTLE_MS;
  }

  private isAtlasFinalLandingReviewRelease(
    event: CaptureEvent,
    games: MatchGame[],
    callSite: MatchDraftPublicationCallSite
  ): boolean {
    return callSite === "atlas-final-landing";
  }

  private hasMultipleMeaningfulAtlasGames(event: CaptureEvent): boolean {
    if (event.platform !== "atlas") {
      return false;
    }
    return countMeaningfulReviewGames(this.tracker.previewGames(event.platform)) >= 2;
  }

  private async releaseAtlasFinalLandingReview(
    finalEvent: CaptureEvent,
    settingsOverride?: Awaited<ReturnType<RiftLiteStore["getSettings"]>> | null
  ): Promise<void> {
    const platform = finalEvent.platform;
    if (platform !== "atlas" || this.closingPlatforms.has(platform)) {
      return;
    }
    const pending = this.pendingAtlasReviews.get(platform);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingAtlasReviews.delete(platform);
    }

    this.closingPlatforms.add(platform);
    try {
      const replayEvents = this.tracker.getReplayEvents(platform);
      const settings = settingsOverride ?? await this.store.getSettings().catch(() => null);
      const deckTrackerSnapshots = settings?.deckTrackerSaveToReplay === false ? [] : this.deckTracker?.replaySnapshots(platform) ?? [];
      const draft = await this.createDraftFromEvent(finalEvent);
      const savedDraft = await this.saveAndPublishDraftForReview(draft, finalEvent, "atlas-final-landing");
      if (!savedDraft) {
        this.health = {
          ...this.health,
          platform,
          state: "match-detected",
          message: "Atlas final landing found a BO3, but the popup guard kept it pending"
        };
        this.emitHealth(true);
        return;
      }
      this.tracker.clear(platform);
      this.health = {
        ...this.health,
        platform,
        state: "review-needed",
        message: "Atlas match is ready to review",
        lastEventAt: finalEvent.capturedAt
      };
      this.emitHealth(true);
      void this.finalizeReplayForDraft(savedDraft, finalEvent, replayEvents, settings, deckTrackerSnapshots).finally(() => {
        this.deckTracker?.clear(platform);
      }).catch(() => undefined);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.health = {
        ...this.health,
        platform,
        state: "error",
        message: `Atlas final review failed: ${errorMessage}. Force review can retry from retained data.`
      };
      this.emitHealth(true);
      void this.diagnostics.record({
        id: randomUUID(),
        platform,
        kind: "debug",
        capturedAt: new Date().toISOString(),
        url: finalEvent.url,
        payload: {
          reason: "atlas-final-landing-review-error",
          errorMessage
        }
      }).catch(() => undefined);
    } finally {
      this.closingPlatforms.delete(platform);
    }
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
    this.health = {
      ...this.health,
      state: "saved",
      message: "Match saved locally"
    };
    this.emitHealth(true);
    void this.syncService.syncMatch(result, { quiet: true }).catch(() => undefined);
    return result;
  }

  async forceReview(platform: GamePlatform): Promise<MatchDraft | null> {
    await this.platformEventQueues.get(platform)?.catch(() => undefined);
    const targetPlatform = this.tracker.getLatestSessionPlatform(platform);
    if (targetPlatform && targetPlatform !== platform) {
      await this.platformEventQueues.get(targetPlatform)?.catch(() => undefined);
    }
    const activePlatform = targetPlatform ?? platform;
    const pending = this.pendingAtlasReviews.get(activePlatform);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingAtlasReviews.delete(activePlatform);
    }
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
      const savedDraft = await this.saveAndPublishDraftForReview(draft, forcedEnd, "force-review", {
        emitCaptureEvent: false
      });
      if (!savedDraft) {
        return null;
      }
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

  async syncTeams(): Promise<PrivateHubSyncResult> {
    const settings = await this.store.getSettings();
    const activeTeams = (settings.activeTeams ?? []).filter((team) => team.sync);
    const matches = await this.store.getMatches();
    return this.syncMatchesToTeamIds(matches.map((match) => match.id), activeTeams.map((team) => team.id), true);
  }

  async syncMatchesToTeams(matchIds: string[], teamIds: string[]): Promise<PrivateHubSyncResult> {
    return this.syncMatchesToTeamIds(matchIds, teamIds, true);
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
      if (match.mergedIntoMatchId || match.hiddenFromStats || match.hiddenFromHistory) {
        skipped += 1;
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
          hubs,
          teams: match.sync.teams ?? {}
        }
      });
      const result = await this.syncService.syncMatch(prepared, { quiet: true });
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

  private async syncMatchesToTeamIds(matchIds: string[], teamIds: string[], disableCommunity: boolean): Promise<PrivateHubSyncResult> {
    const requestedTeamIds = new Set(teamIds.filter(Boolean));
    const targetTeamIds = Array.from(requestedTeamIds);
    if (!targetTeamIds.length) {
      return {
        matched: 0,
        synced: 0,
        failed: 0,
        skipped: 0,
        message: "Select a team first."
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
      if (match.mergedIntoMatchId || match.hiddenFromStats || match.hiddenFromHistory) {
        skipped += 1;
        continue;
      }
      if (match.status !== "saved" || match.result === "Incomplete") {
        skipped += 1;
        continue;
      }
      const teams = { ...(match.sync.teams ?? {}) };
      let needsSync = false;
      for (const teamId of targetTeamIds) {
        if (teams[teamId] !== "synced") {
          teams[teamId] = "pending";
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
          hubs: match.sync.hubs,
          teams
        }
      });
      const result = await this.syncService.syncMatch(prepared, { forceTeamIds: targetTeamIds, quiet: true });
      const teamStates = targetTeamIds.map((teamId) => result.sync.teams?.[teamId]);
      if (teamStates.some((state) => state === "synced")) {
        synced += 1;
      }
      if (teamStates.some((state) => state === "failed")) {
        failed += 1;
      }
    }

    return {
      matched,
      synced,
      failed,
      skipped,
      message: matched
        ? `Team sync finished: ${synced} synced${failed ? `, ${failed} failed` : ""}.`
        : "No saved local matches needed team sync."
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
      const preGuard = this.evaluateAtlasBo3PreDraftFinalGuard(rolloverEnd, "rollover-before-new-session");
      if (preGuard?.suppressed) {
        this.recordMatchDraftFinalGuard(rolloverEnd, null, "rollover-before-new-session", preGuard);
        this.health = {
          ...this.health,
          platform: event.platform,
          state: "match-detected",
          message: "Atlas BO3 continuation kept active instead of opening a rollover review",
          lastEventAt: capturedAt
        };
        this.emitHealth(true);
        return;
      }
      const draft = await this.createDraftFromEvent(rolloverEnd);
      const savedDraft = await this.saveAndPublishDraftForReview(draft, rolloverEnd, "rollover-before-new-session");
      if (!savedDraft) {
        this.health = {
          ...this.health,
          platform: event.platform,
          state: "match-detected",
          message: "Atlas BO3 continuation kept active instead of opening a rollover review",
          lastEventAt: capturedAt
        };
        this.emitHealth(true);
        return;
      }
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

  private async resolvePendingAtlasReviewBeforeEvent(
    event: CaptureEvent,
    settings: Awaited<ReturnType<RiftLiteStore["getSettings"]>> | null
  ): Promise<void> {
    if (event.platform !== "atlas") {
      return;
    }
    const pending = this.pendingAtlasReviews.get(event.platform);
    if (!pending || !readPayloadBoolean(event.payload.active)) {
      return;
    }
    if (this.isPendingAtlasContinuation(pending.endEvent, event)) {
      clearTimeout(pending.timer);
      this.pendingAtlasReviews.delete(event.platform);
      this.health = {
        ...this.health,
        platform: "atlas",
        state: "match-detected",
        message: "Atlas next BO3 game detected; continuing the same match",
        lastEventAt: event.capturedAt
      };
      this.emitHealth(true);
      return;
    }
    await this.flushPendingAtlasReview(event.platform, "new-atlas-match-started", settings);
  }

  private deferAtlasReview(
    endEvent: CaptureEvent,
    settings: Awaited<ReturnType<RiftLiteStore["getSettings"]>> | null
  ): void {
    const existing = this.pendingAtlasReviews.get(endEvent.platform);
    if (existing) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      void this.flushPendingAtlasReview(endEvent.platform, "atlas-continuation-timeout", settings).catch(() => undefined);
    }, ATLAS_CONTINUATION_GRACE_MS);
    this.pendingAtlasReviews.set(endEvent.platform, {
      timer,
      endEvent,
      settings
    });
  }

  private isPendingAtlasContinuation(pendingEnd: CaptureEvent, nextEvent: CaptureEvent): boolean {
    if (nextEvent.platform !== "atlas" || !readPayloadBoolean(nextEvent.payload.active)) {
      return false;
    }
    const nextScore = readPayloadScoreTotal(nextEvent.payload.score);
    const nextReason = readPayloadString(nextEvent.payload.reason);
    const nextIsFreshGameStart = nextEvent.kind === "match-start" || nextReason === "active-returned" || nextScore <= 2;
    const nextIsBetweenGameScreen = isAtlasBo3QueuePayload(nextEvent) || isAtlasSideboardPayload(nextEvent);
    const previousOpponentRaw = readPayloadString(pendingEnd.payload.opponentName);
    const nextOpponentRaw = readPayloadString(nextEvent.payload.opponentName);
    const previousOpponent = normalizeCaptureNameKey(previousOpponentRaw);
    const nextOpponent = normalizeCaptureNameKey(nextOpponentRaw);
    const previousOpponentNoise = isLikelyAtlasContinuationNameNoise(previousOpponentRaw);
    const nextOpponentNoise = isLikelyAtlasContinuationNameNoise(nextOpponentRaw);
    const sameReliableOpponent = Boolean(
      previousOpponent &&
      nextOpponent &&
      !previousOpponentNoise &&
      !nextOpponentNoise &&
      previousOpponent === nextOpponent
    );
    if (
      previousOpponent &&
      nextOpponent &&
      !previousOpponentNoise &&
      !nextOpponentNoise &&
      previousOpponent !== nextOpponent
    ) {
      return false;
    }
    const previousMyLegend = normalizeCaptureNameKey(readPayloadString(pendingEnd.payload.myChampion));
    const nextMyLegend = normalizeCaptureNameKey(readPayloadString(nextEvent.payload.myChampion));
    if (previousMyLegend && nextMyLegend && previousMyLegend !== nextMyLegend) {
      return false;
    }
    const previousOppLegend = normalizeCaptureNameKey(readPayloadString(pendingEnd.payload.opponentChampion));
    const nextOppLegend = normalizeCaptureNameKey(readPayloadString(nextEvent.payload.opponentChampion));
    if (previousOppLegend && nextOppLegend && previousOppLegend !== nextOppLegend) {
      return false;
    }
    const sameLegendPair = Boolean(
      previousMyLegend &&
      nextMyLegend &&
      previousOppLegend &&
      nextOppLegend &&
      previousMyLegend === nextMyLegend &&
      previousOppLegend === nextOppLegend
    );
    const pendingIsIntermediateGameResult =
      readPayloadString(pendingEnd.payload.atlasResultKind) === "game-result" ||
      isIntermediateAtlasConfirmGameResult(pendingEnd) ||
      isAtlasBo3QueuePayload(pendingEnd) ||
      isAtlasSideboardPayload(pendingEnd);
    const pendingGameNumber = atlasConfirmGameNumber(pendingEnd);
    const pendingCouldContinue = pendingGameNumber === 0 || pendingGameNumber < 3;
    const hasReliableNextIdentity = Boolean(
      (nextOpponent && !nextOpponentNoise) ||
      nextMyLegend ||
      nextOppLegend
    );
    if (pendingIsIntermediateGameResult && pendingCouldContinue && isAtlasGameSurfaceUrl(nextEvent.url)) {
      if (nextIsFreshGameStart || nextIsBetweenGameScreen) {
        return true;
      }
      if (!hasReliableNextIdentity || previousOpponentNoise || nextOpponentNoise || !previousOpponent || !nextOpponent) {
        return true;
      }
    }
    if (nextScore > 2 && !nextIsFreshGameStart && !nextIsBetweenGameScreen) {
      return false;
    }
    return nextIsBetweenGameScreen || sameReliableOpponent || sameLegendPair;
  }

  private async flushPendingAtlasReview(
    platform: GamePlatform,
    reason: string,
    settingsOverride?: Awaited<ReturnType<RiftLiteStore["getSettings"]>> | null
  ): Promise<void> {
    const pending = this.pendingAtlasReviews.get(platform);
    if (!pending || this.closingPlatforms.has(platform)) {
      return;
    }
    clearTimeout(pending.timer);
    const session = this.tracker.get(platform);
    if (!session) {
      this.pendingAtlasReviews.delete(platform);
      return;
    }
    this.closingPlatforms.add(platform);
    try {
      const replayEvents = this.tracker.getReplayEvents(platform);
      const settings = settingsOverride ?? pending.settings ?? await this.store.getSettings().catch(() => null);
      const deckTrackerSnapshots = settings?.deckTrackerSaveToReplay === false ? [] : this.deckTracker?.replaySnapshots(platform) ?? [];
      const finalEvent: CaptureEvent = {
        ...pending.endEvent,
        payload: {
          ...pending.endEvent.payload,
          reason
        }
      };
      const callSite: MatchDraftPublicationCallSite = reason === "atlas-final-landing" ? "atlas-final-landing" : "pending-atlas-review";
      const preGuard = callSite === "atlas-final-landing"
        ? null
        : this.evaluateAtlasBo3PreDraftFinalGuard(finalEvent, callSite);
      if (preGuard?.suppressed) {
        this.recordMatchDraftFinalGuard(finalEvent, null, "pending-atlas-review", preGuard);
        if (reason !== "atlas-continuation-timeout") {
          this.deferAtlasReview(finalEvent, settings);
        } else {
          this.pendingAtlasReviews.delete(platform);
        }
        this.health = {
          ...this.health,
          platform,
          state: "match-detected",
          message: "Atlas BO3 child game kept pending; waiting for the match to complete",
          lastEventAt: finalEvent.capturedAt
        };
        this.emitHealth(true);
        return;
      }
      const draft = await this.createDraftFromEvent(finalEvent);
      const savedDraft = await this.saveAndPublishDraftForReview(draft, finalEvent, callSite);
      if (!savedDraft) {
        if (reason !== "atlas-continuation-timeout") {
          this.deferAtlasReview(finalEvent, settings);
        } else {
          this.pendingAtlasReviews.delete(platform);
        }
        this.health = {
          ...this.health,
          platform,
          state: "match-detected",
          message: "Atlas BO3 child game kept pending; waiting for the match to complete",
          lastEventAt: finalEvent.capturedAt
        };
        this.emitHealth(true);
        return;
      }
      this.pendingAtlasReviews.delete(platform);
      this.tracker.clear(platform);
      this.health = {
        ...this.health,
        platform,
        state: "review-needed",
        message: `${label(platform)} match is ready to review`,
        lastEventAt: finalEvent.capturedAt
      };
      this.emitHealth(true);
      await this.finalizeReplayForDraft(savedDraft, finalEvent, replayEvents, settings, deckTrackerSnapshots).finally(() => {
        this.deckTracker?.clear(platform);
      }).catch(() => undefined);
    } finally {
      this.closingPlatforms.delete(platform);
    }
  }

  private decideAtlasBo3MatchEnd(currentEvent: CaptureEvent, retainedEvent: CaptureEvent = currentEvent): AtlasBo3CaptureDecision | null {
    if (currentEvent.platform !== "atlas" || currentEvent.kind !== "match-end") {
      return null;
    }
    const games = this.tracker.previewGames(currentEvent.platform);
    const gameNumber = atlasConfirmGameNumber(currentEvent);
    const resultKind = readPayloadString(currentEvent.payload.atlasResultKind);
    const reason = readPayloadString(currentEvent.payload.reason);
    const isChildGameResult =
      resultKind === "game-result" ||
      gameNumber > 0 ||
      (reason === "result-text-detected" && isAtlasConfirmWinnerText(currentEvent));
    const isSideboarding = !isChildGameResult && isAtlasSideboardPayload(currentEvent);
    const hasBo3Signal = hasExplicitAtlasBo3Signal(currentEvent, retainedEvent, games);
    if (!hasBo3Signal || resultKind === "match-terminal") {
      return null;
    }
    const debugState = buildMatchCapturePopupState("bo3", games, gameNumber, isSideboarding);
    const popupDecision = shouldOpenMatchCapturePopup(debugState);
    let action: AtlasBo3CaptureDecision["action"] = popupDecision.shouldOpen ? "open" : "defer";

    if (isSideboarding) {
      action = "defer";
    } else if (isChildGameResult && gameNumber > 0) {
      action = "hold";
    } else if (isChildGameResult && gameNumber === 0 && countMeaningfulReviewGames(games) < 3) {
      action = "hold";
    } else if (!popupDecision.shouldOpen) {
      action = "defer";
    }

    return {
      ...popupDecision,
      action,
      debugState,
      gameNumber,
      games
    };
  }

  private recordMatchCaptureDecision(event: CaptureEvent, decision: AtlasBo3CaptureDecision): void {
    void this.diagnostics.record({
      id: randomUUID(),
      platform: event.platform,
      kind: "debug",
      capturedAt: new Date().toISOString(),
      url: event.url,
      payload: {
        reason: "capture-popup-decision",
        decision: decision.reason,
        action: decision.action,
        detectedFormat: decision.debugState.format,
        currentGameNumber: decision.debugState.currentGameNumber,
        playerGameWins: decision.debugState.playerGameWins,
        opponentGameWins: decision.debugState.opponentGameWins,
        gameResults: decision.debugState.gameResults,
        lastDetectedGameWinner: decision.debugState.lastDetectedGameWinner,
        isSideboarding: decision.debugState.isSideboarding,
        isMatchComplete: decision.debugState.isMatchComplete,
        atlasResultKind: readPayloadString(event.payload.atlasResultKind),
        atlasBo3GameNumber: decision.gameNumber,
        endText: readPayloadString(event.payload.endText),
        reasonCapturePopupOpened: decision.action === "open" ? decision.reason : "",
        reasonCapturePopupSuppressed: decision.action === "open" ? "" : decision.reason
      }
    }).catch(() => undefined);
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

  private async notifyDraft(
    draft: MatchDraft,
    event: CaptureEvent,
    callSite: MatchDraftPublicationCallSite
  ): Promise<void> {
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
    notification.on("click", () => {
      const guard = this.evaluateMatchDraftFinalGuard(draft, event, "notification-click");
      this.recordMatchDraftFinalGuard(event, draft, "notification-click", guard);
      if (!guard.suppressed) {
        this.emit("match:draft", draft);
      }
    });
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

  private shouldIgnoreAtlasNonGameEvent(event: CaptureEvent): boolean {
    if (event.platform !== "atlas" || !isAtlasNonGameUrl(event.url)) {
      return false;
    }
    const hasExistingSession = Boolean(this.tracker.get(event.platform));
    return event.kind !== "match-end" || !hasExistingSession;
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

  private shouldIgnoreFalseTcgaResultEnd(event: CaptureEvent): boolean {
    if (event.platform !== "tcga" || readPayloadString(event.payload.reason) !== "result-text-detected") {
      return false;
    }
    const endText = readPayloadString(event.payload.endText);
    if (!endText) {
      return false;
    }
    const concreteResult = /\b(you win|you lose|victory|defeat|match complete)\b|wins!/i.test(endText);
    if (concreteResult) {
      return false;
    }
    const shellControls = [
      /you need to enable javascript/i,
      /end your turn/i,
      /pause before drawing/i,
      /disable auto untap/i,
      /toggle eliminated/i,
      /connect with other players/i,
      /manage turn order/i,
      /start a new game/i,
      /cancel all forwards/i,
      /roll a dice/i
    ];
    const controlHits = shellControls.filter((pattern) => pattern.test(endText)).length;
    return controlHits >= 2 || readPayloadBoolean(event.payload.tcgaCardZoneOverlay);
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
        this.resolveDraftBattlefieldName(game.myBattlefield, game.myBattlefieldImage),
        this.resolveDraftBattlefieldName(game.oppBattlefield, game.oppBattlefieldImage)
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

  private async resolveDraftBattlefieldName(existing: unknown, image: unknown): Promise<string> {
    const existingText = readPayloadString(existing);
    if (existingText && !isUnresolvedCardCode(existingText)) {
      return existingText;
    }
    const resolved = await this.tcgaResolver.resolveBattlefield(existingText || image);
    return resolved || (isUnresolvedCardCode(existingText) ? "" : existingText);
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
      deckTrackerSnapshots,
      matchSnapshot: draft
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
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*(?:[-:]\s*)?(?:disconnected|reconnecting|reconnected|connection lost|offline)\s*\d*\s*s?$/i, "")
    .trim()
    .toLowerCase();
}

function mergeRetainedPayload(
  retained: Record<string, unknown>,
  latest: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...retained };
  for (const [key, value] of Object.entries(latest)) {
    if (key === "active" || key === "reason" || key === "forceReview") {
      if (value !== undefined) {
        merged[key] = value;
      }
      continue;
    }
    if (key === "atlasResultKind") {
      if (hasPayloadValue(value)) {
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

function rawCaptureFinishIdentity(draft: MatchDraft, endEvent: CaptureEvent): RawCaptureFinishIdentity {
  const events = [...draft.rawEvidence, endEvent];
  const values = (keys: string[]) => uniqueCaptureIdentityValues(events.flatMap((event) => (
    keys.map((key) => readPayloadString(event.payload[key]))
  )));
  const roomCodes = values(["roomCode", "room_code", "previousRoomCode", "previous_room_code"]);
  const seriesIds = values(["seriesId", "series_id", "matchSeriesId"]);
  const matchIds = values(["matchId", "match_id"]);
  const replayIds = values(["replayId", "replay_id"]);
  const captureSessionIds = values(["captureSessionId", "capture_session_id"]);
  return {
    platform: draft.platform,
    captureSessionId: captureSessionIds.at(-1),
    roomCode: roomCodes.at(-1),
    roomCodes,
    seriesId: seriesIds.at(-1),
    matchId: matchIds.at(-1),
    matchIds,
    replayId: replayIds.at(-1),
    replayIds,
    localMatchId: draft.id,
    localReplayId: `replay-${draft.id}`,
    title: `${draft.myChampion || "Unknown"} vs ${draft.opponentChampion || "Unknown"}`,
    capturedAt: draft.capturedAt,
    completedAt: endEvent.capturedAt,
    match: rawCaptureMatchSummaryFromDraft(draft)
  };
}

function uniqueCaptureIdentityValues(values: string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    if (value) {
      unique.set(value.toLowerCase(), value);
    }
  }
  return Array.from(unique.values());
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
    "previousRoomCode",
    "seriesId",
    "matchId",
    "replayId",
    "captureSessionId",
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

function isIntermediateAtlasConfirmGameResult(event: CaptureEvent): boolean {
  if (event.platform !== "atlas" || event.kind !== "match-end") {
    return false;
  }
  const reason = readPayloadString(event.payload.reason);
  const resultKind = readPayloadString(event.payload.atlasResultKind);
  if (reason !== "result-text-detected" && resultKind !== "game-result") {
    return false;
  }
  const gameNumber = atlasConfirmGameNumber(event);
  if (gameNumber > 0) {
    return gameNumber < 3;
  }
  return resultKind === "game-result" && isAtlasBo3QueuePayload(event);
}

function isAtlasSideboardingTransition(event: CaptureEvent): boolean {
  if (event.platform !== "atlas" || event.kind !== "match-end") {
    return false;
  }
  return isAtlasSideboardPayload(event);
}

function isAtlasBlankInactiveEnd(event: CaptureEvent): boolean {
  if (event.platform !== "atlas" || (event.kind !== "match-end" && event.kind !== "match-snapshot")) {
    return false;
  }
  if (readPayloadBoolean(event.payload.active)) {
    return false;
  }
  const reason = readPayloadString(event.payload.reason);
  if (event.kind === "match-end" && reason !== "inactive-debounce") {
    return false;
  }
  if (readPayloadString(event.payload.atlasResultKind) || readPayloadString(event.payload.endText)) {
    return false;
  }
  return !isAtlasBo3QueuePayload(event) && !isAtlasSideboardPayload(event);
}

function isAtlasRootLanding(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "play.riftatlas.com" && (parsed.pathname === "/" || parsed.pathname === "");
  } catch {
    return /https:\/\/play\.riftatlas\.com\/?$/i.test(url.trim());
  }
}

function isAtlasGameSurfaceUrl(url: string): boolean {
  if (!url) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname === "play.riftatlas.com" && /\/(?:game|play|room|lobby)\b/i.test(parsed.pathname);
  } catch {
    return /play\.riftatlas\.com\/(?:game|play|room|lobby)\b/i.test(url);
  }
}

function isAtlasSideboardPayload(event: CaptureEvent): boolean {
  if (readPayloadBoolean(event.payload.atlasSideboarding)) {
    return true;
  }
  return /sideboard|sideboarding|sideboards are locked|locked in sideboarding|lock in sideboard|waiting for .*lock in sideboard/i.test(atlasBo3QueueText(event));
}

function isLikelyAtlasContinuationNameNoise(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (/^(?:unknown|opponent|riftlite player)$/i.test(trimmed)) {
    return true;
  }
  if (/^\d/.test(trimmed)) {
    return true;
  }
  return /\b(?:best of 3|bo3|sideboard|sideboarding|locked|lock in|choose|chose|select|confirm|report|winner|mulligan|battlefield|score|waiting|ready|deck|game \d|next game)\b/i.test(trimmed);
}

function atlasConfirmGameNumber(event: CaptureEvent): number {
  const direct = readPayloadNumber(event.payload.atlasBo3GameNumber);
  if (direct && direct >= 1 && direct <= 3) {
    return direct;
  }
  const text = atlasBo3QueueText(event);
  const patterns = [
    /(?:confirm|choose|select|report)\s+game\s+([123])\s+winner/i,
    /(?:confirm|choose|select|report)\s+(?:the\s+)?winner\s+(?:for|of)\s+game\s+([123])/i,
    /game\s+([123])\s+(?:winner|of\s+3)/i,
    /game\s+([123]).{0,48}(?:confirm|choose|select|report).{0,24}winner/i,
    /(?:confirm|choose|select|report).{0,24}winner.{0,48}game\s+([123])/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }
  return 0;
}

function hasExplicitAtlasBo3Signal(
  event: CaptureEvent,
  retainedEvent: CaptureEvent = event,
  games: MatchGame[] = [],
  draft?: MatchDraft
): boolean {
  const eventFormat = readPayloadString(event.payload.format).toLowerCase();
  const retainedFormat = readPayloadString(retainedEvent.payload.format).toLowerCase();
  const gameNumber = Math.max(atlasConfirmGameNumber(event), atlasConfirmGameNumber(retainedEvent));
  return draft?.format === "Bo3" ||
    games.length > 1 ||
    gameNumber > 0 ||
    isAtlasBo3QueuePayload(event) ||
    isAtlasBo3QueuePayload(retainedEvent) ||
    isAtlasSideboardPayload(event) ||
    isAtlasSideboardPayload(retainedEvent) ||
    isAtlasConfirmWinnerText(event) ||
    isAtlasConfirmWinnerText(retainedEvent) ||
    eventFormat.includes("bo3") ||
    eventFormat.includes("best of 3") ||
    retainedFormat.includes("bo3") ||
    retainedFormat.includes("best of 3");
}

function isAtlasBo3QueuePayload(event: CaptureEvent): boolean {
  if (readPayloadBoolean(event.payload.atlasBo3Queue)) {
    return true;
  }
  const gameNumber = atlasConfirmGameNumber(event);
  if (gameNumber > 0 && gameNumber < 3) {
    return true;
  }
  const text = atlasBo3QueueText(event);
  const hasBetweenGameText = /sideboarding|lock in sideboard|locked in sideboarding|waiting for .*lock in sideboard|next game|start game|continue/i.test(text);
  if (hasBetweenGameText && /\bgame\s+[23]\b/i.test(text)) {
    return true;
  }
  return /(?:best\s+of\s+3|bo3)/i.test(text) &&
    /sideboarding|lock in sideboard|locked in sideboarding|waiting for .*lock in sideboard|next game|game\s+[12]\s+of\s+3/i.test(text);
}

function atlasBo3QueueText(event: CaptureEvent): string {
  const rows = Array.isArray(event.payload.rows) ? event.payload.rows : [];
  const rowText = rows.map((row) => {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      return readPayloadString((row as Record<string, unknown>).text);
    }
    return readPayloadString(row);
  }).join(" ");
  return [
    readPayloadString(event.payload.endText),
    readPayloadString(event.payload.pageText),
    readPayloadString(event.payload.statusText),
    rowText
  ].join(" ");
}

function isAtlasConfirmWinnerText(event: CaptureEvent): boolean {
  return /(?:confirm|choose|select|report)\s+game\s+\d+\s+winner|(?:confirm|choose|select|report)\s+(?:the\s+)?winner\s+(?:for|of)\s+game\s+\d+|game\s+\d+.{0,48}(?:winner|choose|select|confirm|report)/i.test(atlasBo3QueueText(event));
}

function buildMatchCapturePopupState(
  format: MatchCapturePopupState["format"],
  games: MatchGame[],
  explicitGameNumber: number,
  isSideboarding: boolean
): MatchCapturePopupState {
  const playerGameWins = games.filter((game) => game.result === "Win").length;
  const opponentGameWins = games.filter((game) => game.result === "Loss").length;
  const lastResult = games[games.length - 1]?.result;
  return {
    format,
    currentGameNumber: explicitGameNumber || Math.max(1, games.length || 1),
    playerGameWins,
    opponentGameWins,
    gameResults: games.map((game) => game.result),
    lastDetectedGameWinner: lastResult === "Win"
      ? "player"
      : lastResult === "Loss"
        ? "opponent"
        : lastResult === "Draw"
          ? "draw"
          : "unknown",
    isSideboarding,
    isMatchComplete: playerGameWins >= 2 || opponentGameWins >= 2 || games.length >= 3
  };
}

function countMeaningfulReviewGames(games: MatchGame[]): number {
  return games.filter((game) => {
    const hasScore = (game.myPoints ?? 0) > 0 || (game.oppPoints ?? 0) > 0;
    const hasResult = game.result === "Win" || game.result === "Loss" || game.result === "Draw";
    const hasBattlefield = Boolean(
      game.myBattlefield ||
      game.oppBattlefield ||
      game.myBattlefieldImage ||
      game.oppBattlefieldImage
    );
    return hasScore || hasResult || hasBattlefield;
  }).length;
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

function readPayloadBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function readPayloadScoreTotal(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }
  const score = value as Record<string, unknown>;
  const me = readPayloadNumber(score.me);
  const opp = readPayloadNumber(score.opp ?? score.opponent);
  return (me ?? 0) + (opp ?? 0);
}

function readPayloadNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isAtlasNonGameUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host !== "riftatlas.com" && host !== "www.riftatlas.com") {
      return false;
    }
    return /^\/decks(?:\/|$)/.test(path) ||
      /^\/collection(?:\/|$)/.test(path) ||
      /^\/cards(?:\/|$)/.test(path) ||
      /^\/profile(?:\/|$)/.test(path);
  } catch {
    return false;
  }
}

function isAtlasCancelLobbyText(value: string): boolean {
  return /^cancel\b.*\breturn to lobby$/i.test(value.trim());
}
