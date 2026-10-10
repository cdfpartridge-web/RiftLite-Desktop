import { describe, expect, it } from "vitest";
import {
  CURRENT_STAT_SEASON, STAT_SEASONS, RADIANCE_PRESEASON_START_AT,
  RADIANCE_PRESEASON_START_MS, VENDETTA_LAUNCH_START_MS, VENDETTA_PREVIEW_START_MS,
  isInStatSeason, statMatchTimestamp, statSeasonForTimestamp,
} from "../src/shared/statSeasons";

describe("Radiance pre-season statistics", () => {
  it("starts at the exact approved instant without overlapping Vendetta", () => {
    expect(CURRENT_STAT_SEASON).toBe("radiance-preseason");
    expect(STAT_SEASONS.map(s => s.id)).toEqual(["radiance-preseason", "vendetta-launch", "vendetta-preview", "pre-vendetta", ""]);
    expect(statSeasonForTimestamp(RADIANCE_PRESEASON_START_MS - 1)).toBe("vendetta-launch");
    expect(statSeasonForTimestamp(RADIANCE_PRESEASON_START_MS)).toBe("radiance-preseason");
    expect(isInStatSeason(RADIANCE_PRESEASON_START_AT, "vendetta-launch")).toBe(false);
    expect(statSeasonForTimestamp("2026-10-10T17:35:38+01:00")).toBe("radiance-preseason");
    expect(statSeasonForTimestamp(RADIANCE_PRESEASON_START_MS / 1000)).toBe("radiance-preseason");
    expect(statSeasonForTimestamp(String(RADIANCE_PRESEASON_START_MS / 1000))).toBe("radiance-preseason");
  });

  it("retains older eras and all history including undated records", () => {
    expect(statSeasonForTimestamp(VENDETTA_PREVIEW_START_MS - 1)).toBe("pre-vendetta");
    expect(statSeasonForTimestamp(VENDETTA_PREVIEW_START_MS)).toBe("vendetta-preview");
    expect(statSeasonForTimestamp(VENDETTA_LAUNCH_START_MS - 1)).toBe("vendetta-preview");
    expect(statSeasonForTimestamp(VENDETTA_LAUNCH_START_MS)).toBe("vendetta-launch");
    expect(isInStatSeason(undefined, "")).toBe(true);
    for (const value of [undefined, "", "invalid", 0, -1, NaN]) {
      expect(statSeasonForTimestamp(value)).toBeNull();
      expect(isInStatSeason(value, CURRENT_STAT_SEASON)).toBe(false);
    }
    expect(isInStatSeason(RADIANCE_PRESEASON_START_AT, "misspelled")).toBe(false);
  });

  it("uses played time rather than late upload time and treats date-only rows conservatively", () => {
    const createdAt = RADIANCE_PRESEASON_START_MS + 3600000;
    expect(statSeasonForTimestamp(statMatchTimestamp({ date: "2026-10-09T21:00:00Z", createdAt }))).toBe("vendetta-launch");
    expect(statSeasonForTimestamp(statMatchTimestamp({ date: "2026-10-10", createdAt }))).toBe("vendetta-launch");
    expect(statMatchTimestamp({ date: "invalid", createdAt })).toBeNull();
    expect(statMatchTimestamp({ date: "2026-02-30", createdAt })).toBeNull();
    expect(statMatchTimestamp({ capturedAt: "invalid", date: RADIANCE_PRESEASON_START_AT, createdAt })).toBeNull();
    expect(statMatchTimestamp({ date: "", createdAt })).toBe(createdAt);
    expect(statMatchTimestamp({ capturedAt: RADIANCE_PRESEASON_START_AT, date: "2026-10-09", createdAt })).toBe(RADIANCE_PRESEASON_START_MS);
  });
});
