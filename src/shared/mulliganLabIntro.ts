export const MULLIGAN_LAB_INTRO_LOCAL_STORAGE_KEY = "riftlite.ui.mulligan-lab-intro";
export const MULLIGAN_LAB_INTRO_VERSION = 1 as const;

export type MulliganLabIntroStatus = "pending" | "seen";

export interface MulliganLabIntroState {
  readonly version: typeof MULLIGAN_LAB_INTRO_VERSION;
  readonly status: MulliganLabIntroStatus;
}

export function initialMulliganLabIntroState(): MulliganLabIntroState {
  return { version: MULLIGAN_LAB_INTRO_VERSION, status: "pending" };
}

export function seenMulliganLabIntroState(): MulliganLabIntroState {
  return { version: MULLIGAN_LAB_INTRO_VERSION, status: "seen" };
}

export function reopenMulliganLabIntro(_state: MulliganLabIntroState): MulliganLabIntroState {
  return initialMulliganLabIntroState();
}

export function resetMulliganLabIntro(): MulliganLabIntroState {
  return initialMulliganLabIntroState();
}

export function parseMulliganLabIntroState(stored: unknown): MulliganLabIntroState {
  const value = parseStoredValue(stored);
  if (!isRecord(value) || value.version !== MULLIGAN_LAB_INTRO_VERSION || !isMulliganLabIntroStatus(value.status)) {
    return initialMulliganLabIntroState();
  }
  return value.status === "seen" ? seenMulliganLabIntroState() : initialMulliganLabIntroState();
}

export function serializeMulliganLabIntroState(state: MulliganLabIntroState): string {
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

function isMulliganLabIntroStatus(value: unknown): value is MulliganLabIntroStatus {
  return value === "pending" || value === "seen";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
