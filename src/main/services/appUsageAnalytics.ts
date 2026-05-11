import { app } from "electron";
import { randomUUID } from "node:crypto";
import type { UserSettings } from "../../shared/types.js";
import { RiftLiteStore } from "./store.js";

const HEARTBEAT_URL = "https://www.riftlite.com/api/desktop/heartbeat";

function dayKey(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function needsHeartbeat(settings: UserSettings, appVersion: string): boolean {
  if (!settings.anonymousDiagnosticsEnabled) {
    return false;
  }
  const today = new Date().toISOString().slice(0, 10);
  return dayKey(settings.anonymousUsageLastHeartbeatAt) !== today ||
    settings.anonymousUsageLastHeartbeatVersion !== appVersion;
}

function installSettingsPatch(settings: UserSettings): Partial<UserSettings> {
  if (settings.anonymousInstallId) {
    return {};
  }
  const now = new Date().toISOString();
  return {
    anonymousInstallId: randomUUID(),
    anonymousInstallCreatedAt: settings.anonymousInstallCreatedAt || now,
  };
}

function heartbeatPayload(settings: UserSettings, appVersion: string) {
  return {
    installId: settings.anonymousInstallId,
    appVersion,
    platform: process.platform,
    channel: app.isPackaged ? "desktop-release" : "desktop-dev",
    linkedAccount: Boolean(settings.accountUid || settings.accountHandle || settings.firebaseRefreshToken),
    replayEnabled: settings.replayCaptureEnabled,
    videoReplayEnabled: settings.replayVideoEnabled,
    activePlatforms: [],
    occurredAt: new Date().toISOString(),
  };
}

export async function sendAppUsageHeartbeat(store: RiftLiteStore): Promise<boolean> {
  if (!app.isPackaged && process.env.RIFTLITE_SEND_DEV_USAGE !== "1") {
    return false;
  }

  let settings = await store.getSettings();
  if (!settings.anonymousDiagnosticsEnabled) {
    return false;
  }

  const patch = installSettingsPatch(settings);
  if (Object.keys(patch).length) {
    settings = await store.saveSettings(patch);
  }

  const appVersion = app.getVersion();
  if (!needsHeartbeat(settings, appVersion)) {
    return false;
  }

  const response = await fetch(HEARTBEAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(heartbeatPayload(settings, appVersion)),
  });

  if (!response.ok) {
    throw new Error(`Usage heartbeat failed: HTTP ${response.status}`);
  }

  await store.saveSettings({
    anonymousUsageLastHeartbeatAt: new Date().toISOString(),
    anonymousUsageLastHeartbeatVersion: appVersion,
  });
  return true;
}

export function scheduleAppUsageHeartbeat(store: RiftLiteStore, delayMs = 4_000): void {
  const retryDelays = [delayMs, 60_000, 5 * 60_000, 15 * 60_000];
  let attempt = 0;

  const run = () => {
    const nextDelay = retryDelays[Math.min(attempt, retryDelays.length - 1)];
    attempt += 1;

    setTimeout(() => {
      void sendAppUsageHeartbeat(store).then((sent) => {
        if (sent || attempt >= retryDelays.length) {
          return;
        }
        run();
      }).catch((error) => {
        console.warn("[usage] Anonymous heartbeat failed", error);
        if (attempt < retryDelays.length) {
          run();
        }
      });
    }, nextDelay);
  };

  run();
}
