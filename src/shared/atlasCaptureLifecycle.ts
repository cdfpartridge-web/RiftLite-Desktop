function normalizeAtlasRoomCode(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{3,16}$/.test(normalized) ? normalized : "";
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
