import { pack, type Packable } from "peerjs-js-binarypack";
import { describe, expect, it } from "vitest";
import { TcgaSeatCaptureBridge } from "../src/main/services/tcgaSeatCaptureBridge";
import type { TcgaWebReplayBindingEvent } from "../src/main/services/tcgaWebReplayCaptureService";

const BASE_TIME = Date.parse("2026-08-04T12:00:00.000Z");

async function packed(value: Packable): Promise<Uint8Array> {
  return new Uint8Array(await pack(value));
}

function hook(documentId: string): TcgaWebReplayBindingEvent {
  return {
    kind: "hook-ready",
    capturedAt: new Date(BASE_TIME).toISOString(),
    documentId,
    payload: {}
  };
}

function data(
  documentId: string,
  channelId: string,
  direction: "in" | "out",
  sequence: number,
  bytes: Uint8Array
): TcgaWebReplayBindingEvent {
  return {
    kind: "rtc-data",
    capturedAt: new Date(BASE_TIME + sequence * 1_000).toISOString(),
    documentId,
    payload: {
      transportSequence: sequence,
      transportCapturedAt: new Date(BASE_TIME + sequence * 1_000).toISOString(),
      direction,
      channel: { captureChannelId: channelId, label: "game", id: 1 },
      data: {
        encoding: "base64",
        data: Buffer.from(bytes).toString("base64"),
        byteLength: bytes.byteLength,
        truncated: false
      }
    }
  };
}

function channel(
  documentId: string,
  channelId: string,
  event: "observed" | "open" | "close" | "error"
): TcgaWebReplayBindingEvent {
  return {
    kind: "rtc-channel",
    capturedAt: new Date(BASE_TIME).toISOString(),
    documentId,
    payload: {
      event,
      channel: { captureChannelId: channelId, label: "game", id: 1 }
    }
  };
}

describe("TCGA seat capture bridge", () => {
  it("emits only a privacy-safe Went 2nd match update from a turn-one game frame", async () => {
    const bridge = new TcgaSeatCaptureBridge();
    bridge.ingestBindingEvent(41, hook("document-one"));

    expect(bridge.ingestBindingEvent(41, data("document-one", "game-1", "out", 1, await packed({
      type: "PLAYER_DATA",
      gameId: "PRIVATE-LOCAL-ID",
      payload: { pseudo: "Local" }
    })))).toEqual([]);
    expect(bridge.ingestBindingEvent(41, data("document-one", "game-1", "in", 2, await packed({
      type: "PLAYER_DATA",
      gameId: "PRIVATE-OPPONENT-ID",
      payload: { pseudo: "Opponent" }
    })))).toEqual([]);
    const events = bridge.ingestBindingEvent(41, data("document-one", "game-1", "in", 3, await packed({
      type: "GAME_DATA",
      gameId: "PRIVATE-OPPONENT-ID",
      payload: { turnCount: 1, currentPlayer: "PRIVATE-OPPONENT-ID" }
    })));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      platform: "tcga",
      kind: "match-update",
      payload: { active: true, reason: "tcga-peer-seat", wentFirst: "2nd" }
    });
    expect(JSON.stringify(events)).not.toContain("PRIVATE-LOCAL-ID");
    expect(JSON.stringify(events)).not.toContain("PRIVATE-OPPONENT-ID");
    expect(bridge.ingestBindingEvent(41, data("document-one", "game-1", "in", 4, await packed({
      type: "GAME_DATA",
      gameId: "PRIVATE-OPPONENT-ID",
      payload: { turnCount: 1, currentPlayer: "PRIVATE-OPPONENT-ID" }
    })))).toEqual([]);
  });

  it("holds turn-one evidence until both player directions are known", async () => {
    const bridge = new TcgaSeatCaptureBridge();
    bridge.ingestBindingEvent(41, hook("document-one"));
    bridge.ingestBindingEvent(41, data("document-one", "game-1", "out", 1, await packed({
      type: "GAME_DATA",
      gameId: "LOCAL",
      payload: { turnCount: 1, currentPlayer: "LOCAL" }
    })));

    const events = bridge.ingestBindingEvent(41, data("document-one", "game-1", "in", 2, await packed({
      type: "PLAYER_DATA",
      gameId: "OPPONENT",
      payload: {}
    })));

    expect(events[0]?.payload.wentFirst).toBe("1st");
  });

  it("rejects delayed prior-document data and malformed base64 frames", async () => {
    const bridge = new TcgaSeatCaptureBridge();
    bridge.ingestBindingEvent(41, hook("document-one"));
    bridge.ingestBindingEvent(41, hook("document-two"));
    expect(bridge.ingestBindingEvent(41, data("document-one", "game-1", "out", 1, await packed({
      type: "PLAYER_DATA",
      gameId: "LOCAL",
      payload: {}
    })))).toEqual([]);

    const malformed = data("document-two", "game-2", "out", 2, new Uint8Array([1, 2, 3]));
    malformed.payload.data = {
      encoding: "base64",
      data: "not base64!",
      byteLength: 3,
      truncated: false
    };
    expect(bridge.ingestBindingEvent(41, malformed)).toEqual([]);
  });

  it("tombstones a closed channel so delayed private frames cannot create a seat event", async () => {
    const bridge = new TcgaSeatCaptureBridge();
    bridge.ingestBindingEvent(41, hook("document-one"));
    bridge.ingestBindingEvent(41, channel("document-one", "game-1", "close"));

    bridge.ingestBindingEvent(41, data("document-one", "game-1", "out", 1, await packed({
      type: "PLAYER_DATA",
      gameId: "LOCAL",
      payload: {}
    })));
    bridge.ingestBindingEvent(41, data("document-one", "game-1", "in", 2, await packed({
      type: "PLAYER_DATA",
      gameId: "OPPONENT",
      payload: {}
    })));
    expect(bridge.ingestBindingEvent(41, data("document-one", "game-1", "in", 3, await packed({
      type: "GAME_DATA",
      gameId: "OPPONENT",
      payload: { turnCount: 1, currentPlayer: "LOCAL" }
    })))).toEqual([]);
  });
});
