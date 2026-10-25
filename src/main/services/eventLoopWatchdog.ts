export interface EventLoopLagEvent {
  lagMs: number;
  rssBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
}

export interface EventLoopWatchdog {
  stop(): void;
  /** Recent timer drift, including a delayed tick that has not run yet. */
  currentLagMs(): number;
}

/**
 * Records only material main-process stalls and rate-limits reports. The timer
 * is deliberately unref'd so diagnostics can never keep Electron alive.
 */
export function startEventLoopWatchdog(
  report: (event: EventLoopLagEvent) => void,
  options: { intervalMs?: number; thresholdMs?: number; cooldownMs?: number } = {}
): EventLoopWatchdog {
  const intervalMs = Math.max(250, options.intervalMs ?? 1_000);
  const thresholdMs = Math.max(50, options.thresholdMs ?? 150);
  const cooldownMs = Math.max(intervalMs, options.cooldownMs ?? 30_000);
  let expectedAt = performance.now() + intervalMs;
  let lastReportedAt = Number.NEGATIVE_INFINITY;
  let lastTickAt = Number.NEGATIVE_INFINITY;
  let lastLagMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    const lagMs = Math.max(0, now - expectedAt);
    lastTickAt = now;
    lastLagMs = lagMs;
    expectedAt = now + intervalMs;
    if (lagMs < thresholdMs || now - lastReportedAt < cooldownMs) {
      return;
    }
    lastReportedAt = now;
    const memory = process.memoryUsage();
    report({
      lagMs: Math.round(lagMs),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      externalBytes: memory.external
    });
  }, intervalMs);
  timer.unref();
  return {
    stop: () => clearInterval(timer),
    currentLagMs: () => {
      const now = performance.now();
      return Math.round(Math.max(
        0,
        now - expectedAt,
        now - lastTickAt <= intervalMs ? lastLagMs : 0
      ));
    }
  };
}
