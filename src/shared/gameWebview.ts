import type { GamePlatform } from "./types.js";

/**
 * Partition names are scoped by Electron's userData directory. Stable and UI
 * Dev therefore use the same names without sharing cookies or site storage.
 */
export const GAME_WEBVIEW_PARTITIONS: Record<GamePlatform, string> = {
  tcga: "persist:riftlite-tcga",
  atlas: "persist:riftlite-atlas",
  sim: "persist:riftlite-sim"
};

export const GAME_WEBVIEW_EDITABLE_FOCUS_IPC_CHANNEL = "game-webview:editable-focus";

/**
 * A newly selected provider must first mount while Play has real dimensions.
 * Once mounted, it can remain alive behind another RiftLite view so an active
 * capture is not interrupted.
 */
export function nextMountedGamePlatform(
  current: GamePlatform | null,
  selected: GamePlatform,
  playIsVisible: boolean
): GamePlatform | null {
  return playIsVisible ? selected : current;
}

export function gameWebviewIsReady(
  selected: GamePlatform,
  mounted: GamePlatform | null,
  preloadUrl: string
): mounted is GamePlatform {
  return Boolean(preloadUrl) && mounted === selected;
}

export function shouldRestoreGameWebviewFocus(
  reviewWasOpen: boolean,
  reviewIsOpen: boolean,
  selected: GamePlatform,
  mounted: GamePlatform | null,
  preloadUrl: string,
  playIsVisible: boolean
): boolean {
  return reviewWasOpen &&
    !reviewIsOpen &&
    shouldFocusGameWebviewInput(
      selected,
      mounted,
      preloadUrl,
      playIsVisible,
      reviewIsOpen
    );
}

export function shouldFocusGameWebviewInput(
  selected: GamePlatform,
  mounted: GamePlatform | null,
  preloadUrl: string,
  playIsVisible: boolean,
  hostInputBlocked: boolean
): boolean {
  return !hostInputBlocked &&
    playIsVisible &&
    selected === "atlas" &&
    gameWebviewIsReady(selected, mounted, preloadUrl);
}
