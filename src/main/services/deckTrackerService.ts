import { randomUUID } from "node:crypto";
import {
  buildDeckTrackerState,
  observationCountsForDeck,
  mainDeckTrackerCards,
  normalizeDeckTrackerKey
} from "../../shared/deckTracker.js";
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
  UserSettings
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
    capturedAt
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
