import { buildAtlasGameLog, type AtlasGameLog, type AtlasGameLogEntry } from "./atlasGameLog.js";
import type { MatchDraft, ReplayRecord } from "./types.js";

export interface AtlasGameLogSegment {
  matchId: string;
  replay: ReplayRecord;
}

export function canReadAtlasMatchGameLog(match: MatchDraft, segments: AtlasGameLogSegment[]): boolean {
  if (match.platform !== "atlas") return false;
  if (match.keepReplay !== false) return true;
  return Boolean(match.combinedFromMatchIds?.length && segments.some(({ matchId, replay }) =>
    match.combinedFromMatchIds!.includes(matchId) && replay.platform === "atlas" && !replay.deletedAt
      && replay.matchSnapshot?.keepReplay !== false
  ));
}

export async function loadAtlasMatchGameLog(
  match: MatchDraft,
  segments: AtlasGameLogSegment[],
  readPayload: (replayId: string) => Promise<unknown>
): Promise<AtlasGameLog> {
  if (!canReadAtlasMatchGameLog(match, segments)) {
    return { games: [], source: "none", partial: false };
  }
  const combinedIds = match.combinedFromMatchIds ?? [];
  const retained = segments.filter(({ matchId, replay }) => replay.platform === "atlas" && !replay.deletedAt
    && replay.matchSnapshot?.keepReplay !== false && (!combinedIds.length || combinedIds.includes(matchId)));
  if (!retained.length) return combinedIds.length ? { games: [], source: "none", partial: true } : buildAtlasGameLog({ match });
  const games: AtlasGameLog["games"] = [];
  let partial = false;
  let hasRaw = false;
  if (combinedIds.length && combinedIds.some((id) => !retained.some((segment) => segment.matchId === id))) partial = true;
  // Load one sidecar at a time; long matches can have large raw payloads.
  for (const segment of retained) {
    let payload: unknown;
    let readFailed = false;
    if (segment.replay.rawCapture) {
      try { payload = await readPayload(segment.replay.id); }
      catch { readFailed = true; }
    }
    const log = buildAtlasGameLog({
      payload,
      replay: segment.replay,
      match: segment.replay.matchSnapshot ?? (segment.matchId === match.id ? match : undefined)
    });
    const combinedIndex = combinedIds.indexOf(segment.matchId);
    // Match repair takes the first game of each selected original row.
    const selectedGames = combinedIndex >= 0 ? log.games.slice(0, 1) : log.games;
    games.push(...selectedGames.map((game) => ({
      ...game,
      id: `${segment.replay.id}:${game.id}`,
      gameNumber: combinedIndex >= 0 ? combinedIndex + 1 : game.gameNumber
    })));
    partial ||= log.partial || readFailed || !log.games.length;
    hasRaw ||= log.source === "raw";
  }
  return { games, source: games.length ? hasRaw ? "raw" : "captured" : "none", partial };
}

export function atlasGameLogText(log: AtlasGameLog, gameId = "", search = ""): string {
  const query = search.trim().toLocaleLowerCase();
  return log.games.filter((game) => !gameId || game.id === gameId).map((game) => {
    const entries = game.entries.filter((entry) => !query || `${entry.text} ${entry.actor ?? ""}`.toLocaleLowerCase().includes(query));
    return entries.length ? `Game ${game.gameNumber}\n${entries.map((entry) =>
      [entry.time, atlasGameLogActor(entry) ? `${entry.actor}:` : "", entry.text].filter(Boolean).join(" ")
    ).join("\n")}` : "";
  }).filter(Boolean).join("\n\n");
}

export function atlasGameLogActor(entry: AtlasGameLogEntry): string {
  const actor = entry.actor?.trim() ?? "";
  if (!actor) return "";
  const startsWithActor = entry.text.toLocaleLowerCase().startsWith(actor.toLocaleLowerCase());
  const boundary = entry.text.slice(actor.length, actor.length + 1);
  return startsWithActor && (!boundary || /[\s:,.!?—–'’]/.test(boundary)) ? "" : actor;
}
