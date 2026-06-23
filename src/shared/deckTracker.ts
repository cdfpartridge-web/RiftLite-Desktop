import type {
  DeckEntry,
  DeckTrackerCardState,
  DeckTrackerConfidence,
  DeckTrackerCorrection,
  DeckTrackerObservation,
  DeckTrackerState,
  GamePlatform,
  SavedDeck
} from "./types.js";

export type MainDeckCard = {
  cardKey: string;
  aliases: string[];
  name: string;
  code: string;
  cardId: string;
  imageUrl: string;
  qty: number;
};

export type DeckTrackerLibraryCard = MainDeckCard & {
  role: "main" | "legend";
};

export type DeckTrackerBuildOptions = {
  deck: SavedDeck | null;
  platform: GamePlatform | "none";
  observedCounts?: Map<string, number> | Record<string, number>;
  observedConfidence?: Map<string, DeckTrackerConfidence> | Record<string, DeckTrackerConfidence>;
  corrections?: DeckTrackerCorrection[];
  pinnedCards?: string[];
  updatedAt?: string;
  disabledReason?: string;
};

export function normalizeDeckTrackerKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function deckTrackerCodeFromImage(value: string): string {
  const match = value.match(/\b([A-Z]{2,5}-\d{1,4}[A-Z]?)\b/i);
  return match?.[1]?.toUpperCase() ?? "";
}

export function deckTrackerCardKey(card: Partial<Pick<DeckEntry, "cardId" | "imageUrl" | "name">> & { code?: string }): string {
  return normalizeDeckTrackerKey(card.cardId || card.code || deckTrackerCodeFromImage(card.imageUrl || "") || card.name || "");
}

function deckTrackerCodeAliases(value: string): string[] {
  const raw = value.trim();
  if (!raw) {
    return [];
  }
  const code = raw.match(/\b([A-Z]{2,5}-\d{1,4}[A-Z]?)\b/i)?.[1]?.toUpperCase() ?? raw.toUpperCase();
  const aliases = [normalizeDeckTrackerKey(code)];
  const baseCode = code.match(/^([A-Z]{2,5}-\d{1,4})[A-Z]$/)?.[1] ?? "";
  if (baseCode) {
    aliases.push(normalizeDeckTrackerKey(baseCode));
  }
  return aliases.filter(Boolean);
}

export function mainDeckTrackerCards(deck: SavedDeck | null): MainDeckCard[] {
  if (!deck?.snapshotJson) {
    return [];
  }
  const snapshot = parseJsonRecord(deck.snapshotJson);
  const rawEntries = firstArray(snapshot.mainDeck, snapshot.main_deck, snapshot.cards, snapshot.deck);
  const cards = rawEntries
    .map(readDeckEntry)
    .filter((entry): entry is DeckEntry => Boolean(entry?.name && entry.qty > 0));
  return cards.map((entry) => {
    const code = deckTrackerCodeFromImage(entry.imageUrl || "");
    const cardKey = deckTrackerCardKey({ ...entry, code });
    const aliases = [
      cardKey,
      normalizeDeckTrackerKey(entry.cardId || ""),
      normalizeDeckTrackerKey(code),
      normalizeDeckTrackerKey(entry.name),
      ...deckTrackerCodeAliases(entry.cardId || ""),
      ...deckTrackerCodeAliases(code)
    ].filter(Boolean);
    return {
      cardKey,
      aliases: [...new Set(aliases)],
      name: entry.name,
      code,
      cardId: entry.cardId || "",
      imageUrl: entry.imageUrl || "",
      qty: entry.qty
    };
  }).filter((card) => card.cardKey);
}

export function visionDeckTrackerCards(deck: SavedDeck | null): DeckTrackerLibraryCard[] {
  const mainCards = mainDeckTrackerCards(deck).map((card) => ({ ...card, role: "main" as const }));
  const legendCard = legendDeckTrackerCard(deck);
  return legendCard ? [...mainCards, legendCard] : mainCards;
}

function legendDeckTrackerCard(deck: SavedDeck | null): DeckTrackerLibraryCard | null {
  if (!deck?.snapshotJson) {
    return null;
  }
  const snapshot = parseJsonRecord(deck.snapshotJson);
  const entry = readDeckEntry(snapshot.legendEntry ?? snapshot.legend_entry ?? {
    qty: 1,
    name: readString(snapshot.legend ?? deck.legend),
    cardId: readString(snapshot.legendKey ?? snapshot.legend_key),
    imageUrl: ""
  });
  const name = entry?.name || readString(snapshot.legend ?? deck.legend);
  if (!name) {
    return null;
  }
  const cardId = entry?.cardId || "";
  const imageUrl = entry?.imageUrl || "";
  const code = deckTrackerCodeFromImage(imageUrl) || deckTrackerCodeFromImage(cardId);
  const cardKey = deckTrackerCardKey({ cardId, imageUrl, name, code }) || normalizeDeckTrackerKey(name);
  const aliases = [
    cardKey,
    normalizeDeckTrackerKey(cardId),
    normalizeDeckTrackerKey(code),
    normalizeDeckTrackerKey(name),
    normalizeDeckTrackerKey(deck.legend || ""),
    ...deckTrackerCodeAliases(cardId),
    ...deckTrackerCodeAliases(code)
  ].filter(Boolean);
  return {
    cardKey,
    aliases: [...new Set(aliases)],
    name,
    code,
    cardId,
    imageUrl,
    qty: 1,
    role: "legend"
  };
}

export function observationCountsForDeck(
  observations: DeckTrackerObservation[],
  deckCards: MainDeckCard[]
): {
  counts: Map<string, number>;
  confidence: Map<string, DeckTrackerConfidence>;
} {
  const aliases = new Map<string, string>();
  for (const card of deckCards) {
    for (const alias of card.aliases) {
      aliases.set(alias, card.cardKey);
    }
  }
  const counts = new Map<string, number>();
  const confidence = new Map<string, DeckTrackerConfidence>();
  const visionZoneCounts = new Map<string, Map<string, number>>();
  const visionConfidence = new Map<string, DeckTrackerConfidence>();
  for (const observation of observations) {
    const observationAliases = [
      observation.cardKey,
      observation.cardId,
      observation.code,
      observation.name,
      deckTrackerCodeFromImage(observation.imageUrl)
    ].map(normalizeDeckTrackerKey).filter(Boolean);
    const matchedKey = observationAliases.map((alias) => aliases.get(alias)).find(Boolean);
    if (!matchedKey) {
      continue;
    }
    const count = Math.max(1, Math.floor(Number(observation.count) || 1));
    if (observation.source === "vision") {
      const zone = observation.zone || "unknown";
      const zoneCounts = visionZoneCounts.get(matchedKey) ?? new Map<string, number>();
      zoneCounts.set(zone, (zoneCounts.get(zone) ?? 0) + count);
      visionZoneCounts.set(matchedKey, zoneCounts);
      if (observation.confidence === "estimated" || !visionConfidence.has(matchedKey)) {
        visionConfidence.set(matchedKey, observation.confidence);
      }
      continue;
    }
    counts.set(matchedKey, (counts.get(matchedKey) ?? 0) + count);
    if (observation.confidence === "estimated" || !confidence.has(matchedKey)) {
      confidence.set(matchedKey, observation.confidence);
    }
  }
  for (const [matchedKey, zoneCounts] of visionZoneCounts) {
    const count = Math.max(...zoneCounts.values());
    counts.set(matchedKey, Math.max(counts.get(matchedKey) ?? 0, count));
    const nextConfidence = visionConfidence.get(matchedKey);
    if (nextConfidence && (nextConfidence === "estimated" || !confidence.has(matchedKey))) {
      confidence.set(matchedKey, nextConfidence);
    }
  }
  return { counts, confidence };
}

export function buildDeckTrackerState(options: DeckTrackerBuildOptions): DeckTrackerState {
  const updatedAt = options.updatedAt || new Date().toISOString();
  const deckCards = mainDeckTrackerCards(options.deck);
  if (!options.deck) {
    return emptyDeckTrackerState("Set an active deck to use My Deck Tracker.", options.platform, updatedAt);
  }
  if (!deckCards.length) {
    return emptyDeckTrackerState("Active deck has no main deck cards to track.", options.platform, updatedAt, options.deck);
  }
  if (options.disabledReason) {
    return emptyDeckTrackerState(options.disabledReason, options.platform, updatedAt, options.deck);
  }

  const observedCounts = mapFrom(options.observedCounts);
  const observedConfidence = mapFrom(options.observedConfidence);
  const corrections = options.corrections ?? [];
  const correctionTotals = new Map<string, number>();
  for (const correction of corrections) {
    correctionTotals.set(correction.cardKey, (correctionTotals.get(correction.cardKey) ?? 0) + correction.delta);
  }
  const deckSize = deckCards.reduce((total, card) => total + card.qty, 0);
  const pinned = new Set(options.pinnedCards ?? []);
  const cards: DeckTrackerCardState[] = deckCards.map((card) => {
    const seenAuto = Math.min(card.qty, Math.max(0, observedCounts.get(card.cardKey) ?? 0));
    const manualDelta = correctionTotals.get(card.cardKey) ?? 0;
    const seenCount = Math.min(card.qty, Math.max(0, seenAuto + manualDelta));
    const copiesLeft = Math.max(0, card.qty - seenCount);
    return {
      cardKey: card.cardKey,
      name: card.name,
      code: card.code,
      cardId: card.cardId,
      imageUrl: card.imageUrl,
      deckCount: card.qty,
      seenCount,
      manualDelta,
      copiesLeft,
      pinned: pinned.has(card.cardKey),
      confidence: observedConfidence.get(card.cardKey) ?? "tracked",
      odds: {
        next1: chanceAtLeastOne(copiesLeft, 0, 1),
        next2: 0,
        next3: 0
      }
    };
  });
  const seenCount = cards.reduce((total, card) => total + card.seenCount, 0);
  const cardsLeft = Math.max(0, deckSize - seenCount);
  const finalCards = cards.map((card) => ({
    ...card,
    odds: {
      next1: chanceAtLeastOne(card.copiesLeft, cardsLeft, 1),
      next2: chanceAtLeastOne(card.copiesLeft, cardsLeft, 2),
      next3: chanceAtLeastOne(card.copiesLeft, cardsLeft, 3)
    }
  })).sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  const confidence: DeckTrackerConfidence = finalCards.some((card) => card.confidence === "estimated") ? "estimated" : "tracked";
  return {
    active: true,
    reason: confidence === "estimated" ? "Estimated from visible card data. Use +/- for corrections." : "Tracking visible local cards.",
    deckId: options.deck.id,
    deckTitle: options.deck.title,
    deckLegend: options.deck.legend,
    platform: options.platform,
    confidence,
    deckSize,
    cardsLeft,
    seenCount,
    updatedAt,
    pinnedCards: [...pinned],
    corrections,
    cards: finalCards
  };
}

export function chanceAtLeastOne(copiesLeft: number, deckLeft: number, draws: number): number {
  const copies = Math.max(0, Math.floor(copiesLeft));
  const deck = Math.max(0, Math.floor(deckLeft));
  const drawCount = Math.max(0, Math.floor(draws));
  if (!copies || !deck || !drawCount) {
    return 0;
  }
  if (copies >= deck || drawCount >= deck) {
    return 1;
  }
  let miss = 1;
  for (let index = 0; index < drawCount; index += 1) {
    miss *= (deck - copies - index) / (deck - index);
  }
  return Math.max(0, Math.min(1, 1 - miss));
}

function emptyDeckTrackerState(
  reason: string,
  platform: GamePlatform | "none",
  updatedAt: string,
  deck?: SavedDeck
): DeckTrackerState {
  return {
    active: false,
    reason,
    deckId: deck?.id ?? "",
    deckTitle: deck?.title ?? "",
    deckLegend: deck?.legend ?? "",
    platform,
    confidence: "estimated",
    deckSize: 0,
    cardsLeft: 0,
    seenCount: 0,
    updatedAt,
    pinnedCards: [],
    corrections: [],
    cards: []
  };
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function readDeckEntry(value: unknown): DeckEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const name = readString(record.name ?? record.cardName ?? record.title);
  const qty = readNumber(record.qty ?? record.quantity ?? record.count ?? record.amount) || 1;
  if (!name) {
    return null;
  }
  return {
    qty,
    name,
    cardId: readString(record.cardId ?? record.card_id ?? record.id),
    imageUrl: readString(record.imageUrl ?? record.image_url ?? record.image ?? record.src)
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

function mapFrom<T>(value: Map<string, T> | Record<string, T> | undefined): Map<string, T> {
  if (!value) {
    return new Map();
  }
  return value instanceof Map ? value : new Map(Object.entries(value));
}
