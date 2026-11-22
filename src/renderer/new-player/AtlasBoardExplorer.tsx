import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { createLessonState } from "../../shared/newPlayerTutorial";
import { AtlasTutorialBoard } from "./AtlasTutorialBoard";
import "./AtlasBoardExplorer.css";

const ZONES = [
  { id: "hand", name: "Your hand", x: 42, y: 84, text: "Your opponent can see how many cards you’re holding, but only you can see what they are. I’d start by looking at what each one costs, so you know what you could play now and what you might want to save." },
  { id: "base", name: "Base", x: 50, y: 65, text: "Think of base as the place your units can start from. A unit usually enters exhausted, then once it’s ready you can move it out to a battlefield. You can also play it straight to a battlefield you control if that battlefield allows it." },
  { id: "battlefields", name: "Battlefields", x: 42, y: 34, text: "You each brought one of these battlefields, but you can conquer either of them. What matters for scoring is who takes control and who can hold onto it through the other player’s turn." },
  { id: "runes", name: "Runes", x: 23, y: 65, text: "If you need 1 energy, you can exhaust a basic rune and leave it on the table. If you need 1 power of its domain, recycle it to the bottom of the rune deck, even if it’s already exhausted. Recycling by itself gives you the power, so if you want the energy as well, exhaust it first." },
  { id: "rune-deck", name: "Rune deck", x: 13, y: 84, text: "Your 12 runes have a deck of their own. When you channel, the runes come from here straight onto the table ready to use, so they’re separate from the cards you draw into your hand." },
  { id: "deck", name: "Main deck", x: 73, y: 84, text: "This is where you draw from. Your Constructed main deck has 40 cards including your chosen champion, so once you set that champion aside you’ve got 39 left before you draw your opening hand." },
  { id: "legend", name: "Legend", x: 70, y: 65, text: "Your legend stays face up here, and the domains shown on it tell you which colours of cards you can put in your deck. Have a look at its abilities too, they’re one reason you might pick this legend to build around." },
  { id: "champion", name: "Chosen champion", x: 77, y: 65, text: "You chose this unit from your main deck because it shares a champion tag with your legend. It waits here face up, so even before you look at your opening hand you know you can play this copy when you can pay for it. Once it leaves, the space stays empty." },
  { id: "trash", name: "Trash", x: 79, y: 84, text: "If a unit dies, a spell finishes or you discard a card, this is where you’ll usually find it. Both players can look through either trash, which comes in handy when an effect lets you use a card from there again." },
  { id: "score", name: "Score", x: 4, y: 47, text: "Your points are on the left and your opponent’s are on the right, with 8 as the target. You score by conquering or holding battlefields, and in the guided game we’ll see what extra work it takes to earn point 8 by conquering." },
  { id: "chain", name: "Chain and log", x: 92, y: 36, text: "Look here when someone plays a spell. The chain shows which spells and abilities are waiting, so you can see what you’re responding to and which one will resolve first, starting with the newest. The log and the card reader are here as well." },
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
    <p className="abe-intro">Pick a number to look around the board, then use Previous or Next to move between the areas. You can close the explanation to read a card, and your lesson will still be where you left it.</p>
    <div className="abe-frame" ref={frameRef} data-explore-zone={open ? zone.id : undefined}>
      <AtlasTutorialBoard state={state} mode="explore" onAction={() => undefined} />
      <div className="abe-pins" role="group" aria-label="Board areas">{ZONES.map((item, index) => <button
        type="button" key={item.id} ref={element => { pinRefs.current[index] = element; }}
        data-board-area={item.id}
        style={{ left: `clamp(16px, ${item.x}%, calc(100% - 16px))`, top: `${item.y}%` }}
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
