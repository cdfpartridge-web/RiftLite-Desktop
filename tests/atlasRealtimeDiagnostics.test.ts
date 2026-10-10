import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  AtlasRealtimeDiagnostics,
  type AtlasRealtimeDiagnosticEvent
} from "../src/main/services/atlasRealtimeDiagnostics.js";

const socketUrl = "wss://realtime.riftatlas-workers.com/parties/match/private-room?playerId=private-player&token=secret";

function fixture() {
  let now = 1_000;
  const events: AtlasRealtimeDiagnosticEvent[] = [];
  const diagnostics = new AtlasRealtimeDiagnostics((event) => events.push(event), { now: () => now });
  return {
    diagnostics,
    events,
    at(value: number) { now = value; },
    create(requestId = "cdp-private-id", url = socketUrl) {
      diagnostics.observe("Network.webSocketCreated", { requestId, url });
    },
    observe(method: string, values: Record<string, unknown> = {}, requestId = "cdp-private-id") {
      diagnostics.observe(`Network.webSocket${method}`, { requestId, ...values });
    }
  };
}

function closePayload(code: number, reason = "private close reason"): string {
  const bytes = Buffer.alloc(2 + Buffer.byteLength(reason));
  bytes.writeUInt16BE(code, 0);
  bytes.write(reason, 2);
  return bytes.toString("base64");
}

describe("passive Atlas realtime diagnostics", () => {
  it("measures independent connections and reports idle time only at lifecycle events", () => {
    const f = fixture();
    f.create("match");
    f.at(1_100);
    f.create("account", "wss://realtime.riftatlas-workers.com/parties/account/private-account");
    f.at(2_000);
    f.observe("FrameReceived", { response: { opcode: 1, payloadData: "private match state" } }, "match");
    f.at(3_000);
    f.observe("FrameSent", { response: { opcode: 1, payloadData: "private action" } }, "match");
    f.at(4_000);
    f.observe("FrameReceived", { response: { opcode: 1, payloadData: "account state" } }, "account");
    expect(f.events).toHaveLength(2);
    f.at(5_000);
    f.observe("Closed", {}, "match");
    f.observe("Closed", {}, "account");
    expect(f.events.slice(2)).toEqual([
      {
        type: "closed", connectionId: 1, route: "match", observedAtMs: 5_000,
        lifetimeMs: 4_000, framesReceived: 1, framesSent: 1,
        sinceLastReceivedMs: 3_000, sinceLastSentMs: 2_000, suppressedEvents: 0
      },
      {
        type: "closed", connectionId: 2, route: "account", observedAtMs: 5_000,
        lifetimeMs: 3_900, framesReceived: 1, framesSent: 0,
        sinceLastReceivedMs: 1_000, sinceLastSentMs: null, suppressedEvents: 0
      }
    ]);
  });

  it("keeps a handshake status without retaining headers, identifiers, URLs or payloads", () => {
    const f = fixture();
    f.create();
    f.observe("WillSendHandshakeRequest", { request: { headers: { Authorization: "private-auth" } } });
    f.observe("HandshakeResponseReceived", {
      response: { status: 101, headers: { "set-cookie": "private-cookie" }, statusText: "private status" }
    });
    f.observe("FrameReceived", { response: { opcode: 1, payloadData: "private-frame" } });
    f.observe("FrameError", { errorMessage: "private error at " + socketUrl });
    f.observe("Closed", { reason: "private reason", wasClean: true });
    expect(f.events.map((event) => event.type)).toEqual([
      "created", "handshake-request", "handshake-response", "error", "closed"
    ]);
    expect(f.events[2].handshakeStatus).toBe(101);
    expect(f.events[3].networkError).toBe("unknown");
    const serialized = JSON.stringify(f.events);
    for (const privateValue of ["private", "secret", "riftatlas-workers", "playerId", "token", "cdp-", "wasClean"]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(f.events.at(-1)).not.toHaveProperty("receivedCloseCode");
    expect(f.events.at(-1)).not.toHaveProperty("sentCloseCode");
  });

  it.each([
    "ws://realtime.riftatlas-workers.com/parties/match/room",
    "https://realtime.riftatlas-workers.com/parties/match/room",
    "wss://realtime.riftatlas-workers.com.evil.example/parties/match/room",
    "wss://evil.example/?next=realtime.riftatlas-workers.com",
    "wss://user:secret@realtime.riftatlas-workers.com/parties/match/room",
    "wss://realtime.riftatlas-workers.com:444/parties/match/room",
    "wss://realtime.riftatlas-workers.com./parties/match/room",
    "wss://realtime.riftatlas-workers.com/parties/match/room#secret",
    "not a URL"
  ])("ignores untrusted socket URL %s", (url) => {
    const f = fixture();
    f.create("untrusted", url);
    f.observe("Closed", {}, "untrusted");
    expect(f.events).toEqual([]);
  });

  it.each([
    ["/parties/match/private", "match"],
    ["/parties/matchmaking/private-queue", "matchmaking"],
    ["/parties/matchmaking", "matchmaking"],
    ["/parties/account/private", "account"],
    ["/parties/match-private", "other"],
    ["/private-route", "other"]
  ])("classifies %s without exporting path segments", (path, route) => {
    const f = fixture();
    f.create("socket", "wss://realtime.riftatlas-workers.com:443" + path + "?auth=secret");
    expect(f.events[0].route).toBe(route);
    expect(JSON.stringify(f.events)).not.toMatch(/private|secret/);
  });

  it("counts control/data frames without interpreting application messages or emitting per frame", () => {
    const f = fixture();
    f.create();
    for (let index = 0; index < 10_000; index++) {
      f.observe("FrameReceived", { response: { opcode: index % 2 ? 1 : 10, payloadData: "private" } });
    }
    expect(f.events).toHaveLength(1);
    f.observe("Closed");
    expect(f.events[1].framesReceived).toBe(10_000);
  });

  it("decodes only validated close codes with directions supplied by CDP", () => {
    const f = fixture();
    f.create();
    f.observe("FrameReceived", { response: { opcode: 8, payloadData: closePayload(1011) } });
    f.observe("FrameSent", { response: { opcode: 8, payloadData: closePayload(1000) } });
    f.observe("Closed");
    expect(f.events[1]).toMatchObject({ receivedCloseCode: 1011, sentCloseCode: 1000 });
    expect(JSON.stringify(f.events)).not.toContain("private");
    expect(f.events[1]).not.toHaveProperty("wasClean");
  });

  it.each([
    "", "not base64", "A===", "AQ==", "1000", "A+g=\n", closePayload(1005),
    closePayload(1006), closePayload(1015), closePayload(2999), closePayload(5000),
    closePayload(1000, "x".repeat(124))
  ])("leaves absent or invalid close codes unknown", (payloadData) => {
    const f = fixture();
    f.create();
    f.observe("FrameReceived", { response: { opcode: 8, payloadData } });
    f.observe("Closed");
    expect(f.events[1]).not.toHaveProperty("receivedCloseCode");
  });

  it("does not interpret text that happens to contain a base64 close frame", () => {
    const f = fixture();
    f.create();
    f.observe("FrameReceived", { response: { opcode: 1, payloadData: closePayload(1000) } });
    f.observe("Closed");
    expect(f.events[1]).not.toHaveProperty("receivedCloseCode");
  });

  it.each([
    ["net::ERR_CONNECTION_RESET", "net::ERR_CONNECTION_RESET"],
    ["net::ERR_NETWORK_CHANGED", "net::ERR_NETWORK_CHANGED"],
    ["net::ERR_CONNECTION_RESET private-token", "net::ERR_CONNECTION_RESET"],
    ["net::ERR_CONNECTION_RESET_PRIVATE_TOKEN", "unknown"],
    ["privatenet::ERR_CONNECTION_RESET", "unknown"],
    ["net::ERR_PRIVATE_TOKEN", "unknown"],
    ["x".repeat(4_097) + "net::ERR_CONNECTION_RESET", "unknown"],
    [null, "unknown"]
  ])("only emits exact allowlisted network error codes", (errorMessage, networkError) => {
    const f = fixture();
    f.create();
    f.observe("FrameError", { errorMessage });
    f.observe("FrameError", { errorMessage: "net::ERR_FAILED" });
    expect(f.events).toHaveLength(2);
    expect(f.events[1].networkError).toBe(networkError);
  });

  it("extracts a wrapped Chromium error without emitting its secret URL or surrounding text", () => {
    const f = fixture();
    f.create();
    f.observe("FrameError", {
      errorMessage: `Error in connection establishment: net::ERR_CONNECTION_REFUSED (${socketUrl})`
    });
    expect(f.events[1].networkError).toBe("net::ERR_CONNECTION_REFUSED");
    expect(JSON.stringify(f.events)).not.toMatch(/private|secret|riftatlas-workers|establishment/);
  });

  it("drops wrapped unknown codes and their private paths entirely", () => {
    const f = fixture();
    f.create();
    f.observe("FrameError", {
      errorMessage: `Error in connection establishment: net::ERR_PRIVATE_TOKEN (${socketUrl})`
    });
    expect(f.events[1].networkError).toBe("unknown");
    expect(JSON.stringify(f.events)).not.toMatch(/PRIVATE_TOKEN|private|secret|riftatlas-workers|establishment/);
  });

  it("ignores unknown, invalid, duplicate, and already closed connections", () => {
    const f = fixture();
    for (const params of [null, undefined, [], 1, "string", {}, { requestId: 1 }, { requestId: "x".repeat(257), url: socketUrl }]) {
      f.diagnostics.observe("Network.webSocketCreated", params);
    }
    f.observe("Closed");
    f.create();
    f.create();
    f.observe("FrameReceived");
    f.observe("FrameSent", { response: { opcode: "1" } });
    f.observe("FrameReceived", { response: { opcode: 11 } });
    f.observe("HandshakeResponseReceived", { response: { status: "101" } });
    f.observe("HandshakeResponseReceived", { response: { status: 101 } });
    f.observe("Closed");
    f.observe("Closed");
    f.observe("FrameReceived", { response: { opcode: 1 } });
    expect(f.events.map((event) => event.type)).toEqual(["created", "handshake-response", "closed"]);
    expect(f.events[2]).toMatchObject({ framesReceived: 0, framesSent: 0, sinceLastReceivedMs: null });
    expect(f.events[1]).not.toHaveProperty("handshakeStatus");
  });

  it("bounds retained sockets and silently evicts the oldest metadata", () => {
    const f = fixture();
    for (let index = 0; index < 40; index++) f.create(String(index));
    for (let index = 0; index < 40; index++) f.observe("Closed", {}, String(index));
    const closed = f.events.filter((event) => event.type === "closed");
    expect(closed).toHaveLength(32);
    expect(closed[0].connectionId).toBe(9);
    expect(closed.at(-1)?.connectionId).toBe(40);
  });

  it("bounds lifecycle output during reconnect floods and resumes with a suppression count", () => {
    const f = fixture();
    for (let index = 0; index < 100; index++) {
      f.create(String(index));
      f.observe("Closed", {}, String(index));
    }
    expect(f.events).toHaveLength(120);
    f.at(61_000);
    f.create("next");
    expect(f.events).toHaveLength(121);
    expect(f.events[120].suppressedEvents).toBe(80);
    f.observe("Closed", {}, "next");
    expect(f.events[121].suppressedEvents).toBe(0);
  });

  it("clamps backward or invalid clocks to keep elapsed durations meaningful", () => {
    const f = fixture();
    f.create();
    f.at(2_000);
    f.observe("FrameReceived", { response: { opcode: 1 } });
    f.at(500);
    f.observe("FrameSent", { response: { opcode: 1 } });
    f.at(Number.NaN);
    f.observe("Closed");
    expect(f.events[1]).toMatchObject({ observedAtMs: 2_000, lifetimeMs: 1_000, sinceLastReceivedMs: 0, sinceLastSentMs: 0 });
  });

  it("clears metadata without falsely reporting a transport close", () => {
    const f = fixture();
    f.create();
    f.diagnostics.clear();
    f.observe("Closed");
    expect(f.events).toHaveLength(1);
  });

  it("isolates a failing diagnostic callback from the CDP consumer", () => {
    const diagnostics = new AtlasRealtimeDiagnostics(() => { throw new Error("log unavailable"); });
    expect(() => diagnostics.observe("Network.webSocketCreated", { requestId: "one", url: socketUrl })).not.toThrow();
    expect(() => diagnostics.observe("Network.webSocketClosed", { requestId: "one" })).not.toThrow();
  });
});
