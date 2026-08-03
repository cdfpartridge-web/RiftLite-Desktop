import type { RawCaptureSettings, UserSettings } from "./types.js";

export type WebReplayUploadPlatform = "atlas" | "tcga";

export function activeDiscordReplayHubIds(
  settings: Pick<UserSettings, "accountUid" | "rawCapture">
): string[] {
  const accountUid = String(settings.accountUid ?? "").trim();
  const consentUid = String(settings.rawCapture.webReplayDiscordShareAccountUid ?? "").trim();
  const uploadLaneEnabled = replayUploadLaneEnabledForAccount(settings, accountUid);
  if (
    settings.rawCapture.webReplayDiscordShareEnabled !== true ||
    !accountUid ||
    consentUid !== accountUid ||
    !uploadLaneEnabled
  ) {
    return [];
  }
  return normalizedHubIds(settings.rawCapture.webReplayDiscordShareHubIds);
}

export function rawCaptureSettingsForDiscordHubSelection(
  settings: Pick<UserSettings, "accountUid" | "rawCapture">,
  hubId: string,
  selected: boolean
): RawCaptureSettings {
  const accountUid = String(settings.accountUid ?? "").trim();
  const normalizedHubId = String(hubId ?? "").trim();
  const currentHubIds = activeDiscordReplayHubIds(settings);
  const hubIds = normalizedHubId
    ? normalizedHubIds(selected
      ? [...currentHubIds, normalizedHubId]
      : currentHubIds.filter((value) => value !== normalizedHubId))
    : currentHubIds;
  const enabled = Boolean(
    accountUid &&
    hubIds.length &&
    replayUploadLaneEnabledForAccount(settings, accountUid)
  );
  return {
    ...settings.rawCapture,
    webReplayDiscordShareEnabled: enabled,
    webReplayDiscordShareAccountUid: enabled ? accountUid : "",
    webReplayDiscordShareHubIds: enabled ? hubIds : [],
    visibility: enabled
      ? "unlisted"
      : currentHubIds.length
        ? "private"
        : settings.rawCapture.visibility
  };
}

/**
 * Applies one platform's upload consent without accidentally changing the
 * other platform. Enabling the first lane for an account resets visibility to
 * Private and does not resurrect an old Discord-sharing choice. Revoking the
 * final lane also revokes Discord sharing locally, even when account
 * verification is temporarily unavailable.
 */
export function rawCaptureSettingsForPlatformUpload(
  settings: Pick<UserSettings, "accountUid" | "rawCapture">,
  platform: WebReplayUploadPlatform,
  enabled: boolean
): RawCaptureSettings {
  const accountUid = String(settings.accountUid ?? "").trim();
  const atlasEnabled = uploadLaneEnabledForAccount(settings.rawCapture, "atlas", accountUid);
  const tcgaEnabled = uploadLaneEnabledForAccount(settings.rawCapture, "tcga", accountUid);
  const anyLaneWasEnabled = atlasEnabled || tcgaEnabled;
  const nextAtlasEnabled = platform === "atlas" ? enabled : atlasEnabled;
  const nextTcgaEnabled = platform === "tcga" ? enabled : tcgaEnabled;
  const anyLaneRemainsEnabled = nextAtlasEnabled || nextTcgaEnabled;
  const keepDiscordConsent = anyLaneWasEnabled && anyLaneRemainsEnabled;
  const enablingFirstLane = enabled && !anyLaneWasEnabled;
  const revokingDiscordConsent = settings.rawCapture.webReplayDiscordShareEnabled === true && !keepDiscordConsent;

  return {
    ...settings.rawCapture,
    enabled: enabled ? true : settings.rawCapture.enabled,
    webReplayAutoUploadEnabled: nextAtlasEnabled,
    webReplayAutoUploadAccountUid: nextAtlasEnabled ? accountUid : "",
    tcgaWebReplayAutoUploadEnabled: nextTcgaEnabled,
    tcgaWebReplayAutoUploadAccountUid: nextTcgaEnabled ? accountUid : "",
    webReplayDiscordShareEnabled: keepDiscordConsent
      ? settings.rawCapture.webReplayDiscordShareEnabled
      : false,
    webReplayDiscordShareAccountUid: keepDiscordConsent
      ? settings.rawCapture.webReplayDiscordShareAccountUid
      : "",
    webReplayDiscordShareHubIds: keepDiscordConsent
      ? settings.rawCapture.webReplayDiscordShareHubIds
      : [],
    visibility: enablingFirstLane || revokingDiscordConsent ? "private" : settings.rawCapture.visibility
  };
}

function replayUploadLaneEnabledForAccount(
  settings: Pick<UserSettings, "accountUid" | "rawCapture">,
  accountUid: string
): boolean {
  if (!accountUid) return false;
  const atlasEnabled = settings.rawCapture.webReplayAutoUploadEnabled === true &&
    String(settings.rawCapture.webReplayAutoUploadAccountUid ?? "").trim() === accountUid;
  const tcgaEnabled = settings.rawCapture.tcgaWebReplayAutoUploadEnabled === true &&
    String(settings.rawCapture.tcgaWebReplayAutoUploadAccountUid ?? "").trim() === accountUid;
  return atlasEnabled || tcgaEnabled;
}

function uploadLaneEnabledForAccount(
  settings: RawCaptureSettings,
  platform: WebReplayUploadPlatform,
  accountUid: string
): boolean {
  if (!accountUid) return false;
  return platform === "atlas"
    ? settings.webReplayAutoUploadEnabled === true &&
      String(settings.webReplayAutoUploadAccountUid ?? "").trim() === accountUid
    : settings.tcgaWebReplayAutoUploadEnabled === true &&
      String(settings.tcgaWebReplayAutoUploadAccountUid ?? "").trim() === accountUid;
}

function normalizedHubIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))).sort();
}
