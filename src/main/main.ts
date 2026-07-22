import { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, session as electronSession, shell, webContents as electronWebContents } from "electron";
import type { NativeImage, OpenDialogOptions, SaveDialogOptions, WebContents } from "electron";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { access, appendFile, copyFile, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import ffmpegStaticPath from "ffmpeg-static";
import type {
  ActiveDeckPrep,
  AppNavigationRequest,
  BattlefieldOption,
  CaptureEvent,
  CommunityMatch,
  DeckEntry,
  DeckGuideCardRef,
  DeckGuideSection,
  DeckMatchupGuide,
  DeckNotebook,
  DeckNotebookExport,
  DeckPackageExport,
  DeckPackageImportResult,
  DeckSnapshot,
  DeckTrackerObservation,
  DiscordVoiceJoinResult,
  GamePlatform,
  LfgListing,
  MatchHistoryCsvExportPayload,
  MatchDraft,
  ReplayAnnotation,
  ReplayBundleFrame,
  ReplayBundleVideo,
  ReplayFlag,
  ReplayMp4ExportOptions,
  ReplayPresentationRecordingPayload,
  RawCaptureAppendFramePayload,
  RawCaptureVisibility,
  ReplayRecord,
  ReplaySearchMetadata,
  ReplayScreenshotFrame,
  ReplayVideoAsset,
  ReplayVideoCaptureMode,
  ReplayVideoFinalizeOptions,
  ReplayVideoKeyframeOptions,
  ReplayVideoMergeOptions,
  ReplayVideoSession,
  ReplayVideoStartOptions,
  ReplayVoiceNote,
  ReplayWindowCaptureSource,
  RiftReplayBundle,
  RiftLiteBackupFile,
  RiftLiteBackupOptions,
  RiftLiteBackupSummary,
  SavedDeck,
  ScreenshotResult,
  SpotlightClickPayload,
  UserSettings,
  VisionDeckTrackerStatus
} from "../shared/types.js";
import { emptyDeckMatchupGuide, resolveDeckMatchupGuide, sanitizeDeckNotebookForDeck } from "../shared/deckNotebook.js";
import {
  ATLAS_BATTLEFIELD_SEAT_IPC_CHANNEL,
  AtlasBattlefieldSeatSocketTracker,
  atlasBattlefieldSeatSignalFromFrame,
  atlasSeatCaptureEvent
} from "../shared/atlasSeatTracker.js";
import { atlasCardRenderingCssForUrl } from "../shared/atlasCardRendering.js";
import { clearAtlasWebviewRuntime } from "../shared/atlasWebviewRecovery.js";
import { RIFTLITE_BUILD_IDENTITY } from "../shared/buildIdentity.js";
import { hasVerifiedRiftLiteAccount } from "../shared/accountIdentity.js";
import {
  embeddedWebviewPolicy,
  gamePlatformForTrustedUrl,
  isAllowedEmbeddedNavigation,
  isAllowedGameMainFrameNavigation,
  isAllowedGamePopupNavigation,
  sameWebFrameIdentity,
  type EmbeddedWebviewPolicy
} from "../shared/embeddedContentSecurity.js";
import { GAME_WEBVIEW_PARTITIONS } from "../shared/gameWebview.js";
import { gameWebviewPlatformArgument } from "../shared/gameWebviewIdentity.js";
import {
  activeDiscordReplayHubIds,
  rawCaptureSettingsForDiscordHubSelection
} from "../shared/replaySharing.js";
import {
  RawCaptureIngressLimiter,
  validatedCaptureEvent,
  validatedRawCaptureFrame,
  validatedTcgaResearchEvent
} from "../shared/ipcPayloadSecurity.js";
import {
  TCGA_REPLAY_RESEARCH_BINDING,
  tcgaReplayResearchPageHookSource
} from "../shared/tcgaResearchPageHook.js";
import {
  clearAtlasClerkAuthCookies,
  gamePopupBrowserWindowOptions,
  gamePopupSharesParentSession,
  isAtlasClerkAuthorizationFailureNavigation,
  isAtlasClerkAuthorizationInvalidPage
} from "./services/gamePopupSecurity.js";
import {
  isReplayMediaFilename,
  matchingMissingReplayIdForMedia,
  replayMediaCapturedAt,
  replayMediaDurationMsFromFfmpegOutput,
  replayMediaMimeType,
  replayMediaPlatform
} from "../shared/replayMediaRecovery.js";
import { detectBrowsers } from "./services/browserDetection.js";
import { scheduleAppUsageHeartbeat } from "./services/appUsageAnalytics.js";
import { AtlasEmptyShellMainRecoveryGuard } from "./services/atlasEmptyShellMainRecovery.js";
import { AccountCloudSyncQueue } from "./services/accountCloudSyncQueue.js";
import { runAccountCloudRestore } from "./services/accountCloudRestoreCoordinator.js";
import { CaptureCoordinator } from "./services/captureCoordinator.js";
import { CaptureDiagnostics } from "./services/captureDiagnostics.js";
import { startEventLoopWatchdog, type EventLoopWatchdog } from "./services/eventLoopWatchdog.js";
import {
  confirmedMatchSupportsBackgroundDelivery,
  confirmMatchLocalFirst,
  deliverConfirmedMatchInBackground,
  selectConfirmedMatchReportRetries
} from "./services/localFirstMatchConfirmation.js";
import {
  createSingleUseDisplayMediaResponder,
  displayMediaRequestIsTrusted,
  isTrustedRiftLiteAppOrigin,
  preparedDisplayMediaTargetForRequester,
  type ReplayVideoDisplayTarget
} from "./services/displayMediaRequest.js";
import { AtlasFrameDeduper, type AtlasFrameSource } from "./services/atlasFrameDeduper.js";
import { DeckService } from "./services/deckService.js";
import { DeckTrackerService } from "./services/deckTrackerService.js";
import { joinDiscordVoiceChannel } from "./services/discordRpc.js";
import { FirebaseSyncService, type AccountCloudRestoreFence } from "./services/firebaseSync.js";
import { OverlayServer } from "./services/overlayServer.js";
import {
  RawCaptureService,
  rawCaptureMatchSummaryFromDraft,
  riftLiteTcgaWebReplayAutoUploadAccountUid,
  type RawCaptureFinishIdentity
} from "./services/rawCaptureService.js";
import { attachReplayVideoToStore } from "./services/replayVideoAttachment.js";
import {
  clearReplayEmbedCookies,
  prepareReplayEmbedSession,
  prepareReplayLibraryEmbedSession,
  replayEmbedPermissionCheckAllowed,
  replayEmbedPermissionRequestAllowed,
  RIFTLITE_REPLAY_ORIGIN,
  RIFTLITE_REPLAY_PARTITION
} from "./services/replayEmbedSession.js";
import { RiftLiteStore } from "./services/store.js";
import { SecureCredentialVault } from "./services/secureCredentialVault.js";
import { SimEventReceiver } from "./services/simEventReceiver.js";
import {
  resolveRiftLiteSmokePaths,
  riftLiteSmokeNetworkRequestAllowed
} from "./services/smokeIsolation.js";
import { TcgaResolver } from "./services/tcgaResolver.js";
import { TcgaReplayResearchCapture } from "./services/tcgaReplayResearchCapture.js";
import { TcgaWebReplayCaptureService } from "./services/tcgaWebReplayCaptureService.js";
import { UpdaterService } from "./services/updaterService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isDev = process.env.NODE_ENV === "development";
const DECK_PACKAGE_TEXT_PREFIX = "RIFTLITE_DECK_PACKAGE_V1:";
const DECK_PACKAGE_COMPRESSED_TEXT_PREFIX = "RIFTLITE_DECK_PACKAGE_V2:";
const DECK_SHARE_TEXT_PREFIX = "RIFTLITE_DECK_SHARE_V2:";
const RIFTLITE_BACKUP_EXTENSION = "riftlitebackup";
const REPLAY_STREAM_MAGIC = "RIFTLITE_REPLAY_STREAM_V1";
const REPLAY_STREAM_VIDEO_START = "VIDEO_DATA";
const REPLAY_STREAM_VIDEO_END = "END_VIDEO_DATA";
const RIFTREPLAY_CAPTURE_FEATURE_ENABLED = true;
const ATLAS_GAME_PARTITION = GAME_WEBVIEW_PARTITIONS.atlas;
const IS_PACKAGED_SMOKE_TEST = process.argv.includes("--riftlite-smoke-test");
const SMOKE_PATHS = resolveRiftLiteSmokePaths(IS_PACKAGED_SMOKE_TEST, process.env);
const UI_SNAPSHOT_PATH = SMOKE_PATHS?.snapshotPath ?? "";
const UI_SNAPSHOT_TOUR_ACTION = IS_PACKAGED_SMOKE_TEST
  ? process.env.RIFTLITE_UI_SNAPSHOT_TOUR_ACTION?.trim().toLowerCase() ?? ""
  : "";
const UI_SNAPSHOT_VIEW = IS_PACKAGED_SMOKE_TEST
  ? process.env.RIFTLITE_UI_SNAPSHOT_VIEW?.trim().toLowerCase() ?? ""
  : "";
const UI_SNAPSHOT_PLATFORM = IS_PACKAGED_SMOKE_TEST
  ? process.env.RIFTLITE_UI_SNAPSHOT_PLATFORM?.trim().toLowerCase() ?? ""
  : "";
const UI_SNAPSHOT_COLLAPSED = IS_PACKAGED_SMOKE_TEST && process.env.RIFTLITE_UI_SNAPSHOT_COLLAPSED === "1";
const UI_SNAPSHOT_ATLAS_WAIT_MS = IS_PACKAGED_SMOKE_TEST
  ? Math.max(1_000, Math.min(30_000, Number.parseInt(process.env.RIFTLITE_UI_SNAPSHOT_ATLAS_WAIT_MS ?? "14000", 10) || 14_000))
  : 0;
let atlasSmokeDiagnosticsTaken = false;

app.setName(RIFTLITE_BUILD_IDENTITY.appName);
if (SMOKE_PATHS) {
  for (const path of [
    SMOKE_PATHS.userData,
    SMOKE_PATHS.documents,
    SMOKE_PATHS.downloads,
    SMOKE_PATHS.pictures,
    SMOKE_PATHS.videos,
    SMOKE_PATHS.temp,
    SMOKE_PATHS.crashDumps,
    ...(SMOKE_PATHS.snapshotPath ? [dirname(SMOKE_PATHS.snapshotPath)] : [])
  ]) {
    mkdirSync(path, { recursive: true });
  }
  app.setPath("userData", SMOKE_PATHS.userData);
  app.setPath("documents", SMOKE_PATHS.documents);
  app.setPath("downloads", SMOKE_PATHS.downloads);
  app.setPath("pictures", SMOKE_PATHS.pictures);
  app.setPath("videos", SMOKE_PATHS.videos);
  app.setPath("temp", SMOKE_PATHS.temp);
  app.setPath("crashDumps", SMOKE_PATHS.crashDumps);
} else {
  app.setPath("userData", join(app.getPath("appData"), RIFTLITE_BUILD_IDENTITY.userDataDirectory));
}
app.setAppUserModelId(RIFTLITE_BUILD_IDENTITY.appId);
if (!IS_PACKAGED_SMOKE_TEST) {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(RIFTLITE_BUILD_IDENTITY.protocol, process.execPath, [resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(RIFTLITE_BUILD_IDENTITY.protocol);
  }
}
app.commandLine.appendSwitch("disable-features", "WebRtcAllowInputVolumeAdjustment,WebRtcApmInAudioService");

const gotSingleInstanceLock = IS_PACKAGED_SMOKE_TEST || app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let pendingAppNavigation: AppNavigationRequest | null = protocolNavigationFromArgs(process.argv);
let deckTrackerWindow: BrowserWindow | null = null;
let riftLiteReplayWebContents: WebContents | null = null;
let store: RiftLiteStore;
let capture: CaptureCoordinator;
let tcgaResolver: TcgaResolver;
let syncService: FirebaseSyncService;
let deckService: DeckService;
let deckTrackerService: DeckTrackerService;
let rawCaptureService: RawCaptureService;
let overlayServer: OverlayServer;
let simEventReceiver: SimEventReceiver | null = null;
let diagnostics: CaptureDiagnostics;
let eventLoopWatchdog: EventLoopWatchdog | null = null;
let tcgaReplayResearchCapture: TcgaReplayResearchCapture;
let tcgaWebReplayCaptureService: TcgaWebReplayCaptureService<
  RawCaptureFinishIdentity,
  ReplayRecord,
  ReplayRecord | null
> | null = null;
let tcgaWebReplayProductAccountUid = "";
let tcgaWebReplayConfigurationTail: Promise<void> = Promise.resolve();
let updater: UpdaterService;
let registeredScreenshotHotkey = "";
let registeredShadowClipHotkey = "";
let registeredReplayFlagHotkey = "";
const gameWebContentsByPlatform = new Map<GamePlatform, WebContents>();
const embeddedWebviewPolicyBySession = new WeakMap<object, EmbeddedWebviewPolicy>();
const rawCaptureDebuggerContents = new WeakSet<WebContents>();
type TcgaReplayResearchRequest = {
  url: string;
  resourceType: string;
  mimeType: string;
};
type TcgaReplayResearchTap = {
  webContents: WebContents;
  listener: (_event: unknown, method: string, params: unknown) => void;
  requests: Map<string, TcgaReplayResearchRequest>;
  socketUrls: Map<string, string>;
  scriptIdentifier: string;
  networkEnabled: boolean;
  ready: Promise<void>;
};
const tcgaReplayResearchTaps = new Map<number, TcgaReplayResearchTap>();
const atlasDeckTrackerFrameDebugCounts = new Map<string, number>();
const atlasFrameDeduper = new AtlasFrameDeduper();
const rawCaptureIngressLimiter = new RawCaptureIngressLimiter();
const replayFrameHashByPlatform = new Map<GamePlatform, { hash: string; capturedAt: number }>();
const ensuredReplayFrameDirectories = new Set<string>();
let replayFrameDirectoryCache: { path: string; expiresAt: number } | null = null;
const replayVideoSessions = new Map<string, ReplayVideoSession>();
type ConfirmedMatchDeliveryJob = {
  saved: MatchDraft;
  pending: Promise<void> | null;
};
const confirmedMatchDeliveryByMatchId = new Map<string, ConfirmedMatchDeliveryJob>();

function installSmokeNetworkIsolation(): void {
  if (!IS_PACKAGED_SMOKE_TEST) return;
  const smokeSessions = new Set([
    electronSession.defaultSession,
    electronSession.fromPartition(RIFTLITE_REPLAY_PARTITION),
    ...Object.values(GAME_WEBVIEW_PARTITIONS).map((partition) => electronSession.fromPartition(partition))
  ]);
  for (const targetSession of smokeSessions) {
    targetSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      callback({ cancel: !riftLiteSmokeNetworkRequestAllowed(details.url) });
    });
  }
}
let replayVideoDisplayTarget: ReplayVideoDisplayTarget | null = null;
let rawCaptureUploadRetryTimer: ReturnType<typeof setInterval> | null = null;
let tcgaResearchQuitFinalizationStarted = false;
let tcgaResearchQuitAllowed = false;
let atlasWebviewRecoveryInFlight: Promise<{ ok: boolean; message: string }> | null = null;
const atlasEmptyShellMainRecovery = new AtlasEmptyShellMainRecoveryGuard();
const ATLAS_EMPTY_SHELL_MAIN_RELOAD_DELAY_MS = 500;

const accountCloudSyncQueue = new AccountCloudSyncQueue(
  async (reason) => {
    const settings = await store.getSettings();
    if (!settings.accountCloudSyncEnabled || !settings.accountUid) {
      return;
    }
    try {
      await syncService.uploadAccountCloudSync(`${reason}. Account sync updated.`, { automatic: true });
    } catch (error) {
      await store.updateSettings((current) => (
        current.accountUid === settings.accountUid && current.accountCloudSyncEnabled
          ? { accountCloudSyncLastError: error instanceof Error ? error.message : "Account cloud sync failed." }
          : {}
      )).catch(() => undefined);
      throw error;
    }
  },
  async (error) => {
    await logStartupIssue("queued account cloud sync failed", error);
  }
);

function queueAccountCloudSync(reason = "Local data changed"): void {
  accountCloudSyncQueue.queue(reason);
}

function startupLogPath(): string {
  return join(app.getPath("userData"), "riftlite-startup.log");
}

function formatStartupError(error: unknown): string {
  return error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
}

async function logStartupIssue(label: string, error: unknown): Promise<void> {
  const line = [
    `[${new Date().toISOString()}] ${label}`,
    formatStartupError(error),
    ""
  ].join("\n");
  await mkdir(app.getPath("userData"), { recursive: true }).catch(() => undefined);
  await appendFile(startupLogPath(), line, "utf8").catch(() => undefined);
}

function startRawCaptureUploadRetry(): void {
  if (rawCaptureUploadRetryTimer) {
    clearInterval(rawCaptureUploadRetryTimer);
  }
  rawCaptureUploadRetryTimer = setInterval(() => {
    void retryPendingRawCapturesAndMatchReports().catch((error) => {
      void logStartupIssue("raw capture pending upload retry failed", error);
    });
  }, 120_000);
  rawCaptureUploadRetryTimer.unref();
}

async function uploadPendingRawCapturesWithAccountRefresh(): Promise<number> {
  const settings = await store.getSettings();
  const accountBoundUploadEnabled = settings.rawCapture.enabled && Boolean(
    (settings.rawCapture.webReplayAutoUploadEnabled &&
      settings.rawCapture.webReplayAutoUploadAccountUid === settings.accountUid) ||
    (settings.rawCapture.tcgaWebReplayAutoUploadEnabled &&
      settings.rawCapture.tcgaWebReplayAutoUploadAccountUid === settings.accountUid)
  );
  if (
    accountBoundUploadEnabled &&
    settings.accountUid &&
    settings.firebaseRefreshToken &&
    !hasVerifiedRiftLiteAccount(settings)
  ) {
    await syncService.getAccountConnectionStatus();
  }
  return rawCaptureService.uploadPendingRawCaptures();
}

async function syncSettledMatchReports(): Promise<number> {
  const candidates = selectConfirmedMatchReportRetries(await store.getMatches(), 10).matches;
  let syncedCount = 0;
  for (const match of candidates) {
    try {
      const synced = await syncService.syncMatch(match, { quiet: true });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("match:draft", synced);
      }
      syncedCount += 1;
    } catch (error) {
      await logStartupIssue(`Pending match report retry failed (${match.id})`, error);
    }
  }
  if (syncedCount) {
    queueAccountCloudSync("Pending match reports retried");
  }
  return syncedCount;
}

async function retryPendingRawCapturesAndMatchReports(): Promise<number> {
  const uploaded = await uploadPendingRawCapturesWithAccountRefresh();
  await syncSettledMatchReports();
  retryDeferredConfirmedMatchDeliveries();
  return uploaded;
}

function retryDeferredConfirmedMatchDeliveries(): void {
  for (const job of confirmedMatchDeliveryByMatchId.values()) {
    if (!job.pending) {
      queueConfirmedMatchDelivery(job.saved);
    }
  }
}

process.on("uncaughtException", (error) => {
  void logStartupIssue("uncaught exception", error);
});

process.on("unhandledRejection", (reason) => {
  void logStartupIssue("unhandled rejection", reason);
});

app.on("child-process-gone", (_event, details) => {
  void logStartupIssue("child process gone", JSON.stringify(details));
});

const REPLAY_FRAME_DEDUPE_THRESHOLD = 0.012;
const REPLAY_FRAME_DIRECTORY_CACHE_MS = 30_000;
const REPLAY_FRAME_JPEG_QUALITY = 58;
const REPLAY_VIDEO_DISPLAY_TARGET_MS = 120_000;
const MAX_REPLAY_KEYFRAME_DATA_URL_BYTES = 16 * 1024 * 1024;
const MAX_REPLAY_IMPORT_BUNDLE_BYTES = 512 * 1024 * 1024;
const MAX_REPLAY_IMPORT_VIDEO_BYTES = 384 * 1024 * 1024;
const MAX_REPLAY_IMPORT_SEEKABLE_BYTES = 384 * 1024 * 1024;
const MAX_REPLAY_EXPORT_VIDEO_BYTES = 384 * 1024 * 1024;
const MAX_REPLAY_IMPORT_FRAME_BYTES = 24 * 1024 * 1024;
const MAX_REPLAY_EXPORT_FRAME_BYTES = 24 * 1024 * 1024;
const MAX_REPLAY_IMPORT_FRAMES = 2500;
const MAX_REPLAY_EXPORT_FRAMES = 2500;
const REPLAY_IMPORT_BASE64_CHUNK_CHARS = 4 * 1024 * 1024;
const execFileAsync = promisify(execFile);

type ScreenshotOptions = {
  platform?: GamePlatform;
  label?: string;
  silent?: boolean;
};

type CompactDeckShareCard = {
  k?: string;
  n?: string;
  c?: string;
  i?: string;
  q?: number;
  t?: string;
  g?: string;
  r?: string;
  m?: string;
  p?: number;
};

type CompactDeckShareSection = {
  c?: CompactDeckShareCard[];
  n?: string;
};

type CompactDeckShareGuide = {
  l?: string;
  m?: {
    k?: CompactDeckShareSection;
    c?: CompactDeckShareSection;
    a?: CompactDeckShareSection;
  };
  s?: {
    i?: CompactDeckShareSection;
    o?: CompactDeckShareSection;
    n?: string;
  };
  b?: {
    g?: CompactDeckShareSection;
    f?: CompactDeckShareSection;
    s?: CompactDeckShareSection;
    n?: string;
  };
  x?: string[];
};

type CompactDeckSharePayload = {
  f: "riftlite.deck-share";
  v: 2;
  d: {
    u?: string;
    k?: string;
    t?: string;
    l?: string;
    s?: string;
  };
  n: {
    go?: Array<{ t?: string; s?: string }>;
    w?: Array<{ k?: string; n?: string; c?: string; i?: string; s?: string; t?: string }>;
    v?: Array<{ h?: string; t?: string; l?: string; k?: string; u?: string; a?: string; s?: string }>;
    d?: CompactDeckShareGuide;
    g?: CompactDeckShareGuide[];
  };
};

function resourcesRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "resources");
  }
  return resolve(__dirname, "..", "..", "resources");
}

function assetPath(relativePath: string): string {
  return join(resourcesRoot(), relativePath);
}

function safeAssetPath(relativePath: string): string {
  const root = resourcesRoot();
  const filePath = resolve(root, relativePath);
  if (!pathInside(filePath, root)) {
    throw new Error("Asset path is outside RiftLite resources.");
  }
  return filePath;
}

function preloadPath(name: "appPreload" | "gamePreload"): string {
  return join(__dirname, "..", name === "appPreload" ? "preload" : "game-preload", name === "gamePreload" ? "gamePreload.cjs" : "appPreload.js");
}

function readPayloadString(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" ? value.trim().slice(0, 1000) : "";
}

function sanitizeVisionDebugValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return value.slice(0, depth > 0 ? 240 : 1000);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 12).map((item) => sanitizeVisionDebugValue(item, depth + 1));
  }
  if (value && typeof value === "object" && depth < 4) {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 16)) {
      if (key === "imageUrl" || key === "screenshot" || key === "frameData") {
        continue;
      }
      output[key] = sanitizeVisionDebugValue(child, depth + 1);
    }
    return output;
  }
  return undefined;
}

function sanitizeVisionDebugPayload(value: unknown): Record<string, unknown> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const output: Record<string, unknown> = { reason: "vision-deck-tracker" };
  for (const [key, raw] of Object.entries(record)) {
    if (key === "imageUrl" || key === "screenshot" || key === "frameData") {
      continue;
    }
    const safeValue = sanitizeVisionDebugValue(raw);
    if (safeValue !== undefined) {
      output[key] = safeValue;
    }
  }
  output.reason = readPayloadString(record.reason) || "vision-deck-tracker";
  return output;
}

async function assetDataUrl(relativePath: string): Promise<string> {
  const filePath = safeAssetPath(relativePath);
  const bytes = await readFile(filePath);
  return `data:${mimeType(relativePath)};base64,${bytes.toString("base64")}`;
}

async function loadBattlefields(): Promise<BattlefieldOption[]> {
  const raw = await readFile(assetPath("battlefield_catalog.json"), "utf8");
  const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
  const merged = new Map<string, BattlefieldOption & { active: boolean }>();
  const add = (item: Record<string, unknown>, active: boolean): void => {
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) return;
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const aliases = Array.isArray(item.aliases)
      ? item.aliases.filter((alias): alias is string => typeof alias === "string" && Boolean(alias.trim())).map((alias) => alias.trim())
      : [];
    const existing = merged.get(key);
    merged.set(key, {
      name: existing?.name || name,
      aliases: [...new Set([...(existing?.aliases ?? []), ...aliases])],
      active
    });
  };

  // The generated registry supplies all official collectible battlefields.
  // The small catalog remains an override for aliases, rotation state and
  // platform-only battlefields, so an invalid/missing optional registry cannot
  // break the picker in an already-installed build.
  try {
    const registryRaw = await readFile(assetPath("riftbound_card_registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as Record<string, unknown>;
    const cards = Array.isArray(registry.cards) ? registry.cards : [];
    for (const value of cards) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const card = value as Record<string, unknown>;
      if (String(card.type ?? "").toLowerCase() !== "battlefield" || String(card.supertype ?? "").toLowerCase() === "token") continue;
      add(card, true);
    }
    const specialBattlefields = Array.isArray(registry.specialBattlefields) ? registry.specialBattlefields : [];
    for (const value of specialBattlefields) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const battlefield = value as Record<string, unknown>;
      add(battlefield, battlefield.isActive !== false);
    }
  } catch {
    // Fall through to the packaged last-known-good catalog.
  }

  for (const item of parsed) {
    add(item, item.is_active !== false);
  }
  return [...merged.values()]
    .filter((item) => item.active)
    .map(({ name, aliases }) => ({ name, aliases }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function defaultScreenshotDirectory(): string {
  return join(app.getPath("pictures"), RIFTLITE_BUILD_IDENTITY.mediaDirectoryName);
}

function screenshotDirectory(settings: UserSettings): string {
  return settings.screenshotDirectory?.trim() || defaultScreenshotDirectory();
}

function defaultReplayDirectory(): string {
  return join(app.getPath("documents"), RIFTLITE_BUILD_IDENTITY.mediaDirectoryName, "Replay Bundles");
}

function replayDirectory(settings: UserSettings): string {
  return settings.replayDirectory?.trim() || defaultReplayDirectory();
}

function replayFrameCaptureDirectory(settings: UserSettings): string {
  return join(replayDirectory(settings), "Timed Frames");
}

function replayBundleDirectory(settings?: UserSettings): string {
  return settings ? replayDirectory(settings) : defaultReplayDirectory();
}

function backupDirectory(): string {
  return join(app.getPath("documents"), RIFTLITE_BUILD_IDENTITY.mediaDirectoryName, "Backups");
}

function backupTimestamp(): string {
  return new Date().toISOString().replace(/T/, "_").replace(/\..+$/, "").replace(/:/g, "-");
}

function legacyReplayVideoDirectory(): string {
  return join(app.getPath("documents"), RIFTLITE_BUILD_IDENTITY.mediaDirectoryName, "Replay Videos");
}

function replayVideoDirectory(settings?: UserSettings): string {
  return join(replayBundleDirectory(settings), "Video");
}

function replayFrameDirectory(replayId: string, settings?: UserSettings): string {
  return join(replayBundleDirectory(settings), "Imported Frames", safeFileComponent(replayId, "replay"));
}

function replayVideoImportDirectory(settings?: UserSettings): string {
  return join(replayVideoDirectory(settings), "Imported");
}

function screenshotFilename(label = "", extension = "png"): string {
  const stamp = new Date().toISOString().replace(/T/, "_").replace(/\..+$/, "").replace(/:/g, "-");
  const safeLabel = label
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `RiftLite${safeLabel ? `_${safeLabel}` : ""}_${stamp}.${extension}`;
}

function replayVideoExtension(mimeType: string | undefined): "mp4" | "webm" {
  return mimeType === "video/mp4" ? "mp4" : "webm";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

function estimateBase64DecodedBytes(value: string): number {
  const length = value.length;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((length * 3) / 4) - padding);
}

async function writeBase64FileChunked(filePath: string, value: string, maxDecodedBytes: number): Promise<number> {
  const estimatedBytes = estimateBase64DecodedBytes(value);
  if (estimatedBytes > maxDecodedBytes) {
    throw new Error(`Replay asset is too large to import (${formatByteSize(estimatedBytes)}).`);
  }

  const file = await open(filePath, "w");
  let writtenBytes = 0;
  let carry = "";
  try {
    for (let offset = 0; offset < value.length; offset += REPLAY_IMPORT_BASE64_CHUNK_CHARS) {
      const compact = `${carry}${value.slice(offset, offset + REPLAY_IMPORT_BASE64_CHUNK_CHARS)}`.replace(/\s+/g, "");
      const usableLength = Math.floor(compact.length / 4) * 4;
      const chunk = compact.slice(0, usableLength);
      carry = compact.slice(usableLength);
      if (!chunk) {
        continue;
      }
      const bytes = Buffer.from(chunk, "base64");
      writtenBytes += bytes.length;
      if (writtenBytes > maxDecodedBytes) {
        throw new Error(`Replay asset is too large to import (${formatByteSize(writtenBytes)}).`);
      }
      await file.write(bytes);
    }

    if (carry) {
      const bytes = Buffer.from(carry, "base64");
      writtenBytes += bytes.length;
      if (writtenBytes > maxDecodedBytes) {
        throw new Error(`Replay asset is too large to import (${formatByteSize(writtenBytes)}).`);
      }
      await file.write(bytes);
    }
  } finally {
    await file.close();
  }
  return writtenBytes;
}

async function writeStreamText(stream: ReturnType<typeof createWriteStream>, text: string): Promise<void> {
  if (!stream.write(text)) {
    await once(stream, "drain");
  }
}

async function writeFileAsBase64JsonString(stream: ReturnType<typeof createWriteStream>, filePath: string, maxBytes: number): Promise<number> {
  const fileStats = await stat(filePath);
  if (fileStats.size > maxBytes) {
    throw new Error(`Replay video is too large to export safely (${formatByteSize(fileStats.size)}). Trim it before exporting.`);
  }

  let writtenBytes = 0;
  let carry = Buffer.alloc(0);
  await writeStreamText(stream, "\"");
  for await (const chunk of createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const combined = carry.length ? Buffer.concat([carry, bytes]) : bytes;
    const usableLength = combined.length - (combined.length % 3);
    if (usableLength > 0) {
      const usable = combined.subarray(0, usableLength);
      writtenBytes += usable.length;
      if (writtenBytes > maxBytes) {
        throw new Error(`Replay video is too large to export safely (${formatByteSize(writtenBytes)}). Trim it before exporting.`);
      }
      await writeStreamText(stream, usable.toString("base64"));
    }
    carry = combined.subarray(usableLength);
  }
  if (carry.length) {
    writtenBytes += carry.length;
    if (writtenBytes > maxBytes) {
      throw new Error(`Replay video is too large to export safely (${formatByteSize(writtenBytes)}). Trim it before exporting.`);
    }
    await writeStreamText(stream, carry.toString("base64"));
  }
  await writeStreamText(stream, "\"");
  return writtenBytes;
}

async function writeFileAsBase64Lines(stream: ReturnType<typeof createWriteStream>, filePath: string, maxBytes: number): Promise<number> {
  const fileStats = await stat(filePath);
  if (fileStats.size > maxBytes) {
    throw new Error(`Replay video is too large to export safely (${formatByteSize(fileStats.size)}). Trim it before exporting.`);
  }

  let writtenBytes = 0;
  let carry = Buffer.alloc(0);
  for await (const chunk of createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const combined = carry.length ? Buffer.concat([carry, bytes]) : bytes;
    const usableLength = combined.length - (combined.length % 3);
    if (usableLength > 0) {
      const usable = combined.subarray(0, usableLength);
      writtenBytes += usable.length;
      if (writtenBytes > maxBytes) {
        throw new Error(`Replay video is too large to export safely (${formatByteSize(writtenBytes)}). Trim it before exporting.`);
      }
      await writeStreamText(stream, `${usable.toString("base64")}\n`);
    }
    carry = combined.subarray(usableLength);
  }
  if (carry.length) {
    writtenBytes += carry.length;
    if (writtenBytes > maxBytes) {
      throw new Error(`Replay video is too large to export safely (${formatByteSize(writtenBytes)}). Trim it before exporting.`);
    }
    await writeStreamText(stream, `${carry.toString("base64")}\n`);
  }
  return writtenBytes;
}

async function finishWriteStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  await new Promise<void>((resolveFinished, rejectFinished) => {
    stream.once("error", rejectFinished);
    stream.end(() => resolveFinished());
  });
}

function replayVideoSeekableMarkerPath(filePath: string): string {
  return `${filePath}.seekable`;
}

async function markReplayVideoSeekable(filePath: string): Promise<void> {
  await writeFile(replayVideoSeekableMarkerPath(filePath), new Date().toISOString()).catch(() => undefined);
}

function replayVideoFfmpegPath(): string | null {
  if (app.isPackaged) {
    return join(process.resourcesPath, "ffmpeg", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  }
  return typeof ffmpegStaticPath === "string" && ffmpegStaticPath ? ffmpegStaticPath : null;
}

async function makeReplayVideoSeekable(filePath: string, mimeType: string | undefined): Promise<boolean> {
  if (replayVideoExtension(mimeType) !== "mp4") {
    return true;
  }
  if (!await replayVideoPathAllowed(filePath)) {
    return false;
  }
  if (await pathExists(replayVideoSeekableMarkerPath(filePath))) {
    return true;
  }

  const ffmpegPath = replayVideoFfmpegPath();
  if (!ffmpegPath || !(await pathExists(ffmpegPath))) {
    return false;
  }

  const extension = replayVideoExtension(mimeType);
  const tempPath = `${filePath}.seekable.${extension}`;
  await unlink(tempPath).catch(() => undefined);
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-fflags",
    "+genpts",
    "-i",
    filePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-avoid_negative_ts",
    "make_zero"
  ];
  if (extension === "mp4") {
    args.push("-movflags", "+faststart");
  }
  args.push(tempPath);

  try {
    await execFileAsync(ffmpegPath, args, {
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 1024 * 1024
    });
    const remuxedStats = await stat(tempPath);
    if (remuxedStats.size <= 0) {
      await unlink(tempPath).catch(() => undefined);
      return false;
    }
    await unlink(filePath).catch(() => undefined);
    await rename(tempPath, filePath);
    await markReplayVideoSeekable(filePath);
    return true;
  } catch (error) {
    console.warn("[replay-video] Seekable remux failed; keeping original recording.", error);
    await unlink(tempPath).catch(() => undefined);
    return false;
  }
}

async function replayVideoDecodeProbe(filePath: string, fromEnd = false): Promise<boolean | null> {
  const ffmpegPath = replayVideoFfmpegPath();
  if (!ffmpegPath || !(await pathExists(ffmpegPath))) {
    return null;
  }
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-xerror"
  ];
  if (fromEnd) {
    args.push("-sseof", "-3");
  }
  args.push(
    "-i",
    filePath,
    "-map",
    "0:v:0",
    "-frames:v",
    "3",
    "-f",
    "null",
    "-"
  );
  try {
    await execFileAsync(ffmpegPath, args, {
      windowsHide: true,
      timeout: 45_000,
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

async function validateReplayVideoReadable(filePath: string, sizeBytes: number, mimeType: string | undefined): Promise<boolean> {
  if (!await replayVideoPathAllowed(filePath)) {
    return false;
  }
  const startOk = await replayVideoDecodeProbe(filePath, false);
  if (startOk === false) {
    return false;
  }
  if (replayVideoExtension(mimeType) === "mp4" && sizeBytes > 2 * 1024 * 1024) {
    const endOk = await replayVideoDecodeProbe(filePath, true);
    if (endOk === false) {
      return false;
    }
  }
  return true;
}

function safeFileComponent(value: string, fallback = "RiftLite Replay"): string {
  const safe = value
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return safe || fallback;
}

function platformFromUrl(url: string): GamePlatform | null {
  return gamePlatformForTrustedUrl(url, isDev);
}

function diagnosticPageUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0].slice(0, 500);
  }
}

function isTrustedAppOrigin(origin: string): boolean {
  return isTrustedRiftLiteAppOrigin(origin, isDev);
}

function isTrustedAppPageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "file:") {
      const expected = resolve(join(__dirname, "..", "renderer", "index.html")).toLowerCase();
      return resolve(fileURLToPath(parsed)).toLowerCase() === expected;
    }
    return isDev && (
      parsed.origin === "http://127.0.0.1:5173" || parsed.origin === "http://localhost:5173"
    );
  } catch {
    return false;
  }
}

function isTrustedAppWebContents(webContents: WebContents): boolean {
  const isAppWindow = mainWindow?.webContents.id === webContents.id ||
    deckTrackerWindow?.webContents.id === webContents.id;
  return Boolean(
    isAppWindow &&
    !webContents.isDestroyed() &&
    webContents.session === electronSession.defaultSession &&
    isTrustedAppPageUrl(webContents.getURL())
  );
}

function isTopLevelIpcFrame(event: {
  sender: WebContents;
  senderFrame?: { processId: number; routingId: number; url: string } | null;
}): boolean {
  const frame = event.senderFrame;
  const mainFrame = event.sender.isDestroyed() ? null : event.sender.mainFrame;
  return Boolean(
    frame &&
    mainFrame &&
    sameWebFrameIdentity(frame, mainFrame) &&
    frame.url === mainFrame.url
  );
}

function isTrustedAppIpcSender(event: {
  sender: WebContents;
  senderFrame?: { processId: number; routingId: number; url: string } | null;
}): boolean {
  return isTopLevelIpcFrame(event) &&
    isTrustedAppWebContents(event.sender) &&
    Boolean(event.senderFrame && isTrustedAppPageUrl(event.senderFrame.url));
}

function trustedGameIpcPlatform(event: {
  sender: WebContents;
  senderFrame?: { processId: number; routingId: number; url: string } | null;
}): GamePlatform | null {
  if (!isTopLevelIpcFrame(event) || event.sender.isDestroyed()) {
    return null;
  }
  const policy = embeddedWebviewPolicyBySession.get(event.sender.session);
  if (!policy || policy.kind !== "game") {
    return null;
  }
  if (
    event.sender.session !== electronSession.fromPartition(GAME_WEBVIEW_PARTITIONS[policy.platform]) ||
    gameWebContentsByPlatform.get(policy.platform)?.id !== event.sender.id ||
    !isAllowedEmbeddedNavigation(policy, event.sender.getURL()) ||
    !event.senderFrame ||
    !isAllowedEmbeddedNavigation(policy, event.senderFrame.url)
  ) {
    return null;
  }
  return policy.platform;
}

function assertTrustedAppIpcSender(event: {
  sender: WebContents;
  senderFrame?: { processId: number; routingId: number; url: string } | null;
}): void {
  if (!isTrustedAppIpcSender(event)) {
    throw new Error("IPC request rejected: untrusted sender.");
  }
}

function handleTrustedAppIpc(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedAppIpcSender(event);
    return listener(event, ...args);
  });
}

async function replayWindowCaptureSource(): Promise<ReplayWindowCaptureSource | null> {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false
  });
  const windowTitle = mainWindow?.getTitle().toLowerCase() ?? "";
  const source = sources.find((item) => item.name.toLowerCase() === windowTitle) ??
    sources.find((item) => item.name.toLowerCase().startsWith("riftlite beta")) ??
    sources.find((item) => item.name.toLowerCase().includes("riftlite"));
  return source ? { id: source.id, name: source.name } : null;
}

function rememberGameWebContents(webContents: WebContents): void {
  if (webContents.isDestroyed()) {
    return;
  }
  const platform = platformFromUrl(webContents.getURL());
  if (platform) {
    gameWebContentsByPlatform.set(platform, webContents);
  }
}

function isAllowedRiftLiteReplayNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === RIFTLITE_REPLAY_ORIGIN &&
      (url.pathname === "/replays" || url.pathname.startsWith("/replays/"));
  } catch {
    return false;
  }
}

function isRiftLiteReplayOrigin(value: string): boolean {
  try {
    return new URL(value).origin === RIFTLITE_REPLAY_ORIGIN;
  } catch {
    return false;
  }
}

function installRestrictedEmbeddedPermissions(
  webContents: WebContents,
  policy: EmbeddedWebviewPolicy,
  permissions: ReadonlySet<string>
): void {
  const embeddedSession = webContents.session;
  const exactRequester = (requestingContents: WebContents | null, requestingUrl: string, isMainFrame: boolean) => (
    requestingContents?.id === webContents.id &&
    !webContents.isDestroyed() &&
    isMainFrame &&
    isAllowedEmbeddedNavigation(policy, requestingUrl || webContents.getURL())
  );
  embeddedSession.setPermissionCheckHandler((requestingContents, permission, _origin, details) => (
    exactRequester(requestingContents, details.requestingUrl || "", details.isMainFrame) &&
    permissions.has(String(permission))
  ));
  embeddedSession.setPermissionRequestHandler((requestingContents, permission, callback, details) => {
    callback(
      exactRequester(requestingContents, details.requestingUrl, details.isMainFrame) &&
      permissions.has(String(permission))
    );
  });
}

function secureGamePopup(
  webContents: WebContents,
  policy: Extract<EmbeddedWebviewPolicy, { kind: "game" }>
): void {
  webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !isAllowedGamePopupNavigation(policy, url)) {
      void openExternalResource(url).catch(() => undefined);
    }
    return { action: "deny" };
  });
  const restrictPopupNavigation = (event: Electron.Event, url: string) => {
    if (isAllowedGamePopupNavigation(policy, url)) {
      return;
    }
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) {
      void openExternalResource(url).catch(() => undefined);
    }
  };
  webContents.on("will-navigate", restrictPopupNavigation);
  webContents.on("will-redirect", restrictPopupNavigation);
}

function secureGameWebContents(webContents: WebContents, policy: Extract<EmbeddedWebviewPolicy, { kind: "game" }>): void {
  let atlasClerkRepairAttempted = false;
  const repairAtlasClerkSignIn = async (popup?: BrowserWindow): Promise<void> => {
    if (policy.platform !== "atlas" || atlasClerkRepairAttempted) {
      return;
    }
    atlasClerkRepairAttempted = true;
    const removedCookieCount = await clearAtlasClerkAuthCookies(webContents.session);
    if (popup && !popup.isDestroyed()) {
      popup.destroy();
    }
    if (!webContents.isDestroyed()) {
      await webContents.loadURL("https://play.riftatlas.com/sign-in?redirect_url=%2F");
    }
    void logStartupIssue("Atlas Clerk sign-in repaired", `Removed ${removedCookieCount} invalid authentication cookies.`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "RiftAtlas sign-in repaired",
        message: "RiftAtlas sign-in was reset safely.",
        detail: "RiftLite removed an invalid RiftAtlas sign-in session. Choose Sign in and try again. Your RiftLite account, matches, decks, and replays were not changed.",
        buttons: ["Continue"],
        defaultId: 0
      });
    }
  };
  const repairAtlasClerkPageIfNeeded = async (contents: WebContents, popup?: BrowserWindow): Promise<void> => {
    if (policy.platform !== "atlas" || atlasClerkRepairAttempted || contents.isDestroyed()) {
      return;
    }
    const pageUrl = contents.getURL();
    if (!pageUrl.startsWith("https://clerk.riftatlas.com/")) {
      return;
    }
    const bodyText = await contents.executeJavaScript(
      "String(document.body?.innerText || '').slice(0, 4000)",
      true
    );
    if (!isAtlasClerkAuthorizationInvalidPage(pageUrl, String(bodyText ?? ""))) {
      return;
    }
    await repairAtlasClerkSignIn(popup);
  };
  installRestrictedEmbeddedPermissions(
    webContents,
    policy,
    new Set(["clipboard-sanitized-write", "fullscreen"])
  );
  webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedGamePopupNavigation(policy, url)) {
      if (/^https?:\/\//i.test(url)) {
        void openExternalResource(url).catch(() => undefined);
      }
      return { action: "deny" };
    }
    return {
      action: "allow",
      overrideBrowserWindowOptions: gamePopupBrowserWindowOptions(webContents.session)
    };
  });
  webContents.on("did-create-window", (popup) => {
    if (!gamePopupSharesParentSession(webContents, popup.webContents)) {
      popup.destroy();
      void logStartupIssue("game OAuth popup session mismatch", policy.platform);
      return;
    }
    popup.setMenu(null);
    popup.setMenuBarVisibility(false);
    secureGamePopup(popup.webContents, policy);
    popup.webContents.on("did-navigate", (_event, url, httpResponseCode) => {
      if (isAtlasClerkAuthorizationFailureNavigation(url, httpResponseCode)) {
        void repairAtlasClerkSignIn(popup).catch((error) => logStartupIssue("Atlas Clerk sign-in repair failed", error));
      }
    });
    popup.webContents.on("did-finish-load", () => {
      void repairAtlasClerkPageIfNeeded(popup.webContents, popup)
        .catch((error) => logStartupIssue("Atlas Clerk sign-in repair failed", error));
    });
  });
  webContents.on("did-navigate", (_event, url, httpResponseCode) => {
    if (isAtlasClerkAuthorizationFailureNavigation(url, httpResponseCode)) {
      void repairAtlasClerkSignIn().catch((error) => logStartupIssue("Atlas Clerk sign-in repair failed", error));
    }
  });
  webContents.on("did-finish-load", () => {
    void repairAtlasClerkPageIfNeeded(webContents)
      .catch((error) => logStartupIssue("Atlas Clerk sign-in repair failed", error));
  });
  const restrictGameNavigation = (event: Electron.Event, url: string) => {
    if (isAllowedGameMainFrameNavigation(policy, url)) {
      return;
    }
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) {
      void openExternalResource(url).catch(() => undefined);
    }
  };
  webContents.on("will-navigate", restrictGameNavigation);
  webContents.on("will-redirect", restrictGameNavigation);
}

function secureHomeMediaWebContents(
  webContents: WebContents,
  policy: Extract<EmbeddedWebviewPolicy, { kind: "home-video" }>
): void {
  installRestrictedEmbeddedPermissions(
    webContents,
    policy,
    new Set(["clipboard-sanitized-write", "fullscreen"])
  );
  webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void openExternalResource(url).catch(() => undefined);
    }
    return { action: "deny" };
  });
  const restrictNavigation = (event: Electron.Event, url: string) => {
    if (isAllowedEmbeddedNavigation(policy, url)) {
      return;
    }
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) {
      void openExternalResource(url).catch(() => undefined);
    }
  };
  webContents.on("will-navigate", restrictNavigation);
  webContents.on("will-redirect", restrictNavigation);
}

function secureRiftLiteReplayWebContents(webContents: WebContents): void {
  const replaySession = webContents.session;
  const isExactReplayRequester = (requestingContents: WebContents | null, requestingUrl: string) => (
    requestingContents?.id === webContents.id &&
    !webContents.isDestroyed() &&
    isAllowedRiftLiteReplayNavigation(requestingUrl || webContents.getURL())
  );
  replaySession.setPermissionCheckHandler((requestingContents, permission, _origin, details) => {
    if (!details.isMainFrame || !isExactReplayRequester(requestingContents, details.requestingUrl || "")) {
      return false;
    }
    return replayEmbedPermissionCheckAllowed(permission, details.mediaType);
  });
  replaySession.setPermissionRequestHandler((requestingContents, permission, callback, details) => {
    callback(
      replayEmbedPermissionRequestAllowed(permission) &&
      details.isMainFrame &&
      isExactReplayRequester(requestingContents, details.requestingUrl)
    );
  });
  replaySession.setDisplayMediaRequestHandler((request, callback) => {
    const respond = createSingleUseDisplayMediaResponder(callback, (error) => {
      void logStartupIssue("replay embed display-media response failed", error);
    });
    let streams: Electron.Streams | null = null;
    try {
      const mainFrame = webContents.isDestroyed() ? null : webContents.mainFrame;
      const requestingFrame = request.frame;
      const requestingContents = requestingFrame
        ? electronWebContents.fromFrame(requestingFrame)
        : undefined;
      const exactFrame = Boolean(
        mainFrame &&
        requestingFrame &&
        requestingContents?.id === webContents.id &&
        requestingFrame.processId === mainFrame.processId &&
        requestingFrame.routingId === mainFrame.routingId
      );
      const denied = (
        !mainFrame ||
        !exactFrame ||
        !request.userGesture ||
        !request.videoRequested ||
        request.audioRequested ||
        !isRiftLiteReplayOrigin(request.securityOrigin) ||
        !isAllowedRiftLiteReplayNavigation(mainFrame.url)
      );
      if (!denied && mainFrame) {
        streams = { video: mainFrame };
      }
    } catch (error) {
      void logStartupIssue("replay embed display-media resolution failed", error);
    }
    respond(streams);
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void openExternalResource(url).catch(() => undefined);
    }
    return { action: "deny" };
  });
  const restrictNavigation = (event: Electron.Event, url: string) => {
    if (isAllowedRiftLiteReplayNavigation(url)) {
      return;
    }
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) {
      void openExternalResource(url).catch(() => undefined);
    }
  };
  webContents.on("will-navigate", restrictNavigation);
  webContents.on("will-redirect", restrictNavigation);
}

async function clearRiftLiteReplayEmbedCookies(): Promise<void> {
  const replaySession = electronSession.fromPartition(RIFTLITE_REPLAY_PARTITION);
  await clearReplayEmbedCookies(replaySession);
}

async function prepareRiftLiteReplayEmbed(replayId: string) {
  const replaySession = electronSession.fromPartition(RIFTLITE_REPLAY_PARTITION);
  const authGeneration = syncService.getLinkedAccountAuthGeneration();
  let result = await prepareReplayEmbedSession(
    replayId,
    replaySession,
    () => syncService.refreshLinkedAccountIdToken(),
    () => syncService.isLinkedAccountAuthGenerationCurrent(authGeneration)
  );
  if (!syncService.isLinkedAccountAuthGenerationCurrent(authGeneration)) {
    await clearReplayEmbedCookies(replaySession).catch(() => undefined);
    result = {
      url: result.url,
      authenticated: false,
      error: "The linked RiftLite account changed during replay authentication."
    };
  }
  const replayContents = riftLiteReplayWebContents;
  if (replayContents && !replayContents.isDestroyed()) {
    await replayContents.loadURL(result.url).catch(() => undefined);
  }
  return result;
}

async function prepareRiftLiteReplayLibraryEmbed() {
  const replaySession = electronSession.fromPartition(RIFTLITE_REPLAY_PARTITION);
  const authGeneration = syncService.getLinkedAccountAuthGeneration();
  let result = await prepareReplayLibraryEmbedSession(
    replaySession,
    () => syncService.refreshLinkedAccountIdToken(),
    () => syncService.isLinkedAccountAuthGenerationCurrent(authGeneration)
  );
  if (!syncService.isLinkedAccountAuthGenerationCurrent(authGeneration)) {
    await clearReplayEmbedCookies(replaySession).catch(() => undefined);
    result = {
      url: result.url,
      authenticated: false,
      error: "The linked RiftLite account changed during replay authentication."
    };
  }
  const replayContents = riftLiteReplayWebContents;
  if (replayContents && !replayContents.isDestroyed()) {
    await replayContents.loadURL(result.url).catch(() => undefined);
  }
  return result;
}

function forgetGameWebContents(webContents: WebContents): void {
  for (const [platform, contents] of gameWebContentsByPlatform.entries()) {
    if (contents.id === webContents.id) {
      gameWebContentsByPlatform.delete(platform);
    }
  }
}

function installRawCaptureWebSocketTap(webContents: WebContents): void {
  if (rawCaptureDebuggerContents.has(webContents) || webContents.isDestroyed()) {
    return;
  }
  const platform = platformFromUrl(webContents.getURL());
  if (platform !== "atlas") {
    return;
  }
  rawCaptureDebuggerContents.add(webContents);
  const socketUrls = new Map<string, string>();
  const battlefieldSeatSockets = new AtlasBattlefieldSeatSocketTracker();
  try {
    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach("1.3");
    }
    recordAtlasDeckTrackerFrameDebug("main-debugger", {
      platform: "atlas",
      requestUrl: webContents.getURL(),
      frame: {
        seq: 0,
        ts: Date.now(),
        dir: "in",
        raw: "{\"type\":\"debugger-attached\"}"
      }
    }, "debugger-attached");
    webContents.debugger.sendCommand("Network.enable").catch((error) => {
      void logStartupIssue("raw capture network enable failed", error);
    });
  } catch (error) {
    void logStartupIssue("raw capture debugger attach failed", error);
    return;
  }

  webContents.debugger.on("message", (_event, method, params) => {
    if (webContents.isDestroyed()) {
      return;
    }
    const payload = params && typeof params === "object" ? params as Record<string, unknown> : {};
    if (method === "Network.webSocketCreated") {
      const requestId = readDebugString(payload.requestId);
      const url = readDebugString(payload.url);
      if (requestId && isRiftAtlasRealtimeSocket(url)) {
        socketUrls.set(requestId, url);
        battlefieldSeatSockets.observeOpened(requestId, url);
      }
      return;
    }
    if (method === "Network.webSocketClosed") {
      const requestId = readDebugString(payload.requestId);
      battlefieldSeatSockets.observeClosed(requestId);
      socketUrls.delete(requestId);
      return;
    }
    if (method !== "Network.webSocketFrameReceived" && method !== "Network.webSocketFrameSent") {
      return;
    }
    const requestId = readDebugString(payload.requestId);
    const requestUrl = socketUrls.get(requestId) || "";
    if (!requestId || !isRiftAtlasRealtimeSocket(requestUrl)) {
      return;
    }
    const response = payload.response && typeof payload.response === "object"
      ? payload.response as Record<string, unknown>
      : {};
    const raw = readDebugString(response.payloadData);
    if (!raw || raw.length > 1_500_000 || !raw.trim().startsWith("{")) {
      return;
    }
    const frame: RawCaptureAppendFramePayload = {
      platform: "atlas",
      requestUrl,
      frame: {
        seq: 0,
        ts: Date.now(),
        dir: method === "Network.webSocketFrameSent" ? "out" : "in",
        socketId: requestId,
        raw
      }
    };
    ingestAtlasRawFrame(
      "main-debugger",
      webContents,
      frame,
      "atlas-ws-frame",
      battlefieldSeatSockets.isCurrent(requestId)
    );
  });

  webContents.once("destroyed", () => {
    socketUrls.clear();
    atlasFrameDeduper.forgetStream(String(webContents.id));
    try {
      if (webContents.debugger.isAttached()) {
        webContents.debugger.detach();
      }
    } catch {
      // The webContents is already gone; nothing to clean up.
    }
  });
}

function maybeInstallRawCaptureWebSocketTap(webContents: WebContents): void {
  if (webContents.isDestroyed() || platformFromUrl(webContents.getURL()) !== "atlas") {
    return;
  }
  installRawCaptureWebSocketTap(webContents);
}

function isRiftAtlasRealtimeSocket(url: string): boolean {
  return /realtime\.riftatlas-workers\.com/i.test(url) || /riftatlas/i.test(url);
}

function readDebugString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function ingestAtlasRawFrame(
  source: AtlasFrameSource,
  webContents: WebContents,
  frame: RawCaptureAppendFramePayload,
  reason: string,
  bridgeBattlefieldSeat = false
): void {
  const battlefieldSeatSignal = bridgeBattlefieldSeat
    ? atlasBattlefieldSeatSignalFromFrame(frame)
    : null;
  if (battlefieldSeatSignal && !webContents.isDestroyed()) {
    try {
      webContents.send(ATLAS_BATTLEFIELD_SEAT_IPC_CHANNEL, battlefieldSeatSignal);
      if (typeof diagnostics !== "undefined") {
        const capturedAt = new Date().toISOString();
        void diagnostics.record({
          id: `atlas-battlefield-seat-bridged:${webContents.id}:${capturedAt}`,
          platform: "atlas",
          kind: "debug",
          capturedAt,
          url: "https://play.riftatlas.com/game",
          payload: {
            reason: "atlas-battlefield-seat-bridged",
            source,
            frameType: battlefieldSeatSignal.frameType,
            roomCode: battlefieldSeatSignal.roomCode,
            atlasLocalPlayerSeat: battlefieldSeatSignal.localSeat
          }
        }).catch(() => undefined);
      }
    } catch (error) {
      void logStartupIssue("atlas battlefield seat bridge failed", error);
    }
  }
  if (!atlasFrameDeduper.shouldIngest(source, String(webContents.id), frame)) {
    return;
  }
  recordAtlasDeckTrackerFrameDebug(source, frame, reason);
  if (RIFTREPLAY_CAPTURE_FEATURE_ENABLED) {
    void rawCaptureService.appendFrame(frame).catch((error) => {
      void logStartupIssue("raw capture append failed", error);
    });
  }
  const seatEvent = atlasSeatCaptureEvent(frame);
  if (seatEvent && capture) {
    void capture.handleEvent(seatEvent).catch((error) => {
      void logStartupIssue("atlas websocket seat capture failed", error);
    });
  }
  void deckTrackerService?.ingestAtlasRawFrame(frame).catch((error) => {
    void logStartupIssue("deck tracker atlas frame failed", error);
  });
}

function recordAtlasDeckTrackerFrameDebug(source: string, frame: RawCaptureAppendFramePayload, reason: string): void {
  try {
    const key = `${source}:${frame.platform}`;
    const count = (atlasDeckTrackerFrameDebugCounts.get(key) ?? 0) + 1;
    atlasDeckTrackerFrameDebugCounts.set(key, count);
    if (count > 5 && count % 50 !== 0) {
      return;
    }
    const raw = frame.frame.raw ?? "";
    const capturedAt = new Date().toISOString();
    void diagnostics?.record({
      id: `atlas-deck-tracker-frame-${source}-${count}-${randomUUID()}`,
      platform: "atlas",
      kind: "debug",
      capturedAt,
      url: frame.requestUrl ?? "",
      payload: {
        reason,
        source,
        count,
        dir: frame.frame.dir,
        socketId: frame.frame.socketId ?? "",
        requestUrl: frame.requestUrl ?? "",
        rawLength: raw.length,
        rawType: readAtlasFrameType(raw),
        trackerMarker: "atlas-event-deck-tracker-v1"
      }
    });
  } catch {
    // Diagnostics must never affect gameplay or capture.
  }
}

function readAtlasFrameType(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.type === "string" ? parsed.type : "";
  } catch {
    return "";
  }
}

const TCGA_RESEARCH_MAX_CDP_TEXT = 1_200_000;
const TCGA_RESEARCH_MAX_BINDING_BYTES = 2 * 1024 * 1024;

function recordTcgaReplayResearch(
  kind: string,
  payload: Record<string, unknown>,
  recordedAt?: string | number,
  source = "tcga-main"
): void {
  if (!tcgaReplayResearchCapture?.getStatus().active) return;
  void tcgaReplayResearchCapture.record(kind, payload, recordedAt, source)
    .then(() => {
      if (!tcgaReplayResearchCapture.getStatus().active) {
        void setTcgaReplayResearchTapActive(false).catch(() => undefined);
      }
    })
    .catch((error) => {
      void logStartupIssue("TCGA replay monitor write failed", error);
    });
}

function tcgaResearchRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function tcgaResearchText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function boundedTcgaResearchText(value: string): Record<string, unknown> {
  return {
    encoding: "utf8",
    data: value.slice(0, TCGA_RESEARCH_MAX_CDP_TEXT),
    charLength: value.length,
    truncated: value.length > TCGA_RESEARCH_MAX_CDP_TEXT
  };
}

function tcgaResearchResponseBody(body: string, base64Encoded: boolean, mimeType: string): Record<string, unknown> {
  const textual = /(?:json|text|javascript|xml|x-www-form-urlencoded|webchannel|event-stream)/i.test(mimeType);
  if (!base64Encoded) {
    return boundedTcgaResearchText(body);
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(body, "base64");
  } catch {
    return { encoding: "base64", byteLength: body.length, unavailable: true };
  }
  if (textual) {
    return {
      ...boundedTcgaResearchText(decoded.toString("utf8")),
      transportEncoding: "base64",
      byteLength: decoded.byteLength
    };
  }
  return {
    encoding: "binary-metadata",
    byteLength: decoded.byteLength,
    sha256: createHash("sha256").update(decoded).digest("hex")
  };
}

function tcgaResearchDynamicResource(resourceType: string, url: string): boolean {
  return ["XHR", "Fetch", "WebSocket", "EventSource"].includes(resourceType) ||
    /(?:peer|firebase|game|match|api|socket|signal|webchannel|myapp)/i.test(url);
}

function trustedTcgaResearchContents(webContents: WebContents): boolean {
  return !webContents.isDestroyed() &&
    gameWebContentsByPlatform.get("tcga")?.id === webContents.id &&
    platformFromUrl(webContents.getURL()) === "tcga";
}

async function configureTcgaResearchPageHook(
  tap: TcgaReplayResearchTap,
  active: boolean,
  sessionId = ""
): Promise<void> {
  const debuggerApi = tap.webContents.debugger;
  if (tap.scriptIdentifier) {
    await debuggerApi.sendCommand("Page.removeScriptToEvaluateOnNewDocument", {
      identifier: tap.scriptIdentifier
    }).catch(() => undefined);
    tap.scriptIdentifier = "";
  }
  const source = tcgaReplayResearchPageHookSource(active, sessionId);
  const installed = await debuggerApi.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source }) as { identifier?: string };
  tap.scriptIdentifier = tcgaResearchText(installed?.identifier);
  const evaluated = await debuggerApi.sendCommand("Runtime.evaluate", {
    expression: source,
    includeCommandLineAPI: false,
    returnByValue: true,
    awaitPromise: false
  }) as {
    result?: { value?: unknown };
    exceptionDetails?: { text?: string };
  };
  if (evaluated.exceptionDetails || evaluated.result?.value !== true) {
    throw new Error(evaluated.exceptionDetails?.text || "TCGA monitor page hook did not initialise.");
  }
}

function installTcgaReplayResearchTap(webContents: WebContents): TcgaReplayResearchTap | null {
  const existing = tcgaReplayResearchTaps.get(webContents.id);
  if (existing) return existing;
  const policy = embeddedWebviewPolicyBySession.get(webContents.session);
  if (!policy || policy.kind !== "game" || policy.platform !== "tcga" || webContents.isDestroyed()) {
    return null;
  }

  const requests = new Map<string, TcgaReplayResearchRequest>();
  const socketUrls = new Map<string, string>();
  const listener = (_event: unknown, method: string, params: unknown) => {
    const researchStatus = tcgaReplayResearchCapture?.getStatus();
    const researchActive = researchStatus?.active === true;
    const productActive = Boolean(tcgaWebReplayProductAccountUid && tcgaWebReplayCaptureService);
    if ((!researchActive && !productActive) || !trustedTcgaResearchContents(webContents)) return;
    const payload = tcgaResearchRecord(params);
    const requestId = tcgaResearchText(payload.requestId);

    if (method === "Runtime.bindingCalled") {
      if (tcgaResearchText(payload.name) !== TCGA_REPLAY_RESEARCH_BINDING) return;
      const raw = tcgaResearchText(payload.payload);
      if (!raw || Buffer.byteLength(raw, "utf8") > TCGA_RESEARCH_MAX_BINDING_BYTES) return;
      try {
        const decoded = JSON.parse(raw) as Record<string, unknown>;
        if (
          decoded.schema !== "riftlite-tcga-page-research" ||
          decoded.version !== 1
        ) {
          return;
        }
        const kind = tcgaResearchText(decoded.kind);
        const capturedAt = tcgaResearchText(decoded.capturedAt);
        const documentId = tcgaResearchText(decoded.documentId);
        const decodedPayload = tcgaResearchRecord(decoded.payload);
        if (productActive && (
          kind === "hook-ready" ||
          kind === "hook-resumed" ||
          kind === "rtc-channel" ||
          kind === "rtc-data"
        )) {
          tcgaWebReplayCaptureService?.ingestBindingEvent(webContents.id, {
            kind,
            capturedAt,
            documentId,
            payload: decodedPayload
          });
        }
        if (researchActive && tcgaResearchText(decoded.sessionId) === researchStatus?.sessionId) {
          recordTcgaReplayResearch(
            `page-${kind || "unknown"}`,
            {
              hookSequence: decoded.hookSequence,
              documentId,
              monotonicMs: decoded.monotonicMs,
              payload: decodedPayload
            },
            capturedAt,
            "tcga-rtc"
          );
        }
      } catch {
        // Ignore malformed data from the embedded page binding.
      }
      return;
    }

    // Product Web Replay consent covers only the narrow WebRTC game-channel
    // binding above. Ignore every broader CDP network event unless the user
    // separately started the local Research Monitor.
    if (!researchActive) return;

    if (method === "Network.requestWillBeSent") {
      const request = tcgaResearchRecord(payload.request);
      const url = tcgaResearchText(request.url);
      const resourceType = tcgaResearchText(payload.type);
      if (!requestId || !tcgaResearchDynamicResource(resourceType, url)) return;
      requests.set(requestId, { url, resourceType, mimeType: "" });
      recordTcgaReplayResearch("network-request", {
        requestId,
        resourceType,
        url,
        method: tcgaResearchText(request.method),
        cdpTimestamp: payload.timestamp,
        wallTime: payload.wallTime,
        hasPostData: request.hasPostData === true,
        ...(typeof request.postData === "string" ? { postData: boundedTcgaResearchText(request.postData) } : {})
      }, undefined, "tcga-cdp");
      return;
    }

    if (method === "Network.responseReceived") {
      const response = tcgaResearchRecord(payload.response);
      const url = tcgaResearchText(response.url) || requests.get(requestId)?.url || "";
      const resourceType = tcgaResearchText(payload.type) || requests.get(requestId)?.resourceType || "";
      if (!requestId || !tcgaResearchDynamicResource(resourceType, url)) return;
      const mimeType = tcgaResearchText(response.mimeType);
      requests.set(requestId, { url, resourceType, mimeType });
      recordTcgaReplayResearch("network-response", {
        requestId,
        resourceType,
        url,
        status: response.status,
        statusText: response.statusText,
        mimeType,
        protocol: response.protocol,
        fromDiskCache: response.fromDiskCache === true,
        fromServiceWorker: response.fromServiceWorker === true,
        cdpTimestamp: payload.timestamp
      }, undefined, "tcga-cdp");
      return;
    }

    if (method === "Network.loadingFinished") {
      const request = requests.get(requestId);
      if (!request) return;
      requests.delete(requestId);
      void webContents.debugger.sendCommand("Network.getResponseBody", { requestId })
        .then((result) => {
          const bodyResult = tcgaResearchRecord(result);
          const body = tcgaResearchText(bodyResult.body);
          recordTcgaReplayResearch("network-response-body", {
            requestId,
            resourceType: request.resourceType,
            url: request.url,
            mimeType: request.mimeType,
            encodedDataLength: payload.encodedDataLength,
            body: tcgaResearchResponseBody(body, bodyResult.base64Encoded === true, request.mimeType)
          }, undefined, "tcga-cdp");
        })
        .catch(() => undefined);
      return;
    }

    if (method === "Network.loadingFailed") {
      const request = requests.get(requestId);
      if (!request) return;
      requests.delete(requestId);
      recordTcgaReplayResearch("network-failed", {
        requestId,
        resourceType: request.resourceType,
        url: request.url,
        errorText: payload.errorText,
        canceled: payload.canceled === true
      }, undefined, "tcga-cdp");
      return;
    }

    if (method === "Network.webSocketCreated") {
      const url = tcgaResearchText(payload.url);
      socketUrls.set(requestId, url);
      recordTcgaReplayResearch("websocket-open", { requestId, url }, undefined, "tcga-cdp");
      return;
    }

    if (method === "Network.webSocketFrameReceived" || method === "Network.webSocketFrameSent") {
      const frame = tcgaResearchRecord(payload.response);
      const raw = tcgaResearchText(frame.payloadData);
      recordTcgaReplayResearch("websocket-frame", {
        requestId,
        url: socketUrls.get(requestId) || "",
        direction: method.endsWith("Sent") ? "out" : "in",
        opcode: frame.opcode,
        mask: frame.mask,
        data: boundedTcgaResearchText(raw),
        cdpTimestamp: payload.timestamp
      }, undefined, "tcga-cdp");
      return;
    }

    if (method === "Network.webSocketClosed") {
      recordTcgaReplayResearch("websocket-close", {
        requestId,
        url: socketUrls.get(requestId) || "",
        cdpTimestamp: payload.timestamp
      }, undefined, "tcga-cdp");
      socketUrls.delete(requestId);
      return;
    }

    if (method === "Network.eventSourceMessageReceived") {
      recordTcgaReplayResearch("event-source-message", {
        requestId,
        url: requests.get(requestId)?.url || "",
        eventName: payload.eventName,
        eventId: payload.eventId,
        data: boundedTcgaResearchText(tcgaResearchText(payload.data)),
        cdpTimestamp: payload.timestamp
      }, undefined, "tcga-cdp");
    }
  };

  const tap: TcgaReplayResearchTap = {
    webContents,
    listener,
    requests,
    socketUrls,
    scriptIdentifier: "",
    networkEnabled: false,
    ready: Promise.resolve()
  };
  tcgaReplayResearchTaps.set(webContents.id, tap);
  webContents.debugger.on("message", listener);
  tap.ready = (async () => {
    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach("1.3");
    }
    await Promise.all([
      webContents.debugger.sendCommand("Runtime.enable"),
      webContents.debugger.sendCommand("Page.enable")
    ]);
    await webContents.debugger.sendCommand("Runtime.addBinding", { name: TCGA_REPLAY_RESEARCH_BINDING });
    const captureStatus = tcgaReplayResearchCapture?.getStatus();
    await configureTcgaResearchPageHook(
      tap,
      captureStatus?.active === true || Boolean(tcgaWebReplayProductAccountUid),
      captureStatus?.active === true ? captureStatus.sessionId : ""
    );
    if (captureStatus?.active) {
      await webContents.debugger.sendCommand("Network.enable", {
        maxTotalBufferSize: 10 * 1024 * 1024,
        maxResourceBufferSize: 2 * 1024 * 1024,
        maxPostDataSize: TCGA_RESEARCH_MAX_CDP_TEXT
      });
      tap.networkEnabled = true;
    }
  })();
  void tap.ready.then(() => {
    if (tcgaReplayResearchCapture?.getStatus().active && trustedTcgaResearchContents(webContents)) {
      tcgaReplayResearchCapture.setTransportState("ready");
    }
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (tcgaReplayResearchCapture?.getStatus().active) {
      tcgaReplayResearchCapture.setTransportState("error", message);
      recordTcgaReplayResearch("monitor-hook-error", { phase: "install", message });
    }
  });
  webContents.once("destroyed", () => {
    tcgaReplayResearchTaps.delete(webContents.id);
    tcgaWebReplayCaptureService?.discardWebContents(webContents.id);
    requests.clear();
    socketUrls.clear();
  });
  return tap;
}

async function setTcgaReplayResearchTapActive(active: boolean, sessionId = ""): Promise<boolean> {
  const contents = gameWebContentsByPlatform.get("tcga");
  if (!contents || contents.isDestroyed()) return false;
  const tap = installTcgaReplayResearchTap(contents);
  if (!tap) return false;
  await tap.ready;
  if (!contents.debugger.isAttached()) {
    throw new Error("Chromium monitor connection is not attached.");
  }
  await configureTcgaResearchPageHook(
    tap,
    active || Boolean(tcgaWebReplayProductAccountUid),
    active ? sessionId : ""
  );
  if (active && !tap.networkEnabled) {
    await contents.debugger.sendCommand("Network.enable", {
      maxTotalBufferSize: 10 * 1024 * 1024,
      maxResourceBufferSize: 2 * 1024 * 1024,
      maxPostDataSize: TCGA_RESEARCH_MAX_CDP_TEXT
    });
    tap.networkEnabled = true;
  } else if (!active && tap.networkEnabled) {
    await contents.debugger.sendCommand("Network.disable").catch(() => undefined);
    tap.networkEnabled = false;
    tap.requests.clear();
    tap.socketUrls.clear();
  }
  if (active) {
    tcgaReplayResearchCapture.setTransportState("ready");
  }
  return true;
}

function configureTcgaWebReplayProductCapture(): Promise<void> {
  const operation = tcgaWebReplayConfigurationTail.then(() => configureTcgaWebReplayProductCaptureNow());
  tcgaWebReplayConfigurationTail = operation.then(
    () => undefined,
    () => undefined
  );
  return operation;
}

async function configureTcgaWebReplayProductCaptureNow(): Promise<void> {
  const settings = await store.getSettings();
  const outputDirectory = await rawCaptureService.captureDirectory();
  const nextAccountUid = riftLiteTcgaWebReplayAutoUploadAccountUid(settings);
  const activeHubIds = new Set(settings.activeHubs.map((hub) => hub.id));
  const discordShareHubIds = activeDiscordReplayHubIds(settings)
    .filter((hubId) => activeHubIds.has(hubId));
  await tcgaWebReplayCaptureService?.configure(outputDirectory, nextAccountUid, discordShareHubIds);
  tcgaWebReplayProductAccountUid = nextAccountUid;
  const contents = gameWebContentsByPlatform.get("tcga");
  if (nextAccountUid && contents && !contents.isDestroyed()) {
    tcgaWebReplayCaptureService?.beginDocument(contents.id);
    installTcgaReplayResearchTap(contents);
  }
  const researchStatus = tcgaReplayResearchCapture?.getStatus();
  if (
    !nextAccountUid &&
    researchStatus?.active !== true &&
    (!contents || !tcgaReplayResearchTaps.has(contents.id))
  ) {
    return;
  }
  await setTcgaReplayResearchTapActive(
    researchStatus?.active === true,
    researchStatus?.active === true ? researchStatus.sessionId : ""
  ).catch(() => false);
}

async function finalizeTcgaWebReplayCapture(
  identity: RawCaptureFinishIdentity,
  replay?: ReplayRecord
): Promise<ReplayRecord | null> {
  const result = await tcgaWebReplayCaptureService?.finalize(identity, replay);
  if (result?.status === "awaiting-result") {
    await diagnostics.record({
      id: randomUUID(),
      platform: "tcga",
      kind: "debug",
      capturedAt: new Date().toISOString(),
      url: "",
      payload: {
        reason: "tcga-web-replay-awaiting-result",
        consideredCandidates: result.consideredCandidates,
        readyCandidates: result.readyCandidates,
        expiresAt: result.capture.expiresAt
      }
    }).catch(() => undefined);
    return replay ?? null;
  }
  if (!result || result.status === "skipped") {
    if (result?.status === "skipped") {
      await diagnostics.record({
        id: randomUUID(),
        platform: "tcga",
        kind: "debug",
        capturedAt: new Date().toISOString(),
        url: "",
        payload: {
          reason: "tcga-web-replay-capture-skipped",
          captureReason: result.reason,
          consideredCandidates: result.consideredCandidates,
          readyCandidates: result.readyCandidates,
          rejectionCounts: result.rejectionCounts
        }
      }).catch(() => undefined);
    }
    return replay ?? null;
  }
  return result.registration;
}

function tcgaMatchCaptureCompletedAt(match: MatchDraft, replay?: ReplayRecord): string {
  const candidates = [
    ...match.rawEvidence.map((event) => event.capturedAt),
    ...(replay?.events.map((event) => event.capturedAt) ?? [])
  ]
    .map((value) => ({ value, at: Date.parse(value) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((left, right) => right.at - left.at);
  return candidates[0]?.value || match.updatedAt || match.capturedAt;
}

async function commitConfirmedTcgaReplayLocally(saved: MatchDraft): Promise<MatchDraft> {
  await capture.waitForReplayFinalization(saved.id);
  const latest = (await store.getMatches()).find((candidate) => candidate.id === saved.id) ?? saved;
  const replay = (await store.getReplays()).find((candidate) => candidate.matchId === saved.id);
  try {
    await finalizeTcgaWebReplayCapture({
      platform: "tcga",
      localMatchId: latest.id,
      localReplayId: replay?.id || `replay-${latest.id}`,
      title: `${latest.myChampion || "Unknown"} vs ${latest.opponentChampion || "Unknown"}`,
      capturedAt: latest.capturedAt,
      completedAt: tcgaMatchCaptureCompletedAt(latest, replay),
      match: rawCaptureMatchSummaryFromDraft(latest)
    }, replay);
    capture.markConfirmedReplayFinalizationComplete(latest.id);
    return (await store.getMatches()).find((candidate) => candidate.id === latest.id) ?? latest;
  } catch (error) {
    capture.markConfirmedReplayFinalizationPending(latest.id, error);
    await logStartupIssue("TCGA Web Replay local confirmation commit failed", error);
    throw error;
  }
}

async function deliverConfirmedMatch(saved: MatchDraft): Promise<void> {
  await deliverConfirmedMatchInBackground(saved, {
    finalizeReplay: async (candidate) => {
      if (candidate.platform === "tcga") {
        // TCGA confirmation has already committed the product artifact,
        // manifest, and replay association. Publication performs its ordered
        // match/hub sync callback, so do not report the same match twice.
        const deliveryState = await rawCaptureService.tcgaDeliveryStateForMatch(candidate.id);
        if (deliveryState === "pending") {
          await rawCaptureService.deliverRegisteredTcgaCapture(candidate.id);
          return "sync-complete";
        }
      } else {
        // Atlas finalization may still be persisting or uploading when the
        // local confirmation returns. Keep replay-before-report ordering in
        // this background lane without holding the review popup open.
        await capture.waitForReplayFinalization(candidate.id);
        // If the initial finalizer stopped because the match logger was still
        // awaiting review, confirmation is now the trigger to upload the
        // corrected result and post it to Discord immediately.
        await uploadPendingRawCapturesWithAccountRefresh();
      }
      return "sync-required";
    },
    loadLatest: async (candidate) => (
      (await store.getMatches()).find((current) => current.id === candidate.id) ?? candidate
    ),
    syncMatch: async (latest) => {
      const synced = await capture.syncConfirmedMatch(latest);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("match:draft", synced);
      }
      queueAccountCloudSync("Match saved");
    }
  });
}

function queueConfirmedMatchDelivery(saved: MatchDraft): void {
  const existing = confirmedMatchDeliveryByMatchId.get(saved.id);
  if (existing?.pending) {
    return;
  }
  const job: ConfirmedMatchDeliveryJob = existing ?? { saved, pending: null };
  job.saved = saved;
  confirmedMatchDeliveryByMatchId.set(saved.id, job);
  capture.markConfirmedReplayFinalizationQueued(saved.id);

  // Let Electron resolve the confirmation IPC before starting disk/network
  // delivery. The match itself is already durable at this point.
  const pending = new Promise<void>((resolvePending) => setImmediate(resolvePending))
    .then(() => deliverConfirmedMatch(job.saved));
  job.pending = pending;
  void pending.then(
    () => {
      if (confirmedMatchDeliveryByMatchId.get(saved.id) === job) {
        confirmedMatchDeliveryByMatchId.delete(saved.id);
      }
      capture.markConfirmedReplayFinalizationComplete(saved.id);
    },
    async (error) => {
      if (confirmedMatchDeliveryByMatchId.get(saved.id) === job) {
        job.pending = null;
      }
      // Durable local match/replay state remains retryable through the normal
      // startup/two-minute upload and report recovery lanes.
      capture.markConfirmedReplayDeliveryDeferred(saved.id);
      await logStartupIssue(`${saved.platform} confirmed replay/report background delivery failed`, error);
      try {
        const latest = (await store.getMatches()).find((candidate) => candidate.id === saved.id) ?? saved;
        const synced = await capture.syncConfirmedMatch(latest);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("match:draft", synced);
        }
        queueAccountCloudSync("Match saved; Web Replay delivery pending");
      } catch (syncError) {
        await logStartupIssue("Match report fallback after replay delivery failure failed", syncError);
      }
    }
  );
}

async function takeScreenshot(source: ScreenshotResult["source"] = "manual", options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
  const settings = await store.getSettings();
  const directory = screenshotDirectory(settings);
  const extension = "png";
  const filename = screenshotFilename(options.label, extension);
  const filePath = join(directory, filename);
  try {
    const preferredContents = options.platform ? gameWebContentsByPlatform.get(options.platform) : undefined;
    const captureContents = preferredContents && !preferredContents.isDestroyed()
      ? preferredContents
      : mainWindow?.webContents;
    if (!captureContents || captureContents.isDestroyed()) {
      throw new Error("RiftLite window is not ready.");
    }
    await mkdir(directory, { recursive: true });
    const image = await captureContents.capturePage();
    if (image.isEmpty()) {
      throw new Error("Screenshot capture returned an empty image.");
    }
    await writeFile(filePath, image.toPNG());
    const result: ScreenshotResult = {
      ok: true,
      path: filePath,
      url: pathToFileURL(filePath).href,
      directory,
      filename,
      message: `Saved ${filename}`,
      source
    };
    if (!options.silent) {
      mainWindow?.webContents.send("screenshot:saved", result);
    }
    return result;
  } catch (error) {
    const result: ScreenshotResult = {
      ok: false,
      path: filePath,
      directory,
      filename,
      message: error instanceof Error ? error.message : "Screenshot failed.",
      source
    };
    if (!options.silent) {
      mainWindow?.webContents.send("screenshot:saved", result);
    }
    return result;
  }
}

async function captureTimedReplayFrame(
  platform: GamePlatform,
  label: string,
  capturedAt: string,
  options: { force?: boolean } = {}
): Promise<ReplayScreenshotFrame | null> {
  const directory = await currentReplayFrameCaptureDirectory();
  const filename = screenshotFilename(label || platform, "jpg");
  const filePath = join(directory, filename);
  try {
    const preferredContents = gameWebContentsByPlatform.get(platform);
    const captureContents = preferredContents && !preferredContents.isDestroyed()
      ? preferredContents
      : mainWindow?.webContents;
    if (!captureContents || captureContents.isDestroyed()) {
      return null;
    }
    const image = await captureContents.capturePage();
    if (image.isEmpty()) {
      return null;
    }
    const hash = replayFrameHash(image);
    const last = replayFrameHashByPlatform.get(platform);
    const capturedTime = new Date(capturedAt).getTime() || Date.now();
    const differsEnough = !last || hammingRatio(last.hash, hash) >= REPLAY_FRAME_DEDUPE_THRESHOLD;
    const keepAliveFrame = last ? capturedTime - last.capturedAt >= 60_000 : false;
    if (!options.force && !differsEnough && !keepAliveFrame) {
      return null;
    }
    await ensureReplayFrameDirectory(directory);
    await writeFile(filePath, image.toJPEG(REPLAY_FRAME_JPEG_QUALITY));
    replayFrameHashByPlatform.set(platform, { hash, capturedAt: capturedTime });
    return {
      path: filePath,
      url: pathToFileURL(filePath).href,
      label: label || "Replay frame",
      capturedAt,
      source: "timed-replay",
      hash
    };
  } catch {
    return null;
  }
}

async function currentReplayFrameCaptureDirectory(): Promise<string> {
  const current = Date.now();
  if (replayFrameDirectoryCache && replayFrameDirectoryCache.expiresAt > current) {
    return replayFrameDirectoryCache.path;
  }
  const settings = await store.getSettings();
  const directory = replayFrameCaptureDirectory(settings);
  replayFrameDirectoryCache = {
    path: directory,
    expiresAt: current + REPLAY_FRAME_DIRECTORY_CACHE_MS
  };
  return directory;
}

async function ensureReplayFrameDirectory(directory: string): Promise<void> {
  if (ensuredReplayFrameDirectories.has(directory)) {
    return;
  }
  await mkdir(directory, { recursive: true });
  ensuredReplayFrameDirectories.add(directory);
}

function replayFrameHash(image: NativeImage): string {
  const sample = image.resize({ width: 48, height: 27, quality: "good" }).toBitmap();
  const values: number[] = [];
  for (let index = 0; index + 2 < sample.length; index += 4) {
    const blue = sample[index] ?? 0;
    const green = sample[index + 1] ?? 0;
    const red = sample[index + 2] ?? 0;
    values.push((red * 0.299) + (green * 0.587) + (blue * 0.114));
  }
  const average = values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
  return values.map((value) => value > average ? "1" : "0").join("");
}

function hammingRatio(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  if (!length) {
    return 1;
  }
  let distance = Math.abs(a.length - b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) {
      distance += 1;
    }
  }
  return distance / Math.max(a.length, b.length);
}

async function configureScreenshotHotkey(): Promise<void> {
  if (registeredScreenshotHotkey) {
    globalShortcut.unregister(registeredScreenshotHotkey);
    registeredScreenshotHotkey = "";
  }
  const settings = await store.getSettings();
  const hotkey = settings.screenshotHotkey?.trim();
  if (!settings.screenshotHotkeyEnabled || !hotkey) {
    return;
  }
  const registered = globalShortcut.register(hotkey, () => {
    void takeScreenshot("hotkey");
  });
  registeredScreenshotHotkey = registered ? hotkey : "";
}

function unregisterReplayHotkeys(): void {
  if (registeredShadowClipHotkey) {
    globalShortcut.unregister(registeredShadowClipHotkey);
    registeredShadowClipHotkey = "";
  }
  if (registeredReplayFlagHotkey) {
    globalShortcut.unregister(registeredReplayFlagHotkey);
    registeredReplayFlagHotkey = "";
  }
}

async function configureReplayHotkeys(): Promise<void> {
  unregisterReplayHotkeys();
  const settings = await store.getSettings();
  const shadowClipHotkey = settings.replayShadowClipHotkey?.trim();
  if (
    settings.replayVideoEnabled &&
    settings.replayShadowClipEnabled &&
    settings.replayShadowClipHotkeyEnabled &&
    shadowClipHotkey
  ) {
    const registered = globalShortcut.register(shadowClipHotkey, () => {
      mainWindow?.webContents.send("replay:shadow-clip-hotkey");
    });
    registeredShadowClipHotkey = registered ? shadowClipHotkey : "";
  }

  const flagHotkey = settings.replayQuickFlagHotkey?.trim();
  if (
    settings.replayVideoEnabled &&
    settings.replayQuickFlagHotkeyEnabled &&
    flagHotkey &&
    flagHotkey !== registeredShadowClipHotkey
  ) {
    const registered = globalShortcut.register(flagHotkey, () => {
      mainWindow?.webContents.send("replay:quick-flag-hotkey");
    });
    registeredReplayFlagHotkey = registered ? flagHotkey : "";
  }
}

async function openExternalResource(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:" && parsed.protocol !== "mailto:" && parsed.protocol !== "discord:") {
    throw new Error("Only web, Discord, and email links can be opened.");
  }
  await shell.openExternal(parsed.toString());
}

async function discordDirectVoiceConfigured(): Promise<boolean> {
  try {
    const response = await fetch("https://www.riftlite.com/api/discord/rpc-token", {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) return false;
    const payload = await response.json() as { configured?: unknown };
    return payload.configured === true;
  } catch {
    return false;
  }
}

async function joinDiscordVoiceFromListing(listing: Pick<LfgListing, "discordVoiceChannelId" | "discordGuildId" | "discordChannelUrl" | "discordAppUrl" | "discordInviteUrl">): Promise<DiscordVoiceJoinResult> {
  const fallbackUrl = listing.discordAppUrl || listing.discordChannelUrl || listing.discordInviteUrl;
  const channelId = listing.discordVoiceChannelId?.trim() ?? "";
  if (!channelId) {
    if (fallbackUrl) await openExternalResource(fallbackUrl);
    return {
      ok: false,
      attempted: false,
      usedFallback: Boolean(fallbackUrl),
      message: fallbackUrl ? "Opening Discord voice channel." : "No Discord voice channel is available."
    };
  }

  if (!await discordDirectVoiceConfigured()) {
    if (fallbackUrl) await openExternalResource(fallbackUrl);
    return {
      ok: false,
      attempted: false,
      usedFallback: Boolean(fallbackUrl),
      message: fallbackUrl ? "Opening Discord voice channel. Direct voice join is not configured yet." : "Discord direct voice join is not configured yet."
    };
  }

  try {
    return await joinDiscordVoiceChannel({
      channelId,
      tokenCachePath: join(app.getPath("userData"), "discord-rpc-token.json"),
      exchangeCode: (code) => syncService.exchangeDiscordRpcCode(code),
      refreshToken: (refreshToken) => syncService.refreshDiscordRpcToken(refreshToken),
      confirmMoveFromCurrentVoice: async () => {
        const response = mainWindow
          ? await dialog.showMessageBox(mainWindow, {
            type: "question",
            buttons: ["Move me", "Stay where I am"],
            defaultId: 0,
            cancelId: 1,
            title: "Move Discord voice?",
            message: "Discord says you are already in another voice channel.",
            detail: "Do you want RiftLite to move you into this LFG voice room?"
          })
          : await dialog.showMessageBox({
            type: "question",
            buttons: ["Move me", "Stay where I am"],
            defaultId: 0,
            cancelId: 1,
            title: "Move Discord voice?",
            message: "Discord says you are already in another voice channel.",
            detail: "Do you want RiftLite to move you into this LFG voice room?"
          });
        return response.response === 0;
      }
    });
  } catch (error) {
    if (fallbackUrl) {
      await openExternalResource(fallbackUrl);
      return {
        ok: false,
        attempted: true,
        usedFallback: true,
        message: `${error instanceof Error ? error.message : "Discord direct voice join failed."} Opening Discord channel instead.`
      };
    }
    throw error;
  }
}

function simEventReceiverEnabled(): boolean {
  return process.env.RIFTLITE_SIM_EVENTS === "1" || app.commandLine.hasSwitch("riftlite-sim-events");
}

async function trackSpotlightClick(payload: SpotlightClickPayload): Promise<void> {
  try {
    await fetch("https://www.riftlite.com/api/spotlight/click", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        spotlightId: payload.spotlightId,
        linkId: payload.linkId,
        appVersion: payload.appVersion || app.getVersion(),
        source: payload.source || "desktop",
        occurredAt: new Date().toISOString(),
      }),
    });
  } catch {
    // Spotlight analytics must never block the user opening the link.
  }
}

async function startReplayVideoCaptureFile(options: ReplayVideoStartOptions): Promise<ReplayVideoSession> {
  const settings = await store.getSettings();
  const directory = replayVideoDirectory(settings);
  await mkdir(directory, { recursive: true });
  const startedAt = new Date().toISOString();
  const filename = screenshotFilename(`${options.platform}-${options.quality}-${options.title || "video-replay"}`, replayVideoExtension(options.mimeType));
  const filePath = join(directory, filename);
  await writeFile(filePath, Buffer.alloc(0));
  const session: ReplayVideoSession = {
    id: `video-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    path: filePath,
    url: pathToFileURL(filePath).href,
    filename,
    directory,
    startedAt
  };
  replayVideoSessions.set(session.id, session);
  return session;
}

async function appendReplayVideoChunk(sessionId: string, chunk: ArrayBuffer | Uint8Array): Promise<void> {
  const session = replayVideoSessions.get(sessionId);
  if (!session) {
    throw new Error("Replay video session is no longer active.");
  }
  const buffer = chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(chunk);
  if (buffer.length) {
    await appendFile(session.path, buffer);
  }
}

async function finishReplayVideoCaptureFile(sessionId: string, options: ReplayVideoFinalizeOptions): Promise<ReplayVideoAsset> {
  const session = replayVideoSessions.get(sessionId);
  if (!session) {
    throw new Error("Replay video session is no longer active.");
  }
  replayVideoSessions.delete(sessionId);
  let fileStats = await stat(session.path);
  if (fileStats.size <= 0) {
    await unlink(session.path).catch(() => undefined);
    throw new Error("Replay video finished with no media data.");
  }
  const containerFinalized = await makeReplayVideoSeekable(session.path, options.mimeType);
  fileStats = await stat(session.path);
  const decodeProbeOk = await validateReplayVideoReadable(session.path, fileStats.size, options.mimeType).catch(() => false);
  if (!decodeProbeOk) {
    console.warn("[replay-video] Finished video failed decode probe; marking media as needing review.", session.path);
  }
  const actualBitrateKbps = actualReplayBitrateKbps(fileStats.size, options.durationMs) ?? options.actualBitrateKbps;
  return {
    path: session.path,
    url: session.url,
    filename: session.filename,
    directory: session.directory,
    mimeType: options.mimeType,
    source: options.source,
    platform: options.platform,
    startedAt: options.startedAt || session.startedAt,
    endedAt: options.endedAt,
    durationMs: options.durationMs,
    sizeBytes: fileStats.size,
    width: options.width,
    height: options.height,
    fps: options.fps,
    captureIntervalMs: options.captureIntervalMs,
    bitrateKbps: options.bitrateKbps,
    actualBitrateKbps,
    codec: options.codec,
    quality: options.quality,
    hasAudio: Boolean(options.hasAudio),
    containerFinalized: containerFinalized && decodeProbeOk
  };
}

async function mergeReplayVideoSegments(segments: ReplayVideoAsset[], options: ReplayVideoMergeOptions): Promise<ReplayVideoAsset> {
  const validSegments = segments.filter((segment) => segment.path?.trim());
  if (validSegments.length <= 1) {
    const only = validSegments[0];
    if (!only) {
      throw new Error("No replay video segments to merge.");
    }
    return only;
  }
  const ffmpegPath = replayVideoFfmpegPath();
  if (!ffmpegPath || !(await pathExists(ffmpegPath))) {
    throw new Error("Replay video merge needs ffmpeg.");
  }

  for (const segment of validSegments) {
    await assertReplayVideoPathAllowed(segment.path);
    if (!(await pathExists(segment.path))) {
      throw new Error(`Replay segment missing: ${segment.filename || segment.path}`);
    }
    if (!segment.containerFinalized) {
      await makeReplayVideoSeekable(segment.path, segment.mimeType).catch(() => false);
    }
  }

  const first = validSegments[0]!;
  const settings = await store.getSettings();
  const directory = replayVideoDirectory(settings);
  await mkdir(directory, { recursive: true });
  const width = first.width || 1920;
  const height = first.height || 1080;
  const fps = first.fps || 24;
  const bitrateKbps = first.bitrateKbps || 1100;
  const canMergeAudio = validSegments.every((segment) => segment.hasAudio);
  const filename = screenshotFilename(`${options.platform}-${options.quality}-${options.title || "merged-video-replay"}`, "mp4");
  const outputPath = join(directory, filename);
  await unlink(outputPath).catch(() => undefined);

  const runMerge = async (includeAudio: boolean): Promise<void> => {
    const args = ["-y", "-hide_banner", "-loglevel", "error"];
    for (const segment of validSegments) {
      args.push("-fflags", "+genpts", "-i", segment.path);
    }
    const filters = validSegments.map((_segment, index) =>
      `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},setsar=1,setpts=PTS-STARTPTS[v${index}]`
    );
    if (includeAudio) {
      const audioFilters = validSegments.map((_segment, index) => `[${index}:a]aresample=48000,asetpts=PTS-STARTPTS[a${index}]`);
      const concatInputs = validSegments.map((_segment, index) => `[v${index}][a${index}]`).join("");
      args.push(
        "-filter_complex",
        `${filters.join(";")};${audioFilters.join(";")};${concatInputs}concat=n=${validSegments.length}:v=1:a=1[v][a]`,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-c:a",
        "aac",
        "-b:a",
        "96k"
      );
    } else {
      const concatInputs = validSegments.map((_segment, index) => `[v${index}]`).join("");
      args.push(
        "-filter_complex",
        `${filters.join(";")};${concatInputs}concat=n=${validSegments.length}:v=1:a=0[v]`,
        "-map",
        "[v]",
        "-an"
      );
    }
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-b:v",
      `${bitrateKbps}k`,
      "-maxrate",
      `${Math.round(bitrateKbps * 1.35)}k`,
      "-bufsize",
      `${Math.round(bitrateKbps * 2)}k`,
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputPath
    );

    await execFileAsync(ffmpegPath, args, {
      windowsHide: true,
      timeout: 300_000,
      maxBuffer: 1024 * 1024
    });
  };

  let mergedWithAudio = canMergeAudio;
  try {
    await runMerge(canMergeAudio);
  } catch (error) {
    if (!canMergeAudio) {
      throw error;
    }
    await unlink(outputPath).catch(() => undefined);
    mergedWithAudio = false;
    await runMerge(false);
  }
  const fileStats = await stat(outputPath);
  const durationMs = validSegments.reduce((total, segment) => total + Math.max(0, segment.durationMs || 0), 0);
  await markReplayVideoSeekable(outputPath);
  return {
    path: outputPath,
    url: pathToFileURL(outputPath).href,
    filename,
    directory,
    mimeType: "video/mp4",
    source: first.source,
    platform: options.platform,
    startedAt: first.startedAt,
    endedAt: validSegments.at(-1)?.endedAt || new Date().toISOString(),
    durationMs,
    sizeBytes: fileStats.size,
    width,
    height,
    fps,
    captureIntervalMs: Math.round(1000 / Math.max(1, fps)),
    bitrateKbps,
    actualBitrateKbps: actualReplayBitrateKbps(fileStats.size, durationMs),
    codec: "H.264 MP4",
    quality: options.quality,
    hasAudio: mergedWithAudio,
    containerFinalized: true
  };
}

function actualReplayBitrateKbps(sizeBytes: number, durationMs: number): number | undefined {
  if (!Number.isFinite(sizeBytes) || !Number.isFinite(durationMs) || sizeBytes <= 0 || durationMs <= 0) {
    return undefined;
  }
  return Math.max(1, Math.round((sizeBytes * 8) / durationMs));
}

function prepareReplayVideoDisplayTarget(
  requesterWebContentsId: number,
  platform: GamePlatform,
  mode: ReplayVideoCaptureMode
): void {
  if (
    !Number.isInteger(requesterWebContentsId) ||
    requesterWebContentsId <= 0 ||
    (platform !== "atlas" && platform !== "tcga" && !(isDev && platform === "sim")) ||
    (mode !== "game-frame" && mode !== "system-window")
  ) {
    throw new Error("Replay video display target is invalid.");
  }
  replayVideoDisplayTarget = {
    platform,
    mode,
    expiresAt: Date.now() + REPLAY_VIDEO_DISPLAY_TARGET_MS,
    requesterWebContentsId
  };
}

function configureDisplayMediaCapture(): void {
  electronSession.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const requestedPermission = String(permission);
    if (requestedPermission === "display-capture" || requestedPermission === "media") {
      return Boolean(
        webContents &&
        isTrustedAppWebContents(webContents) &&
        details.isMainFrame &&
        isTrustedAppOrigin(requestingOrigin || details.securityOrigin || "")
      );
    }
    return false;
  });
  electronSession.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === "display-capture" || permission === "media") {
      const requestingUrl = typeof details.requestingUrl === "string" ? details.requestingUrl : "";
      callback(
        isTrustedAppWebContents(webContents) &&
        details.isMainFrame &&
        isTrustedAppPageUrl(requestingUrl || webContents.getURL())
      );
      return;
    }
    callback(false);
  });
  electronSession.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const respond = createSingleUseDisplayMediaResponder(callback, (error) => {
      void logStartupIssue("replay video display-media response failed", error);
    });
    let streams: Electron.Streams | null = null;
    try {
      const knownAppContents = [mainWindow?.webContents, deckTrackerWindow?.webContents]
        .filter((candidate): candidate is WebContents => Boolean(candidate && !candidate.isDestroyed()));
      const resolvedContents = request.frame
        ? electronWebContents.fromFrame(request.frame)
        : undefined;
      const requestingContents = resolvedContents
        ? knownAppContents.find((candidate) => candidate.id === resolvedContents.id)
        : undefined;
      const trustedRequest = displayMediaRequestIsTrusted({
        requesterWebContentsId: resolvedContents?.id ?? null,
        trustedAppWebContentsIds: knownAppContents.map((candidate) => candidate.id),
        requesterIsTrustedApp: Boolean(requestingContents && isTrustedAppWebContents(requestingContents)),
        requesterIsMainFrame: Boolean(
          requestingContents && sameWebFrameIdentity(request.frame, requestingContents.mainFrame)
        ),
        originIsTrusted: isTrustedAppOrigin(request.securityOrigin),
        videoRequested: request.videoRequested,
        audioRequested: request.audioRequested
      });

      if (trustedRequest && requestingContents) {
        const pendingTarget = replayVideoDisplayTarget;
        replayVideoDisplayTarget = null;
        const target = preparedDisplayMediaTargetForRequester(
          pendingTarget,
          requestingContents.id
        );

        if (target?.mode === "game-frame") {
          const contents = gameWebContentsByPlatform.get(target.platform);
          if (contents && !contents.isDestroyed() && platformFromUrl(contents.getURL()) === target.platform) {
            streams = { video: contents.mainFrame };
          }
        } else if (target?.mode === "system-window") {
          const source = await replayWindowCaptureSource();
          if (source) {
            streams = { video: { id: source.id, name: source.name } };
          }
        }
      }
    } catch (error) {
      void logStartupIssue("replay video display-media resolution failed", error);
    }
    respond(streams);
  }, { useSystemPicker: false });
}

async function attachReplayVideo(matchId: string, video: ReplayVideoAsset): Promise<ReplayRecord | null> {
  const result = await attachReplayVideoToStore(store, matchId, video);
  if (!result.replay) {
    void diagnostics?.record({
      id: randomUUID(),
      platform: video.platform,
      kind: "debug",
      capturedAt: new Date().toISOString(),
      url: "",
      payload: {
        reason: "replay-video-attach-replay-timeout",
        matchId
      }
    }).catch(() => undefined);
    return null;
  }
  if (!result.attached) {
    await discardReplayVideoAsset(video).catch(() => undefined);
    return result.replay;
  }
  return rawCaptureService.finishForReplay(result.replay);
}

function pathInside(childPath: string, rootPath: string): boolean {
  const resolvedChild = resolve(childPath);
  const resolvedRoot = resolve(rootPath);
  const pathBetween = relative(resolvedRoot, resolvedChild);
  return pathBetween === "" || (!!pathBetween && !pathBetween.startsWith("..") && !isAbsolute(pathBetween));
}

async function replayVideoPathAllowed(filePath: string): Promise<boolean> {
  const target = filePath.trim();
  if (!target) {
    return false;
  }
  const settings = await store.getSettings();
  const roots = [
    replayVideoDirectory(settings),
    replayVideoImportDirectory(settings),
    replayVideoDirectory(),
    replayVideoImportDirectory(),
    legacyReplayVideoDirectory()
  ];
  return roots.some((root) => pathInside(target, root));
}

async function assertReplayVideoPathAllowed(filePath: string): Promise<void> {
  if (!await replayVideoPathAllowed(filePath)) {
    throw new Error("Replay video path is outside RiftLite replay storage.");
  }
}

async function discardReplayVideoAsset(video: ReplayVideoAsset): Promise<void> {
  const filePath = video.path?.trim();
  if (!filePath) {
    return;
  }
  if (!await replayVideoPathAllowed(filePath)) {
    return;
  }
  await unlink(resolve(filePath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
  await unlink(replayVideoSeekableMarkerPath(resolve(filePath))).catch(() => undefined);
}

async function deleteReplayVideoByMatch(matchId: string): Promise<void> {
  const replays = [
    ...await store.getReplays(),
    ...await store.getDeletedReplays()
  ].filter((replay) => replay.matchId === matchId);
  for (const replay of replays) {
    let removedVideo: ReplayVideoAsset | undefined;
    const updated = await store.updateReplay(replay.id, (current) => {
      removedVideo = current.video;
      const nextReplay = { ...current, video: undefined };
      delete nextReplay.video;
      return nextReplay;
    });
    if (updated && removedVideo) {
      await discardReplayVideoAsset(removedVideo).catch(() => undefined);
    }
  }
}

async function saveReplayVideoKeyframe(options: ReplayVideoKeyframeOptions): Promise<ReplayScreenshotFrame> {
  const comma = options.dataUrl.indexOf(",");
  if (!options.dataUrl.startsWith("data:image/") || comma < 0) {
    throw new Error("Replay keyframe data is not a supported image.");
  }
  if (Buffer.byteLength(options.dataUrl, "utf8") > MAX_REPLAY_KEYFRAME_DATA_URL_BYTES) {
    throw new Error("Replay keyframe image is too large.");
  }
  const header = options.dataUrl.slice(0, comma);
  const extension = header.includes("image/png") ? "png" : "jpg";
  const directory = replayFrameDirectory(options.replayId, await store.getSettings());
  await mkdir(directory, { recursive: true });
  const filename = screenshotFilename(options.label || "video-keyframe", extension);
  const filePath = join(directory, filename);
  await writeFile(filePath, Buffer.from(options.dataUrl.slice(comma + 1), "base64"));
  return {
    path: filePath,
    url: pathToFileURL(filePath).href,
    label: options.label || "Video keyframe",
    capturedAt: options.capturedAt,
    source: "replay-keyframe"
  };
}

async function loadReplayVideo(video: ReplayVideoAsset): Promise<ArrayBuffer> {
  const filePath = video.path?.trim();
  if (!filePath) {
    throw new Error("Replay video path is missing.");
  }
  await assertReplayVideoPathAllowed(filePath);
  if (!video.containerFinalized) {
    await makeReplayVideoSeekable(filePath, video.mimeType).catch(() => false);
  }
  const bytes = await readFile(filePath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

function replaySearchMetadata(replay: ReplayRecord, match?: MatchDraft): ReplaySearchMetadata {
  const structured = replay.structuredEvents ?? [];
  const games = match?.games ?? [];
  const battlefieldsFromEvents = structured.flatMap((event) => [
    event.battlefield,
    ...(event.battlefields ?? []).map((battlefield) => battlefield.name)
  ]);
  return {
    title: replay.title || `${match?.myChampion || "Unknown"} vs ${match?.opponentChampion || "Unknown"}`,
    platform: replay.platform,
    players: uniqueStrings([replay.players.me, replay.players.opponent, match?.myName, match?.opponentName]),
    legends: uniqueStrings([match?.myChampion, match?.opponentChampion]),
    battlefields: uniqueStrings([
      match?.myBattlefield,
      match?.opponentBattlefield,
      ...games.flatMap((game) => [game.myBattlefield, game.oppBattlefield]),
      ...battlefieldsFromEvents
    ]),
    format: match?.format ?? "",
    result: match?.result ?? "",
    score: match?.score ?? "",
    capturedAt: replay.capturedAt,
    deckName: match?.deckName ?? ""
  };
}

function screenshotMimeType(filePath: string, sourceUrl = ""): ReplayBundleFrame["mimeType"] {
  const lower = `${filePath || sourceUrl}`.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".webp")) return "image/webp";
  return "image/jpeg";
}

function extensionForFrame(frame: ReplayBundleFrame): string {
  if (frame.mimeType === "image/png") return "png";
  if (frame.mimeType === "image/webp") return "webp";
  return "jpg";
}

function replayBundleFrameTargetId(frame: Pick<ReplayBundleFrame, "sourcePath" | "sourceUrl" | "capturedAt" | "label">): string {
  return `${frame.sourcePath || frame.sourceUrl}|${frame.capturedAt}|${frame.label}`;
}

function importedReplayFrameTargetId(frame: ReplayScreenshotFrame): string {
  return `${frame.path || frame.url}|${frame.capturedAt}|${frame.label}`;
}

async function replayFrames(replay: ReplayRecord): Promise<ReplayBundleFrame[]> {
  const frames: ReplayBundleFrame[] = [];
  const seen = new Set<string>();
  for (const frame of replay.visualFrames ?? []) {
    if (frames.length >= MAX_REPLAY_EXPORT_FRAMES) {
      break;
    }
    if (!withinReplayTrim(replay, frame.capturedAt)) {
      continue;
    }
    const sourcePath = frame.path?.trim() ?? "";
    const sourceUrl = frame.url?.trim() ?? "";
    const key = sourcePath || sourceUrl;
    if (!key || seen.has(key) || !sourcePath) {
      continue;
    }
    seen.add(key);
    try {
      const frameStats = await stat(sourcePath);
      if (frameStats.size > MAX_REPLAY_EXPORT_FRAME_BYTES) {
        continue;
      }
      const bytes = await readFile(sourcePath);
      frames.push({
        id: `visual:${frames.length + 1}`,
        eventId: `visual:${frames.length + 1}`,
        label: frame.label || "Replay frame",
        capturedAt: frame.capturedAt,
        sourcePath,
        sourceUrl,
        mimeType: screenshotMimeType(sourcePath, sourceUrl),
        data: bytes.toString("base64")
      });
    } catch {
      continue;
    }
  }
  const structured = replay.structuredEvents ?? [];
  for (const event of structured) {
    if (frames.length >= MAX_REPLAY_EXPORT_FRAMES) {
      break;
    }
    if (!withinReplayTrim(replay, event.capturedAt)) {
      continue;
    }
    const screenshot = event.screenshot;
    const sourcePath = screenshot?.path?.trim() ?? "";
    const sourceUrl = screenshot?.url?.trim() ?? "";
    const key = sourcePath || sourceUrl;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (!sourcePath) {
      continue;
    }
    try {
      const frameStats = await stat(sourcePath);
      if (frameStats.size > MAX_REPLAY_EXPORT_FRAME_BYTES) {
        continue;
      }
      const bytes = await readFile(sourcePath);
      frames.push({
        id: `${event.id}:${frames.length + 1}`,
        eventId: event.id,
        label: screenshot?.label || event.text || "Replay keyframe",
        capturedAt: screenshot?.capturedAt || event.capturedAt,
        sourcePath,
        sourceUrl,
        mimeType: screenshotMimeType(sourcePath, sourceUrl),
        data: bytes.toString("base64")
      });
    } catch {
      continue;
    }
  }
  return frames;
}

type ReplayVideoBundleSource = Omit<ReplayBundleVideo, "data">;

async function replayVideoExportSource(replay: ReplayRecord): Promise<ReplayVideoBundleSource | undefined> {
  const video = replay.video;
  const sourcePath = video?.path?.trim() ?? "";
  if (!video || !sourcePath) {
    return undefined;
  }
  try {
    await assertReplayVideoPathAllowed(sourcePath);
    if (!video.containerFinalized) {
      await makeReplayVideoSeekable(sourcePath, video.mimeType).catch(() => false);
    }
    const videoStats = await stat(sourcePath);
    if (videoStats.size > MAX_REPLAY_EXPORT_VIDEO_BYTES) {
      throw new Error(`Replay video is too large to export safely (${formatByteSize(videoStats.size)}). Trim it before exporting.`);
    }
    return {
      sourcePath,
      sourceUrl: video.url,
      mimeType: video.mimeType,
      asset: {
        ...video,
        sizeBytes: videoStats.size,
        containerFinalized: video.containerFinalized || await pathExists(replayVideoSeekableMarkerPath(sourcePath))
      }
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("too large")) {
      throw error;
    }
    return undefined;
  }
}

async function writeReplayVideoBundleJson(stream: ReturnType<typeof createWriteStream>, video: ReplayVideoBundleSource): Promise<void> {
  await writeStreamText(stream, "{\"sourcePath\":");
  await writeStreamText(stream, JSON.stringify(video.sourcePath));
  await writeStreamText(stream, ",\"sourceUrl\":");
  await writeStreamText(stream, JSON.stringify(video.sourceUrl ?? ""));
  await writeStreamText(stream, ",\"mimeType\":");
  await writeStreamText(stream, JSON.stringify(video.mimeType));
  await writeStreamText(stream, ",\"data\":");
  await writeFileAsBase64JsonString(stream, video.sourcePath, MAX_REPLAY_EXPORT_VIDEO_BYTES);
  await writeStreamText(stream, ",\"asset\":");
  await writeStreamText(stream, JSON.stringify(video.asset));
  await writeStreamText(stream, "}");
}

async function writeReplayBundleFile(filePath: string, bundle: Omit<RiftReplayBundle, "video">, video?: ReplayVideoBundleSource): Promise<void> {
  if (!video) {
    await writeFile(filePath, JSON.stringify(bundle), "utf8");
    return;
  }

  const stream = createWriteStream(filePath, { encoding: "utf8" });
  try {
    const manifest: RiftReplayBundle = {
      ...bundle,
      video: {
        ...video,
        data: ""
      }
    };
    await writeStreamText(stream, `${REPLAY_STREAM_MAGIC}\n`);
    await writeStreamText(stream, `${JSON.stringify(manifest)}\n`);
    await writeStreamText(stream, `${REPLAY_STREAM_VIDEO_START}\n`);
    await writeFileAsBase64Lines(stream, video.sourcePath, MAX_REPLAY_EXPORT_VIDEO_BYTES);
    await writeStreamText(stream, `${REPLAY_STREAM_VIDEO_END}\n`);
    await finishWriteStream(stream);
  } catch (error) {
    stream.destroy();
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
}

function replayForExport(replay: ReplayRecord): ReplayRecord {
  if (!replay.trim) {
    return sanitizeReplayForBundle(replay);
  }
  return sanitizeReplayForBundle({
    ...replay,
    events: replay.events.filter((event) => withinReplayTrim(replay, event.capturedAt)),
    structuredEvents: replay.structuredEvents?.filter((event) => withinReplayTrim(replay, event.capturedAt)),
    visualFrames: replay.visualFrames?.filter((frame) => withinReplayTrim(replay, frame.capturedAt)),
    deckTrackerSnapshots: replay.deckTrackerSnapshots?.filter((snapshot) => withinReplayTrim(replay, snapshot.capturedAt)),
    flags: replay.flags?.filter((flag) => flag.targetType === "replay" || withinReplayTrim(replay, flag.capturedAt)),
    annotations: replay.annotations?.filter((annotation) => withinReplayTrim(replay, annotation.capturedAt)),
    voiceNotes: replay.voiceNotes?.filter((note) =>
      replay.flags?.some((flag) => flag.id === note.flagId && (flag.targetType === "replay" || withinReplayTrim(replay, flag.capturedAt)))
    )
  });
}

function sanitizeReplayForBundle(replay: ReplayRecord): ReplayRecord {
  const rawCapture = replay.rawCapture
    ? { ...replay.rawCapture, localPath: undefined }
    : undefined;
  if (!replay.video) {
    return rawCapture ? { ...replay, rawCapture } : replay;
  }
  const video: Record<string, unknown> = { ...replay.video };
  delete video.data;
  delete video.asset;
  delete video.sourcePath;
  delete video.sourceUrl;
  return { ...replay, rawCapture, video: video as unknown as ReplayVideoAsset };
}

function withinReplayTrim(replay: ReplayRecord, capturedAt: string): boolean {
  const trim = replay.trim;
  if (!trim) {
    return true;
  }
  const time = new Date(capturedAt).getTime();
  const start = new Date(trim.startCapturedAt).getTime();
  const end = new Date(trim.endCapturedAt).getTime();
  if (!Number.isFinite(time) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return true;
  }
  return time >= Math.min(start, end) && time <= Math.max(start, end);
}

async function exportReplayBundle(replayId: string): Promise<string> {
  const [replays, matches, settings] = await Promise.all([store.getReplays(), store.getMatches(), store.getSettings()]);
  const storedReplay = replays.find((item) => item.id === replayId);
  if (!storedReplay) {
    throw new Error("Replay not found.");
  }
  const replay = replayForExport(storedReplay);
  const match = matches.find((item) => item.id === replay.matchId) ?? replay.matchSnapshot;
  const search = replaySearchMetadata(replay, match);
  const coachingPack = replay.coachingPack ?? defaultReplayCoachingPack(replay, match, settings);
  const video = await replayVideoExportSource(replay);
  const bundle: Omit<RiftReplayBundle, "video"> = {
    format: "riftlite.replay",
    version: 4,
    exportedAt: new Date().toISOString(),
    replay: {
      ...replay,
      schemaVersion: 4,
      coachingPack,
      matchSnapshot: match,
      search
    },
    match,
    search,
    frames: await replayFrames(replay),
    coachingPack
  };
  const directory = replayBundleDirectory(settings);
  await mkdir(directory, { recursive: true });
  const defaultPath = join(
    directory,
    `${safeFileComponent(`${search.title} ${search.players.join(" vs ")} ${search.capturedAt.slice(0, 10)}`, "RiftLite Replay")}.riftreplay`
  );
  const options: SaveDialogOptions = {
    title: "Export RiftLite replay",
    defaultPath,
    filters: [{ name: "RiftLite Replay", extensions: ["riftreplay"] }]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return "";
  }
  const filePath = result.filePath.endsWith(".riftreplay") ? result.filePath : `${result.filePath}.riftreplay`;
  await writeReplayBundleFile(filePath, bundle, video);
  return filePath;
}

function replayFlagExportTimestamp(flag: ReplayFlag): string {
  if (typeof flag.timeMs === "number" && Number.isFinite(flag.timeMs)) {
    const totalSeconds = Math.max(0, Math.round(flag.timeMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }
  if (flag.targetType === "replay") {
    return "Replay";
  }
  const captured = new Date(flag.capturedAt);
  return Number.isFinite(captured.getTime()) ? captured.toLocaleTimeString() : "Unknown time";
}

function replayFlagExportSortValue(flag: ReplayFlag): number {
  if (typeof flag.timeMs === "number" && Number.isFinite(flag.timeMs)) {
    return flag.timeMs;
  }
  const captured = new Date(flag.capturedAt).getTime();
  return Number.isFinite(captured) ? captured : Number.MAX_SAFE_INTEGER;
}

async function exportReplayFlagsText(replayId: string): Promise<string> {
  const [replays, matches, settings] = await Promise.all([store.getReplays(), store.getMatches(), store.getSettings()]);
  const replay = replays.find((item) => item.id === replayId);
  if (!replay) {
    throw new Error("Replay not found.");
  }
  const match = matches.find((item) => item.id === replay.matchId) ?? replay.matchSnapshot;
  const search = replaySearchMetadata(replay, match);
  const flags = [...(replay.flags ?? [])].sort((a, b) => replayFlagExportSortValue(a) - replayFlagExportSortValue(b));
  const lines = [
    `RiftLite replay flags - ${search.title}`,
    `${search.players.join(" vs ")} - ${new Date(search.capturedAt).toLocaleString()}`,
    "",
    flags.length ? "Timestamp - Type - Note" : "No replay flags saved.",
    ...flags.map((flag) => {
      const note = flag.note?.trim() || flag.targetLabel || "";
      return `${replayFlagExportTimestamp(flag)} - ${replayMp4ExportLabel(flag)}${note ? ` - ${note}` : ""}`;
    })
  ];
  const directory = replayBundleDirectory(settings);
  await mkdir(directory, { recursive: true });
  const defaultPath = join(
    directory,
    `${safeFileComponent(`${search.title} ${search.players.join(" vs ")} flags ${search.capturedAt.slice(0, 10)}`, "RiftLite Replay Flags")}.txt`
  );
  const options: SaveDialogOptions = {
    title: "Export replay flags",
    defaultPath,
    filters: [{ name: "Text file", extensions: ["txt"] }]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return "";
  }
  const filePath = result.filePath.toLowerCase().endsWith(".txt") ? result.filePath : `${result.filePath}.txt`;
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

type ReplayMp4OverlayInput = {
  path: string;
  startSec: number;
  endSec: number;
  x?: number;
  y?: number;
  opacity?: number;
  transformWithVideo?: boolean;
};

type ReplayMp4VoiceInput = {
  path: string;
  delayMs: number;
};

type ReplayMp4ClipRange = {
  startMs: number;
  endMs: number;
  durationMs: number;
};

type ReplayMp4RenderGeometry = {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  layout: NonNullable<ReplayMp4ExportOptions["layout"]>;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

function clampReplayMp4Unit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function replayMp4Even(value: number, minValue = 2): number {
  const rounded = Math.max(minValue, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function replayMp4RenderGeometry(video: ReplayVideoAsset, options: ReplayMp4ExportOptions): ReplayMp4RenderGeometry {
  const sourceWidth = replayMp4Even(Math.max(640, video.width || 1920), 640);
  const sourceHeight = replayMp4Even(Math.max(360, video.height || 1080), 360);
  const layout = options.layout ?? "landscape";
  if (layout === "landscape") {
    return {
      sourceWidth,
      sourceHeight,
      outputWidth: sourceWidth,
      outputHeight: sourceHeight,
      layout
    };
  }

  const targetAspect = 9 / 16;
  const sourceAspect = sourceWidth / sourceHeight;
  const baseCropHeight = sourceAspect > targetAspect ? sourceHeight : sourceWidth / targetAspect;
  const baseCropWidth = sourceAspect > targetAspect ? sourceHeight * targetAspect : sourceWidth;
  const zoom = layout === "vertical-custom"
    ? Math.min(2.5, Math.max(1, options.cropZoom ?? 1))
    : 1;
  const cropWidth = replayMp4Even(Math.min(sourceWidth, baseCropWidth / zoom), 64);
  const cropHeight = replayMp4Even(Math.min(sourceHeight, cropWidth / targetAspect), 114);
  const focusX = layout === "vertical-custom" ? clampReplayMp4Unit(options.cropFocusX, 0.5) : 0.5;
  const focusY = layout === "vertical-custom" ? clampReplayMp4Unit(options.cropFocusY, 0.5) : 0.5;
  const maxX = Math.max(0, sourceWidth - cropWidth);
  const maxY = Math.max(0, sourceHeight - cropHeight);
  return {
    sourceWidth,
    sourceHeight,
    outputWidth: 1080,
    outputHeight: 1920,
    layout,
    crop: {
      x: replayMp4Even(maxX * focusX, 0),
      y: replayMp4Even(maxY * focusY, 0),
      width: cropWidth,
      height: cropHeight
    }
  };
}

async function replayMp4ProbeVideoGeometry(
  ffmpegPath: string,
  filePath: string,
  fallback: ReplayVideoAsset
): Promise<Pick<ReplayVideoAsset, "width" | "height">> {
  try {
    await execFileAsync(ffmpegPath, ["-hide_banner", "-i", filePath], {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    const output = error && typeof error === "object"
      ? `${String((error as { stdout?: unknown }).stdout ?? "")}\n${String((error as { stderr?: unknown }).stderr ?? "")}`
      : String(error ?? "");
    const match = output.match(/Video:\s.*?([1-9]\d{2,5})x([1-9]\d{2,5})/i);
    if (match) {
      const width = Number.parseInt(match[1] ?? "", 10);
      const height = Number.parseInt(match[2] ?? "", 10);
      if (Number.isFinite(width) && Number.isFinite(height) && width >= 320 && height >= 180) {
        return { width, height };
      }
    }
  }
  return { width: fallback.width, height: fallback.height };
}

function replayMp4GeometryFilterBody(geometry: ReplayMp4RenderGeometry): string {
  if (geometry.crop) {
    const crop = geometry.crop;
    return `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${geometry.outputWidth}:${geometry.outputHeight}`;
  }
  return `scale=${geometry.outputWidth}:${geometry.outputHeight}:force_original_aspect_ratio=decrease,pad=${geometry.outputWidth}:${geometry.outputHeight}:(ow-iw)/2:(oh-ih)/2`;
}

function replayMp4ExportLabel(flag: Pick<ReplayFlag, "type" | "customType" | "label">): string {
  if (flag.type === "custom") {
    return flag.customType?.trim() || flag.label || "Custom";
  }
  const labels: Record<NonNullable<ReplayFlag["type"]>, string> = {
    "key-turn": "Key turn",
    "mistake": "Mistake",
    "good-line": "Good line",
    "missed-lethal": "Missed lethal",
    "battlefield-decision": "Battlefield decision",
    "rules-check": "Rules check",
    custom: "Custom"
  };
  return flag.type ? labels[flag.type] : flag.label || "Key turn";
}

function replayMp4TimeFromCapturedAt(video: ReplayVideoAsset, capturedAt: string | undefined): number | undefined {
  if (!capturedAt) {
    return undefined;
  }
  const startedAt = new Date(video.startedAt).getTime();
  const captured = new Date(capturedAt).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(captured)) {
    return undefined;
  }
  return Math.max(0, captured - startedAt);
}

function clampReplayMp4TimeMs(video: ReplayVideoAsset, timeMs: number | undefined): number {
  const duration = Math.max(1, video.durationMs || 1);
  if (typeof timeMs !== "number" || !Number.isFinite(timeMs)) {
    return 0;
  }
  return Math.min(duration, Math.max(0, timeMs));
}

function sanitizeSvgTextValue(value: string): string {
  let output = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (typeof codePoint === "number" && codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (typeof codePoint === "number" && codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (typeof codePoint === "number" && codePoint >= 0x10000 && codePoint <= 0x10ffff)
    ) {
      output += character;
    }
  }
  return output;
}

function escapeSvgText(value: string): string {
  return sanitizeSvgTextValue(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function replayMp4SvgColor(value: string | undefined, fallback = "#6feeff"): string {
  const safe = sanitizeSvgTextValue(value ?? "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(safe)) {
    return safe;
  }
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(safe)) {
    return safe;
  }
  if (/^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(safe)) {
    return safe;
  }
  return fallback;
}

function replayMp4SvgPoint(value: number, size: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(Math.min(1, Math.max(0, value)) * size);
}

function wrapReplayMp4Text(value: string, maxLength: number, maxLines: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= maxLines) {
      break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\.+$/, "")}...`;
  }
  return lines.length ? lines : [""];
}

function replayMp4ClipRange(video: ReplayVideoAsset, options: ReplayMp4ExportOptions): ReplayMp4ClipRange | null {
  if (options.mode !== "clip") {
    return null;
  }
  const requestedDurationMs = Math.min(
    5 * 60_000,
    Math.max(1_000, Math.round(Number.isFinite(options.clipDurationMs) ? options.clipDurationMs ?? 15_000 : 15_000))
  );
  const videoDurationMs = Math.max(1_000, Math.round(video.durationMs || 1_000));
  const rawStartMs = Number.isFinite(options.clipStartMs) ? Math.round(options.clipStartMs ?? 0) : 0;
  const startMs = Math.min(Math.max(0, rawStartMs), Math.max(0, videoDurationMs - 1_000));
  const durationMs = Math.max(1_000, Math.min(requestedDurationMs, videoDurationMs - startMs));
  return {
    startMs,
    endMs: startMs + durationMs,
    durationMs
  };
}

function replayMp4ClipTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}m${seconds.toString().padStart(2, "0")}s`;
}

function replayMp4OverlayTiming(startMs: number, endMs: number, clipRange: ReplayMp4ClipRange | null): { startSec: number; endSec: number } | null {
  if (!clipRange) {
    return {
      startSec: startMs / 1000,
      endSec: Math.max(endMs, startMs + 1_000) / 1000
    };
  }
  const clippedStartMs = Math.max(startMs, clipRange.startMs);
  const clippedEndMs = Math.min(Math.max(endMs, startMs + 1_000), clipRange.endMs);
  if (clippedEndMs <= clippedStartMs) {
    return null;
  }
  return {
    startSec: (clippedStartMs - clipRange.startMs) / 1000,
    endSec: Math.max(clippedEndMs - clipRange.startMs, clippedStartMs - clipRange.startMs + 1_000) / 1000
  };
}

function replayMp4FlagSvg(flag: ReplayFlag, width: number, height: number): string {
  const title = replayMp4ExportLabel(flag);
  const note = flag.note?.trim() || flag.targetLabel || "";
  const lines = wrapReplayMp4Text(note, 54, 2);
  const boxWidth = Math.min(width - 64, 760);
  const boxHeight = note ? 118 : 76;
  const x = 32;
  const y = 32;
  const accent = flag.type === "mistake" ? "#ff5b7d" : flag.type === "good-line" ? "#4df5a8" : "#6feeff";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="18" fill="#07101d" opacity="0.86"/>
  <rect x="${x}" y="${y}" width="7" height="${boxHeight}" rx="3.5" fill="${accent}"/>
  <text x="${x + 28}" y="${y + 42}" fill="${accent}" font-family="Arial, sans-serif" font-size="26" font-weight="800">${escapeSvgText(title)}</text>
  ${note ? lines.map((line, index) => `<text x="${x + 28}" y="${y + 78 + index * 28}" fill="#f5fbff" font-family="Arial, sans-serif" font-size="22" font-weight="700">${escapeSvgText(line)}</text>`).join("") : ""}
</svg>`;
}

function replayMp4AnnotationSvg(annotation: ReplayAnnotation, width: number, height: number): string {
  const points = (annotation.points ?? [])
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: replayMp4SvgPoint(point.x, width),
      y: replayMp4SvgPoint(point.y, height)
    }));
  const annotationWidth = Number.isFinite(annotation.width) ? annotation.width : 2;
  const strokeWidth = Math.max(4, Math.round(annotationWidth * 3 * (Math.min(width, height) / 1000)));
  const first = points[0];
  const last = points.at(-1);
  const color = replayMp4SvgColor(annotation.color);
  const commonDefs = `<defs><marker id="arrowhead" markerWidth="18" markerHeight="18" refX="15" refY="6" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,12 L17,6 z" fill="${color}"/></marker></defs>`;
  let body = "";
  if (annotation.tool === "text" && first) {
    const text = escapeSvgText(annotation.text?.trim() || annotation.note?.trim() || "");
    body = `<text x="${first.x}" y="${first.y}" fill="${color}" font-family="Arial, sans-serif" font-size="${Math.max(34, Math.round(height * 0.046))}" font-weight="900" paint-order="stroke" stroke="#020712" stroke-width="10">${text}</text>`;
  } else if (annotation.tool === "arrow" && first && last) {
    body = `<line x1="${first.x}" y1="${first.y}" x2="${last.x}" y2="${last.y}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" marker-end="url(#arrowhead)"/>`;
  } else if (points.length) {
    const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
    const opacity = annotation.tool === "highlight" ? "0.48" : "0.94";
    body = `<polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${commonDefs}
  ${body}
</svg>`;
}

async function writeReplayMp4WatermarkPng(tempDirectory: string, width: number, height: number): Promise<{ path: string; x: number; y: number }> {
  const logoPath = safeAssetPath("riftlite-logo-transparent.png");
  const logoBuffer = await readFile(logoPath);
  const image = nativeImage.createFromBuffer(logoBuffer);
  const size = image.getSize();
  const ratio = size.width > 0 && size.height > 0 ? size.height / size.width : 1;
  const logoWidth = Math.round(Math.min(Math.max(width * 0.11, 92), 180));
  const logoHeight = Math.round(logoWidth * ratio);
  const margin = Math.round(Math.max(20, width * 0.018));
  const x = Math.max(margin, width - logoWidth - margin);
  const y = Math.max(margin, height - logoHeight - margin);
  const resized = image.resize({ width: logoWidth, height: logoHeight, quality: "best" });
  if (resized.isEmpty()) {
    throw new Error("Could not render RiftLite watermark.");
  }
  const filePath = join(tempDirectory, `riftlite-watermark-${randomUUID()}.png`);
  await writeFile(filePath, resized.toPNG());
  return { path: filePath, x, y };
}

async function writeReplayMp4OverlayPng(tempDirectory: string, label: string, svg: string): Promise<string> {
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`);
  if (image.isEmpty()) {
    throw new Error(`Could not render replay export overlay (${safeFileComponent(label, "overlay")}).`);
  }
  const filePath = join(tempDirectory, `${safeFileComponent(label, "overlay")}-${randomUUID()}.png`);
  await writeFile(filePath, image.toPNG());
  return filePath;
}

function replayMp4AnnotationTimeMs(
  annotation: ReplayAnnotation,
  video: ReplayVideoAsset,
  flagsById: Map<string, ReplayFlag>,
  voiceNotesById: Map<string, ReplayVoiceNote>
): { startMs: number; endMs: number } | null {
  if (annotation.clipId) {
    const voiceNote = voiceNotesById.get(annotation.clipId);
    const flag = voiceNote ? flagsById.get(voiceNote.flagId) : undefined;
    const baseMs = clampReplayMp4TimeMs(video, flag?.timeMs ?? replayMp4TimeFromCapturedAt(video, flag?.capturedAt) ?? annotation.timeMs ?? replayMp4TimeFromCapturedAt(video, annotation.capturedAt));
    const offsetMs = Math.max(0, annotation.offsetMs ?? 0);
    const startMs = clampReplayMp4TimeMs(video, baseMs + offsetMs);
    const endMs = clampReplayMp4TimeMs(video, Math.max(startMs + 1500, baseMs + Math.max(voiceNote?.durationMs ?? 0, offsetMs + 2500)));
    return { startMs, endMs };
  }
  const startMs = clampReplayMp4TimeMs(video, annotation.timeMs ?? replayMp4TimeFromCapturedAt(video, annotation.capturedAt));
  const endMs = clampReplayMp4TimeMs(video, startMs + (annotation.tool === "text" ? 5000 : 3500));
  return { startMs, endMs };
}

async function replayMp4OverlayInputs(
  replay: ReplayRecord,
  video: ReplayVideoAsset,
  options: ReplayMp4ExportOptions,
  tempDirectory: string,
  clipRange: ReplayMp4ClipRange | null,
  geometry: ReplayMp4RenderGeometry
): Promise<ReplayMp4OverlayInput[]> {
  const overlays: ReplayMp4OverlayInput[] = [];
  const width = geometry.sourceWidth;
  const height = geometry.sourceHeight;
  const flags = replay.flags ?? [];
  const flagsById = new Map(flags.map((flag) => [flag.id, flag]));
  const voiceNotesById = new Map((replay.voiceNotes ?? []).map((note) => [note.id, note]));
  const addOverlay = async (label: string, svg: string, startMs: number, endMs: number): Promise<void> => {
    const timing = replayMp4OverlayTiming(startMs, endMs, clipRange);
    if (!timing) {
      return;
    }
    let path: string;
    try {
      path = await writeReplayMp4OverlayPng(tempDirectory, label, svg);
    } catch (error) {
      console.warn(`[replay-mp4] Skipping replay export overlay ${label}`, error);
      return;
    }
    overlays.push({
      path,
      startSec: timing.startSec,
      endSec: timing.endSec
    });
  };

  if (options.includeFlags) {
    for (const flag of flags.filter((item) => typeof item.timeMs === "number").slice(0, 80)) {
      const startMs = clampReplayMp4TimeMs(video, (flag.timeMs ?? 0) - 250);
      const endMs = clampReplayMp4TimeMs(video, startMs + 4500);
      await addOverlay(`flag-${flag.id}`, replayMp4FlagSvg(flag, width, height), startMs, endMs);
    }
  }

  if (options.includeDrawings) {
    for (const annotation of (replay.annotations ?? []).slice(0, 120)) {
      const time = replayMp4AnnotationTimeMs(annotation, video, flagsById, voiceNotesById);
      if (!time) {
        continue;
      }
      await addOverlay(`drawing-${annotation.id}`, replayMp4AnnotationSvg(annotation, width, height), time.startMs, time.endMs);
    }
  }

  if (clipRange && options.watermark !== false) {
    const watermark = await writeReplayMp4WatermarkPng(tempDirectory, geometry.outputWidth, geometry.outputHeight);
    overlays.push({
      path: watermark.path,
      startSec: 0,
      endSec: clipRange.durationMs / 1000,
      x: watermark.x,
      y: watermark.y,
      opacity: 0.16,
      transformWithVideo: false
    });
  }

  return overlays;
}

function replayMp4VoiceNoteDelayMs(note: ReplayVoiceNote, flagsById: Map<string, ReplayFlag>, video: ReplayVideoAsset): number | undefined {
  const flag = flagsById.get(note.flagId);
  return clampReplayMp4TimeMs(video, flag?.timeMs ?? replayMp4TimeFromCapturedAt(video, flag?.capturedAt));
}

function replayVoiceNoteExtension(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes("mp4") || lower.includes("m4a")) return "m4a";
  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("wav")) return "wav";
  return "webm";
}

async function replayMp4VoiceInputs(
  replay: ReplayRecord,
  video: ReplayVideoAsset,
  options: ReplayMp4ExportOptions,
  tempDirectory: string,
  clipRange: ReplayMp4ClipRange | null
): Promise<ReplayMp4VoiceInput[]> {
  if (!options.includeVoiceNotes) {
    return [];
  }
  const flagsById = new Map((replay.flags ?? []).map((flag) => [flag.id, flag]));
  const result: ReplayMp4VoiceInput[] = [];
  for (const note of replay.voiceNotes ?? []) {
    const comma = note.dataUrl.indexOf(",");
    const delayMs = replayMp4VoiceNoteDelayMs(note, flagsById, video);
    if (comma < 0 || delayMs == null) {
      continue;
    }
    const adjustedDelayMs = clipRange ? delayMs - clipRange.startMs : delayMs;
    if (clipRange && (delayMs < clipRange.startMs || delayMs >= clipRange.endMs)) {
      continue;
    }
    const extension = replayVoiceNoteExtension(note.mimeType);
    const filePath = join(tempDirectory, `voice-${safeFileComponent(note.id, "note")}.${extension}`);
    await writeFile(filePath, Buffer.from(note.dataUrl.slice(comma + 1), "base64"));
    result.push({ path: filePath, delayMs: Math.max(0, adjustedDelayMs) });
  }
  return result;
}

function ffmpegSeconds(value: number): string {
  return Math.max(0, value).toFixed(3);
}

function replayMp4CanCopyVideoToMp4(video: ReplayVideoAsset, sourcePath: string): boolean {
  const codec = String(video.codec ?? "").toLowerCase();
  const mimeType = String(video.mimeType ?? "").toLowerCase();
  const filePath = sourcePath.toLowerCase();
  if (mimeType.includes("webm") || filePath.endsWith(".webm") || codec.includes("vp8") || codec.includes("vp9") || codec.includes("webm")) {
    return false;
  }
  return mimeType.includes("mp4") || filePath.endsWith(".mp4") || codec.includes("h.264") || codec.includes("h264") || codec.includes("avc1");
}

function replayMp4FfmpegError(error: unknown): Error {
  const details = error && typeof error === "object"
    ? [
        (error as { message?: unknown }).message,
        (error as { stderr?: unknown }).stderr,
        (error as { stdout?: unknown }).stdout
      ]
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    : [String(error ?? "")];
  const message = [...new Set(details)].join("\n").trim();
  return new Error(message ? `MP4 export failed:\n${message}` : "MP4 export failed while running ffmpeg.");
}

function appendReplayMp4AudioFilters(
  filterParts: string[],
  video: ReplayVideoAsset,
  voiceInputs: ReplayMp4VoiceInput[],
  firstVoiceInputIndex: number,
  options: ReplayMp4ExportOptions,
  clipRange: ReplayMp4ClipRange | null
): string | null {
  const audioLabels: string[] = [];
  if (options.includeOriginalAudio && video.hasAudio) {
    const baseAudioFilter = clipRange
      ? `[0:a]atrim=start=${ffmpegSeconds(clipRange.startMs / 1000)}:end=${ffmpegSeconds(clipRange.endMs / 1000)},asetpts=PTS-STARTPTS,aresample=48000[a_base]`
      : "[0:a]aresample=48000,asetpts=PTS-STARTPTS[a_base]";
    filterParts.push(baseAudioFilter);
    audioLabels.push("[a_base]");
  }
  voiceInputs.forEach((voice, index) => {
    const inputIndex = firstVoiceInputIndex + index;
    const label = `[a_note_${index}]`;
    const delay = Math.max(0, Math.round(voice.delayMs));
    filterParts.push(`[${inputIndex}:a]aresample=48000,adelay=${delay}|${delay},volume=1.0${label}`);
    audioLabels.push(label);
  });
  if (!audioLabels.length) {
    return null;
  }
  if (audioLabels.length === 1) {
    return audioLabels[0];
  }
  filterParts.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0[aout]`);
  return "[aout]";
}

async function exportReplayMp4(replayId: string, options: ReplayMp4ExportOptions): Promise<string> {
  const [replays, matches, settings] = await Promise.all([store.getReplays(), store.getMatches(), store.getSettings()]);
  const storedReplay = replays.find((item) => item.id === replayId);
  if (!storedReplay) {
    throw new Error("Replay not found.");
  }
  const replay = replayForExport(storedReplay);
  const match = matches.find((item) => item.id === replay.matchId) ?? replay.matchSnapshot;
  const search = replaySearchMetadata(replay, match);
  const source = await replayVideoExportSource(replay);
  if (!source) {
    throw new Error("MP4 export needs a video replay. Use the RiftLite coaching pack export for screenshot-only replays.");
  }
  const clipRange = replayMp4ClipRange(source.asset, options);
  const exportOptions: ReplayMp4ExportOptions = clipRange ? { ...options, mode: "clip", watermark: true } : { ...options, mode: "full" };
  const ffmpegPath = replayVideoFfmpegPath();
  if (!ffmpegPath || !(await pathExists(ffmpegPath))) {
    throw new Error("MP4 export needs ffmpeg.");
  }

  const directory = replayBundleDirectory(settings);
  await mkdir(directory, { recursive: true });
  const layoutFileSuffix = (exportOptions.layout ?? "landscape") === "landscape" ? "" : " vertical";
  const clipFileSuffix = clipRange
    ? ` clip ${replayMp4ClipTimestamp(clipRange.startMs)} ${Math.round(clipRange.durationMs / 1000)}s`
    : "";
  const defaultPath = join(
    directory,
    `${safeFileComponent(`${search.title} ${search.players.join(" vs ")} ${search.capturedAt.slice(0, 10)}${layoutFileSuffix}${clipFileSuffix}`, "RiftLite Replay")}.mp4`
  );
  const saveOptions: SaveDialogOptions = {
    title: clipRange ? `Export ${Math.round(clipRange.durationMs / 1000)}s replay clip` : "Export YouTube-ready MP4",
    defaultPath,
    filters: [{ name: "MP4 video", extensions: ["mp4"] }]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, saveOptions) : await dialog.showSaveDialog(saveOptions);
  if (result.canceled || !result.filePath) {
    return "";
  }
  const outputPath = result.filePath.toLowerCase().endsWith(".mp4") ? result.filePath : `${result.filePath}.mp4`;
  if (resolve(outputPath) === resolve(source.sourcePath)) {
    throw new Error("Choose a different file name for the MP4 export so the original replay video is kept safe.");
  }
  await unlink(outputPath).catch(() => undefined);

  const tempDirectory = join(app.getPath("temp"), `riftlite-mp4-export-${randomUUID()}`);
  await mkdir(tempDirectory, { recursive: true });
  const tempFiles: string[] = [];
  try {
    const probedVideoSize = await replayMp4ProbeVideoGeometry(ffmpegPath, source.sourcePath, source.asset);
    const renderVideo: ReplayVideoAsset = { ...source.asset, ...probedVideoSize };
    const geometry = replayMp4RenderGeometry(renderVideo, exportOptions);
    const overlayInputs = await replayMp4OverlayInputs(replay, renderVideo, exportOptions, tempDirectory, clipRange, geometry);
    const voiceInputs = await replayMp4VoiceInputs(replay, renderVideo, exportOptions, tempDirectory, clipRange);
    tempFiles.push(...overlayInputs.map((input) => input.path), ...voiceInputs.map((input) => input.path));

    const hasOverlay = overlayInputs.length > 0;
    const hasVoice = voiceInputs.length > 0;
    const fps = Math.max(1, source.asset.fps || 24);
    const videoDurationSec = Math.max(1, (clipRange?.durationMs ?? source.asset.durationMs ?? 1000) / 1000);
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-fflags", "+genpts", "-i", source.sourcePath];
    overlayInputs.forEach((overlay) => {
      args.push("-loop", "1", "-t", ffmpegSeconds(videoDurationSec + 1), "-i", overlay.path);
    });
    voiceInputs.forEach((voice) => {
      args.push("-i", voice.path);
    });

    const canCopyVideoToMp4 = replayMp4CanCopyVideoToMp4(source.asset, source.sourcePath);
    const needsVideoFilter = Boolean(clipRange) || geometry.layout !== "landscape" || hasOverlay || hasVoice || !canCopyVideoToMp4;
    if (!needsVideoFilter) {
      args.push("-map", "0:v:0");
      if (exportOptions.includeOriginalAudio) {
        args.push("-map", "0:a?", "-c:a", "aac", "-b:a", "128k");
      } else {
        args.push("-an");
      }
      args.push("-c:v", "copy", "-movflags", "+faststart", outputPath);
    } else {
      const sourceVideoFilter = clipRange
        ? `[0:v]trim=start=${ffmpegSeconds(clipRange.startMs / 1000)}:end=${ffmpegSeconds(clipRange.endMs / 1000)},setpts=PTS-STARTPTS,${replayMp4GeometryFilterBody(geometry)},fps=${fps},setsar=1[v0]`
        : `[0:v]${replayMp4GeometryFilterBody(geometry)},fps=${fps},setsar=1[v0]`;
      const filterParts: string[] = [
        sourceVideoFilter
      ];
      let currentVideoLabel = "[v0]";
      overlayInputs.forEach((overlay, index) => {
        const inputIndex = 1 + index;
        const overlayLabel = `[ov${index}]`;
        const nextLabel = `[v${index + 1}]`;
        const overlayPrep = overlay.transformWithVideo === false
          ? `[${inputIndex}:v]format=rgba${typeof overlay.opacity === "number" ? `,colorchannelmixer=aa=${Math.min(1, Math.max(0, overlay.opacity)).toFixed(3)}` : ""}${overlayLabel}`
          : `[${inputIndex}:v]${replayMp4GeometryFilterBody(geometry)},format=rgba${overlayLabel}`;
        filterParts.push(overlayPrep);
        filterParts.push(`${currentVideoLabel}${overlayLabel}overlay=${Math.round(overlay.x ?? 0)}:${Math.round(overlay.y ?? 0)}:shortest=1:enable='gte(t\\,${ffmpegSeconds(overlay.startSec)})*lte(t\\,${ffmpegSeconds(overlay.endSec)})'${nextLabel}`);
        currentVideoLabel = nextLabel;
      });
      const audioLabel = appendReplayMp4AudioFilters(filterParts, source.asset, voiceInputs, 1 + overlayInputs.length, exportOptions, clipRange);
      args.push("-filter_complex", filterParts.join(";"), "-map", currentVideoLabel);
      if (audioLabel) {
        args.push("-map", audioLabel, "-c:a", "aac", "-b:a", "128k");
      } else if (exportOptions.includeOriginalAudio && source.asset.hasAudio) {
        args.push("-map", "0:a?", "-c:a", "aac", "-b:a", "128k");
      } else {
        args.push("-an");
      }
      args.push(
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-t",
        ffmpegSeconds(videoDurationSec),
        outputPath
      );
    }

    try {
      await execFileAsync(ffmpegPath, args, {
        windowsHide: true,
        timeout: 900_000,
        maxBuffer: 1024 * 1024
      });
    } catch (error) {
      throw replayMp4FfmpegError(error);
    }
    const exportedStats = await stat(outputPath);
    if (exportedStats.size <= 0) {
      throw new Error("MP4 export did not create a video.");
    }
    return outputPath;
  } finally {
    for (const file of tempFiles) {
      await unlink(file).catch(() => undefined);
    }
  }
}

async function exportReplayPresentationMp4(replayId: string, payload: ReplayPresentationRecordingPayload): Promise<string> {
  if (!payload?.data || payload.data.byteLength <= 0) {
    throw new Error("No presentation recording was received.");
  }
  const ffmpegPath = replayVideoFfmpegPath();
  if (!ffmpegPath || !(await pathExists(ffmpegPath))) {
    throw new Error("Presentation export needs ffmpeg.");
  }
  const [replays, matches, settings] = await Promise.all([store.getReplays(), store.getMatches(), store.getSettings()]);
  const storedReplay = replays.find((item) => item.id === replayId);
  if (!storedReplay) {
    throw new Error("Replay not found.");
  }
  const replay = replayForExport(storedReplay);
  const match = matches.find((item) => item.id === replay.matchId) ?? replay.matchSnapshot;
  const search = replaySearchMetadata(replay, match);
  const directory = replayBundleDirectory(settings);
  await mkdir(directory, { recursive: true });
  const durationSuffix = payload.durationMs > 0 ? ` ${Math.round(payload.durationMs / 1000)}s` : "";
  const defaultPath = join(
    directory,
    `${safeFileComponent(`${search.title} ${search.players.join(" vs ")} presentation ${search.capturedAt.slice(0, 10)}${durationSuffix}`, "RiftLite Presentation")}.mp4`
  );
  const saveOptions: SaveDialogOptions = {
    title: "Export replay presentation MP4",
    defaultPath,
    filters: [{ name: "MP4 video", extensions: ["mp4"] }]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, saveOptions) : await dialog.showSaveDialog(saveOptions);
  if (result.canceled || !result.filePath) {
    return "";
  }
  const outputPath = result.filePath.toLowerCase().endsWith(".mp4") ? result.filePath : `${result.filePath}.mp4`;
  await unlink(outputPath).catch(() => undefined);

  const tempDirectory = join(app.getPath("temp"), `riftlite-presentation-export-${randomUUID()}`);
  await mkdir(tempDirectory, { recursive: true });
  const inputExtension = payload.mimeType.toLowerCase().includes("mp4") ? "mp4" : "webm";
  const inputPath = join(tempDirectory, `presentation.${inputExtension}`);
  await writeFile(inputPath, Buffer.from(new Uint8Array(payload.data)));
  try {
    const durationSec = Math.max(1, payload.durationMs / 1000 + 0.5);
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-fflags",
      "+genpts",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1",
      "-c:v",
      "libx264",
      "-preset",
      "superfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-t",
      ffmpegSeconds(durationSec),
      "-shortest",
      outputPath
    ];
    try {
      await execFileAsync(ffmpegPath, args, {
        windowsHide: true,
        timeout: 900_000,
        maxBuffer: 1024 * 1024
      });
    } catch (error) {
      throw replayMp4FfmpegError(error);
    }
    const exportedStats = await stat(outputPath);
    if (exportedStats.size <= 0) {
      throw new Error("Presentation export did not create a video.");
    }
    return outputPath;
  } finally {
    await unlink(inputPath).catch(() => undefined);
  }
}

function defaultReplayCoachingPack(replay: ReplayRecord, match: MatchDraft | undefined, settings: UserSettings): NonNullable<ReplayRecord["coachingPack"]> {
  const title = replay.title || (match ? `${match.myChampion || "Player"} vs ${match.opponentChampion || "Opponent"}` : "RiftLite coaching pack");
  return {
    title,
    author: settings.username || replay.players.me || "RiftLite player",
    summary: match?.notes?.trim() || "",
    purpose: "Review",
    createdAt: new Date().toISOString()
  };
}

function validateReplayBundle(parsed: RiftReplayBundle): void {
  if (parsed.format !== "riftlite.replay" || ![1, 2, 3, 4].includes(parsed.version) || !parsed.replay?.id) {
    throw new Error("This is not a RiftLite replay bundle.");
  }
}

async function replayBundleFilePrefix(bundlePath: string): Promise<string> {
  const file = await open(bundlePath, "r");
  try {
    const buffer = Buffer.alloc(REPLAY_STREAM_MAGIC.length + 8);
    const result = await file.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, result.bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

async function importReplayBundleFromPath(bundlePath: string): Promise<ReplayRecord> {
  const prefix = await replayBundleFilePrefix(bundlePath);
  if (prefix.startsWith(REPLAY_STREAM_MAGIC)) {
    return importStreamedReplayBundleFromPath(bundlePath);
  }

  const bundleStats = await stat(bundlePath);
  if (bundleStats.size > MAX_REPLAY_IMPORT_BUNDLE_BYTES) {
    throw new Error(
      `That replay bundle is too large to import safely (${formatByteSize(bundleStats.size)}). Trim or re-export a smaller coaching pack.`
    );
  }

  let parsed: RiftReplayBundle;
  try {
    parsed = JSON.parse(await readFile(bundlePath, "utf8")) as RiftReplayBundle;
  } catch {
    throw new Error("That replay file could not be read. It may be incomplete or corrupted.");
  }
  validateReplayBundle(parsed);
  return saveImportedReplayBundleData(parsed, bundlePath);
}

async function importStreamedReplayBundleFromPath(bundlePath: string): Promise<ReplayRecord> {
  const bundleStats = await stat(bundlePath);
  if (bundleStats.size > MAX_REPLAY_IMPORT_BUNDLE_BYTES) {
    throw new Error(
      `That replay bundle is too large to import safely (${formatByteSize(bundleStats.size)}). Trim or re-export a smaller coaching pack.`
    );
  }

  const readStream = createReadStream(bundlePath, { encoding: "utf8" });
  const lines = createInterface({ input: readStream, crlfDelay: Infinity });
  let parsed: RiftReplayBundle | null = null;
  let replayId = "";
  let importedVideo: ReplayVideoAsset | undefined;
  let videoHandle: Awaited<ReturnType<typeof open>> | null = null;
  let importedPath = "";
  let videoDirectory = "";
  let filename = "";
  let decodedBytes = 0;
  let readingVideo = false;

  try {
    for await (const rawLine of lines) {
      const line = rawLine.trim();
      if (!parsed) {
        if (line === REPLAY_STREAM_MAGIC) {
          continue;
        }
        try {
          parsed = JSON.parse(line) as RiftReplayBundle;
        } catch {
          throw new Error("That replay file could not be read. It may be incomplete or corrupted.");
        }
        validateReplayBundle(parsed);
        replayId = randomUUID();
        if (parsed.video?.asset) {
          const settings = await store.getSettings();
          videoDirectory = join(replayVideoImportDirectory(settings), safeFileComponent(replayId, "replay"));
          await mkdir(videoDirectory, { recursive: true });
          filename = `${safeFileComponent(parsed.video.asset.filename || parsed.replay.title || "video-replay", "video-replay")}.${replayVideoExtension(parsed.video.asset.mimeType)}`;
          importedPath = join(videoDirectory, filename);
        }
        continue;
      }

      if (line === REPLAY_STREAM_VIDEO_START) {
        if (!parsed.video?.asset || !importedPath) {
          readingVideo = false;
          continue;
        }
        videoHandle = await open(importedPath, "w");
        readingVideo = true;
        continue;
      }

      if (line === REPLAY_STREAM_VIDEO_END) {
        readingVideo = false;
        if (videoHandle) {
          await videoHandle.close();
          videoHandle = null;
        }
        if (parsed.video?.asset && importedPath) {
          const shouldRemuxImportedVideo = decodedBytes <= MAX_REPLAY_IMPORT_SEEKABLE_BYTES;
          const containerFinalized = shouldRemuxImportedVideo
            ? await makeReplayVideoSeekable(importedPath, parsed.video.asset.mimeType).catch(() => false)
            : false;
          const importedStats = await stat(importedPath);
          importedVideo = {
            ...parsed.video.asset,
            path: importedPath,
            url: pathToFileURL(importedPath).href,
            filename,
            directory: videoDirectory,
            source: "riftreplay",
            sizeBytes: importedStats.size,
            containerFinalized: parsed.video.asset.containerFinalized || containerFinalized
          };
        }
        continue;
      }

      if (readingVideo && videoHandle && line) {
        const bytes = Buffer.from(line, "base64");
        decodedBytes += bytes.length;
        if (decodedBytes > MAX_REPLAY_IMPORT_VIDEO_BYTES) {
          throw new Error(
            `That replay video is too large to import safely (${formatByteSize(decodedBytes)}). Ask the sender to trim it or export a smaller replay.`
          );
        }
        await videoHandle.write(bytes);
      }
    }
  } catch (error) {
    if (videoHandle) {
      await videoHandle.close().catch(() => undefined);
    }
    if (importedPath) {
      await unlink(importedPath).catch(() => undefined);
    }
    throw error;
  } finally {
    readStream.destroy();
  }

  if (!parsed) {
    throw new Error("That replay file could not be read. It may be incomplete or corrupted.");
  }
  if (videoHandle || readingVideo) {
    if (videoHandle) {
      await videoHandle.close().catch(() => undefined);
    }
    if (importedPath) {
      await unlink(importedPath).catch(() => undefined);
    }
    throw new Error("That replay file looks incomplete. The video data did not finish exporting.");
  }
  return saveImportedReplayBundleData(parsed, bundlePath, { replayId, importedVideo });
}

async function saveImportedReplayBundleData(
  parsed: RiftReplayBundle,
  bundlePath: string,
  options: { replayId?: string; importedVideo?: ReplayVideoAsset } = {}
): Promise<ReplayRecord> {
  validateReplayBundle(parsed);
  const importStamp = new Date().toISOString();
  const settings = await store.getSettings();
  const sourceReplayId = parsed.replay.id;
  const replayId = options.replayId ?? randomUUID();
  const frameDirectory = replayFrameDirectory(replayId, settings);
  await mkdir(frameDirectory, { recursive: true });
  const frameByEvent = new Map<string, ReplayBundleFrame & { importedPath: string; importedUrl: string }>();
  const importedFrameRecords: Array<{ frame: ReplayBundleFrame; imported: ReplayScreenshotFrame }> = [];
  const importedFrameTargetIds = new Map<string, string>();
  for (const frame of (parsed.frames ?? []).slice(0, MAX_REPLAY_IMPORT_FRAMES)) {
    if (!frame.data || !frame.eventId) {
      continue;
    }
    if (estimateBase64DecodedBytes(frame.data) > MAX_REPLAY_IMPORT_FRAME_BYTES) {
      continue;
    }
    const extension = extensionForFrame(frame);
    const filename = `${safeFileComponent(frame.eventId, "frame")}-${safeFileComponent(frame.label, "keyframe")}.${extension}`;
    const importedPath = join(frameDirectory, filename);
    try {
      await writeBase64FileChunked(importedPath, frame.data, MAX_REPLAY_IMPORT_FRAME_BYTES);
    } catch {
      await unlink(importedPath).catch(() => undefined);
      continue;
    }
    const importedUrl = pathToFileURL(importedPath).href;
    frameByEvent.set(frame.eventId, {
      ...frame,
      importedPath,
      importedUrl
    });
    importedFrameRecords.push({
      frame,
      imported: {
        path: importedPath,
        url: importedUrl,
        label: frame.label,
        capturedAt: frame.capturedAt,
        source: "riftreplay"
      }
    });
    importedFrameTargetIds.set(replayBundleFrameTargetId(frame), importedReplayFrameTargetId(importedFrameRecords.at(-1)!.imported));
  }
  const structuredEventIds = new Set((parsed.replay.structuredEvents ?? []).map((event) => event.id));
  const structuredEvents = (parsed.replay.structuredEvents ?? []).map((event) => {
    const frame = frameByEvent.get(event.id);
    if (!frame) {
      return event;
    }
    return {
      ...event,
      screenshot: {
        path: frame.importedPath,
        url: frame.importedUrl,
        label: frame.label,
        capturedAt: frame.capturedAt,
        source: "riftreplay"
      }
    };
  });
  let importedVideo: ReplayVideoAsset | undefined = options.importedVideo;
  if (!importedVideo && parsed.video?.data && parsed.video.asset) {
    const videoDirectory = join(replayVideoImportDirectory(settings), safeFileComponent(replayId, "replay"));
    await mkdir(videoDirectory, { recursive: true });
    const filename = `${safeFileComponent(parsed.video.asset.filename || parsed.replay.title || "video-replay", "video-replay")}.${replayVideoExtension(parsed.video.asset.mimeType)}`;
    const importedPath = join(videoDirectory, filename);
    const decodedBytes = estimateBase64DecodedBytes(parsed.video.data);
    if (decodedBytes > MAX_REPLAY_IMPORT_VIDEO_BYTES) {
      throw new Error(
        `That replay video is too large to import safely (${formatByteSize(decodedBytes)}). Ask the sender to trim it or export a smaller replay.`
      );
    }
    try {
      await writeBase64FileChunked(importedPath, parsed.video.data, MAX_REPLAY_IMPORT_VIDEO_BYTES);
    } catch (error) {
      await unlink(importedPath).catch(() => undefined);
      throw error;
    }
    const shouldRemuxImportedVideo = decodedBytes <= MAX_REPLAY_IMPORT_SEEKABLE_BYTES;
    const containerFinalized = shouldRemuxImportedVideo
      ? await makeReplayVideoSeekable(importedPath, parsed.video.asset.mimeType).catch(() => false)
      : false;
    const importedStats = await stat(importedPath);
    importedVideo = {
      ...parsed.video.asset,
      path: importedPath,
      url: pathToFileURL(importedPath).href,
      filename,
      directory: videoDirectory,
      source: "riftreplay",
      sizeBytes: importedStats.size,
      containerFinalized: parsed.video.asset.containerFinalized || containerFinalized
    };
  }
  const importedMatch = parsed.match ?? parsed.replay.matchSnapshot;
  const matchSnapshot = importedMatch
    ? { ...importedMatch, id: `${replayId}:match`, rawEvidence: [] }
    : undefined;
  const remapTargetId = (targetType: ReplayFlag["targetType"] | ReplayAnnotation["targetType"], targetId: string): string => {
    if (targetType === "frame") {
      return importedFrameTargetIds.get(targetId) ?? targetId;
    }
    if (targetType === "replay" && targetId === sourceReplayId) {
      return replayId;
    }
    return targetId;
  };
  const replay: ReplayRecord = {
    ...parsed.replay,
    id: replayId,
    matchId: matchSnapshot?.id ?? replayId,
    title: parsed.replay.title || parsed.search?.title || "Imported replay",
    structuredEvents,
    visualFrames: importedFrameRecords
      .filter(({ frame }) => frame.eventId.startsWith("visual:") || !structuredEventIds.has(frame.eventId))
      .map(({ imported }) => imported),
    matchSnapshot,
    search: parsed.search,
    video: importedVideo,
    schemaVersion: Math.max(4, parsed.replay.schemaVersion ?? 1) as ReplayRecord["schemaVersion"],
    coachingPack: parsed.coachingPack ?? parsed.replay.coachingPack,
    flags: parsed.replay.flags?.map((flag) => ({ ...flag, targetId: remapTargetId(flag.targetType, flag.targetId) })),
    annotations: parsed.replay.annotations?.map((annotation) => ({ ...annotation, targetId: remapTargetId(annotation.targetType, annotation.targetId) })),
    importedAt: importStamp,
    importedFrom: bundlePath
  };
  return store.saveReplay(replay);
}

async function exportDeckNotebook(deckId: string): Promise<string> {
  const deck = await store.getSavedDeck(deckId);
  if (!deck) {
    throw new Error("Deck not found.");
  }
  const notebook = await store.getDeckNotebook(deckId);
  const payload: DeckNotebookExport = {
    format: "riftlite.deck-notebook",
    version: 1,
    exportedAt: new Date().toISOString(),
    deck,
    notebook
  };
  const defaultPath = join(app.getPath("documents"), `${safeFileComponent(`${deck.title} notebook`, "deck-notebook")}.riftdecknotebook`);
  const options: SaveDialogOptions = {
    title: "Export RiftLite deck notebook",
    defaultPath,
    filters: [{ name: "RiftLite Deck Notebook", extensions: ["riftdecknotebook", "json"] }]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return "";
  }
  const filePath = result.filePath.endsWith(".riftdecknotebook") || result.filePath.endsWith(".json")
    ? result.filePath
    : `${result.filePath}.riftdecknotebook`;
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

async function importDeckNotebook(): Promise<DeckNotebook | null> {
  const options: OpenDialogOptions = {
    title: "Import RiftLite deck notebook",
    properties: ["openFile"],
    filters: [{ name: "RiftLite Deck Notebook", extensions: ["riftdecknotebook", "json"] }]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  const parsed = JSON.parse(await readFile(result.filePaths[0], "utf8")) as DeckNotebookExport;
  if (parsed.format !== "riftlite.deck-notebook" || parsed.version !== 1 || !parsed.deck || !parsed.notebook) {
    throw new Error("This is not a RiftLite deck notebook export.");
  }
  const deck = await store.upsertSavedDeck(parsed.deck as SavedDeck);
  return store.saveDeckNotebook(deck.id, { ...parsed.notebook, deckId: deck.id });
}

async function exportDeckPackage(deckId: string, notebookOverride?: DeckNotebook): Promise<string> {
  const payload = await deckPackagePayload(deckId, notebookOverride);
  const defaultPath = join(app.getPath("documents"), `${safeFileComponent(payload.deck.title || "riftlite-deck", "riftlite-deck")}.riftdeck`);
  const options: SaveDialogOptions = {
    title: "Export RiftLite deck package",
    defaultPath,
    filters: [{ name: "RiftLite Deck Package", extensions: ["riftdeck", "json"] }]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return "";
  }
  const filePath = result.filePath.endsWith(".riftdeck") || result.filePath.endsWith(".json")
    ? result.filePath
    : `${result.filePath}.riftdeck`;
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

async function deckPackagePayload(deckId: string, notebookOverride?: DeckNotebook): Promise<DeckPackageExport> {
  const deck = await store.getSavedDeck(deckId);
  if (!deck) {
    throw new Error("Deck not found.");
  }
  const notebook = sanitizeDeckNotebookForDeck(
    notebookOverride?.deckId === deck.id ? notebookOverride : await store.getDeckNotebook(deckId),
    deck
  );
  return {
    format: "riftlite.deck-package",
    version: 1,
    exportedAt: new Date().toISOString(),
    deck,
    notebook
  };
}

async function exportDeckPackageText(deckId: string, notebookOverride?: DeckNotebook): Promise<string> {
  const payload = await deckPackagePayload(deckId, notebookOverride);
  const textPayload = payload.deck.sourceUrl.startsWith("http")
    ? compactDeckSharePayload(payload)
    : payload;
  const encoded = deflateRawSync(Buffer.from(JSON.stringify(textPayload), "utf8")).toString("base64url");
  return `${payload.deck.sourceUrl.startsWith("http") ? DECK_SHARE_TEXT_PREFIX : DECK_PACKAGE_COMPRESSED_TEXT_PREFIX}${encoded}`;
}

function compactDeckSharePayload(payload: DeckPackageExport): CompactDeckSharePayload {
  return {
    f: "riftlite.deck-share",
    v: 2,
    d: {
      u: payload.deck.sourceUrl,
      k: payload.deck.sourceKey,
      t: payload.deck.title,
      l: payload.deck.legend
    },
    n: compactDeckNotebook(payload.notebook)
  };
}

function compactDeckNotebook(notebook: DeckNotebook): CompactDeckSharePayload["n"] {
  return {
    go: notebook.goals.map((goal) => ({ t: goal.text, s: goal.status })),
    w: notebook.watchlist.map((item) => ({
      k: item.cardKey,
      n: item.cardName,
      c: item.cardId,
      i: item.imageUrl,
      s: item.status,
      t: item.note
    })),
    v: notebook.versions.map((version) => ({
      h: version.snapshotHash,
      t: version.title,
      l: version.legend,
      k: version.sourceKey,
      u: version.sourceUrl,
      a: version.importedAt,
      s: version.summary
    })),
    d: compactDeckGuide(notebook.defaultGuide),
    g: notebook.matchupGuides.map(compactDeckGuide)
  };
}

function compactDeckGuide(guide: DeckMatchupGuide): CompactDeckShareGuide {
  return {
    ...(guide.legend ? { l: guide.legend } : {}),
    m: {
      k: compactDeckGuideSection(guide.mulligan.keep),
      c: compactDeckGuideSection(guide.mulligan.consider),
      a: compactDeckGuideSection(guide.mulligan.avoid)
    },
    s: {
      i: compactDeckGuideSection(guide.sideboard.in),
      o: compactDeckGuideSection(guide.sideboard.out),
      ...(guide.sideboard.note ? { n: guide.sideboard.note } : {})
    },
    b: {
      g: compactDeckGuideSection(guide.battlefields.game1),
      f: compactDeckGuideSection(guide.battlefields.game1First),
      s: compactDeckGuideSection(guide.battlefields.game1Second),
      ...(guide.battlefields.note ? { n: guide.battlefields.note } : {})
    },
    ...(guide.notes.length ? { x: guide.notes.map((note) => note.text).filter(Boolean) } : {})
  };
}

function compactDeckGuideSection(section: DeckGuideSection): CompactDeckShareSection {
  return {
    ...(section.cards.length ? { c: section.cards.map(compactDeckGuideCard) } : {}),
    ...(section.note ? { n: section.note } : {})
  };
}

function compactDeckGuideCard(card: DeckGuideCardRef): CompactDeckShareCard {
  return {
    k: card.cardKey,
    n: card.cardName,
    c: card.cardId,
    i: card.imageUrl,
    q: card.qty,
    t: card.note,
    g: card.groupName,
    r: card.groupTarget,
    m: card.groupNote,
    p: card.priority
  };
}

async function exportDeckPrepPdf(deckId: string, notebookOverride?: DeckNotebook): Promise<string> {
  const deck = await store.getSavedDeck(deckId);
  if (!deck) {
    throw new Error("Deck not found.");
  }
  const notebook = sanitizeDeckNotebookForDeck(
    notebookOverride?.deckId === deck.id ? notebookOverride : await store.getDeckNotebook(deck.id),
    deck
  );
  const defaultPath = join(
    app.getPath("documents"),
    `RiftLite-${safeFileComponent(`${deck.title} matchup prep`, "matchup-prep")}-${new Date().toISOString().slice(0, 10)}.pdf`
  );
  const options: SaveDialogOptions = {
    title: "Export printable RiftLite matchup prep PDF",
    defaultPath,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return "";
  }
  const filePath = result.filePath.toLowerCase().endsWith(".pdf") ? result.filePath : `${result.filePath}.pdf`;
  const logoDataUrl = await assetDataUrl("riftlite-logo-transparent.png").catch(() => "");
  const html = buildDeckPrepPdfHtml(deck, notebook, logoDataUrl);
  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await waitForPrintableAssets(pdfWindow);
    const pdf = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: {
        marginType: "custom",
        top: 0.35,
        bottom: 0.35,
        left: 0.3,
        right: 0.3
      }
    });
    await writeFile(filePath, pdf);
    return filePath;
  } finally {
    if (!pdfWindow.isDestroyed()) {
      pdfWindow.destroy();
    }
  }
}

async function waitForPrintableAssets(window: BrowserWindow): Promise<void> {
  const assetReadyScript = `
    Promise.all(Array.from(document.images).map((img) => {
      if (img.complete) return true;
      return new Promise((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(true);
      });
    })).then(() => true)
  `;
  await Promise.race([
    window.webContents.executeJavaScript(assetReadyScript, true).catch(() => true),
    new Promise((resolve) => setTimeout(resolve, 1800))
  ]);
}

function buildDeckPrepPdfHtml(deck: SavedDeck, notebook: DeckNotebook, logoDataUrl: string): string {
  const snapshot = parseDeckSnapshotForPdf(deck);
  const guideList = [
    { title: "All matchups default", guide: notebook.defaultGuide, source: "default" },
    ...notebook.matchupGuides
      .filter(deckGuideHasContent)
      .sort((a, b) => a.legend.localeCompare(b.legend))
      .map((guide) => ({ title: `Vs ${guide.legend}`, guide, source: "matchup" }))
  ];
  const printedAt = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const subtitle = [
    snapshot.legend || deck.legend || "Unknown legend",
    snapshot.sourceUrl ? "RiftLite deck package" : "RiftLite deck"
  ].filter(Boolean).join(" | ");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${htmlText(deck.title)} - RiftLite Matchup Prep</title>
  <style>
    :root {
      --ink: #0d1730;
      --muted: #5e6b82;
      --line: #d9e5f8;
      --panel: #f7fbff;
      --cyan: #12c8ff;
      --blue: #1751d8;
      --purple: #8b3dff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      font-family: Inter, Segoe UI, Arial, sans-serif;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.35;
    }
    .page { padding: 18px 20px 22px; }
    .hero {
      display: grid;
      grid-template-columns: 72px 1fr auto;
      gap: 16px;
      align-items: center;
      padding: 16px;
      color: white;
      background: linear-gradient(135deg, #071a3d 0%, #124f9f 47%, #7628e8 100%);
      border-radius: 14px;
      overflow: hidden;
    }
    .logo {
      width: 68px;
      height: 68px;
      object-fit: contain;
      padding: 4px;
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.22);
      border-radius: 14px;
    }
    .logo-fallback {
      width: 68px;
      height: 68px;
      display: grid;
      place-items: center;
      font-size: 38px;
      font-weight: 900;
      color: #88f3ff;
      background: rgba(255,255,255,0.12);
      border-radius: 14px;
    }
    .eyebrow {
      margin: 0 0 3px;
      color: #88f3ff;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    h1, h2, h3, h4, p { margin-top: 0; }
    h1 { margin-bottom: 4px; font-size: 28px; line-height: 1.05; }
    .hero p { margin-bottom: 0; color: #d8efff; }
    .print-meta {
      text-align: right;
      color: #dbf8ff;
      font-weight: 700;
      white-space: nowrap;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin: 14px 0;
    }
    .summary-card, .panel {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 10px;
      padding: 10px;
    }
    .label {
      color: var(--muted);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .value { margin-top: 3px; font-size: 15px; font-weight: 900; }
    .deck-list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 14px;
    }
    .deck-list h3, .guide h2 {
      color: #092c63;
      margin-bottom: 8px;
      font-size: 16px;
    }
    .entries {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 3px 8px;
    }
    .entry {
      display: grid;
      grid-template-columns: 24px 1fr;
      gap: 5px;
      min-width: 0;
      break-inside: avoid;
    }
    .qty {
      color: var(--blue);
      font-weight: 900;
      text-align: right;
    }
    .guide {
      break-inside: avoid;
      page-break-inside: avoid;
      margin: 14px 0;
      padding: 12px;
      border: 1px solid #b9d3ff;
      border-radius: 14px;
      background: linear-gradient(180deg, #ffffff 0%, #f4faff 100%);
    }
    .guide-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 10px;
      border-bottom: 2px solid #e6f1ff;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .guide-head span {
      color: var(--muted);
      font-weight: 700;
    }
    .guide-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .section {
      margin-bottom: 9px;
      break-inside: avoid;
    }
    .section h4 {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #0a336e;
      margin-bottom: 6px;
      padding-bottom: 3px;
      border-bottom: 1px solid #dceaff;
      font-size: 12px;
    }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }
    .mini-group {
      grid-column: 1 / -1;
      display: grid;
      gap: 6px;
      padding: 7px;
      border: 1px solid #c7e4ff;
      border-radius: 8px;
      background: #eef7ff;
      break-inside: avoid;
    }
    .mini-group header {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: #092c63;
      font-size: 10px;
      font-weight: 900;
    }
    .mini-group header span,
    .mini-group p {
      color: var(--muted);
      font-size: 9px;
      font-weight: 700;
    }
    .mini-group p {
      margin: 0;
      font-weight: 500;
    }
    .mini-group-cards {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 5px;
    }
    .card {
      display: grid;
      grid-template-columns: 34px 1fr;
      gap: 7px;
      align-items: center;
      min-height: 48px;
      padding: 5px;
      border: 1px solid #cce0ff;
      border-radius: 8px;
      background: white;
      break-inside: avoid;
    }
    .thumb-wrap {
      position: relative;
      width: 32px;
      min-height: 44px;
    }
    .card img {
      width: 32px;
      height: 44px;
      object-fit: cover;
      border-radius: 5px;
      border: 1px solid #b7c8e7;
    }
    .priority-badge {
      position: absolute;
      top: -5px;
      right: -6px;
      min-width: 18px;
      padding: 2px 4px;
      border-radius: 99px;
      color: white;
      background: linear-gradient(135deg, var(--blue), var(--purple));
      font-size: 8px;
      font-weight: 900;
      line-height: 1;
      text-align: center;
    }
    .card strong {
      display: block;
      font-size: 10px;
    }
    .group-chip {
      display: inline-block;
      max-width: 100%;
      margin-top: 2px;
      padding: 1px 5px;
      border: 1px solid #bdd7ff;
      border-radius: 99px;
      color: #0a336e;
      background: #eaf4ff;
      font-size: 8px;
      font-weight: 800;
    }
    .card em, .note {
      display: block;
      color: var(--muted);
      font-size: 9px;
      font-style: normal;
      margin-top: 2px;
    }
    .fallback-thumb {
      width: 32px;
      height: 44px;
      display: grid;
      place-items: center;
      color: white;
      font-weight: 900;
      border-radius: 5px;
      background: linear-gradient(135deg, var(--blue), var(--purple));
    }
    .empty {
      margin: 0;
      color: #7b879b;
      font-style: italic;
    }
    .note-box {
      padding: 7px;
      border: 1px dashed #b9cbe8;
      border-radius: 8px;
      background: #fbfdff;
      color: #31415f;
      white-space: pre-wrap;
    }
    .notes-list {
      display: grid;
      gap: 6px;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      margin-top: 16px;
      padding-top: 8px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 9px;
    }
    @media print {
      .page { padding: 0; }
      .guide { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      ${logoDataUrl ? `<img class="logo" src="${htmlAttr(logoDataUrl)}" alt="RiftLite logo" />` : `<div class="logo-fallback">R</div>`}
      <div>
        <p class="eyebrow">RiftLite Matchup Prep</p>
        <h1>${htmlText(deck.title || "Untitled deck")}</h1>
        <p>${htmlText(subtitle)}</p>
      </div>
      <div class="print-meta">RiftLite.com<br />${htmlText(printedAt)}</div>
    </section>
    <section class="summary-grid">
      ${summaryCard("Legend", snapshot.legend || deck.legend || "Unknown")}
      ${summaryCard("Main deck", `${sumQty(snapshot.mainDeck)} cards`)}
      ${summaryCard("Sideboard", `${sumQty(snapshot.sideboard)} cards`)}
      ${summaryCard("Guides", `${guideList.length} printable guide${guideList.length === 1 ? "" : "s"}`)}
    </section>
    <section class="deck-list">
      ${deckListPanel("Runes", snapshot.runes)}
      ${deckListPanel("Battlefields", snapshot.battlefields)}
      ${deckListPanel("Main deck", snapshot.mainDeck)}
      ${deckListPanel("Sideboard", snapshot.sideboard)}
    </section>
    ${guideList.map(({ title, guide, source }) => guidePdfHtml(title, guide, source)).join("")}
    <section class="footer">
      <span>Local-only prep export. Share only if you want other players to see your guide.</span>
      <strong>Generated by RiftLite</strong>
    </section>
  </main>
</body>
</html>`;
}

function parseDeckSnapshotForPdf(deck: SavedDeck): DeckSnapshot {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(deck.snapshotJson) as unknown;
    raw = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    raw = {};
  }
  return {
    title: plainText(raw.title) || deck.title,
    legend: plainText(raw.legend) || deck.legend,
    legendKey: plainText(raw.legendKey ?? raw.legend_key),
    legendEntry: cleanDeckEntry(raw.legendEntry ?? raw.legend_entry),
    sourceUrl: plainText(raw.sourceUrl ?? raw.source_url) || deck.sourceUrl,
    sourceKey: plainText(raw.sourceKey ?? raw.source_key) || deck.sourceKey,
    runes: cleanDeckEntries(raw.runes),
    battlefields: cleanDeckEntries(raw.battlefields),
    mainDeck: cleanDeckEntries(raw.mainDeck ?? raw.main_deck),
    sideboard: cleanDeckEntries(raw.sideboard),
    tcgaMeta: raw.tcgaMeta && typeof raw.tcgaMeta === "object" && !Array.isArray(raw.tcgaMeta) ? raw.tcgaMeta as Record<string, unknown> : undefined
  };
}

function cleanDeckEntries(value: unknown): DeckEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(cleanDeckEntry).filter((entry): entry is DeckEntry => Boolean(entry?.name));
}

function cleanDeckEntry(value: unknown): DeckEntry | undefined {
  if (typeof value === "string") {
    const name = plainText(value);
    return name ? { qty: 1, name } : undefined;
  }
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const qty = Math.max(1, Math.trunc(Number(record.qty ?? record.quantity ?? record.count ?? 1) || 1));
  const name = plainText(record.name ?? record.cardName ?? record.card_name ?? record.title);
  if (!name) {
    return undefined;
  }
  return {
    qty,
    name,
    cardId: plainText(record.cardId ?? record.card_id) || undefined,
    imageUrl: plainText(record.imageUrl ?? record.image_url) || undefined
  };
}

function guidePdfHtml(title: string, guide: DeckMatchupGuide, source: string): string {
  return `<section class="guide">
    <div class="guide-head">
      <h2>${htmlText(title)}</h2>
      <span>${source === "default" ? "Fallback guide" : "Specific matchup guide"}</span>
    </div>
    <div class="guide-grid">
      <div class="panel">
        <h3>Mulligan</h3>
        ${guideSectionPdfHtml("Keep", guide.mulligan.keep)}
        ${guideSectionPdfHtml("Consider", guide.mulligan.consider)}
        ${guideSectionPdfHtml("Avoid", guide.mulligan.avoid)}
      </div>
      <div class="panel">
        <h3>Sideboard</h3>
        ${guideSectionPdfHtml("Bring in", guide.sideboard.in)}
        ${guideSectionPdfHtml("Take out", guide.sideboard.out)}
        ${guide.sideboard.note.trim() ? `<div class="section"><h4>Plan</h4><div class="note-box">${htmlText(guide.sideboard.note)}</div></div>` : ""}
      </div>
      <div class="panel">
        <h3>Battlefields</h3>
        ${guideSectionPdfHtml("Game 1 Blind Pick", guide.battlefields.game1)}
        ${guideSectionPdfHtml("Going First", guide.battlefields.game1First)}
        ${guideSectionPdfHtml("Going Second", guide.battlefields.game1Second)}
        ${guide.battlefields.note.trim() ? `<div class="section"><h4>Plan</h4><div class="note-box">${htmlText(guide.battlefields.note)}</div></div>` : ""}
      </div>
    </div>
    ${guide.notes.length ? `<div class="panel" style="margin-top:10px"><h3>Matchup notes</h3><div class="notes-list">${guide.notes.map((note) => `<div class="note-box">${htmlText(note.text)}</div>`).join("")}</div></div>` : ""}
  </section>`;
}

function guideSectionPdfHtml(title: string, section: DeckGuideSection): string {
  const cards = groupedGuideCardsForPdf(section.cards);
  return `<div class="section">
    <h4><span>${htmlText(title)}</span><span>${section.cards.length}</span></h4>
    ${section.cards.length ? `<div class="card-grid">${cards.map((item) => item.type === "group" ? guideGroupPdfHtml(item) : guideCardPdfHtml(item.card)).join("")}</div>` : `<p class="empty">No cards selected.</p>`}
    ${section.note.trim() ? `<div class="note-box" style="margin-top:6px">${htmlText(section.note)}</div>` : ""}
  </div>`;
}

type PdfGuideItem =
  | { type: "card"; card: DeckGuideCardRef }
  | { type: "group"; key: string; title: string; target: string; note: string; cards: DeckGuideCardRef[] };

function groupedGuideCardsForPdf(cards: DeckGuideCardRef[]): PdfGuideItem[] {
  const output: PdfGuideItem[] = [];
  const groups = new Map<string, Extract<PdfGuideItem, { type: "group" }>>();
  for (const card of cards) {
    const title = card.groupName?.trim();
    if (!title) {
      output.push({ type: "card", card });
      continue;
    }
    const key = title.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.cards.push(card);
      if (!existing.target && card.groupTarget?.trim()) {
        existing.target = card.groupTarget.trim();
      }
      if (!existing.note && card.groupNote?.trim()) {
        existing.note = card.groupNote.trim();
      }
      continue;
    }
    const group: Extract<PdfGuideItem, { type: "group" }> = {
      type: "group",
      key,
      title,
      target: card.groupTarget?.trim() ?? "",
      note: card.groupNote?.trim() ?? "",
      cards: [card]
    };
    groups.set(key, group);
    output.push(group);
  }
  return output.map((item) => item.type === "group"
    ? { ...item, cards: [...item.cards].sort(compareGuidePriorityForPdf) }
    : item
  );
}

function compareGuidePriorityForPdf(a: DeckGuideCardRef, b: DeckGuideCardRef): number {
  const aPriority = Number.isFinite(a.priority) && a.priority ? a.priority : 99;
  const bPriority = Number.isFinite(b.priority) && b.priority ? b.priority : 99;
  return aPriority - bPriority || a.cardName.localeCompare(b.cardName);
}

function guideGroupPdfHtml(group: Extract<PdfGuideItem, { type: "group" }>): string {
  return `<div class="mini-group">
    <header><strong>${htmlText(group.title)}</strong>${group.target ? `<span>${htmlText(group.target)}</span>` : ""}</header>
    ${group.note ? `<p>${htmlText(group.note)}</p>` : ""}
    <div class="mini-group-cards">${group.cards.map(guideCardPdfHtml).join("")}</div>
  </div>`;
}

function guideCardPdfHtml(card: DeckGuideCardRef): string {
  const image = safePdfImageUrl(card.imageUrl ?? "");
  return `<div class="card">
    <div class="thumb-wrap">
      ${image ? `<img src="${htmlAttr(image)}" alt="" />` : `<span class="fallback-thumb">${htmlText(card.cardName.slice(0, 1) || "?")}</span>`}
      ${card.priority ? `<b class="priority-badge">P${htmlText(card.priority)}</b>` : ""}
    </div>
    <div>
      <strong>${htmlText(`${card.qty}x ${card.cardName}`)}</strong>
      ${card.groupName?.trim() ? `<small class="group-chip">${htmlText(card.groupName)}</small>` : ""}
      ${card.note?.trim() ? `<em>${htmlText(card.note)}</em>` : ""}
    </div>
  </div>`;
}

function deckListPanel(title: string, entries: DeckEntry[]): string {
  return `<section class="panel">
    <h3>${htmlText(title)}</h3>
    ${entries.length ? `<div class="entries">${entries.map((entry) => `<div class="entry"><span class="qty">${entry.qty}x</span><span>${htmlText(entry.name)}</span></div>`).join("")}</div>` : `<p class="empty">No ${htmlText(title.toLowerCase())} listed.</p>`}
  </section>`;
}

function summaryCard(label: string, value: string): string {
  return `<div class="summary-card"><div class="label">${htmlText(label)}</div><div class="value">${htmlText(value)}</div></div>`;
}

function deckGuideHasContent(guide: DeckMatchupGuide): boolean {
  return [
    guide.mulligan.keep,
    guide.mulligan.consider,
    guide.mulligan.avoid,
    guide.sideboard.in,
    guide.sideboard.out,
    guide.battlefields.game1,
    guide.battlefields.game1First,
    guide.battlefields.game1Second
  ].some((section) => section.cards.length || section.note.trim())
    || guide.sideboard.note.trim().length > 0
    || guide.battlefields.note.trim().length > 0
    || guide.notes.some((note) => note.text.trim());
}

function sumQty(entries: DeckEntry[]): number {
  return entries.reduce((total, entry) => total + Math.max(0, Number(entry.qty) || 0), 0);
}

function safePdfImageUrl(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed) || /^data:image\//i.test(trimmed)) {
    return trimmed;
  }
  return "";
}

function plainText(value: unknown): string {
  return String(value ?? "").trim();
}

function htmlText(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlAttr(value: unknown): string {
  return htmlText(value);
}

async function importDeckPackage(): Promise<DeckPackageImportResult | null> {
  const options: OpenDialogOptions = {
    title: "Import RiftLite deck package",
    properties: ["openFile"],
    filters: [{ name: "RiftLite Deck Package", extensions: ["riftdeck", "riftdecknotebook", "json"] }]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  const parsed = JSON.parse(await readFile(result.filePaths[0], "utf8")) as DeckPackageExport | DeckNotebookExport;
  return importDeckPackagePayload(parsed);
}

async function importDeckPackageText(text: string): Promise<DeckPackageImportResult> {
  const parsed = parseDeckPackageText(text);
  if (isCompactDeckSharePayload(parsed)) {
    return importCompactDeckSharePayload(parsed);
  }
  const imported = await importDeckPackagePayload(parsed);
  if (!imported) {
    throw new Error("This is not a RiftLite deck package.");
  }
  return imported;
}

function parseDeckPackageText(text: string): DeckPackageExport | DeckNotebookExport | CompactDeckSharePayload {
  const raw = text.trim();
  if (!raw) {
    throw new Error("Paste a RiftLite deck package first.");
  }
  const sharePrefixIndex = raw.toUpperCase().indexOf(DECK_SHARE_TEXT_PREFIX);
  if (sharePrefixIndex >= 0) {
    const encoded = extractEncodedPackageText(raw.slice(sharePrefixIndex + DECK_SHARE_TEXT_PREFIX.length));
    return JSON.parse(inflateRawSync(Buffer.from(encoded, "base64url")).toString("utf8")) as CompactDeckSharePayload;
  }
  const compressedPrefixIndex = raw.toUpperCase().indexOf(DECK_PACKAGE_COMPRESSED_TEXT_PREFIX);
  if (compressedPrefixIndex >= 0) {
    const encoded = extractEncodedPackageText(raw.slice(compressedPrefixIndex + DECK_PACKAGE_COMPRESSED_TEXT_PREFIX.length));
    return JSON.parse(inflateRawSync(Buffer.from(encoded, "base64url")).toString("utf8")) as DeckPackageExport | DeckNotebookExport;
  }
  const prefixIndex = raw.toUpperCase().indexOf(DECK_PACKAGE_TEXT_PREFIX);
  if (prefixIndex >= 0) {
    const encoded = extractEncodedPackageText(raw.slice(prefixIndex + DECK_PACKAGE_TEXT_PREFIX.length));
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as DeckPackageExport | DeckNotebookExport;
  }
  const unfenced = raw
    .replace(/^```(?:json|text|riftdeck)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (unfenced.startsWith("{")) {
    return JSON.parse(unfenced) as DeckPackageExport | DeckNotebookExport;
  }
  return JSON.parse(Buffer.from(unfenced.replace(/\s+/g, ""), "base64url").toString("utf8")) as DeckPackageExport | DeckNotebookExport;
}

function extractEncodedPackageText(value: string): string {
  const encoded = value
    .replace(/^```(?:json|text|riftdeck)?\s*/i, "")
    .replace(/\s+/g, "")
    .match(/^[A-Za-z0-9_-]+/)?.[0];
  if (!encoded) {
    throw new Error("That RiftLite deck package text is missing its encoded package.");
  }
  return encoded;
}

function isCompactDeckSharePayload(value: DeckPackageExport | DeckNotebookExport | CompactDeckSharePayload): value is CompactDeckSharePayload {
  return (value as CompactDeckSharePayload).f === "riftlite.deck-share" && (value as CompactDeckSharePayload).v === 2;
}

async function importCompactDeckSharePayload(parsed: CompactDeckSharePayload): Promise<DeckPackageImportResult> {
  const deckInfo = parsed.d ?? {};
  const sourceUrl = plainText(deckInfo.u);
  const snapshotJson = plainText(deckInfo.s);
  let deck: SavedDeck;
  if (snapshotJson) {
    deck = await store.upsertSavedDeck({
      sourceUrl,
      sourceKey: plainText(deckInfo.k),
      title: plainText(deckInfo.t) || "Imported RiftLite deck",
      legend: plainText(deckInfo.l),
      snapshotJson,
      lastRefreshStatus: "shared-text",
      lastRefreshError: ""
    });
  } else if (sourceUrl.startsWith("http")) {
    try {
      deck = await deckService.importDeck(sourceUrl);
    } catch (error) {
      throw new Error(`Could not fetch the deck source for this short package. Ask for the .riftdeck file instead. ${error instanceof Error ? error.message : ""}`.trim());
    }
  } else {
    throw new Error("This short deck package does not include enough deck data. Ask for the .riftdeck file instead.");
  }
  const notebook = await store.saveDeckNotebook(deck.id, expandCompactDeckNotebook(parsed.n, deck.id, deck));
  return { deck, notebook };
}

function expandCompactDeckNotebook(value: CompactDeckSharePayload["n"], deckId: string, deck: SavedDeck): DeckNotebook {
  const now = new Date().toISOString();
  return {
    deckId,
    updatedAt: now,
    goals: (value.go ?? []).map((goal) => ({
      id: randomUUID(),
      text: plainText(goal.t),
      status: (goal.s === "Done" || goal.s === "Paused" ? goal.s : "Active") as DeckNotebook["goals"][number]["status"],
      createdAt: now
    })).filter((goal) => goal.text),
    versions: (value.v ?? []).map((version) => ({
      id: randomUUID(),
      snapshotHash: plainText(version.h),
      title: plainText(version.t) || deck.title,
      legend: plainText(version.l) || deck.legend,
      sourceKey: plainText(version.k) || deck.sourceKey,
      sourceUrl: plainText(version.u) || deck.sourceUrl,
      importedAt: plainText(version.a) || now,
      summary: plainText(version.s)
    })).filter((version) => version.snapshotHash),
    watchlist: (value.w ?? []).map((item) => ({
      id: randomUUID(),
      cardKey: plainText(item.k),
      cardName: plainText(item.n),
      cardId: plainText(item.c),
      imageUrl: plainText(item.i),
      status: (item.s === "Overperforming" || item.s === "Underperforming" || item.s === "Cut candidate" ? item.s : "Testing") as DeckNotebook["watchlist"][number]["status"],
      note: plainText(item.t),
      createdAt: now
    })).filter((item) => item.cardKey && item.cardName),
    defaultGuide: expandCompactDeckGuide(value.d, ""),
    matchupGuides: (value.g ?? []).map((guide) => expandCompactDeckGuide(guide, plainText(guide.l))).filter((guide) => guide.legend)
  };
}

function expandCompactDeckGuide(value: CompactDeckShareGuide | undefined, legend: string): DeckMatchupGuide {
  const base = emptyDeckMatchupGuide(legend);
  const now = new Date().toISOString();
  return {
    ...base,
    updatedAt: now,
    mulligan: {
      keep: expandCompactDeckSection(value?.m?.k),
      consider: expandCompactDeckSection(value?.m?.c),
      avoid: expandCompactDeckSection(value?.m?.a)
    },
    sideboard: {
      in: expandCompactDeckSection(value?.s?.i),
      out: expandCompactDeckSection(value?.s?.o),
      note: plainText(value?.s?.n)
    },
    battlefields: {
      game1: expandCompactDeckSection(value?.b?.g),
      game1First: expandCompactDeckSection(value?.b?.f),
      game1Second: expandCompactDeckSection(value?.b?.s),
      note: plainText(value?.b?.n)
    },
    notes: (value?.x ?? []).map((text) => ({
      id: randomUUID(),
      text: plainText(text),
      createdAt: now,
      updatedAt: "",
      source: "deck" as const
    })).filter((note) => note.text)
  };
}

function expandCompactDeckSection(value: CompactDeckShareSection | undefined): DeckGuideSection {
  return {
    cards: (value?.c ?? []).map((card) => ({
      id: randomUUID(),
      cardKey: plainText(card.k),
      cardName: plainText(card.n),
      cardId: plainText(card.c),
      imageUrl: plainText(card.i),
      qty: Math.max(1, Math.trunc(Number(card.q) || 1)),
      note: plainText(card.t),
      groupName: plainText(card.g),
      groupTarget: plainText(card.r),
      groupNote: plainText(card.m),
      priority: Number.isFinite(Number(card.p)) && Number(card.p) > 0 ? Math.trunc(Number(card.p)) : undefined
    })).filter((card) => card.cardKey && card.cardName),
    note: plainText(value?.n)
  };
}

async function importDeckPackagePayload(parsed: DeckPackageExport | DeckNotebookExport): Promise<DeckPackageImportResult> {
  if (parsed.format !== "riftlite.deck-package" && parsed.format !== "riftlite.deck-notebook") {
    throw new Error("This is not a RiftLite deck package.");
  }
  if (parsed.version !== 1 || !parsed.deck || !parsed.notebook) {
    throw new Error("This RiftLite deck package is not supported.");
  }
  const deck = await store.upsertSavedDeck(parsed.deck as SavedDeck);
  const notebook = await store.saveDeckNotebook(deck.id, { ...parsed.notebook, deckId: deck.id });
  return { deck, notebook };
}

async function getActiveDeckPrep(opponentLegend = ""): Promise<ActiveDeckPrep> {
  const settings = await store.getSettings();
  const deck = settings.activeDeckId ? await store.getSavedDeck(settings.activeDeckId) : null;
  if (!deck) {
    return { deck: null, notebook: null, guide: null, opponentLegend: "", source: "none" };
  }
  const notebook = await store.getDeckNotebook(deck.id);
  const resolved = resolveDeckMatchupGuide(notebook, opponentLegend);
  return {
    deck,
    notebook,
    guide: resolved.guide,
    opponentLegend,
    source: resolved.source
  };
}

async function exportAccountData(): Promise<string> {
  const data = await syncService.getAccountExportData();
  const defaultPath = join(app.getPath("documents"), `RiftLite-account-${new Date().toISOString().slice(0, 10)}.json`);
  const options: SaveDialogOptions = {
    title: "Export RiftLite account data",
    defaultPath,
    filters: [{ name: "JSON", extensions: ["json"] }]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return "";
  }
  await writeFile(result.filePath, JSON.stringify(data, null, 2), "utf8");
  return result.filePath;
}

function backupSummary(data: RiftLiteBackupFile, filePath: string, preRestoreBackupPath = ""): RiftLiteBackupSummary {
  return {
    path: filePath,
    exportedAt: data.exportedAt,
    appVersion: data.appVersion,
    matches: data.matches?.length ?? 0,
    deletedMatches: data.deletedMatches?.length ?? 0,
    decks: data.decks?.length ?? 0,
    notebooks: data.notebooks?.length ?? 0,
    replays: data.replays?.length ?? 0,
    deletedReplays: data.deletedReplays?.length ?? 0,
    settingsIncluded: Boolean(data.settings),
    preRestoreBackupPath: preRestoreBackupPath || undefined
  };
}

function parseBackupFile(raw: string): RiftLiteBackupFile {
  const parsed = JSON.parse(raw) as RiftLiteBackupFile;
  if (parsed.format !== "riftlite.backup" || parsed.version !== 1) {
    throw new Error("That file is not a supported RiftLite backup.");
  }
  if (!parsed.settings || !Array.isArray(parsed.matches) || !Array.isArray(parsed.decks) || !Array.isArray(parsed.replays)) {
    throw new Error("That backup is missing required RiftLite data.");
  }
  return {
    ...parsed,
    deletedMatches: Array.isArray(parsed.deletedMatches) ? parsed.deletedMatches : [],
    notebooks: Array.isArray(parsed.notebooks) ? parsed.notebooks : [],
    deletedReplays: Array.isArray(parsed.deletedReplays) ? parsed.deletedReplays : []
  };
}

async function writeBackupFile(filePath: string, data: RiftLiteBackupFile): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data), "utf8");
}

async function exportRiftLiteBackup(options: Partial<RiftLiteBackupOptions> = {}): Promise<RiftLiteBackupSummary | null> {
  const defaultPath = join(backupDirectory(), `RiftLite Backup ${backupTimestamp()}.${RIFTLITE_BACKUP_EXTENSION}`);
  const dialogOptions: SaveDialogOptions = {
    title: "Export RiftLite backup",
    defaultPath,
    filters: [{ name: "RiftLite backup", extensions: [RIFTLITE_BACKUP_EXTENSION] }]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
  if (result.canceled || !result.filePath) {
    return null;
  }
  const backup = await store.exportBackupData({ includeRecycleBin: options.includeRecycleBin !== false });
  await writeBackupFile(result.filePath, backup);
  shell.showItemInFolder(result.filePath);
  return backupSummary(backup, result.filePath);
}

async function runRiftLiteDataRestore<T>(
  restore: (restoreFence: AccountCloudRestoreFence) => Promise<T>
): Promise<T> {
  // Do not discard scheduled work until the service-level fence is actually
  // acquired. If an active upload makes this restore refuse, resume the exact
  // pending automatic sync instead of silently losing it.
  const resumeAccountCloudSync = accountCloudSyncQueue.suspend();
  let releaseCaptureMaintenance: (() => void) | null = null;
  let discardedPendingSyncReason = "";
  let restoreCompleted = false;
  try {
    const result = await syncService.runWithAccountCloudRestoreFence((restoreFence) => {
      discardedPendingSyncReason = accountCloudSyncQueue.takePendingReason();
      return runAccountCloudRestore(() => restore(restoreFence), {
        prepareForRestore: async () => {
          releaseCaptureMaintenance = await capture.beginDataMaintenance();
        },
        invalidateDeckLibrary: () => {
          deckTrackerService.invalidateDeckLibrary();
        },
        refreshAfterRestore: async () => {
          replayFrameDirectoryCache = null;
          await configureTcgaWebReplayProductCapture().catch((error) => logStartupIssue("TCGA Web Replay restore reconfiguration failed", error));
          await configureScreenshotHotkey().catch((error) => logStartupIssue("screenshot hotkey restore reconfiguration failed", error));
          await configureReplayHotkeys().catch((error) => logStartupIssue("replay hotkey restore reconfiguration failed", error));
        },
        finishRestore: () => {
          releaseCaptureMaintenance?.();
          releaseCaptureMaintenance = null;
        }
      });
    });
    restoreCompleted = true;
    return result;
  } finally {
    // The service releases its cloud-restore fence before control reaches this
    // block. If the atomic restore failed, restore the pre-existing upload
    // intent without replacing any newer mutation queued during the attempt.
    if (!restoreCompleted && discardedPendingSyncReason) {
      accountCloudSyncQueue.restorePendingReason(discardedPendingSyncReason);
    }
    resumeAccountCloudSync();
  }
}

async function restoreRiftLiteBackup(): Promise<RiftLiteBackupSummary | null> {
  const dialogOptions: OpenDialogOptions = {
    title: "Restore RiftLite backup",
    defaultPath: backupDirectory(),
    filters: [{ name: "RiftLite backup", extensions: [RIFTLITE_BACKUP_EXTENSION] }],
    properties: ["openFile"]
  };
  const openResult = mainWindow ? await dialog.showOpenDialog(mainWindow, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
  const filePath = openResult.filePaths[0];
  if (openResult.canceled || !filePath) {
    return null;
  }
  const backup = parseBackupFile(await readFile(filePath, "utf8"));
  const messageBoxOptions = {
    type: "warning" as const,
    buttons: ["Restore backup", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Restore RiftLite backup?",
    message: "This will replace the local RiftLite data on this PC.",
    detail: `RiftLite will first create a safety backup of the current data.\n\nBackup contains ${backup.matches.length + backup.deletedMatches.length} matches, ${backup.decks.length} decks, ${backup.notebooks.length} notebooks, and ${backup.replays.length + backup.deletedReplays.length} replay records. Replay video files are not copied by this app-data backup.`
  };
  const warning = mainWindow ? await dialog.showMessageBox(mainWindow, messageBoxOptions) : await dialog.showMessageBox(messageBoxOptions);
  if (warning.response !== 0) {
    return null;
  }

  let safetyPath = "";
  await runRiftLiteDataRestore(async () => {
    // Capture/data maintenance and the account-cloud restore fence are both
    // held before this safety snapshot is taken. The snapshot therefore
    // cannot omit a just-finalized match which the following restore replaces.
    const safetyBackup = await store.exportBackupData({ includeRecycleBin: true });
    safetyPath = join(backupDirectory(), `RiftLite Pre-Restore Backup ${backupTimestamp()}.${RIFTLITE_BACKUP_EXTENSION}`);
    await writeBackupFile(safetyPath, safetyBackup);
    await store.restoreBackupData(backup);
  });
  return backupSummary(backup, filePath, safetyPath);
}

async function exportMatchHistoryCsv(payload: MatchHistoryCsvExportPayload): Promise<string> {
  const rows = Array.isArray(payload.matches) ? payload.matches : [];
  const label = safeFileComponent(payload.label || (payload.scope === "hub" ? "private-hub-match-history" : "personal-match-history"), "match-history");
  const defaultPath = join(app.getPath("documents"), `RiftLite-${label}-${new Date().toISOString().slice(0, 10)}.csv`);
  const options: SaveDialogOptions = {
    title: payload.scope === "hub" ? "Export private hub match history" : "Export personal match history",
    defaultPath,
    filters: [{ name: "CSV", extensions: ["csv"] }]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return "";
  }
  await writeFile(result.filePath, matchHistoryCsv(rows, payload.scope), "utf8");
  return result.filePath;
}

function matchHistoryCsv(matches: Array<MatchDraft | CommunityMatch>, scope: "personal" | "hub"): string {
  const headers = [
    "id",
    "scope",
    "source",
    "platform",
    "result",
    "match_score",
    "format",
    "captured_at",
    "player",
    "opponent",
    "my_legend",
    "opponent_legend",
    "seat",
    "my_battlefield",
    "opponent_battlefield",
    "deck_name",
    "deck_source_url",
    "deck_source_key",
    "flags",
    "notes",
    "testing_session_id",
    "testing_session_label",
    "games_json"
  ];
  const lines = [headers.join(",")];
  for (const match of matches) {
    const row = exportMatchRow(match, scope);
    lines.push(headers.map((header) => csvCell(row[header] ?? "")).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function exportMatchRow(match: MatchDraft | CommunityMatch, scope: "personal" | "hub"): Record<string, string> {
  const isCommunity = "gamesJson" in match;
  const games = isCommunity
    ? match.gamesJson
    : JSON.stringify(match.games.map((game) => ({
      gameNumber: game.gameNumber,
      result: game.result,
      myScore: game.myPoints,
      opponentScore: game.oppPoints,
      wentFirst: game.wentFirst,
      myBattlefield: game.myBattlefield,
      opponentBattlefield: game.oppBattlefield,
      extraBattlefields: game.extraBattlefields ?? []
    })));
  return {
    id: match.id,
    scope,
    source: isCommunity ? match.scope : match.source ?? "capture",
    platform: isCommunity ? match.scope : match.platform,
    result: match.result,
    match_score: match.score,
    format: match.format,
    captured_at: isCommunity ? match.date : match.capturedAt,
    player: isCommunity ? match.username : match.myName,
    opponent: match.opponentName,
    my_legend: match.myChampion,
    opponent_legend: match.opponentChampion,
    seat: isCommunity ? match.wentFirst : (match.games[0]?.wentFirst ?? ""),
    my_battlefield: match.myBattlefield,
    opponent_battlefield: match.opponentBattlefield,
    deck_name: match.deckName,
    deck_source_url: match.deckSourceUrl ?? "",
    deck_source_key: match.deckSourceKey ?? "",
    flags: match.flags,
    notes: isCommunity ? "" : match.notes,
    testing_session_id: isCommunity ? "" : match.testingSessionId ?? "",
    testing_session_label: isCommunity ? "" : match.testingSessionLabel ?? "",
    games_json: games
  };
}

function csvCell(value: string): string {
  const text = String(value ?? "");
  const safeText = /^[=+\-@\t\r]/.test(text.trimStart()) ? `'${text}` : text;
  return /[",\r\n]/.test(safeText) ? `"${safeText.replace(/"/g, "\"\"")}"` : safeText;
}

type RecoveredReplayVideoProbe = {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  hasAudio: boolean;
};

async function probeRecoveredReplayVideo(filePath: string): Promise<RecoveredReplayVideoProbe> {
  const fallback: RecoveredReplayVideoProbe = {
    durationMs: 0,
    width: 1920,
    height: 1080,
    fps: 24,
    codec: replayMediaMimeType(filePath) === "video/mp4" ? "H.264 MP4" : "VP8 WebM",
    hasAudio: false
  };
  const ffmpegPath = replayVideoFfmpegPath();
  if (!ffmpegPath || !(await pathExists(ffmpegPath))) return fallback;
  let output = "";
  try {
    await execFileAsync(ffmpegPath, ["-hide_banner", "-i", filePath], {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    output = error && typeof error === "object"
      ? `${String((error as { stdout?: unknown }).stdout ?? "")}\n${String((error as { stderr?: unknown }).stderr ?? "")}`
      : String(error ?? "");
  }
  let durationMs = replayMediaDurationMsFromFfmpegOutput(output);
  if (!durationMs) {
    try {
      const scanned = await execFileAsync(ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-progress",
        "pipe:2",
        "-nostats",
        "-i",
        filePath,
        "-map",
        "0:v:0",
        "-c",
        "copy",
        "-f",
        "null",
        "-"
      ], {
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024
      });
      const scanOutput = `${String(scanned.stdout ?? "")}\n${String(scanned.stderr ?? "")}`;
      durationMs = replayMediaDurationMsFromFfmpegOutput(scanOutput);
    } catch (error) {
      const scanOutput = error && typeof error === "object"
        ? `${String((error as { stdout?: unknown }).stdout ?? "")}\n${String((error as { stderr?: unknown }).stderr ?? "")}`
        : String(error ?? "");
      durationMs = replayMediaDurationMsFromFfmpegOutput(scanOutput);
    }
  }
  const videoMatch = output.match(/Video:\s*([^,\n]+).*?([1-9]\d{2,5})x([1-9]\d{2,5})/i);
  const fpsMatch = output.match(/(?:,|\s)(\d+(?:\.\d+)?)\s*fps(?:,|\s)/i);
  return {
    durationMs: Number.isFinite(durationMs) ? durationMs : 0,
    width: Number(videoMatch?.[2]) || fallback.width,
    height: Number(videoMatch?.[3]) || fallback.height,
    fps: Math.max(1, Math.round(Number(fpsMatch?.[1]) || fallback.fps)),
    codec: videoMatch?.[1]?.trim() || fallback.codec,
    hasAudio: /Audio:\s*[^\n]+/i.test(output)
  };
}

async function importReplayMediaFromPath(sourcePath: string): Promise<ReplayRecord> {
  if (!isReplayMediaFilename(sourcePath)) {
    throw new Error("That file is not a supported WebM or MP4 replay recording.");
  }
  const sourceStats = await stat(sourcePath);
  if (!sourceStats.isFile() || sourceStats.size <= 0) {
    throw new Error("That replay recording is empty.");
  }

  const replayId = randomUUID();
  const settings = await store.getSettings();
  let importedPath = resolve(sourcePath);
  let copiedIntoStorage = false;
  if (!await replayVideoPathAllowed(importedPath)) {
    const directory = join(replayVideoImportDirectory(settings), safeFileComponent(replayId, "replay"));
    await mkdir(directory, { recursive: true });
    importedPath = join(directory, basename(sourcePath));
    await copyFile(sourcePath, importedPath);
    copiedIntoStorage = true;
  }

  const mimeType = replayMediaMimeType(importedPath);
  const probe = await probeRecoveredReplayVideo(importedPath);
  const containerFinalized = await makeReplayVideoSeekable(importedPath, mimeType).catch(() => false);
  const importedStats = await stat(importedPath);
  const readable = await validateReplayVideoReadable(importedPath, importedStats.size, mimeType).catch(() => false);
  if (!readable) {
    if (copiedIntoStorage) {
      await unlink(importedPath).catch(() => undefined);
      await unlink(replayVideoSeekableMarkerPath(importedPath)).catch(() => undefined);
    }
    throw new Error("That recording does not contain readable replay video.");
  }
  const platform = replayMediaPlatform(basename(sourcePath));
  const fallbackDate = sourceStats.birthtimeMs > 0 ? sourceStats.birthtime : sourceStats.mtime;
  const startedAt = replayMediaCapturedAt(basename(sourcePath), fallbackDate);
  const endedAt = new Date(new Date(startedAt).getTime() + Math.max(0, probe.durationMs)).toISOString();
  const video: ReplayVideoAsset = {
    path: importedPath,
    url: pathToFileURL(importedPath).href,
    filename: basename(importedPath),
    directory: dirname(importedPath),
    mimeType,
    source: "riftreplay",
    platform,
    startedAt,
    endedAt,
    durationMs: probe.durationMs,
    sizeBytes: importedStats.size,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    captureIntervalMs: Math.round(1000 / Math.max(1, probe.fps)),
    bitrateKbps: actualReplayBitrateKbps(importedStats.size, probe.durationMs) ?? 0,
    actualBitrateKbps: actualReplayBitrateKbps(importedStats.size, probe.durationMs),
    codec: probe.codec,
    quality: probe.width >= 1800 ? "sharp" : "balanced",
    hasAudio: probe.hasAudio,
    containerFinalized
  };

  const replays = await store.getReplays();
  const matchingReplayId = matchingMissingReplayIdForMedia(replays, platform, startedAt, endedAt, probe.durationMs);
  const matchingMissingReplay = replays.find((replay) => replay.id === matchingReplayId);
  if (matchingMissingReplay) {
    return store.saveReplay({
      ...matchingMissingReplay,
      video,
      importedAt: new Date().toISOString(),
      importedFrom: sourcePath
    });
  }

  const title = `Recovered ${platform === "atlas" ? "Atlas" : "TCGA"} recording`;
  return store.saveReplay({
    id: replayId,
    matchId: replayId,
    platform,
    capturedAt: startedAt,
    schemaVersion: 4,
    title,
    players: { me: "", opponent: "" },
    events: [],
    video,
    importedAt: new Date().toISOString(),
    importedFrom: sourcePath,
    search: {
      title,
      platform,
      players: [],
      legends: [],
      battlefields: [],
      format: "",
      result: "",
      score: "",
      capturedAt: startedAt,
      deckName: ""
    }
  });
}

async function replayImportFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => join(directory, entry.name));
  const videoDirectory = entries.find((entry) => entry.isDirectory() && entry.name.toLowerCase() === "video");
  if (videoDirectory) {
    const videoEntries = await readdir(join(directory, videoDirectory.name), { withFileTypes: true });
    files.push(...videoEntries.filter((entry) => entry.isFile()).map((entry) => join(directory, videoDirectory.name, entry.name)));
  }
  return files.filter((file) => file.toLowerCase().endsWith(".riftreplay") || isReplayMediaFilename(file)).slice(0, 500);
}

async function importReplayBundle(): Promise<ReplayRecord | null> {
  const directory = replayBundleDirectory(await store.getSettings());
  await mkdir(directory, { recursive: true });
  const options: OpenDialogOptions = {
    title: "Import RiftLite replay",
    defaultPath: directory,
    filters: [
      { name: "RiftLite Replay or Recording", extensions: ["riftreplay", "webm", "mp4"] },
      { name: "RiftLite Replay", extensions: ["riftreplay"] },
      { name: "Replay Recording", extensions: ["webm", "mp4"] }
    ],
    properties: ["openFile"]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  return isReplayMediaFilename(result.filePaths[0])
    ? importReplayMediaFromPath(result.filePaths[0])
    : importReplayBundleFromPath(result.filePaths[0]);
}

async function importReplayFolder(): Promise<ReplayRecord[]> {
  const directory = replayBundleDirectory(await store.getSettings());
  await mkdir(directory, { recursive: true });
  const options: OpenDialogOptions = {
    title: "Choose folder with RiftLite replays",
    defaultPath: directory,
    properties: ["openDirectory"]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return [];
  }
  const files = await replayImportFiles(result.filePaths[0]);
  const knownMediaPaths = new Set((await store.getReplays())
    .map((replay) => replay.video?.path?.trim())
    .filter((path): path is string => Boolean(path))
    .map((path) => resolve(path).toLowerCase()));
  const imported: ReplayRecord[] = [];
  const failures: string[] = [];
  for (const file of files) {
    try {
      if (isReplayMediaFilename(file)) {
        if (knownMediaPaths.has(resolve(file).toLowerCase())) continue;
        imported.push(await importReplayMediaFromPath(file));
      } else {
        imported.push(await importReplayBundleFromPath(file));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${basename(file)}: ${message}`);
    }
  }
  if (!imported.length && failures.length) {
    throw new Error(`No replays imported. ${failures[0]}`);
  }
  return imported;
}

function toggleTrueFullscreen(): boolean {
  if (!mainWindow) {
    return false;
  }
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  mainWindow.setMenuBarVisibility(false);
  return next;
}

function installFullscreenShortcut(webContents: WebContents): void {
  webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11" && !input.alt && !input.control && !input.meta && !input.shift) {
      event.preventDefault();
      toggleTrueFullscreen();
    }
  });
}

function getMainWindowBounds(): { width: number; height: number; minWidth: number; minHeight: number } {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const usableWidth = Math.max(900, workAreaSize.width - 16);
  const usableHeight = Math.max(640, workAreaSize.height - 16);
  const minWidth = Math.min(1280, usableWidth);
  const minHeight = Math.min(780, usableHeight);
  const preferredWidth = Math.max(1560, Math.floor(workAreaSize.width * 0.9));
  const preferredHeight = Math.max(960, Math.floor(workAreaSize.height * 0.9));

  return {
    width: Math.max(minWidth, Math.min(1720, preferredWidth, usableWidth)),
    height: Math.max(minHeight, Math.min(1000, preferredHeight, usableHeight)),
    minWidth,
    minHeight
  };
}

async function captureAtlasSmokeDiagnostics(webContents: WebContents): Promise<void> {
  if (webContents.isDestroyed() || !UI_SNAPSHOT_PATH) {
    return;
  }
  const image = await webContents.capturePage();
  const size = image.getSize();
  const bitmap = image.toBitmap();
  let sampledPixels = 0;
  let luminanceTotal = 0;
  let luminanceSquaredTotal = 0;
  let brightPixels = 0;
  const pixelStride = Math.max(1, Math.floor((size.width * size.height) / 120_000));
  for (let pixelIndex = 0; pixelIndex < size.width * size.height; pixelIndex += pixelStride) {
    const offset = pixelIndex * 4;
    const blue = bitmap[offset] ?? 0;
    const green = bitmap[offset + 1] ?? 0;
    const red = bitmap[offset + 2] ?? 0;
    const luminance = (red * 0.2126) + (green * 0.7152) + (blue * 0.0722);
    sampledPixels += 1;
    luminanceTotal += luminance;
    luminanceSquaredTotal += luminance * luminance;
    if (luminance >= 40) {
      brightPixels += 1;
    }
  }
  const meanLuminance = sampledPixels ? luminanceTotal / sampledPixels : 0;
  const variance = sampledPixels
    ? Math.max(0, (luminanceSquaredTotal / sampledPixels) - (meanLuminance * meanLuminance))
    : 0;
  const dom = await webContents.executeJavaScript(`(() => {
    const elementDetails = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        id: element.id,
        classes: String(element.className || "").slice(0, 300),
        text: String(element.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 300),
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        style: {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          color: style.color,
          backgroundColor: style.backgroundColor,
          transform: style.transform
        }
      };
    };
    const allElements = Array.from(document.querySelectorAll("body *"));
    const lobbyElements = allElements
      .filter((element) => /^PLAY\\.RIFTATLAS\\s+Lobby/.test(String(element.innerText || "").replace(/\\s+/g, " ").trim()))
      .sort((left, right) => {
        const leftBounds = left.getBoundingClientRect();
        const rightBounds = right.getBoundingClientRect();
        return (leftBounds.width * leftBounds.height) - (rightBounds.width * rightBounds.height);
      })
      .slice(0, 10);
    const pointStack = (x, y) => document.elementsFromPoint(x, y).slice(0, 12).map(elementDetails).filter(Boolean);
    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      visibilityState: document.visibilityState,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      body: elementDetails(document.body),
      bodyChildren: Array.from(document.body?.children || []).map(elementDetails).filter(Boolean),
      lobbyElements: lobbyElements.map(elementDetails).filter(Boolean),
      headerPointStack: pointStack(innerWidth / 2, Math.min(80, innerHeight / 4)),
      centerPointStack: pointStack(innerWidth / 2, innerHeight / 2),
      interactiveCount: document.querySelectorAll("button, input, select, textarea, [role='button'], [role='dialog']").length,
      text: String(document.body?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 2_000)
    };
  })()`, true);
  const parsedSnapshotPath = resolve(UI_SNAPSHOT_PATH);
  const extensionIndex = parsedSnapshotPath.lastIndexOf(".");
  const basePath = extensionIndex > parsedSnapshotPath.lastIndexOf("\\")
    ? parsedSnapshotPath.slice(0, extensionIndex)
    : parsedSnapshotPath;
  await Promise.all([
    writeFile(`${basePath}-atlas-guest.png`, image.toPNG()),
    writeFile(`${basePath}-atlas-diagnostics.json`, JSON.stringify({
      capturedAt: new Date().toISOString(),
      image: {
        width: size.width,
        height: size.height,
        sampledPixels,
        meanLuminance,
        standardDeviation: Math.sqrt(variance),
        brightPixelRatio: sampledPixels ? brightPixels / sampledPixels : 0
      },
      dom
    }, null, 2), "utf8")
  ]);
}

function handleAtlasShellStatusEvent(sender: WebContents, event: CaptureEvent): void {
  if (event.platform !== "atlas" || event.kind !== "debug") {
    return;
  }
  const reason = typeof event.payload.reason === "string" ? event.payload.reason : "";
  const senderUrl = sender.isDestroyed() ? "" : sender.getURL();
  if (platformFromUrl(senderUrl) !== "atlas") {
    return;
  }
  if (reason === "atlas-app-shell-ready") {
    atlasEmptyShellMainRecovery.markAtlasShellReady();
    return;
  }
  if (reason !== "atlas-app-shell-empty") {
    return;
  }

  const decision = atlasEmptyShellMainRecovery.considerEmptyShell(
    sender.id,
    senderUrl,
    capture.hasActiveCaptureSession("atlas")
  );
  if (decision.action !== "schedule-reload") {
    return;
  }

  const { navigationKey, recoveryKey } = decision;
  setTimeout(() => {
    const currentAtlasGuest = gameWebContentsByPlatform.get("atlas");
    const senderStillCurrent = !sender.isDestroyed() &&
      currentAtlasGuest?.id === sender.id &&
      platformFromUrl(sender.getURL()) === "atlas";
    if (capture.hasActiveCaptureSession("atlas") || !senderStillCurrent) {
      atlasEmptyShellMainRecovery.abandonScheduledReload(recoveryKey);
      return;
    }
    if (!atlasEmptyShellMainRecovery.commitScheduledReload(recoveryKey, sender.id, navigationKey)) {
      return;
    }

    const capturedAt = new Date().toISOString();
    const url = diagnosticPageUrl(sender.getURL());
    void capture.handleEvent({
      id: `atlas-app-shell-main-reload-${Date.now()}-${randomUUID()}`,
      platform: "atlas",
      kind: "debug",
      capturedAt,
      url,
      payload: {
        reason: "atlas-app-shell-main-reload",
        navigationKey,
        recoveryKey,
        delayMs: ATLAS_EMPTY_SHELL_MAIN_RELOAD_DELAY_MS
      }
    });
    void logStartupIssue("Atlas empty shell main fail-safe reload", JSON.stringify({
      navigationKey,
      recoveryKey,
      url
    }));
    try {
      sender.reloadIgnoringCache();
    } catch (error) {
      void logStartupIssue("Atlas empty shell main fail-safe reload failed", error);
    }
  }, ATLAS_EMPTY_SHELL_MAIN_RELOAD_DELAY_MS);
}

async function createWindow(): Promise<void> {
  const iconPath = assetPath("riftlite-app.ico");
  const icon = nativeImage.createFromPath(iconPath);
  const bounds = getMainWindowBounds();
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: bounds.minWidth,
    minHeight: bounds.minHeight,
    title: RIFTLITE_BUILD_IDENTITY.appName,
    icon,
    backgroundColor: "#0c101a",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: preloadPath("appPreload"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  const createdMainWindow = mainWindow;
  createdMainWindow.once("closed", () => {
    if (mainWindow === createdMainWindow) {
      mainWindow = null;
    }
  });
  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);
  installFullscreenShortcut(mainWindow.webContents);
  configureDisplayMediaCapture();

  const showMainWindow = () => {
    mainWindow?.show();
  };
  mainWindow.once("ready-to-show", showMainWindow);
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      showMainWindow();
    }
  }, 5000);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(?:https?|mailto|discord):/i.test(url)) {
      void openExternalResource(url).catch(() => undefined);
    }
    return { action: "deny" };
  });
  const restrictAppNavigation = (event: Electron.Event, url: string) => {
    if (isTrustedAppPageUrl(url)) {
      return;
    }
    event.preventDefault();
    if (/^(?:https?|mailto|discord):/i.test(url)) {
      void openExternalResource(url).catch(() => undefined);
    }
  };
  mainWindow.webContents.on("will-navigate", restrictAppNavigation);
  mainWindow.webContents.on("will-redirect", restrictAppNavigation);
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    void logStartupIssue("renderer did-fail-load", `${errorCode} ${errorDescription} ${validatedURL}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    void logStartupIssue("renderer process gone", JSON.stringify(details));
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPathValue, error) => {
    void logStartupIssue("app preload error", `${preloadPathValue}\n${formatStartupError(error)}`);
  });
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    const policy = embeddedWebviewPolicy(params.src ?? "", params.partition ?? "", isDev);
    if (!policy) {
      event.preventDefault();
      return;
    }
    webPreferences.preload = policy.kind === "game" ? preloadPath("gamePreload") : undefined;
    webPreferences.additionalArguments = policy.kind === "game"
      ? [gameWebviewPlatformArgument(policy.platform)]
      : [];
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    embeddedWebviewPolicyBySession.set(electronSession.fromPartition(params.partition), policy);
  });
  mainWindow.webContents.on("did-attach-webview", (_event, webContents) => {
    const policy = embeddedWebviewPolicyBySession.get(webContents.session);
    const currentUrl = webContents.getURL();
    if (!policy || (currentUrl && currentUrl !== "about:blank" && !isAllowedEmbeddedNavigation(policy, currentUrl))) {
      webContents.close();
      return;
    }
    if (
      policy.kind === "replay" &&
      webContents.session === electronSession.fromPartition(RIFTLITE_REPLAY_PARTITION)
    ) {
      riftLiteReplayWebContents = webContents;
      secureRiftLiteReplayWebContents(webContents);
      installFullscreenShortcut(webContents);
      webContents.once("destroyed", () => {
        if (riftLiteReplayWebContents?.id === webContents.id) {
          riftLiteReplayWebContents = null;
        }
      });
      return;
    }
    if (policy.kind === "home-video") {
      secureHomeMediaWebContents(webContents, policy);
      installFullscreenShortcut(webContents);
      return;
    }
    if (policy.kind !== "game") {
      webContents.close();
      return;
    }
    gameWebContentsByPlatform.set(policy.platform, webContents);
    secureGameWebContents(webContents, policy);
    atlasEmptyShellMainRecovery.beginNavigation(webContents.id, webContents.getURL());
    maybeInstallRawCaptureWebSocketTap(webContents);
    if (policy.platform === "tcga" && tcgaWebReplayProductAccountUid) {
      tcgaWebReplayCaptureService?.beginDocument(webContents.id);
    }
    if (tcgaReplayResearchCapture?.getStatus().active || tcgaWebReplayProductAccountUid) {
      installTcgaReplayResearchTap(webContents);
    }
    installFullscreenShortcut(webContents);
    let atlasCardRenderingGeneration = 0;
    let atlasCardRenderingCssKey = "";
    let atlasCardRenderingPendingGeneration: number | null = null;
    const invalidateAtlasCardRendering = () => {
      atlasCardRenderingGeneration += 1;
      atlasCardRenderingCssKey = "";
      atlasCardRenderingPendingGeneration = null;
    };
    const installAtlasCardRendering = () => {
      if (webContents.isDestroyed()) {
        return;
      }
      const cardRenderingCss = atlasCardRenderingCssForUrl(webContents.getURL());
      const generation = atlasCardRenderingGeneration;
      if (!cardRenderingCss || atlasCardRenderingCssKey || atlasCardRenderingPendingGeneration === generation) {
        return;
      }
      atlasCardRenderingPendingGeneration = generation;
      void webContents.insertCSS(cardRenderingCss).then((cssKey) => {
        if (
          webContents.isDestroyed() ||
          generation !== atlasCardRenderingGeneration ||
          !atlasCardRenderingCssForUrl(webContents.getURL())
        ) {
          if (!webContents.isDestroyed()) {
            void webContents.removeInsertedCSS(cssKey).catch(() => undefined);
          }
          return;
        }
        atlasCardRenderingCssKey = cssKey;
      }).catch((error) => {
        void logStartupIssue("Atlas card rendering CSS failed", error);
      }).finally(() => {
        if (atlasCardRenderingPendingGeneration === generation) {
          atlasCardRenderingPendingGeneration = null;
        }
      });
    };
    const reportGuestLifecycle = (
      reason: string,
      payload: Record<string, unknown> = {},
      candidateUrl = webContents.getURL()
    ) => {
      const url = diagnosticPageUrl(candidateUrl || webContents.getURL());
      const platform = platformFromUrl(url);
      if (!platform) {
        return;
      }
      void capture.handleEvent({
        id: `${reason}-${Date.now()}-${randomUUID()}`,
        platform,
        kind: "debug",
        capturedAt: new Date().toISOString(),
        url,
        payload: { reason, ...payload, url }
      });
    };
    const notifyGuestFailure = (
      reason: "load-failed" | "render-process-gone" | "unresponsive",
      message: string,
      canAutoRemount: boolean,
      candidateUrl = webContents.getURL()
    ) => {
      const platform = platformFromUrl(candidateUrl || webContents.getURL()) ?? policy.platform;
      const window = mainWindow;
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
        return;
      }
      window.webContents.send("game-webview:failure", { platform, reason, message, canAutoRemount });
    };
    const refreshGuestContext = () => {
      rememberGameWebContents(webContents);
      maybeInstallRawCaptureWebSocketTap(webContents);
      if (tcgaReplayResearchCapture?.getStatus().active || tcgaWebReplayProductAccountUid) {
        installTcgaReplayResearchTap(webContents);
      }
    };
    webContents.on("did-start-navigation", (_navigationEvent, url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        if (policy.platform === "tcga" && tcgaWebReplayProductAccountUid) {
          tcgaWebReplayCaptureService?.beginDocument(webContents.id);
        }
        invalidateAtlasCardRendering();
        atlasEmptyShellMainRecovery.beginNavigation(webContents.id, url);
        reportGuestLifecycle("guest-main-navigation-start", {}, url);
      }
    });
    webContents.on("did-finish-load", () => {
      reportGuestLifecycle("guest-main-load-finished");
      installAtlasCardRendering();
      if (
        IS_PACKAGED_SMOKE_TEST &&
        UI_SNAPSHOT_PATH &&
        platformFromUrl(webContents.getURL()) === "atlas" &&
        !atlasSmokeDiagnosticsTaken
      ) {
        atlasSmokeDiagnosticsTaken = true;
        setTimeout(() => {
          void captureAtlasSmokeDiagnostics(webContents).catch((error) => {
            void logStartupIssue("Atlas smoke diagnostics failed", error);
          });
        }, 4_500);
      }
    });
    webContents.on("did-fail-load", (_loadEvent, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }
      const payload = { errorCode, errorDescription };
      reportGuestLifecycle("guest-main-load-failed", payload, validatedURL);
      void logStartupIssue("guest main load failed", JSON.stringify({ ...payload, url: diagnosticPageUrl(validatedURL) }));
      if (errorCode !== -3) {
        notifyGuestFailure("load-failed", `The embedded game page failed to load (${errorDescription || errorCode}).`, true, validatedURL);
      }
    });
    webContents.on("did-navigate", refreshGuestContext);
    webContents.on("did-navigate-in-page", refreshGuestContext);
    webContents.on("dom-ready", refreshGuestContext);
    webContents.once("destroyed", () => {
      invalidateAtlasCardRendering();
      rawCaptureIngressLimiter.forget(webContents.id);
      forgetGameWebContents(webContents);
      atlasEmptyShellMainRecovery.forgetGuest(webContents.id);
    });
    webContents.on("render-process-gone", (_goneEvent, details) => {
      const platform = platformFromUrl(webContents.getURL());
      const payload = {
        reason: "guest-render-process-gone",
        details,
        url: webContents.getURL()
      };
      void logStartupIssue("guest render process gone", JSON.stringify(payload));
      notifyGuestFailure("render-process-gone", "The embedded game page stopped unexpectedly.", true);
      if (platform) {
        void capture.handleEvent({
          id: `guest-render-process-gone-${Date.now()}`,
          platform,
          kind: "debug",
          capturedAt: new Date().toISOString(),
          url: webContents.getURL(),
          payload
        });
      }
    });
    webContents.on("unresponsive", () => {
      const platform = platformFromUrl(webContents.getURL());
      const payload = {
        reason: "guest-webview-unresponsive",
        url: webContents.getURL()
      };
      void logStartupIssue("guest webview unresponsive", JSON.stringify(payload));
      notifyGuestFailure("unresponsive", "The embedded game page is not responding.", false);
      if (platform) {
        void capture.handleEvent({
          id: `guest-webview-unresponsive-${Date.now()}`,
          platform,
          kind: "debug",
          capturedAt: new Date().toISOString(),
          url: webContents.getURL(),
          payload
        });
      }
    });
    webContents.on("responsive", () => {
      const platform = platformFromUrl(webContents.getURL());
      if (platform) {
        void capture.handleEvent({
          id: `guest-webview-responsive-${Date.now()}`,
          platform,
          kind: "debug",
          capturedAt: new Date().toISOString(),
          url: webContents.getURL(),
          payload: { reason: "guest-webview-responsive" }
        });
      }
    });
    webContents.on("console-message", (_consoleEvent, level, message, line, sourceId) => {
      if (level >= 2 || /riftlite|preload|capture/i.test(message)) {
        reportGuestLifecycle("guest-console", {
          level,
          message: message.slice(0, 2_000),
          line,
          sourceId: diagnosticPageUrl(sourceId)
        });
      }
    });
    webContents.on("preload-error", (_preloadEvent, preloadPathValue, error) => {
      reportGuestLifecycle("preload-error", {
        preloadFile: preloadPathValue.split(/[\\/]/).at(-1) ?? "",
        message: error.message.slice(0, 2_000),
        stack: (error.stack ?? "").slice(0, 4_000)
      });
      void logStartupIssue("guest preload error", `${preloadPathValue}\n${formatStartupError(error)}`);
    });
  });

  if (isDev) {
    await mainWindow.loadURL("http://127.0.0.1:5173");
    if (process.env.RIFTLITE_OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    await mainWindow.loadFile(join(__dirname, "..", "renderer", "index.html"));
  }
  // Give the isolated renderer preload and React navigation listener time to attach
  // before delivering an initial protocol URL. Second-instance links deliver immediately.
  setTimeout(flushPendingAppNavigation, 750);
}

function protocolNavigationFromArgs(argv: string[]): AppNavigationRequest | null {
  const acceptedPrefixes = [`${RIFTLITE_BUILD_IDENTITY.protocol}://`, "riftlite://"];
  const raw = argv.find((item) => acceptedPrefixes.some((prefix) => item.toLowerCase().startsWith(prefix)));
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.hostname === "hubs") {
      return { view: "hubs", hubId: decodeURIComponent(url.pathname.replace(/^\/+/, "")) };
    }
    if (url.hostname === "account") return { view: "account" };
  } catch {
    return null;
  }
  return null;
}

function queueAppNavigation(request: AppNavigationRequest | null): void {
  if (!request) return;
  pendingAppNavigation = request;
  flushPendingAppNavigation();
}

function flushPendingAppNavigation(): void {
  if (!pendingAppNavigation || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return;
  mainWindow.webContents.send("app:navigate", pendingAppNavigation);
  pendingAppNavigation = null;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function openDeckTrackerWindow(): Promise<void> {
  if (deckTrackerWindow && !deckTrackerWindow.isDestroyed()) {
    if (deckTrackerWindow.isMinimized()) {
      deckTrackerWindow.restore();
    }
    deckTrackerWindow.focus();
    return;
  }

  const icon = nativeImage.createFromPath(assetPath("riftlite-app.ico"));
  deckTrackerWindow = new BrowserWindow({
    width: 340,
    height: 520,
    minWidth: 280,
    minHeight: 300,
    title: `${RIFTLITE_BUILD_IDENTITY.appName} Deck Tracker`,
    icon,
    backgroundColor: "#07101d",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: preloadPath("appPreload"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  deckTrackerWindow.setMenu(null);
  deckTrackerWindow.setMenuBarVisibility(false);
  deckTrackerWindow.once("ready-to-show", () => deckTrackerWindow?.show());
  deckTrackerWindow.on("closed", () => {
    deckTrackerWindow = null;
  });
  deckTrackerWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(?:https?|mailto|discord):/i.test(url)) {
      void openExternalResource(url).catch(() => undefined);
    }
    return { action: "deny" };
  });
  const restrictDeckTrackerNavigation = (event: Electron.Event, url: string) => {
    if (isTrustedAppPageUrl(url)) {
      return;
    }
    event.preventDefault();
    if (/^(?:https?|mailto|discord):/i.test(url)) {
      void openExternalResource(url).catch(() => undefined);
    }
  };
  deckTrackerWindow.webContents.on("will-navigate", restrictDeckTrackerNavigation);
  deckTrackerWindow.webContents.on("will-redirect", restrictDeckTrackerNavigation);
  deckTrackerWindow.webContents.on("render-process-gone", (_event, details) => {
    void logStartupIssue("deck tracker renderer process gone", JSON.stringify(details));
  });
  deckTrackerWindow.webContents.on("preload-error", (_event, preloadPathValue, error) => {
    void logStartupIssue("deck tracker preload error", `${preloadPathValue}\n${formatStartupError(error)}`);
  });

  if (isDev) {
    await deckTrackerWindow.loadURL("http://127.0.0.1:5173/?deckTrackerPopout=1");
  } else {
    await deckTrackerWindow.loadFile(join(__dirname, "..", "renderer", "index.html"), {
      query: { deckTrackerPopout: "1" }
    });
  }
}

function registerIpc(): void {
  handleTrustedAppIpc("settings:get", (event) => {
    assertTrustedAppIpcSender(event);
    return store.getSettings();
  });
  handleTrustedAppIpc("settings:save", async (event, patch: Partial<UserSettings>) => {
    assertTrustedAppIpcSender(event);
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new Error("Settings patch is invalid.");
    }
    const replayDirectoryChanged = Object.prototype.hasOwnProperty.call(patch, "replayDirectory");
    const releaseCaptureMaintenance = replayDirectoryChanged
      ? await capture.beginDataMaintenance()
      : null;
    try {
      const accountIdentityChanged =
        Object.prototype.hasOwnProperty.call(patch, "accountUid") ||
        Object.prototype.hasOwnProperty.call(patch, "firebaseUid") ||
        Object.prototype.hasOwnProperty.call(patch, "firebaseRefreshToken");
      if (accountIdentityChanged) {
        syncService.invalidateLinkedAccountAuth();
        await clearRiftLiteReplayEmbedCookies().catch(() => undefined);
      }
      const saved = await store.saveSettings(patch);
      if (
        accountIdentityChanged ||
        Object.prototype.hasOwnProperty.call(patch, "rawCapture") ||
        replayDirectoryChanged
      ) {
        await configureTcgaWebReplayProductCapture();
      }
      if (accountIdentityChanged) {
        await clearRiftLiteReplayEmbedCookies().catch(() => undefined);
      }
      if (
        Object.prototype.hasOwnProperty.call(patch, "screenshotHotkey") ||
        Object.prototype.hasOwnProperty.call(patch, "screenshotHotkeyEnabled")
      ) {
        await configureScreenshotHotkey();
      }
      if (
        Object.prototype.hasOwnProperty.call(patch, "replayVideoEnabled") ||
        Object.prototype.hasOwnProperty.call(patch, "replayShadowClipEnabled") ||
        Object.prototype.hasOwnProperty.call(patch, "replayShadowClipHotkey") ||
        Object.prototype.hasOwnProperty.call(patch, "replayShadowClipHotkeyEnabled") ||
        Object.prototype.hasOwnProperty.call(patch, "replayQuickFlagHotkey") ||
        Object.prototype.hasOwnProperty.call(patch, "replayQuickFlagHotkeyEnabled")
      ) {
        await configureReplayHotkeys();
      }
      if (replayDirectoryChanged) {
        replayFrameDirectoryCache = null;
      }
      if (RIFTREPLAY_CAPTURE_FEATURE_ENABLED && Object.prototype.hasOwnProperty.call(patch, "rawCapture")) {
        void uploadPendingRawCapturesWithAccountRefresh().catch((error) => {
          void logStartupIssue("raw capture pending upload after settings save failed", error);
        });
      }
      queueAccountCloudSync("Settings changed");
      return saved;
    } finally {
      releaseCaptureMaintenance?.();
    }
  });
  handleTrustedAppIpc("settings:raw-capture:update", async (_event, patch: Partial<UserSettings["rawCapture"]>) => {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new Error("Web Replay settings patch is invalid.");
    }
    const saved = await store.updateSettings((current) => ({
      rawCapture: { ...current.rawCapture, ...patch }
    }));
    await configureTcgaWebReplayProductCapture();
    if (RIFTREPLAY_CAPTURE_FEATURE_ENABLED) {
      void uploadPendingRawCapturesWithAccountRefresh().catch((error) => {
        void logStartupIssue("raw capture pending upload after atomic settings update failed", error);
      });
    }
    queueAccountCloudSync("Web Replay settings changed");
    return saved;
  });
  handleTrustedAppIpc("settings:web-replay-discord-hub:set", async (_event, hubId: string, selected: boolean) => {
    const normalizedHubId = typeof hubId === "string" ? hubId.trim() : "";
    if (!normalizedHubId || normalizedHubId.length > 256) {
      throw new Error("Private hub ID is invalid.");
    }
    const saved = await store.updateSettings((current) => ({
      rawCapture: rawCaptureSettingsForDiscordHubSelection(current, normalizedHubId, Boolean(selected))
    }));
    await configureTcgaWebReplayProductCapture();
    if (RIFTREPLAY_CAPTURE_FEATURE_ENABLED) {
      void uploadPendingRawCapturesWithAccountRefresh().catch((error) => {
        void logStartupIssue("raw capture pending upload after Discord destination update failed", error);
      });
    }
    queueAccountCloudSync("Web Replay Discord settings changed");
    return saved;
  });
  ipcMain.handle("capture:debug-enabled", async (event) => {
    if (!isTrustedAppIpcSender(event) && !trustedGameIpcPlatform(event)) {
      throw new Error("IPC request rejected: untrusted sender.");
    }
    return (await store.getSettings()).debugMode;
  });
  ipcMain.handle("capture:tcga-replay-research-active", (event) => {
    if (trustedGameIpcPlatform(event) !== "tcga") {
      throw new Error("IPC request rejected: untrusted TCGA sender.");
    }
    return tcgaReplayResearchCapture.getStatus().active;
  });
  handleTrustedAppIpc("capture:health:get", () => capture.getHealth());
  handleTrustedAppIpc("capture:platform-switch-status", () => capture.getGamePlatformSwitchStatus());
  handleTrustedAppIpc("capture:force-review", (_event, platform: GamePlatform) => capture.forceReview(platform));
  handleTrustedAppIpc("capture:dismiss-review", () => capture.dismissMatchReview());
  handleTrustedAppIpc("matches:get", () => store.getMatches());
  handleTrustedAppIpc("matches:deleted", () => store.getDeletedMatches());
  handleTrustedAppIpc("matches:save-draft", async (_event, draft: MatchDraft) => {
    const saved = await store.saveMatch(draft);
    queueAccountCloudSync("Match saved");
    return saved;
  });
  handleTrustedAppIpc("matches:confirm", async (_event, draft: MatchDraft) => {
    return confirmMatchLocalFirst(draft, {
      saveLocally: async (candidate) => {
        const saved = await capture.confirmMatch(candidate, {
          deferReplayFinalization: confirmedMatchSupportsBackgroundDelivery(candidate)
        });
        return saved.platform === "tcga"
          ? commitConfirmedTcgaReplayLocally(saved)
          : saved;
      },
      shouldDeliverInBackground: confirmedMatchSupportsBackgroundDelivery,
      queueBackgroundDelivery: queueConfirmedMatchDelivery,
      deliverBeforeResponse: async (saved) => {
        await capture.waitForReplayFinalization(saved.id);
        const latest = (await store.getMatches()).find((candidate) => candidate.id === saved.id) ?? saved;
        const synced = await capture.syncConfirmedMatch(latest);
        queueAccountCloudSync("Match saved");
        return synced;
      }
    });
  });
  handleTrustedAppIpc("matches:combine-preview", (_event, matchIds: string[]) => store.previewCombinedMatches(matchIds));
  handleTrustedAppIpc("matches:combine-save", async (_event, payload) => {
    const combined = await store.combineMatches(payload);
    const synced = await syncService.syncMatch(combined, { quiet: true }).catch(() => combined);
    queueAccountCloudSync("Match repair saved");
    return synced;
  });
  handleTrustedAppIpc("matches:combine-undo", async (_event, combinedMatchId: string) => {
    const restored = await syncService.undoCombinedMatch(combinedMatchId);
    queueAccountCloudSync("Match combination undone");
    return restored;
  });
  handleTrustedAppIpc("matches:delete", async (_event, id: string) => {
    await store.deleteMatch(id);
    capture.dismissMatchReview(id);
    queueAccountCloudSync("Match deleted");
  });
  handleTrustedAppIpc("matches:restore", async (_event, id: string) => {
    const restored = await store.restoreMatch(id);
    queueAccountCloudSync("Match restored");
    return restored;
  });
  handleTrustedAppIpc("matches:purge", async (_event, id: string) => {
    await store.purgeMatch(id);
    capture.dismissMatchReview(id);
    queueAccountCloudSync("Deleted match removed");
  });
  handleTrustedAppIpc("matches:export-csv", (_event, payload: MatchHistoryCsvExportPayload) => exportMatchHistoryCsv(payload));
  handleTrustedAppIpc("decks:get", () => deckService.getDecks());
  handleTrustedAppIpc("decks:import", async (_event, url: string) => {
    const deck = await deckService.importDeck(url);
    queueAccountCloudSync("Deck imported");
    return deck;
  });
  handleTrustedAppIpc("decks:import-text", async (_event, text: string) => {
    const deck = await deckService.importDeckText(text);
    queueAccountCloudSync("Deck imported");
    return deck;
  });
  handleTrustedAppIpc("decks:refresh", async (_event, id: string) => {
    const deck = await deckService.refreshDeck(id);
    queueAccountCloudSync("Deck refreshed");
    return deck;
  });
  handleTrustedAppIpc("decks:rename", async (_event, id: string, title: string) => {
    const deck = await deckService.renameDeck(id, title);
    queueAccountCloudSync("Deck renamed");
    return deck;
  });
  handleTrustedAppIpc("decks:delete", async (_event, id: string) => {
    await deckService.deleteDeck(id);
    queueAccountCloudSync("Deck deleted");
  });
  handleTrustedAppIpc("decks:set-active", async (_event, id: string) => {
    const settings = await deckService.setActiveDeck(id);
    queueAccountCloudSync("Active deck changed");
    return settings;
  });
  handleTrustedAppIpc("decks:notebook:get", (_event, deckId: string) => store.getDeckNotebook(deckId));
  handleTrustedAppIpc("decks:notebook:save", async (_event, deckId: string, notebook: DeckNotebook) => {
    const saved = await store.saveDeckNotebook(deckId, notebook);
    queueAccountCloudSync("Deck notebook saved");
    return saved;
  });
  handleTrustedAppIpc("decks:notebook:export", (_event, deckId: string) => exportDeckNotebook(deckId));
  handleTrustedAppIpc("decks:notebook:import", async () => {
    const notebook = await importDeckNotebook();
    if (notebook) {
      queueAccountCloudSync("Deck notebook imported");
    }
    return notebook;
  });
  handleTrustedAppIpc("decks:package:export", (_event, deckId: string, notebook?: DeckNotebook) => exportDeckPackage(deckId, notebook));
  handleTrustedAppIpc("decks:package:import", async () => {
    const imported = await importDeckPackage();
    if (imported) {
      queueAccountCloudSync("Deck package imported");
    }
    return imported;
  });
  handleTrustedAppIpc("decks:package:export-text", (_event, deckId: string, notebook?: DeckNotebook) => exportDeckPackageText(deckId, notebook));
  handleTrustedAppIpc("decks:package:import-text", async (_event, text: string) => {
    const imported = await importDeckPackageText(text);
    queueAccountCloudSync("Deck package imported");
    return imported;
  });
  handleTrustedAppIpc("decks:prep:export-pdf", (_event, deckId: string, notebook?: DeckNotebook) => exportDeckPrepPdf(deckId, notebook));
  handleTrustedAppIpc("decks:prep:get-active", (_event, opponentLegend?: string) => getActiveDeckPrep(opponentLegend));
  handleTrustedAppIpc("clipboard:write-text", (_event, text: string) => {
    clipboard.writeText(String(text ?? ""));
    return true;
  });
  handleTrustedAppIpc("deck-tracker:get-state", () => deckTrackerService.getState());
  handleTrustedAppIpc("deck-tracker:set-pinned", async (_event, deckId: string, cardKeys: string[]) => {
    const state = await deckTrackerService.setPinnedCards(deckId, cardKeys);
    queueAccountCloudSync("Deck tracker pins changed");
    return state;
  });
  handleTrustedAppIpc("deck-tracker:adjust", (_event, cardKey: string, delta: number) => deckTrackerService.adjustCard(cardKey, delta));
  handleTrustedAppIpc("deck-tracker:sideboard-adjust", (_event, cardKey: string, direction: "in" | "out", delta: number) => (
    deckTrackerService.adjustSideboardCard(cardKey, direction, delta)
  ));
  handleTrustedAppIpc("deck-tracker:sideboard-reset", () => deckTrackerService.resetSideboard());
  handleTrustedAppIpc("deck-tracker:reset", () => deckTrackerService.resetMatch());
  handleTrustedAppIpc("deck-tracker:open-window", () => openDeckTrackerWindow());
  handleTrustedAppIpc("vision-deck-tracker:get-status", () => deckTrackerService.getVisionStatus());
  handleTrustedAppIpc("vision-deck-tracker:set-enabled", (_event, enabled: boolean) => deckTrackerService.setVisionEnabled(Boolean(enabled)));
  handleTrustedAppIpc("vision-deck-tracker:calibrate", (_event, platform: GamePlatform) => deckTrackerService.calibrateVisionTracker(platform));
  handleTrustedAppIpc("vision-deck-tracker:confirm-suggestion", (_event, cardKey: string) => deckTrackerService.confirmVisionSuggestion(cardKey));
  handleTrustedAppIpc("vision-deck-tracker:reject-suggestion", (_event, cardKey: string) => deckTrackerService.rejectVisionSuggestion(cardKey));
  handleTrustedAppIpc("vision-deck-tracker:observations", (_event, platform: GamePlatform, observations: DeckTrackerObservation[], status: Partial<VisionDeckTrackerStatus>) => (
    deckTrackerService.reportVisionObservations(platform, observations, status)
  ));
  handleTrustedAppIpc("vision-deck-tracker:debug", async (_event, platform: GamePlatform, payload: unknown) => {
    const capturedAt = new Date().toISOString();
    const safePayload = sanitizeVisionDebugPayload(payload);
    await diagnostics.record({
      id: `vision-deck-tracker-${Date.now()}-${randomUUID()}`,
      platform: platform === "atlas" || platform === "tcga" || platform === "sim" ? platform : "tcga",
      kind: "debug",
      capturedAt,
      url: readPayloadString(safePayload.url),
      payload: safePayload
    });
  });
  handleTrustedAppIpc("replays:get", () => store.getReplays());
  handleTrustedAppIpc("replays:deleted", () => store.getDeletedReplays());
  handleTrustedAppIpc("replays:save", (_event, replay: ReplayRecord) => store.saveReplay(replay));
  handleTrustedAppIpc("replays:delete", (_event, id: string) => store.deleteReplay(id));
  handleTrustedAppIpc("replays:restore", (_event, id: string) => store.restoreReplay(id));
  handleTrustedAppIpc("replays:purge", (_event, id: string) => store.purgeReplay(id));
  handleTrustedAppIpc("replays:export", (_event, replayId: string) => exportReplayBundle(replayId));
  handleTrustedAppIpc("replays:export-mp4", (_event, replayId: string, options: ReplayMp4ExportOptions) => exportReplayMp4(replayId, options));
  handleTrustedAppIpc("replays:export-presentation-mp4", (_event, replayId: string, payload: ReplayPresentationRecordingPayload) => exportReplayPresentationMp4(replayId, payload));
  handleTrustedAppIpc("replays:export-flags-text", (_event, replayId: string) => exportReplayFlagsText(replayId));
  handleTrustedAppIpc("raw-capture:upload", (event, replayId: string) => {
    assertTrustedAppIpcSender(event);
    return rawCaptureService.uploadRawCapture(replayId);
  });
  handleTrustedAppIpc("raw-capture:status", (event) => {
    assertTrustedAppIpcSender(event);
    return rawCaptureService.getStatus();
  });
  handleTrustedAppIpc("raw-capture:payload", (event, replayId: string) => {
    assertTrustedAppIpcSender(event);
    return rawCaptureService.getRawCapturePayload(replayId);
  });
  handleTrustedAppIpc("raw-capture:upload-riftlite", (event, replayId: string, visibility?: RawCaptureVisibility) => {
    assertTrustedAppIpcSender(event);
    return rawCaptureService.uploadRawCaptureToRiftLite(replayId, visibility);
  });
  handleTrustedAppIpc("raw-capture:share-discord", (event, replayId: string) => {
    assertTrustedAppIpcSender(event);
    return rawCaptureService.shareRawCaptureToDiscord(replayId);
  });
  handleTrustedAppIpc("replay:embed:prepare", (_event, replayId: string) => prepareRiftLiteReplayEmbed(replayId));
  handleTrustedAppIpc("replay:embed:prepare-library", () => prepareRiftLiteReplayLibraryEmbed());
  handleTrustedAppIpc("replays:import", () => importReplayBundle());
  handleTrustedAppIpc("replays:import-folder", () => importReplayFolder());
  handleTrustedAppIpc("replays:open-folder", async () => {
    const directory = replayBundleDirectory(await store.getSettings());
    await mkdir(directory, { recursive: true });
    await shell.openPath(directory);
  });
  handleTrustedAppIpc("replays:choose-directory", async () => {
    const settings = await store.getSettings();
    const options: OpenDialogOptions = {
      title: "Choose RiftLite replay folder",
      defaultPath: replayBundleDirectory(settings),
      properties: ["openDirectory", "createDirectory"]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return settings;
    }
    const releaseCaptureMaintenance = await capture.beginDataMaintenance();
    try {
      replayFrameDirectoryCache = null;
      const saved = await store.saveSettings({ replayDirectory: result.filePaths[0] });
      await configureTcgaWebReplayProductCapture();
      return saved;
    } finally {
      releaseCaptureMaintenance();
    }
  });
  handleTrustedAppIpc("replays:open-directory", async () => {
    const directory = replayBundleDirectory(await store.getSettings());
    await mkdir(directory, { recursive: true });
    await shell.openPath(directory);
  });
  handleTrustedAppIpc("replays:video:start", (_event, options: ReplayVideoStartOptions) => startReplayVideoCaptureFile(options));
  handleTrustedAppIpc("replays:video:prepare-target", (event, platform: GamePlatform, mode: ReplayVideoCaptureMode) => {
    prepareReplayVideoDisplayTarget(event.sender.id, platform, mode);
  });
  handleTrustedAppIpc("replays:video:window-source", () => replayWindowCaptureSource());
  handleTrustedAppIpc("replays:video:chunk", (_event, sessionId: string, chunk: ArrayBuffer | Uint8Array) => appendReplayVideoChunk(sessionId, chunk));
  handleTrustedAppIpc("replays:video:finish", (_event, sessionId: string, options: ReplayVideoFinalizeOptions) => finishReplayVideoCaptureFile(sessionId, options));
  handleTrustedAppIpc("replays:video:merge", (_event, segments: ReplayVideoAsset[], options: ReplayVideoMergeOptions) => mergeReplayVideoSegments(segments, options));
  handleTrustedAppIpc("replays:video:attach", (_event, matchId: string, video: ReplayVideoAsset) => attachReplayVideo(matchId, video));
  handleTrustedAppIpc("replays:video:discard", (_event, video: ReplayVideoAsset) => discardReplayVideoAsset(video));
  handleTrustedAppIpc("replays:video:delete-by-match", (_event, matchId: string) => deleteReplayVideoByMatch(matchId));
  handleTrustedAppIpc("replays:video:keyframe", (_event, options: ReplayVideoKeyframeOptions) => saveReplayVideoKeyframe(options));
  handleTrustedAppIpc("replays:video:load", (_event, video: ReplayVideoAsset) => loadReplayVideo(video));
  handleTrustedAppIpc("legacy:import", async () => {
    const summary = await store.importLegacyData();
    if (summary.importedMatches || summary.importedHubs || summary.importedSettings) {
      queueAccountCloudSync("Legacy data imported");
    }
    return summary;
  });
  handleTrustedAppIpc("backup:export", (event, options?: Partial<RiftLiteBackupOptions>) => {
    assertTrustedAppIpcSender(event);
    return exportRiftLiteBackup(options ?? {});
  });
  handleTrustedAppIpc("backup:restore", async (event) => {
    assertTrustedAppIpcSender(event);
    const summary = await restoreRiftLiteBackup();
    if (summary) {
      queueAccountCloudSync("Local backup restored");
    }
    return summary;
  });
  handleTrustedAppIpc("community:matches", (_event, forceRefresh = false) => syncService.getCommunityMatches(Boolean(forceRefresh)));
  handleTrustedAppIpc("hubs:create", async (_event, name: string, password: string) => syncService.createHub(name, password, await store.getSettings()));
  handleTrustedAppIpc("hubs:join", async (_event, name: string, password: string) => syncService.joinHub(name, password, await store.getSettings()));
  handleTrustedAppIpc("hubs:refresh-account", () => syncService.refreshAccountHubs());
  handleTrustedAppIpc("hubs:leave", (_event, hubId: string) => syncService.leaveHub(hubId));
  handleTrustedAppIpc("hubs:delete", (_event, hubId: string, confirmation: string) => syncService.deleteHub(hubId, confirmation));
  handleTrustedAppIpc("hubs:matches", (_event, hubId: string, forceRefresh = false) => syncService.getHubMatches(hubId, Boolean(forceRefresh)));
  handleTrustedAppIpc("hubs:sync-private", () => capture.syncPrivateHubs());
  handleTrustedAppIpc("hubs:sync-selected", (_event, matchIds: string[], hubIds: string[]) => capture.syncMatchesToHubs(matchIds, hubIds));
  handleTrustedAppIpc("hubs:delete-match", (_event, hubId: string, matchId: string) => syncService.deleteHubMatch(hubId, matchId));
  handleTrustedAppIpc("teams:matches", (_event, teamId: string, forceRefresh = false) => syncService.getTeamMatches(teamId, Boolean(forceRefresh)));
  handleTrustedAppIpc("teams:sync-enabled", () => capture.syncTeams());
  handleTrustedAppIpc("teams:sync-selected", (_event, matchIds: string[], teamIds: string[]) => capture.syncMatchesToTeams(matchIds, teamIds));
  handleTrustedAppIpc("teams:delete-match", (_event, teamId: string, matchId: string) => syncService.deleteTeamMatch(teamId, matchId));
  handleTrustedAppIpc("account:link:start", (event) => {
    assertTrustedAppIpcSender(event);
    return syncService.startAccountLink();
  });
  handleTrustedAppIpc("account:link:status", async (event, sessionId: string) => {
    assertTrustedAppIpcSender(event);
    const status = await syncService.getAccountLinkStatus(sessionId);
    if (status.status === "complete") {
      await clearRiftLiteReplayEmbedCookies().catch(() => undefined);
      await configureTcgaWebReplayProductCapture();
      if (RIFTREPLAY_CAPTURE_FEATURE_ENABLED) {
        void uploadPendingRawCapturesWithAccountRefresh().catch((error) => {
          void logStartupIssue("raw capture pending upload after account link failed", error);
        });
      }
    }
    return status;
  });
  handleTrustedAppIpc("account:profile:get", (event) => {
    assertTrustedAppIpcSender(event);
    return syncService.getAccountProfile();
  });
  handleTrustedAppIpc("account:connection:status", (event) => {
    assertTrustedAppIpcSender(event);
    return syncService.getAccountConnectionStatus();
  });
  handleTrustedAppIpc("account:connection:repair", (event) => {
    assertTrustedAppIpcSender(event);
    return syncService.repairAccountConnection();
  });
  handleTrustedAppIpc("account:profile:save", (event, profile: Record<string, unknown>) => {
    assertTrustedAppIpcSender(event);
    return syncService.saveAccountProfile(profile);
  });
  handleTrustedAppIpc("account:profile:backfill", (event) => {
    assertTrustedAppIpcSender(event);
    return syncService.refreshAccountProfileMatches();
  });
  handleTrustedAppIpc("account:export", (event) => {
    assertTrustedAppIpcSender(event);
    return exportAccountData();
  });
  handleTrustedAppIpc("account:cloud-sync:status", (event) => {
    assertTrustedAppIpcSender(event);
    return syncService.getAccountCloudSyncStatus();
  });
  handleTrustedAppIpc("account:cloud-sync:set-enabled", (event, enabled: boolean) => {
    assertTrustedAppIpcSender(event);
    return syncService.setAccountCloudSyncEnabled(Boolean(enabled));
  });
  handleTrustedAppIpc("account:cloud-sync:upload", (event, allowRemoteReplacement?: boolean) => {
    assertTrustedAppIpcSender(event);
    return syncService.uploadAccountCloudSync(
      "Account data synced.",
      { allowRemoteReplacement: allowRemoteReplacement === true }
    );
  });
  handleTrustedAppIpc("account:cloud-sync:restore", async (event) => {
    assertTrustedAppIpcSender(event);
    return runRiftLiteDataRestore((restoreFence) => syncService.restoreAccountCloudSync(restoreFence));
  });
  handleTrustedAppIpc("account:cloud-sync:conflicts", (event) => {
    assertTrustedAppIpcSender(event);
    return syncService.getAccountCloudSyncConflicts();
  });
  handleTrustedAppIpc("account:cloud-sync:conflict:keep-current", (event, conflictId: string) => {
    assertTrustedAppIpcSender(event);
    return syncService.keepAccountCloudSyncConflictCurrent(conflictId);
  });
  handleTrustedAppIpc("account:cloud-sync:conflict:restore-legacy", async (event, conflictId: string) => {
    assertTrustedAppIpcSender(event);
    return runRiftLiteDataRestore((restoreFence) => (
      syncService.restoreAccountCloudSyncConflictLegacy(conflictId, restoreFence)
    ));
  });
  handleTrustedAppIpc("account:unlink", async (event) => {
    assertTrustedAppIpcSender(event);
    const settings = await syncService.unlinkAccount();
    await configureTcgaWebReplayProductCapture();
    await clearRiftLiteReplayEmbedCookies().catch(() => undefined);
    return settings;
  });
  handleTrustedAppIpc("profiles:search", (_event, query: string) => syncService.searchPublicProfiles(query));
  handleTrustedAppIpc("hubs:claim", (_event, hubId: string, password?: string) => syncService.claimHub(hubId, password));
  handleTrustedAppIpc("hubs:inbox", () => syncService.getHubInbox());
  handleTrustedAppIpc("hubs:invite:accept", (_event, inviteId: string) => syncService.acceptHubInvite(inviteId));
  handleTrustedAppIpc("hubs:invite:decline", (_event, inviteId: string) => syncService.declineHubInvite(inviteId));
  handleTrustedAppIpc("hubs:members", (_event, hubId: string) => syncService.getHubMembers(hubId));
  handleTrustedAppIpc("hubs:health", (_event, hubId: string) => syncService.getHubHealth(hubId));
  handleTrustedAppIpc("hubs:member:update", (_event, hubId: string, uid: string, role: "admin" | "member") => syncService.updateHubMemberRole(hubId, uid, role));
  handleTrustedAppIpc("hubs:invite", (_event, hubId: string, targetHandle?: string) => syncService.createHubInvite(hubId, targetHandle));
  handleTrustedAppIpc("hubs:messages", (_event, hubId: string) => syncService.getHubMessages(hubId));
  handleTrustedAppIpc("hubs:message:post", (_event, hubId: string, text: string) => syncService.postHubMessage(hubId, text));
  handleTrustedAppIpc("hubs:message:delete", (_event, hubId: string, messageId: string) => syncService.deleteHubMessage(hubId, messageId));
  handleTrustedAppIpc("lfg:list", (_event, includeMine?: boolean) => syncService.getLfgListings(Boolean(includeMine)));
  handleTrustedAppIpc("lfg:create", (_event, draft) => syncService.createLfgListing(draft));
  handleTrustedAppIpc("lfg:accept", (_event, listingId: string) => syncService.acceptLfgListing(listingId));
  handleTrustedAppIpc("lfg:close", (_event, listingId: string) => syncService.closeLfgListing(listingId));
  handleTrustedAppIpc("lfg:voice:create", (_event, listingId: string) => syncService.createLfgVoice(listingId));
  handleTrustedAppIpc("discord:voice:join", (_event, listing) => joinDiscordVoiceFromListing(listing));
  handleTrustedAppIpc("teams:list", (_event, options) => syncService.getSocialTeams(options));
  handleTrustedAppIpc("teams:create", (_event, draft) => syncService.createSocialTeam(draft));
  handleTrustedAppIpc("teams:get", (_event, teamId: string) => syncService.getSocialTeam(teamId));
  handleTrustedAppIpc("teams:update", (_event, teamId: string, patch) => syncService.updateSocialTeam(teamId, patch));
  handleTrustedAppIpc("teams:apply", (_event, teamId: string, draft) => syncService.applyToSocialTeam(teamId, draft));
  handleTrustedAppIpc("teams:applications", (_event, teamId: string) => syncService.getSocialTeamApplications(teamId));
  handleTrustedAppIpc("teams:application:review", (_event, teamId: string, applicationId: string, status: "accepted" | "declined") => syncService.reviewSocialTeamApplication(teamId, applicationId, status));
  handleTrustedAppIpc("teams:messages", (_event, teamId: string) => syncService.getSocialTeamMessages(teamId));
  handleTrustedAppIpc("teams:message:post", (_event, teamId: string, text: string) => syncService.postSocialTeamMessage(teamId, text));
  handleTrustedAppIpc("teams:message:delete", (_event, teamId: string, messageId: string) => syncService.deleteSocialTeamMessage(teamId, messageId));
  handleTrustedAppIpc("teams:member:update", (_event, teamId: string, uid: string, role: "admin" | "member") => syncService.updateSocialTeamMember(teamId, uid, role));
  handleTrustedAppIpc("teams:member:remove", (_event, teamId: string, uid: string) => syncService.removeSocialTeamMember(teamId, uid));
  handleTrustedAppIpc("teams:report", (_event, payload) => syncService.reportSocialTeam(payload));
  handleTrustedAppIpc("moderation:teams", (_event, query?: string) => syncService.getModerationTeams(query));
  handleTrustedAppIpc("moderation:team:update", (_event, teamId: string, action, reason?: string) => syncService.moderateTeam(teamId, action, reason));
  handleTrustedAppIpc("updates:status", () => updater.getStatus());
  handleTrustedAppIpc("updates:check", () => updater.check());
  handleTrustedAppIpc("updates:download", () => updater.download());
  handleTrustedAppIpc("updates:install", () => updater.install());
  handleTrustedAppIpc("browsers:detect", () => detectBrowsers());
  handleTrustedAppIpc("overlay:info", () => ({
    url: overlayServer.url,
    landscapeUrl: overlayServer.landscapeUrl,
    portraitUrl: overlayServer.portraitUrl,
    port: overlayServer.port,
    simEventReceiverUrl: simEventReceiver?.url,
    simEventReceiverPort: simEventReceiver?.port,
    textDirectory: overlayServer.textOutputDirectory,
    textFiles: overlayServer.textFiles
  }));
  handleTrustedAppIpc("overlay:open-text-folder", async () => {
    await mkdir(overlayServer.textOutputDirectory, { recursive: true });
    await shell.openPath(overlayServer.textOutputDirectory);
  });
  handleTrustedAppIpc("diagnostics:path", async (event) => {
    assertTrustedAppIpcSender(event);
    await diagnostics.ensureFile();
    return diagnostics.getPath();
  });
  handleTrustedAppIpc("diagnostics:summary", (event) => {
    assertTrustedAppIpcSender(event);
    return diagnostics.summarize();
  });
  handleTrustedAppIpc("diagnostics:bundle", async (event, options?: unknown) => {
    assertTrustedAppIpcSender(event);
    if (options !== undefined && (
      !options ||
      typeof options !== "object" ||
      Array.isArray(options) ||
      Object.keys(options as Record<string, unknown>).some((key) => key !== "includeSensitiveData") ||
      (Object.prototype.hasOwnProperty.call(options, "includeSensitiveData") &&
        typeof (options as Record<string, unknown>).includeSensitiveData !== "boolean")
    )) {
      throw new Error("Diagnostics export options are invalid.");
    }
    const includeSensitiveData = (options as { includeSensitiveData?: boolean } | undefined)?.includeSensitiveData === true;
    if (includeSensitiveData) {
      const messageOptions = {
        type: "warning" as const,
        buttons: ["Cancel", "Create sensitive bundle"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: "Include sensitive diagnostic data?",
        message: "This file may contain player names, room codes, page URLs, account tokens, and raw capture payloads.",
        detail: "Only continue when a trusted RiftLite developer has specifically requested an unredacted bundle. Never post it publicly."
      };
      const decision = mainWindow
        ? await dialog.showMessageBox(mainWindow, messageOptions)
        : await dialog.showMessageBox(messageOptions);
      if (decision.response !== 1) {
        return null;
      }
    }
    const bundlePath = await diagnostics.createBundle({
      includeSensitiveData,
      confirmSensitiveDataExport: includeSensitiveData
    });
    shell.showItemInFolder(bundlePath);
    return bundlePath;
  });
  handleTrustedAppIpc("diagnostics:open", async (event) => {
    assertTrustedAppIpcSender(event);
    await diagnostics.ensureFile();
    shell.showItemInFolder(diagnostics.getPath());
  });
  handleTrustedAppIpc("tcga-research:status", () => tcgaReplayResearchCapture.getStatus());
  handleTrustedAppIpc("tcga-research:start", async () => {
    if (tcgaReplayResearchCapture.getStatus().active) {
      return tcgaReplayResearchCapture.getStatus();
    }
    const messageOptions = {
      type: "info" as const,
      buttons: ["Cancel", "Start monitor"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: "Start TCGA replay monitor?",
      message: "RiftLite will record TCGA game messages and matching board-state checkpoints locally.",
      detail: "Start this before joining a match, play a few representative games, then stop the monitor and share the generated file with the RiftLite developer working on TCGA Web Replay. Nothing is uploaded automatically."
    };
    const decision = mainWindow
      ? await dialog.showMessageBox(mainWindow, messageOptions)
      : await dialog.showMessageBox(messageOptions);
    if (decision.response !== 1) {
      return tcgaReplayResearchCapture.getStatus();
    }
    const status = await tcgaReplayResearchCapture.start();
    try {
      const attached = await setTcgaReplayResearchTapActive(true, status.sessionId);
      if (!attached) {
        tcgaReplayResearchCapture.setTransportState("waiting");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      tcgaReplayResearchCapture.setTransportState("error", message);
      recordTcgaReplayResearch("monitor-hook-error", {
        phase: "start",
        message
      });
    }
    recordTcgaReplayResearch("monitor-started", {
      tcgaAttached: Boolean(gameWebContentsByPlatform.get("tcga")),
      transportState: tcgaReplayResearchCapture.getStatus().transportState,
      note: "TCGA PeerJS/WebRTC and DOM correlation monitor active"
    });
    return tcgaReplayResearchCapture.getStatus();
  });
  handleTrustedAppIpc("tcga-research:stop", async () => {
    if (!tcgaReplayResearchCapture.getStatus().active) {
      return tcgaReplayResearchCapture.getStatus();
    }
    await setTcgaReplayResearchTapActive(false).catch(() => undefined);
    const status = await tcgaReplayResearchCapture.stop("user");
    if (status.exportPath) {
      shell.showItemInFolder(status.exportPath);
    }
    return status;
  });
  handleTrustedAppIpc("tcga-research:open", async () => {
    const directory = tcgaReplayResearchCapture.getStatus().directory;
    await mkdir(directory, { recursive: true });
    await shell.openPath(directory);
  });
  handleTrustedAppIpc("tcga-research:delete", async () => {
    const messageOptions = {
      type: "warning" as const,
      buttons: ["Cancel", "Delete monitor files"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: "Delete TCGA replay monitor files?",
      message: "This removes the locally captured TCGA research sessions and exports.",
      detail: "This does not affect normal matches, video replays, decks, accounts, or Atlas Web Replays."
    };
    const decision = mainWindow
      ? await dialog.showMessageBox(mainWindow, messageOptions)
      : await dialog.showMessageBox(messageOptions);
    if (decision.response !== 1) {
      return tcgaReplayResearchCapture.getStatus();
    }
    await setTcgaReplayResearchTapActive(false).catch(() => undefined);
    return tcgaReplayResearchCapture.deleteAll();
  });
  handleTrustedAppIpc("screenshot:take", () => takeScreenshot("manual"));
  handleTrustedAppIpc("screenshot:choose-directory", async () => {
    const settings = await store.getSettings();
    const options: OpenDialogOptions = {
      title: "Choose RiftLite screenshot folder",
      defaultPath: screenshotDirectory(settings),
      properties: ["openDirectory", "createDirectory"]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return settings;
    }
    return store.saveSettings({ screenshotDirectory: result.filePaths[0] });
  });
  handleTrustedAppIpc("screenshot:open-directory", async () => {
    const directory = screenshotDirectory(await store.getSettings());
    await mkdir(directory, { recursive: true });
    await shell.openPath(directory);
  });
  handleTrustedAppIpc("external:open", (event, url: string) => {
    assertTrustedAppIpcSender(event);
    if (typeof url !== "string" || !url.trim() || url.length > 4_096) {
      throw new Error("External URL is invalid.");
    }
    return openExternalResource(url);
  });
  handleTrustedAppIpc("window:fullscreen", (_event, enabled: boolean) => {
    if (!mainWindow) {
      return false;
    }
    mainWindow.setFullScreen(Boolean(enabled));
    return mainWindow.isFullScreen();
  });
  handleTrustedAppIpc("analytics:spotlight-click", (_event, payload: SpotlightClickPayload) => trackSpotlightClick(payload));
  handleTrustedAppIpc("assets:url", (_event, relativePath: string) => assetDataUrl(relativePath));
  handleTrustedAppIpc("battlefields:get", () => loadBattlefields());
  handleTrustedAppIpc("game-webview:focus", (_event, platform: GamePlatform) => {
    if (platform !== "atlas" && platform !== "tcga" && platform !== "sim") {
      throw new Error("Game webview focus request has an invalid platform.");
    }
    const contents = gameWebContentsByPlatform.get(platform);
    const policy = contents && !contents.isDestroyed()
      ? embeddedWebviewPolicyBySession.get(contents.session)
      : null;
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      !mainWindow.isFocused() ||
      !contents ||
      contents.isDestroyed() ||
      contents.session !== electronSession.fromPartition(GAME_WEBVIEW_PARTITIONS[platform]) ||
      !policy ||
      policy.kind !== "game" ||
      policy.platform !== platform ||
      !isAllowedEmbeddedNavigation(policy, contents.getURL())
    ) {
      return false;
    }
    mainWindow.webContents.focus();
    contents.focus();
    setTimeout(() => {
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.isFocused() &&
        !contents.isDestroyed()
      ) {
        mainWindow.webContents.focus();
        contents.focus();
      }
    }, 80);
    return true;
  });
  handleTrustedAppIpc("atlas-webview:recover", async () => {
    const switchStatus = capture.getGamePlatformSwitchStatus();
    if (!switchStatus.allowed) {
      return { ok: false, message: switchStatus.message };
    }
    atlasEmptyShellMainRecovery.resetAfterExplicitRepair();
    if (atlasWebviewRecoveryInFlight) {
      return atlasWebviewRecoveryInFlight;
    }
    const capturedAt = new Date().toISOString();
    atlasWebviewRecoveryInFlight = (async () => {
      try {
        await clearAtlasWebviewRuntime(electronSession.fromPartition(ATLAS_GAME_PARTITION));
        await capture.handleEvent({
          id: `atlas-webview-recovery-complete-${Date.now()}`,
          platform: "atlas",
          kind: "debug",
          capturedAt,
          url: "https://play.riftatlas.com/",
          payload: {
            reason: "atlas-webview-recovery-complete",
            cleared: ["http-cache", "code-cache", "serviceworkers", "cachestorage"],
            preserved: ["cookies", "localstorage", "indexdb", "riftlite-account", "riftlite-local-data"]
          }
        });
        return {
          ok: true,
          message: "Atlas runtime cache refreshed. Reloading Atlas now."
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logStartupIssue("Atlas webview recovery failed", error);
        await capture.handleEvent({
          id: `atlas-webview-recovery-failed-${Date.now()}`,
          platform: "atlas",
          kind: "debug",
          capturedAt,
          url: "https://play.riftatlas.com/",
          payload: { reason: "atlas-webview-recovery-failed", message: message.slice(0, 2_000) }
        }).catch(() => undefined);
        return {
          ok: false,
          message: "RiftLite could not refresh the Atlas runtime cache. Restart RiftLite and try again."
        };
      } finally {
        atlasWebviewRecoveryInFlight = null;
      }
    })();
    return atlasWebviewRecoveryInFlight;
  });
  handleTrustedAppIpc("game-preload:url", (event, platform: GamePlatform) => {
    assertTrustedAppIpcSender(event);
    if (!["tcga", "atlas", "sim"].includes(platform) || (platform === "sim" && !isDev)) {
      throw new Error("Game platform is invalid.");
    }
    return preloadPath("gamePreload");
  });
  handleTrustedAppIpc("notification:match-ready", async (event, draft: MatchDraft) => {
    assertTrustedAppIpcSender(event);
    mainWindow?.webContents.send("match:draft", draft);
  });
  handleTrustedAppIpc("capture:renderer-event", async (ipcEvent, value: unknown) => {
    assertTrustedAppIpcSender(ipcEvent);
    const event = validatedCaptureEvent(value, undefined, isDev);
    if (!event) {
      throw new Error("Capture event is invalid.");
    }
    await capture.handleEvent(event);
  });
  ipcMain.on("capture:tcga-research-event", (ipcEvent, value: unknown) => {
    if (
      trustedGameIpcPlatform(ipcEvent) !== "tcga" ||
      !tcgaReplayResearchCapture.getStatus().active
    ) {
      return;
    }
    const event = validatedTcgaResearchEvent(value);
    if (!event) return;
    recordTcgaReplayResearch(`preload-${event.kind}`, {
      eventId: event.id,
      url: event.url,
      payload: event.payload
    }, event.capturedAt, "tcga-preload");
  });
  ipcMain.on("capture:event", (ipcEvent, value: unknown) => {
    const senderPlatform = trustedGameIpcPlatform(ipcEvent);
    const event = senderPlatform ? validatedCaptureEvent(value, senderPlatform, isDev) : null;
    if (!event) {
      return;
    }
    if (
      event.platform === "tcga" &&
      tcgaReplayResearchCapture.getStatus().active &&
      !["network-fetch", "network-xhr", "network-websocket"].includes(event.kind)
    ) {
      recordTcgaReplayResearch(`capture-${event.kind}`, {
        eventId: event.id,
        url: event.url,
        payload: event.payload
      }, event.capturedAt, "tcga-preload");
    }
    handleAtlasShellStatusEvent(ipcEvent.sender, event);
    void capture.handleEvent(event);
  });
  ipcMain.on("raw-capture:frame", (event, value: unknown) => {
    if (
      trustedGameIpcPlatform(event) !== "atlas" ||
      !rawCaptureIngressLimiter.allow(event.sender.id, value)
    ) {
      return;
    }
    const payload = validatedRawCaptureFrame(value);
    if (payload) {
      ingestAtlasRawFrame("game-preload", event.sender, payload, "atlas-preload-frame");
    }
  });
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    queueAppNavigation(protocolNavigationFromArgs(argv));
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  queueAppNavigation(protocolNavigationFromArgs([url]));
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) {
    return;
  }
  try {
    Menu.setApplicationMenu(null);
    await logStartupIssue("startup begin", `${RIFTLITE_BUILD_IDENTITY.appName} ${app.getVersion()}`);
    installSmokeNetworkIsolation();
    store = new RiftLiteStore(
      join(app.getPath("userData"), "riftlite-v06.sqlite"),
      join(app.getPath("userData"), "riftlite-v06-store.json"),
      new SecureCredentialVault(join(app.getPath("userData"), "riftlite-secure-credentials.json"), {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value),
        decrypt: (value) => safeStorage.decryptString(value)
      }),
      !IS_PACKAGED_SMOKE_TEST
    );
    await store.load();
    await clearRiftLiteReplayEmbedCookies().catch((error) => {
      void logStartupIssue("replay embed cookie cleanup failed", error);
    });
    tcgaResolver = new TcgaResolver(assetPath("tcga_card_lookup.json"));
    syncService = new FirebaseSyncService(store, () => mainWindow);
    deckService = new DeckService(store);
    deckTrackerService = new DeckTrackerService(store, tcgaResolver);
    rawCaptureService = new RawCaptureService(
      store,
      (expectedAccountUid) => syncService.refreshLinkedAccountIdToken(expectedAccountUid),
      async (localMatchId, webReplayId, expectedAccountUid) => {
        const match = (await store.getMatches()).find((candidate) => candidate.id === localMatchId);
        if (match?.platform === "tcga") {
          const synced = await syncService.syncMatch(match, { quiet: true });
          await syncService.attachWebReplayToSyncedHubMatches(localMatchId, webReplayId, expectedAccountUid);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("match:draft", synced);
          }
          if (typeof capture !== "undefined") {
            capture.markConfirmedReplayFinalizationComplete(localMatchId);
          }
          queueAccountCloudSync("TCGA Web Replay delivered");
          return;
        }
        await syncService.attachWebReplayToSyncedHubMatches(localMatchId, webReplayId, expectedAccountUid);
      },
      (replay) => {
        const window = mainWindow;
        if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send("replay:updated", replay);
        }
      }
    );
    if (!IS_PACKAGED_SMOKE_TEST) {
      void syncService.backfillPrivateHubWebReplayIds().catch((error) => {
        void logStartupIssue("private hub web replay backfill failed", error);
      });
    }
    if (RIFTREPLAY_CAPTURE_FEATURE_ENABLED && !IS_PACKAGED_SMOKE_TEST) {
      void retryPendingRawCapturesAndMatchReports().catch((error) => {
        void logStartupIssue("raw capture pending upload on startup failed", error);
      });
      startRawCaptureUploadRetry();
    }
    overlayServer = new OverlayServer(store, () => {
      if (typeof capture === "undefined") {
        return null;
      }
      return capture.getLiveOverlayMatch();
    });
    if (!IS_PACKAGED_SMOKE_TEST) {
      await overlayServer.start().catch((error) => logStartupIssue("overlay server startup failed", error));
    }
    diagnostics = new CaptureDiagnostics();
    store.setPerformanceReporter((event) => {
      const capturedAt = new Date().toISOString();
      void diagnostics.record({
        id: `performance-database-${Date.now()}-${randomUUID()}`,
        platform: "sim",
        kind: "debug",
        capturedAt,
        url: "",
        payload: { diagnosticType: "performance", source: "database", ...event }
      }).catch(() => undefined);
    });
    eventLoopWatchdog = startEventLoopWatchdog((event) => {
      const capturedAt = new Date().toISOString();
      void diagnostics.record({
        id: `performance-event-loop-${Date.now()}-${randomUUID()}`,
        platform: "sim",
        kind: "debug",
        capturedAt,
        url: "",
        payload: { diagnosticType: "performance", source: "main-event-loop", ...event }
      }).catch(() => undefined);
    });
    tcgaReplayResearchCapture = new TcgaReplayResearchCapture(
      join(app.getPath("userData"), "TCGA Replay Monitor"),
      app.getVersion(),
      {
        maxBytes: 128 * 1024 * 1024,
        maxRecords: 50_000
      }
    );
    tcgaWebReplayCaptureService = new TcgaWebReplayCaptureService(
      await rawCaptureService.captureDirectory(),
      (prepared, identity, replay) => rawCaptureService.registerPreparedTcgaCapture(
        prepared,
        identity,
        replay,
        { deferDelivery: true }
      )
    );
    await configureTcgaWebReplayProductCapture();
    updater = new UpdaterService(() => mainWindow, {
      enabled: RIFTLITE_BUILD_IDENTITY.updatesEnabled && !IS_PACKAGED_SMOKE_TEST,
      disabledMessage: IS_PACKAGED_SMOKE_TEST
        ? "Updates are disabled during an isolated smoke test."
        : "Updates are disabled in this build.",
      beforeInstall: async () => {
        // electron-updater must own the quit that launches the downloaded
        // installer. Finalize the research capture first and then allow that
        // quit through the global before-quit guard.
        try {
          if (tcgaReplayResearchCapture.getStatus().active) {
            await tcgaReplayResearchCapture.stop("update-install");
          }
        } catch (error) {
          await logStartupIssue("TCGA replay monitor update finalization failed", error);
        } finally {
          tcgaResearchQuitAllowed = true;
        }
      },
      onInstallHandoffFailed: () => {
        // If the installer could not start, RiftLite remains open. Restore the
        // normal capture-aware quit guard for any later research session.
        tcgaResearchQuitAllowed = false;
      }
    });
    await diagnostics.ensureFile();
    capture = new CaptureCoordinator(
      store,
      () => mainWindow,
      tcgaResolver,
      syncService,
      diagnostics,
      captureTimedReplayFrame,
      deckTrackerService,
      async (identity, replay) => {
        if (identity.platform !== "tcga") {
          return rawCaptureService.finishCapture(identity, replay);
        }
        return finalizeTcgaWebReplayCapture(identity, replay);
      }
    );
    capture.recordBuildMarker(app.getVersion());
    if (!IS_PACKAGED_SMOKE_TEST && simEventReceiverEnabled()) {
      simEventReceiver = new SimEventReceiver((event) => capture.handleEvent(event));
      await simEventReceiver.start().catch(async (error) => {
        await logStartupIssue("sim event receiver startup failed", error);
        simEventReceiver = null;
      });
    }
    registerIpc();
    await createWindow();
    if (UI_SNAPSHOT_PATH) {
      setTimeout(() => {
        void (async () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          await mainWindow.webContents.executeJavaScript(
            `document.querySelector('.release-notes-modal .primary')?.click()`
          ).catch(() => undefined);
          await new Promise((resolveSnapshot) => setTimeout(resolveSnapshot, 250));
          if (UI_SNAPSHOT_TOUR_ACTION) {
            const requestedStep = Number.parseInt(UI_SNAPSHOT_TOUR_ACTION, 10);
            const clickCount = UI_SNAPSHOT_TOUR_ACTION === "finish"
              ? 10
              : Number.isFinite(requestedStep)
                ? Math.max(0, Math.min(9, requestedStep - 1))
                : 0;
            for (let index = 0; index < clickCount; index += 1) {
              const clicked = await mainWindow.webContents.executeJavaScript(`(() => {
                const button = document.querySelector('[data-tour-action="next"], [data-tour-action="finish"]');
                if (!(button instanceof HTMLButtonElement)) return false;
                button.click();
                return true;
              })()`);
              if (!clicked) break;
              await new Promise((resolveTourStep) => setTimeout(resolveTourStep, 320));
            }
          }
          if (UI_SNAPSHOT_PLATFORM === "atlas" || UI_SNAPSHOT_PLATFORM === "tcga") {
            const platformLiteral = JSON.stringify(UI_SNAPSHOT_PLATFORM);
            await mainWindow.webContents.executeJavaScript(`(() => {
              const button = document.querySelector('.home-top-actions button[data-platform=' + ${platformLiteral} + ']');
              if (!(button instanceof HTMLButtonElement)) return false;
              button.click();
              return true;
            })()`);
            await new Promise((resolvePlatform) => setTimeout(resolvePlatform, 180));
          }
          const snapshotViewTitles: Record<string, string> = {
            home: "Home",
            play: "Play",
            matches: "Matches",
            replays: "Replays",
            "web-replay": "RiftLite web replay",
            stats: "Stats",
            decks: "Deck Library",
            "matchup-lab": "Matchup Lab",
            community: "Meta & Matrix",
            spotlight: "Spotlight",
            social: "Find Match & Teams",
            hubs: "Private Hubs",
            scorepad: "Scorepad",
            stream: "Overlay",
            account: "Account & integrations",
            settings: "Settings"
          };
          const snapshotViewTitle = snapshotViewTitles[UI_SNAPSHOT_VIEW];
          if (snapshotViewTitle) {
            const snapshotViewTitleLiteral = JSON.stringify(snapshotViewTitle);
            await mainWindow.webContents.executeJavaScript(`(() => {
              const button = Array.from(document.querySelectorAll('button[title]')).find((candidate) => candidate.getAttribute('title') === ${snapshotViewTitleLiteral});
              if (!(button instanceof HTMLButtonElement)) return false;
              button.click();
              return true;
            })()`);
            await new Promise((resolveView) => setTimeout(resolveView, 650));
          }
          if (UI_SNAPSHOT_COLLAPSED) {
            await mainWindow.webContents.executeJavaScript(`(() => {
              const button = document.querySelector('.sidebar-float-toggle');
              if (!(button instanceof HTMLButtonElement)) return false;
              button.click();
              return true;
            })()`);
            await new Promise((resolveCollapse) => setTimeout(resolveCollapse, 240));
          }
          if (UI_SNAPSHOT_VIEW === "play" && UI_SNAPSHOT_PLATFORM === "atlas") {
            await new Promise((resolveAtlas) => setTimeout(resolveAtlas, UI_SNAPSHOT_ATLAS_WAIT_MS));
          }
          const rendererReadiness = await mainWindow.webContents.executeJavaScript(`(() => {
            const shell = document.querySelector('.app-shell.ui-dev-modern');
            const sidebar = document.querySelector('.sidebar');
            const homeButton = document.querySelector('button[title="Home"]');
            const bounds = shell instanceof HTMLElement ? shell.getBoundingClientRect() : null;
            const bodyText = String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
            return {
              readyState: document.readyState,
              shellFound: shell instanceof HTMLElement,
              sidebarFound: sidebar instanceof HTMLElement,
              homeButtonFound: homeButton instanceof HTMLButtonElement,
              bridgeAvailable: typeof window.riftlite?.getSettings === 'function',
              width: bounds?.width || 0,
              height: bounds?.height || 0,
              bodyTextLength: bodyText.length,
              hasRiftLiteText: bodyText.includes('RiftLite')
            };
          })()`, true) as {
            readyState: string;
            shellFound: boolean;
            sidebarFound: boolean;
            homeButtonFound: boolean;
            bridgeAvailable: boolean;
            width: number;
            height: number;
            bodyTextLength: number;
            hasRiftLiteText: boolean;
          };
          const rendererReady = rendererReadiness.readyState === "complete" &&
            rendererReadiness.shellFound &&
            rendererReadiness.sidebarFound &&
            rendererReadiness.homeButtonFound &&
            rendererReadiness.bridgeAvailable &&
            rendererReadiness.width >= 700 &&
            rendererReadiness.height >= 500 &&
            rendererReadiness.bodyTextLength >= 200 &&
            rendererReadiness.hasRiftLiteText;
          if (!rendererReady) {
            throw new Error(`Renderer readiness check failed: ${JSON.stringify(rendererReadiness)}`);
          }
          const image = await mainWindow.webContents.capturePage();
          await writeFile(resolve(UI_SNAPSHOT_PATH), image.toPNG());
          await writeFile(`${resolve(UI_SNAPSHOT_PATH)}.json`, JSON.stringify({
            version: 1,
            rendererReady,
            ...rendererReadiness
          }, null, 2), "utf8");
          app.quit();
        })().catch(async (error) => {
          await logStartupIssue("UI snapshot failed", error);
          app.exit(1);
        });
      }, 3_000);
    }
    if (!IS_PACKAGED_SMOKE_TEST) {
      await configureScreenshotHotkey().catch((error) => logStartupIssue("screenshot hotkey startup failed", error));
      await configureReplayHotkeys().catch((error) => logStartupIssue("replay hotkey startup failed", error));
    }
    if (RIFTLITE_BUILD_IDENTITY.usageAnalyticsEnabled && !IS_PACKAGED_SMOKE_TEST) {
      scheduleAppUsageHeartbeat(store);
    }
    await logStartupIssue("startup complete", `${RIFTLITE_BUILD_IDENTITY.appName} ${app.getVersion()}`);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow().catch((error) => logStartupIssue("activate createWindow failed", error));
      }
    });
  } catch (error) {
    await logStartupIssue("fatal startup failure", error);
    dialog.showErrorBox(
      "RiftLite could not start",
      `RiftLite hit a startup problem and wrote details to:\n${startupLogPath()}\n\n${formatStartupError(error).split("\n")[0]}`
    );
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (
    tcgaResearchQuitAllowed ||
    typeof tcgaReplayResearchCapture === "undefined" ||
    !tcgaReplayResearchCapture.getStatus().active
  ) {
    return;
  }
  event.preventDefault();
  if (tcgaResearchQuitFinalizationStarted) return;
  tcgaResearchQuitFinalizationStarted = true;
  void (async () => {
    try {
      await tcgaReplayResearchCapture.stop("app-quit");
    } catch (error) {
      await logStartupIssue("TCGA replay monitor quit finalization failed", error);
    } finally {
      tcgaResearchQuitAllowed = true;
      app.quit();
    }
  })();
});

app.on("will-quit", () => {
  eventLoopWatchdog?.stop();
  eventLoopWatchdog = null;
  overlayServer?.stop();
  void simEventReceiver?.stop();
  if (rawCaptureUploadRetryTimer) {
    clearInterval(rawCaptureUploadRetryTimer);
    rawCaptureUploadRetryTimer = null;
  }
  globalShortcut.unregisterAll();
});
