import type { WebReplayUploadQueueItem } from "./types.js";

export const WEB_REPLAY_WARNING_DISMISSALS_STORAGE_KEY = "riftlite-web-replay-warning-dismissals-v1";
const MAX_WEB_REPLAY_WARNING_DISMISSALS = 200;
const MAX_WEB_REPLAY_WARNING_KEY_LENGTH = 2_048;
const MAX_WEB_REPLAY_WARNING_COUNT = 6;
const MAX_WEB_REPLAY_WARNING_LENGTH = 240;

export function webReplayReadyWarningDismissalKey(
  item: Pick<WebReplayUploadQueueItem, "platform" | "captureSessionId" | "stage" | "partialWarnings">
): string {
  if (item.stage !== "ready") return "";
  const warnings = [...new Set((item.partialWarnings ?? [])
    .map((warning) => warning.trim().replace(/\s+/g, " ").slice(0, MAX_WEB_REPLAY_WARNING_LENGTH))
    .filter(Boolean))]
    .slice(0, MAX_WEB_REPLAY_WARNING_COUNT);
  if (!warnings.length) return "";
  return JSON.stringify([item.platform, item.captureSessionId, warnings]);
}

export function parseWebReplayWarningDismissals(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed
      .filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= MAX_WEB_REPLAY_WARNING_KEY_LENGTH))]
      .slice(-MAX_WEB_REPLAY_WARNING_DISMISSALS);
  } catch {
    return [];
  }
}

export function addWebReplayWarningDismissal(current: readonly string[], key: string): string[] {
  if (!key || key.length > MAX_WEB_REPLAY_WARNING_KEY_LENGTH) return [...current];
  return [...current.filter((item) => item !== key), key]
    .slice(-MAX_WEB_REPLAY_WARNING_DISMISSALS);
}

export function webReplayReadyWarningIsDismissed(
  item: Pick<WebReplayUploadQueueItem, "platform" | "captureSessionId" | "stage" | "partialWarnings">,
  dismissedKeys: readonly string[]
): boolean {
  const key = webReplayReadyWarningDismissalKey(item);
  return Boolean(key && dismissedKeys.includes(key));
}
