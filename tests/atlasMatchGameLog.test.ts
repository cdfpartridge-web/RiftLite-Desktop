import { describe, expect, it, vi } from "vitest";
import { atlasGameLogActor, atlasGameLogText, canReadAtlasMatchGameLog, loadAtlasMatchGameLog } from "../src/shared/atlasMatchGameLog";
import type { AtlasGameLog } from "../src/shared/atlasGameLog";
import type { ReplayRecord } from "../src/shared/types";
import { savedMatch } from "./fixtures/atlasHistory";

function replay(matchId = "irelia-match"): ReplayRecord {
  return {
    id: `replay-${matchId}`, matchId, platform: "atlas", capturedAt: "2026-01-10T12:00:00Z",
    title: "Test match", players: { me: "Local", opponent: "Opponent" }, events: [],
    rawCapture: { localPath: "retained.json" } as ReplayRecord["rawCapture"]
  };
}
function payload(text = "Scored 1 at turn start. Score: 6 → 7.") {
  return { messages: [{ seq: 1, ts: Date.parse("2026-01-10T12:00:00Z"), dir: "in", raw: JSON.stringify({
    type: "authoritative_snapshot", roomCode: "ROOM1", gameNumber: 1,
    snapshot: { room: { gameNumber: 1, roomCode: "ROOM1" } },
    gameplayLog: [{ id: "log-1", text, at: Date.parse("2026-01-10T12:00:00Z") }]
  }) }] };
}

describe("desktop match game-log loading", () => {
  it("does not retrieve evidence for a match whose replay was discarded", async () => {
    const read = vi.fn();
    const result = await loadAtlasMatchGameLog({ ...savedMatch(), keepReplay: false }, [{ matchId: "irelia-match", replay: replay() }], read);
    expect(read).not.toHaveBeenCalled();
    expect(result.games).toEqual([]);
  });

  it("reads retained captures on demand and preserves the original text", async () => {
    const read = vi.fn(async () => payload());
    const result = await loadAtlasMatchGameLog(savedMatch(), [{ matchId: "irelia-match", replay: replay() }], read);
    expect(read).toHaveBeenCalledExactlyOnceWith("replay-irelia-match");
    expect(result.source).toBe("raw");
    expect(result.games.flatMap((game) => game.entries).map((entry) => entry.text)).toEqual(["Scored 1 at turn start. Score: 6 → 7."]);
  });

  it("keeps a combined match's original game numbers when one segment is missing", async () => {
    const match = { ...savedMatch(), id: "combined", combinedFromMatchIds: ["first", "missing", "third"] };
    const result = await loadAtlasMatchGameLog(match, [
      { matchId: "first", replay: replay("first") }, { matchId: "third", replay: replay("third") }
    ], async () => payload("Moved Qiyana to trash."));
    expect(result.games.map((game) => game.gameNumber)).toEqual([1, 3]);
    expect(new Set(result.games.map((game) => game.id)).size).toBe(2);
    expect(result.partial).toBe(true);
  });

  it("uses retained rows when the sidecar cannot be opened", async () => {
    const record = replay();
    record.events = [{ id: "capture-1", platform: "atlas", kind: "match-snapshot", capturedAt: record.capturedAt, payload: {
      rows: [{ key: "riftlite-log:g1:dom:1:one", text: "12:00 Moved Qiyana to trash.", observedAt: record.capturedAt }]
    } }];
    const result = await loadAtlasMatchGameLog(savedMatch(), [{ matchId: "irelia-match", replay: record }], async () => { throw new Error("File missing"); });
    expect(result.partial).toBe(true);
    expect(result.games.flatMap((game) => game.entries).some((entry) => entry.text.includes("Moved Qiyana"))).toBe(true);
  });

  it("does not open deleted or non-Atlas replay captures", async () => {
    const read = vi.fn();
    await loadAtlasMatchGameLog(savedMatch(), [
      { matchId: "irelia-match", replay: { ...replay(), deletedAt: "2026-01-11" } },
      { matchId: "other", replay: { ...replay("other"), platform: "tcga" } }
    ], read);
    expect(read).not.toHaveBeenCalled();
  });

  it("allows retained later games when a combined row inherits the discarded first game's flag", async () => {
    const match = { ...savedMatch(), id: "combined", keepReplay: false, combinedFromMatchIds: ["first", "second"] };
    const discarded = { ...replay("first"), matchSnapshot: { ...savedMatch(), keepReplay: false } };
    const segments = [{ matchId: "first", replay: discarded }, { matchId: "second", replay: replay("second") }];
    const read = vi.fn(async () => payload());
    expect(canReadAtlasMatchGameLog(match, segments)).toBe(true);
    const result = await loadAtlasMatchGameLog(match, segments, read);
    expect(read).toHaveBeenCalledExactlyOnceWith("replay-second");
    expect(result.games.map((game) => game.gameNumber)).toEqual([2]);
    expect(result.partial).toBe(true);
  });

  it("matches combine repair by taking only the first game from each original row", async () => {
    const match = { ...savedMatch(), id: "combined", combinedFromMatchIds: ["first", "second"] };
    const multi = payload("First source game.");
    multi.messages.push({ seq: 2, ts: Date.parse("2026-01-10T12:10:00Z"), dir: "in", raw: JSON.stringify({
      type: "authoritative_snapshot", roomCode: "ROOM2", gameNumber: 2,
      snapshot: { gameNumber: 2 }, gameplayLog: [{ id: "log-2", text: "Unselected source game." }]
    }) });
    const result = await loadAtlasMatchGameLog(match, [
      { matchId: "first", replay: replay("first") }, { matchId: "second", replay: replay("second") }
    ], async (id) => id === "replay-first" ? multi : payload("Second selected row."));
    expect(result.games.map((game) => game.gameNumber)).toEqual([1, 2]);
    expect(atlasGameLogText(result)).not.toContain("Unselected source game");
  });
});

describe("copyable game log", () => {
  const log: AtlasGameLog = { source: "raw", partial: false, games: [
    { id: "one", gameNumber: 1, entries: [{ id: "1", time: "12:00", actor: "Player", text: "Moved Qiyana to trash." }] },
    { id: "two", gameNumber: 2, entries: [{ id: "2", time: "12:10", text: "Scored 1 point." }] }
  ] };
  it("copies the selected game and searches across text and actor", () => {
    expect(atlasGameLogText(log, "two")).toBe("Game 2\n12:10 Scored 1 point.");
    expect(atlasGameLogText(log, "", "PLAYER")).toBe("Game 1\n12:00 Player: Moved Qiyana to trash.");
    expect(atlasGameLogText(log, "", "missing")).toBe("");
  });
  it("does not repeat a player name already present in the original text", () => {
    expect(atlasGameLogActor({ id: "1", time: "", actor: "Player", text: "Player locked in a battlefield." })).toBe("");
    expect(atlasGameLogActor({ id: "2", time: "", actor: "Ann", text: "Annex was played." })).toBe("Ann");
  });
});
