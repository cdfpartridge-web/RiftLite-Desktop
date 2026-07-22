import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import {
  TCGA_REPLAY_RAW_SCHEMA,
  TCGA_REPLAY_RAW_VERSION,
  type TcgaReplayJsonObject,
  type TcgaReplayJsonValue,
  type TcgaReplayRawCaptureV1,
  type TcgaReplayRawDirection,
  type TcgaReplayRawMessageV1
} from "../../shared/tcgaReplayRaw.js";
import type { TcgaReplayResearchWebReplayExportSummary } from "../../shared/types.js";
import {
  TcgaPeerMessageDecoder,
  type TcgaPeerDecoderFinalization
} from "../../shared/tcgaPeerBinaryPack.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const TCGA_REPLAY_RAW_MAX_COMPRESSED_SOURCE_BYTES = 64 * 1024 * 1024;
export const TCGA_REPLAY_RAW_MAX_EXPANDED_SOURCE_BYTES = 256 * 1024 * 1024;
export const TCGA_REPLAY_RAW_MAX_JSON_BYTES = 32 * 1024 * 1024;
export const TCGA_REPLAY_RAW_MAX_GZIP_BYTES = 4 * 1024 * 1024;

const MAX_JSONL_LINE_BYTES = 6 * 1024 * 1024;
const MAX_RESEARCH_RECORDS = 100_000;
const MAX_RTC_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_CHANNELS = 64;
const MAX_CHANNEL_MESSAGES = 50_000;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 5_000_000;

export interface TcgaReplayResearchExporterLimits {
  maxCompressedSourceBytes: number;
  maxExpandedSourceBytes: number;
  maxRawJsonBytes: number;
  maxRawGzipBytes: number;
}

export type TcgaReplayResearchExportSummary = TcgaReplayResearchWebReplayExportSummary;

export interface TcgaReplayResearchExportResult {
  sourceSha256: string;
  sourceCompressedBytes: number;
  sourceExpandedBytes: number;
  channels: TcgaReplayResearchExportSummary[];
}

interface ResearchRecord {
  seq: number;
  recordedAt: string;
  kind: string;
  payload: Record<string, unknown>;
}

interface CapturedRtcFrame {
  recordSeq: number;
  transportSequence: number;
  capturedAt: string;
  direction: TcgaReplayRawDirection;
  bytes: Uint8Array;
}

interface ChannelEvidence {
  key: string;
  frames: CapturedRtcFrame[];
  openedAt: number | null;
  closedAt: number | null;
}

interface JsonBudget {
  remaining: number;
  seen: WeakSet<object>;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.trunc(parsed)) : fallback;
}

function normalizedLimits(
  options: Partial<TcgaReplayResearchExporterLimits>
): TcgaReplayResearchExporterLimits {
  return {
    maxCompressedSourceBytes: Math.min(
      positiveInteger(options.maxCompressedSourceBytes, TCGA_REPLAY_RAW_MAX_COMPRESSED_SOURCE_BYTES),
      TCGA_REPLAY_RAW_MAX_COMPRESSED_SOURCE_BYTES
    ),
    maxExpandedSourceBytes: Math.min(
      positiveInteger(options.maxExpandedSourceBytes, TCGA_REPLAY_RAW_MAX_EXPANDED_SOURCE_BYTES),
      TCGA_REPLAY_RAW_MAX_EXPANDED_SOURCE_BYTES
    ),
    maxRawJsonBytes: Math.min(
      positiveInteger(options.maxRawJsonBytes, TCGA_REPLAY_RAW_MAX_JSON_BYTES),
      TCGA_REPLAY_RAW_MAX_JSON_BYTES
    ),
    maxRawGzipBytes: Math.min(
      positiveInteger(options.maxRawGzipBytes, TCGA_REPLAY_RAW_MAX_GZIP_BYTES),
      TCGA_REPLAY_RAW_MAX_GZIP_BYTES
    )
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeInteger(value: unknown, fallback = -1): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function safeTimestamp(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Date.parse(safeString(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function channelKey(value: unknown): string {
  const channel = asRecord(value);
  const captureChannelId = safeString(channel?.captureChannelId);
  if (/^channel-\d{1,12}$/.test(captureChannelId)) return captureChannelId;
  const id = safeInteger(channel?.id);
  return id >= 0 ? `game:${id}` : "";
}

function exactBase64Bytes(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_RTC_FRAME_BYTES * 2) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    return null;
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength < 1 || decoded.byteLength > MAX_RTC_FRAME_BYTES) {
    return null;
  }
  const copy = new Uint8Array(decoded.byteLength);
  copy.set(decoded);
  return copy;
}

function researchEventPayload(record: ResearchRecord): Record<string, unknown> | null {
  return asRecord(asRecord(record.payload)?.payload);
}

function parseResearchJsonl(input: Uint8Array): ResearchRecord[] {
  const lines = Buffer.from(input).toString("utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length > MAX_RESEARCH_RECORDS + 2) {
    throw new Error("TCGA research capture contains too many records.");
  }
  const records: ResearchRecord[] = [];
  let expectedSequence = 0;
  for (const line of lines) {
    if (Buffer.byteLength(line, "utf8") > MAX_JSONL_LINE_BYTES) {
      throw new Error("TCGA research capture contains an oversized record.");
    }
    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(line) as unknown;
      const record = asRecord(value);
      if (!record) throw new Error("not-object");
      parsed = record;
    } catch {
      throw new Error("TCGA research capture contains invalid JSONL.");
    }
    const seq = safeInteger(parsed.seq);
    if (seq !== expectedSequence) {
      throw new Error("TCGA research capture record sequence is incomplete.");
    }
    expectedSequence += 1;
    const schema = safeString(parsed.schema);
    const version = safeInteger(parsed.version);
    const kind = safeString(parsed.kind);
    if (
      version !== 1 ||
      (
        schema !== "riftlite-tcga-research-session" &&
        schema !== "riftlite-tcga-research-record"
      )
    ) {
      throw new Error("TCGA research capture contains an unsupported record.");
    }
    records.push({
      seq,
      recordedAt: safeString(parsed.recordedAt),
      kind,
      payload: asRecord(parsed.payload) ?? {}
    });
  }
  if (
    records[0]?.kind !== "research-session-start" ||
    records.at(-1)?.kind !== "research-session-stop"
  ) {
    throw new Error("TCGA research capture is missing its session boundary.");
  }
  return records;
}

function collectChannels(records: ResearchRecord[]): ChannelEvidence[] {
  const channels = new Map<string, ChannelEvidence>();
  const ensureChannel = (key: string): ChannelEvidence | null => {
    if (!key) return null;
    let channel = channels.get(key);
    if (!channel) {
      if (channels.size >= MAX_CHANNELS) {
        throw new Error("TCGA research capture contains too many game channels.");
      }
      channel = { key, frames: [], openedAt: null, closedAt: null };
      channels.set(key, channel);
    }
    return channel;
  };

  for (const record of records) {
    const payload = researchEventPayload(record);
    if (!payload) continue;
    if (record.kind === "page-rtc-channel") {
      const channel = ensureChannel(channelKey(payload.channel));
      if (!channel) continue;
      const at = safeTimestamp(record.recordedAt);
      const event = safeString(payload.event);
      if (at !== null && (event === "observed" || event === "open")) {
        channel.openedAt = channel.openedAt === null ? at : Math.min(channel.openedAt, at);
      }
      if (at !== null && event === "close") {
        channel.closedAt = channel.closedAt === null ? at : Math.max(channel.closedAt, at);
      }
      continue;
    }
    if (record.kind !== "page-rtc-data") continue;
    const channel = ensureChannel(channelKey(payload.channel));
    const direction = payload.direction;
    const data = asRecord(payload.data);
    const transportSequence = safeInteger(payload.transportSequence);
    const capturedAt = safeString(payload.transportCapturedAt) || record.recordedAt;
    const bytes = data?.encoding === "base64" && data.truncated !== true && data.unavailable !== true
      ? exactBase64Bytes(data.data)
      : null;
    if (
      !channel ||
      (direction !== "in" && direction !== "out") ||
      transportSequence < 0 ||
      safeTimestamp(capturedAt) === null ||
      !bytes ||
      (Number.isFinite(Number(data?.byteLength)) && Number(data?.byteLength) !== bytes.byteLength)
    ) {
      continue;
    }
    channel.frames.push({
      recordSeq: record.seq,
      transportSequence,
      capturedAt,
      direction,
      bytes
    });
  }

  return [...channels.values()]
    .filter((channel) => channel.frames.length > 0)
    .sort((left, right) => {
      const leftFrame = left.frames.reduce((minimum, frame) => Math.min(minimum, frame.transportSequence), Infinity);
      const rightFrame = right.frames.reduce((minimum, frame) => Math.min(minimum, frame.transportSequence), Infinity);
      return leftFrame - rightFrame || left.key.localeCompare(right.key);
    });
}

function jsonValue(value: unknown, depth: number, budget: JsonBudget): TcgaReplayJsonValue {
  budget.remaining -= 1;
  if (budget.remaining < 0) throw new Error("Decoded TCGA payload is too complex to export safely.");
  if (depth > MAX_JSON_DEPTH) throw new Error("Decoded TCGA payload is nested too deeply.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  if (value instanceof ArrayBuffer) {
    return {
      encoding: "base64",
      data: Buffer.from(value).toString("base64"),
      byteLength: value.byteLength
    };
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return {
      encoding: "base64",
      data: Buffer.from(bytes).toString("base64"),
      byteLength: bytes.byteLength
    };
  }
  if (Array.isArray(value)) {
    if (budget.seen.has(value)) throw new Error("Decoded TCGA payload contains a circular value.");
    budget.seen.add(value);
    const output = value.map((entry) => jsonValue(entry, depth + 1, budget));
    budget.seen.delete(value);
    return output;
  }
  const record = asRecord(value);
  if (!record) return null;
  if (budget.seen.has(record)) throw new Error("Decoded TCGA payload contains a circular value.");
  budget.seen.add(record);
  const output = Object.create(null) as TcgaReplayJsonObject;
  for (const [key, nested] of Object.entries(record)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
    if (nested === undefined || typeof nested === "function" || typeof nested === "symbol") continue;
    output[key] = jsonValue(nested, depth + 1, budget);
  }
  budget.seen.delete(record);
  return output;
}

function decodedMessage(value: unknown): TcgaReplayRawMessageV1["parsed"] | null {
  const record = asRecord(value);
  const type = safeString(record?.type);
  if (!record || !type) return null;
  const normalized = jsonValue(record, 0, {
    remaining: MAX_JSON_NODES,
    seen: new WeakSet()
  });
  const parsed = asRecord(normalized) as TcgaReplayRawMessageV1["parsed"] | null;
  return parsed && typeof parsed.type === "string" ? parsed : null;
}

function deterministicCaptureId(
  sourceSha256: string,
  channel: ChannelEvidence,
  firstTransportSequence: number,
  lastTransportSequence: number
): string {
  const digest = createHash("sha256")
    .update("riftlite-tcga-raw-capture\u0000v1\u0000")
    .update(sourceSha256)
    .update("\u0000")
    .update(channel.key)
    .update("\u0000")
    .update(String(firstTransportSequence))
    .update("\u0000")
    .update(String(lastTransportSequence))
    .digest("hex");
  return `tcga_${digest.slice(0, 48)}`;
}

function channelReasonCodes(
  messages: TcgaReplayRawMessageV1[],
  perspectivePlayerId: string,
  finalization: TcgaPeerDecoderFinalization
): string[] {
  const reasons: string[] = [];
  if (!messages.length) reasons.push("no-replay-messages");
  if (!perspectivePlayerId) reasons.push("missing-perspective-player");
  if (finalization.incompleteChunkGroups > 0) reasons.push("incomplete-chunk-groups");
  if (Object.values(finalization.issues).some((count) => count > 0)) reasons.push("transport-decode-issues");
  return reasons;
}

async function writeAtomicallyIfAbsent(path: string, data: Buffer): Promise<void> {
  const existing = await readFile(path).catch(() => null);
  if (existing) {
    if (existing.equals(data)) return;
    throw new Error("A different TCGA replay export already exists at the deterministic destination.");
  }
  const temporaryPath = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(temporaryPath, data, { mode: 0o600, flag: "wx" });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function exportBaseName(sourcePath: string): string {
  const name = basename(sourcePath);
  return name.endsWith(".jsonl.gz") ? name.slice(0, -".jsonl.gz".length) : name;
}

export async function exportTcgaReplayResearchBundle(
  sourcePath: string,
  outputDirectory = dirname(sourcePath),
  options: Partial<TcgaReplayResearchExporterLimits> = {}
): Promise<TcgaReplayResearchExportResult> {
  const limits = normalizedLimits(options);
  const compressedSource = await readFile(sourcePath);
  if (compressedSource.byteLength > limits.maxCompressedSourceBytes) {
    throw new Error("TCGA research bundle exceeds the compressed export limit.");
  }
  const sourceSha256 = createHash("sha256").update(compressedSource).digest("hex");
  let expanded: Buffer;
  try {
    expanded = await gunzipAsync(compressedSource, { maxOutputLength: limits.maxExpandedSourceBytes });
  } catch {
    throw new Error("TCGA research bundle could not be decompressed within the export limit.");
  }
  const records = parseResearchJsonl(expanded);
  const channels = collectChannels(records);
  await mkdir(outputDirectory, { recursive: true });

  const summaries: TcgaReplayResearchExportSummary[] = [];
  for (const [channelIndex, channel] of channels.entries()) {
    channel.frames.sort((left, right) => (
      left.transportSequence - right.transportSequence || left.recordSeq - right.recordSeq
    ));
    const decoder = new TcgaPeerMessageDecoder();
    const messages: TcgaReplayRawMessageV1[] = [];
    const playerIds = new Set<string>();
    let decodedFrames = 0;
    let logicalMessages = 0;
    let perspectivePlayerId = "";
    let endedByLeaving = false;

    for (const frame of channel.frames) {
      const result = decoder.push({
        ...frame,
        channelKey: channel.key
      });
      if (result.decodedFrame) decodedFrames += 1;
      logicalMessages += result.messages.length;
      for (const logical of result.messages) {
        const parsed = decodedMessage(logical.value);
        if (!parsed) continue;
        const type = safeString(parsed.type);
        const gameId = safeString(parsed.gameId);
        if (type === "PLAYER_DATA" && gameId) playerIds.add(gameId);
        if (!perspectivePlayerId && logical.direction === "out" && type === "PLAYER_DATA" && gameId) {
          perspectivePlayerId = gameId;
        }
        if (type === "LEAVING") endedByLeaving = true;
        if (type === "ping" || type === "pong") continue;
        if (messages.length >= MAX_CHANNEL_MESSAGES) {
          throw new Error("TCGA game channel contains too many decoded messages.");
        }
        messages.push({
          seq: messages.length,
          ts: safeTimestamp(logical.capturedAt) ?? 0,
          dir: logical.direction,
          firstTransportSequence: logical.firstTransportSequence,
          completedTransportSequence: logical.completedTransportSequence,
          parsed
        });
      }
    }

    const finalization = decoder.finish();
    const firstFrame = channel.frames[0];
    const lastFrame = channel.frames.at(-1)!;
    const firstSeenAt = messages[0]?.ts ?? safeTimestamp(firstFrame.capturedAt) ?? 0;
    const lastSeenAt = messages.at(-1)?.ts ?? safeTimestamp(lastFrame.capturedAt) ?? firstSeenAt;
    const captureSessionId = deterministicCaptureId(
      sourceSha256,
      channel,
      firstFrame.transportSequence,
      lastFrame.transportSequence
    );
    const reasonCodes = channelReasonCodes(messages, perspectivePlayerId, finalization);
    const ordinal = channelIndex + 1;
    const baseSummary: TcgaReplayResearchExportSummary = {
      ordinal,
      captureSessionId,
      status: "skipped",
      exportPath: "",
      messageCount: messages.length,
      frameCount: channel.frames.length,
      decodedFrameCount: decodedFrames,
      logicalMessageCount: logicalMessages,
      playerCount: playerIds.size,
      perspectivePresent: Boolean(perspectivePlayerId),
      endedByLeaving,
      firstSeenAt: new Date(firstSeenAt).toISOString(),
      lastSeenAt: new Date(lastSeenAt).toISOString(),
      rawJsonBytes: 0,
      compressedBytes: 0,
      sha256: "",
      reasonCodes
    };
    if (!messages.length) {
      summaries.push(baseSummary);
      continue;
    }

    const deterministicExportedAt = new Date(channel.closedAt ?? lastSeenAt).toISOString();
    const rawCapture: TcgaReplayRawCaptureV1 = {
      schema: TCGA_REPLAY_RAW_SCHEMA,
      version: TCGA_REPLAY_RAW_VERSION,
      exportedAt: deterministicExportedAt,
      capture: {
        captureSessionId,
        identity: {
          perspectivePlayerId,
          firstSeenAt,
          lastSeenAt
        },
        lifecycle: {
          channelKey: channel.key,
          openedAt: channel.openedAt,
          closedAt: channel.closedAt,
          endedByLeaving
        },
        source: {
          schema: "riftlite-tcga-research-session",
          version: 1,
          sha256: sourceSha256
        }
      },
      transport: {
        frames: channel.frames.length,
        decodedFrames,
        logicalMessages,
        chunkGroups: finalization.chunkGroups,
        completeChunkGroups: finalization.completeChunkGroups,
        incompleteChunkGroups: finalization.incompleteChunkGroups,
        incompleteChunkCount: finalization.incompleteChunkCount,
        duplicateChunks: finalization.duplicateChunks,
        issueCounts: finalization.issues
      },
      messages
    };
    const rawJson = Buffer.from(JSON.stringify(rawCapture), "utf8");
    baseSummary.rawJsonBytes = rawJson.byteLength;
    if (rawJson.byteLength > limits.maxRawJsonBytes) {
      baseSummary.reasonCodes.push("raw-json-limit");
      summaries.push(baseSummary);
      continue;
    }
    const compressed = await gzipAsync(rawJson, { level: 9 });
    baseSummary.compressedBytes = compressed.byteLength;
    if (compressed.byteLength > limits.maxRawGzipBytes) {
      baseSummary.reasonCodes.push("raw-gzip-limit");
      summaries.push(baseSummary);
      continue;
    }
    const exportPath = join(
      outputDirectory,
      `${exportBaseName(sourcePath)}.game-${String(ordinal).padStart(2, "0")}.${captureSessionId}.web-replay.json.gz`
    );
    await writeAtomicallyIfAbsent(exportPath, compressed);
    summaries.push({
      ...baseSummary,
      status: "exported",
      exportPath,
      sha256: createHash("sha256").update(compressed).digest("hex")
    });
  }

  return {
    sourceSha256,
    sourceCompressedBytes: compressedSource.byteLength,
    sourceExpandedBytes: expanded.byteLength,
    channels: summaries
  };
}
