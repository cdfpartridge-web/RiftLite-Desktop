import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { RiftLiteStore } from "../src/main/services/store";
import { emptyDeckMatchupGuide, emptyDeckNotebook } from "../src/shared/deckNotebook";
import { importReviewPlayNotes, notebookAfterReviewSave } from "../src/shared/reviewPlayNotes";
import type { MatchDraft, SavedDeck } from "../src/shared/types";
import { savedMatch } from "./fixtures/atlasHistory";

const makeDeck = { title: "Draven", legend: "Draven", sourceKey: "test:draven", snapshotJson: "{}" };
function review(deck: SavedDeck): MatchDraft {
  return { ...savedMatch(), notes: "", status: "pending-review", deckSourceId: deck.id, deckSourceKey: deck.sourceKey, opponentChampion: "Ezreal" };
}
function notebook(deckId: string) {
  const guide = (legend: string) => ({ ...emptyDeckMatchupGuide(legend), notes: [
    { id: "same-id", text: `Live ${legend || "default"}`, source: "play" as const, createdAt: "2026-11-18" },
    { id: "keep", text: "Keep", source: "prepare" as const, createdAt: "2026-11-18" }
  ] });
  return { ...emptyDeckNotebook(deckId), defaultGuide: guide(""), matchupGuides: [guide("Ezreal"), guide("Ahri")] };
}
it("leaves originals intact when the player changes deck, opponent or notes", () => {
  const deck = { ...makeDeck, id: "deck" } as SavedDeck;
  const book = notebook(deck.id);
  const draft = importReviewPlayNotes(review(deck), book, deck, "");
  expect(draft.notes).toContain("Live default");
  expect(draft.notes).toContain("Live Ezreal");
  expect(draft.notes).not.toContain("Live Ahri");
  expect(notebookAfterReviewSave({ ...draft, opponentChampion: "Ahri" }, book, deck)).toBe(book);
  expect(notebookAfterReviewSave({ ...draft, deckSourceId: "", deckSourceKey: "", deckSourceUrl: "" }, book, deck)).toBe(book);
  expect(notebookAfterReviewSave({ ...draft, notes: "Rewritten notes" }, book, deck)).toBe(book);
  expect(importReviewPlayNotes({...draft, importedPlayNotes: undefined}, book, deck, "").importedPlayNotes).toBeUndefined();
  book.matchupGuides[0].notes[0].text = "Edited after opening";
  const cleaned = notebookAfterReviewSave(draft, book, deck);
  expect(cleaned.matchupGuides[0].notes[0].text).toBe("Edited after opening");
  expect(cleaned.matchupGuides[1]).toBe(book.matchupGuides[1]);
  expect(cleaned.defaultGuide.notes.map(note => note.id)).toEqual(["keep"]);
});

it("defers without consuming notes, rolls a failed save back and consumes the matching IDs on a successful retry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "riftlite-review-notes-"));
  try {
    const store = new RiftLiteStore(join(dir, "matches.sqlite"), join(dir, "settings.json"));
    await store.load();
    const deck = await store.upsertSavedDeck(makeDeck);
    const book = await store.saveDeckNotebook(deck.id, notebook(deck.id));
    const draft = importReviewPlayNotes(review(deck), book, deck, "");
    await store.saveMatch(review(deck));
    await store.deferMatchReview(draft);
    const pending = (await store.getMatches()).find(match => match.id === draft.id)!;
    expect(importReviewPlayNotes(pending, book, deck, "")).toEqual(pending);
    expect(pending.importedPlayNotes).toEqual(draft.importedPlayNotes);
    expect((await store.getDeckNotebook(deck.id)).matchupGuides).toEqual(book.matchupGuides);
    const confirmed = { ...pending, status: "saved" as const };
    const staging = store as unknown as { stageDatabaseBytes(db: unknown): Promise<string> };
    const fail = vi.spyOn(staging, "stageDatabaseBytes").mockRejectedValue(new Error("Disk full"));
    await expect(store.saveMatch(confirmed, true)).rejects.toThrow();
    fail.mockRestore();
    expect((await store.getMatches())[0].status).toBe("pending-review");
    expect((await store.getDeckNotebook(deck.id)).defaultGuide.notes).toEqual(book.defaultGuide.notes);
    const result = await store.saveMatch(confirmed, true);
    expect(result.importedPlayNotes).toBeUndefined();
    const after = await store.getDeckNotebook(deck.id);
    expect(after.matchupGuides.find(guide => guide.legend === "Ezreal")?.notes.map(note => note.id)).toEqual(["keep"]);
    expect(after.matchupGuides.find(guide => guide.legend === "Ahri")?.notes.map(note => note.id)).toEqual(["same-id", "keep"]);
    await store.saveMatch(confirmed, true);
    expect((await store.getDeckNotebook(deck.id)).matchupGuides).toEqual(after.matchupGuides);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
