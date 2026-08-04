export type MatchupMatrixInput = {
  id: string;
  myChampion: string;
  opponentChampion: string;
  result: string;
};

export type MatchupMatrixCohort<T extends MatchupMatrixInput> = {
  wins: number;
  losses: number;
  draws: number;
  total: number;
  matches: T[];
};

export type MatchupMatrixCell<T extends MatchupMatrixInput> = {
  wins: number;
  losses: number;
  draws: number;
  total: number;
  winRate: number;
  matches: T[];
  /** Rows submitted with the cell's row legend as the player's legend. */
  direct: MatchupMatrixCohort<T>;
  /** Rows submitted with the cell's column legend as the player's legend. */
  reverse: MatchupMatrixCohort<T>;
};

export type MatchupMatrix<T extends MatchupMatrixInput> = {
  rows: string[];
  cols: string[];
  lookup: Map<string, MatchupMatrixCell<T>>;
  rowTotals: Map<string, number>;
};

function emptyCohort<T extends MatchupMatrixInput>(): MatchupMatrixCohort<T> {
  return { wins: 0, losses: 0, draws: 0, total: 0, matches: [] };
}

function addNativeResult<T extends MatchupMatrixInput>(cohort: MatchupMatrixCohort<T>, match: T): void {
  if (match.result === "Win") cohort.wins += 1;
  if (match.result === "Loss") cohort.losses += 1;
  if (match.result === "Draw") cohort.draws += 1;
  cohort.total += 1;
  cohort.matches.push(match);
}

function pooledCell<T extends MatchupMatrixInput>(
  direct: MatchupMatrixCohort<T>,
  reverse: MatchupMatrixCohort<T>,
  winRate: number
): MatchupMatrixCell<T> {
  return {
    wins: direct.wins + reverse.losses,
    losses: direct.losses + reverse.wins,
    draws: direct.draws + reverse.draws,
    total: direct.total + reverse.total,
    winRate,
    matches: [...direct.matches, ...reverse.matches],
    direct,
    reverse
  };
}

/**
 * Builds a square matchup matrix from both submitted perspectives.
 *
 * For A vs B, native A submissions are combined with native B submissions
 * after reversing the latter's wins and losses. The paired B vs A cell is
 * created from the same totals, guaranteeing an exactly complementary rate.
 * Mirror submissions stay single-counted because there is no reverse cohort.
 */
export function buildSymmetricMatchupMatrix<T extends MatchupMatrixInput>(matches: T[]): MatchupMatrix<T> {
  const directed = new Map<string, MatchupMatrixCohort<T>>();
  const rowTotals = new Map<string, number>();

  for (const match of matches) {
    const my = match.myChampion.trim();
    const opponent = match.opponentChampion.trim();
    if (!my || !opponent || match.result === "Incomplete") {
      continue;
    }

    const key = `${my}|||${opponent}`;
    const cohort = directed.get(key) ?? emptyCohort<T>();
    addNativeResult(cohort, match);
    directed.set(key, cohort);

    rowTotals.set(my, (rowTotals.get(my) ?? 0) + 1);
    if (opponent !== my) {
      rowTotals.set(opponent, (rowTotals.get(opponent) ?? 0) + 1);
    }
  }

  const legends = [...rowTotals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([legend]) => legend);
  const lookup = new Map<string, MatchupMatrixCell<T>>();

  for (let rowIndex = 0; rowIndex < legends.length; rowIndex += 1) {
    const rowLegend = legends[rowIndex];
    for (let columnIndex = rowIndex; columnIndex < legends.length; columnIndex += 1) {
      const columnLegend = legends[columnIndex];
      const direct = directed.get(`${rowLegend}|||${columnLegend}`) ?? emptyCohort<T>();

      if (rowLegend === columnLegend) {
        if (!direct.total) {
          continue;
        }
        const decisive = direct.wins + direct.losses;
        const winRate = decisive ? Math.round((direct.wins / decisive) * 1_000) / 10 : 50;
        lookup.set(
          `${rowLegend}|||${columnLegend}`,
          pooledCell(direct, emptyCohort<T>(), winRate)
        );
        continue;
      }

      const reverse = directed.get(`${columnLegend}|||${rowLegend}`) ?? emptyCohort<T>();
      if (!direct.total && !reverse.total) {
        continue;
      }

      const rowWins = direct.wins + reverse.losses;
      const rowLosses = direct.losses + reverse.wins;
      const decisive = rowWins + rowLosses;
      const rowRateTenths = decisive ? Math.round((rowWins / decisive) * 1_000) : 500;
      const rowCell = pooledCell(direct, reverse, rowRateTenths / 10);
      const columnCell = pooledCell(reverse, direct, (1_000 - rowRateTenths) / 10);
      lookup.set(`${rowLegend}|||${columnLegend}`, rowCell);
      lookup.set(`${columnLegend}|||${rowLegend}`, columnCell);
    }
  }

  return { rows: legends, cols: [...legends], lookup, rowTotals };
}
