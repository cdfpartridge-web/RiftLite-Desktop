import React from "react";
import { Clock3, Hand, Layers3, Play, RotateCcw, Target } from "lucide-react";

export function OpeningLabComingSoon() {
  return (
    <section className="dashboard-page insights-coming-soon-page" aria-labelledby="opening-lab-coming-soon-title">
      <div className="insights-coming-soon-stage">
        <div className="insights-coming-soon-art" aria-hidden="true">
          <span className="insights-orbit insights-orbit-one" />
          <span className="insights-orbit insights-orbit-two" />
          <span className="insights-orbit-node insights-orbit-node-one"><Hand size={19} /></span>
          <span className="insights-orbit-node insights-orbit-node-two"><Target size={19} /></span>
          <span className="insights-orbit-node insights-orbit-node-three"><RotateCcw size={18} /></span>
          <span className="insights-coming-soon-core"><Play size={54} /></span>
        </div>
        <div className="insights-coming-soon-copy">
          <span className="insights-coming-soon-kicker"><Clock3 size={15} aria-hidden="true" /> Coming soon</span>
          <h2 id="opening-lab-coming-soon-title">Opening Turns Lab</h2>
          <p>
            Practise the first five turns on an interactive game board, then compare your decisions with a real game.
            We&apos;re getting the practice board ready.
          </p>
          <div className="insights-coming-soon-preview" aria-label="Planned Opening Turns Lab features">
            <article><Layers3 size={18} aria-hidden="true" /><span><strong>Choose your legend</strong><small>Explore openings from anonymous recorded games.</small></span></article>
            <article><Hand size={18} aria-hidden="true" /><span><strong>Try your line</strong><small>Drag cards onto the board and work through your choices.</small></span></article>
            <article><Target size={18} aria-hidden="true" /><span><strong>Compare decisions</strong><small>Reveal the recorded play when you are ready.</small></span></article>
          </div>
          <div className="insights-coming-soon-note">
            <RotateCcw size={17} aria-hidden="true" />
            <span><strong>Keep practising in Mulligan Lab.</strong> Deal fresh opening hands from your saved deck while Opening Turns Lab is in development.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
