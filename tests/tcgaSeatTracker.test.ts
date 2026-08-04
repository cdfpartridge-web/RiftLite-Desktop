import { pack, type Packable } from "peerjs-js-binarypack";
import { describe, expect, it } from "vitest";
import {
  TcgaSeatTracker,
  tcgaSeatCaptureEvent
} from "../src/shared/tcgaSeatTracker";
import type { TcgaPeerDirection } from "../src/shared/tcgaPeerBinaryPack";

async function packed(value: Packable): Promise<Uint8Array> {
  return new Uint8Array(await pack(value));
}

function frame(
  bytes: Uint8Array,
  transportSequence: number,
  direction: TcgaPeerDirection,
  channelKey = "peer-channel-1"
) {
  return {
    recordSeq: transportSequence,
    transportSequence,
    capturedAt: `2026-08-04T20:00:${String(transportSequence).padStart(2, "0")}.000Z`,
    direction,
    channelKey,
    bytes
  };
}

async function identity(type: "PLAYER_DATA" | "GAME_DATA", gameId: string): Promise<Uint8Array> {
  return packed({ type, gameId, payload: {} });
}

describe("TCGA seat tracker", () => {
  it("identifies a local first player using directional player identities", async () => {
    const tracker = new TcgaSeatTracker();

    expect(tracker.push(frame(await identity("PLAYER_DATA", "LOCAL-ID"), 1, "out"))).toBeNull();
    expect(tracker.push(frame(await identity("PLAYER_DATA", "OPPONENT-ID"), 2, "in"))).toBeNull();
    const signal = tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "OPPONENT-ID",
      payload: { turnCount: 1, currentPlayer: "LOCAL-ID" }
    }), 3, "in"));

    expect(signal).toEqual({
      channelKey: "peer-channel-1",
      capturedAt: "2026-08-04T20:00:03.000Z",
      transportSequence: 3,
      wentFirst: "1st"
    });
  });

  it("identifies an opponent first player using GAME_DATA identities", async () => {
    const tracker = new TcgaSeatTracker();

    expect(tracker.push(frame(await identity("GAME_DATA", "LOCAL-ID"), 1, "out"))).toBeNull();
    const signal = tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "OPPONENT-ID",
      payload: { turnCount: 1, currentPlayer: "OPPONENT-ID" }
    }), 2, "in"));

    expect(signal?.wentFirst).toBe("2nd");
  });

  it("retains turn-one evidence until both identities are known and emits once", async () => {
    const tracker = new TcgaSeatTracker();

    expect(tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "LOCAL-ID",
      payload: { turnCount: 1, currentPlayer: "OPPONENT-ID" }
    }), 1, "out"))).toBeNull();
    const signal = tracker.push(frame(await identity("PLAYER_DATA", "OPPONENT-ID"), 2, "in"));
    expect(signal).toMatchObject({
      capturedAt: "2026-08-04T20:00:01.000Z",
      transportSequence: 1,
      wentFirst: "2nd"
    });

    expect(tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "LOCAL-ID",
      payload: { turnCount: 1, currentPlayer: "OPPONENT-ID" }
    }), 3, "out"))).toBeNull();
  });

  it("reassembles chunked turn-one GAME_DATA before deciding", async () => {
    const tracker = new TcgaSeatTracker();
    expect(tracker.push(frame(await identity("PLAYER_DATA", "LOCAL-ID"), 1, "out"))).toBeNull();
    expect(tracker.push(frame(await identity("PLAYER_DATA", "OPPONENT-ID"), 2, "in"))).toBeNull();
    const logical = await packed({
      type: "GAME_DATA",
      gameId: "OPPONENT-ID",
      payload: { turnCount: 1, currentPlayer: "LOCAL-ID" }
    });
    const splitAt = Math.ceil(logical.byteLength / 2);
    const parts = [logical.slice(0, splitAt), logical.slice(splitAt)];
    const chunk = (index: number) => packed({
      __peerData: 77,
      n: index,
      total: parts.length,
      data: parts[index].buffer
    });

    expect(tracker.push(frame(await chunk(1), 3, "in"))).toBeNull();
    expect(tracker.push(frame(await chunk(0), 4, "in"))).toMatchObject({
      capturedAt: "2026-08-04T20:00:04.000Z",
      transportSequence: 4,
      wentFirst: "1st"
    });
  });

  it("fails closed on ambiguous identities and conflicting first-player evidence", async () => {
    const ambiguousIdentity = new TcgaSeatTracker();
    ambiguousIdentity.push(frame(await identity("PLAYER_DATA", "LOCAL-A"), 1, "out"));
    ambiguousIdentity.push(frame(await identity("GAME_DATA", "LOCAL-B"), 2, "out"));
    ambiguousIdentity.push(frame(await identity("PLAYER_DATA", "OPPONENT"), 3, "in"));
    expect(ambiguousIdentity.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "OPPONENT",
      payload: { turnCount: 1, currentPlayer: "OPPONENT" }
    }), 4, "in"))).toBeNull();

    const conflictingEvidence = new TcgaSeatTracker();
    conflictingEvidence.push(frame(await identity("PLAYER_DATA", "LOCAL"), 1, "out"));
    conflictingEvidence.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "LOCAL",
      payload: { turnCount: 1, currentPlayer: "LOCAL" }
    }), 2, "out"));
    conflictingEvidence.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "OPPONENT",
      payload: { turnCount: 1, currentPlayer: "OPPONENT" }
    }), 3, "in"));
    expect(conflictingEvidence.push(frame(await identity("PLAYER_DATA", "OPPONENT"), 4, "in"))).toBeNull();
  });

  it("ignores malformed, unknown, and non-integer turn evidence", async () => {
    const tracker = new TcgaSeatTracker();
    tracker.push(frame(await identity("PLAYER_DATA", "LOCAL"), 1, "out"));
    tracker.push(frame(await identity("PLAYER_DATA", "OPPONENT"), 2, "in"));

    expect(tracker.push(frame(new Uint8Array([0xd9]), 3, "in"))).toBeNull();
    expect(tracker.push(frame(await packed({
      type: "PING",
      gameId: "OPPONENT",
      payload: { turnCount: 1, currentPlayer: "LOCAL" }
    }), 4, "in"))).toBeNull();
    expect(tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "OPPONENT",
      payload: { turnCount: "1", currentPlayer: "LOCAL" }
    }), 5, "in"))).toBeNull();
    expect(tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "OPPONENT",
      payload: { turnCount: 1 }
    }), 6, "in"))).toBeNull();
    expect(tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "OPPONENT",
      payload: { turnCount: 1, currentPlayer: "UNKNOWN" }
    }), 7, "in"))).toBeNull();
  });

  it("keeps channel state isolated and permits a fresh game after forgetting a channel", async () => {
    const tracker = new TcgaSeatTracker();
    tracker.push(frame(await identity("PLAYER_DATA", "LOCAL-A"), 1, "out", "channel-a"));
    tracker.push(frame(await identity("PLAYER_DATA", "OPPONENT-B"), 2, "in", "channel-b"));
    expect(tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "OPPONENT-B",
      payload: { turnCount: 1, currentPlayer: "OPPONENT-B" }
    }), 3, "in", "channel-b"))).toBeNull();

    tracker.forgetChannel("channel-b");
    tracker.push(frame(await identity("PLAYER_DATA", "LOCAL-B"), 4, "out", "channel-b"));
    tracker.push(frame(await identity("PLAYER_DATA", "OPPONENT-B"), 5, "in", "channel-b"));
    expect(tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "LOCAL-B",
      payload: { turnCount: 1, currentPlayer: "LOCAL-B" }
    }), 6, "out", "channel-b"))).toMatchObject({ wentFirst: "1st" });
  });

  it("emits a fresh seat when TCGA reuses one channel for the next game", async () => {
    const tracker = new TcgaSeatTracker();
    tracker.push(frame(await packed({
      type: "PLAYER_DATA",
      gameId: "LOCAL",
      payload: { setupStep: 10 }
    }), 1, "out"));
    tracker.push(frame(await packed({
      type: "PLAYER_DATA",
      gameId: "OPPONENT",
      payload: { setupStep: 10 }
    }), 2, "in"));
    expect(tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "LOCAL",
      payload: { playerData: { setupStep: 10 }, turnCount: 1, currentPlayer: "LOCAL" }
    }), 3, "out"))).toMatchObject({ wentFirst: "1st" });

    expect(tracker.push(frame(await packed({
      type: "PLAYER_DATA",
      gameId: "OPPONENT",
      payload: { setupStep: 0 }
    }), 4, "in"))).toBeNull();
    tracker.push(frame(await packed({
      type: "PLAYER_DATA",
      gameId: "LOCAL",
      payload: { setupStep: 10 }
    }), 5, "out"));
    tracker.push(frame(await packed({
      type: "PLAYER_DATA",
      gameId: "OPPONENT",
      payload: { setupStep: 10 }
    }), 6, "in"));
    expect(tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "OPPONENT",
      payload: { playerData: { setupStep: 10 }, turnCount: 1, currentPlayer: "OPPONENT" }
    }), 7, "in"))).toMatchObject({ wentFirst: "2nd" });
  });

  it("uses game-options only as a restart epoch when turn one arrives first", async () => {
    const tracker = new TcgaSeatTracker();
    tracker.push(frame(await identity("PLAYER_DATA", "LOCAL"), 1, "out"));
    tracker.push(frame(await identity("PLAYER_DATA", "OPPONENT"), 2, "in"));
    expect(tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "LOCAL",
      payload: {
        gameOptions: {
          version: 1,
          senderId: "LOCAL",
          startingPlayer: { id: "OPPONENT" }
        },
        turnCount: 1,
        currentPlayer: "LOCAL"
      }
    }), 3, "out"))).toMatchObject({ wentFirst: "1st" });
    tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "LOCAL",
      payload: { turnCount: 2, currentPlayer: "OPPONENT" }
    }), 4, "out"));

    expect(tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "OPPONENT",
      payload: { turnCount: 1, currentPlayer: "OPPONENT" }
    }), 5, "in"))).toBeNull();
    expect(tracker.push(frame(await packed({
      type: "GAME_DATA",
      gameId: "LOCAL",
      payload: {
        gameOptions: {
          version: 2,
          senderId: "LOCAL",
          startingPlayer: { id: "LOCAL" }
        }
      }
    }), 6, "out"))).toMatchObject({
      capturedAt: "2026-08-04T20:00:05.000Z",
      transportSequence: 5,
      wentFirst: "2nd"
    });
  });

  it("creates a privacy-safe match logger event without player or channel IDs", () => {
    const event = tcgaSeatCaptureEvent({
      channelKey: "SECRET-CHANNEL",
      capturedAt: "2026-08-04T20:00:09.000Z",
      transportSequence: 9,
      wentFirst: "2nd"
    });

    expect(event).toEqual({
      id: "tcga-seat:1785873609000:9:2nd",
      platform: "tcga",
      kind: "match-update",
      capturedAt: "2026-08-04T20:00:09.000Z",
      url: "https://tcg-arena.fr/play",
      payload: {
        active: true,
        reason: "tcga-peer-seat",
        wentFirst: "2nd"
      }
    });
    expect(JSON.stringify(event)).not.toContain("SECRET-CHANNEL");
    expect(JSON.stringify(event)).not.toContain("LOCAL-ID");
    expect(JSON.stringify(event)).not.toContain("OPPONENT-ID");
  });

  it("fails closed instead of coercing an invalid seat signal", () => {
    expect(() => tcgaSeatCaptureEvent({
      channelKey: "channel",
      capturedAt: "not-a-date",
      transportSequence: -1,
      wentFirst: "invalid" as "1st"
    })).toThrow("Invalid TCGA seat signal");
  });
});
