import { dirname, join, normalize } from "node:path";

const MIN_EARLY_DURATION_TOLERANCE_MS = 100;
const MAX_EARLY_DURATION_TOLERANCE_MS = 500;
const EARLY_DURATION_TOLERANCE_RATIO = 0.002;
const MIN_LATE_DURATION_TOLERANCE_MS = 250;
const MAX_LATE_DURATION_TOLERANCE_MS = 1_500;
const LATE_DURATION_TOLERANCE_RATIO = 0.005;

export interface ReplayMp4StagingPaths {
  directory: string;
  partialPath: string;
}

export interface ReplayMp4FileIdentity {
  dev: number;
  ino: number;
}

export function replayMp4StagingPaths(outputPath: string, exportId: string): ReplayMp4StagingPaths {
  const safeExportId = exportId.replace(/[^a-z0-9-]/gi, "").slice(0, 64) || "pending";
  const directory = join(dirname(outputPath), `.riftlite-export-${safeExportId}`);
  return {
    directory,
    partialPath: join(directory, "output.partial")
  };
}

export function replayMp4CanonicalPathKey(filePath: string, platform: NodeJS.Platform): string {
  const normalized = normalize(filePath);
  return platform === "win32" || platform === "darwin" ? normalized.toLowerCase() : normalized;
}

export function replayMp4FileIdentityMatches(
  first: ReplayMp4FileIdentity,
  second: ReplayMp4FileIdentity
): boolean {
  if (!Number.isFinite(first.dev) || !Number.isFinite(first.ino) || !Number.isFinite(second.dev) || !Number.isFinite(second.ino)) {
    return false;
  }
  if (first.dev === 0 && first.ino === 0 && second.dev === 0 && second.ino === 0) {
    return false;
  }
  return first.dev === second.dev && first.ino === second.ino;
}

export interface ReplayMp4DurationTolerance {
  earlyMs: number;
  lateMs: number;
}

export function replayMp4DurationTolerance(expectedDurationMs: number): ReplayMp4DurationTolerance {
  const safeExpected = Number.isFinite(expectedDurationMs) && expectedDurationMs > 0
    ? expectedDurationMs
    : 0;
  return {
    earlyMs: Math.min(
      MAX_EARLY_DURATION_TOLERANCE_MS,
      Math.max(MIN_EARLY_DURATION_TOLERANCE_MS, Math.ceil(safeExpected * EARLY_DURATION_TOLERANCE_RATIO))
    ),
    lateMs: Math.min(
      MAX_LATE_DURATION_TOLERANCE_MS,
      Math.max(MIN_LATE_DURATION_TOLERANCE_MS, Math.ceil(safeExpected * LATE_DURATION_TOLERANCE_RATIO))
    )
  };
}

export function replayMp4DurationIsNearExpected(actualDurationMs: number, expectedDurationMs: number): boolean {
  if (
    !Number.isFinite(actualDurationMs) || actualDurationMs <= 0 ||
    !Number.isFinite(expectedDurationMs) || expectedDurationMs <= 0
  ) {
    return false;
  }
  const tolerance = replayMp4DurationTolerance(expectedDurationMs);
  return actualDurationMs >= expectedDurationMs - tolerance.earlyMs &&
    actualDurationMs <= expectedDurationMs + tolerance.lateMs;
}

export function replayMp4ProgressTimeMs(line: string): number | null {
  const match = line.trim().match(/^out_time=(\d{2,}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (![hours, minutes, seconds].every(Number.isFinite)) {
    return null;
  }
  return Math.max(0, Math.round((hours * 3_600 + minutes * 60 + seconds) * 1_000));
}

export function replayMp4ProbeHasVideo(output: string): boolean {
  return /Stream\s+#\d+:\d+[^\r\n]*Video:/i.test(output);
}

export function replayMp4EncodingPercent(processedMs: number, expectedDurationMs: number): number | undefined {
  return replayMp4ProgressPercent(processedMs, expectedDurationMs, 5, 90);
}

export function replayMp4ValidationPercent(processedMs: number, expectedDurationMs: number): number | undefined {
  return replayMp4ProgressPercent(processedMs, expectedDurationMs, 92, 98);
}

function replayMp4ProgressPercent(
  processedMs: number,
  expectedDurationMs: number,
  startPercent: number,
  endPercent: number
): number | undefined {
  if (
    !Number.isFinite(processedMs) || processedMs < 0 ||
    !Number.isFinite(expectedDurationMs) || expectedDurationMs <= 0
  ) {
    return undefined;
  }
  const ratio = Math.min(1, Math.max(0, processedMs / expectedDurationMs));
  return Math.min(endPercent, Math.max(startPercent, Math.round(startPercent + ratio * (endPercent - startPercent))));
}
