import { describe, expect, it } from "vitest";

import { AtlasEmptyShellMainRecoveryGuard } from "../src/main/services/atlasEmptyShellMainRecovery.js";

const ATLAS_URL = "https://play.riftatlas.com/";

describe("Atlas empty-shell main recovery guard", () => {
  it("allows one recovery for the original guest navigation", () => {
    const guard = new AtlasEmptyShellMainRecoveryGuard();
    const navigationKey = guard.beginNavigation(41, ATLAS_URL);
    const decision = guard.considerEmptyShell(41, ATLAS_URL, false);

    expect(decision).toMatchObject({ action: "schedule-reload", navigationKey });
    if (decision.action !== "schedule-reload") throw new Error("expected a scheduled recovery");
    expect(guard.commitScheduledReload(decision.recoveryKey, 41, navigationKey)).toBe(true);
    expect(guard.considerEmptyShell(41, ATLAS_URL, false)).toMatchObject({
      action: "ignore",
      reason: "already-consumed"
    });
  });

  it("does not grant a second attempt when the renderer remounts a new guest", () => {
    const guard = new AtlasEmptyShellMainRecoveryGuard();
    guard.beginNavigation(41, ATLAS_URL);
    const first = guard.considerEmptyShell(41, ATLAS_URL, false);
    if (first.action !== "schedule-reload") throw new Error("expected a scheduled recovery");

    guard.forgetGuest(41);
    guard.beginNavigation(77, ATLAS_URL);
    expect(guard.considerEmptyShell(77, ATLAS_URL, false)).toMatchObject({
      action: "ignore",
      reason: "already-consumed"
    });
    expect(guard.commitScheduledReload(first.recoveryKey, 41, first.navigationKey)).toBe(false);
  });

  it("consumes a delayed attempt if its original navigation changed", () => {
    const guard = new AtlasEmptyShellMainRecoveryGuard();
    guard.beginNavigation(41, ATLAS_URL);
    const first = guard.considerEmptyShell(41, ATLAS_URL, false);
    if (first.action !== "schedule-reload") throw new Error("expected a scheduled recovery");

    guard.beginNavigation(41, `${ATLAS_URL}decks`);
    expect(guard.commitScheduledReload(first.recoveryKey, 41, first.navigationKey)).toBe(false);
    expect(guard.considerEmptyShell(41, ATLAS_URL, false)).toMatchObject({
      action: "ignore",
      reason: "already-consumed"
    });
  });

  it("does not consume the recovery budget while an Atlas match is active", () => {
    const guard = new AtlasEmptyShellMainRecoveryGuard();
    guard.beginNavigation(41, ATLAS_URL);
    expect(guard.considerEmptyShell(41, ATLAS_URL, true)).toMatchObject({
      action: "ignore",
      reason: "active-match"
    });
    expect(guard.considerEmptyShell(41, ATLAS_URL, false).action).toBe("schedule-reload");
  });

  it("resets only after shell-ready confirmation or explicit repair", () => {
    const guard = new AtlasEmptyShellMainRecoveryGuard();
    guard.beginNavigation(41, ATLAS_URL);
    const first = guard.considerEmptyShell(41, ATLAS_URL, false);
    if (first.action !== "schedule-reload") throw new Error("expected a scheduled recovery");
    guard.abandonScheduledReload(first.recoveryKey);

    guard.beginNavigation(41, `${ATLAS_URL}lobby`);
    expect(guard.considerEmptyShell(41, ATLAS_URL, false).action).toBe("ignore");
    guard.markAtlasShellReady();
    expect(guard.considerEmptyShell(41, ATLAS_URL, false).action).toBe("schedule-reload");

    const second = guard.considerEmptyShell(41, ATLAS_URL, false);
    expect(second.action).toBe("ignore");
    guard.resetAfterExplicitRepair();
    expect(guard.considerEmptyShell(41, ATLAS_URL, false).action).toBe("schedule-reload");
  });

  it("ignores non-Atlas guests", () => {
    const guard = new AtlasEmptyShellMainRecoveryGuard();
    guard.beginNavigation(12, "https://client.tcg-arena.fr/");
    expect(guard.considerEmptyShell(12, "https://client.tcg-arena.fr/", false)).toMatchObject({
      action: "ignore",
      reason: "not-atlas"
    });
  });
});
