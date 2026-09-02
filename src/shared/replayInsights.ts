import { buildAtlasReplay, type AtlasReplayViewModel, type ReplayTimelineEvent } from "./atlasReplay.js";
import {
  buildReplayIntelligence,
  replayEventVideoTimeMs,
  type ReplayIntelligenceEvent,
  type ReplayIntelligenceResult
} from "./replayIntelligence.js";
import { parseReplayCardActionText } from "./replayCardText.js";
import { deckSnapshotHash } from "./deckNotebook.js";
import { riftboundBasePrintCode, riftboundCardCodeAliases } from "./cardIdentity.js";
import {
  MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON,
  type MulliganLabCoveragePeriod
} from "./mulliganLab.js";
import {
  buildRiftLiteReplayModel,
  type RiftLiteReplayCard,
  type RiftLiteReplayEvent,
  type RiftLiteReplayModel
} from "./riftLiteReplayEngine.js";
import type {
  MatchDraft,
  ReplayIntelligenceCardJourney,
  ReplayIntelligenceConfidence,
  ReplayRecord,
  ReplayStructuredCard,
  ReplayStructuredEvent
} from "./types.js";

export type ReplayInsightCategory =
  | "opening-hand"
  | "curve"
  | "card-efficiency"
  | "battlefield"
  | "matchup"
  | "positive";

export type ReplayInsightTone = "opportunity" | "watch" | "positive";
export type ReplayInsightScope = "match" | "pattern";
export type ReplayInsightGameStage = "all" | "preboard" | "postboard";
export type ReplayInsightPatternStrength =
  | "single-observation"
  | "exploratory"
  | "developing"
  | "reasonably-stable";
export type ReplayInsightPlayCaptureStatus = "complete-enough" | "mixed" | "limited";
export type ReplayInsightPeriod = MulliganLabCoveragePeriod | "unknown";

export interface ReplayInsightCardCatalogEntry {
  code: string;
  name: string;
  imageUrl?: string;
  costEnergy?: number | null;
  costPower?: number | null;
}

export interface ReplayInsightFilters {
  rangeDays?: number;
  deckKey?: string;
  playerLegend?: string;
  opponentLegend?: string;
  format?: MatchDraft["format"];
  gameStage?: ReplayInsightGameStage;
  wentFirst?: "1st" | "2nd";
  /** Defaults to all so pre-season and current-season history remain available. */
  period?: "all" | MulliganLabCoveragePeriod;
}

export interface ReplayInsightDataReceipt {
  /** The denominator used by the insight, which can be larger than the linked evidence preview. */
  observationCount: number;
  scopeGames: number;
  completedScopeGames: number;
  completePlayCaptureScopeGames: number;
  playCaptureStatus: ReplayInsightPlayCaptureStatus;
  linkedReplays: number;
  deckFingerprints: string[];
  periods: ReplayInsightPeriod[];
  observedFrom?: string;
  observedThrough?: string;
}

export interface ReplayInsightEvidence {
  replayId: string;
  matchId: string;
  eventId?: string;
  capturedAt: string;
  videoTimeMs?: number;
  label: string;
  confidence: ReplayIntelligenceConfidence;
}

export interface ReplayInsight {
  id: string;
  scope: ReplayInsightScope;
  category: ReplayInsightCategory;
  tone: ReplayInsightTone;
  priority: number;
  title: string;
  body: string;
  action: string;
  /** Capture provenance only; it is not confidence that the interpretation is correct. */
  captureConfidence: ReplayIntelligenceConfidence;
  /** Kept as a compatibility alias for captureConfidence. */
  confidence: ReplayIntelligenceConfidence;
  patternStrength: ReplayInsightPatternStrength;
  claimBasis: "observational";
  dataReceipt: ReplayInsightDataReceipt;
  sampleSize: number;
  replayId?: string;
  matchId?: string;
  gameNumber?: number;
  cardName?: string;
  cardId?: string;
  playerLegend?: string;
  opponentLegend?: string;
  evidence: ReplayInsightEvidence[];
}

export interface ReplayInsightCardReport {
  key: string;
  cardName: string;
  cardId?: string;
  imageUrl?: string;
  appearances: number;
  kept: number;
  played: number;
  unplayed: number;
  completePlayCaptureAppearances: number;
  recycledOrDiscarded: number;
  lateKeeps: number;
  immediatePlays: number;
  averageKnownHandTimeMs?: number;
  /**
   * Review-grade opening-hand decisions are counted once per captured game and card name.
   * They describe whether at least one copy was offered, kept, or redrawn;
   * stable per-copy identity is not available on every platform. Inferred-only
   * events are excluded from these rates.
   */
  mulligan?: {
    offeredGames: number;
    keptGames: number;
    redrawnGames: number;
    /** Games with a keep and a late card-name play; this does not link copies. */
    latePlayedGames: number;
  };
  /**
   * A hand observation must occur before the matching card-name play. The play
   * event itself never creates this denominator.
   */
  prePlayHand?: {
    observedGames: number;
    laterPlayedGames: number;
    noCapturedPlayGames: number;
    recycledOrDiscardedGames: number;
  };
  /** First captured play of this card name, counted once per game. */
  firstPlayTurns?: {
    byTurn3Games: number;
    turns4To5Games: number;
    turn6PlusGames: number;
    unknownTurnGames: number;
  };
  /**
   * Review-grade positive play evidence split by trusted game stage. Inferred
   * plays are excluded, and a play without a trusted game number stays in the
   * unknown-stage bucket rather than being presented as Game 1.
   */
  playReach?: {
    preboardGames: number;
    postboardGames: number;
    unknownStageGames: number;
  };
  confidence: ReplayIntelligenceConfidence;
  replayIds: string[];
}

export type ReplayInsightStatSampleState = "insufficient" | "early" | "established";

export interface ReplayInsightBattlefieldPickOrder {
  key: string;
  sequence: string[];
  games: number;
  percentage: number;
  wins: number;
  losses: number;
  draws: number;
  winRate?: number;
  sampleState: ReplayInsightStatSampleState;
  evidence: ReplayInsightEvidence[];
}

export interface ReplayInsightBattlefieldPositionChoice {
  key: string;
  gameNumber: number;
  battlefieldName: string;
  games: number;
  totalAtPosition: number;
  percentage: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  isMostCommon: boolean;
  isTiedForMostCommon: boolean;
  sampleState: ReplayInsightStatSampleState;
  evidence: ReplayInsightEvidence[];
}

export interface ReplayInsightCardSourceZones {
  key: string;
  cardName: string;
  cardId?: string;
  imageUrl?: string;
  totalPlays: number;
  hand: number;
  hidden: number;
  trash: number;
  deck: number;
  other: number;
  unknown: number;
  handPercent: number;
  hiddenPercent: number;
  trashPercent: number;
  deckPercent: number;
  otherPercent: number;
  unknownPercent: number;
  onTurn: number;
  offTurn: number;
  unknownTurn: number;
  evidence: ReplayInsightEvidence[];
}

export interface ReplayInsightCardTurnOutcome {
  key: string;
  cardName: string;
  cardId?: string;
  imageUrl?: string;
  playerTurnNumber: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  baselineGames: number;
  baselineWins: number;
  baselineWinRate: number;
  baselineEligibility: "known-visible-by-player-turn";
  deltaPercentagePoints: number;
  sampleState: ReplayInsightStatSampleState;
  correlationLabel: string;
  evidence: ReplayInsightEvidence[];
}

export interface ReplayInsightOutcomeSplit {
  key: string;
  basis: "initiative" | "game-stage";
  label: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  baselineWinRate: number;
  deltaPercentagePoints: number;
  sampleState: ReplayInsightStatSampleState;
}

export interface ReplayInsightsStats {
  completedGames: number;
  wins: number;
  losses: number;
  draws: number;
  baselineWinRate: number;
  capturedLocalPlays: number;
  knownSourcePlays: number;
  sourceCoveragePercent: number;
  reliableTimingCohorts: number;
  battlefieldPickOrders: ReplayInsightBattlefieldPickOrder[];
  battlefieldPositionChoices: ReplayInsightBattlefieldPositionChoice[];
  cardSourceZones: ReplayInsightCardSourceZones[];
  cardTurnOutcomes: ReplayInsightCardTurnOutcome[];
  outcomeSplits: ReplayInsightOutcomeSplit[];
}

export interface ReplayInsightsCoverage {
  grade: "high" | "medium" | "limited";
  replaysWithStructuredEvents: number;
  namedCardJourneys: number;
  confirmedEvents: number;
  reconstructedEvents: number;
  inferredEvents: number;
  manualEvents: number;
}

export interface ReplayInsightsScopeReceipt {
  currentSeasonStartedOn: typeof MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON;
  periods: ReplayInsightPeriod[];
  periodGameCounts: Record<ReplayInsightPeriod, number>;
  deckVersions: Array<{ fingerprint: string; games: number }>;
  unknownDeckGames: number;
  observedFrom?: string;
  observedThrough?: string;
}

export interface ReplayInsightsReport {
  generatedAt: string;
  replaysAnalyzed: number;
  analyzedReplayIds: string[];
  matchesAnalyzed: number;
  gamesAnalyzed: number;
  insights: ReplayInsight[];
  cards: ReplayInsightCardReport[];
  stats: ReplayInsightsStats;
  coverage: ReplayInsightsCoverage;
  scopeReceipt: ReplayInsightsScopeReceipt;
}

export interface BuildReplayInsightsOptions {
  filters?: ReplayInsightFilters;
  cardCatalog?: Iterable<ReplayInsightCardCatalogEntry>;
  openingHandEventsByReplayId?: ReadonlyMap<string, ReplayStructuredEvent[]>;
  enrichmentEventsByReplayId?: ReadonlyMap<string, ReplayStructuredEvent[]>;
  minimumPatternSample?: number;
  /** Explorer aggregations are CPU-only but can be skipped until the Explore tab is opened. */
  includeExplorerStats?: boolean;
  /** Set false when replay order was combined or otherwise cannot support game-stage claims. */
  trustGameStage?: boolean;
  now?: string | Date;
}

interface ReplayAnalysis {
  replay: ReplayRecord;
  match: MatchDraft | undefined;
  model: AtlasReplayViewModel;
  intelligence: ReplayIntelligenceResult;
  turnByEvent: Map<string, ReplayInsightTurnContext>;
  openingHandEvents: ReplayStructuredEvent[];
  chosenChampionIdentitiesByGame: Map<number, Set<string>>;
  hasEnrichmentEvents: boolean;
  trustGameStage: boolean;
  deckFingerprint: string;
}

type ReplayInsightDraft = Omit<
  ReplayInsight,
  "captureConfidence" | "patternStrength" | "claimBasis" | "dataReceipt"
> & { sourceReplayIds?: string[] };

interface ReplayInsightTurnContext {
  gameNumber: number;
  turnNumber: number;
  playerTurnNumber: number;
  side: "me" | "opponent" | "system" | "unknown";
  label: string;
}

interface ReplayInsightEligibleGame {
  analysis: ReplayAnalysis;
  gameNumber: number;
}

interface ReplayInsightResolvedPlay {
  analysis: ReplayAnalysis;
  event: ReplayTimelineEvent;
  gameNumber: number;
  cardKey: string;
  cardName: string;
  cardId?: string;
  imageUrl?: string;
}

interface MutableCardReport {
  key: string;
  cardName: string;
  cardId?: string;
  imageUrl?: string;
  catalogResolved: boolean;
  appearances: number;
  kept: number;
  played: number;
  unplayed: number;
  completePlayCaptureAppearances: number;
  recycledOrDiscarded: number;
  lateKeeps: number;
  immediatePlays: number;
  handTimeTotalMs: number;
  handTimeSamples: number;
  mulliganOfferedGames: Set<string>;
  mulliganKeptGames: Set<string>;
  mulliganRedrawnGames: Set<string>;
  mulliganLatePlayedGames: Set<string>;
  prePlayObservedGames: Set<string>;
  prePlayLaterPlayedGames: Set<string>;
  prePlayNoCapturedPlayGames: Set<string>;
  prePlayRecycledOrDiscardedGames: Set<string>;
  firstPlayByTurn3Games: Set<string>;
  firstPlayTurns4To5Games: Set<string>;
  firstPlayTurn6PlusGames: Set<string>;
  firstPlayUnknownTurnGames: Set<string>;
  playedPreboardGames: Set<string>;
  playedPostboardGames: Set<string>;
  playedUnknownStageGames: Set<string>;
  confidences: ReplayIntelligenceConfidence[];
  replayIds: Set<string>;
  evidence: ReplayInsightEvidence[];
}

interface MatchupPattern {
  opponentLegend: string;
  games: number;
  slowStarts: number;
  evidence: ReplayInsightEvidence[];
  confidences: ReplayIntelligenceConfidence[];
  replayIds: Set<string>;
}

const LATE_OPENING_PLAY_TURN = 4;
const LONG_HAND_TIME_MS = 90_000;
const RAW_INSIGHT_ACTION_ID = "insight:raw-authoritative";
const RAW_CHOSEN_CHAMPION_ACTION_ID = "insight:raw-chosen-champion";
const TURN_ATTRIBUTED_ACTION_ID = "insight:turn-attributed";
/** Structured-event sentinel for evidence whose original game number is unavailable. */
const UNTRUSTED_GAME_NUMBER = 0;

export function buildReplayInsights(
  replays: ReplayRecord[],
  matches: MatchDraft[],
  options: BuildReplayInsightsOptions = {}
): ReplayInsightsReport {
  const filters = options.filters ?? {};
  const now = options.now instanceof Date
    ? options.now
    : options.now
      ? new Date(options.now)
      : new Date();
  const minimumPatternSample = Math.max(2, options.minimumPatternSample ?? 3);
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const catalog = buildCardCatalog(options.cardCatalog ?? []);
  const analyses = replays
    .filter((replay) => !replay.deletedAt)
    .map((replay) => {
      const match = matchById.get(replay.matchId) ?? replay.matchSnapshot;
      if (!replayMatchesFilters(replay, match, filters, now)) return null;
      const enrichmentEvents = options.enrichmentEventsByReplayId?.get(replay.id) ?? [];
      const model = repairReplayInsightModel(
        replay,
        buildAtlasReplay(replay, match),
        enrichmentEvents
      );
      const intelligence = buildReplayIntelligence(replay, model);
      const structuredOpeningHands = (replay.structuredEvents ?? []).filter((event) => event.mulligan?.kept?.length);
      const enrichedOpeningHands = enrichmentEvents.filter((event) => event.mulligan?.kept?.length);
      const chosenChampionIdentitiesByGame = buildChosenChampionIdentitiesByGame(
        [...(replay.structuredEvents ?? []), ...enrichmentEvents],
        catalog
      );
      return {
        replay,
        match,
        model,
        intelligence,
        turnByEvent: buildTurnContext(model),
        openingHandEvents: structuredOpeningHands.length
          ? structuredOpeningHands
          : enrichedOpeningHands.length
            ? enrichedOpeningHands
            : options.openingHandEventsByReplayId?.get(replay.id) ?? [],
        chosenChampionIdentitiesByGame,
        hasEnrichmentEvents: enrichmentEvents.length > 0,
        trustGameStage: options.trustGameStage !== false,
        deckFingerprint: deckSnapshotHash(match?.deckSnapshotJson ?? "")
      } satisfies ReplayAnalysis;
    })
    .filter((analysis): analysis is ReplayAnalysis => Boolean(analysis));

  const insights: ReplayInsightDraft[] = [];
  const cardReports = new Map<string, MutableCardReport>();
  const matchupPatterns = new Map<string, MatchupPattern>();
  const analyzedGames = new Set<string>();
  const eligibleGames: ReplayInsightEligibleGame[] = [];

  for (const analysis of analyses) {
    const gameNumbers = replayGameNumbers(analysis);
    for (const gameNumber of gameNumbers) {
      if (!gameMatchesFilters(analysis, gameNumber, filters)) continue;
      analyzedGames.add(`${analysis.replay.id}:${gameNumber}`);
      eligibleGames.push({ analysis, gameNumber });
      collectOpeningHandInsights(analysis, gameNumber, catalog, insights, cardReports, filters.gameStage ?? "all");
      collectCurveInsights(analysis, gameNumber, insights, matchupPatterns);
      collectScoreInsights(analysis, gameNumber, insights);
      collectCardJourneyInsights(analysis, gameNumber, catalog, insights, cardReports, filters.gameStage ?? "all");
    }
  }

  collectCardPatterns(cardReports, minimumPatternSample, insights);
  collectMatchupPatterns(matchupPatterns, minimumPatternSample, insights);

  const cards = [...cardReports.values()]
    .map(finalizeCardReport)
    .sort((left, right) => right.appearances - left.appearances || left.cardName.localeCompare(right.cardName));
  const scopedGames = deduplicateEligibleGames(eligibleGames);
  const sortedInsights = deduplicateInsights(insights)
    .map((insight) => finalizeReplayInsight(insight, eligibleGames))
    .sort((left, right) => right.priority - left.priority || right.sampleSize - left.sampleSize || left.title.localeCompare(right.title));
  const stats = options.includeExplorerStats === false
    ? emptyReplayInsightStats()
    : buildReplayInsightStats(scopedGames, catalog, filters);
  const coverage = buildReportCoverage(analyses);
  const scopeReceipt = buildReplayInsightsScopeReceipt(scopedGames);

  return {
    generatedAt: new Date().toISOString(),
    replaysAnalyzed: analyses.length,
    analyzedReplayIds: analyses.map((analysis) => analysis.replay.id),
    matchesAnalyzed: new Set(analyses.map((analysis) => analysis.match?.id || analysis.replay.matchId)).size,
    gamesAnalyzed: analyzedGames.size,
    insights: sortedInsights,
    cards,
    stats,
    coverage,
    scopeReceipt
  };
}

function buildReplayInsightStats(
  eligibleGames: ReplayInsightEligibleGame[],
  catalog: Map<string, ReplayInsightCardCatalogEntry>,
  filters: ReplayInsightFilters
): ReplayInsightsStats {
  const scopedGames = eligibleGames;
  const completedGames = scopedGames
    .map((scope) => ({ ...scope, result: replayInsightGameResult(scope.analysis, scope.gameNumber) }))
    .filter((scope): scope is ReplayInsightEligibleGame & { result: "Win" | "Loss" | "Draw" } => Boolean(scope.result));
  const baseline = summarizeResults(completedGames.map((scope) => scope.result));
  const sourceRows = new Map<string, {
    key: string;
    cardName: string;
    cardId?: string;
    imageUrl?: string;
    hand: number;
    hidden: number;
    trash: number;
    deck: number;
    other: number;
    unknown: number;
    onTurn: number;
    offTurn: number;
    unknownTurn: number;
    evidence: ReplayInsightEvidence[];
  }>();
  const timingRows = new Map<string, {
    key: string;
    cardKey: string;
    cardName: string;
    cardId?: string;
    imageUrl?: string;
    playerTurnNumber: number;
    results: Array<"Win" | "Loss" | "Draw">;
    evidence: ReplayInsightEvidence[];
  }>();
  const timingEligibilityByCard = new Map<string, Array<{
    firstAvailablePlayerTurn: number;
    result: "Win" | "Loss" | "Draw";
  }>>();
  let capturedLocalPlays = 0;
  let knownSourcePlays = 0;

  for (const scope of scopedGames) {
    const plays = localPlaysForGame(scope, catalog, filters.gameStage ?? "all");
    capturedLocalPlays += plays.length;
    for (const play of plays) {
      const source = cardPlaySource(play.event);
      if (source !== "unknown") knownSourcePlays += 1;
      const row = sourceRows.get(play.cardKey) ?? {
        key: play.cardKey,
        cardName: play.cardName,
        cardId: play.cardId,
        imageUrl: play.imageUrl,
        hand: 0,
        hidden: 0,
        trash: 0,
        deck: 0,
        other: 0,
        unknown: 0,
        onTurn: 0,
        offTurn: 0,
        unknownTurn: 0,
        evidence: []
      };
      row[source] += 1;
      const turnSide = play.analysis.turnByEvent.get(play.event.id)?.side;
      if (turnSide === "me") row.onTurn += 1;
      else if (turnSide === "opponent") row.offTurn += 1;
      else row.unknownTurn += 1;
      row.evidence.push(playEvidence(play, `${play.cardName} played from ${source === "unknown" ? "an unknown source" : source}`));
      sourceRows.set(play.cardKey, row);
    }

    const result = replayInsightGameResult(scope.analysis, scope.gameNumber);
    if (!result) continue;
    for (const [visibleCardKey, firstAvailablePlayerTurn] of knownCardAvailabilityForGame(scope, catalog, plays, filters.gameStage ?? "all")) {
      const observations = timingEligibilityByCard.get(visibleCardKey) ?? [];
      observations.push({ firstAvailablePlayerTurn, result });
      timingEligibilityByCard.set(visibleCardKey, observations);
    }
    const firstPlayByCard = new Map<string, ReplayInsightResolvedPlay>();
    for (const play of plays) {
      if (!firstPlayByCard.has(play.cardKey)) firstPlayByCard.set(play.cardKey, play);
    }
    for (const play of firstPlayByCard.values()) {
      if (trustedGameStageForEvent(play.analysis, play.event) === "unknown") continue;
      const turn = scope.analysis.turnByEvent.get(play.event.id);
      if (!turn || turn.gameNumber !== scope.gameNumber || turn.side !== "me" || turn.playerTurnNumber < 1) continue;
      const key = `${play.cardKey}:turn-${turn.playerTurnNumber}`;
      const row = timingRows.get(key) ?? {
        key,
        cardKey: play.cardKey,
        cardName: play.cardName,
        cardId: play.cardId,
        imageUrl: play.imageUrl,
        playerTurnNumber: turn.playerTurnNumber,
        results: [],
        evidence: []
      };
      row.results.push(result);
      row.evidence.push(playEvidence(play, `${play.cardName} first played on your turn ${turn.playerTurnNumber}`));
      timingRows.set(key, row);
    }
  }

  const cardSourceZones = [...sourceRows.values()].map((row): ReplayInsightCardSourceZones => {
    const totalPlays = row.hand + row.hidden + row.trash + row.deck + row.other + row.unknown;
    return {
      ...row,
      totalPlays,
      handPercent: replayStatPercentage(row.hand, totalPlays),
      hiddenPercent: replayStatPercentage(row.hidden, totalPlays),
      trashPercent: replayStatPercentage(row.trash, totalPlays),
      deckPercent: replayStatPercentage(row.deck, totalPlays),
      otherPercent: replayStatPercentage(row.other, totalPlays),
      unknownPercent: replayStatPercentage(row.unknown, totalPlays),
      evidence: row.evidence.slice(0, 24)
    };
  }).sort((left, right) => right.totalPlays - left.totalPlays || left.cardName.localeCompare(right.cardName));

  const cardTurnOutcomes = [...timingRows.values()].map((row): ReplayInsightCardTurnOutcome => {
    const outcome = summarizeResults(row.results);
    const eligibleBaseline = summarizeResults(
      (timingEligibilityByCard.get(row.cardKey) ?? [])
        .filter((observation) => observation.firstAvailablePlayerTurn <= row.playerTurnNumber)
        .map((observation) => observation.result)
    );
    const deltaPercentagePoints = replayStatDelta(outcome.winRate, eligibleBaseline.winRate);
    return {
      key: row.key,
      cardName: row.cardName,
      cardId: row.cardId,
      imageUrl: row.imageUrl,
      playerTurnNumber: row.playerTurnNumber,
      games: outcome.games,
      wins: outcome.wins,
      losses: outcome.losses,
      draws: outcome.draws,
      winRate: outcome.winRate,
      baselineGames: eligibleBaseline.games,
      baselineWins: eligibleBaseline.wins,
      baselineWinRate: eligibleBaseline.winRate,
      baselineEligibility: "known-visible-by-player-turn",
      deltaPercentagePoints,
      sampleState: replayStatSampleState(outcome.games),
      correlationLabel: replayStatCorrelationLabel(deltaPercentagePoints, eligibleBaseline.winRate, eligibleBaseline.games),
      evidence: row.evidence.slice(0, 12)
    };
  }).sort((left, right) => (
    right.games - left.games
    || Math.abs(right.deltaPercentagePoints) - Math.abs(left.deltaPercentagePoints)
    || left.cardName.localeCompare(right.cardName)
    || left.playerTurnNumber - right.playerTurnNumber
  ));

  return {
    completedGames: baseline.games,
    wins: baseline.wins,
    losses: baseline.losses,
    draws: baseline.draws,
    baselineWinRate: baseline.winRate,
    capturedLocalPlays,
    knownSourcePlays,
    sourceCoveragePercent: replayStatPercentage(knownSourcePlays, capturedLocalPlays),
    reliableTimingCohorts: cardTurnOutcomes.filter((row) => replayInsightPatternStrength(row.games) === "reasonably-stable").length,
    battlefieldPickOrders: buildBattlefieldPickOrders(scopedGames, filters),
    battlefieldPositionChoices: buildBattlefieldPositionChoices(scopedGames),
    cardSourceZones,
    cardTurnOutcomes,
    outcomeSplits: buildOutcomeSplits(completedGames, baseline.winRate)
  };
}

function emptyReplayInsightStats(): ReplayInsightsStats {
  return {
    completedGames: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    baselineWinRate: 0,
    capturedLocalPlays: 0,
    knownSourcePlays: 0,
    sourceCoveragePercent: 0,
    reliableTimingCohorts: 0,
    battlefieldPickOrders: [],
    battlefieldPositionChoices: [],
    cardSourceZones: [],
    cardTurnOutcomes: [],
    outcomeSplits: []
  };
}

function deduplicateEligibleGames(games: ReplayInsightEligibleGame[]): ReplayInsightEligibleGame[] {
  const selected = new Map<string, ReplayInsightEligibleGame>();
  for (const candidate of games) {
    if (candidate.gameNumber < 1 || candidate.gameNumber > 3) continue;
    const key = replayInsightGameKey(candidate.analysis, candidate.gameNumber);
    const current = selected.get(key);
    if (!current || replayInsightGameEvidenceScore(candidate) > replayInsightGameEvidenceScore(current)) {
      selected.set(key, candidate);
    }
  }
  return [...selected.values()].sort((left, right) => (
    eventTime({ capturedAt: left.analysis.replay.capturedAt }) - eventTime({ capturedAt: right.analysis.replay.capturedAt })
    || left.gameNumber - right.gameNumber
  ));
}

function replayInsightGameKey(analysis: ReplayAnalysis, gameNumber: number): string {
  return `${analysis.match?.id || analysis.replay.matchId || analysis.replay.id}:${gameNumber}`;
}

function replayInsightGameEvidenceScore(scope: ReplayInsightEligibleGame): number {
  const matchingEvents = scope.analysis.model.events.filter((event) => replayTimelineEventGameNumber(scope.analysis, event) === scope.gameNumber);
  return matchingEvents.length * 10 + matchingEvents.filter((event) => event.side === "me").length;
}

function replayInsightGameResult(analysis: ReplayAnalysis, gameNumber: number): "Win" | "Loss" | "Draw" | undefined {
  const direct = analysis.match?.games.find((game) => game.gameNumber === gameNumber)?.result;
  if (direct && direct !== "Incomplete") return direct;
  if (gameNumber === 1 && (analysis.match?.games.length ?? 0) <= 1) {
    const fallback = analysis.match?.result;
    if (fallback && fallback !== "Incomplete") return fallback;
  }
  return undefined;
}

function replayInsightHasCompleteEnoughPlayCapture(analysis: ReplayAnalysis, gameNumber: number): boolean {
  if (!analysis.trustGameStage || !replayInsightHasTrustedGameStage(analysis, gameNumber)) return false;
  if (!replayInsightGameResult(analysis, gameNumber)) return false;
  if (analysis.intelligence.summary.coverage.grade === "limited") return false;
  if (analysis.intelligence.events.some((event) => (
    event.type === "play" && trustedGameStageForEvent(analysis, event) === "unknown"
  ))) return false;
  const relevantEvents = analysis.model.events.filter((event) => event.gameNumber === gameNumber);
  const evidenceEvents = analysis.intelligence.events.filter((event) => event.gameNumber === gameNumber);
  const evidenceWeight = evidenceEvents.reduce((total, event) => (
    total + (event.confidence === "confirmed" || event.confidence === "manual" ? 1 : event.confidence === "reconstructed" ? 0.65 : 0.3)
  ), 0);
  if (evidenceEvents.length < 5 || evidenceWeight / evidenceEvents.length < 0.5) return false;
  const playerTurns = new Set(
    relevantEvents
      .map((event) => analysis.turnByEvent.get(event.id))
      .filter((turn): turn is ReplayInsightTurnContext => Boolean(turn && turn.side === "me" && turn.playerTurnNumber > 0))
      .map((turn) => turn.playerTurnNumber)
  ).size;
  const hasTerminalEvidence = relevantEvents.some((event) => event.type === "result");
  const hasStructuredChannel = Boolean(
    analysis.replay.structuredEvents?.some((event) => event.gameNumber === gameNumber)
    || (analysis.hasEnrichmentEvents && relevantEvents.some((event) => event.actionId === RAW_INSIGHT_ACTION_ID))
  );
  if (!hasStructuredChannel) return false;
  if (analysis.replay.platform === "tcga") {
    return analysis.intelligence.summary.coverage.grade === "high" && playerTurns >= 2 && hasTerminalEvidence;
  }
  return playerTurns >= 2 && (hasTerminalEvidence || analysis.match?.status === "saved");
}

function summarizeResults(results: Array<"Win" | "Loss" | "Draw">): {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
} {
  const wins = results.filter((result) => result === "Win").length;
  const losses = results.filter((result) => result === "Loss").length;
  const draws = results.filter((result) => result === "Draw").length;
  return { games: results.length, wins, losses, draws, winRate: replayStatPercentage(wins, results.length) };
}

function localPlaysForGame(
  scope: ReplayInsightEligibleGame,
  catalog: Map<string, ReplayInsightCardCatalogEntry>,
  gameStage: ReplayInsightGameStage
): ReplayInsightResolvedPlay[] {
  const candidates = scope.analysis.intelligence.events
    .filter((event) => (
      event.type === "play"
        && event.side === "me"
        && replayTimelineEventGameNumber(scope.analysis, event) === scope.gameNumber
        && reviewGradeTimelineEventConfidence(scope.analysis, event) !== "inferred"
        && gameStageIncludesTrustedEvent(scope.analysis, event, gameStage)
    ))
    .sort((left, right) => eventTime(left) - eventTime(right));
  const result: ReplayInsightResolvedPlay[] = [];
  for (const event of candidates) {
    const parsed = parseReplayCardActionText(event.text);
    const cardName = event.cardName || parsed?.name || "";
    const catalogCard = catalog.get(cardKey(event.cardId)) ?? catalog.get(cardKey(cardName));
    const resolvedName = catalogCard?.name || cardName || event.cardId || "";
    const resolvedId = catalogCard?.code || event.cardId;
    if (!isReportableCard(resolvedName, resolvedId, catalog)) continue;
    if (isChosenChampionCard(scope.analysis, scope.gameNumber, catalog, resolvedName, resolvedId)) continue;
    const resolved: ReplayInsightResolvedPlay = {
      analysis: scope.analysis,
      event: event.fromZone || !parsed?.fromZone ? event : { ...event, fromZone: parsed.fromZone },
      gameNumber: scope.gameNumber,
      cardKey: canonicalCardKey(catalog, resolvedName, resolvedId),
      cardName: resolvedName,
      cardId: resolvedId,
      imageUrl: catalogCard?.imageUrl
    };
    const previous = result[result.length - 1];
    if (previous && duplicateResolvedPlay(previous, resolved)) {
      if (resolvedPlayEvidenceScore(resolved) > resolvedPlayEvidenceScore(previous)) result[result.length - 1] = resolved;
      continue;
    }
    result.push(resolved);
  }
  return result;
}

function knownCardAvailabilityForGame(
  scope: ReplayInsightEligibleGame,
  catalog: Map<string, ReplayInsightCardCatalogEntry>,
  plays: ReplayInsightResolvedPlay[],
  gameStage: ReplayInsightGameStage
): Map<string, number> {
  const firstAvailable = new Map<string, number>();
  const record = (key: string, playerTurnNumber: number) => {
    if (!key) return;
    const current = firstAvailable.get(key);
    if (current == null || playerTurnNumber < current) firstAvailable.set(key, playerTurnNumber);
  };

  for (const opening of scope.analysis.openingHandEvents) {
    if (opening.gameNumber !== scope.gameNumber || !gameStageIncludesTrustedEvent(scope.analysis, opening, gameStage)) continue;
    if (rawEventEvidence(scope.analysis, opening, "Opening hand recorded").confidence === "inferred") continue;
    for (const card of opening.mulligan?.kept ?? []) {
      if (isChosenChampionCard(scope.analysis, scope.gameNumber, catalog, card.name, card.code || card.id)) continue;
      record(canonicalCardKey(catalog, card.name, card.code || card.id), 0);
    }
  }

  for (const event of scope.analysis.intelligence.events) {
    if (event.gameNumber !== scope.gameNumber || event.side !== "me") continue;
    if (event.confidence === "inferred") continue;
    if (!gameStageIncludesTrustedEvent(scope.analysis, event, gameStage)) continue;
    const enteredHand = event.type === "draw" || normalizeZone(event.toZone || event.destination) === "hand";
    if (!enteredHand || !isReportableCard(event.cardName, event.cardId, catalog)) continue;
    if (isChosenChampionCard(scope.analysis, scope.gameNumber, catalog, event.cardName, event.cardId)) continue;
    const turn = scope.analysis.turnByEvent.get(event.id);
    if (!turn || turn.gameNumber !== scope.gameNumber) continue;
    record(canonicalCardKey(catalog, event.cardName, event.cardId), Math.max(0, turn.playerTurnNumber));
  }

  // A play is the minimum observable proof that the card was available at that moment.
  for (const play of plays) {
    const turn = scope.analysis.turnByEvent.get(play.event.id);
    if (!turn || turn.gameNumber !== scope.gameNumber || turn.playerTurnNumber < 1) continue;
    record(play.cardKey, turn.playerTurnNumber);
  }
  return firstAvailable;
}

function duplicateResolvedPlay(left: ReplayInsightResolvedPlay, right: ReplayInsightResolvedPlay): boolean {
  if (left.cardKey !== right.cardKey || left.gameNumber !== right.gameNumber) return false;
  const distance = Math.abs(eventTime(left.event) - eventTime(right.event));
  if (distance > 2_000) return false;
  const leftRaw = left.event.actionId === RAW_INSIGHT_ACTION_ID;
  const rightRaw = right.event.actionId === RAW_INSIGHT_ACTION_ID;
  if (leftRaw !== rightRaw) return true;
  return distance <= 250 && normalizeActionText(left.event.text) === normalizeActionText(right.event.text);
}

function resolvedPlayEvidenceScore(play: ReplayInsightResolvedPlay): number {
  return (play.cardId ? 4 : 0) + (play.event.fromZone ? 2 : 0) + (play.event.actionId === RAW_INSIGHT_ACTION_ID ? 1 : 0);
}

function replayTimelineEventGameNumber(analysis: ReplayAnalysis, event: ReplayTimelineEvent): number {
  return event.gameNumber ?? analysis.turnByEvent.get(event.id)?.gameNumber ?? 1;
}

function cardPlaySource(event: ReplayTimelineEvent): "hand" | "hidden" | "trash" | "deck" | "other" | "unknown" {
  const parsed = event.fromZone ? null : parseReplayCardActionText(event.text);
  const zone = normalizeZone(event.fromZone || parsed?.fromZone || "");
  if (zone === "hand") return "hand";
  if (event.visibility === "hidden" || /hidden|facedown|secret/.test(zone)) return "hidden";
  if (/trash|discard/.test(zone)) return "trash";
  if (/deck/.test(zone)) return "deck";
  return zone ? "other" : "unknown";
}

function playEvidence(play: ReplayInsightResolvedPlay, label: string): ReplayInsightEvidence {
  const confidence = reviewGradeTimelineEventConfidence(play.analysis, play.event);
  return rawTimelineEvidence(play.analysis, play.event, confidence, label);
}

function reviewGradeTimelineEventConfidence(
  analysis: ReplayAnalysis,
  event: ReplayTimelineEvent
): ReplayIntelligenceConfidence {
  return analysis.intelligence.events.find((candidate) => candidate.id === event.id)?.confidence
    ?? confidenceFromReplay(analysis.replay);
}

function trustedGameStageForEvent(
  analysis: ReplayAnalysis,
  event: Pick<ReplayTimelineEvent, "gameNumber">
): Exclude<ReplayInsightGameStage, "all"> | "unknown" {
  if (!analysis.trustGameStage) return "unknown";
  const gameNumber = event.gameNumber;
  if (typeof gameNumber !== "number" || !Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 3) return "unknown";
  return gameNumber === 1 ? "preboard" : "postboard";
}

function gameStageIncludesTrustedEvent(
  analysis: ReplayAnalysis,
  event: Pick<ReplayTimelineEvent, "gameNumber">,
  gameStage: ReplayInsightGameStage
): boolean {
  if (gameStage === "all") return true;
  return trustedGameStageForEvent(analysis, event) === gameStage;
}

function buildBattlefieldPositionChoices(scopedGames: ReplayInsightEligibleGame[]): ReplayInsightBattlefieldPositionChoice[] {
  const rows = new Map<string, {
    key: string;
    gameNumber: number;
    battlefieldName: string;
    results: Array<"Win" | "Loss" | "Draw">;
    evidence: ReplayInsightEvidence[];
    games: number;
  }>();
  const totals = new Map<number, number>();
  for (const scope of scopedGames) {
    if (scope.gameNumber < 1 || scope.gameNumber > 3) continue;
    const game = scope.analysis.match?.games.find((candidate) => candidate.gameNumber === scope.gameNumber);
    const battlefieldName = game?.myBattlefield?.trim();
    if (!game || !battlefieldName) continue;
    const key = `${game.gameNumber}:${normalizeText(battlefieldName)}`;
    const row = rows.get(key) ?? {
      key,
      gameNumber: game.gameNumber,
      battlefieldName,
      results: [],
      evidence: [],
      games: 0
    };
    row.games += 1;
    if (game.result !== "Incomplete") row.results.push(game.result);
    row.evidence.push(battlefieldPickEvidence(scope, game.gameNumber, battlefieldName));
    rows.set(key, row);
    totals.set(game.gameNumber, (totals.get(game.gameNumber) ?? 0) + 1);
  }
  const maximumByPosition = new Map<number, number>();
  const maximumCountByPosition = new Map<number, number>();
  for (const row of rows.values()) {
    const current = maximumByPosition.get(row.gameNumber) ?? 0;
    if (row.games > current) maximumByPosition.set(row.gameNumber, row.games);
  }
  for (const row of rows.values()) {
    if (row.games !== maximumByPosition.get(row.gameNumber)) continue;
    maximumCountByPosition.set(row.gameNumber, (maximumCountByPosition.get(row.gameNumber) ?? 0) + 1);
  }
  return [...rows.values()].map((row): ReplayInsightBattlefieldPositionChoice => {
    const outcome = summarizeResults(row.results);
    const isMostCommon = row.games === maximumByPosition.get(row.gameNumber);
    return {
      key: row.key,
      gameNumber: row.gameNumber,
      battlefieldName: row.battlefieldName,
      games: row.games,
      totalAtPosition: totals.get(row.gameNumber) ?? row.games,
      percentage: replayStatPercentage(row.games, totals.get(row.gameNumber) ?? row.games),
      wins: outcome.wins,
      losses: outcome.losses,
      draws: outcome.draws,
      winRate: outcome.winRate,
      isMostCommon,
      isTiedForMostCommon: isMostCommon && (maximumCountByPosition.get(row.gameNumber) ?? 0) > 1,
      sampleState: replayStatSampleState(row.games),
      evidence: row.evidence.slice(0, 12)
    };
  }).sort((left, right) => (
    left.gameNumber - right.gameNumber
    || right.games - left.games
    || left.battlefieldName.localeCompare(right.battlefieldName)
  ));
}

function buildBattlefieldPickOrders(
  scopedGames: ReplayInsightEligibleGame[],
  filters: ReplayInsightFilters
): ReplayInsightBattlefieldPickOrder[] {
  const byMatch = new Map<string, ReplayInsightEligibleGame[]>();
  for (const scope of scopedGames) {
    if (!scope.analysis.match) continue;
    const key = scope.analysis.match.id || scope.analysis.replay.matchId;
    const list = byMatch.get(key) ?? [];
    list.push(scope);
    byMatch.set(key, list);
  }
  const observations: Array<{
    sequence: string[];
    result?: "Win" | "Loss" | "Draw";
    evidence: ReplayInsightEvidence[];
  }> = [];
  for (const scopes of byMatch.values()) {
    const representative = [...scopes].sort((left, right) => replayInsightGameEvidenceScore(right) - replayInsightGameEvidenceScore(left))[0];
    const match = representative?.analysis.match;
    if (!representative || !match) continue;
    const allowedGames = new Set(scopes.map((scope) => scope.gameNumber));
    const orderedGames = [...match.games]
      .filter((game) => game.gameNumber >= 1 && game.gameNumber <= 3 && allowedGames.has(game.gameNumber) && gameMatchesFilters(representative.analysis, game.gameNumber, filters))
      .sort((left, right) => left.gameNumber - right.gameNumber);
    if (orderedGames.length < 2 || orderedGames.some((game) => !game.myBattlefield?.trim())) continue;
    const sequence = orderedGames.map((game) => game.myBattlefield!.trim());
    const evidence = orderedGames.map((game) => battlefieldPickEvidence(
      scopes.find((scope) => scope.gameNumber === game.gameNumber) ?? representative,
      game.gameNumber,
      game.myBattlefield!.trim()
    ));
    const result = filters.gameStage !== "preboard" && filters.gameStage !== "postboard" && !filters.wentFirst && match.result !== "Incomplete"
      ? match.result
      : undefined;
    observations.push({ sequence, result, evidence });
  }

  const rows = new Map<string, {
    key: string;
    sequence: string[];
    results: Array<"Win" | "Loss" | "Draw">;
    evidence: ReplayInsightEvidence[];
    games: number;
  }>();
  for (const observation of observations) {
    const key = observation.sequence.map(normalizeText).join(" > ");
    const row = rows.get(key) ?? { key, sequence: observation.sequence, results: [], evidence: [], games: 0 };
    row.games += 1;
    if (observation.result) row.results.push(observation.result);
    row.evidence.push(...observation.evidence);
    rows.set(key, row);
  }
  return [...rows.values()].map((row): ReplayInsightBattlefieldPickOrder => {
    const outcome = summarizeResults(row.results);
    return {
      key: row.key,
      sequence: row.sequence,
      games: row.games,
      percentage: replayStatPercentage(row.games, observations.length),
      wins: outcome.wins,
      losses: outcome.losses,
      draws: outcome.draws,
      winRate: outcome.games ? outcome.winRate : undefined,
      sampleState: replayStatSampleState(row.games),
      evidence: row.evidence.slice(0, 12)
    };
  }).sort((left, right) => right.games - left.games || left.sequence.join(" ").localeCompare(right.sequence.join(" ")));
}

function battlefieldPickEvidence(
  scope: ReplayInsightEligibleGame,
  gameNumber: number,
  battlefieldName: string
): ReplayInsightEvidence {
  const event = scope.analysis.model.events.find((candidate) => (
    candidate.type === "battlefield"
    && replayTimelineEventGameNumber(scope.analysis, candidate) === gameNumber
    && candidate.battlefields?.some((battlefield) => battlefield.side === "me" && normalizeText(battlefield.name) === normalizeText(battlefieldName))
  ));
  if (event) {
    return rawTimelineEvidence(
      scope.analysis,
      event,
      scope.analysis.intelligence.events.find((candidate) => candidate.id === event.id)?.confidence ?? confidenceFromReplay(scope.analysis.replay),
      `Game ${gameNumber}: ${battlefieldName} selected`
    );
  }
  return {
    replayId: scope.analysis.replay.id,
    matchId: scope.analysis.match?.id || scope.analysis.replay.matchId,
    capturedAt: scope.analysis.match?.capturedAt || scope.analysis.replay.capturedAt,
    label: `Game ${gameNumber}: ${battlefieldName} recorded`,
    confidence: scope.analysis.match?.manualRepair ? "manual" : "reconstructed"
  };
}

function buildOutcomeSplits(
  games: Array<ReplayInsightEligibleGame & { result: "Win" | "Loss" | "Draw" }>,
  baselineWinRate: number
): ReplayInsightOutcomeSplit[] {
  const groups = new Map<string, {
    key: string;
    basis: "initiative" | "game-stage";
    label: string;
    results: Array<"Win" | "Loss" | "Draw">;
  }>();
  const add = (key: string, basis: "initiative" | "game-stage", label: string, result: "Win" | "Loss" | "Draw") => {
    const group = groups.get(key) ?? { key, basis, label, results: [] };
    group.results.push(result);
    groups.set(key, group);
  };
  for (const scope of games) {
    const game = scope.analysis.match?.games.find((candidate) => candidate.gameNumber === scope.gameNumber);
    if (game?.wentFirst === "1st") add("initiative:first", "initiative", "Went first", scope.result);
    if (game?.wentFirst === "2nd") add("initiative:second", "initiative", "Went second", scope.result);
    if (replayInsightHasTrustedGameStage(scope.analysis, scope.gameNumber)) {
      add(scope.gameNumber === 1 ? "stage:preboard" : "stage:postboard", "game-stage", scope.gameNumber === 1 ? "Game 1 / pre-board" : "Post-sideboard", scope.result);
    }
  }
  return [...groups.values()].map((group): ReplayInsightOutcomeSplit => {
    const outcome = summarizeResults(group.results);
    return {
      key: group.key,
      basis: group.basis,
      label: group.label,
      games: outcome.games,
      wins: outcome.wins,
      losses: outcome.losses,
      draws: outcome.draws,
      winRate: outcome.winRate,
      baselineWinRate,
      deltaPercentagePoints: replayStatDelta(outcome.winRate, baselineWinRate),
      sampleState: replayStatSampleState(outcome.games)
    };
  }).sort((left, right) => left.basis.localeCompare(right.basis) || left.key.localeCompare(right.key));
}

function replayStatPercentage(value: number, total: number): number {
  return total ? Number((value / total * 100).toFixed(1)) : 0;
}

function replayStatDelta(value: number, baseline: number): number {
  return Number((value - baseline).toFixed(1));
}

function replayStatSampleState(games: number): ReplayInsightStatSampleState {
  if (games < 5) return "insufficient";
  // Keep visible outcome summaries exploratory for much longer than the old n=10 gate.
  if (games < 30) return "early";
  return "established";
}

function replayStatCorrelationLabel(deltaPercentagePoints: number, baselineWinRate: number, baselineGames: number): string {
  const direction = deltaPercentagePoints > 0 ? "above" : deltaPercentagePoints < 0 ? "below" : "level with";
  const delta = Math.abs(deltaPercentagePoints);
  const comparison = direction === "level with"
    ? `level with the ${baselineWinRate}% baseline from ${baselineGames} game${baselineGames === 1 ? "" : "s"} where the card was known or visible by that player turn`
    : `${delta} percentage point${delta === 1 ? "" : "s"} ${direction} the ${baselineWinRate}% baseline from ${baselineGames} game${baselineGames === 1 ? "" : "s"} where the card was known or visible by that player turn`;
  return `Observed association: ${comparison}; this does not establish causation or recommend the play by itself.`;
}

function repairReplayInsightModel(
  replay: ReplayRecord,
  model: AtlasReplayViewModel,
  enrichmentEvents: ReplayStructuredEvent[]
): AtlasReplayViewModel {
  if (replay.platform !== "atlas" || (!model.events.length && !enrichmentEvents.length)) return model;

  const rawEvidence = buildRawEvidenceBuckets(enrichmentEvents);
  const compoundActionSide = compoundActionSideByEvent(model, replay);
  const explicitTurnSide = explicitTurnSideByEvent(model, replay);
  const patchedById = new Map<string, AtlasReplayViewModel["events"][number]>();

  for (const event of model.events) {
    const parsed = parseReplayCardActionText(event.text);
    const normalized = parsed && isCardActionType(event.type)
      ? {
          ...event,
          cardName: parsed.name || event.cardName,
          destination: parsed.destination || event.destination,
          fromZone: parsed.fromZone || event.fromZone,
          toZone: parsed.toZone || event.toZone
        }
      : event;
    const authoritative = takeRawEvidence(rawEvidence, normalized);
    const directSide = replaySideFromEvidenceText(normalized.text, replay);
    const compoundSide = normalized.type === "play"
      ? compoundActionSide.get(normalized.id)
      : undefined;
    const inferredSide = normalized.type === "play"
      ? explicitTurnSide.get(normalized.id)
      : undefined;
    const repairedSide = normalized.side === "me" || normalized.side === "opponent"
      ? normalized.side
      : authoritative?.side === "me" || authoritative?.side === "opponent"
        ? authoritative.side
        : directSide || compoundSide || inferredSide || normalized.side;
    const actionId = authoritative
      ? RAW_INSIGHT_ACTION_ID
      : repairedSide !== normalized.side && inferredSide === repairedSide
        ? TURN_ATTRIBUTED_ACTION_ID
        : normalized.actionId;
    patchedById.set(event.id, {
      ...normalized,
      gameNumber: authoritative?.gameNumber ?? normalized.gameNumber,
      side: repairedSide,
      cardName: authoritative?.cardName || normalized.cardName,
      cardId: authoritative?.cardId || normalized.cardId,
      destination: authoritative?.destination || normalized.destination,
      fromZone: authoritative?.fromZone || normalized.fromZone,
      toZone: authoritative?.toZone || normalized.toZone,
      visibility: authoritative?.visibility || normalized.visibility,
      evidence: authoritative?.evidence ?? normalized.evidence,
      actionId
    });
  }

  const appended = remainingRawEvidence(rawEvidence)
    .filter((event) => isReportableCard(event.cardName, event.cardId))
    .map(rawEvidenceTimelineEvent);
  const repairedEvents = [...model.events.map((event) => patchedById.get(event.id) ?? event), ...appended]
    .sort((left, right) => eventTime(left) - eventTime(right));

  return {
    ...model,
    events: repairedEvents,
    turns: attachEnrichmentEventsToTurns(model.turns.map((turn) => ({
      ...turn,
      events: turn.events.map((event) => patchedById.get(event.id) ?? event)
    })), appended)
  };
}

function buildRawEvidenceBuckets(events: ReplayStructuredEvent[]): Map<string, ReplayStructuredEvent[]> {
  const buckets = new Map<string, ReplayStructuredEvent[]>();
  for (const event of events) {
    if (!isCardActionType(event.type) || !event.cardName || (event.side !== "me" && event.side !== "opponent")) continue;
    const key = rawEvidenceKey(event);
    const bucket = buckets.get(key) ?? [];
    bucket.push(event);
    buckets.set(key, bucket);
  }
  return buckets;
}

function takeRawEvidence(
  buckets: Map<string, ReplayStructuredEvent[]>,
  event: AtlasReplayViewModel["events"][number]
): ReplayStructuredEvent | undefined {
  const bucket = buckets.get(rawEvidenceKey(event));
  return bucket?.shift();
}

function remainingRawEvidence(buckets: Map<string, ReplayStructuredEvent[]>): ReplayStructuredEvent[] {
  return [...buckets.values()].flatMap((events) => events);
}

function rawEvidenceTimelineEvent(event: ReplayStructuredEvent): ReplayTimelineEvent {
  return {
    id: event.id,
    capturedAt: event.capturedAt,
    gameNumber: event.gameNumber,
    labelTime: event.labelTime,
    type: event.type,
    side: event.side,
    text: event.text,
    cardName: event.cardName,
    cardId: event.cardId,
    cardCount: event.cardCount,
    destination: event.destination,
    fromZone: event.fromZone,
    toZone: event.toZone,
    visibility: event.visibility,
    actionId: RAW_INSIGHT_ACTION_ID,
    battlefield: event.battlefield,
    battlefields: event.battlefields,
    pointsScored: event.pointsScored,
    scoreReason: event.scoreReason,
    resource: event.resource,
    counter: event.counter,
    token: event.token,
    combat: event.combat,
    snapshot: event.snapshot,
    score: event.score,
    evidence: event.evidence
  };
}

function attachEnrichmentEventsToTurns(
  turns: AtlasReplayViewModel["turns"],
  events: ReplayTimelineEvent[]
): AtlasReplayViewModel["turns"] {
  if (!events.length || !turns.length) return turns;
  const next = turns.map((turn) => ({ ...turn, events: [...turn.events] }));
  for (const event of events) {
    const sameGame = next.filter((turn) => turn.events.some((item) => (item.gameNumber ?? 1) === (event.gameNumber ?? 1)));
    const candidates = sameGame.length ? sameGame : next;
    const eventAt = eventTime(event);
    const target = [...candidates]
      .filter((turn) => eventTime({ capturedAt: turn.startedAt }) <= eventAt)
      .sort((left, right) => eventTime({ capturedAt: right.startedAt }) - eventTime({ capturedAt: left.startedAt }))[0]
      ?? candidates[0];
    if (!target) continue;
    target.events.push(event);
    target.events.sort((left, right) => eventTime(left) - eventTime(right));
    if (event.capturedAt < target.startedAt) target.startedAt = event.capturedAt;
    if (event.capturedAt > target.endedAt) target.endedAt = event.capturedAt;
  }
  return next;
}

function rawEvidenceKey(event: { gameNumber?: number; type: ReplayStructuredEvent["type"]; text: string }): string {
  return `${event.gameNumber ?? 1}|${event.type}|${normalizeActionText(event.text)}`;
}

function normalizeActionText(value: string): string {
  return value
    .replace(/[\u21ba\u21bb]/g, "")
    .replace(/^\d{1,2}:\d{2}/, "")
    .replace(/[.。]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function explicitTurnSideByEvent(
  model: AtlasReplayViewModel,
  replay: ReplayRecord
): Map<string, "me" | "opponent"> {
  const sides = new Map<string, "me" | "opponent">();
  for (const turn of model.turns) {
    const start = turn.events.find((event) => event.type === "turn-start" && (
      event.side === "me" || event.side === "opponent" || replaySideFromEvidenceText(event.text, replay)
    ));
    if (!start) continue;
    const side = start.side === "me" || start.side === "opponent"
      ? start.side
      : replaySideFromEvidenceText(start.text, replay);
    if (!side) continue;
    const startedAt = eventTime(start);
    for (const event of turn.events) {
      if (eventTime(event) >= startedAt) sides.set(event.id, side);
    }
  }
  return sides;
}

function compoundActionSideByEvent(
  model: AtlasReplayViewModel,
  replay: ReplayRecord
): Map<string, "me" | "opponent"> {
  const compoundRows = model.events
    .map((event) => ({
      text: normalizeActionText(event.text),
      side: replaySideFromEvidenceText(event.text, replay)
    }))
    .filter((item): item is { text: string; side: "me" | "opponent" } => Boolean(item.side));
  const result = new Map<string, "me" | "opponent">();
  for (const event of model.events) {
    if (event.type !== "play" || (event.side !== "system" && event.side !== "unknown") || !event.cardName) continue;
    const action = normalizeActionText(event.text);
    if (!action) continue;
    const candidates = new Set(
      compoundRows
        .filter((row) => row.text !== action && row.text.includes(action))
        .map((row) => row.side)
    );
    if (candidates.size === 1) result.set(event.id, [...candidates][0]);
  }
  return result;
}

function replaySideFromEvidenceText(value: string, replay: ReplayRecord): "me" | "opponent" | "" {
  if (/^you\b/i.test(value) || /^your turn$/i.test(value)) return "me";
  if (/^opponent\b/i.test(value) || /^opponent['\u2019]?s turn$/i.test(value)) return "opponent";
  const owner = replayTurnOwnerFromText(value);
  const key = normalizePlayerIdentity(owner);
  if (key && key === normalizePlayerIdentity(replay.players.me)) return "me";
  if (key && key === normalizePlayerIdentity(replay.players.opponent)) return "opponent";
  return "";
}

function replayTurnOwnerFromText(value: string): string {
  const possessive = value.match(/(?:^|\bTurn\s+\d+\s*[·•|:-]?\s*)(.{1,48}?)['\u2019]s turn\b/i)?.[1]
    ?? value.match(/^(.{1,48}?)['\u2019]s turn\b/i)?.[1];
  if (possessive) return possessive.trim();
  return value.match(/\bTurn\s+\d+\s*[·•|:-]\s*(.{1,48}?)(?=\d{1,2}:\d{2}|(?:started|starting)\s+turn\b|[·•|]|$)/i)?.[1]?.trim() ?? "";
}

function normalizePlayerIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isCardActionType(type: ReplayStructuredEvent["type"]): boolean {
  return type === "play" || type === "move" || type === "draw" || type === "action";
}

function collectOpeningHandInsights(
  analysis: ReplayAnalysis,
  gameNumber: number,
  catalog: Map<string, ReplayInsightCardCatalogEntry>,
  insights: ReplayInsightDraft[],
  reports: Map<string, MutableCardReport>,
  gameStage: ReplayInsightGameStage
): void {
  const mulligans = analysis.openingHandEvents.filter((event) =>
    event.gameNumber === gameNumber
      && gameStageIncludesTrustedEvent(analysis, event, gameStage)
      && Boolean(
        event.mulligan?.options?.length
        || event.mulligan?.kept?.length
        || event.mulligan?.redrawn?.length
      )
  );
  const gameKey = `${analysis.replay.id}:${gameNumber}`;
  const openingCardStates = new Map<string, {
    card: ReplayStructuredCard;
    offered: boolean;
    kept: boolean;
    redrawn: boolean;
    evidence: ReplayInsightEvidence;
    reviewGrade: boolean;
    confidences: ReplayIntelligenceConfidence[];
  }>();
  const recordOpeningCards = (
    cards: ReplayStructuredCard[],
    state: "offered" | "kept" | "redrawn",
    evidence: ReplayInsightEvidence
  ) => {
    for (const card of uniqueCards(cards)) {
      if (isChosenChampionCard(analysis, gameNumber, catalog, card.name, card.code || card.id)) continue;
      const key = canonicalCardKey(catalog, card.name, card.code || card.id);
      if (!key) continue;
      const current = openingCardStates.get(key) ?? {
        card,
        offered: false,
        kept: false,
        redrawn: false,
        evidence,
        reviewGrade: evidence.confidence !== "inferred",
        confidences: []
      };
      current[state] = true;
      current.reviewGrade = current.reviewGrade && evidence.confidence !== "inferred";
      current.confidences.push(evidence.confidence);
      openingCardStates.set(key, current);
    }
  };
  for (const mulligan of mulligans) {
    const evidence = rawEventEvidence(analysis, mulligan, "Opening hand recorded");
    const kept = mulligan.mulligan?.kept ?? [];
    const redrawn = mulligan.mulligan?.redrawn ?? [];
    const offered = mulligan.mulligan?.options?.length
      ? mulligan.mulligan.options
      : [...kept, ...redrawn];
    recordOpeningCards(offered, "offered", evidence);
    recordOpeningCards(kept, "kept", evidence);
    recordOpeningCards(redrawn, "redrawn", evidence);
  }
  for (const state of openingCardStates.values()) {
    const report = mutableCardReport(reports, state.card.name, state.card.code || state.card.id, catalog);
    const reviewGradeOpening = state.reviewGrade;
    if (state.kept) report.kept += 1;
    if (reviewGradeOpening && state.offered) report.mulliganOfferedGames.add(gameKey);
    if (reviewGradeOpening && state.kept) {
      report.mulliganKeptGames.add(gameKey);
      report.prePlayObservedGames.add(gameKey);
    }
    if (reviewGradeOpening && state.redrawn) report.mulliganRedrawnGames.add(gameKey);
    report.confidences.push(lowestConfidence(state.confidences));
    report.replayIds.add(analysis.replay.id);
    report.evidence.push(state.evidence);

    if (reviewGradeOpening && state.kept) {
      const offeredAt = Date.parse(state.evidence.capturedAt);
      const matchingPlays = analysis.intelligence.events.filter((event) => (
        event.gameNumber === gameNumber
          && event.side === "me"
          && event.type === "play"
          && (!Number.isFinite(offeredAt) || eventTime(event) >= offeredAt)
          && canonicalCardKey(catalog, event.cardName, event.cardId)
             === canonicalCardKey(catalog, state.card.name, state.card.code || state.card.id)
      ));
      const firstReviewGradePlay = matchingPlays.find((event) => event.confidence !== "inferred");
      if (firstReviewGradePlay) {
        report.prePlayLaterPlayedGames.add(gameKey);
      } else if (!matchingPlays.length && replayInsightHasCompleteEnoughPlayCapture(analysis, gameNumber)) {
        report.prePlayNoCapturedPlayGames.add(gameKey);
      }
    }
  }
  for (const mulligan of mulligans) {
    const keptCards = (mulligan.mulligan?.kept ?? []).filter((card) => (
      !isChosenChampionCard(analysis, gameNumber, catalog, card.name, card.code || card.id)
    ));
    const redrawCount = mulligan.mulligan?.redrawCount ?? mulligan.mulligan?.redrawn?.length ?? 0;
    const mulliganEvidence = rawEventEvidence(analysis, mulligan, "Opening hand recorded");
    const keptHasTwoDrop = keptCards.some((card) => cardCost(catalog, card) === 2);
    const knownCosts = keptCards.map((card) => cardCost(catalog, card)).filter((cost): cost is number => cost != null);

    if (knownCosts.length && !keptHasTwoDrop) {
      const returnedAtLeastTwo = redrawCount >= 2;
      insights.push({
        id: insightId(analysis.replay.id, gameNumber, "two-drop-search", String(redrawCount)),
        scope: "match",
        category: "opening-hand",
        tone: returnedAtLeastTwo ? "positive" : "opportunity",
        priority: returnedAtLeastTwo ? 58 : 94,
        title: returnedAtLeastTwo
          ? `You returned ${redrawCount} cards with no known 2-cost keep`
          : "The keep contained no known 2-cost card",
        body: returnedAtLeastTwo
          ? `No 2-cost card was visible among the kept cards, and the capture recorded ${redrawCount} returned cards.`
          : `No 2-cost card was visible among the kept cards, but only ${redrawCount} card${redrawCount === 1 ? " was" : "s were"} returned.`,
        action: returnedAtLeastTwo
          ? "Keep tracking whether the replacement cards produced a smoother opening."
          : "When no 2-drop is visible, review whether returning at least two cards would create a stronger turn-two plan.",
        confidence: mulliganEvidence.confidence,
        sampleSize: 1,
        replayId: analysis.replay.id,
        matchId: analysis.replay.matchId,
        gameNumber,
        playerLegend: analysis.match?.myChampion,
        opponentLegend: analysis.match?.opponentChampion,
        evidence: [mulliganEvidence]
      });
    }

    for (const card of uniqueCards(keptCards)) {
      if (isChosenChampionCard(analysis, gameNumber, catalog, card.name, card.code || card.id)) continue;
      const key = canonicalCardKey(catalog, card.name, card.code || card.id);
      if (!key) continue;
      const matchingEvents = analysis.intelligence.events.filter((event) =>
        event.gameNumber === gameNumber
          && event.side === "me"
          && eventTime(event) >= eventTime(mulligan)
          && canonicalCardKey(catalog, event.cardName, event.cardId) === key
      );
      const anyPlay = matchingEvents.find((event) => event.type === "play");
      const firstPlay = matchingEvents.find((event) => event.type === "play" && event.confidence !== "inferred");
      const drawnBeforePlay = matchingEvents.some((event) =>
        event.type === "draw"
          && event.confidence !== "inferred"
          && (!firstPlay || eventTime(event) <= eventTime(firstPlay))
      );
      const context = firstPlay ? analysis.turnByEvent.get(firstPlay.id) : undefined;
      const confidence = drawnBeforePlay
        ? "inferred"
        : lowestConfidence([mulliganEvidence.confidence, ...(firstPlay ? [firstPlay.confidence] : [])]);
      const report = mutableCardReport(reports, card.name, card.code || card.id, catalog);
      report.confidences.push(confidence);
      report.replayIds.add(analysis.replay.id);
      report.evidence.push(mulliganEvidence);

      if (firstPlay && context && context.side === "me" && context.playerTurnNumber >= LATE_OPENING_PLAY_TURN) {
        if (confidence !== "inferred") {
          report.lateKeeps += 1;
          report.mulliganLatePlayedGames.add(gameKey);
        }
        const playEvidence = eventEvidence(analysis, firstPlay, `First captured play on your turn ${context.playerTurnNumber}`);
        report.evidence.push(playEvidence);
        insights.push({
          id: insightId(analysis.replay.id, gameNumber, "late-opening-card", key),
          scope: "match",
          category: "opening-hand",
          tone: "opportunity",
          priority: 96,
          title: `${card.name}'s first captured play was on your turn ${context.playerTurnNumber}`,
          body: drawnBeforePlay
            ? `This game included a kept copy of ${card.name}; the first review-grade play of that card name was on your turn ${context.playerTurnNumber}, after another copy was drawn.`
            : `This game included a keep of ${card.name}; the first review-grade play of that card name was on your turn ${context.playerTurnNumber}. The played copy cannot be linked to the kept copy.`,
          action: "Review whether the keep supported your early plan or whether this slot could have searched for a faster card.",
          confidence,
          sampleSize: 1,
          replayId: analysis.replay.id,
          matchId: analysis.replay.matchId,
          gameNumber,
          cardName: card.name,
          cardId: card.code || card.id,
          playerLegend: analysis.match?.myChampion,
          opponentLegend: analysis.match?.opponentChampion,
          evidence: [mulliganEvidence, playEvidence]
        });
      } else if (!anyPlay && replayInsightHasCompleteEnoughPlayCapture(analysis, gameNumber)) {
        insights.push({
          id: insightId(analysis.replay.id, gameNumber, "unplayed-opening-card", key),
          scope: "match",
          category: "opening-hand",
          tone: "watch",
          priority: 88,
          title: `No play of ${card.name} was captured in a game with a keep`,
          body: `RiftLite captured a keep of ${card.name} and captured no play of that card name before the completed game ended. Multiple copies cannot be distinguished.`,
          action: "Check whether the card provided useful flexibility, became stranded, or should have been part of the redraw.",
          confidence: mulliganEvidence.confidence,
          sampleSize: 1,
          replayId: analysis.replay.id,
          matchId: analysis.replay.matchId,
          gameNumber,
          cardName: card.name,
          cardId: card.code || card.id,
          playerLegend: analysis.match?.myChampion,
          opponentLegend: analysis.match?.opponentChampion,
          evidence: [mulliganEvidence]
        });
      } else if (firstPlay && context && context.side === "me" && cardCost(catalog, card) === 2 && context.playerTurnNumber <= 2) {
        const playEvidence = eventEvidence(analysis, firstPlay, `Played on your turn ${context.playerTurnNumber}`);
        insights.push({
          id: insightId(analysis.replay.id, gameNumber, "opening-plan-worked", key),
          scope: "match",
          category: "positive",
          tone: "positive",
          priority: 62,
          title: `A keep game included a ${card.name} play by your turn ${context.playerTurnNumber}`,
          body: `This game included a keep of the 2-cost card name and a play of that name on your turn ${context.playerTurnNumber}; RiftLite cannot prove it was the same copy.`,
          action: "This is useful evidence for how the deck wants its opening hand to function.",
          confidence,
          sampleSize: 1,
          replayId: analysis.replay.id,
          matchId: analysis.replay.matchId,
          gameNumber,
          cardName: card.name,
          cardId: card.code || card.id,
          playerLegend: analysis.match?.myChampion,
          opponentLegend: analysis.match?.opponentChampion,
          evidence: [mulliganEvidence, playEvidence]
        });
      }
    }
  }
}

function collectCurveInsights(
  analysis: ReplayAnalysis,
  gameNumber: number,
  insights: ReplayInsightDraft[],
  matchupPatterns: Map<string, MatchupPattern>
): void {
  const playerTurns = analysis.model.turns.filter((turn) =>
    turn.side === "me" && turn.events.some((event) => event.gameNumber === gameNumber)
  );
  if (
    playerTurns.length < 2
    || analysis.intelligence.summary.coverage.grade === "limited"
    || !replayInsightHasCompleteEnoughPlayCapture(analysis, gameNumber)
  ) return;
  const firstTwo = playerTurns.slice(0, 2);
  const playCounts = firstTwo.map((turn) => turn.events.filter((event) =>
    event.side === "me" && event.type === "play" && event.gameNumber === gameNumber
  ).length);
  const secondTurnAnchor = firstTwo[1]?.events[0];
  if (!secondTurnAnchor) return;
  const anchor = analysis.intelligence.events.find((event) => event.id === secondTurnAnchor.id);
  const confidence = anchor?.confidence ?? confidenceFromReplay(analysis.replay);
  const evidence = anchor
    ? eventEvidence(analysis, anchor, "Your second turn")
    : rawTimelineEvidence(analysis, secondTurnAnchor, confidence, "Your second turn");
  const slowStart = playCounts[0] === 0 && playCounts[1] === 0;

  if (slowStart) {
    insights.push({
      id: insightId(analysis.replay.id, gameNumber, "slow-start"),
      scope: "match",
      category: "curve",
      tone: "opportunity",
      priority: 91,
      title: "No card play was captured during your first two turns",
      body: "The complete-enough captured action contains two player turns without a recorded card play. RiftLite cannot determine whether that was intentional or forced by runes, resources or matchup context.",
      action: "Review the opening hand and rune development to identify what delayed the first play.",
      confidence,
      sampleSize: 1,
      replayId: analysis.replay.id,
      matchId: analysis.replay.matchId,
      gameNumber,
      playerLegend: analysis.match?.myChampion,
      opponentLegend: analysis.match?.opponentChampion,
      evidence: [evidence]
    });
  } else if (playCounts[1] === 0) {
    insights.push({
      id: insightId(analysis.replay.id, gameNumber, "turn-two-gap"),
      scope: "match",
      category: "curve",
      tone: "watch",
      priority: 76,
      title: "Your second turn contained no captured card play",
      body: "You developed on the first turn, but RiftLite captured no card play on the following player turn.",
      action: "Check whether this was intentional setup or a gap in the deck's early curve.",
      confidence,
      sampleSize: 1,
      replayId: analysis.replay.id,
      matchId: analysis.replay.matchId,
      gameNumber,
      playerLegend: analysis.match?.myChampion,
      opponentLegend: analysis.match?.opponentChampion,
      evidence: [evidence]
    });
  }

  const opponentLegend = analysis.match?.opponentChampion?.trim() ?? "";
  if (opponentLegend) {
    const key = normalizeText(opponentLegend);
    const pattern = matchupPatterns.get(key) ?? {
      opponentLegend,
      games: 0,
      slowStarts: 0,
      evidence: [],
      confidences: [],
      replayIds: new Set()
    };
    pattern.games += 1;
    pattern.slowStarts += slowStart ? 1 : 0;
    if (slowStart) pattern.evidence.push(evidence);
    pattern.confidences.push(confidence);
    pattern.replayIds.add(analysis.replay.id);
    matchupPatterns.set(key, pattern);
  }
}

function collectScoreInsights(analysis: ReplayAnalysis, gameNumber: number, insights: ReplayInsightDraft[]): void {
  const firstScore = analysis.intelligence.events.find((event) =>
    event.gameNumber === gameNumber
      && event.side === "me"
      && (event.type === "score" || event.type === "scoreboard")
      && ((event.pointsScored ?? 0) > 0 || scoreIncreaseForMe(event))
  );
  if (!firstScore) return;
  const context = analysis.turnByEvent.get(firstScore.id);
  if (!context || context.playerTurnNumber < 3) return;
  const turnMoment = replayInsightPlayerTurnMoment(context);
  insights.push({
    id: insightId(analysis.replay.id, gameNumber, "late-first-score"),
    scope: "match",
    category: "battlefield",
    tone: "watch",
    priority: 67,
    title: `Your first captured score occurred ${turnMoment}`,
    body: `This was the first scoring event attributed to you in the captured timeline. The observation alone does not show whether an earlier scoring line was available.`,
    action: "Watch the turns before this score and check whether an earlier contest or conquest was available.",
    confidence: firstScore.confidence,
    sampleSize: 1,
    replayId: analysis.replay.id,
    matchId: analysis.replay.matchId,
    gameNumber,
    playerLegend: analysis.match?.myChampion,
    opponentLegend: analysis.match?.opponentChampion,
    evidence: [eventEvidence(analysis, firstScore, `First captured score ${turnMoment}`)]
  });
}

function collectCardJourneyInsights(
  analysis: ReplayAnalysis,
  gameNumber: number,
  catalog: Map<string, ReplayInsightCardCatalogEntry>,
  insights: ReplayInsightDraft[],
  reports: Map<string, MutableCardReport>,
  gameStage: ReplayInsightGameStage
): void {
  const completePlayCapture = replayInsightHasCompleteEnoughPlayCapture(analysis, gameNumber);
  const openingKeys = new Set(
    analysis.openingHandEvents
      .filter((event) => (
        event.gameNumber === gameNumber
          && gameStageIncludesTrustedEvent(analysis, event, gameStage)
          && rawEventEvidence(analysis, event, "Opening hand recorded").confidence !== "inferred"
      ))
      .flatMap((event) => event.mulligan?.kept ?? [])
      .map((card) => canonicalCardKey(catalog, card.name, card.code || card.id))
  );
  const journeyGroups = new Map<string, ReplayIntelligenceCardJourney[]>();
  for (const journey of analysis.intelligence.summary.cardJourneys) {
    if (journey.gameNumber !== gameNumber || journey.side !== "me" || !isReportableCard(journey.cardName, journey.cardId, catalog)) continue;
    if (isChosenChampionCard(analysis, gameNumber, catalog, journey.cardName, journey.cardId)) continue;
    const key = canonicalCardKey(catalog, journey.cardName, journey.cardId);
    if (!key) continue;
    const group = journeyGroups.get(key) ?? [];
    group.push(journey);
    journeyGroups.set(key, group);
  }
  for (const [key, journeys] of journeyGroups) {
    const gameKey = `${analysis.replay.id}:${gameNumber}`;
    const journey = journeys.find((item) => item.cardId) ?? journeys[0];
    const outcomes = new Set(journeys.flatMap((item) => item.outcomes));
    const confidence = lowestConfidence(journeys.map((item) => item.confidence));
    const knownHandTimeMs = Math.max(0, ...journeys.map((item) => item.knownHandTimeMs ?? 0)) || undefined;
    const report = mutableCardReport(reports, journey.cardName, journey.cardId, catalog);
    const journeyEvents = journeys.flatMap((item) => item.events)
      .map((item) => analysis.intelligence.events.find((event) => event.id === item.eventId))
      .filter((event): event is ReplayIntelligenceEvent => Boolean(event))
      .filter((event, index, events) => events.findIndex((candidate) => candidate.id === event.id) === index)
      .sort((left, right) => eventTime(left) - eventTime(right));
    if (gameStage !== "all" && !journeyEvents.some((event) => gameStageIncludesTrustedEvent(analysis, event, gameStage))) continue;

    const firstEntry = journeyEvents.find((event) => event.type === "draw" || normalizeZone(event.toZone || event.destination) === "hand");
    const firstReviewGradeEntry = journeyEvents.find((event) => (
      event.confidence !== "inferred"
        && gameStageIncludesTrustedEvent(analysis, event, gameStage)
        && (event.type === "draw" || normalizeZone(event.toZone || event.destination) === "hand")
    ));
    const firstPlay = journeyEvents.find((event) => event.type === "play");
    const firstReviewGradePlay = journeyEvents.find((event) => (
      event.type === "play"
        && event.confidence !== "inferred"
        && gameStageIncludesTrustedEvent(analysis, event, gameStage)
    ));
    const reviewGradeRecycleOrDiscard = journeyEvents.some((event) => (
      event.confidence !== "inferred"
        && gameStageIncludesTrustedEvent(analysis, event, gameStage)
        && replayInsightEventIsRecycleOrDiscard(event)
    ));
    // An unattributed play may belong to this game. Keep the verified recycle/
    // discard observation, but fail closed on any claim that no play happened.
    const hasUntrustedStagePlayForCard = analysis.intelligence.events.some((event) => (
      event.type === "play"
        && event.side === "me"
        && trustedGameStageForEvent(analysis, event) === "unknown"
        && canonicalCardKey(catalog, event.cardName, event.cardId) === key
    ));

    report.appearances += 1;
    if (firstReviewGradePlay) {
      report.played += 1;
      const playStage = trustedGameStageForEvent(analysis, firstReviewGradePlay);
      if (playStage === "preboard") report.playedPreboardGames.add(gameKey);
      else if (playStage === "postboard") report.playedPostboardGames.add(gameKey);
      else report.playedUnknownStageGames.add(gameKey);
    }
    if (completePlayCapture && (!firstPlay || firstReviewGradePlay)) {
      report.completePlayCaptureAppearances += 1;
      if (!firstPlay) report.unplayed += 1;
    }
    if (reviewGradeRecycleOrDiscard) report.recycledOrDiscarded += 1;
    report.confidences.push(confidence);
    report.replayIds.add(analysis.replay.id);
    if (knownHandTimeMs && confidence !== "inferred") {
      report.handTimeTotalMs += knownHandTimeMs;
      report.handTimeSamples += 1;
    }

    if (firstReviewGradePlay) {
      const playTurn = analysis.turnByEvent.get(firstReviewGradePlay.id);
      if (playTurn?.side === "me" && playTurn.playerTurnNumber >= 1 && playTurn.playerTurnNumber <= 3) {
        report.firstPlayByTurn3Games.add(gameKey);
      } else if (playTurn?.side === "me" && playTurn.playerTurnNumber >= 4 && playTurn.playerTurnNumber <= 5) {
        report.firstPlayTurns4To5Games.add(gameKey);
      } else if (playTurn?.side === "me" && playTurn.playerTurnNumber >= 6) {
        report.firstPlayTurn6PlusGames.add(gameKey);
      } else {
        report.firstPlayUnknownTurnGames.add(gameKey);
      }
    }
    const firstEntryIndex = firstReviewGradeEntry ? journeyEvents.findIndex((event) => event.id === firstReviewGradeEntry.id) : -1;
    const firstPlayIndex = firstReviewGradePlay ? journeyEvents.findIndex((event) => event.id === firstReviewGradePlay.id) : -1;
    const knownBeforePlay = openingKeys.has(key)
      || (firstEntryIndex >= 0 && (firstPlayIndex < 0 || firstEntryIndex < firstPlayIndex));
    if (knownBeforePlay) {
      report.prePlayObservedGames.add(gameKey);
      if (reviewGradeRecycleOrDiscard) {
        report.prePlayRecycledOrDiscardedGames.add(gameKey);
      }
      if (firstReviewGradePlay && (openingKeys.has(key) || firstEntryIndex < firstPlayIndex)) {
        report.prePlayLaterPlayedGames.add(gameKey);
      } else if (!firstPlay && completePlayCapture) report.prePlayNoCapturedPlayGames.add(gameKey);
    }
    if (firstReviewGradeEntry && firstReviewGradePlay && firstEntryIndex < firstPlayIndex) {
      const entryTurn = analysis.turnByEvent.get(firstReviewGradeEntry.id);
      const playTurn = analysis.turnByEvent.get(firstReviewGradePlay.id);
      if (entryTurn && playTurn && entryTurn.turnNumber === playTurn.turnNumber) report.immediatePlays += 1;
    }
    const firstEvidenceEvent = firstEntry ?? journeyEvents[0];
    if (firstEvidenceEvent) report.evidence.push(eventEvidence(analysis, firstEvidenceEvent, `${journey.cardName} became visible`));

    if (
      !openingKeys.has(key)
      && outcomes.has("drawn")
      && !outcomes.has("played")
      && !hasUntrustedStagePlayForCard
      && (completePlayCapture || outcomes.has("recycled") || outcomes.has("discarded"))
      && ((knownHandTimeMs ?? 0) >= LONG_HAND_TIME_MS || outcomes.has("recycled") || outcomes.has("discarded"))
    ) {
      const outcome = outcomes.has("recycled")
        ? "recycled"
        : outcomes.has("discarded")
          ? "discarded"
          : "left without a captured play";
      insights.push({
        id: insightId(analysis.replay.id, gameNumber, "drawn-unplayed", key),
        scope: "match",
        category: "card-efficiency",
        tone: "watch",
        priority: 74,
        title: `No play of ${journey.cardName} was captured after it entered hand`,
        body: `${journey.cardName} became visible in hand and was ${outcome}${knownHandTimeMs ? ` after about ${shortDuration(knownHandTimeMs)} of captured elapsed time` : ""}. Card copies cannot always be distinguished.`,
        action: "Review whether the card served a useful holding role or was awkward in this game state.",
        confidence,
        sampleSize: 1,
        replayId: analysis.replay.id,
        matchId: analysis.replay.matchId,
        gameNumber,
        cardName: journey.cardName,
        cardId: journey.cardId,
        playerLegend: analysis.match?.myChampion,
        opponentLegend: analysis.match?.opponentChampion,
        evidence: journeyEvents.slice(0, 4).map((event) => eventEvidence(analysis, event, event.text || event.type))
      });
    }
  }
}

function collectCardPatterns(
  reports: Map<string, MutableCardReport>,
  minimumSample: number,
  insights: ReplayInsightDraft[]
): void {
  for (const report of reports.values()) {
    // Unknown names remain available in the diagnostic card report, but a
    // recurring Coach claim requires a stable registry identity. This keeps a
    // malformed raw token (or an as-yet ambiguous future card) out of the hero.
    if (!report.catalogResolved) continue;
    if (
      report.completePlayCaptureAppearances >= minimumSample
      && report.unplayed >= 2
      && report.unplayed / report.completePlayCaptureAppearances >= 0.5
    ) {
      insights.push(patternInsight(report, {
        id: "often-unplayed",
        category: "card-efficiency",
        tone: "opportunity",
        priority: 90,
        title: `${report.cardName} often appeared without a matched play`,
        body: `RiftLite saw ${report.cardName} in ${report.completePlayCaptureAppearances} complete-enough captured game appearances and matched no play to it in ${report.unplayed}. Card copies cannot always be distinguished.`,
        action: "Review the examples and label whether the card was intentionally held, converted for value, or stranded."
      }));
    }
    if (report.kept >= minimumSample && report.lateKeeps >= 2 && report.lateKeeps / report.kept >= 0.5) {
      insights.push(patternInsight(report, {
        id: "late-after-keep",
        category: "opening-hand",
        tone: "opportunity",
        priority: 95,
        title: `${report.cardName} keep games often also had a late card-name play`,
        body: `${report.kept} captured games included a keep of ${report.cardName}; ${report.lateKeeps} of those games first showed a play of that card name on your turn ${LATE_OPENING_PLAY_TURN} or later. The played copy may be different.`,
        action: "Test redrawing this card more aggressively unless the matchup specifically rewards holding it."
      }));
    }
    if (
      report.appearances >= minimumSample
      && report.recycledOrDiscarded >= 2
      && report.recycledOrDiscarded / report.appearances >= 0.4
    ) {
      insights.push(patternInsight(report, {
        id: "converted-away",
        category: "card-efficiency",
        tone: "watch",
        priority: 82,
        title: `${report.cardName} was repeatedly captured as recycled or discarded`,
        body: `${report.cardName} was captured as recycled or discarded in ${report.recycledOrDiscarded} of ${report.appearances} analyzed appearances.`,
        action: "Check whether this flexibility is the card's job or a sign that another card would be useful more often."
      }));
    }
    if (report.played >= minimumSample && report.immediatePlays >= minimumSample && report.immediatePlays / report.played >= 0.7) {
      insights.push(patternInsight(report, {
        id: "immediate-impact",
        category: "positive",
        tone: "positive",
        priority: 68,
        title: `${report.cardName} repeatedly entered hand and was played in the same turn`,
        body: `${report.cardName} entered hand and had a captured play in the same captured turn ${report.immediatePlays} times.`,
        action: "This is positive evidence that the card is useful when drawn rather than becoming stranded."
      }));
    }
    if (report.handTimeSamples >= minimumSample && report.handTimeTotalMs / report.handTimeSamples >= LONG_HAND_TIME_MS) {
      const average = Math.round(report.handTimeTotalMs / report.handTimeSamples);
      insights.push(patternInsight(report, {
        id: "long-hand-time",
        category: "card-efficiency",
        tone: "watch",
        priority: 79,
        title: `${report.cardName} has long captured hand intervals`,
        body: `Across ${report.handTimeSamples} measured journeys, ${report.cardName} remained known in hand for an average of about ${shortDuration(average)} of captured elapsed time, which can include opponent thinking time and pauses.`,
        action: "Review whether it is being saved intentionally or waiting for conditions the deck rarely creates."
      }));
    }
  }
}

function collectMatchupPatterns(
  patterns: Map<string, MatchupPattern>,
  minimumSample: number,
  insights: ReplayInsightDraft[]
): void {
  for (const pattern of patterns.values()) {
    if (pattern.games < minimumSample || pattern.slowStarts < 2 || pattern.slowStarts / pattern.games < 0.5) continue;
    insights.push({
      id: `pattern:matchup-slow-start:${normalizeText(pattern.opponentLegend)}`,
      scope: "pattern",
      category: "matchup",
      tone: "opportunity",
      priority: 87,
      title: `No early play was repeatedly captured against ${pattern.opponentLegend}`,
      body: `${pattern.slowStarts} of ${pattern.games} complete-enough captured games against ${pattern.opponentLegend} contained no recorded card play during your first two turns.`,
      action: "Compare those opening hands and consider a more matchup-specific mulligan or rune plan.",
      confidence: lowestConfidence(pattern.confidences),
      sampleSize: pattern.games,
      opponentLegend: pattern.opponentLegend,
      evidence: pattern.evidence.slice(0, 6),
      sourceReplayIds: [...pattern.replayIds]
    });
  }
}

function patternInsight(
  report: MutableCardReport,
  content: Pick<ReplayInsightDraft, "category" | "tone" | "priority" | "title" | "body" | "action"> & { id: string }
): ReplayInsightDraft {
  return {
    id: `pattern:card:${report.key}:${content.id}`,
    scope: "pattern",
    category: content.category,
    tone: content.tone,
    priority: content.priority,
    title: content.title,
    body: content.body,
    action: content.action,
    confidence: lowestConfidence(report.confidences),
    sampleSize: Math.max(report.appearances, report.kept),
    cardName: report.cardName,
    cardId: report.cardId,
    evidence: report.evidence.slice(0, 6),
    sourceReplayIds: [...report.replayIds]
  };
}

function mutableCardReport(
  reports: Map<string, MutableCardReport>,
  cardName: string,
  cardId: string | undefined,
  catalog: Map<string, ReplayInsightCardCatalogEntry>
): MutableCardReport {
  const catalogCard = catalog.get(cardKey(cardId)) ?? catalog.get(cardKey(cardName));
  const key = cardKey(catalogCard?.code || cardId || cardName);
  const existing = reports.get(key);
  if (existing) return existing;
  const report: MutableCardReport = {
    key,
    cardName: catalogCard?.name || cardName || cardId || "Known card",
    cardId: catalogCard?.code || cardId,
    imageUrl: catalogCard?.imageUrl,
    catalogResolved: Boolean(catalogCard),
    appearances: 0,
    kept: 0,
    played: 0,
    unplayed: 0,
    completePlayCaptureAppearances: 0,
    recycledOrDiscarded: 0,
    lateKeeps: 0,
    immediatePlays: 0,
    handTimeTotalMs: 0,
    handTimeSamples: 0,
    mulliganOfferedGames: new Set(),
    mulliganKeptGames: new Set(),
    mulliganRedrawnGames: new Set(),
    mulliganLatePlayedGames: new Set(),
    prePlayObservedGames: new Set(),
    prePlayLaterPlayedGames: new Set(),
    prePlayNoCapturedPlayGames: new Set(),
    prePlayRecycledOrDiscardedGames: new Set(),
    firstPlayByTurn3Games: new Set(),
    firstPlayTurns4To5Games: new Set(),
    firstPlayTurn6PlusGames: new Set(),
    firstPlayUnknownTurnGames: new Set(),
    playedPreboardGames: new Set(),
    playedPostboardGames: new Set(),
    playedUnknownStageGames: new Set(),
    confidences: [],
    replayIds: new Set(),
    evidence: []
  };
  reports.set(key, report);
  return report;
}

function finalizeCardReport(report: MutableCardReport): ReplayInsightCardReport {
  return {
    key: report.key,
    cardName: report.cardName,
    cardId: report.cardId,
    imageUrl: report.imageUrl,
    appearances: Math.max(report.appearances, report.kept),
    kept: report.kept,
    played: report.played,
    unplayed: report.unplayed,
    completePlayCaptureAppearances: report.completePlayCaptureAppearances,
    recycledOrDiscarded: report.recycledOrDiscarded,
    lateKeeps: report.lateKeeps,
    immediatePlays: report.immediatePlays,
    averageKnownHandTimeMs: report.handTimeSamples ? Math.round(report.handTimeTotalMs / report.handTimeSamples) : undefined,
    mulligan: {
      offeredGames: report.mulliganOfferedGames.size,
      keptGames: report.mulliganKeptGames.size,
      redrawnGames: report.mulliganRedrawnGames.size,
      latePlayedGames: report.mulliganLatePlayedGames.size
    },
    prePlayHand: {
      observedGames: report.prePlayObservedGames.size,
      laterPlayedGames: report.prePlayLaterPlayedGames.size,
      noCapturedPlayGames: report.prePlayNoCapturedPlayGames.size,
      recycledOrDiscardedGames: report.prePlayRecycledOrDiscardedGames.size
    },
    firstPlayTurns: {
      byTurn3Games: report.firstPlayByTurn3Games.size,
      turns4To5Games: report.firstPlayTurns4To5Games.size,
      turn6PlusGames: report.firstPlayTurn6PlusGames.size,
      unknownTurnGames: report.firstPlayUnknownTurnGames.size
    },
    playReach: {
      preboardGames: report.playedPreboardGames.size,
      postboardGames: report.playedPostboardGames.size,
      unknownStageGames: report.playedUnknownStageGames.size
    },
    confidence: lowestConfidence(report.confidences),
    replayIds: [...report.replayIds]
  };
}

function buildTurnContext(model: AtlasReplayViewModel): Map<string, ReplayInsightTurnContext> {
  const context = new Map<string, ReplayInsightTurnContext>();
  const playerTurnByGame = new Map<number, number>();
  const gameTurnByGame = new Map<number, number>();
  for (const turn of model.turns) {
    const gameNumber = turn.events.find((event) => event.gameNumber)?.gameNumber ?? 1;
    const explicitStart = turn.events.find((event) => event.type === "turn-start");
    const explicitSide = explicitStart?.side === "me" || explicitStart?.side === "opponent"
      ? explicitStart.side
      : turn.side;
    const countedTurn = Boolean(explicitStart) || replayInsightTurnHasSubstantiveEvidence(turn, explicitSide);
    const turnNumber = countedTurn
      ? (gameTurnByGame.get(gameNumber) ?? 0) + 1
      : gameTurnByGame.get(gameNumber) ?? 0;
    if (countedTurn) gameTurnByGame.set(gameNumber, turnNumber);
    const playerTurnNumber = countedTurn && explicitSide === "me"
      ? (playerTurnByGame.get(gameNumber) ?? 0) + 1
      : playerTurnByGame.get(gameNumber) ?? 0;
    if (countedTurn && explicitSide === "me") playerTurnByGame.set(gameNumber, playerTurnNumber);
    for (const event of turn.events) {
      context.set(event.id, { gameNumber, turnNumber, playerTurnNumber, side: explicitSide, label: turn.label });
    }
  }
  return context;
}

function replayInsightPlayerTurnMoment(context: ReplayInsightTurnContext): string {
  if (context.side === "me") return `during your turn ${context.playerTurnNumber}`;
  if (context.side === "opponent") {
    return context.playerTurnNumber > 0
      ? `during the opponent's turn after your turn ${context.playerTurnNumber}`
      : "during the opponent's turn before your first turn";
  }
  return context.playerTurnNumber > 0
    ? `after your turn ${context.playerTurnNumber}`
    : "before your first turn";
}

function replayInsightTurnHasSubstantiveEvidence(
  turn: AtlasReplayViewModel["turns"][number],
  side: ReplayInsightTurnContext["side"]
): boolean {
  if (side !== "me" && side !== "opponent") return false;
  if (/\bsetup\b|opening hand|battlefields?/i.test(turn.label)) return false;
  return turn.events.some((event) => (
    event.type === "play"
    || event.type === "move"
    || event.type === "draw"
    || event.type === "combat"
    || event.type === "score"
    || event.type === "action"
    || event.type === "turn-end"
  ));
}

function replayGameNumbers(analysis: ReplayAnalysis): number[] {
  const numbers = new Set<number>();
  for (const event of analysis.intelligence.events) numbers.add(event.gameNumber ?? 1);
  for (const event of analysis.replay.structuredEvents ?? []) numbers.add(event.gameNumber || 1);
  for (const game of analysis.match?.games ?? []) numbers.add(game.gameNumber);
  if (!numbers.size) numbers.add(1);
  return [...numbers].sort((left, right) => left - right);
}

function replayMatchesFilters(
  replay: ReplayRecord,
  match: MatchDraft | undefined,
  filters: ReplayInsightFilters,
  now: Date
): boolean {
  if (filters.rangeDays && filters.rangeDays > 0) {
    const capturedAt = Date.parse(replay.capturedAt);
    const cutoff = now.getTime() - filters.rangeDays * 86_400_000;
    if (!Number.isFinite(capturedAt) || capturedAt < cutoff) return false;
  }
  if (filters.period && filters.period !== "all" && replayInsightPeriod(replay.capturedAt) !== filters.period) return false;
  if (filters.deckKey) {
    const deckValues = [match?.deckSourceId, match?.deckSourceKey, match?.deckName].map(normalizeText);
    if (!deckValues.includes(normalizeText(filters.deckKey))) return false;
  }
  if (filters.playerLegend && normalizeText(match?.myChampion ?? "") !== normalizeText(filters.playerLegend)) return false;
  if (filters.opponentLegend && normalizeText(match?.opponentChampion ?? "") !== normalizeText(filters.opponentLegend)) return false;
  if (filters.format && match?.format !== filters.format) return false;
  return true;
}

function gameMatchesFilters(analysis: ReplayAnalysis, gameNumber: number, filters: ReplayInsightFilters): boolean {
  const match = analysis.match;
  if (
    filters.gameStage !== undefined
      && filters.gameStage !== "all"
      && !replayInsightHasTrustedGameStage(analysis, gameNumber)
  ) return false;
  if (filters.gameStage === "preboard" && gameNumber !== 1) return false;
  if (filters.gameStage === "postboard" && gameNumber <= 1) return false;
  if (filters.wentFirst) {
    const game = match?.games.find((item) => item.gameNumber === gameNumber);
    if (game?.wentFirst !== filters.wentFirst) return false;
  }
  return true;
}

function replayInsightHasTrustedGameStage(analysis: ReplayAnalysis, gameNumber: number): boolean {
  if (!analysis.trustGameStage || gameNumber < 1 || gameNumber > 3) return false;
  return analysis.model.events.some((event) => event.gameNumber === gameNumber)
    || analysis.openingHandEvents.some((event) => event.gameNumber === gameNumber);
}

function buildCardCatalog(entries: Iterable<ReplayInsightCardCatalogEntry>): Map<string, ReplayInsightCardCatalogEntry> {
  const catalog = new Map<string, ReplayInsightCardCatalogEntry>();
  for (const entry of entries) {
    const codeKeys = riftboundCardCodeAliases(entry.code).map(cardKey);
    const nameKey = cardKey(entry.name);
    for (const codeKey of codeKeys) {
      if (codeKey && !catalog.has(codeKey)) catalog.set(codeKey, entry);
    }
    if (nameKey && !catalog.has(nameKey)) catalog.set(nameKey, entry);
  }
  return catalog;
}

function buildChosenChampionIdentitiesByGame(
  events: ReplayStructuredEvent[],
  catalog: Map<string, ReplayInsightCardCatalogEntry>
): Map<number, Set<string>> {
  const result = new Map<number, Set<string>>();
  for (const event of events) {
    if (event.side !== "me" || (!event.cardName && !event.cardId)) continue;
    const hasChosenChampionRole = event.actionId === RAW_CHOSEN_CHAMPION_ACTION_ID
      || [event.fromZone, event.toZone, event.destination].some(isChosenChampionZone);
    if (!hasChosenChampionRole) continue;
    const gameNumber = event.gameNumber;
    if (typeof gameNumber !== "number" || gameNumber < UNTRUSTED_GAME_NUMBER || gameNumber > 3) continue;
    const identities = result.get(gameNumber) ?? new Set<string>();
    for (const identity of cardIdentityTokens(catalog, event.cardName, event.cardId)) identities.add(identity);
    if (identities.size) result.set(gameNumber, identities);
  }
  return result;
}

function isChosenChampionCard(
  analysis: ReplayAnalysis,
  gameNumber: number,
  catalog: Map<string, ReplayInsightCardCatalogEntry>,
  cardName: string,
  cardId?: string
): boolean {
  const identities = analysis.chosenChampionIdentitiesByGame.get(gameNumber);
  if (!identities?.size) return false;
  return cardIdentityTokens(catalog, cardName, cardId).some((identity) => identities.has(identity));
}

function cardIdentityTokens(
  catalog: Map<string, ReplayInsightCardCatalogEntry>,
  cardName: string,
  cardId?: string
): string[] {
  const catalogCard = catalog.get(cardKey(cardId)) ?? catalog.get(cardKey(cardName));
  const identities = new Set<string>();
  for (const code of [cardId, catalogCard?.code]) {
    const baseCode = riftboundBasePrintCode(code ?? "");
    if (baseCode) identities.add(`code:${cardKey(baseCode)}`);
  }
  for (const name of [cardName, catalogCard?.name]) {
    const nameKey = cardKey(name);
    if (nameKey) identities.add(`name:${nameKey}`);
  }
  return [...identities];
}

function isChosenChampionZone(value?: string): boolean {
  const zone = normalizeZone(value ?? "");
  return zone === "champion" || zone === "chosen-champion" || zone === "selected-champion";
}

function canonicalCardKey(
  catalog: Map<string, ReplayInsightCardCatalogEntry>,
  cardName: string,
  cardId?: string
): string {
  const catalogCard = catalog.get(cardKey(cardId)) ?? catalog.get(cardKey(cardName));
  const code = catalogCard?.code || cardId;
  return cardKey(riftboundBasePrintCode(code ?? "") || code || cardName);
}

function isReportableCard(
  cardName: string,
  cardId?: string,
  catalog: Map<string, ReplayInsightCardCatalogEntry> = new Map()
): boolean {
  if (catalog.get(cardKey(cardId)) || catalog.get(cardKey(cardName))) return true;
  const name = normalizeText(cardName || cardId || "");
  if (!name) return false;
  if (/^\d+$/.test(name)) return false;
  if (/^(?:unknown|known) card$/.test(name)) return false;
  if (/^(?:a|an|\d+) cards?(?: from .+)?$/.test(name)) return false;
  if (/^cards?(?: from .+)?$/.test(name)) return false;
  if (/\btoken\b/.test(name)) return false;
  return true;
}

function cardCost(catalog: Map<string, ReplayInsightCardCatalogEntry>, card: ReplayStructuredCard): number | null {
  const entry = catalog.get(cardKey(card.code || card.id)) ?? catalog.get(cardKey(card.name));
  return typeof entry?.costEnergy === "number" ? entry.costEnergy : null;
}

function rawEventEvidence(analysis: ReplayAnalysis, event: ReplayStructuredEvent, label: string): ReplayInsightEvidence {
  return {
    replayId: analysis.replay.id,
    matchId: analysis.replay.matchId,
    eventId: event.id,
    capturedAt: event.capturedAt,
    videoTimeMs: replayEventVideoTimeMs(analysis.replay, event),
    label,
    confidence: event.evidence?.confidence ?? (event.id.startsWith("raw-opening:")
      ? "reconstructed"
      : analysis.replay.platform === "sim" || analysis.replay.platform === "atlas"
        ? "confirmed"
        : "reconstructed")
  };
}

function eventEvidence(analysis: ReplayAnalysis, event: ReplayIntelligenceEvent, label: string): ReplayInsightEvidence {
  return {
    replayId: analysis.replay.id,
    matchId: analysis.replay.matchId,
    eventId: event.id,
    capturedAt: event.capturedAt,
    videoTimeMs: event.videoTimeMs,
    label,
    confidence: event.confidence
  };
}

function rawTimelineEvidence(
  analysis: ReplayAnalysis,
  event: AtlasReplayViewModel["events"][number],
  confidence: ReplayIntelligenceConfidence,
  label: string
): ReplayInsightEvidence {
  return {
    replayId: analysis.replay.id,
    matchId: analysis.replay.matchId,
    eventId: event.id,
    capturedAt: event.capturedAt,
    videoTimeMs: replayEventVideoTimeMs(analysis.replay, event),
    label,
    confidence
  };
}

function buildReportCoverage(analyses: ReplayAnalysis[]): ReplayInsightsCoverage {
  const confirmedEvents = analyses.reduce((total, item) => total + item.intelligence.summary.coverage.confirmed, 0);
  const reconstructedEvents = analyses.reduce((total, item) => total + item.intelligence.summary.coverage.reconstructed, 0);
  const inferredEvents = analyses.reduce((total, item) => total + item.intelligence.summary.coverage.inferred, 0);
  const manualEvents = analyses.reduce((total, item) => total + item.intelligence.summary.coverage.manual, 0);
  const namedCardJourneys = analyses.reduce((total, item) => total + item.intelligence.summary.cardJourneys.filter((journey) => (
    isReportableCard(journey.cardName, journey.cardId)
  )).length, 0);
  const replaysWithStructuredEvents = analyses.filter((item) => item.replay.structuredEvents?.length).length;
  const evidenceTotal = confirmedEvents + reconstructedEvents + inferredEvents + manualEvents;
  const reliable = confirmedEvents + manualEvents + reconstructedEvents * 0.65 + inferredEvents * 0.3;
  const ratio = evidenceTotal ? reliable / evidenceTotal : 0;
  const grade = analyses.length >= 3 && evidenceTotal >= 30 && ratio >= 0.75
    ? "high"
    : analyses.length >= 1 && evidenceTotal >= 5 && ratio >= 0.5
      ? "medium"
      : "limited";
  return {
    grade,
    replaysWithStructuredEvents,
    namedCardJourneys,
    confirmedEvents,
    reconstructedEvents,
    inferredEvents,
    manualEvents
  };
}

function buildReplayInsightsScopeReceipt(scopedGames: ReplayInsightEligibleGame[]): ReplayInsightsScopeReceipt {
  const periodGameCounts: Record<ReplayInsightPeriod, number> = {
    preseason: 0,
    "current-season": 0,
    unknown: 0
  };
  const deckVersionGames = new Map<string, number>();
  let unknownDeckGames = 0;
  for (const scope of scopedGames) {
    const period = replayInsightPeriod(scope.analysis.replay.capturedAt);
    periodGameCounts[period] += 1;
    const fingerprint = scope.analysis.deckFingerprint;
    if (fingerprint) deckVersionGames.set(fingerprint, (deckVersionGames.get(fingerprint) ?? 0) + 1);
    else unknownDeckGames += 1;
  }
  const dates = scopedGames.map((scope) => scope.analysis.replay.capturedAt).filter(isValidInsightDate).sort();
  return {
    currentSeasonStartedOn: MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON,
    periods: orderedReplayInsightPeriods(Object.entries(periodGameCounts)
      .filter(([, count]) => count > 0)
      .map(([period]) => period as ReplayInsightPeriod)),
    periodGameCounts,
    deckVersions: [...deckVersionGames.entries()]
      .map(([fingerprint, games]) => ({ fingerprint, games }))
      .sort((left, right) => right.games - left.games || left.fingerprint.localeCompare(right.fingerprint)),
    unknownDeckGames,
    observedFrom: dates[0],
    observedThrough: dates.at(-1)
  };
}

function finalizeReplayInsight(
  draft: ReplayInsightDraft,
  eligibleGames: ReplayInsightEligibleGame[]
): ReplayInsight {
  const { sourceReplayIds, ...insight } = draft;
  const replayIds = new Set([
    ...(sourceReplayIds ?? []),
    ...(draft.replayId ? [draft.replayId] : []),
    ...draft.evidence.map((evidence) => evidence.replayId)
  ]);
  const matchingGames = eligibleGames.filter((scope) => (
    replayIds.has(scope.analysis.replay.id)
    && (draft.scope !== "match" || draft.gameNumber == null || scope.gameNumber === draft.gameNumber)
  ));
  const receiptGames = draft.scope === "match" ? matchingGames : deduplicateEligibleGames(matchingGames);
  const completedScopeGames = receiptGames.filter((scope) => Boolean(
    replayInsightGameResult(scope.analysis, scope.gameNumber)
  )).length;
  const completePlayCaptureScopeGames = receiptGames.filter((scope) => (
    replayInsightHasCompleteEnoughPlayCapture(scope.analysis, scope.gameNumber)
  )).length;
  const playCaptureStatus: ReplayInsightPlayCaptureStatus = receiptGames.length > 0 && completePlayCaptureScopeGames === receiptGames.length
    ? "complete-enough"
    : completePlayCaptureScopeGames > 0
      ? "mixed"
      : "limited";
  const dates = receiptGames.map((scope) => scope.analysis.replay.capturedAt).filter(isValidInsightDate).sort();
  const deckFingerprints = [...new Set(receiptGames
    .map((scope) => scope.analysis.deckFingerprint)
    .filter((fingerprint): fingerprint is string => Boolean(fingerprint)))].sort();
  const periods = orderedReplayInsightPeriods(receiptGames.map((scope) => (
    replayInsightPeriod(scope.analysis.replay.capturedAt)
  )));
  return {
    ...insight,
    captureConfidence: draft.confidence,
    patternStrength: replayInsightPatternStrength(draft.scope === "match" ? 1 : draft.sampleSize),
    claimBasis: "observational",
    dataReceipt: {
      observationCount: draft.sampleSize,
      scopeGames: receiptGames.length,
      completedScopeGames,
      completePlayCaptureScopeGames,
      playCaptureStatus,
      linkedReplays: replayIds.size,
      deckFingerprints,
      periods,
      observedFrom: dates[0],
      observedThrough: dates.at(-1)
    }
  };
}

function replayInsightPatternStrength(observations: number): ReplayInsightPatternStrength {
  if (observations <= 1) return "single-observation";
  if (observations < 10) return "exploratory";
  if (observations < 30) return "developing";
  return "reasonably-stable";
}

function replayInsightPeriod(capturedAt: string): ReplayInsightPeriod {
  const captured = Date.parse(capturedAt);
  const boundary = Date.parse(`${MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON}T00:00:00.000Z`);
  if (!Number.isFinite(captured) || !Number.isFinite(boundary)) return "unknown";
  return captured < boundary ? "preseason" : "current-season";
}

function orderedReplayInsightPeriods(periods: ReplayInsightPeriod[]): ReplayInsightPeriod[] {
  const found = new Set(periods);
  return (["preseason", "current-season", "unknown"] as ReplayInsightPeriod[]).filter((period) => found.has(period));
}

function isValidInsightDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function deduplicateInsights(insights: ReplayInsightDraft[]): ReplayInsightDraft[] {
  const byId = new Map<string, ReplayInsightDraft>();
  for (const insight of insights) {
    const current = byId.get(insight.id);
    if (!current || insight.priority > current.priority) byId.set(insight.id, insight);
  }
  return [...byId.values()];
}

function uniqueCards(cards: ReplayStructuredCard[]): ReplayStructuredCard[] {
  const found = new Map<string, ReplayStructuredCard>();
  for (const card of cards) {
    const key = cardKey(card.code || card.id || card.name);
    if (key && !found.has(key)) found.set(key, card);
  }
  return [...found.values()];
}

function lowestConfidence(values: ReplayIntelligenceConfidence[]): ReplayIntelligenceConfidence {
  if (!values.length) return "inferred";
  if (values.includes("inferred")) return "inferred";
  if (values.includes("reconstructed")) return "reconstructed";
  if (values.includes("manual")) return "manual";
  return "confirmed";
}

function confidenceFromReplay(replay: ReplayRecord): ReplayIntelligenceConfidence {
  if (replay.platform === "sim" || replay.platform === "atlas" && replay.structuredEvents?.length) return "confirmed";
  if (replay.platform === "tcga" || replay.structuredEvents?.length) return "reconstructed";
  return "inferred";
}

function scoreIncreaseForMe(event: ReplayIntelligenceEvent): boolean {
  return typeof event.score?.me === "number" && event.score.me > 0;
}

function cardKey(value = ""): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeText(value = ""): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeZone(value = ""): string {
  return cardKey(value);
}

function replayInsightEventIsRecycleOrDiscard(event: ReplayIntelligenceEvent): boolean {
  const destination = normalizeZone(event.toZone || event.destination);
  return destination.includes("recycle")
    || destination.includes("discard")
    || destination.includes("trash")
    || /\brecycl|\bdiscard|\btrash/i.test(event.text);
}

function insightId(replayId: string, gameNumber: number, kind: string, detail = ""): string {
  return ["match", replayId, gameNumber, kind, detail].filter(Boolean).join(":");
}

function eventTime(event: Pick<ReplayStructuredEvent | ReplayIntelligenceEvent, "capturedAt">): number {
  const parsed = Date.parse(event.capturedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortDuration(valueMs: number): string {
  const seconds = Math.max(1, Math.round(valueMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function replayInsightEventsFromRawPayload(
  replay: ReplayRecord,
  payload: unknown
): ReplayStructuredEvent[] {
  try {
    const model = buildRiftLiteReplayModel(payload, {
      id: replay.id,
      title: replay.title,
      localName: replay.players.me,
      opponentName: replay.players.opponent,
      localLegend: replay.matchSnapshot?.myChampion,
      opponentLegend: replay.matchSnapshot?.opponentChampion,
      format: replay.matchSnapshot?.format
    });
    return [
      ...rawChosenChampionSetupEvents(replay, model),
      ...rawOpeningHandEvents(replay, model),
      ...rawCardActionEvents(replay, model)
    ];
  } catch {
    return [];
  }
}

export function replayInsightOpeningHandEventsFromRawPayload(
  replay: ReplayRecord,
  payload: unknown
): ReplayStructuredEvent[] {
  return replayInsightEventsFromRawPayload(replay, payload).filter((event) => event.type === "mulligan");
}

function rawChosenChampionSetupEvents(replay: ReplayRecord, model: RiftLiteReplayModel): ReplayStructuredEvent[] {
  const result: ReplayStructuredEvent[] = [];
  const recordedGames = new Set<number | "unknown">();
  for (const frame of model.frames) {
    const gameNumber = frame.gameNumber ?? UNTRUSTED_GAME_NUMBER;
    const gameKey = gameNumber || "unknown";
    if (recordedGames.has(gameKey)) continue;
    const champion = frame.local.champion
      ?? frame.local.zones.champion?.cards.find((card) => Boolean(card.name || card.code));
    if (!champion || (!champion.name && !champion.code)) continue;
    recordedGames.add(gameKey);
    const capturedAt = typeof frame.ts === "number" && Number.isFinite(frame.ts)
      ? new Date(frame.ts).toISOString()
      : replay.capturedAt;
    result.push({
      id: `raw-chosen-champion:${replay.id}:${gameKey}`,
      sourceEventId: champion.id || frame.id,
      gameNumber,
      capturedAt,
      labelTime: "Game setup",
      type: "setup",
      side: "me",
      text: `${champion.name || champion.code} starts in the chosen Champion zone`,
      cardName: champion.name || champion.code,
      cardId: champion.code || undefined,
      destination: "champion",
      toZone: "champion",
      battlefield: "",
      visibility: "public",
      actionId: RAW_CHOSEN_CHAMPION_ACTION_ID
    });
  }
  return result;
}

function rawOpeningHandEvents(replay: ReplayRecord, model: RiftLiteReplayModel): ReplayStructuredEvent[] {
  const frame = model.frames.find((item) => item.stage === "openingHands" && item.mulligan?.localFinalHand?.length)
    ?? model.frames.find((item) => item.mulligan?.localFinalHand?.length);
  const mulligan = frame?.mulligan;
  const original = mulligan?.localOriginalHand ?? [];
  const final = mulligan?.localFinalHand ?? [];
  if (!frame || !final.length) return [];
  const kept = cardsSharedBetweenHands(original.length ? original : final, final);
  const redrawn = mulligan?.localMulliganedCards ?? [];
  const capturedAt = typeof frame.ts === "number" && Number.isFinite(frame.ts)
    ? new Date(frame.ts).toISOString()
    : replay.capturedAt;
  return [{
      id: `raw-opening:${replay.id}:${frame.gameNumber ?? "unknown"}`,
      sourceEventId: frame.id,
      gameNumber: frame.gameNumber ?? UNTRUSTED_GAME_NUMBER,
      capturedAt,
      labelTime: "Opening hand",
      type: "mulligan",
      side: "me",
      text: "Opening hand reconstructed from retained local RiftAtlas state",
      cardName: "",
      destination: "hand",
      battlefield: "",
      visibility: "private-local",
      mulligan: {
        options: original.map(rawReplayCardToStructured),
        kept: kept.map(rawReplayCardToStructured),
        redrawn: redrawn.map(rawReplayCardToStructured),
        redrawCount: Math.max(mulligan?.localMulligans ?? 0, redrawn.length)
      }
    }];
}

function rawCardActionEvents(replay: ReplayRecord, model: RiftLiteReplayModel): ReplayStructuredEvent[] {
  const result: ReplayStructuredEvent[] = [];
  for (const event of model.events) {
    if (event.label !== "Chat" || !event.detail) continue;
    const parsed = parseReplayCardActionText(event.detail);
    if (!parsed || parsed.kind === "reveal" || !parsed.name) continue;
    const side = rawReplayEventSide(model, event);
    if (!side) continue;
    const cardEvidence = nearbyRawCardEvidence(model, event, parsed.name, side);
    const destination = parsed.destination || cardEvidence?.card?.zone || "";
    const capturedAt = typeof event.ts === "number" && Number.isFinite(event.ts)
      ? new Date(event.ts).toISOString()
      : replay.capturedAt;
    const gameNumber = rawReplayEventGameNumber(model, event) ?? UNTRUSTED_GAME_NUMBER;
    result.push({
      id: `raw-action:${replay.id}:${event.id}`,
      sourceEventId: event.id,
      gameNumber,
      capturedAt,
      labelTime: event.timeLabel,
      type: parsed.kind,
      side,
      text: event.detail,
      cardName: cardEvidence?.card?.name || parsed.name,
      cardId: cardEvidence?.card?.code || undefined,
      destination,
      fromZone: parsed.fromZone,
      toZone: parsed.toZone || destination || undefined,
      visibility: "public",
      battlefield: "",
      actionId: RAW_INSIGHT_ACTION_ID
    });
  }
  return result;
}

function rawReplayEventSide(model: RiftLiteReplayModel, event: RiftLiteReplayEvent): "me" | "opponent" | "" {
  const player = event.playerId
    ? model.players.find((candidate) => candidate.id === event.playerId)
    : undefined;
  const side = player?.side || event.card?.side;
  if (side === "local") return "me";
  if (side === "opponent") return "opponent";
  return "";
}

function nearbyRawCardEvidence(
  model: RiftLiteReplayModel,
  event: RiftLiteReplayEvent,
  cardName: string,
  side: "me" | "opponent"
): RiftLiteReplayEvent | undefined {
  const eventAt = typeof event.ts === "number" ? event.ts : Number.NaN;
  return model.events.find((candidate) => {
    if (!candidate.card || normalizeText(candidate.card.name) !== normalizeText(cardName)) return false;
    if (rawReplayEventSide(model, candidate) !== side) return false;
    if (!Number.isFinite(eventAt) || typeof candidate.ts !== "number") return candidate.frameIndex === event.frameIndex;
    return Math.abs(candidate.ts - eventAt) <= 5_000;
  });
}

function rawReplayEventGameNumber(model: RiftLiteReplayModel, event: RiftLiteReplayEvent): number | undefined {
  const direct = model.frames[event.frameIndex]?.gameNumber;
  if (direct) return direct;
  const containing = model.frames.find((frame) => frame.events.some((candidate) => candidate.id === event.id));
  return containing?.gameNumber;
}

function cardsSharedBetweenHands(original: RiftLiteReplayCard[], final: RiftLiteReplayCard[]): RiftLiteReplayCard[] {
  const remaining = new Map<string, number>();
  for (const card of final) {
    const key = cardKey(card.code || card.key || card.name);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const kept: RiftLiteReplayCard[] = [];
  for (const card of original) {
    const key = cardKey(card.code || card.key || card.name);
    const count = remaining.get(key) ?? 0;
    if (!count) continue;
    kept.push(card);
    remaining.set(key, count - 1);
  }
  return kept;
}

function rawReplayCardToStructured(card: RiftLiteReplayCard): ReplayStructuredCard {
  return {
    id: card.id || card.key || card.code || card.name,
    name: card.name,
    code: card.code,
    type: "card",
    imageUrl: card.imageUrl
  };
}
