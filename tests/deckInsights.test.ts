import { describe, expect, it } from "vitest";
import {
  buildDeckInsightCardReviewSignal,
  buildDeckInsightComposition,
  buildDeckInsightPerformance,
  deckInsightCardEligibility,
  deckInsightCardIdentityKeys,
  deckInsightSampleTier
} from "../src/shared/deckInsights";
import type { MulliganLabRegistryCard } from "../src/shared/mulliganLab";
import type { ReplayInsightCardReport } from "../src/shared/replayInsights";
import type { MatchDraft, SavedDeck } from "../src/shared/types";

const registry: MulliganLabRegistryCard[] = [
  { code: "OGS-001", name: "Akali, Rogue Assassin", type: "Legend", supertype: "Akali", imageUrl: "legend.webp", costEnergy: null, costPower: null },
  { code: "OGS-002", name: "Akali, Deadly Weapon", type: "Unit", supertype: "Champion", imageUrl: "champion.webp", costEnergy: 4, costPower: 2 },
  { code: "OGS-010", name: "Disciple", type: "Unit", supertype: "", imageUrl: "disciple.webp", costEnergy: 2, costPower: 1 },
  { code: "ALT-172", name: "Disciple", type: "Unit", supertype: "", imageUrl: "disciple-alt.webp", costEnergy: 2, costPower: 1 },
  { code: "OGS-011", name: "Charm", type: "Spell", supertype: "", imageUrl: "charm.webp", costEnergy: 2, costPower: 0 },
  { code: "OGS-012", name: "Late Threat", type: "Unit", supertype: "", imageUrl: "late.webp", costEnergy: 7, costPower: 3 },
  { code: "OGS-020", name: "Sideboard Answer", type: "Gear", supertype: "", imageUrl: "side.webp", costEnergy: 3, costPower: 1 },
  { code: "OGS-030", name: "Back-Alley Bar", type: "Battlefield", supertype: "", imageUrl: "field.webp", costEnergy: null, costPower: null },
  { code: "OGS-099", name: "Mystery Card", type: "Spell", supertype: "", imageUrl: "mystery.webp", costEnergy: null, costPower: null }
];

const deck: SavedDeck = {
  id: "deck-akali",
  sourceUrl: "https://example.test/decks/akali",
  sourceKey: "test:akali",
  title: "Akali Tempo",
  legend: "Akali",
  snapshotJson: JSON.stringify({
    title: "Akali Tempo",
    legend: "Akali",
    legendEntry: { qty: 1, name: "Akali, Rogue Assassin", cardId: "OGS-001" },
    champions: [{ qty: 1, name: "Akali, Deadly Weapon", cardId: "OGS-002" }],
    mainDeck: [
      { qty: 3, name: "Disciple", cardId: "OGS-010", costEnergy: 0, costPower: 0 },
      { qty: 2, name: "Charm", cardId: "OGS-011" },
      { qty: 1, name: "Late Threat", cardId: "OGS-012" }
    ],
    sideboard: [{ qty: 2, name: "Sideboard Answer", cardId: "OGS-020" }],
    battlefields: [{ qty: 1, name: "Back-Alley Bar", cardId: "OGS-030" }],
    runes: [{ qty: 6, name: "Fury Rune" }, { qty: 6, name: "Calm Rune" }]
  }),
  lastImportedAt: "2026-08-20T10:00:00.000Z",
  lastRefreshStatus: "ok",
  lastRefreshError: ""
};

function match(patch: Partial<MatchDraft>): MatchDraft {
  const capturedAt = patch.capturedAt ?? "2026-08-20T12:00:00.000Z";
  return {
    id: patch.id ?? crypto.randomUUID(),
    platform: "atlas",
    status: patch.status ?? "saved",
    capturedAt,
    updatedAt: capturedAt,
    result: patch.result ?? "Win",
    format: patch.format ?? "Bo1",
    score: patch.score ?? "1-0",
    myName: "Player",
    opponentName: "Opponent",
    myChampion: "Akali",
    opponentChampion: patch.opponentChampion ?? "Pyke",
    myBattlefield: "Back-Alley Bar",
    opponentBattlefield: "Void Gate",
    deckName: "Akali Tempo",
    deckSourceId: "deck-akali",
    deckSourceUrl: "",
    deckSourceKey: "test:akali",
    deckSnapshotJson: deck.snapshotJson,
    flags: "",
    notes: "",
    games: patch.games ?? [],
    rawEvidence: [],
    sync: { community: "disabled", hubs: {}, teams: {} },
    ...patch
  };
}

describe("deck insights", () => {
  it("builds an exact, copy-weighted visual composition from the selected deck", () => {
    const report = buildDeckInsightComposition(deck, registry);

    expect(report.legendCard).toMatchObject({ name: "Akali, Rogue Assassin" });
    expect(report.legendCard?.imageUrl).toBeTruthy();
    expect(report.champions).toHaveLength(1);
    expect(report.mainDeckCopies).toBe(6);
    expect(report.uniqueMainDeckCards).toBe(3);
    expect(report.sideboardCopies).toBe(2);
    expect(report.averageEnergy).toBe(2.8);
    expect(report.earlyCurveCopies).toBe(5);
    expect(report.twoCostCopies).toBe(5);
    expect(report.highCostCopies).toBe(1);
    expect(report.mainDeck.find((card) => card.name === "Disciple")).toMatchObject({ costEnergy: 2, costPower: 1 });
    expect(report.curve.find((bucket) => bucket.key === "2")).toMatchObject({ copies: 5, cards: 2 });
    expect(report.curve.find((bucket) => bucket.key === "7+")).toMatchObject({ copies: 1, cards: 1 });
    expect(report.types).toEqual([
      expect.objectContaining({ type: "Unit", copies: 4, cards: 2 }),
      expect.objectContaining({ type: "Spell", copies: 2, cards: 1 })
    ]);
    expect(report.copyProfile).toEqual([
      { copies: 3, cards: 1, label: "3-ofs" },
      { copies: 2, cards: 1, label: "2-ofs" },
      { copies: 1, cards: 1, label: "Singletons" }
    ]);
  });

  it("uses only saved completed matches for outcome claims while retaining both seasons", () => {
    const report = buildDeckInsightPerformance(deck, [
      match({ id: "pre-win", capturedAt: "2026-07-20T12:00:00.000Z", result: "Win", opponentChampion: "Pyke" }),
      match({ id: "current-loss", capturedAt: "2026-08-02T12:00:00.000Z", result: "Loss", opponentChampion: "Pyke" }),
      match({ id: "current-draw", capturedAt: "2026-08-03T12:00:00.000Z", result: "Draw", opponentChampion: "Irelia", score: "1-1" }),
      match({ id: "pending-win", capturedAt: "2026-08-04T12:00:00.000Z", result: "Win", status: "pending-review" })
    ]);

    expect(report.performance.overview.record).toBe("1-1-1");
    expect(report.performance.overview.winRateLabel).toBe("50%");
    expect(report.periods).toEqual([
      expect.objectContaining({ key: "current-season", record: "0-1-1", total: 2 }),
      expect.objectContaining({ key: "preseason", record: "1-0", total: 1 })
    ]);
    expect(report.recentForm.map((point) => point.matchId)).not.toContain("pending-win");
    expect(report.evidenceLabel).toBe("Early");
  });

  it("exposes base-print and name identity keys for replay evidence joins", () => {
    expect(deckInsightCardIdentityKeys({ cardId: "OGS-010_ALT", name: "Disciple" })).toEqual(expect.arrayContaining(["ogs010", "disciple"]));
  });

  it("collapses duplicate print rows before counting unique cards and copy profiles", () => {
    const duplicated: SavedDeck = {
      ...deck,
      snapshotJson: JSON.stringify({
        title: "Akali Tempo",
        legend: "Akali",
        mainDeck: [
          { qty: 1, name: "Disciple", cardId: "OGS-010" },
          { qty: 2, name: "Disciple", cardId: "ALT-172" },
          { qty: 3, name: "Charm", cardId: "OGS-011" }
        ]
      })
    };

    const report = buildDeckInsightComposition(duplicated, registry);
    expect(report.mainDeck).toHaveLength(2);
    expect(report.mainDeck.find((card) => card.name === "Disciple")?.qty).toBe(3);
    expect(report.uniqueMainDeckCards).toBe(2);
    expect(report.copyProfile).toEqual([{ copies: 3, cards: 2, label: "3-ofs" }]);
  });

  it("uses only snapshot-confirmed Game 1 mainboard rows as play-reach eligibility", () => {
    const composition = buildDeckInsightComposition(deck, registry);
    const main = composition.mainDeck.find((card) => card.name === "Disciple")!;
    const sideboard = composition.sideboard[0]!;
    const bo3 = match({
      id: "bo3",
      format: "Bo3",
      score: "2-1",
      games: [
        { gameNumber: 1, result: "Win" },
        { gameNumber: 2, result: "Loss" },
        { gameNumber: 3, result: "Win" }
      ]
    });

    expect(deckInsightCardEligibility(main, [bo3], "all")).toMatchObject({
      eligibleCompletedGames: 1,
      postboardListOpportunityGames: 2,
      basis: "confirmed-g1-mainboard"
    });
    expect(deckInsightCardEligibility(main, [bo3], "postboard")).toMatchObject({
      eligibleCompletedGames: 0,
      postboardListOpportunityGames: 2
    });
    expect(deckInsightCardEligibility(sideboard, [bo3], "all")).toMatchObject({
      eligibleCompletedGames: 0,
      postboardListOpportunityGames: 2,
      basis: "postboard-list-only"
    });
  });

  it("labels sample maturity and only promotes repeated review-grade evidence", () => {
    expect([0, 4, 5, 9, 10, 29, 30].map(deckInsightSampleTier)).toEqual([
      "counts-only",
      "counts-only",
      "early",
      "early",
      "developing",
      "developing",
      "stable"
    ]);
    const report: ReplayInsightCardReport = {
      key: "disciple",
      cardName: "Disciple",
      appearances: 8,
      kept: 5,
      played: 4,
      unplayed: 2,
      completePlayCaptureAppearances: 6,
      recycledOrDiscarded: 2,
      lateKeeps: 4,
      immediatePlays: 0,
      mulligan: { offeredGames: 7, keptGames: 5, redrawnGames: 2, latePlayedGames: 3 },
      prePlayHand: { observedGames: 6, laterPlayedGames: 3, noCapturedPlayGames: 3, recycledOrDiscardedGames: 2 },
      firstPlayTurns: { byTurn3Games: 1, turns4To5Games: 2, turn6PlusGames: 1, unknownTurnGames: 0 },
      confidence: "confirmed",
      replayIds: ["replay-1"]
    };

    expect(buildDeckInsightCardReviewSignal(report)).toMatchObject({
      status: "needs-review",
      label: "Keep games with a late name play",
      opportunities: 5,
      sampleTier: "early"
    });
    expect(buildDeckInsightCardReviewSignal(undefined)).toMatchObject({
      status: "counts-only",
      opportunities: 0,
      sampleTier: "counts-only"
    });

    const denominatorRegression: ReplayInsightCardReport = {
      ...report,
      mulligan: { offeredGames: 30, keptGames: 5, redrawnGames: 0, latePlayedGames: 2 },
      prePlayHand: { observedGames: 0, laterPlayedGames: 0, noCapturedPlayGames: 0, recycledOrDiscardedGames: 0 }
    };
    expect(buildDeckInsightCardReviewSignal(denominatorRegression)).toMatchObject({
      label: "Keep games with a late name play",
      opportunities: 5,
      sampleTier: "early"
    });
    expect(buildDeckInsightCardReviewSignal({
      ...denominatorRegression,
      mulligan: { offeredGames: 30, keptGames: 0, redrawnGames: 0, latePlayedGames: 0 },
      prePlayHand: { observedGames: 5, laterPlayedGames: 3, noCapturedPlayGames: 2, recycledOrDiscardedGames: 0 }
    })).toMatchObject({ label: "Known in hand, no matched play", opportunities: 5, sampleTier: "early" });
    expect(buildDeckInsightCardReviewSignal({
      ...denominatorRegression,
      mulligan: { offeredGames: 30, keptGames: 0, redrawnGames: 0, latePlayedGames: 0 },
      prePlayHand: { observedGames: 5, laterPlayedGames: 0, noCapturedPlayGames: 0, recycledOrDiscardedGames: 2 }
    })).toMatchObject({ label: "Often converted away", opportunities: 5, sampleTier: "early" });
    expect(buildDeckInsightCardReviewSignal({
      ...denominatorRegression,
      mulligan: { offeredGames: 5, keptGames: 0, redrawnGames: 3, latePlayedGames: 0 },
      prePlayHand: { observedGames: 0, laterPlayedGames: 0, noCapturedPlayGames: 0, recycledOrDiscardedGames: 0 }
    })).toMatchObject({ label: "Frequently redrawn", opportunities: 5, sampleTier: "early" });
  });

  it("does not invent confirmed Game 1 opportunities from a score or Bo1 format", () => {
    const composition = buildDeckInsightComposition(deck, registry);
    const main = composition.mainDeck.find((card) => card.name === "Disciple")!;
    const unresolved = match({ id: "unresolved", games: [], format: "Bo1", score: "1-0" });

    expect(deckInsightCardEligibility(main, [unresolved], "all")).toMatchObject({
      eligibleCompletedGames: 0,
      postboardListOpportunityGames: 0,
      unresolvedMatches: 1
    });
  });

  it("falls back to a valid snapshot cost when registry cost data is unknown", () => {
    const mysteryDeck: SavedDeck = {
      ...deck,
      snapshotJson: JSON.stringify({
        title: "Mystery",
        legend: "Akali",
        mainDeck: [{ qty: 3, name: "Mystery Card", cardId: "OGS-099", costEnergy: 3 }]
      })
    };
    const report = buildDeckInsightComposition(mysteryDeck, registry);
    expect(report.mainDeck[0]?.costEnergy).toBe(3);
    expect(report.curve.find((bucket) => bucket.key === "3")?.copies).toBe(3);
    expect(report.curve.find((bucket) => bucket.key === "0")?.copies).toBe(0);
  });
});
