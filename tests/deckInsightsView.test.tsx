import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  copyDeckInsightSummary,
  deckInsightStageScopeLabel,
  DeckInsightsView,
  effectiveDeckInsightGameStage,
  filterDeckInsightMatches
} from "../src/renderer/DeckInsightsView";
import { buildDeckInsightPerformance } from "../src/shared/deckInsights";
import { buildDeckBo3Results, buildDeckDataCompleteness } from "../src/shared/deckResults";
import { DEFAULT_DATE_FILTER } from "../src/shared/dateFilter";
import { MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON } from "../src/shared/mulliganLab";
import type { MatchDraft, SavedDeck } from "../src/shared/types";

const deck: SavedDeck = {
  id: "deck-1",
  sourceUrl: "",
  sourceKey: "local:deck-1",
  title: "Akali Tempo",
  legend: "Akali",
  snapshotJson: JSON.stringify({
    title: "Akali Tempo",
    legend: "Akali",
    mainDeck: [
      { qty: 3, name: "Discipline", cardId: "OGS-175" },
      { qty: 3, name: "Charm", cardId: "OGS-176" }
    ],
    sideboard: [{ qty: 2, name: "Disarming Rake", cardId: "OGS-177" }],
    battlefields: [{ qty: 1, name: "Back-Alley Bar", cardId: "OGS-178" }]
  }),
  lastImportedAt: "2026-08-29T10:00:00.000Z",
  lastRefreshStatus: "ok",
  lastRefreshError: ""
};

function datedMatch(id: string, capturedAt: string, patch: Partial<MatchDraft> = {}): MatchDraft {
  return {
    id, platform: "atlas", status: "saved", capturedAt, updatedAt: capturedAt,
    result: "Win", format: "Bo3", score: "2-0", myName: "Player", opponentName: "Opponent",
    myChampion: "Akali", opponentChampion: "Irelia", myBattlefield: "Back-Alley Bar", opponentBattlefield: "Void Gate",
    deckName: deck.title, deckSourceId: deck.id, deckSourceKey: deck.sourceKey, deckSnapshotJson: deck.snapshotJson,
    flags: "", notes: "", games: [{ gameNumber: 1, result: "Win" }, { gameNumber: 2, result: "Win" }],
    rawEvidence: [], sync: { community: "disabled", hubs: {}, teams: {} }, ...patch
  };
}

describe("DeckInsightsView", () => {
  it("copies reports through the trusted Electron clipboard bridge", async () => {
    const bridge = { writeClipboardText: vi.fn(async () => true) };

    await expect(copyDeckInsightSummary("Deck report", bridge)).resolves.toBe(true);
    expect(bridge.writeClipboardText).toHaveBeenCalledWith("Deck report");
  });

  it("reports bridge refusal and rejection as copy failures", async () => {
    const refusedBridge = { writeClipboardText: vi.fn(async () => false) };
    await expect(copyDeckInsightSummary("Deck report", refusedBridge)).resolves.toBe(false);

    const rejectedBridge = { writeClipboardText: vi.fn(async () => { throw new Error("IPC unavailable"); }) };
    await expect(copyDeckInsightSummary("Deck report", rejectedBridge)).resolves.toBe(false);
  });

  it("limits game-stage filtering to Card Review and disables stage claims for combined evidence", () => {
    expect(effectiveDeckInsightGameStage("cards", "postboard", false)).toBe("postboard");
    expect(effectiveDeckInsightGameStage("overview", "postboard", false)).toBe("all");
    expect(effectiveDeckInsightGameStage("matchups", "preboard", false)).toBe("all");
    expect(effectiveDeckInsightGameStage("cards", "preboard", true)).toBe("all");
    expect(deckInsightStageScopeLabel("preboard", false)).toBe("Game 1 only");
    expect(deckInsightStageScopeLabel("postboard", false)).toBe("Post-board only");
    expect(deckInsightStageScopeLabel("all", true)).toBe("All games, stage unverified");
  });

  it("renders a visual overview with progressive Deck Insights sections and honest empty evidence", () => {
    const markup = renderToStaticMarkup(
      <DeckInsightsView
        decks={[deck]}
        matches={[]}
        replays={[]}
        activeDeckId={deck.id}
        onNavigate={() => undefined}
        onOpenReplay={() => undefined}
      />
    );

    expect(markup).toContain("Visual deck report");
    expect(markup).toContain("Deck Insights sections");
    expect(markup).toContain("Overview");
    expect(markup).toContain("Card review");
    expect(markup).toContain("Matchups");
    expect(markup).toContain("Energy curve");
    expect(markup).toContain("Card types");
    expect(markup).toContain("Recent form");
    expect(markup).toContain("No completed matches in this scope");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Match dates");
    expect(markup).toContain('value="date"');
    expect(markup).toContain('value="custom"');
    expect(markup).toContain('value="90d"');
    expect(markup).toContain('value="180d"');
    expect(markup).not.toContain("What your cards actually do in games");
  });

  it("offers a clear deck-library action when no deck has been imported", () => {
    const markup = renderToStaticMarkup(
      <DeckInsightsView
        decks={[]}
        matches={[]}
        replays={[]}
        activeDeckId=""
        onNavigate={() => undefined}
        onOpenReplay={() => undefined}
      />
    );

    expect(markup).toContain("Add a deck to unlock Deck Insights");
    expect(markup).toContain("Open deck library");
  });
});

describe("Deck Insights date scope", () => {
  it("uses the whole selected local date for performance, completeness and Bo3 reports", () => {
    const original = [
      datedMatch("before", new Date(2026, 8, 17, 23, 59, 59, 999).toISOString(), { result: "Loss", score: "0-2", games: [{ gameNumber: 1, result: "Loss" }, { gameNumber: 2, result: "Loss" }] }),
      datedMatch("midnight", new Date(2026, 8, 18).toISOString()),
      datedMatch("last-millisecond", new Date(2026, 8, 18, 23, 59, 59, 999).toISOString()),
      datedMatch("after", new Date(2026, 8, 19).toISOString()),
      datedMatch("pending", new Date(2026, 8, 18, 14).toISOString(), { status: "pending-review" })
    ];
    const filtered = filterDeckInsightMatches(original, { preset: "date", from: "2026-09-18", to: "" }, "all");

    expect(filtered.map((match) => match.id)).toEqual(["midnight", "last-millisecond", "pending"]);
    expect(buildDeckInsightPerformance(deck, filtered).performance.overview).toMatchObject({ total: 2, record: "2-0", winRateLabel: "100%" });
    expect(buildDeckDataCompleteness(filtered)).toMatchObject({ savedMatches: 2, excludedMatches: 1, games: 4 });
    expect(buildDeckBo3Results(filtered).included.map(({ match }) => match.id)).toEqual(["midnight", "last-millisecond"]);
    expect(original).toHaveLength(5);
  });

  it("intersects a calendar range with season scope without changing the source evidence", () => {
    const seasonStart = Date.parse(`${MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON}T00:00:00.000Z`);
    const source = [
      datedMatch("preseason", new Date(seasonStart - 86_400_000).toISOString()),
      datedMatch("current", new Date(seasonStart + 86_400_000).toISOString()),
      datedMatch("unknown", "invalid")
    ];
    const before = JSON.stringify(source);
    const filter = { preset: "custom" as const, from: "2026-01-01", to: "2026-12-31" };
    expect(filterDeckInsightMatches(source, filter, "preseason").map((match) => match.id)).toEqual(["preseason"]);
    expect(filterDeckInsightMatches(source, filter, "current-season").map((match) => match.id)).toEqual(["current"]);
    expect(filterDeckInsightMatches(source, DEFAULT_DATE_FILTER, "all").map((match) => match.id)).toEqual(["preseason", "current"]);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("keeps empty and reversed custom ranges out of report denominators", () => {
    const source = [datedMatch("saved", "2026-09-18T12:00:00Z")];
    for (const filter of [
      { preset: "date" as const, from: "", to: "" },
      { preset: "custom" as const, from: "2026-09-19", to: "2026-09-18" },
      { preset: "custom" as const, from: "2026-09-19", to: "2026-09-20" }
    ]) {
      const filtered = filterDeckInsightMatches(source, filter, "all");
      expect(buildDeckInsightPerformance(deck, filtered).performance.overview.total).toBe(0);
      expect(buildDeckDataCompleteness(filtered).savedMatches).toBe(0);
      expect(buildDeckBo3Results(filtered).considered).toBe(0);
    }
  });
});
