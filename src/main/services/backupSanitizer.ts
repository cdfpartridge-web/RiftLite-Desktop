import type { CaptureEvent, MatchDraft, ReplayRecord, RiftLiteBackupFile } from "../../shared/types.js";
import { redactSensitiveSettings } from "./secureCredentialVault.js";

const SENSITIVE_KEY_PARTS = ["password", "secret", "apikey", "authorization", "credential"];
const SENSITIVE_TOKEN_KEYS = new Set([
  "token",
  "authtoken",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "csrftoken",
  "xsrftoken",
  "oauthtoken",
  "oauthcode"
]);
const NETWORK_CONTAINER_KEYS = new Set([
  "headers",
  "requestheaders",
  "responseheaders",
  "cookies",
  "requestcookies",
  "responsecookies",
  "cookie",
  "setcookie"
]);
const NETWORK_BODY_KEYS = new Set([
  "body",
  "raw",
  "rawbody",
  "requestbody",
  "responsebody",
  "requestraw",
  "responseraw",
  "requestdata",
  "responsedata",
  "networkbody",
  "rawpayload",
  "networkpayload"
]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string, value: unknown): boolean {
  const normalized = normalizedKey(key);
  if (SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))) {
    return true;
  }
  if (normalized === "token") {
    // Preserve structured game-token objects while removing bearer/session
    // token strings from older capture evidence.
    return typeof value !== "object" || value === null || Array.isArray(value);
  }
  if (SENSITIVE_TOKEN_KEYS.has(normalized)) {
    return true;
  }
  return normalized.endsWith("token") && normalized !== "gametoken";
}

function withoutUrlSecrets(value: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
      return value;
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function sanitizeCaptureValue(value: unknown, key = ""): unknown {
  const normalized = normalizedKey(key);
  if (
    isSensitiveKey(key, value) ||
    NETWORK_CONTAINER_KEYS.has(normalized) ||
    NETWORK_BODY_KEYS.has(normalized)
  ) {
    return undefined;
  }
  if (typeof value === "string") {
    return normalized.includes("url") || normalized.includes("uri")
      ? withoutUrlSecrets(value)
      : value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeCaptureValue(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([nestedKey, nestedValue]) => [nestedKey, sanitizeCaptureValue(nestedValue, nestedKey)] as const)
        .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined)
    );
  }
  return value;
}

export function sanitizeBackupCaptureEvent(event: CaptureEvent): CaptureEvent {
  return {
    ...event,
    url: withoutUrlSecrets(event.url),
    payload: sanitizeCaptureValue(event.payload) as Record<string, unknown>
  };
}

function sanitizeBackupMatch(match: MatchDraft): MatchDraft {
  return {
    ...match,
    rawEvidence: (match.rawEvidence ?? []).map(sanitizeBackupCaptureEvent)
  };
}

function sanitizeBackupReplay(replay: ReplayRecord): ReplayRecord {
  return {
    ...replay,
    events: (replay.events ?? []).map(sanitizeBackupCaptureEvent),
    matchSnapshot: replay.matchSnapshot ? sanitizeBackupMatch(replay.matchSnapshot) : undefined
  };
}

/**
 * Removes device/authentication material without anonymising user-owned match
 * content. Names, notes and structured gameplay remain restoreable.
 */
export function sanitizeBackupFile(backup: RiftLiteBackupFile): RiftLiteBackupFile {
  return {
    ...backup,
    settings: redactSensitiveSettings(backup.settings),
    matches: backup.matches.map(sanitizeBackupMatch),
    deletedMatches: backup.deletedMatches.map(sanitizeBackupMatch),
    replays: backup.replays.map(sanitizeBackupReplay),
    deletedReplays: backup.deletedReplays.map(sanitizeBackupReplay)
  };
}
