import { describe, expect, it } from "vitest";

import {
  atlasLobbyBootstrapRecovery,
  type AtlasReadableStorage
} from "../src/shared/atlasLobbyBootstrapRecovery.js";

class MemoryStorage implements AtlasReadableStorage {
  readonly values = new Map<string, string>();

  constructor(entries: Record<string, string>) {
    for (const [key, value] of Object.entries(entries)) {
      this.values.set(key, value);
    }
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
}

describe("Atlas lobby bootstrap recovery", () => {
  it("asks Atlas to demote a live session room into its safe lobby recovery state", () => {
    const localStorage = new MemoryStorage({
      riftbound_simulator_last_room: "safe-resume-record",
      riftbound_simulator_active_constructed_deck: "saved-deck",
      __clerk_environment: "signed-in-environment"
    });
    const sessionStorage = new MemoryStorage({
      riftbound_simulator_active_room: "active-room-v2",
      riftbound_pending_room_access_intent_v1: "pending-room-action",
      riftbound_saved_deck_pending_intent: "pending-deck-action"
    });

    expect(atlasLobbyBootstrapRecovery(
      "https://play.riftatlas.com/?from=desktop",
      localStorage,
      sessionStorage
    )).toEqual({
      checked: true,
      recoveryUrl: "https://play.riftatlas.com/?from=desktop&recover=lobby",
      source: "session",
      storageReadFailed: false
    });

    expect(localStorage.values.get("riftbound_simulator_last_room")).toBe("safe-resume-record");
    expect(localStorage.values.get("riftbound_simulator_active_constructed_deck")).toBe("saved-deck");
    expect(localStorage.values.get("__clerk_environment")).toBe("signed-in-environment");
    expect(sessionStorage.values.get("riftbound_pending_room_access_intent_v1")).toBe("pending-room-action");
    expect(sessionStorage.values.get("riftbound_saved_deck_pending_intent")).toBe("pending-deck-action");
  });

  it("also hands legacy local room state to Atlas without deleting it itself", () => {
    const localStorage = new MemoryStorage({
      riftbound_simulator_active_room: "legacy-active-room",
      riftbound_simulator_session: "legacy-session"
    });

    expect(atlasLobbyBootstrapRecovery(
      "https://play.riftatlas.com/",
      localStorage,
      new MemoryStorage({})
    )).toEqual({
      checked: true,
      recoveryUrl: "https://play.riftatlas.com/?recover=lobby",
      source: "legacy-local",
      storageReadFailed: false
    });
    expect(localStorage.values.get("riftbound_simulator_active_room")).toBe("legacy-active-room");
    expect(localStorage.values.get("riftbound_simulator_session")).toBe("legacy-session");
  });

  it("leaves clean roots and intentional continuation state alone", () => {
    const result = atlasLobbyBootstrapRecovery(
      "https://play.riftatlas.com/",
      new MemoryStorage({ riftbound_simulator_last_room: "resume" }),
      new MemoryStorage({
        riftbound_matchmaking_search_continuation_v1: "search",
        riftbound_pending_room_access_intent_v1: "room",
        riftbound_saved_deck_pending_intent: "deck"
      })
    );

    expect(result).toEqual({
      checked: true,
      recoveryUrl: "",
      source: "",
      storageReadFailed: false
    });
  });

  it("does not interfere with game, sign-in, hostile, or already-recovering URLs", () => {
    const storage = new MemoryStorage({ riftbound_simulator_active_room: "active" });
    expect(atlasLobbyBootstrapRecovery(
      "https://play.riftatlas.com/game/ROOM1",
      storage,
      storage
    ).checked).toBe(false);
    expect(atlasLobbyBootstrapRecovery(
      "https://play.riftatlas.com/sign-in",
      storage,
      storage
    ).checked).toBe(false);
    expect(atlasLobbyBootstrapRecovery(
      "https://play.riftatlas.com.evil.example/",
      storage,
      storage
    ).checked).toBe(false);
    expect(atlasLobbyBootstrapRecovery(
      "https://play.riftatlas.com/?recover=lobby",
      storage,
      storage
    )).toEqual({
      checked: true,
      recoveryUrl: "",
      source: "",
      storageReadFailed: false
    });
  });

  it("fails safely when one storage surface cannot be read", () => {
    const blockedStorage: AtlasReadableStorage = {
      getItem: () => {
        throw new Error("blocked");
      }
    };
    expect(atlasLobbyBootstrapRecovery(
      "https://play.riftatlas.com/",
      new MemoryStorage({}),
      blockedStorage
    )).toEqual({
      checked: true,
      recoveryUrl: "",
      source: "",
      storageReadFailed: true
    });
  });
});
