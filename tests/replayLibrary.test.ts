import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RiftLiteStore } from "../src/main/services/store.js";
import type { ReplayRecord } from "../src/shared/types.js";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../src/preload/appPreload.ts", import.meta.url), "utf8");

describe("in-client replay library", () => {
  it("exposes replay renaming, virtual folders, filtering, and folder assignment in the Replays view", () => {
    expect(appSource).toContain("Library folder");
    expect(appSource).toContain("async function saveReplayTitle()");
    expect(appSource).toContain("async function moveReplayToFolder(folderId: string)");
    expect(appSource).toContain("async function createReplayFolder()");
    expect(appSource).toContain("async function renameReplayFolder()");
    expect(appSource).toContain("async function deleteReplayFolder(folder: ReplayFolder)");
    expect(appSource).toContain('<option value="favourite">Favourites</option>');
    expect(appSource).toContain("async function deleteSelectedReplays()");
    expect(appSource).toContain("Move ${replayLabel} to the recycle bin?");
    expect(mainSource).toContain('handleTrustedAppIpc("replays:delete-many"');
    expect(preloadSource).toContain('ipcRenderer.invoke("replays:delete-many"');
    expect(appSource).not.toContain("organizeReplayVideoForMatch");
  });

  it("persists folder metadata, renamed titles, favourites, and replay membership across a restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-replay-library-"));
    try {
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const store = new RiftLiteStore(dbPath, legacyPath);
      await store.load();
      const createdAt = "2026-08-03T12:00:00.000Z";
      const settings = await store.saveSettings({
        replayFolders: [
          { id: "league-night", name: "  League   Night  ", createdAt, updatedAt: createdAt },
          { id: "duplicate-name", name: "league night", createdAt, updatedAt: createdAt }
        ]
      });
      expect(settings.replayFolders).toEqual([
        { id: "league-night", name: "League Night", createdAt, updatedAt: createdAt }
      ]);

      const replay: ReplayRecord = {
        id: "replay-1",
        matchId: "match-1",
        platform: "atlas",
        capturedAt: createdAt,
        title: "JohnSmith - Game 1",
        folderId: "league-night",
        favourite: true,
        players: { me: "BMU", opponent: "JohnSmith" },
        events: []
      };
      await store.saveReplay(replay);

      const reopened = new RiftLiteStore(dbPath, legacyPath);
      await reopened.load();
      expect((await reopened.getSettings()).replayFolders).toEqual(settings.replayFolders);
      expect(await reopened.getReplays()).toEqual([expect.objectContaining({
        id: replay.id,
        title: "JohnSmith - Game 1",
        folderId: "league-night",
        favourite: true
      })]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("moves a batch of replays to the recycle bin in one operation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-replay-bulk-delete-"));
    try {
      const store = new RiftLiteStore(
        join(directory, "riftlite-v06.sqlite"),
        join(directory, "riftlite-v06-store.json")
      );
      await store.load();
      const replay = (id: string): ReplayRecord => ({
        id,
        matchId: `match-${id}`,
        platform: "atlas",
        capturedAt: "2026-08-03T12:00:00.000Z",
        title: id,
        players: { me: "BMU", opponent: "Opponent" },
        events: []
      });
      await store.saveReplay(replay("replay-1"));
      await store.saveReplay(replay("replay-2"));
      await store.saveReplay(replay("replay-3"));

      await store.deleteReplays([" replay-1 ", "replay-2", "replay-2", "missing-replay"]);

      expect((await store.getReplays()).map((item) => item.id)).toEqual(["replay-3"]);
      const deleted = await store.getDeletedReplays();
      expect(deleted.map((item) => item.id).sort()).toEqual(["replay-1", "replay-2"]);
      expect(deleted.every((item) => Boolean(item.deletedAt))).toBe(true);
      expect(new Set(deleted.map((item) => item.deletedAt)).size).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
