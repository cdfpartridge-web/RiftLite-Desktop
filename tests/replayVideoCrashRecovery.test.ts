import { readFileSync } from "node:fs";
import { access, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clearReplayVideoRecoverySidecar,
  interruptedReplayVideoCandidates,
  replayVideoRecoverySidecarPath,
  writeReplayVideoRecoverySidecar
} from "../src/main/services/replayVideoCrashRecovery.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("crash-safe replay video recovery", () => {
  it("keeps a sidecar until attachment and automatically imports interrupted recordings on launch", () => {
    const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
    const rendererSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");

    expect(mainSource).toContain("writeReplayVideoRecoverySidecar(filePath");
    expect(mainSource).toContain("clearReplayVideoRecoverySidecar(video.path)");
    expect(mainSource).toContain("recoverInterruptedReplayVideosOnStartup()");
    expect(rendererSource).toContain("installReplayVideoFailureGuard(runtime)");
    expect(rendererSource).toContain('stopForFailure("source-track-ended"');
    expect(rendererSource).toContain('retainForLater: true, reason');
  });

  it("finds an old unreferenced RiftLite recording and ignores known or unrelated media", async () => {
    const directory = await temporaryDirectory();
    const orphan = join(directory, "RiftLite_atlas-sharp-atlas-game_2026-08-03_10-00-00.webm");
    const known = join(directory, "RiftLite_atlas-balanced-known_2026-08-03_10-01-00.webm");
    const unrelated = join(directory, "holiday.webm");
    await Promise.all([
      writeFile(orphan, Buffer.alloc(64 * 1024, 1)),
      writeFile(known, Buffer.alloc(64 * 1024, 2)),
      writeFile(unrelated, Buffer.alloc(64 * 1024, 3))
    ]);
    const old = new Date(Date.now() - 60_000);
    await Promise.all([utimes(orphan, old, old), utimes(known, old, old), utimes(unrelated, old, old)]);

    await expect(interruptedReplayVideoCandidates(directory, [known])).resolves.toEqual([orphan]);
  });

  it("uses the recording sidecar to recover a future filename and clears it after ownership transfers", async () => {
    const directory = await temporaryDirectory();
    const videoPath = join(directory, "future-recorder-name.webm");
    await writeFile(videoPath, Buffer.alloc(64 * 1024, 1));
    const old = new Date(Date.now() - 60_000);
    await utimes(videoPath, old, old);
    await writeReplayVideoRecoverySidecar(videoPath, {
      version: 1,
      session: {
        id: "video-1",
        path: videoPath,
        url: "file:///future-recorder-name.webm",
        filename: "future-recorder-name.webm",
        directory,
        startedAt: "2026-08-03T10:00:00.000Z"
      },
      platform: "atlas",
      quality: "sharp",
      mimeType: "video/webm",
      title: "Atlas recovery test",
      createdAt: "2026-08-03T10:00:00.000Z"
    });

    await expect(interruptedReplayVideoCandidates(directory, [])).resolves.toEqual([videoPath]);
    await clearReplayVideoRecoverySidecar(videoPath);
    await expect(interruptedReplayVideoCandidates(directory, [])).resolves.toEqual([]);
    await expect(access(replayVideoRecoverySidecarPath(videoPath))).rejects.toThrow();
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "riftlite-video-recovery-"));
  temporaryDirectories.push(directory);
  return directory;
}
