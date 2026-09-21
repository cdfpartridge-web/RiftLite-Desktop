import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtlasGameLogContent } from "../src/renderer/AtlasGameLogDialog";
import type { AtlasGameLog } from "../src/shared/atlasGameLog";

const empty: AtlasGameLog = { source: "none", partial: false, games: [] };

describe("Atlas game log reader", () => {
  it("distinguishes loading, missing capture and failed reads", () => {
    expect(renderToStaticMarkup(<AtlasGameLogContent log={empty} loading />)).toContain("Loading captured game log");
    expect(renderToStaticMarkup(<AtlasGameLogContent log={empty} />)).toContain("No game log was saved");
    expect(renderToStaticMarkup(<AtlasGameLogContent log={empty} failed />)).toContain('role="alert"');
  });

  it("renders source text safely and identifies partial evidence", () => {
    const log: AtlasGameLog = { source: "captured", partial: true, games: [{ id: "g1", gameNumber: 1, entries: [
      { id: "one", time: "13:36", text: 'Moved <img src=x onerror="alert(1)"> to trash.' }
    ] }] };
    const markup = renderToStaticMarkup(<AtlasGameLogContent log={log} />);
    expect(markup).toContain("Only retained entries");
    expect(markup).toContain("&lt;img");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("Copy log");
  });

  it("paginates large captures without truncating the available total", () => {
    const log: AtlasGameLog = { source: "raw", partial: false, games: [{ id: "g1", gameNumber: 1, entries:
      Array.from({ length: 451 }, (_, index) => ({ id: String(index), time: "13:36", text: `Original action ${index}` }))
    }] };
    const markup = renderToStaticMarkup(<AtlasGameLogContent log={log} />);
    expect(markup).toContain("451 entries");
    expect(markup).toContain("Original action 199");
    expect(markup).not.toContain("Original action 200");
    expect(markup).toContain('aria-label="Game log pages"');
  });
});
