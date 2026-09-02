import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Database,
  Eye,
  Film,
  FlaskConical,
  History,
  Lightbulb,
  ListChecks,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trophy,
  X
} from "lucide-react";
import { riftboundBasePrintCode, riftboundCardCodeAliases } from "../shared/cardIdentity";
import {
  createLabTrainingHandoff,
  resolveLabTrainingDeckId,
  storeLabTrainingHandoff
} from "../shared/labTrainingHandoff";
import { MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON } from "../shared/mulliganLab";
import { legendImageUrl } from "../shared/legendImages";
import type { ActiveView } from "../shared/navigationModel";
import {
  buildEnhancedInsightsContext,
  type EnhancedInsightReviewCandidate,
  type EnhancedInsightsContextReport
} from "../shared/enhancedInsightsContext";
import {
  createReplayCoachingFocus,
  defineReplayCoachingExperiment,
  emptyReplayCoachingStore,
  isReplayCoachingGameEligible,
  parseReplayCoachingStore,
  recordReplayCoachingGame,
  reflectOnReplayInsight,
  REPLAY_COACHING_STORAGE_KEY,
  replayCoachingProgress,
  serializeReplayCoachingStore,
  startReplayCoachingExperiment,
  transitionReplayCoachingFocus,
  type ReplayCoachingAdherence,
  type ReplayCoachingEligibilityScope,
  type ReplayCoachingFocus,
  type ReplayCoachingGameSnapshot,
  type ReplayCoachingStore,
  type ReplayInsightReflection
} from "../shared/replayCoaching";
import {
  buildReplayInsights,
  replayInsightEventsFromRawPayload,
  type ReplayInsight,
  type ReplayInsightFilters,
  type ReplayInsightGameStage
} from "../shared/replayInsights";
import {
  buildReplayCoachQuestBoard,
  type ReplayCoachQuest
} from "../shared/replayCoachQuest";
import {
  extractReplayLearningSignals,
  type ReplayLearningCapability,
  type ReplayLearningSignals
} from "../shared/replayLearningSignals";
import type {
  MatchDraft,
  DeckNotebook,
  ReplayIntelligenceConfidence,
  ReplayRecord,
  ReplayStructuredEvent,
  SavedDeck
} from "../shared/types";
import {
  cacheInsightAnalysisEventsBatch,
  createInsightAnalysisReplayFingerprint,
  loadInsightAnalysisCache,
  lookupInsightAnalysisEventsBatch,
  mapWithConcurrency,
  persistInsightAnalysisCache,
  replayNeedsRawInsightEnrichment
} from "./insightAnalysisCache";
import { InsightCardReport, PatternExplorer } from "./InsightsView";
import {
  CoachQuestCard,
  type CoachQuestCategory,
  type CoachQuestGameState,
  type CoachQuestViewModel
} from "./CoachQuestCard";
import { CoachShareCardDialog } from "./CoachShareCardDialog";
import { INSIGHT_CARD_CATALOG as CARD_CATALOG } from "./insightCardCatalog";

type CoachTab = "coach" | "review" | "progress" | "explore";
const COACH_TAB_ORDER: CoachTab[] = ["coach", "review", "progress", "explore"];
const RAW_ANALYSIS_CONCURRENCY = 2;
const MAX_BACKGROUND_RAW_REPLAYS = 256;
const CARD_ART_BY_CODE = new Map(CARD_CATALOG.flatMap((card) => (
  riftboundCardCodeAliases(card.code).map((code) => [code.toLocaleLowerCase(), card] as const)
)));
const CARD_ART_BY_NAME = buildCardArtByName();
const LEGACY_FEEDBACK_STORAGE_KEY = "riftlite:replay-insight-feedback:v1";

interface LearningInsightsViewProps {
  replays: ReplayRecord[];
  matches: MatchDraft[];
  decks: SavedDeck[];
  activeDeckId?: string;
  onOpenReplay: (replayId: string, timeMs?: number, correctionEventId?: string) => void;
  onNavigate: (view: ActiveView) => void;
}

export function LearningInsightsView({
  replays,
  matches,
  decks,
  activeDeckId = "",
  onOpenReplay,
  onNavigate
}: LearningInsightsViewProps) {
  const [tab, setTab] = useState<CoachTab>("coach");
  const [showScopeEditor, setShowScopeEditor] = useState(false);
  const [rangeDays, setRangeDays] = useState(0);
  const [period, setPeriod] = useState<"all" | "preseason" | "current-season">("all");
  const [deckKey, setDeckKey] = useState("");
  const [playerLegend, setPlayerLegend] = useState("");
  const [opponentLegend, setOpponentLegend] = useState("");
  const [format, setFormat] = useState<"" | MatchDraft["format"]>("");
  const [gameStage, setGameStage] = useState<ReplayInsightGameStage>("all");
  const [wentFirst, setWentFirst] = useState<"" | "1st" | "2nd">("");
  const [minimumSample, setMinimumSample] = useState(10);
  const [selectedReplayId, setSelectedReplayId] = useState("");
  const [cardSearch, setCardSearch] = useState("");
  const [rawInsightEvents, setRawInsightEvents] = useState<Map<string, ReplayStructuredEvent[]>>(() => new Map());
  const [rawLoading, setRawLoading] = useState(false);
  const [coaching, setCoaching] = useState<ReplayCoachingStore>(() => readCoachingStore());
  const [editingPlan, setEditingPlan] = useState(false);
  const [planDraft, setPlanDraft] = useState("");
  const [shareQuest, setShareQuest] = useState<CoachQuestViewModel | null>(null);
  const [shareCaption, setShareCaption] = useState("");
  const [selectedNotebook, setSelectedNotebook] = useState<DeckNotebook | null>(null);
  const legacyDismissed = useMemo(readLegacyDismissed, []);

  const rawCandidates = useMemo(() => backgroundRawCandidates(
    replays,
    tab === "review" ? selectedReplayId : undefined
  ), [replays, selectedReplayId, tab]);
  const rawReplayKey = useMemo(() => rawCandidates
    .map((replay) => `${replay.id}:${createInsightAnalysisReplayFingerprint(replay)}`)
    .join("|"), [rawCandidates]);

  useEffect(() => {
    let cancelled = false;
    const candidates = rawCandidates;
    if (!candidates.length) {
      setRawInsightEvents(new Map());
      setRawLoading(false);
      return () => { cancelled = true; };
    }
    void (async () => {
      let cache = loadInsightAnalysisCache(window.localStorage);
      const next = new Map<string, ReplayStructuredEvent[]>();
      const misses: ReplayRecord[] = [];
      const lookup = lookupInsightAnalysisEventsBatch(cache, candidates);
      cache = lookup.cache;
      for (let index = 0; index < candidates.length; index += 1) {
        const replay = candidates[index]!;
        const result = lookup.results[index];
        if (result?.hit) {
          if (result.events?.length) next.set(replay.id, result.events);
        } else {
          misses.push(replay);
        }
      }
      if (!cancelled) setRawInsightEvents(new Map(next));
      if (!misses.length) {
        persistInsightAnalysisCache(window.localStorage, cache);
        if (!cancelled) setRawLoading(false);
        return;
      }
      if (!cancelled) setRawLoading(true);
      const derived = await mapWithConcurrency(misses, RAW_ANALYSIS_CONCURRENCY, async (replay) => {
        try {
          const payload = await window.riftlite.getRawCapturePayload(replay.id);
          return { replay, events: payload ? replayInsightEventsFromRawPayload(replay, payload) : [] };
        } catch {
          return { replay, events: [] as ReplayStructuredEvent[] };
        }
      });
      cache = cacheInsightAnalysisEventsBatch(cache, derived.map((item) => ({
        replay: item.replay,
        events: item.events
      }))).cache;
      for (const item of derived) {
        if (item.events.length) next.set(item.replay.id, item.events);
      }
      persistInsightAnalysisCache(window.localStorage, cache);
      if (!cancelled) {
        setRawInsightEvents(new Map(next));
        setRawLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rawReplayKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(REPLAY_COACHING_STORAGE_KEY, serializeReplayCoachingStore(coaching));
    } catch {
      // Coaching remains usable for the current session when storage is unavailable.
    }
  }, [coaching]);

  const filters: ReplayInsightFilters = useMemo(() => ({
    rangeDays: rangeDays || undefined,
    period,
    deckKey: deckKey || undefined,
    playerLegend: playerLegend || undefined,
    opponentLegend: opponentLegend || undefined,
    format: format || undefined,
    gameStage,
    wentFirst: wentFirst || undefined
  }), [deckKey, format, gameStage, opponentLegend, period, playerLegend, rangeDays, wentFirst]);

  const report = useMemo(() => buildReplayInsights(replays, matches, {
    filters,
    cardCatalog: CARD_CATALOG,
    enrichmentEventsByReplayId: rawInsightEvents,
    minimumPatternSample: minimumSample,
    includeExplorerStats: tab === "explore"
  }), [filters, matches, minimumSample, rawInsightEvents, replays, tab]);

  const matchById = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  const replayById = useMemo(() => new Map(replays.map((replay) => [replay.id, replay])), [replays]);
  const selectedReplay = selectedReplayId ? replayById.get(selectedReplayId) : undefined;
  const selectedMatch = selectedReplay
    ? matchById.get(selectedReplay.matchId) ?? selectedReplay.matchSnapshot
    : undefined;
  const selectedReplayForLearning = useMemo(() => {
    if (!selectedReplay) return null;
    const enrichment = rawInsightEvents.get(selectedReplay.id) ?? [];
    return enrichment.length
      ? { ...selectedReplay, structuredEvents: [...(selectedReplay.structuredEvents ?? []), ...enrichment] }
      : selectedReplay;
  }, [rawInsightEvents, selectedReplay]);
  const selectedLearningSignals = useMemo(() => {
    return selectedReplayForLearning ? extractReplayLearningSignals(selectedReplayForLearning) : null;
  }, [selectedReplayForLearning]);
  const selectedDeckId = useMemo(() => {
    const matchDeckKey = selectedMatch?.deckSourceKey || selectedMatch?.deckSourceId || "";
    const matchedDeck = decks.find((deck) => deck.id === matchDeckKey || deck.sourceKey === matchDeckKey);
    return matchedDeck?.id ?? (matchDeckKey ? "" : activeDeckId);
  }, [activeDeckId, decks, selectedMatch?.deckSourceId, selectedMatch?.deckSourceKey]);
  useEffect(() => {
    let cancelled = false;
    setSelectedNotebook(null);
    if (!selectedDeckId) return () => { cancelled = true; };
    void window.riftlite.getDeckNotebook(selectedDeckId)
      .then((notebook) => { if (!cancelled) setSelectedNotebook(notebook); })
      .catch(() => { if (!cancelled) setSelectedNotebook(null); });
    return () => { cancelled = true; };
  }, [selectedDeckId]);
  const selectedEnhancedContext = useMemo(() => {
    if (!selectedReplayForLearning) return null;
    return buildEnhancedInsightsContext({
      replay: selectedReplayForLearning,
      capabilityReceipt: selectedLearningSignals?.capabilities,
      matchInsightContext: selectedMatch?.insightContext ?? selectedReplayForLearning.matchSnapshot?.insightContext,
      notebook: selectedNotebook,
      opponentLegend: selectedMatch?.opponentChampion
    });
  }, [selectedLearningSignals?.capabilities, selectedMatch?.insightContext, selectedMatch?.opponentChampion, selectedNotebook, selectedReplayForLearning]);
  const replayByMatchId = useMemo(() => {
    const result = new Map<string, ReplayRecord>();
    for (const replay of [...replays].sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))) {
      if (!result.has(replay.matchId)) result.set(replay.matchId, replay);
    }
    return result;
  }, [replays]);
  const analyzedReplaySet = useMemo(() => new Set(report.analyzedReplayIds), [report.analyzedReplayIds]);
  const analyzedReplays = useMemo(() => replays
    .filter((replay) => analyzedReplaySet.has(replay.id))
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt)), [analyzedReplaySet, replays]);
  const reflectedByInsight = useMemo(() => new Map(coaching.focuses
    .filter((focus) => focus.reflection)
    .map((focus) => [focus.insight.id, focus.reflection!])), [coaching.focuses]);
  const activeFocus = coaching.activeFocusId
    ? coaching.focuses.find((focus) => focus.id === coaching.activeFocusId)
    : undefined;
  const activeProgress = activeFocus ? replayCoachingProgress(activeFocus) : null;
  const visibleInsights = useMemo(() => report.insights.filter((insight) => !legacyDismissed.has(insight.id)), [legacyDismissed, report.insights]);
  const questBoard = useMemo(() => buildReplayCoachQuestBoard({ ...report, insights: visibleInsights }), [report, visibleInsights]);
  const insightById = useMemo(() => new Map(visibleInsights.map((insight) => [insight.id, insight])), [visibleInsights]);
  const activeQuestSource = useMemo(() => {
    if (!activeFocus) return null;
    const insight = insightById.get(activeFocus.insight.id);
    return insight ? buildReplayCoachQuestBoard({ ...report, insights: [insight] }).primary : null;
  }, [activeFocus, insightById, report]);
  const strengthSignal = useMemo(() => visibleInsights
    .filter((insight) => insight.tone === "positive")
    .filter((insight) => !reflectedByInsight.has(insight.id))
    .sort((left, right) => coachInsightScore(right) - coachInsightScore(left))[0], [reflectedByInsight, visibleInsights]);
  const patterns = useMemo(() => visibleInsights.filter((insight) => insight.scope === "pattern"), [visibleInsights]);
  const matchInsights = useMemo(() => visibleInsights
    .filter((insight) => insight.scope === "match" && insight.replayId === selectedReplayId)
    .sort((left, right) => coachInsightScore(right) - coachInsightScore(left)), [selectedReplayId, visibleInsights]);
  const cards = useMemo(() => {
    const needle = cardSearch.trim().toLowerCase();
    return report.cards.filter((card) => !needle || `${card.cardName} ${card.cardId ?? ""}`.toLowerCase().includes(needle));
  }, [cardSearch, report.cards]);
  const coachingGames = useMemo(() => buildCoachingGames(matches, replayByMatchId), [matches, replayByMatchId]);
  const pendingCheckins = useMemo(() => {
    if (!activeFocus?.experiment?.startedAt || activeFocus.status !== "testing") return [];
    const startedAt = Date.parse(activeFocus.experiment.startedAt);
    const recorded = new Set(activeFocus.experiment.games.map((game) => game.id));
    return coachingGames
      .filter((game) => Date.parse(game.capturedAt) > startedAt)
      .filter((game) => game.result !== "Incomplete")
      .filter((game) => !recorded.has(game.id))
      .filter((game) => isReplayCoachingGameEligible(activeFocus.eligibility, game))
      .slice(0, Math.max(0, activeFocus.experiment.targetEligibleGames - activeFocus.experiment.games.length));
  }, [activeFocus, coachingGames]);
  const featuredQuest = useMemo(() => {
    if (activeFocus) {
      return activeQuestSource
        ? coachQuestViewModel(activeQuestSource, activeFocus, activeProgress, pendingCheckins.length)
        : coachQuestViewModelFromFocus(activeFocus, activeProgress, pendingCheckins.length);
    }
    return questBoard.primary ? coachQuestViewModel(questBoard.primary) : null;
  }, [activeFocus, activeProgress, activeQuestSource, pendingCheckins.length, questBoard.primary]);
  const supportingQuests = useMemo(() => {
    const candidates = [questBoard.primary, ...questBoard.secondary]
      .filter((quest): quest is ReplayCoachQuest => Boolean(quest))
      .filter((quest) => quest.insightId !== activeFocus?.insight.id)
      .filter((quest) => quest.id !== questBoard.primary?.id || Boolean(activeFocus));
    return candidates.slice(0, 2).map((quest) => ({
      source: quest,
      view: coachQuestViewModel(quest)
    }));
  }, [activeFocus?.insight.id, questBoard.primary, questBoard.secondary]);

  useEffect(() => {
    if (!analyzedReplays.length) {
      setSelectedReplayId("");
      return;
    }
    if (!analyzedReplays.some((replay) => replay.id === selectedReplayId)) setSelectedReplayId(analyzedReplays[0]!.id);
  }, [analyzedReplays, selectedReplayId]);

  useEffect(() => {
    setPlanDraft(activeFocus?.experiment?.process ?? activeFocus?.insight.action ?? "");
    setEditingPlan(false);
  }, [activeFocus?.id, activeFocus?.experiment?.process, activeFocus?.insight.action]);

  const playerLegendOptions = uniqueOptions(matches.map((match) => match.myChampion));
  const opponentLegendOptions = uniqueOptions(matches.map((match) => match.opponentChampion));
  const deckOptions = uniqueDeckOptions(matches);
  const activeFilterCount = [period !== "all" ? period : "", deckKey, playerLegend, opponentLegend, format, gameStage !== "all" ? gameStage : "", wentFirst]
    .filter(Boolean).length + (rangeDays ? 1 : 0);
  const scopeSummary = coachingScopeSummary(filters, report.gamesAnalyzed);
  const periodCounts = report.scopeReceipt.periodGameCounts;

  function commitStore(next: ReplayCoachingStore) {
    setCoaching({ ...next, updatedAt: new Date().toISOString() });
  }

  function focusFromInsight(insight: ReplayInsight): ReplayCoachingFocus {
    return coaching.focuses.find((focus) => focus.insight.id === insight.id) ?? createReplayCoachingFocus({
      insight,
      report: {
        generatedAt: report.generatedAt,
        replaysAnalyzed: report.replaysAnalyzed,
        matchesAnalyzed: report.matchesAnalyzed,
        gamesAnalyzed: report.gamesAnalyzed,
        coverageGrade: report.coverage.grade,
        scope: eligibilityForInsight(insight, filters, matchById)
      },
      eligibility: eligibilityForInsight(insight, filters, matchById)
    });
  }

  function saveFocus(nextFocus: ReplayCoachingFocus, activate = false) {
    const focuses = coaching.focuses.some((focus) => focus.id === nextFocus.id)
      ? coaching.focuses.map((focus) => focus.id === nextFocus.id ? nextFocus : focus)
      : [...coaching.focuses, nextFocus];
    commitStore({
      ...coaching,
      focuses,
      ...(activate ? { activeFocusId: nextFocus.id } : {})
    });
  }

  function recordReflection(insight: ReplayInsight, value: ReplayInsightReflection) {
    const focus = reflectOnReplayInsight(focusFromInsight(insight), value);
    saveFocus(focus);
    if (value === "wrong") {
      const evidence = insight.evidence[0];
      if (evidence) onOpenReplay(evidence.replayId, evidence.videoTimeMs, evidence.eventId);
    }
  }

  function makeActiveFocus(insight: ReplayInsight, targetEligibleGames: 3 | 4 | 5 = 3) {
    const now = new Date();
    let nextFocus = focusFromInsight(insight);
    if (!nextFocus.reflection) nextFocus = reflectOnReplayInsight(nextFocus, "unsure", undefined, now);
    nextFocus = defineReplayCoachingExperiment(nextFocus, {
      hypothesis: hypothesisForInsight(insight),
      process: insight.action,
      successSignal: successSignalForInsight(insight),
      targetEligibleGames
    }, now);
    nextFocus = startReplayCoachingExperiment(nextFocus, now);
    const focuses = coaching.focuses
      .map((focus) => focus.id === coaching.activeFocusId && focus.id !== nextFocus.id
        ? transitionReplayCoachingFocus(focus, "paused", "A new active focus was selected", now)
        : focus)
      .filter((focus) => focus.id !== nextFocus.id);
    commitStore({ ...coaching, activeFocusId: nextFocus.id, focuses: [...focuses, nextFocus] });
    setTab("coach");
  }

  function updateActiveFocus(nextFocus: ReplayCoachingFocus) {
    saveFocus(nextFocus, true);
  }

  function recordCheckin(game: ReplayCoachingGameSnapshot, adherence: ReplayCoachingAdherence) {
    if (!activeFocus) return;
    const result = recordReplayCoachingGame(activeFocus, game, adherence);
    if (result.recorded) updateActiveFocus(result.focus);
  }

  function pauseFocus() {
    if (!activeFocus) return;
    const paused = transitionReplayCoachingFocus(activeFocus, "paused", "Paused by the player");
    commitStore({ ...coaching, focuses: coaching.focuses.map((focus) => focus.id === paused.id ? paused : focus), activeFocusId: undefined });
  }

  function resumeFocus(focus: ReplayCoachingFocus) {
    const resumed = startReplayCoachingExperiment(focus);
    const focuses = coaching.focuses.map((candidate) => candidate.id === resumed.id
      ? resumed
      : candidate.id === coaching.activeFocusId
        ? transitionReplayCoachingFocus(candidate, "paused", "Another focus was resumed")
        : candidate);
    commitStore({ ...coaching, activeFocusId: resumed.id, focuses });
    setTab("coach");
  }

  function completeFocus(status: "learned" | "adjusted") {
    if (!activeFocus) return;
    const completed = transitionReplayCoachingFocus(activeFocus, status, status === "learned" ? "Lesson retained" : "Plan needs another test");
    commitStore({ ...coaching, activeFocusId: undefined, focuses: coaching.focuses.map((focus) => focus.id === completed.id ? completed : focus) });
  }

  function savePlan() {
    if (!activeFocus?.experiment || !planDraft.trim()) return;
    updateActiveFocus({
      ...activeFocus,
      updatedAt: new Date().toISOString(),
      experiment: { ...activeFocus.experiment, process: planDraft.trim() }
    });
    setEditingPlan(false);
  }

  function openPractice(insight: ReplayInsight | ReplayCoachingFocus["insight"]) {
    const destination = labDestinationForInsight(insight);
    if (!destination) return;
    const match = insight.matchId ? matchById.get(insight.matchId) : undefined;
    const player = ("playerLegend" in insight ? insight.playerLegend : undefined) || match?.myChampion || playerLegend;
    const opponent = insight.opponentLegend || match?.opponentChampion || opponentLegend;
    const deckId = resolveLabTrainingDeckId({
      deckSourceId: match?.deckSourceId,
      deckSourceKey: match?.deckSourceKey,
      deckSourceUrl: match?.deckSourceUrl,
      deckName: match?.deckName,
      playerLegend: player
    }, decks);
    if (player && opponent) {
      const game = insight.gameNumber ? match?.games.find((candidate) => candidate.gameNumber === insight.gameNumber) : match?.games[0];
      storeLabTrainingHandoff(window.localStorage, createLabTrainingHandoff({
        destination,
        source: "insights",
        playerLegend: player,
        opponentLegend: opponent,
        deckId,
        format: match?.format ?? null,
        wentFirst: game?.wentFirst === "1st" || game?.wentFirst === "2nd" ? game.wentFirst : null,
        priorGameResult: match?.games[0]?.result === "Win" ? "win" : match?.games[0]?.result === "Loss" ? "loss" : null
      }));
    }
    onNavigate(destination === "mulligan" ? "mulligan-lab" : "sideboard-lab");
  }

  function clearFilters() {
    setRangeDays(0);
    setPeriod("all");
    setDeckKey("");
    setPlayerLegend("");
    setOpponentLegend("");
    setFormat("");
    setGameStage("all");
    setWentFirst("");
  }

  function openQuestEvidence(quest: ReplayCoachQuest | null | undefined, evidenceId?: string) {
    if (!quest) {
      if (activeFocus?.insight.replayId) onOpenReplay(activeFocus.insight.replayId);
      return;
    }
    const evidence = quest.evidence.find((item, index) => questEvidenceId(quest, item, index) === evidenceId)
      ?? quest.evidence.find((item) => typeof item.videoTimeMs === "number")
      ?? quest.evidence[0];
    if (evidence) onOpenReplay(evidence.replayId, evidence.videoTimeMs, evidence.eventId);
  }

  function shareCoachingQuest(view: CoachQuestViewModel, source?: ReplayCoachQuest | null) {
    setShareQuest(view);
    setShareCaption(source?.share.plainText ?? shareTextFromQuest(view));
  }

  const featuredQuestSource = activeFocus ? activeQuestSource : questBoard.primary;
  const featuredInsight = featuredQuestSource ? insightById.get(featuredQuestSource.insightId) : undefined;

  return (
    <section className="dashboard-page insights-page insights-learning-page">
      <header className="insights-coach-shell-header">
        <div>
          <span className="insights-kicker"><Brain size={15} /> Replay Coach</span>
          <h2>One rule. Three games. A better habit.</h2>
          <p>RiftLite promotes the clearest decision from your replay evidence and gives you one measurable thing to try next.</p>
        </div>
        <div className="insights-coach-scope" title={scopeSummary}>
          <span data-grade={report.coverage.grade}><Activity size={14} /> {captureCoverageLabel(report.coverage.grade)} capture</span>
          <strong>{report.gamesAnalyzed} eligible game{report.gamesAnalyzed === 1 ? "" : "s"}</strong>
          <small>{rawLoading ? "Indexing uncached local evidence…" : `Pre-season ${periodCounts.preseason} · current ${periodCounts["current-season"]} · ${deckVersionReceipt(report.scopeReceipt.deckVersions.length, report.scopeReceipt.unknownDeckGames)}`}</small>
          <button type="button" className="secondary compact" onClick={() => setShowScopeEditor((current) => !current)} aria-expanded={showScopeEditor}><SlidersHorizontal size={13} /> Change scope <ChevronDown size={12} /></button>
        </div>
      </header>

      {showScopeEditor ? <section className="rail-card insights-filter-card insights-scope-editor">
        <header><div><span>Comparable evidence</span><strong>{activeFilterCount ? `${activeFilterCount} active refinement${activeFilterCount === 1 ? "" : "s"}` : "All available local history"}</strong></div>{activeFilterCount ? <button type="button" className="secondary compact" onClick={clearFilters}><RotateCcw size={13} /> Reset</button> : null}</header>
        <div className="insights-filters">
          <label>History<select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}><option value="all">Pre-season + current season</option><option value="current-season">Current season only</option><option value="preseason">Pre-season only</option></select></label>
          <label>Period<select value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))}><option value={0}>All available dates</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label>
          <label>Deck<select value={deckKey} onChange={(event) => setDeckKey(event.target.value)}><option value="">All deck versions</option>{deckOptions.map((deck) => <option value={deck.key} key={deck.key}>{deck.label}</option>)}</select></label>
          <label>Your Legend<select value={playerLegend} onChange={(event) => setPlayerLegend(event.target.value)}><option value="">All Legends</option>{playerLegendOptions.map((legend) => <option value={legend} key={legend}>{legend}</option>)}</select></label>
          <label>Opponent<select value={opponentLegend} onChange={(event) => setOpponentLegend(event.target.value)}><option value="">All opponents</option>{opponentLegendOptions.map((legend) => <option value={legend} key={legend}>{legend}</option>)}</select></label>
          <label>Format<select value={format} onChange={(event) => setFormat(event.target.value as "" | MatchDraft["format"])}><option value="">All formats</option><option value="Bo1">Best of 1</option><option value="Bo3">Best of 3</option><option value="Auto">Auto</option></select></label>
          <label>Game stage<select value={gameStage} onChange={(event) => setGameStage(event.target.value as ReplayInsightGameStage)}><option value="all">All games</option><option value="preboard">Game 1 / pre-board</option><option value="postboard">Post-sideboard</option></select></label>
          <label>Initiative<select value={wentFirst} onChange={(event) => setWentFirst(event.target.value as "" | "1st" | "2nd")}><option value="">Play or draw</option><option value="1st">Went first</option><option value="2nd">Went second</option></select></label>
        </div>
      </section> : null}

      <nav className="insights-tabs insights-coach-tabs" role="tablist" aria-label="Learning views">
        {([
          ["coach", "Coach", Target],
          ["review", "Last Match", BookOpen],
          ["progress", "Journal", Trophy],
          ["explore", "Data Lab", BarChart3]
        ] as const).map(([value, label, Icon]) => <button type="button" role="tab" id={`coach-tab-${value}`} aria-controls={`coach-panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} data-active={tab === value} onClick={() => setTab(value)} onKeyDown={(event) => moveCoachTab(event, value, setTab)} key={value}><Icon size={16} /> {label}</button>)}
        <span className="insights-local-only"><ShieldCheck size={13} /> Local only · no Firebase reads</span>
      </nav>

      {report.coverage.grade === "limited" ? <aside className="insights-limited-note"><AlertTriangle size={17} /><div><strong>Observation mode</strong><span>RiftLite can still link factual moments, but it will withhold stronger coaching conclusions until the required fields are complete.</span></div></aside> : null}

      {tab === "coach" ? <section id="coach-panel-coach" role="tabpanel" aria-labelledby="coach-tab-coach" className="insights-coach-view">
        {activeFocus ? <CoachJourney step={pendingCheckins.length || activeProgress?.readyForReview ? 3 : 2} /> : null}
        {selectedEnhancedContext?.reviewCandidates.length ? (
          <EnhancedCoachReviewQueue
            report={selectedEnhancedContext}
            onReview={() => setTab("review")}
            onOpenReplay={onOpenReplay}
          />
        ) : null}
        {featuredQuest ? <div className="insights-coach-featured">
          <CoachQuestCard
            quest={featuredQuest}
            onStart={featuredQuestSource?.kind === "challenge" && featuredInsight ? () => makeActiveFocus(featuredInsight, 3) : undefined}
            onReview={featuredQuestSource?.evidence.length || activeFocus?.insight.replayId ? (evidenceId) => openQuestEvidence(featuredQuestSource, evidenceId) : undefined}
            onLab={featuredInsight && labDestinationForInsight(featuredInsight) ? () => openPractice(featuredInsight) : activeFocus && labDestinationForInsight(activeFocus.insight) ? () => openPractice(activeFocus.insight) : undefined}
            onContext={() => setTab(featuredQuestSource?.kind === "review-question" ? "review" : "explore")}
            onShare={() => shareCoachingQuest(featuredQuest, featuredQuestSource)}
          />
        </div> : <LearningEmpty title="Your next lesson is still forming" body="Capture another complete game. RiftLite will promote a decision only when it can show the rule, the evidence and what to try next." />}

        {activeFocus ? <CoachFocusControls focus={activeFocus} progress={activeProgress} planDraft={planDraft} editingPlan={editingPlan} onPlanDraft={setPlanDraft} onStartEditing={() => setEditingPlan(true)} onCancelEditing={() => { setPlanDraft(activeFocus.experiment?.process ?? ""); setEditingPlan(false); }} onSavePlan={savePlan} onPause={pauseFocus} onComplete={completeFocus} /> : null}
        {activeFocus && pendingCheckins.length ? <CoachCheckins games={pendingCheckins} onCheckin={recordCheckin} onOpenReplay={onOpenReplay} /> : null}

        {supportingQuests.length ? <section className="insights-quest-queue">
          <header><div><span>Up next</span><h3>Other lessons forming</h3></div><small>Only the two clearest alternatives are shown.</small></header>
          <div>{supportingQuests.map(({ source, view }) => <QuestQueueRow quest={source} view={view} onStart={(insight) => makeActiveFocus(insight, 3)} insight={insightById.get(source.insightId)} onReview={(id) => openQuestEvidence(source, id)} key={source.id} />)}</div>
        </section> : null}

        {strengthSignal ? <StrengthStrip insight={strengthSignal} onOpenReplay={onOpenReplay} /> : null}
      </section> : null}

      {tab === "review" ? <section id="coach-panel-review" role="tabpanel" aria-labelledby="coach-tab-review" className="insights-match-layout insights-review-view">
        <aside className="rail-card insights-match-list"><header><span>Recent games</span><strong>{analyzedReplays.length} replay{analyzedReplays.length === 1 ? "" : "s"}</strong></header><div>{analyzedReplays.map((replay) => { const match = matchById.get(replay.matchId) ?? replay.matchSnapshot; const count = visibleInsights.filter((insight) => insight.replayId === replay.id).length; return <button type="button" data-active={selectedReplayId === replay.id} onClick={() => setSelectedReplayId(replay.id)} key={replay.id}><span><strong>{matchTitle(replay, match)}</strong><small>{new Date(replay.capturedAt).toLocaleDateString()} · {match?.result ?? "Captured"}</small></span><b>{count}</b></button>; })}</div></aside>
        <div className="insights-section">
          <header className="insights-section-heading"><div><span>Decision review with receipts</span><h3>{selectedReplayId ? matchTitle(replayById.get(selectedReplayId), matchById.get(replayById.get(selectedReplayId)?.matchId ?? "") ?? replayById.get(selectedReplayId)?.matchSnapshot) : "Select a replay"}</h3></div>{selectedReplayId ? <button type="button" className="secondary" onClick={() => onOpenReplay(selectedReplayId)}><Film size={14} /> Watch full replay</button> : null}</header>
          <DecisionMap insights={matchInsights} />
          {selectedEnhancedContext ? <EnhancedDecisionReview report={selectedEnhancedContext} onOpenReplay={onOpenReplay} /> : null}
          {matchInsights.length ? <ol className="insights-last-match-timeline">{matchInsights.slice(0, 3).map((insight, index) => <ReplayDecisionMoment insight={insight} index={index} reflection={reflectedByInsight.get(insight.id)?.value} onReflect={recordReflection} onOpenReplay={onOpenReplay} key={insight.id} />)}</ol> : selectedEnhancedContext?.reviewCandidates.length ? null : <LearningEmpty title="No decision needs promotion" body="This replay may have limited structured evidence, or its captured choices did not trigger a factual review question." />}
          {selectedLearningSignals ? <details className="insights-data-quality"><summary><Database size={14} /> Data quality & captured evidence <ChevronDown size={13} /></summary><CapturedLearningSignals signals={selectedLearningSignals} /></details> : null}
        </div>
      </section> : null}

      {tab === "progress" ? <section id="coach-panel-progress" role="tabpanel" aria-labelledby="coach-tab-progress" className="insights-section insights-progress-view">
        <header className="insights-section-heading"><div><span>Learning journal</span><h3>Your rules, repetitions and retained habits</h3></div><p>The score is whether you followed the plan. Wins and losses stay as context.</p></header>
        {coaching.focuses.length ? <><JournalSummary focuses={coaching.focuses} /><div className="insights-focus-history">{[...coaching.focuses].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).map((focus) => <FocusHistoryCard focus={focus} active={focus.id === activeFocus?.id} onResume={resumeFocus} onOpenReplay={onOpenReplay} key={focus.id} />)}</div></> : <LearningEmpty title="No learning history yet" body="Start a three-game challenge from Coach and each check-in will build your journal." />}
      </section> : null}

      {tab === "explore" ? <section id="coach-panel-explore" role="tabpanel" aria-labelledby="coach-tab-explore" className="insights-section insights-explore-view">
        <header className="insights-section-heading"><div><span>Data Lab</span><h3>Explore the evidence behind your coaching cards</h3></div><label className="insights-pattern-gate">Show cohorts<select value={minimumSample} onChange={(event) => setMinimumSample(Number(event.target.value))}><option value={5}>5+ · review sets</option><option value={10}>10+ · developing</option><option value={20}>20+ · more stable</option></select></label></header>
        <PatternExplorer stats={report.stats} minimumSample={minimumSample} cardSearch={cardSearch} onCardSearch={setCardSearch} onOpenReplay={onOpenReplay} />
        <header className="insights-section-heading insights-coaching-calls"><div><span>Recurring observations</span><h3>Patterns that meet this exploration gate</h3></div><p>These remain hypotheses until the decision context and alternatives are known.</p></header>
        {patterns.length ? <div className="insights-card-grid">{patterns.map((insight) => <LearnerInsightCard compact insight={insight} reflection={reflectedByInsight.get(insight.id)?.value} onReflect={recordReflection} onFocus={makeActiveFocus} onPractice={openPractice} onOpenReplay={onOpenReplay} key={insight.id} />)}</div> : <LearningEmpty title="No recurring pattern meets the gate" body="Lower the exploration gate or capture more comparable games. Coach recommendations remain conservative." />}
        <header className="insights-section-heading insights-card-explorer-heading"><div><span>Card journeys</span><h3>What happens after a card becomes visible</h3></div><label className="insights-card-search"><Search size={14} /><input value={cardSearch} onChange={(event) => setCardSearch(event.target.value)} placeholder="Search cards…" /></label></header>
        {cards.length ? <div className="insights-card-report-grid">{cards.map((card) => <InsightCardReport card={card} onOpenReplay={onOpenReplay} key={card.key} />)}</div> : <LearningEmpty title="No named card journeys match" body="Clear the card search or capture games with named card actions." />}
        <footer className="insights-trust-footer"><Check size={15} /><span>All analysis, reflections and experiments stay on this device. Raw captures are enriched with a bounded two-worker queue, cached locally, and Data Lab aggregation is lazy. No Firebase reads or cloud analytics are added.</span></footer>
      </section> : null}

      {shareQuest ? <CoachShareCardDialog quest={shareQuest} caption={shareCaption} onClose={() => setShareQuest(null)} /> : null}
    </section>
  );
}

function EnhancedCoachReviewQueue({ report, onReview, onOpenReplay }: {
  report: EnhancedInsightsContextReport;
  onReview: () => void;
  onOpenReplay: (replayId: string, timeMs?: number, correctionEventId?: string) => void;
}) {
  const candidate = report.reviewCandidates[0];
  if (!candidate) return null;
  const evidence = preferredEnhancedEvidence(candidate);
  return <section className="enhanced-coach-review-queue">
    <header>
      <span><ListChecks size={17} /></span>
      <div><small>Player context · review before turning it into a rule</small><h3>{candidate.title}</h3></div>
      <strong data-state={candidate.evidenceState}>{enhancedEvidenceStateLabel(candidate.evidenceState)}</strong>
    </header>
    <p>{candidate.observation}</p>
    <aside><CircleHelp size={15} /><span>{candidate.reviewQuestion}</span></aside>
    <footer>
      <span>{report.reviewCandidates.length} review candidate{report.reviewCandidates.length === 1 ? "" : "s"} · {report.evidenceReceipt.playerAuthored.decisionContexts} decision context{report.evidenceReceipt.playerAuthored.decisionContexts === 1 ? "" : "s"}</span>
      {evidence ? <button type="button" className="secondary compact" onClick={() => onOpenReplay(evidence.replayId, evidence.videoTimeMs, evidence.eventId)}><Play size={13} /> Open moment</button> : null}
      <button type="button" className="primary compact" onClick={onReview}><BookOpen size={13} /> Review evidence</button>
    </footer>
  </section>;
}

function EnhancedDecisionReview({ report, onOpenReplay }: {
  report: EnhancedInsightsContextReport;
  onOpenReplay: (replayId: string, timeMs?: number, correctionEventId?: string) => void;
}) {
  return <section className="enhanced-decision-review">
    <header>
      <div><span>Enhanced review queue</span><h4>{report.reviewCandidates.length
        ? `${report.reviewCandidates.length} player-grounded question${report.reviewCandidates.length === 1 ? "" : "s"}`
        : "No player-grounded question yet"}</h4></div>
      <span data-state={report.evidenceReceipt.state}><ShieldCheck size={13} /> {enhancedReceiptStateLabel(report.evidenceReceipt.state)}</span>
    </header>
    {report.reviewCandidates.length ? <ol>
      {report.reviewCandidates.slice(0, 5).map((candidate) => {
        const evidence = preferredEnhancedEvidence(candidate);
        return <li key={candidate.id}>
          <div className="enhanced-decision-review-index"><span>{candidate.kind === "plan-deviation" ? "Plan" : candidate.kind === "capture-correction" ? "Fix" : "Ask"}</span></div>
          <div>
            <header><strong>{candidate.title}</strong><small data-state={candidate.evidenceState}>{enhancedEvidenceStateLabel(candidate.evidenceState)}</small></header>
            <p>{candidate.observation}</p>
            <aside><CircleHelp size={14} /><span>{candidate.reviewQuestion}</span></aside>
            {candidate.relevantCapabilities.length ? <div className="enhanced-candidate-capabilities">{candidate.relevantCapabilities.map((capability) => <span data-state={capability.state} key={capability.key}>{capability.label}: {capability.state}</span>)}</div> : null}
          </div>
          {evidence ? <button type="button" className="secondary compact" onClick={() => onOpenReplay(evidence.replayId, evidence.videoTimeMs, evidence.eventId)}><Play size={13} /> {typeof evidence.videoTimeMs === "number" ? formatReplayTime(evidence.videoTimeMs) : "Replay"}</button> : null}
        </li>;
      })}
    </ol> : <p className="enhanced-decision-review-empty">Add a live marker or answer the post-game question. Saved plans and goals remain context, but RiftLite will not invent a decision from them.</p>}
    <details className="enhanced-evidence-receipt">
      <summary><Database size={14} /> Evidence receipt <ChevronDown size={13} /></summary>
      <div className="enhanced-evidence-capabilities">{report.evidenceReceipt.capabilities.map((capability) => <span data-state={capability.state} title={capability.detail} key={capability.key}><i /><strong>{capability.label}</strong><small>{capability.state} · {capability.evidenceCount}</small></span>)}</div>
      <div className="enhanced-evidence-summary">
        <span><strong>{report.evidenceReceipt.playerAuthored.flags}</strong> flags</span>
        <span><strong>{report.evidenceReceipt.playerAuthored.decisionContexts}</strong> decision notes</span>
        <span><strong>{report.evidenceReceipt.savedPlan.activeGoals}</strong> active goals</span>
        <span><strong>{report.evidenceReceipt.savedPlan.deviations}</strong> plan deviations to review</span>
      </div>
      {report.evidenceReceipt.limitations.length ? <ul>{report.evidenceReceipt.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul> : null}
    </details>
  </section>;
}

function preferredEnhancedEvidence(candidate: EnhancedInsightReviewCandidate) {
  return candidate.evidence.find((evidence) => typeof evidence.videoTimeMs === "number") ?? candidate.evidence[0];
}

function enhancedEvidenceStateLabel(state: EnhancedInsightReviewCandidate["evidenceState"]): string {
  if (state === "available") return "Evidence available";
  if (state === "partial") return "Partial evidence";
  if (state === "unknown") return "Capture gap";
  return "Player-authored";
}

function enhancedReceiptStateLabel(state: EnhancedInsightsContextReport["evidenceReceipt"]["state"]): string {
  if (state === "reviewable") return "Reviewable";
  if (state === "context-limited") return "Context limited";
  if (state === "player-context-only") return "Player context only";
  return "No supported evidence";
}

function CoachJourney({ step }: { step: number }) {
  const stages = [
    ["Review", "See the decision"],
    ["Choose", "Lock one rule"],
    ["Play", "Test three games"],
    ["Debrief", "Keep or adjust"]
  ];
  return <ol className="insights-coach-journey" aria-label="Coaching journey">
    {stages.map(([title, detail], index) => <li data-state={index < step ? "done" : index === step ? "active" : "next"} key={title}>
      <span>{index < step ? <Check size={13} /> : index + 1}</span>
      <div><strong>{title}</strong><small>{detail}</small></div>
    </li>)}
  </ol>;
}

function CoachFocusControls({
  focus,
  progress,
  planDraft,
  editingPlan,
  onPlanDraft,
  onStartEditing,
  onCancelEditing,
  onSavePlan,
  onPause,
  onComplete
}: {
  focus: ReplayCoachingFocus;
  progress: ReturnType<typeof replayCoachingProgress>;
  planDraft: string;
  editingPlan: boolean;
  onPlanDraft: (value: string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSavePlan: () => void;
  onPause: () => void;
  onComplete: (status: "learned" | "adjusted") => void;
}) {
  const tracked = progress?.eligibleGamesTracked ?? 0;
  const target = progress?.targetEligibleGames ?? focus.experiment?.targetEligibleGames ?? 3;
  return <section className="insights-coach-focus-tools">
    <header>
      <div><span>Challenge controls</span><strong>{tracked} of {target} eligible games checked in</strong></div>
      <div><button type="button" className="secondary compact" onClick={onPause}><Pause size={13} /> Pause</button>{!editingPlan ? <button type="button" className="secondary compact" onClick={onStartEditing}><Pencil size={13} /> Edit rule</button> : null}</div>
    </header>
    {editingPlan ? <div className="insights-coach-rule-editor"><textarea aria-label="Challenge rule" value={planDraft} onChange={(event) => onPlanDraft(event.target.value)} /><div><button type="button" className="secondary compact" onClick={onCancelEditing}>Cancel</button><button type="button" className="primary compact" disabled={!planDraft.trim()} onClick={onSavePlan}>Save rule</button></div></div> : <p><Target size={14} /><span>{focus.experiment?.process ?? focus.insight.action}</span></p>}
    {progress?.readyForReview ? <div className="insights-coach-debrief"><span><Trophy size={16} /> Challenge complete. Did this rule earn a place in your game plan?</span><div><button type="button" className="secondary" onClick={() => onComplete("adjusted")}><RotateCcw size={14} /> Adjust and retest</button><button type="button" className="primary" onClick={() => onComplete("learned")}><Check size={14} /> Keep this rule</button></div></div> : null}
  </section>;
}

function CoachCheckins({ games, onCheckin, onOpenReplay }: {
  games: ReplayCoachingGameSnapshot[];
  onCheckin: (game: ReplayCoachingGameSnapshot, adherence: ReplayCoachingAdherence) => void;
  onOpenReplay: (replayId: string) => void;
}) {
  return <section className="insights-coach-checkins">
    <header><span><ListChecks size={16} /></span><div><strong>Check in before the next game</strong><small>Did you follow the rule when the situation appeared?</small></div></header>
    <div>{games.map((game) => <article key={game.id}>
      <span><strong>{game.opponentLegend ? `vs ${game.opponentLegend}` : "Eligible game"}</strong><small>{new Date(game.capturedAt).toLocaleDateString()} · {game.result ?? "Captured"}</small></span>
      <div>
        <button type="button" data-choice="good" onClick={() => onCheckin(game, "followed")}><Check size={13} /> Followed it</button>
        <button type="button" data-choice="bad" onClick={() => onCheckin(game, "missed")}><X size={13} /> Missed it</button>
        <button type="button" onClick={() => onCheckin(game, "unsure")}><CircleHelp size={13} /> Unsure</button>
        <button type="button" onClick={() => onCheckin(game, "not-applicable")}>Didn&apos;t appear</button>
        {game.replayId ? <button type="button" onClick={() => onOpenReplay(game.replayId!)}><Film size={13} /> Watch</button> : null}
      </div>
    </article>)}</div>
  </section>;
}

function QuestQueueRow({ quest, view, insight, onStart, onReview }: {
  quest: ReplayCoachQuest;
  view: CoachQuestViewModel;
  insight?: ReplayInsight;
  onStart: (insight: ReplayInsight) => void;
  onReview: (evidenceId?: string) => void;
}) {
  const rate = view.metric.denominator > 0 ? Math.round(view.metric.numerator / view.metric.denominator * 100) : 0;
  const art = view.art?.card ?? view.art?.legend;
  const firstEvidence = quest.evidence[0];
  return <article className="insights-quest-queue-row" data-category={view.category}>
    <div className="insights-quest-queue-art">{art?.url ? <img src={art.url} alt="" /> : <span>{categoryLabel(quest.category).slice(0, 1)}</span>}</div>
    <div className="insights-quest-queue-copy"><span>{quest.kind === "challenge" ? "Challenge candidate" : "Replay question"} · {categoryLabel(quest.category)}</span><strong>{view.title}</strong><small>{view.rule}</small></div>
    <div className="insights-quest-queue-stat"><strong>{rate}%</strong><span>{view.metric.label}</span><i><b style={{ width: `${rate}%` }} /></i></div>
    {quest.kind === "challenge" && insight ? <button type="button" className="primary compact" onClick={() => onStart(insight)}>Choose rule <ArrowRight size={13} /></button> : <button type="button" className="secondary compact" disabled={!firstEvidence} onClick={() => onReview(firstEvidence ? questEvidenceId(quest, firstEvidence, 0) : undefined)}>Review <Play size={13} /></button>}
  </article>;
}

function StrengthStrip({ insight, onOpenReplay }: { insight: ReplayInsight; onOpenReplay: (replayId: string, timeMs?: number) => void }) {
  const evidence = insight.evidence.find((item) => typeof item.videoTimeMs === "number") ?? insight.evidence[0];
  return <aside className="insights-strength-strip"><span><CheckCircle2 size={18} /></span><div><small>Keep doing this</small><strong>{insight.title}</strong><p>{insight.action}</p></div><b>{insight.sampleSize} observed</b>{evidence ? <button type="button" className="secondary compact" onClick={() => onOpenReplay(evidence.replayId, evidence.videoTimeMs)}><Play size={13} /> See example</button> : null}</aside>;
}

function ReplayDecisionMoment({ insight, index, reflection, onReflect, onOpenReplay }: {
  insight: ReplayInsight;
  index: number;
  reflection?: ReplayInsightReflection;
  onReflect: (insight: ReplayInsight, reflection: ReplayInsightReflection) => void;
  onOpenReplay: (replayId: string, timeMs?: number, correctionEventId?: string) => void;
}) {
  const evidence = insight.evidence.find((item) => typeof item.videoTimeMs === "number") ?? insight.evidence[0];
  const art = cardArtworkForInsight(insight);
  return <li className="insights-decision-moment">
    <span className="insights-decision-moment__number">{index + 1}</span>
    <div className="insights-decision-moment__art">{art ? <img src={art} alt="" /> : <span>{categoryLabel(insight.category).slice(0, 1)}</span>}</div>
    <div className="insights-decision-moment__copy"><span>{categoryLabel(insight.category)}{typeof evidence?.videoTimeMs === "number" ? ` · ${formatReplayTime(evidence.videoTimeMs)}` : ""}</span><strong>{insight.title}</strong><p>{reviewQuestionForInsight(insight)}</p>{reflection ? <small><Check size={12} /> Your context: {reflectionLabel(reflection)}</small> : <div className="insights-decision-context"><button type="button" onClick={() => onReflect(insight, "intentional")}>Intentional</button><button type="button" onClick={() => onReflect(insight, "missed")}>I missed it</button><button type="button" onClick={() => onReflect(insight, "forced")}>Forced line</button><button type="button" onClick={() => onReflect(insight, "unsure")}>Not sure</button></div>}</div>
    {evidence ? <button type="button" className="secondary" onClick={() => onOpenReplay(evidence.replayId, evidence.videoTimeMs, evidence.eventId)}><Play size={14} /> Watch moment</button> : null}
  </li>;
}

function JournalSummary({ focuses }: { focuses: ReplayCoachingFocus[] }) {
  const rows = focuses
    .map((focus) => ({ focus, progress: replayCoachingProgress(focus) }))
    .filter((row) => row.progress)
    .sort((left, right) => Date.parse(left.focus.updatedAt) - Date.parse(right.focus.updatedAt));
  const reviewed = rows.reduce((sum, row) => sum + (row.progress?.eligibleGamesTracked ?? 0), 0);
  const followed = rows.reduce((sum, row) => sum + (row.progress?.during.followed ?? 0), 0);
  const assessed = rows.reduce((sum, row) => sum + (row.progress?.during.assessedOpportunities ?? 0), 0);
  const adherence = assessed ? Math.round(followed / assessed * 100) : null;
  const retained = focuses.filter((focus) => focus.status === "learned").length;
  const chartRows = rows.slice(-8);
  return <section className="insights-journal-summary">
    <div className="insights-journal-stats"><span><strong>{reviewed}</strong><small>games reviewed</small></span><span><strong>{adherence == null ? "—" : `${adherence}%`}</strong><small>rule adherence</small></span><span><strong>{retained}</strong><small>rules retained</small></span></div>
    <div className="insights-journal-chart" role="img" aria-label={`Adherence across ${chartRows.length} recent coaching challenges`}>
      <header><span>Challenge adherence</span><small>Recent →</small></header>
      <div>{chartRows.map(({ focus, progress }) => { const rate = progress?.during.adherenceRate; return <span aria-label={`${focus.insight.title}: ${rate == null ? "not measured" : `${rate} percent adherence`}`} key={focus.id}><i style={{ height: `${Math.max(4, rate ?? 0)}%` }} /><small>{rate == null ? "—" : `${rate}%`}</small></span>; })}</div>
    </div>
  </section>;
}

function coachQuestViewModel(
  quest: ReplayCoachQuest,
  focus?: ReplayCoachingFocus,
  progress?: ReturnType<typeof replayCoachingProgress>,
  pendingCheckins = 0
): CoachQuestViewModel {
  const status = focus
    ? progress?.readyForReview || pendingCheckins ? "awaiting-review" : "active"
    : quest.kind === "review-question" ? "awaiting-review" : "pending";
  const artLegend = quest.category === "matchup" && quest.art.opponentLegend
    ? quest.art.opponentLegend
    : quest.art.playerLegend ?? quest.art.opponentLegend;
  const shareCaption = [quest.scope.playerLegend, quest.scope.opponentLegend]
    .filter(Boolean)
    .join(" vs ") || categoryLabel(quest.category);
  const defaultRule = focus?.experiment?.process ?? (quest.kind === "review-question" ? quest.reviewQuestion ?? quest.nextGameRule : quest.nextGameRule);
  const presentation = coachQuestPresentation(quest, defaultRule);
  const evidencePreview = questEvidencePreview(quest);
  return {
    id: quest.id,
    category: coachQuestCategory(quest.category),
    kind: quest.kind === "review-question" ? "review" : "challenge",
    title: presentation.title,
    observation: presentation.observation,
    status,
    when: presentation.when,
    rule: presentation.rule,
    why: quest.finding.body,
    metric: {
      label: quest.primaryMetric.label,
      numerator: quest.primaryMetric.numerator,
      denominator: quest.primaryMetric.denominator,
      receipt: quest.primaryMetric.display,
      tone: quest.primaryMetric.kind === "capture-coverage" ? "neutral" : quest.primaryMetric.interpretation === "lower-is-better" ? "negative" : quest.primaryMetric.interpretation === "higher-is-better" ? "positive" : "neutral",
      comparator: quest.comparator ? {
        label: quest.comparator.label,
        numerator: quest.comparator.numerator,
        denominator: quest.comparator.denominator
      } : undefined
    },
    art: {
      card: quest.art.card ? { name: quest.art.card.name, url: quest.art.card.imageUrl || cardArtworkForName(quest.art.card.name, quest.art.card.id) } : undefined,
      legend: artLegend ? { name: artLegend.name, url: legendImageUrl(artLegend.name) } : undefined,
      battlefield: quest.category === "battlefield" ? { name: "Battlefield plan" } : undefined
    },
    evidenceActions: evidencePreview.map(({ evidence, sourceIndex }, index) => ({
      id: questEvidenceId(quest, evidence, sourceIndex),
      label: quest.art.card?.name ? `Example ${index + 1}: ${quest.art.card.name}` : evidence.label,
      detail: `${formatEvidenceDate(evidence.capturedAt)} · ${typeof evidence.videoTimeMs === "number" ? formatReplayTime(evidence.videoTimeMs) : "Replay"} · ${confidenceLabel(evidence.confidence)}`,
      tone: quest.tone === "opportunity" ? "warning" : "proof"
    })),
    challenge: {
      title: quest.kind === "review-question" && !focus ? "Review before testing" : "Three-game challenge",
      games: coachQuestGames(focus, progress, pendingCheckins),
      label: quest.kind === "review-question" && !focus
        ? "One game raised this question; review it before making a rule."
        : focus ? `${progress?.eligibleGamesTracked ?? 0} reviewed · ${progress?.during.followed ?? 0} followed` : "Prove the habit across your next three games"
    },
    shareCaption
  };
}

function coachQuestViewModelFromFocus(
  focus: ReplayCoachingFocus,
  progress: ReturnType<typeof replayCoachingProgress>,
  pendingCheckins: number
): CoachQuestViewModel {
  const assessed = progress?.during.assessedOpportunities ?? 0;
  const followed = progress?.during.followed ?? 0;
  return {
    id: focus.id,
    category: coachQuestCategory(focus.insight.category),
    kind: "challenge",
    title: focus.insight.title,
    observation: focus.insight.body,
    status: progress?.readyForReview || pendingCheckins ? "awaiting-review" : "active",
    when: fallbackTriggerForFocus(focus),
    rule: focus.experiment?.process ?? focus.insight.action ?? "Repeat the decision deliberately in the next comparable game.",
    why: focus.insight.body ?? "This is your saved coaching focus. Its original evidence is outside the current filter scope.",
    metric: { label: "Rule followed in reviewed games", numerator: followed, denominator: assessed, receipt: `${followed} of ${assessed} reviewed opportunities`, tone: assessed ? "positive" : "neutral" },
    art: { card: focus.insight.cardName ? { name: focus.insight.cardName, url: cardArtworkForName(focus.insight.cardName, focus.insight.cardId) } : undefined, legend: focus.insight.opponentLegend ? { name: focus.insight.opponentLegend, url: legendImageUrl(focus.insight.opponentLegend) } : undefined },
    challenge: { games: coachQuestGames(focus, progress, pendingCheckins), label: `${progress?.eligibleGamesTracked ?? 0} reviewed · ${followed} followed` },
    shareCaption: focus.insight.opponentLegend ? `Matchup: ${focus.insight.opponentLegend}` : categoryLabel(focus.insight.category)
  };
}

function coachQuestGames(
  focus?: ReplayCoachingFocus,
  progress?: ReturnType<typeof replayCoachingProgress>,
  pendingCheckins = 0
): [
  { state: CoachQuestGameState; label?: string },
  { state: CoachQuestGameState; label?: string },
  { state: CoachQuestGameState; label?: string }
] {
  const games: Array<{ state: CoachQuestGameState; label?: string }> = (focus?.experiment?.games ?? [])
    .filter((game) => game.adherence !== "not-applicable")
    .slice(0, 3)
    .map((game) => ({
      state: game.adherence === "followed" ? "success" as const : game.adherence === "missed" ? "missed" as const : "unsure" as const,
      label: `${game.opponentLegend ? `vs ${game.opponentLegend} · ` : ""}${game.adherence === "followed" ? "Rule followed" : game.adherence === "missed" ? "Rule missed" : "Needs another look"}`
    }));
  while (games.length < 3) {
    const isNext = Boolean(focus && !progress?.readyForReview && games.length === (focus.experiment?.games.filter((game) => game.adherence !== "not-applicable").length ?? 0));
    games.push({ state: isNext ? "active" : "pending", label: isNext && pendingCheckins ? "Check-in ready" : isNext ? "Next eligible game" : "Not played yet" });
  }
  return games as [
    { state: CoachQuestGameState; label?: string },
    { state: CoachQuestGameState; label?: string },
    { state: CoachQuestGameState; label?: string }
  ];
}

function coachQuestCategory(category = ""): CoachQuestCategory {
  if (category === "opening-hand") return "mulligan";
  if (category === "curve") return "sequencing";
  if (category === "battlefield") return "battlefield";
  if (category === "matchup") return "matchup";
  if (category === "card-efficiency") return "card-usage";
  return "resource";
}

function questEvidenceId(quest: ReplayCoachQuest, evidence: ReplayCoachQuest["evidence"][number], index: number): string {
  return `${quest.id}:${evidence.eventId ?? `${evidence.replayId}:${evidence.videoTimeMs ?? index}`}`;
}

function coachQuestPresentation(quest: ReplayCoachQuest, defaultRule: string): {
  title: string;
  observation: string;
  when: string;
  rule: string;
} {
  const cardName = quest.art.card?.name;
  if (cardName && quest.insightId.endsWith(":often-unplayed")) {
    return {
      title: `Is ${cardName} earning its place in your hand?`,
      observation: `RiftLite matched no captured play of ${cardName} in ${quest.primaryMetric.numerator} of ${quest.primaryMetric.denominator} complete-enough game appearances.`,
      when: `When reviewing ${cardName} after it becomes visible`,
      rule: "Was it intentionally held, converted for value, or stranded?"
    };
  }
  if (cardName && quest.insightId.endsWith(":late-after-keep")) {
    return {
      title: `Test a more selective ${cardName} keep`,
      observation: quest.finding.title,
      when: `When ${cardName} is in your opening hand`,
      rule: defaultRule
    };
  }
  if (cardName && quest.insightId.endsWith(":converted-away")) {
    return {
      title: `Is ${cardName} doing enough before it leaves your hand?`,
      observation: quest.finding.title,
      when: `When reviewing a ${cardName} appearance`,
      rule: "Was converting it part of the plan, or did the card lack a useful window?"
    };
  }
  return {
    title: quest.finding.title,
    observation: quest.finding.body,
    when: quest.trigger,
    rule: defaultRule
  };
}

function questEvidencePreview(quest: ReplayCoachQuest): Array<{
  evidence: ReplayCoachQuest["evidence"][number];
  sourceIndex: number;
}> {
  const seenReplays = new Set<string>();
  const result: Array<{ evidence: ReplayCoachQuest["evidence"][number]; sourceIndex: number }> = [];
  quest.evidence.forEach((evidence, sourceIndex) => {
    if (result.length >= 3 || seenReplays.has(evidence.replayId)) return;
    seenReplays.add(evidence.replayId);
    result.push({ evidence, sourceIndex });
  });
  return result;
}

function formatEvidenceDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { day: "numeric", month: "short" })
    : "Captured game";
}

function shareTextFromQuest(quest: CoachQuestViewModel): string {
  const rate = quest.metric.denominator > 0 ? Math.round(quest.metric.numerator / quest.metric.denominator * 100) : 0;
  return `My next-game rule: ${quest.title}\nWhen: ${quest.when}\nDo: ${quest.rule}\nCaptured stat: ${rate}% (${quest.metric.numerator}/${quest.metric.denominator})\nBuilt locally with RiftLite Coach.`;
}

function fallbackTriggerForFocus(focus: ReplayCoachingFocus): string {
  if (focus.insight.cardName) return `When ${focus.insight.cardName} becomes relevant`;
  if (focus.insight.opponentLegend) return `When facing ${focus.insight.opponentLegend}`;
  if (focus.insight.category === "opening-hand") return "When choosing an opening hand";
  if (focus.insight.category === "curve") return "During the opening turns";
  return "When this decision appears again";
}

function cardArtworkForInsight(insight: ReplayInsight): string {
  return cardArtworkForName(insight.cardName, insight.cardId);
}

function cardArtworkForName(name?: string, id?: string): string {
  for (const alias of riftboundCardCodeAliases(id ?? "")) {
    const card = CARD_ART_BY_CODE.get(alias.toLocaleLowerCase());
    if (card?.imageUrl) return card.imageUrl;
  }
  return CARD_ART_BY_NAME.get(normalizeCardArtName(name))?.imageUrl ?? "";
}

function buildCardArtByName() {
  const result = new Map<string, (typeof CARD_CATALOG)[number]>();
  for (const card of CARD_CATALOG) {
    const key = normalizeCardArtName(card.name);
    if (!key) continue;
    const current = result.get(key);
    const cardIsBase = riftboundBasePrintCode(card.code) === card.code;
    const currentIsBase = current ? riftboundBasePrintCode(current.code) === current.code : false;
    if (!current || cardIsBase && !currentIsBase) result.set(key, card);
  }
  return result;
}

function normalizeCardArtName(value?: string) {
  return value?.trim().toLocaleLowerCase().replace(/\s+/g, " ") ?? "";
}

function reviewQuestionForInsight(insight: ReplayInsight): string {
  const action = insight.action.trim().replace(/[.!?]+$/, "");
  return action ? `For this replay: ${action.charAt(0).toLocaleLowerCase()}${action.slice(1)}?` : "What made this decision right for this game?";
}

function formatReplayTime(timeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function CapturedLearningSignals({ signals }: { signals: ReplayLearningSignals }) {
  const capabilities: Array<[string, ReplayLearningCapability]> = [
    ["Opening hand", signals.capabilities.openingHand],
    ["Card timing", signals.capabilities.cardTiming],
    ["Resources", signals.capabilities.resources],
    ["Sideboard", signals.capabilities.sideboard],
    ["Combat", signals.capabilities.combat],
    ["Battlefields", signals.capabilities.battlefield]
  ];
  const resourceRows = [...signals.resourceCoverage.observations].reverse().slice(0, 4);
  const sideboardRows = signals.sideboardFlows.slice(0, 6);
  const battlefieldRows = signals.battlefieldConversions.slice(0, 6);
  const hasDetailedSignals = resourceRows.length > 0 || sideboardRows.length > 0 || battlefieldRows.length > 0;
  return <section className="insights-captured-context">
    <header>
      <span><Database size={16} /></span>
      <div><strong>What this capture can teach from</strong><small>A factual receipt of retained evidence. Unknown means RiftLite did not capture it—not that it did not happen.</small></div>
    </header>
    <div className="insights-capability-receipt">
      {capabilities.map(([label, capability]) => <span data-state={capability.state} title={capability.detail} key={label}><i /> <strong>{label}</strong><small>{capability.state}</small></span>)}
    </div>
    {hasDetailedSignals ? <div className="insights-captured-signal-grid">
      {resourceRows.length ? <article>
        <header><span>End-of-turn resources</span><small>{signals.resourceCoverage.provenEndStates}/{signals.resourceCoverage.capturedPlayerTurnEnds} captured endings proven</small></header>
        <div>{resourceRows.map((row) => <p key={row.eventId}><strong>{row.playerTurnNumber
          ? `Your turn ${row.playerTurnNumber}`
          : row.gameNumber
            ? `Game ${row.gameNumber} turn end`
            : "Turn end · game unknown"}</strong><span>{resourceObservationText(row.unused)}</span></p>)}</div>
      </article> : null}
      {sideboardRows.length ? <article>
        <header><span>Post-board card journeys</span><small>What was captured after each change</small></header>
        <div>{sideboardRows.map((row) => <p key={row.key}><strong>{row.cardName}</strong><span>{row.boardedInQuantity ? `+${row.boardedInQuantity} in` : ""}{row.boardedInQuantity && row.boardedOutQuantity ? " · " : ""}{row.boardedOutQuantity ? `−${row.boardedOutQuantity} out` : ""} · seen {knownCount(row.subsequentVisibleCount)} · played {knownCount(row.subsequentPlayedCount)} · recycled {knownCount(row.subsequentRecycledCount)}</span></p>)}</div>
      </article> : null}
      {battlefieldRows.length ? <article>
        <header><span>Battlefield score moments</span><small>Only explicitly attributed score events</small></header>
        <div>{battlefieldRows.map((row) => <p key={row.eventId}><strong>{row.battlefield}</strong><span>{row.side === "me" ? "You" : row.side === "opponent" ? "Opponent" : "Captured side"} · {row.reason}{row.pointsScored != null ? ` · ${row.pointsScored} point${row.pointsScored === 1 ? "" : "s"}` : ""}</span></p>)}</div>
      </article> : null}
    </div> : <p className="insights-captured-context-empty">This replay still contributes its match result and any supported coaching evidence. Deeper resource, sideboard and battlefield context was not retained.</p>}
  </section>;
}

function LearnerInsightCard({ insight, reflection, compact = false, onReflect, onFocus, onPractice, onOpenReplay }: {
  insight: ReplayInsight;
  reflection?: ReplayInsightReflection;
  compact?: boolean;
  onReflect: (insight: ReplayInsight, reflection: ReplayInsightReflection) => void;
  onFocus: (insight: ReplayInsight) => void;
  onPractice: (insight: ReplayInsight) => void;
  onOpenReplay: (replayId: string, timeMs?: number, correctionEventId?: string) => void;
}) {
  const primary = insight.evidence.find((evidence) => typeof evidence.videoTimeMs === "number") ?? insight.evidence[0];
  return <article className="insight-card learner-insight-card" data-tone={insight.tone} data-compact={compact || undefined}>
    <header><span className="insight-card-icon">{insight.tone === "positive" ? <Check size={17} /> : insight.tone === "opportunity" ? <Lightbulb size={17} /> : <Eye size={17} />}</span><div><span>{categoryLabel(insight.category)}</span><strong>{insight.title}</strong></div><div className="insight-trust-badges"><span className="insight-confidence" data-confidence={insight.captureConfidence}>Capture: {confidenceLabel(insight.captureConfidence)}</span><span className="insight-pattern-strength" data-strength={insight.patternStrength}>Pattern: {patternStrengthLabel(insight.patternStrength)}</span></div></header>
    <p>{insight.body}</p>
    <section className="insights-interpretation"><strong>What this could mean</strong><span>{interpretationForInsight(insight)}</span></section>
    <aside><Sparkles size={14} /><span><strong>Experiment:</strong> {insight.action}</span></aside>
    <div className="insight-data-receipt"><span>{insight.dataReceipt.observationCount} observation{insight.dataReceipt.observationCount === 1 ? "" : "s"}</span><span>{insight.dataReceipt.completePlayCaptureScopeGames}/{insight.dataReceipt.scopeGames} games with complete-enough play capture</span><span>{insight.dataReceipt.deckFingerprints.length ? `${insight.dataReceipt.deckFingerprints.length} deck version${insight.dataReceipt.deckFingerprints.length === 1 ? "" : "s"}` : "deck version unknown"}</span><span>{insight.dataReceipt.periods.map(periodLabel).join(" + ") || "period unknown"}</span></div>
    {insight.evidence.length ? <div className="insight-evidence-filmstrip" aria-label="Replay evidence">{insight.evidence.slice(0, 3).map((evidence, index) => <button type="button" onClick={() => onOpenReplay(evidence.replayId, evidence.videoTimeMs)} key={`${evidence.replayId}:${evidence.eventId ?? index}`}><span><Film size={14} /></span><strong>{evidence.label}</strong><small>{typeof evidence.videoTimeMs === "number" ? "Watch moment" : "Open replay"} · {confidenceLabel(evidence.confidence)}</small></button>)}</div> : null}
    {reflection ? <div className="insight-reflection-saved"><CheckCircle2 size={14} /><span>Your context: <strong>{reflectionLabel(reflection)}</strong></span></div> : <details className="insight-reflection"><summary><CircleHelp size={13} /> Add your context <ChevronDown size={12} /></summary><p>RiftLite can see the action, but only you know the plan.</p><div>{(["intentional", "missed", "forced", "unsure", "already-understood", "wrong"] as const).map((value) => <button type="button" onClick={() => onReflect(insight, value)} key={value}>{reflectionLabel(value)}</button>)}</div></details>}
    <footer>{primary ? <button type="button" className="secondary compact" onClick={() => onOpenReplay(primary.replayId, primary.videoTimeMs)}><Play size={13} /> Review</button> : null}{labDestinationForInsight(insight) ? <button type="button" className="secondary compact" onClick={() => onPractice(insight)}><FlaskConical size={13} /> Lab</button> : null}{insight.tone !== "positive" ? <button type="button" className="primary compact" onClick={() => onFocus(insight)}><Target size={13} /> Practise this</button> : null}</footer>
  </article>;
}

function DecisionMap({ insights }: { insights: ReplayInsight[] }) {
  const stages = [
    { key: "opening-hand", label: "Opening plan" },
    { key: "curve", label: "Development" },
    { key: "battlefield", label: "Battlefield" },
    { key: "card-efficiency", label: "Card roles" },
    { key: "matchup", label: "Matchup plan" }
  ];
  return <section className="insights-decision-map" aria-label="Match decision map">{stages.map((stage, index) => { const count = insights.filter((insight) => insight.category === stage.key).length; return <React.Fragment key={stage.key}><div data-active={count > 0 || undefined}><span>{index + 1}</span><strong>{stage.label}</strong><small>{count ? `${count} review point${count === 1 ? "" : "s"}` : "No promoted signal"}</small></div>{index < stages.length - 1 ? <ArrowRight size={14} /> : null}</React.Fragment>; })}</section>;
}

function FocusHistoryCard({ focus, active, onResume, onOpenReplay }: { focus: ReplayCoachingFocus; active: boolean; onResume: (focus: ReplayCoachingFocus) => void; onOpenReplay: (replayId: string) => void }) {
  const progress = replayCoachingProgress(focus);
  return <article className="insights-focus-history-card" data-active={active || undefined}><header><span><History size={16} /></span><div><small>{statusLabel(focus.status)} · {categoryLabel(focus.insight.category)}</small><strong>{focus.insight.title}</strong></div>{progress ? <b>{progress.eligibleGamesTracked}/{progress.targetEligibleGames}</b> : null}</header><p>{focus.experiment?.process ?? focus.insight.action}</p>{progress ? <div className="insights-history-metrics"><span><strong>{progress.during.followed}</strong><small>followed</small></span><span><strong>{progress.during.missed}</strong><small>missed</small></span><span><strong>{typeof progress.during.adherenceRate === "number" ? `${progress.during.adherenceRate}%` : "—"}</strong><small>adherence</small></span><span><strong>{progress.results.wins}–{progress.results.losses}</strong><small>result context</small></span></div> : null}<footer>{focus.insight.replayId ? <button type="button" className="secondary compact" onClick={() => onOpenReplay(focus.insight.replayId!)}><Film size={13} /> Evidence</button> : null}{!active && (focus.status === "paused" || focus.status === "adjusted") ? <button type="button" className="primary compact" onClick={() => onResume(focus)}><Play size={13} /> Resume focus</button> : null}</footer></article>;
}

function LearningEmpty({ title, body, compact = false }: { title: string; body: string; compact?: boolean }) {
  return <div className="insights-empty insights-learning-empty" data-compact={compact || undefined}><Brain size={24} /><strong>{title}</strong><span>{body}</span></div>;
}

function buildCoachingGames(matches: MatchDraft[], replayByMatchId: Map<string, ReplayRecord>): ReplayCoachingGameSnapshot[] {
  return matches.flatMap((match) => match.games.map((game) => ({
    id: `${match.id}:game-${game.gameNumber}`,
    capturedAt: match.capturedAt,
    replayId: replayByMatchId.get(match.id)?.id,
    matchId: match.id,
    gameNumber: game.gameNumber,
    deckKey: match.deckSourceKey || match.deckSourceId || match.deckName || undefined,
    opponentLegend: match.opponentChampion || undefined,
    gameStage: game.gameNumber === 1 ? "preboard" as const : "postboard" as const,
    initiative: game.wentFirst === "1st" || game.wentFirst === "2nd" ? game.wentFirst : undefined,
    result: game.result
  }))).sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt) || (left.gameNumber ?? 0) - (right.gameNumber ?? 0));
}

function eligibilityForInsight(insight: ReplayInsight, filters: ReplayInsightFilters, matchById: Map<string, MatchDraft>): ReplayCoachingEligibilityScope {
  const match = insight.matchId ? matchById.get(insight.matchId) : undefined;
  const eligibility: ReplayCoachingEligibilityScope = {};
  const deck = filters.deckKey || match?.deckSourceKey || match?.deckSourceId || match?.deckName;
  const opponent = filters.opponentLegend || (insight.category === "matchup" ? insight.opponentLegend || match?.opponentChampion : "");
  if (deck) eligibility.deckKey = deck;
  if (opponent) eligibility.opponentLegend = opponent;
  if (filters.gameStage === "preboard" || filters.gameStage === "postboard") eligibility.gameStage = filters.gameStage;
  else if (insight.gameNumber) eligibility.gameStage = insight.gameNumber === 1 ? "preboard" : "postboard";
  if (filters.wentFirst) eligibility.initiative = filters.wentFirst;
  return eligibility;
}

function hypothesisForInsight(insight: ReplayInsight): string {
  if (insight.category === "opening-hand") return "This opening-hand choice may be making the deck's early plan less consistent, unless the card was kept for a specific matchup job.";
  if (insight.category === "curve") return "The opening sequence may be creating avoidable development gaps, although resource or matchup constraints may explain them.";
  if (insight.category === "card-efficiency") return `${insight.cardName || "This card"} may be waiting for conditions that occur less often than expected, or may be correctly held for flexibility.`;
  if (insight.category === "battlefield") return "The battlefield plan may be taking longer to convert into scoring pressure, but the matchup could reward that setup.";
  if (insight.category === "matchup") return "A repeated matchup-specific decision may be worth turning into an explicit rule and testing consistently.";
  return "This looks like a repeatable strength worth retaining in future comparable games.";
}

function successSignalForInsight(insight: ReplayInsight): string {
  if (insight.category === "opening-hand") return "A clearer opening plan and fewer stranded kept cards.";
  if (insight.category === "curve") return "More eligible games with the intended turn-two development.";
  if (insight.category === "card-efficiency") return "The card fulfils its intended role more consistently when seen.";
  if (insight.category === "battlefield") return "The chosen plan reaches a contest or scoring window more consistently.";
  return "The decision rule is followed consistently in comparable games.";
}

function interpretationForInsight(insight: ReplayInsight): string {
  if (insight.category === "opening-hand") return "An optimistic keep, a matchup-specific answer, or a hand whose wider plan justified the risk.";
  if (insight.category === "curve") return "A curve bottleneck, a rune or resource constraint, or an intentional reactive turn.";
  if (insight.category === "card-efficiency") return "A stranded card, a deliberately held answer, or a flexible card doing hidden work in hand.";
  if (insight.category === "battlefield") return "A slower conversion plan, an unavailable contest, or a deliberate setup for a stronger scoring window.";
  if (insight.category === "matchup") return "A real matchup habit, a deck-version difference, or a small cluster of similar games.";
  return "A decision pattern that appears repeatable in the currently comparable evidence.";
}

function labDestinationForInsight(insight: Pick<ReplayInsight, "category"> | ReplayCoachingFocus["insight"]): "mulligan" | "sideboard" | null {
  if (insight.category === "opening-hand" || insight.category === "curve") return "mulligan";
  if (insight.category === "matchup") return "sideboard";
  return null;
}

function coachInsightScore(insight: ReplayInsight): number {
  const controllability = insight.category === "opening-hand" || insight.category === "curve" ? 12 : insight.category === "card-efficiency" ? 8 : 4;
  const capture = insight.captureConfidence === "confirmed" || insight.captureConfidence === "manual" ? 8 : insight.captureConfidence === "reconstructed" ? 4 : 0;
  const repeatability = insight.patternStrength === "reasonably-stable" ? 12 : insight.patternStrength === "developing" ? 8 : insight.patternStrength === "exploratory" ? 3 : 0;
  return insight.priority + controllability + capture + repeatability + Math.min(8, Math.log2(Math.max(1, insight.sampleSize)) * 2);
}

function readCoachingStore(): ReplayCoachingStore {
  try {
    return parseReplayCoachingStore(window.localStorage.getItem(REPLAY_COACHING_STORAGE_KEY)).store;
  } catch {
    return emptyReplayCoachingStore();
  }
}

function readLegacyDismissed(): Set<string> {
  try {
    const value = JSON.parse(window.localStorage.getItem(LEGACY_FEEDBACK_STORAGE_KEY) ?? "{}") as { dismissed?: unknown };
    return new Set(Array.isArray(value.dismissed) ? value.dismissed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function coachingScopeSummary(filters: ReplayInsightFilters, games: number): string {
  const parts = [
    filters.period === "current-season" ? "current season" : filters.period === "preseason" ? "pre-season" : "pre-season + current season",
    filters.deckKey || "all decks",
    filters.opponentLegend ? `vs ${filters.opponentLegend}` : "all opponents",
    filters.gameStage === "preboard" ? "pre-board" : filters.gameStage === "postboard" ? "post-sideboard" : "all game stages",
    `${games} eligible game${games === 1 ? "" : "s"}`
  ];
  return parts.join(" · ");
}

function confidenceLabel(confidence: ReplayIntelligenceConfidence): string {
  if (confidence === "confirmed") return "confirmed";
  if (confidence === "reconstructed") return "reconstructed";
  if (confidence === "manual") return "reviewed";
  return "inferred";
}

function patternStrengthLabel(value: ReplayInsight["patternStrength"]): string {
  if (value === "reasonably-stable") return "reasonably stable";
  if (value === "developing") return "developing";
  if (value === "exploratory") return "exploratory";
  return "one observation";
}

function captureCoverageLabel(grade: "high" | "medium" | "limited"): string {
  if (grade === "high") return "Broad";
  if (grade === "medium") return "Useful";
  return "Limited";
}

function periodLabel(period: ReplayInsight["dataReceipt"]["periods"][number]): string {
  if (period === "current-season") return "current season";
  if (period === "preseason") return "pre-season";
  return "unknown period";
}

function categoryLabel(category = ""): string {
  if (category === "opening-hand") return "Opening hand";
  if (category === "card-efficiency") return "Card role";
  if (category === "battlefield") return "Battlefield plan";
  if (category === "matchup") return "Matchup pattern";
  if (category === "curve") return "Early development";
  if (category === "positive") return "Strength";
  return "Learning focus";
}

function reflectionLabel(value: ReplayInsightReflection): string {
  if (value === "intentional") return "This was intentional";
  if (value === "missed") return "I missed this";
  if (value === "forced") return "I was forced into it";
  if (value === "already-understood") return "Already understood";
  if (value === "wrong") return "Capture is wrong";
  return "I'm not sure";
}

function statusLabel(status: ReplayCoachingFocus["status"]): string {
  if (status === "testing") return "Testing";
  if (status === "learned") return "Learned";
  if (status === "adjusted") return "Adjusting";
  if (status === "paused") return "Paused";
  if (status === "hypothesis") return "Plan ready";
  if (status === "reviewed") return "Reviewed";
  return "New";
}

function uniqueOptions(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function uniqueDeckOptions(matches: MatchDraft[]): Array<{ key: string; label: string }> {
  const options = new Map<string, string>();
  for (const match of matches) {
    const key = match.deckSourceKey || match.deckSourceId || match.deckName;
    if (key && !options.has(key)) options.set(key, match.deckName || key);
  }
  return [...options].map(([key, label]) => ({ key, label })).sort((left, right) => left.label.localeCompare(right.label));
}

function backgroundRawCandidates(replays: ReplayRecord[], selectedReplayId?: string): ReplayRecord[] {
  const candidates = replays
    .filter(replayNeedsRawInsightEnrichment)
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  const bounded = candidates.slice(0, MAX_BACKGROUND_RAW_REPLAYS);
  if (!selectedReplayId || bounded.some((replay) => replay.id === selectedReplayId)) return bounded;
  const selected = candidates.find((replay) => replay.id === selectedReplayId);
  return selected ? [...bounded.slice(0, MAX_BACKGROUND_RAW_REPLAYS - 1), selected] : bounded;
}

function resourceObservationText(unused: { energy: number | null; power: number | null; readyRunes: number | null }): string {
  const values = [
    unused.energy != null ? `${unused.energy} energy` : "",
    unused.power != null ? `${unused.power} power` : "",
    unused.readyRunes != null ? `${unused.readyRunes} ready rune${unused.readyRunes === 1 ? "" : "s"}` : ""
  ].filter(Boolean);
  return values.length ? `Ended with ${values.join(" · ")}` : "Resource values were not complete";
}

function knownCount(value: number | null): string {
  return value == null ? "unknown" : String(value);
}

function deckVersionReceipt(knownVersions: number, unknownGames: number): string {
  if (!knownVersions) return "deck version unknown";
  return `${knownVersions} known deck version${knownVersions === 1 ? "" : "s"}${unknownGames ? ` · ${unknownGames} game${unknownGames === 1 ? "" : "s"} unknown` : ""}`;
}

function matchTitle(replay: ReplayRecord | undefined, match: MatchDraft | undefined): string {
  if (match?.opponentChampion) return `${match.myChampion || "You"} vs ${match.opponentChampion}`;
  return replay?.title || "Captured replay";
}

function moveCoachTab(event: React.KeyboardEvent<HTMLButtonElement>, current: CoachTab, select: (tab: CoachTab) => void) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const currentIndex = COACH_TAB_ORDER.indexOf(current);
  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? COACH_TAB_ORDER.length - 1 : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + COACH_TAB_ORDER.length) % COACH_TAB_ORDER.length;
  const next = COACH_TAB_ORDER[nextIndex]!;
  select(next);
  window.requestAnimationFrame(() => document.getElementById(`coach-tab-${next}`)?.focus());
}

export const INSIGHTS_CURRENT_SEASON_BOUNDARY = MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON;
