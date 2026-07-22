import { normalizeLegendName } from "./legendNames.js";
import type { MatchDraft, MatchGame } from "./types.js";

export interface MatchCombineWarning {
  code: string;
  severity: "warning" | "error";
  message: string;
}

export interface MatchCombinePreview {
  matches: MatchDraft[];
  warnings: MatchCombineWarning[];
  canSave: boolean;
}

export interface MatchCombineSavePayload {
  orderedMatchIds: string[];
}

const COMBINE_GAP_WARNING_MS = 2 * 60 * 60 * 1000;

export function buildMatchCombinePreview(matches: MatchDraft[]): MatchCombinePreview {
  const warnings = combineWarnings(matches);
  return {
    matches,
    warnings,
    canSave: matches.length >= 2 && matches.length <= 3 && !warnings.some((warning) => warning.severity === "error")
  };
}

export function combineWarnings(matches: MatchDraft[]): MatchCombineWarning[] {
  const warnings: MatchCombineWarning[] = [];
  if (matches.length < 2 || matches.length > 3) {
    warnings.push({ code: "count", severity: "error", message: "Select two or three saved games to combine into a Bo3." });
  }
  if (new Set(matches.map((match) => match.id)).size !== matches.length) {
    warnings.push({ code: "duplicate", severity: "error", message: "The same match is selected more than once." });
  }
  if (matches.some((match) => match.status === "pending-review")) {
    warnings.push({ code: "pending-review", severity: "error", message: "Save or dismiss pending review rows before combining." });
  }
  if (matches.some((match) => Boolean(match.mergedIntoMatchId))) {
    warnings.push({ code: "already-merged", severity: "error", message: "One of these games is already part of a combined Bo3. Undo that combine first." });
  }
  if (matches.some((match) => match.manualRepair && match.combinedFromMatchIds?.length)) {
    warnings.push({ code: "combined-match", severity: "error", message: "Combined Bo3 rows cannot be combined again." });
  }
  if (new Set(matches.map((match) => match.platform)).size > 1) {
    warnings.push({ code: "platform", severity: "warning", message: "Selected games use different platforms. Check the order carefully before saving." });
  }
  if (new Set(matches.map((match) => cleanKey(match.opponentName))).size > 1) {
    warnings.push({ code: "opponent", severity: "warning", message: "Opponent names do not all match." });
  }
  if (new Set(matches.map((match) => cleanLegendKey(match.myChampion))).size > 1) {
    warnings.push({ code: "my-legend", severity: "warning", message: "Your legends do not all match." });
  }
  if (new Set(matches.map((match) => cleanLegendKey(match.opponentChampion))).size > 1) {
    warnings.push({ code: "opponent-legend", severity: "warning", message: "Opponent legends do not all match." });
  }
  if (matches.some((match) => match.result === "Incomplete")) {
    warnings.push({ code: "incomplete", severity: "warning", message: "At least one selected game is incomplete and will stay incomplete in the combined Bo3." });
  }
  if (matches.some((match) => match.games.length > 1)) {
    warnings.push({ code: "multi-game-source", severity: "warning", message: "A selected row already has multiple games. RiftLite will use the first game row from it." });
  }
  const times = matches.map(matchTime).filter((time) => time > 0).sort((a, b) => a - b);
  for (let index = 1; index < times.length; index += 1) {
    if (times[index] - times[index - 1] > COMBINE_GAP_WARNING_MS) {
      warnings.push({ code: "time-gap", severity: "warning", message: "These games are more than two hours apart." });
      break;
    }
  }
  return warnings;
}

export function buildCombinedBo3Match(matches: MatchDraft[], id: string, now: string): MatchDraft {
  const ordered = matches.slice(0, 3);
  const base = ordered[0];
  const games = ordered.map((match, index) => gameFromMatch(match, index + 1));
  const summary = matchSummaryFromGames(games);
  const sourceValues = new Set(ordered.map((match) => match.source ?? "capture"));
  const source = sourceValues.size === 1 ? (base.source ?? "capture") : "manual";
  return {
    ...base,
    id,
    source,
    manualRepair: true,
    combinedFromMatchIds: ordered.map((match) => match.id),
    combinedAt: now,
    combinedBy: "user",
    mergedIntoMatchId: undefined,
    hiddenFromStats: false,
    hiddenFromHistory: false,
    // A combined row represents multiple games. Reusing the first source
    // match's replay identity would grant access to a single-game replay while
    // presenting it as the whole Bo3.
    webReplayId: undefined,
    webReplayAccountUid: undefined,
    webReplayLocalReplayId: undefined,
    status: "saved",
    format: "Bo3",
    result: summary.result,
    score: summary.score,
    capturedAt: earliestCapturedAt(ordered) || base.capturedAt,
    updatedAt: now,
    games,
    myBattlefield: games[0]?.myBattlefield ?? base.myBattlefield,
    opponentBattlefield: games[0]?.oppBattlefield ?? base.opponentBattlefield,
    flags: combineUniqueText(ordered.map((match) => match.flags)),
    notes: combineUniqueText(ordered.map((match) => match.notes)),
    rawEvidence: [],
    sync: combinedSyncState(ordered)
  };
}

export function markOriginalAsCombined(match: MatchDraft, combinedMatchId: string, now: string): MatchDraft {
  return {
    ...match,
    mergedIntoMatchId: combinedMatchId,
    hiddenFromStats: true,
    hiddenFromHistory: true,
    updatedAt: now
  };
}

export function restoreCombinedOriginal(match: MatchDraft, now: string): MatchDraft {
  const restored = {
    ...match,
    updatedAt: now,
    // Undo must actively publish the non-superseded document again. Keeping a
    // stale `synced` value would make the normal reporter skip that write.
    sync: {
      community: match.sync.community === "disabled" ? "disabled" as const : "pending" as const,
      hubs: Object.fromEntries(Object.keys(match.sync.hubs ?? {}).map((hubId) => [hubId, "pending" as const])),
      teams: Object.fromEntries(Object.keys(match.sync.teams ?? {}).map((teamId) => [teamId, "pending" as const]))
    }
  };
  delete restored.mergedIntoMatchId;
  delete restored.hiddenFromStats;
  delete restored.hiddenFromHistory;
  return restored;
}

export function isCombinedOriginal(match: Pick<MatchDraft, "mergedIntoMatchId" | "hiddenFromStats" | "hiddenFromHistory">): boolean {
  return Boolean(match.mergedIntoMatchId || match.hiddenFromStats || match.hiddenFromHistory);
}

export function isCombinedRepairMatch(match: Pick<MatchDraft, "manualRepair" | "combinedFromMatchIds">): boolean {
  return Boolean(match.manualRepair && match.combinedFromMatchIds?.length);
}

function gameFromMatch(match: MatchDraft, gameNumber: number): MatchGame {
  const existing = match.games[0];
  const fallbackPoints = fallbackPointsFromScore(match.score);
  return {
    gameNumber,
    result: existing?.result ?? match.result,
    myPoints: existing?.myPoints ?? fallbackPoints.myPoints,
    oppPoints: existing?.oppPoints ?? fallbackPoints.oppPoints,
    myBattlefield: existing?.myBattlefield || match.myBattlefield,
    oppBattlefield: existing?.oppBattlefield || match.opponentBattlefield,
    myBattlefieldCode: existing?.myBattlefieldCode,
    oppBattlefieldCode: existing?.oppBattlefieldCode,
    myBattlefieldImage: existing?.myBattlefieldImage,
    oppBattlefieldImage: existing?.oppBattlefieldImage,
    extraBattlefields: existing?.extraBattlefields ?? [],
    wentFirst: existing?.wentFirst ?? ""
  };
}

function matchSummaryFromGames(games: MatchGame[]): { result: MatchDraft["result"]; score: string } {
  const wins = games.filter((game) => game.result === "Win").length;
  const losses = games.filter((game) => game.result === "Loss").length;
  const draws = games.filter((game) => game.result === "Draw").length;
  const completeGames = wins + losses + draws;
  if (!completeGames) {
    return { result: "Incomplete", score: "" };
  }
  const score = `${wins}-${losses}${draws ? `-${draws}` : ""}`;
  if (wins > losses) return { result: "Win", score };
  if (losses > wins) return { result: "Loss", score };
  if (draws && !wins && !losses) return { result: "Draw", score };
  return { result: "Draw", score };
}

function combinedSyncState(matches: MatchDraft[]): MatchDraft["sync"] {
  const hubs: MatchDraft["sync"]["hubs"] = {};
  const teams: MatchDraft["sync"]["teams"] = {};
  let community: MatchDraft["sync"]["community"] = "disabled";
  for (const match of matches) {
    if (match.sync.community !== "disabled") {
      community = "pending";
    }
    for (const hubId of Object.keys(match.sync.hubs ?? {})) {
      hubs[hubId] = "pending";
    }
    for (const teamId of Object.keys(match.sync.teams ?? {})) {
      teams[teamId] = "pending";
    }
  }
  return { community, hubs, teams };
}

function fallbackPointsFromScore(score: string): { myPoints?: number; oppPoints?: number } {
  const match = score.trim().match(/^(\d{1,2})\D+(\d{1,2})$/);
  if (!match) return {};
  const myPoints = Number(match[1]);
  const oppPoints = Number(match[2]);
  if (!Number.isFinite(myPoints) || !Number.isFinite(oppPoints)) return {};
  if (Math.max(myPoints, oppPoints) < 3) return {};
  return { myPoints, oppPoints };
}

function earliestCapturedAt(matches: MatchDraft[]): string {
  return matches
    .map((match) => match.capturedAt)
    .filter(Boolean)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? "";
}

function combineUniqueText(values: string[]): string {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).join("\n\n");
}

function matchTime(match: MatchDraft): number {
  const parsed = new Date(match.capturedAt).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function cleanLegendKey(value: string): string {
  return normalizeLegendName(value).toLowerCase();
}
