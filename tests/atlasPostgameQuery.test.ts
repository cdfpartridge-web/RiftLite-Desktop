import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AtlasPostgameQueryTarget, AtlasPostgameQueryResult } from "../src/main/services/atlasPostgameQuery";

const compiled = ts.transpileModule(readFileSync(new URL("../src/main/services/atlasPostgameQuery.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exported = {} as { atlasPostgameQueryScript: (target: AtlasPostgameQueryTarget, reportFailure?: boolean) => string; atlasPostgameCancelScript: () => string };
vm.runInNewContext(compiled, { exports: exported });
const start = Date.now() - 120_000;
const target: AtlasPostgameQueryTarget = { roomCode: "ROOM", roomCreatedAt: start - 1000, gameNumber: 1, gameHistoryStartedAt: start, gameHistoryEndedAt: start + 60_000, localPlayerId: "player-a", expectedPageUrl: "https://play.riftatlas.com/game" };
const key = `${target.roomCode}:${target.roomCreatedAt}:1:${start}`;
const api = `https://realtime.riftatlas-workers.com/api/replays/${encodeURIComponent(key)}`;
const response = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
function view() {
  const card = { id: "card-a", name: "Example card", cardCode: "TEST-1", secret: "NO_STORE", accessToken: "NO_STORE" };
  const players = [{ id: "player-a", name: "A", board: { hand: [card], battlefieldToken: [card] } }, { id: "player-b", name: "B", board: { hand: [] } }];
  const state = { roomCode: "ROOM", createdAt: target.roomCreatedAt, gameHistoryStartedAt: start, gameVariant: "duel", gameNumber: 1,
    matchFormat: "bo1", phase: "in_game", testMode: false, rewindProtocolVersion: 5,
    players, gameOutcome: { winnerPlayerIds: ["player-a"], reason: "concession" }, log: [] };
  return { replayId: key, viewerPlayerId: "player-a", canSwitchPerspective: true, canFork: true, players: [{ id: "player-a", name: "A" }, { id: "player-b", name: "B" }], createdAt: start, completedAt: start + 60_000, privateNotes: "NO_STORE", sessionToken: "NO_STORE", frames: [{ index: 0, sequence: 1, elapsedMs: 0, actionType: "start", state }, { index: 1, sequence: 2, elapsedMs: 60_000, actionType: "concede", state }] };
}
function mulliganPlayback() {
  return {
    "player-a": { redrawCount: 0, draws: [] },
    "player-b": { redrawCount: 1, draws: [
      { id: "draw-refill", cardId: "card-refill", handCountBeforeDraw: 3, kind: "refill" },
      { id: "draw-opening", cardId: "card-opening", handCountBeforeDraw: 4, kind: "opening" },
    ] },
  };
}
function envelope(input: unknown) {
  const nodes: unknown[] = [], seen = new Map<object, number>();
  const encode = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return { r: seen.get(value) };
    const contents = Array.isArray(value) ? value.map(encode) : Object.entries(value).map(([key, child]) => [key, encode(child)]);
    const index = nodes.length; nodes.push([Array.isArray(value) ? "a" : "o", contents]); seen.set(value, index); return { r: index };
  };
  return { format: "riftatlas-replay", version: 2, nodes, root: encode(input) };
}
function decode(input: NonNullable<AtlasPostgameQueryResult["replay"]>) {
  const values: any[] = [];
  const resolve = (value: any) => value && typeof value === "object" ? values[value.r] : value;
  for (const node of input.nodes as any[]) values.push(node[0] === "a" ? node[1].map(resolve) : Object.fromEntries(node[1].map(([key, value]: any[]) => [key, resolve(value)])));
  return values[input.root.r];
}
function harness(requestTarget: AtlasPostgameQueryTarget = target) {
  const requestKey = `${requestTarget.roomCode}:${requestTarget.roomCreatedAt}:${requestTarget.gameNumber}:${requestTarget.gameHistoryStartedAt}`;
  const requestApi = `https://realtime.riftatlas-workers.com/api/replays/${encodeURIComponent(requestKey)}`;
  const token = `header.${Buffer.from(JSON.stringify({ sub: "account-a", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
  let session = { user: { id: "account-a", email: "not-returned@example.invalid" }, session: { id: "session-a" } };
  const metadata: Record<string, unknown> = { gameKey: requestKey, gameId: "game-id", status: "ready", expiresAt: Date.now() + 60_000, canFork: true, ownPlayerIds: ["player-a"], finalFrameIndex: 1 };
  let payload: unknown = envelope(view());
  const fetcher = vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
    if (url.endsWith("/get-session")) return response(session);
    if (url.endsWith("/token")) return response({ token });
    if (url.endsWith("/metadata")) return response(metadata);
    if (url === requestApi) return response(payload);
    throw new Error("Unexpected endpoint");
  });
  const page = new EventTarget();
  const context = vm.createContext({ window: page, location: { origin: "https://play.riftatlas.com", href: target.expectedPageUrl }, fetch: fetcher, URL, AbortController, TextEncoder, TextDecoder, atob, setTimeout, clearTimeout, TypeError, Symbol });
  return { token, metadata, fetcher, context, page, setPayload(value: unknown) { payload = value; }, changeSession() { session = { ...session, session: { id: "session-b" } }; }, run(input = target): Promise<AtlasPostgameQueryResult> { return vm.runInContext(exported.atlasPostgameQueryScript(input), context); } };
}

describe("Atlas completed replay guest query", () => {
  const pendingCompletion = (expectedPageUrl = "https://play.riftatlas.com/lobby"): AtlasPostgameQueryTarget => ({
    ...target, gameHistoryEndedAt: undefined, completionCheck: "atlas", expectedPageUrl,
  });
  const pendingBo3 = (gameNumber = 2): AtlasPostgameQueryTarget => ({ ...pendingCompletion(), gameNumber,
    completionMatchFormat: "bo3", completionSeriesStartedAt: start - 2000 });
  function bo3Harness(input = pendingBo3()) {
    const h = harness(input), payload = view();
    payload.replayId = `${input.roomCode}:${input.roomCreatedAt}:${input.gameNumber}:${input.gameHistoryStartedAt}`;
    for (const frame of payload.frames) Object.assign(frame.state, { gameNumber: input.gameNumber, matchFormat: "bo3", seriesStartedAt: input.completionSeriesStartedAt });
    h.context.location.href = input.expectedPageUrl;
    h.setPayload(envelope(payload));
    return { h, input, payload };
  }
  function sweepProofHarness(winner = "player-a", winCount = 1) {
    const { h, input, payload } = bo3Harness({ ...pendingBo3(), completionSeriesWinnerPlayerId: winner });
    const opponent = winner === "player-a" ? "player-b" : "player-a";
    payload.frames = payload.frames.map(frame => ({ ...frame, state: structuredClone(frame.state) }));
    for (const frame of payload.frames) {
      delete (frame.state as Record<string, unknown>).gameOutcome;
      Object.assign(frame.state, { winsByPlayerId: { [winner]: winCount, [opponent]: 0 } });
    }
    Object.assign(payload.frames[1].state, { gameHistoryEndedAt: payload.completedAt, gameOutcome: { reason: "score", winnerPlayerIds: [winner] } });
    h.setPayload(envelope(payload));
    return { h, input, payload, winner, opponent };
  }
  it.each([["player-a", 1], ["player-b", 1], ["player-a", 2], ["player-b", 2]] as const)("proves a two-game sweep from the native winner %s with cumulative wins %i", async (winner, wins) => {
    const { h, input, payload } = sweepProofHarness(winner, wins);
    const before = JSON.stringify(payload);
    const result = await h.run(input);
    expect(result.status).toBe("ready");
    const final = decode(result.replay!).frames.at(-1).state;
    expect(final.gameOutcome.winnerPlayerIds).toEqual([winner]);
    expect(final.winsByPlayerId[winner]).toBe(wins);
    expect(JSON.stringify(payload)).toBe(before);
  });
  it.each(["archive only", "opposite winner", "missing end", "tied wins", "opposite wins", "missing wins", "null wins", "extra participant", "invalid wins", "early final frame", "restricted cards"])("does not confirm a missing series win from insufficient or contradictory native evidence: %s", async invalid => {
    const { h, input, payload, winner, opponent } = sweepProofHarness();
    const final = payload.frames[1].state as Record<string, unknown>;
    if (invalid === "archive only") { delete final.gameOutcome; delete final.gameHistoryEndedAt; }
    if (invalid === "opposite winner") final.gameOutcome = { reason: "score", winnerPlayerIds: [opponent] };
    if (invalid === "missing end") delete final.gameHistoryEndedAt;
    if (invalid === "tied wins") final.winsByPlayerId = { [winner]: 1, [opponent]: 1 };
    if (invalid === "opposite wins") final.winsByPlayerId = { [winner]: 0, [opponent]: 2 };
    if (invalid === "missing wins") delete final.winsByPlayerId;
    if (invalid === "null wins") final.winsByPlayerId = null;
    if (invalid === "extra participant") final.winsByPlayerId = { [winner]: 1, [opponent]: 0, third: 0 };
    if (invalid === "invalid wins") final.winsByPlayerId = { [winner]: 3, [opponent]: 0 };
    if (invalid === "early final frame") payload.frames[1].elapsedMs -= 6000;
    if (invalid === "restricted cards") payload.canSwitchPerspective = false;
    h.setPayload(envelope(payload));
    await expect(h.run(input)).rejects.toThrow();
  });
  it.each(["BO1", "game one", "game three", "invalid winner"])("rejects an invalid two-game sweep proof request before networking: %s", async invalid => {
    const { h, input } = sweepProofHarness();
    if (invalid === "BO1") { delete input.completionMatchFormat; delete input.completionSeriesStartedAt; input.gameNumber = 1; }
    if (invalid === "game one") input.gameNumber = 1;
    if (invalid === "game three") input.gameNumber = 3;
    if (invalid === "invalid winner") input.completionSeriesWinnerPlayerId = "bad winner";
    await expect(h.run(input)).rejects.toThrow("Invalid completed Atlas game");
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it("keeps an unavailable native sweep proof pending without exposing a replay", async () => {
    const { h, input } = sweepProofHarness();
    h.metadata.status = "pending";
    const result = await h.run(input);
    expect(result.status).toBe("pending");
    expect(result.replay).toBeUndefined();
    expect(h.fetcher).toHaveBeenCalledTimes(3);
  });
  it("returns only a fixed diagnostic reason across Electron's guest boundary", async () => {
    const input = pendingCompletion(), h = harness(input);
    h.context.location.href = input.expectedPageUrl;
    const payload = view(); payload.frames[1].elapsedMs = 1;
    h.setPayload(envelope(payload));
    await expect(vm.runInContext(exported.atlasPostgameQueryScript(input, true), h.context)).resolves.toEqual({ riftlitePostgameFailure: "incomplete" });
    h.fetcher.mockRejectedValue(new Error("secret-token-room-account-payload-must-not-leave-guest"));
    await expect(vm.runInContext(exported.atlasPostgameQueryScript(input, true), h.context)).resolves.toEqual({ riftlitePostgameFailure: "unknown" });
    h.fetcher.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(vm.runInContext(exported.atlasPostgameQueryScript(input, true), h.context)).resolves.toEqual({ riftlitePostgameFailure: "network" });
  });
  function setupPrefixHarness(gameNumber = 2) {
    const { h, input, payload } = bo3Harness(pendingBo3(gameNumber));
    if (gameNumber < 3) {
      for (const frame of payload.frames) delete (frame.state as Record<string, unknown>).gameOutcome;
      payload.frames[1].elapsedMs -= 6000;
    }
    const phases = ["sideboarding", "battlefield_pick", "initiative_roll", "first_player_choice", "mulligan"];
    const prefix = phases.map((phase, index) => {
      const state = structuredClone(payload.frames[0].state);
      delete (state as Record<string, unknown>).gameHistoryStartedAt;
      delete (state as Record<string, unknown>).gameOutcome;
      return { index, sequence: index, elapsedMs: 0, actionType: phase, state: { ...state, phase } };
    });
    payload.frames = [...prefix, ...payload.frames.map((frame, offset) => ({ ...frame, index: prefix.length + offset, sequence: prefix.length + offset }))];
    h.metadata.finalFrameIndex = payload.frames.length - 1;
    return { h, input, payload, prefixLength: prefix.length };
  }
  it.each([1, 2, 3])("retains the native setup prefix before exact gameplay starts in BO3 Game %i", async gameNumber => {
    const { h, input, payload, prefixLength } = setupPrefixHarness(gameNumber);
    h.setPayload(envelope(payload));
    const result = await h.run(input);
    expect(result.status).toBe("ready");
    const frames = decode(result.replay!).frames;
    expect(frames).toHaveLength(payload.frames.length);
    expect(frames.map((frame: any) => frame.index)).toEqual(payload.frames.map(frame => frame.index));
    for (const frame of frames.slice(0, prefixLength)) {
      expect(frame.elapsedMs).toBe(0);
      expect(frame.state).not.toHaveProperty("gameHistoryStartedAt");
      expect(frame.state).not.toHaveProperty("gameOutcome");
    }
    expect(frames[prefixLength].state.gameHistoryStartedAt).toBe(input.gameHistoryStartedAt);
  });
  it.each(["null history", "wrong history", "nonzero elapsed", "gameplay phase", "unknown phase", "null outcome", "end field", "turn field", "active player", "wrong room", "wrong series", "wrong game", "wrong participant", "history disappears", "setup after history"])("rejects a contradictory or non-prefix setup frame: %s", async invalid => {
    const { h, input, payload, prefixLength } = setupPrefixHarness();
    const first = payload.frames[0];
    if (invalid === "null history") Object.assign(first.state, { gameHistoryStartedAt: null });
    if (invalid === "wrong history") Object.assign(first.state, { gameHistoryStartedAt: start - 1 });
    if (invalid === "nonzero elapsed") first.elapsedMs = 1;
    if (invalid === "gameplay phase") first.state.phase = "in_game";
    if (invalid === "unknown phase") first.state.phase = "unknown";
    if (invalid === "null outcome") Object.assign(first.state, { gameOutcome: null });
    if (invalid === "end field") Object.assign(first.state, { gameHistoryEndedAt: null });
    if (invalid === "turn field") Object.assign(first.state, { turnNumber: 0 });
    if (invalid === "active player") Object.assign(first.state, { activeTurnPlayerId: "player-a" });
    if (invalid === "wrong room") first.state.roomCode = "OTHER";
    if (invalid === "wrong series") Object.assign(first.state, { seriesStartedAt: start - 3000 });
    if (invalid === "wrong game") first.state.gameNumber = 1;
    if (invalid === "wrong participant") first.state.players[1].id = "outsider";
    if (invalid === "history disappears") delete (payload.frames[prefixLength].state as Record<string, unknown>).gameHistoryStartedAt;
    if (invalid === "setup after history") Object.assign(first.state, { gameHistoryStartedAt: start });
    h.setPayload(envelope(payload));
    await expect(h.run(input)).rejects.toThrow();
  });
  it.each([1, 2, 3])("confirms missing-ending BO3 Game %i against its exact series and completed Atlas export", async gameNumber => {
    const { h, input } = bo3Harness(pendingBo3(gameNumber));
    const result = await h.run(input);
    expect(result.status).toBe("ready");
    expect(decode(result.replay!).frames.every((frame: any) => frame.state.gameNumber === gameNumber && frame.state.seriesStartedAt === input.completionSeriesStartedAt)).toBe(true);
  });
  it.each([[1, 3199], [2, 5866]])("accepts a completed native BO3 Game %i archive without inventing terminal board fields", async (gameNumber, completionGapMs) => {
    const { h, input, payload } = bo3Harness(pendingBo3(gameNumber));
    for (const frame of payload.frames) {
      delete (frame.state as Record<string, unknown>).gameOutcome;
      delete (frame.state as Record<string, unknown>).gameHistoryEndedAt;
    }
    payload.frames[1].elapsedMs -= completionGapMs;
    h.setPayload(envelope(payload));
    const result = await h.run(input);
    expect(result.status).toBe("ready");
    const projected = decode(result.replay!);
    expect(projected.completedAt).toBe(payload.completedAt);
    expect(projected.frames[1].elapsedMs).toBe(60_000 - completionGapMs);
    for (const frame of projected.frames) {
      expect(frame.state).not.toHaveProperty("gameOutcome");
      expect(frame.state).not.toHaveProperty("gameHistoryEndedAt");
    }
  });
  it.each(["BO1", "game three", "null outcome", "partial ending", "earlier partial ending", "earlier null outcome", "missing completed", "future completed", "frame past end", "wrong final index", "wrong series", "wrong owner"])("keeps completion and ownership fences for native archives: %s", async invalid => {
    const { h, input, payload } = bo3Harness(pendingBo3(invalid === "game three" ? 3 : invalid === "BO1" ? 1 : 2));
    for (const frame of payload.frames) delete (frame.state as Record<string, unknown>).gameOutcome;
    payload.frames[1].elapsedMs = 54_134;
    if (invalid === "BO1") {
      delete input.completionMatchFormat; delete input.completionSeriesStartedAt;
      for (const frame of payload.frames) Object.assign(frame.state, { gameNumber: 1, matchFormat: "bo1" });
    }
    if (invalid === "null outcome") Object.assign(payload.frames[1].state, { gameOutcome: null });
    if (invalid === "partial ending") Object.assign(payload.frames[1].state, { gameHistoryEndedAt: payload.completedAt });
    if (invalid === "earlier partial ending" || invalid === "earlier null outcome") {
      payload.frames[0].state = structuredClone(payload.frames[0].state);
      Object.assign(payload.frames[0].state, invalid === "earlier partial ending" ? { gameHistoryEndedAt: payload.completedAt } : { gameOutcome: null });
    }
    if (invalid === "missing completed") delete (payload as Record<string, unknown>).completedAt;
    if (invalid === "future completed") payload.completedAt = Date.now() + 120_000;
    if (invalid === "frame past end") payload.frames[1].elapsedMs = 61_001;
    if (invalid === "wrong final index") payload.frames[1].index = 2;
    if (invalid === "wrong series") Object.assign(payload.frames[0].state, { seriesStartedAt: start - 3000 });
    if (invalid === "wrong owner") h.metadata.ownPlayerIds = ["another-player"];
    h.setPayload(envelope(payload));
    await expect(h.run(input)).rejects.toThrow();
  });
  it.each(["missing series", "bad series", "series after start", "format without check", "series without format", "unknown format"])("rejects malformed BO3 confirmation target: %s before auth", async invalid => {
    const { h, input } = bo3Harness();
    if (invalid === "missing series") delete input.completionSeriesStartedAt;
    if (invalid === "bad series") input.completionSeriesStartedAt = -1;
    if (invalid === "series after start") input.completionSeriesStartedAt = start + 1;
    if (invalid === "format without check") { delete input.completionCheck; input.gameHistoryEndedAt = start + 60_000; }
    if (invalid === "series without format") { delete input.completionMatchFormat; input.gameNumber = 1; }
    if (invalid === "unknown format") Object.assign(input, { completionMatchFormat: "bo5" });
    await expect(h.run(input)).rejects.toThrow("Invalid completed");
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it.each(["wrong series", "missing series", "wrong format", "wrong game", "wrong participant", "missing completion", "unfinished outcome"])("rejects mismatched or unfinished BO3 export: %s", async invalid => {
    const { h, input, payload } = bo3Harness();
    payload.frames[0].state = structuredClone(payload.frames[0].state);
    if (invalid === "wrong series") Object.assign(payload.frames[0].state, { seriesStartedAt: start - 3000 });
    if (invalid === "missing series") delete (payload.frames[0].state as Record<string, unknown>).seriesStartedAt;
    if (invalid === "wrong format") payload.frames[0].state.matchFormat = "bo1";
    if (invalid === "wrong game") payload.frames[0].state.gameNumber = 1;
    if (invalid === "wrong participant") payload.frames[0].state.players[1].id = "outside-player";
    if (invalid === "missing completion") delete (payload as Record<string, unknown>).completedAt;
    if (invalid === "unfinished outcome") {
      delete (payload.frames[1].state as Record<string, unknown>).gameOutcome;
      Object.assign(payload.frames[1].state, { gameHistoryEndedAt: payload.completedAt });
    }
    h.setPayload(envelope(payload));
    await expect(h.run(input)).rejects.toThrow();
  });
  it("does not fetch BO3 data while still on the game page or when Atlas restricts it", async () => {
    const { h, input } = bo3Harness();
    input.expectedPageUrl = "https://play.riftatlas.com/game"; h.context.location.href = input.expectedPageUrl;
    expect((await h.run(input)).status).toBe("deferred"); expect(h.fetcher).not.toHaveBeenCalled();
    input.expectedPageUrl = "https://play.riftatlas.com/lobby"; h.context.location.href = input.expectedPageUrl;
    h.metadata.forkBlockedReason = "private_deck";
    expect((await h.run(input)).status).toBe("restricted");
    expect(h.fetcher.mock.calls.every(call => !call[0].includes("/api/replays/") || call[0].endsWith("/metadata"))).toBe(true);
  });
  it("rejects a private-deck Game 3 export even when its ready owned metadata permits collection", async () => {
    const { h, input, payload } = bo3Harness(pendingBo3(3));
    Object.assign(payload, { canSwitchPerspective: false, canFork: false, forkBlockedReason: "private_deck" });
    expect(payload).not.toHaveProperty("privateDeckPlayerIds");
    expect(h.metadata).toMatchObject({ status: "ready", canFork: true, ownPlayerIds: [input.localPlayerId] });
    h.setPayload(envelope(payload));
    await expect(h.run(input)).rejects.toThrow("restricted or mismatched replay");
    expect(h.fetcher.mock.calls.map(call => call[0])).toEqual([
      "https://auth.riftatlas.com/api/auth/get-session", "https://auth.riftatlas.com/api/auth/token",
      `https://realtime.riftatlas-workers.com/api/replays/${encodeURIComponent(payload.replayId)}/metadata`,
      `https://realtime.riftatlas-workers.com/api/replays/${encodeURIComponent(payload.replayId)}`,
    ]);
  });

  it.each(["/", "/lobby", "/lobby/", "/en/lobby", `/replays/${encodeURIComponent(key)}`])("confirms an exact missing-ending game from %s through ready metadata and a completed export", async path => {
    const h = harness(), input = pendingCompletion(`https://play.riftatlas.com${path}`);
    h.context.location.href = input.expectedPageUrl;
    expect(h.metadata).not.toHaveProperty("completedAt"); // Atlas's actual ready contract has finalFrameIndex.
    const result = await h.run(input);
    expect(result.status).toBe("ready");
    expect(decode(result.replay!).completedAt).toBe(start + 60_000);
    expect(h.fetcher.mock.calls.map(call => call[0])).toEqual([
      "https://auth.riftatlas.com/api/auth/get-session", "https://auth.riftatlas.com/api/auth/token", `${api}/metadata`, api, "https://auth.riftatlas.com/api/auth/get-session",
    ]);
  });
  it.each(["/game", "/game/", "/en/game", "/zh-CN/game/", "/?room=ROOM", "/lobby?room=ROOM"])("defers a missing-ending candidate on %s before any auth or network work", async path => {
    const h = harness(), input = pendingCompletion(`https://play.riftatlas.com${path}`);
    h.context.location.href = input.expectedPageUrl;
    expect(await h.run(input)).toEqual({ status: "deferred", gameKey: key });
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it.each(["missing flag", "zero ending", "negative ending", "null ending", "ending before start", "not BO1", "room after start", "future start"])("rejects invalid fallback target %s before auth", async invalid => {
    const h = harness(), input = pendingCompletion();
    h.context.location.href = input.expectedPageUrl;
    if (invalid === "missing flag") delete input.completionCheck;
    if (invalid === "zero ending") input.gameHistoryEndedAt = 0;
    if (invalid === "negative ending") input.gameHistoryEndedAt = -1;
    if (invalid === "null ending") Object.assign(input, { gameHistoryEndedAt: null });
    if (invalid === "ending before start") input.gameHistoryEndedAt = start - 1;
    if (invalid === "not BO1") input.gameNumber = 2;
    if (invalid === "room after start") input.roomCreatedAt = start + 1;
    if (invalid === "future start") input.gameHistoryStartedAt = Date.now() + 120_000;
    await expect(h.run(input)).rejects.toThrow("Invalid completed");
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it.each(["pending", "missing final index", "zero final index", "fractional final index", "huge final index", "missing game id", "missing expiry"])("never requests full data for incomplete ready evidence: %s", async invalid => {
    const h = harness(), input = pendingCompletion();
    h.context.location.href = input.expectedPageUrl;
    if (invalid === "pending") h.metadata.status = "pending";
    if (invalid === "missing final index") delete h.metadata.finalFrameIndex;
    if (invalid === "zero final index") h.metadata.finalFrameIndex = 0;
    if (invalid === "fractional final index") h.metadata.finalFrameIndex = 1.5;
    if (invalid === "huge final index") h.metadata.finalFrameIndex = 10_000;
    if (invalid === "missing game id") delete h.metadata.gameId;
    if (invalid === "missing expiry") delete h.metadata.expiresAt;
    expect((await h.run(input)).status).toBe("pending");
    expect(h.fetcher.mock.calls.some(call => call[0] === api)).toBe(false);
  });
  it.each(["wrong metadata game", "wrong owner", "restricted"])("retains fallback identity and privacy checks: %s", async invalid => {
    const h = harness(), input = pendingCompletion();
    h.context.location.href = input.expectedPageUrl;
    if (invalid === "wrong metadata game") h.metadata.gameKey = "wrong-game";
    if (invalid === "wrong owner") h.metadata.ownPlayerIds = ["other-player"];
    if (invalid === "restricted") h.metadata.forkBlockedReason = "private_deck";
    if (invalid === "restricted") expect((await h.run(input)).status).toBe("restricted");
    else await expect(h.run(input)).rejects.toThrow();
    expect(h.fetcher.mock.calls.some(call => call[0] === api)).toBe(false);
  });
  it.each(["wrong replay", "wrong start", "wrong room", "wrong participant", "wrong winner", "no outcome", "wrong outcome", "missing completed", "future completed", "end before start", "wrong elapsed", "wrong final index", "reversed sequence", "wrong game", "BO3", "wrong explicit ending"])("rejects an unconfirmed final export: %s", async invalid => {
    const h = harness(), input = pendingCompletion(), payload = view();
    h.context.location.href = input.expectedPageUrl;
    if (invalid === "wrong replay") payload.replayId = "other";
    if (invalid === "wrong start") payload.createdAt++;
    if (invalid === "wrong room") payload.frames[1].state.roomCode = "OTHER";
    if (invalid === "wrong participant") payload.frames[1].state.players[1].id = "outside-player";
    if (invalid === "wrong winner") payload.frames[1].state.gameOutcome.winnerPlayerIds = ["outside-player"];
    if (invalid === "no outcome") delete (payload.frames[1].state as Record<string, unknown>).gameOutcome;
    if (invalid === "wrong outcome") payload.frames[1].state.gameOutcome.reason = "pending";
    if (invalid === "missing completed") delete (payload as Record<string, unknown>).completedAt;
    if (invalid === "future completed") payload.completedAt = Date.now() + 120_000;
    if (invalid === "end before start") payload.completedAt = start - 1;
    if (invalid === "wrong elapsed") payload.frames[1].elapsedMs = 30_000;
    if (invalid === "wrong final index") h.metadata.finalFrameIndex = 2;
    if (invalid === "reversed sequence") payload.frames[1].sequence = 0;
    if (invalid === "wrong game") payload.frames[1].state.gameNumber = 2;
    if (invalid === "BO3") payload.frames[1].state.matchFormat = "bo3";
    if (invalid === "wrong explicit ending") Object.assign(payload.frames[1].state, { gameHistoryEndedAt: start + 10_000 });
    h.setPayload(envelope(payload));
    await expect(h.run(input)).rejects.toThrow();
  });
  it("accepts the matching optional provider ending without requiring one", async () => {
    const h = harness(), input = pendingCompletion(), payload = view();
    h.context.location.href = input.expectedPageUrl;
    Object.assign(payload.frames[1].state, { gameHistoryEndedAt: payload.completedAt });
    h.setPayload(envelope(payload));
    expect((await h.run(input)).status).toBe("ready");
  });
  it("cancels a fallback before full fetch when the lobby navigates into a game", async () => {
    const h = harness(), input = pendingCompletion();
    h.context.location.href = input.expectedPageUrl;
    const base = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => {
      const result = await base(url, init);
      if (url === `${api}/metadata`) h.context.location.href = "https://play.riftatlas.com/game";
      return result;
    });
    await expect(h.run(input)).rejects.toThrow("cancelled");
    expect(h.fetcher.mock.calls.some(call => call[0] === api)).toBe(false);
  });
  it("uses current account auth, exact replay metadata then compact export; credentials never cross the guest boundary", async () => {
    const h = harness(), result = await h.run();
    expect(result).toMatchObject({ status: "ready", gameKey: key, accountId: "account-a", sessionId: "session-a" });
    expect(h.fetcher.mock.calls.map(call => call[0])).toEqual(["https://auth.riftatlas.com/api/auth/get-session", "https://auth.riftatlas.com/api/auth/token", `${api}/metadata`, api, "https://auth.riftatlas.com/api/auth/get-session"]);
    expect(h.fetcher.mock.calls[1][1]).toMatchObject({ method: "POST", credentials: "include", redirect: "error", cache: "no-store" });
    expect(h.fetcher.mock.calls[3][1]?.headers).toEqual({ authorization: `Bearer ${h.token}`, accept: "application/vnd.riftatlas.replay+json;version=2" });
    expect(JSON.stringify(result)).not.toContain(h.token);
    expect(JSON.stringify(result)).not.toContain("NO_STORE");
    expect(JSON.stringify(result)).not.toContain("not-returned");
    const full = decode(result.replay!);
    expect(full.frames[0].state).toBe(full.frames[1].state);
    expect(full.frames[0].state.players[0].board.battlefieldToken).toHaveLength(1);
    expect(full.frames[0].state).not.toHaveProperty("mulliganPlaybackByPlayerId");
  });
  it("retains only bounded mulligan facts in the compact post-game export", async () => {
    const h = harness(), input = view(), playback = mulliganPlayback();
    Object.assign(playback["player-b"], { hiddenRefillCardIds: ["NO_STORE"], hiddenRuneCardIds: ["NO_STORE"], privateNotes: "NO_STORE", token: "NO_STORE" });
    Object.assign(playback["player-b"].draws[0], { authorization: "NO_STORE", extraCard: { secret: "NO_STORE" } });
    Object.assign(input.frames[0].state, { mulliganPlaybackByPlayerId: playback });
    h.setPayload(envelope(input));
    const result = await h.run(), full = decode(result.replay!);
    expect(result.status).toBe("ready");
    expect(full.frames[0].state.mulliganPlaybackByPlayerId).toEqual(mulliganPlayback());
    expect(full.frames[0].state).toBe(full.frames[1].state);
    expect(JSON.stringify(result)).not.toContain("NO_STORE");
    expect(full.frames[0].state.mulliganPlaybackByPlayerId["player-b"].draws[0]).toEqual({
      id: "draw-refill", cardId: "card-refill", handCountBeforeDraw: 3, kind: "refill",
    });
  });
  it.each([
    ["non-map", () => []],
    ["null map", () => null],
    ["missing player", () => ({ "player-a": { redrawCount: 0, draws: [] } })],
    ["unrelated player", () => ({ ...mulliganPlayback(), outsider: { redrawCount: 0, draws: [] } })],
    ["negative redraw", () => ({ ...mulliganPlayback(), "player-b": { redrawCount: -1, draws: [] } })],
    ["fractional redraw", () => ({ ...mulliganPlayback(), "player-b": { redrawCount: 1.5, draws: [] } })],
    ["excessive redraw", () => ({ ...mulliganPlayback(), "player-b": { redrawCount: 5, draws: [] } })],
    ["missing draws", () => ({ ...mulliganPlayback(), "player-b": { redrawCount: 0 } })],
    ["excessive draws", () => ({ ...mulliganPlayback(), "player-b": { redrawCount: 0, draws: Array(6).fill(mulliganPlayback()["player-b"].draws[0]) } })],
    ["missing draw identity", () => ({ ...mulliganPlayback(), "player-b": { redrawCount: 1, draws: [{ cardId: "card-refill", handCountBeforeDraw: 3, kind: "refill" }] } })],
    ["nested card identity", () => ({ ...mulliganPlayback(), "player-b": { redrawCount: 1, draws: [{ ...mulliganPlayback()["player-b"].draws[0], cardId: { secret: "NO_STORE" } }] } })],
    ["oversized card identity", () => ({ ...mulliganPlayback(), "player-b": { redrawCount: 1, draws: [{ ...mulliganPlayback()["player-b"].draws[0], cardId: "x".repeat(513) }] } })],
    ["invalid draw kind", () => ({ ...mulliganPlayback(), "player-b": { redrawCount: 1, draws: [{ ...mulliganPlayback()["player-b"].draws[0], kind: "secret" }] } })],
    ["invalid hand count", () => ({ ...mulliganPlayback(), "player-b": { redrawCount: 1, draws: [{ ...mulliganPlayback()["player-b"].draws[0], handCountBeforeDraw: 5 }] } })],
  ])("omits %s optional mulligan metadata while retaining the normal replay", async (_label, makePlayback) => {
    const h = harness(), input = view();
    Object.assign(input.frames[0].state, { mulliganPlaybackByPlayerId: makePlayback() });
    h.setPayload(envelope(input));
    const result = await h.run(), full = decode(result.replay!);
    expect(result.status).toBe("ready");
    expect(full.frames[0].state).not.toHaveProperty("mulliganPlaybackByPlayerId");
    expect(full.frames[0].state.players[0].board.hand).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("NO_STORE");
  });
  it.each(["pending", "expired", "unavailable", "restricted"])("does not fetch full data when metadata is %s", async status => {
    const h = harness();
    if (status === "restricted") h.metadata.canFork = false; else h.metadata.status = status;
    expect((await h.run()).status).toBe(status);
    expect(h.fetcher.mock.calls.some(call => call[0] === api)).toBe(false);
  });
  it.each([404, 429, 503])("keeps HTTP %s retryable at metadata and full replay stages", async status => {
    for (const affected of [`${api}/metadata`, api]) {
      const h = harness(), base = h.fetcher.getMockImplementation()!;
      h.fetcher.mockImplementation(async (url, init) => url === affected ? response({}, status) : base(url, init));
      if (status === 404) expect((await h.run()).status).toBe("pending");
      else await expect(h.run()).rejects.toThrow("temporarily unavailable");
    }
  });
  it("uses the observed same-origin auth fallback only for a network TypeError", async () => {
    const h = harness(); h.fetcher.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect((await h.run()).status).toBe("ready");
    expect(h.fetcher.mock.calls[1][0]).toBe("https://play.riftatlas.com/api/auth/get-session");
    expect(h.fetcher.mock.calls[1][1]).toMatchObject({ credentials: "same-origin", headers: { "x-account-auth-fallback": "1" } });
    const rejected = harness(); rejected.fetcher.mockResolvedValueOnce(response({}, 401));
    await expect(rejected.run()).rejects.toThrow("sign-in"); expect(rejected.fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects different origin, path, room, or an incomplete target before auth", async () => {
    for (const changed of [{ expectedPageUrl: "https://example.com/" }, { expectedPageUrl: "https://play.riftatlas.com/decks" }, { expectedPageUrl: "https://play.riftatlas.com/game?room=OTHER" }, { gameHistoryEndedAt: 0 }]) {
      const h = harness(); await expect(h.run({ ...target, ...changed })).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled();
    }
  });
  it("allows the current localized lobby route under the same idle fence", async () => {
    const h = harness(), expectedPageUrl = "https://play.riftatlas.com/en/lobby";
    h.context.location.href = expectedPageUrl;
    expect((await h.run({ ...target, expectedPageUrl })).status).toBe("ready");
  });
  it.each(["", "/en", "/zh-CN", "/fr", "/ko"])("collects from the same completed game's native replay route with locale %s", async locale => {
    const h = harness(), expectedPageUrl = `https://play.riftatlas.com${locale}/replays/${encodeURIComponent(key)}`;
    h.context.location.href = expectedPageUrl;
    expect((await h.run({ ...target, expectedPageUrl })).status).toBe("ready");
    expect(h.fetcher.mock.calls.filter(call => call[0] === api)).toHaveLength(1);
  });
  it("rejects unrelated, malformed, double-encoded and nested native replay routes before auth", async () => {
    for (const suffix of [encodeURIComponent(key.replace("ROOM", "OTHER")), encodeURIComponent(encodeURIComponent(key)), `${encodeURIComponent(key)}/`, `${encodeURIComponent(key)}/fork`, "local-file", "share-token"]) {
      const h = harness(), expectedPageUrl = `https://play.riftatlas.com/replays/${suffix}`;
      h.context.location.href = expectedPageUrl;
      await expect(h.run({ ...target, expectedPageUrl })).rejects.toThrow("completed game");
      expect(h.fetcher).not.toHaveBeenCalled();
    }
  });
  it("cancels collection when leaving a native replay route", async () => {
    const h = harness(), expectedPageUrl = `https://play.riftatlas.com/replays/${encodeURIComponent(key)}`;
    h.context.location.href = expectedPageUrl;
    const base = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => {
      const result = await base(url, init);
      if (url === `${api}/metadata`) h.context.location.href = "https://play.riftatlas.com/game";
      return result;
    });
    await expect(h.run({ ...target, expectedPageUrl })).rejects.toThrow("cancelled");
    expect(h.fetcher.mock.calls.some(call => call[0] === api)).toBe(false);
  });
  it("requires metadata ownership and exact source game identity", async () => {
    const h = harness(); h.metadata.ownPlayerIds = ["other"];
    await expect(h.run()).rejects.toThrow("does not own"); expect(h.fetcher.mock.calls.some(call => call[0] === api)).toBe(false);
    const wrong = harness(); wrong.setPayload(envelope({ ...view(), replayId: "other" }));
    await expect(wrong.run()).rejects.toThrow("mismatched");
  });
  it("discards the collected replay when the account session changes", async () => {
    const h = harness(), base = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => { const result = await base(url, init); if (url === api) h.changeSession(); return result; });
    await expect(h.run()).rejects.toThrow("account changed");
  });
  it("aborts when navigation or the main lifecycle cancels the job", async () => {
    const h = harness(), base = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => { const result = await base(url, init); if (url === `${api}/metadata`) h.context.location.href = "https://play.riftatlas.com/game?room=NEW"; return result; });
    await expect(h.run()).rejects.toThrow("cancelled"); expect(h.fetcher.mock.calls.some(call => call[0] === api)).toBe(false);
    const cancelled = harness(), second = cancelled.fetcher.getMockImplementation()!;
    cancelled.fetcher.mockImplementation(async (url, init) => { const result = await second(url, init); if (url === `${api}/metadata`) vm.runInContext(exported.atlasPostgameCancelScript(), cancelled.context); return result; });
    await expect(cancelled.run()).rejects.toThrow("cancelled");
  });
  it("rejects oversized bodies and illegal DAG references before returning any export", async () => {
    const h = harness(), base = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => url === api ? response({}, 200, { "content-length": String(8 * 1024 * 1024) }) : base(url, init));
    await expect(h.run()).rejects.toThrow("size limit");
    const bad = harness(); bad.setPayload({ format: "riftatlas-replay", version: 2, nodes: [["a", [{ r: 0 }]]], root: { r: 0 } });
    await expect(bad.run()).rejects.toThrow("invalid references");
  });
});
