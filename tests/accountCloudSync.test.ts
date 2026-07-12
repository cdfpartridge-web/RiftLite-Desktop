import { createHash, randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getVersion: () => "0.7.90-test" }
}));

import { FirebaseSyncService } from "../src/main/services/firebaseSync";
import type { RiftLiteStore } from "../src/main/services/store";
import type { RiftLiteBackupFile, UserSettings } from "../src/shared/types";

interface RequestOptions {
  method: "GET" | "DELETE" | "POST" | "PATCH";
  body?: { fields?: Record<string, unknown> };
  precondition?: { exists?: boolean; updateTime?: string };
}

function stringValue(value: string): Record<string, unknown> {
  return { stringValue: value };
}

function integerValue(value: number): Record<string, unknown> {
  return { integerValue: String(value) };
}

function stringArray(values: string[]): Record<string, unknown> {
  return { arrayValue: { values: values.map(stringValue) } };
}

function countsValue(matches = 0, decks = 0, notebooks = 0): Record<string, unknown> {
  return {
    mapValue: {
      fields: {
        matches: integerValue(matches),
        decks: integerValue(decks),
        notebooks: integerValue(notebooks),
        replays: integerValue(0)
      }
    }
  };
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function baseSettings(): UserSettings {
  return {
    accountUid: "account-1",
    firebaseUid: "account-1",
    firebaseRefreshToken: "refresh",
    accountEmail: "person@example.com",
    accountHandle: "bmu",
    accountDisplayName: "BMU",
    accountLastVerifiedAt: "",
    accountLastVerificationError: "",
    accountCloudSyncEnabled: false,
    accountCloudSyncDeviceId: "device-local",
    accountCloudSyncDeviceName: "Local device",
    accountCloudSyncLastSyncedAt: "",
    accountCloudSyncLastRestoredAt: "",
    accountCloudSyncLastError: "",
    rawCapture: {
      enabled: false,
      webReplayAutoUploadEnabled: false,
      webReplayAutoUploadAccountUid: "",
      uploadEnabled: false,
      endpoint: "https://riftreplay.com/api/v1/replays",
      apiKey: "",
      visibility: "private"
    }
  } as UserSettings;
}

function backup(settings: UserSettings): RiftLiteBackupFile {
  return {
    format: "riftlite.backup",
    version: 1,
    exportedAt: "2026-07-09T10:00:00.000Z",
    appVersion: "0.7.90-test",
    settings,
    matches: [],
    deletedMatches: [],
    decks: [],
    notebooks: [],
    replays: [],
    deletedReplays: []
  };
}

function manifestDocument(options: {
  version?: number;
  generationId?: string;
  payload?: string;
  chunkChecksums?: string[];
  chunkCount?: number;
  byteSize?: number;
  fullChecksum?: string;
  updateTime?: string;
} = {}): Record<string, unknown> {
  const payload = options.payload ?? "payload";
  const chunkChecksums = options.chunkChecksums ?? [checksum(payload)];
  return {
    updateTime: options.updateTime ?? "2026-07-09T10:00:00.000000Z",
    fields: {
      format: stringValue("riftlite.account-cloud-sync"),
      version: integerValue(options.version ?? 2),
      updated_at: stringValue("2026-07-09T10:00:00.000Z"),
      device_id: stringValue("device-remote"),
      device_name: stringValue("Remote device"),
      app_version: stringValue("0.7.90-test"),
      generation_id: stringValue(options.generationId ?? "generation-old"),
      chunk_count: integerValue(options.chunkCount ?? chunkChecksums.length),
      byte_size: integerValue(options.byteSize ?? Buffer.byteLength(payload, "utf8")),
      checksum_algorithm: stringValue("sha256"),
      checksum: stringValue(options.fullChecksum ?? checksum(payload)),
      chunk_checksums: stringArray(chunkChecksums),
      counts: countsValue()
    }
  };
}

function harness(initialBackup?: RiftLiteBackupFile) {
  let settings = baseSettings();
  let exportedBackup = initialBackup ?? backup(settings);
  const store = {
    getSettings: vi.fn(async () => settings),
    saveSettings: vi.fn(async (patch: Partial<UserSettings>) => {
      settings = { ...settings, ...patch };
      return settings;
    }),
    exportBackupData: vi.fn(async () => exportedBackup),
    restoreBackupData: vi.fn(async () => undefined)
  } as unknown as RiftLiteStore;
  const service = new FirebaseSyncService(store, () => null);
  Object.assign(service, {
    auth: {
      uid: "account-1",
      idToken: "token",
      refreshToken: "refresh",
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    }
  });
  return {
    service,
    store,
    getSettings: () => settings,
    setBackup: (next: RiftLiteBackupFile) => {
      exportedBackup = next;
    }
  };
}

function replaceFirestoreRequest(
  service: FirebaseSyncService,
  implementation: (path: string, idToken: string, options: RequestOptions) => Promise<Record<string, unknown>>
) {
  const request = vi.fn(implementation);
  Object.assign(service, { firestoreRequest: request });
  return request;
}

describe("FirebaseSyncService account cloud sync", () => {
  it("does not overwrite an existing backup when sync is enabled", async () => {
    const { service, store, getSettings } = harness();
    const request = replaceFirestoreRequest(service, async (_path, _token, options) => {
      expect(options.method).toBe("GET");
      return manifestDocument();
    });

    const status = await service.setAccountCloudSyncEnabled(true);

    expect(status).toMatchObject({ enabled: false, hasRemoteBackup: true });
    expect(status.message).toContain("Choose Restore");
    expect(getSettings().accountCloudSyncEnabled).toBe(false);
    expect(store.exportBackupData).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("writes immutable generation chunks before conditionally switching the manifest", async () => {
    const { service } = harness();
    let currentManifest = manifestDocument({ generationId: "generation-old", updateTime: "old-update-time" });
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") {
        return currentManifest;
      }
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        currentManifest = { fields: options.body?.fields ?? {}, updateTime: "new-update-time" };
      }
      return {};
    });

    await service.uploadAccountCloudSync();

    const calls = request.mock.calls as Array<[string, string, RequestOptions]>;
    const chunkWrite = calls.find(([path, , options]) => options.method === "PATCH" && path.includes("/chunks/"));
    const manifestWrite = calls.find(([path, , options]) => options.method === "PATCH" && path.endsWith("/manifest/current"));
    const oldChunkDelete = calls.find(([path, , options]) => options.method === "DELETE" && path.endsWith("generation-old-chunk-0000"));
    expect(chunkWrite).toBeDefined();
    expect(chunkWrite?.[0]).toMatch(/\/chunks\/[a-f0-9-]+-chunk-0000$/);
    expect(chunkWrite?.[2].precondition).toEqual({ exists: false });
    expect(manifestWrite?.[2].precondition).toEqual({ updateTime: "old-update-time" });
    expect(oldChunkDelete).toBeDefined();

    const chunkFields = chunkWrite?.[2].body?.fields as Record<string, { stringValue?: string }>;
    const manifestFields = manifestWrite?.[2].body?.fields as Record<string, {
      stringValue?: string;
      arrayValue?: { values?: Array<{ stringValue?: string }> };
    }>;
    expect(manifestFields.version).toEqual(integerValue(2));
    expect(manifestFields.generation_id.stringValue).toBe(chunkFields.generation_id.stringValue);
    expect(manifestFields.chunk_checksums.arrayValue?.values?.[0]?.stringValue).toBe(chunkFields.checksum.stringValue);
    expect(manifestFields.checksum.stringValue).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses an exists=false manifest precondition for the first backup", async () => {
    const { service } = harness();
    let currentManifest: Record<string, unknown> | null = null;
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET" && path.endsWith("/manifest/current")) {
        if (!currentManifest) {
          throw new Error("Firestore 404");
        }
        return currentManifest;
      }
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        currentManifest = { fields: options.body?.fields ?? {}, updateTime: "created-update-time" };
      }
      return {};
    });

    await service.uploadAccountCloudSync();

    const manifestWrite = (request.mock.calls as Array<[string, string, RequestOptions]>)
      .find(([path, , options]) => options.method === "PATCH" && path.endsWith("/manifest/current"));
    expect(manifestWrite?.[2].precondition).toEqual({ exists: false });
  });

  it("never switches the manifest when part of a generation upload is interrupted", async () => {
    const { service, setBackup, getSettings } = harness();
    const largeBackup = backup(getSettings());
    largeBackup.settings = {
      ...largeBackup.settings,
      username: randomBytes(600_000).toString("base64")
    };
    setBackup(largeBackup);
    const oldManifest = manifestDocument({ generationId: "generation-old" });
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") {
        return oldManifest;
      }
      if (options.method === "PATCH" && /chunk-0001$/.test(path)) {
        throw new Error("simulated interrupted chunk write");
      }
      return {};
    });

    await expect(service.uploadAccountCloudSync()).rejects.toThrow("simulated interrupted chunk write");

    const calls = request.mock.calls as Array<[string, string, RequestOptions]>;
    const chunkWrites = calls.filter(([path, , options]) => options.method === "PATCH" && path.includes("/chunks/"));
    expect(chunkWrites.length).toBeGreaterThan(1);
    expect(calls.some(([path, , options]) => options.method === "PATCH" && path.endsWith("/manifest/current"))).toBe(false);
    expect(calls.some(([, , options]) => options.method === "DELETE")).toBe(true);
  });

  it("treats a concurrent manifest precondition failure as a safe conflict and cleans its orphan", async () => {
    const { service } = harness();
    const oldManifest = manifestDocument({ generationId: "generation-old", updateTime: "old-update-time" });
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") {
        return oldManifest;
      }
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        throw new Error('Firestore 400: {"error":{"status":"FAILED_PRECONDITION"}}');
      }
      return {};
    });

    await expect(service.uploadAccountCloudSync()).rejects.toThrow("changed on another device");

    const calls = request.mock.calls as Array<[string, string, RequestOptions]>;
    const generatedChunkPath = calls.find(([path, , options]) => options.method === "PATCH" && path.includes("/chunks/"))?.[0];
    expect(generatedChunkPath).toBeTruthy();
    expect(calls.some(([path, , options]) => options.method === "DELETE" && path === generatedChunkPath)).toBe(true);
  });

  it("rejects a generation chunk that does not match its checksum", async () => {
    const { service, store } = harness();
    const cloudBackup = backup(baseSettings());
    const compressed = deflateRawSync(Buffer.from(JSON.stringify(cloudBackup), "utf8")).toString("base64");
    const manifest = manifestDocument({
      generationId: "generation-checked",
      payload: compressed,
      byteSize: Buffer.byteLength(compressed, "utf8")
    });
    replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET" && path.endsWith("/manifest/current")) {
        return manifest;
      }
      return {
        fields: {
          generation_id: stringValue("generation-checked"),
          index: integerValue(0),
          payload: stringValue(`${compressed.slice(0, -1)}X`),
          byte_size: integerValue(Buffer.byteLength(compressed, "utf8")),
          checksum: stringValue(checksum(compressed))
        }
      };
    });

    await expect(service.restoreAccountCloudSync()).rejects.toThrow("failed its checksum");
    expect(store.restoreBackupData).not.toHaveBeenCalled();
  });

  it("restores legacy fixed chunks and disables raw replay upload in restored settings", async () => {
    const { service, store } = harness();
    const cloudBackup = backup({
      ...baseSettings(),
      rawCapture: {
        ...baseSettings().rawCapture,
        apiKey: "secret-key",
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        uploadEnabled: true,
        visibility: "public"
      }
    });
    const compressed = deflateRawSync(Buffer.from(JSON.stringify(cloudBackup), "utf8")).toString("base64");
    const legacyManifest = manifestDocument({
      version: 1,
      generationId: "",
      payload: compressed,
      byteSize: Buffer.byteLength(compressed, "utf8")
    });
    replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET" && path.endsWith("/manifest/current")) {
        return legacyManifest;
      }
      expect(path).toMatch(/\/chunks\/chunk-0000$/);
      return {
        fields: {
          index: integerValue(0),
          payload: stringValue(compressed)
        }
      };
    });

    await service.restoreAccountCloudSync();

    expect(store.restoreBackupData).toHaveBeenCalledTimes(1);
    const restored = vi.mocked(store.restoreBackupData).mock.calls[0][0];
    expect(restored.settings.rawCapture).toMatchObject({
      apiKey: "",
      webReplayAutoUploadEnabled: false,
      webReplayAutoUploadAccountUid: "",
      uploadEnabled: false,
      visibility: "private"
    });
  });

  it("does not restore old credentials when token refresh races account unlink", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({
      firebaseUid: "account-1",
      firebaseRefreshToken: "refresh-old",
      rawCapture: {
        ...baseSettings().rawCapture,
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1"
      }
    });
    let resolveRefresh!: (value: {
      uid: string;
      idToken: string;
      refreshToken: string;
      expiresAt: number;
    }) => void;
    const refreshToken = vi.fn(() => new Promise<{
      uid: string;
      idToken: string;
      refreshToken: string;
      expiresAt: number;
    }>((resolve) => {
      resolveRefresh = resolve;
    }));
    Object.assign(service, { refreshToken });

    const pendingRefresh = service.refreshLinkedAccountIdToken();
    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledOnce());
    await service.unlinkAccount();
    resolveRefresh({
      uid: "account-1",
      idToken: "old-id-token",
      refreshToken: "refresh-rotated-old",
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    });

    await expect(pendingRefresh).rejects.toThrow("linked RiftLite account changed");
    expect(getSettings()).toMatchObject({
      accountUid: "",
      firebaseUid: "",
      firebaseRefreshToken: "",
      rawCapture: {
        enabled: false,
        webReplayAutoUploadEnabled: false,
        webReplayAutoUploadAccountUid: ""
      }
    });
  });

  it("verifies that the desktop, website profile, replay library, and replay consent use one UID", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({
      rawCapture: {
        ...baseSettings().rawCapture,
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1"
      }
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      connection: {
        verified: true,
        uid: "account-1",
        email: "person@example.com",
        displayName: "BMU",
        handle: "bmu",
        profileComplete: true,
        replayLibraryReady: true,
        replayCount: 14,
        migrationState: "ready",
        migrationMessage: "",
        checkedAt: "2026-07-11T12:30:00.000Z"
      }
    }), { status: 200 }));

    const status = await service.getAccountConnectionStatus();

    expect(status).toMatchObject({
      connected: true,
      verified: true,
      uid: "account-1",
      replayLibraryReady: true,
      replayCount: 14,
      replayAutoUploadEnabled: true,
      replayAutoUploadAccountMatches: true,
      migrationState: "ready"
    });
    expect(getSettings()).toMatchObject({
      accountLastVerifiedAt: "2026-07-11T12:30:00.000Z",
      accountLastVerificationError: ""
    });
    fetchMock.mockRestore();
  });

  it("rejects a refreshed token that belongs to a different stored account", async () => {
    const { service } = harness();
    Object.assign(service, {
      auth: null,
      refreshToken: vi.fn(async () => ({
        uid: "account-2",
        idToken: "wrong-account-token",
        refreshToken: "wrong-account-refresh",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      }))
    });

    await expect(service.getAccountCloudSyncStatus()).rejects.toThrow("different RiftLite account");
  });
});
