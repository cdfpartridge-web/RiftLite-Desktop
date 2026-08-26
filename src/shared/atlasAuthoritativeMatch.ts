import {
  atlasPlayerIdFromUrl,
  atlasRoomCodeFromUrl
} from "./atlasSeatTracker.js";
import type { RawCaptureAppendFramePayload } from "./types.js";

export type AtlasAuthoritativeMatchFrameType =
  | "room_shell_sync"
  | "authoritative_snapshot"
  | "authoritative_patch_commit";

export interface AtlasAuthoritativeMatchScore {
  me: string;
  opp: string;
}

export interface AtlasAuthoritativeMatchState {
  frameType: AtlasAuthoritativeMatchFrameType;
  roomCode: string;
  gameInstanceId: string;
  localPlayerId: string;
  opponentPlayerId: string;
  myName: string;
  opponentName: string;
  format: "Bo1" | "Bo3" | "";
  score: AtlasAuthoritativeMatchScore;
}

export interface AtlasAuthoritativeMatchPatch {
  frameType: AtlasAuthoritativeMatchFrameType;
  roomCode: string;
  gameInstanceId?: string;
  localPlayerId: string;
  opponentPlayerId?: string;
  myName?: string;
  opponentName?: string;
  format?: AtlasAuthoritativeMatchState["format"];
  score?: Partial<AtlasAuthoritativeMatchScore>;
}

export interface AtlasAuthoritativeMatchSignal {
  frameType: AtlasAuthoritativeMatchFrameType;
  roomCode: string;
  gameInstanceId: string;
  myName: string;
  opponentName: string;
  format: AtlasAuthoritativeMatchState["format"];
  score: AtlasAuthoritativeMatchScore;
}

export const ATLAS_AUTHORITATIVE_MATCH_IPC_CHANNEL = "atlas:authoritative-match";

const FULL_STATE_FRAME_TYPES = new Set<AtlasAuthoritativeMatchFrameType>([
  "room_shell_sync",
  "authoritative_snapshot"
]);

export class AtlasAuthoritativeMatchTracker {
  private state: AtlasAuthoritativeMatchState | null = null;

  observeFrame(payload: RawCaptureAppendFramePayload): AtlasAuthoritativeMatchState | null {
    const patch = parseAtlasAuthoritativeMatchFrame(payload, this.state);
    if (!patch) {
      return null;
    }
    this.state = mergeAtlasAuthoritativeMatchState(this.state, patch);
    return this.getState();
  }

  getState(): AtlasAuthoritativeMatchState | null {
    return this.state
      ? { ...this.state, score: { ...this.state.score } }
      : null;
  }

  reset(): boolean {
    const changed = this.state !== null;
    this.state = null;
    return changed;
  }
}

export function parseAtlasAuthoritativeMatchFrame(
  payload: RawCaptureAppendFramePayload,
  current: AtlasAuthoritativeMatchState | null = null
): AtlasAuthoritativeMatchPatch | null {
  if (
    payload.platform !== "atlas" ||
    payload.frame.dir !== "in" ||
    !/\/parties\/match\//i.test(payload.requestUrl ?? "")
  ) {
    return null;
  }
  const requestUrl = payload.requestUrl ?? "";
  const localPlayerId = atlasPlayerIdFromUrl(requestUrl);
  const urlRoomCode = atlasRoomCodeFromUrl(requestUrl);
  if (!localPlayerId || !urlRoomCode) {
    return null;
  }
  const packet = parseRecord(payload.frame.raw);
  const frameType = readString(packet?.type) as AtlasAuthoritativeMatchFrameType;
  if (!packet || (!FULL_STATE_FRAME_TYPES.has(frameType) && frameType !== "authoritative_patch_commit")) {
    return null;
  }

  if (frameType === "authoritative_patch_commit") {
    return parseScorePatch(packet, frameType, localPlayerId, urlRoomCode, current);
  }

  const packetPayload = readRecord(packet.payload);
  const sessionDoc = readRecord(packet.sessionDoc) ?? readRecord(packetPayload?.sessionDoc);
  const snapshot = readRecord(packet.snapshot) ?? readRecord(packetPayload?.snapshot);
  const roomCode = (
    readString(packet.roomCode) ||
    readString(sessionDoc?.roomCode) ||
    readString(snapshot?.roomCode) ||
    urlRoomCode
  ).toUpperCase();
  if (!roomCode || roomCode !== urlRoomCode) {
    return null;
  }
  if (!atlasPacketIdentityMatchesSocket(sessionDoc, snapshot, localPlayerId)) {
    return null;
  }

  const players = collectAuthoritativePlayers(packet, sessionDoc, snapshot);
  if (!players || players.size !== 2 || !players.has(localPlayerId)) {
    return null;
  }
  const opponentIds = [...players.keys()].filter((id) => id !== localPlayerId);
  if (opponentIds.length !== 1) {
    return null;
  }
  const opponentPlayerId = opponentIds[0];
  const local = players.get(localPlayerId);
  const opponent = players.get(opponentPlayerId);
  if (!local || !opponent) {
    return null;
  }

  const score: Partial<AtlasAuthoritativeMatchScore> = {};
  if (local.score !== undefined) score.me = String(local.score);
  if (opponent.score !== undefined) score.opp = String(opponent.score);
  const format = normalizeAtlasMatchFormat(
    readString(sessionDoc?.matchFormat) || readString(snapshot?.matchFormat) || readString(packet.matchFormat)
  );
  return {
    frameType,
    roomCode,
    gameInstanceId: readString(packet.gameInstanceId) ||
      readString(sessionDoc?.gameInstanceId) ||
      readString(snapshot?.gameInstanceId) ||
      roomCode,
    localPlayerId,
    opponentPlayerId,
    ...(local.name ? { myName: local.name } : {}),
    ...(opponent.name ? { opponentName: opponent.name } : {}),
    ...(format ? { format } : {}),
    ...(Object.keys(score).length ? { score } : {})
  };
}

export function mergeAtlasAuthoritativeMatchState(
  current: AtlasAuthoritativeMatchState | null,
  patch: AtlasAuthoritativeMatchPatch
): AtlasAuthoritativeMatchState {
  const shouldReplace = Boolean(current && (
    (patch.roomCode && patch.roomCode !== current.roomCode) ||
    (patch.localPlayerId && patch.localPlayerId !== current.localPlayerId) ||
    (patch.opponentPlayerId && patch.opponentPlayerId !== current.opponentPlayerId)
  ));
  const base = shouldReplace || !current
    ? emptyAtlasAuthoritativeMatchState()
    : current;
  return {
    frameType: patch.frameType,
    roomCode: patch.roomCode || base.roomCode,
    gameInstanceId: nonEmpty(patch.gameInstanceId, base.gameInstanceId),
    localPlayerId: patch.localPlayerId || base.localPlayerId,
    opponentPlayerId: nonEmpty(patch.opponentPlayerId, base.opponentPlayerId),
    myName: nonEmpty(patch.myName, base.myName),
    opponentName: nonEmpty(patch.opponentName, base.opponentName),
    format: patch.format || base.format,
    score: {
      me: nonEmpty(patch.score?.me, base.score.me),
      opp: nonEmpty(patch.score?.opp, base.score.opp)
    }
  };
}

export function atlasAuthoritativeMatchSignalFromState(
  state: AtlasAuthoritativeMatchState
): AtlasAuthoritativeMatchSignal {
  return {
    frameType: state.frameType,
    roomCode: state.roomCode,
    gameInstanceId: state.gameInstanceId,
    myName: state.myName,
    opponentName: state.opponentName,
    format: state.format,
    score: { ...state.score }
  };
}

export function validatedAtlasAuthoritativeMatchSignal(value: unknown): AtlasAuthoritativeMatchSignal | null {
  const record = readRecord(value);
  const score = readRecord(record?.score);
  const frameType = readString(record?.frameType) as AtlasAuthoritativeMatchFrameType;
  const roomCode = readString(record?.roomCode).toUpperCase();
  const gameInstanceId = readString(record?.gameInstanceId);
  const myName = boundedName(record?.myName);
  const opponentName = boundedName(record?.opponentName);
  const format = readString(record?.format);
  const me = validatedScoreString(score?.me);
  const opp = validatedScoreString(score?.opp);
  if (
    !record ||
    (!FULL_STATE_FRAME_TYPES.has(frameType) && frameType !== "authoritative_patch_commit") ||
    !roomCode ||
    roomCode.length > 80 ||
    gameInstanceId.length > 160 ||
    myName === null ||
    opponentName === null ||
    (format !== "" && format !== "Bo1" && format !== "Bo3") ||
    me === null ||
    opp === null
  ) {
    return null;
  }
  return {
    frameType,
    roomCode,
    gameInstanceId,
    myName,
    opponentName,
    format: format as AtlasAuthoritativeMatchState["format"],
    score: { me, opp }
  };
}

function parseScorePatch(
  packet: Record<string, unknown>,
  frameType: AtlasAuthoritativeMatchFrameType,
  localPlayerId: string,
  roomCode: string,
  current: AtlasAuthoritativeMatchState | null
): AtlasAuthoritativeMatchPatch | null {
  if (
    !current ||
    current.roomCode !== roomCode ||
    current.localPlayerId !== localPlayerId ||
    !current.opponentPlayerId
  ) {
    return null;
  }
  const gameInstanceId = readString(packet.gameInstanceId);
  if (gameInstanceId && current.gameInstanceId && gameInstanceId !== current.gameInstanceId) {
    return null;
  }
  const patch = readRecord(packet.patch);
  const operations = Array.isArray(patch?.operations) ? patch.operations : [];
  const score: Partial<AtlasAuthoritativeMatchScore> = {};
  for (const candidate of operations) {
    const operation = readRecord(candidate);
    if (readString(operation?.op) !== "set_board_fields") {
      continue;
    }
    const fields = readRecord(operation?.fields);
    const nextScore = validatedScoreNumber(fields?.score);
    const playerId = readString(operation?.playerId);
    if (nextScore === undefined) {
      continue;
    }
    if (playerId === current.localPlayerId) {
      score.me = String(nextScore);
    } else if (playerId === current.opponentPlayerId) {
      score.opp = String(nextScore);
    }
  }
  if (!Object.keys(score).length) {
    return null;
  }
  return {
    frameType,
    roomCode,
    gameInstanceId: gameInstanceId || current.gameInstanceId,
    localPlayerId,
    score
  };
}

type AuthoritativePlayer = {
  id: string;
  name: string;
  score?: number;
};

function collectAuthoritativePlayers(
  packet: Record<string, unknown>,
  sessionDoc: Record<string, unknown> | undefined,
  snapshot: Record<string, unknown> | undefined
): Map<string, AuthoritativePlayer> | null {
  const collections = [
    packet.players,
    sessionDoc?.players,
    sessionDoc?.publicPlayers,
    snapshot?.players,
    snapshot?.publicPlayers
  ].filter((value): value is unknown[] => Array.isArray(value));
  const records = [
    readRecord(packet.selfPlayer),
    readRecord(sessionDoc?.selfPlayer),
    readRecord(snapshot?.selfPlayer),
    ...collections.flatMap((items) => items.map(readRecord))
  ].filter((value): value is Record<string, unknown> => Boolean(value));
  const players = new Map<string, AuthoritativePlayer>();
  for (const record of records) {
    const id = readString(record.id) || readString(record.playerId);
    if (!id || id.length > 160) {
      continue;
    }
    const name = readPlayerName(record);
    const score = readPlayerScore(record);
    const existing = players.get(id);
    if (
      existing &&
      ((existing.name && name && existing.name !== name) ||
        (existing.score !== undefined && score !== undefined && existing.score !== score))
    ) {
      return null;
    }
    players.set(id, {
      id,
      name: name || existing?.name || "",
      score: score ?? existing?.score
    });
  }
  return players;
}

function atlasPacketIdentityMatchesSocket(
  sessionDoc: Record<string, unknown> | undefined,
  snapshot: Record<string, unknown> | undefined,
  localPlayerId: string
): boolean {
  const viewer = readRecord(sessionDoc?.viewer) ?? readRecord(snapshot?.viewer);
  const selfPlayer = readRecord(sessionDoc?.selfPlayer) ?? readRecord(snapshot?.selfPlayer);
  const viewerRole = readString(viewer?.role);
  const viewerPlayerId = readString(viewer?.playerId);
  const selfPlayerId = readString(selfPlayer?.id) || readString(selfPlayer?.playerId);
  return (!viewerRole || viewerRole === "player") &&
    (!viewerPlayerId || viewerPlayerId === localPlayerId) &&
    (!selfPlayerId || selfPlayerId === localPlayerId);
}

function readPlayerName(record: Record<string, unknown>): string {
  for (const value of [record.name, record.displayName, record.username, record.handle, record.playerName]) {
    const name = boundedName(value);
    if (name) return name;
  }
  return "";
}

function readPlayerScore(record: Record<string, unknown>): number | undefined {
  const board = readRecord(record.board);
  return validatedScoreNumber(board?.score) ?? validatedScoreNumber(record.score);
}

function normalizeAtlasMatchFormat(value: string): AtlasAuthoritativeMatchState["format"] {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized === "bo1" || normalized === "bestof1") return "Bo1";
  if (normalized === "bo3" || normalized === "bestof3") return "Bo3";
  return "";
}

function emptyAtlasAuthoritativeMatchState(): AtlasAuthoritativeMatchState {
  return {
    frameType: "room_shell_sync",
    roomCode: "",
    gameInstanceId: "",
    localPlayerId: "",
    opponentPlayerId: "",
    myName: "",
    opponentName: "",
    format: "",
    score: { me: "", opp: "" }
  };
}

function validatedScoreNumber(value: unknown): number | undefined {
  const score = typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(score) && score >= 0 && score <= 99 ? score : undefined;
}

function validatedScoreString(value: unknown): string | null {
  if (value === "") return "";
  if (typeof value !== "string" || !/^\d{1,2}$/.test(value)) return null;
  const score = Number.parseInt(value, 10);
  return score <= 99 ? String(score) : null;
}

function boundedName(value: unknown): string | null {
  if (typeof value !== "string") return value === undefined ? "" : null;
  const name = value.trim();
  return name.length <= 120 ? name : null;
}

function nonEmpty(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    return readRecord(JSON.parse(value)) ?? null;
  } catch {
    return null;
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
