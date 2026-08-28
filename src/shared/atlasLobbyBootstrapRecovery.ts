const ATLAS_ORIGIN = "https://play.riftatlas.com";
const ATLAS_ACTIVE_ROOM_KEY = "riftbound_simulator_active_room";
const ATLAS_LEGACY_SESSION_KEY = "riftbound_simulator_session";

export interface AtlasReadableStorage {
  getItem(key: string): string | null;
}

export interface AtlasLobbyBootstrapRecovery {
  checked: boolean;
  recoveryUrl: string;
  source: "session" | "legacy-local" | "";
  storageReadFailed: boolean;
}

/**
 * RiftAtlas has an official `recover=lobby` route that demotes a stale live
 * room into its safe Resume/Take over banner before rendering the four lobby
 * controls. Ask Atlas to run that migration before its app hydrates whenever
 * an embedded root document still carries active-room state.
 *
 * This is deliberately read-only. Atlas remains the owner of its state and can
 * preserve the canonical last-room record, login, decks, pending OAuth/deck
 * actions, matchmaking continuation, player name, and preferences.
 */
export function atlasLobbyBootstrapRecovery(
  rawUrl: string,
  localStorage: AtlasReadableStorage,
  sessionStorage: AtlasReadableStorage
): AtlasLobbyBootstrapRecovery {
  const url = parsedAtlasRootUrl(rawUrl);
  if (!url) {
    return emptyResult(false);
  }
  if (url.searchParams.get("recover") === "lobby") {
    return emptyResult(true);
  }

  let sessionActiveRoom = false;
  let legacyLocalRoom = false;
  let storageReadFailed = false;
  try {
    sessionActiveRoom = Boolean(sessionStorage.getItem(ATLAS_ACTIVE_ROOM_KEY));
  } catch {
    storageReadFailed = true;
  }
  try {
    legacyLocalRoom = Boolean(
      localStorage.getItem(ATLAS_ACTIVE_ROOM_KEY) ||
      localStorage.getItem(ATLAS_LEGACY_SESSION_KEY)
    );
  } catch {
    storageReadFailed = true;
  }

  const source = sessionActiveRoom ? "session" : legacyLocalRoom ? "legacy-local" : "";
  if (!source) {
    return { ...emptyResult(true), storageReadFailed };
  }
  url.searchParams.set("recover", "lobby");
  return {
    checked: true,
    recoveryUrl: url.toString(),
    source,
    storageReadFailed
  };
}

function parsedAtlasRootUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    return url.origin === ATLAS_ORIGIN && url.pathname === "/" ? url : null;
  } catch {
    return null;
  }
}

function emptyResult(checked: boolean): AtlasLobbyBootstrapRecovery {
  return {
    checked,
    recoveryUrl: "",
    source: "",
    storageReadFailed: false
  };
}
