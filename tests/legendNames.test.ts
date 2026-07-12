import { describe, expect, it } from "vitest";
import { legendFromImageUrl, legendImageUrl } from "../src/shared/legendImages";
import { canonicalLegendName, isCanonicalLegendName, normalizeLegendName } from "../src/shared/legendNames";

describe("normalizeLegendName", () => {
  it("normalizes subtitle-only legend captures to primary legend names", () => {
    expect(normalizeLegendName("Gloomist")).toBe("Vex");
    expect(normalizeLegendName("Bloodharbor Ripper")).toBe("Pyke");
    expect(normalizeLegendName("Loose Cannon")).toBe("Jinx");
    expect(normalizeLegendName("Blade Dancer")).toBe("Irelia");
    expect(normalizeLegendName("Vex Gloomist")).toBe("Vex");
  });

  it("keeps Master Yi legend variants distinct", () => {
    expect(normalizeLegendName("Wuju Bladesman - Starter")).toBe("Master Yi, Wuju Bladesman");
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
    expect(normalizeLegendName("Matriarch of War")).toBe("Ambessa");
    expect(normalizeLegendName("Defender of Tomorrow")).toBe("Jayce");
    expect(normalizeLegendName("Heart of the Tempest")).toBe("Kennen");
    expect(normalizeLegendName("Newly Awakened")).toBe("Mel");
    expect(normalizeLegendName("Aspect of the Jackal")).toBe("Nasus");
    expect(normalizeLegendName("Butcher of the Desert")).toBe("Renekton");
    expect(normalizeLegendName("Mechanized Menace")).toBe("Rumble");
    expect(normalizeLegendName("Eye of Twilight")).toBe("Shen");
    expect(normalizeLegendName("Master of Shadows")).toBe("Zed");
  });

  it("resolves Vendetta legend image codes from Atlas URLs", () => {
    expect(legendFromImageUrl("https://assets.riftatlas-workers.com/riftbound/cards/small-v2/VEN-153.webp")).toBe("Ambessa");
    expect(legendFromImageUrl("https://assets.riftatlas-workers.com/riftbound/cards/small-v2/VEN-139.webp")).toBe("Akali");
    expect(legendFromImageUrl("https://assets.riftatlas-workers.com/riftbound/cards/small-v2/VEN-190.webp")).toBe("Renekton");
    expect(legendFromImageUrl("https://assets.riftatlas-workers.com/riftbound/cards/small-v2/VEN-149.webp")).toBe("Jayce");
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
