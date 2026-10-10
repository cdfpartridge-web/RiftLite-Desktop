import { activeDiscordReplayHubIds, rawCaptureSettingsForPlatformUpload } from "./replaySharing.js";
import type { RawCaptureSettings, UserSettings } from "./types.js";

export interface FirstRunReplayPreferences {
  capture: boolean;
  atlas: boolean;
  tcga: boolean;
  visibility: RawCaptureSettings["visibility"];
}

type ReplaySettings = Pick<UserSettings, "accountUid" | "rawCapture">;

export function initialFirstRunReplayPreferences(
  settings: ReplaySettings
): FirstRunReplayPreferences {
  const raw = settings.rawCapture;
  return {
    capture: raw.enabled,
    ...boundUploadLanes(settings),
    visibility: raw.visibility
  };
}

/** Apply only explicit setup choices; account identity remains bound to each lane. */
export function rawCaptureForFirstRunReplayPreferences(
  settings: ReplaySettings,
  preferences: FirstRunReplayPreferences,
  accountVerified: boolean
): RawCaptureSettings {
  const current = boundUploadLanes(settings);
  const enabling = (preferences.atlas && !current.atlas) || (preferences.tcga && !current.tcga);
  if (enabling && (!accountVerified || !settings.accountUid.trim())) {
    throw new Error("Connect and verify your RiftLite account before enabling online replays.");
  }
  if (enabling && !preferences.capture) {
    throw new Error("Enable interactive replay capture before enabling online replays.");
  }

  let rawCapture = { ...settings.rawCapture };
  // Add new lanes before removing old ones so a simulator switch cannot briefly
  // revoke the last lane and discard otherwise-valid Discord destinations.
  for (const enabled of [true, false]) {
    for (const platform of ["atlas", "tcga"] as const) {
      if (preferences[platform] === enabled && preferences[platform] !== current[platform]) {
        rawCapture = rawCaptureSettingsForPlatformUpload({ ...settings, rawCapture }, platform, enabled);
      }
    }
  }

  const revokedFinalLane = (current.atlas || current.tcga) && !preferences.atlas && !preferences.tcga;
  const discordDestinations = activeDiscordReplayHubIds({ ...settings, rawCapture });
  return {
    ...rawCapture,
    enabled: preferences.capture,
    visibility: revokedFinalLane ? "private" : discordDestinations.length ? "unlisted" : preferences.visibility
  };
}

function boundUploadLanes(settings: ReplaySettings): Pick<FirstRunReplayPreferences, "atlas" | "tcga"> {
  const accountUid = settings.accountUid.trim();
  return {
    atlas: Boolean(accountUid && settings.rawCapture.webReplayAutoUploadEnabled
      && settings.rawCapture.webReplayAutoUploadAccountUid.trim() === accountUid),
    tcga: Boolean(accountUid && settings.rawCapture.tcgaWebReplayAutoUploadEnabled
      && settings.rawCapture.tcgaWebReplayAutoUploadAccountUid.trim() === accountUid)
  };
}
