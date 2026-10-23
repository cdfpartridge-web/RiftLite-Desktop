import { describe, expect, it } from "vitest";
import {
  CURRENT_STAT_SEASON, STAT_SEASONS, RADIANCE_START_AT, RADIANCE_START_MS, RADIANCE_PRESEASON_START_AT,
  RADIANCE_PRESEASON_START_MS, VENDETTA_LAUNCH_START_MS, VENDETTA_PREVIEW_START_MS,
  isInStatSeason, statMatchTimestamp, statSeasonForTimestamp,
} from "../src/shared/statSeasons";

describe("Radiance season statistics", () => {
  it("defaults to the official season from its fixed approved instant and preserves pre-season", () => {
    expect(CURRENT_STAT_SEASON).toBe("radiance");
    expect(STAT_SEASONS.map(s => s.id)).toEqual(["radiance", "radiance-preseason", "vendetta-launch", "vendetta-preview", "pre-vendetta", ""]);
    expect(RADIANCE_START_AT).toBe("2026-10-23T12:11:27.000Z");
    expect(statSeasonForTimestamp(RADIANCE_START_MS - 1)).toBe("radiance-preseason");
    expect(statSeasonForTimestamp(RADIANCE_START_MS)).toBe("radiance");
    expect(statSeasonForTimestamp("2026-10-23T13:11:27+01:00")).toBe("radiance");
    expect(statSeasonForTimestamp(RADIANCE_START_MS / 1000)).toBe("radiance");
    expect(statSeasonForTimestamp(String(RADIANCE_START_MS / 1000))).toBe("radiance");
    expect(isInStatSeason(RADIANCE_START_AT, "radiance-preseason")).toBe(false);
    expect(isInStatSeason(RADIANCE_PRESEASON_START_AT, "radiance")).toBe(false);
  });

  it("retains the exact pre-season boundary without overlapping Vendetta", () => {
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

  it("does not reclassify pre-season games uploaded after the official launch", () => {
    const createdAt = RADIANCE_START_MS + 3600000;
    expect(statSeasonForTimestamp(statMatchTimestamp({ capturedAt: RADIANCE_PRESEASON_START_AT, createdAt }))).toBe("radiance-preseason");
    expect(statSeasonForTimestamp(statMatchTimestamp({ date: "2026-10-23", createdAt }))).toBe("radiance-preseason");
    expect(statSeasonForTimestamp(statMatchTimestamp({ date: "", createdAt }))).toBe("radiance");
    expect(statSeasonForTimestamp(statMatchTimestamp({ capturedAt: "invalid", createdAt }))).toBeNull();
  });
});
