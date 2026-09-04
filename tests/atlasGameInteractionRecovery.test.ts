import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const preloadSource = readFileSync(new URL("../src/game-preload/gamePreload.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const rendererSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Could not find source block between ${startMarker} and ${endMarker}.`);
  }
  return source.slice(start, end);
}

describe("Atlas game interaction recovery", () => {
  it("requests native focus only for trusted editable or interactive user events", () => {
    const bridge = sourceBetween(
      preloadSource,
      "function installAtlasEditableFocusBridge",
      "let previousActive"
    );

    expect(bridge).toContain('platform !== "atlas"');
    expect(bridge).toContain("if (!event.isTrusted)");
    expect(bridge).toContain("isEditableElement(event.target)");
    expect(bridge).toContain("isAtlasInteractiveControl(event.target)");
    expect(bridge).toContain("GAME_WEBVIEW_EDITABLE_FOCUS_IPC_CHANNEL");
    expect(bridge).toContain('window.addEventListener("pointerdown"');
    expect(bridge).toContain('window.addEventListener("focusin"');
    expect(bridge).toContain('window.addEventListener("keydown"');
  });

  it("sends rate-limited pointer, focus, and keyboard acknowledgements without input content", () => {
    const bridge = sourceBetween(
      preloadSource,
      "function installAtlasEditableFocusBridge",
      "let previousActive"
    );

    expect(bridge).toContain("lastDiagnosticByPhase");
    expect(bridge).toContain("previous.signature === signature");
    expect(bridge).toContain("observedAt - previous.reportedAt < 30_000");
    expect(bridge).toContain('"pointer-received"');
    expect(bridge).toContain('"focus-received"');
    expect(bridge).toContain('"keyboard-received"');
    expect(bridge).toContain("GAME_WEBVIEW_INTERACTION_DIAGNOSTIC_IPC_CHANNEL");
    expect(bridge).toContain("documentFocused: document.hasFocus()");
    expect(bridge).toContain('documentVisible: document.visibilityState === "visible"');
    expect(bridge).toContain("activeControl: isAtlasInteractiveControl(document.activeElement)");
    expect(bridge).not.toContain('send("debug"');
    expect(bridge).not.toMatch(/\.(?:value|textContent|innerText|outerHTML)\b/);
    expect(bridge).not.toContain("event.key");
    expect(bridge).not.toContain("getAttribute(");
  });

  it("revalidates the current trusted guest before every focus and repaint attempt", () => {
    const currentGuestGuard = sourceBetween(
      mainSource,
      "function isCurrentTrustedGameWebContents",
      "function trustedGameIpcPlatform"
    );
    const focusGuard = sourceBetween(
      mainSource,
      "function focusCurrentTrustedGameGuest",
      "function assertTrustedAppIpcSender"
    );

    expect(currentGuestGuard).toContain("contents.isDestroyed()");
    expect(currentGuestGuard).toContain("GAME_WEBVIEW_PARTITIONS[platform]");
    expect(currentGuestGuard).toContain("gameWebContentsByPlatform.get(platform)?.id === contents.id");
    expect(currentGuestGuard).toContain('policy?.kind === "game"');
    expect(currentGuestGuard).toContain("policy.platform === platform");
    expect(currentGuestGuard).toContain("isAllowedEmbeddedNavigation(policy, contents.getURL())");
    expect(focusGuard).toContain("!window.isFocused()");
    expect(focusGuard).toContain("!isCurrentTrustedGameWebContents(platform, contents)");
    expect(focusGuard).toContain("shouldInvalidateGameGuestPresentation(platform, options.invalidatePresentation)");
    expect(focusGuard).toContain("ATLAS_PRESENTATION_INVALIDATE_MIN_INTERVAL_MS");
    expect(focusGuard).toContain("window.webContents.invalidate()");
    expect(focusGuard).toContain("contents.invalidate()");
    expect(focusGuard).toContain("contents.focus()");
  });

  it("makes delayed renderer and guest focus retries use the same safety guard", () => {
    const rendererFocusHandler = sourceBetween(
      mainSource,
      'handleTrustedAppIpc("game-webview:focus"',
      'handleTrustedAppIpc("atlas-webview:recover"'
    );
    const guestFocusHandler = sourceBetween(
      mainSource,
      "ipcMain.on(GAME_WEBVIEW_EDITABLE_FOCUS_IPC_CHANNEL",
      "ipcMain.on(GAME_WEBVIEW_INTERACTION_DIAGNOSTIC_IPC_CHANNEL"
    );

    expect(rendererFocusHandler).toContain('focusHost: true, invalidatePresentation: platform === "atlas"');
    expect(rendererFocusHandler.match(/focusCurrentTrustedGameGuest\(platform, contents, focusOptions\)/g)?.length).toBe(2);
    expect(rendererFocusHandler).toContain("setTimeout");
    expect(guestFocusHandler).toContain('trustedGameIpcPlatform(ipcEvent) !== "atlas"');
    expect(guestFocusHandler).toContain("focusHost: false, invalidatePresentation: true");
    expect(guestFocusHandler.match(/focusCurrentTrustedGameGuest\("atlas", contents, focusOptions\)/g)?.length).toBe(2);
    expect(guestFocusHandler).toContain("setTimeout");
  });

  it("routes exact-schema interaction telemetry directly to local diagnostics", () => {
    const handler = sourceBetween(
      mainSource,
      "ipcMain.on(GAME_WEBVIEW_INTERACTION_DIAGNOSTIC_IPC_CHANNEL",
      'ipcMain.on("capture:tcga-research-event"'
    );
    const payload = sourceBetween(handler, "payload: {", "\n      }\n    }).catch");
    const retainedKeys = [...payload.matchAll(/^\s+(\w+):/gm)].map((match) => match[1]);

    expect(handler).toContain('trustedGameIpcPlatform(ipcEvent) !== "atlas"');
    expect(handler).toContain("validatedAtlasGameInteractionDiagnostic(value)");
    expect(handler).toContain("diagnostics.record({");
    expect(handler).not.toContain("capture.handleEvent");
    expect(retainedKeys).toEqual([
      "reason",
      "phase",
      "documentFocused",
      "documentVisible",
      "activeControl"
    ]);
  });

  it("keeps renderer focus helpers fenced by live Atlas UI state", () => {
    const focusHelpers = sourceBetween(
      rendererSource,
      "function focusNativeGameWebview",
      "async function setGameZoom"
    );

    expect(focusHelpers.match(/reviewDraftRef\.current \|\|/g)?.length).toBe(2);
    expect(focusHelpers.match(/rulesSearchOpenRef\.current \|\|/g)?.length).toBe(2);
    expect(focusHelpers.match(/activeViewRef\.current !== "play"/g)?.length).toBe(2);
    expect(focusHelpers.match(/platform !== activePlatformRef\.current/g)?.length).toBe(2);
    expect(focusHelpers.match(/platform !== mountedGamePlatformRef\.current/g)?.length).toBe(2);
  });
});
