import type { CaptureEvent } from "./types.js";

export const ATLAS_RELOAD_STORM_WINDOW_MS = 20_000;
export const ATLAS_RELOAD_STORM_THRESHOLD = 4;

export interface AtlasReloadStormState {
  captureReadyAt: number[];
  suggested: boolean;
}

export function initialAtlasReloadStormState(): AtlasReloadStormState {
  return { captureReadyAt: [], suggested: false };
}

export function updateAtlasReloadStormState(
  current: AtlasReloadStormState,
  event: Pick<CaptureEvent, "kind" | "platform" | "payload">,
  now = Date.now()
): AtlasReloadStormState {
  if (event.platform !== "atlas") {
    return current;
  }
  if (
    event.kind === "match-start" ||
    (event.kind === "match-snapshot" && event.payload.active === true)
  ) {
    return initialAtlasReloadStormState();
  }

  const cutoff = now - ATLAS_RELOAD_STORM_WINDOW_MS;
  const captureReadyAt = current.captureReadyAt.filter((capturedAt) => capturedAt >= cutoff);
  if (event.kind === "capture-ready") {
    captureReadyAt.push(now);
  }
  return {
    captureReadyAt,
    suggested: current.suggested || captureReadyAt.length >= ATLAS_RELOAD_STORM_THRESHOLD
  };
}

export interface AtlasWebviewStorageSession {
  clearCache(): Promise<void>;
  clearStorageData(options: {
    origin: string;
    storages: Array<"serviceworkers" | "cachestorage">;
  }): Promise<void>;
  flushStorageData(): void;
}

export async function clearAtlasWebviewRuntime(session: AtlasWebviewStorageSession): Promise<void> {
  await session.clearCache();
  await session.clearStorageData({
    origin: "https://play.riftatlas.com",
    storages: ["serviceworkers", "cachestorage"]
  });
  session.flushStorageData();
}
