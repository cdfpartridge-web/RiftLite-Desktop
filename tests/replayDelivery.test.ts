import { describe, expect, it } from "vitest";

import { replayDeliveryStages } from "../src/shared/replayDelivery.js";
import type { RawCaptureReplayMetadata } from "../src/shared/types.js";

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
});
