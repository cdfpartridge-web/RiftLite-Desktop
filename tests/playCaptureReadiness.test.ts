import { describe, expect, it } from "vitest";
import { playCaptureReadiness, recordingForNextGame, type PlayCaptureReadinessInput } from "../src/shared/playCaptureReadiness.js";
import { createDefaultSettings } from "../src/shared/settingsDefaults.js";
import { rawCaptureSettingsForPlatformUpload } from "../src/shared/replaySharing.js";

const off: PlayCaptureReadinessInput = { interactiveReplay: "off", webCapturing: false, videoEnabled: false, videoArmed: false, videoRecording: false, microphoneEnabled: false, microphoneRecording: false };
describe("Play capture readiness", () => {
  it("does not turn enabled preferences into an assertion of active capture", () => {
    const items = playCaptureReadiness({ ...off, interactiveReplay: "upload", videoEnabled: true, microphoneEnabled: true });
    expect(items.map((item) => item.status)).toEqual(["Auto-upload", "Waiting for game", "Next recording"]);
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

describe("recording for the next match", () => {
  it("separates a fresh local timeline from provider-specific interactive data", () => {
    const settings = createDefaultSettings();
    expect(recordingForNextGame(settings, "tcga")).toEqual({
      localTimeline: true, interactiveReplay: "off", videoEnabled: false, microphoneEnabled: false
    });
    expect(recordingForNextGame(settings, "atlas").interactiveReplay).toBe("local");
    settings.rawCapture.enabled = false;
    settings.replayCaptureEnabled = false;
    expect(recordingForNextGame(settings, "atlas")).toEqual({
      localTimeline: false, interactiveReplay: "off", videoEnabled: false, microphoneEnabled: false
    });
  });

  it("uses only the selected platform's account-bound consent and verification", () => {
    const settings = { ...createDefaultSettings(), accountUid: "owner", firebaseRefreshToken: "token", accountLastVerifiedAt: "2026-11-18" };
    settings.rawCapture = rawCaptureSettingsForPlatformUpload(settings, "tcga", true);
    expect(recordingForNextGame(settings, "tcga").interactiveReplay).toBe("upload");
    expect(recordingForNextGame(settings, "atlas").interactiveReplay).toBe("local");
    expect(recordingForNextGame(settings, "tcga", false).interactiveReplay).toBe("verify");
    expect(recordingForNextGame({ ...settings, accountUid: "other" }, "tcga").interactiveReplay).toBe("off");
    expect(recordingForNextGame({ ...settings, firebaseRefreshToken: "" }, "tcga", true).interactiveReplay).toBe("verify");
    settings.rawCapture.enabled = false;
    expect(recordingForNextGame(settings, "tcga").interactiveReplay).toBe("off");
    expect(recordingForNextGame(settings, "sim").interactiveReplay).toBe("off");
  });

  it("keeps a saved microphone preference dormant while video or its master switch is off", () => {
    const settings = { ...createDefaultSettings(), replayMicAudioEnabled: true };
    expect(recordingForNextGame(settings, "atlas").microphoneEnabled).toBe(false);
    settings.replayVideoEnabled = true;
    expect(recordingForNextGame(settings, "atlas").microphoneEnabled).toBe(true);
    settings.replayCaptureEnabled = false;
    expect(recordingForNextGame(settings, "atlas")).toMatchObject({ videoEnabled: false, microphoneEnabled: false });
  });
});
