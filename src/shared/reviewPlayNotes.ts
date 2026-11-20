import { normalizeLegendName } from "./legendNames.js";
import type { DeckMatchupGuide, DeckNotebook, MatchDraft, SavedDeck } from "./types.js";

export interface ImportedPlayNotes {
  deckId: string;
  opponentLegend: string;
  hadDeckIdentity: boolean;
  notes: { guide: string; id: string; text: string }[];
}

function matchesDeck(draft: MatchDraft, deck: SavedDeck): boolean {
  const identifiers = [draft.deckSourceKey, draft.deckSourceId, draft.deckSourceUrl].filter(Boolean);
  return !identifiers.length || identifiers.some(id => id === deck.id || id === deck.sourceKey || id === deck.sourceUrl);
}

export function importReviewPlayNotes(draft: MatchDraft, notebook: DeckNotebook, deck: SavedDeck, fallbackLegend: string): MatchDraft {
  if (draft.status === "saved" || draft.importedPlayNotes || notebook.deckId !== deck.id || !matchesDeck(draft, deck)) return draft;
  const opponentLegend = normalizeLegendName(draft.opponentChampion || fallbackLegend);
  const matchup = opponentLegend && notebook.matchupGuides.find(guide => normalizeLegendName(guide.legend) === opponentLegend);
  const guides = matchup ? [notebook.defaultGuide, matchup] : [notebook.defaultGuide];
  const notes = guides.flatMap(guide => guide.notes
    .filter(note => note.source === "play" && note.text.trim())
    .map(note => ({ guide: normalizeLegendName(guide.legend), id: note.id, text: note.text.trim() })));
  const heading = `Matchup prep notes${opponentLegend ? ` vs ${opponentLegend}` : ""}:`;
  // A deferred review from an older version may already have text with no record of its source.
  if (!notes.length || draft.notes.split("\n").includes(heading)) return draft;
  const block = [heading, ...notes.map(note => `- ${note.text}`)].join("\n");
  return { ...draft, notes: [draft.notes.trim(), block].filter(Boolean).join("\n\n"), importedPlayNotes: { deckId: deck.id, opponentLegend, hadDeckIdentity: Boolean(draft.deckSourceId || draft.deckSourceKey || draft.deckSourceUrl), notes } };
}

export function notebookAfterReviewSave(draft: MatchDraft, notebook: DeckNotebook, deck: SavedDeck): DeckNotebook {
  const imported = draft.importedPlayNotes;
  if (!imported || imported.deckId !== deck.id || notebook.deckId !== deck.id || !matchesDeck(draft, deck)
    || (imported.hadDeckIdentity && !draft.deckSourceId && !draft.deckSourceKey && !draft.deckSourceUrl)
    || (draft.opponentChampion && normalizeLegendName(draft.opponentChampion) !== imported.opponentLegend)) return notebook;
  // Match complete bullet text, including multi-line notes. A player's edit or a newer notebook edit retains the original.
  let remainingText = `\n${draft.notes}\n`;
  const included = imported.notes.filter(note => {
    const line = `\n- ${note.text}\n`;
    if (!remainingText.includes(line)) return false;
    remainingText = remainingText.replace(line, "\n");
    return true;
  });
  const updatedAt = new Date().toISOString();
  function clean(guide: DeckMatchupGuide): DeckMatchupGuide {
    const legend = normalizeLegendName(guide.legend);
    const notes = guide.notes.filter(note => note.source !== "play" || !included.some(
      entry => entry.guide === legend && entry.id === note.id && entry.text === note.text.trim()
    ));
    return notes.length === guide.notes.length ? guide : { ...guide, notes, updatedAt };
  }
  const defaultGuide = clean(notebook.defaultGuide);
  const matchupGuides = notebook.matchupGuides.map(clean);
  return defaultGuide === notebook.defaultGuide && matchupGuides.every((guide, i) => guide === notebook.matchupGuides[i])
    ? notebook : { ...notebook, defaultGuide, matchupGuides, updatedAt };
}
