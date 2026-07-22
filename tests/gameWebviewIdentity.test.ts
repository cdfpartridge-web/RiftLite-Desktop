import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { gamePlatformForTrustedUrl } from "../src/shared/embeddedContentSecurity.js";
import {
  gameWebviewPlatformArgument,
  parseGameWebviewPlatformArgument,
  resolveGameWebviewPlatformIdentity
} from "../src/shared/gameWebviewIdentity.js";

function identityFor(platformArguments: readonly string[], pageUrl: string, allowSimulator = false) {
  return resolveGameWebviewPlatformIdentity(
    platformArguments,
    gamePlatformForTrustedUrl(pageUrl, allowSimulator)
  );
}

describe("game WebView platform identity", () => {
  it("keeps main-process injection and preload parsing wired together", () => {
    const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
    const preloadSource = readFileSync(new URL("../src/game-preload/gamePreload.ts", import.meta.url), "utf8");

    expect(mainSource).toMatch(
      /webPreferences\.additionalArguments\s*=\s*policy\.kind\s*===\s*"game"\s*\?\s*\[gameWebviewPlatformArgument\(policy\.platform\)\]/
    );
    expect(preloadSource).toMatch(
      /resolveGameWebviewPlatformIdentity\(\s*process\.argv,\s*gamePlatformForTrustedUrl\(location\.href,\s*true\)\s*\)/
    );
  });

  it("round-trips every supported platform argument", () => {
    expect(parseGameWebviewPlatformArgument([gameWebviewPlatformArgument("atlas")])).toBe("atlas");
    expect(parseGameWebviewPlatformArgument([gameWebviewPlatformArgument("tcga")])).toBe("tcga");
    expect(parseGameWebviewPlatformArgument([gameWebviewPlatformArgument("sim")])).toBe("sim");
  });

  it("keeps Atlas identity through same-window OAuth navigation", () => {
    const atlasArgument = [gameWebviewPlatformArgument("atlas")];

    expect(identityFor(atlasArgument, "https://play.riftatlas.com/sign-in")).toBe("atlas");
    expect(identityFor(atlasArgument, "https://accounts.google.com/o/oauth2/v2/auth")).toBe("atlas");
    expect(identityFor(atlasArgument, "https://clerk.riftatlas.com/v1/oauth_callback")).toBe("atlas");
  });

  it("does not let later navigation replace the immutable argument identity", () => {
    expect(identityFor(
      [gameWebviewPlatformArgument("atlas")],
      "https://www.tcg-arena.fr/play"
    )).toBe("atlas");
  });

  it("uses strict trusted provider URLs only when no argument was supplied", () => {
    expect(identityFor([], "https://play.riftatlas.com/game/ROOM")).toBe("atlas");
    expect(identityFor([], "https://www.tcg-arena.fr/play")).toBe("tcga");
    expect(identityFor([], "https://evil.example/?next=play.riftatlas.com")).toBeNull();
  });

  it("identifies the development simulator without misclassifying it as TCGA", () => {
    expect(identityFor([gameWebviewPlatformArgument("sim")], "http://127.0.0.1:5174/")).toBe("sim");
    expect(identityFor([], "http://localhost:5174/", true)).toBe("sim");
    expect(identityFor([], "http://localhost:5174/", false)).toBeNull();
  });

  it("fails closed for malformed or conflicting identity arguments", () => {
    expect(identityFor(["--riftlite-game-platform=other"], "https://play.riftatlas.com/")).toBeNull();
    expect(identityFor([
      gameWebviewPlatformArgument("atlas"),
      gameWebviewPlatformArgument("tcga")
    ], "https://play.riftatlas.com/")).toBeNull();
  });
});
