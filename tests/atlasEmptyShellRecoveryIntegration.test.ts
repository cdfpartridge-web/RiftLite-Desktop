import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const rendererSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const gamePreloadSource = readFileSync(new URL("../src/game-preload/gamePreload.ts", import.meta.url), "utf8");

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Could not find source block between ${startMarker} and ${endMarker}.`);
  }
  return source.slice(start, end);
}

describe("Atlas empty-shell recovery integration", () => {
  it("counts visible Atlas play surfaces independently of translated button labels", () => {
    const shellStatus = sourceBetween(
      gamePreloadSource,
      "function reportAtlasShellStatusIfNeeded",
      "function isAtlasAuthSurface"
    );

    expect(shellStatus).toContain(".lobby-quick-match-actions button");
    expect(shellStatus).toContain(".lobby-private-play-actions button");
    expect(shellStatus).toContain(".lobby-room-code-actions button");
    expect(shellStatus).toContain("lobbyPlaySurfaceCount: lobbyPlaySurfaceElements.length");
    expect(shellStatus).toContain("lobbyPlaySurfaceCount: assessment.lobbyPlaySurfaceCount");
  });

  it("keeps the detected guest alive so the main-process repair is not cancelled", () => {
    const handler = sourceBetween(
      rendererSource,
      "function handleWebviewIpc",
      "async function primeReplayVideoTarget"
    );

    expect(handler).toContain('updateAtlasShellVisibility(current, "empty-shell-recovery-started")');
    expect(handler).not.toContain("setGameWebviewEpoch");
  });

  it("clears the disposable Atlas runtime before cache-busting the same guest", () => {
    const handler = sourceBetween(
      mainSource,
      "function handleAtlasShellStatusEvent",
      "async function createWindow"
    );
    const repairIndex = handler.indexOf('refreshAtlasWebviewRuntime("automatic-empty-shell")');
    const reloadIndex = handler.indexOf("await sender.loadURL(atlasExplicitRepairUrl(Date.now()))");

    expect(repairIndex).toBeGreaterThan(-1);
    expect(reloadIndex).toBeGreaterThan(repairIndex);
    expect(handler).toContain("atlasEmptyShellMainRecovery.canFinishCommittedReload(");
    expect(handler.indexOf("atlasEmptyShellMainRecovery.canFinishCommittedReload("))
      .toBeGreaterThan(repairIndex);
  });

  it("routes bounded repair modes through progressively stronger cleanup before remounting", () => {
    const quiesce = sourceBetween(
      mainSource,
      "async function quiesceAtlasWebviewGuestForRecovery",
      "function refreshAtlasWebviewRuntime"
    );
    const recovery = sourceBetween(
      mainSource,
      "function refreshAtlasWebviewRuntime",
      "function startRawCaptureUploadRetry"
    );
    const rendererRepair = sourceBetween(
      rendererSource,
      "async function recoverAtlasWebview",
      "function refreshGamePresentation"
    );

    expect(quiesce).toContain("guest.stop()");
    expect(quiesce).toContain("guest.close()");
    expect(quiesce).toContain('once(guest, "destroyed")');
    expect(recovery).toContain('trigger === "automatic-empty-shell" ? "runtime" : trigger');
    expect(recovery).toContain('trigger === "automatic-empty-shell"');
    expect(recovery).toContain("await quiesceAtlasWebviewGuestForRecovery()");
    expect(recovery.indexOf("await quiesceAtlasWebviewGuestForRecovery()"))
      .toBeLessThan(recovery.indexOf("electronSession.fromPartition(ATLAS_GAME_PARTITION)"));
    expect(recovery).toContain('mode === "sign-in" || mode === "site-data"');
    expect(recovery).toContain("() => clearAtlasClerkAuthCookies(atlasSession)");
    expect(recovery).toContain('mode === "site-data"');
    expect(recovery).toContain("clearAtlasWebviewSiteData(atlasSession)");
    expect(recovery).toContain("clearAtlasWebviewRuntime(atlasSession)");
    expect(recovery).toContain("Cookie operations are not cancellable");
    expect(recovery).not.toContain("return await Promise.race");
    expect(recovery).toContain('"atlas-local-decks"');
    expect(recovery).toContain('"riftlite-replays"');
    expect(rendererRepair).toContain('mode: AtlasWebviewRecoveryMode = "runtime"');
    expect(rendererRepair).toContain("window.riftlite.recoverAtlasWebview(mode)");
    expect(rendererRepair).toContain("setAtlasExplicitRepairMode(mode)");
    expect(rendererRepair).toContain("setAtlasExplicitRepairToken(Date.now())");
    expect(rendererSource).toContain("atlasExplicitRepairUrl(atlasExplicitRepairToken, atlasExplicitRepairMode)");
  });

  it("validates repair modes and keeps the active-capture safety gate in the main process", () => {
    const handler = sourceBetween(
      mainSource,
      'handleTrustedAppIpc("atlas-webview:recover"',
      'handleTrustedAppIpc("atlas-webview:diagnostics:get"'
    );

    expect(handler).toContain('requestedMode === undefined ? "runtime" : validAtlasWebviewRecoveryMode(requestedMode)');
    expect(handler).toContain('throw new Error("Atlas repair mode is invalid.")');
    expect(handler).toContain("capture.getGamePlatformSwitchStatus()");
    expect(handler).toContain("const result = await refreshAtlasWebviewRuntime(mode)");
    expect(handler).toContain("if (result.ok)");
    expect(handler).toContain("atlasEmptyShellMainRecovery.markExplicitRepairConsumed()");
    expect(handler.indexOf("atlasEmptyShellMainRecovery.markExplicitRepairConsumed()"))
      .toBeGreaterThan(handler.indexOf("await refreshAtlasWebviewRuntime(mode)"));
  });

  it("uses repair URLs once without reopening the automatic-repair budget on a platform switch", () => {
    const platformEffect = sourceBetween(
      rendererSource,
      'if (activePlatform === "atlas")',
      '}, [activePlatform]);'
    );

    expect(platformEffect).toContain('setAtlasExplicitRepairMode("runtime")');
    expect(platformEffect).toContain("setAtlasExplicitRepairToken(0)");
    expect(platformEffect).not.toContain("atlasEmptyShellAutoRepairRef.current = false");
  });

  it("warns at eight seconds, repairs at eighteen, and retries after match grace", () => {
    const deadlineChecks = sourceBetween(
      gamePreloadSource,
      "function scheduleAtlasShellDeadlineChecks",
      "function checkAtlasShellAfterBecomingVisible"
    );
    expect(deadlineChecks).toContain('reportAtlasShellStatusIfNeeded("stalled")');
    expect(deadlineChecks).toContain("ATLAS_STALLED_SHELL_MIN_AGE_MS");
    expect(deadlineChecks).toContain('reportAtlasShellStatusIfNeeded("empty")');
    expect(deadlineChecks).toContain("ATLAS_EMPTY_SHELL_MIN_AGE_MS");
    expect(deadlineChecks).toContain('reportAtlasShellStatusIfNeeded("persistent-empty")');
    expect(deadlineChecks).toContain("ATLAS_PERSISTENT_EMPTY_SHELL_MIN_AGE_MS");
    expect(deadlineChecks).toContain("ATLAS_PERSISTENT_EMPTY_SHELL_RETRY_AGE_MS");
    const mutationCheck = sourceBetween(
      gamePreloadSource,
      "function scheduleAtlasShellMutationCheck",
      "function clearAtlasShellDeadlineTimers"
    );
    expect(mutationCheck).toContain('reportAtlasShellStatusIfNeeded("observe")');
    expect(mutationCheck).not.toContain("atlasEmptyShellReported");
    const visibleCheck = sourceBetween(
      gamePreloadSource,
      "function checkAtlasShellAfterBecomingVisible",
      "function snapshot"
    );
    expect(visibleCheck).toContain("clearAtlasShellDeadlineTimers()");
    expect(visibleCheck).toContain("scheduleAtlasShellDeadlineChecks()");
    expect(visibleCheck).not.toContain("Date.now() - atlasShellChecksStartedAt");
  });

  it("keeps monitoring a previously healthy SPA shell and requires stable readiness", () => {
    const shellStatus = sourceBetween(
      gamePreloadSource,
      "function reportAtlasShellStatusIfNeeded",
      "function isAtlasAuthSurface"
    );
    const mutationCheck = sourceBetween(
      gamePreloadSource,
      "function scheduleAtlasShellMutationCheck",
      "function clearAtlasShellDeadlineTimers"
    );
    const routeMonitor = sourceBetween(
      gamePreloadSource,
      "function updateAtlasShellRecoveryRouteMonitoring",
      "function clearAtlasShellReadyCandidate"
    );
    const observerSetup = sourceBetween(
      gamePreloadSource,
      "function installDomObserver",
      "function installNetworkHooks"
    );

    expect(shellStatus).toContain('document.readyState === "loading"');
    expect(shellStatus).not.toContain('document.readyState !== "complete"');
    expect(shellStatus).toContain("ATLAS_SHELL_READY_STABILITY_MS");
    expect(shellStatus).toContain('reason: "atlas-app-shell-regressed"');
    expect(shellStatus).toContain("scheduleAtlasShellDeadlineChecks()");
    expect(mutationCheck).toContain("updateAtlasShellRecoveryRouteMonitoring()");
    expect(routeMonitor).toContain("atlasShellNeedsOngoingMonitoring()");
    expect(routeMonitor).toContain("atlasShellRecoveryRouteTransition(");
    expect(routeMonitor).toContain("atlasShellRecoveryRouteActive = transition.active");
    expect(routeMonitor).toContain("if (transition.shouldArmDeadlines)");
    expect(routeMonitor).toContain("scheduleAtlasShellDeadlineChecks()");
    expect(observerSetup).toContain("ATLAS_SHELL_MONITOR_INTERVAL_MS");
    expect(observerSetup).toContain("window.setInterval(scheduleAtlasShellMutationCheck");
  });

  it("ignores a queued shell-ready event from a replaced webview", () => {
    const binding = sourceBetween(
      rendererSource,
      "return bindGameWebviewEvents(webview, {",
      "}, [activePlatform, mountedGamePlatform, preloadUrl, gameWebviewEpoch, gameZoom]);"
    );

    expect(binding).toContain("if (gameRef.current === webview)");
    expect(binding).toContain("handleWebviewIpc(event)");
  });

  it("forces one renderer remount after a targeted Atlas sign-in reset", () => {
    const failureHandler = sourceBetween(
      rendererSource,
      "const offGameWebviewFailure",
      "return () => {"
    );

    expect(failureHandler).toContain('failure.reason === "authentication-reset"');
    expect(failureHandler).toContain("!forcedAtlasAuthRemount && gameGuestAutoRecoveryRef.current.has");
    expect(failureHandler).toContain("setGameWebviewEpoch((current) => current + 1)");
  });
});
