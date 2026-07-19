import type { AccountProfile, UserSettings } from "./types.js";

export type RiftLiteAccountState = "local" | "linking" | "needs-profile" | "ready" | "reconnect";

export function resolveCompletedAccountLinkUid(
  reportedUid: unknown,
  authenticatedUid: unknown
): string {
  const reported = String(reportedUid ?? "").trim();
  const authenticated = String(authenticatedUid ?? "").trim();
  if (!authenticated || (reported && reported !== authenticated)) {
    return "";
  }
  // The successfully exchanged Firebase custom token is authoritative. Older
  // or partially deployed status endpoints may omit the redundant uid field.
  return reported || authenticated;
}

export function linkedAccountAuthUidMatches(
  settings: Pick<UserSettings, "accountUid" | "firebaseUid">,
  authenticatedUid: unknown
): boolean {
  const authenticated = String(authenticatedUid ?? "").trim();
  if (!settings.accountUid) return true;
  return Boolean(authenticated && [settings.accountUid, settings.firebaseUid]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .includes(authenticated));
}

export function verifiedAccountConnectionUid(
  storedAccountUid: unknown,
  reportedCanonicalUid: unknown,
  authenticatedUid: unknown,
  identityUids: unknown
): string {
  const stored = String(storedAccountUid ?? "").trim();
  const canonical = String(reportedCanonicalUid ?? "").trim();
  const authenticated = String(authenticatedUid ?? "").trim();
  const aliases = new Set(Array.isArray(identityUids)
    ? identityUids.map((value) => String(value ?? "").trim()).filter(Boolean)
    : []);
  if (!stored || !canonical || !authenticated) return "";
  aliases.add(canonical);
  return aliases.has(stored) && aliases.has(authenticated) ? canonical : "";
}

export function isGenericAccountDisplayName(value: unknown): boolean {
  const cleaned = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return !cleaned || cleaned === "riftlite player" || cleaned === "riftlite user" || /^player(?:[ #_-]|$)/.test(cleaned);
}

export function hasCompleteAccountProfile(
  settings: Pick<UserSettings, "accountHandle" | "accountDisplayName">,
  profile?: Pick<AccountProfile, "handle" | "displayName"> | null
): boolean {
  const handle = String(profile?.handle || settings.accountHandle || "").trim();
  const displayName = String(profile?.displayName || settings.accountDisplayName || "").trim();
  return Boolean(handle && !isGenericAccountDisplayName(displayName));
}

export function getRiftLiteAccountState(
  settings: Pick<UserSettings, "accountUid" | "firebaseRefreshToken" | "accountHandle" | "accountDisplayName">,
  profile?: Pick<AccountProfile, "handle" | "displayName"> | null,
  linking = false
): RiftLiteAccountState {
  if (linking) return "linking";
  if (!settings.accountUid) return "local";
  if (!settings.firebaseRefreshToken) return "reconnect";
  return hasCompleteAccountProfile(settings, profile) ? "ready" : "needs-profile";
}
