import type { DeckTrackerState, VisionDeckTrackerStatus } from "../shared/types";

interface DeckTrackerRefreshDependencies {
  isEnabled(): boolean;
  loadState(): Promise<DeckTrackerState | null>;
  loadVisionStatus(): Promise<VisionDeckTrackerStatus | null>;
  apply(state: DeckTrackerState, status: VisionDeckTrackerStatus | null): void;
  clear(): void;
}

/** Keeps disabled trackers out of the gameplay IPC path and retires old reads. */
export class DeckTrackerRefreshCoordinator {
  private generation = 0;
  private pending: Promise<void> | null = null;

  constructor(private readonly dependencies: DeckTrackerRefreshDependencies) {}

  invalidate(): void {
    this.generation += 1;
    this.pending = null;
  }

  refresh(): Promise<void> {
    if (!this.dependencies.isEnabled()) {
      this.invalidate();
      this.dependencies.clear();
      return Promise.resolve();
    }
    if (this.pending) return this.pending;
    const generation = this.generation;
    const request = Promise.all([
      this.dependencies.loadState().catch(() => null),
      this.dependencies.loadVisionStatus().catch(() => null)
    ]).then(([state, status]) => {
      if (generation !== this.generation || !this.dependencies.isEnabled()) return;
      if (state) this.dependencies.apply(state, status);
    }).finally(() => {
      if (this.pending === request) this.pending = null;
    });
    this.pending = request;
    return request;
  }
}
