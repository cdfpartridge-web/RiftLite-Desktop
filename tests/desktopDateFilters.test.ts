import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as dateFilters from "../src/shared/dateFilter";
import { canonicalLegendName, normalizeLegendName } from "../src/shared/legendNames";
import { normalizePrivateHubWebReplayId } from "../src/shared/privateHubs";
import { isCombinedOriginal, isCombinedRepairMatch } from "../src/shared/matchCombine";
import { localMatchesEligibleForStats } from "../src/shared/matchList";
import type { CommunityMatch, MatchDraft } from "../src/shared/types";

// Execute the actual renderer filters and their declarations, without running
// desktop bootstrap or replacing filtering dependencies with test substitutes.
function loadFilters() {
  const text = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map<string, ts.Statement>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) declarations.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, statement);
      }
    }
  }
  const included = new Set<ts.Statement>();
  function include(name: string) {
    const declaration = declarations.get(name);
    if (!declaration || included.has(declaration)) return;
    included.add(declaration);
    function visit(node: ts.Node) {
      if (ts.isIdentifier(node)) include(node.text);
      ts.forEachChild(node, visit);
    }
    visit(declaration);
  }
  const names = ["filterLocalMatches", "filterLeaderboardMatches", "filterMatrixMatches", "localMatchStats", "communityMatchDate", "communityToAnalytics", "DEFAULT_MATCH_HISTORY_FILTERS", "DEFAULT_LEADERBOARD_FILTERS", "DEFAULT_MATRIX_FILTERS"];
  names.forEach(include);
  const code = source.statements.filter((statement) => included.has(statement)).map((statement) => statement.getText(source)).join("\n");
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return runInNewContext(`${compiled}\n({${names.join(",")}});`, {
    ...dateFilters, canonicalLegendName, normalizeLegendName, normalizePrivateHubWebReplayId, isCombinedOriginal, isCombinedRepairMatch, localMatchesEligibleForStats
  }, { timeout: 1_000 });
}

const filters = loadFilters();
const date = { preset: "date", from: "2026-09-18", to: "" } as const;

function match(id: string, day: number, patch: Partial<MatchDraft> = {}): MatchDraft {
  const capturedAt = new Date(2026, 8, day, 12).toISOString();
  return {
    id, platform: "atlas", status: "saved", capturedAt, updatedAt: capturedAt,
    result: "Win", format: "Bo1", score: "1-0", myName: "Player", opponentName: "Rival",
    myChampion: "Akali", opponentChampion: "Irelia", myBattlefield: "Back-Alley Bar", opponentBattlefield: "Void Gate",
    deckName: "Akali Tempo", deckSourceId: "akali", flags: "Testing", notes: "Opening hand",
    games: [{ gameNumber: 1, result: "Win", wentFirst: "1st" }], rawEvidence: [],
    sync: { community: "disabled", hubs: {}, teams: {} }, ...patch
  };
}

describe("desktop reporting date filters", () => {
  it("keeps seconds and milliseconds community timestamps in the same date cohort when dates are missing", () => {
    const timestamp = new Date(2026, 8, 18, 12).getTime();
    const row = (id: string, createdAt: number): CommunityMatch => ({
      id, createdAt, date: "", uid: id, username: "Player", result: "Win", scope: "community",
      myChampion: "Akali", opponentChampion: "Irelia", opponentName: "Opponent", format: "Bo1", score: "1-0",
      wentFirst: "1st", myBattlefield: "", opponentBattlefield: "", flags: "", gamesJson: "[]",
      deckName: "", deckSourceUrl: "", deckSourceKey: "", deckSnapshotJson: "",
    });
    const source = [row("seconds", timestamp / 1000), row("milliseconds", timestamp), row("before", timestamp - 86_400_000), row("missing", 0)];
    const before = JSON.stringify(source);
    const direct = source.filter((match) => dateFilters.isInDateFilter(filters.communityMatchDate(match), date));
    const analytics = source.map((match) => filters.communityToAnalytics(match));
    const matrix = filters.filterMatrixMatches(analytics, { ...filters.DEFAULT_MATRIX_FILTERS, season: "", date });
    expect(direct.map((match) => match.id)).toEqual(["seconds", "milliseconds"]);
    expect(matrix.map((match: { id: string }) => match.id)).toEqual(["seconds", "milliseconds"]);
    expect(analytics[0].capturedAt).toBe(new Date(timestamp).toISOString());
    expect(analytics[1].capturedAt).toBe(analytics[0].capturedAt);
    expect(analytics[3].capturedAt).toBe("");
    expect(JSON.stringify(source)).toBe(before);
  });

  it("keeps match history and its stats on the same chosen date without changing stored records", () => {
    const source = [match("old", 17, { result: "Loss" }), match("today", 18), match("pending", 18, { status: "pending-review", result: "Loss" }), match("next", 19)];
    const before = JSON.stringify(source);
    const visible = filters.filterLocalMatches(source, { ...filters.DEFAULT_MATCH_HISTORY_FILTERS, season: "", range: date });
    expect(visible.map((row: MatchDraft) => row.id)).toEqual(["today", "pending"]);
    expect(filters.localMatchStats(visible)).toMatchObject({ record: "1-0", winRate: "100%", streak: "W1" });
    expect(JSON.stringify(source)).toBe(before);
    expect(filters.filterLocalMatches(source, { ...filters.DEFAULT_MATCH_HISTORY_FILTERS, season: "", range: dateFilters.DEFAULT_DATE_FILTER })).toHaveLength(4);
  });

  it("combines match dates with existing legend, platform, format and seat filters", () => {
    const source = [match("wanted", 18), match("wrong-day", 17), match("wrong-platform", 18, { platform: "tcga" }), match("wrong-opponent", 18, { opponentChampion: "Vex" })];
    const visible = filters.filterLocalMatches(source, {
      ...filters.DEFAULT_MATCH_HISTORY_FILTERS, season: "", range: date, platform: "atlas", opponentLegend: "Irelia", format: "Bo1", seat: "1st"
    });
    expect(visible.map((row: MatchDraft) => row.id)).toEqual(["wanted"]);
  });

  it("does not reintroduce combined originals when narrowing dates", () => {
    const source = [match("combined", 18, { combinedFromMatchIds: ["original"] }), match("original", 18, { mergedIntoMatchId: "combined", hiddenFromHistory: true })];
    const base = { ...filters.DEFAULT_MATCH_HISTORY_FILTERS, season: "", range: date };
    expect(filters.filterLocalMatches(source, base).map((row: MatchDraft) => row.id)).toEqual(["combined"]);
    expect(filters.filterLocalMatches(source, { ...base, combinedOriginals: "only" }).map((row: MatchDraft) => row.id)).toEqual(["original"]);
  });

  it("applies the same inclusive range to matrix cohorts and leaderboards", () => {
    const source = [match("before", 16), match("first", 17), match("last", 18), match("after", 19), match("incomplete", 18, { result: "Incomplete" })];
    const range = { preset: "custom", from: "2026-09-17", to: "2026-09-18" };
    const matrix = filters.filterMatrixMatches(source, { ...filters.DEFAULT_MATRIX_FILTERS, season: "", date: range, legend: "Akali", battlefield: "Back-Alley" });
    const leaderboard = filters.filterLeaderboardMatches(source, { ...filters.DEFAULT_LEADERBOARD_FILTERS, range, legend: "Akali" });
    expect(matrix.map((row: MatchDraft) => row.id)).toEqual(["first", "last"]);
    expect(leaderboard.map((row: MatchDraft) => row.id)).toEqual(["first", "last"]);
  });

  it("returns empty reporting samples for invalid dates instead of quietly showing all history", () => {
    const source = [match("saved", 18)];
    const invalid = { preset: "custom", from: "2026-09-19", to: "2026-09-18" };
    expect(filters.filterLocalMatches(source, { ...filters.DEFAULT_MATCH_HISTORY_FILTERS, season: "", range: invalid })).toEqual([]);
    expect(filters.filterMatrixMatches(source, { ...filters.DEFAULT_MATRIX_FILTERS, season: "", date: invalid })).toEqual([]);
    expect(filters.filterLeaderboardMatches(source, { ...filters.DEFAULT_LEADERBOARD_FILTERS, range: invalid })).toEqual([]);
  });
});
