import type { CaptureDiagnosticsSummary, CaptureEvent } from "./types.js";

export const DIAGNOSTIC_REDACTION_VERSION = 1;
export const DIAGNOSTIC_REDACTED_VALUE = "[REDACTED]";

export interface DiagnosticBundleDocument {
  privacy: {
    sensitiveDataIncluded: boolean;
    redactionVersion: number;
    notice: string;
  };
  summary: CaptureDiagnosticsSummary;
  events: CaptureEvent[];
}

const NAME_KEYS = new Set([
  "accountname",
  "captureplayer",
  "capturedplayer",
  "displayname",
  "email",
  "handle",
  "mydisplayname",
  "myname",
  "nickname",
  "opponent",
  "opponentdisplayname",
  "opponentname",
  "player",
  "playerdisplayname",
  "playername",
  "screenname",
  "username"
]);
const ROOM_KEYS = new Set(["invitecode", "lobbycode", "room", "roomcode", "roomcodes"]);
const UNSTRUCTURED_KEYS = new Set([
  "authorization",
  "body",
  "cookie",
  "cookies",
  "documenthtml",
  "headers",
  "html",
  "innerhtml",
  "outerhtml",
  "raw",
  "requestbody",
  "requesttext",
  "responsebody",
  "responsetext"
]);

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSecretKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("passwd") ||
    normalized.includes("apikey") ||
    normalized.includes("webhook") ||
    normalized.includes("credential") ||
    normalized.includes("sessionid") ||
    normalized === "authcode" ||
    normalized === "authorization";
}

function isNameKey(key: string): boolean {
  return NAME_KEYS.has(normalizedKey(key));
}

function isRoomKey(key: string): boolean {
  return ROOM_KEYS.has(normalizedKey(key));
}

function isUrlKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return normalized === "url" || normalized.endsWith("url") || normalized === "sourceid";
}

function isLocalPathKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return normalized === "path" ||
    normalized.endsWith("path") ||
    normalized === "directory" ||
    normalized.endsWith("directory") ||
    normalized === "preloadfile";
}

function sensitiveMarker(value: unknown, label = "REDACTED"): string {
  if (typeof value === "string") {
    return `[${label}; length=${value.length}]`;
  }
  if (Array.isArray(value)) {
    return `[${label}; items=${value.length}]`;
  }
  return `[${label}]`;
}

function collectSensitiveStrings(value: unknown, key = "", result = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if ((isNameKey(key) || isRoomKey(key) || isSecretKey(key)) && value.trim().length >= 2) {
      result.add(value.trim());
    }
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSensitiveStrings(item, key, result);
    }
    return result;
  }
  if (!value || typeof value !== "object") {
    return result;
  }
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    collectSensitiveStrings(childValue, childKey, result);
  }
  return result;
}

function replaceSensitiveStrings(value: string, sensitiveStrings: readonly string[]): string {
  let safe = value;
  for (const sensitive of sensitiveStrings) {
    if (sensitive.length >= 2) {
      safe = safe.split(sensitive).join(DIAGNOSTIC_REDACTED_VALUE);
    }
  }
  return safe;
}

export function sanitizeDiagnosticUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "file:") {
      return "file:///[REDACTED_LOCAL_PATH]";
    }
    if (parsed.protocol === "mailto:") {
      return "mailto:[REDACTED_EMAIL]";
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    const segments = parsed.pathname.split("/");
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (/^(?:game|invite|join|room|session)$/i.test(segments[index])) {
        segments[index + 1] = DIAGNOSTIC_REDACTED_VALUE;
      }
    }
    parsed.pathname = segments.join("/");
    return parsed.toString();
  } catch {
    return value.split(/[?#]/, 1)[0].slice(0, 500);
  }
}

function sanitizeString(value: string, key: string, sensitiveStrings: readonly string[]): string {
  if (isLocalPathKey(key)) {
    return "[REDACTED_LOCAL_PATH]";
  }
  let safe = isUrlKey(key) ? sanitizeDiagnosticUrl(value) : value;
  safe = safe.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED_TOKEN]");
  safe = safe.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_TOKEN]");
  safe = safe.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
  safe = safe.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeDiagnosticUrl(url));
  safe = safe.replace(/([?&](?:access_?token|auth|code|key|refresh_?token|secret|session|token)=)[^&#\s]+/gi, "$1[REDACTED]");
  safe = safe.replace(/\b(?:access_?token|refresh_?token|id_?token|api_?key|authorization)\s*[:=]\s*[^,;\s]+/gi, (match) => {
    const separator = match.match(/\s*[:=]\s*/)?.[0] ?? "=";
    return `${match.split(/\s*[:=]\s*/, 1)[0]}${separator}[REDACTED]`;
  });
  safe = safe.replace(/[A-Za-z]:\\Users\\[^\\\s]+\\[^\s"']*/gi, "[REDACTED_LOCAL_PATH]");
  return replaceSensitiveStrings(safe, sensitiveStrings);
}

function redactValue(value: unknown, key: string, sensitiveStrings: readonly string[]): unknown {
  if (isNameKey(key) || isRoomKey(key) || isSecretKey(key)) {
    return sensitiveMarker(value);
  }
  if (UNSTRUCTURED_KEYS.has(normalizedKey(key))) {
    return sensitiveMarker(value, "REDACTED_RAW_DATA");
  }
  if (typeof value === "string") {
    return sanitizeString(value, key, sensitiveStrings);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key, sensitiveStrings));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey, sensitiveStrings)])
  );
}

export function redactDiagnosticValue<T>(value: T): T {
  const sensitiveStrings = [...collectSensitiveStrings(value)].sort((left, right) => right.length - left.length);
  return redactValue(value, "", sensitiveStrings) as T;
}

export function diagnosticBundleDocument(
  summary: CaptureDiagnosticsSummary,
  events: CaptureEvent[],
  includeSensitiveData = false
): DiagnosticBundleDocument {
  if (includeSensitiveData) {
    return {
      privacy: {
        sensitiveDataIncluded: true,
        redactionVersion: DIAGNOSTIC_REDACTION_VERSION,
        notice: "Explicit sensitive-data export. This file may contain account names, room codes, URLs, tokens, and raw capture payloads."
      },
      summary,
      events
    };
  }
  const combined = redactDiagnosticValue({ summary, events });
  return {
    privacy: {
      sensitiveDataIncluded: false,
      redactionVersion: DIAGNOSTIC_REDACTION_VERSION,
      notice: "Privacy-safe export. Identifying values, secrets, local paths, URL queries, and raw payloads were redacted."
    },
    summary: combined.summary,
    events: combined.events
  };
}
