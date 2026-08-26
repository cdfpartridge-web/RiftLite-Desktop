import { describe, expect, it } from "vitest";

import {
  buildReplayCoachQuestBoard
} from "../src/shared/replayCoachQuest.js";
import type {
  ReplayInsight,
  ReplayInsightCardReport,
  ReplayInsightsReport
} from "../src/shared/replayInsights.js";

const NOW = "2026-08-25T12:00:00.000Z";

function insight(patch: Partial<ReplayInsight> = {}): ReplayInsight {
  return {
    id: "match:one:game:1:late-opening-card:charm",
    scope: "match",
    category: "opening-hand",
    tone: "opportunity",
    priority: 96,
    title: "Charm's first captured play was on your turn 5",
    body: "You kept Charm in the opening hand; the first captured play was on your turn 5.",
    action: "Review whether the keep supported your early plan or whether this slot could have searched for a faster card.",
    captureConfidence: "confirmed",
    confidence: "confirmed",
    patternStrength: "single-observation",
    claimBasis: "observational",
    dataReceipt: {
      observationCount: 1,
      scopeGames: 1,
      completedScopeGames: 1,
      completePlayCaptureScopeGames: 1,
      playCaptureStatus: "complete-enough",
      linkedReplays: 1,
      deckFingerprints: ["private-deck-hash"],
      periods: ["current-season"],
      observedFrom: "2026-08-24T10:00:00.000Z",
      observedThrough: "2026-08-24T10:00:00.000Z"
    },
    sampleSize: 1,
    replayId: "private-replay-id",
    matchId: "private-match-id",
    gameNumber: 1,
    cardName: "Charm",
    cardId: "OGN-173",
    playerLegend: "Ahri",
    opponentLegend: "Jinx",
    evidence: [{
      replayId: "private-replay-id",
      matchId: "private-match-id",
      eventId: "private-event-id",
      capturedAt: "2026-08-24T10:00:00.000Z",
      videoTimeMs: 42_000,
      label: "First captured play on your turn 5",
      confidence: "confirmed"
    }],
    ...patch
  };
}

function card(patch: Partial<ReplayInsightCardReport> = {}): ReplayInsightCardReport {
  return {
    key: "ogn-173",
    cardName: "Charm",
    cardId: "OGN-173",
    imageUrl: "https://cards.example/OGN-173.webp",
    appearances: 8,
    kept: 8,
    played: 6,
    unplayed: 2,
    completePlayCaptureAppearances: 8,
    recycledOrDiscarded: 1,
    lateKeeps: 5,
    immediatePlays: 2,
    averageKnownHandTimeMs: 45_000,
    confidence: "confirmed",
    replayIds: ["private-replay-id"],
    ...patch
  };
}

function report(insights: ReplayInsight[], cards: ReplayInsightCardReport[] = []): ReplayInsightsReport {
  return {
    generatedAt: NOW,
    replaysAnalyzed: 12,
    analyzedReplayIds: ["private-replay-id"],
    matchesAnalyzed: 12,
    gamesAnalyzed: 12,
    insights,
    cards,
    stats: {
      completedGames: 12,
      wins: 7,
      losses: 5,
      draws: 0,
      baselineWinRate: 58.3,
      capturedLocalPlays: 48,
      knownSourcePlays: 40,
      sourceCoveragePercent: 83.3,
      reliableTimingCohorts: 1,
      battlefieldPickOrders: [],
      battlefieldPositionChoices: [],
      cardSourceZones: [],
      cardTurnOutcomes: [],
      outcomeSplits: []
    },
    coverage: {
      grade: "high",
      replaysWithStructuredEvents: 12,
      namedCardJourneys: 30,
      confirmedEvents: 90,
      reconstructedEvents: 2,
      inferredEvents: 1,
      manualEvents: 0
    },
    scopeReceipt: {
      currentSeasonStartedOn: "2026-07-31",
      periods: ["current-season"],
      periodGameCounts: { preseason: 0, "current-season": 12, unknown: 0 },
      deckVersions: [{ fingerprint: "private-deck-hash", games: 12 }],
      unknownDeckGames: 0,
      observedFrom: "2026-08-01T00:00:00.000Z",
      observedThrough: NOW
    }
  };
}

function lateKeepPattern(patch: Partial<ReplayInsight> = {}): ReplayInsight {
  return insight({
    id: "pattern:card:ogn-173:late-after-keep",
    scope: "pattern",
    tone: "opportunity",
    priority: 95,
    title: "Charm's first captured play repeatedly followed a keep late",
    body: "You kept Charm 8 times, and its first captured play was on your turn 4 or later in 5 of those games.",
    action: "Test redrawing this card more aggressively unless the matchup specifically rewards holding it.",
    patternStrength: "exploratory",
    sampleSize: 8,
    replayId: undefined,
    matchId: undefined,
    gameNumber: undefined,
    dataReceipt: {
      observationCount: 8,
      scopeGames: 8,
      completedScopeGames: 8,
      completePlayCaptureScopeGames: 8,
      playCaptureStatus: "complete-enough",
      linkedReplays: 8,
      deckFingerprints: ["private-deck-hash"],
      periods: ["preseason", "current-season"],
      observedFrom: "2026-07-01T10:00:00.000Z",
      observedThrough: "2026-08-24T10:00:00.000Z"
    },
    ...patch
  });
}

describe("Replay coaching quest model", () => {
  it("turns a repeated opportunity into a traceable challenge with a direct rate", () => {
    const source = lateKeepPattern();
    const board = buildReplayCoachQuestBoard(report([source], [card()]));

    expect(board.primary).toMatchObject({
      id: `coach:${source.id}`,
      insightId: source.id,
      kind: "challenge",
      category: "opening-hand",
      tone: "opportunity",
      trigger: "When Charm is in your opening hand",
      nextGameRule: source.action,
      finding: { title: source.title, body: source.body },
      primaryMetric: {
        kind: "behaviour-rate",
        label: "Keeps first played on turn four or later",
        numerator: 5,
        denominator: 8,
        percentage: 62.5,
        source: "card-report"
      },
      comparator: {
        label: "Other captured keeps",
        numerator: 3,
        denominator: 8,
        percentage: 37.5,
        deltaPercentagePoints: 25
      },
      art: {
        category: "opening-hand",
        card: { id: "OGN-173", name: "Charm", imageUrl: "https://cards.example/OGN-173.webp" },
        playerLegend: { id: "ahri", name: "Ahri" },
        opponentLegend: { id: "jinx", name: "Jinx" },
        fallbackId: "category:opening-hand"
      },
      confidence: {
        capture: "confirmed",
        pattern: "exploratory",
        reportCoverage: "high",
        claimBasis: "observational"
      }
    });
    expect(board.primary?.reviewQuestion).toBeUndefined();
    expect(board.primary?.scope).toMatchObject({
      insightScope: "pattern",
      observations: 8,
      games: 8,
      periods: ["preseason", "current-season"]
    });
    expect(board.primary?.evidence).toEqual(source.evidence);
    expect(board.primary?.evidence).not.toBe(source.evidence);
  });

  it("always frames a single-match observation as a question, never a challenge", () => {
    const source = insight();
    const quest = buildReplayCoachQuestBoard(report([source], [card()])).primary;

    expect(quest).toMatchObject({
      kind: "review-question",
      trigger: "When Charm is in your opening hand",
      nextGameRule: source.action,
      reviewQuestion: "For this replay: review whether the keep supported your early plan or whether this slot could have searched for a faster card?",
      primaryMetric: {
        kind: "capture-coverage",
        numerator: 1,
        denominator: 1,
        percentage: 100,
        source: "data-receipt"
      }
    });
    expect(quest?.share.eyebrow).toBe("Replay review question");
    expect(quest?.share.caveat).toBe("One captured game raised this question; it is not a verdict on the decision.");
    expect(quest?.share.plainText).toContain("For this replay:");
    expect(quest?.share.plainText.toLocaleLowerCase()).toContain("not a verdict");
  });

  it("requires both repeatability and an opportunity tone before offering a challenge", () => {
    const singleDisguisedAsPattern = lateKeepPattern({
      id: "pattern:invalid-single",
      sampleSize: 1,
      patternStrength: "single-observation"
    });
    const recurringWatch = lateKeepPattern({
      id: "pattern:card:ogn-173:long-hand-time",
      tone: "watch",
      action: "Review whether this is being held intentionally."
    });
    const quests = [singleDisguisedAsPattern, recurringWatch].map((source) => (
      buildReplayCoachQuestBoard(report([source], [card()])).primary
    ));

    expect(quests.map((quest) => quest?.kind)).toEqual(["review-question", "review-question"]);
    expect(quests.every((quest) => quest?.reviewQuestion?.endsWith("?"))).toBe(true);
  });

  it("keeps a repeated diagnostic prompt in review instead of inventing a challenge", () => {
    const diagnostic = lateKeepPattern({
      id: "pattern:card:ogn-173:often-unplayed",
      category: "card-efficiency",
      title: "Charm often appeared without a matched play",
      action: "Review the examples and label whether the card was intentionally held, converted for value, or stranded."
    });
    const quest = buildReplayCoachQuestBoard(report([diagnostic], [card()])).primary;

    expect(quest?.kind).toBe("review-question");
    expect(quest?.reviewQuestion).toContain("Across these replays:");
    expect(quest?.share.caveat).toContain("8 captured observations");
  });

  it("ranks a repeatable challenge above a higher-priority one-game question", () => {
    const matchQuestion = insight({
      id: "match:very-urgent",
      category: "curve",
      cardName: undefined,
      cardId: undefined,
      priority: 120
    });
    const challenge = lateKeepPattern({ priority: 80 });
    const board = buildReplayCoachQuestBoard(report([matchQuestion, challenge], [card()]));

    expect(board.primary?.insightId).toBe(challenge.id);
    expect(board.primary?.kind).toBe("challenge");
    expect(board.secondary.map((quest) => quest.insightId)).toEqual([matchQuestion.id]);
  });

  it("returns at most two distinct secondary opportunities and removes duplicate card lessons", () => {
    const duplicateCharm = insight({ id: "match:charm:other", title: "Another Charm observation", priority: 200 });
    const curve = insight({
      id: "match:curve",
      category: "curve",
      cardName: undefined,
      cardId: undefined,
      title: "No card play was captured during your first two turns",
      action: "Review the opening hand and rune development to identify what delayed the first play.",
      priority: 70
    });
    const battlefield = insight({
      id: "match:battlefield",
      category: "battlefield",
      cardName: undefined,
      cardId: undefined,
      title: "Your first captured score occurred on your turn 4",
      action: "Watch the turns before this score and check whether an earlier contest was available.",
      priority: 60
    });
    const matchup = insight({
      id: "match:matchup",
      category: "matchup",
      cardName: undefined,
      cardId: undefined,
      title: "An opening sequence against Jinx",
      priority: 50
    });
    const board = buildReplayCoachQuestBoard(report([
      lateKeepPattern(),
      duplicateCharm,
      curve,
      battlefield,
      matchup
    ], [card()]));

    expect(board.candidateCount).toBe(5);
    expect([board.primary, ...board.secondary]).toHaveLength(3);
    expect(board.secondary).toHaveLength(2);
    expect([board.primary, ...board.secondary].filter((quest) => quest?.art.card?.name === "Charm")).toHaveLength(1);
  });

  it("uses the exact ratio in a generated matchup claim without upgrading it to causation", () => {
    const matchup = insight({
      id: "pattern:matchup-slow-start:jinx",
      scope: "pattern",
      category: "matchup",
      tone: "opportunity",
      priority: 87,
      title: "No early play was repeatedly captured against Jinx",
      body: "3 of 5 complete-enough captured games against Jinx contained no recorded card play during your first two turns.",
      action: "Compare those opening hands and consider a more matchup-specific mulligan or rune plan.",
      sampleSize: 5,
      patternStrength: "exploratory",
      cardName: undefined,
      cardId: undefined,
      dataReceipt: {
        ...insight().dataReceipt,
        observationCount: 5,
        scopeGames: 5,
        completedScopeGames: 5,
        completePlayCaptureScopeGames: 5,
        linkedReplays: 5
      }
    });
    const quest = buildReplayCoachQuestBoard(report([matchup])).primary;

    expect(quest).toMatchObject({
      kind: "review-question",
      trigger: "When facing Jinx",
      primaryMetric: {
        kind: "behaviour-rate",
        numerator: 3,
        denominator: 5,
        percentage: 60,
        source: "insight-claim"
      },
      comparator: {
        numerator: 2,
        denominator: 5,
        percentage: 40,
        deltaPercentagePoints: 20
      }
    });
    expect(quest?.confidence.claimBasis).toBe("observational");
    expect(quest?.reviewQuestion).toContain("Across these replays:");
    expect(quest?.share.caveat).toContain("5 captured observations");
    expect(quest?.share.caveat.toLocaleLowerCase()).toContain("not a verdict");
  });

  it("falls back to capture coverage when a claimed or card-report ratio is unsafe", () => {
    const malformed = lateKeepPattern({ body: "20 of 5 games showed this pattern." });
    const malformedCard = card({ lateKeeps: 20, kept: 5 });
    const quest = buildReplayCoachQuestBoard(report([malformed], [malformedCard])).primary;

    expect(quest?.primaryMetric).toMatchObject({
      kind: "capture-coverage",
      numerator: 8,
      denominator: 8,
      percentage: 100,
      source: "data-receipt"
    });
    expect(quest?.comparator).toBeUndefined();
  });

  it("does not invent a denominator for a defensive empty-scope fallback", () => {
    const source = insight({
      dataReceipt: {
        ...insight().dataReceipt,
        observationCount: 0,
        scopeGames: 0,
        completedScopeGames: 0,
        completePlayCaptureScopeGames: 0,
        linkedReplays: 0
      },
      evidence: []
    });
    const metric = buildReplayCoachQuestBoard(report([source])).primary?.primaryMetric;

    expect(metric).toMatchObject({
      kind: "capture-coverage",
      numerator: 0,
      denominator: 0,
      percentage: 0,
      display: "0 of 0 games had complete-enough play capture"
    });
  });

  it("keeps share copy free of replay, match, event, deck and timestamp identifiers", () => {
    const quest = buildReplayCoachQuestBoard(report([lateKeepPattern()], [card()])).primary!;
    const shared = JSON.stringify(quest.share);

    for (const privateValue of [
      "private-replay-id",
      "private-match-id",
      "private-event-id",
      "private-deck-hash",
      "2026-08-24T10:00:00.000Z"
    ]) expect(shared).not.toContain(privateValue);
    expect(shared).toContain("Charm");
    expect(shared).toContain("5 of 8 captured keeps");
  });

  it("does not mutate report data and returns an honest empty board", () => {
    const positive = insight({ tone: "positive", category: "positive", title: "A strength" });
    const source = report([positive], [card()]);
    const snapshot = JSON.stringify(source);
    const board = buildReplayCoachQuestBoard(source);

    expect(board).toEqual({
      version: 1,
      generatedAt: NOW,
      primary: null,
      secondary: [],
      candidateCount: 0
    });
    expect(JSON.stringify(source)).toBe(snapshot);
  });
});
