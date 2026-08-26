import { describe, expect, it } from "vitest";
import {
  AtlasAuthoritativeMatchTracker,
  atlasAuthoritativeMatchSignalFromState,
  parseAtlasAuthoritativeMatchFrame,
  validatedAtlasAuthoritativeMatchSignal
} from "../src/shared/atlasAuthoritativeMatch";
import type { RawCaptureAppendFramePayload } from "../src/shared/types";

function frame(
  raw: Record<string, unknown>,
  options: { roomCode?: string; localPlayerId?: string; dir?: "in" | "out"; seq?: number } = {}
): RawCaptureAppendFramePayload {
  const roomCode = options.roomCode ?? "H8YTM";
  const localPlayerId = options.localPlayerId ?? "plr_9937f738";
  return {
    platform: "atlas",
    requestUrl: `wss://realtime.riftatlas-workers.com/parties/match/${roomCode}?playerId=${localPlayerId}&roomCode=${roomCode}`,
    frame: {
      seq: options.seq ?? 3,
      ts: Date.parse("2026-08-26T11:17:03.280Z"),
      dir: options.dir ?? "in",
      socketId: "ws-current",
      raw: JSON.stringify(raw)
    }
  };
}

function currentRoomShell(roomCode = "H8YTM", opponentId = "plr_e4d99dca", opponentName = "Omurice") {
  return frame({
    type: "room_shell_sync",
    gameInstanceId: roomCode,
    sessionDoc: {
      roomCode,
      matchFormat: "bo1",
      phase: "battlefield_pick",
      viewer: { role: "player", playerId: "plr_9937f738" },
      selfPlayer: { id: "plr_9937f738", seat: 1, name: "BMU" },
      publicPlayers: [{ id: opponentId, seat: 0, name: opponentName }]
    }
  }, { roomCode });
}

function currentSnapshot(localScore = 0, opponentScore = 0) {
  return frame({
    type: "authoritative_snapshot",
    gameInstanceId: "H8YTM",
    snapshot: {
      roomCode: "H8YTM",
      phase: "in_game",
      players: [
        { id: "plr_e4d99dca", seat: 0, name: "Omurice", board: { score: opponentScore } },
        { id: "plr_9937f738", seat: 1, name: "BMU", board: { score: localScore } }
      ]
    }
  });
}

function scorePatch(playerId: string, score: number, seq: number) {
  return frame({
    type: "authoritative_patch_commit",
    gameInstanceId: "H8YTM",
    sequence: seq,
    action: { type: "battlefield_conquer_confirm" },
    patch: {
      operations: [
        { op: "set_room_fields", fields: { victoryScore: 8 } },
        { op: "set_board_fields", playerId, fields: { score, energy: 0 } }
      ]
    }
  }, { seq });
}

describe("Atlas authoritative match tracking", () => {
  it("reads the current room shell without relying on DOM player labels", () => {
    expect(parseAtlasAuthoritativeMatchFrame(currentRoomShell())).toEqual({
      frameType: "room_shell_sync",
      roomCode: "H8YTM",
      gameInstanceId: "H8YTM",
      localPlayerId: "plr_9937f738",
      opponentPlayerId: "plr_e4d99dca",
      myName: "BMU",
      opponentName: "Omurice",
      format: "Bo1"
    });
  });

  it("maps shuffled snapshot scores and subsequent patches by player ID", () => {
    const tracker = new AtlasAuthoritativeMatchTracker();
    tracker.observeFrame(currentRoomShell());
    tracker.observeFrame(currentSnapshot());
    tracker.observeFrame(scorePatch("plr_9937f738", 7, 185));
    tracker.observeFrame(scorePatch("plr_e4d99dca", 4, 186));
    const final = tracker.observeFrame(scorePatch("plr_9937f738", 8, 231));

    expect(final).toMatchObject({
      roomCode: "H8YTM",
      myName: "BMU",
      opponentName: "Omurice",
      format: "Bo1",
      score: { me: "8", opp: "4" }
    });
  });

  it("preserves identity and the other score through partial authoritative patches", () => {
    const tracker = new AtlasAuthoritativeMatchTracker();
    tracker.observeFrame(currentRoomShell());
    tracker.observeFrame(currentSnapshot(2, 1));

    expect(tracker.observeFrame(scorePatch("plr_e4d99dca", 2, 42))).toMatchObject({
      myName: "BMU",
      opponentName: "Omurice",
      score: { me: "2", opp: "2" }
    });
  });

  it("replaces cached state when a validated new room opens", () => {
    const tracker = new AtlasAuthoritativeMatchTracker();
    tracker.observeFrame(currentRoomShell());
    tracker.observeFrame(currentSnapshot(8, 4));

    const next = tracker.observeFrame(currentRoomShell("NEW42", "plr_new_opp", "Nova"));
    expect(next).toMatchObject({
      roomCode: "NEW42",
      gameInstanceId: "NEW42",
      opponentPlayerId: "plr_new_opp",
      opponentName: "Nova",
      score: { me: "", opp: "" }
    });
  });

  it("rejects outbound, spectator, mismatched, anonymous, and unbound score evidence", () => {
    const outbound = currentRoomShell();
    outbound.frame.dir = "out";
    const spectator = currentRoomShell();
    spectator.frame.raw = JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: {
        roomCode: "H8YTM",
        viewer: { role: "spectator", playerId: "plr_9937f738" },
        selfPlayer: { id: "plr_9937f738", name: "BMU" },
        publicPlayers: [{ id: "plr_e4d99dca", name: "Omurice" }]
      }
    });
    const wrongRoom = currentRoomShell();
    wrongRoom.frame.raw = JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: {
        roomCode: "WRONG",
        selfPlayer: { id: "plr_9937f738", name: "BMU" },
        publicPlayers: [{ id: "plr_e4d99dca", name: "Omurice" }]
      }
    });
    const anonymousScore = frame({
      type: "authoritative_snapshot",
      snapshot: { roomCode: "H8YTM", scores: [8, 4] }
    });

    expect(parseAtlasAuthoritativeMatchFrame(outbound)).toBeNull();
    expect(parseAtlasAuthoritativeMatchFrame(spectator)).toBeNull();
    expect(parseAtlasAuthoritativeMatchFrame(wrongRoom)).toBeNull();
    expect(parseAtlasAuthoritativeMatchFrame(anonymousScore)).toBeNull();
    expect(parseAtlasAuthoritativeMatchFrame(scorePatch("plr_9937f738", 8, 231))).toBeNull();
  });

  it("creates and validates a bounded IPC signal without raw player IDs", () => {
    const tracker = new AtlasAuthoritativeMatchTracker();
    tracker.observeFrame(currentRoomShell());
    tracker.observeFrame(currentSnapshot(8, 4));
    const state = tracker.getState();
    expect(state).not.toBeNull();
    const signal = atlasAuthoritativeMatchSignalFromState(state!);

    expect(signal).toEqual({
      frameType: "authoritative_snapshot",
      roomCode: "H8YTM",
      gameInstanceId: "H8YTM",
      myName: "BMU",
      opponentName: "Omurice",
      format: "Bo1",
      score: { me: "8", opp: "4" }
    });
    expect(signal).not.toHaveProperty("localPlayerId");
    expect(signal).not.toHaveProperty("opponentPlayerId");
    expect(validatedAtlasAuthoritativeMatchSignal(signal)).toEqual(signal);
    expect(validatedAtlasAuthoritativeMatchSignal({ ...signal, opponentName: "x".repeat(121) })).toBeNull();
    expect(validatedAtlasAuthoritativeMatchSignal({ ...signal, score: { me: "victoryScore:8", opp: "4" } })).toBeNull();
  });
});
