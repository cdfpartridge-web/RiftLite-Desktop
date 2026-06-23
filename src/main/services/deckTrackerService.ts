import { randomUUID } from "node:crypto";
import {
  buildDeckTrackerState,
  observationCountsForDeck,
  mainDeckTrackerCards,
  normalizeDeckTrackerKey
} from "../../shared/deckTracker.js";
import { emptyVisionDeckTrackerStatus } from "../../shared/visionDeckTracker.js";
import type {
  CaptureEvent,
  DeckTrackerConfidence,
  DeckTrackerCorrection,
  DeckTrackerObservation,
  DeckTrackerSnapshot,
  DeckTrackerState,
  DeckTrackerZone,
  GamePlatform,
  SavedDeck,
  UserSettings,
  VisionDeckTrackerStatus,
  VisionDeckTrackerSuggestion
} from "../../shared/types.js";
import { RiftLiteStore } from "./store.js";
import { TcgaResolver } from "./tcgaResolver.js";

const MAX_TRACKER_SNAPSHOTS = 180;
const DECK_TRACKER_FEATURE_ENABLED = false;

type PlatformTrackerState = {
  observedCounts: Map<string, number>;
  observedConfidence: Map<string, DeckTrackerConfidence>;
  corrections: DeckTrackerCorrection[];
  snapshots: DeckTrackerSnapshot[];
  lastSignature: string;
  deckId: string;
};

export class DeckTrackerService {
  private readonly stateByPlatform = new Map<GamePlatform, PlatformTrackerState>();
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
    if (event.kind === "match-start" || platformState.deckId !== settings.activeDeckId) {
      this.resetPlatform(event.platform, settings.activeDeckId);
      platformState = this.platformState(event.platform);
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
    if (shouldSnapshotEvent(event, observations.length) || this.stateSignature(state) !== platformState.lastSignature) {
      this.addSnapshot(event.platform, state, event.kind === "match-start" ? "match-start" : event.kind === "match-end" ? "final-result" : "capture-update");
    }
    platformState.lastSignature = this.stateSignature(state);
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
      state: "calibrating",
      message: "Re-scanning the visible game layout.",
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
    if (this.activePlatform === platform) {
      this.activePlatform = "none";
    }
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

  private platformState(platform: GamePlatform): PlatformTrackerState {
    const existing = this.stateByPlatform.get(platform);
    if (existing) {
      return existing;
    }
    const next: PlatformTrackerState = {
      observedCounts: new Map(),
      observedConfidence: new Map(),
      corrections: [],
      snapshots: [],
      lastSignature: "",
      deckId: ""
    };
    this.stateByPlatform.set(platform, next);
    return next;
  }

  private resetPlatform(platform: GamePlatform, deckId: string): void {
    this.stateByPlatform.set(platform, {
      observedCounts: new Map(),
      observedConfidence: new Map(),
      corrections: [],
      snapshots: [],
      lastSignature: "",
      deckId
    });
    this.activePlatform = platform;
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
      pinnedCards: deck ? settings.deckTrackerPinnedCards?.[deck.id] ?? [] : []
    });
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
      state.cardsLeft,
      state.confidence,
      state.cards.map((card) => `${card.cardKey}:${card.seenCount}:${card.manualDelta}:${card.pinned ? "p" : ""}`).join("|")
    ].join(";");
  }
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
    zoneRect: coerceZoneRect(record.zoneRect)
  };
}

function shouldSnapshotEvent(event: CaptureEvent, observationCount: number): boolean {
  if (event.kind === "match-start" || event.kind === "match-end") {
    return true;
  }
  const payload = event.payload ?? {};
  return observationCount > 0 || Boolean(payload.score || payload.turnText || payload.atlasScoreCandidates);
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

function coerceObservationSource(value: string): DeckTrackerObservation["source"] | undefined {
  if (value === "dom" || value === "vision" || value === "manual") {
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
  const observationAliases = [
    observation.cardKey,
    observation.cardId,
    observation.code,
    observation.name,
    observation.imageUrl
  ].map(normalizeDeckTrackerKey).filter(Boolean);
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
