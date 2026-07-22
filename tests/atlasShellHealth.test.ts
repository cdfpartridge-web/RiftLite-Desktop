import { describe, expect, it } from "vitest";

import {
  assessAtlasShell,
  atlasVisibleEmptyCheckDelay,
  isAtlasAuthSurfaceEvidence,
  shouldReportAtlasEmptyShell,
  type AtlasShellEvidence
} from "../src/shared/atlasShellHealth.js";

const BASE_EVIDENCE: AtlasShellEvidence = {
  hostname: "play.riftatlas.com",
  pathname: "/",
  visibleText: "",
  interactiveText: "",
  interactiveCount: 0,
  gameSurfaceCount: 0,
  lobbyHeadingCount: 0,
  authHeadingCount: 0,
  authFormCount: 0
};

function assess(overrides: Partial<AtlasShellEvidence>) {
  return assessAtlasShell({ ...BASE_EVIDENCE, ...overrides });
}

describe("RiftAtlas shell health", () => {
  it("does not mistake ad, promo, and footer controls for a mounted lobby", () => {
    const result = assess({
      visibleText: "RiftAtlas Convergence #1 Jul 19 Sign in Discord Privacy Terms",
      interactiveText: "Sign in Discord Privacy Terms Learn more View event",
      interactiveCount: 19
    });

    expect(result).toMatchObject({ ready: false, routeKind: "lobby", readyReason: "none" });
    expect(shouldReportAtlasEmptyShell(result, true, false)).toBe(true);
    expect(shouldReportAtlasEmptyShell(result, false, false)).toBe(false);
    expect(shouldReportAtlasEmptyShell(result, true, true)).toBe(false);
  });

  it("requires a real lobby heading and action or multiple lobby actions", () => {
    expect(assess({
      visibleText: "Lobby Import Deck New Deck Choose Deck Host Room Solo Room Find Random Match Join / Spectate",
      interactiveText: "Import Deck New Deck Choose Deck Host Room Solo Room Find Random Match Join / Spectate",
      interactiveCount: 8,
      lobbyHeadingCount: 1
    })).toMatchObject({ ready: true, routeKind: "lobby", readyReason: "lobby-content" });

    expect(assess({
      visibleText: "Import Deck Choose Deck",
      interactiveText: "Import Deck Choose Deck",
      interactiveCount: 2
    }).ready).toBe(true);
  });

  it("does not accept navigation labels alone as lobby evidence", () => {
    expect(assess({
      visibleText: "Lobby Match History Sign in",
      interactiveText: "Lobby Match History Sign in",
      interactiveCount: 7
    }).ready).toBe(false);
  });

  it("treats the explicit lobby route as a lobby rather than a game", () => {
    expect(assess({
      pathname: "/lobby",
      visibleText: "Lobby Host Room",
      interactiveText: "Host Room",
      lobbyHeadingCount: 1
    })).toMatchObject({ ready: true, routeKind: "lobby", readyReason: "lobby-content" });
  });

  it("accepts a rendered sign-in form but not a lone sign-in navigation link", () => {
    expect(assess({
      pathname: "/sign-in",
      visibleText: "Sign in Email address Continue",
      interactiveText: "Continue",
      interactiveCount: 5,
      authHeadingCount: 1,
      authFormCount: 1
    })).toMatchObject({ ready: true, routeKind: "auth", readyReason: "auth-content" });

    expect(assess({
      pathname: "/sign-in",
      visibleText: "Sign in Sign up Discord Privacy Terms",
      interactiveText: "Sign in Sign up Discord Privacy Terms",
      interactiveCount: 8
    }).ready).toBe(false);
  });

  it("does not treat a newsletter email form as an authentication surface", () => {
    expect(isAtlasAuthSurfaceEvidence({
      isClerkSurface: false,
      hasPasswordInput: false,
      hasOneTimeCodeInput: false,
      hasIdentifierInput: true,
      text: "Sign up for the newsletter"
    })).toBe(false);
    expect(isAtlasAuthSurfaceEvidence({
      isClerkSurface: false,
      hasPasswordInput: false,
      hasOneTimeCodeInput: false,
      hasIdentifierInput: true,
      text: "Sign in with your email address"
    })).toBe(true);
  });

  it("does not interrupt trusted OAuth callback transitions", () => {
    expect(assess({
      hostname: "clerk.riftatlas.com",
      pathname: "/v1/oauth_callback"
    })).toMatchObject({ ready: true, routeKind: "auth", readyReason: "auth-transition" });

    expect(assess({ pathname: "/sign-in/sso-callback" })).toMatchObject({
      ready: true,
      routeKind: "auth",
      readyReason: "auth-transition"
    });
  });

  it("accepts a match surface or route-specific waiting room text", () => {
    expect(assess({ pathname: "/game/ROOM-1", gameSurfaceCount: 1 })).toMatchObject({
      ready: true,
      routeKind: "game",
      readyReason: "game-content"
    });

    expect(assess({
      pathname: "/game/ROOM-1",
      visibleText: "Room code ROOM-1 Waiting for opponent",
      interactiveText: "Leave room",
      interactiveCount: 4
    })).toMatchObject({ ready: true, routeKind: "game", readyReason: "game-content" });

    expect(assess({
      pathname: "/game/ROOM-1",
      visibleText: "Loading game board..."
    })).toMatchObject({ ready: true, routeKind: "game", readyReason: "game-content" });
  });

  it("keeps a control-heavy but empty game route unhealthy", () => {
    expect(assess({
      pathname: "/game/ROOM-1",
      visibleText: "RiftAtlas Convergence Discord Privacy Terms",
      interactiveText: "Discord Privacy Terms View event Learn more",
      interactiveCount: 12
    })).toMatchObject({ ready: false, routeKind: "game", readyReason: "none" });
  });

  it("waits for the original eight-second budget after becoming visible", () => {
    expect(atlasVisibleEmptyCheckDelay(2_000)).toBe(6_000);
    expect(atlasVisibleEmptyCheckDelay(18_000)).toBe(500);
    expect(atlasVisibleEmptyCheckDelay(Number.NaN)).toBe(8_000);
  });
});
