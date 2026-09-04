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
export const GAME_WEBVIEW_INTERACTION_DIAGNOSTIC_IPC_CHANNEL = "game-webview:interaction-diagnostic";

export const ATLAS_GAME_INTERACTION_DIAGNOSTIC_PHASES = [
  "pointer-received",
  "focus-received",
  "keyboard-received"
] as const;

export type AtlasGameInteractionDiagnosticPhase = typeof ATLAS_GAME_INTERACTION_DIAGNOSTIC_PHASES[number];

export interface AtlasGameInteractionDiagnostic {
  phase: AtlasGameInteractionDiagnosticPhase;
  documentFocused: boolean;
  documentVisible: boolean;
  activeControl: boolean;
}

const ATLAS_GAME_INTERACTION_DIAGNOSTIC_KEYS = [
  "activeControl",
  "documentFocused",
  "documentVisible",
  "phase"
] as const;

/**
 * Accept only the four non-content fields emitted by the Atlas preload. This
 * diagnostic must never grow a permissive payload that could carry typed keys,
 * form values, labels, page text, or credentials into local diagnostics.
 */
export function validatedAtlasGameInteractionDiagnostic(value: unknown): AtlasGameInteractionDiagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== ATLAS_GAME_INTERACTION_DIAGNOSTIC_KEYS.length ||
    ATLAS_GAME_INTERACTION_DIAGNOSTIC_KEYS.some((key, index) => keys[index] !== key)
  ) {
    return null;
  }
  if (
    !ATLAS_GAME_INTERACTION_DIAGNOSTIC_PHASES.includes(record.phase as AtlasGameInteractionDiagnosticPhase) ||
    typeof record.documentFocused !== "boolean" ||
    typeof record.documentVisible !== "boolean" ||
    typeof record.activeControl !== "boolean"
  ) {
    return null;
  }
  return {
    phase: record.phase as AtlasGameInteractionDiagnosticPhase,
    documentFocused: record.documentFocused,
    documentVisible: record.documentVisible,
    activeControl: record.activeControl
  };
}

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

export function shouldInvalidateGameGuestPresentation(
  platform: GamePlatform,
  requested: boolean
): boolean {
  return requested && platform === "atlas";
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
