import type { WebReplayUploadQueueItem } from "./types.js";
import { webReplayQueueItemCanBeKeptLocalOnly } from "./replayDelivery.js";

export interface WebReplayKeepLocalCandidate {
  captureSessionId: string;
  title: string;
}

export function webReplayKeepLocalCandidates(queue: readonly WebReplayUploadQueueItem[]): WebReplayKeepLocalCandidate[] {
  const candidates = new Map<string, WebReplayKeepLocalCandidate>();
  const excluded = new Set<string>();
  for (const item of queue) {
    if (!["captured", "queued", "failed", "paused"].includes(item.stage)
      || !webReplayQueueItemCanBeKeptLocalOnly(item)) {
      excluded.add(item.captureSessionId);
      continue;
    }
    candidates.set(item.captureSessionId, { captureSessionId: item.captureSessionId, title: item.title });
  }
  // The queue API addresses captures by ID, including any duplicate aliases.
  return [...candidates.values()].filter((item) => !excluded.has(item.captureSessionId));
}

export async function keepWebReplayUploadsLocalOnly(
  candidates: readonly WebReplayKeepLocalCandidate[],
  removeFromQueue: (captureSessionId: string) => Promise<void>,
  onProgress?: (completed: number, total: number) => void
): Promise<{ keptCount: number; failures: Array<WebReplayKeepLocalCandidate & { error: string }> }> {
  // Freeze the confirmed selection before awaiting; later captures are not included.
  const snapshot = [...new Map(candidates.map((item) => [item.captureSessionId, { ...item }])).values()];
  const failures: Array<WebReplayKeepLocalCandidate & { error: string }> = [];
  let keptCount = 0;
  for (const item of snapshot) {
    try {
      // Keep the existing service's capture lock and online-replay protection.
      await removeFromQueue(item.captureSessionId);
      keptCount += 1;
    } catch (error) {
      failures.push({ ...item, error: error instanceof Error ? error.message : "The upload could not be removed from the queue." });
    }
    onProgress?.(keptCount + failures.length, snapshot.length);
  }
  return { keptCount, failures };
}

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
