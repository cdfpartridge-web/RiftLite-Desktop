import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  replayLocalFileCandidates,
  replayLocalFilePathAllowed,
  type ReplayLocalFileRoots
} from "../src/main/services/replayLocalFiles.js";
import type { ReplayRecord, ReplayScreenshotFrame } from "../src/shared/types.js";

function replay(overrides: Partial<ReplayRecord> = {}): ReplayRecord {
  return {
    id: "replay-1",
    matchId: "match-1",
    platform: "atlas",
    capturedAt: "2026-08-08T20:00:00.000Z",
    title: "Replay",
    players: { me: "Player", opponent: "Opponent" },
    events: [],
    ...overrides
  };
}

function roots(base: string): ReplayLocalFileRoots {
  return {
    video: [join(base, "Video")],
    "raw-capture": [join(base, "Raw Capture")],
    "replay-bundle": [base],
    frame: [join(base, "Timed Frames"), join(base, "Imported Frames")]
  };
}

describe("replay local files", () => {
  it("prefers the directly usable video, then raw capture, bundle, and frames", () => {
    const base = resolve("tmp", "replay-files");
    const videoPath = join(base, "Video", "match.webm");
    const rawPath = join(base, "Raw Capture", "match.json.gz");
    const bundlePath = join(base, "match.riftreplay");
    const framePath = join(base, "Timed Frames", "match.jpg");
    const candidates = replayLocalFileCandidates(replay({
      video: { path: videoPath } as ReplayRecord["video"],
      rawCapture: { localPath: rawPath } as ReplayRecord["rawCapture"],
      importedFrom: bundlePath,
      visualFrames: [{ path: framePath } as ReplayScreenshotFrame],
      structuredEvents: [{ screenshot: { path: framePath } } as NonNullable<ReplayRecord["structuredEvents"]>[number]]
    }));

    expect(candidates).toEqual([
      { kind: "video", path: videoPath },
      { kind: "raw-capture", path: rawPath },
      { kind: "replay-bundle", path: bundlePath },
      { kind: "frame", path: framePath }
    ]);
  });

  it("can request the exact Web Replay source instead of falling back to video", () => {
    const base = resolve("tmp", "replay-files");
    const rawPath = join(base, "Raw Capture", "match.json");
    expect(replayLocalFileCandidates(replay({
      video: { path: join(base, "Video", "match.mp4") } as ReplayRecord["video"],
      rawCapture: { localPath: rawPath } as ReplayRecord["rawCapture"]
    }), "raw-capture")).toEqual([{ kind: "raw-capture", path: rawPath }]);
  });

  it("accepts only absolute supported files inside the roots for their asset kind", () => {
    const base = resolve("tmp", "replay-files");
    const allowedRoots = roots(base);

    expect(replayLocalFilePathAllowed(
      { kind: "video", path: join(base, "Video", "match.mp4") },
      allowedRoots
    )).toBe(true);
    expect(replayLocalFilePathAllowed(
      { kind: "raw-capture", path: join(base, "Raw Capture", "match.json.gz") },
      allowedRoots
    )).toBe(true);
    expect(replayLocalFilePathAllowed(
      { kind: "video", path: join(base, "Raw Capture", "match.mp4") },
      allowedRoots
    )).toBe(false);
    expect(replayLocalFilePathAllowed(
      { kind: "video", path: join(base, "..", "outside.mp4") },
      allowedRoots
    )).toBe(false);
    expect(replayLocalFilePathAllowed(
      { kind: "video", path: "relative-match.mp4" },
      allowedRoots
    )).toBe(false);
    expect(replayLocalFilePathAllowed(
      { kind: "video", path: join(base, "Video", "not-video.exe") },
      allowedRoots
    )).toBe(false);
  });
});
