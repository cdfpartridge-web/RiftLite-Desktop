import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import {
  replayMp4CanonicalPathKey,
  replayMp4DurationIsNearExpected,
  replayMp4DurationTolerance,
  replayMp4EncodingPercent,
  replayMp4FileIdentityMatches,
  replayMp4ProbeHasVideo,
  replayMp4ProgressTimeMs,
  replayMp4StagingPaths,
  replayMp4ValidationPercent
} from "../src/main/services/replayMp4ExportSafety";

describe("replay MP4 safe export helpers", () => {
  it("stages a non-media partial inside a sibling hidden directory", () => {
    const outputPath = "C:\\Videos\\Zed-vs-Diana.mp4";
    const staging = replayMp4StagingPaths(outputPath, "export-123");
    expect(dirname(staging.directory)).toBe(dirname(outputPath));
    expect(staging.directory).toContain(".riftlite-export-export-123");
    expect(staging.partialPath).not.toBe(outputPath);
    expect(staging.partialPath).toMatch(/output\.partial$/);
    expect(staging.partialPath).not.toMatch(/\.(?:mp4|webm)$/i);
  });

  it("case-folds canonical path keys on Windows and macOS and detects hard-link identity", () => {
    expect(replayMp4CanonicalPathKey("C:\\Videos\\Replay.MP4", "win32"))
      .toBe(replayMp4CanonicalPathKey("c:\\videos\\replay.mp4", "win32"));
    expect(replayMp4CanonicalPathKey("/Users/Test/Replay.MP4", "darwin"))
      .toBe(replayMp4CanonicalPathKey("/users/test/replay.mp4", "darwin"));
    expect(replayMp4CanonicalPathKey("/Videos/Replay.MP4", "linux"))
      .not.toBe(replayMp4CanonicalPathKey("/videos/replay.mp4", "linux"));
    expect(replayMp4FileIdentityMatches({ dev: 4, ino: 42 }, { dev: 4, ino: 42 })).toBe(true);
    expect(replayMp4FileIdentityMatches({ dev: 4, ino: 42 }, { dev: 4, ino: 43 })).toBe(false);
    expect(replayMp4FileIdentityMatches({ dev: 0, ino: 0 }, { dev: 0, ino: 0 })).toBe(false);
  });

  it("uses tight asymmetric duration tolerances for short exports", () => {
    expect(replayMp4DurationTolerance(1_000)).toEqual({ earlyMs: 100, lateMs: 250 });
    expect(replayMp4DurationIsNearExpected(966, 1_000)).toBe(true);
    expect(replayMp4DurationIsNearExpected(899, 1_000)).toBe(false);

    expect(replayMp4DurationTolerance(5_000)).toEqual({ earlyMs: 100, lateMs: 250 });
    expect(replayMp4DurationIsNearExpected(4_966, 5_000)).toBe(true);
    expect(replayMp4DurationIsNearExpected(4_000, 5_000)).toBe(false);
    expect(replayMp4DurationIsNearExpected(1, 5_000)).toBe(false);
  });

  it("rejects material truncation in long exports while allowing modest container drift", () => {
    const expected = 49 * 60_000 + 5_000;
    expect(replayMp4DurationTolerance(expected)).toEqual({ earlyMs: 500, lateMs: 1_500 });
    expect(replayMp4DurationIsNearExpected(expected - 450, expected)).toBe(true);
    expect(replayMp4DurationIsNearExpected(expected + 1_000, expected)).toBe(true);
    expect(replayMp4DurationIsNearExpected(expected - 1_000, expected)).toBe(false);
    expect(replayMp4DurationIsNearExpected(expected - 5_000, expected)).toBe(false);
    expect(replayMp4DurationIsNearExpected(expected - 20_000, expected)).toBe(false);
    expect(replayMp4DurationIsNearExpected(expected - 29_000, expected)).toBe(false);
    expect(replayMp4DurationIsNearExpected(expected + 2_000, expected)).toBe(false);
  });

  it("rejects invalid actual and expected durations", () => {
    expect(replayMp4DurationIsNearExpected(0, 1_000)).toBe(false);
    expect(replayMp4DurationIsNearExpected(Number.NaN, 1_000)).toBe(false);
    expect(replayMp4DurationIsNearExpected(1_000, 0)).toBe(false);
    expect(replayMp4DurationIsNearExpected(1_000, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("parses machine-readable ffmpeg progress and clamps encoding progress", () => {
    expect(replayMp4ProgressTimeMs("out_time=00:01:02.500000")).toBe(62_500);
    expect(replayMp4ProgressTimeMs("frame=200")).toBeNull();
    expect(replayMp4EncodingPercent(0, 100_000)).toBe(5);
    expect(replayMp4EncodingPercent(50_000, 100_000)).toBe(48);
    expect(replayMp4EncodingPercent(200_000, 100_000)).toBe(90);
    expect(replayMp4ValidationPercent(0, 100_000)).toBe(92);
    expect(replayMp4ValidationPercent(50_000, 100_000)).toBe(95);
    expect(replayMp4ValidationPercent(200_000, 100_000)).toBe(98);
  });

  it("recognizes ordinary and tagged MP4 video-stream probe output", () => {
    expect(replayMp4ProbeHasVideo("Stream #0:0: Video: h264 (High), yuv420p")).toBe(true);
    expect(replayMp4ProbeHasVideo("Stream #0:0[0x1](und): Video: h264 (avc1), yuv420p")).toBe(true);
    expect(replayMp4ProbeHasVideo("Stream #0:1[0x2](und): Audio: aac")).toBe(false);
  });
});
