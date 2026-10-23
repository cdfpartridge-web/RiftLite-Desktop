import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { RiftLiteStore } from "../src/main/services/store.js";

const require = createRequire(import.meta.url);

async function withProfile(run: (paths: { dbPath: string; legacyPath: string }) => Promise<void>): Promise<void> {
  const boundary = resolve(tmpdir());
  const directory = await mkdtemp(join(boundary, "riftlite-replay-defaults-"));
  try {
    await run({ dbPath: join(directory, "riftlite-v06.sqlite"), legacyPath: join(directory, "legacy.json") });
  } finally {
    if (dirname(directory) !== boundary || !basename(directory).startsWith("riftlite-replay-defaults-")) {
      throw new Error("Unexpected replay-defaults fixture directory.");
    }
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeExistingSettings(dbPath: string, settings: Record<string, unknown>): Promise<void> {
  const sql = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  const db = new sql.Database();
  try {
    db.run("CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    db.run("INSERT INTO settings VALUES (?, ?, ?)", ["settings", JSON.stringify(settings), 1]);
    await writeFile(dbPath, db.export());
  } finally {
    db.close();
  }
}

describe("interactive replay defaults across device settings persistence", () => {
  it("keeps a new installation local-only with video off through an unrelated save and restart", async () => {
    await withProfile(async ({ dbPath, legacyPath }) => {
      const store = new RiftLiteStore(dbPath, legacyPath);
      const fresh = await store.getSettings();
      expect(fresh).toMatchObject({ replayCaptureEnabled: true, replayKeyframesEnabled: false, replayVideoEnabled: false, replayMicAudioEnabled: false });
      expect(fresh.rawCapture).toMatchObject({
        enabled: true, uploadEnabled: false, webReplayAutoUploadEnabled: false,
        tcgaWebReplayAutoUploadEnabled: false, webReplayDiscordShareEnabled: false,
        webReplayAutoUploadAccountUid: "", tcgaWebReplayAutoUploadAccountUid: "", webReplayDiscordShareHubIds: []
      });
      await store.saveSettings({ username: "New local player", firstRunComplete: true });
      const restarted = await new RiftLiteStore(dbPath, legacyPath).getSettings();
      expect(restarted.replayCaptureEnabled).toBe(true);
      expect(restarted.replayKeyframesEnabled).toBe(false);
      expect(restarted.replayVideoEnabled).toBe(false);
      expect(restarted.rawCapture).toEqual(fresh.rawCapture);
    });
  });

  it.each([true, false])("preserves an existing explicit video=%s preference and independent capture/sharing choices", async (video) => {
    await withProfile(async ({ dbPath, legacyPath }) => {
      const rawCapture = {
        enabled: !video,
        uploadEnabled: false,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "existing-account",
        tcgaWebReplayAutoUploadEnabled: false,
        tcgaWebReplayAutoUploadAccountUid: "",
        webReplayDiscordShareEnabled: false,
        webReplayDiscordShareAccountUid: "",
        webReplayDiscordShareHubIds: [],
        endpoint: "https://riftreplay.com/api/v1/replays",
        apiKey: "",
        visibility: "private"
      };
      await writeExistingSettings(dbPath, {
        firstRunComplete: true, accountUid: "existing-account", replayCaptureEnabled: !video,
        replayVideoEnabled: video, replayKeyframesEnabled: !video, rawCapture
      });
      const store = new RiftLiteStore(dbPath, legacyPath);
      const existing = await store.getSettings();
      expect(existing.replayVideoEnabled).toBe(video);
      expect(existing.replayCaptureEnabled).toBe(!video);
      expect(existing.replayKeyframesEnabled).toBe(!video);
      expect(existing.rawCapture).toEqual(rawCapture);
      await store.saveSettings({ username: "Renamed player" });
      const restarted = await new RiftLiteStore(dbPath, legacyPath).getSettings();
      expect(restarted.replayVideoEnabled).toBe(video);
      expect(restarted.replayCaptureEnabled).toBe(!video);
      expect(restarted.replayKeyframesEnabled).toBe(!video);
      expect(restarted.rawCapture).toEqual(rawCapture);
    });
  });

  it.each(["sqlite", "legacy-json"])("retains the old fallbacks for a %s profile that predates replay preferences", async (format) => {
    await withProfile(async ({ dbPath, legacyPath }) => {
      const settings = { username: "Existing player", firstRunComplete: true };
      if (format === "sqlite") await writeExistingSettings(dbPath, settings);
      else await writeFile(legacyPath, JSON.stringify({ settings }), "utf8");
      const store = new RiftLiteStore(dbPath, legacyPath);
      const existing = await store.getSettings();
      expect(existing.replayVideoEnabled).toBe(true);
      expect(existing.replayKeyframesEnabled).toBe(true);
      expect(existing.rawCapture).toMatchObject({
        enabled: false, visibility: "private", uploadEnabled: false,
        webReplayAutoUploadEnabled: false, tcgaWebReplayAutoUploadEnabled: false, webReplayDiscordShareEnabled: false
      });
      await store.saveSettings({ defaultGamePlatform: "atlas" });
      const restarted = await new RiftLiteStore(dbPath, legacyPath).getSettings();
      expect(restarted.replayVideoEnabled).toBe(true);
      expect(restarted.replayKeyframesEnabled).toBe(true);
      expect(restarted.rawCapture).toEqual(existing.rawCapture);
    });
  });

  it("does not turn obsolete hidden capture settings into interactive capture or upload consent", async () => {
    await withProfile(async ({ dbPath, legacyPath }) => {
      await writeExistingSettings(dbPath, {
        username: "Legacy player", replayVideoEnabled: false,
        rawCapture: { enabled: true, visibility: "public" }
      });
      const store = new RiftLiteStore(dbPath, legacyPath);
      const existing = await store.getSettings();
      expect(existing.replayVideoEnabled).toBe(false);
      expect(existing.rawCapture).toMatchObject({
        enabled: false, visibility: "private", uploadEnabled: false,
        webReplayAutoUploadEnabled: false, tcgaWebReplayAutoUploadEnabled: false, webReplayDiscordShareEnabled: false
      });
      await store.saveSettings({ firstRunComplete: true });
      expect((await new RiftLiteStore(dbPath, legacyPath).getSettings()).rawCapture).toEqual(existing.rawCapture);
    });
  });
});
