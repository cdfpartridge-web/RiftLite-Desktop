import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../src/shared/settingsDefaults.js";

describe("device settings defaults", () => {
  it("does not share nested preferences or consent between consumers", () => {
    const first = createDefaultSettings();
    const second = createDefaultSettings();
    first.rawCapture.enabled = true;
    first.rawCapture.webReplayAutoUploadEnabled = true;
    first.rawCapture.webReplayAutoUploadAccountUid = "first-device-account";
    first.rawCapture.webReplayDiscordShareHubIds!.push("private-hub");
    first.overlayDisplay.showBranding = false;
    first.replayCustomFlagTypes.push("First device flag");
    first.deckTrackerPinnedCards["first-deck"] = ["first-card"];
    first.privateHubWebReplayGrantKeys!.push("first-device-grant");

    for (const other of [second, createDefaultSettings()]) {
      expect(other.rawCapture).toMatchObject({
        enabled: false, webReplayAutoUploadEnabled: false, webReplayAutoUploadAccountUid: "",
        webReplayDiscordShareHubIds: []
      });
      expect(other.overlayDisplay.showBranding).toBe(true);
      expect(other.replayCustomFlagTypes).not.toContain("First device flag");
      expect(other.deckTrackerPinnedCards).toEqual({});
      expect(other.privateHubWebReplayGrantKeys).toEqual([]);
    }
  });

  it("requires onboarding and local consent on a new device", () => {
    const settings = createDefaultSettings();
    expect(settings.firstRunComplete).toBe(false);
    expect(settings.lastSeenVersion).toBe("");
    expect(settings.accountUid).toBe("");
    expect(settings.firebaseRefreshToken).toBe("");
    expect(settings.rawCapture).toMatchObject({
      enabled: false,
      webReplayAutoUploadEnabled: false,
      tcgaWebReplayAutoUploadEnabled: false,
      webReplayDiscordShareEnabled: false,
      uploadEnabled: false,
      apiKey: "",
      visibility: "public"
    });
  });
});
