import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getVersion: () => "0.9.88-test" } }));

import { AccountCloudSyncQueue } from "../src/main/services/accountCloudSyncQueue.js";
import { runAccountCloudRestore } from "../src/main/services/accountCloudRestoreCoordinator.js";
import { FirebaseSyncService } from "../src/main/services/firebaseSync.js";
import { GameplayMaintenanceDeferredError, GameplayMaintenanceScheduler } from "../src/main/services/gameplayMaintenanceScheduler.js";
import type { RiftLiteStore } from "../src/main/services/store.js";
import type { RiftLiteBackupFile, UserSettings } from "../src/shared/types.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  let busy = false;
  let held = false;
  let settings = {
    accountUid: "integration-account", firebaseUid: "integration-account", firebaseRefreshToken: "refresh",
    accountDisplayName: "Original", accountCloudSyncEnabled: true,
    accountCloudSyncDeviceId: "integration-device", accountCloudSyncDeviceName: "Test device",
    accountCloudSyncRemoteGenerationId: "", accountCloudSyncLastSyncedAt: "", accountCloudSyncLastError: "",
    rawCapture: { enabled: false, visibility: "private" },
  } as UserSettings;
  let manifest: Record<string, unknown> | null = null;
  const events: string[] = [];
  const hooks: {
    readSettings?: () => Promise<void>; readManifest?: () => Promise<void>;
    writeChunk?: () => Promise<void>; export?: () => Promise<void>;
  } = {};
  const store = {
    getSettings: vi.fn(async () => { await hooks.readSettings?.(); return settings; }),
    saveSettings: vi.fn(async (patch: Partial<UserSettings>) => (settings = { ...settings, ...patch })),
    updateSettings: vi.fn(async (mutation: (current: Readonly<UserSettings>) => Partial<UserSettings>) => (
      settings = { ...settings, ...mutation(settings) }
    )),
    exportBackupData: vi.fn(async (): Promise<RiftLiteBackupFile> => {
      await hooks.export?.();
      events.push(`export:${settings.accountDisplayName}`);
      return {
        format: "riftlite.backup", version: 1, exportedAt: new Date().toISOString(), appVersion: "0.9.88-test",
        settings, matches: [], deletedMatches: [], decks: [], notebooks: [], replays: [], deletedReplays: [],
      };
    }),
  } as unknown as RiftLiteStore;
  const service = new FirebaseSyncService(store, () => null);
  const request = vi.fn(async (path: string, _token: string, options: {
    method: string; body?: { fields?: Record<string, unknown> };
  }) => {
    if (options.method === "GET") {
      await hooks.readManifest?.();
      if (!manifest) throw new Error("Firestore 404");
      return manifest;
    }
    if (options.method === "PATCH" && path.includes("/chunks/")) {
      events.push("chunk-start");
      await hooks.writeChunk?.();
      events.push("chunk-finish");
    }
    if (options.method === "PATCH" && path.endsWith("/manifest/current")) {
      events.push("manifest-commit");
      manifest = { fields: options.body?.fields ?? {}, updateTime: `version-${events.length}` };
    }
    return {};
  });
  Object.assign(service, {
    auth: {
      uid: settings.accountUid, idToken: "token", refreshToken: "refresh",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
    firestoreRequest: request,
  });
  const ready = () => !busy && !held;
  const checkpoint = () => { if (!ready()) throw new GameplayMaintenanceDeferredError(); };
  const errors = vi.fn();
  const scheduler = new GameplayMaintenanceScheduler({ ready, onError: errors });
  const run = vi.fn(async (reason: string) => {
    checkpoint();
    const current = await store.getSettings();
    checkpoint();
    if (!current.accountUid || !current.accountCloudSyncEnabled) return;
    await service.uploadAccountCloudSync(reason, { automatic: true, checkpoint });
  });
  const queue = new AccountCloudSyncQueue(run, errors, 20_000, () => scheduler.request("cloud"));
  scheduler.register("cloud", () => queue.flush());
  const prepareRestore = vi.fn();
  const finishRestore = vi.fn();
  const invalidateDeckLibrary = vi.fn();

  // Compose the public queue/service/scheduler contracts in the same order as
  // a restore caller. No Electron app boot, disk store, auth request or profile.
  const restore = async (replace: () => Promise<void>) => {
    const resume = queue.suspend();
    held = true;
    let discarded = "";
    let succeeded = false;
    try {
      await service.runWithAccountCloudRestoreFence(async () => {
        await scheduler.wake();
        discarded = queue.takePendingReason();
        await runAccountCloudRestore(replace, {
          prepareForRestore: prepareRestore, invalidateDeckLibrary, finishRestore,
        });
      });
      succeeded = true;
    } finally {
      if (!succeeded && discarded) queue.restorePendingReason(discarded);
      held = false;
      resume();
    }
  };
  return {
    scheduler, queue, service, store, run, request, errors, events, hooks, restore,
    prepareRestore, finishRestore, invalidateDeckLibrary,
    setBusy: (value: boolean) => { busy = value; },
    commits: () => events.filter((event) => event === "manifest-commit").length,
    getSettings: () => settings,
  };
}

describe("automatic maintenance component integration", () => {
  const schedulers: GameplayMaintenanceScheduler[] = [];
  const setup = () => {
    const result = harness();
    schedulers.push(result.scheduler);
    return result;
  };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    schedulers.splice(0).forEach((scheduler) => scheduler.dispose());
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("coalesces busy-game mutations into one upload using the latest intent and current data", async () => {
    const h = setup();
    h.setBusy(true);
    h.queue.queue("First match saved");
    await vi.advanceTimersByTimeAsync(20_000);
    h.queue.queue("Latest deck edited");
    await h.store.saveSettings({ accountDisplayName: "Latest" });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(h.run).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();

    h.setBusy(false);
    await h.scheduler.wake();

    expect(h.run).toHaveBeenCalledExactlyOnceWith("Latest deck edited");
    expect(h.events).toContain("export:Latest");
    expect(h.commits()).toBe(1);
    expect(h.errors).not.toHaveBeenCalled();
  });

  it("finishes a started cloud publication while deferring the next upload and other automatic jobs", async () => {
    const h = setup();
    const started = deferred();
    const release = deferred();
    h.hooks.writeChunk = async () => { started.resolve(); await release.promise; };
    const history = vi.fn(async () => { h.events.push("history"); });
    h.scheduler.register("history", history);
    h.queue.queue("First save");
    await vi.advanceTimersByTimeAsync(20_000);
    await started.promise;

    h.setBusy(true);
    h.queue.queue("Second save");
    h.scheduler.request("history");
    await vi.advanceTimersByTimeAsync(20_000);
    release.resolve();
    await h.scheduler.wake();

    expect(h.commits()).toBe(1);
    expect(h.run).toHaveBeenCalledOnce();
    expect(history).not.toHaveBeenCalled();
    h.setBusy(false);
    await h.scheduler.wake();
    expect(h.commits()).toBe(2);
    expect(h.run).toHaveBeenLastCalledWith("Second save");
    expect(history).toHaveBeenCalledOnce();
    expect(h.events.indexOf("history")).toBeGreaterThan(h.events.indexOf("manifest-commit"));
    expect(h.errors).not.toHaveBeenCalled();
  });

  it("refuses restore immediately while an atomic upload could replace its selected generation", async () => {
    const h = setup();
    const started = deferred();
    const release = deferred();
    h.hooks.writeChunk = async () => { started.resolve(); await release.promise; };
    h.queue.queue("Saved before restore");
    await vi.advanceTimersByTimeAsync(20_000);
    await started.promise;
    const replace = vi.fn(async () => undefined);

    await expect(h.restore(replace)).rejects.toThrow("currently uploading");

    expect(h.commits()).toBe(0);
    expect(replace).not.toHaveBeenCalled();
    expect(h.prepareRestore).not.toHaveBeenCalled();
    release.resolve();
    await h.scheduler.wake();
    expect(h.commits()).toBe(1);
    expect(h.errors).not.toHaveBeenCalled();
  });

  it("retains gameplay-deferred intent when a later fenced restore fails", async () => {
    const h = setup();
    h.hooks.export = async () => { h.setBusy(true); delete h.hooks.export; };
    h.queue.queue("Saved before gameplay resumed");
    await vi.advanceTimersByTimeAsync(20_000);
    await h.scheduler.wake();
    expect(h.commits()).toBe(0);
    expect(h.errors).not.toHaveBeenCalled();
    h.setBusy(false);

    await expect(h.restore(async () => { throw new Error("atomic replacement failed"); }))
      .rejects.toThrow("atomic replacement failed");
    expect(h.invalidateDeckLibrary).not.toHaveBeenCalled();
    expect(h.finishRestore).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    await h.scheduler.wake();

    expect(h.commits()).toBe(1);
    expect(h.run).toHaveBeenCalledTimes(2);
    expect(h.run).toHaveBeenLastCalledWith("Saved before gameplay resumed");
    expect(h.errors).not.toHaveBeenCalled();
  });

  it("discards pre-restore deferred intent after successful replacement and accepts a later new mutation", async () => {
    const h = setup();
    h.hooks.export = async () => { h.setBusy(true); delete h.hooks.export; };
    h.queue.queue("Old local data");
    await vi.advanceTimersByTimeAsync(20_000);
    await h.scheduler.wake();
    h.setBusy(false);

    await h.restore(async () => { await h.store.saveSettings({ accountDisplayName: "Restored" }); });
    await vi.advanceTimersByTimeAsync(60_000);
    await h.scheduler.wake();
    expect(h.commits()).toBe(0);
    expect(h.run).toHaveBeenCalledOnce();
    expect(h.invalidateDeckLibrary).toHaveBeenCalledOnce();

    h.queue.queue("New mutation after restore");
    await vi.advanceTimersByTimeAsync(20_000);
    await h.scheduler.wake();
    expect(h.commits()).toBe(1);
    expect(h.run).toHaveBeenLastCalledWith("New mutation after restore");
    expect(h.events).toContain("export:Restored");
    expect(h.errors).not.toHaveBeenCalled();
  });

  it("holds the service restore fence while draining a different already-started maintenance unit", async () => {
    const h = setup();
    const started = deferred();
    const release = deferred();
    h.scheduler.register("history", async () => { started.resolve(); await release.promise; });
    h.scheduler.request("history");
    await started.promise;
    const replace = vi.fn(async () => undefined);
    const restoring = h.restore(replace);
    // The service establishes restore intent synchronously before waiting on
    // the scheduler, so even an explicit upload must now respect that fence.
    await expect(h.service.uploadAccountCloudSync("Sync now")).rejects.toThrow("being restored");
    expect(replace).not.toHaveBeenCalled();
    release.resolve();
    await restoring;
    expect(replace).toHaveBeenCalledOnce();
    expect(h.prepareRestore).toHaveBeenCalledOnce();
    expect(h.finishRestore).toHaveBeenCalledOnce();
    expect(h.errors).not.toHaveBeenCalled();
  });

  it("defers a queued cloud callback still reading settings before service admission and retains it after failed restore", async () => {
    const h = setup();
    const settingsReadStarted = deferred();
    const releaseSettings = deferred();
    h.hooks.readSettings = async () => {
      delete h.hooks.readSettings;
      settingsReadStarted.resolve();
      await releaseSettings.promise;
    };
    h.queue.queue("Saved before pending settings read");
    await vi.advanceTimersByTimeAsync(20_000);
    await settingsReadStarted.promise;
    const replace = vi.fn(async () => { throw new Error("restore replacement failed"); });
    const restoring = h.restore(replace);
    // No cloud service call has started, so restore can acquire its fence. The
    // preflight callback must observe the hold after its settings read resumes.
    await expect(h.service.uploadAccountCloudSync("Sync now")).rejects.toThrow("being restored");
    const failedRestore = expect(restoring).rejects.toThrow("restore replacement failed");
    releaseSettings.resolve();
    await failedRestore;

    expect(replace).toHaveBeenCalledOnce();
    expect(h.request).not.toHaveBeenCalled();
    expect(h.errors).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    await h.scheduler.wake();
    expect(h.commits()).toBe(1);
    expect(h.run).toHaveBeenCalledTimes(2);
    expect(h.run).toHaveBeenLastCalledWith("Saved before pending settings read");
  });
});
