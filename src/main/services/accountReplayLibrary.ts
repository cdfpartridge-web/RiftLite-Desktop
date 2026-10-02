import {
  ACCOUNT_REPLAY_LIBRARY_LIMIT,
  type AccountReplayLibraryItem,
  type AccountReplayLibraryResult
} from "../../shared/accountReplayLibrary.js";

const OWNER_LIBRARY_URL = `https://www.riftlite.com/api/v2/replays?scope=mine&limit=${ACCOUNT_REPLAY_LIBRARY_LIMIT}`;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface AccountReplayLibraryDependencies {
  getAccountUid(): string | Promise<string>;
  /** Must refresh credentials for this pinned account, rather than a newly linked account. */
  getAccessToken(expectedAccountUid: string): Promise<string | null>;
  fetchImpl?: typeof fetch;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}
function timestamp(value: unknown): string {
  return typeof value === "string" && value.length <= 80 && Number.isFinite(Date.parse(value)) ? value : "";
}
function captureIdentity(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
}

export function sanitizeAccountReplayLibraryItem(value: unknown): AccountReplayLibraryItem | null {
  if (!object(value) || typeof value.replayId !== "string" || !/^[a-zA-Z0-9_-]{1,180}$/.test(value.replayId)) return null;
  if (!["uploading", "processing", "ready", "failed", "pending"].includes(String(value.status))) return null;
  if (!["private", "unlisted", "public"].includes(String(value.visibility))) return null;
  const item: AccountReplayLibraryItem = {
    replayId: value.replayId,
    title: text(value.title) || "Recorded game",
    platform: text(value.platform, 24),
    status: value.status as AccountReplayLibraryItem["status"],
    visibility: value.visibility as AccountReplayLibraryItem["visibility"],
    // Never accept an arbitrary remote URL or credentials from the JSON payload.
    url: `https://www.riftlite.com/replays/${encodeURIComponent(value.replayId)}`,
    capturedAt: timestamp(value.capturedAt),
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt)
  };
  const captureId = captureIdentity(value.captureId);
  if (captureId) item.captureId = captureId;
  if (object(value.listing)) {
    const listing = value.listing;
    item.listing = {
      playerName: text(listing.playerName, 100), opponentName: text(listing.opponentName, 100),
      playerLegend: text(listing.playerLegend, 100), opponentLegend: text(listing.opponentLegend, 100),
      format: listing.format === "bo1" || listing.format === "bo3" ? listing.format : "unknown",
      result: listing.result === "win" || listing.result === "loss" || listing.result === "draw" ? listing.result : "unknown"
    };
  }
  if (Array.isArray(value.warnings)) {
    const warnings = value.warnings.slice(0, 12).flatMap((warning) => {
      const message = text(object(warning) ? warning.message : warning, 400);
      return message ? [message] : [];
    });
    if (warnings.length) item.warnings = warnings;
  }
  return item;
}

function unavailable(accountUid: string, error: string): AccountReplayLibraryResult {
  return { accountUid, available: false, items: [], limit: ACCOUNT_REPLAY_LIBRARY_LIMIT, mayHaveMore: false, error };
}

export async function loadAccountReplayLibrary(dependencies: AccountReplayLibraryDependencies): Promise<AccountReplayLibraryResult> {
  let expectedUid = "";
  let controller: AbortController | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const changed = () => unavailable("", "The linked account changed. Refresh to load its replays.");
  try {
    expectedUid = await dependencies.getAccountUid();
    if (!expectedUid) return unavailable("", "Sign in to see replays saved to your account.");
    const token = await dependencies.getAccessToken(expectedUid);
    if ((await dependencies.getAccountUid()) !== expectedUid) return changed();
    if (!token) return unavailable(expectedUid, "Reconnect your RiftLite account to load online replays.");
    controller = new AbortController();
    timeout = setTimeout(() => controller?.abort(), 15_000);
    const response = await (dependencies.fetchImpl || fetch)(OWNER_LIBRARY_URL, {
      method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: controller.signal
    });
    if ((await dependencies.getAccountUid()) !== expectedUid) return changed();
    if (!response.ok) {
      return unavailable(expectedUid, response.status === 401 || response.status === 403
        ? "Reconnect your RiftLite account to load online replays."
        : "Online replays could not be loaded. Your local recordings are still available. Try again shortly.");
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_RESPONSE_BYTES) return unavailable(expectedUid, "The online replay list could not be read. Try again shortly.");
    const body = await response.text();
    if ((await dependencies.getAccountUid()) !== expectedUid) return changed();
    if (body.length > MAX_RESPONSE_BYTES) return unavailable(expectedUid, "The online replay list could not be read. Try again shortly.");
    const payload: unknown = JSON.parse(body);
    if (!object(payload) || !Array.isArray(payload.items) || payload.scope !== "mine") {
      return unavailable(expectedUid, "The online replay list could not be read. Try again shortly.");
    }
    const items = [...new Map(payload.items.slice(0, ACCOUNT_REPLAY_LIBRARY_LIMIT)
      .map(sanitizeAccountReplayLibraryItem)
      .filter((item): item is AccountReplayLibraryItem => item !== null)
      .map((item) => [item.replayId, item])).values()];
    if (payload.items.length && !items.length) return unavailable(expectedUid, "The online replay list could not be read. Try again shortly.");
    return { accountUid: expectedUid, available: true, items, limit: ACCOUNT_REPLAY_LIBRARY_LIMIT,
      mayHaveMore: payload.items.length >= ACCOUNT_REPLAY_LIBRARY_LIMIT };
  } catch {
    // Errors can include request headers or credential internals; never return their text to the renderer.
    try { if (expectedUid && (await dependencies.getAccountUid()) !== expectedUid) return changed(); } catch { /* No identity is trusted after a failed identity read. */ }
    return unavailable(expectedUid, "Online replays could not be loaded. Your local recordings are still available. Reconnect your account or try again shortly.");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
