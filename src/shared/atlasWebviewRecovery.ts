import type { AtlasWebviewRecoveryMode, CaptureEvent } from "./types.js";

export const ATLAS_RELOAD_STORM_WINDOW_MS = 20_000;
export const ATLAS_RELOAD_STORM_THRESHOLD = 4;

export function atlasExplicitRepairUrl(
  repairToken: number,
  mode: AtlasWebviewRecoveryMode = "runtime"
): string {
  const safeToken = Number.isFinite(repairToken) ? Math.max(0, Math.trunc(repairToken)) : 0;
  return mode === "runtime"
    ? `https://play.riftatlas.com/?riftlite_repair=${safeToken}`
    : `https://play.riftatlas.com/sign-in?redirect_url=%2F&riftlite_repair=${safeToken}`;
}

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
  const emptyShellDetected = event.kind === "debug" && event.payload.reason === "atlas-app-shell-empty";
  return {
    captureReadyAt,
    suggested: current.suggested || emptyShellDetected || captureReadyAt.length >= ATLAS_RELOAD_STORM_THRESHOLD
  };
}

export function shouldAutoRepairAtlasEmptyShell(
  event: Pick<CaptureEvent, "kind" | "platform" | "payload">,
  alreadyRepaired: boolean
): boolean {
  return !alreadyRepaired &&
    event.platform === "atlas" &&
    event.kind === "debug" &&
    event.payload.reason === "atlas-app-shell-empty";
}

export function shouldEscalateAtlasEmptyShell(
  event: Pick<CaptureEvent, "kind" | "platform" | "payload">,
  runtimeRepairAttempted: boolean
): boolean {
  return runtimeRepairAttempted &&
    event.platform === "atlas" &&
    event.kind === "debug" &&
    event.payload.reason === "atlas-app-shell-empty";
}

export interface AtlasWebviewStorageSession {
  clearCache(): Promise<void>;
  clearCodeCaches?(options: { urls: string[] }): Promise<void>;
  closeAllConnections?(): Promise<void>;
  clearStorageData(options: {
    origin: string;
    storages: AtlasWebviewStorageType[];
  }): Promise<void>;
  flushStorageData(): void;
}

export type AtlasWebviewStorageType =
  | "cookies"
  | "filesystem"
  | "indexdb"
  | "localstorage"
  | "serviceworkers"
  | "cachestorage"
  | "websql"
  | "shadercache";

export interface AtlasWebviewCleanupResult {
  completed: string[];
  warnings: string[];
}

export function validAtlasWebviewRecoveryMode(value: unknown): AtlasWebviewRecoveryMode | null {
  return value === "runtime" || value === "sign-in" || value === "site-data" ? value : null;
}

export async function clearAtlasWebviewRuntime(
  session: AtlasWebviewStorageSession,
  stageTimeoutMs = 8_000
): Promise<AtlasWebviewCleanupResult> {
  const result = emptyCleanupResult();
  if (session.clearCodeCaches) {
    await cleanupStage(result, "code-cache", () => session.clearCodeCaches!({ urls: ["https://play.riftatlas.com"] }), stageTimeoutMs);
  }
  await cleanupStage(result, "http-cache", () => session.clearCache(), stageTimeoutMs);
  await cleanupStage(result, "serviceworkers-and-cache-storage", () => session.clearStorageData({
    origin: "https://play.riftatlas.com",
    storages: ["serviceworkers", "cachestorage"]
  }), stageTimeoutMs);
  if (session.closeAllConnections) {
    await cleanupStage(result, "network-connections", () => session.closeAllConnections!(), stageTimeoutMs);
  }
  try {
    session.flushStorageData();
    result.completed.push("storage-flush");
  } catch (error) {
    result.warnings.push(cleanupWarning("storage-flush", error));
  }
  return result;
}

export async function clearAtlasWebviewSiteData(
  session: AtlasWebviewStorageSession,
  stageTimeoutMs = 8_000
): Promise<AtlasWebviewCleanupResult> {
  const result = await clearAtlasWebviewRuntime(session, stageTimeoutMs);
  const siteStorage: AtlasWebviewStorageType[] = [
    "cookies",
    "filesystem",
    "indexdb",
    "localstorage",
    "serviceworkers",
    "cachestorage",
    "websql",
    "shadercache"
  ];
  await cleanupStage(result, "atlas-site-data", () => session.clearStorageData({
    origin: "https://play.riftatlas.com",
    storages: siteStorage
  }), stageTimeoutMs);
  for (const origin of ["https://clerk.riftatlas.com", "https://accounts.riftatlas.com"]) {
    await cleanupStage(result, `authentication-site-data:${new URL(origin).hostname}`, () => session.clearStorageData({
      origin,
      storages: ["cookies", "indexdb", "localstorage", "serviceworkers", "cachestorage"]
    }), stageTimeoutMs);
  }
  if (session.closeAllConnections) {
    await cleanupStage(result, "site-reset-network-connections", () => session.closeAllConnections!(), stageTimeoutMs);
  }
  try {
    session.flushStorageData();
    result.completed.push("site-reset-storage-flush");
  } catch (error) {
    result.warnings.push(cleanupWarning("site-reset-storage-flush", error));
  }
  return result;
}

function emptyCleanupResult(): AtlasWebviewCleanupResult {
  return { completed: [], warnings: [] };
}

async function cleanupStage(
  result: AtlasWebviewCleanupResult,
  stage: string,
  operation: () => Promise<void>,
  timeoutMs: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms.`)), timeoutMs);
      })
    ]);
    result.completed.push(stage);
  } catch (error) {
    result.warnings.push(cleanupWarning(stage, error));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function cleanupWarning(stage: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${stage}: ${message.slice(0, 240)}`;
}
