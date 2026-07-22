import { afterEach, describe, expect, it, vi } from "vitest";
import { startEventLoopWatchdog } from "../src/main/services/eventLoopWatchdog.js";

describe("event loop watchdog", () => {
  afterEach(() => vi.useRealTimers());

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
