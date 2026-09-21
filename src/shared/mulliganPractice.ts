import { normalizeLegendName } from "./legendNames.js";
import type { MulliganLabRegistry, MulliganLabRegistryCard } from "./mulliganLab.js";

export interface MulliganPracticeDeck {
  mainDeck: Array<MulliganLabRegistryCard & { count: number }>;
  chosenChampion: MulliganLabRegistryCard;
  pool: MulliganLabRegistryCard[];
}

export type MulliganPracticeDeckResult =
  | { status: "ready"; deck: MulliganPracticeDeck }
  | { status: "choose-champion"; message: string; champions: MulliganLabRegistryCard[] }
  | { status: "unavailable"; message: string };

export interface MulliganPracticeHand {
  cards: MulliganLabRegistryCard[];
  remaining: MulliganLabRegistryCard[];
}

export interface MulliganPracticeResult extends MulliganPracticeHand {
  redrawnIndexes: number[];
  replacements: MulliganLabRegistryCard[];
}

type Random = () => number;
type JsonRecord = Record<string, unknown>;

/** Saved-deck input only: no community hands, name guesses or inferred card quantities. */
export function parseMulliganPracticeDeck(
  snapshotJson: string,
  registry: MulliganLabRegistry,
  chosenChampionCode?: string
): MulliganPracticeDeckResult {
  let snapshot: JsonRecord | null;
  try {
    snapshot = snapshotJson.length <= 500_000 ? record(JSON.parse(snapshotJson)) : null;
  } catch {
    snapshot = null;
  }
  if (!snapshot) return unavailable("This saved deck could not be read. Refresh or re-import the deck to practise with it.");
  const rawMain = snapshot.mainDeck ?? snapshot.main_deck ?? snapshot.maindeck;
  const main = parseEntries(rawMain, registry);
  if (!main) return unavailable("Some main-deck cards or quantities are missing or unknown. Refresh or re-import the complete deck to practise with it.");

  const championValue = snapshot.champion ?? snapshot.champions;
  const rawChampions = championValue === undefined || championValue === null
    ? []
    : Array.isArray(championValue) ? championValue : [championValue];
  const championEntries = parseEntries(rawChampions, registry);
  if (!championEntries || championEntries.some((entry) => !isChampion(entry.card))) {
    return unavailable("The saved Champion section could not be read. Refresh or re-import the deck with its Chosen Champion.");
  }

  const mainCount = quantity(main);
  const included = mainCount === 40 ? main : mainCount === 39 && quantity(championEntries) === 1 ? [...main, ...championEntries] : [];
  if (!included.length) return unavailable(`This saved deck has ${mainCount} main-deck cards. Practice needs all 40 registered cards, including the Chosen Champion. Refresh or re-import the complete deck.`);

  const counts = new Map<string, { card: MulliganLabRegistryCard; count: number }>();
  const identityCounts = new Map<string, number>();
  for (const entry of included) {
    const count = (counts.get(entry.card.code)?.count ?? 0) + entry.count;
    const identity = entry.card.name.trim().toLowerCase().replace(/\s*\(starter\)$/, "");
    const identityCount = (identityCounts.get(identity) ?? 0) + entry.count;
    if (identityCount > 3) return unavailable(`${entry.card.name} has more than three registered copies. Check the saved deck before practising.`);
    counts.set(entry.card.code, { card: entry.card, count });
    identityCounts.set(identity, identityCount);
  }
  const legendChampion = savedLegendChampion(snapshot, registry);
  if (!legendChampion) return unavailable("The saved Legend could not be identified. Refresh or re-import the complete deck, including its Legend.");
  const champions = [...counts.values()].map((entry) => entry.card)
    .filter((card) => isChampion(card) && card.champion?.toLowerCase() === legendChampion.toLowerCase());
  if (!champions.length) return unavailable("No Champion unit matching this deck's Legend was found. Refresh or re-import the deck with its Chosen Champion.");

  const savedDesignation = snapshot.chosenChampionCode ?? snapshot.chosen_champion_code
    ?? snapshot.chosenChampion ?? snapshot.chosen_champion;
  const designatedCode = savedDesignation === undefined || savedDesignation === null
    ? "" : typeof savedDesignation === "string" ? code(savedDesignation) : entryCode(record(savedDesignation));
  if (savedDesignation !== undefined && savedDesignation !== null && !designatedCode) {
    return unavailable("The saved Chosen Champion could not be identified. Refresh or re-import the deck with its Chosen Champion.");
  }
  const sectionCodes = [...new Set(championEntries.map((entry) => entry.card.code))];
  const chosenCode = chosenChampionCode !== undefined ? code(chosenChampionCode) : designatedCode || (sectionCodes.length === 1 ? sectionCodes[0] : "");
  if (!chosenCode && chosenChampionCode === undefined) {
    return { status: "choose-champion", message: "Choose the Champion you start face up. This saved deck does not record that choice.", champions };
  }
  const chosenChampion = champions.find((card) => card.code === chosenCode);
  if (!chosenChampion) return unavailable("The Chosen Champion must match your Legend and be in this exact saved main deck. Refresh the deck or choose one of its matching Champion units.");
  const mainDeck = [...counts.values()].map(({ card, count }) => ({ ...card, count }));
  const pool = mainDeck.flatMap((card) => Array.from(
    { length: card.count - (card.code === chosenCode ? 1 : 0) },
    () => registry.byCode.get(card.code)!
  ));
  return { status: "ready", deck: { mainDeck, chosenChampion, pool } };
}

/** Four opening cards from the 39-card deck after moving one Champion face up. */
export function dealMulliganPracticeHand(deck: MulliganPracticeDeck, random: Random = Math.random): MulliganPracticeHand {
  if (deck.pool.length !== 39) throw new Error("Practice requires a 39-card draw pile after setting aside the Chosen Champion.");
  const shuffled = shuffle(deck.pool, random);
  return { cards: shuffled.slice(0, 4), remaining: shuffled.slice(4) };
}

/** Set aside up to two, draw replacements, then recycle the set-aside cards (Core Rules 117). */
export function completeMulliganPracticeHand(
  hand: MulliganPracticeHand,
  redrawIndexes: number[],
  random: Random = Math.random
): MulliganPracticeResult {
  if (hand.cards.length !== 4 || hand.remaining.length !== 35) throw new Error("Practice requires four opening cards and 35 remaining cards.");
  if (redrawIndexes.length > 2 || new Set(redrawIndexes).size !== redrawIndexes.length
    || redrawIndexes.some((index) => !Number.isInteger(index) || index < 0 || index > 3)) {
    throw new Error("Choose up to two different opening cards to redraw.");
  }
  const indexes = [...redrawIndexes].sort((left, right) => left - right);
  const replacements = hand.remaining.slice(0, indexes.length);
  const cards = [...hand.cards];
  indexes.forEach((index, offset) => { cards[index] = replacements[offset]; });
  const recycled = shuffle(indexes.map((index) => hand.cards[index]), random);
  return { cards, redrawnIndexes: indexes, replacements, remaining: [...hand.remaining.slice(indexes.length), ...recycled] };
}

function shuffle<T>(values: readonly T[], random: Random): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("Random source must return a value between zero (inclusive) and one (exclusive).");
    const swap = Math.floor(value * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function parseEntries(raw: unknown, registry: MulliganLabRegistry): Array<{ card: MulliganLabRegistryCard; count: number }> | null {
  if (!Array.isArray(raw) || raw.length > 80) return null;
  const entries: Array<{ card: MulliganLabRegistryCard; count: number }> = [];
  for (const value of raw) {
    const entry = record(value);
    const card = registry.byCode.get(entryCode(entry));
    const count = entry?.qty ?? entry?.quantity ?? entry?.count;
    if (!card || !["unit", "spell", "gear"].includes(card.type.toLowerCase())
      || typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 3) return null;
    entries.push({ card, count });
  }
  return entries;
}

function isChampion(card: MulliganLabRegistryCard): boolean {
  return card.type.toLowerCase() === "unit" && card.supertype?.toLowerCase() === "champion";
}

function savedLegendChampion(snapshot: JsonRecord, registry: MulliganLabRegistry): string {
  const legendEntry = record(snapshot.legendEntry ?? snapshot.legend_entry);
  const explicitCode = snapshot.legendCode ?? snapshot.legend_code ?? (legendEntry ? entryCode(legendEntry) : undefined);
  if (explicitCode) {
    const legend = registry.byCode.get(code(explicitCode));
    return legend?.type.toLowerCase() === "legend" ? legend.champion ?? "" : "";
  }
  const savedName = snapshot.legend ?? snapshot.legendName ?? snapshot.legend_name ?? snapshot.legendKey ?? snapshot.legend_key ?? legendEntry?.name;
  if (typeof savedName !== "string" || !savedName.trim()) return "";
  const name = normalizeLegendName(savedName).toLowerCase();
  const identities = new Set([...registry.byCode.values()]
    .filter((card) => card.type.toLowerCase() === "legend"
      && (normalizeLegendName(card.name).toLowerCase() === name || card.champion?.toLowerCase() === name))
    .map((card) => card.champion).filter((value): value is string => Boolean(value)));
  return identities.size === 1 ? [...identities][0] : "";
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function code(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2,5}-(?:(?:SP|R|T)\d{1,4}|\d{1,4})[A-Z]?(?:\*)?$/.test(normalized) ? normalized : "";
}

function entryCode(entry: JsonRecord | null): string {
  return code(entry?.cardId ?? entry?.card_id ?? entry?.code ?? entry?.cardCode ?? entry?.card_code ?? entry?.printId);
}

function quantity(entries: Array<{ count: number }>): number {
  return entries.reduce((total, entry) => total + entry.count, 0);
}

function unavailable(message: string): MulliganPracticeDeckResult {
  return { status: "unavailable", message };
}
