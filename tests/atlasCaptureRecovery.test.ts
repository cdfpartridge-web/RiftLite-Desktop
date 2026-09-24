import { describe, expect, it } from "vitest";
import { isAtlasConnectionOrLobbyCapture } from "../src/shared/atlasCaptureRecovery";

function source(packets: unknown[]) {
  return {
    schema: "riftreplay-raw-capture", version: 1,
    capture: { lifecycle: { lastPhase: null, lastGameNumber: null, phases: [], games: [] } },
    messages: packets.map((packet) => ({ raw: JSON.stringify(packet) }))
  };
}

describe("Atlas recovery qualification", () => {
  it("recognizes handshakes regardless of traffic volume", () => {
    const packets = Array.from({ length: 500 }, () => [{ type: "auth" }, { type: "ready" }]).flat();
    expect(isAtlasConnectionOrLobbyCapture(source(packets))).toBe(true);
  });

  it("recognizes a first-game lobby with chat, presence and setup-log traffic", () => {
    expect(isAtlasConnectionOrLobbyCapture(source([
      { type: "join_shell" }, { type: "room_shell_sync", sessionDoc: { phase: "lobby", gameNumber: 1 } },
      { type: "setup_log_sync" }, { type: "chat_sync" }, { type: "presence_update" }, { type: "room_shell_leave" }
    ]))).toBe(true);
  });

  it.each(["authoritative_snapshot", "authoritative_patch_commit", "action_intent", "new_atlas_game_packet"])(
    "keeps even one %s packet recoverable", (type) => {
      expect(isAtlasConnectionOrLobbyCapture(source([{ type }]))).toBe(false);
    }
  );

  it.each(["mulligan", "battlefield_pick", "in_game", "sideboarding", "game_end", "unknown-phase"])(
    "keeps %s phase evidence", (phase) => {
      expect(isAtlasConnectionOrLobbyCapture(source([
        { type: "room_shell_sync", payload: { sessionDoc: { phase, gameNumber: 1 } } }
      ]))).toBe(false);
    }
  );

  it("preserves earlier lifecycle evidence even when the last packet is lobby traffic", () => {
    const payload = source([{ type: "ready" }]);
    const withPhases = { ...payload, capture: { lifecycle: { lastPhase: "lobby", phases: [{ phase: "in_game" }], games: [] } } };
    expect(isAtlasConnectionOrLobbyCapture(withPhases)).toBe(false);
    expect(isAtlasConnectionOrLobbyCapture({ ...payload, capture: { lifecycle: {
      phases: [], games: [{ gameNumber: 1, phases: [{ phase: "mulligan" }] }]
    } } })).toBe(false);
  });

  it("keeps later-game lobbies and shell packets without an explicit lobby phase", () => {
    expect(isAtlasConnectionOrLobbyCapture(source([{ type: "room_shell_sync", sessionDoc: { phase: "lobby", gameNumber: 2 } }]))).toBe(false);
    expect(isAtlasConnectionOrLobbyCapture(source([{ type: "room_shell_sync", sessionDoc: { gameNumber: 1 } }]))).toBe(false);
  });

  it("does not guess from empty, malformed or other-provider captures", () => {
    expect(isAtlasConnectionOrLobbyCapture(source([]))).toBe(false);
    expect(isAtlasConnectionOrLobbyCapture({ ...source([{ type: "ready" }]), schema: "riftlite-tcga-raw-capture" })).toBe(false);
    expect(isAtlasConnectionOrLobbyCapture({ ...source([]), messages: [{ raw: "{truncated", type: "auth" }] })).toBe(false);
    expect(isAtlasConnectionOrLobbyCapture({ ...source([{ type: "ready" }]), capture: {} })).toBe(false);
  });
});
