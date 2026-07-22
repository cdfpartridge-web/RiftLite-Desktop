import { describe, expect, it } from "vitest";
import {
  AtlasBattlefieldSeatSocketTracker,
  atlasBattlefieldSeatSignalFromFrame,
  atlasSeatCaptureEvent,
  parseAtlasPlayerSeatFrame,
  parseAtlasSeatFrame,
  validatedAtlasBattlefieldSeatSignal
} from "../src/shared/atlasSeatTracker";
import type { RawCaptureAppendFramePayload } from "../src/shared/types";

function frame(
  firstPlayerId: string,
  localPlayerId = "plr_local",
  gameInstanceId = "GAME1",
  roomCode = "ROOM1"
): RawCaptureAppendFramePayload {
  return {
    platform: "atlas",
    requestUrl: `wss://realtime.riftatlas-workers.com/parties/match/${roomCode}?playerId=${localPlayerId}&roomCode=${roomCode}`,
    frame: {
      seq: 12,
      ts: Date.parse("2026-07-12T15:00:00.000Z"),
      dir: "in",
      socketId: "ws-1",
      raw: JSON.stringify({
        type: "authoritative_patch_commit",
        gameInstanceId,
        action: { type: "choose_first_player", firstPlayerId }
      })
    }
  };
}

function playerSeatFrame(
  raw: Record<string, unknown>,
  localPlayerId = "plr_local",
  roomCode = "ROOM1"
): RawCaptureAppendFramePayload {
  return {
    platform: "atlas",
    requestUrl: `wss://realtime.riftatlas-workers.com/parties/match/${roomCode}?playerId=${localPlayerId}&roomCode=${roomCode}`,
    frame: {
      seq: 7,
      ts: Date.parse("2026-07-20T12:00:00.000Z"),
      dir: "in",
      socketId: "ws-2",
      raw: JSON.stringify(raw)
    }
  };
}

describe("Atlas seat tracking", () => {
  it("bridges only the newest live Atlas match socket", () => {
    const sockets = new AtlasBattlefieldSeatSocketTracker();
    const url = (roomCode: string) => (
      `wss://realtime.riftatlas-workers.com/parties/match/${roomCode}?playerId=plr_local&roomCode=${roomCode}`
    );

    sockets.observeOpened("search", "wss://realtime.riftatlas-workers.com/parties/matchmaking?playerId=plr_local");
    expect(sockets.isCurrent("search")).toBe(false);

    sockets.observeOpened("room-a", url("ROOMA"));
    expect(sockets.isCurrent("room-a")).toBe(true);

    sockets.observeOpened("room-b", url("ROOMB"));
    expect(sockets.isCurrent("room-a")).toBe(false);
    expect(sockets.isCurrent("room-b")).toBe(true);

    sockets.observeClosed("room-a");
    expect(sockets.isCurrent("room-b")).toBe(true);
    sockets.observeClosed("room-b");
    expect(sockets.isCurrent("room-b")).toBe(false);
  });

  it("reads a shuffled room-shell player list without using array order", () => {
    const payload = playerSeatFrame({
      type: "room_shell_sync",
      gameInstanceId: "GAME-ZXSTJ",
      sessionDoc: {
        roomCode: "ZXSTJ",
        players: [
          { id: "plr_opponent", seat: 1 },
          { id: "plr_local", seat: 0 }
        ]
      }
    }, "plr_local", "ZXSTJ");

    expect(parseAtlasPlayerSeatFrame(payload)).toEqual({
      frameType: "room_shell_sync",
      gameInstanceId: "GAME-ZXSTJ",
      roomCode: "ZXSTJ",
      localPlayerId: "plr_local",
      localSeat: 0
    });
  });

  it("reads the authoritative self player from a supported room-shell shape", () => {
    const payload = playerSeatFrame({
      type: "room_shell_sync",
      sessionDoc: {
        roomCode: "VL838",
        viewer: { role: "player", playerId: "plr_local" },
        selfPlayer: { id: "plr_local", seat: 0, name: "Bunana" },
        publicPlayers: [{ id: "plr_opponent", seat: 1, name: "lilith" }]
      }
    }, "plr_local", "VL838");

    expect(parseAtlasPlayerSeatFrame(payload)).toMatchObject({
      frameType: "room_shell_sync",
      roomCode: "VL838",
      localPlayerId: "plr_local",
      localSeat: 0
    });
  });

  it("bridges authoritative seat evidence without exposing the player identity", () => {
    const payload = playerSeatFrame({
      type: "room_shell_sync",
      gameInstanceId: "GAME-TFLWZ",
      sessionDoc: {
        roomCode: "TFLWZ",
        viewer: { role: "player", playerId: "plr_local" },
        selfPlayer: { id: "plr_local", seat: 0, name: "Local" },
        publicPlayers: [{ id: "plr_opponent", seat: 1, name: "Opponent" }]
      }
    }, "plr_local", "TFLWZ");

    const signal = atlasBattlefieldSeatSignalFromFrame(payload);
    expect(signal).toEqual({
      frameType: "room_shell_sync",
      gameInstanceId: "GAME-TFLWZ",
      roomCode: "TFLWZ",
      localSeat: 0
    });
    expect(signal).not.toHaveProperty("localPlayerId");
    expect(validatedAtlasBattlefieldSeatSignal(signal)).toEqual(signal);
  });

  it("rejects malformed battlefield seat bridge messages", () => {
    expect(validatedAtlasBattlefieldSeatSignal({
      frameType: "room_shell_sync",
      gameInstanceId: "GAME-1",
      roomCode: "ROOM1",
      localSeat: 2
    })).toBeNull();
    expect(validatedAtlasBattlefieldSeatSignal({
      frameType: "authoritative_patch_commit",
      gameInstanceId: "GAME-1",
      roomCode: "ROOM1",
      localSeat: 0
    })).toBeNull();
    expect(validatedAtlasBattlefieldSeatSignal({
      frameType: "authoritative_snapshot",
      gameInstanceId: "GAME-1",
      roomCode: "",
      localSeat: 1
    })).toBeNull();
  });

  it("reads a nested authoritative snapshot and normalizes a string seat", () => {
    const payload = playerSeatFrame({
      type: "authoritative_snapshot",
      gameInstanceId: "GAME-2",
      payload: {
        snapshot: {
          players: [
            { id: "plr_local", seat: "1" },
            { id: "plr_opponent", seat: "0" }
          ]
        }
      }
    });

    expect(parseAtlasPlayerSeatFrame(payload)).toMatchObject({
      frameType: "authoritative_snapshot",
      gameInstanceId: "GAME-2",
      localPlayerId: "plr_local",
      localSeat: 1
    });
  });

  it("fails closed for outbound, unidentified, missing, invalid, or conflicting seat evidence", () => {
    const valid = playerSeatFrame({
      type: "authoritative_snapshot",
      snapshot: { players: [{ id: "plr_local", seat: 0 }] }
    });
    const outbound = structuredClone(valid);
    outbound.frame.dir = "out";
    const unidentified = structuredClone(valid);
    unidentified.requestUrl = "wss://realtime.riftatlas-workers.com/parties/match/ROOM1";
    const missing = playerSeatFrame({
      type: "authoritative_snapshot",
      snapshot: { players: [{ id: "plr_opponent", seat: 1 }] }
    });
    const invalid = playerSeatFrame({
      type: "authoritative_snapshot",
      snapshot: { players: [{ id: "plr_local", seat: 2 }] }
    });
    const conflicting = playerSeatFrame({
      type: "authoritative_snapshot",
      players: [{ id: "plr_local", seat: 0 }],
      snapshot: { players: [{ id: "plr_local", seat: 1 }] }
    });
    const mismatchedViewer = playerSeatFrame({
      type: "room_shell_sync",
      sessionDoc: {
        viewer: { playerId: "plr_someone_else" },
        selfPlayer: { id: "plr_local", seat: 0 }
      }
    });
    const mismatchedSelf = playerSeatFrame({
      type: "room_shell_sync",
      sessionDoc: {
        viewer: { playerId: "plr_local" },
        selfPlayer: { id: "plr_someone_else", seat: 0 },
        publicPlayers: [{ id: "plr_local", seat: 1 }]
      }
    });

    expect(parseAtlasPlayerSeatFrame(outbound)).toBeNull();
    expect(parseAtlasPlayerSeatFrame(unidentified)).toBeNull();
    expect(parseAtlasPlayerSeatFrame(missing)).toBeNull();
    expect(parseAtlasPlayerSeatFrame(invalid)).toBeNull();
    expect(parseAtlasPlayerSeatFrame(conflicting)).toBeNull();
    expect(parseAtlasPlayerSeatFrame(mismatchedViewer)).toBeNull();
    expect(parseAtlasPlayerSeatFrame(mismatchedSelf)).toBeNull();
  });

  it("maps an authoritative local first-player choice to Went 1st", () => {
    expect(parseAtlasSeatFrame(frame("plr_local"))).toEqual({
      gameInstanceId: "GAME1",
      roomCode: "ROOM1",
      localPlayerId: "plr_local",
      firstPlayerId: "plr_local",
      wentFirst: "1st"
    });
  });

  it("maps an authoritative opponent first-player choice to Went 2nd", () => {
    const event = atlasSeatCaptureEvent(frame("plr_opponent", "plr_local", "GAME2", "ROOM2"));
    expect(event).toMatchObject({
      id: "atlas-seat:GAME2:2nd",
      platform: "atlas",
      kind: "match-update",
      capturedAt: "2026-07-12T15:00:00.000Z",
      url: "https://play.riftatlas.com/game/ROOM2",
      payload: {
        active: true,
        reason: "atlas-websocket-seat",
        roomCode: "ROOM2",
        atlasGameInstanceId: "GAME2",
        wentFirst: "2nd"
      }
    });
  });

  it("ignores uncommitted client intents", () => {
    const payload = frame("plr_local");
    payload.frame.dir = "out";
    payload.frame.raw = JSON.stringify({
      type: "action_intent",
      gameInstanceId: "GAME1",
      action: { type: "choose_first_player", firstPlayerId: "plr_local" },
      actorPlayerId: "plr_local"
    });
    expect(parseAtlasSeatFrame(payload)).toBeNull();
  });

  it("fails closed when the socket does not identify the local player", () => {
    const payload = frame("plr_local");
    payload.requestUrl = "wss://realtime.riftatlas-workers.com/parties/match/ROOM1";
    expect(parseAtlasSeatFrame(payload)).toBeNull();
  });
});
