import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GameplayMaintenanceDeferredError,
  GameplayMaintenanceScheduler,
  type GameplayMaintenanceContext,
} from "../src/main/services/gameplayMaintenanceScheduler.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("gameplay maintenance scheduler", () => {
  const schedulers: GameplayMaintenanceScheduler[] = [];
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    schedulers.splice(0).forEach((scheduler) => scheduler.dispose());
    vi.useRealTimers();
  });
  function harness() {
    let idle = true;
    const ready = vi.fn(() => idle);
    const onError = vi.fn();
    const scheduler = new GameplayMaintenanceScheduler({ ready, onError });
    schedulers.push(scheduler);
    return { scheduler, ready, onError, setIdle: (value: boolean) => { idle = value; } };
  }

  it("coalesces repeated requests while a game is active and runs after the cheap readiness poll", async () => {
    const h = harness();
    const job = vi.fn();
    h.scheduler.register("history", job);
    h.setIdle(false);
    for (let i = 0; i < 100; i++) h.scheduler.request("history");
    await h.scheduler.runReady();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(job).not.toHaveBeenCalled();
    expect(h.ready.mock.calls.length).toBeLessThan(10);
    h.setIdle(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(job).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rechecks gameplay when execution starts rather than trusting request-time readiness", async () => {
    const h = harness();
    const job = vi.fn();
    h.scheduler.register("history", job);
    h.scheduler.request("history");
    h.setIdle(false);
    await h.scheduler.runReady();
    expect(job).not.toHaveBeenCalled();
    h.setIdle(true);
    await h.scheduler.wake();
    expect(job).toHaveBeenCalledTimes(1);
  });

  it("runs one job globally and preserves one coalesced follow-up behind other pending jobs", async () => {
    const h = harness();
    const gate = deferred();
    const order: string[] = [];
    let first = true;
    h.scheduler.register("history", async () => {
      order.push("history:start");
      if (first) { first = false; await gate.promise; }
      order.push("history:end");
    });
    h.scheduler.register("upload", () => { order.push("upload"); });
    h.scheduler.request("history");
    await Promise.resolve();
    h.scheduler.request("upload");
    for (let i = 0; i < 30; i++) h.scheduler.request("history");
    const drain = h.scheduler.runReady();
    expect(order).toEqual(["history:start"]);
    expect(h.scheduler.wake()).toBe(drain);
    gate.resolve();
    await drain;
    expect(order).toEqual(["history:start", "history:end", "upload", "history:start", "history:end"]);
  });

  it("finishes an in-flight atomic commit, then defers before the next operation", async () => {
    const h = harness();
    const commit = deferred();
    const writes: string[] = [];
    let attempts = 0;
    h.scheduler.register("upload", async (context) => {
      attempts++;
      if (attempts === 1) { await commit.promise; writes.push("committed"); }
      context.checkpoint();
      writes.push("next-upload");
    });
    h.scheduler.request("upload");
    await Promise.resolve();
    h.setIdle(false);
    commit.resolve();
    await h.scheduler.runReady();
    expect(writes).toEqual(["committed"]);
    expect(h.onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(attempts).toBe(1);
    h.setIdle(true);
    await h.scheduler.wake();
    expect(writes).toEqual(["committed", "next-upload"]);
    expect(attempts).toBe(2);
  });

  it("backs off an explicit deferral even when readiness remains true", async () => {
    const h = harness();
    const job = vi.fn().mockRejectedValueOnce(new GameplayMaintenanceDeferredError()).mockResolvedValue(undefined);
    h.scheduler.register("history", job);
    h.scheduler.request("history");
    await h.scheduler.runReady();
    for (let i = 0; i < 20; i++) await h.scheduler.wake();
    expect(job).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(job).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(job).toHaveBeenCalledTimes(2);
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("reports an ordinary failure once and retries only after a new request", async () => {
    const h = harness();
    const error = new Error("offline");
    const job = vi.fn().mockRejectedValue(error);
    const other = vi.fn();
    h.scheduler.register("upload", job);
    h.scheduler.register("history", other);
    h.scheduler.request("upload");
    h.scheduler.request("history");
    await h.scheduler.runReady();
    expect(h.onError).toHaveBeenCalledExactlyOnceWith("upload", error);
    expect(other).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(job).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    h.scheduler.request("upload");
    await h.scheduler.runReady();
    expect(job).toHaveBeenCalledTimes(2);
  });

  it("retains a separately requested follow-up when the running job fails", async () => {
    const h = harness();
    const gate = deferred();
    const job = vi.fn().mockImplementationOnce(async () => {
      await gate.promise;
      throw new Error("offline");
    }).mockResolvedValue(undefined);
    h.scheduler.register("upload", job);
    h.scheduler.request("upload");
    await Promise.resolve();
    h.scheduler.request("upload");
    gate.resolve();
    await h.scheduler.runReady();
    expect(job).toHaveBeenCalledTimes(2);
    expect(h.onError).toHaveBeenCalledOnce();
  });

  it("reads the current account and consent when deferred work finally executes", async () => {
    const h = harness();
    let settings = { account: "old-account", consent: true };
    const uploads: string[] = [];
    h.scheduler.register("account-sync", () => {
      if (settings.consent) uploads.push(settings.account);
    });
    h.setIdle(false);
    h.scheduler.request("account-sync");
    await h.scheduler.runReady();
    settings = { account: "new-account", consent: false };
    h.setIdle(true);
    await h.scheduler.wake();
    expect(uploads).toEqual([]);
    settings = { account: "new-account", consent: true };
    h.scheduler.request("account-sync");
    await h.scheduler.runReady();
    expect(uploads).toEqual(["new-account"]);
  });

  it("disposes pending work without cancelling an in-flight commit or permitting its next step", async () => {
    const h = harness();
    const gate = deferred();
    let context!: GameplayMaintenanceContext;
    let committed = false;
    const nextJob = vi.fn();
    h.scheduler.register("upload", async (current) => {
      context = current;
      await gate.promise;
      committed = true;
      current.checkpoint();
      nextJob();
    });
    h.scheduler.register("history", nextJob);
    h.scheduler.request("upload");
    await Promise.resolve();
    h.scheduler.request("history");
    const drain = h.scheduler.runReady();
    h.scheduler.dispose();
    expect(context.canContinue()).toBe(false);
    expect(() => context.checkpoint()).toThrow(GameplayMaintenanceDeferredError);
    gate.resolve();
    await drain;
    expect(committed).toBe(true);
    expect(nextJob).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
    h.scheduler.request("history");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails closed on a throwing readiness check and can recover on a later wake", async () => {
    const h = harness();
    const job = vi.fn();
    h.scheduler.register("history", job);
    h.ready.mockImplementationOnce(() => { throw new Error("guest destroyed"); });
    h.scheduler.request("history");
    await h.scheduler.runReady();
    expect(job).not.toHaveBeenCalled();
    await h.scheduler.wake();
    expect(job).toHaveBeenCalledOnce();
  });

  it("bounds pending keys to registered jobs and keeps registration stable", () => {
    const h = harness();
    h.scheduler.register("history", vi.fn());
    expect(() => h.scheduler.request("unknown")).toThrow("not registered");
    expect(() => h.scheduler.register("history", vi.fn())).toThrow("already registered");
    expect(() => h.scheduler.register(" ", vi.fn())).toThrow("invalid");
  });

  it("continues other jobs even if error reporting itself fails", async () => {
    const h = harness();
    const other = vi.fn();
    h.onError.mockRejectedValue(new Error("diagnostic disk offline"));
    h.scheduler.register("upload", async () => { throw new Error("offline"); });
    h.scheduler.register("history", other);
    h.scheduler.request("upload");
    h.scheduler.request("history");
    await h.scheduler.runReady();
    expect(other).toHaveBeenCalledOnce();
    expect(h.onError).toHaveBeenCalledOnce();
  });
});
