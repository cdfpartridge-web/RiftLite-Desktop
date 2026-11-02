import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountCloudSyncQueue } from "../src/main/services/accountCloudSyncQueue.js";
import { GameplayMaintenanceDeferredError, GameplayMaintenanceScheduler } from "../src/main/services/gameplayMaintenanceScheduler.js";

describe("AccountCloudSyncQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces mutations and uploads the most recent reason", async () => {
    const run = vi.fn(async () => undefined);
    const queue = new AccountCloudSyncQueue(run, vi.fn(), 20_000);

    queue.queue("Match saved");
    await vi.advanceTimersByTimeAsync(10_000);
    queue.queue("Deck renamed");
    await vi.advanceTimersByTimeAsync(19_999);
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("Deck renamed");
  });

  it("serializes uploads and retains one follow-up for changes made in flight", async () => {
    let finishFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const run = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(undefined);
    const queue = new AccountCloudSyncQueue(run, vi.fn(), 20_000);

    queue.queue("Match saved");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).toHaveBeenCalledTimes(1);

    queue.queue("Deck renamed");
    queue.queue("Deck package imported");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).toHaveBeenCalledTimes(1);

    finishFirst?.();
    await vi.runAllTimersAsync();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith("Deck package imported");
  });

  it("reports failures and still runs a queued follow-up", async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    const first = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const errorHandler = vi.fn(async () => undefined);
    const run = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(undefined);
    const queue = new AccountCloudSyncQueue(run, errorHandler, 20_000);

    queue.queue("Settings changed");
    await vi.advanceTimersByTimeAsync(20_000);
    queue.queue("Match deleted");
    await vi.advanceTimersByTimeAsync(20_000);
    rejectFirst?.(new Error("offline"));
    await vi.runAllTimersAsync();

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith("Match deleted");
  });

  it("discards stale pending work when suspended for a restore", async () => {
    const run = vi.fn(async () => undefined);
    const queue = new AccountCloudSyncQueue(run, vi.fn(), 20_000);

    queue.queue("Stale pre-restore mutation");
    const resume = queue.suspend({ discardPending: true });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(run).not.toHaveBeenCalled();

    resume();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(run).not.toHaveBeenCalled();
  });

  it("retains mutations queued while suspended and debounces them after resume", async () => {
    const run = vi.fn(async () => undefined);
    const queue = new AccountCloudSyncQueue(run, vi.fn(), 20_000);

    const resume = queue.suspend({ discardPending: true });
    queue.queue("Match restored");
    queue.queue("Settings restored");
    await vi.advanceTimersByTimeAsync(40_000);
    expect(run).not.toHaveBeenCalled();

    resume();
    await vi.advanceTimersByTimeAsync(19_999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("Settings restored");
  });

  it("supports nested suspension without resuming uploads too early", async () => {
    const run = vi.fn(async () => undefined);
    const queue = new AccountCloudSyncQueue(run, vi.fn(), 20_000);

    const resumeOuter = queue.suspend();
    const resumeInner = queue.suspend();
    queue.queue("Match changed");
    resumeOuter();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(run).not.toHaveBeenCalled();

    resumeInner();
    resumeInner();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("preserves pre-existing work when restore fence acquisition fails", async () => {
    const run = vi.fn(async () => undefined);
    const queue = new AccountCloudSyncQueue(run, vi.fn(), 20_000);

    queue.queue("Match saved before refused restore");
    const resume = queue.suspend();
    // The service fence refuses here, so discardPending is intentionally not
    // called and the old automatic sync must resume unchanged.
    resume();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("Match saved before refused restore");
  });

  it("discards pre-restore work only after acquisition and retains changes made during restore", async () => {
    const run = vi.fn(async () => undefined);
    const queue = new AccountCloudSyncQueue(run, vi.fn(), 20_000);

    queue.queue("Stale pre-restore mutation");
    const resume = queue.suspend();
    queue.discardPending();
    queue.queue("Mutation made during restore");
    resume();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("Mutation made during restore");
  });

  it("restores the captured pre-restore reason when the fenced restore fails", async () => {
    const run = vi.fn(async () => undefined);
    const queue = new AccountCloudSyncQueue(run, vi.fn(), 20_000);

    queue.queue("Match saved before failed restore");
    const resume = queue.suspend();
    const pendingReason = queue.takePendingReason();
    // The restore fence has now been released after an atomic replacement
    // failure, so the caller puts the pending intent back before resuming.
    queue.restorePendingReason(pendingReason);
    resume();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("Match saved before failed restore");
  });

  it("does not let a restored old reason overwrite a mutation made during restore", async () => {
    const run = vi.fn(async () => undefined);
    const queue = new AccountCloudSyncQueue(run, vi.fn(), 20_000);

    queue.queue("Stale pre-restore mutation");
    const resume = queue.suspend();
    const pendingReason = queue.takePendingReason();
    queue.queue("New mutation made during failed restore");
    queue.restorePendingReason(pendingReason);
    resume();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("New mutation made during failed restore");
  });

  it("keeps a debounced upload pending until the shared scheduler is idle", async () => {
    let ready = false;
    const run = vi.fn(async () => undefined);
    const scheduler = new GameplayMaintenanceScheduler({ ready: () => ready });
    const queue = new AccountCloudSyncQueue(run, vi.fn(), 20_000, () => scheduler.request("cloud"));
    scheduler.register("cloud", () => queue.flush());

    queue.queue("Match saved");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).not.toHaveBeenCalled();
    ready = true;
    await scheduler.wake();
    expect(run).toHaveBeenCalledExactlyOnceWith("Match saved");
    scheduler.dispose();
  });

  it("lets restore discard an already-dispatched upload without discarding new mutations", async () => {
    const run = vi.fn(async () => undefined);
    const dispatch = vi.fn();
    const queue = new AccountCloudSyncQueue(run, vi.fn(), 20_000, dispatch);
    queue.queue("Pre-restore mutation");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(dispatch).toHaveBeenCalledOnce();

    const resume = queue.suspend();
    expect(queue.takePendingReason()).toBe("Pre-restore mutation");
    queue.queue("Mutation during restore");
    await queue.flush();
    expect(run).not.toHaveBeenCalled();
    resume();
    await queue.flush();
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    await queue.flush();
    expect(run).toHaveBeenCalledExactlyOnceWith("Mutation during restore");
  });

  it("preserves already-dispatched intent when restore acquisition fails", async () => {
    const run = vi.fn(async () => undefined);
    const queue = new AccountCloudSyncQueue(run, vi.fn(), 20_000, vi.fn());
    queue.queue("Saved before refused restore");
    await vi.advanceTimersByTimeAsync(20_000);
    const resume = queue.suspend();
    await queue.flush();
    resume();
    await vi.advanceTimersByTimeAsync(20_000);
    await queue.flush();
    expect(run).toHaveBeenCalledExactlyOnceWith("Saved before refused restore");
  });

  it("retains gameplay-deferred intent and retries without reporting a backup failure", async () => {
    const onError = vi.fn();
    const run = vi.fn()
      .mockRejectedValueOnce(new GameplayMaintenanceDeferredError())
      .mockResolvedValueOnce(undefined);
    const dispatch = vi.fn();
    const queue = new AccountCloudSyncQueue(run, onError, 20_000, dispatch);
    queue.queue("Match saved");
    await vi.advanceTimersByTimeAsync(20_000);
    await queue.flush();
    expect(run).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    await queue.flush();
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    await queue.flush();
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith("Match saved");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("retains the newest mutation and routes deferred follow-up through the dispatcher", async () => {
    let rejectFirst!: (error: unknown) => void;
    const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
    const run = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const dispatch = vi.fn();
    const queue = new AccountCloudSyncQueue(run, onError, 20_000, dispatch);
    queue.queue("Old mutation");
    await vi.advanceTimersByTimeAsync(20_000);
    const pending = queue.flush();
    await Promise.resolve();
    queue.queue("New mutation");
    await vi.advanceTimersByTimeAsync(20_000);
    rejectFirst(new GameplayMaintenanceDeferredError());
    await pending;
    expect(run).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    await queue.flush();
    expect(run).toHaveBeenLastCalledWith("New mutation");
    expect(run).toHaveBeenCalledTimes(2);
  });
});
