import type { GamePlatform, VisionDeckTrackerStatus } from "./types.js";

/**
 * Compatibility status factory for the event-driven deck tracker.
 *
 * The public type and IPC method retain their historical `Vision` name so an
 * older renderer can still talk to a newer main process. No image recognition
 * or screen capture is performed by the current tracker.
 */
export function emptyVisionDeckTrackerStatus(
  enabled: boolean,
  platform: GamePlatform | "none",
  message = enabled ? "Event deck tracker is waiting for an active deck." : "Event deck tracker is off."
): VisionDeckTrackerStatus {
  return {
    state: enabled ? "waiting-for-deck" : "disabled",
    enabled,
    active: false,
    platform,
    message,
    updatedAt: new Date().toISOString(),
    frameId: "",
    confidenceScore: 0,
    processedFrames: 0,
    skippedFrames: 0,
    suggestions: []
  };
}
