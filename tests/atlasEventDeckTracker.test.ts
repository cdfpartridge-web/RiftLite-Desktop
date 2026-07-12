import { describe, expect, it } from "vitest";
import { parseAtlasDeckTrackerFrame } from "../src/shared/atlasEventDeckTracker";
import type { RawCaptureAppendFramePayload } from "../src/shared/types";

function frame(raw: unknown, dir: "in" | "out" = "in", requestUrl = "wss://realtime.riftatlas-workers.com/room"): RawCaptureAppendFramePayload {
  return {
    platform: "atlas",
    requestUrl,
    frame: {
      seq: 1,
      ts: 1781360000000,
      dir,
      socketId: "ws-1",
      raw: JSON.stringify(raw)
    }
  };
}

describe("Atlas event deck tracker parser", () => {
  it("learns the local player id from outgoing Atlas actions", () => {
    const result = parseAtlasDeckTrackerFrame(frame({
      type: "authoritative_patch_commit",
      actorPlayerId: "player-a",
      patch: { operations: [] }
    }, "out"));

    expect(result.localPlayerIdHint).toBe("player-a");
  });

  it("learns the local player id and room from the Atlas websocket URL", () => {
    const result = parseAtlasDeckTrackerFrame(frame({
      type: "authoritative_patch_commit",
      gameInstanceId: "ROOM1",
      patch: {
        operations: [
          {
            op: "zone_insert",
            playerId: "plr-local",
            zone: "hand",
            cards: [{ id: "c1", cardCode: "OGN-199", name: "Tideturner" }]
          }
        ]
      }
    }, "in", "wss://realtime.riftatlas-workers.com/parties/match/ROOM1?_pk=abc&playerId=plr-local&roomCode=ROOM1"));

    expect(result.localPlayerIdHint).toBe("plr-local");
    expect(result.roomCode).toBe("ROOM1");
    expect(result.observations.map((item) => `${item.name}:${item.zone}`)).toEqual(["Tideturner:hand"]);
  });

  it("learns the local player id from an incoming room shell viewer", () => {
    const result = parseAtlasDeckTrackerFrame(frame({
      type: "room_shell_sync",
      sessionDoc: {
        roomCode: "ROOM2",
        phase: "sideboarding",
        viewer: { role: "player", playerId: "plr-viewer" },
        selfPlayer: { id: "plr-viewer", name: "BMU" }
      }
    }));

    expect(result.localPlayerIdHint).toBe("plr-viewer");
    expect(result.roomCode).toBe("ROOM2");
  });

  it("reads the opponent legend from Atlas room player records", () => {
    const result = parseAtlasDeckTrackerFrame(frame({
      type: "room_shell_sync",
      sessionDoc: {
        roomCode: "ROOM3",
        phase: "in_game",
        viewer: { role: "player", playerId: "plr-local" },
        selfPlayer: { id: "plr-local", name: "BMU" },
        players: [
          { id: "plr-local", champion: { name: "Diana, Lunari" } },
          { id: "plr-opponent", champion: { name: "Blade Dancer" } }
        ]
      }
    }));

    expect(result.opponentLegend).toBe("Irelia");
  });

  it("counts visible local snapshot cards and ignores opponent cards", () => {
    const result = parseAtlasDeckTrackerFrame(frame({
      type: "authoritative_snapshot",
      gameInstanceId: "ROOM1",
      snapshot: {
        phase: "in_game",
        players: [
          {
            id: "player-a",
            board: {
              hand: [
                { id: "c1", cardCode: "OGN-199", name: "Tideturner", imageUrl: "https://cards.test/OGN-199.webp" }
              ],
              battlefield: [
                { id: "c2", cardCode: "SFD-128", name: "Overzealous Fan", imageUrl: "https://cards.test/SFD-128.webp" }
              ],
              deck: [{ isPlaceholder: true }]
            }
          },
          {
            id: "player-b",
            board: {
              hand: [
                { id: "c3", cardCode: "OGN-199", name: "Tideturner", imageUrl: "https://cards.test/OGN-199.webp" }
              ]
            }
          }
        ]
      }
    }), { localPlayerId: "player-a" });

    expect(result.roomCode).toBe("ROOM1");
    expect(result.observations.map((item) => `${item.name}:${item.zone}`)).toEqual([
      "Tideturner:hand",
      "Overzealous Fan:board"
    ]);
    expect(result.debugEvents.some((item) => item.ignoredReason === "opponent-hidden-zone")).toBe(true);
  });

  it("ignores starting legend and champion setup zones but keeps played champions", () => {
    const setupResult = parseAtlasDeckTrackerFrame(frame({
      type: "authoritative_snapshot",
      gameInstanceId: "ROOM1",
      snapshot: {
        phase: "in_game",
        players: [
          {
            id: "player-a",
            board: {
              battlefield: [
                { id: "my-unit-1", cardCode: "SFD-128", name: "Overzealous Fan" }
              ]
            }
          },
          {
            id: "player-b",
            board: {
              legend: [
                { id: "opp-legend", cardCode: "DIA-001", name: "Diana, Scorn of the Moon" }
              ],
              champion: [
                { id: "opp-champ", cardCode: "UNL-149", name: "Diana, Lunari" }
              ],
              battlefield: [
                { id: "opp-unit-1", cardCode: "SFD-128", name: "Overzealous Fan" }
              ]
            }
          }
        ]
      }
    }), { localPlayerId: "player-a" });

    expect(setupResult.opponentObservations.map((item) => `${item.name}:${item.zone}`)).toEqual([
      "Overzealous Fan:board"
    ]);
    expect(setupResult.debugEvents.some((item) => item.ignoredReason === "setup-zone")).toBe(true);

    const playedChampionResult = parseAtlasDeckTrackerFrame(frame({
      type: "authoritative_patch_commit",
      patch: {
        operations: [
          {
            op: "zone_move",
            from: { playerId: "player-b", zone: "hand" },
            to: { playerId: "player-b", zone: "battlefield" },
            card: { id: "played-champ-1", cardCode: "UNL-150", name: "Vex, Apathetic" }
          }
        ]
      }
    }), { localPlayerId: "player-a" });

    expect(playedChampionResult.opponentObservations.map((item) => `${item.name}:${item.zone}`)).toEqual([
      "Vex, Apathetic:board"
    ]);
  });

  it("counts local zone moves and chain cards", () => {
    const result = parseAtlasDeckTrackerFrame(frame({
      type: "authoritative_patch_commit",
      patch: {
        operations: [
          {
            op: "zone_move",
            from: { playerId: "player-a", zone: "hand" },
            to: { playerId: "player-a", zone: "battlefield" },
            card: { id: "c1", cardCode: "UNL-150", name: "Vex, Apathetic", imageUrl: "https://cards.test/UNL-150.webp" }
          },
          {
            op: "chain_insert",
            entries: [
              { byPlayerId: "player-a", card: { id: "c2", cardCode: "OGS-011", name: "Flash", imageUrl: "https://cards.test/OGS-011.webp" } }
            ]
          },
          {
            op: "zone_move",
            from: { playerId: "player-b", zone: "hand" },
            to: { playerId: "player-b", zone: "battlefield" },
            card: { id: "c3", cardCode: "SFD-128", name: "Overzealous Fan" }
          }
        ]
      }
    }), { localPlayerId: "player-a" });

    expect(result.observations.map((item) => `${item.name}:${item.zone}`)).toEqual([
      "Vex, Apathetic:board",
      "Flash:stack"
    ]);
    expect(result.opponentObservations.map((item) => `${item.name}:${item.zone}`)).toEqual([
      "Overzealous Fan:board"
    ]);
  });

  it("tracks opponent public played cards without reading opponent hand", () => {
    const result = parseAtlasDeckTrackerFrame(frame({
      type: "authoritative_patch_commit",
      patch: {
        operations: [
          {
            op: "zone_move",
            from: { playerId: "player-b", zone: "hand" },
            to: { playerId: "player-b", zone: "battlefield" },
            card: { id: "opp-unit-1", cardCode: "SFD-128", name: "Overzealous Fan", imageUrl: "https://cards.test/SFD-128.webp" }
          },
          {
            op: "chain_insert",
            entries: [
              { byPlayerId: "player-b", card: { id: "opp-spell-1", cardCode: "OGS-011", name: "Flash", imageUrl: "https://cards.test/OGS-011.webp" } }
            ]
          },
          {
            op: "zone_insert",
            playerId: "player-b",
            zone: "hand",
            cards: [{ id: "hidden-hand-1", cardCode: "OGN-199", name: "Tideturner" }]
          }
        ]
      }
    }), { localPlayerId: "player-a" });

    expect(result.observations).toEqual([]);
    expect(result.opponentObservations.map((item) => `${item.name}:${item.zone}:${item.instanceId}`)).toEqual([
      "Overzealous Fan:board:oppunit1",
      "Flash:stack:oppspell1"
    ]);
    expect(result.debugEvents.some((item) => item.ignoredReason === "opponent-hidden-zone")).toBe(true);
  });

  it("detects local sideboard moves without counting them as played cards", () => {
    const result = parseAtlasDeckTrackerFrame(frame({
      type: "authoritative_patch_commit",
      patch: {
        operations: [
          {
            op: "zone_move",
            from: { playerId: "player-a", zone: "sideboard" },
            to: { playerId: "player-a", zone: "mainDeck" },
            card: { id: "c-side-1", cardCode: "OGN-172", name: "Rebuke", imageUrl: "https://cards.test/OGN-172.webp" }
          },
          {
            op: "zone_move",
            from: { playerId: "player-a", zone: "mainDeck" },
            to: { playerId: "player-a", zone: "sideboard" },
            card: { id: "c-main-1", cardCode: "SFD-128", name: "Overzealous Fan", imageUrl: "https://cards.test/SFD-128.webp" }
          }
        ]
      }
    }), { localPlayerId: "player-a" });

    expect(result.observations).toEqual([]);
    expect(result.sideboardChanges.map((item) => `${item.direction}:${item.name}:${item.source}`)).toEqual([
      "in:Rebuke:atlas",
      "out:Overzealous Fan:atlas"
    ]);
  });

  it("treats Atlas battlefield lanes as board zones", () => {
    const result = parseAtlasDeckTrackerFrame(frame({
      type: "authoritative_patch_commit",
      patch: {
        operations: [
          {
            op: "zone_insert",
            playerId: "plr-local",
            zone: "battlefieldA",
            cards: [{ id: "c1", cardCode: "SFD-128", name: "Overzealous Fan" }]
          },
          {
            op: "zone_insert",
            playerId: "plr-local",
            zone: "battlefieldB",
            cards: [{ id: "c2", cardCode: "UNL-150", name: "Vex, Apathetic" }]
          }
        ]
      }
    }), { localPlayerId: "plr-local" });

    expect(result.observations.map((item) => `${item.name}:${item.zone}`)).toEqual([
      "Overzealous Fan:board",
      "Vex, Apathetic:board"
    ]);
  });

  it("does not count cards before the local player is known", () => {
    const result = parseAtlasDeckTrackerFrame(frame({
      type: "authoritative_patch_commit",
      patch: {
        operations: [
          {
            op: "zone_insert",
            playerId: "player-a",
            zone: "hand",
            cards: [{ id: "c1", cardCode: "OGN-199", name: "Tideturner" }]
          }
        ]
      }
    }));

    expect(result.observations).toEqual([]);
    expect(result.debugEvents[0]?.ignoredReason).toBe("waiting-for-local-player-id");
  });
});
