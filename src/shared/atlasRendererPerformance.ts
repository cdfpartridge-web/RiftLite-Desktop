export const ATLAS_RENDERER_PERFORMANCE_IPC_CHANNEL = "game-webview:atlas-renderer-performance";
export const ATLAS_RENDERER_PERFORMANCE_INTERVAL_MS = 15_000;
export const ATLAS_RENDERER_PERFORMANCE_TICK_MS = 1_000;
export const ATLAS_RENDERER_IMAGE_SAMPLE_LIMIT = 500;

const MAX_DURATION_MS = 3_600_000;
const MAX_WINDOW_MS = 86_400_000;
const MAX_PAGE_AGE_MS = 7 * MAX_WINDOW_MS;
const MAX_COUNT = 100_000;

export interface AtlasRendererImageCounts {
  imageCount: number;
  imageSampled: number;
  pendingImages: number;
  failedImages: number;
  imageSampleTruncated: boolean;
}

export interface AtlasRendererPerformanceSummary extends AtlasRendererImageCounts {
  windowMs: number;
  pageAgeMs: number;
  documentVisible: boolean;
  timerMaxDelayMs: number;
  longTasksSupported: boolean;
  longTaskCount: number;
  longTaskTotalMs: number;
  longTaskMaxMs: number;
  /** Callback cadence only: does not measure GPU presentation or wire latency. */
  animationFrameCount: number;
  animationFrameMaxGapMs: number;
  /** Browser event timestamp to this preload listener; not physical input-to-display latency. */
  inputEventCount: number;
  inputEventMaxDelayMs: number;
  detailedTimingEnabled: boolean;
  /** The visible/hidden window ended because of a lifecycle transition. */
  windowEnded: boolean;
}

const NUMERIC_LIMITS = {
  windowMs: MAX_WINDOW_MS,
  pageAgeMs: MAX_PAGE_AGE_MS,
  timerMaxDelayMs: MAX_DURATION_MS,
  longTaskCount: MAX_COUNT,
  longTaskTotalMs: MAX_DURATION_MS,
  longTaskMaxMs: MAX_DURATION_MS,
  animationFrameCount: MAX_COUNT,
  animationFrameMaxGapMs: MAX_DURATION_MS,
  inputEventCount: MAX_COUNT,
  inputEventMaxDelayMs: MAX_DURATION_MS,
  imageCount: MAX_COUNT,
  imageSampled: ATLAS_RENDERER_IMAGE_SAMPLE_LIMIT,
  pendingImages: ATLAS_RENDERER_IMAGE_SAMPLE_LIMIT,
  failedImages: ATLAS_RENDERER_IMAGE_SAMPLE_LIMIT
} as const;
const BOOLEAN_KEYS = ["documentVisible", "longTasksSupported", "imageSampleTruncated", "detailedTimingEnabled", "windowEnded"] as const;
const KEYS = [...Object.keys(NUMERIC_LIMITS), ...BOOLEAN_KEYS].sort();

/** Exact numeric/boolean allowlist: no page content or network identifiers cross IPC. */
export function validatedAtlasRendererPerformanceSummary(value: unknown): AtlasRendererPerformanceSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== KEYS.length || keys.some((key, index) => key !== KEYS[index])) return null;
  for (const [key, maximum] of Object.entries(NUMERIC_LIMITS)) {
    const field = record[key];
    if (typeof field !== "number" || !Number.isInteger(field) || field < 0 || field > maximum) return null;
  }
  if (BOOLEAN_KEYS.some((key) => typeof record[key] !== "boolean")) return null;
  const summary = record as unknown as AtlasRendererPerformanceSummary;
  if (!summary.windowMs || summary.pageAgeMs < summary.windowMs ||
    summary.imageSampled > summary.imageCount ||
    summary.pendingImages + summary.failedImages > summary.imageSampled ||
    summary.imageSampleTruncated !== (summary.imageCount > summary.imageSampled) ||
    summary.longTaskMaxMs > summary.longTaskTotalMs ||
    (!summary.longTaskCount && (summary.longTaskTotalMs || summary.longTaskMaxMs)) ||
    (!summary.animationFrameCount && summary.animationFrameMaxGapMs) ||
    (!summary.inputEventCount && summary.inputEventMaxDelayMs) ||
    (!summary.detailedTimingEnabled && (summary.animationFrameCount || summary.inputEventCount)) ||
    (!summary.longTasksSupported && (summary.longTaskCount || summary.longTaskTotalMs || summary.longTaskMaxMs))) return null;
  return {
    windowMs: summary.windowMs, pageAgeMs: summary.pageAgeMs,
    documentVisible: summary.documentVisible, timerMaxDelayMs: summary.timerMaxDelayMs,
    longTasksSupported: summary.longTasksSupported, longTaskCount: summary.longTaskCount,
    longTaskTotalMs: summary.longTaskTotalMs, longTaskMaxMs: summary.longTaskMaxMs,
    animationFrameCount: summary.animationFrameCount, animationFrameMaxGapMs: summary.animationFrameMaxGapMs,
    inputEventCount: summary.inputEventCount, inputEventMaxDelayMs: summary.inputEventMaxDelayMs,
    detailedTimingEnabled: summary.detailedTimingEnabled, windowEnded: summary.windowEnded,
    imageCount: summary.imageCount, imageSampled: summary.imageSampled,
    pendingImages: summary.pendingImages, failedImages: summary.failedImages,
    imageSampleTruncated: summary.imageSampleTruncated
  };
}

function bounded(value: number, maximum: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.round(value))) : 0;
}

/** Accept this document's monotonic timestamps or epoch timestamps with its exact time origin. */
export function atlasInputDispatchDelayMs(timeStamp: number, now: number, timeOrigin: number): number | null {
  if (!Number.isFinite(timeStamp) || timeStamp < 0 || !Number.isFinite(now) || now < 0) return null;
  let relative = timeStamp;
  if (relative > now + 1) {
    if (!Number.isFinite(timeOrigin) || timeOrigin < 1_000_000_000_000 || timeStamp < timeOrigin) return null;
    relative = timeStamp - timeOrigin;
  }
  // A tiny clock-precision difference is harmless; a future or pre-navigation input is not evidence.
  if (relative < 0 || relative > now + 1) return null;
  return bounded(now - relative, MAX_DURATION_MS);
}

/** Bound lifecycle flushes without discarding all short windows behind the interval throttle. */
export class AtlasRendererPerformanceReportLimiter {
  private acceptedAt: number[] = [];
  private lastPeriodicAt = Number.NEGATIVE_INFINITY;

  accept(now: number, windowEnded: boolean): boolean {
    if (!Number.isFinite(now) || now < 0) return false;
    const last = this.acceptedAt.at(-1);
    if (last !== undefined && now - last < 250) return false;
    this.acceptedAt = this.acceptedAt.filter((at) => now - at < 60_000);
    if (this.acceptedAt.length >= 10 || (!windowEnded && now - this.lastPeriodicAt < 10_000)) return false;
    this.acceptedAt.push(now);
    if (!windowEnded) this.lastPeriodicAt = now;
    return true;
  }
}

/** Inspect only bounded image status properties; never copy a source URL into a summary. */
export function countAtlasRendererImages(
  images: ArrayLike<Pick<HTMLImageElement, "complete" | "naturalWidth" | "getAttribute">>
): AtlasRendererImageCounts {
  const imageCount = bounded(images.length, MAX_COUNT);
  const imageSampled = Math.min(imageCount, ATLAS_RENDERER_IMAGE_SAMPLE_LIMIT);
  let pendingImages = 0;
  let failedImages = 0;
  for (let index = 0; index < imageSampled; index += 1) {
    const image = images[index];
    if (!image.complete) pendingImages += 1;
    else if (image.naturalWidth === 0 && Boolean(image.getAttribute("src") || image.getAttribute("srcset"))) failedImages += 1;
  }
  return { imageCount, imageSampled, pendingImages, failedImages, imageSampleTruncated: imageCount > imageSampled };
}

/** Constant memory counters, reset after each report and whenever visibility changes. */
export class AtlasRendererPerformanceWindow {
  private startedAt: number;
  private previousTickAt: number;
  private timerMaxDelayMs = 0;
  private longTaskCount = 0;
  private longTaskTotalMs = 0;
  private longTaskMaxMs = 0;
  private previousAnimationFrameAt: number | undefined;
  private animationFrameCount = 0;
  private animationFrameMaxGapMs = 0;
  private inputEventCount = 0;
  private inputEventMaxDelayMs = 0;
  private detailedTimingEnabled = false;

  constructor(startedAt: number, private readonly longTasksSupported: boolean) {
    this.startedAt = startedAt;
    this.previousTickAt = startedAt;
  }

  reset(now: number, resetFrameClock = true): void {
    this.startedAt = now;
    this.previousTickAt = now;
    this.timerMaxDelayMs = 0;
    this.longTaskCount = 0;
    this.longTaskTotalMs = 0;
    this.longTaskMaxMs = 0;
    if (resetFrameClock) this.previousAnimationFrameAt = undefined;
    this.animationFrameCount = 0;
    this.animationFrameMaxGapMs = 0;
    this.inputEventCount = 0;
    this.inputEventMaxDelayMs = 0;
    this.detailedTimingEnabled = false;
  }

  markDetailedTimingEnabled(): void {
    this.detailedTimingEnabled = true;
  }

  resetAnimationFrameClock(): void {
    this.previousAnimationFrameAt = undefined;
  }

  observeAnimationFrame(now: number): void {
    if (!Number.isFinite(now) || now < 0 ||
      (this.previousAnimationFrameAt !== undefined && now < this.previousAnimationFrameAt)) return;
    this.markDetailedTimingEnabled();
    this.animationFrameCount = Math.min(MAX_COUNT, this.animationFrameCount + 1);
    if (this.previousAnimationFrameAt !== undefined) {
      this.animationFrameMaxGapMs = Math.max(this.animationFrameMaxGapMs,
        bounded(now - this.previousAnimationFrameAt, MAX_DURATION_MS));
    }
    this.previousAnimationFrameAt = now;
  }

  observeInput(event: Pick<Event, "isTrusted" | "timeStamp">, now: number, timeOrigin: number): void {
    if (event.isTrusted !== true) return;
    const delay = atlasInputDispatchDelayMs(event.timeStamp, now, timeOrigin);
    if (delay === null) return;
    this.markDetailedTimingEnabled();
    this.inputEventCount = Math.min(MAX_COUNT, this.inputEventCount + 1);
    this.inputEventMaxDelayMs = Math.max(this.inputEventMaxDelayMs, delay);
  }

  observeLongTask(startTime: number, duration: number): void {
    if (!this.longTasksSupported || !Number.isFinite(startTime) || startTime < this.startedAt ||
      !Number.isFinite(duration) || duration < 50) return;
    const durationMs = bounded(duration, MAX_DURATION_MS);
    this.longTaskCount = Math.min(MAX_COUNT, this.longTaskCount + 1);
    this.longTaskTotalMs = Math.min(MAX_DURATION_MS, this.longTaskTotalMs + durationMs);
    this.longTaskMaxMs = Math.max(this.longTaskMaxMs, durationMs);
  }

  tick(now: number): boolean {
    if (!Number.isFinite(now) || now < this.previousTickAt) return false;
    this.timerMaxDelayMs = Math.max(this.timerMaxDelayMs,
      bounded(now - this.previousTickAt - ATLAS_RENDERER_PERFORMANCE_TICK_MS, MAX_DURATION_MS));
    this.previousTickAt = now;
    return now - this.startedAt >= ATLAS_RENDERER_PERFORMANCE_INTERVAL_MS;
  }

  report(now: number, documentVisible: boolean, images: AtlasRendererImageCounts, windowEnded = false): AtlasRendererPerformanceSummary {
    const summary = {
      windowMs: bounded(now - this.startedAt, MAX_WINDOW_MS),
      pageAgeMs: bounded(now, MAX_PAGE_AGE_MS),
      documentVisible, timerMaxDelayMs: this.timerMaxDelayMs,
      longTasksSupported: this.longTasksSupported, longTaskCount: this.longTaskCount,
      longTaskTotalMs: this.longTaskTotalMs, longTaskMaxMs: this.longTaskMaxMs,
      animationFrameCount: this.animationFrameCount, animationFrameMaxGapMs: this.animationFrameMaxGapMs,
      inputEventCount: this.inputEventCount, inputEventMaxDelayMs: this.inputEventMaxDelayMs,
      detailedTimingEnabled: this.detailedTimingEnabled, windowEnded,
      ...images
    };
    this.reset(now, windowEnded);
    return summary;
  }
}
