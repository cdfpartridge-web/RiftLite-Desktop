import { describe, expect, it } from "vitest";
import { playCaptureReadiness, type PlayCaptureReadinessInput } from "../src/shared/playCaptureReadiness.js";

const off: PlayCaptureReadinessInput = { webEnabled: false, webCapturing: false, videoEnabled: false, videoArmed: false, videoRecording: false, microphoneEnabled: false, microphoneRecording: false };
describe("Play capture readiness", () => {
  it("does not turn enabled preferences into an assertion of active capture", () => {
    const items = playCaptureReadiness({ ...off, webEnabled: true, videoEnabled: true, microphoneEnabled: true });
    expect(items.map((item) => item.status)).toEqual(["On for new games", "Waiting for game", "Next recording"]);
    expect(items.every((item) => !item.recording)).toBe(true);
  });
  it("distinguishes an armed video source from recording", () => {
    expect(playCaptureReadiness({ ...off, videoEnabled: true, videoArmed: true })[1]).toMatchObject({ status: "Ready", recording: false });
    expect(playCaptureReadiness({ ...off, videoEnabled: true, videoArmed: true, videoRecording: true })[1]).toMatchObject({ status: "Recording", recording: true });
  });
  it("shows a still-running capture even if future recording was switched off", () => {
    expect(playCaptureReadiness({ ...off, webCapturing: true, videoRecording: true, microphoneRecording: true }).map((item) => item.status)).toEqual(["Capturing", "Recording", "Recording"]);
  });
  it("does not claim a microphone is recording merely because video is recording", () => {
    expect(playCaptureReadiness({ ...off, videoRecording: true, microphoneEnabled: true })[2]).toMatchObject({ status: "Next recording", recording: false });
  });
});
