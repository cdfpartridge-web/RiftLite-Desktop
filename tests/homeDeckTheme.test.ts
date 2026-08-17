import { describe, expect, it } from "vitest";
import {
  HOME_DECK_DOMAIN_COLORS,
  HOME_DECK_THEMES,
  homeDeckThemeForLegend
} from "../src/shared/homeDeckTheme";
import { CANONICAL_LEGEND_NAMES } from "../src/shared/legendNames";

describe("Home deck themes", () => {
  it("resolves every currently recognised legend to a domain palette", () => {
    for (const legend of CANONICAL_LEGEND_NAMES) {
      expect(homeDeckThemeForLegend(legend), legend).not.toBeNull();
    }
  });

  it.each([
    ["Draven", "fury-chaos", ["Fury", "Chaos"], "#e85a5a", "#9a72ff"],
    ["Irelia", "calm-chaos", ["Calm", "Chaos"], "#4fd19a", "#9a72ff"],
    ["Akali", "fury-calm", ["Fury", "Calm"], "#e85a5a", "#4fd19a"],
    ["Kennen", "order-chaos", ["Order", "Chaos"], "#e4c85f", "#9a72ff"]
  ])("keeps %s on its canonical %s pairing", (legend, id, domains, primary, secondary) => {
    expect(homeDeckThemeForLegend(legend)).toMatchObject({ id, domains, primary, secondary });
  });

  it("matches the complete upstream legend-domain grouping", () => {
    const expectedLegendsByTheme = {
      "calm-mind": ["Ahri", "Lillia", "Nasus", "Ornn"],
      "fury-calm": ["Akali"],
      "body-order": ["Ambessa", "Fiora", "Garen", "Poppy", "Sett"],
      "fury-chaos": ["Annie", "Draven", "Jinx", "Pyke", "Zed"],
      "calm-order": ["Azir", "Ivern", "Leona", "Shen"],
      "fury-order": ["Darius", "Rek'Sai", "Vi"],
      "mind-chaos": ["Diana", "Ezreal", "Mel", "Teemo"],
      "calm-chaos": ["Irelia", "Vex", "Yasuo"],
      "body-calm": ["Jax", "Lee Sin", "Master Yi", "Master Yi, Wuju Master", "Master Yi, Wuju Bladesman"],
      "body-mind": ["Jayce"],
      "fury-mind": ["Jhin", "Kai'Sa", "Rumble"],
      "order-chaos": ["Kennen"],
      "mind-order": ["LeBlanc", "Lux", "Renata Glasc", "Viktor"],
      "fury-body": ["Lucian", "Renekton", "Rengar", "Volibear"],
      "body-chaos": ["Kha'Zix", "Miss Fortune", "Sivir"]
    } as const;
    for (const [themeId, legends] of Object.entries(expectedLegendsByTheme)) {
      for (const legend of legends) {
        expect(homeDeckThemeForLegend(legend)?.id, legend).toBe(themeId);
      }
    }
  });

  it("shares one theme object between legends with the same domains", () => {
    expect(homeDeckThemeForLegend("Draven")).toBe(homeDeckThemeForLegend("Annie"));
    expect(homeDeckThemeForLegend("Irelia")).toBe(homeDeckThemeForLegend("Yasuo"));
    expect(homeDeckThemeForLegend("Master Yi, Wuju Bladesman")).toBe(homeDeckThemeForLegend("Lee Sin"));
  });

  it("keeps all six domain colours distinct and all 15 pairings valid", () => {
    expect(Object.keys(HOME_DECK_DOMAIN_COLORS)).toEqual(["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
    expect(new Set(Object.values(HOME_DECK_DOMAIN_COLORS).map((colour) => colour.hex))).toHaveLength(6);
    expect(Object.keys(HOME_DECK_THEMES)).toHaveLength(15);
    for (const theme of Object.values(HOME_DECK_THEMES)) {
      expect(theme.primary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.secondary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.buttonStart).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.buttonEnd).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.primary).not.toBe(theme.secondary);
      expect(theme.primaryRgb).not.toBe(theme.secondaryRgb);
    }
  });

  it("preserves the restrained Draven control treatment", () => {
    expect(HOME_DECK_THEMES["fury-chaos"]).toMatchObject({
      buttonStart: "#994d67",
      buttonEnd: "#665084",
      buttonText: "#fff7fb"
    });
  });

  it("keeps unsupported and missing legends on RiftLite's default theme", () => {
    expect(homeDeckThemeForLegend("Sona")).toBeNull();
    expect(homeDeckThemeForLegend("")).toBeNull();
    expect(homeDeckThemeForLegend(null)).toBeNull();
  });
});
