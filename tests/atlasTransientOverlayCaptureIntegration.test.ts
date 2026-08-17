import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const gamePreloadSource = readFileSync(new URL("../src/game-preload/gamePreload.ts", import.meta.url), "utf8");

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = gamePreloadSource.indexOf(startMarker);
  const end = gamePreloadSource.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Could not find source block between ${startMarker} and ${endMarker}.`);
  }
  return gamePreloadSource.slice(start, end);
}

describe("Atlas transient overlay capture integration", () => {
  it("retains an established game while a visible picker, menu, or dialog replaces board evidence", () => {
    const snapshot = sourceBetween("function readAtlasSnapshot", "function isAtlasNonGamePage");

    expect(snapshot).toContain("const transientOverlay = isAtlasTransientGameOverlay(terminalText, sideboarding)");
    expect(snapshot).toContain("!isAtlasGameRouteUrl(location.href)");
    expect(snapshot).toContain("const hardLobby = isAtlasRootLandingUrl(location.href)");
    expect(snapshot).toContain("transientOverlay ||");
    expect(snapshot).toContain("atlasTransientOverlay: transientOverlay");
    expect(snapshot).toContain('"[role=\'listbox\']"');
    expect(snapshot).toContain('"[class*=\'picker\' i]"');
    expect(snapshot).toContain("isVisibleAtlasElement(element)");
  });

  it("keeps explicit results immediate but uses the longer fallback only for unexplained Atlas inactivity", () => {
    const publish = sourceBetween("function publishSnapshot", "function normalizeVisibleResultKey");
    const resultIndex = publish.indexOf('reason: "result-text-detected"');
    const inactiveIndex = publish.indexOf('reason: "inactive-debounce"');

    expect(resultIndex).toBeGreaterThan(-1);
    expect(inactiveIndex).toBeGreaterThan(resultIndex);
    expect(publish).toContain('platform === "atlas" ? atlasInactiveEndGraceMs(location.href, data.format) : 3000');
    expect(publish).not.toContain('platform === "atlas" ? 1800 : 3000');
  });
});
