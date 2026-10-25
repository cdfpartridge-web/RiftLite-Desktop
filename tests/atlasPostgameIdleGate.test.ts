import { describe, expect, it } from "vitest";
import { AtlasPostgameIdleGate } from "../src/main/services/atlasPostgameIdleGate.js";
import { AtlasAutomaticRecoverySafetyFence } from "../src/main/services/atlasAutomaticRecoverySafetyFence.js";

describe("automatic Atlas post-game idle gate", () => {
  const idle = { trusted: true, loading: false, capturing: false, platformSwitchAllowed: true, url: "https://play.riftatlas.com/" };
  it("waits through startup and each new matchmaking/room activity", () => {
    let now = 0; const gate = new AtlasPostgameIdleGate(() => now);
    expect(gate.allows(idle)).toBe(false); now = 15_000; expect(gate.allows(idle)).toBe(true);
    gate.observeActivity(); expect(gate.allows(idle)).toBe(false); now += 15_000; expect(gate.allows(idle)).toBe(true);
  });
  it("never treats a quiet active game or another provider's match as idle", () => {
    const gate = new AtlasPostgameIdleGate(() => 100_000, 0);
    expect(gate.allows({ ...idle, capturing: true })).toBe(false);
    expect(gate.allows({ ...idle, platformSwitchAllowed: false })).toBe(false);
    expect(gate.allows({ ...idle, loading: true })).toBe(false);
    expect(gate.allows({ ...idle, trusted: false })).toBe(false);
  });
  it("allows completed game and lobby pages, but not unrelated or untrusted routes", () => {
    const gate = new AtlasPostgameIdleGate(() => 100_000, 0);
    for (const path of ["/game", "/fr/game", "/lobby", "/en/"]) expect(gate.allows({ ...idle, url: `https://play.riftatlas.com${path}` })).toBe(true);
    for (const url of ["https://evil.test/game", "https://play.riftatlas.com.evil.test/", "https://play.riftatlas.com/auth", "https://play.riftatlas.com/decks", "http://play.riftatlas.com/", "garbage"]) expect(gate.allows({ ...idle, url })).toBe(false);
  });

  it("does not let post-completion housekeeping starve collection or cancel its query", () => {
    let now = 0;
    const gate = new AtlasPostgameIdleGate(() => now);
    const legacyGate = new AtlasPostgameIdleGate(() => now);
    const recovery = new AtlasAutomaticRecoverySafetyFence(undefined, () => now);
    const roomUrl = "wss://realtime.riftatlas-workers.com/parties/match/TEST1?playerId=fixture";
    let started = false;
    let cancellations = 0;
    let legacyOpportunities = 0;
    const types = ["pong", "presence_event", "ping", "auth_refresh", "auth_session", "chat_append"];
    for (now = 5_000; now <= 300_000; now += 5_000) {
      const frame = JSON.stringify({ type: types[(now / 5_000 - 1) % types.length], gameInstanceId: "completed-fixture" });
      // This is the production recovery-fence -> postgame-gate call chain.
      expect(recovery.observeRealtimeFrame(4, roomUrl, frame)).toBe(true);
      legacyGate.observeActivity();
      if (gate.observeRealtimeActivity(frame) && started) cancellations += 1;
      if (now % 15_000 === 0) {
        if (legacyGate.allows(idle)) legacyOpportunities += 1;
        if (gate.allows(idle)) started = true;
      }
    }
    expect(legacyOpportunities).toBe(0);
    expect(started).toBe(true);
    expect(cancellations).toBe(0);
    // Removing postgame starvation must not relax the automatic-reload fence.
    expect(recovery.isProtected(4, idle.url)).toBe(true);
    expect(gate.allows({ ...idle, capturing: true })).toBe(false);
    expect(gate.allows({ ...idle, platformSwitchAllowed: false })).toBe(false);
  });

  it("immediately resets and cancels for new matchmaking, setup and authoritative game traffic", () => {
    let now = 30_000;
    const gate = new AtlasPostgameIdleGate(() => now);
    now += 15_000;
    const frames: unknown[] = [
      { type: "start" }, { envelope: { type: "searching" } }, { type: "join" },
      { type: "room_shell_action", action: { type: "start_game" } },
      { type: "room_shell_sync", sessionDoc: { phase: "lobby" } },
      { type: "authoritative_snapshot", snapshot: { phase: "in_game" } },
      // An authoritative terminal snapshot is still state activity, not a
      // heartbeat. Only a subsequently quiet, cleared capture may collect.
      { type: "authoritative_snapshot", snapshot: { phase: "in_game", gameOutcome: { kind: "concession" } } },
      { type: "authoritative_patch_commit", patch: { operations: [] } },
      { type: "gameplay_action" }, { type: "authoritative_resume_ack" },
      { type: "future_protocol_type" }, { payload: { type: "pong" } },
      [{ type: "pong" }, { type: "start" }],
      { type: "pong", action: { type: "start" } }, "{broken", null
    ];
    for (const frame of frames) {
      expect(gate.allows(idle)).toBe(true);
      expect(gate.observeRealtimeActivity(typeof frame === "object" ? JSON.stringify(frame) : frame)).toBe(true);
      expect(gate.allows(idle)).toBe(false);
      now += 15_000;
    }
  });

  it("recognizes only bounded exact housekeeping packets without parsing large gameplay payloads", () => {
    let now = 0;
    const gate = new AtlasPostgameIdleGate(() => now);
    now = 15_000;
    for (const type of ["ping", "pong", "auth_refresh", "auth_session", "presence_update", "presence_event", "chat_send", "chat_sync", "chat_append"]) {
      expect(gate.observeRealtimeActivity({ type })).toBe(false);
      expect(gate.observeRealtimeActivity(JSON.stringify({ gameInstanceId: "fixture", type }))).toBe(false);
      expect(gate.allows(idle)).toBe(true);
    }
    expect(gate.observeRealtimeActivity(JSON.stringify({ type: "presence_event", text: "x".repeat(8_192) }))).toBe(true);
    expect(gate.allows(idle)).toBe(false);
  });

  it("allows only an exact native replay route with a valid completed-game key shape", () => {
    const gate = new AtlasPostgameIdleGate(() => 100_000, 0);
    const key = "TEST1:1792870393904:1:1792870420892";
    for (const prefix of ["", "/en", "/fr", "/zh-CN", "/ko"]) {
      expect(gate.allows({ ...idle, url: `https://play.riftatlas.com${prefix}/replays/${encodeURIComponent(key)}` })).toBe(true);
    }
    for (const path of [
      "/replays", "/replays/", `/replays/${encodeURIComponent(key)}/`,
      `/replays/${encodeURIComponent(key)}/child`, `/replays/${encodeURIComponent(`${key}/child`)}`,
      `/replays/${encodeURIComponent(encodeURIComponent(key))}`, "/replays/shared-token",
      "/replays/TEST1:1792870393904:4:1792870420892", "/replays/TEST1:1792870393904:1:1792870393903",
      "/replays/TEST1:1000000000000:1:1792870420892", "/replays/TEST1:1792870393904:1:4000000000000",
      "/replays/TEST1:1792870393904:1:1792870420892%ZZ"
    ]) expect(gate.allows({ ...idle, url: `https://play.riftatlas.com${path}` }), path).toBe(false);
    for (const origin of ["http://play.riftatlas.com", "https://play.riftatlas.com.evil.test", "https://user@play.riftatlas.com", "https://play.riftatlas.com:8443"]) {
      expect(gate.allows({ ...idle, url: `${origin}/replays/${encodeURIComponent(key)}` })).toBe(false);
    }
    expect(gate.allows({ ...idle, url: `https://play.riftatlas.com/replays/${encodeURIComponent(key)}`, capturing: true })).toBe(false);
  });
});
