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

  constructor(
    private readonly run: AccountCloudSyncRun,
    private readonly onError: AccountCloudSyncErrorHandler,
    private readonly delayMs = 20_000
  ) {}

  queue(reason = "Local data changed"): void {
    this.pendingReason = reason;
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

  private schedule(): void {
    if (this.suspensionCount > 0) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.delayMs);
  }

  private async drain(): Promise<void> {
    if (this.suspensionCount > 0) {
      return;
    }
    if (this.inFlight) {
      this.followUpDue = true;
      return;
    }
    if (!this.pendingReason) {
      return;
    }

    const reason = this.pendingReason;
    this.pendingReason = "";
    const operation = Promise.resolve().then(() => this.run(reason));
    this.inFlight = operation;
    try {
      await operation;
    } catch (error) {
      await this.onError(error);
    } finally {
      if (this.inFlight === operation) {
        this.inFlight = null;
      }
      if (this.suspensionCount > 0) {
        this.followUpDue = false;
        return;
      }
      if (this.followUpDue && this.pendingReason) {
        this.followUpDue = false;
        void this.drain();
      } else {
        this.followUpDue = false;
      }
    }
  }
}
