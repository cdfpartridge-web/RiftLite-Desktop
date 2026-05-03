import { normalizeLegendName } from "./legendNames.js";
import type { MatchDraft, MatchGame, SavedDeck } from "./types.js";

export type DeckTrendLabel = "hot" | "cooling" | "stable" | "not enough data";

export interface DeckRecordStats {
  total: number;
  wins: number;
  losses: number;
  draws: number;
  decisive: number;
  record: string;
  winRate: number;
  winRateLabel: string;
}

export interface DeckTrendStat extends DeckRecordStats {
  window: number;
  label: DeckTrendLabel;
}

export interface DeckSeatStat extends DeckRecordStats {
  seat: "1st" | "2nd" | "Unknown";
}

export interface DeckBattlefieldStat extends DeckRecordStats {
  name: string;
}

export interface DeckBattlefieldPairStat extends DeckRecordStats {
  myBattlefield: string;
  opponentBattlefield: string;
}

export interface DeckMatchupStat extends DeckRecordStats {
  legend: string;
  matches: MatchDraft[];
}

export interface DeckPerformanceStats {
  deck: SavedDeck;
  matches: MatchDraft[];
  recentMatches: MatchDraft[];
  completedMatches: MatchDraft[];
  overview: DeckRecordStats & {
    bo1: number;
    bo3: number;
    incomplete: number;
    currentStreak: string;
    lastPlayed: string;
  };
  matchups: DeckMatchupStat[];
  seatStats: DeckSeatStat[];
  myBattlefields: DeckBattlefieldStat[];
  opponentBattlefields: DeckBattlefieldStat[];
  battlefieldPairs: DeckBattlefieldPairStat[];
  trends: DeckTrendStat[];
}

export interface ActiveDeckOverlayStats {
  title: string;
  legend: string;
  total: number;
  record: string;
  winRate: string;
  sessionRecord: string;
  bestMatchup: string;
  worstMatchup: string;
}

type ResultLike = "Win" | "Loss" | "Draw" | "Incomplete";

type GameRecord = {
  result: ResultLike;
  wentFirst: "1st" | "2nd" | "undecided" | "";
  myBattlefield: string;
  opponentBattlefield: string;
};

export function buildDeckPerformance(deck: SavedDeck, matches: MatchDraft[], sessionStart?: Date): DeckPerformanceStats {
  const deckMatches = deckMatchesFor(deck, matches).sort(compareCapturedDesc);
  const completedMatches = deckMatches.filter(isCompletedMatch);
  const overview = {
    ...recordStats(completedMatches.map((match) => match.result)),
    bo1: completedMatches.filter((match) => match.format === "Bo1").length,
    bo3: completedMatches.filter((match) => match.format === "Bo3").length,
    incomplete: deckMatches.length - completedMatches.length,
    currentStreak: currentStreak(completedMatches),
    lastPlayed: deckMatches[0]?.capturedAt ?? ""
  };
  const gameRecords = deckMatches.flatMap(matchGameRecords).filter((game) => game.result !== "Incomplete");

  return {
    deck,
    matches: deckMatches,
    recentMatches: deckMatches.slice(0, 8),
    completedMatches,
    overview,
    matchups: deckMatchups(completedMatches),
    seatStats: deckSeatStats(gameRecords),
    myBattlefields: deckBattlefieldStats(gameRecords, "myBattlefield"),
    opponentBattlefields: deckBattlefieldStats(gameRecords, "opponentBattlefield"),
    battlefieldPairs: deckBattlefieldPairs(gameRecords),
    trends: [5, 10, 20].map((window) => deckTrend(completedMatches, window))
  };
}

export function deckMatchesFor(deck: SavedDeck, matches: MatchDraft[]): MatchDraft[] {
  return matches.filter((match) => deckMatchesMatch(deck, match));
}

export function activeDeckOverlayStats(performance: DeckPerformanceStats, sessionStart?: Date): ActiveDeckOverlayStats {
  const sessionMatches = sessionStart
    ? performance.completedMatches.filter((match) => capturedAfter(match, sessionStart))
    : performance.completedMatches;
  const session = recordStats(sessionMatches.map((match) => match.result));
  return {
    title: performance.deck.title || "Active deck",
    legend: normalizeLegendName(performance.deck.legend) || "Unknown legend",
    total: performance.overview.total,
    record: performance.overview.record,
    winRate: performance.overview.total ? performance.overview.winRateLabel : "No matches",
    sessionRecord: session.total ? session.record : "0-0",
    bestMatchup: matchupLabel(performance.matchups, "best"),
    worstMatchup: matchupLabel(performance.matchups, "worst")
  };
}

function deckMatchesMatch(deck: SavedDeck, match: MatchDraft): boolean {
  const deckKeys = [deck.sourceKey, deck.id].map(normalizedKey).filter(Boolean);
  const matchKey = normalizedKey(match.deckSourceKey || match.deckSourceId);
  if (matchKey) {
    return deckKeys.includes(matchKey);
  }
  const deckName = normalizedText(deck.title);
  const matchDeckName = normalizedText(match.deckName);
  if (!deckName || deckName !== matchDeckName) {
    return false;
  }
  return normalizeLegendName(deck.legend) === normalizeLegendName(match.myChampion);
}

function recordStats(results: ResultLike[]): DeckRecordStats {
  const completed = results.filter((result) => result !== "Incomplete");
  const wins = completed.filter((result) => result === "Win").length;
  const losses = completed.filter((result) => result === "Loss").length;
  const draws = completed.filter((result) => result === "Draw").length;
  const decisive = wins + losses;
  const winRate = decisive ? Math.round((wins / decisive) * 100) : 0;
  return {
    total: completed.length,
    wins,
    losses,
    draws,
    decisive,
    record: `${wins}-${losses}${draws ? `-${draws}` : ""}`,
    winRate,
    winRateLabel: completed.length ? `${winRate}%` : "No data"
  };
}

function currentStreak(matches: MatchDraft[]): string {
  const decisive = matches.filter((match) => match.result === "Win" || match.result === "Loss");
  const first = decisive[0]?.result;
  if (!first) {
    return "None";
  }
  let count = 0;
  for (const match of decisive) {
    if (match.result !== first) {
      break;
    }
    count += 1;
  }
  return `${first === "Win" ? "W" : "L"}${count}`;
}

function deckTrend(matches: MatchDraft[], window: number): DeckTrendStat {
  const slice = matches.filter((match) => match.result === "Win" || match.result === "Loss").slice(0, window);
  const stats = recordStats(slice.map((match) => match.result));
  return {
    ...stats,
    window,
    label: trendLabel(stats)
  };
}

function trendLabel(stats: DeckRecordStats): DeckTrendLabel {
  if (stats.decisive < 3) {
    return "not enough data";
  }
  if (stats.winRate >= 65) {
    return "hot";
  }
  if (stats.winRate <= 40) {
    return "cooling";
  }
  return "stable";
}

function deckMatchups(matches: MatchDraft[]): DeckMatchupStat[] {
  const grouped = new Map<string, MatchDraft[]>();
  for (const match of matches) {
    const legend = normalizeLegendName(match.opponentChampion);
    if (!legend) {
      continue;
    }
    grouped.set(legend, [...(grouped.get(legend) ?? []), match]);
  }
  return [...grouped.entries()]
    .map(([legend, legendMatches]) => ({
      legend,
      matches: legendMatches,
      ...recordStats(legendMatches.map((match) => match.result))
    }))
    .sort((a, b) => b.total - a.total || b.winRate - a.winRate || a.legend.localeCompare(b.legend));
}

function deckSeatStats(games: GameRecord[]): DeckSeatStat[] {
  return ["1st", "2nd", "Unknown"].map((seat) => {
    const seatGames = games.filter((game) => seatLabel(game.wentFirst) === seat);
    return {
      seat: seat as DeckSeatStat["seat"],
      ...recordStats(seatGames.map((game) => game.result))
    };
  }).filter((stat) => stat.total > 0);
}

function deckBattlefieldStats(games: GameRecord[], key: "myBattlefield" | "opponentBattlefield"): DeckBattlefieldStat[] {
  const grouped = new Map<string, ResultLike[]>();
  for (const game of games) {
    const name = game[key].trim();
    if (!name) {
      continue;
    }
    grouped.set(name, [...(grouped.get(name) ?? []), game.result]);
  }
  return [...grouped.entries()]
    .map(([name, results]) => ({ name, ...recordStats(results) }))
    .sort(sortRecordRows);
}

function deckBattlefieldPairs(games: GameRecord[]): DeckBattlefieldPairStat[] {
  const grouped = new Map<string, { myBattlefield: string; opponentBattlefield: string; results: ResultLike[] }>();
  for (const game of games) {
    if (!game.myBattlefield || !game.opponentBattlefield) {
      continue;
    }
    const key = `${normalizedText(game.myBattlefield)}|||${normalizedText(game.opponentBattlefield)}`;
    const existing = grouped.get(key) ?? { myBattlefield: game.myBattlefield, opponentBattlefield: game.opponentBattlefield, results: [] };
    existing.results.push(game.result);
    grouped.set(key, existing);
  }
  return [...grouped.values()]
    .map((entry) => ({
      myBattlefield: entry.myBattlefield,
      opponentBattlefield: entry.opponentBattlefield,
      ...recordStats(entry.results)
    }))
    .sort(sortRecordRows);
}

function matchGameRecords(match: MatchDraft): GameRecord[] {
  const games = match.games.length ? match.games : [fallbackGame(match)];
  return games.map((game) => ({
    result: game.result || match.result,
    wentFirst: game.wentFirst ?? "",
    myBattlefield: game.myBattlefield || match.myBattlefield,
    opponentBattlefield: game.oppBattlefield || match.opponentBattlefield
  }));
}

function fallbackGame(match: MatchDraft): MatchGame {
  return {
    gameNumber: 1,
    result: match.result,
    myBattlefield: match.myBattlefield,
    oppBattlefield: match.opponentBattlefield,
    wentFirst: ""
  };
}

function seatLabel(value: string): "1st" | "2nd" | "Unknown" {
  return value === "1st" || value === "2nd" ? value : "Unknown";
}

function matchupLabel(matchups: DeckMatchupStat[], mode: "best" | "worst"): string {
  const eligible = matchups.filter((matchup) => matchup.decisive >= 2);
  if (!eligible.length) {
    return "Not enough data";
  }
  const sorted = [...eligible].sort((a, b) => {
    const rate = mode === "best" ? b.winRate - a.winRate : a.winRate - b.winRate;
    return rate || b.total - a.total || a.legend.localeCompare(b.legend);
  });
  const chosen = sorted[0];
  return `${chosen.legend} ${chosen.winRateLabel} (${chosen.record})`;
}

function sortRecordRows<T extends DeckRecordStats>(a: T, b: T): number {
  return b.total - a.total || b.winRate - a.winRate;
}

function capturedAfter(match: MatchDraft, date: Date): boolean {
  const captured = new Date(match.capturedAt);
  return !Number.isNaN(captured.getTime()) && captured >= date;
}

function isCompletedMatch(match: MatchDraft): boolean {
  return match.result === "Win" || match.result === "Loss" || match.result === "Draw";
}

function compareCapturedDesc(a: MatchDraft, b: MatchDraft): number {
  return new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime();
}

function normalizedKey(value: string | undefined): string {
  return normalizedText(value ?? "");
}

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}
