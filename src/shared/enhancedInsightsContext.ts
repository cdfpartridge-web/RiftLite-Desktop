import { resolveDeckMatchupGuide } from "./deckNotebook.js";
import type { ReplayInsightReflection } from "./replayCoaching.js";
import type {
  ReplayLearningCapability,
  ReplayLearningCapabilityReceipt
} from "./replayLearningSignals.js";
import type {
  DeckGuideCardRef,
  DeckGuideSection,
  DeckMatchupGuide,
  DeckNotebook,
  InsightNotebookSnapshot,
  ReplayFlag,
  ReplayRecord
} from "./types.js";

export const ENHANCED_INSIGHTS_CONTEXT_VERSION = 1 as const;

const MAX_FLAGS = 160;
const MAX_DECISION_CONTEXTS = 160;
const MAX_ACTIVE_GOALS = 20;
const MAX_CANDIDATES = 50;
const DEFAULT_MAX_CANDIDATES = 12;
const MAX_TEXT = 1_000;
const MAX_SEMANTIC_EVENT_MATCH_ROWS = 1_000;
const MAX_SEMANTIC_EVENT_MATCH_DISTANCE_MS = 30_000;

export type EnhancedInsightCapabilityKey =
  | "openingHand"
  | "cardTiming"
  | "resources"
  | "sideboard"
  | "combat"
  | "battlefield";

export type EnhancedInsightDecisionType =
  | "mulligan-keep"
  | "mulligan-redraw"
  | "mulligan"
  | "sideboard-in"
  | "sideboard-out"
  | "sideboard"
  | "battlefield-pick"
  | "resource-use"
  | "combat"
  | "sequencing"
  | "scoring"
  | "information"
  | "other";

export type EnhancedInsightDecisionAssessment = ReplayInsightReflection | "good-line";

export interface EnhancedInsightDecisionSubject {
  cardKey?: string;
  cardName?: string;
  cardId?: string;
  battlefieldName?: string;
}

/**
 * Optional player-owned context for one captured decision. This intentionally
 * records intent and constraints without asking the analysis layer to infer
 * either from a game result.
 */
export interface EnhancedInsightPlayerDecisionContext {
  id: string;
  replayId: string;
  decision: EnhancedInsightDecisionType;
  capturedAt?: string;
  videoTimeMs?: number;
  eventId?: string;
  flagId?: string;
  gameNumber?: number;
  initiative?: "1st" | "2nd";
  assessment?: EnhancedInsightDecisionAssessment;
  subject?: EnhancedInsightDecisionSubject;
  goalId?: string;
  intendedPlan?: string;
  constraint?: string;
  alternative?: string;
  note?: string;
}

/**
 * Structural mirror of the local match-owned context captured by Enhanced
 * Insights. Keeping this contract here lets the shared analysis stay usable
 * while the durable storage type is integrated elsewhere.
 */
export interface EnhancedInsightCapturedDecisionContext {
  id: string;
  gameNumber?: number;
  replayFlagId?: string;
  eventId?: string;
  capturedAt?: string;
  timeMs?: number;
  family: "scoring" | "resources" | "information" | "battlefield" | "combat" | "mulligan" | "sideboard" | "other";
  decision?: EnhancedInsightDecisionType;
  assessment?: "intentional" | "forced" | "missed" | "unsure" | "capture-wrong" | "good-line";
  subject?: EnhancedInsightDecisionSubject;
  initiative?: "1st" | "2nd";
  goalId?: string;
  intendedPlan?: string;
  constraint?: string;
  alternative?: string;
  note?: string;
  source: "live-flag" | "post-game" | "replay" | "coach-reflection";
  createdAt: string;
  updatedAt?: string;
}

export interface EnhancedInsightMatchContext {
  version: 1;
  capturedWithEnhancedInsights: boolean;
  planOutcome?: "followed" | "adapted" | "no-opportunity" | "unsure";
  sideboardPlanOutcome?: "followed" | "adapted" | "no-opportunity" | "unsure";
  activeGoalIds: readonly string[];
  decisions: readonly EnhancedInsightCapturedDecisionContext[];
  notebookSnapshot?: InsightNotebookSnapshot;
  postGamePromptCompletedAt?: string;
  updatedAt: string;
}

export interface EnhancedInsightContextInput {
  replay: ReplayRecord;
  capabilityReceipt?: ReplayLearningCapabilityReceipt | null;
  decisionContexts?: readonly EnhancedInsightPlayerDecisionContext[];
  matchInsightContext?: EnhancedInsightMatchContext | null;
  notebook?: DeckNotebook | null;
  opponentLegend?: string;
  maxReviewCandidates?: number;
}

export type EnhancedInsightEvidenceSource =
  | "replay-flag"
  | "player-context"
  | "saved-goal"
  | "saved-guide";

export interface EnhancedInsightEvidenceRef {
  source: EnhancedInsightEvidenceSource;
  id: string;
  replayId: string;
  label: string;
  capturedAt?: string;
  videoTimeMs?: number;
  eventId?: string;
}

export interface EnhancedInsightCapabilityReceiptRow {
  key: EnhancedInsightCapabilityKey;
  label: string;
  state: ReplayLearningCapability["state"];
  evidenceCount: number;
  detail: string;
}

export interface EnhancedInsightActiveGoal {
  id: string;
  text: string;
  createdAt: string;
  updatedAt?: string;
}

export type EnhancedInsightPlanComparisonStatus =
  | "consistent"
  | "deviation"
  | "conflict"
  | "not-covered";

export interface EnhancedInsightPlanComparison {
  id: string;
  decisionContextId: string;
  decision: EnhancedInsightDecisionType;
  subjectLabel: string;
  status: EnhancedInsightPlanComparisonStatus;
  matchedSections: string[];
  guideId: string;
  guideSource: "default" | "matchup";
}

export type EnhancedInsightPlanDeviationKind =
  | "kept-avoid-card"
  | "redrew-keep-card"
  | "boarded-in-out-card"
  | "boarded-out-in-card"
  | "battlefield-outside-priority"
  | "saved-plan-conflict"
  | "player-reported-plan-adaptation"
  | "player-reported-sideboard-adaptation";

export interface EnhancedInsightPlanDeviation {
  id: string;
  kind: EnhancedInsightPlanDeviationKind;
  decisionContextId: string;
  title: string;
  observation: string;
  reviewQuestion: string;
  subjectLabel: string;
  savedPlanSection: string;
  guideId: string;
  guideSource: "default" | "matchup";
  evidence: EnhancedInsightEvidenceRef[];
}

export type EnhancedInsightReviewCandidateKind =
  | "capture-correction"
  | "plan-deviation"
  | "decision-review"
  | "flag-review"
  | "goal-review";

export type EnhancedInsightReviewCandidateBasis =
  | "player-authored"
  | "saved-plan-comparison"
  | "player-reported-plan-outcome"
  | "player-authored-goal";

export type EnhancedInsightCandidateEvidenceState =
  | "available"
  | "partial"
  | "unknown"
  | "player-authored";

export interface EnhancedInsightReviewCandidate {
  id: string;
  kind: EnhancedInsightReviewCandidateKind;
  basis: EnhancedInsightReviewCandidateBasis;
  /** Every output is a prompt for review, never an optimal-play verdict. */
  verdict: "review-question";
  priority: number;
  title: string;
  observation: string;
  reviewQuestion: string;
  evidenceState: EnhancedInsightCandidateEvidenceState;
  relevantCapabilities: EnhancedInsightCapabilityReceiptRow[];
  evidence: EnhancedInsightEvidenceRef[];
  deviationId?: string;
  goalId?: string;
}

export interface EnhancedInsightsEvidenceReceipt {
  replayId: string;
  state: "no-evidence" | "player-context-only" | "context-limited" | "reviewable";
  capabilities: EnhancedInsightCapabilityReceiptRow[];
  playerAuthored: {
    flags: number;
    decisionContexts: number;
    assessedDecisions: number;
    notes: number;
    reportedPlanOutcomes: number;
  };
  savedPlan: {
    available: boolean;
    guideSource: "default" | "matchup" | "none";
    activeGoals: number;
    comparisons: number;
    consistent: number;
    deviations: number;
    conflicts: number;
  };
  limitations: string[];
}

export interface EnhancedInsightsContextReport {
  version: typeof ENHANCED_INSIGHTS_CONTEXT_VERSION;
  replayId: string;
  opponentLegend: string;
  activeGoals: EnhancedInsightActiveGoal[];
  planComparisons: EnhancedInsightPlanComparison[];
  planDeviations: EnhancedInsightPlanDeviation[];
  reviewCandidates: EnhancedInsightReviewCandidate[];
  evidenceReceipt: EnhancedInsightsEvidenceReceipt;
}

interface ResolvedGuide {
  guide: DeckMatchupGuide;
  source: "default" | "matchup";
}

interface CandidateDraft extends Omit<EnhancedInsightReviewCandidate, "relevantCapabilities" | "evidenceState"> {
  capabilityKeys: EnhancedInsightCapabilityKey[];
}

interface ComparisonResult {
  comparison: EnhancedInsightPlanComparison;
  deviation?: EnhancedInsightPlanDeviation;
}

const CAPABILITY_KEYS: readonly EnhancedInsightCapabilityKey[] = [
  "openingHand",
  "cardTiming",
  "resources",
  "sideboard",
  "combat",
  "battlefield"
];

const CAPABILITY_LABELS: Record<EnhancedInsightCapabilityKey, string> = {
  openingHand: "Opening hand",
  cardTiming: "Card timing",
  resources: "Resources",
  sideboard: "Sideboard",
  combat: "Combat",
  battlefield: "Battlefields"
};

/**
 * Builds a bounded, renderer-independent bridge from player-authored review
 * context and saved plans to factual coaching questions. The function never
 * labels a play optimal or upgrades missing capture into evidence of absence.
 */
export function buildEnhancedInsightsContext(input: EnhancedInsightContextInput): EnhancedInsightsContextReport {
  const replay = input.replay;
  const flags = boundedFlags(replay.flags ?? []);
  const contexts = boundedContexts([
    ...(input.decisionContexts ?? []),
    ...adaptMatchInsightContexts(replay, input.matchInsightContext)
  ], replay.id);
  const capabilityRows = capabilityReceiptRows(replay.id, input.capabilityReceipt);
  const matchGoalIds = new Set((input.matchInsightContext?.activeGoalIds ?? []).map(cleanText).filter(Boolean));
  const capturedGoalIds = new Set([
    ...matchGoalIds,
    ...contexts.map((context) => cleanText(context.goalId)).filter(Boolean)
  ]);
  const capturedNotebook = input.matchInsightContext?.notebookSnapshot;
  const activeGoals = (capturedNotebook
    ? snapshotGoals(capturedNotebook)
    : input.matchInsightContext
      ? []
      : activeNotebookGoals(input.notebook)
  ).filter((goal) => capturedGoalIds.has(goal.id));
  const explicitOpponent = cleanText(input.opponentLegend);
  const opponentLegend = cleanText(capturedNotebook?.opponentLegend)
    || explicitOpponent
    || cleanText(replay.matchSnapshot?.opponentChampion);
  const resolvedGuide = capturedNotebook
    ? (guideHasContent(capturedNotebook.guide)
        ? { guide: capturedNotebook.guide, source: capturedNotebook.guideSource }
        : null)
    : input.matchInsightContext
      ? null
      : resolveSavedGuide(input.notebook, opponentLegend);
  const flagById = new Map(flags.map((flag) => [flag.id, flag]));

  const comparisonResults = resolvedGuide
    ? contexts.flatMap((context) => {
        if (context.assessment === "wrong") return [];
        const result = compareDecisionWithGuide(replay.id, context, resolvedGuide, flagById);
        return result ? [result] : [];
      })
    : [];
  const planComparisons = comparisonResults.map((result) => result.comparison);
  const planDeviations = [
    ...comparisonResults.flatMap((result) => result.deviation ? [result.deviation] : []),
    ...playerReportedPlanAdaptations(replay.id, input.matchInsightContext, resolvedGuide)
  ];
  const deviatingContextIds = new Set(planDeviations.map((deviation) => deviation.decisionContextId));
  const suppressedLinkedFlagIds = new Set(contexts.flatMap((context) => {
    const linkedFlag = context.flagId ? flagById.get(context.flagId) : undefined;
    const generatedEnhancedFlag = linkedFlag?.id.startsWith("enhanced-insight-") === true;
    return linkedFlag && (generatedEnhancedFlag || (
      context.assessment !== "already-understood" && isRedundantLinkedFlag(linkedFlag)
    ))
      ? [linkedFlag.id]
      : [];
  }));
  const candidateDrafts: CandidateDraft[] = [];

  for (const deviation of planDeviations) {
    const context = contexts.find((candidate) => candidate.id === deviation.decisionContextId);
    const playerReported = deviation.kind === "player-reported-plan-adaptation"
      || deviation.kind === "player-reported-sideboard-adaptation";
    candidateDrafts.push({
      id: `candidate:${deviation.id}`,
      kind: "plan-deviation",
      basis: playerReported ? "player-reported-plan-outcome" : "saved-plan-comparison",
      verdict: "review-question",
      priority: deviation.kind === "saved-plan-conflict" ? 96 : playerReported ? 86 : 92,
      title: deviation.title,
      observation: deviation.observation,
      reviewQuestion: deviation.reviewQuestion,
      capabilityKeys: context
        ? capabilitiesForDecision(context.decision)
        : deviation.kind === "player-reported-sideboard-adaptation"
          ? ["sideboard"]
          : [],
      evidence: deviation.evidence,
      deviationId: deviation.id
    });
  }

  candidateDrafts.push(...playerReportedPlanOutcomeCandidates(
    replay.id,
    input.matchInsightContext,
    resolvedGuide
  ));

  for (const context of contexts) {
    if (deviatingContextIds.has(context.id) || context.assessment === "already-understood") continue;
    const candidate = decisionContextCandidate(replay.id, context, flagById);
    if (candidate) candidateDrafts.push(candidate);
  }

  for (const flag of flags) {
    if (suppressedLinkedFlagIds.has(flag.id)) continue;
    candidateDrafts.push(flagCandidate(replay.id, flag));
  }

  const playerEvidence = playerEvidenceRefs(replay.id, flags, contexts);
  if (playerEvidence.length) {
    for (const goal of activeGoals.slice(0, 3)) {
      const linkedContexts = contexts.filter((context) => cleanText(context.goalId) === goal.id);
      const evidence = linkedContexts.length
        ? linkedContexts.flatMap((context) => contextEvidence(replay.id, context, flagById))
        : playerEvidence.slice(0, 3);
      candidateDrafts.push({
        id: `candidate:goal:${stableToken(goal.id)}`,
        kind: "goal-review",
        basis: "player-authored-goal",
        verdict: "review-question",
        priority: 70,
        title: `Review against your goal: ${goal.text}`,
        observation: linkedContexts.length
          ? `${linkedContexts.length} player-recorded decision ${linkedContexts.length === 1 ? "was" : "were"} linked to this active goal.`
          : "The player linked this match to the active goal; RiftLite has not inferred whether the marked moments support it.",
        reviewQuestion: `Which marked decision is relevant to “${goal.text}”, and what repeatable condition did you learn?`,
        capabilityKeys: [],
        evidence: uniqueEvidence([
          goalEvidence(replay.id, goal),
          ...evidence
        ]),
        goalId: goal.id
      });
    }
  }

  const candidateLimit = clampCandidateLimit(input.maxReviewCandidates);
  const reviewCandidates = uniqueCandidates(candidateDrafts)
    .map((candidate) => finalizeCandidate(candidate, capabilityRows))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .slice(0, candidateLimit);

  const evidenceReceipt = buildEvidenceReceipt({
    replayId: replay.id,
    flags,
    contexts,
    capabilityRows,
    activeGoals,
    resolvedGuide,
    matchInsightContext: input.matchInsightContext,
    planComparisons,
    planDeviations
  });

  return {
    version: ENHANCED_INSIGHTS_CONTEXT_VERSION,
    replayId: replay.id,
    opponentLegend,
    activeGoals,
    planComparisons,
    planDeviations,
    reviewCandidates,
    evidenceReceipt
  };
}

function capabilityReceiptRows(
  replayId: string,
  receipt: ReplayLearningCapabilityReceipt | null | undefined
): EnhancedInsightCapabilityReceiptRow[] {
  return CAPABILITY_KEYS.map((key) => {
    const matchingReceipt = receipt?.replayId === replayId ? receipt : undefined;
    const capability = matchingReceipt?.[key];
    return {
      key,
      label: CAPABILITY_LABELS[key],
      state: capability?.state ?? "unknown",
      evidenceCount: safeCount(capability?.evidenceCount),
      detail: cleanText(capability?.detail)
        || (capability
          ? `${CAPABILITY_LABELS[key]} capability state was supplied without detail.`
          : "No matching replay capability receipt was supplied.")
    };
  });
}

function resolveSavedGuide(notebook: DeckNotebook | null | undefined, opponentLegend: string): ResolvedGuide | null {
  if (!notebook) return null;
  const resolved = resolveDeckMatchupGuide(notebook, opponentLegend);
  return guideHasContent(resolved.guide) ? resolved : null;
}

function guideHasContent(guide: DeckMatchupGuide): boolean {
  return [
    guide.mulligan.keep,
    guide.mulligan.consider,
    guide.mulligan.avoid,
    guide.sideboard.in,
    guide.sideboard.out,
    guide.battlefields.game1,
    guide.battlefields.game1First,
    guide.battlefields.game1Second
  ].some((section) => section.cards.length > 0 || Boolean(cleanText(section.note)))
    || Boolean(cleanText(guide.sideboard.note))
    || Boolean(cleanText(guide.battlefields.note))
    || guide.notes.some((note) => Boolean(cleanText(note.text)));
}

function guidePreboardHasContent(guide: DeckMatchupGuide): boolean {
  return [
    guide.mulligan.keep,
    guide.mulligan.consider,
    guide.mulligan.avoid,
    guide.battlefields.game1,
    guide.battlefields.game1First,
    guide.battlefields.game1Second
  ].some(sectionHasContent)
    || Boolean(cleanText(guide.battlefields.note))
    || guide.notes.some((note) => Boolean(cleanText(note.text)));
}

function guideSideboardHasContent(guide: DeckMatchupGuide): boolean {
  return [guide.sideboard.in, guide.sideboard.out].some(sectionHasContent)
    || Boolean(cleanText(guide.sideboard.note));
}

function sectionHasContent(section: DeckGuideSection): boolean {
  return section.cards.length > 0 || Boolean(cleanText(section.note));
}

function activeNotebookGoals(notebook: DeckNotebook | null | undefined): EnhancedInsightActiveGoal[] {
  if (!notebook) return [];
  return notebook.goals
    .filter((goal) => goal.status === "Active" && Boolean(cleanText(goal.text)))
    .slice(0, MAX_ACTIVE_GOALS)
    .map((goal) => ({
      id: cleanText(goal.id),
      text: cleanText(goal.text),
      createdAt: cleanText(goal.createdAt),
      ...(cleanText(goal.updatedAt) ? { updatedAt: cleanText(goal.updatedAt) } : {})
    }))
    .filter((goal) => Boolean(goal.id));
}

function snapshotGoals(snapshot: InsightNotebookSnapshot): EnhancedInsightActiveGoal[] {
  return snapshot.goals
    .slice(0, MAX_ACTIVE_GOALS)
    .map((goal) => ({
      id: cleanText(goal.id),
      text: cleanText(goal.text),
      createdAt: cleanText(goal.createdAt),
      ...(cleanText(goal.updatedAt) ? { updatedAt: cleanText(goal.updatedAt) } : {})
    }))
    .filter((goal) => Boolean(goal.id) && Boolean(goal.text));
}

function compareDecisionWithGuide(
  replayId: string,
  context: EnhancedInsightPlayerDecisionContext,
  resolved: ResolvedGuide,
  flagById: ReadonlyMap<string, ReplayFlag>
): ComparisonResult | null {
  const subjectLabel = decisionSubjectLabel(context.subject);
  if (!subjectLabel) return null;
  const { guide, source } = resolved;
  const sections = matchedGuideSections(guide, context.subject);
  const comparisonBase = {
    id: `plan:${stableToken(context.id)}`,
    decisionContextId: context.id,
    decision: context.decision,
    subjectLabel,
    guideId: guide.id,
    guideSource: source
  };
  const evidence = uniqueEvidence([
    ...contextEvidence(replayId, context, flagById),
    guideEvidence(replayId, guide, source)
  ]);

  if (context.decision === "mulligan-keep" || context.decision === "mulligan-redraw") {
    const relevant = sections.filter((section) => section.startsWith("mulligan."));
    if (!relevant.length) return { comparison: { ...comparisonBase, status: "not-covered", matchedSections: [] } };
    if (relevant.includes("mulligan.keep") && relevant.includes("mulligan.avoid")) {
      return conflictResult(comparisonBase, relevant, evidence, "mulligan Keep and Avoid");
    }
    const directional = relevant.filter((section) => section === "mulligan.keep" || section === "mulligan.avoid");
    if (!directional.length) {
      return { comparison: { ...comparisonBase, status: "not-covered", matchedSections: relevant } };
    }
    const deviates = context.decision === "mulligan-keep"
      ? relevant.includes("mulligan.avoid")
      : relevant.includes("mulligan.keep");
    if (!deviates) return { comparison: { ...comparisonBase, status: "consistent", matchedSections: relevant } };
    const kind: EnhancedInsightPlanDeviationKind = context.decision === "mulligan-keep" ? "kept-avoid-card" : "redrew-keep-card";
    const savedPlanSection = context.decision === "mulligan-keep" ? "Mulligan · Avoid" : "Mulligan · Keep";
    return deviationResult(
      comparisonBase,
      relevant,
      kind,
      context.decision === "mulligan-keep" ? `Kept ${subjectLabel} outside the saved mulligan plan` : `Redrew ${subjectLabel} outside the saved mulligan plan`,
      `The player recorded ${context.decision === "mulligan-keep" ? "keeping" : "redrawing"} ${subjectLabel}, while the saved ${source} guide lists it under ${context.decision === "mulligan-keep" ? "Avoid" : "Keep"}.`,
      "Was this a deliberate exception, a change in the matchup plan, or a saved guide entry that needs updating?",
      savedPlanSection,
      evidence
    );
  }

  if (context.decision === "sideboard-in" || context.decision === "sideboard-out") {
    const relevant = sections.filter((section) => section.startsWith("sideboard."));
    if (!relevant.length) return { comparison: { ...comparisonBase, status: "not-covered", matchedSections: [] } };
    if (relevant.includes("sideboard.in") && relevant.includes("sideboard.out")) {
      return conflictResult(comparisonBase, relevant, evidence, "sideboard In and Out");
    }
    const deviates = context.decision === "sideboard-in"
      ? relevant.includes("sideboard.out")
      : relevant.includes("sideboard.in");
    if (!deviates) return { comparison: { ...comparisonBase, status: "consistent", matchedSections: relevant } };
    const kind: EnhancedInsightPlanDeviationKind = context.decision === "sideboard-in" ? "boarded-in-out-card" : "boarded-out-in-card";
    const savedPlanSection = context.decision === "sideboard-in" ? "Sideboard · Out" : "Sideboard · In";
    return deviationResult(
      comparisonBase,
      relevant,
      kind,
      `${context.decision === "sideboard-in" ? "Boarded in" : "Boarded out"} ${subjectLabel} outside the saved plan`,
      `The player recorded ${context.decision === "sideboard-in" ? "boarding in" : "boarding out"} ${subjectLabel}, while the saved ${source} guide lists it under ${context.decision === "sideboard-in" ? "Out" : "In"}.`,
      "Was this a matchup-specific exception, a deck-version change, or a saved sideboard plan that needs revising?",
      savedPlanSection,
      evidence
    );
  }

  if (context.decision === "battlefield-pick") {
    const planned = battlefieldPlanSection(guide, context);
    if (!planned || !planned.section.cards.length) {
      return { comparison: { ...comparisonBase, status: "not-covered", matchedSections: [] } };
    }
    const matched = sectionHasSubject(planned.section, context.subject);
    if (matched) {
      return { comparison: { ...comparisonBase, status: "consistent", matchedSections: [planned.key] } };
    }
    return deviationResult(
      comparisonBase,
      [planned.key],
      "battlefield-outside-priority",
      `${subjectLabel} was outside the saved battlefield priority`,
      `The player recorded choosing ${subjectLabel}, while the saved ${source} guide's ${planned.label} priority names different battlefields.`,
      "Was this a deliberate exception based on the revealed set, initiative, or matchup plan—and should the saved guide be updated?",
      planned.label,
      evidence
    );
  }

  return null;
}

function playerReportedPlanAdaptations(
  replayId: string,
  matchContext: EnhancedInsightMatchContext | null | undefined,
  resolvedGuide: ResolvedGuide | null
): EnhancedInsightPlanDeviation[] {
  if (!matchContext || !resolvedGuide) return [];
  const { guide, source } = resolvedGuide;
  const guideRef = guideEvidence(replayId, guide, source);
  const capturedAt = cleanText(matchContext.postGamePromptCompletedAt || matchContext.updatedAt);
  const reported = (
    id: string,
    kind: "player-reported-plan-adaptation" | "player-reported-sideboard-adaptation",
    subjectLabel: string,
    savedPlanSection: string,
    reviewQuestion: string
  ): EnhancedInsightPlanDeviation => ({
    id: `deviation:${id}:${kind}`,
    kind,
    decisionContextId: id,
    title: `Player reported adapting the saved ${subjectLabel.toLocaleLowerCase("en")}`,
    observation: `The post-game context records an adaptation from the saved ${source} ${subjectLabel.toLocaleLowerCase("en")}. RiftLite has not inferred which instruction changed or whether the adaptation helped.`,
    reviewQuestion,
    subjectLabel,
    savedPlanSection,
    guideId: guide.id,
    guideSource: source,
    evidence: uniqueEvidence([{
      source: "player-context",
      id,
      replayId,
      label: `Player-reported ${subjectLabel.toLocaleLowerCase("en")} adaptation`,
      ...(capturedAt ? { capturedAt } : {})
    }, guideRef])
  });
  const deviations: EnhancedInsightPlanDeviation[] = [];
  if (matchContext.planOutcome === "adapted" && guidePreboardHasContent(guide)) {
    deviations.push(reported(
      "match-plan-outcome",
      "player-reported-plan-adaptation",
      "Pre-board plan",
      source === "matchup" ? "Saved matchup plan" : "Saved default plan",
      "Which saved instruction changed, what visible condition triggered the change, and should the guide record that exception?"
    ));
  }
  if (matchContext.sideboardPlanOutcome === "adapted" && guideSideboardHasContent(guide)) {
    deviations.push(reported(
      "match-sideboard-plan-outcome",
      "player-reported-sideboard-adaptation",
      "Sideboard plan",
      "Saved sideboard plan",
      "Which card swap changed, what matchup evidence triggered it, and should the saved sideboard guide be updated?"
    ));
  }
  return deviations;
}

function playerReportedPlanOutcomeCandidates(
  replayId: string,
  matchContext: EnhancedInsightMatchContext | null | undefined,
  resolvedGuide: ResolvedGuide | null
): CandidateDraft[] {
  if (!matchContext) return [];
  const capturedAt = cleanText(matchContext.postGamePromptCompletedAt || matchContext.updatedAt);
  const candidate = (
    scope: "plan" | "sideboard",
    outcome: NonNullable<EnhancedInsightMatchContext["planOutcome"]>
  ): CandidateDraft | null => {
    const isSideboard = scope === "sideboard";
    const hasApplicableGuide = Boolean(resolvedGuide && (
      isSideboard ? guideSideboardHasContent(resolvedGuide.guide) : guidePreboardHasContent(resolvedGuide.guide)
    ));
    if (outcome === "adapted" && hasApplicableGuide) {
      return null;
    }
    const scopeLabel = isSideboard ? "sideboard plan" : "game plan";
    const id = `match-${scope}-plan-outcome`;
    const evidence = uniqueEvidence([{
      source: "player-context",
      id,
      replayId,
      label: `Player-reported ${scopeLabel}: ${outcome}`,
      ...(capturedAt ? { capturedAt } : {})
    }, ...(resolvedGuide ? [guideEvidence(replayId, resolvedGuide.guide, resolvedGuide.source)] : [])]);
    const copy = outcome === "followed"
      ? {
          title: `Review the reported ${scopeLabel} follow-through`,
          observation: `The player reported following the ${scopeLabel}. RiftLite has not inferred which decision demonstrated that follow-through or whether it caused the result.`,
          reviewQuestion: `Which captured moment best demonstrates the ${scopeLabel}, and what visible condition made that line appropriate?`
        }
      : outcome === "no-opportunity"
        ? {
            title: `Review why the ${scopeLabel} had no opportunity`,
            observation: `The player reported no opportunity to apply the ${scopeLabel}. RiftLite has not inferred what prevented it.`,
            reviewQuestion: `What game-state condition prevented the ${scopeLabel}, and should the plan include a fallback for that condition?`
          }
        : outcome === "unsure"
          ? {
              title: `Clarify the reported ${scopeLabel} uncertainty`,
              observation: `The player was unsure whether the ${scopeLabel} was followed. Missing or partial capture must remain unknown.`,
              reviewQuestion: `Which retained moment would help decide whether the ${scopeLabel} applied, and what evidence is still missing?`
            }
          : {
              title: `Describe the reported ${scopeLabel} adaptation`,
              observation: `The player reported adapting the ${scopeLabel}, but no populated applicable saved guide was captured for an exact comparison.`,
              reviewQuestion: `What instruction or expectation changed, what visible condition triggered it, and should that exception be saved for future games?`
            };
    return {
      id: `candidate:${id}:${outcome}`,
      kind: "decision-review",
      basis: "player-reported-plan-outcome",
      verdict: "review-question",
      priority: outcome === "adapted" ? 84 : outcome === "followed" ? 66 : 62,
      ...copy,
      capabilityKeys: isSideboard ? ["sideboard"] : [],
      evidence
    };
  };

  return [
    matchContext.planOutcome ? candidate("plan", matchContext.planOutcome) : null,
    matchContext.sideboardPlanOutcome ? candidate("sideboard", matchContext.sideboardPlanOutcome) : null
  ].filter((item): item is CandidateDraft => Boolean(item));
}

function deviationResult(
  comparisonBase: Omit<EnhancedInsightPlanComparison, "status" | "matchedSections">,
  matchedSections: string[],
  kind: EnhancedInsightPlanDeviationKind,
  title: string,
  observation: string,
  reviewQuestion: string,
  savedPlanSection: string,
  evidence: EnhancedInsightEvidenceRef[]
): ComparisonResult {
  const deviation: EnhancedInsightPlanDeviation = {
    id: `deviation:${stableToken(comparisonBase.decisionContextId)}:${kind}`,
    kind,
    decisionContextId: comparisonBase.decisionContextId,
    title,
    observation,
    reviewQuestion,
    subjectLabel: comparisonBase.subjectLabel,
    savedPlanSection,
    guideId: comparisonBase.guideId,
    guideSource: comparisonBase.guideSource,
    evidence
  };
  return {
    comparison: { ...comparisonBase, status: "deviation", matchedSections },
    deviation
  };
}

function conflictResult(
  comparisonBase: Omit<EnhancedInsightPlanComparison, "status" | "matchedSections">,
  matchedSections: string[],
  evidence: EnhancedInsightEvidenceRef[],
  conflictLabel: string
): ComparisonResult {
  const deviation: EnhancedInsightPlanDeviation = {
    id: `deviation:${stableToken(comparisonBase.decisionContextId)}:saved-plan-conflict`,
    kind: "saved-plan-conflict",
    decisionContextId: comparisonBase.decisionContextId,
    title: `${comparisonBase.subjectLabel} has conflicting saved-plan labels`,
    observation: `The saved ${comparisonBase.guideSource} guide lists ${comparisonBase.subjectLabel} under both ${conflictLabel}. RiftLite cannot use that plan as directional guidance.`,
    reviewQuestion: "Which saved instruction reflects the current plan?",
    subjectLabel: comparisonBase.subjectLabel,
    savedPlanSection: conflictLabel,
    guideId: comparisonBase.guideId,
    guideSource: comparisonBase.guideSource,
    evidence
  };
  return {
    comparison: { ...comparisonBase, status: "conflict", matchedSections },
    deviation
  };
}

function matchedGuideSections(guide: DeckMatchupGuide, subject: EnhancedInsightDecisionSubject | undefined): string[] {
  if (!subject) return [];
  return [
    ["mulligan.keep", guide.mulligan.keep],
    ["mulligan.consider", guide.mulligan.consider],
    ["mulligan.avoid", guide.mulligan.avoid],
    ["sideboard.in", guide.sideboard.in],
    ["sideboard.out", guide.sideboard.out],
    ["battlefields.game1", guide.battlefields.game1],
    ["battlefields.game1First", guide.battlefields.game1First],
    ["battlefields.game1Second", guide.battlefields.game1Second]
  ].flatMap(([key, section]) => sectionHasSubject(section as DeckGuideSection, subject) ? [key as string] : []);
}

function battlefieldPlanSection(
  guide: DeckMatchupGuide,
  context: EnhancedInsightPlayerDecisionContext
): { key: string; label: string; section: DeckGuideSection } | null {
  if (context.gameNumber !== 1) return null;
  if (context.initiative === "1st" && guide.battlefields.game1First.cards.length) {
    return { key: "battlefields.game1First", label: "Game 1 going first", section: guide.battlefields.game1First };
  }
  if (context.initiative === "2nd" && guide.battlefields.game1Second.cards.length) {
    return { key: "battlefields.game1Second", label: "Game 1 going second", section: guide.battlefields.game1Second };
  }
  return guide.battlefields.game1.cards.length
    ? { key: "battlefields.game1", label: "Game 1", section: guide.battlefields.game1 }
    : null;
}

function sectionHasSubject(section: DeckGuideSection, subject: EnhancedInsightDecisionSubject | undefined): boolean {
  if (!subject) return false;
  const subjectTokens = identityTokens(subject);
  if (!subjectTokens.size) return false;
  return section.cards.some((card) => identitiesOverlap(subjectTokens, cardIdentityTokens(card)));
}

function identityTokens(subject: EnhancedInsightDecisionSubject): Set<string> {
  return new Set([
    subject.cardKey,
    subject.cardName,
    subject.cardId,
    subject.battlefieldName
  ].map(normalizedIdentity).filter(Boolean));
}

function cardIdentityTokens(card: DeckGuideCardRef): Set<string> {
  return new Set([card.cardKey, card.cardName, card.cardId].map(normalizedIdentity).filter(Boolean));
}

function identitiesOverlap(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return [...left].some((token) => right.has(token));
}

function decisionContextCandidate(
  replayId: string,
  context: EnhancedInsightPlayerDecisionContext,
  flagById: ReadonlyMap<string, ReplayFlag>
): CandidateDraft | null {
  const assessment = context.assessment;
  const subject = decisionSubjectLabel(context.subject) || "this decision";
  const common = {
    id: `candidate:context:${stableToken(context.id)}`,
    basis: "player-authored" as const,
    verdict: "review-question" as const,
    capabilityKeys: capabilitiesForDecision(context.decision),
    evidence: contextEvidence(replayId, context, flagById)
  };
  if (assessment === "wrong") {
    return {
      ...common,
      kind: "capture-correction",
      priority: 100,
      title: `Verify the captured context for ${subject}`,
      observation: "The player marked this interpretation as wrong. No coaching claim should rely on it until the underlying evidence is corrected or dismissed.",
      reviewQuestion: "Which captured detail is wrong, and what should the replay record show instead?"
    };
  }
  if (assessment === "missed") {
    return {
      ...common,
      kind: "decision-review",
      priority: 89,
      title: `Turn the missed ${subject} trigger into a cue`,
      observation: "The player marked this decision as missed; RiftLite has not inferred which alternative was preferable.",
      reviewQuestion: "What visible trigger would help you notice this decision earlier next time?"
    };
  }
  if (assessment === "forced") {
    return {
      ...common,
      kind: "decision-review",
      priority: 84,
      title: `Record the constraint behind ${subject}`,
      observation: "The player marked this line as forced. The constraint is player-owned context, not something RiftLite can safely infer from the result.",
      reviewQuestion: context.constraint
        ? `Does “${cleanText(context.constraint)}” fully explain why the alternatives were unavailable?`
        : "Which resource, card, rule, or board constraint removed the alternatives?"
    };
  }
  if (assessment === "intentional") {
    return {
      ...common,
      kind: "decision-review",
      priority: 76,
      title: `Make the condition behind ${subject} explicit`,
      observation: "The player marked this line as intentional. That context should condition future coaching rather than be treated as an automatic mistake.",
      reviewQuestion: context.intendedPlan
        ? `When does the plan “${cleanText(context.intendedPlan)}” apply, and when would you choose a different line?`
        : "What game-state condition made this line intentional, and when would that condition not apply?"
    };
  }
  if (assessment === "good-line") {
    return {
      ...common,
      kind: "decision-review",
      priority: 72,
      title: `Make the success condition behind ${subject} reusable`,
      observation: "The player marked this as a good line. RiftLite has not treated the result as proof that the choice generalises.",
      reviewQuestion: "Which visible conditions made this line work, and which change would make you choose differently?"
    };
  }
  if (assessment === "unsure" || !assessment) {
    return {
      ...common,
      kind: "decision-review",
      priority: assessment === "unsure" ? 78 : 64,
      title: `Review the alternatives around ${subject}`,
      observation: assessment === "unsure"
        ? "The player marked this decision as uncertain."
        : "The player supplied decision context without judging whether the line was correct.",
      reviewQuestion: context.alternative
        ? `What evidence would distinguish this line from “${cleanText(context.alternative)}” in a comparable game?`
        : "What was the plan, what alternative was available, and which condition separated the two?"
    };
  }
  return null;
}

function flagCandidate(replayId: string, flag: ReplayFlag): CandidateDraft {
  const label = cleanText(flag.label) || flagTypeLabel(flag);
  const evidence = [flagEvidence(replayId, flag)];
  const common = {
    id: `candidate:flag:${stableToken(flag.id)}`,
    basis: "player-authored" as const,
    verdict: "review-question" as const,
    evidence
  };
  if (flag.type === "rules-check") {
    return {
      ...common,
      kind: "flag-review",
      priority: 94,
      title: `Resolve the rules question: ${label}`,
      observation: "The player marked this moment for a rules check. Strategy conclusions should wait until the governing rule is verified.",
      reviewQuestion: "Which rule determines the available choices at this moment?",
      capabilityKeys: []
    };
  }
  if (flag.type === "mistake") {
    return {
      ...common,
      kind: "flag-review",
      priority: 88,
      title: `Review the player-marked mistake: ${label}`,
      observation: "This moment was labelled as a mistake by the player; RiftLite has not independently judged the play.",
      reviewQuestion: "What alternative did you consider, and what captured condition would make it preferable next time?",
      capabilityKeys: []
    };
  }
  if (flag.type === "good-line") {
    return {
      ...common,
      kind: "flag-review",
      priority: 72,
      title: `Explain the player-marked good line: ${label}`,
      observation: "This line was marked positively by the player. The result alone is not treated as proof that it generalises.",
      reviewQuestion: "Which conditions made this line work, and are those conditions repeatable?",
      capabilityKeys: []
    };
  }
  if (flag.type === "missed-lethal") {
    return {
      ...common,
      kind: "flag-review",
      priority: 90,
      title: `Reconstruct the player-marked lethal: ${label}`,
      observation: "The player marked a possible missed lethal; RiftLite has not verified that the line was legal or deterministic.",
      reviewQuestion: "Which captured cards, resources, and combat outcomes made lethal possible, and when did the window first appear?",
      capabilityKeys: ["cardTiming", "resources", "combat"]
    };
  }
  if (flag.type === "battlefield-decision") {
    return {
      ...common,
      kind: "flag-review",
      priority: 82,
      title: `Review the battlefield decision: ${label}`,
      observation: "The player marked this battlefield decision for review; later scoring is context, not proof of decision quality.",
      reviewQuestion: "What was the battlefield priority, what alternative was considered, and what later evidence is relevant?",
      capabilityKeys: ["battlefield", "combat"]
    };
  }
  return {
    ...common,
    kind: "flag-review",
    priority: 68,
    title: `Review the marked moment: ${label}`,
    observation: cleanText(flag.note) || "The player marked this replay moment for review.",
    reviewQuestion: "What was the plan, what alternative was available, and what immediate consequence followed?",
    capabilityKeys: []
  };
}

function capabilitiesForDecision(decision: EnhancedInsightDecisionType): EnhancedInsightCapabilityKey[] {
  if (decision === "mulligan-keep" || decision === "mulligan-redraw" || decision === "mulligan") return ["openingHand", "cardTiming"];
  if (decision === "sideboard-in" || decision === "sideboard-out" || decision === "sideboard") return ["sideboard"];
  if (decision === "battlefield-pick") return ["battlefield"];
  if (decision === "resource-use") return ["resources"];
  if (decision === "combat") return ["combat"];
  if (decision === "sequencing") return ["cardTiming", "resources"];
  if (decision === "scoring") return ["battlefield", "combat"];
  if (decision === "information") return ["cardTiming"];
  return [];
}

function finalizeCandidate(
  candidate: CandidateDraft,
  capabilityRows: EnhancedInsightCapabilityReceiptRow[]
): EnhancedInsightReviewCandidate {
  const relevantCapabilities = candidate.capabilityKeys
    .map((key) => capabilityRows.find((row) => row.key === key))
    .filter((row): row is EnhancedInsightCapabilityReceiptRow => Boolean(row));
  const evidenceState: EnhancedInsightCandidateEvidenceState = relevantCapabilities.length === 0
    ? "player-authored"
    : relevantCapabilities.every((row) => row.state === "available")
      ? "available"
      : relevantCapabilities.some((row) => row.state === "available" || row.state === "partial")
        ? "partial"
        : "unknown";
  const { capabilityKeys: _capabilityKeys, ...rest } = candidate;
  return {
    ...rest,
    evidenceState,
    relevantCapabilities,
    evidence: uniqueEvidence(candidate.evidence)
  };
}

function buildEvidenceReceipt(input: {
  replayId: string;
  flags: ReplayFlag[];
  contexts: EnhancedInsightPlayerDecisionContext[];
  capabilityRows: EnhancedInsightCapabilityReceiptRow[];
  activeGoals: EnhancedInsightActiveGoal[];
  resolvedGuide: ResolvedGuide | null;
  matchInsightContext: EnhancedInsightMatchContext | null | undefined;
  planComparisons: EnhancedInsightPlanComparison[];
  planDeviations: EnhancedInsightPlanDeviation[];
}): EnhancedInsightsEvidenceReceipt {
  const availableCapabilities = input.capabilityRows.filter((row) => row.state === "available").length;
  const partialCapabilities = input.capabilityRows.filter((row) => row.state === "partial").length;
  const reportedPlanOutcomes = [input.matchInsightContext?.planOutcome, input.matchInsightContext?.sideboardPlanOutcome]
    .filter((outcome) => Boolean(outcome)).length;
  const playerEvidence = input.flags.length + input.contexts.length + reportedPlanOutcomes;
  const state: EnhancedInsightsEvidenceReceipt["state"] = playerEvidence === 0 && availableCapabilities === 0 && partialCapabilities === 0
    ? "no-evidence"
    : availableCapabilities === 0 && partialCapabilities === 0
      ? "player-context-only"
      : input.capabilityRows.some((row) => row.state !== "available")
        ? "context-limited"
        : "reviewable";
  const limitations: string[] = [];
  const unknown = input.capabilityRows.filter((row) => row.state === "unknown").map((row) => row.label);
  const partial = input.capabilityRows.filter((row) => row.state === "partial").map((row) => row.label);
  if (unknown.length) limitations.push(`Unknown capture capabilities: ${unknown.join(", ")}. Unknown means uncaptured, not that an action did not happen.`);
  if (partial.length) limitations.push(`Partial capture capabilities: ${partial.join(", ")}. Review questions must stay within the retained evidence.`);
  if (!input.resolvedGuide) limitations.push("No populated saved matchup/default guide was available, so RiftLite did not infer plan deviations.");
  if (!input.contexts.length) limitations.push("No decision-level player context was supplied; plan outcomes and replay flags cannot identify a specific alternative on their own.");
  if (playerEvidence === 0 && (input.resolvedGuide || input.activeGoals.length)) {
    limitations.push("Saved plans and goals provide review context, but they are not evidence that a replay decision occurred.");
  }
  return {
    replayId: input.replayId,
    state,
    capabilities: input.capabilityRows,
    playerAuthored: {
      flags: input.flags.length,
      decisionContexts: input.contexts.length,
      assessedDecisions: input.contexts.filter((context) => Boolean(context.assessment)).length,
      notes: input.flags.filter((flag) => Boolean(cleanText(flag.note))).length
        + input.contexts.filter((context) => Boolean(cleanText(context.note))).length,
      reportedPlanOutcomes
    },
    savedPlan: {
      available: Boolean(input.resolvedGuide),
      guideSource: input.resolvedGuide?.source ?? "none",
      activeGoals: input.activeGoals.length,
      comparisons: input.planComparisons.length,
      consistent: input.planComparisons.filter((comparison) => comparison.status === "consistent").length,
      deviations: input.planDeviations.filter((deviation) => deviation.kind !== "saved-plan-conflict").length,
      conflicts: input.planDeviations.filter((deviation) => deviation.kind === "saved-plan-conflict").length
    },
    limitations
  };
}

function boundedFlags(flags: readonly ReplayFlag[]): ReplayFlag[] {
  const seen = new Set<string>();
  return [...flags]
    .filter((flag) => {
      const id = cleanText(flag.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((left, right) => eventTime(left.capturedAt || left.createdAt) - eventTime(right.capturedAt || right.createdAt)
      || safeTimeMs(left.timeMs) - safeTimeMs(right.timeMs)
      || left.id.localeCompare(right.id))
    .slice(0, MAX_FLAGS);
}

function adaptMatchInsightContexts(
  replay: ReplayRecord,
  matchContext: EnhancedInsightMatchContext | null | undefined
): EnhancedInsightPlayerDecisionContext[] {
  if (!matchContext) return [];
  return matchContext.decisions.map((context) => {
    const capturedAt = cleanText(context.capturedAt || context.createdAt);
    const gameNumber = positiveInteger(context.gameNumber);
    const explicitEventId = cleanText(context.eventId);
    const eventId = explicitEventId || nearestSameGameStructuredEventId(replay, capturedAt, gameNumber);
    return {
      id: context.id,
      replayId: replay.id,
      decision: context.decision ?? decisionTypeFromFamily(context.family),
      ...(capturedAt ? { capturedAt } : {}),
      ...(finiteNonNegative(context.timeMs) != null ? { videoTimeMs: finiteNonNegative(context.timeMs) } : {}),
      ...(eventId ? { eventId } : {}),
      ...(cleanText(context.replayFlagId) ? { flagId: cleanText(context.replayFlagId) } : {}),
      ...(gameNumber ? { gameNumber } : {}),
      ...(context.initiative ? { initiative: context.initiative } : {}),
      ...(context.assessment ? { assessment: context.assessment === "capture-wrong" ? "wrong" : context.assessment } : {}),
      ...(context.subject ? {
        subject: {
          cardKey: cleanText(context.subject.cardKey) || undefined,
          cardName: cleanText(context.subject.cardName) || undefined,
          cardId: cleanText(context.subject.cardId) || undefined,
          battlefieldName: cleanText(context.subject.battlefieldName) || undefined
        }
      } : {}),
      ...(cleanText(context.goalId) ? { goalId: cleanText(context.goalId) } : {}),
      ...(cleanText(context.intendedPlan) ? { intendedPlan: cleanText(context.intendedPlan) } : {}),
      ...(cleanText(context.constraint) ? { constraint: cleanText(context.constraint) } : {}),
      ...(cleanText(context.alternative) ? { alternative: cleanText(context.alternative) } : {}),
      ...(cleanText(context.note) ? { note: cleanText(context.note) } : {})
    };
  });
}

function nearestSameGameStructuredEventId(
  replay: ReplayRecord,
  capturedAt: string,
  gameNumber: number | undefined
): string {
  const markerAt = Date.parse(capturedAt);
  if (!Number.isFinite(markerAt) || gameNumber == null) return "";
  let nearest: { id: string; distanceMs: number; capturedAtMs: number } | null = null;
  for (const event of (replay.structuredEvents ?? []).slice(-MAX_SEMANTIC_EVENT_MATCH_ROWS)) {
    if (positiveInteger(event.gameNumber) !== gameNumber) continue;
    const id = cleanText(event.id);
    const capturedAtMs = Date.parse(event.capturedAt);
    if (!id || !Number.isFinite(capturedAtMs)) continue;
    const distanceMs = Math.abs(capturedAtMs - markerAt);
    if (distanceMs > MAX_SEMANTIC_EVENT_MATCH_DISTANCE_MS) continue;
    if (!nearest
      || distanceMs < nearest.distanceMs
      || (distanceMs === nearest.distanceMs && capturedAtMs <= markerAt && nearest.capturedAtMs > markerAt)) {
      nearest = { id, distanceMs, capturedAtMs };
    }
  }
  return nearest?.id ?? "";
}

function decisionTypeFromFamily(family: EnhancedInsightCapturedDecisionContext["family"]): EnhancedInsightDecisionType {
  if (family === "resources") return "resource-use";
  if (family === "battlefield") return "battlefield-pick";
  return family;
}

function boundedContexts(
  contexts: readonly EnhancedInsightPlayerDecisionContext[],
  replayId: string
): EnhancedInsightPlayerDecisionContext[] {
  const seen = new Set<string>();
  return contexts
    .filter((context) => cleanText(context.replayId) === replayId)
    .filter((context) => {
      const id = cleanText(context.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, MAX_DECISION_CONTEXTS)
    .map((context) => ({
      ...context,
      id: cleanText(context.id),
      replayId,
      capturedAt: cleanText(context.capturedAt) || undefined,
      videoTimeMs: finiteNonNegative(context.videoTimeMs),
      eventId: cleanText(context.eventId) || undefined,
      flagId: cleanText(context.flagId) || undefined,
      gameNumber: positiveInteger(context.gameNumber),
      subject: context.subject ? {
        cardKey: cleanText(context.subject.cardKey) || undefined,
        cardName: cleanText(context.subject.cardName) || undefined,
        cardId: cleanText(context.subject.cardId) || undefined,
        battlefieldName: cleanText(context.subject.battlefieldName) || undefined
      } : undefined,
      goalId: cleanText(context.goalId) || undefined,
      intendedPlan: cleanText(context.intendedPlan) || undefined,
      constraint: cleanText(context.constraint) || undefined,
      alternative: cleanText(context.alternative) || undefined,
      note: cleanText(context.note) || undefined
    }));
}

function playerEvidenceRefs(
  replayId: string,
  flags: readonly ReplayFlag[],
  contexts: readonly EnhancedInsightPlayerDecisionContext[]
): EnhancedInsightEvidenceRef[] {
  return uniqueEvidence([
    ...flags.map((flag) => flagEvidence(replayId, flag)),
    ...contexts.map((context) => decisionEvidence(replayId, context))
  ]);
}

function contextEvidence(
  replayId: string,
  context: EnhancedInsightPlayerDecisionContext,
  flagById: ReadonlyMap<string, ReplayFlag>
): EnhancedInsightEvidenceRef[] {
  const linkedFlag = context.flagId ? flagById.get(context.flagId) : undefined;
  return uniqueEvidence([
    decisionEvidence(replayId, context),
    ...(linkedFlag ? [flagEvidence(replayId, linkedFlag)] : [])
  ]);
}

function decisionEvidence(replayId: string, context: EnhancedInsightPlayerDecisionContext): EnhancedInsightEvidenceRef {
  const subject = decisionSubjectLabel(context.subject);
  return {
    source: "player-context",
    id: context.id,
    replayId,
    label: subject ? `${decisionLabel(context.decision)} · ${subject}` : decisionLabel(context.decision),
    ...(context.capturedAt ? { capturedAt: context.capturedAt } : {}),
    ...(typeof context.videoTimeMs === "number" ? { videoTimeMs: context.videoTimeMs } : {}),
    ...(context.eventId ? { eventId: context.eventId } : {})
  };
}

function flagEvidence(replayId: string, flag: ReplayFlag): EnhancedInsightEvidenceRef {
  return {
    source: "replay-flag",
    id: flag.id,
    replayId,
    label: cleanText(flag.label) || flagTypeLabel(flag),
    ...(cleanText(flag.capturedAt) ? { capturedAt: cleanText(flag.capturedAt) } : {}),
    ...(finiteNonNegative(flag.timeMs) != null ? { videoTimeMs: finiteNonNegative(flag.timeMs)! } : {})
  };
}

function goalEvidence(replayId: string, goal: EnhancedInsightActiveGoal): EnhancedInsightEvidenceRef {
  return {
    source: "saved-goal",
    id: goal.id,
    replayId,
    label: goal.text,
    ...(goal.createdAt ? { capturedAt: goal.createdAt } : {})
  };
}

function guideEvidence(
  replayId: string,
  guide: DeckMatchupGuide,
  source: "default" | "matchup"
): EnhancedInsightEvidenceRef {
  return {
    source: "saved-guide",
    id: guide.id,
    replayId,
    label: source === "matchup" && guide.legend ? `Saved plan vs ${guide.legend}` : "Saved default deck plan",
    ...(cleanText(guide.updatedAt) ? { capturedAt: cleanText(guide.updatedAt) } : {})
  };
}

function uniqueCandidates(candidates: CandidateDraft[]): CandidateDraft[] {
  const selected = new Map<string, CandidateDraft>();
  for (const candidate of candidates) {
    const current = selected.get(candidate.id);
    if (!current || candidate.priority > current.priority) selected.set(candidate.id, candidate);
  }
  return [...selected.values()];
}

function uniqueEvidence(evidence: readonly EnhancedInsightEvidenceRef[]): EnhancedInsightEvidenceRef[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function clampCandidateLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CANDIDATES;
  return Math.min(MAX_CANDIDATES, Math.max(1, Math.floor(value!)));
}

function decisionSubjectLabel(subject: EnhancedInsightDecisionSubject | undefined): string {
  return cleanText(subject?.cardName || subject?.battlefieldName || subject?.cardId || subject?.cardKey);
}

function decisionLabel(decision: EnhancedInsightDecisionType): string {
  if (decision === "mulligan-keep") return "Mulligan keep";
  if (decision === "mulligan-redraw") return "Mulligan redraw";
  if (decision === "mulligan") return "Mulligan decision";
  if (decision === "sideboard-in") return "Boarded in";
  if (decision === "sideboard-out") return "Boarded out";
  if (decision === "sideboard") return "Sideboard decision";
  if (decision === "battlefield-pick") return "Battlefield pick";
  if (decision === "resource-use") return "Resource decision";
  if (decision === "combat") return "Combat decision";
  if (decision === "sequencing") return "Sequencing decision";
  if (decision === "scoring") return "Scoring decision";
  if (decision === "information") return "Information decision";
  return "Player-recorded decision";
}

function flagTypeLabel(flag: ReplayFlag): string {
  if (flag.customType) return cleanText(flag.customType);
  if (flag.type === "good-line") return "Good line";
  if (flag.type === "missed-lethal") return "Possible missed lethal";
  if (flag.type === "battlefield-decision") return "Battlefield decision";
  if (flag.type === "rules-check") return "Rules check";
  if (flag.type === "mistake") return "Player-marked mistake";
  return "Key turn";
}

function isRedundantLinkedFlag(flag: ReplayFlag): boolean {
  return (!flag.type || flag.type === "key-turn")
    && !cleanText(flag.customType)
    && !cleanText(flag.note);
}

function normalizedIdentity(value: unknown): string {
  return cleanText(value).toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim();
}

function stableToken(value: string): string {
  return normalizedIdentity(value).replace(/\s+/g, "-") || "item";
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function safeTimeMs(value: unknown): number {
  return finiteNonNegative(value) ?? Number.MAX_SAFE_INTEGER;
}

function eventTime(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}
