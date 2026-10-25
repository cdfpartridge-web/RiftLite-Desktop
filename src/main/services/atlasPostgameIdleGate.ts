// These packets keep an existing room connected or update social UI. They do
// not start a game or mutate its board. Unknown protocol messages stay active.
const HOUSEKEEPING_TYPES = new Set([
  "ping", "pong", "auth_refresh", "auth_session",
  "presence_update", "presence_event", "chat_send", "chat_sync", "chat_append"
]);
const MAX_HOUSEKEEPING_FRAME_LENGTH = 8_192;
const HOUSEKEEPING_TYPE_IN_JSON = /"type"\s*:\s*"(?:ping|pong|auth_refresh|auth_session|presence_update|presence_event|chat_send|chat_sync|chat_append)"/;

/** Quiet post-game work must never compete with capture, matchmaking or startup. */
export class AtlasPostgameIdleGate {
  private idleAfter: number;
  constructor(private readonly now: () => number = Date.now, private readonly quietMs = 15_000) {
    this.idleAfter = now() + quietMs;
  }
  observeActivity(): void { this.idleAfter = this.now() + this.quietMs; }
  /**
   * Call only after the existing recovery fence has established trusted Atlas
   * room/matchmaking traffic. Recovery intentionally treats all room traffic
   * as protection against a reload; post-game work must not inherit that rule.
   * Returns true only when the caller must cancel an in-flight collection.
   */
  observeRealtimeActivity(frame: unknown): boolean {
    if (isHousekeepingFrame(frame)) return false;
    this.observeActivity();
    return true;
  }
  allows(input: { trusted: boolean; loading: boolean; capturing: boolean; platformSwitchAllowed: boolean; url: string }): boolean {
    if (!input.trusted || input.loading || input.capturing || !input.platformSwitchAllowed || this.now() < this.idleAfter) return false;
    try {
      const url = new URL(input.url);
      const path = url.pathname.replace(/^\/(?:en|zh-CN|fr|ko)(?=\/|$)/, "") || "/";
      return url.origin === "https://play.riftatlas.com" && !url.username && !url.password && (
        ["/", "/lobby", "/game"].includes(path.replace(/\/$/, "") || "/") || isAtlasReplayPath(path)
      );
    } catch { return false; }
  }
}

function isHousekeepingFrame(frame: unknown): boolean {
  let packet = frame;
  if (typeof packet === "string") {
    // No extra full snapshot/patch parse on the gameplay path. Only small
    // packets naming a known housekeeping type enter this bounded parse.
    if (packet.length > MAX_HOUSEKEEPING_FRAME_LENGTH || !HOUSEKEEPING_TYPE_IN_JSON.test(packet)) return false;
    try { packet = JSON.parse(packet) as unknown; } catch { return false; }
  }
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) return false;
  const value = packet as Record<string, unknown>;
  return typeof value.type === "string" && HOUSEKEEPING_TYPES.has(value.type) &&
    !["action", "snapshot", "patch", "sessionDoc", "operations"].some((key) => Object.hasOwn(value, key));
}

function isAtlasReplayPath(path: string): boolean {
  const route = /^\/replays\/([^/]+)$/.exec(path);
  if (!route) return false;
  try {
    const key = /^([A-Z0-9]{3,16}):(\d{13}):([1-3]):(\d{13})$/.exec(decodeURIComponent(route[1]));
    if (!key) return false;
    const createdAt = Number(key[2]);
    const startedAt = Number(key[4]);
    return createdAt > 1_500_000_000_000 && startedAt < 4_000_000_000_000 && startedAt >= createdAt;
  } catch { return false; }
}
