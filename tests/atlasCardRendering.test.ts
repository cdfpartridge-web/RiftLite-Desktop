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

  it("moves Atlas's named lobby query container above the flex column", () => {
    const css = atlasCardRenderingCssForUrl("https://play.riftatlas.com/");

    expect(css).toContain(".hub-theme > .contents:has(.lobby-content-column)");
    expect(css).toContain("display: block !important");
    expect(css).toContain("min-height: 100dvh !important");
    expect(css).toContain(".hub-theme .lobby-content-column");
    expect(css).toContain("container-type: normal !important");
    expect(css).toContain("container-name: none !important");
    expect(css).toContain(".hub-theme :has(> .lobby-content-column)");
    expect(css).toContain("container: lobby-content / inline-size !important");
  });

  it("does not inject the rule into other embedded sites", () => {
    expect(atlasCardRenderingCssForUrl("https://tcg-arena.fr/")).toBe("");
    expect(atlasCardRenderingCssForUrl("https://play.riftatlas.com.evil.example/")).toBe("");
    expect(atlasCardRenderingCssForUrl("not a url")).toBe("");
  });
});
