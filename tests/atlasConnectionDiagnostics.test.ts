import { afterEach, describe, expect, it, vi } from "vitest";
import {
  atlasCriticalResourceUrls,
  emptyAtlasConnectionDiagnostics,
  runAtlasConnectionTest
} from "../src/main/services/atlasConnectionDiagnostics.js";

const pageUrl = "https://play.riftatlas.com/";
const appScriptUrl = "https://play.riftatlas.com/_next/static/chunks/app-123.js";
const authScriptUrl = "https://clerk.riftatlas.com/npm/@clerk/clerk-js.js?v=5";
const assetUrl = "https://assets.riftatlas-workers.com/cards/OGN-001.webp?size=small";

const atlasHtml = `<!doctype html>
  <html>
    <head>
      <script src="/_next/static/chunks/app-123.js"></script>
      <script src="${authScriptUrl}"></script>
      <link rel="preload" href="${assetUrl}">
    </head>
  </html>`;

afterEach(() => {
  vi.useRealTimers();
});

describe("Atlas connection diagnostics", () => {
  it("starts with an explicit not-tested result", () => {
    expect(emptyAtlasConnectionDiagnostics()).toEqual({
      state: "not-tested",
      message: expect.stringContaining("Run the connection test"),
      testedAt: "",
      checks: [],
      recentFailures: [],
      guestAttached: false,
      guestUrl: ""
    });
  });

  it("extracts only allowlisted HTTPS resources advertised by Atlas", () => {
    const resources = atlasCriticalResourceUrls(`
      <script src="http://play.riftatlas.com/_next/static/chunks/insecure.js"></script>
      <script src="https://play.riftatlas.com.evil.example/_next/static/chunks/hostile.js"></script>
      <script src="https://cdn.example.com/_next/static/chunks/external.js"></script>
      <script src="/_next/static/chunks/app-123.js"></script>
      <script src="https://accounts.riftatlas.com/client/account.js?version=2"></script>
      <img src="https://assets.riftatlas-workers.com/cards/OGN-001.webp?size=small">
    `);

    expect(resources).toEqual({
      appScript: appScriptUrl,
      authScript: "https://accounts.riftatlas.com/client/account.js?version=2",
      asset: assetUrl
    });
  });

  it("reports ready only after the page, application, auth, and asset checks succeed", async () => {
    const fetcher = vi.fn(async (url: string) => new Response(
      url === pageUrl ? atlasHtml : "resource",
      { status: 200 }
    ));

    const result = await runAtlasConnectionTest(fetcher);

    expect(result.state).toBe("ready");
    expect(result.message).toContain("all reachable");
    expect(result.testedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.checks.map((check) => check.id)).toEqual([
      "page",
      "app-script",
      "auth-script",
      "assets"
    ]);
    expect(result.checks.every((check) => check.ok && check.statusCode === 200)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({
        cache: "no-store",
        credentials: "omit",
        redirect: "follow",
        signal: expect.any(AbortSignal)
      });
    }
  });

  it("stops after a failed Atlas page request and includes the HTTP status", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));

    const result = await runAtlasConnectionTest(fetcher);

    expect(result.state).toBe("failed");
    expect(result.message).toContain("could not be reached");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({
      id: "page",
      origin: "https://play.riftatlas.com",
      ok: false,
      statusCode: 503,
      error: "HTTP 503"
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("identifies a missing application script as the empty-shell failure", async () => {
    const htmlWithoutApp = `
      <script src="${authScriptUrl}"></script>
      <img src="${assetUrl}">
    `;
    const fetcher = vi.fn(async (url: string) => new Response(
      url === pageUrl ? htmlWithoutApp : "resource",
      { status: 200 }
    ));

    const result = await runAtlasConnectionTest(fetcher);

    expect(result.state).toBe("failed");
    expect(result.message).toContain("static-introduction or empty-lobby failure");
    expect(result.checks.find((check) => check.id === "app-script")).toMatchObject({
      ok: false,
      durationMs: 0,
      error: "The Atlas page did not advertise this required resource."
    });
  });

  it.each([
    {
      failedUrl: appScriptUrl,
      checkId: "app-script",
      expectedState: "failed",
      expectedMessage: "application code did not"
    },
    {
      failedUrl: authScriptUrl,
      checkId: "auth-script",
      expectedState: "partial",
      expectedMessage: "sign-in service is blocked"
    },
    {
      failedUrl: assetUrl,
      checkId: "assets",
      expectedState: "partial",
      expectedMessage: "asset host is blocked"
    }
  ] as const)("classifies a failed $checkId request", async ({
    failedUrl,
    checkId,
    expectedState,
    expectedMessage
  }) => {
    const fetcher = vi.fn(async (url: string) => new Response(
      url === pageUrl ? atlasHtml : "resource",
      { status: url === failedUrl ? 502 : 200 }
    ));

    const result = await runAtlasConnectionTest(fetcher);

    expect(result.state).toBe(expectedState);
    expect(result.message).toContain(expectedMessage);
    expect(result.checks.find((check) => check.id === checkId)).toMatchObject({
      ok: false,
      statusCode: 502,
      error: "HTTP 502"
    });
  });

  it("redacts URLs from network error text", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("blocked https://play.riftatlas.com/?token=private-value");
    });

    const result = await runAtlasConnectionTest(fetcher);
    const encoded = JSON.stringify(result);

    expect(result.state).toBe("failed");
    expect(result.checks[0]?.error).toContain("[redacted-url]");
    expect(encoded).not.toContain("private-value");
  });

  it("times out a stalled request using the minimum timeout", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new Error("request aborted"));
      if (init.signal?.aborted) {
        abort();
      } else {
        init.signal?.addEventListener("abort", abort, { once: true });
      }
    }));

    const pending = runAtlasConnectionTest(fetcher, { timeoutMs: 1 });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(result.state).toBe("failed");
    expect(result.checks[0]).toMatchObject({
      id: "page",
      ok: false,
      error: "Connection timed out."
    });
  });
});
