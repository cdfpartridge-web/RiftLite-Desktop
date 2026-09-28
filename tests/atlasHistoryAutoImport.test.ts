import { describe, expect, it, vi } from "vitest";
import { AtlasHistoryAutoImport } from "../src/main/services/atlasHistoryAutoImport";
import { needsAtlasHistoryImport } from "../src/shared/atlasHistory";
import type { MatchDraft } from "../src/shared/types";
import { history, marker, savedMatch } from "./fixtures/atlasHistory";

const MINUTE = 60_000;
const fulfilled = (value: MatchDraft): PromiseFulfilledResult<MatchDraft> => ({ status: "fulfilled", value });

function harness() {
  let now = Date.parse(savedMatch().updatedAt);
  const match = savedMatch();
  const refreshMany = vi.fn(async (ids: string[]): Promise<PromiseSettledResult<MatchDraft>[]> =>
    ids.map((id) => fulfilled(Object.assign(id === match.id ? match : { ...match, id }, { atlasHistory: history() }))));
  const ready = vi.fn(() => true);
  const report = vi.fn();
  const deps = { refreshMany, ready, report, now: () => now };
  const importer = new AtlasHistoryAutoImport(deps);
  return { match, refreshMany, ready, report, importer, deps, advance: (ms: number) => { now += ms; },
    waitForHistory: () => refreshMany.mockImplementation(async (ids) => ids.map((id) => fulfilled({ ...match, id }))) };
}

describe("automatic post-game Atlas decks", () => {
  it("imports a saved capture without a click, then stops once both lists are retained", async () => {
    const h = harness();
    await h.importer.run([h.match]);
    h.advance(5 * MINUTE);
    await h.importer.run([h.match]);
    expect(h.refreshMany).toHaveBeenCalledExactlyOnceWith([h.match.id]);
    expect(h.match.atlasHistory?.games[0].opponent.availability).toBe("available");
    expect(h.report).toHaveBeenCalledWith(h.match.id, "imported");
  });

  it("catches up after Atlas opens and waits two minutes before retrying a late history entry", async () => {
    const h = harness();
    h.ready.mockReturnValue(false);
    await h.importer.run([h.match]);
    expect(h.refreshMany).not.toHaveBeenCalled();
    h.ready.mockReturnValue(true);
    h.refreshMany.mockRejectedValueOnce(new Error("Sign in or retry after Atlas saves the game"));
    await h.importer.run([h.match]);
    h.advance(30_000);
    await h.importer.run([h.match]);
    expect(h.refreshMany).toHaveBeenCalledOnce();
    h.advance(90_000);
    await h.importer.run([h.match]);
    expect(h.refreshMany).toHaveBeenCalledTimes(2);
    expect(needsAtlasHistoryImport(h.match)).toBe(false);
  });

  it("coalesces overlapping triggers, batches three matches, and throttles the next pass", async () => {
    const h = harness();
    const matches = Array.from({ length: 8 }, (_, i) => ({ ...savedMatch(), id: `match-${i}` }));
    let finish!: (results: PromiseSettledResult<MatchDraft>[]) => void;
    h.refreshMany.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = h.importer.run(matches);
    expect(h.importer.run(matches)).toBe(first);
    expect(h.importer.run(matches)).toBe(first);
    expect(h.refreshMany).toHaveBeenCalledExactlyOnceWith(["match-0", "match-1", "match-2"]);
    finish(matches.slice(0, 3).map((match) => fulfilled(Object.assign(match, { atlasHistory: history() }))));
    await first;
    h.advance(30_000);
    await h.importer.run(matches);
    expect(h.refreshMany).toHaveBeenCalledOnce();
    h.advance(90_000);
    await h.importer.run(matches);
    expect(h.refreshMany).toHaveBeenLastCalledWith(["match-3", "match-4", "match-5"]);
  });

  it("reports each batch outcome without one failed match preventing another import", async () => {
    const h = harness();
    const matches = Array.from({ length: 3 }, (_, i) => ({ ...savedMatch(), id: `match-${i}` }));
    h.refreshMany.mockResolvedValueOnce([
      { status: "rejected", reason: new Error("History not recorded") },
      fulfilled({ ...matches[1], atlasHistory: history() }),
      fulfilled(matches[2]),
    ]);
    await h.importer.run(matches);
    expect(h.report.mock.calls).toEqual([
      ["match-0", "retrying"], ["match-1", "imported"], ["match-2", "waiting"],
    ]);
  });

  it.each(["unrecorded", "failed"])("stops %s matches after eight attempts with increasing delays", async (state) => {
    const h = harness();
    if (state === "failed") h.refreshMany.mockRejectedValue(new Error("No matching completed entry"));
    else h.waitForHistory();
    await h.importer.run([h.match]);
    for (const [index, minutes] of [2, 5, 15, 30, 60, 120, 240].entries()) {
      h.advance(minutes * MINUTE - 1);
      await h.importer.run([h.match]);
      expect(h.refreshMany).toHaveBeenCalledTimes(index + 1);
      h.advance(1);
      await h.importer.run([h.match]);
      expect(h.refreshMany).toHaveBeenCalledTimes(index + 2);
    }
    h.advance(5 * 60 * MINUTE);
    await h.importer.run([h.match]);
    expect(h.refreshMany).toHaveBeenCalledTimes(8);
  });

  it("allows bounded correction retries without resetting the session attempt count", async () => {
    const h = harness();
    h.waitForHistory();
    const before = structuredClone(h.match);
    await h.importer.run([h.match]);
    expect(h.match).toEqual(before);
    for (let correction = 1; correction <= 12; correction++) {
      h.advance(2 * MINUTE);
      await h.importer.run([{ ...h.match, opponentName: `Corrected name ${correction}` }]);
    }
    expect(h.refreshMany).toHaveBeenCalledTimes(10);
  });

  it("retries a newly retained BO3 marker before a long backoff expires", async () => {
    const h = harness();
    h.waitForHistory();
    await h.importer.run([h.match]);
    h.advance(2 * MINUTE);
    await h.importer.run([h.match]);
    h.advance(2 * MINUTE);
    await h.importer.run([h.match]);
    expect(h.refreshMany).toHaveBeenCalledTimes(2);
    await h.importer.run([{ ...h.match, atlasHistoryMarkers: [marker,
      { ...marker, gameNumber: 2, startedAt: marker.startedAt + 600_000 }] }]);
    expect(h.refreshMany).toHaveBeenCalledTimes(3);
  });

  it("does not reset backoff for imported privacy data, display changes, or reordered evidence", async () => {
    const h = harness();
    h.waitForHistory();
    const partial = { ...h.match,
      games: [...h.match.games, { ...h.match.games[0], gameNumber: 2 }],
      atlasHistoryMarkers: [marker, { ...marker, gameNumber: 2, startedAt: marker.startedAt + 60_000 }],
    };
    await h.importer.run([partial]);
    h.advance(2 * MINUTE);
    await h.importer.run([partial]);
    h.advance(2 * MINUTE);
    const imported = history();
    imported.games[0].opponent = { availability: "private", cards: [] };
    await h.importer.run([{ ...partial, atlasHistory: imported, updatedAt: "2026-01-10T15:00:00.000Z",
      myName: ` ${partial.myName.toUpperCase()} `, notes: "Changed note",
      games: [...partial.games].reverse(), atlasHistoryMarkers: [...partial.atlasHistoryMarkers].reverse(),
    }]);
    expect(h.refreshMany).toHaveBeenCalledTimes(2);
  });

  it("retains the attempt budget while a match is complete and subsequently corrected", async () => {
    const h = harness();
    h.waitForHistory();
    for (let attempt = 0; attempt < 10; attempt++) {
      await h.importer.run([{ ...h.match, opponentName: `Correction ${attempt}` }]);
      h.advance(2 * MINUTE);
    }
    await h.importer.run([{ ...h.match, atlasHistory: history() }]);
    h.advance(2 * MINUTE);
    await h.importer.run([{ ...h.match, opponentName: "Another correction" }]);
    expect(h.refreshMany).toHaveBeenCalledTimes(10);
  });

  it("never restarts old automatic lookups after relaunch or a recent updatedAt write", async () => {
    const h = harness();
    h.waitForHistory();
    await h.importer.run([h.match]);
    h.advance(24 * 60 * MINUTE);
    const restarted = new AtlasHistoryAutoImport(h.deps);
    await restarted.run([{ ...h.match, updatedAt: new Date(h.deps.now()).toISOString() }]);
    expect(h.refreshMany).toHaveBeenCalledOnce();
  });

  it("allows a long BO3 using its recent game marker despite an old capture start", async () => {
    const h = harness();
    h.waitForHistory();
    h.advance(24 * 60 * MINUTE);
    await h.importer.run([{ ...h.match, atlasHistoryMarkers: [marker,
      { ...marker, gameNumber: 2, startedAt: h.deps.now() - 10 * MINUTE }] }]);
    expect(h.refreshMany).toHaveBeenCalledOnce();
  });

  it("falls back to a valid marker for malformed capture dates and rejects far-future evidence", async () => {
    const h = harness();
    h.waitForHistory();
    await h.importer.run([{ ...h.match, capturedAt: "invalid date" }]);
    expect(h.refreshMany).toHaveBeenCalledOnce();
    h.advance(2 * MINUTE);
    await h.importer.run([{ ...h.match, atlasHistoryMarkers: [{ ...marker, startedAt: h.deps.now() + 60 * MINUTE }] }]);
    await h.importer.run([{ ...h.match, capturedAt: new Date(h.deps.now() + 60 * MINUTE).toISOString() }]);
    await h.importer.run([{ ...h.match, capturedAt: "invalid date", atlasHistoryMarkers: [{ ...marker, startedAt: NaN }] }]);
    expect(h.refreshMany).toHaveBeenCalledOnce();
  });

  it("tolerates a small provider clock skew without creating an unbounded date window", async () => {
    const h = harness();
    h.waitForHistory();
    const match = { ...h.match, atlasHistoryMarkers: [{ ...marker, startedAt: h.deps.now() + 4 * MINUTE }] };
    await h.importer.run([match]);
    expect(h.refreshMany).toHaveBeenCalledOnce();
    h.advance(24 * 60 * MINUTE + 4 * MINUTE);
    await new AtlasHistoryAutoImport(h.deps).run([match]);
    expect(h.refreshMany).toHaveBeenCalledOnce();
  });

  it("keeps catching up a partially published BO3 but does not poll a private deck", async () => {
    const h = harness();
    const partial = { ...h.match, atlasHistoryMarkers: [marker, { ...marker, gameNumber: 2, startedAt: marker.startedAt + 600_000 }], atlasHistory: history() };
    expect(needsAtlasHistoryImport(partial)).toBe(true);
    partial.atlasHistory.games.push({ ...history().games[0], gameNumber: 2, startedAt: marker.startedAt + 600_000, opponent: { availability: "private", cards: [] } });
    expect(needsAtlasHistoryImport(partial)).toBe(false);
    await h.importer.run([partial]);
    expect(h.refreshMany).not.toHaveBeenCalled();
    partial.atlasHistory.games[1].opponent.availability = "unavailable";
    expect(needsAtlasHistoryImport(partial)).toBe(true);
  });

  it("never imports live, deleted, shared or combined rows, or guesses an old match's identity", async () => {
    const h = harness();
    for (const patch of [
      { status: "pending-review" }, { status: "incomplete" }, { platform: "tcga" },
      { deletedAt: "2026-09-13" }, { combinedFromMatchIds: ["old"] },
      { source: "community" }, { source: "hub" }, { source: "team" }, { atlasHistoryMarkers: [] },
    ]) await h.importer.run([{ ...savedMatch(), ...patch } as MatchDraft]);
    expect(h.refreshMany).not.toHaveBeenCalled();
  });
});
