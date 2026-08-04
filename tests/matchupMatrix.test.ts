import { describe, expect, it } from "vitest";
import { buildSymmetricMatchupMatrix, type MatchupMatrixInput } from "../src/shared/matchupMatrix";

function rows(
  count: number,
  myChampion: string,
  opponentChampion: string,
  result: "Win" | "Loss" | "Draw",
  prefix: string
): MatchupMatrixInput[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    myChampion,
    opponentChampion,
    result
  }));
}

describe("symmetric matchup matrix", () => {
  it("pools both native cohorts and inverts the reverse cohort", () => {
    const matrix = buildSymmetricMatchupMatrix([
      ...rows(10, "Rek'Sai", "Kennen", "Win", "rek-win"),
      ...rows(1, "Rek'Sai", "Kennen", "Loss", "rek-loss"),
      ...rows(12, "Kennen", "Rek'Sai", "Win", "kennen-win"),
      ...rows(10, "Kennen", "Rek'Sai", "Loss", "kennen-loss")
    ]);

    const rekSai = matrix.lookup.get("Rek'Sai|||Kennen");
    const kennen = matrix.lookup.get("Kennen|||Rek'Sai");

    expect(rekSai).toMatchObject({ wins: 20, losses: 13, draws: 0, total: 33, winRate: 60.6 });
    expect(rekSai?.direct).toMatchObject({ wins: 10, losses: 1, total: 11 });
    expect(rekSai?.reverse).toMatchObject({ wins: 12, losses: 10, total: 22 });
    expect(kennen).toMatchObject({ wins: 13, losses: 20, draws: 0, total: 33, winRate: 39.4 });
    expect((rekSai?.winRate ?? 0) + (kennen?.winRate ?? 0)).toBe(100);
  });

  it("uses identical axes even when a legend only appears as an opponent", () => {
    const matrix = buildSymmetricMatchupMatrix(rows(2, "Ahri", "Viktor", "Win", "only-direction"));

    expect(matrix.rows).toEqual(matrix.cols);
    expect(matrix.rows).toEqual(["Ahri", "Viktor"]);
    expect(matrix.lookup.get("Viktor|||Ahri")).toMatchObject({ wins: 0, losses: 2, total: 2, winRate: 0 });
  });

  it("single-counts mirror rows and excludes incomplete rows", () => {
    const matrix = buildSymmetricMatchupMatrix([
      ...rows(2, "Jinx", "Jinx", "Win", "mirror-win"),
      ...rows(1, "Jinx", "Jinx", "Loss", "mirror-loss"),
      { id: "incomplete", myChampion: "Jinx", opponentChampion: "Jinx", result: "Incomplete" }
    ]);
    const mirror = matrix.lookup.get("Jinx|||Jinx");

    expect(mirror).toMatchObject({ wins: 2, losses: 1, total: 3, winRate: 66.7 });
    expect(mirror?.matches).toHaveLength(3);
    expect(mirror?.direct.total).toBe(3);
    expect(mirror?.reverse.total).toBe(0);
    expect(matrix.rowTotals.get("Jinx")).toBe(3);
  });

  it("keeps draws in sample totals while weighting win rate by decisive games", () => {
    const matrix = buildSymmetricMatchupMatrix([
      ...rows(1, "Kai'Sa", "Sett", "Win", "win"),
      ...rows(8, "Kai'Sa", "Sett", "Draw", "draw"),
      ...rows(1, "Sett", "Kai'Sa", "Loss", "reverse-loss")
    ]);
    const cell = matrix.lookup.get("Kai'Sa|||Sett");

    expect(cell).toMatchObject({ wins: 2, losses: 0, draws: 8, total: 10, winRate: 100 });
    expect(matrix.lookup.get("Sett|||Kai'Sa")?.winRate).toBe(0);
  });
});
