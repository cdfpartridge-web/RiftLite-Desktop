import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const appSource = fs.readFileSync(path.join(projectRoot, "src/renderer/App.tsx"), "utf8");
const stylesSource = fs.readFileSync(path.join(projectRoot, "src/renderer/styles/app.css"), "utf8");
const introSource = fs.readFileSync(path.join(projectRoot, "src/renderer/MulliganLabIntro.tsx"), "utf8");
const catalogSource = fs.readFileSync(path.join(projectRoot, "src/renderer/insightCardCatalog.ts"), "utf8");

const labStart = appSource.indexOf("function MulliganLabView");
const labEnd = appSource.indexOf("function MatchupLabView", labStart);
const labSource = appSource.slice(labStart, labEnd);

describe("Mulligan Lab desktop surface", () => {
  it("loads only the strict daily community API pack", () => {
    expect(labStart).toBeGreaterThan(-1);
    expect(appSource).toContain('new URL("/api/app/mulligan-lab", HOME_CONFIG_URL)');
    expect(labSource).toContain("parseMulliganLabApiResponse(payload, MULLIGAN_LAB_REGISTRY)");
    expect(labSource).toContain("matchup-wide patterns from anonymous community Web Replays");
    expect(labSource).not.toContain("demo");
    expect(labSource).not.toContain("localMatches");
  });

  it("keeps every visible card identity and image on the packaged registry path", () => {
    expect(appSource).toContain("const MULLIGAN_LAB_REGISTRY = INSIGHT_CARD_REGISTRY");
    expect(catalogSource).toContain("buildMulliganLabRegistry(cardRegistryData)");
    expect(labSource).toContain("card.imageUrl");
    expect(labSource).not.toContain("card.cardCode");
    expect(labSource).not.toContain("legendImageUrl(");
  });

  it("requires a decision before revealing evidence", () => {
    expect(labSource).toContain("submitted ?");
    expect(labSource).toContain("Lock in choice");
    expect(labSource).toContain("Community evidence");
    expect(labSource.indexOf("Lock in choice")).toBeLessThan(labSource.indexOf("function MulliganLabCardChoice"));
    expect(labSource).toContain("submitted ? (");
    expect(labSource).toContain("MulliganLabRevealSummary");
  });

  it("renders truthful unavailable and thin-cohort states", () => {
    expect(labSource).toContain("Community trainer data is not available yet.");
    expect(labSource).toContain("No sample hands or statistics are substituted.");
    expect(labSource).toContain("No community training hands match these filters in today’s rotating pack.");
    expect(labSource).toContain('drill.evidence.status === "early"');
    expect(labSource).toContain("Early signal — not graded");
    expect(labSource).toContain("Outcome comparison unavailable");
    expect(labSource).toContain("contributing players");
  });

  it("describes matchup selectors as a bounded daily rotation", () => {
    expect(labSource).toContain("matchup-wide patterns");
    expect(labSource).toContain("Rotating daily pack");
    expect(labSource).toContain('My legend ({targetedMode ? "full corpus" : "today’s pack"})');
    expect(labSource).toContain('Opponent ({targetedMode ? "full corpus" : "today’s pack"})');
    expect(labSource).toContain("Eligible matchup cohorts rotate through successive daily packs");
  });

  it("separates the rotating exercises from all-history pre-season and current-season evidence", () => {
    expect(labSource).toContain("available pre-season and current-season history");
    expect(labSource).toContain('readyPack?.coveragePolicy === "all-available-history"');
    expect(labSource).toContain('includedPeriods.has("preseason")');
    expect(labSource).toContain('includedPeriods.has("current-season")');
    expect(labSource).toContain("seasonCoverage.preseasonFacts");
    expect(labSource).toContain("seasonCoverage.currentSeasonFacts");
    expect(labSource).toContain("All available history indexed");
    expect(labSource).toContain("All-history backfill in progress");
    expect(labSource).toContain("every shown percentage is rebuilt from the full indexed corpus");
    expect(labSource).toContain("keep adding older eligible replays automatically");
  });

  it("queries the full corpus for active-deck and chosen-matchup modes with explicit fallbacks", () => {
    expect(appSource).toContain("mulliganLabApiDeckFingerprintFromSnapshot");
    expect(appSource).toContain('new URL("/api/app/mulligan-lab/v2", HOME_CONFIG_URL)');
    expect(labSource).toContain('url.searchParams.set("playerLegend", targetPlayerLegendCode)');
    expect(labSource).toContain('url.searchParams.set("opponentLegend", targetOpponentLegendCode)');
    expect(labSource).toContain('url.searchParams.set("deckFingerprint", activeDeckFingerprint)');
    expect(labSource).toContain("parseMulliganLabTargetPackResponse");
    expect(labSource).toContain("exact-deck hand filter · card guidance scope shown separately");
    expect(labSource).toContain("Hand filter · matchup fallback (deck cohort too small)");
    expect(labSource).toContain("legend-wide hand fallback · not graded");
    expect(labSource).toContain("Card guidance ·");
    expect(labSource).toContain("all observed decks");
    expect(labSource).toContain("The exact deck chooses eligible hands.");
    expect(labSource).not.toContain("Exact deck + matchup");
    expect(stylesSource).toContain('.mulligan-lab-evidence-status[data-status="scope"]');
    expect(labSource).not.toContain("normalizeLegendName(drill.playerLegend.name) === activeLegend");
  });

  it("applies initiative before selecting Daily 5 and labels the disabled filters honestly", () => {
    const seatFilter = 'if (seat !== "all") drills = drills.filter((drill) => drill.wentFirst === seat);';
    expect(labSource).toContain(seatFilter);
    expect(labSource.indexOf(seatFilter)).toBeLessThan(labSource.indexOf("drills = rankMulliganLabDailyDrills(drills, 5)"));
    expect(labSource).toContain('value={mode === "daily" || mode === "review" ? "" : mode === "active-deck" ? activeLegendOption?.name ?? "" : effectivePlayerLegend}');
    expect(labSource).toContain('mode === "review" ? <option value="">Review mix</option>');
  });

  it("uses the approved Focus Table layout and responsive treatment", () => {
    for (const selector of [
      ".mulligan-lab-workspace",
      ".mulligan-lab-hand",
      ".mulligan-lab-card-slot",
      ".mulligan-lab-card-evidence",
      ".mulligan-lab-card-verdict",
      ".mulligan-lab-guidance-rate",
      ".mulligan-lab-choice-rates",
      ".mulligan-lab-outcome-rates",
      ".mulligan-lab-summary-score",
      ".mulligan-lab-session-rail"
    ]) {
      expect(stylesSource).toContain(selector);
    }
  });

  it("gives strong but non-causal matchup-wide feedback", () => {
    expect(labSource).toContain("Matched ${mulliganLabEvidenceScopeLabel(choiceEvidence.scope).toLowerCase()}");
    expect(labSource).toContain("Different from ${mulliganLabEvidenceScopeLabel(choiceEvidence.scope).toLowerCase()}");
    expect(labSource).toContain("Mixed duplicate choice · not graded");
    expect(labSource).toContain("No clear signal");
    expect(labSource).toContain("Green and red feedback is reserved for reliable");
    expect(labSource).toContain("Legend-wide fallbacks are shown only as neutral general tendencies and never affect the grade.");
    expect(labSource).toContain("Matches general tendency · not graded");
    expect(labSource).toContain("Different from general tendency · not graded");
    expect(labSource).toContain("never uses the decision or result from the sampled replay");
    expect(labSource).toContain("Descriptive association only; outcomes are not used to grade this choice.");
    expect(labSource).toContain("Outcome comparison unavailable");
    expect(labSource).toContain("Observed win rate · kept");
    expect(labSource).toContain("Observed win rate · redrawn");
    expect(labSource).toContain('card.stats.outcomeStatus === "comparable"');
    expect(labSource).toContain("Matchup evidence");
    expect(labSource).toContain("Across all ${playerLegendName} matchups");
    expect(labSource).toContain("broader fallback");
    expect(labSource).toContain("both initiatives");
    expect(labSource).toContain("choiceEvidence.guidancePlayers");
    expect(labSource).toContain("one vote each");
    expect(labSource).toContain("mulliganLabIdentityDecisions");
    expect(labSource).toContain("Each gameplay card identity is counted once.");
    expect(labSource).not.toContain("One anonymous player");
    expect(stylesSource).toContain('[data-feedback="aligned"]');
    expect(stylesSource).toContain('[data-feedback="conflicts"]');
    expect(stylesSource).toContain('[data-feedback="general-aligned"]');
    expect(stylesSource).toContain('[data-feedback="general-different"]');
    expect(labSource).toContain("mulliganLabChoiceEvidence(card.stats)");
    expect(labSource).toContain("Same curve shape");
    expect(labSource).toContain("Same initiative");
    expect(labSource).toContain("Meta movement");
    expect(stylesSource).toContain(".mulligan-lab-context-slices");
    expect(stylesSource).toContain('[data-feedback="mixed-copy"]');
  });

  it("keeps the deterministic two-drop curve check separate and non-blocking", () => {
    expect(labSource).toContain("mulliganLabCurveCheck(drill.cards, drill.wentFirst)");
    expect(labSource).toContain('curveCheck.status === "missing" || curveCheck.status === "alternative-early-unit"');
    expect(labSource).toContain("No printed 2-cost Unit in this hand");
    expect(labSource).toContain("The usual baseline is to use both redraws");
    expect(labSource).toContain("a 1-cost Unit, or a 3-cost Unit while going second");
    expect(labSource).toContain("Curve baseline applied · 2/2");
    expect(labSource).toContain("Curve opportunity · ${selectedCount}/2");
    expect(labSource).toContain("This registered deck contains no printed 2-cost Units");
    expect(labSource).toContain("Curve not graded");
    expect(labSource).toContain("separate from the card-by-card community evidence");
    expect(labSource).toContain("This is not a whole-hand grade.");
    expect(labSource).toContain('className="primary" onClick={submitMulliganDecision}');
    expect(labSource).not.toContain("disabled={selectedCardIndexes.length < 2}");
    expect(stylesSource).toContain(".mulligan-lab-curve-check");
    expect(stylesSource).toContain('[data-status="alternative-early-unit"]');
    expect(stylesSource).toContain('[data-result="baseline"]');
  });

  it("shows an accessible first-visit introduction that can always be reopened", () => {
    expect(appSource).toContain("MULLIGAN_LAB_INTRO_LOCAL_STORAGE_KEY");
    expect(labSource).toContain("parseMulliganLabIntroState(window.localStorage.getItem(MULLIGAN_LAB_INTRO_LOCAL_STORAGE_KEY))");
    expect(labSource).toContain("serializeMulliganLabIntroState(seenMulliganLabIntroState())");
    expect(labSource).toContain("How it works");
    expect(labSource).toContain('aria-haspopup="dialog"');
    expect(labSource).toContain('aria-controls="mulligan-lab-intro-dialog"');
    expect(labSource).toContain("onClick={() => setIntroOpen(true)}");
    expect(labSource).toContain("editing || introOpen || zoomedCard || !drill || runComplete");
    expect(labSource).toContain("onStart={finishMulliganLabIntro}");
    expect(labSource).toContain("onDismiss={finishMulliganLabIntro}");

    expect(introSource).toContain('role="dialog"');
    expect(introSource).toContain('aria-modal="true"');
    expect(introSource).toContain('aria-describedby="mulligan-lab-intro-description"');
    expect(introSource).toContain('event.key === "Escape"');
    expect(introSource).toContain('event.key !== "Tab"');
    expect(introSource).toContain("previousFocus?.isConnected");
    expect(introSource).toContain("Start training");
    expect(introSource).toContain("Close guide");
  });

  it("provides a real run ending, local review items, visible selection limits, and official-card zoom", () => {
    expect(labSource).toContain("runComplete && filteredDrills.length");
    expect(labSource).toContain("Run complete");
    expect(labSource).toContain("Finish run");
    expect(labSource).not.toContain("(current + 1) % filteredDrills.length");
    expect(labSource).toContain("MULLIGAN_LAB_TRAINING_STORAGE_KEY");
    expect(labSource).toContain("recordMulliganLabTrainingAnswer");
    expect(labSource).toContain("completeMulliganLabTrainingSession");
    expect(labSource).toContain("Review items");
    expect(labSource).toContain("const [reviewQueue, setReviewQueue] = useState<string[]>([])");
    expect(labSource).toContain("reviewQueue.includes(drill.id)");
    expect(labSource).toContain("function startMulliganReviewRun()");
    expect(labSource).toContain('if (mode === "review") setReviewQueue(mulliganLabReviewDrillIds(trainingState))');
    expect(labSource).not.toContain('drills.filter((drill) => reviewDrillIds.has(drill.id))');
    expect(labSource).toContain("You can send back at most two cards.");
    expect(labSource).toContain("Clear selection");
    expect(labSource).toContain('window.addEventListener("keydown", handleTrainerKeyDown)');
    expect(labSource).toContain("event.target instanceof HTMLElement");
    expect(labSource).toContain("target?.closest('button, a[href]");
    expect(labSource).toContain("if (interactive) return;");
    expect(labSource).toContain("event.defaultPrevented || event.repeat");
    expect(labSource).toContain("Packaged official card image");
    expect(labSource).toContain("The enlarged official image preserves the printed rules text.");
    expect(labSource).toContain('aria-describedby="mulligan-lab-card-zoom-description"');
    expect(labSource).toContain('event.key !== "Tab"');
    expect(labSource).toContain("previousFocus?.isConnected");
    expect(labSource).toContain('document.addEventListener("keydown", handleDialogKeyDown)');
    expect(stylesSource).toContain(".mulligan-lab-completion");
    expect(stylesSource).toContain(".mulligan-lab-card-zoom-layer");
    expect(stylesSource).toContain(".mulligan-lab-selection-notice");
  });

  it("ignores stale daily and targeted responses after retries or filters change", () => {
    expect(labSource).toContain("let currentDailyRequest = true;");
    expect(labSource).toContain("if (!currentDailyRequest) return;");
    expect(labSource).toContain("currentDailyRequest = false;");
    expect(labSource.indexOf("currentDailyRequest = false;")).toBeLessThan(labSource.indexOf("controller.abort();", labSource.indexOf("currentDailyRequest = false;")));
    expect(labSource).toContain("let currentRequest = true;");
    expect(labSource).toContain("if (!currentRequest) return;");
    expect(labSource).toContain("currentRequest = false;");
    expect(labSource.indexOf("currentRequest = false;")).toBeLessThan(labSource.indexOf("controller.abort();", labSource.indexOf("currentRequest = false;")));
  });

  it("explains community history, curve guidance, and outcomes without causal claims", () => {
    expect(introSource).toContain("anonymised community Web Replays");
    expect(introSource).toContain("indexed pre-season and current-season history");
    expect(introSource).toContain("The Curve check is a printed-cost gameplay baseline.");
    expect(introSource).toContain("outcome rates are descriptive, not proof that a choice caused a win");
    expect(introSource).toContain("Green means aligned with a reliable pattern");
    expect(introSource).toContain('aria-label="Feedback colour key"');
    expect(introSource).toContain("Patterns, not prescriptions.");
    expect(introSource).toContain("no sampled player decision is treated as the answer");
  });

  it("gives the introduction a compact responsive splash treatment", () => {
    for (const selector of [
      ".mulligan-lab-intro-layer",
      ".mulligan-lab-intro-card",
      ".mulligan-lab-intro-steps",
      ".mulligan-lab-intro-trust",
      ".mulligan-lab-intro-actions",
      ".mulligan-lab-intro-signal-key",
      ".mulligan-lab-hero-actions",
      ".mulligan-lab-help-button"
    ]) {
      expect(stylesSource).toContain(selector);
    }
    expect(stylesSource).toContain("@media (max-width: 720px)");
    expect(stylesSource).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
