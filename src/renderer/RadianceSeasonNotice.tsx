import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { RADIANCE_PRESEASON_START_AT, STAT_SEASONS, type StatSeasonId } from "../shared/statSeasons";
import "./styles/radiance-season-notice.css";

const DISMISSED_KEY = "riftlite:radiance-preseason-notice-dismissed";

export function RadianceSeasonNotice() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISSED_KEY) === RADIANCE_PRESEASON_START_AT;
    } catch {
      return false;
    }
  });
  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, RADIANCE_PRESEASON_START_AT);
    } catch {
      // Keep the notice dismissed for this view if storage is unavailable.
    }
  }

  return (
    <aside className="radiance-season-notice" aria-label="Radiance pre-season announcement">
      <Sparkles size={20} aria-hidden="true" />
      <div>
        <strong>Radiance pre-season stats have started</strong>
        <p>Matches played from <time dateTime={RADIANCE_PRESEASON_START_AT} title="10 October 2026 at 17:35:38 UK time">10 October, 17:35 UK time</time> count toward the new period. Use the Season filter to see your older matches and stats. Nothing has been reset.</p>
      </div>
      <button type="button" className="secondary radiance-season-dismiss" onClick={dismiss} aria-label="Dismiss Radiance pre-season announcement"><X size={16} /></button>
    </aside>
  );
}

export function StatSeasonFilter({ value, onChange }: { value: StatSeasonId; onChange: (value: StatSeasonId) => void }) {
  return (
    <label className="stat-season-filter">Season
      <select value={value} onChange={(event) => onChange(event.target.value as StatSeasonId)}>
        {STAT_SEASONS.map((season) => <option key={season.id || "all"} value={season.id}>{season.label}</option>)}
      </select>
    </label>
  );
}
