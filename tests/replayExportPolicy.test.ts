import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  estimatedStreamedReplayBundleBytes,
  MAX_IN_MEMORY_REPLAY_VIDEO_BYTES,
  MAX_LEGACY_REPLAY_BUNDLE_BYTES,
  MAX_LEGACY_REPLAY_VIDEO_BYTES,
  MAX_STREAMED_REPLAY_BUNDLE_BYTES,
  MAX_STREAMED_REPLAY_MANIFEST_BYTES,
  MAX_STREAMED_REPLAY_VIDEO_BYTES,
  replayMp4ExportTimeoutMs,
  shouldBufferReplayVideoInMemory
} from "../src/shared/replayExportPolicy";

const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const rendererSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");

describe("replay large-file export policy", () => {
  it("keeps whole-JSON imports bounded while allowing streamed v4 coaching packs", () => {
    expect(MAX_LEGACY_REPLAY_BUNDLE_BYTES).toBe(512 * 1024 * 1024);
    expect(MAX_LEGACY_REPLAY_VIDEO_BYTES).toBe(384 * 1024 * 1024);
    expect(MAX_STREAMED_REPLAY_VIDEO_BYTES).toBe(8 * 1024 * 1024 * 1024);
    expect(MAX_STREAMED_REPLAY_MANIFEST_BYTES).toBe(MAX_LEGACY_REPLAY_BUNDLE_BYTES);
    expect(MAX_STREAMED_REPLAY_BUNDLE_BYTES).toBeGreaterThan(
      estimatedStreamedReplayBundleBytes(MAX_STREAMED_REPLAY_MANIFEST_BYTES, MAX_STREAMED_REPLAY_VIDEO_BYTES)
    );
  });

  it("uses a duration-aware but bounded ffmpeg timeout", () => {
    expect(replayMp4ExportTimeoutMs(0)).toBe(15 * 60 * 1000);
    expect(replayMp4ExportTimeoutMs(30 * 60 * 1000)).toBe(95 * 60 * 1000);
    expect(replayMp4ExportTimeoutMs(24 * 60 * 60 * 1000)).toBe(6 * 60 * 60 * 1000);
  });

  it("only buffers small known video files through Electron IPC", () => {
    expect(shouldBufferReplayVideoInMemory(undefined)).toBe(false);
    expect(shouldBufferReplayVideoInMemory(0)).toBe(false);
    expect(shouldBufferReplayVideoInMemory(MAX_IN_MEMORY_REPLAY_VIDEO_BYTES)).toBe(true);
    expect(shouldBufferReplayVideoInMemory(MAX_IN_MEMORY_REPLAY_VIDEO_BYTES + 1)).toBe(false);
  });

  it("does not apply the coaching-pack size ceiling to MP4 source resolution", () => {
    const sourceStart = mainSource.indexOf("async function replayVideoExportSource(");
    const sourceEnd = mainSource.indexOf("async function writeReplayVideoBundleJson(", sourceStart);
    const sourceResolver = mainSource.slice(sourceStart, sourceEnd);
    expect(sourceResolver).not.toContain("MAX_STREAMED_REPLAY_VIDEO_BYTES");
    expect(mainSource).toContain("writeFileAsBase64Lines(stream, video.sourcePath, MAX_STREAMED_REPLAY_VIDEO_BYTES)");
    expect(mainSource).toContain("timeout: replayMp4ExportTimeoutMs(videoDurationSec * 1000)");
  });

  it("bounds streamed manifests and data lines independently of the total bundle", () => {
    expect(mainSource).toContain("streamedReplayBundleHeader(bundlePath)");
    expect(mainSource).toContain("MAX_STREAMED_REPLAY_MANIFEST_BYTES");
    expect(mainSource).toContain("MAX_REPLAY_STREAM_DATA_LINE_BYTES");
    expect(mainSource).toContain("bundleStats.size > MAX_LEGACY_REPLAY_BUNDLE_BYTES");
    expect(mainSource).toContain("bundleStats.size > MAX_STREAMED_REPLAY_BUNDLE_BYTES");
  });

  it("keeps large replay previews off the ArrayBuffer IPC path", () => {
    expect(rendererSource.match(/shouldBufferReplayVideoInMemory\(/g)).toHaveLength(2);
    expect(mainSource).toContain("videoStats.size > MAX_IN_MEMORY_REPLAY_VIDEO_BYTES");
  });
});
