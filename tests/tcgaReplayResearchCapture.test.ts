import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { pack, type Packable } from "peerjs-js-binarypack";
import { afterEach, describe, expect, it } from "vitest";
import { TcgaReplayResearchCapture } from "../src/main/services/tcgaReplayResearchCapture";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "riftlite-tcga-research-"));
  temporaryDirectories.push(directory);
  return directory;
}

function jsonlFromGzip(contents: Buffer): Array<Record<string, unknown>> {
  return gunzipSync(contents)
    .toString("utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function packed(value: Packable): Promise<Uint8Array> {
  return new Uint8Array(await pack(value));
}

async function recordReplayChannel(
  capture: TcgaReplayResearchCapture,
  gameId: string,
  captureChannelId = "channel-1"
): Promise<void> {
  const channel = { captureChannelId, label: "game", id: Number(captureChannelId.split("-")[1]) };
  await capture.record("page-rtc-channel", {
    hookSequence: 1,
    monotonicMs: 10,
    payload: { event: "open", channel }
  }, undefined, "tcga-rtc");
  const bytes = await packed({
    type: "PLAYER_DATA",
    gameId,
    payload: { setupStep: 2, visibleCards: [], deck: [] }
  });
  await capture.record("page-rtc-data", {
    hookSequence: 2,
    monotonicMs: 20,
    payload: {
      transportSequence: 1,
      transportCapturedAt: "2026-07-20T12:00:01.000Z",
      transportMonotonicMs: 20,
      direction: "out",
      channel,
      data: {
        encoding: "base64",
        data: Buffer.from(bytes).toString("base64"),
        byteLength: bytes.byteLength,
        truncated: false
      }
    }
  }, undefined, "tcga-rtc");
}

describe("TCGA replay research capture", () => {
  it("is runtime-off by default and atomically exports sanitized exact records", async () => {
    const directory = await temporaryDirectory();
    let now = Date.parse("2026-07-20T12:00:00.000Z");
    const capture = new TcgaReplayResearchCapture(directory, "0.9.00-research", {
      now: () => now
    });

    expect(capture.getStatus()).toMatchObject({ active: false, recordCount: 0, privacy: "SENSITIVE" });
    await capture.record("ignored-before-opt-in", { actionId: "NOPE" });
    expect(capture.getStatus().recordCount).toBe(0);

    const started = await capture.start();
    expect(started).toMatchObject({ active: true, recordCount: 0, transportState: "waiting" });
    expect(started.workingPath).toContain("active-SENSITIVE");
    capture.setTransportState("ready");

    now += 1_000;
    await capture.record("network-websocket", {
      requestUrl: "wss://tcg-arena.fr/game/GAME-1?access_token=private-token",
      headers: { authorization: "Bearer private-header" },
      actionId: "ACTION-1",
      gameId: "GAME-1",
      card: { cardId: "OGN-001", name: "Jinx" }
    }, "2026-07-20T12:00:01.000Z", "tcga-cdp");
    now += 1_000;
    const stopped = await capture.stop("tester-finished");

    expect(stopped).toMatchObject({
      active: false,
      stopReason: "tester-finished",
      recordCount: 1,
      recordKinds: { "network-websocket": 1 },
      transportState: "ready",
      droppedCount: 0,
      capped: false,
      webReplayExports: [],
      webReplayExportError: ""
    });
    expect(stopped.exportPath).toContain("SENSITIVE");
    expect(stopped.exportPath).toMatch(/\.jsonl\.gz$/);
    expect(stopped.summaryPath).toMatch(/\.summary\.json$/);
    expect(stopped.analysisPath).toMatch(/\.analysis\.json$/);
    expect(stopped.analysis).toMatchObject({
      schema: "riftlite-tcga-research-analysis",
      assessment: { decoderFixture: "unusable", replayTimeline: "unusable" },
      privacy: { safeAggregateOnly: true, includesDecodedPayloads: false }
    });
    expect(stopped.workingPath).toBe("");

    const compressed = await readFile(stopped.exportPath);
    expect(stopped.sha256).toBe(createHash("sha256").update(compressed).digest("hex"));
    expect(stopped.compressedBytes).toBe(compressed.byteLength);
    const lines = jsonlFromGzip(compressed);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ kind: "research-session-start", seq: 0 });
    expect(lines[1]).toMatchObject({
      seq: 1,
      recordedAt: "2026-07-20T12:00:01.000Z",
      source: "tcga-cdp",
      kind: "network-websocket",
      payload: {
        requestUrl: "wss://tcg-arena.fr/game/GAME-1",
        actionId: "ACTION-1",
        gameId: "GAME-1",
        card: { cardId: "OGN-001", name: "Jinx" }
      }
    });
    expect(JSON.stringify(lines)).not.toContain("private-token");
    expect(JSON.stringify(lines)).not.toContain("private-header");
    expect(lines[2]).toMatchObject({
      kind: "research-session-stop",
      payload: { reason: "tester-finished", recordCount: 1 }
    });

    const summary = JSON.parse(await readFile(stopped.summaryPath, "utf8")) as Record<string, unknown>;
    expect(summary).toMatchObject({
      schema: "riftlite-tcga-research-summary",
      sha256: stopped.sha256,
      recordCount: 1,
      recordKinds: { "network-websocket": 1 },
      transportState: "ready",
      stopReason: "tester-finished",
      privacy: { sensitiveDataIncluded: true },
      analysisFile: expect.stringMatching(/\.analysis\.json$/),
      assessment: { decoderFixture: "unusable", replayTimeline: "unusable" },
      webReplayExports: [],
      webReplayExportError: ""
    });
    const analysis = JSON.parse(await readFile(stopped.analysisPath, "utf8")) as Record<string, unknown>;
    expect(analysis).toEqual(stopped.analysis);
    expect(JSON.stringify(analysis)).not.toContain("private-token");
    expect(JSON.stringify(analysis)).not.toContain("private-header");
    expect((await readdir(directory)).some((name) => name.includes("active-SENSITIVE"))).toBe(false);
  });

  it("automatically creates a local per-channel Web Replay companion on stop", async () => {
    const directory = await temporaryDirectory();
    const capture = new TcgaReplayResearchCapture(directory, "test");
    await capture.start();
    await recordReplayChannel(capture, "PLAYER-PRIVATE-LOCAL");

    const stopped = await capture.stop("tester-finished");

    expect(stopped.webReplayExportError).toBe("");
    expect(stopped.webReplayExports).toHaveLength(1);
    expect(stopped.webReplayExports[0]).toMatchObject({
      ordinal: 1,
      status: "exported",
      messageCount: 1,
      playerCount: 1,
      perspectivePresent: true,
      reasonCodes: []
    });
    expect(stopped.webReplayExports[0].exportPath).toMatch(/\.web-replay\.json\.gz$/);
    expect((await readFile(stopped.webReplayExports[0].exportPath)).byteLength).toBeGreaterThan(0);
    const serializedStatus = JSON.stringify(stopped);
    expect(serializedStatus).not.toContain("PLAYER-PRIVATE-LOCAL");

    const summary = JSON.parse(await readFile(stopped.summaryPath, "utf8")) as {
      webReplayExports: Array<{ exportPath: string; messageCount: number }>;
      webReplayExportError: string;
    };
    expect(summary.webReplayExportError).toBe("");
    expect(summary.webReplayExports).toEqual([
      expect.objectContaining({
        exportPath: expect.stringMatching(/\.web-replay\.json\.gz$/),
        messageCount: 1
      })
    ]);
    expect(summary.webReplayExports[0].exportPath).not.toContain(directory);
  });

  it("keeps the research capture when Web Replay companion generation fails", async () => {
    const directory = await temporaryDirectory();
    const capture = new TcgaReplayResearchCapture(directory, "test", {}, {
      exportWebReplay: async () => {
        throw new Error("PRIVATE exporter detail must not cross IPC");
      }
    });
    await capture.start();
    await capture.record("action", { actionId: "A-1" });

    const stopped = await capture.stop("tester-finished");

    expect(stopped).toMatchObject({
      active: false,
      stopReason: "tester-finished",
      lastError: "",
      webReplayExports: [],
      webReplayExportError: "web-replay-export-failed"
    });
    expect((await readFile(stopped.exportPath)).byteLength).toBeGreaterThan(0);
    expect((await readFile(stopped.summaryPath)).byteLength).toBeGreaterThan(0);
    expect(JSON.stringify(stopped)).not.toContain("PRIVATE exporter detail");
    const summary = JSON.parse(await readFile(stopped.summaryPath, "utf8")) as Record<string, unknown>;
    expect(summary.webReplayExportError).toBe("web-replay-export-failed");
    expect(JSON.stringify(summary)).not.toContain("PRIVATE exporter detail");
  });

  it("stops at the record cap and ignores later records", async () => {
    const directory = await temporaryDirectory();
    const capture = new TcgaReplayResearchCapture(directory, "test", {
      maxRecords: 2
    });
    await capture.start();
    await capture.record("action", { actionId: "A-1" });
    await capture.record("action", { actionId: "A-2" });
    await capture.record("action", { actionId: "A-3" });

    expect(capture.getStatus()).toMatchObject({
      active: false,
      recordCount: 2,
      capped: true,
      capReason: "record-limit",
      stopReason: "record-limit"
    });
    const records = jsonlFromGzip(await readFile(capture.getStatus().exportPath));
    expect(records.filter((record) => record.kind === "action")).toHaveLength(2);
    expect(JSON.stringify(records)).not.toContain("A-3");
  });

  it("stops before writing a record that exceeds the byte cap", async () => {
    const directory = await temporaryDirectory();
    const capture = new TcgaReplayResearchCapture(directory, "test", {
      maxBytes: 400
    });
    await capture.start();
    await capture.record("oversized", { body: "x".repeat(2_000) });

    expect(capture.getStatus()).toMatchObject({
      active: false,
      recordCount: 0,
      droppedCount: 1,
      byteCount: 0,
      capped: true,
      capReason: "byte-limit",
      stopReason: "byte-limit"
    });
  });

  it("enforces the two-hour-style duration cap without relying on persisted settings", async () => {
    const directory = await temporaryDirectory();
    let now = Date.parse("2026-07-20T12:00:00.000Z");
    const capture = new TcgaReplayResearchCapture(directory, "test", {
      maxDurationMs: 100,
      now: () => now
    });
    await capture.start();
    now += 101;
    await capture.record("late-action", { actionId: "LATE" });

    expect(capture.getStatus()).toMatchObject({
      active: false,
      recordCount: 0,
      capped: true,
      capReason: "duration-limit",
      stopReason: "duration-limit"
    });
  });

  it("retains at most three exports and deletes only its own files", async () => {
    const directory = await temporaryDirectory();
    const unrelatedPath = join(directory, "keep-me.txt");
    await writeFile(unrelatedPath, "unrelated", "utf8");
    let now = Date.now();
    const capture = new TcgaReplayResearchCapture(directory, "test", {
      retentionFiles: 3,
      now: () => now
    });
    const companionPaths: string[] = [];

    for (let index = 0; index < 4; index += 1) {
      now += 1_000;
      await capture.start();
      await recordReplayChannel(capture, `PLAYER-${index}`);
      const stopped = await capture.stop(`session-${index}`);
      companionPaths.push(stopped.webReplayExports[0].exportPath);
    }

    const retained = await readdir(directory);
    expect(retained.filter((name) => name.endsWith(".jsonl.gz"))).toHaveLength(3);
    expect(retained.filter((name) => name.endsWith(".summary.json"))).toHaveLength(3);
    expect(retained.filter((name) => name.endsWith(".analysis.json"))).toHaveLength(3);
    expect(retained.filter((name) => name.endsWith(".web-replay.json.gz"))).toHaveLength(3);
    expect(retained).toContain("keep-me.txt");
    const companionStillExists = await Promise.all(companionPaths.map(async (path) => (
      readFile(path).then(() => true).catch(() => false)
    )));
    expect(companionStillExists.filter(Boolean)).toHaveLength(3);
    expect(companionStillExists.filter((exists) => !exists)).toHaveLength(1);

    await capture.start();
    const deleted = await capture.deleteAll();
    expect(deleted).toMatchObject({ active: false, stopReason: "deleted" });
    expect(deleted.deletedFiles).toBeGreaterThanOrEqual(10);
    expect(await readdir(directory)).toEqual(["keep-me.txt"]);
  });
});
