import { describe, expect, it } from "vitest";
import { atlasCardRenderingCssForUrl } from "../src/shared/atlasCardRendering.js";

describe("Atlas card rendering", () => {
  it("sharpens only card artwork on low-DPI Atlas boards", () => {
    const css = atlasCardRenderingCssForUrl("https://play.riftatlas.com/game/example");

    expect(css).toContain("@media (max-resolution: 1.05dppx)");
    expect(css).toContain(".gb-board [data-card-id] img");
    expect(css).toContain("image-rendering: -webkit-optimize-contrast");
    expect(css).not.toMatch(/(?:transform|zoom)\s*:/);
  });

  it("does not inject the rule into other embedded sites", () => {
    expect(atlasCardRenderingCssForUrl("https://tcg-arena.fr/")).toBe("");
    expect(atlasCardRenderingCssForUrl("https://play.riftatlas.com.evil.example/")).toBe("");
    expect(atlasCardRenderingCssForUrl("not a url")).toBe("");
  });
});
