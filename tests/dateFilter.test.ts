import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DATE_FILTER,
  dateFilterLabel,
  dateFilterValidation,
  isInDateFilter,
  localDateInputValue,
  type DateFilterValue,
} from "../src/shared/dateFilter";

const single = (from: string): DateFilterValue => ({ preset: "date", from, to: "" });
const range = (from: string, to: string): DateFilterValue => ({ preset: "custom", from, to });

describe("calendar date filters", () => {
  it("includes both local date boundaries and excludes surrounding dates", () => {
    const filter = range("2026-09-11", "2026-09-18");
    expect(isInDateFilter(new Date(2026, 8, 11), filter)).toBe(true);
    expect(isInDateFilter(new Date(2026, 8, 18, 23, 59, 59, 999), filter)).toBe(true);
    expect(isInDateFilter(new Date(2026, 8, 10, 23, 59, 59, 999), filter)).toBe(false);
    expect(isInDateFilter(new Date(2026, 8, 19), filter)).toBe(false);
  });

  it("selects a single date and treats date-only records as local calendar dates", () => {
    const filter = single("2026-09-18");
    expect(isInDateFilter("2026-09-18", filter)).toBe(true);
    expect(isInDateFilter(new Date(2026, 8, 18, 22).toISOString(), filter)).toBe(true);
    expect(isInDateFilter(new Date(2026, 8, 18).getTime(), filter)).toBe(true);
    expect(isInDateFilter("2026-09-17", filter)).toBe(false);
    expect(isInDateFilter("2026-09-19", filter)).toBe(false);
    expect(isInDateFilter(0, single(localDateInputValue(new Date(0))))).toBe(true);
  });

  it("preserves undated data only when no date filter is active", () => {
    for (const timestamp of [undefined, "", " ", "not a date", new Date(NaN), Number.NaN]) {
      expect(isInDateFilter(timestamp, DEFAULT_DATE_FILTER)).toBe(true);
      expect(isInDateFilter(timestamp, single("2026-09-18"))).toBe(false);
    }
  });

  it.each(["today", "7d", "30d", "90d", "180d"] as const)("%s counts calendar days including today", (preset) => {
    const days = { today: 1, "7d": 7, "30d": 30, "90d": 90, "180d": 180 }[preset];
    const now = new Date(2026, 8, 18, 14, 30);
    const first = new Date(2026, 8, 18 - days + 1);
    const filter = { ...DEFAULT_DATE_FILTER, preset };
    expect(isInDateFilter(first, filter, now)).toBe(true);
    expect(isInDateFilter(new Date(first.getTime() - 1), filter, now)).toBe(false);
    expect(isInDateFilter(new Date(2026, 8, 18, 23, 59, 59, 999), filter, now)).toBe(true);
    expect(isInDateFilter(new Date(2026, 8, 19), filter, now)).toBe(false);
    expect(now.getHours()).toBe(14);
  });

  it.each([
    single(""),
    single("2026-02-29"),
    single("2026-02-30"),
    single("2026-13-01"),
    single("2026-00-18"),
    single("2026-09-00"),
    single("2026-9-18"),
    range("2026-09-18", ""),
    range("", "2026-09-18"),
    range("2026-09-19", "2026-09-18"),
  ])("returns no results and an explanation for incomplete or invalid date selections: %j", (filter) => {
    expect(dateFilterValidation(filter)).toBeTruthy();
    expect(isInDateFilter("2026-09-18", filter)).toBe(false);
    expect(dateFilterLabel(filter)).toBe("Choose dates");
  });

  it("accepts leap days and allows a one-day custom range", () => {
    expect(dateFilterValidation(single("2028-02-29"))).toBeNull();
    expect(isInDateFilter("2028-02-29", single("2028-02-29"))).toBe(true);
    expect(isInDateFilter("2026-09-18", range("2026-09-18", "2026-09-18"))).toBe(true);
    expect(dateFilterLabel(range("2026-09-18", "2026-09-18"))).toBe(dateFilterLabel(single("2026-09-18")));
    expect(dateFilterLabel(DEFAULT_DATE_FILTER)).toBe("All time");
  });
});

describe("local timezone and daylight saving boundaries", () => {
  const compiled = transformSync(readFileSync(new URL("../src/shared/dateFilter.ts", import.meta.url), "utf8"), {
    loader: "ts", format: "cjs", target: "node22",
  }).code;

  // Start fresh processes because changing TZ within a Vitest worker is platform dependent.
  it.each([
    ["Europe/London", "2026-03-29", 23],
    ["Europe/London", "2026-10-25", 25],
    ["America/New_York", "2026-03-08", 23],
    ["America/New_York", "2026-11-01", 25],
    ["Pacific/Auckland", "2026-09-27", 23],
  ])("keeps the complete %s day %s across its %i-hour DST change", (timezone, day, expectedHours) => {
    const result = execFileSync(process.execPath, ["-e", `${compiled}
      const api = module.exports;
      const [y, m, d] = ${JSON.stringify(day)}.split('-').map(Number);
      const start = new Date(y, m - 1, d);
      const end = new Date(y, m - 1, d + 1);
      const filter = { preset: 'date', from: ${JSON.stringify(day)}, to: '' };
      const firstOfWeek = new Date(y, m - 1, d - 6);
      process.stdout.write(JSON.stringify({
        hours: (end - start) / 3600000,
        start: api.isInDateFilter(start.toISOString(), filter),
        last: api.isInDateFilter(end.getTime() - 1, filter),
        after: api.isInDateFilter(end.toISOString(), filter),
        before: api.isInDateFilter(start.getTime() - 1, filter),
        dateOnly: api.isInDateFilter(${JSON.stringify(day)}, filter),
        input: api.localDateInputValue(start),
        weekStart: api.isInDateFilter(firstOfWeek, { ...filter, preset: '7d' }, start),
        beforeWeek: api.isInDateFilter(firstOfWeek.getTime() - 1, { ...filter, preset: '7d' }, start)
      }));
    `], { env: { ...process.env, TZ: timezone }, windowsHide: true, encoding: "utf8" });
    expect(JSON.parse(result)).toEqual({
      hours: expectedHours, start: true, last: true, after: false, before: false,
      dateOnly: true, input: day, weekStart: true, beforeWeek: false,
    });
  });
});
