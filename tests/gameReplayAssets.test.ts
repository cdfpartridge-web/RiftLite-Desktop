import { describe, expect, it } from "vitest";
import { deriveGameReplayAssets, type GameReplayAssetsInput } from "../src/shared/gameReplayAssets.js";
import type { MatchDraft, RawCaptureReplayMetadata, ReplayRecord, ReplayVideoAsset } from "../src/shared/types.js";

const match: MatchDraft = {
  id: "match-one", platform: "atlas", status: "saved", capturedAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z",
  result: "Win", format: "Bo1", score: "8-6", myName: "Player", opponentName: "Opponent", myChampion: "Ahri", opponentChampion: "Irelia",
  myBattlefield: "", opponentBattlefield: "", deckName: "", deckSourceId: "", flags: "", notes: "", games: [], rawEvidence: [],
  sync: { community: "disabled", hubs: {}, teams: {} }
};
const video: ReplayVideoAsset = {
  path: "C:/replays/video.webm", url: "riftlite-media://video", filename: "video.webm", directory: "C:/replays", mimeType: "video/webm",
  source: "game-frame-direct", platform: "atlas", startedAt: match.capturedAt, endedAt: match.capturedAt, durationMs: 60000,
  sizeBytes: 10000, width: 1920, height: 1080, fps: 24, captureIntervalMs: 1000, bitrateKbps: 1100, codec: "vp8", quality: "sharp"
};
const raw: RawCaptureReplayMetadata = { provider: "riftlite-v2", captureSessionId: "capture-one", messageCount: 30, uploadStatus: "not-uploaded", localPath: "C:/replays/capture.json" };
function replay(patch: Partial<ReplayRecord> = {}): ReplayRecord {
  return { id: "replay-one", matchId: match.id, platform: "atlas", capturedAt: match.capturedAt, title: "Ahri vs Irelia", players: { me: "Player", opponent: "Opponent" }, events: [], ...patch };
}
function assets(patch: Partial<GameReplayAssetsInput> = {}) {
  return deriveGameReplayAssets({ match, accountReady: true, webCaptureEnabled: true, videoRecordingEnabled: true, gameLogAvailable: false, ...patch });
}

describe("per-game replay assets", () => {
  it("keeps a video and readable log usable when the independent interactive upload fails", () => {
    const [web, local, log] = assets({ replay: replay({ video, rawCapture: { ...raw, uploadStatus: "failed", webReplayAutoUploadEligible: true } }), gameLogAvailable: true });
    expect(web).toMatchObject({ tone: "attention", action: "delivery" });
    expect(local).toMatchObject({ tone: "ready", action: "watch-video" });
    expect(log).toMatchObject({ tone: "ready", action: "view-log" });
  });

  it("does not claim a historical asset exists just because recording is enabled", () => {
    const [web, local, log] = assets({ replay: replay() });
    expect(web.status).toBe("Not captured");
    expect(local.status).toBe("Not recorded here");
    expect(log.status).toBe("Not available");
    expect([web, local, log].every((asset) => asset.tone === "neutral")).toBe(true);
  });

  it("opens a ready partial replay rather than presenting it as a failed upload", () => {
    const [web] = assets({ replay: replay({ rawCapture: { ...raw, uploadStatus: "uploaded", processingStatus: "ready", partialWarnings: ["Opening turn missing"], uploadUrl: "https://www.riftlite.com/replays/one" } }) });
    expect(web).toMatchObject({ status: "Ready · partial", tone: "ready", action: "watch-web" });
  });

  it("never labels an uploaded but still processing board ready", () => {
    const [web] = assets({ replay: replay({ rawCapture: { ...raw, uploadStatus: "uploaded", processingStatus: "processing", uploadUrl: "https://www.riftlite.com/replays/one" } }) });
    expect(web).toMatchObject({ status: "Preparing replay", action: "delivery", tone: "pending" });
  });

  it("uses fresh cloud processing status ahead of stale local ready metadata", () => {
    const [web] = assets({ replay: replay({ rawCapture: { ...raw, processingStatus: "ready", deliveryStage: "ready" } }), cloudReplay: { id: "one", url: "https://www.riftlite.com/replays/one", status: "processing" } });
    expect(web.status).toBe("Preparing replay");
  });

  it("does not gate uploading a captured replay on reviewing its match result", () => {
    const source = replay({ rawCapture: { ...raw, resultStatus: "pending" } });
    expect(assets({ match: { ...match, status: "pending-review" }, replay: source })[0]).toMatchObject({ status: "Saved on this computer", action: "upload" });
    expect(assets({ replay: source })[0].action).toBe("upload");
  });

  it("offers manual upload for a local capture, and setup when its prerequisites are missing", () => {
    const source = replay({ rawCapture: raw });
    expect(assets({ replay: source })[0].action).toBe("upload");
    expect(assets({ replay: source, accountReady: false })[0]).toMatchObject({ action: "setup", actionLabel: "Connect account" });
    expect(assets({ replay: source, webCaptureEnabled: false })[0].action).toBe("upload");
  });

  it("preserves kept-local intent instead of presenting the old eligibility flag as queued", () => {
    const [web] = assets({ replay: replay({ rawCapture: { ...raw, webReplayAutoUploadEligible: true, uploadQueueRemoval: { removedAt: match.capturedAt, reason: "user-kept-local", uploadStatus: "not-uploaded" } } }) });
    expect(web).toMatchObject({ status: "Saved on this computer", action: "upload" });
  });

  it("shows an account-owned cloud-only replay without inventing a local video or log", () => {
    const [web, local, log] = assets({ match: null, cloudReplay: { id: "one", url: "https://www.riftlite.com/replays/one", status: "ready" } });
    expect(web.action).toBe("watch-web");
    expect(local).toMatchObject({ status: "Not recorded here", tone: "neutral" });
    expect(local.description).toContain("computer that recorded");
    expect(log.action).toBeUndefined();
  });

  it("retains ready replay viewing when future upload and recording settings are off", () => {
    const [web, local] = assets({ replay: replay({ video, rawCapture: { ...raw, processingStatus: "ready", uploadUrl: "https://www.riftlite.com/replays/one" } }), accountReady: false, webCaptureEnabled: false, videoRecordingEnabled: false });
    expect(web.action).toBe("watch-web");
    expect(local.action).toBe("watch-video");
  });

  it("opens the durable match association when no local replay was kept", () => {
    expect(assets({ match: { ...match, keepReplay: false, webReplayId: "online-one" } })[0]).toMatchObject({ status: "Online", action: "watch-web", url: "https://www.riftlite.com/replays/online-one" });
  });

  it("distinguishes a verified missing video from a preserved partial recording", () => {
    const source = replay({ video: { ...video, containerFinalized: false } });
    expect(assets({ replay: source })[1]).toMatchObject({ status: "Partial recording", action: "watch-video" });
    expect(assets({ replay: source, videoFileAvailable: false })[1]).toMatchObject({ status: "File not found", action: "setup" });
  });

  it("explains unavailable TCGA logs without calling the replay broken", () => {
    const log = assets({ match: { ...match, platform: "tcga" } })[2];
    expect(log).toMatchObject({ tone: "neutral", status: "Not available" });
    expect(log.description).toContain("Atlas");
  });
});
