import { describe, expect, it } from "vitest";
import type { ReplayRecord } from "../src/shared/types.js";

import {
  isReplayMediaFilename,
  matchingMissingReplayIdForMedia,
  replayMediaCapturedAt,
  replayMediaDurationMsFromFfmpegOutput,
  replayMediaMimeType,
  replayMediaPlatform
} from "../src/shared/replayMediaRecovery.js";

describe("loose replay media recovery", () => {
  it("recognizes the video files written by RiftLite", () => {
    expect(isReplayMediaFilename("RiftLite_atlas-sharp-match_2026-07-16_19-50-04.webm")).toBe(true);
    expect(isReplayMediaFilename("recording.MP4")).toBe(true);
    expect(isReplayMediaFilename("coaching-pack.riftreplay")).toBe(false);
  });

  it("recovers platform, mime type, and the final timestamp from a filename", () => {
    const filename = "RiftLite_tcga-sharp_2026-07-16_18-10-00_2026-07-16_18-10-02.webm";
    expect(replayMediaPlatform(filename)).toBe("tcga");
    expect(replayMediaMimeType(filename)).toBe("video/webm");
    expect(replayMediaCapturedAt(filename, new Date("2026-01-01T00:00:00Z"))).toBe(
      "2026-07-16T18:10:02.000Z"
    );
  });

  it("recovers duration from packet-scan progress when a MediaRecorder WebM has no header duration", () => {
    expect(replayMediaDurationMsFromFfmpegOutput([
      "Duration: N/A, start: 0.000000, bitrate: N/A",
      "out_time=00:15:30.000000",
      "out_time=00:16:12.706000"
    ].join("\n"))).toBe(972_706);
    expect(replayMediaDurationMsFromFfmpegOutput("Duration: 00:01:02.50, start: 0.000000")).toBe(62_500);
  });

  it("reattaches media only when exactly one missing replay overlaps it", () => {
    const missing = (id: string, capturedAt: string) => ({
      id,
      matchId: id,
      platform: "atlas",
      capturedAt,
      title: id,
      players: { me: "", opponent: "" },
      events: []
    }) as ReplayRecord;
    expect(matchingMissingReplayIdForMedia(
      [missing("only-match", "2026-07-16T18:20:00.000Z")],
      "atlas",
      "2026-07-16T18:10:00.000Z",
      "2026-07-16T18:40:00.000Z",
      30 * 60_000
    )).toBe("only-match");
    expect(matchingMissingReplayIdForMedia(
      [
        missing("match-1", "2026-07-16T18:20:00.000Z"),
        missing("match-2", "2026-07-16T18:30:00.000Z")
      ],
      "atlas",
      "2026-07-16T18:10:00.000Z",
      "2026-07-16T18:40:00.000Z",
      30 * 60_000
    )).toBe("");
  });
});
