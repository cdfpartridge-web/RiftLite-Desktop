export const SIDEBOARD_LAB_INTRO_LOCAL_STORAGE_KEY = "riftlite.ui.sideboard-lab-intro";
export const SIDEBOARD_LAB_INTRO_VERSION = 2 as const;

export type SideboardLabIntroStatus = "pending" | "seen";

export interface SideboardLabIntroState {
  readonly version: typeof SIDEBOARD_LAB_INTRO_VERSION;
  readonly status: SideboardLabIntroStatus;
}

export function initialSideboardLabIntroState(): SideboardLabIntroState {
  return { version: SIDEBOARD_LAB_INTRO_VERSION, status: "pending" };
}

export function seenSideboardLabIntroState(): SideboardLabIntroState {
  return { version: SIDEBOARD_LAB_INTRO_VERSION, status: "seen" };
}

export function parseSideboardLabIntroState(stored: unknown): SideboardLabIntroState {
  const value = parseStoredValue(stored);
  if (!isRecord(value) || value.version !== SIDEBOARD_LAB_INTRO_VERSION || !isStatus(value.status)) {
    return initialSideboardLabIntroState();
  }
  return value.status === "seen" ? seenSideboardLabIntroState() : initialSideboardLabIntroState();
}

export function serializeSideboardLabIntroState(state: SideboardLabIntroState): string {
  return JSON.stringify(state);
}

function parseStoredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isStatus(value: unknown): value is SideboardLabIntroStatus {
  return value === "pending" || value === "seen";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
