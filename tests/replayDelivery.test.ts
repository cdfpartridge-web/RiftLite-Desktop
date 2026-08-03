import { describe, expect, it } from "vitest";

import { replayDeliveryErrorMessage, replayDeliveryStages, replayDeliverySummary, webReplayQueueItemCanBeKeptLocalOnly } from "../src/shared/replayDelivery.js";
import type { RawCaptureReplayMetadata, WebReplayUploadQueueItem } from "../src/shared/types.js";

function metadata(patch: Partial<RawCaptureReplayMetadata> = {}): RawCaptureReplayMetadata {
  return {
    provider: "riftlite-v2",
    captureSessionId: "capture-1",
    messageCount: 42,
    uploadStatus: "not-uploaded",
    localPath: "C:/replays/capture-1.json",
    captureCompletedAt: "2026-07-13T18:00:00.000Z",
    resultStatus: "pending",
    processingStatus: "pending",
    ...patch,
  };
}

describe("replayDeliveryStages", () => {
  it("keeps a captured replay visibly waiting for its result and upload", () => {
    expect(replayDeliveryStages(metadata()).map((stage) => [stage.id, stage.state])).toEqual([
      ["capture", "complete"],
      ["result", "pending"],
      ["upload", "pending"],
      ["processing", "pending"],
      ["discord", "skipped"],
    ]);
  });

  it("keeps failed uploads removable after the server URL was reserved", () => {
    const item = {
      stage: "failed",
      recommendedAction: "remove-from-queue",
      uploadUrl: "https://riftlite.com/replays/reserved-shell"
    } as WebReplayUploadQueueItem;

    expect(webReplayQueueItemCanBeKeptLocalOnly(item)).toBe(true);
    expect(webReplayQueueItemCanBeKeptLocalOnly({
      ...item,
      stage: "ready",
      recommendedAction: "none"
    })).toBe(false);
    expect(webReplayQueueItemCanBeKeptLocalOnly({
      ...item,
      stage: "paused",
      processingStatus: "ready",
      recommendedAction: "retry"
    })).toBe(false);
    expect(webReplayQueueItemCanBeKeptLocalOnly({
      ...item,
      stage: "queued",
      processingStatus: "pending",
      recommendedAction: "wait",
      locallyAvailable: true,
      uploadUrl: undefined
    })).toBe(true);
  });

  it("describes normal automatic delivery as preparation instead of failure", () => {
    expect(replayDeliverySummary(metadata({
      webReplayAutoUploadEligible: true,
      webReplayDiscordShareEligible: true,
      discordShareStatus: "pending"
    }))).toEqual({
      statusLabel: "preparing replay",
      uploadLabel: "Waiting for score",
      discordLabel: "Queued"
    });
  });

  it("reports every completed automatic delivery stage after a Discord post", () => {
    const stages = replayDeliveryStages(metadata({
      resultStatus: "resolved",
      resultFinalizedAt: "2026-07-13T18:00:05.000Z",
      uploadStatus: "uploaded",
      uploadedAt: "2026-07-13T18:00:08.000Z",
      processingStatus: "ready",
      processingUpdatedAt: "2026-07-13T18:00:10.000Z",
      webReplayDiscordShareEligible: true,
      webReplayDiscordShareHubIds: ["team-uk"],
      discordShareStatus: "shared",
      discordSharedAt: "2026-07-13T18:00:12.000Z",
    }));

    expect(stages.every((stage) => stage.state === "complete")).toBe(true);
    expect(replayDeliverySummary(metadata({
      resultStatus: "resolved",
      uploadStatus: "uploaded",
      uploadedAt: "2026-07-13T18:00:08.000Z",
      processingStatus: "ready",
      webReplayDiscordShareEligible: true,
      discordShareStatus: "shared"
    }))).toEqual({
      statusLabel: "ready",
      uploadLabel: "Uploaded",
      discordLabel: "Shared"
    });
  });

  it("preserves actionable upload and partial Discord failures", () => {
    const uploadFailure = replayDeliveryStages(metadata({
      uploadStatus: "failed",
      processingStatus: "failed",
      error: "Network unavailable",
    }));
    expect(uploadFailure.find((stage) => stage.id === "upload")).toMatchObject({
      state: "failed",
      detail: "Network unavailable",
    });

    const discordFailure = replayDeliveryStages(metadata({
      resultStatus: "resolved",
      uploadStatus: "uploaded",
      processingStatus: "ready",
      webReplayDiscordShareEligible: true,
      discordShareStatus: "partial",
      discordShareError: "One hub is missing reports_channel",
    }));
    expect(discordFailure.find((stage) => stage.id === "discord")).toMatchObject({
      state: "failed",
      detail: "One hub is missing reports_channel",
    });
  });

  it("turns saved authentication JSON into a safe reconnect instruction", () => {
    const raw = 'RiftLite replay init 401: {"error":"A linked RiftLite account token is required.","code":"authentication_required"}';
    expect(replayDeliveryErrorMessage(raw)).toContain("Open Account");
    expect(replayDeliveryErrorMessage(raw)).toContain("local replay capture is safe");
    expect(replayDeliveryStages(metadata({
      uploadStatus: "failed",
      processingStatus: "failed",
      error: raw
    })).find((stage) => stage.id === "upload")?.detail).not.toContain("authentication_required");
  });

  it("treats website processing as a recoverable active state", () => {
    const replay = metadata({
      uploadStatus: "uploaded",
      processingStatus: "processing",
      deliveryStage: "processing",
      lastHttpStatus: 425,
      lastErrorCode: "replay_processing",
      error: "RiftLite replay complete 425: replay_processing",
    });

    expect(replayDeliverySummary(replay).statusLabel).toBe("processing replay");
    expect(replayDeliveryErrorMessage(replay.error, {
      code: replay.lastErrorCode,
      httpStatus: replay.lastHttpStatus,
    })).toContain("check again automatically");
  });

  it("explains incomplete mulligan captures without presenting them as corrupt", () => {
    expect(replayDeliveryErrorMessage("Replay capture is incomplete: The replay did not capture the opening mulligan.", {
      code: "raw_capture_incomplete",
      errorClass: "capture",
    })).toContain("partial replay");
  });

  it("uses the durable delivery stage for upload progress and partial-ready results", () => {
    expect(replayDeliverySummary(metadata({
      webReplayAutoUploadEligible: true,
      resultStatus: "resolved",
      deliveryStage: "authenticating",
    })).statusLabel).toBe("checking account");

    expect(replayDeliverySummary(metadata({
      uploadStatus: "uploaded",
      processingStatus: "ready",
      deliveryStage: "ready",
      partialWarnings: ["Opening mulligan was not captured"],
    })).statusLabel).toBe("ready with warning");
  });
});
