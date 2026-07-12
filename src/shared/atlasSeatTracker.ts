import type { CaptureEvent, RawCaptureAppendFramePayload } from "./types.js";

export interface AtlasSeatEvidence {
  gameInstanceId: string;
  roomCode: string;
  localPlayerId: string;
  firstPlayerId: string;
  wentFirst: "1st" | "2nd";
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
  const localPlayerId = playerIdFromAtlasUrl(requestUrl);
  if (!firstPlayerId || !localPlayerId) {
    return null;
  }
  return {
    gameInstanceId: readString(packet.gameInstanceId),
    roomCode: roomCodeFromAtlasUrl(requestUrl),
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

function playerIdFromAtlasUrl(value: string): string {
  try {
    return new URL(value).searchParams.get("playerId")?.trim() ?? "";
  } catch {
    return decodeUrlValue(value.match(/[?&]playerId=([^&#]+)/i)?.[1] ?? "");
  }
}

function roomCodeFromAtlasUrl(value: string): string {
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
