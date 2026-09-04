import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { canStartAtlasAutomaticRecovery } from "../src/main/services/atlasAutomaticRecoverySafetyFence.js";
import { AtlasLobbyPlayerFieldRepair } from "../src/main/services/atlasLobbyPlayerFieldRepair.js";
import type { AtlasLobbyPlayerFieldState } from "../src/shared/atlasLobbyPlayerField.js";

const main = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("../src/game-preload/gamePreload.ts", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/main/services/atlasLobbyPlayerFieldRepair.ts", import.meta.url), "utf8");

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing source block: ${start}`);
  return source.slice(from, to);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

/**
 * Execute the actual event registrations rather than restating their lifecycle
 * behavior in a test double. Loading all of main.ts would start Electron and
 * unrelated services, so only its dependency-injected guard/callbacks run here.
 */
function lifecycleFixture() {
  const state = {
    url: "https://play.riftatlas.com/",
    loading: false,
    destroyed: false,
    platformSwitchAllowed: true,
    protectedByGameEntry: false
  };
  const callbacks = new Map<string, (...args: unknown[]) => void>();
  const webContents = {
    id: 41,
    getURL: () => state.url,
    isDestroyed: () => state.destroyed,
    isLoadingMainFrame: () => state.loading,
    on: (name: string, callback: (...args: unknown[]) => void) => callbacks.set(name, callback)
  };
  const currentGuests = new Map([["atlas", webContents]]);
  const beginNavigation = vi.fn();
  const refreshGuestContext = vi.fn();
  const readField = vi.fn(async (): Promise<AtlasLobbyPlayerFieldState> => "collapsed");
  const applyCss = vi.fn(async () => undefined);
  const report = vi.fn();
  const context = createContext({
    webContents,
    policy: { platform: "atlas" },
    canStartAtlasAutomaticRecovery,
    gameWebContentsByPlatform: currentGuests,
    capture: { getGamePlatformSwitchStatus: () => ({ allowed: state.platformSwitchAllowed }) },
    atlasAutomaticRecoverySafetyFence: { isProtected: () => state.protectedByGameEntry },
    mainNavigationStartedAt: 0,
    invalidateAtlasCardRendering: vi.fn(),
    atlasEmptyShellMainRecovery: { beginNavigation },
    reportGuestLifecycle: vi.fn(),
    refreshGuestContext
  });
  const lifecycle = main.slice(main.indexOf("let atlasPlayerFieldCommittedUrl ="));
  const guard = between(lifecycle, "let atlasPlayerFieldCommittedUrl =", "const atlasPlayerFieldRepair =");
  runInContext(guard, context);
  const isSafe = runInContext("atlasPlayerFieldRepairSafe", context) as () => boolean;
  const repair = new AtlasLobbyPlayerFieldRepair({
    isSafe,
    readField,
    applyCss,
    report,
    delay: async () => undefined
  });
  context.atlasPlayerFieldRepair = repair;
  runInContext([
    between(lifecycle, 'webContents.on("did-start-navigation"', 'webContents.on("did-finish-load"'),
    between(lifecycle, 'webContents.on("did-navigate",', 'webContents.on("did-navigate-in-page"'),
    between(lifecycle, 'webContents.on("did-navigate-in-page"', 'webContents.on("dom-ready"')
  ].join("\n"), context);

  const emit = (name: string, ...args: unknown[]) => {
    const callback = callbacks.get(name);
    if (!callback) throw new Error(`Unregistered lifecycle callback: ${name}`);
    callback({}, ...args);
  };
  const successfulReads = () => {
    readField.mockResolvedValueOnce("collapsed").mockResolvedValueOnce("collapsed").mockResolvedValueOnce("ready");
  };
  return { state, currentGuests, beginNavigation, refreshGuestContext, isSafe, repair, readField, applyCss, report, emit, successfulReads };
}

describe("Atlas required Player field CSS repair integration", () => {
  it("observes collapsed fields after shell readiness and without debug opt-in", () => {
    const monitor = between(preload, "function reportAtlasShellStatusIfNeeded", "function isAtlasAuthSurface");
    const probe = between(monitor, "const playerFieldState =", "const hiddenShellSelector");
    expect(probe).toContain("readAtlasLobbyPlayerField()");
    expect(probe).toContain('send("debug", { reason: "atlas-lobby-player-field-collapsed" })');
    expect(probe).not.toContain("sendDebug");
    expect(probe).toContain("15_000");
    expect(monitor.indexOf("const playerFieldState =")).toBeLessThan(monitor.indexOf("if (atlasShellReadyReported)"));
    expect(probe).not.toContain("atlasEmptyShellReported");
  });

  it("uses the trusted guest event handler but never routes the defect into a reload", () => {
    const handler = between(main, "function handleAtlasShellStatusEvent", "async function createWindow");
    const branch = between(handler, 'if (reason === "atlas-lobby-player-field-collapsed")', "if (!atlasEmptyShellMainRecovery.isCurrentNavigation");
    expect(branch).toContain("atlasLobbyPlayerFieldRepairsByGuest.get(sender.id)?.check()");
    expect(branch).toContain("return;");
    expect(branch).not.toMatch(/loadURL|clearStorage|recoverAtlasRoomAuth/);
    expect(branch).toContain("reportedUrl === senderUrl");
  });

  it("rechecks the current guest, navigation, capture and matchmaking fences", () => {
    const guard = between(main, "const atlasPlayerFieldRepairSafe =", "const atlasPlayerFieldRepair =");
    expect(guard).toContain("webContents.isLoadingMainFrame()");
    expect(guard).toContain("canStartAtlasAutomaticRecovery({");
    expect(guard).toContain('gameWebContentsByPlatform.get("atlas")?.id');
    expect(guard).toContain("navigationCurrent: currentUrl === atlasPlayerFieldCommittedUrl");
    expect(guard).toContain("capture.getGamePlatformSwitchStatus().allowed");
    expect(guard).toContain("atlasAutomaticRecoverySafetyFence.isProtected(webContents.id, currentUrl)");
    const wiring = between(main, "const atlasPlayerFieldRepair =", 'webContents.on("did-start-navigation"');
    expect(wiring).toContain("webContents.executeJavaScript(ATLAS_LOBBY_PLAYER_FIELD_PROBE)");
    expect(wiring).toContain("webContents.insertCSS(atlasCardRenderingCssForUrl(webContents.getURL()))");
    expect(wiring).not.toMatch(/loadURL|removeInsertedCSS|clearStorage|localStorage|cookies/);
    expect(controller).not.toMatch(/loadURL|reload\(|localStorage|sessionStorage|cookies|openSignIn|\.click\(/);
  });

  it("cancels stale work on document/SPA navigation and disposes replaced guests", () => {
    expect(main).toContain("atlasPlayerFieldRepair.navigationChanged(true)");
    expect(main).toContain("atlasPlayerFieldRepair.navigationChanged(false)");
    expect(main).toContain("atlasPlayerFieldRepair.dispose()");
    expect(main).toContain("atlasLobbyPlayerFieldRepairsByGuest.delete(webContents.id)");
  });

  it("shows a failed repair without an automatic remount or sign-in reset prompt", () => {
    const notice = between(renderer, 'if (failure.reason === "lobby-layout")', "void (async () =>");
    expect(notice).toContain("showCaptureNotice");
    expect(notice).toContain("return;");
    expect(notice).not.toMatch(/setGameWebviewEpoch|setAtlasRecoverySuggested|recoverAtlasWebview/);
    const feedback = between(main, 'report: (outcome) =>', 'webContents.on("did-start-navigation"');
    expect(feedback).toContain('if (outcome === "failed")');
    expect(feedback).toContain("canAutoRemount: false");
  });
});

describe("Atlas Player-field repair navigation lifecycle", () => {
  it("cancels pending work for a prevented external start, then permits repair in the surviving lobby", async () => {
    const fixture = lifecycleFixture();
    const initial = deferred<AtlasLobbyPlayerFieldState>();
    fixture.readField.mockImplementationOnce(() => initial.promise);
    const pending = fixture.repair.check();

    fixture.state.loading = true;
    fixture.emit("did-start-navigation", "https://riftatlas.com/decks/new", false, true);
    expect(fixture.isSafe()).toBe(false);
    // Electron prevents the external navigation. There is no commit/dom-ready;
    // its actual URL remains the original lobby, unlike the empty-shell tracker.
    fixture.state.loading = false;
    expect(fixture.beginNavigation).toHaveBeenCalledWith(41, "https://riftatlas.com/decks/new");
    expect(fixture.isSafe()).toBe(true);
    initial.resolve("collapsed");
    await pending;
    expect(fixture.applyCss).not.toHaveBeenCalled();

    fixture.successfulReads();
    await fixture.repair.check();
    expect(fixture.applyCss).toHaveBeenCalledTimes(1);
    expect(fixture.report).toHaveBeenCalledExactlyOnceWith("repaired");
    expect(fixture.refreshGuestContext).not.toHaveBeenCalled();
  });

  it("retains the attempt after cancelled starts and renews it only when a same-URL reload commits", async () => {
    const fixture = lifecycleFixture();
    fixture.successfulReads();
    await fixture.repair.check();

    fixture.emit("did-start-navigation", "https://riftatlas.com/decks/new", false, true);
    await fixture.repair.check();
    expect(fixture.applyCss).toHaveBeenCalledTimes(1);
    expect(fixture.readField).toHaveBeenCalledTimes(3);

    fixture.state.loading = true;
    fixture.emit("did-start-navigation", fixture.state.url, false, true);
    await fixture.repair.check();
    fixture.state.loading = false;
    // Merely finishing a start without committing is still the old document.
    await fixture.repair.check();
    expect(fixture.applyCss).toHaveBeenCalledTimes(1);
    fixture.emit("did-navigate", fixture.state.url);
    fixture.successfulReads();
    await fixture.repair.check();

    expect(fixture.applyCss).toHaveBeenCalledTimes(2);
    expect(fixture.report.mock.calls).toEqual([["repaired"], ["repaired"]]);
    expect(fixture.refreshGuestContext).toHaveBeenCalledTimes(1);
  });

  it("cancels an old document's pending probe even when the new document commits to the same URL", async () => {
    const fixture = lifecycleFixture();
    const initial = deferred<AtlasLobbyPlayerFieldState>();
    fixture.readField.mockImplementationOnce(() => initial.promise);
    const pending = fixture.repair.check();

    fixture.emit("did-start-navigation", fixture.state.url, false, true);
    fixture.emit("did-navigate", fixture.state.url);
    initial.resolve("collapsed");
    await pending;
    expect(fixture.applyCss).not.toHaveBeenCalled();

    fixture.successfulReads();
    await fixture.repair.check();
    expect(fixture.applyCss).toHaveBeenCalledTimes(1);
  });

  it("updates SPA identity without granting another attempt in the same document", async () => {
    const fixture = lifecycleFixture();
    fixture.successfulReads();
    await fixture.repair.check();

    fixture.state.url = "https://play.riftatlas.com/lobby";
    expect(fixture.isSafe()).toBe(false);
    fixture.emit("did-navigate-in-page", fixture.state.url, true);
    expect(fixture.isSafe()).toBe(true);
    await fixture.repair.check();

    expect(fixture.applyCss).toHaveBeenCalledTimes(1);
    expect(fixture.readField).toHaveBeenCalledTimes(3);
    expect(fixture.beginNavigation).toHaveBeenCalledWith(41, fixture.state.url);
  });

  it("cancels a pending probe on SPA navigation and measures the new lobby instead", async () => {
    const fixture = lifecycleFixture();
    const initial = deferred<AtlasLobbyPlayerFieldState>();
    const replacement = deferred<AtlasLobbyPlayerFieldState>();
    fixture.readField.mockImplementationOnce(() => initial.promise).mockImplementationOnce(() => replacement.promise);
    const pending = fixture.repair.check();

    fixture.state.url = "https://play.riftatlas.com/lobby";
    fixture.emit("did-navigate-in-page", fixture.state.url, true);
    expect(fixture.readField).toHaveBeenCalledTimes(2);
    initial.resolve("collapsed");
    await pending;
    expect(fixture.applyCss).not.toHaveBeenCalled();
    replacement.resolve("ready");
    await Promise.resolve();
    expect(fixture.readField).toHaveBeenCalledTimes(2);
    expect(fixture.applyCss).not.toHaveBeenCalled();
  });

  it("ignores subframe/in-place starts and does not cancel a current main-frame probe", async () => {
    const fixture = lifecycleFixture();
    const initial = deferred<AtlasLobbyPlayerFieldState>();
    fixture.readField.mockImplementationOnce(() => initial.promise)
      .mockResolvedValueOnce("collapsed").mockResolvedValueOnce("ready");
    const pending = fixture.repair.check();

    fixture.emit("did-start-navigation", "https://example.com/frame", false, false);
    fixture.emit("did-start-navigation", fixture.state.url, true, true);
    initial.resolve("collapsed");
    await pending;

    expect(fixture.applyCss).toHaveBeenCalledTimes(1);
    expect(fixture.beginNavigation).not.toHaveBeenCalled();
  });

  it("blocks loading and uncommitted URL changes until the actual navigation commits", async () => {
    const fixture = lifecycleFixture();
    fixture.state.loading = true;
    expect(fixture.isSafe()).toBe(false);
    await fixture.repair.check();
    fixture.state.loading = false;
    fixture.state.url = "https://play.riftatlas.com/lobby";
    expect(fixture.isSafe()).toBe(false);
    await fixture.repair.check();
    expect(fixture.readField).not.toHaveBeenCalled();

    fixture.emit("did-navigate", fixture.state.url);
    expect(fixture.isSafe()).toBe(true);
    fixture.successfulReads();
    await fixture.repair.check();
    expect(fixture.applyCss).toHaveBeenCalledTimes(1);
  });

  it.each(["replaced guest", "capture", "matchmaking", "destroyed guest"])("honors the live %s fence after a cancelled start", async (fence) => {
    const fixture = lifecycleFixture();
    fixture.emit("did-start-navigation", "https://riftatlas.com/decks/new", false, true);
    if (fence === "replaced guest") fixture.currentGuests.delete("atlas");
    if (fence === "capture") fixture.state.platformSwitchAllowed = false;
    if (fence === "matchmaking") fixture.state.protectedByGameEntry = true;
    if (fence === "destroyed guest") fixture.state.destroyed = true;

    expect(fixture.isSafe()).toBe(false);
    await fixture.repair.check();
    expect(fixture.readField).not.toHaveBeenCalled();
    expect(fixture.applyCss).not.toHaveBeenCalled();
  });
});
