import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  rasterizeReplayMp4Svg,
  replayMp4SvgDataUrl,
  type ReplayMp4OverlayWindow
} from "../src/main/services/replayMp4OverlayRasterizer.js";

const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");

function fakeWindow(options: { empty?: boolean; destroyed?: boolean } = {}) {
  const png = Buffer.from("png-bytes");
  const capturePage = vi.fn(async () => ({
    isEmpty: () => options.empty === true,
    toPNG: () => options.empty ? Buffer.alloc(0) : png
  }));
  const loadURL = vi.fn(async () => undefined);
  const rasterWindow: ReplayMp4OverlayWindow = {
    isDestroyed: () => options.destroyed === true,
    loadURL,
    webContents: { capturePage }
  };
  return { rasterWindow, loadURL, capturePage, png };
}

describe("replay MP4 overlay rasterizer", () => {
  it("loads generated SVG in Chromium and captures a transparent PNG-sized frame", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"></svg>';
    const fake = fakeWindow();

    await expect(rasterizeReplayMp4Svg(fake.rasterWindow, svg, 640, 360)).resolves.toEqual(fake.png);
    expect(fake.loadURL).toHaveBeenCalledWith(replayMp4SvgDataUrl(svg));
    expect(fake.capturePage).toHaveBeenCalledWith({ x: 0, y: 0, width: 640, height: 360 });
    expect(Buffer.from(replayMp4SvgDataUrl(svg).split(",")[1] ?? "", "base64").toString("utf8")).toBe(svg);
  });

  it("fails the export instead of silently dropping an overlay that did not render", async () => {
    const fake = fakeWindow({ empty: true });

    await expect(rasterizeReplayMp4Svg(fake.rasterWindow, "<svg/>", 640, 360))
      .rejects.toThrow("could not be rendered");
  });

  it("rejects a destroyed renderer or unsafe dimensions", async () => {
    const destroyed = fakeWindow({ destroyed: true });
    const active = fakeWindow();

    await expect(rasterizeReplayMp4Svg(destroyed.rasterWindow, "<svg/>", 640, 360))
      .rejects.toThrow("closed unexpectedly");
    await expect(rasterizeReplayMp4Svg(active.rasterWindow, "<svg/>", 20_000, 360))
      .rejects.toThrow("dimensions are invalid");
  });

  it("connects MP4 export to the Chromium rasterizer and never silently skips render failures", () => {
    const writeStart = mainSource.indexOf("async function writeReplayMp4OverlayPng");
    const writeEnd = mainSource.indexOf("function replayMp4AnnotationTimeMs", writeStart);
    const overlayStart = mainSource.indexOf("async function replayMp4OverlayInputs");
    const overlayEnd = mainSource.indexOf("function replayMp4VoiceNoteDelayMs", overlayStart);
    const writer = mainSource.slice(writeStart, writeEnd);
    const overlays = mainSource.slice(overlayStart, overlayEnd);

    expect(writeStart).toBeGreaterThan(-1);
    expect(writer).toContain("rasterizeReplayMp4Svg");
    expect(writer).not.toContain("nativeImage.createFromDataURL");
    expect(overlays).toContain("replayMp4FlagTimeMs(flag, video)");
    expect(overlays).toContain("rasterWindow.destroy()");
    expect(overlays).not.toContain("Skipping replay export overlay");
    expect(overlays).not.toContain("flags.filter((item) => typeof item.timeMs");
  });
});
