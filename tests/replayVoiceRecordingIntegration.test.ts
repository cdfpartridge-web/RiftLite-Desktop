import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");

function sourceBetween(startNeedle: string, endNeedle: string, source = appSource): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("local replay voice recording integration", () => {
  it("reports a coaching note as saved only after durable replay persistence succeeds", () => {
    const detailSave = sourceBetween(
      "async function saveTimelineVoiceNote(",
      "function deleteReplayVoiceNote("
    );
    const noteRecording = sourceBetween(
      "async function startTimelineVoiceNote()",
      "function stopTimelineVoiceNote()"
    );
    const saveAwaitAt = noteRecording.indexOf("const saved = await onSaveTimelineVoiceNote(flag");
    const successAt = noteRecording.indexOf("Coaching note saved at", saveAwaitAt);

    expect(appSource).toContain("onSaveTimelineVoiceNote: (flag: ReplayFlag, voiceNote: ReplayVoiceNote) => Promise<boolean>");
    expect(detailSave).toContain("const saved = await onSaveReplay({");
    expect(detailSave).toContain("}, false)");
    expect(detailSave).toContain("return saved");
    expect(saveAwaitAt).toBeGreaterThan(-1);
    expect(successAt).toBeGreaterThan(saveAwaitAt);
    expect(noteRecording).toContain("Coaching note wasn't saved. Please try recording it again.");
    expect(noteRecording).not.toContain("void blobToDataUrl(blob)");
  });

  it("serializes microphone startup and exposes pending, recording, error, timer, and save states", () => {
    const player = sourceBetween("function ReplayVideoPlayer(", "function ReplayVideoMarkerTimeline(");
    const coachingStart = sourceBetween(
      "async function startTimelineVoiceNote()",
      "function stopTimelineVoiceNote()"
    );
    const fullVoiceoverStart = sourceBetween(
      "async function startPresentationRecording()",
      "function stopPresentationRecording()"
    );
    const pendingAt = coachingStart.indexOf("voiceStartPendingRef.current = true");
    const captureAt = coachingStart.indexOf("await createVoiceRecorderCapture(microphoneDeviceId)");

    expect(player).toContain("const voiceStartPendingRef = useRef(false)");
    expect(player).toContain("const voiceSavingRef = useRef(false)");
    expect(player).toContain("const [voiceStartPending, setVoiceStartPending] = useState(false)");
    expect(player).toContain("const [voiceSaving, setVoiceSaving] = useState(false)");
    expect(pendingAt).toBeGreaterThan(-1);
    expect(captureAt).toBeGreaterThan(pendingAt);
    expect(coachingStart).toContain("presentationStartPendingRef.current");
    expect(coachingStart).toContain("presentationExportBusyRef.current");
    expect(coachingStart).toContain("presentationRecorderRef.current");
    expect(fullVoiceoverStart).toContain("voiceStartPendingRef.current");
    expect(fullVoiceoverStart).toContain("voiceSavingRef.current");
    expect(fullVoiceoverStart).toContain("voiceRecorderRef.current");
    expect(coachingStart).toContain("recorder.onerror = (event) =>");
    expect(fullVoiceoverStart).toContain("recorder.onerror = (event) =>");
    expect(fullVoiceoverStart).toContain("recorderFailureMessage = microphoneErrorMessage(");
    expect(fullVoiceoverStart).toContain("setPresentationStatus(recorderFailureMessage)");
    expect(player).toContain("window.setInterval(updateElapsed, 250)");
    expect(player).toContain("window.clearInterval(timer)");
    expect(player).toContain("formatDuration(elapsedRecordingMs)");
    expect(appSource).toContain("const acquired = await acquireMicrophoneStream(");
  });

  it("uses Full Voiceover wording and keeps accessible recording feedback visible in fullscreen", () => {
    const player = sourceBetween("function ReplayVideoPlayer(", "function ReplayVideoMarkerTimeline(");
    const headerStart = player.indexOf("<header>");
    const headerEnd = player.indexOf("</header>", headerStart);
    const header = player.slice(headerStart, headerEnd);
    const hiddenBlock = sourceBetween(
      ".replay-video-fullscreen .replay-video-quick-flag,",
      ".replay-video-stage:fullscreen",
      styleSource
    );

    expect(header).toContain('"Full Voiceover"');
    expect(header).toContain('"Stop & export"');
    expect(header).toContain('"Connecting microphone..."');
    expect(header).toContain('"Preparing recording..."');
    expect(header).toContain('"Exporting MP4..."');
    expect(header).toContain('className="replay-recording-feedback"');
    expect(header).toContain('role="status"');
    expect(header).toContain('aria-live="polite"');
    expect(header).toContain('aria-atomic="true"');
    expect(styleSource).toContain(".replay-recording-feedback {");
    expect(hiddenBlock).not.toContain(".replay-recording-feedback");
    expect(hiddenBlock).not.toContain(".replay-coaching-status,");
    expect(styleSource).toContain(".replay-video-fullscreen .replay-coaching-status {");
  });
});
