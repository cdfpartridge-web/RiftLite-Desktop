import { describe, expect, it } from "vitest";
import {
  embeddedWebviewPolicy,
  gamePlatformForTrustedUrl,
  isAllowedEmbeddedNavigation,
  isAllowedEmbeddedPermission,
  isAllowedGameMainFrameNavigation,
  isAllowedGamePopupNavigation
} from "../src/shared/embeddedContentSecurity.js";
import { validatedCaptureEvent } from "../src/shared/ipcPayloadSecurity.js";

const atlas = { kind: "game", platform: "atlas" } as const;
const tcga = { kind: "game", platform: "tcga" } as const;

describe("Atlas account authentication navigation", () => {
  it.each([
    "https://riftatlas.com/api/auth/callback/google?code=fixture&state=fixture",
    "https://riftatlas.com/api/auth/callback/discord?code=fixture&state=fixture",
    "https://riftatlas.com/api/auth/callback/twitch?code=fixture&state=fixture",
    "https://riftatlas.com/auth/error?error=state_mismatch"
  ])("keeps %s in the Atlas session without granting game privileges", (url) => {
    expect(isAllowedGameMainFrameNavigation(atlas, url)).toBe(true);
    expect(isAllowedGamePopupNavigation(atlas, url)).toBe(true);
    expect(isAllowedGameMainFrameNavigation(tcga, url)).toBe(false);
    expect(isAllowedGamePopupNavigation(tcga, url)).toBe(false);
    expect(gamePlatformForTrustedUrl(url)).toBeNull();
    expect(isAllowedEmbeddedNavigation(atlas, url)).toBe(false);
    expect(embeddedWebviewPolicy(url, "persist:riftlite-atlas")).toBeNull();
    expect(isAllowedEmbeddedPermission(atlas, url, "clipboard-sanitized-write",
      new Set(["clipboard-sanitized-write", "fullscreen"]))).toBe(false);
    expect(validatedCaptureEvent({
      id: "auth-page-event", platform: "atlas", kind: "match-start",
      capturedAt: "2026-10-13T17:00:00.000Z", url, payload: { active: true }
    })).toBeNull();
  });

  it.each([
    "https://riftatlas.com/",
    "https://riftatlas.com/sealed",
    "https://riftatlas.com/api/other",
    "https://riftatlas.com/api/auth-elsewhere/callback/google",
    "https://riftatlas.com/auth-elsewhere",
    "https://riftatlas.com/api/auth/../../other",
    "https://riftatlas.com/auth/%2e%2e/sealed",
    "https://riftatlas.com/api/auth%2fcallback/google",
    "https://riftatlas.com:8443/api/auth/callback/google",
    "http://riftatlas.com/api/auth/callback/google",
    "https://riftatlas.com.evil.example/api/auth/callback/google",
    "https://auth.riftatlas.com.evil.example/api/auth/callback/google",
    "https://auth.riftatlas.com:8443/api/auth/callback/google",
    "https://user:secret@riftatlas.com/api/auth/callback/google",
    "https://evil.example/?next=https://riftatlas.com/api/auth/callback/google"
  ])("keeps unrelated or malformed navigation outside the guest: %s", (url) => {
    expect(isAllowedGameMainFrameNavigation(atlas, url)).toBe(false);
    expect(isAllowedGamePopupNavigation(atlas, url)).toBe(false);
  });
});
