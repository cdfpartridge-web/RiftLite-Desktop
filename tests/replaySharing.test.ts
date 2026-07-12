import { describe, expect, it } from "vitest";

import {
  activeDiscordReplayHubIds,
  rawCaptureSettingsForDiscordHubSelection
} from "../src/shared/replaySharing.js";
import type { UserSettings } from "../src/shared/types.js";

describe("replay Discord sharing consent", () => {
  it("turns selecting the first hub into one atomic account-bound opt-in", () => {
    const settings = replaySettings({
      webReplayDiscordShareEnabled: false,
      webReplayDiscordShareAccountUid: "",
      webReplayDiscordShareHubIds: ["teamuk"],
      visibility: "private"
    });

    const rawCapture = rawCaptureSettingsForDiscordHubSelection(settings, "teamuk", true);

    expect(rawCapture).toMatchObject({
      enabled: true,
      webReplayAutoUploadEnabled: true,
      webReplayAutoUploadAccountUid: "account-1",
      webReplayDiscordShareEnabled: true,
      webReplayDiscordShareAccountUid: "account-1",
      webReplayDiscordShareHubIds: ["teamuk"],
      visibility: "unlisted"
    });
  });

  it("does not render stale destination selections as active consent", () => {
    const settings = replaySettings({
      webReplayDiscordShareEnabled: false,
      webReplayDiscordShareAccountUid: "",
      webReplayDiscordShareHubIds: ["teamuk"]
    });

    expect(activeDiscordReplayHubIds(settings)).toEqual([]);
  });

  it("keeps multiple hubs selected and disables sharing when the final hub is removed", () => {
    const first = replaySettings(rawCaptureSettingsForDiscordHubSelection(replaySettings(), "hub-a", true));
    const second = replaySettings(rawCaptureSettingsForDiscordHubSelection(first, "hub-b", true));
    expect(activeDiscordReplayHubIds(second)).toEqual(["hub-a", "hub-b"]);

    const oneRemaining = replaySettings(rawCaptureSettingsForDiscordHubSelection(second, "hub-a", false));
    expect(activeDiscordReplayHubIds(oneRemaining)).toEqual(["hub-b"]);

    const noneRemaining = replaySettings(rawCaptureSettingsForDiscordHubSelection(oneRemaining, "hub-b", false));
    expect(noneRemaining.rawCapture.webReplayDiscordShareEnabled).toBe(false);
    expect(noneRemaining.rawCapture.webReplayDiscordShareAccountUid).toBe("");
    expect(noneRemaining.rawCapture.webReplayDiscordShareHubIds).toEqual([]);
  });

  it("rejects consent inherited from another account", () => {
    const settings = replaySettings({
      webReplayDiscordShareEnabled: true,
      webReplayDiscordShareAccountUid: "old-account",
      webReplayDiscordShareHubIds: ["teamuk"]
    });
    expect(activeDiscordReplayHubIds(settings)).toEqual([]);
  });
});

function replaySettings(rawCapture: Partial<UserSettings["rawCapture"]> = {}): UserSettings {
  return {
    accountUid: "account-1",
    rawCapture: {
      enabled: true,
      webReplayAutoUploadEnabled: true,
      webReplayAutoUploadAccountUid: "account-1",
      webReplayDiscordShareEnabled: false,
      webReplayDiscordShareAccountUid: "",
      webReplayDiscordShareHubIds: [],
      uploadEnabled: false,
      endpoint: "",
      apiKey: "",
      visibility: "private",
      ...rawCapture
    }
  } as UserSettings;
}
