import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  redactCorruptSettingsText,
  SecureCredentialVault,
  type CredentialEncryption
} from "../src/main/services/secureCredentialVault.js";
import { sanitizeBackupCaptureEvent } from "../src/main/services/backupSanitizer.js";
import { RiftLiteStore } from "../src/main/services/store.js";
import type { CaptureEvent, MatchDraft, ReplayRecord, RiftLiteBackupFile } from "../src/shared/types.js";

vi.mock("electron", () => ({
  app: {
    getPath: () => tmpdir(),
    getVersion: () => "test"
  }
}));

class TestEncryption implements CredentialEncryption {
  constructor(private available = true) {}

  setAvailable(available: boolean): void {
    this.available = available;
  }

  isAvailable(): boolean {
    return this.available;
  }

  encrypt(value: string): Buffer {
    return Buffer.from(`test-cipher:${[...value].reverse().join("")}`, "utf8");
  }

  decrypt(value: Buffer): string {
    const encrypted = value.toString("utf8");
    if (!encrypted.startsWith("test-cipher:")) {
      throw new Error("invalid test ciphertext");
    }
    return [...encrypted.slice("test-cipher:".length)].reverse().join("");
  }
}

describe("secure credential storage", () => {
  it("serializes concurrent settings mutations so disjoint patches cannot overwrite one another", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-settings-queue-"));
    try {
      const encryption = new TestEncryption();
      const vault = new SecureCredentialVault(join(directory, "vault.json"), encryption);
      const store = new RiftLiteStore(
        join(directory, "riftlite-v06.sqlite"),
        join(directory, "riftlite-v06-store.json"),
        vault
      );
      await store.load();

      const originalProtectForSave = vault.protectForSave.bind(vault);
      let releaseFirst!: () => void;
      const firstMayFinish = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstEntered!: () => void;
      const firstDidEnter = new Promise<void>((resolve) => {
        firstEntered = resolve;
      });
      vi.spyOn(vault, "protectForSave")
        .mockImplementationOnce(async (...args) => {
          firstEntered();
          await firstMayFinish;
          return originalProtectForSave(...args);
        })
        .mockImplementation((...args) => originalProtectForSave(...args));

      const usernameSave = store.saveSettings({ username: "Queued player" });
      await firstDidEnter;
      const debugSave = store.saveSettings({ debugMode: true });
      releaseFirst();
      await Promise.all([usernameSave, debugSave]);

      expect(await store.getSettings()).toMatchObject({
        username: "Queued player",
        debugMode: true
      });
      const restarted = new RiftLiteStore(
        join(directory, "riftlite-v06.sqlite"),
        join(directory, "riftlite-v06-store.json"),
        new SecureCredentialVault(join(directory, "vault.json"), encryption)
      );
      await restarted.load();
      expect(await restarted.getSettings()).toMatchObject({
        username: "Queued player",
        debugMode: true
      });

      await Promise.all([
        restarted.updateSettings((current) => ({
          privateHubWebReplayGrantKeys: [...current.privateHubWebReplayGrantKeys, "hub-a|match-a|replay-a"]
        })),
        restarted.updateSettings((current) => ({
          privateHubWebReplayGrantKeys: [...current.privateHubWebReplayGrantKeys, "hub-b|match-b|replay-b"]
        }))
      ]);
      expect((await restarted.getSettings()).privateHubWebReplayGrantKeys).toEqual([
        "hub-a|match-a|replay-a",
        "hub-b|match-b|replay-b"
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists authoritative tombstones for every explicit clear while OS encryption is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-credentials-unavailable-unlink-"));
    try {
      const encryption = new TestEncryption();
      const vaultPath = join(directory, "vault.json");
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const store = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, encryption)
      );
      await store.load();
      await store.saveSettings({
        firebaseUid: "account-a",
        accountUid: "account-a",
        firebaseRefreshToken: "linked-refresh-token",
        scorepadDeviceSecret: "linked-scorepad-secret",
        rawCapture: {
          ...(await store.getSettings()).rawCapture,
          apiKey: "linked-replay-key"
        }
      });

      encryption.setAvailable(false);
      await store.saveSettings({
        firebaseRefreshToken: "",
        scorepadDeviceSecret: "",
        rawCapture: {
          ...(await store.getSettings()).rawCapture,
          apiKey: ""
        }
      });
      const stagedVault = JSON.parse(await readFile(vaultPath, "utf8")) as {
        entries: Record<string, string | null>;
      };
      expect(stagedVault.entries).toMatchObject({
        firebaseRefreshToken: null,
        rawCaptureApiKey: null,
        scorepadDeviceSecret: null
      });

      encryption.setAvailable(true);
      const restarted = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, encryption)
      );
      await restarted.load();
      expect(await restarted.getSettings()).toMatchObject({
        firebaseRefreshToken: "",
        scorepadDeviceSecret: "",
        rawCapture: { apiKey: "" }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["older encrypted values", true],
    ["older tombstones", false]
  ])("migrates all newly saved plaintext credentials after safeStorage returns over %s", async (_label, seedOldValues) => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-credentials-availability-transition-"));
    try {
      const encryption = new TestEncryption();
      const vaultPath = join(directory, "vault.json");
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const store = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, encryption)
      );
      await store.load();
      if (seedOldValues) {
        await store.saveSettings({
          firebaseUid: "account-a",
          accountUid: "account-a",
          firebaseRefreshToken: "old-refresh-token",
          scorepadDeviceSecret: "old-scorepad-secret",
          rawCapture: {
            ...(await store.getSettings()).rawCapture,
            apiKey: "old-replay-key"
          }
        });
      }

      encryption.setAvailable(false);
      await store.saveSettings({
        firebaseUid: "account-a",
        accountUid: "account-a",
        firebaseRefreshToken: "new-refresh-token",
        scorepadDeviceSecret: "new-scorepad-secret",
        rawCapture: {
          ...(await store.getSettings()).rawCapture,
          apiKey: "new-replay-key"
        }
      });

      const pendingVault = JSON.parse(await readFile(vaultPath, "utf8")) as {
        version: number;
        entries: Record<string, string | null>;
        firebaseRefreshTokenBinding?: unknown;
      };
      expect(pendingVault.version).toBe(2);
      expect(pendingVault.entries).not.toHaveProperty("firebaseRefreshToken");
      expect(pendingVault.entries).not.toHaveProperty("rawCaptureApiKey");
      expect(pendingVault.entries).not.toHaveProperty("scorepadDeviceSecret");
      expect(pendingVault.firebaseRefreshTokenBinding).toBeNull();
      const fallbackDatabase = await readFile(dbPath);
      expect(fallbackDatabase.includes(Buffer.from("new-refresh-token"))).toBe(true);
      expect(fallbackDatabase.includes(Buffer.from("new-scorepad-secret"))).toBe(true);
      expect(fallbackDatabase.includes(Buffer.from("new-replay-key"))).toBe(true);

      encryption.setAvailable(true);
      const migrated = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, encryption)
      );
      await migrated.load();
      expect(await migrated.getSettings()).toMatchObject({
        firebaseUid: "account-a",
        accountUid: "account-a",
        firebaseRefreshToken: "new-refresh-token",
        scorepadDeviceSecret: "new-scorepad-secret",
        rawCapture: { apiKey: "new-replay-key" }
      });
      expect((await migrated.getSettings()).firebaseCredentialGeneration).not.toBe("");

      const protectedDatabase = await readFile(dbPath);
      expect(protectedDatabase.includes(Buffer.from("new-refresh-token"))).toBe(false);
      expect(protectedDatabase.includes(Buffer.from("new-scorepad-secret"))).toBe(false);
      expect(protectedDatabase.includes(Buffer.from("new-replay-key"))).toBe(false);
      const restarted = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, encryption)
      );
      await restarted.load();
      expect(await restarted.getSettings()).toMatchObject({
        firebaseRefreshToken: "new-refresh-token",
        scorepadDeviceSecret: "new-scorepad-secret",
        rawCapture: { apiKey: "new-replay-key" }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    "firebaseRefreshToken",
    "rawCaptureApiKey",
    "scorepadDeviceSecret"
  ] as const)("migrates an individually touched non-empty %s without replacing untouched credentials", async (credential) => {
    const directory = await mkdtemp(join(tmpdir(), `riftlite-credential-${credential}-transition-`));
    try {
      const encryption = new TestEncryption();
      const vaultPath = join(directory, "vault.json");
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const store = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, encryption)
      );
      await store.load();
      await store.saveSettings({
        firebaseUid: "account-a",
        accountUid: "account-a",
        firebaseRefreshToken: "old-refresh-token",
        scorepadDeviceSecret: "old-scorepad-secret",
        rawCapture: {
          ...(await store.getSettings()).rawCapture,
          apiKey: "old-replay-key"
        }
      });

      encryption.setAvailable(false);
      if (credential === "firebaseRefreshToken") {
        await store.saveSettings({ firebaseRefreshToken: "new-refresh-token" });
      } else if (credential === "rawCaptureApiKey") {
        await store.saveSettings({
          rawCapture: {
            ...(await store.getSettings()).rawCapture,
            apiKey: "new-replay-key"
          }
        });
      } else {
        await store.saveSettings({ scorepadDeviceSecret: "new-scorepad-secret" });
      }

      const pendingVault = JSON.parse(await readFile(vaultPath, "utf8")) as {
        entries: Record<string, string | null>;
      };
      expect(pendingVault.entries).not.toHaveProperty(credential);
      for (const untouched of ["firebaseRefreshToken", "rawCaptureApiKey", "scorepadDeviceSecret"] as const) {
        if (untouched !== credential) expect(pendingVault.entries[untouched]).toEqual(expect.any(String));
      }

      encryption.setAvailable(true);
      const restarted = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, encryption)
      );
      await restarted.load();
      expect(await restarted.getSettings()).toMatchObject({
        firebaseRefreshToken: credential === "firebaseRefreshToken" ? "new-refresh-token" : "old-refresh-token",
        scorepadDeviceSecret: credential === "scorepadDeviceSecret" ? "new-scorepad-secret" : "old-scorepad-secret",
        rawCapture: {
          apiKey: credential === "rawCaptureApiKey" ? "new-replay-key" : "old-replay-key"
        }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses the same pending-migration representation when an existing vault is still version 1", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-credentials-v1-availability-transition-"));
    try {
      const encryption = new TestEncryption();
      const vaultPath = join(directory, "vault.json");
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const legacyStore = new RiftLiteStore(dbPath, legacyPath);
      await legacyStore.load();
      await legacyStore.saveSettings({
        firebaseUid: "account-a",
        accountUid: "account-a",
        firebaseRefreshToken: "old-refresh-token",
        scorepadDeviceSecret: "old-scorepad-secret",
        rawCapture: {
          ...(await legacyStore.getSettings()).rawCapture,
          apiKey: "old-replay-key"
        }
      });
      await writeFile(vaultPath, JSON.stringify({
        format: "riftlite.secure-credentials",
        version: 1,
        entries: {
          firebaseRefreshToken: encryption.encrypt("old-refresh-token").toString("base64"),
          rawCaptureApiKey: encryption.encrypt("old-replay-key").toString("base64"),
          scorepadDeviceSecret: encryption.encrypt("old-scorepad-secret").toString("base64")
        }
      }), "utf8");

      encryption.setAvailable(false);
      const fallbackStore = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, encryption)
      );
      await fallbackStore.load();
      await fallbackStore.saveSettings({
        firebaseRefreshToken: "new-refresh-token",
        scorepadDeviceSecret: "new-scorepad-secret",
        rawCapture: {
          ...(await fallbackStore.getSettings()).rawCapture,
          apiKey: "new-replay-key"
        }
      });
      const pendingVault = JSON.parse(await readFile(vaultPath, "utf8")) as {
        version: number;
        entries: Record<string, string | null>;
      };
      expect(pendingVault.version).toBe(1);
      expect(pendingVault.entries).not.toHaveProperty("firebaseRefreshToken");
      expect(pendingVault.entries).not.toHaveProperty("rawCaptureApiKey");
      expect(pendingVault.entries).not.toHaveProperty("scorepadDeviceSecret");

      encryption.setAvailable(true);
      const migrated = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, encryption)
      );
      await migrated.load();
      expect(await migrated.getSettings()).toMatchObject({
        firebaseRefreshToken: "new-refresh-token",
        scorepadDeviceSecret: "new-scorepad-secret",
        rawCapture: { apiKey: "new-replay-key" }
      });
      const durableVault = JSON.parse(await readFile(vaultPath, "utf8")) as {
        version: number;
        entries: Record<string, string | null>;
        firebaseRefreshTokenBinding?: { firebaseUid?: string; accountUid?: string; generation?: string } | null;
      };
      expect(durableVault.version).toBe(2);
      expect(durableVault.entries.firebaseRefreshToken).toEqual(expect.any(String));
      expect(durableVault.entries.rawCaptureApiKey).toEqual(expect.any(String));
      expect(durableVault.entries.scorepadDeviceSecret).toEqual(expect.any(String));
      expect(durableVault.firebaseRefreshTokenBinding).toMatchObject({
        firebaseUid: "account-a",
        accountUid: "account-a",
        generation: expect.any(String)
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails a credential clear when its vault tombstone cannot be committed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-credentials-failed-unlink-"));
    try {
      const encryption = new TestEncryption();
      const vaultPath = join(directory, "vault.json");
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const vault = new SecureCredentialVault(vaultPath, encryption);
      const store = new RiftLiteStore(
        dbPath,
        legacyPath,
        vault
      );
      await store.load();
      await store.saveSettings({ firebaseRefreshToken: "still-linked" });
      encryption.setAvailable(false);
      vi.spyOn(vault as unknown as { writeVault: () => Promise<void> }, "writeVault")
        .mockRejectedValueOnce(new Error("disk unavailable"));

      await expect(store.saveSettings({ firebaseRefreshToken: "" })).rejects.toThrow(
        "could not securely clear"
      );
      expect((await store.getSettings()).firebaseRefreshToken).toBe("still-linked");

      encryption.setAvailable(true);
      await store.saveSettings({ username: "Retry after failed unlink" });
      expect((await store.getSettings()).firebaseRefreshToken).toBe("still-linked");
      const restarted = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, encryption)
      );
      await restarted.load();
      expect((await restarted.getSettings()).firebaseRefreshToken).toBe("still-linked");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed after a vault write if the matching account identity cannot be persisted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-credentials-account-commit-race-"));
    try {
      const encryption = new TestEncryption();
      const vaultPath = join(directory, "vault.json");
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const store = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, encryption)
      );
      await store.load();
      await store.saveSettings({
        firebaseUid: "account-a",
        accountUid: "account-a",
        firebaseRefreshToken: "account-a-refresh"
      });

      const internals = store as unknown as { writeDatabaseFile(database: object): Promise<void> };
      vi.spyOn(internals, "writeDatabaseFile").mockRejectedValueOnce(new Error("simulated database write failure"));

      await expect(store.saveSettings({
        firebaseUid: "account-b",
        accountUid: "account-b",
        firebaseRefreshToken: "account-b-refresh"
      })).rejects.toThrow("simulated database write failure");
      expect(await store.getSettings()).toMatchObject({
        firebaseUid: "account-a",
        accountUid: "account-a",
        firebaseRefreshToken: "account-a-refresh"
      });

      const restarted = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, encryption)
      );
      await restarted.load();
      expect(await restarted.getSettings()).toMatchObject({
        firebaseUid: "account-a",
        accountUid: "account-a",
        firebaseRefreshToken: ""
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("migrates legacy plaintext settings into the vault and hydrates them after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-credentials-migrate-"));
    try {
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const vaultPath = join(directory, "riftlite-secure-credentials.json");
      const legacyStore = new RiftLiteStore(dbPath, legacyPath);
      await legacyStore.load();
      await legacyStore.saveSettings({
        firebaseRefreshToken: "account-refresh-secret",
        scorepadDeviceSecret: "scorepad-device-secret",
        rawCapture: {
          ...(await legacyStore.getSettings()).rawCapture,
          apiKey: "legacy-replay-api-secret"
        }
      });

      const migratedStore = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, new TestEncryption())
      );
      await migratedStore.load();
      const migrated = await migratedStore.getSettings();

      expect(migrated.firebaseRefreshToken).toBe("account-refresh-secret");
      expect(migrated.scorepadDeviceSecret).toBe("scorepad-device-secret");
      expect(migrated.rawCapture.apiKey).toBe("legacy-replay-api-secret");

      const databaseBytes = await readFile(dbPath);
      expect(databaseBytes.includes(Buffer.from("account-refresh-secret"))).toBe(false);
      expect(databaseBytes.includes(Buffer.from("scorepad-device-secret"))).toBe(false);
      expect(databaseBytes.includes(Buffer.from("legacy-replay-api-secret"))).toBe(false);
      const vaultText = await readFile(vaultPath, "utf8");
      expect(vaultText).not.toContain("account-refresh-secret");
      expect(vaultText).not.toContain("scorepad-device-secret");
      expect(vaultText).not.toContain("legacy-replay-api-secret");

      const restartedStore = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, new TestEncryption())
      );
      await restartedStore.load();
      expect(await restartedStore.getSettings()).toMatchObject({
        firebaseRefreshToken: "account-refresh-secret",
        scorepadDeviceSecret: "scorepad-device-secret",
        rawCapture: { apiKey: "legacy-replay-api-secret" }
      });
      await restartedStore.saveSettings({ username: "Still linked" });
      expect((await restartedStore.getSettings()).firebaseRefreshToken).toBe("account-refresh-secret");
      await restartedStore.saveSettings({ firebaseRefreshToken: "" });

      const afterLogoutStore = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, new TestEncryption())
      );
      await afterLogoutStore.load();
      expect((await afterLogoutStore.getSettings()).firebaseRefreshToken).toBe("");
      expect((await afterLogoutStore.getSettings()).scorepadDeviceSecret).toBe("scorepad-device-secret");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps credentials usable when OS encryption is temporarily unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-credentials-fallback-"));
    try {
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const store = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(join(directory, "vault.json"), new TestEncryption(false))
      );
      await store.load();
      const saved = await store.saveSettings({ firebaseRefreshToken: "fallback-refresh-token" });

      expect(saved.firebaseRefreshToken).toBe("fallback-refresh-token");
      expect((await store.getSettings()).firebaseRefreshToken).toBe("fallback-refresh-token");
      expect((await readFile(dbPath)).includes(Buffer.from("fallback-refresh-token"))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("exports secret-free backups and keeps device credentials when restoring old backup files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-credentials-backup-"));
    try {
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const credentialVault = new SecureCredentialVault(join(directory, "vault.json"), new TestEncryption());
      const store = new RiftLiteStore(
        dbPath,
        legacyPath,
        credentialVault
      );
      await store.load();
      await store.saveSettings({
        accountUid: "current-account",
        firebaseUid: "current-account",
        firebaseRefreshToken: "current-refresh-token",
        scorepadDeviceId: "current-scorepad-device",
        scorepadDeviceSecret: "current-scorepad-secret",
        activeHubs: [{ id: "legacy-hub", name: "Legacy", sync: true, passwordHash: "old-hub-password" }],
        activeTeams: [{
          id: "current-team",
          slug: "current-team",
          name: "Current team",
          sync: true,
          role: "member",
          visibility: "private",
          joinedAt: "2026-07-20T12:00:00.000Z"
        }],
        privateHubWebReplayGrantKeys: ["legacy-hub|current-match|current-replay"],
        rawCapture: {
          ...(await store.getSettings()).rawCapture,
          apiKey: "current-replay-key"
        }
      });

      const evidence: CaptureEvent = {
        id: "secret-evidence",
        platform: "atlas",
        kind: "network-fetch",
        capturedAt: "2026-07-19T10:00:00.000Z",
        url: "https://play.riftatlas.com/game?access_token=url-secret#private",
        payload: {
          authorization: "Bearer header-secret",
          headers: { cookie: "session=header-cookie" },
          requestBody: "refresh_token=body-secret",
          refreshToken: "payload-refresh-secret",
          myName: "Backup Player",
          gameplay: { turn: 4, token: { name: "Might token", type: "unit", might: 1 } }
        }
      };
      const pendingMatch: MatchDraft = {
        id: "backup-match",
        platform: "atlas",
        status: "pending-review",
        capturedAt: evidence.capturedAt,
        updatedAt: evidence.capturedAt,
        result: "Incomplete",
        format: "Bo1",
        score: "0-0",
        myName: "Backup Player",
        opponentName: "Opponent",
        myChampion: "Irelia",
        opponentChampion: "Nasus",
        myBattlefield: "",
        opponentBattlefield: "",
        deckName: "Test deck",
        deckSourceId: "",
        flags: "",
        notes: "Preserve this ordinary match note",
        games: [],
        rawEvidence: [evidence],
        sync: { community: "disabled", hubs: {}, teams: {} }
      };
      await store.saveMatch(pendingMatch);
      const replay: ReplayRecord = {
        id: "backup-replay",
        matchId: pendingMatch.id,
        platform: "atlas",
        capturedAt: evidence.capturedAt,
        title: "Backup replay",
        players: { me: "Backup Player", opponent: "Opponent" },
        events: [evidence]
      };
      await store.saveReplay(replay);

      const backup = await store.exportBackupData({ includeRecycleBin: true });
      expect(backup.settings.firebaseRefreshToken).toBe("");
      expect(backup.settings.scorepadDeviceSecret).toBe("");
      expect(backup.settings.rawCapture.apiKey).toBe("");
      expect(backup.settings.activeHubs[0]).not.toHaveProperty("passwordHash");
      expect(JSON.stringify(backup)).not.toContain("current-refresh-token");
      expect(JSON.stringify(backup)).not.toContain("current-scorepad-secret");
      expect(JSON.stringify(backup)).not.toContain("current-replay-key");
      expect(JSON.stringify(backup)).not.toContain("old-hub-password");
      const backupJson = JSON.stringify(backup);
      expect(backupJson).not.toContain("url-secret");
      expect(backupJson).not.toContain("header-secret");
      expect(backupJson).not.toContain("header-cookie");
      expect(backupJson).not.toContain("body-secret");
      expect(backupJson).not.toContain("payload-refresh-secret");
      expect(backupJson).toContain("Backup Player");
      expect(backupJson).toContain("Preserve this ordinary match note");
      expect(backup.matches[0]?.rawEvidence[0]?.url).toBe("https://play.riftatlas.com/game");
      const sanitizedEvidence = sanitizeBackupCaptureEvent(evidence);
      expect(sanitizedEvidence.payload).toMatchObject({
        myName: "Backup Player",
        gameplay: { turn: 4, token: { name: "Might token", type: "unit", might: 1 } }
      });
      expect(sanitizedEvidence.payload).not.toHaveProperty("authorization");
      expect(sanitizedEvidence.payload).not.toHaveProperty("headers");
      expect(sanitizedEvidence.payload).not.toHaveProperty("requestBody");
      expect(sanitizedEvidence.payload).not.toHaveProperty("refreshToken");

      const legacyBackup: RiftLiteBackupFile = {
        ...backup,
        settings: {
          ...backup.settings,
          accountUid: "backup-account",
          firebaseUid: "backup-account",
          firebaseRefreshToken: "backup-refresh-token",
          scorepadDeviceId: "backup-scorepad-device",
          scorepadDeviceSecret: "backup-scorepad-secret",
          activeHubs: [{ id: "restored-hub", name: "Restored", sync: true, passwordHash: "backup-hub-password" }],
          activeTeams: [{
            id: "backup-team",
            slug: "backup-team",
            name: "Backup team",
            sync: true,
            role: "owner",
            visibility: "private",
            joinedAt: "2026-07-01T12:00:00.000Z"
          }],
          privateHubWebReplayGrantKeys: ["restored-hub|backup-match|backup-replay"],
          rawCapture: { ...backup.settings.rawCapture, apiKey: "backup-replay-key" }
        }
      };
      const reconcileAfterRestore = vi.spyOn(credentialVault, "reconcile");
      await store.restoreBackupData(legacyBackup);
      const restored = await store.getSettings();

      // The restore already built a normalized runtime snapshot with the
      // current device credentials. It must remain cached after the atomic
      // swap instead of triggering a second vault/DB reconciliation.
      expect(reconcileAfterRestore).not.toHaveBeenCalled();

      expect(restored.firebaseRefreshToken).toBe("current-refresh-token");
      expect(restored.accountUid).toBe("current-account");
      expect(restored.firebaseUid).toBe("current-account");
      expect(restored.scorepadDeviceId).toBe("current-scorepad-device");
      expect(restored.scorepadDeviceSecret).toBe("current-scorepad-secret");
      expect(restored.rawCapture.apiKey).toBe("current-replay-key");
      expect(restored.activeHubs).toEqual([expect.objectContaining({ id: "legacy-hub" })]);
      expect(restored.activeHubs[0]).not.toHaveProperty("passwordHash");
      expect(restored.activeTeams).toEqual([expect.objectContaining({ id: "current-team" })]);
      expect(restored.privateHubWebReplayGrantKeys).toEqual(["legacy-hub|current-match|current-replay"]);
      const databaseBytes = await readFile(dbPath);
      expect(databaseBytes.includes(Buffer.from("backup-refresh-token"))).toBe(false);
      expect(databaseBytes.includes(Buffer.from("backup-scorepad-secret"))).toBe(false);
      expect(databaseBytes.includes(Buffer.from("backup-replay-key"))).toBe(false);
      expect(databaseBytes.includes(Buffer.from("backup-hub-password"))).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps hydrated vault credentials when deleting the active deck from a cold settings cache", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-credentials-delete-deck-"));
    try {
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const store = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(join(directory, "vault.json"), new TestEncryption())
      );
      await store.load();
      await store.upsertSavedDeck({
        id: "active-deck",
        sourceUrl: "https://example.test/decks/active",
        sourceKey: "active",
        title: "Active deck",
        legend: "Irelia",
        snapshotJson: "{}",
        lastImportedAt: "2026-07-21T12:00:00.000Z",
        lastRefreshStatus: "ok",
        lastRefreshError: ""
      });
      await store.saveSettings({
        accountUid: "account-1",
        firebaseUid: "account-1",
        firebaseRefreshToken: "refresh-secret",
        scorepadDeviceSecret: "scorepad-secret",
        activeDeckId: "active-deck",
        rawCapture: {
          ...(await store.getSettings()).rawCapture,
          apiKey: "capture-secret"
        }
      });

      (store as unknown as { settingsCache: unknown }).settingsCache = null;
      await store.deleteSavedDeck("active-deck");

      expect(await store.getSettings()).toMatchObject({
        activeDeckId: "",
        firebaseRefreshToken: "refresh-secret",
        scorepadDeviceSecret: "scorepad-secret",
        rawCapture: { apiKey: "capture-secret" }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("redacts known fields from malformed-settings repair artifacts", async () => {
    const malformed = "{\"firebaseRefreshToken\":\"refresh-secret\",\"rawCapture\":{\"apiKey\":\"replay-secret\"},\"scorepadDeviceSecret\":\"scorepad-secret\",\"passwordHash\":\"hub-secret\",";
    const redacted = redactCorruptSettingsText(malformed);

    expect(redacted).not.toContain("refresh-secret");
    expect(redacted).not.toContain("replay-secret");
    expect(redacted).not.toContain("scorepad-secret");
    expect(redacted).not.toContain("hub-secret");
    expect(redacted).toContain("\"firebaseRefreshToken\":\"\"");
  });

  it("scrubs credential values from retained legacy JSON migration artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-credentials-legacy-json-"));
    try {
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const vaultPath = join(directory, "vault.json");
      await writeFile(legacyPath, JSON.stringify({
        settings: {
          firebaseRefreshToken: "legacy-json-refresh",
          scorepadDeviceSecret: "legacy-json-scorepad",
          rawCapture: { apiKey: "legacy-json-replay" },
          activeHubs: [{ id: "hub", name: "Hub", sync: true, passwordHash: "legacy-json-hub" }]
        },
        matches: []
      }), "utf8");

      const store = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(vaultPath, new TestEncryption())
      );
      await store.load();
      const settings = await store.getSettings();
      expect(settings.firebaseRefreshToken).toBe("legacy-json-refresh");
      expect(settings.scorepadDeviceSecret).toBe("legacy-json-scorepad");
      expect(settings.rawCapture.apiKey).toBe("legacy-json-replay");

      const archive = await readFile(`${legacyPath}.migrated`, "utf8");
      expect(archive).not.toContain("legacy-json-refresh");
      expect(archive).not.toContain("legacy-json-scorepad");
      expect(archive).not.toContain("legacy-json-replay");
      expect(archive).not.toContain("legacy-json-hub");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
