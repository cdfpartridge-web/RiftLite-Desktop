import { app, BrowserWindow, shell } from "electron";
import updater from "electron-updater";
import type { UpdateStatus } from "../../shared/types.js";

const { autoUpdater } = updater;
const MAC_RELEASES_URL = "https://github.com/cdfpartridge-web/RiftLite-Desktop-Mac/releases/latest";
const WINDOWS_RELEASES_URL = "https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/latest";
const WINDOWS_LATEST_YML_URL = "https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/latest/download/latest.yml";
const isMac = process.platform === "darwin";

export class UpdaterService {
  private status: UpdateStatus = {
    state: "idle",
    currentVersion: app.getVersion(),
    message: "Updater ready"
  };

  constructor(private readonly getWindow: () => BrowserWindow | null) {
    if (isMac) {
      autoUpdater.setFeedURL({
        provider: "github",
        owner: "cdfpartridge-web",
        repo: "RiftLite-Desktop-Mac"
      });
    }
    autoUpdater.autoDownload = false;
    autoUpdater.allowPrerelease = isMac;
    autoUpdater.on("checking-for-update", () => this.setStatus({ state: "checking", message: "Checking for updates" }));
    autoUpdater.on("update-available", (info) => this.setStatus({
      state: "available",
      latestVersion: info.version,
      progress: undefined,
      message: isMac
        ? `Update ${info.version} available. Mac updates need a manual install until signed builds are enabled.`
        : `Update ${info.version} available`,
      manualInstallOnly: isMac,
      downloadUrl: isMac ? MAC_RELEASES_URL : undefined
    }));
    autoUpdater.on("update-not-available", () => this.setStatus({
      state: "not-available",
      latestVersion: undefined,
      progress: undefined,
      manualInstallOnly: false,
      downloadUrl: undefined,
      message: "RiftLite is up to date"
    }));
    autoUpdater.on("download-progress", (progress) => this.setStatus({ state: "downloading", message: "Downloading update", progress: Math.round(progress.percent) }));
    autoUpdater.on("update-downloaded", (info) => this.setStatus({
      state: "downloaded",
      latestVersion: info.version,
      message: isMac
        ? "Mac update downloaded, but automatic install is blocked for unsigned builds. Open the release page and install the DMG manually."
        : "Update downloaded",
      manualInstallOnly: isMac,
      downloadUrl: isMac ? MAC_RELEASES_URL : undefined
    }));
    autoUpdater.on("error", (error) => {
      const signatureFailure = /code signature|specified code requirement|not pass validation/i.test(error.message);
      this.setStatus({
        state: "error",
        progress: undefined,
        manualInstallOnly: isMac,
        downloadUrl: isMac ? MAC_RELEASES_URL : undefined,
        message: isMac && signatureFailure
          ? "Mac automatic install is blocked by code-signing validation. Download the latest DMG from GitHub, quit RiftLite, and replace the app manually."
          : error.message
      });
    });
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      this.setStatus({ state: "not-available", message: "Updater is active in packaged builds" });
      return this.getStatus();
    }
    const manifestVersion = isMac ? undefined : await this.fetchWindowsManifestVersion();
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      if (manifestVersion && isNewerVersion(manifestVersion, app.getVersion())) {
        this.setStatus({
          state: "available",
          latestVersion: manifestVersion,
          progress: undefined,
          manualInstallOnly: true,
          downloadUrl: WINDOWS_RELEASES_URL,
          message: `Update ${manifestVersion} available from GitHub`
        });
        return this.getStatus();
      }
      throw error;
    }
    if (!isMac && manifestVersion && isNewerVersion(manifestVersion, app.getVersion()) && this.status.state === "not-available") {
      this.setStatus({
        state: "available",
        latestVersion: manifestVersion,
        progress: undefined,
        manualInstallOnly: true,
        downloadUrl: WINDOWS_RELEASES_URL,
        message: `Update ${manifestVersion} available from GitHub`
      });
    }
    return this.getStatus();
  }

  async download(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      this.setStatus({ state: "not-available", message: "Updater downloads are active in packaged builds" });
      return this.getStatus();
    }
    if (this.status.manualInstallOnly && this.status.downloadUrl) {
      await shell.openExternal(this.status.downloadUrl);
      return this.getStatus();
    }
    if (isMac) {
      await shell.openExternal(MAC_RELEASES_URL);
      this.setStatus({
        state: this.status.latestVersion ? "available" : "idle",
        progress: undefined,
        message: "Opened the Mac release page. Download the correct arm64 or x64 DMG and replace the app manually.",
        manualInstallOnly: true,
        downloadUrl: MAC_RELEASES_URL
      });
      return this.getStatus();
    }
    await autoUpdater.downloadUpdate();
    return this.getStatus();
  }

  async install(): Promise<void> {
    if (isMac) {
      await shell.openExternal(MAC_RELEASES_URL);
      this.setStatus({
        state: "available",
        progress: undefined,
        message: "Automatic Mac install is blocked until RiftLite is Developer ID signed and notarized. Install from the DMG manually.",
        manualInstallOnly: true,
        downloadUrl: MAC_RELEASES_URL
      });
      return;
    }
    autoUpdater.quitAndInstall(false, true);
  }

  private setStatus(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch, currentVersion: app.getVersion() };
    this.getWindow()?.webContents.send("updates:status", this.getStatus());
  }

  private async fetchWindowsManifestVersion(): Promise<string | undefined> {
    try {
      const response = await fetch(WINDOWS_LATEST_YML_URL, {
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
    }
  }
}

function isNewerVersion(candidate: string, current: string): boolean {
  const left = parseVersionParts(candidate);
  const right = parseVersionParts(current);
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

function parseVersionParts(version: string): number[] {
  return version.replace(/^v/i, "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}
