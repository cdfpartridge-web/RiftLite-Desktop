import { mergeAccountReplayLibrary, type AccountReplayLibraryItem, type AccountReplayLibraryResult } from "./accountReplayLibrary.js";
import type { MatchDraft, ReplayRecord } from "./types.js";

export type GameDetailsTab = "summary" | "media" | "decks" | "notes";
export type GameDetailsTarget = {
  kind: "match" | "replay" | "cloud";
  id: string;
  /** Required for cloud selections, so a later account change cannot reuse them. */
  accountUid?: string;
  tab?: GameDetailsTab;
  timeMs?: number;
  evidenceId?: string;
};

export interface ResolvedGameDetails {
  match?: MatchDraft;
  replays: ReplayRecord[];
  cloudReplays: AccountReplayLibraryItem[];
  title: string;
  unavailableReason?: string;
}

/** Resolve only persisted identities. A familiar opponent or timestamp is not an identity. */
export function resolveGameDetails(
  target: GameDetailsTarget,
  matches: readonly MatchDraft[],
  replays: readonly ReplayRecord[],
  accountUid: string,
  ownerLibrary?: AccountReplayLibraryResult | null
): ResolvedGameDetails {
  const localMatches = matches.filter((match) => !match.deletedAt);
  const localReplays = replays.filter((replay) => !replay.deletedAt);
  const cloudItems = accountUid && ownerLibrary?.available && ownerLibrary.accountUid === accountUid ? ownerLibrary.items : [];
  const rows = mergeAccountReplayLibrary(localReplays, localMatches, cloudItems);
  const unavailable = (reason: string): ResolvedGameDetails => ({ title: "Game details", replays: [], cloudReplays: [], unavailableReason: reason });
  let match: MatchDraft | undefined;
  let selectedReplays: ReplayRecord[] = [];
  let selectedCloud: AccountReplayLibraryItem[] = [];

  if (target.kind === "cloud") {
    if (!accountUid || target.accountUid !== accountUid) return unavailable("Connect the account that owns this online replay to view its details.");
    const row = rows.find((entry) => entry.cloudReplay?.replayId === target.id);
    if (!row?.cloudReplay) return unavailable(ownerLibrary?.error || "This online replay is not available in your current account's library.");
    match = row.match;
    selectedReplays = row.replay ? [row.replay] : [];
    selectedCloud = [row.cloudReplay];
  } else if (target.kind === "replay") {
    const replay = localReplays.find((item) => item.id === target.id);
    if (!replay) return unavailable("This replay is no longer saved on this computer.");
    match = localMatches.find((item) => item.id === replay.matchId);
    selectedReplays = [replay];
    selectedCloud = rows.filter((entry) => entry.replay?.id === replay.id && entry.cloudReplay).map((entry) => entry.cloudReplay!);
  } else {
    match = localMatches.find((item) => item.id === target.id);
    if (!match) return unavailable("This match is no longer saved on this computer.");
    const matchIds = new Set([match.id, ...(match.combinedFromMatchIds ?? [])]);
    const segmentOrder = match.combinedFromMatchIds ?? [match.id];
    selectedReplays = localReplays.filter((replay) => matchIds.has(replay.matchId))
      .sort((a, b) => segmentOrder.indexOf(a.matchId) - segmentOrder.indexOf(b.matchId));
    const replayIds = new Set(selectedReplays.map((replay) => replay.id));
    selectedCloud = rows.filter((entry) => entry.cloudReplay && (entry.replay ? replayIds.has(entry.replay.id) : entry.match?.id === match!.id)).map((entry) => entry.cloudReplay!);
  }
  const title = match ? `${match.myChampion || "Player"} vs ${match.opponentChampion || "Opponent"}` : selectedReplays[0]?.title || selectedCloud[0]?.title || "Game details";
  return { match, replays: selectedReplays, cloudReplays: selectedCloud, title };
}

/** A replay snapshot is display-only, and must belong to that exact local match ID. */
export function gameDetailsDisplayMatch(details: ResolvedGameDetails): MatchDraft | undefined {
  if (details.match) return details.match;
  const replay = details.replays[0];
  return replay?.matchSnapshot?.id === replay?.matchId ? replay?.matchSnapshot : undefined;
}

export function cloudReplayForGameSegment(details: ResolvedGameDetails, replay?: ReplayRecord): AccountReplayLibraryItem | undefined {
  if (!replay) return details.cloudReplays.length === 1 ? details.cloudReplays[0] : undefined;
  const direct = details.cloudReplays.filter((cloud) => replay.rawCapture?.uploadId === cloud.replayId);
  if (direct.length === 1) return direct[0];
  if (replay.rawCapture?.uploadId) return undefined;
  const byCapture = details.cloudReplays.filter((cloud) => cloud.captureId && cloud.captureId === replay.rawCapture?.captureSessionId);
  if (byCapture.length === 1) return byCapture[0];
  // A durable association on this exact local match is valid too. Do not use
  // the BO3 parent's ID for one of its child recordings.
  if (details.match?.id !== replay.matchId || !details.match.webReplayId) return undefined;
  const byMatch = details.cloudReplays.filter((cloud) => cloud.replayId === details.match!.webReplayId);
  return byMatch.length === 1 ? byMatch[0] : undefined;
}
