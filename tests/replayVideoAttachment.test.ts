import { describe, expect, it, vi } from "vitest";
import { attachReplayVideoToStore } from "../src/main/services/replayVideoAttachment.js";
import type { ReplayRecord, ReplayVideoAsset } from "../src/shared/types.js";

function replay(video?: ReplayVideoAsset): ReplayRecord {
  return {
    id: "replay-match-1",
    matchId: "match-1",
    platform: "atlas",
    capturedAt: "2026-07-18T23:05:40.973Z",
    title: "Irelia vs Nasus",
    players: { me: "Player", opponent: "Opponent" },
    events: [],
    rawCapture: {
      captureSessionId: "capture-1",
      localPath: "raw.json",
      indexPath: "raw.json.riftlite-index.json",
      messageCount: 100,
      droppedCount: 0,
      uncompressedBytes: 1000,
      uploadStatus: "uploaded"
    },
    video
  };
}

function video(path = "match.webm", durationMs = 60_000): ReplayVideoAsset {
  return {
    path,
    url: `file:///${path}`,
    filename: path,
    directory: ".",
    mimeType: "video/webm",
    source: "game-frame-direct",
    platform: "atlas",
    startedAt: "2026-07-18T23:05:41.000Z",
    endedAt: "2026-07-18T23:06:41.000Z",
    durationMs,
    sizeBytes: 1000,
    width: 1920,
    height: 1080,
    fps: 30,
    captureIntervalMs: 33,
    bitrateKbps: 8000,
    codec: "VP8 WebM",
    quality: "youtube",
    hasAudio: false,
    containerFinalized: true
  };
}

describe("replay video attachment", () => {
  it("waits for the replay row and patches video without losing raw capture metadata", async () => {
    let current: ReplayRecord | null = null;
    const wait = vi.fn(async () => {
      current = replay();
    });
    const store = {
      getReplays: async () => current ? [current] : [],
      updateReplay: async (_id: string, update: (replay: ReplayRecord) => ReplayRecord) => {
        if (!current) return null;
        current = update(current);
        return current;
      }
    };

    const result = await attachReplayVideoToStore(store as never, "match-1", video(), {
      attempts: 2,
      retryDelayMs: 0,
      wait
    });

    expect(wait).toHaveBeenCalledOnce();
    expect(result.attached).toBe(true);
    expect(result.replay?.video?.path).toBe("match.webm");
    expect(result.replay?.rawCapture?.uploadStatus).toBe("uploaded");
  });

  it("keeps a meaningfully longer existing recording", async () => {
    let current = replay(video("longer.webm", 90_001));
    const store = {
      getReplays: async () => [current],
      updateReplay: async (_id: string, update: (replay: ReplayRecord) => ReplayRecord) => {
        current = update(current);
        return current;
      }
    };

    const result = await attachReplayVideoToStore(store as never, "match-1", video("shorter.webm", 60_000), {
      attempts: 1
    });

    expect(result.attached).toBe(false);
    expect(result.replay?.video?.path).toBe("longer.webm");
    expect(result.replay?.rawCapture?.uploadStatus).toBe("uploaded");
  });
});
