import type { BrowserWindowConstructorOptions, Cookie, Session, WebContents } from "electron";

const ATLAS_CLERK_ORIGIN = "https://clerk.riftatlas.com";

type AtlasClerkCookieSession = Pick<Session, "cookies" | "closeAllConnections" | "flushStorageData">;

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
    if (url.origin !== ATLAS_CLERK_ORIGIN) {
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
      url.origin === ATLAS_CLERK_ORIGIN &&
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

export async function clearAtlasClerkAuthCookies(session: AtlasClerkCookieSession): Promise<number> {
  const cookies = (await session.cookies.get({})).filter(isAtlasClerkAuthCookie);
  await Promise.all(cookies.map((cookie) => {
    const domain = (cookie.domain ?? "").trim().replace(/^\./, "");
    return session.cookies.remove(`https://${domain}/`, cookie.name);
  }));
  session.flushStorageData();
  await session.closeAllConnections();
  return cookies.length;
}
