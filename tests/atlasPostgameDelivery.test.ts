import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RawCaptureService } from "../src/main/services/rawCaptureService";
import type { RiftLiteStore } from "../src/main/services/store";
import type { UserSettings } from "../src/shared/types";

const temporary: string[] = [];
const remoteId = "rl2_" + "a".repeat(32);
const envelope = { format: "riftatlas-replay", version: 2, nodes: [["o", []]], root: { r: 0 } };
const metadata = (games: unknown[] = []) => ({ accountId: "owner", canManage: true, available: games.length > 0, games });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const path of temporary.splice(0)) {
    const absolute = resolve(path);
    if (dirname(absolute) !== resolve(tmpdir()) || !basename(absolute).startsWith("riftlite-atlas-postgame-")) throw new Error("Unsafe test cleanup path");
    await rm(absolute, { recursive: true, force: true });
  }
});

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), "riftlite-atlas-postgame-")); temporary.push(directory);
  const rawDirectory = join(directory, "Raw Capture"); await mkdir(rawDirectory);
  const state = { parentActive: true, settings: {
    replayDirectory: directory, accountUid: "owner", firebaseRefreshToken: "synthetic-refresh",
    accountLastVerifiedAt: new Date().toISOString(), accountLastVerificationError: "",
    rawCapture: { enabled: true, webReplayAutoUploadEnabled: true, webReplayAutoUploadAccountUid: "owner" },
  } as UserSettings };
  const store = { getSettings: vi.fn(async () => structuredClone(state.settings)),
    hasActiveRawCaptureParent: vi.fn(async () => state.parentActive),
    getReplays: vi.fn(() => { throw new Error("No full replay-library read expected"); }),
    saveReplay: vi.fn(() => { throw new Error("No replay mutation expected"); }) };
  const token = vi.fn(async () => "synthetic-id-token");
  const service = new RawCaptureService(store as unknown as RiftLiteStore, token);
  async function capture(id = "capture-1", ageMs = 60_000, writeRaw = true) {
    const completedAt = new Date(Date.now() - ageMs).toISOString();
    const localPath = join(rawDirectory, id + ".json"), indexPath = localPath + ".riftlite-index.json";
    const payload = { schema: "riftreplay-raw-capture", version: 1, capture: { captureSessionId: id }, messages: [] };
    const manifest = {
      schema: "riftlite-raw-capture-index", version: 1, platform: "atlas", artifactEncoding: "json",
      localPath, indexPath, updatedAt: completedAt, requiresLocalReplayParent: true, localReplayId: "local-" + id,
      identity: { platform: "atlas", captureSessionId: id, completedAt },
      metadata: { provider: "riftlite-v2", captureSessionId: id, localPath, messageCount: 20,
        uploadId: remoteId, uploadStatus: "uploaded", processingStatus: "ready", captureCompletedAt: completedAt,
        webReplayAutoUploadEligible: true, webReplayAutoUploadAccountUid: "owner", visibility: "public" },
    };
    if (writeRaw) await writeFile(localPath, JSON.stringify(payload));
    const persist = () => writeFile(indexPath, JSON.stringify(manifest)); await persist();
    return { manifest, payload, localPath, indexPath, persist };
  }
  return { state, store, service, token, capture, rawDirectory };
}

describe("automatic Atlas post-game capture delivery", () => {
  it("discovers at most ten recent ready captures from metadata without opening raw files or the replay library", async () => {
    const h = await harness();
    for (let index = 0; index < 12; index++) await h.capture("recent-" + index, (index + 1) * 1000, false);
    await h.capture("expired", 6 * 60 * 60 * 1000 + 1000, false);
    const captures = await h.service.listAutomaticAtlasPostgameCaptures();
    expect(captures).toHaveLength(10);
    expect(captures[0]).toMatchObject({ captureSessionId: "recent-0", remoteReplayId: remoteId, accountUid: "owner" });
    expect(captures.every(item => typeof item.completedAt === "number")).toBe(true);
    expect(h.token).not.toHaveBeenCalled(); expect(h.store.getReplays).not.toHaveBeenCalled();
  });

  it.each(["tcga", "legacy", "processing", "capture-consent", "current-consent", "account", "parent"])("excludes an ineligible %s capture", async condition => {
    const h = await harness(), c = await h.capture();
    if (condition === "tcga") c.manifest.platform = "tcga";
    if (condition === "legacy") c.manifest.metadata.provider = "riftreplay";
    if (condition === "processing") c.manifest.metadata.processingStatus = "processing";
    if (condition === "capture-consent") c.manifest.metadata.webReplayAutoUploadEligible = false;
    if (condition === "current-consent") h.state.settings.rawCapture.webReplayAutoUploadEnabled = false;
    if (condition === "account") h.state.settings.accountUid = "someone-else";
    if (condition === "parent") h.state.parentActive = false;
    await c.persist();
    expect(await h.service.listAutomaticAtlasPostgameCaptures()).toEqual([]);
    await expect(h.service.readAutomaticAtlasPostgameCapture("capture-1")).rejects.toThrow();
    await expect(h.service.sendAutomaticAtlasPostgame("capture-1", 1, envelope)).rejects.toThrow();
    expect(h.token).not.toHaveBeenCalled();
  });

  it("rejects duplicate capture identities instead of selecting the first manifest", async () => {
    const h = await harness(), c = await h.capture();
    await writeFile(join(h.rawDirectory, "duplicate.riftlite-index.json"), JSON.stringify(c.manifest));
    expect(await h.service.listAutomaticAtlasPostgameCaptures()).toEqual([]);
    await expect(h.service.readAutomaticAtlasPostgameCapture("capture-1")).rejects.toThrow(/ambiguous/);
  });

  it("uses the existing parentless recovery rule without requiring a logged match", async () => {
    const h = await harness(), c = await h.capture(); h.state.parentActive = false;
    Object.assign(c.manifest, { requiresLocalReplayParent: false, localReplayId: undefined, recoveredFromJournalAt: new Date().toISOString() });
    await c.persist();
    expect(await h.service.listAutomaticAtlasPostgameCaptures()).toHaveLength(1);
    expect(await h.service.readAutomaticAtlasPostgameCapture("capture-1")).toEqual(c.payload);
  });

  it.each(["json", "gzip"])("reads bounded %s capture data without changing the original or normal upload metadata", async encoding => {
    const h = await harness(), c = await h.capture();
    c.manifest.artifactEncoding = encoding;
    if (encoding === "gzip") await writeFile(c.localPath, gzipSync(JSON.stringify(c.payload)));
    await c.persist();
    const rawBefore = await readFile(c.localPath), manifestBefore = await readFile(c.indexPath);
    expect(await h.service.readAutomaticAtlasPostgameCapture("capture-1")).toEqual(c.payload);
    expect(await readFile(c.localPath)).toEqual(rawBefore); expect(await readFile(c.indexPath)).toEqual(manifestBefore);
    expect(h.token).not.toHaveBeenCalled();
  });

  it("rejects mismatched raw capture identity and oversized decompression", async () => {
    const h = await harness(), c = await h.capture();
    await writeFile(c.localPath, JSON.stringify({ ...c.payload, capture: { captureSessionId: "other-capture" } }));
    await expect(h.service.readAutomaticAtlasPostgameCapture("capture-1")).rejects.toThrow(/identity/);
    c.manifest.artifactEncoding = "gzip"; await c.persist();
    await writeFile(c.localPath, gzipSync(Buffer.alloc(32 * 1024 * 1024 + 1)));
    await expect(h.service.readAutomaticAtlasPostgameCapture("capture-1")).rejects.toThrow();
  });

  it("checks ownership metadata then attaches privately with the server account binding and no-replacement precondition", async () => {
    const h = await harness(), c = await h.capture();
    const original = await readFile(c.indexPath);
    const fetcher = vi.fn().mockResolvedValueOnce(json(metadata())).mockResolvedValueOnce(json(metadata([{ gameNumber: 1, shared: false }])));
    vi.stubGlobal("fetch", fetcher);
    expect(await h.service.sendAutomaticAtlasPostgame("capture-1", 1, envelope)).toBe("attached");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe(`https://www.riftlite.com/api/v2/replays/${remoteId}/atlas-postgame?metadata=1`);
    const init = fetcher.mock.calls[1][1];
    expect(init).toMatchObject({ method: "PUT", redirect: "error", headers: { Authorization: "Bearer synthetic-id-token" } });
    expect(JSON.parse(init.body)).toEqual({ replay: envelope, expectedAccountId: "owner", expectedSha256: null });
    expect(await readFile(c.indexPath)).toEqual(original); expect(h.store.saveReplay).not.toHaveBeenCalled();
  });

  it("skips a pre-existing game without overwriting it or resetting its private/shared choice", async () => {
    const h = await harness(); await h.capture();
    const fetcher = vi.fn().mockResolvedValue(json(metadata([{ gameNumber: 2, shared: true, sha256: "manual-import" }]))); vi.stubGlobal("fetch", fetcher);
    expect(await h.service.sendAutomaticAtlasPostgame("capture-1", 2, envelope)).toBe("exists");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["consent", "parent", "remote-id", "account"])("rechecks %s after metadata and prevents the upload when it changes", async condition => {
    const h = await harness(), c = await h.capture();
    const fetcher = vi.fn(async () => {
      if (condition === "consent") h.state.settings.rawCapture.webReplayAutoUploadEnabled = false;
      if (condition === "parent") h.state.parentActive = false;
      if (condition === "account") h.state.settings.accountUid = "new-owner";
      if (condition === "remote-id") { c.manifest.metadata.uploadId = "rl2_" + "b".repeat(32); await c.persist(); }
      return json(metadata());
    }); vi.stubGlobal("fetch", fetcher);
    await expect(h.service.sendAutomaticAtlasPostgame("capture-1", 1, envelope)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rechecks consent before a network retry instead of sending another request", async () => {
    const h = await harness(); await h.capture();
    const fetcher = vi.fn(async () => { h.state.settings.rawCapture.webReplayAutoUploadEnabled = false; return json({ error: "busy" }, 503); }); vi.stubGlobal("fetch", fetcher);
    await expect(h.service.sendAutomaticAtlasPostgame("capture-1", 1, envelope)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("pauses before disk work or upload when gameplay is active, including a game starting during metadata GET", async () => {
    const h = await harness(); await h.capture();
    let idle = false;
    const fetcher = vi.fn(async () => { idle = false; return json(metadata()); }); vi.stubGlobal("fetch", fetcher);
    await expect(h.service.readAutomaticAtlasPostgameCapture("capture-1", () => idle)).rejects.toThrow(/gameplay/);
    await expect(h.service.sendAutomaticAtlasPostgame("capture-1", 1, envelope, () => idle)).rejects.toThrow(/gameplay/);
    expect(h.token).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    idle = true;
    await expect(h.service.sendAutomaticAtlasPostgame("capture-1", 1, envelope, () => idle)).rejects.toThrow(/gameplay/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("surfaces server conflicts without changing the capture or overwriting a concurrent manual import", async () => {
    const h = await harness(), c = await h.capture(), original = await readFile(c.indexPath);
    const fetcher = vi.fn().mockResolvedValueOnce(json(metadata())).mockResolvedValueOnce(json({ error: "Import changed", code: "postgame_import_changed" }, 409)); vi.stubGlobal("fetch", fetcher);
    await expect(h.service.sendAutomaticAtlasPostgame("capture-1", 1, envelope)).rejects.toMatchObject({ status: 409, code: "postgame_import_changed" });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(await readFile(c.indexPath)).toEqual(original);
  });

  it("rejects invalid or oversized export bodies before authentication or network traffic", async () => {
    const h = await harness(); await h.capture(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(h.service.sendAutomaticAtlasPostgame("capture-1", 0, envelope)).rejects.toThrow(/invalid/);
    await expect(h.service.sendAutomaticAtlasPostgame("capture-1", 1, { ...envelope, padding: "x".repeat(3_900_000) })).rejects.toThrow(/limit/);
    expect(h.token).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
});
