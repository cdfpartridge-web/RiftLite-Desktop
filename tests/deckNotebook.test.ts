import { describe, expect, it } from "vitest";
import {
  buildDeckVersionPerformance,
  deckNotebookCardOptions,
  deckNotebookMulliganCardOptions,
  deckNotebookWithCurrentVersion,
  deckSnapshotHash,
  emptyDeckNotebook,
  normalizeDeckNotebook,
  resolveDeckMatchupGuide,
  sanitizeDeckNotebookForDeck
} from "../src/shared/deckNotebook";
import type { MatchDraft, SavedDeck } from "../src/shared/types";

function snapshot(title: string, cardName = "Long Sword"): string {
  return JSON.stringify({
    title,
    legend: "Vex",
    sourceKey: "piltover:deck",
    runes: [{ qty: 7, name: "Calm Rune", cardId: "rune-1" }],
    battlefields: [{ qty: 1, name: "The Papertree", cardId: "bf-1" }],
    mainDeck: [{ qty: 2, name: cardName, cardId: "card-1", imageUrl: "https://example.test/card.jpg" }],
    sideboard: [{ qty: 1, name: "Rebuke", cardId: "card-2" }]
  });
}

function deck(patch: Partial<SavedDeck> = {}): SavedDeck {
  return {
    id: "deck-id",
    sourceUrl: "https://piltoverarchive.com/decks/view/deck",
    sourceKey: "piltover:deck",
    title: "Vex Test",
    legend: "Vex",
    snapshotJson: snapshot("Vex Test"),
    lastImportedAt: "2026-05-01T10:00:00.000Z",
    lastRefreshStatus: "ok",
    lastRefreshError: "",
    ...patch
  };
}

function match(patch: Partial<MatchDraft>): MatchDraft {
  const capturedAt = patch.capturedAt ?? "2026-05-01T12:00:00.000Z";
  return {
    id: patch.id ?? crypto.randomUUID(),
    platform: "tcga",
    source: "capture",
    status: "saved",
    capturedAt,
    updatedAt: capturedAt,
    result: patch.result ?? "Win",
    format: patch.format ?? "Bo1",
    score: patch.score ?? "1-0",
    myName: "Player",
    opponentName: "Opponent",
    myChampion: patch.myChampion ?? "Vex",
    opponentChampion: patch.opponentChampion ?? "Kai'Sa",
    myBattlefield: "The Papertree",
    opponentBattlefield: "Void Gate",
    deckName: patch.deckName ?? "Vex Test",
    deckSourceId: patch.deckSourceId ?? "",
    deckSourceUrl: "",
    deckSourceKey: patch.deckSourceKey ?? "",
    deckSnapshotJson: patch.deckSnapshotJson ?? "",
    flags: "",
    notes: patch.notes ?? "",
    games: patch.games ?? [],
    rawEvidence: [],
    sync: { community: "disabled", hubs: {} }
  };
}

describe("deck notebook", () => {
  it("hashes deck snapshots stably across object key order", () => {
    const a = JSON.stringify({ title: "Deck", mainDeck: [{ name: "A", qty: 2 }], legend: "Vex" });
    const b = JSON.stringify({ legend: "Vex", mainDeck: [{ qty: 2, name: "A" }], title: "Deck" });
    expect(deckSnapshotHash(a)).toBe(deckSnapshotHash(b));
  });

  it("creates a new notebook version when the deck snapshot changes", () => {
    const firstDeck = deck();
    const first = deckNotebookWithCurrentVersion(emptyDeckNotebook(firstDeck.id), firstDeck);
    const secondDeck = deck({
      snapshotJson: snapshot("Vex Test", "Rebuke"),
      lastImportedAt: "2026-05-02T10:00:00.000Z"
    });
    const second = deckNotebookWithCurrentVersion(first, secondDeck);

    expect(first.versions).toHaveLength(1);
    expect(second.versions).toHaveLength(2);
    expect(new Set(second.versions.map((version) => version.snapshotHash)).size).toBe(2);
  });

  it("restricts watchlist options to deck cards and excludes battlefields", () => {
    const options = deckNotebookCardOptions(deck());
    expect(options.map((option) => option.cardName)).toEqual(["Calm Rune", "Long Sword", "Rebuke"]);
    expect(options.some((option) => option.cardName === "The Papertree")).toBe(false);
  });

  it("allows mulligan prep to use main deck and sideboard cards", () => {
    const options = deckNotebookMulliganCardOptions(deck());

    expect(options.map((option) => option.cardName)).toEqual(["Long Sword", "Rebuke"]);
    expect(options.some((option) => option.cardName === "Calm Rune")).toBe(false);
    expect(options.some((option) => option.cardName === "The Papertree")).toBe(false);
  });

  it("attributes version performance by snapshot hash before source-key date ranges", () => {
    const firstDeck = deck();
    const firstHash = deckSnapshotHash(firstDeck.snapshotJson);
    const secondDeck = deck({
      snapshotJson: snapshot("Vex Test", "Rebuke"),
      lastImportedAt: "2026-05-02T10:00:00.000Z"
    });
    const notebook = deckNotebookWithCurrentVersion(
      deckNotebookWithCurrentVersion(emptyDeckNotebook(firstDeck.id), firstDeck),
      secondDeck
    );
    const rows = buildDeckVersionPerformance(secondDeck, notebook, [
      match({ id: "exact-old", result: "Loss", deckSnapshotJson: firstDeck.snapshotJson, capturedAt: "2026-05-03T12:00:00.000Z" }),
      match({ id: "range-new", result: "Win", deckSourceKey: "piltover:deck", capturedAt: "2026-05-03T13:00:00.000Z", format: "Bo3" }),
      match({ id: "wrong", result: "Win", deckSourceKey: "other", capturedAt: "2026-05-03T14:00:00.000Z" })
    ]);

    expect(rows.find((row) => row.version.snapshotHash === firstHash)?.record).toBe("0-1");
    expect(rows.at(-1)?.record).toBe("1-0");
    expect(rows.at(-1)?.bo3).toBe(1);
  });

  it("normalizes matchup prep guides and merges default guide fallbacks", () => {
    const notebook = normalizeDeckNotebook("deck-id", {
      defaultGuide: {
        id: "default",
        legend: "",
        legendKey: "default",
        updatedAt: "",
        mulligan: {
          keep: { note: "Always keep cheap units", cards: [{ id: "keep-1", cardKey: "card1", cardName: "Long Sword", cardId: "card-1", imageUrl: "", qty: 1 }] },
          consider: { note: "", cards: [] },
          avoid: { note: "", cards: [] }
        },
        sideboard: {
          in: { note: "", cards: [] },
          out: { note: "", cards: [] },
          note: "Default sideboard note"
        },
        notes: [{ id: "note-1", text: "Default matchup note", createdAt: "2026-05-01T00:00:00.000Z" }]
      },
      matchupGuides: [{
        id: "kaisa",
        legend: "Survivor",
        legendKey: "kaisa",
        updatedAt: "",
        mulligan: {
          keep: { note: "", cards: [] },
          consider: { note: "Look for interaction", cards: [{ id: "consider-1", cardKey: "card1", cardName: "Long Sword", cardId: "card-1", imageUrl: "", qty: 2 }] },
          avoid: { note: "", cards: [] }
        },
        sideboard: {
          in: { note: "", cards: [{ id: "in-1", cardKey: "card2", cardName: "Rebuke", cardId: "card-2", imageUrl: "", qty: 1 }] },
          out: { note: "", cards: [] },
          note: ""
        },
        notes: [{ id: "note-2", text: "Respect early pressure", createdAt: "2026-05-01T00:00:00.000Z" }]
      }]
    });

    const resolved = resolveDeckMatchupGuide(notebook, "Kai'Sa");

    expect(resolved.source).toBe("matchup");
    expect(resolved.guide.legend).toBe("Kai'Sa");
    expect(resolved.guide.mulligan.keep.cards[0]?.cardName).toBe("Long Sword");
    expect(resolved.guide.mulligan.consider.note).toBe("Look for interaction");
    expect(resolved.guide.sideboard.note).toBe("Default sideboard note");
    expect(resolved.guide.notes.map((note) => note.text)).toEqual(["Default matchup note", "Respect early pressure"]);
  });

  it("sanitizes matchup prep cards by deck section", () => {
    const notebook = normalizeDeckNotebook("deck-id", {
      defaultGuide: {
        id: "default",
        legend: "",
        legendKey: "default",
        updatedAt: "",
        mulligan: {
          keep: { note: "", cards: [
            { id: "main", cardKey: "card1", cardName: "Long Sword", cardId: "card-1", imageUrl: "", qty: 1 },
            { id: "side", cardKey: "card2", cardName: "Rebuke", cardId: "card-2", imageUrl: "", qty: 1 }
          ] },
          consider: { note: "", cards: [] },
          avoid: { note: "", cards: [] }
        },
        sideboard: {
          in: { note: "", cards: [
            { id: "good-in", cardKey: "card2", cardName: "Rebuke", cardId: "card-2", imageUrl: "", qty: 1 },
            { id: "bad-in", cardKey: "card1", cardName: "Long Sword", cardId: "card-1", imageUrl: "", qty: 1 }
          ] },
          out: { note: "", cards: [
            { id: "good-out", cardKey: "card1", cardName: "Long Sword", cardId: "card-1", imageUrl: "", qty: 1 },
            { id: "bad-out", cardKey: "card2", cardName: "Rebuke", cardId: "card-2", imageUrl: "", qty: 1 }
          ] },
          note: ""
        },
        notes: []
      }
    });

    const sanitized = sanitizeDeckNotebookForDeck(notebook, deck());

    expect(sanitized.defaultGuide.mulligan.keep.cards.map((card) => card.cardName)).toEqual(["Long Sword", "Rebuke"]);
    expect(sanitized.defaultGuide.sideboard.in.cards.map((card) => card.cardName)).toEqual(["Rebuke"]);
    expect(sanitized.defaultGuide.sideboard.out.cards.map((card) => card.cardName)).toEqual(["Long Sword"]);
  });
});
