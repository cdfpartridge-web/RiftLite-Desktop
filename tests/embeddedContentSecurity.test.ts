import { describe, expect, it } from "vitest";
import {
  embeddedWebviewPolicy,
  gamePlatformForTrustedUrl,
  isAllowedEmbeddedNavigation,
  isAllowedGameMainFrameNavigation,
  isAllowedGamePopupNavigation,
  isSecurePopupNavigation,
  sameWebFrameIdentity
} from "../src/shared/embeddedContentSecurity.js";

describe("embedded content security", () => {
  it("matches Electron frames by stable process and routing IDs", () => {
    const mainFrame = { processId: 41, routingId: 9 };

    expect(sameWebFrameIdentity({ ...mainFrame }, mainFrame)).toBe(true);
    expect(sameWebFrameIdentity({ processId: 41, routingId: 10 }, mainFrame)).toBe(false);
    expect(sameWebFrameIdentity({ processId: 42, routingId: 9 }, mainFrame)).toBe(false);
    expect(sameWebFrameIdentity(undefined, mainFrame)).toBe(false);
  });

  it("matches game providers by parsed origin rather than URL substrings", () => {
    expect(gamePlatformForTrustedUrl("https://play.riftatlas.com/game/abc")).toBe("atlas");
    expect(gamePlatformForTrustedUrl("https://www.tcg-arena.fr/play")).toBe("tcga");
    expect(gamePlatformForTrustedUrl("https://evil.example/?next=play.riftatlas.com")).toBeNull();
    expect(gamePlatformForTrustedUrl("https://tcg-arena.fr.evil.example/")).toBeNull();
    expect(gamePlatformForTrustedUrl("https://play.riftatlas.com:8443/")).toBeNull();
    expect(gamePlatformForTrustedUrl("https://tcg-arena.fr:444/")).toBeNull();
  });

  it("requires the game URL and persistent partition to describe the same provider", () => {
    expect(embeddedWebviewPolicy(
      "https://play.riftatlas.com/",
      "persist:riftlite-atlas"
    )).toEqual({ kind: "game", platform: "atlas" });
    expect(embeddedWebviewPolicy(
      "https://evil.example/?riftatlas=1",
      "persist:riftlite-atlas"
    )).toBeNull();
    expect(embeddedWebviewPolicy(
      "https://play.riftatlas.com/",
      "persist:attacker-controlled"
    )).toBeNull();
  });

  it("allows only the configured YouTube video and Twitch channel in Home media partitions", () => {
    const youtube = embeddedWebviewPolicy(
      "https://www.youtube.com/embed/XPvo24lfN9A?autoplay=1",
      "persist:riftlite-home-video-XPvo24lfN9A"
    );
    expect(youtube).toEqual({ kind: "home-video", provider: "youtube", mediaId: "XPvo24lfN9A" });
    expect(youtube && isAllowedEmbeddedNavigation(youtube, "https://www.youtube.com/embed/other-video"))
      .toBe(false);

    const twitch = embeddedWebviewPolicy(
      "https://player.twitch.tv/?channel=bmucasts&parent=www.riftlite.com",
      "persist:riftlite-twitch-bmucasts"
    );
    expect(twitch).toEqual({ kind: "home-video", provider: "twitch", mediaId: "bmucasts" });
    expect(embeddedWebviewPolicy(
      "https://player.twitch.tv/?channel=another-channel",
      "persist:riftlite-twitch-bmucasts"
    )).toBeNull();
    expect(embeddedWebviewPolicy(
      "https://www.youtube.com:8443/embed/XPvo24lfN9A",
      "persist:riftlite-home-video-XPvo24lfN9A"
    )).toBeNull();
  });

  it("requires the fixed replay session and replay route", () => {
    expect(embeddedWebviewPolicy(
      "https://www.riftlite.com/replays/embed?embed=1",
      "persist:riftlite-replay"
    )).toEqual({ kind: "replay" });
    expect(embeddedWebviewPolicy(
      "https://www.riftlite.com/account",
      "persist:riftlite-replay"
    )).toBeNull();
    expect(embeddedWebviewPolicy(
      "https://www.riftlite.com/replays/embed?embed=1",
      "persist:other"
    )).toBeNull();
  });

  it("permits only default-port HTTPS or blank popup navigation", () => {
    expect(isSecurePopupNavigation("https://accounts.google.com/o/oauth2/v2/auth")).toBe(true);
    expect(isSecurePopupNavigation("https://accounts.google.com:8443/o/oauth2/v2/auth")).toBe(false);
    expect(isSecurePopupNavigation("about:blank")).toBe(true);
    expect(isSecurePopupNavigation("file:///C:/sensitive.txt")).toBe(false);
    expect(isSecurePopupNavigation("javascript:alert(1)")).toBe(false);
  });

  it("keeps only known OAuth providers inside sandboxed game popups", () => {
    const atlas = embeddedWebviewPolicy("https://play.riftatlas.com/", "persist:riftlite-atlas");
    const tcga = embeddedWebviewPolicy("https://tcg-arena.fr/", "persist:riftlite-tcga");
    if (atlas?.kind !== "game" || tcga?.kind !== "game") {
      throw new Error("Expected game policies");
    }

    expect(isAllowedGamePopupNavigation(atlas, "about:blank")).toBe(true);
    expect(isAllowedGamePopupNavigation(atlas, "https://accounts.google.com/o/oauth2/v2/auth")).toBe(true);
    expect(isAllowedGamePopupNavigation(atlas, "https://clerk.riftatlas.com/v1/oauth_callback")).toBe(true);
    expect(isAllowedGamePopupNavigation(atlas, "https://play.riftatlas.com/sign-in/sso-callback")).toBe(true);
    expect(isAllowedGamePopupNavigation(atlas, "https://attacker.example/phish")).toBe(false);
    expect(isAllowedGamePopupNavigation(atlas, "https://accounts.google.com:8443/phish")).toBe(false);

    expect(isAllowedGamePopupNavigation(tcga, "https://tcg-arena-62f15.firebaseapp.com/__/auth/handler")).toBe(true);
    expect(isAllowedGamePopupNavigation(tcga, "https://clerk.riftatlas.com/v1/oauth_callback")).toBe(false);
  });

  it("keeps same-window OAuth redirects in the embedded game's persistent session", () => {
    const atlas = embeddedWebviewPolicy("https://play.riftatlas.com/", "persist:riftlite-atlas");
    const tcga = embeddedWebviewPolicy("https://tcg-arena.fr/", "persist:riftlite-tcga");
    if (atlas?.kind !== "game" || tcga?.kind !== "game") {
      throw new Error("Expected game policies");
    }

    expect(isAllowedGameMainFrameNavigation(atlas, "https://play.riftatlas.com/sign-in")).toBe(true);
    expect(isAllowedGameMainFrameNavigation(atlas, "https://accounts.google.com/o/oauth2/auth")).toBe(true);
    expect(isAllowedGameMainFrameNavigation(atlas, "https://clerk.riftatlas.com/v1/oauth_callback")).toBe(true);
    expect(isAllowedGameMainFrameNavigation(atlas, "https://attacker.example/phish")).toBe(false);
    expect(isAllowedGameMainFrameNavigation(atlas, "https://accounts.google.com:8443/phish")).toBe(false);
    expect(isAllowedGameMainFrameNavigation(atlas, "about:blank")).toBe(false);

    expect(isAllowedGameMainFrameNavigation(tcga, "https://tcg-arena-62f15.firebaseapp.com/__/auth/handler")).toBe(true);
    expect(isAllowedGameMainFrameNavigation(tcga, "https://clerk.riftatlas.com/v1/oauth_callback")).toBe(false);
  });
});
