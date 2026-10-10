import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RadianceSeasonNotice, StatSeasonFilter } from "../src/renderer/RadianceSeasonNotice";
import { CURRENT_STAT_SEASON, RADIANCE_PRESEASON_START_AT } from "../src/shared/statSeasons";

afterEach(() => vi.unstubAllGlobals());

describe("Radiance season announcement", () => {
  it("explains the start, preserved history and archive filter without claiming data was reset", () => {
    const html = renderToStaticMarkup(<RadianceSeasonNotice />);
    expect(html).toContain("Radiance pre-season stats have started");
    expect(html).toContain(`dateTime="${RADIANCE_PRESEASON_START_AT}"`);
    expect(html).toContain("17:35:38 UK time");
    expect(html).toContain("Season filter");
    expect(html).toContain("Nothing has been reset");
    expect(html).toContain('aria-label="Dismiss Radiance pre-season announcement"');
  });

  it("respects dismissal for this launch and still shows when storage is unavailable", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => RADIANCE_PRESEASON_START_AT } });
    expect(renderToStaticMarkup(<RadianceSeasonNotice />)).toBe("");
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("unavailable"); } } });
    expect(renderToStaticMarkup(<RadianceSeasonNotice />)).toContain("Radiance pre-season stats have started");
  });

  it("keeps archived and all-season options available with an empty new cohort", () => {
    const html = renderToStaticMarkup(<StatSeasonFilter value={CURRENT_STAT_SEASON} onChange={() => undefined} />);
    expect(html).toContain('<option value="radiance-preseason" selected="">Radiance pre-season</option>');
    expect(html).toContain('value="vendetta-launch"');
    expect(html).toContain('value="vendetta-preview"');
    expect(html).toContain('value="pre-vendetta"');
    expect(html).toContain('value=""');
  });
});
