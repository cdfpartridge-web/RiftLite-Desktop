import { describe, expect, it, vi } from "vitest";
import {
  clearAtlasClerkAuthCookies,
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
          { domain: "play.riftatlas.com", name: "__session_Zp57a2iF" },
          { domain: "play.riftatlas.com", name: "__refresh_Zp57a2iF" },
          { domain: ".clerk.riftatlas.com", name: "__cf_bm" },
          { domain: ".example.com", name: "__client" }
        ]),
        remove
      },
      flushStorageData,
      closeAllConnections
    };

    await expect(clearAtlasClerkAuthCookies(session as never)).resolves.toBe(4);
    expect(remove).toHaveBeenCalledTimes(4);
    expect(remove).toHaveBeenCalledWith("https://clerk.riftatlas.com/", "__client");
    expect(remove).toHaveBeenCalledWith("https://riftatlas.com/", "__client_uat");
    expect(remove).toHaveBeenCalledWith("https://play.riftatlas.com/", "__session_Zp57a2iF");
    expect(remove).toHaveBeenCalledWith("https://play.riftatlas.com/", "__refresh_Zp57a2iF");
    expect(flushStorageData).toHaveBeenCalledOnce();
    expect(closeAllConnections).toHaveBeenCalledOnce();
  });
});
