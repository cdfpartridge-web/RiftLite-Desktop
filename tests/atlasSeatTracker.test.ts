import { describe, expect, it } from "vitest";
import { atlasSeatCaptureEvent, parseAtlasSeatFrame } from "../src/shared/atlasSeatTracker";
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

describe("Atlas seat tracking", () => {
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
