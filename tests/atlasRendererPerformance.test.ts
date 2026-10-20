import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AtlasRendererPerformanceWindow,
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
      { windowMs: 0 }, { windowMs: 20_000, pageAgeMs: 15_000 }
    ]) expect(validatedAtlasRendererPerformanceSummary({ ...value, ...invalid })).toBeNull();
  });
});

describe("Atlas preload monitor lifecycle", () => {
  function environment(origin = "https://play.riftatlas.com") {
    let now = 0;
    const documentEvents = new Map<string, () => void>();
    const windowEvents = new Map<string, () => void>();
    let timer: (() => void) | undefined;
    const disconnect = vi.fn();
    const takeRecords = vi.fn(() => []);
    const send = vi.fn();
    const setInterval = vi.fn((callback: () => void) => { timer = callback; return 7; });
    const clearInterval = vi.fn();
    vi.stubGlobal("location", { origin });
    vi.stubGlobal("performance", { now: () => now });
    vi.stubGlobal("PerformanceObserver", class {
      static supportedEntryTypes = ["longtask"];
      observe = vi.fn(); disconnect = disconnect; takeRecords = takeRecords;
    });
    vi.stubGlobal("document", { images: [], visibilityState: "visible",
      addEventListener: (key: string, callback: () => void) => documentEvents.set(key, callback),
      removeEventListener: (key: string) => documentEvents.delete(key) });
    vi.stubGlobal("window", { setInterval, clearInterval,
      addEventListener: (key: string, callback: () => void) => windowEvents.set(key, callback) });
    return { send, setInterval, clearInterval, disconnect, takeRecords,
      tick(at: number) { now = at; timer?.(); },
      visibility(at: number) { now = at; documentEvents.get("visibilitychange")?.(); },
      pagehide() { windowEvents.get("pagehide")?.(); } };
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

  it("restarts its interval after visibility changes without counting the hidden delay", () => {
    const f = environment();
    installAtlasRendererPerformanceMonitor(f.send);
    f.tick(1_000);
    f.visibility(120_000);
    for (let i = 1; i <= 15; i++) f.tick(120_000 + i * 1_000);
    expect(f.takeRecords).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0][0]).toMatchObject({ windowMs: 15_000, pageAgeMs: 135_000, timerMaxDelayMs: 0 });
  });

  it.each(["https://accounts.google.com", "https://play.riftatlas.com:444", "https://play.riftatlas.com.evil.invalid"])("does not install on %s", (origin) => {
    const f = environment(origin);
    installAtlasRendererPerformanceMonitor(f.send);
    expect(f.setInterval).not.toHaveBeenCalled();
  });
});
