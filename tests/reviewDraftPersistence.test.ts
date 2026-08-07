import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RiftLiteStore } from "../src/main/services/store.js";
import type { MatchDraft } from "../src/shared/types.js";

function reviewDraft(id: string, status: MatchDraft["status"] = "pending-review"): MatchDraft {
  const capturedAt = "2026-08-06T19:30:00.000Z";
  return {
    id,
    platform: "tcga",
    source: "auto",
    status,
    capturedAt,
    updatedAt: capturedAt,
    result: "Win",
    format: "Bo3",
    score: "2-1",
    myName: "Tealz",
    opponentName: "Opponent",
    myChampion: "Jhin",
    opponentChampion: "Kennen",
    myBattlefield: "Rockfall Path",
    opponentBattlefield: "Minefield",
    deckName: "Jhin Vendetta",
    deckSourceId: "deck-jhin",
    deckSourceKey: "deck-jhin",
    deckSourceUrl: "https://example.test/decks/jhin",
    deckSnapshotJson: "{\"legend\":\"Jhin\"}",
    flags: "ladder",
    notes: "Initial note",
    games: [
      { gameNumber: 1, result: "Loss", myPoints: 6, oppPoints: 7, wentFirst: "1st" },
      { gameNumber: 2, result: "Win", myPoints: 6, oppPoints: 5, wentFirst: "1st" },
      { gameNumber: 3, result: "Win", myPoints: 8, oppPoints: 6, wentFirst: "2nd" }
    ],
    rawEvidence: [],
    sync: { community: "pending", hubs: { coaching: "pending" }, teams: {} }
  };
}

async function withStore(
  prefix: string,
  action: (store: RiftLiteStore, dbPath: string, legacyPath: string) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    const dbPath = join(directory, "riftlite-v06.sqlite");
    const legacyPath = join(directory, "riftlite-v06-store.json");
    const store = new RiftLiteStore(dbPath, legacyPath);
    await store.load();
    await action(store, dbPath, legacyPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("deferred match review persistence", () => {
  it("creates the missing pending row and survives a restart", async () => {
    await withStore("riftlite-review-defer-new-", async (store, dbPath, legacyPath) => {
      const draft = { ...reviewDraft("in-memory-only"), notes: "Keep this for later" };

      const deferred = await store.deferMatchReview(draft);

      expect(deferred).toMatchObject({
        id: "in-memory-only",
        status: "pending-review",
        notes: "Keep this for later"
      });
      const restarted = new RiftLiteStore(dbPath, legacyPath);
      await restarted.load();
      expect(await restarted.getMatches()).toEqual([
        expect.objectContaining({
          id: "in-memory-only",
          status: "pending-review",
          notes: "Keep this for later"
        })
      ]);
    });
  });

  it("persists review edits while retaining newer capture-owned fields", async () => {
    await withStore("riftlite-review-defer-edit-", async (store) => {
      const original = {
        ...reviewDraft("pending-edit"),
        webReplayId: "web-replay-newer",
        rawEvidence: [{
          id: "event-1",
          platform: "tcga" as const,
          kind: "match-end" as const,
          capturedAt: "2026-08-06T19:31:00.000Z",
          url: "https://play.example.test",
          payload: {}
        }]
      };
      await store.saveMatch(original);

      const deferred = await store.deferMatchReview({
        ...original,
        webReplayId: undefined,
        notes: "Edited before Review later",
        score: "2-0",
        games: original.games.slice(0, 2),
        rawEvidence: [{
          id: "event-2",
          platform: "tcga",
          kind: "match-update",
          capturedAt: "2026-08-06T19:32:00.000Z",
          url: "https://play.example.test",
          payload: {}
        }]
      });

      expect(deferred).toMatchObject({
        status: "pending-review",
        notes: "Edited before Review later",
        score: "2-0",
        webReplayId: "web-replay-newer"
      });
      expect(deferred.rawEvidence.map((event) => event.id)).toEqual(["event-1", "event-2"]);
    });
  });

  it("leaves the prior row untouched after a failed defer and accepts a retry", async () => {
    await withStore("riftlite-review-defer-retry-", async (store) => {
      const original = reviewDraft("pending-retry");
      await store.saveMatch(original);
      const internals = store as unknown as {
        writeDatabaseFile(database: object, bytes?: Uint8Array): Promise<void>;
      };
      const writeSpy = vi.spyOn(internals, "writeDatabaseFile")
        .mockRejectedValueOnce(new Error("temporary disk write failure"));

      await expect(store.deferMatchReview({
        ...original,
        notes: "Edit that must not leak from a failed transaction"
      })).rejects.toThrow("temporary disk write failure");
      expect((await store.getMatches())[0]).toMatchObject({ notes: "Initial note" });

      await expect(store.deferMatchReview({
        ...original,
        notes: "Edit saved on retry"
      })).resolves.toMatchObject({ notes: "Edit saved on retry" });
      expect(writeSpy).toHaveBeenCalledTimes(2);
      expect((await store.getMatches())[0]).toMatchObject({ notes: "Edit saved on retry" });
    });
  });

  it("never downgrades a row that confirmation already saved", async () => {
    await withStore("riftlite-review-defer-saved-race-", async (store) => {
      const pending = reviewDraft("saved-race");
      await store.saveMatch({
        ...pending,
        status: "saved",
        sync: { community: "synced", hubs: { coaching: "synced" }, teams: {} },
        webReplayId: "web-replay-confirmed",
        webReplayAccountUid: "account-1"
      });

      const deferred = await store.deferMatchReview({
        ...pending,
        notes: "Latest reviewed note",
        status: "pending-review",
        sync: { community: "pending", hubs: { coaching: "pending" }, teams: {} }
      });

      expect(deferred).toMatchObject({
        status: "saved",
        notes: "Initial note",
        webReplayId: "web-replay-confirmed",
        webReplayAccountUid: "account-1",
        sync: { community: "synced", hubs: { coaching: "synced" }, teams: {} }
      });
    });
  });

  it("does not overwrite an unreadable stored row from renderer state", async () => {
    await withStore("riftlite-review-defer-corrupt-row-", async (store) => {
      const draft = reviewDraft("corrupt-row");
      await store.saveMatch(draft);
      const internals = store as unknown as {
        db: { run(sql: string, params?: unknown[]): void };
      };
      internals.db.run("UPDATE matches SET data_json=? WHERE id=?", ["{not-json", draft.id]);

      await expect(store.deferMatchReview({ ...draft, notes: "must not replace corruption" })).rejects.toThrow(
        "database row is unreadable"
      );
    });
  });

  it("does not resurrect a capture deleted while its review was open", async () => {
    await withStore("riftlite-review-defer-deleted-", async (store) => {
      const draft = reviewDraft("deleted-race");
      await store.saveMatch(draft);
      await store.deleteMatch(draft.id);

      await expect(store.deferMatchReview({ ...draft, notes: "stale modal edit" })).rejects.toThrow(
        "deleted while its review was open"
      );
      expect(await store.getMatches()).toEqual([]);
      expect(await store.getDeletedMatches()).toHaveLength(1);
    });
  });

  it("deletes an in-memory review even when its first database write never committed", async () => {
    await withStore("riftlite-review-delete-missing-row-", async (store) => {
      const draft = reviewDraft("in-memory-delete");

      await expect(store.deleteMatch(draft.id, draft)).resolves.toBeUndefined();
      expect(await store.getMatches()).toEqual([]);
      expect(await store.getDeletedMatches()).toEqual([
        expect.objectContaining({
          id: draft.id,
          status: "pending-review",
          deletedAt: expect.any(String)
        })
      ]);
    });
  });

  it("repairs an unreadable review row when the user explicitly deletes its open draft", async () => {
    await withStore("riftlite-review-delete-corrupt-row-", async (store) => {
      const draft = reviewDraft("corrupt-delete");
      await store.saveMatch(draft);
      const internals = store as unknown as {
        db: { run(sql: string, params?: unknown[]): void };
      };
      internals.db.run("UPDATE matches SET data_json=? WHERE id=?", ["{not-json", draft.id]);

      await expect(store.deleteMatch(draft.id, draft)).resolves.toBeUndefined();
      expect(await store.getMatches()).toEqual([]);
      expect(await store.getDeletedMatches()).toEqual([
        expect.objectContaining({ id: draft.id, deletedAt: expect.any(String) })
      ]);
    });
  });

  it("does not let one unreadable linked replay block capture deletion", async () => {
    await withStore("riftlite-review-delete-corrupt-replay-", async (store) => {
      const draft = reviewDraft("corrupt-linked-replay");
      await store.saveMatch(draft);
      const internals = store as unknown as {
        db: { run(sql: string, params?: unknown[]): void };
      };
      internals.db.run(
        `INSERT INTO replays (id, match_id, platform, captured_at, data_json)
         VALUES (?, ?, ?, ?, ?)`,
        ["corrupt-replay", draft.id, draft.platform, draft.capturedAt, "{not-json"]
      );

      await expect(store.deleteMatch(draft.id, draft)).resolves.toBeUndefined();
      expect(await store.getMatches()).toEqual([]);
      expect(await store.getDeletedMatches()).toEqual([
        expect.objectContaining({ id: draft.id, deletedAt: expect.any(String) })
      ]);
      expect(await store.getReplays()).toEqual([]);
    });
  });
});
