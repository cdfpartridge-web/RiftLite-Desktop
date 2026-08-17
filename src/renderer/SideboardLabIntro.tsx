import React, { useEffect, useRef } from "react";
import { ArrowLeftRight, BarChart3, Check, Layers, Shield, X } from "lucide-react";

export interface SideboardLabIntroProps {
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

export function SideboardLabIntro({ onStart, onDismiss }: SideboardLabIntroProps) {
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
    <div className="sideboard-lab-intro-layer" data-testid="sideboard-lab-intro">
      <section
        id="sideboard-lab-intro-dialog"
        ref={dialogRef}
        className="sideboard-lab-intro-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sideboard-lab-intro-title"
        aria-describedby="sideboard-lab-intro-description"
        tabIndex={-1}
      >
        <header className="sideboard-lab-intro-header">
          <div className="sideboard-lab-intro-heading">
            <span className="sideboard-lab-intro-mark" aria-hidden="true"><ArrowLeftRight size={22} /></span>
            <div>
              <span className="eyebrow">Between games</span>
              <h2 id="sideboard-lab-intro-title">How Sideboard Lab works</h2>
            </div>
          </div>
          <button type="button" className="sideboard-lab-intro-close" aria-label="Dismiss Sideboard Lab introduction" onClick={onDismiss}>
            <X size={17} />
          </button>
        </header>

        <p id="sideboard-lab-intro-description" className="sideboard-lab-intro-lead">
          Practise real Game 2 and Game 3 sideboard decisions, lock in balanced swaps, then compare each card with anonymous community patterns.
        </p>

        <div className="sideboard-lab-intro-steps">
          <article>
            <span aria-hidden="true"><Layers size={19} /></span>
            <div><strong>1. Read the match context</strong><p>See both Legends, the previous game result, initiative when known, and the exact deck entering this Game 2 or Game 3 window.</p></div>
          </article>
          <article>
            <span aria-hidden="true"><ArrowLeftRight size={19} /></span>
            <div><strong>2. Build a balanced plan</strong><p>Main Deck starts at its registered quantity: press − to take a copy out and + to restore it. Sideboard starts at zero: press + to bring a copy in. Every card entering needs one leaving; choosing no swaps is valid too.</p></div>
          </article>
          <article>
            <span aria-hidden="true"><BarChart3 size={19} /></span>
            <div><strong>3. Reveal real evidence</strong><p>Card signals, moved-copy ranges, recurring IN↔OUT pairs, and supported full packages come from completed community windows where those cards were actually available. Targeted modes query the full indexed pre-season and current-season corpus.</p></div>
          </article>
          <article>
            <span aria-hidden="true"><Shield size={19} /></span>
            <div><strong>4. Treat patterns as context</strong><p>Green aligns with a reliable tendency, rose differs, and amber is developing or unclear. Outcome rates are descriptive, not proof that a swap caused a win.</p></div>
          </article>
        </div>

        <div className="sideboard-lab-intro-trust">
          <Check size={16} aria-hidden="true" />
          <p><strong>Your plan stays yours.</strong> RiftLite never reveals the sampled player’s sideboard choice and never labels an entire plan as objectively correct.</p>
        </div>

        <footer className="sideboard-lab-intro-actions">
          <button type="button" className="sideboard-lab-intro-skip" onClick={onDismiss}>Close guide</button>
          <button ref={startRef} type="button" className="primary" onClick={onStart}><Check size={16} /> Start training</button>
        </footer>
      </section>
    </div>
  );
}
