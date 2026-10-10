import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RiftLiteStore } from "../src/main/services/store.js";
import type { ReplayPayloadStore } from "../src/main/services/replayPayloadStore.js";
import type { MatchDraft, ReplayRecord, RiftLiteBackupFile } from "../src/shared/types.js";

vi.mock("electron", () => ({ app: { getVersion: () => "cache-test" } }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function replay(title = "Original recording"): ReplayRecord {
  return {
    id: "cache-replay",
    matchId: "cache-match",
    platform: "atlas",
    capturedAt: "2026-09-04T12:00:00.000Z",
    title,
    players: { me: "Player", opponent: "Opponent" },
    events: []
  };
}

function payloadStore(store: RiftLiteStore): ReplayPayloadStore {
  return (store as unknown as { replayPayloadStore: ReplayPayloadStore }).replayPayloadStore;
}

function parentMatch(): MatchDraft {
  return {
    id: replay().matchId, platform: "atlas", source: "auto", status: "saved",
    capturedAt: replay().capturedAt, updatedAt: replay().capturedAt,
    result: "Win", format: "Bo1", score: "8-6", myName: "Player", opponentName: "Opponent",
    myChampion: "Ahri", opponentChampion: "Lux", myBattlefield: "", opponentBattlefield: "",
    deckName: "", deckSourceId: "", flags: "", notes: "", games: [], rawEvidence: [],
    sync: { community: "disabled", hubs: {}, teams: {} }
  };
}

async function withStore(action: (store: RiftLiteStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "riftlite-replay-cache-test-"));
  try {
    const store = new RiftLiteStore(join(directory, "store.sqlite"), join(directory, "legacy.json"));
    await store.load();
    await store.saveMatch(parentMatch());
    await store.saveReplay(replay());
    await action(store);
  } finally {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
}

describe("RiftLiteStore replay cache consistency", () => {
  it.each(["save", "update", "active-update", "delete", "restore"] as const)(
    "keeps a completed %s visible after an older payload load finishes",
    async (operation) => withStore(async (store) => {
      const started = deferred();
      const release = deferred();
      const payloads = payloadStore(store);
      const hydrate = payloads.hydrate.bind(payloads);
      vi.spyOn(payloads, "hydrate").mockImplementationOnce(async (stored) => {
        const loaded = await hydrate(stored);
        started.resolve();
        await release.promise;
        return loaded;
      });
      const earlierRead = store.getReplays();
      await started.promise;
      try {
        if (operation === "save") {
          await store.saveReplay(replay("Committed recording"));
        } else if (operation === "update") {
          await store.updateReplay(replay().id, (current) => ({ ...current, title: "Committed recording" }));
        } else if (operation === "active-update") {
          await store.updateActiveReplay(replay().id, (current) => ({ ...current, title: "Committed recording" }));
        } else if (operation === "delete") {
          await store.deleteReplay(replay().id);
        } else {
          const backup: RiftLiteBackupFile = {
            format: "riftlite.backup", version: 1, appVersion: "cache-test", exportedAt: "2026-09-04T12:00:00.000Z",
            settings: await store.getSettings(), matches: [], deletedMatches: [], decks: [], notebooks: [],
            replays: [replay("Committed recording")], deletedReplays: []
          };
          await store.restoreBackupData(backup);
        }
      } finally {
        release.resolve();
      }
      // The request that began before the write may retain its original snapshot.
      expect((await earlierRead)[0].title).toBe("Original recording");
      const current = await store.getReplays();
      expect(current.map((item) => item.title)).toEqual(operation === "delete" ? [] : ["Committed recording"]);
      if (operation === "delete") {
        expect((await store.getDeletedReplays()).map((item) => item.id)).toEqual([replay().id]);
      }
    })
  );

  it.each(["updateReplay", "updateActiveReplay"] as const)(
    "%s preserves unrelated cached payloads and the previous reader's snapshot",
    async (method) => withStore(async (store) => {
      await store.saveReplay({ ...replay("Another recording"), id: "other-replay", capturedAt: "2026-09-03T12:00:00.000Z" });
      await store.saveReplay({ ...replay("Deleted recording"), id: "deleted-replay", deletedAt: "2026-09-04T13:00:00.000Z" });
      const before = await store.getReplays();
      const deletedBefore = await store.getDeletedReplays();
      const hydration = vi.spyOn(payloadStore(store), "hydrate");
      const saved = await store[method](replay().id, (current) => ({
        ...current, title: "Updated recording", annotations: [
          { id: "new-note", targetType: "video-time", targetId: "video-1", targetLabel: "0:01",
            capturedAt: replay().capturedAt, timeMs: 1234, tool: "text", color: "#ffffff", width: 2,
            points: [], text: "Keep this note", createdAt: "2026-09-04T14:00:00.000Z" }
        ]
      }));
      const after = await store.getReplays();
      expect(after.map((item) => item.id)).toEqual(before.map((item) => item.id));
      expect(after[0]).toEqual(saved);
      expect(after[0].annotations?.[0].text).toBe("Keep this note");
      expect(before[0].title).toBe("Original recording");
      expect(after[1]).toBe(before[1]);
      expect((await store.getDeletedReplays())[0]).toBe(deletedBefore[0]);
      expect(hydration).toHaveBeenCalledTimes(1);
    })
  );

  it("publishes cached replay changes only after a successful durable write", async () => withStore(async (store) => {
    const before = await store.getReplays();
    const started = deferred();
    const release = deferred();
    const internals = store as unknown as { writeDatabaseFile(database: object): Promise<void> };
    vi.spyOn(internals, "writeDatabaseFile").mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      throw new Error("simulated disk failure");
    });
    const write = store.updateActiveReplay(replay().id, (current) => ({ ...current, title: "Uncommitted" }));
    await started.promise;
    expect((await store.getReplays())[0]).toBe(before[0]);
    release.resolve();
    await expect(write).rejects.toThrow("simulated disk failure");
    expect((await store.getReplays())[0]).toBe(before[0]);
    await store.updateActiveReplay(replay().id, (current) => ({ ...current, title: "Committed later" }));
    expect((await store.getReplays())[0].title).toBe("Committed later");
  }));

  it.each(["older-first", "newer-first"] as const)(
    "keeps the newer loader's ownership when overlapping reads finish %s",
    async (completionOrder) => withStore(async (store) => {
      const started = [deferred(), deferred()];
      const release = [deferred(), deferred()];
      const payloads = payloadStore(store);
      const hydrate = payloads.hydrate.bind(payloads);
      const hydration = vi.spyOn(payloads, "hydrate");
      for (let index = 0; index < 2; index += 1) {
        hydration.mockImplementationOnce(async (stored) => {
          const loaded = await hydrate(stored);
          started[index].resolve();
          await release[index].promise;
          return loaded;
        });
      }
      const olderRead = store.getReplays();
      await started[0].promise;
      try {
        await store.saveReplay(replay("Committed recording"));
        const newerRead = store.getReplays();
        await started[1].promise;
        if (completionOrder === "older-first") {
          release[0].resolve();
          await olderRead;
          const joinedRead = store.getReplays();
          release[1].resolve();
          expect((await joinedRead)[0].title).toBe("Committed recording");
        } else {
          release[1].resolve();
          await newerRead;
          release[0].resolve();
        }
        await Promise.all([olderRead, newerRead]);
        expect((await store.getReplays())[0].title).toBe("Committed recording");
        expect(hydration).toHaveBeenCalledTimes(2);
      } finally {
        release.forEach((gate) => gate.resolve());
      }
    })
  );
});
