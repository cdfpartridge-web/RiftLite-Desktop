import { describe, expect, it } from "vitest";
import { enqueueReviewDraft, shiftReviewDraft } from "../src/shared/reviewQueue";
import type { MatchDraft } from "../src/shared/types";

function draft(id: string, opponentName = id): MatchDraft {
  return { id, opponentName } as MatchDraft;
}

describe("pending review queue", () => {
  it("keeps capture order while updating duplicate queued drafts in place", () => {
    const queued = enqueueReviewDraft(
      enqueueReviewDraft([draft("first")], draft("second", "old")),
      draft("second", "updated")
    );
    expect(queued.map((item) => item.id)).toEqual(["first", "second"]);
    expect(queued[1].opponentName).toBe("updated");
  });

  it("opens queued reviews in FIFO order", () => {
    const first = shiftReviewDraft([draft("one"), draft("two")]);
    expect(first.next?.id).toBe("one");
    expect(first.remaining.map((item) => item.id)).toEqual(["two"]);
  });
});
