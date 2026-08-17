import type {
  LiveTakeoverTelemetryEvent,
  LiveTakeoverTelemetryPayload,
} from "../shared/types.js";
import type { HomeLiveTakeover } from "./homeCreatorVideos.js";

export type LiveTakeoverWatchSession = {
  start(): void;
  mediaStarted(available: boolean): void;
  mediaPaused(): void;
  availabilityChanged(available: boolean): void;
  checkpoint(): void;
  finish(event?: "stopped" | "dismissed"): void;
};

export function createLiveTakeoverWatchSession(input: {
  takeover: HomeLiveTakeover;
  sessionId: string;
  emit: (payload: LiveTakeoverTelemetryPayload) => void;
  now?: () => number;
}): LiveTakeoverWatchSession | null {
  const analytics = input.takeover.analytics;
  if (!analytics) return null;
  const now = input.now ?? Date.now;
  const startedAtMs = now();
  let started = false;
  let finished = false;
  let hasPlayed = false;
  let mediaPlaying = false;
  let available = false;
  let engagedAt: number | null = null;
  let watchedMs = 0;

  const syncEngagement = (timestamp: number) => {
    const shouldEngage = !finished && mediaPlaying && available;
    if (engagedAt !== null && !shouldEngage) {
      watchedMs += Math.max(0, timestamp - engagedAt);
      engagedAt = null;
    } else if (engagedAt === null && shouldEngage) {
      engagedAt = timestamp;
    }
  };

  const commitEngagement = (timestamp: number) => {
    if (engagedAt === null) return;
    watchedMs += Math.max(0, timestamp - engagedAt);
    engagedAt = timestamp;
  };

  const emit = (event: LiveTakeoverTelemetryEvent, timestamp = now()) => {
    input.emit({
      runId: analytics.runId,
      token: analytics.token,
      sessionId: input.sessionId,
      channelLogin: input.takeover.channelLogin,
      event,
      hasPlayed,
      watchedSeconds: Math.max(0, Math.floor(watchedMs / 1_000)),
      startedAt: new Date(startedAtMs).toISOString(),
      occurredAt: new Date(timestamp).toISOString(),
    });
  };

  return {
    start() {
      if (started || finished) return;
      started = true;
      emit("impression", startedAtMs);
    },
    mediaStarted(nextAvailable) {
      if (finished) return;
      const timestamp = now();
      hasPlayed = true;
      mediaPlaying = true;
      available = nextAvailable;
      syncEngagement(timestamp);
      emit("playing", timestamp);
    },
    mediaPaused() {
      if (finished || !mediaPlaying) return;
      const timestamp = now();
      mediaPlaying = false;
      syncEngagement(timestamp);
      emit("paused", timestamp);
    },
    availabilityChanged(nextAvailable) {
      if (finished || available === nextAvailable) return;
      const timestamp = now();
      available = nextAvailable;
      syncEngagement(timestamp);
      if (hasPlayed && mediaPlaying) {
        emit(nextAvailable ? "playing" : "paused", timestamp);
      }
    },
    checkpoint() {
      if (finished || !hasPlayed || !mediaPlaying || !available) return;
      const timestamp = now();
      commitEngagement(timestamp);
      emit("checkpoint", timestamp);
    },
    finish(event = "stopped") {
      if (finished) return;
      const timestamp = now();
      mediaPlaying = false;
      syncEngagement(timestamp);
      finished = true;
      emit(event, timestamp);
    },
  };
}
