export type DateFilterPreset = "all" | "today" | "7d" | "30d" | "90d" | "180d" | "date" | "custom";

export type DateFilterValue = {
  preset: DateFilterPreset;
  from: string;
  to: string;
};

export const DEFAULT_DATE_FILTER: DateFilterValue = { preset: "all", from: "", to: "" };

export const DATE_FILTER_LABELS: Record<DateFilterPreset, string> = {
  all: "All time",
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "180d": "Last 180 days",
  date: "On a date",
  custom: "Date range",
};

/** Date inputs and date-only records represent local calendar days, never UTC. */
function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  const day = Number(dayText);
  if (year < 1) return null;
  const date = new Date(0);
  date.setFullYear(year, month, day);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

export function localDateInputValue(date = new Date()): string {
  if (!Number.isFinite(date.getTime())) return "";
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateFilterValidation(filter: DateFilterValue): string | null {
  if (filter.preset === "date") {
    return parseCalendarDate(filter.from) ? null : "Choose a valid date.";
  }
  if (filter.preset === "custom") {
    const from = parseCalendarDate(filter.from);
    const to = parseCalendarDate(filter.to);
    if (!from || !to) return "Choose valid start and end dates.";
    if (from > to) return "The end date must be on or after the start date.";
  }
  return null;
}

function recordDate(timestamp: string | number | Date | undefined): Date | null {
  if (timestamp === undefined || (typeof timestamp === "string" && !timestamp.trim())) return null;
  if (typeof timestamp === "string" && /^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return parseCalendarDate(timestamp);
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Inclusive local dates, using the following midnight rather than fixed 24-hour days (DST). */
export function isInDateFilter(
  timestamp: string | number | Date | undefined,
  filter: DateFilterValue,
  now = new Date(),
): boolean {
  if (filter.preset === "all") return true;
  if (dateFilterValidation(filter)) return false;
  const date = recordDate(timestamp);
  if (!date) return false;

  let from: Date;
  let end: Date;
  if (filter.preset === "date" || filter.preset === "custom") {
    from = parseCalendarDate(filter.from)!;
    end = parseCalendarDate(filter.preset === "date" ? filter.from : filter.to)!;
  } else {
    if (!Number.isFinite(now.getTime())) return false;
    const days = ({ today: 1, "7d": 7, "30d": 30, "90d": 90, "180d": 180 } as const)[filter.preset];
    if (!days) return false;
    from = new Date(now);
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - days + 1);
    end = new Date(now);
    end.setHours(0, 0, 0, 0);
  }
  end.setDate(end.getDate() + 1);
  return date >= from && date < end;
}

export function dateFilterLabel(filter: DateFilterValue): string {
  if (dateFilterValidation(filter)) return "Choose dates";
  const format = (date: string) => parseCalendarDate(date)!.toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });
  if (filter.preset === "date") return format(filter.from);
  if (filter.preset === "custom") return filter.from === filter.to ? format(filter.from) : `${format(filter.from)} – ${format(filter.to)}`;
  return DATE_FILTER_LABELS[filter.preset];
}
