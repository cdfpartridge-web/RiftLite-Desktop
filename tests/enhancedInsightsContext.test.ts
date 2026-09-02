import { describe, expect, it } from "vitest";
import {
  buildEnhancedInsightsContext,
  type EnhancedInsightMatchContext,
  type EnhancedInsightPlayerDecisionContext
} from "../src/shared/enhancedInsightsContext";
import { emptyDeckMatchupGuide } from "../src/shared/deckNotebook";
import type {
  ReplayLearningCapabilityReceipt,
  ReplayLearningCapabilityState
} from "../src/shared/replayLearningSignals";
import type {
  DeckGuideCardRef,
  DeckNotebook,
  InsightNotebookSnapshot,
  ReplayFlag,
  ReplayRecord,
  ReplayStructuredEvent
} from "../src/shared/types";

function replay(flags: ReplayFlag[] = []): ReplayRecord {
  return {
    id: "replay-1",
    matchId: "match-1",
    platform: "atlas",
    capturedAt: "2026-08-31T10:00:00.000Z",
    title: "Akali vs Annie",
    players: { me: "Player", opponent: "Opponent" },
    events: [],
    flags,
    matchSnapshot: {
      id: "match-1",
      capturedAt: "2026-08-31T10:00:00.000Z",
      platform: "atlas",
      status: "saved",
      mode: "Ranked",
      format: "Bo3",
      myChampion: "Akali, the Rogue Assassin",
      opponentChampion: "Annie, Dark Child",
      result: "Loss",
      notes: "",
      flags: "",
      games: [{ gameNumber: 1, result: "Loss", wentFirst: "1st", notes: "" }],
      rawEvidence: [],
      sync: { community: "disabled", hubs: {}, teams: {} }
    }
  };
}

function flag(overrides: Partial<ReplayFlag> = {}): ReplayFlag {
  return {
    id: "flag-1",
    targetType: "video-time",
    targetId: "12000",
    targetLabel: "0:12",
    type: "mistake",
    label: "Turn two sequence",
    note: "I forgot the resource constraint",
    capturedAt: "2026-08-31T10:00:12.000Z",
    createdAt: "2026-08-31T10:10:00.000Z",
    timeMs: 12_000,
    ...overrides
  };
}

function structuredEvent(
  id: string,
  capturedAt: string,
  gameNumber: number
): ReplayStructuredEvent {
  return {
    id,
    sourceEventId: id,
    gameNumber,
    capturedAt,
    labelTime: "10:00",
    type: "action",
    side: "me",
    text: id,
    cardName: "",
    destination: "",
    battlefield: ""
  };
}

type CapabilityKey = Exclude<keyof ReplayLearningCapabilityReceipt, "replayId">;

function capabilities(overrides: Partial<Record<CapabilityKey, ReplayLearningCapabilityState>> = {}): ReplayLearningCapabilityReceipt {
  const value = (key: CapabilityKey) => ({
    state: overrides[key] ?? "unknown",
    evidenceCount: overrides[key] === "available" ? 3 : 0,
    detail: `${key} receipt`
  });
  return {
    replayId: "replay-1",
    openingHand: value("openingHand"),
    cardTiming: value("cardTiming"),
    resources: value("resources"),
    sideboard: value("sideboard"),
    combat: value("combat"),
    battlefield: value("battlefield")
  };
}

function card(name: string): DeckGuideCardRef {
  return {
    id: `guide-card-${name}`,
    cardKey: name.toLocaleLowerCase().replace(/\s+/g, "-"),
    cardName: name,
    cardId: `OGN-${name.length}`,
    qty: 1
  };
}

function notebook(): DeckNotebook {
  const defaultGuide = emptyDeckMatchupGuide("");
  const matchup = emptyDeckMatchupGuide("Annie, Dark Child");
  matchup.updatedAt = "2026-08-30T09:00:00.000Z";
  matchup.mulligan.keep.cards = [card("Early Unit")];
  matchup.mulligan.avoid.cards = [card("Slow Spell")];
  matchup.sideboard.in.cards = [card("Shield Breaker")];
  matchup.sideboard.out.cards = [card("Greedy Engine")];
  matchup.battlefields.game1First.cards = [card("The Grand Plaza")];
  return {
    deckId: "deck-1",
    updatedAt: "2026-08-30T09:00:00.000Z",
    goals: [
      { id: "goal-1", text: "Build a clearer turn-two plan", status: "Active", createdAt: "2026-08-29T09:00:00.000Z" },
      { id: "goal-done", text: "Old goal", status: "Done", createdAt: "2026-08-01T09:00:00.000Z" }
    ],
    versions: [],
    watchlist: [],
    defaultGuide,
    matchupGuides: [matchup]
  };
}

function notebookSnapshot(source = notebook()): InsightNotebookSnapshot {
  const guide = source.matchupGuides[0] ?? source.defaultGuide;
  return {
    deckId: source.deckId,
    opponentLegend: "Annie",
    guide: JSON.parse(JSON.stringify(guide)) as InsightNotebookSnapshot["guide"],
    guideSource: source.matchupGuides[0] ? "matchup" : "default",
    goals: source.goals
      .filter((goal) => goal.status === "Active")
      .map(({ id, text, createdAt, updatedAt }) => ({ id, text, createdAt, ...(updatedAt ? { updatedAt } : {}) })),
    capturedAt: "2026-08-31T10:00:00.000Z"
  };
}

function context(overrides: Partial<EnhancedInsightPlayerDecisionContext> = {}): EnhancedInsightPlayerDecisionContext {
  return {
    id: "decision-1",
    replayId: "replay-1",
    decision: "mulligan-keep",
    capturedAt: "2026-08-31T10:00:02.000Z",
    videoTimeMs: 2_000,
    gameNumber: 1,
    initiative: "1st",
    subject: { cardName: "Slow Spell", cardKey: "slow-spell" },
    ...overrides
  };
}

describe("enhanced Insights context", () => {
  it("keeps unknown capabilities explicit and turns player flags into review questions", () => {
    const source = replay([flag()]);
    const report = buildEnhancedInsightsContext({ replay: source });

    expect(report.evidenceReceipt.state).toBe("player-context-only");
    expect(report.evidenceReceipt.capabilities).toHaveLength(6);
    expect(report.evidenceReceipt.capabilities.every((item) => item.state === "unknown")).toBe(true);
    expect(report.evidenceReceipt.limitations.join(" ")).toContain("Unknown means uncaptured");
    expect(report.reviewCandidates[0]).toMatchObject({
      kind: "flag-review",
      basis: "player-authored",
      verdict: "review-question",
      evidenceState: "player-authored"
    });
    expect(report.reviewCandidates[0]?.observation).toContain("labelled as a mistake by the player");
    expect(report.reviewCandidates[0]?.evidence[0]).toMatchObject({
      source: "replay-flag",
      id: "flag-1",
      videoTimeMs: 12_000
    });
  });

  it("reports an exact saved-plan deviation without declaring the play incorrect", () => {
    const report = buildEnhancedInsightsContext({
      replay: replay([flag()]),
      notebook: notebook(),
      capabilityReceipt: capabilities({ openingHand: "available", cardTiming: "partial" }),
      decisionContexts: [context({ flagId: "flag-1", assessment: "intentional" })]
    });

    expect(report.planComparisons).toEqual([expect.objectContaining({
      status: "deviation",
      guideSource: "matchup",
      matchedSections: ["mulligan.avoid"]
    })]);
    expect(report.planDeviations[0]).toMatchObject({
      kind: "kept-avoid-card",
      savedPlanSection: "Mulligan · Avoid",
      subjectLabel: "Slow Spell"
    });
    expect(report.planDeviations[0]?.observation).toContain("while the saved matchup guide lists it under Avoid");
    expect(report.planDeviations[0]?.reviewQuestion).toContain("deliberate exception");
    expect(`${report.planDeviations[0]?.observation} ${report.planDeviations[0]?.reviewQuestion}`.toLowerCase()).not.toContain("optimal");
    expect(report.reviewCandidates[0]).toMatchObject({
      kind: "plan-deviation",
      basis: "saved-plan-comparison",
      evidenceState: "partial"
    });
    expect(report.reviewCandidates[0]?.evidence.map((item) => item.source)).toEqual([
      "player-context",
      "replay-flag",
      "saved-guide"
    ]);
  });

  it("prioritises a capture correction and skips plan comparison when the captured context is wrong", () => {
    const report = buildEnhancedInsightsContext({
      replay: replay([flag()]),
      notebook: notebook(),
      decisionContexts: [context({ flagId: "flag-1", assessment: "wrong" })]
    });

    expect(report.planComparisons).toEqual([]);
    expect(report.planDeviations).toEqual([]);
    expect(report.reviewCandidates[0]?.kind).toBe("capture-correction");
  });

  it("preserves linked rules checks instead of hiding them behind decision context", () => {
    const report = buildEnhancedInsightsContext({
      replay: replay([flag({ type: "rules-check", label: "Timing window" })]),
      notebook: notebook(),
      decisionContexts: [context({
        flagId: "flag-1",
        subject: { cardName: "Early Unit" },
        assessment: "intentional"
      })]
    });

    expect(report.reviewCandidates[0]).toMatchObject({ kind: "flag-review", priority: 94 });
    expect(report.reviewCandidates.some((candidate) => candidate.kind === "decision-review")).toBe(true);
  });

  it("records choices consistent with the guide without manufacturing a deviation", () => {
    const report = buildEnhancedInsightsContext({
      replay: replay(),
      notebook: notebook(),
      decisionContexts: [context({
        subject: { cardName: "Early Unit" },
        assessment: "intentional"
      })]
    });

    expect(report.planComparisons[0]?.status).toBe("consistent");
    expect(report.planDeviations).toEqual([]);
    expect(report.evidenceReceipt.savedPlan.consistent).toBe(1);
    expect(report.reviewCandidates.some((item) => item.kind === "plan-deviation")).toBe(false);
    expect(report.reviewCandidates.some((item) => item.kind === "decision-review")).toBe(true);
  });

  it.each([
    ["mulligan-redraw", "Early Unit", "redrew-keep-card"],
    ["sideboard-in", "Greedy Engine", "boarded-in-out-card"],
    ["sideboard-out", "Shield Breaker", "boarded-out-in-card"]
  ] as const)("compares %s decisions with the matching saved plan section", (decision, cardName, kind) => {
    const report = buildEnhancedInsightsContext({
      replay: replay(),
      notebook: notebook(),
      decisionContexts: [context({ decision, subject: { cardName } })]
    });

    expect(report.planDeviations[0]?.kind).toBe(kind);
    expect(report.planDeviations[0]?.reviewQuestion).toMatch(/exception|change|revising/i);
  });

  it.each(["mulligan-keep", "mulligan-redraw"] as const)("treats Mulligan Consider as neutral for %s", (decision) => {
    const sourceNotebook = notebook();
    sourceNotebook.matchupGuides[0]!.mulligan.keep.cards = [];
    sourceNotebook.matchupGuides[0]!.mulligan.avoid.cards = [];
    sourceNotebook.matchupGuides[0]!.mulligan.consider.cards = [card("Flexible Card")];
    const report = buildEnhancedInsightsContext({
      replay: replay(),
      notebook: sourceNotebook,
      decisionContexts: [context({ decision, subject: { cardName: "Flexible Card" } })]
    });

    expect(report.planComparisons[0]).toMatchObject({
      status: "not-covered",
      matchedSections: ["mulligan.consider"]
    });
    expect(report.evidenceReceipt.savedPlan.consistent).toBe(0);
    expect(report.planDeviations).toEqual([]);
  });

  it("surfaces conflicting saved-plan labels as a plan repair question", () => {
    const sourceNotebook = notebook();
    sourceNotebook.matchupGuides[0]!.mulligan.keep.cards.push(card("Slow Spell"));
    const report = buildEnhancedInsightsContext({
      replay: replay(),
      notebook: sourceNotebook,
      decisionContexts: [context()]
    });

    expect(report.planComparisons[0]?.status).toBe("conflict");
    expect(report.planDeviations[0]?.kind).toBe("saved-plan-conflict");
    expect(report.reviewCandidates[0]).toMatchObject({
      kind: "plan-deviation",
      priority: 96
    });
  });

  it("uses the initiative-specific battlefield priority and frames an unlisted pick as a plan exception", () => {
    const report = buildEnhancedInsightsContext({
      replay: replay(),
      notebook: notebook(),
      decisionContexts: [context({
        decision: "battlefield-pick",
        initiative: "1st",
        gameNumber: 1,
        subject: { battlefieldName: "The Arena" }
      })]
    });

    expect(report.planComparisons[0]).toMatchObject({
      status: "deviation",
      matchedSections: ["battlefields.game1First"]
    });
    expect(report.planDeviations[0]).toMatchObject({
      kind: "battlefield-outside-priority",
      savedPlanSection: "Game 1 going first"
    });
    expect(report.planDeviations[0]?.observation).toContain("names different battlefields");
  });

  it("does not assume an unnumbered battlefield decision happened in Game 1", () => {
    const report = buildEnhancedInsightsContext({
      replay: replay(),
      notebook: notebook(),
      decisionContexts: [context({
        decision: "battlefield-pick",
        initiative: "1st",
        gameNumber: undefined,
        subject: { battlefieldName: "The Arena" }
      })]
    });

    expect(report.planComparisons[0]).toMatchObject({ status: "not-covered", matchedSections: [] });
    expect(report.planDeviations).toEqual([]);
  });

  it("promotes capture correction over coaching when the player says the interpretation is wrong", () => {
    const report = buildEnhancedInsightsContext({
      replay: replay(),
      capabilityReceipt: capabilities({ resources: "available" }),
      decisionContexts: [context({
        decision: "resource-use",
        subject: undefined,
        assessment: "wrong",
        note: "The resource counter was stale"
      })]
    });

    expect(report.reviewCandidates[0]).toMatchObject({
      kind: "capture-correction",
      priority: 100,
      evidenceState: "available"
    });
    expect(report.reviewCandidates[0]?.observation).toContain("No coaching claim should rely on it");
  });

  it("uses active goals only as player-authored prompts and states that relevance was not inferred", () => {
    const report = buildEnhancedInsightsContext({
      replay: replay([flag({ type: "key-turn" })]),
      notebook: notebook(),
      matchInsightContext: {
        version: 1,
        capturedWithEnhancedInsights: true,
        activeGoalIds: ["goal-1"],
        decisions: [],
        notebookSnapshot: notebookSnapshot(),
        updatedAt: "2026-08-31T10:10:00.000Z"
      }
    });

    expect(report.activeGoals.map((goal) => goal.id)).toEqual(["goal-1"]);
    const goalCandidate = report.reviewCandidates.find((candidate) => candidate.kind === "goal-review");
    expect(goalCandidate).toMatchObject({
      basis: "player-authored-goal",
      verdict: "review-question",
      goalId: "goal-1"
    });
    expect(goalCandidate?.observation).toContain("has not inferred whether the marked moments support it");
  });

  it("does not attach today's unrelated active goals to an older replay", () => {
    const report = buildEnhancedInsightsContext({
      replay: replay([flag({ type: "key-turn" })]),
      notebook: notebook(),
      matchInsightContext: {
        version: 1,
        capturedWithEnhancedInsights: true,
        activeGoalIds: [],
        decisions: [],
        updatedAt: "2026-08-31T10:10:00.000Z"
      }
    });

    expect(report.activeGoals).toEqual([]);
    expect(report.reviewCandidates.some((candidate) => candidate.kind === "goal-review")).toBe(false);
  });

  it("uses the match-time Notebook snapshot after today's goals and guide have changed", () => {
    const captured = notebookSnapshot();
    const currentNotebook = notebook();
    currentNotebook.goals[0]!.text = "A renamed future goal";
    currentNotebook.matchupGuides[0]!.mulligan.avoid.cards = [];
    currentNotebook.matchupGuides[0]!.mulligan.keep.cards.push(card("Slow Spell"));

    const report = buildEnhancedInsightsContext({
      replay: replay([flag({ type: "key-turn" })]),
      notebook: currentNotebook,
      decisionContexts: [context({ assessment: "intentional" })],
      matchInsightContext: {
        version: 1,
        capturedWithEnhancedInsights: true,
        activeGoalIds: ["goal-1"],
        decisions: [],
        notebookSnapshot: captured,
        updatedAt: "2026-08-31T10:10:00.000Z"
      }
    });

    expect(report.activeGoals[0]?.text).toBe("Build a clearer turn-two plan");
    expect(report.planComparisons[0]).toMatchObject({
      status: "deviation",
      matchedSections: ["mulligan.avoid"]
    });
    expect(report.planDeviations[0]?.observation).toContain("saved matchup guide lists it under Avoid");
  });

  it("folds an auto-generated Enhanced marker flag into its richer decision question", () => {
    const generatedFlagId = "enhanced-insight-decision-1";
    const report = buildEnhancedInsightsContext({
      replay: replay([flag({
        id: generatedFlagId,
        type: "key-turn",
        label: "Review decision",
        note: "Marked during the live match for later review."
      })]),
      decisionContexts: [context({
        decision: "other",
        subject: undefined,
        flagId: generatedFlagId,
        assessment: "unsure"
      })]
    });

    expect(report.reviewCandidates.filter((candidate) => candidate.kind === "flag-review")).toEqual([]);
    expect(report.reviewCandidates.filter((candidate) => candidate.kind === "decision-review")).toHaveLength(1);
  });

  it("adapts the durable match-owned decision context and preserves its goal link", () => {
    const matchInsightContext: EnhancedInsightMatchContext = {
      version: 1,
      capturedWithEnhancedInsights: true,
      activeGoalIds: ["goal-1"],
      notebookSnapshot: notebookSnapshot(),
      decisions: [{
        id: "captured-decision-1",
        family: "resources",
        assessment: "capture-wrong",
        replayFlagId: "flag-1",
        timeMs: 12_000,
        note: "The resource counter was stale",
        source: "post-game",
        createdAt: "2026-08-31T10:10:00.000Z"
      }],
      updatedAt: "2026-08-31T10:10:00.000Z"
    };
    const report = buildEnhancedInsightsContext({
      replay: replay([flag()]),
      notebook: notebook(),
      matchInsightContext,
      capabilityReceipt: capabilities({ resources: "available" })
    });

    expect(report.evidenceReceipt.playerAuthored).toMatchObject({
      flags: 1,
      decisionContexts: 1,
      assessedDecisions: 1
    });
    expect(report.reviewCandidates[0]).toMatchObject({
      kind: "capture-correction",
      evidenceState: "available"
    });
    expect(report.reviewCandidates[0]?.evidence.map((item) => item.id)).toEqual([
      "captured-decision-1",
      "flag-1"
    ]);
    expect(report.reviewCandidates.find((candidate) => candidate.kind === "goal-review")?.observation)
      .toContain("linked this match to the active goal");
  });

  it("targets the nearest same-game semantic event for a no-video live marker", () => {
    const source = replay();
    source.structuredEvents = [
      structuredEvent("wrong-game-nearest", "2026-08-31T10:00:12.100Z", 1),
      structuredEvent("same-game-earlier", "2026-08-31T10:00:08.000Z", 2),
      structuredEvent("same-game-nearest", "2026-08-31T10:00:11.500Z", 2),
      structuredEvent("same-game-outside-window", "2026-08-31T10:01:00.000Z", 2)
    ];
    const matchInsightContext: EnhancedInsightMatchContext = {
      version: 1,
      capturedWithEnhancedInsights: true,
      activeGoalIds: [],
      decisions: [{
        id: "no-video-live-marker",
        gameNumber: 2,
        capturedAt: "2026-08-31T10:00:12.000Z",
        timeMs: 12_000,
        family: "other",
        assessment: "unsure",
        source: "live-flag",
        createdAt: "2026-08-31T10:00:12.000Z"
      }],
      updatedAt: "2026-08-31T10:00:13.000Z"
    };

    const report = buildEnhancedInsightsContext({ replay: source, matchInsightContext });
    const candidate = report.reviewCandidates.find((item) => item.kind === "decision-review");
    expect(candidate?.evidence[0]).toMatchObject({
      id: "no-video-live-marker",
      replayId: source.id,
      capturedAt: "2026-08-31T10:00:12.000Z",
      eventId: "same-game-nearest"
    });
  });

  it("uses only durable match context for saved-plan and goal-linked strategic review", () => {
    const matchInsightContext: EnhancedInsightMatchContext = {
      version: 1,
      capturedWithEnhancedInsights: true,
      // The goal is linked at decision level only. This proves the durable
      // adapter carries goalId instead of relying on renderer-synthesised
      // decisionContexts or today's active-goal selection.
      activeGoalIds: [],
      notebookSnapshot: notebookSnapshot(),
      decisions: [
        {
          id: "durable-mulligan",
          family: "mulligan",
          decision: "mulligan-keep",
          assessment: "unsure",
          subject: { cardName: "Slow Spell", cardKey: "slow-spell" },
          initiative: "1st",
          goalId: "goal-1",
          alternative: "Redraw Slow Spell for an early unit",
          source: "post-game",
          createdAt: "2026-08-31T10:10:00.000Z"
        },
        {
          id: "durable-battlefield",
          family: "battlefield",
          decision: "battlefield-pick",
          assessment: "intentional",
          subject: { battlefieldName: "The Grand Plaza" },
          initiative: "1st",
          gameNumber: 1,
          intendedPlan: "Contest the first battlefield before developing wide",
          source: "post-game",
          createdAt: "2026-08-31T10:10:01.000Z"
        },
        {
          id: "durable-resource",
          family: "resources",
          decision: "resource-use",
          assessment: "forced",
          constraint: "Only one ready rune remained",
          source: "post-game",
          createdAt: "2026-08-31T10:10:02.000Z"
        },
        {
          id: "durable-sequence",
          family: "other",
          decision: "sequencing",
          assessment: "unsure",
          alternative: "Develop the unit before scoring",
          source: "post-game",
          createdAt: "2026-08-31T10:10:03.000Z"
        }
      ],
      updatedAt: "2026-08-31T10:11:00.000Z"
    };

    const report = buildEnhancedInsightsContext({
      replay: replay(),
      matchInsightContext
    });

    expect(report.planComparisons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        decisionContextId: "durable-mulligan",
        status: "deviation",
        matchedSections: ["mulligan.avoid"]
      }),
      expect.objectContaining({
        decisionContextId: "durable-battlefield",
        status: "consistent",
        matchedSections: ["battlefields.game1First"]
      })
    ]));
    expect(report.planDeviations).toEqual([
      expect.objectContaining({ kind: "kept-avoid-card", decisionContextId: "durable-mulligan" })
    ]);
    expect(report.activeGoals.map((goal) => goal.id)).toEqual(["goal-1"]);
    expect(report.reviewCandidates.find((candidate) => candidate.goalId === "goal-1")?.observation)
      .toContain("1 player-recorded decision was linked to this active goal");
    expect(report.reviewCandidates.find((candidate) => candidate.id.includes("durable-battlefield"))?.reviewQuestion)
      .toContain("Contest the first battlefield before developing wide");
    expect(report.reviewCandidates.find((candidate) => candidate.id.includes("durable-resource"))?.reviewQuestion)
      .toContain("Only one ready rune remained");
    expect(report.reviewCandidates.find((candidate) => candidate.id.includes("durable-sequence"))?.reviewQuestion)
      .toContain("Develop the unit before scoring");
  });

  it("turns player-reported plan adaptations into questions without inventing the changed line", () => {
    const matchInsightContext: EnhancedInsightMatchContext = {
      version: 1,
      capturedWithEnhancedInsights: true,
      planOutcome: "adapted",
      sideboardPlanOutcome: "adapted",
      activeGoalIds: [],
      decisions: [],
      notebookSnapshot: notebookSnapshot(),
      postGamePromptCompletedAt: "2026-08-31T10:10:00.000Z",
      updatedAt: "2026-08-31T10:10:00.000Z"
    };
    const report = buildEnhancedInsightsContext({
      replay: replay(),
      notebook: notebook(),
      matchInsightContext,
      capabilityReceipt: capabilities({ sideboard: "partial" })
    });

    expect(report.planDeviations.map((deviation) => deviation.kind)).toEqual([
      "player-reported-plan-adaptation",
      "player-reported-sideboard-adaptation"
    ]);
    expect(report.planDeviations.every((deviation) => deviation.observation.includes("has not inferred which instruction changed"))).toBe(true);
    expect(report.reviewCandidates.map((candidate) => candidate.basis)).toEqual([
      "player-reported-plan-outcome",
      "player-reported-plan-outcome"
    ]);
    expect(report.reviewCandidates.find((candidate) => candidate.deviationId?.includes("sideboard"))?.evidenceState).toBe("partial");
    expect(report.evidenceReceipt.savedPlan.deviations).toBe(2);
  });

  it("does not claim a saved sideboard adaptation when the guide has no sideboard plan", () => {
    const sourceNotebook = notebook();
    sourceNotebook.matchupGuides[0]!.sideboard.in.cards = [];
    sourceNotebook.matchupGuides[0]!.sideboard.out.cards = [];
    const report = buildEnhancedInsightsContext({
      replay: replay(),
      notebook: sourceNotebook,
      matchInsightContext: {
        version: 1,
        capturedWithEnhancedInsights: true,
        sideboardPlanOutcome: "adapted",
        activeGoalIds: [],
        decisions: [],
        notebookSnapshot: notebookSnapshot(sourceNotebook),
        updatedAt: "2026-08-31T10:10:00.000Z"
      }
    });

    expect(report.planDeviations).toEqual([]);
    expect(report.reviewCandidates).toHaveLength(1);
    expect(report.reviewCandidates[0]).toMatchObject({
      kind: "decision-review",
      basis: "player-reported-plan-outcome",
      verdict: "review-question"
    });
    expect(report.reviewCandidates[0]?.observation).toContain("no populated applicable saved guide");
    expect(report.evidenceReceipt.playerAuthored.reportedPlanOutcomes).toBe(1);
  });

  it.each([
    ["followed", "following the game plan"],
    ["no-opportunity", "no opportunity to apply the game plan"],
    ["unsure", "unsure whether the game plan was followed"],
    ["adapted", "adapting the game plan"]
  ] as const)("turns the durable %s post-game answer into a conservative review question", (outcome, observation) => {
    const report = buildEnhancedInsightsContext({
      replay: replay(),
      matchInsightContext: {
        version: 1,
        capturedWithEnhancedInsights: true,
        planOutcome: outcome,
        activeGoalIds: [],
        decisions: [],
        postGamePromptCompletedAt: "2026-08-31T10:10:00.000Z",
        updatedAt: "2026-08-31T10:10:00.000Z"
      }
    });

    expect(report.reviewCandidates).toHaveLength(1);
    expect(report.reviewCandidates[0]).toMatchObject({
      kind: "decision-review",
      basis: "player-reported-plan-outcome",
      evidenceState: "player-authored"
    });
    expect(report.reviewCandidates[0]?.observation.toLowerCase()).toContain(observation);
  });

  it.each([
    "followed",
    "no-opportunity",
    "unsure"
  ] as const)("turns the durable sideboard %s answer into a player-authored sideboard review", (outcome) => {
    const report = buildEnhancedInsightsContext({
      replay: replay(),
      capabilityReceipt: capabilities({ sideboard: "partial" }),
      matchInsightContext: {
        version: 1,
        capturedWithEnhancedInsights: true,
        sideboardPlanOutcome: outcome,
        activeGoalIds: [],
        decisions: [],
        postGamePromptCompletedAt: "2026-08-31T10:10:00.000Z",
        updatedAt: "2026-08-31T10:10:00.000Z"
      }
    });

    expect(report.reviewCandidates).toHaveLength(1);
    expect(report.reviewCandidates[0]).toMatchObject({
      basis: "player-reported-plan-outcome",
      evidenceState: "partial",
      relevantCapabilities: [expect.objectContaining({ key: "sideboard", state: "partial" })]
    });
    expect(report.reviewCandidates[0]?.title.toLowerCase()).toContain("sideboard");
    expect(report.reviewCandidates[0]?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "player-context", id: "match-sideboard-plan-outcome" })
    ]));
  });

  it("treats a capability receipt for another replay as unknown", () => {
    const receipt = capabilities({ resources: "available" });
    receipt.replayId = "replay-2";
    const report = buildEnhancedInsightsContext({
      replay: replay(),
      capabilityReceipt: receipt,
      decisionContexts: [context({ decision: "resource-use", subject: undefined })]
    });

    const resources = report.evidenceReceipt.capabilities.find((capability) => capability.key === "resources");
    expect(resources).toMatchObject({ state: "unknown", evidenceCount: 0 });
    expect(resources?.detail).toBe("No matching replay capability receipt was supplied.");
    expect(report.reviewCandidates[0]?.evidenceState).toBe("unknown");
  });

  it("distinguishes a matching blank-detail capability from a missing receipt", () => {
    const receipt = capabilities({ resources: "available" });
    receipt.resources.detail = "";
    const report = buildEnhancedInsightsContext({ replay: replay(), capabilityReceipt: receipt });

    expect(report.evidenceReceipt.capabilities.find((capability) => capability.key === "resources")?.detail)
      .toBe("Resources capability state was supplied without detail.");
  });

  it("does not count a saved plan or goal as replay evidence", () => {
    const report = buildEnhancedInsightsContext({ replay: replay(), notebook: notebook() });

    expect(report.evidenceReceipt.state).toBe("no-evidence");
    expect(report.evidenceReceipt.limitations.join(" ")).toContain("not evidence that a replay decision occurred");
    expect(report.reviewCandidates).toEqual([]);
  });

  it("ignores foreign contexts, deduplicates flags, bounds candidates, and leaves inputs unchanged", () => {
    const duplicate = flag();
    const source = replay([duplicate, { ...duplicate }]);
    const original = structuredClone(source);
    const contexts = [
      context({ id: "local-1", assessment: "unsure" }),
      context({ id: "foreign", replayId: "replay-2", assessment: "missed" })
    ];
    const report = buildEnhancedInsightsContext({
      replay: source,
      decisionContexts: contexts,
      maxReviewCandidates: 1
    });

    expect(report.evidenceReceipt.playerAuthored).toMatchObject({ flags: 1, decisionContexts: 1 });
    expect(report.reviewCandidates).toHaveLength(1);
    expect(source).toEqual(original);
    expect(contexts).toHaveLength(2);
  });
});
