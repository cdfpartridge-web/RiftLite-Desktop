/** Fixed product stats boundary approved on 10 October 2026, 17:35:38 UK time. */
export const RADIANCE_PRESEASON_START_AT = "2026-10-10T16:35:38.000Z";
export const RADIANCE_PRESEASON_START_MS = Date.parse(RADIANCE_PRESEASON_START_AT);
export const VENDETTA_PREVIEW_START_MS = Date.UTC(2026, 6, 6);
export const VENDETTA_LAUNCH_START_MS = Date.UTC(2026, 6, 31);
export const STAT_SEASONS = [
  { id: "radiance-preseason", label: "Radiance pre-season" },
  { id: "vendetta-launch", label: "Vendetta season" },
  { id: "vendetta-preview", label: "Vendetta Preview season" },
  { id: "pre-vendetta", label: "Pre-Vendetta archive" },
  { id: "", label: "All tracked seasons" },
] as const;
export type StatSeasonId = (typeof STAT_SEASONS)[number]["id"];
export const CURRENT_STAT_SEASON: StatSeasonId = "radiance-preseason";

type StatTimestamp = string | number | null | undefined;

export function statTimestampMs(value: StatTimestamp): number | null {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const numeric = typeof value === "number" || /^\d+(?:\.\d+)?$/.test(value.trim());
  const parsed = numeric
    ? Number(value) * (Number(value) < 10_000_000_000 ? 1000 : 1)
    : Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) !== value) return null;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Upload time is a legacy fallback only when the recorded match time is absent. */
export function statMatchTimestamp(match: {
  capturedAt?: StatTimestamp;
  date?: StatTimestamp;
  createdAt?: StatTimestamp;
}): number | null {
  for (const value of [match.capturedAt, match.date, match.createdAt]) {
    if (value != null && String(value).trim()) return statTimestampMs(value);
  }
  return null;
}

export function statSeasonForTimestamp(value: StatTimestamp): Exclude<StatSeasonId, ""> | null {
  const timestamp = statTimestampMs(value);
  if (timestamp === null) return null;
  if (timestamp >= RADIANCE_PRESEASON_START_MS) return "radiance-preseason";
  if (timestamp >= VENDETTA_LAUNCH_START_MS) return "vendetta-launch";
  if (timestamp >= VENDETTA_PREVIEW_START_MS) return "vendetta-preview";
  return "pre-vendetta";
}

export function isInStatSeason(value: StatTimestamp, season: string): boolean {
  if (season === "") return true;
  return statSeasonForTimestamp(value) === season;
}
