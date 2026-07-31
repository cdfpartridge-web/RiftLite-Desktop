import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const rendererSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Could not find source block between ${startMarker} and ${endMarker}.`);
  }
  return source.slice(start, end);
}

describe("Atlas empty-shell recovery integration", () => {
  it("keeps the detected guest alive so the main-process repair is not cancelled", () => {
    const handler = sourceBetween(
      rendererSource,
      "function handleWebviewIpc",
      "async function primeReplayVideoTarget"
    );

    expect(handler).toContain('updateAtlasShellVisibility(current, "empty-shell-recovery-started")');
    expect(handler).not.toContain("setGameWebviewEpoch");
  });

  it("clears the disposable Atlas runtime before reloading the same guest", () => {
    const handler = sourceBetween(
      mainSource,
      "function handleAtlasShellStatusEvent",
      "async function createWindow"
    );
    const repairIndex = handler.indexOf('refreshAtlasWebviewRuntime("automatic-empty-shell")');
    const reloadIndex = handler.indexOf("sender.reloadIgnoringCache()");

    expect(repairIndex).toBeGreaterThan(-1);
    expect(reloadIndex).toBeGreaterThan(repairIndex);
  });
});
