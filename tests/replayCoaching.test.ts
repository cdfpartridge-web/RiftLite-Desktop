import { describe, expect, it } from "vitest";

import {
  REPLAY_COACHING_STORAGE_VERSION,
  createReplayCoachingFocus,
  defineReplayCoachingExperiment,
  isReplayCoachingGameEligible,
  parseReplayCoachingStore,
  recordReplayCoachingGame,
  reflectOnReplayInsight,
  replayCoachingCanTransition,
  replayCoachingProcessMetrics,
  replayCoachingProgress,
  serializeReplayCoachingStore,
  startReplayCoachingExperiment,
  transitionReplayCoachingFocus,
  type ReplayCoachingFocus,
  type ReplayCoachingGameSnapshot
} from "../src/shared/replayCoaching.js";

const START = "2026-08-25T12:00:00.000Z";

function newFocus(): ReplayCoachingFocus {
  return createReplayCoachingFocus({
    id: "focus-1",
    now: START,
    insight: {
      id: "pattern:late-charm",
      title: "Charm regularly waits after being kept",
      action: "Test redrawing Charm in faster matchups.",
      confidence: "confirmed",
      sampleSize: 8,
      cardName: "Charm",
      cardId: "OGN-173"
    },
    report: {
      generatedAt: START,
      gamesAnalyzed: 24,
      coverageGrade: "high",
      scope: { deckKey: "Ahri Tempo", opponentLegend: "Jinx" }
    },
    eligibility: { gameStage: "preboard", initiative: "1st" }
  });
}

function game(id: string, patch: Partial<ReplayCoachingGameSnapshot> = {}): ReplayCoachingGameSnapshot {
  return {
    id,
    capturedAt: `2026-08-${25 + Number(id.replace(/\D/g, "") || 0)}T12:00:00.000Z`,
    deckKey: "ahri tempo",
    opponentLegend: " jinx ",
    gameNumber: 1,
    initiative: "1st",
    result: "Win",
    ...patch
  };
}

function testingFocus(targetEligibleGames = 3): ReplayCoachingFocus {
  const reflected = reflectOnReplayInsight(newFocus(), "missed", "I kept it without an early plan.", START);
  const hypothesized = defineReplayCoachingExperiment(reflected, {
    hypothesis: "A faster redraw improves the opening plan.",
    process: "Redraw Charm unless the hand already has a turn-two play.",
    successSignal: "Follow the rule whenever the opening presents the decision.",
    targetEligibleGames,
    baseline: { eligibleGames: 6, followed: 2, missed: 3, unsure: 1 }
  }, START);
  return startReplayCoachingExperiment(hypothesized, START);
}

describe("Replay coaching", () => {
  it("copies renderer-independent insight/report snapshots and merges eligibility scope", () => {
    const focus = newFocus();

    expect(focus).toMatchObject({
      id: "focus-1",
      status: "new",
      eligibility: {
        deckKey: "Ahri Tempo",
        opponentLegend: "Jinx",
        gameStage: "preboard",
        initiative: "1st"
      },
      insight: { id: "pattern:late-charm", sampleSize: 8, cardName: "Charm", cardId: "OGN-173" },
      report: { gamesAnalyzed: 24, coverageGrade: "high" }
    });
    expect(focus.statusHistory).toEqual([{ status: "new", recordedAt: START }]);
  });

  it("records each reflection and moves a new finding into reviewed state", () => {
    const values = ["intentional", "missed", "forced", "unsure", "wrong", "already-understood"] as const;
    for (const value of values) {
      const focus = reflectOnReplayInsight(newFocus(), value, "Context note", START);
      expect(focus.status).toBe("reviewed");
      expect(focus.reflection).toEqual({ value, note: "Context note", recordedAt: START });
    }
  });

  it("enforces the lifecycle while keeping an invalid stale transition as a no-op", () => {
    expect(replayCoachingCanTransition("new", "reviewed")).toBe(true);
    expect(replayCoachingCanTransition("new", "learned")).toBe(false);

    const focus = newFocus();
    expect(transitionReplayCoachingFocus(focus, "learned", undefined, START)).toBe(focus);
    const paused = transitionReplayCoachingFocus(focus, "paused", "Come back later", START);
    expect(paused).toMatchObject({ status: "paused" });
    expect(paused.statusHistory.at(-1)).toMatchObject({ status: "paused", note: "Come back later" });
  });

  it("matches eligible games by normalized deck/opponent plus stage and initiative", () => {
    const scope = newFocus().eligibility;
    expect(isReplayCoachingGameEligible(scope, game("1"))).toBe(true);
    expect(isReplayCoachingGameEligible(scope, game("2", { opponentLegend: "Viktor" }))).toBe(false);
    expect(isReplayCoachingGameEligible(scope, game("3", { gameNumber: 2 }))).toBe(false);
    expect(isReplayCoachingGameEligible(scope, game("4", { initiative: "2nd" }))).toBe(false);
    expect(isReplayCoachingGameEligible({ gameStage: "postboard" }, game("5", { gameNumber: 2 }))).toBe(true);
  });

  it("tracks only the next three to five eligible unique games", () => {
    let focus = testingFocus(99);
    expect(focus.experiment?.targetEligibleGames).toBe(5);

    const ineligible = recordReplayCoachingGame(focus, game("1", { opponentLegend: "Viktor" }), "followed", undefined, START);
    expect(ineligible).toMatchObject({ recorded: false, reason: "ineligible" });

    for (let index = 1; index <= 5; index += 1) {
      const result = recordReplayCoachingGame(focus, game(String(index)), index === 2 ? "missed" : "followed", undefined, START);
      expect(result.recorded).toBe(true);
      focus = result.focus;
    }
    expect(recordReplayCoachingGame(focus, game("5"), "followed", undefined, START)).toMatchObject({ recorded: false, reason: "duplicate" });
    expect(recordReplayCoachingGame(focus, game("6"), "followed", undefined, START)).toMatchObject({ recorded: false, reason: "target-complete" });
    expect(replayCoachingProgress(focus)).toMatchObject({ eligibleGamesTracked: 5, gamesRemaining: 0, readyForReview: true });
  });

  it("compares process adherence before and during without treating results as the goal", () => {
    let focus = testingFocus(3);
    for (const [id, adherence, result] of [
      ["1", "followed", "Loss"],
      ["2", "followed", "Win"],
      ["3", "not-applicable", "Loss"]
    ] as const) {
      focus = recordReplayCoachingGame(focus, game(id, { result }), adherence, undefined, START).focus;
    }

    expect(replayCoachingProcessMetrics({ eligibleGames: 2, followed: 1, missed: 1 })).toMatchObject({
      opportunities: 2,
      assessedOpportunities: 2,
      adherenceRate: 50
    });
    expect(replayCoachingProgress(focus)).toEqual({
      targetEligibleGames: 3,
      eligibleGamesTracked: 3,
      gamesRemaining: 0,
      readyForReview: true,
      before: {
        eligibleGames: 6,
        followed: 2,
        missed: 3,
        unsure: 1,
        notApplicable: 0,
        opportunities: 6,
        assessedOpportunities: 5,
        adherenceRate: 40
      },
      during: {
        eligibleGames: 3,
        followed: 2,
        missed: 0,
        unsure: 0,
        notApplicable: 1,
        opportunities: 2,
        assessedOpportunities: 2,
        adherenceRate: 100
      },
      adherenceDeltaPercentagePoints: 60,
      results: { wins: 1, losses: 2, draws: 0, incomplete: 0 }
    });
  });

  it("round-trips v1 local persistence without executable or unknown fields", () => {
    const focus = testingFocus();
    const source = {
      version: REPLAY_COACHING_STORAGE_VERSION,
      updatedAt: START,
      activeFocusId: focus.id,
      focuses: [{ ...focus, injected: "discard me" }]
    };
    const parsed = parseReplayCoachingStore(JSON.stringify(source), START);
    const roundTrip = JSON.parse(serializeReplayCoachingStore(parsed.store));

    expect(parsed).toMatchObject({ migrated: false, discardedFocuses: 0 });
    expect(parsed.store.activeFocusId).toBe(focus.id);
    expect(roundTrip.focuses[0].injected).toBeUndefined();
    expect(roundTrip.version).toBe(REPLAY_COACHING_STORAGE_VERSION);
  });

  it("safely migrates versionless legacy data and clamps oversized experiments", () => {
    const legacy = {
      activeFocusId: "legacy-focus",
      focuses: [{
        id: "legacy-focus",
        insightId: "legacy-insight",
        title: "Old finding",
        action: "Try the old plan",
        status: "active",
        reflection: "understood",
        scope: { deckKey: "Deck A", gameStage: "preboard" },
        hypothesis: "The plan helps",
        behavior: "Follow the plan",
        targetGames: 12,
        observations: Array.from({ length: 8 }, (_, index) => ({
          id: `legacy-game-${index}`,
          capturedAt: START,
          adherence: index ? "yes" : "n/a"
        }))
      }, { id: "broken" }]
    };
    const parsed = parseReplayCoachingStore(legacy, START);
    const focus = parsed.store.focuses[0]!;

    expect(parsed).toMatchObject({ migrated: true, discardedFocuses: 1 });
    expect(focus).toMatchObject({
      status: "testing",
      reflection: { value: "already-understood" },
      eligibility: { deckKey: "Deck A", gameStage: "preboard" },
      experiment: { targetEligibleGames: 5 }
    });
    expect(focus.experiment?.games).toHaveLength(5);
    expect(focus.experiment?.games[0]?.adherence).toBe("not-applicable");
  });

  it("returns an empty safe store for corrupt JSON", () => {
    expect(parseReplayCoachingStore("{not-json", START)).toEqual({
      store: { version: REPLAY_COACHING_STORAGE_VERSION, updatedAt: START, focuses: [] },
      migrated: false,
      discardedFocuses: 0
    });
  });
});
