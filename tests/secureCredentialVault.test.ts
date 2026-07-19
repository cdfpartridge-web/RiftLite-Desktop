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
  constructor(private readonly available = true) {}

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
      const store = new RiftLiteStore(
        dbPath,
        legacyPath,
        new SecureCredentialVault(join(directory, "vault.json"), new TestEncryption())
      );
      await store.load();
      await store.saveSettings({
        accountUid: "current-account",
        firebaseUid: "current-account",
        firebaseRefreshToken: "current-refresh-token",
        scorepadDeviceId: "current-scorepad-device",
        scorepadDeviceSecret: "current-scorepad-secret",
        activeHubs: [{ id: "legacy-hub", name: "Legacy", sync: true, passwordHash: "old-hub-password" }],
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
          rawCapture: { ...backup.settings.rawCapture, apiKey: "backup-replay-key" }
        }
      };
      await store.restoreBackupData(legacyBackup);
      const restored = await store.getSettings();

      expect(restored.firebaseRefreshToken).toBe("current-refresh-token");
      expect(restored.accountUid).toBe("current-account");
      expect(restored.firebaseUid).toBe("current-account");
      expect(restored.scorepadDeviceId).toBe("current-scorepad-device");
      expect(restored.scorepadDeviceSecret).toBe("current-scorepad-secret");
      expect(restored.rawCapture.apiKey).toBe("current-replay-key");
      expect(restored.activeHubs[0]).not.toHaveProperty("passwordHash");
      const databaseBytes = await readFile(dbPath);
      expect(databaseBytes.includes(Buffer.from("backup-refresh-token"))).toBe(false);
      expect(databaseBytes.includes(Buffer.from("backup-scorepad-secret"))).toBe(false);
      expect(databaseBytes.includes(Buffer.from("backup-replay-key"))).toBe(false);
      expect(databaseBytes.includes(Buffer.from("backup-hub-password"))).toBe(false);
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
