import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, session as electronSession, shell } from "electron";
import type { NativeImage, OpenDialogOptions, SaveDialogOptions, WebContents } from "electron";
import { appendFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  BattlefieldOption,
  CaptureEvent,
  GamePlatform,
  MatchDraft,
  ReplayBundleFrame,
  ReplayBundleVideo,
  ReplayRecord,
  ReplaySearchMetadata,
  ReplayScreenshotFrame,
  ReplayVideoAsset,
  ReplayVideoCaptureMode,
  ReplayVideoFinalizeOptions,
  ReplayVideoKeyframeOptions,
  ReplayVideoSession,
  ReplayVideoStartOptions,
  ReplayWindowCaptureSource,
  RiftReplayBundle,
  ScreenshotResult,
  SpotlightClickPayload,
  UserSettings
} from "../shared/types.js";
import { detectBrowsers } from "./services/browserDetection.js";
import { CaptureCoordinator } from "./services/captureCoordinator.js";
import { CaptureDiagnostics } from "./services/captureDiagnostics.js";
import { DeckService } from "./services/deckService.js";
import { FirebaseSyncService } from "./services/firebaseSync.js";
import { OverlayServer } from "./services/overlayServer.js";
import { RiftLiteStore } from "./services/store.js";
import { TcgaResolver } from "./services/tcgaResolver.js";
import { UpdaterService } from "./services/updaterService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isDev = process.env.NODE_ENV === "development";

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
let overlayServer: OverlayServer;
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

type ScreenshotOptions = {
  platform?: GamePlatform;
  label?: string;
  silent?: boolean;
};

function assetPath(relativePath: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "resources", relativePath);
  }
  return resolve(__dirname, "..", "..", "..", "resources", relativePath);
}

function preloadPath(name: "appPreload" | "gamePreload"): string {
  return join(__dirname, "..", name === "appPreload" ? "preload" : "game-preload", name === "gamePreload" ? "gamePreload.cjs" : "appPreload.js");
}

async function assetDataUrl(relativePath: string): Promise<string> {
  const filePath = assetPath(relativePath);
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

function replayFrameCaptureDirectory(settings: UserSettings): string {
  return join(screenshotDirectory(settings), "Replay Frames");
}

function replayBundleDirectory(): string {
  return join(app.getPath("documents"), "RiftLite", "Replay Bundles");
}

function replayVideoDirectory(): string {
  return join(app.getPath("documents"), "RiftLite", "Replay Videos");
}

function replayFrameDirectory(replayId: string): string {
  return join(replayBundleDirectory(), "Imported Frames", safeFileComponent(replayId, "replay"));
}

function replayVideoImportDirectory(): string {
  return join(replayVideoDirectory(), "Imported");
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
  await mkdir(replayVideoDirectory(), { recursive: true });
  const startedAt = new Date().toISOString();
  const filename = screenshotFilename(`${options.platform}-${options.quality}-${options.title || "video-replay"}`, replayVideoExtension(options.mimeType));
  const filePath = join(replayVideoDirectory(), filename);
  await writeFile(filePath, Buffer.alloc(0));
  const session: ReplayVideoSession = {
    id: `video-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    path: filePath,
    url: pathToFileURL(filePath).href,
    filename,
    directory: replayVideoDirectory(),
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
  const fileStats = await stat(session.path);
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
    actualBitrateKbps: options.actualBitrateKbps,
    codec: options.codec,
    quality: options.quality
  };
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

async function discardReplayVideoAsset(video: ReplayVideoAsset): Promise<void> {
  const filePath = video.path?.trim();
  if (!filePath) {
    return;
  }
  if (!pathInside(filePath, replayVideoDirectory()) && !pathInside(filePath, replayVideoImportDirectory())) {
    return;
  }
  await unlink(resolve(filePath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
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
  const header = options.dataUrl.slice(0, comma);
  const extension = header.includes("image/png") ? "png" : "jpg";
  const directory = replayFrameDirectory(options.replayId);
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

async function replayVideoForBundle(replay: ReplayRecord): Promise<ReplayBundleVideo | undefined> {
  const video = replay.video;
  const sourcePath = video?.path?.trim() ?? "";
  if (!video || !sourcePath) {
    return undefined;
  }
  try {
    const bytes = await readFile(sourcePath);
    return {
      sourcePath,
      sourceUrl: video.url,
      mimeType: video.mimeType,
      data: bytes.toString("base64"),
      asset: video
    };
  } catch {
    return undefined;
  }
}

function replayForExport(replay: ReplayRecord): ReplayRecord {
  if (!replay.trim) {
    return replay;
  }
  return {
    ...replay,
    events: replay.events.filter((event) => withinReplayTrim(replay, event.capturedAt)),
    structuredEvents: replay.structuredEvents?.filter((event) => withinReplayTrim(replay, event.capturedAt)),
    visualFrames: replay.visualFrames?.filter((frame) => withinReplayTrim(replay, frame.capturedAt)),
    flags: replay.flags?.filter((flag) => flag.targetType === "replay" || withinReplayTrim(replay, flag.capturedAt)),
    annotations: replay.annotations?.filter((annotation) => withinReplayTrim(replay, annotation.capturedAt)),
    voiceNotes: replay.voiceNotes?.filter((note) =>
      replay.flags?.some((flag) => flag.id === note.flagId && (flag.targetType === "replay" || withinReplayTrim(replay, flag.capturedAt)))
    )
  };
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
  const [replays, matches] = await Promise.all([store.getReplays(), store.getMatches()]);
  const storedReplay = replays.find((item) => item.id === replayId);
  if (!storedReplay) {
    throw new Error("Replay not found.");
  }
  const replay = replayForExport(storedReplay);
  const match = matches.find((item) => item.id === replay.matchId) ?? replay.matchSnapshot;
  const search = replaySearchMetadata(replay, match);
  const bundle: RiftReplayBundle = {
    format: "riftlite.replay",
    version: replay.annotations?.length || replay.voiceNotes?.length ? 3 : replay.video ? 2 : 1,
    exportedAt: new Date().toISOString(),
    replay: {
      ...replay,
      matchSnapshot: match,
      search
    },
    match,
    search,
    frames: await replayFrames(replay),
    video: await replayVideoForBundle(replay)
  };
  await mkdir(replayBundleDirectory(), { recursive: true });
  const defaultPath = join(
    replayBundleDirectory(),
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
  await writeFile(filePath, JSON.stringify(bundle));
  return filePath;
}

async function importReplayBundleFromPath(bundlePath: string): Promise<ReplayRecord> {
  const parsed = JSON.parse(await readFile(bundlePath, "utf8")) as RiftReplayBundle;
  if (parsed.format !== "riftlite.replay" || ![1, 2, 3].includes(parsed.version) || !parsed.replay?.id) {
    throw new Error("This is not a RiftLite replay bundle.");
  }
  const importStamp = new Date().toISOString();
  const replayId = parsed.replay.id;
  const frameDirectory = replayFrameDirectory(replayId);
  await mkdir(frameDirectory, { recursive: true });
  const frameByEvent = new Map<string, ReplayBundleFrame & { importedPath: string; importedUrl: string }>();
  const importedFrameRecords: Array<{ frame: ReplayBundleFrame; imported: ReplayScreenshotFrame }> = [];
  const importedFrameTargetIds = new Map<string, string>();
  for (const frame of parsed.frames ?? []) {
    if (!frame.data || !frame.eventId) {
      continue;
    }
    const extension = extensionForFrame(frame);
    const filename = `${safeFileComponent(frame.eventId, "frame")}-${safeFileComponent(frame.label, "keyframe")}.${extension}`;
    const importedPath = join(frameDirectory, filename);
    await writeFile(importedPath, Buffer.from(frame.data, "base64"));
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
  let importedVideo: ReplayVideoAsset | undefined;
  if (parsed.video?.data && parsed.video.asset) {
    const videoDirectory = join(replayVideoImportDirectory(), safeFileComponent(replayId, "replay"));
    await mkdir(videoDirectory, { recursive: true });
    const filename = `${safeFileComponent(parsed.video.asset.filename || parsed.replay.title || "video-replay", "video-replay")}.${replayVideoExtension(parsed.video.asset.mimeType)}`;
    const importedPath = join(videoDirectory, filename);
    await writeFile(importedPath, Buffer.from(parsed.video.data, "base64"));
    const importedStats = await stat(importedPath);
    importedVideo = {
      ...parsed.video.asset,
      path: importedPath,
      url: pathToFileURL(importedPath).href,
      filename,
      directory: videoDirectory,
      source: "riftreplay",
      sizeBytes: importedStats.size
    };
  }
  const replay: ReplayRecord = {
    ...parsed.replay,
    id: replayId,
    matchId: parsed.replay.matchId || parsed.match?.id || replayId,
    structuredEvents,
    visualFrames: importedFrameRecords
      .filter(({ frame }) => frame.eventId.startsWith("visual:") || !structuredEventIds.has(frame.eventId))
      .map(({ imported }) => imported),
    matchSnapshot: parsed.match ?? parsed.replay.matchSnapshot,
    search: parsed.search,
    video: importedVideo ?? parsed.replay.video,
    flags: parsed.replay.flags?.map((flag) => flag.targetType === "frame"
      ? { ...flag, targetId: importedFrameTargetIds.get(flag.targetId) ?? flag.targetId }
      : flag),
    annotations: parsed.replay.annotations?.map((annotation) => annotation.targetType === "frame"
      ? { ...annotation, targetId: importedFrameTargetIds.get(annotation.targetId) ?? annotation.targetId }
      : annotation),
    importedAt: importStamp,
    importedFrom: bundlePath
  };
  return store.saveReplay(replay);
}

async function importReplayBundle(): Promise<ReplayRecord | null> {
  await mkdir(replayBundleDirectory(), { recursive: true });
  const options: OpenDialogOptions = {
    title: "Import RiftLite replay",
    defaultPath: replayBundleDirectory(),
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
  await mkdir(replayBundleDirectory(), { recursive: true });
  const options: OpenDialogOptions = {
    title: "Choose folder with RiftLite replays",
    defaultPath: replayBundleDirectory(),
    properties: ["openDirectory"]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return [];
  }
  const files = await readdir(result.filePaths[0]);
  const imported: ReplayRecord[] = [];
  for (const file of files.filter((item) => item.toLowerCase().endsWith(".riftreplay"))) {
    imported.push(await importReplayBundleFromPath(join(result.filePaths[0], file)));
  }
  return imported;
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
  configureDisplayMediaCapture();

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("did-attach-webview", (_event, webContents) => {
    rememberGameWebContents(webContents);
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
  ipcMain.handle("decks:get", () => deckService.getDecks());
  ipcMain.handle("decks:import", (_event, url: string) => deckService.importDeck(url));
  ipcMain.handle("decks:refresh", (_event, id: string) => deckService.refreshDeck(id));
  ipcMain.handle("decks:delete", (_event, id: string) => deckService.deleteDeck(id));
  ipcMain.handle("decks:set-active", (_event, id: string) => deckService.setActiveDeck(id));
  ipcMain.handle("replays:get", () => store.getReplays());
  ipcMain.handle("replays:deleted", () => store.getDeletedReplays());
  ipcMain.handle("replays:save", (_event, replay: ReplayRecord) => store.saveReplay(replay));
  ipcMain.handle("replays:delete", (_event, id: string) => store.deleteReplay(id));
  ipcMain.handle("replays:restore", (_event, id: string) => store.restoreReplay(id));
  ipcMain.handle("replays:purge", (_event, id: string) => store.purgeReplay(id));
  ipcMain.handle("replays:export", (_event, replayId: string) => exportReplayBundle(replayId));
  ipcMain.handle("replays:import", () => importReplayBundle());
  ipcMain.handle("replays:import-folder", () => importReplayFolder());
  ipcMain.handle("replays:open-folder", async () => {
    await mkdir(replayBundleDirectory(), { recursive: true });
    await shell.openPath(replayBundleDirectory());
  });
  ipcMain.handle("replays:video:start", (_event, options: ReplayVideoStartOptions) => startReplayVideoCaptureFile(options));
  ipcMain.handle("replays:video:prepare-target", (_event, platform: GamePlatform, mode: ReplayVideoCaptureMode) => prepareReplayVideoDisplayTarget(platform, mode));
  ipcMain.handle("replays:video:window-source", () => replayWindowCaptureSource());
  ipcMain.handle("replays:video:chunk", (_event, sessionId: string, chunk: ArrayBuffer | Uint8Array) => appendReplayVideoChunk(sessionId, chunk));
  ipcMain.handle("replays:video:finish", (_event, sessionId: string, options: ReplayVideoFinalizeOptions) => finishReplayVideoCaptureFile(sessionId, options));
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
  capture = new CaptureCoordinator(store, () => mainWindow, tcgaResolver, syncService, diagnostics, captureTimedReplayFrame);
  registerIpc();
  await createWindow();
  await configureScreenshotHotkey();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  overlayServer?.stop();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
