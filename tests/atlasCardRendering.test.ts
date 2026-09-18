import { afterEach, describe, expect, it, vi } from "vitest";
import { atlasCardRenderingCssForUrl } from "../src/shared/atlasCardRendering.js";
import { AtlasCompatibilityStyleInstaller } from "../src/main/services/atlasCompatibilityStyleInstaller.js";

function styleFixture() {
  const state = { destroyed: false, url: "https://play.riftatlas.com/" };
  const insertCss = vi.fn(async (_css: string) => "style-key");
  const removeCss = vi.fn(async (_key: string) => undefined);
  const reportFailure = vi.fn();
  const installer = new AtlasCompatibilityStyleInstaller({
    isDestroyed: () => state.destroyed,
    cssForCurrentUrl: () => atlasCardRenderingCssForUrl(state.url),
    insertCss, removeCss, reportFailure
  });
  return { state, insertCss, removeCss, reportFailure, installer };
}

afterEach(() => { vi.useRealTimers(); });

describe("Atlas card rendering", () => {
  it("preserves Atlas's native artwork sampling, card poses, and responsive sizing", () => {
    const css = atlasCardRenderingCssForUrl("https://play.riftatlas.com/game/example");

    expect(css).not.toContain("image-rendering");
    expect(css).not.toContain("[data-card-id]");
    expect(css).not.toContain(".gb-card-face");
    expect(css).not.toMatch(/(?:transform|transform-style|scale|rotate|translate|zoom|filter)\s*:/);
  });

  it("moves Atlas's named lobby query container above the flex column", () => {
    const css = atlasCardRenderingCssForUrl("https://play.riftatlas.com/");

    expect(css).toContain(".hub-theme > .contents:has(.lobby-content-column)");
    expect(css).toContain("display: block !important");
    expect(css).toContain("min-height: 100dvh !important");
    expect(css).toContain(".hub-theme .lobby-content-column");
    expect(css).toContain("container-type: normal !important");
    expect(css).toContain("container-name: none !important");
    expect(css).toContain(".hub-theme :has(> .lobby-content-column)");
    expect(css).toContain("container: lobby-content / inline-size !important");
  });

  it("does not inject the rule into other embedded sites", () => {
    expect(atlasCardRenderingCssForUrl("https://tcg-arena.fr/")).toBe("");
    expect(atlasCardRenderingCssForUrl("https://play.riftatlas.com.evil.example/")).toBe("");
    expect(atlasCardRenderingCssForUrl("not a url")).toBe("");
  });

  it("retries a rejected compatibility-style insertion without crossing navigations", () => {
    const fixture = styleFixture();
    fixture.installer.install();
    fixture.installer.install();
    expect(fixture.insertCss).toHaveBeenCalledTimes(1);
    fixture.installer.dispose();
  });

  it("retries rejected insertions twice, then keeps its budget exhausted until invalidation", async () => {
    vi.useFakeTimers();
    const fixture = styleFixture();
    fixture.insertCss.mockRejectedValue(new Error("insertion unavailable"));
    fixture.installer.install();
    await vi.runAllTimersAsync();
    fixture.installer.install();
    expect(fixture.insertCss).toHaveBeenCalledTimes(3);
    expect(fixture.reportFailure).toHaveBeenCalledTimes(3);
    fixture.installer.invalidate();
    fixture.insertCss.mockResolvedValue("next-document-style");
    fixture.installer.install();
    await vi.runAllTimersAsync();
    expect(fixture.insertCss).toHaveBeenCalledTimes(4);
    fixture.installer.dispose();
  });

  it("removes an insertion that finishes after navigation without unlocking the new document", async () => {
    const fixture = styleFixture();
    let resolveOld!: (key: string) => void;
    let resolveNew!: (key: string) => void;
    fixture.insertCss.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
    fixture.installer.install();
    fixture.installer.invalidate();
    fixture.installer.install();
    resolveOld("old-document-style");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.installer.install();
    expect(fixture.insertCss).toHaveBeenCalledTimes(2);
    expect(fixture.removeCss).toHaveBeenCalledExactlyOnceWith("old-document-style");
    resolveNew("new-document-style");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.installer.install();
    expect(fixture.insertCss).toHaveBeenCalledTimes(2);
    fixture.installer.dispose();
  });

  it("cancels retry timers on navigation and disposal", async () => {
    vi.useFakeTimers();
    const fixture = styleFixture();
    fixture.insertCss.mockRejectedValue(new Error("insertion unavailable"));
    fixture.installer.install();
    await vi.advanceTimersByTimeAsync(0);
    fixture.installer.invalidate();
    await vi.runAllTimersAsync();
    expect(fixture.insertCss).toHaveBeenCalledTimes(1);
    fixture.installer.install();
    await vi.advanceTimersByTimeAsync(0);
    fixture.installer.dispose();
    await vi.runAllTimersAsync();
    fixture.installer.install();
    expect(fixture.insertCss).toHaveBeenCalledTimes(2);
  });

  it("never inserts for another platform or a destroyed guest", () => {
    const fixture = styleFixture();
    fixture.state.url = "https://tcg-arena.fr/";
    fixture.installer.install();
    fixture.state.url = "https://play.riftatlas.com/";
    fixture.state.destroyed = true;
    fixture.installer.install();
    expect(fixture.insertCss).not.toHaveBeenCalled();
  });
});
