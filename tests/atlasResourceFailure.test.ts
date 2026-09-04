import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ATLAS_RECOVERY_CACHE_MISS_WINDOW_MS,
  isExpectedAtlasRecoveryCacheMiss,
  shouldPresentAtlasResourceFailure
} from "../src/shared/atlasResourceFailure.js";
import type { AtlasResourceFailureDiagnostic } from "../src/shared/types.js";

const recoveryCompletedAt = 1_000_000;
const main = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");

function failure(
  overrides: Partial<AtlasResourceFailureDiagnostic> = {}
): AtlasResourceFailureDiagnostic {
  return {
    capturedAt: "2026-09-03T17:58:44.765Z",
    reason: "network-error",
    origin: "https://play.riftatlas.com",
    resourceType: "font",
    error: "net::ERR_CACHE_MISS",
    ...overrides
  };
}

function context(
  overrides: Partial<Parameters<typeof isExpectedAtlasRecoveryCacheMiss>[0]> = {}
) {
  return {
    failure: failure(),
    requestUrl: "https://play.riftatlas.com/_next/static/immutable/media/atlas.woff2?cache=1#font",
    recoveryCompletedAt,
    observedAt: recoveryCompletedAt + 250,
    ...overrides
  };
}

describe("Atlas recovery resource-failure presentation", () => {
  it("hides a passive static cache miss immediately after recovery", () => {
    expect(isExpectedAtlasRecoveryCacheMiss(context())).toBe(true);
    expect(shouldPresentAtlasResourceFailure(context())).toBe(false);
    expect(isExpectedAtlasRecoveryCacheMiss(context({
      failure: failure({ resourceType: "image" })
    }))).toBe(true);
    expect(isExpectedAtlasRecoveryCacheMiss(context({
      failure: failure({ origin: "https://assets.riftatlas-workers.com", resourceType: "media" }),
      requestUrl: "https://assets.riftatlas-workers.com/cards/atlas.webm"
    }))).toBe(true);
  });

  it("uses a bounded post-recovery window", () => {
    expect(isExpectedAtlasRecoveryCacheMiss(context({ observedAt: recoveryCompletedAt }))).toBe(true);
    expect(isExpectedAtlasRecoveryCacheMiss(context({
      observedAt: recoveryCompletedAt + ATLAS_RECOVERY_CACHE_MISS_WINDOW_MS
    }))).toBe(true);
    expect(isExpectedAtlasRecoveryCacheMiss(context({
      observedAt: recoveryCompletedAt + ATLAS_RECOVERY_CACHE_MISS_WINDOW_MS + 1
    }))).toBe(false);
    expect(isExpectedAtlasRecoveryCacheMiss(context({ observedAt: recoveryCompletedAt - 1 }))).toBe(false);
    expect(isExpectedAtlasRecoveryCacheMiss(context({ recoveryCompletedAt: undefined }))).toBe(false);
  });

  it("keeps page, code, data, socket and stylesheet failures visible", () => {
    for (const resourceType of [
      "mainFrame",
      "subFrame",
      "script",
      "stylesheet",
      "xhr",
      "fetch",
      "webSocket"
    ]) {
      expect(shouldPresentAtlasResourceFailure(context({
        failure: failure({ resourceType })
      }))).toBe(true);
    }
  });

  it("keeps authentication, HTTP and non-cache network failures visible", () => {
    expect(shouldPresentAtlasResourceFailure(context({
      failure: failure({ origin: "https://clerk.riftatlas.com" }),
      requestUrl: "https://clerk.riftatlas.com/npm/auth.woff2"
    }))).toBe(true);
    expect(shouldPresentAtlasResourceFailure(context({
      failure: failure({ origin: "https://accounts.riftatlas.com" }),
      requestUrl: "https://accounts.riftatlas.com/_next/static/auth.woff2"
    }))).toBe(true);
    expect(shouldPresentAtlasResourceFailure(context({
      failure: failure({ reason: "http-error", statusCode: 503, error: "HTTP 503" })
    }))).toBe(true);
    expect(shouldPresentAtlasResourceFailure(context({
      failure: failure({ error: "net::ERR_CONNECTION_RESET" })
    }))).toBe(true);
  });

  it("keeps passive failures with an untrusted or non-static location visible", () => {
    expect(shouldPresentAtlasResourceFailure(context({
      requestUrl: "https://play.riftatlas.com/api/session"
    }))).toBe(true);
    expect(shouldPresentAtlasResourceFailure(context({
      requestUrl: "https://assets.riftatlas-workers.com.evil.example/card.webp",
      failure: failure({ origin: "https://assets.riftatlas-workers.com" })
    }))).toBe(true);
    expect(shouldPresentAtlasResourceFailure(context({
      requestUrl: "not a URL"
    }))).toBe(true);
  });

  it("filters only the Settings list while retaining the detailed raw event", () => {
    const functionStart = main.indexOf("function recordAtlasResourceFailure");
    const functionEnd = main.indexOf("function atlasDependencyOrigin", functionStart);
    const source = main.slice(functionStart, functionEnd);
    expect(source).toContain("shouldPresentAtlasResourceFailure");
    expect(source).toContain("atlasRecentResourceFailures.unshift(failure)");
    expect(source).toContain("capture.handleEvent");
    expect(source).toContain("resourcePath: safeAtlasResourcePath(requestUrl)");
    expect(source).toContain("resourceType: failure.resourceType");
    expect(source).toContain("errorDescription: failure.error");
    expect(source.indexOf("shouldPresentAtlasResourceFailure")).toBeLessThan(
      source.indexOf("atlasRecentResourceFailures.unshift(failure)")
    );
    expect(source.indexOf("atlasRecentResourceFailures.unshift(failure)")).toBeLessThan(
      source.indexOf("capture.handleEvent")
    );
  });
});
