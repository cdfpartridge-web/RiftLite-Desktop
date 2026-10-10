import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AtlasGameLogContent, copyAtlasGameLog } from "../src/renderer/AtlasGameLogDialog";
import type { AtlasGameLog } from "../src/shared/atlasGameLog";

const empty: AtlasGameLog = { source: "none", partial: false, games: [] };

describe("Atlas game log reader", () => {
  const copyLog: AtlasGameLog = { source: "raw", partial: false, games: [
    { id: "one", gameNumber: 1, entries: [{ id: "a", time: "13:36", text: "Played Qiyana." }, { id: "b", time: "13:37", text: "Paid 1 Energy." }] },
    { id: "two", gameNumber: 2, entries: [{ id: "a", time: "13:38", text: "Played Qiyana again." }] },
  ] };

  it("copies the complete log through the desktop bridge without browser clipboard permission", async () => {
    const bridge = { writeClipboardText: vi.fn(async () => true) };
    expect(await copyAtlasGameLog(copyLog, bridge)).toBe(true);
    expect(bridge.writeClipboardText).toHaveBeenCalledWith("Game 1\n13:36 Played Qiyana.\n13:37 Paid 1 Energy.\n\nGame 2\n13:38 Played Qiyana again.");
  });

  it("copies only the selected game's search results", async () => {
    const bridge = { writeClipboardText: vi.fn(async () => true) };
    expect(await copyAtlasGameLog(copyLog, bridge, "one", "qiyana")).toBe(true);
    expect(bridge.writeClipboardText).toHaveBeenCalledWith("Game 1\n13:36 Played Qiyana.");
  });

  it("does not report success for a refused or failed clipboard write", async () => {
    expect(await copyAtlasGameLog(copyLog, { writeClipboardText: async () => false })).toBe(false);
    expect(await copyAtlasGameLog(copyLog, { writeClipboardText: async () => { throw new Error("IPC failed"); } })).toBe(false);
  });

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
