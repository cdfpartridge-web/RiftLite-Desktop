import { describe, expect, it } from "vitest";

import {
  GAME_WEBVIEW_PARTITIONS,
  gameWebviewIsReady,
  nextMountedGamePlatform
} from "../src/shared/gameWebview.js";

describe("game webview lifecycle", () => {
  it("defers a first provider mount until Play is visible", () => {
    expect(nextMountedGamePlatform(null, "atlas", false)).toBeNull();
    expect(nextMountedGamePlatform(null, "atlas", true)).toBe("atlas");
  });

  it("keeps an already mounted provider alive behind other views", () => {
    expect(nextMountedGamePlatform("atlas", "atlas", false)).toBe("atlas");
  });

  it("does not render the stale provider when selection changes off Play", () => {
    expect(gameWebviewIsReady("atlas", "tcga", "file:///gamePreload.cjs")).toBe(false);
    expect(gameWebviewIsReady("atlas", "atlas", "file:///gamePreload.cjs")).toBe(true);
  });

  it("uses the same Atlas partition that the recovery action clears", () => {
    expect(GAME_WEBVIEW_PARTITIONS.atlas).toBe("persist:riftlite-atlas");
  });
});
