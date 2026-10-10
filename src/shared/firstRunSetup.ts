import type { UserSettings } from "./types.js";

export const FIRST_RUN_SETUP_LOCAL_STORAGE_KEY = "riftlite.ui.first-run-setup";
export const FIRST_RUN_SETUP_VERSION = 1 as const;
export const FIRST_RUN_SETUP_STEPS = ["player", "account", "replays", "deck", "ready"] as const;

export type FirstRunSetupStep = typeof FIRST_RUN_SETUP_STEPS[number];
export type FirstRunSetupStatus = "active" | "completed" | "dismissed";

export interface FirstRunSetupState {
  version: typeof FIRST_RUN_SETUP_VERSION;
  step: FirstRunSetupStep;
  status: FirstRunSetupStatus;
}

export interface FirstRunSetupContext {
  hasLocalData: boolean;
  /** The raw legacy value, not parseGuidedTourState's new-user fallback. */
  legacyTourState?: unknown;
  setupState?: unknown;
}

export function initialFirstRunSetupState(): FirstRunSetupState {
  return { version: FIRST_RUN_SETUP_VERSION, step: "player", status: "active" };
}

export function parseFirstRunSetupState(value: unknown): FirstRunSetupState | null {
  const parsed = parseStoredValue(value);
  if (!isRecord(parsed)
    || parsed.version !== FIRST_RUN_SETUP_VERSION
    || typeof parsed.step !== "string"
    || !FIRST_RUN_SETUP_STEPS.includes(parsed.step as FirstRunSetupStep)
    || typeof parsed.status !== "string"
    || !["active", "completed", "dismissed"].includes(parsed.status)) {
    return null;
  }
  return {
    version: FIRST_RUN_SETUP_VERSION,
    step: parsed.step as FirstRunSetupStep,
    status: parsed.status as FirstRunSetupStatus
  };
}

export function serializeFirstRunSetupState(state: FirstRunSetupState): string {
  return JSON.stringify(state);
}

/** Completion is explicit; arriving on the final page does not finish setup. */
export function nextFirstRunSetupStep(state: FirstRunSetupState): FirstRunSetupState {
  if (state.status !== "active") return state;
  const index = FIRST_RUN_SETUP_STEPS.indexOf(state.step);
  const next = FIRST_RUN_SETUP_STEPS[index + 1];
  return next ? { ...state, step: next } : state;
}

export function previousFirstRunSetupStep(state: FirstRunSetupState): FirstRunSetupState {
  if (state.status !== "active") return state;
  const index = FIRST_RUN_SETUP_STEPS.indexOf(state.step);
  const previous = FIRST_RUN_SETUP_STEPS[index - 1];
  return previous ? { ...state, step: previous } : state;
}

export function completeFirstRunSetup(state: FirstRunSetupState): FirstRunSetupState {
  return state.status === "active" ? { ...state, step: "ready", status: "completed" } : state;
}

export function dismissFirstRunSetup(state: FirstRunSetupState): FirstRunSetupState {
  return state.status === "active" ? { ...state, status: "dismissed" } : state;
}

/** Only new profiles auto-open setup. An explicitly started setup can resume. */
export function shouldStartFirstRunSetup(
  settings: Pick<UserSettings, "firstRunComplete" | "username" | "accountUid">,
  context: FirstRunSetupContext
): boolean {
  if (settings.firstRunComplete === true) return false;
  const setup = parseFirstRunSetupState(context.setupState);
  if (setup) return setup.status === "active";

  // Existing users may have completed or skipped the old tour without using
  // its separate Play-only quick setup. Do not interrupt those users again.
  if (hasValidLegacyGuidedTourState(context.legacyTourState)) return false;
  if (context.hasLocalData || settings.username.trim() || settings.accountUid.trim()) return false;

  // lastSeenVersion is deliberately ignored: boot records it before setup.
  return true;
}

function hasValidLegacyGuidedTourState(value: unknown): boolean {
  const parsed = parseStoredValue(value);
  return isRecord(parsed)
    && parsed.persistenceVersion === 1
    && parsed.tourVersion === 1
    && typeof parsed.status === "string"
    && ["active", "skipped", "completed"].includes(parsed.status)
    && typeof parsed.currentStepId === "string"
    && ["home", "play", "review", "prepare", "community", "utilities"].includes(parsed.currentStepId);
}

function parseStoredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
