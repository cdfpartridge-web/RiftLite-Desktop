import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  Flag,
  Layers3,
  LoaderCircle,
  Route,
  ShieldCheck,
  Sparkles,
  Swords,
  X,
  Zap
} from "lucide-react";
import "./styles/enhancedInsightsIntro.css";

export interface EnhancedInsightsIntroSelection {
  askPostGameQuestion: boolean;
}

export interface EnhancedInsightsIntroProps {
  defaultAskPostGameQuestion?: boolean;
  busy?: boolean;
  onEnable: (selection: EnhancedInsightsIntroSelection) => void;
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

const INSIGHT_AREAS = [
  { icon: Route, label: "Score paths & lethal windows" },
  { icon: Zap, label: "Rune use & information timing" },
  { icon: Layers3, label: "Battlefield commitment" },
  { icon: Swords, label: "Combat & tempo swings" },
  { icon: Flag, label: "Sideboard follow-through" }
] as const;

export function EnhancedInsightsIntro({
  defaultAskPostGameQuestion = true,
  busy = false,
  onEnable,
  onDismiss
}: EnhancedInsightsIntroProps) {
  const [askPostGameQuestion, setAskPostGameQuestion] = useState(defaultAskPostGameQuestion);
  const dialogRef = useRef<HTMLElement | null>(null);
  const enableRef = useRef<HTMLButtonElement | null>(null);
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => enableRef.current?.focus({ preventScroll: true }));

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
    <div className="enhanced-insights-intro-layer" data-testid="enhanced-insights-intro">
      <section
        id="enhanced-insights-intro-dialog"
        ref={dialogRef}
        className="enhanced-insights-intro-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="enhanced-insights-intro-title"
        aria-describedby="enhanced-insights-intro-description enhanced-insights-intro-privacy"
        tabIndex={-1}
      >
        <header className="enhanced-insights-intro-header">
          <div className="enhanced-insights-intro-heading">
            <span className="enhanced-insights-intro-mark" aria-hidden="true">
              <BrainCircuit size={25} />
            </span>
            <div>
              <span className="eyebrow"><Sparkles size={12} /> New opt-in beta</span>
              <h2 id="enhanced-insights-intro-title">See the decisions behind the result</h2>
            </div>
          </div>
          <button
            type="button"
            className="enhanced-insights-intro-close"
            aria-label="Dismiss Enhanced Insights introduction"
            title="Not now"
            disabled={busy}
            onClick={onDismiss}
          >
            <X size={18} />
          </button>
        </header>

        <p id="enhanced-insights-intro-description" className="enhanced-insights-intro-lead">
          Enhanced Insights keeps richer match evidence so Coach can examine <strong>why a game turned</strong>, not just whether you drew a two-drop or won.
        </p>

        <div className="enhanced-insights-intro-story">
          <section className="enhanced-insights-intro-capture" aria-labelledby="enhanced-insights-capture-title">
            <div className="enhanced-insights-intro-section-heading">
              <span aria-hidden="true"><Layers3 size={18} /></span>
              <div>
                <small>During enabled games</small>
                <h3 id="enhanced-insights-capture-title">What RiftLite remembers</h3>
              </div>
            </div>
            <ul>
              <li><Check size={14} aria-hidden="true" /><span><strong>Sequence</strong> — turns, active player, action order and score path</span></li>
              <li><Check size={14} aria-hidden="true" /><span><strong>Game state</strong> — runes, card movement, battlefields and combat when available</span></li>
              <li><Check size={14} aria-hidden="true" /><span><strong>Your context</strong> — review markers, notes, sideboard changes and a match-time snapshot of the relevant Deck Notebook plan</span></li>
            </ul>
          </section>

          <div className="enhanced-insights-intro-flow" aria-hidden="true">
            <span>local evidence</span>
            <ArrowRight size={20} />
          </div>

          <section className="enhanced-insights-intro-unlocks" aria-labelledby="enhanced-insights-unlocks-title">
            <div className="enhanced-insights-intro-section-heading">
              <span aria-hidden="true"><BrainCircuit size={18} /></span>
              <div>
                <small>After the match</small>
                <h3 id="enhanced-insights-unlocks-title">What Coach can explore</h3>
              </div>
            </div>
            <div className="enhanced-insights-intro-chips">
              {INSIGHT_AREAS.map(({ icon: Icon, label }) => (
                <span key={label}><Icon size={14} aria-hidden="true" />{label}</span>
              ))}
            </div>
            <p>Every insight carries an evidence receipt. Missing capture stays labelled unknown instead of being guessed.</p>
          </section>
        </div>

        <div className="enhanced-insights-intro-preference">
          <label htmlFor="enhanced-insights-post-game-question">
            <span className="enhanced-insights-intro-switch">
              <input
                id="enhanced-insights-post-game-question"
                type="checkbox"
                role="switch"
                checked={askPostGameQuestion}
                disabled={busy}
                onChange={(event) => setAskPostGameQuestion(event.currentTarget.checked)}
              />
              <span aria-hidden="true" />
            </span>
            <span>
              <strong>Ask one quick question after relevant games</strong>
              <small>Optional context such as “intentional”, “forced” or “I missed something” helps Coach understand your decision.</small>
            </span>
          </label>
        </div>

        <aside id="enhanced-insights-intro-privacy" className="enhanced-insights-intro-privacy">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <strong>Private and local by default</strong>
            <p>This does not upload replays, publish your stats, record video or enable diagnostics. New match evidence and decision context stay on this device. Replay Coach can use a local semantic replay record when it returns; you can opt a match out during review. Your Deck Notebook itself still follows your existing RiftLite account-backup setting. You can turn capture off or delete Enhanced evidence from Settings.</p>
          </div>
        </aside>

        <footer className="enhanced-insights-intro-actions">
          <button type="button" className="enhanced-insights-intro-later" disabled={busy} onClick={onDismiss}>
            Not now
          </button>
          <button
            ref={enableRef}
            type="button"
            className="primary enhanced-insights-intro-enable"
            disabled={busy}
            onClick={() => onEnable({ askPostGameQuestion })}
          >
            {busy ? <LoaderCircle className="enhanced-insights-intro-spinner" size={17} aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
            {busy ? "Enabling…" : "Enable Enhanced Insights"}
          </button>
        </footer>
      </section>
    </div>
  );
}
