import { resolveDeckMatchupGuide } from "./deckNotebook.js";
import { normalizeLegendName } from "./legendNames.js";
import type { DeckNotebook, InsightNotebookSnapshot } from "./types.js";

/** Freezes the exact applicable Notebook guide and active-goal wording. */
export function buildInsightNotebookSnapshot(
  notebook: DeckNotebook,
  opponentLegend: string,
  capturedAt: string
): InsightNotebookSnapshot {
  const normalizedOpponent = normalizeLegendName(opponentLegend);
  const resolved = resolveDeckMatchupGuide(notebook, normalizedOpponent);
  const activeGoals = notebook.goals.filter((goal) => goal.status === "Active");
  return {
    deckId: notebook.deckId,
    opponentLegend: normalizedOpponent,
    guide: JSON.parse(JSON.stringify(resolved.guide)) as InsightNotebookSnapshot["guide"],
    guideSource: resolved.source,
    goals: activeGoals.map((goal) => ({
      id: goal.id,
      text: goal.text,
      createdAt: goal.createdAt,
      ...(goal.updatedAt ? { updatedAt: goal.updatedAt } : {})
    })),
    capturedAt
  };
}
