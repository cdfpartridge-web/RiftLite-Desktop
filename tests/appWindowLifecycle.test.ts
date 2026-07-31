import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");

function handlerSource(eventName: string, nextEventName: string): string {
  const start = source.indexOf(`app.on("${eventName}"`);
  const end = source.indexOf(`app.on("${nextEventName}"`, start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("desktop window lifecycle", () => {
  it("clears only the BrowserWindow instance that actually closed", () => {
    const createWindowStart = source.indexOf("async function createWindow");
    const createWindowEnd = source.indexOf("function protocolNavigationFromArgs", createWindowStart);
    const createWindow = source.slice(createWindowStart, createWindowEnd);

    expect(createWindow).toContain("const createdMainWindow = mainWindow");
    expect(createWindow).toContain('createdMainWindow.once("closed"');
    expect(createWindow).toContain("if (mainWindow === createdMainWindow)");
    expect(createWindow).toContain("mainWindow = null");
  });

  it("keeps background services alive when macOS closes its last window", () => {
    const handler = handlerSource("window-all-closed", "before-quit");

    expect(handler).toContain('process.platform !== "darwin"');
    expect(handler).toContain("app.quit()");
    expect(handler).not.toContain("overlayServer?.stop()");
    expect(handler).not.toContain("simEventReceiver?.stop()");
  });

  it("stops background services only when the application is actually quitting", () => {
    const start = source.indexOf('app.on("will-quit"');
    const handler = source.slice(start);

    expect(start).toBeGreaterThan(-1);
    expect(handler).toContain("overlayServer?.stop()");
    expect(handler).toContain("void simEventReceiver?.stop()");
    expect(handler).toContain("globalShortcut.unregisterAll()");
  });

  it("routes unmodified F12 from the app or Atlas guest to the known-hand panel", () => {
    const start = source.indexOf("function installFullscreenShortcut");
    const end = source.indexOf("function getMainWindowBounds", start);
    const handler = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(handler).toContain('input.key === "F12"');
    expect(handler).toContain("!input.isAutoRepeat");
    expect(handler).toContain("registeredScreenshotHotkey");
    expect(handler).toContain("registeredShadowClipHotkey");
    expect(handler).toContain("registeredReplayFlagHotkey");
    expect(handler).toContain('hotkey.trim().toUpperCase() === "F12"');
    expect(handler).toContain("isMainRenderer || isAtlasGame");
    expect(handler).toContain("!mainWindow.webContents.isDestroyed()");
    expect(handler).toContain('mainWindow.webContents.send("atlas-known-hand:shortcut")');
    expect(handler).toContain("event.preventDefault()");
  });
});
