import React, { useEffect, useId, useRef } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Hand, Layers3, Pause, RotateCcw, Sparkles } from "lucide-react";
import type { GuideNarrationMode } from "../../shared/newPlayerNarration";
import type { TutorialState } from "../../shared/newPlayerTutorial";
import { LessonIllustration } from "./NewPlayerLessonIllustration";
import riftLiteLogo from "../../../resources/riftlite-taskbar-icon.png";
import { NewPlayerCinematicArt } from "./NewPlayerCinematicArt";
import "./NewPlayerCourseIntro.css";
import "./NewPlayerCinematicTheme.css";
import "./NewPlayerCinematicHub.css";

export interface NewPlayerCourseIntroProps {
  tutorial: TutorialState;
  narrationMode: GuideNarrationMode;
  onNarrationMode: (mode: GuideNarrationMode) => void;
  paceWarning: string;
  onStart: () => void;
  onBack: () => void;
}

const PACE_DETAILS: Record<GuideNarrationMode, string> = {
  automatic: "You’ve got 6 seconds for each guide explanation and result. Choose Next if you’re ready sooner, and take as long as you like on your own moves.",
  reading: "You’ll get at least 10 seconds for each explanation and result, and longer for a bigger bit of text.",
  manual: "Choose Next move when you’re ready to see it happen, then take as long as you like to read what changed."
};

export function NewPlayerCourseIntro({ tutorial, narrationMode, onNarrationMode, paceWarning, onStart, onBack }: NewPlayerCourseIntroProps) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  return <section className="nph-course-intro" aria-labelledby={`${id}-heading`}>
    <div className="nph-course-intro-inner">
      <header className="nph-course-intro-header">
        <NewPlayerCinematicArt cardId="OGN-255" className="nph-course-intro-art" />
        <div className="nph-course-intro-brand"><img src={riftLiteLogo} alt="" /><span>RiftLite</span></div>
        <span className="nph-course-intro-eyebrow">WELCOME TO YOUR GUIDED GAME</span>
        <h2 id={`${id}-heading`} ref={heading} tabIndex={-1}>Ready to play your first game?</h2>
        <p>You’ve got Ahri and I’ll take you through the game against Orianna. We’re trying to get to eight points by conquering and holding battlefields, so let’s start with an empty table and put the pieces down together.</p>
      </header>

      <ol className="nph-course-intro-route" aria-label="Your course in three stages">
        <li><span className="nph-course-intro-stage"><Layers3 aria-hidden="true" /><span>01</span></span><h3>Build your board</h3><p>Find your base first, then we’ll lay out the legend, chosen champion, battlefield and both decks.</p><ArrowRight className="nph-course-intro-route-arrow" aria-hidden="true" /></li>
        <li><span className="nph-course-intro-stage"><Hand aria-hidden="true" /><span>02</span></span><h3>Choose your opening hand</h3><p>Look through your opening four and decide what you can play early, then we’ll try swapping a card before turn one.</p><ArrowRight className="nph-course-intro-route-arrow" aria-hidden="true" /></li>
        <li><span className="nph-course-intro-stage"><BookOpen aria-hidden="true" /><span>03</span></span><h3>Play and practise</h3><p>Play through to the winning point, then try a different decision or a keyword you’ve been wondering about.</p></li>
      </ol>

      <details className="nph-course-intro-preview">
        <summary>Preview the board setup</summary>
        <LessonIllustration lessonId={tutorial.lessonId} board={tutorial.board} />
      </details>

      <div className="nph-course-intro-guidance">
        <section className="nph-course-intro-guide" aria-labelledby={`${id}-guide`}>
          <div className="nph-course-intro-guide-label"><Sparkles size={17} aria-hidden="true" /><h3 id={`${id}-guide`}>Guide’s move</h3><span>PURPLE GUIDE BOX</span></div>
          <p>When it’s Orianna’s move, the purple box will tell you what the guide is about to do. When it’s your move, the board waits for you.</p>
          <p>If you’ve played online, a simulator may have started your turns for you. Here you’ll ready your cards, check Beginning, channel runes and draw yourself, so you’ll know the order when you sit down at a table. When the game rules do something automatically, we’ll flag that separately.</p>
          <p className="nph-course-intro-guide-time">On Automatic you’ve got 6 seconds to read before each guide move, or you can pick a different pace below.</p>
          <dl className="nph-course-intro-controls">
            <div><dt><ArrowRight size={15} aria-hidden="true" />Next move</dt><dd>Advance without waiting</dd></div>
            <div><dt><Pause size={15} aria-hidden="true" />Pause</dt><dd>Stop automatic moves</dd></div>
            <div><dt><RotateCcw size={15} aria-hidden="true" />Back</dt><dd>Rewind one step</dd></div>
          </dl>
        </section>

        <section className="nph-course-intro-pace" aria-labelledby={`${id}-pace-heading`}>
          <h3 id={`${id}-pace-heading`}>Choose your pace</h3>
          <label htmlFor={`${id}-pace`}>Guide reading pace</label>
          <select id={`${id}-pace`} value={narrationMode} aria-describedby={`${id}-pace-detail${paceWarning ? ` ${id}-pace-warning` : ""}`} onChange={event => {
            const mode = event.currentTarget.value;
            if (mode === "automatic" || mode === "reading" || mode === "manual") onNarrationMode(mode);
          }}>
            <option value="automatic">Automatic · 6 seconds</option>
            <option value="reading">More reading time</option>
            <option value="manual">I’ll advance each move</option>
          </select>
          <p id={`${id}-pace-detail`} className="nph-course-intro-pace-detail" aria-live="polite">{PACE_DETAILS[narrationMode]}</p>
          <small>{paceWarning ? "Your choice is kept for this session." : "Your choice is saved on this device."} You can change it during a lesson.</small>
          {paceWarning ? <p id={`${id}-pace-warning`} className="nph-course-intro-warning" role="status">{paceWarning}</p> : null}
        </section>
      </div>

      <footer className="nph-course-intro-actions">
        <button type="button" className="nph-course-intro-back" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />Back to lessons</button>
        <button type="button" className="nph-course-intro-start" onClick={onStart}>Build the board<ArrowRight size={18} aria-hidden="true" /></button>
      </footer>
    </div>
  </section>;
}
