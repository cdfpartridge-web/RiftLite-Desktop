import type { RawCaptureReplayMetadata } from "./types.js";

export type ReplayDeliveryStageId = "capture" | "result" | "upload" | "processing" | "discord";
export type ReplayDeliveryStageState = "complete" | "active" | "pending" | "failed" | "skipped";

export interface ReplayDeliveryStage {
  id: ReplayDeliveryStageId;
  label: string;
  state: ReplayDeliveryStageState;
  detail: string;
  timestamp?: string;
}

export interface ReplayDeliverySummary {
  statusLabel: string;
  uploadLabel: string;
  discordLabel: string;
}

const REPLAY_AUTH_ERROR_PATTERN = /authentication_required|linked RiftLite account token|device credential is not linked/i;

export function replayDeliveryErrorMessage(value: unknown): string {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) return "";
  if (REPLAY_AUTH_ERROR_PATTERN.test(message)) {
    return "RiftLite account verification is required. Open Account, finish verification or reconnect the same account, then retry. The local replay capture is safe.";
  }
  return message;
}

function replayDiscordEligible(metadata: RawCaptureReplayMetadata | undefined): boolean {
  return Boolean(
    metadata?.webReplayDiscordShareEligible ||
    metadata?.webReplayDiscordShareHubIds?.length ||
    metadata?.discordShareStatus
  );
}

export function replayDeliverySummary(
  metadata: RawCaptureReplayMetadata | undefined,
  captureEnabled = false
): ReplayDeliverySummary {
  if (!metadata) {
    return {
      statusLabel: captureEnabled ? "waiting for next Atlas replay" : "disabled",
      uploadLabel: "No capture yet",
      discordLabel: "Not selected"
    };
  }

  const automaticUpload = Boolean(metadata.webReplayAutoUploadEligible);
  const waitingForResult = automaticUpload && metadata.resultStatus === "pending";
  const discordEligible = replayDiscordEligible(metadata);
  const uploadFailed = metadata.uploadStatus === "failed" || metadata.uploadStatus === "too-large";
  const statusLabel = uploadFailed
    ? metadata.uploadStatus === "too-large" ? "capture too large" : "upload failed"
    : metadata.uploadStatus === "uploaded"
      ? metadata.processingStatus === "ready" ? "ready" : "processing replay"
      : metadata.processingStatus === "uploading"
        ? "uploading replay"
        : waitingForResult
          ? "preparing replay"
          : automaticUpload
            ? "queued for upload"
            : metadata.uploadStatus === "disabled"
              ? "upload disabled"
              : "saved locally";
  const uploadLabel = metadata.uploadedAt
    ? "Uploaded"
    : uploadFailed
      ? "Failed"
      : waitingForResult
        ? "Waiting for score"
        : automaticUpload
          ? "Queued"
          : "Not uploaded";
  const discordLabel = !discordEligible
    ? "Not selected"
    : metadata.discordShareStatus === "shared"
      ? "Shared"
      : metadata.discordShareStatus === "partial"
        ? "Partial"
        : metadata.discordShareStatus === "failed"
          ? "Failed"
          : metadata.uploadStatus === "uploaded"
            ? "Sending"
            : "Queued";

  return { statusLabel, uploadLabel, discordLabel };
}

export function replayDeliveryStages(metadata: RawCaptureReplayMetadata | undefined): ReplayDeliveryStage[] {
  const captureComplete = Boolean(metadata?.localPath || metadata?.captureCompletedAt);
  const resultResolved = metadata?.resultStatus === "resolved" || (
    metadata?.resultStatus === undefined && metadata?.discordShareStatus === "shared"
  );
  const uploadComplete = metadata?.uploadStatus === "uploaded";
  const uploadFailed = metadata?.uploadStatus === "failed" || metadata?.uploadStatus === "too-large";
  const uploadActive = metadata?.processingStatus === "uploading";
  const processingComplete = metadata?.processingStatus === "ready";
  const processingFailed = metadata?.processingStatus === "failed";
  const discordEligible = replayDiscordEligible(metadata);
  const replayError = replayDeliveryErrorMessage(metadata?.error);

  return [
    {
      id: "capture",
      label: "Captured",
      state: captureComplete ? "complete" : "pending",
      detail: captureComplete
        ? `${metadata?.messageCount ?? 0} Atlas frame${metadata?.messageCount === 1 ? "" : "s"} saved locally`
        : "Waiting for the Atlas match capture",
      timestamp: metadata?.captureCompletedAt,
    },
    {
      id: "result",
      label: "Result finalized",
      state: resultResolved ? "complete" : "pending",
      detail: resultResolved
        ? "Completed match score is attached"
        : "Waiting for the completed match score",
      timestamp: metadata?.resultFinalizedAt,
    },
    {
      id: "upload",
      label: "Uploaded",
      state: uploadComplete ? "complete" : uploadFailed ? "failed" : uploadActive ? "active" : "pending",
      detail: uploadComplete
        ? "Raw replay reached RiftLite.com"
        : uploadFailed
          ? replayError || "Upload failed"
          : uploadActive
            ? "Uploading the replay"
            : "Waiting to upload",
      timestamp: uploadComplete ? metadata?.uploadedAt : metadata?.lastUploadAttemptAt,
    },
    {
      id: "processing",
      label: "Processed",
      state: processingComplete
        ? "complete"
        : processingFailed
          ? "failed"
          : uploadComplete || uploadActive
            ? "active"
            : "pending",
      detail: processingComplete
        ? "Web replay is ready to watch"
        : processingFailed
          ? replayError || "Website processing failed"
          : uploadComplete
            ? "Website is interpreting the replay"
            : "Starts after upload",
      timestamp: metadata?.processingUpdatedAt,
    },
    {
      id: "discord",
      label: "Discord delivered",
      state: !discordEligible
        ? "skipped"
        : metadata?.discordShareStatus === "shared"
          ? "complete"
          : metadata?.discordShareStatus === "failed" || metadata?.discordShareStatus === "partial"
            ? "failed"
            : uploadComplete
              ? "active"
              : "pending",
      detail: !discordEligible
        ? "Not selected for a private hub"
        : metadata?.discordShareStatus === "shared"
          ? "Replay link posted to every selected hub"
          : metadata?.discordShareStatus === "partial"
            ? metadata.discordShareError || "Some selected hubs did not receive the link"
            : metadata?.discordShareStatus === "failed"
              ? metadata.discordShareError || "Discord delivery failed"
              : uploadComplete
                ? "Waiting for Discord confirmation"
                : "Starts after the web replay is ready",
      timestamp: metadata?.discordSharedAt || metadata?.discordLastAttemptAt,
    },
  ];
}
