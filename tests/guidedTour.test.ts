import { describe, expect, it } from "vitest";

import {
  GUIDED_TOUR_CONTENT_VERSION,
  GUIDED_TOUR_LOCAL_STORAGE_KEY,
  GUIDED_TOUR_PERSISTENCE_VERSION,
  GUIDED_TOUR_STEPS,
  completeGuidedTour,
  currentGuidedTourStep,
  guidedTourProgress,
  initialGuidedTourState,
  nextGuidedTourStep,
  parseGuidedTourState,
  previousGuidedTourStep,
  replayGuidedTour,
  resetGuidedTour,
  serializeGuidedTourState,
  skipGuidedTour,
  type GuidedTourState
} from "../src/shared/guidedTour.js";

describe("first-launch guided tour", () => {
  it("defines a stable ordered tour through the new information architecture", () => {
    expect(GUIDED_TOUR_STEPS.map((step) => step.id)).toEqual([
      "home",
      "play",
      "review",
      "prepare",
      "community",
      "utilities"
    ]);
    expect(GUIDED_TOUR_STEPS.map((step) => step.target)).toEqual([
      { view: "home" },
      { view: "play" },
      { view: "matches" },
      { view: "decks", deckFocus: "library" },
      { view: "community", communityTab: "legend-meta" },
      { view: "account" }
    ]);
  });

  it("starts a first launch on the first active step", () => {
    const state = initialGuidedTourState();

    expect(state).toEqual({
      persistenceVersion: GUIDED_TOUR_PERSISTENCE_VERSION,
      tourVersion: GUIDED_TOUR_CONTENT_VERSION,
      status: "active",
      currentStepId: "home"
    });
    expect(currentGuidedTourStep(state)?.id).toBe("home");
    expect(GUIDED_TOUR_LOCAL_STORAGE_KEY).toBe("riftlite.ui.guided-tour");
  });

  it("moves forward in order and completes after the final step", () => {
    let state = initialGuidedTourState();
    const visited = [state.currentStepId];

    for (let index = 1; index < GUIDED_TOUR_STEPS.length; index += 1) {
      state = nextGuidedTourStep(state);
      visited.push(state.currentStepId);
    }

    expect(visited).toEqual(GUIDED_TOUR_STEPS.map((step) => step.id));
    expect(state.status).toBe("active");
    expect(nextGuidedTourStep(state)).toEqual({
      ...state,
      status: "completed"
    });
  });

  it("moves back without underflowing the first step", () => {
    const first = initialGuidedTourState();
    expect(previousGuidedTourStep(first)).toBe(first);

    const second = nextGuidedTourStep(first);
    expect(previousGuidedTourStep(second)).toEqual(first);
  });

  it("skips from the current position and stops exposing an active step", () => {
    const second = nextGuidedTourStep(initialGuidedTourState());
    const skipped = skipGuidedTour(second);

    expect(skipped).toEqual({ ...second, status: "skipped" });
    expect(currentGuidedTourStep(skipped)).toBeNull();
    expect(nextGuidedTourStep(skipped)).toBe(skipped);
    expect(previousGuidedTourStep(skipped)).toBe(skipped);
    expect(completeGuidedTour(skipped)).toBe(skipped);
  });

  it("can complete explicitly from any active step", () => {
    const completed = completeGuidedTour(initialGuidedTourState());

    expect(completed.status).toBe("completed");
    expect(completed.currentStepId).toBe("utilities");
    expect(currentGuidedTourStep(completed)).toBeNull();
  });

  it("reports progress for the first, middle, final, skipped, and completed states", () => {
    const first = initialGuidedTourState();
    const middle = nextGuidedTourStep(nextGuidedTourStep(first));
    const final = advanceToLast(first);

    expect(guidedTourProgress(first)).toEqual({ current: 1, total: 6, percent: 17, isFirst: true, isLast: false });
    expect(guidedTourProgress(middle)).toEqual({ current: 3, total: 6, percent: 50, isFirst: false, isLast: false });
    expect(guidedTourProgress(final)).toEqual({ current: 6, total: 6, percent: 100, isFirst: false, isLast: true });
    expect(guidedTourProgress(skipGuidedTour(middle))).toEqual({ current: 3, total: 6, percent: 50, isFirst: false, isLast: false });
    expect(guidedTourProgress(completeGuidedTour(middle))).toEqual({ current: 6, total: 6, percent: 100, isFirst: false, isLast: true });
  });

  it.each(["active", "skipped", "completed"] as const)(
    "round-trips a valid %s state through local persistence",
    (status) => {
      const base = nextGuidedTourStep(initialGuidedTourState());
      const state = status === "active"
        ? base
        : status === "skipped"
          ? skipGuidedTour(base)
          : completeGuidedTour(base);

      expect(parseGuidedTourState(serializeGuidedTourState(state))).toEqual(state);
    }
  );

  it("accepts a validated stored object without requiring a storage or cloud adapter", () => {
    const stored = {
      persistenceVersion: 1,
      tourVersion: 1,
      status: "active",
      currentStepId: "prepare",
      ignoredFutureField: true
    };

    expect(parseGuidedTourState(stored)).toEqual({
      persistenceVersion: 1,
      tourVersion: 1,
      status: "active",
      currentStepId: "prepare"
    });
  });

  it.each([
    null,
    undefined,
    "",
    "not json",
    "null",
    "[]",
    "42",
    {},
    [],
    42,
    { persistenceVersion: 2, tourVersion: 1, status: "completed", currentStepId: "utilities" },
    { persistenceVersion: 1, tourVersion: 2, status: "completed", currentStepId: "utilities" },
    { persistenceVersion: 1, tourVersion: 1, status: "unknown", currentStepId: "home" },
    { persistenceVersion: 1, tourVersion: 1, status: "active", currentStepId: "missing-step" }
  ])("safely resets invalid or unsupported stored state %#", (stored) => {
    expect(parseGuidedTourState(stored)).toEqual(initialGuidedTourState());
  });

  it("normalizes a completed stored state to the final step", () => {
    expect(parseGuidedTourState(JSON.stringify({
      persistenceVersion: 1,
      tourVersion: 1,
      status: "completed",
      currentStepId: "review"
    }))).toEqual({
      persistenceVersion: 1,
      tourVersion: 1,
      status: "completed",
      currentStepId: "utilities"
    });
  });

  it("resets and replays skipped or completed tours from the first step", () => {
    const skipped = skipGuidedTour(nextGuidedTourStep(initialGuidedTourState()));
    const completed = completeGuidedTour(initialGuidedTourState());

    expect(resetGuidedTour()).toEqual(initialGuidedTourState());
    expect(replayGuidedTour(skipped)).toEqual(initialGuidedTourState());
    expect(replayGuidedTour(completed)).toEqual(initialGuidedTourState());
  });
});

function advanceToLast(initial: GuidedTourState): GuidedTourState {
  let state = initial;
  while (!guidedTourProgress(state).isLast) {
    state = nextGuidedTourStep(state);
  }
  return state;
}
