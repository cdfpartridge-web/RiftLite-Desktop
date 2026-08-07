import type {
  AtlasConnectionCheck,
  AtlasConnectionDiagnostics
} from "../../shared/types.js";

const ATLAS_PAGE_URL = "https://play.riftatlas.com/";
const DEFAULT_TIMEOUT_MS = 12_000;
const APP_SCRIPT_PROBE_MAX_BYTES = 16_384;
const APP_SCRIPT_MIN_CONTENT_LENGTH = 64;
const JAVASCRIPT_MIME_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript"
]);
const ALLOWED_DIAGNOSTIC_ORIGINS = new Set([
  "https://play.riftatlas.com",
  "https://clerk.riftatlas.com",
  "https://accounts.riftatlas.com",
  "https://assets.riftatlas-workers.com"
]);

export type AtlasDiagnosticFetch = (url: string, init: RequestInit) => Promise<Response>;

export function emptyAtlasConnectionDiagnostics(): AtlasConnectionDiagnostics {
  return {
    state: "not-tested",
    message: "Run the connection test to check Atlas, its app code, sign-in service, and asset host.",
    testedAt: "",
    checks: [],
    recentFailures: [],
    guestAttached: false,
    guestUrl: ""
  };
}

export async function runAtlasConnectionTest(
  fetcher: AtlasDiagnosticFetch,
  options: { timeoutMs?: number; now?: () => number } = {}
): Promise<AtlasConnectionDiagnostics> {
  const timeoutMs = Math.max(1_000, Math.min(30_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const now = options.now ?? Date.now;
  const page = await checkResource("page", "Atlas page", ATLAS_PAGE_URL, fetcher, timeoutMs, now, true);
  const checks: AtlasConnectionCheck[] = [page.check];

  if (!page.check.ok || !page.body) {
    return diagnosticsResult(
      "failed",
      "The Atlas page could not be reached from its embedded session. Check the connection, VPN, DNS, firewall, or security software.",
      checks
    );
  }

  const resources = atlasCriticalResourceUrls(page.body);
  const resourceChecks = await Promise.all([
    checkAdvertisedResource("app-script", "Atlas application code", resources.appScript, fetcher, timeoutMs, now),
    checkAdvertisedResource("auth-script", "Atlas sign-in service", resources.authScript, fetcher, timeoutMs, now),
    checkAdvertisedResource("assets", "Atlas asset host", resources.asset, fetcher, timeoutMs, now)
  ]);
  checks.push(...resourceChecks.map((result) => result.check));

  const appCheck = checks.find((check) => check.id === "app-script");
  const authCheck = checks.find((check) => check.id === "auth-script");
  const assetCheck = checks.find((check) => check.id === "assets");
  if (!appCheck?.ok) {
    return diagnosticsResult(
      "failed",
      "Atlas HTML loaded, but its application code did not. This produces the static-introduction or empty-lobby failure; try Refresh runtime, then check filtering or security software.",
      checks
    );
  }
  if (!authCheck?.ok) {
    return diagnosticsResult(
      "partial",
      "Atlas application code is reachable, but its sign-in service is blocked or unavailable. Sign-in may fail until that host is allowed.",
      checks
    );
  }
  if (!assetCheck?.ok) {
    return diagnosticsResult(
      "partial",
      "Atlas and sign-in are reachable, but the Atlas asset host is blocked or unavailable. Cards and game artwork may not load correctly.",
      checks
    );
  }
  return diagnosticsResult(
    "ready",
    "Atlas, its application code, sign-in service, and asset host are all reachable from RiftLite.",
    checks
  );
}

export function atlasCriticalResourceUrls(html: string): {
  appScript: string;
  authScript: string;
  asset: string;
} {
  const sources = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => allowedDiagnosticUrl(match[1]))
    .filter((value): value is URL => Boolean(value));
  const appScripts = sources.filter((url) => (
    url.origin === "https://play.riftatlas.com" && /\/_next\/static\/.*\.js$/i.test(url.pathname)
  ));
  return {
    // Next.js advertises bootstrap chunks first and route/application chunks
    // later. Probe the final advertised script so a healthy bootstrap cannot
    // hide a blocked page chunk behind an HTTP 200 diagnostic.
    appScript: appScripts[appScripts.length - 1]?.toString() ?? "",
    authScript: sources.find((url) => (
      url.origin === "https://clerk.riftatlas.com" || url.origin === "https://accounts.riftatlas.com"
    ) && /\.js$/i.test(url.pathname))?.toString() ?? "",
    asset: sources.find((url) => url.origin === "https://assets.riftatlas-workers.com")?.toString() ?? ""
  };
}

async function checkAdvertisedResource(
  id: AtlasConnectionCheck["id"],
  label: string,
  url: string,
  fetcher: AtlasDiagnosticFetch,
  timeoutMs: number,
  now: () => number
): Promise<{ check: AtlasConnectionCheck; body: string }> {
  if (!url) {
    return {
      check: {
        id,
        label,
        origin: expectedOrigin(id),
        ok: false,
        durationMs: 0,
        error: "The Atlas page did not advertise this required resource."
      },
      body: ""
    };
  }
  return checkResource(id, label, url, fetcher, timeoutMs, now, false);
}

async function checkResource(
  id: AtlasConnectionCheck["id"],
  label: string,
  url: string,
  fetcher: AtlasDiagnosticFetch,
  timeoutMs: number,
  now: () => number,
  captureText: boolean
): Promise<{ check: AtlasConnectionCheck; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = now();
  try {
    const response = await fetcher(url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      signal: controller.signal
    });
    let body = "";
    let validationError = "";
    if (captureText) {
      body = (await response.text()).slice(0, 750_000);
    } else if (id === "app-script" && response.ok) {
      const probe = await readBoundedBody(response, APP_SCRIPT_PROBE_MAX_BYTES);
      validationError = validateAppScriptResponse(response, probe.text);
    } else {
      await response.body?.cancel().catch(() => undefined);
    }
    const ok = response.ok && !validationError;
    return {
      check: {
        id,
        label,
        origin: new URL(url).origin,
        ok,
        statusCode: response.status,
        durationMs: Math.max(0, now() - startedAt),
        ...(!response.ok
          ? { error: `HTTP ${response.status}` }
          : validationError
            ? { error: validationError }
            : {})
      },
      body
    };
  } catch (error) {
    return {
      check: {
        id,
        label,
        origin: safeOrigin(url),
        ok: false,
        durationMs: Math.max(0, now() - startedAt),
        error: diagnosticError(error, controller.signal.aborted)
      },
      body: ""
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<{ text: string }> {
  if (!response.body) return { text: "" };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;
  let finished = false;
  try {
    while (bytesRead < maxBytes) {
      const result = await reader.read();
      if (result.done) {
        finished = true;
        break;
      }
      const remaining = maxBytes - bytesRead;
      const chunk = result.value.byteLength > remaining
        ? result.value.subarray(0, remaining)
        : result.value;
      bytesRead += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
      if (result.value.byteLength > remaining) break;
    }
    text += decoder.decode();
    return { text };
  } finally {
    if (!finished) {
      await reader.cancel().catch(() => undefined);
    }
  }
}

function validateAppScriptResponse(response: Response, body: string): string {
  const mimeType = diagnosticMimeType(response.headers.get("content-type"));
  if (!mimeType) {
    return "The Atlas application response did not include a JavaScript content type.";
  }
  if (!JAVASCRIPT_MIME_TYPES.has(mimeType)) {
    return `The Atlas application response used a non-JavaScript content type (${mimeType}).`;
  }

  const content = body.replace(/^\uFEFF/, "").trim();
  if (content.length < APP_SCRIPT_MIN_CONTENT_LENGTH) {
    return `The Atlas application response body was too small (${content.length} characters; minimum ${APP_SCRIPT_MIN_CONTENT_LENGTH}).`;
  }
  const leadingMarkup = content.slice(0, 2_048);
  if (
    /^(?:<!--[\s\S]*?-->\s*)*<(?:!doctype\s+html|html|head|body|script|meta|title)\b/i.test(leadingMarkup) ||
    (/<html(?:\s|>)/i.test(leadingMarkup) && /<(?:head|body)(?:\s|>)/i.test(leadingMarkup))
  ) {
    return "The Atlas application response contained HTML instead of JavaScript.";
  }
  return "";
}

function diagnosticMimeType(value: string | null): string {
  const mimeType = (value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType)) {
    return mimeType ? "unrecognized" : "";
  }
  return mimeType.slice(0, 80);
}

function diagnosticsResult(
  state: AtlasConnectionDiagnostics["state"],
  message: string,
  checks: AtlasConnectionCheck[]
): AtlasConnectionDiagnostics {
  return {
    state,
    message,
    testedAt: new Date().toISOString(),
    checks,
    recentFailures: [],
    guestAttached: false,
    guestUrl: ""
  };
}

function allowedDiagnosticUrl(value: string): URL | null {
  try {
    const url = new URL(value, ATLAS_PAGE_URL);
    return url.protocol === "https:" && ALLOWED_DIAGNOSTIC_ORIGINS.has(url.origin) ? url : null;
  } catch {
    return null;
  }
}

function expectedOrigin(id: AtlasConnectionCheck["id"]): string {
  if (id === "auth-script") return "https://clerk.riftatlas.com";
  if (id === "assets") return "https://assets.riftatlas-workers.com";
  return "https://play.riftatlas.com";
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function diagnosticError(error: unknown, timedOut: boolean): string {
  if (timedOut) return "Connection timed out.";
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/[^\s]+/gi, "[redacted-url]").slice(0, 240) || "Connection failed.";
}
