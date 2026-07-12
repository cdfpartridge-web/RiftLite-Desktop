import { describe, expect, it } from "vitest";
import { buildRiftLiteReplayModel } from "../src/shared/riftLiteReplayEngine";

function raw(seq: number, payload: unknown, ts = 1781360000000 + seq * 1000) {
  return {
    seq,
    ts,
    dir: "in",
    raw: JSON.stringify(payload)
  };
}

describe("RiftLite replay engine", () => {
  it("turns raw Atlas frames into intro and board replay frames", () => {
    const model = buildRiftLiteReplayModel({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "capture-1",
        identity: {
          roomCode: "ABCDE",
          firstSeenAt: 1781360000000,
          lastSeenAt: 1781360004000
        },
        lifecycle: {
          lastPhase: "in_game",
          lastGameNumber: 1,
          boundaries: []
        }
      },
      messages: [
        raw(0, {
          type: "room_shell_sync",
          sessionDoc: {
            roomCode: "ABCDE",
            phase: "in_game",
            gameNumber: 1,
            format: "Bo1",
            players: [
              {
                id: "local",
                name: "BMU",
                role: "player",
                legend: { name: "Diana, Scorn of the Moon", cardId: "OGN-001" },
                champion: { name: "Diana, Lunari", cardId: "OGN-002" },
                deck: 34,
                runes: [{ name: "Calm Rune", cardId: "OGN-100" }]
              },
              {
                id: "opponent",
                name: "Apollo",
                role: "opponent",
                legend: { name: "Fiora, Victorious", cardId: "OGN-003" },
                deck: 35
              }
            ]
          }
        }),
        raw(1, {
          type: "authoritative_snapshot",
          snapshot: {
            players: [
              {
                id: "local",
                name: "BMU",
                score: 1,
                hand: [{ name: "Tideturner", cardId: "OGN-199" }],
                battlefield: [{ name: "Targon's Peak", cardId: "OGN-289" }],
                base: [{ name: "Diana, Lunari", cardId: "OGN-002" }],
                trash: [{ name: "Flash", cardId: "OGS-011" }]
              },
              {
                id: "opponent",
                name: "Apollo",
                score: 0,
                battlefield: [{ name: "Star Spring", cardId: "UNL-215" }]
              }
            ]
          }
        }),
        raw(2, {
          type: "authoritative_patch_commit",
          ops: [
            {
              op: "zone_insert",
              playerId: "local",
              zone: "chain",
              cards: [{ name: "Ride the Wind", cardId: "OGN-173" }]
            }
          ]
        }),
        raw(3, {
          type: "chat_append",
          entry: { authorPlayerId: "local", message: "BMU score: 1" }
        })
      ]
    });

    expect(model.roomCode).toBe("ABCDE");
    expect(model.frames.slice(0, 5).map((frame) => frame.stage)).toEqual(["matchup", "battlefields", "initiative", "mulligan", "openingHands"]);
    expect(model.frames[0]?.headline).toContain("Fiora");
    expect(model.frames.some((frame) => frame.stage === "board")).toBe(true);
    expect(model.players.map((player) => player.name)).toContain("BMU");
    expect(model.events.map((event) => event.label)).toContain("Chat");
    expect(model.frames.at(-1)?.local.zones.trash?.cards.at(-1)?.name).toBe("Flash");
  });

  it("applies real Atlas patch operations to keep the board replay moving", () => {
    const model = buildRiftLiteReplayModel({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "capture-ops",
        identity: { roomCode: "OPS12", firstSeenAt: 1781360000000, lastSeenAt: 1781360008000 },
        lifecycle: { lastPhase: "in_game", lastGameNumber: 1, boundaries: [] }
      },
      messages: [
        raw(0, {
          type: "room_shell_sync",
          sessionDoc: {
            roomCode: "OPS12",
            phase: "mulligan",
            gameNumber: 1,
            matchFormat: "bo3",
            viewer: { role: "player", playerId: "plr_local" },
            selfPlayer: {
              id: "plr_local",
              name: "BMU",
              deck: {
                sections: {
                  legend: [{ count: 1, name: "Vex, Gloomist", cardCode: "UNL-193" }],
                  champion: [{ count: 1, name: "Vex, Apathetic", cardCode: "UNL-150" }],
                  mainDeck: [{ count: 3, name: "Ride the Wind", cardCode: "OGN-173" }],
                  runes: [{ count: 6, name: "Chaos Rune", cardCode: "OGN-166" }]
                }
              },
              board: {
                deck: 40,
                runeDeck: 6,
                hand: []
              }
            },
            opponentPlayer: {
              id: "plr_opp",
              name: "Opponent",
              deck: {
                sections: {
                  legend: [{ count: 1, name: "Diana, Scorn of the Moon", cardCode: "OGN-001" }],
                  champion: [{ count: 1, name: "Diana, Lunari", cardCode: "OGN-002" }]
                }
              },
              board: { deck: 40, hand: [] }
            }
          }
        }),
        raw(1, {
          type: "authoritative_patch_commit",
          patch: {
            operations: [
              { op: "zone_remove", playerId: "plr_local", zone: "deck", cardIds: ["card_drawn"] },
              {
                op: "zone_insert",
                playerId: "plr_local",
                zone: "hand",
                cards: [{ id: "card_drawn", name: "Ride the Wind", cardCode: "OGN-173", ownerPlayerId: "plr_local" }]
              },
              { op: "log_insert", entries: [{ id: "log-1", text: "BMU drew Ride the Wind.", authorPlayerId: "plr_local" }] }
            ]
          }
        }),
        raw(2, {
          type: "authoritative_patch_commit",
          patch: {
            operations: [
              {
                op: "zone_move",
                cardId: "card_drawn",
                from: { playerId: "plr_local", zone: "hand" },
                to: { playerId: "plr_local", zone: "base" },
                card: { id: "card_drawn", name: "Ride the Wind", cardCode: "OGN-173", ownerPlayerId: "plr_local" }
              },
              { op: "set_board_fields", playerId: "plr_local", fields: { score: 1 } },
              { op: "log_insert", entries: [{ id: "log-2", text: "Played Ride the Wind.", authorPlayerId: "plr_local" }] }
            ]
          }
        }),
        raw(3, {
          type: "authoritative_patch_commit",
          patch: {
            operations: [
              {
                op: "chain_insert",
                entries: [{
                  id: "chain-1",
                  byPlayerId: "plr_opp",
                  card: { id: "chain-1", name: "Stupefy", cardCode: "OGN-095", ownerPlayerId: "plr_opp" }
                }]
              }
            ]
          }
        })
      ]
    });

    const lastFrame = model.frames.at(-1);
    expect(lastFrame?.local.name).toBe("BMU");
    expect(lastFrame?.local.deckCount).toBe(39);
    expect(lastFrame?.local.score).toBe(1);
    expect(lastFrame?.local.zones.base?.cards.map((card) => card.name)).toContain("Ride the Wind");
    expect(lastFrame?.local.zones.hand?.cards.map((card) => card.name)).not.toContain("Ride the Wind");
    expect(lastFrame?.local.runeCount).toBe(6);
    expect(lastFrame?.chain.map((card) => card.name)).toContain("Stupefy");
  });

  it("does not rewind board state when Atlas sends a late sideboarding shell sync", () => {
    const model = buildRiftLiteReplayModel({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "capture-late-shell",
        identity: { roomCode: "RESET1", firstSeenAt: 1781360000000, lastSeenAt: 1781360011000 },
        lifecycle: { lastPhase: "sideboarding", lastGameNumber: 1, boundaries: [] }
      },
      messages: [
        raw(0, {
          type: "room_shell_sync",
          sessionDoc: {
            roomCode: "RESET1",
            phase: "sideboarding",
            matchFormat: "bo1",
            viewer: { role: "player", playerId: "plr_local" },
            selfPlayer: {
              id: "plr_local",
              name: "BMU",
              deck: {
                sections: {
                  legend: [{ count: 1, name: "LeBlanc, Deceiver", cardCode: "UNL-199" }],
                  champion: [{ count: 1, name: "LeBlanc, Fragmented", cardCode: "UNL-172" }],
                  mainDeck: [{ count: 40, name: "Hidden Blade", cardCode: "OGN-213" }],
                  battlefields: [{ count: 1, name: "Windswept Hillock", cardCode: "OGN-297" }],
                  runes: [{ count: 12, name: "Mind Rune", cardCode: "OGN-089" }]
                }
              },
              board: { deck: 40, runeDeck: 12 }
            },
            opponentPlayer: {
              id: "plr_opp",
              name: "Azir",
              deck: {
                sections: {
                  legend: [{ count: 1, name: "Azir, Emperor of the Sands", cardCode: "SFD-197" }],
                  champion: [{ count: 1, name: "Azir, Sovereign", cardCode: "SFD-177" }],
                  mainDeck: [{ count: 40, name: "Defy", cardCode: "OGN-045" }],
                  battlefields: [{ count: 1, name: "Hall of Legends", cardCode: "OGN-300" }],
                  runes: [{ count: 12, name: "Calm Rune", cardCode: "OGN-088" }]
                }
              },
              board: { deck: 40, runeDeck: 12 }
            }
          }
        }),
        raw(1, {
          type: "authoritative_patch_commit",
          patch: {
            operations: [
              { op: "set_player_fields", playerId: "plr_local", fields: { selectedBattlefield: "Windswept Hillock" } },
              { op: "set_player_fields", playerId: "plr_opp", fields: { selectedBattlefield: "Hall of Legends" } }
            ]
          }
        }),
        raw(2, {
          type: "authoritative_patch_commit",
          patch: {
            operations: [
              { op: "zone_remove", playerId: "plr_local", zone: "deck", cardIds: ["d1", "d2", "d3", "d4"] },
              {
                op: "zone_insert",
                playerId: "plr_local",
                zone: "hand",
                cards: [
                  { id: "h1", name: "Hidden Blade", cardCode: "OGN-213", ownerPlayerId: "plr_local" },
                  { id: "h2", name: "Mirror Image", cardCode: "UNL-200", ownerPlayerId: "plr_local" }
                ]
              },
              { op: "zone_remove", playerId: "plr_opp", zone: "deck", cardIds: ["o1", "o2", "o3", "o4", "o5"] }
            ]
          }
        }),
        raw(3, {
          type: "authoritative_patch_commit",
          patch: {
            operations: [
              {
                op: "zone_move",
                cardId: "h1",
                from: { playerId: "plr_local", zone: "hand" },
                to: { playerId: "plr_local", zone: "base" },
                card: { id: "h1", name: "Hidden Blade", cardCode: "OGN-213", ownerPlayerId: "plr_local" }
              },
              { op: "set_board_fields", playerId: "plr_local", fields: { score: 1, turnNumber: 3 } }
            ]
          }
        }),
        raw(4, {
          type: "room_shell_sync",
          sessionDoc: {
            roomCode: "RESET1",
            phase: "sideboarding",
            matchFormat: "bo1",
            viewer: { role: "player", playerId: "plr_local" },
            selfPlayer: {
              id: "plr_local",
              name: "BMU",
              deck: {
                sections: {
                  legend: [{ count: 1, name: "LeBlanc, Deceiver", cardCode: "UNL-199" }],
                  champion: [{ count: 1, name: "LeBlanc, Fragmented", cardCode: "UNL-172" }],
                  mainDeck: [{ count: 40, name: "Hidden Blade", cardCode: "OGN-213" }],
                  battlefields: [{ count: 1, name: "Aspirant's Climb", cardCode: "OGN-276" }],
                  runes: [{ count: 12, name: "Mind Rune", cardCode: "OGN-089" }]
                }
              },
              board: { deck: 40, runeDeck: 12, hand: [] }
            },
            opponentPlayer: {
              id: "plr_opp",
              name: "Azir",
              deck: { sections: { mainDeck: [{ count: 40, name: "Defy", cardCode: "OGN-045" }] } },
              board: { deck: 40, runeDeck: 12, hand: [] }
            }
          }
        })
      ]
    });

    const lastFrame = model.frames.at(-1);
    expect(lastFrame?.label).toContain("Sideboarding");
    expect(lastFrame?.local.deckCount).toBe(36);
    expect(lastFrame?.opponent.deckCount).toBe(35);
    expect(lastFrame?.local.zones.base?.cards.map((card) => card.name)).toContain("Hidden Blade");
    expect(lastFrame?.local.selectedBattlefield?.name).toBe("Windswept Hillock");
    expect(lastFrame?.local.selectedBattlefield?.code).toBe("OGN-297");
    expect(lastFrame?.local.selectedBattlefield?.imageUrl).toContain("OGN-297");
    expect(lastFrame?.opponent.selectedBattlefield?.name).toBe("Hall of Legends");
    expect(lastFrame?.opponent.selectedBattlefield?.code).toBe("OGN-300");
    expect(model.frames.find((frame) => frame.stage === "battlefields")?.local.selectedBattlefield?.name).toBe("Windswept Hillock");
  });

  it("builds intro frames from early game state instead of final board state", () => {
    const model = buildRiftLiteReplayModel({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "capture-intro-reset",
        identity: { roomCode: "INTRO", firstSeenAt: 1781360000000, lastSeenAt: 1781360020000 },
        lifecycle: { lastPhase: "in_game", lastGameNumber: 1, boundaries: [] }
      },
      messages: [
        raw(0, { type: "search", decklist: "Legend:\n1 LeBlanc, Deceiver [UNL-199]" }),
        raw(1, {
          type: "room_shell_sync",
          sessionDoc: {
            roomCode: "INTRO",
            phase: "mulligan",
            matchFormat: "bo1",
            viewer: { role: "player", playerId: "plr_local" },
            selfPlayer: {
              id: "plr_local",
              name: "BMU",
              deck: { sections: { legend: [{ count: 1, name: "LeBlanc, Deceiver", cardCode: "UNL-199" }] } },
              board: { deck: 40, runeDeck: 12 }
            },
            opponentPlayer: {
              id: "plr_opp",
              name: "Azir",
              deck: { sections: { legend: [{ count: 1, name: "Azir, Emperor of the Sands", cardCode: "SFD-197" }] } },
              board: { deck: 40, runeDeck: 12 }
            }
          }
        }),
        raw(2, {
          type: "authoritative_patch_commit",
          patch: {
            operations: [
              { op: "zone_remove", playerId: "plr_local", zone: "deck", cardIds: ["d1", "d2", "d3", "d4"] },
              {
                op: "zone_insert",
                playerId: "plr_local",
                zone: "hand",
                cards: [{ id: "h1", name: "Hidden Blade", cardCode: "OGN-213", ownerPlayerId: "plr_local" }]
              }
            ]
          }
        }),
        raw(3, {
          type: "authoritative_patch_commit",
          patch: {
            operations: [
              { op: "zone_remove", playerId: "plr_local", zone: "deck", cardIds: Array.from({ length: 24 }, (_, index) => `late-${index}`) },
              { op: "set_board_fields", playerId: "plr_local", fields: { score: 8 } }
            ]
          }
        })
      ]
    });

    const openingIntro = model.frames.find((frame) => frame.stage === "openingHands");
    const firstBoard = model.frames.find((frame) => frame.stage === "board");
    expect(model.frames[0]?.ts).toBe(1781360002000);
    expect(openingIntro?.local.deckCount).toBe(36);
    expect(openingIntro?.local.score).toBe(0);
    expect(firstBoard?.ts).toBe(openingIntro?.ts);
    expect(firstBoard?.local.deckCount).toBe(36);
    expect(firstBoard?.local.score).toBe(0);
    expect(model.frames.at(-1)?.local.deckCount).toBe(12);
  });

  it("keeps original and final mulligan hands for the replay intro", () => {
    const model = buildRiftLiteReplayModel({
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
              name: "BMU",
              deck: { sections: { legend: [{ count: 1, name: "Vex, Gloomist", cardCode: "UNL-193" }] } },
              board: {
                deck: 36,
                hand: [
                  { id: "h1", name: "Ride the Wind", cardCode: "OGN-173" },
                  { id: "h2", name: "Flash", cardCode: "OGS-011" },
                  { id: "h3", name: "Stacked Deck", cardCode: "OGN-183" },
                  { id: "h4", name: "Tideturner", cardCode: "OGN-199" }
                ]
              }
            },
            opponentPlayer: {
              id: "plr_opp",
              name: "Opponent",
              board: { deck: 36, hand: [{ id: "o1" }, { id: "o2" }, { id: "o3" }, { id: "o4" }] }
            }
          }
        }),
        raw(1, {
          type: "authoritative_patch_commit",
          patch: {
            operations: [
              { op: "zone_remove", playerId: "plr_local", zone: "hand", cardIds: ["h3", "h4"] },
              {
                op: "zone_insert",
                playerId: "plr_local",
                zone: "hand",
                cards: [
                  { id: "h5", name: "Stupefy", cardCode: "OGN-095", ownerPlayerId: "plr_local" },
                  { id: "h6", name: "Defy", cardCode: "OGN-045", ownerPlayerId: "plr_local" }
                ]
              },
              { op: "log_insert", entries: [{ id: "log-1", text: "Mulligans Complete.", authorPlayerId: "plr_local" }] }
            ]
          }
        })
      ]
    });

    const mulliganIntro = model.frames.find((frame) => frame.stage === "mulligan");
    expect(mulliganIntro?.mulligan?.localOriginalHand?.map((card) => card.name)).toEqual([
      "Ride the Wind",
      "Flash",
      "Stacked Deck",
      "Tideturner"
    ]);
    expect(mulliganIntro?.mulligan?.localMulliganedCards?.map((card) => card.name)).toEqual(["Stacked Deck", "Tideturner"]);
    expect(mulliganIntro?.mulligan?.localAddedCards?.map((card) => card.name)).toEqual(["Stupefy", "Defy"]);
    expect(mulliganIntro?.mulligan?.opponentFinalHandCount).toBe(4);
  });

  it("extracts initiative rolls from chat-shaped replay events", () => {
    const model = buildRiftLiteReplayModel({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "capture-rolls",
        identity: { roomCode: "ROLLS", firstSeenAt: 1781360000000, lastSeenAt: 1781360004000 },
        lifecycle: { lastPhase: "in_game", lastGameNumber: 1, boundaries: [] }
      },
      messages: [
        raw(0, {
          type: "room_shell_sync",
          sessionDoc: {
            roomCode: "ROLLS",
            phase: "mulligan",
            viewer: { role: "player", playerId: "plr_local" },
            selfPlayer: { id: "plr_local", name: "BMU", board: { deck: 40 } },
            opponentPlayer: { id: "plr_opp", name: "mindows", board: { deck: 40 } }
          }
        }),
        raw(1, { type: "chat_append", entry: { message: "[00:06] mindows rolled a 7." } }),
        raw(2, { type: "chat_append", entry: { message: "[00:06] BMU rolled 18." } }),
        raw(3, { type: "chat_append", entry: { message: "[00:11] BMU chose to go first." } })
      ]
    });

    const initiativeIntro = model.frames.find((frame) => frame.stage === "initiative");
    expect(initiativeIntro?.initiative?.localRoll).toBe(18);
    expect(initiativeIntro?.initiative?.opponentRoll).toBe(7);
    expect(initiativeIntro?.initiative?.firstPlayerName).toBe("BMU");
  });

  it("extracts initiative rolls from Atlas room log phrasing with one unnamed roll", () => {
    const model = buildRiftLiteReplayModel({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "capture-atlas-rolls",
        identity: { roomCode: "ATROLL", firstSeenAt: 1781360000000, lastSeenAt: 1781360004000 },
        lifecycle: { lastPhase: "in_game", lastGameNumber: 1, boundaries: [] }
      },
      messages: [
        raw(0, {
          type: "room_shell_sync",
          sessionDoc: {
            roomCode: "ATROLL",
            phase: "mulligan",
            viewer: { role: "player", playerId: "plr_local" },
            selfPlayer: { id: "plr_local", name: "BMU", board: { deck: 40 } },
            opponentPlayer: { id: "plr_opp", name: "BadFrank", board: { deck: 40 } }
          }
        }),
        raw(1, { type: "chat_append", entry: { message: "Wins initiative (9 vs 5) and decides who plays first." } }),
        raw(2, { type: "chat_append", entry: { message: "Rolled 9. BadFrank rolled 5." } }),
        raw(3, { type: "chat_append", entry: { message: "Chose BMU to take the first turn. Both players now mulligan up to 2 cards." } })
      ]
    });

    const initiativeIntro = model.frames.find((frame) => frame.stage === "initiative");
    expect(initiativeIntro?.initiative?.localRoll).toBe(9);
    expect(initiativeIntro?.initiative?.opponentRoll).toBe(5);
    expect(initiativeIntro?.initiative?.firstPlayerName).toBe("BMU");
  });
});
