export class GameplayMaintenanceDeferredError extends Error {
  constructor(message = "Automatic maintenance is waiting until gameplay is idle.") {
    super(message);
    this.name = "GameplayMaintenanceDeferredError";
  }
}

export interface GameplayMaintenanceContext {
  /** Check before starting the next optional read, upload, or batch item. */
  canContinue(): boolean;
  /** Defer the job without consuming its ordinary error/retry budget. */
  checkpoint(): void;
}

export interface GameplayMaintenanceSchedulerOptions {
  /** Cheap, synchronous check; must not read disk or make network requests. */
  ready(): boolean;
  onError?(key: string, error: unknown): void | Promise<void>;
  now?: () => number;
  retryDelayMs?: number;
}

type MaintenanceJob = {
  run: (context: GameplayMaintenanceContext) => void | Promise<void>;
  notBefore: number;
};

/**
 * Serialises optional automatic work behind the gameplay boundary. Registered
 * callbacks read current account/settings state when they execute; requests
 * retain only a key, never a stale account snapshot or unbounded payload queue.
 *
 * Pausing is cooperative: a task may finish an atomic commit already in flight,
 * then checkpoint before starting its next optional operation. Essential local
 * capture and explicit user actions do not belong in this scheduler.
 */
export class GameplayMaintenanceScheduler {
  private readonly jobs = new Map<string, MaintenanceJob>();
  private readonly pending = new Set<string>();
  private readonly now: () => number;
  private readonly retryDelayMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private draining: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly options: GameplayMaintenanceSchedulerOptions) {
    this.now = options.now ?? Date.now;
    this.retryDelayMs = Number.isFinite(options.retryDelayMs)
      ? Math.max(1, Math.floor(options.retryDelayMs!))
      : 1_000;
  }

  register(key: string, run: MaintenanceJob["run"]): void {
    if (this.disposed) throw new Error("Automatic maintenance scheduler is disposed.");
    if (!key.trim() || this.jobs.has(key)) throw new Error(`Automatic maintenance job is invalid or already registered: ${key}`);
    this.jobs.set(key, { run, notBefore: 0 });
  }

  request(key: string): void {
    if (this.disposed) return;
    if (!this.jobs.has(key)) throw new Error(`Automatic maintenance job is not registered: ${key}`);
    this.pending.add(key);
    void this.runReady();
  }

  /** Nudge after a gameplay boundary; joins an existing run if one is active. */
  wake(): Promise<void> {
    return this.runReady();
  }

  /** Drains currently eligible work, without waiting for a busy game to finish. */
  runReady(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.clearTimer();
    if (this.draining) return this.draining;
    const operation = Promise.resolve().then(() => this.drain());
    const tracked = operation.finally(() => {
      if (this.draining === tracked) this.draining = null;
      this.schedulePending();
    });
    this.draining = tracked;
    return tracked;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.pending.clear();
    this.jobs.clear();
  }

  private canContinue(): boolean {
    // A failed readiness check must fail closed, never start work during play.
    try { return !this.disposed && this.options.ready(); } catch { return false; }
  }

  private async drain(): Promise<void> {
    while (this.pending.size && this.canContinue()) {
      const now = this.now();
      const key = [...this.pending].find((candidate) => this.jobs.get(candidate)!.notBefore <= now);
      if (key === undefined) return;
      const job = this.jobs.get(key)!;
      this.pending.delete(key);
      const context: GameplayMaintenanceContext = {
        canContinue: () => this.canContinue(),
        checkpoint: () => {
          if (!this.canContinue()) throw new GameplayMaintenanceDeferredError();
        },
      };
      try {
        context.checkpoint();
        await job.run(context);
        job.notBefore = 0;
      } catch (error) {
        if (error instanceof GameplayMaintenanceDeferredError) {
          if (!this.disposed) {
            job.notBefore = this.now() + this.retryDelayMs;
            this.pending.add(key);
          }
        } else {
          // A real failure consumes this request. A separately requested
          // follow-up remains pending, but a failed job never retries itself.
          try { await this.options.onError?.(key, error); } catch { /* Diagnostics cannot wedge other jobs. */ }
        }
      }
    }
  }

  private schedulePending(): void {
    if (this.disposed || this.draining || !this.pending.size || this.timer) return;
    const earliest = Math.min(...[...this.pending].map((key) => this.jobs.get(key)!.notBefore));
    const untilEligible = earliest - this.now();
    const delay = untilEligible > 0 ? Math.min(untilEligible, this.retryDelayMs) : this.retryDelayMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runReady();
    }, delay);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
