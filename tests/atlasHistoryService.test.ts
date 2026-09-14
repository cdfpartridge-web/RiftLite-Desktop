import { describe, expect, it, vi } from "vitest";
import { AtlasHistoryService } from "../src/main/services/atlasHistoryService";
import { deckText, historyRow, savedMatch } from "./fixtures/atlasHistory";

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
});
