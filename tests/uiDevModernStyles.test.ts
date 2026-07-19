import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseStyles = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");
const modernStyles = readFileSync(new URL("../src/renderer/styles/ui-dev-modern.css", import.meta.url), "utf8");

function declarationsForSelector(css: string, selector: string): string[] {
  return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) => match[1].split(",").some((candidate) => candidate.trim() === selector))
    .map((match) => match[2]);
}

describe("UI Dev modern styles", () => {
  it("preserves the base scroll behavior of tall match-review dialogs", () => {
    expect(declarationsForSelector(baseStyles, ".review-modal").join("\n")).toMatch(/overflow\s*:\s*auto/);
    expect(declarationsForSelector(modernStyles, ".ui-dev-modern .review-modal").join("\n"))
      .not.toMatch(/overflow\s*:\s*hidden/);
  });

  it("keeps the replay drawing canvas transparent over video", () => {
    expect(declarationsForSelector(modernStyles, ".ui-dev-modern .replay-whiteboard").join("\n"))
      .not.toMatch(/(?:background|box-shadow)\s*:/);
  });
});
