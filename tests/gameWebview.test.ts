import { describe, expect, it } from "vitest";

import {
  ATLAS_GAME_INTERACTION_DIAGNOSTIC_PHASES,
  GAME_WEBVIEW_EDITABLE_FOCUS_IPC_CHANNEL,
  GAME_WEBVIEW_INTERACTION_DIAGNOSTIC_IPC_CHANNEL,
  GAME_WEBVIEW_PARTITIONS,
  gameWebviewIsReady,
  nextMountedGamePlatform,
  shouldFocusGameWebviewInput,
  shouldInvalidateGameGuestPresentation,
  validatedAtlasGameInteractionDiagnostic,
  shouldRestoreGameWebviewFocus
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

  it("uses separate channels for Atlas native focus and diagnostic acknowledgement", () => {
    expect(GAME_WEBVIEW_EDITABLE_FOCUS_IPC_CHANNEL).toBe("game-webview:editable-focus");
    expect(GAME_WEBVIEW_INTERACTION_DIAGNOSTIC_IPC_CHANNEL).toBe("game-webview:interaction-diagnostic");
    expect(ATLAS_GAME_INTERACTION_DIAGNOSTIC_PHASES).toEqual([
      "pointer-received",
      "focus-received",
      "keyboard-received"
    ]);
  });

  it("accepts only the exact privacy-safe Atlas interaction diagnostic schema", () => {
    const safe = {
      phase: "keyboard-received",
      documentFocused: true,
      documentVisible: true,
      activeControl: true
    } as const;

    const validated = validatedAtlasGameInteractionDiagnostic(safe);
    expect(validated).toEqual(safe);
    expect(Object.keys(validated ?? {}).sort()).toEqual([
      "activeControl",
      "documentFocused",
      "documentVisible",
      "phase"
    ]);
    expect(validatedAtlasGameInteractionDiagnostic({ ...safe, phase: "key-a" })).toBeNull();
    expect(validatedAtlasGameInteractionDiagnostic({ ...safe, documentFocused: "yes" })).toBeNull();
    expect(validatedAtlasGameInteractionDiagnostic({ ...safe, value: "credential-sentinel" })).toBeNull();
    expect(validatedAtlasGameInteractionDiagnostic({ ...safe, key: "credential-sentinel" })).toBeNull();
    expect(validatedAtlasGameInteractionDiagnostic({ ...safe, text: "credential-sentinel" })).toBeNull();
    expect(validatedAtlasGameInteractionDiagnostic({ ...safe, credential: "credential-sentinel" })).toBeNull();
  });

  it("invalidates compositor surfaces only for an explicitly requested Atlas recovery", () => {
    expect(shouldInvalidateGameGuestPresentation("atlas", true)).toBe(true);
    expect(shouldInvalidateGameGuestPresentation("atlas", false)).toBe(false);
    expect(shouldInvalidateGameGuestPresentation("tcga", true)).toBe(false);
    expect(shouldInvalidateGameGuestPresentation("sim", true)).toBe(false);
  });

  it("allows Atlas input focus recovery only while its ready Play surface is unobstructed", () => {
    expect(shouldFocusGameWebviewInput("atlas", "atlas", "file:///gamePreload.cjs", true, false)).toBe(true);
    expect(shouldFocusGameWebviewInput("atlas", "atlas", "file:///gamePreload.cjs", true, true)).toBe(false);
    expect(shouldFocusGameWebviewInput("atlas", "atlas", "file:///gamePreload.cjs", false, false)).toBe(false);
    expect(shouldFocusGameWebviewInput("tcga", "tcga", "file:///gamePreload.cjs", true, false)).toBe(false);
    expect(shouldFocusGameWebviewInput("atlas", "tcga", "file:///gamePreload.cjs", true, false)).toBe(false);
    expect(shouldFocusGameWebviewInput("atlas", "atlas", "", true, false)).toBe(false);
  });

  it("restores Atlas input focus after the post-game review closes", () => {
    expect(shouldRestoreGameWebviewFocus(true, false, "atlas", "atlas", "file:///gamePreload.cjs", true)).toBe(true);
  });

  it("does not steal focus while review is open, Play is hidden, or another provider is active", () => {
    expect(shouldRestoreGameWebviewFocus(true, true, "atlas", "atlas", "file:///gamePreload.cjs", true)).toBe(false);
    expect(shouldRestoreGameWebviewFocus(true, false, "atlas", "atlas", "file:///gamePreload.cjs", false)).toBe(false);
    expect(shouldRestoreGameWebviewFocus(true, false, "tcga", "tcga", "file:///gamePreload.cjs", true)).toBe(false);
    expect(shouldRestoreGameWebviewFocus(true, false, "atlas", "tcga", "file:///gamePreload.cjs", true)).toBe(false);
  });
});
