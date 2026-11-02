import { GameplayMaintenanceScheduler } from "./gameplayMaintenanceScheduler.js";

/** One cached UI snapshot, valid only for the exact immutable settings object. */
export class GameplayMaintenanceSnapshot<Context, Value> {
  private cached: { context: Context; value: Value } | null = null;
  private generation = 0;

  constructor(
    private readonly scheduler: GameplayMaintenanceScheduler,
    private readonly key: string,
    private readonly readContext: () => Promise<Context>,
    private readonly readValue: () => Promise<Value>
  ) {
    scheduler.register(key, async (maintenance) => {
      const generation = ++this.generation;
      const context = await readContext();
      maintenance.checkpoint();
      const value = await readValue();
      const current = await readContext();
      if (generation === this.generation) this.cached = current === context ? { context, value } : null;
    });
  }

  async get(automatic = false): Promise<Value | null> {
    if (automatic) {
      this.scheduler.request(this.key);
      await this.scheduler.wake();
      const context = await this.readContext();
      return this.cached?.context === context ? this.cached.value : null;
    }
    // A user refresh remains immediate. Never return an old-account result if
    // its asynchronous disk read straddles an account/settings change.
    const generation = ++this.generation;
    const context = await this.readContext();
    const value = await this.readValue();
    if (await this.readContext() !== context) return null;
    if (generation === this.generation) this.cached = { context, value };
    return value;
  }
}
