import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setFeedURL: vi.fn(),
  on: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  openExternal: vi.fn()
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

import { UpdaterService } from "../src/main/services/updaterService";

describe("UpdaterService optional disabled mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
});
