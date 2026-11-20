import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RawCaptureService } from "../src/main/services/rawCaptureService.js";
import type { RiftLiteStore } from "../src/main/services/store.js";
import type { RawCaptureAppendFramePayload, ReplayRecord, UserSettings } from "../src/shared/types.js";

const at = 1_783_600_000_000;
const requestUrl = "wss://realtime.riftatlas-workers.com/parties/match/RECONNECT";
const fixtures: Array<{ service: RawCaptureService; directory: string }> = [];
type Internals = {
  sessions: Map<string, { captureLoss?: unknown }>;
  unassociatedIngressLosses: Map<string, unknown>;
  pendingIngressLosses: Map<string, unknown>;
  appendFrameTail: Promise<void>;
  ingressLossTimer?: ReturnType<typeof setTimeout>;
  drainPendingFrames(): Promise<void>;
  closeSessionJournalHandle(id: string): Promise<void>;
};
const internal = (service: RawCaptureService) => service as unknown as Internals;
const frame = (roomCode = "RECONNECT", socketId = "ws-1", ts = at, url = requestUrl): RawCaptureAppendFramePayload => ({
  platform: "atlas", requestUrl: url,
  frame: { seq: 0, ts, dir: "in", socketId, raw: JSON.stringify({ type: "authoritative_snapshot", roomCode, body: { turn: 2 } }) }
});
function loss(service: RawCaptureService, socketId = "ws-2", ts = at + 1, url = requestUrl) {
  service.recordIngressLoss({ requestUrl: url, socketId, loss: {
    version: 1, reasons: ["ingress-frame-too-large"], droppedFrames: 1, firstAt: ts, lastAt: ts
  } });
}
async function harness() {
  const directory = await mkdtemp(join(tmpdir(), "riftlite-reconnect-loss-"));
  const settings = { replayDirectory: directory, rawCapture: { enabled: true, visibility: "private" } } as UserSettings;
  const replays: ReplayRecord[] = [];
  const getSettings = vi.fn(async () => settings);
  const store = {
    getSettings, getReplays: async () => replays, getMatches: async () => [], getDeletedMatches: async () => [], getDeletedReplays: async () => [],
    hasActiveRawCaptureParent: async () => true,
    hasActiveRawCaptureParents: async (parents: unknown[]) => parents.map(() => true),
    saveReplayIfMatchActive: async (value: ReplayRecord) => { replays.push(value); return value; },
    saveReplay: async (value: ReplayRecord) => { replays.push(value); return value; },
    updateActiveReplay: async (id: string, update: (value: ReplayRecord) => ReplayRecord) => {
      const current = replays.find(value => value.id === id); return current ? update(current) : null;
    }
  } as unknown as RiftLiteStore;
  const service = new RawCaptureService(store);
  fixtures.push({ service, directory });
  return { service, settings, getSettings };
}
let replayId = 0;
async function finish(service: RawCaptureService, roomCode = "RECONNECT") {
  const saved = await service.finishForReplay({ id: `local-${++replayId}`, matchId: `match-${replayId}`, platform: "atlas",
    capturedAt: new Date(at).toISOString(), title: "Synthetic", players: { me: "One", opponent: "Two" }, events: [] }, { roomCode });
  const payload = JSON.parse(await readFile(saved.rawCapture!.localPath!, "utf8"));
  return { saved, payload };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { service, directory } of fixtures.splice(0)) {
    await internal(service).drainPendingFrames();
    for (const id of internal(service).sessions.keys()) await internal(service).closeSessionJournalHandle(id);
    await rm(directory, { recursive: true, force: true });
  }
});

describe("reconnected capture loss association", () => {
  it("exports the dropped first reconnect frame after its exact socket proves the existing room", async () => {
    const { service } = await harness();
    await service.appendFrame(frame());
    loss(service);
    await service.appendFrame(frame("RECONNECT", "ws-2", at + 2));
    const { saved, payload } = await finish(service);
    expect(payload.messages.map((value: { socketId: string }) => value.socketId)).toEqual(["ws-1", "ws-2"]);
    expect(payload.capture.loss).toEqual({ version: 1, reasons: ["ingress-frame-too-large"], droppedFrames: 1, firstAt: at + 1, lastAt: at + 1 });
    expect(saved.rawCapture?.captureLoss).toEqual(payload.capture.loss);
    expect(saved.rawCapture?.partialWarnings?.join(" ")).toContain("history is incomplete");
    expect(payload.diagnostics.filter((value: { code: string }) => value.code === "capture_ingress_loss")).toHaveLength(1);
  });

  it("retains an unassociated notice across a flush without creating a recurring task or timer", async () => {
    const { service, getSettings } = await harness();
    await service.appendFrame(frame()); loss(service);
    await internal(service).drainPendingFrames();
    expect(internal(service).unassociatedIngressLosses.size).toBe(1);
    expect(internal(service).pendingIngressLosses.size).toBe(0);
    expect(internal(service).ingressLossTimer).toBeUndefined();
    const tail = internal(service).appendFrameTail;
    const reads = getSettings.mock.calls.length;
    for (let index = 0; index < 10; index++) await internal(service).drainPendingFrames();
    expect(internal(service).appendFrameTail).toBe(tail);
    expect(getSettings.mock.calls.length).toBe(reads);
    await service.appendFrame(frame("RECONNECT", "ws-2", at + 2));
    expect((await finish(service)).payload.capture.loss.droppedFrames).toBe(1);
  });

  it("proves an existing capture across a changed reconnect URL and merges repeated notices once", async () => {
    const { service } = await harness();
    await service.appendFrame(frame());
    const reconnectUrl = requestUrl + "?_pk=new-connection&playerId=local";
    loss(service, "ws-2", at + 1, reconnectUrl);
    await internal(service).drainPendingFrames();
    loss(service, "ws-2", at + 2, reconnectUrl);
    await internal(service).drainPendingFrames();
    await service.appendFrame(frame("RECONNECT", "ws-2", at + 3, reconnectUrl));
    await service.appendFrame(frame("RECONNECT", "ws-2", at + 4, reconnectUrl));
    expect((await finish(service)).payload.capture.loss).toMatchObject({ droppedFrames: 2, firstAt: at + 1, lastAt: at + 2 });
  });

  it("requires explicit identity instead of trusting a bare reconnect socket, then adopts when identity arrives", async () => {
    const { service } = await harness();
    await service.appendFrame(frame()); loss(service);
    const bare = frame("", "ws-2", at + 2);
    bare.frame.raw = JSON.stringify({ type: "authoritative_patch_commit", patch: [] });
    await service.appendFrame(bare);
    expect([...internal(service).sessions.values()].every(value => !value.captureLoss)).toBe(true);
    expect(internal(service).unassociatedIngressLosses.size).toBe(1);
    await service.appendFrame(frame("RECONNECT", "ws-2", at + 3));
    expect((await finish(service)).payload.capture.loss.droppedFrames).toBe(1);
  });

  it("does not transfer an old notice into a different room on the same URL and socket", async () => {
    const { service } = await harness();
    await service.appendFrame(frame()); loss(service);
    await service.appendFrame(frame("NEW-ROOM", "ws-2", at + 2));
    expect(internal(service).unassociatedIngressLosses.size).toBe(0);
    expect((await finish(service)).payload.capture.loss).toBeUndefined();
    expect((await finish(service, "NEW-ROOM")).payload.capture.loss).toBeUndefined();
  });

  it("does not use the socket-only fallback across URLs", async () => {
    const { service } = await harness();
    await service.appendFrame(frame()); loss(service);
    await service.appendFrame(frame("RECONNECT", "ws-2", at + 2, requestUrl + "-other"));
    expect((await finish(service)).payload.capture.loss).toBeUndefined();
    expect(internal(service).unassociatedIngressLosses.size).toBe(0);
  });

  it("drops a dormant notice at an explicit search boundary", async () => {
    const { service } = await harness();
    await service.appendFrame(frame()); loss(service);
    const search = frame("", "ws-2", at + 2);
    search.frame.raw = JSON.stringify({ type: "search" });
    await service.appendFrame(search);
    expect(internal(service).unassociatedIngressLosses.size).toBe(0);
    await service.appendFrame(frame("NEW-ROOM", "ws-2", at + 3));
    expect((await finish(service)).payload.capture.loss).toBeUndefined();
    expect((await finish(service, "NEW-ROOM")).payload.capture.loss).toBeUndefined();
  });

  it("forgets frozen candidates on finalization before a later capture reuses the same room/socket", async () => {
    const { service } = await harness();
    await service.appendFrame(frame()); loss(service);
    expect((await finish(service)).payload.capture.loss).toBeUndefined();
    expect(internal(service).unassociatedIngressLosses.size).toBe(0);
    await service.appendFrame(frame("RECONNECT", "ws-2", at + 2));
    expect((await finish(service)).payload.capture.loss).toBeUndefined();
  });

  it.each([at - 1, at + 10])("rejects loss outside the proven capture/frame interval (%s)", async ts => {
    const { service } = await harness();
    await service.appendFrame(frame()); loss(service, "ws-2", ts);
    await service.appendFrame(frame("RECONNECT", "ws-2", at + 2));
    expect((await finish(service)).payload.capture.loss).toBeUndefined();
  });

  it("does not attach a notice before any active capture existed", async () => {
    const { service } = await harness();
    loss(service, "ws-1", at - 1);
    await service.appendFrame(frame());
    expect((await finish(service)).payload.capture.loss).toBeUndefined();
  });

  it("bounds dormant reconnect noise and expires it lazily without timers", async () => {
    const { service } = await harness();
    await service.appendFrame(frame());
    for (let batch = 0; batch < 4; batch++) {
      for (let index = 0; index < 1000; index++) loss(service, `noise-${batch}-${index}`);
      await internal(service).drainPendingFrames();
      expect(internal(service).unassociatedIngressLosses.size).toBeLessThanOrEqual(32);
      expect(internal(service).ingressLossTimer).toBeUndefined();
    }
    expect(internal(service).unassociatedIngressLosses.size).toBe(32);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60 * 60 * 1000 + 1);
    loss(service, "unknown", at - 1, requestUrl + "-unknown");
    expect(internal(service).unassociatedIngressLosses.size).toBe(0);
    await internal(service).drainPendingFrames();
    expect(internal(service).unassociatedIngressLosses.size).toBe(0);
    expect(internal(service).ingressLossTimer).toBeUndefined();
  });

  it("clears dormant receipts when capture is disabled", async () => {
    const { service, settings } = await harness();
    await service.appendFrame(frame()); loss(service);
    await internal(service).drainPendingFrames();
    expect(internal(service).unassociatedIngressLosses.size).toBe(1);
    settings.rawCapture.enabled = false;
    await service.appendFrame(frame("RECONNECT", "ws-2", at + 2));
    expect(internal(service).unassociatedIngressLosses.size).toBe(0);
  });
});
