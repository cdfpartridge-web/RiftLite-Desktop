import { describe, expect, it } from "vitest";
import {
  COMMUNITY_SPOTLIGHT_IDS,
  COMMUNITY_SPOTLIGHT_THEMES,
  DEFAULT_COMMUNITY_SPOTLIGHT_THEME,
  communitySpotlightTheme
} from "../src/shared/communitySpotlightThemes";

describe("community spotlight themes", () => {
  it("defines a theme for every spotlight and no unknown entries", () => {
    expect(Object.keys(COMMUNITY_SPOTLIGHT_THEMES).sort()).toEqual([...COMMUNITY_SPOTLIGHT_IDS].sort());
    expect(COMMUNITY_SPOTLIGHT_IDS).toHaveLength(10);
  });

  it("uses valid six-digit CSS hex colors", () => {
    const themes = [...Object.values(COMMUNITY_SPOTLIGHT_THEMES), DEFAULT_COMMUNITY_SPOTLIGHT_THEME];

    for (const theme of themes) {
      expect(theme.primary).toMatch(/^#[0-9A-F]{6}$/);
      expect(theme.secondary).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("returns the curated theme for a normalized creator id", () => {
    expect(communitySpotlightTheme("  RIFTLAB ")).toEqual({
      primary: "#0F7AF2",
      secondary: "#DB2629"
    });
  });

  it.each(["unknown-creator", "", null, undefined, 42])(
    "uses the safe fallback for %j",
    (value) => {
      expect(communitySpotlightTheme(value)).toBe(DEFAULT_COMMUNITY_SPOTLIGHT_THEME);
    }
  );
});
