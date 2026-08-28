import type { BrowserWindowConstructorOptions, Cookie, Session, WebContents } from "electron";

const ATLAS_CLERK_ORIGINS = new Set([
  "https://clerk.riftatlas.com",
  "https://accounts.riftatlas.com"
]);

type AtlasClerkCookieSession = Pick<Session, "cookies" | "closeAllConnections" | "flushStorageData">;
type AtlasClerkPageWebContents = Pick<WebContents, "executeJavaScript" | "isDestroyed">;

export interface AtlasClerkCookieClearResult {
  found: number;
  removed: number;
  failed: number;
}

export type AtlasClerkTokenCacheClearResult = "cleared" | "signed-out" | "unavailable" | "failed";

/**
 * OAuth providers return to a callback that depends on cookies created by the
 * embedded game page. Keep the popup in that exact Electron session while
 * retaining the hardened renderer preferences.
 */
export function gamePopupBrowserWindowOptions(session: Session): BrowserWindowConstructorOptions {
  return {
    autoHideMenuBar: true,
    webPreferences: {
      session,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  };
}

export function gamePopupSharesParentSession(
  parent: Pick<WebContents, "session">,
  popup: Pick<WebContents, "session">
): boolean {
  return popup.session === parent.session;
}

export function isAtlasClerkAuthorizationInvalidPage(urlValue: string, bodyText: string): boolean {
  try {
    const url = new URL(urlValue);
    if (!ATLAS_CLERK_ORIGINS.has(url.origin)) {
      return false;
    }
    const payload = JSON.parse(bodyText) as { errors?: Array<{ code?: unknown }> };
    return Array.isArray(payload.errors) && payload.errors.some((error) => error?.code === "authorization_invalid");
  } catch {
    return false;
  }
}

export function isAtlasClerkAuthorizationFailureNavigation(urlValue: string, statusCode: number): boolean {
  try {
    const url = new URL(urlValue);
    return statusCode === 403 &&
      ATLAS_CLERK_ORIGINS.has(url.origin) &&
      url.pathname === "/v1/oauth_callback";
  } catch {
    return false;
  }
}

export function isAtlasClerkAuthCookie(cookie: Pick<Cookie, "domain" | "name">): boolean {
  const domain = (cookie.domain ?? "").trim().toLowerCase().replace(/^\./, "");
  const belongsToAtlas = domain === "riftatlas.com" || domain.endsWith(".riftatlas.com");
  if (!belongsToAtlas) {
    return false;
  }
  return cookie.name === "__client" ||
    cookie.name.startsWith("__client_") ||
    cookie.name === "__session" ||
    cookie.name.startsWith("__session_") ||
    cookie.name === "__refresh" ||
    cookie.name.startsWith("__refresh_") ||
    cookie.name.startsWith("__clerk");
}

export async function clearAtlasClerkAuthCookies(session: AtlasClerkCookieSession): Promise<AtlasClerkCookieClearResult> {
  // Stop responses that can carry replacement Clerk cookies before enumerating
  // and removing the rejected session. A final connection close prevents an
  // already queued request from immediately recreating it after the flush.
  await session.closeAllConnections().catch(() => undefined);
  const cookies = (await session.cookies.get({})).filter(isAtlasClerkAuthCookie);
  const removals = await Promise.allSettled(cookies.map((cookie) => {
    const domain = (cookie.domain ?? "").trim().replace(/^\./, "");
    const path = cookie.path?.startsWith("/") ? cookie.path : "/";
    return session.cookies.remove(`https://${domain}${path}`, cookie.name);
  }));
  try {
    session.flushStorageData();
  } catch {
    // Cookie removals have already settled; a later Electron flush will persist
    // them even if this best-effort synchronous flush is unavailable.
  }
  await session.closeAllConnections().catch(() => undefined);
  const removed = removals.filter((result) => result.status === "fulfilled").length;
  return {
    found: cookies.length,
    removed,
    failed: cookies.length - removed
  };
}

/**
 * Drops only Clerk's in-memory JWT cache inside the Atlas page, then asks Clerk
 * to mint a fresh short-lived token. The token never crosses the page boundary;
 * only a status string is returned. The durable client/login session, Atlas
 * decks, and every local preference remain untouched.
 */
export async function clearAtlasClerkSessionTokenCache(
  webContents: AtlasClerkPageWebContents,
  timeoutMs = 8_000
): Promise<AtlasClerkTokenCacheClearResult> {
  if (webContents.isDestroyed()) {
    return "unavailable";
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      webContents.executeJavaScript(`(async () => {
        const deadline = Date.now() + 6000;
        while (Date.now() < deadline && globalThis.Clerk?.loaded !== true) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const clerk = globalThis.Clerk;
        if (clerk?.loaded !== true) return "unavailable";
        if (!clerk.session) return "signed-out";
        if (typeof clerk.session.clearCache !== "function") return "unavailable";
        clerk.session.clearCache();
        if (typeof clerk.session.getToken !== "function") return "unavailable";
        const refreshed = await clerk.session.getToken({ skipCache: true });
        return typeof refreshed === "string" && refreshed.length > 0 ? "cleared" : "unavailable";
      })()`, true),
      new Promise<"unavailable">((resolve) => {
        timer = setTimeout(() => resolve("unavailable"), Math.max(250, timeoutMs));
      })
    ]);
    return result === "cleared" || result === "signed-out" || result === "unavailable"
      ? result
      : "failed";
  } catch {
    return "failed";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
