const ATLAS_PLAY_ORIGIN = "https://play.riftatlas.com";
const ATLAS_REALTIME_HOST = "realtime.riftatlas-workers.com";

/**
 * A matchmaking signal can arrive while Atlas still reports its lobby URL.
 * Keep automatic recovery away from that guest long enough for a slow queue,
 * room allocation, and game navigation to finish.
 */
export const ATLAS_MATCHMAKING_RECOVERY_PROTECTION_MS = 10 * 60_000;

type Clock = () => number;

/**
 * Automatic recovery may only target Atlas's exact lobby surfaces. Query
 * parameters and fragments do not change the route, and Atlas's existing
 * locale convention permits /en and /en/lobby (including region variants).
 */
export function isAtlasAutomaticRecoveryLobbyUrl(value: unknown): boolean {
  const url = trustedAtlasPlayUrl(value);
  if (!url) {
    return false;
  }
  const pathname = stripAtlasLocalePrefix(normalizePathname(url.pathname));
  return pathname === "/" || pathname === "/lobby";
}

/** Atlas game and room routes are never safe automatic-recovery targets. */
export function isAtlasProtectedGameRouteUrl(value: unknown): boolean {
  const url = trustedAtlasPlayUrl(value);
  if (!url) {
    return false;
  }
  const pathname = stripAtlasLocalePrefix(normalizePathname(url.pathname));
  return /^\/(?:game|play|room)(?:\/|$)/i.test(pathname);
}

export interface AtlasAutomaticRecoveryEvidence {
  targetGuestId: number;
  currentGuestId: number | null;
  currentUrl: unknown;
  navigationCurrent: boolean;
  platformSwitchAllowed: boolean;
  protectedByGameEntry: boolean;
}

/**
 * Final fail-closed gate for every automatic Atlas mutation. Callers gather
 * live main-process evidence immediately before acting; any missing or stale
 * signal rejects the recovery.
 */
export function canStartAtlasAutomaticRecovery(
  evidence: AtlasAutomaticRecoveryEvidence
): boolean {
  return isValidGuestId(evidence.targetGuestId) &&
    evidence.currentGuestId === evidence.targetGuestId &&
    isAtlasAutomaticRecoveryLobbyUrl(evidence.currentUrl) &&
    evidence.navigationCurrent &&
    evidence.platformSwitchAllowed &&
    !evidence.protectedByGameEntry;
}

/**
 * Holds the narrow main-process safety state that is not visible in the page
 * URL: Atlas can begin matchmaking while its main frame remains on `/`.
 */
export class AtlasAutomaticRecoverySafetyFence {
  private readonly matchmakingProtectedUntilByGuest = new Map<number, number>();

  constructor(
    private readonly matchmakingProtectionMs = ATLAS_MATCHMAKING_RECOVERY_PROTECTION_MS,
    private readonly clock: Clock = Date.now
  ) {}

  /**
   * Observes a raw or parsed Atlas realtime frame. Matchmaking requires a
   * trusted `start`/`searching` signal; any structured match-room frame is
   * already authoritative evidence that Atlas is entering or running a game.
   */
  observeRealtimeFrame(
    guestId: number,
    requestUrl: unknown,
    frame: unknown,
    observedAt = this.clock()
  ): boolean {
    if (
      !isValidGuestId(guestId) ||
      !hasAtlasRealtimeProtectionSignal(requestUrl, frame)
    ) {
      return false;
    }

    const safeObservedAt = finiteTimestamp(observedAt, this.clock());
    const duration = Number.isFinite(this.matchmakingProtectionMs)
      ? Math.max(0, this.matchmakingProtectionMs)
      : ATLAS_MATCHMAKING_RECOVERY_PROTECTION_MS;
    const protectedUntil = safeObservedAt + duration;
    this.matchmakingProtectedUntilByGuest.set(
      guestId,
      Math.max(this.matchmakingProtectedUntilByGuest.get(guestId) ?? 0, protectedUntil)
    );
    return true;
  }

  /**
   * Protects explicit game routes indefinitely and a lobby guest temporarily
   * after trusted matchmaking activity. Expired transient state is pruned.
   */
  isProtected(guestId: number, currentUrl: unknown, observedAt = this.clock()): boolean {
    if (isAtlasProtectedGameRouteUrl(currentUrl)) {
      return true;
    }
    if (!isValidGuestId(guestId)) {
      return false;
    }

    const protectedUntil = this.matchmakingProtectedUntilByGuest.get(guestId) ?? 0;
    const safeObservedAt = finiteTimestamp(observedAt, this.clock());
    if (protectedUntil > safeObservedAt) {
      return true;
    }
    this.matchmakingProtectedUntilByGuest.delete(guestId);
    return false;
  }

  forget(guestId: number): void {
    this.matchmakingProtectedUntilByGuest.delete(guestId);
  }
}

function trustedAtlasPlayUrl(value: unknown): URL | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    return url.origin === ATLAS_PLAY_ORIGIN && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

function isAtlasRealtimeMatchmakingUrl(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "wss:" &&
      url.hostname.toLowerCase() === ATLAS_REALTIME_HOST &&
      url.port === "" &&
      !url.username &&
      !url.password &&
      /\/matchmaking(?:\/|$)/i.test(normalizePathname(url.pathname));
  } catch {
    return false;
  }
}

function isAtlasRealtimeMatchUrl(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "wss:" &&
      url.hostname.toLowerCase() === ATLAS_REALTIME_HOST &&
      url.port === "" &&
      !url.username &&
      !url.password &&
      /\/parties\/match\/(?:[^/]+)(?:\/|$)/i.test(normalizePathname(url.pathname));
  } catch {
    return false;
  }
}

function hasAtlasRealtimeProtectionSignal(requestUrl: unknown, frame: unknown): boolean {
  if (isAtlasRealtimeMatchmakingUrl(requestUrl)) {
    return hasMatchmakingProtectionSignal(frame);
  }
  return isAtlasRealtimeMatchUrl(requestUrl) && hasStructuredRealtimeFrame(frame);
}

function hasStructuredRealtimeFrame(value: unknown): boolean {
  let packet = value;
  for (let parseAttempt = 0; parseAttempt < 2 && typeof packet === "string"; parseAttempt += 1) {
    const text = packet.trim();
    if (!text || text.length > 1_500_000) {
      return false;
    }
    try {
      packet = JSON.parse(text) as unknown;
    } catch {
      return false;
    }
  }
  return Boolean(packet && typeof packet === "object");
}

function hasMatchmakingProtectionSignal(value: unknown): boolean {
  let packet = value;
  for (let parseAttempt = 0; parseAttempt < 2 && typeof packet === "string"; parseAttempt += 1) {
    const text = packet.trim();
    if (!text || text.length > 1_500_000) {
      return false;
    }
    try {
      packet = JSON.parse(text) as unknown;
    } catch {
      return false;
    }
  }
  return recordContainsMatchmakingSignal(packet, 0, new Set<object>());
}

function recordContainsMatchmakingSignal(value: unknown, depth: number, seen: Set<object>): boolean {
  if (!value || typeof value !== "object" || depth > 4 || seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((entry) => recordContainsMatchmakingSignal(entry, depth + 1, seen));
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
  if (type === "start" || type === "searching") {
    return true;
  }
  return Object.values(record).some((entry) => recordContainsMatchmakingSignal(entry, depth + 1, seen));
}

function normalizePathname(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function stripAtlasLocalePrefix(pathname: string): string {
  const localized = pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/i, "");
  return localized || "/";
}

function isValidGuestId(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function finiteTimestamp(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
