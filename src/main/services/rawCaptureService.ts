import { app } from "electron";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
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
  UserSettings
} from "../../shared/types.js";
import { canonicalLegendName } from "../../shared/legendNames.js";
import type { RiftLiteStore } from "./store.js";

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
  "uploadedAt",
  "processingStatus",
  "checksumSha256",
  "compressedBytes",
  "error",
  "lastUploadAttemptAt",
  "processingUpdatedAt"
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

type RawCaptureRuntimeSettings = UserSettings["rawCapture"] & {
  uploadEnabled?: boolean;
};

export type LinkedAccountIdTokenProvider = (expectedAccountUid: string) => Promise<string | null>;
export type WebReplayPublishedHandler = (localMatchId: string, webReplayId: string) => Promise<void> | void;
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
  platform: "atlas";
  localPath: string;
  indexPath: string;
  localReplayId?: string;
  localMatchId?: string;
  title?: string;
  match?: RawCaptureMatchSummary;
  identity: RawCaptureFinishIdentity;
  metadata: RawCaptureReplayMetadata;
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
const PILTOVER_DECK_PATH_RE = /^\/decks\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const RAW_CAPTURE_INDEX_SUFFIX = ".riftlite-index.json";
const FIREBASE_API_KEY = "AIzaSyBNqEY-i_CggjhDKVltoPQFrSOEfHF7fBA";
const RAW_CAPTURE_TEMPORAL_MAX_PRELUDE_MS = 15 * 60 * 1000;
const RAW_CAPTURE_TEMPORAL_MAX_END_GAP_MS = 3 * 60 * 1000;
const RAW_CAPTURE_TEMPORAL_MAX_MATCH_MS = 6 * 60 * 60 * 1000;
const RAW_CAPTURE_MAX_DATE_MS = 8_640_000_000_000_000;
const RAW_CAPTURE_AUTO_UPLOAD_RETRY_COOLDOWN_MS = 2 * 60 * 1000;
const RAW_CAPTURE_DISCORD_RESULT_INITIAL_WAIT_MS = 15_000;
const RAW_CAPTURE_DISCORD_RESULT_POLL_MS = 2_500;
const RAW_CAPTURE_DISCORD_RESULT_MAX_WAIT_MS = 30_000;

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

  constructor(
    private readonly store: RiftLiteStore,
    private readonly linkedAccountIdTokenProvider: LinkedAccountIdTokenProvider = (expectedAccountUid) => (
      firebaseIdTokenFromSettings(store, expectedAccountUid)
    ),
    private readonly webReplayPublishedHandler: WebReplayPublishedHandler = () => undefined,
    private readonly replayUpdatedHandler: ReplayUpdatedHandler = () => undefined
  ) {}

  async appendFrame(payload: RawCaptureAppendFramePayload): Promise<void> {
    if (payload.platform !== "atlas") {
      return;
    }
    const settings = await this.store.getSettings();
    if (!settings.rawCapture.enabled) {
      this.clearSessions();
      return;
    }
    const raw = payload.frame.raw;
    const details = extractRawCaptureDetails(raw);
    if (!shouldKeepRawFrame(raw, details.type)) {
      return;
    }
    const ts = Number.isFinite(payload.frame.ts) ? payload.frame.ts : Date.now();
    this.pruneStaleSessions(ts);
    const requestUrl = payload.requestUrl || "";
    const socketId = payload.frame.socketId || "ws-1";
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

  private pruneStaleSessions(now: number): void {
    for (const session of this.sessions.values()) {
      if (
        !this.finalizingSessionIds.has(session.captureSessionId) &&
        now >= session.lastSeenAt &&
        now - session.lastSeenAt > RAW_CAPTURE_SESSION_IDLE_MS
      ) {
        this.removeSession(session.captureSessionId);
      }
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
    const settings = await this.store.getSettings();
    if (!settings.rawCapture.enabled) {
      this.clearSessions();
      return replay ?? null;
    }
    const platform = explicitIdentity.platform ?? replay?.platform;
    if (platform !== "atlas" || replay?.rawCapture) {
      return replay ?? null;
    }

    const identity = replay
      ? rawCaptureReplayIdentity(replay, explicitIdentity)
      : rawCaptureFinishIdentityValues(explicitIdentity);
    const temporalWindow = rawCaptureFinishHasRemoteIdentity(explicitIdentity, replay)
      ? null
      : rawCaptureTemporalWindow(explicitIdentity, replay);
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
        this.removeSession(session.captureSessionId);
      } finally {
        this.finalizingSessionIds.delete(session.captureSessionId);
      }
    } else {
      manifest = await this.findPersistedCapture(identity, settings);
    }
    if (!manifest) {
      this.lastAssociationError = "Raw capture was not attached because no unique active session matched the replay identity and time window.";
      return replay ?? null;
    }
    this.lastAssociationError = "";

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
          manifest = await this.uploadPersistedCaptureToRiftLite(
            manifest,
            rawCaptureVisibility(settings),
            settings,
            { automatic: true }
          );
          this.lastUploadUrl = manifest.metadata.uploadUrl || this.lastUploadUrl;
          uploadedAnything = true;
          if (saved) {
            saved = await this.saveReplayRawCapture(saved, manifest.metadata);
          }
        } catch (error) {
          const persistedFailure = await readRawCaptureManifest(manifest.indexPath);
          if (persistedFailure?.metadata.uploadStatus === "too-large") {
            manifest = persistedFailure;
            if (saved) {
              saved = await this.saveReplayRawCapture(saved, manifest.metadata);
            }
          } else if (!uploadedAnything) {
            const message = error instanceof Error ? error.message : "RiftLite replay upload failed.";
            manifest = persistedFailure ?? await this.saveManifestUploadFailure(manifest, message);
            if (saved) {
              saved = await this.saveReplayRawCapture(saved, manifest.metadata);
            }
          }
        }
      }
    }
    return saved;
  }

  async uploadRawCapture(replayId: string): Promise<ReplayRecord | null> {
    // Legacy third-party RiftReplay API-key upload. First-party Replay V2 uses
    // uploadRawCaptureToRiftLite and never sends its Firebase token here.
    const settings = await this.store.getSettings();
    const replays = [...await this.store.getReplays(), ...await this.store.getDeletedReplays()];
    const replay = replays.find((item) => item.id === replayId);
    if (!replay?.rawCapture?.localPath) {
      return replay ?? null;
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
      const gzipped = gzipSync(Buffer.from(raw, "utf8"));
      const response = await postLegacyRiftReplayWithRetry(settings.rawCapture.endpoint || LEGACY_RIFTREPLAY_UPLOAD_ENDPOINT, apiKey, gzipped);
      const text = await response.text();
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

  async uploadPendingRawCaptures(limit = 5): Promise<number> {
    if (this.pendingUploadPromise) {
      return this.pendingUploadPromise;
    }
    this.pendingUploadPromise = this.uploadPendingRawCapturesNow(limit)
      .finally(() => {
        this.pendingUploadPromise = null;
      });
    return this.pendingUploadPromise;
  }

  private async uploadPendingRawCapturesNow(limit: number): Promise<number> {
    const settings = await this.store.getSettings();
    const legacyAutoUploadEnabled = rawCaptureUploadEnabled(settings);
    const webReplayAutoUploadEnabled = riftLiteWebReplayAutoUploadEnabled(settings);
    if (!legacyAutoUploadEnabled && !webReplayAutoUploadEnabled) {
      return 0;
    }
    const canUploadExternal = legacyAutoUploadEnabled && Boolean(settings.rawCapture.apiKey.trim());
    const canUploadRiftLite = webReplayAutoUploadEnabled;
    if (!canUploadExternal && !canUploadRiftLite) {
      return 0;
    }
    const replays = await this.store.getReplays();
    const pending = replays
      .filter((replay) => replay.platform === "atlas")
      .filter((replay) => replay.rawCapture?.localPath)
      .filter((replay) => {
        const status = replay.rawCapture?.uploadStatus || "not-uploaded";
        const hasRiftLiteUpload = isRiftLiteReplayV2Url(replay.rawCapture?.uploadUrl);
        const retryableStatus = status === "not-uploaded" || status === "failed" || status === "disabled";
        const canAutoUploadToRiftLite = canUploadRiftLite &&
          Boolean(replay.rawCapture) &&
          rawCaptureWebReplayAutoUploadEligible(replay.rawCapture!, settings) &&
          rawCaptureAutoUploadRetryReady(replay.rawCapture!);
        if (status === "too-large") {
          return false;
        }
        return (canUploadExternal && retryableStatus) ||
          (canAutoUploadToRiftLite && (
            retryableStatus ||
            !hasRiftLiteUpload ||
            replay.rawCapture?.processingStatus === "failed" ||
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
        replay.rawCapture &&
        ["not-uploaded", "failed", "disabled"].includes(replay.rawCapture.uploadStatus)
      ) {
        saved = await this.uploadRawCapture(replay.id);
      }
      if (
        canUploadRiftLite &&
        replay.rawCapture &&
        rawCaptureWebReplayAutoUploadEligible(replay.rawCapture, settings) &&
        rawCaptureAutoUploadRetryReady(replay.rawCapture)
      ) {
        try {
          await this.uploadRawCaptureToRiftLite(
            replay.id,
            rawCaptureVisibility(settings),
            { automatic: true }
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
      const manifests = (await readRawCaptureManifests(settings))
        .filter((manifest) => !attemptedCaptureIds.has(manifest.metadata.captureSessionId))
        .filter((manifest) => rawCaptureWebReplayAutoUploadEligible(manifest.metadata, settings))
        .filter((manifest) => rawCaptureAutoUploadRetryReady(manifest.metadata))
        .filter((manifest) => manifest.metadata.uploadStatus !== "too-large")
        .filter((manifest) => (
          !isRiftLiteReplayV2Url(manifest.metadata.uploadUrl) ||
          manifest.metadata.processingStatus === "failed" ||
          rawCaptureDiscordShareNeedsRetry(manifest.metadata, settings)
        ))
        .sort((a, b) => {
          const attemptDifference = rawCaptureUploadAttemptAt(a.metadata) -
            rawCaptureUploadAttemptAt(b.metadata);
          return attemptDifference || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
        })
        .slice(0, Math.max(0, Math.max(1, limit) - pending.length));
      for (const manifest of manifests) {
        try {
          await this.uploadPersistedCaptureToRiftLite(
            manifest,
            rawCaptureVisibility(settings),
            settings,
            { automatic: true }
          );
          uploaded += 1;
        } catch {
          // The per-capture manifest retains the failed status for a later retry.
        }
      }
    }
    return uploaded;
  }

  async getRawCapturePayload(replayId: string): Promise<unknown | null> {
    const replays = [...await this.store.getReplays(), ...await this.store.getDeletedReplays()];
    const replay = replays.find((item) => item.id === replayId);
    if (!replay?.rawCapture?.localPath) {
      return null;
    }
    const raw = await readFile(replay.rawCapture.localPath, "utf8");
    return JSON.parse(raw) as unknown;
  }

  async uploadRawCaptureToRiftLite(
    replayId: string,
    visibility: RawCaptureVisibility = "private",
    options: { automatic?: boolean } = {}
  ): Promise<RiftLiteReplayUploadResult> {
    const settings = await this.store.getSettings();
    const replays = [...await this.store.getReplays(), ...await this.store.getDeletedReplays()];
    const replay = replays.find((item) => item.id === replayId);
    if (!replay?.rawCapture?.localPath) {
      throw new Error("No raw Atlas sidecar is attached to this replay.");
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
      if (failed) {
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
    const accountUid = riftLiteWebReplayAutoUploadAccountUid(settings);
    if (!accountUid) {
      throw new Error("Verify the linked RiftLite account and enable web replay upload before sharing.");
    }
    const replays = [...await this.store.getReplays(), ...await this.store.getDeletedReplays()];
    const replay = replays.find((item) => item.id === replayId);
    if (!replay?.rawCapture?.localPath) {
      throw new Error("No raw Atlas sidecar is attached to this replay.");
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

    const replayAuth = await this.canonicalReplayAuth(settings, manifest.metadata, false);
    await this.assertRiftLiteReplayUploadAccountCurrent(replayAuth.settings, manifest.metadata, false);
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
    const shared = await this.sharePersistedReplayToDiscord(manifest, remoteReplayId, replayAuth.idToken);
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
    settings: UserSettings
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
      captureCompletedAt: persistedAt,
      resultStatus: rawCaptureMatchSummaryResolved(match) ? "resolved" : "pending",
      resultFinalizedAt: rawCaptureMatchSummaryResolved(match) ? persistedAt : undefined,
      processingUpdatedAt: persistedAt,
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
      localPath,
      indexPath,
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
    settings: UserSettings
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
    const bySeries = findUnique((manifest) => identity.seriesIds.some((value) => (
      identityEquals(value, manifest.identity.seriesId || manifest.metadata.seriesId || "")
    )));
    if (bySeries) {
      return bySeries;
    }
    const byMatch = findUnique((manifest) => identity.matchIds.some((value) => (
      identityEquals(value, manifest.localMatchId || "") ||
      identityEquals(value, manifest.identity.matchId || "") ||
      (manifest.identity.matchIds ?? []).some((matchId) => identityEquals(value, matchId))
    )));
    if (byMatch) {
      return byMatch;
    }
    const byReplay = findUnique((manifest) => identity.replayIds.some((value) => (
      identityEquals(value, manifest.localReplayId || "") ||
      identityEquals(value, manifest.identity.replayId || "") ||
      (manifest.identity.replayIds ?? []).some((replayId) => identityEquals(value, replayId))
    )));
    if (byReplay) {
      return byReplay;
    }
    return findUnique((manifest) => identity.roomCodes.some((value) => (
      identityEquals(value, manifest.identity.roomCode || manifest.metadata.roomCode || "") ||
      (manifest.identity.roomCodes ?? manifest.metadata.roomCodes ?? []).some((roomCode) => identityEquals(value, roomCode))
    )));
  }

  private async manifestForReplay(replay: ReplayRecord, settings: UserSettings): Promise<PersistedRawCaptureManifest> {
    const rawCapture = replay.rawCapture;
    if (!rawCapture?.localPath) {
      throw new Error("No raw Atlas sidecar is attached to this replay.");
    }
    const indexPath = `${rawCapture.localPath}${RAW_CAPTURE_INDEX_SUFFIX}`;
    const existing = await readRawCaptureManifest(indexPath);
    const artifactAlreadyUploaded = (existing?.metadata.uploadStatus ?? rawCapture.uploadStatus) === "uploaded";
    const match = existing?.match ?? (
      artifactAlreadyUploaded ? undefined : rawCaptureMatchSummaryFromDraft(replay.matchSnapshot)
    );
    if (match && !artifactAlreadyUploaded) {
      await writeRawCaptureMatchSummary(rawCapture.localPath, match);
    }
    if (existing) {
      return {
        ...existing,
        updatedAt: new Date().toISOString(),
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
          platform: "atlas",
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
      localPath: rawCapture.localPath,
      indexPath,
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
    options: { automatic?: boolean } = {}
  ): Promise<PersistedRawCaptureManifest> {
    if (
      options.automatic === true &&
      rawCaptureDiscordShareEligible(manifest.metadata, settings) &&
      !manifest.metadata.uploadId
    ) {
      const waitForResult = !manifest.metadata.lastUploadAttemptAt;
      manifest = await this.waitForDiscordMatchSummary(manifest, waitForResult);
      if (!rawCaptureMatchSummaryResolved(manifest.match)) {
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
            lastUploadAttemptAt: attemptedAt,
            error: "Waiting for the completed Atlas match result before uploading and sharing this replay."
          }
        };
        await writeRawCaptureManifest(pending);
        throw new Error(pending.metadata.error);
      }
    }
    const raw = await readFile(manifest.localPath, "utf8");
    const gzipped = gzipSync(Buffer.from(raw, "utf8"));
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
        checksumSha256: sha256,
        compressedBytes: bytes,
        lastUploadAttemptAt: uploadAttemptAt,
        error: undefined
      }
    };
    await writeRawCaptureManifest(uploading);

    try {
      if (options.automatic === true) {
        await this.assertRiftLiteReplayUploadAccountCurrent(settings, uploading.metadata, true);
      }
      const replayAuth = await this.canonicalReplayAuth(settings, uploading.metadata, options.automatic === true);
      const idToken = replayAuth.idToken;
      const authenticatedSettings = replayAuth.settings;
      await this.assertRiftLiteReplayUploadAccountCurrent(authenticatedSettings, uploading.metadata, options.automatic === true);
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
          platform: "atlas",
          localReplayId: manifest.localReplayId,
          matchId: manifest.localMatchId || manifest.identity.matchId,
          seriesId: manifest.identity.seriesId,
          roomCode: manifest.metadata.roomCode,
          messageCount: manifest.metadata.messageCount,
          capturedAt: rawCaptureUploadCapturedAt(manifest)
        })
      });
      const initText = await initResponse.text();
      const initBody = parseJsonObject(initText);
      if (!initResponse.ok) {
        throw replayV2ApiError("init", initResponse, initBody, initText);
      }
      const initReplay = readObject(initBody?.replay);
      const replayId = readStringDeep(initReplay, ["replayId", "id"]);
      if (!replayId) {
        throw new Error("RiftLite replay init succeeded without a replay ID.");
      }
      let serverVisibility = rawCaptureVisibilityFromValue(initReplay?.visibility);
      if (serverVisibility !== visibility) {
        await this.assertRiftLiteReplayUploadAccountCurrent(authenticatedSettings, uploading.metadata, options.automatic === true);
        serverVisibility = await updateRiftLiteReplayV2Visibility(replayId, visibility, idToken);
      }
      const uploadRequired = initBody?.uploadRequired === true;
      if (uploadRequired) {
        const upload = readObject(initBody?.upload);
        const uploadEndpoint = riftLiteReplayV2Endpoint(readStringDeep(upload, ["endpoint", "url"]));
        await this.assertRiftLiteReplayUploadAccountCurrent(authenticatedSettings, uploading.metadata, options.automatic === true);
        const uploadResponse = await fetchRiftLiteReplayV2WithRetry(uploadEndpoint, {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${idToken}`,
            "Content-Type": "application/gzip",
            "X-Replay-SHA256": sha256,
            "X-Replay-Bytes": String(bytes)
          },
          body: gzipped as unknown as BodyInit
        });
        if (!uploadResponse.ok) {
          const uploadText = await uploadResponse.text();
          throw replayV2ApiError("raw upload", uploadResponse, parseJsonObject(uploadText), uploadText);
        }
      }

      const completeEndpoint = riftLiteReplayV2Endpoint(readStringDeep(initBody, ["completeEndpoint"]));
      await this.assertRiftLiteReplayUploadAccountCurrent(authenticatedSettings, uploading.metadata, options.automatic === true);
      const completeResponse = await fetchRiftLiteReplayV2WithRetry(completeEndpoint, {
        method: "POST",
        headers: { "Authorization": `Bearer ${idToken}` }
      });
      const completeText = await completeResponse.text();
      const completeBody = parseJsonObject(completeText);
      if (!completeResponse.ok) {
        throw replayV2ApiError("complete", completeResponse, completeBody, completeText);
      }
      const completeReplay = readObject(completeBody?.replay) ?? initReplay;
      const completedVisibility = rawCaptureVisibilityFromValue(completeReplay?.visibility);
      if (completedVisibility !== visibility) {
        await this.assertRiftLiteReplayUploadAccountCurrent(authenticatedSettings, uploading.metadata, options.automatic === true);
        serverVisibility = await updateRiftLiteReplayV2Visibility(replayId, visibility, idToken);
      } else {
        serverVisibility = completedVisibility;
      }
      const status = normalizeRawCaptureProcessingStatus(readStringDeep(completeReplay, ["status"]));
      const playerPath = readStringDeep(completeBody, ["playerPath"])
        || readStringDeep(initBody, ["playerPath"])
        || `/replays/${encodeURIComponent(replayId)}`;
      const uploadUrl = riftLiteReplayPlayerUrl(playerPath, replayId);
      let completed: PersistedRawCaptureManifest = {
        ...uploading,
        updatedAt: new Date().toISOString(),
        metadata: {
          ...uploading.metadata,
          uploadStatus: "uploaded",
          uploadUrl,
          uploadId: replayId,
          uploadedAt: new Date().toISOString(),
          processingStatus: status,
          processingUpdatedAt: new Date().toISOString(),
          visibility: serverVisibility,
          error: undefined
        }
      };
      await writeRawCaptureManifest(completed);
      const localMatchId = manifest.localMatchId || manifest.identity.localMatchId || "";
      if (localMatchId) {
        await Promise.resolve(this.webReplayPublishedHandler(localMatchId, replayId)).catch(() => undefined);
      }
      if (options.automatic === true && rawCaptureDiscordShareEligible(completed.metadata, authenticatedSettings)) {
        await this.assertRiftLiteReplayUploadAccountCurrent(authenticatedSettings, completed.metadata, true);
        completed = await this.sharePersistedReplayToDiscord(completed, replayId, idToken);
      }
      return completed;
    } catch (error) {
      await this.saveManifestUploadFailure(uploading, error instanceof Error ? error.message : "RiftLite replay upload failed.");
      throw error;
    }
  }

  private async assertRiftLiteReplayUploadAccountCurrent(
    settings: UserSettings,
    metadata: RawCaptureReplayMetadata,
    automatic: boolean
  ): Promise<void> {
    const current = await this.store.getSettings();
    if (
      !normalizeRiftLiteAccountUid(settings.accountUid) ||
      !settings.firebaseRefreshToken ||
      !riftLiteAccountUidEquals(current.accountUid, settings.accountUid) ||
      current.firebaseRefreshToken !== settings.firebaseRefreshToken
    ) {
      throw new Error("The linked RiftLite account changed during replay upload.");
    }
    if (automatic && !rawCaptureWebReplayAutoUploadEligible(metadata, current)) {
      throw new Error("RiftLite Web Replay automatic upload was disabled or its consenting account changed.");
    }
  }

  private async canonicalReplayAuth(
    settings: UserSettings,
    metadata: RawCaptureReplayMetadata,
    automatic: boolean
  ): Promise<{ idToken: string; settings: UserSettings }> {
    const expectedAccountUid = normalizeRiftLiteAccountUid(settings.accountUid);
    if (!expectedAccountUid || !settings.firebaseRefreshToken) {
      throw new Error("Link your RiftLite account before uploading to RiftLite Web Replay.");
    }
    const idToken = await this.linkedAccountIdTokenProvider(expectedAccountUid);
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
    if (automatic && !rawCaptureWebReplayAutoUploadEligible(metadata, authenticatedSettings)) {
      throw new Error("RiftLite Web Replay automatic upload was disabled or its consenting account changed.");
    }
    return { idToken, settings: authenticatedSettings };
  }

  private async waitForDiscordMatchSummary(
    manifest: PersistedRawCaptureManifest,
    waitForResult: boolean
  ): Promise<PersistedRawCaptureManifest> {
    if (rawCaptureMatchSummaryResolved(manifest.match)) {
      return manifest;
    }
    let refreshed = await this.refreshPersistedMatchSummary(manifest);
    if (rawCaptureMatchSummaryResolved(refreshed.match)) {
      return refreshed;
    }
    if (!waitForResult) {
      return refreshed;
    }

    await rawCaptureDelay(RAW_CAPTURE_DISCORD_RESULT_INITIAL_WAIT_MS);
    const deadline = Date.now() + (
      RAW_CAPTURE_DISCORD_RESULT_MAX_WAIT_MS - RAW_CAPTURE_DISCORD_RESULT_INITIAL_WAIT_MS
    );
    while (true) {
      refreshed = await this.refreshPersistedMatchSummary(refreshed);
      if (rawCaptureMatchSummaryResolved(refreshed.match) || Date.now() >= deadline) {
        return refreshed;
      }
      await rawCaptureDelay(Math.min(RAW_CAPTURE_DISCORD_RESULT_POLL_MS, deadline - Date.now()));
    }
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
    idToken: string
  ): Promise<PersistedRawCaptureManifest> {
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
    await writeRawCaptureManifest(manifest);
    try {
      const endpoint = `${RIFTLITE_REPLAY_ORIGIN}/api/v2/replays/${encodeURIComponent(replayId)}/share-discord`;
      const activeDeck = await this.discordActiveDeckForManifest(manifest);
      const response = await fetchRiftLiteReplayV2WithRetry(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${idToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ hubIds, ...(activeDeck ? { activeDeck } : {}) })
      });
      const text = await response.text();
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
      await writeRawCaptureManifest(updated);
      return updated;
    } catch (error) {
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
    error: string
  ): Promise<PersistedRawCaptureManifest> {
    const failed: PersistedRawCaptureManifest = {
      ...manifest,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...manifest.metadata,
        uploadStatus: "failed",
        processingStatus: "failed",
        processingUpdatedAt: new Date().toISOString(),
        error: truncateForUi(error, 300)
      }
    };
    await writeRawCaptureManifest(failed);
    return failed;
  }

  private currentSession(): ActiveRawCaptureSession | null {
    return Array.from(this.sessions.values()).reduce<ActiveRawCaptureSession | null>((latest, session) => (
      !latest || session.lastSeenAt >= latest.lastSeenAt ? session : latest
    ), null);
  }

  private removeSession(captureSessionId: string): void {
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
    const updated = await this.store.updateReplay(replay.id, (current) => ({
      ...current,
      rawCapture: mergeRawCaptureReplayMetadata(current.rawCapture, replay.rawCapture, rawCapture)
    }));
    const saved = updated ?? await this.store.saveReplay({ ...replay, rawCapture });
    try {
      await this.replayUpdatedHandler(saved);
    } catch {
      // Renderer delivery is best effort; persisted replay state remains authoritative.
    }
    return saved;
  }

  private async loadReplay(replayId: string): Promise<ReplayRecord | null> {
    const replays = [...await this.store.getReplays(), ...await this.store.getDeletedReplays()];
    return replays.find((item) => item.id === replayId) ?? null;
  }

  private async discordActiveDeckForManifest(
    manifest: PersistedRawCaptureManifest
  ): Promise<RawCaptureDiscordActiveDeck | undefined> {
    const replay = manifest.localReplayId ? await this.loadReplay(manifest.localReplayId) : null;
    let match = replay?.matchSnapshot;
    const localMatchId = manifest.localMatchId || manifest.identity.localMatchId;
    if (!match && localMatchId) {
      const matches = [...await this.store.getMatches(), ...await this.store.getDeletedMatches()];
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
      typeof object.localPath !== "string" ||
      typeof object.indexPath !== "string" ||
      typeof metadata?.captureSessionId !== "string"
    ) {
      return null;
    }
    const manifest = parsed as PersistedRawCaptureManifest;
    return {
      ...manifest,
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

function hasLinkedRiftLiteReplayAccount(settings: UserSettings): boolean {
  return Boolean(normalizeRiftLiteAccountUid(settings.accountUid) && settings.firebaseRefreshToken);
}

async function firebaseIdTokenFromSettings(store: RiftLiteStore, expectedAccountUid: string): Promise<string> {
  const settings = await store.getSettings();
  if (!hasLinkedRiftLiteReplayAccount(settings)) {
    throw new Error("Link your RiftLite account before uploading to RiftLite Web Replay.");
  }
  if (!riftLiteAccountUidEquals(settings.accountUid, expectedAccountUid)) {
    throw new Error("The linked RiftLite account changed during replay authentication.");
  }
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: settings.firebaseRefreshToken })
  });
  const text = await response.text();
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
      return await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Encoding": "gzip"
        },
        body: body as unknown as BodyInit
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await delay(700 * attempt);
      }
    }
  }
  throw new Error(`RiftReplay network error after 3 attempts: ${describeFetchError(lastError)}`);
}

async function fetchRiftLiteReplayV2WithRetry(endpoint: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  const trustedEndpoint = riftLiteReplayV2Endpoint(endpoint);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(trustedEndpoint, { ...init, redirect: "error" });
      if (response.redirected) {
        throw new Error("RiftLite replay API unexpectedly redirected the request.");
      }
      if (response.url && new URL(response.url).origin !== RIFTLITE_REPLAY_ORIGIN) {
        throw new Error("RiftLite replay API returned a response from an untrusted origin.");
      }
      if (!isRetryableReplayV2Status(response.status) || attempt === 3) {
        return response;
      }
      await response.arrayBuffer().catch(() => undefined);
    } catch (error) {
      lastError = error;
      if (attempt === 3) {
        break;
      }
    }
    await delay(250 * attempt);
  }
  throw new Error(`RiftLite replay network error after 3 attempts: ${describeFetchError(lastError)}`);
}

async function updateRiftLiteReplayV2Visibility(
  replayId: string,
  visibility: RawCaptureVisibility,
  idToken: string
): Promise<RawCaptureVisibility> {
  const endpoint = riftLiteReplayV2Endpoint(`/api/v2/replays/${encodeURIComponent(replayId)}`);
  const response = await fetchRiftLiteReplayV2WithRetry(endpoint, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ visibility })
  });
  const text = await response.text();
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
): Error {
  const errorObject = readObject(body?.error);
  const message = readStringDeep(errorObject, ["message"])
    || readStringDeep(body, ["message"])
    || rawText
    || response.statusText;
  return new Error(`RiftLite replay ${operation} ${response.status}: ${truncateForUi(message, 260)}`);
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
  const consentUid = normalizeRiftLiteAccountUid(settings.rawCapture.webReplayAutoUploadAccountUid);
  const accountUid = normalizeRiftLiteAccountUid(settings.accountUid);
  return settings.rawCapture.enabled === true &&
    settings.rawCapture.webReplayAutoUploadEnabled === true &&
    Boolean(consentUid) &&
    consentUid === accountUid &&
    hasLinkedRiftLiteReplayAccount(settings)
    ? consentUid
    : "";
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

function riftLiteWebReplayDiscordShareHubIds(settings: UserSettings): string[] {
  const accountUid = riftLiteWebReplayAutoUploadAccountUid(settings);
  const consentUid = normalizeRiftLiteAccountUid(settings.rawCapture.webReplayDiscordShareAccountUid);
  if (
    settings.rawCapture.webReplayDiscordShareEnabled !== true ||
    !accountUid ||
    consentUid !== accountUid
  ) {
    return [];
  }
  const activeHubIds = new Set(settings.activeHubs.map((hub) => hub.id));
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

function rawCaptureUploadAttemptAt(metadata: RawCaptureReplayMetadata | undefined): number {
  return rawCaptureTimestamp(metadata?.lastUploadAttemptAt) ?? 0;
}

function rawCaptureAutoUploadRetryReady(metadata: RawCaptureReplayMetadata): boolean {
  const lastAttemptAt = rawCaptureTimestamp(metadata.lastUploadAttemptAt);
  return lastAttemptAt === null ||
    Date.now() - lastAttemptAt >= RAW_CAPTURE_AUTO_UPLOAD_RETRY_COOLDOWN_MS;
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
  const base = settings.replayDirectory || join(app.getPath("documents"), "RiftLite", "Replay Bundles");
  const directory = join(base, "Raw Capture");
  await mkdir(directory, { recursive: true });
  return directory;
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
