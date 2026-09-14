import { describe, expect, it } from "vitest";
import {
  atlasHistoryForMatch,
  atlasHistoryMarkersFromRaw,
  atlasHistoryRowMatches,
  atlasSideboardChanges,
  historyDeckForPlayer,
  normalizeAtlasHistoryRows,
  normalizeAtlasMatchHistory,
  parseAtlasHistoryDeck,
} from "../src/shared/atlasHistory";
import { deckText, history, historyRow, marker, savedMatch, startedAt } from "./fixtures/atlasHistory";
import {
  AtlasAuthoritativeMatchTracker,
  atlasAuthoritativeMatchSignalFromState,
} from "../src/shared/atlasAuthoritativeMatch";
import { MatchSessionTracker } from "../src/main/services/matchSessionTracker";
import { createDefaultSettings } from "../src/shared/settingsDefaults";

describe("post-game Atlas deck contract", () => {
  it("carries a history-only authoritative patch into the saved draft and clears it for a new room", () => {
    const authority = new AtlasAuthoritativeMatchTracker();
    const observe = (raw: unknown, roomCode = "ROOM1") =>
      authority.observeFrame({
        platform: "atlas",
        requestUrl: `wss://realtime.riftatlas-workers.com/parties/match/${roomCode}?playerId=me&roomCode=${roomCode}`,
        frame: { seq: 1, ts: startedAt, dir: "in", socketId: "ws", raw: JSON.stringify(raw) },
      });
    const shell = (roomCode: string) => ({
      type: "room_shell_sync",
      gameInstanceId: roomCode,
      sessionDoc: {
        roomCode,
        gameNumber: 1,
        matchFormat: "bo1",
        viewer: { role: "player", playerId: "me" },
        selfPlayer: { id: "me", name: "Local Player", seat: 0 },
        publicPlayers: [{ id: "opp", name: "Irelia Opponent", seat: 1 }],
      },
    });
    observe(shell("ROOM1"));
    const state = observe({
      type: "authoritative_patch_commit",
      gameInstanceId: "ROOM1",
      patch: {
        operations: [
          { op: "set_room_fields", fields: { gameHistoryStartedAt: startedAt, phase: "in_game" } },
        ],
      },
    })!;
    const signal = atlasAuthoritativeMatchSignalFromState(state);
    expect(signal.gameHistoryStartedAt).toBe(startedAt);
    const tracker = new MatchSessionTracker();
    const event = {
      id: "first",
      platform: "atlas" as const,
      kind: "match-start" as const,
      capturedAt: new Date(startedAt).toISOString(),
      url: "https://play.riftatlas.com",
      payload: {
        active: true,
        roomCode: signal.roomCode,
        myName: signal.myName,
        opponentName: signal.opponentName,
        atlasHistoryStartedAt: signal.gameHistoryStartedAt,
        atlasHistoryGameNumber: signal.gameNumber,
      },
    };
    tracker.ingest(event);
    expect(tracker.buildDraft("atlas", event, createDefaultSettings()).atlasHistoryMarkers).toEqual([marker]);
    expect(observe(shell("ROOM2"), "ROOM2")?.gameHistoryStartedAt).toBeUndefined();
  });
  it("reads all six deck sections and preserves Unicode names", () => {
    const cards = parseAtlasHistoryDeck(deckText + "\n\nSideboard:\n1 Kai’Sa, Daughter of the Void");
    expect(new Set(cards.map((c) => c.section)).size).toBe(6);
    expect(cards).toContainEqual({ section: "sideboard", quantity: 1, name: "Kai’Sa, Daughter of the Void" });
  });
  it("rejects malformed/duplicate/oversized lists instead of reporting them as complete", () => {
    for (const value of [
      deckText + "\n3",
      deckText + "\nRunes:\n6 Calm Rune",
      "2 Adaptatron",
      "x".repeat(32_001),
    ]) {
      expect(parseAtlasHistoryDeck(value)).toEqual([]);
    }
  });
  it("honours both Atlas privacy flags even if a payload also contains cards", () => {
    const payload = [{ playerId: "opp", private: false, decklist: deckText }];
    expect(historyDeckForPlayer(payload, "opp", true)).toEqual({ availability: "private", cards: [] });
    expect(historyDeckForPlayer([{ ...payload[0], private: true }], "opp", false)).toEqual({
      availability: "private",
      cards: [],
    });
    expect(historyDeckForPlayer([...payload, ...payload], "opp", false).availability).toBe("unavailable");
    const value = history();
    value.games[0].opponent.availability = "private";
    expect(normalizeAtlasMatchHistory(value)?.games[0].opponent.cards).toEqual([]);
  });
  it("requires ended games, an exact timestamp, the same players, game and scores", () => {
    expect(
      normalizeAtlasHistoryRows([historyRow({ status: "in_progress" }), historyRow({ endedAt: undefined })]),
    ).toEqual([]);
    expect(
      normalizeAtlasHistoryRows([
        historyRow({ startedAt: "2026-09-11T12:00:00Z", endedAt: "2026-09-11T11:00:00Z" }),
      ]),
    ).toEqual([]);
    const row = historyRow();
    expect(atlasHistoryRowMatches(row, marker, savedMatch())).toBe(true);
    for (const other of [
      { ...row, startedAt: startedAt + 1 },
      { ...row, gameNumber: 2 },
      { ...row, players: row.players.map((p) => (p.isYou ? p : { ...p, name: "Different opponent" })) },
      { ...row, players: row.players.map((p) => (p.isYou ? p : { ...p, score: 5 })) },
    ])
      expect(atlasHistoryRowMatches(other, marker, savedMatch())).toBe(false);
  });
  it("extracts/deduplicates BO3 markers without retaining other raw fields", () => {
    const messages = [1, 2, 3].flatMap((gameNumber) => [
      {
        raw: JSON.stringify({
          type: "room_shell_sync",
          gameInstanceId: "R" + gameNumber,
          sessionDoc: { gameNumber },
        }),
      },
      {
        raw: JSON.stringify({
          type: "authoritative_patch_commit",
          gameInstanceId: "R" + gameNumber,
          patch: {
            operations: [
              {
                op: "set_room_fields",
                fields: { gameHistoryStartedAt: startedAt + gameNumber, phase: "in_game" },
              },
            ],
          },
        }),
      },
      {
        raw: JSON.stringify({
          type: "authoritative_snapshot",
          gameInstanceId: "R" + gameNumber,
          snapshot: { gameNumber, gameHistoryStartedAt: startedAt + gameNumber, privateField: "do not copy" },
        }),
      },
    ]);
    expect(atlasHistoryMarkersFromRaw({ messages })).toEqual(
      [1, 2, 3].map((gameNumber) => ({
        gameNumber,
        startedAt: startedAt + gameNumber,
        roomCode: "R" + gameNumber,
      })),
    );
  });
  it("compares main-deck quantities and refuses to infer private or missing games", () => {
    const before = history().games[0].opponent;
    const after = {
      ...before,
      cards: parseAtlasHistoryDeck(
        deckText
          .replace("1 Pyke, Returned\n1 Vex, Apathetic", "2 Adaptatron")
          .replace("Sideboard:\n2 Adaptatron", "Sideboard:\n1 Pyke, Returned\n1 Vex, Apathetic"),
      ),
    };
    expect(atlasSideboardChanges(before, after)).toEqual([
      { name: "Adaptatron", delta: 2 },
      { name: "Pyke, Returned", delta: -1 },
      { name: "Vex, Apathetic", delta: -1 },
    ]);
    expect(atlasSideboardChanges(undefined, after)).toBeNull();
    expect(atlasSideboardChanges({ ...before, availability: "private" }, after)).toBeNull();
    expect(atlasSideboardChanges(before, before)).toEqual([]);
  });
  it("drops attachments invalidated by a later match correction, but keeps ordinary notes edits", () => {
    expect(atlasHistoryForMatch(history(), { ...savedMatch(), notes: "New note" })).toBeDefined();
    expect(
      atlasHistoryForMatch(history(), { ...savedMatch(), opponentName: "Someone else" }),
    ).toBeUndefined();
  });
});
