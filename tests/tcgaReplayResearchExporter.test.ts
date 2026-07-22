import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { pack, type Packable } from "peerjs-js-binarypack";
import { afterEach, describe, expect, it } from "vitest";
import {
  exportTcgaReplayResearchBundle,
  type TcgaReplayResearchExportResult
} from "../src/main/services/tcgaReplayResearchExporter";
import type { TcgaReplayRawCaptureV1 } from "../src/shared/tcgaReplayRaw";

const temporaryDirectories: string[] = [];
const BASE_TIME = Date.parse("2026-07-20T12:00:00.000Z");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

function timestamp(sequence: number): string {
  return new Date(BASE_TIME + sequence * 1_000).toISOString();
}

async function packed(value: Packable): Promise<Uint8Array> {
  return new Uint8Array(await pack(value));
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function sessionRecord(
  seq: number,
  kind: "research-session-start" | "research-session-stop",
  payload: Record<string, unknown>
) {
  return {
    schema: "riftlite-tcga-research-session",
    version: 1,
    seq,
    recordedAt: timestamp(seq),
    writtenAt: timestamp(seq),
    source: "riftlite",
    kind,
    payload
  };
}

function researchRecord(seq: number, kind: string, payload: Record<string, unknown>) {
  return {
    schema: "riftlite-tcga-research-record",
    version: 1,
    seq,
    recordedAt: timestamp(seq),
    writtenAt: timestamp(seq),
    source: kind === "page-rtc-data" ? "tcga-rtc" : "tcga-preload",
    kind,
    payload: {
      hookSequence: seq,
      monotonicMs: seq * 10,
      payload
    }
  };
}

function channelRecord(
  seq: number,
  captureChannelId: string,
  event: "observed" | "open" | "close"
) {
  return researchRecord(seq, "page-rtc-channel", {
    event,
    channel: { captureChannelId, label: "game", id: Number(captureChannelId.split("-")[1]) }
  });
}

function rtcRecord(
  seq: number,
  transportSequence: number,
  captureChannelId: string,
  bytes: Uint8Array,
  direction: "in" | "out"
) {
  return researchRecord(seq, "page-rtc-data", {
    transportSequence,
    transportCapturedAt: timestamp(seq),
    transportMonotonicMs: seq * 10,
    direction,
    channel: {
      captureChannelId,
      label: "game",
      id: Number(captureChannelId.split("-")[1])
    },
    data: {
      encoding: "base64",
      data: Buffer.from(bytes).toString("base64"),
      byteLength: bytes.byteLength,
      truncated: false
    }
  });
}

function jsonl(records: Array<Record<string, unknown>>): Buffer {
  return Buffer.from(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

async function fixtureBundle(): Promise<{
  directory: string;
  sourcePath: string;
  quickPlayerId: string;
  activePlayerId: string;
  hiddenCardName: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "riftlite-tcga-export-"));
  temporaryDirectories.push(directory);
  const sourcePath = join(directory, "tcga-replay-research-SENSITIVE-fixture.jsonl.gz");
  const quickPlayerId = "PLAYER-QUICK-LOCAL";
  const activePlayerId = "PLAYER-AKALI-LOCAL";
  const activeOpponentId = "PLAYER-IRELIA-OPPONENT";
  const hiddenCardName = "Private Irelia Card";
  const records: Array<Record<string, unknown>> = [
    sessionRecord(0, "research-session-start", { privacy: "SENSITIVE" })
  ];
  let transportSequence = 0;
  const addChannel = (captureChannelId: string, event: "observed" | "open" | "close") => {
    records.push(channelRecord(records.length, captureChannelId, event));
  };
  const addFrame = async (
    captureChannelId: string,
    direction: "in" | "out",
    bytes: Uint8Array
  ) => {
    transportSequence += 1;
    records.push(rtcRecord(
      records.length,
      transportSequence,
      captureChannelId,
      bytes,
      direction
    ));
  };

  addChannel("channel-1", "observed");
  addChannel("channel-1", "open");
  await addFrame("channel-1", "out", await packed({
    type: "PLAYER_DATA",
    gameId: quickPlayerId,
    payload: { setupStep: 2, visibleCards: [], deck: [] }
  }));
  await addFrame("channel-1", "in", await packed({
    type: "PLAYER_DATA",
    gameId: "PLAYER-QUICK-OPPONENT",
    payload: { setupStep: 2, visibleCards: [], deck: [] }
  }));
  await addFrame("channel-1", "out", await packed({ type: "LEAVING", gameId: quickPlayerId }));
  addChannel("channel-1", "close");

  addChannel("channel-2", "observed");
  addChannel("channel-2", "open");
  await addFrame("channel-2", "out", await packed({
    type: "PLAYER_DATA",
    gameId: activePlayerId,
    payload: { setupStep: 10, visibleCards: [], deck: [] }
  }));
  await addFrame("channel-2", "in", await packed({
    type: "PLAYER_DATA",
    gameId: activeOpponentId,
    payload: { setupStep: 10, visibleCards: [], deck: [] }
  }));
  await addFrame("channel-2", "out", await packed({ type: "ping", gameId: activePlayerId }));
  await addFrame("channel-2", "in", await packed({ type: "pong", gameId: activeOpponentId }));

  const gameData = await packed({
    type: "GAME_DATA",
    gameId: activeOpponentId,
    payload: {
      turnCount: 4,
      currentPlayer: activePlayerId,
      newToHistory: { text: "play.logs.player.draw", params: { count: 1 } },
      playerData: {
        visibleCards: [{
          id: "CARD-PRIVATE-1",
          hiddenTo: { [activePlayerId]: true },
          cardData: { id: "PRIVATE-001", name: hiddenCardName },
          position: { section: "Hand", index: 0 }
        }]
      }
    }
  });
  const splitAt = Math.ceil(gameData.byteLength / 2);
  const chunks = [gameData.slice(0, splitAt), gameData.slice(splitAt)];
  const packedChunks = await Promise.all(chunks.map((chunk, index) => packed({
    __peerData: 71,
    n: index,
    total: chunks.length,
    data: exactArrayBuffer(chunk)
  })));
  await addFrame("channel-2", "in", packedChunks[1]);
  await addFrame("channel-2", "in", packedChunks[0]);
  await addFrame("channel-2", "out", await packed({ type: "LEAVING", gameId: activePlayerId }));
  addChannel("channel-2", "close");

  records.push(sessionRecord(records.length, "research-session-stop", {
    reason: "user",
    recordCount: records.length - 1,
    droppedCount: 0,
    capped: false,
    capReason: ""
  }));
  await writeFile(sourcePath, gzipSync(jsonl(records)));
  return { directory, sourcePath, quickPlayerId, activePlayerId, hiddenCardName };
}

async function readCapture(summary: TcgaReplayResearchExportResult["channels"][number]) {
  return JSON.parse(gunzipSync(await readFile(summary.exportPath)).toString("utf8")) as TcgaReplayRawCaptureV1;
}

describe("TCGA replay research exporter", () => {
  it("exports separate channel-local raw captures without ping/pong messages", async () => {
    const fixture = await fixtureBundle();
    const outputDirectory = join(fixture.directory, "exports");
    const result = await exportTcgaReplayResearchBundle(fixture.sourcePath, outputDirectory);

    expect(result.channels).toHaveLength(2);
    expect(result.channels.map((channel) => channel.status)).toEqual(["exported", "exported"]);
    const quick = await readCapture(result.channels[0]);
    const active = await readCapture(result.channels[1]);

    expect(quick).toMatchObject({
      schema: "riftlite-tcga-raw-capture",
      version: 1,
      capture: {
        identity: { perspectivePlayerId: fixture.quickPlayerId },
        lifecycle: { channelKey: "channel-1", endedByLeaving: true }
      }
    });
    expect(active).toMatchObject({
      schema: "riftlite-tcga-raw-capture",
      version: 1,
      capture: {
        identity: { perspectivePlayerId: fixture.activePlayerId },
        lifecycle: { channelKey: "channel-2", endedByLeaving: true }
      },
      transport: {
        chunkGroups: 1,
        completeChunkGroups: 1,
        incompleteChunkGroups: 0
      }
    });
    expect(active.capture.captureSessionId).toMatch(/^tcga_[a-f0-9]{48}$/);
    expect(active.messages.map((message) => message.seq)).toEqual([0, 1, 2, 3]);
    expect(active.messages.map((message) => message.parsed.type)).toEqual([
      "PLAYER_DATA",
      "PLAYER_DATA",
      "GAME_DATA",
      "LEAVING"
    ]);
    expect(active.messages.some((message) => ["ping", "pong"].includes(message.parsed.type))).toBe(false);
    expect(JSON.stringify(quick)).not.toContain(fixture.activePlayerId);
    expect(JSON.stringify(active)).not.toContain(fixture.quickPlayerId);
    expect(JSON.stringify(active)).toContain(fixture.hiddenCardName);

    const safeSummary = JSON.stringify(result);
    expect(safeSummary).not.toContain(fixture.quickPlayerId);
    expect(safeSummary).not.toContain(fixture.activePlayerId);
    expect(safeSummary).not.toContain(fixture.hiddenCardName);
  });

  it("repeats an export byte-for-byte at the same deterministic destination", async () => {
    const fixture = await fixtureBundle();
    const outputDirectory = join(fixture.directory, "exports");
    const first = await exportTcgaReplayResearchBundle(fixture.sourcePath, outputDirectory);
    const firstBytes = await Promise.all(first.channels.map((channel) => readFile(channel.exportPath)));
    const second = await exportTcgaReplayResearchBundle(fixture.sourcePath, outputDirectory);
    const secondBytes = await Promise.all(second.channels.map((channel) => readFile(channel.exportPath)));

    expect(second).toEqual(first);
    expect(secondBytes).toHaveLength(firstBytes.length);
    for (const [index, bytes] of secondBytes.entries()) {
      expect(bytes.equals(firstBytes[index])).toBe(true);
    }
  });

  it("skips writes that exceed the per-channel raw JSON cap", async () => {
    const fixture = await fixtureBundle();
    const outputDirectory = join(fixture.directory, "capped-exports");
    const result = await exportTcgaReplayResearchBundle(fixture.sourcePath, outputDirectory, {
      maxRawJsonBytes: 64
    });

    expect(result.channels).toHaveLength(2);
    expect(result.channels.every((channel) => channel.status === "skipped")).toBe(true);
    expect(result.channels.every((channel) => channel.reasonCodes.includes("raw-json-limit"))).toBe(true);
    expect(await readdir(outputDirectory)).toEqual([]);
  });

  it("rejects a research bundle with a non-contiguous record sequence", async () => {
    const fixture = await fixtureBundle();
    const expanded = gunzipSync(await readFile(fixture.sourcePath)).toString("utf8");
    const records = expanded.trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    records[2].seq = 99;
    await writeFile(fixture.sourcePath, gzipSync(jsonl(records)));

    await expect(exportTcgaReplayResearchBundle(fixture.sourcePath)).rejects.toThrow(
      "record sequence is incomplete"
    );
  });
});
