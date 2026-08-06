import { app } from "electron";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import type {
  GamePlatform,
  RawCaptureAppendFramePayload,
  RawCaptureFrame,
  RawCaptureProcessingStatus,
  RawCaptureReplayMetadata,
  RawCaptureStatus,
  RawCaptureVisibility,
  ReplayRecord,
  RiftLiteReplayDiscordShareResult,
  RiftLiteReplayUploadResult,
  UserSettings,
  WebReplayDeliveryErrorClass,
  WebReplayDeliveryStage,
  WebReplayRecommendedAction,
  WebReplayUploadDiagnostics,
  WebReplayUploadFailureDiagnostic,
  WebReplayUploadLaneDiagnostics,
  WebReplayUploadQueueItem
} from "../../shared/types.js";
import { canonicalLegendName } from "../../shared/legendNames.js";
import { hasVerifiedRiftLiteAccount } from "../../shared/accountIdentity.js";
import type { RiftLiteStore } from "./store.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

type RawCapturePayload = {
  schema: "riftreplay-raw-capture";
  version: 1;
  exportedAt: string;
  capture: {
    captureSessionId: string;
    match?: RawCaptureMatchSummary;
    identity: {
      roomCode: string | null;
      roomCodes?: string[];
      seriesId?: string | null;
      matchId?: string | null;
      matchIds?: string[];
      replayId?: string | null;
      replayIds?: string[];
      firstSeenAt: number;
      lastSeenAt: number;
    };
    lifecycle: {
      lastPhase: string | null;
      lastGameNumber: number | null;
      boundaries: Array<{ at: number; reason: string }>;
      phases: RawCapturePhaseSegment[];
      games: RawCaptureGameSegment[];
    };
  };
  script: {
    name: string;
    version: string;
  };
  browser: {
    userAgent: string;
  };
  sockets: RawCaptureSocket[];
  filter: RawCaptureFilterStats;
  messages: RawCaptureFrame[];
  diagnostics: RawCaptureDiagnostic[];
};

type RawCaptureMatchResult = "win" | "loss" | "draw" | "incomplete";

export type RawCaptureMatchSummary = {
  format: "bo1" | "bo3";
  result: RawCaptureMatchResult;
  score: {
    perspective: number;
    opponent: number;
  };
  games: Array<{
    gameNumber: number;
    result: RawCaptureMatchResult;
    perspectivePoints?: number;
    opponentPoints?: number;
  }>;
};

export type RawCaptureDiscordActiveDeck = {
  title?: string;
  legend: string;
  sourceUrl: string;
};

function rawCaptureMetadataValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  }
  return false;
}

const RAW_CAPTURE_UPLOAD_LANE_FIELDS = [
  "uploadStatus",
  "uploadUrl",
  "uploadId",
  "statusEndpoint",
  "uploadedAt",
  "processingStatus",
  "checksumSha256",
  "compressedBytes",
  "error",
  "lastUploadAttemptAt",
  "processingUpdatedAt",
  "deliveryStage",
  "attemptCount",
  "nextRetryAt",
  "lastHttpStatus",
  "lastErrorCode",
  "lastErrorClass",
  "remoteStatusCheckedAt",
  "partialWarnings"
] as const satisfies ReadonlyArray<keyof RawCaptureReplayMetadata>;

const RAW_CAPTURE_DISCORD_LANE_FIELDS = [
  "webReplayAutoUploadEligible",
  "webReplayAutoUploadAccountUid",
  "webReplayDiscordShareEligible",
  "webReplayDiscordShareAccountUid",
  "webReplayDiscordShareHubIds",
  "discordShareStatus",
  "discordSharedHubIds",
  "discordShareError",
  "discordLastAttemptAt",
  "discordSharedAt"
] as const satisfies ReadonlyArray<keyof RawCaptureReplayMetadata>;

const RAW_CAPTURE_RESULT_LANE_FIELDS = [
  "resultStatus",
  "resultFinalizedAt"
] as const satisfies ReadonlyArray<keyof RawCaptureReplayMetadata>;

type RawCaptureMetadataRecord = Record<string, unknown>;
type RawCaptureLaneRevision = readonly [attempt: number, completion: number, rank: number];

function rawCaptureMetadataFieldChanged(
  base: RawCaptureMetadataRecord,
  next: RawCaptureMetadataRecord,
  key: keyof RawCaptureReplayMetadata
): boolean {
  const baseHasKey = Object.prototype.hasOwnProperty.call(base, key);
  const nextHasKey = Object.prototype.hasOwnProperty.call(next, key);
  return baseHasKey !== nextHasKey || !rawCaptureMetadataValuesEqual(base[key], next[key]);
}

function rawCaptureLaneChanged(
  base: RawCaptureMetadataRecord,
  next: RawCaptureMetadataRecord,
  fields: ReadonlyArray<keyof RawCaptureReplayMetadata>
): boolean {
  return fields.some((key) => rawCaptureMetadataFieldChanged(base, next, key));
}

function rawCaptureMetadataTimestamp(value: string | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareRawCaptureLaneRevision(left: RawCaptureLaneRevision, right: RawCaptureLaneRevision): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function rawCaptureUploadRevision(metadata: RawCaptureReplayMetadata): RawCaptureLaneRevision {
  const processingRank: Record<NonNullable<RawCaptureReplayMetadata["processingStatus"]>, number> = {
    pending: 1,
    uploading: 2,
    processing: 3,
    failed: 4,
    ready: 5
  };
  const uploadRank: Record<RawCaptureReplayMetadata["uploadStatus"], number> = {
    disabled: 1,
    "not-uploaded": 2,
    failed: 3,
    "too-large": 4,
    uploaded: 5
  };
  const attempt = rawCaptureMetadataTimestamp(metadata.lastUploadAttemptAt) ||
    rawCaptureMetadataTimestamp(metadata.uploadedAt) ||
    rawCaptureMetadataTimestamp(metadata.processingUpdatedAt) ||
    rawCaptureMetadataTimestamp(metadata.captureCompletedAt);
  const completion = Math.max(
    rawCaptureMetadataTimestamp(metadata.uploadedAt),
    rawCaptureMetadataTimestamp(metadata.processingUpdatedAt)
  );
  return [
    attempt,
    completion,
    uploadRank[metadata.uploadStatus] * 10 + (metadata.processingStatus ? processingRank[metadata.processingStatus] : 0)
  ];
}

function rawCaptureDiscordRevision(metadata: RawCaptureReplayMetadata): RawCaptureLaneRevision {
  const statusRank: Record<NonNullable<RawCaptureReplayMetadata["discordShareStatus"]>, number> = {
    pending: 1,
    failed: 2,
    partial: 3,
    shared: 4
  };
  const attempt = rawCaptureMetadataTimestamp(metadata.discordLastAttemptAt) ||
    rawCaptureMetadataTimestamp(metadata.discordSharedAt) ||
    rawCaptureMetadataTimestamp(metadata.captureCompletedAt);
  return [
    attempt,
    rawCaptureMetadataTimestamp(metadata.discordSharedAt),
    metadata.discordShareStatus ? statusRank[metadata.discordShareStatus] : 0
  ];
}

function rawCaptureUploadUpdateWins(
  current: RawCaptureReplayMetadata,
  incoming: RawCaptureReplayMetadata
): boolean {
  const currentUploaded = current.uploadStatus === "uploaded";
  const incomingUploaded = incoming.uploadStatus === "uploaded";
  if (currentUploaded !== incomingUploaded) {
    // Once a remote replay exists, a failed retry cannot make it cease to exist.
    return incomingUploaded;
  }
  return compareRawCaptureLaneRevision(
    rawCaptureUploadRevision(incoming),
    rawCaptureUploadRevision(current)
  ) > 0;
}

function rawCaptureDiscordUpdateWins(
  current: RawCaptureReplayMetadata,
  incoming: RawCaptureReplayMetadata
): boolean {
  return compareRawCaptureLaneRevision(
    rawCaptureDiscordRevision(incoming),
    rawCaptureDiscordRevision(current)
  ) > 0;
}

/**
 * Applies only the raw-capture fields changed by an operation. Upload, result
 * and Discord work can finish out of order, so replacing a complete metadata
 * snapshot would let an older operation roll unrelated newer state backwards.
 */
export function mergeRawCaptureReplayMetadata(
  current: RawCaptureReplayMetadata | undefined,
  operationBase: RawCaptureReplayMetadata | undefined,
  incoming: RawCaptureReplayMetadata
): RawCaptureReplayMetadata {
  if (
    current?.captureSessionId &&
    incoming.captureSessionId &&
    current.captureSessionId !== incoming.captureSessionId
  ) {
    return current;
  }
  const merged = { ...(current ?? incoming) } as Record<string, unknown>;
  const currentRecord = (current ?? {}) as unknown as RawCaptureMetadataRecord;
  const baseRecord = (operationBase ?? {}) as unknown as RawCaptureMetadataRecord;
  const incomingRecord = incoming as unknown as RawCaptureMetadataRecord;

  // A first attachment that lost a race may fill in missing core metadata.
  // Delivery/result lanes still use their revisions below so a concurrent
  // successful operation is not discarded merely because its caller started
  // before the first database attachment completed.
  const racingFirstAttachment = !operationBase && Boolean(current);

  const incomingUploadChanged = rawCaptureLaneChanged(baseRecord, incomingRecord, RAW_CAPTURE_UPLOAD_LANE_FIELDS);
  const currentUploadChanged = rawCaptureLaneChanged(baseRecord, currentRecord, RAW_CAPTURE_UPLOAD_LANE_FIELDS);
  const keepCurrentUpload = Boolean(
    current && incomingUploadChanged && currentUploadChanged && !rawCaptureUploadUpdateWins(current, incoming)
  );
  const incomingDiscordChanged = rawCaptureLaneChanged(baseRecord, incomingRecord, RAW_CAPTURE_DISCORD_LANE_FIELDS);
  const currentDiscordChanged = rawCaptureLaneChanged(baseRecord, currentRecord, RAW_CAPTURE_DISCORD_LANE_FIELDS);
  const keepCurrentDiscord = Boolean(
    current && incomingDiscordChanged && currentDiscordChanged && !rawCaptureDiscordUpdateWins(current, incoming)
  );
  const incomingResultChanged = rawCaptureLaneChanged(baseRecord, incomingRecord, RAW_CAPTURE_RESULT_LANE_FIELDS);
  const currentResultChanged = rawCaptureLaneChanged(baseRecord, currentRecord, RAW_CAPTURE_RESULT_LANE_FIELDS);
  const keepCurrentResult = Boolean(
    current &&
    incomingResultChanged &&
    currentResultChanged &&
    (
      (current.resultStatus === "resolved" && incoming.resultStatus !== "resolved") ||
      (
        current.resultStatus === incoming.resultStatus &&
        rawCaptureMetadataTimestamp(current.resultFinalizedAt) >= rawCaptureMetadataTimestamp(incoming.resultFinalizedAt)
      )
    )
  );

  const changedKeys = new Set([...Object.keys(baseRecord), ...Object.keys(incomingRecord)]);
  for (const key of changedKeys) {
    const currentHasKey = Object.prototype.hasOwnProperty.call(currentRecord, key);
    const uploadLaneKey = RAW_CAPTURE_UPLOAD_LANE_FIELDS.includes(key as typeof RAW_CAPTURE_UPLOAD_LANE_FIELDS[number]);
    const discordLaneKey = RAW_CAPTURE_DISCORD_LANE_FIELDS.includes(key as typeof RAW_CAPTURE_DISCORD_LANE_FIELDS[number]);
    const resultLaneKey = RAW_CAPTURE_RESULT_LANE_FIELDS.includes(key as typeof RAW_CAPTURE_RESULT_LANE_FIELDS[number]);
    if (keepCurrentUpload && uploadLaneKey && (!racingFirstAttachment || currentHasKey)) {
      continue;
    }
    if (keepCurrentDiscord && discordLaneKey && (!racingFirstAttachment || currentHasKey)) {
      continue;
    }
    if (keepCurrentResult && resultLaneKey && (!racingFirstAttachment || currentHasKey)) {
      continue;
    }
    if (racingFirstAttachment && !uploadLaneKey && !discordLaneKey && !resultLaneKey && currentHasKey) {
      continue;
    }
    const baseHasKey = Object.prototype.hasOwnProperty.call(baseRecord, key);
    const incomingHasKey = Object.prototype.hasOwnProperty.call(incomingRecord, key);
    if (
      baseHasKey === incomingHasKey &&
      rawCaptureMetadataValuesEqual(baseRecord[key], incomingRecord[key])
    ) {
      continue;
    }
    const value = incomingRecord[key];
    if (!incomingHasKey || value === undefined) {
      delete merged[key];
    } else {
      merged[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return merged as unknown as RawCaptureReplayMetadata;
}

type RawCaptureSourceRange = {
  fromSeq: number;
  toSeq: number;
};

type RawCapturePhaseSegment = {
  phase: string;
  normalizedPhase: string;
  gameNumber: number | null;
  roomCode: string | null;
  startedAt: number;
  endedAt: number;
  source: RawCaptureSourceRange;
};

type RawCaptureGameSegment = {
  gameNumber: number;
  startedAt: number;
  endedAt: number;
  roomCodes: string[];
  matchIds: string[];
  source: RawCaptureSourceRange;
  phases: RawCapturePhaseSegment[];
};

type RawCaptureSocket = {
  socketId: string;
  url: string;
  openedAt: number | null;
  closedAt: number | null;
  close: { code: number | null; reason: string; wasClean: boolean | null };
};

type RawCaptureFilterStats = {
  policyVersion: number;
  keptCount: number;
  droppedCount: number;
  droppedBytes: number;
  byType: Record<string, { kept: number; dropped: number }>;
};

type RawCaptureDiagnostic = {
  ts: number;
  severity: "info" | "warn" | "error";
  code: string;
  message: string;
  context?: Record<string, unknown> | null;
};

type ActiveRawCaptureSession = {
  captureSessionId: string;
  platform: GamePlatform;
  requestUrl: string;
  frames: RawCaptureFrame[];
  sockets: Record<string, RawCaptureSocket>;
  boundaries: Array<{ at: number; reason: string }>;
  diagnostics: RawCaptureDiagnostic[];
  nextSeq: number;
  byteSize: number;
  capped: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  roomCode: string;
  roomCodes: string[];
  seriesId: string;
  matchId: string;
  matchIds: string[];
  replayId: string;
  replayIds: string[];
  sourceCaptureSessionIds: string[];
  matchFormat: string;
  webReplayAutoUploadAccountUid: string;
  webReplayDiscordShareAccountUid: string;
  webReplayDiscordShareHubIds: string[];
  provisional: boolean;
  continuationSessionId?: string;
  lastPhase: string;
  lastGameNumber?: number;
  phases: RawCapturePhaseSegment[];
  games: RawCaptureGameSegment[];
  keptCount: number;
  droppedCount: number;
  droppedBytes: number;
  lastFrameType: string;
  lastError: string;
};

type RawCaptureJournalConsent = {
  webReplayAutoUploadAccountUid: string;
  webReplayDiscordShareAccountUid: string;
  webReplayDiscordShareHubIds: string[];
  provisional: boolean;
};

type RawCaptureJournalFrameEntry = {
  schema: "riftlite-active-raw-capture-journal";
  version: 1;
  kind: "frame";
  captureSessionId: string;
  requestUrl: string;
  frame: RawCaptureFrame;
  consent: RawCaptureJournalConsent;
};

type RawCaptureJournalCheckpointEntry = {
  schema: "riftlite-active-raw-capture-journal";
  version: 1;
  kind: "checkpoint";
  captureSessionId: string;
  session: ActiveRawCaptureSession;
};

type RawCaptureJournalEntry = RawCaptureJournalFrameEntry | RawCaptureJournalCheckpointEntry;

type PersistedRawCaptureJournal = {
  path: string;
  session: ActiveRawCaptureSession;
};

type RawCaptureRuntimeSettings = UserSettings["rawCapture"] & {
  uploadEnabled?: boolean;
};

export type LinkedAccountIdTokenProvider = (expectedAccountUid: string) => Promise<string | null>;
export type WebReplayPublishedHandler = (
  localMatchId: string,
  webReplayId: string,
  expectedAccountUid: string
) => Promise<void> | void;
export type ReplayUpdatedHandler = (replay: ReplayRecord) => Promise<void> | void;

export type RawCaptureFinishIdentity = {
  platform?: GamePlatform;
  captureSessionId?: string;
  roomCode?: string;
  roomCodes?: string[];
  seriesId?: string;
  matchId?: string;
  matchIds?: string[];
  replayId?: string;
  replayIds?: string[];
  localMatchId?: string;
  localReplayId?: string;
  title?: string;
  capturedAt?: string;
  completedAt?: string;
  match?: RawCaptureMatchSummary;
};

export type PreparedTcgaWebReplayCapture = {
  platform: "tcga";
  captureSessionId: string;
  localPath: string;
  artifactEncoding: "gzip";
  messageCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  expectedAccountUid: string;
  discordShareHubIds?: string[];
};

type RawCaptureReplayIdentity = {
  captureSessionIds: string[];
  roomCodes: string[];
  seriesIds: string[];
  matchIds: string[];
  replayIds: string[];
};

type PersistedRawCaptureManifest = {
  schema: "riftlite-raw-capture-index";
  version: 1;
  updatedAt: string;
  platform: "atlas" | "tcga";
  artifactEncoding?: "json" | "gzip";
  localPath: string;
  indexPath: string;
  /** Whether deletion/purge of a real local ReplayRecord is authoritative. */
  requiresLocalReplayParent?: boolean;
  /** Present when an active JSONL journal was promoted without a local replay parent. */
  recoveredFromJournalAt?: string;
  localReplayId?: string;
  localMatchId?: string;
  title?: string;
  match?: RawCaptureMatchSummary;
  identity: RawCaptureFinishIdentity;
  metadata: RawCaptureReplayMetadata;
};

type WebReplayDiagnosticEntry = {
  platform: "atlas" | "tcga";
  captureSessionId: string;
  localReplayId?: string;
  title: string;
  capturedAt: string;
  metadata: RawCaptureReplayMetadata;
};

type ReplayDeliveryError = Error & {
  status?: number;
  code?: string;
  errorClass?: WebReplayDeliveryErrorClass;
  retryable?: boolean;
  recommendedAction?: WebReplayRecommendedAction;
  retryAfterMs?: number;
};

type ReplayRemoteStatus = {
  processingStatus: RawCaptureProcessingStatus;
  deliveryStage: WebReplayDeliveryStage;
  retryable: boolean;
  recommendedAction: WebReplayRecommendedAction;
  retryAfterMs?: number;
  statusEndpoint?: string;
  playerPath?: string;
  visibility?: RawCaptureVisibility;
  failureMessage?: string;
  failureCode?: string;
  failureClass?: WebReplayDeliveryErrorClass;
  warnings: string[];
};

const RAW_CAPTURE_MAX_BYTES = 10 * 1024 * 1024;
const RAW_CAPTURE_MAX_MESSAGES = 12000;
const RAW_CAPTURE_MAX_ACTIVE_SESSIONS = 16;
const RAW_CAPTURE_MAX_ACTIVE_BYTES = 32 * 1024 * 1024;
const RAW_CAPTURE_SESSION_IDLE_MS = 6 * 60 * 60 * 1000;
const RAW_CAPTURE_FILTER_POLICY_VERSION = 2;
const RAW_CAPTURE_DROP_TYPES: Record<string, string> = {
  presence_update: "drop_type:presence_update"
};
const LEGACY_RIFTREPLAY_UPLOAD_ENDPOINT = "https://riftreplay.com/api/v1/replays";
const RIFTLITE_REPLAY_ORIGIN = "https://www.riftlite.com";
const RIFTLITE_REPLAY_V2_INIT_ENDPOINT = `${RIFTLITE_REPLAY_ORIGIN}/api/v2/replays/init`;
const RIFTLITE_REPLAY_V2_MAX_GZIP_BYTES = 4 * 1024 * 1024;
const RIFTLITE_REPLAY_V2_MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const PILTOVER_DECK_PATH_RE = /^\/decks\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const RAW_CAPTURE_INDEX_SUFFIX = ".riftlite-index.json";
const RAW_CAPTURE_JOURNAL_SUFFIX = ".riftlite-active.jsonl";
const RAW_CAPTURE_MAX_JOURNAL_BYTES = 32 * 1024 * 1024;
const RAW_CAPTURE_JOURNAL_HANDLE_IDLE_MS = 250;
const RAW_CAPTURE_RECOVERY_WARNING = "Recovered after an unexpected desktop shutdown. The final moments of this replay may be missing.";
const RAW_CAPTURE_RETENTION_WARNING = "Retained locally before RiftLite released an inactive capture session whose replay association had not completed.";
const FIREBASE_API_KEY = "AIzaSyBNqEY-i_CggjhDKVltoPQFrSOEfHF7fBA";
const RAW_CAPTURE_TEMPORAL_MAX_PRELUDE_MS = 15 * 60 * 1000;
const RAW_CAPTURE_TEMPORAL_MAX_END_GAP_MS = 3 * 60 * 1000;
const RAW_CAPTURE_TEMPORAL_MAX_MATCH_MS = 6 * 60 * 60 * 1000;
const RAW_CAPTURE_MAX_DATE_MS = 8_640_000_000_000_000;
const RAW_CAPTURE_AUTO_UPLOAD_RETRY_COOLDOWN_MS = 2 * 60 * 1000;
const RAW_CAPTURE_MAX_AUTO_UPLOAD_RETRY_DELAY_MS = 30 * 60 * 1000;
const RAW_CAPTURE_STALE_PROCESSING_MS = 10 * 60 * 1000;
const RIFTLITE_REPLAY_REQUEST_TIMEOUT_MS = 30_000;
const RIFTLITE_REPLAY_UPLOAD_REQUEST_TIMEOUT_MS = 60_000;
const RIFTLITE_REPLAY_AUTH_TIMEOUT_MS = 30_000;
const RIFTLITE_REPLAY_MAX_IN_CALL_RETRY_DELAY_MS = 1_000;
const RAW_CAPTURE_DISCORD_RESULT_INITIAL_WAIT_MS = 15_000;
const RAW_CAPTURE_DISCORD_RESULT_POLL_MS = 2_500;
const RAW_CAPTURE_DISCORD_RESULT_MAX_WAIT_MS = 30_000;

class RawCaptureParentInactiveError extends Error {
  constructor() {
    super("The local replay or match was removed while its Web Replay operation was running.");
    this.name = "RawCaptureParentInactiveError";
  }
}

class RawCaptureDiscordConsentChangedError extends Error {
  constructor() {
    super("Automatic Discord replay sharing was cancelled because its destination consent changed.");
    this.name = "RawCaptureDiscordConsentChangedError";
  }
}

type RawCaptureTemporalWindow = {
  startedAt: number;
  completedAt: number;
};

export class RawCaptureService {
  private readonly sessions = new Map<string, ActiveRawCaptureSession>();
  private readonly sessionIdByTransport = new Map<string, string>();
  private readonly finalizingSessionIds = new Set<string>();
  private lastUploadUrl = "";
  private lastAssociationError = "";
  private pendingUploadPromise: Promise<number> | null = null;
  private pendingForcedUploadRequested = false;
  private pendingForcedUploadLimit = 0;
  private appendFrameTail: Promise<void> = Promise.resolve();
  private readonly captureTaskTails = new Map<string, Promise<void>>();
  private readonly journalPathsBySessionId = new Map<string, string>();
  private readonly journalHandlesBySessionId = new Map<string, FileHandle>();
  private readonly journalHandleCloseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly ownedJournalPaths = new Set<string>();
  private readonly journalRewriteSessionIds = new Set<string>();
  private readonly journalCleanupPaths = new Set<string>();
  private journalRecoveryPromise: Promise<void> | null = null;

  constructor(
    private readonly store: RiftLiteStore,
    private readonly linkedAccountIdTokenProvider: LinkedAccountIdTokenProvider = (expectedAccountUid) => (
      firebaseIdTokenFromSettings(store, expectedAccountUid)
    ),
    private readonly webReplayPublishedHandler: WebReplayPublishedHandler = () => undefined,
    private readonly replayUpdatedHandler: ReplayUpdatedHandler = () => undefined
  ) {}

  async appendFrame(payload: RawCaptureAppendFramePayload): Promise<void> {
    const operation = this.appendFrameTail.then(() => this.appendFrameNow(payload));
    this.appendFrameTail = operation.catch(() => undefined);
    return operation;
  }

  private async appendFrameNow(payload: RawCaptureAppendFramePayload): Promise<void> {
    if (payload.platform !== "atlas") {
      return;
    }
    const settings = await this.store.getSettings();
    await this.ensureInterruptedCaptureRecovery(settings);
    if (!settings.rawCapture.enabled) {
      await this.clearSessionsAndJournals();
      return;
    }
    const raw = payload.frame.raw;
    const details = extractRawCaptureDetails(raw);
    if (!shouldKeepRawFrame(raw, details.type)) {
      return;
    }
    const ts = Number.isFinite(payload.frame.ts) ? payload.frame.ts : Date.now();
    const requestUrl = payload.requestUrl || "";
    const socketId = payload.frame.socketId || "ws-1";
    await this.pruneStaleSessions(ts, settings);
    if (
      this.sessions.size >= RAW_CAPTURE_MAX_ACTIVE_SESSIONS &&
      this.frameNeedsNewSession(details, socketId, requestUrl)
    ) {
      await this.retainOldestCompletedSession(settings, ts);
    }
    const webReplayAutoUploadAccountUid = riftLiteWebReplayAutoUploadAccountUid(settings);
    const discordShareHubIds = riftLiteWebReplayDiscordShareHubIds(settings);
    const webReplayDiscordShareAccountUid = discordShareHubIds.length
      ? normalizeRiftLiteAccountUid(settings.accountUid)
      : "";
    const session = this.sessionForFrame(
      details,
      socketId,
      requestUrl,
      ts,
      webReplayAutoUploadAccountUid,
      webReplayDiscordShareAccountUid,
      discordShareHubIds
    );
    if (session.capped) {
      return;
    }
    const frameBytes = Buffer.byteLength(raw, "utf8");
    const nextByteSize = session.byteSize + frameBytes;
    const nextAggregateByteSize = Array.from(this.sessions.values())
      .reduce((total, activeSession) => total + activeSession.byteSize, 0) + frameBytes;
    if (
      nextByteSize > RAW_CAPTURE_MAX_BYTES ||
      nextAggregateByteSize > RAW_CAPTURE_MAX_ACTIVE_BYTES ||
      session.frames.length >= RAW_CAPTURE_MAX_MESSAGES
    ) {
      session.capped = true;
      session.lastError = nextAggregateByteSize > RAW_CAPTURE_MAX_ACTIVE_BYTES
        ? "Raw capture memory limit reached. RiftLite stopped buffering additional replay data."
        : "Raw capture too large. RiftLite stopped buffering this replay.";
      return;
    }
    if (!session.sockets[socketId]) {
      session.sockets[socketId] = {
        socketId,
        url: requestUrl,
        openedAt: ts,
        closedAt: null,
        close: { code: null, reason: "", wasClean: null }
      };
    } else if (requestUrl && !session.sockets[socketId].url) {
      session.sockets[socketId].url = requestUrl;
    }
    this.updateLifecycle(session, details, ts, session.nextSeq);
    const dropReason = details.type ? RAW_CAPTURE_DROP_TYPES[details.type] || null : null;
    const frame: RawCaptureFrame = {
      seq: session.nextSeq,
      ts,
      dir: payload.frame.dir,
      socketId,
      type: details.type || null,
      raw,
      drop: Boolean(dropReason),
      dropReason
    };
    session.nextSeq += 1;
    session.frames.push(frame);
    session.byteSize = nextByteSize;
    session.lastSeenAt = ts;
    session.requestUrl = requestUrl || session.requestUrl;
    session.roomCode = details.roomCode || session.roomCode;
    rememberRoomCode(session, details.roomCode);
    session.seriesId = details.seriesId || session.seriesId;
    session.matchId = details.matchId || session.matchId;
    rememberRawCaptureIdentity(session.matchIds, details.matchId);
    session.replayId = details.replayId || session.replayId;
    rememberRawCaptureIdentity(session.replayIds, details.replayId);
    rememberRawCaptureIdentity(session.sourceCaptureSessionIds, details.captureSessionId);
    session.matchFormat = details.matchFormat || session.matchFormat;
    if (session.provisional && isAuthoritativeRawCaptureFrame(details)) {
      session.webReplayAutoUploadAccountUid = webReplayAutoUploadAccountUid;
      session.webReplayDiscordShareAccountUid = webReplayDiscordShareAccountUid;
      session.webReplayDiscordShareHubIds = [...discordShareHubIds];
      session.provisional = false;
      session.continuationSessionId = undefined;
    }
    session.lastPhase = details.phase || session.lastPhase;
    session.lastGameNumber = details.gameNumber ?? session.lastGameNumber;
    session.lastFrameType = details.type || session.lastFrameType;
    if (dropReason) {
      session.droppedCount += 1;
      session.droppedBytes += Buffer.byteLength(raw, "utf8");
    } else {
      session.keptCount += 1;
    }
    await this.checkpointActiveSession(session, frame, settings);
  }

  private sessionForFrame(
    details: RawCaptureFrameDetails,
    socketId: string,
    requestUrl: string,
    ts: number,
    webReplayAutoUploadAccountUid: string,
    webReplayDiscordShareAccountUid: string,
    webReplayDiscordShareHubIds: string[]
  ): ActiveRawCaptureSession {
    const routedSessionId = rawCaptureTransportKeys(requestUrl, socketId)
      .map((key) => this.sessionIdByTransport.get(key))
      .find(Boolean);
    let routedSession = routedSessionId && !this.finalizingSessionIds.has(routedSessionId)
      ? this.sessions.get(routedSessionId)
      : undefined;
    const startsNewPrelude = details.type === "search" && Boolean(routedSession && !routedSession.provisional);
    let session = startsNewPrelude ? null : this.findSessionForFrameIdentity(details);
    if (session && hasRawCaptureIdentityConflict(session, details)) {
      session = null;
    }

    if (routedSession?.provisional && routedSession.continuationSessionId) {
      const continuation = this.sessions.get(routedSession.continuationSessionId);
      if (
        continuation &&
        !this.finalizingSessionIds.has(continuation.captureSessionId) &&
        canMergeProvisionalRawCaptureSession(continuation, routedSession, details)
      ) {
        this.mergeProvisionalSession(continuation, routedSession);
        routedSession = continuation;
        session = continuation;
      }
    }
    if (
      session &&
      routedSession &&
      session.captureSessionId !== routedSession.captureSessionId &&
      canMergeProvisionalRawCaptureSession(session, routedSession, details)
    ) {
      this.mergeProvisionalSession(session, routedSession);
      routedSession = session;
    }
    if (!session && !startsNewPrelude && routedSession && !hasRawCaptureIdentityConflict(routedSession, details)) {
      session = routedSession;
    }
    if (!session) {
      session = this.createSession(
        requestUrl,
        ts,
        routedSession?.captureSessionId,
        webReplayAutoUploadAccountUid,
        webReplayDiscordShareAccountUid,
        webReplayDiscordShareHubIds
      );
    }
    if (
      details.roomCode &&
      session.roomCode &&
      !identityEquals(details.roomCode, session.roomCode) &&
      !session.roomCodes.some((roomCode) => identityEquals(roomCode, details.roomCode))
    ) {
      session.boundaries.push({
        at: ts,
        reason: `room-code-change:${session.roomCode}->${details.roomCode}`
      });
    }
    for (const key of rawCaptureTransportKeys(requestUrl, socketId)) {
      this.sessionIdByTransport.set(key, session.captureSessionId);
    }
    return session;
  }

  private findSessionForFrameIdentity(details: RawCaptureFrameDetails): ActiveRawCaptureSession | null {
    const availableSessions = Array.from(this.sessions.values())
      .filter((session) => !this.finalizingSessionIds.has(session.captureSessionId));
    const findUnique = (predicate: (session: ActiveRawCaptureSession) => boolean) => (
      uniqueRawCaptureSession(availableSessions.filter(predicate))
    );
    if (details.captureSessionId) {
      const matched = findUnique((session) => (
        identityEquals(session.captureSessionId, details.captureSessionId) ||
        session.sourceCaptureSessionIds.some((id) => identityEquals(id, details.captureSessionId))
      ));
      if (matched) {
        return matched;
      }
    }
    for (const [value, select] of [
      [details.seriesId, (session: ActiveRawCaptureSession) => session.seriesId],
      [details.matchId, (session: ActiveRawCaptureSession) => [session.matchId, ...session.matchIds]],
      [details.replayId, (session: ActiveRawCaptureSession) => [session.replayId, ...session.replayIds]]
    ] as const) {
      if (value) {
        const matched = findUnique((session) => {
          const selected = select(session);
          const candidates = Array.isArray(selected) ? selected : [selected];
          return candidates.some((candidate) => identityEquals(candidate, value));
        });
        if (matched) {
          return matched;
        }
      }
    }
    for (const roomCode of [details.previousRoomCode, details.roomCode]) {
      if (!roomCode) {
        continue;
      }
      const matched = findUnique((session) => (
        identityEquals(session.roomCode, roomCode) ||
        session.roomCodes.some((knownRoomCode) => identityEquals(knownRoomCode, roomCode))
      ));
      if (matched) {
        return matched;
      }
    }
    return null;
  }

  private createSession(
    requestUrl: string,
    ts: number,
    continuationSessionId: string | undefined,
    webReplayAutoUploadAccountUid: string,
    webReplayDiscordShareAccountUid: string,
    webReplayDiscordShareHubIds: string[]
  ): ActiveRawCaptureSession {
    const atCapacity = this.sessions.size >= RAW_CAPTURE_MAX_ACTIVE_SESSIONS;
    const session: ActiveRawCaptureSession = {
      captureSessionId: randomUUID(),
      platform: "atlas",
      requestUrl,
      frames: [],
      sockets: {},
      boundaries: [{ at: ts, reason: "session-start" }],
      diagnostics: [],
      nextSeq: 0,
      byteSize: 0,
      capped: atCapacity,
      firstSeenAt: ts,
      lastSeenAt: ts,
      roomCode: "",
      roomCodes: [],
      seriesId: "",
      matchId: "",
      matchIds: [],
      replayId: "",
      replayIds: [],
      sourceCaptureSessionIds: [],
      matchFormat: "",
      webReplayAutoUploadAccountUid,
      webReplayDiscordShareAccountUid,
      webReplayDiscordShareHubIds: [...webReplayDiscordShareHubIds],
      provisional: true,
      continuationSessionId,
      lastPhase: "",
      phases: [],
      games: [],
      keptCount: 0,
      droppedCount: 0,
      droppedBytes: 0,
      lastFrameType: "",
      lastError: atCapacity
        ? "Raw capture session limit reached. RiftLite ignored additional replay sessions."
        : ""
    };
    if (!atCapacity) {
      this.sessions.set(session.captureSessionId, session);
    }
    return session;
  }

  private async pruneStaleSessions(now: number, settings: UserSettings): Promise<void> {
    const staleSessions = [...this.sessions.values()].filter((session) => (
      !this.finalizingSessionIds.has(session.captureSessionId) &&
      now >= session.lastSeenAt &&
      now - session.lastSeenAt > RAW_CAPTURE_SESSION_IDLE_MS
    ));
    for (const session of staleSessions) {
      if (this.sessionHasDurableRetentionEvidence(session)) {
        await this.retainSessionDurably(session, settings, now, "idle-retention");
      } else {
        // Search/prelude-only journals are not match captures. Preserve the
        // existing bounded cleanup behavior for them instead of growing the
        // replay folder with unusable orphan artifacts.
        await this.discardSessionJournal(session.captureSessionId);
        this.forgetSessionInMemory(session.captureSessionId);
      }
    }
  }

  private sessionHasDurableRetentionEvidence(session: ActiveRawCaptureSession): boolean {
    if (session.provisional) {
      return false;
    }
    const hasGameplayPhase = [...session.phases, ...session.games.flatMap((game) => game.phases)]
      .some((phase) => [
        "matchup", "initiative", "mulligan", "battlefield", "in_game", "sideboarding", "game_end"
      ].includes(phase.normalizedPhase || normalizeAtlasReplayPhase(phase.phase)));
    return hasGameplayPhase ||
      session.lastFrameType === "room_shell_leave" ||
      session.boundaries.some((boundary) => boundary.reason === "end-of-match");
  }

  private frameNeedsNewSession(
    details: RawCaptureFrameDetails,
    socketId: string,
    requestUrl: string
  ): boolean {
    const routedSessionId = rawCaptureTransportKeys(requestUrl, socketId)
      .map((key) => this.sessionIdByTransport.get(key))
      .find(Boolean);
    const routedSession = routedSessionId && !this.finalizingSessionIds.has(routedSessionId)
      ? this.sessions.get(routedSessionId)
      : undefined;
    if (details.type === "search" && routedSession && !routedSession.provisional) {
      return true;
    }
    const identitySession = this.findSessionForFrameIdentity(details);
    if (identitySession && !hasRawCaptureIdentityConflict(identitySession, details)) {
      return false;
    }
    return !routedSession || hasRawCaptureIdentityConflict(routedSession, details);
  }

  private async retainOldestCompletedSession(settings: UserSettings, now: number): Promise<boolean> {
    const candidate = [...this.sessions.values()]
      .filter((session) => !this.finalizingSessionIds.has(session.captureSessionId))
      .filter((session) => {
        const phase = normalizeAtlasReplayPhase(session.lastPhase);
        return phase === "game_end" ||
          session.lastFrameType === "room_shell_leave" ||
          session.boundaries.some((boundary) => boundary.reason === "end-of-match");
      })
      .sort((left, right) => left.lastSeenAt - right.lastSeenAt)[0];
    return candidate ? this.retainSessionDurably(candidate, settings, now, "capacity-retention") : false;
  }

  private async retainSessionDurably(
    session: ActiveRawCaptureSession,
    settings: UserSettings,
    retainedAt: number,
    reason: "idle-retention" | "capacity-retention"
  ): Promise<boolean> {
    if (this.finalizingSessionIds.has(session.captureSessionId)) {
      return false;
    }
    const safeRetainedAt = Number.isFinite(retainedAt) && Math.abs(retainedAt) <= RAW_CAPTURE_MAX_DATE_MS
      ? retainedAt
      : Date.now();
    const retainedAtIso = new Date(safeRetainedAt).toISOString();
    const retainedSession: ActiveRawCaptureSession = {
      ...session,
      boundaries: [...session.boundaries, { at: session.lastSeenAt, reason }],
      diagnostics: [...session.diagnostics, {
        ts: safeRetainedAt,
        severity: "warn",
        code: "active_session_retained_locally",
        message: RAW_CAPTURE_RETENTION_WARNING
      }]
    };
    this.finalizingSessionIds.add(session.captureSessionId);
    try {
      await this.persistSession(retainedSession, {
        platform: "atlas",
        title: "Retained Atlas capture",
        completedAt: retainedAtIso
      }, undefined, settings, {
        recoveredFromJournalAt: retainedAtIso,
        journalPromotionWarning: RAW_CAPTURE_RETENTION_WARNING
      });
      await this.discardSessionJournal(session.captureSessionId);
      this.forgetSessionInMemory(session.captureSessionId);
      this.lastAssociationError = "";
      return true;
    } catch (error) {
      this.lastAssociationError = `RiftLite kept an inactive Web Replay journal for a later recovery attempt: ${
        truncateForUi(error instanceof Error ? error.message : String(error), 220)
      }`;
      return false;
    } finally {
      this.finalizingSessionIds.delete(session.captureSessionId);
    }
  }

  private mergeProvisionalSession(
    target: ActiveRawCaptureSession,
    provisional: ActiveRawCaptureSession
  ): void {
    if (target.captureSessionId === provisional.captureSessionId) {
      return;
    }
    const previousRoomCode = target.roomCode;
    const provisionalRoomCode = provisional.roomCodes[0] || provisional.roomCode;
    const sourceOffset = target.frames.length;
    target.frames.push(...provisional.frames.map((frame, index) => ({
      ...frame,
      seq: sourceOffset + index
    })));
    target.nextSeq = target.frames.length;
    target.byteSize += provisional.byteSize;
    target.capped = target.capped || provisional.capped || target.byteSize > RAW_CAPTURE_MAX_BYTES;
    target.firstSeenAt = Math.min(target.firstSeenAt, provisional.firstSeenAt);
    if (provisional.lastSeenAt >= target.lastSeenAt) {
      target.lastSeenAt = provisional.lastSeenAt;
      target.requestUrl = provisional.requestUrl || target.requestUrl;
      target.roomCode = provisional.roomCode || target.roomCode;
      target.matchId = provisional.matchId || target.matchId;
      target.replayId = provisional.replayId || target.replayId;
      target.matchFormat = provisional.matchFormat || target.matchFormat;
      target.lastPhase = provisional.lastPhase || target.lastPhase;
      target.lastGameNumber = provisional.lastGameNumber ?? target.lastGameNumber;
      target.lastFrameType = provisional.lastFrameType || target.lastFrameType;
    }
    for (const roomCode of provisional.roomCodes) rememberRoomCode(target, roomCode);
    for (const matchId of provisional.matchIds) rememberRawCaptureIdentity(target.matchIds, matchId);
    for (const replayId of provisional.replayIds) rememberRawCaptureIdentity(target.replayIds, replayId);
    for (const captureId of [provisional.captureSessionId, ...provisional.sourceCaptureSessionIds]) {
      rememberRawCaptureIdentity(target.sourceCaptureSessionIds, captureId);
    }
    target.boundaries.push(
      ...provisional.boundaries
        .filter((boundary) => boundary.reason !== "session-start")
        .map((boundary) => ({ ...boundary })),
      ...(
        previousRoomCode &&
        provisionalRoomCode &&
        !identityEquals(previousRoomCode, provisionalRoomCode)
          ? [{
              at: provisional.firstSeenAt,
              reason: `room-code-change:${previousRoomCode}->${provisionalRoomCode}`
            }]
          : []
      ),
      { at: provisional.firstSeenAt, reason: "provisional-session-merged" }
    );
    target.boundaries.sort((left, right) => left.at - right.at);
    target.diagnostics.push(...provisional.diagnostics.map((diagnostic) => ({ ...diagnostic })));
    target.phases.push(...provisional.phases.map((phase) => shiftPhaseSegment(phase, sourceOffset)));
    target.games.push(...provisional.games.map((game) => shiftGameSegment(game, sourceOffset)));
    target.keptCount += provisional.keptCount;
    target.droppedCount += provisional.droppedCount;
    target.droppedBytes += provisional.droppedBytes;
    target.lastError = provisional.lastError || target.lastError;
    for (const [socketId, socket] of Object.entries(provisional.sockets)) {
      target.sockets[socketId] = mergeRawCaptureSocket(target.sockets[socketId], socket);
    }
    this.journalRewriteSessionIds.add(target.captureSessionId);
    const provisionalJournalPath = this.journalPathsBySessionId.get(provisional.captureSessionId);
    if (provisionalJournalPath) {
      this.journalCleanupPaths.add(provisionalJournalPath);
    }
    this.sessions.delete(provisional.captureSessionId);
    for (const [key, sessionId] of this.sessionIdByTransport) {
      if (sessionId === provisional.captureSessionId) {
        this.sessionIdByTransport.set(key, target.captureSessionId);
      }
    }
  }

  async finishForReplay(
    replay: ReplayRecord,
    explicitIdentity: RawCaptureFinishIdentity = {}
  ): Promise<ReplayRecord> {
    return await this.finishCapture({
      ...explicitIdentity,
      platform: replay.platform,
      localReplayId: replay.id,
      localMatchId: replay.matchId,
      title: replay.title,
      capturedAt: replay.capturedAt,
      completedAt: explicitIdentity.completedAt || latestReplayEventTimestamp(replay)
    }, replay) ?? replay;
  }

  async finishCapture(
    explicitIdentity: RawCaptureFinishIdentity,
    replay?: ReplayRecord
  ): Promise<ReplayRecord | null> {
    await this.drainPendingFrames();
    const settings = await this.store.getSettings();
    await this.ensureInterruptedCaptureRecovery(settings);
    if (!settings.rawCapture.enabled) {
      await this.clearSessionsAndJournals();
      return replay ?? null;
    }
    const platform = explicitIdentity.platform ?? replay?.platform;
    if (platform !== "atlas" || replay?.rawCapture) {
      return replay ?? null;
    }

    const identity = replay
      ? rawCaptureReplayIdentity(replay, explicitIdentity)
      : rawCaptureFinishIdentityValues(explicitIdentity);
    const persistedTemporalWindow = rawCaptureTemporalWindow(explicitIdentity, replay);
    const temporalWindow = rawCaptureFinishHasRemoteIdentity(explicitIdentity, replay)
      ? null
      : persistedTemporalWindow;
    const session = this.findSessionForIdentity(identity, temporalWindow);
    let manifest: PersistedRawCaptureManifest | null = null;
    if (session?.frames.length) {
      this.lastAssociationError = "";
      session.matchId = explicitIdentity.matchId || session.matchId;
      rememberRawCaptureIdentity(session.matchIds, explicitIdentity.matchId || "");
      for (const matchId of explicitIdentity.matchIds ?? []) {
        rememberRawCaptureIdentity(session.matchIds, matchId);
      }
      session.replayId = explicitIdentity.replayId || session.replayId;
      rememberRawCaptureIdentity(session.replayIds, explicitIdentity.replayId || "");
      for (const replayId of explicitIdentity.replayIds ?? []) {
        rememberRawCaptureIdentity(session.replayIds, replayId);
      }
      this.finalizingSessionIds.add(session.captureSessionId);
      try {
        manifest = await this.persistSession(session, explicitIdentity, replay, settings);
        await this.discardSessionJournal(session.captureSessionId);
        this.removeSession(session.captureSessionId);
      } finally {
        this.finalizingSessionIds.delete(session.captureSessionId);
      }
    } else {
      manifest = await this.findPersistedCapture(identity, settings, persistedTemporalWindow);
    }
    if (!manifest) {
      this.lastAssociationError = "Raw capture was not attached because no unique active session matched the replay identity and time window.";
      return replay ?? null;
    }
    this.lastAssociationError = "";
    return this.withCaptureTask(manifest.metadata.captureSessionId, () => (
      this.finishPersistedCaptureUnlocked(manifest!, explicitIdentity, replay, settings)
    ));
  }

  private async finishPersistedCaptureUnlocked(
    initialManifest: PersistedRawCaptureManifest,
    explicitIdentity: RawCaptureFinishIdentity,
    replay: ReplayRecord | undefined,
    settings: UserSettings
  ): Promise<ReplayRecord | null> {
    let manifest = await readRawCaptureManifest(initialManifest.indexPath) ?? initialManifest;
    const projectedMatch = explicitIdentity.match ?? rawCaptureMatchSummaryFromDraft(replay?.matchSnapshot);
    const match = manifest.match ?? (
      manifest.metadata.uploadStatus === "uploaded" ? undefined : projectedMatch
    );
    if (match) {
      if (manifest.metadata.uploadStatus !== "uploaded") {
        await writeRawCaptureMatchSummary(manifest.localPath, match);
      }
      const resultUpdatedAt = new Date().toISOString();
      const resultResolved = rawCaptureMatchSummaryResolved(match);
      manifest = {
        ...manifest,
        match,
        metadata: {
          ...manifest.metadata,
          resultStatus: resultResolved ? "resolved" : "pending",
          resultFinalizedAt: resultResolved
            ? manifest.metadata.resultFinalizedAt || resultUpdatedAt
            : undefined
        }
      };
    }

    if (replay) {
      const persistedIdentity = rawCapturePersistedFinishIdentity(explicitIdentity);
      manifest = {
        ...manifest,
        updatedAt: new Date().toISOString(),
        requiresLocalReplayParent: true,
        localReplayId: replay.id,
        localMatchId: replay.matchId,
        title: replay.title,
        identity: {
          ...manifest.identity,
          ...persistedIdentity,
          localReplayId: replay.id,
          localMatchId: replay.matchId,
          title: replay.title
        }
      };
      await writeRawCaptureManifest(manifest);
    }
    let saved = replay
      ? await this.saveReplayRawCapture(replay, manifest.metadata)
      : null;

    const legacyAutoUploadEnabled = rawCaptureUploadEnabled(settings);
    const webReplayAutoUploadEnabled = riftLiteWebReplayAutoUploadEnabled(settings);
    const webReplayAutoUploadEligible = rawCaptureWebReplayAutoUploadEligible(manifest.metadata, settings);
    if (
      manifest.metadata.uploadStatus !== "too-large" &&
      (legacyAutoUploadEnabled || (webReplayAutoUploadEnabled && webReplayAutoUploadEligible))
    ) {
      let uploadedAnything = false;
      if (saved && legacyAutoUploadEnabled && settings.rawCapture.apiKey.trim()) {
        saved = await this.uploadRawCapture(saved.id) ?? saved;
        uploadedAnything = saved.rawCapture?.uploadStatus === "uploaded";
      }
      if (webReplayAutoUploadEnabled && webReplayAutoUploadEligible) {
        try {
          manifest = await this.uploadPersistedCaptureToRiftLiteUnlocked(
            manifest,
            rawCaptureVisibility(settings),
            settings,
            { automatic: true }
          );
          this.lastUploadUrl = manifest.metadata.uploadUrl || this.lastUploadUrl;
          uploadedAnything = true;
          if (saved) {
            saved = await this.saveReplayRawCapture(saved, manifest.metadata);
          } else {
            await this.publishManifestWithoutReplay(manifest);
          }
        } catch (error) {
          const persistedFailure = await readRawCaptureManifest(manifest.indexPath);
          if (persistedFailure?.metadata.uploadStatus === "too-large") {
            manifest = persistedFailure;
            if (saved) {
              saved = await this.saveReplayRawCapture(saved, manifest.metadata);
            }
          } else if (!uploadedAnything) {
            manifest = persistedFailure ?? await this.saveManifestUploadFailure(manifest, error);
            if (saved) {
              saved = await this.saveReplayRawCapture(saved, manifest.metadata);
            }
          }
        }
      }
    }
    return saved;
  }

  async captureDirectory(): Promise<string> {
    return rawCaptureDirectory(await this.store.getSettings());
  }

  async registerPreparedTcgaCapture(
    prepared: PreparedTcgaWebReplayCapture,
    explicitIdentity: RawCaptureFinishIdentity,
    replay?: ReplayRecord,
    options: { deferDelivery?: boolean } = {}
  ): Promise<ReplayRecord | null> {
    if (prepared.platform !== "tcga" || explicitIdentity.platform !== "tcga" || (replay && replay.platform !== "tcga")) {
      throw new Error("Prepared TCGA Web Replay provider does not match its completed match.");
    }
    if (replay?.rawCapture) {
      return replay;
    }
    const settings = await this.store.getSettings();
    const captureAccountUid = riftLiteTcgaWebReplayCaptureAccountUid(settings);
    if (
      !captureAccountUid ||
      !prepared.expectedAccountUid ||
      !riftLiteAccountUidEquals(prepared.expectedAccountUid, captureAccountUid)
    ) {
      throw new Error("TCGA Web Replay automatic upload was disabled or its consenting account changed.");
    }
    // Capture consent and upload authentication are deliberately separate. A
    // transiently missing/failed account verification must not destroy the
    // completed local TCGA artifact; it only defers delivery until account
    // verification recovers.
    const uploadAccountUid = riftLiteTcgaWebReplayAutoUploadAccountUid(settings);
    const webReplayUploadReady = Boolean(
      uploadAccountUid &&
      riftLiteAccountUidEquals(prepared.expectedAccountUid, uploadAccountUid)
    );
    // Keep the durable capture bound to the explicit consenting account. The
    // ordinary retry lane will remain closed while that account is unverified,
    // then automatically pick this artifact up after verification recovers.
    const webReplayAutoUploadEligible = riftLiteAccountUidEquals(
      prepared.expectedAccountUid,
      captureAccountUid
    );
    const match = explicitIdentity.match ?? rawCaptureMatchSummaryFromDraft(replay?.matchSnapshot);
    if (!rawCaptureMatchSummaryResolved(match)) {
      throw new Error("TCGA Web Replay requires a saved match result before upload.");
    }
    const directory = await rawCaptureDirectory(settings);
    if (!pathInsideDirectory(prepared.localPath, directory)) {
      throw new Error("Prepared TCGA Web Replay is outside the private raw-capture directory.");
    }
    const compressed = await readFile(prepared.localPath);
    await validatePreparedTcgaCapture(compressed, prepared);

    const persistedAt = new Date().toISOString();
    const title = explicitIdentity.title || replay?.title || explicitIdentity.localMatchId || prepared.captureSessionId;
    const currentDiscordHubIds = riftLiteWebReplayDiscordShareHubIds(settings);
    const discordShareHubIds = intersectStringSets(prepared.discordShareHubIds ?? [], currentDiscordHubIds);
    const webReplayDiscordShareEligible = Boolean(
      webReplayUploadReady &&
      discordShareHubIds.length &&
      riftLiteAccountUidEquals(prepared.expectedAccountUid, settings.accountUid)
    );
    const visibility = webReplayDiscordShareEligible
      ? "unlisted"
      : normalizeRawCaptureVisibility(settings.rawCapture.visibility);
    const metadata: RawCaptureReplayMetadata = {
      provider: "riftlite-v2",
      captureSessionId: prepared.captureSessionId,
      messageCount: prepared.messageCount,
      firstSeenAt: prepared.firstSeenAt,
      lastSeenAt: prepared.lastSeenAt,
      uploadStatus: "not-uploaded",
      processingStatus: "pending",
      deliveryStage: webReplayUploadReady ? "queued" : "captured",
      attemptCount: 0,
      captureCompletedAt: persistedAt,
      resultStatus: "resolved",
      resultFinalizedAt: persistedAt,
      processingUpdatedAt: persistedAt,
      localPath: prepared.localPath,
      visibility,
      webReplayAutoUploadEligible,
      webReplayAutoUploadAccountUid: captureAccountUid,
      webReplayDiscordShareEligible,
      webReplayDiscordShareAccountUid: webReplayDiscordShareEligible ? uploadAccountUid : undefined,
      webReplayDiscordShareHubIds: webReplayDiscordShareEligible ? discordShareHubIds : undefined,
      discordShareStatus: webReplayDiscordShareEligible ? "pending" : undefined
    };
    const indexPath = `${prepared.localPath}${RAW_CAPTURE_INDEX_SUFFIX}`;
    let manifest: PersistedRawCaptureManifest = {
      schema: "riftlite-raw-capture-index",
      version: 1,
      updatedAt: persistedAt,
      platform: "tcga",
      artifactEncoding: "gzip",
      localPath: prepared.localPath,
      indexPath,
      requiresLocalReplayParent: Boolean(replay),
      localReplayId: replay?.id || explicitIdentity.localReplayId,
      localMatchId: replay?.matchId || explicitIdentity.localMatchId,
      title,
      match,
      identity: {
        ...rawCapturePersistedFinishIdentity(explicitIdentity),
        platform: "tcga",
        captureSessionId: prepared.captureSessionId,
        localReplayId: replay?.id || explicitIdentity.localReplayId,
        localMatchId: replay?.matchId || explicitIdentity.localMatchId,
        title
      },
      metadata
    };
    await writeRawCaptureManifest(manifest);
    let saved = replay ? await this.saveReplayRawCapture(replay, metadata) : null;
    if (options.deferDelivery || !webReplayUploadReady) {
      // The artifact, index, and optional replay association are now durable.
      // Upload/processing/Discord delivery can safely continue after the match
      // confirmation IPC returns, including via startup manifest recovery.
      return saved;
    }
    try {
      manifest = await this.uploadPersistedCaptureToRiftLite(
        manifest,
        visibility,
        settings,
        { automatic: true }
      );
      this.lastUploadUrl = manifest.metadata.uploadUrl || this.lastUploadUrl;
      if (saved) {
        saved = await this.saveReplayRawCapture(saved, manifest.metadata);
      } else {
        await this.publishManifestWithoutReplay(manifest);
      }
    } catch (error) {
      let failed = await readRawCaptureManifest(indexPath);
      if (failed && !failed.metadata.error) {
        failed = await this.saveManifestUploadFailure(failed, error);
      }
      if (failed && saved) {
        saved = await this.saveReplayRawCapture(saved, failed.metadata);
      }
    }
    return saved;
  }

  async deliverRegisteredTcgaCapture(localMatchId: string): Promise<ReplayRecord | null> {
    const settings = await this.store.getSettings();
    const replays = await this.store.getReplays();
    const replay = replays.find((candidate) => (
      candidate.platform === "tcga" &&
      candidate.matchId === localMatchId &&
      Boolean(candidate.rawCapture?.localPath)
    ));
    if (replay?.rawCapture) {
      await this.uploadRawCaptureToRiftLite(
        replay.id,
        normalizeRawCaptureVisibility(replay.rawCapture.visibility ?? rawCaptureVisibility(settings)),
        { automatic: true }
      );
      return this.loadReplay(replay.id);
    }

    const manifests = (await readRawCaptureManifests(settings)).filter((manifest) => (
      manifest.platform === "tcga" &&
      (
        manifest.localMatchId === localMatchId ||
        manifest.identity.localMatchId === localMatchId
      )
    ));
    if (manifests.length !== 1) {
      throw new Error(manifests.length
        ? "More than one registered TCGA Web Replay matched this local match."
        : "The registered TCGA Web Replay manifest was not found.");
    }
    const manifest = manifests[0];
    const uploaded = await this.uploadPersistedCaptureToRiftLite(
      manifest,
      normalizeRawCaptureVisibility(manifest.metadata.visibility ?? rawCaptureVisibility(settings)),
      settings,
      { automatic: true }
    );
    await this.publishManifestWithoutReplay(uploaded);
    return null;
  }

  async tcgaDeliveryStateForMatch(localMatchId: string): Promise<"none" | "pending" | "settled"> {
    const settings = await this.store.getSettings();
    const replay = (await this.store.getReplays()).find((candidate) => (
      candidate.platform === "tcga" &&
      candidate.matchId === localMatchId &&
      Boolean(candidate.rawCapture?.localPath)
    ));
    let metadata = replay?.rawCapture;
    if (!metadata) {
      const manifests = (await readRawCaptureManifests(settings)).filter((manifest) => (
        manifest.platform === "tcga" &&
        (
          manifest.localMatchId === localMatchId ||
          manifest.identity.localMatchId === localMatchId
        )
      ));
      if (!manifests.length) return "none";
      if (manifests.length !== 1) {
        throw new Error("More than one registered TCGA Web Replay matched this local match.");
      }
      metadata = manifests[0].metadata;
    }
    if (
      metadata.uploadStatus === "uploaded" ||
      metadata.uploadStatus === "too-large" ||
      !rawCaptureWebReplayAutoUploadEligibleForPlatform("tcga", metadata, settings)
    ) {
      return "settled";
    }
    return "pending";
  }

  async uploadRawCapture(replayId: string): Promise<ReplayRecord | null> {
    // Legacy third-party RiftReplay API-key upload. First-party Replay V2 uses
    // uploadRawCaptureToRiftLite and never sends its Firebase token here.
    const settings = await this.store.getSettings();
    const replays = await this.store.getReplays();
    const replay = replays.find((item) => item.id === replayId);
    if (!replay?.rawCapture?.localPath) {
      return replay ?? null;
    }
    if (replay.platform !== "atlas") {
      return this.saveUploadFailure(replay, "Legacy RiftReplay upload is available for Atlas captures only.", "disabled");
    }
    if (!rawCaptureUploadEnabled(settings)) {
      return this.saveUploadFailure(replay, "Raw replay upload is disabled.", "disabled");
    }
    const apiKey = settings.rawCapture.apiKey.trim();
    if (!apiKey) {
      return this.saveUploadFailure(replay, "RiftReplay API key is missing.", "not-uploaded");
    }
    const uploadAttemptAt = new Date().toISOString();
    try {
      const raw = await readFile(replay.rawCapture.localPath, "utf8");
      const gzipped = await gzipAsync(Buffer.from(raw, "utf8"));
      const response = await postLegacyRiftReplayWithRetry(settings.rawCapture.endpoint || LEGACY_RIFTREPLAY_UPLOAD_ENDPOINT, apiKey, gzipped);
      const text = await readReplayResponseText(response, "RiftReplay upload");
      const body = parseJsonObject(text);
      if (!response.ok) {
        throw new Error(`RiftReplay API ${response.status}: ${truncateForUi(text || response.statusText, 260)}`);
      }
      const uploadUrl = extractUploadUrl(body, response.headers.get("location") || "");
      const uploadId = extractUploadId(body, uploadUrl);
      const metadata: RawCaptureReplayMetadata = {
        ...replay.rawCapture,
        uploadStatus: "uploaded",
        uploadUrl,
        uploadId,
        uploadedAt: new Date().toISOString(),
        lastUploadAttemptAt: uploadAttemptAt,
        error: undefined
      };
      this.lastUploadUrl = uploadUrl || this.lastUploadUrl;
      return this.saveReplayRawCapture(replay, metadata);
    } catch (error) {
      return this.saveUploadFailure(
        replay,
        error instanceof Error ? error.message : "RiftReplay upload failed.",
        "failed",
        uploadAttemptAt
      );
    }
  }

  async getStatus(): Promise<RawCaptureStatus> {
    const settings = await this.store.getSettings();
    await this.ensureInterruptedCaptureRecovery(settings);
    const active = settings.rawCapture.enabled ? this.currentSession() : null;
    return {
      enabled: settings.rawCapture.enabled,
      active: Boolean(active),
      platform: active?.platform,
      captureSessionId: active?.captureSessionId,
      messageCount: active?.frames.length ?? 0,
      byteSize: active?.byteSize ?? 0,
      capped: active?.capped ?? false,
      keptCount: active?.keptCount ?? 0,
      droppedCount: active?.droppedCount ?? 0,
      lastFrameType: active?.lastFrameType,
      lastError: active?.lastError || this.lastAssociationError || undefined,
      lastUploadUrl: this.lastUploadUrl
    };
  }

  async getWebReplayUploadDiagnostics(): Promise<WebReplayUploadDiagnostics> {
    const settings = await this.store.getSettings();
    await this.ensureInterruptedCaptureRecovery(settings);
    const [replays, manifests, captureStatus] = await Promise.all([
      this.store.getReplays(),
      readRawCaptureManifests(settings),
      this.getStatus()
    ]);
    const entries = new Map<string, WebReplayDiagnosticEntry>();
    const remember = (entry: WebReplayDiagnosticEntry, fallbackKey: string) => {
      if (
        entry.metadata.provider !== "riftlite-v2" &&
        entry.metadata.webReplayAutoUploadEligible !== true &&
        !isRiftLiteReplayV2Url(entry.metadata.uploadUrl)
      ) {
        return;
      }
      const key = `${entry.platform}:${entry.captureSessionId || fallbackKey}`;
      const current = entries.get(key);
      if (!current || rawCaptureUploadUpdateWins(current.metadata, entry.metadata)) {
        entries.set(key, entry);
      }
    };

    for (const replay of replays) {
      if ((replay.platform !== "atlas" && replay.platform !== "tcga") || !replay.rawCapture) continue;
      remember({
        platform: replay.platform,
        captureSessionId: replay.rawCapture.captureSessionId,
        localReplayId: replay.id,
        title: replay.title,
        capturedAt: replay.capturedAt,
        metadata: replay.rawCapture
      }, `replay:${replay.id}`);
    }
    for (const manifest of manifests) {
      if (!await this.hasActiveManifestParent(manifest)) continue;
      remember({
        platform: manifest.platform,
        captureSessionId: manifest.metadata.captureSessionId,
        localReplayId: manifest.localReplayId || manifest.identity.localReplayId,
        title: manifest.title || `${manifest.platform === "atlas" ? "Atlas" : "TCGA"} capture`,
        capturedAt: rawCaptureUploadCapturedAt(manifest) || manifest.updatedAt,
        metadata: manifest.metadata
      }, `manifest:${manifest.indexPath}`);
    }

    const records = [...entries.values()];
    const atlas = buildWebReplayUploadLaneDiagnostics("atlas", settings, records);
    const tcga = buildWebReplayUploadLaneDiagnostics("tcga", settings, records);
    const recentFailures = webReplayUploadFailureDiagnostics(records);
    const queue = buildWebReplayUploadQueue(records);
    const latestReadyReplayUrl = records
      .filter((entry) => entry.metadata.processingStatus === "ready" && isRiftLiteReplayV2Url(entry.metadata.uploadUrl))
      .sort((left, right) =>
        webReplayDiagnosticTimestamp(right.metadata.uploadedAt) -
        webReplayDiagnosticTimestamp(left.metadata.uploadedAt)
      )[0]?.metadata.uploadUrl || "";
    const accountLinked = Boolean(normalizeRiftLiteAccountUid(settings.accountUid));
    const accountVerified = hasVerifiedRiftLiteAccount(settings);
    const configuredLanes = [atlas, tcga].filter((lane) => lane.configured);
    const accountMismatch = configuredLanes.some((lane) => !lane.accountMatches);
    let state: WebReplayUploadDiagnostics["state"] = "healthy";
    let summary = "Web replay capture and upload settings look ready.";

    if (!settings.rawCapture.enabled) {
      state = "blocked";
      summary = "Web replay capture is disabled, so completed games cannot enter the upload queue.";
    } else if (!accountLinked) {
      state = "blocked";
      summary = "No RiftLite account is linked. Link and verify an account before enabling web replay upload.";
    } else if (!accountVerified) {
      state = "blocked";
      summary = "The linked RiftLite account is not currently verified. Check or reconnect the account, then retry pending uploads.";
    } else if (!configuredLanes.length) {
      state = "attention";
      summary = "Automatic web replay upload is off for both Atlas and TCGA.";
    } else if (accountMismatch) {
      state = "blocked";
      summary = "Replay upload consent belongs to a different account. Turn the affected platform off and on again to bind this account.";
    } else if (recentFailures.length || captureStatus.lastError) {
      state = "error";
      summary = recentFailures[0]?.error || captureStatus.lastError || "A web replay upload failed.";
    } else if (atlas.pending + atlas.inProgress + tcga.pending + tcga.inProgress > 0) {
      state = "attention";
      summary = "One or more web replays are waiting, uploading, or processing. Use Retry pending uploads if this does not clear.";
    } else if (configuredLanes.every((lane) => lane.captured === 0)) {
      state = "attention";
      summary = "Upload is enabled, but no completed web replay captures are currently recorded on this device.";
    }

    return {
      checkedAt: new Date().toISOString(),
      state,
      summary,
      captureEnabled: settings.rawCapture.enabled,
      accountLinked,
      accountVerified,
      retryInProgress: Boolean(this.pendingUploadPromise),
      activeCapture: captureStatus.active,
      captureError: captureStatus.lastError || "",
      lanes: { atlas, tcga },
      queue,
      latestReadyReplayUrl,
      recentFailures
    };
  }

  async uploadPendingRawCaptures(limit = 5, forceRetry = false): Promise<number> {
    if (this.pendingUploadPromise) {
      if (forceRetry) {
        // Do not let a foreground retry disappear into an already-running
        // automatic pass whose cooldown rules may have selected nothing.
        this.pendingForcedUploadRequested = true;
        this.pendingForcedUploadLimit = Math.max(this.pendingForcedUploadLimit, Math.max(1, limit));
      }
      return this.pendingUploadPromise;
    }
    this.pendingUploadPromise = this.runPendingUploadPasses(limit, forceRetry)
      .finally(() => {
        this.pendingUploadPromise = null;
      });
    return this.pendingUploadPromise;
  }

  private async runPendingUploadPasses(limit: number, forceRetry: boolean): Promise<number> {
    let completed = await this.uploadPendingRawCapturesNow(limit, forceRetry);
    while (this.pendingForcedUploadRequested) {
      const forcedLimit = Math.max(1, this.pendingForcedUploadLimit || limit);
      this.pendingForcedUploadRequested = false;
      this.pendingForcedUploadLimit = 0;
      completed += await this.uploadPendingRawCapturesNow(forcedLimit, true);
    }
    return completed;
  }

  async uploadIncompleteWebReplay(captureSessionId: string): Promise<RiftLiteReplayUploadResult> {
    const normalizedCaptureSessionId = normalizeDiagnosticCaptureSessionId(captureSessionId);
    const settings = await this.store.getSettings();
    if (!settings.rawCapture.enabled) {
      throw new Error("Web Replay capture is disabled.");
    }
    const replays = await this.store.getReplays();
    const matchingReplays = replays.filter((replay) => (
      replay.rawCapture?.captureSessionId === normalizedCaptureSessionId
    ));
    if (matchingReplays.length > 1) {
      throw new Error("More than one local replay matched this capture. Refresh diagnostics and try again.");
    }
    const replay = matchingReplays[0];
    const matchingManifests = (await readRawCaptureManifests(settings)).filter((manifest) => (
      manifest.metadata.captureSessionId === normalizedCaptureSessionId ||
      manifest.identity.captureSessionId === normalizedCaptureSessionId
    ));
    if (matchingManifests.length > 1) {
      throw new Error("More than one Web Replay source matched this capture. Refresh diagnostics and try again.");
    }
    let manifest = replay
      ? await this.manifestForReplay(replay, settings)
      : matchingManifests[0];
    if (!manifest) {
      throw new Error("The failed Web Replay source is no longer available on this device.");
    }
    if (
      manifest.metadata.lastErrorCode !== "replay_capture_missing_mulligan" &&
      !webReplayIncompleteOverrideAllowed(manifest.metadata.error || "")
    ) {
      throw new Error("Upload anyway is available only when the opening mulligan is the capture's sole missing section.");
    }
    const visibility = normalizeRawCaptureVisibility(
      manifest.metadata.visibility ?? rawCaptureVisibility(settings)
    );
    manifest = await this.uploadPersistedCaptureToRiftLite(
      manifest,
      visibility,
      settings,
      { allowIncomplete: true }
    );
    if (replay) {
      await this.saveReplayRawCapture(replay, manifest.metadata);
    } else {
      await this.publishManifestWithoutReplay(manifest);
    }
    return {
      replayId: manifest.metadata.uploadId || "",
      url: manifest.metadata.uploadUrl || "",
      visibility,
      status: manifest.metadata.processingStatus
    };
  }

  async removeWebReplayUploadFromQueue(captureSessionId: string): Promise<void> {
    const normalizedCaptureSessionId = normalizeDiagnosticCaptureSessionId(captureSessionId);
    await this.withCaptureTask(normalizedCaptureSessionId, async () => {
      const settings = await this.store.getSettings();
      const matchingReplays = (await this.store.getReplays()).filter((replay) => (
        replay.rawCapture?.captureSessionId === normalizedCaptureSessionId
      ));
      const matchingManifests = (await readRawCaptureManifests(settings)).filter((manifest) => (
        manifest.metadata.captureSessionId === normalizedCaptureSessionId ||
        manifest.identity.captureSessionId === normalizedCaptureSessionId
      ));
      if (!matchingReplays.length && !matchingManifests.length) {
        throw new Error("The Web Replay capture is no longer available on this device.");
      }

      const sourcePlatforms = new Set<string>([
        ...matchingReplays.map((replay) => replay.platform),
        ...matchingManifests.map((manifest) => manifest.platform)
      ]);
      const sourceProviders = new Set<string>([
        ...matchingReplays.map((replay) => replay.rawCapture?.provider || ""),
        ...matchingManifests.map((manifest) => manifest.metadata.provider || "")
      ].filter(Boolean));
      const sourcePaths = new Set<string>([
        ...matchingReplays.map((replay) => rawCaptureSourcePathKey(replay.rawCapture?.localPath)),
        ...matchingManifests.map((manifest) => rawCaptureSourcePathKey(manifest.localPath))
      ].filter(Boolean));
      if (sourcePlatforms.size > 1 || sourceProviders.size > 1 || sourcePaths.size > 1) {
        throw new Error("More than one separate Web Replay capture uses this identifier. No local replay or capture was changed.");
      }

      const persistedManifests = (await Promise.all(matchingManifests.map(async (manifest) => (
        await readRawCaptureManifest(manifest.indexPath) ?? manifest
      )))).filter((manifest) => (
        manifest.metadata.captureSessionId === normalizedCaptureSessionId ||
        manifest.identity.captureSessionId === normalizedCaptureSessionId
      ));
      const sourceMetadata = [
        ...persistedManifests.map((manifest) => manifest.metadata),
        ...matchingReplays.map((replay) => replay.rawCapture)
      ].filter((metadata): metadata is RawCaptureReplayMetadata => Boolean(metadata));
      if (!sourceMetadata.length) {
        throw new Error("The Web Replay upload record is incomplete.");
      }
      if (sourceMetadata.some((metadata) => metadata.processingStatus === "ready")) {
        throw new Error("This Web Replay already exists online and cannot be removed through the local upload queue.");
      }

      for (const manifest of persistedManifests) {
        const removedMetadata = rawCaptureMetadataRemovedFromUploadQueue(manifest.metadata);
        await writeRawCaptureManifest({
          ...manifest,
          updatedAt: removedMetadata.processingUpdatedAt!,
          metadata: removedMetadata
        });
      }
      for (const replay of matchingReplays) {
        await this.saveReplayRawCapture(
          replay,
          rawCaptureMetadataRemovedFromUploadQueue(replay.rawCapture!)
        );
      }
    });
  }

  private async uploadPendingRawCapturesNow(limit: number, forceRetry: boolean): Promise<number> {
    const settings = await this.store.getSettings();
    await this.ensureInterruptedCaptureRecovery(settings);
    const legacyAutoUploadEnabled = rawCaptureUploadEnabled(settings);
    const atlasWebReplayAutoUploadEnabled = riftLiteWebReplayAutoUploadEnabled(settings);
    const tcgaWebReplayAutoUploadEnabled = Boolean(riftLiteTcgaWebReplayAutoUploadAccountUid(settings));
    if (!legacyAutoUploadEnabled && !atlasWebReplayAutoUploadEnabled && !tcgaWebReplayAutoUploadEnabled) {
      return 0;
    }
    const canUploadExternal = legacyAutoUploadEnabled && Boolean(settings.rawCapture.apiKey.trim());
    const canUploadRiftLite = atlasWebReplayAutoUploadEnabled || tcgaWebReplayAutoUploadEnabled;
    if (!canUploadExternal && !canUploadRiftLite) {
      return 0;
    }
    const replays = await this.store.getReplays();
    const pending = replays
      .filter((replay) => replay.platform === "atlas" || replay.platform === "tcga")
      .filter((replay) => replay.rawCapture?.localPath)
      .filter((replay) => {
        const status = replay.rawCapture?.uploadStatus || "not-uploaded";
        const hasRiftLiteUpload = isRiftLiteReplayV2Url(replay.rawCapture?.uploadUrl);
        const retryableStatus = status === "not-uploaded" || status === "failed" || status === "disabled";
        const canAutoUploadToRiftLite = canUploadRiftLite &&
          Boolean(replay.rawCapture) &&
          rawCaptureWebReplayAutoUploadEligibleForPlatform(replay.platform, replay.rawCapture!, settings) &&
          (forceRetry || rawCaptureAutoUploadRetryReady(replay.rawCapture!));
        if (status === "too-large") {
          return false;
        }
        return (replay.platform === "atlas" && canUploadExternal && retryableStatus) ||
          (canAutoUploadToRiftLite && (
            retryableStatus ||
            !hasRiftLiteUpload ||
            replay.rawCapture?.processingStatus === "failed" ||
            rawCaptureRemoteStatusCheckReady(replay.rawCapture!) ||
            rawCaptureStaleProcessingReady(replay.rawCapture!, forceRetry) ||
            rawCaptureReadyVisibilityNeedsReconciliation(replay.rawCapture!, settings) ||
            rawCaptureDiscordShareNeedsRetry(replay.rawCapture!, settings)
          ));
      })
      .sort((a, b) => {
        const attemptDifference = rawCaptureUploadAttemptAt(a.rawCapture) -
          rawCaptureUploadAttemptAt(b.rawCapture);
        return attemptDifference || Date.parse(b.capturedAt) - Date.parse(a.capturedAt);
      })
      .slice(0, Math.max(1, limit));
    let uploaded = 0;
    const attemptedCaptureIds = new Set<string>();
    for (const replay of pending) {
      let saved: ReplayRecord | null = replay;
      if (replay.rawCapture?.captureSessionId) {
        attemptedCaptureIds.add(replay.rawCapture.captureSessionId);
      }
      if (
        canUploadExternal &&
        replay.platform === "atlas" &&
        replay.rawCapture &&
        ["not-uploaded", "failed", "disabled"].includes(replay.rawCapture.uploadStatus)
      ) {
        saved = await this.uploadRawCapture(replay.id);
      }
      if (
        canUploadRiftLite &&
        replay.rawCapture &&
        rawCaptureWebReplayAutoUploadEligibleForPlatform(replay.platform, replay.rawCapture, settings) &&
        (forceRetry || rawCaptureAutoUploadRetryReady(replay.rawCapture))
      ) {
        try {
          await this.uploadRawCaptureToRiftLite(
            replay.id,
            rawCaptureVisibility(settings),
            { automatic: true, forceRetry }
          );
          saved = await this.loadReplay(replay.id) ?? saved;
        } catch {
          // Keep pending uploads best-effort; the replay detail panel surfaces manual retry errors.
        }
      }
      if (saved?.rawCapture?.uploadStatus === "uploaded") {
        uploaded += 1;
      }
    }

    if (canUploadRiftLite && pending.length < Math.max(1, limit)) {
      const candidateManifests = (await readRawCaptureManifests(settings))
        .filter((manifest) => !attemptedCaptureIds.has(manifest.metadata.captureSessionId))
        .filter((manifest) => rawCaptureWebReplayAutoUploadEligibleForPlatform(manifest.platform, manifest.metadata, settings))
        .filter((manifest) => forceRetry || rawCaptureAutoUploadRetryReady(manifest.metadata))
        .filter((manifest) => manifest.metadata.uploadStatus !== "too-large")
        .filter((manifest) => (
          !isRiftLiteReplayV2Url(manifest.metadata.uploadUrl) ||
          manifest.metadata.processingStatus === "failed" ||
          rawCaptureRemoteStatusCheckReady(manifest.metadata) ||
          rawCaptureStaleProcessingReady(manifest.metadata, forceRetry) ||
          rawCaptureReadyVisibilityNeedsReconciliation(manifest.metadata, settings) ||
          rawCaptureDiscordShareNeedsRetry(manifest.metadata, settings)
        ))
        .sort((a, b) => {
          const attemptDifference = rawCaptureUploadAttemptAt(a.metadata) -
            rawCaptureUploadAttemptAt(b.metadata);
          return attemptDifference || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
        });
      const manifests: PersistedRawCaptureManifest[] = [];
      const remaining = Math.max(0, Math.max(1, limit) - pending.length);
      for (const manifest of candidateManifests) {
        if (manifests.length >= remaining) {
          break;
        }
        if (await this.hasActiveManifestParent(manifest)) {
          manifests.push(manifest);
        }
      }
      for (const manifest of manifests) {
        try {
          const uploadedManifest = await this.uploadPersistedCaptureToRiftLite(
            manifest,
            rawCaptureVisibility(settings),
            settings,
            { automatic: true, forceRetry }
          );
          await this.publishManifestWithoutReplay(uploadedManifest);
          uploaded += 1;
        } catch {
          // The per-capture manifest retains the failed status for a later retry.
        }
      }
    }
    if (canUploadRiftLite) {
      // Publication is deliberately isolated from upload status: a temporary
      // SQLite/private-hub failure must never turn an already-created remote
      // replay into a failed upload. Successful orphan manifests remain the
      // durable retry source until their active match records the association.
      await this.reconcilePublishedManifestAssociations(settings, limit).catch(() => undefined);
    }
    return uploaded;
  }

  private async reconcilePublishedManifestAssociations(settings: UserSettings, limit: number): Promise<void> {
    const [matches, replays, manifests] = await Promise.all([
      this.store.getMatches(),
      this.store.getReplays(),
      readRawCaptureManifests(settings)
    ]);
    const matchesById = new Map(matches.filter((match) => !match.deletedAt).map((match) => [match.id, match]));
    const activeReplayIds = new Set(replays.filter((replay) => !replay.deletedAt).map((replay) => replay.id));
    const candidates = manifests
      .filter((manifest) => (
        manifest.metadata.provider === "riftlite-v2" &&
        manifest.metadata.uploadStatus === "uploaded" &&
        Boolean(manifest.metadata.uploadId) &&
        rawCaptureWebReplayAutoUploadEligibleForPlatform(manifest.platform, manifest.metadata, settings)
      ))
      .filter((manifest) => {
        const localMatchId = manifest.localMatchId || manifest.identity.localMatchId || "";
        const localReplayId = manifest.localReplayId || manifest.identity.localReplayId || "";
        const match = matchesById.get(localMatchId);
        if (!match || (localReplayId && activeReplayIds.has(localReplayId))) return false;
        // A conflicting association is fail-closed; an exact current-account
        // association means Firebase has already gained its durable retry key.
        return !match.webReplayId;
      })
      .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
      .slice(0, Math.max(1, limit));

    for (const manifest of candidates) {
      if (!await this.hasActiveManifestParent(manifest)) continue;
      const localMatchId = manifest.localMatchId || manifest.identity.localMatchId || "";
      const replayId = manifest.metadata.uploadId || "";
      if (!localMatchId || !replayId) continue;
      await Promise.resolve(this.webReplayPublishedHandler(
        localMatchId,
        replayId,
        manifest.metadata.webReplayAutoUploadAccountUid || ""
      )).catch(() => undefined);
    }
  }

  async getRawCapturePayload(replayId: string): Promise<unknown | null> {
    const replays = [...await this.store.getReplays(), ...await this.store.getDeletedReplays()];
    const replay = replays.find((item) => item.id === replayId);
    if (!replay?.rawCapture?.localPath) {
      return null;
    }
    if (replay.platform !== "atlas") {
      return null;
    }
    const raw = await readFile(replay.rawCapture.localPath, "utf8");
    return JSON.parse(raw) as unknown;
  }

  async uploadRawCaptureToRiftLite(
    replayId: string,
    visibility: RawCaptureVisibility = "private",
    options: { automatic?: boolean; allowIncomplete?: boolean; forceRetry?: boolean } = {}
  ): Promise<RiftLiteReplayUploadResult> {
    const settings = await this.store.getSettings();
    const replays = await this.store.getReplays();
    const replay = replays.find((item) => item.id === replayId);
    if (!replay?.rawCapture?.localPath) {
      throw new Error("No Web Replay source is attached to this replay.");
    }
    if (!settings.rawCapture.enabled) {
      throw new Error("Raw replay capture is disabled.");
    }
    visibility = normalizeRawCaptureVisibility(visibility);
    const manifest = await this.manifestForReplay(replay, settings);
    let uploaded: PersistedRawCaptureManifest;
    try {
      uploaded = await this.uploadPersistedCaptureToRiftLite(manifest, visibility, settings, options);
    } catch (error) {
      const failed = await readRawCaptureManifest(manifest.indexPath);
      if (failed && await this.hasActiveManifestParent(failed)) {
        await this.saveReplayRawCapture(replay, failed.metadata);
      }
      throw error;
    }
    await this.saveReplayRawCapture(replay, uploaded.metadata);
    return {
      replayId: uploaded.metadata.uploadId || "",
      url: uploaded.metadata.uploadUrl || "",
      visibility,
      status: uploaded.metadata.processingStatus
    };
  }

  async shareRawCaptureToDiscord(replayId: string): Promise<RiftLiteReplayDiscordShareResult> {
    const settings = await this.store.getSettings();
    const hubIds = riftLiteWebReplayDiscordShareHubIds(settings);
    if (!hubIds.length) {
      throw new Error("Select a private hub under Account > Automatically post future replay links first.");
    }
    const replays = await this.store.getReplays();
    const replay = replays.find((item) => item.id === replayId);
    if (!replay?.rawCapture?.localPath) {
      throw new Error("No local Web Replay capture is attached to this replay.");
    }
    if (replay.platform !== "atlas" && replay.platform !== "tcga") {
      throw new Error("Discord sharing is available only for Atlas and TCGA Web Replays.");
    }
    const replayPlatform: "atlas" | "tcga" = replay.platform;
    const accountUid = replayPlatform === "tcga"
      ? riftLiteTcgaWebReplayAutoUploadAccountUid(settings)
      : riftLiteWebReplayAutoUploadAccountUid(settings);
    if (!accountUid) {
      throw new Error(`Verify the linked RiftLite account and enable ${replayPlatform === "tcga" ? "TCGA" : "Atlas"} web replay upload before sharing.`);
    }

    let manifest = await this.manifestForReplay(replay, settings);
    let remoteReplayId = manifest.metadata.uploadId || "";
    if (!remoteReplayId || !isRiftLiteReplayV2Url(manifest.metadata.uploadUrl)) {
      manifest = await this.uploadPersistedCaptureToRiftLite(manifest, "unlisted", settings);
      remoteReplayId = manifest.metadata.uploadId || "";
    }
    if (!remoteReplayId) {
      throw new Error("The web replay is not ready to share yet.");
    }

    const shared = await this.withCaptureTask(manifest.metadata.captureSessionId, async () => {
      const persisted = await readRawCaptureManifest(manifest.indexPath);
      manifest = persisted?.metadata.captureSessionId === manifest.metadata.captureSessionId ? persisted : manifest;
      const replayAuth = await this.canonicalReplayAuth(settings, manifest.metadata, false, replayPlatform);
      await this.assertRiftLiteReplayUploadAccountCurrent(replayAuth.settings, manifest.metadata, false, replayPlatform);
      manifest = {
        ...manifest,
        updatedAt: new Date().toISOString(),
        metadata: {
          ...manifest.metadata,
          visibility: "unlisted",
          webReplayAutoUploadEligible: true,
          webReplayAutoUploadAccountUid: accountUid,
          webReplayDiscordShareEligible: true,
          webReplayDiscordShareAccountUid: accountUid,
          webReplayDiscordShareHubIds: [...hubIds],
          discordShareStatus: "pending",
          discordSharedHubIds: undefined,
          discordShareError: undefined
        }
      };
      await writeRawCaptureManifest(manifest);
      return this.sharePersistedReplayToDiscord(manifest, remoteReplayId, replayAuth.idToken);
    });
    await this.saveReplayRawCapture(replay, shared.metadata);
    return {
      replayId: remoteReplayId,
      url: shared.metadata.uploadUrl || `${RIFTLITE_REPLAY_ORIGIN}/replays/${encodeURIComponent(remoteReplayId)}`,
      visibility: "unlisted",
      status: shared.metadata.discordShareStatus === "shared"
        ? "shared"
        : shared.metadata.discordShareStatus === "partial"
          ? "partial"
          : "failed",
      sharedHubIds: shared.metadata.discordSharedHubIds ?? [],
      error: shared.metadata.discordShareError
    };
  }

  private findSessionForIdentity(
    identity: RawCaptureReplayIdentity,
    temporalWindow: RawCaptureTemporalWindow | null = null
  ): ActiveRawCaptureSession | null {
    const sessions = Array.from(this.sessions.values())
      .filter((session) => !this.finalizingSessionIds.has(session.captureSessionId));
    const findUnique = (predicate: (session: ActiveRawCaptureSession) => boolean) => (
      uniqueRawCaptureSession(sessions.filter(predicate))
    );
    const captureSession = findUnique((session) => (
      identity.captureSessionIds.some((id) => (
        identityEquals(session.captureSessionId, id) ||
        session.sourceCaptureSessionIds.some((sourceId) => identityEquals(sourceId, id))
      ))
    ));
    if (captureSession) {
      return captureSession;
    }
    for (const [values, select] of [
      [identity.seriesIds, (session: ActiveRawCaptureSession) => session.seriesId],
      [identity.matchIds, (session: ActiveRawCaptureSession) => [session.matchId, ...session.matchIds]],
      [identity.replayIds, (session: ActiveRawCaptureSession) => [session.replayId, ...session.replayIds]]
    ] as const) {
      const matched = findUnique((session) => {
        const selected = select(session);
        const candidates = Array.isArray(selected) ? selected : [selected];
        return values.some((value) => candidates.some((candidate) => identityEquals(candidate, value)));
      });
      if (matched) {
        return matched;
      }
    }
    const roomSession = findUnique((session) => identity.roomCodes.some((roomCode) => (
      identityEquals(session.roomCode, roomCode) ||
      session.roomCodes.some((knownRoomCode) => identityEquals(knownRoomCode, roomCode))
    )));
    if (roomSession || !temporalWindow) {
      return roomSession;
    }
    const temporalSession = uniqueRawCaptureSession(
      sessions.filter((session) => rawCaptureSessionFitsTemporalWindow(session, temporalWindow))
    );
    // The replay/end evidence can legitimately omit every Atlas identifier even
    // when the WebSocket session learned a room code. A single session inside
    // the strict match window is safe to associate; multiple candidates remain
    // deliberately ambiguous and are never guessed.
    return temporalSession;
  }

  private async persistSession(
    session: ActiveRawCaptureSession,
    explicitIdentity: RawCaptureFinishIdentity,
    replay: ReplayRecord | undefined,
    settings: UserSettings,
    options: { recoveredFromJournalAt?: string; journalPromotionWarning?: string } = {}
  ): Promise<PersistedRawCaptureManifest> {
    const match = explicitIdentity.match ?? rawCaptureMatchSummaryFromDraft(replay?.matchSnapshot);
    const persistedAt = new Date().toISOString();
    const payload = this.buildPayload(session, match);
    const directory = await rawCaptureDirectory(settings);
    const title = explicitIdentity.title || replay?.title || explicitIdentity.localMatchId || session.captureSessionId;
    const localPath = join(directory, `${safeFileComponent(title)}-${payload.capture.captureSessionId}.json`);
    await writeUtf8FileAtomically(localPath, JSON.stringify(payload));
    const completionAccountUid = riftLiteWebReplayAutoUploadAccountUid(settings);
    const webReplayAutoUploadEligible = Boolean(
      session.webReplayAutoUploadAccountUid &&
      riftLiteAccountUidEquals(session.webReplayAutoUploadAccountUid, completionAccountUid)
    );
    const completionDiscordHubIds = riftLiteWebReplayDiscordShareHubIds(settings);
    const webReplayDiscordShareHubIds = intersectStringSets(
      session.webReplayDiscordShareHubIds,
      completionDiscordHubIds
    );
    const webReplayDiscordShareEligible = Boolean(
      webReplayAutoUploadEligible &&
      session.webReplayDiscordShareAccountUid &&
      riftLiteAccountUidEquals(session.webReplayDiscordShareAccountUid, completionAccountUid) &&
      webReplayDiscordShareHubIds.length
    );
    const metadata: RawCaptureReplayMetadata = {
      provider: "riftlite-v2",
      captureSessionId: payload.capture.captureSessionId,
      messageCount: payload.filter.keptCount,
      firstSeenAt: payload.capture.identity.firstSeenAt,
      lastSeenAt: payload.capture.identity.lastSeenAt,
      roomCode: payload.capture.identity.roomCode || undefined,
      roomCodes: payload.capture.identity.roomCodes,
      seriesId: payload.capture.identity.seriesId || undefined,
      matchIds: session.matchIds.slice(),
      uploadStatus: session.capped ? "too-large" : "not-uploaded",
      processingStatus: session.capped ? "failed" : "pending",
      deliveryStage: session.capped ? "failed" : webReplayAutoUploadEligible ? "queued" : "captured",
      attemptCount: 0,
      captureCompletedAt: persistedAt,
      resultStatus: rawCaptureMatchSummaryResolved(match) ? "resolved" : "pending",
      resultFinalizedAt: rawCaptureMatchSummaryResolved(match) ? persistedAt : undefined,
      processingUpdatedAt: persistedAt,
      partialWarnings: options.recoveredFromJournalAt
        ? [options.journalPromotionWarning ?? RAW_CAPTURE_RECOVERY_WARNING]
        : undefined,
      error: session.lastError || undefined,
      localPath,
      visibility: webReplayDiscordShareEligible ? "unlisted" : rawCaptureVisibility(settings),
      webReplayAutoUploadEligible,
      webReplayAutoUploadAccountUid: webReplayAutoUploadEligible
        ? session.webReplayAutoUploadAccountUid
        : undefined,
      webReplayDiscordShareEligible,
      webReplayDiscordShareAccountUid: webReplayDiscordShareEligible
        ? session.webReplayDiscordShareAccountUid
        : undefined,
      webReplayDiscordShareHubIds: webReplayDiscordShareEligible
        ? webReplayDiscordShareHubIds
        : undefined,
      discordShareStatus: webReplayDiscordShareEligible ? "pending" : undefined
    };
    const indexPath = `${localPath}${RAW_CAPTURE_INDEX_SUFFIX}`;
    const persistedIdentity = rawCapturePersistedFinishIdentity(explicitIdentity);
    const manifest: PersistedRawCaptureManifest = {
      schema: "riftlite-raw-capture-index",
      version: 1,
      updatedAt: persistedAt,
      platform: "atlas",
      artifactEncoding: "json",
      localPath,
      indexPath,
      requiresLocalReplayParent: Boolean(replay),
      recoveredFromJournalAt: options.recoveredFromJournalAt,
      localReplayId: replay?.id || explicitIdentity.localReplayId,
      localMatchId: replay?.matchId || explicitIdentity.localMatchId,
      title,
      match,
      identity: {
        ...persistedIdentity,
        platform: "atlas",
        captureSessionId: payload.capture.captureSessionId,
        roomCode: payload.capture.identity.roomCode || undefined,
        roomCodes: payload.capture.identity.roomCodes,
        seriesId: payload.capture.identity.seriesId || undefined,
        matchId: payload.capture.identity.matchId || undefined,
        matchIds: session.matchIds.slice(),
        replayId: payload.capture.identity.replayId || undefined,
        replayIds: session.replayIds.slice(),
        localReplayId: replay?.id || explicitIdentity.localReplayId,
        localMatchId: replay?.matchId || explicitIdentity.localMatchId,
        title
      },
      metadata
    };
    await writeRawCaptureManifest(manifest);
    return manifest;
  }

  private async findPersistedCapture(
    identity: RawCaptureReplayIdentity,
    settings: UserSettings,
    temporalWindow: RawCaptureTemporalWindow | null = null
  ): Promise<PersistedRawCaptureManifest | null> {
    const manifests = await readRawCaptureManifests(settings);
    const findUnique = (predicate: (manifest: PersistedRawCaptureManifest) => boolean) => {
      const matches = manifests.filter(predicate);
      return matches.length === 1 ? matches[0] : null;
    };
    const byCapture = findUnique((manifest) => identity.captureSessionIds.some((value) => (
      identityEquals(value, manifest.metadata.captureSessionId) ||
      identityEquals(value, manifest.identity.captureSessionId || "")
    )));
    if (byCapture) {
      return byCapture;
    }
    const byLocalMatch = findUnique((manifest) => identity.matchIds.some((value) => (
      identityEquals(value, manifest.localMatchId || manifest.identity.localMatchId || "")
    )));
    if (byLocalMatch) {
      return byLocalMatch;
    }
    const byLocalReplay = findUnique((manifest) => identity.replayIds.some((value) => (
      identityEquals(value, manifest.localReplayId || manifest.identity.localReplayId || "")
    )));
    if (byLocalReplay) {
      return byLocalReplay;
    }

    const weakCandidate = (manifest: PersistedRawCaptureManifest): boolean => (
      rawCapturePersistedCandidateFitsContext(manifest, identity, temporalWindow)
    );
    const bySeries = findUnique((manifest) => weakCandidate(manifest) && identity.seriesIds.some((value) => (
      identityEquals(value, manifest.identity.seriesId || manifest.metadata.seriesId || "")
    )));
    if (bySeries) {
      return bySeries;
    }
    const byMatch = findUnique((manifest) => weakCandidate(manifest) && identity.matchIds.some((value) => (
      identityEquals(value, manifest.identity.matchId || "") ||
      (manifest.identity.matchIds ?? []).some((matchId) => identityEquals(value, matchId))
    )));
    if (byMatch) {
      return byMatch;
    }
    const byReplay = findUnique((manifest) => weakCandidate(manifest) && identity.replayIds.some((value) => (
      identityEquals(value, manifest.identity.replayId || "") ||
      (manifest.identity.replayIds ?? []).some((replayId) => identityEquals(value, replayId))
    )));
    if (byReplay) {
      return byReplay;
    }
    return findUnique((manifest) => weakCandidate(manifest) && identity.roomCodes.some((value) => (
      identityEquals(value, manifest.identity.roomCode || manifest.metadata.roomCode || "") ||
      (manifest.identity.roomCodes ?? manifest.metadata.roomCodes ?? []).some((roomCode) => identityEquals(value, roomCode))
    )));
  }

  private async manifestForReplay(replay: ReplayRecord, settings: UserSettings): Promise<PersistedRawCaptureManifest> {
    const rawCapture = replay.rawCapture;
    if (!rawCapture?.localPath) {
      throw new Error("No Web Replay source is attached to this replay.");
    }
    const indexPath = `${rawCapture.localPath}${RAW_CAPTURE_INDEX_SUFFIX}`;
    const existing = await readRawCaptureManifest(indexPath);
    if (existing && existing.platform !== replay.platform) {
      throw new Error("Web Replay source provider does not match the local replay.");
    }
    if (!existing && replay.platform !== "atlas") {
      throw new Error("The TCGA Web Replay source manifest is missing.");
    }
    const artifactAlreadyUploaded = (existing?.metadata.uploadStatus ?? rawCapture.uploadStatus) === "uploaded";
    const match = existing?.match ?? (
      artifactAlreadyUploaded ? undefined : rawCaptureMatchSummaryFromDraft(replay.matchSnapshot)
    );
    if (match && !artifactAlreadyUploaded && replay.platform === "atlas") {
      await writeRawCaptureMatchSummary(rawCapture.localPath, match);
    }
    if (existing) {
      return {
        ...existing,
        updatedAt: new Date().toISOString(),
        requiresLocalReplayParent: true,
        localReplayId: replay.id,
        localMatchId: replay.matchId,
        title: replay.title,
        match,
        metadata: {
          ...existing.metadata,
          ...rawCapture,
          ...(match ? {
            resultStatus: rawCaptureMatchSummaryResolved(match) ? "resolved" as const : "pending" as const,
            resultFinalizedAt: rawCaptureMatchSummaryResolved(match)
              ? existing.metadata.resultFinalizedAt || new Date().toISOString()
              : undefined
          } : {})
        },
        identity: {
          ...existing.identity,
          platform: existing.platform,
          captureSessionId: rawCapture.captureSessionId,
          roomCode: rawCapture.roomCode,
          roomCodes: rawCapture.roomCodes,
          seriesId: rawCapture.seriesId,
          matchIds: rawCapture.matchIds,
          localReplayId: replay.id,
          localMatchId: replay.matchId,
          title: replay.title,
          capturedAt: existing.identity.capturedAt || replay.capturedAt
        }
      };
    }
    const manifest: PersistedRawCaptureManifest = {
      schema: "riftlite-raw-capture-index",
      version: 1,
      updatedAt: new Date().toISOString(),
      platform: "atlas",
      artifactEncoding: "json",
      localPath: rawCapture.localPath,
      indexPath,
      requiresLocalReplayParent: true,
      localReplayId: replay.id,
      localMatchId: replay.matchId,
      title: replay.title,
      match,
      identity: {
        platform: "atlas",
        captureSessionId: rawCapture.captureSessionId,
        roomCode: rawCapture.roomCode,
        roomCodes: rawCapture.roomCodes,
        seriesId: rawCapture.seriesId,
        matchIds: rawCapture.matchIds,
        localReplayId: replay.id,
        localMatchId: replay.matchId,
        title: replay.title,
        capturedAt: replay.capturedAt
      },
      metadata: {
        ...rawCapture,
        visibility: normalizeRawCaptureVisibility(rawCapture.visibility ?? settings.rawCapture.visibility),
        ...(match ? {
          resultStatus: rawCaptureMatchSummaryResolved(match) ? "resolved" as const : "pending" as const,
          resultFinalizedAt: rawCaptureMatchSummaryResolved(match)
            ? rawCapture.resultFinalizedAt || new Date().toISOString()
            : undefined
        } : {})
      }
    };
    await writeRawCaptureManifest(manifest);
    return manifest;
  }

  private async uploadPersistedCaptureToRiftLite(
    manifest: PersistedRawCaptureManifest,
    visibility: RawCaptureVisibility,
    settings: UserSettings,
    options: { automatic?: boolean; allowIncomplete?: boolean; forceRetry?: boolean } = {}
  ): Promise<PersistedRawCaptureManifest> {
    return this.withCaptureTask(manifest.metadata.captureSessionId, async () => {
      const persisted = await readRawCaptureManifest(manifest.indexPath);
      const current = persisted?.metadata.captureSessionId === manifest.metadata.captureSessionId
        ? persisted
        : manifest;
      return this.uploadPersistedCaptureToRiftLiteUnlocked(current, visibility, settings, options);
    });
  }

  private async uploadPersistedCaptureToRiftLiteUnlocked(
    manifest: PersistedRawCaptureManifest,
    visibility: RawCaptureVisibility,
    settings: UserSettings,
    options: { automatic?: boolean; allowIncomplete?: boolean; forceRetry?: boolean } = {}
  ): Promise<PersistedRawCaptureManifest> {
    await this.assertActiveManifestParent(manifest);
    if (manifest.metadata.uploadId && manifest.metadata.processingStatus === "ready") {
      return this.finalizeReadyRemoteReplay(
        manifest,
        visibility,
        settings,
        options.automatic === true
      );
    }
    if (
      manifest.metadata.uploadId &&
      manifest.metadata.processingStatus !== "ready" &&
      (
        manifest.metadata.uploadStatus === "uploaded" ||
        Boolean(manifest.metadata.statusEndpoint) ||
        ["completing", "processing", "paused"].includes(manifest.metadata.deliveryStage || "")
      )
    ) {
      const completionRetryWasReady = manifest.metadata.deliveryStage === "completing" &&
        rawCaptureAutoUploadRetryReady(manifest.metadata);
      try {
        manifest = await this.reconcileRemoteReplayStatus(manifest, settings, options.automatic === true);
      } catch (error) {
        await this.saveManifestUploadFailure(manifest, error);
        throw error;
      }
      if (manifest.metadata.processingStatus === "ready") {
        return this.finalizeReadyRemoteReplay(
          manifest,
          visibility,
          settings,
          options.automatic === true
        );
      }
      const remoteNeedsSource = manifest.metadata.processingStatus === "uploading" ||
        ["initializing", "uploading"].includes(manifest.metadata.deliveryStage || "");
      const remoteNeedsCompletion = manifest.metadata.deliveryStage === "completing";
      const remoteRetryableFailure = manifest.metadata.processingStatus === "failed" &&
        Boolean(manifest.metadata.nextRetryAt);
      if (!remoteNeedsSource && !remoteNeedsCompletion && !remoteRetryableFailure) {
        return manifest;
      }
      if (
        options.automatic === true &&
        options.forceRetry !== true &&
        (
          (remoteNeedsCompletion && !completionRetryWasReady) ||
          (!remoteNeedsCompletion && remoteRetryableFailure)
        ) &&
        !rawCaptureAutoUploadRetryReady(manifest.metadata)
      ) {
        return manifest;
      }
      if (remoteNeedsCompletion) {
        try {
          return await this.retryRemoteReplayCompletion(
            manifest,
            visibility,
            settings,
            options
          );
        } catch (error) {
          const durable = await readRawCaptureManifest(manifest.indexPath);
          if (durable?.metadata.processingStatus === "ready") {
            return durable;
          }
          await this.saveManifestUploadFailure(manifest, error);
          throw error;
        }
      }
    }
    if (
      options.automatic === true &&
      rawCaptureDiscordShareEligible(manifest.metadata, settings)
    ) {
      const waitForResult = !manifest.metadata.lastUploadAttemptAt;
      manifest = await this.waitForDiscordMatchSummary(manifest, waitForResult);
      await this.assertActiveManifestParent(manifest);
      if (!await this.persistedDiscordMatchSummaryConfirmed(manifest)) {
        const attemptedAt = new Date().toISOString();
        const pending: PersistedRawCaptureManifest = {
          ...manifest,
          updatedAt: attemptedAt,
          metadata: {
            ...manifest.metadata,
            visibility: "unlisted",
            uploadStatus: "not-uploaded",
            processingStatus: "pending",
            resultStatus: "pending",
            processingUpdatedAt: attemptedAt,
            discordShareStatus: "pending",
            error: "Waiting for the reviewed match result before uploading and sharing this replay."
          }
        };
        await writeRawCaptureManifest(pending);
        throw new Error(pending.metadata.error);
      }
    }
    const gzipped = manifest.artifactEncoding === "gzip"
      ? await readFile(manifest.localPath)
      : await gzipAsync(Buffer.from(await readFile(manifest.localPath, "utf8"), "utf8"));
    await this.assertActiveManifestParent(manifest);
    const sha256 = createHash("sha256").update(gzipped).digest("hex");
    const bytes = gzipped.byteLength;
    if (bytes > RIFTLITE_REPLAY_V2_MAX_GZIP_BYTES) {
      const tooLarge: PersistedRawCaptureManifest = {
        ...manifest,
        updatedAt: new Date().toISOString(),
        metadata: {
          ...manifest.metadata,
          visibility,
          uploadStatus: "too-large",
          processingStatus: "failed",
          processingUpdatedAt: new Date().toISOString(),
          checksumSha256: sha256,
          compressedBytes: bytes,
          error: `Compressed replay is larger than the ${RIFTLITE_REPLAY_V2_MAX_GZIP_BYTES / (1024 * 1024)} MiB website upload limit.`
        }
      };
      await writeRawCaptureManifest(tooLarge);
      throw new Error(tooLarge.metadata.error);
    }
    const uploadAttemptAt = new Date().toISOString();
    const uploading: PersistedRawCaptureManifest = {
      ...manifest,
      updatedAt: uploadAttemptAt,
      metadata: {
        ...manifest.metadata,
        visibility,
        processingStatus: "uploading",
        processingUpdatedAt: uploadAttemptAt,
        deliveryStage: "authenticating",
        attemptCount: Math.max(0, manifest.metadata.attemptCount ?? 0) + 1,
        nextRetryAt: undefined,
        checksumSha256: sha256,
        compressedBytes: bytes,
        lastUploadAttemptAt: uploadAttemptAt,
        error: undefined
      }
    };
    await this.assertActiveManifestParent(uploading);
    await writeRawCaptureManifest(uploading);
    let operationManifest = uploading;

    try {
      if (options.automatic === true) {
        await this.assertRiftLiteReplayUploadAccountCurrent(settings, uploading.metadata, true, manifest.platform);
      }
      await this.assertActiveManifestParent(uploading);
      const replayAuth = await this.canonicalReplayAuth(
        settings,
        uploading.metadata,
        options.automatic === true,
        manifest.platform
      );
      const idToken = replayAuth.idToken;
      const authenticatedSettings = replayAuth.settings;
      await this.assertActiveManifestParent(uploading);
      await this.assertRiftLiteReplayUploadAccountCurrent(
        authenticatedSettings,
        uploading.metadata,
        options.automatic === true,
        manifest.platform
      );
      await this.assertActiveManifestParent(uploading);
      const assertUploadStillAuthorized = async () => {
        await this.assertRiftLiteReplayUploadAccountCurrent(
          authenticatedSettings,
          uploading.metadata,
          options.automatic === true,
          manifest.platform
        );
        await this.assertActiveManifestParent(uploading);
      };
      await writeRawCaptureManifest({
        ...uploading,
        updatedAt: new Date().toISOString(),
        metadata: { ...uploading.metadata, deliveryStage: "initializing" }
      });
      const initResponse = await fetchRiftLiteReplayV2WithRetry(RIFTLITE_REPLAY_V2_INIT_ENDPOINT, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${idToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          captureId: manifest.metadata.captureSessionId,
          sha256,
          bytes,
          visibility,
          title: manifest.title,
          platform: manifest.platform,
          localReplayId: manifest.localReplayId,
          matchId: manifest.localMatchId || manifest.identity.matchId,
          seriesId: manifest.identity.seriesId,
          roomCode: manifest.metadata.roomCode,
          messageCount: manifest.metadata.messageCount,
          capturedAt: rawCaptureUploadCapturedAt(manifest)
        })
      }, assertUploadStillAuthorized);
      const initText = await readReplayResponseText(initResponse, "RiftLite replay init");
      await this.assertActiveManifestParent(uploading);
      const initBody = parseJsonObject(initText);
      if (!initResponse.ok) {
        throw replayV2ApiError("init", initResponse, initBody, initText);
      }
      const initReplay = readObject(initBody?.replay);
      const replayId = readStringDeep(initReplay, ["replayId", "id"]);
      if (!replayId) {
        throw new Error("RiftLite replay init succeeded without a replay ID.");
      }
      const statusEndpoint = riftLiteReplayStatusEndpoint(
        readStringDeep(initBody, ["statusEndpoint"]),
        replayId
      );
      const initPlayerPath = readStringDeep(initBody, ["playerPath"])
        || `/replays/${encodeURIComponent(replayId)}`;
      let serverVisibility = rawCaptureVisibilityFromValue(initReplay?.visibility);
      const uploadRequired = initBody?.uploadRequired === true;
      // Persist the server recovery key before any visibility, raw-source, or
      // completion request. A crash or timeout after init can then reconcile
      // the exact remote shell instead of creating an opaque new attempt.
      operationManifest = {
        ...uploading,
        updatedAt: new Date().toISOString(),
        metadata: {
          ...uploading.metadata,
          uploadId: replayId,
          uploadUrl: riftLiteReplayPlayerUrl(initPlayerPath, replayId),
          statusEndpoint,
          visibility: serverVisibility ?? visibility,
          processingStatus: uploadRequired ? "uploading" : "processing",
          processingUpdatedAt: new Date().toISOString(),
          deliveryStage: uploadRequired ? "uploading" : "completing"
        }
      };
      await this.assertActiveManifestParent(operationManifest);
      await writeRawCaptureManifest(operationManifest);
      if (serverVisibility !== visibility) {
        await this.assertRiftLiteReplayUploadAccountCurrent(authenticatedSettings, uploading.metadata, options.automatic === true, manifest.platform);
        await this.assertActiveManifestParent(uploading);
        serverVisibility = await updateRiftLiteReplayV2Visibility(
          replayId,
          visibility,
          idToken,
          assertUploadStillAuthorized
        );
        await this.assertActiveManifestParent(uploading);
        operationManifest = {
          ...operationManifest,
          updatedAt: new Date().toISOString(),
          metadata: { ...operationManifest.metadata, visibility: serverVisibility }
        };
        await writeRawCaptureManifest(operationManifest);
      }
      if (uploadRequired) {
        const upload = readObject(initBody?.upload);
        const uploadEndpoint = riftLiteReplayV2Endpoint(readStringDeep(upload, ["endpoint", "url"]));
        await this.assertRiftLiteReplayUploadAccountCurrent(authenticatedSettings, uploading.metadata, options.automatic === true, manifest.platform);
        await this.assertActiveManifestParent(uploading);
        operationManifest = {
          ...operationManifest,
          updatedAt: new Date().toISOString(),
          metadata: {
            ...operationManifest.metadata,
            processingStatus: "uploading",
            processingUpdatedAt: new Date().toISOString(),
            deliveryStage: "uploading"
          }
        };
        await writeRawCaptureManifest(operationManifest);
        const uploadResponse = await fetchRiftLiteReplayV2WithRetry(uploadEndpoint, {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${idToken}`,
            "Content-Type": "application/gzip",
            "X-Replay-SHA256": sha256,
            "X-Replay-Bytes": String(bytes)
          },
          body: gzipped as unknown as BodyInit
        }, assertUploadStillAuthorized);
        if (!uploadResponse.ok) {
          const uploadText = await readReplayResponseText(uploadResponse, "RiftLite replay raw upload");
          throw replayV2ApiError("raw upload", uploadResponse, parseJsonObject(uploadText), uploadText);
        }
        await this.assertActiveManifestParent(uploading);
      }

      const completeEndpoint = riftLiteReplayV2Endpoint(readStringDeep(initBody, ["completeEndpoint"]));
      await this.assertRiftLiteReplayUploadAccountCurrent(authenticatedSettings, uploading.metadata, options.automatic === true, manifest.platform);
      await this.assertActiveManifestParent(uploading);
      operationManifest = {
        ...operationManifest,
        updatedAt: new Date().toISOString(),
        metadata: {
          ...operationManifest.metadata,
          uploadStatus: "uploaded",
          uploadedAt: operationManifest.metadata.uploadedAt || new Date().toISOString(),
          processingStatus: "processing",
          processingUpdatedAt: new Date().toISOString(),
          deliveryStage: "completing"
        }
      };
      await writeRawCaptureManifest(operationManifest);
      let allowIncompleteUsed = options.allowIncomplete === true;
      const completeRequest = (allowIncomplete: boolean) => fetchRiftLiteReplayV2WithRetry(completeEndpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${idToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(allowIncomplete ? { allowIncomplete: true } : {})
      }, assertUploadStillAuthorized);
      let completeResponse = await completeRequest(allowIncompleteUsed);
      let completeText = await readReplayResponseText(completeResponse, "RiftLite replay complete");
      await assertUploadStillAuthorized();
      let completeBody = parseJsonObject(completeText);
      if (!completeResponse.ok && !allowIncompleteUsed) {
        const initialCompleteError = replayV2ApiError("complete", completeResponse, completeBody, completeText);
        if (replayV2MissingOpeningMulligan(completeBody, initialCompleteError.message)) {
          // The server still performs every essential capture validation. This
          // narrow second request only accepts an absent opening mulligan and
          // causes the published replay to retain its incomplete warning.
          await this.assertRiftLiteReplayUploadAccountCurrent(
            authenticatedSettings,
            uploading.metadata,
            options.automatic === true,
            manifest.platform
          );
          await this.assertActiveManifestParent(uploading);
          allowIncompleteUsed = true;
          completeResponse = await completeRequest(true);
          completeText = await readReplayResponseText(completeResponse, "RiftLite incomplete replay complete");
          await assertUploadStillAuthorized();
          completeBody = parseJsonObject(completeText);
        }
      }
      if (completeResponse.status === 425) {
        const processingError = replayV2ApiError("complete", completeResponse, completeBody, completeText);
        const processingRetryAt = new Date(
          Date.now() + Math.max(0, processingError.retryAfterMs ?? replayRetryAfterMs(completeResponse) ?? 5_000)
        ).toISOString();
        operationManifest = {
          ...operationManifest,
          updatedAt: new Date().toISOString(),
          metadata: {
            ...operationManifest.metadata,
            uploadStatus: "uploaded",
            processingStatus: "processing",
            processingUpdatedAt: new Date().toISOString(),
            deliveryStage: "processing",
            nextRetryAt: processingRetryAt,
            lastHttpStatus: processingError.status,
            lastErrorCode: processingError.code,
            lastErrorClass: processingError.errorClass,
            error: undefined
          }
        };
        await writeRawCaptureManifest(operationManifest);
        let reconciled = await this.reconcileRemoteReplayStatus(
          operationManifest,
          authenticatedSettings,
          options.automatic === true
        );
        if (reconciled.metadata.processingStatus === "ready") {
          return this.finalizeReadyRemoteReplay(
            reconciled,
            visibility,
            authenticatedSettings,
            options.automatic === true,
            replayAuth
          );
        }
        if (reconciled.metadata.processingStatus !== "failed") {
          return reconciled;
        }
      }
      if (!completeResponse.ok) {
        throw replayV2ApiError("complete", completeResponse, completeBody, completeText);
      }
      const completeReplay = readObject(completeBody?.replay) ?? initReplay;
      const completedVisibility = rawCaptureVisibilityFromValue(completeReplay?.visibility);
      if (completedVisibility !== visibility) {
        await this.assertRiftLiteReplayUploadAccountCurrent(authenticatedSettings, uploading.metadata, options.automatic === true, manifest.platform);
        await this.assertActiveManifestParent(uploading);
        serverVisibility = await updateRiftLiteReplayV2Visibility(
          replayId,
          visibility,
          idToken,
          assertUploadStillAuthorized
        );
        await assertUploadStillAuthorized();
      } else {
        serverVisibility = completedVisibility;
      }
      const status = normalizeRawCaptureProcessingStatus(readStringDeep(completeReplay, ["status"]));
      const completedStatusEndpoint = riftLiteReplayStatusEndpoint(
        readStringDeep(completeBody, ["statusEndpoint"]) || statusEndpoint,
        replayId
      );
      const playerPath = readStringDeep(completeBody, ["playerPath"])
        || readStringDeep(initBody, ["playerPath"])
        || `/replays/${encodeURIComponent(replayId)}`;
      const uploadUrl = riftLiteReplayPlayerUrl(playerPath, replayId);
      const serverWarnings = readReplayWarnings(completeBody);
      const incompleteFallbackWarning = "Opening mulligan was not captured; this replay starts at the first available game state.";
      const completed: PersistedRawCaptureManifest = {
        ...operationManifest,
        updatedAt: new Date().toISOString(),
        metadata: {
          ...operationManifest.metadata,
          uploadStatus: "uploaded",
          uploadUrl,
          uploadId: replayId,
          statusEndpoint: completedStatusEndpoint,
          uploadedAt: new Date().toISOString(),
          processingStatus: status,
          processingUpdatedAt: new Date().toISOString(),
          visibility: serverVisibility,
          deliveryStage: status === "ready" ? "ready" : status === "failed" ? "failed" : "processing",
          remoteStatusCheckedAt: new Date().toISOString(),
          nextRetryAt: status === "processing" || status === "uploading" || status === "pending"
            ? new Date(Date.now() + 5_000).toISOString()
            : undefined,
          lastErrorCode: undefined,
          lastErrorClass: undefined,
          lastHttpStatus: undefined,
          partialWarnings: serverWarnings.length
            ? serverWarnings
            : allowIncompleteUsed
              ? [incompleteFallbackWarning]
              : operationManifest.metadata.partialWarnings,
          error: undefined
        }
      };
      await this.assertActiveManifestParent(completed);
      await writeRawCaptureManifest(completed);
      if (completed.metadata.processingStatus === "ready") {
        return this.finalizeReadyRemoteReplay(
          completed,
          visibility,
          authenticatedSettings,
          options.automatic === true,
          replayAuth
        );
      }
      return completed;
    } catch (error) {
      if (!(error instanceof RawCaptureParentInactiveError)) {
        await this.assertActiveManifestParent(operationManifest);
        const durable = await readRawCaptureManifest(operationManifest.indexPath);
        if (durable?.metadata.processingStatus === "ready") {
          return durable;
        }
        await this.saveManifestUploadFailure(operationManifest, error);
      }
      throw error;
    }
  }

  private async retryRemoteReplayCompletion(
    manifest: PersistedRawCaptureManifest,
    requestedVisibility: RawCaptureVisibility,
    settings: UserSettings,
    options: { automatic?: boolean; allowIncomplete?: boolean; forceRetry?: boolean }
  ): Promise<PersistedRawCaptureManifest> {
    const replayId = manifest.metadata.uploadId || "";
    if (!replayId) return manifest;
    const automatic = options.automatic === true;
    const replayAuth = await this.canonicalReplayAuth(settings, manifest.metadata, automatic, manifest.platform);
    const assertStillAuthorized = async () => {
      await this.assertRiftLiteReplayUploadAccountCurrent(
        replayAuth.settings,
        manifest.metadata,
        automatic,
        manifest.platform
      );
      await this.assertActiveManifestParent(manifest);
    };
    await assertStillAuthorized();
    const completeEndpoint = riftLiteReplayV2Endpoint(
      `/api/v2/replays/${encodeURIComponent(replayId)}/complete`
    );
    const completeRequest = (allowIncomplete: boolean) => fetchRiftLiteReplayV2WithRetry(
      completeEndpoint,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${replayAuth.idToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(allowIncomplete ? { allowIncomplete: true } : {})
      },
      assertStillAuthorized
    );
    let allowIncompleteUsed = options.allowIncomplete === true;
    let response = await completeRequest(allowIncompleteUsed);
    let text = await readReplayResponseText(response, "RiftLite replay completion retry");
    await assertStillAuthorized();
    let body = parseJsonObject(text);
    if (!response.ok && !allowIncompleteUsed) {
      const initialError = replayV2ApiError("complete", response, body, text);
      if (replayV2MissingOpeningMulligan(body, initialError.message)) {
        allowIncompleteUsed = true;
        response = await completeRequest(true);
        text = await readReplayResponseText(response, "RiftLite incomplete replay completion retry");
        await assertStillAuthorized();
        body = parseJsonObject(text);
      }
    }
    if (response.status === 425) {
      const processingError = replayV2ApiError("complete", response, body, text);
      const updatedAt = new Date().toISOString();
      manifest = {
        ...manifest,
        updatedAt,
        metadata: {
          ...manifest.metadata,
          uploadStatus: "uploaded",
          processingStatus: "processing",
          processingUpdatedAt: updatedAt,
          deliveryStage: "processing",
          nextRetryAt: new Date(
            Date.now() + Math.max(0, processingError.retryAfterMs ?? replayRetryAfterMs(response) ?? 5_000)
          ).toISOString(),
          lastHttpStatus: processingError.status,
          lastErrorCode: processingError.code,
          lastErrorClass: processingError.errorClass,
          error: undefined
        }
      };
      await writeRawCaptureManifest(manifest);
      const reconciled = await this.reconcileRemoteReplayStatus(manifest, replayAuth.settings, automatic);
      return reconciled.metadata.processingStatus === "ready"
        ? this.finalizeReadyRemoteReplay(
            reconciled,
            requestedVisibility,
            replayAuth.settings,
            automatic,
            replayAuth
          )
        : reconciled;
    }
    if (!response.ok) {
      throw replayV2ApiError("complete", response, body, text);
    }
    const remoteReplay = readObject(body?.replay);
    const status = normalizeRawCaptureProcessingStatus(readStringDeep(remoteReplay, ["status"]));
    const statusEndpoint = riftLiteReplayStatusEndpoint(
      readStringDeep(body, ["statusEndpoint"]) || manifest.metadata.statusEndpoint,
      replayId
    );
    const uploadUrl = riftLiteReplayPlayerUrl(
      readStringDeep(body, ["playerPath"]) || manifest.metadata.uploadUrl || "",
      replayId
    );
    const warnings = readReplayWarnings(body);
    const updatedAt = new Date().toISOString();
    const incompleteFallbackWarning = "Opening mulligan was not captured; this replay starts at the first available game state.";
    manifest = {
      ...manifest,
      updatedAt,
      metadata: {
        ...manifest.metadata,
        uploadStatus: "uploaded",
        uploadId: replayId,
        uploadUrl,
        statusEndpoint,
        uploadedAt: manifest.metadata.uploadedAt || updatedAt,
        processingStatus: status,
        processingUpdatedAt: updatedAt,
        visibility: rawCaptureVisibilityFromValue(remoteReplay?.visibility) ?? manifest.metadata.visibility,
        deliveryStage: status === "ready" ? "ready" : status === "failed" ? "failed" : "processing",
        remoteStatusCheckedAt: updatedAt,
        nextRetryAt: ["pending", "uploading", "processing"].includes(status)
          ? new Date(Date.now() + 5_000).toISOString()
          : undefined,
        lastHttpStatus: undefined,
        lastErrorCode: undefined,
        lastErrorClass: undefined,
        partialWarnings: warnings.length
          ? warnings
          : allowIncompleteUsed
            ? [incompleteFallbackWarning]
            : manifest.metadata.partialWarnings,
        error: undefined
      }
    };
    await this.assertActiveManifestParent(manifest);
    await writeRawCaptureManifest(manifest);
    return status === "ready"
      ? this.finalizeReadyRemoteReplay(
          manifest,
          requestedVisibility,
          replayAuth.settings,
          automatic,
          replayAuth
        )
      : manifest;
  }

  private async finalizeReadyRemoteReplay(
    manifest: PersistedRawCaptureManifest,
    requestedVisibility: RawCaptureVisibility,
    settings: UserSettings,
    automatic: boolean,
    authenticatedReplayAuth?: { idToken: string; settings: UserSettings }
  ): Promise<PersistedRawCaptureManifest> {
    const replayId = manifest.metadata.uploadId || "";
    if (!replayId || manifest.metadata.processingStatus !== "ready") {
      return manifest;
    }
    const currentSettings = automatic ? await this.store.getSettings() : settings;
    const discordEligible = automatic && rawCaptureDiscordShareEligible(manifest.metadata, currentSettings);
    const targetVisibility: RawCaptureVisibility = automatic
      ? rawCaptureAutomaticTargetVisibility(manifest.metadata, currentSettings)
      : requestedVisibility;
    let replayAuth: { idToken: string; settings: UserSettings } | null = authenticatedReplayAuth ?? null;
    const authenticate = async () => {
      if (!replayAuth) {
        replayAuth = await this.canonicalReplayAuth(
          currentSettings,
          manifest.metadata,
          automatic,
          manifest.platform
        );
      }
      await this.assertRiftLiteReplayUploadAccountCurrent(
        replayAuth.settings,
        manifest.metadata,
        automatic,
        manifest.platform
      );
      await this.assertActiveManifestParent(manifest);
      return replayAuth;
    };

    if (normalizeRawCaptureVisibility(manifest.metadata.visibility) !== targetVisibility) {
      let confirmedVisibility: RawCaptureVisibility;
      try {
        const authenticated = await authenticate();
        confirmedVisibility = await updateRiftLiteReplayV2Visibility(
          replayId,
          targetVisibility,
          authenticated.idToken,
          async () => { await authenticate(); }
        );
      } catch (error) {
        await this.saveReadyVisibilityReconciliationFailure(manifest, targetVisibility, error);
        throw error;
      }
      const updatedAt = new Date().toISOString();
      manifest = {
        ...manifest,
        updatedAt,
        metadata: {
          ...manifest.metadata,
          uploadStatus: "uploaded",
          processingStatus: "ready",
          processingUpdatedAt: updatedAt,
          deliveryStage: "ready",
          visibility: confirmedVisibility,
          nextRetryAt: undefined,
          lastHttpStatus: undefined,
          lastErrorCode: undefined,
          lastErrorClass: undefined,
          error: undefined
        }
      };
      await this.assertActiveManifestParent(manifest);
      await writeRawCaptureManifest(manifest);
    }

    if (discordEligible && rawCaptureDiscordShareNeedsRetry(manifest.metadata, currentSettings)) {
      const authenticated = await authenticate();
      manifest = await this.sharePersistedReplayToDiscord(
        manifest,
        replayId,
        authenticated.idToken,
        async () => {
          const latest = await this.store.getSettings();
          if (!rawCaptureDiscordShareEligible(manifest.metadata, latest)) {
            throw new RawCaptureDiscordConsentChangedError();
          }
          await this.assertRiftLiteReplayUploadAccountCurrent(
            authenticated.settings,
            manifest.metadata,
            true,
            manifest.platform
          );
        }
      );
    }
    return manifest;
  }

  private async saveReadyVisibilityReconciliationFailure(
    manifest: PersistedRawCaptureManifest,
    targetVisibility: RawCaptureVisibility,
    error: unknown
  ): Promise<PersistedRawCaptureManifest> {
    const failure = replayDeliveryFailureDetails(error);
    const attemptCount = Math.max(1, manifest.metadata.attemptCount ?? 1);
    const retryDelayMs = failure.retryable
      ? failure.retryAfterMs !== undefined
        ? Math.min(RAW_CAPTURE_MAX_AUTO_UPLOAD_RETRY_DELAY_MS, Math.max(0, failure.retryAfterMs))
        : Math.min(
            RAW_CAPTURE_MAX_AUTO_UPLOAD_RETRY_DELAY_MS,
            RAW_CAPTURE_AUTO_UPLOAD_RETRY_COOLDOWN_MS * (2 ** Math.min(4, attemptCount - 1))
          )
      : undefined;
    const updatedAt = new Date().toISOString();
    const pending: PersistedRawCaptureManifest = {
      ...manifest,
      updatedAt,
      metadata: {
        ...manifest.metadata,
        uploadStatus: "uploaded",
        processingStatus: "ready",
        processingUpdatedAt: updatedAt,
        deliveryStage: "paused",
        attemptCount,
        nextRetryAt: retryDelayMs !== undefined
          ? new Date(Date.now() + retryDelayMs).toISOString()
          : undefined,
        lastHttpStatus: failure.status,
        lastErrorCode: failure.code,
        lastErrorClass: failure.errorClass,
        error: truncateForUi(
          `Replay is online, but RiftLite could not set its visibility to ${targetVisibility}: ${failure.message}`,
          300
        )
      }
    };
    await this.assertActiveManifestParent(pending);
    await writeRawCaptureManifest(pending);
    return pending;
  }

  private async reconcileRemoteReplayStatus(
    manifest: PersistedRawCaptureManifest,
    settings: UserSettings,
    automatic: boolean
  ): Promise<PersistedRawCaptureManifest> {
    const replayId = manifest.metadata.uploadId || "";
    if (!replayId) {
      return manifest;
    }
    const statusEndpoint = riftLiteReplayStatusEndpoint(manifest.metadata.statusEndpoint, replayId);
    const replayAuth = await this.canonicalReplayAuth(settings, manifest.metadata, automatic, manifest.platform);
    await this.assertRiftLiteReplayUploadAccountCurrent(
      replayAuth.settings,
      manifest.metadata,
      automatic,
      manifest.platform
    );
    await this.assertActiveManifestParent(manifest);
    const response = await fetchRiftLiteReplayV2WithRetry(statusEndpoint, {
      method: "GET",
      headers: { "Authorization": `Bearer ${replayAuth.idToken}` }
    }, async () => {
      await this.assertRiftLiteReplayUploadAccountCurrent(
        replayAuth.settings,
        manifest.metadata,
        automatic,
        manifest.platform
      );
      await this.assertActiveManifestParent(manifest);
    });
    const text = await readReplayResponseText(response, "RiftLite replay status");
    const body = parseJsonObject(text);
    if (!response.ok) {
      throw replayV2ApiError("status", response, body, text);
    }
    const remote = readReplayRemoteStatus(body, replayId, statusEndpoint);
    const checkedAt = new Date().toISOString();
    const uploadUrl = riftLiteReplayPlayerUrl(
      remote.playerPath || manifest.metadata.uploadUrl || "",
      replayId
    );
    const nextRetryAt = remote.retryable
      ? new Date(Date.now() + Math.max(0, remote.retryAfterMs ?? 5_000)).toISOString()
      : ["pending", "processing", "uploading"].includes(remote.processingStatus)
        ? new Date(Date.now() + 5_000).toISOString()
        : undefined;
    const updated: PersistedRawCaptureManifest = {
      ...manifest,
      updatedAt: checkedAt,
      metadata: {
        ...manifest.metadata,
        uploadStatus: remote.processingStatus === "uploading"
          ? manifest.metadata.uploadStatus
          : "uploaded",
        uploadId: replayId,
        uploadUrl,
        statusEndpoint: remote.statusEndpoint || statusEndpoint,
        uploadedAt: manifest.metadata.uploadedAt || (
          remote.processingStatus === "uploading" ? undefined : checkedAt
        ),
        processingStatus: remote.processingStatus,
        processingUpdatedAt: checkedAt,
        visibility: remote.visibility ?? manifest.metadata.visibility,
        deliveryStage: remote.deliveryStage,
        remoteStatusCheckedAt: checkedAt,
        nextRetryAt,
        lastHttpStatus: remote.processingStatus === "failed" ? manifest.metadata.lastHttpStatus : undefined,
        lastErrorCode: remote.failureCode,
        lastErrorClass: remote.failureClass,
        partialWarnings: remote.warnings.length ? remote.warnings : manifest.metadata.partialWarnings,
        error: remote.failureMessage
      }
    };
    await this.assertActiveManifestParent(updated);
    await writeRawCaptureManifest(updated);
    return updated;
  }

  private async assertRiftLiteReplayUploadAccountCurrent(
    settings: UserSettings,
    metadata: RawCaptureReplayMetadata,
    automatic: boolean,
    platform: "atlas" | "tcga" = "atlas"
  ): Promise<void> {
    const current = await this.store.getSettings();
    if (
      !normalizeRiftLiteAccountUid(settings.accountUid) ||
      !settings.firebaseRefreshToken ||
      !hasVerifiedRiftLiteAccount(settings) ||
      !riftLiteAccountUidEquals(current.accountUid, settings.accountUid) ||
      current.firebaseRefreshToken !== settings.firebaseRefreshToken ||
      !hasVerifiedRiftLiteAccount(current)
    ) {
      throw new Error("The linked RiftLite account changed during replay upload.");
    }
    if (automatic && !rawCaptureWebReplayAutoUploadEligibleForPlatform(platform, metadata, current)) {
      throw new Error("RiftLite Web Replay automatic upload was disabled or its consenting account changed.");
    }
  }

  private async canonicalReplayAuth(
    settings: UserSettings,
    metadata: RawCaptureReplayMetadata,
    automatic: boolean,
    platform: "atlas" | "tcga" = "atlas"
  ): Promise<{ idToken: string; settings: UserSettings }> {
    const expectedAccountUid = normalizeRiftLiteAccountUid(settings.accountUid);
    if (!expectedAccountUid || !settings.firebaseRefreshToken || !hasVerifiedRiftLiteAccount(settings)) {
      throw new Error("Verify or reconnect your RiftLite account from Account before uploading to RiftLite Web Replay. The local replay capture is safe.");
    }
    const idToken = await withReplayDeadline(
      Promise.resolve(this.linkedAccountIdTokenProvider(expectedAccountUid)),
      RIFTLITE_REPLAY_AUTH_TIMEOUT_MS,
      "RiftLite replay authentication"
    );
    if (!idToken) {
      throw new Error("Could not refresh the canonical RiftLite account token.");
    }
    // The canonical provider may repair an old alias credential and rotate the
    // stored refresh token. Adopt that repaired credential only when the pinned
    // account itself is unchanged; an account switch still fails closed.
    const authenticatedSettings = await this.store.getSettings();
    if (
      normalizeRiftLiteAccountUid(authenticatedSettings.accountUid) !== expectedAccountUid ||
      !authenticatedSettings.firebaseRefreshToken
    ) {
      throw new Error("The linked RiftLite account changed during replay authentication.");
    }
    if (automatic && !rawCaptureWebReplayAutoUploadEligibleForPlatform(platform, metadata, authenticatedSettings)) {
      throw new Error("RiftLite Web Replay automatic upload was disabled or its consenting account changed.");
    }
    return { idToken, settings: authenticatedSettings };
  }

  private async waitForDiscordMatchSummary(
    manifest: PersistedRawCaptureManifest,
    waitForResult: boolean
  ): Promise<PersistedRawCaptureManifest> {
    await this.assertActiveManifestParent(manifest);
    let refreshed = await this.refreshPersistedMatchSummary(manifest);
    await this.assertActiveManifestParent(refreshed);
    if (await this.persistedDiscordMatchSummaryConfirmed(refreshed)) {
      return refreshed;
    }
    if (!waitForResult) {
      return refreshed;
    }

    await rawCaptureDelay(RAW_CAPTURE_DISCORD_RESULT_INITIAL_WAIT_MS);
    await this.assertActiveManifestParent(refreshed);
    const deadline = Date.now() + (
      RAW_CAPTURE_DISCORD_RESULT_MAX_WAIT_MS - RAW_CAPTURE_DISCORD_RESULT_INITIAL_WAIT_MS
    );
    while (true) {
      refreshed = await this.refreshPersistedMatchSummary(refreshed);
      await this.assertActiveManifestParent(refreshed);
      if (await this.persistedDiscordMatchSummaryConfirmed(refreshed) || Date.now() >= deadline) {
        return refreshed;
      }
      await rawCaptureDelay(Math.min(RAW_CAPTURE_DISCORD_RESULT_POLL_MS, deadline - Date.now()));
      await this.assertActiveManifestParent(refreshed);
    }
  }

  /**
   * A score-derived capture result is only provisional. Discord may use the
   * summary after the user has saved the match logger and the manifest matches
   * that reviewed local record.
   */
  private async persistedDiscordMatchSummaryConfirmed(
    manifest: PersistedRawCaptureManifest
  ): Promise<boolean> {
    const localMatchId = manifest.localMatchId || manifest.identity.localMatchId;
    if (!localMatchId) {
      return false;
    }
    const currentMatch = (await this.store.getMatches()).find((match) => match.id === localMatchId);
    if (currentMatch?.status !== "saved") {
      return false;
    }
    const reviewedSummary = rawCaptureMatchSummaryFromDraft(currentMatch);
    return rawCaptureMatchSummaryResolved(reviewedSummary) &&
      Boolean(reviewedSummary && rawCaptureMatchSummariesEqual(manifest.match, reviewedSummary));
  }

  private async refreshPersistedMatchSummary(
    manifest: PersistedRawCaptureManifest
  ): Promise<PersistedRawCaptureManifest> {
    const localMatchId = manifest.localMatchId || manifest.identity.localMatchId;
    if (!localMatchId) {
      return manifest;
    }
    const currentMatch = (await this.store.getMatches()).find((match) => match.id === localMatchId);
    const summary = rawCaptureMatchSummaryFromDraft(currentMatch);
    if (
      !summary ||
      (rawCaptureMatchSummaryResolved(manifest.match) && !rawCaptureMatchSummaryResolved(summary)) ||
      rawCaptureMatchSummariesEqual(manifest.match, summary)
    ) {
      return manifest;
    }
    await writeRawCaptureMatchSummary(manifest.localPath, summary);
    const resultUpdatedAt = new Date().toISOString();
    const resultResolved = rawCaptureMatchSummaryResolved(summary);
    const updated: PersistedRawCaptureManifest = {
      ...manifest,
      updatedAt: resultUpdatedAt,
      match: summary,
      metadata: {
        ...manifest.metadata,
        resultStatus: resultResolved ? "resolved" : "pending",
        resultFinalizedAt: resultResolved
          ? manifest.metadata.resultFinalizedAt || resultUpdatedAt
          : undefined
      }
    };
    await writeRawCaptureManifest(updated);
    return updated;
  }

  private async sharePersistedReplayToDiscord(
    manifest: PersistedRawCaptureManifest,
    replayId: string,
    idToken: string,
    beforeAttempt?: () => Promise<void>
  ): Promise<PersistedRawCaptureManifest> {
    await this.assertActiveManifestParent(manifest);
    const hubIds = manifest.metadata.webReplayDiscordShareHubIds ?? [];
    const discordAttemptAt = new Date().toISOString();
    manifest = {
      ...manifest,
      updatedAt: discordAttemptAt,
      metadata: {
        ...manifest.metadata,
        discordShareStatus: "pending",
        discordLastAttemptAt: discordAttemptAt,
        discordShareError: undefined
      }
    };
    await this.assertActiveManifestParent(manifest);
    await writeRawCaptureManifest(manifest);
    try {
      const endpoint = `${RIFTLITE_REPLAY_ORIGIN}/api/v2/replays/${encodeURIComponent(replayId)}/share-discord`;
      const activeDeck = await this.discordActiveDeckForManifest(manifest);
      await this.assertActiveManifestParent(manifest);
      const response = await fetchRiftLiteReplayV2WithRetry(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${idToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ hubIds, ...(activeDeck ? { activeDeck } : {}) })
      }, async () => {
        await this.assertActiveManifestParent(manifest);
        await beforeAttempt?.();
      });
      const text = await readReplayResponseText(response, "Discord replay share");
      await this.assertActiveManifestParent(manifest);
      const body = parseJsonObject(text);
      if (!response.ok) {
        throw replayV2ApiError("Discord replay share", response, body, text);
      }
      const results = Array.isArray(body?.results) ? body.results.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
      const sharedHubIds = results
        .filter((result) => ["shared", "already-shared"].includes(readStringDeep(result, ["status"])))
        .map((result) => readStringDeep(result, ["hubId"]))
        .filter(Boolean);
      const allShared = hubIds.length > 0 && hubIds.every((hubId) => sharedHubIds.includes(hubId));
      const status: NonNullable<RawCaptureReplayMetadata["discordShareStatus"]> = allShared
        ? "shared"
        : sharedHubIds.length
          ? "partial"
          : "failed";
      const deliveryUpdatedAt = new Date().toISOString();
      const updated: PersistedRawCaptureManifest = {
        ...manifest,
        updatedAt: deliveryUpdatedAt,
        metadata: {
          ...manifest.metadata,
          visibility: "unlisted",
          discordShareStatus: status,
          discordSharedHubIds: sharedHubIds,
          discordSharedAt: allShared ? deliveryUpdatedAt : manifest.metadata.discordSharedAt,
          discordShareError: allShared ? undefined : "One or more selected hubs could not receive the replay. Check its Discord reports_channel setup."
        }
      };
      await this.assertActiveManifestParent(updated);
      await writeRawCaptureManifest(updated);
      return updated;
    } catch (error) {
      if (error instanceof RawCaptureParentInactiveError) {
        throw error;
      }
      if (error instanceof RawCaptureDiscordConsentChangedError) {
        return manifest;
      }
      await this.assertActiveManifestParent(manifest);
      const updated: PersistedRawCaptureManifest = {
        ...manifest,
        updatedAt: new Date().toISOString(),
        metadata: {
          ...manifest.metadata,
          visibility: "unlisted",
          discordShareStatus: "failed",
          discordShareError: truncateForUi(error instanceof Error ? error.message : "Discord replay share failed.", 300)
        }
      };
      await writeRawCaptureManifest(updated);
      return updated;
    }
  }

  private async saveManifestUploadFailure(
    manifest: PersistedRawCaptureManifest,
    error: unknown
  ): Promise<PersistedRawCaptureManifest> {
    const failure = replayDeliveryFailureDetails(error);
    const attemptCount = Math.max(1, manifest.metadata.attemptCount ?? 1);
    const retryDelayMs = failure.retryable
      ? failure.retryAfterMs !== undefined
        ? Math.min(RAW_CAPTURE_MAX_AUTO_UPLOAD_RETRY_DELAY_MS, Math.max(0, failure.retryAfterMs))
        : Math.min(
            RAW_CAPTURE_MAX_AUTO_UPLOAD_RETRY_DELAY_MS,
            RAW_CAPTURE_AUTO_UPLOAD_RETRY_COOLDOWN_MS * (2 ** Math.min(4, attemptCount - 1))
          )
      : undefined;
    const remoteSourceExists = Boolean(
      manifest.metadata.uploadId &&
      (
        manifest.metadata.uploadStatus === "uploaded" ||
        ["completing", "processing", "ready"].includes(manifest.metadata.deliveryStage || "")
      )
    );
    const failed: PersistedRawCaptureManifest = {
      ...manifest,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...manifest.metadata,
        uploadStatus: remoteSourceExists ? "uploaded" : "failed",
        processingStatus: "failed",
        processingUpdatedAt: new Date().toISOString(),
        deliveryStage: failure.retryable ? "paused" : "failed",
        attemptCount,
        nextRetryAt: retryDelayMs !== undefined
          ? new Date(Date.now() + retryDelayMs).toISOString()
          : undefined,
        lastHttpStatus: failure.status,
        lastErrorCode: failure.code,
        lastErrorClass: failure.errorClass,
        error: truncateForUi(failure.message, 300)
      }
    };
    await writeRawCaptureManifest(failed);
    return failed;
  }

  private ensureInterruptedCaptureRecovery(settings: UserSettings): Promise<void> {
    if (!this.journalRecoveryPromise) {
      this.journalRecoveryPromise = this.recoverInterruptedCaptureJournals(settings).catch((error) => {
        this.lastAssociationError = `RiftLite could not recover an interrupted Web Replay capture: ${
          truncateForUi(error instanceof Error ? error.message : String(error), 220)
        }`;
        // A temporarily unavailable replay folder must not disable recovery
        // for the rest of this desktop process.
        this.journalRecoveryPromise = null;
      });
    }
    return this.journalRecoveryPromise;
  }

  private async recoverInterruptedCaptureJournals(settings: UserSettings): Promise<void> {
    const directory = await rawCaptureDirectory(settings);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const journalPaths = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(RAW_CAPTURE_JOURNAL_SUFFIX))
      .map((entry) => join(directory, entry.name))
      .filter((journalPath) => !this.ownedJournalPaths.has(journalPath));
    if (!journalPaths.length) {
      return;
    }
    const existingCaptureSessionIds = new Set(
      (await readRawCaptureManifests(settings)).map((manifest) => manifest.metadata.captureSessionId)
    );
    const recoveredJournals = await Promise.all(journalPaths.map(async (journalPath) => ({
      journalPath,
      journal: await this.readActiveCaptureJournal(journalPath)
    })));
    const journalCaptureSessionIds = new Set(recoveredJournals
      .map(({ journal }) => journal?.session.captureSessionId)
      .filter((captureSessionId): captureSessionId is string => Boolean(captureSessionId)));
    const incorporatedJournalIds = new Set<string>();
    for (const { journal } of recoveredJournals) {
      for (const sourceCaptureSessionId of journal?.session.sourceCaptureSessionIds ?? []) {
        if (
          sourceCaptureSessionId !== journal?.session.captureSessionId &&
          journalCaptureSessionIds.has(sourceCaptureSessionId)
        ) {
          incorporatedJournalIds.add(sourceCaptureSessionId);
        }
      }
    }
    let transientRecoveryFailure: Error | null = null;
    for (const { journalPath, journal } of recoveredJournals) {
      if (!journal) {
        this.lastAssociationError = "RiftLite found an interrupted Web Replay journal, but it was incomplete or invalid and was left in place for diagnostics.";
        continue;
      }
      if (incorporatedJournalIds.has(journal.session.captureSessionId)) {
        await unlink(journalPath).catch(() => undefined);
        continue;
      }
      if (existingCaptureSessionIds.has(journal.session.captureSessionId)) {
        await unlink(journalPath).catch(() => undefined);
        continue;
      }
      const recoveredAt = Date.now();
      journal.session.boundaries.push({ at: journal.session.lastSeenAt, reason: "desktop-restart-recovery" });
      journal.session.diagnostics.push({
        ts: recoveredAt,
        severity: "warn",
        code: "recovered_after_unexpected_shutdown",
        message: RAW_CAPTURE_RECOVERY_WARNING
      });
      try {
        const recoveredAtIso = new Date(recoveredAt).toISOString();
        const manifest = await this.persistSession(journal.session, {
          platform: "atlas",
          title: "Recovered Atlas capture",
          completedAt: recoveredAtIso
        }, undefined, settings, { recoveredFromJournalAt: recoveredAtIso });
        existingCaptureSessionIds.add(manifest.metadata.captureSessionId);
        await unlink(journalPath).catch(() => undefined);
        this.lastAssociationError = "";
      } catch (error) {
        transientRecoveryFailure = error instanceof Error ? error : new Error(String(error));
        this.lastAssociationError = `RiftLite kept an interrupted Web Replay journal for a later recovery attempt: ${
          truncateForUi(transientRecoveryFailure.message, 220)
        }`;
      }
    }
    if (transientRecoveryFailure) {
      throw transientRecoveryFailure;
    }
  }

  private async readActiveCaptureJournal(journalPath: string): Promise<PersistedRawCaptureJournal | null> {
    const journalStat = await stat(journalPath).catch(() => null);
    if (!journalStat || !journalStat.isFile() || journalStat.size <= 0 || journalStat.size > RAW_CAPTURE_MAX_JOURNAL_BYTES) {
      return null;
    }
    const contents = await readFile(journalPath, "utf8").catch(() => "");
    let session: ActiveRawCaptureSession | null = null;
    for (const line of contents.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const entry = parseRawCaptureJournalEntry(line);
      if (!entry) {
        // A process can stop between writing the final bytes of one JSONL row.
        // Earlier complete rows remain a valid recovery checkpoint.
        continue;
      }
      if (entry.kind === "checkpoint") {
        session = normalizeRecoveredRawCaptureSession(entry.session, entry.captureSessionId);
        continue;
      }
      if (session && session.captureSessionId !== entry.captureSessionId) {
        continue;
      }
      session = this.applyRecoveredJournalFrame(session, entry);
    }
    if (!session?.frames.length) {
      return null;
    }
    session.frames = session.frames.slice(0, RAW_CAPTURE_MAX_MESSAGES).map((frame, index) => ({
      ...frame,
      seq: index
    }));
    session.nextSeq = session.frames.length;
    session.byteSize = session.frames.reduce((total, frame) => total + Buffer.byteLength(frame.raw, "utf8"), 0);
    session.capped = session.capped ||
      session.frames.length >= RAW_CAPTURE_MAX_MESSAGES ||
      session.byteSize >= RAW_CAPTURE_MAX_BYTES;
    return { path: journalPath, session };
  }

  private applyRecoveredJournalFrame(
    current: ActiveRawCaptureSession | null,
    entry: RawCaptureJournalFrameEntry
  ): ActiveRawCaptureSession {
    const sourceFrame = entry.frame;
    const ts = sourceFrame.ts;
    const socketId = sourceFrame.socketId || "ws-1";
    const session = current ?? {
      captureSessionId: entry.captureSessionId,
      platform: "atlas",
      requestUrl: entry.requestUrl,
      frames: [],
      sockets: {},
      boundaries: [{ at: ts, reason: "session-start" }],
      diagnostics: [],
      nextSeq: 0,
      byteSize: 0,
      capped: false,
      firstSeenAt: ts,
      lastSeenAt: ts,
      roomCode: "",
      roomCodes: [],
      seriesId: "",
      matchId: "",
      matchIds: [],
      replayId: "",
      replayIds: [],
      sourceCaptureSessionIds: [],
      matchFormat: "",
      webReplayAutoUploadAccountUid: entry.consent.webReplayAutoUploadAccountUid,
      webReplayDiscordShareAccountUid: entry.consent.webReplayDiscordShareAccountUid,
      webReplayDiscordShareHubIds: [...entry.consent.webReplayDiscordShareHubIds],
      provisional: entry.consent.provisional,
      lastPhase: "",
      phases: [],
      games: [],
      keptCount: 0,
      droppedCount: 0,
      droppedBytes: 0,
      lastFrameType: "",
      lastError: ""
    };
    if (session.frames.length >= RAW_CAPTURE_MAX_MESSAGES || session.byteSize >= RAW_CAPTURE_MAX_BYTES) {
      session.capped = true;
      return session;
    }
    const details = extractRawCaptureDetails(sourceFrame.raw);
    if (
      details.roomCode &&
      session.roomCode &&
      !identityEquals(details.roomCode, session.roomCode) &&
      !session.roomCodes.some((roomCode) => identityEquals(roomCode, details.roomCode))
    ) {
      session.boundaries.push({
        at: ts,
        reason: `room-code-change:${session.roomCode}->${details.roomCode}`
      });
    }
    if (!session.sockets[socketId]) {
      session.sockets[socketId] = {
        socketId,
        url: entry.requestUrl,
        openedAt: ts,
        closedAt: null,
        close: { code: null, reason: "", wasClean: null }
      };
    }
    this.updateLifecycle(session, details, ts, session.nextSeq);
    const frame: RawCaptureFrame = {
      ...sourceFrame,
      seq: session.nextSeq,
      socketId,
      type: sourceFrame.type || details.type || null,
      drop: Boolean(sourceFrame.drop),
      dropReason: sourceFrame.dropReason || null
    };
    session.nextSeq += 1;
    session.frames.push(frame);
    const frameBytes = Buffer.byteLength(frame.raw, "utf8");
    session.byteSize += frameBytes;
    session.lastSeenAt = Math.max(session.lastSeenAt, ts);
    session.requestUrl = entry.requestUrl || session.requestUrl;
    session.roomCode = details.roomCode || session.roomCode;
    rememberRoomCode(session, details.roomCode);
    session.seriesId = details.seriesId || session.seriesId;
    session.matchId = details.matchId || session.matchId;
    rememberRawCaptureIdentity(session.matchIds, details.matchId);
    session.replayId = details.replayId || session.replayId;
    rememberRawCaptureIdentity(session.replayIds, details.replayId);
    rememberRawCaptureIdentity(session.sourceCaptureSessionIds, details.captureSessionId);
    session.matchFormat = details.matchFormat || session.matchFormat;
    session.webReplayAutoUploadAccountUid = entry.consent.webReplayAutoUploadAccountUid;
    session.webReplayDiscordShareAccountUid = entry.consent.webReplayDiscordShareAccountUid;
    session.webReplayDiscordShareHubIds = [...entry.consent.webReplayDiscordShareHubIds];
    session.provisional = entry.consent.provisional;
    session.lastPhase = details.phase || session.lastPhase;
    session.lastGameNumber = details.gameNumber ?? session.lastGameNumber;
    session.lastFrameType = details.type || session.lastFrameType;
    if (frame.drop) {
      session.droppedCount += 1;
      session.droppedBytes += frameBytes;
    } else {
      session.keptCount += 1;
    }
    return session;
  }

  private async checkpointActiveSession(
    session: ActiveRawCaptureSession,
    frame: RawCaptureFrame,
    settings: UserSettings
  ): Promise<void> {
    try {
      let journalPath = this.journalPathsBySessionId.get(session.captureSessionId);
      const expectedJournalPath = join(
        rawCaptureDirectoryPath(settings),
        `${session.captureSessionId}${RAW_CAPTURE_JOURNAL_SUFFIX}`
      );
      if (journalPath && resolve(journalPath) !== resolve(expectedJournalPath)) {
        await this.closeSessionJournalHandle(session.captureSessionId);
        this.ownedJournalPaths.delete(journalPath);
        this.journalCleanupPaths.add(journalPath);
        journalPath = undefined;
        this.journalRewriteSessionIds.add(session.captureSessionId);
      }
      if (!journalPath) {
        journalPath = join(await rawCaptureDirectory(settings), `${session.captureSessionId}${RAW_CAPTURE_JOURNAL_SUFFIX}`);
        this.journalPathsBySessionId.set(session.captureSessionId, journalPath);
      }
      this.ownedJournalPaths.add(journalPath);
      if (this.journalRewriteSessionIds.delete(session.captureSessionId)) {
        await this.closeSessionJournalHandle(session.captureSessionId);
        const checkpoint: RawCaptureJournalCheckpointEntry = {
          schema: "riftlite-active-raw-capture-journal",
          version: 1,
          kind: "checkpoint",
          captureSessionId: session.captureSessionId,
          session
        };
        await writeUtf8FileAtomically(journalPath, `${JSON.stringify(checkpoint)}\n`);
        const cleanupPaths = [...this.journalCleanupPaths];
        this.journalCleanupPaths.clear();
        await Promise.all(cleanupPaths.map(async (cleanupPath) => {
          const cleanupSessionId = [...this.journalPathsBySessionId.entries()]
            .find(([, candidatePath]) => candidatePath === cleanupPath)?.[0];
          if (cleanupSessionId) {
            await this.closeSessionJournalHandle(cleanupSessionId);
            this.journalPathsBySessionId.delete(cleanupSessionId);
          }
          this.ownedJournalPaths.delete(cleanupPath);
          await unlink(cleanupPath).catch(() => undefined);
        }));
        return;
      }
      const entry: RawCaptureJournalFrameEntry = {
        schema: "riftlite-active-raw-capture-journal",
        version: 1,
        kind: "frame",
        captureSessionId: session.captureSessionId,
        requestUrl: session.requestUrl,
        frame,
        consent: {
          webReplayAutoUploadAccountUid: session.webReplayAutoUploadAccountUid,
          webReplayDiscordShareAccountUid: session.webReplayDiscordShareAccountUid,
          webReplayDiscordShareHubIds: [...session.webReplayDiscordShareHubIds],
          provisional: session.provisional
        }
      };
      this.cancelSessionJournalHandleClose(session.captureSessionId);
      let journalHandle = this.journalHandlesBySessionId.get(session.captureSessionId);
      if (!journalHandle) {
        journalHandle = await open(journalPath, "a");
        this.journalHandlesBySessionId.set(session.captureSessionId, journalHandle);
      }
      await journalHandle.appendFile(`${JSON.stringify(entry)}\n`, "utf8");
      this.scheduleSessionJournalHandleClose(session.captureSessionId);
    } catch {
      await this.closeSessionJournalHandle(session.captureSessionId);
      if (!session.diagnostics.some((diagnostic) => diagnostic.code === "active_journal_write_failed")) {
        session.diagnostics.push({
          ts: Date.now(),
          severity: "warn",
          code: "active_journal_write_failed",
          message: "RiftLite could not checkpoint this active Web Replay capture to disk. In-memory capture continued."
        });
      }
    }
  }

  private async discardSessionJournal(captureSessionId: string): Promise<void> {
    const journalPath = this.journalPathsBySessionId.get(captureSessionId);
    await this.closeSessionJournalHandle(captureSessionId);
    this.journalPathsBySessionId.delete(captureSessionId);
    this.journalRewriteSessionIds.delete(captureSessionId);
    if (!journalPath) {
      return;
    }
    this.ownedJournalPaths.delete(journalPath);
    this.journalCleanupPaths.delete(journalPath);
    await unlink(journalPath).catch(() => undefined);
  }

  private async closeSessionJournalHandle(captureSessionId: string): Promise<void> {
    this.cancelSessionJournalHandleClose(captureSessionId);
    const journalHandle = this.journalHandlesBySessionId.get(captureSessionId);
    this.journalHandlesBySessionId.delete(captureSessionId);
    await journalHandle?.close().catch(() => undefined);
  }

  private scheduleSessionJournalHandleClose(captureSessionId: string): void {
    this.cancelSessionJournalHandleClose(captureSessionId);
    const timer = setTimeout(() => {
      this.journalHandleCloseTimers.delete(captureSessionId);
      void this.closeSessionJournalHandle(captureSessionId);
    }, RAW_CAPTURE_JOURNAL_HANDLE_IDLE_MS);
    timer.unref?.();
    this.journalHandleCloseTimers.set(captureSessionId, timer);
  }

  private cancelSessionJournalHandleClose(captureSessionId: string): void {
    const timer = this.journalHandleCloseTimers.get(captureSessionId);
    if (timer) clearTimeout(timer);
    this.journalHandleCloseTimers.delete(captureSessionId);
  }

  private currentSession(): ActiveRawCaptureSession | null {
    return Array.from(this.sessions.values()).reduce<ActiveRawCaptureSession | null>((latest, session) => (
      !latest || session.lastSeenAt >= latest.lastSeenAt ? session : latest
    ), null);
  }

  private removeSession(captureSessionId: string): void {
    this.forgetSessionInMemory(captureSessionId);
    void this.discardSessionJournal(captureSessionId);
  }

  private forgetSessionInMemory(captureSessionId: string): void {
    this.sessions.delete(captureSessionId);
    for (const [key, routedSessionId] of this.sessionIdByTransport) {
      if (routedSessionId === captureSessionId) {
        this.sessionIdByTransport.delete(key);
      }
    }
  }

  private clearSessions(): void {
    this.sessions.clear();
    this.sessionIdByTransport.clear();
  }

  private async clearSessionsAndJournals(): Promise<void> {
    const captureSessionIds = [...this.sessions.keys()];
    this.clearSessions();
    await Promise.all(captureSessionIds.map((captureSessionId) => this.discardSessionJournal(captureSessionId)));
    this.journalRewriteSessionIds.clear();
    this.journalCleanupPaths.clear();
  }

  private async drainPendingFrames(): Promise<void> {
    // Frame ingress is fire-and-forget in the Electron IPC bridge. Follow the
    // tail until it stops changing so match finalization cannot overtake an
    // earlier frame that was still waiting on the async settings lookup.
    while (true) {
      const tail = this.appendFrameTail;
      await tail;
      if (tail === this.appendFrameTail) {
        return;
      }
    }
  }

  private async withCaptureTask<T>(captureSessionId: string, operation: () => Promise<T>): Promise<T> {
    const key = normalizeDiagnosticCaptureSessionId(captureSessionId);
    const previous = this.captureTaskTails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.captureTaskTails.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.captureTaskTails.get(key) === tail) {
        this.captureTaskTails.delete(key);
      }
    }
  }

  private buildPayload(
    session: ActiveRawCaptureSession,
    match?: RawCaptureMatchSummary
  ): RawCapturePayload {
    const messages = session.frames.map((frame, index) => ({
      ...frame,
      seq: index,
      socketId: frame.socketId || null,
      type: frame.type || null,
      drop: Boolean(frame.drop),
      dropReason: frame.dropReason || null
    }));
    return {
      schema: "riftreplay-raw-capture",
      version: 1,
      exportedAt: new Date().toISOString(),
      capture: {
        captureSessionId: session.captureSessionId,
        ...(match ? { match } : {}),
        identity: {
          roomCode: session.roomCodes[0] || session.roomCode || null,
          roomCodes: session.roomCodes.slice(),
          seriesId: session.seriesId || null,
          matchId: session.matchId || null,
          matchIds: session.matchIds.slice(),
          replayId: session.replayId || null,
          replayIds: session.replayIds.slice(),
          firstSeenAt: session.firstSeenAt,
          lastSeenAt: session.lastSeenAt
        },
        lifecycle: {
          lastPhase: session.lastPhase || null,
          lastGameNumber: typeof session.lastGameNumber === "number" ? session.lastGameNumber : null,
          boundaries: session.boundaries.slice(),
          phases: session.phases.map(clonePhaseSegment),
          games: session.games.map((game) => ({
            ...game,
            roomCodes: game.roomCodes.slice(),
            matchIds: game.matchIds.slice(),
            source: { ...game.source },
            phases: game.phases.map(clonePhaseSegment)
          }))
        }
      },
      script: { name: "RiftLite Raw Capture", version: appVersion() },
      browser: { userAgent: `RiftLite/${appVersion()} Electron` },
      sockets: Object.values(session.sockets),
      filter: buildFilterStats(messages),
      messages,
      diagnostics: session.diagnostics
    };
  }

  private updateLifecycle(
    session: ActiveRawCaptureSession,
    details: RawCaptureFrameDetails,
    ts: number,
    sourceSeq: number
  ): void {
    const previousGameNumber = session.lastGameNumber;
    const gameNumber = details.gameNumber ?? previousGameNumber;
    const previousGame = session.games.at(-1);
    let activeGame = previousGame;
    if (typeof gameNumber === "number") {
      if (!activeGame || activeGame.gameNumber !== gameNumber) {
        activeGame = {
          gameNumber,
          startedAt: ts,
          endedAt: ts,
          roomCodes: [],
          matchIds: [],
          source: { fromSeq: sourceSeq, toSeq: sourceSeq },
          phases: []
        };
        session.games.push(activeGame);
      } else {
        activeGame.endedAt = ts;
        activeGame.source.toSeq = sourceSeq;
      }
      rememberRawCaptureIdentity(activeGame.roomCodes, details.roomCode);
      rememberRawCaptureIdentity(activeGame.matchIds, details.matchId);
    }

    const exactPhase = details.type === "room_shell_leave" ? "lobby" : details.phase;
    const extendPhase = (phases: RawCapturePhaseSegment[]) => {
      const current = phases.at(-1);
      if (!exactPhase) {
        if (current) {
          current.endedAt = ts;
          current.source.toSeq = sourceSeq;
        }
        return;
      }
      if (current && current.phase === exactPhase && current.gameNumber === (gameNumber ?? null)) {
        current.endedAt = ts;
        current.source.toSeq = sourceSeq;
        if (!current.roomCode && details.roomCode) {
          current.roomCode = details.roomCode;
        }
        return;
      }
      phases.push({
        phase: exactPhase,
        normalizedPhase: normalizeAtlasReplayPhase(exactPhase),
        gameNumber: gameNumber ?? null,
        roomCode: details.roomCode || null,
        startedAt: ts,
        endedAt: ts,
        source: { fromSeq: sourceSeq, toSeq: sourceSeq }
      });
    };
    extendPhase(session.phases);
    if (activeGame) {
      extendPhase(activeGame.phases);
    }

    if (details.type === "room_shell_leave") {
      session.boundaries.push({ at: ts, reason: "end-of-match" });
      session.lastPhase = "lobby";
      return;
    }
    if (details.type !== "room_shell_sync") {
      return;
    }
    if (session.lastPhase === "in_game" && details.phase === "lobby") {
      session.boundaries.push({ at: ts, reason: "end-of-match" });
    }
    if (
      typeof details.gameNumber === "number" &&
      typeof previousGameNumber === "number" &&
      details.gameNumber > previousGameNumber
    ) {
      session.boundaries.push({ at: ts, reason: "game-boundary" });
    }
    if (details.phase) {
      session.lastPhase = details.phase;
    }
  }

  private async saveUploadFailure(
    replay: ReplayRecord,
    error: string,
    uploadStatus: RawCaptureReplayMetadata["uploadStatus"],
    attemptedAt = new Date().toISOString()
  ): Promise<ReplayRecord> {
    return this.saveReplayRawCapture(replay, {
      ...replay.rawCapture!,
      uploadStatus,
      processingStatus: "failed",
      lastUploadAttemptAt: attemptedAt,
      processingUpdatedAt: new Date().toISOString(),
      error: truncateForUi(error, 300)
    });
  }

  private async saveReplayRawCapture(
    replay: ReplayRecord,
    rawCapture: RawCaptureReplayMetadata
  ): Promise<ReplayRecord> {
    const updated = await this.store.updateActiveReplay(replay.id, (current) => ({
      ...current,
      rawCapture: mergeRawCaptureReplayMetadata(current.rawCapture, replay.rawCapture, rawCapture)
    }));
    const saved = updated ?? await this.store.saveReplayIfMatchActive({ ...replay, rawCapture });
    if (!saved) {
      throw new Error("Replay was removed while its Web Replay data was being saved.");
    }
    try {
      await this.replayUpdatedHandler(saved);
    } catch {
      // Renderer delivery is best effort; persisted replay state remains authoritative.
    }
    if (
      !saved.deletedAt &&
      saved.rawCapture?.provider === "riftlite-v2" &&
      saved.rawCapture.uploadStatus === "uploaded" &&
      saved.rawCapture.uploadId
    ) {
      await Promise.resolve(
        this.webReplayPublishedHandler(
          saved.matchId,
          saved.rawCapture.uploadId,
          saved.rawCapture.webReplayAutoUploadAccountUid || ""
        )
      ).catch(() => undefined);
    }
    return saved;
  }

  private async publishManifestWithoutReplay(manifest: PersistedRawCaptureManifest): Promise<void> {
    const localReplayId = manifest.localReplayId || manifest.identity.localReplayId || "";
    const localMatchId = manifest.localMatchId || manifest.identity.localMatchId || "";
    const replayId = manifest.metadata.uploadId || "";
    if (!localMatchId || !replayId || manifest.metadata.uploadStatus !== "uploaded") {
      return;
    }
    if (!await this.hasActiveManifestParent(manifest)) {
      return;
    }
    const replays = await this.store.getReplays();
    const linkedReplay = replays.find((candidate) => (
      (localReplayId && candidate.id === localReplayId) ||
      candidate.matchId === localMatchId
    ));
    if (linkedReplay) {
      await this.saveReplayRawCapture(linkedReplay, manifest.metadata);
      return;
    }
    const match = (await this.store.getMatches()).find((candidate) => candidate.id === localMatchId);
    if (!match || match.deletedAt) {
      return;
    }
    if (!await this.hasActiveManifestParent(manifest)) {
      return;
    }
    await Promise.resolve(this.webReplayPublishedHandler(
      localMatchId,
      replayId,
      manifest.metadata.webReplayAutoUploadAccountUid || ""
    )).catch(() => undefined);
  }

  private async loadReplay(replayId: string): Promise<ReplayRecord | null> {
    const replays = await this.store.getReplays();
    return replays.find((item) => item.id === replayId) ?? null;
  }

  private hasActiveManifestParent(manifest: PersistedRawCaptureManifest): Promise<boolean> {
    const localMatchId = manifest.localMatchId || manifest.identity.localMatchId;
    if (manifest.requiresLocalReplayParent === false && manifest.recoveredFromJournalAt && !localMatchId) {
      // Crash-recovered journals can predate the local match row. Their
      // capture-time account consent remains authoritative, and the upload
      // centre provides the explicit Keep local only removal action.
      return Promise.resolve(true);
    }
    return this.store.hasActiveRawCaptureParent(
      manifest.requiresLocalReplayParent === false
        ? undefined
        : manifest.localReplayId || manifest.identity.localReplayId,
      localMatchId
    );
  }

  private async assertActiveManifestParent(manifest: PersistedRawCaptureManifest): Promise<void> {
    if (!await this.hasActiveManifestParent(manifest)) {
      throw new RawCaptureParentInactiveError();
    }
  }

  private async discordActiveDeckForManifest(
    manifest: PersistedRawCaptureManifest
  ): Promise<RawCaptureDiscordActiveDeck | undefined> {
    const localReplayId = manifest.localReplayId || manifest.identity.localReplayId;
    const replay = localReplayId ? await this.loadReplay(localReplayId) : null;
    let match = replay?.matchSnapshot;
    const localMatchId = manifest.localMatchId || manifest.identity.localMatchId;
    if (!match && localMatchId) {
      const matches = await this.store.getMatches();
      match = matches.find((candidate) => candidate.id === localMatchId);
    }
    return rawCaptureDiscordActiveDeckFromMatch(match);
  }
}

function clonePhaseSegment(segment: RawCapturePhaseSegment): RawCapturePhaseSegment {
  return { ...segment, source: { ...segment.source } };
}

function rawCapturePersistedFinishIdentity(
  identity: RawCaptureFinishIdentity
): RawCaptureFinishIdentity {
  const persisted = { ...identity };
  delete persisted.match;
  return persisted;
}

export function rawCaptureMatchSummaryFromDraft(
  match: ReplayRecord["matchSnapshot"] | undefined
): RawCaptureMatchSummary | undefined {
  if (!match) {
    return undefined;
  }
  const games = (Array.isArray(match.games) ? match.games : [])
    .map((game, index) => {
      const gameNumber = normalizedRawCaptureWholeNumber(game?.gameNumber, 1, 3) ?? index + 1;
      const perspectivePoints = normalizedRawCaptureWholeNumber(game?.myPoints, 0, 99);
      const opponentPoints = normalizedRawCaptureWholeNumber(game?.oppPoints, 0, 99);
      return {
        gameNumber,
        result: rawCaptureMatchResult(game?.result),
        ...(perspectivePoints === undefined ? {} : { perspectivePoints }),
        ...(opponentPoints === undefined ? {} : { opponentPoints })
      };
    })
    .slice(0, 3);
  const format = match.format === "Bo3" || (match.format === "Auto" && games.length > 1) ? "bo3" : "bo1";
  return {
    format,
    result: rawCaptureMatchResult(match.result),
    score: rawCaptureMatchScore(match.score, games, format),
    games
  };
}

export function rawCaptureDiscordActiveDeckFromMatch(
  match: ReplayRecord["matchSnapshot"] | undefined
): RawCaptureDiscordActiveDeck | undefined {
  if (!match?.deckSnapshotJson?.trim()) return undefined;
  const snapshot = parseJsonObject(match.deckSnapshotJson);
  if (!snapshot) return undefined;
  const legendEntry = readObject(snapshot.legend_entry) ?? readObject(snapshot.legendEntry);
  const rawDeckLegend = [snapshot.legend, snapshot.legend_key, snapshot.legendKey, legendEntry?.name]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const capturedLegend = canonicalLegendName(match.myChampion);
  const deckLegend = canonicalLegendName(rawDeckLegend);
  const sourceUrl = rawCaptureVerifiedPiltoverDeckUrl(match.deckSourceUrl);
  if (!capturedLegend || !deckLegend || capturedLegend !== deckLegend || !sourceUrl) return undefined;
  const snapshotTitle = typeof snapshot.title === "string" ? snapshot.title : "";
  const title = (match.deckName || snapshotTitle).replace(/\s+/g, " ").trim().slice(0, 120);
  return {
    ...(title ? { title } : {}),
    legend: deckLegend,
    sourceUrl
  };
}

function rawCaptureVerifiedPiltoverDeckUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > 500) return "";
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !["piltoverarchive.com", "www.piltoverarchive.com"].includes(url.hostname.toLowerCase())
    ) {
      return "";
    }
    const match = PILTOVER_DECK_PATH_RE.exec(url.pathname);
    return match?.[1]
      ? `https://piltoverarchive.com/decks/view/${match[1].toLowerCase()}`
      : "";
  } catch {
    return "";
  }
}

function rawCaptureMatchResult(value: unknown): RawCaptureMatchResult {
  const result = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (result === "win" || result === "loss" || result === "draw") {
    return result;
  }
  return "incomplete";
}

function rawCaptureMatchScore(
  value: unknown,
  games: RawCaptureMatchSummary["games"],
  format: RawCaptureMatchSummary["format"]
): RawCaptureMatchSummary["score"] {
  const maximumWins = format === "bo3" ? 2 : 1;
  const scoreMatch = typeof value === "string"
    ? value.trim().match(/^(\d+)\s*[-:\u2013]\s*(\d+)$/)
    : null;
  const perspective = normalizedRawCaptureWholeNumber(scoreMatch?.[1], 0, maximumWins);
  const opponent = normalizedRawCaptureWholeNumber(scoreMatch?.[2], 0, maximumWins);
  if (perspective !== undefined && opponent !== undefined) {
    return { perspective, opponent };
  }
  return {
    perspective: Math.min(maximumWins, games.filter((game) => game.result === "win").length),
    opponent: Math.min(maximumWins, games.filter((game) => game.result === "loss").length)
  };
}

function normalizedRawCaptureWholeNumber(
  value: unknown,
  minimum: number,
  maximum: number
): number | undefined {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum
    ? number
    : undefined;
}

function shiftPhaseSegment(segment: RawCapturePhaseSegment, offset: number): RawCapturePhaseSegment {
  return {
    ...clonePhaseSegment(segment),
    source: {
      fromSeq: segment.source.fromSeq + offset,
      toSeq: segment.source.toSeq + offset
    }
  };
}

function shiftGameSegment(segment: RawCaptureGameSegment, offset: number): RawCaptureGameSegment {
  return {
    ...segment,
    roomCodes: segment.roomCodes.slice(),
    matchIds: segment.matchIds.slice(),
    source: {
      fromSeq: segment.source.fromSeq + offset,
      toSeq: segment.source.toSeq + offset
    },
    phases: segment.phases.map((phase) => shiftPhaseSegment(phase, offset))
  };
}

function mergeRawCaptureSocket(
  current: RawCaptureSocket | undefined,
  incoming: RawCaptureSocket
): RawCaptureSocket {
  if (!current) {
    return {
      ...incoming,
      close: { ...incoming.close }
    };
  }
  const openedAt = [current.openedAt, incoming.openedAt]
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right)[0] ?? null;
  const closedAt = [current.closedAt, incoming.closedAt]
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => right - left)[0] ?? null;
  return {
    socketId: current.socketId,
    url: incoming.url || current.url,
    openedAt,
    closedAt,
    close: incoming.closedAt !== null ? { ...incoming.close } : { ...current.close }
  };
}

function normalizeAtlasReplayPhase(value: string): string {
  const phase = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (/sideboard/.test(phase)) return "sideboarding";
  if (/mulligan/.test(phase)) return "mulligan";
  if (/battlefield/.test(phase)) return "battlefield";
  if (/initiative|roll/.test(phase)) return "initiative";
  if (/matchup|versus|opponent/.test(phase)) return "matchup";
  if (/result|complete|game_end|finished/.test(phase)) return "game_end";
  if (/in_game|playing|gameplay|active/.test(phase)) return "in_game";
  if (/lobby|room|waiting/.test(phase)) return "lobby";
  if (/setup|pregame|pre_game/.test(phase)) return "setup";
  return phase || "unknown";
}

async function writeRawCaptureManifest(manifest: PersistedRawCaptureManifest): Promise<void> {
  await writeUtf8FileAtomically(manifest.indexPath, JSON.stringify(manifest));
}

function parseRawCaptureJournalEntry(line: string): RawCaptureJournalEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  const object = readObject(parsed);
  const captureSessionId = boundedJournalString(object?.captureSessionId, 128);
  if (
    object?.schema !== "riftlite-active-raw-capture-journal" ||
    object.version !== 1 ||
    !captureSessionId
  ) {
    return null;
  }
  if (object.kind === "checkpoint") {
    const session = readObject(object.session);
    return session ? {
      schema: "riftlite-active-raw-capture-journal",
      version: 1,
      kind: "checkpoint",
      captureSessionId,
      session: session as unknown as ActiveRawCaptureSession
    } : null;
  }
  if (object.kind !== "frame") {
    return null;
  }
  const frame = normalizeRawCaptureJournalFrame(object.frame);
  const consent = readObject(object.consent);
  if (!frame || !consent) {
    return null;
  }
  return {
    schema: "riftlite-active-raw-capture-journal",
    version: 1,
    kind: "frame",
    captureSessionId,
    requestUrl: boundedJournalString(object.requestUrl, 4096),
    frame,
    consent: {
      webReplayAutoUploadAccountUid: boundedJournalString(consent.webReplayAutoUploadAccountUid, 256),
      webReplayDiscordShareAccountUid: boundedJournalString(consent.webReplayDiscordShareAccountUid, 256),
      webReplayDiscordShareHubIds: normalizedJournalStrings(consent.webReplayDiscordShareHubIds, 10, 256),
      provisional: consent.provisional === true
    }
  };
}

function normalizeRawCaptureJournalFrame(value: unknown): RawCaptureFrame | null {
  const object = readObject(value);
  if (
    !object ||
    (object.dir !== "in" && object.dir !== "out") ||
    typeof object.raw !== "string" ||
    Buffer.byteLength(object.raw, "utf8") > 1_500_000 ||
    !Number.isFinite(Number(object.ts)) ||
    Math.abs(Number(object.ts)) > RAW_CAPTURE_MAX_DATE_MS
  ) {
    return null;
  }
  return {
    seq: Number.isFinite(Number(object.seq)) ? Math.max(0, Math.trunc(Number(object.seq))) : 0,
    ts: Number(object.ts),
    dir: object.dir,
    socketId: boundedJournalString(object.socketId, 256) || null,
    type: boundedJournalString(object.type, 256) || null,
    raw: object.raw,
    drop: object.drop === true,
    dropReason: boundedJournalString(object.dropReason, 256) || null
  };
}

function normalizeRecoveredRawCaptureSession(
  value: unknown,
  expectedCaptureSessionId: string
): ActiveRawCaptureSession | null {
  const object = readObject(value);
  const captureSessionId = boundedJournalString(object?.captureSessionId, 128);
  if (!object || object.platform !== "atlas" || captureSessionId !== expectedCaptureSessionId) {
    return null;
  }
  const sourceFrames = Array.isArray(object.frames) ? object.frames.slice(0, RAW_CAPTURE_MAX_MESSAGES) : [];
  const frames: RawCaptureFrame[] = [];
  let byteSize = 0;
  for (const sourceFrame of sourceFrames) {
    const frame = normalizeRawCaptureJournalFrame(sourceFrame);
    if (!frame) return null;
    const frameBytes = Buffer.byteLength(frame.raw, "utf8");
    if (byteSize + frameBytes > RAW_CAPTURE_MAX_BYTES) break;
    frames.push({ ...frame, seq: frames.length });
    byteSize += frameBytes;
  }
  if (!frames.length) {
    return null;
  }
  const firstSeenAt = normalizedJournalTimestamp(object.firstSeenAt, frames[0].ts);
  const lastSeenAt = normalizedJournalTimestamp(object.lastSeenAt, frames.at(-1)?.ts ?? firstSeenAt);
  const sockets: Record<string, RawCaptureSocket> = {};
  for (const [key, candidate] of Object.entries(readObject(object.sockets) ?? {})) {
    const socket = readObject(candidate);
    const socketId = boundedJournalString(socket?.socketId, 256) || boundedJournalString(key, 256);
    if (!socket || !socketId) continue;
    const close = readObject(socket.close);
    sockets[socketId] = {
      socketId,
      url: boundedJournalString(socket.url, 4096),
      openedAt: normalizedNullableJournalTimestamp(socket.openedAt),
      closedAt: normalizedNullableJournalTimestamp(socket.closedAt),
      close: {
        code: Number.isFinite(Number(close?.code)) ? Math.trunc(Number(close?.code)) : null,
        reason: boundedJournalString(close?.reason, 512),
        wasClean: typeof close?.wasClean === "boolean" ? close.wasClean : null
      }
    };
  }
  const phases = normalizedRecoveredPhaseSegments(object.phases);
  const games = normalizedRecoveredGameSegments(object.games);
  const boundaries = (Array.isArray(object.boundaries) ? object.boundaries : [])
    .map((value) => {
      const boundary = readObject(value);
      const reason = boundedJournalString(boundary?.reason, 512);
      return boundary && reason
        ? { at: normalizedJournalTimestamp(boundary.at, firstSeenAt), reason }
        : null;
    })
    .filter((value): value is { at: number; reason: string } => Boolean(value));
  const diagnostics = (Array.isArray(object.diagnostics) ? object.diagnostics : [])
    .slice(-200)
    .map((value): RawCaptureDiagnostic | null => {
      const diagnostic = readObject(value);
      const severity = diagnostic?.severity;
      const code = boundedJournalString(diagnostic?.code, 256);
      const message = boundedJournalString(diagnostic?.message, 1000);
      return diagnostic && (severity === "info" || severity === "warn" || severity === "error") && code && message
        ? {
            ts: normalizedJournalTimestamp(diagnostic.ts, lastSeenAt),
            severity,
            code,
            message,
            context: readObject(diagnostic.context)
          }
        : null;
    })
    .filter((value): value is RawCaptureDiagnostic => value !== null);
  const droppedCount = frames.filter((frame) => frame.drop).length;
  const droppedBytes = frames.reduce((total, frame) => total + (frame.drop ? Buffer.byteLength(frame.raw, "utf8") : 0), 0);
  return {
    captureSessionId,
    platform: "atlas",
    requestUrl: boundedJournalString(object.requestUrl, 4096),
    frames,
    sockets,
    boundaries: boundaries.length ? boundaries : [{ at: firstSeenAt, reason: "session-start" }],
    diagnostics,
    nextSeq: frames.length,
    byteSize,
    capped: object.capped === true || frames.length >= RAW_CAPTURE_MAX_MESSAGES || byteSize >= RAW_CAPTURE_MAX_BYTES,
    firstSeenAt,
    lastSeenAt,
    roomCode: boundedJournalString(object.roomCode, 512),
    roomCodes: normalizedJournalStrings(object.roomCodes, 32, 512),
    seriesId: boundedJournalString(object.seriesId, 512),
    matchId: boundedJournalString(object.matchId, 512),
    matchIds: normalizedJournalStrings(object.matchIds, 64, 512),
    replayId: boundedJournalString(object.replayId, 512),
    replayIds: normalizedJournalStrings(object.replayIds, 64, 512),
    sourceCaptureSessionIds: normalizedJournalStrings(object.sourceCaptureSessionIds, 64, 512),
    matchFormat: boundedJournalString(object.matchFormat, 64),
    webReplayAutoUploadAccountUid: boundedJournalString(object.webReplayAutoUploadAccountUid, 256),
    webReplayDiscordShareAccountUid: boundedJournalString(object.webReplayDiscordShareAccountUid, 256),
    webReplayDiscordShareHubIds: normalizedJournalStrings(object.webReplayDiscordShareHubIds, 10, 256),
    provisional: object.provisional === true,
    continuationSessionId: boundedJournalString(object.continuationSessionId, 128) || undefined,
    lastPhase: boundedJournalString(object.lastPhase, 256),
    lastGameNumber: Number.isFinite(Number(object.lastGameNumber)) ? Math.trunc(Number(object.lastGameNumber)) : undefined,
    phases,
    games,
    keptCount: frames.length - droppedCount,
    droppedCount,
    droppedBytes,
    lastFrameType: boundedJournalString(object.lastFrameType, 256),
    lastError: boundedJournalString(object.lastError, 1000)
  };
}

function normalizedRecoveredPhaseSegments(value: unknown): RawCapturePhaseSegment[] {
  return (Array.isArray(value) ? value : []).slice(-500).map((candidate) => {
    const phase = readObject(candidate);
    const source = readObject(phase?.source);
    if (!phase || !source) return null;
    const exactPhase = boundedJournalString(phase.phase, 256);
    if (!exactPhase) return null;
    return {
      phase: exactPhase,
      normalizedPhase: boundedJournalString(phase.normalizedPhase, 256) || normalizeAtlasReplayPhase(exactPhase),
      gameNumber: Number.isFinite(Number(phase.gameNumber)) ? Math.trunc(Number(phase.gameNumber)) : null,
      roomCode: boundedJournalString(phase.roomCode, 512) || null,
      startedAt: normalizedJournalTimestamp(phase.startedAt, 0),
      endedAt: normalizedJournalTimestamp(phase.endedAt, 0),
      source: {
        fromSeq: Math.max(0, Math.trunc(Number(source.fromSeq) || 0)),
        toSeq: Math.max(0, Math.trunc(Number(source.toSeq) || 0))
      }
    } satisfies RawCapturePhaseSegment;
  }).filter((candidate): candidate is RawCapturePhaseSegment => Boolean(candidate));
}

function normalizedRecoveredGameSegments(value: unknown): RawCaptureGameSegment[] {
  return (Array.isArray(value) ? value : []).slice(-100).map((candidate) => {
    const game = readObject(candidate);
    const source = readObject(game?.source);
    if (!game || !source || !Number.isFinite(Number(game.gameNumber))) return null;
    return {
      gameNumber: Math.trunc(Number(game.gameNumber)),
      startedAt: normalizedJournalTimestamp(game.startedAt, 0),
      endedAt: normalizedJournalTimestamp(game.endedAt, 0),
      roomCodes: normalizedJournalStrings(game.roomCodes, 32, 512),
      matchIds: normalizedJournalStrings(game.matchIds, 64, 512),
      source: {
        fromSeq: Math.max(0, Math.trunc(Number(source.fromSeq) || 0)),
        toSeq: Math.max(0, Math.trunc(Number(source.toSeq) || 0))
      },
      phases: normalizedRecoveredPhaseSegments(game.phases)
    } satisfies RawCaptureGameSegment;
  }).filter((candidate): candidate is RawCaptureGameSegment => Boolean(candidate));
}

function normalizedJournalStrings(value: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => boundedJournalString(item, maxLength)).filter(Boolean))).slice(0, limit);
}

function boundedJournalString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function normalizedJournalTimestamp(value: unknown, fallback: number): number {
  const candidate = Number(value);
  return Number.isFinite(candidate) && Math.abs(candidate) <= RAW_CAPTURE_MAX_DATE_MS ? candidate : fallback;
}

function normalizedNullableJournalTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const candidate = Number(value);
  return Number.isFinite(candidate) && Math.abs(candidate) <= RAW_CAPTURE_MAX_DATE_MS ? candidate : null;
}

async function validatePreparedTcgaCapture(
  compressed: Buffer,
  prepared: PreparedTcgaWebReplayCapture
): Promise<void> {
  if (!compressed.length || compressed.length > RIFTLITE_REPLAY_V2_MAX_GZIP_BYTES) {
    throw new Error(`Prepared TCGA Web Replay exceeds the ${RIFTLITE_REPLAY_V2_MAX_GZIP_BYTES / (1024 * 1024)} MiB upload limit.`);
  }
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = parseJsonObject((await gunzipAsync(compressed, {
      maxOutputLength: RIFTLITE_REPLAY_V2_MAX_EXPANDED_BYTES
    })).toString("utf8"));
  } catch {
    throw new Error("Prepared TCGA Web Replay is not a valid bounded gzip JSON artifact.");
  }
  const capture = readObject(parsed?.capture);
  const identity = readObject(capture?.identity);
  const source = readObject(capture?.source);
  const match = readObject(capture?.match);
  const transport = readObject(parsed?.transport);
  const issueCounts = readObject(transport?.issueCounts);
  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const firstSeenAt = Number(identity?.firstSeenAt);
  const lastSeenAt = Number(identity?.lastSeenAt);
  const transportClean = Number(transport?.incompleteChunkGroups) === 0 &&
    Number(transport?.incompleteChunkCount) === 0 &&
    Object.values(issueCounts ?? {}).every((value) => Number(value) === 0);
  if (
    parsed?.schema !== "riftlite-tcga-raw-capture" ||
    parsed.version !== 1 ||
    capture?.captureSessionId !== prepared.captureSessionId ||
    source?.schema !== "riftlite-tcga-web-replay" ||
    source.version !== 1 ||
    !["win", "loss", "draw"].includes(String(match?.result ?? "")) ||
    !identity?.perspectivePlayerId ||
    firstSeenAt !== prepared.firstSeenAt ||
    lastSeenAt !== prepared.lastSeenAt ||
    messages.length !== prepared.messageCount ||
    !transportClean
  ) {
    throw new Error("Prepared TCGA Web Replay failed its provider integrity checks.");
  }
}

async function writeRawCaptureMatchSummary(
  localPath: string,
  match: RawCaptureMatchSummary
): Promise<void> {
  const payload = parseJsonObject(await readFile(localPath, "utf8"));
  const capture = readObject(payload?.capture);
  if (payload?.schema !== "riftreplay-raw-capture" || !capture) {
    throw new Error("Raw capture payload is invalid.");
  }
  if (JSON.stringify(capture.match) === JSON.stringify(match)) {
    return;
  }
  await writeUtf8FileAtomically(localPath, JSON.stringify({
    ...payload,
    capture: {
      ...capture,
      match
    }
  }));
}

async function writeUtf8FileAtomically(destinationPath: string, contents: string): Promise<void> {
  const temporaryPath = `${destinationPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, contents, "utf8");
  try {
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM") {
      throw error;
    }
    await unlink(destinationPath).catch(() => undefined);
    await rename(temporaryPath, destinationPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function readRawCaptureManifest(indexPath: string): Promise<PersistedRawCaptureManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as unknown;
    const object = readObject(parsed);
    const metadata = readObject(object?.metadata);
    if (
      object?.schema !== "riftlite-raw-capture-index" ||
      object.version !== 1 ||
      (object.platform !== "atlas" && object.platform !== "tcga") ||
      (object.artifactEncoding !== undefined && object.artifactEncoding !== "json" && object.artifactEncoding !== "gzip") ||
      typeof object.localPath !== "string" ||
      typeof object.indexPath !== "string" ||
      typeof metadata?.captureSessionId !== "string"
    ) {
      return null;
    }
    const manifest = parsed as PersistedRawCaptureManifest;
    return {
      ...manifest,
      artifactEncoding: manifest.artifactEncoding ?? "json",
      indexPath,
      metadata: { ...manifest.metadata, localPath: manifest.localPath }
    };
  } catch {
    return null;
  }
}

async function readRawCaptureManifests(settings: UserSettings): Promise<PersistedRawCaptureManifest[]> {
  const directory = await rawCaptureDirectory(settings);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const manifests = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(RAW_CAPTURE_INDEX_SUFFIX))
    .map((entry) => readRawCaptureManifest(join(directory, entry.name))));
  return manifests.filter((manifest): manifest is PersistedRawCaptureManifest => (
    manifest !== null && pathInsideDirectory(manifest.localPath, directory)
  ));
}

function pathInsideDirectory(childPath: string, rootPath: string): boolean {
  const pathBetween = relative(resolve(rootPath), resolve(childPath));
  return pathBetween === "" || Boolean(pathBetween && !pathBetween.startsWith("..") && !isAbsolute(pathBetween));
}

function rawCaptureSourcePathKey(value: string | undefined): string {
  const sourcePath = typeof value === "string" ? value.trim() : "";
  if (!sourcePath) return "";
  const normalized = resolve(sourcePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function hasLinkedRiftLiteReplayAccount(settings: UserSettings): boolean {
  return hasVerifiedRiftLiteAccount(settings);
}

async function withReplayDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
  onTimeout?: () => void
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    timeout.unref?.();
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function fetchWithReplayDeadline(
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
  label: string
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) {
    abortFromUpstream();
  } else {
    upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  }
  try {
    return await withReplayDeadline(
      fetch(endpoint, { ...init, signal: controller.signal }),
      timeoutMs,
      label,
      () => controller.abort()
    );
  } finally {
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

function readReplayResponseText(response: Response, label: string): Promise<string> {
  return withReplayDeadline(response.text(), RIFTLITE_REPLAY_REQUEST_TIMEOUT_MS, `${label} response`);
}

async function firebaseIdTokenFromSettings(store: RiftLiteStore, expectedAccountUid: string): Promise<string> {
  const settings = await store.getSettings();
  if (!hasLinkedRiftLiteReplayAccount(settings)) {
    throw new Error("Link your RiftLite account before uploading to RiftLite Web Replay.");
  }
  if (!riftLiteAccountUidEquals(settings.accountUid, expectedAccountUid)) {
    throw new Error("The linked RiftLite account changed during replay authentication.");
  }
  const response = await fetchWithReplayDeadline(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: settings.firebaseRefreshToken })
  }, RIFTLITE_REPLAY_AUTH_TIMEOUT_MS, "RiftLite account token refresh");
  const text = await readReplayResponseText(response, "RiftLite account token refresh");
  const payload = parseJsonObject(text);
  if (!response.ok) {
    throw new Error(`Could not refresh RiftLite account token: ${truncateForUi(text || response.statusText, 220)}`);
  }
  const idToken = readStringDeep(payload, ["id_token", "idToken"]);
  const uid = readStringDeep(payload, ["user_id", "userId", "localId"]);
  if (!idToken || !uid || !riftLiteAccountUidEquals(uid, settings.accountUid)) {
    throw new Error("Could not refresh RiftLite account token.");
  }
  return idToken;
}

async function postLegacyRiftReplayWithRetry(endpoint: string, apiKey: string, body: Buffer): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchWithReplayDeadline(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Encoding": "gzip"
        },
        body: body as unknown as BodyInit
      }, RIFTLITE_REPLAY_UPLOAD_REQUEST_TIMEOUT_MS, "RiftReplay upload");
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await delay(700 * attempt);
      }
    }
  }
  throw new Error(`RiftReplay network error after 3 attempts: ${describeFetchError(lastError)}`);
}

async function fetchRiftLiteReplayV2WithRetry(
  endpoint: string,
  init: RequestInit,
  beforeAttempt?: () => Promise<void>
): Promise<Response> {
  let lastError: unknown;
  const trustedEndpoint = riftLiteReplayV2Endpoint(endpoint);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let retryDelayMs = 250 * attempt;
    await beforeAttempt?.();
    try {
      const requestTimeoutMs = init.method === "PUT"
        ? RIFTLITE_REPLAY_UPLOAD_REQUEST_TIMEOUT_MS
        : RIFTLITE_REPLAY_REQUEST_TIMEOUT_MS;
      const response = await fetchWithReplayDeadline(
        trustedEndpoint,
        { ...init, redirect: "error" },
        requestTimeoutMs,
        "RiftLite replay request"
      );
      if (response.redirected) {
        throw new Error("RiftLite replay API unexpectedly redirected the request.");
      }
      if (response.url && new URL(response.url).origin !== RIFTLITE_REPLAY_ORIGIN) {
        throw new Error("RiftLite replay API returned a response from an untrusted origin.");
      }
      if (!isRetryableReplayV2Status(response.status) || attempt === 3) {
        return response;
      }
      retryDelayMs = replayRetryAfterMs(response) ?? retryDelayMs;
      await withReplayDeadline(
        response.arrayBuffer(),
        RIFTLITE_REPLAY_REQUEST_TIMEOUT_MS,
        "RiftLite replay retry response"
      ).catch(() => undefined);
    } catch (error) {
      lastError = error;
      if (attempt === 3) {
        break;
      }
    }
    // Long server backoffs belong in durable nextRetryAt metadata. Holding the
    // shared desktop queue here would block every replay and a foreground Retry.
    await delay(Math.min(RIFTLITE_REPLAY_MAX_IN_CALL_RETRY_DELAY_MS, Math.max(0, retryDelayMs)));
  }
  throw new Error(`RiftLite replay network error after 3 attempts: ${describeFetchError(lastError)}`);
}

async function updateRiftLiteReplayV2Visibility(
  replayId: string,
  visibility: RawCaptureVisibility,
  idToken: string,
  beforeAttempt?: () => Promise<void>
): Promise<RawCaptureVisibility> {
  const endpoint = riftLiteReplayV2Endpoint(`/api/v2/replays/${encodeURIComponent(replayId)}`);
  const response = await fetchRiftLiteReplayV2WithRetry(endpoint, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ visibility })
  }, beforeAttempt);
  const text = await readReplayResponseText(response, "RiftLite replay visibility update");
  const body = parseJsonObject(text);
  if (!response.ok) {
    throw replayV2ApiError("visibility update", response, body, text);
  }
  const confirmed = rawCaptureVisibilityFromValue(readObject(body?.replay)?.visibility);
  if (confirmed !== visibility) {
    throw new Error("RiftLite replay visibility update was not confirmed by the server.");
  }
  return confirmed;
}

function isRetryableReplayV2Status(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function replayRetryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function riftLiteReplayV2Endpoint(value: string): string {
  if (!value) {
    throw new Error("RiftLite replay API did not return a required endpoint.");
  }
  const url = new URL(value, RIFTLITE_REPLAY_ORIGIN);
  if (url.origin !== RIFTLITE_REPLAY_ORIGIN) {
    throw new Error("RiftLite replay API returned an untrusted upload origin.");
  }
  return url.toString();
}

function riftLiteReplayPlayerUrl(playerPath: string, replayId: string): string {
  const fallback = `/replays/${encodeURIComponent(replayId)}`;
  const url = new URL(playerPath || fallback, RIFTLITE_REPLAY_ORIGIN);
  if (url.origin !== RIFTLITE_REPLAY_ORIGIN || !url.pathname.startsWith("/replays/")) {
    return new URL(fallback, RIFTLITE_REPLAY_ORIGIN).toString();
  }
  return url.toString();
}

function isRiftLiteReplayV2Url(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.origin === RIFTLITE_REPLAY_ORIGIN && url.pathname.startsWith("/replays/");
  } catch {
    return false;
  }
}

function riftLiteReplayStatusEndpoint(value: string | undefined, replayId: string): string {
  const fallback = `/api/v2/replays/${encodeURIComponent(replayId)}/status`;
  const endpoint = riftLiteReplayV2Endpoint(value || fallback);
  const url = new URL(endpoint);
  if (
    url.origin !== RIFTLITE_REPLAY_ORIGIN ||
    url.username ||
    url.password ||
    url.pathname !== fallback ||
    url.search ||
    url.hash
  ) {
    throw new Error("RiftLite replay API returned an untrusted status endpoint.");
  }
  return url.toString();
}

function readReplayWarnings(value: unknown): string[] {
  const object = readObject(value);
  const replay = readObject(object?.replay);
  const candidates = [object?.warnings, replay?.warnings, object?.partialWarnings, replay?.partialWarnings];
  const warnings: string[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const warning of candidate) {
      const text = typeof warning === "string"
        ? warning.trim()
        : readStringDeep(warning, ["message", "detail", "code"]);
      if (text && !warnings.includes(text)) warnings.push(truncateForUi(text, 300));
    }
  }
  return warnings.slice(0, 12);
}

function readReplayRemoteStatus(
  body: Record<string, unknown> | null,
  replayId: string,
  fallbackStatusEndpoint: string
): ReplayRemoteStatus {
  const replay = readObject(body?.replay) ?? body;
  const failure = readObject(replay?.failure) ?? readObject(body?.failure) ?? readObject(body?.error);
  const rawStatus = String(replay?.status ?? body?.status ?? "").trim().toLowerCase();
  const rawStage = String(replay?.stage ?? body?.stage ?? "").trim().toLowerCase();
  const rawAction = String(
    failure?.recommendedAction ?? replay?.recommendedAction ?? body?.recommendedAction ?? ""
  ).trim().toLowerCase();
  let processingStatus = normalizeRawCaptureProcessingStatus(rawStatus);
  if (/upload|source/.test(rawStage) || rawAction === "upload-source") {
    processingStatus = "uploading";
  } else if (/process|complete/.test(rawStage) && processingStatus === "pending") {
    processingStatus = "processing";
  }
  const failureCode = readStringDeep(failure, ["code"])
    || readStringDeep(body, ["errorCode", "failureCode"]);
  const failureMessage = readStringDeep(failure, ["message", "detail"])
    || (typeof body?.error === "string" ? body.error.trim() : "");
  const suppliedClass = readStringDeep(failure, ["errorClass", "class"])
    || readStringDeep(body, ["errorClass"]);
  const failureClass = failureMessage || failureCode
    ? normalizeReplayDeliveryErrorClass(suppliedClass) || (
      ["replay_processing", "processing_superseded"].includes(failureCode)
        ? "server"
        : replayDeliveryErrorClass(0, failureCode, failureMessage)
    )
    : undefined;
  const retryableValue = failure?.retryable ?? replay?.retryable ?? body?.retryable;
  const retryable = typeof retryableValue === "boolean"
    ? retryableValue
    : processingStatus === "processing" || processingStatus === "uploading" || (
      processingStatus === "failed" && replayDeliveryErrorRetryable(422, failureClass || "unknown", failureCode)
    );
  const recommendedAction = normalizeReplayRecommendedAction(rawAction)
    || (processingStatus === "ready"
      ? "open-replay"
      : processingStatus === "processing" || processingStatus === "uploading"
        ? "wait"
        : replayDeliveryRecommendedAction(failureClass || "unknown", failureCode, retryable));
  const retryAfterValue = Number(failure?.retryAfterMs ?? replay?.retryAfterMs ?? body?.retryAfterMs);
  const retryAfterMs = Number.isFinite(retryAfterValue) && retryAfterValue >= 0
    ? retryAfterValue
    : undefined;
  const statusEndpointValue = readStringDeep(body, ["statusEndpoint"]);
  const visibility = rawCaptureVisibilityFromValue(replay?.visibility);
  const retryProcessing = rawAction === "retry-processing" || /processing-required/.test(rawStage);
  const deliveryStage: WebReplayDeliveryStage = processingStatus === "ready"
    ? "ready"
    : retryProcessing
      ? "completing"
    : processingStatus === "failed"
      ? retryable ? "paused" : "failed"
      : processingStatus === "uploading"
        ? "uploading"
        : "processing";
  return {
    processingStatus,
    deliveryStage,
    retryable,
    recommendedAction,
    retryAfterMs,
    statusEndpoint: riftLiteReplayStatusEndpoint(statusEndpointValue || fallbackStatusEndpoint, replayId),
    playerPath: readStringDeep(body, ["playerPath"]),
    visibility: visibility ?? undefined,
    failureMessage: failureMessage || undefined,
    failureCode: failureCode || undefined,
    failureClass,
    warnings: readReplayWarnings(body)
  };
}

function normalizeRawCaptureProcessingStatus(value: string): RawCaptureProcessingStatus {
  const status = value.trim().toLowerCase();
  if (status === "ready") return "ready";
  if (status === "failed" || status === "error") return "failed";
  if (status === "processing") return "processing";
  if (status === "uploading" || status === "upload-required") return "uploading";
  return "pending";
}

function replayV2ApiError(
  operation: string,
  response: Response,
  body: Record<string, unknown> | null,
  rawText: string
): ReplayDeliveryError {
  const errorObject = readObject(body?.error);
  const message = readStringDeep(errorObject, ["message"])
    || (typeof body?.error === "string" ? body.error.trim() : "")
    || readStringDeep(body, ["message"])
    || rawText
    || response.statusText;
  const code = readStringDeep(errorObject, ["code"]) || readStringDeep(body, ["code"]);
  const suppliedClass = readStringDeep(errorObject, ["errorClass"]) || readStringDeep(body, ["errorClass"]);
  const errorClass = normalizeReplayDeliveryErrorClass(suppliedClass) || replayDeliveryErrorClass(response.status, code, message);
  const retryableValue = errorObject?.retryable ?? body?.retryable;
  const retryable = typeof retryableValue === "boolean"
    ? retryableValue
    : replayDeliveryErrorRetryable(response.status, errorClass, code);
  const recommendedAction = normalizeReplayRecommendedAction(
    readStringDeep(errorObject, ["recommendedAction"]) || readStringDeep(body, ["recommendedAction"])
  ) || replayDeliveryRecommendedAction(errorClass, code, retryable);
  const suppliedRetryAfterMs = Number(errorObject?.retryAfterMs ?? body?.retryAfterMs);
  const retryAfterMs = Number.isFinite(suppliedRetryAfterMs) && suppliedRetryAfterMs >= 0
    ? suppliedRetryAfterMs
    : replayRetryAfterMs(response);
  const actionableMessage = response.status === 401 && code === "authentication_required"
    ? "Your linked RiftLite account was not accepted. Open Account, finish verification or reconnect the same account, then retry. The local replay capture is safe."
    : message;
  return Object.assign(
    new Error(`RiftLite replay ${operation} ${response.status}: ${truncateForUi(actionableMessage, 260)}`),
    {
      status: response.status,
      code: code || undefined,
      errorClass,
      retryable,
      recommendedAction,
      retryAfterMs
    }
  );
}

function normalizeReplayDeliveryErrorClass(value: unknown): WebReplayDeliveryErrorClass | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["network", "authentication", "server", "capture", "validation", "storage", "unknown"].includes(normalized)) {
    return normalized as WebReplayDeliveryErrorClass;
  }
  if (["processing", "service", "upload", "rate-limit", "rate_limit"].includes(normalized)) return "server";
  if (["auth", "permission", "account"].includes(normalized)) return "authentication";
  if (["source", "incomplete", "replay-capture"].includes(normalized)) return "capture";
  if (["request", "schema", "input"].includes(normalized)) return "validation";
  return undefined;
}

function normalizeReplayRecommendedAction(value: unknown): WebReplayRecommendedAction | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if ([
    "none", "wait", "retry", "link-account", "verify-account", "reconnect-account",
    "upload-incomplete", "remove-from-queue", "open-replay"
  ].includes(normalized)) return normalized as WebReplayRecommendedAction;
  if (["retry-processing", "retry-later", "upload-source"].includes(normalized)) return "retry";
  if (normalized === "check-permission") return "verify-account";
  if (normalized === "contact-support") return "none";
  return undefined;
}

function replayDeliveryFailureDetails(error: unknown): {
  message: string;
  status?: number;
  code?: string;
  errorClass: WebReplayDeliveryErrorClass;
  retryable: boolean;
  recommendedAction: WebReplayRecommendedAction;
  retryAfterMs?: number;
} {
  const candidate = error instanceof Error ? error as ReplayDeliveryError : null;
  const message = candidate?.message || String(error || "RiftLite replay upload failed.");
  const parsedStatus = Number(message.match(/RiftLite replay \S+(?: \S+)* (\d{3}):/i)?.[1]);
  const status = Number.isFinite(candidate?.status) ? candidate?.status
    : Number.isFinite(parsedStatus) ? parsedStatus : undefined;
  const code = candidate?.code;
  const errorClass = candidate?.errorClass || (
    /timed out|network error|fetch failed|econn|enotfound|dns/i.test(message)
      ? "network"
      : /auth|account|token|sign.?in|reconnect/i.test(message)
        ? "authentication"
        : /capture|mulligan|gameplay/i.test(message)
          ? "capture"
          : /enoent|file|directory|storage/i.test(message)
            ? "storage"
            : status
              ? replayDeliveryErrorClass(status, code || "", message)
              : "unknown"
  );
  const retryable = typeof candidate?.retryable === "boolean"
    ? candidate.retryable
    : status
      ? replayDeliveryErrorRetryable(status, errorClass, code || "")
      : errorClass === "network" || errorClass === "authentication" || errorClass === "server" || errorClass === "unknown";
  const recommendedAction = candidate?.recommendedAction || replayDeliveryRecommendedAction(errorClass, code || "", retryable);
  return {
    message,
    status,
    code,
    errorClass,
    retryable,
    recommendedAction,
    retryAfterMs: candidate?.retryAfterMs
  };
}

function replayDeliveryErrorClass(status: number, code: string, message: string): WebReplayDeliveryErrorClass {
  if (status === 401 || /auth|account|token/i.test(`${code} ${message}`)) return "authentication";
  if (status === 422 || /capture|mulligan|gameplay/i.test(`${code} ${message}`)) return "capture";
  if (status >= 500 || status === 425 || status === 429) return "server";
  if (status >= 400) return "validation";
  return "unknown";
}

function replayDeliveryErrorRetryable(
  status: number,
  errorClass: WebReplayDeliveryErrorClass,
  code: string
): boolean {
  if ([408, 425, 429].includes(status) || status >= 500) return true;
  if (["replay_processing", "processing_superseded"].includes(code)) return true;
  return errorClass === "network" || errorClass === "authentication" || errorClass === "server";
}

function replayDeliveryRecommendedAction(
  errorClass: WebReplayDeliveryErrorClass,
  code: string,
  retryable: boolean
): WebReplayRecommendedAction {
  if (code === "replay_capture_missing_mulligan") return "upload-incomplete";
  if (errorClass === "authentication") return "reconnect-account";
  return retryable ? "retry" : "remove-from-queue";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      return `${error.message} (${cause.message})`;
    }
    return error.message;
  }
  return "fetch failed";
}

function shouldKeepRawFrame(raw: string, type: string): boolean {
  if (!raw || raw.length > 1_500_000) {
    return false;
  }
  return Boolean(type);
}

type RawCaptureFrameDetails = {
  captureSessionId: string;
  roomCode: string;
  previousRoomCode: string;
  seriesId: string;
  matchId: string;
  replayId: string;
  phase: string;
  gameNumber?: number;
  matchFormat: string;
  type: string;
};

function extractRawCaptureDetails(raw: string): RawCaptureFrameDetails {
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return {
      captureSessionId: "",
      roomCode: "",
      previousRoomCode: "",
      seriesId: "",
      matchId: "",
      replayId: "",
      phase: "",
      matchFormat: "",
      type: ""
    };
  }
  const sessionDoc = readObject(parsed.sessionDoc) ?? readObject(parsed.payload)?.sessionDoc ?? parsed;
  return {
    type: typeof parsed.type === "string" ? parsed.type : "",
    captureSessionId: readStringDeep(sessionDoc, ["captureSessionId", "capture_session_id"]),
    roomCode: readStringDeep(parsed, ["roomCode", "room_code", "gameInstanceId"]) || readStringDeep(sessionDoc, ["roomCode", "room_code", "gameInstanceId"]),
    previousRoomCode: readStringDeep(sessionDoc, ["previousRoomCode", "previous_room_code", "previousGameInstanceId"]),
    seriesId: readStringDeep(sessionDoc, ["seriesId", "series_id", "matchSeriesId"]),
    matchId: readStringDeep(sessionDoc, ["matchId", "match_id"]),
    replayId: readStringDeep(sessionDoc, ["replayId", "replay_id"]),
    phase: readStringDeep(sessionDoc, ["phase", "state", "status"]),
    matchFormat: readStringDeep(sessionDoc, ["matchFormat", "format", "queueType", "queue"]),
    gameNumber: readNumberDeep(sessionDoc, ["gameNumber", "game_number", "game"])
  };
}

function isAuthoritativeRawCaptureFrame(details: RawCaptureFrameDetails): boolean {
  return details.type === "room_shell_sync" || Boolean(
    details.seriesId || details.matchId || details.replayId || details.captureSessionId
  );
}

function canMergeProvisionalRawCaptureSession(
  target: ActiveRawCaptureSession,
  provisional: ActiveRawCaptureSession,
  details: RawCaptureFrameDetails
): boolean {
  if (!provisional.provisional || provisional.captureSessionId === target.captureSessionId) {
    return false;
  }
  if (
    normalizeRiftLiteAccountUid(target.webReplayAutoUploadAccountUid) !==
    normalizeRiftLiteAccountUid(provisional.webReplayAutoUploadAccountUid)
  ) {
    return false;
  }
  if (
    normalizeRiftLiteAccountUid(target.webReplayDiscordShareAccountUid) !==
      normalizeRiftLiteAccountUid(provisional.webReplayDiscordShareAccountUid) ||
    !sameStringSet(target.webReplayDiscordShareHubIds, provisional.webReplayDiscordShareHubIds)
  ) {
    return false;
  }
  if (
    details.seriesId &&
    target.seriesId &&
    identityEquals(details.seriesId, target.seriesId)
  ) {
    return true;
  }
  if (
    details.previousRoomCode &&
    (
      identityEquals(details.previousRoomCode, target.roomCode) ||
      target.roomCodes.some((roomCode) => identityEquals(roomCode, details.previousRoomCode))
    )
  ) {
    return true;
  }
  if (
    details.matchId &&
    [target.matchId, ...target.matchIds].some((matchId) => identityEquals(matchId, details.matchId))
  ) {
    return true;
  }
  if (
    details.replayId &&
    [target.replayId, ...target.replayIds].some((replayId) => identityEquals(replayId, details.replayId))
  ) {
    return true;
  }
  return Boolean(
    details.type === "room_shell_sync" &&
    typeof details.gameNumber === "number" &&
    details.gameNumber > 1 &&
    /bo3|best.?of.?3/i.test(details.matchFormat || provisional.matchFormat) &&
    /bo3|best.?of.?3/i.test(target.matchFormat) &&
    (
      typeof target.lastGameNumber !== "number" ||
      details.gameNumber > target.lastGameNumber
    )
  );
}

function isSameAtlasRawCaptureSession(session: ActiveRawCaptureSession, details: RawCaptureFrameDetails): boolean {
  if (
    details.captureSessionId &&
    (
      identityEquals(details.captureSessionId, session.captureSessionId) ||
      session.sourceCaptureSessionIds.some((id) => identityEquals(id, details.captureSessionId))
    )
  ) {
    return true;
  }
  if (details.seriesId && session.seriesId && identityEquals(details.seriesId, session.seriesId)) {
    return true;
  }
  if (
    details.matchId &&
    [session.matchId, ...session.matchIds].some((matchId) => identityEquals(details.matchId, matchId))
  ) {
    return true;
  }
  if (
    details.replayId &&
    [session.replayId, ...session.replayIds].some((replayId) => identityEquals(details.replayId, replayId))
  ) {
    return true;
  }
  if (
    details.previousRoomCode &&
    (
      identityEquals(details.previousRoomCode, session.roomCode) ||
      session.roomCodes.some((roomCode) => identityEquals(roomCode, details.previousRoomCode))
    )
  ) {
    return true;
  }
  const looksLikeBo3Continuation = /bo3|best.?of.?3/i.test(details.matchFormat)
    || (typeof details.gameNumber === "number" && details.gameNumber > 1)
    || session.roomCodes.length > 1;
  return Boolean(
    looksLikeBo3Continuation &&
    details.seriesId &&
    (!session.seriesId || identityEquals(details.seriesId, session.seriesId))
  );
}

function hasRawCaptureIdentityConflict(
  session: ActiveRawCaptureSession,
  details: RawCaptureFrameDetails
): boolean {
  if (details.seriesId && session.seriesId && !identityEquals(details.seriesId, session.seriesId)) {
    return true;
  }
  // Atlas allocates per-game match/room/capture IDs inside a BO3. Once both sides
  // agree on the series ID, that series identity is authoritative.
  if (details.seriesId && session.seriesId && identityEquals(details.seriesId, session.seriesId)) {
    return false;
  }
  if (
    details.matchId &&
    session.matchIds.length &&
    !session.matchIds.some((matchId) => identityEquals(details.matchId, matchId))
  ) {
    return true;
  }
  if (
    details.replayId &&
    session.replayIds.length &&
    !session.replayIds.some((replayId) => identityEquals(details.replayId, replayId))
  ) {
    return true;
  }
  if (
    details.captureSessionId &&
    session.sourceCaptureSessionIds.length &&
    !session.sourceCaptureSessionIds.some((id) => identityEquals(id, details.captureSessionId))
  ) {
    return true;
  }
  if (
    details.roomCode &&
    session.roomCode &&
    !identityEquals(details.roomCode, session.roomCode) &&
    !session.roomCodes.some((roomCode) => identityEquals(roomCode, details.roomCode)) &&
    !isSameAtlasRawCaptureSession(session, details)
  ) {
    return true;
  }
  return false;
}

function rememberRoomCode(session: ActiveRawCaptureSession, roomCode: string): void {
  if (!roomCode || session.roomCodes.some((knownRoomCode) => identityEquals(knownRoomCode, roomCode))) {
    return;
  }
  session.roomCodes.push(roomCode);
}

function rememberRawCaptureIdentity(values: string[], value: string): void {
  if (!value || values.some((knownValue) => identityEquals(knownValue, value))) {
    return;
  }
  values.push(value);
}

function rawCaptureUploadEnabled(settings: UserSettings): boolean {
  return settings.rawCapture.enabled === true &&
    (settings.rawCapture as RawCaptureRuntimeSettings).uploadEnabled === true;
}

function riftLiteWebReplayAutoUploadEnabled(settings: UserSettings): boolean {
  return Boolean(riftLiteWebReplayAutoUploadAccountUid(settings));
}

function riftLiteWebReplayAutoUploadAccountUid(settings: UserSettings): string {
  return riftLiteWebReplayConsentedAccountUid(settings, "atlas");
}

function riftLiteWebReplayConsentedAccountUid(
  settings: UserSettings,
  platform: "atlas" | "tcga"
): string {
  const captureAccountUid = riftLiteWebReplayCaptureAccountUid(settings, platform);
  return captureAccountUid &&
    Boolean(String(settings.firebaseRefreshToken ?? "").trim()) &&
    Boolean(String(settings.accountLastVerifiedAt ?? "").trim())
    ? captureAccountUid
    : "";
}

function riftLiteWebReplayCaptureAccountUid(
  settings: UserSettings,
  platform: "atlas" | "tcga"
): string {
  const enabled = platform === "tcga"
    ? settings.rawCapture.tcgaWebReplayAutoUploadEnabled === true
    : settings.rawCapture.webReplayAutoUploadEnabled === true;
  const consentUid = normalizeRiftLiteAccountUid(settings.rawCapture.webReplayAutoUploadAccountUid);
  const platformConsentUid = normalizeRiftLiteAccountUid(platform === "tcga"
    ? settings.rawCapture.tcgaWebReplayAutoUploadAccountUid
    : consentUid);
  const accountUid = normalizeRiftLiteAccountUid(settings.accountUid);
  return settings.rawCapture.enabled === true &&
    enabled &&
    Boolean(platformConsentUid) &&
    platformConsentUid === accountUid
    ? platformConsentUid
    : "";
}

export function riftLiteTcgaWebReplayCaptureAccountUid(settings: UserSettings): string {
  return riftLiteWebReplayCaptureAccountUid(settings, "tcga");
}

export function riftLiteTcgaWebReplayAutoUploadAccountUid(settings: UserSettings): string {
  return riftLiteWebReplayConsentedAccountUid(settings, "tcga");
}

function rawCaptureWebReplayAutoUploadEligible(
  metadata: RawCaptureReplayMetadata,
  settings: UserSettings
): boolean {
  const currentAccountUid = riftLiteWebReplayAutoUploadAccountUid(settings);
  return metadata.webReplayAutoUploadEligible === true &&
    Boolean(metadata.webReplayAutoUploadAccountUid) &&
    riftLiteAccountUidEquals(metadata.webReplayAutoUploadAccountUid, currentAccountUid);
}

function rawCaptureWebReplayAutoUploadEligibleForPlatform(
  platform: GamePlatform,
  metadata: RawCaptureReplayMetadata,
  settings: UserSettings
): boolean {
  const currentAccountUid = platform === "tcga"
    ? riftLiteTcgaWebReplayAutoUploadAccountUid(settings)
    : platform === "atlas"
      ? riftLiteWebReplayAutoUploadAccountUid(settings)
      : "";
  return metadata.webReplayAutoUploadEligible === true &&
    Boolean(metadata.webReplayAutoUploadAccountUid) &&
    riftLiteAccountUidEquals(metadata.webReplayAutoUploadAccountUid, currentAccountUid);
}

function riftLiteWebReplayDiscordShareHubIds(settings: UserSettings): string[] {
  const currentAccountUid = normalizeRiftLiteAccountUid(settings.accountUid);
  const atlasAccountUid = riftLiteWebReplayAutoUploadAccountUid(settings);
  const tcgaAccountUid = riftLiteTcgaWebReplayAutoUploadAccountUid(settings);
  const accountUid = [atlasAccountUid, tcgaAccountUid]
    .find((uid) => riftLiteAccountUidEquals(uid, currentAccountUid)) || "";
  const consentUid = normalizeRiftLiteAccountUid(settings.rawCapture.webReplayDiscordShareAccountUid);
  if (
    settings.rawCapture.webReplayDiscordShareEnabled !== true ||
    !accountUid ||
    consentUid !== accountUid
  ) {
    return [];
  }
  const activeHubIds = new Set((settings.activeHubs ?? []).map((hub) => hub.id));
  return Array.from(new Set(settings.rawCapture.webReplayDiscordShareHubIds.map((hubId) => String(hubId ?? "").trim())))
    .filter((hubId) => hubId && activeHubIds.has(hubId))
    .slice(0, 10)
    .sort();
}

function rawCaptureDiscordShareEligible(
  metadata: RawCaptureReplayMetadata,
  settings: UserSettings
): boolean {
  const currentHubIds = riftLiteWebReplayDiscordShareHubIds(settings);
  const intendedHubIds = metadata.webReplayDiscordShareHubIds ?? [];
  return metadata.webReplayDiscordShareEligible === true &&
    riftLiteAccountUidEquals(metadata.webReplayDiscordShareAccountUid, settings.accountUid) &&
    intendedHubIds.length > 0 &&
    intendedHubIds.every((hubId) => currentHubIds.includes(hubId));
}

function rawCaptureDiscordShareNeedsRetry(
  metadata: RawCaptureReplayMetadata,
  settings: UserSettings
): boolean {
  return rawCaptureDiscordShareEligible(metadata, settings) && metadata.discordShareStatus !== "shared";
}

function rawCaptureAutomaticTargetVisibility(
  metadata: RawCaptureReplayMetadata,
  settings: UserSettings
): RawCaptureVisibility {
  return rawCaptureDiscordShareEligible(metadata, settings)
    ? "unlisted"
    : normalizeRawCaptureVisibility(settings.rawCapture.visibility);
}

function rawCaptureReadyVisibilityNeedsReconciliation(
  metadata: RawCaptureReplayMetadata,
  settings: UserSettings
): boolean {
  return metadata.provider === "riftlite-v2" &&
    metadata.processingStatus === "ready" &&
    Boolean(metadata.uploadId) &&
    normalizeRawCaptureVisibility(metadata.visibility) !== rawCaptureAutomaticTargetVisibility(metadata, settings);
}

function normalizeRiftLiteAccountUid(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function riftLiteAccountUidEquals(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeRiftLiteAccountUid(left);
  const normalizedRight = normalizeRiftLiteAccountUid(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function rawCaptureVisibility(settings: UserSettings): RawCaptureVisibility {
  return riftLiteWebReplayDiscordShareHubIds(settings).length
    ? "unlisted"
    : normalizeRawCaptureVisibility(settings.rawCapture.visibility);
}

function sameStringSet(left: string[], right: string[]): boolean {
  const normalize = (values: string[]) => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function intersectStringSets(left: string[], right: string[]): string[] {
  const rightValues = new Set(right.map((value) => value.trim()).filter(Boolean));
  return Array.from(new Set(left.map((value) => value.trim()).filter((value) => value && rightValues.has(value)))).sort();
}

function normalizeRawCaptureVisibility(value: unknown): RawCaptureVisibility {
  return value === "public" || value === "unlisted" ? value : "private";
}

function rawCaptureVisibilityFromValue(value: unknown): RawCaptureVisibility | null {
  return value === "private" || value === "public" || value === "unlisted" ? value : null;
}

function uniqueRawCaptureSession(
  sessions: ActiveRawCaptureSession[]
): ActiveRawCaptureSession | null {
  return sessions.length === 1 ? sessions[0] : null;
}

function rawCaptureFinishHasRemoteIdentity(
  identity: RawCaptureFinishIdentity,
  replay?: ReplayRecord
): boolean {
  if (
    identity.captureSessionId ||
    identity.roomCode ||
    identity.roomCodes?.length ||
    identity.seriesId ||
    identity.matchId ||
    identity.matchIds?.length ||
    identity.replayId ||
    identity.replayIds?.length
  ) {
    return true;
  }
  if (!replay) {
    return false;
  }
  return collectStringValuesDeep([replay.events, replay.matchSnapshot], [
    "captureSessionId",
    "capture_session_id",
    "roomCode",
    "room_code",
    "gameInstanceId",
    "previousRoomCode",
    "previous_room_code",
    "previousGameInstanceId",
    "seriesId",
    "series_id",
    "matchSeriesId",
    "matchId",
    "match_id",
    "replayId",
    "replay_id"
  ]).length > 0;
}

function rawCaptureTemporalWindow(
  identity: RawCaptureFinishIdentity,
  replay?: ReplayRecord
): RawCaptureTemporalWindow | null {
  const startedAt = rawCaptureTimestamp(identity.capturedAt || replay?.capturedAt);
  const completedAt = rawCaptureTimestamp(
    identity.completedAt || (replay ? latestReplayEventTimestamp(replay) : undefined)
  );
  if (
    startedAt === null ||
    completedAt === null ||
    completedAt < startedAt ||
    completedAt - startedAt > RAW_CAPTURE_TEMPORAL_MAX_MATCH_MS
  ) {
    return null;
  }
  return { startedAt, completedAt };
}

function rawCaptureSessionFitsTemporalWindow(
  session: ActiveRawCaptureSession,
  window: RawCaptureTemporalWindow
): boolean {
  return session.frames.length > 0 &&
    Number.isFinite(session.firstSeenAt) &&
    Number.isFinite(session.lastSeenAt) &&
    session.firstSeenAt >= window.startedAt - RAW_CAPTURE_TEMPORAL_MAX_PRELUDE_MS &&
    session.firstSeenAt <= window.completedAt &&
    session.lastSeenAt >= window.startedAt &&
    session.lastSeenAt <= window.completedAt + RAW_CAPTURE_TEMPORAL_MAX_END_GAP_MS &&
    window.completedAt - session.lastSeenAt <= RAW_CAPTURE_TEMPORAL_MAX_END_GAP_MS;
}

function rawCaptureManifestFitsTemporalWindow(
  manifest: PersistedRawCaptureManifest,
  window: RawCaptureTemporalWindow
): boolean {
  const firstSeenAt = rawCaptureTimestamp(manifest.metadata.firstSeenAt ?? manifest.identity.capturedAt);
  const lastSeenAt = rawCaptureTimestamp(manifest.metadata.lastSeenAt ?? manifest.identity.completedAt);
  if (firstSeenAt === null || lastSeenAt === null) {
    return false;
  }
  return firstSeenAt >= window.startedAt - RAW_CAPTURE_TEMPORAL_MAX_PRELUDE_MS &&
    firstSeenAt <= window.completedAt &&
    lastSeenAt >= window.startedAt &&
    lastSeenAt <= window.completedAt + RAW_CAPTURE_TEMPORAL_MAX_END_GAP_MS &&
    window.completedAt - lastSeenAt <= RAW_CAPTURE_TEMPORAL_MAX_END_GAP_MS;
}

function rawCapturePersistedCandidateFitsContext(
  manifest: PersistedRawCaptureManifest,
  identity: RawCaptureReplayIdentity,
  temporalWindow: RawCaptureTemporalWindow | null
): boolean {
  const localReplayId = manifest.localReplayId || manifest.identity.localReplayId || "";
  const localMatchId = manifest.localMatchId || manifest.identity.localMatchId || "";
  if (
    (localReplayId && !identity.replayIds.some((value) => identityEquals(value, localReplayId))) ||
    (localMatchId && !identity.matchIds.some((value) => identityEquals(value, localMatchId)))
  ) {
    // A persisted source already owned by another local replay must not be
    // reparented merely because later DOM evidence repeats a stale Atlas room.
    return false;
  }
  return !temporalWindow || rawCaptureManifestFitsTemporalWindow(manifest, temporalWindow);
}

function latestReplayEventTimestamp(replay: ReplayRecord): string | undefined {
  const latest = [replay.capturedAt, ...replay.events.map((event) => event.capturedAt)]
    .map((value) => ({ value, timestamp: rawCaptureTimestamp(value) }))
    .filter((item): item is { value: string; timestamp: number } => item.timestamp !== null)
    .sort((left, right) => right.timestamp - left.timestamp)[0];
  return latest?.value;
}

function rawCaptureUploadCapturedAt(manifest: PersistedRawCaptureManifest): string | undefined {
  const identityTimestamp = normalizedRawCaptureTimestamp(manifest.identity.capturedAt);
  if (identityTimestamp) {
    return identityTimestamp;
  }
  return normalizedRawCaptureTimestamp(manifest.metadata.firstSeenAt);
}

function webReplayDiagnosticTimestamp(value: string | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function webReplayDiagnosticAttemptAt(entry: WebReplayDiagnosticEntry): string {
  return entry.metadata.lastUploadAttemptAt ||
    entry.metadata.processingUpdatedAt ||
    entry.metadata.uploadedAt ||
    entry.metadata.captureCompletedAt ||
    entry.capturedAt ||
    "";
}

function buildWebReplayUploadLaneDiagnostics(
  platform: "atlas" | "tcga",
  settings: UserSettings,
  entries: WebReplayDiagnosticEntry[]
): WebReplayUploadLaneDiagnostics {
  const configured = platform === "tcga"
    ? settings.rawCapture.tcgaWebReplayAutoUploadEnabled === true
    : settings.rawCapture.webReplayAutoUploadEnabled === true;
  const consentUid = normalizeRiftLiteAccountUid(platform === "tcga"
    ? settings.rawCapture.tcgaWebReplayAutoUploadAccountUid
    : settings.rawCapture.webReplayAutoUploadAccountUid);
  const accountUid = normalizeRiftLiteAccountUid(settings.accountUid);
  const accountMatches = Boolean(
    configured &&
    accountUid &&
    consentUid &&
    riftLiteAccountUidEquals(consentUid, accountUid)
  );
  const enabled = Boolean(settings.rawCapture.enabled && accountMatches);
  const records = entries.filter((entry) => entry.platform === platform);
  const eligibleRecords = records.filter((entry) =>
    entry.metadata.webReplayAutoUploadEligible === true &&
    riftLiteAccountUidEquals(entry.metadata.webReplayAutoUploadAccountUid, consentUid)
  );
  const failedRecords = records.filter((entry) =>
    entry.metadata.uploadStatus === "failed" ||
    entry.metadata.processingStatus === "failed" ||
    entry.metadata.deliveryStage === "paused" ||
    Boolean(entry.metadata.error)
  );
  const latestError = failedRecords
    .filter((entry) => Boolean(entry.metadata.error))
    .sort((left, right) =>
      webReplayDiagnosticTimestamp(webReplayDiagnosticAttemptAt(right)) -
      webReplayDiagnosticTimestamp(webReplayDiagnosticAttemptAt(left))
    )[0];
  const latestAttemptAt = records
    .map(webReplayDiagnosticAttemptAt)
    .filter(Boolean)
    .sort((left, right) => webReplayDiagnosticTimestamp(right) - webReplayDiagnosticTimestamp(left))[0] || "";
  const latestUploadedAt = records
    .map((entry) => entry.metadata.uploadedAt || "")
    .filter(Boolean)
    .sort((left, right) => webReplayDiagnosticTimestamp(right) - webReplayDiagnosticTimestamp(left))[0] || "";

  return {
    platform,
    configured,
    enabled,
    accountMatches,
    captured: records.length,
    eligible: eligibleRecords.length,
    pending: eligibleRecords.filter((entry) =>
      (entry.metadata.uploadStatus === "not-uploaded" || entry.metadata.uploadStatus === "disabled") &&
      entry.metadata.processingStatus !== "failed"
    ).length,
    inProgress: records.filter((entry) =>
      entry.metadata.processingStatus === "uploading" || entry.metadata.processingStatus === "processing"
    ).length,
    uploaded: records.filter((entry) => entry.metadata.uploadStatus === "uploaded").length,
    failed: failedRecords.length,
    tooLarge: records.filter((entry) => entry.metadata.uploadStatus === "too-large").length,
    latestAttemptAt,
    latestUploadedAt,
    lastError: latestError?.metadata.error || ""
  };
}

function webReplayUploadFailureDiagnostics(
  entries: WebReplayDiagnosticEntry[]
): WebReplayUploadFailureDiagnostic[] {
  return entries
    .filter((entry) =>
      entry.metadata.uploadStatus === "failed" ||
      entry.metadata.uploadStatus === "too-large" ||
      entry.metadata.processingStatus === "failed" ||
      Boolean(entry.metadata.error)
    )
    .sort((left, right) =>
      webReplayDiagnosticTimestamp(webReplayDiagnosticAttemptAt(right)) -
      webReplayDiagnosticTimestamp(webReplayDiagnosticAttemptAt(left))
    )
    .slice(0, 6)
    .map((entry) => ({
      platform: entry.platform,
      captureSessionId: entry.captureSessionId,
      title: entry.title,
      capturedAt: entry.capturedAt,
      attemptedAt: webReplayDiagnosticAttemptAt(entry),
      status: entry.metadata.uploadStatus,
      processingStatus: entry.metadata.processingStatus,
      error: entry.metadata.error || (entry.metadata.uploadStatus === "too-large"
        ? "The captured replay exceeded the Web Replay upload limit."
        : "Web replay processing failed without an additional server message."),
      canUploadAnyway: entry.metadata.lastErrorCode === "replay_capture_missing_mulligan" ||
        webReplayIncompleteOverrideAllowed(entry.metadata.error || ""),
      lastHttpStatus: entry.metadata.lastHttpStatus,
      errorCode: entry.metadata.lastErrorCode,
      errorClass: entry.metadata.lastErrorClass,
      recommendedAction: webReplayRecommendedAction(entry.metadata),
      nextRetryAt: entry.metadata.nextRetryAt
    }));
}

function buildWebReplayUploadQueue(entries: WebReplayDiagnosticEntry[]): WebReplayUploadQueueItem[] {
  const stagePriority: Record<WebReplayDeliveryStage, number> = {
    failed: 0,
    paused: 1,
    authenticating: 2,
    initializing: 2,
    uploading: 2,
    completing: 2,
    processing: 3,
    queued: 4,
    captured: 5,
    ready: 6
  };
  return entries
    .filter((entry) => {
      const metadata = entry.metadata;
      if (metadata.uploadStatus === "disabled" && metadata.webReplayAutoUploadEligible !== true) {
        return false;
      }
      return metadata.webReplayAutoUploadEligible === true ||
        Boolean(metadata.uploadId || metadata.uploadUrl || metadata.lastUploadAttemptAt || metadata.error) ||
        metadata.uploadStatus === "uploaded" ||
        metadata.uploadStatus === "failed" ||
        metadata.uploadStatus === "too-large" ||
        metadata.processingStatus === "uploading" ||
        metadata.processingStatus === "processing" ||
        metadata.processingStatus === "failed";
    })
    .map((entry): WebReplayUploadQueueItem => {
      const stage = webReplayDeliveryStage(entry.metadata);
      return {
        platform: entry.platform,
        captureSessionId: entry.captureSessionId,
        localReplayId: entry.localReplayId,
        title: entry.title,
        capturedAt: entry.capturedAt,
        stage,
        uploadStatus: entry.metadata.uploadStatus,
        processingStatus: entry.metadata.processingStatus,
        visibility: normalizeRawCaptureVisibility(entry.metadata.visibility),
        uploadUrl: isRiftLiteReplayV2Url(entry.metadata.uploadUrl) ? entry.metadata.uploadUrl : undefined,
        locallyAvailable: Boolean(entry.localReplayId || entry.metadata.localPath),
        attemptCount: Math.max(0, entry.metadata.attemptCount ?? (entry.metadata.lastUploadAttemptAt ? 1 : 0)),
        nextRetryAt: entry.metadata.nextRetryAt,
        lastAttemptAt: webReplayDiagnosticAttemptAt(entry) || undefined,
        error: entry.metadata.error,
        lastHttpStatus: entry.metadata.lastHttpStatus,
        errorCode: entry.metadata.lastErrorCode,
        errorClass: entry.metadata.lastErrorClass,
        recommendedAction: webReplayRecommendedAction(entry.metadata),
        canUploadAnyway: entry.metadata.lastErrorCode === "replay_capture_missing_mulligan" ||
          webReplayIncompleteOverrideAllowed(entry.metadata.error || ""),
        partialWarnings: entry.metadata.partialWarnings
      };
    })
    .sort((left, right) => {
      const stageDifference = stagePriority[left.stage] - stagePriority[right.stage];
      if (stageDifference) return stageDifference;
      return webReplayDiagnosticTimestamp(right.lastAttemptAt || right.capturedAt) -
        webReplayDiagnosticTimestamp(left.lastAttemptAt || left.capturedAt);
    })
    .slice(0, 100);
}

function webReplayDeliveryStage(metadata: RawCaptureReplayMetadata): WebReplayDeliveryStage {
  if (metadata.deliveryStage) return metadata.deliveryStage;
  if (metadata.processingStatus === "ready") return "ready";
  if (metadata.processingStatus === "failed" || metadata.uploadStatus === "too-large") return "failed";
  if (metadata.processingStatus === "processing") return "processing";
  if (metadata.processingStatus === "uploading") return "uploading";
  if (metadata.webReplayAutoUploadEligible === true) return "queued";
  return "captured";
}

function webReplayRecommendedAction(metadata: RawCaptureReplayMetadata): WebReplayRecommendedAction {
  if (
    metadata.lastErrorCode === "replay_capture_missing_mulligan" ||
    webReplayIncompleteOverrideAllowed(metadata.error || "")
  ) {
    return "upload-incomplete";
  }
  if (metadata.lastErrorClass === "authentication") return "reconnect-account";
  if (
    metadata.deliveryStage === "paused" &&
    (Boolean(metadata.nextRetryAt) || Boolean(metadata.error))
  ) {
    return "retry";
  }
  if (metadata.processingStatus === "ready" && isRiftLiteReplayV2Url(metadata.uploadUrl)) {
    return "open-replay";
  }
  if (
    metadata.deliveryStage === "completing" &&
    metadata.processingStatus === "processing" &&
    metadata.nextRetryAt
  ) {
    return "retry";
  }
  if (["authenticating", "initializing", "uploading", "completing", "processing"].includes(
    webReplayDeliveryStage(metadata)
  )) {
    return "wait";
  }
  if (metadata.nextRetryAt || ["network", "server", "unknown"].includes(metadata.lastErrorClass || "")) {
    return "retry";
  }
  if (metadata.processingStatus === "failed" || metadata.uploadStatus === "failed" || metadata.uploadStatus === "too-large") {
    return "remove-from-queue";
  }
  return metadata.webReplayAutoUploadEligible === true ? "wait" : "none";
}

export function webReplayIncompleteOverrideAllowed(error: string): boolean {
  const normalized = error.trim().replace(/\s+/g, " ");
  return /^RiftLite replay complete 422: Replay capture is incomplete: The replay did not capture the opening mulligan\.$/i
    .test(normalized);
}

function replayV2MissingOpeningMulligan(body: Record<string, unknown> | null, fallbackMessage: string): boolean {
  const errorObject = readObject(body?.error);
  const code = readStringDeep(errorObject, ["code"]) || readStringDeep(body, ["code"]);
  return code === "replay_capture_missing_mulligan" || webReplayIncompleteOverrideAllowed(fallbackMessage);
}

function normalizeDiagnosticCaptureSessionId(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f/\\]/.test(normalized)) {
    throw new Error("The Web Replay capture identifier is invalid.");
  }
  return normalized;
}

function rawCaptureMetadataRemovedFromUploadQueue(
  metadata: RawCaptureReplayMetadata
): RawCaptureReplayMetadata {
  const updatedAt = new Date().toISOString();
  return {
    ...metadata,
    uploadStatus: "disabled",
    uploadUrl: undefined,
    uploadId: undefined,
    statusEndpoint: undefined,
    uploadedAt: undefined,
    processingStatus: "pending",
    processingUpdatedAt: updatedAt,
    deliveryStage: "captured",
    attemptCount: 0,
    lastUploadAttemptAt: undefined,
    nextRetryAt: undefined,
    lastHttpStatus: undefined,
    lastErrorCode: undefined,
    lastErrorClass: undefined,
    remoteStatusCheckedAt: undefined,
    partialWarnings: undefined,
    error: undefined,
    webReplayAutoUploadEligible: false,
    webReplayDiscordShareEligible: false,
    webReplayDiscordShareHubIds: undefined,
    discordShareStatus: undefined,
    discordShareError: undefined
  };
}

function rawCaptureUploadAttemptAt(metadata: RawCaptureReplayMetadata | undefined): number {
  return rawCaptureTimestamp(metadata?.lastUploadAttemptAt) ?? 0;
}

function rawCaptureAutoUploadRetryReady(metadata: RawCaptureReplayMetadata): boolean {
  const nextRetryAt = rawCaptureTimestamp(metadata.nextRetryAt);
  if (nextRetryAt !== null) {
    return Date.now() >= nextRetryAt;
  }
  if (["capture", "validation", "storage"].includes(metadata.lastErrorClass || "")) {
    return false;
  }
  const lastAttemptAt = rawCaptureTimestamp(metadata.lastUploadAttemptAt);
  return lastAttemptAt === null ||
    Date.now() - lastAttemptAt >= RAW_CAPTURE_AUTO_UPLOAD_RETRY_COOLDOWN_MS;
}

function rawCaptureRemoteStatusCheckReady(metadata: RawCaptureReplayMetadata): boolean {
  if (!metadata.uploadId || !["pending", "uploading", "processing"].includes(metadata.processingStatus || "")) {
    return false;
  }
  const nextRetryAt = rawCaptureTimestamp(metadata.nextRetryAt);
  return nextRetryAt !== null && Date.now() >= nextRetryAt;
}

function rawCaptureStaleProcessingReady(metadata: RawCaptureReplayMetadata, forceRetry: boolean): boolean {
  if (!metadata.processingStatus || !["uploading", "processing", "pending"].includes(metadata.processingStatus)) {
    return false;
  }
  if (forceRetry) return true;
  const updatedAt = rawCaptureTimestamp(metadata.processingUpdatedAt) ?? rawCaptureTimestamp(metadata.lastUploadAttemptAt);
  return updatedAt !== null && Date.now() - updatedAt >= RAW_CAPTURE_STALE_PROCESSING_MS;
}

function rawCaptureMatchSummaryResolved(summary: RawCaptureMatchSummary | undefined): boolean {
  return Boolean(summary && summary.result !== "incomplete");
}

function rawCaptureMatchSummariesEqual(
  left: RawCaptureMatchSummary | undefined,
  right: RawCaptureMatchSummary
): boolean {
  return Boolean(left && JSON.stringify(left) === JSON.stringify(right));
}

function rawCaptureDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

function normalizedRawCaptureTimestamp(value: unknown): string | undefined {
  const timestamp = rawCaptureTimestamp(value);
  return timestamp === null ? undefined : new Date(timestamp).toISOString();
}

function rawCaptureTimestamp(value: unknown): number | null {
  const timestamp = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Date.parse(value)
      : Number.NaN;
  return Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= RAW_CAPTURE_MAX_DATE_MS
    ? timestamp
    : null;
}

function identityEquals(left: string, right: string): boolean {
  return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());
}

function rawCaptureTransportKeys(requestUrl: string, socketId: string): string[] {
  const keys = requestUrl ? [`${requestUrl}\u0000${socketId}`] : [];
  keys.push(`socket\u0000${socketId}`);
  return keys;
}

function rawCaptureReplayIdentity(
  replay: ReplayRecord,
  explicitIdentity: RawCaptureFinishIdentity
): RawCaptureReplayIdentity {
  const evidence: unknown[] = [replay.events, replay.matchSnapshot];
  const rawCapture = replay.rawCapture;
  return {
    captureSessionIds: uniqueIdentityValues([
      explicitIdentity.captureSessionId,
      rawCapture?.captureSessionId,
      ...collectStringValuesDeep(evidence, ["captureSessionId", "capture_session_id"])
    ]),
    roomCodes: uniqueIdentityValues([
      explicitIdentity.roomCode,
      ...(explicitIdentity.roomCodes ?? []),
      rawCapture?.roomCode,
      ...(rawCapture?.roomCodes ?? []),
      ...collectStringValuesDeep(evidence, [
        "roomCode",
        "room_code",
        "gameInstanceId",
        "previousRoomCode",
        "previous_room_code",
        "previousGameInstanceId"
      ])
    ]),
    seriesIds: uniqueIdentityValues([
      explicitIdentity.seriesId,
      rawCapture?.seriesId,
      ...collectStringValuesDeep(evidence, ["seriesId", "series_id", "matchSeriesId"])
    ]),
    matchIds: uniqueIdentityValues([
      explicitIdentity.matchId,
      ...(explicitIdentity.matchIds ?? []),
      explicitIdentity.localMatchId,
      replay.matchId,
      ...collectStringValuesDeep(evidence, ["matchId", "match_id"])
    ]),
    replayIds: uniqueIdentityValues([
      explicitIdentity.replayId,
      ...(explicitIdentity.replayIds ?? []),
      explicitIdentity.localReplayId,
      replay.id,
      ...collectStringValuesDeep(evidence, ["replayId", "replay_id"])
    ])
  };
}

function rawCaptureFinishIdentityValues(identity: RawCaptureFinishIdentity): RawCaptureReplayIdentity {
  return {
    captureSessionIds: uniqueIdentityValues([identity.captureSessionId]),
    roomCodes: uniqueIdentityValues([identity.roomCode, ...(identity.roomCodes ?? [])]),
    seriesIds: uniqueIdentityValues([identity.seriesId]),
    matchIds: uniqueIdentityValues([
      identity.matchId,
      ...(identity.matchIds ?? []),
      identity.localMatchId
    ]),
    replayIds: uniqueIdentityValues([
      identity.replayId,
      ...(identity.replayIds ?? []),
      identity.localReplayId
    ])
  };
}

function collectStringValuesDeep(value: unknown, keys: string[], depth = 0): string[] {
  if (depth > 7 || value === null || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringValuesDeep(item, keys, depth + 1));
  }
  const object = value as Record<string, unknown>;
  const results: string[] = [];
  for (const [key, nested] of Object.entries(object)) {
    if (keys.includes(key) && typeof nested === "string" && nested.trim()) {
      results.push(nested.trim());
    }
    if (nested && typeof nested === "object") {
      results.push(...collectStringValuesDeep(nested, keys, depth + 1));
    }
  }
  return results;
}

function uniqueIdentityValues(values: Array<string | undefined>): string[] {
  const unique: string[] = [];
  for (const value of values) {
    if (value) {
      rememberRawCaptureIdentity(unique, value);
    }
  }
  return unique;
}

function buildFilterStats(messages: RawCaptureFrame[]): RawCaptureFilterStats {
  const stats: RawCaptureFilterStats = {
    policyVersion: RAW_CAPTURE_FILTER_POLICY_VERSION,
    keptCount: 0,
    droppedCount: 0,
    droppedBytes: 0,
    byType: {}
  };
  for (const message of messages) {
    const type = message.type || "unknown";
    stats.byType[type] ??= { kept: 0, dropped: 0 };
    if (message.drop) {
      stats.byType[type].dropped += 1;
      stats.droppedCount += 1;
      stats.droppedBytes += Buffer.byteLength(message.raw || "", "utf8");
    } else {
      stats.byType[type].kept += 1;
      stats.keptCount += 1;
    }
  }
  return stats;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return readObject(parsed);
  } catch {
    return null;
  }
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readStringDeep(value: unknown, keys: string[], depth = 0): string {
  const object = readObject(value);
  if (!object || depth > 4) {
    return "";
  }
  for (const key of keys) {
    const direct = object[key];
    if (typeof direct === "string" && direct.trim()) {
      return direct.trim();
    }
  }
  for (const nested of Object.values(object)) {
    const found = readStringDeep(nested, keys, depth + 1);
    if (found) {
      return found;
    }
  }
  return "";
}

function readNumberDeep(value: unknown, keys: string[], depth = 0): number | undefined {
  const object = readObject(value);
  if (!object || depth > 4) {
    return undefined;
  }
  for (const key of keys) {
    const direct = object[key];
    if (typeof direct === "number" && Number.isFinite(direct)) {
      return direct;
    }
    if (typeof direct === "string" && direct.trim() && Number.isFinite(Number(direct))) {
      return Number(direct);
    }
  }
  for (const nested of Object.values(object)) {
    const found = readNumberDeep(nested, keys, depth + 1);
    if (typeof found === "number") {
      return found;
    }
  }
  return undefined;
}

function extractUploadUrl(body: Record<string, unknown> | null, location: string): string {
  const candidates = [
    location,
    readStringDeep(body, ["url", "replayUrl", "link", "href", "location"])
  ];
  return candidates.find((candidate) => /^https?:\/\//i.test(candidate)) ?? "";
}

function extractUploadId(body: Record<string, unknown> | null, uploadUrl: string): string {
  const id = readStringDeep(body, ["id", "replayId", "slug"]);
  if (id) {
    return id;
  }
  return uploadUrl.split("/").filter(Boolean).at(-1) ?? "";
}

async function rawCaptureDirectory(settings: UserSettings): Promise<string> {
  const directory = rawCaptureDirectoryPath(settings);
  await mkdir(directory, { recursive: true });
  return directory;
}

function rawCaptureDirectoryPath(settings: UserSettings): string {
  const base = settings.replayDirectory || join(app.getPath("documents"), "RiftLite", "Replay Bundles");
  return join(base, "Raw Capture");
}

function safeFileComponent(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, "-").slice(0, 80) || "raw-capture";
}

function truncateForUi(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function appVersion(): string {
  try {
    return app?.getVersion?.() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}
