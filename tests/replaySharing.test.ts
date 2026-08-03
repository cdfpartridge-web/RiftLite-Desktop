import { describe, expect, it } from "vitest";

import {
  activeDiscordReplayHubIds,
  rawCaptureSettingsForDiscordHubSelection,
  rawCaptureSettingsForPlatformUpload
} from "../src/shared/replaySharing.js";
import type { UserSettings } from "../src/shared/types.js";

describe("replay Discord sharing consent", () => {
  it("binds the first hub to an already-consented upload lane without changing lane consent", () => {
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

  it("supports TCGA-only sharing without silently enabling Atlas", () => {
    const settings = replaySettings({
      webReplayAutoUploadEnabled: false,
      webReplayAutoUploadAccountUid: "",
      tcgaWebReplayAutoUploadEnabled: true,
      tcgaWebReplayAutoUploadAccountUid: "account-1"
    });

    const rawCapture = rawCaptureSettingsForDiscordHubSelection(settings, "tcga-hub", true);

    expect(rawCapture).toMatchObject({
      webReplayAutoUploadEnabled: false,
      webReplayAutoUploadAccountUid: "",
      tcgaWebReplayAutoUploadEnabled: true,
      tcgaWebReplayAutoUploadAccountUid: "account-1",
      webReplayDiscordShareEnabled: true,
      webReplayDiscordShareHubIds: ["tcga-hub"],
      visibility: "unlisted"
    });
  });

  it("does not let Discord selection create upload consent when every lane is off", () => {
    const settings = replaySettings({
      webReplayAutoUploadEnabled: false,
      webReplayAutoUploadAccountUid: "",
      tcgaWebReplayAutoUploadEnabled: false,
      tcgaWebReplayAutoUploadAccountUid: ""
    });

    const rawCapture = rawCaptureSettingsForDiscordHubSelection(settings, "teamuk", true);

    expect(rawCapture.webReplayAutoUploadEnabled).toBe(false);
    expect(rawCapture.tcgaWebReplayAutoUploadEnabled).toBe(false);
    expect(rawCapture.webReplayDiscordShareEnabled).toBe(false);
    expect(rawCapture.webReplayDiscordShareHubIds).toEqual([]);
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
    expect(noneRemaining.rawCapture.visibility).toBe("private");
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

describe("platform Web Replay consent", () => {
  it("enables the first lane privately without reviving inherited sharing", () => {
    const settings = replaySettings({
      webReplayAutoUploadEnabled: false,
      webReplayAutoUploadAccountUid: "old-account",
      visibility: "public",
      webReplayDiscordShareEnabled: true,
      webReplayDiscordShareAccountUid: "account-1",
      webReplayDiscordShareHubIds: ["old-hub"]
    });

    const rawCapture = rawCaptureSettingsForPlatformUpload(settings, "atlas", true);

    expect(rawCapture).toMatchObject({
      enabled: true,
      webReplayAutoUploadEnabled: true,
      webReplayAutoUploadAccountUid: "account-1",
      tcgaWebReplayAutoUploadEnabled: false,
      visibility: "private",
      webReplayDiscordShareEnabled: false,
      webReplayDiscordShareAccountUid: "",
      webReplayDiscordShareHubIds: []
    });
  });

  it("preserves Atlas and Discord consent when TCGA is added", () => {
    const settings = replaySettings({
      visibility: "unlisted",
      webReplayDiscordShareEnabled: true,
      webReplayDiscordShareAccountUid: "account-1",
      webReplayDiscordShareHubIds: ["hub-a"]
    });

    const rawCapture = rawCaptureSettingsForPlatformUpload(settings, "tcga", true);

    expect(rawCapture).toMatchObject({
      webReplayAutoUploadEnabled: true,
      webReplayAutoUploadAccountUid: "account-1",
      tcgaWebReplayAutoUploadEnabled: true,
      tcgaWebReplayAutoUploadAccountUid: "account-1",
      visibility: "unlisted",
      webReplayDiscordShareEnabled: true,
      webReplayDiscordShareHubIds: ["hub-a"]
    });
  });

  it("keeps sharing when one lane is revoked and clears it with the final lane", () => {
    const both = replaySettings({
      tcgaWebReplayAutoUploadEnabled: true,
      tcgaWebReplayAutoUploadAccountUid: "account-1",
      visibility: "unlisted",
      webReplayDiscordShareEnabled: true,
      webReplayDiscordShareAccountUid: "account-1",
      webReplayDiscordShareHubIds: ["hub-a"]
    });

    const tcgaOnly = replaySettings(rawCaptureSettingsForPlatformUpload(both, "atlas", false));
    expect(tcgaOnly.rawCapture.tcgaWebReplayAutoUploadEnabled).toBe(true);
    expect(tcgaOnly.rawCapture.webReplayDiscordShareEnabled).toBe(true);

    const none = rawCaptureSettingsForPlatformUpload(tcgaOnly, "tcga", false);
    expect(none.webReplayAutoUploadEnabled).toBe(false);
    expect(none.tcgaWebReplayAutoUploadEnabled).toBe(false);
    expect(none.webReplayDiscordShareEnabled).toBe(false);
    expect(none.webReplayDiscordShareAccountUid).toBe("");
    expect(none.webReplayDiscordShareHubIds).toEqual([]);
    expect(none.visibility).toBe("private");
  });

  it("allows dormant consent to be revoked while global capture is off", () => {
    const settings = replaySettings({
      enabled: false,
      webReplayDiscordShareEnabled: true,
      webReplayDiscordShareAccountUid: "account-1",
      webReplayDiscordShareHubIds: ["hub-a"]
    });

    expect(activeDiscordReplayHubIds(settings)).toEqual(["hub-a"]);
    const none = rawCaptureSettingsForPlatformUpload(settings, "atlas", false);
    expect(none.enabled).toBe(false);
    expect(none.webReplayAutoUploadEnabled).toBe(false);
    expect(none.webReplayDiscordShareEnabled).toBe(false);
    expect(none.webReplayDiscordShareHubIds).toEqual([]);
    expect(none.visibility).toBe("private");
  });

  it("resumes dormant capture without changing its provider or sharing choices", () => {
    const settings = replaySettings({
      enabled: false,
      visibility: "unlisted",
      webReplayDiscordShareEnabled: true,
      webReplayDiscordShareAccountUid: "account-1",
      webReplayDiscordShareHubIds: ["hub-a"]
    });

    const resumed = rawCaptureSettingsForPlatformUpload(settings, "atlas", true);
    expect(resumed.enabled).toBe(true);
    expect(resumed.webReplayAutoUploadEnabled).toBe(true);
    expect(resumed.tcgaWebReplayAutoUploadEnabled).toBe(false);
    expect(resumed.webReplayDiscordShareEnabled).toBe(true);
    expect(resumed.webReplayDiscordShareHubIds).toEqual(["hub-a"]);
    expect(resumed.visibility).toBe("unlisted");
  });
});

function replaySettings(rawCapture: Partial<UserSettings["rawCapture"]> = {}): UserSettings {
  return {
    accountUid: "account-1",
    rawCapture: {
      enabled: true,
      webReplayAutoUploadEnabled: true,
      webReplayAutoUploadAccountUid: "account-1",
      tcgaWebReplayAutoUploadEnabled: false,
      tcgaWebReplayAutoUploadAccountUid: "",
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
