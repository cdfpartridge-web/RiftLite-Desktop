import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { pack, type Packable } from "peerjs-js-binarypack";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeTcgaReplayResearchBundle,
  analyzeTcgaReplayResearchJsonl
} from "../src/main/services/tcgaReplayResearchAnalyzer";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

async function packed(value: Packable): Promise<Uint8Array> {
  return new Uint8Array(await pack(value));
}

function sessionRecord(seq: number, kind: "research-session-start" | "research-session-stop", payload: Record<string, unknown>) {
  return {
    schema: "riftlite-tcga-research-session",
    version: 1,
    seq,
    recordedAt: "2026-07-20T12:00:00.000Z",
    writtenAt: "2026-07-20T12:00:00.000Z",
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
    recordedAt: `2026-07-20T12:00:${String(seq).padStart(2, "0")}.000Z`,
    writtenAt: `2026-07-20T12:00:${String(seq).padStart(2, "0")}.000Z`,
    source: kind === "page-rtc-data" ? "tcga-rtc" : "tcga-preload",
    kind,
    payload
  };
}

function rtcRecord(seq: number, bytes: Uint8Array, direction: "in" | "out" = "in") {
  return researchRecord(seq, "page-rtc-data", {
    hookSequence: seq,
    monotonicMs: seq * 10,
    payload: {
      transportSequence: seq,
      transportCapturedAt: `2026-07-20T12:00:${String(seq).padStart(2, "0")}.000Z`,
      transportMonotonicMs: seq * 10,
      direction,
      channel: { label: "game", id: 7 },
      data: {
        encoding: "base64",
        data: Buffer.from(bytes).toString("base64"),
        byteLength: bytes.byteLength,
        truncated: false
      }
    }
  });
}

function jsonl(records: Array<Record<string, unknown>>): Buffer {
  return Buffer.from(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

async function completeSyntheticCapture() {
  const secretPlayerId = "PLAYER-PRIVATE-123";
  const secretCardName = "Secret Test Card";
  const playerData = {
    setupStep: 2,
    isEliminated: false,
    visibleCards: [{
      id: "CARD-INSTANCE-PRIVATE",
      hiddenTo: { status: "opponent-only", [secretPlayerId]: true },
      cardData: { id: "TST-001", name: secretCardName },
      position: { section: "Hand", index: 0 }
    }],
    deck: []
  };
  const messages: Packable[] = [
    { type: "PLAYER_DATA", gameId: secretPlayerId, payload: playerData },
    {
      type: "NEWCOMMER_GAMEDATA",
      gameId: secretPlayerId,
      payload: {
        players: { [secretPlayerId]: playerData },
        general: { turnCount: 1 }
      }
    },
    {
      type: "GAME_DATA",
      gameId: secretPlayerId,
      payload: { playerData, gameOptions: { format: "Classic" } }
    },
    {
      type: "GAME_DATA",
      gameId: secretPlayerId,
      payload: {
        turnCount: 2,
        currentPlayer: secretPlayerId,
        stackOrder: [],
        revealed: { cards: [] }
      }
    },
    {
      type: "GAME_DATA",
      gameId: secretPlayerId,
      payload: { newToHistory: { text: "play.logs.player.draw", params: { count: 1 } } }
    }
  ];
  const records: Array<Record<string, unknown>> = [
    sessionRecord(0, "research-session-start", { privacy: "SENSITIVE" })
  ];
  for (const [index, message] of messages.entries()) {
    records.push(rtcRecord(index + 1, await packed(message), index % 2 ? "out" : "in"));
  }
  records.push(researchRecord(records.length, "capture-match-end", {
    payload: { active: false, endText: "Match complete", roomCode: "ROOM-PRIVATE-999" }
  }));
  const count = records.length - 1;
  records.push(sessionRecord(records.length, "research-session-stop", {
    reason: "user",
    recordCount: count,
    droppedCount: 0,
    capped: false,
    capReason: ""
  }));
  return { records, secretPlayerId, secretCardName };
}

describe("TCGA replay research analyzer", () => {
  it("produces a complete, privacy-safe aggregate report for a complete fixture", async () => {
    const fixture = await completeSyntheticCapture();
    const report = analyzeTcgaReplayResearchJsonl(jsonl(fixture.records), {
      compressedBytes: 1_234,
      compressedSha256: "a".repeat(64),
      expectedCompressedSha256: "a".repeat(64)
    });

    expect(report.sourceIntegrity).toMatchObject({
      headerPresent: true,
      footerPresent: true,
      invalidJsonLines: 0,
      contiguousSequence: true,
      declaredRecordCountMatches: true,
      compressedSha256Matches: true,
      capped: false,
      droppedRecords: 0
    });
    expect(report.transport).toMatchObject({
      frames: 5,
      decodedFrames: 5,
      logicalMessages: 5,
      decodeFailures: 0,
      incompleteChunkGroups: 0,
      directions: { in: 3, out: 2 }
    });
    expect(report.coverage).toMatchObject({
      initialState: true,
      playerState: true,
      setup: true,
      mulligan: true,
      turns: true,
      history: true,
      stack: true,
      reveal: true,
      terminal: true,
      stateSnapshots: 1,
      historyEvents: 1
    });
    expect(report.assessment).toEqual({
      decoderFixture: "usable",
      replayTimeline: "complete",
      reasonCodes: []
    });
    expect(report.privacy).toMatchObject({
      rawInput: "SENSITIVE",
      hiddenCardIdentityObserved: true,
      safeAggregateOnly: true,
      includesDecodedPayloads: false,
      includesPlayerIdentifiers: false,
      includesCardIdentities: false
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(fixture.secretPlayerId);
    expect(serialized).not.toContain(fixture.secretCardName);
    expect(serialized).not.toContain("ROOM-PRIVATE-999");
  });

  it("marks an otherwise usable capped capture partial when a chunk group is incomplete", async () => {
    const fixture = await completeSyntheticCapture();
    fixture.records.pop();
    const logical = await packed({ type: "GAME_DATA", payload: { turnCount: 3 } });
    const firstHalf = logical.slice(0, Math.ceil(logical.byteLength / 2));
    const incompleteChunk = await packed({
      __peerData: 77,
      n: 0,
      total: 2,
      data: firstHalf.buffer
    });
    fixture.records.push(rtcRecord(fixture.records.length, incompleteChunk));
    const count = fixture.records.length - 1;
    fixture.records.push(sessionRecord(fixture.records.length, "research-session-stop", {
      reason: "byte-limit",
      recordCount: count,
      droppedCount: 1,
      capped: true,
      capReason: "byte-limit"
    }));

    const report = analyzeTcgaReplayResearchJsonl(jsonl(fixture.records));
    expect(report.assessment).toMatchObject({
      decoderFixture: "usable",
      replayTimeline: "partial"
    });
    expect(report.transport.incompleteChunkGroups).toBe(1);
    expect(report.assessment.reasonCodes).toEqual(expect.arrayContaining([
      "capture-capped",
      "records-dropped",
      "incomplete-chunk-groups"
    ]));
  });

  it("fails the integrity assessment for sequence gaps without echoing malformed input", async () => {
    const fixture = await completeSyntheticCapture();
    fixture.records[2].seq = 99;
    const report = analyzeTcgaReplayResearchJsonl(jsonl(fixture.records));

    expect(report.sourceIntegrity.contiguousSequence).toBe(false);
    expect(report.assessment.replayTimeline).toBe("partial");
    expect(report.assessment.reasonCodes).toContain("record-sequence-gap");
  });

  it("does not call a mid-game capture complete merely because the page becomes inactive", async () => {
    const playerData = {
      setupStep: 10,
      isEliminated: false,
      visibleCards: [],
      deck: []
    };
    const messages: Packable[] = [
      { type: "PLAYER_DATA", gameId: "PLAYER-MIDGAME", payload: playerData },
      { type: "GAME_DATA", gameId: "PLAYER-MIDGAME", payload: { playerData, turnCount: 6 } },
      {
        type: "GAME_DATA",
        gameId: "PLAYER-MIDGAME",
        payload: { newToHistory: { text: "play.logs.player.draw", params: { count: 1 } } }
      }
    ];
    const records: Array<Record<string, unknown>> = [
      sessionRecord(0, "research-session-start", { privacy: "SENSITIVE" })
    ];
    for (const [index, message] of messages.entries()) {
      records.push(rtcRecord(index + 1, await packed(message)));
    }
    records.push(researchRecord(records.length, "capture-match-end", {
      payload: { active: false, endText: "", reason: "inactive-debounce" }
    }));
    const count = records.length - 1;
    records.push(sessionRecord(records.length, "research-session-stop", {
      reason: "user",
      recordCount: count,
      droppedCount: 0,
      capped: false,
      capReason: ""
    }));

    const report = analyzeTcgaReplayResearchJsonl(jsonl(records));
    expect(report.assessment).toMatchObject({
      decoderFixture: "usable",
      replayTimeline: "partial"
    });
    expect(report.coverage).toMatchObject({ initialState: false, setup: false, terminal: false });
    expect(report.assessment.reasonCodes).toEqual(expect.arrayContaining([
      "missing-initial-state",
      "missing-terminal-evidence"
    ]));
  });

  it("verifies a compressed bundle against its summary checksum", async () => {
    const fixture = await completeSyntheticCapture();
    const compressed = gzipSync(jsonl(fixture.records));
    const directory = await mkdtemp(join(tmpdir(), "riftlite-tcga-analysis-"));
    temporaryDirectories.push(directory);
    const exportPath = join(directory, "tcga-replay-research-SENSITIVE-fixture.jsonl.gz");
    const summaryPath = join(directory, "tcga-replay-research-SENSITIVE-fixture.summary.json");
    const sha256 = createHash("sha256").update(compressed).digest("hex");
    await writeFile(exportPath, compressed);
    await writeFile(summaryPath, JSON.stringify({ sha256 }), "utf8");

    const report = await analyzeTcgaReplayResearchBundle(exportPath);
    expect(report.sourceIntegrity).toMatchObject({
      compressedSha256Matches: true,
      compressedBytes: compressed.byteLength
    });
    expect(report.assessment.replayTimeline).toBe("complete");

    await writeFile(summaryPath, JSON.stringify({ sha256: "0".repeat(64) }), "utf8");
    const mismatched = await analyzeTcgaReplayResearchBundle(exportPath);
    expect(mismatched.sourceIntegrity.compressedSha256Matches).toBe(false);
    expect(mismatched.assessment.replayTimeline).toBe("partial");
    expect(mismatched.assessment.reasonCodes).toContain("checksum-mismatch");
  });
});
