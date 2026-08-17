export const TRAINING_LABS_INTRO_LOCAL_STORAGE_KEY = "riftlite.ui.training-labs-intro";
export const TRAINING_LABS_INTRO_VERSION = 1 as const;

export type TrainingLabsIntroStatus = "pending" | "seen";

export interface TrainingLabsIntroState {
  readonly version: typeof TRAINING_LABS_INTRO_VERSION;
  readonly status: TrainingLabsIntroStatus;
}

export function initialTrainingLabsIntroState(): TrainingLabsIntroState {
  return { version: TRAINING_LABS_INTRO_VERSION, status: "pending" };
}

export function seenTrainingLabsIntroState(): TrainingLabsIntroState {
  return { version: TRAINING_LABS_INTRO_VERSION, status: "seen" };
}

export function parseTrainingLabsIntroState(stored: unknown): TrainingLabsIntroState {
  const value = parseStoredValue(stored);
  if (!isRecord(value)
    || value.version !== TRAINING_LABS_INTRO_VERSION
    || !isTrainingLabsIntroStatus(value.status)) {
    return initialTrainingLabsIntroState();
  }
  return value.status === "seen" ? seenTrainingLabsIntroState() : initialTrainingLabsIntroState();
}

export function serializeTrainingLabsIntroState(state: TrainingLabsIntroState): string {
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

function isTrainingLabsIntroStatus(value: unknown): value is TrainingLabsIntroStatus {
  return value === "pending" || value === "seen";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
