import React, { useId, useState } from "react";
import type { DeckImportChoice, DeckImportResult } from "../shared/types.js";
import "./styles/deck-import-decision.css";

export function DeckImportDecision({ duplicate, busy, onChoose, onCancel }: {
  duplicate: Extract<DeckImportResult, { status: "duplicate" }>;
  busy: boolean;
  onChoose: (choice: DeckImportChoice) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [deckId, setDeckId] = useState(duplicate.decks[0]?.id ?? "");
  const [title, setTitle] = useState(() => duplicate.decks.some(deck => deck.title.toLowerCase() === duplicate.suggestedTitle.toLowerCase())
    ? `${duplicate.suggestedTitle} copy`.slice(0, 120) : duplicate.suggestedTitle.slice(0, 120));
  const selected = duplicate.decks.find(deck => deck.id === deckId);
  const distinctName = title.trim() && !duplicate.decks.some(deck => deck.title.trim().toLowerCase() === title.trim().toLowerCase());
  return <section className="deck-import-decision" aria-labelledby={`${id}-heading`} aria-busy={busy}>
    <h3 id={`${id}-heading`}>This deck is already in your library</h3>
    <p>Choose what to do. Nothing has been replaced.</p>
    <div className="deck-import-decision__options">
      <div>
        {duplicate.decks.length > 1 ? <label htmlFor={`${id}-existing`}>Existing deck<select id={`${id}-existing`} value={deckId} disabled={busy} onChange={event => setDeckId(event.target.value)}>
          {duplicate.decks.map(deck => <option value={deck.id} key={deck.id}>{deck.title}</option>)}
        </select></label> : <strong>{selected?.title}</strong>}
        <p>Keep this deck’s name, notes and match history.</p>
        <button type="button" className="secondary" disabled={busy || !selected} onClick={() => onChoose({ mode: "update", deckId })}>Update existing deck</button>
      </div>
      <div>
        <label htmlFor={`${id}-name`}>New deck name<input id={`${id}-name`} autoFocus value={title} maxLength={120} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
        <p>Keep both decks, with separate stats. Set the new copy as your active deck before playing.</p>
        <button type="button" className="primary" disabled={busy || !distinctName} onClick={() => onChoose({ mode: "separate", title: title.trim() })}>Save as separate deck</button>
      </div>
    </div>
    <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
  </section>;
}
