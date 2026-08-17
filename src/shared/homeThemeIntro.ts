export const HOME_THEME_INTRO_LOCAL_STORAGE_KEY = "riftlite.ui.home-deck-theme-intro";
export const HOME_THEME_INTRO_VERSION = 1 as const;

export type HomeThemeIntroStatus = "pending" | "seen";

export interface HomeThemeIntroState {
  readonly version: typeof HOME_THEME_INTRO_VERSION;
  readonly status: HomeThemeIntroStatus;
}

export function initialHomeThemeIntroState(): HomeThemeIntroState {
  return { version: HOME_THEME_INTRO_VERSION, status: "pending" };
}

export function seenHomeThemeIntroState(): HomeThemeIntroState {
  return { version: HOME_THEME_INTRO_VERSION, status: "seen" };
}

export function parseHomeThemeIntroState(stored: unknown): HomeThemeIntroState {
  const value = parseStoredValue(stored);
  if (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as { version?: unknown }).version === HOME_THEME_INTRO_VERSION
    && (value as { status?: unknown }).status === "seen"
  ) {
    return seenHomeThemeIntroState();
  }
  return initialHomeThemeIntroState();
}

export function serializeHomeThemeIntroState(state: HomeThemeIntroState): string {
  return JSON.stringify(state);
}

function parseStoredValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  if (!value.trim()) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
