import type { MatchDraft } from "./types.js";

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
