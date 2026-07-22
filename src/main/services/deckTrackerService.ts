import { randomUUID } from "node:crypto";
import {
  buildDeckTrackerState,
  deckTrackerIdentityAliases,
  deckTrackerImageUrlFromId,
  observationCountsForDeck,
  mainDeckTrackerCards,
  sideboardTrackerCards,
  normalizeDeckTrackerKey
} from "../../shared/deckTracker.js";
import {
  parseAtlasDeckTrackerFrame,
  type AtlasDeckTrackerDebugEvent
} from "../../shared/atlasEventDeckTracker.js";
import { legendFromImageUrl } from "../../shared/legendImages.js";
import { canonicalLegendName } from "../../shared/legendNames.js";
import { emptyVisionDeckTrackerStatus } from "../../shared/visionDeckTracker.js";
import type {
  CaptureEvent,
  DeckTrackerConfidence,
  DeckTrackerCorrection,
  DeckTrackerOpponentCardState,
  DeckTrackerObservation,
  DeckTrackerSnapshot,
  DeckTrackerSideboardChange,
  DeckTrackerSideboardDirection,
  DeckTrackerState,
  DeckTrackerZone,
  GamePlatform,
  RawCaptureAppendFramePayload,
  SavedDeck,
  UserSettings,
  VisionDeckTrackerStatus,
  VisionDeckTrackerSuggestion
} from "../../shared/types.js";
import { RiftLiteStore } from "./store.js";
import { TcgaResolver } from "./tcgaResolver.js";

const MAX_TRACKER_SNAPSHOTS = 180;
const DECK_TRACKER_FEATURE_ENABLED = true;

type PlatformTrackerState = {
  observedCounts: Map<string, number>;
  observedConfidence: Map<string, DeckTrackerConfidence>;
  corrections: DeckTrackerCorrection[];
  sideboardChanges: DeckTrackerSideboardChange[];
  sideboardEventIds: Set<string>;
  opponentSeenByInstance: Map<string, DeckTrackerObservation>;
  opponentKnownByInstance: Map<string, DeckTrackerObservation>;
  opponentSeenGameNumber?: number;
  sideboardPhase: string;
  sideboardGameNumber?: number;
  opponentLegend: string;
  snapshots: DeckTrackerSnapshot[];
  lastSignature: string;
  deckId: string;
  sessionKey: string;
  localPlayerId: string;
  eventPackets: number;
  ignoredEvents: number;
  lastFrameType: string;
  lastEventMessage: string;
  debugEvents: AtlasDeckTrackerDebugEvent[];
};

export class DeckTrackerService {
  private readonly stateByPlatform = new Map<GamePlatform, PlatformTrackerState>();
  private readonly lastOpponentLegendByPlatform = new Map<GamePlatform, string>();
  private activePlatform: GamePlatform | "none" = "none";
  private deckCache: { deckId: string; deck: SavedDeck | null } = { deckId: "", deck: null };
  private visionStatus: VisionDeckTrackerStatus = emptyVisionDeckTrackerStatus(false, "none");

  constructor(
    private readonly store: RiftLiteStore,
    private readonly tcgaResolver?: TcgaResolver
  ) {}

  async ingestCaptureEvent(event: CaptureEvent, settings: UserSettings | null): Promise<void> {
    if (!DECK_TRACKER_FEATURE_ENABLED) {
      return;
    }
    if (!settings?.deckTrackerEnabled) {
      return;
    }
    if (!settings.deckTrackerAutoStart) {
      return;
    }
    this.activePlatform = event.platform;
    let platformState = this.platformState(event.platform);
    const eventOpponentLegend = await this.opponentLegendFromCapturePayload(event.payload);
    const eventSessionKey = trackerSessionKeyFromCaptureEvent(event);
    const carryAtlasOpponentMemory = shouldCarryAtlasOpponentMemory(platformState, event, eventSessionKey, eventOpponentLegend);
    const carriedOpponentKnown = carryAtlasOpponentMemory ? new Map(platformState.opponentKnownByInstance) : undefined;
    const carriedOpponentLegend = carryAtlasOpponentMemory
      ? (eventOpponentLegend || platformState.opponentLegend || this.lastOpponentLegendByPlatform.get(event.platform) || "")
      : "";
    const carriedSessionKey = carryAtlasOpponentMemory ? (eventSessionKey || platformState.sessionKey) : "";
    const carriedLocalPlayerId = carryAtlasOpponentMemory ? platformState.localPlayerId : "";
    if (event.kind === "match-start" || platformState.deckId !== settings.activeDeckId) {
      this.resetPlatform(event.platform, settings.activeDeckId);
      platformState = this.platformState(event.platform);
      if (carriedOpponentKnown) {
        platformState.opponentKnownByInstance = carriedOpponentKnown;
        platformState.sessionKey = carriedSessionKey;
        platformState.localPlayerId = carriedLocalPlayerId;
        if (carriedOpponentLegend) {
          this.rememberOpponentLegend(event.platform, platformState, carriedOpponentLegend);
        }
      }
    } else if (eventSessionKey && !platformState.sessionKey) {
      platformState.sessionKey = eventSessionKey;
    }
    if (eventOpponentLegend) {
      this.rememberOpponentLegend(event.platform, platformState, eventOpponentLegend);
    }
    const deck = await this.activeDeck(settings);
    const observations = await this.enrichObservations(coerceObservations(event.payload.deckTrackerCards, event.platform, event.capturedAt));
    if (deck && observations.length) {
      const deckCards = mainDeckTrackerCards(deck);
      const { counts, confidence } = observationCountsForDeck(observations, deckCards);
      for (const [cardKey, count] of counts.entries()) {
        const previous = platformState.observedCounts.get(cardKey) ?? 0;
        platformState.observedCounts.set(cardKey, Math.max(previous, count));
      }
      for (const [cardKey, value] of confidence.entries()) {
        if (value === "estimated" || !platformState.observedConfidence.has(cardKey)) {
          platformState.observedConfidence.set(cardKey, value);
        }
      }
    }
    const state = this.buildState(settings, deck, event.platform, event.capturedAt);
    const signature = this.stateSignature(state);
    if (event.kind === "match-start" || event.kind === "match-end" || signature !== platformState.lastSignature) {
      this.addSnapshot(event.platform, state, event.kind === "match-start" ? "match-start" : event.kind === "match-end" ? "final-result" : "capture-update");
    }
    platformState.lastSignature = signature;
  }

  async getState(platform?: GamePlatform): Promise<DeckTrackerState> {
    const settings = await this.store.getSettings();
    const targetPlatform = platform ?? this.activePlatform;
    const deck = await this.activeDeck(settings);
    if (!DECK_TRACKER_FEATURE_ENABLED) {
      return this.buildState(settings, deck, targetPlatform, new Date().toISOString(), "My Deck Tracker is coming back in a later build.");
    }
    if (!settings.deckTrackerEnabled) {
      return this.buildState(settings, deck, targetPlatform, new Date().toISOString(), "Deck tracker is off in Settings.");
    }
    if (!settings.deckTrackerAutoStart) {
      return this.buildState(settings, deck, targetPlatform, new Date().toISOString(), "Deck tracker auto-start is off.");
    }
    return this.buildState(settings, deck, targetPlatform, new Date().toISOString());
  }

  async ingestAtlasRawFrame(payload: RawCaptureAppendFramePayload): Promise<void> {
    if (!DECK_TRACKER_FEATURE_ENABLED || payload.platform !== "atlas") {
      return;
    }
    const settings = await this.store.getSettings();
    if (!settings.deckTrackerEnabled || !settings.deckTrackerAutoStart) {
      return;
    }
    this.activePlatform = "atlas";
    let platformState = this.platformState("atlas");
    const parsedBeforePlayer = parseAtlasDeckTrackerFrame(payload, { localPlayerId: platformState.localPlayerId });
    const learnedLocalPlayerInFrame = Boolean(parsedBeforePlayer.localPlayerIdHint && !platformState.localPlayerId);
    if (learnedLocalPlayerInFrame) {
      platformState.localPlayerId = parsedBeforePlayer.localPlayerIdHint;
    }
    const sessionKey = parsedBeforePlayer.roomCode || payload.requestUrl || "atlas";
    const carriedOpponentLegend = parsedBeforePlayer.opponentLegend
      || platformState.opponentLegend
      || this.lastOpponentLegendByPlatform.get("atlas")
      || "";
    if (platformState.deckId !== settings.activeDeckId || (platformState.sessionKey && sessionKey && platformState.sessionKey !== sessionKey)) {
      this.resetPlatform("atlas", settings.activeDeckId);
      platformState = this.platformState("atlas");
      platformState.sessionKey = sessionKey;
      if (carriedOpponentLegend) {
        this.rememberOpponentLegend("atlas", platformState, carriedOpponentLegend);
      }
      if (parsedBeforePlayer.localPlayerIdHint) {
        platformState.localPlayerId = parsedBeforePlayer.localPlayerIdHint;
      }
    } else if (!platformState.sessionKey && sessionKey) {
      platformState.sessionKey = sessionKey;
    }

    const parsed = learnedLocalPlayerInFrame
      ? parseAtlasDeckTrackerFrame(payload, { localPlayerId: platformState.localPlayerId })
      : parsedBeforePlayer;
    if (parsed.phase) {
      platformState.sideboardPhase = parsed.phase;
    }
    if (typeof parsed.gameNumber === "number") {
      platformState.sideboardGameNumber = parsed.gameNumber;
      if (platformState.opponentSeenGameNumber !== parsed.gameNumber) {
        platformState.opponentSeenByInstance.clear();
        platformState.opponentSeenGameNumber = parsed.gameNumber;
      }
    }
    if (parsed.opponentLegend) {
      this.rememberOpponentLegend("atlas", platformState, parsed.opponentLegend);
    }
    if (parsed.sideboardChanges.length) {
      this.addSideboardChanges(platformState, parsed.sideboardChanges);
    }
    if (parsed.opponentObservations.length) {
      this.addOpponentSeen(platformState, parsed.opponentObservations);
    }
    platformState.eventPackets += 1;
    platformState.ignoredEvents += parsed.ignoredCount;
    platformState.lastFrameType = parsed.frameType || platformState.lastFrameType;
    platformState.debugEvents = [...platformState.debugEvents, ...parsed.debugEvents].slice(-36);

    const deck = await this.activeDeck(settings);
    if (!deck) {
      this.updateEventStatus("atlas", {
        state: "waiting-for-deck",
        active: false,
        message: "Set an active deck to use the Atlas event deck tracker.",
        processedFrames: platformState.eventPackets,
        skippedFrames: platformState.ignoredEvents,
        confidenceScore: 0
      });
      return;
    }
    if (!platformState.localPlayerId) {
      this.updateEventStatus("atlas", {
        state: "paused",
        active: false,
        message: "Waiting for your Atlas player ID before counting cards.",
        processedFrames: platformState.eventPackets,
        skippedFrames: platformState.ignoredEvents,
        confidenceScore: 0
      });
      return;
    }
    const trackerObservations = parsed.observations.filter((observation) => observation.zone !== "unknown");
    if (trackerObservations.length) {
      const deckCards = mainDeckTrackerCards(deck);
      const { counts, confidence } = observationCountsForDeck(trackerObservations, deckCards);
      for (const [cardKey, count] of counts.entries()) {
        const previous = platformState.observedCounts.get(cardKey) ?? 0;
        platformState.observedCounts.set(cardKey, Math.max(previous, count));
      }
      for (const [cardKey, value] of confidence.entries()) {
        if (value === "estimated" || !platformState.observedConfidence.has(cardKey)) {
          platformState.observedConfidence.set(cardKey, value);
        }
      }
    }

    const now = new Date().toISOString();
    const state = this.buildState(settings, deck, "atlas", now);
    const signature = this.stateSignature(state);
    if (signature !== platformState.lastSignature) {
      this.addSnapshot("atlas", state, "atlas-event");
      platformState.lastSignature = signature;
    }
    const message = trackerObservations.length
      ? `Atlas event tracker counted ${trackerObservations.length} visible local card${trackerObservations.length === 1 ? "" : "s"}.`
      : parsed.opponentObservations.length
        ? `Atlas event tracker logged ${parsed.opponentObservations.length} opponent public card${parsed.opponentObservations.length === 1 ? "" : "s"}.`
      : parsed.sideboardChanges.length
        ? `Atlas sideboard tracker applied ${parsed.sideboardChanges.length} deck change${parsed.sideboardChanges.length === 1 ? "" : "s"}.`
      : platformState.localPlayerId
        ? "Atlas event tracker is watching local visible card events."
        : "Waiting for your Atlas player ID before counting cards.";
    platformState.lastEventMessage = message;
    this.updateEventStatus("atlas", {
      state: trackerObservations.length ? "active" : "paused",
      active: true,
      message,
      processedFrames: platformState.eventPackets,
      skippedFrames: platformState.ignoredEvents,
      confidenceScore: trackerObservations.length ? 0.98 : 0.5
    });
  }

  async getVisionStatus(): Promise<VisionDeckTrackerStatus> {
    const settings = await this.store.getSettings();
    const deck = await this.activeDeck(settings);
    if (!DECK_TRACKER_FEATURE_ENABLED || !settings.deckTrackerEnabled) {
      this.visionStatus = {
        ...emptyVisionDeckTrackerStatus(false, this.activePlatform),
        enabled: false,
        state: "disabled",
        message: "Deck tracker beta is off.",
        processedFrames: this.visionStatus.processedFrames,
        skippedFrames: this.visionStatus.skippedFrames
      };
      return this.visionStatus;
    }
    if (!deck) {
      this.visionStatus = {
        ...this.visionStatus,
        enabled: true,
        active: false,
        state: "waiting-for-deck",
        platform: this.activePlatform,
        message: "Set an active deck to use the deck tracker beta.",
        updatedAt: new Date().toISOString(),
        suggestions: []
      };
    } else if (!this.visionStatus.enabled || this.visionStatus.state === "disabled") {
      this.visionStatus = {
        ...this.visionStatus,
        enabled: true,
        active: false,
        state: "paused",
        platform: this.activePlatform,
        message: "Atlas event tracker is waiting for an Atlas match.",
        updatedAt: new Date().toISOString(),
        suggestions: []
      };
    }
    return this.visionStatus;
  }

  async setVisionEnabled(enabled: boolean): Promise<UserSettings> {
    const settings = await this.store.saveSettings({ deckTrackerEnabled: Boolean(enabled) });
    this.visionStatus = {
      ...this.visionStatus,
      enabled: settings.deckTrackerEnabled,
      active: false,
      state: settings.deckTrackerEnabled ? "waiting-for-deck" : "disabled",
      message: settings.deckTrackerEnabled ? "Deck tracker beta enabled." : "Deck tracker beta is off.",
      updatedAt: new Date().toISOString()
    };
    return settings;
  }

  async calibrateVisionTracker(platform: GamePlatform): Promise<VisionDeckTrackerStatus> {
    this.activePlatform = platform;
    this.visionStatus = {
      ...this.visionStatus,
      enabled: true,
      active: false,
      platform,
      state: "paused",
      message: platform === "atlas" ? "Atlas event tracker reset. Waiting for the next local card event." : "Event deck tracker is Atlas-only in this beta.",
      updatedAt: new Date().toISOString(),
      suggestions: []
    };
    return this.visionStatus;
  }

  async confirmVisionSuggestion(cardKey: string): Promise<VisionDeckTrackerStatus> {
    const normalizedKey = normalizeDeckTrackerKey(cardKey);
    const suggestion = this.visionStatus.suggestions.find((item) => normalizeDeckTrackerKey(item.cardKey) === normalizedKey);
    if (!suggestion) {
      return this.visionStatus;
    }
    const remaining = this.visionStatus.suggestions.filter((item) => normalizeDeckTrackerKey(item.cardKey) !== normalizedKey);
    await this.reportVisionObservations(suggestion.platform, [observationFromSuggestion(suggestion)], {
      state: "active",
      active: true,
      message: `Confirmed ${suggestion.name}.`,
      suggestions: remaining
    });
    return this.visionStatus;
  }

  async rejectVisionSuggestion(cardKey: string): Promise<VisionDeckTrackerStatus> {
    const normalizedKey = normalizeDeckTrackerKey(cardKey);
    this.visionStatus = {
      ...this.visionStatus,
      suggestions: this.visionStatus.suggestions.filter((item) => normalizeDeckTrackerKey(item.cardKey) !== normalizedKey),
      updatedAt: new Date().toISOString()
    };
    return this.visionStatus;
  }

  async reportVisionObservations(
    platform: GamePlatform,
    observations: DeckTrackerObservation[],
    status: Partial<VisionDeckTrackerStatus> = {}
  ): Promise<DeckTrackerState> {
    const settings = await this.store.getSettings();
    this.activePlatform = platform;
    const deck = await this.activeDeck(settings);
    const now = new Date().toISOString();
    if (!DECK_TRACKER_FEATURE_ENABLED || !settings.deckTrackerEnabled) {
      this.visionStatus = mergeVisionStatus(this.visionStatus, {
        ...status,
        enabled: false,
        active: false,
        state: "disabled",
        platform,
        message: "Deck tracker beta is off.",
        updatedAt: now
      });
      return this.buildState(settings, deck, platform, now, "Deck tracker is off in Settings.");
    }
    if (!settings.deckTrackerAutoStart) {
      this.visionStatus = mergeVisionStatus(this.visionStatus, {
        ...status,
        enabled: true,
        active: false,
        state: "paused",
        platform,
        message: "Deck tracker auto-start is off.",
        updatedAt: now
      });
      return this.buildState(settings, deck, platform, now, "Deck tracker auto-start is off.");
    }
    let platformState = this.platformState(platform);
    if (platformState.deckId !== settings.activeDeckId) {
      this.resetPlatform(platform, settings.activeDeckId);
      platformState = this.platformState(platform);
    }
    const safeObservations = await this.enrichObservations(
      observations
        .map((observation) => coerceObservation(observation, platform, observation.capturedAt || now))
        .filter((observation): observation is DeckTrackerObservation => Boolean(observation))
    );
    const trackerObservations = deck
      ? normalizeVisionObservationsForDeck(safeObservations, mainDeckTrackerCards(deck))
      : safeObservations;
    if (deck && trackerObservations.length) {
      const deckCards = mainDeckTrackerCards(deck);
      const { counts, confidence } = observationCountsForDeck(trackerObservations, deckCards);
      for (const [cardKey, count] of counts.entries()) {
        const previous = platformState.observedCounts.get(cardKey) ?? 0;
        platformState.observedCounts.set(cardKey, Math.max(previous, count));
      }
      for (const [cardKey, value] of confidence.entries()) {
        if (value === "estimated" || !platformState.observedConfidence.has(cardKey)) {
          platformState.observedConfidence.set(cardKey, value);
        }
      }
    }
    const state = this.buildState(settings, deck, platform, now);
    if (trackerObservations.length || this.stateSignature(state) !== platformState.lastSignature) {
      this.addSnapshot(platform, state, "vision-update");
      platformState.lastSignature = this.stateSignature(state);
    }
    this.visionStatus = mergeVisionStatus(this.visionStatus, {
      ...status,
      enabled: true,
      active: Boolean(deck && settings.deckTrackerAutoStart),
      state: status.state ?? (trackerObservations.length ? "active" : status.suggestions?.length ? "low-confidence" : "active"),
      platform,
      message: status.message || (trackerObservations.length ? `Vision matched ${trackerObservations.length} visible card${trackerObservations.length === 1 ? "" : "s"}.` : "Vision is watching for visible local cards."),
      updatedAt: now
    });
    return state;
  }

  async setPinnedCards(deckId: string, cardKeys: string[]): Promise<DeckTrackerState> {
    if (!DECK_TRACKER_FEATURE_ENABLED) {
      return this.getState(this.activePlatform === "none" ? undefined : this.activePlatform);
    }
    const settings = await this.store.getSettings();
    const pinned = {
      ...(settings.deckTrackerPinnedCards ?? {}),
      [deckId]: [...new Set(cardKeys.map(normalizeDeckTrackerKey).filter(Boolean))]
    };
    const saved = await this.store.saveSettings({ deckTrackerPinnedCards: pinned });
    return this.getState(this.activePlatform === "none" ? undefined : this.activePlatform).then((state) => ({
      ...state,
      pinnedCards: saved.deckTrackerPinnedCards[deckId] ?? state.pinnedCards
    }));
  }

  async adjustCard(cardKey: string, delta: number): Promise<DeckTrackerState> {
    if (!DECK_TRACKER_FEATURE_ENABLED) {
      return this.getState(this.activePlatform === "none" ? undefined : this.activePlatform);
    }
    const settings = await this.store.getSettings();
    const platform = this.activePlatform === "none" ? "tcga" : this.activePlatform;
    const platformState = this.platformState(platform);
    const normalizedKey = normalizeDeckTrackerKey(cardKey);
    if (normalizedKey && delta) {
      platformState.corrections.push({
        cardKey: normalizedKey,
        delta: Math.max(-4, Math.min(4, Math.trunc(delta))),
        capturedAt: new Date().toISOString()
      });
    }
    const deck = await this.activeDeck(settings);
    const state = this.buildState(settings, deck, platform, new Date().toISOString());
    this.addSnapshot(platform, state, "manual-correction");
    platformState.lastSignature = this.stateSignature(state);
    return state;
  }

  async adjustSideboardCard(cardKey: string, direction: DeckTrackerSideboardDirection, delta: number): Promise<DeckTrackerState> {
    if (!DECK_TRACKER_FEATURE_ENABLED) {
      return this.getState(this.activePlatform === "none" ? undefined : this.activePlatform);
    }
    const settings = await this.store.getSettings();
    const platform = this.activePlatform === "none" ? "atlas" : this.activePlatform;
    const platformState = this.platformState(platform);
    const deck = await this.activeDeck(settings);
    const normalizedKey = normalizeDeckTrackerKey(cardKey);
    if (!deck || !normalizedKey || (direction !== "in" && direction !== "out") || !delta) {
      return this.buildState(settings, deck, platform, new Date().toISOString());
    }
    const card = this.sideboardCardTemplate(deck, direction, normalizedKey);
    if (!card) {
      return this.buildState(settings, deck, platform, new Date().toISOString());
    }
    const existingIndex = platformState.sideboardChanges.findIndex((change) => (
      change.source === "manual"
      && change.direction === direction
      && normalizeDeckTrackerKey(change.cardKey) === card.cardKey
    ));
    const existing = existingIndex >= 0 ? platformState.sideboardChanges[existingIndex] : undefined;
    const maxQty = Math.max(1, card.qty);
    const nextQty = Math.max(0, Math.min(maxQty, (existing?.qty ?? 0) + Math.trunc(delta)));
    if (existingIndex >= 0) {
      platformState.sideboardChanges.splice(existingIndex, 1);
    }
    if (nextQty > 0) {
      platformState.sideboardChanges.push({
        id: existing?.id || `manual-sideboard-${direction}-${card.cardKey}-${randomUUID()}`,
        cardKey: card.cardKey,
        name: card.name,
        code: card.code,
        cardId: card.cardId,
        imageUrl: card.imageUrl,
        qty: nextQty,
        direction,
        source: "manual",
        gameNumber: platformState.sideboardGameNumber,
        capturedAt: new Date().toISOString()
      });
    }
    platformState.sideboardChanges = platformState.sideboardChanges.slice(-60);
    const state = this.buildState(settings, deck, platform, new Date().toISOString());
    this.addSnapshot(platform, state, "sideboard-manual");
    platformState.lastSignature = this.stateSignature(state);
    return state;
  }

  async resetSideboard(): Promise<DeckTrackerState> {
    if (!DECK_TRACKER_FEATURE_ENABLED) {
      return this.getState(this.activePlatform === "none" ? undefined : this.activePlatform);
    }
    const settings = await this.store.getSettings();
    const platform = this.activePlatform === "none" ? "atlas" : this.activePlatform;
    const platformState = this.platformState(platform);
    platformState.sideboardChanges = [];
    platformState.sideboardEventIds.clear();
    const deck = await this.activeDeck(settings);
    const state = this.buildState(settings, deck, platform, new Date().toISOString());
    this.addSnapshot(platform, state, "sideboard-reset");
    platformState.lastSignature = this.stateSignature(state);
    return state;
  }

  async resetMatch(): Promise<DeckTrackerState> {
    if (!DECK_TRACKER_FEATURE_ENABLED) {
      return this.getState(this.activePlatform === "none" ? undefined : this.activePlatform);
    }
    const settings = await this.store.getSettings();
    const platform = this.activePlatform === "none" ? "tcga" : this.activePlatform;
    this.resetPlatform(platform, settings.activeDeckId);
    const deck = await this.activeDeck(settings);
    const state = this.buildState(settings, deck, platform, new Date().toISOString());
    this.addSnapshot(platform, state, "manual-reset");
    return state;
  }

  replaySnapshots(platform: GamePlatform): DeckTrackerSnapshot[] {
    if (!DECK_TRACKER_FEATURE_ENABLED) {
      return [];
    }
    return [...(this.stateByPlatform.get(platform)?.snapshots ?? [])];
  }

  clear(platform: GamePlatform): void {
    this.stateByPlatform.delete(platform);
    this.lastOpponentLegendByPlatform.delete(platform);
    if (this.activePlatform === platform) {
      this.activePlatform = "none";
    }
  }

  invalidateDeckLibrary(): void {
    this.deckCache = { deckId: "", deck: null };
    this.stateByPlatform.clear();
    this.lastOpponentLegendByPlatform.clear();
    this.activePlatform = "none";
    this.visionStatus = emptyVisionDeckTrackerStatus(
      this.visionStatus.enabled,
      "none",
      this.visionStatus.enabled
        ? "Deck library refreshed. Waiting for the next match."
        : "Vision deck tracker is off."
    );
  }

  private async activeDeck(settings: UserSettings): Promise<SavedDeck | null> {
    if (!settings.activeDeckId) {
      this.deckCache = { deckId: "", deck: null };
      return null;
    }
    if (this.deckCache.deckId === settings.activeDeckId) {
      return this.deckCache.deck;
    }
    const deck = await this.store.getSavedDeck(settings.activeDeckId);
    this.deckCache = { deckId: settings.activeDeckId, deck };
    return deck;
  }

  private async opponentLegendFromCapturePayload(payload: Record<string, unknown>): Promise<string> {
    const direct = firstCanonicalLegend([
      payload.opponentLegend,
      payload.oppLegend,
      payload.opponentChampion,
      payload.oppChampion,
      payload.theirChampion,
      payload.enemyChampion,
      nestedValue(payload, ["match", "opponentLegend"]),
      nestedValue(payload, ["match", "opponentChampion"]),
      nestedValue(payload, ["state", "opponentLegend"]),
      nestedValue(payload, ["state", "opponentChampion"])
    ]);
    if (direct) {
      return direct;
    }
    const imageOrCode = firstString([
      payload.opponentChampionImage,
      payload.oppChampionImage,
      payload.opponentLegendImage,
      nestedValue(payload, ["match", "opponentChampionImage"]),
      nestedValue(payload, ["match", "opponentLegendImage"]),
      nestedValue(payload, ["state", "opponentChampionImage"]),
      nestedValue(payload, ["state", "opponentLegendImage"])
    ]);
    const fromImageMap = canonicalLegendName(legendFromImageUrl(imageOrCode));
    if (fromImageMap) {
      return fromImageMap;
    }
    if (imageOrCode && this.tcgaResolver) {
      const resolved = await this.tcgaResolver.resolveLegend(imageOrCode).catch(() => "");
      return canonicalLegendName(resolved);
    }
    return "";
  }

  private platformState(platform: GamePlatform): PlatformTrackerState {
    const existing = this.stateByPlatform.get(platform);
    if (existing) {
      return existing;
    }
    const next: PlatformTrackerState = {
      observedCounts: new Map(),
      observedConfidence: new Map(),
      corrections: [],
      sideboardChanges: [],
      sideboardEventIds: new Set(),
      opponentSeenByInstance: new Map(),
      opponentKnownByInstance: new Map(),
      opponentSeenGameNumber: undefined,
      sideboardPhase: "",
      sideboardGameNumber: undefined,
      opponentLegend: "",
      snapshots: [],
      lastSignature: "",
      deckId: "",
      sessionKey: "",
      localPlayerId: "",
      eventPackets: 0,
      ignoredEvents: 0,
      lastFrameType: "",
      lastEventMessage: "",
      debugEvents: []
    };
    this.stateByPlatform.set(platform, next);
    return next;
  }

  private resetPlatform(platform: GamePlatform, deckId: string): void {
    this.stateByPlatform.set(platform, {
      observedCounts: new Map(),
      observedConfidence: new Map(),
      corrections: [],
      sideboardChanges: [],
      sideboardEventIds: new Set(),
      opponentSeenByInstance: new Map(),
      opponentKnownByInstance: new Map(),
      opponentSeenGameNumber: undefined,
      sideboardPhase: "",
      sideboardGameNumber: undefined,
      opponentLegend: "",
      snapshots: [],
      lastSignature: "",
      deckId,
      sessionKey: "",
      localPlayerId: "",
      eventPackets: 0,
      ignoredEvents: 0,
      lastFrameType: "",
      lastEventMessage: "",
      debugEvents: []
    });
    this.activePlatform = platform;
  }

  private rememberOpponentLegend(platform: GamePlatform, platformState: PlatformTrackerState, value: string): void {
    const legend = canonicalLegendName(value);
    if (!legend) {
      return;
    }
    platformState.opponentLegend = legend;
    this.lastOpponentLegendByPlatform.set(platform, legend);
  }

  private updateEventStatus(platform: GamePlatform, patch: Partial<VisionDeckTrackerStatus>): void {
    this.visionStatus = mergeVisionStatus(this.visionStatus, {
      enabled: true,
      platform,
      frameId: this.platformState(platform).lastFrameType,
      suggestions: [],
      updatedAt: new Date().toISOString(),
      ...patch
    });
  }

  private buildState(
    settings: UserSettings,
    deck: SavedDeck | null,
    platform: GamePlatform | "none",
    updatedAt: string,
    disabledReason = ""
  ): DeckTrackerState {
    const platformState = platform === "none" ? undefined : this.platformState(platform);
    return buildDeckTrackerState({
      deck,
      platform,
      updatedAt,
      disabledReason,
      observedCounts: platformState?.observedCounts,
      observedConfidence: platformState?.observedConfidence,
      corrections: platformState?.corrections,
      sideboardChanges: platformState?.sideboardChanges,
      sideboardPhase: platformState?.sideboardPhase,
      sideboardGameNumber: platformState?.sideboardGameNumber,
      opponentLegend: platformState?.opponentLegend ?? "",
      opponentCards: platformState ? buildOpponentSeenCards(platformState.opponentSeenByInstance) : [],
      opponentKnownCards: platformState ? buildOpponentSeenCards(platformState.opponentKnownByInstance, { maxCopiesPerCard: 3 }) : [],
      pinnedCards: deck ? settings.deckTrackerPinnedCards?.[deck.id] ?? [] : []
    });
  }

  private addSideboardChanges(platformState: PlatformTrackerState, changes: DeckTrackerSideboardChange[]): void {
    for (const change of changes) {
      const eventId = change.id || [
        change.source,
        change.direction,
        change.cardKey,
        change.cardId,
        change.code,
        change.name,
        change.gameNumber
      ].join(":");
      const normalizedId = normalizeDeckTrackerKey(eventId);
      if (normalizedId && platformState.sideboardEventIds.has(normalizedId)) {
        continue;
      }
      if (normalizedId) {
        platformState.sideboardEventIds.add(normalizedId);
      }
      platformState.sideboardChanges.push(change);
    }
    platformState.sideboardChanges = platformState.sideboardChanges.slice(-60);
  }

  private addOpponentSeen(platformState: PlatformTrackerState, observations: DeckTrackerObservation[]): void {
    for (const observation of observations) {
      const instanceKey = normalizeDeckTrackerKey(observation.instanceId || observation.frameId || [
        observation.ownerPlayerId,
        observation.cardKey,
        observation.cardId,
        observation.code,
        observation.name,
        observation.zone
      ].filter(Boolean).join(":"));
      if (!instanceKey) {
        continue;
      }
      const existing = platformState.opponentSeenByInstance.get(instanceKey);
      platformState.opponentSeenByInstance.set(instanceKey, {
        ...(existing ?? observation),
        ...observation,
        capturedAt: observation.capturedAt || existing?.capturedAt || new Date().toISOString(),
        confidence: existing?.confidence === "tracked" ? "tracked" : observation.confidence
      });
      const knownExisting = platformState.opponentKnownByInstance.get(instanceKey);
      platformState.opponentKnownByInstance.set(instanceKey, {
        ...(knownExisting ?? observation),
        ...observation,
        capturedAt: observation.capturedAt || knownExisting?.capturedAt || new Date().toISOString(),
        confidence: knownExisting?.confidence === "tracked" ? "tracked" : observation.confidence
      });
    }
    if (platformState.opponentSeenByInstance.size > 160) {
      const trimmed = [...platformState.opponentSeenByInstance.entries()]
        .sort((a, b) => new Date(b[1].capturedAt).getTime() - new Date(a[1].capturedAt).getTime())
        .slice(0, 160);
      platformState.opponentSeenByInstance = new Map(trimmed);
    }
    if (platformState.opponentKnownByInstance.size > 240) {
      const trimmed = [...platformState.opponentKnownByInstance.entries()]
        .sort((a, b) => new Date(b[1].capturedAt).getTime() - new Date(a[1].capturedAt).getTime())
        .slice(0, 240);
      platformState.opponentKnownByInstance = new Map(trimmed);
    }
  }

  private sideboardCardTemplate(deck: SavedDeck, direction: DeckTrackerSideboardDirection, cardKey: string) {
    const options = direction === "in" ? sideboardTrackerCards(deck) : mainDeckTrackerCards(deck);
    return options.find((card) => card.aliases.some((alias) => normalizeDeckTrackerKey(alias) === cardKey) || card.cardKey === cardKey);
  }

  private async enrichObservations(observations: DeckTrackerObservation[]): Promise<DeckTrackerObservation[]> {
    if (!observations.length || !this.tcgaResolver) {
      return observations;
    }
    const resolver = this.tcgaResolver;
    return Promise.all(observations.map(async (observation) => {
      if (observation.platform !== "tcga" || observation.name) {
        return observation;
      }
      const resolvedName = await resolver.resolveCard(observation.code || observation.cardId || observation.imageUrl).catch(() => "");
      return resolvedName ? { ...observation, name: resolvedName } : observation;
    }));
  }

  private addSnapshot(platform: GamePlatform, state: DeckTrackerState, reason: string): void {
    if (!state.deckId) {
      return;
    }
    const platformState = this.platformState(platform);
    const snapshot: DeckTrackerSnapshot = {
      id: randomUUID(),
      capturedAt: state.updatedAt,
      reason,
      state
    };
    platformState.snapshots = [...platformState.snapshots, snapshot].slice(-MAX_TRACKER_SNAPSHOTS);
  }

  private stateSignature(state: DeckTrackerState): string {
    return [
      state.deckId,
      state.opponentLegend,
      state.cardsLeft,
      state.confidence,
      state.cards.map((card) => `${card.cardKey}:${card.deckCount}:${card.seenCount}:${card.manualDelta}:${card.pinned ? "p" : ""}`).join("|"),
      state.sideboard.changes.map((change) => `${change.source}:${change.direction}:${change.cardKey}:${change.qty}`).join("|"),
      state.opponent.cards.map((card) => `${card.cardKey}:${card.count}:${card.zones.join(",")}`).join("|"),
      state.opponent.knownCards.map((card) => `${card.cardKey}:${card.count}:${card.zones.join(",")}`).join("|")
    ].join(";");
  }
}

function buildOpponentSeenCards(
  instances: Map<string, DeckTrackerObservation>,
  options: { maxCopiesPerCard?: number } = {}
): DeckTrackerOpponentCardState[] {
  const byCard = new Map<string, DeckTrackerOpponentCardState>();
  const maxCopiesPerCard = Number.isFinite(options.maxCopiesPerCard)
    ? Math.max(1, Math.floor(Number(options.maxCopiesPerCard)))
    : Number.POSITIVE_INFINITY;
  for (const observation of instances.values()) {
    const cardKey = normalizeDeckTrackerKey(observation.cardKey || observation.cardId || observation.code || observation.name);
    if (!cardKey) {
      continue;
    }
    const capturedAt = observation.capturedAt || new Date().toISOString();
    const existing = byCard.get(cardKey);
    const fallbackImageUrl = deckTrackerImageUrlFromId(observation.cardId || observation.code || "");
    const copyCount = Math.max(1, Math.floor(Number(observation.count) || 1));
    if (!existing) {
      byCard.set(cardKey, {
        cardKey,
        name: observation.name || observation.code || observation.cardId || "Unknown card",
        code: observation.code,
        cardId: observation.cardId,
        imageUrl: observation.imageUrl || fallbackImageUrl,
        count: Math.min(maxCopiesPerCard, copyCount),
        zones: [observation.zone].filter((zone) => zone !== "unknown"),
        firstSeenAt: capturedAt,
        lastSeenAt: capturedAt,
        confidence: observation.confidence
      });
      continue;
    }
    const zones = new Set(existing.zones);
    if (observation.zone !== "unknown") {
      zones.add(observation.zone);
    }
    const firstSeenAt = new Date(capturedAt).getTime() < new Date(existing.firstSeenAt).getTime()
      ? capturedAt
      : existing.firstSeenAt;
    const lastSeenAt = new Date(capturedAt).getTime() > new Date(existing.lastSeenAt).getTime()
      ? capturedAt
      : existing.lastSeenAt;
    byCard.set(cardKey, {
      ...existing,
      name: existing.name || observation.name,
      code: existing.code || observation.code,
      cardId: existing.cardId || observation.cardId,
      imageUrl: existing.imageUrl || observation.imageUrl || fallbackImageUrl,
      count: Math.min(maxCopiesPerCard, existing.count + copyCount),
      zones: [...zones],
      firstSeenAt,
      lastSeenAt,
      confidence: existing.confidence === "estimated" ? observation.confidence : existing.confidence
    });
  }
  return [...byCard.values()].sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime() || a.name.localeCompare(b.name));
}

function coerceObservations(value: unknown, platform: GamePlatform, capturedAt: string): DeckTrackerObservation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => coerceObservation(item, platform, capturedAt)).filter((item): item is DeckTrackerObservation => Boolean(item));
}

function coerceObservation(value: unknown, platform: GamePlatform, capturedAt: string): DeckTrackerObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const cardKey = normalizeDeckTrackerKey(readString(record.cardKey) || readString(record.cardId) || readString(record.code) || readString(record.name));
  if (!cardKey) {
    return null;
  }
  return {
    cardKey,
    name: readString(record.name),
    code: readString(record.code).toUpperCase(),
    cardId: readString(record.cardId),
    imageUrl: readString(record.imageUrl || record.image),
    zone: coerceZone(readString(record.zone)),
    count: Math.max(1, Math.min(8, Math.trunc(Number(record.count) || 1))),
    platform,
    confidence: record.confidence === "tracked" ? "tracked" : "estimated",
    capturedAt,
    source: coerceObservationSource(readString(record.source)),
    confidenceScore: coerceConfidenceScore(record.confidenceScore),
    frameId: readString(record.frameId),
    instanceId: readString(record.instanceId),
    ownerPlayerId: readString(record.ownerPlayerId),
    zoneRect: coerceZoneRect(record.zoneRect)
  };
}

function shouldCarryAtlasOpponentMemory(
  platformState: PlatformTrackerState,
  event: CaptureEvent,
  eventSessionKey: string,
  eventOpponentLegend: string
): boolean {
  if (event.platform !== "atlas" || event.kind !== "match-start" || !platformState.opponentKnownByInstance.size) {
    return false;
  }
  if (platformState.sessionKey && eventSessionKey && platformState.sessionKey === eventSessionKey) {
    return true;
  }
  const previousLegend = canonicalLegendName(platformState.opponentLegend);
  const nextLegend = canonicalLegendName(eventOpponentLegend);
  return isAtlasBo3ContinuationEvent(event) && Boolean(previousLegend && nextLegend && previousLegend === nextLegend);
}

function trackerSessionKeyFromCaptureEvent(event: CaptureEvent): string {
  const payload = event.payload ?? {};
  return firstString([
    payload.roomCode,
    payload.gameInstanceId,
    payload.room,
    payload.roomId,
    payload.matchId,
    nestedValue(payload, ["match", "roomCode"]),
    nestedValue(payload, ["state", "roomCode"])
  ]);
}

function isAtlasBo3ContinuationEvent(event: CaptureEvent): boolean {
  if (event.platform !== "atlas") {
    return false;
  }
  const payload = event.payload ?? {};
  const format = readString(payload.format).toLowerCase();
  const gameNumber = Number(payload.atlasBo3GameNumber ?? payload.gameNumber ?? payload.game);
  return format === "bo3"
    || format === "best of 3"
    || format.includes("bo3")
    || payload.atlasBo3Queue === true
    || payload.atlasSideboarding === true
    || (Number.isFinite(gameNumber) && gameNumber > 1);
}

function coerceZone(value: string): DeckTrackerZone {
  if (value === "hand" || value === "board" || value === "base" || value === "stack" || value === "trash" || value === "discard") {
    return value;
  }
  return "unknown";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(values: unknown[]): string {
  return values.map(readString).find(Boolean) ?? "";
}

function firstCanonicalLegend(values: unknown[]): string {
  for (const value of values) {
    const direct = canonicalLegendName(value);
    if (direct) {
      return direct;
    }
  }
  return "";
}

function nestedValue(record: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function coerceObservationSource(value: string): DeckTrackerObservation["source"] | undefined {
  if (value === "dom" || value === "vision" || value === "manual" || value === "event") {
    return value;
  }
  return undefined;
}

function coerceConfidenceScore(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function coerceZoneRect(value: unknown): DeckTrackerObservation["zoneRect"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const width = Number(record.width);
  const height = Number(record.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

function observationFromSuggestion(suggestion: VisionDeckTrackerSuggestion): DeckTrackerObservation {
  return {
    cardKey: suggestion.cardKey,
    name: suggestion.name,
    code: suggestion.code,
    cardId: suggestion.cardId,
    imageUrl: suggestion.imageUrl,
    zone: suggestion.zone,
    count: 1,
    platform: suggestion.platform,
    confidence: "estimated",
    capturedAt: suggestion.capturedAt || new Date().toISOString(),
    source: "manual",
    confidenceScore: suggestion.confidenceScore,
    frameId: suggestion.frameId,
    zoneRect: suggestion.zoneRect
  };
}

function normalizeVisionObservationsForDeck(
  observations: DeckTrackerObservation[],
  deckCards: ReturnType<typeof mainDeckTrackerCards>
): DeckTrackerObservation[] {
  if (!observations.length || !deckCards.length) {
    return observations;
  }
  const deckQtyByKey = new Map(deckCards.map((card) => [card.cardKey, card.qty]));
  const aliases = new Map<string, string>();
  for (const card of deckCards) {
    for (const alias of card.aliases) {
      aliases.set(alias, card.cardKey);
    }
  }

  const persistent = observations.filter((observation) => observation.source !== "vision");
  const vision = observations
    .filter((observation) => observation.source === "vision")
    .filter((observation) => observation.zone !== "trash" && observation.zone !== "discard" && observation.zone !== "unknown")
    .map((observation) => {
      const matchedKey = matchedDeckKey(observation, aliases);
      return matchedKey ? { ...observation, cardKey: matchedKey } : null;
    })
    .filter((observation): observation is DeckTrackerObservation => Boolean(observation));

  const byCard = new Map<string, DeckTrackerObservation[]>();
  for (const observation of vision) {
    const list = byCard.get(observation.cardKey) ?? [];
    list.push(observation);
    byCard.set(observation.cardKey, list);
  }

  const dedupedVision: DeckTrackerObservation[] = [];
  for (const [cardKey, entries] of byCard.entries()) {
    const maxCopies = Math.max(1, deckQtyByKey.get(cardKey) ?? 1);
    const accepted: DeckTrackerObservation[] = [];
    const hasAnchoredCopy = entries.some((entry) => entry.zone === "hand" || entry.zone === "board" || entry.zone === "base");
    const candidates = hasAnchoredCopy
      ? entries.filter((entry) => entry.zone !== "stack")
      : entries;
    for (const entry of candidates.sort((a, b) => {
      const confidenceDelta = (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
      if (Math.abs(confidenceDelta) > 0.03) {
        return confidenceDelta;
      }
      return visionZonePriority(b.zone) - visionZonePriority(a.zone);
    })) {
      const rect = entry.zoneRect;
      if (rect && accepted.some((existing) => existing.zoneRect && rectOverlap(rect, existing.zoneRect) > 0.42)) {
        continue;
      }
      accepted.push(entry);
      if (accepted.length >= maxCopies) {
        break;
      }
    }
    dedupedVision.push(...accepted);
  }

  return [...persistent, ...dedupedVision];
}

function visionZonePriority(zone: DeckTrackerZone): number {
  if (zone === "board" || zone === "base") {
    return 4;
  }
  if (zone === "hand") {
    return 3;
  }
  if (zone === "stack") {
    return 2;
  }
  return 1;
}

function matchedDeckKey(observation: DeckTrackerObservation, aliases: Map<string, string>): string {
  const observationAliases = deckTrackerIdentityAliases(observation);
  return observationAliases.map((alias) => aliases.get(alias)).find(Boolean) ?? "";
}

function rectOverlap(
  a: NonNullable<DeckTrackerObservation["zoneRect"]>,
  b: NonNullable<DeckTrackerObservation["zoneRect"]>
): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlapWidth = Math.max(0, right - left);
  const overlapHeight = Math.max(0, bottom - top);
  const overlapArea = overlapWidth * overlapHeight;
  if (!overlapArea) {
    return 0;
  }
  const smallerArea = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
  return overlapArea / smallerArea;
}

function mergeVisionStatus(
  current: VisionDeckTrackerStatus,
  patch: Partial<VisionDeckTrackerStatus>
): VisionDeckTrackerStatus {
  return {
    ...current,
    ...patch,
    enabled: patch.enabled ?? current.enabled,
    active: patch.active ?? current.active,
    platform: patch.platform ?? current.platform,
    message: patch.message ?? current.message,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
    frameId: patch.frameId ?? current.frameId,
    confidenceScore: typeof patch.confidenceScore === "number" ? patch.confidenceScore : current.confidenceScore,
    processedFrames: typeof patch.processedFrames === "number" ? patch.processedFrames : current.processedFrames,
    skippedFrames: typeof patch.skippedFrames === "number" ? patch.skippedFrames : current.skippedFrames,
    suggestions: patch.suggestions ?? current.suggestions
  };
}
