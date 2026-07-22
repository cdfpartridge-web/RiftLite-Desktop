import type { CaptureEvent, RawCaptureAppendFramePayload } from "./types.js";
import type { AtlasPlayerSeat } from "./atlasBattlefieldOwnership.js";

export interface AtlasSeatEvidence {
  gameInstanceId: string;
  roomCode: string;
  localPlayerId: string;
  firstPlayerId: string;
  wentFirst: "1st" | "2nd";
}

export interface AtlasPlayerSeatEvidence {
  frameType: "room_shell_sync" | "authoritative_snapshot";
  gameInstanceId: string;
  roomCode: string;
  localPlayerId: string;
  localSeat: AtlasPlayerSeat;
}

export const ATLAS_BATTLEFIELD_SEAT_IPC_CHANNEL = "atlas:battlefield-seat";

export interface AtlasBattlefieldSeatSignal {
  frameType: AtlasPlayerSeatEvidence["frameType"];
  gameInstanceId: string;
  roomCode: string;
  localSeat: AtlasPlayerSeat;
}

export class AtlasBattlefieldSeatSocketTracker {
  private currentSocketId = "";

  observeOpened(socketId: string, requestUrl: string): void {
    if (
      socketId &&
      /\/parties\/match\//i.test(requestUrl) &&
      atlasPlayerIdFromUrl(requestUrl)
    ) {
      this.currentSocketId = socketId;
    }
  }

  observeClosed(socketId: string): void {
    if (socketId && socketId === this.currentSocketId) {
      this.currentSocketId = "";
    }
  }

  isCurrent(socketId: string): boolean {
    return Boolean(socketId && socketId === this.currentSocketId);
  }
}

const ATLAS_PLAYER_SEAT_FRAME_TYPES = new Set(["room_shell_sync", "authoritative_snapshot"]);

export function parseAtlasPlayerSeatFrame(payload: RawCaptureAppendFramePayload): AtlasPlayerSeatEvidence | null {
  if (
    payload.platform !== "atlas" ||
    payload.frame.dir !== "in" ||
    !payload.frame.raw.includes("\"seat\"")
  ) {
    return null;
  }
  const packet = parseRecord(payload.frame.raw);
  const frameType = readString(packet?.type);
  if (!packet || !ATLAS_PLAYER_SEAT_FRAME_TYPES.has(frameType)) {
    return null;
  }
  const localPlayerId = atlasPlayerIdFromUrl(payload.requestUrl ?? "");
  if (!localPlayerId) {
    return null;
  }
  if (!atlasFrameIdentityMatchesSocket(packet, localPlayerId)) {
    return null;
  }
  const matchingSeats: AtlasPlayerSeat[] = [];
  for (const player of atlasPlayerRecords(packet)) {
    if ((readString(player.id) || readString(player.playerId)) !== localPlayerId) {
      continue;
    }
    const seat = readAtlasPlayerSeat(player.seat);
    if (seat !== null) {
      matchingSeats.push(seat);
    }
  }
  const uniqueSeats = [...new Set(matchingSeats)];
  if (uniqueSeats.length !== 1) {
    return null;
  }
  return {
    frameType: frameType as AtlasPlayerSeatEvidence["frameType"],
    gameInstanceId: atlasGameInstanceId(packet),
    roomCode: atlasRoomCode(packet, payload.requestUrl ?? ""),
    localPlayerId,
    localSeat: uniqueSeats[0]
  };
}

export function atlasBattlefieldSeatSignalFromFrame(
  payload: RawCaptureAppendFramePayload
): AtlasBattlefieldSeatSignal | null {
  const evidence = parseAtlasPlayerSeatFrame(payload);
  if (!evidence) {
    return null;
  }
  return {
    frameType: evidence.frameType,
    gameInstanceId: evidence.gameInstanceId,
    roomCode: evidence.roomCode,
    localSeat: evidence.localSeat
  };
}

export function validatedAtlasBattlefieldSeatSignal(value: unknown): AtlasBattlefieldSeatSignal | null {
  const record = readRecord(value);
  const frameType = readString(record?.frameType);
  const gameInstanceId = readString(record?.gameInstanceId);
  const roomCode = readString(record?.roomCode).toUpperCase();
  const localSeat = readAtlasPlayerSeat(record?.localSeat);
  if (
    !record ||
    !ATLAS_PLAYER_SEAT_FRAME_TYPES.has(frameType) ||
    !roomCode ||
    roomCode.length > 80 ||
    gameInstanceId.length > 160 ||
    localSeat === null
  ) {
    return null;
  }
  return {
    frameType: frameType as AtlasBattlefieldSeatSignal["frameType"],
    gameInstanceId,
    roomCode,
    localSeat
  };
}

export function parseAtlasSeatFrame(payload: RawCaptureAppendFramePayload): AtlasSeatEvidence | null {
  if (payload.platform !== "atlas" || !payload.frame.raw.includes("\"firstPlayerId\"")) {
    return null;
  }
  const packet = parseRecord(payload.frame.raw);
  if (!packet || readString(packet.type) !== "authoritative_patch_commit") {
    return null;
  }
  const action = readRecord(packet.action);
  if (readString(action?.type) !== "choose_first_player") {
    return null;
  }
  const firstPlayerId = readString(action?.firstPlayerId);
  const requestUrl = payload.requestUrl ?? "";
  const localPlayerId = atlasPlayerIdFromUrl(requestUrl);
  if (!firstPlayerId || !localPlayerId) {
    return null;
  }
  return {
    gameInstanceId: readString(packet.gameInstanceId),
    roomCode: atlasRoomCodeFromUrl(requestUrl),
    localPlayerId,
    firstPlayerId,
    wentFirst: firstPlayerId === localPlayerId ? "1st" : "2nd"
  };
}

export function atlasSeatCaptureEvent(payload: RawCaptureAppendFramePayload): CaptureEvent | null {
  const evidence = parseAtlasSeatFrame(payload);
  if (!evidence) {
    return null;
  }
  const capturedAt = new Date(
    Number.isFinite(payload.frame.ts) ? payload.frame.ts : Date.now()
  ).toISOString();
  const gameIdentity = evidence.gameInstanceId || evidence.roomCode || String(payload.frame.seq);
  return {
    id: `atlas-seat:${gameIdentity}:${evidence.wentFirst}`,
    platform: "atlas",
    kind: "match-update",
    capturedAt,
    url: evidence.roomCode
      ? `https://play.riftatlas.com/game/${encodeURIComponent(evidence.roomCode)}`
      : "https://play.riftatlas.com/game",
    payload: {
      active: true,
      reason: "atlas-websocket-seat",
      roomCode: evidence.roomCode,
      atlasGameInstanceId: evidence.gameInstanceId,
      wentFirst: evidence.wentFirst
    }
  };
}

export function atlasPlayerIdFromUrl(value: string): string {
  try {
    return new URL(value).searchParams.get("playerId")?.trim() ?? "";
  } catch {
    return decodeUrlValue(value.match(/[?&]playerId=([^&#]+)/i)?.[1] ?? "");
  }
}

export function atlasRoomCodeFromUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return (
      parsed.searchParams.get("roomCode") ||
      parsed.pathname.match(/\/parties\/match\/([^/?#]+)/i)?.[1] ||
      ""
    ).trim().toUpperCase();
  } catch {
    const raw = value.match(/[?&]roomCode=([^&#]+)/i)?.[1]
      || value.match(/\/parties\/match\/([^/?#]+)/i)?.[1]
      || "";
    return decodeUrlValue(raw).toUpperCase();
  }
}

function atlasPlayerRecords(packet: Record<string, unknown>): Record<string, unknown>[] {
  const payload = readRecord(packet.payload);
  const sessionDoc = readRecord(packet.sessionDoc) ?? readRecord(payload?.sessionDoc);
  const snapshot = readRecord(packet.snapshot) ?? readRecord(payload?.snapshot);
  const state = readRecord(packet.state) ?? readRecord(payload?.state);
  const room = readRecord(state?.room);
  const collections = [
    packet.players,
    sessionDoc?.players,
    sessionDoc?.publicPlayers,
    snapshot?.players,
    snapshot?.publicPlayers,
    state?.players,
    state?.publicPlayers,
    room?.players,
    room?.publicPlayers
  ].filter((value): value is unknown[] => Array.isArray(value));
  const directPlayers = [
    readRecord(packet.selfPlayer),
    readRecord(sessionDoc?.selfPlayer),
    readRecord(snapshot?.selfPlayer),
    readRecord(state?.selfPlayer),
    readRecord(room?.selfPlayer)
  ].filter((value): value is Record<string, unknown> => Boolean(value));
  return directPlayers.concat(
    collections.flatMap((players) => players.map(readRecord).filter(
      (value): value is Record<string, unknown> => Boolean(value)
    ))
  );
}

function atlasFrameIdentityMatchesSocket(packet: Record<string, unknown>, localPlayerId: string): boolean {
  const payload = readRecord(packet.payload);
  const sessionDoc = readRecord(packet.sessionDoc) ?? readRecord(payload?.sessionDoc);
  const snapshot = readRecord(packet.snapshot) ?? readRecord(payload?.snapshot);
  const viewer = readRecord(sessionDoc?.viewer) ?? readRecord(snapshot?.viewer);
  const selfPlayer = readRecord(sessionDoc?.selfPlayer) ?? readRecord(snapshot?.selfPlayer);
  const viewerPlayerId = readString(viewer?.playerId);
  const selfPlayerId = readString(selfPlayer?.id) || readString(selfPlayer?.playerId);
  return (!viewerPlayerId || viewerPlayerId === localPlayerId) &&
    (!selfPlayerId || selfPlayerId === localPlayerId);
}

function atlasGameInstanceId(packet: Record<string, unknown>): string {
  const payload = readRecord(packet.payload);
  const snapshot = readRecord(packet.snapshot) ?? readRecord(payload?.snapshot);
  const sessionDoc = readRecord(packet.sessionDoc) ?? readRecord(payload?.sessionDoc);
  return readString(packet.gameInstanceId) || readString(snapshot?.gameInstanceId) || readString(sessionDoc?.gameInstanceId);
}

function atlasRoomCode(packet: Record<string, unknown>, requestUrl: string): string {
  const payload = readRecord(packet.payload);
  const sessionDoc = readRecord(packet.sessionDoc) ?? readRecord(payload?.sessionDoc);
  const snapshot = readRecord(packet.snapshot) ?? readRecord(payload?.snapshot);
  return (
    readString(packet.roomCode) ||
    readString(sessionDoc?.roomCode) ||
    readString(snapshot?.roomCode) ||
    atlasRoomCodeFromUrl(requestUrl)
  ).toUpperCase();
}

function readAtlasPlayerSeat(value: unknown): AtlasPlayerSeat | null {
  if (value === 0 || value === "0") {
    return 0;
  }
  if (value === 1 || value === "1") {
    return 1;
  }
  return null;
}

function decodeUrlValue(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return readRecord(parsed) ?? null;
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
