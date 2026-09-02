import React from "react";
import {
  BarChart3,
  BrainCircuit,
  Clock3,
  Layers3,
  Share2,
  Sparkles,
  Target
} from "lucide-react";

export function InsightsComingSoon() {
  return (
    <section className="dashboard-page insights-coming-soon-page" aria-labelledby="insights-coming-soon-title">
      <div className="insights-coming-soon-stage">
        <div className="insights-coming-soon-art" aria-hidden="true">
          <span className="insights-orbit insights-orbit-one" />
          <span className="insights-orbit insights-orbit-two" />
          <span className="insights-orbit-node insights-orbit-node-one"><BarChart3 size={19} /></span>
          <span className="insights-orbit-node insights-orbit-node-two"><Target size={19} /></span>
          <span className="insights-orbit-node insights-orbit-node-three"><Share2 size={18} /></span>
          <span className="insights-coming-soon-core"><BrainCircuit size={54} /></span>
        </div>

        <div className="insights-coming-soon-copy">
          <span className="insights-coming-soon-kicker"><Clock3 size={15} aria-hidden="true" /> Coming soon</span>
          <h2 id="insights-coming-soon-title">Replay Coach is being refined</h2>
          <p>
            We&apos;re taking Replay Coach back behind the curtain while we make every recommendation more specific,
            trustworthy and genuinely useful. Deck Insights remains available while this work continues.
          </p>

          <div className="insights-coming-soon-preview" aria-label="Planned Replay Coach improvements">
            <article><BarChart3 size={18} aria-hidden="true" /><span><strong>Evidence you can trust</strong><small>See the exact replay moment behind each observation.</small></span></article>
            <article><Target size={18} aria-hidden="true" /><span><strong>Practical next steps</strong><small>Leave with one concrete decision to test next game.</small></span></article>
            <article><Sparkles size={18} aria-hidden="true" /><span><strong>Meaningful progress</strong><small>See whether changes improve your decisions over time.</small></span></article>
          </div>

          <div className="insights-coming-soon-note">
            <Layers3 size={17} aria-hidden="true" />
            <span><strong>Deck Insights stays available.</strong> Matches and replays continue recording normally, and hiding Replay Coach does not delete your existing local evidence.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
