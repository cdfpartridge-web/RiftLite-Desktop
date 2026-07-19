import { describe, expect, it, vi } from "vitest";

import {
  bindGameWebviewEvents,
  type GameWebviewEventHandlers,
  type GameWebviewIpcMessageEvent
} from "../src/renderer/gameWebviewEvents.js";

function createHandlers(): GameWebviewEventHandlers {
  return {
    onIpcMessage: vi.fn(),
    onDomReady: vi.fn(),
    onDidFinishLoad: vi.fn(),
    onDidNavigate: vi.fn(),
    onDidNavigateInPage: vi.fn(),
    onDidStartLoading: vi.fn()
  };
}

describe("game webview event binding", () => {
  it("dispatches each literal hyphenated Electron event", () => {
    const target = new EventTarget();
    const handlers = createHandlers();
    const ipcEvent = new Event("ipc-message") as GameWebviewIpcMessageEvent;
    ipcEvent.channel = "capture:event";
    ipcEvent.args = [{ reason: "atlas-app-shell-empty" }];

    bindGameWebviewEvents(target, handlers);
    target.dispatchEvent(ipcEvent);
    target.dispatchEvent(new Event("dom-ready"));
    target.dispatchEvent(new Event("did-finish-load"));
    target.dispatchEvent(new Event("did-navigate"));
    target.dispatchEvent(new Event("did-navigate-in-page"));
    target.dispatchEvent(new Event("did-start-loading"));

    expect(handlers.onIpcMessage).toHaveBeenCalledOnce();
    expect(handlers.onIpcMessage).toHaveBeenCalledWith(ipcEvent);
    expect(handlers.onDomReady).toHaveBeenCalledOnce();
    expect(handlers.onDidFinishLoad).toHaveBeenCalledOnce();
    expect(handlers.onDidNavigate).toHaveBeenCalledOnce();
    expect(handlers.onDidNavigateInPage).toHaveBeenCalledOnce();
    expect(handlers.onDidStartLoading).toHaveBeenCalledOnce();
  });

  it("does not treat React-style camelCase names as Electron events", () => {
    const target = new EventTarget();
    const handlers = createHandlers();
    bindGameWebviewEvents(target, handlers);

    for (const name of [
      "ipcMessage",
      "domReady",
      "didFinishLoad",
      "didNavigate",
      "didNavigateInPage",
      "didStartLoading"
    ]) {
      target.dispatchEvent(new Event(name));
    }

    for (const handler of Object.values(handlers)) {
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it("removes every listener and allows cleanup to be called more than once", () => {
    const target = new EventTarget();
    const handlers = createHandlers();
    const cleanup = bindGameWebviewEvents(target, handlers);

    cleanup();
    cleanup();

    target.dispatchEvent(new Event("ipc-message"));
    target.dispatchEvent(new Event("dom-ready"));
    target.dispatchEvent(new Event("did-finish-load"));
    target.dispatchEvent(new Event("did-navigate"));
    target.dispatchEvent(new Event("did-navigate-in-page"));
    target.dispatchEvent(new Event("did-start-loading"));

    for (const handler of Object.values(handlers)) {
      expect(handler).not.toHaveBeenCalled();
    }
  });
});
