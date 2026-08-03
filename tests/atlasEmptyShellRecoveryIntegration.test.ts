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
  });

  it("routes bounded repair modes through progressively stronger cleanup before remounting", () => {
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

    expect(recovery).toContain('trigger === "automatic-empty-shell" ? "runtime" : trigger');
    expect(recovery).toContain('mode === "sign-in" || mode === "site-data"');
    expect(recovery).toContain("() => clearAtlasClerkAuthCookies(atlasSession)");
    expect(recovery).toContain('mode === "site-data"');
    expect(recovery).toContain("clearAtlasWebviewSiteData(atlasSession)");
    expect(recovery).toContain("clearAtlasWebviewRuntime(atlasSession)");
    expect(recovery).toContain('"atlas-local-decks"');
    expect(recovery).toContain('"riftlite-replays"');
    expect(rendererRepair).toContain('mode: AtlasWebviewRecoveryMode = "runtime"');
    expect(rendererRepair).toContain("window.riftlite.recoverAtlasWebview(mode)");
    expect(rendererRepair).toContain("setAtlasExplicitRepairToken(Date.now())");
    expect(rendererSource).toContain("atlasExplicitRepairUrl(atlasExplicitRepairToken)");
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
    expect(handler).toContain("atlasEmptyShellMainRecovery.resetAfterExplicitRepair()");
    expect(handler).toContain("refreshAtlasWebviewRuntime(mode)");
  });

  it("warns at eight seconds and waits eighteen seconds before automatic repair", () => {
    expect(gamePreloadSource).toContain(
      'window.setTimeout(() => reportAtlasShellStatusIfNeeded("stalled"), ATLAS_STALLED_SHELL_MIN_AGE_MS)'
    );
    expect(gamePreloadSource).toContain(
      'window.setTimeout(() => reportAtlasShellStatusIfNeeded("empty"), ATLAS_EMPTY_SHELL_MIN_AGE_MS)'
    );
    const mutationCheck = sourceBetween(
      gamePreloadSource,
      "function scheduleAtlasShellMutationCheck",
      "function checkAtlasShellAfterBecomingVisible"
    );
    expect(mutationCheck).toContain('reportAtlasShellStatusIfNeeded("observe")');
    expect(mutationCheck).not.toContain("atlasEmptyShellReported");
  });
});
