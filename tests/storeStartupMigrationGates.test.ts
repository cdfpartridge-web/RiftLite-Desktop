import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { REPLAY_PAYLOAD_POINTER_KEY } from "../src/main/services/replayPayloadStore.js";
import { RiftLiteStore } from "../src/main/services/store.js";
import type { ReplayRecord } from "../src/shared/types.js";

interface TestDatabase {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string, params?: unknown[]): Array<{ values: unknown[][] }>;
  export(): Uint8Array;
  close(): void;
}

interface StoreInternals {
  sql: { Database: new (bytes?: Uint8Array) => TestDatabase } | null;
  db: TestDatabase | null;
  enqueueAtomicDatabaseMutation(...args: unknown[]): Promise<unknown>;
  migrateStoredPayloads(): Promise<void>;
  writeDatabaseFile(database: TestDatabase): Promise<void>;
}

function internals(store: RiftLiteStore): StoreInternals {
  return store as unknown as StoreInternals;
}

async function writeLegacyDatabase(
  sql: NonNullable<StoreInternals["sql"]>,
  path: string,
  matchIds: number[]
): Promise<void> {
  const database = new sql.Database();
  try {
    database.run(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE matches (id INTEGER PRIMARY KEY, date TEXT, result TEXT);
    `);
    database.run("INSERT INTO settings (key, value) VALUES ('username', 'Legacy Player')");
    for (const id of matchIds) {
      database.run(
        "INSERT INTO matches (id, date, result) VALUES (?, ?, ?)",
        [id, `2026-07-${String(id).padStart(2, "0")}T12:00:00.000Z`, "Win"]
      );
    }
    await writeFile(path, Buffer.from(database.export()));
  } finally {
    database.close();
  }
}

function inlineReplay(): ReplayRecord {
  return {
    id: "startup-gate-inline-replay",
    matchId: "startup-gate-inline-match",
    platform: "tcga",
    capturedAt: "2026-07-22T11:00:00.000Z",
    title: "Startup gate replay",
    players: { me: "Akali", opponent: "Kennen" },
    events: [{
      id: "startup-gate-event",
      platform: "tcga",
      kind: "state",
      capturedAt: "2026-07-22T11:00:01.000Z",
      url: "https://tcg-arena.fr/play",
      payload: { turnText: "Turn 1", marker: "survives" }
    }]
  };
}

describe("RiftLiteStore startup migration gates", () => {
  it("persists a legacy database fingerprint and skips an unchanged source after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-legacy-startup-gate-"));
    const dbPath = join(directory, "riftlite-v06.sqlite");
    const legacyJsonPath = join(directory, "riftlite-v06-store.json");
    const legacyDatabasePath = join(directory, "legacy-riftlite.db");
    try {
      const bootstrap = new RiftLiteStore(dbPath, legacyJsonPath);
      await bootstrap.load();
      await writeLegacyDatabase(internals(bootstrap).sql!, legacyDatabasePath, [1]);

      const firstStartup = new RiftLiteStore(
        dbPath,
        legacyJsonPath,
        undefined,
        true,
        legacyDatabasePath
      );
      const firstMutation = vi.spyOn(internals(firstStartup), "enqueueAtomicDatabaseMutation");
      await firstStartup.load();
      expect(firstMutation).toHaveBeenCalledTimes(1);
      expect((await firstStartup.getMatches()).map((match) => match.id)).toContain("legacy-1");

      const restarted = new RiftLiteStore(
        dbPath,
        legacyJsonPath,
        undefined,
        true,
        legacyDatabasePath
      );
      const importAttempt = vi.spyOn(restarted, "importLegacyData");
      const restartedMutation = vi.spyOn(internals(restarted), "enqueueAtomicDatabaseMutation");
      await restarted.load();

      expect(importAttempt).toHaveBeenCalledTimes(1);
      expect(restartedMutation).not.toHaveBeenCalled();
      expect((await restarted.getMatches()).filter((match) => match.id === "legacy-1")).toHaveLength(1);

      await writeLegacyDatabase(internals(bootstrap).sql!, legacyDatabasePath, [1, 2]);
      const changedSourceStartup = new RiftLiteStore(
        dbPath,
        legacyJsonPath,
        undefined,
        true,
        legacyDatabasePath
      );
      const changedSourceMutation = vi.spyOn(internals(changedSourceStartup), "enqueueAtomicDatabaseMutation");
      await changedSourceStartup.load();
      expect(changedSourceMutation).toHaveBeenCalledTimes(1);
      expect((await changedSourceStartup.getMatches()).map((match) => match.id)).toEqual(
        expect.arrayContaining(["legacy-1", "legacy-2"])
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("runs the replay payload migration once and preserves its completed marker after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-payload-startup-gate-"));
    const dbPath = join(directory, "riftlite-v06.sqlite");
    const legacyJsonPath = join(directory, "riftlite-v06-store.json");
    try {
      const bootstrap = new RiftLiteStore(dbPath, legacyJsonPath);
      await bootstrap.load();
      const bootstrapInternals = internals(bootstrap);
      const replay = inlineReplay();
      bootstrapInternals.db!.run(
        `INSERT OR REPLACE INTO replays (id, match_id, platform, captured_at, data_json)
         VALUES (?, ?, ?, ?, ?)`,
        [replay.id, replay.matchId, replay.platform, replay.capturedAt, JSON.stringify(replay)]
      );
      bootstrapInternals.db!.run(
        "DELETE FROM store_metadata WHERE key='stored-payload-migration-version'"
      );
      await bootstrapInternals.writeDatabaseFile(bootstrapInternals.db!);

      const firstStartup = new RiftLiteStore(dbPath, legacyJsonPath);
      const firstMigration = vi.spyOn(internals(firstStartup), "migrateStoredPayloads");
      await firstStartup.load();
      expect(firstMigration).toHaveBeenCalledTimes(1);
      expect(internals(firstStartup).db!.exec(
        "SELECT value FROM store_metadata WHERE key='stored-payload-migration-version'"
      )[0].values[0][0]).toBe("1");
      const storedJson = String(internals(firstStartup).db!.exec(
        "SELECT data_json FROM replays WHERE id=?",
        [replay.id]
      )[0].values[0][0]);
      expect(JSON.parse(storedJson)).toHaveProperty(REPLAY_PAYLOAD_POINTER_KEY);

      const restarted = new RiftLiteStore(dbPath, legacyJsonPath);
      const restartedMigration = vi.spyOn(internals(restarted), "migrateStoredPayloads");
      await restarted.load();

      expect(restartedMigration).not.toHaveBeenCalled();
      expect((await restarted.getReplays())[0]).toMatchObject({
        id: replay.id,
        events: [{ payload: { turnText: "Turn 1" } }]
      });
      expect((await restarted.getReplays())[0].events[0].payload.payloadKeys).toEqual(["marker", "turnText"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
