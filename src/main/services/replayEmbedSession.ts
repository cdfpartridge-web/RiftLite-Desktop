import type { ReplayEmbedSessionResult } from "../../shared/types.js";

export const RIFTLITE_REPLAY_ORIGIN = "https://www.riftlite.com";
export const RIFTLITE_REPLAY_PARTITION = "persist:riftlite-replay";
export const RIFTLITE_REPLAY_EMBED_COOKIE = "riftlite_replay_session";

const RIFTLITE_REPLAY_EMBED_SESSION_ENDPOINT = `${RIFTLITE_REPLAY_ORIGIN}/api/v2/replay-embed-session`;
const RIFTLITE_REPLAY_LIBRARY_EMBED_URL = `${RIFTLITE_REPLAY_ORIGIN}/replays/embed?embed=1`;
const REPLAY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface ReplayEmbedElectronSession {
  clearStorageData(options: { storages: Array<"cookies"> }): Promise<void>;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  cookies: {
    get(filter: { url: string; name: string }): Promise<Array<{ name: string; httpOnly?: boolean; secure?: boolean }>>;
  };
}

export function replayEmbedPermissionCheckAllowed(
  permission: string,
  mediaType?: string
): boolean {
  if (permission === "clipboard-sanitized-write" || permission === "fullscreen") {
    return true;
  }
  return permission === "media" && (mediaType === "video" || mediaType === "unknown");
}

export function replayEmbedPermissionRequestAllowed(permission: string): boolean {
  return permission === "display-capture" ||
    permission === "clipboard-sanitized-write" ||
    permission === "fullscreen";
}

export async function clearReplayEmbedCookies(session: ReplayEmbedElectronSession): Promise<void> {
  await session.clearStorageData({ storages: ["cookies"] });
}

export async function prepareReplayEmbedSession(
  replayId: string,
  session: ReplayEmbedElectronSession,
  refreshLinkedIdToken: () => Promise<string | null>,
  isLinkedAccountAuthCurrent: () => boolean | Promise<boolean> = () => true
): Promise<ReplayEmbedSessionResult> {
  const normalizedReplayId = replayId.trim();
  if (!REPLAY_ID_PATTERN.test(normalizedReplayId)) {
    throw new Error("Replay ID is invalid.");
  }
  const url = new URL(`/replays/${encodeURIComponent(normalizedReplayId)}?embed=1`, RIFTLITE_REPLAY_ORIGIN).toString();

  return prepareReplayEmbedUrl(url, session, refreshLinkedIdToken, isLinkedAccountAuthCurrent);
}

export async function prepareReplayLibraryEmbedSession(
  session: ReplayEmbedElectronSession,
  refreshLinkedIdToken: () => Promise<string | null>,
  isLinkedAccountAuthCurrent: () => boolean | Promise<boolean> = () => true
): Promise<ReplayEmbedSessionResult> {
  return prepareReplayEmbedUrl(
    RIFTLITE_REPLAY_LIBRARY_EMBED_URL,
    session,
    refreshLinkedIdToken,
    isLinkedAccountAuthCurrent
  );
}

async function prepareReplayEmbedUrl(
  url: string,
  session: ReplayEmbedElectronSession,
  refreshLinkedIdToken: () => Promise<string | null>,
  isLinkedAccountAuthCurrent: () => boolean | Promise<boolean>
): Promise<ReplayEmbedSessionResult> {

  // This dedicated partition contains replay cookies only. Clearing before every
  // bootstrap prevents an account switch from inheriting another account's session.
  await clearReplayEmbedCookies(session);
  const idToken = await refreshLinkedIdToken().catch(() => null);
  if (!idToken || !(await isLinkedAccountAuthCurrent())) {
    if (idToken) {
      await clearReplayEmbedCookies(session).catch(() => undefined);
    }
    return { url, authenticated: false };
  }

  try {
    if (!(await isLinkedAccountAuthCurrent())) {
      throw new Error("The linked RiftLite account changed during replay authentication.");
    }
    const response = await session.fetch(RIFTLITE_REPLAY_EMBED_SESSION_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "Accept": "application/json"
      },
      credentials: "include",
      cache: "no-store",
      redirect: "error"
    });
    if (!response.ok) {
      throw new Error(`Replay embed session failed (${response.status}).`);
    }
    if (!(await isLinkedAccountAuthCurrent())) {
      throw new Error("The linked RiftLite account changed during replay authentication.");
    }
    const cookies = await session.cookies.get({
      url: RIFTLITE_REPLAY_ORIGIN,
      name: RIFTLITE_REPLAY_EMBED_COOKIE
    });
    if (!cookies.some((cookie) => (
      cookie.name === RIFTLITE_REPLAY_EMBED_COOKIE && cookie.httpOnly === true && cookie.secure === true
    ))) {
      throw new Error("A secure replay embed session cookie was not stored.");
    }
    if (!(await isLinkedAccountAuthCurrent())) {
      throw new Error("The linked RiftLite account changed during replay authentication.");
    }
    return { url, authenticated: true };
  } catch (error) {
    await clearReplayEmbedCookies(session).catch(() => undefined);
    return {
      url,
      authenticated: false,
      error: error instanceof Error ? error.message : "Replay embed session failed."
    };
  }
}
