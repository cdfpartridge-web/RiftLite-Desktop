import type { ReplayRecord } from "./types.js";

export function upsertReplayPreservingOrder(replays: ReplayRecord[], saved: ReplayRecord): ReplayRecord[] {
  const existingIndex = replays.findIndex((replay) => replay.id === saved.id);
  if (existingIndex < 0) {
    return [saved, ...replays];
  }
  return replays.map((replay, index) => index === existingIndex ? saved : replay);
}
