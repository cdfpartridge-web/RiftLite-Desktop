import { describe, expect, it } from "vitest";
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
    expect(normalizeLegendName("Wuju Master")).toBe("Master Yi, Wuji Master");
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
});
