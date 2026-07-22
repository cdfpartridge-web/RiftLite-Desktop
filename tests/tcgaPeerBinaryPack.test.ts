import { pack, type Packable } from "peerjs-js-binarypack";
import { describe, expect, it } from "vitest";
import {
  TcgaPeerMessageDecoder,
  decodeTcgaPeerBinaryPack,
  type TcgaPeerDirection
} from "../src/shared/tcgaPeerBinaryPack";

async function packed(value: Packable): Promise<Uint8Array> {
  const result = await pack(value);
  return new Uint8Array(result);
}

function frame(
  bytes: Uint8Array,
  transportSequence: number,
  direction: TcgaPeerDirection = "in"
) {
  return {
    recordSeq: transportSequence,
    transportSequence,
    capturedAt: `2026-07-20T12:00:${String(transportSequence).padStart(2, "0")}.000Z`,
    direction,
    channelKey: "game:7",
    bytes
  };
}

describe("TCGA PeerJS BinaryPack decoder", () => {
  it("decodes a direct logical game message", async () => {
    const bytes = await packed({
      type: "GAME_DATA",
      gameId: "PLAYER-1",
      payload: { turnCount: 3, currentPlayer: "PLAYER-1" }
    });

    expect(decodeTcgaPeerBinaryPack(bytes)).toMatchObject({
      type: "GAME_DATA",
      payload: { turnCount: 3 }
    });
    const decoder = new TcgaPeerMessageDecoder();
    const result = decoder.push(frame(bytes, 1));

    expect(result).toMatchObject({ decodedFrame: true, chunkFrame: false, issues: [] });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      direction: "in",
      firstTransportSequence: 1,
      completedTransportSequence: 1,
      value: { type: "GAME_DATA" }
    });
    expect(decoder.finish()).toMatchObject({
      chunkGroups: 0,
      completeChunkGroups: 0,
      incompleteChunkGroups: 0
    });
  });

  it("reassembles out-of-order chunks and isolates matching IDs by direction", async () => {
    const inboundLogical = await packed({
      type: "GAME_DATA",
      payload: { newToHistory: { text: "play.logs.player.draw" } }
    });
    const outboundLogical = await packed({
      type: "GAME_DATA",
      payload: { turnCount: 4 }
    });
    const split = (bytes: Uint8Array) => [
      bytes.slice(0, Math.ceil(bytes.byteLength / 2)),
      bytes.slice(Math.ceil(bytes.byteLength / 2))
    ];
    const inbound = split(inboundLogical);
    const outbound = split(outboundLogical);
    const chunk = (id: number, index: number, parts: Uint8Array[]) => packed({
      __peerData: id,
      n: index,
      total: parts.length,
      data: parts[index].buffer
    });
    const decoder = new TcgaPeerMessageDecoder();

    expect(decoder.push(frame(await chunk(9, 1, inbound), 1, "in")).messages).toHaveLength(0);
    expect(decoder.push(frame(await chunk(9, 0, outbound), 2, "out")).messages).toHaveLength(0);
    const inboundCompleted = decoder.push(frame(await chunk(9, 0, inbound), 3, "in"));
    const outboundCompleted = decoder.push(frame(await chunk(9, 1, outbound), 4, "out"));

    expect(inboundCompleted.messages[0]).toMatchObject({
      direction: "in",
      firstTransportSequence: 1,
      completedTransportSequence: 3,
      capturedAt: "2026-07-20T12:00:03.000Z",
      value: { type: "GAME_DATA", payload: { newToHistory: { text: "play.logs.player.draw" } } }
    });
    expect(outboundCompleted.messages[0]).toMatchObject({
      direction: "out",
      firstTransportSequence: 2,
      completedTransportSequence: 4,
      capturedAt: "2026-07-20T12:00:04.000Z",
      value: { type: "GAME_DATA", payload: { turnCount: 4 } }
    });
    expect(decoder.finish()).toMatchObject({
      chunkGroups: 2,
      completeChunkGroups: 2,
      incompleteChunkGroups: 0,
      incompleteChunkCount: 0
    });
  });

  it("reports conflicting duplicate chunks and incomplete final groups without exposing payloads", async () => {
    const decoder = new TcgaPeerMessageDecoder();
    const first = await packed({
      __peerData: 12,
      n: 0,
      total: 2,
      data: new Uint8Array([1, 2, 3]).buffer
    });
    const conflicting = await packed({
      __peerData: 12,
      n: 0,
      total: 2,
      data: new Uint8Array([9, 9, 9]).buffer
    });

    decoder.push(frame(first, 1));
    const duplicate = decoder.push(frame(conflicting, 2));
    expect(duplicate.issues.map((issue) => issue.code)).toEqual(["conflicting-chunk-duplicate"]);
    expect(decoder.finish()).toMatchObject({
      incompleteChunkGroups: 1,
      incompleteChunkCount: 1,
      duplicateChunks: 1,
      issues: { "conflicting-chunk-duplicate": 1 }
    });
  });

  it("fails closed on malformed BinaryPack bytes", () => {
    const decoder = new TcgaPeerMessageDecoder();
    const result = decoder.push(frame(new Uint8Array([0xd9]), 1));

    expect(result).toMatchObject({ decodedFrame: false, messages: [] });
    expect(result.issues.map((issue) => issue.code)).toEqual(["frame-decode-failed"]);
  });
});
