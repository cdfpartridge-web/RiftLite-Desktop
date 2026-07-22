import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RiftLiteStore } from "../src/main/services/store.js";
import { REPLAY_PAYLOAD_POINTER_KEY } from "../src/main/services/replayPayloadStore.js";
import type { ReplayRecord } from "../src/shared/types.js";

function legacyReplay(): ReplayRecord {
  return {
    id: "legacy-inline-replay",
    matchId: "legacy-inline-match",
    platform: "tcga",
    capturedAt: "2026-07-22T11:00:00.000Z",
    title: "Legacy inline replay",
    players: { me: "Akali", opponent: "Kennen" },
    events: [{
      id: "legacy-event",
      platform: "tcga",
      kind: "state",
      capturedAt: "2026-07-22T11:00:01.000Z",
      url: "https://tcg-arena.fr/play",
      payload: { turnText: "Turn 1", marker: "must-survive-migration" }
    }]
  };
}

describe("RiftLiteStore replay payload migration", () => {
  it("migrates an inline replay row and keeps the public replay contract intact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-inline-replay-migration-"));
    try {
      const dbPath = join(directory, "riftlite-v06.sqlite");
      const legacyPath = join(directory, "riftlite-v06-store.json");
      const initial = new RiftLiteStore(dbPath, legacyPath);
      await initial.load();

      interface StoreInternals {
        db: { run(sql: string, params?: unknown[]): void } | null;
        writeDatabaseFile(database: object): Promise<void>;
      }
      const internals = initial as unknown as StoreInternals;
      internals.db?.run(
        `INSERT OR REPLACE INTO replays (id, match_id, platform, captured_at, data_json)
         VALUES (?, ?, ?, ?, ?)`,
        [
          legacyReplay().id,
          legacyReplay().matchId,
          legacyReplay().platform,
          legacyReplay().capturedAt,
          JSON.stringify(legacyReplay())
        ]
      );
      await internals.writeDatabaseFile(internals.db as object);

      const reopened = new RiftLiteStore(dbPath, legacyPath);
      await reopened.load();
      const [migrated] = await reopened.getReplays();
      expect(migrated).toMatchObject({
        id: legacyReplay().id,
        title: legacyReplay().title,
        events: [{ payload: { turnText: "Turn 1" } }]
      });
      expect(migrated.events[0].payload.payloadKeys).toEqual(["marker", "turnText"]);

      const reopenedInternals = reopened as unknown as StoreInternals;
      const raw = (reopenedInternals.db as unknown as {
        exec(sql: string, params?: unknown[]): Array<{ values: unknown[][] }>;
      }).exec("SELECT data_json FROM replays WHERE id=?", [legacyReplay().id])[0].values[0][0];
      const stored = JSON.parse(String(raw)) as Record<string, unknown>;
      expect(stored.events).toEqual([]);
      expect(stored[REPLAY_PAYLOAD_POINTER_KEY]).toMatchObject({ version: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
