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

  constructor(
    private readonly run: AccountCloudSyncRun,
    private readonly onError: AccountCloudSyncErrorHandler,
    private readonly delayMs = 20_000
  ) {}

  queue(reason = "Local data changed"): void {
    this.pendingReason = reason;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.delayMs);
  }

  private async drain(): Promise<void> {
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
      if (this.followUpDue && this.pendingReason) {
        this.followUpDue = false;
        void this.drain();
      } else {
        this.followUpDue = false;
      }
    }
  }
}
