import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeckService, applyDeckToDraft } from "../src/main/services/deckService";
import { RiftLiteStore } from "../src/main/services/store";
import { buildDeckPerformance } from "../src/shared/deckPerformance";
import { buildDeckVersionPerformance } from "../src/shared/deckNotebook";
import { createDefaultSettings } from "../src/shared/settingsDefaults";
import type { DeckImportResult, MatchDraft, SavedDeck } from "../src/shared/types";

vi.mock("electron", () => ({ app: { getVersion: () => "deck-import-test" } }));
const text = (title = "Vex vs Alice") => `${title}\nLegend\n1 Vex, Gloomist\nRunes\n6 Chaos Rune\n6 Calm Rune\nBattlefields\n1 The Papertree\nMain Deck\n3 Falling Star\nSideboard\n1 Rebuke`;
function saved(result: DeckImportResult): SavedDeck {
  if (result.status !== "saved") throw new Error("Expected a saved deck");
  return result.deck;
}
function match(id: string, result: "Win" | "Loss" = "Win"): MatchDraft {
  return { id, platform: "atlas", status: "saved", capturedAt: "2026-10-21T11:00:00Z", updatedAt: "2026-10-21T11:00:00Z", result,
    format: "Bo1", score: result === "Win" ? "1-0" : "0-1", myName: "Player", opponentName: id, myChampion: "Vex", opponentChampion: "Ahri",
    myBattlefield: "", opponentBattlefield: "", deckName: "", deckSourceKey: "", deckSourceId: "", deckSourceUrl: "", deckSnapshotJson: "",
    flags: "", notes: "", games: [], rawEvidence: [], sync: { community: "disabled", hubs: {}, teams: {} } };
}
describe("explicit duplicate deck import choices", () => {
  let directory: string, store: RiftLiteStore, service: DeckService;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "riftlite-deck-choice-"));
    store = new RiftLiteStore(join(directory, "source.sqlite"), join(directory, "source.json"));
    await store.load(); service = new DeckService(store);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error("Unexpected test directory");
    await rm(directory, { recursive: true, force: true });
  });

  it("offers a choice without replacing a renamed deck, notebook or match", async () => {
    const original = saved(await service.importDeckText(text()));
    await store.renameSavedDeck(original.id, "My custom name");
    const notebook = await store.getDeckNotebook(original.id);
    notebook.goals.push({ id: "goal", text: "Practice vs Alice", status: "Active", createdAt: "2026-10-21" });
    await store.saveDeckNotebook(original.id, notebook);
    await store.saveMatch(applyDeckToDraft(match("Alice"), original));
    const before = await store.getDeckNotebook(original.id);
    const result = await service.importDeckText(text("Vex vs Bob"));
    expect(result).toMatchObject({ status: "duplicate", decks: [{ id: original.id, title: "My custom name" }], suggestedTitle: "Vex vs Bob" });
    expect(await store.getSavedDecks()).toHaveLength(1);
    expect((await store.getSavedDeck(original.id))?.title).toBe("My custom name");
    expect(await store.getDeckNotebook(original.id)).toEqual(before);
    expect(await store.getMatches()).toHaveLength(1);
  });

  it("saves identical lists with independent names, stats and notebooks across restart and backup", async () => {
    const original = saved(await service.importDeckText(text()));
    const copy = saved(await service.importDeckText(text(), { mode: "separate", title: "Vex vs Bob" }));
    expect(copy.id).not.toBe(original.id); expect(copy.sourceKey).not.toBe(original.sourceKey);
    expect(JSON.parse(copy.snapshotJson)).toMatchObject({ title: copy.title, source_key: copy.sourceKey, sourceKey: copy.sourceKey });
    await store.saveMatch(applyDeckToDraft(match("Alice"), original));
    await store.saveMatch(applyDeckToDraft(match("Bob", "Loss"), copy));
    const restarted = new RiftLiteStore(join(directory, "source.sqlite"), join(directory, "source.json"));
    await restarted.load();
    const backup = await restarted.exportBackupData({ includeReplays: false, includeRecycleBin: false });
    const restored = new RiftLiteStore(join(directory, "restored.sqlite"), join(directory, "restored.json"));
    await restored.load(); await restored.restoreBackupData(backup, { preserveAccount: true, preserveReplays: true });
    expect(await restored.getSavedDecks()).toHaveLength(2);
    const matches = await restored.getMatches();
    expect(buildDeckPerformance(original, matches).overview.record).toBe("1-0");
    expect(buildDeckPerformance(copy, matches).overview.record).toBe("0-1");
    expect(buildDeckVersionPerformance(copy, await restored.getDeckNotebook(copy.id), matches).map(row => row.record)).toEqual(["0-1"]);
    const foreign = { ...matches[0], deckSourceKey: original.sourceKey, deckSnapshotJson: copy.snapshotJson };
    expect(buildDeckVersionPerformance(copy, await restored.getDeckNotebook(copy.id), [foreign])[0].completed).toBe(0);
  });

  it("updates the specifically chosen copy without renaming or merging the original", async () => {
    const original = saved(await service.importDeckText(text()));
    const copy = saved(await service.importDeckText(text(), { mode: "separate", title: "Vex vs Bob" }));
    const result = await service.importDeckText(text("Incoming title"));
    expect(result.status === "duplicate" && result.decks.map(deck => deck.id)).toEqual([original.id, copy.id]);
    const updated = saved(await service.importDeckText(text("Incoming title"), { mode: "update", deckId: copy.id }));
    expect(updated).toMatchObject({ id: copy.id, sourceKey: copy.sourceKey, title: copy.title });
    expect(await store.getSavedDeck(original.id)).toEqual(original);
  });

  it("rejects empty/reused names and stale update choices", async () => {
    const original = saved(await service.importDeckText(text()));
    for (const title of [" ", original.title, "x".repeat(121)]) await expect(service.importDeckText(text(), { mode: "separate", title })).rejects.toThrow();
    await expect(service.importDeckText(text(), { mode: "update", deckId: "missing" })).rejects.toThrow("no longer available");
    expect(await store.getSavedDecks()).toEqual([original]);
  });

  it("serializes simultaneous first imports so the second cannot silently replace the first", async () => {
    const results = await Promise.all([service.importDeckText(text("Alice")), service.importDeckText(text("Bob"))]);
    expect(results.map(result => result.status)).toEqual(["saved", "duplicate"]);
    expect((await store.getSavedDecks()).map(deck => deck.title)).toEqual(["Alice"]);
  });

  it("uses the explicitly active copy for capture, including a matching automatically attached snapshot", async () => {
    const original = saved(await service.importDeckText(text()));
    const copy = saved(await service.importDeckText(text(), { mode: "separate", title: "Vex vs Bob" }));
    const settings = { ...createDefaultSettings(), activeDeckId: copy.id };
    const attached = await service.attachBestDeck(match("Bob"), {}, settings);
    expect(attached.deckSourceKey).toBe(copy.sourceKey);
    const detected = await service.attachBestDeck(applyDeckToDraft(match("Bob"), original), {}, settings);
    expect(detected.deckSourceKey).toBe(copy.sourceKey);
    const fixed = await service.attachBestDeck(attached, {}, { ...settings, activeDeckId: original.id });
    expect(fixed.deckSourceKey).toBe(copy.sourceKey);
  });

  it("keeps a copied Piltover deck identity when refreshing changed source contents", async () => {
    const url = "https://piltoverarchive.com/decks/view/11111111-1111-4111-8111-111111111111";
    const payload = { sourceUrl: url, sourceKey: "11111111-1111-4111-8111-111111111111", title: "Source", legend: "Vex", snapshot: JSON.parse(saved(await service.importDeckText(text())).snapshotJson) };
    vi.spyOn(service as unknown as { fetchPiltoverDeck: () => Promise<typeof payload> }, "fetchPiltoverDeck").mockResolvedValue(payload);
    const copy = saved(await service.importDeck(url, { mode: "separate", title: "Linked copy" }));
    const refreshed = await service.refreshDeck(copy.id);
    expect(refreshed).toMatchObject({ id: copy.id, sourceKey: copy.sourceKey, title: copy.title, sourceUrl: url });
    expect(await store.getSavedDecks()).toHaveLength(2);
  });

  it("does not pick an unselected copy just because TCGA has the same cards", async () => {
    const original = saved(await service.importDeckText(text("ZZZ original")));
    const copy = saved(await service.importDeckText(text(), { mode: "separate", title: "AAA copy" }));
    const snapshot = JSON.parse(original.snapshotJson);
    const selectedDeck = { id: "tcga-selected", title: "TCGA selection", deckList: {
      legend: [{ name: "Vex", qty: 1 }], runes: snapshot.runes, battlefields: snapshot.battlefields,
      mainDeck: snapshot.mainDeck, sideboard: snapshot.sideboard
    } };
    const draft = { ...match("Bob"), platform: "tcga" as const };
    expect((await service.attachBestDeck(draft, { selectedDeck }, createDefaultSettings())).deckSourceKey).toBe(original.sourceKey);
    expect((await service.attachBestDeck(draft, { selectedDeck }, { ...createDefaultSettings(), activeDeckId: copy.id })).deckSourceKey).toBe(copy.sourceKey);
  });
});
