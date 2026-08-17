import { describe, expect, it } from "vitest";
import {
  buildMulliganLabRegistry,
  extractMulliganLabObservationFromReplayEvent,
  completeMulliganLabTrainingSession,
  initialMulliganLabTrainingState,
  mulliganLabApiDeckFingerprint,
  mulliganLabApiDeckFingerprintFromSnapshot,
  mulliganLabChoiceFeedback,
  mulliganLabCurveCheck,
  mulliganLabDeckCurveProfile,
  mulliganLabDeckSnapshotHash,
  mulliganLabIdentityDecisions,
  mulliganLabChoiceEvidence,
  mulliganLabReplacementOddsForDrill,
  mulliganLabReviewDrillIds,
  mulliganLabScenarioUsefulness,
  rankMulliganLabDailyDrills,
  parseMulliganLabApiResponse,
  parseMulliganLabTargetPackResponse,
  parseMulliganLabTrainingState,
  recordMulliganLabTrainingAnswer,
  serializeMulliganLabTrainingState,
  validateMulliganLabObservation
} from "../src/shared/mulliganLab";
import type { ReplayStructuredEvent } from "../src/shared/types";

const image = (code: string) => `https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/${code.toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(40, "a")}-744x1039.png?accountingTag=RB`;

function registryFixture() {
  const cards = [
    { printId: "UNL-191", name: "Master Yi, Wuju Master", type: "Legend", imageUrl: image("UNL191"), costEnergy: null, costPower: null },
    { printId: "OGS-019", name: "Master Yi, Wuju Bladesman (Starter)", type: "Legend", imageUrl: image("OGS019"), costEnergy: null, costPower: null },
    { printId: "VEN-145", name: "Nasus, Curator of the Sands", type: "Legend", imageUrl: image("VEN145"), costEnergy: null, costPower: null },
    { printId: "VEN-038A", name: "Canonical Alternate Print", type: "Unit", imageUrl: image("VEN038A"), costEnergy: 4, costPower: 0 },
    ...Array.from({ length: 15 }, (_, index) => ({
      printId: `OGN-${String(index + 1).padStart(3, "0")}`,
      name: `Canonical Card ${index + 1}`,
      type: index === 14 ? "Spell" : "Unit",
      supertype: index === 13 ? "Champion" : null,
      imageUrl: image(`OGN${index + 1}`),
      costEnergy: index === 0 ? 2 : index === 1 ? 1 : index === 2 ? 3 : index === 3 ? null : index === 14 ? 2 : 4,
      costPower: index === 0 ? 3 : index === 3 ? null : 0
    }))
  ];
  return { schemaVersion: 1, cards };
}

function deckEntries() {
  return Array.from({ length: 14 }, (_, index) => ({
    cardId: `OGN-${String(index + 1).padStart(3, "0")}`,
    qty: index < 13 ? 3 : 1
  }));
}

function observation() {
  const snapshotJson = JSON.stringify({ legendCode: "UNL-191", mainDeck: deckEntries() });
  return {
    schemaVersion: 1,
    id: "observation-1",
    provider: "atlas",
    matchId: "opaque-match-1",
    gameNumber: 1,
    sourceEventId: "opaque-event-1",
    observedAt: "2026-08-12T08:00:00.000Z",
    result: "Win",
    wentFirst: "1st",
    playerLegendCode: "UNL-191",
    opponentLegendCode: "VEN-145",
    deckSnapshot: {
      matchId: "opaque-match-1",
      gameNumber: 1,
      snapshotHash: mulliganLabDeckSnapshotHash(snapshotJson),
      snapshotJson
    },
    openingHandCodes: ["OGN-001", "OGN-001", "OGN-002", "OGN-013"],
    keptCodes: ["OGN-001", "OGN-002", "OGN-013"],
    redrawnCodes: ["OGN-001"],
    redrawCount: 1
  };
}

function apiDeck() {
  const mainDeck = deckEntries().map((entry, index) => ({
    cardCode: entry.cardId,
    name: `Canonical Card ${index + 1}`,
    count: entry.qty
  }));
  return {
    fingerprint: mulliganLabApiDeckFingerprint(mainDeck.map((entry) => ({ code: entry.cardCode, count: entry.count }))),
    mainDeck
  };
}

function apiDrill() {
  return {
    id: `ml1_${"1".repeat(32)}`,
    observedHandId: `mh1_${"2".repeat(32)}`,
    observation: {
      provider: "atlas",
      matchKey: `mm1_${"3".repeat(32)}`,
      gameNumber: 1,
      eventKey: `me1_${"4".repeat(32)}`,
      observedOn: "2026-08-12"
    },
    matchup: {
      playerLegend: { cardCode: "UNL-191", name: "Master Yi, Wuju Master" },
      opponentLegend: { cardCode: "VEN-145", name: "Nasus, Curator of the Sands" }
    },
    initiative: "first",
    hand: [
      { cardCode: "OGN-001", name: "Canonical Card 1" },
      { cardCode: "OGN-001", name: "Canonical Card 1" },
      { cardCode: "OGN-002", name: "Canonical Card 2" },
      { cardCode: "OGN-013", name: "Canonical Card 13" }
    ],
    observedDecision: { redrawnCardIndexes: [1], wonGame: true },
    deck: apiDeck(),
    evidence: { status: "sufficient", scope: "matchup-initiative", hands: 30, players: 12 },
    cardEvidence: [
      { cardCode: "OGN-001", name: "Canonical Card 1", offered: 40, kept: 28, redrawn: 12, keptWins: 16, redrawnWins: 7 },
      { cardCode: "OGN-002", name: "Canonical Card 2", offered: 30, kept: 24, redrawn: 6, keptWins: 14, redrawnWins: 3 },
      { cardCode: "OGN-013", name: "Canonical Card 13", offered: 25, kept: 10, redrawn: 15, keptWins: 4, redrawnWins: 9 }
    ]
  };
}

function apiResponse(drills: unknown[] = [apiDrill()]) {
  return {
    schema: "riftlite-mulligan-lab",
    version: 1,
    status: "ready",
    generatedAt: "2026-08-12T08:00:00.000Z",
    expiresAt: "2026-08-20T20:00:00.000Z",
    source: {
      kind: "precomputed-observed-replays",
      corpus: "anonymized-canonical-web-replays",
      minimumHands: 25,
      minimumPlayers: 10
    },
    drills
  };
}

function apiV2Drill() {
  const legacy = apiDrill();
  return {
    id: `ml2_${"5".repeat(32)}`,
    matchup: legacy.matchup,
    initiative: legacy.initiative,
    hand: legacy.hand,
    deck: legacy.deck,
    evidence: {
      status: "sufficient",
      scope: "matchup",
      deckScope: "all-observed-decks",
      guidanceBasis: "community-keep-rate",
      outcomeInterpretation: "descriptive-not-causal",
      playerLegendIdentityCode: "UNL-191",
      opponentLegendIdentityCode: "VEN-145",
      hands: 40,
      players: 30
    },
    cardEvidence: [
      { cardCode: "OGN-001", name: "Canonical Card 1", identityCode: "OGN-001", scope: "player-legend", scopeHands: 100, scopePlayers: 35, baselineKeepRate: .55, offered: 40, players: 30, kept: 28, keptPlayers: 25, redrawn: 12, redrawnPlayers: 12, keptWins: 16, redrawnWins: 7, keepRate: 28 / 40, guidancePlayers: 25, guidanceKept: 18, guidanceKeepRate: 18 / 25, keptWinRate: 16 / 28, redrawnWinRate: 7 / 12, winRateDelta: 16 / 28 - 7 / 12, guidance: "keep", evidenceStatus: "robust", outcomeStatus: "one_sided" },
      { cardCode: "OGN-002", name: "Canonical Card 2", identityCode: "OGN-002", scope: "matchup", scopeHands: 35, scopePlayers: 28, baselineKeepRate: .6, offered: 30, players: 28, kept: 24, keptPlayers: 24, redrawn: 6, redrawnPlayers: 6, keptWins: 14, redrawnWins: 3, keepRate: 24 / 30, guidancePlayers: 25, guidanceKept: 20, guidanceKeepRate: 20 / 25, keptWinRate: 14 / 24, redrawnWinRate: 3 / 6, winRateDelta: 14 / 24 - 3 / 6, guidance: "keep", evidenceStatus: "robust", outcomeStatus: "one_sided" },
      { cardCode: "OGN-013", name: "Canonical Card 13", identityCode: "OGN-013", scope: "matchup", scopeHands: 35, scopePlayers: 28, baselineKeepRate: .6, offered: 25, players: 25, kept: 10, keptPlayers: 10, redrawn: 15, redrawnPlayers: 15, keptWins: 4, redrawnWins: 9, keepRate: 10 / 25, guidancePlayers: 25, guidanceKept: 10, guidanceKeepRate: 10 / 25, keptWinRate: 4 / 10, redrawnWinRate: 9 / 15, winRateDelta: 4 / 10 - 9 / 15, guidance: "mixed", evidenceStatus: "robust", outcomeStatus: "one_sided" }
    ]
  };
}

function apiV2Response(drills: unknown[] = [apiV2Drill()]) {
  const response = apiResponse(drills);
  return {
    ...response,
    version: 2,
    source: {
      ...response.source,
      observedFrom: "2026-07-11",
      observedThrough: "2026-08-12",
      includedFacts: 2_005,
      coverageTruncated: true,
      coveragePolicy: "all-available-history",
      includedPeriods: ["preseason", "current-season"],
      seasonCoverage: {
        currentSeasonStartedOn: "2026-07-31",
        preseasonFacts: 700,
        currentSeasonFacts: 1_305
      },
      backfillComplete: false
    }
  };
}

function apiTargetResponse() {
  const response = apiV2Response();
  const drill = structuredClone(apiV2Drill());
  const contextSlice = (entry: (typeof drill.cardEvidence)[number]) => ({
    offered: entry.offered,
    players: entry.players,
    kept: entry.kept,
    redrawn: entry.redrawn,
    guidancePlayers: entry.guidancePlayers,
    guidanceKept: entry.guidanceKept,
    guidanceKeepRate: entry.guidanceKeepRate,
    guidance: entry.guidance,
    evidenceStatus: entry.evidenceStatus
  });
  return {
    ...response,
    schema: "riftlite-mulligan-lab-pack",
    version: 1,
    query: {
      requested: { playerLegend: "UNL-191", opponentLegend: "VEN-145", deckFingerprint: drill.deck.fingerprint, initiative: "first" },
      resolved: { scope: "exact-deck", deckFingerprint: drill.deck.fingerprint, sharedCards: 40, totalCards: 40 },
      fallbackReason: null
    },
    source: {
      ...response.source,
      cardRegistryGeneratedAt: "2026-08-13T08:58:20.672Z",
      cardRegistryPrints: registryFixture().cards.length
    },
    drills: [{
      ...drill,
      deck: { ...drill.deck, chosenChampionCode: "OGN-014" },
      context: {
        curve: { classification: "two-drop-present", twoDropCount: 2, earlyUnitCount: 3 },
        battlefields: { player: null, opponent: null },
        duplicateIdentityCount: 1,
        setup: {
          chosenChampion: { cardCode: "OGN-014", name: "Canonical Card 14" },
          replacementPoolCards: 35
        }
      },
      decisionEvidence: {
        scope: "matching-curve",
        hands: 40,
        players: 30,
        redrawCountHistogram: [
          { redraws: 0, hands: 4 },
          { redraws: 1, hands: 12 },
          { redraws: 2, hands: 24 }
        ],
        mostCommonRedrawCount: 2,
        twoRedrawRate: 0.6,
        evidenceStatus: "robust"
      },
      cardEvidence: drill.cardEvidence.map((entry) => ({
        ...entry,
        slices: {
          matchingCurve: contextSlice(entry),
          matchingInitiative: null,
          preseason: null,
          currentSeason: null
        }
      }))
    }]
  };
}

describe("Mulligan Lab curve check", () => {
  const registry = buildMulliganLabRegistry(registryFixture());
  const card = (code: string) => {
    const resolved = registry.byCode.get(code);
    if (!resolved) throw new Error(`Missing registry fixture ${code}`);
    return resolved;
  };

  it("classifies an exact two-Energy Unit as a 2-drop regardless of its Power cost", () => {
    expect(card("OGN-001")).toMatchObject({ type: "Unit", costEnergy: 2, costPower: 3 });
    expect(mulliganLabCurveCheck([card("OGN-001")], "1st")).toEqual({
      status: "two-drop-present",
      twoDropIndexes: [0],
      alternativeEarlyUnitIndexes: []
    });
  });

  it("does not count a two-Energy Spell as a 2-drop", () => {
    expect(card("OGN-015")).toMatchObject({ type: "Spell", costEnergy: 2 });
    expect(mulliganLabCurveCheck([card("OGN-015")], "1st")).toEqual({
      status: "missing",
      twoDropIndexes: [],
      alternativeEarlyUnitIndexes: []
    });
  });

  it("fails closed when Energy metadata is unavailable", () => {
    expect(card("OGN-004")).toMatchObject({ type: "Unit", costEnergy: null, costPower: null });
    expect(mulliganLabCurveCheck([card("OGN-004")], "1st")).toEqual({
      status: "unknown",
      twoDropIndexes: [],
      alternativeEarlyUnitIndexes: []
    });
  });

  it("fails closed when an alternative early Unit appears beside unknown card metadata", () => {
    expect(mulliganLabCurveCheck([card("OGN-002"), card("OGN-004")], "1st")).toEqual({
      status: "unknown",
      twoDropIndexes: [],
      alternativeEarlyUnitIndexes: [0]
    });
  });

  it("recognises a one-Energy Unit as an alternative early line", () => {
    expect(mulliganLabCurveCheck([card("OGN-002")], "1st")).toEqual({
      status: "alternative-early-unit",
      twoDropIndexes: [],
      alternativeEarlyUnitIndexes: [0]
    });
  });

  it("recognises a three-Energy Unit as an alternative only when going second", () => {
    expect(mulliganLabCurveCheck([card("OGN-003")], "1st")).toEqual({
      status: "missing",
      twoDropIndexes: [],
      alternativeEarlyUnitIndexes: []
    });
    expect(mulliganLabCurveCheck([card("OGN-003")], "2nd")).toEqual({
      status: "alternative-early-unit",
      twoDropIndexes: [],
      alternativeEarlyUnitIndexes: [0]
    });
  });

  it("counts registered two-drop copies and fails closed on an unknown Unit cost", () => {
    expect(mulliganLabDeckCurveProfile([
      { ...card("OGN-001"), count: 3 },
      { ...card("OGN-002"), count: 3 },
      { ...card("OGN-015"), count: 3 }
    ])).toEqual({ metadataComplete: true, twoDropCopies: 3 });
    expect(mulliganLabDeckCurveProfile([
      { ...card("OGN-004"), count: 3 },
      { ...card("OGN-015"), count: 3 }
    ])).toEqual({ metadataComplete: false, twoDropCopies: 0 });
  });

  it("computes exact replacement odds only when the face-up Champion and 35-card pool are proven", () => {
    const parsed = parseMulliganLabTargetPackResponse(apiTargetResponse(), registry);
    expect(parsed.status).toBe("ready");
    if (parsed.status !== "ready") return;
    expect(mulliganLabReplacementOddsForDrill(parsed.drills[0]!, 1)).toMatchObject({
      redraws: 1,
      liveTwoDrops: 1,
      poolCards: 35
    });
    expect(mulliganLabReplacementOddsForDrill(parsed.drills[0]!, 1)?.probability).toBeCloseTo(1 / 35);
    expect(mulliganLabReplacementOddsForDrill(parsed.drills[0]!, 2)?.probability).toBeCloseTo(2 / 35);

    const unproven = { ...parsed.drills[0]!, deck: { ...parsed.drills[0]!.deck, chosenChampionCode: null } };
    expect(mulliganLabReplacementOddsForDrill(unproven, 2)).toBeNull();
  });

  it("labels contextual hands as Challenges and ranks them into the Daily run", () => {
    const parsed = parseMulliganLabTargetPackResponse(apiTargetResponse(), registry);
    expect(parsed.status).toBe("ready");
    if (parsed.status !== "ready") return;
    expect(mulliganLabScenarioUsefulness(parsed.drills[0]!)).toMatchObject({
      kind: "challenge",
      contextualSignals: 3
    });
    expect(rankMulliganLabDailyDrills(parsed.drills, 1).map((drill) => drill.id)).toEqual([parsed.drills[0]!.id]);
  });
});

describe("Mulligan Lab local training profile", () => {
  const answer = {
    drillId: "ml2_review-me",
    answeredAt: "2026-08-14T09:00:00.000Z",
    playerLegendCode: "UNL-191",
    opponentLegendCode: "VEN-145",
    wentFirst: "1st" as const,
    selectedCardIndexes: [0, 2],
    aligned: 1,
    conflicts: 1,
    general: 1,
    ungraded: 0,
    confidence: "certain" as const,
    evidenceTier: "challenge" as const,
    review: { dueAt: "2026-08-15T09:00:00.000Z", intervalDays: 1, successfulReviews: 0 },
    decisionMs: 12_000
  };

  it("round-trips a bounded active run and derives review items only from matchup conflicts", () => {
    const initial = initialMulliganLabTrainingState();
    const recorded = recordMulliganLabTrainingAnswer(initial, answer, {
      runKey: "daily|2026-08-14",
      startedAt: "2026-08-14T08:59:00.000Z",
      decisions: { [answer.drillId]: [0, 2] }
    });
    const parsed = parseMulliganLabTrainingState(serializeMulliganLabTrainingState(recorded));
    expect(parsed.activeRun?.decisions[answer.drillId]).toEqual([0, 2]);
    expect(mulliganLabReviewDrillIds(parsed)).toEqual([answer.drillId]);

    const generalOnly = recordMulliganLabTrainingAnswer(initial, { ...answer, drillId: "ml2_general", conflicts: 0, general: 2, evidenceTier: "guided", review: null }, {
      runKey: "mixed|2026-08-14",
      startedAt: "2026-08-14T08:59:00.000Z",
      decisions: { ml2_general: [] }
    });
    expect(mulliganLabReviewDrillIds(generalOnly)).toEqual([]);
  });

  it("lets the latest corrected answer remove an earlier conflict from Review", () => {
    const conflicted = recordMulliganLabTrainingAnswer(initialMulliganLabTrainingState(), answer, {
      runKey: "daily|2026-08-14",
      startedAt: "2026-08-14T08:59:00.000Z",
      decisions: { [answer.drillId]: [0, 2] }
    });
    const corrected = recordMulliganLabTrainingAnswer(conflicted, {
      ...answer,
      answeredAt: "2026-08-14T09:10:00.000Z",
      selectedCardIndexes: [],
      aligned: 2,
      conflicts: 0,
      review: null
    }, {
      runKey: "review|2026-08-14",
      startedAt: "2026-08-14T09:09:00.000Z",
      decisions: { [answer.drillId]: [] }
    });

    expect(mulliganLabReviewDrillIds(conflicted)).toEqual([answer.drillId]);
    expect(mulliganLabReviewDrillIds(corrected)).toEqual([]);
  });

  it("closes a completed session locally and fails closed on malformed or future storage", () => {
    const recorded = recordMulliganLabTrainingAnswer(initialMulliganLabTrainingState(), answer, {
      runKey: "daily|2026-08-14",
      startedAt: "2026-08-14T08:59:00.000Z",
      decisions: { [answer.drillId]: [0, 2] }
    });
    const completed = completeMulliganLabTrainingSession(recorded, {
      id: "mls_1",
      runKey: "daily|2026-08-14",
      mode: "daily",
      startedAt: "2026-08-14T08:59:00.000Z",
      completedAt: "2026-08-14T09:05:00.000Z",
      handsCompleted: 1,
      aligned: 1,
      conflicts: 1,
      general: 1,
      ungraded: 0
    });
    expect(completed.activeRun).toBeNull();
    expect(completed.sessions).toHaveLength(1);
    expect(parseMulliganLabTrainingState("not-json")).toEqual(initialMulliganLabTrainingState());
    expect(parseMulliganLabTrainingState(JSON.stringify({ schemaVersion: 99, answers: [answer] }))).toEqual(initialMulliganLabTrainingState());
  });
});

describe("Mulligan Lab real-observation validation", () => {
  const registry = buildMulliganLabRegistry(registryFixture());

  it("resolves exact cards and legends exclusively through the registry", () => {
    expect(registry.byCode.get("VEN-038A")?.name).toBe("Canonical Alternate Print");
    const result = validateMulliganLabObservation(observation(), registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.openingHand.map((card) => card.name)).toEqual([
      "Canonical Card 1", "Canonical Card 1", "Canonical Card 2", "Canonical Card 13"
    ]);
    expect(result.observation.playerLegend.name).toBe("Master Yi, Wuju Master");
    expect(result.observation.openingHand.every((card) => card.imageUrl.startsWith("https://cmsassets.rgpub.io/"))).toBe(true);
  });

  it("rejects a guessed code, an illegal hand multiset, and cross-game snapshots", () => {
    const unknown = observation();
    unknown.openingHandCodes[0] = "OGN-999";
    expect(validateMulliganLabObservation(unknown, registry).ok).toBe(false);

    const nonCanonicalCase = observation();
    nonCanonicalCase.openingHandCodes[0] = "ogn-001";
    expect(validateMulliganLabObservation(nonCanonicalCase, registry).ok).toBe(false);

    const tooMany = observation();
    tooMany.openingHandCodes = ["OGN-013", "OGN-013", "OGN-013", "OGN-013"];
    tooMany.keptCodes = [...tooMany.openingHandCodes];
    tooMany.redrawnCodes = [];
    tooMany.redrawCount = 0;
    expect(validateMulliganLabObservation(tooMany, registry).issues.some((item) => item.message.includes("exceeds its quantity"))).toBe(true);

    const wrongGame = observation();
    wrongGame.deckSnapshot.gameNumber = 2;
    expect(validateMulliganLabObservation(wrongGame, registry).issues.some((item) => item.path === "deckSnapshot.gameNumber")).toBe(true);
  });

  it("requires kept and redrawn cards to exactly partition all four occurrences", () => {
    const broken = observation();
    broken.keptCodes = ["OGN-002", "OGN-013"];
    expect(validateMulliganLabObservation(broken, registry).issues.some((item) => item.message.includes("exactly partition"))).toBe(true);
  });

  it("extracts only an explicit private-local exact mulligan event", () => {
    const raw = observation();
    const card = (code: string): { id: string; name: string; code: string; type: string; imageUrl: string } => ({ id: code, name: code, code, type: "Unit", imageUrl: "" });
    const options = raw.openingHandCodes.map(card);
    const event = {
      id: "event-1",
      sourceEventId: "source-1",
      gameNumber: 1,
      capturedAt: raw.observedAt,
      labelTime: "",
      type: "mulligan",
      side: "me",
      text: "Submitted mulligan",
      cardName: "",
      destination: "",
      battlefield: "",
      visibility: "private-local",
      mulligan: { options, kept: [options[0], options[2], options[3]], redrawn: [options[1]], redrawCount: 1 }
    } satisfies ReplayStructuredEvent;
    const result = extractMulliganLabObservationFromReplayEvent({
      provider: "atlas",
      matchId: raw.matchId,
      playerLegendCode: raw.playerLegendCode,
      opponentLegendCode: raw.opponentLegendCode,
      wentFirst: raw.wentFirst as "1st",
      result: raw.result as "Win",
      deckSnapshot: raw.deckSnapshot,
      event
    }, registry);
    expect(result.ok).toBe(true);
    expect(extractMulliganLabObservationFromReplayEvent({
      provider: "atlas",
      matchId: raw.matchId,
      playerLegendCode: raw.playerLegendCode,
      opponentLegendCode: raw.opponentLegendCode,
      wentFirst: "1st",
      result: "Win",
      deckSnapshot: raw.deckSnapshot,
      event: { ...event, visibility: "public" }
    }, registry).ok).toBe(false);
  });

  it("strictly adapts community API drills and keeps official art/text", () => {
    expect(apiDeck().fingerprint).toBe("622cc0fec26ce3111d9d7797457bf00536d26ca91d17811d007edce3d0bed2d4");
    const result = parseMulliganLabApiResponse(apiResponse(), registry);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.accepted).toBe(1);
    expect(result.drills[0].observation.matchKey).toMatch(/^mm1_/);
    expect(result.drills[0].evidence.status).toBe("sufficient");
    expect(result.drills[0].cards[1]).toMatchObject({ code: "OGN-001", name: "Canonical Card 1", observedAction: "redrawn" });
    expect(result.drills[0].playerLegend.imageUrl).toContain("cmsassets.rgpub.io");
    expect(result.drills[0].deck.mainDeck.reduce((sum, card) => sum + card.count, 0)).toBe(40);
    expect(result.drills[0].cards[0].stats.evidenceStatus).toBe("limited");
    expect(mulliganLabChoiceFeedback(result.drills[0].cards[0].stats, false)).toBe("unclear");
  });

  it("strictly adapts holistic v2 matchup guidance without sampled-player decisions", () => {
    const result = parseMulliganLabApiResponse(apiV2Response(), registry);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const drill = result.drills[0];
    expect(drill.id).toMatch(/^ml2_/);
    expect(drill.observation).toBeUndefined();
    expect(drill.observedRedrawnCardIndexes).toBeUndefined();
    expect(drill.observedWin).toBeUndefined();
    expect(drill.evidence).toMatchObject({
      scope: "matchup",
      deckScope: "all-observed-decks",
      guidanceBasis: "community-keep-rate",
      outcomeInterpretation: "descriptive-not-causal"
    });
    expect(result).toMatchObject({
      observedFrom: "2026-07-11",
      observedThrough: "2026-08-12",
      includedFacts: 2_005,
      coverageTruncated: true,
      coveragePolicy: "all-available-history",
      includedPeriods: ["preseason", "current-season"],
      seasonCoverage: {
        currentSeasonStartedOn: "2026-07-31",
        preseasonFacts: 700,
        currentSeasonFacts: 1_305
      },
      backfillComplete: false
    });
    expect(drill.cards[0].stats).toMatchObject({
      offeredCount: 40,
      playerCount: 30,
      scope: "player-legend",
      identityCode: "OGN-001",
      scopeHands: 100,
      scopePlayers: 35,
      baselineKeepRate: .55,
      keptPlayerCount: 25,
      redrawnPlayerCount: 12,
      guidancePlayers: 25,
      guidanceKept: 18,
      guidanceKeepRate: 18 / 25,
      guidance: "keep",
      evidenceStatus: "robust",
      outcomeStatus: "one_sided"
    });
    expect(drill.cards[0].observedAction).toBeUndefined();
    expect(mulliganLabChoiceFeedback(drill.cards[0].stats, false)).toBe("general-aligned");
    expect(mulliganLabChoiceFeedback(drill.cards[0].stats, true)).toBe("general-different");
    expect(mulliganLabChoiceFeedback(drill.cards[2].stats, false)).toBe("aligned");
    expect(mulliganLabChoiceFeedback(drill.cards[2].stats, true)).toBe("conflicts");
    expect(mulliganLabChoiceFeedback(drill.cards[3].stats, false)).toBe("unclear");
  });

  it("strictly adapts a targeted full-corpus pack and prefers robust matching context", () => {
    const parsed = parseMulliganLabTargetPackResponse(apiTargetResponse(), registry);
    expect(parsed.status).toBe("ready");
    if (parsed.status !== "ready") return;
    expect(parsed.targetQuery).toMatchObject({
      requested: { playerLegend: "UNL-191", opponentLegend: "VEN-145", initiative: "first" },
      resolved: { scope: "exact-deck", sharedCards: 40, totalCards: 40 },
      fallbackReason: null
    });
    expect(parsed.drills[0].context).toEqual({
      curve: { classification: "two-drop-present", twoDropCount: 2, earlyUnitCount: 3 },
      battlefields: { player: null, opponent: null },
      duplicateIdentityCount: 1,
      setup: {
        chosenChampion: expect.objectContaining({ code: "OGN-014", name: "Canonical Card 14" }),
        replacementPoolCards: 35
      }
    });
    expect(parsed.drills[0].decisionEvidence).toEqual({
      scope: "matching-curve",
      hands: 40,
      players: 30,
      redrawCountHistogram: [
        { redraws: 0, hands: 4 },
        { redraws: 1, hands: 12 },
        { redraws: 2, hands: 24 }
      ],
      mostCommonRedrawCount: 2,
      twoRedrawRate: 0.6,
      evidenceStatus: "robust"
    });
    expect(mulliganLabChoiceEvidence(parsed.drills[0].cards[0].stats)).toMatchObject({
      scope: "matching-curve",
      guidance: "keep",
      evidenceStatus: "robust",
      guidancePlayers: 25
    });
    // Base evidence is Legend-wide, but independently gated matchup context
    // is sufficiently specific to support normal alignment feedback.
    expect(mulliganLabChoiceFeedback(parsed.drills[0].cards[0].stats, false)).toBe("aligned");
  });

  it("rejects targeted packs that omit context slices or claim a false exact-deck resolution", () => {
    const missingSlices = structuredClone(apiTargetResponse()) as any;
    delete missingSlices.drills[0].cardEvidence[0].slices;
    expect(parseMulliganLabTargetPackResponse(missingSlices, registry).status).toBe("invalid");

    const falseExact = structuredClone(apiTargetResponse()) as any;
    falseExact.query.resolved.deckFingerprint = "0".repeat(64);
    expect(parseMulliganLabTargetPackResponse(falseExact, registry).status).toBe("invalid");
  });

  it("requires the frozen target-only source and registered query metadata", () => {
    const missingRegistryTime = structuredClone(apiTargetResponse()) as any;
    delete missingRegistryTime.source.cardRegistryGeneratedAt;
    expect(parseMulliganLabTargetPackResponse(missingRegistryTime, registry).status).toBe("invalid");

    const wrongRegistrySize = structuredClone(apiTargetResponse()) as any;
    wrongRegistrySize.source.cardRegistryPrints += 1;
    expect(parseMulliganLabTargetPackResponse(wrongRegistrySize, registry).status).toBe("invalid");

    const invalidRegistryTime = structuredClone(apiTargetResponse()) as any;
    invalidRegistryTime.source.cardRegistryGeneratedAt = "2026-08-13";
    expect(parseMulliganLabTargetPackResponse(invalidRegistryTime, registry).status).toBe("invalid");

    const missingCoverage = structuredClone(apiTargetResponse()) as any;
    delete missingCoverage.source.coveragePolicy;
    delete missingCoverage.source.includedPeriods;
    delete missingCoverage.source.seasonCoverage;
    delete missingCoverage.source.backfillComplete;
    expect(parseMulliganLabTargetPackResponse(missingCoverage, registry).status).toBe("invalid");

    const nonLegendSelector = structuredClone(apiTargetResponse()) as any;
    nonLegendSelector.query.requested.playerLegend = "OGN-001";
    expect(parseMulliganLabTargetPackResponse(nonLegendSelector, registry).status).toBe("invalid");

    const unexpectedQueryField = structuredClone(apiTargetResponse()) as any;
    unexpectedQueryField.query.requested.userId = "must-not-be-trusted";
    expect(parseMulliganLabTargetPackResponse(unexpectedQueryField, registry).status).toBe("invalid");

    const reversedPeriods = structuredClone(apiTargetResponse()) as any;
    reversedPeriods.source.includedPeriods.reverse();
    expect(parseMulliganLabTargetPackResponse(reversedPeriods, registry).status).toBe("invalid");

    const unexpectedSeasonField = structuredClone(apiTargetResponse()) as any;
    unexpectedSeasonField.source.seasonCoverage.userCount = 100;
    expect(parseMulliganLabTargetPackResponse(unexpectedSeasonField, registry).status).toBe("invalid");
  });

  it("rejects internally contradictory ready target resolutions", () => {
    const exactWithFallback = structuredClone(apiTargetResponse()) as any;
    exactWithFallback.query.fallbackReason = "deck-not-observed";
    expect(parseMulliganLabTargetPackResponse(exactWithFallback, registry).status).toBe("invalid");

    const matchupWithoutOpponent = structuredClone(apiTargetResponse()) as any;
    matchupWithoutOpponent.query.requested.opponentLegend = null;
    matchupWithoutOpponent.query.requested.deckFingerprint = null;
    Object.assign(matchupWithoutOpponent.query.resolved, {
      scope: "matchup",
      deckFingerprint: null,
      sharedCards: null,
      totalCards: null
    });
    expect(parseMulliganLabTargetPackResponse(matchupWithoutOpponent, registry).status).toBe("invalid");

    const deckFallbackWithoutReason = structuredClone(apiTargetResponse()) as any;
    Object.assign(deckFallbackWithoutReason.query.resolved, {
      scope: "matchup",
      deckFingerprint: null,
      sharedCards: null,
      totalCards: null
    });
    expect(parseMulliganLabTargetPackResponse(deckFallbackWithoutReason, registry).status).toBe("invalid");

    const directPlayerWithFallback = structuredClone(apiTargetResponse()) as any;
    Object.assign(directPlayerWithFallback.query.requested, { opponentLegend: null, deckFingerprint: null });
    Object.assign(directPlayerWithFallback.query.resolved, {
      scope: "player-legend",
      deckFingerprint: null,
      sharedCards: null,
      totalCards: null
    });
    directPlayerWithFallback.query.fallbackReason = "matchup-not-observed";
    expect(parseMulliganLabTargetPackResponse(directPlayerWithFallback, registry).status).toBe("invalid");
  });

  it("requires every targeted drill to preserve player, narrow opponent, initiative, and exact deck", () => {
    const wrongPlayer = structuredClone(apiTargetResponse()) as any;
    wrongPlayer.drills[0].matchup.playerLegend = { cardCode: "OGS-019", name: "Master Yi, Wuju Bladesman (Starter)" };
    wrongPlayer.drills[0].evidence.playerLegendIdentityCode = "OGS-019";
    expect(parseMulliganLabTargetPackResponse(wrongPlayer, registry).status).toBe("invalid");

    const wrongOpponent = structuredClone(apiTargetResponse()) as any;
    wrongOpponent.drills[0].matchup.opponentLegend = { cardCode: "OGS-019", name: "Master Yi, Wuju Bladesman (Starter)" };
    wrongOpponent.drills[0].evidence.opponentLegendIdentityCode = "OGS-019";
    expect(parseMulliganLabTargetPackResponse(wrongOpponent, registry).status).toBe("invalid");

    const wrongInitiative = structuredClone(apiTargetResponse()) as any;
    wrongInitiative.drills[0].initiative = "second";
    expect(parseMulliganLabTargetPackResponse(wrongInitiative, registry).status).toBe("invalid");

    const wrongExactDeck = structuredClone(apiTargetResponse()) as any;
    wrongExactDeck.drills[0].deck.mainDeck[11].count = 2;
    wrongExactDeck.drills[0].deck.mainDeck[13].count = 2;
    wrongExactDeck.drills[0].deck.fingerprint = mulliganLabApiDeckFingerprint(
      wrongExactDeck.drills[0].deck.mainDeck.map((entry: any) => ({ code: entry.cardCode, count: entry.count }))
    );
    expect(parseMulliganLabTargetPackResponse(wrongExactDeck, registry).status).toBe("invalid");
  });

  it("keeps legitimate matchup and Player-Legend fallbacks broad", () => {
    const matchupFallback = structuredClone(apiTargetResponse()) as any;
    Object.assign(matchupFallback.query.resolved, {
      scope: "matchup",
      deckFingerprint: null,
      sharedCards: null,
      totalCards: null
    });
    matchupFallback.query.fallbackReason = "deck-not-observed";
    expect(parseMulliganLabTargetPackResponse(matchupFallback, registry).status).toBe("ready");

    const playerFallback = structuredClone(apiTargetResponse()) as any;
    Object.assign(playerFallback.query.resolved, {
      scope: "player-legend",
      deckFingerprint: null,
      sharedCards: null,
      totalCards: null
    });
    playerFallback.query.fallbackReason = "deck-not-observed";
    playerFallback.drills[0].matchup.opponentLegend = { cardCode: "OGS-019", name: "Master Yi, Wuju Bladesman (Starter)" };
    playerFallback.drills[0].evidence.opponentLegendIdentityCode = "OGS-019";
    expect(parseMulliganLabTargetPackResponse(playerFallback, registry).status).toBe("ready");
  });

  it("keeps the frozen unavailable matchup shape valid without applying ready-only fallback rules", () => {
    const unavailable = structuredClone(apiTargetResponse()) as any;
    Object.assign(unavailable, {
      status: "unavailable",
      generatedAt: null,
      expiresAt: null,
      source: null,
      drills: [],
      reason: "matchup_not_observed"
    });
    Object.assign(unavailable.query.requested, { deckFingerprint: null, initiative: null });
    Object.assign(unavailable.query.resolved, {
      scope: "matchup",
      deckFingerprint: null,
      sharedCards: null,
      totalCards: null
    });
    unavailable.query.fallbackReason = "matchup-not-observed";

    expect(parseMulliganLabTargetPackResponse(unavailable, registry)).toMatchObject({
      status: "unavailable",
      reason: "matchup_not_observed",
      targetQuery: {
        requested: { playerLegend: "UNL-191", opponentLegend: "VEN-145" },
        resolved: { scope: "matchup" }
      }
    });
  });

  it("accepts the all-history season contract while retaining legacy v2 packs", () => {
    const current = parseMulliganLabApiResponse(apiV2Response(), registry);
    expect(current).toMatchObject({
      status: "ready",
      coveragePolicy: "all-available-history",
      includedPeriods: ["preseason", "current-season"],
      seasonCoverage: {
        currentSeasonStartedOn: "2026-07-31",
        preseasonFacts: 700,
        currentSeasonFacts: 1_305
      },
      backfillComplete: false
    });

    const legacy = structuredClone(apiV2Response()) as any;
    delete legacy.source.coveragePolicy;
    delete legacy.source.includedPeriods;
    delete legacy.source.seasonCoverage;
    delete legacy.source.backfillComplete;
    expect(parseMulliganLabApiResponse(legacy, registry)).toMatchObject({
      status: "ready",
      coveragePolicy: null,
      includedPeriods: [],
      seasonCoverage: null,
      backfillComplete: null
    });
  });

  it("rejects partial or unrecognised all-history metadata", () => {
    const partial = structuredClone(apiV2Response()) as any;
    delete partial.source.seasonCoverage;
    expect(parseMulliganLabApiResponse(partial, registry).status).toBe("invalid");

    const inconsistentCounts = structuredClone(apiV2Response()) as any;
    inconsistentCounts.source.seasonCoverage.currentSeasonFacts = 1_304;
    expect(parseMulliganLabApiResponse(inconsistentCounts, registry).status).toBe("invalid");

    const inconsistentPeriods = structuredClone(apiV2Response()) as any;
    inconsistentPeriods.source.includedPeriods = ["current-season"];
    expect(parseMulliganLabApiResponse(inconsistentPeriods, registry).status).toBe("invalid");

    const wrongSeasonBoundary = structuredClone(apiV2Response()) as any;
    wrongSeasonBoundary.source.seasonCoverage.currentSeasonStartedOn = "2026-08-01";
    expect(parseMulliganLabApiResponse(wrongSeasonBoundary, registry).status).toBe("invalid");
  });

  it("grades duplicate gameplay identities once and leaves mixed copy choices ungraded", () => {
    const result = parseMulliganLabApiResponse(apiV2Response(), registry);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const cards = result.drills[0].cards;

    const kept = mulliganLabIdentityDecisions(cards, []);
    expect(kept).toHaveLength(3);
    expect(kept[0]).toMatchObject({ identityCode: "OGN-001", cardIndexes: [0, 1], userAction: "keep", feedback: "general-aligned" });

    const redrawn = mulliganLabIdentityDecisions(cards, [0, 1]);
    expect(redrawn[0]).toMatchObject({ userAction: "redraw", feedback: "general-different" });

    const split = mulliganLabIdentityDecisions(cards, [0]);
    expect(split[0]).toMatchObject({ userAction: "mixed", feedback: "mixed-copy" });
    expect(split.filter((decision) => decision.feedback === "mixed-copy")).toHaveLength(1);
  });

  it("rejects v2 provenance leakage and inconsistent holistic evidence", () => {
    const leaked = structuredClone(apiV2Drill()) as ReturnType<typeof apiV2Drill> & { observedDecision?: unknown };
    leaked.observedDecision = { redrawnCardIndexes: [0], wonGame: true };
    const badCounts = structuredClone(apiV2Drill());
    badCounts.id = `ml2_${"6".repeat(32)}`;
    badCounts.cardEvidence[0].keepRate = .9;
    const badScope = structuredClone(apiV2Drill());
    badScope.id = `ml2_${"7".repeat(32)}`;
    badScope.evidence.scope = "matchup-initiative";
    const result = parseMulliganLabApiResponse(apiV2Response([leaked, badCounts, badScope]), registry);
    expect(result.status).toBe("invalid");
    expect(result.issues.some((item) => item.message.includes("sampled-player provenance"))).toBe(true);
    expect(result.issues.some((item) => item.path.endsWith("keepRate"))).toBe(true);
    expect(result.issues.some((item) => item.message.includes("full oriented legend matchup"))).toBe(true);
  });

  it("rejects guidance rates that do not match contributor-balanced votes", () => {
    const inconsistent = structuredClone(apiV2Drill());
    inconsistent.cardEvidence[0].guidanceKeepRate = .99;
    const result = parseMulliganLabApiResponse(apiV2Response([inconsistent]), registry);
    expect(result.status).toBe("invalid");
    expect(result.issues.some((item) => item.path.endsWith("guidanceKeepRate"))).toBe(true);

    const suppressed = structuredClone(apiV2Drill());
    suppressed.cardEvidence[0].guidance = "mixed";
    const suppressedResult = parseMulliganLabApiResponse(apiV2Response([suppressed]), registry);
    expect(suppressedResult.status).toBe("invalid");
    expect(suppressedResult.issues.some((item) => item.path.endsWith("guidance"))).toBe(true);
  });

  it("does not grade developing v2 tendencies", () => {
    const developing = structuredClone(apiV2Drill());
    developing.cardEvidence[0].evidenceStatus = "developing";
    developing.cardEvidence[0].guidance = "unclear";
    developing.cardEvidence[0].guidancePlayers = 9;
    developing.cardEvidence[0].guidanceKept = 6;
    developing.cardEvidence[0].guidanceKeepRate = 6 / 9;
    const parsed = parseMulliganLabApiResponse(apiV2Response([developing]), registry);
    expect(parsed.status).toBe("ready");
    if (parsed.status !== "ready") return;
    expect(mulliganLabChoiceFeedback(parsed.drills[0].cards[0].stats, false)).toBe("developing");
    expect(mulliganLabChoiceFeedback(parsed.drills[0].cards[0].stats, true)).toBe("developing");
  });

  it("treats 25 observed hands from 10 contributor-balanced players as robust", () => {
    const threshold = structuredClone(apiV2Drill());
    threshold.cardEvidence[0] = {
      ...threshold.cardEvidence[0],
      guidancePlayers: 10,
      guidanceKept: 9,
      guidanceKeepRate: 9 / 10,
      guidance: "strong_keep",
      evidenceStatus: "robust"
    };
    const parsed = parseMulliganLabApiResponse(apiV2Response([threshold]), registry);
    expect(parsed.status).toBe("ready");
    if (parsed.status !== "ready") return;
    expect(parsed.drills[0].cards[0].stats).toMatchObject({
      guidancePlayers: 10,
      evidenceStatus: "robust",
      guidance: "strong_keep"
    });
  });

  it("accepts reliable player-legend fallback when the exact matchup cohort is thin", () => {
    const fallback = structuredClone(apiV2Drill());
    fallback.evidence = { ...fallback.evidence, status: "early", hands: 8, players: 4 };
    fallback.cardEvidence = fallback.cardEvidence.map((entry) => ({
      ...entry,
      scope: "player-legend" as const,
      scopeHands: 100,
      scopePlayers: Math.max(entry.players, 35)
    }));
    const parsed = parseMulliganLabApiResponse(apiV2Response([fallback]), registry);
    expect(parsed.status).toBe("ready");
    if (parsed.status !== "ready") return;
    expect(parsed.drills[0].evidence.status).toBe("early");
    expect(parsed.drills[0].cards[0].stats).toMatchObject({ scope: "player-legend", evidenceStatus: "robust" });
    expect(mulliganLabChoiceFeedback(parsed.drills[0].cards[0].stats, false)).toBe("general-aligned");
    expect(mulliganLabChoiceFeedback(parsed.drills[0].cards[0].stats, true)).toBe("general-different");
  });

  it("never uses outcome associations to grade a choice", () => {
    const result = parseMulliganLabApiResponse(apiV2Response(), registry);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const stats = result.drills[0].cards[0].stats;
    const feedback = mulliganLabChoiceFeedback(stats, false);
    expect(mulliganLabChoiceFeedback({
      ...stats,
      keptWinRate: 0,
      redrawnWinRate: 1,
      winRateDelta: -1,
      outcomeStatus: "comparable"
    }, false)).toBe(feedback);
  });

  it("accepts backend strong signals even when the broad baseline is more extreme", () => {
    const strong = structuredClone(apiV2Drill());
    strong.cardEvidence[0] = {
      ...strong.cardEvidence[0],
      baselineKeepRate: .95,
      kept: 36,
      keptPlayers: 11,
      redrawn: 4,
      redrawnPlayers: 4,
      keptWins: 20,
      redrawnWins: 2,
      keepRate: 36 / 40,
      guidancePlayers: 25,
      guidanceKept: 23,
      guidanceKeepRate: 23 / 25,
      keptWinRate: 20 / 36,
      redrawnWinRate: 2 / 4,
      winRateDelta: 20 / 36 - 2 / 4,
      guidance: "strong_keep",
      outcomeStatus: "one_sided"
    };
    strong.cardEvidence[1] = {
      ...strong.cardEvidence[1],
      baselineKeepRate: .05,
      kept: 3,
      keptPlayers: 3,
      redrawn: 27,
      redrawnPlayers: 11,
      keptWins: 1,
      redrawnWins: 15,
      keepRate: 3 / 30,
      guidancePlayers: 25,
      guidanceKept: 2,
      guidanceKeepRate: 2 / 25,
      keptWinRate: 1 / 3,
      redrawnWinRate: 15 / 27,
      winRateDelta: 1 / 3 - 15 / 27,
      guidance: "strong_redraw",
      outcomeStatus: "one_sided"
    };
    const parsed = parseMulliganLabApiResponse(apiV2Response([strong]), registry);
    expect(parsed.status).toBe("ready");
    if (parsed.status !== "ready") return;
    expect(parsed.drills[0].cards[0].stats.guidance).toBe("strong_keep");
    expect(parsed.drills[0].cards[2].stats.guidance).toBe("strong_redraw");
  });

  it("matches saved 40-card snapshots and Atlas 39-card plus champion snapshots to the backend fingerprint", () => {
    const flattened = JSON.stringify({ mainDeck: deckEntries() });
    const atlas = JSON.stringify({
      mainDeck: deckEntries().slice(0, -1),
      champion: [{ cardCode: "OGN-014", name: "Canonical Card 14", count: 1 }]
    });
    const expected = apiDeck().fingerprint;
    expect(mulliganLabApiDeckFingerprintFromSnapshot(flattened, registry)).toBe(expected);
    expect(mulliganLabApiDeckFingerprintFromSnapshot(atlas, registry)).toBe(expected);

    const bareThirtyNine = JSON.stringify({ mainDeck: deckEntries().slice(0, -1) });
    expect(mulliganLabApiDeckFingerprintFromSnapshot(bareThirtyNine, registry)).toBe("");

    const variantDeck = deckEntries();
    variantDeck[variantDeck.length - 1] = { cardId: "VEN-038a", qty: 1 };
    const canonicalVariantFingerprint = mulliganLabApiDeckFingerprint(variantDeck.map((entry) => ({
      code: entry.cardId.toUpperCase(),
      count: entry.qty
    })));
    expect(mulliganLabApiDeckFingerprintFromSnapshot(JSON.stringify({ mainDeck: variantDeck }), registry))
      .toBe(canonicalVariantFingerprint);
  });

  it("accepts backend-canonicalized registry names and rejects Atlas display aliases", () => {
    const canonical = structuredClone(apiDrill());
    canonical.matchup.playerLegend = { cardCode: "OGS-019", name: "Master Yi, Wuju Bladesman (Starter)" };
    const accepted = parseMulliganLabApiResponse(apiResponse([canonical]), registry);
    expect(accepted.status).toBe("ready");
    if (accepted.status === "ready") {
      expect(accepted.drills[0].playerLegend).toMatchObject({
        code: "OGS-019",
        name: "Master Yi, Wuju Bladesman (Starter)"
      });
    }

    canonical.matchup.playerLegend.name = "Master Yi, Wuju Bladesman";
    const rejected = parseMulliganLabApiResponse(apiResponse([canonical]), registry);
    expect(rejected.status).toBe("invalid");
    expect(rejected.issues.some((item) => item.path.endsWith("matchup.playerLegend.name"))).toBe(true);
  });

  it("keeps alternate exact art while validating its pooled base identity", () => {
    const signed = structuredClone(apiV2Drill());
    signed.id = `ml2_${"8".repeat(32)}`;
    signed.hand = signed.hand.map((card) => card.cardCode === "OGN-001" ? { cardCode: "VEN-038A", name: "Canonical Alternate Print" } : card);
    signed.cardEvidence = signed.cardEvidence.filter((entry) => entry.cardCode !== "OGN-001");
    signed.cardEvidence.push({
      ...apiV2Drill().cardEvidence[0],
      cardCode: "VEN-038A",
      name: "Canonical Alternate Print",
      identityCode: "VEN-038"
    });
    signed.deck.mainDeck = signed.deck.mainDeck.map((entry, index) => index === 0
      ? { cardCode: "VEN-038A", name: "Canonical Alternate Print", count: entry.count }
      : entry);
    signed.deck.fingerprint = mulliganLabApiDeckFingerprint(signed.deck.mainDeck.map((entry) => ({ code: entry.cardCode, count: entry.count })));
    const parsed = parseMulliganLabApiResponse(apiV2Response([signed]), registry);
    expect(parsed.status).toBe("ready");
    if (parsed.status !== "ready") return;
    expect(parsed.drills[0].cards[0]).toMatchObject({ code: "VEN-038A", name: "Canonical Alternate Print", stats: { identityCode: "VEN-038" } });
    expect(parsed.drills[0].cards[0].imageUrl).toContain("cmsassets.rgpub.io");
  });

  it("quarantines tampered names, deck hashes, and evidence while preserving valid drills", () => {
    const badName = structuredClone(apiDrill());
    badName.hand[0].name = "Invented Card";
    badName.id = `ml1_${"5".repeat(32)}`;
    const badHash = structuredClone(apiDrill());
    badHash.deck.fingerprint = "0".repeat(64);
    badHash.id = `ml1_${"6".repeat(32)}`;
    const badEvidence = structuredClone(apiDrill());
    badEvidence.cardEvidence[0].kept = 29;
    badEvidence.id = `ml1_${"7".repeat(32)}`;
    const result = parseMulliganLabApiResponse(apiResponse([apiDrill(), badName, badHash, badEvidence]), registry);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(3);
    expect(result.issues.some((item) => item.path.endsWith(".name"))).toBe(true);
    expect(result.issues.some((item) => item.path.endsWith("deck.fingerprint"))).toBe(true);
  });

  it("does not replace an unavailable community pack with demo data", () => {
    const result = parseMulliganLabApiResponse({
      ...apiResponse([]),
      status: "unavailable",
      generatedAt: null,
      expiresAt: null,
      reason: "data_unavailable"
    }, registry);
    expect(result).toMatchObject({ status: "unavailable", drills: [], accepted: 0, rejected: 0 });
  });

  it("requires explicit empty source coverage on unavailable v2 responses", () => {
    const response = apiV2Response([]);
    const unavailable = {
      ...response,
      status: "unavailable",
      generatedAt: null,
      expiresAt: null,
      drills: [],
      reason: "data_unavailable",
      source: {
        ...response.source,
        observedFrom: null,
        observedThrough: null,
        includedFacts: 0,
        coverageTruncated: false,
        includedPeriods: [],
        seasonCoverage: {
          currentSeasonStartedOn: "2026-07-31",
          preseasonFacts: 0,
          currentSeasonFacts: 0
        },
        backfillComplete: false
      }
    };
    expect(parseMulliganLabApiResponse(unavailable, registry)).toMatchObject({ status: "unavailable", observedFrom: null, includedFacts: 0 });
    unavailable.source.includedFacts = 1;
    expect(parseMulliganLabApiResponse(unavailable, registry).status).toBe("invalid");
  });

  it("rejects packs larger than the bounded 64-drill backend contract", () => {
    const oversized = Array.from({ length: 65 }, () => structuredClone(apiDrill()));
    const result = parseMulliganLabApiResponse(apiResponse(oversized), registry);
    expect(result.status).toBe("invalid");
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: "drills",
      message: "Ready responses require between 1 and 64 drills."
    }));
  });

  it("publishes early real aggregate counts without presenting them as sufficient evidence", () => {
    const sparse = structuredClone(apiDrill());
    sparse.evidence.hands = 7;
    sparse.evidence.players = 4;
    sparse.evidence.status = "early";
    sparse.cardEvidence = sparse.cardEvidence.map((entry) => ({
      ...entry,
      offered: Math.min(entry.offered, 7),
      kept: Math.min(entry.kept, 5),
      redrawn: 0,
      keptWins: Math.min(entry.keptWins, Math.min(entry.kept, 5)),
      redrawnWins: 0
    })).map((entry) => ({ ...entry, redrawn: entry.offered - entry.kept }));
    const result = parseMulliganLabApiResponse(apiResponse([sparse]), registry);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.drills[0].evidence).toMatchObject({ status: "early", scope: "matchup-initiative", hands: 7, players: 4 });
    expect(result.drills[0].cards.every((card) => card.stats.offeredCount > 0)).toBe(true);

    delete (sparse as Partial<typeof sparse>).cardEvidence;
    const missing = parseMulliganLabApiResponse(apiResponse([sparse]), registry);
    expect(missing.status).toBe("invalid");
    expect(missing.issues.some((item) => item.message.includes("raw card evidence"))).toBe(true);
  });
});
