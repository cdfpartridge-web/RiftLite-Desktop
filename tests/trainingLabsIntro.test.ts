import { describe, expect, it } from "vitest";

import {
  TRAINING_LABS_INTRO_LOCAL_STORAGE_KEY,
  TRAINING_LABS_INTRO_VERSION,
  initialTrainingLabsIntroState,
  parseTrainingLabsIntroState,
  seenTrainingLabsIntroState,
  serializeTrainingLabsIntroState
} from "../src/shared/trainingLabsIntro.js";

describe("Training Labs introduction", () => {
  it("starts pending once for users who have not seen this version", () => {
    expect(TRAINING_LABS_INTRO_LOCAL_STORAGE_KEY).toBe("riftlite.ui.training-labs-intro");
    expect(initialTrainingLabsIntroState()).toEqual({
      version: TRAINING_LABS_INTRO_VERSION,
      status: "pending"
    });
  });

  it.each(["pending", "seen"] as const)("round-trips valid %s state", (status) => {
    const state = status === "seen" ? seenTrainingLabsIntroState() : initialTrainingLabsIntroState();
    expect(parseTrainingLabsIntroState(serializeTrainingLabsIntroState(state))).toEqual(state);
    expect(parseTrainingLabsIntroState(state)).toEqual(state);
  });

  it.each([
    null,
    undefined,
    "",
    "not-json",
    {},
    [],
    { version: 2, status: "seen" },
    { version: 1, status: "unknown" }
  ])("fails safely to pending for missing or unsupported state: %#", (stored) => {
    expect(parseTrainingLabsIntroState(stored)).toEqual(initialTrainingLabsIntroState());
  });
});
