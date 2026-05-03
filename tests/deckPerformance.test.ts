import { describe, expect, it } from "vitest";
import { activeDeckOverlayStats, buildDeckPerformance, deckMatchesFor } from "../src/shared/deckPerformance";
import type { MatchDraft, SavedDeck } from "../src/shared/types";

const deck: SavedDeck = {
  id: "deck-id",
  sourceUrl: "https://piltoverarchive.com/decks/view/abc",
  sourceKey: "piltover:abc",
  title: "Vex v3",
  legend: "Vex",
  snapshotJson: "{}",
  lastImportedAt: "2026-04-24T08:00:00.000Z",
  lastRefreshStatus: "ok",
  lastRefreshError: ""
};

function match(patch: Partial<MatchDraft>): MatchDraft {
  const capturedAt = patch.capturedAt ?? "2026-04-24T12:00:00.000Z";
  return {
    id: patch.id ?? crypto.randomUUID(),
    platform: "tcga",
    status: "saved",
    capturedAt,
    updatedAt: capturedAt,
    result: patch.result ?? "Win",
    format: patch.format ?? "Bo1",
    score: patch.score ?? "1-0",
    myName: "BMU",
    opponentName: patch.opponentName ?? "Opponent",
    myChampion: patch.myChampion ?? "Vex",
    opponentChampion: patch.opponentChampion ?? "Ahri",
    myBattlefield: patch.myBattlefield ?? "",
    opponentBattlefield: patch.opponentBattlefield ?? "",
    deckName: patch.deckName ?? "",
    deckSourceId: patch.deckSourceId ?? "",
    deckSourceUrl: patch.deckSourceUrl ?? "",
    deckSourceKey: patch.deckSourceKey ?? "",
    deckSnapshotJson: patch.deckSnapshotJson ?? "",
    flags: "",
    notes: "",
    games: patch.games ?? [],
    rawEvidence: [],
    sync: { community: "disabled", hubs: {} }
  };
}

describe("deck performance", () => {
  it("matches a deck by source key or saved deck id before using names", () => {
    const exact = match({ id: "exact", deckSourceKey: "piltover:abc", deckName: "Completely renamed", myChampion: "Ahri" });
    const byId = match({ id: "by-id", deckSourceId: "deck-id", deckName: "Other name" });
    const wrongKey = match({ id: "wrong-key", deckSourceKey: "piltover:other", deckName: "Vex v3", myChampion: "Vex" });

    expect(deckMatchesFor(deck, [exact, byId, wrongKey]).map((item) => item.id)).toEqual(["exact", "by-id"]);
  });

  it("falls back by deck name and legend only when the match has no source key", () => {
    const fallback = match({ id: "fallback", deckName: "vex v3", myChampion: "Gloomist" });
    const keyedNameMatch = match({ id: "keyed", deckSourceKey: "other", deckName: "Vex v3", myChampion: "Vex" });
    const wrongLegend = match({ id: "wrong-legend", deckName: "Vex v3", myChampion: "Ahri" });

    expect(deckMatchesFor(deck, [fallback, keyedNameMatch, wrongLegend]).map((item) => item.id)).toEqual(["fallback"]);
  });

  it("keeps incomplete matches in recent history but excludes them from winrate", () => {
    const performance = buildDeckPerformance(deck, [
      match({ id: "pending", result: "Incomplete", deckSourceKey: "piltover:abc", capturedAt: "2026-04-24T15:00:00.000Z" }),
      match({ id: "win", result: "Win", deckSourceKey: "piltover:abc", capturedAt: "2026-04-24T14:00:00.000Z" }),
      match({ id: "loss", result: "Loss", deckSourceKey: "piltover:abc", capturedAt: "2026-04-24T13:00:00.000Z" })
    ]);

    expect(performance.matches.map((item) => item.id)).toEqual(["pending", "win", "loss"]);
    expect(performance.recentMatches.map((item) => item.id)).toContain("pending");
    expect(performance.overview.record).toBe("1-1");
    expect(performance.overview.winRateLabel).toBe("50%");
    expect(performance.overview.incomplete).toBe(1);
  });

  it("builds seat, battlefield, trend, and active overlay stats from local matches", () => {
    const performance = buildDeckPerformance(deck, [
      match({
        id: "a",
        result: "Win",
        deckSourceKey: "piltover:abc",
        opponentChampion: "Kai'Sa",
        capturedAt: "2026-04-24T14:00:00.000Z",
        games: [{ gameNumber: 1, result: "Win", wentFirst: "1st", myBattlefield: "Void Gate", oppBattlefield: "Forge of the Fluft", extraBattlefields: ["Baron Pit"] }]
      }),
      match({
        id: "b",
        result: "Win",
        deckSourceKey: "piltover:abc",
        opponentChampion: "Kai'Sa",
        capturedAt: "2026-04-24T13:00:00.000Z",
        games: [{ gameNumber: 1, result: "Win", wentFirst: "2nd", myBattlefield: "Void Gate", oppBattlefield: "The Academy" }]
      }),
      match({
        id: "c",
        result: "Loss",
        deckSourceKey: "piltover:abc",
        opponentChampion: "Vi",
        capturedAt: "2026-04-24T12:00:00.000Z",
        games: [{ gameNumber: 1, result: "Loss", wentFirst: "1st", myBattlefield: "The Papertree", oppBattlefield: "The Academy" }]
      })
    ], new Date("2026-04-24T13:30:00.000Z"));

    expect(performance.trends.find((trend) => trend.window === 5)?.label).toBe("hot");
    expect(performance.seatStats.find((seat) => seat.seat === "1st")?.record).toBe("1-1");
    expect(performance.myBattlefields[0]).toMatchObject({ name: "Void Gate", record: "2-0" });
    expect(performance.myBattlefields.find((row) => row.name === "Baron Pit")).toBeUndefined();
    expect(performance.matchups.find((matchup) => matchup.legend === "Kai'Sa")?.record).toBe("2-0");

    const overlay = activeDeckOverlayStats(performance, new Date("2026-04-24T13:30:00.000Z"));
    expect(overlay.record).toBe("2-1");
    expect(overlay.sessionRecord).toBe("1-0");
    expect(overlay.bestMatchup).toBe("Kai'Sa 100% (2-0)");
  });
});
