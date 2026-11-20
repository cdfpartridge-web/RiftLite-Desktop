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
  automatic: "Each short explanation and result stays for 6 seconds. Use Next to move on sooner. Your own actions wait for you.",
  reading: "Each explanation and result stays for at least 10 seconds, with more time when there is more to read.",
  manual: "Read each explanation, choose Next move to watch the action, then read what changed. Everything waits for you."
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
        <h2 id={`${id}-heading`} ref={heading} tabIndex={-1}>Let’s build your first game.</h2>
        <p>You’ll play Ahri against the guide’s Orianna. Your aim is to reach eight points by conquering and holding battlefields. Start with an empty table so you can learn where each piece goes and what it does.</p>
      </header>

      <ol className="nph-course-intro-route" aria-label="Your course in three stages">
        <li><span className="nph-course-intro-stage"><Layers3 aria-hidden="true" /><span>01</span></span><h3>Build your board</h3><p>Find your base, then place your legend, chosen champion, battlefield and two decks.</p><ArrowRight className="nph-course-intro-route-arrow" aria-hidden="true" /></li>
        <li><span className="nph-course-intro-stage"><Hand aria-hidden="true" /><span>02</span></span><h3>Choose your opening hand</h3><p>Learn what a mulligan means, why you might replace a card, and how to get ready for your first turn.</p><ArrowRight className="nph-course-intro-route-arrow" aria-hidden="true" /></li>
        <li><span className="nph-course-intro-stage"><BookOpen aria-hidden="true" /><span>03</span></span><h3>Play and practise</h3><p>Work towards your first win, then try new decisions and explore the keywords.</p></li>
      </ol>

      <details className="nph-course-intro-preview">
        <summary>Preview the board setup</summary>
        <LessonIllustration lessonId={tutorial.lessonId} board={tutorial.board} />
      </details>

      <div className="nph-course-intro-guidance">
        <section className="nph-course-intro-guide" aria-labelledby={`${id}-guide`}>
          <div className="nph-course-intro-guide-label"><Sparkles size={17} aria-hidden="true" /><h3 id={`${id}-guide`}>Guide’s move</h3><span>PURPLE GUIDE BOX</span></div>
          <p>The guide plays the opponent’s actions. The purple box explains what it is about to do. Your own actions wait for you.</p>
          <p>Online simulators often handle turn-start steps automatically. Here, you ready your cards, check Beginning, channel runes and draw so you learn the sequence. Automatic game effects are explained separately as game rules.</p>
          <p className="nph-course-intro-guide-time">Automatic gives you 6 seconds to read before each guide move. You can choose a different pace here.</p>
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
