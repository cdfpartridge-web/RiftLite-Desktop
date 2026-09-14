import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RiftLiteStore } from "../src/main/services/store";
import { history, marker, savedMatch } from "./fixtures/atlasHistory";

describe("stored post-game deck attachments", () => {
  it("preserves current edits and sync state during attachment and protects decks against stale saves", async () => {
    const dir = await mkdtemp(join(tmpdir(), "riftlite-history-test-"));
    try {
      const store = new RiftLiteStore(join(dir, "matches.sqlite"), join(dir, "settings.json"));
      await store.load();
      const original = await store.saveMatch(savedMatch());
      const edited = await store.saveMatch({ ...original, notes: "Edited while fetching decks" });
      const attached = await store.attachAtlasHistory(original.id, history(), [marker]);
      expect(attached.notes).toBe(edited.notes);
      expect(attached.games).toEqual(edited.games);
      expect(attached.sync).toEqual(edited.sync);
      const staleSave = await store.saveMatch({ ...edited, flags: "Updated flag" });
      expect(staleSave.atlasHistory).toEqual(attached.atlasHistory);
      await store.saveMatch({ ...staleSave, opponentName: "Corrected opponent" });
      expect((await store.getMatches())[0].atlasHistory).toBeUndefined();
      await expect(store.attachAtlasHistory(original.id, history(), [marker])).rejects.toThrow(
        "changed during refresh",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("carries per-game decks into a combined BO3 and restores original attachments on undo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "riftlite-history-combine-"));
    try {
      const store = new RiftLiteStore(join(dir, "matches.sqlite"), join(dir, "settings.json"));
      await store.load();
      for (const id of ["one", "two"]) {
        await store.saveMatch({
          ...savedMatch(),
          id,
          capturedAt: id === "one" ? "2026-09-11T11:22:00Z" : "2026-09-11T11:35:00Z",
        });
        await store.attachAtlasHistory(id, history(), [marker]);
      }
      const combined = await store.combineMatches({ orderedMatchIds: ["one", "two"] });
      expect(combined.atlasHistory?.games.map((g) => g.gameNumber)).toEqual([1, 2]);
      const restored = await store.undoCombinedMatch(combined.id, () => true);
      expect(restored.map((m) => m.atlasHistory?.games.map((g) => g.gameNumber))).toEqual([[1], [1]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
