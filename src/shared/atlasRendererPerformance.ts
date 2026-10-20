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
}

const NUMERIC_LIMITS = {
  windowMs: MAX_WINDOW_MS,
  pageAgeMs: MAX_PAGE_AGE_MS,
  timerMaxDelayMs: MAX_DURATION_MS,
  longTaskCount: MAX_COUNT,
  longTaskTotalMs: MAX_DURATION_MS,
  longTaskMaxMs: MAX_DURATION_MS,
  imageCount: MAX_COUNT,
  imageSampled: ATLAS_RENDERER_IMAGE_SAMPLE_LIMIT,
  pendingImages: ATLAS_RENDERER_IMAGE_SAMPLE_LIMIT,
  failedImages: ATLAS_RENDERER_IMAGE_SAMPLE_LIMIT
} as const;
const BOOLEAN_KEYS = ["documentVisible", "longTasksSupported", "imageSampleTruncated"] as const;
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
    (!summary.longTasksSupported && (summary.longTaskCount || summary.longTaskTotalMs || summary.longTaskMaxMs))) return null;
  return {
    windowMs: summary.windowMs, pageAgeMs: summary.pageAgeMs,
    documentVisible: summary.documentVisible, timerMaxDelayMs: summary.timerMaxDelayMs,
    longTasksSupported: summary.longTasksSupported, longTaskCount: summary.longTaskCount,
    longTaskTotalMs: summary.longTaskTotalMs, longTaskMaxMs: summary.longTaskMaxMs,
    imageCount: summary.imageCount, imageSampled: summary.imageSampled,
    pendingImages: summary.pendingImages, failedImages: summary.failedImages,
    imageSampleTruncated: summary.imageSampleTruncated
  };
}

function bounded(value: number, maximum: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.round(value))) : 0;
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

  constructor(startedAt: number, private readonly longTasksSupported: boolean) {
    this.startedAt = startedAt;
    this.previousTickAt = startedAt;
  }

  reset(now: number): void {
    this.startedAt = now;
    this.previousTickAt = now;
    this.timerMaxDelayMs = 0;
    this.longTaskCount = 0;
    this.longTaskTotalMs = 0;
    this.longTaskMaxMs = 0;
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

  report(now: number, documentVisible: boolean, images: AtlasRendererImageCounts): AtlasRendererPerformanceSummary {
    const summary = {
      windowMs: bounded(now - this.startedAt, MAX_WINDOW_MS),
      pageAgeMs: bounded(now, MAX_PAGE_AGE_MS),
      documentVisible, timerMaxDelayMs: this.timerMaxDelayMs,
      longTasksSupported: this.longTasksSupported, longTaskCount: this.longTaskCount,
      longTaskTotalMs: this.longTaskTotalMs, longTaskMaxMs: this.longTaskMaxMs,
      ...images
    };
    this.reset(now);
    return summary;
  }
}
