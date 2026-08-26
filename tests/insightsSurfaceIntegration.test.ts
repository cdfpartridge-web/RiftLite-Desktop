import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const comingSoonSource = readFileSync(new URL("../src/renderer/InsightsComingSoon.tsx", import.meta.url), "utf8");
const learningViewSource = readFileSync(new URL("../src/renderer/LearningInsightsView.tsx", import.meta.url), "utf8");
const legacyExploreSource = readFileSync(new URL("../src/renderer/InsightsView.tsx", import.meta.url), "utf8");
const cacheSource = readFileSync(new URL("../src/renderer/insightAnalysisCache.ts", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");
const navigationSource = readFileSync(new URL("../src/shared/navigationModel.ts", import.meta.url), "utf8");

describe("learner-first Insights surface", () => {
  it("keeps the Insights destination visible behind a safe Coming Soon screen", () => {
    expect(navigationSource).toContain('{ kind: "route", id: "insights", label: "Insights", target: { view: "insights" } }');
    expect(appSource).toContain('insights: "Insights"');
    expect(appSource).toContain('case "insights": return <Lightbulb size={19} />');
    expect(appSource).toContain('import { InsightsComingSoon } from "./InsightsComingSoon"');
    expect(appSource).not.toContain('import { LearningInsightsView } from "./LearningInsightsView"');

    const routeStart = appSource.indexOf('if (view === "insights")');
    expect(routeStart).toBeGreaterThan(-1);
    const routeSource = appSource.slice(routeStart, routeStart + 900);
    expect(routeSource).toContain("<InsightsComingSoon />");
    expect(routeSource).not.toContain("<LearningInsightsView");
    expect(comingSoonSource).toContain("A smarter way to learn from every match");
    expect(comingSoonSource).toContain("Your capture data is safe.");
    expect(comingSoonSource).toContain("Matches and replays continue recording normally");
  });

  it("leads with the Coach, Last Match, Journal and Data Lab learning loop", () => {
    for (const tab of [
      '["coach", "Coach", Target]',
      '["review", "Last Match", BookOpen]',
      '["progress", "Journal", Trophy]',
      '["explore", "Data Lab", BarChart3]'
    ]) expect(learningViewSource).toContain(tab);
    for (const copy of [
      "One rule. Three games. A better habit.",
      "Other lessons forming",
      "Keep doing this",
      "Three moments to learn from",
      "Your rules, repetitions and retained habits",
      "Explore the evidence behind your coaching cards"
    ]) expect(learningViewSource).toContain(copy);
    expect(learningViewSource).toContain("buildReplayCoachQuestBoard");
    expect(learningViewSource).toContain("<CoachQuestCard");
    expect(learningViewSource).toContain("<CoachShareCardDialog");
    expect(learningViewSource).toContain('type CoachTab = "coach" | "review" | "progress" | "explore"');
    expect(learningViewSource).toContain('const COACH_TAB_ORDER: CoachTab[] = ["coach", "review", "progress", "explore"]');
    expect(learningViewSource).toContain('role="tablist" aria-label="Learning views"');
    expect(learningViewSource).toContain("moveCoachTab");
  });

  it("turns observations into one active, player-owned practice focus", () => {
    for (const contract of [
      "createReplayCoachingFocus",
      "defineReplayCoachingExperiment",
      "startReplayCoachingExperiment",
      "recordReplayCoachingGame",
      "replayCoachingProgress",
      "isReplayCoachingGameEligible",
      "activeFocus",
      "pendingCheckins",
      'className="insights-coach-focus-tools"',
      "Challenge controls",
      "Three-game challenge",
      "Did you follow the rule when the situation appeared?",
      "Followed it",
      "Missed it",
      "Didn&apos;t appear",
      "The score is whether you followed the plan. Wins and losses stay as context.",
      "Adjust and retest",
      "Keep this rule"
    ]) expect(learningViewSource).toContain(contract);
    expect(learningViewSource).toContain('targetEligibleGames: 3 | 4 | 5 = 3');
    expect(learningViewSource).toContain('transitionReplayCoachingFocus(focus, "paused"');
    expect(learningViewSource).toContain("REPLAY_COACHING_STORAGE_KEY");
    expect(learningViewSource).toContain("serializeReplayCoachingStore(coaching)");
  });

  it("asks for learner context instead of treating an observation as a verdict", () => {
    for (const reflection of [
      '"intentional"',
      '"missed"',
      '"forced"',
      '"unsure"',
      '"already-understood"',
      '"wrong"'
    ]) expect(learningViewSource).toContain(reflection);
    for (const copy of [
      "What this could mean",
      "Add your context",
      "RiftLite can see the action, but only you know the plan.",
      "This was intentional",
      "I missed this",
      "I was forced into it",
      "Already understood",
      "Capture is wrong",
      "I'm not sure"
    ]) expect(learningViewSource).toContain(copy);
    expect(learningViewSource).toContain("reflectOnReplayInsight");
    expect(learningViewSource).toContain("onOpenReplay(evidence.replayId, evidence.videoTimeMs, evidence.eventId)");
  });

  it("hands focused practice to the appropriate Lab with retained matchup context", () => {
    for (const helper of [
      "createLabTrainingHandoff",
      "resolveLabTrainingDeckId",
      "storeLabTrainingHandoff",
      'source: "insights"',
      'onNavigate(destination === "mulligan" ? "mulligan-lab" : "sideboard-lab")'
    ]) expect(learningViewSource).toContain(helper);
    expect(learningViewSource).toContain('insight.category === "opening-hand" || insight.category === "curve"');
    expect(learningViewSource).toContain('insight.category === "matchup"');
    expect(learningViewSource).toContain("onLab={featuredInsight");
    expect(learningViewSource).toContain("Practise this");
  });

  it("shows capture, sample, period and deck-version receipts beside claims", () => {
    for (const receipt of [
      "insight.captureConfidence",
      "insight.patternStrength",
      "insight.dataReceipt.observationCount",
      "insight.dataReceipt.completePlayCaptureScopeGames",
      "insight.dataReceipt.scopeGames",
      "insight.dataReceipt.deckFingerprints",
      "insight.dataReceipt.periods",
      "report.scopeReceipt.periodGameCounts",
      "report.scopeReceipt.deckVersions",
      "report.scopeReceipt.unknownDeckGames",
      "Pre-season + current season",
      "complete-enough play capture",
      "deck version unknown",
      "Observation mode"
    ]) expect(learningViewSource).toContain(receipt);
    expect(learningViewSource).toContain('className="insight-data-receipt"');
    expect(learningViewSource).toContain('className="insight-trust-badges"');
    expect(learningViewSource).toContain('if (tab !== "review" || !selectedReplayId) return null');
    expect(learningViewSource).toContain("extractReplayLearningSignals(");
    expect(learningViewSource).toContain("<CapturedLearningSignals signals={selectedLearningSignals} />");
    expect(learningViewSource).toContain('className="insights-capability-receipt"');
    for (const capability of [
      '"Opening hand"',
      '"Card timing"',
      '"Resources"',
      '"Sideboard"',
      '"Combat"',
      '"Battlefields"'
    ]) expect(learningViewSource).toContain(capability);
    expect(learningViewSource).toContain("Unknown means RiftLite did not capture it—not that it did not happen.");
  });

  it("keeps analysis local, lazy and bounded behind a replay fingerprint cache", () => {
    expect(learningViewSource).toContain('includeExplorerStats: tab === "explore"');
    expect(learningViewSource).toContain("backgroundRawCandidates(");
    expect(learningViewSource).toContain(".filter(replayNeedsRawInsightEnrichment)");
    expect(learningViewSource).toContain("const MAX_BACKGROUND_RAW_REPLAYS = 256");
    expect(learningViewSource).toContain("candidates.slice(0, MAX_BACKGROUND_RAW_REPLAYS)");
    expect(learningViewSource).toContain("lookupInsightAnalysisEventsBatch(cache, candidates)");
    expect(learningViewSource).toContain("cacheInsightAnalysisEventsBatch(cache, derived.map");
    expect(cacheSource).toContain("one validation, sort and prune pass");
    expect(cacheSource).toContain("one existing-cache validation and one selection pass");
    expect(learningViewSource).toContain("persistInsightAnalysisCache(window.localStorage, cache)");
    expect(learningViewSource).toContain("const RAW_ANALYSIS_CONCURRENCY = 2");
    expect(learningViewSource).toContain("mapWithConcurrency(misses, RAW_ANALYSIS_CONCURRENCY");
    expect(learningViewSource).toContain("window.riftlite.getRawCapturePayload(replay.id)");

    for (const safeguard of [
      'INSIGHT_ANALYSIS_CACHE_STORAGE_KEY = "riftlite:insight-analysis-cache:v1"',
      "createInsightAnalysisReplayFingerprint",
      "maxEntries: 256",
      "maxEventsPerEntry: 1_500",
      "maxTotalEvents: 10_000",
      "maxSerializedCharacters: 3_500_000",
      'reason: "entry-too-large"',
      "pruneInsightAnalysisCache"
    ]) expect(cacheSource).toContain(safeguard);

    for (const copy of [
      "Local only · no Firebase reads",
      "All analysis, reflections and experiments stay on this device.",
      "bounded two-worker queue",
      "cached locally",
      "Data Lab aggregation is lazy",
      "No Firebase reads or cloud analytics are added."
    ]) expect(learningViewSource).toContain(copy);
  });

  it("retains the useful advanced Explorer visualizations without making them the homepage", () => {
    expect(learningViewSource).toContain('tab === "explore"');
    expect(learningViewSource).toContain("<PatternExplorer");
    expect(learningViewSource).toContain("What happens after a card becomes visible");
    for (const legacyContract of [
      "Battlefield selection order",
      "Played from hand versus hidden",
      "Card timing versus outcome",
      "Observed correlations.",
      '<table className="insights-outcome-table">',
      'scope="col"'
    ]) expect(legacyExploreSource).toContain(legacyContract);
    expect(appSource).toContain('<details className="replay-evidence-drawer"');
  });

  it("ships a responsive, confidence-led learner presentation", () => {
    for (const selector of [
      ".insights-coming-soon-page",
      ".insights-coming-soon-stage",
      ".insights-coming-soon-art",
      ".insights-coming-soon-preview",
      ".insights-learning-page",
      ".insights-learning-hero",
      ".insights-scope-bar",
      ".insights-coach-tabs",
      ".insights-active-focus",
      ".insights-focus-progress",
      ".insights-checkins",
      ".learner-insight-card",
      ".insight-trust-badges",
      ".insight-data-receipt",
      ".insight-reflection",
      ".insights-decision-map",
      ".insights-focus-history",
      ".insights-explore-view",
      ".insights-capability-receipt",
      ".insights-captured-signal-grid",
      ".insight-card[data-tone=\"positive\"]",
      ".insight-confidence[data-confidence=\"reconstructed\"]",
      ".insights-origin-bar",
      ".insights-outcome-table-wrap",
      ".insight-card-art:focus-within > span",
      ".replay-evidence-drawer"
    ]) expect(styleSource).toContain(selector);
    expect(styleSource).toContain("@media (max-width: 880px)");
    expect(styleSource).toContain("@media (max-width: 580px)");
  });
});
