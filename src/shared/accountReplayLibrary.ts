import type { MatchDraft, RawCaptureProcessingStatus, RawCaptureVisibility, ReplayRecord } from "./types.js";

export const ACCOUNT_REPLAY_LIBRARY_LIMIT = 100;

export interface AccountReplayLibraryItem {
  replayId: string;
  captureId?: string;
  title: string;
  platform: string;
  visibility: RawCaptureVisibility;
  status: RawCaptureProcessingStatus;
  url: string;
  capturedAt: string;
  createdAt: string;
  updatedAt: string;
  listing?: {
    playerName: string;
    opponentName: string;
    playerLegend: string;
    opponentLegend: string;
    format: "bo1" | "bo3" | "unknown";
    result: "win" | "loss" | "draw" | "unknown";
  };
  warnings?: string[];
}

export interface AccountReplayLibraryResult {
  /** Empty when no account is linked or an account switch invalidates the response. */
  accountUid: string;
  available: boolean;
  items: AccountReplayLibraryItem[];
  limit: number;
  /** The owner endpoint is capped; it does not currently expose a next-page cursor. */
  mayHaveMore: boolean;
  error?: string;
}

export interface AccountReplayLibraryEntry {
  id: string;
  replay?: ReplayRecord;
  match?: MatchDraft;
  cloudReplay?: AccountReplayLibraryItem;
}

function rowReplayId(entry: AccountReplayLibraryEntry): string | undefined {
  // A local capture's own upload ID is more specific than a containing BO3 match.
  return entry.replay?.rawCapture?.uploadId || entry.match?.webReplayId;
}

/**
 * Combines locally saved replays and authenticated account listings. Never infer
 * identity from title, players, legend or date: repeated matchups are common.
 */
export function mergeAccountReplayLibrary(
  replays: readonly ReplayRecord[],
  matches: readonly MatchDraft[],
  cloudItems: readonly AccountReplayLibraryItem[]
): AccountReplayLibraryEntry[] {
  const matchById = new Map(matches.filter((match) => !match.deletedAt).map((match) => [match.id, match]));
  const localReplays = [...new Map(replays.filter((replay) => !replay.deletedAt).map((replay) => [replay.id, replay])).values()];
  const entries: AccountReplayLibraryEntry[] = localReplays.map((replay) => ({
    id: `local:${replay.id}`, replay, match: matchById.get(replay.matchId)
  }));
  const representedMatches = new Set(entries.map((entry) => entry.match?.id).filter(Boolean));
  for (const match of matchById.values()) {
    if (!representedMatches.has(match.id) && !match.hiddenFromHistory && !match.mergedIntoMatchId) {
      entries.push({ id: `match:${match.id}`, match });
    }
  }

  for (const cloudReplay of new Map(cloudItems.map((item) => [item.replayId, item])).values()) {
    const direct = entries.filter((entry) => !entry.cloudReplay && rowReplayId(entry) === cloudReplay.replayId);
    const byCapture = direct.length ? [] : entries.filter((entry) => !entry.cloudReplay && !rowReplayId(entry)
      && Boolean(cloudReplay.captureId) && entry.replay?.rawCapture?.captureSessionId === cloudReplay.captureId);
    const candidates = direct.length ? direct : byCapture;
    if (candidates.length === 1) {
      candidates[0].cloudReplay = cloudReplay;
    } else {
      // Ambiguity is preserved as a separate cloud row, never silently attached.
      entries.push({ id: `cloud:${cloudReplay.replayId}`, cloudReplay });
    }
  }
  return entries;
}
