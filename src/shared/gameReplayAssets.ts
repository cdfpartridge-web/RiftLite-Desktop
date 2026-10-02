import type { MatchDraft, RawCaptureProcessingStatus, ReplayRecord } from "./types.js";

export type GameReplayAssetKind = "web-replay" | "video" | "game-log";
export type GameReplayAssetTone = "ready" | "pending" | "attention" | "neutral";
export type GameReplayAssetAction = "watch-web" | "watch-video" | "upload" | "view-log" | "setup" | "review-result" | "delivery";

/** A cloud listing is supplied only after the caller has established account ownership. */
export interface GameCloudReplay {
  id: string;
  url: string;
  status: RawCaptureProcessingStatus;
  partialWarnings?: readonly string[];
}

export interface GameReplayAssetsInput {
  replay?: ReplayRecord | null;
  match?: MatchDraft | null;
  cloudReplay?: GameCloudReplay | null;
  accountReady: boolean;
  webCaptureEnabled: boolean;
  videoRecordingEnabled: boolean;
  /** Whether a local log can be opened, not a promise of complete game coverage. */
  gameLogAvailable: boolean;
  /** Omit until the local file has actually been checked. */
  videoFileAvailable?: boolean;
}

export interface GameReplayAsset {
  kind: GameReplayAssetKind;
  title: string;
  status: string;
  description: string;
  tone: GameReplayAssetTone;
  action?: GameReplayAssetAction;
  actionLabel?: string;
  url?: string;
}

function webReplayAsset(input: GameReplayAssetsInput): GameReplayAsset {
  const raw = input.replay?.rawCapture;
  const cloud = input.cloudReplay;
  const base = { kind: "web-replay", title: "Interactive replay" } as const;
  const url = cloud?.url || raw?.uploadUrl;
  const status = cloud?.status || raw?.processingStatus;
  const stage = cloud ? undefined : raw?.deliveryStage;
  const partial = Boolean(cloud?.partialWarnings?.length || raw?.partialWarnings?.length);
  if ((status === "ready" || stage === "ready") && url) {
    return { ...base, status: partial ? "Ready · partial" : "Ready", tone: "ready", url,
      description: partial ? "Watch the captured turns. Some moments are missing." : "Watch and explore the game board online.",
      action: "watch-web", actionLabel: "Watch replay" };
  }
  if (status === "processing" || stage === "processing" || (raw?.uploadStatus === "uploaded" && !status && stage !== "failed")) {
    return { ...base, status: "Preparing replay", tone: "pending", description: "The upload is saved. RiftLite is preparing the interactive board.", action: "delivery", actionLabel: "View progress" };
  }
  if (status === "uploading" || ["authenticating", "initializing", "uploading", "completing"].includes(stage || "")) {
    return { ...base, status: "Uploading", tone: "pending", description: "The game capture is being uploaded. Your video and log are separate.", action: "delivery", actionLabel: "View progress" };
  }
  if (status === "failed" || raw?.uploadStatus === "failed" || raw?.uploadStatus === "too-large" || stage === "failed") {
    return { ...base, status: "Upload needs attention", tone: "attention", description: raw?.localPath
      ? "The interactive replay needs attention. Its capture is still saved on this computer."
      : "The interactive replay could not be prepared. Other saved assets are unaffected.", action: "delivery", actionLabel: "Resolve upload" };
  }
  if (cloud?.status === "pending" || stage === "queued" || stage === "paused" || (raw?.webReplayAutoUploadEligible && !raw.uploadQueueRemoval)) {
    return { ...base, status: stage === "paused" ? "Waiting to retry" : "Waiting to upload", tone: "pending", description: "Delivery continues in the background. You can still use this game's saved video and log.", action: "delivery", actionLabel: "View progress" };
  }
  if (raw?.localPath) {
    const canUpload = input.accountReady;
    return { ...base, status: "Saved on this computer", tone: "neutral", description: canUpload
      ? "The game capture is available to upload as an interactive replay."
      : "Connect your RiftLite account to upload this saved game capture.", action: canUpload ? "upload" : "setup", actionLabel: canUpload ? "Upload replay" : "Connect account" };
  }
  // Match associations survive when the user keeps the online replay without a local bundle.
  if (input.match?.webReplayId) {
    return { ...base, status: "Online", tone: "neutral", description: "Open the online replay associated with this game.",
      url: `https://www.riftlite.com/replays/${encodeURIComponent(input.match.webReplayId)}`, action: "watch-web", actionLabel: "Watch replay" };
  }
  return { ...base, status: "Not captured", tone: "neutral", description: input.webCaptureEnabled
    ? "This game has no saved interactive replay capture. New games can be captured."
    : "Enable Web Replays to capture future games.", action: "setup", actionLabel: "Set up" };
}

function videoAsset(input: GameReplayAssetsInput): GameReplayAsset {
  const base = { kind: "video", title: "Video recording" } as const;
  const video = input.replay?.video;
  if (video && input.videoFileAvailable === false) {
    return { ...base, status: "File not found", tone: "attention", description: "This recording's local file is missing. Your interactive replay and game log are separate.", action: "setup", actionLabel: "Save location" };
  }
  if (video && (video.path || video.url)) {
    return { ...base, status: video.containerFinalized === false ? "Partial recording" : "Saved on this computer", tone: video.containerFinalized === false ? "attention" : "ready",
      description: video.containerFinalized === false ? "Open the recorded portion to review what was saved." : "Watch, annotate or export the game video.", action: "watch-video", actionLabel: "Watch video" };
  }
  return { ...base, status: "Not recorded here", tone: "neutral", description: input.cloudReplay && !input.replay
    ? "Video files stay on the computer that recorded them."
    : input.videoRecordingEnabled ? "No video was saved for this game. Recording is enabled for future games." : "Enable video recording to save future games on this computer.",
    action: "setup", actionLabel: "Set up" };
}

export function deriveGameReplayAssets(input: GameReplayAssetsInput): GameReplayAsset[] {
  const platform = input.match?.platform || input.replay?.platform;
  const log: GameReplayAsset = input.gameLogAvailable
    ? { kind: "game-log", title: "Game log", status: "Available", tone: "ready", description: "Read the captured actions and turn history.", action: "view-log", actionLabel: "View log" }
    : { kind: "game-log", title: "Game log", status: "Not available", tone: "neutral", description: platform && platform !== "atlas"
      ? "Readable game logs are currently available for Atlas games."
      : "No readable game log is saved on this computer for this game." };
  return [webReplayAsset(input), videoAsset(input), log];
}
