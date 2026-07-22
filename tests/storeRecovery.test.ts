import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RiftLiteStore } from "../src/main/services/store.js";
import type { CaptureEvent, MatchDraft, ReplayRecord, RiftLiteBackupFile } from "../src/shared/types.js";

function savedMatch(id: string): MatchDraft {
  const capturedAt = "2026-06-25T20:00:00.000Z";
  return {
    id,
    platform: "atlas",
    source: "auto",
    status: "saved",
    capturedAt,
    updatedAt: capturedAt,
    result: "Win",
    format: "Bo1",
    score: "1-0",
    myName: "BMU",
    opponentName: "Tester",
    myChampion: "Diana",
    opponentChampion: "Pyke",
    myBattlefield: "Ripper's Bay",
    opponentBattlefield: "Sunken Temple",
    deckName: "Diana test",
    deckSourceId: "",
    flags: "",
    notes: "",
    games: [{ gameNumber: 1, result: "Win", myPoints: 8, oppPoints: 3 }],
    rawEvidence: [],
    sync: { community: "disabled", hubs: {}, teams: {} }
  };
}

function savedReplay(id: string): ReplayRecord {
  return {
    id,
    matchId: `match-${id}`,
    platform: "atlas",
    capturedAt: "2026-07-18T23:05:40.973Z",
    title: "Irelia vs Nasus",
    players: { me: "Player", opponent: "Opponent" },
    events: []
  };
}

describe("RiftLiteStore database recovery", () => {
  it("keeps failed candidate writes invisible and out of later successful commits", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-store-atomic-write-failure-"));
    try {
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const store = new RiftLiteStore(dbPath, legacyPath);
      await store.load();
      await store.saveMatch(savedMatch("committed-before-failure"));
      await store.getMatches();

      interface StoreWriteInternals {
        writeDatabaseFile(database: object): Promise<void>;
      }
      const internals = store as unknown as StoreWriteInternals;
      let releaseFailedWrite!: () => void;
      let markFailedWriteStarted!: () => void;
      const failedWriteGate = new Promise<void>((resolve) => {
        releaseFailedWrite = resolve;
      });
      const failedWriteStarted = new Promise<void>((resolve) => {
        markFailedWriteStarted = resolve;
      });
      const writeSpy = vi.spyOn(internals, "writeDatabaseFile").mockImplementationOnce(async () => {
        markFailedWriteStarted();
        await failedWriteGate;
        throw new Error("simulated database rename failure");
      });

      const failingSave = store.saveMatch(savedMatch("must-never-leak"));
      await failedWriteStarted;

      // Reads and lifecycle consumers stay on the previous committed database
      // for the entire asynchronous persistence window.
      expect((await store.getMatches()).map((match) => match.id)).toEqual(["committed-before-failure"]);
      await expect(store.hasActiveRawCaptureParent("not-finalized", "must-never-leak")).resolves.toBe(false);
      releaseFailedWrite();
      await expect(failingSave).rejects.toThrow("simulated database rename failure");
      expect((await store.getMatches()).some((match) => match.id === "must-never-leak")).toBe(false);

      const reopenedAfterFailure = new RiftLiteStore(dbPath, legacyPath);
      await reopenedAfterFailure.load();
      expect((await reopenedAfterFailure.getMatches()).some((match) => match.id === "must-never-leak")).toBe(false);

      writeSpy.mockRestore();
      await store.saveMatch(savedMatch("committed-after-failure"));
      expect((await store.getMatches()).map((match) => match.id)).toEqual(expect.arrayContaining([
        "committed-before-failure",
        "committed-after-failure"
      ]));
      expect((await store.getMatches()).some((match) => match.id === "must-never-leak")).toBe(false);

      const reopenedAfterSuccess = new RiftLiteStore(dbPath, legacyPath);
      await reopenedAfterSuccess.load();
      expect((await reopenedAfterSuccess.getMatches()).map((match) => match.id)).toEqual(expect.arrayContaining([
        "committed-before-failure",
        "committed-after-failure"
      ]));
      expect((await reopenedAfterSuccess.getMatches()).some((match) => match.id === "must-never-leak")).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("aborts a restore instead of losing a write that arrives while the replacement is being built", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-store-restore-write-race-"));
    try {
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const store = new RiftLiteStore(dbPath, legacyPath);
      await store.load();
      await store.saveMatch(savedMatch("original-before-restore"));
      const backup: RiftLiteBackupFile = {
        format: "riftlite.backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        appVersion: "test",
        settings: await store.getSettings(),
        matches: [savedMatch("restored-snapshot")],
        deletedMatches: [],
        decks: [],
        notebooks: [],
        replays: [],
        deletedReplays: []
      };

      interface StoreWriteInternals {
        db: object | null;
        stageDatabaseFile(database: object): Promise<string>;
      }
      const internals = store as unknown as StoreWriteInternals;
      const activeDatabase = internals.db;
      const originalStage = internals.stageDatabaseFile.bind(store);
      let releaseCandidateWrite!: () => void;
      let markCandidateWriteStarted!: () => void;
      const candidateWriteGate = new Promise<void>((resolve) => {
        releaseCandidateWrite = resolve;
      });
      const candidateWriteStarted = new Promise<void>((resolve) => {
        markCandidateWriteStarted = resolve;
      });
      let restoreCandidateDatabase: object | null = null;
      vi.spyOn(internals, "stageDatabaseFile").mockImplementation(async (database) => {
        if (database !== activeDatabase && !restoreCandidateDatabase) {
          restoreCandidateDatabase = database;
          const stagedPath = await originalStage(database);
          markCandidateWriteStarted();
          await candidateWriteGate;
          return stagedPath;
        }
        return originalStage(database);
      });

      const restoring = store.restoreBackupData(backup);
      await candidateWriteStarted;

      // Even after the entire restore candidate has reached disk, the
      // canonical database must remain the last committed live state. A crash
      // here therefore reopens the original data, never the staged restore.
      const reopenedWhileRestoreIsStaged = new RiftLiteStore(dbPath, legacyPath);
      await reopenedWhileRestoreIsStaged.load();
      expect((await reopenedWhileRestoreIsStaged.getMatches()).map((match) => match.id)).toContain("original-before-restore");
      expect((await reopenedWhileRestoreIsStaged.getMatches()).some((match) => match.id === "restored-snapshot")).toBe(false);

      await store.saveMatch(savedMatch("written-during-restore"));
      releaseCandidateWrite();

      await expect(restoring).rejects.toThrow("data changed while the restore was running");
      expect((await store.getMatches()).map((match) => match.id)).toEqual(expect.arrayContaining([
        "original-before-restore",
        "written-during-restore"
      ]));
      expect((await store.getMatches()).some((match) => match.id === "restored-snapshot")).toBe(false);

      const reloaded = new RiftLiteStore(dbPath, legacyPath);
      await reloaded.load();
      expect((await reloaded.getMatches()).map((match) => match.id)).toEqual(expect.arrayContaining([
        "original-before-restore",
        "written-during-restore"
      ]));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains the byte fence against an unexpected live-database mutation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-store-restore-unpersisted-race-"));
    try {
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const store = new RiftLiteStore(dbPath, legacyPath);
      await store.load();
      await store.saveMatch(savedMatch("delete-during-restore"));
      const backup: RiftLiteBackupFile = {
        format: "riftlite.backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        appVersion: "test",
        settings: await store.getSettings(),
        matches: [savedMatch("restored-snapshot")],
        deletedMatches: [],
        decks: [],
        notebooks: [],
        replays: [],
        deletedReplays: []
      };

      interface StoreRestoreInternals {
        db: {
          exec(sql: string, params?: unknown[]): Array<{ values: unknown[][] }>;
          run(sql: string, params?: unknown[]): void;
        } | null;
        stageDatabaseFile(database: object): Promise<string>;
        invalidateMatchCache(): void;
      }
      const internals = store as unknown as StoreRestoreInternals;
      const activeDatabase = internals.db;
      const originalStage = internals.stageDatabaseFile.bind(store);
      let markCandidateStaged!: () => void;
      let releaseCandidate!: () => void;
      const candidateStaged = new Promise<void>((resolve) => {
        markCandidateStaged = resolve;
      });
      const candidateGate = new Promise<void>((resolve) => {
        releaseCandidate = resolve;
      });
      vi.spyOn(internals, "stageDatabaseFile").mockImplementation(async (database) => {
        const stagedPath = await originalStage(database);
        if (database !== activeDatabase) {
          markCandidateStaged();
          await candidateGate;
        }
        return stagedPath;
      });

      const restoring = store.restoreBackupData(backup);
      await candidateStaged;
      const raw = internals.db?.exec(
        "SELECT data_json FROM matches WHERE id=?",
        ["delete-during-restore"]
      )[0]?.values[0]?.[0];
      expect(typeof raw).toBe("string");
      const deletedAt = "2026-07-21T18:00:00.000Z";
      const deleted = { ...JSON.parse(String(raw)) as MatchDraft, deletedAt, updatedAt: deletedAt };
      // Simulate an unexpected internal writer that bypassed the serialized
      // public mutation API and did not advance databaseMutationVersion. The
      // exact-byte fence must still reject the restore.
      internals.db?.run(
        "UPDATE matches SET updated_at=?, data_json=? WHERE id=?",
        [deletedAt, JSON.stringify(deleted), "delete-during-restore"]
      );
      internals.invalidateMatchCache();
      releaseCandidate();
      await expect(restoring).rejects.toThrow("data changed while the restore was running");
      expect((await store.getDeletedMatches()).map((match) => match.id)).toContain("delete-during-restore");
      expect((await store.getMatches()).some((match) => match.id === "restored-snapshot")).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps replay upload parents inactive after soft deletion or permanent purge", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-store-replay-purge-race-"));
    try {
      const store = new RiftLiteStore(join(directory, "riftlite-v06.sqlite"), join(directory, "riftlite-v06-store.json"));
      await store.load();

      await store.saveMatch(savedMatch("match-safe"));
      const replay = savedReplay("safe");
      await expect(store.saveReplayIfMatchActive(replay)).resolves.toMatchObject({ id: replay.id });
      await expect(store.hasActiveRawCaptureParent(replay.id, replay.matchId)).resolves.toBe(true);
      await store.purgeReplay(replay.id);

      await expect(store.hasActiveRawCaptureParent(replay.id, replay.matchId)).resolves.toBe(false);
      await expect(store.saveReplayIfMatchActive(replay)).resolves.toBeNull();
      expect((await store.getReplays()).some((candidate) => candidate.id === replay.id)).toBe(false);

      await store.saveMatch(savedMatch("match-soft-delete"));
      const softDeletedReplay = savedReplay("soft-delete");
      await store.saveReplayIfMatchActive(softDeletedReplay);
      await store.deleteReplay(softDeletedReplay.id);

      await expect(store.hasActiveRawCaptureParent(softDeletedReplay.id, softDeletedReplay.matchId)).resolves.toBe(false);
      await expect(store.updateActiveReplay(softDeletedReplay.id, (current) => ({ ...current, title: "must not save" })))
        .resolves.toBeNull();
      await expect(store.saveReplayIfMatchActive(softDeletedReplay)).resolves.toBeNull();
      expect((await store.getDeletedReplays()).find((candidate) => candidate.id === softDeletedReplay.id)?.title)
        .toBe(softDeletedReplay.title);

      await expect(store.hasActiveRawCaptureParent("not-finalized-yet", "match-soft-delete"))
        .resolves.toBe(true);

      await store.saveMatch(savedMatch("match-parent-purge"));
      const parentReplay = savedReplay("parent-purge");
      await store.saveReplayIfMatchActive(parentReplay);
      await store.purgeMatch(parentReplay.matchId);

      await expect(store.hasActiveRawCaptureParent(parentReplay.id, parentReplay.matchId)).resolves.toBe(false);
      await expect(store.saveReplayIfMatchActive(parentReplay)).resolves.toBeNull();
      expect((await store.getReplays()).some((candidate) => candidate.id === parentReplay.id)).toBe(false);

      const orphanReplay = savedReplay("missing-parent");
      await store.saveReplay(orphanReplay);
      await expect(store.hasActiveRawCaptureParent(orphanReplay.id, orphanReplay.matchId)).resolves.toBe(false);
      await expect(store.updateActiveReplay(orphanReplay.id, (current) => ({ ...current, title: "must not save" })))
        .resolves.toBeNull();
      expect((await store.getReplays()).find((candidate) => candidate.id === orphanReplay.id)?.title)
        .toBe(orphanReplay.title);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("never lets a stale conditional sync save recreate a deleted or missing match", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-store-save-match-if-lifecycle-"));
    try {
      const store = new RiftLiteStore(join(directory, "riftlite-v06.sqlite"), join(directory, "riftlite-v06-store.json"));
      await store.load();
      const original = await store.saveMatch({
        ...savedMatch("conditional-save"),
        notes: "latest local note",
        sync: { community: "pending", hubs: { "hub-current": "pending" }, teams: {} }
      });
      const staleSyncResult: MatchDraft = {
        ...original,
        notes: "stale remote copy",
        sync: {
          community: "synced",
          hubs: { "hub-current": "synced", "removed-hub": "synced" },
          teams: {}
        }
      };

      const merged = await store.saveMatchIf(staleSyncResult, () => true);
      expect(merged).toMatchObject({
        notes: "latest local note",
        sync: { community: "synced", hubs: { "hub-current": "synced" } }
      });
      expect(merged?.sync.hubs).not.toHaveProperty("removed-hub");

      const staleBeforeDelete = (await store.getMatches()).find((match) => match.id === original.id)!;
      await store.deleteMatch(original.id);
      await expect(store.saveMatchIf({
        ...staleBeforeDelete,
        sync: { ...staleBeforeDelete.sync, community: "synced" }
      }, () => true)).resolves.toBeNull();
      expect((await store.getMatches()).some((match) => match.id === original.id)).toBe(false);
      expect((await store.getDeletedMatches()).filter((match) => match.id === original.id)).toHaveLength(1);

      await store.purgeMatch(original.id);
      await expect(store.saveMatchIf(staleBeforeDelete, () => true)).resolves.toBeNull();
      expect((await store.getMatches()).some((match) => match.id === original.id)).toBe(false);
      expect((await store.getDeletedMatches()).some((match) => match.id === original.id)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("atomically preserves independent replay video and raw-capture updates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-store-replay-update-"));
    try {
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const store = new RiftLiteStore(dbPath, legacyPath);
      await store.load();
      const seeded = await store.saveReplay(savedReplay("race"));

      await Promise.all([
        store.updateReplay(seeded.id, (current) => ({
          ...current,
          video: {
            path: "match.webm",
            url: "file:///match.webm",
            filename: "match.webm",
            directory: ".",
            mimeType: "video/webm",
            source: "game-frame-direct",
            platform: "atlas",
            startedAt: "2026-07-18T23:05:41.000Z",
            endedAt: "2026-07-18T23:21:54.000Z",
            durationMs: 973_000,
            sizeBytes: 367_000_000,
            width: 1920,
            height: 1080,
            fps: 30,
            captureIntervalMs: 33,
            bitrateKbps: 8000,
            codec: "VP8 WebM",
            quality: "youtube",
            hasAudio: false,
            containerFinalized: true
          }
        })),
        store.updateReplay(seeded.id, (current) => ({
          ...current,
          rawCapture: {
            captureSessionId: "capture-race",
            localPath: "raw.json",
            indexPath: "raw.json.riftlite-index.json",
            messageCount: 100,
            droppedCount: 0,
            uncompressedBytes: 1000,
            uploadStatus: "uploaded"
          }
        }))
      ]);

      const current = (await store.getReplays()).find((replay) => replay.id === seeded.id);
      expect(current?.video?.path).toBe("match.webm");
      expect(current?.rawCapture?.uploadStatus).toBe("uploaded");

      const reloadedStore = new RiftLiteStore(dbPath, legacyPath);
      await reloadedStore.load();
      const reloaded = (await reloadedStore.getReplays()).find((replay) => replay.id === seeded.id);
      expect(reloaded?.video?.path).toBe("match.webm");
      expect(reloaded?.rawCapture?.captureSessionId).toBe("capture-race");

      await store.updateReplay(seeded.id, (latest) => {
        const withoutVideo = { ...latest, video: undefined };
        delete withoutVideo.video;
        return withoutVideo;
      });
      const withoutVideo = (await store.getReplays()).find((replay) => replay.id === seeded.id);
      expect(withoutVideo?.video).toBeUndefined();
      expect(withoutVideo?.rawCapture?.uploadStatus).toBe("uploaded");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains direct card identity codes in compacted match and replay evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-store-card-codes-"));
    try {
      const store = new RiftLiteStore(join(directory, "riftlite-v06.sqlite"), join(directory, "riftlite-v06-store.json"));
      await store.load();
      const identityEvent: CaptureEvent = {
        id: "identity-codes",
        platform: "atlas",
        kind: "match-snapshot",
        capturedAt: "2026-07-18T22:00:00.000Z",
        url: "https://play.riftatlas.com/game",
        payload: {
          myChampionCode: "UNL-226*",
          opponentChampionCode: "VEN-194",
          myBattlefieldCode: "VEN-157",
          opponentBattlefieldCode: "UNL-218"
        }
      };
      const expectedCodes = identityEvent.payload;
      const pendingMatch: MatchDraft = {
        ...savedMatch("identity-match"),
        status: "pending-review",
        rawEvidence: [identityEvent]
      };

      const storedMatch = await store.saveMatch(pendingMatch);
      const replayRecord: ReplayRecord = {
        id: "identity-replay",
        matchId: pendingMatch.id,
        platform: "atlas",
        capturedAt: pendingMatch.capturedAt,
        title: "Identity replay",
        players: { me: "BMU", opponent: "Tester" },
        events: [identityEvent]
      };
      const storedReplay = await store.saveReplay(replayRecord);

      expect(storedMatch.rawEvidence[0]?.payload).toMatchObject(expectedCodes);
      expect(storedReplay.events[0]?.payload).toMatchObject(expectedCodes);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("starts production with release sync defaults and safely attempts legacy import", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-store-production-"));
    try {
      const store = new RiftLiteStore(
        join(directory, "riftlite-v06.sqlite"),
        join(directory, "riftlite-v06-store.json"),
        undefined,
        true
      );
      const legacyImport = vi.spyOn(store, "importLegacyData").mockResolvedValue({
        importedMatches: 0,
        importedHubs: 0,
        importedSettings: 0,
        sourcePath: join(directory, "legacy-test-double.db")
      });

      await store.load();

      const settings = await store.getSettings();
      expect(settings.syncMode).toBe("community-and-hubs");
      expect(settings.communitySyncEnabled).toBe(true);
      expect(settings.accountCloudSyncEnabled).toBe(false);
      expect(settings.rawCapture.webReplayAutoUploadEnabled).toBe(false);
      expect(settings.rawCapture.tcgaWebReplayAutoUploadEnabled).toBe(false);
      expect(legacyImport).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("migrates legacy hidden raw-capture settings to private opt-out defaults", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-store-privacy-"));
    try {
      const store = new RiftLiteStore(join(directory, "riftlite-v06.sqlite"), join(directory, "riftlite-v06-store.json"));
      await store.load();

      const migrated = await store.saveSettings({
        rawCapture: {
          enabled: true,
          endpoint: "https://riftreplay.com/api/v1/replays",
          apiKey: "legacy-key",
          visibility: "public"
        } as unknown as Awaited<ReturnType<RiftLiteStore["getSettings"]>>["rawCapture"]
      });

      expect(migrated.rawCapture).toMatchObject({
        enabled: false,
        webReplayAutoUploadEnabled: false,
        webReplayAutoUploadAccountUid: "",
        tcgaWebReplayAutoUploadEnabled: false,
        tcgaWebReplayAutoUploadAccountUid: "",
        uploadEnabled: false,
        visibility: "private"
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the live database intact when a backup import fails partway through", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-store-restore-"));
    try {
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const store = new RiftLiteStore(dbPath, legacyPath);
      await store.load();
      await store.saveMatch(savedMatch("original"));
      const originalIds = (await store.getMatches()).map((match) => match.id);

      const invalidMatch = savedMatch("invalid") as unknown as Record<string, unknown>;
      invalidMatch.notes = invalidMatch;
      const invalidBackup: RiftLiteBackupFile = {
        format: "riftlite.backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        appVersion: "test",
        settings: await store.getSettings(),
        matches: [savedMatch("replacement"), invalidMatch as unknown as MatchDraft],
        deletedMatches: [],
        decks: [],
        notebooks: [],
        replays: [],
        deletedReplays: []
      };

      await expect(store.restoreBackupData(invalidBackup)).rejects.toThrow();

      const matches = await store.getMatches();
      expect(matches.map((match) => match.id)).toEqual(originalIds);
      expect(matches.some((match) => match.id === "replacement")).toBe(false);
      const reloadedStore = new RiftLiteStore(dbPath, legacyPath);
      await reloadedStore.load();
      const reloadedIds = (await reloadedStore.getMatches()).map((match) => match.id);
      expect(new Set(reloadedIds)).toEqual(new Set(originalIds));
      expect(reloadedIds).not.toContain("replacement");
      const safetyFiles = await readdir(join(directory, "database-backups"));
      expect(safetyFiles.some((file) => /auto-pre-restore-\d+\.sqlite$/i.test(file))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("restores a valid last-known-good backup instead of replacing a malformed database with an empty one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-store-recovery-"));
    try {
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const seedStore = new RiftLiteStore(dbPath, legacyPath);
      await seedStore.load();
      await seedStore.saveMatch(savedMatch("match-1"));

      const backupDirectory = join(directory, "database-backups");
      await mkdir(backupDirectory, { recursive: true });
      await copyFile(dbPath, join(backupDirectory, "riftlite-v06-auto-test-1000.sqlite"));
      await writeFile(dbPath, "not a sqlite database", "utf8");

      const recoveredStore = new RiftLiteStore(dbPath, legacyPath);
      await recoveredStore.load();

      const matches = await recoveredStore.getMatches();
      const recoveredMatch = matches.find((match) => match.id === "match-1");
      expect(recoveredMatch?.myChampion).toBe("Diana");
      expect(recoveredMatch?.opponentChampion).toBe("Pyke");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves a malformed database and starts fresh when no usable backup exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-store-recovery-"));
    try {
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      await writeFile(dbPath, "not a sqlite database", "utf8");

      const recoveredStore = new RiftLiteStore(dbPath, legacyPath);
      await recoveredStore.load();

      const matches = await recoveredStore.getMatches();
      const files = await readdir(directory);
      expect(Array.isArray(matches)).toBe(true);
      expect(files.some((file) => /^riftlite-v06-startup-open-failed-backup-\d+\.sqlite$/i.test(file))).toBe(true);
      expect(files.some((file) => /^riftlite-startup-open-failed-\d+\.log$/i.test(file))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
