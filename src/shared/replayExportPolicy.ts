const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

// Legacy replay bundles are parsed as one JSON string, so this cap must remain
// conservative. Streamed v4 bundles are decoded incrementally and can safely
// carry normal full-match recordings above the old 384 MiB ceiling.
export const MAX_LEGACY_REPLAY_BUNDLE_BYTES = 512 * MEBIBYTE;
export const MAX_LEGACY_REPLAY_VIDEO_BYTES = 384 * MEBIBYTE;
export const MAX_STREAMED_REPLAY_VIDEO_BYTES = 8 * GIBIBYTE;
export const MAX_STREAMED_REPLAY_MANIFEST_BYTES = 512 * MEBIBYTE;
export const MAX_STREAMED_REPLAY_BUNDLE_BYTES = 12 * GIBIBYTE;

// Sending a recording through Electron IPC and then constructing a Blob can
// keep several copies alive at once. Larger recordings use their file URL and
// Chromium's range-backed media playback instead.
export const MAX_IN_MEMORY_REPLAY_VIDEO_BYTES = 128 * MEBIBYTE;

const REPLAY_STREAM_RAW_CHUNK_BYTES = MEBIBYTE;
const REPLAY_STREAM_MARKER_ALLOWANCE_BYTES = 1024;

const MIN_REPLAY_MP4_EXPORT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_REPLAY_MP4_EXPORT_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const REPLAY_MP4_EXPORT_STARTUP_ALLOWANCE_MS = 5 * 60 * 1000;

export function replayMp4ExportTimeoutMs(durationMs: number): number {
  const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  const durationAwareTimeout = safeDurationMs * 3 + REPLAY_MP4_EXPORT_STARTUP_ALLOWANCE_MS;
  return Math.min(
    MAX_REPLAY_MP4_EXPORT_TIMEOUT_MS,
    Math.max(MIN_REPLAY_MP4_EXPORT_TIMEOUT_MS, Math.ceil(durationAwareTimeout))
  );
}

export function shouldBufferReplayVideoInMemory(sizeBytes: number | undefined): boolean {
  return typeof sizeBytes === "number"
    && Number.isFinite(sizeBytes)
    && sizeBytes > 0
    && sizeBytes <= MAX_IN_MEMORY_REPLAY_VIDEO_BYTES;
}

export function estimatedStreamedReplayBundleBytes(manifestBytes: number, videoBytes: number): number {
  if (!Number.isFinite(manifestBytes) || manifestBytes < 0 || !Number.isFinite(videoBytes) || videoBytes < 0) {
    return Number.POSITIVE_INFINITY;
  }
  const encodedVideoBytes = Math.ceil(videoBytes / 3) * 4;
  const videoLineBreaks = Math.ceil(videoBytes / REPLAY_STREAM_RAW_CHUNK_BYTES) + 1;
  return Math.ceil(manifestBytes) + encodedVideoBytes + videoLineBreaks + REPLAY_STREAM_MARKER_ALLOWANCE_BYTES;
}
