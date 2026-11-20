import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountCloudSyncQueue } from "../src/main/services/accountCloudSyncQueue.js";
import { RiftLiteStore } from "../src/main/services/store.js";

vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));

describe("durable account sync edit revisions", () => {
  const uid = "linked-test-account";
  let directory: string;
  let store: RiftLiteStore;
  function reopen() {
    return new RiftLiteStore(join(directory, "review.sqlite"), join(directory, "unused-legacy.json"));
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "riftlite-sync-revision-"));
    store = reopen();
    await store.load();
    await store.saveSettings({ accountUid: uid, accountCloudSyncEnabled: true });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  });

  it("resumes the last deck edit after restart and keeps a newer edit made during its upload", async () => {
    const deck = await store.upsertSavedDeck({ title: "First", legend: "Diana", snapshotJson: "{}" });
    await store.acknowledgeAccountCloudRevision(uid, (await store.getPendingAccountCloudRevision(uid))!);
    await store.renameSavedDeck(deck.id, "Renamed before closing");
    const covered = await store.getPendingAccountCloudRevision(uid);
    expect(covered).toBeTruthy();
    store = reopen();
    await store.load();
    expect((await store.getSavedDeck(deck.id))?.title).toBe("Renamed before closing");
    expect(await store.getPendingAccountCloudRevision(uid)).toBe(covered);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const upload = vi.fn(async () => undefined);
    const queue = new AccountCloudSyncQueue(upload, vi.fn());
    await store.observeAccountCloudEdits(() => queue.queue("Local change"));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(upload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(upload).toHaveBeenCalledExactlyOnceWith("Local change");

    await store.saveSettings({ username: "Edited during upload" }, { recordCloudEdit: true });
    const newer = await store.getPendingAccountCloudRevision(uid);
    expect(newer).toBeTruthy();
    expect(newer).not.toBe(covered);
    await store.acknowledgeAccountCloudRevision(uid, covered!);
    expect(await store.getPendingAccountCloudRevision(uid)).toBe(newer);
    await store.acknowledgeAccountCloudRevision(uid, newer!);
    const clean = reopen();
    const wake = vi.fn();
    await clean.observeAccountCloudEdits(wake);
    expect(wake).not.toHaveBeenCalled();
    queue.discardPending();
  });

  it("discards replaced data only on a committed cloud restore and schedules a local import", async () => {
    const deck = await store.upsertSavedDeck({ title: "Deck", legend: "Diana", snapshotJson: "{}" });
    const backup = await store.exportBackupData({ includeReplays: false });
    const before = await store.getPendingAccountCloudRevision(uid);
    const remote = { preserveAccount: true, preserveReplays: true, fromAccountCloud: true };
    const invalid = { ...backup, decks: [null as unknown as typeof deck] };
    await expect(store.restoreBackupData(invalid, remote)).rejects.toThrow();
    expect(await store.getPendingAccountCloudRevision(uid)).toBe(before);
    await store.restoreBackupData(backup, remote);
    expect(await store.getPendingAccountCloudRevision(uid)).toBeNull();
    await store.restoreBackupData(backup);
    const local = await store.getPendingAccountCloudRevision(uid);
    expect(local).toBeTruthy();
    expect(local).not.toBe(before);
  });

  it("retires old-account and disabled intents without queuing on sign-in or sync bookkeeping", async () => {
    await store.saveSettings({ username: "Player" }, { recordCloudEdit: true });
    expect(await store.getPendingAccountCloudRevision(uid)).toBeTruthy();
    await store.saveSettings({ accountUid: "other-account" });
    expect(await store.getPendingAccountCloudRevision(uid)).toBeNull();
    expect(await store.getPendingAccountCloudRevision("other-account")).toBeNull();
    await store.updateSettings(() => ({ accountCloudSyncLastError: "Offline" }));
    expect(await store.getPendingAccountCloudRevision("other-account")).toBeNull();
    await store.upsertSavedDeck({ title: "Other", legend: "Diana", snapshotJson: "{}" });
    expect(await store.getPendingAccountCloudRevision("other-account")).toBeTruthy();
    await store.saveSettings({ accountCloudSyncEnabled: false });
    await store.saveSettings({ username: "Local only" }, { recordCloudEdit: true });
    const wake = vi.fn();
    await reopen().observeAccountCloudEdits(wake);
    expect(wake).not.toHaveBeenCalled();
    expect(await store.getPendingAccountCloudRevision("other-account")).toBeNull();
  });
});
