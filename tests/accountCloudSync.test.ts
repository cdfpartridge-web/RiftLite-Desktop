import { createHash, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getVersion: () => "0.7.90-test" }
}));

import { FirebaseSyncService } from "../src/main/services/firebaseSync";
import { AccountCloudSyncQueue } from "../src/main/services/accountCloudSyncQueue";
import { HttpStatusError } from "../src/main/services/httpDeadline";
import { ACCOUNT_CLOUD_MAX_DECODED_BYTES } from "../src/main/services/accountCloudBackupCodec";
import { GameplayMaintenanceDeferredError } from "../src/main/services/gameplayMaintenanceScheduler";
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
    accountCloudSyncRemoteGenerationId: "",
    accountCloudSyncLastSyncedAt: "",
    accountCloudSyncLastRestoredAt: "",
    accountCloudSyncLastError: "",
    rawCapture: {
      enabled: false,
      webReplayAutoUploadEnabled: false,
      webReplayAutoUploadAccountUid: "",
      tcgaWebReplayAutoUploadEnabled: false,
      tcgaWebReplayAutoUploadAccountUid: "",
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
  updatedAt?: string;
  deviceId?: string;
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
      updated_at: stringValue(options.updatedAt ?? "2026-07-09T10:00:00.000Z"),
      device_id: stringValue(options.deviceId ?? "device-remote"),
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

interface ApiCloudManifest {
  format: "riftlite.account-cloud-sync";
  version: number;
  updatedAt: string;
  deviceId: string;
  deviceName: string;
  appVersion: string;
  generationId: string;
  chunkCount: number;
  byteSize: number;
  checksumAlgorithm: string;
  checksum: string;
  chunkChecksums: string[];
  counts: { matches: number; decks: number; notebooks: number; replays: number };
  updateTime: string;
}

function apiCloudManifest(payload: string, options: Partial<ApiCloudManifest> = {}): ApiCloudManifest {
  return {
    format: "riftlite.account-cloud-sync",
    version: 2,
    updatedAt: "2026-07-17T12:00:00.000Z",
    deviceId: "device-api",
    deviceName: "Older Mac",
    appVersion: "0.8.4",
    generationId: "legacy-generation",
    chunkCount: 1,
    byteSize: Buffer.byteLength(payload, "utf8"),
    checksumAlgorithm: "sha256",
    checksum: checksum(payload),
    chunkChecksums: [checksum(payload)],
    counts: { matches: 0, decks: 0, notebooks: 0, replays: 0 },
    updateTime: "2026-07-17T12:00:00.123Z",
    ...options
  };
}

function apiManifestFingerprint(manifest: ApiCloudManifest): string {
  return checksum(JSON.stringify([
    manifest.format,
    manifest.version,
    manifest.updatedAt,
    manifest.deviceId,
    manifest.appVersion,
    manifest.generationId,
    manifest.chunkCount,
    manifest.byteSize,
    manifest.checksumAlgorithm,
    manifest.checksum,
    manifest.chunkChecksums,
    manifest.counts.matches,
    manifest.counts.decks,
    manifest.counts.notebooks,
    manifest.counts.replays,
    new Date(manifest.updateTime).toISOString()
  ]));
}

function apiManifestDocument(manifest: ApiCloudManifest, updateTime = manifest.updateTime): Record<string, unknown> {
  return {
    updateTime,
    fields: {
      format: stringValue(manifest.format),
      version: integerValue(manifest.version),
      updated_at: stringValue(manifest.updatedAt),
      device_id: stringValue(manifest.deviceId),
      device_name: stringValue(manifest.deviceName),
      app_version: stringValue(manifest.appVersion),
      generation_id: stringValue(manifest.generationId),
      chunk_count: integerValue(manifest.chunkCount),
      byte_size: integerValue(manifest.byteSize),
      checksum_algorithm: stringValue(manifest.checksumAlgorithm),
      checksum: stringValue(manifest.checksum),
      chunk_checksums: stringArray(manifest.chunkChecksums),
      counts: countsValue(manifest.counts.matches, manifest.counts.decks, manifest.counts.notebooks)
    }
  };
}

function apiBackupSummary(manifest: ApiCloudManifest) {
  return {
    available: true,
    updatedAt: manifest.updatedAt,
    deviceName: manifest.deviceName,
    appVersion: manifest.appVersion,
    byteSize: manifest.byteSize,
    counts: manifest.counts
  };
}

function conflictApiPayload(id: string, current: ApiCloudManifest, legacy: ApiCloudManifest) {
  return {
    ok: true,
    conflicts: [{
      id,
      status: "pending",
      currentFingerprint: apiManifestFingerprint(current),
      legacyFingerprint: apiManifestFingerprint(legacy),
      current: apiBackupSummary(current),
      legacy: apiBackupSummary(legacy)
    }]
  };
}

function harness(initialBackup?: RiftLiteBackupFile) {
  let settings = baseSettings();
  let publicationReceipt = "";
  let exportedBackup = initialBackup ?? backup(settings);
  const store = {
    getPendingAccountCloudRevision: vi.fn(async () => null),
    acknowledgeAccountCloudRevision: vi.fn(async () => undefined),
    readCloudPublicationReceipt: vi.fn(async () => publicationReceipt),
    writeCloudPublicationReceipt: vi.fn(async (value: string, guard: () => boolean) => {
      if (!guard()) throw new Error("Account changed");
      publicationReceipt = value;
    }),
    discardCloudPublicationReceipt: vi.fn(async (value: string) => {
      if (publicationReceipt === value) publicationReceipt = "";
    }),
    getSettings: vi.fn(async () => settings),
    saveSettings: vi.fn(async (patch: Partial<UserSettings>) => {
      settings = { ...settings, ...patch };
      return settings;
    }),
    updateSettings: vi.fn(async (
      mutation: (current: Readonly<UserSettings>) => Partial<UserSettings>
    ) => {
      settings = { ...settings, ...mutation(settings) };
      return settings;
    }),
    exportBackupData: vi.fn(async () => exportedBackup),
    restoreBackupData: vi.fn(async (next: RiftLiteBackupFile) => {
      exportedBackup = next;
    }),
    getMatches: vi.fn(async () => [])
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

/** In-memory Firestore with actual immutable chunk reads and conditional commits. */
function memoryCloud(service: FirebaseSyncService, initial: Record<string, unknown> | null = manifestDocument()) {
  let current = initial;
  let revision = 0;
  const chunks = new Map<string, Record<string, unknown>>();
  const state = {
    chunks,
    current: () => current,
    onManifestWrite: async (_options: RequestOptions, commit: () => void): Promise<void> => { commit(); }
  };
  const request = replaceFirestoreRequest(service, async (path, _token, options) => {
    if (path.endsWith("/manifest/current")) {
      if (options.method === "GET") {
        if (!current) throw new HttpStatusError("Firestore 404", 404);
        return current;
      }
      if (options.method === "PATCH") {
        const commit = () => {
          const matches = options.precondition?.updateTime
            ? current?.updateTime === options.precondition.updateTime
            : options.precondition?.exists === false && current === null;
          if (!matches) throw new HttpStatusError('Firestore 400: {"error":{"status":"FAILED_PRECONDITION"}}', 400);
          current = { fields: options.body?.fields ?? {}, updateTime: `committed-${++revision}` };
        };
        await state.onManifestWrite(options, commit);
        return current ?? {};
      }
    }
    if (path.includes("/chunks/")) {
      if (options.method === "PATCH") {
        expect(chunks.has(path)).toBe(false);
        chunks.set(path, { fields: options.body?.fields ?? {} });
        return {};
      }
      if (options.method === "DELETE") { chunks.delete(path); return {}; }
      if (options.method === "GET") {
        const chunk = chunks.get(path);
        if (!chunk) throw new HttpStatusError("Firestore 404: chunk missing", 404);
        return chunk;
      }
    }
    throw new Error(`Unexpected synthetic cloud request: ${options.method} ${path}`);
  });
  return { ...state, request, setManifestWriter: (writer: typeof state.onManifestWrite) => { state.onManifestWrite = writer; } };
}

function publicationTimeout(): Error {
  return Object.assign(new Error("Firestore response timed out"), { name: "TimeoutError" });
}

describe("FirebaseSyncService account cloud sync", () => {
  it("acknowledges the revision covered by a successful upload and rejects another account’s queued work", async () => {
    const { service, store } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true });
    const cloud = memoryCloud(service, null);
    vi.mocked(store.getPendingAccountCloudRevision).mockResolvedValue("revision-before-export");
    await expect(service.uploadAccountCloudSync("Pending", { automatic: true, expectedAccountUid: "other" })).rejects.toThrow("account changed");
    expect(cloud.request).not.toHaveBeenCalled();
    cloud.setManifestWriter(async (_options, commit) => {
      vi.mocked(store.getPendingAccountCloudRevision).mockResolvedValue("edit-during-upload");
      commit();
    });
    await service.uploadAccountCloudSync("Pending", { automatic: true, expectedAccountUid: "account-1" });
    expect(store.acknowledgeAccountCloudRevision).toHaveBeenCalledExactlyOnceWith("account-1", "revision-before-export");
  });
  it("retries a transient account-link transport failure once", async () => {
    const { service } = harness();
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        sessionId: "link-session",
        code: "RIFT-1234",
        loginUrl: "https://www.riftlite.com/link-device?session=link-session",
        expiresAt: Date.now() + 60_000
      });
    Object.assign(service, { authenticatedWebsiteRequest: request });

    await expect(service.startAccountLink()).resolves.toMatchObject({ sessionId: "link-session" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("replaces repeated account-link transport failures with actionable guidance", async () => {
    const { service } = harness();
    const request = vi.fn(async () => { throw new TypeError("fetch failed"); });
    Object.assign(service, { authenticatedWebsiteRequest: request });

    await expect(service.startAccountLink()).rejects.toThrow(/connection, VPN, or antivirus/i);
    expect(request).toHaveBeenCalledTimes(2);
  });

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

    await service.uploadAccountCloudSync("Account data synced.", { allowRemoteReplacement: true });

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

  it.each(["timeout", "network"])("confirms its exact committed publication after a lost %s response", async failure => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    let currentManifest = manifestDocument();
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") return currentManifest;
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        currentManifest = { fields: options.body?.fields ?? {}, updateTime: "2026-11-07T12:00:00.000Z" };
        throw failure === "timeout" ? Object.assign(new Error("Firestore response timed out"), { name: "TimeoutError" }) : new TypeError("fetch failed");
      }
      return {};
    });
    const status = await service.uploadAccountCloudSync("Background update", { automatic: true });
    const generation = (currentManifest.fields as Record<string, { stringValue: string }>).generation_id.stringValue;
    expect(status).toMatchObject({ enabled: true, requiresUserChoice: false });
    expect(getSettings()).toMatchObject({ accountCloudSyncRemoteGenerationId: generation, accountCloudSyncLastError: "" });
    expect(request.mock.calls.filter(([path, , options]) => options.method === "PATCH" && path.endsWith("/manifest/current"))).toHaveLength(1);
    expect(request.mock.calls.some(([path, , options]) => options.method === "DELETE" && path.includes(generation))).toBe(false);
    expect(request.mock.calls.some(([path, , options]) => options.method === "DELETE" && path.includes("generation-old"))).toBe(true);
  });

  it("keeps candidate chunks when the original manifest commits after old-manifest confirmation reads", async () => {
    const { service, store } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    const cloud = memoryCloud(service);
    let delayedCommit!: () => void;
    cloud.setManifestWriter(async (_options, commit) => { delayedCommit = commit; throw publicationTimeout(); });
    await expect(service.uploadAccountCloudSync("Final edit", { automatic: true })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(cloud.chunks.size).toBe(1);
    expect(cloud.request.mock.calls.some(([, , options]) => options.method === "DELETE")).toBe(false);
    delayedCommit();
    await expect(service.restoreAccountCloudSync()).resolves.toMatchObject({ hasRemoteBackup: true });
    expect(store.restoreBackupData).toHaveBeenCalledOnce();
  });

  it.each([
    { existing: true, originalWins: false },
    { existing: false, originalWins: false },
    { existing: true, originalWins: true },
    { existing: false, originalWins: true }
  ])("retries the exact pending CAS before newer data (existing=$existing, original wins=$originalWins)", async ({ existing, originalWins }) => {
    const { service, store, setBackup, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: existing ? "generation-old" : "" });
    const cloud = memoryCloud(service, existing ? manifestDocument() : null);
    let delayedCommit!: () => void;
    cloud.setManifestWriter(async (_options, commit) => { delayedCommit = commit; throw publicationTimeout(); });
    await expect(service.uploadAccountCloudSync("First edit", { automatic: true })).rejects.toMatchObject({ name: "TimeoutError" });
    const firstWrite = cloud.request.mock.calls.find(([path, , options]) => path.endsWith("/manifest/current") && options.method === "PATCH")![2];
    const newer = backup(getSettings()); newer.settings.username = "Newer edit"; setBackup(newer);
    let retry = true;
    cloud.setManifestWriter(async (_options, commit) => {
      if (retry && originalWins) delayedCommit();
      retry = false;
      commit();
    });
    await expect(service.uploadAccountCloudSync("Newer edit", { automatic: true })).resolves.toMatchObject({ enabled: true, requiresUserChoice: false });
    const writes = cloud.request.mock.calls.filter(([path, , options]) => path.endsWith("/manifest/current") && options.method === "PATCH");
    expect(writes).toHaveLength(3);
    expect(writes[1][2]).toEqual(firstWrite);
    expect(writes[2][2].precondition).toEqual({ updateTime: "committed-1" });
    expect(() => delayedCommit()).toThrow("FAILED_PRECONDITION");
    await service.restoreAccountCloudSync();
    expect(vi.mocked(store.restoreBackupData).mock.calls[0][0].settings.username).toBe("Newer edit");
    expect(cloud.chunks.size).toBe(1);
  });

  it("retains one candidate through repeated ambiguous retries instead of allocating newer generations", async () => {
    const { service, store } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    const cloud = memoryCloud(service);
    let delayedCommit!: () => void;
    cloud.setManifestWriter(async (_options, commit) => { delayedCommit = commit; throw publicationTimeout(); });
    await expect(service.uploadAccountCloudSync("Final edit", { automatic: true })).rejects.toMatchObject({ name: "TimeoutError" });
    await expect(service.uploadAccountCloudSync("Retry", { automatic: true })).rejects.toMatchObject({ status: 503 });
    await expect(service.uploadAccountCloudSync("Retry again", { automatic: true })).rejects.toMatchObject({ status: 503 });
    expect(store.exportBackupData).toHaveBeenCalledOnce();
    expect(cloud.chunks.size).toBe(1);
    delayedCommit();
    await service.restoreAccountCloudSync();
    expect(store.restoreBackupData).toHaveBeenCalledOnce();
  });

  it.each([409, 412])("does not delete an ambiguous candidate after generic HTTP %i on retry", async status => {
    const { service, store } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    const cloud = memoryCloud(service);
    let delayedCommit!: () => void;
    cloud.setManifestWriter(async (_options, commit) => { delayedCommit = commit; throw publicationTimeout(); });
    await expect(service.uploadAccountCloudSync("Final edit", { automatic: true })).rejects.toMatchObject({ name: "TimeoutError" });
    cloud.setManifestWriter(async () => { throw new HttpStatusError(`Firestore ${status}: {"error":{"status":"ABORTED"}}`, status); });
    await expect(service.uploadAccountCloudSync("Retry", { automatic: true })).rejects.toMatchObject({ status: 503 });
    expect(cloud.chunks.size).toBe(1);
    delayedCommit();
    await service.restoreAccountCloudSync();
    expect(store.restoreBackupData).toHaveBeenCalledOnce();
  });

  it.each([409, 412, 403])("retains a sent candidate after an unproven initial HTTP %i failure", async status => {
    const { service, store } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    const cloud = memoryCloud(service);
    let delayedCommit!: () => void;
    cloud.setManifestWriter(async (_options, commit) => {
      delayedCommit = commit;
      throw new HttpStatusError(`Firestore ${status}`, status);
    });
    await expect(service.uploadAccountCloudSync("Final edit", { automatic: true })).rejects.toMatchObject({ status: status === 403 ? 403 : 503 });
    expect(cloud.chunks.size).toBe(1);
    expect(cloud.request.mock.calls.some(([, , options]) => options.method === "DELETE")).toBe(false);
    delayedCommit();
    await service.restoreAccountCloudSync();
    expect(store.restoreBackupData).toHaveBeenCalledOnce();
  });

  it("refuses to replace another device's revision while an old publication is pending", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    const cloud = memoryCloud(service);
    let delayedCommit!: () => void;
    cloud.setManifestWriter(async (_options, commit) => { delayedCommit = commit; throw publicationTimeout(); });
    await expect(service.uploadAccountCloudSync("Final edit", { automatic: true })).rejects.toMatchObject({ name: "TimeoutError" });
    Object.assign(cloud.current()!, manifestDocument({ generationId: "another-device", updateTime: "advanced-revision" }));
    await expect(service.uploadAccountCloudSync("Retry", { automatic: true })).resolves.toMatchObject({ enabled: false, requiresUserChoice: true });
    expect(cloud.request.mock.calls.filter(([path, , options]) => path.endsWith("/manifest/current") && options.method === "PATCH")).toHaveLength(1);
    expect(() => delayedCommit()).toThrow("FAILED_PRECONDITION");
    expect(getSettings().accountCloudSyncRemoteGenerationId).toBe("generation-old");
  });

  it("preserves pending publication proof when refreshing the same account rotates its token", async () => {
    const { service, store } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    const cloud = memoryCloud(service);
    cloud.setManifestWriter(async () => { throw publicationTimeout(); });
    await expect(service.uploadAccountCloudSync("Final edit", { automatic: true })).rejects.toMatchObject({ name: "TimeoutError" });
    Object.assign(service, { auth: null });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      user_id: "account-1", id_token: "fresh-token", refresh_token: "rotated-token", expires_in: "3600"
    })));
    try {
      cloud.setManifestWriter(async (_options, commit) => { commit(); });
      await expect(service.uploadAccountCloudSync("Retry", { automatic: true })).resolves.toMatchObject({ enabled: true, requiresUserChoice: false });
      const writes = cloud.request.mock.calls.filter(([path, , options]) => path.endsWith("/manifest/current") && options.method === "PATCH");
      expect(writes).toHaveLength(3);
      expect(writes[1][2]).toEqual(writes[0][2]);
      expect(writes[1][1]).toBe("fresh-token");
      await service.restoreAccountCloudSync();
      expect(store.restoreBackupData).toHaveBeenCalledOnce();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("keeps uncertain chunks without adopting the publication after an account switch", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    const cloud = memoryCloud(service);
    let delayedCommit!: () => void;
    cloud.setManifestWriter(async (_options, commit) => {
      delayedCommit = commit;
      service.invalidateLinkedAccountAuth();
      await store.saveSettings({ accountUid: "account-2", firebaseRefreshToken: "refresh-2", accountCloudSyncRemoteGenerationId: "account-2-pin" });
      throw publicationTimeout();
    });
    await expect(service.uploadAccountCloudSync("Final edit", { automatic: true })).rejects.toThrow("account changed");
    delayedCommit();
    expect(cloud.chunks.size).toBe(1);
    expect(getSettings()).toMatchObject({ accountUid: "account-2", accountCloudSyncRemoteGenerationId: "account-2-pin" });
    expect(cloud.request.mock.calls.some(([, , options]) => options.method === "DELETE")).toBe(false);
    expect(store.restoreBackupData).not.toHaveBeenCalled();
  });

  it.each([408, 429, 503, 401, 403])("classifies actual token refresh HTTP %i through the cloud queue", async status => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response('{"error":"synthetic token failure"}', { status }))
      .mockResolvedValue(new Response(JSON.stringify({ user_id: "account-1", id_token: "fresh-token", refresh_token: "rotated-token", expires_in: "3600" })));
    try {
      const { service, store } = harness();
      await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
      Object.assign(service, { auth: null });
      const cloud = memoryCloud(service);
      const errors = vi.fn();
      const run = vi.fn(async (reason: string) => { await service.uploadAccountCloudSync(reason, { automatic: true }); });
      const queue = new AccountCloudSyncQueue(run, errors, 20_000);
      queue.queue("Last edit");
      await vi.advanceTimersByTimeAsync(20_000);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(cloud.request).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledOnce();
      if ([408, 429, 503].includes(status)) {
        expect(errors.mock.calls[0][0].message).toContain("temporarily");
        expect(errors.mock.calls[0][0].message).not.toContain("session expired");
        await vi.advanceTimersByTimeAsync(30_000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(run).toHaveBeenCalledTimes(2);
        expect(cloud.chunks.size).toBe(1);
      } else {
        expect(errors.mock.calls[0][0].message).toContain("session expired");
        await vi.advanceTimersByTimeAsync(600_000);
        expect(run).toHaveBeenCalledOnce();
        expect(queue.takePendingReason()).toBe("");
      }
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });

  it("confirms a retained own publication on the next pass and still uploads newer local changes", async () => {
    const { service, store, setBackup, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    let currentManifest = manifestDocument(), unavailable = false, writes = 0;
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") {
        if (unavailable) throw new TypeError("fetch failed");
        return currentManifest;
      }
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        currentManifest = { fields: options.body?.fields ?? {}, updateTime: `committed-${++writes}` };
        if (writes === 1) {
          unavailable = true;
          throw Object.assign(new Error("Firestore response timed out"), { name: "TimeoutError" });
        }
      }
      return {};
    });
    await expect(service.uploadAccountCloudSync("First mutation", { automatic: true })).rejects.toMatchObject({ name: "TimeoutError" });
    const firstGeneration = (currentManifest.fields as Record<string, { stringValue: string }>).generation_id.stringValue;
    expect(getSettings().accountCloudSyncRemoteGenerationId).toBe("generation-old");
    const newer = backup(getSettings()); newer.settings.username = "Mutation after ambiguous commit"; setBackup(newer);
    unavailable = false;
    await expect(service.uploadAccountCloudSync("New mutation", { automatic: true })).resolves.toMatchObject({ enabled: true, requiresUserChoice: false });
    expect(writes).toBe(2);
    expect(getSettings().accountCloudSyncRemoteGenerationId).not.toBe(firstGeneration);
    expect(store.exportBackupData).toHaveBeenCalledTimes(2);
    const lastChunk = request.mock.calls.filter(([path, , options]) => options.method === "PATCH" && path.includes("/chunks/")).at(-1)!;
    const payload = (lastChunk[2].body?.fields?.payload as { stringValue: string }).stringValue;
    const decoded = JSON.parse(inflateRawSync(Buffer.from(payload, "base64")).toString("utf8"));
    expect(decoded.settings.username).toBe("Mutation after ambiguous commit");
  });

  it("retains exact publication proof until the local generation pin is durably saved", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    let currentManifest = manifestDocument(), writes = 0;
    replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") return currentManifest;
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        currentManifest = { fields: options.body?.fields ?? {}, updateTime: `committed-${++writes}` };
        if (writes === 1) {
          vi.mocked(store.updateSettings).mockRejectedValueOnce(new Error("local settings write failed"));
          throw Object.assign(new Error("Firestore response timed out"), { name: "TimeoutError" });
        }
      }
      return {};
    });
    await expect(service.uploadAccountCloudSync("First mutation", { automatic: true })).rejects.toThrow("local settings write failed");
    expect(getSettings().accountCloudSyncRemoteGenerationId).toBe("generation-old");
    await expect(service.uploadAccountCloudSync("Retry after storage recovers", { automatic: true })).resolves.toMatchObject({ enabled: true, requiresUserChoice: false });
    expect(writes).toBe(2);
    expect(getSettings().accountCloudSyncRemoteGenerationId).not.toBe("generation-old");
  });

  it.each(["success", "timeout"])("recovers its own committed %s publication after a process restart", async outcome => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    const cloud = memoryCloud(service);
    cloud.setManifestWriter(async (_options, commit) => {
      expect(JSON.parse(await store.readCloudPublicationReceipt()).accountUid).toBe("account-1");
      commit();
      vi.mocked(store.updateSettings).mockRejectedValueOnce(new Error("Local pin could not be saved"));
      if (outcome === "timeout") throw publicationTimeout();
    });
    await expect(service.uploadAccountCloudSync("Edit", { automatic: true })).rejects.toThrow(/pin could not be saved/i);
    expect(getSettings().accountCloudSyncRemoteGenerationId).toBe("generation-old");
    const restarted = new FirebaseSyncService(store, () => null);
    Object.assign(restarted, { auth: { uid: "account-1", idToken: "token", refreshToken: "refresh", expiresAt: Date.now() / 1000 + 3600 } });
    replaceFirestoreRequest(restarted, cloud.request);
    cloud.setManifestWriter(async (_options, commit) => commit());
    await expect(restarted.getAccountCloudSyncStatus()).resolves.toMatchObject({ requiresUserChoice: false });
    await expect(restarted.uploadAccountCloudSync("Resume", { automatic: true })).resolves.toMatchObject({
      enabled: true, requiresUserChoice: false
    });
    expect(getSettings().accountCloudSyncRemoteGenerationId).not.toBe("generation-old");
    expect(cloud.chunks.size).toBe(1);
  });

  it("allows enabling sync after the first backup committed but its local pin failed", async () => {
    const { service, store } = harness();
    const cloud = memoryCloud(service, null);
    cloud.setManifestWriter(async (_options, commit) => {
      commit();
      vi.mocked(store.updateSettings).mockRejectedValueOnce(new Error("First pin failed"));
    });
    await expect(service.setAccountCloudSyncEnabled(true)).rejects.toThrow("First pin failed");
    await expect(service.setAccountCloudSyncEnabled(true)).resolves.toMatchObject({ enabled: true, requiresUserChoice: false });
    expect(cloud.chunks.size).toBe(1);
  });

  it.each(["version", "generation_id", "device_id", "device_name", "updated_at", "app_version", "checksum", "checksum_algorithm", "chunk_checksums", "chunk_count", "byte_size", "counts", "updateTime"])("does not adopt an ambiguous publication with mismatched %s", async field => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    let currentManifest = manifestDocument();
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") return currentManifest;
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        const fields = { ...options.body?.fields };
        if (field === "chunk_checksums") fields[field] = stringArray(["b".repeat(64)]);
        else if (field === "counts") fields[field] = countsValue(77);
        else if (field === "version" || field === "chunk_count" || field === "byte_size") fields[field] = integerValue(99);
        else if (field !== "updateTime") fields[field] = stringValue("different");
        currentManifest = { fields, updateTime: field === "updateTime" ? "" : "committed-time" };
        throw Object.assign(new Error("Firestore response timed out"), { name: "TimeoutError" });
      }
      return {};
    });
    await expect(service.uploadAccountCloudSync("Ambiguous commit", { automatic: true })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(getSettings().accountCloudSyncRemoteGenerationId).toBe("generation-old");
    await expect(service.uploadAccountCloudSync("Retry", { automatic: true })).resolves.toMatchObject({ enabled: false, requiresUserChoice: true });
    expect(request.mock.calls.filter(([path, , options]) => options.method === "PATCH" && path.endsWith("/manifest/current"))).toHaveLength(1);
  });

  it("does not adopt an own committed publication after its account changes during confirmation", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    let currentManifest = manifestDocument(), committed = false, switched = false;
    replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") {
        if (committed && !switched) {
          switched = true;
          service.invalidateLinkedAccountAuth();
          await store.saveSettings({ accountUid: "account-2", firebaseRefreshToken: "refresh-2", accountCloudSyncRemoteGenerationId: "other-account-pin" });
        }
        return currentManifest;
      }
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        currentManifest = { fields: options.body?.fields ?? {}, updateTime: "committed-time" }; committed = true;
        throw Object.assign(new Error("Firestore response timed out"), { name: "TimeoutError" });
      }
      return {};
    });
    await expect(service.uploadAccountCloudSync("Ambiguous commit", { automatic: true })).rejects.toThrow("account changed");
    expect(getSettings()).toMatchObject({ accountUid: "account-2", accountCloudSyncRemoteGenerationId: "other-account-pin" });
  });

  it("does not let a retained ambiguous publication override a later restore generation choice", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    let currentManifest = manifestDocument(), unavailable = false;
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") { if (unavailable) throw new TypeError("fetch failed"); return currentManifest; }
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        currentManifest = { fields: options.body?.fields ?? {}, updateTime: "committed-time" }; unavailable = true;
        throw Object.assign(new Error("Firestore response timed out"), { name: "TimeoutError" });
      }
      return {};
    });
    await expect(service.uploadAccountCloudSync("Ambiguous commit", { automatic: true })).rejects.toMatchObject({ name: "TimeoutError" });
    await store.saveSettings({ accountCloudSyncRemoteGenerationId: "restored-generation-choice" }); unavailable = false;
    await expect(service.uploadAccountCloudSync("Retry", { automatic: true })).resolves.toMatchObject({ enabled: false, requiresUserChoice: true });
    expect(getSettings().accountCloudSyncRemoteGenerationId).toBe("restored-generation-choice");
    expect(request.mock.calls.filter(([path, , options]) => options.method === "PATCH" && path.endsWith("/manifest/current"))).toHaveLength(1);
  });

  it.each([true, false])("discards ambiguous publication intent only when the fenced restore succeeds=%s", async succeeded => {
    const { service, store } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    let currentManifest = manifestDocument(), unavailable = false, writes = 0;
    replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") { if (unavailable) throw new TypeError("fetch failed"); return currentManifest; }
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        currentManifest = { fields: options.body?.fields ?? {}, updateTime: `committed-${++writes}` };
        if (writes === 1) { unavailable = true; throw Object.assign(new Error("response timed out"), { name: "TimeoutError" }); }
      }
      return {};
    });
    await expect(service.uploadAccountCloudSync("Ambiguous commit", { automatic: true })).rejects.toMatchObject({ name: "TimeoutError" });
    const restore = service.runWithAccountCloudRestoreFence(async () => { if (!succeeded) throw new Error("local restore failed"); });
    if (succeeded) await restore;
    else await expect(restore).rejects.toThrow("local restore failed");
    unavailable = false;
    await expect(service.uploadAccountCloudSync("Retry", { automatic: true })).resolves.toMatchObject({ enabled: !succeeded, requiresUserChoice: succeeded });
    expect(writes).toBe(succeeded ? 1 : 2);
  });

  it("requests the replay-free export and keeps cloud data and consent redaction intact", async () => {
    const source = backup(baseSettings());
    source.settings.username = "Backup Player";
    source.settings.rawCapture.webReplayAutoUploadEnabled = true;
    source.settings.rawCapture.webReplayAutoUploadAccountUid = "account-1";
    source.settings.rawCapture.webReplayDiscordShareEnabled = true;
    source.settings.rawCapture.webReplayDiscordShareAccountUid = "account-1";
    source.settings.rawCapture.webReplayDiscordShareHubIds = ["private-hub"];
    source.matches = [{ id: "kept-match", notes: "Match note" } as RiftLiteBackupFile["matches"][number]];
    source.decks = [{ id: "kept-deck", title: "Deck title" } as RiftLiteBackupFile["decks"][number]];
    source.notebooks = [{ deckId: "kept-deck", goals: [] } as RiftLiteBackupFile["notebooks"][number]];
    const { service, store } = harness(source);
    let currentManifest: Record<string, unknown> | null = null;
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") {
        if (!currentManifest) throw new Error("Firestore 404");
        return currentManifest;
      }
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        currentManifest = { fields: options.body?.fields ?? {}, updateTime: "created-update-time" };
      }
      return {};
    });

    await service.uploadAccountCloudSync();

    expect(store.exportBackupData).toHaveBeenCalledWith({ includeRecycleBin: false, includeReplays: false });
    const chunks = request.mock.calls
      .filter(([path, , options]) => options.method === "PATCH" && path.includes("/chunks/"))
      .map(([, , options]) => (options.body!.fields!.payload as { stringValue: string }).stringValue);
    const uploaded = JSON.parse(inflateRawSync(Buffer.from(chunks.join(""), "base64")).toString("utf8")) as RiftLiteBackupFile;
    expect(uploaded.matches).toEqual(source.matches);
    expect(uploaded.decks).toEqual(source.decks);
    expect(uploaded.notebooks).toEqual(source.notebooks);
    expect(uploaded.replays).toEqual([]);
    expect(uploaded.deletedReplays).toEqual([]);
    expect(uploaded.settings.username).toBe("Backup Player");
    expect(uploaded.settings.firebaseRefreshToken).toBe("");
    expect(uploaded.settings.rawCapture).toMatchObject({
      webReplayAutoUploadEnabled: false, webReplayAutoUploadAccountUid: "",
      webReplayDiscordShareEnabled: false, webReplayDiscordShareAccountUid: "", webReplayDiscordShareHubIds: [],
      uploadEnabled: false, apiKey: "", visibility: "private"
    });
  });

  it("does not overwrite a newer sequential generation from another device", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({
      accountCloudSyncEnabled: true,
      accountCloudSyncRemoteGenerationId: "generation-this-device-last-saw"
    });
    const request = replaceFirestoreRequest(service, async (_path, _token, options) => {
      expect(options.method).toBe("GET");
      return manifestDocument({ generationId: "generation-from-other-device" });
    });

    const status = await service.uploadAccountCloudSync();

    expect(status).toMatchObject({
      enabled: false,
      hasRemoteBackup: true,
      requiresUserChoice: true
    });
    expect(status.message).toContain("changed on another device");
    expect(getSettings()).toMatchObject({
      accountCloudSyncEnabled: false,
      accountCloudSyncRemoteGenerationId: "generation-this-device-last-saw"
    });
    expect(store.exportBackupData).not.toHaveBeenCalled();
    expect(request.mock.calls.some(([, , options]) => options.method === "PATCH")).toBe(false);
  });

  it("uploads from its pinned generation and rotates the durable generation pin", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({
      accountCloudSyncEnabled: true,
      accountCloudSyncRemoteGenerationId: "generation-old"
    });
    let currentManifest = manifestDocument({ generationId: "generation-old", updateTime: "old-update-time" });
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") return currentManifest;
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        currentManifest = { fields: options.body?.fields ?? {}, updateTime: "new-update-time" };
      }
      return {};
    });

    await service.uploadAccountCloudSync();

    const manifestWrite = (request.mock.calls as Array<[string, string, RequestOptions]>)
      .find(([path, , options]) => options.method === "PATCH" && path.endsWith("/manifest/current"));
    const generationId = (manifestWrite?.[2].body?.fields?.generation_id as { stringValue?: string })?.stringValue;
    expect(generationId).toMatch(/^[a-f0-9-]+$/);
    expect(generationId).not.toBe("generation-old");
    expect(getSettings()).toMatchObject({
      accountCloudSyncEnabled: true,
      accountCloudSyncRemoteGenerationId: generationId,
      accountCloudSyncLastError: ""
    });
  });

  it("adopts a provably identical pre-v0.9.10 generation without a false conflict", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({
      accountCloudSyncEnabled: true,
      accountCloudSyncLastSyncedAt: "2026-07-09T10:00:00.000Z",
      accountCloudSyncRemoteGenerationId: ""
    });
    let currentManifest = manifestDocument({
      generationId: "legacy-known-generation",
      deviceId: "device-local",
      updatedAt: "2026-07-09T10:00:00.000Z",
      updateTime: "old-update-time"
    });
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") return currentManifest;
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        currentManifest = { fields: options.body?.fields ?? {}, updateTime: "new-update-time" };
      }
      return {};
    });

    await service.uploadAccountCloudSync();

    expect(request.mock.calls.some(([path, , options]) =>
      options.method === "PATCH" && path.endsWith("/manifest/current"))).toBe(true);
    expect(getSettings().accountCloudSyncRemoteGenerationId).not.toBe("");
    expect(getSettings().accountCloudSyncRemoteGenerationId).not.toBe("legacy-known-generation");
  });

  it("does not silently recreate a cloud generation removed elsewhere", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({
      accountCloudSyncEnabled: true,
      accountCloudSyncRemoteGenerationId: "generation-removed"
    });
    let currentManifest: Record<string, unknown> | null = null;
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET" && path.endsWith("/manifest/current")) {
        if (!currentManifest) throw new Error("Firestore 404");
        return currentManifest;
      }
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        currentManifest = { fields: options.body?.fields ?? {}, updateTime: "recreated-update-time" };
      }
      return {};
    });

    const blocked = await service.uploadAccountCloudSync();
    expect(blocked).toMatchObject({
      enabled: false,
      hasRemoteBackup: false,
      requiresUserChoice: true
    });
    expect(blocked.message).toContain("removed elsewhere");
    expect(request.mock.calls.some(([, , options]) => options.method === "PATCH")).toBe(false);

    await service.uploadAccountCloudSync(
      "Account data synced.",
      { allowRemoteReplacement: true }
    );
    expect(request.mock.calls.some(([path, , options]) =>
      options.method === "PATCH" && path.endsWith("/manifest/current"))).toBe(true);
    expect(getSettings().accountCloudSyncRemoteGenerationId).not.toBe("generation-removed");
  });

  it("reports a removed pinned backup accurately during a status-only check", async () => {
    const { service, store } = harness();
    await store.saveSettings({
      accountCloudSyncRemoteGenerationId: "generation-removed"
    });
    replaceFirestoreRequest(service, async () => {
      throw new Error("Firestore 404");
    });

    const status = await service.getAccountCloudSyncStatus();

    expect(status).toMatchObject({ hasRemoteBackup: false, requiresUserChoice: true });
    expect(status.message).toContain("removed elsewhere");
    expect(status.message).not.toContain("No account cloud backup yet");
  });

  it("reports a mismatched pinned generation accurately during a status-only check", async () => {
    const { service, store } = harness();
    await store.saveSettings({
      accountCloudSyncRemoteGenerationId: "generation-this-device-last-saw"
    });
    replaceFirestoreRequest(service, async () => (
      manifestDocument({ generationId: "generation-from-other-device" })
    ));

    const status = await service.getAccountCloudSyncStatus();

    expect(status).toMatchObject({ hasRemoteBackup: true, requiresUserChoice: true });
    expect(status.message).toContain("changed elsewhere");
    expect(status.message).toContain("Choose Restore");
  });

  it("discards an automatic upload when cloud sync is disabled", async () => {
    const { service, store } = harness();
    const request = replaceFirestoreRequest(service, async () => {
      throw new Error("Automatic upload must not reach Firestore.");
    });

    const status = await service.uploadAccountCloudSync("Background update", { automatic: true });

    expect(status).toMatchObject({ enabled: false, hasRemoteBackup: false });
    expect(status.message).toContain("queued background update was discarded");
    expect(store.exportBackupData).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("defers an automatic upload before reading data when gameplay is busy", async () => {
    const { service, store, getSettings } = harness();
    const checkpoint = () => { throw new GameplayMaintenanceDeferredError(); };
    const request = replaceFirestoreRequest(service, async () => ({}));

    await expect(service.uploadAccountCloudSync("Background update", { automatic: true, checkpoint }))
      .rejects.toBeInstanceOf(GameplayMaintenanceDeferredError);

    expect(store.getSettings).not.toHaveBeenCalled();
    expect(store.exportBackupData).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(getSettings().accountCloudSyncLastError).toBe("");
    // The rejected preparation must release the upload lane and restore fence.
    await expect(service.runWithAccountCloudRestoreFence(async () => "restored")).resolves.toBe("restored");
  });

  it("defers after a pending manifest read before exporting or creating a generation", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    let ready = true;
    const checkpoint = () => { if (!ready) throw new GameplayMaintenanceDeferredError(); };
    const request = replaceFirestoreRequest(service, async () => {
      ready = false;
      return manifestDocument();
    });

    await expect(service.uploadAccountCloudSync("Background update", { automatic: true, checkpoint }))
      .rejects.toBeInstanceOf(GameplayMaintenanceDeferredError);

    expect(store.exportBackupData).not.toHaveBeenCalled();
    expect(request.mock.calls.every(([, , options]) => options.method === "GET")).toBe(true);
    expect(getSettings().accountCloudSyncLastError).toBe("");
  });

  it("discards an automatic upload when the account changes during its pending manifest read", async () => {
    const { service, store } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    const request = replaceFirestoreRequest(service, async () => {
      await store.saveSettings({ accountUid: "account-2", firebaseUid: "account-2" });
      return manifestDocument();
    });

    const status = await service.uploadAccountCloudSync("Background update", { automatic: true, checkpoint: () => undefined });

    expect(status.message).toContain("nothing was uploaded");
    expect(store.exportBackupData).not.toHaveBeenCalled();
    expect(request.mock.calls.every(([, , options]) => options.method === "GET")).toBe(true);
  });

  it("defers after local backup export before serialization, compression or generation writes", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    let ready = true;
    const checkpoint = () => { if (!ready) throw new GameplayMaintenanceDeferredError(); };
    const exported = backup(getSettings());
    const serializeMatches = vi.fn(() => []);
    Object.assign(exported.matches, { toJSON: serializeMatches });
    vi.mocked(store.exportBackupData).mockImplementationOnce(async () => {
      ready = false;
      return exported;
    });
    const request = replaceFirestoreRequest(service, async () => manifestDocument());

    await expect(service.uploadAccountCloudSync("Background update", { automatic: true, checkpoint }))
      .rejects.toBeInstanceOf(GameplayMaintenanceDeferredError);

    expect(store.exportBackupData).toHaveBeenCalledOnce();
    expect(serializeMatches).not.toHaveBeenCalled();
    expect(request.mock.calls.every(([, , options]) => options.method === "GET")).toBe(true);
    expect(getSettings().accountCloudSyncLastError).toBe("");
  });

  it("rejects a changed account after pending local export before generation writes", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    const exported = backup(getSettings());
    vi.mocked(store.exportBackupData).mockImplementationOnce(async () => {
      await store.saveSettings({ accountUid: "account-2", firebaseUid: "account-2" });
      return exported;
    });
    const request = replaceFirestoreRequest(service, async () => manifestDocument());

    await expect(service.uploadAccountCloudSync("Background update", { automatic: true, checkpoint: () => undefined }))
      .rejects.toThrow("account changed");

    expect(request.mock.calls.every(([, , options]) => options.method === "GET")).toBe(true);
  });

  it("finishes the atomic generation once chunk publication starts even if gameplay begins", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true, accountCloudSyncRemoteGenerationId: "generation-old" });
    let ready = true;
    const checkpoint = () => { if (!ready) throw new GameplayMaintenanceDeferredError(); };
    let currentManifest = manifestDocument();
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") return currentManifest;
      if (options.method === "PATCH" && path.includes("/chunks/")) ready = false;
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        currentManifest = { fields: options.body?.fields ?? {}, updateTime: "new-update-time" };
      }
      return {};
    });

    await expect(service.uploadAccountCloudSync("Background update", { automatic: true, checkpoint }))
      .resolves.toMatchObject({ enabled: true });

    expect(ready).toBe(false);
    expect(request.mock.calls.some(([path, , options]) => options.method === "PATCH" && path.endsWith("/manifest/current"))).toBe(true);
    expect(getSettings().accountCloudSyncLastError).toBe("");
    expect(getSettings().accountCloudSyncRemoteGenerationId).not.toBe("generation-old");
  });

  it("keeps an explicitly requested upload outside automatic gameplay checkpoints", async () => {
    const { service, store } = harness();
    const checkpoint = vi.fn(() => { throw new GameplayMaintenanceDeferredError(); });
    let currentManifest = manifestDocument();
    replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") return currentManifest;
      if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
        currentManifest = { fields: options.body?.fields ?? {}, updateTime: "new-update-time" };
      }
      return {};
    });

    await service.uploadAccountCloudSync("Sync now", { allowRemoteReplacement: true, checkpoint });

    expect(checkpoint).not.toHaveBeenCalled();
    expect(store.exportBackupData).toHaveBeenCalledOnce();
  });

  it("rejects restore instead of waiting behind an upload that could replace its source", async () => {
    const { service } = harness();
    const events: string[] = [];
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    Object.assign(service, {
      uploadAccountCloudSyncUnlocked: vi.fn(async () => {
        events.push("upload-start");
        await uploadGate;
        events.push("upload-end");
        return {};
      }),
      restoreAccountCloudSyncUnlocked: vi.fn(async () => {
        events.push("restore-start");
        return {};
      })
    });

    const upload = service.uploadAccountCloudSync();
    await vi.waitFor(() => expect(events).toEqual(["upload-start"]));
    const restore = service.restoreAccountCloudSync();
    await expect(restore).rejects.toThrow("currently uploading");
    expect(events).toEqual(["upload-start"]);

    releaseUpload();
    await upload;
    expect(events).toEqual(["upload-start", "upload-end"]);
  });

  it("refuses a new upload once restore intent has been established", async () => {
    const { service } = harness();
    let releaseRestore!: () => void;
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    const uploadUnlocked = vi.fn(async () => ({}));
    Object.assign(service, {
      restoreAccountCloudSyncUnlocked: vi.fn(async () => {
        await restoreGate;
        return {};
      }),
      uploadAccountCloudSyncUnlocked: uploadUnlocked
    });

    const restore = service.restoreAccountCloudSync();
    await Promise.resolve();
    await expect(service.uploadAccountCloudSync()).rejects.toThrow("being restored");
    expect(uploadUnlocked).not.toHaveBeenCalled();
    releaseRestore();
    await restore;
  });

  it("refuses a local backup restore before replacement when an upload is active", async () => {
    const { service } = harness();
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const uploadUnlocked = vi.fn(async () => {
      await uploadGate;
      return {};
    });
    Object.assign(service, { uploadAccountCloudSyncUnlocked: uploadUnlocked });
    const localDatabaseReplacement = vi.fn(async () => undefined);

    const upload = service.uploadAccountCloudSync();
    await vi.waitFor(() => expect(uploadUnlocked).toHaveBeenCalledOnce());
    await expect(service.runWithAccountCloudRestoreFence(
      () => localDatabaseReplacement()
    )).rejects.toThrow("currently uploading");
    expect(localDatabaseReplacement).not.toHaveBeenCalled();

    releaseUpload();
    await upload;
  });

  it("blocks direct uploads for the entire local backup restore fence", async () => {
    const { service } = harness();
    let releaseLocalRestore!: () => void;
    const localRestoreGate = new Promise<void>((resolve) => {
      releaseLocalRestore = resolve;
    });
    let markLocalRestoreStarted!: () => void;
    const localRestoreStarted = new Promise<void>((resolve) => {
      markLocalRestoreStarted = resolve;
    });
    const uploadUnlocked = vi.fn(async () => ({}));
    Object.assign(service, { uploadAccountCloudSyncUnlocked: uploadUnlocked });

    const localRestore = service.runWithAccountCloudRestoreFence(async () => {
      markLocalRestoreStarted();
      await localRestoreGate;
    });
    await localRestoreStarted;
    await expect(service.uploadAccountCloudSync()).rejects.toThrow("being restored");
    expect(uploadUnlocked).not.toHaveBeenCalled();

    releaseLocalRestore();
    await localRestore;
  });

  it("reuses one common fence for cloud and retained-backup restores", async () => {
    const { service } = harness();
    const restoreCurrent = vi.fn(async () => ({}));
    const restoreLegacy = vi.fn(async () => ({}));
    Object.assign(service, {
      restoreAccountCloudSyncUnlocked: restoreCurrent,
      restoreAccountCloudSyncConflictLegacyUnlocked: restoreLegacy
    });

    await service.runWithAccountCloudRestoreFence(async (restoreFence) => {
      await service.restoreAccountCloudSync(restoreFence);
    });
    await service.runWithAccountCloudRestoreFence(async (restoreFence) => {
      await service.restoreAccountCloudSyncConflictLegacy("a".repeat(64), restoreFence);
    });

    expect(restoreCurrent).toHaveBeenCalledOnce();
    expect(restoreLegacy).toHaveBeenCalledOnce();
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

    await expect(service.uploadAccountCloudSync(
      "Account data synced.",
      { allowRemoteReplacement: true }
    )).rejects.toThrow("simulated interrupted chunk write");

    const calls = request.mock.calls as Array<[string, string, RequestOptions]>;
    const chunkWrites = calls.filter(([path, , options]) => options.method === "PATCH" && path.includes("/chunks/"));
    expect(chunkWrites.length).toBeGreaterThan(1);
    expect(calls.some(([path, , options]) => options.method === "PATCH" && path.endsWith("/manifest/current"))).toBe(false);
    expect(calls.some(([, , options]) => options.method === "DELETE")).toBe(true);
  });

  it("abandons and cleans an upload generation when unlink starts before the manifest switch", async () => {
    const { service, store, getSettings } = harness();
    const oldManifest = manifestDocument({ generationId: "generation-old" });
    let releaseChunkWrite!: () => void;
    const chunkWriteGate = new Promise<void>((resolve) => {
      releaseChunkWrite = resolve;
    });
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET") return oldManifest;
      if (options.method === "PATCH" && path.includes("/chunks/")) {
        await chunkWriteGate;
      }
      return {};
    });

    const pendingUpload = service.uploadAccountCloudSync(
      "Account data synced.",
      { allowRemoteReplacement: true }
    );
    await vi.waitFor(() => expect(request.mock.calls.some(([path, , options]) =>
      options.method === "PATCH" && path.includes("/chunks/"))).toBe(true));
    const pendingUnlink = service.unlinkAccount();
    releaseChunkWrite();

    await expect(pendingUpload).rejects.toThrow("account changed");
    await pendingUnlink;
    expect(request.mock.calls.some(([path, , options]) =>
      options.method === "PATCH" && path.endsWith("/manifest/current"))).toBe(false);
    expect(request.mock.calls.some(([path, , options]) =>
      options.method === "DELETE" && path.includes("/chunks/"))).toBe(true);
    expect(store.exportBackupData).toHaveBeenCalledOnce();
    expect(getSettings()).toMatchObject({
      accountUid: "",
      firebaseRefreshToken: "",
      accountCloudSyncEnabled: false
    });
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

    await expect(service.uploadAccountCloudSync(
      "Account data synced.",
      { allowRemoteReplacement: true }
    )).rejects.toThrow("changed on another device");

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

  it("rejects an excessive expansion without restoring or modifying either backup", async () => {
    const { service, store, getSettings } = harness();
    const compressed = deflateRawSync(Buffer.alloc(ACCOUNT_CLOUD_MAX_DECODED_BYTES + 1, 32)).toString("base64");
    const manifest = manifestDocument({ generationId: "generation-oversized", payload: compressed });
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET" && path.endsWith("/manifest/current")) return manifest;
      return { fields: { generation_id: stringValue("generation-oversized"), index: integerValue(0),
        payload: stringValue(compressed), byte_size: integerValue(Buffer.byteLength(compressed)), checksum: stringValue(checksum(compressed)) } };
    });
    await expect(service.restoreAccountCloudSync()).rejects.toThrow("64 MiB decoded");
    expect(store.restoreBackupData).not.toHaveBeenCalled();
    expect(request.mock.calls.every(([, , options]) => options.method === "GET")).toBe(true);
    expect(getSettings().accountCloudSyncRemoteGenerationId).toBe("");
  });

  it("rejects oversized publication before writing any chunks or changing the existing generation", async () => {
    const value = backup({ ...baseSettings(), accountDisplayName: "x".repeat(ACCOUNT_CLOUD_MAX_DECODED_BYTES) });
    const { service, getSettings } = harness(value);
    const request = replaceFirestoreRequest(service, async () => manifestDocument());
    await expect(service.uploadAccountCloudSync("Sync", { allowRemoteReplacement: true })).rejects.toThrow("64 MiB decoded");
    expect(request.mock.calls.every(([, , options]) => options.method === "GET")).toBe(true);
    expect(getSettings().accountCloudSyncRemoteGenerationId).toBe("");
  });

  it("cancels an active decoder when unlink starts and releases the restore lane", async () => {
    const { service, store, getSettings } = harness();
    const compressed = deflateRawSync(Buffer.from(JSON.stringify(backup(baseSettings())))).toString("base64");
    const manifest = manifestDocument({ generationId: "generation-cancelled", payload: compressed });
    replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET" && path.endsWith("/manifest/current")) return manifest;
      return { fields: { generation_id: stringValue("generation-cancelled"), index: integerValue(0),
        payload: stringValue(compressed), byte_size: integerValue(Buffer.byteLength(compressed)), checksum: stringValue(checksum(compressed)) } };
    });
    const pendingRestore = service.restoreAccountCloudSync();
    const rejection = expect(pendingRestore).rejects.toThrow("cancelled");
    const state = service as unknown as { accountCloudDecodeAbort: AbortController | null };
    await vi.waitFor(() => expect(state.accountCloudDecodeAbort).not.toBeNull(), { interval: 1 });
    const pendingUnlink = service.unlinkAccount();
    await rejection;
    await pendingUnlink;
    expect(state.accountCloudDecodeAbort).toBeNull();
    expect(store.restoreBackupData).not.toHaveBeenCalled();
    expect(getSettings()).toMatchObject({ accountUid: "", accountCloudSyncEnabled: false });
  });

  it("pins the restored generation as the new local sync base", async () => {
    const { service, store, getSettings } = harness();
    const cloudBackup = backup(baseSettings());
    const compressed = deflateRawSync(Buffer.from(JSON.stringify(cloudBackup), "utf8")).toString("base64");
    const manifest = manifestDocument({
      generationId: "generation-restored",
      payload: compressed,
      byteSize: Buffer.byteLength(compressed, "utf8")
    });
    replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET" && path.endsWith("/manifest/current")) return manifest;
      return {
        fields: {
          generation_id: stringValue("generation-restored"),
          index: integerValue(0),
          payload: stringValue(compressed),
          byte_size: integerValue(Buffer.byteLength(compressed, "utf8")),
          checksum: stringValue(checksum(compressed))
        }
      };
    });

    await service.restoreAccountCloudSync();

    expect(store.restoreBackupData).toHaveBeenCalledOnce();
    expect(getSettings()).toMatchObject({
      accountCloudSyncEnabled: true,
      accountCloudSyncLastSyncedAt: "2026-07-09T10:00:00.000Z",
      accountCloudSyncRemoteGenerationId: "generation-restored",
      accountCloudSyncLastError: ""
    });
    expect(getSettings().accountCloudSyncLastRestoredAt).not.toBe("");
  });

  it("restores legacy fixed chunks and disables raw replay upload in restored settings", async () => {
    const { service, store, getSettings } = harness();
    const cloudBackup = backup({
      ...baseSettings(),
      rawCapture: {
        ...baseSettings().rawCapture,
        apiKey: "secret-key",
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        tcgaWebReplayAutoUploadEnabled: true,
        tcgaWebReplayAutoUploadAccountUid: "account-1",
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
      tcgaWebReplayAutoUploadEnabled: false,
      tcgaWebReplayAutoUploadAccountUid: "",
      uploadEnabled: false,
      visibility: "private"
    });
    expect(getSettings().accountCloudSyncRemoteGenerationId).toMatch(/^legacy:[a-f0-9]{64}$/);
  });

  it("does not apply a decoded cloud backup after unlink starts", async () => {
    const { service, store, getSettings } = harness();
    const cloudBackup = backup(baseSettings());
    const compressed = deflateRawSync(Buffer.from(JSON.stringify(cloudBackup), "utf8")).toString("base64");
    const manifest = manifestDocument({
      generationId: "generation-checked",
      payload: compressed,
      byteSize: Buffer.byteLength(compressed, "utf8")
    });
    let resolveChunk!: (value: Record<string, unknown>) => void;
    const request = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET" && path.endsWith("/manifest/current")) return manifest;
      return new Promise<Record<string, unknown>>((resolve) => {
        resolveChunk = resolve;
      });
    });

    const pendingRestore = service.restoreAccountCloudSync();
    await vi.waitFor(() => expect(request.mock.calls.some(([path]) => path.includes("/chunks/"))).toBe(true));
    const pendingUnlink = service.unlinkAccount();
    resolveChunk({
      fields: {
        generation_id: stringValue("generation-checked"),
        index: integerValue(0),
        payload: stringValue(compressed),
        byte_size: integerValue(Buffer.byteLength(compressed, "utf8")),
        checksum: stringValue(checksum(compressed))
      }
    });

    await expect(pendingRestore).rejects.toThrow("account changed");
    await pendingUnlink;
    expect(store.restoreBackupData).not.toHaveBeenCalled();
    expect(getSettings()).toMatchObject({
      accountUid: "",
      firebaseRefreshToken: "",
      accountCloudSyncEnabled: false
    });
  });

  it("lists retained backup conflicts without exposing account UIDs", async () => {
    const { service } = harness();
    const conflictId = "a".repeat(64);
    const current = apiCloudManifest("current", { generationId: "current-generation" });
    const legacy = apiCloudManifest("legacy", { generationId: "legacy-generation" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(
      conflictApiPayload(conflictId, current, legacy)
    ), { status: 200 }));

    const conflicts = await service.getAccountCloudSyncConflicts();

    expect(conflicts).toEqual([expect.objectContaining({
      id: conflictId,
      status: "pending",
      current: expect.objectContaining({ deviceName: "Older Mac" }),
      legacy: expect.objectContaining({ deviceName: "Older Mac" })
    })]);
    expect(JSON.stringify(conflicts)).not.toContain("account-1");
    fetchMock.mockRestore();
  });

  it("propagates canonical-ownership validation errors from the retained backup API", async () => {
    const { service } = harness();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      error: "Reconnect this desktop to its canonical RiftLite account before recovering a retained backup."
    }), { status: 409 }));

    await expect(service.getAccountCloudSyncConflicts()).rejects.toThrow("Reconnect this desktop");
    fetchMock.mockRestore();
  });

  it("rejects a successful API response with an unvalidated conflict identity", async () => {
    const { service } = harness();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      conflicts: [{
        id: "not-a-conflict-id",
        status: "pending",
        currentFingerprint: "a".repeat(64),
        legacyFingerprint: "b".repeat(64),
        current: {},
        legacy: {}
      }]
    }), { status: 200 }));

    await expect(service.getAccountCloudSyncConflicts()).rejects.toThrow("invalid retained-backup identity");
    fetchMock.mockRestore();
  });

  it("keeps the current backup only after resolving the exact listed fingerprints", async () => {
    const { service, store } = harness();
    const conflictId = "b".repeat(64);
    const current = apiCloudManifest("current", { generationId: "current-generation" });
    const legacy = apiCloudManifest("legacy", { generationId: "legacy-generation" });
    const list = conflictApiPayload(conflictId, current, legacy);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(list), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        conflictId,
        status: "resolved",
        choice: "keep-current",
        resolvedAt: 1_753_000_000_000
      }), { status: 200 }));

    const result = await service.keepAccountCloudSyncConflictCurrent(conflictId);

    expect(result).toMatchObject({ conflictId, status: "resolved", choice: "keep-current" });
    const resolveCall = fetchMock.mock.calls[1];
    expect(resolveCall[1]?.method).toBe("POST");
    expect(JSON.parse(String(resolveCall[1]?.body))).toEqual({
      choice: "keep-current",
      legacyFingerprint: apiManifestFingerprint(legacy),
      currentFingerprint: apiManifestFingerprint(current)
    });
    expect(store.restoreBackupData).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("rejects a retained backup chunk whose proxy payload fails the manifest checksum", async () => {
    const { service, store } = harness();
    const conflictId = "c".repeat(64);
    const cloudBackup = backup(baseSettings());
    const compressed = deflateRawSync(Buffer.from(JSON.stringify(cloudBackup), "utf8")).toString("base64");
    const current = apiCloudManifest("current", {
      generationId: "current-generation",
      updateTime: "2026-07-17T12:00:00.123Z"
    });
    const legacy = apiCloudManifest(compressed, { generationId: "legacy-generation" });
    const list = conflictApiPayload(conflictId, current, legacy);
    const corrupted = `${compressed.slice(0, -1)}${compressed.endsWith("A") ? "B" : "A"}`;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/account/cloud-sync/conflicts")) {
        return new Response(JSON.stringify(list), { status: 200 });
      }
      if (url.endsWith(`/${conflictId}/manifest`)) {
        return new Response(JSON.stringify({
          ok: true,
          conflictId,
          legacyFingerprint: apiManifestFingerprint(legacy),
          manifest: legacy
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        ok: true,
        conflictId,
        legacyFingerprint: apiManifestFingerprint(legacy),
        index: 0,
        payload: corrupted,
        byteSize: Buffer.byteLength(corrupted, "utf8"),
        checksum: legacy.chunkChecksums[0]
      }), { status: 200 });
    });
    replaceFirestoreRequest(service, async () => apiManifestDocument(
      current,
      "2026-07-17T12:00:00.123456Z"
    ));

    await expect(service.restoreAccountCloudSyncConflictLegacy(conflictId)).rejects.toThrow("failed its checksum");
    expect(store.restoreBackupData).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("disables sync before remote recovery reads, confirms the cloud switch, then restores locally", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ accountCloudSyncEnabled: true });
    const conflictId = "d".repeat(64);
    const cloudBackup = backup(baseSettings());
    const compressed = deflateRawSync(Buffer.from(JSON.stringify(cloudBackup), "utf8")).toString("base64");
    const current = apiCloudManifest("current", {
      generationId: "current-generation",
      updateTime: "2026-07-17T12:00:00.123Z"
    });
    const legacy = apiCloudManifest(compressed, { generationId: "legacy-generation" });
    const list = conflictApiPayload(conflictId, current, legacy);
    const events: string[] = [];
    let currentDocument = apiManifestDocument(current, "2026-07-17T12:00:00.123456Z");
    const initialCurrentDocument = currentDocument;
    let stagedFields: Record<string, unknown> | undefined;
    const firestore = replaceFirestoreRequest(service, async (path, _token, options) => {
      if (options.method === "GET" && path.endsWith("/manifest/current")) {
        events.push(currentDocument === initialCurrentDocument ? "read-current" : "confirm-cloud");
        return currentDocument;
      }
      if (options.method === "PATCH" && path.includes("/chunks/")) {
        events.push("staged-chunk");
        stagedFields = options.body?.fields;
      }
      return {};
    });
    vi.mocked(store.restoreBackupData).mockImplementationOnce(async () => {
      events.push("local-restore");
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/account/cloud-sync/conflicts")) {
        expect(getSettings().accountCloudSyncEnabled).toBe(false);
        events.push("read-conflicts");
        return new Response(JSON.stringify(list), { status: 200 });
      }
      if (url.endsWith(`/${conflictId}/manifest`)) {
        return new Response(JSON.stringify({
          ok: true,
          conflictId,
          legacyFingerprint: apiManifestFingerprint(legacy),
          manifest: legacy
        }), { status: 200 });
      }
      if (url.includes(`/${conflictId}/chunks/0?`)) {
        return new Response(JSON.stringify({
          ok: true,
          conflictId,
          legacyFingerprint: apiManifestFingerprint(legacy),
          index: 0,
          payload: compressed,
          byteSize: Buffer.byteLength(compressed, "utf8"),
          checksum: checksum(compressed)
        }), { status: 200 });
      }
      if (url.endsWith(`/${conflictId}/resolve`)) {
        events.push("resolve");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const stagedApiManifest = body.stagedManifest as ApiCloudManifest;
        const generationField = stagedFields?.generation_id as { stringValue?: string } | undefined;
        expect(body).toMatchObject({
          choice: "restore-legacy",
          legacyFingerprint: apiManifestFingerprint(legacy),
          currentFingerprint: apiManifestFingerprint(current),
          stagedManifest: {
            format: "riftlite.account-cloud-sync",
            version: 2,
            generationId: generationField?.stringValue,
            chunkCount: 1,
            byteSize: Buffer.byteLength(compressed, "utf8"),
            checksum: checksum(compressed),
            chunkChecksums: [checksum(compressed)],
            counts: { matches: 0, decks: 0, notebooks: 0, replays: 0 }
          }
        });
        currentDocument = apiManifestDocument({
          ...stagedApiManifest,
          updateTime: "2026-07-18T12:00:00.123Z"
        }, "2026-07-18T12:00:00.123456Z");
        return new Response(JSON.stringify({
          ok: true,
          conflictId,
          status: "resolved",
          choice: "restore-legacy",
          resolvedAt: 1_753_000_000_001
        }), { status: 200 });
      }
      throw new Error(`Unexpected website request: ${url}`);
    });

    const result = await service.restoreAccountCloudSyncConflictLegacy(conflictId);

    expect(result).toMatchObject({ conflictId, status: "resolved", choice: "restore-legacy" });
    expect(store.restoreBackupData).toHaveBeenCalledWith(
      expect.any(Object),
      { preserveAccount: true, preserveReplays: true, fromAccountCloud: true }
    );
    expect(stagedFields).toMatchObject({
      payload: stringValue(compressed),
      recovery_conflict_id: stringValue(conflictId),
      recovery_source_fingerprint: stringValue(apiManifestFingerprint(legacy))
    });
    expect(events).toEqual([
      "read-conflicts",
      "read-current",
      "staged-chunk",
      "resolve",
      "confirm-cloud",
      "local-restore"
    ]);
    expect(firestore.mock.calls.some(([path, , options]) => options.method === "PATCH" && path.endsWith("/manifest/current"))).toBe(false);
    expect(firestore.mock.calls.some(([path, , options]) => options.method === "DELETE" && path.includes("current-generation"))).toBe(false);
    fetchMock.mockRestore();
  });

  it("reconciles a committed recovery when the resolution response is lost", async () => {
    const { service, store, getSettings } = harness();
    const conflictId = "f".repeat(64);
    const cloudBackup = backup(baseSettings());
    const compressed = deflateRawSync(Buffer.from(JSON.stringify(cloudBackup), "utf8")).toString("base64");
    const current = apiCloudManifest("current", { generationId: "current-generation" });
    const legacy = apiCloudManifest(compressed, { generationId: "legacy-generation" });
    const list = conflictApiPayload(conflictId, current, legacy);
    let currentDocument = apiManifestDocument(current);
    const firestore = replaceFirestoreRequest(service, async (_path, _token, options) => {
      if (options.method === "GET") return currentDocument;
      return {};
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/account/cloud-sync/conflicts")) {
        return new Response(JSON.stringify(list), { status: 200 });
      }
      if (url.endsWith(`/${conflictId}/manifest`)) {
        return new Response(JSON.stringify({
          ok: true,
          conflictId,
          legacyFingerprint: apiManifestFingerprint(legacy),
          manifest: legacy
        }), { status: 200 });
      }
      if (url.includes(`/${conflictId}/chunks/0?`)) {
        return new Response(JSON.stringify({
          ok: true,
          conflictId,
          legacyFingerprint: apiManifestFingerprint(legacy),
          index: 0,
          payload: compressed,
          byteSize: Buffer.byteLength(compressed, "utf8"),
          checksum: checksum(compressed)
        }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as { stagedManifest: ApiCloudManifest };
      currentDocument = apiManifestDocument({
        ...body.stagedManifest,
        updateTime: "2026-07-18T12:00:00.123Z"
      }, "2026-07-18T12:00:00.123456Z");
      throw new Error("socket closed after commit");
    });

    await expect(service.restoreAccountCloudSyncConflictLegacy(conflictId)).resolves.toMatchObject({
      conflictId,
      status: "resolved",
      choice: "restore-legacy"
    });
    expect(store.restoreBackupData).toHaveBeenCalledOnce();
    expect(getSettings()).toMatchObject({ accountCloudSyncEnabled: true, accountCloudSyncLastError: "" });
    expect(firestore.mock.calls.some(([, , options]) => options.method === "DELETE")).toBe(false);
    fetchMock.mockRestore();
  });

  it("preserves local and current cloud data when recovery is definitively rejected", async () => {
    const { service, store, getSettings } = harness();
    const conflictId = "1".repeat(64);
    const cloudBackup = backup(baseSettings());
    const compressed = deflateRawSync(Buffer.from(JSON.stringify(cloudBackup), "utf8")).toString("base64");
    const current = apiCloudManifest("current", { generationId: "current-generation" });
    const legacy = apiCloudManifest(compressed, { generationId: "legacy-generation" });
    const list = conflictApiPayload(conflictId, current, legacy);
    const currentDocument = apiManifestDocument(current);
    const firestore = replaceFirestoreRequest(service, async (_path, _token, options) => {
      if (options.method === "GET") return currentDocument;
      return {};
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/account/cloud-sync/conflicts")) {
        return new Response(JSON.stringify(list), { status: 200 });
      }
      if (url.endsWith(`/${conflictId}/manifest`)) {
        return new Response(JSON.stringify({
          ok: true,
          conflictId,
          legacyFingerprint: apiManifestFingerprint(legacy),
          manifest: legacy
        }), { status: 200 });
      }
      if (url.includes(`/${conflictId}/chunks/0?`)) {
        return new Response(JSON.stringify({
          ok: true,
          conflictId,
          legacyFingerprint: apiManifestFingerprint(legacy),
          index: 0,
          payload: compressed,
          byteSize: Buffer.byteLength(compressed, "utf8"),
          checksum: checksum(compressed)
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "The current backup changed before recovery." }), { status: 409 });
    });

    await expect(service.restoreAccountCloudSyncConflictLegacy(conflictId))
      .rejects.toThrow("current backup changed");
    expect(store.restoreBackupData).not.toHaveBeenCalled();
    expect(getSettings()).toMatchObject({
      accountCloudSyncEnabled: false,
      accountCloudSyncLastError: "The current backup changed before recovery."
    });
    expect(firestore.mock.calls.some(([path, , options]) => options.method === "PATCH" && path.endsWith("/manifest/current"))).toBe(false);
    expect(firestore.mock.calls.some(([path, , options]) => options.method === "DELETE" && path.includes("/chunks/"))).toBe(true);
    fetchMock.mockRestore();
  });

  it("limits retained-backup staging to eight concurrent chunk writes", async () => {
    const { service, getSettings } = harness();
    const chunks = Array.from({ length: 9 }, (_, index) => `chunk-${index}`);
    const joined = chunks.join("");
    const source = apiCloudManifest(joined, {
      chunkCount: chunks.length,
      byteSize: Buffer.byteLength(joined, "utf8"),
      checksum: checksum(joined),
      chunkChecksums: chunks.map(checksum)
    });
    let active = 0;
    let maximumActive = 0;
    let releaseWrites!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });
    const firestore = replaceFirestoreRequest(service, async (_path, _token, options) => {
      expect(options.method).toBe("PATCH");
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await writeGate;
      active -= 1;
      return {};
    });
    const stage = Reflect.get(service, "stageAccountCloudRecoveryGeneration") as (...args: unknown[]) => Promise<unknown>;

    const staging = Reflect.apply(stage, service, [
      getSettings(),
      { uid: "account-1", idToken: "token", refreshToken: "refresh", expiresAt: Date.now() },
      source,
      chunks,
      "2".repeat(64),
      apiManifestFingerprint(source)
    ]) as Promise<unknown>;
    await vi.waitFor(() => expect(active).toBe(8));
    expect(maximumActive).toBe(8);
    releaseWrites();
    await staging;
    expect(firestore).toHaveBeenCalledTimes(9);
    expect(maximumActive).toBe(8);
  });

  it("keeps the resolved cloud recovery intact and sync off when local restore fails", async () => {
    const { service, store, getSettings } = harness();
    const conflictId = "e".repeat(64);
    const cloudBackup = backup(baseSettings());
    const compressed = deflateRawSync(Buffer.from(JSON.stringify(cloudBackup), "utf8")).toString("base64");
    const current = apiCloudManifest("current", { generationId: "current-generation" });
    const legacy = apiCloudManifest(compressed, { generationId: "legacy-generation" });
    const list = conflictApiPayload(conflictId, current, legacy);
    let resolveAttempted = false;
    let currentDocument = apiManifestDocument(current);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/account/cloud-sync/conflicts")) {
        return new Response(JSON.stringify(list), { status: 200 });
      }
      if (url.endsWith(`/${conflictId}/manifest`)) {
        return new Response(JSON.stringify({
          ok: true,
          conflictId,
          legacyFingerprint: apiManifestFingerprint(legacy),
          manifest: legacy
        }), { status: 200 });
      }
      if (url.includes(`/${conflictId}/chunks/0?`)) {
        return new Response(JSON.stringify({
          ok: true,
          conflictId,
          legacyFingerprint: apiManifestFingerprint(legacy),
          index: 0,
          payload: compressed,
          byteSize: Buffer.byteLength(compressed, "utf8"),
          checksum: checksum(compressed)
        }), { status: 200 });
      }
      resolveAttempted = true;
      const body = JSON.parse(String(init?.body)) as { stagedManifest: ApiCloudManifest };
      currentDocument = apiManifestDocument({
        ...body.stagedManifest,
        updateTime: "2026-07-18T12:00:00.123Z"
      }, "2026-07-18T12:00:00.123456Z");
      return new Response(JSON.stringify({
        ok: true,
        conflictId,
        status: "resolved",
        choice: "restore-legacy",
        resolvedAt: 1_753_000_000_002
      }), { status: 200 });
    });
    vi.mocked(store.restoreBackupData).mockRejectedValueOnce(new Error("simulated local restore failure"));
    const firestore = replaceFirestoreRequest(service, async (_path, _token, options) => {
      if (options.method === "GET") return currentDocument;
      return {};
    });

    await expect(service.restoreAccountCloudSyncConflictLegacy(conflictId)).rejects.toThrow("simulated local restore failure");
    expect(store.restoreBackupData).toHaveBeenCalledOnce();
    expect(resolveAttempted).toBe(true);
    expect(firestore.mock.calls.some(([path, , options]) => options.method === "DELETE" && path.includes("/chunks/"))).toBe(false);
    expect(firestore.mock.calls.some(([path, , options]) => options.method === "DELETE" && path.includes("current-generation"))).toBe(false);
    expect(getSettings()).toMatchObject({
      accountCloudSyncEnabled: false,
      accountCloudSyncLastError: "simulated local restore failure"
    });
    fetchMock.mockRestore();
  });

  it("does not restore old credentials or disable local capture when token refresh races account unlink", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({
      firebaseUid: "account-1",
      firebaseRefreshToken: "refresh-old",
      accountCloudSyncLastSyncedAt: "2026-07-20T12:00:00.000Z",
      accountCloudSyncRemoteGenerationId: "generation-before-unlink",
      activeHubs: [{
        id: "private-hub-a",
        name: "Private Hub A",
        sync: true,
        role: "member"
      }],
      activeTeams: [{
        id: "private-team-a",
        slug: "private-team-a",
        name: "Private Team A",
        sync: true,
        role: "member",
        visibility: "private",
        joinedAt: "2026-07-01T00:00:00.000Z"
      }],
      privateHubWebReplayGrantKeys: ["private-hub-a|old-match|old-replay"],
      rawCapture: {
        ...baseSettings().rawCapture,
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        tcgaWebReplayAutoUploadEnabled: true,
        tcgaWebReplayAutoUploadAccountUid: "account-1"
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
      accountCloudSyncLastSyncedAt: "",
      accountCloudSyncRemoteGenerationId: "",
      activeHubs: [],
      activeTeams: [],
      privateHubWebReplayGrantKeys: [],
      rawCapture: {
        enabled: true,
        webReplayAutoUploadEnabled: false,
        webReplayAutoUploadAccountUid: "",
        tcgaWebReplayAutoUploadEnabled: false,
        tcgaWebReplayAutoUploadAccountUid: ""
      }
    });
  });

  it("does not apply a successful account verification after unlink", async () => {
    const { service, getSettings } = harness();
    let resolveVerification!: (value: Record<string, unknown>) => void;
    const authenticatedWebsiteRequest = vi.fn(() => new Promise<Record<string, unknown>>((resolve) => {
      resolveVerification = resolve;
    }));
    Object.assign(service, { authenticatedWebsiteRequest });

    const pendingVerification = service.getAccountConnectionStatus();
    await vi.waitFor(() => expect(authenticatedWebsiteRequest).toHaveBeenCalledOnce());
    await service.unlinkAccount();
    resolveVerification({
      connection: {
        verified: true,
        uid: "account-1",
        authenticatedUid: "account-1",
        identityUids: ["account-1"],
        email: "old@example.com",
        handle: "old-handle",
        checkedAt: "2026-07-21T12:00:00.000Z"
      }
    });

    await expect(pendingVerification).resolves.toMatchObject({ verified: false });
    expect(getSettings()).toMatchObject({
      accountUid: "",
      firebaseUid: "",
      firebaseRefreshToken: "",
      accountHandle: "",
      accountLastVerificationError: ""
    });
  });

  it("does not let a failed verification for account A poison account B", async () => {
    const { service, store, getSettings } = harness();
    let rejectVerification!: (error: Error) => void;
    const authenticatedWebsiteRequest = vi.fn(() => new Promise<Record<string, unknown>>((_resolve, reject) => {
      rejectVerification = reject;
    }));
    Object.assign(service, { authenticatedWebsiteRequest });

    const pendingVerification = service.getAccountConnectionStatus();
    await vi.waitFor(() => expect(authenticatedWebsiteRequest).toHaveBeenCalledOnce());
    service.invalidateLinkedAccountAuth();
    await store.saveSettings({
      accountUid: "account-2",
      firebaseUid: "account-2",
      firebaseRefreshToken: "refresh-account-2",
      accountHandle: "account-two",
      accountLastVerificationError: ""
    });
    rejectVerification(new Error("account A network failure"));

    await expect(pendingVerification).resolves.toMatchObject({ verified: false });
    expect(getSettings()).toMatchObject({
      accountUid: "account-2",
      firebaseUid: "account-2",
      firebaseRefreshToken: "refresh-account-2",
      accountHandle: "account-two",
      accountLastVerificationError: ""
    });
  });

  it("discards a generic token refresh that finishes after unlink", async () => {
    const { service, getSettings } = harness();
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
    Object.assign(service, { auth: null, refreshToken });

    const pendingStatus = service.getAccountCloudSyncStatus();
    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledOnce());
    await service.unlinkAccount();
    resolveRefresh({
      uid: "account-1",
      idToken: "stale-id-token",
      refreshToken: "stale-rotated-refresh",
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    });

    await expect(pendingStatus).rejects.toThrow("account changed");
    expect(getSettings()).toMatchObject({
      accountUid: "",
      firebaseUid: "",
      firebaseRefreshToken: ""
    });
    expect((service as unknown as { auth: unknown }).auth).toBeNull();
  });

  it("rejects an old browser-link completion after unlink", async () => {
    const { service, getSettings } = harness();
    let resolveStatus!: (value: Record<string, unknown>) => void;
    const authenticatedWebsiteRequest = vi.fn(() => new Promise<Record<string, unknown>>((resolve) => {
      resolveStatus = resolve;
    }));
    const signInWithCustomToken = vi.fn();
    Object.assign(service, { authenticatedWebsiteRequest, signInWithCustomToken });

    const pendingStatus = service.getAccountLinkStatus("old-link-session");
    await vi.waitFor(() => expect(authenticatedWebsiteRequest).toHaveBeenCalledOnce());
    await service.unlinkAccount();
    resolveStatus({
      status: "complete",
      customToken: "old-custom-token",
      uid: "account-1"
    });

    await expect(pendingStatus).rejects.toThrow("account changed");
    expect(signInWithCustomToken).not.toHaveBeenCalled();
    expect(getSettings()).toMatchObject({ accountUid: "", firebaseRefreshToken: "" });
  });

  it("uses freshly persisted credentials when a cold replay-token refresh rotates twice", async () => {
    const { service, getSettings } = harness();
    const refreshToken = vi.fn(async (token: string) => token === "refresh"
      ? {
          uid: "account-1",
          idToken: "first-id-token",
          refreshToken: "refresh-rotated-on-auth",
          expiresAt: Math.floor(Date.now() / 1000) + 3600
        }
      : {
          uid: "account-1",
          idToken: "replay-id-token",
          refreshToken: "refresh-rotated-for-replay",
          expiresAt: Math.floor(Date.now() / 1000) + 3600
        });
    Object.assign(service, { auth: null, refreshToken });

    await expect(service.refreshLinkedAccountIdToken()).resolves.toBe("replay-id-token");
    expect(refreshToken.mock.calls.map(([token]) => token)).toEqual([
      "refresh",
      "refresh-rotated-on-auth"
    ]);
    expect(getSettings().firebaseRefreshToken).toBe("refresh-rotated-on-auth");
  });

  it("refuses to mint a replay token after the caller's pinned account changes", async () => {
    const { service } = harness();
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(service.refreshLinkedAccountIdToken("different-account"))
      .rejects.toThrow("linked RiftLite account changed");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("replaces account hub memberships while retaining local presentation preferences for returned hubs", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({
      activeHubs: [{
        id: "hub-kept",
        name: "Old server name",
        sync: false,
        role: "member",
        passwordHash: "legacy-secret",
        imageDataUrl: "data:image/webp;base64,local-image",
        imageUpdatedAt: "2026-07-10T00:00:00.000Z"
      }, {
        id: "hub-removed",
        name: "Former membership",
        sync: true,
        role: "owner",
        claimed: true,
        imageDataUrl: "data:image/webp;base64,former-image"
      }]
    });
    const authenticatedWebsiteRequest = vi.fn(async () => ({
      hubs: [{
        id: "hub-kept",
        name: "Current server name",
        role: "admin",
        joinedAt: "2026-07-12T00:00:00.000Z"
      }, {
        id: "hub-new",
        name: "New membership",
        role: "member",
        joinedAt: "2026-07-13T00:00:00.000Z"
      }]
    }));
    Object.assign(service, { authenticatedWebsiteRequest });

    const next = await service.refreshAccountHubs();

    expect(authenticatedWebsiteRequest).toHaveBeenCalledWith("/api/hubs", { method: "GET" });
    expect(next.activeHubs.map((hub) => hub.id)).toEqual(["hub-kept", "hub-new"]);
    expect(next.activeHubs[0]).toMatchObject({
      id: "hub-kept",
      name: "Current server name",
      sync: false,
      role: "admin",
      joinedAt: "2026-07-12T00:00:00.000Z",
      imageDataUrl: "data:image/webp;base64,local-image",
      imageUpdatedAt: "2026-07-10T00:00:00.000Z"
    });
    expect(next.activeHubs[0]).not.toHaveProperty("passwordHash");
    expect(next.activeHubs[1]).toMatchObject({
      id: "hub-new",
      name: "New membership",
      sync: true,
      role: "member"
    });
    expect(getSettings().activeHubs).toEqual(next.activeHubs);
  });

  it("keeps a v0.8 unclaimed hub available for password claiming", async () => {
    const { service, store } = harness();
    await store.saveSettings({
      activeHubs: [{
        id: "legacy-hub",
        name: "Legacy Hub",
        sync: true,
        role: "member",
        claimed: false,
        joinedAt: "2026-06-01T00:00:00.000Z"
      }]
    });
    Object.assign(service, {
      authenticatedWebsiteRequest: vi.fn(async () => ({ hubs: [] }))
    });

    const next = await service.refreshAccountHubs();

    expect(next.activeHubs).toEqual([expect.objectContaining({
      id: "legacy-hub",
      name: "Legacy Hub"
    })]);
    expect(next.activeHubs[0].claimed).toBe(false);
  });

  it("does not apply a completed hub refresh after the linked account changes", async () => {
    const { service, store, getSettings } = harness();
    let resolveRequest!: (value: { hubs: Array<Record<string, unknown>> }) => void;
    const authenticatedWebsiteRequest = vi.fn(() => new Promise<{ hubs: Array<Record<string, unknown>> }>((resolve) => {
      resolveRequest = resolve;
    }));
    Object.assign(service, { authenticatedWebsiteRequest });

    const pendingRefresh = service.refreshAccountHubs();
    await vi.waitFor(() => expect(authenticatedWebsiteRequest).toHaveBeenCalledOnce());
    await store.saveSettings({
      accountUid: "account-2",
      firebaseUid: "account-2",
      firebaseRefreshToken: "refresh-account-2",
      activeHubs: [],
      activeTeams: []
    });
    resolveRequest({ hubs: [{ id: "account-1-private-hub", name: "Account 1 only", role: "member" }] });

    const next = await pendingRefresh;

    expect(next.accountUid).toBe("account-2");
    expect(next.activeHubs).toEqual([]);
    expect(getSettings().activeHubs).toEqual([]);
  });

  it("preserves legacy hubs and teams on the first recoverable account link", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({
      accountUid: "",
      firebaseUid: "",
      firebaseRefreshToken: "",
      accountCloudSyncEnabled: true,
      activeHubs: [{ id: "stale-hub", name: "Stale hub", sync: true }],
      activeTeams: [{
        id: "stale-team",
        slug: "stale-team",
        name: "Stale team",
        sync: true,
        role: "member",
        visibility: "private",
        joinedAt: "2026-07-01T00:00:00.000Z"
      }],
      privateHubWebReplayGrantKeys: ["old-hub|old-match|old-replay"]
    });
    Object.assign(service, {
      authenticatedWebsiteRequest: vi.fn(async () => ({
        status: "complete",
        customToken: "fresh-custom-token",
        uid: "fresh-account",
        email: "fresh@example.com",
        displayName: "Fresh player"
      })),
      signInWithCustomToken: vi.fn(async () => ({
        uid: "fresh-account",
        idToken: "fresh-id-token",
        refreshToken: "fresh-refresh-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      })),
      getAccountProfile: vi.fn(async () => null),
      getAccountConnectionStatus: vi.fn(async () => ({ verified: true }))
    });

    await expect(service.getAccountLinkStatus("link-session")).resolves.toMatchObject({
      status: "complete",
      uid: "fresh-account"
    });
    expect(getSettings()).toMatchObject({
      accountUid: "fresh-account",
      firebaseUid: "fresh-account",
      firebaseRefreshToken: "fresh-refresh-token",
      accountCloudSyncEnabled: false,
      activeHubs: [expect.objectContaining({ id: "stale-hub" })],
      activeTeams: [expect.objectContaining({ id: "stale-team" })],
      privateHubWebReplayGrantKeys: ["old-hub|old-match|old-replay"]
    });
  });

  it("adopts a server-proven anonymous account without clearing or disabling its local setup", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({
      accountUid: "anonymous-desktop",
      firebaseUid: "anonymous-desktop",
      firebaseRefreshToken: "anonymous-refresh-token",
      accountCloudSyncEnabled: true,
      activeHubs: [{ id: "legacy-hub", name: "Legacy hub", sync: true }],
      activeTeams: [{
        id: "legacy-team",
        slug: "legacy-team",
        name: "Legacy team",
        sync: true,
        role: "member",
        visibility: "private",
        joinedAt: "2026-07-01T00:00:00.000Z"
      }],
      privateHubWebReplayGrantKeys: ["legacy-hub|legacy-match|legacy-replay"],
      rawCapture: {
        ...getSettings().rawCapture,
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "anonymous-desktop",
        tcgaWebReplayAutoUploadEnabled: true,
        tcgaWebReplayAutoUploadAccountUid: "anonymous-desktop",
        webReplayDiscordShareEnabled: true,
        webReplayDiscordShareAccountUid: "anonymous-desktop",
        webReplayDiscordShareHubIds: ["legacy-hub"]
      }
    });
    Object.assign(service, {
      authenticatedWebsiteRequest: vi.fn(async () => ({
        status: "complete",
        customToken: "real-account-token",
        uid: "real-account",
        email: "real@example.com",
        displayName: "Real player",
        anonymousAdoptionSourceUid: "anonymous-desktop"
      })),
      signInWithCustomToken: vi.fn(async () => ({
        uid: "real-account",
        idToken: "real-id-token",
        refreshToken: "real-refresh-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      })),
      getAccountProfile: vi.fn(async () => null),
      getAccountConnectionStatus: vi.fn(async () => ({ verified: true }))
    });

    await expect(service.getAccountLinkStatus("link-session")).resolves.toMatchObject({
      status: "complete",
      uid: "real-account",
      adoptedAnonymousAccount: true
    });
    expect(getSettings()).toMatchObject({
      accountUid: "real-account",
      firebaseUid: "real-account",
      accountCloudSyncEnabled: false,
      activeHubs: [expect.objectContaining({ id: "legacy-hub" })],
      activeTeams: [expect.objectContaining({ id: "legacy-team" })],
      privateHubWebReplayGrantKeys: ["legacy-hub|legacy-match|legacy-replay"],
      rawCapture: {
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "real-account",
        tcgaWebReplayAutoUploadEnabled: true,
        tcgaWebReplayAutoUploadAccountUid: "real-account",
        webReplayDiscordShareEnabled: true,
        webReplayDiscordShareAccountUid: "real-account",
        webReplayDiscordShareHubIds: ["legacy-hub"]
      }
    });
  });

  it("does not preserve a different account from an unproven adoption response", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({
      accountUid: "old-account",
      firebaseUid: "old-account",
      accountHandle: "old-player",
      activeHubs: [{ id: "old-hub", name: "Old hub", sync: true }],
      activeTeams: [{
        id: "old-team",
        slug: "old-team",
        name: "Old team",
        sync: true,
        role: "member",
        visibility: "private",
        joinedAt: "2026-07-01T00:00:00.000Z"
      }]
    });
    Object.assign(service, {
      authenticatedWebsiteRequest: vi.fn(async () => ({
        status: "complete",
        customToken: "new-account-token",
        uid: "new-account",
        anonymousAdoptionSourceUid: "unrelated-anonymous-uid"
      })),
      signInWithCustomToken: vi.fn(async () => ({
        uid: "new-account",
        idToken: "new-id-token",
        refreshToken: "new-refresh-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      })),
      getAccountProfile: vi.fn(async () => null),
      getAccountConnectionStatus: vi.fn(async () => ({ verified: true }))
    });

    await expect(service.getAccountLinkStatus("link-session")).resolves.toMatchObject({
      adoptedAnonymousAccount: false
    });
    expect(getSettings()).toMatchObject({
      accountUid: "new-account",
      accountHandle: "",
      activeHubs: [],
      activeTeams: []
    });
  });

  it("clears private memberships on a genuine switch between two accounts", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({
      accountUid: "old-account",
      firebaseUid: "old-account",
      accountHandle: "old-player",
      accountDisplayName: "Old Player",
      accountProfilePublic: true,
      accountCloudSyncLastSyncedAt: "2026-07-20T12:00:00.000Z",
      accountCloudSyncLastRestoredAt: "2026-07-20T12:01:00.000Z",
      accountCloudSyncRemoteGenerationId: "old-account-generation",
      accountCloudSyncLastError: "old account error",
      activeHubs: [{ id: "old-hub", name: "Old hub", sync: true, claimed: true }],
      activeTeams: [{
        id: "old-team",
        slug: "old-team",
        name: "Old team",
        sync: true,
        role: "member",
        visibility: "private",
        joinedAt: "2026-07-01T00:00:00.000Z"
      }],
      privateHubWebReplayGrantKeys: ["old-hub|old-match|old-replay"]
    });
    Object.assign(service, {
      authenticatedWebsiteRequest: vi.fn(async () => ({
        status: "complete",
        customToken: "new-custom-token",
        uid: "new-account"
      })),
      signInWithCustomToken: vi.fn(async () => ({
        uid: "new-account",
        idToken: "new-id-token",
        refreshToken: "new-refresh-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      })),
      getAccountProfile: vi.fn(async () => {
        throw new Error("profile service temporarily unavailable");
      }),
      getAccountConnectionStatus: vi.fn(async () => ({ verified: true }))
    });

    await service.getAccountLinkStatus("link-session");

    expect(getSettings()).toMatchObject({
      accountUid: "new-account",
      accountHandle: "",
      accountDisplayName: "Player#newacc",
      accountProfilePublic: false,
      accountCloudSyncLastSyncedAt: "",
      accountCloudSyncLastRestoredAt: "",
      accountCloudSyncRemoteGenerationId: "",
      accountCloudSyncLastError: "",
      activeHubs: [],
      activeTeams: [],
      privateHubWebReplayGrantKeys: []
    });
  });

  it("preserves private data when credential repair promotes a proven alias UID", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({
      accountUid: "desktop-alias-1",
      firebaseUid: "desktop-alias-1",
      firebaseRefreshToken: "alias-refresh-token",
      accountCloudSyncEnabled: true,
      activeHubs: [{ id: "alias-hub", name: "Alias hub", sync: true }],
      activeTeams: [{
        id: "alias-team",
        slug: "alias-team",
        name: "Alias team",
        sync: true,
        role: "member",
        visibility: "private",
        joinedAt: "2026-07-01T00:00:00.000Z"
      }]
    });
    const authenticatedWebsiteRequest = vi.fn()
      .mockResolvedValueOnce({
        connection: {
          verified: false,
          uid: "account-1",
          authenticatedUid: "desktop-alias-1",
          identityUids: ["account-1", "desktop-alias-1"],
          credentialRepair: {
            required: true,
            targetUid: "account-1",
            customToken: "canonical-custom-token"
          }
        }
      })
      .mockResolvedValueOnce({
        connection: {
          verified: true,
          uid: "account-1",
          authenticatedUid: "account-1",
          identityUids: ["account-1", "desktop-alias-1"],
          profileComplete: true,
          replayLibraryReady: true,
          credentialRepair: { required: false }
        }
      });
    Object.assign(service, {
      authenticatedWebsiteRequest,
      auth: {
        uid: "desktop-alias-1",
        idToken: "alias-id-token",
        refreshToken: "alias-refresh-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      },
      signInWithCustomToken: vi.fn(async () => ({
        uid: "account-1",
        idToken: "canonical-id-token",
        refreshToken: "canonical-refresh-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      }))
    });

    await expect(service.repairAccountConnection()).resolves.toMatchObject({
      verified: true,
      uid: "account-1"
    });
    expect(authenticatedWebsiteRequest).toHaveBeenCalledTimes(2);
    expect(getSettings()).toMatchObject({
      accountUid: "account-1",
      firebaseUid: "account-1",
      firebaseRefreshToken: "canonical-refresh-token",
      accountCloudSyncEnabled: true,
      activeHubs: [expect.objectContaining({ id: "alias-hub" })],
      activeTeams: [expect.objectContaining({ id: "alias-team" })]
    });
  });

  it("sends the exact legacy password while rejecting whitespace-only input", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({
      activeHubs: [{ id: "legacy-hub", name: "Legacy Hub", sync: true, claimed: false }]
    });
    const authenticatedWebsiteRequest = vi.fn(async () => ({ ok: true }));
    Object.assign(service, {
      authenticatedWebsiteRequest,
      getAccountProfile: vi.fn(async () => null)
    });

    await service.claimHub("legacy-hub", "  intentional spaces  ");

    expect(authenticatedWebsiteRequest).toHaveBeenCalledWith("/api/hubs/claim", {
      method: "POST",
      body: expect.objectContaining({ password: "  intentional spaces  " })
    });
    expect(getSettings().activeHubs).toEqual([
      expect.objectContaining({ id: "legacy-hub", role: "owner", claimed: true })
    ]);
    await expect(service.claimHub("legacy-hub", "   ")).rejects.toThrow("Enter the hub password");
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

  it("upgrades a proven alias to canonical credentials before verification or cloud access", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ firebaseUid: "desktop-alias-1" });
    Object.assign(service, {
      auth: {
        uid: "desktop-alias-1",
        idToken: "alias-token",
        refreshToken: "refresh",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      },
      signInWithCustomToken: vi.fn(async (customToken: string) => {
        expect(customToken).toBe("canonical-custom-token");
        return {
          uid: "account-1",
          idToken: "canonical-id-token",
          refreshToken: "canonical-refresh-token",
          expiresAt: Math.floor(Date.now() / 1000) + 3600
        };
      })
    });
    const aliasConnection = {
      verified: false,
      uid: "account-1",
      authenticatedUid: "desktop-alias-1",
      identityUids: ["account-1", "desktop-alias-1"],
      profileComplete: true,
      replayLibraryReady: false,
      replayCount: 2,
      credentialRepair: {
        required: true,
        targetUid: "account-1"
      }
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ connection: aliasConnection }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        connection: {
          ...aliasConnection,
          credentialRepair: {
            ...aliasConnection.credentialRepair,
            customToken: "canonical-custom-token"
          }
        }
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        connection: {
          verified: true,
          uid: "account-1",
          authenticatedUid: "account-1",
          identityUids: ["account-1", "desktop-alias-1"],
          profileComplete: true,
          replayLibraryReady: true,
          replayCount: 2,
          checkedAt: "2026-07-17T12:30:00.000Z",
          credentialRepair: { required: false, targetUid: "account-1", customToken: "" }
        }
      }), { status: 200 }));
    const firestoreRequest = replaceFirestoreRequest(service, async (_path, idToken, options) => {
      expect(idToken).toBe("canonical-id-token");
      expect(options.method).toBe("GET");
      return manifestDocument();
    });

    const [connectionStatus, cloudStatus] = await Promise.all([
      service.getAccountConnectionStatus(),
      service.getAccountCloudSyncStatus()
    ]);
    expect(connectionStatus).toMatchObject({ verified: true, uid: "account-1" });
    expect(cloudStatus).toMatchObject({ hasRemoteBackup: true });
    expect(getSettings()).toMatchObject({
      accountUid: "account-1",
      firebaseUid: "account-1",
      firebaseRefreshToken: "canonical-refresh-token",
      accountLastVerifiedAt: "2026-07-17T12:30:00.000Z"
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "POST", "GET"]);
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain('"expectedUid":"account-1"');
    expect(firestoreRequest).toHaveBeenCalledOnce();
    fetchMock.mockRestore();
  });

  it("upgrades a saved alias before an ordinary direct sync write", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ firebaseUid: "desktop-alias-1" });
    const signInWithCustomToken = vi.fn(async () => ({
      uid: "account-1",
      idToken: "canonical-id-token",
      refreshToken: "canonical-refresh-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    }));
    Object.assign(service, {
      auth: {
        uid: "desktop-alias-1",
        idToken: "alias-id-token",
        refreshToken: "refresh",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      },
      signInWithCustomToken
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/account/connection") && init?.method === "POST") {
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer alias-id-token");
        return new Response(JSON.stringify({
          connection: {
            verified: false,
            uid: "account-1",
            authenticatedUid: "desktop-alias-1",
            identityUids: ["account-1", "desktop-alias-1"],
            credentialRepair: {
              required: true,
              targetUid: "account-1",
              customToken: "canonical-custom-token"
            }
          }
        }), { status: 200 });
      }
      if (url.endsWith("/api/account/connection")) {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer canonical-id-token");
        return new Response(JSON.stringify({
          connection: {
            verified: true,
            uid: "account-1",
            authenticatedUid: "account-1",
            identityUids: ["account-1", "desktop-alias-1"],
            profileComplete: true,
            replayLibraryReady: true,
            credentialRepair: { required: false }
          }
        }), { status: 200 });
      }
      expect(url).toContain("/api/community/aggregate/private-hub");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer canonical-id-token");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const firestoreRequest = replaceFirestoreRequest(service, async (path, idToken, options) => {
      expect(path).toBe("hubs/test-hub/matches/match-1");
      expect(idToken).toBe("canonical-id-token");
      expect(options.method).toBe("DELETE");
      return {};
    });

    await service.deleteHubMatch("test-hub", "match-1");

    expect(signInWithCustomToken).toHaveBeenCalledWith("canonical-custom-token");
    expect(firestoreRequest).toHaveBeenCalledOnce();
    expect(getSettings()).toMatchObject({
      accountUid: "account-1",
      firebaseUid: "account-1",
      firebaseRefreshToken: "canonical-refresh-token"
    });
    fetchMock.mockRestore();
  });

  it("repairs an alias before returning a replay-session ID token", async () => {
    const { service, store } = harness();
    await store.saveSettings({ firebaseUid: "desktop-alias-1" });
    const refreshToken = vi.fn(async (token: string) => {
      expect(token).toBe("canonical-refresh-token");
      return {
        uid: "account-1",
        idToken: "replay-canonical-id-token",
        refreshToken: "canonical-refresh-token-rotated",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      };
    });
    Object.assign(service, {
      auth: {
        uid: "desktop-alias-1",
        idToken: "alias-id-token",
        refreshToken: "refresh",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      },
      signInWithCustomToken: vi.fn(async () => ({
        uid: "account-1",
        idToken: "canonical-id-token",
        refreshToken: "canonical-refresh-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      })),
      refreshToken
    });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        connection: {
          verified: false,
          uid: "account-1",
          authenticatedUid: "desktop-alias-1",
          identityUids: ["account-1", "desktop-alias-1"],
          credentialRepair: {
            required: true,
            targetUid: "account-1",
            customToken: "canonical-custom-token"
          }
        }
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        connection: {
          verified: true,
          uid: "account-1",
          authenticatedUid: "account-1",
          identityUids: ["account-1", "desktop-alias-1"],
          profileComplete: true,
          replayLibraryReady: true,
          credentialRepair: { required: false }
        }
      }), { status: 200 }));

    await expect(service.refreshLinkedAccountIdToken()).resolves.toBe("replay-canonical-id-token");
    expect(refreshToken).toHaveBeenCalledOnce();
    fetchMock.mockRestore();
  });

  it("returns a pinned reconnect state when the saved refresh token is revoked", async () => {
    const { service, getSettings } = harness();
    Object.assign(service, {
      auth: null,
      refreshToken: vi.fn(async () => {
        throw new Error("revoked");
      })
    });

    await expect(service.getAccountConnectionStatus()).resolves.toMatchObject({
      connected: false,
      verified: false,
      uid: "account-1",
      message: expect.stringContaining("session expired")
    });
    expect(getSettings()).toMatchObject({
      accountUid: "account-1",
      firebaseRefreshToken: "refresh"
    });
  });

  it("does not misreport credential persistence failures as an expired session", async () => {
    const { service, store } = harness();
    const refreshToken = vi.fn(async () => ({
      uid: "account-1",
      idToken: "fresh-id-token",
      refreshToken: "fresh-refresh-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    }));
    Object.assign(service, { auth: null, refreshToken });
    vi.mocked(store.updateSettings).mockRejectedValueOnce(
      new Error("RuntimeError: memory access out of bounds")
    );

    await expect(service.getAccountCloudSyncStatus()).rejects.toThrow(
      "RuntimeError: memory access out of bounds"
    );
    expect(refreshToken).toHaveBeenCalledOnce();
  });

  it("does not verify or rewrite the pin when the website reports an unrelated UID", async () => {
    const { service, store, getSettings } = harness();
    await store.saveSettings({ firebaseUid: "unrelated-account" });
    Object.assign(service, {
      auth: {
        uid: "unrelated-account",
        idToken: "unrelated-token",
        refreshToken: "unrelated-refresh",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      }
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      connection: {
        verified: true,
        uid: "unrelated-account",
        authenticatedUid: "unrelated-account",
        identityUids: ["unrelated-account"],
        credentialRepair: { required: false }
      }
    }), { status: 200 }));

    await expect(service.getAccountConnectionStatus()).resolves.toMatchObject({
      connected: false,
      verified: false,
      uid: "account-1",
      message: expect.stringContaining("does not match")
    });
    expect(getSettings().accountUid).toBe("account-1");
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
