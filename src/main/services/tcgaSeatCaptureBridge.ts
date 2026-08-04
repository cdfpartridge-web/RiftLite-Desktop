import { Buffer } from "node:buffer";
import type { CaptureEvent } from "../../shared/types.js";
import {
  TcgaSeatTracker,
  tcgaSeatCaptureEvent
} from "../../shared/tcgaSeatTracker.js";
import type { TcgaWebReplayBindingEvent } from "./tcgaWebReplayCaptureService.js";

const MAX_FRAME_BYTES = 1_000_000;
const MAX_DOCUMENT_ID_LENGTH = 192;
const MAX_CHANNEL_ID_LENGTH = 128;
const MAX_LIVE_CHANNELS_PER_WEB_CONTENTS = 8;
const MAX_CLOSED_CHANNELS_PER_WEB_CONTENTS = 32;
const CHANNEL_IDLE_TTL_MS = 4 * 60 * 60 * 1_000;

/**
 * Privacy-limited adapter between TCGA's page RTC hook and the match logger.
 * Raw game frames are decoded in memory and discarded; only a 1st/2nd event
 * leaves this service.
 */
export class TcgaSeatCaptureBridge {
  private readonly tracker = new TcgaSeatTracker();
  private readonly currentDocuments = new Map<number, string>();
  private readonly channelKeysByWebContents = new Map<number, Set<string>>();
  private readonly channelLastSeenAt = new Map<string, number>();
  private readonly closedChannelKeysByWebContents = new Map<number, Set<string>>();

  ingestBindingEvent(webContentsId: number, event: TcgaWebReplayBindingEvent): CaptureEvent[] {
    if (!Number.isSafeInteger(webContentsId) || webContentsId < 1) {
      return [];
    }
    this.pruneExpiredChannels(webContentsId, Date.now());
    const documentId = safeIdentifier(event.documentId, MAX_DOCUMENT_ID_LENGTH);
    if (event.kind === "hook-ready" || event.kind === "hook-resumed") {
      if (!documentId) {
        return [];
      }
      const previousDocumentId = this.currentDocuments.get(webContentsId);
      if (previousDocumentId && previousDocumentId !== documentId) {
        this.forgetChannels(webContentsId);
      }
      this.currentDocuments.set(webContentsId, documentId);
      return [];
    }
    if (!documentId || this.currentDocuments.get(webContentsId) !== documentId) {
      return [];
    }
    const payload = readRecord(event.payload);
    const channel = readRecord(payload?.channel);
    const captureChannelId = safeIdentifier(channel?.captureChannelId, MAX_CHANNEL_ID_LENGTH);
    if (!payload || !channel || readString(channel.label) !== "game" || !captureChannelId) {
      return [];
    }
    const channelKey = `${webContentsId}\u0000${documentId}\u0000${captureChannelId}`;
    if (event.kind === "rtc-channel") {
      if (payload.event === "close" || payload.event === "error") {
        this.closeChannel(webContentsId, channelKey);
      }
      return [];
    }
    if (event.kind !== "rtc-data") {
      return [];
    }
    if (this.closedChannelKeysByWebContents.get(webContentsId)?.has(channelKey)) {
      return [];
    }
    const direction = payload.direction;
    const transportSequence = Number(payload.transportSequence);
    const capturedAt = readString(payload.transportCapturedAt) || event.capturedAt;
    const bytes = exactFrameBytes(payload.data);
    if (
      (direction !== "in" && direction !== "out") ||
      !Number.isSafeInteger(transportSequence) ||
      transportSequence < 0 ||
      !Number.isFinite(Date.parse(capturedAt)) ||
      !bytes
    ) {
      return [];
    }
    this.rememberChannel(webContentsId, channelKey);
    const signal = this.tracker.push({
      recordSeq: transportSequence,
      transportSequence,
      capturedAt,
      direction,
      channelKey,
      bytes
    });
    return signal ? [tcgaSeatCaptureEvent(signal)] : [];
  }

  forgetWebContents(webContentsId: number): void {
    this.forgetChannels(webContentsId);
    this.currentDocuments.delete(webContentsId);
  }

  reset(): void {
    this.tracker.reset();
    this.currentDocuments.clear();
    this.channelKeysByWebContents.clear();
    this.channelLastSeenAt.clear();
    this.closedChannelKeysByWebContents.clear();
  }

  private rememberChannel(webContentsId: number, channelKey: string): void {
    const channelKeys = this.channelKeysByWebContents.get(webContentsId) ?? new Set<string>();
    if (!channelKeys.has(channelKey) && channelKeys.size >= MAX_LIVE_CHANNELS_PER_WEB_CONTENTS) {
      const oldestChannelKey = [...channelKeys].sort((left, right) => (
        (this.channelLastSeenAt.get(left) ?? 0) - (this.channelLastSeenAt.get(right) ?? 0)
      ))[0];
      if (oldestChannelKey) {
        this.forgetChannel(webContentsId, oldestChannelKey);
      }
    }
    channelKeys.add(channelKey);
    this.channelKeysByWebContents.set(webContentsId, channelKeys);
    this.channelLastSeenAt.set(channelKey, Date.now());
  }

  private forgetChannel(webContentsId: number, channelKey: string): void {
    this.tracker.forgetChannel(channelKey);
    this.channelLastSeenAt.delete(channelKey);
    const channelKeys = this.channelKeysByWebContents.get(webContentsId);
    channelKeys?.delete(channelKey);
    if (!channelKeys?.size) {
      this.channelKeysByWebContents.delete(webContentsId);
    }
  }

  private forgetChannels(webContentsId: number): void {
    for (const channelKey of this.channelKeysByWebContents.get(webContentsId) ?? []) {
      this.tracker.forgetChannel(channelKey);
      this.channelLastSeenAt.delete(channelKey);
    }
    this.channelKeysByWebContents.delete(webContentsId);
    this.closedChannelKeysByWebContents.delete(webContentsId);
  }

  private closeChannel(webContentsId: number, channelKey: string): void {
    this.forgetChannel(webContentsId, channelKey);
    const closedChannelKeys = this.closedChannelKeysByWebContents.get(webContentsId) ?? new Set<string>();
    if (closedChannelKeys.size >= MAX_CLOSED_CHANNELS_PER_WEB_CONTENTS) {
      const oldestChannelKey = closedChannelKeys.values().next().value as string | undefined;
      if (oldestChannelKey) {
        closedChannelKeys.delete(oldestChannelKey);
      }
    }
    closedChannelKeys.add(channelKey);
    this.closedChannelKeysByWebContents.set(webContentsId, closedChannelKeys);
  }

  private pruneExpiredChannels(webContentsId: number, now: number): void {
    for (const channelKey of this.channelKeysByWebContents.get(webContentsId) ?? []) {
      const lastSeenAt = this.channelLastSeenAt.get(channelKey) ?? 0;
      if (now - lastSeenAt > CHANNEL_IDLE_TTL_MS) {
        this.forgetChannel(webContentsId, channelKey);
      }
    }
  }
}

function exactFrameBytes(value: unknown): Uint8Array | null {
  const data = readRecord(value);
  const encoded = readString(data?.data);
  const byteLength = Number(data?.byteLength);
  if (
    !data ||
    data.encoding !== "base64" ||
    data.truncated === true ||
    data.unavailable === true ||
    !encoded ||
    encoded.length > Math.ceil(MAX_FRAME_BYTES / 3) * 4 + 4 ||
    encoded.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > MAX_FRAME_BYTES
  ) {
    return null;
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength !== byteLength) {
    return null;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function safeIdentifier(value: unknown, maximumLength: number): string {
  const identifier = readString(value);
  return identifier && identifier.length <= maximumLength && !/[\u0000-\u001f]/.test(identifier)
    ? identifier
    : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
