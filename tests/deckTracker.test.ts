import { describe, expect, it } from "vitest";
import {
  buildDeckTrackerState,
  chanceAtLeastOne,
  deckTrackerImageUrlFromId,
  effectiveDeckTrackerCards,
  mainDeckTrackerCards,
  observationCountsForDeck,
  sideboardTrackerCards
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
    capturedAt: patch.capturedAt ?? "2026-05-08T10:00:01.000Z",
    source: patch.source
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

  it("matches a signed observed card against a base-print deck entry", () => {
    const baseDeck: SavedDeck = {
      ...deck,
      snapshotJson: JSON.stringify({
        mainDeck: [
          { qty: 2, name: "Jhin, Meticulous Killer", cardId: "UNL-089", imageUrl: "https://cards.test/UNL-089.webp" }
        ]
      })
    };
    const deckCards = mainDeckTrackerCards(baseDeck);
    const { counts } = observationCountsForDeck([
      observation({ code: "UNL-089A" })
    ], deckCards);
    expect(counts.get(deckCards[0].cardKey)).toBe(1);
  });

  it("extracts and aliases signed set-specific rune identifiers", () => {
    const runePrintDeck: SavedDeck = {
      ...deck,
      snapshotJson: JSON.stringify({
        mainDeck: [
          { qty: 2, name: "Order Rune", cardId: "SFD-R06", imageUrl: "https://cards.test/SFD-R06.webp" }
        ]
      })
    };
    const deckCards = mainDeckTrackerCards(runePrintDeck);
    const { counts } = observationCountsForDeck([
      observation({ imageUrl: "https://cards.test/SFD-R06B.webp" })
    ], deckCards);
    expect(counts.get(deckCards[0].cardKey)).toBe(1);
  });

  it("uses base-print artwork when a signed card is observed", () => {
    expect(deckTrackerImageUrlFromId("UNL-089A"))
      .toBe("https://cdn.piltoverarchive.com/cards/UNL-089.webp");
    expect(deckTrackerImageUrlFromId("SFD-R06B"))
      .toBe("https://cdn.piltoverarchive.com/cards/OGN-214.webp");
  });

  it("treats event observations as visible snapshots instead of double-counting zones", () => {
    const deckCards = mainDeckTrackerCards(deck);
    const { counts } = observationCountsForDeck([
      observation({ cardId: "OGN-028", zone: "hand", source: "event" }),
      observation({ cardId: "OGN-028", zone: "hand", source: "event" }),
      observation({ cardId: "OGN-028", zone: "board", source: "event" })
    ], deckCards);
    expect(counts.get(deckCards[0].cardKey)).toBe(2);
  });

  it("calculates hypergeometric draw odds", () => {
    expect(chanceAtLeastOne(4, 40, 1)).toBeCloseTo(0.1, 5);
    expect(chanceAtLeastOne(4, 40, 2)).toBeCloseTo(0.1923, 3);
    expect(chanceAtLeastOne(3, 30, 1)).toBeCloseTo(0.1, 5);
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

  it("carries opponent seen cards without affecting my deck odds", () => {
    const state = buildDeckTrackerState({
      deck,
      platform: "atlas",
      opponentLegend: "Irelia",
      opponentCards: [
        {
          cardKey: "gold",
          name: "Gold",
          code: "",
          cardId: "",
          imageUrl: "",
          count: 3,
          zones: ["base"],
          firstSeenAt: "2026-05-08T10:00:00.000Z",
          lastSeenAt: "2026-05-08T10:04:01.000Z",
          confidence: "tracked"
        },
        {
          cardKey: "sfd128",
          name: "Overzealous Fan",
          code: "SFD-128",
          cardId: "SFD-128",
          imageUrl: "https://cards.test/SFD-128.webp",
          count: 2,
          zones: ["board", "trash"],
          firstSeenAt: "2026-05-08T10:00:01.000Z",
          lastSeenAt: "2026-05-08T10:03:01.000Z",
          confidence: "tracked"
        }
      ],
      updatedAt: "2026-05-08T10:03:02.000Z"
    });
    expect(state.cardsLeft).toBe(6);
    expect(state.opponentLegend).toBe("Irelia");
    expect(state.opponent.totalSeen).toBe(2);
    expect(state.opponent.cards).toHaveLength(1);
    expect(state.opponent.cards[0]).toMatchObject({
      name: "Overzealous Fan",
      zones: ["board", "trash"]
    });
  });

  it("uses sideboard changes to build the effective deck for games 2 and 3", () => {
    const mainCards = mainDeckTrackerCards(deck);
    const sideboardCards = sideboardTrackerCards(deck);
    const longSword = mainCards.find((card) => card.name === "Long Sword");
    const rebuke = sideboardCards.find((card) => card.name === "Rebuke");
    expect(longSword).toBeTruthy();
    expect(rebuke).toBeTruthy();

    const cards = effectiveDeckTrackerCards(deck, [
      {
        id: "manual-out-long-sword",
        cardKey: longSword!.cardKey,
        name: longSword!.name,
        code: longSword!.code,
        cardId: longSword!.cardId,
        imageUrl: longSword!.imageUrl,
        qty: 1,
        direction: "out",
        source: "manual",
        gameNumber: 2,
        capturedAt: "2026-05-08T10:00:04.000Z"
      },
      {
        id: "manual-in-rebuke",
        cardKey: rebuke!.cardKey,
        name: rebuke!.name,
        code: rebuke!.code,
        cardId: rebuke!.cardId,
        imageUrl: rebuke!.imageUrl,
        qty: 1,
        direction: "in",
        source: "manual",
        gameNumber: 2,
        capturedAt: "2026-05-08T10:00:05.000Z"
      }
    ]);
    expect(cards.find((card) => card.name === "Long Sword")).toBeUndefined();
    expect(cards.find((card) => card.name === "Rebuke")).toMatchObject({
      qty: 1,
      role: "sideboard"
    });

    const state = buildDeckTrackerState({
      deck,
      platform: "atlas",
      sideboardChanges: [
        {
          id: "manual-out-long-sword",
          cardKey: longSword!.cardKey,
          name: longSword!.name,
          code: longSword!.code,
          cardId: longSword!.cardId,
          imageUrl: longSword!.imageUrl,
          qty: 1,
          direction: "out",
          source: "manual",
          gameNumber: 2,
          capturedAt: "2026-05-08T10:00:04.000Z"
        },
        {
          id: "manual-in-rebuke",
          cardKey: rebuke!.cardKey,
          name: rebuke!.name,
          code: rebuke!.code,
          cardId: rebuke!.cardId,
          imageUrl: rebuke!.imageUrl,
          qty: 1,
          direction: "in",
          source: "manual",
          gameNumber: 2,
          capturedAt: "2026-05-08T10:00:05.000Z"
        }
      ]
    });
    expect(state.deckSize).toBe(6);
    expect(state.sideboard.hasManualChanges).toBe(true);
    expect(state.cards.some((card) => card.name === "Long Sword")).toBe(false);
  });
});
