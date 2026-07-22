import type { MatchDraft } from "./types.js";

export function enqueueReviewDraft(queue: MatchDraft[], draft: MatchDraft): MatchDraft[] {
  const existingIndex = queue.findIndex((item) => item.id === draft.id);
  if (existingIndex < 0) return [...queue, draft];
  return queue.map((item, index) => index === existingIndex ? draft : item);
}

export function shiftReviewDraft(queue: MatchDraft[]): { next: MatchDraft | null; remaining: MatchDraft[] } {
  const [next, ...remaining] = queue;
  return { next: next ?? null, remaining };
}
