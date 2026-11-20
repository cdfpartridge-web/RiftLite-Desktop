import { GameplayMaintenanceDeferredError } from "./gameplayMaintenanceScheduler.js";
import { isTransientRequestError } from "./httpDeadline.js";

export type AccountCloudSyncRun = (reason: string) => Promise<void>;
export type AccountCloudSyncErrorHandler = (error: unknown) => Promise<void> | void;

/**
 * Debounces local backup writes and guarantees that only one cloud generation is
 * uploaded at a time. A change made during an upload is retained and produces
 * exactly one follow-up upload after the normal debounce window has elapsed.
 */
export class AccountCloudSyncQueue {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private pendingReason = "";
  private followUpDue = false;
  private suspensionCount = 0;
  private retryAttempt = 0;
  private intentGeneration = 0;

  constructor(
    private readonly run: AccountCloudSyncRun,
    private readonly onError: AccountCloudSyncErrorHandler,
    private readonly delayMs = 20_000,
    private readonly dispatch?: () => void
  ) {}

  queue(reason = "Local data changed"): void {
    this.pendingReason = reason;
    this.retryAttempt = 0;
    if (this.suspensionCount > 0) {
      return;
    }
    this.schedule();
  }

  /**
   * Pause scheduled uploads while a destructive local restore is in progress.
   * A caller may discard work which was queued before the restore began; any
   * genuinely new mutation queued while suspended is retained for afterwards.
   * The returned resume function is idempotent and supports nested callers.
   */
  suspend(options: { discardPending?: boolean } = {}): () => void {
    this.suspensionCount += 1;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (options.discardPending === true) {
      this.discardPending();
    }

    let resumed = false;
    return () => {
      if (resumed) {
        return;
      }
      resumed = true;
      this.suspensionCount = Math.max(0, this.suspensionCount - 1);
      if (this.suspensionCount === 0 && this.pendingReason) {
        this.schedule();
      }
    };
  }

  /** Discard only work queued before a restore successfully acquires its fence. */
  discardPending(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingReason = "";
    this.followUpDue = false;
    this.retryAttempt = 0;
    this.intentGeneration += 1;
  }

  /**
   * Removes and returns the pending reason so a restore can put it back if the
   * fenced database replacement fails. Work queued later while suspended stays
   * authoritative and is never overwritten by the older reason.
   */
  takePendingReason(): string {
    const reason = this.pendingReason;
    this.discardPending();
    return reason;
  }

  restorePendingReason(reason: string): void {
    if (!reason || this.pendingReason) {
      return;
    }
    this.pendingReason = reason;
    if (this.suspensionCount === 0) {
      this.schedule();
    }
  }

  /** Run a dispatched upload only while its pending intent is still valid. */
  flush(): Promise<void> {
    // A previously dispatched job must not bypass a newer mutation's debounce
    // (including new work retained while an account restore was suspended).
    if (this.timer) return Promise.resolve();
    return this.drain();
  }

  private requestDrain(): void {
    if (this.dispatch) this.dispatch();
    else void this.drain();
  }

  private schedule(delayMs = this.delayMs): void {
    if (this.suspensionCount > 0) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.requestDrain();
    }, delayMs);
  }

  private async drain(): Promise<void> {
    if (this.suspensionCount > 0) {
      return;
    }
    if (this.inFlight) {
      this.followUpDue = true;
      await this.inFlight.catch(() => undefined);
      return;
    }
    if (!this.pendingReason) {
      return;
    }

    const reason = this.pendingReason;
    const generation = this.intentGeneration;
    this.pendingReason = "";
    const operation = Promise.resolve().then(() => this.run(reason));
    this.inFlight = operation;
    let deferred = false;
    let retryDelayMs = 0;
    try {
      await operation;
      this.retryAttempt = 0;
    } catch (error) {
      if (error instanceof GameplayMaintenanceDeferredError) {
        // A newly started game postpones work; it is neither a failed backup
        // nor permission to lose the mutation that requested this upload.
        if (!this.pendingReason && generation === this.intentGeneration) this.pendingReason = reason;
        deferred = true;
      } else {
        if (generation === this.intentGeneration && isTransientRequestError(error)) {
          if (!this.pendingReason) this.pendingReason = reason;
          // A single retained intent, with capped backoff, survives offline periods.
          // Every attempt still goes through gameplay/account checks in run().
          retryDelayMs = Math.max(this.delayMs, Math.min(5 * 60_000, 30_000 * 2 ** this.retryAttempt));
          this.retryAttempt = Math.min(this.retryAttempt + 1, 4);
        } else {
          this.retryAttempt = 0;
        }
        try { await this.onError(error); } catch { /* Reporting cannot discard pending work. */ }
      }
    } finally {
      if (this.inFlight === operation) {
        this.inFlight = null;
      }
      if (this.suspensionCount > 0) {
        this.followUpDue = false;
        return;
      }
      if (retryDelayMs && this.pendingReason) {
        this.followUpDue = false;
        this.schedule(retryDelayMs);
      } else if (deferred && this.pendingReason) {
        this.followUpDue = false;
        this.schedule();
      } else if (this.followUpDue && this.pendingReason) {
        this.followUpDue = false;
        this.requestDrain();
      } else {
        this.followUpDue = false;
      }
    }
  }
}
