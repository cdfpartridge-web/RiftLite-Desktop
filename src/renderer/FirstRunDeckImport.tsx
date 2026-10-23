import React, { useEffect, useRef, useState } from "react";
import { Check, FileText, Link2, LoaderCircle, Plus } from "lucide-react";
import type { DeckImportChoice, DeckImportResult, SavedDeck } from "../shared/types.js";
import { DeckImportDecision } from "./DeckImportDecision.js";
import "./styles/first-run-deck-import.css";

export interface FirstRunDeckImportProps {
  onImport: (source: string, kind: "url" | "text", choice?: DeckImportChoice) => Promise<DeckImportResult>;
  onImported: (deck: SavedDeck) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function FirstRunDeckImport({ onImport, onImported, onBusyChange }: FirstRunDeckImportProps) {
  const [kind, setKind] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState<Extract<DeckImportResult, { status: "duplicate" }> | null>(null);
  const [error, setError] = useState("");
  const [importedTitle, setImportedTitle] = useState("");
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const callbacksRef = useRef({ onImported, onBusyChange });
  callbacksRef.current = { onImported, onBusyChange };
  const source = kind === "url" ? url : text;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  function changeKind(next: "url" | "text") {
    if (busyRef.current) return;
    setKind(next);
    setError("");
    setImportedTitle("");
  }

  async function importDeck(choice?: DeckImportChoice) {
    if (busyRef.current || !source.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setImportedTitle("");
    try {
      callbacksRef.current.onBusyChange?.(true);
      const result = await onImport(source.trim(), kind, choice);
      if (!mountedRef.current) return;
      if (result.status === "duplicate") { setDuplicate(result); return; }
      const deck = result.deck;
      setDuplicate(null);
      callbacksRef.current.onImported(deck);
      setImportedTitle(deck.title || "Your deck");
      if (kind === "url") setUrl("");
      else setText("");
    } catch (cause) {
      if (mountedRef.current) {
        setError(cause instanceof Error && cause.message ? cause.message : "The deck could not be imported. Check your link or list and try again.");
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setBusy(false);
        callbacksRef.current.onBusyChange?.(false);
      }
    }
  }

  return <section className="first-run-deck-import" aria-labelledby="first-run-deck-import-title" aria-busy={busy}>
    <h2 id="first-run-deck-import-title">Add your deck</h2>
    <p>Paste a public Piltover Archive link or a deck list. Your deck will be saved here, without leaving Quick setup.</p>
    <fieldset disabled={busy || Boolean(duplicate)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <div className="first-run-deck-import__methods" role="group" aria-label="Deck import method">
      <button type="button" aria-pressed={kind === "url"} disabled={busy} onClick={() => changeKind("url")}><Link2 size={15} aria-hidden="true" />Piltover Archive link</button>
      <button type="button" aria-pressed={kind === "text"} disabled={busy} onClick={() => changeKind("text")}><FileText size={15} aria-hidden="true" />Paste deck list</button>
    </div>
    {kind === "url" ? <label className="first-run-setup__field" htmlFor="first-run-deck-link">
      <span>Public deck link</span>
      <input id="first-run-deck-link" type="text" inputMode="url" autoComplete="off" spellCheck={false} value={url} disabled={busy} placeholder="https://piltoverarchive.com/decks/view/..." onChange={(event) => { setUrl(event.currentTarget.value); setError(""); setImportedTitle(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void importDeck(); } }} />
    </label> : <label className="first-run-setup__field" htmlFor="first-run-deck-list">
      <span>Deck list</span>
      <textarea id="first-run-deck-list" rows={7} autoComplete="off" spellCheck={false} value={text} disabled={busy} placeholder={"My deck\n\nLegend\n1 Ahri, Alluring\n\nMain Deck\n3 Falling Star"} onChange={(event) => { setText(event.currentTarget.value); setError(""); setImportedTitle(""); }} />
    </label>}
    <button type="button" className="first-run-setup__button first-run-setup__button--secondary" disabled={busy || !source.trim()} onClick={() => void importDeck()}>
      {busy ? <LoaderCircle className="first-run-setup__spinner" size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{busy ? "Importing deck…" : "Import deck"}
    </button>
    </fieldset>
    {duplicate ? <DeckImportDecision duplicate={duplicate} busy={busy} onChoose={choice => void importDeck(choice)} onCancel={() => { setDuplicate(null); setError(""); }} /> : null}
    {error ? <p className="first-run-setup__error" role="alert">{error}</p> : null}
    {importedTitle ? <p className="first-run-deck-import__success" role="status"><Check size={16} aria-hidden="true" /><span>{importedTitle} is ready to use.</span></p> : null}
  </section>;
}
