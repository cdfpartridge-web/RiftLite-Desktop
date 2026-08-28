import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ATLAS_INVALID_AUTH_SESSION_ERROR_CODE,
  isAtlasInvalidAuthSessionMessage
} from "../src/shared/atlasAuthSession.js";

const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const gamePreloadSource = readFileSync(new URL("../src/game-preload/gamePreload.ts", import.meta.url), "utf8");

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Could not find source block between ${startMarker} and ${endMarker}.`);
  }
  return source.slice(start, end);
}

describe("Atlas invalid authentication session recovery", () => {
  it("recognizes only the exact invalid-claims session message", () => {
    expect(ATLAS_INVALID_AUTH_SESSION_ERROR_CODE).toBe("invalid_claims");
    expect(isAtlasInvalidAuthSessionMessage(
      "Could not verify the signed-in session (invalid_claims)."
    )).toBe(true);
    expect(isAtlasInvalidAuthSessionMessage(
      "  COULD NOT VERIFY THE SIGNED-IN SESSION\n( invalid_claims )  "
    )).toBe(true);
    expect(isAtlasInvalidAuthSessionMessage("invalid_claims")).toBe(false);
    expect(isAtlasInvalidAuthSessionMessage(
      "Opponent: Could not verify the signed-in session (invalid_claims)."
    )).toBe(false);
    expect(isAtlasInvalidAuthSessionMessage(null)).toBe(false);
  });

  it("reports the error only from a visible notification surface", () => {
    const detection = sourceBetween(
      gamePreloadSource,
      "const ATLAS_AUTH_NOTIFICATION_SELECTOR",
      "function scheduleAtlasShellMutationCheck"
    );

    expect(detection).toContain("[data-sonner-toast]");
    expect(detection).toContain("[role='alert']");
    expect(detection).toContain("bounds.width > 0 && bounds.height > 0");
    expect(detection).toContain("isAtlasInvalidAuthSessionMessage(textOf(element))");
    expect(detection).toContain('reason: "atlas-auth-session-invalid"');
    expect(detection).not.toContain("document.body.innerText");
  });

  it("uses a bounded cross-guest recovery: refresh first, targeted sign-in reset second, then stop", () => {
    const security = sourceBetween(
      mainSource,
      "function secureGameWebContents",
      "function secureHomeMediaWebContents"
    );
    const roomRecovery = sourceBetween(
      security,
      "const recoverAtlasInvalidClaims",
      "const clearAtlasRootTokenCacheIfNeeded"
    );
    const handler = sourceBetween(
      mainSource,
      "function handleAtlasShellStatusEvent",
      "async function createWindow"
    );

    expect(security).toContain("atlasInvalidClaimsRecoveryByGuest.set(webContents.id, registeredRecovery)");
    expect(security).toContain("atlasInvalidClaimsRecoveryByGuest.delete(webContents.id)");
    expect(roomRecovery).toContain("clearAtlasClerkSessionTokenCache(webContents)");
    expect(roomRecovery).toContain('atlasExplicitRepairUrl(Date.now(), "runtime")');
    expect(roomRecovery).toContain('recoveryStep === "refresh-token"');
    expect(roomRecovery).toContain('recoveryStep === "stop"');
    expect(roomRecovery).toContain('refreshAtlasWebviewRuntime("sign-in")');
    expect(roomRecovery).not.toContain('refreshAtlasWebviewRuntime("site-data")');
    expect(roomRecovery).not.toContain("clearAtlasClerkAuthCookies");
    expect(roomRecovery).not.toContain('atlasExplicitRepairUrl(Date.now(), "sign-in")');
    expect(security).toContain("atlasInvalidClaimsRecoveryBudget.next()");
    expect(security).toContain('reason: "authentication-blocked"');
    expect(handler).toContain('reason === "atlas-auth-session-invalid"');
    expect(handler).toContain('event.payload.authErrorCode !== "invalid_claims"');
    expect(handler).toContain('capture.hasActiveCaptureSession("atlas")');
    expect(handler).toContain("atlasInvalidClaimsRecoveryByGuest.get(sender.id)");
    expect(handler).not.toContain("clearAtlasClerkAuthCookies");
  });
});
