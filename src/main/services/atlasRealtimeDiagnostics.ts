import { Buffer } from "node:buffer";

type AtlasRealtimeRoute = "match" | "matchmaking" | "account" | "other";
const NETWORK_ERRORS = [
  "net::ERR_CONNECTION_CLOSED",
  "net::ERR_CONNECTION_RESET",
  "net::ERR_CONNECTION_ABORTED",
  "net::ERR_CONNECTION_REFUSED",
  "net::ERR_CONNECTION_TIMED_OUT",
  "net::ERR_TIMED_OUT",
  "net::ERR_NETWORK_CHANGED",
  "net::ERR_INTERNET_DISCONNECTED",
  "net::ERR_NAME_NOT_RESOLVED",
  "net::ERR_SSL_PROTOCOL_ERROR",
  "net::ERR_CERT_DATE_INVALID",
  "net::ERR_CERT_AUTHORITY_INVALID",
  "net::ERR_BLOCKED_BY_CLIENT",
  "net::ERR_WS_PROTOCOL_ERROR",
  "net::ERR_FAILED",
  "net::ERR_ABORTED"
] as const;
type NetworkError = typeof NETWORK_ERRORS[number];
const networkErrors: ReadonlySet<string> = new Set(NETWORK_ERRORS);
const frameOpcodes: ReadonlySet<unknown> = new Set([0, 1, 2, 8, 9, 10]);
const MAX_SOCKETS = 32;
const MAX_EVENTS_PER_MINUTE = 120;

export interface AtlasRealtimeDiagnosticEvent {
  type: "created" | "handshake-request" | "handshake-response" | "error" | "closed";
  /** Local sequence only; never the CDP request ID, player ID, or room code. */
  connectionId: number;
  route: AtlasRealtimeRoute;
  observedAtMs: number;
  lifetimeMs: number;
  framesReceived: number;
  framesSent: number;
  sinceLastReceivedMs: number | null;
  sinceLastSentMs: number | null;
  handshakeStatus?: number;
  receivedCloseCode?: number;
  sentCloseCode?: number;
  networkError?: NetworkError | "unknown";
  suppressedEvents: number;
}

interface SocketState {
  connectionId: number;
  route: AtlasRealtimeRoute;
  createdAt: number;
  framesReceived: number;
  framesSent: number;
  lastReceivedAt: number | null;
  lastSentAt: number | null;
  handshakeRequested: boolean;
  handshakeResponded: boolean;
  errorReported: boolean;
  handshakeStatus?: number;
  receivedCloseCode?: number;
  sentCloseCode?: number;
}

/** Passive metadata observer for an already-enabled CDP Network stream. */
export class AtlasRealtimeDiagnostics {
  private readonly sockets = new Map<string, SocketState>();
  private readonly now: () => number;
  private sequence = 0;
  private lastObservedAt = 0;
  private eventWindowStart = 0;
  private emittedInWindow = 0;
  private suppressedEvents = 0;

  constructor(
    private readonly onEvent: (event: AtlasRealtimeDiagnosticEvent) => void,
    options: { now?: () => number } = {}
  ) {
    this.now = options.now ?? Date.now;
  }

  observe(method: string, params: unknown): void {
    if (!method.startsWith("Network.webSocket")) return;
    const payload = record(params);
    const requestId = payload.requestId;
    if (typeof requestId !== "string" || !requestId || requestId.length > 256) return;

    if (method === "Network.webSocketCreated") {
      const route = socketRoute(payload.url);
      if (!route || this.sockets.has(requestId)) return;
      if (this.sockets.size >= MAX_SOCKETS) {
        const oldest = this.sockets.keys().next().value;
        if (oldest !== undefined) this.sockets.delete(oldest);
      }
      const now = this.observedAt();
      this.sequence = increment(this.sequence);
      const state: SocketState = {
        connectionId: this.sequence,
        route,
        createdAt: now,
        framesReceived: 0,
        framesSent: 0,
        lastReceivedAt: null,
        lastSentAt: null,
        handshakeRequested: false,
        handshakeResponded: false,
        errorReported: false
      };
      this.sockets.set(requestId, state);
      this.emit("created", state, now);
      return;
    }

    const state = this.sockets.get(requestId);
    if (!state) return;
    const now = this.observedAt();
    if (method === "Network.webSocketFrameReceived" || method === "Network.webSocketFrameSent") {
      const frame = record(payload.response);
      if (!frameOpcodes.has(frame.opcode)) return;
      // Counts describe CDP frame events, not application messages or heartbeat replies.
      if (method === "Network.webSocketFrameReceived") {
        state.framesReceived = increment(state.framesReceived);
        state.lastReceivedAt = now;
        if (frame.opcode === 8) state.receivedCloseCode ??= closeCode(frame.payloadData);
      } else {
        state.framesSent = increment(state.framesSent);
        state.lastSentAt = now;
        if (frame.opcode === 8) state.sentCloseCode ??= closeCode(frame.payloadData);
      }
      return;
    }
    if (method === "Network.webSocketWillSendHandshakeRequest" && !state.handshakeRequested) {
      state.handshakeRequested = true;
      this.emit("handshake-request", state, now);
    } else if (method === "Network.webSocketHandshakeResponseReceived" && !state.handshakeResponded) {
      state.handshakeResponded = true;
      const status = record(payload.response).status;
      if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
        state.handshakeStatus = status;
      }
      this.emit("handshake-response", state, now);
    } else if (method === "Network.webSocketFrameError" && !state.errorReported) {
      state.errorReported = true;
      this.emit("error", state, now, networkErrorCode(payload.errorMessage));
    } else if (method === "Network.webSocketClosed") {
      this.sockets.delete(requestId);
      this.emit("closed", state, now);
    }
  }

  clear(): void {
    this.sockets.clear();
  }

  private observedAt(): number {
    const value = this.now();
    if (Number.isFinite(value) && value >= 0) {
      this.lastObservedAt = Math.max(this.lastObservedAt, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)));
    }
    return this.lastObservedAt;
  }

  private emit(
    type: AtlasRealtimeDiagnosticEvent["type"],
    state: SocketState,
    now: number,
    networkError?: NetworkError | "unknown"
  ): void {
    if (now - this.eventWindowStart >= 60_000) {
      this.eventWindowStart = now;
      this.emittedInWindow = 0;
    }
    if (this.emittedInWindow >= MAX_EVENTS_PER_MINUTE) {
      this.suppressedEvents = increment(this.suppressedEvents);
      return;
    }
    this.emittedInWindow += 1;
    const event: AtlasRealtimeDiagnosticEvent = {
      type,
      connectionId: state.connectionId,
      route: state.route,
      observedAtMs: now,
      lifetimeMs: now - state.createdAt,
      framesReceived: state.framesReceived,
      framesSent: state.framesSent,
      sinceLastReceivedMs: state.lastReceivedAt === null ? null : now - state.lastReceivedAt,
      sinceLastSentMs: state.lastSentAt === null ? null : now - state.lastSentAt,
      ...(state.handshakeStatus === undefined ? {} : { handshakeStatus: state.handshakeStatus }),
      ...(state.receivedCloseCode === undefined ? {} : { receivedCloseCode: state.receivedCloseCode }),
      ...(state.sentCloseCode === undefined ? {} : { sentCloseCode: state.sentCloseCode }),
      ...(networkError === undefined ? {} : { networkError }),
      suppressedEvents: this.suppressedEvents
    };
    this.suppressedEvents = 0;
    try {
      this.onEvent(event);
    } catch {
      // Diagnostics must never interrupt the existing capture/event handler.
    }
  }
}

function socketRoute(value: unknown): AtlasRealtimeRoute | null {
  if (typeof value !== "string" || value.length > 8_192) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "wss:" || url.hostname !== "realtime.riftatlas-workers.com"
      || url.port || url.username || url.password || url.hash) return null;
    // Retain only the category: remaining path/query fields can identify players or matches.
    const route = /^\/parties\/(match|matchmaking|account)(?:\/|$)/.exec(url.pathname)?.[1];
    return route === "match" || route === "matchmaking" || route === "account" ? route : "other";
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function increment(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1);
}

function networkErrorCode(value: unknown): NetworkError | "unknown" {
  if (typeof value !== "string" || value.length > 4_096) return "unknown";
  // Chromium may prefix its code with prose. Export only an exact known token,
  // never the surrounding text (which may include private socket URLs).
  const tokens: string[] = value.match(/(?<![A-Za-z0-9_])net::ERR_[A-Za-z0-9_]+(?![A-Za-z0-9_])/g) ?? [];
  return tokens.find((token): token is NetworkError => networkErrors.has(token)) ?? "unknown";
}

function closeCode(value: unknown): number | undefined {
  // CDP encodes non-text opcode payloads as base64. A control frame is at most 125 bytes.
  if (typeof value !== "string" || value.length < 4 || value.length > 168
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return undefined;
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 2 || bytes.length > 125 || bytes.toString("base64") !== value) return undefined;
  const code = bytes.readUInt16BE(0);
  return ((code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code))
    || (code >= 3000 && code <= 4999)) ? code : undefined;
}
