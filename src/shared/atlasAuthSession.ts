export const ATLAS_INVALID_AUTH_SESSION_ERROR_CODE = "invalid_claims";

/**
 * RiftAtlas surfaces this message when its backend rejects the Clerk session
 * used by the embedded client. Keep the match deliberately narrow: this
 * signal can trigger removal of Atlas authentication cookies.
 */
export function isAtlasInvalidAuthSessionMessage(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return /^could not verify the signed-in session\s*\(\s*invalid_claims\s*\)\.?$/i.test(normalized);
}
