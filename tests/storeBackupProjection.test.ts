import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RiftLiteStore } from "../src/main/services/store.js";
import type { ReplayPayloadStore } from "../src/main/services/replayPayloadStore.js";
import type { MatchDraft, ReplayRecord } from "../src/shared/types.js";

vi.mock("electron", () => ({ app: { getVersion: () => "backup-test" } }));

function match(): MatchDraft {
  return {
    id: "backup-match", platform: "atlas", source: "manual", status: "saved",
    capturedAt: "2026-09-04T12:00:00.000Z", updatedAt: "2026-09-04T12:00:00.000Z",
    result: "Win", format: "Bo1", score: "1-0", myName: "Player", opponentName: "Opponent",
    myChampion: "Diana", opponentChampion: "Pyke", myBattlefield: "", opponentBattlefield: "",
    deckName: "Backup deck", deckSourceId: "", flags: "", notes: "Keep the match note",
    games: [{ gameNumber: 1, result: "Win" }], rawEvidence: [],
    sync: { community: "disabled", hubs: {}, teams: {} }
  };
}

function replay(id: string): ReplayRecord {
  return {
    id, matchId: match().id, platform: "atlas", capturedAt: match().capturedAt,
    title: `Recording ${id}`, players: { me: "Player", opponent: "Opponent" },
    events: [{
      id: `${id}-event`, platform: "atlas", kind: "state", capturedAt: match().capturedAt,
      url: "https://play.riftatlas.com/game", payload: { turnText: "Turn 3" }
    }]
  };
}

describe("RiftLiteStore backup projections", () => {
  it("keeps the publication receipt local across restart and retires it with its generation pin", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-publication-receipt-"));
    const open = () => new RiftLiteStore(join(directory, "store.sqlite"), join(directory, "legacy.json"));
    try {
      const store = open();
      await store.load();
      await store.saveSettings({ accountUid: "fixture", accountCloudSyncDeviceId: "test-device" });
      await store.writeCloudPublicationReceipt("local-receipt-one", () => true);
      const restarted = open();
      await restarted.load();
      expect(await restarted.readCloudPublicationReceipt()).toBe("local-receipt-one");
      expect(JSON.stringify(await restarted.exportBackupData())).not.toContain("local-receipt-one");
      await restarted.discardCloudPublicationReceipt("older-receipt");
      expect(await restarted.readCloudPublicationReceipt()).toBe("local-receipt-one");
      await restarted.saveSettings({ accountCloudSyncRemoteGenerationId: "confirmed" });
      expect(await restarted.readCloudPublicationReceipt()).toBe("");
      await restarted.writeCloudPublicationReceipt("local-receipt-two", () => true);
      await restarted.saveSettings({ accountUid: "another-account" });
      expect(await restarted.readCloudPublicationReceipt()).toBe("");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("skips replay payloads for account exports and retains complete local backup round trips", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-backup-projection-test-"));
    try {
      const store = new RiftLiteStore(join(directory, "store.sqlite"), join(directory, "legacy.json"));
      await store.load();
      await store.saveSettings({ username: "Backup Player", firebaseRefreshToken: "device-secret" });
      await store.saveMatch(match());
      const deck = await store.upsertSavedDeck({ title: "Backup deck", legend: "Diana", snapshotJson: "{}" });
      const notebook = await store.getDeckNotebook(deck.id);
      notebook.defaultGuide.sideboard.note = "Keep the notebook plan";
      await store.saveDeckNotebook(deck.id, notebook);
      await store.saveReplay(replay("active"));
      await store.saveReplay(replay("deleted"));
      await store.deleteReplay("deleted");

      const payloads = (store as unknown as { replayPayloadStore: ReplayPayloadStore }).replayPayloadStore;
      const hydrate = vi.spyOn(payloads, "hydrate");
      const account = await store.exportBackupData({ includeRecycleBin: false, includeReplays: false });
      expect(hydrate).not.toHaveBeenCalled();
      expect(account.replays).toEqual([]);
      expect(account.deletedReplays).toEqual([]);
      expect(account.matches).toMatchObject([{ id: "backup-match", notes: "Keep the match note" }]);
      expect(account.decks).toMatchObject([{ id: deck.id, title: "Backup deck" }]);
      expect(account.notebooks[0].defaultGuide.sideboard.note).toBe("Keep the notebook plan");
      expect(account.settings.username).toBe("Backup Player");
      expect(account.settings.firebaseRefreshToken).toBe("");

      // Omitting replay inclusion preserves the existing full local export contract.
      const local = await store.exportBackupData();
      expect(hydrate).toHaveBeenCalledTimes(2);
      expect(local.replays).toMatchObject([{ id: "active", events: [{ payload: { turnText: "Turn 3" } }] }]);
      expect(local.deletedReplays).toMatchObject([{ id: "deleted", events: [{ payload: { turnText: "Turn 3" } }] }]);
      expect(local.matches).toEqual(account.matches);
      expect(local.decks).toEqual(account.decks);
      expect(local.notebooks).toEqual(account.notebooks);

      const restored = new RiftLiteStore(join(directory, "restored.sqlite"), join(directory, "restored-legacy.json"));
      await restored.load();
      await restored.restoreBackupData(local);
      expect((await restored.getReplays())[0].events[0].payload.turnText).toBe("Turn 3");
      expect((await restored.getDeletedReplays())[0].events[0].payload.turnText).toBe("Turn 3");
      expect((await restored.getMatches())[0].notes).toBe("Keep the match note");
      expect((await restored.getDeckNotebook(deck.id)).defaultGuide.sideboard.note).toBe("Keep the notebook plan");
    } finally {
      vi.restoreAllMocks();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
