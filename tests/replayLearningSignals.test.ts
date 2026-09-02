import { describe, expect, it } from "vitest";

import {
  extractReplayLearningSignals,
  replayLearningBattlefieldConversions,
  replayLearningCapabilityReceipt,
  replayLearningResourceCoverage,
  replayLearningSideboardFlows
} from "../src/shared/replayLearningSignals.js";
import type {
  DeckTrackerCardState,
  DeckTrackerSideboardChange,
  DeckTrackerSnapshot,
  DeckTrackerState,
  ReplayRecord,
  ReplayStructuredEvent
} from "../src/shared/types.js";

const START = Date.parse("2026-08-25T12:00:00.000Z");

function at(seconds: number): string {
  return new Date(START + seconds * 1_000).toISOString();
}

function event(
  id: string,
  seconds: number,
  type: ReplayStructuredEvent["type"],
  patch: Partial<ReplayStructuredEvent> = {}
): ReplayStructuredEvent {
  return {
    id,
    sourceEventId: id,
    gameNumber: 1,
    capturedAt: at(seconds),
    labelTime: "12:00",
    type,
    side: "me",
    text: id,
    cardName: "",
    destination: "",
    battlefield: "",
    ...patch
  };
}

function withoutGameNumber(value: ReplayStructuredEvent): ReplayStructuredEvent {
  const legacy = { ...value } as Partial<ReplayStructuredEvent>;
  delete legacy.gameNumber;
  return legacy as ReplayStructuredEvent;
}

function replay(patch: Partial<ReplayRecord> = {}): ReplayRecord {
  return {
    id: "learning-replay",
    matchId: "learning-match",
    platform: "sim",
    capturedAt: at(0),
    title: "Learning replay",
    players: { me: "Me", opponent: "Opponent" },
    events: [],
    structuredEvents: [],
    ...patch
  };
}

function trackerCard(seenCount: number): DeckTrackerCardState {
  return {
    cardKey: "charm",
    name: "Charm",
    code: "TST-100",
    cardId: "TST-100",
    imageUrl: "charm.png",
    role: "main",
    deckCount: 3,
    seenCount,
    manualDelta: 0,
    copiesLeft: 3 - seenCount,
    pinned: false,
    confidence: "tracked",
    odds: { next1: 0, next2: 0, next3: 0 }
  };
}

function sideboardChange(patch: Partial<DeckTrackerSideboardChange> = {}): DeckTrackerSideboardChange {
  return {
    id: "change-charm-in",
    cardKey: "charm",
    name: "Charm",
    code: "TST-100",
    cardId: "TST-100",
    imageUrl: "charm.png",
    qty: 1,
    direction: "in",
    source: "atlas",
    gameNumber: 2,
    capturedAt: at(20),
    ...patch
  };
}

function trackerState(
  capturedAt: string,
  changes: DeckTrackerSideboardChange[],
  cards: DeckTrackerCardState[],
  gameNumber = 2
): DeckTrackerState {
  return {
    active: true,
    reason: "Tracking visible local cards.",
    deckId: "deck-1",
    deckTitle: "Deck",
    deckLegend: "Ahri",
    opponentLegend: "Jinx",
    platform: "atlas",
    confidence: "tracked",
    deckSize: 40,
    cardsLeft: 40,
    seenCount: cards.reduce((total, card) => total + card.seenCount, 0),
    updatedAt: capturedAt,
    pinnedCards: [],
    corrections: [],
    cards,
    sideboard: {
      gameNumber,
      phase: "sideboarding",
      autoDetected: true,
      hasManualChanges: false,
      changes,
      mainOptions: [],
      sideboardOptions: []
    },
    opponent: {
      totalSeen: 0,
      totalKnown: 0,
      updatedAt: capturedAt,
      knownCards: [],
      cards: []
    }
  };
}

function snapshot(
  id: string,
  seconds: number,
  changes: DeckTrackerSideboardChange[],
  cards: DeckTrackerCardState[],
  gameNumber = 2
): DeckTrackerSnapshot {
  const capturedAt = at(seconds);
  return { id, capturedAt, reason: "atlas-event", state: trackerState(capturedAt, changes, cards, gameNumber) };
}

describe("Replay learning signals", () => {
  it("reports unused resources only when a local turn-end proves an after-state", () => {
    const source = replay({
      structuredEvents: [
        event("turn-one", 1, "turn-start"),
        event("standalone-snapshot", 5, "action", {
          snapshot: {
            resources: {
              me: { energy: 9, power: 9, xp: 9, runesReady: 9, runesExhausted: 0 },
              opponent: { energy: 0, power: 0, xp: 0, runesReady: 0, runesExhausted: 0 }
            },
            zones: { me: {}, opponent: {} },
            knownOpponentCards: []
          }
        }),
        event("end-proven-after", 10, "turn-end", {
          resource: {
            after: { energy: 2, power: 1, xp: 3, runesReady: 1, runesExhausted: 2 }
          }
        }),
        event("turn-two", 20, "turn-start"),
        event("end-unknown", 30, "turn-end"),
        event("turn-three", 40, "turn-start"),
        event("end-proven-snapshot", 50, "turn-end", {
          snapshot: {
            resources: {
              me: { energy: 0, power: 2, xp: 4, runesReady: 0, runesExhausted: 3 },
              opponent: { energy: 1, power: 1, xp: 4, runesReady: 1, runesExhausted: 2 }
            },
            zones: { me: {}, opponent: {} },
            knownOpponentCards: []
          }
        }),
        event("opponent-end", 60, "turn-end", {
          side: "opponent",
          resource: { after: { energy: 8, power: 8, xp: 8, runesReady: 8, runesExhausted: 0 } }
        })
      ]
    });

    expect(replayLearningResourceCoverage(source)).toEqual({
      state: "partial",
      capturedPlayerTurnEnds: 3,
      provenEndStates: 2,
      unknownEndStates: 1,
      coveragePercent: 66.7,
      observations: [
        {
          eventId: "end-proven-after",
          gameNumber: 1,
          capturedAt: at(10),
          playerTurnNumber: 1,
          proof: "turn-end-resource-after",
          completeState: true,
          unused: { energy: 2, power: 1, readyRunes: 1 },
          state: { energy: 2, power: 1, xp: 3, runesReady: 1, runesExhausted: 2 }
        },
        {
          eventId: "end-proven-snapshot",
          gameNumber: 1,
          capturedAt: at(50),
          playerTurnNumber: 3,
          proof: "turn-end-snapshot",
          completeState: true,
          unused: { energy: 0, power: 2, readyRunes: 0 },
          state: { energy: 0, power: 2, xp: 4, runesReady: 0, runesExhausted: 3 }
        }
      ]
    });
  });

  it("treats absent turn-end resource proof as unknown rather than zero", () => {
    expect(replayLearningResourceCoverage(replay())).toEqual({
      state: "unknown",
      capturedPlayerTurnEnds: 0,
      provenEndStates: 0,
      unknownEndStates: 0,
      coveragePercent: null,
      observations: []
    });
  });

  it("preserves an unknown game number without borrowing Game 1 turn context", () => {
    const unknownEnd = withoutGameNumber(event("unknown-game-end", 10, "turn-end", {
      resource: { after: { energy: 2, power: 1, xp: 3, runesReady: 1, runesExhausted: 2 } }
    }));
    const unknownScore = withoutGameNumber(event("unknown-game-score", 20, "score", {
      battlefield: "Minefield",
      scoreReason: "conquer",
      pointsScored: 1
    }));
    const source = replay({
      structuredEvents: [
        event("known-game-one-turn", 1, "turn-start", { gameNumber: 1 }),
        unknownEnd,
        unknownScore
      ]
    });

    const observation = replayLearningResourceCoverage(source).observations[0];
    expect(observation).toMatchObject({ eventId: "unknown-game-end" });
    expect(observation).not.toHaveProperty("gameNumber");
    expect(observation).not.toHaveProperty("playerTurnNumber");
    expect(replayLearningBattlefieldConversions(source)[0]).not.toHaveProperty("gameNumber");
  });

  it("deduplicates sideboard changes and reports subsequent captured card flow", () => {
    const original = sideboardChange();
    const updated = sideboardChange({ qty: 2, capturedAt: at(22) });
    const source = replay({
      deckTrackerSnapshots: [
        snapshot("before", 10, [], []),
        snapshot("change-one", 20, [original], [trackerCard(0)]),
        snapshot("change-repeat", 22, [updated], [trackerCard(0)]),
        snapshot("after-visible", 60, [updated], [trackerCard(2)])
      ],
      structuredEvents: [
        event("pre-change-play", 15, "play", { gameNumber: 1, cardName: "Charm", cardId: "TST-100" }),
        event("draw-charm", 30, "draw", { gameNumber: 2, cardName: "Charm", cardId: "TST-100", toZone: "hand" }),
        event("play-charm", 40, "play", { gameNumber: 2, cardName: "Charm", cardId: "TST-100", fromZone: "hand" }),
        event("recycle-charm", 50, "move", { gameNumber: 2, cardName: "Charm", cardId: "TST-100", toZone: "recycle" }),
        event("other-card", 55, "play", { gameNumber: 2, cardName: "Scout", cardId: "TST-200" })
      ]
    });

    expect(replayLearningSideboardFlows(source)).toEqual([{
      key: "charm|game:2",
      cardKey: "charm",
      cardName: "Charm",
      cardId: "TST-100",
      code: "TST-100",
      imageUrl: "charm.png",
      gameNumber: 2,
      changeIds: ["change-charm-in"],
      sources: ["atlas"],
      firstChangedAt: at(22),
      lastChangedAt: at(22),
      boardedInQuantity: 2,
      boardedOutQuantity: 0,
      subsequentVisibleCount: 2,
      visibleCountBasis: "deck-tracker-seen-delta",
      subsequentPlayedCount: 1,
      subsequentRecycledCount: 1
    }]);
  });

  it("keeps subsequent sideboard observations unknown when no later evidence exists", () => {
    const change = sideboardChange();
    const source = replay({ deckTrackerSnapshots: [snapshot("change", 20, [change], [])] });
    expect(replayLearningSideboardFlows(source)[0]).toMatchObject({
      boardedInQuantity: 1,
      subsequentVisibleCount: null,
      visibleCountBasis: "unknown",
      subsequentPlayedCount: null,
      subsequentRecycledCount: null
    });
  });

  it("does not join sideboard evidence from a later game", () => {
    const change = sideboardChange({ gameNumber: 2 });
    const source = replay({
      deckTrackerSnapshots: [
        snapshot("game-two-change", 20, [change], [trackerCard(0)], 2),
        snapshot("game-three-visible", 60, [change], [trackerCard(2)], 3)
      ],
      structuredEvents: [
        event("game-two-other-card", 30, "play", { gameNumber: 2, cardName: "Scout", cardId: "TST-200" }),
        event("game-three-charm", 40, "play", { gameNumber: 3, cardName: "Charm", cardId: "TST-100" })
      ]
    });

    expect(replayLearningSideboardFlows(source)[0]).toMatchObject({
      gameNumber: 2,
      subsequentVisibleCount: 0,
      subsequentPlayedCount: 0,
      subsequentRecycledCount: 0
    });
  });

  it("keeps separate unknown-game sideboard changes separate and unjoined", () => {
    const first = sideboardChange({ id: "unknown-change-one", gameNumber: undefined, capturedAt: at(20) });
    const second = sideboardChange({ id: "unknown-change-two", gameNumber: undefined, capturedAt: at(40) });
    const source = replay({
      deckTrackerSnapshots: [
        snapshot("unknown-change-snapshot", 40, [first, second], [trackerCard(2)])
      ],
      structuredEvents: [event("later-charm", 50, "play", { gameNumber: 3, cardName: "Charm", cardId: "TST-100" })]
    });

    const rows = replayLearningSideboardFlows(source);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.gameNumber == null)).toBe(true);
    expect(rows.every((row) => row.subsequentVisibleCount == null && row.subsequentPlayedCount == null)).toBe(true);
  });

  it("creates battlefield conversions only from fully attributed explicit score events", () => {
    const source = replay({
      structuredEvents: [
        event("conversion", 20, "score", {
          battlefield: "Minefield",
          scoreReason: "conquer",
          pointsScored: 1,
          score: { me: 4, opponent: 2 }
        }),
        event("score-without-place", 30, "score", { scoreReason: "hold", pointsScored: 1 }),
        event("score-without-reason", 40, "score", { battlefield: "Grove", pointsScored: 1 }),
        event("scoreboard", 50, "scoreboard", { battlefield: "Minefield", scoreReason: "manual", score: { me: 5, opponent: 2 } })
      ]
    });

    expect(replayLearningBattlefieldConversions(source)).toEqual([{
      eventId: "conversion",
      gameNumber: 1,
      capturedAt: at(20),
      side: "me",
      battlefield: "Minefield",
      reason: "conquer",
      pointsScored: 1,
      scoreAfter: { me: 4, opponent: 2 }
    }]);
  });

  it("builds a neutral capability receipt from persisted evidence only", () => {
    const change = sideboardChange();
    const source = replay({
      structuredEvents: [
        event("mulligan", 1, "mulligan", { mulligan: { kept: [{ id: "c", name: "Charm", code: "TST-100", type: "card", imageUrl: "" }] } }),
        event("turn", 2, "turn-start"),
        event("play", 3, "play", { cardName: "Charm", cardId: "TST-100" }),
        event("end", 4, "turn-end", { resource: { after: { energy: 0, power: 0, xp: 1, runesReady: 0, runesExhausted: 1 } } }),
        event("combat", 5, "combat", { combat: { battlefield: "Minefield", winner: "me", attackers: [], defenders: [] } }),
        event("score", 6, "score", { battlefield: "Minefield", scoreReason: "hold", pointsScored: 1 })
      ],
      deckTrackerSnapshots: [snapshot("change", 2, [change], [trackerCard(0)])]
    });
    const signals = extractReplayLearningSignals(source);

    expect(signals.capabilities).toMatchObject({
      replayId: source.id,
      openingHand: { state: "available", evidenceCount: 1 },
      cardTiming: { state: "available", evidenceCount: 1 },
      resources: { state: "available", evidenceCount: 1 },
      sideboard: { state: "available", evidenceCount: 1 },
      combat: { state: "available", evidenceCount: 1 },
      battlefield: { state: "available", evidenceCount: 1 }
    });
    expect(JSON.stringify(signals).toLowerCase()).not.toMatch(/\b(?:good|bad|mistake)\b/);
  });

  it("uses partial and unknown instead of inventing absent capabilities", () => {
    const source = replay({
      structuredEvents: [
        event("mulligan", 1, "mulligan"),
        event("play", 2, "play", { cardName: "Charm" }),
        event("end", 3, "turn-end"),
        event("combat", 4, "combat"),
        event("battlefield", 5, "battlefield", { battlefield: "Minefield" })
      ]
    });
    const receipt = replayLearningCapabilityReceipt(source);

    expect(receipt).toMatchObject({
      openingHand: { state: "partial" },
      cardTiming: { state: "partial" },
      resources: { state: "partial" },
      sideboard: { state: "unknown" },
      combat: { state: "partial" },
      battlefield: { state: "partial" }
    });
  });

  it("does not claim card timing from a turn start in another or unknown game", () => {
    const unknownTurn = withoutGameNumber(event("unknown-turn", 3, "turn-start"));
    const unknownPlay = withoutGameNumber(event("unknown-play", 4, "play", { cardName: "Charm", cardId: "TST-100" }));
    const source = replay({
      structuredEvents: [
        event("game-one-turn", 1, "turn-start", { gameNumber: 1 }),
        event("game-two-play", 2, "play", { gameNumber: 2, cardName: "Charm", cardId: "TST-100" }),
        unknownTurn,
        unknownPlay
      ]
    });

    expect(replayLearningCapabilityReceipt(source).cardTiming).toMatchObject({
      state: "partial",
      evidenceCount: 4
    });
  });

  it("is pure and bounds large conversion collections", () => {
    const source = replay({
      structuredEvents: Array.from({ length: 180 }, (_, index) => event(`score-${index}`, index, "score", {
        battlefield: "Minefield",
        scoreReason: "hold",
        pointsScored: 1
      }))
    });
    const before = JSON.stringify(source);
    expect(replayLearningBattlefieldConversions(source)).toHaveLength(120);
    expect(JSON.stringify(source)).toBe(before);
  });
});
