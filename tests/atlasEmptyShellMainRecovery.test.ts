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

  it("cancels a scheduled recovery when the original shell becomes ready first", () => {
    const guard = new AtlasEmptyShellMainRecoveryGuard();
    guard.beginNavigation(41, ATLAS_URL);
    const first = guard.considerEmptyShell(41, ATLAS_URL, false);
    if (first.action !== "schedule-reload") throw new Error("expected a scheduled recovery");

    expect(guard.markAtlasShellReady(41, ATLAS_URL)).toBe(true);
    expect(guard.commitScheduledReload(first.recoveryKey, 41, first.navigationKey)).toBe(false);
    expect(guard.considerEmptyShell(41, ATLAS_URL, false).action).toBe("schedule-reload");
  });

  it("ignores stale ready events until the automatic repair navigation becomes ready", () => {
    const guard = new AtlasEmptyShellMainRecoveryGuard();
    const navigationKey = guard.beginNavigation(41, ATLAS_URL);
    const first = guard.considerEmptyShell(41, ATLAS_URL, false);
    if (first.action !== "schedule-reload") throw new Error("expected a scheduled recovery");
    expect(guard.commitScheduledReload(first.recoveryKey, 41, navigationKey)).toBe(true);

    expect(guard.markAtlasShellReady(41, ATLAS_URL)).toBe(false);
    const repairUrl = `${ATLAS_URL}?riftlite_repair=123`;
    guard.beginNavigation(41, repairUrl);
    expect(guard.isCurrentNavigation(41, ATLAS_URL)).toBe(false);
    expect(guard.markAtlasShellReady(41, ATLAS_URL)).toBe(false);
    expect(guard.isCurrentNavigation(41, repairUrl)).toBe(true);
    expect(guard.markAtlasShellReady(41, repairUrl)).toBe(true);
    expect(guard.considerEmptyShell(41, ATLAS_URL, false).action).toBe("schedule-reload");
  });

  it("keeps an explicit repair consumed until its repair navigation reports ready", () => {
    const guard = new AtlasEmptyShellMainRecoveryGuard();
    guard.beginNavigation(41, ATLAS_URL);

    guard.markExplicitRepairConsumed();
    expect(guard.considerEmptyShell(41, ATLAS_URL, false)).toMatchObject({
      action: "ignore",
      reason: "already-consumed"
    });
    expect(guard.markAtlasShellReady(41, ATLAS_URL)).toBe(false);

    const repairUrl = `${ATLAS_URL}sign-in?redirect_url=%2F&riftlite_repair=456`;
    guard.beginNavigation(77, repairUrl);
    expect(guard.markAtlasShellReady(77, repairUrl)).toBe(true);
    expect(guard.considerEmptyShell(41, ATLAS_URL, false).action).toBe("schedule-reload");
  });

  it("can clear a consumed repair after its bound guest is replaced", () => {
    const guard = new AtlasEmptyShellMainRecoveryGuard();
    guard.markExplicitRepairConsumed();
    const repairUrl = `${ATLAS_URL}?riftlite_repair=789`;
    guard.beginNavigation(41, repairUrl);
    guard.forgetGuest(41);

    guard.beginNavigation(77, ATLAS_URL);
    expect(guard.markAtlasShellReady(77, ATLAS_URL)).toBe(true);
    expect(guard.considerEmptyShell(77, ATLAS_URL, false).action).toBe("schedule-reload");
  });

  it("follows an in-page redirect from the repair URL before accepting ready", () => {
    const guard = new AtlasEmptyShellMainRecoveryGuard();
    guard.markExplicitRepairConsumed();
    guard.beginNavigation(41, `${ATLAS_URL}sign-in?riftlite_repair=999`);
    guard.beginNavigation(41, ATLAS_URL);

    expect(guard.isCurrentNavigation(41, ATLAS_URL)).toBe(true);
    expect(guard.markAtlasShellReady(41, ATLAS_URL)).toBe(true);
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
