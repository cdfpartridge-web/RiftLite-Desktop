import { describe, expect, it } from "vitest";
import { legendFromImageUrl, legendImageUrl } from "../src/shared/legendImages";
import { CANONICAL_LEGEND_NAMES, canonicalLegendName, isCanonicalLegendName, legendAliasesFor, normalizeLegendName } from "../src/shared/legendNames";

describe("normalizeLegendName", () => {
  it("resolves every canonical legend with capture punctuation, case and starter suffixes", () => {
    for (const legend of CANONICAL_LEGEND_NAMES) {
      const variants = [
        legend,
        legend.toUpperCase(),
        `  ${legend.replace(/ /g, "  ")}  `,
        legend.replace(/'/g, "’"),
        `${legend} - Starter`
      ];
      for (const value of variants) {
        expect(normalizeLegendName(value), value).toBe(legend);
        expect(canonicalLegendName(value), value).toBe(legend);
      }
    }
  });

  it("resolves every registered subtitle and full captured legend name", () => {
    for (const legend of CANONICAL_LEGEND_NAMES) {
      for (const alias of legendAliasesFor(legend)) {
        for (const value of [alias, alias.toUpperCase(), `${alias} - Starter`, `${legend}, ${alias}`]) {
          expect(normalizeLegendName(value), value).toBe(legend);
          expect(canonicalLegendName(value), value).toBe(legend);
        }
      }
    }
  });

  it("preserves longest alias precedence and catalog order for equal lengths", () => {
    expect(normalizeLegendName("Gloomist / Blade Dancer")).toBe("Irelia");
    expect(normalizeLegendName("Blade Dancer / Gloomist")).toBe("Irelia");
    expect(normalizeLegendName("Gloomist / Alluring")).toBe("Ahri");
    expect(normalizeLegendName("Alluring / Gloomist")).toBe("Ahri");
    expect(normalizeLegendName("Viktor, Blade Dancer")).toBe("Irelia");
    expect(normalizeLegendName("Master Yi, Blade Dancer")).toBe("Master Yi");
  });

  it("matches subtitles at word boundaries without expanding short aliases", () => {
    expect(normalizeLegendName("Captured: [nine tailed fox]")).toBe("Ahri");
    expect(normalizeLegendName("Captured: [Soul’s Reflection]")).toBe("Mel");
    expect(normalizeLegendName("Gloomists")).toBe("Gloomists");
    expect(canonicalLegendName("Gloomists")).toBe("");
    expect(normalizeLegendName("Rebel")).toBe("Jinx");
    expect(normalizeLegendName("Captured Rebel")).toBe("Captured Rebel");
  });

  it("keeps unknown names and comma fallbacks without treating them as canonical", () => {
    expect(normalizeLegendName("  New   Legend, Unknown subtitle ")).toBe("New Legend");
    expect(canonicalLegendName("New Legend, Unknown subtitle")).toBe("");
    expect(normalizeLegendName("Viktor, Unknown subtitle")).toBe("Viktor");
    expect(normalizeLegendName(null)).toBe("");
    expect(normalizeLegendName(undefined)).toBe("");
    expect(normalizeLegendName(42)).toBe("42");
  });

  it("normalizes subtitle-only legend captures to primary legend names", () => {
    expect(normalizeLegendName("Gloomist")).toBe("Vex");
    expect(normalizeLegendName("Bloodharbor Ripper")).toBe("Pyke");
    expect(normalizeLegendName("Loose Cannon")).toBe("Jinx");
    expect(normalizeLegendName("Blade Dancer")).toBe("Irelia");
    expect(normalizeLegendName("Vex Gloomist")).toBe("Vex");
  });

  it("keeps Master Yi legend variants distinct", () => {
    expect(normalizeLegendName("Wuju Bladesman - Starter")).toBe("Master Yi, Wuju Bladesman");
    expect(normalizeLegendName("Wuju Bladesmen")).toBe("Master Yi, Wuju Bladesman");
    expect(normalizeLegendName("Master Yi, Wuju Bladesmen")).toBe("Master Yi, Wuju Bladesman");
    expect(normalizeLegendName("Wuju Master")).toBe("Master Yi, Wuju Master");
    expect(normalizeLegendName("Master Yi, Wuji Master")).toBe("Master Yi, Wuju Master");
    expect(normalizeLegendName("Master Yi, Wuju Bladesman")).toBe("Master Yi, Wuju Bladesman");
  });

  it("resolves analytics names only to canonical legends", () => {
    expect(canonicalLegendName("Kaisa")).toBe("Kai'Sa");
    expect(canonicalLegendName("viktor")).toBe("Viktor");
    expect(canonicalLegendName("victor")).toBe("");
    expect(canonicalLegendName("Yi")).toBe("");
    expect(isCanonicalLegendName("Gloomist")).toBe(true);
    expect(isCanonicalLegendName("random deck name")).toBe(false);
  });

  it("normalizes Vendetta preview legend aliases", () => {
    expect(normalizeLegendName("Hidden Weapon")).toBe("Akali");
    expect(normalizeLegendName("Rogue Assassin")).toBe("Akali");
    expect(normalizeLegendName("Matriarch of War")).toBe("Ambessa");
    expect(normalizeLegendName("Defender of Tomorrow")).toBe("Jayce");
    expect(normalizeLegendName("Heart of the Tempest")).toBe("Kennen");
    expect(normalizeLegendName("Newly Awakened")).toBe("Mel");
    expect(normalizeLegendName("Soul's Reflection")).toBe("Mel");
    expect(normalizeLegendName("Soul’s Reflection")).toBe("Mel");
    expect(normalizeLegendName("Aspect of the Jackal")).toBe("Nasus");
    expect(normalizeLegendName("Butcher of the Desert")).toBe("Renekton");
    expect(normalizeLegendName("Butcher of the Sands")).toBe("Renekton");
    expect(normalizeLegendName("Mechanized Menace")).toBe("Rumble");
    expect(normalizeLegendName("Eye of Twilight")).toBe("Shen");
    expect(normalizeLegendName("Master of Shadows")).toBe("Zed");
  });

  it("resolves Vendetta legend image codes from Atlas URLs", () => {
    expect(legendFromImageUrl("https://assets.riftatlas-workers.com/riftbound/cards/small-v2/VEN-153.webp")).toBe("Ambessa");
    expect(legendFromImageUrl("https://assets.riftatlas-workers.com/riftbound/cards/small-v2/VEN-139.webp")).toBe("Akali");
    expect(legendFromImageUrl("https://assets.riftatlas-workers.com/riftbound/cards/small-v2/VEN-190.webp")).toBe("Renekton");
    expect(legendFromImageUrl("https://assets.riftatlas-workers.com/riftbound/cards/small-v2/VEN-149.webp")).toBe("Jayce");
    expect(legendFromImageUrl("https://assets.riftatlas-workers.com/riftbound/cards/small-v2/VEN-189-star.webp")).toBe("Akali");
    expect(legendFromImageUrl("https://assets.riftatlas-workers.com/riftbound/cards/small-v2/VEN-192.webp")).toBe("Nasus");
    expect(legendFromImageUrl("https://assets.riftatlas-workers.com/riftbound/cards/small-v2/VEN-194.webp")).toBe("Jayce");
    expect(legendFromImageUrl("https://assets.riftatlas-workers.com/riftbound/cards/small-v2/VEN-195.webp")).toBe("Mel");
    expect(legendFromImageUrl("https://assets.riftatlas-workers.com/riftbound/cards/small-v2/VEN-196.webp")).toBe("Ambessa");
    expect(legendFromImageUrl("https://assets.riftatlas-workers.com/riftbound/cards/small-v2/SFD-181.webp")).toBe("Rumble");
    expect(legendFromImageUrl("https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0eab83392b310417d2630d50a3bfee3dd02b31c4-744x1039.png?accountingTag=RB&auto=format&fit=fill&q=80&w=444")).toBe("Kennen");
  });

  it("provides display art for every Vendetta legend used by the matrix", () => {
    const expectedCodes: Record<string, string> = {
      Ambessa: "VEN-153",
      Jayce: "VEN-149",
      Mel: "VEN-151",
      Nasus: "VEN-145",
      Rumble: "SFD-181",
      Shen: "VEN-147",
      Zed: "VEN-143"
    };

    for (const [legend, code] of Object.entries(expectedCodes)) {
      expect(legendImageUrl(legend)).toContain(`/small-v2/${code}.webp`);
    }
  });
});
