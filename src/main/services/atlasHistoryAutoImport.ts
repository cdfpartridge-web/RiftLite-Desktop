import { atlasHistoryTimestamp, needsAtlasHistoryImport, normalizeAtlasHistoryMarkers } from "../../shared/atlasHistory.js";
import type { MatchDraft } from "../../shared/types.js";

const MINUTE = 60_000;
const MAX_MATCH_AGE_MS = 24 * 60 * MINUTE;
const MIN_PASS_INTERVAL_MS = 2 * MINUTE;
const RETRY_DELAYS_MS = [2, 5, 15, 30, 60, 120, 240].map((minutes) => minutes * MINUTE);
// These attempt limits apply within this desktop session. The timestamp cutoff
// above applies after relaunch too, without persisting retry state on matches.
const MAX_NORMAL_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const MAX_ATTEMPTS_WITH_CORRECTIONS = MAX_NORMAL_ATTEMPTS + 2;

// Start the absolute window from the latest recorded game, so a long BO3 is
// still eligible. updatedAt is deliberately excluded: importing history or
// editing a note must not keep an unrecorded match alive indefinitely.
function automaticImportTimestamp(match: MatchDraft, now: number): number {
  const timestamp = Math.max(atlasHistoryTimestamp(match.capturedAt),
    ...normalizeAtlasHistoryMarkers(match.atlasHistoryMarkers).map((marker) => marker.startedAt));
  return timestamp > 0 && timestamp <= now + 5 * MINUTE && now - timestamp < MAX_MATCH_AGE_MS ? timestamp : 0;
}

function importSignature(match: MatchDraft): string {
  const name = (value: string) => value.trim().toLowerCase();
  return JSON.stringify([
    name(match.myName), name(match.opponentName),
    match.games.map((game) => [game.gameNumber, game.myPoints, game.oppPoints]).sort((a, b) => a[0]! - b[0]!),
    normalizeAtlasHistoryMarkers(match.atlasHistoryMarkers)
      .map((marker) => [marker.gameNumber, marker.startedAt]).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
  ]);
}

/** Serial, bounded catch-up for completed matches. Never navigates the guest or opens a review. */
export class AtlasHistoryAutoImport {
  private pending?: Promise<void>;
  private attempts = new Map<string, { signature: string; count: number; nextAt: number }>();
  private nextPassAt = 0;

  constructor(private readonly deps: {
    refreshMany(ids: string[]): Promise<PromiseSettledResult<MatchDraft>[]>;
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
    const now = (this.deps.now ?? Date.now)();
    const recent = matches.map((match) => ({ match, timestamp: automaticImportTimestamp(match, now) }))
      .filter(({ timestamp }) => timestamp > 0);
    // Keep budgets for completed recent rows too: a subsequent correction or
    // partial-history update must not accidentally grant a new retry budget.
    const ids = new Set(recent.map(({ match }) => match.id));
    for (const id of this.attempts.keys()) if (!ids.has(id)) this.attempts.delete(id);
    if (now < this.nextPassAt) return;
    const selected: MatchDraft[] = [];
    for (const { match } of recent.filter(({ match }) => needsAtlasHistoryImport(match))
      .sort((a, b) => b.timestamp - a.timestamp)) {
      if (!this.deps.ready() || selected.length === 3) break;
      const signature = importSignature(match);
      const previous = this.attempts.get(match.id);
      const corrected = previous !== undefined && previous.signature !== signature;
      if (previous && (previous.count >= MAX_ATTEMPTS_WITH_CORRECTIONS ||
        (!corrected && (previous.count >= MAX_NORMAL_ATTEMPTS || now < previous.nextAt)))) continue;
      const count = (previous?.count ?? 0) + 1;
      this.attempts.set(match.id, {
        signature, count, nextAt: now + (RETRY_DELAYS_MS[count - 1] ?? Infinity),
      });
      selected.push(match);
    }
    if (!selected.length) return;
    this.nextPassAt = now + MIN_PASS_INTERVAL_MS;
    try {
      // One shared history listing per pass, even when three matches need it.
      const results = await this.deps.refreshMany(selected.map((match) => match.id));
      selected.forEach((match, index) => {
        const result = results[index];
        this.deps.report?.(match.id, result?.status === "fulfilled"
          ? needsAtlasHistoryImport(result.value) ? "waiting" : "imported"
          : "retrying");
      });
    } catch {
      // A failed batch consumes an attempt too. Manual refresh remains available
      // after automatic attempts or the absolute, restart-safe age window end.
      for (const match of selected) this.deps.report?.(match.id, "retrying");
    }
  }
}
