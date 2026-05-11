import { describe, expect, it } from "vitest";
import {
  buildDeckTrackerState,
  chanceAtLeastOne,
  mainDeckTrackerCards,
  observationCountsForDeck
} from "../src/shared/deckTracker";
import type { DeckTrackerObservation, SavedDeck } from "../src/shared/types";

const deck: SavedDeck = {
  id: "deck-1",
  sourceUrl: "local:text",
  sourceKey: "deck:annie",
  title: "Annie test",
  legend: "Annie",
  snapshotJson: JSON.stringify({
    mainDeck: [
      { qty: 3, name: "Watchful Sentry", cardId: "OGN-028", imageUrl: "https://cards.test/OGN-028.webp" },
      { qty: 2, name: "Thermo Beam", imageUrl: "https://cards.test/OGN-176.webp" },
      { qty: 1, name: "Long Sword" }
    ],
    runes: [{ qty: 12, name: "Calm Rune" }],
    battlefields: [{ qty: 1, name: "Zaun Warrens" }],
    sideboard: [{ qty: 1, name: "Rebuke" }]
  }),
  lastImportedAt: "2026-05-08T10:00:00.000Z",
  lastRefreshStatus: "ok",
  lastRefreshError: ""
};

function observation(patch: Partial<DeckTrackerObservation>): DeckTrackerObservation {
  return {
    cardKey: patch.cardKey ?? "",
    name: patch.name ?? "",
    code: patch.code ?? "",
    cardId: patch.cardId ?? "",
    imageUrl: patch.imageUrl ?? "",
    zone: patch.zone ?? "hand",
    count: patch.count ?? 1,
    platform: patch.platform ?? "tcga",
    confidence: patch.confidence ?? "tracked",
    capturedAt: patch.capturedAt ?? "2026-05-08T10:00:01.000Z"
  };
}

describe("deck tracker", () => {
  it("extracts only the main deck for tracking", () => {
    expect(mainDeckTrackerCards(deck).map((card) => `${card.qty} ${card.name}`)).toEqual([
      "3 Watchful Sentry",
      "2 Thermo Beam",
      "1 Long Sword"
    ]);
  });

  it("matches observations by card id, image code, and normalized name", () => {
    const deckCards = mainDeckTrackerCards(deck);
    const { counts } = observationCountsForDeck([
      observation({ cardId: "OGN-028" }),
      observation({ imageUrl: "https://cdn.test/cards/OGN-176-full.png" }),
      observation({ name: "long sword" })
    ], deckCards);
    expect(counts.get(deckCards[0].cardKey)).toBe(1);
    expect(counts.get(deckCards[1].cardKey)).toBe(1);
    expect(counts.get(deckCards[2].cardKey)).toBe(1);
  });

  it("matches TCGA base card codes against imported variant ids", () => {
    const variantDeck: SavedDeck = {
      ...deck,
      snapshotJson: JSON.stringify({
        mainDeck: [
          { qty: 2, name: "Baron Nashor", cardId: "UNL-147a", imageUrl: "https://cards.test/UNL-147a.webp" }
        ]
      })
    };
    const deckCards = mainDeckTrackerCards(variantDeck);
    const { counts } = observationCountsForDeck([
      observation({ code: "UNL-147" })
    ], deckCards);
    expect(counts.get(deckCards[0].cardKey)).toBe(1);
  });

  it("calculates hypergeometric draw odds", () => {
    expect(chanceAtLeastOne(4, 40, 1)).toBeCloseTo(0.1, 5);
    expect(chanceAtLeastOne(4, 40, 2)).toBeCloseTo(0.1923, 3);
    expect(chanceAtLeastOne(0, 40, 3)).toBe(0);
  });

  it("layers manual corrections over observed cards and persists pins", () => {
    const cards = mainDeckTrackerCards(deck);
    const state = buildDeckTrackerState({
      deck,
      platform: "atlas",
      observedCounts: new Map([[cards[0].cardKey, 1]]),
      corrections: [{ cardKey: cards[0].cardKey, delta: 1, capturedAt: "2026-05-08T10:00:02.000Z" }],
      pinnedCards: [cards[0].cardKey],
      updatedAt: "2026-05-08T10:00:03.000Z"
    });
    const sentry = state.cards.find((card) => card.cardKey === cards[0].cardKey);
    expect(state.active).toBe(true);
    expect(sentry?.seenCount).toBe(2);
    expect(sentry?.copiesLeft).toBe(1);
    expect(sentry?.pinned).toBe(true);
  });
});
