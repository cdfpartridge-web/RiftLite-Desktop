import { describe, expect, it, vi } from "vitest";

import {
  clearAtlasWebviewRuntime,
  initialAtlasReloadStormState,
  updateAtlasReloadStormState
} from "../src/shared/atlasWebviewRecovery.js";

describe("Atlas embedded-browser recovery", () => {
  it("offers recovery after four capture bridge initializations inside twenty seconds", () => {
    let state = initialAtlasReloadStormState();
    for (const at of [1_000, 4_000, 8_000, 12_000]) {
      state = updateAtlasReloadStormState(state, atlasEvent("capture-ready"), at);
    }
    expect(state.suggested).toBe(true);
    expect(state.captureReadyAt).toEqual([1_000, 4_000, 8_000, 12_000]);
  });

  it("does not flag ordinary reloads spread outside the detection window", () => {
    let state = initialAtlasReloadStormState();
    for (const at of [1_000, 12_000, 24_000, 36_000]) {
      state = updateAtlasReloadStormState(state, atlasEvent("capture-ready"), at);
    }
    expect(state.suggested).toBe(false);
    expect(state.captureReadyAt).toEqual([24_000, 36_000]);
  });

  it("clears the warning once Atlas reports a real match", () => {
    const state = updateAtlasReloadStormState(
      { captureReadyAt: [1, 2, 3, 4], suggested: true },
      atlasEvent("match-snapshot", { active: true }),
      5
    );
    expect(state).toEqual(initialAtlasReloadStormState());
  });

  it("clears only cache and service-worker storage for the Atlas origin", async () => {
    const session = {
      clearCache: vi.fn(async () => undefined),
      clearStorageData: vi.fn(async () => undefined),
      flushStorageData: vi.fn()
    };
    await clearAtlasWebviewRuntime(session);
    expect(session.clearCache).toHaveBeenCalledOnce();
    expect(session.clearStorageData).toHaveBeenCalledWith({
      origin: "https://play.riftatlas.com",
      storages: ["serviceworkers", "cachestorage"]
    });
    expect(session.flushStorageData).toHaveBeenCalledOnce();
  });
});

function atlasEvent(kind: "capture-ready" | "match-snapshot", payload: Record<string, unknown> = {}) {
  return { kind, platform: "atlas" as const, payload };
}
