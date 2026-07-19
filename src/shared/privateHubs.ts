import type { PrivateHub, ReplayRecord, UserSettings } from "./types.js";

export const PRIVATE_HUB_DELETE_COUNTDOWN_SECONDS = 5;
export const RIFTLITE_WEB_REPLAY_ORIGIN = "https://www.riftlite.com";

const WEB_REPLAY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;

export function canLeavePrivateHub(hub: Pick<PrivateHub, "role" | "claimed">): boolean {
  return hub.claimed === true && (hub.role === "admin" || hub.role === "member");
}

export function canDeletePrivateHub(hub: Pick<PrivateHub, "role" | "claimed">): boolean {
  return hub.claimed === true && hub.role === "owner";
}

export function privateHubMembershipsEqual(
  current: readonly PrivateHub[],
  refreshed: readonly PrivateHub[]
): boolean {
  if (current.length !== refreshed.length) return false;
  return current.every((hub, index) => {
    const next = refreshed[index];
    return Boolean(next) &&
      hub.id === next.id &&
      hub.name === next.name &&
      hub.sync === next.sync &&
      (hub.passwordHash ?? "") === (next.passwordHash ?? "") &&
      (hub.joinedAt ?? "") === (next.joinedAt ?? "") &&
      (hub.role ?? "") === (next.role ?? "") &&
      Boolean(hub.claimed) === Boolean(next.claimed) &&
      (hub.imageDataUrl ?? "") === (next.imageDataUrl ?? "") &&
      (hub.imageUpdatedAt ?? "") === (next.imageUpdatedAt ?? "");
  });
}

export function normalizePrivateHubWebReplayId(value: unknown): string {
  const replayId = typeof value === "string" ? value.trim() : "";
  return WEB_REPLAY_ID_PATTERN.test(replayId) ? replayId : "";
}

export function privateHubWebReplayUrl(scope: unknown, replayId: unknown): string {
  if (scope !== "hub") return "";
  const normalizedReplayId = normalizePrivateHubWebReplayId(replayId);
  return normalizedReplayId
    ? `${RIFTLITE_WEB_REPLAY_ORIGIN}/replays/${encodeURIComponent(normalizedReplayId)}`
    : "";
}

export function webReplayIdForLocalMatch(replays: readonly ReplayRecord[], matchId: string): string {
  const normalizedMatchId = String(matchId ?? "").trim();
  if (!normalizedMatchId) return "";
  const candidates = replays
    .filter((replay) => replay.matchId === normalizedMatchId || replay.matchSnapshot?.id === normalizedMatchId)
    .filter((replay) => replay.rawCapture?.provider === "riftlite-v2" && replay.rawCapture.uploadStatus === "uploaded")
    .sort((left, right) => new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime());
  for (const replay of candidates) {
    const replayId = normalizePrivateHubWebReplayId(replay.rawCapture?.uploadId);
    if (replayId) return replayId;
  }
  return "";
}

export function webReplayIdsByLocalMatch(replays: readonly ReplayRecord[]): Map<string, string> {
  const ids = new Map<string, string>();
  const matchIds = new Set(replays.flatMap((replay) => [replay.matchId, replay.matchSnapshot?.id ?? ""]).filter(Boolean));
  for (const matchId of matchIds) {
    const replayId = webReplayIdForLocalMatch(replays, matchId);
    if (replayId) ids.set(matchId, replayId);
  }
  return ids;
}

export function settingsPatchAfterPrivateHubRemoval(
  settings: Pick<UserSettings, "activeHubs" | "rawCapture">,
  hubId: string
): Pick<UserSettings, "activeHubs" | "rawCapture"> {
  const normalizedHubId = String(hubId ?? "").trim();
  const remainingReplayHubIds = settings.rawCapture.webReplayDiscordShareHubIds
    .map((value) => String(value ?? "").trim())
    .filter((value) => value && value !== normalizedHubId);
  const keepDiscordShareConsent = settings.rawCapture.webReplayDiscordShareEnabled && remainingReplayHubIds.length > 0;
  return {
    activeHubs: settings.activeHubs.filter((hub) => hub.id !== normalizedHubId),
    rawCapture: {
      ...settings.rawCapture,
      webReplayDiscordShareEnabled: keepDiscordShareConsent,
      webReplayDiscordShareAccountUid: keepDiscordShareConsent
        ? settings.rawCapture.webReplayDiscordShareAccountUid
        : "",
      webReplayDiscordShareHubIds: Array.from(new Set(remainingReplayHubIds))
    }
  };
}
