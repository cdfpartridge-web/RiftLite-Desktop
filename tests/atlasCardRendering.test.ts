import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { atlasCardRenderingCssForUrl } from "../src/shared/atlasCardRendering.js";

const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Could not find source block between ${startMarker} and ${endMarker}.`);
  }
  return source.slice(start, end);
}

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

  it("retries a rejected compatibility-style insertion without crossing navigations", () => {
    const lifecycle = sourceBetween(
      mainSource,
      "let atlasCardRenderingGeneration = 0",
      "const reportGuestLifecycle"
    );

    expect(lifecycle).toContain("atlasCardRenderingAttemptCount < 3");
    expect(lifecycle).toContain("generation === atlasCardRenderingGeneration");
    expect(lifecycle).toContain("atlasCardRenderingRetryTimer = setTimeout");
    expect(lifecycle).toContain("installAtlasCardRendering();");
    expect(lifecycle).toContain("clearTimeout(atlasCardRenderingRetryTimer)");
  });
});
