import React, { useEffect, useRef } from "react";
import { ArrowRight, BookOpen, Settings2, Sparkles } from "lucide-react";
import { NewPlayerCinematicArt } from "./NewPlayerCinematicArt";
import "./NewPlayerHub.css";
import "./NewPlayerCinematicTheme.css";
import "./NewPlayerCinematicHub.css";

export function NewPlayerWelcome({ onLearn, onSetup, onLater }: {
  onLearn: () => void;
  onSetup: () => void;
  onLater: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const onLaterRef = useRef(onLater);
  onLaterRef.current = onLater;
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = dialogRef.current?.querySelector<HTMLButtonElement>("button");
    first?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onLaterRef.current(); }
      if (event.key !== "Tab") return;
      const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      if (!buttons.length) return;
      if (event.shiftKey && (document.activeElement === buttons[0] || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); buttons.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
        event.preventDefault(); buttons[0].focus();
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); if (before?.isConnected) before.focus(); };
  }, []);
  return <div className="nph-welcome-backdrop">
    <section className="nph-welcome" role="dialog" aria-modal="true" aria-labelledby="nph-welcome-title" ref={dialogRef}>
      <NewPlayerCinematicArt cardId="OGN-255" className="nph-welcome-art" />
      <span className="nph-eyebrow"><Sparkles size={15} /> WELCOME TO RIFTLITE</span>
      <h1 id="nph-welcome-title">Your first step into the Rift.</h1>
      <p>Learn the game, or get your companion ready. You can come back to either whenever you like.</p>
      <div className="nph-welcome-choices">
        <button type="button" onClick={onLearn}><BookOpen size={28} /><strong>I’m new to Riftbound</strong><span>Start with the visual basics, then practise in the guided game. Creator guides and your first deck come next.</span><b>Start with the basics <ArrowRight size={17} /></b></button>
        <button type="button" onClick={onSetup}><Settings2 size={28} /><strong>Set up RiftLite</strong><span>Choose your player, account, replay preferences and deck.</span><b>Start setup <ArrowRight size={17} /></b></button>
      </div>
      <button type="button" className="nph-text-button" onClick={onLater}>Explore first — set up later</button>
      <small>Learning needs no account. Your lesson progress stays on this device.</small>
    </section>
  </div>;
}
