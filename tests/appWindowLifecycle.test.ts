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
  it("shows an isolated startup window before opening the local store", () => {
    const startup = source.indexOf("app.whenReady().then");
    const startupWindow = source.indexOf("createStartupWindow();", startup);
    const storeLoad = source.indexOf('runStartupStage("Loading local data"', startup);
    const ipcRegistration = source.indexOf("registerIpc();", startup);
    const mainWindow = source.indexOf('runStartupStage("Opening the main window"', startup);

    expect(startupWindow).toBeGreaterThan(startup);
    expect(storeLoad).toBeGreaterThan(startupWindow);
    expect(ipcRegistration).toBeGreaterThan(storeLoad);
    expect(mainWindow).toBeGreaterThan(ipcRegistration);
  });

  it("keeps the startup surface independent from the unready renderer bridge", () => {
    const start = source.indexOf("function createStartupWindow");
    const end = source.indexOf("function closeStartupWindow", start);
    const startupWindow = source.slice(start, end);

    expect(startupWindow).toContain("data:text/html");
    expect(startupWindow).toContain("show: true");
    expect(startupWindow).toContain("contextIsolation: true");
    expect(startupWindow).toContain("nodeIntegration: false");
    expect(startupWindow).toContain("sandbox: true");
    expect(startupWindow).not.toContain("preload:");
  });

  it("logs the beginning, slow checkpoint, completion, and failure of startup stages", () => {
    const start = source.indexOf("async function runStartupStage");
    const end = source.indexOf("function refreshAtlasWebviewRuntime", start);
    const startupStage = source.slice(start, end);

    expect(startupStage).toContain("startup stage begin:");
    expect(startupStage).toContain("startup stage still running:");
    expect(startupStage).toContain("is taking longer than usual. Your data is safe");
    expect(startupStage).toContain("startup stage complete:");
    expect(startupStage).toContain("startup stage failed:");
    expect(startupStage).toContain("clearTimeout(slowTimer)");
  });

  it("clears only the BrowserWindow instance that actually closed", () => {
    const createWindowStart = source.indexOf("async function createWindow");
    const createWindowEnd = source.indexOf("function protocolNavigationFromArgs", createWindowStart);
    const createWindow = source.slice(createWindowStart, createWindowEnd);

    expect(createWindow).toContain("const createdMainWindow = mainWindow");
    expect(createWindow).toContain('createdMainWindow.once("closed"');
    expect(createWindow).toContain("if (mainWindow === createdMainWindow)");
    expect(createWindow).toContain("mainWindow = null");
    expect(createWindow).toContain("createdMainWindow.show()");
    expect(createWindow).toContain("closeStartupWindow()");
  });

  it("restores, shows, and focuses an existing window or recreates it once services are ready", () => {
    const start = source.indexOf("function showOrCreateAppWindow");
    const end = source.indexOf("if (!gotSingleInstanceLock)", start);
    const revealWindow = source.slice(start, end);
    const secondInstance = handlerSource("second-instance", "open-url");

    expect(revealWindow).toContain("mainWindow.isMinimized()");
    expect(revealWindow).toContain("mainWindow.restore()");
    expect(revealWindow).toContain("mainWindow.show()");
    expect(revealWindow).toContain("mainWindow.focus()");
    expect(revealWindow).toContain("!mainServicesReady");
    expect(revealWindow).toContain("createStartupWindow()");
    expect(revealWindow).toContain("createWindow().catch");
    expect(secondInstance).toContain("showOrCreateAppWindow()");
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
