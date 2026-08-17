import { describe, expect, it } from "vitest";

import {
  MULLIGAN_LAB_INTRO_LOCAL_STORAGE_KEY,
  MULLIGAN_LAB_INTRO_VERSION,
  initialMulliganLabIntroState,
  parseMulliganLabIntroState,
  reopenMulliganLabIntro,
  resetMulliganLabIntro,
  seenMulliganLabIntroState,
  serializeMulliganLabIntroState
} from "../src/shared/mulliganLabIntro.js";

describe("Mulligan Lab introduction", () => {
  it("starts pending for a first-time visitor", () => {
    expect(MULLIGAN_LAB_INTRO_LOCAL_STORAGE_KEY).toBe("riftlite.ui.mulligan-lab-intro");
    expect(initialMulliganLabIntroState()).toEqual({
      version: MULLIGAN_LAB_INTRO_VERSION,
      status: "pending"
    });
  });

  it.each(["pending", "seen"] as const)("round-trips a valid %s state", (status) => {
    const state = status === "seen" ? seenMulliganLabIntroState() : initialMulliganLabIntroState();

    expect(parseMulliganLabIntroState(serializeMulliganLabIntroState(state))).toEqual(state);
    expect(parseMulliganLabIntroState(state)).toEqual(state);
  });

  it("accepts valid state objects while discarding unrelated fields", () => {
    expect(parseMulliganLabIntroState({
      version: 1,
      status: "seen",
      ignoredFutureField: true
    })).toEqual(seenMulliganLabIntroState());
  });

  it.each([
    null,
    undefined,
    "",
    "not-json",
    "null",
    "[]",
    "42",
    {},
    [],
    42,
    { version: 2, status: "seen" },
    { version: 1, status: "unknown" },
    { version: "1", status: "seen" }
  ])("safely returns a pending intro for invalid or unsupported state: %#", (stored) => {
    expect(parseMulliganLabIntroState(stored)).toEqual(initialMulliganLabIntroState());
  });

  it("can be reopened after it has been seen", () => {
    expect(reopenMulliganLabIntro(seenMulliganLabIntroState())).toEqual(initialMulliganLabIntroState());
  });

  it("can be reset independently of persisted state", () => {
    expect(resetMulliganLabIntro()).toEqual(initialMulliganLabIntroState());
  });
});
