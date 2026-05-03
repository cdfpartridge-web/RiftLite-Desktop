import { contextBridge, ipcRenderer } from "electron";
import type {
  BrowserInfo,
  BattlefieldOption,
  CommunityMatch,
  CaptureDiagnosticsSummary,
  CaptureEvent,
  CaptureHealth,
  GamePlatform,
  HubActionResult,
  ImportSummary,
  MatchDraft,
  OverlayInfo,
  PrivateHubSyncResult,
  ReplayVideoAsset,
  ReplayVideoFinalizeOptions,
  ReplayVideoKeyframeOptions,
  ReplayWindowCaptureSource,
  ReplayVideoSession,
  ReplayVideoStartOptions,
  ReplayRecord,
  ReplayScreenshotFrame,
  ReplayVideoCaptureMode,
  RiftLiteApi,
  SavedDeck,
  ScreenshotResult,
  UpdateStatus,
  UserSettings
} from "../shared/types.js";

const api: RiftLiteApi = {
  getSettings: () => ipcRenderer.invoke("settings:get") as Promise<UserSettings>,
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings) as Promise<UserSettings>,
  getCaptureHealth: () => ipcRenderer.invoke("capture:health:get") as Promise<CaptureHealth>,
  forceCaptureReview: (platform) => ipcRenderer.invoke("capture:force-review", platform) as Promise<MatchDraft | null>,
  getMatches: () => ipcRenderer.invoke("matches:get") as Promise<MatchDraft[]>,
  getDeletedMatches: () => ipcRenderer.invoke("matches:deleted") as Promise<MatchDraft[]>,
  saveMatchDraft: (draft) => ipcRenderer.invoke("matches:save-draft", draft) as Promise<MatchDraft>,
  confirmMatch: (draft) => ipcRenderer.invoke("matches:confirm", draft) as Promise<MatchDraft>,
  deleteMatch: (id) => ipcRenderer.invoke("matches:delete", id) as Promise<void>,
  restoreMatch: (id) => ipcRenderer.invoke("matches:restore", id) as Promise<MatchDraft | null>,
  purgeMatch: (id) => ipcRenderer.invoke("matches:purge", id) as Promise<void>,
  getDecks: () => ipcRenderer.invoke("decks:get") as Promise<SavedDeck[]>,
  importDeck: (url) => ipcRenderer.invoke("decks:import", url) as Promise<SavedDeck>,
  refreshDeck: (id) => ipcRenderer.invoke("decks:refresh", id) as Promise<SavedDeck>,
  deleteDeck: (id) => ipcRenderer.invoke("decks:delete", id) as Promise<void>,
  setActiveDeck: (id) => ipcRenderer.invoke("decks:set-active", id) as Promise<UserSettings>,
  getReplays: () => ipcRenderer.invoke("replays:get") as Promise<ReplayRecord[]>,
  getDeletedReplays: () => ipcRenderer.invoke("replays:deleted") as Promise<ReplayRecord[]>,
  saveReplay: (replay) => ipcRenderer.invoke("replays:save", replay) as Promise<ReplayRecord>,
  deleteReplay: (id) => ipcRenderer.invoke("replays:delete", id) as Promise<void>,
  restoreReplay: (id) => ipcRenderer.invoke("replays:restore", id) as Promise<ReplayRecord | null>,
  purgeReplay: (id) => ipcRenderer.invoke("replays:purge", id) as Promise<void>,
  exportReplayBundle: (replayId) => ipcRenderer.invoke("replays:export", replayId) as Promise<string>,
  importReplayBundle: () => ipcRenderer.invoke("replays:import") as Promise<ReplayRecord | null>,
  importReplayFolder: () => ipcRenderer.invoke("replays:import-folder") as Promise<ReplayRecord[]>,
  openReplayFolder: () => ipcRenderer.invoke("replays:open-folder") as Promise<void>,
  startReplayVideoCapture: (options: ReplayVideoStartOptions) => ipcRenderer.invoke("replays:video:start", options) as Promise<ReplayVideoSession>,
  prepareReplayVideoCaptureTarget: (platform: GamePlatform, mode: ReplayVideoCaptureMode) => ipcRenderer.invoke("replays:video:prepare-target", platform, mode) as Promise<void>,
  getReplayWindowCaptureSource: () => ipcRenderer.invoke("replays:video:window-source") as Promise<ReplayWindowCaptureSource | null>,
  appendReplayVideoChunk: (sessionId: string, chunk: ArrayBuffer) => ipcRenderer.invoke("replays:video:chunk", sessionId, chunk) as Promise<void>,
  finishReplayVideoCapture: (sessionId: string, options: ReplayVideoFinalizeOptions) => ipcRenderer.invoke("replays:video:finish", sessionId, options) as Promise<ReplayVideoAsset>,
  attachReplayVideo: (matchId: string, video: ReplayVideoAsset) => ipcRenderer.invoke("replays:video:attach", matchId, video) as Promise<ReplayRecord | null>,
  discardReplayVideo: (video: ReplayVideoAsset) => ipcRenderer.invoke("replays:video:discard", video) as Promise<void>,
  deleteReplayVideoByMatch: (matchId: string) => ipcRenderer.invoke("replays:video:delete-by-match", matchId) as Promise<void>,
  saveReplayVideoKeyframe: (options: ReplayVideoKeyframeOptions) => ipcRenderer.invoke("replays:video:keyframe", options) as Promise<ReplayScreenshotFrame>,
  loadReplayVideo: (video: ReplayVideoAsset) => ipcRenderer.invoke("replays:video:load", video) as Promise<ArrayBuffer>,
  importLegacyData: () => ipcRenderer.invoke("legacy:import") as Promise<ImportSummary>,
  getCommunityMatches: (forceRefresh) => ipcRenderer.invoke("community:matches", forceRefresh) as Promise<CommunityMatch[]>,
  getHubMatches: (hubId, forceRefresh) => ipcRenderer.invoke("hubs:matches", hubId, forceRefresh) as Promise<CommunityMatch[]>,
  createHub: (name, password) => ipcRenderer.invoke("hubs:create", name, password) as Promise<HubActionResult>,
  joinHub: (name, password) => ipcRenderer.invoke("hubs:join", name, password) as Promise<HubActionResult>,
  syncPrivateHubs: () => ipcRenderer.invoke("hubs:sync-private") as Promise<PrivateHubSyncResult>,
  syncMatchesToHubs: (matchIds, hubIds) => ipcRenderer.invoke("hubs:sync-selected", matchIds, hubIds) as Promise<PrivateHubSyncResult>,
  deleteHubMatch: (hubId, matchId) => ipcRenderer.invoke("hubs:delete-match", hubId, matchId) as Promise<void>,
  getUpdateStatus: () => ipcRenderer.invoke("updates:status") as Promise<UpdateStatus>,
  checkForUpdates: () => ipcRenderer.invoke("updates:check") as Promise<UpdateStatus>,
  downloadUpdate: () => ipcRenderer.invoke("updates:download") as Promise<UpdateStatus>,
  installUpdate: () => ipcRenderer.invoke("updates:install") as Promise<void>,
  getGamePreloadUrl: (platform: GamePlatform) => ipcRenderer.invoke("game-preload:url", platform) as Promise<string>,
  getAssetUrl: (relativePath: string) => ipcRenderer.invoke("assets:url", relativePath) as Promise<string>,
  getBattlefields: () => ipcRenderer.invoke("battlefields:get") as Promise<BattlefieldOption[]>,
  notifyMatchReady: (draft) => ipcRenderer.invoke("notification:match-ready", draft) as Promise<void>,
  detectBrowsers: () => ipcRenderer.invoke("browsers:detect") as Promise<BrowserInfo[]>,
  getOverlayInfo: () => ipcRenderer.invoke("overlay:info") as Promise<OverlayInfo>,
  openOverlayTextFolder: () => ipcRenderer.invoke("overlay:open-text-folder") as Promise<void>,
  getDiagnosticsPath: () => ipcRenderer.invoke("diagnostics:path") as Promise<string>,
  getDiagnosticsSummary: () => ipcRenderer.invoke("diagnostics:summary") as Promise<CaptureDiagnosticsSummary>,
  createDiagnosticsBundle: () => ipcRenderer.invoke("diagnostics:bundle") as Promise<string>,
  openDiagnosticsFolder: () => ipcRenderer.invoke("diagnostics:open") as Promise<void>,
  takeScreenshot: () => ipcRenderer.invoke("screenshot:take") as Promise<ScreenshotResult>,
  chooseScreenshotDirectory: () => ipcRenderer.invoke("screenshot:choose-directory") as Promise<UserSettings>,
  openScreenshotDirectory: () => ipcRenderer.invoke("screenshot:open-directory") as Promise<void>,
  openExternalResource: (url: string) => ipcRenderer.invoke("external:open", url) as Promise<void>,
  trackSpotlightClick: (payload) => ipcRenderer.invoke("analytics:spotlight-click", payload) as Promise<void>,
  reportRendererEvent: (event) => ipcRenderer.invoke("capture:renderer-event", event) as Promise<void>,
  onCaptureEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CaptureEvent) => callback(payload);
    ipcRenderer.on("capture:event", listener);
    return () => ipcRenderer.removeListener("capture:event", listener);
  },
  onCaptureHealth: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CaptureHealth) => callback(payload);
    ipcRenderer.on("capture:health", listener);
    return () => ipcRenderer.removeListener("capture:health", listener);
  },
  onMatchDraft: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MatchDraft) => callback(payload);
    ipcRenderer.on("match:draft", listener);
    return () => ipcRenderer.removeListener("match:draft", listener);
  },
  onScreenshotSaved: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ScreenshotResult) => callback(payload);
    ipcRenderer.on("screenshot:saved", listener);
    return () => ipcRenderer.removeListener("screenshot:saved", listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: UpdateStatus) => callback(payload);
    ipcRenderer.on("updates:status", listener);
    return () => ipcRenderer.removeListener("updates:status", listener);
  }
};

contextBridge.exposeInMainWorld("riftlite", api);
