const MAX_DELAY_MS = 10 * 60_000;
const CLOCK_TOLERANCE_MS = 1_000;

interface ClockAnchor {
  sourceMs: number;
  sourceWallMs: number;
  receiptMonoMs: number;
  receiptWallMs: number;
}

export interface AtlasObserverTimingSample {
  epoch: number;
  sourceMs: number;
  deliveryLagMs: number;
}

/** CDP timestamp/receipt correlation only: no event content or identifiers retained. */
export class AtlasObserverTiming {
  private anchor: ClockAnchor | null = null;
  private epoch = 0;

  constructor(private readonly monotonicNow: () => number = () => performance.now()) {}

  observe(payload: Record<string, unknown>, receiptWallMs: number): AtlasObserverTimingSample | null {
    const sourceMs = secondsToMs(payload.timestamp);
    const sourceWallMs = secondsToMs(payload.wallTime);
    const receiptMonoMs = this.monotonicNow();
    if (sourceMs === null || !safeTime(receiptMonoMs) || !safeTime(receiptWallMs)) return null;

    if (sourceWallMs !== null) {
      if (sourceWallMs - receiptWallMs > CLOCK_TOLERANCE_MS
        || receiptWallMs - sourceWallMs > MAX_DELAY_MS) return null;
      const previous = this.anchor;
      // Both wall clocks may jump together. Only a disagreement between their
      // monotonic deltas invalidates the anchor (e.g. a restarted CDP target).
      const sourceClockJump = previous
        ? sourceWallMs - previous.sourceWallMs - (sourceMs - previous.sourceMs) : 0;
      const receiptClockJump = previous
        ? receiptWallMs - previous.receiptWallMs - (receiptMonoMs - previous.receiptMonoMs) : 0;
      if (!previous || Math.abs(sourceClockJump - receiptClockJump) > CLOCK_TOLERANCE_MS
        || receiptMonoMs < previous.receiptMonoMs) {
        this.anchor = { sourceMs, sourceWallMs, receiptMonoMs, receiptWallMs };
        this.epoch++;
      }
    }

    const anchor = this.anchor;
    if (!anchor || receiptMonoMs < anchor.receiptMonoMs) return null;
    const lag = anchor.receiptWallMs - anchor.sourceWallMs
      + receiptMonoMs - anchor.receiptMonoMs - (sourceMs - anchor.sourceMs);
    if (!Number.isFinite(lag) || lag < -CLOCK_TOLERANCE_MS || lag > MAX_DELAY_MS) return null;
    return { epoch: this.epoch, sourceMs, deliveryLagMs: Math.max(0, Math.round(lag)) };
  }

  clear(): void {
    this.anchor = null;
    this.epoch = 0;
  }
}

function safeTime(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function secondsToMs(value: unknown): number | null {
  return typeof value === "number" && safeTime(value) && safeTime(value * 1_000)
    ? value * 1_000 : null;
}
