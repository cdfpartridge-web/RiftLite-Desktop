import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  embeddedWebviewPolicy, isAllowedEmbeddedNavigation, isAllowedEmbeddedPermission,
  RIFTLITE_LOCAL_REPLAY_TEST_PARTITION, RIFTLITE_LOCAL_REPLAY_TEST_URL,
} from "../src/shared/embeddedContentSecurity.js";
import {
  localReplayTestFetch, localReplayTestRequestAllowed, isolatedTestRuntimeEnabled, localTestDesktopRequestAllowed,
} from "../src/main/services/localReplayTestIsolation.js";
import { resolveRiftLiteSmokePaths, riftLiteSmokeNetworkRequestAllowed } from "../src/main/services/smokeIsolation.js";

describe("explicit isolated local replay test", () => {
  const paths = resolveRiftLiteSmokePaths(true, { RIFTLITE_SMOKE_ROOT_PATH: resolve("output/local-replay-test-security") });
  it("requires both explicit opt-in and validated isolated smoke paths", () => {
    expect(isolatedTestRuntimeEnabled(undefined, false, null)).toBe(false);
    expect(isolatedTestRuntimeEnabled("true", true, paths)).toBe(false);
    expect(isolatedTestRuntimeEnabled(undefined, true, paths)).toBe(false);
    expect(isolatedTestRuntimeEnabled("1", true, paths)).toBe(true);
    expect(() => isolatedTestRuntimeEnabled("1", false, paths)).toThrow(/isolated/);
    expect(() => isolatedTestRuntimeEnabled("1", true, null)).toThrow(/isolated/);
  });
  it("cannot be enabled by the normal simulator/dev allowance or the hosted replay partition", () => {
    expect(embeddedWebviewPolicy(RIFTLITE_LOCAL_REPLAY_TEST_URL, RIFTLITE_LOCAL_REPLAY_TEST_PARTITION)).toBeNull();
    expect(embeddedWebviewPolicy(RIFTLITE_LOCAL_REPLAY_TEST_URL, RIFTLITE_LOCAL_REPLAY_TEST_PARTITION, true)).toBeNull();
    expect(embeddedWebviewPolicy(RIFTLITE_LOCAL_REPLAY_TEST_URL, "persist:riftlite-replay", true, true)).toBeNull();
    expect(RIFTLITE_LOCAL_REPLAY_TEST_PARTITION.startsWith("persist:")).toBe(false);
    expect(embeddedWebviewPolicy(RIFTLITE_LOCAL_REPLAY_TEST_URL, RIFTLITE_LOCAL_REPLAY_TEST_PARTITION, false, true))
      .toEqual({ kind: "local-replay-test" });
    expect(embeddedWebviewPolicy("https://www.riftlite.com/replays/embed?embed=1", "persist:riftlite-replay"))
      .toEqual({ kind: "replay" });
  });
  it.each([
    "http://localhost:4227/", "http://127.1:4227/", "http://127.0.0.1:4228/", "https://127.0.0.1:4227/",
    "http://user@127.0.0.1:4227/", "http://127.0.0.1:4227/api/auth", "http://127.0.0.1:4227/?next=https://www.riftlite.com",
    "http://127.0.0.1:4227/?embed=1&embed=1", "http://127.0.0.1:4227/#redirect", "https://www.riftlite.com/replays",
    "https://accounts.google.com/", "file:///C:/private.json", "javascript:alert(1)",
  ])("rejects navigation away from the exact isolated page: %s", url => {
    expect(embeddedWebviewPolicy(url, RIFTLITE_LOCAL_REPLAY_TEST_PARTITION, true, true)).toBeNull();
    expect(isAllowedEmbeddedNavigation({ kind: "local-replay-test" }, url)).toBe(false);
  });
  it("allows only the fixed page and single embed query without guest permissions", () => {
    const policy = { kind: "local-replay-test" } as const;
    expect(isAllowedEmbeddedNavigation(policy, RIFTLITE_LOCAL_REPLAY_TEST_URL)).toBe(true);
    expect(isAllowedEmbeddedNavigation(policy, RIFTLITE_LOCAL_REPLAY_TEST_URL + "?embed=1")).toBe(true);
    for (const permission of ["media", "display-capture", "clipboard-sanitized-write", "notifications", "fullscreen", "geolocation"]) {
      expect(isAllowedEmbeddedPermission(policy, RIFTLITE_LOCAL_REPLAY_TEST_URL, permission, new Set([permission]))).toBe(false);
    }
  });
  it("permits only local requests or GET card images on known CDN paths", () => {
    expect(localReplayTestRequestAllowed("http://127.0.0.1:4227/api/v2/replays/test/atlas-postgame", "xhr", "POST")).toBe(true);
    const card = "https://cdn.piltoverarchive.com/cards/OGN-001.webp";
    expect(localReplayTestRequestAllowed(card, "image", "GET")).toBe(true);
    for (const [url, type, method] of [
      [card, "xhr", "GET"], [card, "image", "POST"], ["https://cdn.piltoverarchive.com/api/auth", "image", "GET"],
      ["https://cdn.piltoverarchive.com.evil.example/cards/card.webp", "image", "GET"],
      ["https://user@cdn.piltoverarchive.com/cards/card.webp", "image", "GET"],
      ["https://play.riftatlas.com/api/auth/get-session", "xhr", "GET"],
      ["https://www.riftlite.com/api/v2/replay-embed-session", "xhr", "POST"],
      ["http://127.0.0.1:5173/", "xhr", "GET"], ["http://localhost:4227/", "xhr", "GET"],
      ["file:///C:/private.json", "image", "GET"],
    ]) expect(localReplayTestRequestAllowed(url, type, method)).toBe(false);
  });
  it("loads real card illustrations in the local desktop preview while keeping ordinary smoke checks offline", () => {
    const art = "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/ahri.png?accountingTag=RB";
    expect(localTestDesktopRequestAllowed(art, "image", "GET")).toBe(true);
    expect(riftLiteSmokeNetworkRequestAllowed(art)).toBe(false);
    expect(localTestDesktopRequestAllowed("file:///C:/preview/index.html", "mainFrame", "GET")).toBe(true);
    expect(localTestDesktopRequestAllowed(art, "xhr", "GET")).toBe(false);
    expect(localTestDesktopRequestAllowed(art, "image", "POST")).toBe(false);
    expect(localTestDesktopRequestAllowed("https://cmsassets.rgpub.io/api/account", "image", "GET")).toBe(false);
    expect(localTestDesktopRequestAllowed("https://www.riftlite.com/api/app/home", "xhr", "GET")).toBe(false);
  });
  it("blocks main-process production requests and disallows redirects from localhost", async () => {
    const implementation = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    const isolated = localReplayTestFetch(implementation);
    for (const input of ["https://www.riftlite.com/api/app/home", new URL("https://identitytoolkit.googleapis.com/v1/accounts:signUp"),
      new Request("https://securetoken.googleapis.com/v1/token"), "https://cdn.piltoverarchive.com/cards/OGN-001.webp"]) {
      await expect(isolated(input)).rejects.toThrow(/External network requests are disabled/);
    }
    expect(implementation).not.toHaveBeenCalled();
    await isolated("http://127.0.0.1:4227/preview/status", { redirect: "follow" });
    expect(implementation).toHaveBeenLastCalledWith("http://127.0.0.1:4227/preview/status", { redirect: "error" });
    const request = new Request("http://127.0.0.1:4227/local/status", { redirect: "follow" });
    await isolated(request);
    expect(implementation).toHaveBeenLastCalledWith(request, { redirect: "error" });
  });
  it("connects capability through trusted app IPC without giving the guest auth or capture trust", () => {
    const main = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
    const preload = readFileSync(new URL("../src/preload/appPreload.ts", import.meta.url), "utf8");
    expect(main).toContain('handleTrustedAppIpc("replay:local-test:capability"');
    expect(main).toContain('IS_LOCAL_REPLAY_TEST && app.getPath("userData") === SMOKE_PATHS?.userData');
    expect(preload).toContain('getLocalReplayTestCapability: () => ipcRenderer.invoke("replay:local-test:capability")');
    const branch = main.slice(main.indexOf('if (policy.kind === "local-replay-test")'), main.indexOf('policy.kind === "replay" &&', main.indexOf('if (policy.kind === "local-replay-test")')));
    expect(branch).toContain('setWindowOpenHandler(() => ({ action: "deny" }))');
    expect(branch).toContain('setDisplayMediaRequestHandler((_request, callback) => {');
    expect(branch).toContain('createSingleUseDisplayMediaResponder(callback)(null)');
    expect(branch).toContain('webContents.on("will-redirect", restrictLocalNavigation)');
    expect(branch).not.toMatch(/prepareRiftLiteReplay|syncService|secureRiftLiteReplay|gameWebContentsByPlatform/);
    expect(main).toContain('webPreferences.preload = policy.kind === "game" ? preloadPath("gamePreload") : undefined');
  });
});
