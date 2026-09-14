import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeckGuideReviewNotice } from "../src/renderer/DeckGuideReviewNotice";
import type { DeckGuideReviewReport } from "../src/shared/deckGuideReview";

const report: DeckGuideReviewReport = {
  legend: "Jax", label: "Jax", hasContent: true, status: "changed", deckChanged: true,
  reviewedAt: "2026-09-08T07:00:00.000Z", canMarkReviewed: false,
  issues: [{ id: "missing", stage: "sideboard", section: "Bring in", cardName: "Rebuke", message: "Rebuke is no longer in the sideboard.", blocking: true }]
};
function render(current: DeckGuideReviewReport, busy = false): string {
  return renderToStaticMarkup(<DeckGuideReviewNotice reports={[current]} current={current} busy={busy} dirty={false} onOpen={() => undefined} onMarkReviewed={() => undefined} />);
}

describe("Prepare plan-change notice", () => {
  it("shows the exact affected guide and section and blocks false acknowledgment", () => {
    const html = render(report);
    expect(html).toContain("1 plan needs a closer look");
    expect(html).toContain("Rebuke is no longer in the sideboard.");
    expect(html).toContain("Review Bring in");
    expect(html).toMatch(/disabled=""[^>]*>[\s\S]*Save &amp; mark reviewed/);
    expect(html).toContain("You can still save it as a work in progress.");
  });
  it("describes missing historical evidence honestly for a valid legacy plan", () => {
    const html = render({ ...report, status: "unreviewed", reviewedAt: undefined, deckChanged: false, issues: [], canMarkReviewed: true });
    expect(html).toContain("No previously reviewed deck is available");
    expect(html).not.toContain("Last reviewed");
    expect(html).not.toContain("disabled=");
  });
  it("does not claim an empty guide was reviewed and prevents duplicate saves", () => {
    expect(render({ ...report, hasContent: false, issues: [] })).toBe("");
    expect(render({ ...report, canMarkReviewed: true, issues: [] }, true)).toContain("Saving…");
    expect(render({ ...report, canMarkReviewed: true, issues: [] }, true)).toContain('disabled=""');
  });
});
