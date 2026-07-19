import { describe, expect, it } from "vitest";
import { DeckTrackerService } from "../src/main/services/deckTrackerService";
import type { RawCaptureAppendFramePayload, SavedDeck, UserSettings } from "../src/shared/types";

const deck: SavedDeck = {
  id: "deck-1",
  sourceUrl: "local:text",
  sourceKey: "deck:annie",
  title: "Annie test",
  legend: "Annie",
  snapshotJson: JSON.stringify({
    mainDeck: [
      { qty: 3, name: "Watchful Sentry", cardId: "OGN-028", imageUrl: "https://cards.test/OGN-028.webp" },
      { qty: 3, name: "Flash", cardId: "OGS-011", imageUrl: "https://cards.test/OGS-011.webp" }
    ]
  }),
  lastImportedAt: "2026-05-08T10:00:00.000Z",
  lastRefreshStatus: "ok",
  lastRefreshError: ""
};

const settings = {
  activeDeckId: deck.id,
  deckTrackerEnabled: true,
  deckTrackerAutoStart: true,
  deckTrackerPinnedCards: {}
} as UserSettings;

function store() {
  return {
    getSettings: async () => settings,
    getSavedDeck: async (id: string) => id === deck.id ? deck : null,
    saveSettings: async (patch: Partial<UserSettings>) => ({ ...settings, ...patch })
  };
}

function atlasFrame(raw: unknown, seq: number): RawCaptureAppendFramePayload {
  return {
    platform: "atlas",
    requestUrl: "wss://realtime.riftatlas-workers.com/parties/match/ROOM1?playerId=player-a&roomCode=ROOM1",
    frame: {
      seq,
      ts: 1781360000000 + seq,
      dir: "in",
      socketId: "ws-1",
      raw: JSON.stringify(raw)
    }
  };
}

function snapshot(gameNumber: number, opponentCards: Array<{ id: string; cardCode: string; name: string }>) {
  return {
    type: "authoritative_snapshot",
    gameInstanceId: "ROOM1",
    snapshot: {
      phase: "in_game",
      gameNumber,
      players: [
        {
          id: "player-a",
          champion: { name: "Annie, The Dark Child" },
          board: { battlefield: [] }
        },
        {
          id: "player-b",
          champion: { name: "Irelia, Blade Dancer" },
          board: {
            battlefield: opponentCards.map((card) => ({
              ...card,
              imageUrl: `https://cards.test/${card.cardCode}.webp`
            }))
          }
        }
      ]
    }
  };
}

describe("DeckTrackerService opponent tracker", () => {
  it("reloads a restored deck with the same id and clears match observations", async () => {
    let currentDeck = deck;
    const mutableStore = {
      getSettings: async () => settings,
      getSavedDeck: async (id: string) => id === currentDeck.id ? currentDeck : null,
      saveSettings: async (patch: Partial<UserSettings>) => ({ ...settings, ...patch })
    };
    const service = new DeckTrackerService(mutableStore as never);

    await service.ingestAtlasRawFrame(atlasFrame(snapshot(1, [
      { id: "opp-flash-1", cardCode: "OGS-011", name: "Flash" }
    ]), 1));
    expect((await service.getState("atlas")).opponent.totalKnown).toBe(1);

    currentDeck = {
      ...deck,
      title: "Restored Annie deck",
      snapshotJson: JSON.stringify({
        mainDeck: [{ qty: 2, name: "Mystic Shot", cardId: "OGN-175" }]
      })
    };
    service.invalidateDeckLibrary();

    const restoredState = await service.getState("atlas");
    expect(restoredState.cards.map((card) => card.name)).toEqual(["Mystic Shot"]);
    expect(restoredState.opponent.totalKnown).toBe(0);
    expect(service.replaySnapshots("atlas")).toEqual([]);
  });

  it("keeps this-game opponent cards separate from capped BO3 deck memory", async () => {
    const service = new DeckTrackerService(store() as never);

    await service.ingestAtlasRawFrame(atlasFrame(snapshot(1, [
      { id: "opp-flash-1", cardCode: "OGS-011", name: "Flash" },
      { id: "opp-flash-2", cardCode: "OGS-011", name: "Flash" }
    ]), 1));

    let state = await service.getState("atlas");
    expect(state.opponent.cards.find((card) => card.name === "Flash")?.count).toBe(2);
    expect(state.opponent.knownCards.find((card) => card.name === "Flash")?.count).toBe(2);

    await service.ingestAtlasRawFrame(atlasFrame(snapshot(2, [
      { id: "opp-flash-3", cardCode: "OGS-011", name: "Flash" },
      { id: "opp-flash-4", cardCode: "OGS-011", name: "Flash" }
    ]), 2));

    state = await service.getState("atlas");
    expect(state.opponent.cards.find((card) => card.name === "Flash")?.count).toBe(2);
    expect(state.opponent.knownCards.find((card) => card.name === "Flash")?.count).toBe(3);
    expect(state.opponent.totalSeen).toBe(2);
    expect(state.opponent.totalKnown).toBe(3);
  });
});
