import type { MatchDraft } from "./types.js";

export function upsertMatchPreservingOrder(matches: MatchDraft[], saved: MatchDraft): MatchDraft[] {
  const existingIndex = matches.findIndex((match) => match.id === saved.id);
  if (existingIndex < 0) {
    return [saved, ...matches];
  }
  return matches.map((match, index) => index === existingIndex ? saved : match);
}
