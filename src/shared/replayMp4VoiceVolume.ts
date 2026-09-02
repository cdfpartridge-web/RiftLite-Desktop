export const DEFAULT_REPLAY_MP4_VOICE_VOLUME = 1.5;
export const MIN_REPLAY_MP4_VOICE_VOLUME = 0.5;
export const MAX_REPLAY_MP4_VOICE_VOLUME = 3;
export const REPLAY_MP4_VOICE_VOLUME_STEP = 0.25;

export function normalizeReplayMp4VoiceVolume(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_REPLAY_MP4_VOICE_VOLUME;
  }
  return Math.min(MAX_REPLAY_MP4_VOICE_VOLUME, Math.max(MIN_REPLAY_MP4_VOICE_VOLUME, parsed));
}
