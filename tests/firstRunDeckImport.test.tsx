import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FirstRunDeckImport } from "../src/renderer/FirstRunDeckImport";

function render() {
  return renderToStaticMarkup(<FirstRunDeckImport onImport={vi.fn()} onImported={vi.fn()} />);
}

describe("inline first-run deck import", () => {
  it("offers both regular import formats without navigating away from setup", () => {
    const html = render();
    expect(html).toContain("Piltover Archive link");
    expect(html).toContain("Paste deck list");
    expect(html).toContain("public Piltover Archive link");
    expect(html).toContain("without leaving Quick setup");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("target=");
  });

  it("fits inside the welcome form without nested forms or submit buttons", () => {
    const html = render();
    expect(html).not.toContain("<form");
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) expect(button).toContain('type="button"');
  });

  it("labels the link field and leaves importer validation to the regular importer", () => {
    const html = render();
    expect(html).toContain('for="first-run-deck-link"');
    expect(html).toContain('id="first-run-deck-link"');
    expect(html).toContain('type="text"');
    expect(html).toContain('inputMode="url"');
    expect(html).not.toContain("required=");
    expect(html).not.toContain("pattern=");
    expect(html).not.toContain("type=\"url\"");
  });

  it("starts with import disabled until there is a source", () => {
    const html = render();
    expect(html).toContain('aria-busy="false"');
    const importButton = (html.match(/<button[^]*?<\/button>/g) ?? []).find((button) => button.includes("Import deck"));
    expect(importButton).toContain('disabled=""');
    expect(html).not.toContain('role="alert"');
  });
});
