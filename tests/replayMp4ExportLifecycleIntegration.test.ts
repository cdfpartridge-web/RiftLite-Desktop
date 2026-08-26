import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../src/preload/appPreload.ts", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("../src/shared/types.ts", import.meta.url), "utf8");

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing ${endMarker}`).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

describe("replay MP4 export lifecycle integration", () => {
  it.each([
    ["replay", "async function exportReplayMp4Unlocked(", "async function exportReplayPresentationMp4("],
    ["presentation", "async function exportReplayPresentationMp4Unlocked(", "function defaultReplayCoachingPack("]
  ])("keeps the final %s MP4 untouched until validation and promotion", (_kind, start, end) => {
    const source = sourceBetween(start, end);
    const encodeTarget = source.indexOf("partialPath");
    const validate = source.indexOf("validateReplayMp4Output(ffmpegPath, partialPath, expectedDurationMs");
    const promote = source.indexOf("promoteReplayMp4Output(partialPath, outputPath, initialDestination)");
    const returned = source.indexOf("return outputPath", promote);
    const cleanupTemp = source.indexOf("await rm(tempDirectory, { recursive: true, force: true })", returned);
    const cleanupStaging = source.indexOf("await rm(staging.directory, { recursive: true, force: true })", returned);

    expect(encodeTarget).toBeGreaterThanOrEqual(0);
    expect(source).not.toContain("await unlink(outputPath)");
    expect(validate).toBeGreaterThan(encodeTarget);
    expect(promote).toBeGreaterThan(validate);
    expect(returned).toBeGreaterThan(promote);
    expect(cleanupTemp).toBeGreaterThan(returned);
    expect(cleanupStaging).toBeGreaterThan(cleanupTemp);
    expect(source).toContain('"-f"');
    expect(source).toContain('"mp4"');
  });

  it("holds one global lock and releases it before every terminal event", () => {
    const begin = sourceBetween("function beginReplayMp4Export(", "function endReplayMp4Export(");
    const replayWrapper = sourceBetween("async function exportReplayMp4(", "async function exportReplayMp4Unlocked(");
    const presentationWrapper = sourceBetween("async function exportReplayPresentationMp4(", "async function exportReplayPresentationMp4Unlocked(");

    expect(begin).toContain("if (activeReplayMp4Export)");
    expect(begin).toContain("Another MP4 export is already running");
    expect(begin).not.toContain("emitReplayMp4ExportProgress");
    for (const wrapper of [replayWrapper, presentationWrapper]) {
      const successRelease = wrapper.indexOf("endReplayMp4Export(context)");
      const completed = wrapper.indexOf('stage: "completed"', successRelease);
      const catchBlock = wrapper.indexOf("} catch (error)");
      const failureRelease = wrapper.indexOf("endReplayMp4Export(context)", catchBlock);
      const failed = wrapper.indexOf('stage: "failed"', failureRelease);
      expect(completed).toBeGreaterThan(successRelease);
      expect(failureRelease).toBeGreaterThan(catchBlock);
      expect(failed).toBeGreaterThan(failureRelease);
    }
  });

  it("validates and echoes the renderer request identity end to end", () => {
    const begin = sourceBetween("function beginReplayMp4Export(", "function endReplayMp4Export(");
    const emit = sourceBetween("function emitReplayMp4ExportProgress(", "function assertReplayMp4ExportRequestId(");
    const diagnostics = sourceBetween("function recordReplayMp4ExportLifecycle(", "function emitReplayMp4ExportProgress(");
    const validationIndex = begin.indexOf("assertReplayMp4ExportRequestId(requestId)");
    const lockIndex = begin.indexOf("if (activeReplayMp4Export)");

    expect(validationIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeGreaterThan(validationIndex);
    expect(mainSource).toContain("!Number.isSafeInteger(requestId) || requestId <= 0");
    expect(begin).toContain("requestId,");
    expect(emit).toContain("requestId: context.requestId");
    expect(diagnostics).toContain("requestId: progress.requestId");
    expect(typesSource).toContain("requestId: number;");
    expect(typesSource).toContain("exportReplayMp4(replayId: string, options: ReplayMp4ExportOptions, requestId: number)");
    expect(typesSource).toContain("exportReplayPresentationMp4(replayId: string, payload: ReplayPresentationRecordingPayload, requestId: number)");
    expect(preloadSource).toContain('ipcRenderer.invoke("replays:export-mp4", replayId, options, requestId)');
    expect(preloadSource).toContain('ipcRenderer.invoke("replays:export-presentation-mp4", replayId, payload, requestId)');
    expect(mainSource).toContain("exportReplayMp4(replayId, options, requestId, event.sender)");
    expect(mainSource).toContain("exportReplayPresentationMp4(replayId, payload, requestId, event.sender)");
  });

  it("validates probed video duration and fully decodes video plus retained audio", () => {
    const validator = sourceBetween("async function validateReplayMp4Output(", "type ReplayMp4DestinationSnapshot =");
    expect(validator).toContain("replayMp4ProbeMedia(ffmpegPath, partialPath");
    expect(validator).toContain("replayMp4DurationIsNearExpected(actualDurationMs, expectedDurationMs)");
    expect(validator).toContain('"-xerror"');
    expect(validator).toContain('"-err_detect"');
    expect(validator).toContain('"explode"');
    expect(validator).toContain('"0:v:0"');
    expect(validator).toContain('"0:a?"');
    expect(validator).not.toContain('"copy"');
    expect(validator).toContain('"null"');
    expect(validator).toContain("onProgressMs");
  });

  it("uses probed media duration and keeps partial output non-playable until promotion", () => {
    const replay = sourceBetween("async function exportReplayMp4Unlocked(", "async function exportReplayPresentationMp4(");
    const presentation = sourceBetween("async function exportReplayPresentationMp4Unlocked(", "function defaultReplayCoachingPack(");
    const replayProbe = replay.indexOf("replayMp4ProbeMedia(ffmpegPath, source.sourcePath, source.asset)");
    const replayClip = replay.indexOf("replayMp4ClipRange(sourceAsset, options)");
    const inputWrite = presentation.indexOf("await writeFile(inputPath");
    const inputProbe = presentation.indexOf("replayMp4ProbeMedia(ffmpegPath, inputPath");

    expect(replayProbe).toBeGreaterThanOrEqual(0);
    expect(replayClip).toBeGreaterThan(replayProbe);
    expect(replay).toContain("clipRange?.durationMs ?? sourceProbe.durationMs");
    expect(inputProbe).toBeGreaterThan(inputWrite);
    expect(presentation).toContain("const expectedDurationMs = inputProbe.durationMs");
    expect(presentation).not.toContain('"-shortest"');
    expect(replay).toContain("replayMp4StagingPaths(outputPath, context.exportId)");
    expect(presentation).toContain("replayMp4StagingPaths(outputPath, context.exportId)");
    expect(presentation).toContain("assertReplayMp4DestinationDiffersFromSource(replaySourcePath, outputPath)");
    expect(replay).toContain("setReplayMp4WindowsHidden(partialPath, false)");
    expect(presentation).toContain("setReplayMp4WindowsHidden(partialPath, false)");
  });

  it("canonicalizes source protection and detects same-file identity", () => {
    const guard = sourceBetween("async function assertReplayMp4DestinationDiffersFromSource(", "async function setReplayMp4WindowsHidden(");
    expect(guard).toContain("replayMp4CanonicalCandidatePath(sourcePath)");
    expect(guard).toContain("replayMp4CanonicalCandidatePath(outputPath)");
    expect(guard).toContain("replayMp4CanonicalPathKey");
    expect(guard).toContain("replayMp4FileIdentityMatches");
  });

  it("guards window/app quit and rejects updater handoff during export", () => {
    const createWindow = sourceBetween("async function createWindow(): Promise<void>", "function protocolNavigationFromArgs(");
    const beforeQuit = sourceBetween('app.on("before-quit"', 'app.on("will-quit"');
    const beforeInstallIndex = mainSource.indexOf("beforeInstall: async () =>");
    const activeCheckIndex = mainSource.indexOf("if (activeReplayMp4Export)", beforeInstallIndex);
    const updateStopIndex = mainSource.indexOf('tcgaReplayResearchCapture.stop("update-install")', beforeInstallIndex);

    expect(createWindow).toContain('createdMainWindow.on("close"');
    expect(createWindow).toContain("event.preventDefault()");
    expect(createWindow).toContain('deferQuitForReplayMp4Export("close-window", createdMainWindow)');
    expect(beforeQuit).toContain("deferQuitForReplayMp4Export()");
    expect(beforeQuit).toContain("event.preventDefault()");
    expect(activeCheckIndex).toBeGreaterThan(beforeInstallIndex);
    expect(updateStopIndex).toBeGreaterThan(activeCheckIndex);
  });

  it("exposes progress and the allowlisted reveal action through preload", () => {
    expect(preloadSource).toContain('ipcRenderer.on("replay:mp4-export-progress"');
    expect(preloadSource).toContain('ipcRenderer.invoke("replays:reveal-last-mp4-export")');
    expect(mainSource).toContain('handleTrustedAppIpc("replays:reveal-last-mp4-export"');
  });
});
