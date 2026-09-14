import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDeckGuideReviewBaseline, markDeckGuideReviewed, reviewDeckGuide, reviewDeckNotebook } from "../src/shared/deckGuideReview";
import { emptyDeckMatchupGuide, emptyDeckNotebook, enrichDeckNotebookForDeck, normalizeDeckNotebook } from "../src/shared/deckNotebook";
import { RiftLiteStore } from "../src/main/services/store";
import type { DeckGuideCardRef, DeckMatchupGuide, SavedDeck } from "../src/shared/types";

vi.mock("electron", () => ({ app: { getVersion: () => "guide-review-test" } }));

const reviewedAt = "2026-09-08T07:00:00.000Z";
function deck(patch: Record<string, unknown> = {}): SavedDeck {
  return {
    id: "guide-deck", sourceKey: "local:guide-deck", sourceUrl: "", title: "Vex testing", legend: "Vex",
    snapshotJson: JSON.stringify({
      title: "Vex testing", legend: "Vex", runes: [],
      mainDeck: [{ name: "Long Sword", cardId: "OGN-001", qty: 3 }],
      sideboard: [{ name: "Rebuke", cardId: "OGN-002", qty: 2 }],
      battlefields: [{ name: "The Papertree", cardId: "OGN-003", qty: 1 }],
      ...patch
    }),
    lastImportedAt: reviewedAt, lastRefreshStatus: "ok", lastRefreshError: ""
  };
}
function card(name: string, code: string, qty = 1): DeckGuideCardRef {
  return { id: code, cardKey: code.toLowerCase().replace(/[^a-z0-9]/g, ""), cardName: name, cardId: code, qty, note: `Keep the ${name} note`, groupName: "Answers", groupNote: "Wait for the right target" };
}
function guide(legend = ""): DeckMatchupGuide {
  const result = emptyDeckMatchupGuide(legend);
  result.mulligan.keep = { cards: [card("Long Sword", "OGN-001")], note: "Look for pressure" };
  result.sideboard.in = { cards: [card("Rebuke", "OGN-002", 2)], note: "After game one" };
  result.sideboard.out = { cards: [card("Long Sword", "OGN-001", 2)], note: "Keep one" };
  result.battlefields.game1 = { cards: [card("The Papertree", "OGN-003")], note: "Default field" };
  result.notes = [{ id: "note", text: "Remember why this plan exists", createdAt: reviewedAt }];
  return result;
}

describe("deck guide change review", () => {
  it("identifies removed refs in each affected guide section and preserves the authored plan", () => {
    const original = markDeckGuideReviewed(deck(), guide(), reviewedAt);
    const saved = JSON.stringify(original);
    const changed = deck({ mainDeck: [], sideboard: [], battlefields: [] });
    const report = reviewDeckGuide(changed, original);
    expect(new Set(report.issues.map((issue) => issue.stage))).toEqual(new Set(["mulligan", "sideboard", "battlefields"]));
    expect(report.issues).toHaveLength(4);
    expect(report.canMarkReviewed).toBe(false);
    expect(() => markDeckGuideReviewed(changed, original)).toThrow("Resolve unavailable cards");
    expect(JSON.stringify(original)).toBe(saved);
    const notebook = { ...emptyDeckNotebook(changed.id), defaultGuide: original };
    expect(enrichDeckNotebookForDeck(notebook, changed).defaultGuide).toMatchObject(original);
  });

  it("reports quantity changes precisely and records a new exact reviewed baseline only on explicit acknowledgment", () => {
    const original = markDeckGuideReviewed(deck(), guide(), reviewedAt);
    const changed = deck({ mainDeck: [{ name: "Long Sword", cardId: "OGN-001", qty: 2 }] });
    const report = reviewDeckGuide(changed, original);
    expect(report.deckChanged).toBe(true);
    expect(report.issues).toHaveLength(2);
    expect(report.issues[0].message).toContain("3 → 2");
    expect(report.canMarkReviewed).toBe(true);
    expect(original.reviewBaseline?.reviewedAt).toBe(reviewedAt);
    const acknowledged = markDeckGuideReviewed(changed, original, "2026-09-08T08:00:00.000Z");
    expect(acknowledged.reviewBaseline?.snapshotHash).not.toBe(original.reviewBaseline?.snapshotHash);
    expect(reviewDeckGuide(changed, acknowledged)).toMatchObject({ status: "current", deckChanged: false, issues: [] });
    expect(acknowledged.notes).toEqual(original.notes);
  });

  it("blocks a sideboard swap when copies were reduced or moved into the main deck", () => {
    const original = markDeckGuideReviewed(deck(), guide(), reviewedAt);
    const reduced = reviewDeckGuide(deck({ sideboard: [{ name: "Rebuke", cardId: "OGN-002", qty: 1 }] }), original);
    expect(reduced.issues.find((issue) => issue.section === "Bring in")).toMatchObject({ blocking: true });
    expect(reduced.issues[0].message).toContain("lists 2, but only 1 copy");
    const moved = reviewDeckGuide(deck({ sideboard: [], mainDeck: [{ name: "Long Sword", qty: 3 }, { name: "Rebuke", qty: 2 }] }), original);
    expect(moved.issues.find((issue) => issue.section === "Bring in")?.message).toContain("no longer in the sideboard");
  });

  it("does not manufacture old counts for legacy guides or claim malformed deck data is an empty deck", () => {
    const legacy = guide();
    expect(reviewDeckGuide(deck(), legacy)).toMatchObject({ status: "unreviewed", deckChanged: false, issues: [], canMarkReviewed: true });
    expect(reviewDeckGuide(deck(), legacy).reviewedAt).toBeUndefined();
    expect(reviewDeckGuide(deck({ sideboard: [] }), legacy).issues[0].message).toContain("No previously reviewed deck");
    expect(createDeckGuideReviewBaseline({ ...deck(), snapshotJson: "{}" })).toBeNull();
    expect(reviewDeckGuide({ ...deck(), snapshotJson: "{}" }, legacy)).toMatchObject({ status: "unavailable", issues: [], canMarkReviewed: false });
    expect(reviewDeckNotebook(deck(), emptyDeckNotebook(deck().id))).toEqual([]);
  });

  it("aggregates duplicate prints by card name and ignores artwork-only changes", () => {
    const original = markDeckGuideReviewed(deck(), guide(), reviewedAt);
    const prints = deck({ mainDeck: [
      { name: "Long Sword", cardId: "OGN-001a", qty: 1 },
      { name: "Long Sword", cardId: "OGN-001a*", qty: 2 }
    ] });
    expect(reviewDeckGuide(prints, original)).toMatchObject({ deckChanged: true, issues: [] });
    expect(createDeckGuideReviewBaseline(prints)?.cards.find((item) => item.name === "Long Sword")?.mainDeck).toBe(3);
  });

  it("reviews each saved guide independently and preserves review baselines through normalization", () => {
    const source = deck();
    const original = markDeckGuideReviewed(source, guide(), reviewedAt);
    const matchup = guide("Jax");
    matchup.mulligan.keep.cards = [];
    matchup.sideboard.out.cards = [];
    const notebook = { ...emptyDeckNotebook(source.id), defaultGuide: original, matchupGuides: [markDeckGuideReviewed(source, matchup, reviewedAt)] };
    const roundTrip = normalizeDeckNotebook(source.id, JSON.parse(JSON.stringify(notebook)));
    expect(roundTrip.defaultGuide.reviewBaseline).toEqual(original.reviewBaseline);
    const changed = deck({ mainDeck: [{ name: "Long Sword", qty: 2 }] });
    const reports = reviewDeckNotebook(changed, roundTrip);
    expect(reports.filter((report) => report.issues.length).map((report) => report.legend)).toEqual(["default"]);
    expect(reports.find((report) => report.legend === "Jax")?.issues).toEqual([]);
  });

  it("retains stale cards, notes and reviewed snapshots after refresh, ordinary save, restart and account-backup round trip", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-guide-review-"));
    try {
      const path = join(directory, "source.sqlite");
      const legacyPath = join(directory, "source.json");
      const store = new RiftLiteStore(path, legacyPath);
      await store.load();
      const savedDeck = await store.upsertSavedDeck(deck());
      const original = markDeckGuideReviewed(savedDeck, guide(), reviewedAt);
      let notebook = await store.saveDeckNotebook(savedDeck.id, { ...emptyDeckNotebook(savedDeck.id), defaultGuide: original });
      const persistedOriginal = notebook.defaultGuide;
      const changed = await store.upsertSavedDeck({ ...deck({ sideboard: [] }), id: savedDeck.id });
      notebook = await store.getDeckNotebook(savedDeck.id);
      notebook.goals = [{ id: "goal", text: "A separate edit must not discard my old plan", status: "Active", createdAt: reviewedAt }];
      await store.saveDeckNotebook(savedDeck.id, notebook);
      const restarted = new RiftLiteStore(path, legacyPath);
      await restarted.load();
      const restoredNotebook = await restarted.getDeckNotebook(savedDeck.id);
      expect(restoredNotebook.defaultGuide).toEqual(persistedOriginal);
      expect(reviewDeckGuide(changed, restoredNotebook.defaultGuide).issues[0].section).toBe("Bring in");
      const backup = await restarted.exportBackupData({ includeReplays: false, includeRecycleBin: false });
      const destination = new RiftLiteStore(join(directory, "restored.sqlite"), join(directory, "restored.json"));
      await destination.load();
      await destination.restoreBackupData(JSON.parse(JSON.stringify(backup)), { preserveAccount: true, preserveReplays: true });
      expect((await destination.getDeckNotebook(savedDeck.id)).defaultGuide).toEqual(persistedOriginal);
    } finally {
      // Only the test-owned directory created by mkdtemp is removed.
      await rm(directory, { recursive: true, force: true });
    }
  });
});
