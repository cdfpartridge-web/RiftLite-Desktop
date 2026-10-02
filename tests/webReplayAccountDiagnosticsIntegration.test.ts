import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../src/preload/appPreload.ts", import.meta.url), "utf8");

describe("Web Replay desktop centre", () => {
  it("exposes trusted diagnostic and manual-retry IPC routes through the desktop bridge", () => {
    expect(mainSource).toContain('handleTrustedAppIpc("raw-capture:diagnostics"');
    expect(mainSource).toContain('handleTrustedAppIpc("raw-capture:retry-pending"');
    expect(mainSource).toContain('handleTrustedAppIpc("raw-capture:upload-incomplete"');
    expect(mainSource).toContain('handleTrustedAppIpc("raw-capture:remove-from-queue"');
    expect(mainSource).toContain('handleTrustedAppIpc("raw-capture:stop-discord-retries"');
    expect(mainSource).toContain("uploadPendingRawCapturesWithAccountRefresh(true)");
    expect(preloadSource).toContain('getWebReplayUploadDiagnostics: () => ipcRenderer.invoke("raw-capture:diagnostics")');
    expect(preloadSource).toContain('retryPendingWebReplayUploads: () => ipcRenderer.invoke("raw-capture:retry-pending")');
    expect(preloadSource).toContain('uploadIncompleteWebReplay: (captureSessionId) => ipcRenderer.invoke("raw-capture:upload-incomplete"');
    expect(preloadSource).toContain('removeWebReplayUploadFromQueue: (captureSessionId) => ipcRenderer.invoke("raw-capture:remove-from-queue"');
    expect(preloadSource).toContain('stopWebReplayDiscordRetries: (captureSessionId) => ipcRenderer.invoke("raw-capture:stop-discord-retries"');
  });

  it("routes capture setup and local video preferences through Recording & sharing", () => {
    const route = appSource.slice(appSource.indexOf('if (view === "recording-sharing")'), appSource.indexOf('if (view === "replays")'));
    expect(route).toContain("RecordingSharingPage");
    expect(route).toContain('presentation="capture"');
    expect(route).toContain("RecordingVideoSettings");
    expect(appSource.includes("rawCaptureSettingsForPlatformUpload(settings, platform, enabled)")).toBe(true);
    expect(mainSource.includes('handleTrustedAppIpc("replay:library:list-owned"')).toBe(true);
    expect(preloadSource.includes('getAccountReplayLibrary: () => ipcRenderer.invoke("replay:library:list-owned")')).toBe(true);
  });

  it("preserves recovery actions and result review independently of a ready online replay", () => {
    const recovery = appSource.slice(appSource.indexOf("function WebReplayUploadCentre"), appSource.indexOf("function EmbeddedRiftReplayView"));
    for (const required of [
      'webReplayActivityItemVisible(item, dismissedWarningKeys)',
      'onReviewResult?.(item)',
      'window.riftlite.retryPendingWebReplayUploads()',
      'window.riftlite.uploadIncompleteWebReplay(item.captureSessionId)',
      'window.riftlite.removeWebReplayUploadFromQueue(item.captureSessionId)',
      'window.riftlite.stopWebReplayDiscordRetries(item.captureSessionId)',
      'webReplayQueueItemCanBeKeptLocalOnly(item)',
      'webReplayReadyWarningDismissalKey(item)',
    ]) expect(recovery.includes(required), required).toBe(true);
  });

  it("keeps account onboarding and legacy settings as links to the canonical setup", () => {
    const account = appSource.slice(appSource.indexOf("function AccountView"), appSource.indexOf("function MatchesView"));
    expect(account.includes('onClick={onOpenWebReplays}')).toBe(true);
    expect(account.includes('Recording & sharing') || account.includes('Recording &amp; sharing')).toBe(true);
    expect(account.includes('Automatically save new Atlas Web Replays?')).toBe(false);
    expect(appSource.includes('view: "recording-sharing"')).toBe(true);
    expect(appSource.includes('onOpenWebReplays={() => onNavigate("recording-sharing")}')).toBe(true);
  });

  it("keeps queue health live and visible outside the centre", () => {
    expect(appSource).toContain("nav-status-badge");
    expect(appSource).toContain("webReplayNavBadgeTone");
    expect(appSource).toContain("refreshIntervalMs = waiting || webReplayDiagnostics?.retryInProgress ? 4_000 : 20_000");
    expect(appSource).toContain("void refreshWebReplayDiagnostics();");
    expect(appSource).toContain("homeWebReplayStatus(settings, webReplayDiagnostics, settings.defaultGamePlatform)");
    expect(appSource).toContain("function homeWebReplayStatus");
    expect(appSource).toContain('label: `${totals.failed} upload${totals.failed === 1 ? "" : "s"} failed`');
    expect(appSource).toContain('label: `${totals.pending || 1} uploading`');
  });

  it("shows local media and Web Replay delivery as independent replay badges", () => {
    expect(appSource).toContain("function replayWebDeliveryBadge");
    expect(appSource).toContain('data-web={web.tone}');
    expect(appSource).toContain('className="replay-web-open"');
    expect(appSource).toContain("hasReadyRiftLiteWebReplay(item.replay)");
    expect(appSource).toContain("raw.webReplayAutoUploadEligible === true");
    expect(appSource).toContain('mediaFilter === "web"');
    expect(appSource).toContain('label: "Web partial"');
  });
});
