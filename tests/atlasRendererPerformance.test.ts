import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AtlasRendererPerformanceWindow,
  AtlasRendererPerformanceReportLimiter,
  atlasInputDispatchDelayMs,
  countAtlasRendererImages,
  validatedAtlasRendererPerformanceSummary
} from "../src/shared/atlasRendererPerformance.js";
import { installAtlasRendererPerformanceMonitor } from "../src/game-preload/atlasRendererPerformance.js";

const emptyImages = () => countAtlasRendererImages([]);
function summary() {
  const counters = new AtlasRendererPerformanceWindow(0, true);
  counters.tick(15_000);
  return counters.report(15_000, true, emptyImages());
}

afterEach(() => vi.unstubAllGlobals());

describe("Atlas renderer performance counters", () => {
  it("reports timer drift and long tasks for the actual window, then resets", () => {
    const counters = new AtlasRendererPerformanceWindow(0, true);
    expect(counters.tick(1_000)).toBe(false);
    counters.observeLongTask(500, 80);
    counters.observeLongTask(1_500, 140);
    expect(counters.tick(2_250)).toBe(false);
    for (let at = 3_250; at < 15_000; at += 1_000) counters.tick(at);
    expect(counters.tick(15_250)).toBe(true);
    expect(counters.report(15_250, true, emptyImages())).toMatchObject({
      windowMs: 15_250, pageAgeMs: 15_250, timerMaxDelayMs: 250,
      longTaskCount: 2, longTaskTotalMs: 220, longTaskMaxMs: 140
    });
    counters.tick(16_250);
    expect(counters.report(16_250, false, emptyImages())).toMatchObject({
      windowMs: 1_000, timerMaxDelayMs: 0, longTaskCount: 0, longTaskTotalMs: 0
    });
  });

  it("discards hidden-window timing and old queued tasks after a visibility reset", () => {
    const counters = new AtlasRendererPerformanceWindow(0, true);
    counters.observeLongTask(10, 200);
    counters.reset(120_000);
    counters.observeLongTask(119_000, 900);
    counters.tick(121_000);
    expect(counters.report(121_000, true, emptyImages())).toMatchObject({
      windowMs: 1_000, pageAgeMs: 121_000, timerMaxDelayMs: 0, longTaskCount: 0
    });
  });

  it("ignores malformed and non-long tasks and bounds extreme durations", () => {
    const counters = new AtlasRendererPerformanceWindow(0, true);
    for (const duration of [NaN, Infinity, -1, 49]) counters.observeLongTask(1, duration);
    counters.observeLongTask(NaN, 100);
    counters.observeLongTask(1, 10_000_000);
    counters.tick(10_000_000);
    const report = counters.report(10_000_000, true, emptyImages());
    expect(report.longTaskCount).toBe(1);
    expect(report.longTaskTotalMs).toBe(3_600_000);
    expect(report.timerMaxDelayMs).toBe(3_600_000);
    expect(validatedAtlasRendererPerformanceSummary(report)).toEqual(report);
  });

  it("distinguishes unsupported long tasks from a supported zero count", () => {
    const counters = new AtlasRendererPerformanceWindow(0, false);
    counters.observeLongTask(1, 500);
    const report = counters.report(15_000, true, emptyImages());
    expect(report).toMatchObject({ longTasksSupported: false, longTaskCount: 0 });
    expect(validatedAtlasRendererPerformanceSummary(report)).toEqual(report);
  });

  it("measures callback gaps and trusted input queueing without reading input contents", () => {
    const counters = new AtlasRendererPerformanceWindow(0, false);
    const origin = 1_800_000_000_000;
    counters.observeAnimationFrame(0);
    counters.observeAnimationFrame(16);
    counters.observeAnimationFrame(1_016);
    const input = { isTrusted: true, timeStamp: 900,
      get target(): never { throw new Error("Input targets must never be read"); },
      get key(): never { throw new Error("Input keys must never be read"); } };
    counters.observeInput(input, 1_000, origin);
    counters.observeInput({ isTrusted: true, timeStamp: origin + 990 }, 1_000, origin);
    counters.observeInput({ isTrusted: false, timeStamp: 0 }, 10_000, origin);
    counters.observeInput({ isTrusted: "true", timeStamp: 0 } as unknown as Event, 10_000, origin);
    const report = counters.report(15_000, true, emptyImages());
    expect(report).toMatchObject({ animationFrameCount: 3, animationFrameMaxGapMs: 1_000,
      inputEventCount: 2, inputEventMaxDelayMs: 100, detailedTimingEnabled: true, windowEnded: false });
    expect(validatedAtlasRendererPerformanceSummary(report)).toEqual(report);
  });

  it("keeps cadence across ordinary reports but resets it across background windows", () => {
    const counters = new AtlasRendererPerformanceWindow(0, false);
    counters.observeAnimationFrame(14_900);
    counters.report(15_000, true, emptyImages());
    counters.observeAnimationFrame(16_000);
    expect(counters.report(16_100, true, emptyImages(), true)).toMatchObject({
      animationFrameCount: 1, animationFrameMaxGapMs: 1_100, windowEnded: true
    });
    counters.observeAnimationFrame(120_000);
    counters.observeAnimationFrame(120_016);
    expect(counters.report(120_020, true, emptyImages())).toMatchObject({
      animationFrameCount: 2, animationFrameMaxGapMs: 16
    });
  });

  it("rejects invalid or reversed animation times and bounds gaps", () => {
    const counters = new AtlasRendererPerformanceWindow(0, false);
    counters.observeAnimationFrame(0);
    for (const time of [NaN, Infinity, -1]) counters.observeAnimationFrame(time);
    counters.observeAnimationFrame(10_000_000);
    counters.observeAnimationFrame(1);
    const report = counters.report(10_000_001, true, emptyImages());
    expect(report).toMatchObject({ animationFrameCount: 2, animationFrameMaxGapMs: 3_600_000 });
    expect(validatedAtlasRendererPerformanceSummary(report)).toEqual(report);
  });
});

describe("Atlas input timestamp normalization", () => {
  const origin = 1_800_000_000_000;
  it("accepts monotonic and same-origin epoch timestamps with submillisecond clock precision", () => {
    expect(atlasInputDispatchDelayMs(600, 900, origin)).toBe(300);
    expect(atlasInputDispatchDelayMs(origin + 600, 900, origin)).toBe(300);
    expect(atlasInputDispatchDelayMs(900.5, 900, origin)).toBe(0);
    expect(atlasInputDispatchDelayMs(0, 10_000_000, origin)).toBe(3_600_000);
  });
  it("rejects future, pre-navigation, malformed and unknown epoch origins", () => {
    for (const stamp of [-1, NaN, Infinity, 902, origin - 1, origin + 902]) {
      expect(atlasInputDispatchDelayMs(stamp, 900, origin)).toBeNull();
    }
    expect(atlasInputDispatchDelayMs(origin + 10, 900, NaN)).toBeNull();
    expect(atlasInputDispatchDelayMs(origin + 10, 900, 0)).toBeNull();
    expect(atlasInputDispatchDelayMs(100, Infinity, origin)).toBeNull();
  });
});

describe("Atlas renderer report rate bounds", () => {
  it("allows short lifecycle flushes without resetting the periodic admission clock", () => {
    const limiter = new AtlasRendererPerformanceReportLimiter();
    expect(limiter.accept(0, false)).toBe(true);
    expect(limiter.accept(200, true)).toBe(false);
    expect(limiter.accept(250, true)).toBe(true);
    expect(limiter.accept(500, true)).toBe(true);
    expect(limiter.accept(1_000, false)).toBe(false);
    expect(limiter.accept(10_000, false)).toBe(true);
  });
  it("caps all reports at ten per rolling minute and rejects invalid clocks", () => {
    const limiter = new AtlasRendererPerformanceReportLimiter();
    for (let index = 0; index < 10; index++) expect(limiter.accept(index * 250, true)).toBe(true);
    expect(limiter.accept(2_500, true)).toBe(false);
    expect(limiter.accept(59_999, true)).toBe(false);
    expect(limiter.accept(60_000, true)).toBe(true);
    for (const time of [NaN, Infinity, -1, 59_000]) expect(limiter.accept(time, true)).toBe(false);
  });
});

describe("bounded Atlas image status sampling", () => {
  it("counts pending and failed images without exporting source values", () => {
    const source = "https://private.invalid/card?token=secret";
    const images = [
      { complete: false, naturalWidth: 0, getAttribute: () => source },
      { complete: true, naturalWidth: 0, getAttribute: () => source },
      { complete: true, naturalWidth: 0, getAttribute: () => null },
      { complete: true, naturalWidth: 300, getAttribute: () => source }
    ];
    expect(countAtlasRendererImages(images)).toEqual({ imageCount: 4, imageSampled: 4,
      pendingImages: 1, failedImages: 1, imageSampleTruncated: false });
    expect(JSON.stringify(countAtlasRendererImages(images))).not.toContain("private");
  });

  it("touches at most 500 images and marks incomplete sampling", () => {
    const image = { complete: true, naturalWidth: 1, getAttribute: () => null };
    const images = Object.assign(Array.from({ length: 500 }, () => image), { length: 501 });
    Object.defineProperty(images, 500, { get: () => { throw new Error("sample exceeded"); } });
    expect(countAtlasRendererImages(images)).toEqual({ imageCount: 501, imageSampled: 500,
      pendingImages: 0, failedImages: 0, imageSampleTruncated: true });
  });
});

describe("Atlas renderer summary IPC validation", () => {
  it("accepts only the fixed schema and makes a fresh payload", () => {
    const value = summary();
    const accepted = validatedAtlasRendererPerformanceSummary(value);
    expect(accepted).toEqual(value);
    expect(accepted).not.toBe(value);
    for (const field of ["url", "token", "text", "frames", "cookie"]) {
      expect(validatedAtlasRendererPerformanceSummary({ ...value, [field]: "secret" })).toBeNull();
    }
    expect(validatedAtlasRendererPerformanceSummary({ ...value, documentVisible: "true" })).toBeNull();
    const { windowMs: _windowMs, ...missing } = value;
    expect(validatedAtlasRendererPerformanceSummary(missing)).toBeNull();
  });

  it.each([NaN, Infinity, -1, 1.25, 3_600_001, "40"])("rejects invalid durations %s", (timerMaxDelayMs) => {
    expect(validatedAtlasRendererPerformanceSummary({ ...summary(), timerMaxDelayMs })).toBeNull();
  });

  it("rejects inconsistent counts, durations and unsupported measurements", () => {
    const value = summary();
    for (const invalid of [
      { imageCount: 1, imageSampled: 2 },
      { imageCount: 2, imageSampled: 2, pendingImages: 2, failedImages: 1 },
      { imageCount: 501, imageSampled: 500, imageSampleTruncated: false },
      { longTaskMaxMs: 100, longTaskTotalMs: 50, longTaskCount: 1 },
      { longTaskTotalMs: 100, longTaskCount: 0 },
      { longTasksSupported: false, longTaskCount: 1 },
      { animationFrameCount: 0, animationFrameMaxGapMs: 100 },
      { inputEventCount: 0, inputEventMaxDelayMs: 100 },
      { detailedTimingEnabled: false, animationFrameCount: 1 },
      { detailedTimingEnabled: false, inputEventCount: 1 },
      { animationFrameMaxGapMs: Infinity }, { inputEventMaxDelayMs: -1 },
      { inputEventCount: 100_001 }, { animationFrameCount: 1.5 },
      { windowEnded: "true" }, { detailedTimingEnabled: 1 },
      { windowMs: 0 }, { windowMs: 20_000, pageAgeMs: 15_000 }
    ]) expect(validatedAtlasRendererPerformanceSummary({ ...value, ...invalid })).toBeNull();
  });
});

describe("Atlas preload monitor lifecycle", () => {
  function environment(origin = "https://play.riftatlas.com") {
    let now = 0;
    let detailed = false;
    const documentEvents = new Map<string, (event?: Event) => void>();
    const windowEvents = new Map<string, (event?: Event) => void>();
    const frames = new Map<number, () => void>();
    let nextFrame = 1;
    let pendingTasks: Array<{ startTime: number; duration: number }> = [];
    let timer: (() => void) | undefined;
    const disconnect = vi.fn();
    const takeRecords = vi.fn(() => { const tasks = pendingTasks; pendingTasks = []; return tasks; });
    const send = vi.fn();
    const setInterval = vi.fn((callback: () => void) => { timer = callback; return 7; });
    const clearInterval = vi.fn();
    const requestAnimationFrame = vi.fn((callback: () => void) => {
      const id = nextFrame++; frames.set(id, callback); return id;
    });
    const cancelAnimationFrame = vi.fn((id: number) => frames.delete(id));
    const addWindowListener = vi.fn((key: string, callback: (event?: Event) => void) => windowEvents.set(key, callback));
    vi.stubGlobal("location", { origin });
    vi.stubGlobal("performance", { now: () => now, timeOrigin: 1_800_000_000_000 });
    vi.stubGlobal("PerformanceObserver", class {
      static supportedEntryTypes = ["longtask"];
      observe = vi.fn(); disconnect = disconnect; takeRecords = takeRecords;
    });
    vi.stubGlobal("document", { images: [], visibilityState: "visible",
      addEventListener: (key: string, callback: () => void) => documentEvents.set(key, callback),
      removeEventListener: (key: string) => documentEvents.delete(key) });
    vi.stubGlobal("window", { setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame,
      addEventListener: addWindowListener,
      removeEventListener: (key: string) => windowEvents.delete(key) });
    return { send, setInterval, clearInterval, disconnect, takeRecords, requestAnimationFrame, cancelAnimationFrame, addWindowListener,
      detailedEnabled: () => detailed,
      enable(value: boolean) { detailed = value; },
      tick(at: number) { now = at; timer?.(); },
      visibility(at: number, state: "visible" | "hidden") {
        now = at; Object.assign(document, { visibilityState: state }); documentEvents.get("visibilitychange")?.();
      },
      frame(at: number) { now = at; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback()); },
      input(at: number, event: Pick<Event, "isTrusted" | "timeStamp">, type = "pointerdown") {
        now = at; windowEvents.get(type)?.(event as Event);
      },
      focus(at: number) { now = at; windowEvents.get("focus")?.(); },
      task(startTime: number, duration: number) { pendingTasks.push({ startTime, duration }); },
      pagehide(at = now) { now = at; windowEvents.get("pagehide")?.(); } };
  }

  it("uses one 1s timer, reports at 15s, and cleans up at pagehide", () => {
    const f = environment();
    installAtlasRendererPerformanceMonitor(f.send);
    expect(f.setInterval).toHaveBeenCalledWith(expect.any(Function), 1_000);
    for (let i = 1; i < 15; i++) f.tick(i * 1_000);
    expect(f.send).not.toHaveBeenCalled();
    f.tick(15_000);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(validatedAtlasRendererPerformanceSummary(f.send.mock.calls[0][0])).not.toBeNull();
    f.pagehide();
    expect(f.clearInterval).toHaveBeenCalledWith(7);
    expect(f.disconnect).toHaveBeenCalledOnce();
  });

  it("flushes each visibility window and queued long tasks before resetting", () => {
    const f = environment();
    f.enable(true);
    installAtlasRendererPerformanceMonitor(f.send, f.detailedEnabled);
    f.frame(20);
    f.frame(100);
    f.tick(1_000);
    f.task(1_500, 200);
    f.visibility(2_000, "hidden");
    expect(f.send.mock.calls[0][0]).toMatchObject({ windowMs: 2_000, documentVisible: true,
      windowEnded: true, longTaskCount: 1, longTaskTotalMs: 200, animationFrameMaxGapMs: 80 });
    const requestsBeforeHidden = f.requestAnimationFrame.mock.calls.length;
    f.frame(110_000);
    expect(f.requestAnimationFrame).toHaveBeenCalledTimes(requestsBeforeHidden);
    f.visibility(120_000, "visible");
    expect(f.send.mock.calls[1][0]).toMatchObject({ windowMs: 118_000, documentVisible: false, animationFrameCount: 0 });
    f.frame(120_020);
    f.frame(120_036);
    for (let i = 1; i <= 15; i++) f.tick(120_000 + i * 1_000);
    expect(f.send.mock.calls[2][0]).toMatchObject({ windowMs: 15_000, pageAgeMs: 135_000,
      timerMaxDelayMs: 0, animationFrameMaxGapMs: 16, documentVisible: true, windowEnded: false });
    expect(f.send.mock.calls.every(([value]) => validatedAtlasRendererPerformanceSummary(value))).toBe(true);
  });

  it("adds no animation loop or input listeners until diagnostics are enabled and stops on disabling", () => {
    const f = environment();
    installAtlasRendererPerformanceMonitor(f.send, f.detailedEnabled);
    expect(f.requestAnimationFrame).not.toHaveBeenCalled();
    expect(f.addWindowListener.mock.calls.some(([name]) => name === "pointerdown")).toBe(false);
    f.enable(true); f.tick(1_000);
    expect(f.addWindowListener).toHaveBeenCalledWith("pointerdown", expect.any(Function), { capture: true, passive: true });
    expect(f.addWindowListener).toHaveBeenCalledWith("keydown", expect.any(Function), { capture: true, passive: true });
    f.frame(1_016);
    f.input(1_500, { isTrusted: false, timeStamp: 0 });
    f.input(1_600, { isTrusted: true, timeStamp: 1_300 }, "keydown");
    f.focus(1_700); // Ordinary focus does not erase the queued-input evidence.
    f.enable(false); f.frame(1_800);
    f.input(2_000, { isTrusted: true, timeStamp: 0 });
    f.pagehide(2_500);
    expect(f.send.mock.calls[0][0]).toMatchObject({ inputEventCount: 1, inputEventMaxDelayMs: 300,
      animationFrameCount: 1, detailedTimingEnabled: true, windowEnded: true });
    expect(f.clearInterval).toHaveBeenCalledWith(7);
    expect(f.disconnect).toHaveBeenCalledOnce();
  });

  it("flushes on pagehide and cleans up even if reporting fails", () => {
    const f = environment();
    f.enable(true);
    f.send.mockImplementation(() => { throw new Error("closing IPC"); });
    installAtlasRendererPerformanceMonitor(f.send, f.detailedEnabled);
    f.frame(20);
    f.task(1_000, 500);
    expect(() => f.pagehide(2_000)).not.toThrow();
    expect(f.send.mock.calls[0][0]).toMatchObject({ windowEnded: true, longTaskTotalMs: 500 });
    expect(f.cancelAnimationFrame).toHaveBeenCalled();
    f.tick(15_000);
    f.frame(15_016);
    f.input(16_000, { isTrusted: true, timeStamp: 0 });
    f.pagehide(17_000);
    expect(f.send).toHaveBeenCalledOnce();
  });

  it("rejects foreign clocks and never samples trusted input while hidden", () => {
    const f = environment();
    f.enable(true);
    installAtlasRendererPerformanceMonitor(f.send, f.detailedEnabled);
    f.input(100, { isTrusted: true, timeStamp: 1_700_000_000_100 });
    f.input(200, { isTrusted: true, timeStamp: 300 });
    f.visibility(1_000, "hidden");
    f.input(2_000, { isTrusted: true, timeStamp: 0 });
    f.pagehide(3_000);
    expect(f.send.mock.calls.every(([value]) => value.inputEventCount === 0)).toBe(true);
  });

  it.each(["https://accounts.google.com", "https://play.riftatlas.com:444", "https://play.riftatlas.com.evil.invalid"])("does not install on %s", (origin) => {
    const f = environment(origin);
    installAtlasRendererPerformanceMonitor(f.send);
    expect(f.setInterval).not.toHaveBeenCalled();
  });
});
