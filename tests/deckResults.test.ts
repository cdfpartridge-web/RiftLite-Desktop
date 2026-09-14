import { describe, expect, it } from "vitest";
import { buildDeckBo3Results, buildDeckDataCompleteness } from "../src/shared/deckResults";
import type { MatchDraft, MatchGame } from "../src/shared/types";

function match(id: string, results: Array<MatchGame["result"]> = ["Win", "Win"], patch: Partial<MatchDraft> = {}): MatchDraft {
  const wins = results.filter((result) => result === "Win").length;
  const losses = results.filter((result) => result === "Loss").length;
  return {
    id, platform: "tcga", status: "saved", capturedAt: "2026-09-08T12:00:00Z", updatedAt: "2026-09-08T12:00:00Z",
    result: wins === 2 ? "Win" : "Loss", format: "Bo3", score: `${wins}-${losses}`, myName: "Player", opponentName: "Rival", myChampion: "Ivern", opponentChampion: "Lillia",
    myBattlefield: "Forbidding Waste", opponentBattlefield: "The Candlelit Sanctum", deckName: "Ivern", deckSourceId: "ivern", flags: "", notes: "",
    games: results.map((result, index) => ({ gameNumber: index + 1, result })), rawEvidence: [], sync: { community: "disabled", hubs: {}, teams: {} }, ...patch
  };
}

describe("deck record completeness", () => {
  it("keeps game and match denominators distinct and does not backfill later battlefield pairs", () => {
    const source = [
      match("series", ["Win", "Loss", "Win"], { games: [
        { gameNumber: 1, result: "Win", myPoints: 0, oppPoints: 0, wentFirst: "1st" },
        { gameNumber: 2, result: "Loss", myPoints: 3, oppPoints: 8, wentFirst: "undecided" },
        { gameNumber: 3, result: "Win", myBattlefield: "Void Gate", wentFirst: "2nd" }
      ], deckSnapshotJson: JSON.stringify({ mainDeck: [{ qty: 3, name: "Daisy" }] }) }),
      match("legacy", [], { format: "Bo1", result: "Win", score: "1-0", deckSnapshotJson: "{}" }),
      match("no-rows", []),
      match("pending", ["Win", "Win"], { status: "pending-review" }),
      match("hidden", ["Win", "Win"], { hiddenFromStats: true })
    ];
    expect(buildDeckDataCompleteness(source)).toEqual({
      savedMatches: 3, excludedMatches: 2, games: 4, legacySingleGames: 1, matchesWithoutGameRows: 1,
      battlefields: { known: 2, total: 4 }, myBattlefields: { known: 3, total: 4 }, opponentBattlefields: { known: 2, total: 4 },
      initiative: { known: 2, total: 4 }, scores: { known: 2, total: 4 }, storedDeckLists: { known: 1, total: 3 }
    });
  });

  it("counts a stored list only when a parsed main deck is available", () => {
    const snapshots = ["", "{broken", "{}", "null", JSON.stringify({ mainDeck: [] }), JSON.stringify({ mainDeck: [{ name: "Daisy", qty: 3 }] })];
    expect(buildDeckDataCompleteness(snapshots.map((deckSnapshotJson, index) => match(String(index), ["Win", "Win"], { deckSnapshotJson }))).storedDeckLists).toEqual({ known: 1, total: 6 });
  });

  it("leaves an empty scope at zero without creating games or percentages", () => {
    const report = buildDeckDataCompleteness([]);
    expect(report.games).toBe(0);
    expect(report.battlefields).toEqual({ known: 0, total: 0 });
    expect(report.storedDeckLists).toEqual({ known: 0, total: 0 });
  });
});

describe("Bo3 outcome breakdown", () => {
  it("uses each conditional sample and groups later games by matchup and initiative", () => {
    const source = [
      match("closed", ["Win", "Win"], { games: [{ gameNumber: 1, result: "Win" }, { gameNumber: 2, result: "Win", wentFirst: "2nd" }] }),
      match("lost-lead", ["Win", "Loss", "Loss"], { games: [{ gameNumber: 1, result: "Win" }, { gameNumber: 2, result: "Loss", wentFirst: "2nd" }, { gameNumber: 3, result: "Loss", wentFirst: "1st" }] }),
      match("comeback", ["Loss", "Win", "Win"], { opponentChampion: "Jayce", games: [{ gameNumber: 1, result: "Loss" }, { gameNumber: 2, result: "Win", wentFirst: "1st" }, { gameNumber: 3, result: "Win" }] }),
      match("swept", ["Loss", "Loss"])
    ];
    const report = buildDeckBo3Results(source);
    expect(report.considered).toBe(4);
    expect(report.excluded).toEqual([]);
    expect(report.gameOne).toEqual({ wins: 2, total: 4 });
    expect(report.conversion).toEqual({ wins: 1, total: 2 });
    expect(report.comeback).toEqual({ wins: 1, total: 2 });
    expect(report.laterGames.find((row) => row.opponent === "Lillia" && row.initiative === "2nd")).toMatchObject({ overall: { wins: 1, total: 2 }, game2: { wins: 1, total: 2 }, game3: { wins: 0, total: 0 }, matchIds: ["closed", "lost-lead"] });
    expect(report.laterInitiativeUnknown).toBe(2);
    expect(report.laterGames.reduce((sum, row) => sum + row.overall.total, 0)).toBe(6);
  });

  it.each([
    ["duplicate numbers", { games: [{ gameNumber: 1, result: "Win" }, { gameNumber: 1, result: "Win" }] }],
    ["missing game one", { games: [{ gameNumber: 2, result: "Win" }, { gameNumber: 3, result: "Win" }] }],
    ["one game only", { games: [{ gameNumber: 1, result: "Win" }] }],
    ["unfinished game", { games: [{ gameNumber: 1, result: "Win" }, { gameNumber: 2, result: "Incomplete" }] }],
    ["wrong winner", { result: "Loss" }],
    ["wrong score", { score: "2-1" }],
    ["missing score", { score: "" }],
    ["game after series ended", { score: "2-1", games: [{ gameNumber: 1, result: "Win" }, { gameNumber: 2, result: "Win" }, { gameNumber: 3, result: "Loss" }] }],
    ["manual combination", { combinedFromMatchIds: ["a", "b"] }],
    ["drawn series", { result: "Draw" }]
  ] as Array<[string, Partial<MatchDraft>]>) ("excludes %s with an explicit reason", (_label, patch) => {
    const report = buildDeckBo3Results([match("bad", ["Win", "Win"], patch)]);
    expect(report.included).toHaveLength(0);
    expect(report.excluded).toHaveLength(1);
    expect(report.excluded[0].reason).toBeTruthy();
    expect(report.gameOne).toEqual({ wins: 0, total: 0 });
    expect(report.laterGames).toEqual([]);
  });

  it("accepts explicit game numbers independent of serialized row order", () => {
    const report = buildDeckBo3Results([match("ordered", ["Win", "Win"], { games: [{ gameNumber: 2, result: "Win" }, { gameNumber: 1, result: "Win" }] })]);
    expect(report.included[0].games.map((game) => game.gameNumber)).toEqual([1, 2]);
  });

  it("does not include pending, hidden, deleted, merged, or Bo1 records in the Bo3 denominator", () => {
    const report = buildDeckBo3Results([
      match("valid"), match("pending", undefined, { status: "pending-review" }), match("hidden", undefined, { hiddenFromStats: true }),
      match("deleted", undefined, { deletedAt: "2026-09-08" }), match("merged", undefined, { mergedIntoMatchId: "valid" }), match("bo1", undefined, { format: "Bo1" })
    ]);
    expect(report.considered).toBe(1);
    expect(report.included.map(({ match }) => match.id)).toEqual(["valid"]);
    expect(report.comeback).toEqual({ wins: 0, total: 0 });
  });
});
