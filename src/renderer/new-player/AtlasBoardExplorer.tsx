import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { createLessonState } from "../../shared/newPlayerTutorial";
import { AtlasTutorialBoard } from "./AtlasTutorialBoard";
import "./AtlasBoardExplorer.css";

const ZONES = [
  { id: "hand", name: "Your hand", x: 42, y: 84, text: "Your cards wait here until you play them. Your opponent sees their backs, not their faces. Read a card’s cost before deciding whether to play it or save it for later." },
  { id: "base", name: "Base", x: 50, y: 65, text: "Your home area. Units normally enter exhausted here, or at a battlefield you control if its rules allow it. Once ready, a unit can move from base to a battlefield to contest control." },
  { id: "battlefields", name: "Battlefields", x: 42, y: 34, text: "The two shared battlefields are where you contest control and score for conquering or holding. Each player brings one in this game. You can conquer either battlefield, including the one your opponent brought." },
  { id: "runes", name: "Runes", x: 23, y: 65, text: "Your runes pay for cards. Exhaust one for one energy. Recycle one to its deck for one power of its domain, even if it is exhausted. Recycling alone makes no energy; the rune leaves the table until you channel it again." },
  { id: "rune-deck", name: "Rune deck", x: 13, y: 84, text: "The separate 12-rune deck. During Channel, you bring ready runes from here onto the table. They help pay for cards; they do not join the cards you draw into your hand." },
  { id: "deck", name: "Main deck", x: 73, y: 84, text: "Draw your cards from this deck into your hand. In Constructed, it has exactly 40 cards, including your chosen champion. Setting that champion aside leaves 39 cards before the opening draw." },
  { id: "legend", name: "Legend", x: 70, y: 65, text: "Your legend stays face up in its own zone. Its domains—the coloured card groups—decide which cards your deck can use. Its printed abilities can help your plan. It is not the champion unit you pay to play." },
  { id: "champion", name: "Chosen champion", x: 77, y: 65, text: "Your chosen champion is a unit from your main deck that shares a champion tag with your legend. It starts face up here, separate from your opening hand. Pay its printed cost to play it; this space does not supply another copy." },
  { id: "trash", name: "Trash", x: 79, y: 84, text: "Killed units, used spells and discarded cards go to the trash, face up. Both players can inspect it. These cards have left play, but a card effect may let you use one again." },
  { id: "score", name: "Score", x: 4, y: 47, text: "Your score is on the left; your opponent’s is on the right. First to 8 wins. Conquering and holding earn points. The final point from conquering has an extra requirement, which the guided game demonstrates." },
  { id: "chain", name: "Chain and log", x: 92, y: 36, text: "The right sidebar shows the game log, chain and card previews. The chain holds spells and abilities waiting to happen. Players can respond before they resolve, and the newest waiting item resolves first." },
] as const;

/** Same renderer as the guided game, with all gameplay dispatch disabled. */
export function AtlasBoardExplorer() {
  const [state] = useState(() => createLessonState("read-a-card"));
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 360 });
  const frameRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pinRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const returnFocus = useRef(false);
  const popupId = useId();
  const zone = ZONES[selected];

  function openZone(index: number) {
    setSelected(index);
    setOpen(true);
    // Bring the explanation into view with the table, rather than sending the reader below it.
    frameRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function closePopup() {
    returnFocus.current = true;
    setOpen(false);
  }

  useLayoutEffect(() => {
    if (!open) {
      if (returnFocus.current) pinRefs.current[selected]?.focus({ preventScroll: true });
      returnFocus.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
    const frame = frameRef.current;
    const popup = popupRef.current;
    if (!frame || !popup) return;
    const place = () => {
      const bounds = frame.getBoundingClientRect();
      const margin = 12;
      const topEdge = Math.max(margin, margin - bounds.top);
      const bottomEdge = Math.min(bounds.height - margin, window.innerHeight - margin - bounds.top);
      const maxHeight = Math.max(100, bottomEdge - topEdge);
      const width = popup.getBoundingClientRect().width;
      const height = Math.min(popup.scrollHeight, maxHeight);
      // Use the opposite side of the board so the selected pin stays visible.
      const left = zone.x < 50 ? Math.max(margin, bounds.width - width - margin) : margin;
      const preferredTop = bounds.height * zone.y / 100 - height / 2;
      const top = Math.max(topEdge, Math.min(preferredTop, bottomEdge - height));
      setPosition(previous => previous.left === left && previous.top === top && previous.maxHeight === maxHeight
        ? previous : { left, top, maxHeight });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(frame);
    observer.observe(popup);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, selected, zone.x, zone.y]);

  return <section className="atlas-board-explorer" aria-label="Explore the Atlas board" onKeyDown={event => {
    if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePopup();
    }
  }}>
    <p className="abe-intro">Click a numbered area to read about it on the board. Use Previous and Next to look around, or close the popup to inspect cards. Exploring changes no game actions or lesson progress.</p>
    <div className="abe-frame" ref={frameRef} data-explore-zone={open ? zone.id : undefined}>
      <AtlasTutorialBoard state={state} mode="explore" onAction={() => undefined} />
      <div className="abe-pins" role="group" aria-label="Board areas">{ZONES.map((item, index) => <button
        type="button" key={item.id} ref={element => { pinRefs.current[index] = element; }}
        style={{ left: `${item.x}%`, top: `${item.y}%` }}
        aria-label={`Explore ${item.name}`} title={item.name} aria-haspopup="dialog"
        aria-expanded={open && selected === index} aria-controls={open && selected === index ? popupId : undefined}
        onClick={() => openZone(index)}><b>{index + 1}</b><span>{item.name}</span></button>)}</div>
      {open && <div className="abe-popup" id={popupId} ref={popupRef} role="dialog"
        aria-labelledby={`${popupId}-title`} aria-describedby={`${popupId}-description`} style={position}>
        <div className="abe-popup-heading">
          <div><span className="abe-popup-count">Board area {selected + 1} of {ZONES.length}</span>
            <h3 id={`${popupId}-title`} ref={headingRef} tabIndex={-1}>{zone.name}</h3></div>
          <button type="button" className="abe-close" aria-label="Close board explanation" onClick={closePopup}>Close <span aria-hidden="true">×</span></button>
        </div>
        <p id={`${popupId}-description`}>{zone.text}</p>
        <div className="abe-popup-navigation" role="group" aria-label="Explore another board area">
          <button type="button" disabled={selected === 0} onClick={() => openZone(selected - 1)}>← Previous</button>
          {selected < ZONES.length - 1
            ? <button type="button" onClick={() => openZone(selected + 1)}>Next →</button>
            : <button type="button" onClick={closePopup}>Done</button>}
        </div>
      </div>}
    </div>
  </section>;
}

export default AtlasBoardExplorer;
