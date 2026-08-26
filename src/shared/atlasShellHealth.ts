export interface AtlasShellEvidence {
  hostname: string;
  pathname: string;
  visibleText: string;
  interactiveText: string;
  interactiveCount: number;
  gameSurfaceCount: number;
  lobbyPlaySurfaceCount: number;
  lobbyHeadingCount: number;
  authHeadingCount: number;
  authFormCount: number;
}

export const ATLAS_STALLED_SHELL_MIN_AGE_MS = 8_000;
export const ATLAS_EMPTY_SHELL_MIN_AGE_MS = 18_000;
export const ATLAS_SHELL_READY_STABILITY_MS = 3_000;
export const ATLAS_PERSISTENT_EMPTY_SHELL_MIN_AGE_MS = 60_000;
export const ATLAS_PERSISTENT_EMPTY_SHELL_RETRY_AGE_MS = 120_000;
export const ATLAS_SHELL_MONITOR_INTERVAL_MS = 5_000;

export type AtlasShellRouteKind = "lobby" | "auth" | "game" | "other";

export type AtlasShellReadyReason =
  | "lobby-content"
  | "auth-content"
  | "auth-transition"
  | "game-content"
  | "other-app-content"
  | "none";

export interface AtlasShellAssessment {
  ready: boolean;
  routeKind: AtlasShellRouteKind;
  readyReason: AtlasShellReadyReason;
  lobbyActionCount: number;
  lobbyPlayActionCount: number;
  lobbyPlaySurfaceCount: number;
  authMarkerCount: number;
  gameMarkerCount: number;
}

export interface AtlasAuthSurfaceEvidence {
  isClerkSurface: boolean;
  hasPasswordInput: boolean;
  hasOneTimeCodeInput: boolean;
  hasIdentifierInput: boolean;
  text: string;
}

const LOBBY_PLAY_ACTION_MARKERS = [
  /\bhost room\b/i,
  /\bsolo room\b/i,
  /\bfind random match\b/i,
  /\bquick match\b/i,
  /\bjoin\s*(?:\/|or)\s*spectate\b/i,
  /\bjoin room\b/i
];

const LOBBY_DECK_ACTION_MARKERS = [
  /\bchoose deck\b/i,
  /\bimport deck\b/i,
  /\bnew deck\b/i,
  /\bpaste a deck\b/i
];

const LOBBY_ACTION_MARKERS = [
  ...LOBBY_PLAY_ACTION_MARKERS,
  ...LOBBY_DECK_ACTION_MARKERS
];

const AUTH_MARKERS = [
  /\bsign in\b/i,
  /\blog in\b/i,
  /\bsign up\b/i,
  /\bcreate account\b/i,
  /\bcontinue with\b/i,
  /\bemail address\b/i,
  /\bpassword\b/i,
  /\bverify (?:your )?email\b/i,
  /\buse another method\b/i
];

const GAME_MARKERS = [
  /\bwaiting for (?:an? )?opponent\b/i,
  /\bwaiting for players?\b/i,
  /\bjoining (?:the )?room\b/i,
  /\bloading (?:the )?game board\b/i,
  /\broom code\b/i,
  /\bstart game\b/i,
  /\bconcede\b/i,
  /\bmulligan\b/i,
  /\bend turn\b/i,
  /\b(?:your|opponent(?:'s|\u2019s)) turn\b/i,
  /\breport (?:the )?winner\b/i,
  /\bsideboard(?:ing)?\b/i,
  /\brequest rematch\b/i,
  /\bgame over\b/i,
  /\bstarting turn\b/i
];

/**
 * Classifies the visible RiftAtlas application shell without treating generic
 * page chrome (ads, footer links, or promo buttons) as proof that the lobby
 * mounted. Interactive element counts remain diagnostic-only on purpose.
 */
export function assessAtlasShell(evidence: AtlasShellEvidence): AtlasShellAssessment {
  const hostname = evidence.hostname.trim().toLowerCase();
  const pathname = stripAtlasLocalePrefix(normalizePathname(evidence.pathname));
  const routeKind = atlasShellRouteKind(hostname, pathname);
  const lobbyActionCount = markerCount(evidence.interactiveText, LOBBY_ACTION_MARKERS);
  const lobbyPlayActionCount = markerCount(evidence.interactiveText, LOBBY_PLAY_ACTION_MARKERS);
  const lobbyPlaySurfaceCount = Number.isFinite(evidence.lobbyPlaySurfaceCount)
    ? Math.max(0, Math.trunc(evidence.lobbyPlaySurfaceCount))
    : 0;
  const authMarkerCount = markerCount(evidence.visibleText, AUTH_MARKERS);
  const gameMarkerCount = markerCount(evidence.visibleText, GAME_MARKERS);
  // Deck management can render before Atlas's matchmaking subtree when a
  // cached frontend update only mounts part of the lobby. Do not report the
  // shell as healthy until at least one actual way to play is visible.
  const lobbyReady = lobbyPlaySurfaceCount > 0 || (
    lobbyPlayActionCount > 0 && (evidence.lobbyHeadingCount > 0 || lobbyActionCount >= 2)
  );

  if (isAtlasAuthTransition(hostname, pathname)) {
    return assessment(true, routeKind, "auth-transition", lobbyActionCount, lobbyPlayActionCount, lobbyPlaySurfaceCount, authMarkerCount, gameMarkerCount);
  }

  // Atlas's lobby deck list may also expose card-like data attributes. Those
  // are not proof that the actual game board or matchmaking controls mounted.
  if (evidence.gameSurfaceCount > 0 && (routeKind === "game" || routeKind === "other")) {
    return assessment(true, routeKind, "game-content", lobbyActionCount, lobbyPlayActionCount, lobbyPlaySurfaceCount, authMarkerCount, gameMarkerCount);
  }

  if (routeKind === "lobby") {
    return assessment(lobbyReady, routeKind, lobbyReady ? "lobby-content" : "none", lobbyActionCount, lobbyPlayActionCount, lobbyPlaySurfaceCount, authMarkerCount, gameMarkerCount);
  }

  if (routeKind === "auth") {
    const authReady = evidence.authFormCount > 0 || evidence.authHeadingCount > 0;
    return assessment(authReady, routeKind, authReady ? "auth-content" : "none", lobbyActionCount, lobbyPlayActionCount, lobbyPlaySurfaceCount, authMarkerCount, gameMarkerCount);
  }

  if (routeKind === "game") {
    const gameReady = gameMarkerCount > 0;
    return assessment(gameReady, routeKind, gameReady ? "game-content" : "none", lobbyActionCount, lobbyPlayActionCount, lobbyPlaySurfaceCount, authMarkerCount, gameMarkerCount);
  }

  const otherReady = lobbyReady || (evidence.authFormCount > 0 && authMarkerCount > 0) || gameMarkerCount > 0;
  return assessment(otherReady, routeKind, otherReady ? "other-app-content" : "none", lobbyActionCount, lobbyPlayActionCount, lobbyPlaySurfaceCount, authMarkerCount, gameMarkerCount);
}

export function isAtlasAuthSurfaceEvidence(evidence: AtlasAuthSurfaceEvidence): boolean {
  return evidence.isClerkSurface ||
    evidence.hasPasswordInput ||
    evidence.hasOneTimeCodeInput ||
    (evidence.hasIdentifierInput && /\b(?:sign in|log in|create account)\b/i.test(evidence.text));
}

export function shouldReportAtlasEmptyShell(
  assessment: Pick<AtlasShellAssessment, "ready">,
  allowEmpty: boolean,
  alreadyReported: boolean
): boolean {
  return allowEmpty && !alreadyReported && !assessment.ready;
}

/**
 * Automatic shell recovery is intentionally limited to Atlas's lobby and
 * authentication surfaces. Deck tools and active game routes must never be
 * redirected just because their controls differ from the lobby classifier.
 */
export function isAtlasShellRecoveryRoute(hostname: string, pathname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase();
  const normalizedPathname = stripAtlasLocalePrefix(normalizePathname(pathname));
  const routeKind = atlasShellRouteKind(normalizedHostname, normalizedPathname);
  return routeKind === "lobby" || routeKind === "auth";
}

export interface AtlasShellRecoveryRouteTransition {
  active: boolean;
  entered: boolean;
  shouldArmDeadlines: boolean;
}

export function atlasShellRecoveryRouteTransition(
  previouslyActive: boolean,
  routeActive: boolean,
  shellReadyReported: boolean
): AtlasShellRecoveryRouteTransition {
  const entered = routeActive && !previouslyActive;
  return {
    active: routeActive,
    entered,
    shouldArmDeadlines: entered && !shellReadyReported
  };
}

function assessment(
  ready: boolean,
  routeKind: AtlasShellRouteKind,
  readyReason: AtlasShellReadyReason,
  lobbyActionCount: number,
  lobbyPlayActionCount: number,
  lobbyPlaySurfaceCount: number,
  authMarkerCount: number,
  gameMarkerCount: number
): AtlasShellAssessment {
  return { ready, routeKind, readyReason, lobbyActionCount, lobbyPlayActionCount, lobbyPlaySurfaceCount, authMarkerCount, gameMarkerCount };
}

function atlasShellRouteKind(hostname: string, pathname: string): AtlasShellRouteKind {
  if (hostname !== "play.riftatlas.com" && hostname.endsWith(".riftatlas.com")) {
    return "auth";
  }
  if (/^\/(?:sign-in|sign-up)(?:\/|$)/i.test(pathname)) {
    return "auth";
  }
  if (pathname === "/" || pathname === "/lobby") {
    return "lobby";
  }
  if (/^\/(?:game|play|room)(?:\/|$)/i.test(pathname)) {
    return "game";
  }
  return "other";
}

function isAtlasAuthTransition(hostname: string, pathname: string): boolean {
  return (hostname !== "play.riftatlas.com" && hostname.endsWith(".riftatlas.com")) ||
    /(?:sso-callback|oauth_callback)(?:\/|$)/i.test(pathname);
}

function normalizePathname(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function stripAtlasLocalePrefix(pathname: string): string {
  const localized = pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/i, "");
  return localized || "/";
}

function markerCount(text: string, markers: RegExp[]): number {
  return markers.reduce((count, marker) => count + (marker.test(text) ? 1 : 0), 0);
}
