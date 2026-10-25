import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AtlasPostgameQueryTarget, AtlasPostgameQueryResult } from "../src/main/services/atlasPostgameQuery";

const compiled = ts.transpileModule(readFileSync(new URL("../src/main/services/atlasPostgameQuery.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exported = {} as { atlasPostgameQueryScript: (target: AtlasPostgameQueryTarget) => string; atlasPostgameCancelScript: () => string };
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
function harness() {
  const token = `header.${Buffer.from(JSON.stringify({ sub: "account-a", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
  let session = { user: { id: "account-a", email: "not-returned@example.invalid" }, session: { id: "session-a" } };
  const metadata: Record<string, unknown> = { gameKey: key, gameId: "game-id", status: "ready", expiresAt: Date.now() + 60_000, canFork: true, ownPlayerIds: ["player-a"], finalFrameIndex: 1 };
  let payload: unknown = envelope(view());
  const fetcher = vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
    if (url.endsWith("/get-session")) return response(session);
    if (url.endsWith("/token")) return response({ token });
    if (url.endsWith("/metadata")) return response(metadata);
    if (url === api) return response(payload);
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
