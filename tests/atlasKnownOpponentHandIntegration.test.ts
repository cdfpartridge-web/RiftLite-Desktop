import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../src/preload/appPreload.ts", import.meta.url), "utf8");

describe("Atlas known opponent hand integration", () => {
  it("feeds deduplicated Atlas frames into the reveal-gated tracker and publishes sanitized state", () => {
    const ingestStart = mainSource.indexOf("function ingestAtlasRawFrame");
    const ingestEnd = mainSource.indexOf("function recordAtlasDeckTrackerFrameDebug", ingestStart);
    const ingest = mainSource.slice(ingestStart, ingestEnd);

    expect(ingestStart).toBeGreaterThan(-1);
    expect(ingest).toContain("atlasFrameDeduper.shouldIngest");
    expect(ingest).toContain("atlasKnownOpponentHandTracker.ingest(frame)");
    expect(ingest).toContain("publishAtlasKnownOpponentHandState()");
    expect(mainSource).toContain('mainWindow.webContents.send("atlas-known-hand:updated", state)');
  });

  it("exposes only typed state, dismiss, clear, update, and shortcut channels to the renderer", () => {
    expect(preloadSource).toContain('ipcRenderer.invoke("atlas-known-hand:get")');
    expect(preloadSource).toContain('ipcRenderer.invoke("atlas-known-hand:dismiss", instanceId)');
    expect(preloadSource).toContain('ipcRenderer.invoke("atlas-known-hand:clear")');
    expect(preloadSource).toContain('ipcRenderer.on("atlas-known-hand:updated", listener)');
    expect(preloadSource).toContain('ipcRenderer.on("atlas-known-hand:shortcut", listener)');
  });

  it("renders an Atlas-only accessible card-art panel with instance-specific dismissal", () => {
    expect(appSource).toContain('className="segmented icon-segment atlas-known-hand-action"');
    expect(appSource).toContain('aria-controls="atlas-known-opponent-hand"');
    expect(appSource).toContain('id="atlas-known-opponent-hand"');
    expect(appSource).toContain('aria-labelledby="atlas-known-hand-title"');
    expect(appSource).toContain("resolveBundledReplayCardImage(card.code || card.cardId)");
    expect(appSource).toContain("key={card.instanceId}");
    expect(appSource).toContain("onDismiss(card.instanceId)");
    expect(appSource).toContain("Unknown draws are not added.");
    const panelStart = appSource.indexOf("function AtlasKnownOpponentHandPanel");
    const panelEnd = appSource.indexOf("function ReleaseNotesModal", panelStart);
    const panel = appSource.slice(panelStart, panelEnd);
    expect(panel).toContain("<aside");
    expect(panel).not.toContain('aria-modal="true"');
    expect(panel).toContain('event.key === "Escape"');
  });

  it("clears ephemeral known-hand state when the current Atlas guest is destroyed", () => {
    const attachStart = mainSource.indexOf('mainWindow.webContents.on("did-attach-webview"');
    const lifecycleStart = mainSource.indexOf('webContents.once("destroyed", () => {', attachStart);
    const lifecycleEnd = mainSource.indexOf('webContents.on("render-process-gone"', lifecycleStart);
    const lifecycle = mainSource.slice(lifecycleStart, lifecycleEnd);

    expect(lifecycleStart).toBeGreaterThan(-1);
    expect(lifecycle).toContain('gameWebContentsByPlatform.get("atlas")?.id === webContents.id');
    expect(lifecycle).toContain("atlasKnownOpponentHandTracker.reset()");
    expect(lifecycle).toContain("publishAtlasKnownOpponentHandState()");
  });

  it("clears the hand memory on a validated Atlas match-end boundary", () => {
    const resetStart = mainSource.indexOf("function resetAtlasKnownOpponentHandForCaptureBoundary");
    const resetEnd = mainSource.indexOf("function ingestAtlasRawFrame", resetStart);
    const reset = mainSource.slice(resetStart, resetEnd);

    expect(resetStart).toBeGreaterThan(-1);
    expect(reset).toContain('event.platform === "atlas"');
    expect(reset).toContain('event.kind === "match-end"');
    expect(reset).toContain("atlasKnownOpponentHandTracker.reset()");
    expect(mainSource.match(/resetAtlasKnownOpponentHandForCaptureBoundary\(event\)/g)).toHaveLength(2);
  });
});
