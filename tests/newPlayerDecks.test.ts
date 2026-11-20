import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DeckService } from "../src/main/services/deckService";
import type { RiftLiteStore } from "../src/main/services/store";
import {
  NEW_PLAYER_DECKS,
  NEW_PLAYER_DECK_BAN_UPDATE,
  getNewPlayerDeck,
  getNewPlayerDeckReadiness,
  newPlayerDeckAtlasText,
  type NewPlayerDeckCard
} from "../src/shared/newPlayerDecks";
import type { DeckImportChoice, SavedDeck } from "../src/shared/types";

vi.mock("electron", () => ({ app: { getVersion: () => "new-player-deck-test" } }));

const registry = JSON.parse(readFileSync(resolve("resources/riftbound_card_registry.json"), "utf8")) as {
  cards: Array<{ printId: string; name: string; type: string; supertype?: string; tags?: string[] }>;
};
const registryByPrint = new Map(registry.cards.map(card => [card.printId.toLowerCase(), card]));
const normalName = (name: string) => name.normalize("NFKC").replace(/[’‘]/g, "'").toLowerCase();
const bannedNames = new Set([
  "Called Shot", "Ekko, Recurrent", "Draven, Vanquisher", "Fight or Flight", "Scrapheap", "Stealthy Pursuer", "Stacked Deck",
  "The Arena's Greatest", "Aspirant's Climb", "The Dreaming Tree", "Dreaming Tree", "Obelisk of Power", "Reaver's Row"
].map(normalName));

function quantities(cards: readonly { name: string; quantity: number }[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const card of cards) result[card.name] = (result[card.name] ?? 0) + card.quantity;
  return result;
}

describe("dated Piltover beginner deck snapshots", () => {
  it("keeps explicit primary sources, authors and dated popularity rather than a manufactured ranking", () => {
    expect(NEW_PLAYER_DECKS).toHaveLength(5);
    expect(new Set(NEW_PLAYER_DECKS.map(deck => deck.id)).size).toBe(5);
    for (const deck of NEW_PLAYER_DECKS) {
      expect(deck.sourceUrl).toMatch(/^https:\/\/piltoverarchive\.com\/decks\/view\/[0-9a-f-]{36}$/);
      expect(deck.author).not.toBe("");
      expect(deck.sourceEvidence).toMatchObject({ selection: "Trending", observedAt: "2026-11-11" });
      expect(deck.sourceEvidence.likes).toBeGreaterThan(0);
      expect(deck.sourceEvidence.views).toBeGreaterThan(0);
      expect(deck.sourceUpdatedAt >= "2026-10-23").toBe(true);
      expect(getNewPlayerDeck(deck.id)).toBe(deck);
    }
    expect(NEW_PLAYER_DECKS.slice(0, 4).every(deck => deck.difficulty !== "Advanced")).toBe(true);
    expect(NEW_PLAYER_DECKS.slice(4).every(deck => deck.difficulty === "Advanced")).toBe(true);
    expect(getNewPlayerDeck("untrusted-or-removed-id")).toBeUndefined();
  });

  it.each(NEW_PLAYER_DECKS)("$champion keeps registry identities, legal quantities and its chosen champion", deck => {
    const cards = Object.values(deck.cards).flat() as NewPlayerDeckCard[];
    for (const card of cards) {
      const record = registryByPrint.get(card.registryPrintId.toLowerCase());
      expect(record, `Missing registry print ${card.registryPrintId}`).toBeDefined();
      expect(normalName(record!.name), card.printId).toBe(normalName(card.name));
      expect(bannedNames.has(normalName(card.name)), card.name).toBe(false);
      expect(Number.isInteger(card.quantity) && card.quantity > 0).toBe(true);
    }
    const total = (entries: readonly NewPlayerDeckCard[]) => entries.reduce((sum, card) => sum + card.quantity, 0);
    expect(total(deck.cards.legend)).toBe(1);
    expect(total(deck.cards.champion)).toBe(1);
    expect(total(deck.cards.mainDeck) + total(deck.cards.champion)).toBe(40);
    expect(total(deck.cards.runes)).toBe(12);
    expect(total(deck.cards.battlefields)).toBe(3);
    expect(new Set(deck.cards.battlefields.map(card => card.name)).size).toBe(3);
    expect(total(deck.cards.sideboard)).toBe(10);
    const mainAndSide = [...deck.cards.champion, ...deck.cards.mainDeck, ...deck.cards.sideboard];
    for (const [name, count] of Object.entries(quantities(mainAndSide))) expect(count, name).toBeLessThanOrEqual(3);
    const signatures = mainAndSide.filter(card => registryByPrint.get(card.registryPrintId.toLowerCase())?.supertype === "Signature");
    expect(total(signatures)).toBeLessThanOrEqual(3);
    const chosen = registryByPrint.get(deck.cards.champion[0].registryPrintId.toLowerCase())!;
    expect(chosen.type).toBe("Unit");
    expect(chosen.supertype).toBe("Champion");
    expect(chosen.tags).toContain(deck.champion);
  });

  it.each(NEW_PLAYER_DECKS)("$champion imports all 40 cards through the existing RiftLite importer and preserves duplicate decisions", async deck => {
    let payload: Omit<SavedDeck, "id" | "lastImportedAt"> | undefined;
    let receivedChoice: DeckImportChoice | undefined;
    const importSavedDeck = vi.fn(async (incoming: Omit<SavedDeck, "id" | "lastImportedAt">, choice?: DeckImportChoice) => {
      payload = incoming;
      receivedChoice = choice;
      return { status: "duplicate" as const, decks: [{ id: "existing-deck", title: "My own saved name" }], suggestedTitle: incoming.title };
    });
    const service = new DeckService({ importSavedDeck } as unknown as RiftLiteStore);
    const result = await service.importDeckText(deck.deckText);
    expect(result.status).toBe("duplicate");
    expect(importSavedDeck).toHaveBeenCalledTimes(1);
    expect(receivedChoice).toBeUndefined();
    expect(payload?.title).toBe(deck.title);
    const snapshot = JSON.parse(payload!.snapshotJson) as Record<string, Array<{ name: string; qty: number }>>;
    const imported = (section: string) => quantities(snapshot[section].map(card => ({ name: card.name, quantity: card.qty })));
    expect(imported("mainDeck")).toEqual(quantities([...deck.cards.champion, ...deck.cards.mainDeck]));
    expect(imported("runes")).toEqual(quantities(deck.cards.runes));
    expect(imported("battlefields")).toEqual(quantities(deck.cards.battlefields));
    expect(imported("sideboard")).toEqual(quantities(deck.cards.sideboard));
    const choice: DeckImportChoice = { mode: "separate", title: "My learning copy" };
    await service.importDeckText(deck.deckText, choice);
    expect(receivedChoice).toEqual(choice);
  });

  it.each(NEW_PLAYER_DECKS)("$champion exports an explicit Atlas Champion slot without duplicating it in MainDeck", deck => {
    const text = newPlayerDeckAtlasText(deck);
    expect(text).toBe(deck.atlasDeckText);
    const sections = Object.fromEntries(text.split("\n\n").map(block => {
      const [heading, ...entries] = block.split("\n");
      return [heading, entries.map(line => {
        const match = /^(\d+) (.+)$/.exec(line);
        expect(match).not.toBeNull();
        return { quantity: Number(match![1]), name: match![2] };
      })];
    }));
    expect(Object.keys(sections)).toEqual(["Legend:", "Champion:", "MainDeck:", "Battlefields:", "Runes:", "Sideboard:"]);
    expect(quantities(sections["Champion:"])).toEqual(quantities(deck.cards.champion));
    expect(quantities(sections["MainDeck:"])).toEqual(quantities(deck.cards.mainDeck));
    expect(sections["MainDeck:"].reduce((sum, card) => sum + card.quantity, 0)).toBe(39);
    expect(quantities(sections["Sideboard:"])).toEqual(quantities(deck.cards.sideboard));
    expect(text).not.toMatch(/\[[A-Z]+-[A-Za-z0-9]+\]/);
  });
});

describe("beginner deck handoff across the announced November ban date", () => {
  const before = new Date(2026, 10, 22, 23, 59, 59);
  const effective = new Date(2026, 10, 23, 0, 0, 0);

  it("shows an upcoming change without claiming the affected cards are already banned", () => {
    const kaisa = getNewPlayerDeckReadiness(getNewPlayerDeck("pa-kaisa")!, new Date(2026, 10, 14));
    expect(kaisa).toMatchObject({ status: "upcoming-change", canUseSnapshot: true, affectedCards: [{ name: "Brynhir Thundersong", quantity: 3 }] });
    expect(kaisa.title).toBe("Changes from 23 November 2026");
    expect(kaisa.explanation).toContain("will then be banned");
    expect(NEW_PLAYER_DECK_BAN_UPDATE.regionalNote).toContain("Korea and Traditional Chinese");
  });

  it.each(["pa-kaisa", "pa-kennen"])("%s stops recommending the saved export on the effective local calendar date", id => {
    const deck = getNewPlayerDeck(id)!;
    expect(getNewPlayerDeckReadiness(deck, before).canUseSnapshot).toBe(true);
    const after = getNewPlayerDeckReadiness(deck, effective);
    expect(after).toMatchObject({ status: "needs-update", canUseSnapshot: false });
    expect(after.alternativeDeckIds).toEqual(["pa-ksante", "pa-jarvan", "pa-mordekaiser"]);
    expect(after.explanation).toContain("Piltover Archive");
    expect(getNewPlayerDeckReadiness(deck, new Date(2027, 0, 1)).canUseSnapshot).toBe(false);
  });

  it("checks all sections, quantities and curly apostrophes, including sideboard and battlefields", () => {
    const baseline = getNewPlayerDeck("pa-ksante")!;
    const altered = { ...baseline, cards: { ...baseline.cards, sideboard: [{ name: "Zhonya’s Hourglass", quantity: 2, printId: "test", registryPrintId: "test" }], battlefields: [{ name: "Emperor’s Dais", quantity: 1, printId: "test", registryPrintId: "test" }] } };
    expect(getNewPlayerDeckReadiness(altered, effective).affectedCards).toEqual([
      { name: "Emperor’s Dais", quantity: 1 }, { name: "Zhonya’s Hourglass", quantity: 2 }
    ]);
    expect(NEW_PLAYER_DECK_BAN_UPDATE.cardNames).toHaveLength(10);
    const kennen = getNewPlayerDeckReadiness(getNewPlayerDeck("pa-kennen")!, effective);
    expect(kennen.affectedCards).toEqual([{ name: "Rhasa the Sunderer", quantity: 3 }, { name: "Nocturne, Horrifying", quantity: 3 }]);
  });

  it.each(["pa-ksante", "pa-jarvan", "pa-mordekaiser"])("%s remains a dated recommendation with no cards in this announcement", id => {
    const status = getNewPlayerDeckReadiness(getNewPlayerDeck(id)!, effective);
    expect(status).toMatchObject({ status: "dated-snapshot", canUseSnapshot: true, affectedCards: [] });
    expect(status.explanation).toContain("future updates");
    expect(getNewPlayerDeck(id)!.legalityReview.status).not.toContain("current ban list");
  });

  it("does not invent an announcement before its publication or a legality result with an invalid date", () => {
    const deck = getNewPlayerDeck("pa-kaisa")!;
    expect(getNewPlayerDeckReadiness(deck, new Date(2026, 10, 12))).toMatchObject({ status: "dated-snapshot", affectedCards: [] });
    expect(getNewPlayerDeckReadiness(deck, new Date(Number.NaN))).toMatchObject({ status: "check-date", canUseSnapshot: false });
  });
});
