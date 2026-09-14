import {
  parseAtlasHistoryDeck,
  type AtlasHistoryRow,
  type AtlasMatchHistory,
} from "../../src/shared/atlasHistory";
import type { MatchDraft } from "../../src/shared/types";

// Synthetic identities and dates; no account or room identifiers from the recorded example.
export const startedAt = Date.parse("2026-01-10T12:00:00.000Z");
export const deckText =
  "Legend:\n1 Irelia, Blade Dancer\n\nChampion:\n1 Irelia, Fervent\n\nMainDeck:\n3 Defy\n1 Pyke, Returned\n1 Vex, Apathetic\n\nSideboard:\n2 Adaptatron\n\nBattlefields:\n1 Targon's Peak\n\nRunes:\n6 Calm Rune\n6 Chaos Rune";
export const marker = { gameNumber: 1, startedAt, roomCode: "ROOM1" };
export function historyRow(overrides: Record<string, unknown> = {}): AtlasHistoryRow & { status: string } {
  return {
    id: "history-1",
    startedAt,
    endedAt: startedAt + 504_000,
    gameNumber: 1,
    status: "completed",
    players: [
      { playerId: "me", name: "Local Player", isYou: true, score: 7, deckPrivate: false },
      { playerId: "opp", name: "Irelia Opponent", isYou: false, score: 4, deckPrivate: false },
    ],
    ...overrides,
  };
}
export function history(): AtlasMatchHistory {
  const deck = { availability: "available" as const, cards: parseAtlasHistoryDeck(deckText) };
  return {
    version: 1,
    updatedAt: "2026-01-10T13:00:00.000Z",
    games: [
      {
        ...marker,
        historyId: "history-1",
        myName: "Local Player",
        opponentName: "Irelia Opponent",
        myPoints: 7,
        opponentPoints: 4,
        me: structuredClone(deck),
        opponent: structuredClone(deck),
      },
    ],
  };
}
export function savedMatch(): MatchDraft {
  return {
    id: "irelia-match",
    platform: "atlas",
    status: "saved",
    source: "auto",
    capturedAt: "2026-01-10T11:59:30.000Z",
    updatedAt: "2026-01-10T12:09:00.000Z",
    myName: "Local Player",
    opponentName: "Irelia Opponent",
    myChampion: "LeBlanc",
    opponentChampion: "Irelia",
    myBattlefield: "Star Spring",
    opponentBattlefield: "Abandoned Hall",
    format: "Bo1",
    result: "Win",
    score: "1-0",
    games: [{ gameNumber: 1, result: "Win", myPoints: 7, oppPoints: 4, wentFirst: "1st" }],
    deckName: "",
    deckSourceId: "",
    notes: "Keep this reviewed note",
    flags: "",
    rawEvidence: [],
    sync: { community: "synced", hubs: { privateHub: "synced" }, teams: {} },
    atlasHistoryMarkers: [marker],
  };
}
