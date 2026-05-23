import type { UserSettings } from "./types.js";

export function publicCommunitySyncEnabled(settings: Pick<UserSettings, "syncMode" | "communitySyncEnabled">): boolean {
  return settings.syncMode === "community-and-hubs" || settings.syncMode === "community-only" || (settings.syncMode === "custom" && settings.communitySyncEnabled);
}

export function privateHubSyncEnabled(settings: Pick<UserSettings, "syncMode">): boolean {
  return settings.syncMode === "community-and-hubs" || settings.syncMode === "private-hubs-only" || settings.syncMode === "custom";
}

export function teamSyncEnabled(settings: Pick<UserSettings, "syncMode">): boolean {
  return settings.syncMode === "community-and-hubs" || settings.syncMode === "private-hubs-only" || settings.syncMode === "custom";
}

export function syncModePatch(mode: UserSettings["syncMode"]): Partial<UserSettings> {
  return {
    syncMode: mode,
    communitySyncEnabled: mode === "community-and-hubs" || mode === "community-only"
  };
}
