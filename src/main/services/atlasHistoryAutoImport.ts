import { needsAtlasHistoryImport } from "../../shared/atlasHistory.js";
import type { MatchDraft } from "../../shared/types.js";

/** Serial, bounded catch-up for completed matches. Never navigates the guest or opens a review. */
export class AtlasHistoryAutoImport {
  private pending?: Promise<void>;
  private attempts = new Map<string, { signature: string; count: number; nextAt: number }>();

  constructor(private readonly deps: {
    refresh(id: string): Promise<MatchDraft>;
    ready(): boolean;
    now?: () => number;
    report?: (id: string, state: "imported" | "waiting" | "retrying") => void;
  }) {}

  run(matches: MatchDraft[]): Promise<void> {
    if (this.pending) return this.pending;
    if (!this.deps.ready()) return Promise.resolve();
    const task = this.runNow(matches).finally(() => { this.pending = undefined; });
    this.pending = task;
    return task;
  }

  private async runNow(matches: MatchDraft[]): Promise<void> {
    const candidates = matches.filter(needsAtlasHistoryImport)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    const ids = new Set(candidates.map((m) => m.id));
    for (const id of this.attempts.keys()) if (!ids.has(id)) this.attempts.delete(id);
    let budget = 3;
    for (const match of candidates) {
      if (!this.deps.ready() || budget === 0) break;
      const now = (this.deps.now ?? Date.now)();
      // A corrected result or newly retained BO3 marker should retry promptly.
      const signature = JSON.stringify([match.myName, match.opponentName, match.games, match.atlasHistoryMarkers]);
      const previous = this.attempts.get(match.id);
      if (previous?.signature === signature && now < previous.nextAt) continue;
      const count = previous?.signature === signature ? previous.count + 1 : 1;
      const attempt = { signature, count, nextAt: now + Math.min(300_000, 15_000 * 2 ** Math.min(count - 1, 5)) };
      this.attempts.set(match.id, attempt);
      budget--;
      try {
        const saved = await this.deps.refresh(match.id);
        this.deps.report?.(match.id, needsAtlasHistoryImport(saved) ? "waiting" : "imported");
      } catch {
        // History may lag a result, or Atlas may be signed out. Keep the match
        // save successful and retry later, including after the next app launch.
        this.deps.report?.(match.id, "retrying");
      }
    }
  }
}
