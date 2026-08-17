import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  Check,
  ChevronRight,
  History,
  Lightbulb,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Star,
  ZoomIn,
  X
} from "lucide-react";
import type { SavedDeck } from "../shared/types";
import type { ActiveView } from "../shared/navigationModel";
import { normalizeLegendName } from "../shared/legendNames";
import {
  consumeLabTrainingHandoff,
  createLabTrainingHandoff,
  storeLabTrainingHandoff
} from "../shared/labTrainingHandoff";
import {
  mulliganLabLegendCodeFromSnapshot,
  mulliganLabLegendOptions,
  type MulliganLabRegistry
} from "../shared/mulliganLab";
import { emptyDeckMatchupGuide, normalizeDeckNotebook } from "../shared/deckNotebook";
import type { DeckGuideCardRef, DeckGuideSection } from "../shared/types";
import {
  adjustSideboardLabCardDisplayQuantity,
  parseSideboardLabApiResponse,
  parseSideboardLabTargetPackResponse,
  sideboardLabCardDisplayQuantity,
  sideboardLabEvidenceKey,
  sideboardLabDeckFingerprintFromSnapshot,
  sideboardLabPlanBalance,
  sideboardLabPlanShape,
  rankSideboardLabDailyDrills,
  sideboardLabScenarioUsefulness,
  sideboardLabVisibleChoiceFeedback,
  summarizeSideboardLabPlanFeedback,
  type SideboardLabApiDrill,
  type SideboardLabApiParseResult,
  type SideboardLabCardEvidence,
  type SideboardLabDeckCard,
  type SideboardLabDirection,
  type SideboardLabPlan,
  type SideboardLabTargetQuery
} from "../shared/sideboardLab";
import {
  SIDEBOARD_LAB_INTRO_LOCAL_STORAGE_KEY,
  parseSideboardLabIntroState,
  seenSideboardLabIntroState,
  serializeSideboardLabIntroState
} from "../shared/sideboardLabIntro";
import { SideboardLabIntro } from "./SideboardLabIntro";
import {
  SIDEBOARD_LAB_TRAINING_STORAGE_KEY,
  completeSideboardLabTrainingSession,
  parseSideboardLabTrainingState,
  recordSideboardLabTrainingAnswer,
  resetSideboardLabActiveRun,
  serializeSideboardLabTrainingState,
  sideboardLabMasterySummary,
  sideboardLabReviewProgressForAnswer,
  sideboardLabReviewAnswerIds,
  type SideboardLabTrainingState
} from "../shared/sideboardLabTraining";
import { labWilsonInterval, type LabDecisionConfidence } from "../shared/labTraining";
import "./styles/sideboard-lab.css";

type LoadState = "loading" | "ready" | "unavailable" | "error";
type Mode = "daily" | "active-deck" | "matchup" | "mixed" | "review";
type PriorResultFilter = "all" | "win" | "loss";
type DecisionConfidence = LabDecisionConfidence;

export interface SideboardLabViewProps {
  decks: SavedDeck[];
  activeDeckId: string;
  endpoint: string;
  registry: MulliganLabRegistry;
  onNavigate: (view: ActiveView, options?: { deckFocus?: "library" | "saved" | "prep" | "notebook" | "performance" }) => void;
}

const EMPTY_PLAN: SideboardLabPlan = { in: {}, out: {} };

export function SideboardLabView({ decks, activeDeckId, endpoint, registry, onNavigate }: SideboardLabViewProps) {
  const [trainingHandoff] = useState(() => {
    try {
      return consumeLabTrainingHandoff(window.localStorage, "sideboard");
    } catch {
      return null;
    }
  });
  const globalActiveDeck = activeDeckId ? decks.find((deck) => deck.id === activeDeckId) ?? null : null;
  const handoffDeck = trainingHandoff?.deckId ? decks.find((deck) => deck.id === trainingHandoff.deckId) ?? null : null;
  const handoffDeckFingerprint = useMemo(
    () => handoffDeck?.snapshotJson ? sideboardLabDeckFingerprintFromSnapshot(handoffDeck.snapshotJson, registry) : "",
    [handoffDeck?.snapshotJson, registry]
  );
  const activeDeck = handoffDeck && handoffDeckFingerprint ? handoffDeck : globalActiveDeck;
  const exactActiveFingerprint = useMemo(
    () => activeDeck?.snapshotJson ? sideboardLabDeckFingerprintFromSnapshot(activeDeck.snapshotJson, registry) : "",
    [activeDeck?.snapshotJson, registry]
  );
  const activeDeckLegendCode = useMemo(
    () => activeDeck?.snapshotJson ? mulliganLabLegendCodeFromSnapshot(activeDeck.snapshotJson, registry) : "",
    [activeDeck?.snapshotJson, registry]
  );
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [pack, setPack] = useState<SideboardLabApiParseResult | null>(null);
  const [loadMessage, setLoadMessage] = useState("");
  const [loadNonce, setLoadNonce] = useState(0);
  const [targetPack, setTargetPack] = useState<SideboardLabApiParseResult | null>(null);
  const [targetLoadState, setTargetLoadState] = useState<LoadState>("loading");
  const [targetLoadMessage, setTargetLoadMessage] = useState("");
  const [targetLoadNonce, setTargetLoadNonce] = useState(0);
  const [mode, setMode] = useState<Mode>(() => trainingHandoff ? handoffDeckFingerprint ? "active-deck" : "matchup" : "daily");
  const [reviewQueue, setReviewQueue] = useState<string[]>([]);
  const [playerLegend, setPlayerLegend] = useState(() => trainingHandoff?.playerLegend ?? "");
  const [opponentLegend, setOpponentLegend] = useState(() => trainingHandoff?.opponentLegend ?? "");
  const [priorResult, setPriorResult] = useState<PriorResultFilter>(() => trainingHandoff?.priorGameResult ?? "all");
  const [targetGameNumber, setTargetGameNumber] = useState<2 | 3>(2);
  const [roundIndex, setRoundIndex] = useState(0);
  const [plan, setPlan] = useState<SideboardLabPlan>(EMPTY_PLAN);
  const [submitted, setSubmitted] = useState(false);
  const [confidence, setConfidence] = useState<DecisionConfidence | null>(null);
  const [decisionStartedAt, setDecisionStartedAt] = useState(() => Date.now());
  const [runComplete, setRunComplete] = useState(false);
  const [trainingState, setTrainingState] = useState<SideboardLabTrainingState>(() => {
    try {
      return parseSideboardLabTrainingState(window.localStorage.getItem(SIDEBOARD_LAB_TRAINING_STORAGE_KEY));
    } catch {
      return parseSideboardLabTrainingState(null);
    }
  });
  const [decisions, setDecisions] = useState<Record<string, SideboardLabPlan>>({});
  const [search, setSearch] = useState("");
  const [zoomedCard, setZoomedCard] = useState<SideboardLabDeckCard | null>(null);
  const [prepSaveStatus, setPrepSaveStatus] = useState("");
  const [introOpen, setIntroOpen] = useState(() => {
    try {
      return parseSideboardLabIntroState(window.localStorage.getItem(SIDEBOARD_LAB_INTRO_LOCAL_STORAGE_KEY)).status === "pending";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setLoadState("loading");
    setLoadMessage("");
    void fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Community sideboard trainer returned ${response.status}.`);
        const payload = await response.json();
        if (!active) return;
        const parsed = parseSideboardLabApiResponse(payload, registry);
        setPack(parsed);
        if (parsed.status === "ready") setLoadState("ready");
        else if (parsed.status === "unavailable") setLoadState("unavailable");
        else {
          setLoadMessage("The community sideboard pack did not pass RiftLite's validation checks.");
          setLoadState("error");
        }
      })
      .catch((error) => {
        if (!active) return;
        setPack(null);
        setLoadMessage(controller.signal.aborted ? "The community sideboard trainer did not respond in time." : error instanceof Error ? error.message : "The community sideboard trainer could not be loaded.");
        setLoadState("error");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [endpoint, loadNonce, registry]);

  const registryLegendOptions = useMemo(() => mulliganLabLegendOptions(registry), [registry]);
  const playerOptions = useMemo(() => registryLegendOptions.map((card) => card.name), [registryLegendOptions]);
  const activeLegend = registryLegendOptions.find((card) => card.code === activeDeckLegendCode) ?? null;
  const selectedPlayerOption = registryLegendOptions.find((card) => card.name === playerLegend || normalizeLegendName(card.name) === normalizeLegendName(playerLegend)) ?? null;
  const effectivePlayer = selectedPlayerOption
    ? selectedPlayerOption.name
    : activeLegend?.name ?? playerOptions[0] ?? "";
  const opponentOptions = playerOptions;
  const selectedOpponentOption = registryLegendOptions.find((card) => card.name === opponentLegend || normalizeLegendName(card.name) === normalizeLegendName(opponentLegend)) ?? null;
  const effectiveOpponent = selectedOpponentOption?.name ?? opponentOptions[0] ?? "";
  const selectedPlayerLegend = registryLegendOptions.find((card) => card.name === effectivePlayer) ?? null;
  const selectedOpponentLegend = registryLegendOptions.find((card) => card.name === effectiveOpponent) ?? null;
  const reviewAnswer = reviewQueue.length
    ? trainingState.answers.find((answer) => answer.drillId === reviewQueue[0]) ?? null
    : null;
  const targetedMode = mode === "active-deck" || mode === "matchup" || (mode === "review" && Boolean(reviewAnswer));
  const targetPlayerLegendCode = mode === "active-deck"
    ? activeDeckLegendCode
    : mode === "review"
      ? reviewAnswer?.playerLegendCode ?? ""
      : selectedPlayerLegend?.code ?? "";
  const targetOpponentLegendCode = mode === "review"
    ? reviewAnswer?.opponentLegendCode ?? ""
    : selectedOpponentLegend?.code ?? "";
  const targetPriorResult = mode === "review" ? reviewAnswer?.priorGameResult ?? "all" : priorResult;
  const effectiveTargetGameNumber = mode === "review" ? reviewAnswer?.targetGameNumber ?? 2 : targetGameNumber;

  useEffect(() => {
    if (!targetedMode) {
      setTargetPack(null);
      setTargetLoadMessage("");
      return;
    }
    if (!targetPlayerLegendCode || (mode === "matchup" && !targetOpponentLegendCode)) {
      setTargetPack(null);
      setTargetLoadMessage(mode === "active-deck"
        ? "Choose an active deck with a registry-confirmed Legend first."
        : "Choose both registry-confirmed Legends first.");
      setTargetLoadState("unavailable");
      return;
    }
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    const url = new URL(`${endpoint.replace(/\/+$/, "")}/v2`);
    url.searchParams.set("playerLegend", targetPlayerLegendCode);
    if (targetOpponentLegendCode) url.searchParams.set("opponentLegend", targetOpponentLegendCode);
    if (mode === "active-deck" && exactActiveFingerprint) url.searchParams.set("deckFingerprint", exactActiveFingerprint);
    if (targetPriorResult !== "all") url.searchParams.set("priorGameResult", targetPriorResult);
    url.searchParams.set("targetGameNumber", String(effectiveTargetGameNumber));
    url.searchParams.set("limit", "12");
    setTargetLoadState("loading");
    setTargetLoadMessage("");
    setTargetPack(null);
    void fetch(url.toString(), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Full-corpus sideboard trainer returned ${response.status}.`);
        const payload = await response.json();
        if (!active) return;
        const parsed = parseSideboardLabTargetPackResponse(payload, registry);
        if (parsed.status === "ready" && parsed.targetQuery.requested.targetGameNumber !== effectiveTargetGameNumber) {
          setTargetPack(null);
          setTargetLoadMessage(`The community service has not published Game ${effectiveTargetGameNumber} practice packs yet.`);
          setTargetLoadState("unavailable");
          return;
        }
        setTargetPack(parsed);
        if (parsed.status === "ready") setTargetLoadState("ready");
        else if (parsed.status === "unavailable") setTargetLoadState("unavailable");
        else {
          setTargetLoadMessage("The targeted community sideboard pack did not pass RiftLite's validation checks.");
          setTargetLoadState("error");
        }
      })
      .catch((error) => {
        if (!active) return;
        setTargetPack(null);
        setTargetLoadMessage(controller.signal.aborted
          ? "The full-corpus sideboard trainer did not respond in time."
          : error instanceof Error ? error.message : "The full-corpus sideboard trainer could not be loaded.");
        setTargetLoadState("error");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [effectiveTargetGameNumber, endpoint, exactActiveFingerprint, mode, registry, targetLoadNonce, targetOpponentLegendCode, targetPlayerLegendCode, targetPriorResult, targetedMode]);

  const effectivePack = targetedMode ? targetPack : pack;
  const effectiveLoadState = targetedMode ? targetLoadState : loadState;
  const effectiveLoadMessage = targetedMode ? targetLoadMessage : loadMessage;
  const readyPack = effectivePack?.status === "ready" ? effectivePack : null;
  const drills = readyPack?.drills ?? [];
  const filteredDrills = useMemo(() => {
    const effectivePriorResult = mode === "review" ? targetPriorResult : priorResult;
    let result = effectivePriorResult === "all" ? drills : drills.filter((drill) => drill.priorGameResult === effectivePriorResult);
    if (mode === "daily") result = rankSideboardLabDailyDrills(result, 5);
    else if (mode === "active-deck" || mode === "matchup") result = result.slice(0, 12);
    else if (mode === "review") {
      const order = new Map(reviewQueue.map((id, index) => [id, index]));
      const exactReviews = result.filter((drill) => order.has(drill.id)).sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
      // A review must remain the exact saved scenario. Substituting a fresh
      // drill from the same matchup would present new evidence as a replay of
      // the player's earlier decision.
      result = exactReviews.slice(0, 5);
    }
    return result;
  }, [drills, mode, priorResult, reviewQueue, targetPriorResult]);
  const safeRoundIndex = filteredDrills.length ? roundIndex % filteredDrills.length : 0;
  const drill = filteredDrills[safeRoundIndex] ?? null;
  const drillUsefulness = drill ? sideboardLabScenarioUsefulness(drill) : null;
  const drillKey = drill ? `${mode}:${drill.id}` : `${mode}:empty`;
  const runKey = readyPack
    ? [
        "sideboard-lab-run-v1",
        readyPack.generatedAt,
        mode,
        readyPack.targetQuery?.requested.playerLegend ?? "",
        readyPack.targetQuery?.requested.opponentLegend ?? "",
        readyPack.targetQuery?.requested.deckFingerprint ?? "",
        readyPack.targetQuery?.requested.priorGameResult ?? "",
        readyPack.targetQuery?.requested.targetGameNumber ?? 2,
        readyPack.targetQuery?.resolved.scope ?? "",
        mode === "review" ? targetPriorResult : priorResult,
        filteredDrills.map((item) => item.id).join(",")
      ].join("|")
    : "";
  const evidenceByKey = useMemo(() => new Map(drill?.cardEvidence.map((item) => [sideboardLabEvidenceKey(item.direction, item.cardCode), item]) ?? []), [drill]);
  const identityByCode = useMemo(() => new Map(drill?.cardEvidence.map((item) => [item.cardCode, item.identityCode]) ?? []), [drill]);
  const balance = sideboardLabPlanBalance(plan, identityByCode);

  useEffect(() => {
    if (!runKey) {
      setDecisions({});
      return;
    }
    const savedDecisions = trainingState.activeRunKey === runKey
      ? { ...trainingState.activeDecisions }
      : {};
    const firstUnanswered = filteredDrills.findIndex((item) => !savedDecisions[item.id]);
    setDecisions(savedDecisions);
    setRoundIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
    setRunComplete(Boolean(filteredDrills.length) && firstUnanswered < 0);
  }, [runKey]);

  useEffect(() => {
    setRoundIndex(0);
    setPlan(EMPTY_PLAN);
    setSubmitted(false);
    setConfidence(null);
    setDecisionStartedAt(Date.now());
    setRunComplete(false);
  }, [effectiveOpponent, effectivePlayer, mode, priorResult, targetGameNumber]);
  useEffect(() => {
    const resumed = drill ? decisions[drill.id] : null;
    setPlan(resumed ? { in: { ...resumed.in }, out: { ...resumed.out } } : EMPTY_PLAN);
    setSubmitted(Boolean(resumed));
    setConfidence(null);
    setDecisionStartedAt(Date.now());
    setSearch("");
    setPrepSaveStatus("");
  }, [decisions, drillKey]);

  function adjust(direction: SideboardLabDirection, card: SideboardLabDeckCard, delta: number) {
    if (submitted) return;
    setPlan((current) => adjustSideboardLabCardDisplayQuantity(current, direction, card.code, delta, card.count, identityByCode));
  }

  function lockPlan() {
    if (!drill || submitted || !balance.legal) return;
    const decision = { in: { ...plan.in }, out: { ...plan.out } };
    const summary = summarizeSideboardLabPlanFeedback(drill.cardEvidence, decision);
    setDecisions((current) => ({ ...current, [drill.id]: decision }));
    const answeredAt = new Date().toISOString();
    const answerBase = {
      drillId: drill.id,
      answeredAt,
      playerLegendCode: drill.playerLegend.code,
      opponentLegendCode: drill.opponentLegend.code,
      priorGameResult: drill.priorGameResult,
      targetGameNumber: drill.context?.targetGameNumber ?? 2,
      confidence,
      evidenceTier: drillUsefulness?.kind ?? "explore" as const,
      decisionMs: Math.max(0, Date.now() - decisionStartedAt),
      plan: decision,
      summary: {
        aligned: summary.aligned,
        different: summary.different,
        ungraded: summary.ungraded,
        notableAlternatives: summary.notableAlternatives,
        noChanges: summary.noChanges
      }
    };
    const answer = {
      ...answerBase,
      review: sideboardLabReviewProgressForAnswer(trainingState, answerBase, mode === "review"),
    };
    updateTrainingState(recordSideboardLabTrainingAnswer(trainingState, answer, runKey));
    setSubmitted(true);
  }

  function nextScenario() {
    if (!filteredDrills.length) return;
    if (safeRoundIndex >= filteredDrills.length - 1) {
      const completed = filteredDrills.flatMap((item) => {
        const decision = decisions[item.id];
        return decision ? [summarizeSideboardLabPlanFeedback(item.cardEvidence, decision)] : [];
      });
      const completedTrainingState = completeSideboardLabTrainingSession(trainingState, {
        id: `sideboard:${mode}:${readyPack?.generatedAt ?? "local"}:${Date.now()}`,
        completedAt: new Date().toISOString(),
        drillIds: filteredDrills.filter((item) => decisions[item.id]).map((item) => item.id),
        aligned: completed.reduce((sum, item) => sum + item.aligned, 0),
        different: completed.reduce((sum, item) => sum + item.different, 0),
        notableAlternatives: completed.reduce((sum, item) => sum + item.notableAlternatives, 0)
      });
      updateTrainingState(completedTrainingState);
      if (mode === "review") {
        const completedIds = new Set(filteredDrills.map((item) => item.id));
        const remaining = reviewQueue.filter((id) => !completedIds.has(id));
        if (remaining.length) {
          setReviewQueue(remaining);
          setDecisions({});
          setRoundIndex(0);
          setPlan(EMPTY_PLAN);
          setSubmitted(false);
          setConfidence(null);
          setDecisionStartedAt(Date.now());
          setSearch("");
          setRunComplete(false);
          return;
        }
      }
      setRunComplete(true);
      return;
    }
    setRoundIndex((current) => current + 1);
    setPlan(EMPTY_PLAN);
    setSubmitted(false);
    setConfidence(null);
    setDecisionStartedAt(Date.now());
    setSearch("");
  }

  function restartRun() {
    setDecisions({});
    updateTrainingState(resetSideboardLabActiveRun(trainingState));
    setRoundIndex(0);
    setPlan(EMPTY_PLAN);
    setSubmitted(false);
    setConfidence(null);
    setDecisionStartedAt(Date.now());
    setSearch("");
    setRunComplete(false);
  }

  function updateTrainingState(next: SideboardLabTrainingState) {
    setTrainingState(next);
    try {
      window.localStorage.setItem(SIDEBOARD_LAB_TRAINING_STORAGE_KEY, serializeSideboardLabTrainingState(next));
    } catch {
      // Training remains available for this session if local storage is unavailable.
    }
  }

  function openReviewRun() {
    setReviewQueue(sideboardLabReviewAnswerIds(trainingState));
    setMode("review");
  }

  function skipUnavailableReviewItem() {
    const remaining = reviewQueue.slice(1);
    setReviewQueue(remaining);
    setDecisions({});
    updateTrainingState(resetSideboardLabActiveRun(trainingState));
    setRoundIndex(0);
    setPlan(EMPTY_PLAN);
    setSubmitted(false);
    setConfidence(null);
    setDecisionStartedAt(Date.now());
    setSearch("");
    setRunComplete(false);
    if (!remaining.length) setMode("daily");
  }

  async function addPlanToMatchupPrep() {
    if (!drill || !activeDeck || exactActiveFingerprint !== drill.deck.fingerprint) {
      setPrepSaveStatus("Set this exact registered deck as active before adding its plan to Matchup Prep.");
      return;
    }
    if (balance.cardsIn === 0 && balance.cardsOut === 0) {
      setPrepSaveStatus("There are no swaps to add to Matchup Prep.");
      return;
    }
    setPrepSaveStatus("Adding this plan to Matchup Prep...");
    try {
      const current = normalizeDeckNotebook(activeDeck.id, await window.riftlite.getDeckNotebook(activeDeck.id));
      const legendKey = drill.opponentLegend.name.trim().toLocaleLowerCase();
      const existing = current.matchupGuides.find((guide) => guide.legend.trim().toLocaleLowerCase() === legendKey);
      const guide = existing ?? emptyDeckMatchupGuide(drill.opponentLegend.name);
      const now = new Date().toISOString();
      const nextGuide = {
        ...guide,
        legend: drill.opponentLegend.name,
        updatedAt: now,
        sideboard: {
          ...guide.sideboard,
          in: mergePrepSection(guide.sideboard.in, selectedPlanCards(drill.deck.sideboard, plan.in)),
          out: mergePrepSection(guide.sideboard.out, selectedPlanCards(drill.deck.mainDeck, plan.out))
        }
      };
      const next = {
        ...current,
        updatedAt: now,
        matchupGuides: [...current.matchupGuides.filter((item) => item.id !== nextGuide.id && item.legend.trim().toLocaleLowerCase() !== legendKey), nextGuide]
      };
      await window.riftlite.saveDeckNotebook(activeDeck.id, next);
      setPrepSaveStatus(`Added this plan to ${drill.opponentLegend.name} Matchup Prep.`);
    } catch (error) {
      setPrepSaveStatus(error instanceof Error ? error.message : "The plan could not be added to Matchup Prep.");
    }
  }

  function continueToMulliganLab() {
    if (!drill) return;
    const contextualDeckId = activeDeck && exactActiveFingerprint === drill.deck.fingerprint ? activeDeck.id : "";
    try {
      storeLabTrainingHandoff(window.localStorage, createLabTrainingHandoff({
        destination: "mulligan",
        source: "sideboard-complete",
        playerLegend: drill.playerLegend.name,
        opponentLegend: drill.opponentLegend.name,
        deckId: contextualDeckId,
        format: null,
        wentFirst: null,
        priorGameResult: null
      }));
    } catch {
      // Navigation remains available when local storage is blocked.
    }
    onNavigate("mulligan-lab");
  }

  function finishIntro() {
    try {
      window.localStorage.setItem(SIDEBOARD_LAB_INTRO_LOCAL_STORAGE_KEY, serializeSideboardLabIntroState(seenSideboardLabIntroState()));
    } catch {
      // The guide remains dismissible for this session when storage is unavailable.
    }
    setIntroOpen(false);
  }

  const answered = filteredDrills.filter((item) => decisions[item.id]).length;
  const reviewItems = sideboardLabReviewAnswerIds(trainingState).length;
  const mastery = sideboardLabMasterySummary(trainingState);
  const generatedLabel = readyPack?.generatedAt ? new Date(readyPack.generatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Waiting for first pack";
  const historyComplete = readyPack?.coveragePolicy === "all-available-history" && readyPack.includedPeriods.includes("preseason") && readyPack.includedPeriods.includes("current-season") && readyPack.backfillComplete && !readyPack.coverageTruncated;
  const targetQuery = readyPack?.targetQuery;
  const formatPolicy = readyPack?.formatPolicy;

  return (
    <section className="dashboard-page sideboard-lab-page">
      <section className="sideboard-lab-hero">
        <div><span className="eyebrow"><Sparkles size={13} /> RiftLite community training</span><h2>Sideboard Lab</h2><p>Enter a real Game 2 situation, build your swap plan, then reveal how community patterns compare.</p></div>
        <div className="sideboard-lab-hero-actions">
          <div className="sideboard-lab-freshness" data-state={effectiveLoadState}><RefreshCw size={17} /><span><small>{targetedMode ? "Full-corpus practice pack" : "Rotating daily pack"}</small><strong>{effectiveLoadState === "loading" ? "Checking..." : generatedLabel}</strong></span></div>
          <button type="button" className="secondary sideboard-lab-help-button" aria-haspopup="dialog" aria-expanded={introOpen} aria-controls="sideboard-lab-intro-dialog" onClick={() => setIntroOpen(true)}><Lightbulb size={15} /> How it works</button>
        </div>
      </section>

      <section className="sideboard-lab-mode-bar" aria-label="Sideboard training modes">
        <button type="button" data-active={mode === "daily"} aria-pressed={mode === "daily"} onClick={() => setMode("daily")}><Star size={15} /> Daily 5</button>
        <button type="button" data-active={mode === "active-deck"} aria-pressed={mode === "active-deck"} onClick={() => setMode("active-deck")}><ArrowLeftRight size={15} /> My active deck</button>
        <button type="button" data-active={mode === "matchup"} aria-pressed={mode === "matchup"} onClick={() => setMode("matchup")}><BarChart3 size={15} /> Choose matchup</button>
        <button type="button" data-active={mode === "mixed"} aria-pressed={mode === "mixed"} onClick={() => setMode("mixed")}><Sparkles size={15} /> Mixed practice</button>
        <button type="button" data-active={mode === "review"} aria-pressed={mode === "review"} disabled={!sideboardLabReviewAnswerIds(trainingState).length} onClick={openReviewRun}><RefreshCw size={15} /> Review items</button>
      </section>

      <section className="sideboard-lab-filter-bar">
        <label>My Legend<select value={mode === "matchup" ? effectivePlayer : ""} disabled={mode !== "matchup" || !playerOptions.length} onChange={(event) => { setPlayerLegend(event.target.value); setOpponentLegend(""); }}>
          {mode === "daily" ? <option value="">Daily mix</option> : mode === "active-deck" ? <option value="">Exact active deck</option> : mode === "mixed" ? <option value="">Mixed Legends</option> : mode === "review" ? <option value="">Local review queue</option> : null}
          {playerOptions.map((legend) => <option value={legend} key={legend}>{legend}</option>)}
        </select></label>
        <label>Opponent<select value={mode === "matchup" || mode === "active-deck" ? effectiveOpponent : ""} disabled={(mode !== "matchup" && mode !== "active-deck") || !opponentOptions.length} onChange={(event) => setOpponentLegend(event.target.value)}>
          {mode === "daily" ? <option value="">Daily mix</option> : mode === "mixed" ? <option value="">Mixed opponents</option> : mode === "review" ? <option value="">Review matchups</option> : null}
          {opponentOptions.map((legend) => <option value={legend} key={legend}>{legend}</option>)}
        </select></label>
        <label>Sideboard window<select value={effectiveTargetGameNumber} disabled={mode === "daily" || mode === "mixed" || mode === "review"} onChange={(event) => setTargetGameNumber(event.target.value === "3" ? 3 : 2)}><option value={2}>Before Game 2</option><option value={3}>Before Game 3</option></select></label>
        <label>Previous result<select value={mode === "review" ? reviewAnswer?.priorGameResult ?? "all" : priorResult} disabled={mode === "review"} onChange={(event) => setPriorResult(event.target.value as PriorResultFilter)}><option value="all">Win or loss</option><option value="loss">After a loss</option><option value="win">After a win</option></select></label>
        <div className="sideboard-lab-source-note"><Shield size={15} /> Finalized Atlas Game {effectiveTargetGameNumber} windows · exact pre-window deck · no sampled plan exposed</div>
      </section>

      {trainingHandoff ? <section className="sideboard-lab-context-banner" aria-live="polite"><Sparkles size={16} /><div><strong>Match context loaded</strong><span>{normalizeLegendName(trainingHandoff.playerLegend)} vs {normalizeLegendName(trainingHandoff.opponentLegend)}{trainingHandoff.priorGameResult ? ` · after a Game 1 ${trainingHandoff.priorGameResult}` : ""}{handoffDeckFingerprint ? " · exact registered deck" : " · matchup practice"}</span></div></section> : null}

      {effectiveLoadState !== "ready" ? (
        mode === "review" && reviewAnswer
          ? <SideboardReviewUnavailable state={effectiveLoadState} message={effectiveLoadMessage} remaining={reviewQueue.length} onRetry={() => setTargetLoadNonce((value) => value + 1)} onSkip={skipUnavailableReviewItem} />
          : <SideboardUnavailable state={effectiveLoadState} message={effectiveLoadMessage} reason={effectivePack?.reason} onRetry={() => targetedMode ? setTargetLoadNonce((value) => value + 1) : setLoadNonce((value) => value + 1)} />
      ) : !drill ? (
        mode === "review" && reviewAnswer
          ? <SideboardReviewUnavailable state="unavailable" message="That exact saved drill is not present in the current full-corpus practice pack." remaining={reviewQueue.length} onRetry={() => setTargetLoadNonce((value) => value + 1)} onSkip={skipUnavailableReviewItem} />
          : <section className="sideboard-lab-empty-panel"><span className="sideboard-lab-empty-icon"><ArrowLeftRight size={30} /></span><div><span className="eyebrow">No qualifying cohort</span><h3>{mode === "review" ? "No saved review items remain in this run." : `No community sideboard scenario matches these filters${targetedMode ? " in the full indexed corpus" : " in today's pack"}.`}</h3><p>{mode === "review" ? "Review runs use only the exact scenario you previously answered; RiftLite never fills an empty queue with unrelated practice." : `RiftLite publishes only exact, finalized Game ${effectiveTargetGameNumber} plans with a registry-confirmed 40-card pre-window deck, registered sideboard, and opportunity-aware evidence.`}</p></div>{mode === "active-deck" && !activeDeck ? <button type="button" className="secondary" onClick={() => onNavigate("decks", { deckFocus: "saved" })}>Choose an active deck</button> : <button type="button" className="secondary" onClick={() => { setMode("daily"); setPriorResult("all"); setTargetGameNumber(2); }}>Try Daily 5</button>}</section>
      ) : runComplete ? (
        <SideboardRunComplete drills={filteredDrills} decisions={decisions} onRestart={restartRun} onOpenPrep={() => onNavigate("decks", { deckFocus: "prep" })} onPracticeMulligan={continueToMulliganLab} />
      ) : (
        <section className="sideboard-lab-workspace">
          <main className="sideboard-lab-table">
            <div className="sideboard-lab-stage-track" aria-label={submitted ? "Challenge stage 3 of 3: reveal patterns" : "Challenge stage 2 of 3: build swaps"}>
              <span data-complete="true"><b>1</b><em>Scout matchup</em></span>
              <i />
              <span data-active={!submitted} data-complete={submitted}><b>2</b><em>Build swaps</em></span>
              <i />
              <span data-active={submitted}><b>3</b><em>Reveal patterns</em></span>
            </div>
            <header className="sideboard-lab-round-header">
              <div><span className="eyebrow">Round {safeRoundIndex + 1} of {filteredDrills.length} · Game {drill.context?.targetGameNumber ?? 2} · {drillUsefulness?.kind === "explore" ? "Explore data" : drillUsefulness?.kind === "guided" ? "General guidance" : "Matchup challenge"}</span><h3>{submitted ? "Pattern reveal" : drillUsefulness?.kind === "explore" ? "Explore an early community cohort" : "Your sideboard challenge"}</h3><p>{submitted ? "Your locked plan stays visible while each card is compared with reliable community tendencies." : drillUsefulness?.kind === "explore" ? "Build the line you would take. This scenario has useful descriptive data, but no robust move recommendation yet." : "Subtract cards from the Main Deck, add replacements from the Sideboard, then reveal a balanced plan."}</p></div>
              <div className="sideboard-lab-matchup" aria-label={`${drill.playerLegend.name} versus ${drill.opponentLegend.name}`}><img src={drill.playerLegend.imageUrl} alt="" /><span><strong>{drill.playerLegend.name}</strong><small>{drill.priorGameResult === "win" ? `Won Game ${(drill.context?.targetGameNumber ?? 2) - 1}` : `Lost Game ${(drill.context?.targetGameNumber ?? 2) - 1}`}</small></span><b>vs</b><img src={drill.opponentLegend.imageUrl} alt="" /><span><strong>{drill.opponentLegend.name}</strong><small>Opponent</small></span></div>
            </header>

            {targetQuery ? <SideboardTargetScope query={targetQuery} /> : null}

            <label className="sideboard-lab-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search registered cards..." /></label>
            <SideboardPlanDock drill={drill} plan={plan} balance={balance} submitted={submitted} />
            {drill.deck.chosenChampionCode ? <SideboardChampionContext drill={drill} plan={plan} /> : null}
            <div className="sideboard-lab-card-columns">
              <SideboardCardColumn title="Main Deck" subtitle="Press − to take copies out" direction="out" cards={drill.deck.mainDeck} chosenChampionCode={drill.deck.chosenChampionCode} selection={plan.out} submitted={submitted} search={search} evidenceByKey={evidenceByKey} onAdjust={adjust} onZoom={setZoomedCard} />
              <SideboardCardColumn title="Sideboard" subtitle="Press + to bring copies in" direction="in" cards={drill.deck.sideboard} chosenChampionCode={drill.deck.chosenChampionCode} selection={plan.in} submitted={submitted} search={search} evidenceByKey={evidenceByKey} onAdjust={adjust} onZoom={setZoomedCard} />
            </div>

            {!submitted ? <SideboardDecisionBar balance={balance} confidence={confidence} onConfidence={setConfidence} onClear={() => setPlan(EMPTY_PLAN)} onLock={lockPlan} /> : <SideboardReveal drill={drill} plan={plan} onNext={nextScenario} onOpenPrep={() => onNavigate("decks", { deckFocus: "prep" })} onSavePrep={() => void addPlanToMatchupPrep()} canSavePrep={balance.cardsIn > 0} saveStatus={prepSaveStatus} />}
          </main>
          <aside className="sideboard-lab-session-rail">
            <section className="sideboard-lab-run-card"><span className="eyebrow"><Star size={12} /> Training run</span><strong>{answered} / {filteredDrills.length}</strong><p>challenges completed in this pack</p><div className="sideboard-lab-progress" role="progressbar" aria-label="Sideboard challenges completed" aria-valuemin={0} aria-valuemax={filteredDrills.length} aria-valuenow={answered}><i style={{ width: `${filteredDrills.length ? answered / filteredDrills.length * 100 : 0}%` }} /></div><div className="sideboard-lab-round-pips" aria-hidden="true">{filteredDrills.map((item, index) => <i key={item.id} data-done={Boolean(decisions[item.id])} data-current={index === safeRoundIndex} />)}</div><small>{trainingState.sessions.length} completed run{trainingState.sessions.length === 1 ? "" : "s"} stored on this device · {reviewItems} review item{reviewItems === 1 ? "" : "s"}</small></section>
            <section className="sideboard-lab-mastery-card"><span className="eyebrow"><Star size={12} /> Matchup mastery</span><div><span><strong>{mastery.contextsPractised}</strong><small>Practised</small></span><span><strong>{mastery.masteredContexts}</strong><small>Mastered</small></span><span><strong>{mastery.reviewDue}</strong><small>Due</small></span></div><small>{mastery.uncertainContexts} context{mastery.uncertainContexts === 1 ? "" : "s"} marked Unsure or Guess. Progress rewards deliberate practice, not agreement with weak evidence.</small></section>
            <section><span className="eyebrow">Exact matchup sample</span><strong>{drill.evidence.decisions} decisions</strong><p>{drill.evidence.players} anonymous players · {drill.playerLegend.name} into {drill.opponentLegend.name}</p><span className="sideboard-lab-evidence-status" data-status={drillUsefulness?.kind === "explore" ? "early" : drill.evidence.status}>{drillUsefulness?.kind === "challenge" ? `${drillUsefulness.exactMatchupSignals} actionable matchup signal${drillUsefulness.exactMatchupSignals === 1 ? "" : "s"}` : drillUsefulness?.kind === "guided" ? `${drillUsefulness.actionableSignals} broader community signal${drillUsefulness.actionableSignals === 1 ? "" : "s"}` : "Explore data · no robust move signal"}</span><small>{historyComplete ? "All available pre-season and current-season history indexed." : "All-history backfill is still in progress."}</small><small>Percentages use opportunities where each card was actually registered in the relevant zone.</small>{drill.context?.nextInitiative && drill.context.nextInitiative !== "unknown" ? <small>Game 2 initiative: going {drill.context.nextInitiative}.</small> : null}{formatPolicy ? <small>Current reference: 40-card Main Deck · sideboard up to {formatPolicy.currentReference.sideboardMaximum} · one-for-one swaps · Chosen Champion may change. Historical observations are structurally validated because their rules epoch is unknown.</small> : null}</section>
            <section className="sideboard-lab-trust-note"><Lightbulb size={18} /><div><strong>Patterns, not prescriptions</strong><p>Deck version, Game 1 information, player skill, and the rest of the plan all matter. RiftLite never turns card tendencies into a whole-plan verdict.</p></div></section>
          </aside>
        </section>
      )}
      {introOpen ? <SideboardLabIntro onStart={finishIntro} onDismiss={finishIntro} /> : null}
      {zoomedCard ? <SideboardCardZoom card={zoomedCard} onClose={() => setZoomedCard(null)} /> : null}
    </section>
  );
}

function SideboardPlanDock({ drill, plan, balance, submitted }: {
  drill: SideboardLabApiDrill;
  plan: SideboardLabPlan;
  balance: ReturnType<typeof sideboardLabPlanBalance>;
  submitted: boolean;
}) {
  const cardsOut = selectedPlanCards(drill.deck.mainDeck, plan.out);
  const cardsIn = selectedPlanCards(drill.deck.sideboard, plan.in);
  const ready = balance.status === "balanced" || balance.status === "empty";
  return <section className="sideboard-lab-plan-dock" data-status={balance.status} data-submitted={submitted}>
    <PlanLane label="Taking out" direction="out" cards={cardsOut} emptyLabel="Subtract from your Main Deck" />
    <div className="sideboard-lab-plan-core" data-ready={ready}>
      <span><b>{balance.cardsOut}</b><small>OUT</small></span>
      <i><ArrowLeftRight size={18} /></i>
      <span><b>{balance.cardsIn}</b><small>IN</small></span>
      <strong>{submitted ? "Plan locked" : balance.status === "empty" ? "No changes" : balance.status === "balanced" ? "Plan ready" : balance.status === "needs-in" ? `${Math.abs(balance.difference)} more IN` : balance.status === "needs-out" ? `${balance.difference} more OUT` : "Resolve overlap"}</strong>
    </div>
    <PlanLane label="Bringing in" direction="in" cards={cardsIn} emptyLabel="Add from your Sideboard" />
  </section>;
}

function PlanLane({ label, direction, cards, emptyLabel }: {
  label: string;
  direction: SideboardLabDirection;
  cards: Array<{ card: SideboardLabDeckCard; count: number }>;
  emptyLabel: string;
}) {
  return <div className="sideboard-lab-plan-lane" data-direction={direction}><small>{label}</small><div>
    {cards.length ? cards.map(({ card, count }) => <span key={card.code} title={`${count} × ${card.name}`}><img src={card.imageUrl} alt="" /><b>{count}</b><em>{card.name}</em></span>) : <p>{emptyLabel}</p>}
  </div></div>;
}

function selectedPlanCards(cards: SideboardLabDeckCard[], selection: Record<string, number>) {
  return cards.flatMap((card) => {
    const count = selection[card.code] ?? 0;
    return count > 0 ? [{ card, count }] : [];
  });
}

function SideboardChampionContext({ drill, plan }: { drill: SideboardLabApiDrill; plan: SideboardLabPlan }) {
  const chosen = drill.deck.mainDeck.find((card) => card.code === drill.deck.chosenChampionCode);
  if (!chosen) return null;
  const leaving = (plan.out[chosen.code] ?? 0) > 0;
  const incomingChampions = drill.deck.sideboard.filter((card) => card.supertype?.toLowerCase() === "champion" && (plan.in[card.code] ?? 0) > 0);
  return <section className="sideboard-lab-champion-context" data-changing={leaving}>
    <img src={chosen.imageUrl} alt="" />
    <div><span className="eyebrow">Chosen Champion</span><strong>{chosen.name}</strong><small>{leaving ? incomingChampions.length ? `Champion change prepared: ${incomingChampions.map((card) => card.name).join(", ")}` : "Chosen Champion is leaving. Remember to designate a legal replacement." : "Stays designated unless your plan changes it."}</small></div>
  </section>;
}

function mergePrepSection(section: DeckGuideSection, cards: Array<{ card: SideboardLabDeckCard; count: number }>): DeckGuideSection {
  const next = new Map<string, DeckGuideCardRef>();
  for (const card of section.cards) next.set((card.cardId || card.cardKey).trim().toUpperCase(), card);
  for (const { card, count } of cards) {
    next.set(card.code, {
      id: `sideboard-lab:${card.code}`,
      cardKey: card.code,
      cardName: card.name,
      cardId: card.code,
      imageUrl: card.imageUrl,
      qty: count,
      note: "Added from Sideboard Lab"
    });
  }
  return { ...section, cards: [...next.values()] };
}

function SideboardCardColumn({ title, subtitle, direction, cards, chosenChampionCode, selection, submitted, search, evidenceByKey, onAdjust, onZoom }: {
  title: string;
  subtitle: string;
  direction: SideboardLabDirection;
  cards: SideboardLabDeckCard[];
  chosenChampionCode?: string;
  selection: Record<string, number>;
  submitted: boolean;
  search: string;
  evidenceByKey: ReadonlyMap<string, SideboardLabCardEvidence>;
  onAdjust: (direction: SideboardLabDirection, card: SideboardLabDeckCard, delta: number) => void;
  onZoom: (card: SideboardLabDeckCard) => void;
}) {
  const needle = search.trim().toLocaleLowerCase();
  const visible = cards.filter((card) => !needle || `${card.name} ${card.code}`.toLocaleLowerCase().includes(needle));
  const movedTotal = Object.values(selection).reduce((sum, value) => sum + value, 0);
  const registeredTotal = cards.reduce((sum, card) => sum + card.count, 0);
  return <section className="sideboard-lab-card-column" data-direction={direction}><header><div><span className="sideboard-lab-zone-mark">{direction === "out" ? "OUT" : "IN"}</span><div><h4>{title}</h4><p>{subtitle}</p></div></div><strong>{direction === "out" ? `${registeredTotal - movedTotal} remaining` : `${movedTotal} queued in`}</strong></header><div className="sideboard-lab-card-grid">
    {visible.map((card) => {
      const plannedCount = selection[card.code] ?? 0;
      const displayCount = sideboardLabCardDisplayQuantity(direction, card.count, plannedCount);
      const evidence = evidenceByKey.get(sideboardLabEvidenceKey(direction, card.code));
      const feedback = evidence ? sideboardLabVisibleChoiceFeedback(evidence, plannedCount > 0) : "not-evaluated";
      const minusLabel = direction === "out" ? `Take one ${card.name} out of the main deck; ${displayCount} currently remain` : `Remove one ${card.name} from the bring-in plan; ${displayCount} currently selected`;
      const plusLabel = direction === "out" ? `Return one ${card.name} to the main deck; ${displayCount} currently remain` : `Bring one ${card.name} in from the sideboard; ${displayCount} currently selected`;
      return <article className="sideboard-lab-card" data-selected={plannedCount > 0} data-fully-moved={plannedCount === card.count} data-submitted={submitted} data-feedback={submitted ? feedback : undefined} key={`${direction}:${card.code}`}>
        <button type="button" className="sideboard-lab-card-art" onClick={() => onZoom(card)} aria-label={`Enlarge ${card.name}`}><img src={card.imageUrl} alt={card.name} draggable={false} />{plannedCount > 0 ? <span>{plannedCount} {direction.toUpperCase()}</span> : null}<i aria-hidden="true"><ZoomIn size={13} /></i></button>
        <div className="sideboard-lab-card-copy"><strong>{card.name}</strong><small>{card.code} · {card.count} registered{card.code === chosenChampionCode ? " · Chosen Champion" : card.supertype?.trim().toLocaleLowerCase() === "champion" ? " · Champion option" : ""}</small>
          <div className="sideboard-lab-card-adjust" data-direction={direction}><button type="button" disabled={submitted || (direction === "out" ? displayCount <= 0 : plannedCount <= 0)} onClick={() => onAdjust(direction, card, -1)} aria-label={minusLabel}><Minus size={16} /></button><span><b>{displayCount}</b><small>{direction === "out" ? "remaining" : "to bring in"}</small></span><button type="button" disabled={submitted || (direction === "out" ? plannedCount <= 0 : plannedCount >= card.count)} onClick={() => onAdjust(direction, card, 1)} aria-label={plusLabel}><Plus size={16} /></button></div>
          {submitted && evidence ? <SideboardCardEvidenceView evidence={evidence} feedback={feedback} plannedCount={plannedCount} /> : null}
        </div>
      </article>;
    })}
    {!visible.length ? <p className="muted">No registered cards match that search.</p> : null}
  </div></section>;
}

function SideboardCardZoom({ card, onClose }: { card: SideboardLabDeckCard; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);
  return <div className="sideboard-lab-card-zoom-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="sideboard-lab-card-zoom" role="dialog" aria-modal="true" aria-labelledby="sideboard-lab-card-zoom-title">
      <header><div><span className="eyebrow">Registered card</span><h3 id="sideboard-lab-card-zoom-title">{card.name}</h3><p>{card.code} · {card.type}{card.costEnergy !== null ? ` · ${card.costEnergy} Energy` : ""}{card.costPower !== null ? ` · ${card.costPower} Power` : ""}</p></div><button type="button" ref={closeRef} onClick={onClose} aria-label="Close enlarged card"><X size={18} /></button></header>
      <img src={card.imageUrl} alt={`${card.name} full card`} draggable={false} />
      <small>Official packaged card artwork. Press Escape to close.</small>
    </section>
  </div>;
}

function SideboardTargetScope({ query }: { query: SideboardLabTargetQuery }) {
  const label = query.resolved.scope === "exact-deck"
    ? "Exact active-deck exercises"
    : query.resolved.scope === "matchup"
      ? "Full-corpus matchup exercises"
      : "Legend-wide fallback exercises";
  const detail = query.resolved.scope === "exact-deck"
    ? "The scenario uses the exact registered deck. Card tendencies still pool the labelled matchup or Legend evidence cohort."
    : query.fallbackReason === "deck-not-observed"
      ? "That exact deck does not yet have a publishable cohort, so RiftLite widened only the exercise surface to this matchup."
      : query.fallbackReason === "insufficient-private-cohort"
        ? "The exact cohort stays private below its contributor gate, so RiftLite uses the nearest publishable matchup scope."
        : query.fallbackReason === "matchup-not-observed"
          ? "This matchup is not yet publishable, so the practice pack is clearly labelled as Legend-wide context."
          : "This pack was resolved against all indexed community Sideboard Lab facts.";
  return <section className="sideboard-lab-target-scope" data-scope={query.resolved.scope}>
    <Shield size={16} />
    <div><strong>{label}</strong><small>{detail}</small></div>
  </section>;
}

function SideboardCardEvidenceView({ evidence, feedback, plannedCount }: { evidence: SideboardLabCardEvidence; feedback: ReturnType<typeof sideboardLabVisibleChoiceFeedback>; plannedCount: number }) {
  const selectedPercent = Math.round(evidence.selectionRate * 100);
  const guidancePercent = Math.round(evidence.guidanceSelectionRate * 100);
  const confidenceRange = labWilsonInterval(evidence.guidanceSelected, evidence.guidancePlayers);
  const label = evidence.direction === "in" ? "brought in" : "taken out";
  const preseason = evidence.periods?.preseason;
  const currentSeason = evidence.periods?.currentSeason;
  const periodShift = preseason?.evidenceStatus === "robust" && currentSeason?.evidenceStatus === "robust"
    ? currentSeason.guidanceSelectionRate - preseason.guidanceSelectionRate
    : null;
  return <div className="sideboard-lab-card-evidence">
    <span data-feedback={feedback}>{feedback === "aligned" ? <Check size={13} /> : feedback === "conflicts" || feedback === "missed" ? <X size={13} /> : <BarChart3 size={13} />}{feedback === "aligned" ? "Chosen move matches the community pattern" : feedback === "conflicts" ? "Chosen move differs from the community pattern" : feedback === "missed" ? "Notable community alternative" : feedback === "developing" ? "Developing signal · not graded" : feedback === "not-evaluated" ? "Not part of your plan · not scored" : "No clear signal"}</span>
    <div className="sideboard-lab-guidance-rate"><small>Contributor-balanced pattern</small><strong>{guidancePercent}% {label}</strong><em>{evidence.guidancePlayers} players · one vote each{confidenceRange ? ` · likely range ${Math.round(confidenceRange.lower * 100)}–${Math.round(confidenceRange.upper * 100)}%` : ""}</em></div>
    <div className="sideboard-lab-evidence-bar"><i style={{ width: `${selectedPercent}%` }} /></div>
    <small>{evidence.selected} of {evidence.opportunities} eligible decisions · {evidence.selectedCopies} total copies moved</small>
    {plannedCount > 0 && evidence.quantity ? <div className="sideboard-lab-quantity-evidence" data-status={evidence.quantity.status}>
      <span><small>Your quantity</small><strong>{plannedCount} cop{plannedCount === 1 ? "y" : "ies"}</strong></span>
      <span><small>Median when selected</small><strong>{evidence.quantity.selectedMedianCopies ?? "Early"}</strong></span>
      <div aria-label="Observed moved-copy distribution">{evidence.quantity.histogram.map((bucket) => <i key={bucket.copies}><b>{bucket.copies}</b><small>{bucket.decisions} decisions</small></i>)}</div>
      <em>Quantity is descriptive and is not graded independently.</em>
    </div> : null}
    {periodShift !== null && Math.abs(periodShift) >= 0.15 ? <span className="sideboard-lab-meta-shift" data-direction={periodShift > 0 ? "up" : "down"}><BarChart3 size={12} /> Current-season pattern {periodShift > 0 ? "up" : "down"} {Math.round(Math.abs(periodShift) * 100)} points versus pre-season</span> : null}
    {evidence.outcomeStatus === "comparable" ? <div className="sideboard-lab-outcomes"><span><small>Win rate · selected</small><strong>{Math.round((evidence.selectedWinRate ?? 0) * 100)}%</strong></span><span><small>Win rate · not selected</small><strong>{Math.round((evidence.notSelectedWinRate ?? 0) * 100)}%</strong></span></div> : <small>Outcome comparison unavailable at the current sample gate.</small>}
    <small className="sideboard-lab-scope">{evidence.scope === "matchup" ? `Matchup + same Game 1 result · ${evidence.scopeDecisions} decisions / ${evidence.scopePlayers} players` : "Player-Legend + same Game 1 result fallback"}</small>
  </div>;
}

function SideboardDecisionEvidenceView({ evidence, plan }: {
  evidence: NonNullable<SideboardLabApiDrill["decisionEvidence"]>;
  plan: SideboardLabPlan;
}) {
  const moved = Object.values(plan.in).reduce((sum, value) => sum + value, 0);
  return <section className="sideboard-lab-decision-evidence" aria-label="Whole-plan community context">
    <header><span className="eyebrow"><ArrowLeftRight size={12} /> Plan-size context</span><small>Descriptive only · never a plan grade</small></header>
    <div className="sideboard-lab-decision-evidence-summary">
      <span><small>Your plan</small><strong>{moved} cop{moved === 1 ? "y" : "ies"} swapped</strong></span>
      <span><small>Community median</small><strong>{evidence.medianCopiesMoved ?? "Early data"}</strong></span>
      <span><small>No-change plans</small><strong>{Math.round(evidence.noChangeRate * 100)}%</strong><em>{evidence.noChangeDecisions} of {evidence.decisions}</em></span>
    </div>
    <div className="sideboard-lab-swap-histogram" aria-label="Observed number of copies swapped">
      {evidence.swapCountHistogram.map((bucket) => <span key={bucket.copies} data-current={bucket.copies === moved}><b>{bucket.copies}</b><i style={{ height: `${Math.max(8, bucket.decisions / evidence.decisions * 100)}%` }} /><small>{bucket.decisions}</small></span>)}
    </div>
  </section>;
}

function SideboardCommonPackages({ packages }: { packages: NonNullable<SideboardLabApiDrill["packages"]> }) {
  return <section className="sideboard-lab-common-packages" aria-label="Contributor-supported common swap packages">
    <header><span className="eyebrow"><Sparkles size={12} /> Common supported plans</span><small>Repeated across independent players · no sampled player's plan is exposed</small></header>
    <div>{packages.map((item, index) => <article key={`${item.cardsOut.map((card) => card.code).join("-")}:${item.cardsIn.map((card) => card.code).join("-")}`}>
      <b>{index + 1}</b>
      <div><small>OUT</small>{item.cardsOut.map((card) => <span key={`out:${card.code}`}><img src={card.imageUrl} alt="" /><em>{card.count}× {card.name}</em></span>)}</div>
      <ArrowLeftRight size={15} />
      <div><small>IN</small>{item.cardsIn.map((card) => <span key={`in:${card.code}`}><img src={card.imageUrl} alt="" /><em>{card.count}× {card.name}</em></span>)}</div>
      <strong>{Math.round(item.selectionRate * 100)}% · {item.players} players</strong>
    </article>)}</div>
  </section>;
}

function SideboardCommonPairs({ pairs }: { pairs: NonNullable<SideboardLabApiDrill["pairs"]> }) {
  return <section className="sideboard-lab-common-pairs" aria-label="Contributor-supported card pair patterns">
    <header><span className="eyebrow"><ArrowLeftRight size={12} /> Common IN ↔ OUT pairs</span><small>Cards that repeatedly moved together, even when the rest of the plan differed</small></header>
    <div>{pairs.map((item) => <article key={`${item.cardOut.code}:${item.cardIn.code}`} data-status={item.evidenceStatus}>
      <span><small>OUT</small><img src={item.cardOut.imageUrl} alt="" /><strong>{item.cardOut.name}</strong></span>
      <ArrowLeftRight size={16} aria-hidden="true" />
      <span><small>IN</small><img src={item.cardIn.imageUrl} alt="" /><strong>{item.cardIn.name}</strong></span>
      <em>{Math.round(item.selectionRate * 100)}% · {item.decisions} decisions · {item.players} players</em>
    </article>)}</div>
    <p>Pairing is descriptive co-occurrence, not proof the cards have the same role or that the swap is always correct.</p>
  </section>;
}

function SideboardDecisionBar({ balance, confidence, onConfidence, onClear, onLock }: { balance: ReturnType<typeof sideboardLabPlanBalance>; confidence: DecisionConfidence | null; onConfidence: (value: DecisionConfidence) => void; onClear: () => void; onLock: () => void }) {
  const message = balance.status === "overlap" ? "The same card identity cannot be moved both in and out" : balance.status === "empty" ? "No changes selected · keeping the registered deck is valid" : balance.status === "balanced" ? "Plan ready · every incoming copy has a card leaving" : balance.status === "needs-in" ? `Add ${Math.abs(balance.difference)} more card${Math.abs(balance.difference) === 1 ? "" : "s"} from the Sideboard` : `Take ${balance.difference} more card${balance.difference === 1 ? "" : "s"} out of the Main Deck`;
  return <footer className="sideboard-lab-decision-bar" data-status={balance.status}><div aria-live="polite"><span className="sideboard-lab-balance-count"><b>OUT {balance.cardsOut}</b><ArrowLeftRight size={16} /><b>IN {balance.cardsIn}</b></span><strong>{message}</strong></div><div className="sideboard-lab-confidence" aria-label="How confident are you in this plan?"><small>Before reveal</small>{(["certain", "unsure", "guess"] as const).map((value) => <button type="button" key={value} data-active={confidence === value} aria-pressed={confidence === value} onClick={() => onConfidence(value)}>{value === "certain" ? "Certain" : value === "unsure" ? "Unsure" : "Guess"}</button>)}</div><button type="button" className="secondary" disabled={balance.status === "empty"} onClick={onClear}>Reset swaps</button><button type="button" className="primary sideboard-lab-reveal-button" disabled={!balance.legal} onClick={onLock}><Sparkles size={16} /> Reveal community patterns</button></footer>;
}

function SideboardReveal({ drill, plan, onNext, onOpenPrep, onSavePrep, canSavePrep, saveStatus }: { drill: SideboardLabApiDrill; plan: SideboardLabPlan; onNext: () => void; onOpenPrep: () => void; onSavePrep: () => void; canSavePrep: boolean; saveStatus: string }) {
  const summary = summarizeSideboardLabPlanFeedback(drill.cardEvidence, plan);
  const shape = sideboardLabPlanShape(drill.deck, plan);
  const headline = summary.noChanges
    ? "No-change plan explored"
    : summary.result === "aligned"
      ? "Your chosen moves match robust community patterns"
      : summary.result === "different"
        ? "Compare your line with notable community patterns"
        : summary.result === "mixed"
          ? "Your plan follows a mixed community line"
          : "More evidence is needed for your chosen moves";
  const detail = summary.noChanges
    ? `You kept the registered configuration. ${summary.notableAlternatives ? `${summary.notableAlternatives} robust community alternative${summary.notableAlternatives === 1 ? " is" : "s are"} highlighted for review. ` : "No robust alternative is available in this cohort yet. "}`
    : `${summary.aligned ? `${summary.aligned} chosen move${summary.aligned === 1 ? "" : "s"} matched. ` : ""}${summary.different ? `${summary.different} chosen move${summary.different === 1 ? "" : "s"} differed. ` : ""}${summary.notableAlternatives ? `${summary.notableAlternatives} robust alternative${summary.notableAlternatives === 1 ? " was" : "s were"} not selected. ` : ""}${summary.ungraded ? `${summary.ungraded} chosen move${summary.ungraded === 1 ? " is" : "s are"} ungraded. ` : ""}`;
  return <>
    {drill.decisionEvidence ? <SideboardDecisionEvidenceView evidence={drill.decisionEvidence} plan={plan} /> : null}
    {drill.packages?.length ? <SideboardCommonPackages packages={drill.packages} /> : null}
    {drill.pairs?.length ? <SideboardCommonPairs pairs={drill.pairs} /> : null}
    <section className="sideboard-lab-plan-shape" aria-label="Registered deck shape before and after this plan"><header><span className="eyebrow"><BarChart3 size={12} /> Objective plan shape</span><small>Printed registered-card mix · descriptive, not graded</small></header><div>
      <PlanShapeMetric label="Average Energy" before={shape.before.averageEnergy === null ? null : Number(shape.before.averageEnergy.toFixed(1))} after={shape.after.averageEnergy === null ? null : Number(shape.after.averageEnergy.toFixed(1))} />
      <PlanShapeMetric label="Early Units (≤2E)" before={shape.before.earlyUnits} after={shape.after.earlyUnits} />
      <PlanShapeMetric label="2-cost Units" before={shape.before.twoCostUnits} after={shape.after.twoCostUnits} />
      <PlanShapeMetric label="Units" before={shape.before.units} after={shape.after.units} />
      <PlanShapeMetric label="Spells / Gear" before={`${shape.before.spells} / ${shape.before.gear}`} after={`${shape.after.spells} / ${shape.after.gear}`} />
    </div></section>
    <footer className="sideboard-lab-reveal-bar" data-result={summary.result} aria-live="polite"><div><span className="eyebrow"><Sparkles size={12} /> Deliberate-move reveal</span><strong>{headline}</strong><p>{detail}This is not a whole-plan grade. Untouched avoid-signals do not earn automatic credit; outcomes are descriptive only, and the sampled player's exact plan is never used as the answer. {saveStatus ? <em className="sideboard-lab-prep-save-status">{saveStatus}</em> : null}</p></div><div className="sideboard-lab-summary-score"><span data-kind="aligned"><strong>{summary.aligned}</strong><small>Chosen matches</small></span><span data-kind="conflicts"><strong>{summary.different}</strong><small>Chosen differs</small></span><span data-kind="alternatives"><strong>{summary.notableAlternatives}</strong><small>Alternatives</small></span><span data-kind="unclear"><strong>{summary.ungraded}</strong><small>Ungraded</small></span></div><button type="button" className="secondary" disabled={!canSavePrep} onClick={onSavePrep}>Add plan to prep</button><button type="button" className="secondary" onClick={onOpenPrep}>Open matchup prep</button><button type="button" className="primary" onClick={onNext}>Next challenge <ChevronRight size={16} /></button></footer>
  </>;
}

function PlanShapeMetric({ label, before, after }: { label: string; before: number | string | null; after: number | string | null }) {
  const changed = before !== after;
  return <span data-changed={changed}><small>{label}</small><b>{before ?? "Unknown"}</b><ArrowLeftRight size={12} /><strong>{after ?? "Unknown"}</strong></span>;
}

function SideboardRunComplete({ drills, decisions, onRestart, onOpenPrep, onPracticeMulligan }: {
  drills: SideboardLabApiDrill[];
  decisions: Record<string, SideboardLabPlan>;
  onRestart: () => void;
  onOpenPrep: () => void;
  onPracticeMulligan: () => void;
}) {
  const rounds = drills.flatMap((item) => {
    const decision = decisions[item.id];
    if (!decision) return [];
    return [{ drill: item, summary: summarizeSideboardLabPlanFeedback(item.cardEvidence, decision) }];
  });
  const aligned = rounds.reduce((sum, item) => sum + item.summary.aligned, 0);
  const different = rounds.reduce((sum, item) => sum + item.summary.different, 0);
  const alternatives = rounds.reduce((sum, item) => sum + item.summary.notableAlternatives, 0);
  const noChanges = rounds.filter((item) => item.summary.noChanges).length;
  return <section className="sideboard-lab-run-complete" aria-labelledby="sideboard-lab-run-complete-title">
    <div className="sideboard-lab-run-complete-mark"><Sparkles size={34} /></div>
    <span className="eyebrow">Practice run complete</span>
    <h3 id="sideboard-lab-run-complete-title">You explored {rounds.length} real sideboard scenario{rounds.length === 1 ? "" : "s"}</h3>
    <p>These are learning signals, not a strategic verdict. Only deliberate moves and robust alternatives are counted; untouched cards never create free alignment.</p>
    <div className="sideboard-lab-run-complete-stats">
      <span><strong>{aligned}</strong><small>chosen matches</small></span>
      <span><strong>{different}</strong><small>chosen differences</small></span>
      <span><strong>{alternatives}</strong><small>alternatives to review</small></span>
      <span><strong>{noChanges}</strong><small>no-change plans</small></span>
    </div>
    <div className="sideboard-lab-run-recap">
      {rounds.map(({ drill: item, summary }, index) => <article key={item.id}>
        <b>{index + 1}</b>
        <span><strong>{item.playerLegend.name} vs {item.opponentLegend.name}</strong><small>Game {item.context?.targetGameNumber ?? 2} · {item.priorGameResult === "win" ? "after a win" : "after a loss"}</small></span>
        <em data-result={summary.result}>{summary.noChanges ? "No changes" : `${summary.aligned} match · ${summary.different} different · ${summary.notableAlternatives} alternative`}</em>
      </article>)}
    </div>
    <div className="sideboard-lab-run-complete-actions"><button type="button" className="secondary" onClick={onOpenPrep}>Open matchup prep</button><button type="button" className="secondary" onClick={onPracticeMulligan}>Practice this mulligan</button><button type="button" className="primary" onClick={onRestart}><RefreshCw size={16} /> Start another run</button></div>
  </section>;
}

function SideboardUnavailable({ state, message, reason, onRetry }: { state: LoadState; message: string; reason?: string; onRetry: () => void }) {
  const reasons: Record<string, string> = { snapshot_not_configured: "The daily community snapshot has not been configured.", snapshot_invalid: "The latest community snapshot did not pass validation.", snapshot_expired: "The latest community snapshot is stale and will not be used for training.", data_unavailable: "There are not yet enough finalized sideboard decisions to publish a pack." };
  const detail = message || reasons[reason ?? ""] || "Community sideboard data is not available yet.";
  return <section className="sideboard-lab-empty-panel" data-state={state}><span className="sideboard-lab-empty-icon">{state === "loading" ? <RefreshCw size={30} className="spin" /> : <AlertTriangle size={30} />}</span><div><span className="eyebrow">Community data</span><h3>{state === "loading" ? "Checking today's community sideboard pack..." : "Today's community sideboard pack is not available yet."}</h3><p>{detail} No sample plans or statistics are substituted.</p></div>{state !== "loading" ? <button type="button" className="secondary" onClick={onRetry}><RefreshCw size={15} /> Check again</button> : null}</section>;
}

function SideboardReviewUnavailable({ state, message, remaining, onRetry, onSkip }: {
  state: LoadState;
  message: string;
  remaining: number;
  onRetry: () => void;
  onSkip: () => void;
}) {
  const loading = state === "loading";
  return <section className="sideboard-lab-empty-panel" data-state={state}>
    <span className="sideboard-lab-empty-icon">{loading ? <RefreshCw size={30} className="spin" /> : <History size={30} />}</span>
    <div>
      <span className="eyebrow">Exact saved review</span>
      <h3>{loading ? "Checking this saved sideboard scenario..." : "This exact review scenario is not available right now."}</h3>
      <p>{message || "The current full-corpus pack does not include the exact drill you previously answered."} RiftLite will not substitute a different drill and call it a review.</p>
      {!loading ? <span className="sideboard-lab-empty-actions"><button type="button" className="secondary" onClick={onRetry}><RefreshCw size={15} /> Check again</button><button type="button" className="primary" onClick={onSkip}>{remaining > 1 ? "Skip to next saved item" : "Leave review queue"} <ChevronRight size={15} /></button></span> : null}
    </div>
  </section>;
}
