import type { AccountProfile, UserSettings } from "./types.js";

export type RiftLiteAccountState = "local" | "linking" | "needs-profile" | "ready" | "reconnect";

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
