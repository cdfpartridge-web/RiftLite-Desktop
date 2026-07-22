import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import {
  TCGA_REPLAY_RAW_SCHEMA,
  TCGA_REPLAY_RAW_VERSION,
  type TcgaReplayJsonObject,
  type TcgaReplayJsonValue,
  type TcgaReplayRawDirection,
  type TcgaReplayRawMessageV1
} from "../../shared/tcgaReplayRaw.js";
import {
  TcgaPeerMessageDecoder,
  type TcgaPeerDecoderFinalization,
  type TcgaTransportIssueCode
} from "../../shared/tcgaPeerBinaryPack.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const TCGA_WEB_REPLAY_MAX_CHANNELS = 32;
export const TCGA_WEB_REPLAY_MAX_FRAMES_PER_CHANNEL = 50_000;
export const TCGA_WEB_REPLAY_MAX_FRAME_BYTES = 2 * 1024 * 1024;
export const TCGA_WEB_REPLAY_MAX_BUFFERED_BYTES = 64 * 1024 * 1024;
export const TCGA_WEB_REPLAY_MAX_RAW_JSON_BYTES = 32 * 1024 * 1024;
export const TCGA_WEB_REPLAY_MAX_GZIP_BYTES = 4 * 1024 * 1024;
export const TCGA_WEB_REPLAY_PENDING_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const TCGA_WEB_REPLAY_MAX_PENDING_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

const DEFAULT_PRELUDE_MS = 30 * 1_000;
const DEFAULT_COMPLETION_GAP_MS = 60 * 1_000;
const RETAINED_DOCUMENT_GENERATIONS = 2;
const MAX_PENDING_CAPTURES = 32;
const MAX_PENDING_SIDECAR_BYTES = 16 * 1024;
const PENDING_CAPTURE_SCHEMA = "riftlite-tcga-awaiting-result-capture";
const PENDING_SIDECAR_SCHEMA = "riftlite-tcga-awaiting-result-sidecar";
const PENDING_FILE_PREFIX = "tcga-awaiting-result-";
const PENDING_PAYLOAD_SUFFIX = ".candidate.json.gz";
const PENDING_SIDECAR_SUFFIX = ".sidecar.json";
const MAX_IDENTIFIER_LENGTH = 160;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 5_000_000;

export interface TcgaWebReplayRtcChannelEvent {
  webContentsId: number;
  documentGeneration: number;
  captureChannelId: string;
  capturedAt: string | number;
  event: "observed" | "open" | "close" | "error";
}

export interface TcgaWebReplayRtcDataEvent {
  webContentsId: number;
  documentGeneration: number;
  captureChannelId: string;
  capturedAt: string | number;
  transportSequence: number;
  direction: TcgaReplayRawDirection;
  bytes: Uint8Array;
}

/**
 * The normal capture coordinator's finish identity structurally satisfies this
 * shape. `match` stays opaque here so this provider collector does not depend
 * on Atlas delivery types.
 */
export interface TcgaWebReplayFinishContext {
  capturedAt?: string;
  completedAt?: string;
  match?: unknown;
  confirmedResult?: boolean;
}

export interface TcgaWebReplayPreparedCapture {
  platform: "tcga";
  artifactEncoding: "gzip";
  captureSessionId: string;
  localPath: string;
  messageCount: number;
  frameCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  expectedAccountUid: string;
  discordShareHubIds: string[];
  rawJsonBytes: number;
  compressedBytes: number;
  sha256: string;
}

export interface TcgaWebReplayAwaitingResultCapture {
  captureSessionId: string;
  candidatePath: string;
  sidecarPath: string;
  firstSeenAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export type TcgaWebReplayCandidateRejection =
  | "channel-capped"
  | "invalid-ingress-frame"
  | "duplicate-transport-sequence"
  | "missing-perspective"
  | "player-count"
  | "missing-opening-state"
  | "missing-setup-progression"
  | "missing-mulligan-evidence"
  | "missing-in-game-state"
  | "missing-game-history"
  | "missing-legend-identities"
  | "missing-battlefield-identities"
  | "transport-issues";

export type TcgaWebReplayFinalizeReason =
  | "capture-disabled"
  | "consent-changed"
  | "invalid-match-window"
  | "unsupported-multi-game-match"
  | "unconfirmed-match-result"
  | "invalid-pending-artifact"
  | "no-match-window-candidate"
  | "no-replay-ready-candidate"
  | "ambiguous-replay-candidate";

export type TcgaWebReplayFinalizeResult<TRegistration> =
  | {
      status: "registered";
      capture: TcgaWebReplayPreparedCapture;
      registration: TRegistration;
    }
  | {
      status: "awaiting-result";
      capture: TcgaWebReplayAwaitingResultCapture;
      registration: null;
      consideredCandidates: number;
      readyCandidates: 1;
    }
  | {
      status: "skipped";
      reason: TcgaWebReplayFinalizeReason;
      consideredCandidates: number;
      readyCandidates: number;
      rejectionCounts: Partial<Record<TcgaWebReplayCandidateRejection, number>>;
    };

export interface TcgaWebReplayCaptureLimits {
  maxChannels: number;
  maxFramesPerChannel: number;
  maxFrameBytes: number;
  maxBufferedBytes: number;
  maxRawJsonBytes: number;
  maxGzipBytes: number;
  preludeMs: number;
  completionGapMs: number;
  pendingRetentionMs: number;
}

export type TcgaWebReplayRegistrationCallback<
  TContext extends TcgaWebReplayFinishContext,
  TReplay,
  TRegistration
> = (
  capture: TcgaWebReplayPreparedCapture,
  context: TContext,
  replay: TReplay | undefined
) => Promise<TRegistration> | TRegistration;

export interface TcgaWebReplayBindingEvent {
  kind: "hook-ready" | "hook-resumed" | "rtc-channel" | "rtc-data";
  capturedAt: string;
  documentId?: string;
  documentGeneration?: number;
  payload: Record<string, unknown>;
}

interface PinnedDocumentGeneration {
  webContentsId: number;
  generation: number;
}

interface StoredFrame {
  recordSeq: number;
  transportSequence: number;
  capturedAt: string;
  capturedAtMs: number;
  direction: TcgaReplayRawDirection;
  bytes: Uint8Array;
}

interface ChannelSession {
  key: string;
  webContentsId: number;
  documentGeneration: number;
  captureChannelId: string;
  openedAt: number | null;
  closedAt: number | null;
  firstSeenAt: number;
  lastSeenAt: number;
  frames: StoredFrame[];
  byteSize: number;
  capped: boolean;
  duplicateTransportSequence: boolean;
  invalidIngressFrame: boolean;
  transportSequences: Set<number>;
  expectedAccountUid: string;
  discordShareHubIds: string[];
}

interface JsonBudget {
  remaining: number;
  seen: WeakSet<object>;
}

interface DecodedCandidate {
  session: ChannelSession;
  messages: TcgaReplayRawMessageV1[];
  perspectivePlayerId: string;
  playerCount: number;
  decodedFrames: number;
  logicalMessages: number;
  endedByLeaving: boolean;
  finalization: TcgaPeerDecoderFinalization;
  rejectionReasons: TcgaWebReplayCandidateRejection[];
}

interface TcgaWebReplayRawCaptureV1 {
  schema: typeof TCGA_REPLAY_RAW_SCHEMA;
  version: typeof TCGA_REPLAY_RAW_VERSION;
  exportedAt: string;
  capture: {
    captureSessionId: string;
    identity: {
      perspectivePlayerId: string;
      firstSeenAt: number;
      lastSeenAt: number;
    };
    lifecycle: {
      channelKey: string;
      openedAt: number | null;
      closedAt: number | null;
      endedByLeaving: boolean;
    };
    source: {
      schema: "riftlite-tcga-web-replay";
      version: 1;
      sha256: string;
    };
    match?: {
      result: "win" | "loss" | "draw" | "incomplete";
      perspectivePoints?: number;
      opponentPoints?: number;
    };
  };
  transport: {
    frames: number;
    decodedFrames: number;
    logicalMessages: number;
    chunkGroups: number;
    completeChunkGroups: number;
    incompleteChunkGroups: number;
    incompleteChunkCount: number;
    duplicateChunks: number;
    issueCounts: Record<string, number>;
  };
  messages: TcgaReplayRawMessageV1[];
}

interface TcgaWebReplayPendingCaptureV1 {
  schema: typeof PENDING_CAPTURE_SCHEMA;
  version: 1;
  exportedAt: string;
  capture: Omit<TcgaWebReplayRawCaptureV1["capture"], "source" | "match"> & {
    source: {
      schema: "riftlite-tcga-awaiting-result";
      version: 1;
      sha256: string;
    };
  };
  transport: TcgaWebReplayRawCaptureV1["transport"];
  messages: TcgaReplayRawMessageV1[];
}

interface PendingSidecarCoreV1 {
  schema: typeof PENDING_SIDECAR_SCHEMA;
  version: 1;
  captureSessionId: string;
  accountBindingSha256: string;
  discordShareHubIds?: string[];
  sourceSha256: string;
  matchWindow: {
    startedAt: number;
    completedAt: number;
  };
  payloadFile: string;
  payloadSha256: string;
  rawJsonBytes: number;
  compressedBytes: number;
  createdAt: number;
  expiresAt: number;
}

interface PendingSidecarV1 extends PendingSidecarCoreV1 {
  integritySha256: string;
}

interface LoadedPendingCapture {
  sidecar: PendingSidecarV1;
  artifact: TcgaWebReplayPendingCaptureV1;
  candidatePath: string;
  sidecarPath: string;
}

interface PendingScanResult {
  matches: LoadedPendingCapture[];
  invalid: boolean;
  accountMismatch: boolean;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.trunc(parsed)) : fallback;
}

function normalizedLimits(options: Partial<TcgaWebReplayCaptureLimits>): TcgaWebReplayCaptureLimits {
  return {
    maxChannels: Math.min(positiveInteger(options.maxChannels, TCGA_WEB_REPLAY_MAX_CHANNELS), TCGA_WEB_REPLAY_MAX_CHANNELS),
    maxFramesPerChannel: Math.min(
      positiveInteger(options.maxFramesPerChannel, TCGA_WEB_REPLAY_MAX_FRAMES_PER_CHANNEL),
      TCGA_WEB_REPLAY_MAX_FRAMES_PER_CHANNEL
    ),
    maxFrameBytes: Math.min(positiveInteger(options.maxFrameBytes, TCGA_WEB_REPLAY_MAX_FRAME_BYTES), TCGA_WEB_REPLAY_MAX_FRAME_BYTES),
    maxBufferedBytes: Math.min(
      positiveInteger(options.maxBufferedBytes, TCGA_WEB_REPLAY_MAX_BUFFERED_BYTES),
      TCGA_WEB_REPLAY_MAX_BUFFERED_BYTES
    ),
    maxRawJsonBytes: Math.min(
      positiveInteger(options.maxRawJsonBytes, TCGA_WEB_REPLAY_MAX_RAW_JSON_BYTES),
      TCGA_WEB_REPLAY_MAX_RAW_JSON_BYTES
    ),
    maxGzipBytes: Math.min(positiveInteger(options.maxGzipBytes, TCGA_WEB_REPLAY_MAX_GZIP_BYTES), TCGA_WEB_REPLAY_MAX_GZIP_BYTES),
    preludeMs: positiveInteger(options.preludeMs, DEFAULT_PRELUDE_MS),
    completionGapMs: positiveInteger(options.completionGapMs, DEFAULT_COMPLETION_GAP_MS),
    pendingRetentionMs: Math.min(
      positiveInteger(options.pendingRetentionMs, TCGA_WEB_REPLAY_PENDING_RETENTION_MS),
      TCGA_WEB_REPLAY_MAX_PENDING_RETENTION_MS
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

function safeTimestamp(value: string | number): number | null {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function safeIdentifier(value: unknown): string {
  const clean = typeof value === "string" ? value.trim() : "";
  return clean && clean.length <= MAX_IDENTIFIER_LENGTH && !/[\u0000-\u001f\u007f]/.test(clean)
    ? clean
    : "";
}

function normalizedOutputDirectory(value: string): string {
  const clean = typeof value === "string" ? value.trim() : "";
  if (!clean || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new Error("A valid TCGA Web Replay output directory is required.");
  }
  return resolve(clean);
}

function safeWholeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function normalizedDiscordShareHubIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((hubId) => safeIdentifier(hubId))
    .filter(Boolean)))
    .slice(0, 10)
    .sort();
}

function hashesEqual(left: string, right: string): boolean {
  if (!isSha256(left) || !isSha256(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function pendingPayloadFilename(captureSessionId: string): string {
  return `${PENDING_FILE_PREFIX}${captureSessionId}${PENDING_PAYLOAD_SUFFIX}`;
}

function pendingSidecarFilename(captureSessionId: string): string {
  return `${PENDING_FILE_PREFIX}${captureSessionId}${PENDING_SIDECAR_SUFFIX}`;
}

function accountBindingSha256(accountUid: string): string {
  return createHash("sha256")
    .update("riftlite-tcga-awaiting-account\u0000v1\u0000")
    .update(accountUid)
    .digest("hex");
}

function pendingIntegritySha256(accountUid: string, core: PendingSidecarCoreV1): string {
  return createHmac("sha256", accountUid)
    .update("riftlite-tcga-awaiting-sidecar\u0000v1\u0000")
    .update(JSON.stringify(core))
    .digest("hex");
}

function channelKey(webContentsId: number, documentGeneration: number, captureChannelId: string): string {
  return `${webContentsId}\u0000${documentGeneration}\u0000${captureChannelId}`;
}

function documentTokenKey(webContentsId: number, documentId: string): string {
  return `${webContentsId}\u0000${documentId}`;
}

function matchWindow(context: TcgaWebReplayFinishContext): { startedAt: number; completedAt: number } | null {
  const startedAt = typeof context.capturedAt === "string" ? Date.parse(context.capturedAt) : Number.NaN;
  const completedAt = typeof context.completedAt === "string" ? Date.parse(context.completedAt) : Number.NaN;
  return Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt
    ? { startedAt, completedAt }
    : null;
}

function matchResultConfirmed(context: TcgaWebReplayFinishContext): boolean {
  const match = asRecord(context.match);
  const result = safeString(match?.result).trim().toLowerCase();
  // CaptureCoordinator explicitly marks automatic draft finalization false.
  // Undefined remains compatible with the existing matches:confirm caller.
  return context.confirmedResult !== false && (
    result === "win" || result === "loss" || result === "draw"
  );
}

function isUnsupportedMultiGameMatch(context: TcgaWebReplayFinishContext): boolean {
  const match = asRecord(context.match);
  if (!match) return true;
  const format = safeString(match.format).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const games = Array.isArray(match.games) ? match.games : [];
  return format === "bo3" || format === "bestof3" || games.length !== 1;
}

function privacySafeMatchSummary(
  context: TcgaWebReplayFinishContext
): TcgaWebReplayRawCaptureV1["capture"]["match"] | undefined {
  const match = asRecord(context.match);
  const result = safeString(match?.result).trim().toLowerCase();
  if (result !== "win" && result !== "loss" && result !== "draw" && result !== "incomplete") {
    return undefined;
  }
  const games = Array.isArray(match?.games) ? match.games : [];
  const soleGame = games.length === 1 ? asRecord(games[0]) : null;
  const wholePoints = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 99 ? parsed : undefined;
  };
  const perspectivePoints = wholePoints(soleGame?.perspectivePoints);
  const opponentPoints = wholePoints(soleGame?.opponentPoints);
  const points = perspectivePoints !== undefined && opponentPoints !== undefined
    ? { perspectivePoints, opponentPoints }
    : {};
  return {
    result,
    ...points
  };
}

function exactBase64Bytes(value: unknown, declaredBytes: unknown, maximumBytes: number): Uint8Array | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumBytes * 2 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value) ||
    value.length % 4 === 1
  ) {
    return null;
  }
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.byteLength < 1 ||
    decoded.byteLength > maximumBytes ||
    (Number.isFinite(Number(declaredBytes)) && Number(declaredBytes) !== decoded.byteLength)
  ) {
    return null;
  }
  const bytes = new Uint8Array(decoded.byteLength);
  bytes.set(decoded);
  return bytes;
}

function jsonValue(value: unknown, depth: number, budget: JsonBudget): TcgaReplayJsonValue {
  budget.remaining -= 1;
  if (budget.remaining < 0) throw new Error("Decoded TCGA payload is too complex to capture safely.");
  if (depth > MAX_JSON_DEPTH) throw new Error("Decoded TCGA payload is nested too deeply.");
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
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
    const result = value.map((entry) => jsonValue(entry, depth + 1, budget));
    budget.seen.delete(value);
    return result;
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
  if (!record || !safeString(record.type)) return null;
  const normalized = jsonValue(record, 0, {
    remaining: MAX_JSON_NODES,
    seen: new WeakSet()
  });
  const parsed = asRecord(normalized) as TcgaReplayRawMessageV1["parsed"] | null;
  return parsed && safeString(parsed.type) ? parsed : null;
}

function hasTransportIssues(finalization: TcgaPeerDecoderFinalization): boolean {
  return finalization.incompleteChunkGroups > 0 ||
    finalization.incompleteChunkCount > 0 ||
    finalization.duplicateChunks > 0 ||
    Object.values(finalization.issues).some((count) => count > 0);
}

function mergeRecord(
  current: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  return { ...(current ?? {}), ...incoming };
}

function setupStep(player: Record<string, unknown> | undefined): number | null {
  const parsed = Number(player?.setupStep);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function containsMulliganEvidence(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || value === undefined) return false;
  if (typeof value === "string") return /mulligan/i.test(value);
  if (Array.isArray(value)) return value.some((entry) => containsMulliganEvidence(entry, depth + 1));
  const record = asRecord(value);
  return record ? Object.entries(record).some(([key, nested]) => (
    /mulligan/i.test(key) || containsMulliganEvidence(nested, depth + 1)
  )) : false;
}

function containsMeaningfulGameHistory(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || value === undefined) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => containsMeaningfulGameHistory(entry, depth + 1));
  }
  const record = asRecord(value);
  if (!record) return false;
  for (const [key, nested] of Object.entries(record)) {
    if (
      /^(?:text|type|event|action|actionType|historyType)$/i.test(key) &&
      typeof nested === "string" &&
      nested.trim() &&
      !/mulligan/i.test(nested)
    ) {
      return true;
    }
    if ((Array.isArray(nested) || asRecord(nested)) && containsMeaningfulGameHistory(nested, depth + 1)) {
      return true;
    }
  }
  return false;
}

function normalizedCardSection(card: Record<string, unknown>): string {
  const position = asRecord(card.position);
  return safeString(position?.section)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function cardHasPublicIdentity(card: Record<string, unknown>): boolean {
  const cardData = asRecord(card.cardData);
  return Boolean(
    safeIdentifier(cardData?.id) ||
    safeString(cardData?.name).trim() ||
    safeIdentifier(card.code) ||
    safeString(card.name).trim()
  );
}

function playerHasCardIdentity(
  player: Record<string, unknown> | undefined,
  kind: "legend" | "battlefield"
): boolean {
  if (!player) return false;
  const directKeys = kind === "legend"
    ? ["legend", "legendCard"]
    : ["battlefield", "selectedBattlefield", "battlefieldCard"];
  if (directKeys.some((key) => {
    const value = player[key];
    const record = asRecord(value);
    return record ? cardHasPublicIdentity(record) : Boolean(safeString(value).trim());
  })) {
    return true;
  }
  const acceptedSections = kind === "legend"
    ? new Set(["legend"])
    : new Set(["battlefield", "battlefields", "selectedbattlefield"]);
  const visibleCards = Array.isArray(player.visibleCards) ? player.visibleCards : [];
  return visibleCards.some((value) => {
    const card = asRecord(value);
    return Boolean(card && acceptedSections.has(normalizedCardSection(card)) && cardHasPublicIdentity(card));
  });
}

function incrementRejection(
  counts: Partial<Record<TcgaWebReplayCandidateRejection, number>>,
  reason: TcgaWebReplayCandidateRejection
): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function sourceSha256(session: ChannelSession): string {
  const hash = createHash("sha256").update("riftlite-tcga-live-source\u0000v1\u0000");
  const frames = [...session.frames].sort((left, right) => (
    left.transportSequence - right.transportSequence || left.recordSeq - right.recordSeq
  ));
  for (const frame of frames) {
    hash.update(frame.direction).update("\u0000");
    hash.update(String(frame.transportSequence)).update("\u0000");
    hash.update(frame.capturedAt).update("\u0000");
    hash.update(String(frame.bytes.byteLength)).update("\u0000");
    hash.update(frame.bytes);
  }
  return hash.digest("hex");
}

function deterministicCaptureId(sourceHash: string, session: ChannelSession): string {
  const firstSequence = session.frames[0]?.transportSequence ?? 0;
  const lastSequence = session.frames.at(-1)?.transportSequence ?? firstSequence;
  const digest = createHash("sha256")
    .update("riftlite-tcga-raw-capture\u0000v1\u0000")
    .update(sourceHash)
    .update("\u0000")
    .update(session.captureChannelId)
    .update("\u0000")
    .update(String(firstSequence))
    .update("\u0000")
    .update(String(lastSequence))
    .digest("hex");
  return `tcga_${digest.slice(0, 48)}`;
}

async function writeAtomicallyIfAbsent(path: string, data: Buffer): Promise<void> {
  const existing = await readFile(path).catch(() => null);
  if (existing) {
    if (existing.equals(data)) return;
    throw new Error("A different TCGA Web Replay artifact already exists at the deterministic destination.");
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

function parsePendingSidecar(value: unknown): PendingSidecarV1 | null {
  const record = asRecord(value);
  const matchWindowRecord = asRecord(record?.matchWindow);
  const captureSessionId = safeIdentifier(record?.captureSessionId);
  const startedAt = safeWholeNumber(matchWindowRecord?.startedAt);
  const completedAt = safeWholeNumber(matchWindowRecord?.completedAt);
  const rawJsonBytes = safeWholeNumber(record?.rawJsonBytes);
  const compressedBytes = safeWholeNumber(record?.compressedBytes);
  const createdAt = safeWholeNumber(record?.createdAt);
  const expiresAt = safeWholeNumber(record?.expiresAt);
  const hasDiscordShareHubIds = Object.prototype.hasOwnProperty.call(record ?? {}, "discordShareHubIds");
  const discordShareHubIds = normalizedDiscordShareHubIds(record?.discordShareHubIds);
  if (
    record?.schema !== PENDING_SIDECAR_SCHEMA ||
    record.version !== 1 ||
    !/^tcga_[a-f0-9]{48}$/.test(captureSessionId) ||
    !isSha256(record.accountBindingSha256) ||
    !isSha256(record.sourceSha256) ||
    !isSha256(record.payloadSha256) ||
    !isSha256(record.integritySha256) ||
    startedAt === null ||
    completedAt === null ||
    completedAt < startedAt ||
    rawJsonBytes === null ||
    rawJsonBytes < 1 ||
    compressedBytes === null ||
    compressedBytes < 1 ||
    createdAt === null ||
    expiresAt === null ||
    expiresAt <= createdAt ||
    (hasDiscordShareHubIds && (
      !Array.isArray(record?.discordShareHubIds) ||
      discordShareHubIds.length !== record.discordShareHubIds.length
    )) ||
    record.payloadFile !== pendingPayloadFilename(captureSessionId)
  ) {
    return null;
  }
  return {
    schema: PENDING_SIDECAR_SCHEMA,
    version: 1,
    captureSessionId,
    accountBindingSha256: record.accountBindingSha256,
    ...(hasDiscordShareHubIds ? { discordShareHubIds } : {}),
    sourceSha256: record.sourceSha256,
    matchWindow: { startedAt, completedAt },
    payloadFile: record.payloadFile,
    payloadSha256: record.payloadSha256,
    rawJsonBytes,
    compressedBytes,
    createdAt,
    expiresAt,
    integritySha256: record.integritySha256
  };
}

function pendingSidecarCore(sidecar: PendingSidecarV1): PendingSidecarCoreV1 {
  return {
    schema: PENDING_SIDECAR_SCHEMA,
    version: 1,
    captureSessionId: sidecar.captureSessionId,
    accountBindingSha256: sidecar.accountBindingSha256,
    ...(sidecar.discordShareHubIds !== undefined
      ? { discordShareHubIds: [...sidecar.discordShareHubIds] }
      : {}),
    sourceSha256: sidecar.sourceSha256,
    matchWindow: {
      startedAt: sidecar.matchWindow.startedAt,
      completedAt: sidecar.matchWindow.completedAt
    },
    payloadFile: sidecar.payloadFile,
    payloadSha256: sidecar.payloadSha256,
    rawJsonBytes: sidecar.rawJsonBytes,
    compressedBytes: sidecar.compressedBytes,
    createdAt: sidecar.createdAt,
    expiresAt: sidecar.expiresAt
  };
}

function nullableTimestamp(value: unknown): number | null | "invalid" {
  if (value === null) return null;
  const parsed = safeWholeNumber(value);
  return parsed === null ? "invalid" : parsed;
}

function parsePendingArtifact(
  value: unknown,
  sidecar: PendingSidecarV1,
  limits: TcgaWebReplayCaptureLimits
): TcgaWebReplayPendingCaptureV1 | null {
  const record = asRecord(value);
  const capture = asRecord(record?.capture);
  const identity = asRecord(capture?.identity);
  const lifecycle = asRecord(capture?.lifecycle);
  const source = asRecord(capture?.source);
  const transport = asRecord(record?.transport);
  const issueCounts = asRecord(transport?.issueCounts);
  const captureSessionId = safeIdentifier(capture?.captureSessionId);
  const perspectivePlayerId = safeIdentifier(identity?.perspectivePlayerId);
  const firstSeenAt = safeWholeNumber(identity?.firstSeenAt);
  const lastSeenAt = safeWholeNumber(identity?.lastSeenAt);
  const openedAt = nullableTimestamp(lifecycle?.openedAt);
  const closedAt = nullableTimestamp(lifecycle?.closedAt);
  const channelKeyValue = safeIdentifier(lifecycle?.channelKey);
  const frames = safeWholeNumber(transport?.frames);
  const decodedFrames = safeWholeNumber(transport?.decodedFrames);
  const logicalMessages = safeWholeNumber(transport?.logicalMessages);
  const chunkGroups = safeWholeNumber(transport?.chunkGroups);
  const completeChunkGroups = safeWholeNumber(transport?.completeChunkGroups);
  const incompleteChunkGroups = safeWholeNumber(transport?.incompleteChunkGroups);
  const incompleteChunkCount = safeWholeNumber(transport?.incompleteChunkCount);
  const duplicateChunks = safeWholeNumber(transport?.duplicateChunks);
  const rawMessages = Array.isArray(record?.messages) ? record.messages : null;
  if (
    record?.schema !== PENDING_CAPTURE_SCHEMA ||
    record.version !== 1 ||
    !Number.isFinite(Date.parse(safeString(record.exportedAt))) ||
    !capture ||
    "match" in capture ||
    captureSessionId !== sidecar.captureSessionId ||
    !perspectivePlayerId ||
    firstSeenAt === null ||
    lastSeenAt === null ||
    lastSeenAt < firstSeenAt ||
    openedAt === "invalid" ||
    closedAt === "invalid" ||
    !channelKeyValue ||
    lifecycle?.endedByLeaving !== true && lifecycle?.endedByLeaving !== false ||
    source?.schema !== "riftlite-tcga-awaiting-result" ||
    source.version !== 1 ||
    !isSha256(source.sha256) ||
    !hashesEqual(source.sha256, sidecar.sourceSha256) ||
    frames === null ||
    frames < 1 ||
    frames > limits.maxFramesPerChannel ||
    decodedFrames !== frames ||
    logicalMessages === null ||
    logicalMessages > frames ||
    chunkGroups === null ||
    chunkGroups > frames ||
    completeChunkGroups !== chunkGroups ||
    incompleteChunkGroups !== 0 ||
    incompleteChunkCount !== 0 ||
    duplicateChunks !== 0 ||
    !issueCounts ||
    Object.values(issueCounts).some((count) => safeWholeNumber(count) !== 0) ||
    !rawMessages ||
    rawMessages.length > logicalMessages ||
    Math.abs(firstSeenAt - sidecar.matchWindow.startedAt) > limits.preludeMs ||
    Math.abs(lastSeenAt - sidecar.matchWindow.completedAt) > limits.completionGapMs
  ) {
    return null;
  }
  const messages: TcgaReplayRawMessageV1[] = [];
  for (const [index, rawMessage] of rawMessages.entries()) {
    const message = asRecord(rawMessage);
    const parsed = message ? decodedMessage(message.parsed) : null;
    const ts = safeWholeNumber(message?.ts);
    const firstTransportSequence = safeWholeNumber(message?.firstTransportSequence);
    const completedTransportSequence = safeWholeNumber(message?.completedTransportSequence);
    if (
      !message ||
      message.seq !== index ||
      ts === null ||
      (message.dir !== "in" && message.dir !== "out") ||
      firstTransportSequence === null ||
      completedTransportSequence === null ||
      completedTransportSequence < firstTransportSequence ||
      !parsed
    ) {
      return null;
    }
    messages.push({
      seq: index,
      ts,
      dir: message.dir,
      firstTransportSequence,
      completedTransportSequence,
      parsed
    });
  }
  return {
    schema: PENDING_CAPTURE_SCHEMA,
    version: 1,
    exportedAt: safeString(record.exportedAt),
    capture: {
      captureSessionId,
      identity: { perspectivePlayerId, firstSeenAt, lastSeenAt },
      lifecycle: {
        channelKey: channelKeyValue,
        openedAt,
        closedAt,
        endedByLeaving: lifecycle.endedByLeaving
      },
      source: {
        schema: "riftlite-tcga-awaiting-result",
        version: 1,
        sha256: source.sha256
      }
    },
    transport: {
      frames,
      decodedFrames,
      logicalMessages,
      chunkGroups,
      completeChunkGroups,
      incompleteChunkGroups,
      incompleteChunkCount,
      duplicateChunks,
      issueCounts: { ...issueCounts } as Record<TcgaTransportIssueCode, number>
    },
    messages
  };
}

/**
 * Product TCGA replay collection. It accepts only already-validated RTC game
 * channel events; research DOM/network evidence and Atlas frames have no entry
 * point into this service.
 */
export class TcgaWebReplayCaptureService<
  TContext extends TcgaWebReplayFinishContext = TcgaWebReplayFinishContext,
  TReplay = unknown,
  TRegistration = unknown
> {
  private readonly limits: TcgaWebReplayCaptureLimits;
  private readonly sessions = new Map<string, ChannelSession>();
  private readonly documentGenerations = new Map<number, number>();
  private readonly documentGenerationStartedAt = new Map<number, number>();
  private readonly pinnedDocumentGenerations = new Map<string, PinnedDocumentGeneration>();
  private readonly pendingDirectories = new Set<string>();
  private bufferedBytes = 0;
  private expectedAccountUid = "";
  private requestedAccountUid = "";
  private discordShareHubIds: string[] = [];
  private outputDirectory: string;
  private lifecycleTail: Promise<void> = Promise.resolve();

  constructor(
    outputDirectory: string,
    private readonly registerCapture: TcgaWebReplayRegistrationCallback<TContext, TReplay, TRegistration>,
    options: Partial<TcgaWebReplayCaptureLimits> = {}
  ) {
    this.outputDirectory = normalizedOutputDirectory(outputDirectory);
    this.pendingDirectories.add(this.outputDirectory);
    this.limits = normalizedLimits(options);
  }

  /**
   * Changes the private capture directory for subsequent sessions. Existing
   * in-memory channels are discarded fail-closed. Valid pending pairs are
   * copied atomically before their old copies are removed; anything malformed
   * stays in the old directory and remains part of this instance's scan set.
   */
  async setOutputDirectory(outputDirectory: string): Promise<{ migrated: number; leftBehind: number }> {
    return this.enqueueLifecycleOperation(() => this.setOutputDirectoryNow(outputDirectory));
  }

  private async setOutputDirectoryNow(outputDirectory: string): Promise<{ migrated: number; leftBehind: number }> {
    const nextDirectory = normalizedOutputDirectory(outputDirectory);
    if (nextDirectory === this.outputDirectory) return { migrated: 0, leftBehind: 0 };
    const previousDirectory = this.outputDirectory;
    this.clear();
    await mkdir(nextDirectory, { recursive: true });
    this.outputDirectory = nextDirectory;
    this.pendingDirectories.add(previousDirectory);
    this.pendingDirectories.add(nextDirectory);
    return this.migratePendingPairs(previousDirectory, nextDirectory);
  }

  async configure(outputDirectory: string, accountUid: string, discordShareHubIds: string[] = []): Promise<void> {
    const nextAccountUid = safeIdentifier(accountUid);
    const nextDiscordShareHubIds = normalizedDiscordShareHubIds(discordShareHubIds);
    this.requestedAccountUid = nextAccountUid;
    await this.enqueueLifecycleOperation(async () => {
      await this.setOutputDirectoryNow(outputDirectory);
      if (nextAccountUid) {
        await this.transitionAccountNow(nextAccountUid);
        this.discordShareHubIds = nextDiscordShareHubIds;
      } else {
        await this.withdrawConsentNow();
      }
      await this.cleanupExpiredPendingCapturesNow(Date.now(), this.expectedAccountUid);
    });
  }

  async setEnabled(accountUid: string, discordShareHubIds: string[] = []): Promise<void> {
    const nextAccountUid = safeIdentifier(accountUid);
    const nextDiscordShareHubIds = normalizedDiscordShareHubIds(discordShareHubIds);
    this.requestedAccountUid = nextAccountUid;
    await this.enqueueLifecycleOperation(async () => {
      if (nextAccountUid) {
        await this.transitionAccountNow(nextAccountUid);
        this.discordShareHubIds = nextDiscordShareHubIds;
      } else {
        await this.withdrawConsentNow();
      }
    });
  }

  /** Clears consent and removes every TCGA awaiting-result file known to this instance. */
  async withdrawConsent(): Promise<number> {
    this.requestedAccountUid = "";
    return this.enqueueLifecycleOperation(() => this.withdrawConsentNow());
  }

  /** Explicit privacy control for removing all awaiting-result material. */
  async purgePendingCaptures(): Promise<number> {
    return this.enqueueLifecycleOperation(() => this.purgePendingCapturesNow());
  }

  private async purgePendingCapturesNow(): Promise<number> {
    let removed = 0;
    for (const directory of this.pendingDirectories) {
      const names = await readdir(directory).catch(() => [] as string[]);
      for (const name of names) {
        if (!name.startsWith(PENDING_FILE_PREFIX) || !(
          name.endsWith(PENDING_PAYLOAD_SUFFIX) || name.endsWith(PENDING_SIDECAR_SUFFIX)
        )) {
          continue;
        }
        if (await unlink(join(directory, name)).then(() => true).catch(() => false)) removed += 1;
      }
    }
    return removed;
  }

  /** Removes expired pending captures and old orphan payloads. */
  async cleanupExpiredPendingCaptures(now = Date.now()): Promise<number> {
    return this.enqueueLifecycleOperation(() => this.cleanupExpiredPendingCapturesNow(now, this.expectedAccountUid));
  }

  private async cleanupExpiredPendingCapturesNow(now: number, expectedAccountUid: string): Promise<number> {
    const cutoff = now - this.limits.pendingRetentionMs;
    let removed = 0;
    for (const directory of this.pendingDirectories) {
      const names = await readdir(directory).catch(() => [] as string[]);
      const sidecarNames = new Set(names.filter((name) => (
        name.startsWith(PENDING_FILE_PREFIX) && name.endsWith(PENDING_SIDECAR_SUFFIX)
      )));
      for (const sidecarName of sidecarNames) {
        const sidecarPath = join(directory, sidecarName);
        const sidecar = await this.readSidecar(sidecarPath);
        const fileStat = await stat(sidecarPath).catch(() => null);
        const trustedSidecar = Boolean(
          sidecar &&
          expectedAccountUid &&
          hashesEqual(sidecar.accountBindingSha256, accountBindingSha256(expectedAccountUid)) &&
          hashesEqual(
            sidecar.integritySha256,
            pendingIntegritySha256(expectedAccountUid, pendingSidecarCore(sidecar))
          )
        );
        if (
          (sidecar && trustedSidecar && sidecar.expiresAt <= now) ||
          (!sidecar && fileStat && fileStat.mtimeMs <= cutoff)
        ) {
          const captureSessionId = sidecar?.captureSessionId ?? this.captureIdFromPendingFilename(
            sidecarName,
            PENDING_SIDECAR_SUFFIX
          );
          removed += await this.removePendingPair(directory, captureSessionId);
        }
      }
      for (const payloadName of names) {
        if (!payloadName.startsWith(PENDING_FILE_PREFIX) || !payloadName.endsWith(PENDING_PAYLOAD_SUFFIX)) continue;
        const captureSessionId = this.captureIdFromPendingFilename(payloadName, PENDING_PAYLOAD_SUFFIX);
        if (!captureSessionId || sidecarNames.has(pendingSidecarFilename(captureSessionId))) continue;
        const payloadPath = join(directory, payloadName);
        const fileStat = await stat(payloadPath).catch(() => null);
        if (fileStat && fileStat.mtimeMs <= cutoff) {
          if (await unlink(payloadPath).then(() => true).catch(() => false)) removed += 1;
        }
      }
    }
    return removed;
  }

  private captureIngressEnabled(): boolean {
    return Boolean(
      this.expectedAccountUid &&
      this.requestedAccountUid === this.expectedAccountUid
    );
  }

  private async transitionAccountNow(nextAccountUid: string): Promise<void> {
    if (nextAccountUid !== this.expectedAccountUid) {
      this.clear();
      this.pinnedDocumentGenerations.clear();
      this.expectedAccountUid = "";
    }
    // A process can exit after an account switch is committed to settings but
    // before the old in-memory service gets to withdraw its consent. On the
    // next launch expectedAccountUid starts empty, so comparing only with the
    // previous in-memory account would leave that old account's private pending
    // pair behind forever. The sidecar carries a one-way account binding: use
    // it to remove only well-formed pairs for other accounts while preserving
    // valid pending work for the account being enabled.
    await this.purgePendingCapturesForOtherAccountsNow(nextAccountUid);
    this.expectedAccountUid = nextAccountUid;
  }

  private async purgePendingCapturesForOtherAccountsNow(expectedAccountUid: string): Promise<number> {
    const expectedBinding = accountBindingSha256(expectedAccountUid);
    let removed = 0;
    for (const directory of this.pendingDirectories) {
      const names = await readdir(directory).catch(() => [] as string[]);
      for (const name of names) {
        if (!name.startsWith(PENDING_FILE_PREFIX) || !name.endsWith(PENDING_SIDECAR_SUFFIX)) continue;
        const sidecar = await this.readSidecar(join(directory, name));
        if (
          !sidecar ||
          name !== pendingSidecarFilename(sidecar.captureSessionId) ||
          hashesEqual(sidecar.accountBindingSha256, expectedBinding)
        ) {
          continue;
        }
        removed += await this.removePendingPair(directory, sidecar.captureSessionId);
      }
    }
    return removed;
  }

  private async withdrawConsentNow(): Promise<number> {
    this.clear();
    this.pinnedDocumentGenerations.clear();
    this.expectedAccountUid = "";
    this.discordShareHubIds = [];
    return this.purgePendingCapturesNow();
  }

  private enqueueLifecycleOperation<T>(operation: () => Promise<T> | T): Promise<T> {
    const queued = this.lifecycleTail.then(operation, operation);
    this.lifecycleTail = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  }

  beginDocument(webContentsId: number, startedAt: string | number = Date.now()): number {
    if (!Number.isSafeInteger(webContentsId) || webContentsId < 1) return -1;
    const generation = (this.documentGenerations.get(webContentsId) ?? -1) + 1;
    this.documentGenerations.set(webContentsId, generation);
    this.documentGenerationStartedAt.set(webContentsId, safeTimestamp(startedAt) ?? Date.now());
    this.ageDocumentState(webContentsId, generation);
    return generation;
  }

  ingestBindingEvent(webContentsId: number, event: TcgaWebReplayBindingEvent): boolean {
    if (!this.captureIngressEnabled()) return false;
    const currentGeneration = this.documentGenerations.get(webContentsId);
    const documentId = safeIdentifier(event.documentId);
    if (event.kind === "hook-ready" || event.kind === "hook-resumed") {
      return this.pinDocumentGeneration(webContentsId, documentId, event.capturedAt);
    }
    const pinnedGeneration = documentId
      ? this.pinnedDocumentGenerations.get(documentTokenKey(webContentsId, documentId))?.generation
      : undefined;
    const generation = pinnedGeneration ?? event.documentGeneration;
    if (
      currentGeneration === undefined ||
      generation === undefined ||
      generation !== currentGeneration ||
      (pinnedGeneration !== undefined && event.documentGeneration !== undefined && event.documentGeneration !== pinnedGeneration)
    ) {
      return false;
    }
    const payload = asRecord(event.payload);
    const channel = asRecord(payload?.channel);
    const captureChannelId = safeIdentifier(channel?.captureChannelId);
    if (!payload || !channel || safeString(channel.label) !== "game" || !captureChannelId) return false;
    if (event.kind === "rtc-channel") {
      const channelEvent = safeString(payload.event);
      if (!["observed", "open", "close", "error"].includes(channelEvent)) return false;
      return this.ingestChannel({
        webContentsId,
        documentGeneration: generation,
        captureChannelId,
        capturedAt: event.capturedAt,
        event: channelEvent as TcgaWebReplayRtcChannelEvent["event"]
      });
    }
    if (event.kind !== "rtc-data") return false;
    const data = asRecord(payload.data);
    const capturedAt = safeString(payload.transportCapturedAt) || event.capturedAt;
    if (!data || data.encoding !== "base64" || data.truncated === true || data.unavailable === true) {
      this.taintSession(webContentsId, generation, captureChannelId, capturedAt);
      return false;
    }
    const bytes = exactBase64Bytes(data.data, data.byteLength, this.limits.maxFrameBytes);
    if (!bytes) {
      this.taintSession(webContentsId, generation, captureChannelId, capturedAt);
      return false;
    }
    return this.ingestData({
      webContentsId,
      documentGeneration: generation,
      captureChannelId,
      capturedAt,
      transportSequence: Number(payload.transportSequence),
      direction: payload.direction as TcgaReplayRawDirection,
      bytes
    });
  }

  ingestChannel(event: TcgaWebReplayRtcChannelEvent): boolean {
    if (!this.captureIngressEnabled()) return false;
    const capturedAt = safeTimestamp(event.capturedAt);
    const identity = this.validIdentity(event.webContentsId, event.documentGeneration, event.captureChannelId);
    if (capturedAt === null || !identity) return false;
    const session = this.ensureSession(
      event.webContentsId,
      event.documentGeneration,
      identity,
      capturedAt
    );
    if (!session) return false;
    session.firstSeenAt = Math.min(session.firstSeenAt, capturedAt);
    session.lastSeenAt = Math.max(session.lastSeenAt, capturedAt);
    if (event.event === "observed" || event.event === "open") {
      session.openedAt = session.openedAt === null ? capturedAt : Math.min(session.openedAt, capturedAt);
    }
    if (event.event === "close" || event.event === "error") {
      session.closedAt = session.closedAt === null ? capturedAt : Math.max(session.closedAt, capturedAt);
    }
    return true;
  }

  ingestData(event: TcgaWebReplayRtcDataEvent): boolean {
    if (!this.captureIngressEnabled()) return false;
    const capturedAtMs = safeTimestamp(event.capturedAt);
    const identity = this.validIdentity(event.webContentsId, event.documentGeneration, event.captureChannelId);
    if (
      capturedAtMs === null ||
      !identity ||
      !Number.isSafeInteger(event.transportSequence) ||
      event.transportSequence < 0 ||
      (event.direction !== "in" && event.direction !== "out") ||
      !(event.bytes instanceof Uint8Array) ||
      event.bytes.byteLength < 1 ||
      event.bytes.byteLength > this.limits.maxFrameBytes
    ) {
      if (identity) {
        this.taintSession(
          event.webContentsId,
          event.documentGeneration,
          identity,
          event.capturedAt
        );
      }
      return false;
    }
    const session = this.ensureSession(
      event.webContentsId,
      event.documentGeneration,
      identity,
      capturedAtMs
    );
    if (!session || session.capped) return false;
    if (
      session.frames.length >= this.limits.maxFramesPerChannel ||
      this.bufferedBytes + event.bytes.byteLength > this.limits.maxBufferedBytes
    ) {
      session.capped = true;
      return false;
    }
    if (session.transportSequences.has(event.transportSequence)) {
      session.duplicateTransportSequence = true;
      return false;
    }
    const bytes = new Uint8Array(event.bytes.byteLength);
    bytes.set(event.bytes);
    const capturedAt = new Date(capturedAtMs).toISOString();
    session.frames.push({
      recordSeq: session.frames.length,
      transportSequence: event.transportSequence,
      capturedAt,
      capturedAtMs,
      direction: event.direction,
      bytes
    });
    session.transportSequences.add(event.transportSequence);
    session.byteSize += bytes.byteLength;
    session.firstSeenAt = Math.min(session.firstSeenAt, capturedAtMs);
    session.lastSeenAt = Math.max(session.lastSeenAt, capturedAtMs);
    this.bufferedBytes += bytes.byteLength;
    return true;
  }

  discardDocument(webContentsId: number, documentGeneration: number): number {
    let removed = 0;
    for (const session of this.sessions.values()) {
      if (session.webContentsId === webContentsId && session.documentGeneration === documentGeneration) {
        this.removeSession(session.key);
        removed += 1;
      }
    }
    for (const [key, pinned] of this.pinnedDocumentGenerations.entries()) {
      if (pinned.webContentsId === webContentsId && pinned.generation === documentGeneration) {
        this.pinnedDocumentGenerations.delete(key);
      }
    }
    return removed;
  }

  discardWebContents(webContentsId: number): number {
    let removed = 0;
    for (const session of this.sessions.values()) {
      if (session.webContentsId === webContentsId) {
        this.removeSession(session.key);
        removed += 1;
      }
    }
    this.documentGenerations.delete(webContentsId);
    this.documentGenerationStartedAt.delete(webContentsId);
    for (const [key, pinned] of this.pinnedDocumentGenerations.entries()) {
      if (pinned.webContentsId === webContentsId) {
        this.pinnedDocumentGenerations.delete(key);
      }
    }
    return removed;
  }

  clear(): void {
    this.sessions.clear();
    this.bufferedBytes = 0;
  }

  async finalize(
    context: TContext,
    replay?: TReplay
  ): Promise<TcgaWebReplayFinalizeResult<TRegistration>> {
    return this.enqueueLifecycleOperation(() => this.finalizeNow(context, replay));
  }

  private async finalizeNow(
    context: TContext,
    replay?: TReplay
  ): Promise<TcgaWebReplayFinalizeResult<TRegistration>> {
    const expectedAccountUid = this.expectedAccountUid;
    if (!expectedAccountUid) return this.skipped("capture-disabled", 0, 0, {});
    const window = matchWindow(context);
    if (!window) return this.skipped("invalid-match-window", 0, 0, {});
    if (isUnsupportedMultiGameMatch(context)) {
      return this.skipped("unsupported-multi-game-match", 0, 0, {});
    }
    await this.cleanupExpiredPendingCapturesNow(Date.now(), expectedAccountUid);
    const pendingScan = await this.scanPendingCaptures(window, expectedAccountUid);
    if (pendingScan.invalid) {
      return this.skipped("invalid-pending-artifact", pendingScan.matches.length, 0, {});
    }
    if (pendingScan.accountMismatch) {
      return this.skipped("consent-changed", pendingScan.matches.length, 0, {});
    }

    const sessions = [...this.sessions.values()].filter((session) => (
      session.frames.length > 0 &&
      Math.abs(session.firstSeenAt - window.startedAt) <= this.limits.preludeMs &&
      Math.abs(session.lastSeenAt - window.completedAt) <= this.limits.completionGapMs
    ));
    if (!sessions.length && !pendingScan.matches.length) {
      return this.skipped("no-match-window-candidate", 0, 0, {});
    }

    const rejectionCounts: Partial<Record<TcgaWebReplayCandidateRejection, number>> = {};
    const decoded = sessions.map((session) => this.decodeCandidate(session));
    const readyInMemory = decoded.filter((candidate) => {
      for (const reason of candidate.rejectionReasons) incrementRejection(rejectionCounts, reason);
      return candidate.rejectionReasons.length === 0;
    });
    const readyByCaptureId = new Map<string, {
      pending?: LoadedPendingCapture;
      memory?: DecodedCandidate;
    }>();
    for (const pending of pendingScan.matches) {
      readyByCaptureId.set(pending.sidecar.captureSessionId, { pending });
    }
    for (const candidate of readyInMemory) {
      const captureSessionId = this.candidateIdentity(candidate).captureSessionId;
      const existing = readyByCaptureId.get(captureSessionId);
      readyByCaptureId.set(captureSessionId, { ...existing, memory: candidate });
    }
    const consideredCandidates = sessions.length + pendingScan.matches.length;
    if (!readyByCaptureId.size) {
      return this.skipped("no-replay-ready-candidate", consideredCandidates, 0, rejectionCounts);
    }
    if (readyByCaptureId.size !== 1) {
      return this.skipped(
        "ambiguous-replay-candidate",
        consideredCandidates,
        readyByCaptureId.size,
        rejectionCounts
      );
    }

    const selected = [...readyByCaptureId.values()][0];
    if (selected.memory?.session.expectedAccountUid !== undefined &&
      selected.memory.session.expectedAccountUid !== expectedAccountUid) {
      return this.skipped("consent-changed", consideredCandidates, 1, rejectionCounts);
    }
    if (!matchResultConfirmed(context)) {
      const awaiting = selected.pending
        ? this.awaitingResultMetadata(selected.pending)
        : await this.persistAwaitingResult(selected.memory as DecodedCandidate, window, expectedAccountUid);
      if (selected.memory) this.removeSession(selected.memory.session.key);
      return {
        status: "awaiting-result",
        capture: awaiting,
        registration: null,
        consideredCandidates,
        readyCandidates: 1
      };
    }

    const capture = selected.pending
      ? await this.persistPendingAsProduct(selected.pending, context, expectedAccountUid)
      : await this.persistCandidate(selected.memory as DecodedCandidate, context, expectedAccountUid);
    let registration: TRegistration;
    try {
      registration = await this.registerCapture(capture, context, replay);
    } catch (error) {
      await unlink(capture.localPath).catch(() => undefined);
      throw error;
    }
    if (selected.pending) await this.removeLoadedPendingCapture(selected.pending);
    if (selected.memory) this.removeSession(selected.memory.session.key);
    this.pruneCompletedSessions(window.completedAt);
    return { status: "registered", capture, registration };
  }

  private validIdentity(webContentsId: number, documentGeneration: number, captureChannelId: string): string {
    if (
      !Number.isSafeInteger(webContentsId) ||
      webContentsId < 1 ||
      !Number.isSafeInteger(documentGeneration) ||
      documentGeneration < 0
    ) {
      return "";
    }
    return safeIdentifier(captureChannelId);
  }

  private pinDocumentGeneration(
    webContentsId: number,
    documentId: string,
    capturedAtValue: string | number
  ): boolean {
    if (!documentId) return false;
    const generation = this.documentGenerations.get(webContentsId);
    const generationStartedAt = this.documentGenerationStartedAt.get(webContentsId);
    const capturedAt = safeTimestamp(capturedAtValue);
    if (generation === undefined || generationStartedAt === undefined || capturedAt === null) return false;
    const key = documentTokenKey(webContentsId, documentId);
    const existing = this.pinnedDocumentGenerations.get(key);
    if (existing) {
      return existing.webContentsId === webContentsId && existing.generation === generation;
    }
    // A handshake captured before the current main-frame navigation belongs
    // to the document being replaced, even if CDP delivers it late.
    if (capturedAt < generationStartedAt) return false;
    this.pinnedDocumentGenerations.set(key, { webContentsId, generation });
    return true;
  }

  private ageDocumentState(webContentsId: number, currentGeneration: number): void {
    for (const session of this.sessions.values()) {
      if (session.webContentsId !== webContentsId) continue;
      const age = currentGeneration - session.documentGeneration;
      if (age > RETAINED_DOCUMENT_GENERATIONS || (age > 0 && session.frames.length === 0)) {
        this.removeSession(session.key);
      }
    }
    for (const [key, pinned] of this.pinnedDocumentGenerations.entries()) {
      if (
        pinned.webContentsId === webContentsId &&
        currentGeneration - pinned.generation > RETAINED_DOCUMENT_GENERATIONS
      ) {
        this.pinnedDocumentGenerations.delete(key);
      }
    }
  }

  private makeSessionCapacity(
    webContentsId: number,
    documentGeneration: number,
    capturedAt: number
  ): boolean {
    if (this.sessions.size < this.limits.maxChannels) return true;
    const stale = [...this.sessions.values()]
      .filter((session) => (
        session.webContentsId === webContentsId &&
        (
          session.documentGeneration < documentGeneration ||
          session.frames.length === 0 ||
          session.capped ||
          session.invalidIngressFrame ||
          session.closedAt !== null ||
          capturedAt - session.lastSeenAt > this.limits.completionGapMs
        )
      ))
      .sort((left, right) => (
        left.documentGeneration - right.documentGeneration ||
        left.lastSeenAt - right.lastSeenAt
      ));
    for (const session of stale) {
      this.removeSession(session.key);
      if (this.sessions.size < this.limits.maxChannels) return true;
    }
    return this.sessions.size < this.limits.maxChannels;
  }

  private ensureSession(
    webContentsId: number,
    documentGeneration: number,
    captureChannelId: string,
    capturedAt: number
  ): ChannelSession | null {
    const key = channelKey(webContentsId, documentGeneration, captureChannelId);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    if (!this.makeSessionCapacity(webContentsId, documentGeneration, capturedAt)) return null;
    const session: ChannelSession = {
      key,
      webContentsId,
      documentGeneration,
      captureChannelId,
      openedAt: null,
      closedAt: null,
      firstSeenAt: capturedAt,
      lastSeenAt: capturedAt,
      frames: [],
      byteSize: 0,
      capped: false,
      duplicateTransportSequence: false,
      invalidIngressFrame: false,
      transportSequences: new Set(),
      expectedAccountUid: this.expectedAccountUid,
      discordShareHubIds: [...this.discordShareHubIds]
    };
    this.sessions.set(key, session);
    return session;
  }

  private taintSession(
    webContentsId: number,
    documentGeneration: number,
    captureChannelId: string,
    capturedAtValue: string | number
  ): void {
    const identity = this.validIdentity(webContentsId, documentGeneration, captureChannelId);
    if (!identity) return;
    const key = channelKey(webContentsId, documentGeneration, identity);
    let session = this.sessions.get(key);
    const capturedAt = safeTimestamp(capturedAtValue);
    if (!session && capturedAt !== null) {
      session = this.ensureSession(webContentsId, documentGeneration, identity, capturedAt) ?? undefined;
    }
    if (!session) return;
    session.invalidIngressFrame = true;
    if (capturedAt !== null) {
      session.firstSeenAt = Math.min(session.firstSeenAt, capturedAt);
      session.lastSeenAt = Math.max(session.lastSeenAt, capturedAt);
    }
  }

  private decodeCandidate(session: ChannelSession): DecodedCandidate {
    const frames = [...session.frames].sort((left, right) => (
      left.transportSequence - right.transportSequence || left.recordSeq - right.recordSeq
    ));
    const decoder = new TcgaPeerMessageDecoder();
    const messages: TcgaReplayRawMessageV1[] = [];
    const playerIds = new Set<string>();
    const perspectiveIds = new Set<string>();
    const players = new Map<string, Record<string, unknown>>();
    const minimumSetupByPlayer = new Map<string, number>();
    const maximumSetupByPlayer = new Map<string, number>();
    let decodedFrames = 0;
    let logicalMessages = 0;
    let endedByLeaving = false;
    let sawOpeningState = false;
    let sawMulligan = false;
    let sawTurnState = false;
    let sawMeaningfulHistory = false;

    const rememberPlayer = (playerId: string, player: Record<string, unknown>) => {
      if (!playerId) return;
      playerIds.add(playerId);
      const merged = mergeRecord(players.get(playerId), player);
      players.set(playerId, merged);
      const step = setupStep(merged);
      if (step !== null) {
        minimumSetupByPlayer.set(playerId, Math.min(minimumSetupByPlayer.get(playerId) ?? step, step));
        maximumSetupByPlayer.set(playerId, Math.max(maximumSetupByPlayer.get(playerId) ?? step, step));
      }
      const knownPlayers = [...players.values()];
      if (
        knownPlayers.length >= 2 &&
        knownPlayers.every((knownPlayer) => {
          const knownStep = setupStep(knownPlayer);
          return knownStep !== null && knownStep <= 1;
        })
      ) {
        sawOpeningState = true;
      }
    };

    for (const [recordSeq, frame] of frames.entries()) {
      const result = decoder.push({
        recordSeq,
        transportSequence: frame.transportSequence,
        capturedAt: frame.capturedAt,
        direction: frame.direction,
        channelKey: session.key,
        bytes: frame.bytes
      });
      if (result.decodedFrame) decodedFrames += 1;
      logicalMessages += result.messages.length;
      for (const logical of result.messages) {
        let parsed: TcgaReplayRawMessageV1["parsed"] | null = null;
        try {
          parsed = decodedMessage(logical.value);
        } catch {
          session.capped = true;
        }
        if (!parsed) continue;
        const type = safeString(parsed.type);
        const gameId = safeIdentifier(parsed.gameId);
        const payload = asRecord(parsed.payload);
        if ((type === "NEWCOMMER_GAMEDATA" || type === "NEWCOMER_GAMEDATA") && payload) {
          const initialPlayers = asRecord(payload.players);
          for (const [playerId, value] of Object.entries(initialPlayers ?? {})) {
            const player = asRecord(value);
            const id = safeIdentifier(playerId);
            if (id && player) rememberPlayer(id, player);
          }
        } else if (type === "PLAYER_DATA" && gameId && payload) {
          rememberPlayer(gameId, payload);
        } else if (type === "GAME_DATA" && gameId && payload) {
          const playerData = asRecord(payload.playerData);
          if (playerData) rememberPlayer(gameId, playerData);
          const turnCount = Number(payload.turnCount);
          if (Number.isSafeInteger(turnCount) && turnCount >= 2) sawTurnState = true;
        }
        if (
          logical.direction === "out" &&
          (type === "PLAYER_DATA" || type === "GAME_DATA") &&
          gameId
        ) {
          perspectiveIds.add(gameId);
        }
        if (payload && containsMulliganEvidence(payload.newToHistory)) sawMulligan = true;
        if (payload && containsMeaningfulGameHistory(payload.newToHistory)) sawMeaningfulHistory = true;
        if (type === "LEAVING") endedByLeaving = true;
        if (type === "ping" || type === "pong") continue;
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
    const rejectionReasons: TcgaWebReplayCandidateRejection[] = [];
    if (session.capped) rejectionReasons.push("channel-capped");
    if (session.invalidIngressFrame) rejectionReasons.push("invalid-ingress-frame");
    if (session.duplicateTransportSequence) rejectionReasons.push("duplicate-transport-sequence");
    const perspectivePlayerId = perspectiveIds.size === 1 ? [...perspectiveIds][0] : "";
    if (!perspectivePlayerId || !playerIds.has(perspectivePlayerId)) rejectionReasons.push("missing-perspective");
    if (playerIds.size !== 2) rejectionReasons.push("player-count");
    const participantIds = [...playerIds];
    if (!sawOpeningState) rejectionReasons.push("missing-opening-state");
    if (!(
      participantIds.length === 2 &&
      participantIds.every((playerId) => (
        (minimumSetupByPlayer.get(playerId) ?? Number.POSITIVE_INFINITY) <= 1 &&
        (maximumSetupByPlayer.get(playerId) ?? -1) >= 10
      ))
    )) {
      rejectionReasons.push("missing-setup-progression");
    }
    if (!sawMulligan) rejectionReasons.push("missing-mulligan-evidence");
    if (!(
      sawTurnState &&
      participantIds.length === 2 &&
      participantIds.every((playerId) => (setupStep(players.get(playerId)) ?? -1) >= 10)
    )) {
      rejectionReasons.push("missing-in-game-state");
    }
    if (!sawMeaningfulHistory) rejectionReasons.push("missing-game-history");
    if (!(
      participantIds.length === 2 &&
      participantIds.every((playerId) => playerHasCardIdentity(players.get(playerId), "legend"))
    )) {
      rejectionReasons.push("missing-legend-identities");
    }
    if (!(
      participantIds.length === 2 &&
      participantIds.every((playerId) => playerHasCardIdentity(players.get(playerId), "battlefield"))
    )) {
      rejectionReasons.push("missing-battlefield-identities");
    }
    if (decodedFrames !== session.frames.length || hasTransportIssues(finalization)) {
      rejectionReasons.push("transport-issues");
    }
    return {
      session,
      messages,
      perspectivePlayerId,
      playerCount: playerIds.size,
      decodedFrames,
      logicalMessages,
      endedByLeaving,
      finalization,
      rejectionReasons
    };
  }

  private candidateIdentity(candidate: DecodedCandidate): {
    sourceHash: string;
    captureSessionId: string;
  } {
    const session = candidate.session;
    const sourceHash = sourceSha256(session);
    return { sourceHash, captureSessionId: deterministicCaptureId(sourceHash, session) };
  }

  private candidateTransport(candidate: DecodedCandidate): TcgaWebReplayRawCaptureV1["transport"] {
    return {
      frames: candidate.session.frames.length,
      decodedFrames: candidate.decodedFrames,
      logicalMessages: candidate.logicalMessages,
      chunkGroups: candidate.finalization.chunkGroups,
      completeChunkGroups: candidate.finalization.completeChunkGroups,
      incompleteChunkGroups: candidate.finalization.incompleteChunkGroups,
      incompleteChunkCount: candidate.finalization.incompleteChunkCount,
      duplicateChunks: candidate.finalization.duplicateChunks,
      issueCounts: { ...candidate.finalization.issues } as Record<TcgaTransportIssueCode, number>
    };
  }

  private candidateCaptureBase(candidate: DecodedCandidate, captureSessionId: string) {
    const session = candidate.session;
    return {
      captureSessionId,
      identity: {
        perspectivePlayerId: candidate.perspectivePlayerId,
        firstSeenAt: session.firstSeenAt,
        lastSeenAt: session.lastSeenAt
      },
      lifecycle: {
        channelKey: session.captureChannelId,
        openedAt: session.openedAt,
        closedAt: session.closedAt,
        endedByLeaving: candidate.endedByLeaving
      }
    };
  }

  private async persistAwaitingResult(
    candidate: DecodedCandidate,
    window: { startedAt: number; completedAt: number },
    expectedAccountUid: string
  ): Promise<TcgaWebReplayAwaitingResultCapture> {
    const { sourceHash, captureSessionId } = this.candidateIdentity(candidate);
    const artifact: TcgaWebReplayPendingCaptureV1 = {
      schema: PENDING_CAPTURE_SCHEMA,
      version: 1,
      exportedAt: new Date(candidate.session.closedAt ?? candidate.session.lastSeenAt).toISOString(),
      capture: {
        ...this.candidateCaptureBase(candidate, captureSessionId),
        source: {
          schema: "riftlite-tcga-awaiting-result",
          version: 1,
          sha256: sourceHash
        }
      },
      transport: this.candidateTransport(candidate),
      messages: candidate.messages
    };
    const rawJson = Buffer.from(JSON.stringify(artifact), "utf8");
    if (rawJson.byteLength > this.limits.maxRawJsonBytes) {
      throw new Error("TCGA awaiting-result artifact exceeds the raw JSON limit.");
    }
    const compressed = await gzipAsync(rawJson, { level: 9 });
    if (compressed.byteLength > this.limits.maxGzipBytes) {
      throw new Error("TCGA awaiting-result artifact exceeds the compressed limit.");
    }
    const createdAt = Date.now();
    const core: PendingSidecarCoreV1 = {
      schema: PENDING_SIDECAR_SCHEMA,
      version: 1,
      captureSessionId,
      accountBindingSha256: accountBindingSha256(expectedAccountUid),
      discordShareHubIds: [...candidate.session.discordShareHubIds],
      sourceSha256: sourceHash,
      matchWindow: { ...window },
      payloadFile: pendingPayloadFilename(captureSessionId),
      payloadSha256: createHash("sha256").update(compressed).digest("hex"),
      rawJsonBytes: rawJson.byteLength,
      compressedBytes: compressed.byteLength,
      createdAt,
      expiresAt: createdAt + this.limits.pendingRetentionMs
    };
    const sidecar: PendingSidecarV1 = {
      ...core,
      integritySha256: pendingIntegritySha256(expectedAccountUid, core)
    };
    await mkdir(this.outputDirectory, { recursive: true });
    const candidatePath = join(this.outputDirectory, core.payloadFile);
    const sidecarPath = join(this.outputDirectory, pendingSidecarFilename(captureSessionId));
    await writeAtomicallyIfAbsent(candidatePath, compressed);
    await writeAtomicallyIfAbsent(sidecarPath, Buffer.from(JSON.stringify(sidecar), "utf8"));
    return {
      captureSessionId,
      candidatePath,
      sidecarPath,
      firstSeenAt: candidate.session.firstSeenAt,
      lastSeenAt: candidate.session.lastSeenAt,
      expiresAt: core.expiresAt
    };
  }

  private awaitingResultMetadata(pending: LoadedPendingCapture): TcgaWebReplayAwaitingResultCapture {
    return {
      captureSessionId: pending.sidecar.captureSessionId,
      candidatePath: pending.candidatePath,
      sidecarPath: pending.sidecarPath,
      firstSeenAt: pending.artifact.capture.identity.firstSeenAt,
      lastSeenAt: pending.artifact.capture.identity.lastSeenAt,
      expiresAt: pending.sidecar.expiresAt
    };
  }

  private async persistCandidate(
    candidate: DecodedCandidate,
    context: TContext,
    expectedAccountUid: string
  ): Promise<TcgaWebReplayPreparedCapture> {
    const session = candidate.session;
    const { sourceHash, captureSessionId } = this.candidateIdentity(candidate);
    const match = privacySafeMatchSummary(context);
    if (!match || match.result === "incomplete") {
      throw new Error("A resolved TCGA match result is required for a product artifact.");
    }
    const rawCapture: TcgaWebReplayRawCaptureV1 = {
      schema: TCGA_REPLAY_RAW_SCHEMA,
      version: TCGA_REPLAY_RAW_VERSION,
      exportedAt: new Date(session.closedAt ?? session.lastSeenAt).toISOString(),
      capture: {
        ...this.candidateCaptureBase(candidate, captureSessionId),
        source: {
          schema: "riftlite-tcga-web-replay",
          version: 1,
          sha256: sourceHash
        },
        match
      },
      transport: this.candidateTransport(candidate),
      messages: candidate.messages
    };
    return this.writeProductArtifact(rawCapture, expectedAccountUid, candidate.session.discordShareHubIds);
  }

  private async persistPendingAsProduct(
    pending: LoadedPendingCapture,
    context: TContext,
    expectedAccountUid: string
  ): Promise<TcgaWebReplayPreparedCapture> {
    const match = privacySafeMatchSummary(context);
    if (!match || match.result === "incomplete") {
      throw new Error("A resolved TCGA match result is required for a product artifact.");
    }
    const artifact = pending.artifact;
    const rawCapture: TcgaWebReplayRawCaptureV1 = {
      schema: TCGA_REPLAY_RAW_SCHEMA,
      version: TCGA_REPLAY_RAW_VERSION,
      exportedAt: artifact.exportedAt,
      capture: {
        captureSessionId: artifact.capture.captureSessionId,
        identity: { ...artifact.capture.identity },
        lifecycle: { ...artifact.capture.lifecycle },
        source: {
          schema: "riftlite-tcga-web-replay",
          version: 1,
          sha256: artifact.capture.source.sha256
        },
        match
      },
      transport: {
        ...artifact.transport,
        issueCounts: { ...artifact.transport.issueCounts }
      },
      messages: artifact.messages
    };
    return this.writeProductArtifact(rawCapture, expectedAccountUid, pending.sidecar.discordShareHubIds ?? []);
  }

  private async writeProductArtifact(
    rawCapture: TcgaWebReplayRawCaptureV1,
    expectedAccountUid: string,
    discordShareHubIds: string[]
  ): Promise<TcgaWebReplayPreparedCapture> {
    const rawJson = Buffer.from(JSON.stringify(rawCapture), "utf8");
    if (rawJson.byteLength > this.limits.maxRawJsonBytes) {
      throw new Error("TCGA Web Replay artifact exceeds the raw JSON limit.");
    }
    const compressed = await gzipAsync(rawJson, { level: 9 });
    if (compressed.byteLength > this.limits.maxGzipBytes) {
      throw new Error("TCGA Web Replay artifact exceeds the compressed upload limit.");
    }
    await mkdir(this.outputDirectory, { recursive: true });
    const localPath = join(
      this.outputDirectory,
      `tcga-web-replay-${rawCapture.capture.captureSessionId}.json.gz`
    );
    await writeAtomicallyIfAbsent(localPath, compressed);
    return {
      platform: "tcga",
      artifactEncoding: "gzip",
      captureSessionId: rawCapture.capture.captureSessionId,
      localPath,
      messageCount: rawCapture.messages.length,
      frameCount: rawCapture.transport.frames,
      firstSeenAt: rawCapture.capture.identity.firstSeenAt,
      lastSeenAt: rawCapture.capture.identity.lastSeenAt,
      expectedAccountUid,
      discordShareHubIds: [...discordShareHubIds],
      rawJsonBytes: rawJson.byteLength,
      compressedBytes: compressed.byteLength,
      sha256: createHash("sha256").update(compressed).digest("hex")
    };
  }

  private async scanPendingCaptures(
    window: { startedAt: number; completedAt: number },
    expectedAccountUid: string
  ): Promise<PendingScanResult> {
    const matchesByCaptureId = new Map<string, LoadedPendingCapture>();
    let invalid = false;
    let accountMismatch = false;
    let inspected = 0;
    for (const directory of this.pendingDirectories) {
      const names = await readdir(directory).catch(() => [] as string[]);
      for (const name of names) {
        if (!name.startsWith(PENDING_FILE_PREFIX) || !name.endsWith(PENDING_SIDECAR_SUFFIX)) continue;
        inspected += 1;
        if (inspected > MAX_PENDING_CAPTURES) {
          invalid = true;
          continue;
        }
        const sidecarPath = join(directory, name);
        const sidecar = await this.readSidecar(sidecarPath);
        if (!sidecar || name !== pendingSidecarFilename(sidecar.captureSessionId)) {
          invalid = true;
          continue;
        }
        if (
          sidecar.matchWindow.startedAt !== window.startedAt ||
          sidecar.matchWindow.completedAt !== window.completedAt
        ) {
          continue;
        }
        if (!hashesEqual(sidecar.accountBindingSha256, accountBindingSha256(expectedAccountUid))) {
          accountMismatch = true;
          continue;
        }
        if (!hashesEqual(
          sidecar.integritySha256,
          pendingIntegritySha256(expectedAccountUid, pendingSidecarCore(sidecar))
        )) {
          invalid = true;
          continue;
        }
        const loaded = await this.loadPendingCapture(directory, sidecar, sidecarPath);
        if (!loaded) {
          invalid = true;
          continue;
        }
        const existing = matchesByCaptureId.get(sidecar.captureSessionId);
        if (existing && !hashesEqual(existing.sidecar.payloadSha256, sidecar.payloadSha256)) {
          invalid = true;
          continue;
        }
        if (!existing || directory === this.outputDirectory) {
          matchesByCaptureId.set(sidecar.captureSessionId, loaded);
        }
      }
    }
    return { matches: [...matchesByCaptureId.values()], invalid, accountMismatch };
  }

  private async readSidecar(sidecarPath: string): Promise<PendingSidecarV1 | null> {
    const fileStat = await stat(sidecarPath).catch(() => null);
    if (!fileStat || !fileStat.isFile() || fileStat.size < 1 || fileStat.size > MAX_PENDING_SIDECAR_BYTES) {
      return null;
    }
    try {
      return parsePendingSidecar(JSON.parse(await readFile(sidecarPath, "utf8")));
    } catch {
      return null;
    }
  }

  private async loadPendingCapture(
    directory: string,
    sidecar: PendingSidecarV1,
    sidecarPath: string
  ): Promise<LoadedPendingCapture | null> {
    if (
      sidecar.compressedBytes > this.limits.maxGzipBytes ||
      sidecar.rawJsonBytes > this.limits.maxRawJsonBytes
    ) {
      return null;
    }
    const candidatePath = join(directory, sidecar.payloadFile);
    const fileStat = await stat(candidatePath).catch(() => null);
    if (!fileStat || !fileStat.isFile() || fileStat.size !== sidecar.compressedBytes) return null;
    const compressed = await readFile(candidatePath).catch(() => null);
    if (!compressed || !hashesEqual(
      createHash("sha256").update(compressed).digest("hex"),
      sidecar.payloadSha256
    )) {
      return null;
    }
    try {
      const rawJson = await gunzipAsync(compressed, { maxOutputLength: this.limits.maxRawJsonBytes });
      if (rawJson.byteLength !== sidecar.rawJsonBytes) return null;
      const artifact = parsePendingArtifact(JSON.parse(rawJson.toString("utf8")), sidecar, this.limits);
      return artifact ? { sidecar, artifact, candidatePath, sidecarPath } : null;
    } catch {
      return null;
    }
  }

  private async removeLoadedPendingCapture(pending: LoadedPendingCapture): Promise<void> {
    await unlink(pending.sidecarPath).catch(() => undefined);
    await unlink(pending.candidatePath).catch(() => undefined);
  }

  private captureIdFromPendingFilename(name: string, suffix: string): string {
    if (!name.startsWith(PENDING_FILE_PREFIX) || !name.endsWith(suffix)) return "";
    const captureSessionId = name.slice(PENDING_FILE_PREFIX.length, -suffix.length);
    return /^tcga_[a-f0-9]{48}$/.test(captureSessionId) ? captureSessionId : "";
  }

  private async removePendingPair(directory: string, captureSessionId: string): Promise<number> {
    if (!/^tcga_[a-f0-9]{48}$/.test(captureSessionId)) return 0;
    let removed = 0;
    if (await unlink(join(directory, pendingSidecarFilename(captureSessionId))).then(() => true).catch(() => false)) {
      removed += 1;
    }
    if (await unlink(join(directory, pendingPayloadFilename(captureSessionId))).then(() => true).catch(() => false)) {
      removed += 1;
    }
    return removed;
  }

  private async migratePendingPairs(
    previousDirectory: string,
    nextDirectory: string
  ): Promise<{ migrated: number; leftBehind: number }> {
    const names = await readdir(previousDirectory).catch(() => [] as string[]);
    let migrated = 0;
    let leftBehind = 0;
    for (const name of names) {
      if (!name.startsWith(PENDING_FILE_PREFIX) || !name.endsWith(PENDING_SIDECAR_SUFFIX)) continue;
      const oldSidecarPath = join(previousDirectory, name);
      const sidecar = await this.readSidecar(oldSidecarPath);
      if (!sidecar || name !== pendingSidecarFilename(sidecar.captureSessionId)) {
        leftBehind += 1;
        continue;
      }
      const oldCandidatePath = join(previousDirectory, sidecar.payloadFile);
      try {
        const [sidecarBytes, candidateBytes] = await Promise.all([
          readFile(oldSidecarPath),
          readFile(oldCandidatePath)
        ]);
        if (
          sidecarBytes.byteLength > MAX_PENDING_SIDECAR_BYTES ||
          candidateBytes.byteLength !== sidecar.compressedBytes ||
          candidateBytes.byteLength > this.limits.maxGzipBytes ||
          !hashesEqual(createHash("sha256").update(candidateBytes).digest("hex"), sidecar.payloadSha256)
        ) {
          leftBehind += 1;
          continue;
        }
        await writeAtomicallyIfAbsent(join(nextDirectory, sidecar.payloadFile), candidateBytes);
        await writeAtomicallyIfAbsent(join(nextDirectory, name), sidecarBytes);
        await unlink(oldSidecarPath);
        await unlink(oldCandidatePath);
        migrated += 1;
      } catch {
        leftBehind += 1;
      }
    }
    return { migrated, leftBehind };
  }

  private skipped(
    reason: TcgaWebReplayFinalizeReason,
    consideredCandidates: number,
    readyCandidates: number,
    rejectionCounts: Partial<Record<TcgaWebReplayCandidateRejection, number>>
  ): TcgaWebReplayFinalizeResult<TRegistration> {
    return {
      status: "skipped",
      reason,
      consideredCandidates,
      readyCandidates,
      rejectionCounts
    };
  }

  private removeSession(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    this.bufferedBytes = Math.max(0, this.bufferedBytes - session.byteSize);
    this.sessions.delete(key);
  }

  private pruneCompletedSessions(completedAt: number): void {
    const cutoff = completedAt - this.limits.preludeMs;
    for (const session of this.sessions.values()) {
      if (session.lastSeenAt < cutoff) this.removeSession(session.key);
    }
  }
}
