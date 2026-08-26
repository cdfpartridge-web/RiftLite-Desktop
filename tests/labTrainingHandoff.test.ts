import { describe, expect, it } from "vitest";
import {
  LAB_TRAINING_HANDOFF_STORAGE_KEY,
  consumeLabTrainingHandoff,
  createLabTrainingHandoff,
  parseLabTrainingHandoff,
  resolveLabTrainingDeckId,
  storeLabTrainingHandoff,
  type LabTrainingStorage
} from "../src/shared/labTrainingHandoff";

function memoryStorage(): LabTrainingStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); }
  };
}

describe("lab training navigation handoff", () => {
  const now = new Date("2026-08-14T10:00:00.000Z");

  it("round-trips and consumes context only in its intended lab", () => {
    const storage = memoryStorage();
    const handoff = createLabTrainingHandoff({
      destination: "mulligan",
      source: "match-detail",
      playerLegend: "  Master Yi  ",
      opponentLegend: "Kennen",
      deckId: "deck-1",
      format: "Bo3",
      wentFirst: "2nd",
      priorGameResult: "loss"
    }, now);
    expect(storeLabTrainingHandoff(storage, handoff)).toBe(true);
    expect(consumeLabTrainingHandoff(storage, "sideboard", now.getTime())).toBeNull();
    expect(storage.values.has(LAB_TRAINING_HANDOFF_STORAGE_KEY)).toBe(true);
    expect(consumeLabTrainingHandoff(storage, "mulligan", now.getTime())).toEqual({
      ...handoff,
      playerLegend: "Master Yi"
    });
    expect(storage.values.has(LAB_TRAINING_HANDOFF_STORAGE_KEY)).toBe(false);
  });

  it("accepts short-lived coaching context from Insights", () => {
    const handoff = createLabTrainingHandoff({
      destination: "mulligan",
      source: "insights",
      playerLegend: "Jinx",
      opponentLegend: "Jayce",
      deckId: "deck-coach",
      wentFirst: "1st"
    }, now);
    expect(parseLabTrainingHandoff(handoff, "mulligan", now.getTime())).toMatchObject({
      source: "insights",
      playerLegend: "Jinx",
      opponentLegend: "Jayce",
      deckId: "deck-coach"
    });
  });

  it("rejects expired, future, malformed, and incomplete context", () => {
    const valid = createLabTrainingHandoff({
      destination: "sideboard",
      source: "mulligan-complete",
      playerLegend: "Irelia",
      opponentLegend: "Kennen"
    }, now);
    expect(parseLabTrainingHandoff(JSON.stringify(valid), "sideboard", now.getTime() + 31 * 60_000)).toBeNull();
    expect(parseLabTrainingHandoff(JSON.stringify(valid), "sideboard", now.getTime() - 61_000)).toBeNull();
    expect(parseLabTrainingHandoff("{broken", "sideboard", now.getTime())).toBeNull();
    expect(parseLabTrainingHandoff({ ...valid, opponentLegend: "" }, "sideboard", now.getTime())).toBeNull();
    expect(parseLabTrainingHandoff({ ...valid, version: 2 }, "sideboard", now.getTime())).toBeNull();
    const incomplete: Partial<typeof valid> = { ...valid };
    delete incomplete.priorGameResult;
    expect(parseLabTrainingHandoff(incomplete, "sideboard", now.getTime())).toBeNull();
  });

  it("removes invalid stored context without affecting any training profile", () => {
    const storage = memoryStorage();
    storage.values.set(LAB_TRAINING_HANDOFF_STORAGE_KEY, "not-json");
    expect(consumeLabTrainingHandoff(storage, "mulligan", now.getTime())).toBeNull();
    expect(storage.values.has(LAB_TRAINING_HANDOFF_STORAGE_KEY)).toBe(false);
  });

  it("resolves saved decks only from unique, durable match evidence", () => {
    const decks = [
      { id: "deck-1", sourceKey: "atlas:one", sourceUrl: "https://decks/one", title: "Tempo", legend: "Irelia" },
      { id: "deck-2", sourceKey: "atlas:two", sourceUrl: "https://decks/two", title: "Tempo", legend: "Kennen" }
    ];
    expect(resolveLabTrainingDeckId({ deckSourceKey: "ATLAS:ONE" }, decks)).toBe("deck-1");
    expect(resolveLabTrainingDeckId({ deckSourceUrl: "https://decks/two" }, decks)).toBe("deck-2");
    expect(resolveLabTrainingDeckId({ deckName: "Tempo", playerLegend: "Irelia" }, decks)).toBe("deck-1");
    expect(resolveLabTrainingDeckId({ deckName: "Tempo" }, decks)).toBe("");
    expect(resolveLabTrainingDeckId({ deckSourceKey: "missing", deckName: "Tempo", playerLegend: "Unknown" }, decks)).toBe("");
  });
});
