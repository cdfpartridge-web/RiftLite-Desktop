import { z } from "zod";
import { gamePlatformForTrustedUrl } from "./embeddedContentSecurity.js";
import type { CaptureEvent, GamePlatform, RawCaptureAppendFramePayload } from "./types.js";

const MAX_CAPTURE_EVENT_BYTES = 2 * 1024 * 1024;
const MAX_RAW_FRAME_BYTES = 1_500_000;
const MAX_RAW_JSON_DEPTH = 64;
const MAX_RAW_JSON_NODES = 200_000;
const RAW_CAPTURE_RATE_WINDOW_MS = 10_000;
const RAW_CAPTURE_RATE_MAX_FRAMES = 512;
const RAW_CAPTURE_RATE_MAX_BYTES = 16 * 1024 * 1024;

const CaptureEventSchema = z.object({
  id: z.string().trim().min(1).max(256),
  platform: z.enum(["tcga", "atlas", "sim"]),
  kind: z.enum([
    "capture-ready",
    "network-fetch",
    "network-xhr",
    "network-websocket",
    "dom-mutation",
    "match-snapshot",
    "match-start",
    "match-update",
    "match-end",
    "debug"
  ]),
  capturedAt: z.string().trim().min(1).max(64).refine((value) => Number.isFinite(Date.parse(value))),
  url: z.string().trim().min(1).max(4_096),
  payload: z.record(z.string(), z.unknown())
}).strict();

const RawCaptureFrameSchema = z.object({
  seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  ts: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  dir: z.enum(["in", "out"]),
  socketId: z.string().max(256).nullable().optional(),
  type: z.string().max(256).nullable().optional(),
  raw: z.string().min(1),
  drop: z.boolean().optional(),
  dropReason: z.string().max(512).nullable().optional()
}).strict();

const RawCapturePayloadSchema = z.object({
  platform: z.literal("atlas"),
  requestUrl: z.string().trim().min(1).max(4_096),
  frame: RawCaptureFrameSchema
}).strict();

function jsonByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isAllowedAtlasSocketUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return ["https:", "wss:"].includes(url.protocol) && url.port === "" && (
      hostname === "play.riftatlas.com" ||
      hostname.endsWith(".riftatlas.com") ||
      hostname === "riftatlas-workers.com" ||
      hostname.endsWith(".riftatlas-workers.com")
    );
  } catch {
    return false;
  }
}

function rawFrameByteLength(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }
  const frame = (value as { frame?: unknown }).frame;
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    return 0;
  }
  const raw = (frame as { raw?: unknown }).raw;
  return typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : 0;
}

function isBoundedRawJson(raw: string): boolean {
  let root: unknown;
  try {
    root = JSON.parse(raw) as unknown;
  } catch {
    return false;
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return false;
  }
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_RAW_JSON_NODES || current.depth > MAX_RAW_JSON_DEPTH) {
      return false;
    }
    if (!current.value || typeof current.value !== "object") {
      continue;
    }
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    for (const child of children) {
      if (child && typeof child === "object") {
        stack.push({ value: child, depth: current.depth + 1 });
      } else {
        nodes += 1;
        if (nodes > MAX_RAW_JSON_NODES) {
          return false;
        }
      }
    }
  }
  return true;
}

export class RawCaptureIngressLimiter {
  private readonly windows = new Map<number, { startedAt: number; frames: number; bytes: number }>();

  allow(senderId: number, value: unknown, now = Date.now()): boolean {
    const bytes = rawFrameByteLength(value);
    if (bytes < 1 || bytes > MAX_RAW_FRAME_BYTES) {
      return false;
    }
    const previous = this.windows.get(senderId);
    const current = !previous || now - previous.startedAt >= RAW_CAPTURE_RATE_WINDOW_MS
      ? { startedAt: now, frames: 0, bytes: 0 }
      : previous;
    if (current.frames + 1 > RAW_CAPTURE_RATE_MAX_FRAMES || current.bytes + bytes > RAW_CAPTURE_RATE_MAX_BYTES) {
      return false;
    }
    current.frames += 1;
    current.bytes += bytes;
    this.windows.set(senderId, current);
    return true;
  }

  forget(senderId: number): void {
    this.windows.delete(senderId);
  }
}

export function validatedCaptureEvent(
  value: unknown,
  expectedPlatform?: GamePlatform,
  allowSimulator = false
): CaptureEvent | null {
  const parsed = CaptureEventSchema.safeParse(value);
  if (!parsed.success || jsonByteLength(parsed.data) > MAX_CAPTURE_EVENT_BYTES) {
    return null;
  }
  if (expectedPlatform && parsed.data.platform !== expectedPlatform) {
    return null;
  }
  if (gamePlatformForTrustedUrl(parsed.data.url, allowSimulator) !== parsed.data.platform) {
    return null;
  }
  return parsed.data as CaptureEvent;
}

export function validatedRawCaptureFrame(value: unknown): RawCaptureAppendFramePayload | null {
  const parsed = RawCapturePayloadSchema.safeParse(value);
  if (
    !parsed.success ||
    Buffer.byteLength(parsed.data.frame.raw, "utf8") > MAX_RAW_FRAME_BYTES ||
    !isAllowedAtlasSocketUrl(parsed.data.requestUrl) ||
    !isBoundedRawJson(parsed.data.frame.raw)
  ) {
    return null;
  }
  return parsed.data as RawCaptureAppendFramePayload;
}
