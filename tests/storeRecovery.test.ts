import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RiftLiteStore } from "../src/main/services/store.js";
import type { MatchDraft, RiftLiteBackupFile } from "../src/shared/types.js";

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

describe("RiftLiteStore database recovery", () => {
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
