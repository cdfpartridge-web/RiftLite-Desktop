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
    expect(mainSource).toContain("uploadPendingRawCapturesWithAccountRefresh(true)");
    expect(preloadSource).toContain('getWebReplayUploadDiagnostics: () => ipcRenderer.invoke("raw-capture:diagnostics")');
    expect(preloadSource).toContain('retryPendingWebReplayUploads: () => ipcRenderer.invoke("raw-capture:retry-pending")');
    expect(preloadSource).toContain('uploadIncompleteWebReplay: (captureSessionId) => ipcRenderer.invoke("raw-capture:upload-incomplete"');
    expect(preloadSource).toContain('removeWebReplayUploadFromQueue: (captureSessionId) => ipcRenderer.invoke("raw-capture:remove-from-queue"');
  });

  it("makes Review > Web Replays the setup, status, and recovery centre", () => {
    expect(appSource).toContain("function WebReplayUploadCentre");
    expect(appSource).toContain("Enable private Atlas replays");
    expect(appSource).toContain('setPlatformUpload("atlas"');
    expect(appSource).toContain('setPlatformUpload("tcga"');
    expect(appSource).toContain("rawCaptureSettingsForPlatformUpload(settings, platform, enabled)");
    expect(appSource).toContain("Resume replay capture");
    expect(appSource).toContain("diagnostics?.queue");
    expect(appSource).toContain("Upload activity");
    expect(appSource).toContain("Retry eligible uploads");
    expect(appSource).toContain('hasRetryableQueueItem = queue.some((item) => item.recommendedAction === "retry")');
    expect(appSource).toContain("totals.pending || hasRetryableQueueItem");
    expect(appSource).toContain("window.riftlite.retryPendingWebReplayUploads()");
    expect(appSource).toContain("Upload anyway");
    expect(appSource).toContain("Keep local only");
    expect(appSource).toContain("window.riftlite.uploadIncompleteWebReplay(item.captureSessionId)");
    expect(appSource).toContain("window.riftlite.removeWebReplayUploadFromQueue(item.captureSessionId)");
    expect(appSource).toContain("webReplayQueueItemCanBeKeptLocalOnly(item)");
    expect(appSource).toContain('className="web-replay-technical-details"');
    expect(appSource).toContain("replayDeliveryErrorMessage(item.error, {");
    expect(appSource).toContain("httpStatus: item.lastHttpStatus");
  });

  it("keeps healthy upload diagnostics compact so the replay library retains the page", () => {
    expect(appSource).toContain('const [controlsExpanded, setControlsExpanded] = useState(status.tone !== "ready")');
    expect(appSource).toContain('if (status.tone !== "ready" || actionError) setControlsExpanded(true)');
    expect(appSource).toContain('data-expanded={controlsExpanded}');
    expect(appSource).toContain('aria-expanded={controlsExpanded}');
    expect(appSource).toContain('aria-controls="web-replay-upload-controls"');
    expect(appSource).toContain('id="web-replay-upload-controls"');
    expect(appSource).toContain('hidden={!controlsExpanded}');
    expect(appSource).toContain('"Hide upload controls"');
    expect(appSource).toContain('"Manage uploads"');
  });

  it("keeps Account and Settings as concise deep-links instead of duplicate controls", () => {
    expect(appSource).toContain('className="account-web-replay-summary"');
    expect(appSource).toContain("Manage Web Replays");
    expect(appSource).toContain("Open Web Replay centre");
    expect(appSource).toContain("showPostLinkWebReplayChoice");
    expect(appSource).toContain("Automatically save new Atlas Web Replays?");
    expect(appSource).not.toContain("Web Replay upload diagnostics");
  });

  it("keeps queue health live and visible outside the centre", () => {
    expect(appSource).toContain("nav-status-badge");
    expect(appSource).toContain("webReplayNavBadgeTone");
    expect(appSource).toContain("refreshIntervalMs = waiting || webReplayDiagnostics?.retryInProgress ? 4_000 : 20_000");
    expect(appSource).toContain("void refreshWebReplayDiagnostics();");
    expect(appSource).toContain("homeWebReplayStatus(settings, webReplayDiagnostics, activePlatform)");
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
