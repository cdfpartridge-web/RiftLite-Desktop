import type { AtlasLobbyPlayerFieldState } from "../../shared/atlasLobbyPlayerField.js";

interface AtlasLobbyPlayerFieldRepairOptions {
  isSafe: () => boolean;
  readField: () => Promise<AtlasLobbyPlayerFieldState>;
  applyCss: () => Promise<void>;
  report: (outcome: "repaired" | "failed") => void;
  delay?: (ms: number) => Promise<void>;
}

/**
 * CSS-only recovery, deliberately independent of empty-shell reload recovery.
 * A returned insertCSS key is not proof that Atlas's required field rendered.
 * Recheck live evidence, allow one insertion per document, then verify layout.
 */
export class AtlasLobbyPlayerFieldRepair {
  private epoch = 0;
  private attempted = false;
  private disposed = false;
  private activeCheck: object | undefined;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(private readonly options: AtlasLobbyPlayerFieldRepairOptions) {
    this.delay = options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  navigationChanged(newDocument: boolean): void {
    this.epoch += 1;
    this.activeCheck = undefined;
    if (newDocument) this.attempted = false;
  }

  dispose(): void {
    this.disposed = true;
    this.navigationChanged(false);
  }

  async check(): Promise<void> {
    if (this.disposed || this.attempted || this.activeCheck || !this.options.isSafe()) return;
    const epoch = this.epoch;
    const check = {};
    this.activeCheck = check;
    const current = () => !this.disposed && this.epoch === epoch &&
      this.activeCheck === check && this.options.isSafe();
    let inserted = false;
    try {
      const initial = await this.options.readField();
      if (!current() || initial !== "collapsed") return;
      // Avoid repairing a transient first paint or a field being unmounted.
      await this.delay(250);
      if (!current()) return;
      const confirmed = await this.options.readField();
      if (!current() || confirmed !== "collapsed") return;
      this.attempted = true;
      inserted = true;
      // No await between the final safety check above and this sole mutation.
      await this.options.applyCss();
      if (!current()) return;
      await this.delay(250);
      if (!current()) return;
      const verified = await this.options.readField();
      if (!current() || verified === "blocked") return;
      this.options.report(verified === "ready" ? "repaired" : "failed");
    } catch {
      // A rejected probe is not proof of a broken layout. Only report a failed
      // repair after an actual attempt, and never over an active/new page.
      if (inserted && current()) this.options.report("failed");
    } finally {
      if (this.activeCheck === check) this.activeCheck = undefined;
    }
  }
}
