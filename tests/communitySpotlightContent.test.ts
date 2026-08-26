import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const zeloniusStart = appSource.indexOf("const ZELONIUS_SPOTLIGHT");
const spotlightListStart = appSource.indexOf("const COMMUNITY_SPOTLIGHTS", zeloniusStart);
const zeloniusSource = appSource.slice(zeloniusStart, spotlightListStart);

describe("Zelonius creator spotlight", () => {
  it("uses the supplied profile copy and working official social destinations", () => {
    expect(zeloniusStart).toBeGreaterThan(-1);
    expect(zeloniusSource).toContain('id: "zelonius"');
    expect(zeloniusSource).toContain("former professional FIFA player and coach");
    expect(zeloniusSource).toContain('url: "https://x.com/Zelonius"');
    expect(zeloniusSource).toContain('url: "https://www.youtube.com/@Zelonius-Riftbound"');
  });

  it("removes Bloody from the active creator catalogue", () => {
    const activeCatalogue = appSource.slice(zeloniusStart);
    expect(activeCatalogue).not.toContain("BLOODY_SPOTLIGHT");
    expect(activeCatalogue).not.toContain('id: "bloody"');
  });
});
