import { describe, expect, it } from "vitest";

import {
  SIDEBOARD_LAB_INTRO_LOCAL_STORAGE_KEY,
  SIDEBOARD_LAB_INTRO_VERSION,
  initialSideboardLabIntroState,
  parseSideboardLabIntroState,
  seenSideboardLabIntroState,
  serializeSideboardLabIntroState
} from "../src/shared/sideboardLabIntro.js";

describe("Sideboard Lab first-use introduction", () => {
  it("starts pending under its own versioned storage key", () => {
    expect(SIDEBOARD_LAB_INTRO_LOCAL_STORAGE_KEY).toBe("riftlite.ui.sideboard-lab-intro");
    expect(initialSideboardLabIntroState()).toEqual({ version: SIDEBOARD_LAB_INTRO_VERSION, status: "pending" });
  });

  it.each(["pending", "seen"] as const)("round-trips the supported %s state", (status) => {
    const state = status === "seen" ? seenSideboardLabIntroState() : initialSideboardLabIntroState();
    expect(parseSideboardLabIntroState(serializeSideboardLabIntroState(state))).toEqual(state);
    expect(parseSideboardLabIntroState(state)).toEqual(state);
  });

  it.each([
    null,
    undefined,
    "",
    "not-json",
    "[]",
    {},
    [],
    { version: 1, status: "seen" },
    { version: 2, status: "unknown" }
  ])("fails safely to a pending guide for unsupported persisted state: %#", (stored) => {
    expect(parseSideboardLabIntroState(stored)).toEqual(initialSideboardLabIntroState());
  });

  it("marks the introduction seen without affecting another guide", () => {
    expect(seenSideboardLabIntroState()).toEqual({ version: SIDEBOARD_LAB_INTRO_VERSION, status: "seen" });
    expect(SIDEBOARD_LAB_INTRO_LOCAL_STORAGE_KEY).not.toContain("mulligan");
  });
});
