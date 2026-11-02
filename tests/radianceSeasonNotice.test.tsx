import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatSeasonFilter } from "../src/renderer/RadianceSeasonNotice";
import { CURRENT_STAT_SEASON } from "../src/shared/statSeasons";

describe("Season filter", () => {
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
