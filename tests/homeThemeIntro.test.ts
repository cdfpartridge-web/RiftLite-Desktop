import { describe, expect, it } from "vitest";
import {
  HOME_THEME_INTRO_LOCAL_STORAGE_KEY,
  HOME_THEME_INTRO_VERSION,
  initialHomeThemeIntroState,
  parseHomeThemeIntroState,
  seenHomeThemeIntroState,
  serializeHomeThemeIntroState
} from "../src/shared/homeThemeIntro.js";

describe("Home deck theme introduction", () => {
  it("starts as a one-time pending opt-in", () => {
    expect(HOME_THEME_INTRO_LOCAL_STORAGE_KEY).toBe("riftlite.ui.home-deck-theme-intro");
    expect(initialHomeThemeIntroState()).toEqual({ version: HOME_THEME_INTRO_VERSION, status: "pending" });
  });

  it("round-trips the seen state", () => {
    const seen = seenHomeThemeIntroState();
    expect(parseHomeThemeIntroState(serializeHomeThemeIntroState(seen))).toEqual(seen);
    expect(parseHomeThemeIntroState(seen)).toEqual(seen);
  });

  it.each([
    null,
    undefined,
    "",
    "not-json",
    {},
    [],
    { version: 2, status: "seen" },
    { version: 1, status: "pending" },
    { version: 1, status: "unknown" }
  ])("treats missing, malformed, or unsupported state as unseen: %#", (stored) => {
    expect(parseHomeThemeIntroState(stored)).toEqual(initialHomeThemeIntroState());
  });
});
