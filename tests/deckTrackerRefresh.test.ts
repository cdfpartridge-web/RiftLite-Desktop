import { describe, expect, it, vi } from "vitest";
import { DeckTrackerRefreshCoordinator } from "../src/renderer/deckTrackerRefresh";
import type { DeckTrackerState, VisionDeckTrackerStatus } from "../src/shared/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  let enabled = false;
  const state = { updatedAt: "current" } as DeckTrackerState;
  const status = { state: "paused" } as VisionDeckTrackerStatus;
  const dependencies = {
    isEnabled: () => enabled,
    loadState: vi.fn(async () => state),
    loadVisionStatus: vi.fn(async () => status),
    apply: vi.fn(), clear: vi.fn()
  };
  return { dependencies, state, status, coordinator: new DeckTrackerRefreshCoordinator(dependencies), enable: (value: boolean) => { enabled = value; } };
}

describe("deck tracker renderer refresh", () => {
  it("does no IPC for disabled capture events and clears previous display state", async () => {
    const f = fixture();
    await Promise.all(Array.from({ length: 50 }, () => f.coordinator.refresh()));
    expect(f.dependencies.loadState).not.toHaveBeenCalled();
    expect(f.dependencies.loadVisionStatus).not.toHaveBeenCalled();
    expect(f.dependencies.apply).not.toHaveBeenCalled();
    expect(f.dependencies.clear).toHaveBeenCalled();
  });

  it("keeps enabled refreshes working across an off/on transition", async () => {
    const f = fixture();
    f.enable(true);
    await f.coordinator.refresh();
    expect(f.dependencies.apply).toHaveBeenLastCalledWith(f.state, f.status);
    f.enable(false);
    await f.coordinator.refresh();
    expect(f.dependencies.clear).toHaveBeenCalledTimes(1);
    f.enable(true);
    await f.coordinator.refresh();
    expect(f.dependencies.loadState).toHaveBeenCalledTimes(2);
    expect(f.dependencies.loadVisionStatus).toHaveBeenCalledTimes(2);
    expect(f.dependencies.apply).toHaveBeenCalledTimes(2);
  });

  it("ignores a read that finishes after disabling, even when re-enabled before it returns", async () => {
    const f = fixture();
    const old = deferred<DeckTrackerState>();
    f.dependencies.loadState.mockReturnValueOnce(old.promise);
    f.enable(true);
    const stale = f.coordinator.refresh();
    f.enable(false);
    await f.coordinator.refresh();
    f.enable(true);
    await f.coordinator.refresh();
    old.resolve({ updatedAt: "obsolete" } as DeckTrackerState);
    await stale;
    expect(f.dependencies.apply).toHaveBeenCalledTimes(1);
    expect(f.dependencies.apply).toHaveBeenLastCalledWith(f.state, f.status);
  });

  it("coalesces slow enabled reads so repeated polling cannot starve their result", async () => {
    const f = fixture();
    f.enable(true);
    const old = deferred<DeckTrackerState>();
    f.dependencies.loadState.mockReturnValueOnce(old.promise);
    const pending = f.coordinator.refresh();
    const repeated = Array.from({ length: 20 }, () => f.coordinator.refresh());
    expect(repeated.every((request) => request === pending)).toBe(true);
    expect(f.dependencies.loadState).toHaveBeenCalledTimes(1);
    old.resolve(f.state);
    await pending;
    expect(f.dependencies.apply).toHaveBeenCalledTimes(1);
    await f.coordinator.refresh();
    expect(f.dependencies.apply).toHaveBeenCalledTimes(2);
  });

  it("does not apply after teardown", async () => {
    const f = fixture();
    f.enable(true);
    const closing = deferred<DeckTrackerState>();
    f.dependencies.loadState.mockReturnValueOnce(closing.promise);
    const closePending = f.coordinator.refresh();
    f.coordinator.invalidate();
    closing.resolve(f.state);
    await closePending;
    expect(f.dependencies.apply).not.toHaveBeenCalled();
  });

  it("retires a changed deck/view read without clearing the newer pending request", async () => {
    const f = fixture();
    f.enable(true);
    const old = deferred<DeckTrackerState>();
    const current = deferred<DeckTrackerState>();
    f.dependencies.loadState.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const oldRequest = f.coordinator.refresh();
    f.coordinator.invalidate();
    const currentRequest = f.coordinator.refresh();
    old.resolve({ updatedAt: "previous deck" } as DeckTrackerState);
    await oldRequest;
    expect(f.coordinator.refresh()).toBe(currentRequest);
    expect(f.dependencies.apply).not.toHaveBeenCalled();
    current.resolve(f.state);
    await currentRequest;
    expect(f.dependencies.apply).toHaveBeenLastCalledWith(f.state, f.status);
    expect(f.dependencies.loadState).toHaveBeenCalledTimes(2);
  });

  it("preserves the existing state when its read fails and still accepts a state without vision status", async () => {
    const f = fixture();
    f.enable(true);
    f.dependencies.loadState.mockRejectedValueOnce(new Error("offline"));
    await f.coordinator.refresh();
    expect(f.dependencies.apply).not.toHaveBeenCalled();
    f.dependencies.loadVisionStatus.mockRejectedValueOnce(new Error("offline"));
    await f.coordinator.refresh();
    expect(f.dependencies.apply).toHaveBeenLastCalledWith(f.state, null);
  });
});
