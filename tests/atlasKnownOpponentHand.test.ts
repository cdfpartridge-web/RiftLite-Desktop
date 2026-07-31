import { describe, expect, it } from "vitest";
import { AtlasKnownOpponentHandTracker } from "../src/shared/atlasKnownOpponentHand";
import type { RawCaptureAppendFramePayload } from "../src/shared/types";

let nextSequence = 1;
let nextServerSequence = 71;

function frame(
  packet: unknown,
  options: {
    dir?: "in" | "out";
    requestUrl?: string;
    ts?: number;
  } = {}
): RawCaptureAppendFramePayload {
  const sequence = nextSequence++;
  return {
    platform: "atlas",
    requestUrl: options.requestUrl ?? "wss://realtime.riftatlas-workers.com/parties/match/836WZ?_pk=secret&playerId=plr_local&roomCode=836WZ",
    frame: {
      seq: sequence,
      ts: options.ts ?? 1785200000000 + sequence,
      dir: options.dir ?? "in",
      socketId: "atlas-ws-1",
      raw: JSON.stringify(packet)
    }
  };
}

function fullCard(
  id: string,
  cardCode: string,
  name: string,
  ownerPlayerId = "plr_opp"
) {
  return {
    id,
    name,
    source: "mainDeck",
    ownerPlayerId,
    exhausted: false,
    createdAt: 1785200000000,
    cardCode,
    type: "gear",
    isPlaceholder: false
  };
}

function placeholder(index: number, ownerPlayerId = "plr_opp") {
  return {
    id: `__hidden_zone__:${ownerPlayerId}:hand:${index}`,
    name: "",
    ownerPlayerId,
    isPlaceholder: true
  };
}

function revealCommit(
  cards: unknown[],
  revealed = true,
  playerId = "plr_opp",
  gameNumber = 1
) {
  return {
    type: "authoritative_patch_commit",
    gameInstanceId: "836WZ",
    gameNumber,
    sequence: nextServerSequence++,
    action: { type: "set_hand_reveal" },
    patch: {
      operations: [
        {
          op: "set_board_fields",
          playerId,
          fields: { handRevealToOpponent: revealed }
        },
        ...cards.map((card, index) => ({
          op: "zone_insert",
          playerId,
          zone: "hand",
          index,
          cards: [card]
        }))
      ]
    }
  };
}

function seedReveal(tracker: AtlasKnownOpponentHandTracker): void {
  expect(tracker.ingest(frame(revealCommit([
    fullCard("card_charm", "OGN-058", "Discipline"),
    fullCard("card_flash_a", "OGS-011", "Flash"),
    fullCard("card_flash_b", "OGS-011", "Flash"),
    fullCard("card_unit", "SFD-128", "Overzealous Fan")
  ])))).toBe(true);
}

describe("AtlasKnownOpponentHandTracker", () => {
  it("captures a real incoming Atlas reveal and keeps duplicate prints by exact instance", () => {
    const tracker = new AtlasKnownOpponentHandTracker();

    expect(tracker.ingest(frame(revealCommit([
      fullCard("card_de22c340", "OGN-058", "Discipline"),
      fullCard("card_flash_a", "OGS-011", "Flash"),
      fullCard("card_flash_b", "OGS-011", "Flash"),
      fullCard("card_unit", "SFD-128", "Overzealous Fan")
    ])))).toBe(true);

    const state = tracker.getState();
    expect(state).toMatchObject({
      roomCode: "836WZ",
      gameNumber: 1,
      opponentPlayerId: "plr_opp",
      activeReveal: true,
      opponentHandCount: 4
    });
    expect(state.cards.map((card) => ({
      instanceId: card.instanceId,
      cardKey: card.cardKey,
      code: card.code,
      name: card.name,
      cardId: card.cardId
    }))).toEqual([
      {
        instanceId: "card_de22c340",
        cardKey: "ogn058",
        code: "OGN-058",
        name: "Discipline",
        cardId: "OGN-058"
      },
      {
        instanceId: "card_flash_a",
        cardKey: "ogs011",
        code: "OGS-011",
        name: "Flash",
        cardId: "OGS-011"
      },
      {
        instanceId: "card_flash_b",
        cardKey: "ogs011",
        code: "OGS-011",
        name: "Flash",
        cardId: "OGS-011"
      },
      {
        instanceId: "card_unit",
        cardKey: "sfd128",
        code: "SFD-128",
        name: "Overzealous Fan",
        cardId: "SFD-128"
      }
    ]);
    expect(state.revealedAt).toBe(state.cards[0]?.revealedAt);
  });

  it("learns local identity from a player room shell, an outbound action actor, or URL", () => {
    const fromShell = new AtlasKnownOpponentHandTracker();
    expect(fromShell.ingest(frame({
      type: "room_shell_sync",
      sessionDoc: {
        roomCode: "836WZ",
        gameNumber: 1,
        viewer: { role: "player", playerId: "plr_local" },
        selfPlayer: { id: "plr_local" }
      }
    }, { requestUrl: "wss://realtime.riftatlas-workers.com/parties/match/836WZ" }))).toBe(true);
    expect(fromShell.ingest(frame(revealCommit([
      fullCard("shell_card", "OGN-058", "Discipline")
    ]), { requestUrl: "wss://realtime.riftatlas-workers.com/parties/match/836WZ" }))).toBe(true);
    expect(fromShell.getState().cards.map((card) => card.instanceId)).toEqual(["shell_card"]);

    const fromAction = new AtlasKnownOpponentHandTracker();
    expect(fromAction.ingest(frame({
      type: "action_intent",
      action: { type: "pass", actorPlayerId: "plr_local" }
    }, {
      dir: "out",
      requestUrl: "wss://realtime.riftatlas-workers.com/parties/match/836WZ"
    }))).toBe(true);
    expect(fromAction.ingest(frame(revealCommit([
      fullCard("action_card", "OGS-011", "Flash")
    ]), { requestUrl: "wss://realtime.riftatlas-workers.com/parties/match/836WZ" }))).toBe(true);
    expect(fromAction.getState().cards.map((card) => card.instanceId)).toEqual(["action_card"]);

    const fromUrl = new AtlasKnownOpponentHandTracker();
    expect(fromUrl.ingest(frame(revealCommit([
      fullCard("url_card", "SFD-128", "Overzealous Fan")
    ])))).toBe(true);
    expect(fromUrl.getState().cards.map((card) => card.instanceId)).toEqual(["url_card"]);
  });

  it("fails closed for spectators, outbound reveals, snapshots, missing companion cards, and placeholders", () => {
    const spectator = new AtlasKnownOpponentHandTracker();
    const spectatorUrl = "wss://realtime.riftatlas-workers.com/parties/match/836WZ?playerId=spectator&roomCode=836WZ";
    expect(spectator.ingest(frame(revealCommit([
      fullCard("must_not_leak", "OGN-058", "Discipline")
    ]), { requestUrl: spectatorUrl }))).toBe(true);
    expect(spectator.getState().cards).toEqual([]);

    const tracker = new AtlasKnownOpponentHandTracker();
    expect(tracker.ingest(frame(revealCommit([
      fullCard("outbound_card", "OGN-058", "Discipline")
    ]), { dir: "out" }))).toBe(true);
    expect(tracker.getState().cards).toEqual([]);

    expect(tracker.ingest(frame({
      type: "authoritative_snapshot",
      snapshot: {
        players: [{
          id: "plr_opp",
          board: {
            handRevealToOpponent: true,
            hand: [fullCard("snapshot_card", "OGN-058", "Discipline")]
          }
        }]
      }
    }))).toBe(false);
    expect(tracker.getState().cards).toEqual([]);

    expect(tracker.ingest(frame(revealCommit([], true)))).toBe(false);
    expect(tracker.ingest(frame(revealCommit([placeholder(0)], true)))).toBe(false);
    expect(tracker.getState().cards).toEqual([]);
    expect(tracker.getState().activeReveal).toBe(false);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      patch: {
        operations: [
          {
            op: "set_board_fields",
            playerId: "plr_opp",
            fields: { handRevealToOpponent: true }
          },
          {
            op: "set_board_fields",
            playerId: "plr_third",
            fields: { handRevealToOpponent: true }
          },
          {
            op: "zone_insert",
            playerId: "plr_opp",
            zone: "hand",
            cards: [fullCard("ambiguous_card", "OGN-058", "Discipline")]
          }
        ]
      }
    }))).toBe(false);
    expect(tracker.getState().cards).toEqual([]);
  });

  it("accepts an authoritative empty-hand reveal and clears stale remembered cards", () => {
    const tracker = new AtlasKnownOpponentHandTracker();
    seedReveal(tracker);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      sequence: nextServerSequence++,
      patch: {
        operations: [
          {
            op: "set_board_fields",
            playerId: "plr_opp",
            fields: { handRevealToOpponent: true }
          },
          {
            op: "zone_remove",
            playerId: "plr_opp",
            zone: "hand",
            cardIds: ["card_charm", "card_flash_a", "card_flash_b", "card_unit"]
          }
        ]
      }
    }))).toBe(true);

    expect(tracker.getState()).toMatchObject({
      activeReveal: true,
      opponentHandCount: 0,
      cards: []
    });

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      sequence: nextServerSequence++,
      patch: {
        operations: [{
          op: "set_board_fields",
          playerId: "plr_opp",
          fields: { handRevealToOpponent: false }
        }]
      }
    }))).toBe(true);
    expect(tracker.getState().activeReveal).toBe(false);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      sequence: nextServerSequence++,
      patch: {
        operations: [{
          op: "set_board_fields",
          playerId: "plr_opp",
          fields: { handRevealToOpponent: true }
        }]
      }
    }))).toBe(true);
    expect(tracker.getState()).toMatchObject({
      activeReveal: true,
      opponentHandCount: 0,
      cards: []
    });
  });

  it("hides without forgetting five exact cards when the current hand grows to six", () => {
    const tracker = new AtlasKnownOpponentHandTracker();
    expect(tracker.ingest(frame(revealCommit([
      fullCard("known_1", "OGN-058", "Discipline"),
      fullCard("known_2", "OGS-011", "Flash"),
      fullCard("known_3", "SFD-128", "Overzealous Fan"),
      fullCard("known_4", "OGN-172", "Rebuke"),
      fullCard("known_5", "OGN-199", "Tideturner"),
      fullCard("known_6", "UNL-150", "Vex, Apathetic")
    ])))).toBe(true);
    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      patch: {
        operations: [{
          op: "zone_move",
          from: { playerId: "plr_opp", zone: "hand" },
          to: { playerId: "plr_opp", zone: "trash" },
          card: fullCard("known_6", "UNL-150", "Vex, Apathetic")
        }]
      }
    }))).toBe(true);
    expect(tracker.getState().cards).toHaveLength(5);
    expect(tracker.getState().opponentHandCount).toBe(5);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      action: { type: "end_turn" },
      patch: {
        operations: [
          {
            op: "set_board_fields",
            playerId: "plr_opp",
            fields: { handRevealToOpponent: false }
          },
          ...Array.from({ length: 5 }, (_, index) => ({
            op: "zone_remove",
            playerId: "plr_opp",
            zone: "hand",
            index: 0
          })),
          ...Array.from({ length: 6 }, (_, index) => ({
            op: "zone_insert",
            playerId: "plr_opp",
            zone: "hand",
            index,
            cards: [placeholder(index)]
          }))
        ]
      }
    }))).toBe(true);

    expect(tracker.getState()).toMatchObject({
      activeReveal: false,
      opponentHandCount: 6
    });
    expect(tracker.getState().cards.map((card) => card.instanceId)).toEqual([
      "known_1",
      "known_2",
      "known_3",
      "known_4",
      "known_5"
    ]);
  });

  it("adds exact insertions while the reveal stays active without collapsing duplicate prints", () => {
    const tracker = new AtlasKnownOpponentHandTracker();
    seedReveal(tracker);

    const draw = frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      patch: {
        operations: [{
          op: "zone_insert",
          playerId: "plr_opp",
          zone: "hand",
          cards: [fullCard("card_flash_c", "OGS-011", "Flash")]
        }]
      }
    });
    expect(tracker.ingest(draw)).toBe(true);
    expect(tracker.getState().opponentHandCount).toBe(5);
    expect(tracker.getState().cards.filter((card) => card.code === "OGS-011")).toHaveLength(3);

    expect(tracker.ingest(draw)).toBe(false);
    expect(tracker.getState().opponentHandCount).toBe(5);
  });

  it("removes exact known instances at public destinations and from chain source IDs", () => {
    const tracker = new AtlasKnownOpponentHandTracker();
    seedReveal(tracker);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      patch: {
        operations: [{
          op: "zone_move",
          from: { playerId: "plr_opp", zone: "hand" },
          to: { playerId: "plr_opp", zone: "trash" },
          card: fullCard("card_charm", "OGN-058", "Discipline")
        }]
      }
    }))).toBe(true);
    expect(tracker.getState().cards.map((card) => card.instanceId)).not.toContain("card_charm");
    expect(tracker.getState().opponentHandCount).toBe(3);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      patch: {
        operations: [
          { op: "zone_remove", playerId: "plr_opp", zone: "hand", index: 0 },
          {
            op: "zone_insert",
            playerId: "plr_opp",
            zone: "battlefieldA",
            cards: [fullCard("card_unit", "SFD-128", "Overzealous Fan")]
          }
        ]
      }
    }))).toBe(true);
    expect(tracker.getState().cards.map((card) => card.instanceId)).not.toContain("card_unit");
    expect(tracker.getState().opponentHandCount).toBe(2);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      patch: {
        operations: [
          { op: "zone_remove", playerId: "plr_opp", zone: "hand", index: 0 },
          {
            op: "chain_insert",
            entries: [{
              byPlayerId: "plr_opp",
              sourceCardId: "card_flash_a",
              card: fullCard("chain_copy", "OGS-011", "Flash")
            }]
          }
        ]
      }
    }))).toBe(true);
    expect(tracker.getState().cards.map((card) => card.instanceId)).toEqual(["card_flash_b"]);
    expect(tracker.getState().opponentHandCount).toBe(1);
  });

  it("removes exact hidden departures without mistaking concealment replacement for play", () => {
    const tracker = new AtlasKnownOpponentHandTracker();
    seedReveal(tracker);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      patch: {
        operations: [{
          op: "zone_move",
          from: { playerId: "plr_opp", zone: "hand" },
          to: { playerId: "plr_opp", zone: "deck" },
          cardId: "card_charm"
        }]
      }
    }))).toBe(true);
    expect(tracker.getState().cards.map((card) => card.instanceId)).not.toContain("card_charm");

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      patch: {
        operations: [{
          op: "zone_remove",
          playerId: "plr_opp",
          zone: "hand",
          cards: [{ id: "card_flash_a" }]
        }]
      }
    }))).toBe(true);
    expect(tracker.getState().cards.map((card) => card.instanceId)).toEqual([
      "card_flash_b",
      "card_unit"
    ]);
    expect(tracker.getState().opponentHandCount).toBe(2);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      patch: {
        operations: [
          {
            op: "set_board_fields",
            playerId: "plr_opp",
            fields: { handRevealToOpponent: false }
          },
          {
            op: "zone_remove",
            playerId: "plr_opp",
            zone: "hand",
            cards: [
              { id: "card_flash_b" },
              { id: "card_unit" }
            ]
          },
          ...Array.from({ length: 2 }, (_, index) => ({
            op: "zone_insert",
            playerId: "plr_opp",
            zone: "hand",
            index,
            cards: [placeholder(index)]
          }))
        ]
      }
    }))).toBe(true);

    expect(tracker.getState()).toMatchObject({
      activeReveal: false,
      opponentHandCount: 2
    });
    expect(tracker.getState().cards.map((card) => card.instanceId)).toEqual([
      "card_flash_b",
      "card_unit"
    ]);
  });

  it("restores a legitimately known instance that moves back into hand", () => {
    const tracker = new AtlasKnownOpponentHandTracker();
    seedReveal(tracker);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      sequence: nextServerSequence++,
      patch: {
        operations: [{
          op: "zone_move",
          from: { playerId: "plr_opp", zone: "hand" },
          to: { playerId: "plr_opp", zone: "base" },
          cardId: "card_unit"
        }]
      }
    }))).toBe(true);
    expect(tracker.getState().cards.map((card) => card.instanceId)).not.toContain("card_unit");
    expect(tracker.getState().opponentHandCount).toBe(3);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      sequence: nextServerSequence++,
      patch: {
        operations: [{
          op: "zone_move",
          from: { playerId: "plr_opp", zone: "base" },
          to: { playerId: "plr_opp", zone: "hand", index: 3 },
          cardId: "card_unit"
        }]
      }
    }))).toBe(true);
    expect(tracker.getState().cards.map((card) => card.instanceId)).toContain("card_unit");
    expect(tracker.getState().opponentHandCount).toBe(4);
  });

  it("restores known public and chain sources when Atlas hides the return identity", () => {
    const tracker = new AtlasKnownOpponentHandTracker();
    seedReveal(tracker);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      sequence: nextServerSequence++,
      patch: {
        operations: [{
          op: "zone_move",
          from: { playerId: "plr_opp", zone: "hand" },
          to: { playerId: "plr_opp", zone: "base" },
          cardId: "card_unit"
        }]
      }
    }))).toBe(true);
    expect(tracker.getState().cards.map((card) => card.instanceId)).not.toContain("card_unit");

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      sequence: nextServerSequence++,
      patch: {
        operations: [
          {
            op: "set_board_fields",
            playerId: "plr_opp",
            fields: { handRevealToOpponent: false }
          },
          {
            op: "zone_remove",
            playerId: "plr_opp",
            zone: "hand",
            cardIds: ["card_charm", "card_flash_a", "card_flash_b"]
          },
          ...Array.from({ length: 3 }, (_, index) => ({
            op: "zone_insert",
            playerId: "plr_opp",
            zone: "hand",
            cards: [placeholder(index)]
          }))
        ]
      }
    }))).toBe(true);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      sequence: nextServerSequence++,
      patch: {
        operations: [
          {
            op: "zone_remove",
            playerId: "plr_opp",
            zone: "base",
            cardIds: ["card_unit"]
          },
          {
            op: "zone_insert",
            playerId: "plr_opp",
            zone: "hand",
            cards: [placeholder(3)]
          }
        ]
      }
    }))).toBe(true);
    expect(tracker.getState().cards.map((card) => card.instanceId)).toContain("card_unit");
    expect(tracker.getState().opponentHandCount).toBe(4);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      sequence: nextServerSequence++,
      patch: {
        operations: [
          {
            op: "chain_insert",
            entries: [{
              id: "chain_entry_flash",
              byPlayerId: "plr_opp",
              sourceCardId: "card_flash_a",
              card: fullCard("chain_copy", "OGS-011", "Flash")
            }]
          },
          {
            op: "zone_remove",
            playerId: "plr_opp",
            zone: "hand",
            cardIds: ["__hidden_zone__:plr_opp:hand:1"]
          }
        ]
      }
    }))).toBe(true);
    expect(tracker.getState().cards.map((card) => card.instanceId)).not.toContain("card_flash_a");
    expect(tracker.getState().opponentHandCount).toBe(3);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      sequence: nextServerSequence++,
      patch: {
        operations: [
          {
            op: "chain_remove",
            entryIds: ["chain_entry_flash"]
          },
          {
            op: "zone_insert",
            playerId: "plr_opp",
            zone: "hand",
            cards: [placeholder(3)]
          }
        ]
      }
    }))).toBe(true);
    expect(tracker.getState().cards.map((card) => card.instanceId)).toContain("card_flash_a");
    expect(tracker.getState().opponentHandCount).toBe(4);
  });

  it("counts every cardIds removal even when one exact card was manually dismissed", () => {
    const tracker = new AtlasKnownOpponentHandTracker();
    seedReveal(tracker);
    expect(tracker.dismiss("card_flash_a")).toBe(true);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      sequence: nextServerSequence++,
      patch: {
        operations: [{
          op: "zone_remove",
          playerId: "plr_opp",
          zone: "hand",
          cardIds: ["card_flash_a", "card_charm"]
        }]
      }
    }))).toBe(true);

    expect(tracker.getState().opponentHandCount).toBe(2);
    expect(tracker.getState().cards.map((card) => card.instanceId)).toEqual([
      "card_flash_b",
      "card_unit"
    ]);
  });

  it("reconciles the remembered set on each subsequent exact reveal", () => {
    const tracker = new AtlasKnownOpponentHandTracker();
    seedReveal(tracker);

    expect(tracker.ingest(frame(revealCommit([
      fullCard("card_flash_b", "OGS-011", "Flash"),
      fullCard("card_new", "OGN-172", "Rebuke")
    ]), { ts: 1785200010000 }))).toBe(true);

    expect(tracker.getState().cards.map((card) => card.instanceId)).toEqual([
      "card_flash_b",
      "card_new"
    ]);
    expect(tracker.getState().opponentHandCount).toBe(2);
    expect(tracker.getState().cards.every((card) => card.revealedAt === "2026-07-28T00:53:30.000Z")).toBe(true);
  });

  it("supports manual dismiss and clear while keeping immutable serializable snapshots", () => {
    const tracker = new AtlasKnownOpponentHandTracker();
    seedReveal(tracker);
    const before = tracker.getState();

    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.cards)).toBe(true);
    expect(Object.isFrozen(before.cards[0])).toBe(true);
    expect(() => before.cards.push(before.cards[0]!)).toThrow();
    expect(() => JSON.parse(JSON.stringify(before))).not.toThrow();

    expect(tracker.dismiss("card_flash_a")).toBe(true);
    expect(tracker.dismiss("card_flash_a")).toBe(false);
    expect(tracker.getState().cards.map((card) => card.instanceId)).not.toContain("card_flash_a");
    expect(before.cards.map((card) => card.instanceId)).toContain("card_flash_a");
    expect(tracker.getState().opponentHandCount).toBe(4);

    expect(tracker.clear()).toBe(true);
    expect(tracker.getState()).toMatchObject({
      roomCode: "836WZ",
      opponentPlayerId: "plr_opp",
      activeReveal: true,
      opponentHandCount: 4,
      cards: []
    });
    expect(tracker.clear()).toBe(false);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      sequence: nextServerSequence++,
      patch: {
        operations: [{
          op: "zone_insert",
          playerId: "plr_opp",
          zone: "hand",
          cards: [fullCard("card_after_clear", "OGN-172", "Rebuke")]
        }]
      }
    }))).toBe(true);
    expect(tracker.getState().cards.map((card) => card.instanceId)).toEqual(["card_after_clear"]);
    expect(tracker.getState().opponentHandCount).toBe(5);
  });

  it("dedupes retransmits by authoritative content without dropping same-millisecond frames", () => {
    const tracker = new AtlasKnownOpponentHandTracker();
    const reveal = frame(revealCommit([
      fullCard("first_card", "OGN-058", "Discipline")
    ]), { ts: 1785200020000 });
    reveal.frame.seq = 0;
    expect(tracker.ingest(reveal)).toBe(true);

    const draw = frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      gameNumber: 1,
      sequence: nextServerSequence++,
      patch: {
        operations: [{
          op: "zone_insert",
          playerId: "plr_opp",
          zone: "hand",
          cards: [fullCard("second_card", "OGS-011", "Flash")]
        }]
      }
    }, { ts: 1785200020000 });
    draw.frame.seq = 0;
    expect(tracker.ingest(draw)).toBe(true);
    expect(tracker.getState().cards).toHaveLength(2);

    const retransmitPacket = JSON.parse(draw.frame.raw) as Record<string, unknown>;
    const retransmit = {
      ...draw,
      frame: {
        ...draw.frame,
        seq: 99,
        ts: 1785200021000,
        raw: JSON.stringify(retransmitPacket, null, 2)
      }
    };
    expect(tracker.ingest(retransmit)).toBe(false);
    expect(tracker.getState().opponentHandCount).toBe(2);
  });

  it("drops local-seat authority on a room boundary or explicit reset", () => {
    const tracker = new AtlasKnownOpponentHandTracker();
    seedReveal(tracker);

    const noIdentityUrl = "wss://realtime.riftatlas-workers.com/parties/match/NEW42?roomCode=NEW42";
    expect(tracker.ingest(frame({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "NEW42", gameNumber: 1 }
    }, { requestUrl: noIdentityUrl }))).toBe(true);
    expect(tracker.getState().cards).toEqual([]);

    expect(tracker.ingest(frame({
      ...revealCommit([fullCard("must_wait_for_identity", "OGN-058", "Discipline")]),
      gameInstanceId: "NEW42"
    }, { requestUrl: noIdentityUrl }))).toBe(false);
    expect(tracker.getState().cards).toEqual([]);

    expect(tracker.ingest(frame({
      type: "action_intent",
      action: { type: "pass", actorPlayerId: "plr_local" }
    }, { dir: "out", requestUrl: noIdentityUrl }))).toBe(false);
    expect(tracker.ingest(frame({
      ...revealCommit([fullCard("new_room_card", "OGS-011", "Flash")]),
      gameInstanceId: "NEW42"
    }, { requestUrl: noIdentityUrl }))).toBe(true);
    expect(tracker.getState().cards.map((card) => card.instanceId)).toEqual(["new_room_card"]);

    expect(tracker.reset()).toBe(true);
    expect(tracker.ingest(frame({
      ...revealCommit([fullCard("must_wait_after_reset", "OGN-172", "Rebuke")]),
      gameInstanceId: "NEW42"
    }, { requestUrl: noIdentityUrl }))).toBe(true);
    expect(tracker.getState().cards).toEqual([]);
  });

  it("clears revealed identities when the same room becomes a spectator or another seat", () => {
    const spectator = new AtlasKnownOpponentHandTracker();
    seedReveal(spectator);

    expect(spectator.ingest(frame({
      type: "room_shell_sync",
      sessionDoc: {
        roomCode: "836WZ",
        gameNumber: 1,
        viewer: { role: "spectator", playerId: "spectator" }
      }
    }, {
      requestUrl: "wss://realtime.riftatlas-workers.com/parties/match/836WZ?playerId=spectator&roomCode=836WZ"
    }))).toBe(true);
    expect(spectator.getState()).toMatchObject({
      roomCode: "836WZ",
      gameNumber: 1,
      opponentPlayerId: "",
      activeReveal: false,
      cards: []
    });

    const seatSwap = new AtlasKnownOpponentHandTracker();
    seedReveal(seatSwap);
    expect(seatSwap.ingest(frame({
      type: "room_shell_sync",
      sessionDoc: {
        roomCode: "836WZ",
        gameNumber: 1,
        viewer: { role: "player", playerId: "plr_new_local" },
        selfPlayer: { id: "plr_new_local" }
      }
    }, {
      requestUrl: "wss://realtime.riftatlas-workers.com/parties/match/836WZ?playerId=plr_new_local&roomCode=836WZ"
    }))).toBe(true);
    expect(seatSwap.getState()).toMatchObject({
      opponentPlayerId: "",
      activeReveal: false,
      cards: []
    });
  });

  it("clears remembered identities on game, room, and room-shell-leave boundaries", () => {
    const tracker = new AtlasKnownOpponentHandTracker();
    seedReveal(tracker);

    expect(tracker.ingest(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "836WZ",
      patch: {
        operations: [{
          op: "set_room_fields",
          fields: { gameNumber: 2 }
        }]
      }
    }))).toBe(true);
    expect(tracker.getState()).toMatchObject({
      roomCode: "836WZ",
      gameNumber: 2,
      opponentPlayerId: "",
      activeReveal: false,
      opponentHandCount: null,
      cards: []
    });

    expect(tracker.ingest(frame(revealCommit([
      fullCard("game_two_card", "OGN-058", "Discipline")
    ], true, "plr_opp", 2)))).toBe(true);
    expect(tracker.ingest(frame({
      type: "room_shell_sync",
      sessionDoc: {
        roomCode: "NEW42",
        gameNumber: 1,
        viewer: { role: "player", playerId: "plr_local" },
        selfPlayer: { id: "plr_local" }
      }
    }, {
      requestUrl: "wss://realtime.riftatlas-workers.com/parties/match/NEW42?playerId=plr_local&roomCode=NEW42"
    }))).toBe(true);
    expect(tracker.getState()).toMatchObject({
      roomCode: "NEW42",
      gameNumber: 1,
      opponentPlayerId: "",
      opponentHandCount: null,
      cards: []
    });

    expect(tracker.ingest(frame({
      type: "room_shell_leave",
      gameInstanceId: "NEW42"
    }))).toBe(true);
    expect(tracker.getState()).toEqual({
      roomCode: "",
      opponentPlayerId: "",
      activeReveal: false,
      opponentHandCount: null,
      revealedAt: "",
      updatedAt: tracker.getState().updatedAt,
      cards: []
    });
  });
});
