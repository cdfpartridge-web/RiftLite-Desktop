import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RadianceSeasonNotice, StatSeasonFilter } from "../src/renderer/RadianceSeasonNotice";
import { CURRENT_STAT_SEASON, RADIANCE_START_AT, RADIANCE_PRESEASON_START_AT } from "../src/shared/statSeasons";

afterEach(() => vi.unstubAllGlobals());

describe("Radiance season announcement", () => {
  it("explains the start, preserved history and archive filter without claiming data was reset", () => {
    const html = renderToStaticMarkup(<RadianceSeasonNotice />);
    expect(html).toContain("Radiance season is live");
    expect(html).toContain(`dateTime="${RADIANCE_START_AT}"`);
    expect(html).toContain("13:11:27 UK time");
    expect(html).toContain("Radiance pre-season and older results");
    expect(html).toContain("Season filter");
    expect(html).toContain("Nothing has been reset");
    expect(html).toContain('aria-label="Dismiss Radiance season announcement"');
  });

  it("respects dismissal for this launch and still shows when storage is unavailable", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => RADIANCE_START_AT } });
    expect(renderToStaticMarkup(<RadianceSeasonNotice />)).toBe("");
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("unavailable"); } } });
    expect(renderToStaticMarkup(<RadianceSeasonNotice />)).toContain("Radiance season is live");
  });

  it("shows the new reminder even if the pre-season reminder was dismissed", () => {
    const getItem = vi.fn((key: string) => key === "riftlite:radiance-preseason-notice-dismissed" ? RADIANCE_PRESEASON_START_AT : null);
    vi.stubGlobal("window", { localStorage: { getItem } });
    expect(renderToStaticMarkup(<RadianceSeasonNotice />)).toContain("Radiance season is live");
    expect(getItem).toHaveBeenCalledWith("riftlite:radiance-season-notice-dismissed");
  });

  it("keeps archived and all-season options available with an empty new cohort", () => {
    const html = renderToStaticMarkup(<StatSeasonFilter value={CURRENT_STAT_SEASON} onChange={() => undefined} />);
    expect(html).toContain('<option value="radiance" selected="">Radiance</option>');
    expect(html).toContain('<option value="radiance-preseason">Radiance pre-season</option>');
    expect(html).toContain('value="vendetta-launch"');
    expect(html).toContain('value="vendetta-preview"');
    expect(html).toContain('value="pre-vendetta"');
    expect(html).toContain('value=""');
  });
});
