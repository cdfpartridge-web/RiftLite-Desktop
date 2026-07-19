import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsAccordionSection } from "../src/renderer/SettingsAccordionSection";

describe("SettingsAccordionSection", () => {
  it("uses native disclosure semantics with an explicitly labelled content region", () => {
    const markup = renderToStaticMarkup(
      <SettingsAccordionSection
        id="capture-settings"
        title="Capture & replays"
        description="Replay, tracker, and voice-note controls"
      >
        <label>Replay capture<input type="checkbox" /></label>
      </SettingsAccordionSection>
    );

    expect(markup).toContain("<details class=\"settings-accordion\"");
    expect(markup).toContain("<summary id=\"capture-settings-summary\"");
    expect(markup).toContain("aria-controls=\"capture-settings-content\"");
    expect(markup).toContain("aria-expanded=\"false\"");
    expect(markup).toContain("role=\"region\"");
    expect(markup).toContain("aria-labelledby=\"capture-settings-summary\"");
  });

  it("keeps closed content mounted and can default the first group open", () => {
    const closedMarkup = renderToStaticMarkup(
      <SettingsAccordionSection id="closed" title="Files & tools">
        <span>Persistent child content</span>
      </SettingsAccordionSection>
    );
    const openMarkup = renderToStaticMarkup(
      <SettingsAccordionSection id="open" title="Getting started" defaultOpen>
        <span>Open child content</span>
      </SettingsAccordionSection>
    );

    expect(closedMarkup).toContain("Persistent child content");
    expect(closedMarkup).not.toContain(" open=\"\"");
    expect(openMarkup).toContain("<details class=\"settings-accordion\" open=\"\"");
    expect(openMarkup).toContain("aria-expanded=\"true\"");
  });

  it("composes integration classes without replacing the structural hooks", () => {
    const markup = renderToStaticMarkup(
      <SettingsAccordionSection
        id="support"
        title="Privacy & support"
        className="support-settings"
        contentClassName="settings-grid"
      >
        <span>Support</span>
      </SettingsAccordionSection>
    );

    expect(markup).toContain("class=\"settings-accordion support-settings\"");
    expect(markup).toContain("class=\"settings-accordion-content settings-grid\"");
  });
});
