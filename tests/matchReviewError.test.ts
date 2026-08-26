import { describe, expect, it } from "vitest";
import { matchReviewErrorMessage } from "../src/shared/matchReviewError.js";

describe("match review persistence errors", () => {
  it("does not expose captured payload keys from an opaque storage exception", () => {
    const message = matchReviewErrorMessage(
      new Error("Error invoking remote method 'matches:confirm': Error: [\"configuredUsername\",\"endText\",\"format\",\"myBattlefield\",\"myBattlefieldCode\",\"myBattlefieldImage\",\"myChampion\"]"),
      "Save did not complete."
    );

    expect(message).toContain("RiftLite could not update local match storage");
    expect(message).toContain("This review is still open");
    expect(message).toContain("try Save match again");
    expect(message).not.toContain("configuredUsername");
    expect(message).not.toContain("myBattlefieldImage");
  });

  it.each([
    "RuntimeError: memory access out of bounds",
    "null function or function signature mismatch",
    "table index is out of bounds"
  ])("gives a bounded recovery action for sql.js runtime failure: %s", (error) => {
    const message = matchReviewErrorMessage(new Error(error), "Save did not complete.");

    expect(message).toBe(
      "Save did not complete. RiftLite's local database runtime stopped responding. This review is still open; restart RiftLite, then try Save match again."
    );
  });

  it("preserves controlled lifecycle guidance while hiding arbitrary filesystem details", () => {
    expect(matchReviewErrorMessage(
      new Error("This captured match was deleted while its review was open. It was not restored."),
      "Review later could not store this match."
    )).toContain("This captured match was deleted while its review was open.");

    const hidden = matchReviewErrorMessage(
      new Error("EPERM: operation not permitted, rename 'C:\\Users\\tester\\private.sqlite.tmp'"),
      "Save did not complete."
    );
    expect(hidden).not.toContain("tester");
    expect(hidden).not.toContain("private.sqlite");
  });
});
