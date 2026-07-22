import { unpack } from "peerjs-js-binarypack";

export type TcgaPeerDirection = "in" | "out";

export interface TcgaPeerFrame {
  recordSeq: number;
  transportSequence: number;
  capturedAt: string;
  direction: TcgaPeerDirection;
  channelKey: string;
  bytes: Uint8Array;
}

export interface TcgaDecodedGameMessage {
  direction: TcgaPeerDirection;
  channelKey: string;
  firstTransportSequence: number;
  completedTransportSequence: number;
  capturedAt: string;
  /** SENSITIVE TCGA protocol data. Never expose this value over renderer IPC. */
  value: unknown;
}

export type TcgaTransportIssueCode =
  | "frame-decode-failed"
  | "invalid-chunk-envelope"
  | "chunk-group-limit"
  | "chunk-size-limit"
  | "conflicting-chunk-total"
  | "conflicting-chunk-duplicate"
  | "message-decode-failed";

export interface TcgaTransportIssue {
  code: TcgaTransportIssueCode;
  recordSeq: number;
  transportSequence: number;
}

export interface TcgaPeerDecoderPushResult {
  decodedFrame: boolean;
  chunkFrame: boolean;
  messages: TcgaDecodedGameMessage[];
  issues: TcgaTransportIssue[];
}

export interface TcgaPeerDecoderFinalization {
  chunkGroups: number;
  completeChunkGroups: number;
  incompleteChunkGroups: number;
  incompleteChunkCount: number;
  duplicateChunks: number;
  issues: Record<TcgaTransportIssueCode, number>;
}

export interface TcgaPeerMessageDecoderLimits {
  maxPendingGroups: number;
  maxChunksPerGroup: number;
  maxGroupBytes: number;
}

interface ChunkEnvelope {
  id: string;
  index: number;
  total: number;
  data: Uint8Array;
}

interface PendingChunkGroup {
  total: number;
  parts: Map<number, Uint8Array>;
  byteLength: number;
  firstTransportSequence: number;
  completedTransportSequence: number;
  capturedAt: string;
  direction: TcgaPeerDirection;
  channelKey: string;
}

const DEFAULT_LIMITS: TcgaPeerMessageDecoderLimits = {
  maxPendingGroups: 1_024,
  maxChunksPerGroup: 1_024,
  maxGroupBytes: 32 * 1024 * 1024
};

const ISSUE_CODES: TcgaTransportIssueCode[] = [
  "frame-decode-failed",
  "invalid-chunk-envelope",
  "chunk-group-limit",
  "chunk-size-limit",
  "conflicting-chunk-total",
  "conflicting-chunk-duplicate",
  "message-decode-failed"
];

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.trunc(parsed)) : fallback;
}

function normalizeLimits(options: Partial<TcgaPeerMessageDecoderLimits>): TcgaPeerMessageDecoderLimits {
  return {
    maxPendingGroups: positiveInteger(options.maxPendingGroups, DEFAULT_LIMITS.maxPendingGroups),
    maxChunksPerGroup: positiveInteger(options.maxChunksPerGroup, DEFAULT_LIMITS.maxChunksPerGroup),
    maxGroupBytes: positiveInteger(options.maxGroupBytes, DEFAULT_LIMITS.maxGroupBytes)
  };
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesFromUnknown(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function recordsEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function chunkEnvelope(value: unknown, maxChunksPerGroup: number): ChunkEnvelope | null | "invalid" {
  const record = asRecord(value);
  if (!record || !("__peerData" in record)) return null;
  const rawId = record.__peerData;
  const id = typeof rawId === "string"
    ? rawId.slice(0, 128)
    : typeof rawId === "number" && Number.isFinite(rawId)
      ? String(rawId)
      : "";
  const index = Number(record.n);
  const total = Number(record.total);
  const data = bytesFromUnknown(record.data);
  if (
    !id ||
    !Number.isInteger(index) ||
    !Number.isInteger(total) ||
    total < 1 ||
    total > maxChunksPerGroup ||
    index < 0 ||
    index >= total ||
    !data
  ) {
    return "invalid";
  }
  return { id, index, total, data };
}

function emptyIssueCounts(): Record<TcgaTransportIssueCode, number> {
  return Object.fromEntries(ISSUE_CODES.map((code) => [code, 0])) as Record<TcgaTransportIssueCode, number>;
}

/**
 * Decodes one exact TCGA PeerJS BinaryPack payload. The returned value may
 * contain private player, deck, hand, room and card data.
 */
export function decodeTcgaPeerBinaryPack(bytes: Uint8Array): unknown {
  return unpack(exactArrayBuffer(bytes));
}

/**
 * Reassembles PeerJS chunk envelopes independently per direction/channel and
 * decodes the resulting logical TCGA messages. It deliberately knows nothing
 * about Atlas capture or RiftLite's canonical replay schema.
 */
export class TcgaPeerMessageDecoder {
  private readonly limits: TcgaPeerMessageDecoderLimits;
  private readonly pending = new Map<string, PendingChunkGroup>();
  private readonly issueCounts = emptyIssueCounts();
  private chunkGroups = 0;
  private completeChunkGroups = 0;
  private duplicateChunks = 0;

  constructor(options: Partial<TcgaPeerMessageDecoderLimits> = {}) {
    this.limits = normalizeLimits(options);
  }

  push(frame: TcgaPeerFrame): TcgaPeerDecoderPushResult {
    const issues: TcgaTransportIssue[] = [];
    const issue = (code: TcgaTransportIssueCode): void => {
      this.issueCounts[code] += 1;
      issues.push({
        code,
        recordSeq: frame.recordSeq,
        transportSequence: frame.transportSequence
      });
    };

    let decoded: unknown;
    try {
      decoded = decodeTcgaPeerBinaryPack(frame.bytes);
    } catch {
      issue("frame-decode-failed");
      return { decodedFrame: false, chunkFrame: false, messages: [], issues };
    }

    const envelope = chunkEnvelope(decoded, this.limits.maxChunksPerGroup);
    if (envelope === "invalid") {
      issue("invalid-chunk-envelope");
      return { decodedFrame: true, chunkFrame: true, messages: [], issues };
    }
    if (!envelope) {
      return {
        decodedFrame: true,
        chunkFrame: false,
        messages: [{
          direction: frame.direction,
          channelKey: frame.channelKey,
          firstTransportSequence: frame.transportSequence,
          completedTransportSequence: frame.transportSequence,
          capturedAt: frame.capturedAt,
          value: decoded
        }],
        issues
      };
    }

    const groupKey = `${frame.direction}\u0000${frame.channelKey}\u0000${envelope.id}`;
    let group = this.pending.get(groupKey);
    if (!group) {
      if (this.pending.size >= this.limits.maxPendingGroups) {
        issue("chunk-group-limit");
        return { decodedFrame: true, chunkFrame: true, messages: [], issues };
      }
      group = {
        total: envelope.total,
        parts: new Map(),
        byteLength: 0,
        firstTransportSequence: frame.transportSequence,
        completedTransportSequence: frame.transportSequence,
        capturedAt: frame.capturedAt,
        direction: frame.direction,
        channelKey: frame.channelKey
      };
      this.pending.set(groupKey, group);
      this.chunkGroups += 1;
    } else if (group.total !== envelope.total) {
      issue("conflicting-chunk-total");
      return { decodedFrame: true, chunkFrame: true, messages: [], issues };
    }

    const previous = group.parts.get(envelope.index);
    if (previous) {
      this.duplicateChunks += 1;
      if (!recordsEqual(previous, envelope.data)) {
        issue("conflicting-chunk-duplicate");
      }
      return { decodedFrame: true, chunkFrame: true, messages: [], issues };
    }
    if (group.byteLength + envelope.data.byteLength > this.limits.maxGroupBytes) {
      this.pending.delete(groupKey);
      issue("chunk-size-limit");
      return { decodedFrame: true, chunkFrame: true, messages: [], issues };
    }

    const stored = new Uint8Array(envelope.data.byteLength);
    stored.set(envelope.data);
    group.parts.set(envelope.index, stored);
    group.byteLength += stored.byteLength;
    group.firstTransportSequence = Math.min(group.firstTransportSequence, frame.transportSequence);
    if (frame.transportSequence >= group.completedTransportSequence) {
      group.completedTransportSequence = frame.transportSequence;
      group.capturedAt = frame.capturedAt;
    }
    if (group.parts.size !== group.total) {
      return { decodedFrame: true, chunkFrame: true, messages: [], issues };
    }

    const combined = new Uint8Array(group.byteLength);
    let offset = 0;
    for (let index = 0; index < group.total; index += 1) {
      const part = group.parts.get(index);
      if (!part) {
        return { decodedFrame: true, chunkFrame: true, messages: [], issues };
      }
      combined.set(part, offset);
      offset += part.byteLength;
    }
    this.pending.delete(groupKey);
    this.completeChunkGroups += 1;

    try {
      return {
        decodedFrame: true,
        chunkFrame: true,
        messages: [{
          direction: group.direction,
          channelKey: group.channelKey,
          firstTransportSequence: group.firstTransportSequence,
          completedTransportSequence: group.completedTransportSequence,
          capturedAt: group.capturedAt,
          value: decodeTcgaPeerBinaryPack(combined)
        }],
        issues
      };
    } catch {
      issue("message-decode-failed");
      return { decodedFrame: true, chunkFrame: true, messages: [], issues };
    }
  }

  finish(): TcgaPeerDecoderFinalization {
    let incompleteChunkCount = 0;
    for (const group of this.pending.values()) {
      incompleteChunkCount += Math.max(0, group.total - group.parts.size);
    }
    return {
      chunkGroups: this.chunkGroups,
      completeChunkGroups: this.completeChunkGroups,
      incompleteChunkGroups: this.pending.size,
      incompleteChunkCount,
      duplicateChunks: this.duplicateChunks,
      issues: { ...this.issueCounts }
    };
  }
}
