import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RendererCrashFault } from "../src/shared/types";

type WindowEvent = Record<string, unknown>;

function stubRendererWindow() {
  const listeners = new Map<string, Array<(event: WindowEvent) => void>>();
  const reportRendererFault = vi.fn((_fault: RendererCrashFault) => undefined);
  const window = {
    riftlite: { reportRendererFault },
    addEventListener: vi.fn((kind: string, listener: (event: WindowEvent) => void) => {
      listeners.set(kind, [...(listeners.get(kind) ?? []), listener]);
    })
  };
  vi.stubGlobal("window", window);
  return {
    window,
    reportRendererFault,
    dispatch(kind: string, event: WindowEvent) {
      for (const listener of listeners.get(kind) ?? []) listener(event);
    }
  };
}

describe("renderer crash logging", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("installs each global listener once, even when setup is called repeatedly", async () => {
    const harness = stubRendererWindow();
    const { installRendererCrashLogging } = await import("../src/renderer/rendererCrashLogging");
    installRendererCrashLogging();
    installRendererCrashLogging();
    installRendererCrashLogging();

    expect(harness.window.addEventListener.mock.calls.map(([kind]) => kind)).toEqual(["error", "unhandledrejection"]);
    harness.dispatch("error", { message: "Renderer failed" });
    harness.dispatch("unhandledrejection", { reason: "Request failed" });
    expect(harness.reportRendererFault).toHaveBeenCalledTimes(2);
  });

  it("can be called without a browser and still installs when a window becomes available", async () => {
    vi.stubGlobal("window", undefined);
    const { installRendererCrashLogging, reportRendererCrash } = await import("../src/renderer/rendererCrashLogging");
    expect(() => installRendererCrashLogging()).not.toThrow();
    expect(() => reportRendererCrash("react-error", new Error("No bridge yet"))).not.toThrow();

    const harness = stubRendererWindow();
    installRendererCrashLogging();
    harness.dispatch("error", { message: "Window now available" });
    expect(harness.reportRendererFault).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", message: "Window now available" }));
  });

  it("forwards a global Error with its stack and source location without suppressing the event", async () => {
    const harness = stubRendererWindow();
    const { installRendererCrashLogging } = await import("../src/renderer/rendererCrashLogging");
    installRendererCrashLogging();
    const error = new Error("Board render failed");
    error.stack = "Error: Board render failed\n    at Board (app.js:41:7)";
    const preventDefault = vi.fn();
    harness.dispatch("error", { error, message: "Fallback message", filename: "app.js", lineno: 41, colno: 7, preventDefault });

    expect(harness.reportRendererFault).toHaveBeenCalledWith({ kind: "error", message: error.message, stack: error.stack, source: "app.js", line: 41, column: 7 });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("uses the global event message when no Error object is supplied", async () => {
    const harness = stubRendererWindow();
    const { installRendererCrashLogging } = await import("../src/renderer/rendererCrashLogging");
    installRendererCrashLogging();
    harness.dispatch("error", { error: null, message: "Script error.", filename: "guest.js", lineno: 2, colno: 3 });

    expect(harness.reportRendererFault).toHaveBeenCalledWith({ kind: "error", message: "Script error.", stack: undefined, source: "guest.js", line: 2, column: 3 });
  });

  it("forwards rejected Error and string reasons without suppressing the rejection", async () => {
    const harness = stubRendererWindow();
    const { installRendererCrashLogging } = await import("../src/renderer/rendererCrashLogging");
    installRendererCrashLogging();
    const error = new Error("Replay failed to load");
    error.stack = "Error: Replay failed to load\n    at loadReplay (app.js:12:4)";
    const preventDefault = vi.fn();
    harness.dispatch("unhandledrejection", { reason: error, preventDefault });
    harness.dispatch("unhandledrejection", { reason: "Capture request failed", preventDefault });

    expect(harness.reportRendererFault).toHaveBeenNthCalledWith(1, { kind: "unhandled-rejection", message: error.message, stack: error.stack, source: undefined, line: undefined, column: undefined });
    expect(harness.reportRendererFault).toHaveBeenNthCalledWith(2, expect.objectContaining({ kind: "unhandled-rejection", message: "Capture request failed", stack: undefined }));
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("forwards an uncaught React error through the same reporting bridge", async () => {
    const harness = stubRendererWindow();
    const { reportRendererCrash } = await import("../src/renderer/rendererCrashLogging");
    const error = new Error("Settings component failed");
    error.stack = "Error: Settings component failed\n    at Settings (app.js:50:1)";
    reportRendererCrash("react-error", error);

    expect(harness.reportRendererFault).toHaveBeenCalledWith({ kind: "react-error", message: error.message, stack: error.stack, source: undefined, line: undefined, column: undefined });
  });

  it("bounds message, stack, and source lengths before crossing the bridge", async () => {
    const harness = stubRendererWindow();
    const { reportRendererCrash } = await import("../src/renderer/rendererCrashLogging");
    const error = new Error("message-".repeat(500));
    error.stack = "stack-line\n".repeat(1_000);
    const source = "source-path/".repeat(200);
    reportRendererCrash("error", error, { source, line: 11, column: 8 });

    expect(harness.reportRendererFault).toHaveBeenCalledWith({ kind: "error", message: error.message.slice(0, 2_000), stack: error.stack.slice(0, 6_000), source: source.slice(0, 1_000), line: 11, column: 8 });
  });

  it("shares the report limit across all fault sources and allows reports again after one minute", async () => {
    const harness = stubRendererWindow();
    const { installRendererCrashLogging, reportRendererCrash } = await import("../src/renderer/rendererCrashLogging");
    installRendererCrashLogging();
    for (let index = 0; index < 10; index += 1) harness.dispatch("error", { message: `Global error ${index}` });
    for (let index = 0; index < 10; index += 1) harness.dispatch("unhandledrejection", { reason: `Rejected request ${index}` });
    reportRendererCrash("react-error", "Excess report");
    expect(harness.reportRendererFault).toHaveBeenCalledTimes(20);

    vi.advanceTimersByTime(59_999);
    reportRendererCrash("react-error", "Still rate limited");
    expect(harness.reportRendererFault).toHaveBeenCalledTimes(20);
    vi.advanceTimersByTime(1);
    reportRendererCrash("react-error", "New reporting window");
    expect(harness.reportRendererFault).toHaveBeenCalledTimes(21);
    expect(harness.reportRendererFault).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "react-error", message: "New reporting window" }));
  });

  it("contains a throwing bridge and permits the next independent report", async () => {
    const harness = stubRendererWindow();
    const { installRendererCrashLogging } = await import("../src/renderer/rendererCrashLogging");
    installRendererCrashLogging();
    harness.reportRendererFault.mockImplementationOnce(() => { throw new Error("IPC unavailable"); });

    expect(() => harness.dispatch("error", { message: "First failure" })).not.toThrow();
    expect(() => harness.dispatch("error", { message: "Second failure" })).not.toThrow();
    expect(harness.reportRendererFault).toHaveBeenCalledTimes(2);
    expect(harness.reportRendererFault).toHaveBeenLastCalledWith(expect.objectContaining({ message: "Second failure" }));
  });

  it("does not recursively report faults raised during a bridge call", async () => {
    const harness = stubRendererWindow();
    const { reportRendererCrash } = await import("../src/renderer/rendererCrashLogging");
    harness.reportRendererFault.mockImplementation(() => {
      reportRendererCrash("error", "Nested bridge failure");
      return undefined;
    });

    expect(() => reportRendererCrash("react-error", "Original failure")).not.toThrow();
    expect(harness.reportRendererFault).toHaveBeenCalledTimes(1);
    expect(harness.reportRendererFault).toHaveBeenCalledWith(expect.objectContaining({ message: "Original failure" }));
    reportRendererCrash("error", "Later independent failure");
    expect(harness.reportRendererFault).toHaveBeenCalledTimes(2);
  });

  it("tolerates a missing bridge without disabling future reporting", async () => {
    const harness = stubRendererWindow();
    const { reportRendererCrash } = await import("../src/renderer/rendererCrashLogging");
    vi.stubGlobal("window", { addEventListener: harness.window.addEventListener });
    expect(() => reportRendererCrash("error", "Bridge missing")).not.toThrow();
    vi.stubGlobal("window", harness.window);
    reportRendererCrash("error", "Bridge restored");
    expect(harness.reportRendererFault).toHaveBeenCalledOnce();
    expect(harness.reportRendererFault).toHaveBeenCalledWith(expect.objectContaining({ message: "Bridge restored" }));
  });

  it("treats arbitrary object rejection reasons as opaque instead of serializing their contents", async () => {
    const harness = stubRendererWindow();
    const { installRendererCrashLogging } = await import("../src/renderer/rendererCrashLogging");
    installRendererCrashLogging();
    const toJSON = vi.fn(() => { throw new Error("Must not serialize a rejection reason"); });
    const toString = vi.fn(() => { throw new Error("Must not stringify a rejection reason"); });
    const readSecret = vi.fn(() => "private-account-token");
    const reason: Record<string, unknown> = { message: "private payload text", toJSON, toString };
    reason.self = reason;
    Object.defineProperty(reason, "secret", { enumerable: true, get: readSecret });

    expect(() => harness.dispatch("unhandledrejection", { reason })).not.toThrow();
    expect(harness.reportRendererFault).toHaveBeenCalledWith({ kind: "unhandled-rejection", message: "Unhandled renderer error", stack: undefined, source: undefined, line: undefined, column: undefined });
    expect(toJSON).not.toHaveBeenCalled();
    expect(toString).not.toHaveBeenCalled();
    expect(readSecret).not.toHaveBeenCalled();
  });
});
