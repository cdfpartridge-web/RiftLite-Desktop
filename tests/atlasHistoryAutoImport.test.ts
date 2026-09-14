import { describe, expect, it, vi } from "vitest";
import { AtlasHistoryAutoImport } from "../src/main/services/atlasHistoryAutoImport";
import { needsAtlasHistoryImport } from "../src/shared/atlasHistory";
import { history, marker, savedMatch } from "./fixtures/atlasHistory";

function harness() {
  let now = 0;
  const match = savedMatch();
  const refresh = vi.fn(async (_id: string) => Object.assign(match, { atlasHistory: history() }));
  const ready = vi.fn(() => true);
  const report = vi.fn();
  const importer = new AtlasHistoryAutoImport({ refresh, ready, report, now: () => now });
  return { match, refresh, ready, report, importer, advance: (ms: number) => { now += ms; } };
}

describe("automatic post-game Atlas decks", () => {
  it("imports a saved capture without a click, then stops once both lists are retained", async () => {
    const h = harness();
    await h.importer.run([h.match]);
    h.advance(60_000);
    await h.importer.run([h.match]);
    expect(h.refresh).toHaveBeenCalledOnce();
    expect(h.match.atlasHistory?.games[0].opponent.availability).toBe("available");
    expect(h.report).toHaveBeenCalledWith(h.match.id, "imported");
  });

  it("catches up after Atlas opens and retries a history entry that appears late", async () => {
    const h = harness();
    h.ready.mockReturnValue(false);
    await h.importer.run([h.match]);
    expect(h.refresh).not.toHaveBeenCalled();
    h.ready.mockReturnValue(true);
    h.refresh.mockRejectedValueOnce(new Error("Sign in or retry after Atlas saves the game"));
    await h.importer.run([h.match]);
    await h.importer.run([h.match]);
    expect(h.refresh).toHaveBeenCalledOnce();
    h.advance(30_000);
    await h.importer.run([h.match]);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    expect(needsAtlasHistoryImport(h.match)).toBe(false);
  });

  it("coalesces concurrent triggers and bounds the work in each background pass", async () => {
    const h = harness();
    const matches = Array.from({ length: 8 }, (_, i) => ({ ...savedMatch(), id: `match-${i}` }));
    await Promise.all([h.importer.run(matches), h.importer.run(matches), h.importer.run(matches)]);
    expect(h.refresh).toHaveBeenCalledTimes(3);
    await h.importer.run(matches);
    expect(h.refresh).toHaveBeenCalledTimes(6);
    expect(new Set(h.refresh.mock.calls.map(([id]) => id)).size).toBe(6);
  });

  it("keeps catching up a partially published BO3 but does not poll a private deck", async () => {
    const h = harness();
    const partial = { ...h.match, atlasHistoryMarkers: [marker, { ...marker, gameNumber: 2, startedAt: marker.startedAt + 600_000 }], atlasHistory: history() };
    expect(needsAtlasHistoryImport(partial)).toBe(true);
    partial.atlasHistory.games.push({ ...history().games[0], gameNumber: 2, startedAt: marker.startedAt + 600_000, opponent: { availability: "private", cards: [] } });
    expect(needsAtlasHistoryImport(partial)).toBe(false);
    partial.atlasHistory.games[1].opponent.availability = "unavailable";
    expect(needsAtlasHistoryImport(partial)).toBe(true);
  });

  it("never imports live, deleted, shared or combined rows, or guesses an old match's identity", async () => {
    const h = harness();
    for (const patch of [
      { status: "pending-review" }, { status: "incomplete" }, { platform: "tcga" },
      { deletedAt: "2026-09-13" }, { combinedFromMatchIds: ["old"] },
      { source: "community" }, { source: "hub" }, { source: "team" }, { atlasHistoryMarkers: [] }
    ]) await h.importer.run([{ ...savedMatch(), ...patch } as ReturnType<typeof savedMatch>]);
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("retries corrected match data immediately and survives a failed lookup without changing results", async () => {
    const h = harness();
    h.refresh.mockRejectedValue(new Error("No matching completed entry yet"));
    const before = structuredClone(h.match);
    await h.importer.run([h.match]);
    expect(h.match).toEqual(before);
    await h.importer.run([{ ...h.match, opponentName: "Corrected name" }]);
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });
});
