export const RAW_CAPTURE_LOSS_MAX_FRAMES = 1_000_000;
export const RAW_CAPTURE_LOSS_REASONS = [
  "ingress-rate-limit", "ingress-frame-too-large", "ingress-invalid-frame", "capture-buffer-limit"
] as const;
export type RawCaptureLossReason = typeof RAW_CAPTURE_LOSS_REASONS[number];
export interface RawCaptureLoss {
  version: 1;
  reasons: RawCaptureLossReason[];
  /** Saturating count; after interruption the journal may retain a lower bound. */
  droppedFrames: number;
  firstAt: number;
  lastAt: number;
}
export interface RawCaptureIngressLoss {
  requestUrl: string;
  socketId: string;
  loss: RawCaptureLoss;
}

/** The existing recorder excludes these packets from gameplay history. */
export function isDiscardedRawCapturePresence(raw: string): boolean {
  if (raw.length > 8192) return false;
  try {
    const body = JSON.parse(raw) as { type?: unknown } | null;
    return Boolean(body && !Array.isArray(body) && body.type === "presence_update");
  } catch { return false; }
}

/** Separate from the frame budget: a diagnostic must not consume gameplay slots. */
export class RawCaptureLossNoticeLimiter {
  private readonly windows = new Map<number, { at: number; count: number }>();
  allow(senderId: number, now = Date.now()): boolean {
    const previous = this.windows.get(senderId);
    const current = !previous || now - previous.at >= 10_000 ? { at: now, count: 0 } : previous;
    if (current.count >= 32) return false;
    current.count++;
    this.windows.set(senderId, current);
    return true;
  }
  forget(senderId: number): void { this.windows.delete(senderId); }
}

export function normalizedRawCaptureLoss(value: unknown): RawCaptureLoss | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const loss = value as RawCaptureLoss;
  if (loss.version !== 1 || !Array.isArray(loss.reasons) || !loss.reasons.length || loss.reasons.length > RAW_CAPTURE_LOSS_REASONS.length ||
    loss.reasons.some((reason) => !RAW_CAPTURE_LOSS_REASONS.includes(reason)) ||
    !Number.isSafeInteger(loss.droppedFrames) || loss.droppedFrames < 1 || loss.droppedFrames > RAW_CAPTURE_LOSS_MAX_FRAMES ||
    !Number.isSafeInteger(loss.firstAt) || !Number.isSafeInteger(loss.lastAt) ||
    loss.firstAt < 0 || loss.lastAt < loss.firstAt || loss.lastAt > 8_640_000_000_000_000) return undefined;
  return { version: 1, reasons: [...new Set(loss.reasons)], droppedFrames: loss.droppedFrames,
    firstAt: loss.firstAt, lastAt: loss.lastAt };
}

export function mergeRawCaptureLoss(left: RawCaptureLoss | undefined, right: RawCaptureLoss): RawCaptureLoss {
  return {
    version: 1,
    reasons: [...new Set([...(left?.reasons ?? []), ...right.reasons])],
    droppedFrames: Math.min(RAW_CAPTURE_LOSS_MAX_FRAMES, (left?.droppedFrames ?? 0) + right.droppedFrames),
    firstAt: Math.min(left?.firstAt ?? right.firstAt, right.firstAt),
    lastAt: Math.max(left?.lastAt ?? right.lastAt, right.lastAt)
  };
}
