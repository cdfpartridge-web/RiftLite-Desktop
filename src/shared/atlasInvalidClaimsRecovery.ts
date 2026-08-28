export type AtlasInvalidClaimsRecoveryStep = "refresh-token" | "reset-sign-in" | "stop";

/**
 * Bounds automatic invalid-claims recovery across replacement webviews. A
 * per-WebContents latch is insufficient because a forced remount creates a new
 * guest and would otherwise restart the loop from attempt one.
 */
export class AtlasInvalidClaimsRecoveryBudget {
  private attempts = 0;
  private lastAttemptAt = 0;

  constructor(private readonly windowMs = 2 * 60_000) {}

  next(now = Date.now()): AtlasInvalidClaimsRecoveryStep {
    if (this.lastAttemptAt && now - this.lastAttemptAt >= this.windowMs) {
      this.attempts = 0;
    }
    const step = this.attempts === 0
      ? "refresh-token"
      : this.attempts === 1
        ? "reset-sign-in"
        : "stop";
    if (step !== "stop") {
      this.attempts += 1;
      this.lastAttemptAt = now;
    }
    return step;
  }

  markHealthy(): void {
    this.attempts = 0;
    this.lastAttemptAt = 0;
  }
}
