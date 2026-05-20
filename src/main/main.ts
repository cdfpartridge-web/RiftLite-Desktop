import { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, session as electronSession, shell } from "electron";
import type { NativeImage, OpenDialogOptions, SaveDialogOptions, WebContents } from "electron";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { access, appendFile, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import ffmpegStaticPath from "ffmpeg-static";
import type {
  ActiveDeckPrep,
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
  GamePlatform,
  MatchHistoryCsvExportPayload,
  MatchDraft,
  ReplayAnnotation,
  ReplayBundleFrame,
  ReplayBundleVideo,
  ReplayFlag,
  ReplayMp4ExportOptions,
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
  SavedDeck,
  ScreenshotResult,
  SpotlightClickPayload,
  UserSettings
} from "../shared/types.js";
import { emptyDeckMatchupGuide, resolveDeckMatchupGuide, sanitizeDeckNotebookForDeck } from "../shared/deckNotebook.js";
import { detectBrowsers } from "./services/browserDetection.js";
import { scheduleAppUsageHeartbeat } from "./services/appUsageAnalytics.js";
import { CaptureCoordinator } from "./services/captureCoordinator.js";
import { CaptureDiagnostics } from "./services/captureDiagnostics.js";
import { DeckService } from "./services/deckService.js";
import { DeckTrackerService } from "./services/deckTrackerService.js";
import { FirebaseSyncService } from "./services/firebaseSync.js";
import { OverlayServer } from "./services/overlayServer.js";
import { RiftLiteStore } from "./services/store.js";
import { SimEventReceiver } from "./services/simEventReceiver.js";
import { TcgaResolver } from "./services/tcgaResolver.js";
import { UpdaterService } from "./services/updaterService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isDev = process.env.NODE_ENV === "development";
const DECK_PACKAGE_TEXT_PREFIX = "RIFTLITE_DECK_PACKAGE_V1:";
const DECK_PACKAGE_COMPRESSED_TEXT_PREFIX = "RIFTLITE_DECK_PACKAGE_V2:";
const DECK_SHARE_TEXT_PREFIX = "RIFTLITE_DECK_SHARE_V2:";
const REPLAY_STREAM_MAGIC = "RIFTLITE_REPLAY_STREAM_V1";
const REPLAY_STREAM_VIDEO_START = "VIDEO_DATA";
const REPLAY_STREAM_VIDEO_END = "END_VIDEO_DATA";

app.setName("RiftLite Beta 0.7");
app.setPath("userData", join(app.getPath("appData"), "RiftLite Beta 0.6"));
app.setAppUserModelId("com.riftlite.desktop.beta06");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("disable-features", "WebRtcAllowInputVolumeAdjustment,WebRtcApmInAudioService");

const gotSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let store: RiftLiteStore;
let capture: CaptureCoordinator;
let tcgaResolver: TcgaResolver;
let syncService: FirebaseSyncService;
let deckService: DeckService;
let deckTrackerService: DeckTrackerService;
let overlayServer: OverlayServer;
let simEventReceiver: SimEventReceiver | null = null;
let diagnostics: CaptureDiagnostics;
let updater: UpdaterService;
let registeredScreenshotHotkey = "";
const gameWebContentsByPlatform = new Map<GamePlatform, WebContents>();
const replayFrameHashByPlatform = new Map<GamePlatform, { hash: string; capturedAt: number }>();
const ensuredReplayFrameDirectories = new Set<string>();
let replayFrameDirectoryCache: { path: string; expiresAt: number } | null = null;
const replayVideoSessions = new Map<string, ReplayVideoSession>();
let replayVideoDisplayTarget: { platform: GamePlatform; mode: ReplayVideoCaptureMode; expiresAt: number } | null = null;

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
  return resolve(__dirname, "..", "..", "..", "resources");
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

async function assetDataUrl(relativePath: string): Promise<string> {
  const filePath = safeAssetPath(relativePath);
  const bytes = await readFile(filePath);
  return `data:${mimeType(relativePath)};base64,${bytes.toString("base64")}`;
}

async function loadBattlefields(): Promise<BattlefieldOption[]> {
  const raw = await readFile(assetPath("battlefield_catalog.json"), "utf8");
  const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
  return parsed
    .filter((item) => item.is_active !== false)
    .map((item) => ({
      name: typeof item.name === "string" ? item.name.trim() : "",
      aliases: Array.isArray(item.aliases) ? item.aliases.filter((alias): alias is string => typeof alias === "string") : []
    }))
    .filter((item) => item.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function defaultScreenshotDirectory(): string {
  return join(app.getPath("pictures"), "RiftLite");
}

function screenshotDirectory(settings: UserSettings): string {
  return settings.screenshotDirectory?.trim() || defaultScreenshotDirectory();
}

function defaultReplayDirectory(): string {
  return join(app.getPath("documents"), "RiftLite", "Replay Bundles");
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

function legacyReplayVideoDirectory(): string {
  return join(app.getPath("documents"), "RiftLite", "Replay Videos");
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

function safeFileComponent(value: string, fallback = "RiftLite Replay"): string {
  const safe = value
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return safe || fallback;
}

function platformFromUrl(url: string): GamePlatform | null {
  const lower = url.toLowerCase();
  if (lower.includes("play.riftatlas.com") || lower.includes("riftatlas")) {
    return "atlas";
  }
  if (lower.includes("tcg-arena.fr") || lower.includes("tcga")) {
    return "tcga";
  }
  return null;
}

function isTrustedAppOrigin(origin: string): boolean {
  const lower = origin.toLowerCase();
  return lower.startsWith("file://") ||
    lower.startsWith("http://127.0.0.1:5173") ||
    lower.startsWith("http://localhost:5173");
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

function forgetGameWebContents(webContents: WebContents): void {
  for (const [platform, contents] of gameWebContentsByPlatform.entries()) {
    if (contents.id === webContents.id) {
      gameWebContentsByPlatform.delete(platform);
    }
  }
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

async function openExternalResource(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:" && parsed.protocol !== "mailto:") {
    throw new Error("Only web and email links can be opened.");
  }
  await shell.openExternal(parsed.toString());
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
  const containerFinalized = await makeReplayVideoSeekable(session.path, options.mimeType);
  const fileStats = await stat(session.path);
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
    containerFinalized
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

  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const segment of validSegments) {
    args.push("-fflags", "+genpts", "-i", segment.path);
  }
  const filters = validSegments.map((_segment, index) =>
    `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},setsar=1,setpts=PTS-STARTPTS[v${index}]`
  );
  if (canMergeAudio) {
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
    hasAudio: canMergeAudio,
    containerFinalized: true
  };
}

function actualReplayBitrateKbps(sizeBytes: number, durationMs: number): number | undefined {
  if (!Number.isFinite(sizeBytes) || !Number.isFinite(durationMs) || sizeBytes <= 0 || durationMs <= 0) {
    return undefined;
  }
  return Math.max(1, Math.round((sizeBytes * 8) / durationMs));
}

function prepareReplayVideoDisplayTarget(platform: GamePlatform, mode: ReplayVideoCaptureMode): void {
  replayVideoDisplayTarget = {
    platform,
    mode,
    expiresAt: Date.now() + REPLAY_VIDEO_DISPLAY_TARGET_MS
  };
}

function configureDisplayMediaCapture(): void {
  electronSession.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const requestedPermission = String(permission);
    if (requestedPermission === "display-capture" || requestedPermission === "media") {
      return isTrustedAppOrigin(requestingOrigin || details.securityOrigin || "");
    }
    return false;
  });
  electronSession.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === "display-capture" || permission === "media") {
      const requestingUrl = typeof details.requestingUrl === "string" ? details.requestingUrl : "";
      callback(isTrustedAppOrigin(requestingUrl || webContents.getURL()));
      return;
    }
    callback(false);
  });
  electronSession.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const trustedOrigin = isTrustedAppOrigin(request.securityOrigin);

    if (!trustedOrigin || !request.videoRequested || request.audioRequested) {
      callback({});
      return;
    }

    try {
      const target = replayVideoDisplayTarget && replayVideoDisplayTarget.expiresAt > Date.now()
        ? replayVideoDisplayTarget
        : null;
      replayVideoDisplayTarget = null;

      if (!target) {
        callback({});
        return;
      }

      if (target?.mode === "game-frame") {
        const contents = gameWebContentsByPlatform.get(target.platform);
        if (contents && !contents.isDestroyed() && platformFromUrl(contents.getURL()) === target.platform) {
          callback({ video: contents.mainFrame });
          return;
        }
        callback({});
        return;
      }

      const source = await replayWindowCaptureSource();

      if (!source) {
        callback({});
        return;
      }
      callback({ video: { id: source.id, name: source.name } });
    } catch {
      callback({});
    }
  }, { useSystemPicker: false });
}

async function attachReplayVideo(matchId: string, video: ReplayVideoAsset): Promise<ReplayRecord | null> {
  const replays = await store.getReplays();
  const replay = replays.find((item) => item.matchId === matchId);
  if (!replay) {
    return null;
  }
  return store.saveReplay({ ...replay, video });
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
    if (!replay.video) {
      continue;
    }
    await discardReplayVideoAsset(replay.video).catch(() => undefined);
    const nextReplay = { ...replay, video: undefined };
    delete nextReplay.video;
    await store.saveReplay(nextReplay);
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
  if (!replay.video) {
    return replay;
  }
  const video: Record<string, unknown> = { ...replay.video };
  delete video.data;
  delete video.asset;
  delete video.sourcePath;
  delete video.sourceUrl;
  return { ...replay, video: video as unknown as ReplayVideoAsset };
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

type ReplayMp4OverlayInput = {
  path: string;
  startSec: number;
  endSec: number;
};

type ReplayMp4VoiceInput = {
  path: string;
  delayMs: number;
};

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

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const points = annotation.points.map((point) => ({
    x: Math.round(point.x * width),
    y: Math.round(point.y * height)
  }));
  const strokeWidth = Math.max(4, Math.round(annotation.width * 3 * (Math.min(width, height) / 1000)));
  const first = points[0];
  const last = points.at(-1);
  const color = annotation.color || "#6feeff";
  const commonDefs = `<defs><marker id="arrowhead" markerWidth="18" markerHeight="18" refX="15" refY="6" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,12 L17,6 z" fill="${color}"/></marker></defs>`;
  let body = "";
  if (annotation.tool === "text" && first) {
    const text = escapeSvgText(annotation.text?.trim() || annotation.note?.trim() || "");
    body = `<text x="${first.x}" y="${first.y}" fill="${color}" font-family="Arial, sans-serif" font-size="${Math.max(34, Math.round(height * 0.046))}" font-weight="900" paint-order="stroke" stroke="#020712" stroke-width="10">${text}</text>`;
  } else if (annotation.tool === "arrow" && first && last) {
    body = `<line x1="${first.x}" y1="${first.y}" x2="${last.x}" y2="${last.y}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" marker-end="url(#arrowhead)"/>`;
  } else {
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

async function writeReplayMp4OverlayPng(tempDirectory: string, label: string, svg: string): Promise<string> {
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`);
  if (image.isEmpty()) {
    throw new Error("Could not render replay export overlay.");
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
  tempDirectory: string
): Promise<ReplayMp4OverlayInput[]> {
  const overlays: ReplayMp4OverlayInput[] = [];
  const width = Math.max(640, video.width || 1920);
  const height = Math.max(360, video.height || 1080);
  const flags = replay.flags ?? [];
  const flagsById = new Map(flags.map((flag) => [flag.id, flag]));
  const voiceNotesById = new Map((replay.voiceNotes ?? []).map((note) => [note.id, note]));

  if (options.includeFlags) {
    for (const flag of flags.filter((item) => typeof item.timeMs === "number").slice(0, 80)) {
      const startMs = clampReplayMp4TimeMs(video, (flag.timeMs ?? 0) - 250);
      const endMs = clampReplayMp4TimeMs(video, startMs + 4500);
      overlays.push({
        path: await writeReplayMp4OverlayPng(tempDirectory, `flag-${flag.id}`, replayMp4FlagSvg(flag, width, height)),
        startSec: startMs / 1000,
        endSec: Math.max(endMs, startMs + 1000) / 1000
      });
    }
  }

  if (options.includeDrawings) {
    for (const annotation of (replay.annotations ?? []).slice(0, 120)) {
      const time = replayMp4AnnotationTimeMs(annotation, video, flagsById, voiceNotesById);
      if (!time) {
        continue;
      }
      overlays.push({
        path: await writeReplayMp4OverlayPng(tempDirectory, `drawing-${annotation.id}`, replayMp4AnnotationSvg(annotation, width, height)),
        startSec: time.startMs / 1000,
        endSec: Math.max(time.endMs, time.startMs + 1000) / 1000
      });
    }
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

async function replayMp4VoiceInputs(replay: ReplayRecord, video: ReplayVideoAsset, options: ReplayMp4ExportOptions, tempDirectory: string): Promise<ReplayMp4VoiceInput[]> {
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
    const extension = replayVoiceNoteExtension(note.mimeType);
    const filePath = join(tempDirectory, `voice-${safeFileComponent(note.id, "note")}.${extension}`);
    await writeFile(filePath, Buffer.from(note.dataUrl.slice(comma + 1), "base64"));
    result.push({ path: filePath, delayMs });
  }
  return result;
}

function ffmpegSeconds(value: number): string {
  return Math.max(0, value).toFixed(3);
}

function appendReplayMp4AudioFilters(
  filterParts: string[],
  video: ReplayVideoAsset,
  voiceInputs: ReplayMp4VoiceInput[],
  firstVoiceInputIndex: number,
  options: ReplayMp4ExportOptions
): string | null {
  const audioLabels: string[] = [];
  if (options.includeOriginalAudio && video.hasAudio) {
    filterParts.push("[0:a]aresample=48000,asetpts=PTS-STARTPTS[a_base]");
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
  const ffmpegPath = replayVideoFfmpegPath();
  if (!ffmpegPath || !(await pathExists(ffmpegPath))) {
    throw new Error("MP4 export needs ffmpeg.");
  }

  const directory = replayBundleDirectory(settings);
  await mkdir(directory, { recursive: true });
  const defaultPath = join(
    directory,
    `${safeFileComponent(`${search.title} ${search.players.join(" vs ")} ${search.capturedAt.slice(0, 10)}`, "RiftLite Replay")}.mp4`
  );
  const saveOptions: SaveDialogOptions = {
    title: "Export YouTube-ready MP4",
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
    const overlayInputs = await replayMp4OverlayInputs(replay, source.asset, options, tempDirectory);
    const voiceInputs = await replayMp4VoiceInputs(replay, source.asset, options, tempDirectory);
    tempFiles.push(...overlayInputs.map((input) => input.path), ...voiceInputs.map((input) => input.path));

    const hasOverlay = overlayInputs.length > 0;
    const hasVoice = voiceInputs.length > 0;
    const width = Math.max(640, source.asset.width || 1920);
    const height = Math.max(360, source.asset.height || 1080);
    const fps = Math.max(1, source.asset.fps || 24);
    const videoDurationSec = Math.max(1, (source.asset.durationMs || 1000) / 1000);
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-fflags", "+genpts", "-i", source.sourcePath];
    overlayInputs.forEach((overlay) => {
      args.push("-loop", "1", "-t", ffmpegSeconds(videoDurationSec + 1), "-i", overlay.path);
    });
    voiceInputs.forEach((voice) => {
      args.push("-i", voice.path);
    });

    if (!hasOverlay && !hasVoice) {
      args.push("-map", "0:v:0");
      if (options.includeOriginalAudio) {
        args.push("-map", "0:a?", "-c:a", "aac", "-b:a", "128k");
      } else {
        args.push("-an");
      }
      args.push("-c:v", "copy", "-movflags", "+faststart", outputPath);
    } else {
      const filterParts: string[] = [
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},setsar=1[v0]`
      ];
      let currentVideoLabel = "[v0]";
      overlayInputs.forEach((overlay, index) => {
        const inputIndex = 1 + index;
        const nextLabel = `[v${index + 1}]`;
        filterParts.push(`${currentVideoLabel}[${inputIndex}:v]overlay=0:0:shortest=1:enable='gte(t\\,${ffmpegSeconds(overlay.startSec)})*lte(t\\,${ffmpegSeconds(overlay.endSec)})'${nextLabel}`);
        currentVideoLabel = nextLabel;
      });
      const audioLabel = appendReplayMp4AudioFilters(filterParts, source.asset, voiceInputs, 1 + overlayInputs.length, options);
      args.push("-filter_complex", filterParts.join(";"), "-map", currentVideoLabel);
      if (audioLabel) {
        args.push("-map", audioLabel, "-c:a", "aac", "-b:a", "128k");
      } else if (options.includeOriginalAudio && source.asset.hasAudio) {
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
        outputPath
      );
    }

    await execFileAsync(ffmpegPath, args, {
      windowsHide: true,
      timeout: 900_000,
      maxBuffer: 1024 * 1024
    });
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
    games_json: games
  };
}

function csvCell(value: string): string {
  const text = String(value ?? "");
  const safeText = /^[=+\-@\t\r]/.test(text.trimStart()) ? `'${text}` : text;
  return /[",\r\n]/.test(safeText) ? `"${safeText.replace(/"/g, "\"\"")}"` : safeText;
}

async function importReplayBundle(): Promise<ReplayRecord | null> {
  const directory = replayBundleDirectory(await store.getSettings());
  await mkdir(directory, { recursive: true });
  const options: OpenDialogOptions = {
    title: "Import RiftLite replay",
    defaultPath: directory,
    filters: [{ name: "RiftLite Replay", extensions: ["riftreplay"] }],
    properties: ["openFile"]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  return importReplayBundleFromPath(result.filePaths[0]);
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
  const files = await readdir(result.filePaths[0]);
  const imported: ReplayRecord[] = [];
  const failures: string[] = [];
  for (const file of files.filter((item) => item.toLowerCase().endsWith(".riftreplay"))) {
    try {
      imported.push(await importReplayBundleFromPath(join(result.filePaths[0], file)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${file}: ${message}`);
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

async function createWindow(): Promise<void> {
  const iconPath = assetPath("riftlite-app.ico");
  const icon = nativeImage.createFromPath(iconPath);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: "RiftLite Beta 0.7",
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
  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);
  installFullscreenShortcut(mainWindow.webContents);
  configureDisplayMediaCapture();

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalResource(url).catch(() => undefined);
    return { action: "deny" };
  });
  mainWindow.webContents.on("did-attach-webview", (_event, webContents) => {
    rememberGameWebContents(webContents);
    installFullscreenShortcut(webContents);
    webContents.on("did-navigate", () => rememberGameWebContents(webContents));
    webContents.on("did-navigate-in-page", () => rememberGameWebContents(webContents));
    webContents.on("dom-ready", () => rememberGameWebContents(webContents));
    webContents.once("destroyed", () => forgetGameWebContents(webContents));
    webContents.on("console-message", (_consoleEvent, level, message, line, sourceId) => {
      if (/riftlite|preload|capture/i.test(message)) {
        void capture.handleEvent({
          id: `host-console-${Date.now()}`,
          platform: webContents.getURL().includes("riftatlas") ? "atlas" : "tcga",
          kind: "debug",
          capturedAt: new Date().toISOString(),
          url: webContents.getURL(),
          payload: { reason: "guest-console", level, message, line, sourceId }
        });
      }
    });
    webContents.on("preload-error", (_preloadEvent, preloadPathValue, error) => {
      void capture.handleEvent({
        id: `host-preload-error-${Date.now()}`,
        platform: webContents.getURL().includes("riftatlas") ? "atlas" : "tcga",
        kind: "debug",
        capturedAt: new Date().toISOString(),
        url: webContents.getURL(),
        payload: { reason: "preload-error", preloadPath: preloadPathValue, message: error.message, stack: error.stack ?? "" }
      });
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
}

function registerIpc(): void {
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:save", async (_event, patch: Partial<UserSettings>) => {
    const saved = await store.saveSettings(patch);
    if (
      Object.prototype.hasOwnProperty.call(patch, "screenshotHotkey") ||
      Object.prototype.hasOwnProperty.call(patch, "screenshotHotkeyEnabled")
    ) {
      await configureScreenshotHotkey();
    }
    if (Object.prototype.hasOwnProperty.call(patch, "replayDirectory")) {
      replayFrameDirectoryCache = null;
    }
    return saved;
  });
  ipcMain.handle("capture:debug-enabled", async () => (await store.getSettings()).debugMode);
  ipcMain.handle("capture:health:get", () => capture.getHealth());
  ipcMain.handle("capture:force-review", (_event, platform: GamePlatform) => capture.forceReview(platform));
  ipcMain.handle("matches:get", () => store.getMatches());
  ipcMain.handle("matches:deleted", () => store.getDeletedMatches());
  ipcMain.handle("matches:save-draft", (_event, draft: MatchDraft) => store.saveMatch(draft));
  ipcMain.handle("matches:confirm", (_event, draft: MatchDraft) => capture.confirmMatch(draft));
  ipcMain.handle("matches:delete", (_event, id: string) => store.deleteMatch(id));
  ipcMain.handle("matches:restore", (_event, id: string) => store.restoreMatch(id));
  ipcMain.handle("matches:purge", (_event, id: string) => store.purgeMatch(id));
  ipcMain.handle("matches:export-csv", (_event, payload: MatchHistoryCsvExportPayload) => exportMatchHistoryCsv(payload));
  ipcMain.handle("decks:get", () => deckService.getDecks());
  ipcMain.handle("decks:import", (_event, url: string) => deckService.importDeck(url));
  ipcMain.handle("decks:import-text", (_event, text: string) => deckService.importDeckText(text));
  ipcMain.handle("decks:refresh", (_event, id: string) => deckService.refreshDeck(id));
  ipcMain.handle("decks:rename", (_event, id: string, title: string) => deckService.renameDeck(id, title));
  ipcMain.handle("decks:delete", (_event, id: string) => deckService.deleteDeck(id));
  ipcMain.handle("decks:set-active", (_event, id: string) => deckService.setActiveDeck(id));
  ipcMain.handle("decks:notebook:get", (_event, deckId: string) => store.getDeckNotebook(deckId));
  ipcMain.handle("decks:notebook:save", (_event, deckId: string, notebook: DeckNotebook) => store.saveDeckNotebook(deckId, notebook));
  ipcMain.handle("decks:notebook:export", (_event, deckId: string) => exportDeckNotebook(deckId));
  ipcMain.handle("decks:notebook:import", () => importDeckNotebook());
  ipcMain.handle("decks:package:export", (_event, deckId: string, notebook?: DeckNotebook) => exportDeckPackage(deckId, notebook));
  ipcMain.handle("decks:package:import", () => importDeckPackage());
  ipcMain.handle("decks:package:export-text", (_event, deckId: string, notebook?: DeckNotebook) => exportDeckPackageText(deckId, notebook));
  ipcMain.handle("decks:package:import-text", (_event, text: string) => importDeckPackageText(text));
  ipcMain.handle("decks:prep:export-pdf", (_event, deckId: string, notebook?: DeckNotebook) => exportDeckPrepPdf(deckId, notebook));
  ipcMain.handle("decks:prep:get-active", (_event, opponentLegend?: string) => getActiveDeckPrep(opponentLegend));
  ipcMain.handle("clipboard:write-text", (_event, text: string) => {
    clipboard.writeText(String(text ?? ""));
    return true;
  });
  ipcMain.handle("deck-tracker:get-state", () => deckTrackerService.getState());
  ipcMain.handle("deck-tracker:set-pinned", (_event, deckId: string, cardKeys: string[]) => deckTrackerService.setPinnedCards(deckId, cardKeys));
  ipcMain.handle("deck-tracker:adjust", (_event, cardKey: string, delta: number) => deckTrackerService.adjustCard(cardKey, delta));
  ipcMain.handle("deck-tracker:reset", () => deckTrackerService.resetMatch());
  ipcMain.handle("replays:get", () => store.getReplays());
  ipcMain.handle("replays:deleted", () => store.getDeletedReplays());
  ipcMain.handle("replays:save", (_event, replay: ReplayRecord) => store.saveReplay(replay));
  ipcMain.handle("replays:delete", (_event, id: string) => store.deleteReplay(id));
  ipcMain.handle("replays:restore", (_event, id: string) => store.restoreReplay(id));
  ipcMain.handle("replays:purge", (_event, id: string) => store.purgeReplay(id));
  ipcMain.handle("replays:export", (_event, replayId: string) => exportReplayBundle(replayId));
  ipcMain.handle("replays:export-mp4", (_event, replayId: string, options: ReplayMp4ExportOptions) => exportReplayMp4(replayId, options));
  ipcMain.handle("replays:import", () => importReplayBundle());
  ipcMain.handle("replays:import-folder", () => importReplayFolder());
  ipcMain.handle("replays:open-folder", async () => {
    const directory = replayBundleDirectory(await store.getSettings());
    await mkdir(directory, { recursive: true });
    await shell.openPath(directory);
  });
  ipcMain.handle("replays:choose-directory", async () => {
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
    replayFrameDirectoryCache = null;
    return store.saveSettings({ replayDirectory: result.filePaths[0] });
  });
  ipcMain.handle("replays:open-directory", async () => {
    const directory = replayBundleDirectory(await store.getSettings());
    await mkdir(directory, { recursive: true });
    await shell.openPath(directory);
  });
  ipcMain.handle("replays:video:start", (_event, options: ReplayVideoStartOptions) => startReplayVideoCaptureFile(options));
  ipcMain.handle("replays:video:prepare-target", (_event, platform: GamePlatform, mode: ReplayVideoCaptureMode) => prepareReplayVideoDisplayTarget(platform, mode));
  ipcMain.handle("replays:video:window-source", () => replayWindowCaptureSource());
  ipcMain.handle("replays:video:chunk", (_event, sessionId: string, chunk: ArrayBuffer | Uint8Array) => appendReplayVideoChunk(sessionId, chunk));
  ipcMain.handle("replays:video:finish", (_event, sessionId: string, options: ReplayVideoFinalizeOptions) => finishReplayVideoCaptureFile(sessionId, options));
  ipcMain.handle("replays:video:merge", (_event, segments: ReplayVideoAsset[], options: ReplayVideoMergeOptions) => mergeReplayVideoSegments(segments, options));
  ipcMain.handle("replays:video:attach", (_event, matchId: string, video: ReplayVideoAsset) => attachReplayVideo(matchId, video));
  ipcMain.handle("replays:video:discard", (_event, video: ReplayVideoAsset) => discardReplayVideoAsset(video));
  ipcMain.handle("replays:video:delete-by-match", (_event, matchId: string) => deleteReplayVideoByMatch(matchId));
  ipcMain.handle("replays:video:keyframe", (_event, options: ReplayVideoKeyframeOptions) => saveReplayVideoKeyframe(options));
  ipcMain.handle("replays:video:load", (_event, video: ReplayVideoAsset) => loadReplayVideo(video));
  ipcMain.handle("legacy:import", () => store.importLegacyData());
  ipcMain.handle("community:matches", (_event, forceRefresh = false) => syncService.getCommunityMatches(Boolean(forceRefresh)));
  ipcMain.handle("hubs:create", async (_event, name: string, password: string) => syncService.createHub(name, password, await store.getSettings()));
  ipcMain.handle("hubs:join", async (_event, name: string, password: string) => syncService.joinHub(name, password, await store.getSettings()));
  ipcMain.handle("hubs:matches", (_event, hubId: string, forceRefresh = false) => syncService.getHubMatches(hubId, Boolean(forceRefresh)));
  ipcMain.handle("hubs:sync-private", () => capture.syncPrivateHubs());
  ipcMain.handle("hubs:sync-selected", (_event, matchIds: string[], hubIds: string[]) => capture.syncMatchesToHubs(matchIds, hubIds));
  ipcMain.handle("hubs:delete-match", (_event, hubId: string, matchId: string) => syncService.deleteHubMatch(hubId, matchId));
  ipcMain.handle("account:link:start", () => syncService.startAccountLink());
  ipcMain.handle("account:link:status", (_event, sessionId: string) => syncService.getAccountLinkStatus(sessionId));
  ipcMain.handle("account:profile:get", () => syncService.getAccountProfile());
  ipcMain.handle("account:profile:save", (_event, profile: Record<string, unknown>) => syncService.saveAccountProfile(profile));
  ipcMain.handle("account:profile:backfill", () => syncService.refreshAccountProfileMatches());
  ipcMain.handle("account:export", () => exportAccountData());
  ipcMain.handle("account:unlink", () => syncService.unlinkAccount());
  ipcMain.handle("profiles:search", (_event, query: string) => syncService.searchPublicProfiles(query));
  ipcMain.handle("hubs:claim", (_event, hubId: string, passwordHash?: string) => syncService.claimHub(hubId, passwordHash));
  ipcMain.handle("hubs:inbox", () => syncService.getHubInbox());
  ipcMain.handle("hubs:invite:accept", (_event, inviteId: string) => syncService.acceptHubInvite(inviteId));
  ipcMain.handle("hubs:invite:decline", (_event, inviteId: string) => syncService.declineHubInvite(inviteId));
  ipcMain.handle("hubs:members", (_event, hubId: string) => syncService.getHubMembers(hubId));
  ipcMain.handle("hubs:invite", (_event, hubId: string, targetHandle?: string) => syncService.createHubInvite(hubId, targetHandle));
  ipcMain.handle("hubs:messages", (_event, hubId: string) => syncService.getHubMessages(hubId));
  ipcMain.handle("hubs:message:post", (_event, hubId: string, text: string) => syncService.postHubMessage(hubId, text));
  ipcMain.handle("hubs:message:delete", (_event, hubId: string, messageId: string) => syncService.deleteHubMessage(hubId, messageId));
  ipcMain.handle("updates:status", () => updater.getStatus());
  ipcMain.handle("updates:check", () => updater.check());
  ipcMain.handle("updates:download", () => updater.download());
  ipcMain.handle("updates:install", () => updater.install());
  ipcMain.handle("browsers:detect", () => detectBrowsers());
  ipcMain.handle("overlay:info", () => ({
    url: overlayServer.url,
    landscapeUrl: overlayServer.landscapeUrl,
    portraitUrl: overlayServer.portraitUrl,
    port: overlayServer.port,
    simEventReceiverUrl: simEventReceiver?.url,
    simEventReceiverPort: simEventReceiver?.port,
    textDirectory: overlayServer.textOutputDirectory,
    textFiles: overlayServer.textFiles
  }));
  ipcMain.handle("overlay:open-text-folder", async () => {
    await mkdir(overlayServer.textOutputDirectory, { recursive: true });
    await shell.openPath(overlayServer.textOutputDirectory);
  });
  ipcMain.handle("diagnostics:path", async () => {
    await diagnostics.ensureFile();
    return diagnostics.getPath();
  });
  ipcMain.handle("diagnostics:summary", () => diagnostics.summarize());
  ipcMain.handle("diagnostics:bundle", async () => {
    const bundlePath = await diagnostics.createBundle();
    shell.showItemInFolder(bundlePath);
    return bundlePath;
  });
  ipcMain.handle("diagnostics:open", async () => {
    await diagnostics.ensureFile();
    shell.showItemInFolder(diagnostics.getPath());
  });
  ipcMain.handle("screenshot:take", () => takeScreenshot("manual"));
  ipcMain.handle("screenshot:choose-directory", async () => {
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
  ipcMain.handle("screenshot:open-directory", async () => {
    const directory = screenshotDirectory(await store.getSettings());
    await mkdir(directory, { recursive: true });
    await shell.openPath(directory);
  });
  ipcMain.handle("external:open", (_event, url: string) => openExternalResource(url));
  ipcMain.handle("window:fullscreen", (_event, enabled: boolean) => {
    if (!mainWindow) {
      return false;
    }
    mainWindow.setFullScreen(Boolean(enabled));
    return mainWindow.isFullScreen();
  });
  ipcMain.handle("analytics:spotlight-click", (_event, payload: SpotlightClickPayload) => trackSpotlightClick(payload));
  ipcMain.handle("assets:url", (_event, relativePath: string) => assetDataUrl(relativePath));
  ipcMain.handle("battlefields:get", () => loadBattlefields());
  ipcMain.handle("game-preload:url", (_event, platform: GamePlatform) => {
    void platform;
    return preloadPath("gamePreload");
  });
  ipcMain.handle("notification:match-ready", async (_event, draft: MatchDraft) => {
    mainWindow?.webContents.send("match:draft", draft);
  });
  ipcMain.handle("capture:renderer-event", async (_event, event: CaptureEvent) => {
    await capture.handleEvent(event);
  });
  ipcMain.on("capture:event", (_event, event: CaptureEvent) => {
    void capture.handleEvent(event);
  });
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) {
    return;
  }
  Menu.setApplicationMenu(null);
  store = new RiftLiteStore();
  await store.load();
  tcgaResolver = new TcgaResolver(assetPath("tcga_card_lookup.json"));
  syncService = new FirebaseSyncService(store, () => mainWindow);
  deckService = new DeckService(store);
  deckTrackerService = new DeckTrackerService(store, tcgaResolver);
  overlayServer = new OverlayServer(store, () => {
    if (typeof capture === "undefined") {
      return null;
    }
    return capture.getLiveOverlayMatch();
  });
  await overlayServer.start();
  diagnostics = new CaptureDiagnostics();
  updater = new UpdaterService(() => mainWindow);
  await diagnostics.ensureFile();
  capture = new CaptureCoordinator(store, () => mainWindow, tcgaResolver, syncService, diagnostics, captureTimedReplayFrame, deckTrackerService);
  if (simEventReceiverEnabled()) {
    simEventReceiver = new SimEventReceiver((event) => capture.handleEvent(event));
    await simEventReceiver.start();
  }
  registerIpc();
  await createWindow();
  await configureScreenshotHotkey();
  scheduleAppUsageHeartbeat(store);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  overlayServer?.stop();
  simEventReceiver?.stop();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
