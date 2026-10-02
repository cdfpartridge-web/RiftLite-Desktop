import type { MatchDraft } from "./types.js";
import { isCombinedOriginal } from "./matchCombine.js";

/** Review completion is independent of the game's result and delivery status. */
export function matchNeedsReview(match: MatchDraft): boolean {
  return !match.deletedAt && !isCombinedOriginal(match) &&
    (match.status === "pending-review" || match.status === "incomplete");
}

export function upsertMatchPreservingOrder(matches: MatchDraft[], saved: MatchDraft): MatchDraft[] {
  const existingIndex = matches.findIndex((match) => match.id === saved.id);
  if (existingIndex < 0) {
    return [saved, ...matches];
  }
  return matches.map((match, index) => index === existingIndex ? saved : match);
}

/** Pending/incomplete reviews stay visible in history but never affect stats. */
export function localMatchesEligibleForStats(matches: MatchDraft[]): MatchDraft[] {
  return matches.filter((match) => (
    match.status === "saved" &&
    !match.deletedAt &&
    !match.hiddenFromStats &&
    !match.mergedIntoMatchId
  ));
}
