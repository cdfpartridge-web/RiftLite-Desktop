import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transpileModule } from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RawCaptureService } from "../src/main/services/rawCaptureService.js";
import { AtlasFrameDeduper } from "../src/main/services/atlasFrameDeduper.js";
import { RawCaptureIngressLimiter, rawCaptureIngressLoss, validatedRawCaptureFrame, validatedRawCaptureLossNotice } from "../src/shared/ipcPayloadSecurity.js";
import { mergeRawCaptureLoss, normalizedRawCaptureLoss, RawCaptureLossNoticeLimiter } from "../src/shared/rawCaptureLoss.js";
import type { RawCaptureLoss, RawCaptureLossReason } from "../src/shared/rawCaptureLoss.js";
import type { RiftLiteStore } from "../src/main/services/store.js";
import type { RawCaptureAppendFramePayload, ReplayRecord, UserSettings } from "../src/shared/types.js";

const directories: string[] = [];
const services: RawCaptureService[] = [];
const at = 1_783_600_000_000;
const socketUrl = "wss://realtime.riftatlas-workers.com/parties/match/LOSS-ROOM";
type Internals = { drainPendingFrames(): Promise<void>; closeSessionJournalHandle(id: string): Promise<void> };
afterEach(async () => {
  vi.restoreAllMocks();
  for (const service of services.splice(0)) {
    await (service as unknown as Internals).drainPendingFrames();
    const status = await service.getStatus();
    if (status.captureSessionId) await (service as unknown as Internals).closeSessionJournalHandle(status.captureSessionId);
  }
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function frame(body: unknown, ts = at, requestUrl = socketUrl, socketId = "ws-1"): RawCaptureAppendFramePayload {
  return { platform: "atlas", requestUrl, frame: { seq: 1, ts, dir: "in", socketId, raw: JSON.stringify(body) } };
}
function snapshot(roomCode = "LOSS-ROOM", ts = at, requestUrl = socketUrl) {
  return frame({ type: "authoritative_snapshot", roomCode, body: { turn: 1 } }, ts, requestUrl);
}
function report(service: RawCaptureService, payload: RawCaptureAppendFramePayload, reason: RawCaptureLossReason = "ingress-rate-limit") {
  const receipt = rawCaptureIngressLoss(payload, reason);
  expect(receipt).not.toBeNull();
  service.recordIngressLoss(receipt!);
}
async function harness() {
  const directory = await mkdtemp(join(tmpdir(), "riftlite-ingress-loss-"));
  directories.push(directory);
  const settings = { replayDirectory: directory, rawCapture: { enabled: true, visibility: "private" } } as UserSettings;
  const replays: ReplayRecord[] = [];
  const store = {
    getSettings: async () => settings,
    getReplays: async () => replays,
    getDeletedReplays: async () => [],
    getMatches: async () => [],
    getDeletedMatches: async () => [],
    hasActiveRawCaptureParent: async () => true,
    hasActiveRawCaptureParents: async (parents: unknown[]) => parents.map(() => true),
    saveReplayIfMatchActive: async (replay: ReplayRecord) => { replays.push(replay); return replay; },
    saveReplay: async (replay: ReplayRecord) => { replays.push(replay); return replay; },
    updateActiveReplay: async (id: string, update: (value: ReplayRecord) => ReplayRecord) => {
      const current = replays.find((replay) => replay.id === id);
      return current ? update(current) : null;
    }
  } as unknown as RiftLiteStore;
  const service = new RawCaptureService(store);
  services.push(service);
  return { service, store, directory, settings };
}
async function finish(service: RawCaptureService, roomCode = "LOSS-ROOM") {
  const saved = await service.finishForReplay({ id: `local-${roomCode}`, matchId: `match-${roomCode}`, platform: "atlas",
    capturedAt: new Date(at).toISOString(), title: roomCode, players: { me: "One", opponent: "Two" }, events: [] }, { roomCode });
  expect(saved.rawCapture?.localPath).toBeTruthy();
  const payload = JSON.parse(await readFile(saved.rawCapture!.localPath!, "utf8")) as {
    capture: { loss?: RawCaptureLoss }; messages: unknown[]; diagnostics: Array<{ code: string }>
  };
  return { saved, payload };
}

describe("raw replay ingress loss", () => {
  it("bounds pending frame count before the first session resolves and records a burst without per-drop tail tasks", async () => {
    const { service, store, settings } = await harness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(store, "getSettings").mockImplementationOnce(async () => { await gate; return settings; });
    const internal = service as unknown as { pendingFrameCount: number; pendingFrameBytes: number; appendFrameTail: Promise<void>; pendingIngressLosses: Map<string, unknown> };
    const admitted = Array.from({ length: 512 }, (_, index) => service.appendFrame(snapshot("LOSS-ROOM", at + index)));
    for (let index = 0; index < 100; index++) {
      report(service, frame({ type: "authoritative_patch_commit" }, at + 511, `${socketUrl}/unassociated-${index}`));
    }
    const tail = internal.appendFrameTail;
    for (let index = 0; index < 5000; index++) void service.appendFrame(snapshot("LOSS-ROOM", at + 512 + index));
    expect(internal.pendingFrameCount).toBe(512);
    expect(internal.appendFrameTail).toBe(tail);
    expect(internal.pendingIngressLosses.size).toBeLessThanOrEqual(32);
    release();
    await Promise.all(admitted);
    const { payload } = await finish(service);
    expect(payload.messages).toHaveLength(512);
    expect(payload.capture.loss).toMatchObject({ reasons: ["capture-buffer-limit"], droppedFrames: 5000 });
    expect(internal.pendingFrameBytes).toBe(0);
    expect(internal.pendingFrameCount).toBe(0);
  });

  it("bounds pending plus retained bytes while I/O is stalled", async () => {
    const { service, store, settings } = await harness();
    const large = (index: number) => frame({ type: "authoritative_snapshot", roomCode: "LOSS-ROOM", padding: "x".repeat(1024 * 1024) }, at + index);
    for (let index = 0; index < 8; index++) await service.appendFrame(large(index));
    const retainedBytes = (await service.getStatus()).byteSize;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(store, "getSettings").mockImplementationOnce(async () => { await gate; return settings; });
    const work = Array.from({ length: 120 }, (_, index) => service.appendFrame(large(index + 8)));
    const internal = service as unknown as { pendingFrameCount: number; pendingFrameBytes: number };
    expect(retainedBytes! + internal.pendingFrameBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(internal.pendingFrameCount).toBeLessThan(32);
    release();
    await Promise.all(work);
    const { payload } = await finish(service);
    expect(payload.capture.loss?.reasons).toContain("capture-buffer-limit");
    expect(internal.pendingFrameBytes).toBe(0);
    expect(internal.pendingFrameCount).toBe(0);
  });

  it("releases pending admission on errors and after finalization", async () => {
    const { service, store } = await harness();
    vi.spyOn(store, "getSettings").mockRejectedValueOnce(new Error("synthetic read failure"));
    await expect(service.appendFrame(snapshot())).rejects.toThrow("synthetic read failure");
    const internal = service as unknown as { pendingFrameCount: number; pendingFrameBytes: number };
    expect(internal.pendingFrameCount).toBe(0);
    expect(internal.pendingFrameBytes).toBe(0);
    await service.appendFrame(snapshot());
    const { payload } = await finish(service);
    expect(payload.messages).toHaveLength(1);
    expect((await service.getStatus()).active).toBe(false);
    expect(internal.pendingFrameCount).toBe(0);
    expect(internal.pendingFrameBytes).toBe(0);
  });

  it("retains an ended capture when the combined byte cap would otherwise prevent cleanup and future admission", async () => {
    const { service, directory } = await harness();
    for (let index = 0; index < 4; index++) {
      await service.appendFrame(snapshot(`OLD-${index}`, at + index, `${socketUrl}/${index}`));
    }
    const internal = service as unknown as Internals & { sessions: Map<string, { byteSize: number; lastPhase: string }> };
    expect(internal.sessions.size).toBe(4);
    // Exercise the accounting boundary without writing 32MiB of repeated fixture data.
    for (const session of internal.sessions.values()) { session.byteSize = 8 * 1024 * 1024; session.lastPhase = "game_end"; }
    await service.appendFrame(snapshot("NEXT", at + 1000, `${socketUrl}/next`));
    await internal.drainPendingFrames();
    expect(internal.sessions.size).toBe(3);
    const files = await readdir(join(directory, "Raw Capture"));
    expect(files.some((name) => name.endsWith(".riftlite-index.json"))).toBe(true);
    await service.appendFrame(snapshot("NEXT", at + 1001, `${socketUrl}/next`));
    expect(internal.sessions.size).toBe(4);
    // Close every synthetic journal before removing the isolated fixture directory.
    for (const id of internal.sessions.keys()) await internal.closeSessionJournalHandle(id);
  });

  it("records the rejected 513th frame despite CDP suppression and preserves historical loss after a new snapshot", async () => {
    const { service } = await harness();
    const limiter = new RawCaptureIngressLimiter();
    const deduper = new AtlasFrameDeduper();
    const first = snapshot();
    expect(limiter.check(7, first, at)).toBeNull();
    expect(deduper.shouldIngest("game-preload", "7", first, at)).toBe(true);
    await service.appendFrame(first);
    const accepted: Promise<void>[] = [];
    for (let index = 1; index < 512; index++) {
      const presence = frame({ type: "presence_update", index }, at + index);
      expect(limiter.check(7, presence, at + index)).toBeNull();
      expect(deduper.shouldIngest("game-preload", "7", presence, at + index)).toBe(true);
      accepted.push(service.appendFrame(presence));
    }
    const commit = frame({ type: "authoritative_patch_commit", patch: [{ op: "set", path: ["turn"], value: 2 }] }, at + 600);
    expect(validatedRawCaptureFrame(commit)).toEqual(commit);
    expect(limiter.check(7, commit, at + 600)).toBe("ingress-rate-limit");
    report(service, commit);
    expect(deduper.shouldIngest("main-debugger", "7", commit, at + 601)).toBe(false);
    const resync = snapshot("LOSS-ROOM", at + 10_001);
    expect(limiter.check(7, resync, at + 10_001)).toBeNull();
    await service.appendFrame(resync);
    await Promise.all(accepted);
    const { saved, payload } = await finish(service);
    expect(payload.capture.loss).toEqual({ version: 1, reasons: ["ingress-rate-limit"], droppedFrames: 1, firstAt: at + 600, lastAt: at + 600 });
    expect(saved.rawCapture?.captureLoss).toEqual(payload.capture.loss);
    expect(saved.rawCapture?.partialWarnings?.join(" ")).toContain("history is incomplete");
    expect(payload.diagnostics.filter((diagnostic) => diagnostic.code === "capture_ingress_loss")).toHaveLength(1);
    expect(payload.messages).toHaveLength(513);
  });

  it("flushes a terminal burst before finalization and bounds diagnostics, counts and journal writes", async () => {
    const { service, directory } = await harness();
    await service.appendFrame(snapshot());
    for (let index = 1; index <= 2000; index++) report(service, frame({ type: "authoritative_patch_commit" }, at + index));
    await (service as unknown as Internals).drainPendingFrames();
    const rawDirectory = join(directory, "Raw Capture");
    const journal = (await readdir(rawDirectory)).find((name) => name.endsWith(".riftlite-active.jsonl"))!;
    const rows = (await readFile(join(rawDirectory, journal), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(rows.filter((row) => row.kind === "loss")).toHaveLength(1);
    for (let index = 2001; index <= 4000; index++) report(service, frame({ type: "authoritative_patch_commit" }, at + index));
    const { payload } = await finish(service);
    expect(payload.capture.loss?.droppedFrames).toBe(4000);
    expect(payload.capture.loss?.lastAt).toBe(at + 4000);
    expect(payload.diagnostics.filter((diagnostic) => diagnostic.code === "capture_ingress_loss")).toHaveLength(1);
    const saturated = mergeRawCaptureLoss(payload.capture.loss, { ...payload.capture.loss!, droppedFrames: 1_000_000 });
    expect(saturated.droppedFrames).toBe(1_000_000);
    expect(normalizedRawCaptureLoss({ ...saturated, droppedFrames: 1_000_001 })).toBeUndefined();
  });

  it("does not attach unknown URLs, older timestamps, or a preceding capture's loss to a new session", async () => {
    const { service } = await harness();
    await service.appendFrame(snapshot());
    report(service, frame({ type: "authoritative_patch_commit" }, at + 1, `${socketUrl}-other`));
    report(service, frame({ type: "authoritative_patch_commit" }, at - 1));
    report(service, frame({ type: "authoritative_patch_commit" }, at + 2));
    await service.appendFrame(frame({ type: "search" }, at + 3));
    await service.appendFrame(snapshot("NEW-ROOM", at + 4));
    const oldCapture = await finish(service);
    const newCapture = await finish(service, "NEW-ROOM");
    expect(oldCapture.payload.capture.loss?.droppedFrames).toBe(1);
    expect(newCapture.payload.capture.loss).toBeUndefined();
    expect(newCapture.saved.rawCapture?.captureLoss).toBeUndefined();
  });

  it.each([false, true])("recovers known loss from its journal (later snapshot: %s)", async (laterSnapshot) => {
    const { service, store, directory } = await harness();
    await service.appendFrame(snapshot());
    report(service, frame({ type: "authoritative_patch_commit" }, at + 1));
    await (service as unknown as Internals).drainPendingFrames();
    if (laterSnapshot) {
      report(service, frame({ type: "authoritative_patch_commit" }, at + 2));
      await service.appendFrame(snapshot("LOSS-ROOM", at + 3));
    }
    const status = await service.getStatus();
    await (service as unknown as Internals).closeSessionJournalHandle(status.captureSessionId!);
    const restarted = new RawCaptureService(store);
    services.push(restarted);
    await restarted.getStatus();
    const rawDirectory = join(directory, "Raw Capture");
    const index = (await readdir(rawDirectory)).find((name) => name.endsWith(".riftlite-index.json"))!;
    const manifest = JSON.parse(await readFile(join(rawDirectory, index), "utf8"));
    const payload = JSON.parse(await readFile(manifest.localPath, "utf8"));
    expect(payload.capture.loss).toMatchObject({ droppedFrames: laterSnapshot ? 2 : 1, reasons: ["ingress-rate-limit"] });
    expect(manifest.metadata.captureLoss).toEqual(payload.capture.loss);
    expect(payload.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", code: "capture_ingress_loss" }));
  });

  it("preserves size and validation losses on the exact capture while bounding unrelated transport noise", async () => {
    const { service } = await harness();
    // A rejected frame before any retained frame must not contaminate a later capture.
    report(service, frame({ type: "authoritative_snapshot" }, at - 1));
    await service.appendFrame(snapshot());
    for (let index = 0; index < 100; index++) {
      report(service, frame({ type: "authoritative_patch_commit" }, at + 1, `${socketUrl}/unknown-${index}`));
    }
    report(service, frame({ type: "authoritative_patch_commit" }, at + 2), "ingress-frame-too-large");
    report(service, frame({ type: "authoritative_patch_commit" }, at + 3), "ingress-invalid-frame");
    const { payload } = await finish(service);
    expect(payload.capture.loss).toEqual({ version: 1, reasons: ["ingress-frame-too-large", "ingress-invalid-frame"],
      droppedFrames: 2, firstAt: at + 2, lastAt: at + 3 });
  });

  it("identifies size and validation rejection without trusting type hints or unknown origins", () => {
    const limiter = new RawCaptureIngressLimiter();
    const oversized = frame({ type: "authoritative_snapshot", body: "x".repeat(1_500_000) });
    expect(limiter.check(1, oversized)).toBe("ingress-frame-too-large");
    expect(rawCaptureIngressLoss(oversized, "ingress-frame-too-large")?.loss.reasons).toEqual(["ingress-frame-too-large"]);
    const invalid = frame({ type: "authoritative_snapshot" });
    invalid.frame.raw = "{broken";
    expect(validatedRawCaptureFrame(invalid)).toBeNull();
    expect(rawCaptureIngressLoss(invalid, "ingress-invalid-frame")?.loss.reasons).toEqual(["ingress-invalid-frame"]);
    expect(rawCaptureIngressLoss({ ...invalid, requestUrl: "wss://evil.example" }, "ingress-invalid-frame")).toBeNull();
    expect(rawCaptureIngressLoss({ ...invalid, frame: { ...invalid.frame, ts: -1 } }, "ingress-invalid-frame")).toBeNull();
    expect(rawCaptureIngressLoss(frame({ type: "presence_update" }), "ingress-rate-limit")).toBeNull();
    invalid.frame.type = "presence_update";
    expect(rawCaptureIngressLoss(invalid, "ingress-rate-limit")).not.toBeNull();
  });

  it("reports preload oversize frames as bounded notices without forwarding their bodies or exhausting frame slots", () => {
    const source = readFileSync(new URL("../src/game-preload/gamePreload.ts", import.meta.url), "utf8");
    const start = source.indexOf("function captureRawAtlasFrame(");
    const end = source.indexOf("function isAtlasRawCaptureSocket(", start);
    const sent: Array<[string, Record<string, unknown>]> = [];
    const context = { platform: "atlas", rawCaptureSeq: 0, rawCaptureLossNoticeLimiter: new RawCaptureLossNoticeLimiter(),
      isAtlasRawCaptureSocket: () => true, Date: { now: () => at }, ipcRenderer: {
        send: (channel: string, value: Record<string, unknown>) => sent.push([channel, value])
      }, captureRawAtlasFrame: undefined as unknown as (url: string, raw: string, direction: string, socketId: string) => void };
    runInNewContext(transpileModule(source.slice(start, end), {}).outputText, context);
    const raw = `{"type":"authoritative_snapshot","body":"${"x".repeat(1_500_000)}"}`;
    for (let index = 0; index < 100; index++) context.captureRawAtlasFrame(socketUrl, raw, "in", "ws-1");
    expect(sent).toHaveLength(32);
    expect(sent.every(([channel, notice]) => channel === "raw-capture:loss" && JSON.stringify(notice).length < 512)).toBe(true);
    expect(validatedRawCaptureLossNotice(sent[0][1])?.loss.reasons).toEqual(["ingress-frame-too-large"]);
    expect(sent[0][1]).not.toHaveProperty("raw");
    context.captureRawAtlasFrame(socketUrl, '{"type":"authoritative_snapshot"}', "in", "ws-1");
    expect(sent.at(-1)?.[0]).toBe("raw-capture:frame");
  });

  it("guards and independently rate limits the actual loss IPC handler", () => {
    const source = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
    const start = source.indexOf('ipcMain.on("raw-capture:loss"');
    const end = source.indexOf('ipcMain.on("raw-capture:frame"', start);
    const notices: unknown[] = [];
    let handler: (event: { sender: { id: number }; platform: string }, value: unknown) => void = () => undefined;
    runInNewContext(transpileModule(source.slice(start, end), {}).outputText, {
      ipcMain: { on: (_channel: string, registered: typeof handler) => { handler = registered; } },
      trustedGameIpcPlatform: (event: { platform: string }) => event.platform,
      rawCaptureLossNoticeLimiter: new RawCaptureLossNoticeLimiter(), validatedRawCaptureLossNotice,
      rawCaptureService: { recordIngressLoss: (value: unknown) => notices.push(value) }
    });
    const valid = { platform: "atlas", requestUrl: socketUrl, socketId: "ws-1", ts: at, reason: "ingress-frame-too-large" };
    handler({ sender: { id: 7 }, platform: "tcga" }, valid);
    expect(notices).toHaveLength(0);
    for (let index = 0; index < 100; index++) handler({ sender: { id: 7 }, platform: "atlas" }, valid);
    expect(notices).toHaveLength(32);
    handler({ sender: { id: 8 }, platform: "atlas" }, { ...valid, raw: "unbounded-body-must-not-be-accepted" });
    handler({ sender: { id: 8 }, platform: "atlas" }, { ...valid, reason: "pretend-recovered" });
    handler({ sender: { id: 8 }, platform: "atlas" }, { ...valid, requestUrl: "wss://evil.example" });
    expect(notices).toHaveLength(32);
    const limiter = new RawCaptureLossNoticeLimiter();
    for (let index = 0; index < 32; index++) expect(limiter.allow(7, at)).toBe(true);
    expect(limiter.allow(7, at + 9999)).toBe(false);
    expect(limiter.allow(7, at + 10000)).toBe(true);
    limiter.forget(7);
    expect(limiter.allow(7, at + 10000)).toBe(true);
  });
});
