import { describe, expect, it } from "vitest";
import { initialFirstRunReplayPreferences, rawCaptureForFirstRunReplayPreferences } from "../src/shared/firstRunReplayPreferences.js";
import { createDefaultSettings } from "../src/shared/settingsDefaults.js";
import type { RawCaptureSettings, UserSettings } from "../src/shared/types.js";

function settingsWith(rawCapture: Partial<RawCaptureSettings> = {}, settings: Partial<UserSettings> = {}): UserSettings {
  const defaults = createDefaultSettings();
  return { ...defaults, accountUid: "account-one", ...settings, rawCapture: { ...defaults.rawCapture, ...rawCapture } };
}

function consentedSettings(rawCapture: Partial<RawCaptureSettings> = {}): UserSettings {
  return settingsWith({ enabled: true, webReplayAutoUploadEnabled: true, webReplayAutoUploadAccountUid: "account-one", ...rawCapture });
}

function discordSettings(rawCapture: Partial<RawCaptureSettings> = {}): UserSettings {
  return consentedSettings({ visibility: "unlisted", webReplayDiscordShareEnabled: true,
    webReplayDiscordShareAccountUid: "account-one", webReplayDiscordShareHubIds: ["my-hub"], ...rawCapture });
}

describe("initial first-run replay preferences", () => {
  it.each(["private", "unlisted", "public"] as const)("preserves saved %s even before setup completes with all capture and uploads off", (visibility) => {
    const settings = settingsWith({ visibility });
    expect(settings.firstRunComplete).toBe(false);
    expect(initialFirstRunReplayPreferences(settings)).toEqual({ capture: false, atlas: false, tcga: false, visibility });
    expect(settings.rawCapture.visibility).toBe(visibility);
  });

  it.each([
    { firstRunComplete: true },
    { rawCapture: { enabled: true } },
    { rawCapture: { uploadEnabled: true } },
    { rawCapture: { webReplayAutoUploadEnabled: true } },
    { rawCapture: { tcgaWebReplayAutoUploadEnabled: true } }
  ])("preserves an existing visibility choice for %j", (existing) => {
    const settings = settingsWith({ visibility: "private", ...("rawCapture" in existing ? existing.rawCapture : {}) }, "firstRunComplete" in existing ? { firstRunComplete: true } : {});
    expect(initialFirstRunReplayPreferences(settings).visibility).toBe("private");
    settings.rawCapture.visibility = "unlisted";
    expect(initialFirstRunReplayPreferences(settings).visibility).toBe("unlisted");
  });

  it("retains account-bound consent even when verification is unavailable and rejects another account's consent", () => {
    const settings = consentedSettings({ tcgaWebReplayAutoUploadEnabled: true, tcgaWebReplayAutoUploadAccountUid: "other-account" });
    expect(settings.accountLastVerifiedAt).toBe("");
    expect(initialFirstRunReplayPreferences(settings)).toMatchObject({ atlas: true, tcga: false });
    settings.accountUid = "ACCOUNT-ONE";
    expect(initialFirstRunReplayPreferences(settings)).toMatchObject({ atlas: false, tcga: false });
    settings.accountUid = "";
    expect(initialFirstRunReplayPreferences(settings)).toMatchObject({ atlas: false, tcga: false });
  });
});

describe("saving first-run replay preferences", () => {
  it.each(["private", "unlisted", "public"] as const)("honours an explicit %s choice while enabling both lanes together", (visibility) => {
    const settings = settingsWith();
    const before = structuredClone(settings);
    const result = rawCaptureForFirstRunReplayPreferences(settings, { capture: true, atlas: true, tcga: true, visibility }, true);
    expect(result).toMatchObject({ enabled: true, webReplayAutoUploadEnabled: true, webReplayAutoUploadAccountUid: "account-one",
      tcgaWebReplayAutoUploadEnabled: true, tcgaWebReplayAutoUploadAccountUid: "account-one", visibility,
      webReplayDiscordShareEnabled: false, webReplayDiscordShareHubIds: [], uploadEnabled: false });
    expect(settings).toEqual(before);
  });

  it.each([
    { accountUid: "account-one", verified: false },
    { accountUid: "", verified: true },
    { accountUid: "  ", verified: true }
  ])("rejects newly enabled uploads without a verified account: %j", ({ accountUid, verified }) => {
    const settings = settingsWith({}, { accountUid });
    expect(() => rawCaptureForFirstRunReplayPreferences(settings,
      { capture: true, atlas: true, tcga: false, visibility: "public" }, verified)).toThrow("Connect and verify");
  });

  it("requires capture for a newly enabled lane", () => {
    const settings = settingsWith();
    expect(() => rawCaptureForFirstRunReplayPreferences(settings,
      { capture: false, atlas: false, tcga: true, visibility: "public" }, true)).toThrow("Enable interactive replay capture");
  });

  it("preserves a paused existing lane and lets verification-unavailable users revoke it", () => {
    const settings = consentedSettings();
    const preferences = { ...initialFirstRunReplayPreferences(settings), capture: false };
    const paused = rawCaptureForFirstRunReplayPreferences(settings, preferences, false);
    expect(paused).toMatchObject({ enabled: false, webReplayAutoUploadEnabled: true, webReplayAutoUploadAccountUid: "account-one" });
    const revoked = rawCaptureForFirstRunReplayPreferences({ ...settings, rawCapture: paused }, { ...preferences, atlas: false, visibility: "public" }, false);
    expect(revoked).toMatchObject({ enabled: false, webReplayAutoUploadEnabled: false, webReplayAutoUploadAccountUid: "", visibility: "private" });
  });

  it("keeps Discord destinations unlisted even when the draft requests Public", () => {
    const settings = discordSettings();
    const result = rawCaptureForFirstRunReplayPreferences(settings,
      { capture: true, atlas: true, tcga: true, visibility: "public" }, true);
    expect(result).toMatchObject({ webReplayAutoUploadEnabled: true, tcgaWebReplayAutoUploadEnabled: true,
      visibility: "unlisted", webReplayDiscordShareEnabled: true, webReplayDiscordShareHubIds: ["my-hub"] });
  });

  it("switches upload platforms without transiently revoking Discord consent", () => {
    const settings = discordSettings();
    const result = rawCaptureForFirstRunReplayPreferences(settings,
      { capture: true, atlas: false, tcga: true, visibility: "public" }, true);
    expect(result).toMatchObject({ webReplayAutoUploadEnabled: false, webReplayAutoUploadAccountUid: "",
      tcgaWebReplayAutoUploadEnabled: true, tcgaWebReplayAutoUploadAccountUid: "account-one", visibility: "unlisted",
      webReplayDiscordShareEnabled: true, webReplayDiscordShareAccountUid: "account-one", webReplayDiscordShareHubIds: ["my-hub"] });
  });

  it("revokes both lanes and Discord while preserving the final-lane Private safeguard", () => {
    const settings = discordSettings({ tcgaWebReplayAutoUploadEnabled: true, tcgaWebReplayAutoUploadAccountUid: "account-one" });
    const result = rawCaptureForFirstRunReplayPreferences(settings,
      { capture: true, atlas: false, tcga: false, visibility: "public" }, false);
    expect(result).toMatchObject({ webReplayAutoUploadEnabled: false, webReplayAutoUploadAccountUid: "",
      tcgaWebReplayAutoUploadEnabled: false, tcgaWebReplayAutoUploadAccountUid: "", visibility: "private",
      webReplayDiscordShareEnabled: false, webReplayDiscordShareAccountUid: "", webReplayDiscordShareHubIds: [] });
  });

  it("does not resurrect another account's Discord or upload consent", () => {
    const settings = discordSettings({ webReplayAutoUploadAccountUid: "other-account", webReplayDiscordShareAccountUid: "other-account",
      tcgaWebReplayAutoUploadEnabled: true, tcgaWebReplayAutoUploadAccountUid: "other-account" });
    const result = rawCaptureForFirstRunReplayPreferences(settings,
      { capture: true, atlas: true, tcga: false, visibility: "public" }, true);
    expect(result).toMatchObject({ webReplayAutoUploadEnabled: true, webReplayAutoUploadAccountUid: "account-one",
      tcgaWebReplayAutoUploadEnabled: false, tcgaWebReplayAutoUploadAccountUid: "", visibility: "public",
      webReplayDiscordShareEnabled: false, webReplayDiscordShareAccountUid: "", webReplayDiscordShareHubIds: [] });
  });

  it("preserves unrelated raw-capture settings without mutating saved source preferences", () => {
    const settings = settingsWith({ enabled: true, uploadEnabled: true, endpoint: "https://example.test/replays", apiKey: "fixture-key", visibility: "private" });
    const before = structuredClone(settings);
    const result = rawCaptureForFirstRunReplayPreferences(settings, initialFirstRunReplayPreferences(settings), false);
    expect(result).toEqual(settings.rawCapture);
    expect(settings).toEqual(before);
  });
});
