import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  Eye,
  Film,
  Flag,
  Lightbulb,
  MapPinned,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  ThumbsUp,
  TrendingUp,
  X
} from "lucide-react";
import cardRegistryData from "../../resources/riftbound_card_registry.json";
import { buildMulliganLabRegistry } from "../shared/mulliganLab";
import {
  buildReplayInsights,
  replayInsightEventsFromRawPayload,
  type ReplayInsight,
  type ReplayInsightCardReport,
  type ReplayInsightFilters,
  type ReplayInsightGameStage,
  type ReplayInsightsStats
} from "../shared/replayInsights";
import type { MatchDraft, ReplayIntelligenceConfidence, ReplayRecord, ReplayStructuredEvent } from "../shared/types";

type InsightsTab = "briefing" | "match" | "patterns" | "cards";
const INSIGHT_TAB_ORDER: InsightsTab[] = ["briefing", "match", "patterns", "cards"];

interface InsightsViewProps {
  replays: ReplayRecord[];
  matches: MatchDraft[];
  onOpenReplay: (replayId: string, timeMs?: number, correctionEventId?: string) => void;
}

interface InsightFeedbackState {
  useful: string[];
  dismissed: string[];
}

const INSIGHT_FEEDBACK_STORAGE_KEY = "riftlite:replay-insight-feedback:v1";
const INSIGHT_CARD_REGISTRY = buildMulliganLabRegistry(cardRegistryData);
const INSIGHT_CARD_CATALOG = [...INSIGHT_CARD_REGISTRY.byCode.values()];

export function InsightsView({ replays, matches, onOpenReplay }: InsightsViewProps) {
  const [tab, setTab] = useState<InsightsTab>("briefing");
  const [rangeDays, setRangeDays] = useState(0);
  const [deckKey, setDeckKey] = useState("");
  const [playerLegend, setPlayerLegend] = useState("");
  const [opponentLegend, setOpponentLegend] = useState("");
  const [format, setFormat] = useState<"" | MatchDraft["format"]>("");
  const [gameStage, setGameStage] = useState<ReplayInsightGameStage>("all");
  const [wentFirst, setWentFirst] = useState<"" | "1st" | "2nd">("");
  const [minimumSample, setMinimumSample] = useState(3);
  const [selectedReplayId, setSelectedReplayId] = useState("");
  const [cardSearch, setCardSearch] = useState("");
  const [showDismissed, setShowDismissed] = useState(false);
  const [feedback, setFeedback] = useState<InsightFeedbackState>(() => readInsightFeedback());
  const [rawInsightEvents, setRawInsightEvents] = useState<Map<string, ReplayStructuredEvent[]>>(() => new Map());
  const [rawLoading, setRawLoading] = useState(false);
  const rawReplayKey = useMemo(
    () => replays.filter((replay) => replay.rawCapture && !replay.deletedAt).map((replay) => `${replay.id}:${replay.rawCapture?.localPath ?? ""}`).join("|"),
    [replays]
  );

  useEffect(() => {
    let cancelled = false;
    const candidates = replays.filter((replay) => replay.rawCapture && !replay.deletedAt);
    if (!candidates.length) {
      setRawInsightEvents(new Map());
      setRawLoading(false);
      return () => { cancelled = true; };
    }
    setRawLoading(true);
    void (async () => {
      const next = new Map<string, ReplayStructuredEvent[]>();
      let cursor = 0;
      async function worker() {
        while (!cancelled) {
          const index = cursor;
          cursor += 1;
          const replay = candidates[index];
          if (!replay) return;
          try {
            const payload = await window.riftlite.getRawCapturePayload(replay.id);
            if (!payload || cancelled) continue;
            const events = replayInsightEventsFromRawPayload(replay, payload);
            if (events.length) next.set(replay.id, events);
          } catch {
            // Older or partial captures remain eligible for the lower-confidence insight rules.
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, () => worker()));
      if (!cancelled) {
        setRawInsightEvents(next);
        setRawLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rawReplayKey]);

  useEffect(() => {
    window.localStorage.setItem(INSIGHT_FEEDBACK_STORAGE_KEY, JSON.stringify(feedback));
  }, [feedback]);

  const filters: ReplayInsightFilters = useMemo(() => ({
    rangeDays: rangeDays || undefined,
    deckKey: deckKey || undefined,
    playerLegend: playerLegend || undefined,
    opponentLegend: opponentLegend || undefined,
    format: format || undefined,
    gameStage,
    wentFirst: wentFirst || undefined
  }), [deckKey, format, gameStage, opponentLegend, playerLegend, rangeDays, wentFirst]);

  const report = useMemo(() => buildReplayInsights(replays, matches, {
    filters,
    cardCatalog: INSIGHT_CARD_CATALOG,
    enrichmentEventsByReplayId: rawInsightEvents,
    minimumPatternSample: minimumSample
  }), [filters, matches, minimumSample, rawInsightEvents, replays]);
  const matchById = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  const replayById = useMemo(() => new Map(replays.map((replay) => [replay.id, replay])), [replays]);
  const analyzedReplaySet = useMemo(() => new Set(report.analyzedReplayIds), [report.analyzedReplayIds]);
  const analyzedReplays = useMemo(
    () => replays.filter((replay) => analyzedReplaySet.has(replay.id)).sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt)),
    [analyzedReplaySet, replays]
  );
  const dismissed = useMemo(() => new Set(feedback.dismissed), [feedback.dismissed]);
  const useful = useMemo(() => new Set(feedback.useful), [feedback.useful]);
  const visibleInsights = useMemo(
    () => report.insights.filter((insight) => showDismissed || !dismissed.has(insight.id)),
    [dismissed, report.insights, showDismissed]
  );
  const briefing = useMemo(() => buildBriefing(visibleInsights), [visibleInsights]);
  const patterns = useMemo(() => visibleInsights.filter((insight) => insight.scope === "pattern"), [visibleInsights]);
  const matchInsights = useMemo(
    () => visibleInsights.filter((insight) => insight.scope === "match" && insight.replayId === selectedReplayId),
    [selectedReplayId, visibleInsights]
  );
  const cards = useMemo(() => {
    const needle = cardSearch.trim().toLowerCase();
    return report.cards.filter((card) => !needle || `${card.cardName} ${card.cardId ?? ""}`.toLowerCase().includes(needle));
  }, [cardSearch, report.cards]);

  useEffect(() => {
    if (!analyzedReplays.length) {
      setSelectedReplayId("");
      return;
    }
    if (!analyzedReplays.some((replay) => replay.id === selectedReplayId)) setSelectedReplayId(analyzedReplays[0].id);
  }, [analyzedReplays, selectedReplayId]);

  const playerLegendOptions = uniqueOptions(matches.map((match) => match.myChampion));
  const opponentLegendOptions = uniqueOptions(matches.map((match) => match.opponentChampion));
  const deckOptions = uniqueDeckOptions(matches);
  const activeFilterCount = [deckKey, playerLegend, opponentLegend, format, gameStage !== "all" ? gameStage : "", wentFirst].filter(Boolean).length + (rangeDays !== 0 ? 1 : 0);
  const limited = report.coverage.grade === "limited";

  function toggleUseful(insightId: string) {
    setFeedback((current) => ({
      ...current,
      useful: current.useful.includes(insightId)
        ? current.useful.filter((id) => id !== insightId)
        : [...current.useful, insightId]
    }));
  }

  function dismissInsight(insightId: string) {
    setFeedback((current) => ({
      useful: current.useful.filter((id) => id !== insightId),
      dismissed: current.dismissed.includes(insightId) ? current.dismissed : [...current.dismissed, insightId]
    }));
  }

  function restoreInsight(insightId: string) {
    setFeedback((current) => ({ ...current, dismissed: current.dismissed.filter((id) => id !== insightId) }));
  }

  function clearFilters() {
    setRangeDays(0);
    setDeckKey("");
    setPlayerLegend("");
    setOpponentLegend("");
    setFormat("");
    setGameStage("all");
    setWentFirst("");
  }

  return (
    <section className="dashboard-page insights-page">
      <section className="insights-hero">
        <div className="insights-hero-copy">
          <span className="insights-kicker"><Sparkles size={15} /> Local replay coach</span>
          <h2>Turn captured games into better decisions</h2>
          <p>RiftLite looks across your available local replay evidence, surfaces repeatable lessons, and keeps every claim tied to the moment that supports it.</p>
          <div className="insights-hero-status" data-grade={report.coverage.grade}>
            <Activity size={15} />
            <strong>{coverageLabel(report.coverage.grade)} evidence</strong>
            <span>{rawLoading ? "Enriching from retained Atlas captures..." : `${report.gamesAnalyzed} game${report.gamesAnalyzed === 1 ? "" : "s"} analyzed`}</span>
          </div>
        </div>
        <div className="insights-hero-metrics" aria-label="Insights coverage">
          <div><strong>{visibleInsights.length}</strong><span>live insights</span></div>
          <div><strong>{report.matchesAnalyzed}</strong><span>matches</span></div>
          <div><strong>{report.cards.length}</strong><span>tracked cards</span></div>
          <div><strong>{report.coverage.replaysWithStructuredEvents}/{report.replaysAnalyzed}</strong><span>rich captures</span></div>
        </div>
      </section>

      <section className="rail-card insights-filter-card">
        <header>
          <div><span>Coaching scope</span><strong>{activeFilterCount ? `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}` : "All matching evidence"}</strong></div>
          {activeFilterCount ? <button type="button" className="secondary compact" onClick={clearFilters}><RotateCcw size={13} /> Reset</button> : null}
        </header>
        <div className="insights-filters">
          <label>Period<select value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))}><option value={0}>All available data</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label>
          <label>Deck<select value={deckKey} onChange={(event) => setDeckKey(event.target.value)}><option value="">All decks</option>{deckOptions.map((deck) => <option value={deck.key} key={deck.key}>{deck.label}</option>)}</select></label>
          <label>Your Legend<select value={playerLegend} onChange={(event) => setPlayerLegend(event.target.value)}><option value="">All Legends</option>{playerLegendOptions.map((legend) => <option value={legend} key={legend}>{legend}</option>)}</select></label>
          <label>Opponent<select value={opponentLegend} onChange={(event) => setOpponentLegend(event.target.value)}><option value="">All opponents</option>{opponentLegendOptions.map((legend) => <option value={legend} key={legend}>{legend}</option>)}</select></label>
          <label>Format<select value={format} onChange={(event) => setFormat(event.target.value as "" | MatchDraft["format"])}><option value="">All formats</option><option value="Bo1">Best of 1</option><option value="Bo3">Best of 3</option><option value="Auto">Auto</option></select></label>
          <label>Game stage<select value={gameStage} onChange={(event) => setGameStage(event.target.value as ReplayInsightGameStage)}><option value="all">All games</option><option value="preboard">Game 1 / pre-board</option><option value="postboard">Post-sideboard</option></select></label>
          <label>Initiative<select value={wentFirst} onChange={(event) => setWentFirst(event.target.value as "" | "1st" | "2nd")}><option value="">Play or draw</option><option value="1st">Went first</option><option value="2nd">Went second</option></select></label>
          <label>Pattern gate<select value={minimumSample} onChange={(event) => setMinimumSample(Number(event.target.value))}><option value={3}>3+ games · early signal</option><option value={5}>5+ games · developing</option><option value={10}>10+ games · established</option></select></label>
        </div>
      </section>

      <nav className="insights-tabs" role="tablist" aria-label="Insight views">
        {([
          ["briefing", "Briefing", Lightbulb],
          ["match", "This Match", Film],
          ["patterns", "Pattern Explorer", BarChart3],
          ["cards", "Cards", Eye]
        ] as const).map(([value, label, Icon]) => (
          <button
            type="button"
            role="tab"
            id={`insights-tab-${value}`}
            aria-controls={`insights-panel-${value}`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            data-active={tab === value}
            onClick={() => setTab(value)}
            onKeyDown={(event) => moveInsightTab(event, value, setTab)}
            key={value}
          ><Icon size={16} /> {label}</button>
        ))}
        <label className="insights-dismissed-toggle"><input type="checkbox" checked={showDismissed} onChange={(event) => setShowDismissed(event.target.checked)} /> Show dismissed ({feedback.dismissed.length})</label>
      </nav>

      {limited ? (
        <aside className="insights-limited-note"><AlertTriangle size={17} /><div><strong>Early evidence</strong><span>RiftLite will make stronger pattern calls as more structured replays are captured. Current findings stay factual and visibly confidence-labelled.</span></div></aside>
      ) : null}

      {tab === "briefing" ? (
        <section className="insights-section" id="insights-panel-briefing" role="tabpanel" aria-labelledby="insights-tab-briefing">
          <header className="insights-section-heading"><div><span>Start here</span><h3>Your most actionable findings</h3></div><p>Ranked by repeatability, evidence quality and likely usefulness—not match result.</p></header>
          {briefing.length ? (
            <div className="insights-card-grid">
              {briefing.map((insight, index) => <InsightCard insight={insight} rank={index + 1} useful={useful.has(insight.id)} dismissed={dismissed.has(insight.id)} onUseful={toggleUseful} onDismiss={dismissInsight} onRestore={restoreInsight} onOpenReplay={onOpenReplay} key={insight.id} />)}
            </div>
          ) : <InsightsEmpty filtered={Boolean(activeFilterCount)} onReset={clearFilters} />}
        </section>
      ) : null}

      {tab === "match" ? (
        <section className="insights-match-layout" id="insights-panel-match" role="tabpanel" aria-labelledby="insights-tab-match">
          <aside className="rail-card insights-match-list">
            <header><div><span>Replay review</span><strong>{analyzedReplays.length} available</strong></div></header>
            <div>
              {analyzedReplays.map((replay) => {
                const match = matchById.get(replay.matchId) ?? replay.matchSnapshot;
                const count = visibleInsights.filter((insight) => insight.replayId === replay.id).length;
                return <button type="button" data-active={selectedReplayId === replay.id} onClick={() => setSelectedReplayId(replay.id)} key={replay.id}><span><strong>{matchTitle(replay, match)}</strong><small>{new Date(replay.capturedAt).toLocaleDateString()} · {match?.result ?? "Captured"}</small></span><b>{count}</b></button>;
              })}
            </div>
          </aside>
          <div className="insights-section">
            <header className="insights-section-heading"><div><span>Match findings</span><h3>{selectedReplayId ? matchTitle(replayById.get(selectedReplayId), matchById.get(replayById.get(selectedReplayId)?.matchId ?? "") ?? replayById.get(selectedReplayId)?.matchSnapshot) : "Select a replay"}</h3></div>{selectedReplayId ? <button type="button" className="secondary" onClick={() => onOpenReplay(selectedReplayId)}><Film size={14} /> Open full replay</button> : null}</header>
            {matchInsights.length ? <div className="insights-card-grid single-column">{matchInsights.map((insight) => <InsightCard insight={insight} useful={useful.has(insight.id)} dismissed={dismissed.has(insight.id)} onUseful={toggleUseful} onDismiss={dismissInsight} onRestore={restoreInsight} onOpenReplay={onOpenReplay} key={insight.id} />)}</div> : <InsightsEmpty match />}
          </div>
        </section>
      ) : null}

      {tab === "patterns" ? (
        <section className="insights-section" id="insights-panel-patterns" role="tabpanel" aria-labelledby="insights-tab-patterns">
          <header className="insights-section-heading"><div><span>Across your games</span><h3>Pattern Explorer</h3></div><p>Every percentage uses the current filters. Outcome rows are correlations, include raw samples, and never imply that one play caused the result.</p></header>
          <PatternExplorer stats={report.stats} minimumSample={minimumSample} cardSearch={cardSearch} onCardSearch={setCardSearch} onOpenReplay={onOpenReplay} />
          <header className="insights-section-heading insights-coaching-calls"><div><span>Coaching calls</span><h3>Recurring decisions worth reviewing</h3></div><p>Only coaching cohorts meeting the selected sample gate are shown.</p></header>
          {patterns.length ? <div className="insights-card-grid">{patterns.map((insight) => <InsightCard insight={insight} useful={useful.has(insight.id)} dismissed={dismissed.has(insight.id)} onUseful={toggleUseful} onDismiss={dismissInsight} onRestore={restoreInsight} onOpenReplay={onOpenReplay} key={insight.id} />)}</div> : <InsightsEmpty patterns />}
        </section>
      ) : null}

      {tab === "cards" ? (
        <section className="insights-section" id="insights-panel-cards" role="tabpanel" aria-labelledby="insights-tab-cards">
          <header className="insights-section-heading"><div><span>Card reports</span><h3>What happens after cards become visible</h3></div><label className="insights-card-search"><Search size={14} /><input value={cardSearch} onChange={(event) => setCardSearch(event.target.value)} placeholder="Search cards..." /></label></header>
          {cards.length ? <div className="insights-card-report-grid">{cards.map((card) => <InsightCardReport card={card} onOpenReplay={onOpenReplay} key={card.key} />)}</div> : <InsightsEmpty cards />}
        </section>
      ) : null}

      <footer className="insights-trust-footer">
        <Check size={15} /><span>Analysis runs locally. “Playable” and alternative-line claims are withheld unless the capture proves the required resources and rules context. No Firebase reads are added.</span>
      </footer>
    </section>
  );
}

export function PatternExplorer({
  stats,
  minimumSample,
  cardSearch,
  onCardSearch,
  onOpenReplay
}: {
  stats: ReplayInsightsStats;
  minimumSample: number;
  cardSearch: string;
  onCardSearch: (value: string) => void;
  onOpenReplay: (replayId: string, timeMs?: number) => void;
}) {
  const needle = cardSearch.trim().toLowerCase();
  const sourceRows = stats.cardSourceZones.filter((row) => !needle || `${row.cardName} ${row.cardId ?? ""}`.toLowerCase().includes(needle));
  const timingRows = stats.cardTurnOutcomes.filter((row) => (
    row.games >= minimumSample
    && (!needle || `${row.cardName} ${row.cardId ?? ""}`.toLowerCase().includes(needle))
  ));
  const usualBattlefields = stats.battlefieldPositionChoices.filter((row) => row.isMostCommon);
  return (
    <div className="insights-pattern-explorer">
      <section className="insights-pattern-scoreboard" aria-label="Current statistical scope">
        <StatMetric label="Completed games" value={String(stats.completedGames)} detail={`${stats.wins}W · ${stats.losses}L${stats.draws ? ` · ${stats.draws}D` : ""}`} />
        <StatMetric label="Scope win rate" value={`${formatReplayStat(stats.baselineWinRate)}%`} detail="Context for descriptive outcome comparisons" />
        <StatMetric label="Known play origins" value={`${formatReplayStat(stats.sourceCoveragePercent)}%`} detail={`${stats.knownSourcePlays} of ${stats.capturedLocalPlays} local plays`} />
        <StatMetric label="Timing cohorts" value={String(stats.reliableTimingCohorts)} detail={`Meeting the selected ${minimumSample}+ game gate`} />
      </section>

      <div className="insights-pattern-grid">
        <article className="rail-card insights-stat-panel insights-battlefield-panel">
          <header><span><MapPinned size={16} /></span><div><strong>Battlefield selection order</strong><small>Your usual choice at each game position, plus captured match sequences—not a community estimate.</small></div></header>
          {usualBattlefields.length ? <ol className="insights-position-picks" aria-label="Most common battlefield choice at each game position">
            {usualBattlefields.map((row) => <li key={row.key}>
              <b className="insights-pick-rank">{row.gameNumber}</b>
              <span><small>Game {row.gameNumber}{row.isTiedForMostCommon ? " · tied most common" : " · usual choice"}</small><strong>{row.battlefieldName}</strong></span>
              <span><strong>{formatReplayStat(row.percentage)}%</strong><small>{row.games} of {row.totalAtPosition} picks · {formatReplayStat(row.winRate)}% game win rate</small></span>
            </li>)}
          </ol> : null}
          {stats.battlefieldPickOrders.length ? (
            <div className="insights-pick-orders">
              {stats.battlefieldPickOrders.map((order, rowIndex) => {
                const evidence = order.evidence[0];
                return (
                  <section className="insights-pick-order-row" data-primary={rowIndex === 0 || undefined} key={order.key}>
                    <div className="insights-pick-order-summary"><span>{rowIndex === 0 ? "Most common in this scope" : "Alternative sequence"}</span><strong>{formatReplayStat(order.percentage)}%</strong><small>{order.games} captured match set{order.games === 1 ? "" : "s"}{typeof order.winRate === "number" ? ` · ${formatReplayStat(order.winRate)}% match win rate` : ""}</small></div>
                    <ol className="insights-pick-order">
                      {order.sequence.map((battlefield, index) => <li key={`${battlefield}:${index}`}><b className="insights-pick-rank">{index + 1}</b><span><small>Game {index + 1}</small><strong>{battlefield}</strong></span></li>)}
                    </ol>
                    {evidence ? <button type="button" className="secondary compact" onClick={() => onOpenReplay(evidence.replayId, evidence.videoTimeMs)}><Film size={13} /> Review sequence</button> : null}
                  </section>
                );
              })}
            </div>
          ) : usualBattlefields.length
            ? <div className="insights-stat-inline-note">Complete Game 1 → Game 2 sequences appear after a multi-game match set is captured.</div>
            : <StatEmpty title="No ordered battlefield set yet" body="This appears once per-game battlefield selections have been recorded. RiftLite will not infer an order from a single top-level label." />}
        </article>

        <article className="rail-card insights-stat-panel insights-split-panel">
          <header><span><Flag size={16} /></span><div><strong>Other useful outcome cuts</strong><small>Initiative and sideboarding splits from the same filtered completed games.</small></div></header>
          {stats.outcomeSplits.length ? <div className="insights-outcome-splits">
            {stats.outcomeSplits.map((row) => <div key={row.key}>
              <span><small>{row.basis === "initiative" ? "Initiative" : "Game stage"}</small><strong>{row.label}</strong></span>
              <span><strong>{formatReplayStat(row.winRate)}%</strong><small>{row.wins}W–{row.losses}L{row.draws ? `–${row.draws}D` : ""} · n={row.games}</small></span>
              <b className="insights-stat-delta" data-direction={statDeltaDirection(row.deltaPercentagePoints)}>{statDeltaLabel(row.deltaPercentagePoints)}</b>
              <em data-state={row.sampleState}>{statSampleLabel(row.sampleState)}</em>
            </div>)}
          </div> : <StatEmpty title="No completed cohorts yet" body="Saved game results plus initiative or game number are needed for these comparisons." />}
        </article>

        <article className="rail-card insights-stat-panel wide insights-origin-panel">
          <header><span><Eye size={16} /></span><div><strong>Played from hand versus hidden</strong><small>Unknown sources remain separate so the hand and hidden percentages never look more certain than the capture.</small></div><label className="insights-card-search"><Search size={14} /><input value={cardSearch} onChange={(event) => onCardSearch(event.target.value)} placeholder="Filter card stats..." /></label></header>
          {sourceRows.length ? <div className="insights-origin-list">
            {sourceRows.map((row) => {
              const evidence = row.evidence[0];
              return <section className="insights-origin-row" key={row.key}>
                <StatCardIdentity cardName={row.cardName} cardId={row.cardId} imageUrl={row.imageUrl} />
                <div className="insights-origin-chart">
                  <div
                    className="insights-origin-bar"
                    role="img"
                    aria-label={`${row.cardName}: ${row.hand} of ${row.totalPlays} plays from hand, ${row.hidden} hidden, ${row.trash} trash, ${row.deck} deck, ${row.other} other and ${row.unknown} unknown`}
                  >
                    <i data-source="hand" style={{ width: `${row.handPercent}%` }} />
                    <i data-source="hidden" style={{ width: `${row.hiddenPercent}%` }} />
                    <i data-source="trash" style={{ width: `${row.trashPercent}%` }} />
                    <i data-source="deck" style={{ width: `${row.deckPercent}%` }} />
                    <i data-source="other" style={{ width: `${row.otherPercent}%` }} />
                    <i data-source="unknown" style={{ width: `${row.unknownPercent}%` }} />
                  </div>
                  <div className="insights-origin-legend">
                    <span data-source="hand"><i />Hand <strong>{formatReplayStat(row.handPercent)}%</strong> <small>({row.hand})</small></span>
                    <span data-source="hidden"><i />Hidden <strong>{formatReplayStat(row.hiddenPercent)}%</strong> <small>({row.hidden})</small></span>
                    <span data-source="trash"><i />Trash <strong>{formatReplayStat(row.trashPercent)}%</strong> <small>({row.trash})</small></span>
                    <span data-source="deck"><i />Deck <strong>{formatReplayStat(row.deckPercent)}%</strong> <small>({row.deck})</small></span>
                    <span data-source="other"><i />Other <strong>{formatReplayStat(row.otherPercent)}%</strong> <small>({row.other})</small></span>
                    <span data-source="unknown"><i />Unknown <strong>{formatReplayStat(row.unknownPercent)}%</strong> <small>({row.unknown})</small></span>
                  </div>
                  <div className="insights-turn-window"><span>On your turn <strong>{row.onTurn}</strong></span><span>Off-turn <strong>{row.offTurn}</strong></span>{row.unknownTurn ? <span>Turn unknown <strong>{row.unknownTurn}</strong></span> : null}</div>
                </div>
                <strong className="insights-origin-total">n={row.totalPlays}</strong>
                {evidence ? <button type="button" className="secondary compact" onClick={() => onOpenReplay(evidence.replayId, evidence.videoTimeMs)} aria-label={`Review ${row.cardName} play evidence`}><Film size={13} /> Evidence</button> : null}
              </section>;
            })}
          </div> : <StatEmpty title={needle ? "No card matches this search" : "No local play origins captured yet"} body={needle ? "Clear the card filter to restore every tracked card." : "Named local play events will populate hand, hidden, other and unknown source buckets."} />}
        </article>

        <article className="rail-card insights-stat-panel wide insights-timing-panel">
          <header><span><TrendingUp size={16} /></span><div><strong>Card timing versus outcome</strong><small>Each game contributes once per card. Its comparison group includes only games where that card was known or visible by the same player turn.</small></div></header>
          {timingRows.length ? <div className="insights-outcome-table-wrap">
            <table className="insights-outcome-table">
              <caption>Observed correlations. Each row compares against eligible games where the card was known or visible by that same player turn; this does not establish causation.</caption>
              <thead><tr><th scope="col">Card and timing</th><th scope="col">Record</th><th scope="col">Observed win rate</th><th scope="col">Eligible baseline</th><th scope="col">Difference</th><th scope="col">Sample</th><th scope="col">Evidence</th></tr></thead>
              <tbody>{timingRows.map((row) => {
                const evidence = row.evidence[0];
                return <tr key={row.key}>
                  <th scope="row"><StatCardIdentity cardName={row.cardName} cardId={row.cardId} imageUrl={row.imageUrl} compact /><small>First played on your turn {row.playerTurnNumber}</small></th>
                  <td>{row.wins}W–{row.losses}L{row.draws ? `–${row.draws}D` : ""}</td>
                  <td><strong>{formatReplayStat(row.winRate)}%</strong></td>
                  <td>{formatReplayStat(row.baselineWinRate)}% <small>n={row.baselineGames}</small></td>
                  <td><b className="insights-stat-delta" data-direction={statDeltaDirection(row.deltaPercentagePoints)}>{statDeltaLabel(row.deltaPercentagePoints)}</b><small>{row.correlationLabel}</small></td>
                  <td><span className="insights-stat-sample" data-state={row.sampleState}>{statSampleLabel(row.sampleState)} · n={row.games}</span></td>
                  <td>{evidence ? <button type="button" className="secondary compact" onClick={() => onOpenReplay(evidence.replayId, evidence.videoTimeMs)}><Play size={13} /> Review</button> : "—"}</td>
                </tr>;
              })}</tbody>
            </table>
          </div> : <StatEmpty title={needle ? "No timing cohort matches" : `No card timing cohort meets ${minimumSample} games yet`} body={needle ? "Try another card or clear the filter." : "Lower the pattern gate for an earlier signal, or capture more games. Small samples remain in the model but are not promoted as a pattern."} />}
        </article>
      </div>
    </div>
  );
}

function StatMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function StatCardIdentity({ cardName, cardId, imageUrl, compact = false }: { cardName: string; cardId?: string; imageUrl?: string; compact?: boolean }) {
  return <span className="insights-stat-card" data-compact={compact || undefined}><span className="insight-card-art" tabIndex={imageUrl ? 0 : undefined}>{imageUrl ? <img src={imageUrl} alt={cardName} loading="lazy" /> : <strong>{cardName.slice(0, 2).toUpperCase()}</strong>}{imageUrl ? <span><img src={imageUrl} alt={`${cardName} enlarged`} /></span> : null}</span><span><strong>{cardName}</strong><small>{cardId || "Known card"}</small></span></span>;
}

function StatEmpty({ title, body }: { title: string; body: string }) {
  return <div className="insights-stat-empty"><BarChart3 size={21} /><strong>{title}</strong><span>{body}</span></div>;
}

function moveInsightTab(
  event: React.KeyboardEvent<HTMLButtonElement>,
  current: InsightsTab,
  select: (tab: InsightsTab) => void
) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const currentIndex = INSIGHT_TAB_ORDER.indexOf(current);
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? INSIGHT_TAB_ORDER.length - 1
      : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + INSIGHT_TAB_ORDER.length) % INSIGHT_TAB_ORDER.length;
  const next = INSIGHT_TAB_ORDER[nextIndex]!;
  select(next);
  window.requestAnimationFrame(() => document.getElementById(`insights-tab-${next}`)?.focus());
}

function formatReplayStat(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function statDeltaDirection(value: number): "above" | "below" | "even" {
  return value > 0 ? "above" : value < 0 ? "below" : "even";
}

function statDeltaLabel(value: number): string {
  if (!value) return "At baseline";
  return `${Math.abs(value).toFixed(Number.isInteger(value) ? 0 : 1)}pp ${value > 0 ? "above" : "below"}`;
}

function statSampleLabel(state: "insufficient" | "early" | "established"): string {
  if (state === "established") return "Reasonably stable";
  if (state === "early") return "Developing";
  return "Exploratory";
}

function InsightCard({
  insight,
  rank,
  useful,
  dismissed,
  onUseful,
  onDismiss,
  onRestore,
  onOpenReplay
}: {
  insight: ReplayInsight;
  rank?: number;
  useful: boolean;
  dismissed: boolean;
  onUseful: (id: string) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  onOpenReplay: (replayId: string, timeMs?: number, correctionEventId?: string) => void;
}) {
  const primaryEvidence = insight.evidence.find((evidence) => typeof evidence.videoTimeMs === "number") ?? insight.evidence[0];
  return (
    <article className="insight-card" data-tone={insight.tone} data-dismissed={dismissed || undefined}>
      <header>
        <span className="insight-card-icon">{insight.tone === "positive" ? <Check size={17} /> : insight.tone === "opportunity" ? <Lightbulb size={17} /> : <Eye size={17} />}</span>
        <div><span>{rank ? `Focus ${rank} · ` : ""}{categoryLabel(insight.category)}</span><strong>{insight.title}</strong></div>
        <span className="insight-confidence" data-confidence={insight.confidence}>{confidenceLabel(insight.confidence)}</span>
      </header>
      <p>{insight.body}</p>
      <aside><Sparkles size={14} /><span><strong>Try next:</strong> {insight.action}</span></aside>
      <div className="insight-card-meta"><span>{insight.scope === "pattern" ? `${insight.sampleSize} eligible games` : `Game ${insight.gameNumber ?? 1}`}</span>{insight.opponentLegend ? <span>vs {insight.opponentLegend}</span> : null}<span>{insight.evidence.length} evidence point{insight.evidence.length === 1 ? "" : "s"}</span></div>
      <details className="insight-evidence">
        <summary><Activity size={13} /> Show evidence</summary>
        <div>
          {insight.evidence.map((evidence, index) => (
            <button type="button" onClick={() => onOpenReplay(evidence.replayId, evidence.videoTimeMs)} key={`${evidence.replayId}:${evidence.eventId ?? "evidence"}:${index}`}>
              <span>{evidence.label}</span><small>{new Date(evidence.capturedAt).toLocaleString()} · {confidenceLabel(evidence.confidence)}</small>{typeof evidence.videoTimeMs === "number" ? <Play size={12} /> : <Film size={12} />}
            </button>
          ))}
        </div>
      </details>
      <footer>
        {dismissed ? <button type="button" className="secondary compact" onClick={() => onRestore(insight.id)}><RotateCcw size={13} /> Restore</button> : <><button type="button" className={`secondary compact${useful ? " active" : ""}`} onClick={() => onUseful(insight.id)}><ThumbsUp size={13} /> {useful ? "Useful" : "Mark useful"}</button><button type="button" className="secondary compact" onClick={() => onDismiss(insight.id)}><X size={13} /> Dismiss</button></>}
        {primaryEvidence ? <button type="button" className="primary compact" onClick={() => onOpenReplay(primaryEvidence.replayId, primaryEvidence.videoTimeMs)}>{typeof primaryEvidence.videoTimeMs === "number" ? <><Play size={13} /> Watch moment</> : <><Film size={13} /> Review replay</>}</button> : null}
        {primaryEvidence ? <button type="button" className="secondary compact" onClick={() => onOpenReplay(primaryEvidence.replayId, primaryEvidence.videoTimeMs, primaryEvidence.eventId)} title="Open the retained evidence and correction tools">Correct evidence</button> : null}
      </footer>
    </article>
  );
}

export function InsightCardReport({ card, onOpenReplay }: { card: ReplayInsightCardReport; onOpenReplay: (replayId: string) => void }) {
  const playRate = card.appearances ? Math.round(card.played / card.appearances * 100) : 0;
  return (
    <article className="insight-card-report">
      <header>
        <span className="insight-card-art">{card.imageUrl ? <img src={card.imageUrl} alt={card.cardName} loading="lazy" /> : <strong>{card.cardName.slice(0, 2).toUpperCase()}</strong>}{card.imageUrl ? <span><img src={card.imageUrl} alt={`${card.cardName} enlarged`} /></span> : null}</span>
        <div><strong>{card.cardName}</strong><span>{card.cardId || "Known card"} · {confidenceLabel(card.confidence)}</span></div>
      </header>
      <div className="insight-card-report-stats">
        <span><strong>{card.appearances}</strong><small>games seen</small></span>
        <span><strong>{playRate}%</strong><small>captured play</small></span>
        <span><strong>{card.kept}</strong><small>opening keeps</small></span>
        <span><strong>{card.lateKeeps}</strong><small>late keeps</small></span>
      </div>
      <div className="insight-card-report-bar"><i style={{ width: `${playRate}%` }} /></div>
      <p>{card.recycledOrDiscarded ? `${card.recycledOrDiscarded} recycled or discarded. ` : ""}{card.averageKnownHandTimeMs ? `Average known hand time ${formatDuration(card.averageKnownHandTimeMs)}.` : "More measured hand journeys will improve this report."}</p>
      {card.replayIds[0] ? <button type="button" className="secondary compact" onClick={() => onOpenReplay(card.replayIds[0])}><Film size={13} /> Open recent evidence</button> : null}
    </article>
  );
}

function InsightsEmpty({ filtered = false, match = false, patterns = false, cards = false, onReset }: { filtered?: boolean; match?: boolean; patterns?: boolean; cards?: boolean; onReset?: () => void }) {
  const title = match ? "No actionable findings for this match" : patterns ? "No recurring pattern meets the gate yet" : cards ? "No named card journeys match" : "No insights match this scope";
  const body = match
    ? "The replay may have limited structured evidence, or its captured choices did not trigger a factual coaching rule."
    : patterns
      ? "Lower the pattern gate or capture more games in this matchup. RiftLite will not manufacture a trend from one replay."
      : cards
        ? "Card reports appear when the capture exposes named cards entering or leaving known zones."
        : filtered
          ? "Reset the filters to bring all locally available replay evidence back into the analysis."
          : "Record games with structured capture enabled and RiftLite will build this briefing automatically.";
  return <div className="insights-empty"><Lightbulb size={26} /><strong>{title}</strong><span>{body}</span>{filtered && onReset ? <button type="button" className="secondary" onClick={onReset}>Reset filters</button> : null}</div>;
}

function buildBriefing(insights: ReplayInsight[]): ReplayInsight[] {
  const ranked = insights.filter((insight) => insight.tone !== "positive").slice(0, 5);
  const positive = insights.find((insight) => insight.tone === "positive");
  return positive && ranked.length < 6 ? [...ranked, positive] : ranked.slice(0, 6);
}

function readInsightFeedback(): InsightFeedbackState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INSIGHT_FEEDBACK_STORAGE_KEY) ?? "{}") as Partial<InsightFeedbackState>;
    return {
      useful: Array.isArray(parsed.useful) ? parsed.useful.filter((id): id is string => typeof id === "string").slice(-500) : [],
      dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed.filter((id): id is string => typeof id === "string").slice(-500) : []
    };
  } catch {
    return { useful: [], dismissed: [] };
  }
}

function uniqueOptions(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function uniqueDeckOptions(matches: MatchDraft[]): Array<{ key: string; label: string }> {
  const found = new Map<string, string>();
  for (const match of matches) {
    const key = match.deckSourceId || match.deckSourceKey || match.deckName;
    if (key && !found.has(key)) found.set(key, match.deckName || "Saved deck");
  }
  return [...found.entries()].map(([key, label]) => ({ key, label })).sort((left, right) => left.label.localeCompare(right.label));
}

function matchTitle(replay: ReplayRecord | undefined, match: MatchDraft | undefined): string {
  if (match?.myChampion || match?.opponentChampion) return `${match.myChampion || "You"} vs ${match.opponentChampion || "Opponent"}`;
  return replay?.title || "Captured match";
}

function categoryLabel(category: ReplayInsight["category"]): string {
  if (category === "opening-hand") return "Opening hand";
  if (category === "card-efficiency") return "Card efficiency";
  if (category === "battlefield") return "Battlefield plan";
  if (category === "matchup") return "Matchup pattern";
  if (category === "positive") return "What worked";
  return "Curve";
}

function confidenceLabel(confidence: ReplayIntelligenceConfidence): string {
  if (confidence === "confirmed") return "Confirmed";
  if (confidence === "reconstructed") return "Reconstructed";
  if (confidence === "manual") return "Manual";
  return "Inferred";
}

function coverageLabel(grade: "high" | "medium" | "limited"): string {
  return grade === "high" ? "Strong" : grade === "medium" ? "Developing" : "Limited";
}

function formatDuration(valueMs: number): string {
  const seconds = Math.max(0, Math.round(valueMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
}
