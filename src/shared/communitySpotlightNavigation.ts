export function communitySpotlightTarget(
  requestedId: unknown,
  availableIds: readonly string[]
): string {
  const requested = typeof requestedId === "string" ? requestedId.trim() : "";
  return requested && availableIds.includes(requested) ? requested : "";
}
