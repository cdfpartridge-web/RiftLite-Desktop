import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReplayMp4VideoTimeline, replayMp4VideoTimelineArgs } from "../src/main/services/replayMp4VideoTimeline.js";
import { replayMp4DurationIsNearExpected, replayMp4ProgressTimeMs } from "../src/main/services/replayMp4ExportSafety.js";

const require = createRequire(import.meta.url);
const ffmpegPath: string = require("ffmpeg-static");
const exec = promisify(execFile);
let directory = "";
let sourcePath = "";

async function ffmpeg(args: string[]) {
  return exec(ffmpegPath, ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", ...args], {
    windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8"
  });
}

async function videoDuration(filePath: string): Promise<number> {
  const { stdout } = await ffmpeg(replayMp4VideoTimelineArgs(filePath));
  const timeline = new ReplayMp4VideoTimeline();
  for (const line of stdout.split(/\r?\n/)) timeline.consumeLine(line);
  return timeline.durationMs;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "riftlite-mp4-timeline-"));
  sourcePath = join(directory, "43s-h264.mp4");
  await ffmpeg(["-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=43", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", sourcePath]);
}, 40_000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("duration scans with bundled FFmpeg", () => {
  it("reproduces the reported 42.88s rejection and correctly measures the complete 43s H.264 file", async () => {
    const { stdout } = await ffmpeg(["-progress", "pipe:1", "-nostats", "-fflags", "+genpts", "-i", sourcePath, "-map", "0:v:0", "-c", "copy", "-f", "null", "-"]);
    const oldDuration = Math.max(...stdout.split(/\r?\n/).map((line) => replayMp4ProgressTimeMs(line) ?? 0));
    expect(oldDuration).toBe(42_875);
    expect(replayMp4DurationIsNearExpected(oldDuration, 43_000)).toBe(false);
    const actual = await videoDuration(sourcePath);
    expect(actual).toBe(43_000);
    expect(replayMp4DurationIsNearExpected(actual, 43_000)).toBe(true);
    // Keep the exporter's independent complete-video/audio decode check.
    await ffmpeg(["-xerror", "-err_detect", "explode", "-i", sourcePath, "-map", "0:v:0", "-map", "0:a?", "-f", "null", "-"]);
  });

  it("still rejects a decodable MP4 missing one second of the requested clip", async () => {
    const clipped = join(directory, "shortened.mp4");
    await ffmpeg(["-i", sourcePath, "-t", "42", "-c:v", "libx264", "-preset", "veryfast", clipped]);
    expect(await videoDuration(clipped)).toBe(42_000);
    expect(replayMp4DurationIsNearExpected(await videoDuration(clipped), 43_000)).toBe(false);
  });

  it.each([1, 12, 30, 60, "24000/1001"])("counts the final displayed frame at %s fps", async (fps) => {
    const video = join(directory, `rate-${String(fps).replace("/", "-")}.mp4`);
    await ffmpeg(["-f", "lavfi", "-i", `color=s=320x180:r=${fps}:d=1`, "-c:v", "libx264", "-preset", "veryfast", video]);
    const duration = await videoDuration(video);
    expect(duration).toBe(fps === "24000/1001" ? 1001 : 1000);
    expect(replayMp4DurationIsNearExpected(duration, 1000)).toBe(true);
  });

  it("scans a streaming WebM without a container duration and validates its Full Voiceover conversion", async () => {
    const video = join(directory, "streaming.webm");
    await ffmpeg(["-f", "lavfi", "-i", "color=s=320x180:r=24:d=3", "-c:v", "libvpx", "-deadline", "realtime", "-live", "1", video]);
    const expectedDuration = await videoDuration(video);
    expect(expectedDuration).toBe(2999);
    const converted = join(directory, "voiceover.mp4");
    await ffmpeg(["-fflags", "+genpts", "-i", video, "-map", "0:v:0", "-map", "0:a?", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1", "-c:v", "libx264", "-preset", "superfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-t", String(expectedDuration / 1000), converted]);
    expect(replayMp4DurationIsNearExpected(await videoDuration(converted), expectedDuration)).toBe(true);
  });

  it("does not mistake a longer audio track for video duration", async () => {
    const video = join(directory, "audio-tail.mp4");
    await ffmpeg(["-f", "lavfi", "-i", "color=s=320x180:r=24:d=3", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=5", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", video]);
    await expect(videoDuration(video)).resolves.toBe(3000);
  });

  it("measures a cut made between frame boundaries within the unchanged tolerance", async () => {
    const video = join(directory, "off-grid-clip.mp4");
    await ffmpeg(["-i", sourcePath, "-vf", "trim=start=0.013:end=3.013,setpts=PTS-STARTPTS,fps=24,setsar=1", "-c:v", "libx264", "-preset", "veryfast", "-t", "3", video]);
    expect(replayMp4DurationIsNearExpected(await videoDuration(video), 3000)).toBe(true);
  });
});
