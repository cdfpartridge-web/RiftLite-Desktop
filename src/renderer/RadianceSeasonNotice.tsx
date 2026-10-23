import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { RADIANCE_START_AT, STAT_SEASONS, type StatSeasonId } from "../shared/statSeasons";
import "./styles/radiance-season-notice.css";

const DISMISSED_KEY = "riftlite:radiance-season-notice-dismissed";

export function RadianceSeasonNotice() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISSED_KEY) === RADIANCE_START_AT;
    } catch {
      return false;
    }
  });
  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, RADIANCE_START_AT);
    } catch {
      // Keep the notice dismissed for this view if storage is unavailable.
    }
  }

  return (
    <aside className="radiance-season-notice" aria-label="Radiance season announcement">
      <Sparkles size={20} aria-hidden="true" />
      <div>
        <strong>Radiance season is live</strong>
        <p>Radiance is now the default for matches and stats, starting <time dateTime={RADIANCE_START_AT} title="23 October 2026 at 13:11:27 UK time">23 October, 13:11 UK time</time>. Use the Season filter to see Radiance pre-season and older results. Nothing has been reset.</p>
      </div>
      <button type="button" className="secondary radiance-season-dismiss" onClick={dismiss} aria-label="Dismiss Radiance season announcement"><X size={16} /></button>
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
