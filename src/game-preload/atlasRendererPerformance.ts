import {
  ATLAS_RENDERER_PERFORMANCE_TICK_MS,
  AtlasRendererPerformanceWindow,
  countAtlasRendererImages,
  type AtlasRendererPerformanceSummary
} from "../shared/atlasRendererPerformance.js";

/** Passive local health metrics. Does not inspect requests, text, forms or credentials. */
export function installAtlasRendererPerformanceMonitor(
  send: (summary: AtlasRendererPerformanceSummary) => void,
  detailedEnabled: () => boolean = () => false
): void {
  if (location.origin !== "https://play.riftatlas.com") return;
  let observer: PerformanceObserver | undefined;
  let counters: AtlasRendererPerformanceWindow;
  let visible = document.visibilityState === "visible";
  let stopped = false;
  let detailedActive = false;
  let animationFrame: number | undefined;
  const detailedRequested = () => {
    try { return detailedEnabled() === true; } catch { return false; }
  };
  const input = (event: Event) => {
    if (!detailedActive || !visible || document.visibilityState !== "visible" || !detailedRequested()) return;
    // Only timestamp/trust metadata is read. Never inspect a key, target, text, pointer position or value.
    counters.observeInput(event, performance.now(), performance.timeOrigin);
  };
  const stopDetailed = () => {
    if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
    if (detailedActive) {
      window.removeEventListener("pointerdown", input, true);
      window.removeEventListener("keydown", input, true);
    }
    detailedActive = false;
    counters.resetAnimationFrameClock();
  };
  const frame = () => {
    animationFrame = undefined;
    if (stopped || !visible || document.visibilityState !== "visible" || !detailedRequested()) {
      stopDetailed();
      return;
    }
    // This is JS animation-callback cadence, not GPU frame presentation or network timing.
    counters.observeAnimationFrame(performance.now());
    animationFrame = window.requestAnimationFrame(frame);
  };
  const syncDetailed = () => {
    if (stopped || !visible || !detailedRequested()) {
      if (detailedActive) stopDetailed();
      return;
    }
    counters.markDetailedTimingEnabled();
    if (detailedActive) return;
    detailedActive = true;
    window.addEventListener("pointerdown", input, { capture: true, passive: true });
    window.addEventListener("keydown", input, { capture: true, passive: true });
    animationFrame = window.requestAnimationFrame(frame);
  };
  try {
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) counters.observeLongTask(entry.startTime, entry.duration);
      });
      observer.observe({ type: "longtask" });
    }
  } catch {
    observer?.disconnect();
    observer = undefined;
  }
  counters = new AtlasRendererPerformanceWindow(performance.now(), Boolean(observer));
  const flush = (now: number, windowEnded: boolean) => {
    for (const entry of observer?.takeRecords() ?? []) counters.observeLongTask(entry.startTime, entry.duration);
    counters.tick(now);
    const summary = counters.report(now, visible, countAtlasRendererImages(document.images), windowEnded);
    if (!summary.windowMs) return;
    try { send(summary); } catch {
      // An unavailable main process or closing document must never affect play.
    }
  };
  const visibilityChanged = () => {
    if (stopped) return;
    const nextVisible = document.visibilityState === "visible";
    if (nextVisible === visible) return;
    // Preserve the completed window, including queued long tasks, before discarding the hidden gap.
    flush(performance.now(), true);
    stopDetailed();
    visible = nextVisible;
    syncDetailed();
  };
  document.addEventListener("visibilitychange", visibilityChanged);
  syncDetailed();
  const timer = window.setInterval(() => {
    if (stopped) return;
    syncDetailed();
    const now = performance.now();
    if (!counters.tick(now)) return;
    flush(now, false);
  }, ATLAS_RENDERER_PERFORMANCE_TICK_MS);
  window.addEventListener("pagehide", () => {
    if (stopped) return;
    flush(performance.now(), true);
    stopped = true;
    stopDetailed();
    window.clearInterval(timer);
    observer?.disconnect();
    document.removeEventListener("visibilitychange", visibilityChanged);
  }, { once: true });
}
