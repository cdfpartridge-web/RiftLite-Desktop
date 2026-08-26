import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const gamePreloadSource = readFileSync(new URL("../src/game-preload/gamePreload.ts", import.meta.url), "utf8");

describe("Atlas authoritative match bridge wiring", () => {
  it("bridges trusted current-socket state before raw-frame deduplication", () => {
    const start = mainSource.indexOf("function ingestAtlasRawFrame(");
    const end = mainSource.indexOf("function recordAtlasDeckTrackerFrameDebug(", start);
    const body = mainSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(body).toContain("authoritativeMatchTracker?.observeFrame(frame)");
    expect(body).toContain("atlasAuthoritativeMatchSignalFromState(authoritativeMatchState)");
    expect(body.indexOf("authoritativeMatchTracker?.observeFrame(frame)")).toBeLessThan(
      body.indexOf("atlasFrameDeduper.shouldIngest")
    );
    expect(mainSource).toContain("battlefieldSeatSockets.isCurrent(requestId),\n      authoritativeMatchTracker");
  });

  it("installs the bridge before network hooks and prefers it over DOM identity, format, and score", () => {
    const bridgeInstall = gamePreloadSource.lastIndexOf("installAtlasAuthoritativeMatchBridge();");
    const networkInstall = gamePreloadSource.lastIndexOf("installNetworkHooks();");
    expect(bridgeInstall).toBeGreaterThanOrEqual(0);
    expect(networkInstall).toBeGreaterThan(bridgeInstall);

    expect(gamePreloadSource).toContain("source: \"atlas-authoritative-packet\"");
    expect(gamePreloadSource).toContain("format: authoritativeMatch?.format || readAtlasFormat(bodyText)");
    expect(gamePreloadSource).toContain("myName: authoritativeMatch?.myName || atlasPlayers.me");
    expect(gamePreloadSource).toContain("opponentName: authoritativeMatch?.opponentName || atlasPlayers.opponent");
  });
});
