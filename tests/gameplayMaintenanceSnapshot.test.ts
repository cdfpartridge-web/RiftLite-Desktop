import { afterEach, describe, expect, it, vi } from "vitest";
import { GameplayMaintenanceScheduler } from "../src/main/services/gameplayMaintenanceScheduler.js";
import { GameplayMaintenanceSnapshot } from "../src/main/services/gameplayMaintenanceSnapshot.js";

describe("automatic maintenance snapshots", () => {
  const schedulers: GameplayMaintenanceScheduler[] = [];
  afterEach(() => { schedulers.splice(0).forEach((scheduler) => scheduler.dispose()); });
  function harness() {
    let idle = true;
    let settings = { account: "a" };
    const scheduler = new GameplayMaintenanceScheduler({ ready: () => idle });
    schedulers.push(scheduler);
    const read = vi.fn(async () => settings.account);
    const snapshot = new GameplayMaintenanceSnapshot(scheduler, "diagnostics", async () => settings, read);
    return { scheduler, snapshot, read, busy: () => { idle = false; }, idle: () => { idle = true; },
      account: (account: string) => { settings = { account }; } };
  }
  it("coalesces busy-game polling without disk reads, then refreshes once idle", async () => {
    const h = harness(); h.busy();
    expect(await Promise.all(Array.from({ length: 20 }, () => h.snapshot.get(true)))).toEqual(Array(20).fill(null));
    expect(h.read).not.toHaveBeenCalled();
    h.idle(); await h.scheduler.wake();
    expect(h.read).toHaveBeenCalledTimes(1);
    h.busy(); expect(await h.snapshot.get(true)).toBe("a");
    expect(h.read).toHaveBeenCalledTimes(1);
  });
  it("never serves a previous account's cache after settings identity changes", async () => {
    const h = harness(); expect(await h.snapshot.get()).toBe("a");
    h.busy(); h.account("b");
    expect(await h.snapshot.get(true)).toBeNull();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(await h.snapshot.get()).toBe("b");
  });
  it.each([false, true])("discards an asynchronous result crossing an account change (automatic=%s)", async (automatic) => {
    const h = harness();
    let release!: (value: string) => void;
    h.read.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }));
    const result = h.snapshot.get(automatic);
    await vi.waitFor(() => expect(h.read).toHaveBeenCalledOnce());
    h.account("b"); release("a");
    expect(await result).toBeNull();
    h.busy(); expect(await h.snapshot.get(true)).toBeNull();
  });
  it("manual refresh bypasses gameplay deferral and the settled cache", async () => {
    const h = harness(); h.busy();
    expect(await h.snapshot.get()).toBe("a");
    h.read.mockResolvedValueOnce("updated");
    expect(await h.snapshot.get()).toBe("updated");
    expect(h.read).toHaveBeenCalledTimes(2);
  });
  it("an older automatic read cannot overwrite a newer manual cache", async () => {
    const h = harness();
    let release!: (value: string) => void;
    h.read.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }));
    const automatic = h.snapshot.get(true);
    await vi.waitFor(() => expect(h.read).toHaveBeenCalledOnce());
    h.read.mockResolvedValueOnce("newer");
    expect(await h.snapshot.get()).toBe("newer");
    release("older"); await automatic;
    h.busy(); expect(await h.snapshot.get(true)).toBe("newer");
  });
});
