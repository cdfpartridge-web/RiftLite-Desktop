import {
  atlasHistoryMarkersFromRaw,
  canImportAtlasHistory,
  atlasHistoryRowMatches,
  atlasHistoryTimestamp,
  atlasRecord,
  historyDeckForPlayer,
  normalizeAtlasHistoryRows,
  normalizeAtlasHistoryMarkers,
  type AtlasHistoryGame,
  type AtlasHistoryMarker,
  type AtlasHistoryRow,
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
interface HistoryTarget {
  match: MatchDraft;
  markers: AtlasHistoryMarker[];
  missing: AtlasHistoryMarker[];
}
type HistoryQuery = (path: "gameHistory:list" | "gameHistory:decks", args: Record<string, unknown>) => Promise<unknown>;

export class AtlasHistoryService {
  private pending = new Map<string, Promise<MatchDraft>>();
  constructor(private readonly deps: AtlasHistoryDependencies) {}
  refresh(matchId: string): Promise<MatchDraft> {
    // Explicit refresh can recheck privacy/decks, even after automatic retries have stopped.
    return this.schedule([matchId], false)[0];
  }
  refreshMany(matchIds: string[]): Promise<PromiseSettledResult<MatchDraft>[]> {
    return Promise.allSettled(this.schedule(matchIds, true));
  }
  private schedule(matchIds: string[], onlyMissing: boolean): Promise<MatchDraft>[] {
    const fresh = [...new Set(matchIds)].filter((id) => !this.pending.has(id));
    if (fresh.length) {
      const batch = this.refreshBatch(fresh, onlyMissing);
      fresh.forEach((id, index) => {
        const task = batch.then((results) => {
          const result = results[index];
          if (result.status === "rejected") throw result.reason;
          return result.value;
        }).finally(() => {
          if (this.pending.get(id) === task) this.pending.delete(id);
        });
        this.pending.set(id, task);
      });
    }
    return matchIds.map((id) => this.pending.get(id)!);
  }
  private async prepare(matchId: string, onlyMissing: boolean): Promise<HistoryTarget> {
    const match = await this.deps.getMatch(matchId);
    if (!match || !canImportAtlasHistory(match))
      throw new Error("Save the original Atlas match before refreshing its decks.");
    const retained = normalizeAtlasHistoryMarkers(match.atlasHistoryMarkers);
    const markers = retained.length
      ? retained
      : atlasHistoryMarkersFromRaw(await this.deps.readRawForMatch(matchId));
    if (!markers.length)
      throw new Error(
        "This older match has no retained Atlas history identifiers. New captures retain them automatically.",
      );
    const missing = onlyMissing ? markers.filter((marker) => {
      const game = match.atlasHistory?.games.find((g) =>
        g.gameNumber === marker.gameNumber && g.startedAt === marker.startedAt);
      return !game || game.me.availability === "unavailable" || game.opponent.availability === "unavailable";
    }) : markers;
    return { match, markers, missing };
  }
  private async refreshBatch(matchIds: string[], onlyMissing: boolean): Promise<PromiseSettledResult<MatchDraft>[]> {
    const prepared = await Promise.allSettled(matchIds.map((id) => this.prepare(id, onlyMissing)));
    const targets = prepared.flatMap((result) => result.status === "fulfilled" ? result.value.missing : []);
    let sessionId = "";
    const query: HistoryQuery = async (path, args) => {
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
    const rows = targets.length
      ? await this.listHistory(Math.min(...targets.map((marker) => marker.startedAt)), query)
      : [];
    // Validate every match before reading any decks. A missing/ambiguous match does
    // not block other matches, but an account switch aborts the whole unsaved batch.
    const plans = await Promise.allSettled(prepared.map(async (result) => {
      if (result.status === "rejected") throw result.reason;
      const target = result.value;
      const matched: Array<{ row: AtlasHistoryRow; marker: AtlasHistoryMarker }> = [];
      for (const row of rows) {
        const candidates = target.missing.filter((marker) => atlasHistoryRowMatches(row, marker, target.match));
        if (candidates.length !== 1) continue;
        if (matched.some((entry) => entry.row.gameNumber === row.gameNumber))
          throw new Error("More than one Atlas history entry matched this game. No decks were saved.");
        matched.push({ row, marker: candidates[0] });
      }
      if (target.missing.length && !matched.length)
        throw new Error("No completed Atlas history entries matched this replay yet. Retry after Atlas finishes saving the game.");
      return { target, matched };
    }));
    const decksById = new Map<string, unknown>();
    for (const plan of plans) {
      if (plan.status === "rejected") continue;
      for (const { row } of plan.value.matched) {
        if (decksById.has(row.id)) continue;
        // The privacy flag hides a deck from opponents, not its owner. Even if
        // both players enabled it, the signed-in player's list is still readable.
        const decks = await query("gameHistory:decks", { gameId: row.id });
        decksById.set(row.id, decks);
      }
    }
    return Promise.allSettled(plans.map(async (plan) => {
      if (plan.status === "rejected") throw plan.reason;
      const { target: { match, markers }, matched } = plan.value;
      if (!matched.length) return match;
      const matches: AtlasHistoryGame[] = matched.map(({ row, marker }) => {
        const me = row.players.find((p) => p.isYou)!;
        const opponent = row.players.find((p) => !p.isYou)!;
        const decks = decksById.get(row.id);
        return {
          ...marker,
          historyId: row.id,
          myName: me.name,
          opponentName: opponent.name,
          myPoints: me.score,
          opponentPoints: opponent.score,
          me: historyDeckForPlayer(decks, me.playerId, false),
          opponent: historyDeckForPlayer(decks, opponent.playerId, opponent.deckPrivate),
        };
      });
      const games = [
        ...(match.atlasHistory?.games || []).filter((g) => !matches.some((n) => n.gameNumber === g.gameNumber)),
        ...matches,
      ].sort((a, b) => a.gameNumber - b.gameNumber);
      return this.deps.save(match.id, { version: 1, updatedAt: new Date().toISOString(), games }, markers);
    }));
  }
  private async listHistory(oldestTarget: number, query: HistoryQuery): Promise<AtlasHistoryRow[]> {
    const matches: AtlasHistoryRow[] = [];
    let cursor: unknown = null;
    const seenIds = new Set<string>();
    const seenCursors = new Set<string>();
    let descending = true;
    let previousTimestamp = Infinity;
    for (let page = 0; page < 5; page++) {
      const response = atlasRecord(
        await query("gameHistory:list", { paginationOpts: { numItems: 20, cursor } }),
      );
      if (!response || !Array.isArray(response.page))
        throw new Error("Atlas history format changed. No decks were saved.");
      // Atlas lists newest first. Only use the date boundary if all raw timestamps
      // have supported that order, including solo/in-progress rows we cannot import.
      for (const raw of response.page) {
        const timestamp = atlasHistoryTimestamp(atlasRecord(raw)?.startedAt);
        if (!timestamp || timestamp > previousTimestamp) descending = false;
        if (timestamp) previousTimestamp = timestamp;
      }
      for (const row of normalizeAtlasHistoryRows(response.page)) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        matches.push(row);
      }
      // Scan the entire boundary page (not just the first match) to catch duplicates.
      if (
        (descending && response.page.length > 0 && previousTimestamp < oldestTarget) ||
        response.isDone === true ||
        typeof response.continueCursor !== "string" ||
        !response.continueCursor ||
        seenCursors.has(response.continueCursor)
      )
        break;
      seenCursors.add(response.continueCursor);
      cursor = response.continueCursor;
    }
    return matches;
  }
}
