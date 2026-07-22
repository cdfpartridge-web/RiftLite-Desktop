import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RiftLiteStore } from "../src/main/services/store.js";
import type { MatchDraft } from "../src/shared/types.js";

function savedMatch(id: string, result: MatchDraft["result"]): MatchDraft {
  const capturedAt = id === "one" ? "2026-07-21T12:00:00.000Z" : "2026-07-21T12:10:00.000Z";
  return {
    id,
    platform: "atlas",
    source: "auto",
    status: "saved",
    capturedAt,
    updatedAt: capturedAt,
    result,
    format: "Bo1",
    score: result === "Win" ? "7-3" : "3-7",
    myName: "Player",
    opponentName: "Opponent",
    myChampion: "Akali",
    opponentChampion: "Kennen",
    myBattlefield: "The Arena's Greatest",
    opponentBattlefield: "Sacred Springs",
    deckName: "",
    deckSourceId: "",
    flags: "",
    notes: "",
    games: [{ gameNumber: 1, result }],
    rawEvidence: [],
    sync: {
      community: "synced",
      hubs: { "hub-1": "synced" },
      teams: { "team-1": "synced" }
    }
  };
}

describe("RiftLiteStore combined-match lifecycle", () => {
  it("guards undo atomically and resets restored scopes for a real re-upload", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-combine-undo-"));
    try {
      const store = new RiftLiteStore(
        join(directory, "riftlite-v06.sqlite"),
        join(directory, "riftlite-v06-store.json")
      );
      await store.load();
      await store.saveMatch(savedMatch("one", "Win"));
      await store.saveMatch(savedMatch("two", "Loss"));
      const combined = await store.combineMatches({ orderedMatchIds: ["one", "two"] });

      await expect(store.undoCombinedMatch(combined.id, () => false)).rejects.toThrow("Nothing was changed locally");
      expect((await store.getMatches()).find((match) => match.id === combined.id)).toBeDefined();
      expect((await store.getMatches()).filter((match) => match.mergedIntoMatchId === combined.id)).toHaveLength(2);

      const restored = await store.undoCombinedMatch(combined.id, (current) => current.updatedAt === combined.updatedAt);

      expect(restored).toHaveLength(2);
      expect(restored.every((match) => !match.mergedIntoMatchId && !match.hiddenFromHistory)).toBe(true);
      expect(restored.every((match) => match.sync.community === "pending")).toBe(true);
      expect(restored.every((match) => match.sync.hubs["hub-1"] === "pending")).toBe(true);
      expect(restored.every((match) => match.sync.teams["team-1"] === "pending")).toBe(true);
      expect((await store.getDeletedMatches()).some((match) => match.id === combined.id)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("routes renderer undo through the remote-aware synchronization service", () => {
    const source = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
    const start = source.indexOf('handleTrustedAppIpc("matches:combine-undo"');
    const end = source.indexOf('handleTrustedAppIpc("matches:delete"', start);
    const handler = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(handler).toContain("await syncService.undoCombinedMatch(combinedMatchId)");
    expect(handler).not.toContain("await store.undoCombinedMatch(combinedMatchId)");
  });
});
