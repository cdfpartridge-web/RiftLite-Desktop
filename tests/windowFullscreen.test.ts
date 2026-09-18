import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import ts from "typescript";

import { observeWindowFullscreen } from "../src/renderer/useWindowFullscreen";

const mainAst = ts.createSourceFile(
  "main.ts",
  readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true
);
const preloadAst = ts.createSourceFile(
  "appPreload.ts",
  readFileSync(new URL("../src/preload/appPreload.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true
);

function transpile(source: string): string {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

function mainFunction(name: string): string {
  const declaration = mainAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw new Error(`Missing production function ${name}.`);
  return declaration.getText(mainAst);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function observerHarness() {
  const initial = deferred<boolean>();
  const callbacks = new Set<(fullscreen: boolean) => void>();
  const unsubscribe = vi.fn();
  const order: string[] = [];
  const api = {
    getWindowFullscreen: vi.fn(() => {
      order.push("query");
      return initial.promise;
    }),
    onWindowFullscreenChanged: vi.fn((callback: (fullscreen: boolean) => void) => {
      order.push("subscribe");
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
        unsubscribe();
      };
    })
  };
  const update = vi.fn();
  const cleanup = observeWindowFullscreen(api, update);
  return { initial, api, callbacks, unsubscribe, order, update, cleanup };
}

// Execute the production native handlers without booting Electron or changing
// the installed application. Native transitions stay explicit because macOS
// does not finish entering fullscreen synchronously with setFullScreen().
function nativeHarness() {
  let fullscreen = false;
  const host = Object.assign(new EventEmitter(), { id: 1, isDestroyed: vi.fn(() => false), send: vi.fn() });
  const guest = Object.assign(new EventEmitter(), { id: 2 });
  const window = Object.assign(new EventEmitter(), {
    webContents: host,
    isDestroyed: vi.fn(() => false),
    isFullScreen: vi.fn(() => fullscreen),
    setFullScreen: vi.fn(),
    setMenuBarVisibility: vi.fn()
  });
  const environment = {
    mainWindow: window,
    registeredScreenshotHotkey: "",
    registeredShadowClipHotkey: "",
    registeredReplayFlagHotkey: "",
    gameWebContentsByPlatform: new Map([["atlas", guest]])
  };
  const js = transpile([
    mainFunction("installFullscreenState"),
    mainFunction("toggleTrueFullscreen"),
    mainFunction("installFullscreenShortcut")
  ].join("\n"));
  const install = new Function(
    ...Object.keys(environment),
    `${js}; return { state: installFullscreenState, shortcut: installFullscreenShortcut };`
  )(...Object.values(environment));
  install.state(window);
  install.shortcut(host);
  install.shortcut(guest);
  function transition(value: boolean, queryValue = value) {
    fullscreen = queryValue;
    window.emit(value ? "enter-full-screen" : "leave-full-screen");
  }
  function input(target: EventEmitter, overrides: Record<string, unknown> = {}) {
    const event = { preventDefault: vi.fn() };
    target.emit("before-input-event", event, {
      type: "keyDown", key: "F11", alt: false, control: false, meta: false, shift: false, isAutoRepeat: false,
      ...overrides
    });
    return event;
  }
  return { host, guest, window, transition, input };
}

describe("renderer fullscreen observation", () => {
  it.each([false, true])("subscribes before querying and restores initial state %s", async (fullscreen) => {
    const h = observerHarness();
    expect(h.order).toEqual(["subscribe", "query"]);
    expect(h.update).not.toHaveBeenCalled();
    h.initial.resolve(fullscreen);
    await h.initial.promise;
    expect(h.update.mock.calls).toEqual([[fullscreen]]);
    h.cleanup();
  });

  it.each([false, true])("keeps native state %s when an older query resolves afterward", async (fullscreen) => {
    const h = observerHarness();
    h.callbacks.forEach((callback) => callback(fullscreen));
    h.initial.resolve(!fullscreen);
    await h.initial.promise;
    expect(h.update.mock.calls).toEqual([[fullscreen]]);
    h.cleanup();
  });

  it("continues following enter and leave events after initial state resolves", async () => {
    const h = observerHarness();
    h.initial.resolve(false);
    await h.initial.promise;
    h.callbacks.forEach((callback) => callback(true));
    h.callbacks.forEach((callback) => callback(false));
    expect(h.update.mock.calls).toEqual([[false], [true], [false]]);
    h.cleanup();
  });

  it("unsubscribes and ignores queued events and query completion after unmount", async () => {
    const h = observerHarness();
    const queuedCallback = [...h.callbacks][0];
    h.cleanup();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.callbacks.size).toBe(0);
    queuedCallback(true);
    h.initial.resolve(true);
    await h.initial.promise;
    expect(h.update).not.toHaveBeenCalled();
  });

  it("keeps native observation working when the initial query fails", async () => {
    const h = observerHarness();
    h.initial.reject(new Error("Renderer reloaded during request"));
    await expect(h.initial.promise).rejects.toThrow("Renderer reloaded");
    h.callbacks.forEach((callback) => callback(true));
    expect(h.update.mock.calls).toEqual([[true]]);
    h.cleanup();
  });
});

describe("native fullscreen publication and shortcuts", () => {
  it("uses native event state when Windows reports the old getter value during the event", () => {
    const h = nativeHarness();
    h.transition(true, false);
    expect(h.window.isFullScreen()).toBe(false);
    expect(h.host.send.mock.calls).toEqual([["window:fullscreen-changed", true]]);
    h.transition(false, true);
    expect(h.window.isFullScreen()).toBe(true);
    expect(h.host.send.mock.calls).toEqual([
      ["window:fullscreen-changed", true], ["window:fullscreen-changed", false]
    ]);
  });

  it("publishes completed native transitions and restores state after renderer reload", () => {
    const h = nativeHarness();
    h.transition(true);
    h.host.emit("did-finish-load");
    h.transition(false);
    h.host.emit("did-finish-load");
    expect(h.host.send.mock.calls).toEqual([
      ["window:fullscreen-changed", true],
      ["window:fullscreen-changed", true],
      ["window:fullscreen-changed", false],
      ["window:fullscreen-changed", false]
    ]);
  });

  it.each(["window", "renderer"])("does not send state to a destroyed %s", (destroyed) => {
    const h = nativeHarness();
    (destroyed === "window" ? h.window : h.host).isDestroyed.mockReturnValue(true);
    h.transition(true);
    h.transition(false);
    h.host.emit("did-finish-load");
    expect(h.host.send).not.toHaveBeenCalled();
  });

  it.each(["host", "guest"] as const)("F11 enters and exits fullscreen with %s keyboard focus", (target) => {
    const h = nativeHarness();
    expect(h.input(h[target]).preventDefault).toHaveBeenCalledOnce();
    expect(h.window.setFullScreen.mock.calls).toEqual([[true]]);
    expect(h.host.send).not.toHaveBeenCalled();
    h.transition(true);
    expect(h.input(h[target]).preventDefault).toHaveBeenCalledOnce();
    expect(h.window.setFullScreen.mock.calls).toEqual([[true], [false]]);
    h.transition(false);
    expect(h.window.setMenuBarVisibility.mock.calls).toEqual([[false], [false]]);
    expect(h.host.send.mock.calls).toEqual([
      ["window:fullscreen-changed", true], ["window:fullscreen-changed", false]
    ]);
  });

  it("consumes guest F11 repeats without toggling back after entering fullscreen", () => {
    const h = nativeHarness();
    h.input(h.guest);
    h.transition(true);
    for (let index = 0; index < 4; index++) {
      expect(h.input(h.guest, { isAutoRepeat: true }).preventDefault).toHaveBeenCalledOnce();
    }
    expect(h.window.setFullScreen.mock.calls).toEqual([[true]]);
    expect(h.input(h.guest, { type: "keyUp" }).preventDefault).not.toHaveBeenCalled();
    h.input(h.guest);
    expect(h.window.setFullScreen.mock.calls).toEqual([[true], [false]]);
  });

  it.each(["alt", "control", "meta", "shift"])("leaves modified %s+F11 input untouched", (modifier) => {
    const h = nativeHarness();
    expect(h.input(h.guest, { [modifier]: true }).preventDefault).not.toHaveBeenCalled();
    expect(h.window.setFullScreen).not.toHaveBeenCalled();
  });
});

describe("fullscreen preload bridge", () => {
  it("reads current native state only through the trusted app IPC boundary", () => {
    let registration: ts.CallExpression | undefined;
    const findRegistration = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "window:fullscreen:get") {
        registration = node;
      }
      ts.forEachChild(node, findRegistration);
    };
    findRegistration(mainAst);
    if (!registration) throw new Error("Missing fullscreen query registration.");
    const ipcMain = { handle: vi.fn() };
    const window = { isFullScreen: vi.fn(() => false) };
    const isTrusted = vi.fn((event: { trusted: boolean }) => event.trusted);
    const source = [
      mainFunction("assertTrustedAppIpcSender"),
      mainFunction("handleTrustedAppIpc"),
      registration.getText(mainAst)
    ].join("\n");
    new Function("ipcMain", "mainWindow", "isTrustedAppIpcSender", transpile(source))(ipcMain, window, isTrusted);
    expect(ipcMain.handle).toHaveBeenCalledOnce();
    const [channel, query] = ipcMain.handle.mock.calls[0];
    expect(channel).toBe("window:fullscreen:get");
    expect(() => query({ trusted: false })).toThrow("untrusted sender");
    expect(window.isFullScreen).not.toHaveBeenCalled();
    expect(query({ trusted: true })).toBe(false);
    window.isFullScreen.mockReturnValue(true);
    expect(query({ trusted: true })).toBe(true);
  });

  it("queries native state, forwards only the boolean payload, and removes its own listener", async () => {
    let apiObject: ts.ObjectLiteralExpression | undefined;
    for (const statement of preloadAst.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.name.getText(preloadAst) === "api" && declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) {
          apiObject = declaration.initializer;
        }
      }
    }
    if (!apiObject) throw new Error("Missing production preload API.");
    const names = ["getWindowFullscreen", "onWindowFullscreenChanged"];
    const properties = apiObject.properties.filter((property) => property.name && names.includes(property.name.getText(preloadAst)));
    expect(properties).toHaveLength(names.length);
    const ipc = Object.assign(new EventEmitter(), { invoke: vi.fn(async () => true) });
    const api = new Function("ipcRenderer", `${transpile(`const api = { ${properties.map((property) => property.getText(preloadAst)).join(",\n")} };`)}; return api;`)(ipc);
    const update = vi.fn();
    const otherListener = vi.fn();
    ipc.on("window:fullscreen-changed", otherListener);
    const cleanup = api.onWindowFullscreenChanged(update);
    expect(await api.getWindowFullscreen()).toBe(true);
    expect(ipc.invoke).toHaveBeenCalledWith("window:fullscreen:get");
    ipc.emit("window:fullscreen-changed", { sender: "native" }, true);
    expect(update.mock.calls).toEqual([[true]]);
    cleanup();
    ipc.emit("window:fullscreen-changed", { sender: "native" }, false);
    expect(update.mock.calls).toEqual([[true]]);
    expect(otherListener).toHaveBeenCalledTimes(2);
    expect(ipc.listenerCount("window:fullscreen-changed")).toBe(1);
  });
});
