import { parseCommunityDeckSnapshot } from "./communityDecks.js";
import { matchGameBattlefields } from "./deckPerformance.js";
import { normalizeLegendName } from "./legendNames.js";
import { localMatchesEligibleForStats } from "./matchList.js";
import type { MatchDraft, MatchGame } from "./types.js";

export interface CoverageCount { known: number; total: number }
export interface DeckDataCompleteness {
  savedMatches: number;
  excludedMatches: number;
  games: number;
  legacySingleGames: number;
  matchesWithoutGameRows: number;
  battlefields: CoverageCount;
  myBattlefields: CoverageCount;
  opponentBattlefields: CoverageCount;
  initiative: CoverageCount;
  scores: CoverageCount;
  storedDeckLists: CoverageCount;
}

export interface SeriesRate { wins: number; total: number }
export type SeriesExclusionReason = "Combined game order unverified" | "Series result is not win/loss" | "Missing or invalid game numbers" | "Incomplete game results" | "Series result does not match its games";
export interface SeriesEvidence { match: MatchDraft; games: MatchGame[] }
export interface LaterGameResult {
  opponent: string;
  initiative: "1st" | "2nd" | "Unknown";
  overall: SeriesRate;
  game2: SeriesRate;
  game3: SeriesRate;
  matchIds: string[];
}
export interface DeckBo3Results {
  considered: number;
  included: SeriesEvidence[];
  excluded: Array<{ match: MatchDraft; reason: SeriesExclusionReason }>;
  gameOne: SeriesRate;
  conversion: SeriesRate;
  comeback: SeriesRate;
  laterGames: LaterGameResult[];
  laterInitiativeUnknown: number;
}

export function buildDeckDataCompleteness(matches: MatchDraft[]): DeckDataCompleteness {
  const saved = localMatchesEligibleForStats(matches);
  let legacySingleGames = 0;
  const rows = saved.flatMap((match) => {
    if (match.games.length) return match.games.map((game) => ({ match, game }));
    // A legacy Bo1 result still identifies one game; an empty Bo3 does not.
    if (match.format === "Bo1") {
      legacySingleGames += 1;
      return [{ match, game: { gameNumber: 1, result: match.result } as MatchGame }];
    }
    return [];
  });
  const count = (predicate: (row: typeof rows[number]) => boolean): CoverageCount => ({ known: rows.filter(predicate).length, total: rows.length });
  const fields = ({ match, game }: typeof rows[number]) => matchGameBattlefields(match, game);
  return {
    savedMatches: saved.length,
    excludedMatches: matches.length - saved.length,
    games: rows.length,
    legacySingleGames,
    matchesWithoutGameRows: saved.filter((match) => !match.games.length && match.format !== "Bo1").length,
    battlefields: count((row) => Boolean(fields(row).myBattlefield && fields(row).opponentBattlefield)),
    myBattlefields: count((row) => Boolean(fields(row).myBattlefield)),
    opponentBattlefields: count((row) => Boolean(fields(row).opponentBattlefield)),
    initiative: count(({ game }) => game.wentFirst === "1st" || game.wentFirst === "2nd"),
    scores: count(({ game }) => knownScore(game.myPoints) && knownScore(game.oppPoints)),
    storedDeckLists: { known: saved.filter((match) => parseCommunityDeckSnapshot(match.deckSnapshotJson ?? "")?.mainDeck.length).length, total: saved.length }
  };
}

export function buildDeckBo3Results(matches: MatchDraft[]): DeckBo3Results {
  const candidates = localMatchesEligibleForStats(matches).filter((match) => match.format === "Bo3");
  const included: SeriesEvidence[] = [];
  const excluded: DeckBo3Results["excluded"] = [];
  for (const match of candidates) {
    const games = [...match.games].sort((a, b) => a.gameNumber - b.gameNumber);
    const reason = seriesExclusion(match, games);
    if (reason) excluded.push({ match, reason });
    else included.push({ match, games });
  }
  const wonFirst = included.filter(({ games }) => games[0].result === "Win");
  const lostFirst = included.filter(({ games }) => games[0].result === "Loss");
  const wonMatch = (rows: SeriesEvidence[]): SeriesRate => ({ wins: rows.filter(({ match }) => match.result === "Win").length, total: rows.length });
  const later = new Map<string, LaterGameResult>();
  let laterInitiativeUnknown = 0;
  for (const { match, games } of included) {
    for (const game of games.slice(1)) {
      const opponent = normalizeLegendName(match.opponentChampion) || "Unknown opponent";
      const initiative = game.wentFirst === "1st" || game.wentFirst === "2nd" ? game.wentFirst : "Unknown";
      if (initiative === "Unknown") laterInitiativeUnknown += 1;
      const key = `${opponent}|${initiative}`;
      const row = later.get(key) ?? { opponent, initiative, overall: emptyRate(), game2: emptyRate(), game3: emptyRate(), matchIds: [] };
      for (const rate of [row.overall, game.gameNumber === 2 ? row.game2 : row.game3]) {
        rate.total += 1;
        rate.wins += game.result === "Win" ? 1 : 0;
      }
      if (!row.matchIds.includes(match.id)) row.matchIds.push(match.id);
      later.set(key, row);
    }
  }
  return {
    considered: candidates.length,
    included,
    excluded,
    gameOne: { wins: wonFirst.length, total: included.length },
    conversion: wonMatch(wonFirst),
    comeback: wonMatch(lostFirst),
    laterGames: [...later.values()].sort((a, b) => b.overall.total - a.overall.total || a.opponent.localeCompare(b.opponent) || a.initiative.localeCompare(b.initiative)),
    laterInitiativeUnknown
  };
}

function seriesExclusion(match: MatchDraft, games: MatchGame[]): SeriesExclusionReason | null {
  if (match.combinedFromMatchIds?.length) return "Combined game order unverified";
  if (match.result !== "Win" && match.result !== "Loss") return "Series result is not win/loss";
  if (games.length < 2 || games.length > 3 || games.some((game, index) => game.gameNumber !== index + 1)) return "Missing or invalid game numbers";
  if (games.some((game) => game.result !== "Win" && game.result !== "Loss")) return "Incomplete game results";
  let wins = 0;
  let losses = 0;
  for (const [index, game] of games.entries()) {
    if (game.result === "Win") wins += 1;
    else losses += 1;
    if (index < games.length - 1 && (wins === 2 || losses === 2)) return "Series result does not match its games";
  }
  const headline = match.score.trim().match(/^(\d+)\s*[-–:]\s*(\d+)$/);
  if (Math.max(wins, losses) !== 2 || (match.result === "Win") !== (wins === 2) || !headline || Number(headline[1]) !== wins || Number(headline[2]) !== losses) {
    return "Series result does not match its games";
  }
  return null;
}

function emptyRate(): SeriesRate { return { wins: 0, total: 0 }; }
function knownScore(value: unknown): boolean { return typeof value === "number" && Number.isInteger(value) && value >= 0; }
