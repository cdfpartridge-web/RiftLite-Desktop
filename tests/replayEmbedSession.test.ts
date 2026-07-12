import { describe, expect, it, vi } from "vitest";
import {
  prepareReplayEmbedSession,
  prepareReplayLibraryEmbedSession,
  replayEmbedPermissionCheckAllowed,
  replayEmbedPermissionRequestAllowed,
  RIFTLITE_REPLAY_EMBED_COOKIE,
  type ReplayEmbedElectronSession
} from "../src/main/services/replayEmbedSession";

function replaySession(options: {
  response?: Response;
  cookies?: Array<{ name: string; httpOnly?: boolean; secure?: boolean }>;
} = {}): ReplayEmbedElectronSession & {
  clearStorageData: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
  cookies: { get: ReturnType<typeof vi.fn> };
} {
  return {
    clearStorageData: vi.fn(async () => undefined),
    fetch: vi.fn(async () => options.response ?? new Response(JSON.stringify({ ok: true }), { status: 200 })),
    cookies: {
      get: vi.fn(async () => options.cookies ?? [{
        name: RIFTLITE_REPLAY_EMBED_COOKIE,
        httpOnly: true,
        secure: true
      }])
    }
  };
}

describe("Replay embed session bootstrap", () => {
  it("allows only the narrow player permissions needed by Capture, Share, and fullscreen", () => {
    expect(replayEmbedPermissionCheckAllowed("media", "video")).toBe(true);
    expect(replayEmbedPermissionCheckAllowed("media", "audio")).toBe(false);
    expect(replayEmbedPermissionCheckAllowed("clipboard-sanitized-write")).toBe(true);
    expect(replayEmbedPermissionCheckAllowed("clipboard-read")).toBe(false);
    expect(replayEmbedPermissionCheckAllowed("fullscreen")).toBe(true);
    expect(replayEmbedPermissionRequestAllowed("display-capture")).toBe(true);
    expect(replayEmbedPermissionRequestAllowed("clipboard-sanitized-write")).toBe(true);
    expect(replayEmbedPermissionRequestAllowed("fullscreen")).toBe(true);
    expect(replayEmbedPermissionRequestAllowed("media")).toBe(false);
    expect(replayEmbedPermissionRequestAllowed("openExternal")).toBe(false);
  });

  it("uses the dedicated session fetch and returns only the cookie-authenticated player URL", async () => {
    const session = replaySession();
    const refreshToken = vi.fn(async () => "firebase-id-token-secret");

    const result = await prepareReplayEmbedSession("rl2_0123456789abcdef0123456789abcdef", session, refreshToken);

    expect(session.clearStorageData).toHaveBeenCalledOnce();
    expect(refreshToken).toHaveBeenCalledOnce();
    expect(session.fetch).toHaveBeenCalledWith(
      "https://www.riftlite.com/api/v2/replay-embed-session",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        headers: expect.objectContaining({ Authorization: "Bearer firebase-id-token-secret" })
      })
    );
    expect(session.cookies.get).toHaveBeenCalledWith({
      url: "https://www.riftlite.com",
      name: RIFTLITE_REPLAY_EMBED_COOKIE
    });
    expect(result).toEqual({
      url: "https://www.riftlite.com/replays/rl2_0123456789abcdef0123456789abcdef?embed=1",
      authenticated: true
    });
    expect(JSON.stringify(result)).not.toContain("firebase-id-token-secret");
  });

  it("bootstraps the fixed account library route without exposing the account token", async () => {
    const session = replaySession();

    const result = await prepareReplayLibraryEmbedSession(
      session,
      async () => "firebase-library-token"
    );

    expect(result).toEqual({
      url: "https://www.riftlite.com/replays/embed?embed=1",
      authenticated: true
    });
    expect(JSON.stringify(result)).not.toContain("firebase-library-token");
  });

  it("clears stale cookies and falls back to public or unlisted viewing without an account", async () => {
    const session = replaySession();

    const result = await prepareReplayEmbedSession("rl2_public", session, async () => null);

    expect(session.clearStorageData).toHaveBeenCalledOnce();
    expect(session.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({
      url: "https://www.riftlite.com/replays/rl2_public?embed=1",
      authenticated: false
    });
  });

  it("fails closed and removes cookies when the bootstrap cookie is not stored", async () => {
    const session = replaySession({ cookies: [] });

    const result = await prepareReplayEmbedSession("rl2_private", session, async () => "id-token");

    expect(session.clearStorageData).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      url: "https://www.riftlite.com/replays/rl2_private?embed=1",
      authenticated: false,
      error: "A secure replay embed session cookie was not stored."
    });
  });

  it("clears a cookie set by an authentication request that races an account switch", async () => {
    const session = replaySession();
    let authCurrent = true;
    session.fetch.mockImplementation(async () => {
      authCurrent = false;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const result = await prepareReplayEmbedSession(
      "rl2_private",
      session,
      async () => "old-account-token",
      () => authCurrent
    );

    expect(session.clearStorageData).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      authenticated: false,
      error: "The linked RiftLite account changed during replay authentication."
    });
    expect(JSON.stringify(result)).not.toContain("old-account-token");
  });

  it("rejects replay IDs that could alter the exact player route", async () => {
    const session = replaySession();

    await expect(prepareReplayEmbedSession("../account", session, async () => null))
      .rejects.toThrow("Replay ID is invalid.");
    expect(session.fetch).not.toHaveBeenCalled();
  });
});
