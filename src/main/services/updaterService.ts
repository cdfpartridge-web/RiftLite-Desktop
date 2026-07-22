import { app, BrowserWindow, shell } from "electron";
import updater from "electron-updater";
import type { UpdateStatus } from "../../shared/types.js";

const { autoUpdater } = updater;
const MAC_RELEASES_URL = "https://github.com/cdfpartridge-web/RiftLite-Desktop-Mac/releases/latest";
const WINDOWS_RELEASES_URL = "https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/latest";
const WINDOWS_LATEST_YML_URL = "https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/latest/download/latest.yml";
const WINDOWS_MANIFEST_TIMEOUT_MS = 8_000;

export interface UpdaterServiceOptions {
  enabled?: boolean;
  disabledMessage?: string;
  beforeInstall?: () => Promise<void>;
  onInstallHandoffFailed?: (error: unknown) => void;
  platform?: NodeJS.Platform;
}

export class UpdaterService {
  private readonly enabled: boolean;
  private readonly isMac: boolean;
  private checkPromise: Promise<UpdateStatus> | null = null;
  private downloadPromise: Promise<UpdateStatus> | null = null;
  private installPromise: Promise<void> | null = null;
  private installHandoffStarted = false;
  private status: UpdateStatus = {
    state: "idle",
    currentVersion: app.getVersion(),
    message: "Updater ready"
  };

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly options: UpdaterServiceOptions = {}
  ) {
    this.enabled = options.enabled ?? true;
    this.isMac = (options.platform ?? process.platform) === "darwin";
    if (!this.enabled) {
      this.status = {
        state: "not-available",
        currentVersion: app.getVersion(),
        message: options.disabledMessage ?? "Updates are disabled in this build."
      };
      return;
    }
    if (this.isMac) {
      autoUpdater.setFeedURL({
        provider: "github",
        owner: "cdfpartridge-web",
        repo: "RiftLite-Desktop-Mac"
      });
    }
    autoUpdater.autoDownload = false;
    autoUpdater.allowPrerelease = this.isMac;
    autoUpdater.on("checking-for-update", () => {
      if (!this.updatePayloadIsBusy()) {
        this.setStatus({ state: "checking", progress: undefined, message: "Checking for updates" });
      }
    });
    autoUpdater.on("update-available", (info) => {
      if (this.updatePayloadIsBusy()) return;
      this.setStatus({
        state: "available",
        latestVersion: info.version,
        progress: undefined,
        message: this.isMac
          ? `Update ${info.version} available. Mac updates need a manual install until signed builds are enabled.`
          : `Update ${info.version} available`,
        manualInstallOnly: this.isMac,
        downloadUrl: this.isMac ? MAC_RELEASES_URL : undefined
      });
    });
    autoUpdater.on("update-not-available", () => {
      if (this.updatePayloadIsBusy()) return;
      this.setStatus({
        state: "not-available",
        latestVersion: undefined,
        progress: undefined,
        manualInstallOnly: false,
        downloadUrl: undefined,
        message: "RiftLite is up to date"
      });
    });
    autoUpdater.on("download-progress", (progress) => this.setStatus({
      state: "downloading",
      message: "Downloading update",
      progress: boundedProgress(progress.percent)
    }));
    autoUpdater.on("update-downloaded", (info) => this.setStatus({
      state: "downloaded",
      latestVersion: info.version,
      progress: 100,
      message: this.isMac
        ? "Mac update downloaded, but automatic install is blocked for unsigned builds. Open the release page and install the DMG manually."
        : "Update downloaded",
      manualInstallOnly: this.isMac,
      downloadUrl: this.isMac ? MAC_RELEASES_URL : undefined
    }));
    autoUpdater.on("error", (error) => {
      const signatureFailure = /code signature|specified code requirement|not pass validation/i.test(error.message);
      const automaticHandoffFailed = this.installHandoffStarted;
      const automaticDownloadFailed = this.status.state === "downloading";
      this.installHandoffStarted = false;
      if (automaticHandoffFailed) {
        this.installPromise = null;
        this.notifyInstallHandoffFailed(error);
      }
      if (!this.isMac && this.status.latestVersion && (automaticHandoffFailed || automaticDownloadFailed)) {
        this.setStatus({
          state: "available",
          progress: undefined,
          manualInstallOnly: true,
          downloadUrl: WINDOWS_RELEASES_URL,
          message: `Automatic update failed: ${safeErrorMessage(error)} Open the GitHub release to install it manually.`
        });
        return;
      }
      this.setStatus({
        state: this.isMac && this.status.latestVersion ? "available" : "error",
        progress: undefined,
        manualInstallOnly: this.isMac,
        downloadUrl: this.isMac ? MAC_RELEASES_URL : undefined,
        message: this.isMac && signatureFailure
          ? "Mac automatic install is blocked by code-signing validation. Download the latest DMG from GitHub, quit RiftLite, and replace the app manually."
          : safeErrorMessage(error)
      });
    });
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  async check(): Promise<UpdateStatus> {
    if (!this.enabled) {
      return this.getStatus();
    }
    if (!app.isPackaged) {
      this.setStatus({ state: "not-available", message: "Updater is active in packaged builds" });
      return this.getStatus();
    }
    if (this.updatePayloadIsBusy()) {
      return this.getStatus();
    }
    if (this.checkPromise) {
      return this.checkPromise;
    }
    const operation = this.checkUnlocked();
    this.checkPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.checkPromise === operation) {
        this.checkPromise = null;
      }
    }
  }

  private async checkUnlocked(): Promise<UpdateStatus> {
    this.setStatus({
      state: "checking",
      progress: undefined,
      manualInstallOnly: false,
      downloadUrl: undefined,
      message: "Checking for updates"
    });
    const manifestVersionPromise = this.isMac
      ? Promise.resolve(undefined)
      : this.fetchWindowsManifestVersion();
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      const manifestVersion = await manifestVersionPromise;
      if (manifestVersion && isNewerVersion(manifestVersion, app.getVersion())) {
        this.setWindowsManualFallback(manifestVersion, `Update ${manifestVersion} is available from GitHub.`);
        return this.getStatus();
      }
      if (this.status.state !== "error") {
        this.setStatus({
          state: "error",
          progress: undefined,
          message: `Update check failed: ${safeErrorMessage(error)}`
        });
      }
      return this.getStatus();
    }
    const manifestVersion = await manifestVersionPromise;
    if (
      !this.isMac &&
      manifestVersion &&
      isNewerVersion(manifestVersion, app.getVersion()) &&
      (this.status.state === "not-available" || this.status.state === "checking" || this.status.state === "error")
    ) {
      this.setWindowsManualFallback(manifestVersion, `Update ${manifestVersion} is available from GitHub.`);
    } else if (this.status.state === "checking") {
      this.setStatus({
        state: "not-available",
        latestVersion: undefined,
        progress: undefined,
        manualInstallOnly: false,
        downloadUrl: undefined,
        message: "RiftLite is up to date"
      });
    }
    return this.getStatus();
  }

  async download(): Promise<UpdateStatus> {
    if (!this.enabled) {
      return this.getStatus();
    }
    if (!app.isPackaged) {
      this.setStatus({ state: "not-available", message: "Updater downloads are active in packaged builds" });
      return this.getStatus();
    }
    if (this.status.state === "downloaded" || this.installPromise) {
      return this.getStatus();
    }
    if (this.status.manualInstallOnly && this.status.downloadUrl) {
      await this.openManualRelease(this.status.downloadUrl);
      return this.getStatus();
    }
    if (this.isMac) {
      await this.openManualRelease(MAC_RELEASES_URL, "Opened the Mac release page. Download the correct arm64 or x64 DMG and replace the app manually.");
      return this.getStatus();
    }
    if (this.downloadPromise) {
      return this.downloadPromise;
    }
    if (this.status.state !== "available") {
      return this.getStatus();
    }
    const operation = this.downloadUnlocked();
    this.downloadPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.downloadPromise === operation) {
        this.downloadPromise = null;
      }
    }
  }

  private async downloadUnlocked(): Promise<UpdateStatus> {
    this.setStatus({
      state: "downloading",
      progress: 0,
      message: "Starting update download..."
    });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      if (!(this.status.state === "available" && this.status.manualInstallOnly)) {
        if (this.status.latestVersion) {
          this.setWindowsManualFallback(
            this.status.latestVersion,
            `Automatic update download failed: ${safeErrorMessage(error)}`
          );
        } else {
          this.setStatus({
            state: "error",
            progress: undefined,
            message: `Update download failed: ${safeErrorMessage(error)}`
          });
        }
      }
    }
    return this.getStatus();
  }

  async install(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    if (this.isMac) {
      await this.openManualRelease(
        MAC_RELEASES_URL,
        "Automatic Mac install is blocked until RiftLite is Developer ID signed and notarized. Install from the DMG manually."
      );
      return;
    }
    if (this.installPromise) {
      return this.installPromise;
    }
    if (this.status.state !== "downloaded") {
      throw new Error("The update has not finished downloading yet.");
    }
    const operation = this.installUnlocked();
    this.installPromise = operation;
    try {
      await operation;
    } finally {
      if (!this.installHandoffStarted && this.installPromise === operation) {
        this.installPromise = null;
      }
    }
  }

  private setStatus(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch, currentVersion: app.getVersion() };
    const window = this.getWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }
    try {
      window.webContents.send("updates:status", this.getStatus());
    } catch {
      // The renderer may disappear between the lifecycle checks and send.
      // Updater state remains available through the status IPC after relaunch.
    }
  }

  private updatePayloadIsBusy(): boolean {
    return Boolean(
      this.downloadPromise ||
      this.installPromise ||
      this.status.state === "downloading" ||
      this.status.state === "downloaded"
    );
  }

  private async installUnlocked(): Promise<void> {
    this.setStatus({
      state: "downloaded",
      message: "Finishing local capture work before installing..."
    });
    try {
      // Let the app finish capture/session work before electron-updater starts
      // its own quit. A normal app.quit() after quitAndInstall() has begun drops
      // the pending NSIS handoff and leaves the old build installed.
      await this.options.beforeInstall?.();
    } catch (error) {
      this.setStatus({
        state: "downloaded",
        message: `RiftLite could not prepare the update: ${safeErrorMessage(error)} Try Install again.`
      });
      return;
    }
    this.setStatus({
      state: "downloaded",
      message: "Closing RiftLite and installing the update..."
    });
    this.installHandoffStarted = true;
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      const automaticHandoffFailed = this.installHandoffStarted;
      this.installHandoffStarted = false;
      if (automaticHandoffFailed) {
        this.notifyInstallHandoffFailed(error);
      }
      this.setWindowsManualFallback(
        this.status.latestVersion,
        `Automatic installer launch failed: ${safeErrorMessage(error)}`
      );
    }
  }

  private async openManualRelease(url: string, successMessage?: string): Promise<void> {
    try {
      await shell.openExternal(url);
      if (successMessage) {
        this.setStatus({
          state: this.status.latestVersion ? "available" : "idle",
          progress: undefined,
          message: successMessage,
          manualInstallOnly: true,
          downloadUrl: url
        });
      }
    } catch (error) {
      this.setStatus({
        state: this.status.latestVersion ? "available" : "error",
        progress: undefined,
        manualInstallOnly: true,
        downloadUrl: url,
        message: `Could not open the release page: ${safeErrorMessage(error)}`
      });
    }
  }

  private setWindowsManualFallback(version: string | undefined, reason: string): void {
    this.setStatus({
      state: "available",
      latestVersion: version || this.status.latestVersion,
      progress: undefined,
      manualInstallOnly: true,
      downloadUrl: WINDOWS_RELEASES_URL,
      message: `${reason} Open the GitHub release to install it manually.`
    });
  }

  private notifyInstallHandoffFailed(error: unknown): void {
    try {
      this.options.onInstallHandoffFailed?.(error);
    } catch {
      // Restoring app-owned quit guards must not hide the updater fallback.
    }
  }

  private async fetchWindowsManifestVersion(): Promise<string | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WINDOWS_MANIFEST_TIMEOUT_MS);
    timeout.unref?.();
    try {
      const response = await fetch(WINDOWS_LATEST_YML_URL, {
        signal: controller.signal,
        headers: {
          "Cache-Control": "no-cache",
          "User-Agent": `RiftLite/${app.getVersion()}`
        }
      });
      if (!response.ok) {
        return undefined;
      }
      const manifest = await response.text();
      return manifest.match(/^version:\s*['"]?([^'"\s]+)['"]?/m)?.[1];
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const left = parseVersion(candidate);
  const right = parseVersion(current);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    const a = left.numbers[index];
    const b = right.numbers[index];
    if (a > b) return true;
    if (a < b) return false;
  }
  if (left.prerelease.length === 0) return right.prerelease.length > 0;
  if (right.prerelease.length === 0) return false;
  const maxPrerelease = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < maxPrerelease; index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined) return false;
    if (b === undefined) return true;
    if (a === b) continue;
    const aNumber = /^\d+$/.test(a) ? Number(a) : null;
    const bNumber = /^\d+$/.test(b) ? Number(b) : null;
    if (aNumber !== null && bNumber !== null) return aNumber > bNumber;
    if (aNumber !== null) return false;
    if (bNumber !== null) return true;
    return a > b;
  }
  return false;
}

function parseVersion(version: string): { numbers: [number, number, number]; prerelease: string[] } | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  const numbers = match.slice(1, 4).map((part) => Number(part)) as [number, number, number];
  if (numbers.some((part) => !Number.isSafeInteger(part))) return null;
  return {
    numbers,
    prerelease: match[4]?.split(".") ?? []
  };
}

function boundedProgress(value: unknown): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  const message = String(error ?? "").trim();
  return message || "Unknown updater error.";
}
