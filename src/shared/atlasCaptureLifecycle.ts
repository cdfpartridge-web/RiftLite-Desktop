function normalizeAtlasRoomCode(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{3,16}$/.test(normalized) ? normalized : "";
}

export const ATLAS_INACTIVE_END_GRACE_MS = 30_000;
export const ATLAS_CONFIRMED_FORMAT_LANDING_GRACE_MS = 2_000;

function atlasUrl(value: unknown): URL | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isAtlasRootLandingUrl(value: unknown): boolean {
  const parsed = atlasUrl(value);
  return Boolean(
    parsed &&
    parsed.hostname.toLowerCase() === "play.riftatlas.com" &&
    (parsed.pathname === "/" || parsed.pathname === "")
  );
}

export function isAtlasGameRouteUrl(value: unknown): boolean {
  const parsed = atlasUrl(value);
  return Boolean(
    parsed &&
    parsed.hostname.toLowerCase() === "play.riftatlas.com" &&
    (parsed.pathname === "/game" || parsed.pathname.startsWith("/game/"))
  );
}

/**
 * Atlas briefly replaces the board while opening pickers and other in-game
 * overlays, so unexplained inactivity needs a generous debounce. A confirmed
 * BO1 or BO3 snapshot on Atlas's root landing page is different. Emit the end
 * promptly; the main-process series tracker still decides whether a BO3 is
 * complete or should remain open for its next game.
 */
export function atlasInactiveEndGraceMs(url: unknown, format: unknown): number {
  const normalizedFormat = typeof format === "string" ? format.trim().toLowerCase() : "";
  if (!/^(?:bo1|bo3)$/.test(normalizedFormat)) {
    return ATLAS_INACTIVE_END_GRACE_MS;
  }
  return isAtlasRootLandingUrl(url)
    ? ATLAS_CONFIRMED_FORMAT_LANDING_GRACE_MS
    : ATLAS_INACTIVE_END_GRACE_MS;
}

type AtlasOverlayDescriptor = {
  role?: unknown;
  ariaModal?: unknown;
  id?: unknown;
  classes?: unknown;
  title?: unknown;
  ariaLabel?: unknown;
  text?: unknown;
};

function atlasOverlayDescriptorText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 1_000) : "";
}

export function isAtlasTransientOverlayDescriptor(value: AtlasOverlayDescriptor): boolean {
  const role = atlasOverlayDescriptorText(value.role).toLowerCase();
  const ariaModal = atlasOverlayDescriptorText(value.ariaModal).toLowerCase();
  const identity = [
    value.id,
    value.classes,
    value.title,
    value.ariaLabel
  ].map(atlasOverlayDescriptorText).join(" ");
  const text = atlasOverlayDescriptorText(value.text);
  const searchable = `${identity} ${text}`.replace(/\s+/g, " ").trim();
  const hasOverlayStructure =
    /^(?:dialog|listbox|menu)$/.test(role) ||
    ariaModal === "true" ||
    /(?:modal|dialog|drawer|popover|popper|picker|overlay)/i.test(identity) ||
    /\b(?:choose|select|edit|set|add)\s+(?:a\s+)?label\b|\blabel\s+(?:picker|selector)\b/i.test(searchable);

  if (!hasOverlayStructure) {
    return false;
  }

  return !/\b(?:you win|you lose|you won|you lost|victory|defeat|winner|match complete|game over|return to lobby|back to lobby)\b/i.test(searchable);
}

export function isAtlasActiveRoomBoundary(
  previousActive: boolean,
  previousRoomCode: unknown,
  nextActive: boolean,
  nextRoomCode: unknown
): boolean {
  if (!previousActive || !nextActive) {
    return false;
  }
  const previous = normalizeAtlasRoomCode(previousRoomCode);
  const next = normalizeAtlasRoomCode(nextRoomCode);
  return Boolean(previous && next && previous !== next);
}
