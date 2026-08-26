import { describe, expect, it } from "vitest";

import {
  ATLAS_EMPTY_SHELL_MIN_AGE_MS,
  ATLAS_PERSISTENT_EMPTY_SHELL_MIN_AGE_MS,
  ATLAS_PERSISTENT_EMPTY_SHELL_RETRY_AGE_MS,
  ATLAS_SHELL_MONITOR_INTERVAL_MS,
  ATLAS_SHELL_READY_STABILITY_MS,
  ATLAS_STALLED_SHELL_MIN_AGE_MS,
  assessAtlasShell,
  atlasShellRecoveryRouteTransition,
  isAtlasAuthSurfaceEvidence,
  isAtlasShellRecoveryRoute,
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
  lobbyPlaySurfaceCount: 0,
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

  it("rejects the advert-and-footer-only shell reported by v0.9.60 users", () => {
    const result = assess({
      visibleText: "Shop TCGplayer Internationally Get all your cards in one package Shop Now RiftAtlas Convergence #3 Sep 19 Patch Notes Legal Notice Privacy Policy Terms of Service Contact",
      interactiveText: "Shop Now RiftAtlas Convergence #3 Patch Notes Legal Notice Privacy Policy Terms of Service Contact",
      interactiveCount: 24,
      gameSurfaceCount: 1
    });

    expect(result).toMatchObject({
      ready: false,
      routeKind: "lobby",
      readyReason: "none",
      lobbyPlayActionCount: 0,
      lobbyPlaySurfaceCount: 0
    });
  });

  it("requires a real play control instead of accepting a deck-only partial lobby", () => {
    const healthy = assess({
      visibleText: "Lobby Import Deck New Deck Choose Deck Host Room Solo Room Find Random Match Join / Spectate",
      interactiveText: "Import Deck New Deck Choose Deck Host Room Solo Room Find Random Match Join / Spectate",
      interactiveCount: 8,
      lobbyHeadingCount: 1
    });
    expect(healthy).toMatchObject({
      ready: true,
      routeKind: "lobby",
      readyReason: "lobby-content",
      lobbyPlayActionCount: 4
    });

    const partialLobby = assess({
      visibleText: "Play Riftbound online with private room codes. Player Shown to opponents Sideboard 0/10 Room Code Import Deck New Deck Choose Deck Edit Deck",
      interactiveText: "Import Deck New Deck Choose Deck Edit Deck Player",
      interactiveCount: 19
    });
    expect(partialLobby).toMatchObject({
      ready: false,
      routeKind: "lobby",
      readyReason: "none",
      lobbyActionCount: 3,
      lobbyPlayActionCount: 0,
      gameMarkerCount: 2
    });

    expect(assess({
      visibleText: "Player Shown to opponents Import Deck New Deck Choose Deck Edit Deck",
      interactiveText: "Import Deck New Deck Choose Deck Edit Deck Player",
      interactiveCount: 46,
      gameSurfaceCount: 40
    })).toMatchObject({
      ready: false,
      routeKind: "lobby",
      lobbyPlayActionCount: 0,
      lobbyPlaySurfaceCount: 0
    });
  });

  it("accepts localized lobby controls through Atlas's visible play surfaces", () => {
    expect(assess({
      pathname: "/zh-CN",
      visibleText: "大厅 玩家 对手可见",
      interactiveText: "导入套牌 新建套牌 选择套牌 匹配",
      interactiveCount: 8,
      lobbyPlaySurfaceCount: 4
    })).toMatchObject({
      ready: true,
      routeKind: "lobby",
      readyReason: "lobby-content",
      lobbyPlayActionCount: 0,
      lobbyPlaySurfaceCount: 4
    });
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

    expect(assess({
      pathname: "/zh-CN/sign-in",
      visibleText: "登录 电子邮件",
      interactiveText: "继续",
      authHeadingCount: 1,
      authFormCount: 1
    })).toMatchObject({ ready: true, routeKind: "auth", readyReason: "auth-content" });
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

  it("limits automatic recovery to locale-aware lobby and authentication routes", () => {
    for (const pathname of ["/", "/lobby", "/en", "/en/lobby", "/sign-in", "/zh-CN/sign-up"]) {
      expect(isAtlasShellRecoveryRoute("play.riftatlas.com", pathname), pathname).toBe(true);
    }
    expect(isAtlasShellRecoveryRoute("clerk.riftatlas.com", "/v1/oauth_callback")).toBe(true);

    for (const pathname of ["/decks", "/game/ROOM", "/play/ROOM", "/room/ROOM", "/en/game/ROOM"]) {
      expect(isAtlasShellRecoveryRoute("play.riftatlas.com", pathname), pathname).toBe(false);
    }
  });

  it("re-arms deadlines when an unready SPA returns from a game to the lobby", () => {
    const leftForGame = atlasShellRecoveryRouteTransition(true, false, false);
    expect(leftForGame).toEqual({ active: false, entered: false, shouldArmDeadlines: false });

    const returnedBlank = atlasShellRecoveryRouteTransition(leftForGame.active, true, false);
    expect(returnedBlank).toEqual({ active: true, entered: true, shouldArmDeadlines: true });

    expect(atlasShellRecoveryRouteTransition(false, true, true)).toEqual({
      active: true,
      entered: true,
      shouldArmDeadlines: false
    });
    expect(atlasShellRecoveryRouteTransition(true, true, false).shouldArmDeadlines).toBe(false);
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

  it("stages shell health checks without trusting a transient first render", () => {
    expect(ATLAS_STALLED_SHELL_MIN_AGE_MS).toBe(8_000);
    expect(ATLAS_EMPTY_SHELL_MIN_AGE_MS).toBe(18_000);
    expect(ATLAS_SHELL_READY_STABILITY_MS).toBe(3_000);
    expect(ATLAS_SHELL_MONITOR_INTERVAL_MS).toBe(5_000);
    expect(ATLAS_PERSISTENT_EMPTY_SHELL_MIN_AGE_MS).toBe(60_000);
    expect(ATLAS_PERSISTENT_EMPTY_SHELL_RETRY_AGE_MS).toBe(120_000);
  });
});
