import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  Database,
  Eye,
  Filter,
  Flame,
  Gamepad2,
  Layers3,
  LineChart,
  Search,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy
} from "lucide-react";
import {
  buildDeckInsightComposition,
  buildDeckInsightCardReviewSignal,
  buildDeckInsightPerformance,
  deckInsightCardEligibility,
  deckInsightCardIdentityKeys,
  type DeckInsightCard,
  type DeckInsightCardEligibility,
  type DeckInsightCardReviewSignal,
  type DeckInsightComposition,
  type DeckInsightFormPoint,
  type DeckInsightRecordSlice
} from "../shared/deckInsights";
import { deckMatchesFor } from "../shared/deckPerformance";
import { deckSnapshotHash } from "../shared/deckNotebook";
import { chanceAtLeastOne } from "../shared/deckTracker";
import { legendImageUrl } from "../shared/legendImages";
import { normalizeLegendName } from "../shared/legendNames";
import { localMatchesEligibleForStats } from "../shared/matchList";
import { MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON } from "../shared/mulliganLab";
import {
  buildReplayInsights,
  replayInsightEventsFromRawPayload,
  type ReplayInsightCardReport,
  type ReplayInsightCardSourceZones,
  type ReplayInsightCardTurnOutcome,
  type ReplayInsightGameStage,
  type ReplayInsightsReport
} from "../shared/replayInsights";
import type { ActiveView } from "../shared/navigationModel";
import type { MatchDraft, ReplayRecord, ReplayStructuredEvent, SavedDeck } from "../shared/types";
import {
  cacheInsightAnalysisEventsBatch,
  createInsightAnalysisReplayFingerprint,
  loadInsightAnalysisCache,
  lookupInsightAnalysisEventsBatch,
  mapWithConcurrency,
  persistInsightAnalysisCache,
  replayNeedsRawInsightEnrichment
} from "./insightAnalysisCache";
import { INSIGHT_CARD_CATALOG } from "./insightCardCatalog";

const DECK_INSIGHT_CATALOG = INSIGHT_CARD_CATALOG;
const DECK_RAW_ANALYSIS_CONCURRENCY = 2;
const DECK_RAW_ANALYSIS_BATCH = 64;
const TYPE_COLORS = ["#69e5d1", "#a98bf5", "#f3c567", "#67aaf9", "#ee8f89", "#7ed38d", "#d98fc5"];

interface DeckInsightsClipboardBridge {
  writeClipboardText(text: string): Promise<boolean>;
}

export async function copyDeckInsightSummary(
  text: string,
  bridge?: DeckInsightsClipboardBridge
): Promise<boolean> {
  try {
    return bridge ? await bridge.writeClipboardText(text) : false;
  } catch {
    return false;
  }
}

type DeckCardSort = "review" | "reach" | "curve" | "copies" | "name";
type DeckPeriod = "all" | "preseason" | "current-season";
type DeckVersionScope = "all" | "current";
type DeckInsightsSection = "overview" | "cards" | "matchups";

export function effectiveDeckInsightGameStage(
  section: DeckInsightsSection,
  selectedStage: ReplayInsightGameStage,
  hasCombinedEvidence: boolean
): ReplayInsightGameStage {
  return section === "cards" && !hasCombinedEvidence ? selectedStage : "all";
}

interface DeckInsightsViewProps {
  decks: SavedDeck[];
  matches: MatchDraft[];
  replays: ReplayRecord[];
  activeDeckId: string;
  onNavigate: (view: ActiveView) => void;
  onOpenReplay: (replayId: string, timeMs?: number, correctionEventId?: string) => void;
}

interface DeckCardUsageRow {
  card: DeckInsightCard;
  report?: ReplayInsightCardReport;
  eligibility: DeckInsightCardEligibility;
  review: DeckInsightCardReviewSignal;
  source?: ReplayInsightCardSourceZones;
  capturedPlayGames: number;
  gameStage: ReplayInsightGameStage;
  trustGameStage: boolean;
}

export function DeckInsightsView({
  decks,
  matches,
  replays,
  activeDeckId,
  onNavigate,
  onOpenReplay
}: DeckInsightsViewProps) {
  const [deckId, setDeckId] = useState(() => activeDeckId || decks[0]?.id || "");
  const [rangeDays, setRangeDays] = useState(0);
  const [period, setPeriod] = useState<DeckPeriod>("all");
  const [versionScope, setVersionScope] = useState<DeckVersionScope>("all");
  const [section, setSection] = useState<DeckInsightsSection>("overview");
  const [opponentLegend, setOpponentLegend] = useState("");
  const [gameStage, setGameStage] = useState<ReplayInsightGameStage>("all");
  const [cardSearch, setCardSearch] = useState("");
  const [cardSort, setCardSort] = useState<DeckCardSort>("review");
  const [selectedCardKey, setSelectedCardKey] = useState("");
  const [rawInsightEvents, setRawInsightEvents] = useState<Map<string, ReplayStructuredEvent[]>>(() => new Map());
  const rawInsightEventsRef = useRef(rawInsightEvents);
  const [rawLoading, setRawLoading] = useState(false);
  const [rawAnalysisPass, setRawAnalysisPass] = useState(0);
  const [rawExcludedCount, setRawExcludedCount] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    if (decks.some((deck) => deck.id === deckId)) return;
    setDeckId(activeDeckId && decks.some((deck) => deck.id === activeDeckId) ? activeDeckId : decks[0]?.id || "");
  }, [activeDeckId, deckId, decks]);

  const deck = decks.find((item) => item.id === deckId) ?? null;
  const allDeckMatches = useMemo(() => deck ? deckMatchesFor(deck, matches) : [], [deck, matches]);
  const currentSnapshotHash = useMemo(() => deckSnapshotHash(deck?.snapshotJson ?? ""), [deck?.snapshotJson]);
  const linkedVersionHashes = useMemo(() => uniqueValues(allDeckMatches.map((match) => deckSnapshotHash(match.deckSnapshotJson ?? ""))), [allDeckMatches]);
  const versionScopedMatches = useMemo(
    () => versionScope === "current"
      ? allDeckMatches.filter((match) => currentSnapshotHash && deckSnapshotHash(match.deckSnapshotJson ?? "") === currentSnapshotHash)
      : allDeckMatches,
    [allDeckMatches, currentSnapshotHash, versionScope]
  );
  const timeScopedMatches = useMemo(
    () => filterDeckInsightMatches(versionScopedMatches, rangeDays, period),
    [period, rangeDays, versionScopedMatches]
  );
  const matchupOptions = useMemo(() => uniqueValues(timeScopedMatches.map((match) => normalizeLegendName(match.opponentChampion))), [timeScopedMatches]);
  const scopedMatches = useMemo(
    () => opponentLegend
      ? timeScopedMatches.filter((match) => normalizeLegendName(match.opponentChampion) === normalizeLegendName(opponentLegend))
      : timeScopedMatches,
    [opponentLegend, timeScopedMatches]
  );
  const eligibleScopedMatches = useMemo(() => localMatchesEligibleForStats(scopedMatches), [scopedMatches]);
  const scopedVersionHashes = useMemo(() => uniqueValues(eligibleScopedMatches.map((match) => deckSnapshotHash(match.deckSnapshotJson ?? ""))), [eligibleScopedMatches]);
  const scopedMatchIds = useMemo(() => new Set(eligibleScopedMatches.flatMap((match) => [match.id, ...(match.combinedFromMatchIds ?? [])])), [eligibleScopedMatches]);
  const hasCombinedEvidence = useMemo(
    () => eligibleScopedMatches.some((match) => (match.combinedFromMatchIds?.length ?? 0) > 0),
    [eligibleScopedMatches]
  );
  const effectiveGameStage = effectiveDeckInsightGameStage(section, gameStage, hasCombinedEvidence);
  const scopedReportMatches = useMemo(() => matches.filter((match) => scopedMatchIds.has(match.id)), [matches, scopedMatchIds]);
  const scopedReplays = useMemo(
    () => replays.filter((replay) => !replay.deletedAt && scopedMatchIds.has(replay.matchId)),
    [replays, scopedMatchIds]
  );
  const rawEligibleReplays = useMemo(
    () => scopedReplays
      .filter(replayNeedsRawInsightEnrichment)
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt)),
    [scopedReplays]
  );
  const rawReplayKey = useMemo(
    () => `${rawAnalysisPass}|${rawEligibleReplays.map((replay) => `${replay.id}:${createInsightAnalysisReplayFingerprint(replay)}`).join("|")}`,
    [rawAnalysisPass, rawEligibleReplays]
  );

  useEffect(() => {
    let cancelled = false;
    if (section !== "cards") {
      setRawLoading(false);
      return () => { cancelled = true; };
    }
    if (!rawEligibleReplays.length) {
      const empty = new Map<string, ReplayStructuredEvent[]>();
      rawInsightEventsRef.current = empty;
      setRawInsightEvents(empty);
      setRawLoading(false);
      setRawExcludedCount(0);
      return () => { cancelled = true; };
    }
    void (async () => {
      let cache = loadInsightAnalysisCache(window.localStorage);
      const next = new Map<string, ReplayStructuredEvent[]>();
      const misses: ReplayRecord[] = [];
      const lookup = lookupInsightAnalysisEventsBatch(cache, rawEligibleReplays);
      cache = lookup.cache;
      for (let index = 0; index < rawEligibleReplays.length; index += 1) {
        const replay = rawEligibleReplays[index]!;
        const result = lookup.results[index];
        if (result?.hit) {
          if (result.events?.length) next.set(replay.id, result.events);
        } else if (rawInsightEventsRef.current.has(replay.id)) {
          next.set(replay.id, rawInsightEventsRef.current.get(replay.id)!);
        } else {
          misses.push(replay);
        }
      }
      const batch = misses.slice(0, DECK_RAW_ANALYSIS_BATCH);
      if (!cancelled) {
        const snapshot = new Map(next);
        rawInsightEventsRef.current = snapshot;
        setRawInsightEvents(snapshot);
        setRawExcludedCount(Math.max(0, misses.length - batch.length));
      }
      if (!misses.length) {
        persistInsightAnalysisCache(window.localStorage, cache);
        if (!cancelled) setRawLoading(false);
        return;
      }
      if (!cancelled) setRawLoading(true);
      const derived = await mapWithConcurrency(batch, DECK_RAW_ANALYSIS_CONCURRENCY, async (replay) => {
        try {
          const payload = await window.riftlite.getRawCapturePayload(replay.id);
          return { replay, events: payload ? replayInsightEventsFromRawPayload(replay, payload) : [] };
        } catch {
          return { replay, events: [] as ReplayStructuredEvent[] };
        }
      });
      cache = cacheInsightAnalysisEventsBatch(cache, derived.map((item) => ({ replay: item.replay, events: item.events }))).cache;
      for (const item of derived) if (item.events.length) next.set(item.replay.id, item.events);
      persistInsightAnalysisCache(window.localStorage, cache);
      if (!cancelled) {
        const snapshot = new Map(next);
        rawInsightEventsRef.current = snapshot;
        setRawInsightEvents(snapshot);
        setRawLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rawReplayKey, section]);

  const composition = useMemo(
    () => deck ? buildDeckInsightComposition(deck, DECK_INSIGHT_CATALOG) : null,
    [deck]
  );
  const performance = useMemo(
    () => deck ? buildDeckInsightPerformance(deck, scopedMatches) : null,
    [deck, scopedMatches]
  );
  const matchupPerformance = useMemo(
    () => deck ? buildDeckInsightPerformance(deck, timeScopedMatches) : null,
    [deck, timeScopedMatches]
  );
  const report = useMemo<ReplayInsightsReport | null>(() => deck ? buildReplayInsights(scopedReplays, scopedReportMatches, {
    filters: { gameStage: effectiveGameStage },
    cardCatalog: DECK_INSIGHT_CATALOG,
    enrichmentEventsByReplayId: rawInsightEvents,
    minimumPatternSample: 3,
    includeExplorerStats: section === "cards",
    trustGameStage: !hasCombinedEvidence
  }) : null, [deck, effectiveGameStage, hasCombinedEvidence, rawInsightEvents, scopedReportMatches, scopedReplays, section]);
  const deckCardIdentitySet = useMemo(() => new Set(
    composition
      ? [...composition.mainDeck, ...composition.sideboard].flatMap(deckInsightCardIdentityKeys).map(normalized)
      : []
  ), [composition]);
  const timingRows = useMemo(() => report?.stats.cardTurnOutcomes.filter((row) => deckCardIdentitySet.has(normalized(row.cardId)) || deckCardIdentitySet.has(normalized(row.cardName))) ?? [], [deckCardIdentitySet, report]);
  const originRows = useMemo(() => report?.stats.cardSourceZones.filter((row) => deckCardIdentitySet.has(normalized(row.cardId)) || deckCardIdentitySet.has(normalized(row.cardName))) ?? [], [deckCardIdentitySet, report]);
  const usageRows = useMemo(
    () => composition && report ? buildCardUsageRows(
      composition,
      report,
      eligibleScopedMatches,
      effectiveGameStage,
      !hasCombinedEvidence,
      cardSearch,
      cardSort
    ) : [],
    [cardSearch, cardSort, composition, effectiveGameStage, eligibleScopedMatches, hasCombinedEvidence, report]
  );
  const selectedUsageRow = usageRows.find((row) => `${row.card.section}:${row.card.key}` === selectedCardKey) ?? usageRows[0];
  const replayByMatchId = useMemo(() => {
    const byMatchId = new Map(scopedReplays.map((replay) => [replay.matchId, replay]));
    for (const match of eligibleScopedMatches) {
      if (byMatchId.has(match.id)) continue;
      const combinedReplay = (match.combinedFromMatchIds ?? []).map((id) => byMatchId.get(id)).find(Boolean);
      if (combinedReplay) byMatchId.set(match.id, combinedReplay);
    }
    return byMatchId;
  }, [eligibleScopedMatches, scopedReplays]);

  useEffect(() => {
    setOpponentLegend("");
    setCardSearch("");
    setSelectedCardKey("");
    setGameStage("all");
    setRawAnalysisPass(0);
  }, [deckId]);

  useEffect(() => {
    if (!opponentLegend) return;
    const selected = normalizeLegendName(opponentLegend);
    if (!matchupOptions.some((legend) => normalizeLegendName(legend) === selected)) setOpponentLegend("");
  }, [matchupOptions, opponentLegend]);

  if (!decks.length) {
    return (
      <section className="deck-insights-empty">
        <Layers3 size={42} />
        <h2>Add a deck to unlock Deck Insights</h2>
        <p>Import a deck first, then RiftLite can combine its structure with your locally captured matches and replay evidence.</p>
        <button type="button" className="primary" onClick={() => onNavigate("decks")}>Open deck library <ArrowRight size={15} /></button>
      </section>
    );
  }
  if (!deck || !composition || !performance || !matchupPerformance || !report) return null;

  const selectedDeck = deck;
  const selectedComposition = composition;
  const selectedPerformance = performance;
  const heroCards = deckHeroCards(composition);
  const deckArt = composition.legendCard?.imageUrl || legendImageUrl(composition.legend);
  const form = performance.recentForm;
  const matchupRows = matchupPerformance.performance.matchups;
  const callouts = buildDeckCallouts(composition, performance, report);
  const typeGradient = deckTypeGradient(composition);
  const openingTwoDropChance = composition.mainDeckCopies
    ? Math.round(chanceAtLeastOne(composition.twoCostCopies, composition.mainDeckCopies, 4) * 100)
    : null;
  const scopeLabel = [
    period === "current-season" ? "Current season" : period === "preseason" ? "Pre-season" : "All seasons",
    rangeDays ? `Last ${rangeDays} days` : "All history",
    opponentLegend || "All matchups",
    versionScope === "current" ? "Current list version" : `All linked versions${linkedVersionHashes.length ? ` (${linkedVersionHashes.length})` : ""}`,
    section === "cards" ? deckInsightStageScopeLabel(effectiveGameStage, hasCombinedEvidence) : "All game stages"
  ].join(" · ");
  const mainUsageRows = usageRows.filter((row) => row.card.section === "main");
  const sideboardUsageRows = usageRows.filter((row) => row.card.section === "sideboard");

  async function copyDeckSummary() {
    const strongest = eligibleMatchups(matchupRows, "best")[0];
    const usage = [...usageRows].sort((left, right) => right.capturedPlayGames - left.capturedPlayGames)[0];
    const summary = [
      `${selectedDeck.title} — ${selectedComposition.legend}`,
      `${selectedPerformance.performance.overview.record} · ${selectedPerformance.performance.overview.winRateLabel} across ${selectedPerformance.performance.overview.total} completed matches`,
      `${selectedComposition.mainDeckCopies} main-deck cards · ${selectedComposition.uniqueMainDeckCards} unique · ${selectedComposition.averageEnergy ?? "?"} average energy`,
      strongest ? `Best observed matchup: ${strongest.legend} ${strongest.winRateLabel} (${strongest.record})` : "Best observed matchup: more games needed",
      usage?.report && usage.capturedPlayGames > 0
        ? `Most captured play reach: ${usage.card.name} (${usage.capturedPlayGames} game${usage.capturedPlayGames === 1 ? "" : "s"})`
        : "Card play evidence: more structured replays needed",
      `Scope: ${scopeLabel}`,
      "Generated locally by RiftLite Deck Insights"
    ].join("\n");
    setCopyStatus("Copying…");
    const copied = await copyDeckInsightSummary(
      summary,
      typeof window !== "undefined" ? window.riftlite : undefined
    );
    setCopyStatus(copied ? "Copied!" : "Copy failed");
    window.setTimeout(() => setCopyStatus(""), copied ? 1800 : 3000);
  }

  function selectSection(nextSection: DeckInsightsSection) {
    setSection(nextSection);
    if (nextSection !== "cards") setGameStage("all");
  }

  return (
    <section className="deck-insights-page">
      <header className="deck-insights-hero" style={deckArt ? { "--deck-hero-art": `url(${deckArt})` } as React.CSSProperties : undefined}>
        <div className="deck-insights-hero-copy">
          <span className="deck-insights-kicker"><Sparkles size={15} /> Visual deck report</span>
          <label className="deck-insights-deck-select">
            <span>Selected deck</span>
            <select value={deckId} onChange={(event) => setDeckId(event.target.value)}>
              {decks.map((item) => <option value={item.id} key={item.id}>{item.title} · {item.legend}</option>)}
            </select>
          </label>
          <h2>{deck.title}</h2>
          <p>{composition.legend} · Imported {friendlyDate(deck.lastImportedAt)} · {performance.evidenceLabel.toLowerCase()} match sample</p>
          <div className="deck-insights-hero-actions">
            <button type="button" className="secondary" onClick={() => void copyDeckSummary()}><Copy size={14} /> <span aria-live="polite">{copyStatus || "Copy report"}</span></button>
            <button type="button" className="secondary" onClick={() => onNavigate("decks")}><BookOpen size={14} /> Open deck</button>
          </div>
        </div>
        <div className="deck-insights-card-fan" aria-label="Deck artwork">
          {heroCards.map((card, index) => (
            <div className="deck-insights-fan-card" style={{ "--fan-index": index } as React.CSSProperties} key={`${card.key}:${index}`}>
              {card.imageUrl ? <img src={card.imageUrl} alt={card.name} /> : <span>{card.name.slice(0, 2)}</span>}
            </div>
          ))}
        </div>
        <div className="deck-insights-hero-score">
          <span>Local record</span>
          <strong>{performance.performance.overview.record}</strong>
          <b>{performance.performance.overview.winRateLabel}</b>
          <small>{performance.performance.overview.total} completed · {performance.performance.overview.currentStreak} streak</small>
        </div>
      </header>

      <section className="deck-insights-scope" aria-label="Deck insight filters">
        <div><Filter size={15} /><span><strong>Evidence scope</strong><small>{scopeLabel}</small></span></div>
        <label><span>Season</span><select value={period} onChange={(event) => setPeriod(event.target.value as DeckPeriod)}><option value="all">Pre-season + current</option><option value="current-season">Current season</option><option value="preseason">Pre-season</option></select></label>
        <label><span>Range</span><select value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))}><option value={0}>All history</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={180}>180 days</option></select></label>
        <label><span>Matchup</span><select value={opponentLegend} onChange={(event) => setOpponentLegend(event.target.value)}><option value="">All opponents</option>{matchupOptions.map((legend) => <option value={legend} key={legend}>{legend}</option>)}</select></label>
        <label><span>Deck version</span><select value={versionScope} onChange={(event) => setVersionScope(event.target.value as DeckVersionScope)}><option value="all">All linked versions</option><option value="current">Current list only</option></select></label>
      </section>

      <nav className="deck-insights-section-nav" aria-label="Deck Insights sections">
        <button type="button" data-active={section === "overview" || undefined} aria-pressed={section === "overview"} onClick={() => selectSection("overview")}><BarChart3 size={16} /><span><strong>Overview</strong><small>Shape, curve and recent form</small></span></button>
        <button type="button" data-active={section === "cards" || undefined} aria-pressed={section === "cards"} onClick={() => selectSection("cards")}><Eye size={16} /><span><strong>Card review</strong><small>Reach, hand conversion and mulligans</small></span></button>
        <button type="button" data-active={section === "matchups" || undefined} aria-pressed={section === "matchups"} onClick={() => selectSection("matchups")}><Swords size={16} /><span><strong>Matchups</strong><small>Opponents, splits and battlefields</small></span></button>
      </nav>

      {section === "overview" ? <>
      <section className="deck-insights-metric-strip" aria-label="Deck overview">
        <DeckMetric icon={<Trophy size={17} />} label="Win rate" value={performance.performance.overview.winRateLabel} detail={performance.performance.overview.record} tone="cyan" />
        <DeckMetric icon={<Layers3 size={17} />} label="Main deck" value={`${composition.mainDeckCopies}`} detail={`${composition.uniqueMainDeckCards} unique cards`} tone="violet" />
        <DeckMetric icon={<Flame size={17} />} label="Average energy" value={composition.averageEnergy === null ? "—" : composition.averageEnergy.toFixed(1)} detail={`${composition.knownEnergyCopies}/${composition.mainDeckCopies} costs known`} tone="gold" />
        <DeckMetric icon={<Target size={17} />} label="Open a 2-cost" value={openingTwoDropChance === null ? "—" : `${openingTwoDropChance}%`} detail="Opening 4 · list estimate" tone="pink" />
        <DeckMetric icon={<Gamepad2 size={17} />} label="Captured games" value={`${report.gamesAnalyzed}`} detail={`${report.replaysAnalyzed} replay${report.replaysAnalyzed === 1 ? "" : "s"}`} tone="blue" />
        <DeckMetric icon={<ShieldCheck size={17} />} label="Evidence" value={coverageLabel(report.coverage.grade)} detail={`${report.coverage.replaysWithStructuredEvents} rich captures`} tone="green" />
      </section>

      <section className="deck-insights-callouts" aria-label="Key deck reads">
        {callouts.map((callout) => (
          <article data-tone={callout.tone} key={callout.title}>
            <span>{callout.icon}</span>
            <div><small>{callout.eyebrow}</small><strong>{callout.title}</strong><p>{callout.body}</p></div>
          </article>
        ))}
      </section>

      <div className="deck-insights-dashboard-grid">
        <section className="deck-insights-panel deck-curve-panel">
          <PanelHeading icon={<BarChart3 size={17} />} kicker="Deck shape" title="Energy curve" detail={`${composition.earlyCurveCopies} cards cost 0–2 · ${composition.highCostCopies} cost 5+`} />
          <DeckCurve composition={composition} />
          <div className="deck-copy-profile">
            {composition.copyProfile.map((row) => <span key={row.copies}><strong>{row.cards}</strong><small>{row.label}</small></span>)}
          </div>
        </section>

        <section className="deck-insights-panel deck-type-panel">
          <PanelHeading icon={<Layers3 size={17} />} kicker="Composition" title="Card types" detail="Copy-weighted main-deck split" />
          <div className="deck-type-visual">
            <div className="deck-type-donut" role="img" aria-label={`Card types: ${composition.types.map((slice) => `${slice.type} ${slice.copies}`).join(", ")}`} style={{ background: typeGradient }}><span><strong>{composition.mainDeckCopies}</strong><small>cards</small></span></div>
            <div className="deck-type-legend">
              {composition.types.map((slice, index) => <div key={slice.type}><i style={{ background: TYPE_COLORS[index % TYPE_COLORS.length] }} /><span><strong>{slice.type}</strong><small>{slice.cards} unique</small></span><b>{slice.copies} · {formatPercent(slice.percentage)}</b></div>)}
            </div>
          </div>
          <div className="deck-zone-counts"><span><strong>{composition.sideboardCopies}</strong> sideboard</span><span><strong>{composition.battlefields.length}</strong> battlefields</span><span><strong>{composition.runes.reduce((sum, rune) => sum + rune.qty, 0)}</strong> runes</span></div>
        </section>

        <section className="deck-insights-panel deck-form-panel wide">
          <PanelHeading icon={<LineChart size={17} />} kicker="Performance" title="Recent form" detail="Rolling five-match win rate; outcomes are context, not proof of deck quality" />
          <DeckFormChart points={form} hasReplay={(matchId) => replayByMatchId.has(matchId)} onOpenMatch={(matchId) => {
            const replay = replayByMatchId.get(matchId);
            if (replay) onOpenReplay(replay.id);
          }} />
        </section>
      </div>
      </> : null}

      {section === "cards" ? <>
      <section className="deck-insights-panel deck-card-lab">
        <PanelHeading icon={<Eye size={17} />} kicker="Captured card decisions" title="Which cards are worth reviewing?" detail={rawLoading ? "Enriching older raw captures locally…" : "Counts and lower-bound reach keep missing evidence visible instead of presenting a saturated percentage"} />
        <div className="deck-card-lab-toolbar">
          <label><Search size={14} /><input aria-label="Search cards" value={cardSearch} onChange={(event) => setCardSearch(event.target.value)} placeholder="Find a card…" /></label>
          <select aria-label="Sort cards" value={cardSort} onChange={(event) => setCardSort(event.target.value as DeckCardSort)}><option value="review">Needs review</option><option value="reach">Captured play reach</option><option value="curve">Energy curve</option><option value="copies">Copies</option><option value="name">Name</option></select>
          <label className="deck-card-stage-filter"><span>Captured stage</span><select value={hasCombinedEvidence ? "all" : gameStage} disabled={hasCombinedEvidence} title={hasCombinedEvidence ? "Game order cannot be identified reliably inside manually combined match evidence." : undefined} onChange={(event) => setGameStage(event.target.value as ReplayInsightGameStage)}><option value="all">{hasCombinedEvidence ? "All games (combined evidence)" : "All games"}</option><option value="preboard">Game 1 (identified)</option><option value="postboard">Post-board (identified)</option></select></label>
          {rawExcludedCount ? <button type="button" className="secondary deck-raw-more" onClick={() => setRawAnalysisPass((current) => current + 1)}>Analyze {Math.min(DECK_RAW_ANALYSIS_BATCH, rawExcludedCount)} older</button> : null}
          <span>{usageRows.length} card{usageRows.length === 1 ? "" : "s"}</span>
        </div>
        {hasCombinedEvidence ? <small className="deck-card-stage-note">Stage filtering is paused because this scope contains manually combined games whose original replay order cannot be verified.</small> : null}
        <small className="deck-card-stage-note">Card Review scope: {deckInsightStageScopeLabel(effectiveGameStage, hasCombinedEvidence)}.</small>
        <small className="deck-card-stage-note">Captured reach is a lower bound: a missing play can mean missing evidence. Hand conversion starts only when RiftLite saw a card before its play, never from the play event itself.</small>
        <div className="deck-card-review-workspace">
          <div className="deck-card-review-lists">
            <DeckCardUsageTable title="Main deck" rows={mainUsageRows} selectedKey={selectedUsageRow ? `${selectedUsageRow.card.section}:${selectedUsageRow.card.key}` : ""} onSelect={setSelectedCardKey} />
            {sideboardUsageRows.length ? <DeckCardUsageTable title="Sideboard" rows={sideboardUsageRows} selectedKey={selectedUsageRow ? `${selectedUsageRow.card.section}:${selectedUsageRow.card.key}` : ""} onSelect={setSelectedCardKey} /> : null}
            {!usageRows.length ? <DeckInsightEmpty icon={<Search size={24} />} title="No cards match this search" body="Clear the search to see every card in the selected list." /> : null}
          </div>
          {selectedUsageRow ? <DeckCardUsageDetail row={selectedUsageRow} onOpenReplay={onOpenReplay} /> : null}
        </div>
      </section>
      <section className="deck-insights-panel deck-sideboard-panel">
        <PanelHeading icon={<Layers3 size={17} />} kicker="Reserve plan" title="Sideboard at a glance" detail="List facts only; post-board evidence is shown separately when RiftLite captured it" />
        {composition.sideboard.length ? <div className="deck-zone-gallery">{composition.sideboard.map((card) => <article key={card.key}><div>{card.imageUrl ? <img src={card.imageUrl} alt={card.name} loading="lazy" /> : <span>{card.name.slice(0, 2)}</span>}<b>{card.qty}x</b>{card.costEnergy !== null ? <em>{card.costEnergy}</em> : null}</div><strong>{card.name}</strong><small>{card.type}</small></article>)}</div> : <DeckInsightEmpty icon={<Layers3 size={24} />} title="No sideboard in this list" body="Import a list with sideboard cards to see its reserve plan here." />}
      </section>
      </> : null}

      {section === "matchups" ? <>
      <div className="deck-insights-dashboard-grid lower-grid">
        <section className="deck-insights-panel deck-matchup-panel">
          <PanelHeading icon={<Swords size={17} />} kicker="Matchups" title="Opponent breakdown" detail="Click a legend to scope every captured-card panel" />
          <div className="deck-matchup-list">
            {matchupRows.length ? matchupRows.map((row) => (
              <button type="button" data-active={normalizeLegendName(opponentLegend) === normalizeLegendName(row.legend) || undefined} onClick={() => setOpponentLegend((current) => normalizeLegendName(current) === normalizeLegendName(row.legend) ? "" : row.legend)} key={row.legend}>
                <span className="deck-matchup-avatar">{legendImageUrl(row.legend) ? <img src={legendImageUrl(row.legend)} alt="" /> : row.legend.slice(0, 2)}</span>
                <span><strong>{row.legend}</strong><small>{row.record} · n={row.total}</small></span>
                <em><i style={{ width: `${row.winRate}%` }} /></em>
                <b>{row.winRateLabel}</b><ChevronRight size={14} />
              </button>
            )) : <DeckInsightEmpty icon={<Swords size={24} />} title="No matchup sample yet" body="Completed matches linked to this deck will appear here." />}
          </div>
        </section>

        <section className="deck-insights-panel deck-splits-panel">
          <PanelHeading icon={<Target size={17} />} kicker="Context splits" title="Format, season and initiative" detail="Small samples stay visible with their exact record" />
          <RecordSplit title="Format" rows={performance.formats} />
          <RecordSplit title="Season" rows={performance.periods} />
          <RecordSplit title="Initiative" rows={performance.performance.seatStats.map((row) => ({ ...row, key: row.seat, label: row.seat === "1st" ? "Going first" : row.seat === "2nd" ? "Going second" : "Unknown" }))} />
        </section>
      </div>
      </> : null}

      {section === "cards" ? <>
      <section className="deck-insights-panel deck-timing-panel">
        <PanelHeading icon={<Clock3 size={17} />} kicker="Play windows" title="Card timing versus outcome" detail="Observed correlation only. A result beside a play does not mean that play caused the result." />
        <DeckTimingMatrix rows={timingRows} />
      </section>

      <section className="deck-insights-panel deck-origin-panel">
        <PanelHeading icon={<Activity size={17} />} kicker="How cards enter play" title="From hand, hidden zones and elsewhere" detail={`${report.stats.sourceCoveragePercent}% of ${report.stats.capturedLocalPlays} captured local plays have a known source`} />
        <DeckOriginRows rows={originRows} />
      </section>
      </> : null}

      {section === "matchups" ? <>
      <div className="deck-insights-dashboard-grid lower-grid">
        <section className="deck-insights-panel deck-battlefield-panel">
          <PanelHeading icon={<Target size={17} />} kicker="Battlefields" title="Your observed battlefield results" detail="Game-level results for the selected evidence scope" />
          <div className="deck-battlefield-grid">
            {performance.performance.myBattlefields.slice(0, 8).map((row) => <article key={row.name}><span><strong>{row.name}</strong><small>{row.record} · n={row.total}</small></span><b>{row.winRateLabel}</b><em><i style={{ width: `${row.winRate}%` }} /></em></article>)}
            {!performance.performance.myBattlefields.length ? <DeckInsightEmpty icon={<Target size={24} />} title="No battlefield evidence" body="Battlefield choices appear after they are captured in completed games." /> : null}
          </div>
        </section>

        <section className="deck-insights-panel deck-evidence-panel">
          <PanelHeading icon={<Database size={17} />} kicker="Data receipt" title="What this report can see" detail="Everything here is calculated on this device" />
          <div className="deck-evidence-score"><strong>{coverageLabel(report.coverage.grade)}</strong><span>capture coverage</span></div>
          <ul>
            <li><Check size={13} /><span><strong>{performance.performance.overview.total}</strong> completed deck matches</span></li>
            <li><Check size={13} /><span><strong>{report.replaysAnalyzed}</strong> replay records analyzed</span></li>
            <li><Check size={13} /><span><strong>{report.coverage.namedCardJourneys}</strong> named card journeys</span></li>
            <li><Check size={13} /><span><strong>{report.coverage.replaysWithStructuredEvents}</strong> structured replay captures</span></li>
            <li><Check size={13} /><span><strong>{report.scopeReceipt.deckVersions.length || scopedVersionHashes.length}</strong> identified deck version{(report.scopeReceipt.deckVersions.length || scopedVersionHashes.length) === 1 ? "" : "s"}</span></li>
          </ul>
          {rawExcludedCount ? <button type="button" className="secondary" onClick={() => setRawAnalysisPass((current) => current + 1)}>Analyze {Math.min(DECK_RAW_ANALYSIS_BATCH, rawExcludedCount)} older raw capture{Math.min(DECK_RAW_ANALYSIS_BATCH, rawExcludedCount) === 1 ? "" : "s"}</button> : null}
          <p><ShieldCheck size={14} /> Local only · no Firebase reads. Unknown means RiftLite did not capture it, not that it did not happen.</p>
        </section>
      </div>
      </> : null}
    </section>
  );
}

function DeckMetric({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <article data-tone={tone}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function PanelHeading({ icon, kicker, title, detail }: { icon: React.ReactNode; kicker: string; title: string; detail: string }) {
  return <header className="deck-insights-panel-heading"><span>{icon}</span><div><small>{kicker}</small><h3>{title}</h3><p>{detail}</p></div></header>;
}

function DeckCurve({ composition }: { composition: DeckInsightComposition }) {
  const max = Math.max(1, ...composition.curve.map((row) => row.copies));
  const description = composition.curve.map((row) => `${row.label} energy: ${row.copies} copies`).join(", ");
  return <div className="deck-curve-chart" role="img" aria-label={`Energy curve. ${description}`}>{composition.curve.map((row) => <div key={row.key}><span><i style={{ height: `${Math.max(row.copies ? 10 : 0, (row.copies / max) * 100)}%` }}><b>{row.copies || ""}</b></i></span><strong>{row.label}</strong><small>{row.cards} unique</small></div>)}</div>;
}

function DeckFormChart({ points, hasReplay, onOpenMatch }: { points: DeckInsightFormPoint[]; hasReplay: (matchId: string) => boolean; onOpenMatch: (matchId: string) => void }) {
  if (!points.length) return <DeckInsightEmpty icon={<LineChart size={24} />} title="No completed matches in this scope" body="Play with this deck and its form line will grow here." />;
  const chartPoints = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? 50 : 4 + (index / (points.length - 1)) * 92,
    y: 92 - point.rollingWinRate * 0.78
  }));
  const line = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${chartPoints[0]!.x},96 ${line} ${chartPoints.at(-1)!.x},96`;
  return <div className="deck-form-chart">
    <div className="deck-form-plot"><svg viewBox="0 0 100 100" role="img" aria-label="Rolling five-match win rate"><defs><linearGradient id="deck-form-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#69e5d1" stopOpacity=".36" /><stop offset="1" stopColor="#69e5d1" stopOpacity="0" /></linearGradient></defs><line x1="4" y1="53" x2="96" y2="53" className="deck-form-midline" /><polygon points={area} fill="url(#deck-form-fill)" /><polyline points={line} className="deck-form-line" />{chartPoints.map((point) => <circle cx={point.x} cy={point.y} r="1.8" data-result={point.result} key={point.matchId}><title>{point.opponentLegend || "Unknown opponent"}: {point.result} · rolling {point.rollingWinRate}%</title></circle>)}</svg><span className="deck-form-axis top">100%</span><span className="deck-form-axis mid">50%</span><span className="deck-form-axis bottom">0%</span></div>
    <div className="deck-form-results">{points.map((point) => {
      const replayAvailable = hasReplay(point.matchId);
      return <button type="button" data-result={point.result} disabled={!replayAvailable} title={replayAvailable ? `${friendlyDate(point.capturedAt)} · ${point.result} vs ${point.opponentLegend || "Unknown"} · rolling ${point.rollingWinRate}%` : `${friendlyDate(point.capturedAt)} · No captured replay available`} onClick={() => onOpenMatch(point.matchId)} key={point.matchId}><span>{point.result === "Win" ? "W" : point.result === "Loss" ? "L" : "D"}</span><small>{point.opponentLegend || "?"}</small></button>;
    })}</div>
  </div>;
}

function DeckCardUsageTable({ title, rows, selectedKey, onSelect }: {
  title: string;
  rows: DeckCardUsageRow[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  if (!rows.length) return null;
  return <section className="deck-card-review-list">
    <header><strong>{title}</strong><span>{rows.length} card{rows.length === 1 ? "" : "s"}</span></header>
    <div className="deck-card-review-columns" aria-hidden="true"><span>Card</span><span>Play evidence</span><span>Seen before play</span><span>Mulligan</span><span>Review signal</span></div>
    <div>
      {rows.map((row) => {
        const key = `${row.card.section}:${row.card.key}`;
        const hand = row.report?.prePlayHand;
        const mulligan = row.report?.mulligan;
        const hasMulligan = Boolean(mulligan?.offeredGames);
        return <button
          type="button"
          className="deck-card-review-row"
          data-selected={selectedKey === key || undefined}
          aria-pressed={selectedKey === key}
          onClick={() => onSelect(key)}
          key={key}
        >
          <span className="deck-card-review-identity">
            <i>{row.card.imageUrl ? <img src={row.card.imageUrl} alt="" loading="lazy" /> : row.card.name.slice(0, 2)}</i>
            <span><strong>{row.card.name}</strong><small>{row.card.qty}x · {row.card.costEnergy === null ? "?" : row.card.costEnergy} energy</small></span>
          </span>
          <span className="deck-card-review-stat"><strong>{row.capturedPlayGames}</strong><small>{deckInsightPlayReachSummary(row)}</small></span>
          <span className="deck-card-review-stat"><strong>{hand?.laterPlayedGames ?? 0}/{hand?.observedGames ?? 0}</strong><small>a copy later played</small></span>
          <span className="deck-card-review-stat"><strong>{hasMulligan ? `${mulligan?.keptGames ?? 0} keep games` : "—"}</strong><small>{hasMulligan ? `${mulligan?.redrawnGames ?? 0} redraw games · ${mulligan?.offeredGames ?? 0} offer games` : "not captured"}</small></span>
          <span className="deck-card-review-signal" data-status={row.review.status}><strong>{row.review.label}</strong><small>{sampleTierLabel(row.review.sampleTier)} · n={row.review.opportunities}</small></span>
        </button>;
      })}
    </div>
  </section>;
}

function DeckCardUsageDetail({ row, onOpenReplay }: { row: DeckCardUsageRow; onOpenReplay: DeckInsightsViewProps["onOpenReplay"] }) {
  const report = row.report;
  const mulligan = report?.mulligan ?? { offeredGames: 0, keptGames: 0, redrawnGames: 0, latePlayedGames: 0 };
  const hand = report?.prePlayHand ?? { observedGames: 0, laterPlayedGames: 0, noCapturedPlayGames: 0, recycledOrDiscardedGames: 0 };
  const turns = report?.firstPlayTurns ?? { byTurn3Games: 0, turns4To5Games: 0, turn6PlusGames: 0, unknownTurnGames: 0 };
  const reach = report?.playReach ?? { preboardGames: 0, postboardGames: 0, unknownStageGames: 0 };
  const resolvedHand = hand.laterPlayedGames + hand.noCapturedPlayGames;
  const unknownHandOutcomes = Math.max(0, hand.observedGames - resolvedHand);
  const source = row.source;
  return <aside className="deck-card-review-detail" data-status={row.review.status}>
    <header>
      <div className="deck-card-review-detail-art">{row.card.imageUrl ? <img src={row.card.imageUrl} alt={row.card.name} /> : <span>{row.card.name.slice(0, 2)}</span>}</div>
      <div><small>{row.card.section === "sideboard" ? "Sideboard" : "Main deck"} · {row.card.type}</small><h4>{row.card.name}</h4><p>{row.card.qty} copies · {row.card.costEnergy === null ? "Unknown" : row.card.costEnergy} energy</p></div>
      <span className="deck-card-review-signal" data-status={row.review.status}><strong>{row.review.label}</strong><small>{sampleTierLabel(row.review.sampleTier)} · n={row.review.opportunities}</small></span>
    </header>
    <p className="deck-card-review-reason">{row.review.reason}</p>
    <div className="deck-card-review-detail-grid">
      <section>
        <small>Captured play reach · {deckInsightStageScopeLabel(row.gameStage, !row.trustGameStage)} · {captureConfidenceLabel(report?.confidence)}</small>
        <strong>{deckInsightPlayReachHeadline(row)}</strong>
        <p>{deckInsightPlayReachContext(row)}</p>
        <dl>
          {row.gameStage !== "postboard" && row.trustGameStage ? <div><dt>Captured G1 play-games</dt><dd>{reach.preboardGames}</dd></div> : null}
          {row.gameStage !== "preboard" && row.trustGameStage ? <div><dt>Captured post-board play-games</dt><dd>{reach.postboardGames}</dd></div> : null}
          {row.gameStage === "all" || !row.trustGameStage ? <div><dt>Stage-unverified play-games</dt><dd>{reach.unknownStageGames}</dd></div> : null}
          <div><dt>By turn 3</dt><dd>{turns.byTurn3Games}</dd></div><div><dt>By turn 5</dt><dd>{turns.byTurn3Games + turns.turns4To5Games}</dd></div><div><dt>Turn 6+</dt><dd>{turns.turn6PlusGames}</dd></div><div><dt>Turn unknown</dt><dd>{turns.unknownTurnGames}</dd></div>
          {row.trustGameStage && row.gameStage !== "preboard" ? <div><dt>Post-board starting-list contexts</dt><dd>{row.eligibility.postboardListOpportunityGames}</dd></div> : null}
        </dl>
      </section>
      <section>
        <small>Pre-play hand conversion</small>
        <strong>{hand.laterPlayedGames}/{hand.observedGames}</strong>
        <p>A card-name play followed an independent earlier hand observation. The play event cannot create this denominator.</p>
        <dl><div><dt>Seen before play</dt><dd>{hand.observedGames}</dd></div><div><dt>A copy later played</dt><dd>{hand.laterPlayedGames}</dd></div><div><dt>No captured play</dt><dd>{hand.noCapturedPlayGames}</dd></div><div><dt>Outcome unknown</dt><dd>{unknownHandOutcomes}</dd></div></dl>
      </section>
      <section>
        <small>Mulligan decisions</small>
        <strong>{mulligan.offeredGames} offer games</strong>
        <p>Counts are per game and card name. Keep and redraw games can overlap when different copies split, and a later play cannot be linked to the kept copy.</p>
        <dl><div><dt>Games offered</dt><dd>{mulligan.offeredGames}</dd></div><div><dt>Games with a keep</dt><dd>{mulligan.keptGames}</dd></div><div><dt>Games with a redraw</dt><dd>{mulligan.redrawnGames}</dd></div><div><dt>Keep games with a late name play</dt><dd>{mulligan.latePlayedGames}</dd></div></dl>
      </section>
      <section>
        <small>Timing and role</small>
        <strong>{source?.totalPlays ?? 0} captured plays</strong>
        <p>{source ? `${source.onTurn} on-turn · ${source.offTurn} off-turn · ${source.unknownTurn} turn unknown.` : "Source-zone and turn-role evidence has not been captured yet."}</p>
        <dl><div><dt>From hand</dt><dd>{source?.hand ?? 0}</dd></div><div><dt>Hidden</dt><dd>{source?.hidden ?? 0}</dd></div><div><dt>Trash/deck</dt><dd>{(source?.trash ?? 0) + (source?.deck ?? 0)}</dd></div><div><dt>Review-grade recycle/discard</dt><dd>{hand.recycledOrDiscardedGames}</dd></div></dl>
      </section>
    </div>
    {(row.eligibility.unknownSnapshotGames || row.eligibility.unresolvedMatches) ? <p className="deck-card-review-caveat">Excluded from the confirmed list-opportunity count: {row.eligibility.unknownSnapshotGames} completed game{row.eligibility.unknownSnapshotGames === 1 ? "" : "s"} without a usable list snapshot{row.eligibility.unresolvedMatches ? ` and ${row.eligibility.unresolvedMatches} completed match${row.eligibility.unresolvedMatches === 1 ? "" : "es"} without exact game count` : ""}.</p> : null}
    <p className="deck-card-review-caveat">RiftLite cannot reliably distinguish the second or third copy, so every claim says only that <em>a copy</em> was observed or played. Review rates exclude inferred-only events; missing capture remains unknown.</p>
    {report?.replayIds[0] ? <button type="button" className="secondary" onClick={() => onOpenReplay(report.replayIds[0])}>Open evidence replay <ArrowRight size={12} /></button> : null}
  </aside>;
}

function RecordSplit({ title, rows }: { title: string; rows: DeckInsightRecordSlice[] }) {
  return <section className="deck-record-split"><h4>{title}</h4>{rows.length ? rows.map((row) => <div key={row.key}><span><strong>{row.label}</strong><small>{row.record} · n={row.total}</small></span><em><i style={{ width: `${row.winRate}%` }} /></em><b>{row.winRateLabel}</b></div>) : <p>No completed sample.</p>}</section>;
}

function DeckTimingMatrix({ rows }: { rows: ReplayInsightCardTurnOutcome[] }) {
  const grouped = new Map<string, ReplayInsightCardTurnOutcome[]>();
  for (const row of rows) {
    const cardKey = row.key.replace(/:turn-\d+$/, "") || normalized(row.cardId) || normalized(row.cardName);
    grouped.set(cardKey, [...(grouped.get(cardKey) ?? []), row]);
  }
  const groups = [...grouped.values()].sort((left, right) => right.reduce((sum, row) => sum + row.games, 0) - left.reduce((sum, row) => sum + row.games, 0)).slice(0, 12);
  if (!groups.length) return <DeckInsightEmpty icon={<Clock3 size={24} />} title="No reliable timing rows yet" body="Turn-linked card plays appear after structured replay captures provide enough complete games." />;
  const turns = [1, 2, 3, 4, 5, 6];
  return <div className="deck-timing-matrix"><div className="deck-timing-head"><span>Card</span>{turns.map((turn) => <b key={turn}>T{turn === 6 ? "6+" : turn}</b>)}</div>{groups.map((group) => {
    const exemplar = group[0]!;
    return <div className="deck-timing-row" key={exemplar.key}><span>{exemplar.imageUrl ? <img src={exemplar.imageUrl} alt="" /> : null}<strong>{exemplar.cardName}</strong></span>{turns.map((turn) => {
      const candidates = group.filter((row) => turn === 6 ? row.playerTurnNumber >= 6 : row.playerTurnNumber === turn);
      const games = candidates.reduce((sum, row) => sum + row.games, 0);
      const wins = candidates.reduce((sum, row) => sum + row.wins, 0);
      const losses = candidates.reduce((sum, row) => sum + row.losses, 0);
      const decisive = wins + losses;
      const rate = decisive ? Math.round((wins / decisive) * 100) : null;
      const title = !games
        ? "No observed sample"
        : rate === null
          ? `${exemplar.cardName} on turn ${turn === 6 ? "6+" : turn}: no decisive results across ${games} observed games.`
          : `${exemplar.cardName} on turn ${turn === 6 ? "6+" : turn}: ${rate}% win rate across ${games} observed games. Correlation only.`;
      return <span className="deck-timing-cell" data-state={!games ? "empty" : games < 3 ? "early" : rate !== null && rate >= 60 ? "high" : rate !== null && rate <= 40 ? "low" : "mid"} title={title} key={turn}>{games ? <><strong>{rate === null ? "—" : `${rate}%`}</strong><small>n={games}</small></> : "—"}</span>;
    })}</div>;
  })}</div>;
}

function DeckOriginRows({ rows }: { rows: ReplayInsightCardSourceZones[] }) {
  const visible = [...rows].sort((left, right) => right.totalPlays - left.totalPlays).slice(0, 12);
  if (!visible.length) return <DeckInsightEmpty icon={<Activity size={24} />} title="No source-zone evidence yet" body="RiftLite will separate hand, hidden, trash and deck plays when those origins are captured." />;
  return <div className="deck-origin-rows">{visible.map((row) => <article key={row.key}><span className="deck-origin-card">{row.imageUrl ? <img src={row.imageUrl} alt="" /> : null}<strong>{row.cardName}</strong><small>{row.totalPlays} captured plays</small></span><div><em><i data-source="hand" style={{ width: `${row.handPercent}%` }} /><i data-source="hidden" style={{ width: `${row.hiddenPercent}%` }} /><i data-source="trash" style={{ width: `${row.trashPercent}%` }} /><i data-source="deck" style={{ width: `${row.deckPercent}%` }} /><i data-source="other" style={{ width: `${row.otherPercent + row.unknownPercent}%` }} /></em><p><span data-source="hand">Hand <b>{row.handPercent}%</b></span><span data-source="hidden">Hidden <b>{row.hiddenPercent}%</b></span><span data-source="trash">Trash <b>{row.trashPercent}%</b></span><span data-source="deck">Deck <b>{row.deckPercent}%</b></span><span>Other/unknown <b>{Math.round((row.otherPercent + row.unknownPercent) * 10) / 10}%</b></span></p></div><strong>{row.onTurn}<small> on-turn</small></strong></article>)}</div>;
}

function DeckInsightEmpty({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return <div className="deck-insight-inline-empty">{icon}<strong>{title}</strong><span>{body}</span></div>;
}

function buildCardUsageRows(
  composition: DeckInsightComposition,
  report: ReplayInsightsReport,
  matches: MatchDraft[],
  gameStage: ReplayInsightGameStage,
  trustGameStage: boolean,
  search: string,
  sort: DeckCardSort
): DeckCardUsageRow[] {
  const reports = new Map<string, ReplayInsightCardReport>();
  for (const card of report.cards) {
    for (const key of [card.key, card.cardId, card.cardName].map(normalized).filter(Boolean)) if (!reports.has(key)) reports.set(key, card);
  }
  const sources = new Map<string, ReplayInsightCardSourceZones>();
  for (const source of report.stats.cardSourceZones) {
    for (const key of [source.key, source.cardId, source.cardName].map(normalized).filter(Boolean)) if (!sources.has(key)) sources.set(key, source);
  }
  const needle = search.trim().toLowerCase();
  const rows = [...composition.mainDeck, ...composition.sideboard].map((card) => {
    const identityKeys = deckInsightCardIdentityKeys(card);
    const reportCard = identityKeys.map((key) => reports.get(normalized(key))).find(Boolean);
    const eligibility = deckInsightCardEligibility(card, matches, gameStage);
    return {
      card,
      report: reportCard,
      eligibility,
      review: buildDeckInsightCardReviewSignal(reportCard),
      source: identityKeys.map((key) => sources.get(normalized(key))).find(Boolean),
      capturedPlayGames: reportCard?.playReach
        ? reportCard.playReach.preboardGames + reportCard.playReach.postboardGames + reportCard.playReach.unknownStageGames
        : 0,
      gameStage,
      trustGameStage
    };
  }).filter((row) => !needle || `${row.card.name} ${row.card.type} ${row.card.supertype}`.toLowerCase().includes(needle));
  return rows.sort((left, right) => {
    if (sort === "review") return right.review.score - left.review.score || right.review.opportunities - left.review.opportunities || left.card.name.localeCompare(right.card.name);
    if (sort === "reach") return right.capturedPlayGames - left.capturedPlayGames || right.eligibility.eligibleCompletedGames - left.eligibility.eligibleCompletedGames || left.card.name.localeCompare(right.card.name);
    if (sort === "curve") return (left.card.costEnergy ?? 99) - (right.card.costEnergy ?? 99) || left.card.name.localeCompare(right.card.name);
    if (sort === "copies") return right.card.qty - left.card.qty || left.card.name.localeCompare(right.card.name);
    return left.card.name.localeCompare(right.card.name);
  });
}

function buildDeckCallouts(composition: DeckInsightComposition, performance: ReturnType<typeof buildDeckInsightPerformance>, report: ReplayInsightsReport) {
  const eligible = performance.performance.matchups.filter((row) => row.decisive >= 2);
  const rankedMatchups = [...eligible].sort((left, right) => right.winRate - left.winRate || right.total - left.total || left.legend.localeCompare(right.legend));
  const best = rankedMatchups.length >= 2 ? rankedMatchups[0] : undefined;
  const worst = rankedMatchups.length >= 2 ? rankedMatchups.at(-1) : undefined;
  const allowedCards = new Set([...composition.mainDeck, ...composition.sideboard].flatMap(deckInsightCardIdentityKeys).map(normalized));
  const reportCardsForDeck = report.cards.filter((card) => (
    allowedCards.has(normalized(card.cardId)) || allowedCards.has(normalized(card.cardName))
  ));
  const reviewCandidate = reportCardsForDeck
    .map((card) => ({ card, signal: buildDeckInsightCardReviewSignal(card) }))
    .filter((item) => item.signal.status === "needs-review")
    .sort((left, right) => right.signal.score - left.signal.score)[0];
  return [
    {
      tone: composition.twoCostCopies >= 7 ? "positive" : "watch",
      icon: composition.twoCostCopies >= 7 ? <TrendingUp size={18} /> : <TrendingDown size={18} />,
      eyebrow: "Early curve",
      title: `${composition.twoCostCopies} two-cost cards`,
      body: composition.twoCostCopies >= 7 ? `${composition.earlyCurveCopies} cards cost two or less, giving this list a visibly dense early curve.` : `${composition.earlyCurveCopies} cards cost two or less. Check whether the mulligan plan reliably finds an early play.`
    },
    {
      tone: best ? "positive" : "neutral",
      icon: <Trophy size={18} />,
      eyebrow: "Best observed matchup",
      title: best ? `${best.legend} · ${best.winRateLabel}` : "More games needed",
      body: best ? `${best.record} across ${best.total} completed matches. Treat this as an observed record, not a guaranteed edge.` : "RiftLite waits for two repeat matchups before naming a matchup leader."
    },
    {
      tone: worst ? "watch" : "neutral",
      icon: <Target size={18} />,
      eyebrow: "Matchup to review",
      title: worst ? `${worst.legend} · ${worst.winRateLabel}` : "Two repeat matchups needed",
      body: worst ? `${worst.record} across ${worst.total} matches. Use the matchup filter to inspect card timing and source zones.` : "Build a repeat sample to separate one-off results from recurring friction."
    },
    {
      tone: reviewCandidate ? "watch" : "neutral",
      icon: <Eye size={18} />,
      eyebrow: "Card review candidate",
      title: reviewCandidate ? `${reviewCandidate.card.cardName} · ${reviewCandidate.signal.label}` : "No repeat signal yet",
      body: reviewCandidate
        ? `${reviewCandidate.signal.reason} This is a prompt to review examples, not an automatic cut recommendation.`
        : "New structured replays will unlock lower-bound play reach, pre-play hand conversion, mulligan decisions and timing."
    }
  ];
}

function deckHeroCards(composition: DeckInsightComposition): DeckInsightCard[] {
  const candidates = [composition.legendCard, ...composition.champions, ...[...composition.mainDeck].sort((left, right) => right.qty - left.qty || left.name.localeCompare(right.name)), ...composition.battlefields].filter((card): card is DeckInsightCard => Boolean(card?.imageUrl));
  return [...new Map(candidates.map((card) => [card.key || card.name, card])).values()].slice(0, 5);
}

function deckTypeGradient(composition: DeckInsightComposition): string {
  if (!composition.types.length) return "rgb(255 255 255 / 5%)";
  let cursor = 0;
  const stops = composition.types.map((slice, index) => {
    const start = cursor;
    cursor += slice.percentage;
    return `${TYPE_COLORS[index % TYPE_COLORS.length]} ${start}% ${cursor}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function eligibleMatchups(rows: ReturnType<typeof buildDeckInsightPerformance>["performance"]["matchups"], mode: "best" | "worst") {
  return [...rows].filter((row) => row.decisive >= 2).sort((left, right) => (mode === "best" ? right.winRate - left.winRate : left.winRate - right.winRate) || right.total - left.total);
}

function filterDeckInsightMatches(matches: MatchDraft[], rangeDays: number, period: DeckPeriod): MatchDraft[] {
  const now = Date.now();
  const currentSeason = Date.parse(`${MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON}T00:00:00.000Z`);
  return matches.filter((match) => {
    const captured = Date.parse(match.capturedAt);
    if (!Number.isFinite(captured)) return false;
    if (rangeDays && captured < now - rangeDays * 86_400_000) return false;
    if (period === "current-season" && captured < currentSeason) return false;
    if (period === "preseason" && captured >= currentSeason) return false;
    return true;
  });
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function coverageLabel(grade: ReplayInsightsReport["coverage"]["grade"]): string {
  return grade === "high" ? "Rich" : grade === "medium" ? "Mixed" : "Limited";
}

function sampleTierLabel(tier: DeckInsightCardReviewSignal["sampleTier"]): string {
  if (tier === "stable") return "Reasonably stable";
  if (tier === "developing") return "Developing";
  if (tier === "early") return "Early signal";
  return "Counts only";
}

function captureConfidenceLabel(confidence: ReplayInsightCardReport["confidence"] | undefined): string {
  if (confidence === "confirmed") return "Confirmed";
  if (confidence === "reconstructed") return "Reconstructed";
  if (confidence === "manual") return "Manual";
  if (confidence === "inferred") return "Includes inferred";
  return "No evidence";
}

export function deckInsightStageScopeLabel(gameStage: ReplayInsightGameStage, stageUntrusted: boolean): string {
  if (stageUntrusted) return "All games, stage unverified";
  if (gameStage === "preboard") return "Game 1 only";
  if (gameStage === "postboard") return "Post-board only";
  return "All game stages";
}

function deckInsightPlayReachSummary(row: DeckCardUsageRow): string {
  const reach = row.report?.playReach ?? { preboardGames: 0, postboardGames: 0, unknownStageGames: 0 };
  if (!row.trustGameStage) return `${reach.unknownStageGames} stage-unverified play-game${reach.unknownStageGames === 1 ? "" : "s"} · no G1/post-board split`;
  if (row.gameStage === "preboard") return `${reach.preboardGames} captured G1 play-game${reach.preboardGames === 1 ? "" : "s"} · ${row.eligibility.eligibleCompletedGames} snapshot-confirmed G1 list opportunities`;
  if (row.gameStage === "postboard") return `${reach.postboardGames} captured post-board play-game${reach.postboardGames === 1 ? "" : "s"} · ${row.eligibility.postboardListOpportunityGames} starting-list contexts`;
  return `${reach.preboardGames} G1 · ${reach.postboardGames} post-board${reach.unknownStageGames ? ` · ${reach.unknownStageGames} stage unknown` : ""}`;
}

function deckInsightPlayReachHeadline(row: DeckCardUsageRow): string {
  if (!row.trustGameStage) return `${row.capturedPlayGames} captured play-game${row.capturedPlayGames === 1 ? "" : "s"}, stage unverified`;
  if (row.gameStage === "preboard") return `${row.capturedPlayGames} captured G1 play-game${row.capturedPlayGames === 1 ? "" : "s"}`;
  if (row.gameStage === "postboard") return `${row.capturedPlayGames} captured post-board play-game${row.capturedPlayGames === 1 ? "" : "s"}`;
  return `${row.capturedPlayGames} captured play-game${row.capturedPlayGames === 1 ? "" : "s"} across all stages`;
}

function deckInsightPlayReachContext(row: DeckCardUsageRow): string {
  if (!row.trustGameStage) return "Game order is not trustworthy in this combined evidence, so RiftLite does not claim a Game 1 or post-board split.";
  if (row.gameStage === "preboard") return row.eligibility.eligibleCompletedGames
    ? `${row.eligibility.eligibleCompletedGames} Game 1 starting-list opportunities were snapshot-confirmed. Play and list counts are separate, not a rate.`
    : "No snapshot-confirmed Game 1 mainboard opportunity is available in this scope.";
  if (row.gameStage === "postboard") return row.eligibility.postboardListOpportunityGames
    ? `The card appeared in the starting list for ${row.eligibility.postboardListOpportunityGames} post-board game contexts, but RiftLite cannot prove it was boarded in or remained in the deck.`
    : "No post-board starting-list context is available in this scope.";
  return `Trusted plays are split by stage above; ${row.report?.playReach?.unknownStageGames ?? 0} additional play-game${(row.report?.playReach?.unknownStageGames ?? 0) === 1 ? " has" : "s have"} no trustworthy game number. Starting-list context is not a play-rate denominator.`;
}

function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function friendlyDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "date unknown" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function normalized(value: string | undefined): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
