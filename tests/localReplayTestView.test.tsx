import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocalReplayTestView, readLocalReplayTestCapability } from "../src/renderer/LocalReplayTestView";
import { RIFTLITE_LOCAL_REPLAY_TEST_PARTITION, RIFTLITE_LOCAL_REPLAY_TEST_URL } from "../src/shared/embeddedContentSecurity";

describe("isolated in-app local replay test", () => {
  it("requires an explicit true capability from the main bridge", async () => {
    const getLocalReplayTestCapability = vi.fn(async () => ({ enabled: true }));
    expect(await readLocalReplayTestCapability({ getLocalReplayTestCapability })).toBe(true);
    expect(getLocalReplayTestCapability).toHaveBeenCalledExactlyOnceWith();
    for (const value of [undefined, null, false, true, { enabled: false }, { enabled: "true" }, { url: "http://127.0.0.1:4227/" }]) {
      expect(await readLocalReplayTestCapability({ getLocalReplayTestCapability: async () => value })).toBe(false);
    }
  });

  it("keeps normal mode for an older bridge or failed capability request", async () => {
    expect(await readLocalReplayTestCapability({})).toBe(false);
    expect(await readLocalReplayTestCapability({ getLocalReplayTestCapability: async () => { throw new Error("No capability"); } })).toBe(false);
  });

  it("does not create a webview when runtime permission is absent", () => {
    const html = renderToStaticMarkup(<LocalReplayTestView enabled={false} />);
    expect(html).not.toContain("<webview");
    expect(html).toContain("Local replay testing is not enabled");
  });

  it("uses only the fixed loopback page and a nonpersistent partition", () => {
    const html = renderToStaticMarkup(<LocalReplayTestView enabled />);
    expect(RIFTLITE_LOCAL_REPLAY_TEST_URL).toBe("http://127.0.0.1:4227/");
    expect(RIFTLITE_LOCAL_REPLAY_TEST_PARTITION.startsWith("persist:")).toBe(false);
    expect(html).toContain(`src="${RIFTLITE_LOCAL_REPLAY_TEST_URL}"`);
    expect(html).toContain(`partition="${RIFTLITE_LOCAL_REPLAY_TEST_PARTITION}"`);
    expect(html).toContain("LOCAL TEST");
    expect(html).not.toMatch(/preload=|allowpopups|https:\/\/www\.riftlite\.com|persist:riftlite-replay/);
  });
});
