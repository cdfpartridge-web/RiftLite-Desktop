export const LAB_TRAINING_HANDOFF_STORAGE_KEY = "riftlite.ui.lab-training-handoff:v1" as const;
export const LAB_TRAINING_HANDOFF_VERSION = 1 as const;
export const LAB_TRAINING_HANDOFF_MAX_AGE_MS = 30 * 60 * 1_000;

export type LabTrainingDestination = "mulligan" | "sideboard";
export type LabTrainingHandoffSource = "match-detail" | "mulligan-complete" | "sideboard-complete";

export interface LabTrainingHandoff {
  version: typeof LAB_TRAINING_HANDOFF_VERSION;
  destination: LabTrainingDestination;
  source: LabTrainingHandoffSource;
  createdAt: string;
  playerLegend: string;
  opponentLegend: string;
  deckId: string;
  format: "Bo1" | "Bo3" | "Auto" | null;
  wentFirst: "1st" | "2nd" | null;
  priorGameResult: "win" | "loss" | null;
}

export interface LabTrainingHandoffInput {
  destination: LabTrainingDestination;
  source: LabTrainingHandoffSource;
  playerLegend: string;
  opponentLegend: string;
  deckId?: string;
  format?: "Bo1" | "Bo3" | "Auto" | null;
  wentFirst?: "1st" | "2nd" | null;
  priorGameResult?: "win" | "loss" | null;
}

export interface LabTrainingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LabTrainingDeckCandidate {
  id: string;
  sourceKey?: string;
  sourceUrl?: string;
  title: string;
  legend: string;
}

export interface LabTrainingMatchDeckRef {
  deckSourceId?: string;
  deckSourceKey?: string;
  deckSourceUrl?: string;
  deckName?: string;
  playerLegend?: string;
}

/** Creates a short-lived, navigation-only context record. */
export function createLabTrainingHandoff(input: LabTrainingHandoffInput, createdAt = new Date()): LabTrainingHandoff {
  return {
    version: LAB_TRAINING_HANDOFF_VERSION,
    destination: input.destination,
    source: input.source,
    createdAt: createdAt.toISOString(),
    playerLegend: cleanText(input.playerLegend, 100),
    opponentLegend: cleanText(input.opponentLegend, 100),
    deckId: cleanText(input.deckId ?? "", 240),
    format: input.format === "Bo1" || input.format === "Bo3" || input.format === "Auto" ? input.format : null,
    wentFirst: input.wentFirst === "1st" || input.wentFirst === "2nd" ? input.wentFirst : null,
    priorGameResult: input.priorGameResult === "win" || input.priorGameResult === "loss" ? input.priorGameResult : null
  };
}

export function serializeLabTrainingHandoff(handoff: LabTrainingHandoff): string {
  return JSON.stringify(handoff);
}

/**
 * Parses only fresh, complete v1 navigation context. It carries filters into a
 * lab but is deliberately separate from either lab's evidence and history.
 */
export function parseLabTrainingHandoff(
  raw: unknown,
  destination?: LabTrainingDestination,
  nowMs = Date.now()
): LabTrainingHandoff | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || value.version !== LAB_TRAINING_HANDOFF_VERSION) return null;
  if (value.destination !== "mulligan" && value.destination !== "sideboard") return null;
  if (destination && value.destination !== destination) return null;
  if (value.source !== "match-detail" && value.source !== "mulligan-complete" && value.source !== "sideboard-complete") return null;
  const createdAt = cleanIso(value.createdAt);
  const playerLegend = cleanText(value.playerLegend, 100);
  const opponentLegend = cleanText(value.opponentLegend, 100);
  const deckId = cleanText(value.deckId, 240);
  const format = value.format === null || value.format === "Bo1" || value.format === "Bo3" || value.format === "Auto" ? value.format : undefined;
  const wentFirst = value.wentFirst === null || value.wentFirst === "1st" || value.wentFirst === "2nd" ? value.wentFirst : undefined;
  const priorGameResult = value.priorGameResult === null || value.priorGameResult === "win" || value.priorGameResult === "loss" ? value.priorGameResult : undefined;
  if (!createdAt || !playerLegend || !opponentLegend || format === undefined || wentFirst === undefined || priorGameResult === undefined) return null;
  const ageMs = nowMs - Date.parse(createdAt);
  if (!Number.isFinite(ageMs) || ageMs < -60_000 || ageMs > LAB_TRAINING_HANDOFF_MAX_AGE_MS) return null;
  return {
    version: LAB_TRAINING_HANDOFF_VERSION,
    destination: value.destination,
    source: value.source,
    createdAt,
    playerLegend,
    opponentLegend,
    deckId,
    format,
    wentFirst,
    priorGameResult
  };
}

export function storeLabTrainingHandoff(storage: LabTrainingStorage, handoff: LabTrainingHandoff): boolean {
  try {
    storage.setItem(LAB_TRAINING_HANDOFF_STORAGE_KEY, serializeLabTrainingHandoff(handoff));
    return true;
  } catch {
    return false;
  }
}

/** Consumes only the intended lab's fresh context; another lab cannot steal it. */
export function consumeLabTrainingHandoff(
  storage: LabTrainingStorage,
  destination: LabTrainingDestination,
  nowMs = Date.now()
): LabTrainingHandoff | null {
  let raw: string | null;
  try {
    raw = storage.getItem(LAB_TRAINING_HANDOFF_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  const anyDestination = parseLabTrainingHandoff(raw, undefined, nowMs);
  if (!anyDestination) {
    try {
      storage.removeItem(LAB_TRAINING_HANDOFF_STORAGE_KEY);
    } catch {
      // Invalid context is already ignored when storage cannot be changed.
    }
    return null;
  }
  if (anyDestination.destination !== destination) return null;
  try {
    storage.removeItem(LAB_TRAINING_HANDOFF_STORAGE_KEY);
  } catch {
    // A valid handoff remains safe even when storage cannot remove it. Its
    // short expiry and one-time component initialization bound reuse.
  }
  return anyDestination;
}

/**
 * Resolves a saved deck without guessing: durable key first, then exact URL,
 * then a unique title + player-Legend pair.
 */
export function resolveLabTrainingDeckId(
  match: LabTrainingMatchDeckRef,
  decks: LabTrainingDeckCandidate[]
): string {
  const sourceKey = normalized(match.deckSourceKey || match.deckSourceId || "");
  if (sourceKey) {
    const keyed = decks.filter((deck) => [deck.id, deck.sourceKey].some((value) => normalized(value ?? "") === sourceKey));
    if (keyed.length === 1) return keyed[0].id;
  }
  const sourceUrl = cleanText(match.deckSourceUrl ?? "", 2_000);
  if (sourceUrl) {
    const byUrl = decks.filter((deck) => cleanText(deck.sourceUrl ?? "", 2_000) === sourceUrl);
    if (byUrl.length === 1) return byUrl[0].id;
  }
  const deckName = normalized(match.deckName ?? "");
  const playerLegend = normalized(match.playerLegend ?? "");
  if (!deckName || !playerLegend) return "";
  const named = decks.filter((deck) => normalized(deck.title) === deckName && normalized(deck.legend) === playerLegend);
  return named.length === 1 ? named[0].id : "";
}

function cleanText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") return "";
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned.length <= maximumLength ? cleaned : "";
}

function cleanIso(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) return "";
  return value;
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
