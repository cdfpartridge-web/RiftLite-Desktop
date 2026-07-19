import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ClipboardList,
  Home,
  Play,
  Settings,
  Sparkles,
  Users,
  X
} from "lucide-react";
import {
  currentGuidedTourStep,
  guidedTourProgress,
  nextGuidedTourStep,
  previousGuidedTourStep,
  skipGuidedTour,
  type GuidedTourState,
  type GuidedTourStepId
} from "../shared/guidedTour";
import type { NavigationTarget } from "../shared/navigationModel";

type TourRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

const TOUR_TARGETS: Record<GuidedTourStepId, string> = {
  home: '[data-tour-target="home"]',
  play: '[data-tour-target="play"]',
  review: '[data-tour-target="review"]',
  prepare: '[data-tour-target="prepare"]',
  community: '[data-tour-target="community"]',
  utilities: '[data-tour-target="utilities"]'
};

const TOUR_STEP_LABELS: Record<GuidedTourStepId, string> = {
  home: "Home",
  play: "Play",
  review: "Review",
  prepare: "Prepare",
  community: "Community",
  utilities: "Utilities"
};

export interface GuidedTourProps {
  state: GuidedTourState;
  onNavigate: (target: NavigationTarget) => void;
  onStateChange: (state: GuidedTourState) => void;
  onFinish: (state: GuidedTourState) => void;
}

export function GuidedTour({ state, onNavigate, onStateChange, onFinish }: GuidedTourProps) {
  const step = currentGuidedTourStep(state);
  const progress = guidedTourProgress(state);
  const [targetRect, setTargetRect] = useState<TourRect | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const navigateRef = useRef(onNavigate);

  useEffect(() => {
    navigateRef.current = onNavigate;
  }, [onNavigate]);

  useEffect(() => {
    if (!step) return;
    navigateRef.current(step.target);
  }, [step?.id]);

  useEffect(() => {
    if (!step) return;
    let disposed = false;
    const timers: number[] = [];
    const updateTarget = () => {
      if (disposed) return;
      const target = document.querySelector<HTMLElement>(TOUR_TARGETS[step.id as GuidedTourStepId]);
      if (!target) {
        setTargetRect(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      const padding = 8;
      const left = Math.max(8, rect.left - padding);
      const top = Math.max(8, rect.top - padding);
      const right = Math.min(window.innerWidth - 8, rect.right + padding);
      const bottom = Math.min(window.innerHeight - 8, rect.bottom + padding);
      setTargetRect({
        top,
        right,
        bottom,
        left,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
      });
    };
    const scheduleUpdate = () => window.requestAnimationFrame(updateTarget);
    [0, 80, 220, 600].forEach((delay) => {
      timers.push(window.setTimeout(scheduleUpdate, delay));
    });
    window.addEventListener("resize", scheduleUpdate);
    document.addEventListener("scroll", scheduleUpdate, true);
    return () => {
      disposed = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", scheduleUpdate);
      document.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [step?.id]);

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [step?.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onFinish(skipGuidedTour(state));
        return;
      }
      if (event.key === "ArrowLeft" && !progress.isFirst) {
        event.preventDefault();
        onStateChange(previousGuidedTourStep(state));
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        advanceTour();
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  });

  const scrimStyles = useMemo<React.CSSProperties[]>(() => {
    if (!targetRect) return [{ inset: 0 }];
    return [
      { top: 0, left: 0, right: 0, height: targetRect.top },
      { top: targetRect.top, left: 0, width: targetRect.left, height: targetRect.height },
      { top: targetRect.top, left: targetRect.right, right: 0, height: targetRect.height },
      { top: targetRect.bottom, left: 0, right: 0, bottom: 0 }
    ];
  }, [targetRect]);

  if (!step) return null;

  function advanceTour() {
    const next = nextGuidedTourStep(state);
    if (next.status === "completed") {
      onFinish(next);
      return;
    }
    onStateChange(next);
  }

  const StepIcon = guidedTourStepIcon(step.id as GuidedTourStepId);

  return (
    <div
      className="guided-tour-layer"
      data-testid="onboarding-tour"
      data-tour-step={progress.current}
      aria-live="polite"
    >
      {scrimStyles.map((style, index) => (
        <div className="guided-tour-scrim" style={style} key={index} />
      ))}
      {targetRect ? (
        <div
          className="guided-tour-spotlight"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height
          }}
        />
      ) : null}
      <section
        ref={cardRef}
        className="guided-tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-tour-title"
        tabIndex={-1}
      >
        <header className="guided-tour-header">
          <div className="guided-tour-brand">
            <span><Sparkles size={15} /> Guided tour</span>
            <small>{progress.current} of {progress.total}</small>
          </div>
          <button
            type="button"
            className="guided-tour-close"
            onClick={() => onFinish(skipGuidedTour(state))}
            aria-label="Skip guided tour"
            title="Skip guided tour"
          >
            <X size={17} />
          </button>
        </header>
        <div className="guided-tour-progress" aria-label={`Tour progress: ${progress.percent}%`}>
          <span style={{ width: `${progress.percent}%` }} />
        </div>
        <div className="guided-tour-body">
          <div className="guided-tour-step-icon"><StepIcon size={22} /></div>
          <span className="guided-tour-kicker">{TOUR_STEP_LABELS[step.id as GuidedTourStepId]}</span>
          <h2 id="guided-tour-title">{step.title}</h2>
          <p>{step.description}</p>
          {progress.isLast ? (
            <div className="guided-tour-ready">
              <Check size={17} />
              <span>You can replay this tour or reset first-launch guidance from Settings at any time.</span>
            </div>
          ) : null}
        </div>
        <div className="guided-tour-dots" aria-hidden="true">
          {Array.from({ length: progress.total }, (_, index) => (
            <span data-active={index < progress.current} key={index} />
          ))}
        </div>
        <footer className="guided-tour-actions">
          <button type="button" className="guided-tour-skip" onClick={() => onFinish(skipGuidedTour(state))}>
            Skip tour
          </button>
          <div>
            <button
              type="button"
              className="secondary"
              onClick={() => onStateChange(previousGuidedTourStep(state))}
              disabled={progress.isFirst}
              data-tour-action="back"
            >
              <ArrowLeft size={15} /> Back
            </button>
            <button type="button" className="primary" onClick={advanceTour} data-tour-action={progress.isLast ? "finish" : "next"}>
              {progress.isLast ? <><Check size={15} /> Finish</> : <>Next <ArrowRight size={15} /></>}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function guidedTourStepIcon(stepId: GuidedTourStepId) {
  switch (stepId) {
    case "home": return Home;
    case "play": return Play;
    case "review": return ClipboardList;
    case "prepare": return BookOpen;
    case "community": return Users;
    case "utilities": return Settings;
  }
}
