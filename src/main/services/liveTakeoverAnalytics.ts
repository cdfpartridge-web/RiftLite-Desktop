import { app } from "electron";
import { randomUUID } from "node:crypto";

import type { LiveTakeoverTelemetryPayload } from "../../shared/types.js";
import type { RiftLiteStore } from "./store.js";

const DEFAULT_ANALYTICS_URL = "https://www.riftlite.com/api/app/live-takeover/analytics";
const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]{16,80}$/;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{16,100}$/;
const CHANNEL_PATTERN = /^[a-z0-9_]{4,25}$/;
const EVENTS = new Set([
  "impression",
  "playing",
  "checkpoint",
  "paused",
  "stopped",
  "dismissed",
]);

let telemetryQueue: Promise<void> = Promise.resolve();

function analyticsUrl(): string {
  const override = process.env.RIFTLITE_LIVE_TAKEOVER_ANALYTICS_URL?.trim();
  if (!override) return DEFAULT_ANALYTICS_URL;
  try {
    const url = new URL(override);
    if (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      return url.toString();
    }
  } catch {
    // Fall through to the trusted production endpoint.
  }
  return DEFAULT_ANALYTICS_URL;
}

function normalizePayload(payload: LiveTakeoverTelemetryPayload): LiveTakeoverTelemetryPayload {
  const runId = String(payload?.runId ?? "").trim();
  const token = String(payload?.token ?? "").trim();
  const sessionId = String(payload?.sessionId ?? "").trim();
  const channelLogin = String(payload?.channelLogin ?? "").trim().toLowerCase();
  const watchedSeconds = Number(payload?.watchedSeconds);
  const startedAt = new Date(String(payload?.startedAt ?? ""));
  const occurredAt = new Date(String(payload?.occurredAt ?? ""));
  if (
    !RUN_ID_PATTERN.test(runId)
    || token.length < 40
    || token.length > 200
    || !SESSION_ID_PATTERN.test(sessionId)
    || !CHANNEL_PATTERN.test(channelLogin)
    || !EVENTS.has(payload.event)
    || typeof payload.hasPlayed !== "boolean"
    || !Number.isSafeInteger(watchedSeconds)
    || watchedSeconds < 0
    || watchedSeconds > 24 * 60 * 60
    || Number.isNaN(startedAt.getTime())
    || Number.isNaN(occurredAt.getTime())
  ) {
    throw new Error("Live takeover telemetry is invalid.");
  }
  return {
    runId,
    token,
    sessionId,
    channelLogin,
    event: payload.event,
    hasPlayed: payload.hasPlayed,
    watchedSeconds,
    startedAt: startedAt.toISOString(),
    occurredAt: occurredAt.toISOString(),
  };
}

export async function sendLiveTakeoverTelemetry(
  store: RiftLiteStore,
  payload: LiveTakeoverTelemetryPayload,
): Promise<boolean> {
  if (!app.isPackaged && process.env.RIFTLITE_SEND_DEV_USAGE !== "1") {
    return false;
  }
  const normalized = normalizePayload(payload);
  let settings = await store.getSettings();
  if (!settings.anonymousDiagnosticsEnabled) return false;
  if (!settings.anonymousInstallId) {
    settings = await store.saveSettings({
      anonymousInstallId: randomUUID(),
      anonymousInstallCreatedAt: settings.anonymousInstallCreatedAt || new Date().toISOString(),
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(analyticsUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...normalized,
        installId: settings.anonymousInstallId,
        appVersion: app.getVersion(),
        platform: process.platform,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return true;
  } finally {
    clearTimeout(timeout);
  }
}

export function queueLiveTakeoverTelemetry(
  store: RiftLiteStore,
  payload: LiveTakeoverTelemetryPayload,
): Promise<void> {
  telemetryQueue = telemetryQueue
    .then(async () => {
      await sendLiveTakeoverTelemetry(store, payload);
    })
    .catch((error) => {
      console.warn("[live-takeover] Anonymous analytics failed", error);
    });
  return telemetryQueue;
}
