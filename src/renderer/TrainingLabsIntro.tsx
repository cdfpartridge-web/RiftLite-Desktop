import React, { useEffect, useRef } from "react";
import { ArrowLeftRight, BarChart3, Check, Minus, Plus, RotateCcw, ShieldCheck, Sparkles, X } from "lucide-react";

export interface TrainingLabsIntroProps {
  onOpenMulligan: () => void;
  onOpenSideboard: () => void;
  onDismiss: () => void;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function TrainingLabsIntro({ onOpenMulligan, onOpenSideboard, onDismiss }: TrainingLabsIntroProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const firstActionRef = useRef<HTMLButtonElement | null>(null);
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => firstActionRef.current?.focus({ preventScroll: true }));

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="training-labs-intro-layer" data-testid="training-labs-intro">
      <section
        id="training-labs-intro-dialog"
        ref={dialogRef}
        className="training-labs-intro-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="training-labs-intro-title"
        aria-describedby="training-labs-intro-description"
        tabIndex={-1}
      >
        <header className="training-labs-intro-header">
          <div className="training-labs-intro-heading">
            <span className="training-labs-intro-mark" aria-hidden="true"><Sparkles size={22} /></span>
            <div>
              <span className="eyebrow">New training modes</span>
              <h2 id="training-labs-intro-title">Turn real matches into practice</h2>
            </div>
          </div>
          <button type="button" className="training-labs-intro-close" aria-label="Close Training Labs guide" onClick={onDismiss}>
            <X size={17} />
          </button>
        </header>

        <p id="training-labs-intro-description" className="training-labs-intro-lead">
          Mulligan Lab and Sideboard Lab are quick, game-like challenges built from anonymised community Web Replays across indexed pre-season and current-season history.
        </p>

        <div className="training-labs-intro-options">
          <article data-lab="mulligan">
            <div className="training-labs-intro-option-heading">
              <span aria-hidden="true"><RotateCcw size={21} /></span>
              <div><small>Before turn one</small><h3>Mulligan Lab</h3></div>
            </div>
            <p>Choose up to two cards to redraw from a real opening hand, then reveal contributor-balanced community patterns and curve context.</p>
            <ul>
              <li><Check size={13} aria-hidden="true" /> Daily, active-deck, and matchup practice</li>
              <li><BarChart3 size={13} aria-hidden="true" /> Confidence, context, and private review progress</li>
            </ul>
            <button ref={firstActionRef} type="button" className="secondary" onClick={onOpenMulligan}>
              <RotateCcw size={15} /> Try Mulligan Lab
            </button>
          </article>

          <article data-lab="sideboard">
            <div className="training-labs-intro-option-heading">
              <span aria-hidden="true"><ArrowLeftRight size={21} /></span>
              <div><small>Between games</small><h3>Sideboard Lab</h3></div>
            </div>
            <p>Build a balanced Game 2 plan, then reveal common cards, quantities, and swap packages for that matchup.</p>
            <div className="training-labs-intro-controls" aria-label="Sideboard control guide">
              <span><Minus size={12} aria-hidden="true" /> Main: take out</span>
              <span><Plus size={12} aria-hidden="true" /> Sideboard: bring in</span>
            </div>
            <button type="button" className="primary" onClick={onOpenSideboard}>
              <ArrowLeftRight size={15} /> Try Sideboard Lab
            </button>
          </article>
        </div>

        <div className="training-labs-intro-trust">
          <ShieldCheck size={17} aria-hidden="true" />
          <p><strong>Learn from patterns, not a prescribed answer.</strong> Reliable contextual evidence can give visual feedback; early or broader data stays neutral. Outcome rates are descriptive and never treated as proof that a choice caused a win.</p>
        </div>

        <footer className="training-labs-intro-actions">
          <span>You can reopen this guide from the <strong>sparkles button on Home</strong>.</span>
          <button type="button" className="training-labs-intro-dismiss" onClick={onDismiss}>Got it</button>
        </footer>
      </section>
    </div>
  );
}
