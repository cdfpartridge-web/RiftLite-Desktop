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
          <h2 id="insights-coming-soon-title">A smarter way to learn from every match</h2>
          <p>
            Insights is being rebuilt into a clearer, more visual coaching experience. It will return when every
            recommendation feels useful, trustworthy and easy to act on.
          </p>

          <div className="insights-coming-soon-preview" aria-label="Planned Insights features">
            <article><BarChart3 size={18} aria-hidden="true" /><span><strong>Visual patterns</strong><small>See the decisions shaping your games.</small></span></article>
            <article><Target size={18} aria-hidden="true" /><span><strong>Focused coaching</strong><small>Leave with one practical rule for your next match.</small></span></article>
            <article><Sparkles size={18} aria-hidden="true" /><span><strong>Shareable progress</strong><small>Turn improvement into clean, visual summaries.</small></span></article>
          </div>

          <div className="insights-coming-soon-note">
            <Layers3 size={17} aria-hidden="true" />
            <span><strong>Your capture data is safe.</strong> Matches and replays continue recording normally while Insights is unavailable.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
