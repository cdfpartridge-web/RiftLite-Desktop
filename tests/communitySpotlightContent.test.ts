import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const zeloniusStart = appSource.indexOf("const ZELONIUS_SPOTLIGHT");
const x0tcgStart = appSource.indexOf("const X0TCG_SPOTLIGHT", zeloniusStart);
const spotlightListStart = appSource.indexOf("const COMMUNITY_SPOTLIGHTS", x0tcgStart);
const zeloniusSource = appSource.slice(zeloniusStart, x0tcgStart);
const x0tcgSource = appSource.slice(x0tcgStart, spotlightListStart);

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

describe("X0TCG creator spotlight", () => {
  it("uses the supplied coaching profile, official destinations, and tracked link IDs", () => {
    expect(x0tcgStart).toBeGreaterThan(-1);
    expect(x0tcgSource).toContain('id: "x0tcg"');
    expect(x0tcgSource).toContain("competitive Riftbound player, creator, coach, and qualified teacher");
    expect(x0tcgSource).toContain("A coach you can trust");
    expect(x0tcgSource).toContain("New-player friendly");
    expect(x0tcgSource).toContain("Learning focused");
    expect(x0tcgSource).toContain("Wealth of knowledge");
    expect(x0tcgSource).toContain('url: "https://www.twitch.tv/x0tcg"');
    expect(x0tcgSource).toContain('url: "https://metafy.gg/@x0tcg"');
    expect(x0tcgSource).toContain('url: "https://x.com/X0TCG"');
    expect(x0tcgSource).toContain('url: "https://www.youtube.com/@x0tcg-riftbound"');
    expect(x0tcgSource).toContain('url: "https://www.tiktok.com/@x0tcg"');
    expect(x0tcgSource).toContain('url: "https://linktr.ee/x0tcg"');
    expect(x0tcgSource).toContain('logo: "community/x0tcg-profile.png"');
    const linksSource = x0tcgSource.slice(x0tcgSource.indexOf("links: ["));
    expect(linksSource.indexOf('id: "linktree"')).toBeLessThan(linksSource.indexOf('id: "metafy"'));
  });

  it("adds X0TCG to the active creator catalogue", () => {
    const activeCatalogue = appSource.slice(spotlightListStart, appSource.indexOf("interface CaptureNotice"));
    expect(activeCatalogue).toContain("X0TCG_SPOTLIGHT");
  });
});
