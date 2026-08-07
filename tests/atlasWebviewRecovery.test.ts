import { describe, expect, it, vi } from "vitest";

import {
  atlasExplicitRepairUrl,
  clearAtlasWebviewRuntime,
  clearAtlasWebviewSiteData,
  initialAtlasReloadStormState,
  shouldAutoRepairAtlasEmptyShell,
  shouldEscalateAtlasEmptyShell,
  updateAtlasReloadStormState,
  validAtlasWebviewRecoveryMode
} from "../src/shared/atlasWebviewRecovery.js";

describe("Atlas embedded-browser recovery", () => {
  it("uses a unique root-page URL for an explicit repair remount", () => {
    expect(atlasExplicitRepairUrl(1_785_600_000_123)).toBe(
      "https://play.riftatlas.com/?riftlite_repair=1785600000123"
    );
    expect(atlasExplicitRepairUrl(Number.NaN)).toBe("https://play.riftatlas.com/?riftlite_repair=0");
    expect(atlasExplicitRepairUrl(1_785_600_000_123, "sign-in")).toBe(
      "https://play.riftatlas.com/sign-in?redirect_url=%2F&riftlite_repair=1785600000123"
    );
    expect(atlasExplicitRepairUrl(1_785_600_000_123, "site-data")).toBe(
      "https://play.riftatlas.com/sign-in?redirect_url=%2F&riftlite_repair=1785600000123"
    );
  });

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

  it("offers recovery when the Atlas shell loads without its application", () => {
    const state = updateAtlasReloadStormState(
      initialAtlasReloadStormState(),
      { kind: "debug", platform: "atlas", payload: { reason: "atlas-app-shell-empty" } },
      5
    );
    expect(state.suggested).toBe(true);
  });

  it("automatically repairs the first empty Atlas shell only once", () => {
    const emptyShell = { kind: "debug" as const, platform: "atlas" as const, payload: { reason: "atlas-app-shell-empty" } };
    expect(shouldAutoRepairAtlasEmptyShell(emptyShell, false)).toBe(true);
    expect(shouldAutoRepairAtlasEmptyShell(emptyShell, true)).toBe(false);
    expect(shouldAutoRepairAtlasEmptyShell(atlasEvent("capture-ready"), false)).toBe(false);
    expect(shouldEscalateAtlasEmptyShell(emptyShell, false)).toBe(false);
    expect(shouldEscalateAtlasEmptyShell(emptyShell, true)).toBe(true);
    expect(shouldEscalateAtlasEmptyShell(atlasEvent("capture-ready"), true)).toBe(false);
  });

  it("clears Atlas runtime caches without clearing sign-in or local deck data", async () => {
    const session = {
      clearCache: vi.fn(async () => undefined),
      clearCodeCaches: vi.fn(async () => undefined),
      closeAllConnections: vi.fn(async () => undefined),
      clearStorageData: vi.fn(async () => undefined),
      flushStorageData: vi.fn()
    };
    const result = await clearAtlasWebviewRuntime(session);
    expect(session.clearCodeCaches).toHaveBeenCalledWith({ urls: ["https://play.riftatlas.com"] });
    expect(session.clearCache).toHaveBeenCalledOnce();
    expect(session.clearStorageData).toHaveBeenCalledWith({
      origin: "https://play.riftatlas.com",
      storages: ["serviceworkers", "cachestorage"]
    });
    expect(session.closeAllConnections).toHaveBeenCalledOnce();
    expect(session.flushStorageData).toHaveBeenCalledOnce();
    expect(result).toEqual({
      completed: [
        "code-cache",
        "http-cache",
        "serviceworkers-and-cache-storage",
        "network-connections",
        "storage-flush"
      ],
      warnings: []
    });
  });

  it("continues through independent runtime cleanup stages and reports bounded warnings", async () => {
    const session = {
      clearCache: vi.fn(async () => undefined),
      clearCodeCaches: vi.fn(async () => { throw new Error("code cache locked"); }),
      closeAllConnections: vi.fn(async () => { throw new Error("connection close failed"); }),
      clearStorageData: vi.fn(async () => { throw new Error("storage busy"); }),
      flushStorageData: vi.fn(() => { throw new Error("flush failed"); })
    };

    const result = await clearAtlasWebviewRuntime(session);

    expect(session.clearCache).toHaveBeenCalledOnce();
    expect(session.clearStorageData).toHaveBeenCalledOnce();
    expect(session.closeAllConnections).toHaveBeenCalledOnce();
    expect(session.flushStorageData).toHaveBeenCalledOnce();
    expect(result.completed).toEqual(["http-cache"]);
    expect(result.warnings).toEqual([
      "code-cache: code cache locked",
      "serviceworkers-and-cache-storage: storage busy",
      "network-connections: connection close failed",
      "storage-flush: flush failed"
    ]);
  });

  it("times out a stuck runtime stage and still runs the remaining cleanup", async () => {
    vi.useFakeTimers();
    try {
      const session = {
        clearCache: vi.fn(() => new Promise<void>(() => undefined)),
        closeAllConnections: vi.fn(async () => undefined),
        clearStorageData: vi.fn(async () => undefined),
        flushStorageData: vi.fn()
      };

      const cleanup = clearAtlasWebviewRuntime(session, 25);
      await vi.advanceTimersByTimeAsync(25);
      const result = await cleanup;

      expect(result.completed).toEqual([
        "serviceworkers-and-cache-storage",
        "network-connections",
        "storage-flush"
      ]);
      expect(result.warnings).toEqual(["http-cache: Timed out after 25 ms."]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fully resets only the dedicated Atlas and authentication site storage", async () => {
    const session = {
      clearCache: vi.fn(async () => undefined),
      clearCodeCaches: vi.fn(async () => undefined),
      closeAllConnections: vi.fn(async () => undefined),
      clearStorageData: vi.fn(async () => undefined),
      flushStorageData: vi.fn()
    };

    const result = await clearAtlasWebviewSiteData(session);

    expect(session.clearStorageData).toHaveBeenNthCalledWith(1, {
      origin: "https://play.riftatlas.com",
      storages: ["serviceworkers", "cachestorage"]
    });
    expect(session.clearStorageData).toHaveBeenNthCalledWith(2, {
      origin: "https://play.riftatlas.com",
      storages: [
        "cookies",
        "filesystem",
        "indexdb",
        "localstorage",
        "serviceworkers",
        "cachestorage",
        "websql",
        "shadercache"
      ]
    });
    expect(session.clearStorageData).toHaveBeenNthCalledWith(3, {
      origin: "https://clerk.riftatlas.com",
      storages: ["cookies", "indexdb", "localstorage", "serviceworkers", "cachestorage"]
    });
    expect(session.clearStorageData).toHaveBeenNthCalledWith(4, {
      origin: "https://accounts.riftatlas.com",
      storages: ["cookies", "indexdb", "localstorage", "serviceworkers", "cachestorage"]
    });
    expect(session.closeAllConnections).toHaveBeenCalledTimes(2);
    expect(session.flushStorageData).toHaveBeenCalledTimes(2);
    expect(result.warnings).toEqual([]);
    expect(result.completed).toEqual(expect.arrayContaining([
      "atlas-site-data",
      "authentication-site-data:clerk.riftatlas.com",
      "authentication-site-data:accounts.riftatlas.com",
      "site-reset-network-connections",
      "site-reset-storage-flush"
    ]));
  });

  it("accepts only the three bounded recovery modes", () => {
    expect(validAtlasWebviewRecoveryMode("runtime")).toBe("runtime");
    expect(validAtlasWebviewRecoveryMode("sign-in")).toBe("sign-in");
    expect(validAtlasWebviewRecoveryMode("site-data")).toBe("site-data");
    expect(validAtlasWebviewRecoveryMode("all-data")).toBeNull();
    expect(validAtlasWebviewRecoveryMode(undefined)).toBeNull();
  });
});

function atlasEvent(kind: "capture-ready" | "match-snapshot" | "debug", payload: Record<string, unknown> = {}) {
  return { kind, platform: "atlas" as const, payload };
}
