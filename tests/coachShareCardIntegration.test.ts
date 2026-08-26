import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../src/preload/appPreload.ts", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("../src/shared/types.ts", import.meta.url), "utf8");

function sourceBetween(startNeedle: string, endNeedle: string): string {
  const start = mainSource.indexOf(startNeedle);
  const end = mainSource.indexOf(endNeedle, start + startNeedle.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

describe("coach share-card capture integration", () => {
  it("exposes one typed, narrow request through the preload bridge", () => {
    expect(typesSource).toContain("export interface CoachShareCardCaptureRequest");
    expect(typesSource).toContain('action: "copy" | "save"');
    expect(typesSource).toContain("bounds: {");
    expect(typesSource).toContain("export interface CoachShareCardCaptureResult");
    expect(typesSource).toContain("captureCoachShareCard(request: CoachShareCardCaptureRequest): Promise<CoachShareCardCaptureResult>");
    expect(preloadSource).toContain(
      'captureCoachShareCard: (request) => ipcRenderer.invoke("coach:share-card:capture", request) as ReturnType<RiftLiteApi["captureCoachShareCard"]>'
    );
  });

  it("registers the capture only through the trusted app IPC wrapper", () => {
    expect(mainSource).toContain(
      'handleTrustedAppIpc("coach:share-card:capture", (event, request: CoachShareCardCaptureRequest) => ('
    );
    expect(mainSource).toContain("captureCoachShareCard(event.sender, request)");
    expect(mainSource).not.toContain('ipcMain.handle("coach:share-card:capture"');
  });

  it("normalizes and bounds the renderer crop before capture", () => {
    const boundsSource = sourceBetween(
      "function coachShareCaptureBounds",
      "async function captureCoachShareCard"
    );
    const captureSource = sourceBetween(
      "async function captureCoachShareCard",
      "async function captureTimedReplayFrame"
    );

    expect(boundsSource).toContain("Number.isFinite(item)");
    expect(boundsSource).toContain("const x = Math.max(0, Math.floor(value.x))");
    expect(boundsSource).toContain("const y = Math.max(0, Math.floor(value.y))");
    expect(boundsSource).toContain("width: Math.ceil(value.x + value.width) - x");
    expect(boundsSource).toContain("height: Math.ceil(value.y + value.height) - y");
    expect(boundsSource).toContain("bounds.width < 320 || bounds.height < 180");
    expect(boundsSource).toContain("bounds.width > 2400 || bounds.height > 1600");
    expect(boundsSource).toContain("Math.abs(aspectRatio - 16 / 9) > 0.03");
    expect(captureSource).toContain('request?.action !== "copy" && request?.action !== "save"');
    expect(captureSource).toContain("BrowserWindow.fromWebContents(sender)");
    expect(captureSource).toContain("bounds.x + bounds.width > contentWidth + 1");
    expect(captureSource).toContain("bounds.y + bounds.height > contentHeight + 1");
    expect(captureSource).toContain("await sender.capturePage(bounds)");
    expect(captureSource).toContain("captured.isEmpty()");
  });

  it("always produces a 1200 by 675 PNG-compatible image for copy and save", () => {
    const captureSource = sourceBetween(
      "async function captureCoachShareCard",
      "async function captureTimedReplayFrame"
    );

    expect(captureSource).toContain('captured.resize({ width: 1200, height: 675, quality: "best" })');
    expect(captureSource).toContain('if (action === "copy")');
    expect(captureSource).toContain("clipboard.writeImage(image)");
    expect(captureSource).toContain('filters: [{ name: "PNG image", extensions: ["png"] }]');
    expect(captureSource).toContain('result.filePath.toLowerCase().endsWith(".png")');
    expect(captureSource).toContain("image.toPNG({ scaleFactor: 1 })");
  });
});
