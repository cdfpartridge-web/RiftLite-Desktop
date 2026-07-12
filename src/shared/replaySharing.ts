import type { RawCaptureSettings, UserSettings } from "./types.js";

export function activeDiscordReplayHubIds(
  settings: Pick<UserSettings, "accountUid" | "rawCapture">
): string[] {
  const accountUid = String(settings.accountUid ?? "").trim();
  const consentUid = String(settings.rawCapture.webReplayDiscordShareAccountUid ?? "").trim();
  if (
    settings.rawCapture.webReplayDiscordShareEnabled !== true ||
    !accountUid ||
    consentUid !== accountUid
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
  const enabled = Boolean(accountUid && hubIds.length);
  return {
    ...settings.rawCapture,
    enabled: enabled ? true : settings.rawCapture.enabled,
    webReplayAutoUploadEnabled: enabled ? true : settings.rawCapture.webReplayAutoUploadEnabled,
    webReplayAutoUploadAccountUid: enabled ? accountUid : settings.rawCapture.webReplayAutoUploadAccountUid,
    webReplayDiscordShareEnabled: enabled,
    webReplayDiscordShareAccountUid: enabled ? accountUid : "",
    webReplayDiscordShareHubIds: hubIds,
    visibility: enabled ? "unlisted" : settings.rawCapture.visibility
  };
}

function normalizedHubIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))).sort();
}
