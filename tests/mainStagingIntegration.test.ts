import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayRecord, ReplayVideoAsset, ReplayVideoFinalizeOptions, ReplayVideoSession, ReplayVideoStartOptions } from "../src/shared/types.js";
import {
  isReplayMediaFilename, matchingMissingReplayIdForMedia, replayMediaCapturedAt,
  replayMediaDurationMsFromFfmpegOutput, replayMediaMimeType, replayMediaPlatform
} from "../src/shared/replayMediaRecovery.js";

const fileFaults = vi.hoisted(() => ({ blockedUnlink: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    unlink: (file: string) => file === fileFaults.blockedUnlink
      ? Promise.reject(Object.assign(new Error("Synthetic locked recording"), { code: "EPERM" }))
      : actual.unlink(file)
  };
});
import * as fs from "node:fs/promises";
import {
  createStagedReplayVideo, discardPublishedReplayVideoSources, publishStagedReplayVideo,
  replayVideoDiscardMarkerPath, replayVideoPublicationMarkerPath
} from "../src/main/services/replayVideoStaging.js";
import {
  clearReplayVideoRecoverySidecar, interruptedReplayVideoCandidates,
  replayVideoRecoverySidecarPath, writeReplayVideoRecoverySidecar
} from "../src/main/services/replayVideoCrashRecovery.js";

// Exercise the actual IPC callback bodies and their path policy, without
// starting Electron or reading a user profile. Media finalization/probing,
// publication and recovery use production code and real isolated files.
const source = ts.createSourceFile("main.ts", readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const names = [
  "defaultScreenshotDirectory", "screenshotDirectory", "defaultReplayDirectory", "replayDirectory", "replayBundleDirectory",
  "legacyReplayVideoDirectory", "replayVideoDirectory", "replayVideoStagingDirectory", "replayVideoImportDirectory",
  "screenshotFilename", "replayVideoExtension", "pathExists", "replayLocalFileRoots",
  "replayVideoSeekableMarkerPath", "markReplayVideoSeekable", "replayVideoFfmpegPath", "makeReplayVideoSeekable",
  "replayVideoDecodeProbe", "validateReplayVideoReadable", "actualReplayBitrateKbps", "pathInside", "replayVideoPathAllowed",
  "startReplayVideoCaptureFile", "appendReplayVideoChunk", "finishReplayVideoCaptureFile", "safeFileComponent",
  "probeRecoveredReplayVideo", "importReplayMediaFromPath", "recoverInterruptedReplayVideosOnStartup", "discardReplayVideoAsset"
];
const declarations = source.statements.filter((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && Boolean(node.name && names.includes(node.name.text))
);
if (declarations.length !== names.length) throw new Error("Missing production replay recording functions");
const compiled = ts.transpileModule(declarations.map((node) => node.getText(source)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const ffmpegStaticPath: string = createRequire(import.meta.url)("ffmpeg-static");
const execFileAsync = promisify(execFile);
let directory = "";
const samples = new Map<string, Buffer>();

beforeAll(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "riftlite-main-staging-"));
  for (const extension of ["webm", "mp4"]) {
    const output = join(directory, `synthetic.${extension}`);
    await execFileAsync(ffmpegStaticPath, [
      "-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=256x144:rate=24:duration=3",
      "-an", "-threads", "1", ...(extension === "webm"
        ? ["-c:v", "libvpx", "-deadline", "realtime", "-b:v", "2M", "-live", "1"]
        : ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "16", "-movflags", "+frag_keyframe+empty_moov"]), output
    ], { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
    const bytes = await fs.readFile(output);
    expect(bytes.length).toBeGreaterThan(32 * 1024);
    samples.set(extension, bytes);
  }
}, 40_000);
beforeEach(() => { fileFaults.blockedUnlink = ""; });
afterAll(async () => {
  fileFaults.blockedUnlink = "";
  if (!directory) return;
  // Only remove the exact isolated directory returned by mkdtemp above.
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("riftlite-main-staging-")) {
    throw new Error("Unexpected integration fixture cleanup path");
  }
  await fs.rm(directory, { recursive: true, force: true });
});

async function harness() {
  const root = await fs.mkdtemp(join(directory, "case-"));
  const userData = join(root, "app-data");
  const settings = { replayDirectory: join(root, "chosen-replays") };
  const sessions = new Map<string, ReplayVideoSession & { destinationPath: string }>();
  const savedReplays: ReplayRecord[] = [];
  const environment = {
    access: fs.access, appendFile: fs.appendFile, stat: fs.stat, unlink: fs.unlink,
    writeFile: fs.writeFile, rename: fs.rename, mkdir: fs.mkdir, copyFile: fs.copyFile,
    basename, dirname, isAbsolute, join, relative, resolve, pathToFileURL, randomUUID,
    app: { isPackaged: false, getPath: (key: string) => key === "userData" ? userData : join(root, key) },
    store: { getSettings: async () => settings, getReplays: async () => savedReplays, getDeletedReplays: async () => [] },
    RIFTLITE_BUILD_IDENTITY: { mediaDirectoryName: "RiftLite Fixture" },
    replayVideoSessions: sessions, ffmpegStaticPath, execFileAsync,
    createStagedReplayVideo, publishStagedReplayVideo, writeReplayVideoRecoverySidecar, clearReplayVideoRecoverySidecar,
    discardPublishedReplayVideoSources, replayVideoDiscardMarkerPath, replayVideoPublicationMarkerPath,
    interruptedReplayVideoCandidates, isReplayMediaFilename, matchingMissingReplayIdForMedia, replayMediaCapturedAt,
    replayMediaDurationMsFromFfmpegOutput, replayMediaMimeType, replayMediaPlatform, mainWindow: null,
    saveReplayWithEnhancedInsightsDataMutation: async (replay: ReplayRecord) => { savedReplays.push(replay); return replay; },
    diagnostics: { record: vi.fn().mockResolvedValue(undefined) }, logStartupIssue: vi.fn().mockResolvedValue(undefined),
    console: { warn: vi.fn() }
  };
  const api = new Function(...Object.keys(environment), `${compiled}\nreturn {${names.join(",")}};`)(...Object.values(environment)) as {
    startReplayVideoCaptureFile(options: ReplayVideoStartOptions): Promise<ReplayVideoSession>;
    appendReplayVideoChunk(id: string, data: Uint8Array): Promise<void>;
    finishReplayVideoCaptureFile(id: string, options: ReplayVideoFinalizeOptions): Promise<ReplayVideoAsset>;
    replayVideoPathAllowed(path: string): Promise<boolean>;
    replayLocalFileRoots(settings: object, replay: object): { video: string[] };
    replayVideoDecodeProbe(path: string): Promise<boolean>;
    recoverInterruptedReplayVideosOnStartup(): Promise<number>;
    discardReplayVideoAsset(asset: ReplayVideoAsset): Promise<void>;
  };
  return { ...api, ...environment, root, userData, settings, sessions, savedReplays };
}

function startOptions(extension = "webm"): ReplayVideoStartOptions {
  return { platform: "atlas", quality: "youtube", title: "Synthetic integration fixture", mimeType: extension === "mp4" ? "video/mp4" : "video/webm" };
}
function finishOptions(session: ReplayVideoSession, extension = "webm"): ReplayVideoFinalizeOptions {
  return {
    platform: "atlas", quality: "youtube", source: "game-frame-direct", startedAt: session.startedAt,
    endedAt: new Date().toISOString(), durationMs: 3000, width: 256, height: 144, fps: 24,
    captureIntervalMs: 0, bitrateKbps: 2000, codec: extension === "mp4" ? "H.264" : "VP8", hasAudio: false,
    mimeType: extension === "mp4" ? "video/mp4" : "video/webm"
  };
}
async function appendSample(h: Awaited<ReturnType<typeof harness>>, session: ReplayVideoSession, extension = "webm") {
  const bytes = samples.get(extension)!;
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    await h.appendReplayVideoChunk(session.id, bytes.subarray(offset, offset + 8192));
  }
}

describe("main recorder local staging integration", () => {
  it.each(["webm", "mp4"])("keeps live %s chunks local and publishes a fully decodable asset", async (extension) => {
    const h = await harness();
    const session = await h.startReplayVideoCaptureFile(startOptions(extension));
    const destination = h.sessions.get(session.id)!.destinationPath;
    expect(dirname(session.path)).toBe(join(h.userData, "Replay Video Staging"));
    await appendSample(h, session, extension);
    await expect(fs.access(dirname(destination))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(session.path)).toEqual(samples.get(extension));
    expect(JSON.parse(await fs.readFile(replayVideoRecoverySidecarPath(session.path), "utf8")).session.path).toBe(session.path);
    const asset = await h.finishReplayVideoCaptureFile(session.id, finishOptions(session, extension));
    expect(asset.path).toBe(destination);
    expect(asset.url).toBe(pathToFileURL(destination).href);
    expect(asset.containerFinalized).toBe(true);
    expect(asset.sizeBytes).toBe((await fs.stat(destination)).size);
    await expect(h.replayVideoDecodeProbe(destination)).resolves.toBe(true);
    await expect(fs.access(session.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(replayVideoRecoverySidecarPath(session.path))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(h.appendReplayVideoChunk(session.id, Buffer.from([1]))).rejects.toThrow("no longer active");
    await expect(interruptedReplayVideoCandidates(dirname(destination), [], Date.now() + 60_000)).resolves.toEqual([destination]);
  }, 15_000);

  it("keeps a playable recoverable local recording when its chosen destination becomes unavailable", async () => {
    const h = await harness();
    const session = await h.startReplayVideoCaptureFile(startOptions());
    await appendSample(h, session);
    await fs.writeFile(h.settings.replayDirectory, "Synthetic unavailable directory");
    const asset = await h.finishReplayVideoCaptureFile(session.id, finishOptions(session));
    expect(asset.path).toBe(session.path);
    expect(asset.containerFinalized).toBe(true);
    await expect(h.replayVideoDecodeProbe(asset.path)).resolves.toBe(true);
    await expect(fs.access(replayVideoRecoverySidecarPath(session.path))).resolves.toBeUndefined();
    await expect(interruptedReplayVideoCandidates(session.directory, [], Date.now() + 60_000)).resolves.toEqual([session.path]);
    expect(h.logStartupIssue).toHaveBeenCalledWith("replay video retained in local recording storage", expect.any(Error));
  });

  it("preserves an existing destination and returns the new local recording", async () => {
    const h = await harness();
    const session = await h.startReplayVideoCaptureFile(startOptions());
    const destination = h.sessions.get(session.id)!.destinationPath;
    await appendSample(h, session);
    await fs.mkdir(dirname(destination), { recursive: true });
    await fs.writeFile(destination, "Existing recording");
    const asset = await h.finishReplayVideoCaptureFile(session.id, finishOptions(session));
    expect(asset.path).toBe(session.path);
    expect(await fs.readFile(destination, "utf8")).toBe("Existing recording");
    expect(await fs.readFile(asset.path)).toEqual(samples.get("webm"));
  });

  it("recovers an interrupted local recording even when the preferred replay folder cannot be read", async () => {
    const h = await harness();
    const session = await h.startReplayVideoCaptureFile(startOptions());
    await appendSample(h, session);
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(session.path, old, old);
    await fs.mkdir(h.settings.replayDirectory);
    await fs.writeFile(join(h.settings.replayDirectory, "Video"), "Synthetic unavailable directory");
    h.sessions.clear(); // Simulate a fresh process with no live recorder session.
    await expect(h.recoverInterruptedReplayVideosOnStartup()).resolves.toBe(1);
    expect(h.savedReplays).toHaveLength(1);
    expect(h.savedReplays[0].video?.path).toBe(session.path);
    expect(h.savedReplays[0].video?.containerFinalized).toBe(true);
    await expect(h.replayVideoDecodeProbe(session.path)).resolves.toBe(true);
    await expect(fs.access(replayVideoRecoverySidecarPath(session.path))).rejects.toMatchObject({ code: "ENOENT" });
    expect(h.logStartupIssue).toHaveBeenCalledWith("replay video recovery directory unavailable", expect.any(Error));
    await expect(h.recoverInterruptedReplayVideosOnStartup()).resolves.toBe(0);
  });

  it("returns the published asset and avoids duplicate recovery if source cleanup is denied", async () => {
    const h = await harness();
    const session = await h.startReplayVideoCaptureFile(startOptions());
    const destination = h.sessions.get(session.id)!.destinationPath;
    await appendSample(h, session);
    fileFaults.blockedUnlink = session.path;
    const asset = await h.finishReplayVideoCaptureFile(session.id, finishOptions(session));
    expect(asset.path).toBe(destination);
    await expect(fs.access(session.path)).resolves.toBeUndefined();
    await expect(fs.access(replayVideoRecoverySidecarPath(session.path))).resolves.toBeUndefined();
    await expect(h.replayVideoDecodeProbe(destination)).resolves.toBe(true);
    await expect(interruptedReplayVideoCandidates(session.directory, [destination], Date.now() + 60_000)).resolves.toEqual([]);
    await expect(interruptedReplayVideoCandidates(session.directory, [], Date.now() + 60_000)).resolves.toEqual([destination]);
  });

  it("keeps invalid nonempty media local and reports it as unfinalized", async () => {
    const h = await harness();
    const session = await h.startReplayVideoCaptureFile(startOptions());
    const destination = h.sessions.get(session.id)!.destinationPath;
    await h.appendReplayVideoChunk(session.id, Buffer.alloc(64 * 1024, 7));
    const asset = await h.finishReplayVideoCaptureFile(session.id, finishOptions(session));
    expect(asset.path).toBe(session.path);
    expect(asset.containerFinalized).toBe(false);
    await expect(fs.access(destination)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(replayVideoRecoverySidecarPath(session.path))).resolves.toBeUndefined();
  });

  it("does not restore a discarded published recording when its retained local copy is locked", async () => {
    const h = await harness();
    const session = await h.startReplayVideoCaptureFile(startOptions());
    await appendSample(h, session);
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(session.path, old, old);
    fileFaults.blockedUnlink = session.path;
    const asset = await h.finishReplayVideoCaptureFile(session.id, finishOptions(session));
    expect(asset.path).not.toBe(session.path);
    await h.discardReplayVideoAsset(asset);
    await expect(fs.access(asset.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(session.path)).resolves.toBeUndefined();
    await expect(interruptedReplayVideoCandidates(session.directory, [], Date.now() + 60_000)).resolves.toEqual([]);
    await expect(h.recoverInterruptedReplayVideosOnStartup()).resolves.toBe(0);
    expect(h.savedReplays).toEqual([]);
  });

  it("removes an empty recording and its sidecar without publishing a file", async () => {
    const h = await harness();
    const session = await h.startReplayVideoCaptureFile(startOptions());
    const destination = h.sessions.get(session.id)!.destinationPath;
    await expect(h.finishReplayVideoCaptureFile(session.id, finishOptions(session))).rejects.toThrow("no media data");
    for (const file of [session.path, replayVideoRecoverySidecarPath(session.path), destination]) {
      await expect(fs.access(file)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("allows staged playback/reveal while refusing neighbouring app-data paths", async () => {
    const h = await harness();
    const session = await h.startReplayVideoCaptureFile(startOptions());
    await expect(h.replayVideoPathAllowed(session.path)).resolves.toBe(true);
    expect(h.replayLocalFileRoots(h.settings, {}).video).toContain(session.directory);
    await expect(h.replayVideoPathAllowed(join(h.userData, "settings.json"))).resolves.toBe(false);
    await expect(h.replayVideoPathAllowed(join(h.userData, "Replay Video Staging-other", "private.webm"))).resolves.toBe(false);
    await expect(h.replayVideoPathAllowed(join(session.directory, "..", "private.webm"))).resolves.toBe(false);
    await expect(h.replayVideoPathAllowed(join(h.root, "outside.webm"))).resolves.toBe(false);
  });
});
