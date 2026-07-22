import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setFeedURL: vi.fn(),
  on: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  openExternal: vi.fn(),
  fetch: vi.fn()
}));

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.9.0",
    isPackaged: true
  },
  BrowserWindow: class MockBrowserWindow {},
  shell: {
    openExternal: mocks.openExternal
  }
}));

vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: {
      setFeedURL: mocks.setFeedURL,
      on: mocks.on,
      checkForUpdates: mocks.checkForUpdates,
      downloadUpdate: mocks.downloadUpdate,
      quitAndInstall: mocks.quitAndInstall,
      autoDownload: true,
      allowPrerelease: false
    }
  }
}));

import { isNewerVersion, UpdaterService } from "../src/main/services/updaterService";

function updaterListener<T extends (...args: never[]) => unknown>(event: string): T | undefined {
  return mocks.on.mock.calls.find(([candidate]) => candidate === event)?.[1] as T | undefined;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("UpdaterService", () => {
  beforeEach(() => {
    mocks.setFeedURL.mockReset();
    mocks.on.mockReset();
    mocks.checkForUpdates.mockReset().mockResolvedValue(undefined);
    mocks.downloadUpdate.mockReset().mockResolvedValue([]);
    mocks.quitAndInstall.mockReset();
    mocks.openExternal.mockReset().mockResolvedValue(undefined);
    mocks.fetch.mockReset().mockResolvedValue({
      ok: true,
      text: async () => "version: 0.9.0\n"
    });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterAll(() => vi.unstubAllGlobals());

  it("never initializes, checks, downloads, opens, or installs from a release feed", async () => {
    const service = new UpdaterService(() => null, {
      enabled: false,
      disabledMessage: "Updates are disabled in this build."
    });
    const expectedStatus = {
      state: "not-available",
      currentVersion: "0.9.0",
      message: "Updates are disabled in this build."
    };

    expect(service.getStatus()).toEqual(expectedStatus);
    await expect(service.check()).resolves.toEqual(expectedStatus);
    await expect(service.download()).resolves.toEqual(expectedStatus);
    await expect(service.install()).resolves.toBeUndefined();

    expect(mocks.setFeedURL).not.toHaveBeenCalled();
    expect(mocks.on).not.toHaveBeenCalled();
    expect(mocks.checkForUpdates).not.toHaveBeenCalled();
    expect(mocks.downloadUpdate).not.toHaveBeenCalled();
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it("finishes app-owned shutdown work before handing quit to the installer", async () => {
    const beforeInstall = vi.fn(async () => undefined);
    const service = new UpdaterService(() => null, { beforeInstall });
    const downloadedListener = updaterListener(
      "update-downloaded"
    ) as
      | ((info: { version: string }) => void)
      | undefined;

    expect(downloadedListener).toBeTypeOf("function");
    downloadedListener?.({ version: "0.9.1" });

    await service.install();

    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(mocks.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(beforeInstall.mock.invocationCallOrder[0]).toBeLessThan(mocks.quitAndInstall.mock.invocationCallOrder[0]);
  });

  it("does not quit when an update has not finished downloading", async () => {
    const beforeInstall = vi.fn(async () => undefined);
    const service = new UpdaterService(() => null, { beforeInstall });

    await expect(service.install()).rejects.toThrow("not finished downloading");
    expect(beforeInstall).not.toHaveBeenCalled();
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
  });

  it("coalesces repeated Install clicks while local shutdown work is finishing", async () => {
    const preparation = deferred<void>();
    const beforeInstall = vi.fn(() => preparation.promise);
    const service = new UpdaterService(() => null, { beforeInstall });
    updaterListener<(info: { version: string }) => void>("update-downloaded")?.({ version: "0.9.10" });

    const firstInstall = service.install();
    const secondInstall = service.install();
    await Promise.resolve();

    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
    expect(service.getStatus().message).toContain("Finishing local capture work");

    preparation.resolve();
    await Promise.all([firstInstall, secondInstall]);

    expect(mocks.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("keeps a downloaded update retryable when app-owned preparation fails", async () => {
    const onInstallHandoffFailed = vi.fn();
    const service = new UpdaterService(() => null, {
      beforeInstall: vi.fn(async () => {
        throw new Error("capture finalizer unavailable");
      }),
      onInstallHandoffFailed
    });
    updaterListener<(info: { version: string }) => void>("update-downloaded")?.({ version: "0.9.10" });

    await service.install();

    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({
      state: "downloaded",
      latestVersion: "0.9.10"
    });
    expect(service.getStatus().message).toContain("capture finalizer unavailable");
    expect(onInstallHandoffFailed).not.toHaveBeenCalled();
  });

  it("restores app-owned quit guards when the installer handoff fails", async () => {
    const onInstallHandoffFailed = vi.fn();
    const service = new UpdaterService(() => null, { onInstallHandoffFailed });
    updaterListener<(info: { version: string }) => void>("update-downloaded")?.({ version: "0.9.10" });
    const errorListener = updaterListener<(error: Error) => void>("error");
    mocks.quitAndInstall.mockImplementation(() => {
      errorListener?.(new Error("installer process did not start"));
    });

    await service.install();

    expect(onInstallHandoffFailed).toHaveBeenCalledOnce();
    expect(service.getStatus()).toMatchObject({
      state: "available",
      latestVersion: "0.9.10",
      manualInstallOnly: true
    });
  });

  it("coalesces repeated downloads and ignores stale check events once a payload is ready", async () => {
    const download = deferred<string[]>();
    mocks.downloadUpdate.mockReturnValue(download.promise);
    const service = new UpdaterService(() => null);
    updaterListener<(info: { version: string }) => void>("update-available")?.({ version: "0.9.10" });

    const firstDownload = service.download();
    const secondDownload = service.download();
    expect(mocks.downloadUpdate).toHaveBeenCalledOnce();

    updaterListener<(info: { version: string }) => void>("update-downloaded")?.({ version: "0.9.10" });
    updaterListener<() => void>("checking-for-update")?.();
    updaterListener<() => void>("update-not-available")?.();
    updaterListener<(info: { version: string }) => void>("update-available")?.({ version: "0.9.11" });
    download.resolve(["update.exe"]);
    await Promise.all([firstDownload, secondDownload]);

    expect(service.getStatus()).toMatchObject({
      state: "downloaded",
      latestVersion: "0.9.10",
      progress: 100
    });
  });

  it("falls back to the Windows release page when an automatic download fails", async () => {
    mocks.downloadUpdate.mockRejectedValue(new Error("cache write failed"));
    const service = new UpdaterService(() => null);
    updaterListener<(info: { version: string }) => void>("update-available")?.({ version: "0.9.10" });

    const status = await service.download();

    expect(status).toMatchObject({
      state: "available",
      latestVersion: "0.9.10",
      manualInstallOnly: true,
      downloadUrl: "https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/latest"
    });
    expect(status.message).toContain("cache write failed");
  });

  it("coalesces checks and uses the bounded manifest fallback when the updater check fails", async () => {
    const check = deferred<undefined>();
    mocks.checkForUpdates.mockReturnValue(check.promise);
    mocks.fetch.mockResolvedValue({
      ok: true,
      text: async () => "version: 0.9.10\n"
    });
    const service = new UpdaterService(() => null);

    const firstCheck = service.check();
    const secondCheck = service.check();
    expect(mocks.checkForUpdates).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledOnce();

    check.reject(new Error("provider unavailable"));
    const [firstStatus, secondStatus] = await Promise.all([firstCheck, secondCheck]);

    expect(firstStatus).toEqual(secondStatus);
    expect(firstStatus).toMatchObject({
      state: "available",
      latestVersion: "0.9.10",
      manualInstallOnly: true
    });
  });

  it("uses the manual DMG path on macOS without invoking automatic download or install", async () => {
    const service = new UpdaterService(() => null, { platform: "darwin" });
    expect(mocks.setFeedURL).toHaveBeenCalledWith({
      provider: "github",
      owner: "cdfpartridge-web",
      repo: "RiftLite-Desktop-Mac"
    });
    updaterListener<(info: { version: string }) => void>("update-available")?.({ version: "0.9.10" });

    expect(service.getStatus()).toMatchObject({
      state: "available",
      latestVersion: "0.9.10",
      manualInstallOnly: true
    });
    await service.download();
    await service.install();

    expect(mocks.openExternal).toHaveBeenCalledTimes(2);
    expect(mocks.openExternal).toHaveBeenCalledWith("https://github.com/cdfpartridge-web/RiftLite-Desktop-Mac/releases/latest");
    expect(mocks.downloadUpdate).not.toHaveBeenCalled();
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
  });

  it("does not throw while broadcasting an update after the renderer is destroyed", () => {
    const send = vi.fn();
    const destroyedWindow = {
      isDestroyed: () => true,
      webContents: {
        isDestroyed: () => false,
        send
      }
    };
    new UpdaterService(() => destroyedWindow as never);

    expect(() => {
      updaterListener<(info: { version: string }) => void>("update-available")?.({ version: "0.9.10" });
    }).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("clamps updater progress before sending it to the renderer", () => {
    const service = new UpdaterService(() => null);
    const progress = updaterListener<(value: { percent: number }) => void>("download-progress");

    progress?.({ percent: 148.7 });
    expect(service.getStatus().progress).toBe(100);
    progress?.({ percent: -12 });
    expect(service.getStatus().progress).toBe(0);
    progress?.({ percent: Number.NaN });
    expect(service.getStatus().progress).toBe(0);
  });
});

describe("updater release version ordering", () => {
  it("orders stable and prerelease SemVer values without accepting malformed manifests", () => {
    expect(isNewerVersion("0.9.10", "0.9.9")).toBe(true);
    expect(isNewerVersion("v0.10.0", "0.9.99")).toBe(true);
    expect(isNewerVersion("0.9.10", "0.9.10-beta.2")).toBe(true);
    expect(isNewerVersion("0.9.10-beta.2", "0.9.10-beta.1")).toBe(true);
    expect(isNewerVersion("0.9.10-beta", "0.9.10-beta.1")).toBe(false);
    expect(isNewerVersion("0.9.10-beta.1", "0.9.10-beta")).toBe(true);
    expect(isNewerVersion("0.9.10-beta.1", "0.9.10")).toBe(false);
    expect(isNewerVersion("release-10", "0.9.0")).toBe(false);
    expect(isNewerVersion("0.9", "0.8.99")).toBe(false);
  });
});
