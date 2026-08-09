import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");

const viewStart = appSource.indexOf("function EmbeddedRiftReplayView");
const viewEnd = appSource.indexOf("function LocalRiftReplayView", viewStart);
const viewSource = appSource.slice(viewStart, viewEnd);

describe("embedded frame-by-frame replay fullscreen", () => {
  it("offers a labelled fullscreen toggle without remounting the selected replay", () => {
    expect(viewStart).toBeGreaterThan(-1);
    expect(viewSource).toContain("const [replayFullscreen, setReplayFullscreen] = useState(false)");
    expect(viewSource).toContain("window.riftlite.setWindowFullscreen(enabled)");
    expect(viewSource).toContain('data-fullscreen={replayFullscreen}');
    expect(viewSource).toContain('replayFullscreen ? "Exit full screen" : "Full screen"');
    expect(viewSource).toContain('key={`${reloadKey}:${embedState.url}`}');
    expect(viewSource).not.toContain('key={`${replayFullscreen}');
  });

  it("exits on Escape and releases only fullscreen owned by the replay view", () => {
    expect(viewSource).toContain('event.key !== "Escape"');
    expect(viewSource).toContain("void toggleReplayFullscreen(false)");
    expect(viewSource).toContain('webview.addEventListener("before-input-event", exitOnGuestEscape)');
    expect(viewSource).toContain("document.fullscreenElement === webview");
    expect(viewSource).toContain("ownsReplayFullscreenRef.current");
    expect(viewSource).toContain("window.riftlite.setWindowFullscreen(false)");
  });

  it("uses a fixed, full-viewport replay surface while keeping the guest mounted", () => {
    expect(stylesSource).toContain('.web-replay-page[data-fullscreen="true"]');
    expect(stylesSource).toContain("position: fixed");
    expect(stylesSource).toContain("width: 100vw");
    expect(stylesSource).toContain("height: 100vh");
    expect(stylesSource).toContain('.web-replay-page[data-fullscreen="true"] > .web-replay-control-centre');
  });
});
