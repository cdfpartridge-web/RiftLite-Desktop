export const REPLAY_COACHING_STORAGE_VERSION = 1 as const;
export const REPLAY_COACHING_STORAGE_KEY = "riftlite:replay-coaching:v1";

export type ReplayInsightReflection =
  | "intentional"
  | "missed"
  | "forced"
  | "unsure"
  | "wrong"
  | "already-understood";

export type ReplayCoachingLifecycle =
  | "new"
  | "reviewed"
  | "hypothesis"
  | "testing"
  | "learned"
  | "adjusted"
  | "paused";

export type ReplayCoachingGameStage = "preboard" | "postboard";
export type ReplayCoachingInitiative = "1st" | "2nd";
export type ReplayCoachingAdherence = "followed" | "missed" | "unsure" | "not-applicable";
export type ReplayCoachingGameResult = "Win" | "Loss" | "Draw" | "Incomplete";

/** A renderer-independent copy of the insight fields needed by a coaching focus. */
export interface ReplayCoachingInsightSnapshot {
  id: string;
  title: string;
  body?: string;
  action?: string;
  category?: string;
  scope?: string;
  confidence?: string;
  sampleSize?: number;
  replayId?: string;
  matchId?: string;
  gameNumber?: number;
  cardName?: string;
  cardId?: string;
  opponentLegend?: string;
}

/** A small provenance snapshot; it deliberately does not retain the full report. */
export interface ReplayCoachingReportSnapshot {
  generatedAt?: string;
  replaysAnalyzed?: number;
  matchesAnalyzed?: number;
  gamesAnalyzed?: number;
  coverageGrade?: string;
  scope?: ReplayCoachingEligibilityScope;
}

export interface ReplayCoachingEligibilityScope {
  deckKey?: string;
  opponentLegend?: string;
  gameStage?: ReplayCoachingGameStage;
  initiative?: ReplayCoachingInitiative;
}

export interface ReplayCoachingGameSnapshot {
  id: string;
  capturedAt: string;
  replayId?: string;
  matchId?: string;
  gameNumber?: number;
  deckKey?: string;
  opponentLegend?: string;
  gameStage?: ReplayCoachingGameStage;
  initiative?: ReplayCoachingInitiative;
  result?: ReplayCoachingGameResult;
}

export interface ReplayCoachingReflectionRecord {
  value: ReplayInsightReflection;
  note?: string;
  recordedAt: string;
}

export interface ReplayCoachingStatusEntry {
  status: ReplayCoachingLifecycle;
  recordedAt: string;
  note?: string;
}

export interface ReplayCoachingProcessCounts {
  eligibleGames: number;
  followed: number;
  missed: number;
  unsure: number;
  notApplicable: number;
}

export interface ReplayCoachingProcessMetrics extends ReplayCoachingProcessCounts {
  opportunities: number;
  assessedOpportunities: number;
  adherenceRate?: number;
}

export interface ReplayCoachingGameObservation extends ReplayCoachingGameSnapshot {
  adherence: ReplayCoachingAdherence;
  note?: string;
  recordedAt: string;
}

export interface ReplayCoachingExperiment {
  id: string;
  hypothesis: string;
  process: string;
  successSignal?: string;
  targetEligibleGames: 3 | 4 | 5;
  baseline: ReplayCoachingProcessCounts;
  games: ReplayCoachingGameObservation[];
  createdAt: string;
  startedAt?: string;
}

export interface ReplayCoachingFocus {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ReplayCoachingLifecycle;
  insight: ReplayCoachingInsightSnapshot;
  report?: ReplayCoachingReportSnapshot;
  eligibility: ReplayCoachingEligibilityScope;
  reflection?: ReplayCoachingReflectionRecord;
  experiment?: ReplayCoachingExperiment;
  statusHistory: ReplayCoachingStatusEntry[];
}

export interface ReplayCoachingStore {
  version: typeof REPLAY_COACHING_STORAGE_VERSION;
  updatedAt: string;
  activeFocusId?: string;
  focuses: ReplayCoachingFocus[];
}

export interface CreateReplayCoachingFocusInput {
  id?: string;
  insight: ReplayCoachingInsightSnapshot;
  report?: ReplayCoachingReportSnapshot;
  eligibility?: ReplayCoachingEligibilityScope;
  now?: string | Date;
}

export interface ReplayCoachingExperimentDefinition {
  id?: string;
  hypothesis: string;
  process: string;
  successSignal?: string;
  targetEligibleGames?: number;
  baseline?: Partial<ReplayCoachingProcessCounts>;
}

export interface ReplayCoachingProgress {
  targetEligibleGames: number;
  eligibleGamesTracked: number;
  gamesRemaining: number;
  readyForReview: boolean;
  before: ReplayCoachingProcessMetrics;
  during: ReplayCoachingProcessMetrics;
  adherenceDeltaPercentagePoints?: number;
  results: {
    wins: number;
    losses: number;
    draws: number;
    incomplete: number;
  };
}

export type ReplayCoachingRecordReason = "not-testing" | "no-experiment" | "ineligible" | "duplicate" | "target-complete";

export interface ReplayCoachingRecordResult {
  focus: ReplayCoachingFocus;
  recorded: boolean;
  reason?: ReplayCoachingRecordReason;
}

export interface ReplayCoachingParseResult {
  store: ReplayCoachingStore;
  migrated: boolean;
  discardedFocuses: number;
}

const REFLECTIONS = new Set<ReplayInsightReflection>([
  "intentional", "missed", "forced", "unsure", "wrong", "already-understood"
]);
const LIFECYCLES = new Set<ReplayCoachingLifecycle>([
  "new", "reviewed", "hypothesis", "testing", "learned", "adjusted", "paused"
]);
const ADHERENCE_VALUES = new Set<ReplayCoachingAdherence>([
  "followed", "missed", "unsure", "not-applicable"
]);
const RESULTS = new Set<ReplayCoachingGameResult>(["Win", "Loss", "Draw", "Incomplete"]);
const MAX_FOCUSES = 100;
const MAX_TEXT = 4_000;

const ALLOWED_TRANSITIONS: Record<ReplayCoachingLifecycle, ReadonlySet<ReplayCoachingLifecycle>> = {
  new: new Set(["reviewed", "hypothesis", "paused"]),
  reviewed: new Set(["hypothesis", "paused"]),
  hypothesis: new Set(["testing", "adjusted", "paused"]),
  testing: new Set(["learned", "adjusted", "paused"]),
  learned: new Set(["adjusted", "paused"]),
  adjusted: new Set(["hypothesis", "testing", "learned", "paused"]),
  paused: new Set(["reviewed", "hypothesis", "testing", "learned", "adjusted"])
};

export function emptyReplayCoachingStore(now: string | Date = new Date()): ReplayCoachingStore {
  return {
    version: REPLAY_COACHING_STORAGE_VERSION,
    updatedAt: isoDate(now),
    focuses: []
  };
}

export function createReplayCoachingFocus(input: CreateReplayCoachingFocusInput): ReplayCoachingFocus {
  const recordedAt = isoDate(input.now ?? new Date());
  const insight = copyInsightSnapshot(input.insight);
  const report = input.report ? copyReportSnapshot(input.report) : undefined;
  const eligibility = normalizeReplayCoachingEligibility({
    ...report?.scope,
    ...input.eligibility
  });
  const focus: ReplayCoachingFocus = {
    id: boundedText(input.id) || `focus:${slug(insight.id)}:${recordedAt}`,
    createdAt: recordedAt,
    updatedAt: recordedAt,
    status: "new",
    insight,
    eligibility,
    statusHistory: [{ status: "new", recordedAt }]
  };
  if (report) focus.report = report;
  return focus;
}

export function reflectOnReplayInsight(
  focus: ReplayCoachingFocus,
  value: ReplayInsightReflection,
  note?: string,
  now: string | Date = new Date()
): ReplayCoachingFocus {
  const recordedAt = isoDate(now);
  const next: ReplayCoachingFocus = {
    ...focus,
    updatedAt: recordedAt,
    reflection: {
      value,
      recordedAt,
      ...(boundedText(note) ? { note: boundedText(note) } : {})
    }
  };
  return focus.status === "new" ? withStatus(next, "reviewed", recordedAt) : next;
}

export function replayCoachingCanTransition(
  from: ReplayCoachingLifecycle,
  to: ReplayCoachingLifecycle
): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].has(to);
}

/** Invalid transitions are a safe no-op so a stale UI cannot corrupt local state. */
export function transitionReplayCoachingFocus(
  focus: ReplayCoachingFocus,
  status: ReplayCoachingLifecycle,
  note?: string,
  now: string | Date = new Date()
): ReplayCoachingFocus {
  if (!replayCoachingCanTransition(focus.status, status) || focus.status === status) return focus;
  return withStatus(focus, status, isoDate(now), note);
}

export function defineReplayCoachingExperiment(
  focus: ReplayCoachingFocus,
  definition: ReplayCoachingExperimentDefinition,
  now: string | Date = new Date()
): ReplayCoachingFocus {
  const recordedAt = isoDate(now);
  const targetEligibleGames = clampTargetGames(definition.targetEligibleGames);
  const experiment: ReplayCoachingExperiment = {
    id: boundedText(definition.id) || `experiment:${slug(focus.id)}:${recordedAt}`,
    hypothesis: boundedText(definition.hypothesis),
    process: boundedText(definition.process),
    targetEligibleGames,
    baseline: replayCoachingProcessCounts(definition.baseline),
    games: [],
    createdAt: recordedAt,
    ...(boundedText(definition.successSignal) ? { successSignal: boundedText(definition.successSignal) } : {})
  };
  const next = { ...focus, experiment, updatedAt: recordedAt };
  return focus.status === "hypothesis"
    ? next
    : withStatus(next, "hypothesis", recordedAt, "Experiment defined");
}

export function startReplayCoachingExperiment(
  focus: ReplayCoachingFocus,
  now: string | Date = new Date()
): ReplayCoachingFocus {
  if (!focus.experiment || !focus.experiment.hypothesis || !focus.experiment.process) return focus;
  const recordedAt = isoDate(now);
  const next = {
    ...focus,
    updatedAt: recordedAt,
    experiment: {
      ...focus.experiment,
      startedAt: focus.experiment.startedAt ?? recordedAt
    }
  };
  if (focus.status === "testing") return next;
  if (!replayCoachingCanTransition(focus.status, "testing")) return focus;
  return withStatus(next, "testing", recordedAt, "Experiment started");
}

export function normalizeReplayCoachingEligibility(
  scope: ReplayCoachingEligibilityScope | null | undefined
): ReplayCoachingEligibilityScope {
  if (!scope) return {};
  const next: ReplayCoachingEligibilityScope = {};
  if (boundedText(scope.deckKey)) next.deckKey = boundedText(scope.deckKey);
  if (boundedText(scope.opponentLegend)) next.opponentLegend = boundedText(scope.opponentLegend);
  if (scope.gameStage === "preboard" || scope.gameStage === "postboard") next.gameStage = scope.gameStage;
  if (scope.initiative === "1st" || scope.initiative === "2nd") next.initiative = scope.initiative;
  return next;
}

export function isReplayCoachingGameEligible(
  scope: ReplayCoachingEligibilityScope,
  game: ReplayCoachingGameSnapshot
): boolean {
  if (scope.deckKey && normalize(scope.deckKey) !== normalize(game.deckKey)) return false;
  if (scope.opponentLegend && normalize(scope.opponentLegend) !== normalize(game.opponentLegend)) return false;
  const gameStage = game.gameStage ?? gameStageFromNumber(game.gameNumber);
  if (scope.gameStage && scope.gameStage !== gameStage) return false;
  if (scope.initiative && scope.initiative !== game.initiative) return false;
  return true;
}

export function recordReplayCoachingGame(
  focus: ReplayCoachingFocus,
  game: ReplayCoachingGameSnapshot,
  adherence: ReplayCoachingAdherence,
  note?: string,
  now: string | Date = new Date()
): ReplayCoachingRecordResult {
  if (!focus.experiment) return { focus, recorded: false, reason: "no-experiment" };
  if (focus.status !== "testing") return { focus, recorded: false, reason: "not-testing" };
  if (!isReplayCoachingGameEligible(focus.eligibility, game)) return { focus, recorded: false, reason: "ineligible" };
  if (focus.experiment.games.some((candidate) => candidate.id === game.id)) {
    return { focus, recorded: false, reason: "duplicate" };
  }
  if (focus.experiment.games.length >= focus.experiment.targetEligibleGames) {
    return { focus, recorded: false, reason: "target-complete" };
  }
  const recordedAt = isoDate(now);
  const observation: ReplayCoachingGameObservation = {
    ...copyGameSnapshot(game),
    adherence,
    recordedAt,
    ...(boundedText(note) ? { note: boundedText(note) } : {})
  };
  return {
    recorded: true,
    focus: {
      ...focus,
      updatedAt: recordedAt,
      experiment: {
        ...focus.experiment,
        games: [...focus.experiment.games, observation]
      }
    }
  };
}

export function replayCoachingProcessCounts(
  value: Partial<ReplayCoachingProcessCounts> | null | undefined
): ReplayCoachingProcessCounts {
  const followed = safeCount(value?.followed);
  const missed = safeCount(value?.missed);
  const unsure = safeCount(value?.unsure);
  const notApplicable = safeCount(value?.notApplicable);
  const minimumEligible = followed + missed + unsure + notApplicable;
  return {
    eligibleGames: Math.max(safeCount(value?.eligibleGames), minimumEligible),
    followed,
    missed,
    unsure,
    notApplicable
  };
}

export function replayCoachingProcessMetrics(
  value: Partial<ReplayCoachingProcessCounts> | null | undefined
): ReplayCoachingProcessMetrics {
  const counts = replayCoachingProcessCounts(value);
  const opportunities = counts.followed + counts.missed + counts.unsure;
  const assessedOpportunities = counts.followed + counts.missed;
  return {
    ...counts,
    opportunities,
    assessedOpportunities,
    ...(assessedOpportunities ? { adherenceRate: roundPercentage(counts.followed, assessedOpportunities) } : {})
  };
}

export function replayCoachingProgress(focus: ReplayCoachingFocus): ReplayCoachingProgress | null {
  const experiment = focus.experiment;
  if (!experiment) return null;
  const duringCounts: ReplayCoachingProcessCounts = {
    eligibleGames: experiment.games.length,
    followed: experiment.games.filter((game) => game.adherence === "followed").length,
    missed: experiment.games.filter((game) => game.adherence === "missed").length,
    unsure: experiment.games.filter((game) => game.adherence === "unsure").length,
    notApplicable: experiment.games.filter((game) => game.adherence === "not-applicable").length
  };
  const before = replayCoachingProcessMetrics(experiment.baseline);
  const during = replayCoachingProcessMetrics(duringCounts);
  const eligibleGamesTracked = experiment.games.length;
  const results = {
    wins: experiment.games.filter((game) => game.result === "Win").length,
    losses: experiment.games.filter((game) => game.result === "Loss").length,
    draws: experiment.games.filter((game) => game.result === "Draw").length,
    incomplete: experiment.games.filter((game) => !game.result || game.result === "Incomplete").length
  };
  return {
    targetEligibleGames: experiment.targetEligibleGames,
    eligibleGamesTracked,
    gamesRemaining: Math.max(0, experiment.targetEligibleGames - eligibleGamesTracked),
    readyForReview: eligibleGamesTracked >= experiment.targetEligibleGames,
    before,
    during,
    ...(typeof before.adherenceRate === "number" && typeof during.adherenceRate === "number"
      ? { adherenceDeltaPercentagePoints: Number((during.adherenceRate - before.adherenceRate).toFixed(1)) }
      : {}),
    results
  };
}

/**
 * Accepts JSON text, a parsed v1 store, a versionless legacy store, or a legacy
 * focus array. It never throws and reconstructs plain data instead of trusting
 * objects read from localStorage.
 */
export function parseReplayCoachingStore(
  input: unknown,
  now: string | Date = new Date()
): ReplayCoachingParseResult {
  const recordedAt = isoDate(now);
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      return { store: emptyReplayCoachingStore(recordedAt), migrated: false, discardedFocuses: 0 };
    }
  }
  const record = objectRecord(parsed);
  const rawFocuses = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record?.focuses)
      ? record.focuses
      : Array.isArray(record?.items)
        ? record.items
        : [];
  const version = record?.version;
  const migrated = Array.isArray(parsed) || version !== REPLAY_COACHING_STORAGE_VERSION;
  const focuses: ReplayCoachingFocus[] = [];
  const ids = new Set<string>();
  let discardedFocuses = 0;
  for (const raw of rawFocuses.slice(0, MAX_FOCUSES * 2)) {
    const focus = parseFocus(raw, recordedAt, migrated);
    if (!focus || ids.has(focus.id) || focuses.length >= MAX_FOCUSES) {
      discardedFocuses += 1;
      continue;
    }
    ids.add(focus.id);
    focuses.push(focus);
  }
  const activeFocusId = boundedText(record?.activeFocusId);
  const store: ReplayCoachingStore = {
    version: REPLAY_COACHING_STORAGE_VERSION,
    updatedAt: validIso(record?.updatedAt) ?? recordedAt,
    focuses
  };
  if (activeFocusId && ids.has(activeFocusId)) store.activeFocusId = activeFocusId;
  return { store, migrated, discardedFocuses };
}

export function serializeReplayCoachingStore(store: ReplayCoachingStore): string {
  return JSON.stringify(parseReplayCoachingStore(store, store.updatedAt).store);
}

function withStatus(
  focus: ReplayCoachingFocus,
  status: ReplayCoachingLifecycle,
  recordedAt: string,
  note?: string
): ReplayCoachingFocus {
  return {
    ...focus,
    status,
    updatedAt: recordedAt,
    statusHistory: [
      ...focus.statusHistory,
      {
        status,
        recordedAt,
        ...(boundedText(note) ? { note: boundedText(note) } : {})
      }
    ].slice(-50)
  };
}

function parseFocus(input: unknown, fallbackAt: string, migrated: boolean): ReplayCoachingFocus | null {
  const record = objectRecord(input);
  if (!record) return null;
  const insightRecord = objectRecord(record.insight);
  const insightId = boundedText(insightRecord?.id) || boundedText(record.insightId);
  const title = boundedText(insightRecord?.title) || boundedText(record.title);
  const id = boundedText(record.id);
  if (!id || !insightId || !title) return null;
  const insight = copyInsightSnapshot({
    id: insightId,
    title,
    body: boundedText(insightRecord?.body),
    action: boundedText(insightRecord?.action) || boundedText(record.action),
    category: boundedText(insightRecord?.category),
    scope: boundedText(insightRecord?.scope),
    confidence: boundedText(insightRecord?.confidence),
    sampleSize: safeOptionalCount(insightRecord?.sampleSize),
    replayId: boundedText(insightRecord?.replayId),
    matchId: boundedText(insightRecord?.matchId),
    gameNumber: safeOptionalCount(insightRecord?.gameNumber),
    cardName: boundedText(insightRecord?.cardName),
    cardId: boundedText(insightRecord?.cardId),
    opponentLegend: boundedText(insightRecord?.opponentLegend)
  });
  const createdAt = validIso(record.createdAt) ?? fallbackAt;
  const updatedAt = validIso(record.updatedAt) ?? createdAt;
  const rawStatus = boundedText(record.status);
  const status = lifecycleFromLegacy(rawStatus);
  const eligibility = normalizeReplayCoachingEligibility(
    (objectRecord(record.eligibility) ?? objectRecord(record.scope)) as ReplayCoachingEligibilityScope | undefined
  );
  const focus: ReplayCoachingFocus = {
    id,
    createdAt,
    updatedAt,
    status,
    insight,
    eligibility,
    statusHistory: parseStatusHistory(record.statusHistory, status, createdAt)
  };
  const report = parseReportSnapshot(record.report);
  if (report) focus.report = report;
  const reflection = parseReflection(record.reflection, record.reflectionNote, updatedAt);
  if (reflection) focus.reflection = reflection;
  const experiment = parseExperiment(record.experiment ?? (migrated ? record : undefined), id, createdAt);
  if (experiment) focus.experiment = experiment;
  return focus;
}

function parseExperiment(
  input: unknown,
  focusId: string,
  fallbackAt: string
): ReplayCoachingExperiment | undefined {
  const record = objectRecord(input);
  if (!record) return undefined;
  const hypothesis = boundedText(record.hypothesis);
  const process = boundedText(record.process) || boundedText(record.behavior);
  if (!hypothesis || !process) return undefined;
  const createdAt = validIso(record.createdAt) ?? fallbackAt;
  const targetEligibleGames = clampTargetGames(numberValue(record.targetEligibleGames) ?? numberValue(record.targetGames));
  const rawGames = Array.isArray(record.games)
    ? record.games
    : Array.isArray(record.observations)
      ? record.observations
      : [];
  const games: ReplayCoachingGameObservation[] = [];
  const ids = new Set<string>();
  for (const raw of rawGames) {
    const game = parseObservation(raw, fallbackAt);
    if (!game || ids.has(game.id) || games.length >= targetEligibleGames) continue;
    ids.add(game.id);
    games.push(game);
  }
  const baselineRecord = objectRecord(record.baseline);
  const experiment: ReplayCoachingExperiment = {
    id: boundedText(record.id) || `experiment:${slug(focusId)}:${createdAt}`,
    hypothesis,
    process,
    targetEligibleGames,
    baseline: replayCoachingProcessCounts({
      eligibleGames: numberValue(baselineRecord?.eligibleGames),
      followed: numberValue(baselineRecord?.followed),
      missed: numberValue(baselineRecord?.missed),
      unsure: numberValue(baselineRecord?.unsure),
      notApplicable: numberValue(baselineRecord?.notApplicable)
    }),
    games,
    createdAt
  };
  const successSignal = boundedText(record.successSignal);
  if (successSignal) experiment.successSignal = successSignal;
  const startedAt = validIso(record.startedAt);
  if (startedAt) experiment.startedAt = startedAt;
  return experiment;
}

function parseObservation(input: unknown, fallbackAt: string): ReplayCoachingGameObservation | null {
  const record = objectRecord(input);
  const id = boundedText(record?.id);
  const adherence = adherenceFromLegacy(boundedText(record?.adherence));
  if (!record || !id || !adherence) return null;
  const game = copyGameSnapshot({
    id,
    capturedAt: validIso(record.capturedAt) ?? fallbackAt,
    replayId: boundedText(record.replayId),
    matchId: boundedText(record.matchId),
    gameNumber: safeOptionalCount(record.gameNumber),
    deckKey: boundedText(record.deckKey),
    opponentLegend: boundedText(record.opponentLegend),
    gameStage: record.gameStage === "preboard" || record.gameStage === "postboard" ? record.gameStage : undefined,
    initiative: record.initiative === "1st" || record.initiative === "2nd" ? record.initiative : undefined,
    result: RESULTS.has(record.result as ReplayCoachingGameResult) ? record.result as ReplayCoachingGameResult : undefined
  });
  return {
    ...game,
    adherence,
    recordedAt: validIso(record.recordedAt) ?? game.capturedAt,
    ...(boundedText(record.note) ? { note: boundedText(record.note) } : {})
  };
}

function parseReflection(input: unknown, legacyNote: unknown, fallbackAt: string): ReplayCoachingReflectionRecord | undefined {
  const record = objectRecord(input);
  const rawValue = typeof input === "string" ? input : boundedText(record?.value);
  const value = reflectionFromLegacy(rawValue);
  if (!value) return undefined;
  const note = boundedText(record?.note) || boundedText(legacyNote);
  return {
    value,
    recordedAt: validIso(record?.recordedAt) ?? fallbackAt,
    ...(note ? { note } : {})
  };
}

function parseStatusHistory(
  input: unknown,
  fallbackStatus: ReplayCoachingLifecycle,
  fallbackAt: string
): ReplayCoachingStatusEntry[] {
  if (!Array.isArray(input)) return [{ status: fallbackStatus, recordedAt: fallbackAt }];
  const parsed = input.flatMap((item): ReplayCoachingStatusEntry[] => {
    const record = objectRecord(item);
    const status = lifecycleFromLegacy(boundedText(record?.status));
    const recordedAt = validIso(record?.recordedAt);
    if (!record || !recordedAt) return [];
    const note = boundedText(record.note);
    return [{ status, recordedAt, ...(note ? { note } : {}) }];
  }).slice(-50);
  return parsed.length ? parsed : [{ status: fallbackStatus, recordedAt: fallbackAt }];
}

function parseReportSnapshot(input: unknown): ReplayCoachingReportSnapshot | undefined {
  const record = objectRecord(input);
  if (!record) return undefined;
  const report: ReplayCoachingReportSnapshot = {};
  const generatedAt = validIso(record.generatedAt);
  if (generatedAt) report.generatedAt = generatedAt;
  const replaysAnalyzed = safeOptionalCount(record.replaysAnalyzed);
  const matchesAnalyzed = safeOptionalCount(record.matchesAnalyzed);
  const gamesAnalyzed = safeOptionalCount(record.gamesAnalyzed);
  if (replaysAnalyzed != null) report.replaysAnalyzed = replaysAnalyzed;
  if (matchesAnalyzed != null) report.matchesAnalyzed = matchesAnalyzed;
  if (gamesAnalyzed != null) report.gamesAnalyzed = gamesAnalyzed;
  if (boundedText(record.coverageGrade)) report.coverageGrade = boundedText(record.coverageGrade);
  const scope = normalizeReplayCoachingEligibility(objectRecord(record.scope) as ReplayCoachingEligibilityScope | undefined);
  if (Object.keys(scope).length) report.scope = scope;
  return Object.keys(report).length ? report : undefined;
}

function copyInsightSnapshot(insight: ReplayCoachingInsightSnapshot): ReplayCoachingInsightSnapshot {
  const copy: ReplayCoachingInsightSnapshot = {
    id: boundedText(insight.id),
    title: boundedText(insight.title)
  };
  if (boundedText(insight.body)) copy.body = boundedText(insight.body);
  if (boundedText(insight.action)) copy.action = boundedText(insight.action);
  if (boundedText(insight.category)) copy.category = boundedText(insight.category);
  if (boundedText(insight.scope)) copy.scope = boundedText(insight.scope);
  if (boundedText(insight.confidence)) copy.confidence = boundedText(insight.confidence);
  if (safeOptionalCount(insight.sampleSize) != null) copy.sampleSize = safeOptionalCount(insight.sampleSize);
  if (boundedText(insight.replayId)) copy.replayId = boundedText(insight.replayId);
  if (boundedText(insight.matchId)) copy.matchId = boundedText(insight.matchId);
  if (safeOptionalCount(insight.gameNumber) != null) copy.gameNumber = safeOptionalCount(insight.gameNumber);
  if (boundedText(insight.cardName)) copy.cardName = boundedText(insight.cardName);
  if (boundedText(insight.cardId)) copy.cardId = boundedText(insight.cardId);
  if (boundedText(insight.opponentLegend)) copy.opponentLegend = boundedText(insight.opponentLegend);
  return copy;
}

function copyReportSnapshot(report: ReplayCoachingReportSnapshot): ReplayCoachingReportSnapshot {
  return parseReportSnapshot(report) ?? {};
}

function copyGameSnapshot(game: ReplayCoachingGameSnapshot): ReplayCoachingGameSnapshot {
  const copy: ReplayCoachingGameSnapshot = {
    id: boundedText(game.id),
    capturedAt: isoDate(game.capturedAt)
  };
  if (boundedText(game.replayId)) copy.replayId = boundedText(game.replayId);
  if (boundedText(game.matchId)) copy.matchId = boundedText(game.matchId);
  if (safeOptionalCount(game.gameNumber) != null) copy.gameNumber = safeOptionalCount(game.gameNumber);
  if (boundedText(game.deckKey)) copy.deckKey = boundedText(game.deckKey);
  if (boundedText(game.opponentLegend)) copy.opponentLegend = boundedText(game.opponentLegend);
  if (game.gameStage === "preboard" || game.gameStage === "postboard") copy.gameStage = game.gameStage;
  if (game.initiative === "1st" || game.initiative === "2nd") copy.initiative = game.initiative;
  if (game.result && RESULTS.has(game.result)) copy.result = game.result;
  return copy;
}

function reflectionFromLegacy(value: string): ReplayInsightReflection | undefined {
  if (REFLECTIONS.has(value as ReplayInsightReflection)) return value as ReplayInsightReflection;
  if (value === "understood" || value === "known") return "already-understood";
  return undefined;
}

function lifecycleFromLegacy(value: string): ReplayCoachingLifecycle {
  if (LIFECYCLES.has(value as ReplayCoachingLifecycle)) return value as ReplayCoachingLifecycle;
  if (value === "active") return "testing";
  if (value === "complete" || value === "completed") return "learned";
  if (value === "draft") return "new";
  return "new";
}

function adherenceFromLegacy(value: string): ReplayCoachingAdherence | undefined {
  if (ADHERENCE_VALUES.has(value as ReplayCoachingAdherence)) return value as ReplayCoachingAdherence;
  if (value === "yes") return "followed";
  if (value === "no") return "missed";
  if (value === "n/a") return "not-applicable";
  return undefined;
}

function gameStageFromNumber(gameNumber: number | undefined): ReplayCoachingGameStage | undefined {
  if (!Number.isInteger(gameNumber) || !gameNumber || gameNumber < 1) return undefined;
  return gameNumber === 1 ? "preboard" : "postboard";
}

function clampTargetGames(value: number | undefined): 3 | 4 | 5 {
  if (!Number.isFinite(value)) return 5;
  return Math.min(5, Math.max(3, Math.round(value!))) as 3 | 4 | 5;
}

function roundPercentage(value: number, total: number): number {
  return Number((value / total * 100).toFixed(1));
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function safeOptionalCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function validIso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function isoDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function boundedText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

function normalize(value: unknown): string {
  return boundedText(value).toLowerCase().replace(/\s+/g, " ");
}

function slug(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "insight";
}
