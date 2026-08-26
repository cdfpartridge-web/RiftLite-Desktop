import type {
  ReplayInsight,
  ReplayInsightCategory,
  ReplayInsightEvidence,
  ReplayInsightPatternStrength,
  ReplayInsightsReport
} from "./replayInsights.js";
import type { ReplayIntelligenceConfidence } from "./types.js";

/**
 * A renderer-independent coaching projection of Replay Insights.
 *
 * This module deliberately does not create new gameplay claims. The finding,
 * rule, confidence, scope and evidence remain traceable to one ReplayInsight;
 * the extra fields only organise that evidence for a visual coaching surface.
 */

export type ReplayCoachQuestKind = "challenge" | "review-question";
export type ReplayCoachQuestMetricKind = "behaviour-rate" | "capture-coverage";

export interface ReplayCoachQuestMetric {
  kind: ReplayCoachQuestMetricKind;
  interpretation: "lower-is-better" | "higher-is-better" | "neutral";
  label: string;
  numerator: number;
  denominator: number;
  percentage: number;
  numeratorLabel: string;
  denominatorLabel: string;
  display: string;
  /** Identifies the structured field used so the UI never has to re-interpret copy. */
  source: "card-report" | "insight-claim" | "data-receipt";
}

export interface ReplayCoachQuestComparator {
  /** This is the exact remainder of the same denominator, not a population benchmark. */
  kind: "complement";
  label: string;
  numerator: number;
  denominator: number;
  percentage: number;
  deltaPercentagePoints: number;
}

export interface ReplayCoachQuestScope {
  insightScope: ReplayInsight["scope"];
  observations: number;
  games: number;
  completedGames: number;
  completePlayCaptureGames: number;
  playCaptureStatus: ReplayInsight["dataReceipt"]["playCaptureStatus"];
  linkedReplays: number;
  periods: ReplayInsight["dataReceipt"]["periods"];
  deckFingerprints: string[];
  observedFrom?: string;
  observedThrough?: string;
  gameNumber?: number;
  playerLegend?: string;
  opponentLegend?: string;
}

export interface ReplayCoachQuestArt {
  category: ReplayInsightCategory;
  card?: {
    id?: string;
    name: string;
    imageUrl?: string;
  };
  playerLegend?: {
    id: string;
    name: string;
  };
  opponentLegend?: {
    id: string;
    name: string;
  };
  /** A stable fallback key when no card or Legend artwork can be resolved. */
  fallbackId: `category:${ReplayInsightCategory}`;
}

export interface ReplayCoachQuestConfidence {
  capture: ReplayIntelligenceConfidence;
  pattern: ReplayInsightPatternStrength;
  reportCoverage: ReplayInsightsReport["coverage"]["grade"];
  claimBasis: ReplayInsight["claimBasis"];
}

export interface ReplayCoachQuestShareCopy {
  eyebrow: string;
  headline: string;
  rule: string;
  stat: string;
  caveat: string;
  plainText: string;
}

export interface ReplayCoachQuest {
  id: string;
  insightId: string;
  kind: ReplayCoachQuestKind;
  category: ReplayInsightCategory;
  tone: Exclude<ReplayInsight["tone"], "positive">;
  /** Source finding, preserved verbatim rather than upgraded into a causal claim. */
  finding: {
    title: string;
    body: string;
  };
  /** Short WHEN label used by the visual rule card. */
  trigger: string;
  /** The exact action supplied by Replay Insights. */
  nextGameRule: string;
  /** Present whenever the item must be reviewed rather than treated as a challenge. */
  reviewQuestion?: string;
  primaryMetric: ReplayCoachQuestMetric;
  comparator?: ReplayCoachQuestComparator;
  evidence: ReplayInsightEvidence[];
  scope: ReplayCoachQuestScope;
  art: ReplayCoachQuestArt;
  confidence: ReplayCoachQuestConfidence;
  share: ReplayCoachQuestShareCopy;
  /** Exposed for deterministic UI ordering/debugging, not as a gameplay statistic. */
  rankScore: number;
}

export interface ReplayCoachQuestBoard {
  version: 1;
  generatedAt: string;
  primary: ReplayCoachQuest | null;
  secondary: ReplayCoachQuest[];
  /** Non-positive, evidence-backed candidates before de-duplication. */
  candidateCount: number;
}

interface QuestMetricResult {
  metric: ReplayCoachQuestMetric;
  comparator?: ReplayCoachQuestComparator;
}

interface QuestCardReport {
  cardName: string;
  cardId?: string;
  imageUrl?: string;
  appearances: number;
  kept: number;
  unplayed: number;
  completePlayCaptureAppearances: number;
  recycledOrDiscarded: number;
  lateKeeps: number;
  immediatePlays: number;
  played: number;
}

/**
 * Selects one dominant coaching item and at most two distinct supporting items.
 * Challenges are reserved for repeated, pattern-scoped opportunities; every
 * single-match signal remains an explicitly worded review question.
 */
export function buildReplayCoachQuestBoard(report: ReplayInsightsReport): ReplayCoachQuestBoard {
  const candidates = report.insights
    .filter((insight): insight is ReplayInsight & { tone: "opportunity" | "watch" } => insight.tone !== "positive")
    .map((insight) => buildQuest(insight, report))
    .sort(compareQuests);
  const distinct = distinctQuests(candidates).slice(0, 3);

  return {
    version: 1,
    generatedAt: report.generatedAt,
    primary: distinct[0] ?? null,
    secondary: distinct.slice(1, 3),
    candidateCount: candidates.length
  };
}

function buildQuest(insight: ReplayInsight & { tone: "opportunity" | "watch" }, report: ReplayInsightsReport): ReplayCoachQuest {
  const kind = questKind(insight);
  const card = findCardReport(insight, report);
  const metricResult = questMetric(insight, card);
  const trigger = questTrigger(insight);
  const reviewQuestion = kind === "review-question" ? asReviewQuestion(insight.action, insight.scope) : undefined;
  const art = questArt(insight, card);
  const confidence: ReplayCoachQuestConfidence = {
    capture: insight.captureConfidence,
    pattern: insight.patternStrength,
    reportCoverage: report.coverage.grade,
    claimBasis: insight.claimBasis
  };
  const scope: ReplayCoachQuestScope = {
    insightScope: insight.scope,
    observations: insight.dataReceipt.observationCount,
    games: insight.dataReceipt.scopeGames,
    completedGames: insight.dataReceipt.completedScopeGames,
    completePlayCaptureGames: insight.dataReceipt.completePlayCaptureScopeGames,
    playCaptureStatus: insight.dataReceipt.playCaptureStatus,
    linkedReplays: insight.dataReceipt.linkedReplays,
    periods: [...insight.dataReceipt.periods],
    deckFingerprints: [...insight.dataReceipt.deckFingerprints],
    observedFrom: insight.dataReceipt.observedFrom,
    observedThrough: insight.dataReceipt.observedThrough,
    gameNumber: insight.gameNumber,
    playerLegend: insight.playerLegend,
    opponentLegend: insight.opponentLegend
  };
  const rankScore = questRankScore(insight, metricResult.metric, kind);
  const share = questShareCopy({
    kind,
    headline: insight.title,
    nextGameRule: insight.action,
    reviewQuestion,
    metric: metricResult.metric,
    observations: scope.observations
  });

  return {
    id: `coach:${insight.id}`,
    insightId: insight.id,
    kind,
    category: insight.category,
    tone: insight.tone,
    finding: { title: insight.title, body: insight.body },
    trigger,
    nextGameRule: insight.action,
    reviewQuestion,
    primaryMetric: metricResult.metric,
    comparator: metricResult.comparator,
    evidence: insight.evidence.map((evidence) => ({ ...evidence })),
    scope,
    art,
    confidence,
    share,
    rankScore
  };
}

function questKind(insight: ReplayInsight): ReplayCoachQuestKind {
  return insight.scope === "pattern"
    && insight.tone === "opportunity"
    && insight.sampleSize > 1
    && insight.patternStrength !== "single-observation"
    && isMeasurableNextGameAction(insight.action)
    ? "challenge"
    : "review-question";
}

/** A recurring observation is not automatically a playable challenge. */
function isMeasurableNextGameAction(action: string): boolean {
  return /^(?:test|play|keep|mulligan|redraw|prioriti[sz]e|sequence|spend|develop|choose|contest|hold)\b/i.test(action.trim());
}

function questTrigger(insight: ReplayInsight): string {
  const cardName = insight.cardName?.trim();
  const opponentLegend = insight.opponentLegend?.trim();
  if (insight.category === "matchup" && opponentLegend) return `When facing ${opponentLegend}`;
  if (insight.category === "opening-hand" && cardName) return `When ${cardName} is in your opening hand`;
  if (insight.category === "card-efficiency" && cardName) return `When ${cardName} becomes available`;
  if (insight.category === "opening-hand") return "When choosing an opening hand";
  if (insight.category === "curve") return "During the opening turns";
  if (insight.category === "battlefield") return "When planning the battlefield sequence";
  if (insight.category === "matchup") return "In this matchup";
  return "When this decision appears again";
}

function asReviewQuestion(action: string, scope: ReplayInsight["scope"]): string {
  const stem = action.trim().replace(/[.!?]+$/, "");
  const prefix = scope === "pattern" ? "Across these replays" : "For this replay";
  return stem ? `${prefix}: ${lowercaseFirst(stem)}?` : "What made this decision right for this game?";
}

function lowercaseFirst(value: string): string {
  return value ? `${value[0]!.toLocaleLowerCase()}${value.slice(1)}` : value;
}

function questMetric(insight: ReplayInsight, card: QuestCardReport | undefined): QuestMetricResult {
  const cardMetric = card ? cardQuestMetric(insight, card) : undefined;
  if (cardMetric) return cardMetric;

  const claimedRatio = ratioFromGeneratedClaim(insight.body);
  if (claimedRatio) {
    const [numerator, denominator] = claimedRatio;
    const label = insight.category === "matchup" ? "Games matching this captured pattern" : "Captured observations";
    return metricWithComplement({
      kind: "behaviour-rate",
      interpretation: insight.tone === "opportunity" ? "lower-is-better" : "neutral",
      label,
      numerator,
      denominator,
      numeratorLabel: label.toLocaleLowerCase(),
      denominatorLabel: "comparable captured games",
      display: `${numerator} of ${denominator} comparable captured games`,
      source: "insight-claim",
      complementLabel: "Other comparable captured games"
    });
  }

  const denominator = Math.max(0, insight.dataReceipt.scopeGames);
  const numerator = Math.min(denominator, Math.max(0, insight.dataReceipt.completePlayCaptureScopeGames));
  return {
    metric: {
      kind: "capture-coverage",
      interpretation: "higher-is-better",
      label: "Evidence capture coverage",
      numerator,
      denominator,
      percentage: percentage(numerator, denominator),
      numeratorLabel: "complete-enough captured games",
      denominatorLabel: "games in this insight",
      display: `${numerator} of ${denominator} games had complete-enough play capture`,
      source: "data-receipt"
    }
  };
}

function cardQuestMetric(insight: ReplayInsight, card: QuestCardReport): QuestMetricResult | undefined {
  if (insight.id.endsWith(":often-unplayed")) {
    return safeMetricWithComplement({
      kind: "behaviour-rate",
      interpretation: insight.tone === "opportunity" ? "lower-is-better" : "neutral",
      label: "Appearances without a captured play",
      numerator: card.unplayed,
      denominator: card.completePlayCaptureAppearances,
      numeratorLabel: "appearances without a captured play",
      denominatorLabel: "complete-enough appearances",
      display: `${card.unplayed} of ${card.completePlayCaptureAppearances} complete-enough appearances`,
      source: "card-report",
      complementLabel: "Appearances with a captured play"
    });
  }
  if (insight.id.endsWith(":late-after-keep")) {
    return safeMetricWithComplement({
      kind: "behaviour-rate",
      interpretation: insight.tone === "opportunity" ? "lower-is-better" : "neutral",
      label: "Keeps first played on turn four or later",
      numerator: card.lateKeeps,
      denominator: card.kept,
      numeratorLabel: "late first plays after a keep",
      denominatorLabel: "captured keeps",
      display: `${card.lateKeeps} of ${card.kept} captured keeps`,
      source: "card-report",
      complementLabel: "Other captured keeps"
    });
  }
  if (insight.id.endsWith(":converted-away")) {
    return safeMetricWithComplement({
      kind: "behaviour-rate",
      interpretation: insight.tone === "opportunity" ? "lower-is-better" : "neutral",
      label: "Appearances recycled or discarded",
      numerator: card.recycledOrDiscarded,
      denominator: card.appearances,
      numeratorLabel: "recycled or discarded appearances",
      denominatorLabel: "analyzed appearances",
      display: `${card.recycledOrDiscarded} of ${card.appearances} analyzed appearances`,
      source: "card-report",
      complementLabel: "Other analyzed appearances"
    });
  }
  if (insight.id.endsWith(":immediate-impact")) {
    return safeMetricWithComplement({
      kind: "behaviour-rate",
      interpretation: "higher-is-better",
      label: "Plays on the same turn the card entered hand",
      numerator: card.immediatePlays,
      denominator: card.played,
      numeratorLabel: "same-turn plays",
      denominatorLabel: "captured plays",
      display: `${card.immediatePlays} of ${card.played} captured plays`,
      source: "card-report",
      complementLabel: "Other captured plays"
    });
  }
  return undefined;
}

function safeMetricWithComplement(
  input: Omit<ReplayCoachQuestMetric, "percentage"> & { complementLabel: string }
): QuestMetricResult | undefined {
  if (!validRatio(input.numerator, input.denominator)) return undefined;
  return metricWithComplement(input);
}

function metricWithComplement(
  input: Omit<ReplayCoachQuestMetric, "percentage"> & { complementLabel: string }
): QuestMetricResult {
  const metricPercentage = percentage(input.numerator, input.denominator);
  const complement = input.denominator - input.numerator;
  const comparatorPercentage = percentage(complement, input.denominator);
  const { complementLabel, ...metricFields } = input;
  return {
    metric: { ...metricFields, percentage: metricPercentage },
    comparator: {
      kind: "complement",
      label: complementLabel,
      numerator: complement,
      denominator: input.denominator,
      percentage: comparatorPercentage,
      deltaPercentagePoints: Number((metricPercentage - comparatorPercentage).toFixed(1))
    }
  };
}

function ratioFromGeneratedClaim(value: string): [number, number] | undefined {
  const match = value.match(/\b(\d+)\s+of\s+(\d+)\b/i);
  if (!match) return undefined;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return validRatio(numerator, denominator) ? [numerator, denominator] : undefined;
}

function validRatio(numerator: number, denominator: number): boolean {
  return Number.isFinite(numerator)
    && Number.isFinite(denominator)
    && Number.isInteger(numerator)
    && Number.isInteger(denominator)
    && numerator >= 0
    && denominator > 0
    && numerator <= denominator;
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator * 100).toFixed(1)) : 0;
}

function findCardReport(insight: ReplayInsight, report: ReplayInsightsReport): QuestCardReport | undefined {
  const cardId = normalizeIdentifier(insight.cardId);
  const cardName = normalizeIdentifier(insight.cardName);
  return report.cards.find((candidate) => (
    Boolean(cardId) && normalizeIdentifier(candidate.cardId) === cardId
  ) || (
    Boolean(cardName) && normalizeIdentifier(candidate.cardName) === cardName
  ));
}

function questArt(insight: ReplayInsight, card: QuestCardReport | undefined): ReplayCoachQuestArt {
  const cardName = card?.cardName || insight.cardName;
  const cardId = card?.cardId || insight.cardId;
  const playerLegend = insight.playerLegend?.trim();
  const opponentLegend = insight.opponentLegend?.trim();
  return {
    category: insight.category,
    card: cardName ? {
      id: cardId,
      name: cardName,
      imageUrl: card?.imageUrl
    } : undefined,
    playerLegend: playerLegend ? { id: normalizeIdentifier(playerLegend), name: playerLegend } : undefined,
    opponentLegend: opponentLegend ? { id: normalizeIdentifier(opponentLegend), name: opponentLegend } : undefined,
    fallbackId: `category:${insight.category}`
  };
}

function questShareCopy(input: {
  kind: ReplayCoachQuestKind;
  headline: string;
  nextGameRule: string;
  reviewQuestion?: string;
  metric: ReplayCoachQuestMetric;
  observations: number;
}): ReplayCoachQuestShareCopy {
  const eyebrow = input.kind === "challenge" ? "My next-game challenge" : "Replay review question";
  const rule = input.kind === "challenge" ? input.nextGameRule : input.reviewQuestion ?? input.nextGameRule;
  const caveat = input.kind === "challenge"
    ? `Based on ${input.observations} captured observation${input.observations === 1 ? "" : "s"}. Observational evidence, not proof of causation.`
    : input.observations > 1
      ? `${input.observations} captured observations raised this review question; they are not a verdict on the decision.`
      : "One captured game raised this question; it is not a verdict on the decision.";
  return {
    eyebrow,
    headline: input.headline,
    rule,
    stat: input.metric.display,
    caveat,
    plainText: `${eyebrow}: ${input.headline}\n${rule}\n${input.metric.display}\n${caveat}`
  };
}

function questRankScore(
  insight: ReplayInsight,
  metric: ReplayCoachQuestMetric,
  kind: ReplayCoachQuestKind
): number {
  const category = insight.category === "opening-hand" ? 15
    : insight.category === "curve" ? 13
      : insight.category === "card-efficiency" ? 10
        : insight.category === "matchup" ? 8
          : insight.category === "battlefield" ? 5
            : 0;
  const confidence = insight.captureConfidence === "confirmed" || insight.captureConfidence === "manual" ? 8
    : insight.captureConfidence === "reconstructed" ? 4
      : 0;
  const pattern = insight.patternStrength === "reasonably-stable" ? 15
    : insight.patternStrength === "developing" ? 10
      : insight.patternStrength === "exploratory" ? 4
        : 0;
  const challenge = kind === "challenge" ? 40 : 0;
  const directMetric = metric.kind === "behaviour-rate" ? 5 : 0;
  const sample = Math.min(10, Math.log2(Math.max(1, insight.sampleSize)) * 2);
  return Number((insight.priority + category + confidence + pattern + challenge + directMetric + sample).toFixed(3));
}

function compareQuests(left: ReplayCoachQuest, right: ReplayCoachQuest): number {
  return right.rankScore - left.rankScore
    || right.scope.observations - left.scope.observations
    || left.insightId.localeCompare(right.insightId);
}

function distinctQuests(quests: ReplayCoachQuest[]): ReplayCoachQuest[] {
  const seen = new Set<string>();
  return quests.filter((quest) => {
    const identity = quest.art.card?.id || quest.art.card?.name || quest.art.opponentLegend?.id || quest.finding.title;
    const key = `${quest.category}:${normalizeIdentifier(identity)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeIdentifier(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ?? "";
}
