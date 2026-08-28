import { describe, expect, it } from "vitest";

import {
  ATLAS_MATCHMAKING_RECOVERY_PROTECTION_MS,
  AtlasAutomaticRecoverySafetyFence,
  canStartAtlasAutomaticRecovery,
  isAtlasAutomaticRecoveryLobbyUrl,
  isAtlasProtectedGameRouteUrl
} from "../src/main/services/atlasAutomaticRecoverySafetyFence.js";
import { shouldAutoRepairAtlasEmptyShell } from "../src/shared/atlasWebviewRecovery.js";

describe("Atlas automatic-recovery safety fence", () => {
  it("accepts only exact Atlas lobby routes, including supported locale prefixes", () => {
    for (const url of [
      "https://play.riftatlas.com/",
      "https://play.riftatlas.com/?from=desktop#lobby",
      "https://play.riftatlas.com/lobby",
      "https://play.riftatlas.com/lobby/",
      "https://play.riftatlas.com/en",
      "https://play.riftatlas.com/en/lobby",
      "https://play.riftatlas.com/zh-CN/lobby/"
    ]) {
      expect(isAtlasAutomaticRecoveryLobbyUrl(url), url).toBe(true);
    }

    for (const url of [
      "http://play.riftatlas.com/",
      "https://play.riftatlas.com:8443/",
      "https://play.riftatlas.com.evil.example/",
      "https://play.riftatlas.com/decks",
      "https://play.riftatlas.com/en/decks",
      "https://play.riftatlas.com/lobby/game",
      "https://play.riftatlas.com/sign-in"
    ]) {
      expect(isAtlasAutomaticRecoveryLobbyUrl(url), url).toBe(false);
    }
  });

  it("protects Atlas game, play, and room routes, including locale-prefixed routes", () => {
    for (const url of [
      "https://play.riftatlas.com/game",
      "https://play.riftatlas.com/game/ROOM1",
      "https://play.riftatlas.com/play/ROOM1",
      "https://play.riftatlas.com/room/ROOM1",
      "https://play.riftatlas.com/en/game/ROOM1",
      "https://play.riftatlas.com/zh-CN/room/ROOM1"
    ]) {
      expect(isAtlasProtectedGameRouteUrl(url), url).toBe(true);
    }

    for (const url of [
      "https://play.riftatlas.com/",
      "https://play.riftatlas.com/lobby",
      "https://play.riftatlas.com/gameplay",
      "https://play.riftatlas.com.evil.example/game",
      "https://example.com/game"
    ]) {
      expect(isAtlasProtectedGameRouteUrl(url), url).toBe(false);
    }
  });

  it("arms a conservative hold from trusted matchmaking start/searching frames", () => {
    let now = 10_000;
    const fence = new AtlasAutomaticRecoverySafetyFence(undefined, () => now);
    const matchmakingUrl = "wss://realtime.riftatlas-workers.com/parties/matchmaking?playerId=local";

    expect(fence.observeRealtimeFrame(41, matchmakingUrl, JSON.stringify({ type: "searching" }))).toBe(true);
    expect(fence.isProtected(41, "https://play.riftatlas.com/")).toBe(true);

    now += ATLAS_MATCHMAKING_RECOVERY_PROTECTION_MS - 1;
    expect(fence.isProtected(41, "https://play.riftatlas.com/")).toBe(true);
    now += 1;
    expect(fence.isProtected(41, "https://play.riftatlas.com/")).toBe(false);

    expect(fence.observeRealtimeFrame(41, matchmakingUrl, { envelope: { type: "start" } })).toBe(true);
    expect(fence.isProtected(41, "https://play.riftatlas.com/lobby")).toBe(true);
  });

  it("extends a guest's hold when later matchmaking activity arrives", () => {
    let now = 1_000;
    const fence = new AtlasAutomaticRecoverySafetyFence(30_000, () => now);
    const matchmakingUrl = "wss://realtime.riftatlas-workers.com/parties/matchmaking";

    fence.observeRealtimeFrame(7, matchmakingUrl, { type: "searching" });
    now = 20_000;
    fence.observeRealtimeFrame(7, matchmakingUrl, { type: "start" });
    now = 31_000;
    expect(fence.isProtected(7, "https://play.riftatlas.com/")).toBe(true);
    now = 50_000;
    expect(fence.isProtected(7, "https://play.riftatlas.com/")).toBe(false);
  });

  it("protects the guest as soon as authoritative match-room traffic arrives", () => {
    const fence = new AtlasAutomaticRecoverySafetyFence(30_000, () => 5_000);
    expect(fence.observeRealtimeFrame(
      9,
      "wss://realtime.riftatlas-workers.com/parties/match/ROOM1?playerId=local",
      { type: "authoritative_state", state: {} }
    )).toBe(true);
    expect(fence.isProtected(9, "https://play.riftatlas.com/")).toBe(true);
  });

  it("ignores untrusted URLs and unrelated or malformed frames", () => {
    const fence = new AtlasAutomaticRecoverySafetyFence(30_000, () => 5_000);
    const rejected: Array<[string, unknown]> = [
      ["wss://realtime.riftatlas-workers.com.evil.example/parties/matchmaking", { type: "start" }],
      ["ws://realtime.riftatlas-workers.com/parties/matchmaking", { type: "start" }],
      ["wss://realtime.riftatlas-workers.com/parties/matchmaking", { type: "matched" }],
      ["wss://realtime.riftatlas-workers.com/parties/matchmaking", "searching"],
      ["wss://realtime.riftatlas-workers.com/parties/matchmaking", "{not-json"]
    ];

    for (const [requestUrl, frame] of rejected) {
      expect(fence.observeRealtimeFrame(9, requestUrl, frame), requestUrl).toBe(false);
    }
    expect(fence.isProtected(9, "https://play.riftatlas.com/")).toBe(false);
  });

  it("isolates and forgets transient protection per guest", () => {
    const fence = new AtlasAutomaticRecoverySafetyFence(30_000, () => 5_000);
    const matchmakingUrl = "wss://realtime.riftatlas-workers.com/parties/matchmaking";

    fence.observeRealtimeFrame(11, matchmakingUrl, { type: "searching" });
    expect(fence.isProtected(11, "https://play.riftatlas.com/")).toBe(true);
    expect(fence.isProtected(12, "https://play.riftatlas.com/")).toBe(false);

    fence.forget(11);
    expect(fence.isProtected(11, "https://play.riftatlas.com/")).toBe(false);
    expect(fence.isProtected(11, "https://play.riftatlas.com/game/ROOM1")).toBe(true);
  });

  it("fails closed when any final recovery invariant changes", () => {
    const safe = {
      targetGuestId: 41,
      currentGuestId: 41,
      currentUrl: "https://play.riftatlas.com/",
      navigationCurrent: true,
      platformSwitchAllowed: true,
      protectedByGameEntry: false
    };
    expect(canStartAtlasAutomaticRecovery(safe)).toBe(true);

    for (const unsafe of [
      { ...safe, currentGuestId: 77 },
      { ...safe, currentGuestId: null },
      { ...safe, currentUrl: "https://play.riftatlas.com/game/ROOM1" },
      { ...safe, currentUrl: "https://play.riftatlas.com/decks" },
      { ...safe, navigationCurrent: false },
      { ...safe, platformSwitchAllowed: false },
      { ...safe, protectedByGameEntry: true }
    ]) {
      expect(canStartAtlasAutomaticRecovery(unsafe), JSON.stringify(unsafe)).toBe(false);
    }
  });

  it("reproduces the lobby-to-game race without permitting a repair", () => {
    let now = 1_787_913_434_684;
    const guestId = 3;
    const lobbyUrl = "https://play.riftatlas.com/";
    const fence = new AtlasAutomaticRecoverySafetyFence(undefined, () => now);
    const matchmakingUrl = "wss://realtime.riftatlas-workers.com/parties/matchmaking/enam-v2-constructed-all-bo3";

    expect(fence.observeRealtimeFrame(guestId, matchmakingUrl, { type: "start" })).toBe(true);
    now += 420;
    expect(fence.observeRealtimeFrame(guestId, matchmakingUrl, { type: "searching" })).toBe(true);

    now += 20_889;
    const eighteenSecondEmpty = {
      platform: "atlas" as const,
      kind: "debug" as const,
      payload: { reason: "atlas-app-shell-empty", routeKind: "lobby" }
    };
    expect(shouldAutoRepairAtlasEmptyShell(eighteenSecondEmpty, false)).toBe(false);
    expect(fence.isProtected(guestId, lobbyUrl)).toBe(true);

    now += 40_000;
    const persistentEmpty = {
      ...eighteenSecondEmpty,
      payload: { ...eighteenSecondEmpty.payload, persistent: true }
    };
    expect(shouldAutoRepairAtlasEmptyShell(persistentEmpty, false)).toBe(true);
    expect(canStartAtlasAutomaticRecovery({
      targetGuestId: guestId,
      currentGuestId: guestId,
      currentUrl: lobbyUrl,
      navigationCurrent: true,
      platformSwitchAllowed: true,
      protectedByGameEntry: fence.isProtected(guestId, lobbyUrl)
    })).toBe(false);

    expect(fence.isProtected(guestId, "https://play.riftatlas.com/game/ROOM1")).toBe(true);
  });

  it("rejects an async recovery continuation after route, capture, or guest replacement", () => {
    const started = {
      targetGuestId: 41,
      currentGuestId: 41,
      currentUrl: "https://play.riftatlas.com/",
      navigationCurrent: true,
      platformSwitchAllowed: true,
      protectedByGameEntry: false
    };
    expect(canStartAtlasAutomaticRecovery(started)).toBe(true);

    expect(canStartAtlasAutomaticRecovery({
      ...started,
      currentUrl: "https://play.riftatlas.com/game/ROOM1"
    })).toBe(false);
    expect(canStartAtlasAutomaticRecovery({
      ...started,
      platformSwitchAllowed: false
    })).toBe(false);
    expect(canStartAtlasAutomaticRecovery({
      ...started,
      currentGuestId: 77
    })).toBe(false);
    expect(canStartAtlasAutomaticRecovery({
      ...started,
      navigationCurrent: false
    })).toBe(false);
  });
});
