import type { NavigationTarget } from "./navigationModel.js";

export const GUIDED_TOUR_LOCAL_STORAGE_KEY = "riftlite.ui.guided-tour";
export const GUIDED_TOUR_PERSISTENCE_VERSION = 1 as const;
export const GUIDED_TOUR_CONTENT_VERSION = 1 as const;

export const GUIDED_TOUR_STEPS = [
  {
    id: "home",
    title: "Your RiftLite dashboard",
    description: "Check match tracking, your active deck, recent results, and the next action from one place.",
    target: { view: "home" }
  },
  {
    id: "play",
    title: "Play with capture ready",
    description: "Open TCG Arena or RiftAtlas while RiftLite keeps capture, match tracking, and replay workflows running.",
    target: { view: "play" }
  },
  {
    id: "review",
    title: "Review every result",
    description: "Matches, Local and Web Replays, and personal stats live together under Review.",
    target: { view: "matches" }
  },
  {
    id: "prepare",
    title: "Prepare your next matchup",
    description: "Manage decks, open matchup prep, and move into Matchup Lab from Prepare.",
    target: { view: "decks", deckFocus: "library" }
  },
  {
    id: "community",
    title: "Explore the community",
    description: "Community contains meta, decks, Spotlight, LFG, teams, Private Hubs, and the collapsed Scorepad tool.",
    target: { view: "community", communityTab: "legend-meta" }
  },
  {
    id: "utilities",
    title: "Your utilities stay close",
    description: "Overlay, Account & integrations, Settings, navigation controls, and capture health remain available in the sidebar.",
    target: { view: "account" }
  }
] as const satisfies readonly GuidedTourStep[];

export type GuidedTourStepId = typeof GUIDED_TOUR_STEPS[number]["id"];
export type GuidedTourStatus = "active" | "skipped" | "completed";

export interface GuidedTourStep {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly target: NavigationTarget;
}

export interface GuidedTourState {
  readonly persistenceVersion: typeof GUIDED_TOUR_PERSISTENCE_VERSION;
  readonly tourVersion: typeof GUIDED_TOUR_CONTENT_VERSION;
  readonly status: GuidedTourStatus;
  readonly currentStepId: GuidedTourStepId;
}

export interface GuidedTourProgress {
  readonly current: number;
  readonly total: number;
  readonly percent: number;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}

const GUIDED_TOUR_STEP_IDS = new Set<string>(GUIDED_TOUR_STEPS.map((step) => step.id));

export function initialGuidedTourState(): GuidedTourState {
  return {
    persistenceVersion: GUIDED_TOUR_PERSISTENCE_VERSION,
    tourVersion: GUIDED_TOUR_CONTENT_VERSION,
    status: "active",
    currentStepId: GUIDED_TOUR_STEPS[0].id
  };
}

export function currentGuidedTourStep(state: GuidedTourState): GuidedTourStep | null {
  if (state.status !== "active") {
    return null;
  }
  return GUIDED_TOUR_STEPS[guidedTourStepIndex(state)] ?? GUIDED_TOUR_STEPS[0];
}

export function guidedTourProgress(state: GuidedTourState): GuidedTourProgress {
  const total = GUIDED_TOUR_STEPS.length;
  const index = guidedTourStepIndex(state);
  const current = state.status === "active" || state.status === "skipped" ? index + 1 : total;
  return {
    current,
    total,
    percent: state.status === "completed" ? 100 : Math.round((current / total) * 100),
    isFirst: index === 0,
    isLast: index === total - 1
  };
}

export function nextGuidedTourStep(state: GuidedTourState): GuidedTourState {
  if (state.status !== "active") {
    return state;
  }
  const index = guidedTourStepIndex(state);
  if (index >= GUIDED_TOUR_STEPS.length - 1) {
    return completeGuidedTour(state);
  }
  return withActiveStep(GUIDED_TOUR_STEPS[index + 1].id);
}

export function previousGuidedTourStep(state: GuidedTourState): GuidedTourState {
  if (state.status !== "active") {
    return state;
  }
  const index = guidedTourStepIndex(state);
  if (index === 0) {
    return state;
  }
  return withActiveStep(GUIDED_TOUR_STEPS[index - 1].id);
}

export function skipGuidedTour(state: GuidedTourState): GuidedTourState {
  return state.status === "active" ? { ...state, status: "skipped" } : state;
}

export function completeGuidedTour(state: GuidedTourState): GuidedTourState {
  if (state.status !== "active") {
    return state;
  }
  return {
    ...state,
    status: "completed",
    currentStepId: GUIDED_TOUR_STEPS[GUIDED_TOUR_STEPS.length - 1].id
  };
}

export function resetGuidedTour(): GuidedTourState {
  return initialGuidedTourState();
}

export function replayGuidedTour(_state: GuidedTourState): GuidedTourState {
  return initialGuidedTourState();
}

export function serializeGuidedTourState(state: GuidedTourState): string {
  return JSON.stringify(state);
}

export function parseGuidedTourState(stored: unknown): GuidedTourState {
  const value = parseStoredValue(stored);
  if (!isRecord(value)) {
    return initialGuidedTourState();
  }
  if (
    value.persistenceVersion !== GUIDED_TOUR_PERSISTENCE_VERSION
    || value.tourVersion !== GUIDED_TOUR_CONTENT_VERSION
    || !isGuidedTourStatus(value.status)
    || !isGuidedTourStepId(value.currentStepId)
  ) {
    return initialGuidedTourState();
  }

  const state: GuidedTourState = {
    persistenceVersion: GUIDED_TOUR_PERSISTENCE_VERSION,
    tourVersion: GUIDED_TOUR_CONTENT_VERSION,
    status: value.status,
    currentStepId: value.currentStepId
  };
  if (state.status === "completed") {
    return {
      ...state,
      currentStepId: GUIDED_TOUR_STEPS[GUIDED_TOUR_STEPS.length - 1].id
    };
  }
  return state;
}

function guidedTourStepIndex(state: GuidedTourState): number {
  const index = GUIDED_TOUR_STEPS.findIndex((step) => step.id === state.currentStepId);
  return index >= 0 ? index : 0;
}

function withActiveStep(currentStepId: GuidedTourStepId): GuidedTourState {
  return {
    persistenceVersion: GUIDED_TOUR_PERSISTENCE_VERSION,
    tourVersion: GUIDED_TOUR_CONTENT_VERSION,
    status: "active",
    currentStepId
  };
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

function isGuidedTourStepId(value: unknown): value is GuidedTourStepId {
  return typeof value === "string" && GUIDED_TOUR_STEP_IDS.has(value);
}

function isGuidedTourStatus(value: unknown): value is GuidedTourStatus {
  return value === "active" || value === "skipped" || value === "completed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
