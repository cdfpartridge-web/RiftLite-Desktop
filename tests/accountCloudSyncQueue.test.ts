import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountCloudSyncQueue } from "../src/main/services/accountCloudSyncQueue.js";

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
});
