import type { SideboardLabPlan, SideboardLabPlanFeedbackSummary, SideboardLabPriorGameResult } from "./sideboardLab.js";
import {
  isLabReviewDue,
  nextLabReviewProgress,
  type LabDecisionConfidence,
  type LabEvidenceTier,
  type LabReviewProgress,
} from "./labTraining.js";

export const SIDEBOARD_LAB_TRAINING_STORAGE_KEY = "riftlite:sideboard-lab-training:v1" as const;
export const SIDEBOARD_LAB_TRAINING_VERSION = 3 as const;
const MAX_ANSWERS = 500;
const MAX_SESSIONS = 100;

export interface SideboardLabTrainingAnswer {
  drillId: string;
  answeredAt: string;
  playerLegendCode: string;
  opponentLegendCode: string;
  priorGameResult: SideboardLabPriorGameResult;
  targetGameNumber: 2 | 3;
  confidence: LabDecisionConfidence | null;
  evidenceTier: LabEvidenceTier;
  review: LabReviewProgress | null;
  decisionMs: number | null;
  plan: SideboardLabPlan;
  summary: Pick<SideboardLabPlanFeedbackSummary, "aligned" | "different" | "ungraded" | "notableAlternatives" | "noChanges">;
}

export interface SideboardLabTrainingSession {
  id: string;
  completedAt: string;
  drillIds: string[];
  aligned: number;
  different: number;
  notableAlternatives: number;
}

export interface SideboardLabTrainingState {
  version: typeof SIDEBOARD_LAB_TRAINING_VERSION;
  answers: SideboardLabTrainingAnswer[];
  sessions: SideboardLabTrainingSession[];
  activeRunKey: string;
  activeDecisions: Record<string, SideboardLabPlan>;
}

export interface SideboardLabMasterySummary {
  contextsPractised: number;
  masteredContexts: number;
  reviewDue: number;
  uncertainContexts: number;
}

export function initialSideboardLabTrainingState(): SideboardLabTrainingState {
  return { version: SIDEBOARD_LAB_TRAINING_VERSION, answers: [], sessions: [], activeRunKey: "", activeDecisions: {} };
}

export function parseSideboardLabTrainingState(raw: string | null | undefined): SideboardLabTrainingState {
  if (!raw) return initialSideboardLabTrainingState();
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || (value.version !== 1 && value.version !== 2 && value.version !== SIDEBOARD_LAB_TRAINING_VERSION)) return initialSideboardLabTrainingState();
    const answers = Array.isArray(value.answers)
      ? value.answers.flatMap(parseAnswer).slice(-MAX_ANSWERS)
      : [];
    const sessions = Array.isArray(value.sessions)
      ? value.sessions.flatMap(parseSession).slice(-MAX_SESSIONS)
      : [];
    // Older v1 records did not identify the pack/mode that produced their
    // active decisions. Keep the answers, but leave that legacy run unbound so
    // it cannot auto-reveal a different or refreshed exercise.
    const activeRunKey = safeText(value.activeRunKey, 4_000) ?? "";
    const activeDecisions = parseActiveDecisions(value.activeDecisions);
    return { version: SIDEBOARD_LAB_TRAINING_VERSION, answers, sessions, activeRunKey, activeDecisions };
  } catch {
    return initialSideboardLabTrainingState();
  }
}

export function serializeSideboardLabTrainingState(state: SideboardLabTrainingState): string {
  return JSON.stringify({
    version: SIDEBOARD_LAB_TRAINING_VERSION,
    answers: state.answers.slice(-MAX_ANSWERS),
    sessions: state.sessions.slice(-MAX_SESSIONS),
    activeRunKey: state.activeRunKey,
    activeDecisions: state.activeDecisions
  });
}

export function recordSideboardLabTrainingAnswer(
  state: SideboardLabTrainingState,
  answer: SideboardLabTrainingAnswer,
  runKey?: string
): SideboardLabTrainingState {
  const normalized = parseAnswer(answer)[0];
  if (!normalized) return state;
  const nextRunKey = runKey === undefined ? state.activeRunKey : safeText(runKey, 4_000) ?? "";
  const sameRun = runKey === undefined || state.activeRunKey === nextRunKey;
  const answers = [...state.answers.filter((item) => item.drillId !== normalized.drillId), normalized].slice(-MAX_ANSWERS);
  return {
    ...state,
    answers,
    activeRunKey: nextRunKey,
    activeDecisions: { ...(sameRun ? state.activeDecisions : {}), [normalized.drillId]: normalized.plan }
  };
}

export function completeSideboardLabTrainingSession(
  state: SideboardLabTrainingState,
  session: SideboardLabTrainingSession
): SideboardLabTrainingState {
  const normalized = parseSession(session)[0];
  if (!normalized) return state;
  return {
    ...state,
    sessions: [...state.sessions.filter((item) => item.id !== normalized.id), normalized].slice(-MAX_SESSIONS),
    activeRunKey: "",
    activeDecisions: {}
  };
}

export function resetSideboardLabActiveRun(state: SideboardLabTrainingState): SideboardLabTrainingState {
  return { ...state, activeRunKey: "", activeDecisions: {} };
}

export function sideboardLabReviewAnswerIds(state: SideboardLabTrainingState): string[] {
  return state.answers
    .filter((answer) => isLabReviewDue(answer.review))
    .sort((left, right) => right.answeredAt.localeCompare(left.answeredAt))
    .map((answer) => answer.drillId);
}

export function sideboardLabScheduledReviewAnswerIds(state: SideboardLabTrainingState): string[] {
  return state.answers
    .filter((answer) => Boolean(answer.review))
    .sort((left, right) => (left.review?.dueAt ?? "").localeCompare(right.review?.dueAt ?? ""))
    .map((answer) => answer.drillId);
}

export function sideboardLabReviewProgressForAnswer(
  state: SideboardLabTrainingState,
  answer: Pick<SideboardLabTrainingAnswer, "drillId" | "answeredAt" | "confidence" | "evidenceTier" | "summary">,
  reviewing: boolean,
): LabReviewProgress | null {
  const previous = state.answers.find((item) => item.drillId === answer.drillId)?.review ?? null;
  return nextLabReviewProgress({
    answeredAt: answer.answeredAt,
    evidenceTier: answer.evidenceTier,
    confidence: answer.confidence,
    needsReview: answer.summary.different > 0 || answer.summary.notableAlternatives > 0,
    reviewing,
    previous,
  });
}

export function sideboardLabMasterySummary(state: SideboardLabTrainingState): SideboardLabMasterySummary {
  return {
    contextsPractised: state.answers.length,
    masteredContexts: state.answers.filter((answer) => (answer.review?.successfulReviews ?? 0) >= 3).length,
    reviewDue: state.answers.filter((answer) => isLabReviewDue(answer.review)).length,
    uncertainContexts: state.answers.filter((answer) => answer.confidence === "unsure" || answer.confidence === "guess").length,
  };
}

function parseAnswer(value: unknown): SideboardLabTrainingAnswer[] {
  if (!isRecord(value)) return [];
  const drillId = safeText(value.drillId, 160);
  const answeredAt = isoDate(value.answeredAt);
  const playerLegendCode = safeCode(value.playerLegendCode);
  const opponentLegendCode = safeCode(value.opponentLegendCode);
  const priorGameResult = value.priorGameResult === "win" || value.priorGameResult === "loss" ? value.priorGameResult : null;
  const targetGameNumber = value.targetGameNumber === undefined || value.targetGameNumber === 2 ? 2 as const : value.targetGameNumber === 3 ? 3 as const : null;
  const confidence = value.confidence === "certain" || value.confidence === "unsure" || value.confidence === "guess" ? value.confidence : null;
  const explicitTier = value.evidenceTier === "challenge" || value.evidenceTier === "guided" || value.evidenceTier === "explore"
    ? value.evidenceTier
    : null;
  const review = parseReview(value.review);
  const decisionMs = value.decisionMs === null || value.decisionMs === undefined
    ? null
    : boundedInteger(value.decisionMs, 0, 86_400_000);
  const plan = parsePlan(value.plan);
  const rawSummary = isRecord(value.summary) ? value.summary : null;
  if (!drillId || !answeredAt || !playerLegendCode || !opponentLegendCode || !priorGameResult || !targetGameNumber || !plan || !rawSummary) return [];
  const aligned = boundedInteger(rawSummary.aligned, 0, 100);
  const different = boundedInteger(rawSummary.different, 0, 100);
  const ungraded = boundedInteger(rawSummary.ungraded, 0, 100);
  const notableAlternatives = boundedInteger(rawSummary.notableAlternatives, 0, 100);
  if (aligned === null || different === null || ungraded === null || notableAlternatives === null || typeof rawSummary.noChanges !== "boolean") return [];
  const evidenceTier = explicitTier ?? (different > 0 || aligned > 0 || notableAlternatives > 0 ? "challenge" : "explore");
  return [{
    drillId,
    answeredAt,
    playerLegendCode,
    opponentLegendCode,
    priorGameResult,
    targetGameNumber,
    confidence,
    evidenceTier,
    review,
    decisionMs,
    plan,
    summary: { aligned, different, ungraded, notableAlternatives, noChanges: rawSummary.noChanges }
  }];
}

function parseReview(value: unknown): LabReviewProgress | null {
  if (!isRecord(value)) return null;
  const dueAt = isoDate(value.dueAt);
  const intervalDays = boundedInteger(value.intervalDays, 1, 365);
  const successfulReviews = boundedInteger(value.successfulReviews, 0, 100);
  return dueAt && intervalDays !== null && successfulReviews !== null
    ? { dueAt, intervalDays, successfulReviews }
    : null;
}

function parseSession(value: unknown): SideboardLabTrainingSession[] {
  if (!isRecord(value)) return [];
  const id = safeText(value.id, 160);
  const completedAt = isoDate(value.completedAt);
  const drillIds = Array.isArray(value.drillIds)
    ? value.drillIds.map((item) => safeText(item, 160)).filter((item): item is string => Boolean(item)).slice(0, 50)
    : [];
  const aligned = boundedInteger(value.aligned, 0, 5_000);
  const different = boundedInteger(value.different, 0, 5_000);
  const notableAlternatives = boundedInteger(value.notableAlternatives, 0, 5_000);
  if (!id || !completedAt || !drillIds.length || aligned === null || different === null || notableAlternatives === null) return [];
  return [{ id, completedAt, drillIds, aligned, different, notableAlternatives }];
}

function parseActiveDecisions(value: unknown): Record<string, SideboardLabPlan> {
  if (!isRecord(value)) return {};
  const result: Record<string, SideboardLabPlan> = {};
  for (const [key, candidate] of Object.entries(value).slice(0, 50)) {
    const id = safeText(key, 160);
    const plan = parsePlan(candidate);
    if (id && plan) result[id] = plan;
  }
  return result;
}

function parsePlan(value: unknown): SideboardLabPlan | null {
  if (!isRecord(value) || !isRecord(value.in) || !isRecord(value.out)) return null;
  const incoming = parseSelection(value.in);
  const outgoing = parseSelection(value.out);
  return incoming && outgoing ? { in: incoming, out: outgoing } : null;
}

function parseSelection(value: Record<string, unknown>): Record<string, number> | null {
  const result: Record<string, number> = {};
  for (const [rawCode, rawCount] of Object.entries(value)) {
    const code = safeCode(rawCode);
    const count = boundedInteger(rawCount, 1, 3);
    if (!code || count === null) return null;
    result[code] = count;
  }
  return result;
}

function safeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9*]+-[A-Z0-9*]+$/.test(normalized) && normalized.length <= 32 ? normalized : null;
}

function safeText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maximum ? text : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum ? Number(value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
