import React, { useEffect, useRef } from "react";
import { BarChart3, Check, Layers, Lightbulb, MousePointer2, Shield, X } from "lucide-react";

export interface MulliganLabIntroProps {
  onStart: () => void;
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

export function MulliganLabIntro({ onStart, onDismiss }: MulliganLabIntroProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const startRef = useRef<HTMLButtonElement | null>(null);
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => startRef.current?.focus({ preventScroll: true }));

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
    <div className="mulligan-lab-intro-layer" data-testid="mulligan-lab-intro">
      <section
        id="mulligan-lab-intro-dialog"
        ref={dialogRef}
        className="mulligan-lab-intro-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mulligan-lab-intro-title"
        aria-describedby="mulligan-lab-intro-description"
        tabIndex={-1}
      >
        <header className="mulligan-lab-intro-header">
          <div className="mulligan-lab-intro-heading">
            <span className="mulligan-lab-intro-mark" aria-hidden="true"><Lightbulb size={22} /></span>
            <div>
              <span className="eyebrow">Before turn one</span>
              <h2 id="mulligan-lab-intro-title">How Mulligan Lab works</h2>
            </div>
          </div>
          <button
            type="button"
            className="mulligan-lab-intro-close"
            aria-label="Dismiss Mulligan Lab introduction"
            title="Dismiss introduction"
            onClick={onDismiss}
          >
            <X size={17} />
          </button>
        </header>

        <p id="mulligan-lab-intro-description" className="mulligan-lab-intro-lead">
           Practise real opening hands, make your own redraw choice, then compare it with anonymised community Web Replays from indexed pre-season and current-season history.
        </p>

        <div className="mulligan-lab-intro-steps">
          <article>
            <span aria-hidden="true"><Layers size={19} /></span>
            <div><strong>1. Choose your practice</strong><p>Play the Daily 5, follow your active deck, choose an exact matchup, or mix the available hands.</p></div>
          </article>
          <article>
            <span aria-hidden="true"><MousePointer2 size={19} /></span>
            <div><strong>2. Make the mulligan</strong><p>Select up to two cards to redraw, or keep all four. Keys 1-4 select cards and Enter locks in.</p></div>
          </article>
          <article>
            <span aria-hidden="true"><BarChart3 size={19} /></span>
            <div><strong>3. Compare real patterns</strong><p>Reveal card-by-card evidence plus whole-hand redraw-count patterns. When setup data is proven, the Curve check also shows exact one-versus-two redraw odds.</p></div>
          </article>
          <article>
            <span aria-hidden="true"><Shield size={19} /></span>
            <div>
              <strong>4. Read each signal in context</strong>
              <p>Green means aligned with a reliable pattern, rose means different, and amber marks early or curve context. The Curve check is a printed-cost gameplay baseline. Community choices and outcome rates are descriptive, not proof that a choice caused a win.</p>
              <div className="mulligan-lab-intro-signal-key" aria-label="Feedback colour key">
                <span data-tone="aligned">Aligned</span>
                <span data-tone="different">Different</span>
                <span data-tone="context">Early / curve</span>
              </div>
            </div>
          </article>
        </div>

        <div className="mulligan-lab-intro-trust">
          <Check size={16} aria-hidden="true" />
           <p><strong>Patterns, not prescriptions.</strong> Community behaviour is aggregated; no sampled player decision is treated as the answer. Challenges use reliable contextual evidence; Guided and Explore hands stay non-judgmental. Confidence and spaced review progress remain only on this device.</p>
        </div>

        <footer className="mulligan-lab-intro-actions">
          <button type="button" className="mulligan-lab-intro-skip" onClick={onDismiss}>Close guide</button>
          <button ref={startRef} type="button" className="primary" onClick={onStart}><Check size={16} /> Start training</button>
        </footer>
      </section>
    </div>
  );
}
