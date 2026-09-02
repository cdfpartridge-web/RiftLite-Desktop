import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  RIFTJUDGE_RULES_URL,
  RULES_SEARCH_DRAWER_ID,
  RulesSearchDrawer
} from "../src/renderer/RulesSearchDrawer";
import { RIFTLITE_RULES_WEBVIEW_PARTITION } from "../src/shared/embeddedContentSecurity";

describe("RulesSearchDrawer", () => {
  it("renders RiftJudge as an accessible non-modal in-app rules surface", () => {
    const markup = renderToStaticMarkup(<RulesSearchDrawer onClose={vi.fn()} />);

    expect(markup).toContain(`id="${RULES_SEARCH_DRAWER_ID}"`);
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="false"');
    expect(markup).toContain("Search Rules");
    expect(markup).toContain("RiftJudge community rulings");
    expect(markup).toContain(`src="${RIFTJUDGE_RULES_URL}"`);
    expect(markup).toContain(`partition="${RIFTLITE_RULES_WEBVIEW_PARTITION}"`);
    expect(markup).toContain('aria-label="Reload RiftJudge"');
    expect(markup).toContain('aria-label="Close rules search"');
    expect(markup).toContain("Confirm tournament decisions with your head judge.");
    expect(markup).not.toContain("allowpopups");
  });
});
