import type {
  DeckEntry,
  DeckTrackerCardRole,
  DeckTrackerCardState,
  DeckTrackerConfidence,
  DeckTrackerCorrection,
  DeckTrackerOpponentCardState,
  DeckTrackerObservation,
  DeckTrackerSideboardCardOption,
  DeckTrackerSideboardChange,
  DeckTrackerSideboardState,
  DeckTrackerState,
  GamePlatform,
  SavedDeck
} from "./types.js";
import {
  riftboundCanonicalArtCode,
  riftboundCardCodeAliases,
  riftboundCardCodeFromValue
} from "./cardIdentity.js";

export type MainDeckCard = {
  cardKey: string;
  aliases: string[];
  name: string;
  code: string;
  cardId: string;
  imageUrl: string;
  qty: number;
  role: DeckTrackerCardRole;
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
  sideboardChanges?: DeckTrackerSideboardChange[];
  sideboardPhase?: string;
  sideboardGameNumber?: number;
  opponentLegend?: string;
  opponentCards?: DeckTrackerOpponentCardState[];
  opponentKnownCards?: DeckTrackerOpponentCardState[];
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
  return riftboundCardCodeFromValue(value);
}

export function deckTrackerCardKey(card: Partial<Pick<DeckEntry, "cardId" | "imageUrl" | "name">> & { code?: string }): string {
  return normalizeDeckTrackerKey(card.cardId || card.code || deckTrackerCodeFromImage(card.imageUrl || "") || card.name || "");
}

export function deckTrackerIdentityAliases(card: {
  cardKey?: string;
  cardId?: string;
  code?: string;
  imageUrl?: string;
  name?: string;
}): string[] {
  const imageCode = deckTrackerCodeFromImage(card.imageUrl || "");
  const directAliases = [
    card.cardKey,
    card.cardId,
    card.code,
    imageCode,
    card.name
  ].map((value) => normalizeDeckTrackerKey(value || "")).filter(Boolean);
  const codeAliases = [card.cardId, card.code, imageCode]
    .flatMap((value) => riftboundCardCodeAliases(value || ""))
    .map(normalizeDeckTrackerKey)
    .filter(Boolean);
  return [...new Set([...directAliases, ...codeAliases])];
}

export function mainDeckTrackerCards(deck: SavedDeck | null): MainDeckCard[] {
  return deckTrackerCardsFromSection(deck, "main");
}

export function sideboardTrackerCards(deck: SavedDeck | null): MainDeckCard[] {
  return deckTrackerCardsFromSection(deck, "sideboard");
}

function deckTrackerCardsFromSection(deck: SavedDeck | null, role: "main" | "sideboard"): MainDeckCard[] {
  if (!deck?.snapshotJson) {
    return [];
  }
  const snapshot = parseJsonRecord(deck.snapshotJson);
  const rawEntries = role === "sideboard"
    ? firstArray(snapshot.sideboard, snapshot.side_board)
    : firstArray(snapshot.mainDeck, snapshot.main_deck, snapshot.cards, snapshot.deck);
  const cards = rawEntries
    .map(readDeckEntry)
    .filter((entry): entry is DeckEntry => Boolean(entry?.name && entry.qty > 0));
  return combineTrackerCards(cards.map((entry) => {
    const code = deckTrackerCodeFromImage(entry.imageUrl || "");
    const cardKey = deckTrackerCardKey({ ...entry, code });
    const aliases = deckTrackerIdentityAliases({ ...entry, cardKey, code });
    return {
      cardKey,
      aliases: [...new Set(aliases)],
      name: entry.name,
      code,
      cardId: entry.cardId || "",
      imageUrl: entry.imageUrl || "",
      qty: entry.qty,
      role
    };
  }).filter((card) => card.cardKey));
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
  const snapshotZoneCounts = new Map<string, Map<string, number>>();
  const snapshotConfidence = new Map<string, DeckTrackerConfidence>();
  const eventInstances = new Map<string, Set<string>>();
  for (const observation of observations) {
    const observationAliases = deckTrackerIdentityAliases(observation);
    const matchedKey = observationAliases.map((alias) => aliases.get(alias)).find(Boolean);
    if (!matchedKey) {
      continue;
    }
    const count = Math.max(1, Math.floor(Number(observation.count) || 1));
    if (observation.source === "event") {
      const instanceKey = normalizeDeckTrackerKey(observation.frameId || [
        observation.zone,
        observation.cardId,
        observation.code,
        observation.name
      ].filter(Boolean).join(":"));
      const instances = eventInstances.get(matchedKey) ?? new Set<string>();
      if (instanceKey && instances.has(instanceKey)) {
        continue;
      }
      if (instanceKey) {
        instances.add(instanceKey);
        eventInstances.set(matchedKey, instances);
      }
      counts.set(matchedKey, (counts.get(matchedKey) ?? 0) + count);
      if (observation.confidence === "estimated" || !confidence.has(matchedKey)) {
        confidence.set(matchedKey, observation.confidence);
      }
      continue;
    }
    if (observation.source === "vision") {
      const zone = observation.zone || "unknown";
      const zoneCounts = snapshotZoneCounts.get(matchedKey) ?? new Map<string, number>();
      zoneCounts.set(zone, (zoneCounts.get(zone) ?? 0) + count);
      snapshotZoneCounts.set(matchedKey, zoneCounts);
      if (observation.confidence === "estimated" || !snapshotConfidence.has(matchedKey)) {
        snapshotConfidence.set(matchedKey, observation.confidence);
      }
      continue;
    }
    counts.set(matchedKey, (counts.get(matchedKey) ?? 0) + count);
    if (observation.confidence === "estimated" || !confidence.has(matchedKey)) {
      confidence.set(matchedKey, observation.confidence);
    }
  }
  for (const [matchedKey, zoneCounts] of snapshotZoneCounts) {
    const count = Math.max(...zoneCounts.values());
    counts.set(matchedKey, Math.max(counts.get(matchedKey) ?? 0, count));
    const nextConfidence = snapshotConfidence.get(matchedKey);
    if (nextConfidence && (nextConfidence === "estimated" || !confidence.has(matchedKey))) {
      confidence.set(matchedKey, nextConfidence);
    }
  }
  return { counts, confidence };
}

export function effectiveDeckTrackerCards(deck: SavedDeck | null, changes: DeckTrackerSideboardChange[] = []): MainDeckCard[] {
  const mainCards = mainDeckTrackerCards(deck);
  if (!changes.length) {
    return mainCards;
  }
  const sideboardCards = sideboardTrackerCards(deck);
  const allCards = [...mainCards, ...sideboardCards];
  const byKey = new Map<string, MainDeckCard>();
  const aliases = new Map<string, string>();
  for (const card of allCards) {
    if (!byKey.has(card.cardKey)) {
      byKey.set(card.cardKey, card);
    }
    for (const alias of card.aliases) {
      aliases.set(alias, card.cardKey);
    }
  }
  const effective = new Map<string, MainDeckCard>();
  for (const card of mainCards) {
    effective.set(card.cardKey, { ...card, role: "main" });
  }
  for (const change of normalizedSideboardChanges(changes)) {
    const matchedKey = matchSideboardCardKey(change, aliases);
    if (!matchedKey) {
      continue;
    }
    const template = byKey.get(matchedKey);
    if (!template) {
      continue;
    }
    const current = effective.get(matchedKey);
    const maxQty = Math.max(1, template.qty);
    if (change.direction === "out") {
      if (!current) {
        continue;
      }
      const nextQty = Math.max(0, current.qty - change.qty);
      if (nextQty <= 0) {
        effective.delete(matchedKey);
      } else {
        effective.set(matchedKey, { ...current, qty: nextQty });
      }
    } else {
      const nextQty = Math.min(maxQty + Math.max(0, current?.qty ?? 0), (current?.qty ?? 0) + change.qty);
      effective.set(matchedKey, {
        ...template,
        role: "sideboard",
        qty: Math.max(1, nextQty)
      });
    }
  }
  return [...effective.values()].filter((card) => card.qty > 0);
}

export function buildDeckTrackerSideboardState(
  deck: SavedDeck | null,
  changes: DeckTrackerSideboardChange[] = [],
  phase = "",
  gameNumber?: number
): DeckTrackerSideboardState {
  const normalized = normalizedSideboardChanges(changes);
  return {
    gameNumber,
    phase,
    autoDetected: normalized.some((change) => change.source === "atlas"),
    hasManualChanges: normalized.some((change) => change.source === "manual"),
    changes: normalized,
    mainOptions: mainDeckTrackerCards(deck).map(toSideboardOption),
    sideboardOptions: sideboardTrackerCards(deck).map(toSideboardOption)
  };
}

export function buildDeckTrackerState(options: DeckTrackerBuildOptions): DeckTrackerState {
  const updatedAt = options.updatedAt || new Date().toISOString();
  const sideboardState = buildDeckTrackerSideboardState(options.deck, options.sideboardChanges, options.sideboardPhase, options.sideboardGameNumber);
  const deckCards = effectiveDeckTrackerCards(options.deck, sideboardState.changes);
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
      role: card.role,
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
    return b.odds.next1 - a.odds.next1 ||
      b.copiesLeft - a.copiesLeft ||
      b.deckCount - a.deckCount ||
      a.name.localeCompare(b.name);
  });
  const confidence: DeckTrackerConfidence = finalCards.some((card) => card.confidence === "estimated") ? "estimated" : "tracked";
  return {
    active: true,
    reason: confidence === "estimated" ? "Estimated from visible card data. Use +/- for corrections." : "Tracking visible local cards.",
    deckId: options.deck.id,
    deckTitle: options.deck.title,
    deckLegend: options.deck.legend,
    opponentLegend: options.opponentLegend ?? "",
    platform: options.platform,
    confidence,
    deckSize,
    cardsLeft,
    seenCount,
    updatedAt,
    pinnedCards: [...pinned],
    corrections,
    cards: finalCards,
    sideboard: sideboardState,
    opponent: opponentTrackerState(options.opponentCards ?? [], options.opponentKnownCards ?? [], updatedAt)
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
    opponentLegend: "",
    platform,
    confidence: "estimated",
    deckSize: 0,
    cardsLeft: 0,
    seenCount: 0,
    updatedAt,
    pinnedCards: [],
    corrections: [],
    cards: [],
    sideboard: buildDeckTrackerSideboardState(deck ?? null),
    opponent: opponentTrackerState([], [], updatedAt)
  };
}

function opponentTrackerState(
  cards: DeckTrackerOpponentCardState[],
  knownCards: DeckTrackerOpponentCardState[],
  updatedAt: string
): DeckTrackerState["opponent"] {
  const sortedCards = sortOpponentTrackerCards(cards, "recent");
  const sortedKnownCards = sortOpponentTrackerCards(knownCards, "known");
  return {
    totalSeen: sortedCards.reduce((total, card) => total + card.count, 0),
    totalKnown: sortedKnownCards.reduce((total, card) => total + card.count, 0),
    updatedAt,
    knownCards: sortedKnownCards,
    cards: sortedCards
  };
}

function sortOpponentTrackerCards(cards: DeckTrackerOpponentCardState[], mode: "recent" | "known"): DeckTrackerOpponentCardState[] {
  return [...cards]
    .filter((card) => card.cardKey && card.count > 0 && !isOpponentTrackerNoiseCard(card))
    .sort((a, b) => mode === "known"
      ? b.count - a.count || new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime() || a.name.localeCompare(b.name)
      : new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime() || a.name.localeCompare(b.name));
}

function isOpponentTrackerNoiseCard(card: DeckTrackerOpponentCardState): boolean {
  const keys = [
    card.name,
    card.cardKey,
    card.code,
    card.cardId
  ].map((value) => normalizeDeckTrackerKey(value || "")).filter(Boolean);
  return keys.some((key) => key === "gold" || key === "goldtoken" || key === "resourcegold");
}

function combineTrackerCards(cards: MainDeckCard[]): MainDeckCard[] {
  const combined = new Map<string, MainDeckCard>();
  for (const card of cards) {
    const existing = combined.get(card.cardKey);
    if (!existing) {
      combined.set(card.cardKey, { ...card, aliases: [...new Set(card.aliases)] });
      continue;
    }
    combined.set(card.cardKey, {
      ...existing,
      aliases: [...new Set([...existing.aliases, ...card.aliases])],
      imageUrl: existing.imageUrl || card.imageUrl,
      cardId: existing.cardId || card.cardId,
      code: existing.code || card.code,
      qty: existing.qty + card.qty
    });
  }
  return [...combined.values()];
}

export function deckTrackerImageUrlFromId(value: string): string {
  const normalized = riftboundCanonicalArtCode(value);
  return normalized ? `https://cdn.piltoverarchive.com/cards/${normalized}.webp` : "";
}

function normalizedSideboardChanges(changes: DeckTrackerSideboardChange[]): DeckTrackerSideboardChange[] {
  return changes
    .map((change) => ({
      ...change,
      cardKey: normalizeDeckTrackerKey(change.cardKey || change.cardId || change.code || change.name),
      qty: Math.max(1, Math.min(8, Math.floor(Number(change.qty) || 1)))
    }))
    .filter((change) => change.cardKey && (change.direction === "in" || change.direction === "out"));
}

function matchSideboardCardKey(change: DeckTrackerSideboardChange, aliases: Map<string, string>): string {
  const candidates = deckTrackerIdentityAliases(change);
  return candidates.map((candidate) => aliases.get(candidate) || candidate).find((candidate) => aliases.has(candidate) || candidate === change.cardKey) ?? "";
}

function toSideboardOption(card: MainDeckCard): DeckTrackerSideboardCardOption {
  return {
    cardKey: card.cardKey,
    name: card.name,
    code: card.code,
    cardId: card.cardId,
    imageUrl: card.imageUrl,
    qty: card.qty,
    role: card.role
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
