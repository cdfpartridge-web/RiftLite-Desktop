import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const gamePreloadSource = readFileSync(new URL("../src/game-preload/gamePreload.ts", import.meta.url), "utf8");

describe("Atlas battlefield seat bridge wiring", () => {
  it("delivers authoritative seat evidence before raw-frame deduplication", () => {
    const start = mainSource.indexOf("function ingestAtlasRawFrame(");
    const end = mainSource.indexOf("function recordAtlasDeckTrackerFrameDebug(", start);
    const body = mainSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(body.indexOf("atlasBattlefieldSeatSignalFromFrame(frame)")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("atlasBattlefieldSeatSignalFromFrame(frame)")).toBeLessThan(
      body.indexOf("atlasFrameDeduper.shouldIngest")
    );
  });

  it("gates delivery to the newest match socket and installs the preload listener first", () => {
    expect(mainSource).toContain("battlefieldSeatSockets.isCurrent(requestId)");
    expect(mainSource).toContain("battlefieldSeatSockets.observeClosed(requestId)");

    const bridgeInstall = gamePreloadSource.lastIndexOf("installAtlasBattlefieldSeatBridge();");
    const networkInstall = gamePreloadSource.lastIndexOf("installNetworkHooks();");
    expect(bridgeInstall).toBeGreaterThanOrEqual(0);
    expect(networkInstall).toBeGreaterThan(bridgeInstall);
  });
});
