import { describe, expect, it } from "vitest";

import {
  completeSideboardLabTrainingSession,
  initialSideboardLabTrainingState,
  parseSideboardLabTrainingState,
  recordSideboardLabTrainingAnswer,
  resetSideboardLabActiveRun,
  serializeSideboardLabTrainingState,
  sideboardLabReviewAnswerIds
} from "../src/shared/sideboardLabTraining.js";

const answer = {
  drillId: "sl1_example",
  answeredAt: "2026-08-14T09:00:00.000Z",
  playerLegendCode: "OGN-001",
  opponentLegendCode: "VEN-145",
  priorGameResult: "loss" as const,
  targetGameNumber: 2 as const,
  confidence: "unsure" as const,
  evidenceTier: "challenge" as const,
  review: { dueAt: "2026-08-15T09:00:00.000Z", intervalDays: 1, successfulReviews: 0 },
  decisionMs: 15_000,
  plan: { in: { "OGN-020": 2 }, out: { "OGN-002": 2 } },
  summary: { aligned: 1, different: 1, ungraded: 0, notableAlternatives: 2, noChanges: false }
};

describe("Sideboard Lab local training state", () => {
  it("fails closed to a fresh local state for malformed or future payloads", () => {
    expect(parseSideboardLabTrainingState(null)).toEqual(initialSideboardLabTrainingState());
    expect(parseSideboardLabTrainingState("not-json")).toEqual(initialSideboardLabTrainingState());
    expect(parseSideboardLabTrainingState(JSON.stringify({ version: 99 }))).toEqual(initialSideboardLabTrainingState());
  });

  it("records answers, restores active decisions, and identifies review items", () => {
    const state = recordSideboardLabTrainingAnswer(initialSideboardLabTrainingState(), answer, "daily-pack-a");
    expect(state.answers).toHaveLength(1);
    expect(state.activeRunKey).toBe("daily-pack-a");
    expect(state.activeDecisions).toEqual({ sl1_example: answer.plan });
    expect(sideboardLabReviewAnswerIds(state)).toEqual(["sl1_example"]);
    expect(parseSideboardLabTrainingState(serializeSideboardLabTrainingState(state))).toEqual(state);
  });

  it("replaces a repeated drill answer instead of inflating history", () => {
    const first = recordSideboardLabTrainingAnswer(initialSideboardLabTrainingState(), answer);
    const second = recordSideboardLabTrainingAnswer(first, {
      ...answer,
      answeredAt: "2026-08-14T10:00:00.000Z",
      confidence: "certain",
      review: null,
      summary: { aligned: 2, different: 0, ungraded: 0, notableAlternatives: 0, noChanges: false }
    });
    expect(second.answers).toHaveLength(1);
    expect(second.answers[0]?.summary.aligned).toBe(2);
    expect(sideboardLabReviewAnswerIds(second)).toEqual([]);
  });

  it("isolates resumable decisions when the pack or mode run key changes", () => {
    const first = recordSideboardLabTrainingAnswer(initialSideboardLabTrainingState(), answer, "daily-pack-a");
    const second = recordSideboardLabTrainingAnswer(first, {
      ...answer,
      drillId: "sl1_other",
      answeredAt: "2026-08-14T10:00:00.000Z"
    }, "matchup-pack-b");
    expect(second.activeRunKey).toBe("matchup-pack-b");
    expect(second.activeDecisions).toEqual({ sl1_other: answer.plan });
    expect(second.answers.map((item) => item.drillId)).toEqual(["sl1_example", "sl1_other"]);
  });

  it("keeps legacy v1 decisions unbound so they cannot resume into a different pack", () => {
    const legacy = parseSideboardLabTrainingState(JSON.stringify({
      version: 1,
      answers: [answer],
      sessions: [],
      activeDecisions: { sl1_example: answer.plan }
    }));
    expect(legacy.activeRunKey).toBe("");
    expect(legacy.activeDecisions).toEqual({ sl1_example: answer.plan });
  });

  it("completes a session and clears only the resumable run", () => {
    const active = recordSideboardLabTrainingAnswer(initialSideboardLabTrainingState(), answer);
    const completed = completeSideboardLabTrainingSession(active, {
      id: "session-20260814",
      completedAt: "2026-08-14T10:10:00.000Z",
      drillIds: [answer.drillId],
      aligned: 1,
      different: 1,
      notableAlternatives: 2
    });
    expect(completed.sessions).toHaveLength(1);
    expect(completed.answers).toHaveLength(1);
    expect(completed.activeRunKey).toBe("");
    expect(completed.activeDecisions).toEqual({});
    expect(resetSideboardLabActiveRun(active).activeRunKey).toBe("");
    expect(resetSideboardLabActiveRun(active).activeDecisions).toEqual({});
  });

  it("drops invalid card quantities instead of trusting corrupted local state", () => {
    const corrupted = JSON.stringify({
      version: 1,
      answers: [{ ...answer, plan: { in: { "OGN-020": 99 }, out: {} } }],
      sessions: [],
      activeDecisions: { bad: { in: { "OGN-020": -1 }, out: {} } }
    });
    expect(parseSideboardLabTrainingState(corrupted)).toEqual(initialSideboardLabTrainingState());
  });
});
