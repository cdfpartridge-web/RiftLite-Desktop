import type {
  RawCaptureReplayMetadata,
  WebReplayDeliveryErrorClass,
  WebReplayUploadQueueItem,
} from "./types.js";

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
const REPLAY_PROCESSING_ERROR_PATTERN = /replay_processing|processing is still in progress/i;
const REPLAY_INCOMPLETE_MULLIGAN_PATTERN = /opening mulligan|incomplete[_ -]capture|raw_capture_incomplete/i;
const REPLAY_EMPTY_BODY_PATTERN = /empty_body|JSON request body is required/i;
const REPLAY_TOO_LARGE_PATTERN = /body_too_large|too.large|exceeds?.+(?:limit|size)|413/i;

export interface ReplayDeliveryErrorContext {
  code?: string;
  errorClass?: WebReplayDeliveryErrorClass;
  httpStatus?: number;
  nextRetryAt?: string;
}

export function webReplayQueueItemCanBeKeptLocalOnly(item: WebReplayUploadQueueItem): boolean {
  if (item.processingStatus === "ready") return false;
  return item.recommendedAction === "remove-from-queue" || Boolean(
    item.locallyAvailable && ["captured", "queued", "failed", "paused"].includes(item.stage)
  );
}

export function replayDeliveryErrorMessage(
  value: unknown,
  context: ReplayDeliveryErrorContext = {}
): string {
  const message = typeof value === "string" ? value.trim() : "";
  const searchable = `${context.code ?? ""} ${message}`;
  if (REPLAY_AUTH_ERROR_PATTERN.test(searchable) || context.errorClass === "authentication") {
    return "RiftLite account verification is required. Open Account, finish verification or reconnect the same account, then retry. The local replay capture is safe.";
  }
  if (REPLAY_PROCESSING_ERROR_PATTERN.test(searchable) || context.httpStatus === 425) {
    return context.nextRetryAt
      ? `The upload is complete and the website is still preparing this replay. RiftLite will check again after ${formatRetryTime(context.nextRetryAt)}.`
      : "The upload is complete and the website is still preparing this replay. RiftLite will check again automatically.";
  }
  if (REPLAY_INCOMPLETE_MULLIGAN_PATTERN.test(searchable)) {
    return "The opening mulligan was not captured. The replay can still be uploaded as a partial replay, and the missing opening will be clearly marked.";
  }
  if (REPLAY_EMPTY_BODY_PATTERN.test(searchable)) {
    return "RiftLite could not finish the website upload request. Retry it; if it repeats, update RiftLite. The local replay capture is safe.";
  }
  if (REPLAY_TOO_LARGE_PATTERN.test(searchable) || context.httpStatus === 413) {
    return "This capture is larger than the website upload limit. It remains available locally.";
  }
  if (context.errorClass === "network") {
    return context.nextRetryAt
      ? `The website could not be reached. RiftLite will retry after ${formatRetryTime(context.nextRetryAt)}; the local replay capture is safe.`
      : "The website could not be reached. RiftLite will retry automatically; the local replay capture is safe.";
  }
  if (!message && context.errorClass === "server") {
    return "The RiftLite website could not process this replay. Retry it in a moment; the local replay capture is safe.";
  }
  if (!message && context.errorClass === "storage") {
    return "The local replay file could not be read. Open the technical details for the saved-file location.";
  }
  if (!message) return "";
  return message;
}

function formatRetryTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "the scheduled retry";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  const statusLabel = replayDeliveryStatusLabel(metadata, automaticUpload, waitingForResult, uploadFailed);
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

function replayDeliveryStatusLabel(
  metadata: RawCaptureReplayMetadata,
  automaticUpload: boolean,
  waitingForResult: boolean,
  uploadFailed: boolean
): string {
  const stage = metadata.deliveryStage;
  if (stage === "ready" || metadata.processingStatus === "ready") {
    return metadata.partialWarnings?.length ? "ready with warning" : "ready";
  }
  if (stage === "processing" || metadata.processingStatus === "processing") return "processing replay";
  if (stage === "authenticating") return "checking account";
  if (stage === "initializing") return "starting upload";
  if (stage === "uploading") return "uploading replay";
  if (stage === "completing") return "finishing upload";
  if (stage === "paused") return "waiting to retry";
  if (uploadFailed || stage === "failed") {
    return metadata.uploadStatus === "too-large" ? "capture too large" : "upload failed";
  }
  if (waitingForResult) return "preparing replay";
  if (automaticUpload || stage === "queued") return "queued for upload";
  if (metadata.uploadStatus === "disabled") return "upload disabled";
  return "saved locally";
}

export function replayDeliveryStages(metadata: RawCaptureReplayMetadata | undefined): ReplayDeliveryStage[] {
  const captureComplete = Boolean(metadata?.localPath || metadata?.captureCompletedAt);
  const resultResolved = metadata?.resultStatus === "resolved" || (
    metadata?.resultStatus === undefined && metadata?.discordShareStatus === "shared"
  );
  const uploadComplete = metadata?.uploadStatus === "uploaded";
  const uploadFailed = metadata?.uploadStatus === "failed" || metadata?.uploadStatus === "too-large";
  const uploadActive = metadata?.processingStatus === "uploading" || (
    metadata?.deliveryStage === "authenticating" ||
    metadata?.deliveryStage === "initializing" ||
    metadata?.deliveryStage === "uploading" ||
    metadata?.deliveryStage === "completing"
  );
  const processingComplete = metadata?.processingStatus === "ready";
  const processingFailed = metadata?.processingStatus === "failed";
  const discordEligible = replayDiscordEligible(metadata);
  const replayError = replayDeliveryErrorMessage(metadata?.error, {
    code: metadata?.lastErrorCode,
    errorClass: metadata?.lastErrorClass,
    httpStatus: metadata?.lastHttpStatus,
    nextRetryAt: metadata?.nextRetryAt,
  });

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
