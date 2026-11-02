import { describe, expect, it, vi } from "vitest";
import { AtlasPostgameAutoImport, AtlasPostgameDeferredError, atlasPostgameGameKey, extractAtlasPostgameTargets, type AtlasPostgameTarget } from "../src/main/services/atlasPostgameAutoImport";
import type { AtlasPostgameQueryResult } from "../src/main/services/atlasPostgameQuery";

const startedAt = Date.parse("2026-10-24T20:00:00Z"), createdAt = startedAt - 10_000;
const snapshot = (gameNumber = 1, format = "bo1", extra: Record<string, unknown> = {}) => ({
  roomCode: "TEST1", createdAt, gameNumber, matchFormat: format, gameVariant: "duel", roomMode: "multiplayer", testMode: false, rewindProtocolVersion: 5,
  gameHistoryStartedAt: startedAt + (gameNumber - 1) * 60_000, phase: "in_game", players: [{ id: "player-me" }, { id: "player-other" }], ...extra,
});
const message = (packet: unknown, extra: Record<string, unknown> = {}) => ({ dir: "in", socketId: "test-socket", raw: JSON.stringify(packet), ...extra });
const raw = (messages: unknown[]) => ({ schema: "riftreplay-raw-capture", version: 1, sockets: [{ socketId: "test-socket", url: "wss://realtime.riftatlas-workers.com/parties/match/TEST1?playerId=player-me" }], messages });
function game(number = 1, format = "bo1", winner = "player-me") {
  return [
    message({ type: "authoritative_snapshot", sequence: number * 10, snapshot: snapshot(number, format) }),
    message({ type: "authoritative_patch_commit", gameInstanceId: "TEST1", sequence: number * 10 + 1, patch: { operations: [{ op: "set_room_fields", fields: { gameHistoryEndedAt: startedAt + (number - 1) * 60_000 + 30_000, gameOutcome: { reason: "concession", winnerPlayerIds: [winner] } } }] } }),
  ];
}
const target: AtlasPostgameTarget = { roomCode: "TEST1", roomCreatedAt: createdAt, gameNumber: 1, gameHistoryStartedAt: startedAt, gameHistoryEndedAt: startedAt + 30_000, localPlayerId: "player-me" };
const fallbackTarget: AtlasPostgameTarget = { roomCode: "TEST1", roomCreatedAt: createdAt, gameNumber: 1, gameHistoryStartedAt: startedAt, localPlayerId: "player-me", completionCheck: "atlas" };
const unterminated = () => raw([
  message({ type: "authoritative_snapshot", sequence: 0, snapshot: snapshot() }),
  message({ type: "authoritative_patch_commit", baseSequence: 0, sequence: 1, patch: { operations: [{ op: "set_board_fields", playerId: "player-other", fields: { score: 8 } }] } }),
]);

describe("exact captured Atlas post-game identities", () => {
  it("uses captured socket player and authoritative end patch without changing the raw capture", async () => {
    const input = raw(game()), before = JSON.stringify(input);
    expect(await extractAtlasPostgameTargets(input)).toEqual([target]);
    expect(atlasPostgameGameKey(target)).toBe(`TEST1:${createdAt}:1:${startedAt}`);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("accepts explicit captured player/viewer identity when socket metadata is unavailable", async () => {
    const input = { ...raw(game()), sockets: [] };
    input.messages.unshift(message({ type: "room_shell_sync", roomCode: "TEST1", sessionDoc: { viewer: { role: "player", playerId: "player-me" } } }));
    expect(await extractAtlasPostgameTargets(input)).toEqual([target]);
  });
  it("keeps BO3 games separate and waits for authoritative series completion", async () => {
    expect(await extractAtlasPostgameTargets(raw(game(1, "bo3")))).toEqual([]);
    const games = await extractAtlasPostgameTargets(raw([...game(1, "bo3"), ...game(2, "bo3", "player-other"), ...game(3, "bo3")]));
    expect(games.map(game => game.gameNumber)).toEqual([1, 2, 3]);
    expect(new Set(games.map(atlasPostgameGameKey)).size).toBe(3);
    expect(games.map(game => game.gameHistoryStartedAt)).toEqual([startedAt, startedAt + 60_000, startedAt + 120_000]);
  });
  it("uses authoritative final wins for a partially captured completed BO3", async () => {
    const messages = game(3, "bo3");
    messages.push(message({ type: "room_shell_sync", roomCode: "TEST1", sessionDoc: { winsByPlayerId: { "player-me": 2, "player-other": 1 } } }));
    expect((await extractAtlasPostgameTargets(raw(messages))).map(game => game.gameNumber)).toEqual([3]);
  });
  it.each([
    { testMode: true }, { roomMode: "solo_lab" }, { gameVariant: "four_player" }, { rewindProtocolVersion: 4 },
    { players: [{ id: "x" }, { id: "y" }] }, { players: [{ id: "player-me" }, { id: "x" }, { id: "y" }] },
  ])("rejects unsupported/nonparticipant evidence %j", async extra => {
    expect(await extractAtlasPostgameTargets(raw([message({ type: "authoritative_snapshot", snapshot: snapshot(1, "bo1", extra) }), game()[1]]))).toEqual([]);
  });
  it("does not query spectator, outgoing, guessed or ambiguous games", async () => {
    expect(await extractAtlasPostgameTargets({ ...raw(game()), sockets: [] })).toEqual([]);
    expect(await extractAtlasPostgameTargets(raw([message({ type: "room_shell_sync", roomCode: "TEST1", sessionDoc: { viewer: { role: "spectator", playerId: "player-me" } } }), ...game()]))).toEqual([]);
    expect(await extractAtlasPostgameTargets(raw(game().map(entry => ({ ...entry, dir: "out" }))))).toEqual([]);
    expect(await extractAtlasPostgameTargets(raw([...game(), message({ type: "authoritative_snapshot", snapshot: snapshot(1, "bo1", { createdAt: createdAt + 1, gameHistoryStartedAt: startedAt + 1, gameHistoryEndedAt: startedAt + 30_000, gameOutcome: { reason: "concession", winnerPlayerIds: ["player-me"] } }) })]))).toEqual([]);
  });
  it("rejects contradictory local identities and invalid completion markers", async () => {
    const altered = game();
    altered.unshift(message({ type: "room_shell_sync", roomCode: "TEST1", sessionDoc: { viewer: { role: "player", playerId: "player-other" } } }));
    expect(await extractAtlasPostgameTargets(raw(altered))).toEqual([]);
    expect(await extractAtlasPostgameTargets(raw([message({ type: "authoritative_snapshot", snapshot: snapshot(1, "bo1", { gameHistoryEndedAt: startedAt - 1, gameOutcome: { reason: "concession", winnerPlayerIds: ["player-me"] } }) })]))).toEqual([]);
  });
  it("rejects oversized captures and cooperatively stops before processing during play", async () => {
    expect(await extractAtlasPostgameTargets(raw(Array(50_001).fill({})))).toEqual([]);
    expect(await extractAtlasPostgameTargets(raw([message({}, { raw: " ".repeat(2 * 1024 * 1024 + 1) })]))).toEqual([]);
    await expect(extractAtlasPostgameTargets(raw(game()), () => false)).rejects.toThrow("deferred");
  });
  it("returns an explicit Atlas-check candidate without inventing an end, winner or changing input", async () => {
    const input = unterminated(), before = JSON.stringify(input);
    expect(await extractAtlasPostgameTargets(input)).toEqual([fallbackTarget]);
    expect(atlasPostgameGameKey(fallbackTarget)).toBe(atlasPostgameGameKey(target));
    expect(JSON.stringify(input)).toBe(before);
    // A live-looking snapshot is only a candidate: the query must defer on
    // /game and require Atlas's completed owner export before any attachment.
    expect(await extractAtlasPostgameTargets(raw([game()[0]]))).toEqual([fallbackTarget]);
  });
  it.each([
    { gameHistoryEndedAt: 0 }, { gameHistoryEndedAt: null }, { gameHistoryEndedAt: startedAt - 1 },
    { gameHistoryEndedAt: startedAt + 30_000 }, { gameOutcome: null }, { gameOutcome: {} },
    { gameOutcome: { reason: "unknown", winnerPlayerIds: [] } }, { gameNumber: 4 },
    { gameHistoryStartedAt: 0 }, { createdAt: startedAt + 1 }, { matchFormat: "bo3" },
    { gameVariant: "four_player" }, { roomMode: "solo_lab" }, { testMode: true }, { rewindProtocolVersion: 4 },
  ])("does not reinterpret malformed, partial, unsupported or contradictory evidence as a fallback: %j", async extra => {
    expect(await extractAtlasPostgameTargets(raw([message({ type: "authoritative_snapshot", sequence: 0, snapshot: snapshot(1, "bo1", extra) })]))).toEqual([]);
  });
  it("requires a valid snapshot sequence and contiguous confirmed patches for a fallback", async () => {
    expect(await extractAtlasPostgameTargets(raw([message({ type: "authoritative_snapshot", snapshot: snapshot() })]))).toEqual([]);
    for (const sequences of [{ baseSequence: 3, sequence: 4 }, { baseSequence: 0, sequence: 2 }, { sequence: 1 }]) {
      expect(await extractAtlasPostgameTargets(raw([
        message({ type: "authoritative_snapshot", sequence: 0, snapshot: snapshot() }),
        message({ type: "authoritative_patch_commit", ...sequences, patch: { operations: [] } }),
      ]))).toEqual([]);
    }
  });
  it("rejects fallback evidence with changed identity, participants or removed identity fields", async () => {
    for (const extra of [{ createdAt: createdAt + 1 }, { gameHistoryStartedAt: startedAt + 1 }, { players: [{ id: "player-me" }, { id: "replacement" }] }]) {
      expect(await extractAtlasPostgameTargets(raw([
        message({ type: "authoritative_snapshot", sequence: 0, snapshot: snapshot() }),
        message({ type: "authoritative_snapshot", sequence: 1, snapshot: snapshot(1, "bo1", extra) }),
      ]))).toEqual([]);
    }
    expect(await extractAtlasPostgameTargets(raw([
      message({ type: "authoritative_snapshot", sequence: 0, snapshot: snapshot() }),
      message({ type: "authoritative_patch_commit", baseSequence: 0, sequence: 1, patch: { operations: [{ op: "unset_room_fields", fields: ["gameHistoryStartedAt"] }] } }),
    ]))).toEqual([]);
    expect(await extractAtlasPostgameTargets(raw([
      message({ type: "authoritative_snapshot", sequence: 0, snapshot: snapshot() }),
      message({ type: "room_shell_sync", roomCode: "OTHER", sessionDoc: { roomCode: "OTHER" } }, { socketId: "other-socket" }),
    ]))).toEqual([]);
  });
  it("does not retain an earlier fallback candidate after the final room becomes unsupported", async () => {
    for (const fields of [{ matchFormat: "bo3" }, { roomMode: "solo_lab" }, { gameNumber: 2 }, { testMode: true }]) {
      const input = unterminated();
      input.messages.push(message({ type: "authoritative_patch_commit", baseSequence: 1, sequence: 2, patch: { operations: [{ op: "set_room_fields", fields }] } }));
      expect(await extractAtlasPostgameTargets(input)).toEqual([]);
    }
  });
});

function harness() {
  let now = startedAt + 60_000;
  const descriptor = { captureSessionId: "capture-test", remoteReplayId: "rl2_test", accountUid: "riftlite-owner", completedAt: startedAt + 30_000 };
  const ready = vi.fn(() => true), listCaptures = vi.fn(async () => [descriptor]), readCapture = vi.fn(async (_captureSessionId: string) => raw(game()));
  const query = vi.fn(async (target: AtlasPostgameTarget): Promise<AtlasPostgameQueryResult> => ({ status: "ready", gameKey: atlasPostgameGameKey(target), accountId: "atlas-account", sessionId: "atlas-session", replay: { format: "riftatlas-replay", version: 2, nodes: [], root: {r:0} } }));
  const deliver = vi.fn(async (): Promise<"attached" | "exists"> => "attached"), report = vi.fn(), diagnostic = vi.fn();
  const importer = new AtlasPostgameAutoImport({ listCaptures, readCapture, query, deliver, ready, now: () => now, report, diagnostic });
  return { importer, ready, listCaptures, readCapture, query, deliver, report, diagnostic, descriptor, advance: (ms: number) => { now += ms; } };
}

function completedBo3Room(gameNumber: number, wins: [number, number], extra: Record<string, unknown> = {}) {
  const code = `ROOM${gameNumber}`, socketId = `socket-${gameNumber}`;
  const start = startedAt + (gameNumber - 1) * 60_000;
  return {
    socket: { socketId, url: `wss://realtime.riftatlas-workers.com/parties/match/${code}?playerId=player-me` },
    messages: [
      message({ type: "authoritative_snapshot", sequence: 0, snapshot: snapshot(gameNumber, "bo3", {
        roomCode: code, createdAt: start - 10_000, seriesStartedAt: startedAt - 5_000, ...extra,
      }) }, { socketId }),
      message({ type: "authoritative_patch_commit", gameInstanceId: code, baseSequence: 0, sequence: 1,
        patch: { operations: [{ op: "set_room_fields", fields: { winsByPlayerId: { "player-me": wins[0], "player-other": wins[1] } } }] } }, { socketId }),
    ],
  };
}
const bo3Capture = (...games: ReturnType<typeof completedBo3Room>[]) => ({
  schema: "riftreplay-raw-capture", version: 1, sockets: games.map(game => game.socket), messages: games.flatMap(game => game.messages),
});

describe("completed BO3 rooms without captured ending packets", () => {
  it.each<[number, number]>([[1, 0], [0, 1]])("treats unchanged second-game wins after %j only as a terminal-winner proof candidate", async (mine, theirs) => {
    const input = bo3Capture(completedBo3Room(1, [mine, theirs]), completedBo3Room(2, [mine, theirs]));
    const before = JSON.stringify(input);
    const targets = await extractAtlasPostgameTargets(input);
    expect(targets.map(target => target.gameNumber)).toEqual([1, 2]);
    expect(targets[0]).not.toHaveProperty("completionSeriesWinnerPlayerId");
    expect(targets[1]).toMatchObject({
      completionCheck: "atlas", completionMatchFormat: "bo3", completionSeriesStartedAt: startedAt - 5_000,
      completionSeriesWinnerPlayerId: mine ? "player-me" : "player-other",
    });
    expect(targets.every(target => target.gameHistoryEndedAt === undefined)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("retains an explicit first-game ending while requiring proof of the missing second win", async () => {
    const first = completedBo3Room(1, [1, 0], { gameHistoryEndedAt: startedAt + 30_000, gameOutcome: { reason: "score", winnerPlayerIds: ["player-me"] } });
    const targets = await extractAtlasPostgameTargets(bo3Capture(first, completedBo3Room(2, [1, 0])));
    expect(targets[0]).toMatchObject({ gameNumber: 1, gameHistoryEndedAt: startedAt + 30_000 });
    expect(targets[0]).not.toHaveProperty("completionCheck");
    expect(targets[1]).toMatchObject({ gameNumber: 2, completionSeriesWinnerPlayerId: "player-me" });
  });

  it.each([
    { gameOutcome: null }, { gameOutcome: {} }, { gameHistoryEndedAt: null }, { gameHistoryEndedAt: startedAt + 90_000 },
    { gameHistoryEndedAt: startedAt + 90_000, gameOutcome: { reason: "score", winnerPlayerIds: ["player-me"] } },
    { seriesStartedAt: startedAt - 4_000 }, { gameHistoryStartedAt: startedAt }, { gameNumber: 3 },
    { players: [{ id: "player-me" }, { id: "different-opponent" }] }, { testMode: true }, { matchFormat: "bo1" },
  ])("does not broaden second-game discovery to contradictory evidence %j", async extra => {
    expect(await extractAtlasPostgameTargets(bo3Capture(completedBo3Room(1, [1, 0]), completedBo3Room(2, [1, 0], extra)))).toEqual([]);
  });

  it.each(["gap", "duplicate", "changed identity", "changed series", "wrong owner"])("requires immutable contiguous second-game evidence: %s", async fault => {
    const second = completedBo3Room(2, [1, 0]);
    if (fault === "duplicate") second.messages.push(second.messages[1]);
    else if (fault === "gap") second.messages[1] = message({ type: "authoritative_patch_commit", gameInstanceId: "ROOM2", baseSequence: 1, sequence: 2,
      patch: { operations: [] } }, { socketId: "socket-2" });
    else if (fault === "wrong owner") second.socket.url = second.socket.url.replace("player-me", "player-other");
    else second.messages.push(message({ type: "authoritative_patch_commit", gameInstanceId: "ROOM2", baseSequence: 1, sequence: 2,
      patch: { operations: [{ op: "set_room_fields", fields: fault === "changed identity" ? { createdAt: startedAt + 50_001 } : { seriesStartedAt: startedAt - 4_000 } }] } }, { socketId: "socket-2" }));
    expect(await extractAtlasPostgameTargets(bo3Capture(completedBo3Room(1, [1, 0]), second))).toEqual([]);
  });

  it.each<{ wins: [number, number][] }>([
    { wins: [[1, 0], [1, 1], [2, 1]] },
    { wins: [[0, 1], [0, 2]] },
  ])("checks each immutable game after coherent final series wins %j", async ({ wins }) => {
    const input = bo3Capture(...wins.map((score, i) => completedBo3Room(i + 1, score)));
    const before = JSON.stringify(input);
    const result = await extractAtlasPostgameTargets(input);
    expect(result).toHaveLength(wins.length);
    expect(result.map(target => target.gameNumber)).toEqual(wins.map((_, i) => i + 1));
    expect(new Set(result.map(atlasPostgameGameKey)).size).toBe(wins.length);
    for (const target of result) {
      expect(target).toEqual(expect.objectContaining({ completionCheck: "atlas", completionMatchFormat: "bo3", completionSeriesStartedAt: startedAt - 5_000 }));
      expect(target).not.toHaveProperty("gameHistoryEndedAt");
    }
    expect(JSON.stringify(input)).toBe(before);
  });

  it("preserves an explicit last-game ending while collecting earlier games from the same verified series", async () => {
    const third = completedBo3Room(3, [2, 1], { gameHistoryEndedAt: startedAt + 150_000, gameOutcome: { reason: "concession", winnerPlayerIds: ["player-me"] } });
    const result = await extractAtlasPostgameTargets(bo3Capture(completedBo3Room(1, [1, 0]), completedBo3Room(2, [1, 1]), third));
    expect(result.map(target => target.gameNumber)).toEqual([1, 2, 3]);
    expect(result.slice(0, 2).every(target => target.completionCheck === "atlas")).toBe(true);
    expect(result[2].gameHistoryEndedAt).toBe(startedAt + 150_000);
    expect(result[2]).not.toHaveProperty("completionCheck");
  });

  it.each<[number, number]>([[1, 0], [0, 1]])("checks a deciding third game whose final win update was not captured after %j", async (firstWin, secondWin) => {
    const input = bo3Capture(completedBo3Room(1, [firstWin, secondWin]), completedBo3Room(2, [1, 1]), completedBo3Room(3, [1, 1]));
    const before = JSON.stringify(input);
    const targets = await extractAtlasPostgameTargets(input);
    expect(targets).toEqual([1, 2, 3].map(gameNumber => ({
      roomCode: `ROOM${gameNumber}`, roomCreatedAt: startedAt + (gameNumber - 1) * 60_000 - 10_000,
      gameNumber, gameHistoryStartedAt: startedAt + (gameNumber - 1) * 60_000,
      localPlayerId: "player-me", completionCheck: "atlas", completionMatchFormat: "bo3", completionSeriesStartedAt: startedAt - 5_000,
    })));
    expect(JSON.stringify(input)).toBe(before);
  });

  it("keeps captured earlier endings when only the deciding game's final win update is missing", async () => {
    const first = completedBo3Room(1, [1, 0], { gameHistoryEndedAt: startedAt + 30_000, gameOutcome: { reason: "score", winnerPlayerIds: ["player-me"] } });
    const second = completedBo3Room(2, [1, 1], { gameHistoryEndedAt: startedAt + 90_000, gameOutcome: { reason: "concession", winnerPlayerIds: ["player-other"] } });
    const targets = await extractAtlasPostgameTargets(bo3Capture(first, second, completedBo3Room(3, [1, 1])));
    expect(targets.map(target => target.gameNumber)).toEqual([1, 2, 3]);
    expect(targets.slice(0, 2).map(target => target.gameHistoryEndedAt)).toEqual([startedAt + 30_000, startedAt + 90_000]);
    expect(targets.slice(0, 2).every(target => target.completionCheck === undefined)).toBe(true);
    expect(targets[2]).toMatchObject({ completionCheck: "atlas", completionMatchFormat: "bo3", completionSeriesStartedAt: startedAt - 5_000 });
    expect(targets[2]).not.toHaveProperty("gameHistoryEndedAt");
  });

  it.each([
    { gameOutcome: null }, { gameOutcome: {} }, { gameHistoryEndedAt: null }, { gameHistoryEndedAt: startedAt + 150_000 },
    { gameHistoryEndedAt: startedAt + 150_000, gameOutcome: { reason: "score", winnerPlayerIds: ["player-me"] } },
    { seriesStartedAt: startedAt - 4_000 }, { gameHistoryStartedAt: startedAt + 60_000 },
    { players: [{ id: "player-me" }, { id: "different-opponent" }] }, { gameNumber: 2 }, { testMode: true },
  ])("does not use the missing-final-win check to accept contradictory deciding-game evidence %j", async extra => {
    expect(await extractAtlasPostgameTargets(bo3Capture(completedBo3Room(1, [1, 0]), completedBo3Room(2, [1, 1]), completedBo3Room(3, [1, 1], extra)))).toEqual([]);
  });

  it.each<{ wins: [number, number][] }>([
    { wins: [[1, 0], [1, 0], [1, 1]] }, { wins: [[1, 0], [2, 0], [2, 0]] },
    { wins: [[1, 0], [1, 1], [0, 0]] }, { wins: [[1, 0], [1, 1], [1, 0]] },
    { wins: [[1, 0], [1, 1], [0, 2]] }, { wins: [[1, 0], [1, 1], [2, 2]] },
  ])("still rejects stale earlier scores, premature series completion or contradictory final scores %j", async ({ wins }) => {
    expect(await extractAtlasPostgameTargets(bo3Capture(...wins.map((score, i) => completedBo3Room(i + 1, score))))).toEqual([]);
  });

  it.each(["gap", "duplicate"])("requires contiguous deciding-game evidence despite the absent final win update: %s", async fault => {
    const third = completedBo3Room(3, [1, 1]);
    if (fault === "duplicate") third.messages.push(third.messages[1]);
    else third.messages[1] = message({ type: "authoritative_patch_commit", gameInstanceId: "ROOM3", baseSequence: 1, sequence: 2,
      patch: { operations: [{ op: "set_room_fields", fields: { winsByPlayerId: { "player-me": 1, "player-other": 1 } } }] } }, { socketId: "socket-3" });
    expect(await extractAtlasPostgameTargets(bo3Capture(completedBo3Room(1, [1, 0]), completedBo3Room(2, [1, 1]), third))).toEqual([]);
  });

  it.each<{ wins: [number, number][] }>([
    { wins: [[1, 0]] }, { wins: [[1, 0], [1, 1]] }, { wins: [[1, 0], [2, 0], [2, 1]] },
    { wins: [[1, 0], [0, 2]] }, { wins: [[1, 0], [3, 0]] }, { wins: [[0, 0], [0, 0]] }, { wins: [[1, 0], [0, 1]] },
  ])("rejects unfinished or incoherent series progression %j", async ({ wins }) => {
    expect(await extractAtlasPostgameTargets(bo3Capture(...wins.map((score, i) => completedBo3Room(i + 1, score))))).toEqual([]);
  });

  it.each([
    { seriesStartedAt: startedAt + 1 }, { seriesStartedAt: undefined }, { seriesStartedAt: null },
    { gameHistoryStartedAt: startedAt }, { gameHistoryEndedAt: null }, { gameHistoryEndedAt: startedAt + 90_000 },
    { gameOutcome: {} }, { gameOutcome: null }, { matchFormat: "bo1" }, { gameNumber: 3 },
    { players: [{ id: "player-me" }, { id: "different-opponent" }] },
  ])("does not combine ambiguous or partial room evidence %j", async extra => {
    expect(await extractAtlasPostgameTargets(bo3Capture(completedBo3Room(1, [1, 0]), completedBo3Room(2, [2, 0], extra)))).toEqual([]);
  });

  it("rejects a series identity that changes within one captured room", async () => {
    const second = completedBo3Room(2, [2, 0], { seriesStartedAt: startedAt - 4_000 });
    second.messages.push(message({ type: "authoritative_patch_commit", gameInstanceId: "ROOM2", baseSequence: 1, sequence: 2,
      patch: { operations: [{ op: "set_room_fields", fields: { seriesStartedAt: startedAt - 5_000 } }] } }, { socketId: "socket-2" }));
    expect(await extractAtlasPostgameTargets(bo3Capture(completedBo3Room(1, [1, 0]), second))).toEqual([]);
  });

  it("does not turn a duplicated or missing authoritative commit into a BO3 fallback", async () => {
    const second = completedBo3Room(2, [2, 0]);
    second.messages.push(second.messages[1]);
    expect(await extractAtlasPostgameTargets(bo3Capture(completedBo3Room(1, [1, 0]), second))).toEqual([]);
  });
});

describe("automatic post-game attachment queue", () => {
  it.each<[number, number]>([[1, 0], [0, 1]])("attaches the proven final game before releasing Game 1 after %j", async (mine, theirs) => {
    const h = harness();
    h.readCapture.mockResolvedValue(bo3Capture(completedBo3Room(1, [mine, theirs]), completedBo3Room(2, [mine, theirs])));
    await h.importer.run();
    expect(h.query.mock.calls.map(([target]) => target.gameNumber)).toEqual([2, 1]);
    expect(h.query.mock.calls[0][0].completionSeriesWinnerPlayerId).toBe(mine ? "player-me" : "player-other");
    expect(h.deliver.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 1]);
    h.advance(60_000); await h.importer.run();
    expect(h.query).toHaveBeenCalledTimes(2);
  });

  it.each(["pending", "wrong winner", "attachment failure"])("keeps Game 1 locked while final proof has %s, then recovers", async failure => {
    const h = harness(), query = h.query.getMockImplementation()!;
    h.readCapture.mockResolvedValue(bo3Capture(completedBo3Room(1, [1, 0]), completedBo3Room(2, [1, 0])));
    if (failure === "attachment failure") h.deliver.mockRejectedValue(new Error("attachment mismatch"));
    else h.query.mockImplementation(async target => {
      if (failure === "wrong winner") throw new Error("Atlas replay completion could not be confirmed.");
      return { status: "pending", gameKey: atlasPostgameGameKey(target), accountId: "a", sessionId: "s" };
    });
    await h.importer.run();
    h.advance(15_000); await h.importer.run();
    expect(h.query.mock.calls.map(([target]) => target.gameNumber)).toEqual([2, 2]);
    expect(h.deliver.mock.calls.every((call: unknown[]) => call[1] === 2)).toBe(true);
    h.query.mockImplementation(query); h.deliver.mockResolvedValue("exists");
    h.advance(30_000); await h.importer.run();
    expect(h.query.mock.calls.map(([target]) => target.gameNumber)).toEqual([2, 2, 2, 1]);
    expect(h.deliver.mock.calls.slice(-2).map((call: unknown[]) => call[1])).toEqual([2, 1]);
    expect(h.readCapture).toHaveBeenCalledOnce();
  });

  it.each(["restricted", "expired", "unavailable"] as const)("never releases Game 1 when the final game is %s", async status => {
    const h = harness();
    h.readCapture.mockResolvedValue(bo3Capture(completedBo3Room(1, [1, 0]), completedBo3Room(2, [1, 0])));
    h.query.mockImplementation(async target => ({ status, gameKey: atlasPostgameGameKey(target), accountId: "a", sessionId: "s" }));
    await h.importer.run(); h.advance(600_000); await h.importer.run();
    expect(h.query.mock.calls.map(([target]) => target.gameNumber)).toEqual([2]);
    expect(h.deliver).not.toHaveBeenCalled();
    expect(h.diagnostic).toHaveBeenLastCalledWith({ stage: "query", outcome: status, attempt: 1 });
  });

  it.each(["query", "attachment"] as const)("keeps the final proof locked after repeated %s cancellations without spending attempts", async stage => {
    const h = harness(), query = h.query.getMockImplementation()!;
    h.readCapture.mockResolvedValue(bo3Capture(completedBo3Room(1, [1, 0]), completedBo3Room(2, [1, 0])));
    if (stage === "query") h.query.mockRejectedValue(new AtlasPostgameDeferredError());
    else h.deliver.mockRejectedValue(new AtlasPostgameDeferredError());
    for (let attempt = 0; attempt < 3; attempt++) { await h.importer.run(); h.advance(15_000); }
    expect(h.query.mock.calls.map(([target]) => target.gameNumber)).toEqual([2, 2, 2]);
    expect(h.deliver.mock.calls.every((call: unknown[]) => call[1] === 2)).toBe(true);
    expect(h.diagnostic).toHaveBeenCalledExactlyOnceWith({ stage: "capture", outcome: "ready", attempt: 1 });
    h.query.mockImplementation(query); h.deliver.mockResolvedValue("attached");
    await h.importer.run();
    expect(h.query.mock.calls.slice(-2).map(([target]) => target.gameNumber)).toEqual([2, 1]);
    expect(h.diagnostic.mock.calls.slice(-2).map(([event]) => event.attempt)).toEqual([1, 1]);
  });

  it.each(["query", "attachment"] as const)("does not confirm a series when the account changes during final %s", async stage => {
    const h = harness(), query = h.query.getMockImplementation()!;
    const otherAccount = { ...h.descriptor, accountUid: "other-riftlite-owner" };
    h.readCapture.mockResolvedValue(bo3Capture(completedBo3Room(1, [1, 0]), completedBo3Room(2, [1, 0])));
    if (stage === "query") h.query.mockImplementationOnce(async target => { h.listCaptures.mockResolvedValue([otherAccount]); return query(target); });
    else h.deliver.mockImplementationOnce(async () => { h.listCaptures.mockResolvedValue([otherAccount]); return "attached"; });
    await h.importer.run();
    expect(h.query.mock.calls.map(([target]) => target.gameNumber)).toEqual([2]);
    expect(h.deliver.mock.calls.every((call: unknown[]) => call[1] === 2)).toBe(true);
    h.listCaptures.mockResolvedValue([h.descriptor]); h.advance(15_000); await h.importer.run();
    expect(h.query.mock.calls.map(([target]) => target.gameNumber)).toEqual([2, 2, 1]);
    expect(h.deliver.mock.calls.slice(-2).map((call: unknown[]) => call[1])).toEqual([2, 1]);
  });

  it("does not query Game 1 when gameplay resumes during the final attachment", async () => {
    const h = harness();
    h.readCapture.mockResolvedValue(bo3Capture(completedBo3Room(1, [1, 0]), completedBo3Room(2, [1, 0])));
    h.deliver.mockImplementationOnce(async () => { h.ready.mockReturnValue(false); return "attached"; });
    await h.importer.run();
    expect(h.query.mock.calls.map(([target]) => target.gameNumber)).toEqual([2]);
    h.ready.mockReturnValue(true); h.advance(15_000); await h.importer.run();
    expect(h.query.mock.calls.map(([target]) => target.gameNumber)).toEqual([2, 2, 1]);
  });

  it("keeps immutable capture-read failures bounded without private payloads or exception text", async () => {
    const h = harness();
    h.readCapture.mockRejectedValue(new Error("private token and player data must not be logged"));
    await h.importer.run();
    for (const delay of [15_000, 30_000, 60_000, 120_000, 300_000]) { h.advance(delay); await h.importer.run(); }
    expect(h.diagnostic).toHaveBeenLastCalledWith({ stage: "capture", outcome: "exhausted", attempt: 6 });
    const calls = JSON.stringify(h.diagnostic.mock.calls);
    expect(calls).not.toMatch(/private|token|player|capture-test|riftlite-owner|rl2_test/);
    const count = h.diagnostic.mock.calls.length;
    h.advance(600_000); await h.importer.run(); expect(h.diagnostic).toHaveBeenCalledTimes(count);
  });
  it.each(["query", "attachment", "pending"] as const)("recovers from %s after the previous six-attempt cutoff without restarting", async failure => {
    const h = harness(), readyQuery = h.query.getMockImplementation()!;
    if (failure === "query") h.query.mockRejectedValue(new Error("private token and player data must not be logged"));
    else if (failure === "attachment") h.deliver.mockRejectedValue(new Error("private token and player data must not be logged"));
    else h.query.mockImplementation(async target => ({ status: "pending", gameKey: atlasPostgameGameKey(target), accountId: "a", sessionId: "s" }));
    await h.importer.run();
    for (const delay of [15_000, 30_000, 60_000, 120_000, 300_000]) { h.advance(delay); await h.importer.run(); }
    expect(h.query).toHaveBeenCalledTimes(6);
    expect(h.diagnostic).toHaveBeenLastCalledWith({
      stage: failure === "attachment" ? "attachment" : "query",
      outcome: failure === "pending" ? "pending" : "retry", attempt: 6,
      ...(failure === "query" ? { failureReason: "unknown" } : {}),
    });
    expect(JSON.stringify(h.diagnostic.mock.calls)).not.toMatch(/private|token|player|capture-test|riftlite-owner|rl2_test/);
    h.query.mockImplementation(readyQuery); h.deliver.mockResolvedValue("attached");
    h.advance(599_999); await h.importer.run(); expect(h.query).toHaveBeenCalledTimes(6);
    h.advance(1); await h.importer.run();
    expect(h.query).toHaveBeenCalledTimes(7); expect(h.readCapture).toHaveBeenCalledOnce();
    expect(h.diagnostic).toHaveBeenLastCalledWith({ stage: "attachment", outcome: "attached", attempt: 7 });
    h.advance(600_000); await h.importer.run(); expect(h.query).toHaveBeenCalledTimes(7);
  });
  it("reports a persistent discovery failure once and does not let diagnostic failures interrupt collection", async () => {
    const h = harness(); h.listCaptures.mockRejectedValue(new Error("private failure"));
    await h.importer.run(); h.advance(15_000); await h.importer.run();
    expect(h.diagnostic).toHaveBeenCalledExactlyOnceWith({ stage: "discovery", outcome: "retry", attempt: 0 });
    h.listCaptures.mockResolvedValue([h.descriptor]); h.diagnostic.mockImplementation(() => { throw new Error("sink failed"); });
    await h.importer.run(); expect(h.deliver).toHaveBeenCalledOnce();
  });
  it("attaches without a click, caches only extracted targets and stops when attached", async () => {
    const h = harness(); await h.importer.run(); h.advance(60_000); await h.importer.run();
    expect(h.readCapture).toHaveBeenCalledOnce(); expect(h.query).toHaveBeenCalledOnce(); expect(h.deliver).toHaveBeenCalledOnce();
    expect(h.report).toHaveBeenCalledWith("capture-test", "attached");
  });

  it("waits for provider completion before attaching a deciding game without its captured final win", async () => {
    const h = harness();
    h.readCapture.mockResolvedValue(bo3Capture(completedBo3Room(1, [1, 0]), completedBo3Room(2, [1, 1]), completedBo3Room(3, [1, 1])));
    const readyQuery = h.query.getMockImplementation()!;
    let thirdReady = false;
    h.query.mockImplementation(async target => target.gameNumber === 3 && !thirdReady
      ? { status: "pending", gameKey: atlasPostgameGameKey(target), accountId: "atlas-account", sessionId: "atlas-session" }
      : readyQuery(target));
    await h.importer.run();
    expect(h.query).toHaveBeenCalledTimes(3);
    expect(h.query.mock.calls.every(([target]) => target.completionCheck === "atlas" && target.completionMatchFormat === "bo3")).toBe(true);
    expect(h.deliver.mock.calls.map((call: unknown[]) => call[1])).toEqual([1, 2]);
    expect(h.diagnostic).toHaveBeenLastCalledWith({ stage: "query", outcome: "pending", attempt: 1 });
    thirdReady = true; h.advance(15_000); await h.importer.run();
    expect(h.readCapture).toHaveBeenCalledOnce();
    expect(h.query).toHaveBeenCalledTimes(4);
    expect(h.deliver.mock.calls.map((call: unknown[]) => call[1])).toEqual([1, 2, 3]);
    expect(h.diagnostic).toHaveBeenLastCalledWith({ stage: "attachment", outcome: "attached", attempt: 2 });
  });
  it("does no listing, reading or network work during gameplay", async () => {
    const h = harness(); h.ready.mockReturnValue(false); await h.importer.run();
    expect(h.listCaptures).not.toHaveBeenCalled(); expect(h.query).not.toHaveBeenCalled();
  });
  it.each(["list", "read", "query"])("rechecks gameplay after the asynchronous %s step", async step => {
    const h = harness();
    if (step === "list") h.listCaptures.mockImplementation(async () => { h.ready.mockReturnValue(false); return [h.descriptor]; });
    if (step === "read") h.readCapture.mockImplementation(async () => { h.ready.mockReturnValue(false); return raw(game()); });
    if (step === "query") h.query.mockImplementation(async target => { h.ready.mockReturnValue(false); return { status: "ready", gameKey: atlasPostgameGameKey(target), accountId: "a", sessionId: "s", replay: {} }; });
    await h.importer.run(); expect(h.deliver).not.toHaveBeenCalled();
    if (step !== "query") expect(h.query).not.toHaveBeenCalled();
  });
  it("coalesces triggers and limits a pass to three requests", async () => {
    const h = harness(); let resolve!: (value: typeof h.descriptor[]) => void;
    const captures = Array.from({length: 5}, (_, i) => ({ ...h.descriptor, captureSessionId: `capture-${i}`, completedAt: h.descriptor.completedAt + i * 1_000 }));
    h.listCaptures.mockResolvedValue(captures);
    h.listCaptures.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = h.importer.run(); expect(h.importer.run()).toBe(pending);
    resolve(captures);
    await pending; expect(h.query).toHaveBeenCalledTimes(3); expect(h.deliver).toHaveBeenCalledTimes(3);
    expect(h.readCapture.mock.calls.map(call => call[0])).toEqual(["capture-4", "capture-3", "capture-2"]);
  });
  it("caps pending-provider backoff at ten minutes and stops when the capture expires", async () => {
    const h = harness(); h.query.mockImplementation(async target => ({ status: "pending", gameKey: atlasPostgameGameKey(target), accountId: "a", sessionId: "s" }));
    await h.importer.run();
    for (const [index, delay] of [15_000, 30_000, 60_000, 120_000, 300_000].entries()) {
      h.advance(delay - 1); await h.importer.run(); expect(h.query).toHaveBeenCalledTimes(index + 1);
      h.advance(1); await h.importer.run(); expect(h.query).toHaveBeenCalledTimes(index + 2);
    }
    for (const count of [6, 7]) {
      h.advance(599_999); await h.importer.run(); expect(h.query).toHaveBeenCalledTimes(count);
      h.advance(1); await h.importer.run(); expect(h.query).toHaveBeenCalledTimes(count + 1);
    }
    h.advance(6 * 60 * 60_000); await h.importer.run();
    expect(h.query).toHaveBeenCalledTimes(8); expect(h.readCapture).toHaveBeenCalledOnce();
  });
  it.each([
    ["read", "returned"], ["read", "threw"], ["read", "marked"],
    ["query", "returned"], ["query", "threw"], ["query", "marked"],
    ["attachment", "returned"], ["attachment", "threw"], ["attachment", "marked"],
  ] as const)("repeated %s cancellations (%s) preserve the retry budget", async (stage, mode) => {
    const h = harness(), read = h.readCapture.getMockImplementation()!, query = h.query.getMockImplementation()!;
    const interrupt = () => {
      // A marked cancellation remains identifiable even when the guest is
      // already idle again by the time the rejected promise is handled.
      if (mode === "marked") throw new AtlasPostgameDeferredError();
      h.ready.mockReturnValue(false);
      if (mode === "threw") throw new Error("cancelled while gameplay resumed");
    };
    if (stage === "read") h.readCapture.mockImplementation(async () => { interrupt(); return raw(game()); });
    if (stage === "query") h.query.mockImplementation(async target => { interrupt(); return query(target); });
    if (stage === "attachment") h.deliver.mockImplementation(async () => { interrupt(); return "attached"; });
    for (let index = 0; index < 8; index++) {
      h.ready.mockReturnValue(true); await h.importer.run(); h.advance(15_000);
    }
    expect(h.report).not.toHaveBeenCalled();
    expect(h.diagnostic.mock.calls.every(([event]) => event.stage === "capture" && event.outcome === "ready")).toBe(true);
    h.ready.mockReturnValue(true); h.readCapture.mockImplementation(read); h.query.mockImplementation(query); h.deliver.mockResolvedValue("exists");
    await h.importer.run();
    expect(h.diagnostic).toHaveBeenLastCalledWith({ stage: "attachment", outcome: "exists", attempt: 1 });
    expect(h.report).toHaveBeenCalledExactlyOnceWith("capture-test", "exists");
    if (stage === "read") expect(h.diagnostic).toHaveBeenCalledWith({ stage: "capture", outcome: "ready", attempt: 1 });
  });
  it("defers fallback collection quietly without spending attempts or attaching while Atlas remains on the game page", async () => {
    const h = harness(); h.readCapture.mockResolvedValue(unterminated());
    h.query.mockImplementation(async target => ({ status: "deferred", gameKey: atlasPostgameGameKey(target) }));
    await h.importer.run();
    for (let index = 0; index < 10; index++) { h.advance(15_000); await h.importer.run(); }
    expect(h.query).toHaveBeenCalledTimes(11); expect(h.deliver).not.toHaveBeenCalled();
    expect(h.diagnostic).toHaveBeenCalledExactlyOnceWith({ stage: "capture", outcome: "ready", attempt: 1 });
    expect(h.report).not.toHaveBeenCalled();
    h.query.mockImplementation(async target => ({ status: "pending", gameKey: atlasPostgameGameKey(target), accountId: "a", sessionId: "s" }));
    h.advance(14_999); await h.importer.run(); expect(h.query).toHaveBeenCalledTimes(11);
    h.advance(1); await h.importer.run();
    expect(h.diagnostic).toHaveBeenLastCalledWith({ stage: "query", outcome: "pending", attempt: 1 });
    h.query.mockImplementation(async target => ({ status: "ready", gameKey: atlasPostgameGameKey(target), accountId: "a", sessionId: "s", replay: { format: "riftatlas-replay", version: 2, nodes: [], root: { r: 0 } } }));
    h.advance(15_000); await h.importer.run(); expect(h.deliver).toHaveBeenCalledOnce();
    expect(h.diagnostic).toHaveBeenLastCalledWith({ stage: "attachment", outcome: "attached", attempt: 2 });
  });
  it("does not attach fallback candidates on unknown or restricted provider results and expires deferred work", async () => {
    const unknown = harness(); unknown.readCapture.mockResolvedValue({ schema: "unknown", version: 1, messages: [] } as never);
    await unknown.importer.run(); expect(unknown.query).not.toHaveBeenCalled(); expect(unknown.deliver).not.toHaveBeenCalled();
    const h = harness(); h.readCapture.mockResolvedValue(unterminated());
    h.query.mockImplementation(async target => ({ status: "deferred", gameKey: atlasPostgameGameKey(target) }));
    await h.importer.run(); h.advance(6 * 60 * 60_000); await h.importer.run();
    expect(h.query).toHaveBeenCalledOnce(); expect(h.deliver).not.toHaveBeenCalled();
    const restricted = harness(); restricted.readCapture.mockResolvedValue(unterminated());
    restricted.query.mockImplementation(async target => ({ status: "restricted", gameKey: atlasPostgameGameKey(target), accountId: "a", sessionId: "s" }));
    await restricted.importer.run(); restricted.advance(60_000); await restricted.importer.run();
    expect(restricted.query).toHaveBeenCalledOnce(); expect(restricted.deliver).not.toHaveBeenCalled();
  });
  it.each(["restricted", "expired", "unavailable"] as const)("stops on terminal Atlas status %s", async status => {
    const h = harness(); h.query.mockImplementation(async target => ({ status, gameKey: atlasPostgameGameKey(target), accountId: "a", sessionId: "s" }));
    await h.importer.run(); h.advance(600_000); await h.importer.run(); expect(h.query).toHaveBeenCalledOnce(); expect(h.deliver).not.toHaveBeenCalled();
  });
  it("does not deliver a returned game key different from the captured game", async () => {
    const h = harness(); h.query.mockResolvedValue({ status: "ready", gameKey: "different", accountId: "a", sessionId: "s", replay: {} });
    await h.importer.run(); expect(h.deliver).not.toHaveBeenCalled();
  });
  it("excludes captures older than six hours and stops after disposal", async () => {
    const h = harness(); h.advance(6 * 60 * 60_000); await h.importer.run(); expect(h.readCapture).not.toHaveBeenCalled();
    h.importer.dispose(); await h.importer.run(); expect(h.listCaptures).toHaveBeenCalledOnce();
  });
  it("does not attach when the six-hour window expires during the provider query", async () => {
    const h = harness(), query = h.query.getMockImplementation()!;
    h.query.mockImplementation(async target => { h.advance(6 * 60 * 60_000); return query(target); });
    await h.importer.run(); await h.importer.run();
    expect(h.query).toHaveBeenCalledOnce(); expect(h.deliver).not.toHaveBeenCalled();
    expect(h.report).not.toHaveBeenCalled();
  });
  it("does not deliver after shutdown while awaiting Atlas", async () => {
    const h = harness(); h.query.mockImplementation(async target => { h.importer.dispose(); return { status: "ready", gameKey: atlasPostgameGameKey(target), accountId: "a", sessionId: "s", replay: {} }; });
    await h.importer.run(); expect(h.deliver).not.toHaveBeenCalled();
  });
  it.each(["accountUid", "remoteReplayId"] as const)("does not adopt a changed %s after awaiting Atlas", async field => {
    const h = harness(), query = h.query.getMockImplementation()!;
    h.query.mockImplementation(async target => {
      h.listCaptures.mockResolvedValue([{ ...h.descriptor, [field]: "changed-value" }]);
      return { status: "ready", gameKey: atlasPostgameGameKey(target), accountId: "a", sessionId: "s", replay: {} };
    });
    await h.importer.run(); expect(h.deliver).not.toHaveBeenCalled();
    expect(h.report).not.toHaveBeenCalled();
    h.listCaptures.mockResolvedValue([h.descriptor]); h.query.mockImplementation(query);
    h.advance(15_000); await h.importer.run();
    expect(h.deliver).toHaveBeenCalledOnce();
    expect(h.diagnostic).toHaveBeenLastCalledWith({ stage: "attachment", outcome: "attached", attempt: 1 });
  });
  it("rechecks capture ownership before reading local data", async () => {
    const h = harness(); h.listCaptures.mockResolvedValue([]).mockResolvedValueOnce([h.descriptor]);
    await h.importer.run(); expect(h.readCapture).not.toHaveBeenCalled(); expect(h.query).not.toHaveBeenCalled();
  });
});
