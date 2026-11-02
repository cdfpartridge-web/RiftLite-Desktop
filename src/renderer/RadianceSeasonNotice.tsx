import { STAT_SEASONS, type StatSeasonId } from "../shared/statSeasons";
import "./styles/radiance-season-notice.css";

export function StatSeasonFilter({ value, onChange }: { value: StatSeasonId; onChange: (value: StatSeasonId) => void }) {
  return (
    <label className="stat-season-filter">Season
      <select value={value} onChange={(event) => onChange(event.target.value as StatSeasonId)}>
        {STAT_SEASONS.map((season) => <option key={season.id || "all"} value={season.id}>{season.label}</option>)}
      </select>
    </label>
  );
}
