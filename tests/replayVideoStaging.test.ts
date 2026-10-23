import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const operations = vi.hoisted(() => ({ link: vi.fn(), copyFile: vi.fn(), unlink: vi.fn(), lstat: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  ...operations
}));
const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
import {
  createStagedReplayVideo, publishStagedReplayVideo,
  replayVideoPublicationMarkerPath, verifiedPublishedReplayVideoPath,
  discardPublishedReplayVideoSources, replayVideoDiscardMarkerPath, isDiscardedStagedReplayVideo
} from "../src/main/services/replayVideoStaging.js";
import { interruptedReplayVideoCandidates, writeReplayVideoRecoverySidecar } from "../src/main/services/replayVideoCrashRecovery.js";

const directories: string[] = [];
beforeEach(() => {
  operations.link.mockReset().mockImplementation(fs.link);
  operations.copyFile.mockReset().mockImplementation(fs.copyFile);
  operations.unlink.mockReset().mockImplementation(fs.unlink);
  operations.lstat.mockReset().mockImplementation(fs.lstat);
});
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function failure(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`Synthetic ${code}`), { code });
}

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "riftlite-video-staging-"));
  directories.push(root);
  const stagingDirectory = join(root, "local-app-data");
  const destinationDirectory = join(root, "chosen-replay-folder");
  const filename = "RiftLite_atlas-youtube-fixture_2026-10-22_12-00-00.webm";
  const staged = await createStagedReplayVideo(stagingDirectory, destinationDirectory, filename);
  return { ...staged, root, stagingDirectory, destinationDirectory, filename };
}

describe("local recording staging", () => {
  it("keeps every growing chunk outside the chosen folder and publishes only complete ordered bytes", async () => {
    const f = await fixture();
    for (let i = 0; i < 12; i++) {
      await fs.appendFile(f.stagingPath, Buffer.alloc(4096, i));
      await expect(fs.access(f.destinationDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    }
    const expected = await fs.readFile(f.stagingPath);
    const published = await publishStagedReplayVideo(f.stagingPath, f.destinationPath);
    expect(published).toEqual({ path: f.destinationPath, sourceRetained: false });
    expect(await fs.readFile(f.destinationPath)).toEqual(expected);
    await expect(fs.access(f.stagingPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(replayVideoPublicationMarkerPath(f.stagingPath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readdir(f.destinationDirectory)).toEqual([f.filename]);
  });

  it("gives simultaneous captures distinct staging paths without touching the replay folder", async () => {
    const f = await fixture();
    const another = await createStagedReplayVideo(f.stagingDirectory, f.destinationDirectory, f.filename);
    expect(another.stagingPath).not.toBe(f.stagingPath);
    expect(another.destinationPath).toBe(f.destinationPath);
    expect(await fs.readdir(f.stagingDirectory)).toHaveLength(2);
    await expect(fs.access(f.destinationDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite an existing destination and leaves the staged recording recoverable", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, "new recording");
    await fs.mkdir(f.destinationDirectory);
    await fs.writeFile(f.destinationPath, "existing recording");
    await expect(publishStagedReplayVideo(f.stagingPath, f.destinationPath)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(f.stagingPath, "utf8")).toBe("new recording");
    expect(await fs.readFile(f.destinationPath, "utf8")).toBe("existing recording");
    expect(operations.copyFile).not.toHaveBeenCalled();
  });

  it("copies across volumes before making the final filename visible", async () => {
    const f = await fixture();
    const bytes = Buffer.alloc(128 * 1024, 7);
    await fs.writeFile(f.stagingPath, bytes);
    operations.link.mockRejectedValueOnce(failure("EXDEV"));
    operations.copyFile.mockImplementationOnce(async (source, destination, mode) => {
      expect(source).toBe(f.stagingPath);
      expect(mode).toBe(constants.COPYFILE_EXCL);
      expect(destination).not.toBe(f.destinationPath);
      await expect(fs.access(f.destinationPath)).rejects.toMatchObject({ code: "ENOENT" });
      await fs.copyFile(source, destination, mode);
      await expect(fs.access(f.destinationPath)).rejects.toMatchObject({ code: "ENOENT" });
    });
    await expect(publishStagedReplayVideo(f.stagingPath, f.destinationPath)).resolves.toEqual({ path: f.destinationPath, sourceRetained: false });
    expect(await fs.readFile(f.destinationPath)).toEqual(bytes);
    expect(await fs.readdir(f.destinationDirectory)).toEqual([f.filename]);
  });

  it("preserves a destination created by a racing process during cross-volume copy", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, "new recording");
    operations.link.mockRejectedValueOnce(failure("EXDEV"));
    operations.copyFile.mockImplementationOnce(async (source, destination, mode) => {
      await fs.copyFile(source, destination, mode);
      await fs.writeFile(f.destinationPath, "racing recording", { flag: "wx" });
    });
    await expect(publishStagedReplayVideo(f.stagingPath, f.destinationPath)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(f.destinationPath, "utf8")).toBe("racing recording");
    expect(await fs.readFile(f.stagingPath, "utf8")).toBe("new recording");
    expect(await fs.readdir(f.destinationDirectory)).toEqual([f.filename]);
  });

  it("retains source and removes a partial destination copy when storage fills", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, "whole recording");
    operations.link.mockRejectedValueOnce(failure("EXDEV"));
    operations.copyFile.mockImplementationOnce(async (_source, destination) => {
      await fs.writeFile(destination, "partial");
      throw failure("ENOSPC");
    });
    await expect(publishStagedReplayVideo(f.stagingPath, f.destinationPath)).rejects.toMatchObject({ code: "ENOSPC" });
    expect(await fs.readFile(f.stagingPath, "utf8")).toBe("whole recording");
    expect(await fs.readdir(f.destinationDirectory)).toEqual([]);
  });

  it("rejects publication if recording resumes during a cross-volume copy", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, "opening");
    operations.link.mockRejectedValueOnce(failure("EXDEV"));
    operations.copyFile.mockImplementationOnce(async (source, destination, mode) => {
      await fs.copyFile(source, destination, mode);
      await fs.appendFile(source, " ending");
    });
    await expect(publishStagedReplayVideo(f.stagingPath, f.destinationPath)).rejects.toThrow("changed during publication");
    expect(await fs.readFile(f.stagingPath, "utf8")).toBe("opening ending");
    expect(await fs.readdir(f.destinationDirectory)).toEqual([]);
  });

  it("retains recording when the destination filesystem cannot publish hard links", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, "recoverable recording");
    operations.link.mockRejectedValue(failure("ENOTSUP"));
    await expect(publishStagedReplayVideo(f.stagingPath, f.destinationPath)).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(await fs.readFile(f.stagingPath, "utf8")).toBe("recoverable recording");
    expect(await fs.readdir(f.destinationDirectory)).toEqual([]);
  });

  it("never removes an existing file when a temporary-name collision is reported", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, "new recording");
    operations.link.mockRejectedValueOnce(failure("EXDEV"));
    let existingTemporaryPath = "";
    operations.copyFile.mockImplementationOnce(async (_source, destination) => {
      existingTemporaryPath = destination;
      await fs.writeFile(destination, "someone else's file", { flag: "wx" });
      throw failure("EEXIST");
    });
    await expect(publishStagedReplayVideo(f.stagingPath, f.destinationPath)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(existingTemporaryPath, "utf8")).toBe("someone else's file");
    expect(await fs.readFile(f.stagingPath, "utf8")).toBe("new recording");
  });

  it("reports successful publication even if original cleanup is denied", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, "complete recording");
    operations.unlink.mockRejectedValueOnce(failure("EPERM"));
    await expect(publishStagedReplayVideo(f.stagingPath, f.destinationPath)).resolves.toEqual({ path: f.destinationPath, sourceRetained: true });
    expect(await fs.readFile(f.destinationPath)).toEqual(await fs.readFile(f.stagingPath));
  });

  it("writes its recovery marker before the completed filename becomes visible", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, "complete recording");
    operations.link.mockImplementationOnce(async (source, destination) => {
      const marker = JSON.parse(await fs.readFile(replayVideoPublicationMarkerPath(f.stagingPath), "utf8"));
      expect(marker.destinationPath).toBe(destination);
      expect(marker.sourceIdentity.inode).not.toBe("0");
      await expect(fs.access(destination)).rejects.toMatchObject({ code: "ENOENT" });
      await fs.link(source, destination);
    });
    await publishStagedReplayVideo(f.stagingPath, f.destinationPath);
  });

  it.each([false, true])("recovers only the verified published recording if source deletion failed (cross volume: %s)", async (crossVolume) => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, Buffer.alloc(64 * 1024, 7));
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(f.stagingPath, old, old);
    if (crossVolume) operations.link.mockRejectedValueOnce(failure("EXDEV"));
    operations.unlink.mockImplementation(async (filePath) => {
      if (filePath === f.stagingPath) throw failure("EPERM");
      await fs.unlink(filePath);
    });
    const published = await publishStagedReplayVideo(f.stagingPath, f.destinationPath);
    expect(published.sourceRetained).toBe(true);
    await expect(verifiedPublishedReplayVideoPath(f.stagingPath)).resolves.toBe(f.destinationPath);
    await expect(interruptedReplayVideoCandidates(f.stagingDirectory, [])).resolves.toEqual([f.destinationPath]);
    await expect(interruptedReplayVideoCandidates(f.stagingDirectory, [f.destinationPath])).resolves.toEqual([]);
  });

  it("never hides staged media when a published destination was subsequently replaced", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, Buffer.alloc(64 * 1024, 7));
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(f.stagingPath, old, old);
    operations.unlink.mockRejectedValueOnce(failure("EPERM"));
    await publishStagedReplayVideo(f.stagingPath, f.destinationPath);
    await fs.unlink(f.destinationPath);
    await fs.writeFile(f.destinationPath, Buffer.alloc(64 * 1024, 7));
    await fs.utimes(f.destinationPath, new Date(), new Date());
    await expect(verifiedPublishedReplayVideoPath(f.stagingPath)).resolves.toBeNull();
    await expect(interruptedReplayVideoCandidates(f.stagingDirectory, [f.destinationPath])).resolves.toEqual([f.stagingPath]);
  });

  it("clears its publication hint on a collision without changing existing media", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, Buffer.alloc(64 * 1024, 1));
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(f.stagingPath, old, old);
    await fs.mkdir(f.destinationDirectory);
    await fs.writeFile(f.destinationPath, Buffer.alloc(64 * 1024, 2));
    await expect(publishStagedReplayVideo(f.stagingPath, f.destinationPath)).rejects.toMatchObject({ code: "EEXIST" });
    await expect(fs.access(replayVideoPublicationMarkerPath(f.stagingPath))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(interruptedReplayVideoCandidates(f.stagingDirectory, [f.destinationPath])).resolves.toEqual([f.stagingPath]);
  });

  it("keeps source recoverable when both publication and marker cleanup fail", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, Buffer.alloc(64 * 1024, 1));
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(f.stagingPath, old, old);
    operations.link.mockRejectedValueOnce(failure("EIO"));
    operations.unlink.mockRejectedValueOnce(failure("EPERM"));
    await expect(publishStagedReplayVideo(f.stagingPath, f.destinationPath)).rejects.toMatchObject({ code: "EIO" });
    await expect(fs.access(replayVideoPublicationMarkerPath(f.stagingPath))).resolves.toBeUndefined();
    await expect(verifiedPublishedReplayVideoPath(f.stagingPath)).resolves.toBeNull();
    await expect(interruptedReplayVideoCandidates(f.stagingDirectory, [])).resolves.toEqual([f.stagingPath]);
  });

  it("does not resurrect a locked retained source after its published recording is discarded", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, Buffer.alloc(64 * 1024, 1));
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(f.stagingPath, old, old);
    operations.unlink.mockImplementation(async (filePath) => {
      if (filePath === f.stagingPath) throw failure("EPERM");
      await fs.unlink(filePath);
    });
    await publishStagedReplayVideo(f.stagingPath, f.destinationPath);
    await expect(discardPublishedReplayVideoSources(f.stagingDirectory, f.destinationPath)).resolves.toBe(1);
    await expect(isDiscardedStagedReplayVideo(f.stagingPath)).resolves.toBe(true);
    await fs.unlink(f.destinationPath);
    // This scanner only reads disk, so this is also the next-launch behavior.
    await expect(interruptedReplayVideoCandidates(f.stagingDirectory, [])).resolves.toEqual([]);
    expect((await fs.stat(f.stagingPath)).size).toBe(64 * 1024);
    expect(JSON.parse(await fs.readFile(replayVideoDiscardMarkerPath(f.stagingPath), "utf8")).version).toBe(1);
  });

  it("keeps a new recording at a discarded staging path eligible for recovery", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, Buffer.alloc(64 * 1024, 1));
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(f.stagingPath, old, old);
    operations.unlink.mockImplementation(async (filePath) => {
      if (filePath === f.stagingPath) throw failure("EPERM");
      await fs.unlink(filePath);
    });
    await publishStagedReplayVideo(f.stagingPath, f.destinationPath);
    await discardPublishedReplayVideoSources(f.stagingDirectory, f.destinationPath);
    await fs.unlink(f.destinationPath);
    await fs.unlink(f.stagingPath);
    await fs.writeFile(f.stagingPath, Buffer.alloc(64 * 1024, 2));
    await fs.utimes(f.stagingPath, old, new Date(old.getTime() - 1_000));
    await expect(isDiscardedStagedReplayVideo(f.stagingPath)).resolves.toBe(false);
    await expect(interruptedReplayVideoCandidates(f.stagingDirectory, [])).resolves.toEqual([f.stagingPath]);
  });

  it("never discards source using an unrelated or replaced destination", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, Buffer.alloc(64 * 1024, 1));
    operations.unlink.mockRejectedValueOnce(failure("EPERM"));
    await publishStagedReplayVideo(f.stagingPath, f.destinationPath);
    await fs.unlink(f.destinationPath);
    await fs.writeFile(f.destinationPath, "unrelated replacement");
    await expect(discardPublishedReplayVideoSources(f.stagingDirectory, f.destinationPath)).resolves.toBe(0);
    expect((await fs.stat(f.stagingPath)).size).toBe(64 * 1024);
    await expect(fs.access(replayVideoDiscardMarkerPath(f.stagingPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("propagates discard marker failure before removing source or destination", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, "complete recording");
    operations.unlink.mockRejectedValueOnce(failure("EPERM"));
    await publishStagedReplayVideo(f.stagingPath, f.destinationPath);
    await fs.writeFile(replayVideoDiscardMarkerPath(f.stagingPath), "unrelated existing marker");
    await expect(discardPublishedReplayVideoSources(f.stagingDirectory, f.destinationPath)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(f.stagingPath, "utf8")).toBe("complete recording");
    expect(await fs.readFile(f.destinationPath, "utf8")).toBe("complete recording");
  });

  it("does not bind discard intent to a source replaced after publication verification", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, "original recording");
    operations.unlink.mockRejectedValueOnce(failure("EPERM"));
    await publishStagedReplayVideo(f.stagingPath, f.destinationPath);
    let sourceReads = 0;
    operations.lstat.mockImplementation(async (filePath, options) => {
      if (filePath === f.stagingPath && ++sourceReads === 2) {
        await fs.unlink(f.stagingPath);
        await fs.writeFile(f.stagingPath, "unrelated new recording");
      }
      return fs.lstat(filePath, options);
    });
    await expect(discardPublishedReplayVideoSources(f.stagingDirectory, f.destinationPath)).resolves.toBe(0);
    expect(await fs.readFile(f.stagingPath, "utf8")).toBe("unrelated new recording");
    expect(await fs.readFile(f.destinationPath, "utf8")).toBe("original recording");
    await expect(fs.access(replayVideoDiscardMarkerPath(f.stagingPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes a verified retained source and its own markers when it is no longer locked", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, "complete recording");
    operations.unlink.mockRejectedValueOnce(failure("EPERM"));
    await publishStagedReplayVideo(f.stagingPath, f.destinationPath);
    await expect(discardPublishedReplayVideoSources(f.stagingDirectory, f.destinationPath)).resolves.toBe(1);
    expect(await fs.readdir(f.stagingDirectory)).toEqual([]);
    // The caller still owns final-file deletion after intent has been saved.
    expect(await fs.readFile(f.destinationPath, "utf8")).toBe("complete recording");
  });

  it("keeps interrupted staged media discoverable using the existing recovery scanner", async () => {
    const f = await fixture();
    await fs.writeFile(f.stagingPath, Buffer.alloc(64 * 1024, 1));
    const startedAt = "2026-10-22T12:00:00.000Z";
    await writeReplayVideoRecoverySidecar(f.stagingPath, {
      version: 1, session: { id: "fixture", path: f.stagingPath, url: "file:///fixture", filename: basename(f.stagingPath), directory: f.stagingDirectory, startedAt },
      platform: "atlas", quality: "youtube", mimeType: "video/webm", title: "fixture", createdAt: startedAt
    });
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(f.stagingPath, old, old);
    await expect(interruptedReplayVideoCandidates(f.stagingDirectory, [])).resolves.toEqual([f.stagingPath]);
    await expect(interruptedReplayVideoCandidates(f.stagingDirectory, [f.stagingPath])).resolves.toEqual([]);
  });

  it("rejects traversal names, relative directories and empty media", async () => {
    const f = await fixture();
    for (const name of ["../outside.webm", "..\\outside.webm", "", "recording.exe"]) {
      await expect(createStagedReplayVideo(f.stagingDirectory, f.destinationDirectory, name)).rejects.toThrow("filename");
    }
    await expect(createStagedReplayVideo("relative", f.destinationDirectory, f.filename)).rejects.toThrow("absolute");
    await expect(publishStagedReplayVideo(f.stagingPath, f.destinationPath)).rejects.toThrow("empty");
    await expect(publishStagedReplayVideo(f.stagingPath, f.stagingPath)).rejects.toThrow("paths");
  });
});
