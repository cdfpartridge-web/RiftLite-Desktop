import type {
  GamePlatform,
  InsightDecisionAssessment,
  InsightDecisionContext,
  InsightDecisionFamily,
  InsightDecisionType,
  MatchDraft
} from "./types.js";

const INSIGHT_DECISION_FAMILIES = new Set<InsightDecisionFamily>([
  "scoring",
  "resources",
  "information",
  "battlefield",
  "combat",
  "mulligan",
  "sideboard",
  "other"
]);

const INSIGHT_DECISION_ASSESSMENTS = new Set<InsightDecisionAssessment>([
  "intentional",
  "forced",
  "missed",
  "unsure",
  "capture-wrong",
  "good-line"
]);

const INSIGHT_DECISIONS_BY_FAMILY: Record<InsightDecisionFamily, ReadonlySet<InsightDecisionType>> = {
  scoring: new Set(["scoring"]),
  resources: new Set(["resource-use"]),
  information: new Set(["information"]),
  battlefield: new Set(["battlefield-pick"]),
  combat: new Set(["combat"]),
  mulligan: new Set(["mulligan", "mulligan-keep", "mulligan-redraw"]),
  sideboard: new Set(["sideboard", "sideboard-in", "sideboard-out"]),
  other: new Set(["other", "sequencing"])
};

export interface PendingEnhancedInsightMarker {
  platform: GamePlatform;
  sessionStartedAt: string;
  decision: InsightDecisionContext;
}

export interface PendingEnhancedInsightMarkerNormalizationOptions {
  nowMs?: number;
  maxAgeMs?: number;
  maxMarkers?: number;
}

type EnhancedInsightDraftWindow = Pick<MatchDraft, "platform" | "capturedAt" | "updatedAt" | "insightContext">;

/**
 * Treat renderer persistence as untrusted input. Old or manually edited values
 * are normalized before they can reach the Match Review controls.
 */
export function normalizePendingEnhancedInsightMarkers(
  value: unknown,
  options: PendingEnhancedInsightMarkerNormalizationOptions = {}
): PendingEnhancedInsightMarker[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs! : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) && options.maxAgeMs! >= 0
    ? options.maxAgeMs!
    : Number.POSITIVE_INFINITY;
  const maxMarkers = Number.isInteger(options.maxMarkers) && options.maxMarkers! > 0
    ? options.maxMarkers!
    : value.length;
  return value
    .map(normalizePendingEnhancedInsightMarker)
    .filter((marker): marker is PendingEnhancedInsightMarker => {
      if (!marker) return false;
      const startedAt = Date.parse(marker.sessionStartedAt);
      return Number.isFinite(startedAt)
        && nowMs - startedAt <= maxAgeMs
        && nowMs >= startedAt - 60_000;
    })
    .slice(-maxMarkers);
}

export function normalizePendingEnhancedInsightMarker(value: unknown): PendingEnhancedInsightMarker | null {
  const marker = record(value);
  const decision = record(marker?.decision);
  if (!marker || !decision) return null;

  const platform = marker.platform;
  if (platform !== "atlas" && platform !== "tcga" && platform !== "sim") return null;
  const sessionStartedAt = validDateString(marker.sessionStartedAt);
  const id = nonEmptyString(decision.id);
  const createdAt = validDateString(decision.createdAt);
  if (!sessionStartedAt || !id || !createdAt || decision.source !== "live-flag") return null;

  const family = INSIGHT_DECISION_FAMILIES.has(decision.family as InsightDecisionFamily)
    ? decision.family as InsightDecisionFamily
    : "other";
  const assessment = INSIGHT_DECISION_ASSESSMENTS.has(decision.assessment as InsightDecisionAssessment)
    ? decision.assessment as InsightDecisionAssessment
    : "unsure";
  const decisionType = INSIGHT_DECISIONS_BY_FAMILY[family].has(decision.decision as InsightDecisionType)
    ? decision.decision as InsightDecisionType
    : undefined;
  const capturedAt = validDateString(decision.capturedAt) ?? createdAt;
  const subject = record(decision.subject);
  const normalizedSubject = subject ? {
    ...(optionalString(subject.cardKey) ? { cardKey: optionalString(subject.cardKey) } : {}),
    ...(optionalString(subject.cardName) ? { cardName: optionalString(subject.cardName) } : {}),
    ...(optionalString(subject.cardId) ? { cardId: optionalString(subject.cardId) } : {}),
    ...(optionalString(subject.battlefieldName) ? { battlefieldName: optionalString(subject.battlefieldName) } : {})
  } : undefined;
  const gameNumber = positiveInteger(decision.gameNumber);
  const timeMs = finiteNonNegativeNumber(decision.timeMs);
  const initiative = decision.initiative === "1st" || decision.initiative === "2nd"
    ? decision.initiative
    : undefined;

  return {
    platform,
    sessionStartedAt,
    decision: {
      id,
      capturedAt,
      family,
      assessment,
      source: "live-flag",
      createdAt,
      ...(decisionType ? { decision: decisionType } : {}),
      ...(gameNumber ? { gameNumber } : {}),
      ...(timeMs != null ? { timeMs } : {}),
      ...(initiative ? { initiative } : {}),
      ...(normalizedSubject && Object.keys(normalizedSubject).length ? { subject: normalizedSubject } : {}),
      ...(optionalString(decision.replayFlagId) ? { replayFlagId: optionalString(decision.replayFlagId) } : {}),
      ...(optionalString(decision.eventId) ? { eventId: optionalString(decision.eventId) } : {}),
      ...(optionalString(decision.goalId) ? { goalId: optionalString(decision.goalId) } : {}),
      ...(optionalString(decision.intendedPlan) ? { intendedPlan: optionalString(decision.intendedPlan) } : {}),
      ...(optionalString(decision.constraint) ? { constraint: optionalString(decision.constraint) } : {}),
      ...(optionalString(decision.alternative) ? { alternative: optionalString(decision.alternative) } : {}),
      ...(optionalString(decision.note) ? { note: optionalString(decision.note) } : {}),
      ...(validDateString(decision.updatedAt) ? { updatedAt: validDateString(decision.updatedAt) } : {})
    }
  };
}

/**
 * Finds markers for one captured session without consuming them. Consumption is
 * a separate durable-commit step so a failed draft save can always retry.
 */
export function enhancedInsightDecisionsForDraft(
  markers: readonly PendingEnhancedInsightMarker[],
  draft: EnhancedInsightDraftWindow
): InsightDecisionContext[] {
  const startedAt = Date.parse(draft.capturedAt);
  const endedAt = Date.parse(draft.updatedAt || new Date().toISOString());
  return markers
    .filter((marker) => {
      if (marker.platform !== draft.platform) {
        return false;
      }
      const markerAt = Date.parse(marker.decision.capturedAt || marker.decision.createdAt);
      const markerSessionStartedAt = Date.parse(marker.sessionStartedAt);
      const sameSession = !Number.isFinite(startedAt)
        || !Number.isFinite(markerSessionStartedAt)
        || Math.abs(markerSessionStartedAt - startedAt) <= 10_000;
      return sameSession && Number.isFinite(markerAt)
        && (!Number.isFinite(startedAt) || markerAt >= startedAt - 10_000)
        && (!Number.isFinite(endedAt) || markerAt <= endedAt + 30_000);
    })
    .map((marker) => marker.decision);
}

export function removePersistedEnhancedInsightMarkers(
  markers: readonly PendingEnhancedInsightMarker[],
  context: MatchDraft["insightContext"]
): PendingEnhancedInsightMarker[] {
  const persistedDecisionIds = new Set((context?.decisions ?? []).map((decision) => decision.id));
  if (!persistedDecisionIds.size) {
    return [...markers];
  }
  return markers.filter((marker) => !persistedDecisionIds.has(marker.decision.id));
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function validDateString(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function finiteNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
