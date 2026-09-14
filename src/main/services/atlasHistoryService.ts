import {
  atlasHistoryMarkersFromRaw,
  canImportAtlasHistory,
  atlasHistoryRowMatches,
  atlasRecord,
  historyDeckForPlayer,
  normalizeAtlasHistoryRows,
  normalizeAtlasHistoryMarkers,
  type AtlasHistoryGame,
  type AtlasHistoryMarker,
  type AtlasMatchHistory,
} from "../../shared/atlasHistory.js";
import type { MatchDraft } from "../../shared/types.js";
import { atlasHistoryQueryScript } from "./atlasHistoryQuery.js";

export interface AtlasHistoryDependencies {
  getMatch(id: string): Promise<MatchDraft | undefined>;
  readRawForMatch(id: string): Promise<unknown>;
  query(script: string): Promise<unknown>;
  save(id: string, history: AtlasMatchHistory, markers: AtlasHistoryMarker[]): Promise<MatchDraft>;
}
export class AtlasHistoryService {
  private pending = new Map<string, Promise<MatchDraft>>();
  constructor(private readonly deps: AtlasHistoryDependencies) {}
  refresh(matchId: string): Promise<MatchDraft> {
    const old = this.pending.get(matchId);
    if (old) return old;
    const task = this.refreshNow(matchId).finally(() => this.pending.delete(matchId));
    this.pending.set(matchId, task);
    return task;
  }
  private async refreshNow(matchId: string): Promise<MatchDraft> {
    const match = await this.deps.getMatch(matchId);
    if (
      !match ||
      !canImportAtlasHistory(match)
    )
      throw new Error("Save the original Atlas match before refreshing its decks.");
    const retained = normalizeAtlasHistoryMarkers(match.atlasHistoryMarkers);
    const markers = retained.length
      ? retained
      : atlasHistoryMarkersFromRaw(await this.deps.readRawForMatch(matchId));
    if (!markers.length)
      throw new Error(
        "This older match has no retained Atlas history identifiers. New captures retain them automatically.",
      );
    let sessionId = "";
    const query = async (path: "gameHistory:list" | "gameHistory:decks", args: Record<string, unknown>) => {
      const result = atlasRecord(await this.deps.query(atlasHistoryQueryScript(path, args)));
      if (
        !result ||
        typeof result.sessionId !== "string" ||
        !result.sessionId ||
        (sessionId && sessionId !== result.sessionId)
      )
        throw new Error("Atlas account changed during refresh. No decks were saved.");
      sessionId = result.sessionId;
      return result.value;
    };
    const matches: AtlasHistoryGame[] = [];
    let cursor: unknown = null;
    const seenIds = new Set<string>();
    for (let page = 0; page < 5; page++) {
      const response = atlasRecord(
        await query("gameHistory:list", { paginationOpts: { numItems: 20, cursor } }),
      );
      if (!response || !Array.isArray(response.page))
        throw new Error("Atlas history format changed. No decks were saved.");
      const rows = normalizeAtlasHistoryRows(response.page);
      for (const row of rows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        const candidates = markers.filter((marker) => atlasHistoryRowMatches(row, marker, match));
        if (candidates.length !== 1) continue;
        if (matches.some((g) => g.gameNumber === row.gameNumber))
          throw new Error("More than one Atlas history entry matched this game. No decks were saved.");
        const me = row.players.find((p) => p.isYou)!,
          opponent = row.players.find((p) => !p.isYou)!;
        const decks = await query("gameHistory:decks", { gameId: row.id });
        matches.push({
          ...candidates[0],
          historyId: row.id,
          myName: me.name,
          opponentName: opponent.name,
          myPoints: me.score,
          opponentPoints: opponent.score,
          me: historyDeckForPlayer(decks, me.playerId, false),
          opponent: historyDeckForPlayer(decks, opponent.playerId, opponent.deckPrivate),
        });
      }
      // Scan the complete bounded list to reject ambiguous duplicate history entries.
      if (
        response.isDone === true ||
        typeof response.continueCursor !== "string" ||
        !response.continueCursor ||
        response.continueCursor === cursor
      )
        break;
      cursor = response.continueCursor;
    }
    if (!matches.length)
      throw new Error(
        "No completed Atlas history entries matched this replay yet. Retry after Atlas finishes saving the game.",
      );
    const games = [
      ...(match.atlasHistory?.games || []).filter((g) => !matches.some((n) => n.gameNumber === g.gameNumber)),
      ...matches,
    ].sort((a, b) => a.gameNumber - b.gameNumber);
    return this.deps.save(match.id, { version: 1, updatedAt: new Date().toISOString(), games }, markers);
  }
}
