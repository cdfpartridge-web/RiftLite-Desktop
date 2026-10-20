import {
  ATLAS_RENDERER_PERFORMANCE_TICK_MS,
  AtlasRendererPerformanceWindow,
  countAtlasRendererImages,
  type AtlasRendererPerformanceSummary
} from "../shared/atlasRendererPerformance.js";

/** Passive local health metrics. Does not inspect requests, text, forms or credentials. */
export function installAtlasRendererPerformanceMonitor(
  send: (summary: AtlasRendererPerformanceSummary) => void
): void {
  if (location.origin !== "https://play.riftatlas.com") return;
  let observer: PerformanceObserver | undefined;
  let counters: AtlasRendererPerformanceWindow;
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
  const reset = () => {
    observer?.takeRecords();
    counters.reset(performance.now());
  };
  document.addEventListener("visibilitychange", reset);
  const timer = window.setInterval(() => {
    const now = performance.now();
    if (!counters.tick(now)) return;
    try {
      send(counters.report(now, document.visibilityState === "visible", countAtlasRendererImages(document.images)));
    } catch {
      // An unavailable main process or closing document must never affect play.
      counters.reset(now);
    }
  }, ATLAS_RENDERER_PERFORMANCE_TICK_MS);
  window.addEventListener("pagehide", () => {
    window.clearInterval(timer);
    observer?.disconnect();
    document.removeEventListener("visibilitychange", reset);
  }, { once: true });
}
