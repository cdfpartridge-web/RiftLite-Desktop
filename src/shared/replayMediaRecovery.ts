import type { GamePlatform, ReplayRecord } from "./types.js";

export function isReplayMediaFilename(filename: string): boolean {
  return /\.(?:webm|mp4)$/i.test(filename.trim());
}

export function replayMediaMimeType(filename: string): "video/webm" | "video/mp4" {
  return /\.mp4$/i.test(filename.trim()) ? "video/mp4" : "video/webm";
}

export function replayMediaPlatform(filename: string): GamePlatform {
  return /(?:^|[^a-z])tcga(?:[^a-z]|$)|tcg-arena/i.test(filename) ? "tcga" : "atlas";
}

export function replayMediaCapturedAt(filename: string, fallback: Date): string {
  const matches = Array.from(filename.matchAll(/(20\d{2})-(\d{2})-(\d{2})[_T-](\d{2})-(\d{2})-(\d{2})/g));
  const match = matches.at(-1);
  if (!match) return fallback.toISOString();
  const [, year, month, day, hour, minute, second] = match;
  const utc = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ));
  return Number.isNaN(utc.getTime()) ? fallback.toISOString() : utc.toISOString();
}

export function replayMediaDurationMsFromFfmpegOutput(output: string): number {
  let durationMs = 0;
  const timestamps = output.matchAll(/(?:Duration:\s*|\bout_time=|\btime=)(\d{1,3}):(\d{2}):(\d{2}(?:\.\d+)?)/gi);
  for (const match of timestamps) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const candidate = Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
    if (Number.isFinite(candidate)) {
      durationMs = Math.max(durationMs, candidate);
    }
  }
  return durationMs;
}

export function matchingMissingReplayIdForMedia(
  replays: ReplayRecord[],
  platform: GamePlatform,
  startedAt: string,
  endedAt: string,
  durationMs: number
): string {
  if (durationMs <= 0) return "";
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(endedAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "";
  const matches = replays.filter((replay) => {
    if (replay.video?.path || replay.platform !== platform) return false;
    const capturedMs = new Date(replay.capturedAt).getTime();
    return Number.isFinite(capturedMs) && capturedMs >= startMs - 2 * 60_000 && capturedMs <= endMs + 10 * 60_000;
  });
  return matches.length === 1 ? matches[0]!.id : "";
}
