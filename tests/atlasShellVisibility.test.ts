import { describe, expect, it } from "vitest";

import {
  INITIAL_ATLAS_SHELL_VISIBILITY,
  shouldCoverAtlasShell,
  updateAtlasShellVisibility,
  type AtlasShellVisibility,
  type AtlasShellVisibilityEvent
} from "../src/renderer/atlasShellVisibility.js";

function transition(
  events: AtlasShellVisibilityEvent[],
  initial: AtlasShellVisibility = INITIAL_ATLAS_SHELL_VISIBILITY
): AtlasShellVisibility {
  return events.reduce(updateAtlasShellVisibility, initial);
}

describe("Atlas shell cover visibility", () => {
  it("covers a newly entered Atlas webview until its shell reports ready", () => {
    const entered = transition(["atlas-entered"]);
    expect(entered).toBe("covered");
    expect(shouldCoverAtlasShell(entered)).toBe(true);

    const ready = transition(["atlas-entered", "atlas-shell-ready"]);
    expect(ready).toBe("ready");
    expect(shouldCoverAtlasShell(ready)).toBe(false);
  });

  it("does not re-cover a ready shell during ordinary or sign-in navigation", () => {
    const visibility = transition([
      "atlas-entered",
      "atlas-shell-ready",
      "webview-load-started",
      "webview-load-started"
    ]);

    expect(visibility).toBe("ready");
    expect(shouldCoverAtlasShell(visibility)).toBe(false);
  });

  it("covers again when an empty-shell recovery explicitly remounts Atlas", () => {
    const recovering = transition([
      "atlas-entered",
      "atlas-shell-ready",
      "empty-shell-recovery-started"
    ]);
    expect(recovering).toBe("recovering");
    expect(shouldCoverAtlasShell(recovering)).toBe(true);

    const recovered = updateAtlasShellVisibility(recovering, "atlas-shell-ready");
    expect(recovered).toBe("ready");
    expect(shouldCoverAtlasShell(recovered)).toBe(false);
  });

  it("resets on leaving Atlas so the next entry starts covered", () => {
    const left = transition(["atlas-entered", "atlas-shell-ready", "atlas-left"]);
    expect(left).toBe("inactive");
    expect(shouldCoverAtlasShell(left)).toBe(false);

    const reentered = updateAtlasShellVisibility(left, "atlas-entered");
    expect(reentered).toBe("covered");
    expect(shouldCoverAtlasShell(reentered)).toBe(true);
  });

  it("ignores stale ready signals while Atlas is inactive", () => {
    expect(updateAtlasShellVisibility("inactive", "atlas-shell-ready")).toBe("inactive");
  });

  it("keeps duplicate entry events from covering an already-ready shell", () => {
    expect(transition(["atlas-entered", "atlas-shell-ready", "atlas-entered"])).toBe("ready");
  });

  it("reveals an unrecognized shell after a bounded wait and still accepts a late ready signal", () => {
    const fallback = transition(["atlas-entered", "shell-ready-timeout"]);
    expect(fallback).toBe("fallback-visible");
    expect(shouldCoverAtlasShell(fallback)).toBe(false);
    expect(updateAtlasShellVisibility(fallback, "atlas-shell-ready")).toBe("ready");

    const recoveryFallback = transition([
      "atlas-entered",
      "empty-shell-recovery-started",
      "shell-ready-timeout"
    ]);
    expect(recoveryFallback).toBe("fallback-visible");
    expect(shouldCoverAtlasShell(recoveryFallback)).toBe(false);
  });
});
