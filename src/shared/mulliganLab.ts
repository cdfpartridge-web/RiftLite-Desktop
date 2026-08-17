import { riftboundBasePrintCode, riftboundCardCodeFromValue } from "./cardIdentity.js";
import { deckSnapshotHash } from "./deckNotebook.js";
import {
  isLabReviewDue,
  nextLabReviewProgress,
  type LabDecisionConfidence,
  type LabEvidenceTier,
  type LabReviewProgress,
} from "./labTraining.js";
import type { ReplayStructuredCard, ReplayStructuredEvent } from "./types.js";

export const MULLIGAN_LAB_SCHEMA_VERSION = 1 as const;
export const MULLIGAN_LAB_API_SCHEMA_VERSION = 2 as const;
export const MULLIGAN_LAB_MIN_ELIGIBLE_HANDS = 25;
export const MULLIGAN_LAB_MIN_UNIQUE_PLAYERS = 10;
export const MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON = "2026-07-31" as const;
export const MULLIGAN_LAB_TRAINING_STORAGE_KEY = "riftlite:mulligan-lab-training:v1" as const;
export const MULLIGAN_LAB_TRAINING_SCHEMA_VERSION = 2 as const;

export interface MulliganLabRegistryCard {
  code: string;
  name: string;
  type: string;
  supertype: string | null;
  imageUrl: string;
  costEnergy: number | null;
  costPower: number | null;
}

export interface MulliganLabRegistry {
  byCode: ReadonlyMap<string, MulliganLabRegistryCard>;
}

export interface MulliganLabDeckSnapshotRef {
  matchId: string;
  gameNumber: number;
  snapshotHash: string;
  snapshotJson: string;
}

export interface MulliganLabObservationWire {
  schemaVersion: typeof MULLIGAN_LAB_SCHEMA_VERSION;
  id: string;
  provider: "atlas" | "tcga";
  matchId: string;
  gameNumber: number;
  sourceEventId: string;
  observedAt: string;
  result: "Win" | "Loss";
  wentFirst: "1st" | "2nd";
  playerLegendCode: string;
  opponentLegendCode: string;
  deckSnapshot: MulliganLabDeckSnapshotRef;
  openingHandCodes: string[];
  keptCodes: string[];
  redrawnCodes: string[];
  redrawCount: number;
}

export interface MulliganLabObservation extends MulliganLabObservationWire {
  playerLegend: MulliganLabRegistryCard;
  opponentLegend: MulliganLabRegistryCard;
  openingHand: MulliganLabRegistryCard[];
  kept: MulliganLabRegistryCard[];
  redrawn: MulliganLabRegistryCard[];
}

export interface MulliganLabCardStats {
  code: string;
  identityCode: string;
  scope: "matchup" | "player-legend";
  scopeHands: number;
  scopePlayers: number;
  offeredCount: number;
  playerCount: number;
  keptPlayerCount: number;
  redrawnPlayerCount: number;
  keptCount: number;
  redrawnCount: number;
  keptWins: number;
  redrawnWins: number;
  keepRate: number;
  baselineKeepRate: number;
  guidancePlayers: number;
  guidanceKept: number;
  guidanceKeepRate: number;
  keptWinRate: number | null;
  redrawnWinRate: number | null;
  winRateDelta: number | null;
  guidance: MulliganLabCardGuidance;
  evidenceStatus: MulliganLabCardEvidenceStatus;
  outcomeStatus: MulliganLabCardOutcomeStatus;
  slices?: MulliganLabEvidenceSlices;
}

export interface MulliganLabEvidenceSlice {
  offered: number;
  players: number;
  kept: number;
  redrawn: number;
  guidancePlayers: number;
  guidanceKept: number;
  guidanceKeepRate: number;
  guidance: MulliganLabCardGuidance;
  evidenceStatus: MulliganLabCardEvidenceStatus;
}

export interface MulliganLabEvidenceSlices {
  matchingCurve: MulliganLabEvidenceSlice | null;
  matchingInitiative: MulliganLabEvidenceSlice | null;
  preseason: MulliganLabEvidenceSlice | null;
  currentSeason: MulliganLabEvidenceSlice | null;
}

export type MulliganLabChoiceEvidenceScope = "matching-curve" | "matching-initiative" | "matchup" | "player-legend";

export interface MulliganLabChoiceEvidence {
  scope: MulliganLabChoiceEvidenceScope;
  guidance: MulliganLabCardGuidance;
  evidenceStatus: MulliganLabCardEvidenceStatus;
  guidancePlayers: number;
  guidanceKept: number;
  guidanceKeepRate: number;
}

export type MulliganLabCardGuidance = "strong_keep" | "keep" | "mixed" | "redraw" | "strong_redraw" | "unclear";
export type MulliganLabCardEvidenceStatus = "robust" | "developing" | "limited";
export type MulliganLabCardOutcomeStatus = "comparable" | "one_sided" | "sparse";
export type MulliganLabChoiceFeedback =
  | "aligned"
  | "conflicts"
  | "general-aligned"
  | "general-different"
  | "unclear"
  | "developing"
  | "mixed-copy";
export interface MulliganLabSeasonCoverage {
  currentSeasonStartedOn: typeof MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON;
  preseasonFacts: number;
  currentSeasonFacts: number;
}

export type MulliganLabCoveragePeriod = "preseason" | "current-season";

export interface MulliganLabIdentityDecision {
  identityCode: string;
  cardIndexes: number[];
  userAction: "keep" | "redraw" | "mixed";
  feedback: MulliganLabChoiceFeedback;
}

export type MulliganLabCurveStatus = "two-drop-present" | "alternative-early-unit" | "missing" | "unknown";

export interface MulliganLabCurveCheck {
  status: MulliganLabCurveStatus;
  twoDropIndexes: number[];
  alternativeEarlyUnitIndexes: number[];
}

export interface MulliganLabDeckCurveProfile {
  metadataComplete: boolean;
  twoDropCopies: number;
}

export interface MulliganLabReplacementOdds {
  redraws: 1 | 2;
  liveTwoDrops: number;
  poolCards: 35;
  probability: number;
}

export interface MulliganLabDecisionEvidence {
  scope: "matching-curve" | "matchup";
  hands: number;
  players: number;
  redrawCountHistogram: Array<{ redraws: 0 | 1 | 2; hands: number }>;
  mostCommonRedrawCount: 0 | 1 | 2 | null;
  twoRedrawRate: number;
  evidenceStatus: "robust" | "developing";
}

export interface MulliganLabTrainingAnswer {
  drillId: string;
  answeredAt: string;
  playerLegendCode: string;
  opponentLegendCode: string;
  wentFirst: "1st" | "2nd";
  selectedCardIndexes: number[];
  aligned: number;
  conflicts: number;
  general: number;
  ungraded: number;
  confidence: LabDecisionConfidence | null;
  evidenceTier: LabEvidenceTier;
  review: LabReviewProgress | null;
  decisionMs: number | null;
}

export interface MulliganLabTrainingSession {
  id: string;
  runKey: string;
  mode: string;
  startedAt: string;
  completedAt: string;
  handsCompleted: number;
  aligned: number;
  conflicts: number;
  general: number;
  ungraded: number;
}

export interface MulliganLabActiveRun {
  runKey: string;
  startedAt: string;
  decisions: Record<string, number[]>;
}

export interface MulliganLabTrainingState {
  schemaVersion: typeof MULLIGAN_LAB_TRAINING_SCHEMA_VERSION;
  activeRun: MulliganLabActiveRun | null;
  answers: MulliganLabTrainingAnswer[];
  sessions: MulliganLabTrainingSession[];
}

export interface MulliganLabScenarioUsefulness {
  kind: LabEvidenceTier;
  contextualSignals: number;
  generalSignals: number;
  score: number;
}

export interface MulliganLabMasterySummary {
  contextsPractised: number;
  masteredContexts: number;
  reviewDue: number;
  uncertainContexts: number;
}

export interface MulliganLabCohort {
  scope: "deck-matchup-seat";
  eligibleHands: number;
  uniquePlayers: number;
}

export interface MulliganLabExerciseCard extends MulliganLabRegistryCard {
  observedAction?: "kept" | "redrawn";
  stats: MulliganLabCardStats;
}

export interface MulliganLabExercise extends MulliganLabObservation {
  source: "community";
  cohort: MulliganLabCohort;
  cards: MulliganLabExerciseCard[];
}

export interface MulliganLabCommunityPack {
  schemaVersion: typeof MULLIGAN_LAB_SCHEMA_VERSION;
  source: "community";
  generatedAt: string;
  refreshAfter: string;
  window: {
    start: string;
    end: string;
  };
  exercises: MulliganLabExercise[];
}

export interface MulliganLabFilters {
  playerLegendCode?: string;
  opponentLegendCode?: string;
  wentFirst?: "1st" | "2nd";
  provider?: "atlas" | "tcga";
}

export interface MulliganLabValidationIssue {
  path: string;
  message: string;
}

export type MulliganLabObservationValidationResult =
  | { ok: true; observation: MulliganLabObservation; issues: [] }
  | { ok: false; observation: null; issues: MulliganLabValidationIssue[] };

export interface MulliganLabPackParseResult {
  pack: MulliganLabCommunityPack | null;
  issues: MulliganLabValidationIssue[];
  accepted: number;
  rejected: number;
}

export interface MulliganLabApiDeckCard extends MulliganLabRegistryCard {
  count: number;
}

export interface MulliganLabApiDrill {
  id: string;
  observedHandId?: string;
  source: "community";
  observation?: {
    provider: "atlas" | "tcga";
    matchKey: string;
    gameNumber: 1;
    eventKey: string;
    observedOn: string;
  };
  playerLegend: MulliganLabRegistryCard;
  opponentLegend: MulliganLabRegistryCard;
  wentFirst: "1st" | "2nd";
  cards: MulliganLabExerciseCard[];
  observedRedrawnCardIndexes?: number[];
  observedWin?: boolean;
  deck: {
    fingerprint: string;
    mainDeck: MulliganLabApiDeckCard[];
    chosenChampionCode?: string | null;
  };
  context?: {
    curve: {
      classification: "two-drop-present" | "two-drop-missing" | "unknown";
      twoDropCount: number | null;
      earlyUnitCount: number | null;
    };
    battlefields: {
      player: MulliganLabRegistryCard | null;
      opponent: MulliganLabRegistryCard | null;
    };
    duplicateIdentityCount?: number;
    setup?: {
      chosenChampion: MulliganLabRegistryCard | null;
      replacementPoolCards: 35 | null;
    };
  };
  decisionEvidence?: MulliganLabDecisionEvidence;
  evidence: {
    status: "sufficient" | "early";
    scope: "matchup" | "matchup-initiative";
    deckScope?: "all-observed-decks";
    guidanceBasis?: "community-keep-rate";
    outcomeInterpretation?: "descriptive-not-causal";
    playerLegendIdentityCode?: string;
    opponentLegendIdentityCode?: string;
    hands: number;
    players: number;
  };
}

export interface MulliganLabTargetQuery {
  requested: {
    playerLegend: string;
    opponentLegend: string | null;
    deckFingerprint: string | null;
    initiative: "first" | "second" | null;
  };
  resolved: {
    scope: "exact-deck" | "matchup" | "player-legend";
    deckFingerprint: string | null;
    sharedCards: number | null;
    totalCards: 40 | null;
  };
  fallbackReason: "deck-not-observed" | "insufficient-private-cohort" | "matchup-not-observed" | null;
}

export type MulliganLabApiParseResult =
  | {
      status: "ready";
      generatedAt: string;
      expiresAt: string;
      drills: MulliganLabApiDrill[];
      reason: "";
      issues: MulliganLabValidationIssue[];
      accepted: number;
      rejected: number;
      observedFrom: string | null;
      observedThrough: string | null;
      includedFacts: number;
      coverageTruncated: boolean;
      coveragePolicy: "all-available-history" | null;
      includedPeriods: MulliganLabCoveragePeriod[];
      seasonCoverage: MulliganLabSeasonCoverage | null;
      backfillComplete: boolean | null;
      targetQuery?: MulliganLabTargetQuery;
    }
  | {
      status: "unavailable" | "invalid";
      generatedAt: null;
      expiresAt: null;
      drills: [];
      reason: string;
      issues: MulliganLabValidationIssue[];
      accepted: 0;
      rejected: number;
      observedFrom: null;
      observedThrough: null;
      includedFacts: 0;
      coverageTruncated: false;
      coveragePolicy: "all-available-history" | null;
      includedPeriods: MulliganLabCoveragePeriod[];
      seasonCoverage: MulliganLabSeasonCoverage | null;
      backfillComplete: boolean | null;
      targetQuery?: MulliganLabTargetQuery;
    };

/**
 * Grades only against a published matchup-level community signal. This is an
 * evidence-alignment label, never a claim that a choice was objectively right.
 */
export function mulliganLabChoiceFeedback(
  stats: MulliganLabCardStats,
  userRedrew: boolean
): MulliganLabChoiceFeedback {
  const evidence = mulliganLabChoiceEvidence(stats);
  if (evidence.evidenceStatus !== "robust") {
    return evidence.evidenceStatus === "developing" ? "developing" : "unclear";
  }
  const communityRedraw = evidence.guidance === "redraw" || evidence.guidance === "strong_redraw";
  const communityKeep = evidence.guidance === "keep" || evidence.guidance === "strong_keep";
  if (!communityKeep && !communityRedraw) return "unclear";
  // Legend-wide behaviour is useful context, but it is not matchup evidence.
  // Keep it explicitly neutral so a broad fallback never becomes a hard
  // green/red judgement about this hand.
  if (evidence.scope === "player-legend") {
    return userRedrew === communityRedraw ? "general-aligned" : "general-different";
  }
  return userRedrew === communityRedraw ? "aligned" : "conflicts";
}

/** Chooses the narrowest independently privacy-gated behavioural signal. */
export function mulliganLabChoiceEvidence(stats: MulliganLabCardStats): MulliganLabChoiceEvidence {
  const curve = stats.slices?.matchingCurve;
  if (curve?.evidenceStatus === "robust") {
    return { scope: "matching-curve", ...curve };
  }
  const initiative = stats.slices?.matchingInitiative;
  if (initiative?.evidenceStatus === "robust") {
    return { scope: "matching-initiative", ...initiative };
  }
  return {
    scope: stats.scope,
    guidance: stats.guidance,
    evidenceStatus: stats.evidenceStatus,
    guidancePlayers: stats.guidancePlayers,
    guidanceKept: stats.guidanceKept,
    guidanceKeepRate: stats.guidanceKeepRate
  };
}

/** Scores one gameplay identity once, even when the hand contains copies. */
export function mulliganLabIdentityDecisions(
  cards: MulliganLabExerciseCard[],
  selectedCardIndexes: number[]
): MulliganLabIdentityDecision[] {
  const selected = new Set(selectedCardIndexes);
  const groups = new Map<string, { indexes: number[]; stats: MulliganLabCardStats }>();
  cards.forEach((card, index) => {
    const current = groups.get(card.stats.identityCode);
    if (current) current.indexes.push(index);
    else groups.set(card.stats.identityCode, { indexes: [index], stats: card.stats });
  });
  return [...groups.entries()].map(([identityCode, group]) => {
    const redraws = group.indexes.filter((index) => selected.has(index)).length;
    const userAction = redraws === 0 ? "keep" as const : redraws === group.indexes.length ? "redraw" as const : "mixed" as const;
    return {
      identityCode,
      cardIndexes: group.indexes,
      userAction,
      feedback: userAction === "mixed" ? "mixed-copy" : mulliganLabChoiceFeedback(group.stats, userAction === "redraw")
    };
  });
}

/** Classifies the drill by the strongest evidence it can honestly teach. */
export function mulliganLabScenarioUsefulness(drill: MulliganLabApiDrill): MulliganLabScenarioUsefulness {
  let contextualSignals = 0;
  let generalSignals = 0;
  for (const card of drill.cards) {
    const evidence = mulliganLabChoiceEvidence(card.stats);
    if (evidence.evidenceStatus !== "robust") continue;
    if (!["keep", "strong_keep", "redraw", "strong_redraw"].includes(evidence.guidance)) continue;
    if (evidence.scope === "player-legend") generalSignals += 1;
    else contextualSignals += 1;
  }
  return {
    kind: contextualSignals > 0 ? "challenge" : generalSignals > 0 ? "guided" : "explore",
    contextualSignals,
    generalSignals,
    score: contextualSignals * 100 + generalSignals * 10 + Math.min(99, drill.evidence.players),
  };
}

/** Picks the strongest Daily hands first without filling the run with one matchup. */
export function rankMulliganLabDailyDrills(drills: readonly MulliganLabApiDrill[], limit = 5): MulliganLabApiDrill[] {
  const maximum = Math.max(0, Math.min(20, Math.floor(limit)));
  const ranked = [...drills].sort((left, right) => (
    mulliganLabScenarioUsefulness(right).score - mulliganLabScenarioUsefulness(left).score ||
    left.id.localeCompare(right.id)
  ));
  const selected: MulliganLabApiDrill[] = [];
  const matchups = new Set<string>();
  for (const drill of ranked) {
    const matchup = `${drill.playerLegend.code}:${drill.opponentLegend.code}`;
    if (matchups.has(matchup)) continue;
    selected.push(drill);
    matchups.add(matchup);
    if (selected.length >= maximum) return selected;
  }
  for (const drill of ranked) {
    if (selected.some((item) => item.id === drill.id)) continue;
    selected.push(drill);
    if (selected.length >= maximum) break;
  }
  return selected;
}

/**
 * Checks the whole opening hand independently from community card evidence.
 * A Riftbound "2-drop" is a Unit with a printed Energy cost of exactly two;
 * Power is a separate cost and does not change that curve classification.
 * One-Energy Units, plus three-Energy Units when going second, are surfaced as
 * legitimate alternative first-turn lines rather than being graded as misses.
 */
export function mulliganLabCurveCheck(
  cards: Array<Pick<MulliganLabRegistryCard, "type" | "costEnergy">>,
  wentFirst: "1st" | "2nd"
): MulliganLabCurveCheck {
  const twoDropIndexes: number[] = [];
  const alternativeEarlyUnitIndexes: number[] = [];
  let metadataComplete = true;

  cards.forEach((card, index) => {
    if (card.costEnergy === null || !Number.isInteger(card.costEnergy) || card.costEnergy < 0) {
      metadataComplete = false;
      return;
    }
    if (card.type.toLowerCase() !== "unit") return;
    if (card.costEnergy === 2) {
      twoDropIndexes.push(index);
      return;
    }
    if (card.costEnergy <= 1 || (wentFirst === "2nd" && card.costEnergy === 3)) {
      alternativeEarlyUnitIndexes.push(index);
    }
  });

  return {
    status: twoDropIndexes.length
      ? "two-drop-present"
      : !metadataComplete
        ? "unknown"
        : alternativeEarlyUnitIndexes.length
          ? "alternative-early-unit"
          : "missing",
    twoDropIndexes,
    alternativeEarlyUnitIndexes
  };
}

/** Counts drawable two-drops in the exact registered deck behind a drill. */
export function mulliganLabDeckCurveProfile(
  cards: Array<Pick<MulliganLabRegistryCard, "type" | "costEnergy"> & { count: number }>
): MulliganLabDeckCurveProfile {
  let metadataComplete = true;
  let twoDropCopies = 0;
  for (const card of cards) {
    if (card.type.toLowerCase() !== "unit") continue;
    if (card.costEnergy === null || !Number.isInteger(card.costEnergy) || card.costEnergy < 0 || !Number.isSafeInteger(card.count) || card.count < 1) {
      metadataComplete = false;
      continue;
    }
    if (card.costEnergy === 2) twoDropCopies += card.count;
  }
  return { metadataComplete, twoDropCopies };
}

/** Exact replacement odds, available only with a proven face-up Champion. */
export function mulliganLabReplacementOddsForDrill(
  drill: MulliganLabApiDrill,
  redraws: 1 | 2,
): MulliganLabReplacementOdds | null {
  const chosenChampionCode = drill.deck.chosenChampionCode;
  const setup = drill.context?.setup;
  if (!chosenChampionCode || setup?.chosenChampion?.code !== chosenChampionCode || setup.replacementPoolCards !== 35) return null;
  if (drill.cards.some((card) => card.code === chosenChampionCode)) return null;
  let liveTwoDrops = 0;
  for (const card of drill.deck.mainDeck) {
    if (card.type.toLocaleLowerCase("en") !== "unit" || card.costEnergy !== 2) continue;
    liveTwoDrops += card.count;
    if (card.code === chosenChampionCode) liveTwoDrops -= 1;
  }
  for (const card of drill.cards) {
    if (card.type.toLocaleLowerCase("en") === "unit" && card.costEnergy === 2) liveTwoDrops -= 1;
  }
  if (!Number.isInteger(liveTwoDrops) || liveTwoDrops < 0 || liveTwoDrops > 35) return null;
  const misses = redraws === 1
    ? (35 - liveTwoDrops) / 35
    : ((35 - liveTwoDrops) * (34 - liveTwoDrops)) / (35 * 34);
  return { redraws, liveTwoDrops, poolCards: 35, probability: 1 - misses };
}

export function initialMulliganLabTrainingState(): MulliganLabTrainingState {
  return {
    schemaVersion: MULLIGAN_LAB_TRAINING_SCHEMA_VERSION,
    activeRun: null,
    answers: [],
    sessions: []
  };
}

/**
 * Reads only RiftLite's versioned, device-local training history. Malformed or
 * future data fails closed to a fresh profile instead of affecting a drill.
 */
export function parseMulliganLabTrainingState(raw: string | null): MulliganLabTrainingState {
  if (!raw) return initialMulliganLabTrainingState();
  let parsed: JsonRecord | null = null;
  try {
    parsed = record(JSON.parse(raw));
  } catch {
    return initialMulliganLabTrainingState();
  }
  if (!parsed || (parsed.schemaVersion !== 1 && parsed.schemaVersion !== MULLIGAN_LAB_TRAINING_SCHEMA_VERSION)) {
    return initialMulliganLabTrainingState();
  }
  const answers = array(parsed.answers)
    .map(parseMulliganLabTrainingAnswer)
    .filter((answer): answer is MulliganLabTrainingAnswer => Boolean(answer))
    .slice(-500);
  const sessions = array(parsed.sessions)
    .map(parseMulliganLabTrainingSession)
    .filter((session): session is MulliganLabTrainingSession => Boolean(session))
    .slice(-50);
  return {
    schemaVersion: MULLIGAN_LAB_TRAINING_SCHEMA_VERSION,
    activeRun: parseMulliganLabActiveRun(parsed.activeRun),
    answers,
    sessions
  };
}

export function serializeMulliganLabTrainingState(state: MulliganLabTrainingState): string {
  return JSON.stringify({
    schemaVersion: MULLIGAN_LAB_TRAINING_SCHEMA_VERSION,
    activeRun: state.activeRun,
    answers: state.answers.slice(-500),
    sessions: state.sessions.slice(-50)
  });
}

export function recordMulliganLabTrainingAnswer(
  state: MulliganLabTrainingState,
  answer: MulliganLabTrainingAnswer,
  activeRun: MulliganLabActiveRun
): MulliganLabTrainingState {
  return {
    schemaVersion: MULLIGAN_LAB_TRAINING_SCHEMA_VERSION,
    activeRun,
    answers: [...state.answers, answer].slice(-500),
    sessions: state.sessions.slice(-50)
  };
}

export function completeMulliganLabTrainingSession(
  state: MulliganLabTrainingState,
  session: MulliganLabTrainingSession
): MulliganLabTrainingState {
  return {
    schemaVersion: MULLIGAN_LAB_TRAINING_SCHEMA_VERSION,
    activeRun: null,
    answers: state.answers.slice(-500),
    sessions: [...state.sessions, session].slice(-50)
  };
}

/** Robust matchup conflicts become local review items; broad tendencies never do. */
export function mulliganLabReviewDrillIds(state: MulliganLabTrainingState): string[] {
  const review = new Map<string, MulliganLabTrainingAnswer>();
  for (const answer of state.answers) {
    // The most recent answer is authoritative even when it clears an earlier
    // conflict. Keeping only conflicting replacements made corrected drills
    // impossible to remove from Review.
    review.set(answer.drillId, answer);
  }
  return [...review.values()]
    .filter((answer) => isLabReviewDue(answer.review))
    .sort((left, right) => right.answeredAt.localeCompare(left.answeredAt))
    .map((answer) => answer.drillId);
}

export function mulliganLabScheduledReviewIds(state: MulliganLabTrainingState): string[] {
  const latest = latestMulliganAnswers(state.answers);
  return [...latest.values()]
    .filter((answer) => Boolean(answer.review))
    .sort((left, right) => (left.review?.dueAt ?? "").localeCompare(right.review?.dueAt ?? ""))
    .map((answer) => answer.drillId);
}

export function mulliganLabReviewProgressForAnswer(
  state: MulliganLabTrainingState,
  answer: Pick<MulliganLabTrainingAnswer, "drillId" | "answeredAt" | "confidence" | "evidenceTier" | "conflicts">,
  reviewing: boolean,
): LabReviewProgress | null {
  const previous = [...state.answers].reverse().find((item) => item.drillId === answer.drillId)?.review ?? null;
  return nextLabReviewProgress({
    answeredAt: answer.answeredAt,
    evidenceTier: answer.evidenceTier,
    confidence: answer.confidence,
    needsReview: answer.conflicts > 0,
    reviewing,
    previous,
  });
}

export function mulliganLabMasterySummary(state: MulliganLabTrainingState): MulliganLabMasterySummary {
  const latest = latestMulliganAnswers(state.answers);
  const values = [...latest.values()];
  return {
    contextsPractised: values.length,
    masteredContexts: values.filter((answer) => (answer.review?.successfulReviews ?? 0) >= 3).length,
    reviewDue: values.filter((answer) => isLabReviewDue(answer.review)).length,
    uncertainContexts: values.filter((answer) => answer.confidence === "unsure" || answer.confidence === "guess").length,
  };
}

function parseMulliganLabTrainingAnswer(raw: unknown): MulliganLabTrainingAnswer | null {
  const value = record(raw);
  const drillId = nonEmptyString(value?.drillId);
  const answeredAt = trainingIso(value?.answeredAt);
  const playerLegendCode = canonicalCode(value?.playerLegendCode);
  const opponentLegendCode = canonicalCode(value?.opponentLegendCode);
  const wentFirst = value?.wentFirst === "1st" || value?.wentFirst === "2nd" ? value.wentFirst : null;
  const selectedCardIndexes = trainingIndexes(value?.selectedCardIndexes);
  const aligned = trainingCount(value?.aligned);
  const conflicts = trainingCount(value?.conflicts);
  const general = trainingCount(value?.general);
  const ungraded = trainingCount(value?.ungraded);
  const confidence = value?.confidence === "certain" || value?.confidence === "unsure" || value?.confidence === "guess"
    ? value.confidence
    : null;
  const explicitTier = value?.evidenceTier === "challenge" || value?.evidenceTier === "guided" || value?.evidenceTier === "explore"
    ? value.evidenceTier
    : null;
  const review = parseLabReviewProgress(value?.review);
  const decisionMs = nullableTrainingDuration(value?.decisionMs);
  if (!drillId || !answeredAt || !playerLegendCode || !opponentLegendCode || !wentFirst || !selectedCardIndexes || aligned === null || conflicts === null || general === null || ungraded === null) return null;
  const evidenceTier = explicitTier ?? (aligned > 0 || conflicts > 0 ? "challenge" : general > 0 ? "guided" : "explore");
  return { drillId, answeredAt, playerLegendCode, opponentLegendCode, wentFirst, selectedCardIndexes, aligned, conflicts, general, ungraded, confidence, evidenceTier, review, decisionMs };
}

function parseMulliganLabTrainingSession(raw: unknown): MulliganLabTrainingSession | null {
  const value = record(raw);
  const id = nonEmptyString(value?.id);
  const runKey = nonEmptyString(value?.runKey);
  const mode = nonEmptyString(value?.mode);
  const startedAt = trainingIso(value?.startedAt);
  const completedAt = trainingIso(value?.completedAt);
  const handsCompleted = trainingCount(value?.handsCompleted);
  const aligned = trainingCount(value?.aligned);
  const conflicts = trainingCount(value?.conflicts);
  const general = trainingCount(value?.general);
  const ungraded = trainingCount(value?.ungraded);
  if (!id || !runKey || !mode || !startedAt || !completedAt || !handsCompleted || aligned === null || conflicts === null || general === null || ungraded === null) return null;
  return { id, runKey, mode, startedAt, completedAt, handsCompleted, aligned, conflicts, general, ungraded };
}

function parseMulliganLabActiveRun(raw: unknown): MulliganLabActiveRun | null {
  const value = record(raw);
  const runKey = nonEmptyString(value?.runKey);
  const startedAt = trainingIso(value?.startedAt);
  const decisionsValue = record(value?.decisions);
  if (!runKey || !startedAt || !decisionsValue) return null;
  const decisions: Record<string, number[]> = {};
  for (const [drillId, rawIndexes] of Object.entries(decisionsValue)) {
    const indexes = trainingIndexes(rawIndexes);
    if (!drillId.trim() || !indexes) continue;
    decisions[drillId] = indexes;
  }
  return { runKey, startedAt, decisions };
}

function trainingIso(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim() || !Number.isFinite(Date.parse(raw))) return "";
  return raw;
}

function parseLabReviewProgress(raw: unknown): LabReviewProgress | null {
  const value = record(raw);
  const dueAt = trainingIso(value?.dueAt);
  const intervalDays = trainingCount(value?.intervalDays);
  const successfulReviews = trainingCount(value?.successfulReviews);
  if (!dueAt || intervalDays === null || intervalDays < 1 || intervalDays > 365 || successfulReviews === null || successfulReviews > 100) return null;
  return { dueAt, intervalDays, successfulReviews };
}

function nullableTrainingDuration(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 86_400_000 ? raw : null;
}

function latestMulliganAnswers(answers: readonly MulliganLabTrainingAnswer[]): Map<string, MulliganLabTrainingAnswer> {
  const latest = new Map<string, MulliganLabTrainingAnswer>();
  for (const answer of answers) latest.set(answer.drillId, answer);
  return latest;
}

function trainingCount(raw: unknown): number | null {
  const value = integer(raw);
  return value !== null && value >= 0 && value <= 10_000 ? value : null;
}

function trainingIndexes(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const indexes = raw.map(integer);
  if (indexes.some((value) => value === null || value < 0 || value > 3)) return null;
  const unique = [...new Set(indexes as number[])].sort((left, right) => left - right);
  return unique.length <= 2 ? unique : null;
}

export interface MulliganLabReplayObservationInput {
  provider: "atlas" | "tcga";
  matchId: string;
  playerLegendCode: string;
  opponentLegendCode: string;
  wentFirst: "1st" | "2nd";
  result: "Win" | "Loss";
  deckSnapshot: MulliganLabDeckSnapshotRef;
  event: ReplayStructuredEvent;
}

type JsonRecord = Record<string, unknown>;

/**
 * Builds an exact-print registry. Ambiguous or incomplete rows are omitted;
 * callers never receive a name or image fallback from this module.
 */
export function buildMulliganLabRegistry(raw: unknown): MulliganLabRegistry {
  const root = record(raw);
  const byCode = new Map<string, MulliganLabRegistryCard>();
  const ambiguousCodes = new Set<string>();
  for (const rawCard of array(root?.cards)) {
    const card = record(rawCard);
    if (!card) continue;
    const code = canonicalCode(card.printId);
    const name = nonEmptyString(card.name);
    const type = nonEmptyString(card.type);
    const imageUrl = trustedRegistryImageUrl(card.imageUrl);
    if (!code || !name || !type || !imageUrl || ambiguousCodes.has(code)) continue;
    if (byCode.has(code)) {
      byCode.delete(code);
      ambiguousCodes.add(code);
      continue;
    }
    byCode.set(code, {
      code,
      name,
      type,
      supertype: nonEmptyString(card.supertype) || null,
      imageUrl,
      costEnergy: registryCost(card.costEnergy),
      costPower: registryCost(card.costPower)
    });
  }
  return { byCode };
}

export function mulliganLabLegendOptions(registry: MulliganLabRegistry): MulliganLabRegistryCard[] {
  const cards = [...registry.byCode.values()]
    .filter((card) => card.type.toLowerCase() === "legend" && riftboundBasePrintCode(card.code) === card.code)
    .sort((left, right) => left.name.localeCompare(right.name) || left.code.localeCompare(right.code));
  return [...new Map(cards.map((card) => [card.name, card])).values()];
}

export function mulliganLabLegendCodeFromSnapshot(snapshotJson: string, registry: MulliganLabRegistry): string {
  let root: JsonRecord | null = null;
  try {
    root = record(JSON.parse(snapshotJson));
  } catch {
    return "";
  }
  const legendEntry = record(root?.legendEntry ?? root?.legend_entry);
  const candidates = [
    root?.legendCode,
    root?.legend_code,
    legendEntry?.cardId,
    legendEntry?.card_id,
    legendEntry?.cardCode,
    legendEntry?.card_code,
    legendEntry?.code
  ];
  for (const rawCode of candidates) {
    const code = savedSnapshotCode(rawCode);
    if (code && registry.byCode.get(code)?.type.toLowerCase() === "legend") return code;
  }
  return "";
}

/** The same canonical snapshot identity already used by deck version history. */
export function mulliganLabDeckSnapshotHash(snapshotJson: string): string {
  return deckSnapshotHash(snapshotJson);
}

/** Mirrors the server's SHA-256 fingerprint over its canonical deck tuples. */
export function mulliganLabApiDeckFingerprint(mainDeck: Array<{ code: string; count: number }>): string {
  const payload = JSON.stringify([...mainDeck]
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((entry) => [entry.code, entry.count]));
  return sha256Ascii(payload);
}

/** Resolves a saved deck to the same fingerprint used by community drills. */
export function mulliganLabApiDeckFingerprintFromSnapshot(snapshotJson: string, registry: MulliganLabRegistry): string {
  let root: JsonRecord | null = null;
  try {
    root = record(JSON.parse(snapshotJson));
  } catch {
    return "";
  }
  const rawMainDeck = Array.isArray(root?.mainDeck) ? root.mainDeck : Array.isArray(root?.main_deck) ? root.main_deck : null;
  if (!rawMainDeck) return "";
  const rawChampion = Array.isArray(root?.champion)
    ? root.champion
    : Array.isArray(root?.champions)
      ? root.champions
      : [];
  const mainCount = rawDeckQuantity(rawMainDeck);
  const championCount = rawDeckQuantity(rawChampion);
  const includedEntries = mainCount === 40
    ? rawMainDeck
    // Atlas participant decks keep their one Chosen Champion outside the
    // 39-card mainDeck section. It still occupies one of the forty registered
    // Main Deck slots, so saved snapshots must fold it in before hashing.
    : mainCount === 39 && championCount === 1
      ? [...rawMainDeck, ...rawChampion]
      : [];
  if (!includedEntries.length) return "";
  const counts = new Map<string, number>();
  for (const rawEntry of includedEntries) {
    const entry = record(rawEntry);
    // Existing Piltover imports can store alternate-art suffixes in lowercase
    // (for example VEN-038a). Normalize only this trusted saved-snapshot input;
    // API observations remain strict uppercase canonical codes.
    const code = savedSnapshotCode(entry?.cardId ?? entry?.card_id ?? entry?.code ?? entry?.cardCode ?? entry?.card_code);
    const count = integer(entry?.qty ?? entry?.quantity ?? entry?.count);
    const card = code ? registry.byCode.get(code) : undefined;
    if (!card || !count || count < 1 || count > 3 || ["legend", "battlefield", "rune"].includes(card.type.toLowerCase())) return "";
    const nextCount = (counts.get(code) ?? 0) + count;
    if (nextCount > 3) return "";
    counts.set(code, nextCount);
  }
  const mainDeck = [...counts].map(([code, count]) => ({ code, count }));
  if (mainDeck.length < 14 || mainDeck.reduce((sum, entry) => sum + entry.count, 0) !== 40) return "";
  return mulliganLabApiDeckFingerprint(mainDeck);
}

export function validateMulliganLabObservation(
  raw: unknown,
  registry: MulliganLabRegistry
): MulliganLabObservationValidationResult {
  const issues: MulliganLabValidationIssue[] = [];
  const value = record(raw);
  if (!value) return invalid("$", "Observation must be an object.");

  const schemaVersion = integer(value.schemaVersion);
  if (schemaVersion !== MULLIGAN_LAB_SCHEMA_VERSION) issue(issues, "schemaVersion", "Unsupported schema version.");
  const id = requiredString(value.id, "id", issues);
  const provider = value.provider === "atlas" || value.provider === "tcga" ? value.provider : null;
  if (!provider) issue(issues, "provider", "Provider must be atlas or tcga.");
  const matchId = requiredString(value.matchId, "matchId", issues);
  const gameNumber = integer(value.gameNumber);
  if (!gameNumber || gameNumber < 1) issue(issues, "gameNumber", "Game number must be a positive integer.");
  const sourceEventId = requiredString(value.sourceEventId, "sourceEventId", issues);
  const observedAt = isoDate(value.observedAt, "observedAt", issues);
  const result = value.result === "Win" || value.result === "Loss" ? value.result : null;
  if (!result) issue(issues, "result", "Only completed Win or Loss observations are eligible.");
  const wentFirst = value.wentFirst === "1st" || value.wentFirst === "2nd" ? value.wentFirst : null;
  if (!wentFirst) issue(issues, "wentFirst", "Initiative must be known.");

  const playerLegendCode = registryCode(value.playerLegendCode, registry, "Legend", "playerLegendCode", issues);
  const opponentLegendCode = registryCode(value.opponentLegendCode, registry, "Legend", "opponentLegendCode", issues);
  const openingHandCodes = codeArray(value.openingHandCodes, "openingHandCodes", registry, issues);
  const keptCodes = codeArray(value.keptCodes, "keptCodes", registry, issues);
  const redrawnCodes = codeArray(value.redrawnCodes, "redrawnCodes", registry, issues);
  const redrawCount = integer(value.redrawCount);
  if (openingHandCodes.length !== 4) issue(issues, "openingHandCodes", "An exercise requires the exact four-card opening hand.");
  if (redrawCount === null || redrawCount < 0 || redrawCount > 4) issue(issues, "redrawCount", "Redraw count must be between zero and four.");
  if (redrawCount !== null && redrawnCodes.length !== redrawCount) issue(issues, "redrawnCodes", "Redrawn cards must match redrawCount exactly.");
  if (!sameMultiset(openingHandCodes, [...keptCodes, ...redrawnCodes])) {
    issue(issues, "keptCodes", "Kept and redrawn cards must exactly partition the opening hand, including duplicates.");
  }

  const snapshotValue = record(value.deckSnapshot);
  const deckSnapshot = validateDeckSnapshotRef(snapshotValue, matchId, gameNumber, playerLegendCode, openingHandCodes, registry, issues);
  if (issues.length || !provider || !result || !wentFirst || !deckSnapshot || !playerLegendCode || !opponentLegendCode) {
    return { ok: false, observation: null, issues };
  }
  const resolve = (code: string): MulliganLabRegistryCard => registry.byCode.get(code)!;
  return {
    ok: true,
    issues: [],
    observation: {
      schemaVersion: MULLIGAN_LAB_SCHEMA_VERSION,
      id,
      provider,
      matchId,
      gameNumber: gameNumber!,
      sourceEventId,
      observedAt,
      result,
      wentFirst,
      playerLegendCode,
      opponentLegendCode,
      deckSnapshot,
      openingHandCodes,
      keptCodes,
      redrawnCodes,
      redrawCount: redrawCount!,
      playerLegend: resolve(playerLegendCode),
      opponentLegend: resolve(opponentLegendCode),
      openingHand: openingHandCodes.map(resolve),
      kept: keptCodes.map(resolve),
      redrawn: redrawnCodes.map(resolve)
    }
  };
}

/**
 * Converts only an explicit local mulligan event. It deliberately does not
 * infer a hand from snapshots, card names, redraw counts, or later gameplay.
 */
export function extractMulliganLabObservationFromReplayEvent(
  input: MulliganLabReplayObservationInput,
  registry: MulliganLabRegistry
): MulliganLabObservationValidationResult {
  const event = input.event;
  if (event.type !== "mulligan" || event.side !== "me" || event.visibility !== "private-local" || !event.mulligan) {
    return invalid("event", "A private-local mulligan event is required.");
  }
  const options = event.mulligan.options;
  const kept = event.mulligan.kept;
  const redrawn = event.mulligan.redrawn;
  if (!options || !kept || !redrawn) {
    return invalid("event.mulligan", "Exact options, kept cards, and redrawn cards are all required.");
  }
  return validateMulliganLabObservation({
    schemaVersion: MULLIGAN_LAB_SCHEMA_VERSION,
    id: `${input.matchId}:${event.gameNumber}:${event.id}`,
    provider: input.provider,
    matchId: input.matchId,
    gameNumber: event.gameNumber,
    sourceEventId: event.sourceEventId || event.id,
    observedAt: event.capturedAt,
    result: input.result,
    wentFirst: input.wentFirst,
    playerLegendCode: input.playerLegendCode,
    opponentLegendCode: input.opponentLegendCode,
    deckSnapshot: input.deckSnapshot,
    openingHandCodes: exactEventCodes(options),
    keptCodes: exactEventCodes(kept),
    redrawnCodes: exactEventCodes(redrawn),
    redrawCount: event.mulligan.redrawCount
  }, registry);
}

/**
 * Parses the daily community pack. A malformed envelope is rejected. Bad
 * exercises are quarantined individually and reported; they are never patched,
 * guessed, or replaced with local/demo content.
 */
export function parseMulliganLabCommunityPack(raw: unknown, registry: MulliganLabRegistry): MulliganLabPackParseResult {
  const issues: MulliganLabValidationIssue[] = [];
  const root = record(raw);
  if (!root) return { pack: null, issues: [{ path: "$", message: "Community pack must be an object." }], accepted: 0, rejected: 0 };
  if (integer(root.schemaVersion) !== MULLIGAN_LAB_SCHEMA_VERSION) issue(issues, "schemaVersion", "Unsupported schema version.");
  if (root.source !== "community") issue(issues, "source", "Mulligan Lab accepts only the community trainer pack as its primary source.");
  const generatedAt = isoDate(root.generatedAt, "generatedAt", issues);
  const refreshAfter = isoDate(root.refreshAfter, "refreshAfter", issues);
  const windowValue = record(root.window);
  const windowStart = isoDate(windowValue?.start, "window.start", issues);
  const windowEnd = isoDate(windowValue?.end, "window.end", issues);
  if (windowStart && windowEnd && Date.parse(windowStart) > Date.parse(windowEnd)) issue(issues, "window", "Data window start must not be after its end.");
  if (generatedAt && refreshAfter && Date.parse(generatedAt) >= Date.parse(refreshAfter)) issue(issues, "refreshAfter", "Refresh time must be after pack generation.");
  const rawExercises = Array.isArray(root.exercises) ? root.exercises : null;
  if (!rawExercises) issue(issues, "exercises", "Exercises must be an array.");
  if (issues.length || !rawExercises) return { pack: null, issues, accepted: 0, rejected: rawExercises?.length ?? 0 };

  const exercises: MulliganLabExercise[] = [];
  let rejected = 0;
  rawExercises.forEach((rawExercise, index) => {
    const exerciseValue = record(rawExercise);
    const observationResult = validateMulliganLabObservation(exerciseValue, registry);
    if (!exerciseValue || !observationResult.ok) {
      rejected += 1;
      for (const item of observationResult.issues) issue(issues, `exercises[${index}].${item.path}`, item.message);
      return;
    }
    const issueCountBeforeEvidence = issues.length;
    const cohort = parseCohort(exerciseValue.cohort, `exercises[${index}].cohort`, issues);
    const stats = parseCardStats(exerciseValue.cardStats, observationResult.observation.openingHandCodes, cohort, `exercises[${index}].cardStats`, issues);
    if (!cohort || !stats || issues.length !== issueCountBeforeEvidence) {
      rejected += 1;
      return;
    }
    const actionCounts = multiset(observationResult.observation.redrawnCodes);
    const cards = observationResult.observation.openingHandCodes.map((code) => ({
      ...registry.byCode.get(code)!,
      observedAction: takeOccurrence(actionCounts, code) ? "redrawn" as const : "kept" as const,
      stats: stats.get(code)!
    }));
    exercises.push({ ...observationResult.observation, source: "community", cohort, cards });
  });

  return {
    pack: {
      schemaVersion: MULLIGAN_LAB_SCHEMA_VERSION,
      source: "community",
      generatedAt,
      refreshAfter,
      window: { start: windowStart, end: windowEnd },
      exercises
    },
    issues,
    accepted: exercises.length,
    rejected
  };
}

/**
 * Strict desktop adapter for GET /api/app/mulligan-lab. The endpoint supplies
 * canonical codes and aggregate counts; all visible names and images still
 * come from the packaged registry. Invalid drills are quarantined individually.
 */
export function parseMulliganLabApiResponse(raw: unknown, registry: MulliganLabRegistry): MulliganLabApiParseResult {
  const root = record(raw);
  const issues: MulliganLabValidationIssue[] = [];
  if (!root) return invalidApiResult("Response must be an object.");
  if (root.schema !== "riftlite-mulligan-lab") issue(issues, "schema", "Unexpected Mulligan Lab API schema.");
  const apiVersion = integer(root.version);
  if (apiVersion !== MULLIGAN_LAB_SCHEMA_VERSION && apiVersion !== MULLIGAN_LAB_API_SCHEMA_VERSION) {
    issue(issues, "version", "Unsupported Mulligan Lab API version.");
  }
  const rawDrills = Array.isArray(root.drills) ? root.drills : null;
  if (!rawDrills) issue(issues, "drills", "Drills must be an array.");

  const source = record(root.source);
  const sourceKindValid = source?.kind === "precomputed-observed-replays";
  const sourceCorpusValid = source?.corpus === "anonymized-canonical-web-replays";
  const minimumHands = integer(source?.minimumHands);
  const minimumPlayers = integer(source?.minimumPlayers);
  if (!sourceKindValid || !sourceCorpusValid) issue(issues, "source", "Only the precomputed canonical Web Replay corpus is accepted.");
  if (minimumHands === null || minimumHands < MULLIGAN_LAB_MIN_ELIGIBLE_HANDS) issue(issues, "source.minimumHands", `Server threshold cannot be below ${MULLIGAN_LAB_MIN_ELIGIBLE_HANDS} hands.`);
  if (minimumPlayers === null || minimumPlayers < MULLIGAN_LAB_MIN_UNIQUE_PLAYERS) issue(issues, "source.minimumPlayers", `Server threshold cannot be below ${MULLIGAN_LAB_MIN_UNIQUE_PLAYERS} players.`);
  let observedFrom: string | null = null;
  let observedThrough: string | null = null;
  let includedFacts = 0;
  let coverageTruncated = false;
  let coveragePolicy: "all-available-history" | null = null;
  let includedPeriods: MulliganLabCoveragePeriod[] = [];
  let seasonCoverage: MulliganLabSeasonCoverage | null = null;
  let backfillComplete: boolean | null = null;
  if (apiVersion === MULLIGAN_LAB_API_SCHEMA_VERSION) {
    const hasCoveragePolicy = source ? Object.prototype.hasOwnProperty.call(source, "coveragePolicy") : false;
    const hasIncludedPeriods = source ? Object.prototype.hasOwnProperty.call(source, "includedPeriods") : false;
    const hasSeasonCoverage = source ? Object.prototype.hasOwnProperty.call(source, "seasonCoverage") : false;
    const hasBackfillComplete = source ? Object.prototype.hasOwnProperty.call(source, "backfillComplete") : false;
    const hasHistoricalCoverageContract = hasCoveragePolicy || hasIncludedPeriods || hasSeasonCoverage || hasBackfillComplete;
    if (hasHistoricalCoverageContract) {
      if (!hasCoveragePolicy || !hasIncludedPeriods || !hasSeasonCoverage || !hasBackfillComplete) {
        issue(issues, "source", "Historical coverage metadata must be published as one complete contract.");
      }
      if (source?.coveragePolicy !== "all-available-history") {
        issue(issues, "source.coveragePolicy", "Unknown Mulligan Lab coverage policy.");
      } else {
        coveragePolicy = source.coveragePolicy;
      }
      if (!Array.isArray(source?.includedPeriods)) {
        issue(issues, "source.includedPeriods", "Included history periods must be an array.");
      } else {
        const parsedPeriods = source.includedPeriods.filter((value): value is MulliganLabCoveragePeriod => value === "preseason" || value === "current-season");
        if (parsedPeriods.length !== source.includedPeriods.length || new Set(parsedPeriods).size !== parsedPeriods.length) {
          issue(issues, "source.includedPeriods", "Included history periods must be unique known periods.");
        } else {
          includedPeriods = parsedPeriods;
        }
      }
      const seasonValue = record(source?.seasonCoverage);
      const currentSeasonStartedOn = isoDay(seasonValue?.currentSeasonStartedOn, "source.seasonCoverage.currentSeasonStartedOn", issues);
      const preseasonFacts = integer(seasonValue?.preseasonFacts);
      const currentSeasonFacts = integer(seasonValue?.currentSeasonFacts);
      if (currentSeasonStartedOn && currentSeasonStartedOn !== MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON) issue(issues, "source.seasonCoverage.currentSeasonStartedOn", "Unexpected current-season boundary.");
      if (preseasonFacts === null || preseasonFacts < 0) issue(issues, "source.seasonCoverage.preseasonFacts", "Pre-season fact count must be a non-negative integer.");
      if (currentSeasonFacts === null || currentSeasonFacts < 0) issue(issues, "source.seasonCoverage.currentSeasonFacts", "Current-season fact count must be a non-negative integer.");
      if (currentSeasonStartedOn === MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON && preseasonFacts !== null && preseasonFacts >= 0 && currentSeasonFacts !== null && currentSeasonFacts >= 0) {
        seasonCoverage = { currentSeasonStartedOn, preseasonFacts, currentSeasonFacts };
      }
      if (typeof source?.backfillComplete !== "boolean") {
        issue(issues, "source.backfillComplete", "Historical backfill state must be explicit.");
      } else {
        backfillComplete = source.backfillComplete;
      }
    }
    if (root.status === "ready") {
      observedFrom = isoDay(source?.observedFrom, "source.observedFrom", issues);
      observedThrough = isoDay(source?.observedThrough, "source.observedThrough", issues);
      const parsedFacts = integer(source?.includedFacts);
      if (parsedFacts === null || parsedFacts < 0) issue(issues, "source.includedFacts", "Included fact count must be a non-negative integer.");
      else includedFacts = parsedFacts;
      if (typeof source?.coverageTruncated !== "boolean") issue(issues, "source.coverageTruncated", "Coverage truncation must be explicit.");
      else coverageTruncated = source.coverageTruncated;
      if (observedFrom && observedThrough && observedFrom > observedThrough) issue(issues, "source.observedThrough", "Observation window cannot end before it starts.");
    } else {
      if (source?.observedFrom !== null || source?.observedThrough !== null || source?.includedFacts !== 0 || source?.coverageTruncated !== false) {
        issue(issues, "source", "Unavailable v2 responses must publish an empty observation window.");
      }
    }
    if (seasonCoverage && seasonCoverage.preseasonFacts + seasonCoverage.currentSeasonFacts !== includedFacts) {
      issue(issues, "source.seasonCoverage", "Season fact counts must add up to the included fact count.");
    }
    if (seasonCoverage) {
      const expectedPeriods: MulliganLabCoveragePeriod[] = [
        ...(seasonCoverage.preseasonFacts > 0 ? ["preseason" as const] : []),
        ...(seasonCoverage.currentSeasonFacts > 0 ? ["current-season" as const] : [])
      ];
      if (includedPeriods.length !== expectedPeriods.length || expectedPeriods.some((period) => !includedPeriods.includes(period))) {
        issue(issues, "source.includedPeriods", "Included periods must match the non-empty season fact groups.");
      }
    }
  }

  if (root.status === "unavailable") {
    const reason = requiredString(root.reason, "reason", issues);
    if (!["snapshot_not_configured", "snapshot_invalid", "snapshot_expired", "data_unavailable"].includes(reason)) issue(issues, "reason", "Unknown unavailable reason.");
    if (root.generatedAt !== null || root.expiresAt !== null) issue(issues, "generatedAt", "Unavailable responses must not claim generated data.");
    if (rawDrills?.length) issue(issues, "drills", "Unavailable responses cannot contain drills.");
    if (issues.length) return invalidApiParseResult("Mulligan Lab response failed validation.", issues, rawDrills?.length ?? 0);
    return { status: "unavailable", generatedAt: null, expiresAt: null, drills: [], reason, issues: [], accepted: 0, rejected: 0, observedFrom: null, observedThrough: null, includedFacts: 0, coverageTruncated: false, coveragePolicy, includedPeriods, seasonCoverage, backfillComplete };
  }
  if (root.status !== "ready") issue(issues, "status", "Status must be ready or unavailable.");
  const generatedAt = isoDate(root.generatedAt, "generatedAt", issues);
  const expiresAt = isoDate(root.expiresAt, "expiresAt", issues);
  if (generatedAt && expiresAt && Date.parse(generatedAt) >= Date.parse(expiresAt)) issue(issues, "expiresAt", "Expiry must be after generation.");
  if (generatedAt && Date.parse(generatedAt) > Date.now() + 10 * 60 * 1_000) issue(issues, "generatedAt", "Generation time cannot be in the future.");
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) issue(issues, "expiresAt", "Expired community packs cannot be used for training.");
  if (!rawDrills?.length || rawDrills.length > 64) issue(issues, "drills", "Ready responses require between 1 and 64 drills.");
  if (issues.length || !rawDrills || minimumHands === null || minimumPlayers === null) {
    return invalidApiParseResult("Mulligan Lab response failed validation.", issues, rawDrills?.length ?? 0);
  }

  const drills: MulliganLabApiDrill[] = [];
  const seenDrillIds = new Set<string>();
  const seenObservedHands = new Set<string>();
  let rejected = 0;
  rawDrills.forEach((rawDrill, index) => {
    const drillIssues: MulliganLabValidationIssue[] = [];
    const value = record(rawDrill);
    const prefix = `drills[${index}]`;
    if (!value) {
      issue(drillIssues, prefix, "Drill must be an object.");
    }
    const id = requiredString(value?.id, `${prefix}.id`, drillIssues);
    const isV2 = apiVersion === MULLIGAN_LAB_API_SCHEMA_VERSION;
    const observedHandId = isV2 ? "" : requiredString(value?.observedHandId, `${prefix}.observedHandId`, drillIssues);
    if (!(isV2 ? /^ml2_[a-f0-9]{32}$/ : /^ml1_[a-f0-9]{32}$/).test(id)) issue(drillIssues, `${prefix}.id`, "Drill id is not a canonical opaque id for this schema version.");
    if (!isV2 && !/^mh1_[a-f0-9]{32}$/.test(observedHandId)) issue(drillIssues, `${prefix}.observedHandId`, "Observed hand id is not a canonical opaque id.");
    if (isV2 && (value?.observedHandId !== undefined || value?.observation !== undefined || value?.observedDecision !== undefined)) {
      issue(drillIssues, prefix, "Version 2 drills cannot expose sampled-player provenance or decisions.");
    }
    if (seenDrillIds.has(id)) issue(drillIssues, `${prefix}.id`, "Duplicate drill id.");
    if (!isV2 && seenObservedHands.has(observedHandId)) issue(drillIssues, `${prefix}.observedHandId`, "Duplicate observed hand.");
    seenDrillIds.add(id);
    if (!isV2) seenObservedHands.add(observedHandId);
    const observationValue = isV2 ? null : record(value?.observation);
    const observationProvider = observationValue?.provider === "atlas" || observationValue?.provider === "tcga" ? observationValue.provider : null;
    const observationMatchKey = isV2 ? "" : requiredString(observationValue?.matchKey, `${prefix}.observation.matchKey`, drillIssues);
    const observationEventKey = isV2 ? "" : requiredString(observationValue?.eventKey, `${prefix}.observation.eventKey`, drillIssues);
    const observationGameNumber = isV2 ? null : integer(observationValue?.gameNumber);
    const observationObservedOn = isV2 ? "" : isoDay(observationValue?.observedOn, `${prefix}.observation.observedOn`, drillIssues);
    if (!isV2) {
      if (!observationProvider) issue(drillIssues, `${prefix}.observation.provider`, "Observation provider must be atlas or tcga.");
      if (!/^mm1_[a-f0-9]{32}$/.test(observationMatchKey)) issue(drillIssues, `${prefix}.observation.matchKey`, "Match lineage must be an opaque canonical key.");
      if (!/^me1_[a-f0-9]{32}$/.test(observationEventKey)) issue(drillIssues, `${prefix}.observation.eventKey`, "Event lineage must be an opaque canonical key.");
      if (observationGameNumber !== 1) issue(drillIssues, `${prefix}.observation.gameNumber`, "Mulligan Lab v1 accepts Game 1 only.");
      if (observationObservedOn && generatedAt && Date.parse(`${observationObservedOn}T00:00:00.000Z`) > Date.parse(generatedAt)) issue(drillIssues, `${prefix}.observation.observedOn`, "Observation day cannot be newer than its generated pack.");
    }
    const matchup = record(value?.matchup);
    const playerLegend = apiRegistryCard(matchup?.playerLegend, registry, "Legend", `${prefix}.matchup.playerLegend`, drillIssues);
    const opponentLegend = apiRegistryCard(matchup?.opponentLegend, registry, "Legend", `${prefix}.matchup.opponentLegend`, drillIssues);
    const wentFirst = value?.initiative === "first" ? "1st" as const : value?.initiative === "second" ? "2nd" as const : null;
    if (!wentFirst) issue(drillIssues, `${prefix}.initiative`, "Initiative must be first or second.");
    const hand = parseApiCardList(value?.hand, registry, `${prefix}.hand`, drillIssues);
    if (hand.length !== 4) issue(drillIssues, `${prefix}.hand`, "A drill must contain exactly four observed cards.");
    const decision = isV2 ? null : record(value?.observedDecision);
    const redrawnIndexes = isV2 ? [] : integerArray(decision?.redrawnCardIndexes, `${prefix}.observedDecision.redrawnCardIndexes`, drillIssues);
    if (!isV2 && (redrawnIndexes.length > 2 || new Set(redrawnIndexes).size !== redrawnIndexes.length || redrawnIndexes.some((position) => position < 0 || position >= 4))) {
      issue(drillIssues, `${prefix}.observedDecision.redrawnCardIndexes`, "Redrawn indexes must be unique opening-hand positions, with no more than two cards.");
    }
    const observedWin = isV2 ? null : typeof decision?.wonGame === "boolean" ? decision.wonGame : null;
    if (!isV2 && observedWin === null) issue(drillIssues, `${prefix}.observedDecision.wonGame`, "Completed game outcome is required.");

    const deckValue = record(value?.deck);
    const fingerprint = requiredString(deckValue?.fingerprint, `${prefix}.deck.fingerprint`, drillIssues);
    const mainDeck = parseApiDeck(deckValue?.mainDeck, registry, `${prefix}.deck.mainDeck`, drillIssues);
    const chosenChampionCode = deckValue?.chosenChampionCode === undefined || deckValue?.chosenChampionCode === null
      ? null
      : canonicalCode(deckValue.chosenChampionCode);
    const chosenChampion = chosenChampionCode ? registry.byCode.get(chosenChampionCode) ?? null : null;
    if (chosenChampionCode && (!chosenChampion || chosenChampion.supertype?.toLocaleLowerCase("en") !== "champion")) {
      issue(drillIssues, `${prefix}.deck.chosenChampionCode`, "Chosen Champion must use a registry-confirmed Champion print.");
    }
    if (chosenChampionCode) {
      const chosenEntry = mainDeck.find((card) => card.code === chosenChampionCode);
      if (!chosenEntry || chosenEntry.count !== 1 || hand.some((card) => card.code === chosenChampionCode)) {
        issue(drillIssues, `${prefix}.deck.chosenChampionCode`, "Chosen Champion must be one face-up registered copy outside the opening hand.");
      }
    }
    if (mainDeck.reduce((sum, card) => sum + card.count, 0) !== 40) issue(drillIssues, `${prefix}.deck.mainDeck`, "Observed deck must contain exactly 40 cards.");
    if (fingerprint !== mulliganLabApiDeckFingerprint(mainDeck)) issue(drillIssues, `${prefix}.deck.fingerprint`, "Deck fingerprint does not match the returned canonical 40-card snapshot.");
    if (hand.length === 4 && !multisetFits(hand.map((card) => card.code), mainDeck)) issue(drillIssues, `${prefix}.hand`, "Opening hand exceeds card quantities in the observed deck.");

    const evidenceValue = record(value?.evidence);
    const evidenceScope = evidenceValue?.scope === "matchup" || evidenceValue?.scope === "matchup-initiative"
      ? evidenceValue.scope
      : null;
    if (!evidenceScope) issue(drillIssues, `${prefix}.evidence.scope`, "Evidence scope must identify the matchup cohort.");
    if (apiVersion === MULLIGAN_LAB_API_SCHEMA_VERSION && evidenceScope !== "matchup") {
      issue(drillIssues, `${prefix}.evidence.scope`, "Mulligan Lab v2 evidence must pool the full oriented legend matchup.");
    }
    const deckScope = evidenceValue?.deckScope === "all-observed-decks" ? evidenceValue.deckScope : null;
    const guidanceBasis = evidenceValue?.guidanceBasis === "community-keep-rate" ? evidenceValue.guidanceBasis : null;
    const outcomeInterpretation = evidenceValue?.outcomeInterpretation === "descriptive-not-causal" ? evidenceValue.outcomeInterpretation : null;
    const playerLegendIdentityCode = canonicalCode(evidenceValue?.playerLegendIdentityCode);
    const opponentLegendIdentityCode = canonicalCode(evidenceValue?.opponentLegendIdentityCode);
    if (isV2 && !deckScope) issue(drillIssues, `${prefix}.evidence.deckScope`, "Version 2 evidence must pool every observed deck in the matchup.");
    if (isV2 && !guidanceBasis) issue(drillIssues, `${prefix}.evidence.guidanceBasis`, "Version 2 guidance must be based on community keep rates.");
    if (isV2 && !outcomeInterpretation) issue(drillIssues, `${prefix}.evidence.outcomeInterpretation`, "Version 2 outcomes must be labelled descriptive, not causal.");
    if (isV2 && playerLegend && playerLegendIdentityCode !== riftboundBasePrintCode(playerLegend.code)) issue(drillIssues, `${prefix}.evidence.playerLegendIdentityCode`, "Player legend identity must match the displayed official print.");
    if (isV2 && opponentLegend && opponentLegendIdentityCode !== riftboundBasePrintCode(opponentLegend.code)) issue(drillIssues, `${prefix}.evidence.opponentLegendIdentityCode`, "Opponent legend identity must match the displayed official print.");
    const hands = integer(evidenceValue?.hands);
    const players = integer(evidenceValue?.players);
    if (hands === null || hands < 1) issue(drillIssues, `${prefix}.evidence.hands`, "Drill must be backed by at least one exact observed hand.");
    if (players === null || players < 1) issue(drillIssues, `${prefix}.evidence.players`, "Drill must be backed by at least one contributing player.");
    if (hands !== null && players !== null && players > hands) issue(drillIssues, `${prefix}.evidence.players`, "Players cannot exceed hands.");
    const evidenceStatus = evidenceValue?.status === "sufficient" || evidenceValue?.status === "early" ? evidenceValue.status : null;
    if (!evidenceStatus) issue(drillIssues, `${prefix}.evidence.status`, "Evidence status must be sufficient or early.");
    if (evidenceStatus === "sufficient" && (hands! < minimumHands || players! < minimumPlayers)) {
      issue(drillIssues, `${prefix}.evidence.status`, "Sufficient evidence cannot be published below the pack's privacy thresholds.");
    }
    if (evidenceStatus === "early" && hands !== null && players !== null && hands >= minimumHands && players >= minimumPlayers) {
      issue(drillIssues, `${prefix}.evidence.status`, "Evidence meeting both thresholds must be marked sufficient.");
    }
    const cardStats = parseApiCardEvidence(value?.cardEvidence, hand, hands, players, minimumHands, minimumPlayers, registry, evidenceStatus, apiVersion, `${prefix}.cardEvidence`, drillIssues);
    const drillContext = value?.context === undefined
      ? undefined
      : parseMulliganLabDrillContext(value.context, hand, registry, `${prefix}.context`, drillIssues);
    const decisionEvidence = value?.decisionEvidence === undefined
      ? undefined
      : parseMulliganLabDecisionEvidence(value.decisionEvidence, minimumHands, minimumPlayers, `${prefix}.decisionEvidence`, drillIssues);
    if (drillContext?.setup) {
      if ((drillContext.setup.chosenChampion?.code ?? null) !== chosenChampionCode) {
        issue(drillIssues, `${prefix}.context.setup.chosenChampion`, "Setup Champion must match the proven registered deck designation.");
      }
      if ((chosenChampionCode === null) !== (drillContext.setup.replacementPoolCards === null)) {
        issue(drillIssues, `${prefix}.context.setup.replacementPoolCards`, "Replacement-pool size requires a proven Chosen Champion.");
      }
    }

    const legacyProvenanceValid = isV2 || Boolean(observationProvider && observationGameNumber === 1 && observedWin !== null);
    if (!value || !legacyProvenanceValid || !playerLegend || !opponentLegend || !wentFirst || hands === null || players === null || !evidenceStatus || !evidenceScope || !cardStats || drillIssues.length) {
      rejected += 1;
      issues.push(...drillIssues);
      return;
    }
    const redrawSet = new Set(redrawnIndexes);
    drills.push({
      id,
      source: "community",
      ...(!isV2 && observationProvider && observedWin !== null ? {
        observedHandId,
        observation: {
          provider: observationProvider,
          matchKey: observationMatchKey,
          gameNumber: 1 as const,
          eventKey: observationEventKey,
          observedOn: observationObservedOn
        },
        observedRedrawnCardIndexes: redrawnIndexes,
        observedWin
      } : {}),
      playerLegend,
      opponentLegend,
      wentFirst,
      cards: hand.map((card, cardIndex) => ({
        ...card,
        ...(!isV2 ? { observedAction: redrawSet.has(cardIndex) ? "redrawn" as const : "kept" as const } : {}),
        stats: cardStats.get(card.code)!
      })),
      deck: { fingerprint, mainDeck, ...(deckValue?.chosenChampionCode !== undefined ? { chosenChampionCode } : {}) },
      ...(drillContext ? { context: drillContext } : {}),
      ...(decisionEvidence ? { decisionEvidence } : {}),
      evidence: {
        status: evidenceStatus,
        scope: evidenceScope,
        hands,
        players,
        ...(isV2 && deckScope && guidanceBasis && outcomeInterpretation ? { deckScope, guidanceBasis, outcomeInterpretation, playerLegendIdentityCode, opponentLegendIdentityCode } : {})
      }
    });
  });
  if (!drills.length) {
    return invalidApiParseResult("Every community drill failed validation.", issues, rejected);
  }
  return { status: "ready", generatedAt, expiresAt, drills, reason: "", issues, accepted: drills.length, rejected, observedFrom, observedThrough, includedFacts, coverageTruncated, coveragePolicy, includedPeriods, seasonCoverage, backfillComplete };
}

/** Strict adapter for the queryable full-corpus GET /api/app/mulligan-lab/v2 pack. */
export function parseMulliganLabTargetPackResponse(raw: unknown, registry: MulliganLabRegistry): MulliganLabApiParseResult {
  const root = record(raw);
  const issues: MulliganLabValidationIssue[] = [];
  if (!root) return invalidApiResult("Response must be an object.");
  if (root.schema !== "riftlite-mulligan-lab-pack") issue(issues, "schema", "Unexpected targeted Mulligan Lab schema.");
  if (integer(root.version) !== 1) issue(issues, "version", "Unsupported targeted Mulligan Lab version.");
  const targetQuery = parseMulliganLabTargetQuery(root.query, registry, "query", issues);
  const rawDrills = Array.isArray(root.drills) ? root.drills : null;
  if (!rawDrills) issue(issues, "drills", "Drills must be an array.");
  if (root.status === "unavailable") {
    const reason = nonEmptyString(root.reason);
    if (!["snapshot_not_configured", "snapshot_invalid", "snapshot_expired", "data_unavailable", "matchup_not_observed"].includes(reason)) issue(issues, "reason", "Unknown targeted-pack unavailable reason.");
    if (root.generatedAt !== null || root.expiresAt !== null || rawDrills?.length) issue(issues, "$", "Unavailable targeted packs cannot claim generated drills.");
    if (!targetQuery) issue(issues, "query", "A valid resolved target query is required.");
    if (root.source !== null) validateMulliganLabTargetSource(root.source, registry, issues);
    if (issues.length) return invalidApiParseResult("Targeted Mulligan Lab response failed validation.", issues, rawDrills?.length ?? 0);
    return {
      status: "unavailable",
      generatedAt: null,
      expiresAt: null,
      drills: [],
      reason,
      issues: [],
      accepted: 0,
      rejected: 0,
      observedFrom: null,
      observedThrough: null,
      includedFacts: 0,
      coverageTruncated: false,
      coveragePolicy: null,
      includedPeriods: [],
      seasonCoverage: null,
      backfillComplete: null,
      targetQuery: targetQuery!
    };
  }
  if (root.status !== "ready") issue(issues, "status", "Status must be ready or unavailable.");
  validateMulliganLabTargetSource(root.source, registry, issues);
  if (targetQuery) validateMulliganLabReadyTargetQuery(targetQuery, issues);
  if (issues.length || !targetQuery) return invalidApiParseResult("Targeted Mulligan Lab response failed validation.", issues, rawDrills?.length ?? 0);
  const adapted = { ...root, schema: "riftlite-mulligan-lab", version: MULLIGAN_LAB_API_SCHEMA_VERSION };
  const parsed = parseMulliganLabApiResponse(adapted, registry);
  if (parsed.status !== "ready") return parsed;
  if (parsed.rejected || parsed.issues.length || parsed.drills.length !== rawDrills!.length) {
    return invalidApiParseResult(
      "Targeted Mulligan Lab response failed validation.",
      parsed.issues.length ? parsed.issues : [{ path: "drills", message: "Every targeted drill must pass strict validation." }],
      parsed.rejected || rawDrills!.length
    );
  }
  const missingContext = parsed.drills.findIndex((drill) => !drill.context || drill.cards.some((card) => !card.stats.slices));
  if (missingContext >= 0) {
    return invalidApiParseResult("Targeted Mulligan Lab response failed validation.", [{
      path: `drills[${missingContext}]`,
      message: "Targeted drills require registry-confirmed context and all evidence slices."
    }], parsed.drills.length);
  }
  const relationshipIssues: MulliganLabValidationIssue[] = [];
  const invalidRelationshipDrills = new Set<number>();
  parsed.drills.forEach((drill, index) => {
    const before = relationshipIssues.length;
    validateMulliganLabTargetDrill(drill, targetQuery, index, relationshipIssues);
    if (relationshipIssues.length > before) invalidRelationshipDrills.add(index);
  });
  if (relationshipIssues.length) {
    return invalidApiParseResult(
      "Targeted Mulligan Lab response failed validation.",
      relationshipIssues,
      invalidRelationshipDrills.size
    );
  }
  return { ...parsed, targetQuery };
}

function parseMulliganLabTargetQuery(
  raw: unknown,
  registry: MulliganLabRegistry,
  path: string,
  issues: MulliganLabValidationIssue[]
): MulliganLabTargetQuery | null {
  const start = issues.length;
  const value = record(raw);
  if (!value) {
    issue(issues, path, "Target query metadata is required.");
    return null;
  }
  assertMulliganLabTargetKeys(value, ["requested", "resolved", "fallbackReason"], path, issues);
  const requested = record(value?.requested);
  const resolved = record(value?.resolved);
  if (!requested) issue(issues, `${path}.requested`, "Requested target selectors are required.");
  else assertMulliganLabTargetKeys(requested, ["playerLegend", "opponentLegend", "deckFingerprint", "initiative"], `${path}.requested`, issues);
  if (!resolved) issue(issues, `${path}.resolved`, "Resolved target selectors are required.");
  else assertMulliganLabTargetKeys(resolved, ["scope", "deckFingerprint", "sharedCards", "totalCards"], `${path}.resolved`, issues);
  const playerLegend = targetLegendIdentityCode(requested?.playerLegend, registry, `${path}.requested.playerLegend`, issues);
  const opponentLegend = requested?.opponentLegend === null
    ? null
    : targetLegendIdentityCode(requested?.opponentLegend, registry, `${path}.requested.opponentLegend`, issues);
  const deckFingerprint = requested?.deckFingerprint === null ? null : sha256Hex(requested?.deckFingerprint);
  if (requested?.deckFingerprint !== null && !deckFingerprint) issue(issues, `${path}.requested.deckFingerprint`, "Requested deck fingerprint must be a lowercase SHA-256 digest or null.");
  const initiative = requested?.initiative === null || requested?.initiative === "first" || requested?.initiative === "second" ? requested.initiative : undefined;
  if (initiative === undefined) issue(issues, `${path}.requested.initiative`, "Requested initiative must be first, second, or null.");
  const scope = resolved?.scope === "exact-deck" || resolved?.scope === "matchup" || resolved?.scope === "player-legend" ? resolved.scope : null;
  if (!scope) issue(issues, `${path}.resolved.scope`, "Resolved scope must be exact-deck, matchup, or player-legend.");
  const resolvedFingerprint = resolved?.deckFingerprint === null ? null : sha256Hex(resolved?.deckFingerprint);
  if (resolved?.deckFingerprint !== null && !resolvedFingerprint) issue(issues, `${path}.resolved.deckFingerprint`, "Resolved deck fingerprint must be a lowercase SHA-256 digest or null.");
  const sharedCards = resolved?.sharedCards === null ? null : integer(resolved?.sharedCards);
  const totalCards = resolved?.totalCards === null ? null : integer(resolved?.totalCards);
  const fallbackReason = value?.fallbackReason === null || value?.fallbackReason === "deck-not-observed" || value?.fallbackReason === "insufficient-private-cohort" || value?.fallbackReason === "matchup-not-observed"
    ? value.fallbackReason
    : undefined;
  if (fallbackReason === undefined) issue(issues, `${path}.fallbackReason`, "Unknown targeted-pack fallback reason.");
  if ((sharedCards === null) !== (totalCards === null) || (sharedCards !== null && (sharedCards < 0 || sharedCards > 40 || totalCards !== 40))) {
    issue(issues, `${path}.resolved`, "Resolved deck similarity must be null/null or zero through 40 of 40 cards.");
  }
  if (scope === "exact-deck" && (!deckFingerprint || resolvedFingerprint !== deckFingerprint || sharedCards !== 40 || totalCards !== 40)) {
    issue(issues, `${path}.resolved`, "Exact-deck resolution must match the requested 40-card fingerprint.");
  }
  if (scope !== "exact-deck" && (resolvedFingerprint !== null || sharedCards !== null || totalCards !== null)) {
    issue(issues, `${path}.resolved`, "Broader fallbacks cannot claim an exact deck match.");
  }
  if (issues.length !== start || !requested || !resolved || !playerLegend || opponentLegend === "" || initiative === undefined || !scope || fallbackReason === undefined) return null;
  return {
    requested: { playerLegend, opponentLegend, deckFingerprint, initiative },
    resolved: { scope, deckFingerprint: resolvedFingerprint, sharedCards, totalCards: totalCards as 40 | null },
    fallbackReason
  };
}

function validateMulliganLabReadyTargetQuery(
  query: MulliganLabTargetQuery,
  issues: MulliganLabValidationIssue[]
): void {
  const { requested, resolved, fallbackReason } = query;
  if (resolved.scope === "exact-deck") {
    if (fallbackReason !== null) issue(issues, "query.fallbackReason", "Exact-deck resolution cannot claim a fallback.");
    return;
  }
  if (resolved.scope === "matchup") {
    if (!requested.opponentLegend) issue(issues, "query.requested.opponentLegend", "Matchup resolution requires a requested opponent Legend.");
    if (requested.deckFingerprint === null && fallbackReason !== null) {
      issue(issues, "query.fallbackReason", "A direct matchup request cannot claim a fallback.");
    }
    if (
      requested.deckFingerprint !== null
      && fallbackReason !== "deck-not-observed"
      && fallbackReason !== "insufficient-private-cohort"
    ) issue(issues, "query.fallbackReason", "A deck request resolved to matchup must disclose why exact-deck evidence was unavailable.");
    return;
  }

  if (requested.opponentLegend) {
    const allowed = requested.deckFingerprint
      ? ["matchup-not-observed", "deck-not-observed", "insufficient-private-cohort"]
      : ["matchup-not-observed"];
    if (!allowed.includes(fallbackReason ?? "")) {
      issue(issues, "query.fallbackReason", "A requested matchup resolved to Player-Legend must disclose the unavailable narrower cohort.");
    }
  } else if (requested.deckFingerprint) {
    if (fallbackReason !== "deck-not-observed" && fallbackReason !== "insufficient-private-cohort") {
      issue(issues, "query.fallbackReason", "A deck-only request resolved to Player-Legend must disclose the deck fallback.");
    }
  } else if (fallbackReason !== null) {
    issue(issues, "query.fallbackReason", "A direct Player-Legend request cannot claim a fallback.");
  }
}

function validateMulliganLabTargetDrill(
  drill: MulliganLabApiDrill,
  query: MulliganLabTargetQuery,
  index: number,
  issues: MulliganLabValidationIssue[]
): void {
  const path = `drills[${index}]`;
  if (riftboundBasePrintCode(drill.playerLegend.code) !== query.requested.playerLegend) {
    issue(issues, `${path}.matchup.playerLegend`, "Targeted drill player Legend does not match the requested identity.");
  }
  if (
    query.resolved.scope !== "player-legend"
    && query.requested.opponentLegend
    && riftboundBasePrintCode(drill.opponentLegend.code) !== query.requested.opponentLegend
  ) issue(issues, `${path}.matchup.opponentLegend`, "Targeted drill opponent Legend does not match the requested matchup.");
  if (
    query.requested.initiative
    && drill.wentFirst !== (query.requested.initiative === "first" ? "1st" : "2nd")
  ) issue(issues, `${path}.initiative`, "Targeted drill does not match the requested initiative.");
  if (query.resolved.scope === "exact-deck" && drill.deck.fingerprint !== query.resolved.deckFingerprint) {
    issue(issues, `${path}.deck.fingerprint`, "Exact-deck targeted drills must use the resolved deck fingerprint.");
  }
}

function validateMulliganLabTargetSource(
  raw: unknown,
  registry: MulliganLabRegistry,
  issues: MulliganLabValidationIssue[]
): void {
  const value = record(raw);
  if (!value) {
    issue(issues, "source", "Targeted source metadata is required.");
    return;
  }
  assertMulliganLabTargetKeys(value, [
    "kind",
    "corpus",
    "minimumHands",
    "minimumPlayers",
    "observedFrom",
    "observedThrough",
    "includedFacts",
    "coverageTruncated",
    "coveragePolicy",
    "includedPeriods",
    "backfillComplete",
    "seasonCoverage",
    "cardRegistryGeneratedAt",
    "cardRegistryPrints"
  ], "source", issues);
  for (const key of ["coveragePolicy", "includedPeriods", "backfillComplete", "seasonCoverage"] as const) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) issue(issues, `source.${key}`, "Targeted packs require the complete all-history coverage contract.");
  }
  const seasonCoverage = record(value.seasonCoverage);
  if (seasonCoverage) {
    assertMulliganLabTargetKeys(
      seasonCoverage,
      ["currentSeasonStartedOn", "preseasonFacts", "currentSeasonFacts"],
      "source.seasonCoverage",
      issues
    );
    const preseasonFacts = integer(seasonCoverage.preseasonFacts);
    const currentSeasonFacts = integer(seasonCoverage.currentSeasonFacts);
    if (preseasonFacts !== null && preseasonFacts >= 0 && currentSeasonFacts !== null && currentSeasonFacts >= 0 && Array.isArray(value.includedPeriods)) {
      const includedPeriods = value.includedPeriods as unknown[];
      const expectedPeriods: MulliganLabCoveragePeriod[] = [
        ...(preseasonFacts > 0 ? ["preseason" as const] : []),
        ...(currentSeasonFacts > 0 ? ["current-season" as const] : [])
      ];
      if (
        includedPeriods.length !== expectedPeriods.length
        || expectedPeriods.some((period, index) => includedPeriods[index] !== period)
      ) issue(issues, "source.includedPeriods", "Targeted coverage periods must match non-empty season groups in canonical order.");
    }
  }
  const registryGeneratedAt = nonEmptyString(value.cardRegistryGeneratedAt);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(registryGeneratedAt)
    || !Number.isFinite(Date.parse(registryGeneratedAt))
  ) issue(issues, "source.cardRegistryGeneratedAt", "Targeted registry timestamp must be an ISO date-time with an explicit offset.");
  const registryPrints = integer(value.cardRegistryPrints);
  if (registryPrints === null || registryPrints < 1) {
    issue(issues, "source.cardRegistryPrints", "Targeted registry size must be a positive integer.");
  } else if (registryPrints !== registry.byCode.size) {
    issue(issues, "source.cardRegistryPrints", "Targeted pack registry size does not match RiftLite's packaged card catalog.");
  }
}

function targetLegendIdentityCode(
  raw: unknown,
  registry: MulliganLabRegistry,
  path: string,
  issues: MulliganLabValidationIssue[]
): string {
  const code = registryCode(raw, registry, "Legend", path, issues);
  if (code && riftboundBasePrintCode(code) !== code) {
    issue(issues, path, "Target Legend selector must use its canonical base identity code.");
    return "";
  }
  return code;
}

function assertMulliganLabTargetKeys(
  value: JsonRecord,
  allowed: readonly string[],
  path: string,
  issues: MulliganLabValidationIssue[]
): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) issue(issues, `${path}.${key}`, "Unexpected field in strict targeted Mulligan Lab metadata.");
  }
}

export function selectMulliganLabExercises(
  pack: MulliganLabCommunityPack,
  filters: MulliganLabFilters = {}
): MulliganLabExercise[] {
  const player = filters.playerLegendCode ? canonicalCode(filters.playerLegendCode) : "";
  const opponent = filters.opponentLegendCode ? canonicalCode(filters.opponentLegendCode) : "";
  return pack.exercises.filter((exercise) => (
    (!player || exercise.playerLegendCode === player) &&
    (!opponent || exercise.opponentLegendCode === opponent) &&
    (!filters.wentFirst || exercise.wentFirst === filters.wentFirst) &&
    (!filters.provider || exercise.provider === filters.provider)
  ));
}

function validateDeckSnapshotRef(
  value: JsonRecord | null,
  matchId: string,
  gameNumber: number | null,
  playerLegendCode: string,
  openingHandCodes: string[],
  registry: MulliganLabRegistry,
  issues: MulliganLabValidationIssue[]
): MulliganLabDeckSnapshotRef | null {
  if (!value) {
    issue(issues, "deckSnapshot", "An immutable same-game deck snapshot is required.");
    return null;
  }
  const snapshotMatchId = requiredString(value.matchId, "deckSnapshot.matchId", issues);
  const snapshotGameNumber = integer(value.gameNumber);
  const snapshotHash = requiredString(value.snapshotHash, "deckSnapshot.snapshotHash", issues);
  const snapshotJson = requiredString(value.snapshotJson, "deckSnapshot.snapshotJson", issues);
  if (snapshotMatchId !== matchId) issue(issues, "deckSnapshot.matchId", "Deck snapshot must come from the observed match.");
  if (snapshotGameNumber !== gameNumber) issue(issues, "deckSnapshot.gameNumber", "Deck snapshot must come from the observed game.");
  if (!snapshotJson || mulliganLabDeckSnapshotHash(snapshotJson) !== snapshotHash) {
    issue(issues, "deckSnapshot.snapshotHash", "Deck snapshot hash does not match its immutable JSON payload.");
  }
  const deck = parseStrictDeckSnapshot(snapshotJson, registry, issues);
  if (!deck) return null;
  if (deck.legendCode !== playerLegendCode) issue(issues, "deckSnapshot.snapshotJson.legendCode", "Deck legend must match the observed player legend.");
  const deckCounts = multiset(deck.mainDeck.flatMap((entry) => Array.from({ length: entry.qty }, () => entry.code)));
  const handCounts = multiset(openingHandCodes);
  for (const [code, count] of handCounts) {
    if ((deckCounts.get(code) ?? 0) < count) issue(issues, "openingHandCodes", `${code} exceeds its quantity in the observed deck snapshot.`);
  }
  return { matchId: snapshotMatchId, gameNumber: snapshotGameNumber ?? 0, snapshotHash, snapshotJson };
}

function parseStrictDeckSnapshot(
  snapshotJson: string,
  registry: MulliganLabRegistry,
  issues: MulliganLabValidationIssue[]
): { legendCode: string; mainDeck: Array<{ code: string; qty: number }> } | null {
  let value: JsonRecord | null = null;
  try {
    value = record(JSON.parse(snapshotJson));
  } catch {
    issue(issues, "deckSnapshot.snapshotJson", "Deck snapshot must be valid JSON.");
    return null;
  }
  if (!value) return null;
  const legendEntry = record(value.legendEntry ?? value.legend_entry);
  const legendCode = registryCode(
    value.legendCode ?? value.legend_code ?? legendEntry?.cardId ?? legendEntry?.card_id ?? legendEntry?.code,
    registry,
    "Legend",
    "deckSnapshot.snapshotJson.legendCode",
    issues
  );
  const mainRaw = Array.isArray(value.mainDeck) ? value.mainDeck : Array.isArray(value.main_deck) ? value.main_deck : null;
  if (!mainRaw?.length) {
    issue(issues, "deckSnapshot.snapshotJson.mainDeck", "A canonical non-empty main deck is required.");
    return null;
  }
  const mainDeck: Array<{ code: string; qty: number }> = [];
  mainRaw.forEach((rawEntry, index) => {
    const entry = record(rawEntry);
    if (!entry) {
      issue(issues, `deckSnapshot.snapshotJson.mainDeck[${index}]`, "Deck entry must be an object.");
      return;
    }
    const code = registryCode(entry.cardId ?? entry.card_id ?? entry.code ?? entry.cardCode ?? entry.card_code, registry, undefined, `deckSnapshot.snapshotJson.mainDeck[${index}].code`, issues);
    const qty = integer(entry.qty ?? entry.quantity ?? entry.count);
    if (!qty || qty < 1) issue(issues, `deckSnapshot.snapshotJson.mainDeck[${index}].qty`, "Quantity must be a positive integer.");
    const card = code ? registry.byCode.get(code) : undefined;
    if (card && ["legend", "battlefield", "rune"].includes(card.type.toLowerCase())) {
      issue(issues, `deckSnapshot.snapshotJson.mainDeck[${index}].code`, `${code} cannot be a main-deck card.`);
    }
    if (code && qty && qty > 0) mainDeck.push({ code, qty });
  });
  const mainDeckQuantity = mainDeck.reduce((sum, entry) => sum + entry.qty, 0);
  if (mainDeckQuantity !== 40) issue(issues, "deckSnapshot.snapshotJson.mainDeck", "A training deck snapshot must contain exactly 40 main-deck cards.");
  return legendCode && mainDeck.length ? { legendCode, mainDeck } : null;
}

function parseCohort(raw: unknown, path: string, issues: MulliganLabValidationIssue[]): MulliganLabCohort | null {
  const value = record(raw);
  if (!value || value.scope !== "deck-matchup-seat") {
    issue(issues, path, "Cohort scope must be deck-matchup-seat.");
    return null;
  }
  const eligibleHands = integer(value.eligibleHands);
  const uniquePlayers = integer(value.uniquePlayers);
  if (eligibleHands === null || eligibleHands < MULLIGAN_LAB_MIN_ELIGIBLE_HANDS) issue(issues, `${path}.eligibleHands`, `At least ${MULLIGAN_LAB_MIN_ELIGIBLE_HANDS} eligible hands are required.`);
  if (uniquePlayers === null || uniquePlayers < MULLIGAN_LAB_MIN_UNIQUE_PLAYERS) issue(issues, `${path}.uniquePlayers`, `At least ${MULLIGAN_LAB_MIN_UNIQUE_PLAYERS} unique players are required.`);
  if (eligibleHands === null || uniquePlayers === null || eligibleHands < MULLIGAN_LAB_MIN_ELIGIBLE_HANDS || uniquePlayers < MULLIGAN_LAB_MIN_UNIQUE_PLAYERS) return null;
  if (uniquePlayers > eligibleHands) {
    issue(issues, `${path}.uniquePlayers`, "Unique players cannot exceed eligible hands.");
    return null;
  }
  return { scope: "deck-matchup-seat", eligibleHands, uniquePlayers };
}

function parseCardStats(
  raw: unknown,
  handCodes: string[],
  cohort: MulliganLabCohort | null,
  path: string,
  issues: MulliganLabValidationIssue[]
): Map<string, MulliganLabCardStats> | null {
  const issueCountBeforeStats = issues.length;
  if (!cohort || !Array.isArray(raw)) {
    if (!Array.isArray(raw)) issue(issues, path, "Card stats must be an array.");
    return null;
  }
  const expected = new Set(handCodes);
  const result = new Map<string, MulliganLabCardStats>();
  raw.forEach((rawStats, index) => {
    const value = record(rawStats);
    const itemPath = `${path}[${index}]`;
    if (!value) {
      issue(issues, itemPath, "Card stats must be an object.");
      return;
    }
    const code = canonicalCode(value.code);
    const counts = ["offeredCount", "keptCount", "redrawnCount", "keptWins", "redrawnWins"].map((key) => integer(value[key]));
    if (!code || !expected.has(code) || result.has(code)) issue(issues, `${itemPath}.code`, "Stats code must uniquely cover an opening-hand card.");
    if (counts.some((count) => count === null || count < 0)) issue(issues, itemPath, "Stat counts must be non-negative integers.");
    if (!code || counts.some((count) => count === null || count < 0)) return;
    const [offeredCount, keptCount, redrawnCount, keptWins, redrawnWins] = counts as number[];
    if (offeredCount !== keptCount + redrawnCount) issue(issues, itemPath, "Offered count must equal kept plus redrawn counts.");
    if (keptWins > keptCount || redrawnWins > redrawnCount) issue(issues, itemPath, "Wins cannot exceed their action count.");
    if (offeredCount > cohort.eligibleHands * 4) issue(issues, itemPath, "Offered count exceeds the cohort's possible card opportunities.");
    result.set(code, legacyCardStats(code, offeredCount, keptCount, redrawnCount, keptWins, redrawnWins, cohort.uniquePlayers));
  });
  for (const code of expected) if (!result.has(code)) issue(issues, path, `Missing community stats for ${code}.`);
  return [...expected].every((code) => result.has(code)) && issues.length === issueCountBeforeStats ? result : null;
}

function parseMulliganLabDrillContext(
  raw: unknown,
  hand: MulliganLabRegistryCard[],
  registry: MulliganLabRegistry,
  path: string,
  issues: MulliganLabValidationIssue[]
): MulliganLabApiDrill["context"] | null {
  const value = record(raw);
  const curve = record(value?.curve);
  const classification = curve?.classification === "two-drop-present" || curve?.classification === "two-drop-missing" || curve?.classification === "unknown"
    ? curve.classification
    : null;
  const twoDropCount = curve?.twoDropCount === null ? null : integer(curve?.twoDropCount);
  const earlyUnitCount = curve?.earlyUnitCount === null ? null : integer(curve?.earlyUnitCount);
  if (!value || !curve || !classification) issue(issues, `${path}.curve`, "A known curve context is required.");
  const metadataComplete = hand.every((card) => card.type.toLowerCase() !== "unit" || card.costEnergy !== null);
  const expectedTwoDrops = metadataComplete ? hand.filter((card) => card.type.toLowerCase() === "unit" && card.costEnergy === 2).length : null;
  const expectedEarlyUnits = metadataComplete ? hand.filter((card) => card.type.toLowerCase() === "unit" && card.costEnergy !== null && card.costEnergy <= 2).length : null;
  const expectedClassification = expectedTwoDrops === null ? "unknown" : expectedTwoDrops > 0 ? "two-drop-present" : "two-drop-missing";
  if (classification && classification !== expectedClassification) issue(issues, `${path}.curve.classification`, "Curve context must match the registry-confirmed opening hand.");
  if (twoDropCount !== expectedTwoDrops || earlyUnitCount !== expectedEarlyUnits) issue(issues, `${path}.curve`, "Curve counts must match the registry-confirmed opening hand.");
  const battlefields = record(value?.battlefields);
  const player = battlefields?.player === null ? null : apiRegistryCard(battlefields?.player, registry, "Battlefield", `${path}.battlefields.player`, issues);
  const opponent = battlefields?.opponent === null ? null : apiRegistryCard(battlefields?.opponent, registry, "Battlefield", `${path}.battlefields.opponent`, issues);
  if (!battlefields || (battlefields.player !== null && !player) || (battlefields.opponent !== null && !opponent)) {
    issue(issues, `${path}.battlefields`, "Battlefield context must use registry-confirmed cards or explicit nulls.");
  }
  const parsedDuplicateIdentityCount = value?.duplicateIdentityCount === undefined ? undefined : integer(value.duplicateIdentityCount);
  const duplicateIdentityCount = parsedDuplicateIdentityCount === null ? undefined : parsedDuplicateIdentityCount;
  const expectedDuplicates = (() => {
    const counts = new Map<string, number>();
    hand.forEach((card) => counts.set(riftboundBasePrintCode(card.code), (counts.get(riftboundBasePrintCode(card.code)) ?? 0) + 1));
    return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  })();
  if (value?.duplicateIdentityCount !== undefined && parsedDuplicateIdentityCount === null) {
    issue(issues, `${path}.duplicateIdentityCount`, "Duplicate count must be a non-negative integer.");
  } else if (duplicateIdentityCount !== undefined && duplicateIdentityCount !== expectedDuplicates) {
    issue(issues, `${path}.duplicateIdentityCount`, "Duplicate count must match the registry-confirmed hand identities.");
  }
  const setupValue = value?.setup === undefined ? undefined : record(value.setup);
  let setup: NonNullable<MulliganLabApiDrill["context"]>["setup"];
  if (value?.setup !== undefined) {
    const chosenChampion = setupValue?.chosenChampion === null
      ? null
      : apiRegistryCard(setupValue?.chosenChampion, registry, "Unit", `${path}.setup.chosenChampion`, issues);
    const replacementPoolCards = setupValue?.replacementPoolCards === null ? null : integer(setupValue?.replacementPoolCards);
    if (!setupValue || (setupValue.chosenChampion !== null && (!chosenChampion || chosenChampion.supertype?.toLocaleLowerCase("en") !== "champion"))) {
      issue(issues, `${path}.setup.chosenChampion`, "Setup must use a registry-confirmed Champion or explicit null.");
    }
    if (replacementPoolCards !== null && replacementPoolCards !== 35) {
      issue(issues, `${path}.setup.replacementPoolCards`, "A proven post-opening replacement pool must contain 35 cards.");
    }
    if (setupValue) setup = { chosenChampion, replacementPoolCards: replacementPoolCards === 35 ? 35 : null };
  }
  if (!classification || !battlefields || twoDropCount !== expectedTwoDrops || earlyUnitCount !== expectedEarlyUnits) return null;
  return {
    curve: { classification, twoDropCount, earlyUnitCount },
    battlefields: { player, opponent },
    ...(duplicateIdentityCount !== undefined ? { duplicateIdentityCount } : {}),
    ...(setup ? { setup } : {}),
  };
}

function parseMulliganLabDecisionEvidence(
  raw: unknown,
  minimumHands: number,
  minimumPlayers: number,
  path: string,
  issues: MulliganLabValidationIssue[],
): MulliganLabDecisionEvidence | null {
  const value = record(raw);
  const scope = value?.scope === "matching-curve" || value?.scope === "matchup" ? value.scope : null;
  const hands = integer(value?.hands);
  const players = integer(value?.players);
  const status = value?.evidenceStatus === "robust" || value?.evidenceStatus === "developing" ? value.evidenceStatus : null;
  const histogramRaw = array(value?.redrawCountHistogram);
  const histogram = histogramRaw.flatMap((entry) => {
    const bucket = record(entry);
    const redraws = integer(bucket?.redraws);
    const bucketHands = integer(bucket?.hands);
    return redraws !== null && redraws >= 0 && redraws <= 2 && bucketHands !== null && bucketHands >= 0
      ? [{ redraws: redraws as 0 | 1 | 2, hands: bucketHands }]
      : [];
  });
  const mode = value?.mostCommonRedrawCount === null ? null : integer(value?.mostCommonRedrawCount);
  const twoRedrawRate = unitRate(value?.twoRedrawRate);
  if (!value || !scope || hands === null || hands < 8 || players === null || players < 4 || players > hands || !status) {
    issue(issues, path, "Whole-hand evidence requires a privacy-gated 8-hand / 4-player cohort.");
    return null;
  }
  if (histogram.length !== 3 || histogram.map((entry) => entry.redraws).join(",") !== "0,1,2" || histogram.reduce((sum, entry) => sum + entry.hands, 0) !== hands) {
    issue(issues, `${path}.redrawCountHistogram`, "Redraw histogram must contain complete ordered 0/1/2 hand counts.");
  }
  const expectedRate = histogram.find((entry) => entry.redraws === 2)?.hands ?? -1;
  if (twoRedrawRate === null || Math.abs(twoRedrawRate - expectedRate / hands) > 1e-9) {
    issue(issues, `${path}.twoRedrawRate`, "Two-redraw rate must match the whole-hand histogram.");
  }
  const maximum = Math.max(...histogram.map((entry) => entry.hands));
  const modes = histogram.filter((entry) => entry.hands === maximum).map((entry) => entry.redraws);
  const expectedMode = modes.length === 1 ? modes[0]! : null;
  if (mode !== expectedMode) issue(issues, `${path}.mostCommonRedrawCount`, "Most-common redraw count must be unique or explicit null on a tie.");
  const expectedStatus = hands >= Math.max(25, minimumHands) && players >= Math.max(10, minimumPlayers) ? "robust" : "developing";
  if (status !== expectedStatus) issue(issues, `${path}.evidenceStatus`, "Whole-hand evidence status must match the configured thresholds.");
  return issues.some((entry) => entry.path === path || entry.path.startsWith(`${path}.`)) || twoRedrawRate === null
    ? null
    : { scope, hands, players, redrawCountHistogram: histogram, mostCommonRedrawCount: expectedMode, twoRedrawRate, evidenceStatus: status };
}

function parseApiCardEvidence(
  raw: unknown,
  hand: MulliganLabRegistryCard[],
  hands: number | null,
  cohortPlayers: number | null,
  minimumHands: number,
  minimumPlayers: number,
  registry: MulliganLabRegistry,
  evidenceStatus: "sufficient" | "early" | null,
  apiVersion: number | null,
  path: string,
  issues: MulliganLabValidationIssue[]
): Map<string, MulliganLabCardStats> | null {
  if (hands === null || cohortPlayers === null || !evidenceStatus) {
    issue(issues, path, "Card evidence must be backed by a valid sample.");
    return null;
  }
  if (!Array.isArray(raw)) {
    issue(issues, path, "Every drill must publish raw card evidence counts.");
    return null;
  }
  const expected = new Set(hand.map((card) => card.code));
  const result = new Map<string, MulliganLabCardStats>();
  raw.forEach((rawItem, index) => {
    const value = record(rawItem);
    const itemPath = `${path}[${index}]`;
    const card = apiRegistryCard(value, registry, undefined, itemPath, issues);
    const offered = integer(value?.offered);
    const kept = integer(value?.kept);
    const redrawn = integer(value?.redrawn);
    const keptWins = integer(value?.keptWins);
    const redrawnWins = integer(value?.redrawnWins);
    if (!card || !expected.has(card.code) || result.has(card.code)) issue(issues, `${itemPath}.cardCode`, "Evidence must uniquely cover an opening-hand card.");
    if ([offered, kept, redrawn, keptWins, redrawnWins].some((count) => count === null || count < 0)) issue(issues, itemPath, "Evidence counts must be non-negative integers.");
    if (!card || offered === null || kept === null || redrawn === null || keptWins === null || redrawnWins === null) return;
    if (offered !== kept + redrawn) issue(issues, itemPath, "Offered must equal kept plus redrawn.");
    if (keptWins > kept || redrawnWins > redrawn) issue(issues, itemPath, "Wins cannot exceed action counts.");
    if (apiVersion !== MULLIGAN_LAB_API_SCHEMA_VERSION && offered > hands * 4) issue(issues, itemPath, "Offered exceeds possible card opportunities.");
    if (apiVersion === MULLIGAN_LAB_API_SCHEMA_VERSION) {
      const playerCount = integer(value?.players);
      const keptPlayerCount = integer(value?.keptPlayers);
      const redrawnPlayerCount = integer(value?.redrawnPlayers);
      const cardScope = value?.scope === "matchup" || value?.scope === "player-legend" ? value.scope : null;
      const identityCode = canonicalCode(value?.identityCode);
      const scopeHands = integer(value?.scopeHands);
      const scopePlayers = integer(value?.scopePlayers);
      const keepRate = unitRate(value?.keepRate);
      const baselineKeepRate = unitRate(value?.baselineKeepRate);
      const guidancePlayers = integer(value?.guidancePlayers);
      const guidanceKept = integer(value?.guidanceKept);
      const guidanceKeepRate = unitRate(value?.guidanceKeepRate);
      const keptWinRate = nullableUnitRate(value?.keptWinRate);
      const redrawnWinRate = nullableUnitRate(value?.redrawnWinRate);
      const winRateDelta = nullableDelta(value?.winRateDelta);
      const guidance = mulliganGuidance(value?.guidance);
      const cardEvidenceStatus = mulliganCardEvidenceStatus(value?.evidenceStatus);
      const outcomeStatus = mulliganCardOutcomeStatus(value?.outcomeStatus);
      const slices = value?.slices === undefined
        ? undefined
        : parseMulliganLabEvidenceSlices(value.slices, minimumHands, minimumPlayers, `${itemPath}.slices`, issues);
      if (playerCount === null || playerCount < 1 || playerCount > offered) issue(issues, `${itemPath}.players`, "Card contributors must fit within its observed offers.");
      if (!cardScope) issue(issues, `${itemPath}.scope`, "Card evidence scope must be matchup or player-legend.");
      if (identityCode !== riftboundBasePrintCode(card.code)) issue(issues, `${itemPath}.identityCode`, "Evidence identity must match the displayed official card print.");
      if (scopeHands === null || scopeHands < 1 || offered > scopeHands) issue(issues, `${itemPath}.scopeHands`, "A gameplay card identity can be offered at most once per hand in its disclosed evidence scope.");
      if (scopePlayers === null || scopePlayers < 1 || playerCount === null || playerCount > scopePlayers || (scopeHands !== null && scopePlayers > scopeHands)) issue(issues, `${itemPath}.scopePlayers`, "Card contributors must fit within its disclosed evidence scope.");
      if (cardScope === "matchup" && (scopeHands === null || scopeHands > hands || scopePlayers === null || scopePlayers > cohortPlayers)) issue(issues, `${itemPath}.scope`, "Capped matchup evidence cannot exceed the drill's raw matchup cohort.");
      if (keptPlayerCount === null || keptPlayerCount < 0 || keptPlayerCount > kept || (playerCount !== null && keptPlayerCount > playerCount)) issue(issues, `${itemPath}.keptPlayers`, "Keep contributors must fit within keep actions and card contributors.");
      if (redrawnPlayerCount === null || redrawnPlayerCount < 0 || redrawnPlayerCount > redrawn || (playerCount !== null && redrawnPlayerCount > playerCount)) issue(issues, `${itemPath}.redrawnPlayers`, "Redraw contributors must fit within redraw actions and card contributors.");
      if (keepRate === null || !rateMatches(keepRate, kept, offered)) issue(issues, `${itemPath}.keepRate`, "Keep rate must match the published raw counts.");
      if (baselineKeepRate === null) issue(issues, `${itemPath}.baselineKeepRate`, "Evidence must include its selected-scope baseline keep rate.");
      if (guidancePlayers === null || guidancePlayers < 1 || playerCount === null || guidancePlayers > playerCount) issue(issues, `${itemPath}.guidancePlayers`, "Contributor-balanced guidance must use one vote from a subset of card contributors.");
      if (guidanceKept === null || guidanceKept < 0 || guidancePlayers === null || guidanceKept > guidancePlayers) issue(issues, `${itemPath}.guidanceKept`, "Guidance keeps must fit within contributor-balanced votes.");
      if (guidanceKeepRate === null || guidancePlayers === null || guidanceKept === null || !rateMatches(guidanceKeepRate, guidanceKept, guidancePlayers)) issue(issues, `${itemPath}.guidanceKeepRate`, "Contributor-balanced guidance rate must match its raw player votes.");
      if (value?.keptWinRate !== null && unitRate(value?.keptWinRate) === null) issue(issues, `${itemPath}.keptWinRate`, "Kept win rate must be a rate or explicit null.");
      if (value?.redrawnWinRate !== null && unitRate(value?.redrawnWinRate) === null) issue(issues, `${itemPath}.redrawnWinRate`, "Redrawn win rate must be a rate or explicit null.");
      if (value?.winRateDelta !== null && nullableDelta(value?.winRateDelta) === null) issue(issues, `${itemPath}.winRateDelta`, "Win-rate delta must be a number or explicit null.");
      if (!nullableRateMatches(keptWinRate, keptWins, kept)) issue(issues, `${itemPath}.keptWinRate`, "Kept win rate must match the published raw counts.");
      if (!nullableRateMatches(redrawnWinRate, redrawnWins, redrawn)) issue(issues, `${itemPath}.redrawnWinRate`, "Redrawn win rate must match the published raw counts.");
      const expectedDelta = keptWinRate === null || redrawnWinRate === null ? null : keptWinRate - redrawnWinRate;
      if (!nullableNumberMatches(winRateDelta, expectedDelta)) issue(issues, `${itemPath}.winRateDelta`, "Win-rate delta must match the two outcome rates.");
      if (!guidance) issue(issues, `${itemPath}.guidance`, "Unknown community guidance label.");
      if (!cardEvidenceStatus) issue(issues, `${itemPath}.evidenceStatus`, "Unknown card evidence status.");
      if (!outcomeStatus) issue(issues, `${itemPath}.outcomeStatus`, "Unknown outcome comparison status.");
      const robustMinimumOffers = Math.max(MULLIGAN_LAB_MIN_ELIGIBLE_HANDS, minimumHands);
      const robustMinimumGuidancePlayers = Math.max(MULLIGAN_LAB_MIN_UNIQUE_PLAYERS, minimumPlayers);
      const expectedCardStatus: MulliganLabCardEvidenceStatus | null = guidancePlayers === null
        ? null
        : offered < 8 || guidancePlayers < 4
          ? "limited"
          : offered < robustMinimumOffers || guidancePlayers < robustMinimumGuidancePlayers
            ? "developing"
            : "robust";
      if (cardEvidenceStatus && expectedCardStatus && cardEvidenceStatus !== expectedCardStatus) issue(issues, `${itemPath}.evidenceStatus`, "Card evidence status must match contributor-balanced guidance thresholds.");
      if (cardEvidenceStatus !== "robust" && guidance && guidance !== "unclear" && guidance !== "mixed") {
        issue(issues, `${itemPath}.guidance`, "Developing or limited evidence cannot publish a graded direction.");
      }
      if (guidance && guidanceKeepRate !== null && baselineKeepRate !== null && guidanceKept !== null && guidancePlayers !== null && !guidanceMatchesRates(guidance, cardEvidenceStatus, guidanceKept, guidancePlayers, guidanceKeepRate, baselineKeepRate)) {
        issue(issues, `${itemPath}.guidance`, "Guidance does not match the published confidence-gated community tendency.");
      }
      const expectedOutcomeStatus: MulliganLabCardOutcomeStatus | null = !cardEvidenceStatus || keptPlayerCount === null || redrawnPlayerCount === null
        ? null
        : cardEvidenceStatus === "limited"
          ? "sparse"
          : kept >= MULLIGAN_LAB_MIN_ELIGIBLE_HANDS && redrawn >= MULLIGAN_LAB_MIN_ELIGIBLE_HANDS && keptPlayerCount >= MULLIGAN_LAB_MIN_UNIQUE_PLAYERS && redrawnPlayerCount >= MULLIGAN_LAB_MIN_UNIQUE_PLAYERS
            ? "comparable"
            : "one_sided";
      if (outcomeStatus && expectedOutcomeStatus && outcomeStatus !== expectedOutcomeStatus) {
        issue(issues, `${itemPath}.outcomeStatus`, "Outcome status must match the published descriptive sample gates.");
      }
      if (cardScope && scopeHands !== null && scopeHands >= 1 && scopePlayers !== null && scopePlayers >= 1 && playerCount !== null && playerCount >= 1 && keptPlayerCount !== null && keptPlayerCount >= 0 && redrawnPlayerCount !== null && redrawnPlayerCount >= 0 && keepRate !== null && baselineKeepRate !== null && guidancePlayers !== null && guidancePlayers >= 1 && guidanceKept !== null && guidanceKept >= 0 && guidanceKeepRate !== null && guidance && cardEvidenceStatus && outcomeStatus) {
        result.set(card.code, {
          code: card.code,
          identityCode,
          scope: cardScope,
          scopeHands,
          scopePlayers,
          offeredCount: offered,
          playerCount,
          keptPlayerCount,
          redrawnPlayerCount,
          keptCount: kept,
          redrawnCount: redrawn,
          keptWins,
          redrawnWins,
          keepRate,
          baselineKeepRate,
          guidancePlayers,
          guidanceKept,
          guidanceKeepRate,
          keptWinRate,
          redrawnWinRate,
          winRateDelta,
          guidance,
          evidenceStatus: cardEvidenceStatus,
          outcomeStatus,
          ...(slices ? { slices } : {})
        });
      }
    } else {
      // Version 1 remains readable while cached packs expire, but its evidence
      // lacks card-level contributor/reliability fields and is never graded.
      result.set(card.code, legacyCardStats(card.code, offered, kept, redrawn, keptWins, redrawnWins, Math.min(cohortPlayers, offered)));
    }
  });
  for (const code of expected) if (!result.has(code)) issue(issues, path, `Missing evidence for ${code}.`);
  return [...expected].every((code) => result.has(code)) ? result : null;
}

function parseMulliganLabEvidenceSlices(
  raw: unknown,
  minimumHands: number,
  minimumPlayers: number,
  path: string,
  issues: MulliganLabValidationIssue[]
): MulliganLabEvidenceSlices | null {
  const value = record(raw);
  if (!value) {
    issue(issues, path, "Context evidence slices must be an object.");
    return null;
  }
  const knownKeys = ["matchingCurve", "matchingInitiative", "preseason", "currentSeason"] as const;
  if (Object.keys(value).some((key) => !knownKeys.includes(key as typeof knownKeys[number]))) {
    issue(issues, path, "Context evidence contains an unknown slice.");
  }
  const parsed = {} as MulliganLabEvidenceSlices;
  for (const key of knownKeys) {
    const rawSlice = value[key];
    if (rawSlice === null) {
      parsed[key] = null;
      continue;
    }
    const slice = record(rawSlice);
    const slicePath = `${path}.${key}`;
    const offered = integer(slice?.offered);
    const players = integer(slice?.players);
    const kept = integer(slice?.kept);
    const redrawn = integer(slice?.redrawn);
    const guidancePlayers = integer(slice?.guidancePlayers);
    const guidanceKept = integer(slice?.guidanceKept);
    const guidanceKeepRate = unitRate(slice?.guidanceKeepRate);
    const guidance = mulliganGuidance(slice?.guidance);
    const evidenceStatus = mulliganCardEvidenceStatus(slice?.evidenceStatus);
    if (!slice || offered === null || offered < 1 || players === null || players < 1 || players > offered || kept === null || kept < 0 || redrawn === null || redrawn < 0 || kept + redrawn !== offered) {
      issue(issues, slicePath, "Context evidence counts must describe a non-empty valid card cohort.");
    }
    if (guidancePlayers === null || guidancePlayers < 1 || players === null || guidancePlayers > players || guidanceKept === null || guidanceKept < 0 || guidancePlayers === null || guidanceKept > guidancePlayers || guidanceKeepRate === null || guidancePlayers === null || guidanceKept === null || !rateMatches(guidanceKeepRate, guidanceKept, guidancePlayers)) {
      issue(issues, slicePath, "Context guidance must match contributor-balanced player votes.");
    }
    if (!guidance || !evidenceStatus) issue(issues, slicePath, "Context evidence must use known guidance and reliability labels.");
    const expectedStatus = offered === null || guidancePlayers === null
      ? null
      : offered < 8 || guidancePlayers < 4
        ? "limited"
        : offered < Math.max(MULLIGAN_LAB_MIN_ELIGIBLE_HANDS, minimumHands) || guidancePlayers < Math.max(MULLIGAN_LAB_MIN_UNIQUE_PLAYERS, minimumPlayers)
          ? "developing"
          : "robust";
    if (evidenceStatus && expectedStatus && evidenceStatus !== expectedStatus) issue(issues, `${slicePath}.evidenceStatus`, "Context evidence status must match its published sample gates.");
    if (evidenceStatus !== "robust" && guidance && guidance !== "unclear" && guidance !== "mixed") issue(issues, `${slicePath}.guidance`, "Thin context evidence cannot publish a graded direction.");
    if (offered !== null && offered > 0 && players !== null && players > 0 && kept !== null && kept >= 0 && redrawn !== null && redrawn >= 0 && guidancePlayers !== null && guidancePlayers > 0 && guidanceKept !== null && guidanceKept >= 0 && guidanceKeepRate !== null && guidance && evidenceStatus) {
      parsed[key] = { offered, players, kept, redrawn, guidancePlayers, guidanceKept, guidanceKeepRate, guidance, evidenceStatus };
    } else {
      parsed[key] = null;
    }
  }
  return parsed;
}

function legacyCardStats(
  code: string,
  offeredCount: number,
  keptCount: number,
  redrawnCount: number,
  keptWins: number,
  redrawnWins: number,
  playerCount: number
): MulliganLabCardStats {
  const keepRate = offeredCount ? keptCount / offeredCount : 0;
  const keptWinRate = keptCount ? keptWins / keptCount : null;
  const redrawnWinRate = redrawnCount ? redrawnWins / redrawnCount : null;
  return {
    code,
    identityCode: riftboundBasePrintCode(code),
    scope: "matchup",
    scopeHands: offeredCount,
    scopePlayers: playerCount,
    offeredCount,
    playerCount,
    keptPlayerCount: 0,
    redrawnPlayerCount: 0,
    keptCount,
    redrawnCount,
    keptWins,
    redrawnWins,
    keepRate,
    baselineKeepRate: 0.5,
    guidancePlayers: 0,
    guidanceKept: 0,
    guidanceKeepRate: 0,
    keptWinRate,
    redrawnWinRate,
    winRateDelta: keptWinRate === null || redrawnWinRate === null ? null : keptWinRate - redrawnWinRate,
    guidance: "unclear",
    evidenceStatus: "limited",
    outcomeStatus: keptCount && redrawnCount ? "sparse" : "one_sided"
  };
}

function unitRate(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : null;
}

function nullableUnitRate(raw: unknown): number | null {
  return raw === null ? null : unitRate(raw);
}

function nullableDelta(raw: unknown): number | null {
  return raw === null ? null : typeof raw === "number" && Number.isFinite(raw) && raw >= -1 && raw <= 1 ? raw : null;
}

function rateMatches(rate: number, wins: number, sample: number): boolean {
  return sample > 0 && Math.abs(rate - wins / sample) < 0.000_001;
}

function nullableRateMatches(rate: number | null, wins: number, sample: number): boolean {
  return sample === 0 ? rate === null : rate !== null && rateMatches(rate, wins, sample);
}

function nullableNumberMatches(left: number | null, right: number | null): boolean {
  return left === null || right === null ? left === right : Math.abs(left - right) < 0.000_001;
}

function mulliganGuidance(raw: unknown): MulliganLabCardGuidance | null {
  return ["strong_keep", "keep", "mixed", "redraw", "strong_redraw", "unclear"].includes(String(raw))
    ? raw as MulliganLabCardGuidance
    : null;
}

function mulliganCardEvidenceStatus(raw: unknown): MulliganLabCardEvidenceStatus | null {
  return ["robust", "developing", "limited"].includes(String(raw)) ? raw as MulliganLabCardEvidenceStatus : null;
}

function mulliganCardOutcomeStatus(raw: unknown): MulliganLabCardOutcomeStatus | null {
  return ["comparable", "one_sided", "sparse"].includes(String(raw)) ? raw as MulliganLabCardOutcomeStatus : null;
}

function guidanceMatchesRates(
  guidance: MulliganLabCardGuidance,
  status: MulliganLabCardEvidenceStatus | null,
  kept: number,
  offered: number,
  keepRate: number,
  baselineKeepRate: number
): boolean {
  if (status !== "robust") return guidance === "unclear";
  const { lower, upper } = wilsonInterval(kept, offered);
  const expectedGuidance: MulliganLabCardGuidance = keepRate >= .85 && lower > .5
    ? "strong_keep"
    : keepRate >= .65 && lower > .5 && keepRate > baselineKeepRate
      ? "keep"
      : keepRate <= .15 && upper < .5
        ? "strong_redraw"
        : keepRate <= .35 && upper < .5 && keepRate < baselineKeepRate
          ? "redraw"
          : "mixed";
  return guidance === expectedGuidance;
}

function wilsonInterval(successes: number, trials: number): { lower: number; upper: number } {
  const z = 1.959963984540054;
  const proportion = successes / trials;
  const zSquared = z * z;
  const denominator = 1 + zSquared / trials;
  const center = (proportion + zSquared / (2 * trials)) / denominator;
  const margin = z * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * trials)) / trials) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function parseApiCardList(raw: unknown, registry: MulliganLabRegistry, path: string, issues: MulliganLabValidationIssue[]): MulliganLabRegistryCard[] {
  if (!Array.isArray(raw)) {
    issue(issues, path, "Cards must be an array.");
    return [];
  }
  return raw.map((value, index) => apiRegistryCard(value, registry, undefined, `${path}[${index}]`, issues)).filter((card): card is MulliganLabRegistryCard => Boolean(card));
}

function parseApiDeck(raw: unknown, registry: MulliganLabRegistry, path: string, issues: MulliganLabValidationIssue[]): MulliganLabApiDeckCard[] {
  if (!Array.isArray(raw)) {
    issue(issues, path, "Main deck must be an array.");
    return [];
  }
  const seen = new Set<string>();
  const cards: MulliganLabApiDeckCard[] = [];
  raw.forEach((rawEntry, index) => {
    const value = record(rawEntry);
    const entryPath = `${path}[${index}]`;
    const card = apiRegistryCard(value, registry, undefined, entryPath, issues);
    const count = integer(value?.count);
    if (!count || count < 1) issue(issues, `${entryPath}.count`, "Deck count must be a positive integer.");
    if (card && seen.has(card.code)) issue(issues, `${entryPath}.cardCode`, "Deck card codes must be unique.");
    if (card && ["legend", "battlefield", "rune"].includes(card.type.toLowerCase())) issue(issues, `${entryPath}.cardCode`, `${card.code} cannot be a main-deck card.`);
    if (count !== null && count > 3) issue(issues, `${entryPath}.count`, "Main-deck cards cannot exceed three copies.");
    if (card && count && count > 0) {
      seen.add(card.code);
      cards.push({ ...card, count });
    }
  });
  if (cards.length < 14) issue(issues, path, "A 40-card deck must contain at least 14 distinct card codes.");
  return cards;
}

function apiRegistryCard(
  raw: unknown,
  registry: MulliganLabRegistry,
  requiredType: string | undefined,
  path: string,
  issues: MulliganLabValidationIssue[]
): MulliganLabRegistryCard | null {
  const value = record(raw);
  if (!value) {
    issue(issues, path, "Card reference must be an object.");
    return null;
  }
  const code = registryCode(value.cardCode, registry, requiredType, `${path}.cardCode`, issues);
  if (!code) return null;
  const official = registry.byCode.get(code)!;
  if (value.name !== official.name) {
    issue(issues, `${path}.name`, `Name must exactly match packaged registry text for ${code}.`);
    return null;
  }
  return official;
}

function integerArray(raw: unknown, path: string, issues: MulliganLabValidationIssue[]): number[] {
  if (!Array.isArray(raw)) {
    issue(issues, path, "Value must be an integer array.");
    return [];
  }
  const result = raw.map(integer);
  if (result.some((value) => value === null)) {
    issue(issues, path, "Value must contain only integers.");
    return [];
  }
  return result as number[];
}

function multisetFits(handCodes: string[], deck: MulliganLabApiDeckCard[]): boolean {
  const hand = multiset(handCodes);
  const deckCounts = new Map(deck.map((card) => [card.code, card.count]));
  return [...hand].every(([code, count]) => (deckCounts.get(code) ?? 0) >= count);
}

function rawDeckQuantity(entries: unknown[]): number {
  let total = 0;
  for (const rawEntry of entries) {
    const entry = record(rawEntry);
    const count = integer(entry?.qty ?? entry?.quantity ?? entry?.count);
    if (!count || count < 1 || count > 3) return -1;
    total += count;
  }
  return total;
}

export function sha256Ascii(value: string): string {
  if (/[^\x00-\x7f]/.test(value)) throw new Error("Mulligan deck fingerprints accept canonical ASCII only.");
  const initial = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  const round = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const bytesLength = value.length;
  const paddedLength = Math.ceil((bytesLength + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  for (let index = 0; index < bytesLength; index += 1) bytes[index] = value.charCodeAt(index);
  bytes[bytesLength] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = bytesLength * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const hash = initial.slice();
  const words = new Uint32Array(64);
  const rotate = (word: number, amount: number): number => (word >>> amount) | (word << (32 - amount));
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotate(words[index - 15], 7) ^ rotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotate(words[index - 2], 17) ^ rotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + round[index] + words[index]) >>> 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function invalidApiResult(message: string): MulliganLabApiParseResult {
  return invalidApiParseResult(message, [{ path: "$", message }], 0);
}

function invalidApiParseResult(
  message: string,
  issues: MulliganLabValidationIssue[],
  rejected: number
): MulliganLabApiParseResult {
  return {
    status: "invalid",
    generatedAt: null,
    expiresAt: null,
    drills: [],
    reason: message,
    issues,
    accepted: 0,
    rejected,
    observedFrom: null,
    observedThrough: null,
    includedFacts: 0,
    coverageTruncated: false,
    coveragePolicy: null,
    includedPeriods: [],
    seasonCoverage: null,
    backfillComplete: null
  };
}

function exactEventCodes(cards: ReplayStructuredCard[]): string[] {
  return cards.map((card) => typeof card.code === "string" ? card.code : "");
}

function codeArray(raw: unknown, path: string, registry: MulliganLabRegistry, issues: MulliganLabValidationIssue[]): string[] {
  if (!Array.isArray(raw)) {
    issue(issues, path, "Card codes must be an array.");
    return [];
  }
  return raw.map((value, index) => registryCode(value, registry, undefined, `${path}[${index}]`, issues)).filter(Boolean);
}

function registryCode(
  raw: unknown,
  registry: MulliganLabRegistry,
  requiredType: string | undefined,
  path: string,
  issues: MulliganLabValidationIssue[]
): string {
  const code = canonicalCode(raw);
  if (!code) {
    issue(issues, path, "A canonical registry print code is required.");
    return "";
  }
  const card = registry.byCode.get(code);
  if (!card) {
    issue(issues, path, `${code} does not resolve in the packaged card registry.`);
    return "";
  }
  if (requiredType && card.type.toLowerCase() !== requiredType.toLowerCase()) {
    issue(issues, path, `${code} is not a ${requiredType}.`);
    return "";
  }
  return code;
}

function canonicalCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value || value !== value.toUpperCase()) return "";
  return riftboundCardCodeFromValue(value) === value ? value : "";
}

function sha256Hex(raw: unknown): string {
  return typeof raw === "string" && /^[a-f0-9]{64}$/.test(raw) ? raw : "";
}

function savedSnapshotCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return canonicalCode(raw.trim().toUpperCase().replace(/-STAR$/, "*"));
}

function trustedRegistryImageUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && (url.hostname === "cmsassets.rgpub.io" || url.hostname === "cdn.piltoverarchive.com") ? url.toString() : "";
  } catch {
    return "";
  }
}

function multiset(values: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function sameMultiset(left: string[], right: string[]): boolean {
  const a = multiset(left);
  const b = multiset(right);
  return a.size === b.size && [...a].every(([key, count]) => b.get(key) === count);
}

function takeOccurrence(counts: Map<string, number>, code: string): boolean {
  const available = counts.get(code) ?? 0;
  if (available <= 0) return false;
  counts.set(code, available - 1);
  return true;
}

function record(raw: unknown): JsonRecord | null {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as JsonRecord : null;
}

function array(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function nonEmptyString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function registryCost(raw: unknown): number | null {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

function requiredString(raw: unknown, path: string, issues: MulliganLabValidationIssue[]): string {
  const value = nonEmptyString(raw);
  if (!value) issue(issues, path, "A non-empty string is required.");
  return value;
}

function integer(raw: unknown): number | null {
  return typeof raw === "number" && Number.isSafeInteger(raw) ? raw : null;
}

function isoDate(raw: unknown, path: string, issues: MulliganLabValidationIssue[]): string {
  const value = nonEmptyString(raw);
  if (!value || !Number.isFinite(Date.parse(value))) issue(issues, path, "A valid ISO date is required.");
  return value;
}

function isoDay(raw: unknown, path: string, issues: MulliganLabValidationIssue[]): string {
  const value = nonEmptyString(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    issue(issues, path, "A valid YYYY-MM-DD observation day is required.");
  }
  return value;
}

function issue(issues: MulliganLabValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function invalid(path: string, message: string): MulliganLabObservationValidationResult {
  return { ok: false, observation: null, issues: [{ path, message }] };
}
