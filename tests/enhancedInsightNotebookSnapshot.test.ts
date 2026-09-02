import { describe, expect, it } from "vitest";
import { emptyDeckMatchupGuide } from "../src/shared/deckNotebook";
import { buildInsightNotebookSnapshot } from "../src/shared/enhancedInsightNotebookSnapshot";
import type { DeckNotebook } from "../src/shared/types";

function notebook(deckId: string): DeckNotebook {
  const defaultGuide = emptyDeckMatchupGuide("");
  defaultGuide.sideboard.note = `${deckId} default plan`;
  const annie = emptyDeckMatchupGuide("Annie, Dark Child");
  annie.sideboard.note = `${deckId} Annie plan`;
  return {
    deckId,
    updatedAt: "2026-09-01T12:00:00.000Z",
    goals: [
      { id: `${deckId}-active`, text: `${deckId} active goal`, status: "Active", createdAt: "2026-09-01T10:00:00.000Z" },
      { id: `${deckId}-done`, text: "Finished", status: "Done", createdAt: "2026-08-01T10:00:00.000Z" }
    ],
    versions: [],
    watchlist: [],
    defaultGuide,
    matchupGuides: [annie]
  };
}

describe("Enhanced Insights Notebook snapshots", () => {
  it("re-resolves the selected deck and corrected opponent at review finalization", () => {
    const first = buildInsightNotebookSnapshot(notebook("deck-a"), "Ahri", "2026-09-01T12:01:00.000Z");
    const corrected = buildInsightNotebookSnapshot(notebook("deck-b"), "Annie, Dark Child", "2026-09-01T12:02:00.000Z");

    expect(first).toMatchObject({ deckId: "deck-a", opponentLegend: "Ahri", guideSource: "default" });
    expect(first.guide.sideboard.note).toBe("deck-a default plan");
    expect(corrected).toMatchObject({ deckId: "deck-b", opponentLegend: "Annie", guideSource: "matchup" });
    expect(corrected.guide.sideboard.note).toBe("deck-b Annie plan");
    expect(corrected.goals.map((goal) => goal.id)).toEqual(["deck-b-active"]);
  });

  it("deep-clones the plan so later Notebook edits cannot rewrite history", () => {
    const source = notebook("deck-a");
    const snapshot = buildInsightNotebookSnapshot(source, "Annie", "2026-09-01T12:00:00.000Z");
    source.matchupGuides[0]!.sideboard.note = "edited later";
    source.goals[0]!.text = "renamed later";

    expect(snapshot.guide.sideboard.note).toBe("deck-a Annie plan");
    expect(snapshot.goals[0]?.text).toBe("deck-a active goal");
  });
});
