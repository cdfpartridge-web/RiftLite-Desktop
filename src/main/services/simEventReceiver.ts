import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { CaptureEvent, RiftboundSimEvent } from "../../shared/types.js";

const SIM_RECEIVER_HOST = "127.0.0.1";
const SIM_RECEIVER_PORT = 17732;
const MAX_PORT_ATTEMPTS = 20;
const MAX_BODY_BYTES = 256 * 1024;

type SimEventHandler = (event: CaptureEvent) => Promise<void> | void;

export class SimEventReceiver {
  private server: Server | null = null;
  private currentPort: number;
  private readonly token = randomBytes(24).toString("hex");

  constructor(private readonly handleEvent: SimEventHandler, private readonly startPort = SIM_RECEIVER_PORT) {
    this.currentPort = startPort;
  }

  get url(): string {
    return `http://${SIM_RECEIVER_HOST}:${this.port}/riftlite/events?token=${this.token}`;
  }

  get port(): number {
    const address = this.server?.address();
    return typeof address === "object" && address ? address.port : this.currentPort;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }
    for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt += 1) {
      const port = this.startPort + attempt;
      const server = this.createServer();
      try {
        await listen(server, port);
        this.server = server;
        this.currentPort = port;
        return;
      } catch (error) {
        server.close();
        if (isAddressInUse(error)) {
          continue;
        }
        console.warn("RiftLite simulator event receiver did not start", error);
        return;
      }
    }
    console.warn(`RiftLite simulator event receiver could not find a free port from ${this.startPort} to ${this.startPort + MAX_PORT_ATTEMPTS - 1}`);
  }

  stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  private createServer(): Server {
    return createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        writeJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
      });
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === "OPTIONS") {
      writeCors(response, 204);
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", `http://${SIM_RECEIVER_HOST}:${this.port}`);
    if (request.method === "GET" && url.pathname === "/riftlite/status") {
      writeJson(response, { ok: true, receiver: "riftlite-sim", port: this.port });
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/riftlite/events") {
      writeJson(response, { ok: false, error: "Not found" }, 404);
      return;
    }
    if (!this.authorized(request, url)) {
      writeJson(response, { ok: false, error: "Unauthorized" }, 401);
      return;
    }
    try {
      const body = await readJson(request);
      const simEvents = Array.isArray(body) ? body : [body];
      for (const simEvent of simEvents) {
        await this.handleEvent(captureEventFromSimEvent(readSimEvent(simEvent)));
      }
      writeJson(response, { ok: true, received: simEvents.length });
    } catch (error) {
      writeJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  private authorized(request: IncomingMessage, url: URL): boolean {
    const candidate = url.searchParams.get("token") || String(request.headers["x-riftlite-sim-token"] ?? "");
    return safeTokenEquals(candidate, this.token);
  }
}

export function captureEventFromSimEvent(event: RiftboundSimEvent): CaptureEvent {
  const kind: CaptureEvent["kind"] = event.type === "match-start" || event.type === "game-start"
    ? "match-start"
    : event.type === "match-end"
      ? "match-end"
      : "match-snapshot";
  return {
    id: `sim-${event.id}`,
    platform: "sim",
    kind,
    capturedAt: event.emittedAt,
    url: "riftbound-sim://local",
    payload: {
      active: event.active,
      reason: `sim-${event.type}`,
      format: event.format,
      simEvent: event,
      myName: event.players.me.name,
      opponentName: event.players.opponent.name,
      myChampion: event.players.me.legend,
      opponentChampion: event.players.opponent.legend,
      deckName: event.players.me.deckName,
      deckSourceId: event.matchId,
      score: event.score ? { me: event.score.me, opp: event.score.opponent, source: "sim-event" } : undefined,
      myBattlefield: event.actor === "me" ? event.battlefield : "",
      opponentBattlefield: event.actor === "opponent" ? event.battlefield : "",
      endText: event.type === "match-end" ? event.text : ""
    }
  };
}

function readSimEvent(value: unknown): RiftboundSimEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a simulator event object");
  }
  const event = value as RiftboundSimEvent;
  if (!event.id || !event.matchId || !event.type || !event.emittedAt) {
    throw new Error("Simulator event is missing required fields");
  }
  return event;
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, SIM_RECEIVER_HOST);
  });
}

function isAddressInUse(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EADDRINUSE");
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Simulator event payload is too large");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function safeTokenEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function writeCors(response: ServerResponse, status = 200): void {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type,x-riftlite-sim-token",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
}

function writeJson(response: ServerResponse, payload: unknown, status = 200): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type,x-riftlite-sim-token",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  response.end(JSON.stringify(payload));
}
