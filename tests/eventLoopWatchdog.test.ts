import { afterEach, describe, expect, it, vi } from "vitest";
import { startEventLoopWatchdog } from "../src/main/services/eventLoopWatchdog.js";

describe("event loop watchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exposes pending and recent lag without reporting or retaining stale stalls", () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const report = vi.fn();
    const watchdog = startEventLoopWatchdog(report);
    expect(watchdog.currentLagMs()).toBe(0);

    // An IPC event can arrive before the delayed watchdog callback runs.
    now = 1_600;
    expect(watchdog.currentLagMs()).toBe(600);
    expect(report).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(watchdog.currentLagMs()).toBe(600);
    expect(report).toHaveBeenCalledTimes(1);

    now = 2_600;
    vi.advanceTimersByTime(1_000);
    expect(watchdog.currentLagMs()).toBe(0);
    now = 3_800;
    vi.advanceTimersByTime(1_000);
    expect(watchdog.currentLagMs()).toBe(200);
    expect(report).toHaveBeenCalledTimes(1); // Reporting cooldown is independent.
    now = 4_800;
    vi.advanceTimersByTime(1_000);
    expect(watchdog.currentLagMs()).toBe(0);
    watchdog.stop();
  });

  it("reports material lag, rate limits it, and stops cleanly", () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const report = vi.fn();
    const watchdog = startEventLoopWatchdog(report, { intervalMs: 1_000, thresholdMs: 100, cooldownMs: 5_000 });

    now = 1_250;
    vi.advanceTimersByTime(1_000);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject({ lagMs: 250 });

    now = 2_500;
    vi.advanceTimersByTime(1_000);
    expect(report).toHaveBeenCalledTimes(1);

    watchdog.stop();
    now = 10_000;
    vi.advanceTimersByTime(10_000);
    expect(report).toHaveBeenCalledTimes(1);
  });
});
