import { describe, expect, it } from "vitest";

import {
  FIRST_MATCH_ONBOARDING_LOCAL_STORAGE_KEY,
  FIRST_MATCH_ONBOARDING_VERSION,
  dismissFirstMatchOnboarding,
  firstMatchOnboardingAfterSavedMatch,
  firstMatchOnboardingAfterTour,
  initialFirstMatchOnboardingState,
  isSuccessfullySavedMatch,
  parseFirstMatchOnboardingState,
  reconcileFirstMatchOnboarding,
  serializeFirstMatchOnboardingState
} from "../src/shared/firstMatchOnboarding.js";
import type { MatchDraft } from "../src/shared/types.js";

const NOW = "2026-07-19T12:00:00.000Z";

function match(status: MatchDraft["status"], result: MatchDraft["result"]): MatchDraft {
  return { id: "match-1", status, result } as MatchDraft;
}

describe("first successfully saved match onboarding", () => {
  it("waits until the static tour is completed", () => {
    expect(initialFirstMatchOnboardingState("active", false, NOW).status).toBe("inactive");
    expect(initialFirstMatchOnboardingState("completed", false, NOW)).toEqual({
      version: FIRST_MATCH_ONBOARDING_VERSION,
      status: "pending",
      startedAt: NOW,
      completedAt: ""
    });
    expect(initialFirstMatchOnboardingState("skipped", false, NOW).status).toBe("dismissed");
  });

  it("only completes for a genuinely saved, resolved match", () => {
    const pending = initialFirstMatchOnboardingState("completed", false, NOW);

    expect(isSuccessfullySavedMatch(match("draft", "Win"))).toBe(false);
    expect(isSuccessfullySavedMatch(match("saved", "Incomplete"))).toBe(false);
    expect(firstMatchOnboardingAfterSavedMatch(pending, match("draft", "Win"), NOW)).toBe(pending);
    expect(firstMatchOnboardingAfterSavedMatch(pending, match("saved", "Win"), NOW)).toMatchObject({
      status: "completed",
      completedAt: NOW
    });
  });

  it("reconciles an existing saved match without replaying first-match prompts", () => {
    expect(reconcileFirstMatchOnboarding(null, "completed", [match("saved", "Loss")], NOW)).toMatchObject({
      status: "completed",
      completedAt: NOW
    });
  });

  it("moves from the guided tour into a pending first-match milestone", () => {
    const inactive = initialFirstMatchOnboardingState("active", false, NOW);
    expect(firstMatchOnboardingAfterTour(inactive, "completed", [], NOW)).toMatchObject({
      status: "pending",
      startedAt: NOW
    });
  });

  it("persists valid state and safely rejects malformed state", () => {
    const dismissed = dismissFirstMatchOnboarding();
    expect(parseFirstMatchOnboardingState(serializeFirstMatchOnboardingState(dismissed))).toEqual(dismissed);
    expect(parseFirstMatchOnboardingState("not-json")).toBeNull();
    expect(parseFirstMatchOnboardingState({ version: 2, status: "pending" })).toBeNull();
    expect(FIRST_MATCH_ONBOARDING_LOCAL_STORAGE_KEY).toBe("riftlite.ui.first-match-onboarding");
  });
});
