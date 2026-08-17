import { riftboundBasePrintCode, riftboundCardCodeFromValue } from "./cardIdentity.js";
import {
  MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON,
  sha256Ascii,
  type MulliganLabCoveragePeriod,
  type MulliganLabRegistry,
  type MulliganLabRegistryCard,
  type MulliganLabSeasonCoverage
} from "./mulliganLab.js";

export const SIDEBOARD_LAB_API_SCHEMA_VERSION = 1 as const;
export const SIDEBOARD_LAB_TARGET_PACK_SCHEMA_VERSION = 1 as const;
export const SIDEBOARD_LAB_MIN_DECISIONS = 25;
export const SIDEBOARD_LAB_MIN_PLAYERS = 10;
export const SIDEBOARD_LAB_MAX_DRILLS = 48;
export const SIDEBOARD_LAB_TARGET_PACK_MAX_DRILLS = 24;
/** Defensive API bound; format legality remains a backend responsibility. */
export const SIDEBOARD_LAB_MAX_SIDEBOARD_CARDS = 40;

export type SideboardLabDirection = "in" | "out";
export type SideboardLabPriorGameResult = "win" | "loss";
export type SideboardLabCardGuidance = "strong_select" | "select" | "mixed" | "avoid" | "strong_avoid" | "unclear";
export type SideboardLabCardEvidenceStatus = "robust" | "developing" | "limited";
export type SideboardLabCardOutcomeStatus = "comparable" | "one_sided" | "sparse";
export type SideboardLabChoiceFeedback = "aligned" | "conflicts" | "missed" | "developing" | "unclear" | "not-evaluated";

export interface SideboardLabPlanFeedbackSummary {
  movedCards: number;
  aligned: number;
  different: number;
  ungraded: number;
  notableAlternatives: number;
  noChanges: boolean;
  result: "aligned" | "different" | "mixed" | "ungraded" | "no-changes";
}

export interface SideboardLabScenarioUsefulness {
  kind: "challenge" | "guided" | "explore";
  actionableSignals: number;
  exactMatchupSignals: number;
  score: number;
}

export interface SideboardLabDeckShape {
  registeredCards: number;
  knownCostCards: number;
  averageEnergy: number | null;
  units: number;
  spells: number;
  gear: number;
  earlyUnits: number;
  twoCostUnits: number;
}

export interface SideboardLabPlanShape {
  before: SideboardLabDeckShape;
  after: SideboardLabDeckShape;
}

export interface SideboardLabValidationIssue {
  path: string;
  message: string;
}

export interface SideboardLabDeckCard extends MulliganLabRegistryCard {
  count: number;
}

export interface SideboardLabEvidenceSlice {
  opportunities: number;
  players: number;
  selected: number;
  selectedCopies: number;
  guidancePlayers: number;
  guidanceSelected: number;
  guidanceSelectionRate: number;
  guidance: SideboardLabCardGuidance;
  evidenceStatus: SideboardLabCardEvidenceStatus;
}

export interface SideboardLabQuantityEvidence {
  histogram: Array<{
    copies: number;
    decisions: number;
    players: number;
  }>;
  selectedMedianCopies: number | null;
  status: SideboardLabCardEvidenceStatus;
}

export interface SideboardLabPeriodEvidence {
  preseason: SideboardLabEvidenceSlice | null;
  currentSeason: SideboardLabEvidenceSlice | null;
}

export interface SideboardLabContext {
  nextInitiative: "first" | "second" | "unknown";
  format: "bo3";
  provider: "atlas";
  targetGameNumber: 2 | 3;
}

export interface SideboardLabDecisionEvidence {
  decisions: number;
  players: number;
  noChangeDecisions: number;
  noChangePlayers: number;
  noChangeRate: number;
  swapCountHistogram: Array<{
    copies: number;
    decisions: number;
    players: number;
  }>;
  medianCopiesMoved: number | null;
}

export interface SideboardLabPackage {
  cardsIn: SideboardLabDeckCard[];
  cardsOut: SideboardLabDeckCard[];
  decisions: number;
  players: number;
  selectionRate: number;
  evidenceStatus: Exclude<SideboardLabCardEvidenceStatus, "limited">;
}

export interface SideboardLabPair {
  cardIn: MulliganLabRegistryCard;
  cardOut: MulliganLabRegistryCard;
  decisions: number;
  players: number;
  selectionRate: number;
  evidenceStatus: Exclude<SideboardLabCardEvidenceStatus, "limited">;
}

export interface SideboardLabFormatPolicy {
  format: "bo3";
  observedRulesEpoch: "unknown";
  currentReference: {
    mainDeckCards: 40;
    sideboardMaximum: 10;
    swaps: "one-for-one";
    championChangesAllowed: true;
    fixedSections: ["legend", "runes", "battlefields"];
  };
  historicalValidation: "structural-only-no-retroactive-rules";
}

export interface SideboardLabTargetQuery {
  requested: {
    playerLegend: string;
    opponentLegend: string | null;
    deckFingerprint: string | null;
    priorGameResult: SideboardLabPriorGameResult | null;
    targetGameNumber: 2 | 3;
  };
  resolved: {
    scope: "exact-deck" | "matchup" | "player-legend";
    deckFingerprint: string | null;
    sharedCards: number | null;
    totalCards: 40 | null;
  };
  fallbackReason: "deck-not-observed" | "insufficient-private-cohort" | "matchup-not-observed" | null;
}

export interface SideboardLabCardEvidence {
  cardCode: string;
  identityCode: string;
  name: string;
  direction: SideboardLabDirection;
  scope: "matchup" | "player-legend";
  scopeDecisions: number;
  scopePlayers: number;
  opportunities: number;
  players: number;
  selected: number;
  selectedPlayers: number;
  selectedCopies: number;
  selectionRate: number;
  baselineSelectionRate: number;
  guidancePlayers: number;
  guidanceSelected: number;
  guidanceSelectionRate: number;
  selectedWins: number;
  notSelectedWins: number;
  selectedWinRate: number | null;
  notSelectedWinRate: number | null;
  winRateDelta: number | null;
  guidance: SideboardLabCardGuidance;
  evidenceStatus: SideboardLabCardEvidenceStatus;
  outcomeStatus: SideboardLabCardOutcomeStatus;
  /** Present on targeted v2 endpoint drills; absent from legacy daily packs. */
  quantity?: SideboardLabQuantityEvidence;
  /** Present on targeted v2 endpoint drills; absent from legacy daily packs. */
  periods?: SideboardLabPeriodEvidence;
}

export interface SideboardLabApiDrill {
  id: string;
  source: "community";
  playerLegend: MulliganLabRegistryCard;
  opponentLegend: MulliganLabRegistryCard;
  priorGameResult: SideboardLabPriorGameResult;
  deck: {
    fingerprint: string;
    chosenChampionCode?: string;
    mainDeck: SideboardLabDeckCard[];
    sideboard: SideboardLabDeckCard[];
  };
  evidence: {
    status: "sufficient" | "early";
    scope: "matchup";
    deckScope: "all-observed-decks";
    guidanceBasis: "community-selection-rate";
    outcomeInterpretation: "descriptive-not-causal";
    playerLegendIdentityCode: string;
    opponentLegendIdentityCode: string;
    decisions: number;
    players: number;
  };
  cardEvidence: SideboardLabCardEvidence[];
  /** Targeted v2-only context. */
  context?: SideboardLabContext;
  /** Targeted v2-only whole-decision descriptive evidence. */
  decisionEvidence?: SideboardLabDecisionEvidence;
  /** Targeted v2-only contributor-gated community packages. */
  packages?: SideboardLabPackage[];
  /** Targeted v2-only co-occurring IN↔OUT relationships. */
  pairs?: SideboardLabPair[];
}

export type SideboardLabApiParseResult =
  | {
      status: "ready";
      generatedAt: string;
      expiresAt: string;
      drills: SideboardLabApiDrill[];
      reason: "";
      issues: SideboardLabValidationIssue[];
      accepted: number;
      rejected: number;
      observedFrom: string | null;
      observedThrough: string | null;
      includedFacts: number;
      coverageTruncated: boolean;
      coveragePolicy: "all-available-history";
      includedPeriods: MulliganLabCoveragePeriod[];
      seasonCoverage: MulliganLabSeasonCoverage;
      backfillComplete: boolean;
      targetQuery?: SideboardLabTargetQuery;
      formatPolicy?: SideboardLabFormatPolicy;
      cardRegistryGeneratedAt?: string;
      cardRegistryPrints?: number;
    }
  | {
      status: "unavailable" | "invalid";
      generatedAt: null;
      expiresAt: null;
      drills: [];
      reason: string;
      issues: SideboardLabValidationIssue[];
      accepted: 0;
      rejected: number;
      observedFrom: null;
      observedThrough: null;
      includedFacts: 0;
      coverageTruncated: false;
      coveragePolicy: "all-available-history" | null;
      includedPeriods: MulliganLabCoveragePeriod[];
      seasonCoverage: MulliganLabSeasonCoverage | null;
      backfillComplete: boolean;
      targetQuery?: SideboardLabTargetQuery | null;
      formatPolicy?: SideboardLabFormatPolicy | null;
      cardRegistryGeneratedAt?: string | null;
      cardRegistryPrints?: number;
    };

export type SideboardLabTargetPackParseResult =
  | {
      status: "ready";
      generatedAt: string;
      expiresAt: string;
      drills: SideboardLabApiDrill[];
      reason: "";
      issues: SideboardLabValidationIssue[];
      accepted: number;
      rejected: number;
      targetQuery: SideboardLabTargetQuery;
      formatPolicy: SideboardLabFormatPolicy;
      cardRegistryGeneratedAt: string;
      cardRegistryPrints: number;
      observedFrom: string | null;
      observedThrough: string | null;
      includedFacts: number;
      coverageTruncated: boolean;
      coveragePolicy: "all-available-history";
      includedPeriods: MulliganLabCoveragePeriod[];
      seasonCoverage: MulliganLabSeasonCoverage;
      backfillComplete: boolean;
    }
  | {
      status: "unavailable" | "invalid";
      generatedAt: null;
      expiresAt: null;
      drills: [];
      reason: string;
      issues: SideboardLabValidationIssue[];
      accepted: 0;
      rejected: number;
      targetQuery: SideboardLabTargetQuery | null;
      formatPolicy: SideboardLabFormatPolicy | null;
      cardRegistryGeneratedAt: string | null;
      cardRegistryPrints: number;
      observedFrom: null;
      observedThrough: null;
      includedFacts: 0;
      coverageTruncated: false;
      coveragePolicy: "all-available-history" | null;
      includedPeriods: MulliganLabCoveragePeriod[];
      seasonCoverage: MulliganLabSeasonCoverage | null;
      backfillComplete: boolean;
    };

export interface SideboardLabPlan {
  in: Record<string, number>;
  out: Record<string, number>;
}

export interface SideboardLabPlanBalance {
  cardsIn: number;
  cardsOut: number;
  difference: number;
  status: "empty" | "balanced" | "needs-in" | "needs-out" | "overlap";
  overlappingIdentityCodes: string[];
  legal: boolean;
}

type JsonRecord = Record<string, unknown>;
type SideboardLabIdentityLookup = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

export function sideboardLabPlanBalance(plan: SideboardLabPlan, identityByCode?: SideboardLabIdentityLookup): SideboardLabPlanBalance {
  const cardsIn = selectionTotal(plan.in);
  const cardsOut = selectionTotal(plan.out);
  const difference = cardsIn - cardsOut;
  const inIdentities = selectionIdentities(plan.in, identityByCode);
  const outIdentities = selectionIdentities(plan.out, identityByCode);
  const overlappingIdentityCodes = [...inIdentities].filter((identityCode) => outIdentities.has(identityCode)).sort();
  return {
    cardsIn,
    cardsOut,
    difference,
    status: overlappingIdentityCodes.length
      ? "overlap"
      : cardsIn === 0 && cardsOut === 0
      ? "empty"
      : difference === 0
        ? "balanced"
        : difference < 0
          ? "needs-in"
          : "needs-out",
    overlappingIdentityCodes,
    legal: difference === 0 && overlappingIdentityCodes.length === 0
  };
}

/**
 * Returns the quantity shown on a registered-deck card control.
 *
 * Sideboard cards count up from zero as copies are brought in. Main-deck
 * cards count down from their registered quantity as copies are taken out,
 * while the underlying plan continues to store the number of copies moved.
 */
export function sideboardLabCardDisplayQuantity(
  direction: SideboardLabDirection,
  registeredQuantity: number,
  plannedQuantity: number
): number {
  if (!Number.isSafeInteger(registeredQuantity) || registeredQuantity < 1) return 0;
  const selected = Number.isSafeInteger(plannedQuantity)
    ? Math.max(0, Math.min(registeredQuantity, plannedQuantity))
    : 0;
  return direction === "out" ? registeredQuantity - selected : selected;
}

/**
 * Applies a change made to the displayed quantity. Decreasing a main-deck
 * quantity adds that copy to the OUT plan; increasing it restores the copy.
 */
export function adjustSideboardLabCardDisplayQuantity(
  plan: SideboardLabPlan,
  direction: SideboardLabDirection,
  cardCode: string,
  displayDelta: number,
  registeredQuantity: number,
  identityByCode?: SideboardLabIdentityLookup
): SideboardLabPlan {
  return adjustSideboardLabPlan(
    plan,
    direction,
    cardCode,
    direction === "out" ? -displayDelta : displayDelta,
    registeredQuantity,
    identityByCode
  );
}

/**
 * Adjusts a plan atomically. Adding a card clears the same base identity from
 * the opposite direction, including alternate and signed exact prints.
 */
export function adjustSideboardLabPlan(
  plan: SideboardLabPlan,
  direction: SideboardLabDirection,
  cardCode: string,
  delta: number,
  maximum: number,
  identityByCode?: SideboardLabIdentityLookup
): SideboardLabPlan {
  const code = canonicalCode(cardCode);
  const currentSelection = plan[direction];
  const currentCount = Number.isSafeInteger(currentSelection[code]) ? currentSelection[code] : 0;
  const nextSelection = adjustSideboardLabSelection(currentSelection, code, delta, maximum);
  const next: SideboardLabPlan = {
    in: direction === "in" ? nextSelection : { ...plan.in },
    out: direction === "out" ? nextSelection : { ...plan.out }
  };
  const nextCount = Number.isSafeInteger(nextSelection[code]) ? nextSelection[code] : 0;
  if (!code || nextCount <= currentCount) return next;

  const targetIdentity = sideboardLabPlanIdentity(code, identityByCode);
  const oppositeDirection: SideboardLabDirection = direction === "in" ? "out" : "in";
  const opposite = { ...next[oppositeDirection] };
  for (const oppositeCode of Object.keys(opposite)) {
    if (sideboardLabPlanIdentity(oppositeCode, identityByCode) === targetIdentity) delete opposite[oppositeCode];
  }
  next[oppositeDirection] = opposite;
  return next;
}

export function adjustSideboardLabSelection(
  selection: Record<string, number>,
  cardCode: string,
  delta: number,
  maximum: number
): Record<string, number> {
  const code = canonicalCode(cardCode);
  if (!code || !Number.isSafeInteger(delta) || !Number.isSafeInteger(maximum) || maximum < 1) return { ...selection };
  const current = Number.isSafeInteger(selection[code]) ? selection[code] : 0;
  const next = Math.max(0, Math.min(maximum, current + delta));
  const result = { ...selection };
  if (next) result[code] = next;
  else delete result[code];
  return result;
}

export function sideboardLabChoiceFeedback(
  evidence: SideboardLabCardEvidence,
  userSelected: boolean
): SideboardLabChoiceFeedback {
  if (evidence.evidenceStatus !== "robust") {
    return evidence.evidenceStatus === "developing" ? "developing" : "unclear";
  }
  const communitySelects = evidence.guidance === "select" || evidence.guidance === "strong_select";
  const communityAvoids = evidence.guidance === "avoid" || evidence.guidance === "strong_avoid";
  if (!communitySelects && !communityAvoids) return "unclear";
  return userSelected === communitySelects ? "aligned" : "conflicts";
}

/**
 * Returns the feedback that should be painted on a card after a plan is
 * revealed. Leaving a community-avoid card untouched is intentionally neutral:
 * otherwise a 40-card registered list can swamp the handful of deliberate
 * swaps with trivial positive matches.
 */
export function sideboardLabVisibleChoiceFeedback(
  evidence: SideboardLabCardEvidence,
  userSelected: boolean
): SideboardLabChoiceFeedback {
  if (userSelected) return sideboardLabChoiceFeedback(evidence, true);
  if (
    evidence.evidenceStatus === "robust"
    && (evidence.guidance === "select" || evidence.guidance === "strong_select")
  ) return "missed";
  return "not-evaluated";
}

/**
 * Summarises only deliberate moves plus robust community-select alternatives.
 * An empty plan is reported separately and is never awarded alignment for all
 * the cards that were left in their registered zones.
 */
export function summarizeSideboardLabPlanFeedback(
  evidence: readonly SideboardLabCardEvidence[],
  plan: SideboardLabPlan
): SideboardLabPlanFeedbackSummary {
  let movedCards = 0;
  let aligned = 0;
  let different = 0;
  let ungraded = 0;
  let notableAlternatives = 0;

  for (const item of evidence) {
    const selected = (plan[item.direction][canonicalCode(item.cardCode)] ?? 0) > 0;
    if (!selected) {
      if (sideboardLabVisibleChoiceFeedback(item, false) === "missed") notableAlternatives += 1;
      continue;
    }
    movedCards += 1;
    const feedback = sideboardLabVisibleChoiceFeedback(item, true);
    if (feedback === "aligned") aligned += 1;
    else if (feedback === "conflicts") different += 1;
    else ungraded += 1;
  }

  const noChanges = selectionTotal(plan.in) === 0 && selectionTotal(plan.out) === 0;
  const result = noChanges
    ? "no-changes"
    : aligned > 0 && (different > 0 || notableAlternatives > 0)
      ? "mixed"
      : different > 0 || notableAlternatives > 0
        ? "different"
        : aligned > 0
          ? "aligned"
          : "ungraded";
  return { movedCards, aligned, different, ungraded, notableAlternatives, noChanges, result };
}

export function sideboardLabScenarioUsefulness(drill: SideboardLabApiDrill): SideboardLabScenarioUsefulness {
  const actionable = drill.cardEvidence.filter((item) => (
    item.evidenceStatus === "robust"
    && (item.guidance === "select" || item.guidance === "strong_select")
  ));
  const exactMatchupSignals = actionable.filter((item) => item.scope === "matchup").length;
  const actionableSignals = actionable.length;
  const score = exactMatchupSignals * 100
    + actionableSignals * 10
    + Math.min(drill.evidence.players, 99)
    + (drill.evidence.status === "sufficient" ? 25 : 0);
  return {
    kind: exactMatchupSignals > 0 ? "challenge" : actionableSignals > 0 ? "guided" : "explore",
    actionableSignals,
    exactMatchupSignals,
    score
  };
}

/** Picks the most teachable scenarios first while preserving matchup variety. */
export function rankSideboardLabDailyDrills(
  drills: readonly SideboardLabApiDrill[],
  limit = 5
): SideboardLabApiDrill[] {
  const maximum = Math.max(0, Math.min(20, Math.floor(limit)));
  const ranked = [...drills].sort((left, right) => {
    const scoreDifference = sideboardLabScenarioUsefulness(right).score - sideboardLabScenarioUsefulness(left).score;
    return scoreDifference || left.id.localeCompare(right.id);
  });
  const selected: SideboardLabApiDrill[] = [];
  const matchups = new Set<string>();
  for (const drill of ranked) {
    const matchup = `${drill.playerLegend.code}:${drill.opponentLegend.code}:${drill.priorGameResult}`;
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

/** Objective registered-deck shape before and after the hypothetical plan. */
export function sideboardLabPlanShape(
  deck: SideboardLabApiDrill["deck"],
  plan: SideboardLabPlan
): SideboardLabPlanShape {
  const before = deck.mainDeck.map((card) => ({ card, count: card.count }));
  const after = [
    ...deck.mainDeck.map((card) => ({ card, count: Math.max(0, card.count - (plan.out[canonicalCode(card.code)] ?? 0)) })),
    ...deck.sideboard.map((card) => ({ card, count: Math.min(card.count, plan.in[canonicalCode(card.code)] ?? 0) }))
  ];
  return { before: deckShape(before), after: deckShape(after) };
}

function deckShape(entries: Array<{ card: SideboardLabDeckCard; count: number }>): SideboardLabDeckShape {
  let registeredCards = 0;
  let knownCostCards = 0;
  let energyTotal = 0;
  let units = 0;
  let spells = 0;
  let gear = 0;
  let earlyUnits = 0;
  let twoCostUnits = 0;
  for (const { card, count } of entries) {
    if (count <= 0) continue;
    const normalizedType = card.type.trim().toLocaleLowerCase();
    if (normalizedType !== "unit" && normalizedType !== "spell" && normalizedType !== "gear") continue;
    registeredCards += count;
    if (normalizedType === "unit") units += count;
    else if (normalizedType === "spell") spells += count;
    else gear += count;
    if (card.costEnergy !== null) {
      knownCostCards += count;
      energyTotal += card.costEnergy * count;
      if (normalizedType === "unit" && card.costEnergy <= 2) earlyUnits += count;
      if (normalizedType === "unit" && card.costEnergy === 2) twoCostUnits += count;
    }
  }
  return {
    registeredCards,
    knownCostCards,
    averageEnergy: knownCostCards === registeredCards && knownCostCards > 0 ? energyTotal / knownCostCards : null,
    units,
    spells,
    gear,
    earlyUnits,
    twoCostUnits
  };
}

export function sideboardLabEvidenceKey(direction: SideboardLabDirection, cardCode: string): string {
  return `${direction}:${canonicalCode(cardCode)}`;
}

/** Mirrors the server's canonical fingerprint over the full registered configuration. */
export function sideboardLabDeckFingerprint(
  mainDeck: Array<{ code?: string; cardCode?: string; count: number }>,
  sideboard: Array<{ code?: string; cardCode?: string; count: number }>
): string {
  const lines = (cards: Array<{ code?: string; cardCode?: string; count: number }>) => cards
    .map((card) => ({ code: canonicalCode(card.code ?? card.cardCode), count: card.count }))
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((card) => `${card.code}:${card.count}`);
  return sha256Ascii(JSON.stringify({ mainDeck: lines(mainDeck), sideboard: lines(sideboard) }));
}

/** Resolves saved 40-card or Atlas 39+Chosen-Champion snapshots to the server fingerprint. */
export function sideboardLabDeckFingerprintFromSnapshot(snapshotJson: string, registry: MulliganLabRegistry): string {
  let root: JsonRecord | null = null;
  try {
    root = record(JSON.parse(snapshotJson));
  } catch {
    return "";
  }
  const rawMain = Array.isArray(root?.mainDeck) ? root.mainDeck : Array.isArray(root?.main_deck) ? root.main_deck : null;
  const rawSideboard = Array.isArray(root?.sideboard) ? root.sideboard : Array.isArray(root?.side_board) ? root.side_board : null;
  const rawChampion = Array.isArray(root?.champion) ? root.champion : Array.isArray(root?.champions) ? root.champions : [];
  if (!rawMain || !rawSideboard) return "";
  const mainTotal = snapshotQuantity(rawMain);
  const championTotal = snapshotQuantity(rawChampion);
  const mainEntries = mainTotal === 40 ? rawMain : mainTotal === 39 && championTotal === 1 ? [...rawMain, ...rawChampion] : [];
  if (!mainEntries.length) return "";
  const mainDeck = snapshotDeckCards(mainEntries, registry);
  const sideboard = snapshotDeckCards(rawSideboard, registry);
  if (!mainDeck || !sideboard || !sideboard.length) return "";
  if (mainDeck.reduce((sum, card) => sum + card.count, 0) !== 40) return "";
  if (sideboard.reduce((sum, card) => sum + card.count, 0) > SIDEBOARD_LAB_MAX_SIDEBOARD_CARDS) return "";
  const combined = new Map<string, number>();
  for (const card of [...mainDeck, ...sideboard]) {
    const identityCode = riftboundBasePrintCode(card.code);
    combined.set(identityCode, (combined.get(identityCode) ?? 0) + card.count);
  }
  if ([...combined.values()].some((count) => count > 3)) return "";
  return sideboardLabDeckFingerprint(mainDeck, sideboard);
}

export function parseSideboardLabApiResponse(raw: unknown, registry: MulliganLabRegistry): SideboardLabApiParseResult {
  const issues: SideboardLabValidationIssue[] = [];
  const root = record(raw);
  if (!root) return invalidResult([{ path: "$", message: "Sideboard Lab response must be an object." }]);
  assertExactKeys(
    root,
    root.status === "unavailable"
      ? ["schema", "version", "status", "generatedAt", "expiresAt", "source", "drills", "reason"]
      : ["schema", "version", "status", "generatedAt", "expiresAt", "source", "drills"],
    "$",
    issues
  );
  if (root.schema !== "riftlite-sideboard-lab") issue(issues, "schema", "Unexpected Sideboard Lab API schema.");
  if (integer(root.version) !== SIDEBOARD_LAB_API_SCHEMA_VERSION) issue(issues, "version", "Unsupported Sideboard Lab API version.");

  const source = record(root.source);
  if (!source) issue(issues, "source", "Source metadata is required.");
  if (source) assertExactKeys(source, [
    "kind",
    "corpus",
    "minimumDecisions",
    "minimumPlayers",
    "observedFrom",
    "observedThrough",
    "includedFacts",
    "coverageTruncated",
    "coveragePolicy",
    "includedPeriods",
    "backfillComplete",
    "seasonCoverage"
  ], "source", issues);
  if (source?.kind !== "precomputed-observed-replays") issue(issues, "source.kind", "Unexpected Sideboard Lab source kind.");
  if (source?.corpus !== "anonymized-canonical-web-replays") issue(issues, "source.corpus", "Unexpected Sideboard Lab replay corpus.");
  if (integer(source?.minimumDecisions) !== SIDEBOARD_LAB_MIN_DECISIONS) issue(issues, "source.minimumDecisions", "Unexpected decision threshold.");
  if (integer(source?.minimumPlayers) !== SIDEBOARD_LAB_MIN_PLAYERS) issue(issues, "source.minimumPlayers", "Unexpected player threshold.");
  const coveragePolicy = source?.coveragePolicy === "all-available-history" ? source.coveragePolicy : null;
  if (!coveragePolicy) issue(issues, "source.coveragePolicy", "Sideboard Lab requires the all-history coverage policy.");
  const includedPeriods = parseCoveragePeriods(source?.includedPeriods, issues);
  const seasonCoverage = parseSeasonCoverage(source?.seasonCoverage, issues);
  const backfillComplete = typeof source?.backfillComplete === "boolean" ? source.backfillComplete : false;
  if (typeof source?.backfillComplete !== "boolean") issue(issues, "source.backfillComplete", "Historical backfill state must be explicit.");

  const rawDrills = Array.isArray(root.drills) ? root.drills : null;
  if (!rawDrills) issue(issues, "drills", "Drills must be an array.");
  if (root.status === "unavailable") {
    const reason = text(root.reason);
    if (!["snapshot_not_configured", "snapshot_invalid", "snapshot_expired", "data_unavailable"].includes(reason)) {
      issue(issues, "reason", "Unknown Sideboard Lab unavailable reason.");
    }
    if (root.generatedAt !== null || root.expiresAt !== null) issue(issues, "generatedAt", "Unavailable responses cannot claim generated data.");
    if (rawDrills?.length) issue(issues, "drills", "Unavailable responses cannot contain drills.");
    if (source?.observedFrom !== null || source?.observedThrough !== null || source?.includedFacts !== 0 || source?.coverageTruncated !== false) {
      issue(issues, "source", "Unavailable source metadata must describe an empty observation corpus.");
    }
    if (includedPeriods.length) issue(issues, "source.includedPeriods", "Unavailable responses cannot claim included periods.");
    if (seasonCoverage && (seasonCoverage.preseasonFacts || seasonCoverage.currentSeasonFacts)) issue(issues, "source.seasonCoverage", "Unavailable season counts must be zero.");
    if (backfillComplete) issue(issues, "source.backfillComplete", "Unavailable responses cannot claim a complete backfill.");
    if (issues.length) return invalidResult(issues);
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
      coveragePolicy,
      includedPeriods: [],
      seasonCoverage,
      backfillComplete: false
    };
  }

  if (root.status !== "ready") issue(issues, "status", "Status must be ready or unavailable.");
  const generatedAt = isoDate(root.generatedAt, "generatedAt", issues);
  const expiresAt = isoDate(root.expiresAt, "expiresAt", issues);
  if (generatedAt && expiresAt && Date.parse(generatedAt) >= Date.parse(expiresAt)) issue(issues, "expiresAt", "Expiry must be after generation.");
  if (generatedAt && Date.parse(generatedAt) > Date.now() + 10 * 60_000) issue(issues, "generatedAt", "Generation time cannot be in the future.");
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) issue(issues, "expiresAt", "Expired Sideboard Lab packs cannot be used.");
  const observedFrom = nullableIsoDay(source?.observedFrom, "source.observedFrom", issues);
  const observedThrough = nullableIsoDay(source?.observedThrough, "source.observedThrough", issues);
  const includedFacts = nonNegativeInteger(source?.includedFacts, "source.includedFacts", issues);
  const coverageTruncated = typeof source?.coverageTruncated === "boolean" ? source.coverageTruncated : false;
  if (typeof source?.coverageTruncated !== "boolean") issue(issues, "source.coverageTruncated", "Coverage truncation must be explicit.");
  if (observedFrom && observedThrough && observedFrom > observedThrough) issue(issues, "source.observedThrough", "Observation window cannot end before it starts.");
  if (seasonCoverage && includedFacts !== null && seasonCoverage.preseasonFacts + seasonCoverage.currentSeasonFacts !== includedFacts) {
    issue(issues, "source.seasonCoverage", "Season fact counts must add up to included facts.");
  }
  if (seasonCoverage) validateCoveragePeriods(includedPeriods, seasonCoverage, issues);
  if (!rawDrills?.length || rawDrills.length > SIDEBOARD_LAB_MAX_DRILLS) issue(issues, "drills", `Ready responses require between 1 and ${SIDEBOARD_LAB_MAX_DRILLS} drills.`);
  if (issues.length || !rawDrills || !generatedAt || !expiresAt || includedFacts === null || !coveragePolicy || !seasonCoverage) return invalidResult(issues, rawDrills?.length ?? 0);

  const drills: SideboardLabApiDrill[] = [];
  const seenIds = new Set<string>();
  let rejected = 0;
  rawDrills.forEach((value, index) => {
    const drillIssues: SideboardLabValidationIssue[] = [];
    const drill = parseDrill(value, index, registry, seenIds, drillIssues);
    if (!drill || drillIssues.length) {
      rejected += 1;
      issues.push(...drillIssues);
    } else {
      drills.push(drill);
    }
  });
  if (!drills.length) return invalidResult(issues.length ? issues : [{ path: "drills", message: "Every Sideboard Lab drill failed validation." }], rejected);
  return {
    status: "ready",
    generatedAt,
    expiresAt,
    drills,
    reason: "",
    issues,
    accepted: drills.length,
    rejected,
    observedFrom,
    observedThrough,
    includedFacts,
    coverageTruncated,
    coveragePolicy,
    includedPeriods,
    seasonCoverage,
    backfillComplete
  };
}

/**
 * Strict parser for GET /api/app/sideboard-lab/v2 targeted packs.
 *
 * Targeted packs are deliberately additive: the legacy daily-pack parser
 * continues to reject these fields, while this parser requires every v2
 * context, quantity, period, decision, and package field promised by the
 * targeted website contract.
 */
export function parseSideboardLabTargetPackResponse(
  raw: unknown,
  registry: MulliganLabRegistry
): SideboardLabTargetPackParseResult {
  const issues: SideboardLabValidationIssue[] = [];
  const root = record(raw);
  if (!root) return invalidTargetResult([{ path: "$", message: "Targeted Sideboard Lab response must be an object." }]);
  assertExactKeys(
    root,
    root.status === "unavailable"
      ? ["schema", "version", "status", "generatedAt", "expiresAt", "query", "source", "drills", "reason"]
      : ["schema", "version", "status", "generatedAt", "expiresAt", "query", "source", "drills"],
    "$",
    issues
  );
  if (root.schema !== "riftlite-sideboard-lab-pack") issue(issues, "schema", "Unexpected targeted Sideboard Lab schema.");
  if (integer(root.version) !== SIDEBOARD_LAB_TARGET_PACK_SCHEMA_VERSION) issue(issues, "version", "Unsupported targeted Sideboard Lab version.");

  const targetQuery = parseSideboardLabTargetQuery(root.query, registry, issues);
  const rawDrills = Array.isArray(root.drills) ? root.drills : null;
  if (!rawDrills) issue(issues, "drills", "Targeted drills must be an array.");

  if (root.status === "unavailable") {
    const reason = text(root.reason);
    if (!["snapshot_not_configured", "snapshot_invalid", "snapshot_expired", "data_unavailable", "matchup_not_observed"].includes(reason)) {
      issue(issues, "reason", "Unknown targeted Sideboard Lab unavailable reason.");
    }
    if (root.generatedAt !== null || root.expiresAt !== null) issue(issues, "generatedAt", "Unavailable targeted responses cannot claim generated data.");
    if (rawDrills?.length) issue(issues, "drills", "Unavailable targeted responses cannot contain drills.");
    const source = root.source === null ? null : parseSideboardLabTargetSource(root.source, registry, issues);
    if (issues.length || !targetQuery || !rawDrills) return invalidTargetResult(issues, rawDrills?.length ?? 0, targetQuery);
    return {
      status: "unavailable",
      generatedAt: null,
      expiresAt: null,
      drills: [],
      reason,
      issues: [],
      accepted: 0,
      rejected: 0,
      targetQuery,
      formatPolicy: source?.formatPolicy ?? null,
      cardRegistryGeneratedAt: source?.cardRegistryGeneratedAt ?? null,
      cardRegistryPrints: source?.cardRegistryPrints ?? 0,
      observedFrom: null,
      observedThrough: null,
      includedFacts: 0,
      coverageTruncated: false,
      coveragePolicy: source?.coveragePolicy ?? null,
      includedPeriods: [],
      seasonCoverage: null,
      backfillComplete: false
    };
  }

  if (root.status !== "ready") issue(issues, "status", "Targeted status must be ready or unavailable.");
  const generatedAt = isoDateTimeWithOffset(root.generatedAt, "generatedAt", issues);
  const expiresAt = isoDateTimeWithOffset(root.expiresAt, "expiresAt", issues);
  if (generatedAt && expiresAt && Date.parse(generatedAt) >= Date.parse(expiresAt)) issue(issues, "expiresAt", "Expiry must be after generation.");
  if (generatedAt && Date.parse(generatedAt) > Date.now() + 10 * 60_000) issue(issues, "generatedAt", "Generation time cannot be in the future.");
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) issue(issues, "expiresAt", "Expired targeted Sideboard Lab packs cannot be used.");
  const source = parseSideboardLabTargetSource(root.source, registry, issues);
  if (!rawDrills?.length || rawDrills.length > SIDEBOARD_LAB_TARGET_PACK_MAX_DRILLS) {
    issue(issues, "drills", `Ready targeted responses require between 1 and ${SIDEBOARD_LAB_TARGET_PACK_MAX_DRILLS} drills.`);
  }
  if (issues.length || !rawDrills || !generatedAt || !expiresAt || !targetQuery || !source) {
    return invalidTargetResult(issues, rawDrills?.length ?? 0, targetQuery);
  }

  const drills: SideboardLabApiDrill[] = [];
  const seenIds = new Set<string>();
  let rejected = 0;
  rawDrills.forEach((value, index) => {
    const drillIssues: SideboardLabValidationIssue[] = [];
    const drill = parseDrill(value, index, registry, seenIds, drillIssues, true);
    if (drill) validateSideboardLabTargetDrill(drill, targetQuery, index, drillIssues);
    if (!drill || drillIssues.length) {
      rejected += 1;
      issues.push(...drillIssues);
    } else {
      drills.push(drill);
    }
  });
  if (issues.length || rejected || drills.length !== rawDrills.length) {
    return invalidTargetResult(
      issues.length ? issues : [{ path: "drills", message: "Every targeted drill must pass strict v2 validation." }],
      rejected || rawDrills.length,
      targetQuery
    );
  }
  return {
    status: "ready",
    generatedAt,
    expiresAt,
    drills,
    reason: "",
    issues: [],
    accepted: drills.length,
    rejected: 0,
    targetQuery,
    formatPolicy: source.formatPolicy,
    cardRegistryGeneratedAt: source.cardRegistryGeneratedAt,
    cardRegistryPrints: source.cardRegistryPrints,
    observedFrom: source.observedFrom,
    observedThrough: source.observedThrough,
    includedFacts: source.includedFacts,
    coverageTruncated: source.coverageTruncated,
    coveragePolicy: source.coveragePolicy,
    includedPeriods: source.includedPeriods,
    seasonCoverage: source.seasonCoverage,
    backfillComplete: source.backfillComplete
  };
}

function validateSideboardLabTargetDrill(
  drill: SideboardLabApiDrill,
  query: SideboardLabTargetQuery,
  index: number,
  issues: SideboardLabValidationIssue[]
) {
  const path = `drills[${index}]`;
  const requestedPlayerIdentity = riftboundBasePrintCode(query.requested.playerLegend);
  if (drill.evidence.playerLegendIdentityCode !== requestedPlayerIdentity) {
    issue(issues, `${path}.matchup.playerLegend`, "Targeted drill player Legend does not match the requested identity.");
  }
  if (
    query.resolved.scope !== "player-legend"
    &&
    query.requested.opponentLegend
    && drill.evidence.opponentLegendIdentityCode !== riftboundBasePrintCode(query.requested.opponentLegend)
  ) issue(issues, `${path}.matchup.opponentLegend`, "Targeted drill opponent Legend does not match the requested identity.");
  if (query.requested.priorGameResult && drill.priorGameResult !== query.requested.priorGameResult) {
    issue(issues, `${path}.priorGameResult`, "Targeted drill does not match the requested prior Game 1 result.");
  }
  if (drill.context?.targetGameNumber !== query.requested.targetGameNumber) {
    issue(issues, `${path}.context.targetGameNumber`, "Targeted drill does not match the requested sideboard window.");
  }
  if (query.resolved.scope === "exact-deck" && drill.deck.fingerprint !== query.resolved.deckFingerprint) {
    issue(issues, `${path}.deck.fingerprint`, "Exact-deck targeted drills must use the resolved deck fingerprint.");
  }
}

interface ParsedSideboardLabTargetSource {
  observedFrom: string | null;
  observedThrough: string | null;
  includedFacts: number;
  coverageTruncated: boolean;
  coveragePolicy: "all-available-history";
  includedPeriods: MulliganLabCoveragePeriod[];
  seasonCoverage: MulliganLabSeasonCoverage;
  backfillComplete: boolean;
  cardRegistryGeneratedAt: string;
  cardRegistryPrints: number;
  formatPolicy: SideboardLabFormatPolicy;
}

function parseSideboardLabTargetSource(
  raw: unknown,
  registry: MulliganLabRegistry,
  issues: SideboardLabValidationIssue[]
): ParsedSideboardLabTargetSource | null {
  const value = record(raw);
  if (!value) {
    issue(issues, "source", "Targeted source metadata is required.");
    return null;
  }
  assertExactKeys(value, [
    "kind",
    "corpus",
    "minimumDecisions",
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
    "cardRegistryPrints",
    "formatPolicy"
  ], "source", issues);
  if (value.kind !== "precomputed-observed-replays") issue(issues, "source.kind", "Unexpected Sideboard Lab source kind.");
  if (value.corpus !== "anonymized-canonical-web-replays") issue(issues, "source.corpus", "Unexpected Sideboard Lab replay corpus.");
  const minimumDecisions = positiveInteger(value.minimumDecisions, "source.minimumDecisions", issues);
  const minimumPlayers = positiveInteger(value.minimumPlayers, "source.minimumPlayers", issues);
  if (minimumDecisions !== null && minimumDecisions < SIDEBOARD_LAB_MIN_DECISIONS) issue(issues, "source.minimumDecisions", `Targeted decision threshold cannot be below ${SIDEBOARD_LAB_MIN_DECISIONS}.`);
  if (minimumPlayers !== null && minimumPlayers < SIDEBOARD_LAB_MIN_PLAYERS) issue(issues, "source.minimumPlayers", `Targeted player threshold cannot be below ${SIDEBOARD_LAB_MIN_PLAYERS}.`);
  const observedFrom = nullableIsoDay(value.observedFrom, "source.observedFrom", issues);
  const observedThrough = nullableIsoDay(value.observedThrough, "source.observedThrough", issues);
  const includedFacts = nonNegativeInteger(value.includedFacts, "source.includedFacts", issues);
  const coverageTruncated = typeof value.coverageTruncated === "boolean" ? value.coverageTruncated : false;
  if (typeof value.coverageTruncated !== "boolean") issue(issues, "source.coverageTruncated", "Coverage truncation must be explicit.");
  const coveragePolicy = value.coveragePolicy === "all-available-history" ? value.coveragePolicy : null;
  if (!coveragePolicy) issue(issues, "source.coveragePolicy", "Targeted packs require all-history coverage.");
  const includedPeriods = parseCoveragePeriods(value.includedPeriods, issues);
  const seasonCoverage = parseSeasonCoverage(value.seasonCoverage, issues);
  const backfillComplete = typeof value.backfillComplete === "boolean" ? value.backfillComplete : false;
  if (typeof value.backfillComplete !== "boolean") issue(issues, "source.backfillComplete", "Historical backfill state must be explicit.");
  const cardRegistryGeneratedAt = isoDateTimeWithOffset(value.cardRegistryGeneratedAt, "source.cardRegistryGeneratedAt", issues);
  const cardRegistryPrints = positiveInteger(value.cardRegistryPrints, "source.cardRegistryPrints", issues);
  if (cardRegistryPrints !== null && cardRegistryPrints !== registry.byCode.size) issue(issues, "source.cardRegistryPrints", "Targeted pack registry size does not match RiftLite's packaged card catalog.");
  const formatPolicy = parseSideboardLabFormatPolicy(value.formatPolicy, "source.formatPolicy", issues);
  if (observedFrom && observedThrough && observedFrom > observedThrough) issue(issues, "source.observedThrough", "Observation window cannot end before it starts.");
  if (seasonCoverage && includedFacts !== null && seasonCoverage.preseasonFacts + seasonCoverage.currentSeasonFacts !== includedFacts) {
    issue(issues, "source.seasonCoverage", "Season fact counts must add up to included facts.");
  }
  if (seasonCoverage) validateCoveragePeriods(includedPeriods, seasonCoverage, issues);
  if (
    includedFacts === null || !coveragePolicy || !seasonCoverage || !cardRegistryGeneratedAt
    || cardRegistryPrints === null || !formatPolicy
  ) return null;
  return {
    observedFrom,
    observedThrough,
    includedFacts,
    coverageTruncated,
    coveragePolicy,
    includedPeriods,
    seasonCoverage,
    backfillComplete,
    cardRegistryGeneratedAt,
    cardRegistryPrints,
    formatPolicy
  };
}

function parseSideboardLabTargetQuery(
  raw: unknown,
  registry: MulliganLabRegistry,
  issues: SideboardLabValidationIssue[]
): SideboardLabTargetQuery | null {
  const start = issues.length;
  const value = record(raw);
  if (!value) {
    issue(issues, "query", "Targeted query metadata is required.");
    return null;
  }
  assertExactKeys(value, ["requested", "resolved", "fallbackReason"], "query", issues);
  const requested = record(value.requested);
  if (!requested) issue(issues, "query.requested", "Requested selectors are required.");
  if (requested) assertExactKeys(requested, ["playerLegend", "opponentLegend", "deckFingerprint", "priorGameResult", "targetGameNumber"], "query.requested", issues);
  const playerLegend = strictLegendCode(requested?.playerLegend, registry, "query.requested.playerLegend", issues);
  const opponentLegend = requested?.opponentLegend === null
    ? null
    : strictLegendCode(requested?.opponentLegend, registry, "query.requested.opponentLegend", issues);
  const requestedDeckFingerprint = nullableSha256(requested?.deckFingerprint, "query.requested.deckFingerprint", issues);
  const priorGameResult = requested?.priorGameResult === null
    ? null
    : requested?.priorGameResult === "win" || requested?.priorGameResult === "loss"
      ? requested.priorGameResult
      : null;
  if (requested?.priorGameResult !== null && priorGameResult === null) issue(issues, "query.requested.priorGameResult", "Prior Game result must be win, loss, or null.");
  const targetGameNumber = requested?.targetGameNumber === undefined || requested?.targetGameNumber === 2
    ? 2 as const
    : requested.targetGameNumber === 3 ? 3 as const : null;
  if (targetGameNumber === null) issue(issues, "query.requested.targetGameNumber", "Target game number must be 2 or 3.");

  const resolved = record(value.resolved);
  if (!resolved) issue(issues, "query.resolved", "Resolved selectors are required.");
  if (resolved) assertExactKeys(resolved, ["scope", "deckFingerprint", "sharedCards", "totalCards"], "query.resolved", issues);
  const scope = ["exact-deck", "matchup", "player-legend"].includes(text(resolved?.scope))
    ? resolved?.scope as SideboardLabTargetQuery["resolved"]["scope"]
    : null;
  if (!scope) issue(issues, "query.resolved.scope", "Resolved scope must be exact-deck, matchup, or player-legend.");
  const resolvedDeckFingerprint = nullableSha256(resolved?.deckFingerprint, "query.resolved.deckFingerprint", issues);
  const sharedCards = resolved?.sharedCards === null
    ? null
    : boundedInteger(resolved?.sharedCards, 0, 40, "query.resolved.sharedCards", issues);
  const totalCards = resolved?.totalCards === null ? null : resolved?.totalCards === 40 ? 40 as const : null;
  if (resolved?.totalCards !== null && totalCards === null) issue(issues, "query.resolved.totalCards", "Resolved totalCards must be 40 or null.");
  const fallbackReason = value.fallbackReason === null
    ? null
    : ["deck-not-observed", "insufficient-private-cohort", "matchup-not-observed"].includes(text(value.fallbackReason))
      ? value.fallbackReason as NonNullable<SideboardLabTargetQuery["fallbackReason"]>
      : null;
  if (value.fallbackReason !== null && fallbackReason === null) issue(issues, "query.fallbackReason", "Unknown targeted fallback reason.");
  if (scope === "exact-deck") {
    if (!requestedDeckFingerprint || !resolvedDeckFingerprint || requestedDeckFingerprint !== resolvedDeckFingerprint) {
      issue(issues, "query.resolved.deckFingerprint", "Exact-deck resolution must preserve the requested fingerprint.");
    }
    if (sharedCards !== 40 || totalCards !== 40) issue(issues, "query.resolved.sharedCards", "Exact-deck resolution must report 40 of 40 shared cards.");
    if (fallbackReason !== null) issue(issues, "query.fallbackReason", "Exact-deck resolution cannot claim a fallback.");
  }
  if (scope === "matchup") {
    if (!opponentLegend) issue(issues, "query.requested.opponentLegend", "Matchup resolution requires a requested opponent Legend.");
    if (resolvedDeckFingerprint !== null || sharedCards !== null || totalCards !== null) issue(issues, "query.resolved", "Matchup resolution cannot claim exact-deck similarity fields.");
    if (requestedDeckFingerprint === null && fallbackReason !== null) issue(issues, "query.fallbackReason", "A direct matchup request cannot claim a deck fallback.");
    if (requestedDeckFingerprint !== null && fallbackReason !== "deck-not-observed" && fallbackReason !== "insufficient-private-cohort") {
      issue(issues, "query.fallbackReason", "A deck request resolved to matchup must disclose why exact-deck evidence was unavailable.");
    }
  }
  if (scope === "player-legend") {
    if (resolvedDeckFingerprint !== null || sharedCards !== null || totalCards !== null) issue(issues, "query.resolved", "Player-Legend resolution cannot claim exact-deck similarity fields.");
    if (opponentLegend && fallbackReason !== "matchup-not-observed") {
      issue(issues, "query.fallbackReason", "A requested matchup resolved to Player-Legend must disclose that the matchup was not observed.");
    } else if (!opponentLegend && requestedDeckFingerprint && fallbackReason !== "deck-not-observed" && fallbackReason !== "insufficient-private-cohort") {
      issue(issues, "query.fallbackReason", "A deck-only request resolved to Player-Legend must disclose the deck fallback.");
    } else if (!opponentLegend && !requestedDeckFingerprint && fallbackReason !== null) {
      issue(issues, "query.fallbackReason", "A direct Player-Legend request cannot claim a fallback.");
    }
  }
  if (issues.length !== start || !playerLegend || !scope || targetGameNumber === null) return null;
  return {
    requested: {
      playerLegend,
      opponentLegend,
      deckFingerprint: requestedDeckFingerprint,
      priorGameResult,
      targetGameNumber
    },
    resolved: {
      scope,
      deckFingerprint: resolvedDeckFingerprint,
      sharedCards,
      totalCards
    },
    fallbackReason
  };
}

function parseSideboardLabFormatPolicy(
  raw: unknown,
  path: string,
  issues: SideboardLabValidationIssue[]
): SideboardLabFormatPolicy | null {
  const start = issues.length;
  const value = record(raw);
  if (!value) {
    issue(issues, path, "Sideboard format policy is required.");
    return null;
  }
  assertExactKeys(value, ["format", "observedRulesEpoch", "currentReference", "historicalValidation"], path, issues);
  if (value.format !== "bo3") issue(issues, `${path}.format`, "Targeted Sideboard Lab format must be bo3.");
  if (value.observedRulesEpoch !== "unknown") issue(issues, `${path}.observedRulesEpoch`, "Observed rules epoch must remain explicitly unknown.");
  if (value.historicalValidation !== "structural-only-no-retroactive-rules") issue(issues, `${path}.historicalValidation`, "Unexpected historical validation policy.");
  const reference = record(value.currentReference);
  if (!reference) issue(issues, `${path}.currentReference`, "Current format reference is required.");
  if (reference) assertExactKeys(reference, ["mainDeckCards", "sideboardMaximum", "swaps", "championChangesAllowed", "fixedSections"], `${path}.currentReference`, issues);
  if (reference?.mainDeckCards !== 40) issue(issues, `${path}.currentReference.mainDeckCards`, "Current Main Deck reference must be 40 cards.");
  if (reference?.sideboardMaximum !== 10) issue(issues, `${path}.currentReference.sideboardMaximum`, "Current sideboard reference must be 10 cards.");
  if (reference?.swaps !== "one-for-one") issue(issues, `${path}.currentReference.swaps`, "Current swaps must be one-for-one.");
  if (reference?.championChangesAllowed !== true) issue(issues, `${path}.currentReference.championChangesAllowed`, "Champion changes must be explicitly allowed.");
  const fixedSections = reference?.fixedSections;
  if (
    !Array.isArray(fixedSections)
    || fixedSections.length !== 3
    || fixedSections[0] !== "legend"
    || fixedSections[1] !== "runes"
    || fixedSections[2] !== "battlefields"
  ) issue(issues, `${path}.currentReference.fixedSections`, "Fixed sections must be legend, runes, and battlefields in canonical order.");
  if (issues.length !== start) return null;
  return {
    format: "bo3",
    observedRulesEpoch: "unknown",
    currentReference: {
      mainDeckCards: 40,
      sideboardMaximum: 10,
      swaps: "one-for-one",
      championChangesAllowed: true,
      fixedSections: ["legend", "runes", "battlefields"]
    },
    historicalValidation: "structural-only-no-retroactive-rules"
  };
}

function parseSideboardLabContext(raw: unknown, path: string, issues: SideboardLabValidationIssue[]): SideboardLabContext | null {
  const start = issues.length;
  const value = record(raw);
  if (!value) {
    issue(issues, path, "Targeted drill context is required.");
    return null;
  }
  assertExactKeys(value, ["nextInitiative", "format", "provider", "targetGameNumber"], path, issues);
  const nextInitiative = ["first", "second", "unknown"].includes(text(value.nextInitiative))
    ? value.nextInitiative as SideboardLabContext["nextInitiative"]
    : null;
  if (!nextInitiative) issue(issues, `${path}.nextInitiative`, "Next initiative must be first, second, or unknown.");
  if (value.format !== "bo3") issue(issues, `${path}.format`, "Targeted drill format must be bo3.");
  if (value.provider !== "atlas") issue(issues, `${path}.provider`, "Targeted Sideboard drills require Atlas observations.");
  if (value.targetGameNumber !== 2 && value.targetGameNumber !== 3) issue(issues, `${path}.targetGameNumber`, "Targeted Sideboard drills must describe Game 2 or Game 3.");
  if (issues.length !== start || !nextInitiative) return null;
  return { nextInitiative, format: "bo3", provider: "atlas", targetGameNumber: value.targetGameNumber as 2 | 3 };
}

function parseSideboardLabDecisionEvidence(
  raw: unknown,
  path: string,
  issues: SideboardLabValidationIssue[]
): SideboardLabDecisionEvidence | null {
  const start = issues.length;
  const value = record(raw);
  if (!value) {
    issue(issues, path, "Targeted decision evidence is required.");
    return null;
  }
  assertExactKeys(value, ["decisions", "players", "noChangeDecisions", "noChangePlayers", "noChangeRate", "swapCountHistogram", "medianCopiesMoved"], path, issues);
  const decisions = positiveInteger(value.decisions, `${path}.decisions`, issues);
  const players = positiveInteger(value.players, `${path}.players`, issues);
  const noChangeDecisions = nonNegativeInteger(value.noChangeDecisions, `${path}.noChangeDecisions`, issues);
  const noChangePlayers = nonNegativeInteger(value.noChangePlayers, `${path}.noChangePlayers`, issues);
  const noChangeRate = rate(value.noChangeRate, `${path}.noChangeRate`, issues);
  if (decisions !== null && players !== null && players > decisions) issue(issues, `${path}.players`, "Players cannot exceed decisions.");
  if (decisions !== null && noChangeDecisions !== null && noChangeDecisions > decisions) issue(issues, `${path}.noChangeDecisions`, "No-change decisions cannot exceed decisions.");
  if (players !== null && noChangePlayers !== null && noChangePlayers > players) issue(issues, `${path}.noChangePlayers`, "No-change players cannot exceed players.");
  if (noChangeDecisions !== null && noChangePlayers !== null && noChangePlayers > noChangeDecisions) issue(issues, `${path}.noChangePlayers`, "No-change players cannot exceed no-change decisions.");
  if (decisions !== null && noChangeDecisions !== null && noChangeRate !== null && !sameRate(noChangeRate, noChangeDecisions / decisions)) issue(issues, `${path}.noChangeRate`, "No-change rate must equal no-change decisions divided by decisions.");
  const histogram = parseCountHistogram(value.swapCountHistogram, path + ".swapCountHistogram", 40, 41, issues);
  const medianCopiesMoved = nullableBoundedNumber(value.medianCopiesMoved, 0, 40, `${path}.medianCopiesMoved`, issues);
  if (issues.length !== start || decisions === null || players === null || noChangeDecisions === null || noChangePlayers === null || noChangeRate === null || !histogram) return null;
  return { decisions, players, noChangeDecisions, noChangePlayers, noChangeRate, swapCountHistogram: histogram, medianCopiesMoved };
}

function parseSideboardLabPackages(
  raw: unknown,
  registry: MulliganLabRegistry,
  path: string,
  issues: SideboardLabValidationIssue[]
): SideboardLabPackage[] | null {
  if (!Array.isArray(raw)) {
    issue(issues, path, "Targeted community packages must be an array.");
    return null;
  }
  if (raw.length > 8) issue(issues, path, "Targeted community packages cannot exceed eight entries.");
  const output: SideboardLabPackage[] = [];
  raw.forEach((item, index) => {
    const value = record(item);
    const itemPath = `${path}[${index}]`;
    const start = issues.length;
    if (!value) {
      issue(issues, itemPath, "Community package must be an object.");
      return;
    }
    assertExactKeys(value, ["cardsIn", "cardsOut", "decisions", "players", "selectionRate", "evidenceStatus"], itemPath, issues);
    const cardsIn = parseSideboardLabSwapCards(value.cardsIn, registry, `${itemPath}.cardsIn`, issues);
    const cardsOut = parseSideboardLabSwapCards(value.cardsOut, registry, `${itemPath}.cardsOut`, issues);
    const decisions = positiveInteger(value.decisions, `${itemPath}.decisions`, issues);
    const players = positiveInteger(value.players, `${itemPath}.players`, issues);
    const selectionRate = rate(value.selectionRate, `${itemPath}.selectionRate`, issues);
    const evidenceStatus = value.evidenceStatus === "robust" || value.evidenceStatus === "developing" ? value.evidenceStatus : null;
    if (!evidenceStatus) issue(issues, `${itemPath}.evidenceStatus`, "Package evidence must be robust or developing.");
    if (decisions !== null && players !== null && players > decisions) issue(issues, `${itemPath}.players`, "Package players cannot exceed decisions.");
    if (issues.length === start && cardsIn && cardsOut && decisions !== null && players !== null && selectionRate !== null && evidenceStatus) {
      output.push({ cardsIn, cardsOut, decisions, players, selectionRate, evidenceStatus });
    }
  });
  return output;
}

function parseSideboardLabPairs(
  raw: unknown,
  registry: MulliganLabRegistry,
  path: string,
  issues: SideboardLabValidationIssue[]
): SideboardLabPair[] | null {
  if (!Array.isArray(raw)) {
    issue(issues, path, "Targeted community pairs must be an array.");
    return null;
  }
  if (raw.length > 12) issue(issues, path, "Targeted community pairs cannot exceed twelve entries.");
  const output: SideboardLabPair[] = [];
  raw.forEach((item, index) => {
    const value = record(item);
    const itemPath = `${path}[${index}]`;
    const start = issues.length;
    if (!value) {
      issue(issues, itemPath, "Community pair must be an object.");
      return;
    }
    assertExactKeys(value, ["cardIn", "cardOut", "decisions", "players", "selectionRate", "evidenceStatus"], itemPath, issues);
    const cardIn = registryMainDeckCard(value.cardIn, registry, `${itemPath}.cardIn`, issues);
    const cardOut = registryMainDeckCard(value.cardOut, registry, `${itemPath}.cardOut`, issues);
    const decisions = positiveInteger(value.decisions, `${itemPath}.decisions`, issues);
    const players = positiveInteger(value.players, `${itemPath}.players`, issues);
    const selectionRate = rate(value.selectionRate, `${itemPath}.selectionRate`, issues);
    const evidenceStatus = value.evidenceStatus === "robust" || value.evidenceStatus === "developing" ? value.evidenceStatus : null;
    if (!evidenceStatus) issue(issues, `${itemPath}.evidenceStatus`, "Pair evidence must be robust or developing.");
    if (decisions !== null && players !== null && players > decisions) issue(issues, `${itemPath}.players`, "Pair players cannot exceed decisions.");
    if (issues.length === start && cardIn && cardOut && decisions !== null && players !== null && selectionRate !== null && evidenceStatus) {
      output.push({ cardIn, cardOut, decisions, players, selectionRate, evidenceStatus });
    }
  });
  return output;
}

function validateSideboardLabTargetDecisionEvidence(
  evidence: SideboardLabDecisionEvidence,
  drillDecisions: number,
  drillPlayers: number,
  path: string,
  issues: SideboardLabValidationIssue[]
) {
  if (evidence.decisions !== drillDecisions) issue(issues, `${path}.decisions`, "Decision evidence must use the drill decision denominator.");
  if (evidence.players !== drillPlayers) issue(issues, `${path}.players`, "Decision evidence must use the drill player denominator.");
  const histogramDecisions = evidence.swapCountHistogram.reduce((sum, entry) => sum + entry.decisions, 0);
  if (histogramDecisions !== evidence.decisions) issue(issues, `${path}.swapCountHistogram`, "Swap-count histogram decisions must add up to the decision denominator.");
  const noChangeBucket = evidence.swapCountHistogram.find((entry) => entry.copies === 0);
  if ((noChangeBucket?.decisions ?? 0) !== evidence.noChangeDecisions) issue(issues, `${path}.swapCountHistogram`, "The zero-swap bucket must match no-change decisions.");
  if ((noChangeBucket?.players ?? 0) !== evidence.noChangePlayers) issue(issues, `${path}.swapCountHistogram`, "The zero-swap bucket must match no-change players.");
}

function validateSideboardLabTargetPackages(
  packages: SideboardLabPackage[],
  mainDeck: SideboardLabDeckCard[],
  sideboard: SideboardLabDeckCard[],
  decisionEvidence: SideboardLabDecisionEvidence,
  path: string,
  issues: SideboardLabValidationIssue[]
) {
  const availableMain = deckIdentityQuantities(mainDeck);
  const availableSideboard = deckIdentityQuantities(sideboard);
  packages.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const cardsIn = item.cardsIn.reduce((sum, card) => sum + card.count, 0);
    const cardsOut = item.cardsOut.reduce((sum, card) => sum + card.count, 0);
    if (!cardsIn || !cardsOut || cardsIn !== cardsOut) issue(issues, itemPath, "Community packages must contain a non-empty, one-for-one swap plan.");
    validatePackageZone(item.cardsIn, availableSideboard, `${itemPath}.cardsIn`, issues);
    validatePackageZone(item.cardsOut, availableMain, `${itemPath}.cardsOut`, issues);
    if (item.players > decisionEvidence.players) issue(issues, `${itemPath}.players`, "Package players cannot exceed the drill player denominator.");
    if (item.decisions > decisionEvidence.decisions) issue(issues, `${itemPath}.decisions`, "Package decisions cannot exceed the drill decision denominator.");
    if (!sameRate(item.selectionRate, item.decisions / decisionEvidence.decisions)) issue(issues, `${itemPath}.selectionRate`, "Package selection rate must equal package decisions divided by drill decisions.");
  });
}

function validateSideboardLabTargetPairs(
  pairs: SideboardLabPair[],
  mainDeck: SideboardLabDeckCard[],
  sideboard: SideboardLabDeckCard[],
  decisionEvidence: SideboardLabDecisionEvidence,
  path: string,
  issues: SideboardLabValidationIssue[]
) {
  const availableMain = deckIdentityQuantities(mainDeck);
  const availableSideboard = deckIdentityQuantities(sideboard);
  pairs.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!availableSideboard.has(riftboundBasePrintCode(item.cardIn.code))) issue(issues, `${itemPath}.cardIn`, "Paired incoming card is not registered in the Sideboard.");
    if (!availableMain.has(riftboundBasePrintCode(item.cardOut.code))) issue(issues, `${itemPath}.cardOut`, "Paired outgoing card is not registered in the Main Deck.");
    if (item.players > decisionEvidence.players) issue(issues, `${itemPath}.players`, "Pair players cannot exceed the drill player denominator.");
    if (item.decisions > decisionEvidence.decisions) issue(issues, `${itemPath}.decisions`, "Pair decisions cannot exceed the drill decision denominator.");
    if (!sameRate(item.selectionRate, item.decisions / decisionEvidence.decisions)) issue(issues, `${itemPath}.selectionRate`, "Pair selection rate must equal pair decisions divided by drill decisions.");
  });
}

function deckIdentityQuantities(cards: SideboardLabDeckCard[]): Map<string, number> {
  const output = new Map<string, number>();
  for (const card of cards) {
    const identity = riftboundBasePrintCode(card.code);
    output.set(identity, (output.get(identity) ?? 0) + card.count);
  }
  return output;
}

function validatePackageZone(
  cards: SideboardLabDeckCard[],
  available: ReadonlyMap<string, number>,
  path: string,
  issues: SideboardLabValidationIssue[]
) {
  const selected = deckIdentityQuantities(cards);
  for (const [identity, count] of selected) {
    const registered = available.get(identity) ?? 0;
    if (!registered) issue(issues, path, `${identity} is not registered in the required source zone.`);
    else if (count > registered) issue(issues, path, `${identity} moves more copies than are registered in the required source zone.`);
  }
}

function parseSideboardLabSwapCards(
  raw: unknown,
  registry: MulliganLabRegistry,
  path: string,
  issues: SideboardLabValidationIssue[]
): SideboardLabDeckCard[] | null {
  if (!Array.isArray(raw)) {
    issue(issues, path, "Package cards must be an array.");
    return null;
  }
  if (raw.length > 40) issue(issues, path, "Package cards cannot exceed 40 entries.");
  const output: SideboardLabDeckCard[] = [];
  raw.forEach((item, index) => {
    const value = record(item);
    const itemPath = `${path}[${index}]`;
    if (!value) issue(issues, itemPath, "Package card must be an object.");
    if (value) assertExactKeys(value, ["cardCode", "name", "count"], itemPath, issues);
    const code = strictCode(value?.cardCode, `${itemPath}.cardCode`, issues);
    const card = code ? registry.byCode.get(code) : undefined;
    if (!card) issue(issues, `${itemPath}.cardCode`, "Package card is not in RiftLite's packaged registry.");
    const name = text(value?.name);
    if (!name || card?.name !== name) issue(issues, `${itemPath}.name`, "Package card name must match its registered print.");
    const count = positiveInteger(value?.count, `${itemPath}.count`, issues);
    if (count !== null && count > 3) issue(issues, `${itemPath}.count`, "A package card cannot exceed three copies.");
    if (card && count !== null && count <= 3) output.push({ ...card, count });
  });
  return output;
}

function parseSideboardLabQuantityEvidence(
  raw: unknown,
  path: string,
  issues: SideboardLabValidationIssue[]
): SideboardLabQuantityEvidence | null {
  const start = issues.length;
  const value = record(raw);
  if (!value) {
    issue(issues, path, "Targeted quantity evidence is required.");
    return null;
  }
  assertExactKeys(value, ["histogram", "selectedMedianCopies", "status"], path, issues);
  const histogram = parseCountHistogram(value.histogram, `${path}.histogram`, 3, 4, issues);
  const selectedMedianCopies = nullableBoundedNumber(value.selectedMedianCopies, 1, 3, `${path}.selectedMedianCopies`, issues);
  const status = ["robust", "developing", "limited"].includes(text(value.status))
    ? value.status as SideboardLabCardEvidenceStatus
    : null;
  if (!status) issue(issues, `${path}.status`, "Quantity evidence status must be robust, developing, or limited.");
  if (issues.length !== start || !histogram || !status) return null;
  return { histogram, selectedMedianCopies, status };
}

function validateSideboardLabQuantityEvidence(
  quantity: SideboardLabQuantityEvidence,
  opportunities: number,
  selected: number,
  selectedCopies: number,
  path: string,
  issues: SideboardLabValidationIssue[]
) {
  const histogramDecisions = quantity.histogram.reduce((sum, entry) => sum + entry.decisions, 0);
  const histogramSelected = quantity.histogram
    .filter((entry) => entry.copies > 0)
    .reduce((sum, entry) => sum + entry.decisions, 0);
  const histogramCopies = quantity.histogram.reduce((sum, entry) => sum + entry.copies * entry.decisions, 0);
  if (histogramDecisions !== opportunities) issue(issues, `${path}.histogram`, "Quantity histogram decisions must add up to card opportunities.");
  if (histogramSelected !== selected) issue(issues, `${path}.histogram`, "Positive-copy histogram decisions must match selected decisions.");
  if (histogramCopies !== selectedCopies) issue(issues, `${path}.histogram`, "Quantity histogram copies must match selected copies.");
  if ((selected === 0) !== (quantity.selectedMedianCopies === null)) issue(issues, `${path}.selectedMedianCopies`, "Selected-copy median must be null exactly when no decisions selected the card.");
}

function parseSideboardLabPeriodEvidence(
  raw: unknown,
  path: string,
  issues: SideboardLabValidationIssue[]
): SideboardLabPeriodEvidence | null {
  const start = issues.length;
  const value = record(raw);
  if (!value) {
    issue(issues, path, "Targeted period evidence is required.");
    return null;
  }
  assertExactKeys(value, ["preseason", "currentSeason"], path, issues);
  const preseason = value.preseason === null
    ? null
    : parseSideboardLabEvidenceSlice(value.preseason, `${path}.preseason`, issues);
  const currentSeason = value.currentSeason === null
    ? null
    : parseSideboardLabEvidenceSlice(value.currentSeason, `${path}.currentSeason`, issues);
  if (issues.length !== start) return null;
  return { preseason, currentSeason };
}

function parseSideboardLabEvidenceSlice(
  raw: unknown,
  path: string,
  issues: SideboardLabValidationIssue[]
): SideboardLabEvidenceSlice | null {
  const start = issues.length;
  const value = record(raw);
  if (!value) {
    issue(issues, path, "Period evidence slice must be an object or null.");
    return null;
  }
  assertExactKeys(value, [
    "opportunities",
    "players",
    "selected",
    "selectedCopies",
    "guidancePlayers",
    "guidanceSelected",
    "guidanceSelectionRate",
    "guidance",
    "evidenceStatus"
  ], path, issues);
  const opportunities = positiveInteger(value.opportunities, `${path}.opportunities`, issues);
  const players = positiveInteger(value.players, `${path}.players`, issues);
  const selected = nonNegativeInteger(value.selected, `${path}.selected`, issues);
  const selectedCopies = nonNegativeInteger(value.selectedCopies, `${path}.selectedCopies`, issues);
  const guidancePlayers = positiveInteger(value.guidancePlayers, `${path}.guidancePlayers`, issues);
  const guidanceSelected = nonNegativeInteger(value.guidanceSelected, `${path}.guidanceSelected`, issues);
  const guidanceSelectionRate = rate(value.guidanceSelectionRate, `${path}.guidanceSelectionRate`, issues);
  const guidance = ["strong_select", "select", "mixed", "avoid", "strong_avoid", "unclear"].includes(text(value.guidance))
    ? value.guidance as SideboardLabCardGuidance
    : null;
  if (!guidance) issue(issues, `${path}.guidance`, "Unknown period community guidance.");
  const evidenceStatus = ["robust", "developing", "limited"].includes(text(value.evidenceStatus))
    ? value.evidenceStatus as SideboardLabCardEvidenceStatus
    : null;
  if (!evidenceStatus) issue(issues, `${path}.evidenceStatus`, "Unknown period evidence status.");
  if (opportunities !== null && players !== null && players > opportunities) issue(issues, `${path}.players`, "Slice players cannot exceed opportunities.");
  if (opportunities !== null && selected !== null && selected > opportunities) issue(issues, `${path}.selected`, "Slice selections cannot exceed opportunities.");
  if (selected !== null && selectedCopies !== null && selectedCopies > selected * 3) issue(issues, `${path}.selectedCopies`, "Slice selected copies cannot exceed three per selection.");
  if (players !== null && guidancePlayers !== null && guidancePlayers > players) issue(issues, `${path}.guidancePlayers`, "Slice guidance players cannot exceed players.");
  if (guidancePlayers !== null && guidanceSelected !== null && guidanceSelected > guidancePlayers) issue(issues, `${path}.guidanceSelected`, "Slice selected guidance cannot exceed guidance players.");
  if (guidancePlayers !== null && guidanceSelected !== null && guidanceSelectionRate !== null && !sameRate(guidanceSelectionRate, guidanceSelected / guidancePlayers)) issue(issues, `${path}.guidanceSelectionRate`, "Slice guidance rate must equal its privacy-gated counts.");
  if (
    issues.length !== start || opportunities === null || players === null || selected === null
    || selectedCopies === null || guidancePlayers === null || guidanceSelected === null
    || guidanceSelectionRate === null || !guidance || !evidenceStatus
  ) return null;
  return {
    opportunities,
    players,
    selected,
    selectedCopies,
    guidancePlayers,
    guidanceSelected,
    guidanceSelectionRate,
    guidance,
    evidenceStatus
  };
}

function parseCountHistogram(
  raw: unknown,
  path: string,
  maximumCopies: number,
  maximumEntries: number,
  issues: SideboardLabValidationIssue[]
): Array<{ copies: number; decisions: number; players: number }> | null {
  if (!Array.isArray(raw)) {
    issue(issues, path, "Histogram must be an array.");
    return null;
  }
  if (raw.length < 1 || raw.length > maximumEntries) issue(issues, path, `Histogram must contain between 1 and ${maximumEntries} entries.`);
  const seenCopies = new Set<number>();
  const output: Array<{ copies: number; decisions: number; players: number }> = [];
  raw.forEach((item, index) => {
    const value = record(item);
    const itemPath = `${path}[${index}]`;
    if (!value) issue(issues, itemPath, "Histogram entry must be an object.");
    if (value) assertExactKeys(value, ["copies", "decisions", "players"], itemPath, issues);
    const copies = boundedInteger(value?.copies, 0, maximumCopies, `${itemPath}.copies`, issues);
    const decisions = positiveInteger(value?.decisions, `${itemPath}.decisions`, issues);
    const players = positiveInteger(value?.players, `${itemPath}.players`, issues);
    if (decisions !== null && players !== null && players > decisions) issue(issues, `${itemPath}.players`, "Histogram players cannot exceed decisions.");
    if (copies !== null && seenCopies.has(copies)) issue(issues, `${itemPath}.copies`, "Histogram copy counts must be unique.");
    if (copies !== null) seenCopies.add(copies);
    if (copies !== null && decisions !== null && players !== null) output.push({ copies, decisions, players });
  });
  return output;
}

function parseDrill(
  raw: unknown,
  index: number,
  registry: MulliganLabRegistry,
  seenIds: Set<string>,
  issues: SideboardLabValidationIssue[],
  targeted = false
): SideboardLabApiDrill | null {
  const value = record(raw);
  const prefix = `drills[${index}]`;
  if (!value) {
    issue(issues, prefix, "Drill must be an object.");
    return null;
  }
  assertExactKeys(
    value,
    targeted
      ? ["id", "matchup", "priorGameResult", "deck", "evidence", "cardEvidence", "context", "decisionEvidence", "packages", "pairs"]
      : ["id", "matchup", "priorGameResult", "deck", "evidence", "cardEvidence"],
    prefix,
    issues
  );
  const id = text(value.id);
  if (!/^sl1_[a-f0-9]{32}$/.test(id)) issue(issues, `${prefix}.id`, "Drill id is not a canonical opaque Sideboard Lab id.");
  if (seenIds.has(id)) issue(issues, `${prefix}.id`, "Duplicate drill id.");
  seenIds.add(id);
  const matchup = record(value.matchup);
  if (!matchup) issue(issues, `${prefix}.matchup`, "Matchup is required.");
  if (matchup) assertExactKeys(matchup, ["playerLegend", "opponentLegend"], `${prefix}.matchup`, issues);
  const playerLegend = registryCard(matchup?.playerLegend, registry, "Legend", `${prefix}.matchup.playerLegend`, issues);
  const opponentLegend = registryCard(matchup?.opponentLegend, registry, "Legend", `${prefix}.matchup.opponentLegend`, issues);
  const priorGameResult = value.priorGameResult === "win" || value.priorGameResult === "loss" ? value.priorGameResult : null;
  if (!priorGameResult) issue(issues, `${prefix}.priorGameResult`, "Prior Game result must be win or loss.");

  const deckValue = record(value.deck);
  if (!deckValue) issue(issues, `${prefix}.deck`, "Registered deck is required.");
  if (deckValue) assertExactKeys(deckValue, ["fingerprint", "chosenChampionCode", "mainDeck", "sideboard"], `${prefix}.deck`, issues);
  const fingerprint = text(deckValue?.fingerprint);
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) issue(issues, `${prefix}.deck.fingerprint`, "Deck fingerprint must be a SHA-256 hex digest.");
  const mainDeck = parseDeckCards(deckValue?.mainDeck, registry, `${prefix}.deck.mainDeck`, issues);
  const sideboard = parseDeckCards(deckValue?.sideboard, registry, `${prefix}.deck.sideboard`, issues);
  const chosenChampionCode = deckValue?.chosenChampionCode === undefined || deckValue?.chosenChampionCode === null
    ? null
    : strictCode(deckValue.chosenChampionCode, `${prefix}.deck.chosenChampionCode`, issues);
  const mainCount = mainDeck.reduce((sum, card) => sum + card.count, 0);
  const sideboardCount = sideboard.reduce((sum, card) => sum + card.count, 0);
  if (mainCount !== 40) issue(issues, `${prefix}.deck.mainDeck`, "Registered Main Deck must contain exactly 40 cards, including the Chosen Champion.");
  if (sideboardCount < 1 || sideboardCount > SIDEBOARD_LAB_MAX_SIDEBOARD_CARDS) issue(issues, `${prefix}.deck.sideboard`, `Registered sideboard must contain between 1 and ${SIDEBOARD_LAB_MAX_SIDEBOARD_CARDS} cards for this API version.`);
  if (fingerprint && mainDeck.length && sideboard.length && fingerprint !== sideboardLabDeckFingerprint(mainDeck, sideboard)) issue(issues, `${prefix}.deck.fingerprint`, "Fingerprint does not match the canonical registered Main Deck and sideboard.");
  validateCombinedCopyLimits(mainDeck, sideboard, `${prefix}.deck`, issues);
  if (chosenChampionCode) {
    const chosen = mainDeck.find((card) => card.code === chosenChampionCode);
    if (!chosen || chosen.count !== 1 || chosen.supertype?.toLowerCase() !== "champion") {
      issue(issues, `${prefix}.deck.chosenChampionCode`, "Chosen Champion must identify one registered Champion copy.");
    }
  }

  const evidenceValue = record(value.evidence);
  if (!evidenceValue) issue(issues, `${prefix}.evidence`, "Drill evidence metadata is required.");
  if (evidenceValue) assertExactKeys(evidenceValue, [
    "status",
    "scope",
    "deckScope",
    "guidanceBasis",
    "outcomeInterpretation",
    "playerLegendIdentityCode",
    "opponentLegendIdentityCode",
    "decisions",
    "players"
  ], `${prefix}.evidence`, issues);
  const status = evidenceValue?.status === "sufficient" || evidenceValue?.status === "early" ? evidenceValue.status : null;
  if (!status) issue(issues, `${prefix}.evidence.status`, "Evidence status must be sufficient or early.");
  if (evidenceValue?.scope !== "matchup") issue(issues, `${prefix}.evidence.scope`, "Sideboard Lab evidence must use the full oriented matchup.");
  if (evidenceValue?.deckScope !== "all-observed-decks") issue(issues, `${prefix}.evidence.deckScope`, "Evidence must pool every observed deck in the matchup.");
  if (evidenceValue?.guidanceBasis !== "community-selection-rate") issue(issues, `${prefix}.evidence.guidanceBasis`, "Guidance must use community selection rates.");
  if (evidenceValue?.outcomeInterpretation !== "descriptive-not-causal") issue(issues, `${prefix}.evidence.outcomeInterpretation`, "Outcomes must be descriptive, not causal.");
  const playerLegendIdentityCode = canonicalCode(evidenceValue?.playerLegendIdentityCode);
  const opponentLegendIdentityCode = canonicalCode(evidenceValue?.opponentLegendIdentityCode);
  if (playerLegend && playerLegendIdentityCode !== riftboundBasePrintCode(playerLegend.code)) issue(issues, `${prefix}.evidence.playerLegendIdentityCode`, "Player Legend identity does not match its official print.");
  if (opponentLegend && opponentLegendIdentityCode !== riftboundBasePrintCode(opponentLegend.code)) issue(issues, `${prefix}.evidence.opponentLegendIdentityCode`, "Opponent Legend identity does not match its official print.");
  const decisions = positiveInteger(evidenceValue?.decisions, `${prefix}.evidence.decisions`, issues);
  const players = positiveInteger(evidenceValue?.players, `${prefix}.evidence.players`, issues);
  if (decisions !== null && players !== null && players > decisions) issue(issues, `${prefix}.evidence.players`, "Players cannot exceed decisions.");
  if (status === "sufficient" && (decisions === null || players === null || decisions < SIDEBOARD_LAB_MIN_DECISIONS || players < SIDEBOARD_LAB_MIN_PLAYERS)) {
    issue(issues, `${prefix}.evidence.status`, "Sufficient evidence cannot be published below the decision and player gates.");
  }
  if (status === "early" && decisions !== null && players !== null && decisions >= SIDEBOARD_LAB_MIN_DECISIONS && players >= SIDEBOARD_LAB_MIN_PLAYERS) {
    issue(issues, `${prefix}.evidence.status`, "Evidence meeting both gates must be marked sufficient.");
  }

  const cardEvidence = parseCardEvidence(value.cardEvidence, registry, `${prefix}.cardEvidence`, issues, targeted);
  validateEvidenceCoverage(mainDeck, sideboard, cardEvidence, `${prefix}.cardEvidence`, issues);
  const context = targeted ? parseSideboardLabContext(value.context, `${prefix}.context`, issues) : undefined;
  const decisionEvidence = targeted
    ? parseSideboardLabDecisionEvidence(value.decisionEvidence, `${prefix}.decisionEvidence`, issues)
    : undefined;
  const packages = targeted
    ? parseSideboardLabPackages(value.packages, registry, `${prefix}.packages`, issues)
    : undefined;
  const pairs = targeted
    ? parseSideboardLabPairs(value.pairs, registry, `${prefix}.pairs`, issues)
    : undefined;
  if (targeted && decisionEvidence && decisions !== null && players !== null) {
    validateSideboardLabTargetDecisionEvidence(decisionEvidence, decisions, players, `${prefix}.decisionEvidence`, issues);
  }
  if (targeted && packages && decisionEvidence) {
    validateSideboardLabTargetPackages(packages, mainDeck, sideboard, decisionEvidence, `${prefix}.packages`, issues);
  }
  if (targeted && pairs && decisionEvidence) {
    validateSideboardLabTargetPairs(pairs, mainDeck, sideboard, decisionEvidence, `${prefix}.pairs`, issues);
  }
  if (!playerLegend || !opponentLegend || !priorGameResult || !status || decisions === null || players === null || issues.length) return null;
  return {
    id,
    source: "community",
    playerLegend,
    opponentLegend,
    priorGameResult,
    deck: { fingerprint, ...(chosenChampionCode ? { chosenChampionCode } : {}), mainDeck, sideboard },
    evidence: {
      status,
      scope: "matchup",
      deckScope: "all-observed-decks",
      guidanceBasis: "community-selection-rate",
      outcomeInterpretation: "descriptive-not-causal",
      playerLegendIdentityCode,
      opponentLegendIdentityCode,
      decisions,
      players
    },
    cardEvidence,
    ...(targeted && context && decisionEvidence && packages && pairs ? { context, decisionEvidence, packages, pairs } : {})
  };
}

function parseDeckCards(raw: unknown, registry: MulliganLabRegistry, path: string, issues: SideboardLabValidationIssue[]): SideboardLabDeckCard[] {
  if (!Array.isArray(raw)) {
    issue(issues, path, "Deck section must be an array.");
    return [];
  }
  const isMainDeck = path.endsWith(".mainDeck");
  const minimumEntries = isMainDeck ? 14 : 1;
  if (raw.length < minimumEntries || raw.length > 40) {
    issue(issues, path, `${isMainDeck ? "Main Deck" : "Sideboard"} must contain between ${minimumEntries} and 40 distinct card entries.`);
  }
  const seen = new Set<string>();
  const cards: SideboardLabDeckCard[] = [];
  raw.forEach((item, index) => {
    const value = record(item);
    const cardPath = `${path}[${index}]`;
    if (!value) issue(issues, cardPath, "Deck card must be an object.");
    if (value) assertExactKeys(value, ["cardCode", "name", "count"], cardPath, issues);
    const code = strictCode(value?.cardCode, `${cardPath}.cardCode`, issues);
    const card = code ? registry.byCode.get(code) : undefined;
    if (!card) issue(issues, `${cardPath}.cardCode`, "Card print is not in RiftLite's packaged registry.");
    if (card && ["legend", "battlefield", "rune"].includes(card.type.toLowerCase())) issue(issues, `${cardPath}.cardCode`, "Deck sections can contain only valid Main Deck cards.");
    const name = text(value?.name);
    if (!name || card?.name !== name) issue(issues, `${cardPath}.name`, "Card name must match its registered print.");
    const count = positiveInteger(value?.count, `${cardPath}.count`, issues);
    if (count !== null && count > 3) issue(issues, `${cardPath}.count`, "A deck entry cannot exceed three copies.");
    if (seen.has(code)) issue(issues, `${cardPath}.cardCode`, "Duplicate card print in deck section.");
    seen.add(code);
    if (card && count !== null && count <= 3) cards.push({ ...card, count });
  });
  return cards;
}

function parseCardEvidence(
  raw: unknown,
  registry: MulliganLabRegistry,
  path: string,
  issues: SideboardLabValidationIssue[],
  targeted = false
): SideboardLabCardEvidence[] {
  if (!Array.isArray(raw)) {
    issue(issues, path, "Card evidence must be an array.");
    return [];
  }
  if (raw.length < 1 || raw.length > 80) issue(issues, path, "Card evidence must contain between 1 and 80 entries.");
  const seen = new Set<string>();
  const output: SideboardLabCardEvidence[] = [];
  raw.forEach((item, index) => {
    const value = record(item);
    const itemPath = `${path}[${index}]`;
    if (!value) issue(issues, itemPath, "Card evidence entry must be an object.");
    if (value) assertExactKeys(value, [
      "cardCode",
      "identityCode",
      "name",
      "direction",
      "scope",
      "scopeDecisions",
      "scopePlayers",
      "opportunities",
      "players",
      "selected",
      "selectedPlayers",
      "selectedCopies",
      "selectedWins",
      "notSelectedWins",
      "selectionRate",
      "baselineSelectionRate",
      "guidancePlayers",
      "guidanceSelected",
      "guidanceSelectionRate",
      "selectedWinRate",
      "notSelectedWinRate",
      "winRateDelta",
      "guidance",
      "evidenceStatus",
      "outcomeStatus",
      ...(targeted ? ["quantity", "periods"] : [])
    ], itemPath, issues);
    const cardCode = strictCode(value?.cardCode, `${itemPath}.cardCode`, issues);
    const card = cardCode ? registry.byCode.get(cardCode) : undefined;
    if (!card) issue(issues, `${itemPath}.cardCode`, "Evidence card is not in RiftLite's packaged registry.");
    const identityCode = strictCode(value?.identityCode, `${itemPath}.identityCode`, issues);
    if (card && identityCode !== riftboundBasePrintCode(card.code)) issue(issues, `${itemPath}.identityCode`, "Evidence identity must match the official card print.");
    const name = text(value?.name);
    if (!name || card?.name !== name) issue(issues, `${itemPath}.name`, "Evidence name must match its registered print.");
    const direction = value?.direction === "in" || value?.direction === "out" ? value.direction : null;
    if (!direction) issue(issues, `${itemPath}.direction`, "Direction must be in or out.");
    const scope = value?.scope === "matchup" || value?.scope === "player-legend" ? value.scope : null;
    if (!scope) issue(issues, `${itemPath}.scope`, "Evidence scope must be matchup or player-legend.");
    const scopeDecisions = positiveInteger(value?.scopeDecisions, `${itemPath}.scopeDecisions`, issues);
    const scopePlayers = positiveInteger(value?.scopePlayers, `${itemPath}.scopePlayers`, issues);
    const opportunities = positiveInteger(value?.opportunities, `${itemPath}.opportunities`, issues);
    const players = positiveInteger(value?.players, `${itemPath}.players`, issues);
    const selected = nonNegativeInteger(value?.selected, `${itemPath}.selected`, issues);
    const selectedPlayers = nonNegativeInteger(value?.selectedPlayers, `${itemPath}.selectedPlayers`, issues);
    const guidancePlayers = positiveInteger(value?.guidancePlayers, `${itemPath}.guidancePlayers`, issues);
    const guidanceSelected = nonNegativeInteger(value?.guidanceSelected, `${itemPath}.guidanceSelected`, issues);
    const selectedCopies = nonNegativeInteger(value?.selectedCopies, `${itemPath}.selectedCopies`, issues);
    const selectedWins = nonNegativeInteger(value?.selectedWins, `${itemPath}.selectedWins`, issues);
    const notSelectedWins = nonNegativeInteger(value?.notSelectedWins, `${itemPath}.notSelectedWins`, issues);
    const selectionRate = rate(value?.selectionRate, `${itemPath}.selectionRate`, issues);
    const baselineSelectionRate = rate(value?.baselineSelectionRate, `${itemPath}.baselineSelectionRate`, issues);
    const guidanceSelectionRate = rate(value?.guidanceSelectionRate, `${itemPath}.guidanceSelectionRate`, issues);
    const selectedWinRate = nullableRate(value?.selectedWinRate, `${itemPath}.selectedWinRate`, issues);
    const notSelectedWinRate = nullableRate(value?.notSelectedWinRate, `${itemPath}.notSelectedWinRate`, issues);
    const winRateDelta = nullableSignedRate(value?.winRateDelta, `${itemPath}.winRateDelta`, issues);
    const guidance = ["strong_select", "select", "mixed", "avoid", "strong_avoid", "unclear"].includes(text(value?.guidance)) ? value?.guidance as SideboardLabCardGuidance : null;
    if (!guidance) issue(issues, `${itemPath}.guidance`, "Unknown community selection guidance.");
    const evidenceStatus = ["robust", "developing", "limited"].includes(text(value?.evidenceStatus)) ? value?.evidenceStatus as SideboardLabCardEvidenceStatus : null;
    if (!evidenceStatus) issue(issues, `${itemPath}.evidenceStatus`, "Unknown card evidence status.");
    const outcomeStatus = ["comparable", "one_sided", "sparse"].includes(text(value?.outcomeStatus)) ? value?.outcomeStatus as SideboardLabCardOutcomeStatus : null;
    if (!outcomeStatus) issue(issues, `${itemPath}.outcomeStatus`, "Unknown card outcome status.");
    const quantity = targeted ? parseSideboardLabQuantityEvidence(value?.quantity, `${itemPath}.quantity`, issues) : undefined;
    const periods = targeted ? parseSideboardLabPeriodEvidence(value?.periods, `${itemPath}.periods`, issues) : undefined;
    if (scopeDecisions !== null && opportunities !== null && opportunities > scopeDecisions) issue(issues, `${itemPath}.opportunities`, "Opportunities cannot exceed scope decisions.");
    if (scopePlayers !== null && players !== null && players > scopePlayers) issue(issues, `${itemPath}.players`, "Players cannot exceed scope players.");
    if (opportunities !== null && players !== null && players > opportunities) issue(issues, `${itemPath}.players`, "Players cannot exceed opportunities.");
    if (opportunities !== null && selected !== null && selected > opportunities) issue(issues, `${itemPath}.selected`, "Selected decisions cannot exceed opportunities.");
    if (players !== null && selectedPlayers !== null && selectedPlayers > players) issue(issues, `${itemPath}.selectedPlayers`, "Selected players cannot exceed players.");
    if (selected !== null && selectedPlayers !== null && selectedPlayers > selected) issue(issues, `${itemPath}.selectedPlayers`, "Selected players cannot exceed selected decisions.");
    if (selected !== null && selectedCopies !== null && selectedCopies > selected * 3) issue(issues, `${itemPath}.selectedCopies`, "Selected copies cannot exceed three per selecting decision.");
    if (guidancePlayers !== null && guidanceSelected !== null && guidanceSelected > guidancePlayers) issue(issues, `${itemPath}.guidanceSelected`, "Balanced selected votes cannot exceed balanced players.");
    if (selected !== null && selectedWins !== null && selectedWins > selected) issue(issues, `${itemPath}.selectedWins`, "Selected wins cannot exceed selected decisions.");
    if (opportunities !== null && selected !== null && notSelectedWins !== null && notSelectedWins > opportunities - selected) issue(issues, `${itemPath}.notSelectedWins`, "Non-selected wins cannot exceed non-selected decisions.");
    const notSelected = opportunities !== null && selected !== null ? opportunities - selected : null;
    if (selected !== null && ((selected === 0) !== (selectedWinRate === null))) issue(issues, `${itemPath}.selectedWinRate`, "Selected win rate must be null exactly when no decisions selected the card.");
    if (notSelected !== null && ((notSelected === 0) !== (notSelectedWinRate === null))) issue(issues, `${itemPath}.notSelectedWinRate`, "Non-selected win rate must be null exactly when every decision selected the card.");
    if (selected !== null && notSelected !== null && ((selected === 0 || notSelected === 0) !== (winRateDelta === null))) issue(issues, `${itemPath}.winRateDelta`, "Win-rate delta requires both decision branches.");
    if (opportunities !== null && selected !== null && selectionRate !== null && !sameRate(selectionRate, selected / opportunities)) issue(issues, `${itemPath}.selectionRate`, "Selection rate must equal selected decisions divided by opportunities.");
    if (guidancePlayers !== null && guidanceSelected !== null && guidanceSelectionRate !== null && !sameRate(guidanceSelectionRate, guidanceSelected / guidancePlayers)) issue(issues, `${itemPath}.guidanceSelectionRate`, "Contributor-balanced rate must equal selected contributors divided by contributors.");
    if (selected !== null && selected > 0 && selectedWins !== null && selectedWinRate !== null && !sameRate(selectedWinRate, selectedWins / selected)) issue(issues, `${itemPath}.selectedWinRate`, "Selected win rate must equal selected wins divided by selected decisions.");
    if (notSelected !== null && notSelected > 0 && notSelectedWins !== null && notSelectedWinRate !== null && !sameRate(notSelectedWinRate, notSelectedWins / notSelected)) issue(issues, `${itemPath}.notSelectedWinRate`, "Non-selected win rate must equal wins divided by non-selected decisions.");
    if (winRateDelta !== null && selectedWinRate !== null && notSelectedWinRate !== null && !sameRate(winRateDelta, selectedWinRate - notSelectedWinRate)) issue(issues, `${itemPath}.winRateDelta`, "Win-rate delta must equal the published branch-rate difference.");
    if (targeted && quantity && opportunities !== null && selected !== null && selectedCopies !== null) {
      validateSideboardLabQuantityEvidence(quantity, opportunities, selected, selectedCopies, `${itemPath}.quantity`, issues);
    }
    const key = direction ? sideboardLabEvidenceKey(direction, cardCode) : "";
    if (key && seen.has(key)) issue(issues, itemPath, "Duplicate directional card evidence.");
    if (key) seen.add(key);
    if (card && direction && scope && scopeDecisions !== null && scopePlayers !== null && opportunities !== null && players !== null && selected !== null && selectedPlayers !== null && selectedCopies !== null && selectionRate !== null && baselineSelectionRate !== null && guidancePlayers !== null && guidanceSelected !== null && guidanceSelectionRate !== null && selectedWins !== null && notSelectedWins !== null && guidance && evidenceStatus && outcomeStatus) {
      output.push({
        cardCode,
        identityCode,
        name,
        direction,
        scope,
        scopeDecisions,
        scopePlayers,
        opportunities,
        players,
        selected,
        selectedPlayers,
        selectedCopies,
        selectionRate,
        baselineSelectionRate,
        guidancePlayers,
        guidanceSelected,
        guidanceSelectionRate,
        selectedWins,
        notSelectedWins,
        selectedWinRate,
        notSelectedWinRate,
        winRateDelta,
        guidance,
        evidenceStatus,
        outcomeStatus,
        ...(targeted && quantity && periods ? { quantity, periods } : {})
      });
    }
  });
  return output;
}

function validateEvidenceCoverage(mainDeck: SideboardLabDeckCard[], sideboard: SideboardLabDeckCard[], evidence: SideboardLabCardEvidence[], path: string, issues: SideboardLabValidationIssue[]) {
  const expected = new Set([
    ...mainDeck.map((card) => sideboardLabEvidenceKey("out", card.code)),
    ...sideboard.map((card) => sideboardLabEvidenceKey("in", card.code))
  ]);
  const actual = new Set(evidence.map((item) => sideboardLabEvidenceKey(item.direction, item.cardCode)));
  for (const key of expected) if (!actual.has(key)) issue(issues, path, `Missing directional evidence for ${key}.`);
  for (const key of actual) if (!expected.has(key)) issue(issues, path, `Evidence ${key} does not correspond to an available registered card.`);
}

function validateCombinedCopyLimits(mainDeck: SideboardLabDeckCard[], sideboard: SideboardLabDeckCard[], path: string, issues: SideboardLabValidationIssue[]) {
  const copies = new Map<string, number>();
  for (const card of [...mainDeck, ...sideboard]) {
    const identity = riftboundBasePrintCode(card.code);
    copies.set(identity, (copies.get(identity) ?? 0) + card.count);
  }
  for (const [identityCode, count] of copies) if (count > 3) issue(issues, path, `${identityCode} exceeds three combined Main Deck and sideboard copies across alternate prints.`);
}

function registryCard(raw: unknown, registry: MulliganLabRegistry, expectedType: string, path: string, issues: SideboardLabValidationIssue[]): MulliganLabRegistryCard | null {
  const value = record(raw);
  if (!value) issue(issues, path, `${expectedType} must be an object.`);
  if (value) assertExactKeys(value, ["cardCode", "name"], path, issues);
  const code = strictCode(value?.cardCode, `${path}.cardCode`, issues);
  const card = code ? registry.byCode.get(code) : undefined;
  if (!card) {
    issue(issues, `${path}.cardCode`, "Legend print is not in RiftLite's packaged registry.");
    return null;
  }
  if (card.type.toLowerCase() !== expectedType.toLowerCase()) issue(issues, `${path}.cardCode`, `Card must be a ${expectedType}.`);
  if (text(value?.name) !== card.name) issue(issues, `${path}.name`, "Legend name must match its registered print.");
  return card;
}

function registryMainDeckCard(raw: unknown, registry: MulliganLabRegistry, path: string, issues: SideboardLabValidationIssue[]): MulliganLabRegistryCard | null {
  const value = record(raw);
  if (!value) issue(issues, path, "Pair card must be an object.");
  if (value) assertExactKeys(value, ["cardCode", "name"], path, issues);
  const code = strictCode(value?.cardCode, `${path}.cardCode`, issues);
  const card = code ? registry.byCode.get(code) : undefined;
  if (!card) {
    issue(issues, `${path}.cardCode`, "Pair card is not in RiftLite's packaged registry.");
    return null;
  }
  if (["legend", "battlefield", "rune", "token"].includes(card.type.toLowerCase())) issue(issues, `${path}.cardCode`, "Pair card must be a valid Main Deck card.");
  if (text(value?.name) !== card.name) issue(issues, `${path}.name`, "Pair card name must match its registered print.");
  return card;
}

function parseCoveragePeriods(raw: unknown, issues: SideboardLabValidationIssue[]): MulliganLabCoveragePeriod[] {
  if (!Array.isArray(raw)) {
    issue(issues, "source.includedPeriods", "Included periods must be an array.");
    return [];
  }
  const output: MulliganLabCoveragePeriod[] = [];
  for (const value of raw) {
    if (value !== "preseason" && value !== "current-season") issue(issues, "source.includedPeriods", "Unknown coverage period.");
    else if (output.includes(value)) issue(issues, "source.includedPeriods", "Duplicate coverage period.");
    else output.push(value);
  }
  return output;
}

function parseSeasonCoverage(raw: unknown, issues: SideboardLabValidationIssue[]): MulliganLabSeasonCoverage | null {
  const value = record(raw);
  if (!value) {
    issue(issues, "source.seasonCoverage", "Season coverage is required.");
    return null;
  }
  assertExactKeys(value, ["currentSeasonStartedOn", "preseasonFacts", "currentSeasonFacts"], "source.seasonCoverage", issues);
  if (value.currentSeasonStartedOn !== MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON) issue(issues, "source.seasonCoverage.currentSeasonStartedOn", "Unexpected current-season boundary.");
  const preseasonFacts = nonNegativeInteger(value.preseasonFacts, "source.seasonCoverage.preseasonFacts", issues);
  const currentSeasonFacts = nonNegativeInteger(value.currentSeasonFacts, "source.seasonCoverage.currentSeasonFacts", issues);
  if (preseasonFacts === null || currentSeasonFacts === null || value.currentSeasonStartedOn !== MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON) return null;
  return { currentSeasonStartedOn: MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON, preseasonFacts, currentSeasonFacts };
}

function validateCoveragePeriods(periods: MulliganLabCoveragePeriod[], coverage: MulliganLabSeasonCoverage, issues: SideboardLabValidationIssue[]) {
  const expected: MulliganLabCoveragePeriod[] = [
    ...(coverage.preseasonFacts ? ["preseason" as const] : []),
    ...(coverage.currentSeasonFacts ? ["current-season" as const] : [])
  ];
  if (periods.length !== expected.length || expected.some((period, index) => periods[index] !== period)) issue(issues, "source.includedPeriods", "Included periods must match non-empty season groups in canonical order.");
}

function invalidResult(issues: SideboardLabValidationIssue[], rejected = 0): SideboardLabApiParseResult {
  return {
    status: "invalid",
    generatedAt: null,
    expiresAt: null,
    drills: [],
    reason: "validation_failed",
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
    backfillComplete: false
  };
}

function invalidTargetResult(
  issues: SideboardLabValidationIssue[],
  rejected = 0,
  targetQuery: SideboardLabTargetQuery | null = null
): SideboardLabTargetPackParseResult {
  return {
    status: "invalid",
    generatedAt: null,
    expiresAt: null,
    drills: [],
    reason: "validation_failed",
    issues,
    accepted: 0,
    rejected,
    targetQuery,
    formatPolicy: null,
    cardRegistryGeneratedAt: null,
    cardRegistryPrints: 0,
    observedFrom: null,
    observedThrough: null,
    includedFacts: 0,
    coverageTruncated: false,
    coveragePolicy: null,
    includedPeriods: [],
    seasonCoverage: null,
    backfillComplete: false
  };
}

function selectionTotal(selection: Record<string, number>): number {
  return Object.values(selection).reduce((sum, value) => sum + (Number.isSafeInteger(value) && value > 0 ? value : 0), 0);
}

function selectionIdentities(selection: Record<string, number>, identityByCode?: SideboardLabIdentityLookup): Set<string> {
  const identities = new Set<string>();
  for (const [code, count] of Object.entries(selection)) {
    if (Number.isSafeInteger(count) && count > 0) identities.add(sideboardLabPlanIdentity(code, identityByCode));
  }
  identities.delete("");
  return identities;
}

function sideboardLabPlanIdentity(cardCode: string, identityByCode?: SideboardLabIdentityLookup): string {
  const code = canonicalCode(cardCode);
  const supplied = identityByCode && isIdentityMap(identityByCode)
    ? identityByCode.get(code)
    : identityByCode ? identityByCode[code] : undefined;
  return canonicalCode(supplied) || riftboundBasePrintCode(code);
}

function isIdentityMap(value: SideboardLabIdentityLookup): value is ReadonlyMap<string, string> {
  return typeof (value as ReadonlyMap<string, string>).get === "function";
}

function snapshotDeckCards(raw: unknown[], registry: MulliganLabRegistry): Array<{ code: string; count: number }> | null {
  const counts = new Map<string, number>();
  for (const item of raw) {
    const value = record(item);
    const code = canonicalCode(value?.cardId ?? value?.card_id ?? value?.code ?? value?.cardCode ?? value?.card_code);
    const count = integer(value?.qty ?? value?.quantity ?? value?.count);
    const card = code ? registry.byCode.get(code) : undefined;
    if (!card || count === null || count < 1 || count > 3 || ["legend", "battlefield", "rune"].includes(card.type.toLowerCase())) return null;
    const next = (counts.get(code) ?? 0) + count;
    if (next > 3) return null;
    counts.set(code, next);
  }
  return [...counts].map(([code, count]) => ({ code, count }));
}

function snapshotQuantity(raw: unknown[]): number {
  let total = 0;
  for (const item of raw) {
    const value = record(item);
    const count = integer(value?.qty ?? value?.quantity ?? value?.count);
    if (count === null || count < 1 || count > 3) return -1;
    total += count;
  }
  return total;
}

function strictCode(value: unknown, path: string, issues: SideboardLabValidationIssue[]): string {
  const raw = text(value);
  const code = canonicalCode(raw);
  if (!code || raw !== code) issue(issues, path, "Card code must be a canonical uppercase print code.");
  return code;
}

function strictLegendCode(
  value: unknown,
  registry: MulliganLabRegistry,
  path: string,
  issues: SideboardLabValidationIssue[]
): string {
  const code = strictCode(value, path, issues);
  const card = code ? registry.byCode.get(code) : undefined;
  if (!card || card.type.toLocaleLowerCase() !== "legend") issue(issues, path, "Selector must be a registered Legend print code.");
  return card?.type.toLocaleLowerCase() === "legend" ? code : "";
}

function nullableSha256(value: unknown, path: string, issues: SideboardLabValidationIssue[]): string | null {
  if (value === null) return null;
  const candidate = text(value);
  if (!/^[a-f0-9]{64}$/.test(candidate)) {
    issue(issues, path, "Deck fingerprint must be a lowercase SHA-256 hex digest or null.");
    return null;
  }
  return candidate;
}

function canonicalCode(value: unknown): string {
  return riftboundCardCodeFromValue(typeof value === "string" ? value.trim() : "");
}

function isoDate(value: unknown, path: string, issues: SideboardLabValidationIssue[]): string {
  const candidate = text(value);
  if (!candidate || !Number.isFinite(Date.parse(candidate))) {
    issue(issues, path, "Timestamp must be a valid ISO date.");
    return "";
  }
  return candidate;
}

function isoDateTimeWithOffset(value: unknown, path: string, issues: SideboardLabValidationIssue[]): string {
  const candidate = text(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(candidate)
    || !Number.isFinite(Date.parse(candidate))
  ) {
    issue(issues, path, "Timestamp must be an ISO date-time with an explicit offset.");
    return "";
  }
  return candidate;
}

function nullableIsoDay(value: unknown, path: string, issues: SideboardLabValidationIssue[]): string | null {
  if (value === null) return null;
  const candidate = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate) || Number.isNaN(Date.parse(`${candidate}T00:00:00.000Z`))) {
    issue(issues, path, "Observation day must be YYYY-MM-DD or null.");
    return null;
  }
  return candidate;
}

function positiveInteger(value: unknown, path: string, issues: SideboardLabValidationIssue[]): number | null {
  const parsed = integer(value);
  if (parsed === null || parsed < 1) {
    issue(issues, path, "Value must be a positive integer.");
    return null;
  }
  return parsed;
}

function nonNegativeInteger(value: unknown, path: string, issues: SideboardLabValidationIssue[]): number | null {
  const parsed = integer(value);
  if (parsed === null || parsed < 0) {
    issue(issues, path, "Value must be a non-negative integer.");
    return null;
  }
  return parsed;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
  issues: SideboardLabValidationIssue[]
): number | null {
  const parsed = integer(value);
  if (parsed === null || parsed < minimum || parsed > maximum) {
    issue(issues, path, `Value must be an integer from ${minimum} through ${maximum}.`);
    return null;
  }
  return parsed;
}

function nullableBoundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
  issues: SideboardLabValidationIssue[]
): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    issue(issues, path, `Value must be a number from ${minimum} through ${maximum}, or null.`);
    return null;
  }
  return value;
}

function rate(value: unknown, path: string, issues: SideboardLabValidationIssue[]): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    issue(issues, path, "Rate must be between zero and one.");
    return null;
  }
  return value;
}

function nullableRate(value: unknown, path: string, issues: SideboardLabValidationIssue[]): number | null {
  if (value === null) return null;
  return rate(value, path, issues);
}

function nullableSignedRate(value: unknown, path: string, issues: SideboardLabValidationIssue[]): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < -1 || value > 1) {
    issue(issues, path, "Rate delta must be between minus one and one.");
    return null;
  }
  return value;
}

function sameRate(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= Number.EPSILON;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): JsonRecord | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function assertExactKeys(value: JsonRecord, allowed: readonly string[], path: string, issues: SideboardLabValidationIssue[]) {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) issue(issues, path === "$" ? `$.${key}` : `${path}.${key}`, "Unexpected field in strict Sideboard Lab payload.");
  }
}

function issue(issues: SideboardLabValidationIssue[], path: string, message: string) {
  issues.push({ path, message });
}
