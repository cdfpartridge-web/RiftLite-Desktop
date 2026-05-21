import { app, BrowserWindow } from "electron";
import updater from "electron-updater";
import type { UpdateStatus } from "../../shared/types.js";

const { autoUpdater } = updater;

export class UpdaterService {
  private status: UpdateStatus = {
    state: "idle",
    currentVersion: app.getVersion(),
    message: "Updater ready"
  };

  constructor(private readonly getWindow: () => BrowserWindow | null) {
    if (process.platform === "darwin") {
      autoUpdater.setFeedURL({
        provider: "github",
        owner: "cdfpartridge-web",
        repo: "RiftLite-Desktop-Mac"
      });
    }
    autoUpdater.autoDownload = false;
    autoUpdater.allowPrerelease = true;
    autoUpdater.on("checking-for-update", () => this.setStatus({ state: "checking", message: "Checking for updates" }));
    autoUpdater.on("update-available", (info) => this.setStatus({ state: "available", latestVersion: info.version, message: `Update ${info.version} available` }));
    autoUpdater.on("update-not-available", () => this.setStatus({ state: "not-available", message: "RiftLite is up to date" }));
    autoUpdater.on("download-progress", (progress) => this.setStatus({ state: "downloading", message: "Downloading update", progress: Math.round(progress.percent) }));
    autoUpdater.on("update-downloaded", (info) => this.setStatus({ state: "downloaded", latestVersion: info.version, message: "Update downloaded" }));
    autoUpdater.on("error", (error) => this.setStatus({ state: "error", message: error.message }));
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      this.setStatus({ state: "not-available", message: "Updater is active in packaged builds" });
      return this.getStatus();
    }
    await autoUpdater.checkForUpdates();
    return this.getStatus();
  }

  async download(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      this.setStatus({ state: "not-available", message: "Updater downloads are active in packaged builds" });
      return this.getStatus();
    }
    await autoUpdater.downloadUpdate();
    return this.getStatus();
  }

  install(): void {
    autoUpdater.quitAndInstall(false, true);
  }

  private setStatus(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch, currentVersion: app.getVersion() };
    this.getWindow()?.webContents.send("updates:status", this.getStatus());
  }
}
