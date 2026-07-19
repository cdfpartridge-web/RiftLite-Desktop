import { GAME_WEBVIEW_PARTITIONS } from "./gameWebview.js";
import type { GamePlatform } from "./types.js";

export type EmbeddedWebviewPolicy =
  | { kind: "game"; platform: GamePlatform }
  | { kind: "replay" }
  | { kind: "home-video"; provider: "youtube"; mediaId: string }
  | { kind: "home-video"; provider: "twitch"; mediaId: string };

export const RIFTLITE_REPLAY_WEBVIEW_PARTITION = "persist:riftlite-replay";
const YOUTUBE_PARTITION_PREFIX = "persist:riftlite-home-video-";
const TWITCH_PARTITION_PREFIX = "persist:riftlite-twitch-";
const SAFE_MEDIA_ID = /^[A-Za-z0-9_-]{1,80}$/;

export type WebFrameIdentity = {
  processId: number;
  routingId: number;
};

/**
 * Electron can hand different JavaScript wrappers to permission and display
 * capture callbacks for the same WebFrameMain. Process/routing IDs are the
 * stable identity; object reference equality is not.
 */
export function sameWebFrameIdentity(
  left: WebFrameIdentity | null | undefined,
  right: WebFrameIdentity | null | undefined
): boolean {
  return Boolean(
    left &&
    right &&
    Number.isInteger(left.processId) &&
    Number.isInteger(left.routingId) &&
    left.processId === right.processId &&
    left.routingId === right.routingId
  );
}

function parsedUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hostnameMatches(hostname: string, expected: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === expected || normalized.endsWith(`.${expected}`);
}

function usesDefaultHttpsPort(url: URL): boolean {
  return url.protocol === "https:" && url.port === "";
}

export function gamePlatformForTrustedUrl(value: string, allowSimulator = false): GamePlatform | null {
  const url = parsedUrl(value);
  if (!url) {
    return null;
  }
  if (usesDefaultHttpsPort(url) && hostnameMatches(url.hostname, "tcg-arena.fr")) {
    return "tcga";
  }
  if (usesDefaultHttpsPort(url) && url.hostname.toLowerCase() === "play.riftatlas.com") {
    return "atlas";
  }
  if (
    allowSimulator &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
    url.port === "5174"
  ) {
    return "sim";
  }
  return null;
}

export function isAllowedReplayWebviewNavigation(value: string): boolean {
  const url = parsedUrl(value);
  return Boolean(
    url &&
    url.protocol === "https:" &&
    url.origin === "https://www.riftlite.com" &&
    (url.pathname === "/replays" || url.pathname.startsWith("/replays/"))
  );
}

function youtubePolicy(src: string, partition: string): EmbeddedWebviewPolicy | null {
  if (!partition.startsWith(YOUTUBE_PARTITION_PREFIX)) {
    return null;
  }
  const mediaId = partition.slice(YOUTUBE_PARTITION_PREFIX.length);
  const url = parsedUrl(src);
  const pathId = url?.pathname.match(/^\/embed\/([A-Za-z0-9_-]{1,80})\/?$/)?.[1] ?? "";
  if (
    !url ||
    !usesDefaultHttpsPort(url) ||
    !["www.youtube.com", "www.youtube-nocookie.com"].includes(url.hostname.toLowerCase()) ||
    !SAFE_MEDIA_ID.test(mediaId) ||
    pathId !== mediaId
  ) {
    return null;
  }
  return { kind: "home-video", provider: "youtube", mediaId };
}

function twitchPolicy(src: string, partition: string): EmbeddedWebviewPolicy | null {
  if (!partition.startsWith(TWITCH_PARTITION_PREFIX)) {
    return null;
  }
  const mediaId = partition.slice(TWITCH_PARTITION_PREFIX.length).toLowerCase();
  const url = parsedUrl(src);
  const channel = url?.searchParams.get("channel")?.toLowerCase() ?? "";
  if (
    !url ||
    !usesDefaultHttpsPort(url) ||
    url.hostname.toLowerCase() !== "player.twitch.tv" ||
    url.pathname !== "/" ||
    !SAFE_MEDIA_ID.test(mediaId) ||
    channel !== mediaId
  ) {
    return null;
  }
  return { kind: "home-video", provider: "twitch", mediaId };
}

export function embeddedWebviewPolicy(
  src: string,
  partition: string,
  allowSimulator = false
): EmbeddedWebviewPolicy | null {
  if (partition === RIFTLITE_REPLAY_WEBVIEW_PARTITION) {
    return isAllowedReplayWebviewNavigation(src) ? { kind: "replay" } : null;
  }
  const platform = gamePlatformForTrustedUrl(src, allowSimulator);
  if (platform && partition === GAME_WEBVIEW_PARTITIONS[platform]) {
    return { kind: "game", platform };
  }
  return youtubePolicy(src, partition) ?? twitchPolicy(src, partition);
}

export function isAllowedEmbeddedNavigation(policy: EmbeddedWebviewPolicy, value: string): boolean {
  if (policy.kind === "replay") {
    return isAllowedReplayWebviewNavigation(value);
  }
  if (policy.kind === "game") {
    return gamePlatformForTrustedUrl(value, policy.platform === "sim") === policy.platform;
  }
  const url = parsedUrl(value);
  if (!url || !usesDefaultHttpsPort(url)) {
    return false;
  }
  if (policy.provider === "youtube") {
    const mediaId = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{1,80})\/?$/)?.[1] ?? "";
    return ["www.youtube.com", "www.youtube-nocookie.com"].includes(url.hostname.toLowerCase()) &&
      mediaId === policy.mediaId;
  }
  return url.hostname.toLowerCase() === "player.twitch.tv" &&
    url.pathname === "/" &&
    url.searchParams.get("channel")?.toLowerCase() === policy.mediaId;
}

export function isSecurePopupNavigation(value: string): boolean {
  const url = parsedUrl(value);
  return Boolean(url && (usesDefaultHttpsPort(url) || url.toString() === "about:blank"));
}

const ATLAS_OAUTH_ORIGINS = new Set([
  "https://accounts.google.com",
  "https://clerk.riftatlas.com",
  "https://discord.com",
  "https://id.twitch.tv",
  "https://www.twitch.tv"
]);

const TCGA_OAUTH_ORIGINS = new Set([
  "https://accounts.google.com",
  "https://tcg-arena-62f15.firebaseapp.com"
]);

/**
 * Keeps provider sign-in inside a sandboxed popup while sending unrelated
 * links to the user's browser. OAuth callbacks may return to the game origin.
 */
export function isAllowedGamePopupNavigation(
  policy: Extract<EmbeddedWebviewPolicy, { kind: "game" }>,
  value: string
): boolean {
  if (value === "about:blank" || isAllowedEmbeddedNavigation(policy, value)) {
    return true;
  }
  const url = parsedUrl(value);
  if (!url || !usesDefaultHttpsPort(url)) {
    return false;
  }
  return (policy.platform === "atlas" ? ATLAS_OAUTH_ORIGINS : TCGA_OAUTH_ORIGINS).has(url.origin);
}

/**
 * Clerk and Firebase can use either a popup or a same-window redirect for
 * provider sign-in. The latter must remain in the embedded game's persistent
 * session or the OAuth callback loses the cookies that started the flow.
 */
export function isAllowedGameMainFrameNavigation(
  policy: Extract<EmbeddedWebviewPolicy, { kind: "game" }>,
  value: string
): boolean {
  if (isAllowedEmbeddedNavigation(policy, value)) {
    return true;
  }
  const url = parsedUrl(value);
  if (!url || !usesDefaultHttpsPort(url)) {
    return false;
  }
  return (policy.platform === "atlas" ? ATLAS_OAUTH_ORIGINS : TCGA_OAUTH_ORIGINS).has(url.origin);
}
