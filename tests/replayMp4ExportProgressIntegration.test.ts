import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("../src/shared/types.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../src/preload/appPreload.ts", import.meta.url), "utf8");

function functionSource(name: string, nextName: string): string {
  const start = appSource.indexOf(`function ${name}`);
  const end = appSource.indexOf(`function ${nextName}`, start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return appSource.slice(start, end);
}

describe("replay MP4 export progress integration", () => {
  it("owns progress in the app shell so it survives replay navigation", () => {
    const app = functionSource("App", "AtlasKnownOpponentHandPanel");

    expect(app).toContain("const [mp4ExportProgress, setMp4ExportProgress]");
    expect(app).toContain("const activeMp4ExportRef = useRef<RendererReplayMp4ExportRequest | null>(null)");
    expect(app).toContain("const retiredMp4ExportIdsRef = useRef(new Set<string>())");
    expect(app).toContain("window.riftlite.onReplayMp4ExportProgress");
    expect(app).toContain("<ReplayMp4ExportProgressDialog");
    expect(app).toContain("activeMp4ExportRef.current = request");
    expect(app).toContain("Another MP4 export is already running");
  });

  it("binds progress and terminal events to one requestId and exportId before changing UI or releasing the lock", () => {
    const app = functionSource("App", "AtlasKnownOpponentHandPanel");

    expect(app).toContain("exportId: \"\"");
    expect(app).toContain("active.requestId !== progress.requestId");
    expect(app).toContain("retiredMp4ExportIdsRef.current.has(progress.exportId)");
    expect(app).toContain("active.exportId && active.exportId !== progress.exportId");
    expect(app).toContain("active.exportId = progress.exportId");
    expect(app).toContain("current.exportId && current.exportId !== progress.exportId");
    expect(app).toContain("latest?.requestId === activeRequestId && latest.exportId === progress.exportId");
    expect(app).toContain("activeMp4ExportRef.current = null");
    expect(app).toContain("(requestId) => window.riftlite.exportReplayMp4(replayId, options, requestId)");
    expect(app).toContain("(requestId) => window.riftlite.exportReplayPresentationMp4(replayId, payload, requestId)");
  });

  it("uses the settled IPC result as a safe terminal fallback", () => {
    const app = functionSource("App", "AtlasKnownOpponentHandPanel");
    const invokeAt = app.indexOf("const exportedPath = await invokeExport(request.requestId)");
    const successFallbackAt = app.indexOf("if (activeMp4ExportRef.current?.requestId === request.requestId)", invokeAt);
    const completedAt = app.indexOf('stage: "completed"', successFallbackAt);
    const catchAt = app.indexOf("} catch (error)", completedAt);
    const failureFallbackAt = app.indexOf("if (activeMp4ExportRef.current?.requestId === request.requestId)", catchAt);
    const failedAt = app.indexOf('stage: "failed"', failureFallbackAt);

    expect(invokeAt).toBeGreaterThan(-1);
    expect(successFallbackAt).toBeGreaterThan(invokeAt);
    expect(completedAt).toBeGreaterThan(successFallbackAt);
    expect(failureFallbackAt).toBeGreaterThan(catchAt);
    expect(failedAt).toBeGreaterThan(failureFallbackAt);
    expect(app).toContain("settledUnboundMp4RequestsRef.current.push({ ...request })");
    expect(app).not.toContain("rejectedBeforeLifecycleStarted");
  });

  it("keeps the progress dialog blocking until a terminal result", () => {
    const dialog = functionSource("ReplayMp4ExportProgressDialog", "ReplayExportDialog");

    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain("dialogRef.current?.focus({ preventScroll: true })");
    expect(dialog).toContain('event.key === "Escape" || event.key === "Tab"');
    expect(dialog).toContain('role="progressbar"');
    expect(dialog).toContain('role="status"');
    expect(dialog).toContain('aria-live="polite"');
    expect(dialog).toContain("The final file is not ready yet.");
    expect(dialog).toContain("passed its integrity check");
    expect(dialog).toContain("RiftLite did not publish an unfinished MP4");
    expect(dialog).toContain("Your Full Voiceover recording is retained");
    expect(dialog).toContain("Show in folder");
    expect(dialog).toContain("{!working ? (");
    expect(dialog).not.toContain("onClick={onDismiss} aria-label");
  });

  it("disables every full and clip MP4 trigger while an export is active", () => {
    const dialog = functionSource("ReplayExportDialog", "ReplayDetail");

    expect(dialog).toContain("mp4ExportActive: boolean");
    expect(dialog).toContain('disabled={!hasVideo || mp4ExportActive}');
    expect(dialog).toContain('disabled={!hasVideo || clipRemainingMs <= 0 || mp4ExportActive}');
    expect(dialog).toContain('mp4ExportActive ? "Export already running" : "Export MP4"');
  });

  it("exposes typed main-process progress events through the preload bridge", () => {
    expect(typesSource).toContain("export interface ReplayMp4ExportProgress");
    expect(typesSource).toContain("requestId: number");
    expect(typesSource).toContain("onReplayMp4ExportProgress(");
    expect(typesSource).toContain("revealLastReplayMp4Export(): Promise<void>");
    expect(preloadSource).toContain('ipcRenderer.on("replay:mp4-export-progress"');
    expect(preloadSource).toContain('ipcRenderer.removeListener("replay:mp4-export-progress"');
  });

  it("renders prominent staged, accessible, reduced-motion-aware feedback", () => {
    expect(styleSource).toContain(".replay-mp4-progress-backdrop");
    expect(styleSource).toContain("z-index: 1200");
    expect(styleSource).toContain(".replay-mp4-progress-stages");
    expect(styleSource).toContain(".replay-mp4-progress-track[data-indeterminate=\"true\"]");
    expect(styleSource).toContain("@keyframes replay-mp4-export-indeterminate");
    expect(styleSource).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("retains failed or cancelled presentation recordings for an explicit retry", () => {
    const player = functionSource("ReplayVideoPlayer", "ReplayVideoMarkerTimeline");

    expect(appSource).toContain("const pendingReplayPresentationExports = new Map<string, ReplayPresentationRecordingPayload>()");
    expect(player).toContain("function retainPresentationExport(");
    expect(player).toContain("async function exportPendingPresentationRecording(");
    expect(player).toContain("Full Voiceover export cancelled. The recording is kept here so you can retry.");
    expect(player).toContain("The recording is kept here so you can retry.");
    expect(player).toContain("pendingReplayPresentationExports.get(replayId) === payload");
    expect(player).toContain("Retry voiceover export");
    expect(player).toContain("Record new voiceover");
    expect(player).toContain("Discard recording");
    expect(player).toContain('data-state="ready"');
    expect(player).toContain('className="replay-recording-feedback"');
    expect(player).toContain('aria-live="polite"');
    expect(player).toContain('aria-atomic="true"');
    expect(player).not.toContain("window.riftlite.exportReplayPresentationMp4");
    expect(styleSource).toContain('.replay-coaching-status[data-state="ready"]');
  });

  it("keys the player to its replay and bounds retained presentations to one app-wide payload", () => {
    const detail = functionSource("ReplayDetail", "ReplayHealthPanel");
    const player = functionSource("ReplayVideoPlayer", "ReplayVideoMarkerTimeline");
    const retainAt = player.indexOf("function retainPresentationExport(");
    const clearAt = player.indexOf("pendingReplayPresentationExports.clear()", retainAt);
    const setAt = player.indexOf("pendingReplayPresentationExports.set(replayId, payload)", retainAt);
    const startAt = player.indexOf("async function startPresentationRecording()");
    const replaceAt = player.indexOf("pendingReplayPresentationExports.clear()", startAt);
    const microphoneAwaitAt = player.indexOf("await createVoiceStreamCapture(microphoneDeviceId)", startAt);
    const recorderStartAt = player.indexOf("recorder.start(1000)", microphoneAwaitAt);
    const discardAt = player.indexOf("function discardPendingPresentationExport()");
    const discardInvalidationAt = player.indexOf("presentationGenerationRef.current = nextReplayPresentationGeneration()", discardAt);
    const discardClearAt = player.indexOf("pendingReplayPresentationExports.clear()", discardAt);

    expect(detail).toContain("key={model.replay.id}");
    expect(clearAt).toBeGreaterThan(retainAt);
    expect(setAt).toBeGreaterThan(clearAt);
    expect(replaceAt).toBeGreaterThan(startAt);
    expect(replaceAt).toBeGreaterThan(recorderStartAt);
    expect(discardInvalidationAt).toBeGreaterThan(discardAt);
    expect(discardClearAt).toBeGreaterThan(discardInvalidationAt);
    expect(player).toContain("isPresentationLifecycleCurrent(generation)");
    expect(player).toContain("presentationGenerationRef.current === generation");
    expect(player).toContain("replayPresentationRecordingGeneration === generation");
  });

  it("cleans retained presentation payloads after successful single and bulk replay deletion", () => {
    const singleDelete = functionSource("deleteReplay", "openReplayForMatch");
    const bulkDelete = functionSource("deleteSelectedReplays", "createReplayFolder");

    expect(singleDelete.indexOf("await window.riftlite.deleteReplay(id)")).toBeLessThan(
      singleDelete.indexOf("deleteReplayPresentationState(id)")
    );
    expect(bulkDelete.indexOf("await window.riftlite.deleteReplays(replayIds)")).toBeLessThan(
      bulkDelete.indexOf("replayIds.forEach(deleteReplayPresentationState)")
    );
  });

  it("serializes presentation starts before the microphone prompt and cleans a stale acquired stream", () => {
    const player = functionSource("ReplayVideoPlayer", "ReplayVideoMarkerTimeline");
    const startAt = player.indexOf("async function startPresentationRecording()");
    const pendingGuardAt = player.indexOf("presentationStartPendingRef.current", startAt);
    const requestAt = player.indexOf("const startRequestId = nextPresentationStartRequest()", startAt);
    const pendingSetAt = player.indexOf("presentationStartPendingRef.current = true", requestAt);
    const microphoneAwaitAt = player.indexOf("await createVoiceStreamCapture(microphoneDeviceId)", pendingSetAt);
    const staleGuardAt = player.indexOf("if (!isPresentationStartCurrent(startRequestId, generation))", microphoneAwaitAt);
    const cleanupAt = player.indexOf("acquiredResourceCleanup()", staleGuardAt);

    expect(player).toContain("const presentationMountedRef = useRef(false)");
    expect(player).toContain("const presentationDisposedRef = useRef(true)");
    expect(player).toContain("const presentationStartRequestRef = useRef(0)");
    expect(player).toContain("const presentationStartPendingRef = useRef(false)");
    expect(pendingGuardAt).toBeGreaterThan(startAt);
    expect(requestAt).toBeGreaterThan(pendingGuardAt);
    expect(pendingSetAt).toBeGreaterThan(requestAt);
    expect(microphoneAwaitAt).toBeGreaterThan(pendingSetAt);
    expect(staleGuardAt).toBeGreaterThan(microphoneAwaitAt);
    expect(cleanupAt).toBeGreaterThan(staleGuardAt);
    expect(player).toContain("voiceCapture.stream.getTracks().forEach((track) => track.stop())");
    expect(player).toContain('"Connecting microphone..."');
    expect(player).toContain("presentationPayloadPreparing || presentationStartPending");
  });

  it("disposes recorder, animation, and microphone resources on unmount or replay deletion", () => {
    const player = functionSource("ReplayVideoPlayer", "ReplayVideoMarkerTimeline");
    const deletionState = functionSource("deleteReplayPresentationState", "replayMp4ExportUiProgress");
    const disposeAt = player.indexOf("function disposePresentationRuntime()");
    const detachDataAt = player.indexOf("recorder.ondataavailable = null", disposeAt);
    const detachStopAt = player.indexOf("recorder.onstop = null", detachDataAt);
    const detachErrorAt = player.indexOf("recorder.onerror = null", detachStopAt);
    const stopAt = player.indexOf("recorder.stop()", detachErrorAt);
    const cleanupAt = player.indexOf("cleanupPresentationRecording()", stopAt);

    expect(player).toContain("replayPresentationDisposers.set(replayId, disposePresentationRuntime)");
    expect(player).toContain("presentationMountedRef.current = false");
    expect(player).toContain("presentationDisposedRef.current = true");
    expect(player).toContain("window.cancelAnimationFrame(presentationAnimationRef.current)");
    expect(detachDataAt).toBeGreaterThan(disposeAt);
    expect(detachStopAt).toBeGreaterThan(detachDataAt);
    expect(detachErrorAt).toBeGreaterThan(detachStopAt);
    expect(stopAt).toBeGreaterThan(detachErrorAt);
    expect(cleanupAt).toBeGreaterThan(stopAt);
    expect(deletionState).toContain("deletedReplayPresentationIds.add(replayId)");
    expect(deletionState).toContain("pendingReplayPresentationExports.delete(replayId)");
    expect(deletionState).toContain("replayPresentationDisposers.get(replayId)?.()");
    expect(deletionState).not.toContain("nextReplayPresentationGeneration()");
  });

  it("refuses to retain or export late presentation blobs after invalidation", () => {
    const player = functionSource("ReplayVideoPlayer", "ReplayVideoMarkerTimeline");
    const onStopAt = player.indexOf("recorder.onstop = () =>");
    const stopGuardAt = player.indexOf("if (!recordingIsStillCurrent)", onStopAt);
    const arrayBufferAt = player.indexOf("blob.arrayBuffer()", stopGuardAt);
    const asyncGuardAt = player.indexOf("if (!recordingIsCurrent())", arrayBufferAt);
    const retainAt = player.indexOf("retainPresentationExport(payload, generation)", asyncGuardAt);
    const exportAt = player.indexOf("exportPendingPresentationRecording(payload)", retainAt);

    expect(stopGuardAt).toBeGreaterThan(onStopAt);
    expect(arrayBufferAt).toBeGreaterThan(stopGuardAt);
    expect(asyncGuardAt).toBeGreaterThan(arrayBufferAt);
    expect(retainAt).toBeGreaterThan(asyncGuardAt);
    expect(exportAt).toBeGreaterThan(retainAt);
    expect(player).toContain("!deletedReplayPresentationIds.has(replayId)");
    expect(player).toContain("presentationExportRequestRef.current !== exportRequestId");
  });

  it("clears a successfully exported retained payload even if its player has unmounted", () => {
    const player = functionSource("ReplayVideoPlayer", "ReplayVideoMarkerTimeline");
    const exportAt = player.indexOf("const outputPath = await onExportPresentationMp4(replayId, payload)");
    const clearAt = player.indexOf("pendingReplayPresentationExports.delete(replayId)", exportAt);
    const staleGuardAt = player.indexOf("presentationExportRequestRef.current !== exportRequestId", exportAt);

    expect(clearAt).toBeGreaterThan(exportAt);
    expect(clearAt).toBeLessThan(staleGuardAt);
    expect(player).toContain("const clearedRetainedPayload = Boolean(");
  });
});
