import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REPLAY_PAYLOAD_POINTER_KEY,
  ReplayPayloadStore,
  replayPayloadReference
} from "../src/main/services/replayPayloadStore.js";
import type { DeckTrackerState, ReplayRecord } from "../src/shared/types.js";

function trackerState(seenCount: number, updatedAt: string): DeckTrackerState {
  return {
    active: true,
    reason: "Tracking",
    deckId: "deck-1",
    deckTitle: "Test deck",
    deckLegend: "Ahri",
    opponentLegend: "Teemo",
    platform: "atlas",
    confidence: "tracked",
    deckSize: 40,
    cardsLeft: 40 - seenCount,
    seenCount,
    updatedAt,
    pinnedCards: [],
    corrections: [],
    cards: [{
      cardKey: "card-1",
      cardId: "card-1",
      code: "card-1",
      name: "Test Card",
      imageUrl: "",
      deckCount: 3,
      seenCount,
      manualDelta: 0,
      remainingCount: 3 - seenCount,
      pinned: false,
      confidence: "tracked"
    }],
    sideboard: { phase: "main", changes: [], cardsIn: [], cardsOut: [] },
    opponent: { totalSeen: 0, totalKnown: 0, updatedAt, knownCards: [], cards: [] }
  };
}

function replay(): ReplayRecord {
  return {
    id: "replay-payload-test",
    matchId: "match-payload-test",
    platform: "atlas",
    capturedAt: "2026-07-22T10:00:00.000Z",
    title: "Payload test",
    players: { me: "Me", opponent: "Opponent" },
    events: [{
      id: "event-1",
      platform: "atlas",
      kind: "state",
      capturedAt: "2026-07-22T10:00:01.000Z",
      url: "https://play.riftatlas.com/game",
      payload: { turnText: "Turn 1" }
    }],
    structuredEvents: [],
    deckTrackerSnapshots: [
      {
        id: "snapshot-1",
        capturedAt: "2026-07-22T10:00:01.000Z",
        reason: "match-start",
        state: trackerState(0, "2026-07-22T10:00:01.000Z")
      },
      {
        id: "snapshot-2",
        capturedAt: "2026-07-22T10:00:05.000Z",
        reason: "atlas-event",
        state: trackerState(1, "2026-07-22T10:00:05.000Z")
      }
    ]
  };
}

describe("ReplayPayloadStore", () => {
  it("stores replay-heavy fields outside metadata and restores an identical public replay", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-replay-payload-"));
    try {
      const store = new ReplayPayloadStore(directory);
      const source = replay();
      const prepared = await store.prepare(source);

      expect(prepared.stored.events).toEqual([]);
      expect(prepared.stored.deckTrackerSnapshots).toBeUndefined();
      expect(prepared.stored[REPLAY_PAYLOAD_POINTER_KEY]).toMatchObject({ version: 1 });
      expect(await store.hydrate(prepared.stored)).toEqual(source);
      expect(await readdir(directory)).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses immutable content-addressed files and rejects corrupted payloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-replay-payload-corrupt-"));
    try {
      const store = new ReplayPayloadStore(directory);
      const first = await store.prepare(replay());
      const second = await store.prepare(replay());
      expect(replayPayloadReference(second.stored)?.fileName).toBe(replayPayloadReference(first.stored)?.fileName);
      expect(await readdir(directory)).toHaveLength(1);

      const fileName = replayPayloadReference(first.stored)?.fileName ?? "";
      const path = join(directory, fileName);
      const compressed = await readFile(path);
      const corrupted = Buffer.from(compressed);
      corrupted[0] = corrupted[0] ^ 0xff;
      await writeFile(path, corrupted);
      await expect(store.hydrate(first.stored)).rejects.toThrow(/checksum|size/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
