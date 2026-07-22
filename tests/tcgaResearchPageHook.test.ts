import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  TCGA_REPLAY_RESEARCH_BINDING,
  tcgaReplayResearchPageHookSource
} from "../src/shared/tcgaResearchPageHook";

type Listener = (event: Record<string, unknown>) => void;

class FakeRtcDataChannel {
  readonly protocol = "";
  readonly id = 7;
  readonly ordered = true;
  readonly negotiated = false;
  readonly readyState = "open";
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly label: string) {}

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakeRtcPeerConnection {
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  createDataChannel(label: string): FakeRtcDataChannel {
    return new FakeRtcDataChannel(label);
  }

  setRemoteDescription(): Promise<void> {
    return Promise.resolve();
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

class DeferredBlob {
  readonly size = 3;
  readonly type = "application/octet-stream";
  private readonly pending: Promise<ArrayBuffer>;
  private resolvePending: (value: ArrayBuffer) => void = () => undefined;

  constructor() {
    this.pending = new Promise<ArrayBuffer>((resolve) => {
      this.resolvePending = resolve;
    });
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.pending;
  }

  resolve(bytes: Uint8Array): void {
    this.resolvePending(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
}

describe("TCGA replay research page hook", () => {
  it("captures both directions of the PeerJS game channel and can be disabled and resumed", async () => {
    const records: Array<Record<string, unknown>> = [];
    const sandbox: Record<string, unknown> = {
      RTCDataChannel: FakeRtcDataChannel,
      RTCPeerConnection: FakeRtcPeerConnection,
      Blob,
      ArrayBuffer,
      Uint8Array,
      Date,
      JSON,
      Promise,
      Object,
      Math,
      Number,
      String,
      performance: { now: () => 123.5 },
      location: { pathname: "/game/ROOM-1" },
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      [TCGA_REPLAY_RESEARCH_BINDING]: (raw: string) => {
        records.push(JSON.parse(raw) as Record<string, unknown>);
      }
    };
    sandbox.top = sandbox;
    const context = vm.createContext(sandbox);

    expect(vm.runInContext(tcgaReplayResearchPageHookSource(true, "SESSION-1"), context)).toBe(true);
    const gameChannel = vm.runInContext(
      "(() => { const peer = new RTCPeerConnection(); return peer.createDataChannel('game'); })()",
      context
    ) as FakeRtcDataChannel;
    const ignoredChannel = vm.runInContext(
      "(() => { const peer = new RTCPeerConnection(); return peer.createDataChannel('other'); })()",
      context
    ) as FakeRtcDataChannel;
    const secondGameChannel = vm.runInContext(
      "(() => { const peer = new RTCPeerConnection(); return peer.createDataChannel('game'); })()",
      context
    ) as FakeRtcDataChannel;

    gameChannel.send("outbound-game-data");
    gameChannel.dispatch("message", { data: "inbound-game-data" });
    gameChannel.send(new Uint8Array([1, 2, 3]));
    secondGameChannel.send("second-channel-data");
    ignoredChannel.send("not-game-data");
    await flushPromises();

    const firstSessionData = records.filter((record) => record.kind === "rtc-data");
    expect(firstSessionData).toHaveLength(4);
    expect(firstSessionData.map((record) => (record.payload as Record<string, unknown>).direction).sort())
      .toEqual(["in", "out", "out", "out"]);
    expect(JSON.stringify(firstSessionData)).toContain("outbound-game-data");
    expect(JSON.stringify(firstSessionData)).toContain("inbound-game-data");
    expect(JSON.stringify(firstSessionData)).toContain("AQID");
    const captureChannelIds = firstSessionData.map((record) => {
      const payload = record.payload as Record<string, unknown>;
      const channel = payload.channel as Record<string, unknown>;
      return channel.captureChannelId;
    });
    expect(new Set(captureChannelIds)).toEqual(new Set(["channel-1", "channel-2"]));
    expect(JSON.stringify(records)).not.toContain("not-game-data");
    expect(records.every((record) => record.sessionId === "SESSION-1")).toBe(true);

    expect(vm.runInContext(tcgaReplayResearchPageHookSource(false), context)).toBe(true);
    gameChannel.send("while-disabled");
    await flushPromises();
    expect(JSON.stringify(records)).not.toContain("while-disabled");

    expect(vm.runInContext(tcgaReplayResearchPageHookSource(true, "SESSION-2"), context)).toBe(true);
    gameChannel.send("after-resume");
    await flushPromises();
    const resumed = records.find((record) => JSON.stringify(record).includes("after-resume"));
    expect(resumed).toMatchObject({ kind: "rtc-data", sessionId: "SESSION-2" });
  });

  it("pins an asynchronously decoded Blob to the document that received it", async () => {
    const records: Array<Record<string, unknown>> = [];
    const binding = (raw: string) => records.push(JSON.parse(raw) as Record<string, unknown>);
    const createContext = () => {
      class DocumentRtcDataChannel {
        readonly protocol = "";
        readonly id = 7;
        readonly ordered = true;
        readonly negotiated = false;
        readonly readyState = "open";
        private readonly listeners = new Map<string, Listener[]>();

        constructor(readonly label: string) {}

        addEventListener(type: string, listener: Listener): void {
          this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
        }

        send(_data: unknown): void {}
      }
      class DocumentRtcPeerConnection {
        private readonly listeners = new Map<string, Listener[]>();

        addEventListener(type: string, listener: Listener): void {
          this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
        }

        createDataChannel(label: string): DocumentRtcDataChannel {
          return new DocumentRtcDataChannel(label);
        }

        setRemoteDescription(): Promise<void> {
          return Promise.resolve();
        }
      }
      const sandbox: Record<string, unknown> = {
        RTCDataChannel: DocumentRtcDataChannel,
        RTCPeerConnection: DocumentRtcPeerConnection,
        Blob: DeferredBlob,
        ArrayBuffer,
        Uint8Array,
        Date,
        JSON,
        Promise,
        Object,
        Math,
        Number,
        String,
        performance: { now: () => 123.5 },
        location: { pathname: "/game/ROOM" },
        btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
        [TCGA_REPLAY_RESEARCH_BINDING]: binding
      };
      sandbox.top = sandbox;
      return vm.createContext(sandbox);
    };

    const firstContext = createContext();
    expect(vm.runInContext(tcgaReplayResearchPageHookSource(true, "SESSION"), firstContext)).toBe(true);
    const firstReady = records.find((record) => record.kind === "hook-ready");
    const firstDocumentId = String(firstReady?.documentId ?? "");
    const channel = vm.runInContext(
      "(() => { const peer = new RTCPeerConnection(); return peer.createDataChannel('game'); })()",
      firstContext
    ) as { send(value: unknown): void };
    const blob = vm.runInContext("new Blob()", firstContext) as DeferredBlob;
    channel.send(blob);

    const secondContext = createContext();
    expect(vm.runInContext(tcgaReplayResearchPageHookSource(true, "SESSION"), secondContext)).toBe(true);
    const readyRecords = records.filter((record) => record.kind === "hook-ready");
    const secondDocumentId = String(readyRecords.at(-1)?.documentId ?? "");
    expect(firstDocumentId).not.toBe("");
    expect(secondDocumentId).not.toBe(firstDocumentId);

    blob.resolve(new Uint8Array([1, 2, 3]));
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const delayed = records.find((record) => record.kind === "rtc-data");
    expect(delayed?.documentId).toBe(firstDocumentId);
    expect(delayed?.payload).toMatchObject({
      data: { encoding: "base64", data: "AQID", byteLength: 3, truncated: false }
    });
  });
});
