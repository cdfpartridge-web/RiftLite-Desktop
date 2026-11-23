import { RIFTLITE_LOCAL_REPLAY_TEST_URL } from "../../shared/embeddedContentSecurity.js";
import { LOCAL_ACCOUNT_PROVIDERS_URL } from "./discordSignInAvailability.js";
import { riftLiteSmokeNetworkRequestAllowed, type RiftLiteSmokePaths } from "./smokeIsolation.js";

/** Local preview opt-in must never silently fall back to the user's profile. */
export function isolatedTestRuntimeEnabled(
  requested: string | undefined,
  smokeMode: boolean,
  smokePaths: RiftLiteSmokePaths | null
): boolean {
  if (requested !== "1") return false;
  if (!smokeMode || !smokePaths) {
    throw new Error("Local testing requires --riftlite-smoke-test and an explicit isolated RIFTLITE_SMOKE_ROOT_PATH.");
  }
  return true;
}

const CARD_IMAGE_PATHS: ReadonlyArray<[string, string]> = [
  ["https://cdn.piltoverarchive.com", "/cards/"],
  ["https://assets.riftatlas-workers.com", "/riftbound/cards/"],
  ["https://cmsassets.rgpub.io", "/sanity/images/dsfx7636/game_data_live/"],
  ["https://piltoverarchive.b-cdn.net", "/temporary/"],
  ["https://play.riftatlas.com", "/tokens/"]
];

/** Separate from normal replay/provider policy; external traffic is image-only. */
export function localReplayTestRequestAllowed(rawUrl: string, resourceType = "", method = "GET"): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password) return false;
    if (rawUrl.startsWith(RIFTLITE_LOCAL_REPLAY_TEST_URL) && url.origin === "http://127.0.0.1:4227") return true;
    return resourceType === "image" && method === "GET" && CARD_IMAGE_PATHS.some(([origin, prefix]) =>
      url.origin === origin && url.pathname.startsWith(prefix));
  } catch { return false; }
}

/** The isolated desktop keeps its local assets and can display the same card art as its replay viewer. */
export function localTestDesktopRequestAllowed(rawUrl: string, resourceType: string, method: string): boolean {
  return riftLiteSmokeNetworkRequestAllowed(rawUrl)
    || (resourceType === "image" && localReplayTestRequestAllowed(rawUrl, resourceType, method));
}

/** Smoke Electron filters do not cover main-process fetch/anonymous sign-in. */
export function localReplayTestFetch(fetchImplementation: typeof fetch): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const localAvailability = url === LOCAL_ACCOUNT_PROVIDERS_URL && method.toUpperCase() === "GET";
    if (!localAvailability && !localReplayTestRequestAllowed(url)) return Promise.reject(new Error("External network requests are disabled in this isolated local replay test."));
    return fetchImplementation(input, { ...init, redirect: "error" });
  };
}
