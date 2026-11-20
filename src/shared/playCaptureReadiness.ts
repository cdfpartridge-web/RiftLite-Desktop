import { hasVerifiedRiftLiteAccount } from "./accountIdentity.js";
import { uploadLaneEnabledForAccount } from "./replaySharing.js";
import type { GamePlatform, UserSettings } from "./types.js";

type InteractiveReplayPreference = "off" | "local" | "verify" | "upload";

/** Atlas keeps local game data independently of upload consent. TCGA's recorder
 * requires consent for that provider and account, even for its local capture. */
export function recordingForNextGame(settings: UserSettings, platform: GamePlatform, accountVerified?: boolean) {
  const supported = platform === "atlas" || platform === "tcga";
  const consent = supported && uploadLaneEnabledForAccount(settings.rawCapture, platform, String(settings.accountUid ?? "").trim());
  let interactiveReplay: InteractiveReplayPreference = "off";
  if (settings.rawCapture.enabled && (platform === "atlas" || consent)) {
    if (!consent) interactiveReplay = "local";
    else interactiveReplay = hasVerifiedRiftLiteAccount(settings) && accountVerified !== false ? "upload" : "verify";
  }
  const videoEnabled = supported && settings.replayCaptureEnabled && settings.replayVideoEnabled;
  return {
    localTimeline: settings.replayCaptureEnabled || settings.enhancedInsightsEnabled === true,
    interactiveReplay,
    videoEnabled,
    microphoneEnabled: videoEnabled && settings.replayMicAudioEnabled
  };
}

export const replayUploadDescription: Record<InteractiveReplayPreference, string> = {
  off: "Automatic replay uploads off",
  local: "Automatic replay uploads off",
  verify: "Automatic replay uploads waiting for account verification",
  upload: "Automatic replay uploads enabled"
};

export interface PlayCaptureReadinessInput {
  interactiveReplay: InteractiveReplayPreference;
  webCapturing: boolean;
  videoEnabled: boolean;
  videoArmed: boolean;
  videoRecording: boolean;
  microphoneEnabled: boolean;
  microphoneRecording: boolean;
}

export interface PlayCaptureReadinessItem {
  kind: "web" | "video" | "microphone";
  label: string;
  status: string;
  detail: string;
  recording: boolean;
}

/** Actual capture has precedence over preferences, which apply to later games. */
export function playCaptureReadiness(input: PlayCaptureReadinessInput): PlayCaptureReadinessItem[] {
  const replayStatus = { off: "Off", local: "Local only", verify: "Verify account", upload: "Auto-upload" }[input.interactiveReplay];
  const replayDetail = input.webCapturing ? "Interactive replay data is being captured on this device."
    : input.interactiveReplay === "off" ? "Interactive replay data capture is off for this platform."
    : "Interactive replay data capture is enabled on this device.";
  return [
    {
      kind: "web", label: "Interactive replay", recording: input.webCapturing,
      status: input.webCapturing ? "Capturing" : replayStatus,
      detail: `${replayDetail} ${replayUploadDescription[input.interactiveReplay]}.`
    },
    {
      kind: "video", label: "Video", recording: input.videoRecording,
      status: input.videoRecording ? "Recording" : !input.videoEnabled ? "Off" : input.videoArmed ? "Ready" : "Waiting for game",
      detail: input.videoRecording ? "Game video is being recorded on this computer." : !input.videoEnabled ? "Local video recording is off." : input.videoArmed ? "The video source is ready. Recording starts when a match begins." : "Video is enabled. Click inside the game before starting a match to prepare capture."
    },
    {
      kind: "microphone", label: "Mic", recording: input.microphoneRecording,
      status: input.microphoneRecording ? "Recording" : input.microphoneEnabled ? "Next recording" : "Off",
      detail: input.microphoneRecording ? "Microphone audio is included in the current video." : input.microphoneEnabled ? "Microphone is enabled for the next video; it is not recording now." : "Your microphone is not being recorded."
    }
  ];
}
