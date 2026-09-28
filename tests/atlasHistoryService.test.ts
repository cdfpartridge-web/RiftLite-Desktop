import { describe, expect, it, vi } from "vitest";
import { AtlasHistoryService } from "../src/main/services/atlasHistoryService";
import { deckText, history, historyRow, savedMatch, startedAt } from "./fixtures/atlasHistory";
import type { AtlasHistoryMarker, AtlasMatchHistory } from "../src/shared/atlasHistory";
import type { MatchDraft } from "../src/shared/types";

function harness(rows: unknown[] = [historyRow()]) {
  const match = savedMatch();
  const getMatch = vi.fn(async () => match);
  const query = vi.fn(async (script: string) => ({
    sessionId: "session-1",
    value: script.includes('"path":"gameHistory:list"')
      ? { page: rows, isDone: true, continueCursor: "" }
      : [
          { playerId: "me", decklist: deckText },
          { playerId: "opp", decklist: deckText },
        ],
  }));
  const save = vi.fn(async (_id, atlasHistory, atlasHistoryMarkers) => ({
    ...match,
    atlasHistory,
    atlasHistoryMarkers,
  }));
  return {
    match,
    query,
    save,
    service: new AtlasHistoryService({ getMatch, query, save, readRawForMatch: vi.fn() }),
  };
}

function target(number: number) {
  const timestamp = startedAt + number * 60_000;
  const match = savedMatch();
  match.id = `match-${number}`;
  match.atlasHistoryMarkers = [{ gameNumber: 1, startedAt: timestamp, roomCode: `ROOM${number}` }];
  return { match, row: historyRow({ id: `history-${number}`, startedAt: timestamp, endedAt: timestamp + 30_000 }) };
}

function batchHarness(
  matches: MatchDraft[],
  pages: Array<{ page: unknown[]; isDone?: boolean; continueCursor?: string }>,
) {
  let pageNumber = 0;
  const getMatch = vi.fn(async (id: string) => matches.find((match) => match.id === id));
  const readRawForMatch = vi.fn();
  const query = vi.fn(async (script: string): Promise<unknown> => ({
    sessionId: "session-1",
    value: script.includes('"path":"gameHistory:list"')
      ? pages[Math.min(pageNumber++, pages.length - 1)]
      : [{ playerId: "me", decklist: deckText }, { playerId: "opp", decklist: deckText }],
  }));
  const save = vi.fn(async (id: string, atlasHistory: AtlasMatchHistory, atlasHistoryMarkers: AtlasHistoryMarker[]) => ({
    ...matches.find((match) => match.id === id)!, atlasHistory, atlasHistoryMarkers,
  }));
  return {
    query, save, getMatch, readRawForMatch,
    lists: () => query.mock.calls.filter(([script]) => script.includes('"path":"gameHistory:list"')),
    decks: () => query.mock.calls.filter(([script]) => script.includes('"path":"gameHistory:decks"')),
    service: new AtlasHistoryService({ getMatch, readRawForMatch, query, save }),
  };
}
describe("Atlas history import", () => {
  it("coalesces repeated clicks and fetches decks only for exact completed matches", async () => {
    const h = harness([
      historyRow({ id: "other", startedAt: historyRow().startedAt - 10 }),
      historyRow(),
      historyRow({ id: "live", status: "in_progress" }),
    ]);
    const [a, b] = await Promise.all([h.service.refresh(h.match.id), h.service.refresh(h.match.id)]);
    expect(a).toEqual(b);
    expect(a.atlasHistory.games[0].opponent.availability).toBe("available");
    expect(h.query).toHaveBeenCalledTimes(2);
    expect(h.query.mock.calls[1][0]).toContain('"gameId":"history-1"');
    expect(h.save).toHaveBeenCalledOnce();
  });
  it("retains the user's saved result and honours the opponent privacy setting", async () => {
    const row = historyRow();
    row.players[1].deckPrivate = true;
    const h = harness([row]);
    const result = await h.service.refresh(h.match.id);
    expect(result.notes).toBe(h.match.notes);
    expect(result.games).toEqual(h.match.games);
    expect(result.sync).toEqual(h.match.sync);
    expect(result.atlasHistory.games[0].opponent).toEqual({ availability: "private", cards: [] });
  });
  it("aborts without saving on an Atlas account switch", async () => {
    const h = harness();
    h.query.mockResolvedValueOnce({
      sessionId: "session-1",
      value: { page: [historyRow()], isDone: true },
    } as never);
    h.query.mockResolvedValueOnce({ sessionId: "session-2", value: [] } as never);
    await expect(h.service.refresh(h.match.id)).rejects.toThrow("account changed");
    expect(h.save).not.toHaveBeenCalled();
  });
  it("rejects duplicate matching history entries and never guesses from scores alone", async () => {
    const h = harness([historyRow(), historyRow({ id: "duplicate" })]);
    await expect(h.service.refresh(h.match.id)).rejects.toThrow("More than one");
    expect(h.save).not.toHaveBeenCalled();
    const other = harness([historyRow({ startedAt: historyRow().startedAt + 1 })]);
    await expect(other.service.refresh(other.match.id)).rejects.toThrow("No completed");
    expect(other.query).toHaveBeenCalledOnce();
  });
  it("does not query unsaved, deleted or combined matches", async () => {
    for (const patch of [
      { status: "pending-review" },
      { deletedAt: new Date().toISOString() },
      { combinedFromMatchIds: ["old"] },
    ]) {
      const h = harness();
      Object.assign(h.match, patch);
      await expect(h.service.refresh(h.match.id)).rejects.toThrow("Save the original");
      expect(h.query).not.toHaveBeenCalled();
    }
  });

  it("shares one paginated history traversal across three distinct targets", async () => {
    const targets = [target(1), target(2), target(3)];
    const h = batchHarness(targets.map(({ match }) => match), [
      { page: [targets[2].row, targets[1].row], continueCursor: "second-page" },
      { page: [targets[0].row], isDone: true },
    ]);
    const results = await h.service.refreshMany(targets.map(({ match }) => match.id));
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    expect(results.map((result) => result.status === "fulfilled" && result.value.id))
      .toEqual(targets.map(({ match }) => match.id));
    expect(h.lists()).toHaveLength(2);
    expect(h.lists()[0][0]).toContain('"numItems":20,"cursor":null');
    expect(h.lists()[1][0]).toContain('"numItems":20,"cursor":"second-page"');
    expect(h.decks()).toHaveLength(3);
    expect(h.save).toHaveBeenCalledTimes(3);
  });

  it("preserves result order and imports valid targets despite absent, invalid and unmatched neighbours", async () => {
    const good = target(1), absentHistory = target(2), invalid = target(3);
    invalid.match.deletedAt = "2026-01-10T14:00:00.000Z";
    const h = batchHarness([good.match, absentHistory.match, invalid.match], [{ page: [good.row], isDone: true }]);
    const results = await h.service.refreshMany(["unknown-id", good.match.id, invalid.match.id, absentHistory.match.id]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled", "rejected", "rejected"]);
    expect(results[1]).toMatchObject({ status: "fulfilled", value: { id: good.match.id } });
    expect(results[3]).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: expect.stringContaining("No completed") }) });
    expect(h.lists()).toHaveLength(1);
    expect(h.decks()).toHaveLength(1);
    expect(h.save).toHaveBeenCalledOnce();
  });

  it.each(["solo", "in-progress"])("stops at an older %s raw row even though it cannot be imported", async (kind) => {
    const current = target(2);
    const old = historyRow({
      id: "older-unimportable", startedAt: current.row.startedAt - 1,
      ...(kind === "solo" ? { players: [current.row.players[0]] } : { status: "in_progress", endedAt: undefined }),
    });
    const h = batchHarness([current.match], [
      { page: [current.row, old], continueCursor: "unneeded-page" },
      { page: [], isDone: true },
    ]);
    expect((await h.service.refreshMany([current.match.id]))[0].status).toBe("fulfilled");
    expect(h.lists()).toHaveLength(1);
    expect(h.decks()).toHaveLength(1);
  });

  it("checks the entire boundary page for duplicate matches before reading decks", async () => {
    const current = target(2);
    const h = batchHarness([current.match], [{
      page: [current.row, { ...current.row, id: "duplicate" }, { startedAt: current.row.startedAt - 1 }],
      continueCursor: "unneeded-page",
    }]);
    await expect(h.service.refresh(current.match.id)).rejects.toThrow("More than one");
    expect(h.lists()).toHaveLength(1);
    expect(h.decks()).toHaveLength(0);
    expect(h.save).not.toHaveBeenCalled();
  });

  it("continues across equal timestamps and rejects a duplicate on the next page before reading decks", async () => {
    const current = target(2);
    const h = batchHarness([current.match], [
      { page: [current.row], continueCursor: "equal-timestamp" },
      { page: [{ ...current.row, id: "duplicate" }, { startedAt: current.row.startedAt - 1 }], continueCursor: "older" },
    ]);
    await expect(h.service.refresh(current.match.id)).rejects.toThrow("More than one");
    expect(h.lists()).toHaveLength(2);
    expect(h.decks()).toHaveLength(0);
    expect(h.save).not.toHaveBeenCalled();
  });

  it.each(["malformed", "out-of-order"])("disables date stopping after %s timestamps", async (kind) => {
    const current = target(2);
    const invalid = { startedAt: kind === "malformed" ? "not-a-date" : current.row.startedAt + 1 };
    const h = batchHarness([current.match], [
      { page: [current.row, invalid, { startedAt: current.row.startedAt - 1 }], continueCursor: "must-check" },
      { page: [{ ...current.row, id: "duplicate" }], isDone: true },
    ]);
    await expect(h.service.refresh(current.match.id)).rejects.toThrow("More than one");
    expect(h.lists()).toHaveLength(2);
    expect(h.decks()).toHaveLength(0);
  });

  it("caps history traversal at five pages when there is no reliable date boundary", async () => {
    const current = target(1);
    const h = batchHarness([current.match], Array.from({ length: 6 }, (_, index) => ({
      page: index === 0 ? [current.row, { startedAt: "invalid" }] : [],
      continueCursor: `page-${index + 1}`,
    })));
    expect((await h.service.refreshMany([current.match.id]))[0].status).toBe("fulfilled");
    expect(h.lists()).toHaveLength(5);
    expect(h.decks()).toHaveLength(1);
  });

  it.each([
    { description: "repeated", cursors: ["page-a", "page-a"] },
    { description: "cyclic", cursors: ["page-a", "page-b", "page-a"] },
  ])("stops on $description cursors without repeating the traversal", async ({ cursors }) => {
    const current = target(1);
    const h = batchHarness([current.match], cursors.map((continueCursor, index) => ({
      page: index === 0 ? [current.row, { startedAt: "invalid" }] : [],
      continueCursor,
    })));
    expect((await h.service.refreshMany([current.match.id]))[0].status).toBe("fulfilled");
    expect(h.lists()).toHaveLength(cursors.length);
    expect(h.decks()).toHaveLength(1);
  });

  it("fetches a shared history entry's decks once even when two local targets refer to it", async () => {
    const current = target(1);
    const duplicateLocal = { ...structuredClone(current.match), id: "second-local-record" };
    const h = batchHarness([current.match, duplicateLocal], [{ page: [current.row], isDone: true }]);
    const results = await h.service.refreshMany([current.match.id, duplicateLocal.id]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(h.decks()).toHaveLength(1);
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it("aborts all saves when the account changes on a later game's deck lookup", async () => {
    const first = target(1), second = target(2);
    const h = batchHarness([first.match, second.match], [{ page: [second.row, first.row], isDone: true }]);
    h.query.mockResolvedValueOnce({ sessionId: "session-1", value: { page: [second.row, first.row], isDone: true } });
    h.query.mockResolvedValueOnce({ sessionId: "session-1", value: [{ playerId: "me", decklist: deckText }, { playerId: "opp", decklist: deckText }] });
    h.query.mockResolvedValueOnce({ sessionId: "session-2", value: [{ playerId: "me", decklist: deckText }] });
    const results = await h.service.refreshMany([first.match.id, second.match.id]);
    expect(results).toHaveLength(2);
    for (const result of results) expect(result).toMatchObject({
      status: "rejected", reason: expect.objectContaining({ message: expect.stringContaining("account changed") }),
    });
    expect(h.decks()).toHaveLength(2);
    expect(h.save).not.toHaveBeenCalled();
  });

  it("coalesces a pending manual refresh with a batch for the same match", async () => {
    const current = target(1);
    const h = batchHarness([current.match], [{ page: [current.row], isDone: true }]);
    const [manual, automatic] = await Promise.all([
      h.service.refresh(current.match.id), h.service.refreshMany([current.match.id]),
    ]);
    expect(automatic).toEqual([{ status: "fulfilled", value: manual }]);
    expect(h.lists()).toHaveLength(1);
    expect(h.decks()).toHaveLength(1);
    expect(h.save).toHaveBeenCalledOnce();
  });

  it("clears shared pending work after failure so a later refresh can succeed", async () => {
    const current = target(1);
    const h = batchHarness([current.match], [{ page: [current.row], isDone: true }]);
    h.query.mockRejectedValueOnce(new Error("temporary offline"));
    const automatic = h.service.refreshMany([current.match.id]);
    const manual = h.service.refresh(current.match.id);
    const [batchResult, manualResult] = await Promise.all([automatic, Promise.allSettled([manual])]);
    expect(batchResult[0]).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: "temporary offline" }) });
    expect(manualResult).toEqual(batchResult);
    expect(h.query).toHaveBeenCalledOnce();
    expect((await h.service.refreshMany([current.match.id]))[0].status).toBe("fulfilled");
    expect(h.lists()).toHaveLength(2);
    expect(h.decks()).toHaveLength(1);
    expect(h.save).toHaveBeenCalledOnce();
  });

  it("fetches only a missing BO3 game's decks while retaining earlier completed private results", async () => {
    const match = savedMatch();
    match.format = "Bo3";
    match.atlasHistory = history();
    match.atlasHistory.games[0].opponent = { availability: "private", cards: [] };
    const nextMarker = { gameNumber: 2, startedAt: startedAt + 600_000, roomCode: "ROOM2" };
    match.atlasHistoryMarkers!.push(nextMarker);
    match.games.push({ ...match.games[0], gameNumber: 2 });
    const secondRow = historyRow({ id: "history-2", ...nextMarker, endedAt: nextMarker.startedAt + 30_000 });
    const h = batchHarness([match], [{ page: [secondRow, historyRow()], isDone: true }]);
    const results = await h.service.refreshMany([match.id]);
    expect(results[0].status).toBe("fulfilled");
    expect(h.decks()).toHaveLength(1);
    expect(h.decks()[0][0]).toContain('"gameId":"history-2"');
    expect(h.save.mock.calls[0][1].games).toHaveLength(2);
    expect(h.save.mock.calls[0][1].games[0]).toEqual(match.atlasHistory.games[0]);
  });

  it.each(["available", "private"] as const)("allows explicit refresh of a completed %s deck after automatic work stops", async (availability) => {
    const match = savedMatch();
    match.atlasHistory = history();
    if (availability === "private") match.atlasHistory.games[0].opponent = { availability, cards: [] };
    const h = batchHarness([match], [{ page: [historyRow()], isDone: true }]);
    expect((await h.service.refreshMany([match.id]))[0].status).toBe("fulfilled");
    expect(h.query).not.toHaveBeenCalled();
    const refreshed = await h.service.refresh(match.id);
    expect(refreshed.atlasHistory!.games[0].opponent.availability).toBe("available");
    expect(h.lists()).toHaveLength(1);
    expect(h.decks()).toHaveLength(1);
  });

  it("imports the owner's deck despite row privacy flags and stops after retaining the opponent's private result", async () => {
    const match = savedMatch();
    const row = historyRow();
    row.players.forEach((player) => { player.deckPrivate = true; });
    const h = batchHarness([match], [{ page: [row], isDone: true }]);
    const results = await h.service.refreshMany([match.id]);
    expect(results[0].status).toBe("fulfilled");
    const retained = h.save.mock.calls[0][1];
    expect(retained.games[0].me.availability).toBe("available");
    expect(retained.games[0].me.cards.length).toBeGreaterThan(0);
    expect(retained.games[0].opponent).toEqual({ availability: "private", cards: [] });
    match.atlasHistory = retained;
    await h.service.refreshMany([match.id]);
    expect(h.lists()).toHaveLength(1);
    expect(h.decks()).toHaveLength(1);
    expect(h.save).toHaveBeenCalledOnce();
  });

  it("still treats an explicit private deck response for the owner as final", async () => {
    const match = savedMatch();
    const h = batchHarness([match], [{ page: [historyRow()], isDone: true }]);
    h.query.mockResolvedValueOnce({ sessionId: "session-1", value: { page: [historyRow()], isDone: true } });
    h.query.mockResolvedValueOnce({ sessionId: "session-1", value: [
      { playerId: "me", private: true, decklist: deckText },
      { playerId: "opp", decklist: deckText },
    ] });
    await h.service.refreshMany([match.id]);
    match.atlasHistory = h.save.mock.calls[0][1];
    expect(match.atlasHistory.games[0].me).toEqual({ availability: "private", cards: [] });
    expect(match.atlasHistory.games[0].opponent.availability).toBe("available");
    await h.service.refreshMany([match.id]);
    expect(h.query).toHaveBeenCalledTimes(2);
  });
});
