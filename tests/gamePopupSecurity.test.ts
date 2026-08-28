import { describe, expect, it, vi } from "vitest";
import {
  clearAtlasClerkAuthCookies,
  clearAtlasClerkSessionTokenCache,
  gamePopupBrowserWindowOptions,
  gamePopupSharesParentSession,
  isAtlasClerkAuthCookie,
  isAtlasClerkAuthorizationFailureNavigation,
  isAtlasClerkAuthorizationInvalidPage
} from "../src/main/services/gamePopupSecurity.js";

describe("game popup security", () => {
  it("keeps OAuth popups in the embedded game's persistent session", () => {
    const session = { name: "atlas" } as unknown as Parameters<typeof gamePopupBrowserWindowOptions>[0];
    const options = gamePopupBrowserWindowOptions(session);

    expect(options.webPreferences?.session).toBe(session);
    expect(options.webPreferences).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    });
  });

  it("fails closed when Electron creates a popup in another session", () => {
    const parentSession = {};
    expect(gamePopupSharesParentSession(
      { session: parentSession } as never,
      { session: parentSession } as never
    )).toBe(true);
    expect(gamePopupSharesParentSession(
      { session: parentSession } as never,
      { session: {} } as never
    )).toBe(false);
  });

  it("recognizes only Clerk authorization failures served from the Atlas Clerk origin", () => {
    const response = JSON.stringify({
      errors: [{
        message: "Unauthorized request",
        long_message: "You are not authorized to perform this request",
        code: "authorization_invalid"
      }],
      clerk_trace_id: "trace-id"
    });

    expect(isAtlasClerkAuthorizationInvalidPage(
      "https://clerk.riftatlas.com/v1/oauth_callback?state=redacted",
      response
    )).toBe(true);
    expect(isAtlasClerkAuthorizationInvalidPage(
      "https://accounts.riftatlas.com/v1/oauth_callback?state=redacted",
      response
    )).toBe(true);
    expect(isAtlasClerkAuthorizationInvalidPage("https://attacker.example/", response)).toBe(false);
    expect(isAtlasClerkAuthorizationInvalidPage(
      "https://clerk.riftatlas.com/v1/oauth_callback",
      JSON.stringify({ errors: [{ code: "authentication_invalid" }] })
    )).toBe(false);
    expect(isAtlasClerkAuthorizationInvalidPage("https://clerk.riftatlas.com/v1/oauth_callback", "not json"))
      .toBe(false);
  });

  it("recognizes the failed Atlas Clerk OAuth callback from its main-frame HTTP status", () => {
    expect(isAtlasClerkAuthorizationFailureNavigation(
      "https://clerk.riftatlas.com/v1/oauth_callback?state=redacted",
      403
    )).toBe(true);
    expect(isAtlasClerkAuthorizationFailureNavigation(
      "https://accounts.riftatlas.com/v1/oauth_callback?state=redacted",
      403
    )).toBe(true);
    expect(isAtlasClerkAuthorizationFailureNavigation(
      "https://clerk.riftatlas.com/v1/oauth_callback?state=redacted",
      200
    )).toBe(false);
    expect(isAtlasClerkAuthorizationFailureNavigation(
      "https://clerk.riftatlas.com/v1/client",
      403
    )).toBe(false);
    expect(isAtlasClerkAuthorizationFailureNavigation(
      "https://attacker.example/v1/oauth_callback",
      403
    )).toBe(false);
  });

  it("limits sign-in repair to Clerk authentication cookies on RiftAtlas domains", () => {
    expect(isAtlasClerkAuthCookie({ domain: ".clerk.riftatlas.com", name: "__client" })).toBe(true);
    expect(isAtlasClerkAuthCookie({ domain: "accounts.riftatlas.com", name: "__session" })).toBe(true);
    expect(isAtlasClerkAuthCookie({ domain: ".riftatlas.com", name: "__client_uat_Zp57a2iF" })).toBe(true);
    expect(isAtlasClerkAuthCookie({ domain: "play.riftatlas.com", name: "__session" })).toBe(true);
    expect(isAtlasClerkAuthCookie({ domain: "play.riftatlas.com", name: "__session_Zp57a2iF" })).toBe(true);
    expect(isAtlasClerkAuthCookie({ domain: "play.riftatlas.com", name: "__refresh_Zp57a2iF" })).toBe(true);
    expect(isAtlasClerkAuthCookie({ domain: ".clerk.riftatlas.com", name: "__cf_bm" })).toBe(false);
    expect(isAtlasClerkAuthCookie({ domain: ".example.com", name: "__client" })).toBe(false);
  });

  it("removes only targeted Atlas Clerk cookies and refreshes the network session", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const flushStorageData = vi.fn();
    const closeAllConnections = vi.fn().mockResolvedValue(undefined);
    const session = {
      cookies: {
        get: vi.fn().mockResolvedValue([
          { domain: ".clerk.riftatlas.com", name: "__client" },
          { domain: ".riftatlas.com", name: "__client_uat" },
          { domain: "play.riftatlas.com", name: "__session_Zp57a2iF", path: "/v1/session" },
          { domain: "play.riftatlas.com", name: "__refresh_Zp57a2iF" },
          { domain: ".clerk.riftatlas.com", name: "__cf_bm" },
          { domain: ".example.com", name: "__client" }
        ]),
        remove
      },
      flushStorageData,
      closeAllConnections
    };

    await expect(clearAtlasClerkAuthCookies(session as never)).resolves.toEqual({
      found: 4,
      removed: 4,
      failed: 0
    });
    expect(remove).toHaveBeenCalledTimes(4);
    expect(remove).toHaveBeenCalledWith("https://clerk.riftatlas.com/", "__client");
    expect(remove).toHaveBeenCalledWith("https://riftatlas.com/", "__client_uat");
    expect(remove).toHaveBeenCalledWith("https://play.riftatlas.com/v1/session", "__session_Zp57a2iF");
    expect(remove).toHaveBeenCalledWith("https://play.riftatlas.com/", "__refresh_Zp57a2iF");
    expect(flushStorageData).toHaveBeenCalledOnce();
    expect(closeAllConnections).toHaveBeenCalledTimes(2);
    expect(closeAllConnections.mock.invocationCallOrder[0]).toBeLessThan(
      session.cookies.get.mock.invocationCallOrder[0]!
    );
    expect(flushStorageData.mock.invocationCallOrder[0]).toBeLessThan(
      closeAllConnections.mock.invocationCallOrder[1]!
    );
  });

  it("continues sign-in repair when one targeted cookie cannot be removed", async () => {
    const remove = vi.fn((url: string, name: string) => name === "__session_broken"
      ? Promise.reject(new Error("cookie locked"))
      : Promise.resolve());
    const flushStorageData = vi.fn();
    const closeAllConnections = vi.fn().mockResolvedValue(undefined);
    const session = {
      cookies: {
        get: vi.fn().mockResolvedValue([
          { domain: ".clerk.riftatlas.com", name: "__client" },
          { domain: "accounts.riftatlas.com", name: "__session_broken" },
          { domain: "play.riftatlas.com", name: "__refresh_working" },
          { domain: ".example.com", name: "__client" }
        ]),
        remove
      },
      flushStorageData,
      closeAllConnections
    };

    await expect(clearAtlasClerkAuthCookies(session as never)).resolves.toEqual({
      found: 3,
      removed: 2,
      failed: 1
    });
    expect(remove).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledWith("https://clerk.riftatlas.com/", "__client");
    expect(remove).toHaveBeenCalledWith("https://accounts.riftatlas.com/", "__session_broken");
    expect(remove).toHaveBeenCalledWith("https://play.riftatlas.com/", "__refresh_working");
    expect(flushStorageData).toHaveBeenCalledOnce();
    expect(closeAllConnections).toHaveBeenCalledTimes(2);
  });

  it("still removes Clerk cookies when Electron cannot close or flush the network session", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const closeAllConnections = vi.fn().mockRejectedValue(new Error("network service unavailable"));
    const session = {
      cookies: {
        get: vi.fn().mockResolvedValue([
          { domain: "play.riftatlas.com", name: "__session", path: "/" }
        ]),
        remove
      },
      flushStorageData: vi.fn(() => { throw new Error("flush unavailable"); }),
      closeAllConnections
    };

    await expect(clearAtlasClerkAuthCookies(session as never)).resolves.toEqual({
      found: 1,
      removed: 1,
      failed: 0
    });
    expect(remove).toHaveBeenCalledWith("https://play.riftatlas.com/", "__session");
    expect(closeAllConnections).toHaveBeenCalledTimes(2);
  });

  it("refreshes only the in-memory Atlas Clerk token without returning it to RiftLite", async () => {
    const executeJavaScript = vi.fn().mockResolvedValue("cleared");
    const webContents = {
      executeJavaScript,
      isDestroyed: vi.fn().mockReturnValue(false)
    };

    await expect(clearAtlasClerkSessionTokenCache(webContents as never)).resolves.toBe("cleared");
    expect(executeJavaScript).toHaveBeenCalledOnce();
    const script = String(executeJavaScript.mock.calls[0]?.[0] ?? "");
    expect(script).toContain("clerk.session.clearCache()");
    expect(script).toContain("clerk.session.getToken({ skipCache: true })");
    expect(script).not.toContain("__session");
    expect(script).not.toContain("return refreshed");
  });

  it("does not execute Atlas token-cache recovery for a destroyed guest", async () => {
    const executeJavaScript = vi.fn();
    await expect(clearAtlasClerkSessionTokenCache({
      executeJavaScript,
      isDestroyed: () => true
    } as never)).resolves.toBe("unavailable");
    expect(executeJavaScript).not.toHaveBeenCalled();
  });
});
