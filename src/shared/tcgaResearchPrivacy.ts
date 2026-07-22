export const TCGA_RESEARCH_REDACTED_SECRET = "[REDACTED_SECRET]";
export const TCGA_RESEARCH_REDACTED_NETWORK_METADATA = "[REDACTED_NETWORK_METADATA]";
export const TCGA_RESEARCH_REDACTED_LOCAL_PATH = "[REDACTED_LOCAL_PATH]";

const NETWORK_METADATA_KEYS = new Set([
  "cookie",
  "cookies",
  "headers",
  "requestcookie",
  "requestcookies",
  "requestheaders",
  "responsecookie",
  "responsecookies",
  "responseheaders",
  "setcookie"
]);

const JSON_BODY_KEYS = new Set([
  "body",
  "data",
  "payloadData",
  "raw",
  "requestBody",
  "requestData",
  "responseBody",
  "responseData"
].map(normalizedKey));

const EXPLICIT_SECRET_KEYS = new Set([
  "accesstoken",
  "apikey",
  "auth",
  "authorization",
  "authcode",
  "authtoken",
  "bearertoken",
  "credential",
  "credentials",
  "csrftoken",
  "idtoken",
  "oauthcode",
  "oauthtoken",
  "password",
  "passwd",
  "privatekey",
  "refreshtoken",
  "secret",
  "secretkey",
  "sessiontoken",
  "token",
  "webhook",
  "xsrftoken"
]);

const URL_KEY_SUFFIXES = ["endpoint", "href", "uri", "url"];
const MAX_SANITIZE_DEPTH = 64;

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isNetworkMetadataKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return NETWORK_METADATA_KEYS.has(normalized) ||
    normalized.endsWith("headers") ||
    normalized.endsWith("cookies") ||
    normalized.endsWith("cookie");
}

function isSecretKey(key: string, value: unknown): boolean {
  const normalized = normalizedKey(key);
  if (EXPLICIT_SECRET_KEYS.has(normalized)) {
    // TCGA can legitimately describe gameplay tokens as structured objects.
    // Preserve those objects while still removing bearer/session token strings.
    return normalized !== "token" || typeof value !== "object" || value === null || Array.isArray(value);
  }
  return normalized.includes("password") ||
    normalized.includes("passwd") ||
    normalized.includes("secret") ||
    normalized.includes("authorization") ||
    normalized.includes("credential") ||
    normalized.includes("apikey") ||
    normalized.includes("webhooksecret") ||
    (normalized.endsWith("token") && !(
      ["actiontoken", "cardtoken", "gametoken"].includes(normalized) &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ));
}

function isUrlKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return URL_KEY_SUFFIXES.some((suffix) => normalized === suffix || normalized.endsWith(suffix));
}

function secretMarker(value: unknown): string {
  if (typeof value === "string") {
    return `${TCGA_RESEARCH_REDACTED_SECRET.slice(0, -1)}; length=${value.length}]`;
  }
  if (Array.isArray(value)) {
    return `${TCGA_RESEARCH_REDACTED_SECRET.slice(0, -1)}; items=${value.length}]`;
  }
  return TCGA_RESEARCH_REDACTED_SECRET;
}

/**
 * Keeps the origin and path needed to identify TCGA/Firebase transports while
 * removing credentials, query parameters, and fragments.
 */
export function sanitizeTcgaResearchUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "file:") {
      return TCGA_RESEARCH_REDACTED_LOCAL_PATH;
    }
    if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
      return value.split(/[?#]/, 1)[0];
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

function sanitizeLocalPaths(value: string): string {
  return value
    .replace(/[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\\\s"']+(?:\\[^\s"']*)?/gi, TCGA_RESEARCH_REDACTED_LOCAL_PATH)
    .replace(/\/(?:Users|home)\/[^/\s"']+(?:\/[^\s"']*)?/g, TCGA_RESEARCH_REDACTED_LOCAL_PATH)
    .replace(/file:\/{2,3}[^\s"'<>]+/gi, TCGA_RESEARCH_REDACTED_LOCAL_PATH);
}

function sanitizeString(value: string, key: string): string {
  if (/^(?:[A-Za-z]:\\|\/(?:Users|home)\/|file:\/{2,3})/i.test(value.trim())) {
    return TCGA_RESEARCH_REDACTED_LOCAL_PATH;
  }
  let safe = isUrlKey(key) ? sanitizeTcgaResearchUrl(value) : value;
  safe = sanitizeLocalPaths(safe);
  safe = safe.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED_SECRET]");
  safe = safe.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, TCGA_RESEARCH_REDACTED_SECRET);
  safe = safe.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, (candidate) => sanitizeTcgaResearchUrl(candidate));
  safe = safe.replace(/([?&](?:access_?token|api_?key|auth|code|key|refresh_?token|secret|session|token)=)[^&#\s]+/gi, "$1[REDACTED_SECRET]");
  safe = safe.replace(/\b(?:access_?token|refresh_?token|id_?token|api_?key|authorization|password|secret|token)\s*[:=]\s*[^,;\s]+/gi, (match) => {
    const separator = match.match(/\s*[:=]\s*/)?.[0] ?? "=";
    return `${match.split(/\s*[:=]\s*/, 1)[0]}${separator}${TCGA_RESEARCH_REDACTED_SECRET}`;
  });
  safe = safe.replace(/\b(?:cookie|set-cookie)\s*[:=]\s*[^;\r\n]+/gi, (match) => {
    const separator = match.match(/\s*[:=]\s*/)?.[0] ?? "=";
    return `${match.split(/\s*[:=]\s*/, 1)[0]}${separator}${TCGA_RESEARCH_REDACTED_NETWORK_METADATA}`;
  });
  return safe;
}

function sanitizeValue(
  value: unknown,
  key: string,
  seen: WeakSet<object>,
  depth: number
): unknown {
  if (isNetworkMetadataKey(key)) {
    return TCGA_RESEARCH_REDACTED_NETWORK_METADATA;
  }
  if (isSecretKey(key, value)) {
    return secretMarker(value);
  }
  if (typeof value === "string") {
    if (JSON_BODY_KEYS.has(normalizedKey(key)) && /^[\[{]/.test(value.trim())) {
      try {
        const parsed = JSON.parse(value) as unknown;
        return JSON.stringify(sanitizeValue(parsed, "", seen, depth + 1));
      } catch {
        // Non-JSON protocol text is sanitized with the bounded string rules.
      }
    }
    return sanitizeString(value, key);
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (depth >= MAX_SANITIZE_DEPTH) {
    return "[TRUNCATED_DEPTH]";
  }
  if (seen.has(value)) {
    return "[REDACTED_CIRCULAR_REFERENCE]";
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, key, seen, depth + 1));
    }
    const record = value as Record<string, unknown>;
    const exactBase64Data = record.encoding === "base64" &&
      typeof record.data === "string" &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(record.data);
    return Object.fromEntries(
      Object.entries(record)
        .map(([childKey, childValue]) => [
          childKey,
          exactBase64Data && childKey === "data"
            ? childValue
            : sanitizeValue(childValue, childKey, seen, depth + 1)
        ])
    );
  } finally {
    seen.delete(value);
  }
}

/**
 * Removes authentication and machine-local material without anonymising the
 * gameplay evidence needed to build a TCGA replay normalizer.
 */
export function sanitizeTcgaResearchValue<T>(value: T): T {
  return sanitizeValue(value, "", new WeakSet<object>(), 0) as T;
}
