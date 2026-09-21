import { describe, expect, it } from "vitest";
import { buildMulliganLabRegistry, type MulliganLabRegistryCard } from "../src/shared/mulliganLab";
import {
  completeMulliganPracticeHand,
  dealMulliganPracticeHand,
  parseMulliganPracticeDeck,
  type MulliganPracticeDeck
} from "../src/shared/mulliganPractice";

const art = "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-744x1039.png?accountingTag=RB";
const fixture = [
  { printId: "UNL-199", name: "LeBlanc, Deceiver", type: "Legend", champion: "LeBlanc" },
  ...Array.from({ length: 15 }, (_, index) => ({
    printId: `OGN-${String(index + 1).padStart(3, "0")}`,
    name: index === 0 ? "LeBlanc, Everywhere At Once" : index === 1 ? "Vi, Destructive" : index === 13 ? "LeBlanc, Fragmented" : `Card ${index + 1}`,
    type: index === 14 ? "Rune" : index === 12 ? "Gear" : index === 11 ? "Spell" : "Unit",
    supertype: [0, 1, 13].includes(index) ? "Champion" : null,
    champion: index === 1 ? "Vi" : [0, 13].includes(index) ? "LeBlanc" : null
  })),
  { printId: "OGN-001A", name: "LeBlanc, Everywhere At Once", type: "Unit", supertype: "Champion", champion: "LeBlanc" },
  { printId: "VEN-167", name: "Vi, Destructive", type: "Unit", supertype: "Champion", champion: "Vi" }
];
const registry = buildMulliganLabRegistry({ cards: fixture.map((card) => ({ ...card, imageUrl: art, costEnergy: 2, costPower: 0 })) });
const entries = () => Array.from({ length: 14 }, (_, index) => ({ cardId: `OGN-${String(index + 1).padStart(3, "0")}`, qty: index < 13 ? 3 : 1 }));
const snapshot = (extra: Record<string, unknown> = {}) => JSON.stringify({ legendCode: "UNL-199", mainDeck: entries(), chosenChampionCode: "OGN-001", ...extra });
function ready(json = snapshot(), chosen?: string): MulliganPracticeDeck {
  const result = parseMulliganPracticeDeck(json, registry, chosen);
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error(result.message);
  return result.deck;
}
const counts = (cards: MulliganLabRegistryCard[]) => cards.reduce<Record<string, number>>((result, card) => {
  result[card.code] = (result[card.code] ?? 0) + 1;
  return result;
}, {});
function seededRandom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

describe("exact saved-deck mulligan practice", () => {
  it("removes only one designated copy and preserves the original registered quantities", () => {
    const json = snapshot();
    const deck = ready(json);
    expect(deck.mainDeck.find((card) => card.code === "OGN-001")?.count).toBe(3);
    expect(deck.pool).toHaveLength(39);
    expect(deck.pool.filter((card) => card.code === "OGN-001")).toHaveLength(2);
    expect(json).toBe(snapshot());
  });

  it("supports Atlas 39 plus one separately registered Champion", () => {
    const deck = ready(snapshot({ mainDeck: entries().slice(0, -1), chosenChampionCode: undefined, champion: [{ cardCode: "OGN-014", count: 1 }] }));
    expect(deck.chosenChampion.code).toBe("OGN-014");
    expect(deck.mainDeck.reduce((total, card) => total + card.count, 0)).toBe(40);
    expect(deck.pool.some((card) => card.code === "OGN-014")).toBe(false);
  });

  it("accepts saved aliases and keeps exact alternate prints", () => {
    const main = entries().map(({ cardId, qty }) => ({ card_code: cardId === "OGN-001" ? "ogn-001a" : cardId, quantity: qty }));
    const deck = ready(JSON.stringify({ legend_entry: { card_id: "UNL-199" }, main_deck: main, chosen_champion: { card_id: "ogn-001a" } }));
    expect(deck.chosenChampion.code).toBe("OGN-001A");
    expect(deck.pool.filter((card) => card.code === "OGN-001A")).toHaveLength(2);
    expect(deck.pool.some((card) => card.code === "OGN-001")).toBe(false);
  });

  it("handles full40 snapshots with Champion section metadata without adding another copy", () => {
    const deck = ready(snapshot({ chosenChampionCode: undefined, champions: [{ cardId: "OGN-001", qty: 3 }] }));
    expect(deck.pool).toHaveLength(39);
    expect(deck.pool.filter((card) => card.code === "OGN-001")).toHaveLength(2);
  });

  it("asks for an explicit matching Champion when flattened imports lost the designation", () => {
    const json = snapshot({ chosenChampionCode: undefined });
    const result = parseMulliganPracticeDeck(json, registry);
    expect(result).toMatchObject({ status: "choose-champion", champions: [{ code: "OGN-001" }, { code: "OGN-014" }] });
    expect(ready(json, "OGN-014").chosenChampion.code).toBe("OGN-014");
    expect(parseMulliganPracticeDeck(json, registry, "OGN-002").status).toBe("unavailable");
  });

  it("resolves normalized saved Legend names using registry champion metadata", () => {
    expect(ready(snapshot({ legendCode: undefined, legend: "LeBlanc" })).chosenChampion.code).toBe("OGN-001");
    expect(parseMulliganPracticeDeck(snapshot({ legendCode: "OGN-002" }), registry).status).toBe("unavailable");
    expect(parseMulliganPracticeDeck(snapshot({ legendCode: undefined, legend: "Unknown" }), registry).status).toBe("unavailable");
  });

  it("rejects wrong-hero, absent and non-Champion saved designations", () => {
    for (const chosenChampionCode of ["OGN-002", "OGN-013", "OGN-099", "not-a-code"]) {
      expect(parseMulliganPracticeDeck(snapshot({ chosenChampionCode }), registry).status).toBe("unavailable");
    }
  });

  it("rejects missing, incomplete, unknown and non-main-deck cards", () => {
    for (const json of ["bad", "null", snapshot({ mainDeck: undefined }), snapshot({ mainDeck: entries().slice(0, -1) }),
      snapshot({ mainDeck: entries().map((card, index) => index === 13 ? { cardId: "OGN-999", qty: 1 } : card) }),
      snapshot({ mainDeck: entries().map((card, index) => index === 13 ? { cardId: "OGN-015", qty: 1 } : card) })]) {
      expect(parseMulliganPracticeDeck(json, registry).status).toBe("unavailable");
    }
  });

  it("does not infer or coerce bad quantities", () => {
    for (const qty of [undefined, 0, -1, 1.5, "3", 4, null]) {
      expect(parseMulliganPracticeDeck(snapshot({ mainDeck: entries().map((entry, index) => index === 0 ? { ...entry, qty } : entry) }), registry).status).toBe("unavailable");
    }
  });

  it("combines split rows while rejecting more than three copies across print variants or sets", () => {
    expect(ready(snapshot({ mainDeck: [...entries().slice(1), { cardId: "OGN-001", qty: 1 }, { cardId: "OGN-001", qty: 2 }] })).pool).toHaveLength(39);
    for (const cardId of ["OGN-001A", "VEN-167"]) {
      expect(parseMulliganPracticeDeck(snapshot({ mainDeck: entries().map((entry, index) => index === 13 ? { cardId, qty: 1 } : entry) }), registry).status).toBe("unavailable");
    }
  });

  it("ignores sideboard, runes and battlefields in the draw pool", () => {
    const deck = ready(snapshot({ sideboard: [{ cardId: "OGN-099", qty: 8 }], runes: [{ cardId: "OGN-015", qty: 12 }], battlefields: [{ cardId: "OGN-098", qty: 3 }] }));
    expect(deck.pool).toHaveLength(39);
    expect(deck.pool.every((card) => !["OGN-015", "OGN-098", "OGN-099"].includes(card.code))).toBe(true);
  });

  it("deals four and allows duplicate copies that actually remain after setup", () => {
    const deck = ready();
    const before = [...deck.pool];
    const hand = dealMulliganPracticeHand(deck, () => 0.9999999);
    expect(hand.cards).toHaveLength(4);
    expect(hand.cards.filter((card) => card.code === "OGN-001")).toHaveLength(2);
    expect(hand.remaining).toHaveLength(35);
    expect(counts([...hand.cards, ...hand.remaining])).toEqual(counts(deck.pool));
    expect(deck.pool).toEqual(before);
  });

  it("keeps all four without consuming any new cards", () => {
    const hand = dealMulliganPracticeHand(ready(), seededRandom(22));
    expect(completeMulliganPracticeHand(hand, [], () => { throw new Error("No random source needed"); }))
      .toEqual({ ...hand, redrawnIndexes: [], replacements: [] });
  });

  it("draws from the next35 before recycling selected cards to the bottom", () => {
    const hand = dealMulliganPracticeHand(ready(), seededRandom(14));
    const before = structuredClone(hand);
    const result = completeMulliganPracticeHand(hand, [3, 0], () => 0);
    expect(result.redrawnIndexes).toEqual([0, 3]);
    expect(result.cards).toEqual([hand.remaining[0], hand.cards[1], hand.cards[2], hand.remaining[1]]);
    expect(result.replacements).toEqual(hand.remaining.slice(0, 2));
    expect(result.remaining).toEqual([...hand.remaining.slice(2), hand.cards[3], hand.cards[0]]);
    expect(hand).toEqual(before);
  });

  it("preserves physical copy counts across many independent hands and redraw choices", () => {
    const deck = ready();
    const expected = counts(deck.pool);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 500; seed += 1) {
      const rng = seededRandom(seed);
      const hand = dealMulliganPracticeHand(deck, rng);
      for (const card of hand.cards) seen.add(card.code);
      const result = completeMulliganPracticeHand(hand, seed % 3 === 0 ? [] : seed % 3 === 1 ? [1] : [0, 3], rng);
      expect(result.cards).toHaveLength(4);
      expect(result.remaining).toHaveLength(35);
      expect(counts([...result.cards, ...result.remaining])).toEqual(expected);
    }
    expect([...seen].sort()).toEqual([...new Set(deck.pool.map((card) => card.code))].sort());
  });

  it("rejects illegal redraws, malformed hand sizes and invalid randomness", () => {
    const deck = ready();
    const hand = dealMulliganPracticeHand(deck, seededRandom(5));
    for (const indexes of [[0, 1, 2], [1, 1], [-1], [4], [1.5], [NaN]]) expect(() => completeMulliganPracticeHand(hand, indexes)).toThrow();
    expect(() => completeMulliganPracticeHand({ cards: [], remaining: hand.remaining }, [])).toThrow();
    expect(() => dealMulliganPracticeHand({ ...deck, pool: deck.pool.slice(1) })).toThrow();
    for (const value of [NaN, Infinity, -0.1, 1]) expect(() => dealMulliganPracticeHand(deck, () => value)).toThrow();
  });
});
