import { createHash } from "node:crypto";
import type { RawCaptureAppendFramePayload } from "../../shared/types.js";

export type AtlasFrameSource = "game-preload" | "main-debugger";

interface SeenAtlasFrame {
  source: AtlasFrameSource;
  seenAt: number;
}

export class AtlasFrameDeduper {
  private readonly recentFrames = new Map<string, SeenAtlasFrame>();
  private readonly lastPreloadAtByStream = new Map<string, number>();
  private checks = 0;

  constructor(
    private readonly crossSourceWindowMs = 2_000,
    private readonly debuggerFallbackAfterMs = 15_000
  ) {}

  shouldIngest(
    source: AtlasFrameSource,
    streamKey: string,
    payload: RawCaptureAppendFramePayload,
    now = Date.now()
  ): boolean {
    const stableStreamKey = streamKey || "atlas";
    const fingerprint = atlasFrameFingerprint(stableStreamKey, payload);

    if (source === "game-preload") {
      this.lastPreloadAtByStream.set(stableStreamKey, now);
    } else {
      const lastPreloadAt = this.lastPreloadAtByStream.get(stableStreamKey) ?? 0;
      if (lastPreloadAt > 0 && now - lastPreloadAt <= this.debuggerFallbackAfterMs) {
        this.prune(now);
        return false;
      }
    }

    const previous = this.recentFrames.get(fingerprint);
    if (
      previous &&
      previous.source !== source &&
      now - previous.seenAt <= this.crossSourceWindowMs
    ) {
      this.prune(now);
      return false;
    }

    this.recentFrames.set(fingerprint, { source, seenAt: now });
    this.prune(now);
    return true;
  }

  forgetStream(streamKey: string): void {
    this.lastPreloadAtByStream.delete(streamKey);
  }

  private prune(now: number): void {
    this.checks += 1;
    if (this.checks % 256 !== 0 && this.recentFrames.size < 2_048) {
      return;
    }
    const cutoff = now - Math.max(this.crossSourceWindowMs, this.debuggerFallbackAfterMs) * 2;
    for (const [fingerprint, frame] of this.recentFrames.entries()) {
      if (frame.seenAt < cutoff) {
        this.recentFrames.delete(fingerprint);
      }
    }
    for (const [streamKey, lastPreloadAt] of this.lastPreloadAtByStream.entries()) {
      if (lastPreloadAt < cutoff) {
        this.lastPreloadAtByStream.delete(streamKey);
      }
    }
  }
}

function atlasFrameFingerprint(streamKey: string, payload: RawCaptureAppendFramePayload): string {
  return createHash("sha256")
    .update(streamKey)
    .update("\0")
    .update(payload.frame.dir)
    .update("\0")
    .update(payload.frame.raw)
    .digest("base64url");
}
