import { describe, expect, it } from "vitest";
import {
  buildReplayInsights,
  replayInsightEventsFromRawPayload,
  replayInsightOpeningHandEventsFromRawPayload,
  type ReplayInsightCardCatalogEntry
} from "../src/shared/replayInsights.js";
import { replayWithIntelligence } from "../src/shared/replayIntelligence.js";
import { parseReplayCardActionText } from "../src/shared/replayCardText.js";
import type {
  MatchDraft,
  ReplayIntelligenceCorrection,
  ReplayRecord,
  ReplayStructuredCard,
  ReplayStructuredEvent
} from "../src/shared/types.js";

const START = "2026-08-24T10:00:00.000Z";
const LATE_CARD: ReplayStructuredCard = { id: "late", code: "TST-005", name: "Patient Guardian", type: "unit", imageUrl: "" };
const TWO_DROP: ReplayStructuredCard = { id: "two", code: "TST-002", name: "Swift Scout", type: "unit", imageUrl: "" };
const CHOSEN_CHAMPION: ReplayStructuredCard = { id: "chosen-akali", code: "VEN-021", name: "Akali, Deadly Weapon", type: "unit", imageUrl: "" };
const ORDINARY_CHAMPION: ReplayStructuredCard = { id: "deck-champion", code: "TST-077", name: "Garen, Resolute Protector", type: "unit", imageUrl: "" };
const CATALOG: ReplayInsightCardCatalogEntry[] = [
  { code: LATE_CARD.code, name: LATE_CARD.name, costEnergy: 5 },
  { code: TWO_DROP.code, name: TWO_DROP.name, costEnergy: 2 },
  { code: CHOSEN_CHAMPION.code, name: CHOSEN_CHAMPION.name, costEnergy: 4 },
  { code: ORDINARY_CHAMPION.code, name: ORDINARY_CHAMPION.name, costEnergy: 3 }
];

function event(id: string, seconds: number, type: ReplayStructuredEvent["type"], patch: Partial<ReplayStructuredEvent> = {}): ReplayStructuredEvent {
  return {
    id,
    sourceEventId: `source:${id}`,
    gameNumber: 1,
    capturedAt: new Date(Date.parse(START) + seconds * 1000).toISOString(),
    labelTime: `10:${String(Math.floor(seconds / 60)).padStart(2, "0")}`,
    type,
    side: "me",
    text: type,
    cardName: "",
    destination: "",
    battlefield: "",
    ...patch
  };
}

function replay(id: string, structuredEvents: ReplayStructuredEvent[]): ReplayRecord {
  return {
    id,
    matchId: `match-${id}`,
    platform: "sim",
    capturedAt: START,
    title: "Ahri vs Jinx",
    players: { me: "Player", opponent: "Opponent" },
    events: [],
    structuredEvents,
    video: {
      id: `video-${id}`,
      path: `C:/replays/${id}.webm`,
      url: `riftlite-video://${id}`,
      filename: `${id}.webm`,
      directory: "C:/replays",
      mimeType: "video/webm",
      source: "game-frame-direct",
      platform: "sim",
      startedAt: START,
      endedAt: new Date(Date.parse(START) + 180_000).toISOString(),
      durationMs: 180_000,
      sizeBytes: 1_000,
      width: 1920,
      height: 1080,
      fps: 30,
      captureIntervalMs: 33,
      bitrateKbps: 6_000,
      codec: "vp9",
      quality: "balanced",
      hasAudio: false,
      containerFinalized: true
    }
  };
}

function match(id: string, opponentChampion = "Jinx"): MatchDraft {
  return {
    id: `match-${id}`,
    platform: "sim",
    status: "saved",
    capturedAt: START,
    updatedAt: START,
    result: "Win",
    format: "Bo1",
    score: "1-0",
    myName: "Player",
    opponentName: "Opponent",
    myChampion: "Ahri",
    opponentChampion,
    myBattlefield: "",
    opponentBattlefield: "",
    deckName: "Tempo Ahri",
    deckSourceId: "deck-ahri",
    flags: "",
    notes: "",
    games: [{ gameNumber: 1, result: "Win", wentFirst: "1st" }],
    rawEvidence: [],
    sync: { community: "disabled", hubs: {}, teams: {} }
  };
}

function lateKeepEvents(card: ReplayStructuredCard = LATE_CARD, includePlay = true): ReplayStructuredEvent[] {
  const events = [
    event("mulligan", 1, "mulligan", {
      text: "Player completed mulligan",
      mulligan: { options: [card, TWO_DROP], kept: [card], redrawn: [TWO_DROP], redrawCount: 1 }
    }),
    event("setup-complete", 5, "setup", { side: "system", text: "Both mulligans are complete; starting the game" }),
    event("turn-1", 10, "turn-start", { side: "me", text: "Player's turn" }),
    event("turn-1-action", 12, "action", { side: "me", text: "Player readied runes" }),
    event("turn-2", 25, "turn-start", { side: "opponent", text: "Opponent's turn" }),
    event("turn-2-action", 28, "action", { side: "opponent", text: "Opponent played a card" }),
    event("turn-3", 45, "turn-start", { side: "me", text: "Player's turn" }),
    event("turn-3-action", 48, "action", { side: "me", text: "Player passed" }),
    event("turn-4", 65, "turn-start", { side: "opponent", text: "Opponent's turn" }),
    event("turn-4-action", 68, "action", { side: "opponent", text: "Opponent passed" }),
    event("turn-5", 85, "turn-start", { side: "me", text: "Player's turn" })
  ];
  if (includePlay) {
    events.push(
      event("turn-6", 100, "turn-start", { side: "opponent", text: "Opponent's turn" }),
      event("turn-7", 110, "turn-start", { side: "me", text: "Player's turn" }),
      event("late-play", 115, "play", {
      text: `Player played ${card.name}`,
      cardName: card.name,
      cardId: card.code,
      fromZone: "hand",
      toZone: "battlefield"
      })
    );
  } else {
    events.push(
      event("turn-6", 100, "turn-start", { side: "opponent", text: "Opponent's turn" }),
      event("turn-7", 110, "turn-start", { side: "me", text: "Player's turn" })
    );
  }
  events.push(event("result", 140, "result", { side: "system", text: "Player won" }));
  return events;
}

function raw(seq: number, payload: unknown, ts = 1781360000000 + seq * 1000) {
  return { seq, ts, dir: "in", raw: JSON.stringify(payload) };
}

interface ExpectedReplayStats {
  completedGames: number;
  battlefieldPickOrders: Array<{
    sequence: string[];
    games: number;
    percentage: number;
    evidence: Array<{ replayId: string; eventId?: string }>;
  }>;
  cardSourceZones: Array<{
    cardName: string;
    cardId?: string;
    totalPlays: number;
    hand: number;
    hidden: number;
    trash: number;
    deck: number;
    other: number;
    unknown: number;
    handPercent: number;
    hiddenPercent: number;
    evidence: Array<{ replayId: string; eventId?: string }>;
  }>;
  cardTurnOutcomes: Array<{
    cardName: string;
    cardId?: string;
    playerTurnNumber: number;
    games: number;
    wins: number;
    losses: number;
    winRate: number;
    baselineGames: number;
    baselineWins: number;
    baselineWinRate: number;
    baselineEligibility: "known-visible-by-player-turn";
    sampleState: "insufficient" | "early" | "established";
    correlationLabel: string;
    evidence: Array<{ replayId: string; eventId?: string }>;
  }>;
}

function replayStats(report: ReturnType<typeof buildReplayInsights>): ExpectedReplayStats {
  return (report as typeof report & { stats: ExpectedReplayStats }).stats;
}

function turnsWithPlay(
  cardName: string,
  playerTurnNumber: number,
  patch: Partial<ReplayStructuredEvent> = {}
): ReplayStructuredEvent[] {
  const events: ReplayStructuredEvent[] = [];
  let seconds = 10;
  for (let turn = 1; turn <= playerTurnNumber; turn += 1) {
    events.push(event(`my-turn-${turn}`, seconds, "turn-start", {
      side: "me",
      text: "Player's turn"
    }));
    seconds += 10;
    if (turn < playerTurnNumber) {
      events.push(event(`opponent-turn-${turn}`, seconds, "turn-start", {
        side: "opponent",
        text: "Opponent's turn"
      }));
      seconds += 10;
    }
  }
  events.push(event(`play-${cardName}-${playerTurnNumber}`, seconds + 2, "play", {
    side: "me",
    text: `Played ${cardName} from hand.`,
    cardName,
    fromZone: "hand",
    toZone: "chain",
    ...patch
  }));
  return events;
}

function matchWithResult(id: string, result: "Win" | "Loss"): MatchDraft {
  return {
    ...match(id),
    result,
    score: result === "Win" ? "1-0" : "0-1",
    games: [{ gameNumber: 1, result, wentFirst: "1st" }]
  };
}

describe("Replay Insights", () => {
  it("recognizes hidden and top-of-deck play origins in action text", () => {
    expect(parseReplayCardActionText("Played Charm from hidden.")?.fromZone).toBe("hidden");
    expect(parseReplayCardActionText("Played Charm from top of the deck.")?.fromZone).toBe("top of the deck");
  });

  it("does not turn generic draws or incidental conquest clauses into named cards", () => {
    expect(parseReplayCardActionText("Drew 1 card.")).toBeNull();
    expect(parseReplayCardActionText("Moved 1 card from Rockfall Path to trash.")).toBeNull();
    expect(parseReplayCardActionText("BMU conquered Vilemaw's Lair and drew 1.")).toBeNull();
    expect(parseReplayCardActionText("BMU played Charm.")?.name).toBe("Charm");
    expect(parseReplayCardActionText("19:19Drew Charm.")?.name).toBe("Charm");
  });

  it("uses the player's own turn number for a late kept-card observation", () => {
    const source = replay("late-keep", lateKeepEvents());
    const report = buildReplayInsights([source], [match("late-keep")], { cardCatalog: CATALOG, now: START });
    const insight = report.insights.find((item) => item.id.includes("late-opening-card"));

    expect(insight).toMatchObject({
      title: "Patient Guardian's first captured play was on your turn 4",
      tone: "opportunity",
      confidence: "confirmed",
      captureConfidence: "confirmed",
      patternStrength: "single-observation",
      claimBasis: "observational",
      replayId: source.id,
      gameNumber: 1,
      cardName: LATE_CARD.name
    });
    expect(insight?.body).toContain("played copy cannot be linked to the kept copy");
    expect(insight?.evidence.map((evidence) => evidence.eventId)).toEqual(["mulligan", "late-play"]);
    expect(insight?.evidence[1]?.videoTimeMs).toBe(115_000);
  });

  it("reports an opening keep with no captured play without claiming a legal mistake", () => {
    const source = replay("unused-keep", lateKeepEvents(LATE_CARD, false));
    const report = buildReplayInsights([source], [match("unused-keep")], { cardCatalog: CATALOG, now: START });
    const insight = report.insights.find((item) => item.id.includes("unplayed-opening-card"));

    expect(insight?.title).toBe("No play of Patient Guardian was captured in a game with a keep");
    expect(`${insight?.body} ${insight?.action}`.toLowerCase()).not.toContain("playable");
    expect(`${insight?.body} ${insight?.action}`.toLowerCase()).not.toContain("mistake");
    expect(insight?.dataReceipt).toMatchObject({
      observationCount: 1,
      scopeGames: 1,
      completedScopeGames: 1,
      completePlayCaptureScopeGames: 1,
      playCaptureStatus: "complete-enough"
    });
  });

  it("does not turn a partial capture into an absence claim", () => {
    const source = replay("partial-unused-keep", [
      event("partial-mulligan", 1, "mulligan", {
        text: "Opening hand recorded",
        mulligan: { kept: [LATE_CARD], redrawn: [], redrawCount: 0 }
      }),
      event("partial-turn", 10, "turn-start", { text: "Player's turn" })
    ]);
    const report = buildReplayInsights([source], [match(source.id)], { cardCatalog: CATALOG, now: START });

    expect(report.insights.some((item) => item.id.includes("unplayed-opening-card"))).toBe(false);
    expect(report.cards[0]).toMatchObject({
      cardName: LATE_CARD.name,
      unplayed: 0,
      completePlayCaptureAppearances: 0
    });
  });

  it("does not make a no-play claim when the same card name has an untrusted-stage play", () => {
    const source = replay("unknown-stage-blocks-absence", [
      ...lateKeepEvents(LATE_CARD, false),
      event("unknown-stage-late-play", 115, "play", {
        gameNumber: 0,
        cardName: LATE_CARD.name,
        cardId: LATE_CARD.code,
        fromZone: "hand",
        toZone: "battlefield"
      })
    ]);
    const report = buildReplayInsights([source], [match(source.id)], { cardCatalog: CATALOG, now: START });
    const card = report.cards.find((item) => item.cardName === LATE_CARD.name);

    expect(card?.prePlayHand).toMatchObject({ observedGames: 1, laterPlayedGames: 0, noCapturedPlayGames: 0 });
    expect(card?.playReach).toEqual({ preboardGames: 0, postboardGames: 0, unknownStageGames: 1 });
    expect(report.insights.some((item) => item.id.includes("unplayed-opening-card"))).toBe(false);
  });

  it("does not make a drawn-unplayed claim when a same-name play has an untrusted stage", () => {
    const source = replay("unknown-stage-blocks-drawn-unplayed", [
      event("known-draw", 12, "draw", {
        cardName: LATE_CARD.name,
        cardId: LATE_CARD.code,
        fromZone: "deck",
        toZone: "hand"
      }),
      event("known-recycle", 20, "move", {
        cardName: LATE_CARD.name,
        cardId: LATE_CARD.code,
        fromZone: "hand",
        toZone: "recycle"
      }),
      event("unknown-stage-play", 30, "play", {
        gameNumber: 0,
        cardName: LATE_CARD.name,
        cardId: LATE_CARD.code,
        fromZone: "hand",
        toZone: "battlefield"
      })
    ]);
    const report = buildReplayInsights([source], [match(source.id)], { cardCatalog: CATALOG, now: START });

    expect(report.insights.some((item) => item.id.includes("drawn-unplayed"))).toBe(false);
    expect(report.cards.find((item) => item.cardName === LATE_CARD.name)?.recycledOrDiscarded).toBe(1);
  });

  it("keeps inferred opening evidence out of an otherwise confirmed hand-conversion journey", () => {
    const inferredOpeningEvents = lateKeepEvents().map((item) => (
      item.id === "mulligan"
        ? { ...item, evidence: { source: "state-diff" as const, confidence: "inferred" as const } }
        : item
    ));
    const source = replay("inferred-opening-rates", inferredOpeningEvents);
    const report = buildReplayInsights([source], [match(source.id)], { cardCatalog: CATALOG, now: START });
    const card = report.cards.find((item) => item.cardName === LATE_CARD.name);

    expect(card).toMatchObject({ kept: 1, played: 1, playReach: { preboardGames: 1, postboardGames: 0, unknownStageGames: 0 } });
    expect(card?.mulligan).toEqual({ offeredGames: 0, keptGames: 0, redrawnGames: 0, latePlayedGames: 0 });
    expect(card?.prePlayHand).toEqual({
      observedGames: 0,
      laterPlayedGames: 0,
      noCapturedPlayGames: 0,
      recycledOrDiscardedGames: 0
    });
    expect(card?.firstPlayTurns).toEqual({
      byTurn3Games: 0,
      turns4To5Games: 1,
      turn6PlusGames: 0,
      unknownTurnGames: 0
    });

    const inferredPlaySource = replay("inferred-play-rates", lateKeepEvents().map((item) => (
      item.id === "late-play"
        ? { ...item, evidence: { source: "state-diff" as const, confidence: "inferred" as const } }
        : item
    )));
    const inferredPlayReport = buildReplayInsights(
      [inferredPlaySource],
      [match(inferredPlaySource.id)],
      { cardCatalog: CATALOG, now: START }
    );
    const inferredPlayCard = inferredPlayReport.cards.find((item) => item.cardName === LATE_CARD.name);
    expect(inferredPlayCard).toMatchObject({
      confidence: "inferred",
      played: 0,
      playReach: { preboardGames: 0, postboardGames: 0, unknownStageGames: 0 }
    });
    expect(inferredPlayCard?.mulligan).toEqual({ offeredGames: 1, keptGames: 1, redrawnGames: 0, latePlayedGames: 0 });
    expect(inferredPlayCard?.prePlayHand).toMatchObject({ observedGames: 1, laterPlayedGames: 0 });
    expect(inferredPlayCard?.firstPlayTurns).toEqual({ byTurn3Games: 0, turns4To5Games: 0, turn6PlusGames: 0, unknownTurnGames: 0 });
    expect(inferredPlayReport.stats).toMatchObject({ capturedLocalPlays: 0, knownSourcePlays: 0 });
    expect(inferredPlayReport.stats.cardSourceZones).toEqual([]);
    expect(inferredPlayReport.stats.cardTurnOutcomes).toEqual([]);
  });

  it("keeps verified play reach while separating inferred hand evidence event by event", () => {
    const inferredDraw = event("mixed-draw", 12, "draw", {
      cardName: LATE_CARD.name,
      cardId: LATE_CARD.code,
      fromZone: "deck",
      toZone: "hand",
      evidence: { source: "state-diff", confidence: "inferred" }
    });
    const confirmedPlay = event("mixed-play", 42, "play", {
      cardName: LATE_CARD.name,
      cardId: LATE_CARD.code,
      fromZone: "hand",
      toZone: "battlefield"
    });
    const report = buildReplayInsights([
      replay("mixed-confidence", [
        event("mixed-turn-1", 10, "turn-start", { text: "Player's turn" }),
        inferredDraw,
        confirmedPlay
      ])
    ], [match("mixed-confidence")], { cardCatalog: CATALOG, now: START });
    const card = report.cards.find((item) => item.cardName === LATE_CARD.name);

    expect(card).toMatchObject({
      played: 1,
      playReach: { preboardGames: 1, postboardGames: 0, unknownStageGames: 0 },
      prePlayHand: { observedGames: 0, laterPlayedGames: 0 }
    });
    expect(report.stats.cardSourceZones.find((row) => row.cardName === LATE_CARD.name)?.evidence.map((item) => item.eventId)).toEqual(["mixed-play"]);
  });

  it("does not let an inferred play suppress a later confirmed play", () => {
    const source = replay("mixed-play-confidence", [
      event("mixed-first-turn", 10, "turn-start", { text: "Player's turn" }),
      event("mixed-inferred-play", 12, "play", {
        cardName: "Charm",
        cardId: "TST-100",
        fromZone: "hand",
        evidence: { source: "state-diff", confidence: "inferred" }
      }),
      event("mixed-opponent-turn", 20, "turn-start", { side: "opponent", text: "Opponent's turn" }),
      event("mixed-second-turn", 30, "turn-start", { text: "Player's turn" }),
      event("mixed-confirmed-play", 32, "play", { cardName: "Charm", cardId: "TST-100", fromZone: "hand" })
    ]);
    const report = buildReplayInsights([source], [matchWithResult(source.id, "Win")], {
      cardCatalog: [{ code: "TST-100", name: "Charm" }],
      now: START
    });
    const card = report.cards.find((item) => item.cardName === "Charm");
    const sourceRow = report.stats.cardSourceZones.find((row) => row.cardName === "Charm");

    expect(card).toMatchObject({ played: 1, playReach: { preboardGames: 1, postboardGames: 0, unknownStageGames: 0 } });
    expect(sourceRow).toMatchObject({ totalPlays: 1, hand: 1 });
    expect(sourceRow?.evidence.map((item) => item.eventId)).toEqual(["mixed-confirmed-play"]);
  });

  it("keeps missing or globally untrusted game numbers out of G1 and post-board buckets", () => {
    const unknownEvents = turnsWithPlay("Charm", 1, { cardId: "TST-100" }).map((item) => ({ ...item, gameNumber: 0 }));
    const unknownSource = replay("unknown-stage", unknownEvents);
    const all = buildReplayInsights([unknownSource], [matchWithResult(unknownSource.id, "Win")], {
      cardCatalog: [{ code: "TST-100", name: "Charm" }],
      now: START
    });
    const unknownCard = all.cards.find((item) => item.cardName === "Charm");
    const preboard = buildReplayInsights([unknownSource], [matchWithResult(unknownSource.id, "Win")], {
      filters: { gameStage: "preboard" },
      cardCatalog: [{ code: "TST-100", name: "Charm" }],
      now: START
    });

    expect(unknownCard?.playReach).toEqual({ preboardGames: 0, postboardGames: 0, unknownStageGames: 1 });
    expect(all.stats.cardTurnOutcomes).toEqual([]);
    expect(preboard.cards).toEqual([]);

    const explicitSource = replay("combined-stage", turnsWithPlay("Charm", 1, { cardId: "TST-100" }));
    const combined = buildReplayInsights([explicitSource], [matchWithResult(explicitSource.id, "Win")], {
      cardCatalog: [{ code: "TST-100", name: "Charm" }],
      trustGameStage: false,
      now: START
    });
    expect(combined.cards.find((item) => item.cardName === "Charm")?.playReach).toEqual({
      preboardGames: 0,
      postboardGames: 0,
      unknownStageGames: 1
    });
    expect(combined.stats.outcomeSplits.some((row) => row.basis === "game-stage")).toBe(false);
  });

  it("does not invent a named opening-hand claim from a text-only mulligan", () => {
    const source = replay("text-mulligan", [
      event("mulligan", 1, "mulligan", { text: "Player completed mulligan" }),
      event("turn", 10, "turn-start", { text: "Player's turn" }),
      event("draw", 12, "draw", { cardName: LATE_CARD.name, cardId: LATE_CARD.code, fromZone: "deck", toZone: "hand" }),
      event("play", 90, "play", { cardName: LATE_CARD.name, cardId: LATE_CARD.code, fromZone: "hand", toZone: "battlefield" })
    ]);
    const report = buildReplayInsights([source], [match("text-mulligan")], { cardCatalog: CATALOG, now: START });

    expect(report.insights.some((item) => item.id.includes("opening-card"))).toBe(false);
    expect(report.insights.some((item) => /kept Patient Guardian/i.test(`${item.title} ${item.body}`))).toBe(false);
  });

  it("identifies the no-two-drop redraw rule while rewarding a two-card search", () => {
    const oneRedraw = replay("one-redraw", lateKeepEvents());
    const twoRedrawEvents = lateKeepEvents().map((item) => item.id === "mulligan" ? {
      ...item,
      mulligan: { ...item.mulligan, redrawn: [TWO_DROP, { ...TWO_DROP, id: "other", code: "TST-003", name: "Third Card" }], redrawCount: 2 }
    } : item);
    const twoRedraw = replay("two-redraw", twoRedrawEvents);
    const report = buildReplayInsights([oneRedraw, twoRedraw], [match("one-redraw"), match("two-redraw")], { cardCatalog: CATALOG, now: START });

    expect(report.insights.find((item) => item.id.includes("one-redraw") && item.id.includes("two-drop-search"))).toMatchObject({
      tone: "opportunity",
      title: "The keep contained no known 2-cost card"
    });
    expect(report.insights.find((item) => item.id.includes("two-redraw") && item.id.includes("two-drop-search"))).toMatchObject({
      tone: "positive",
      title: "You returned 2 cards with no known 2-cost keep"
    });
  });

  it("counts keep and redraw as overlapping game cohorts for multiple copies of one card name", () => {
    const secondCopy = { ...LATE_CARD, id: "late-copy-2" };
    const source = replay("split-copies", [
      event("split-mulligan", 1, "mulligan", {
        mulligan: {
          options: [LATE_CARD, secondCopy],
          kept: [LATE_CARD],
          redrawn: [secondCopy],
          redrawCount: 1
        }
      })
    ]);
    const report = buildReplayInsights([source], [match(source.id)], { cardCatalog: CATALOG, now: START });

    expect(report.cards.find((item) => item.cardName === LATE_CARD.name)?.mulligan).toMatchObject({
      offeredGames: 1,
      keptGames: 1,
      redrawnGames: 1
    });
  });

  it("promotes recurring late keeps only when the sample gate is met", () => {
    const sources = ["a", "b", "c"].map((id) => replay(id, lateKeepEvents()));
    const matches = sources.map((source) => match(source.id));
    const earlySignal = buildReplayInsights(sources, matches, { cardCatalog: CATALOG, minimumPatternSample: 3, now: START });
    const establishedOnly = buildReplayInsights(sources, matches, { cardCatalog: CATALOG, minimumPatternSample: 5, now: START });

    expect(earlySignal.insights.find((item) => item.id.includes("late-after-keep"))).toMatchObject({
      scope: "pattern",
      sampleSize: 3,
      title: "Patient Guardian keep games often also had a late card-name play",
      patternStrength: "exploratory"
    });
    expect(establishedOnly.insights.some((item) => item.id.includes("late-after-keep"))).toBe(false);
  });

  it("applies deck, legend, format, game-stage, initiative and date filters before aggregation", () => {
    const included = replay("included", lateKeepEvents());
    const excluded = { ...replay("excluded", lateKeepEvents()), capturedAt: "2026-01-01T10:00:00.000Z" };
    const includedMatch = match("included", "Jinx");
    const excludedMatch = { ...match("excluded", "Viktor"), deckSourceId: "other-deck", deckName: "Control", format: "Bo3" as const };
    const report = buildReplayInsights([included, excluded], [includedMatch, excludedMatch], {
      cardCatalog: CATALOG,
      now: START,
      filters: {
        rangeDays: 30,
        deckKey: "deck-ahri",
        playerLegend: "Ahri",
        opponentLegend: "Jinx",
        format: "Bo1",
        gameStage: "preboard",
        wentFirst: "1st"
      }
    });

    expect(report.analyzedReplayIds).toEqual(["included"]);
    expect(report.matchesAnalyzed).toBe(1);
    expect(report.gamesAnalyzed).toBe(1);
    expect(report.insights.every((insight) => insight.replayId === "included" || insight.evidence.every((evidence) => evidence.replayId === "included"))).toBe(true);
  });

  it("keeps all history by default while exposing period and deck-version scope receipts", () => {
    const preseason = { ...replay("preseason", lateKeepEvents()), capturedAt: "2026-07-01T10:00:00.000Z" };
    const current = replay("current-season", lateKeepEvents());
    const snapshot = JSON.stringify({ mainDeck: [{ qty: 3, name: "Patient Guardian", cardId: LATE_CARD.code }] });
    const preseasonMatch = { ...match(preseason.id), capturedAt: preseason.capturedAt, deckSnapshotJson: snapshot };
    const currentMatch = { ...match(current.id), deckSnapshotJson: snapshot };
    const allHistory = buildReplayInsights([preseason, current], [preseasonMatch, currentMatch], {
      cardCatalog: CATALOG,
      includeExplorerStats: false,
      now: START
    });
    const currentOnly = buildReplayInsights([preseason, current], [preseasonMatch, currentMatch], {
      filters: { period: "current-season" },
      includeExplorerStats: false,
      now: START
    });

    expect(allHistory.analyzedReplayIds).toEqual(["preseason", "current-season"]);
    expect(allHistory.scopeReceipt).toMatchObject({
      currentSeasonStartedOn: "2026-07-31",
      periods: ["preseason", "current-season"],
      periodGameCounts: { preseason: 1, "current-season": 1, unknown: 0 },
      unknownDeckGames: 0
    });
    expect(allHistory.scopeReceipt.deckVersions).toHaveLength(1);
    expect(allHistory.scopeReceipt.deckVersions[0]?.games).toBe(2);
    expect(currentOnly.analyzedReplayIds).toEqual(["current-season"]);
  });

  it("skips Explorer aggregation work when requested without disabling coaching insights", () => {
    const source = replay("coach-only", lateKeepEvents());
    const report = buildReplayInsights([source], [match(source.id)], {
      cardCatalog: CATALOG,
      includeExplorerStats: false,
      now: START
    });

    expect(report.insights.length).toBeGreaterThan(0);
    expect(report.stats).toMatchObject({ completedGames: 0, capturedLocalPlays: 0 });
    expect(report.stats.battlefieldPickOrders).toEqual([]);
    expect(report.stats.cardTurnOutcomes).toEqual([]);
  });

  it("describes ten repeated observations as developing and thirty as reasonably stable", () => {
    const ten = Array.from({ length: 10 }, (_, index) => replay(`developing-${index}`, lateKeepEvents()));
    const thirty = Array.from({ length: 30 }, (_, index) => replay(`stable-${index}`, lateKeepEvents()));
    const reportFor = (sources: ReplayRecord[]) => buildReplayInsights(
      sources,
      sources.map((source) => match(source.id)),
      { cardCatalog: CATALOG, includeExplorerStats: false, now: START }
    );
    const developing = reportFor(ten).insights.find((item) => item.id.includes("late-after-keep"));
    const stable = reportFor(thirty).insights.find((item) => item.id.includes("late-after-keep"));

    expect(developing).toMatchObject({ sampleSize: 10, patternStrength: "developing", claimBasis: "observational" });
    expect(stable).toMatchObject({ sampleSize: 30, patternStrength: "reasonably-stable", claimBasis: "observational" });
  });

  it("excludes the face-up chosen Champion from ordinary hand, journey and timing coaching", () => {
    const source = replay("chosen-champion-role", [
      event("chosen-champion-setup", 0, "setup", {
        text: "Akali, Deadly Weapon starts face-up",
        cardName: CHOSEN_CHAMPION.name,
        cardId: "VEN-021A",
        destination: "Chosen_Champion",
        toZone: "Chosen_Champion"
      }),
      event("opening", 1, "mulligan", {
        text: "Opening hand recorded",
        mulligan: {
          kept: [CHOSEN_CHAMPION, ORDINARY_CHAMPION],
          redrawn: [],
          redrawCount: 0
        }
      }),
      event("my-turn-1", 10, "turn-start", { text: "Player's turn" }),
      event("ordinary-champion-play", 12, "play", {
        text: `Played ${ORDINARY_CHAMPION.name} from hand.`,
        cardName: ORDINARY_CHAMPION.name,
        cardId: ORDINARY_CHAMPION.code,
        fromZone: "hand",
        toZone: "battlefield"
      }),
      event("opponent-turn-1", 30, "turn-start", { side: "opponent", text: "Opponent's turn" }),
      event("my-turn-2", 50, "turn-start", { text: "Player's turn" }),
      event("opponent-turn-2", 70, "turn-start", { side: "opponent", text: "Opponent's turn" }),
      event("my-turn-3", 90, "turn-start", { text: "Player's turn" }),
      event("chosen-champion-deployed", 92, "play", {
        text: "Played Akali, Deadly Weapon from the Champion zone.",
        cardName: CHOSEN_CHAMPION.name,
        cardId: CHOSEN_CHAMPION.code,
        fromZone: "champion",
        toZone: "base"
      }),
      event("result", 130, "result", { side: "system", text: "Player won" })
    ]);
    const report = buildReplayInsights([source], [match(source.id)], { cardCatalog: CATALOG, now: START });

    expect(report.cards.some((card) => card.cardName === CHOSEN_CHAMPION.name)).toBe(false);
    expect(report.insights.some((insight) => insight.cardName === CHOSEN_CHAMPION.name)).toBe(false);
    expect(report.stats.cardSourceZones.some((row) => row.cardName === CHOSEN_CHAMPION.name)).toBe(false);
    expect(report.stats.cardTurnOutcomes.some((row) => row.cardName === CHOSEN_CHAMPION.name)).toBe(false);
    expect(report.cards.find((card) => card.cardName === ORDINARY_CHAMPION.name)).toMatchObject({
      kept: 1,
      played: 1
    });
    expect(report.stats.cardSourceZones.find((row) => row.cardName === ORDINARY_CHAMPION.name)).toMatchObject({
      totalPlays: 1,
      hand: 1
    });
  });

  it("enriches Atlas insight input with kept cards reconstructed from the retained raw opening hand", () => {
    const source = { ...replay("raw-atlas", []), platform: "atlas" as const };
    const payload = {
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "capture-mulligan-flow",
        identity: { roomCode: "MULL1", firstSeenAt: 1781360000000, lastSeenAt: 1781360004000 },
        lifecycle: { lastPhase: "in_game", lastGameNumber: 1, boundaries: [] }
      },
      messages: [
        raw(0, {
          type: "room_shell_sync",
          sessionDoc: {
            roomCode: "MULL1",
            phase: "mulligan",
            matchFormat: "bo1",
            viewer: { role: "player", playerId: "plr_local" },
            selfPlayer: {
              id: "plr_local",
              name: "Player",
              board: {
                deck: 36,
                champion: { id: "chosen-akali", name: "Akali, Deadly Weapon", cardCode: "VEN-021" },
                hand: [
                  { id: "h1", name: "Ride the Wind", cardCode: "OGN-173" },
                  { id: "h2", name: "Flash", cardCode: "OGS-011" },
                  { id: "h3", name: "Stacked Deck", cardCode: "OGN-183" },
                  { id: "h4", name: "Tideturner", cardCode: "OGN-199" }
                ]
              }
            },
            opponentPlayer: { id: "plr_opp", name: "Opponent", board: { deck: 36, hand: [{ id: "o1" }, { id: "o2" }, { id: "o3" }, { id: "o4" }] } }
          }
        }),
        raw(1, {
          type: "authoritative_patch_commit",
          patch: {
            operations: [
              { op: "zone_remove", playerId: "plr_local", zone: "hand", cardIds: ["h3", "h4"] },
              { op: "zone_insert", playerId: "plr_local", zone: "hand", cards: [
                { id: "h5", name: "Stupefy", cardCode: "OGN-095", ownerPlayerId: "plr_local" },
                { id: "h6", name: "Defy", cardCode: "OGN-045", ownerPlayerId: "plr_local" }
              ] },
              { op: "log_insert", entries: [{ id: "log-1", text: "Mulligans Complete.", authorPlayerId: "plr_local" }] }
            ]
          }
        })
      ]
    };

    const enrichedEvents = replayInsightEventsFromRawPayload(source, payload);
    const events = replayInsightOpeningHandEventsFromRawPayload(source, payload);

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toContain("raw-opening:");
    expect(events[0]?.mulligan?.kept?.map((card) => card.name)).toEqual(["Ride the Wind", "Flash"]);
    expect(events[0]?.mulligan?.redrawn?.map((card) => card.name)).toEqual(["Stacked Deck", "Tideturner"]);
    expect(events[0]?.mulligan?.redrawCount).toBe(2);
    expect(enrichedEvents.find((item) => item.actionId === "insight:raw-chosen-champion")).toMatchObject({
      type: "setup",
      side: "me",
      gameNumber: 0,
      cardName: "Akali, Deadly Weapon",
      cardId: "VEN-021",
      destination: "champion"
    });
    expect(events[0]?.mulligan?.kept?.some((card) => card.name === "Akali, Deadly Weapon")).toBe(false);
  });

  it("extracts authoritative player attribution from retained raw Atlas action logs", () => {
    const source = { ...replay("raw-action-attribution", []), platform: "atlas" as const };
    const payload = {
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: { captureSessionId: "raw-action-attribution" },
      messages: [
        raw(0, {
          type: "room_shell_sync",
          sessionDoc: {
            roomCode: "RAW1",
            phase: "in_game",
            gameNumber: 1,
            selfPlayer: { id: "plr_local", name: "Player", board: { deck: 36, hand: [] } },
            opponentPlayer: { id: "plr_opp", name: "Opponent", board: { deck: 36, hand: [] } }
          }
        }),
        raw(1, {
          type: "authoritative_patch_commit",
          patch: {
            operations: [{
              op: "log_insert",
              entries: [{
                id: "log-play-1",
                text: "Played Turn to Dust from hand.",
                authorPlayerId: "plr_local"
              }]
            }]
          }
        })
      ]
    };

    const play = replayInsightEventsFromRawPayload(source, payload).find((event) => event.type === "play");

    expect(play).toMatchObject({
      side: "me",
      cardName: "Turn to Dust",
      fromZone: "hand",
      gameNumber: 1
    });
  });

  it("attributes legacy system-sided plays only when an explicit turn establishes the player", () => {
    const source = { ...replay("legacy-system-sides", [
      event("ambiguous-play", 1, "play", {
        side: "system",
        text: "Played Unowned Signal from hand.",
        cardName: "Unowned Signal",
        fromZone: "hand"
      }),
      event("my-turn", 10, "turn-start", { side: "me", text: "Player's turn" }),
      event("my-system-play", 12, "play", {
        side: "system",
        text: "Played Local Signal from hand.",
        cardName: "Local Signal",
        fromZone: "hand"
      }),
      event("opponent-turn", 20, "turn-start", { side: "opponent", text: "Opponent's turn" }),
      event("opponent-system-play", 22, "play", {
        side: "system",
        text: "Played Opponent Signal from hand.",
        cardName: "Opponent Signal",
        fromZone: "hand"
      })
    ]), platform: "atlas" as const };

    const report = buildReplayInsights([source], [match(source.id)], { now: START });

    expect(report.cards.map((card) => card.cardName)).toEqual(["Local Signal"]);
    expect(report.cards[0]).toMatchObject({ appearances: 1, played: 1, unplayed: 0 });
  });

  it("uses an authoritative enriched play instead of its duplicate legacy system event", () => {
    const source = { ...replay("raw-play-backfill", [
      event("my-turn", 10, "turn-start", { side: "me", text: "Player's turn" }),
      event("legacy-play", 12, "play", {
        side: "system",
        text: "Played Turn to Dust from hand.",
        cardName: "Turn to Dust from hand"
      })
    ]), platform: "atlas" as const };
    const authoritativePlay = event("raw-authoritative-play", 12, "play", {
      side: "me",
      text: "Played Turn to Dust from hand.",
      cardName: "Turn to Dust",
      cardId: "TST-099",
      fromZone: "hand"
    });

    const report = buildReplayInsights([source], [match(source.id)], {
      now: START,
      cardCatalog: [{ code: "TST-099", name: "Turn to Dust" }],
      enrichmentEventsByReplayId: new Map([[source.id, [authoritativePlay]]])
    });

    expect(report.cards).toHaveLength(1);
    expect(report.cards[0]).toMatchObject({
      cardName: "Turn to Dust",
      cardId: "TST-099",
      appearances: 1,
      played: 1,
      unplayed: 0
    });
  });

  it("adds unmatched explicitly sided raw plays while keeping opponent evidence out of local reports", () => {
    const source = { ...replay("raw-unmatched-plays", [
      event("setup", 1, "setup", { side: "system", text: "Starting the game" })
    ]), platform: "atlas" as const };
    const localPlay = event("raw-local-play", 12, "play", {
      side: "me",
      text: "Played Local Signal from hand.",
      cardName: "Local Signal",
      fromZone: "hand"
    });
    const opponentPlay = event("raw-opponent-play", 14, "play", {
      side: "opponent",
      text: "Played Opponent Signal from hand.",
      cardName: "Opponent Signal",
      fromZone: "hand"
    });

    const report = buildReplayInsights([source], [match(source.id)], {
      now: START,
      enrichmentEventsByReplayId: new Map([[source.id, [localPlay, opponentPlay]]])
    });

    expect(report.cards.map((card) => card.cardName)).toEqual(["Local Signal"]);
    expect(report.cards[0]).toMatchObject({ appearances: 1, played: 1, unplayed: 0 });
  });

  it("counts code-keyed raw and name-keyed legacy evidence as one card appearance per game", () => {
    const source = { ...replay("raw-canonical-dedupe", [
      event("legacy-local-play", 12, "play", {
        side: "me",
        text: "Player played Defy.",
        cardName: "Defy",
        fromZone: "hand"
      })
    ]), platform: "atlas" as const };
    const rawPlay = event("raw-coded-play", 13, "play", {
      side: "me",
      text: "Played Defy from hand.",
      cardName: "Defy",
      cardId: "OGN-045",
      fromZone: "hand"
    });

    const report = buildReplayInsights([source], [match(source.id)], {
      now: START,
      cardCatalog: [{ code: "OGN-045", name: "Defy" }],
      enrichmentEventsByReplayId: new Map([[source.id, [rawPlay]]])
    });

    expect(report.cards).toHaveLength(1);
    expect(report.cards[0]).toMatchObject({ cardId: "OGN-045", appearances: 1, played: 1, unplayed: 0 });
  });

  it("canonicalizes a coded raw opening card and a name-only play into one card report", () => {
    const defy: ReplayStructuredCard = {
      id: "opening-defy",
      code: "OGN-045",
      name: "Defy",
      type: "spell",
      imageUrl: ""
    };
    const source = { ...replay("canonical-card", [
      event("my-turn", 10, "turn-start", { side: "me", text: "Player's turn" }),
      event("defy-play", 12, "play", {
        side: "me",
        text: "Player played Defy",
        cardName: "Defy",
        fromZone: "hand",
        toZone: "chain"
      })
    ]), platform: "atlas" as const };
    const rawOpening = event("raw-opening:canonical-card:1", 1, "mulligan", {
      side: "me",
      text: "Opening hand reconstructed from retained local RiftAtlas state",
      mulligan: { options: [defy], kept: [defy], redrawn: [], redrawCount: 0 }
    });

    const report = buildReplayInsights([source], [match(source.id)], {
      now: START,
      cardCatalog: [{ code: defy.code, name: defy.name, costEnergy: 1 }],
      openingHandEventsByReplayId: new Map([[source.id, [rawOpening]]])
    });

    expect(report.cards).toHaveLength(1);
    expect(report.cards[0]).toMatchObject({
      cardName: "Defy",
      cardId: "OGN-045",
      appearances: 1,
      kept: 1,
      played: 1,
      unplayed: 0
    });
    expect(report.insights.some((insight) => insight.id.includes("unplayed-opening-card"))).toBe(false);
  });

  it("excludes anonymous card placeholders from Insights card journeys", () => {
    const source = { ...replay("anonymous-cards", [
      event("my-turn", 10, "turn-start", { side: "me", text: "Player's turn" }),
      event("unknown-card", 12, "play", {
        text: "Played Unknown card from hand.",
        cardName: "Unknown card",
        fromZone: "hand"
      }),
      event("generic-card", 14, "play", {
        text: "Played a card from hand.",
        cardName: "a card from hand",
        fromZone: "hand"
      }),
      event("known-placeholder", 16, "move", {
        text: "Known card moved to hand.",
        cardName: "Known card",
        toZone: "hand"
      }),
      event("numeric-placeholder", 18, "draw", {
        text: "Drew 1 card.",
        cardName: "1",
        toZone: "hand"
      })
    ]), platform: "atlas" as const };

    const report = buildReplayInsights([source], [match(source.id)], { now: START });

    expect(report.cards).toEqual([]);
    expect(report.coverage.namedCardJourneys).toBe(0);
  });

  it("aggregates only explicitly captured battlefield pick sequences", () => {
    const battlefieldMatch = (id: string, picks: string[]): MatchDraft => ({
      ...match(id),
      format: "Bo3",
      score: "2-1",
      games: picks.map((myBattlefield, index) => ({
        gameNumber: index + 1,
        result: index === 1 ? "Loss" as const : "Win" as const,
        myBattlefield,
        wentFirst: index % 2 === 0 ? "1st" as const : "2nd" as const
      }))
    });
    const battlefieldReplay = (id: string): ReplayRecord => replay(id, [
      event(`${id}-result`, 90, "result", { side: "system", text: "Match completed" })
    ]);
    const common = ["Minefield", "Arena", "Garden"];
    const alternate = ["Arena", "Minefield", "Garden"];
    const first = battlefieldReplay("battlefield-a");
    const sources = [
      first,
      { ...battlefieldReplay("battlefield-a-duplicate"), matchId: first.matchId },
      battlefieldReplay("battlefield-b"),
      battlefieldReplay("battlefield-c"),
      replay("battlefield-fallback-only", [event("fallback-result", 90, "result", { side: "system", text: "Player won" })])
    ];
    const fallbackOnly = {
      ...match("battlefield-fallback-only"),
      myBattlefield: "Do not infer this pick",
      games: [{ gameNumber: 1, result: "Win" as const, wentFirst: "1st" as const }]
    };
    const report = buildReplayInsights(sources, [
      battlefieldMatch("battlefield-a", common),
      battlefieldMatch("battlefield-b", common),
      battlefieldMatch("battlefield-c", alternate),
      fallbackOnly
    ], { now: START });

    expect(replayStats(report).battlefieldPickOrders).toHaveLength(2);
    expect(replayStats(report).battlefieldPickOrders[0]).toMatchObject({
      sequence: common,
      games: 2
    });
    expect(replayStats(report).battlefieldPickOrders[0]?.percentage).toBeCloseTo(66.7, 1);
    expect(replayStats(report).battlefieldPickOrders.some((row) => row.sequence.includes("Do not infer this pick"))).toBe(false);
  });

  it("uses confirmed raw enrichment when an Atlas replay has no base timeline events", () => {
    const source: ReplayRecord = {
      ...replay("raw-only-atlas", []),
      platform: "atlas",
      events: [],
      structuredEvents: []
    };
    const rawPlay = event("raw-only-play", 42, "play", {
      cardName: "Charm",
      cardId: "TST-100",
      fromZone: "hand",
      toZone: "chain"
    });
    const report = buildReplayInsights([source], [matchWithResult(source.id, "Win")], {
      cardCatalog: [{ code: "TST-100", name: "Charm" }],
      enrichmentEventsByReplayId: new Map([[source.id, [rawPlay]]]),
      now: START
    });
    const charm = report.cards.find((item) => item.cardName === "Charm");

    expect(charm).toMatchObject({
      played: 1,
      playReach: { preboardGames: 1, postboardGames: 0, unknownStageGames: 0 },
      firstPlayTurns: { byTurn3Games: 0, turns4To5Games: 0, turn6PlusGames: 0, unknownTurnGames: 1 }
    });
    expect(replayStats(report).cardSourceZones.find((row) => row.cardName === "Charm")).toMatchObject({
      totalPlays: 1,
      hand: 1
    });
    expect(replayStats(report).cardTurnOutcomes).toEqual([]);
  });

  it("keeps a manually dismissed false play out of Card Review aggregates", () => {
    const original = replay("dismissed-card-review-play", lateKeepEvents());
    const correction: ReplayIntelligenceCorrection = {
      id: "dismiss-late-play",
      eventId: "late-play",
      updatedAt: START,
      dismissed: true
    };
    const source = replayWithIntelligence(original, match(original.id), [correction]);
    const report = buildReplayInsights([source], [match(source.id)], { cardCatalog: CATALOG, now: START });
    const card = report.cards.find((item) => item.cardName === LATE_CARD.name);

    expect(original.structuredEvents?.some((item) => item.id === "late-play")).toBe(true);
    expect(report.stats).toMatchObject({ capturedLocalPlays: 0, knownSourcePlays: 0 });
    expect(replayStats(report).cardSourceZones.some((row) => row.cardName === LATE_CARD.name)).toBe(false);
    expect(replayStats(report).cardTurnOutcomes.some((row) => row.cardName === LATE_CARD.name)).toBe(false);
    expect(card).toMatchObject({
      played: 0,
      playReach: { preboardGames: 0, postboardGames: 0, unknownStageGames: 0 },
      firstPlayTurns: { byTurn3Games: 0, turns4To5Games: 0, turn6PlusGames: 0, unknownTurnGames: 0 }
    });
  });

  it("uses manually corrected card and side fields in Card Review aggregates", () => {
    const original = replay("corrected-card-review-play", [
      event("corrected-player-turn", 10, "turn-start", { side: "me", text: "Player's turn" }),
      event("corrected-card-play", 12, "play", {
        side: "opponent",
        text: "Opponent played Wrong Card from hidden.",
        cardName: "Wrong Card",
        cardId: "TST-WRONG",
        fromZone: "hidden",
        toZone: "chain"
      })
    ]);
    const correction: ReplayIntelligenceCorrection = {
      id: "correct-card-review-play",
      eventId: "corrected-card-play",
      updatedAt: START,
      side: "me",
      text: "Played Charm from hand.",
      cardName: "Charm",
      cardId: "TST-100",
      fromZone: "hand",
      toZone: "chain"
    };
    const source = replayWithIntelligence(original, match(original.id), [correction]);
    const report = buildReplayInsights([source], [matchWithResult(source.id, "Win")], {
      cardCatalog: [
        { code: "TST-100", name: "Charm" },
        { code: "TST-WRONG", name: "Wrong Card" }
      ],
      now: START
    });
    const charmSource = replayStats(report).cardSourceZones.find((row) => row.cardName === "Charm");
    const charmTiming = replayStats(report).cardTurnOutcomes.find((row) => row.cardName === "Charm");

    expect(report.cards.find((item) => item.cardName === "Charm")).toMatchObject({
      played: 1,
      playReach: { preboardGames: 1, postboardGames: 0, unknownStageGames: 0 }
    });
    expect(report.cards.some((item) => item.cardName === "Wrong Card")).toBe(false);
    expect(charmSource).toMatchObject({ totalPlays: 1, hand: 1, hidden: 0 });
    expect(charmSource?.evidence[0]?.confidence).toBe("manual");
    expect(charmTiming).toMatchObject({ playerTurnNumber: 1, games: 1, wins: 1 });
    expect(replayStats(report).cardSourceZones.some((row) => row.cardName === "Wrong Card")).toBe(false);
    expect(replayStats(report).cardTurnOutcomes.some((row) => row.cardName === "Wrong Card")).toBe(false);
  });

  it("reports local card plays by hand, hidden, other and unknown source zones", () => {
    const sourceCases: Array<[string, string | undefined, Partial<ReplayStructuredEvent>]> = [
      ["hand-a", "hand", {}],
      ["hand-b", "Hand", {}],
      ["hidden", "exilehidden", { visibility: "hidden" }],
      ["trash", "trash", {}],
      ["deck", undefined, { text: "Played Charm from top of the deck." }],
      ["other", "base", {}],
      ["unknown", undefined, { text: "Played Charm.", destination: "chain" }]
    ];
    const sources = sourceCases.map(([id, fromZone, patch]) => replay(`source-${id}`, turnsWithPlay("Charm", 1, {
      cardId: "TST-100",
      fromZone,
      ...patch
    })));
    const matches = sources.map((source) => match(source.id));
    const report = buildReplayInsights(sources, matches, {
      now: START,
      cardCatalog: [{ code: "TST-100", name: "Charm" }]
    });
    const charm = replayStats(report).cardSourceZones.find((row) => row.cardName === "Charm");

    expect(charm).toMatchObject({
      cardId: "TST-100",
      totalPlays: 7,
      hand: 2,
      hidden: 1,
      trash: 1,
      deck: 1,
      other: 1,
      unknown: 1,
      handPercent: 28.6,
      hiddenPercent: 14.3
    });
  });

  it("compares player-turn timing only with games where the card was known or visible by that turn", () => {
    const outcomes = ["Win", "Loss", "Win", "Loss", "Loss", "Win", "Loss"] as const;
    const sources = outcomes.map((result, index) => replay(
      `turn-outcome-${index + 1}`,
      index < 5
        ? turnsWithPlay("Charm", 2, { cardId: "TST-100" })
        : index === 5
          ? [
              event("known-opening", 1, "mulligan", {
                text: "Opening hand recorded",
                mulligan: {
                  kept: [{ id: "charm", code: "TST-100", name: "Charm", type: "spell", imageUrl: "" }],
                  redrawn: [],
                  redrawCount: 0
                }
              }),
              event("known-opening-turn", 10, "turn-start", { text: "Player's turn" })
            ]
          : [event("unrelated-baseline-turn", 10, "turn-start", { text: "Player's turn" })]
    ));
    const matches = sources.map((source, index) => matchWithResult(source.id, outcomes[index]!));
    const report = buildReplayInsights(sources, matches, {
      now: START,
      cardCatalog: [{ code: "TST-100", name: "Charm" }]
    });
    const charmTurnTwo = replayStats(report).cardTurnOutcomes.find((row) => (
      row.cardName === "Charm" && row.playerTurnNumber === 2
    ));

    expect(charmTurnTwo).toMatchObject({
      cardId: "TST-100",
      playerTurnNumber: 2,
      games: 5,
      wins: 2,
      losses: 3,
      winRate: 40,
      baselineGames: 6,
      baselineWins: 3,
      baselineWinRate: 50,
      baselineEligibility: "known-visible-by-player-turn",
      sampleState: "early"
    });
    expect(charmTurnTwo?.correlationLabel.toLowerCase()).toContain("known or visible");
    expect(charmTurnTwo?.correlationLabel.toLowerCase()).not.toMatch(/caused|because of/);
  });

  it("recomputes the timing baseline inside game-stage and initiative filters", () => {
    const gameOne = turnsWithPlay("Charm", 2, { cardId: "TST-100" }).map((item) => ({
      ...item,
      id: `g1:${item.id}`,
      sourceEventId: `g1:${item.sourceEventId}`,
      gameNumber: 1
    }));
    const gameTwo = turnsWithPlay("Charm", 2, { cardId: "TST-100" }).map((item) => ({
      ...item,
      id: `g2:${item.id}`,
      sourceEventId: `g2:${item.sourceEventId}`,
      gameNumber: 2,
      capturedAt: new Date(Date.parse(item.capturedAt) + 300_000).toISOString()
    }));
    const source = replay("filtered-baseline", [...gameOne, ...gameTwo]);
    const sourceMatch: MatchDraft = {
      ...match(source.id),
      format: "Bo3",
      result: "Draw",
      score: "1-1",
      games: [
        { gameNumber: 1, result: "Win", wentFirst: "1st" },
        { gameNumber: 2, result: "Loss", wentFirst: "2nd" }
      ]
    };
    const preboard = buildReplayInsights([source], [sourceMatch], {
      now: START,
      filters: { gameStage: "preboard" }
    });
    const second = buildReplayInsights([source], [sourceMatch], {
      now: START,
      filters: { wentFirst: "2nd" }
    });

    expect(replayStats(preboard).cardTurnOutcomes[0]).toMatchObject({ games: 1, wins: 1, baselineGames: 1, baselineWinRate: 100 });
    expect(replayStats(second).cardTurnOutcomes[0]).toMatchObject({ games: 1, losses: 1, baselineGames: 1, baselineWinRate: 0 });
  });

  it("ignores impossible historical game slots above game three", () => {
    const gameOne = turnsWithPlay("Charm", 1).map((item) => ({ ...item, gameNumber: 1, id: `valid:${item.id}` }));
    const gameFour = turnsWithPlay("Ghost Card", 1).map((item) => ({
      ...item,
      gameNumber: 4,
      id: `invalid:${item.id}`,
      capturedAt: new Date(Date.parse(item.capturedAt) + 300_000).toISOString()
    }));
    const source = replay("impossible-game-four", [...gameOne, ...gameFour]);
    const sourceMatch: MatchDraft = {
      ...match(source.id),
      format: "Bo3",
      games: [
        { gameNumber: 1, result: "Win" },
        { gameNumber: 4, result: "Loss" }
      ]
    };
    const report = buildReplayInsights([source], [sourceMatch], { now: START });

    expect(replayStats(report).completedGames).toBe(1);
    expect(replayStats(report).cardSourceZones.some((row) => row.cardName === "Ghost Card")).toBe(false);
  });

  it("uses the first local play as one timing sample per game and card", () => {
    const source = replay("first-play-only", [
      ...turnsWithPlay("Charm", 1, { id: "first-charm", cardId: "TST-100" }),
      event("opponent-turn-after-first", 30, "turn-start", { side: "opponent", text: "Opponent's turn" }),
      event("my-second-turn", 40, "turn-start", { side: "me", text: "Player's turn" }),
      event("second-charm", 42, "play", {
        side: "me",
        text: "Played Charm from hidden.",
        cardName: "Charm",
        cardId: "TST-100",
        fromZone: "hidden"
      })
    ]);
    const report = buildReplayInsights([source], [matchWithResult(source.id, "Win")], { now: START });
    const charmRows = replayStats(report).cardTurnOutcomes.filter((row) => row.cardName === "Charm");

    expect(charmRows).toHaveLength(1);
    expect(charmRows[0]).toMatchObject({ playerTurnNumber: 1, games: 1, wins: 1 });
    expect(charmRows[0]?.evidence).toHaveLength(1);
    expect(charmRows[0]?.evidence[0]?.eventId).toBe("first-charm");
  });

  it("does not count a pre-game battlefield row as one of the player's turns", () => {
    const source = replay("battlefield-before-turns", [
      event("battlefield-setup", 1, "battlefield", {
        side: "system",
        text: "Battlefields updated: My Minefield",
        battlefield: "My Minefield",
        battlefields: [{ side: "me", name: "Minefield", code: "BF-1", image: "" }]
      }),
      ...turnsWithPlay("Charm", 2, { cardId: "TST-100" })
    ]);
    const report = buildReplayInsights([source], [matchWithResult(source.id, "Win")], { now: START });
    const charm = replayStats(report).cardTurnOutcomes.find((row) => row.cardName === "Charm");

    expect(charm).toMatchObject({ playerTurnNumber: 2, games: 1 });
  });

  it("counts substantive reconstructed side turns when no turn-start row was retained", () => {
    const source = { ...replay("reconstructed-turns", [
      event("my-first-play", 10, "play", { side: "me", text: "Played Scout from hand.", cardName: "Scout", fromZone: "hand" }),
      event("opponent-play", 20, "play", { side: "opponent", text: "Played Rival from hand.", cardName: "Rival", fromZone: "hand" }),
      event("my-second-play", 30, "play", { side: "me", text: "Played Charm from hand.", cardName: "Charm", cardId: "TST-100", fromZone: "hand" })
    ]), platform: "tcga" as const };
    const report = buildReplayInsights([source], [matchWithResult(source.id, "Win")], { now: START });
    const charm = replayStats(report).cardTurnOutcomes.find((row) => row.cardName === "Charm");

    expect(charm).toMatchObject({ playerTurnNumber: 2, games: 1 });
  });

  it("keeps outcome rows exploratory at ten samples and waits for thirty before the legacy established state", () => {
    const sources = [1, 2, 3, 4].map((index) => replay(`small-sample-${index}`, turnsWithPlay("Charm", 2)));
    const report = buildReplayInsights(sources, sources.map((source) => matchWithResult(source.id, "Win")), { now: START });
    const charmTurnTwo = replayStats(report).cardTurnOutcomes.find((row) => (
      row.cardName === "Charm" && row.playerTurnNumber === 2
    ));
    const tenSources = Array.from({ length: 10 }, (_, index) => replay(
      `ten-sample-${index}`,
      turnsWithPlay("Charm", 2)
    ));
    const tenReport = buildReplayInsights(
      tenSources,
      tenSources.map((source) => matchWithResult(source.id, "Win")),
      { now: START }
    );
    const tenCharm = replayStats(tenReport).cardTurnOutcomes.find((row) => (
      row.cardName === "Charm" && row.playerTurnNumber === 2
    ));
    const stableSources = Array.from({ length: 30 }, (_, index) => replay(
      `stable-sample-${index}`,
      turnsWithPlay("Charm", 2)
    ));
    const stableReport = buildReplayInsights(
      stableSources,
      stableSources.map((source) => matchWithResult(source.id, "Win")),
      { now: START }
    );
    const stableCharm = replayStats(stableReport).cardTurnOutcomes.find((row) => (
      row.cardName === "Charm" && row.playerTurnNumber === 2
    ));

    expect(charmTurnTwo).toMatchObject({ games: 4, sampleState: "insufficient" });
    expect(charmTurnTwo?.correlationLabel.toLowerCase()).toContain("association");
    expect(tenCharm).toMatchObject({ games: 10, sampleState: "early" });
    expect(stableCharm).toMatchObject({ games: 30, sampleState: "established" });
  });

  it("excludes opponent plays and opponent evidence from player statistics", () => {
    const source = replay("opponent-evidence", [
      event("my-turn", 10, "turn-start", { side: "me", text: "Player's turn" }),
      event("my-charm", 12, "play", {
        side: "me",
        text: "Played Charm from hand.",
        cardName: "Charm",
        cardId: "TST-100",
        fromZone: "hand"
      }),
      event("opponent-turn", 20, "turn-start", { side: "opponent", text: "Opponent's turn" }),
      event("opponent-charm", 22, "play", {
        side: "opponent",
        text: "Played Charm from hidden.",
        cardName: "Charm",
        cardId: "TST-100",
        fromZone: "hidden",
        visibility: "hidden"
      })
    ]);
    const report = buildReplayInsights([source], [matchWithResult(source.id, "Win")], { now: START });
    const sourceRow = replayStats(report).cardSourceZones.find((row) => row.cardName === "Charm");
    const outcomeRow = replayStats(report).cardTurnOutcomes.find((row) => row.cardName === "Charm");

    expect(sourceRow).toMatchObject({ totalPlays: 1, hand: 1, hidden: 0 });
    expect(sourceRow?.evidence.map((item) => item.eventId)).toEqual(["my-charm"]);
    expect(outcomeRow).toMatchObject({ games: 1, wins: 1, losses: 0 });
    expect(outcomeRow?.evidence.map((item) => item.eventId)).toEqual(["my-charm"]);
  });

  it("does not double-count duplicate legacy and authoritative raw actions in statistics", () => {
    const source = { ...replay("stats-raw-dedupe", [
      event("my-turn", 10, "turn-start", { side: "me", text: "Player's turn" }),
      event("legacy-charm", 12, "play", {
        side: "system",
        text: "Played Charm from hand.",
        cardName: "Charm from hand"
      })
    ]), platform: "atlas" as const };
    const authoritative = event("raw-charm", 12, "play", {
      side: "me",
      text: "Played Charm from hand.",
      cardName: "Charm",
      cardId: "TST-100",
      fromZone: "hand"
    });
    const report = buildReplayInsights([source], [matchWithResult(source.id, "Win")], {
      now: START,
      cardCatalog: [{ code: "TST-100", name: "Charm" }],
      enrichmentEventsByReplayId: new Map([[source.id, [authoritative]]])
    });
    const sourceRow = replayStats(report).cardSourceZones.find((row) => row.cardName === "Charm");
    const outcomeRow = replayStats(report).cardTurnOutcomes.find((row) => row.cardName === "Charm");

    expect(sourceRow).toMatchObject({ totalPlays: 1, hand: 1 });
    expect(sourceRow?.evidence).toHaveLength(1);
    expect(outcomeRow).toMatchObject({ games: 1, wins: 1, playerTurnNumber: 1 });
    expect(outcomeRow?.evidence).toHaveLength(1);
  });

  it("preserves inferred enrichment confidence instead of promoting the play into review metrics", () => {
    const source = { ...replay("stats-inferred-enrichment", [
      event("inferred-enrichment-turn", 10, "turn-start", { side: "me", text: "Player's turn" }),
      event("inferred-enrichment-legacy", 12, "play", {
        side: "system",
        text: "Played Charm from hand.",
        cardName: "Charm from hand"
      })
    ]), platform: "atlas" as const };
    const inferred = event("inferred-enrichment-raw", 12, "play", {
      side: "me",
      text: "Played Charm from hand.",
      cardName: "Charm",
      cardId: "TST-100",
      fromZone: "hand",
      evidence: { source: "state-diff", confidence: "inferred" }
    });
    const report = buildReplayInsights([source], [matchWithResult(source.id, "Win")], {
      cardCatalog: [{ code: "TST-100", name: "Charm" }],
      enrichmentEventsByReplayId: new Map([[source.id, [inferred]]]),
      now: START
    });

    expect(report.stats).toMatchObject({ capturedLocalPlays: 0, knownSourcePlays: 0 });
    expect(report.stats.cardSourceZones).toEqual([]);
    expect(report.cards.find((item) => item.cardName === "Charm")?.playReach).toEqual({
      preboardGames: 0,
      postboardGames: 0,
      unknownStageGames: 0
    });
  });
});
