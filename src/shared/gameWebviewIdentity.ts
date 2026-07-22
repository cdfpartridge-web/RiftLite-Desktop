import type { GamePlatform } from "./types.js";

export const GAME_WEBVIEW_PLATFORM_ARGUMENT_PREFIX = "--riftlite-game-platform=";

function platformFromArgumentValue(value: string): GamePlatform | null {
  return value === "atlas" || value === "tcga" || value === "sim" ? value : null;
}

/**
 * Encodes the platform selected by the trusted main process for a game
 * WebView. The preload reads this once, so same-window OAuth navigation cannot
 * change the provider identity used by capture events.
 */
export function gameWebviewPlatformArgument(platform: GamePlatform): string {
  return `${GAME_WEBVIEW_PLATFORM_ARGUMENT_PREFIX}${platform}`;
}

/**
 * Parses a main-process supplied platform argument. Multiple identical values
 * are harmless, but malformed or conflicting values fail closed.
 */
export function parseGameWebviewPlatformArgument(argv: readonly string[]): GamePlatform | null {
  const values = argv
    .filter((argument) => argument.startsWith(GAME_WEBVIEW_PLATFORM_ARGUMENT_PREFIX))
    .map((argument) => platformFromArgumentValue(argument.slice(GAME_WEBVIEW_PLATFORM_ARGUMENT_PREFIX.length)));
  if (!values.length || values.some((value) => value === null)) {
    return null;
  }
  const [platform] = values;
  return values.every((value) => value === platform) ? platform : null;
}

/**
 * Uses an immutable main-process identity whenever the argument is present.
 * URL inference is only a backwards-compatible fallback for WebViews created
 * without the argument; an invalid argument must never fall through to it.
 */
export function resolveGameWebviewPlatformIdentity(
  argv: readonly string[],
  trustedUrlFallback: GamePlatform | null
): GamePlatform | null {
  const hasPlatformArgument = argv.some((argument) => argument.startsWith(GAME_WEBVIEW_PLATFORM_ARGUMENT_PREFIX));
  return hasPlatformArgument
    ? parseGameWebviewPlatformArgument(argv)
    : trustedUrlFallback;
}
