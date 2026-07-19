import type { MatchDraft } from "./types.js";
import type { GuidedTourStatus } from "./guidedTour.js";

export const FIRST_MATCH_ONBOARDING_LOCAL_STORAGE_KEY = "riftlite.ui.first-match-onboarding";
export const FIRST_MATCH_ONBOARDING_VERSION = 1 as const;

export type FirstMatchOnboardingStatus = "inactive" | "pending" | "completed" | "dismissed";

export interface FirstMatchOnboardingState {
  version: typeof FIRST_MATCH_ONBOARDING_VERSION;
  status: FirstMatchOnboardingStatus;
  startedAt: string;
  completedAt: string;
}

export function initialFirstMatchOnboardingState(
  tourStatus: GuidedTourStatus,
  hasSuccessfullySavedMatch: boolean,
  now = new Date().toISOString()
): FirstMatchOnboardingState {
  if (hasSuccessfullySavedMatch) {
    return completedFirstMatchOnboarding(now);
  }
  if (tourStatus === "completed") {
    return pendingFirstMatchOnboarding(now);
  }
  if (tourStatus === "skipped") {
    return dismissedFirstMatchOnboarding();
  }
  return inactiveFirstMatchOnboarding();
}

export function reconcileFirstMatchOnboarding(
  stored: unknown,
  tourStatus: GuidedTourStatus,
  matches: readonly MatchDraft[],
  now = new Date().toISOString()
): FirstMatchOnboardingState {
  const parsed = parseFirstMatchOnboardingState(stored);
  if (matches.some(isSuccessfullySavedMatch)) {
    return parsed?.status === "completed" ? parsed : completedFirstMatchOnboarding(now);
  }
  return parsed ?? initialFirstMatchOnboardingState(tourStatus, false, now);
}

export function firstMatchOnboardingAfterTour(
  current: FirstMatchOnboardingState | null,
  tourStatus: GuidedTourStatus,
  matches: readonly MatchDraft[],
  now = new Date().toISOString()
): FirstMatchOnboardingState {
  if (matches.some(isSuccessfullySavedMatch)) {
    return current?.status === "completed" ? current : completedFirstMatchOnboarding(now);
  }
  if (tourStatus === "completed") {
    return current?.status === "pending" ? current : pendingFirstMatchOnboarding(now);
  }
  if (tourStatus === "skipped") {
    return dismissedFirstMatchOnboarding();
  }
  return current ?? inactiveFirstMatchOnboarding();
}

export function firstMatchOnboardingAfterSavedMatch(
  current: FirstMatchOnboardingState | null,
  match: MatchDraft,
  now = new Date().toISOString()
): FirstMatchOnboardingState | null {
  if (!isSuccessfullySavedMatch(match)) {
    return current;
  }
  return current?.status === "completed" ? current : completedFirstMatchOnboarding(now);
}

export function dismissFirstMatchOnboarding(): FirstMatchOnboardingState {
  return dismissedFirstMatchOnboarding();
}

export function isSuccessfullySavedMatch(match: Pick<MatchDraft, "status" | "result">): boolean {
  return match.status === "saved" && match.result !== "Incomplete";
}

export function serializeFirstMatchOnboardingState(state: FirstMatchOnboardingState): string {
  return JSON.stringify(state);
}

export function parseFirstMatchOnboardingState(value: unknown): FirstMatchOnboardingState | null {
  const parsed = parseStoredValue(value);
  if (!isRecord(parsed) || parsed.version !== FIRST_MATCH_ONBOARDING_VERSION || !isStatus(parsed.status)) {
    return null;
  }
  return {
    version: FIRST_MATCH_ONBOARDING_VERSION,
    status: parsed.status,
    startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
    completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : ""
  };
}

function inactiveFirstMatchOnboarding(): FirstMatchOnboardingState {
  return { version: FIRST_MATCH_ONBOARDING_VERSION, status: "inactive", startedAt: "", completedAt: "" };
}

function pendingFirstMatchOnboarding(now: string): FirstMatchOnboardingState {
  return { version: FIRST_MATCH_ONBOARDING_VERSION, status: "pending", startedAt: now, completedAt: "" };
}

function completedFirstMatchOnboarding(now: string): FirstMatchOnboardingState {
  return { version: FIRST_MATCH_ONBOARDING_VERSION, status: "completed", startedAt: "", completedAt: now };
}

function dismissedFirstMatchOnboarding(): FirstMatchOnboardingState {
  return { version: FIRST_MATCH_ONBOARDING_VERSION, status: "dismissed", startedAt: "", completedAt: "" };
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

function isStatus(value: unknown): value is FirstMatchOnboardingStatus {
  return value === "inactive" || value === "pending" || value === "completed" || value === "dismissed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
