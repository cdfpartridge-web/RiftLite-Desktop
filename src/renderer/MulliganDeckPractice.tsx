import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Layers, Maximize2, RotateCcw, Shuffle, X } from "lucide-react";
import type { MulliganLabRegistry, MulliganLabRegistryCard } from "../shared/mulliganLab";
import {
  completeMulliganPracticeHand,
  dealMulliganPracticeHand,
  parseMulliganPracticeDeck,
  type MulliganPracticeDeck,
} from "../shared/mulliganPractice";
import type { SavedDeck } from "../shared/types";
import "./styles/mulligan-deck-practice.css";

export interface MulliganDeckPracticeProps {
  deck: SavedDeck | null;
  registry: MulliganLabRegistry;
  opponent: MulliganLabRegistryCard | null;
  initiative: "all" | "1st" | "2nd";
  onChooseDeck: () => void;
  keyboardEnabled?: boolean;
}

export function MulliganDeckPractice(props: MulliganDeckPracticeProps) {
  if (!props.deck) return (
    <section className="mulligan-deck-practice-empty">
      <Layers size={28} aria-hidden="true" />
      <div><span className="eyebrow">Your exact deck</span><h3>Choose a deck to practise with</h3><p>Import or select your active deck to deal opening hands from your own card list.</p></div>
      <button type="button" className="primary" onClick={props.onChooseDeck}>Choose deck</button>
    </section>
  );
  return <PracticeDeckSetup key={`${props.deck.id}:${props.deck.snapshotJson}`} {...props} deck={props.deck} />;
}

function PracticeDeckSetup(props: MulliganDeckPracticeProps & { deck: SavedDeck }) {
  const [chosenCode, setChosenCode] = useState<string>();
  const parsed = useMemo(() => parseMulliganPracticeDeck(props.deck.snapshotJson, props.registry, chosenCode), [props.deck.snapshotJson, props.registry, chosenCode]);
  if (parsed.status === "unavailable") return (
    <section className="mulligan-deck-practice-empty">
      <Layers size={28} aria-hidden="true" />
      <div><span className="eyebrow">Your exact deck</span><h3>This deck needs a quick check</h3><p>{parsed.message}</p><small>Refresh or edit the saved deck, then return here to practise.</small></div>
      <button type="button" className="primary" onClick={props.onChooseDeck}>Open decks</button>
    </section>
  );
  if (parsed.status === "choose-champion") return (
    <section className="mulligan-deck-practice-setup">
      <span className="eyebrow">Practice · Your exact deck</span>
      <h3>Choose your champion</h3>
      <p>{parsed.message}</p>
      <div className="mulligan-deck-practice-champions">
        {parsed.champions.map((card) => <button type="button" key={card.code} onClick={() => setChosenCode(card.code)} aria-label={`Choose ${card.name} as your champion`}>
          <PracticeCardImage card={card} /><strong>{card.name}</strong><small>Start one copy in the champion zone</small>
        </button>)}
      </div>
    </section>
  );
  return <PracticeHand key={`${parsed.deck.chosenChampion.code}:${props.opponent?.code ?? "all"}:${props.initiative}`} {...props} practiceDeck={parsed.deck} />;
}

function PracticeHand({ deck, practiceDeck, opponent, initiative, keyboardEnabled = true, onChooseDeck }: MulliganDeckPracticeProps & { deck: SavedDeck; practiceDeck: MulliganPracticeDeck }) {
  const [hand, setHand] = useState(() => dealMulliganPracticeHand(practiceDeck));
  const [selected, setSelected] = useState<number[]>([]);
  const [result, setResult] = useState<ReturnType<typeof completeMulliganPracticeHand> | null>(null);
  const [notice, setNotice] = useState("");
  const [handNumber, setHandNumber] = useState(1);
  const [zoomed, setZoomed] = useState<MulliganLabRegistryCard | null>(null);
  const closeZoom = useCallback(() => setZoomed(null), []);
  const toggle = useCallback((index: number) => {
    if (result) return;
    if (selected.includes(index)) {
      setNotice("");
      setSelected(selected.filter((value) => value !== index));
    } else if (selected.length === 2) {
      setNotice("You can send back up to two cards. Deselect one to change your choice.");
    } else {
      setNotice("");
      setSelected([...selected, index]);
    }
  }, [result, selected]);
  const finish = useCallback(() => {
    if (result) return;
    setResult(completeMulliganPracticeHand(hand, selected));
    setNotice("");
  }, [hand, selected, result]);
  const next = useCallback(() => {
    setHand(dealMulliganPracticeHand(practiceDeck));
    setSelected([]);
    setResult(null);
    setNotice("");
    setHandNumber((value) => value + 1);
  }, [practiceDeck]);
  useEffect(() => {
    if (!keyboardEnabled || zoomed) return;
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, button, a, dialog, [role="dialog"], [contenteditable="true"]')) return;
      if (!result && /^[1-4]$/.test(event.key)) { event.preventDefault(); toggle(Number(event.key) - 1); }
      else if (event.key === "Enter") { event.preventDefault(); if (result) next(); else finish(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboardEnabled, zoomed, result, toggle, finish, next]);
  const visibleCards = result?.cards ?? hand.cards;
  return (
    <section className="mulligan-deck-practice" aria-label="Practice with your exact deck">
      <main className="mulligan-deck-practice-table">
        <div className="mulligan-deck-practice-ribbon"><span><Shuffle size={14} /> Practice</span><span>Your exact deck</span><span>Ungraded</span></div>
        <header className="mulligan-deck-practice-heading">
          <div><span className="eyebrow">Hand {handNumber} · {deck.title}</span><h3>{result ? "Your starting hand" : "What would you send back?"}</h3><p>{result ? "Consider how this hand supports your first few turns." : "Select up to two cards to replace, or keep all four."}</p></div>
          <div className="mulligan-deck-practice-context">
            {opponent ? <><img src={opponent.imageUrl} alt="" /><span><small>Practising against</small><strong>{opponent.name}</strong></span></> : <span><small>Practising against</small><strong>Any opponent</strong></span>}
            <span className="mulligan-deck-practice-initiative">{initiative === "1st" ? "Going first" : initiative === "2nd" ? "Going second" : "Either initiative"}</span>
          </div>
        </header>
        <div className="mulligan-deck-practice-hand" aria-label={result ? "Final starting hand" : "Opening hand"}>
          {visibleCards.map((card, index) => {
            const replaced = result?.redrawnIndexes.includes(index) ?? false;
            const state = result ? (replaced ? "New card" : "Kept") : selected.includes(index) ? "Send back" : "Keep";
            return <article className="mulligan-deck-practice-card" key={index} data-selected={!result && selected.includes(index)} data-replaced={replaced}>
              <button type="button" className="mulligan-deck-practice-pick" aria-label={`Card ${index + 1}: ${card.name}. ${state}`} aria-pressed={!result && selected.includes(index)} disabled={Boolean(result)} onClick={() => toggle(index)}>
                <PracticeCardImage key={`${card.code}:${card.imageUrl}`} card={card} /><span className="mulligan-deck-practice-number">{index + 1}</span><span className="mulligan-deck-practice-choice">{state}</span>
              </button>
              <strong>{card.name}</strong>
              <button type="button" className="mulligan-deck-practice-read" onClick={() => setZoomed(card)} aria-label={`Read ${card.name}`}><Maximize2 size={13} /> Read card</button>
              {replaced ? <small className="mulligan-deck-practice-replaced">Replaced {hand.cards[index].name}</small> : null}
            </article>;
          })}
        </div>
        <footer className="mulligan-deck-practice-actions">
          <div aria-live="polite"><strong>{result ? (selected.length ? `Replaced ${selected.length} ${selected.length === 1 ? "card" : "cards"}` : "Kept all four cards") : `${selected.length} of 2 selected`}</strong><span>{result ? "A fresh shuffle is ready whenever you are." : "Your other cards stay in hand."}</span>{notice ? <span className="mulligan-deck-practice-notice">{notice}</span> : null}</div>
          {result ? <button type="button" className="primary" onClick={next}><Shuffle size={16} /> Deal another hand</button> : <><button type="button" className="secondary" disabled={!selected.length} onClick={() => { setSelected([]); setNotice(""); }}>Clear selection</button><button type="button" className="primary" onClick={finish}>{selected.length ? <RotateCcw size={16} /> : <Check size={16} />}{selected.length ? "Mulligan" : "Keep hand"}</button></>}
        </footer>
      </main>
      <aside className="mulligan-deck-practice-rail">
        <section><span className="eyebrow">Your saved deck</span><h4>{deck.title}</h4><p>{deck.legend}</p><button type="button" className="secondary" onClick={onChooseDeck}>Open decks</button></section>
        <section><span className="eyebrow">Chosen champion</span><button type="button" className="mulligan-deck-practice-champion" onClick={() => setZoomed(practiceDeck.chosenChampion)} aria-label={`Read chosen champion ${practiceDeck.chosenChampion.name}`}><PracticeCardImage card={practiceDeck.chosenChampion} /><span><strong>{practiceDeck.chosenChampion.name}</strong><small>Starts in your champion zone</small></span><Maximize2 size={13} /></button><p>One copy is set aside before drawing. Other copies can still appear in your hand.</p></section>
        <section><span className="eyebrow">How practice works</span><p>Every hand is randomly drawn from your saved main deck, using its actual card quantities.</p><p>Cards you send back stay aside until replacements are drawn, then recycle to the bottom of your deck.</p><p className="mulligan-deck-practice-ungraded">Practice has no score or community verdict. Your choices stay out of training reviews.</p><small>Opponent and initiative are context for your decision. No community data is needed.</small></section>
      </aside>
      {zoomed ? <PracticeCardZoom card={zoomed} onClose={closeZoom} /> : null}
    </section>
  );
}

function PracticeCardImage({ card }: { card: MulliganLabRegistryCard }) {
  const [failed, setFailed] = useState(false);
  return failed || !card.imageUrl ? <span className="mulligan-deck-practice-art-fallback"><strong>{card.name}</strong><small>{card.type}{card.costEnergy != null ? ` · ${card.costEnergy} energy` : ""}</small><span>Artwork unavailable</span></span> : <img src={card.imageUrl} alt={card.name} onError={() => setFailed(true)} />;
}

function PracticeCardZoom({ card, onClose }: { card: MulliganLabRegistryCard; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialogRef} className="mulligan-deck-practice-zoom" aria-labelledby="mulligan-deck-practice-zoom-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Tab") { event.preventDefault(); event.currentTarget.querySelector("button")?.focus(); } }} onClick={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <button type="button" className="secondary" onClick={onClose} aria-label="Close card view"><X size={18} /> Close</button><PracticeCardImage card={card} /><h3 id="mulligan-deck-practice-zoom-title">{card.name}</h3><p>Press Escape to close.</p>
  </dialog>;
}
