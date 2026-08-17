import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const viewSource = readFileSync(new URL("../src/renderer/SideboardLabView.tsx", import.meta.url), "utf8");
const introSource = readFileSync(new URL("../src/renderer/SideboardLabIntro.tsx", import.meta.url), "utf8");
const sharedSource = readFileSync(new URL("../src/shared/sideboardLab.ts", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/renderer/styles/sideboard-lab.css", import.meta.url), "utf8");

describe("Sideboard Lab desktop surface", () => {
  it("is reachable from Prepare and Home without shipping a separate client flow", () => {
    expect(appSource).toContain('new URL("/api/app/sideboard-lab", HOME_CONFIG_URL)');
    expect(appSource).toContain('onNavigate("sideboard-lab")');
    expect(appSource).toContain("Train sideboarding");
    expect(appSource).toContain('if (view === "sideboard-lab")');
    expect(appSource).toContain("<SideboardLabView");
  });

  it("loads validated daily and full-corpus targeted packs without inventing sample plans", () => {
    expect(viewSource).toContain('fetch(endpoint, { cache: "no-store", signal: controller.signal })');
    expect(viewSource).toContain("parseSideboardLabApiResponse(payload, registry)");
    expect(viewSource).toContain('`${endpoint.replace(/\\/+$/, "")}/v2`');
    expect(viewSource).toContain("parseSideboardLabTargetPackResponse(payload, registry)");
    expect(viewSource).toContain("if (!active) return;");
    expect(viewSource).toContain('url.searchParams.set("deckFingerprint", exactActiveFingerprint)');
    expect(viewSource).toContain("full indexed corpus");
    expect(viewSource).toContain("No sample plans or statistics are substituted.");
    expect(sharedSource).toContain("assertExactKeys");
    expect(sharedSource).toContain("selectedCopies");
    expect(sharedSource).toContain("sideboardLabDeckFingerprint");
  });

  it("presents the Game 2 decision before evidence, with official art and balanced quantity swaps", () => {
    expect(viewSource).toContain("Your sideboard challenge");
    expect(viewSource).toContain("Subtract cards from the Main Deck, add replacements from the Sideboard");
    expect(viewSource).toContain('title="Main Deck"');
    expect(viewSource).toContain('title="Sideboard"');
    expect(viewSource).toContain("src={card.imageUrl}");
    expect(viewSource).toContain("src={drill.playerLegend.imageUrl}");
    expect(viewSource).toContain("adjustSideboardLabCardDisplayQuantity(current, direction, card.code, delta, card.count, identityByCode)");
    expect(viewSource).toContain("sideboardLabCardDisplayQuantity(direction, card.count, plannedCount)");
    expect(viewSource).toContain('direction === "out" ? "remaining" : "to bring in"');
    expect(viewSource).toContain("Take one ${card.name} out of the main deck");
    expect(viewSource).toContain("Return one ${card.name} to the main deck");
    expect(viewSource).toContain("sideboardLabPlanBalance(plan, identityByCode)");
    expect(viewSource).toContain("same card identity cannot be moved both in and out");
    expect(viewSource).toContain("disabled={!balance.legal}");
    expect(viewSource).toContain("No changes selected · keeping the registered deck is valid");
    expect(viewSource).toContain("setSubmitted(false)");
    expect(viewSource).toContain("drill.context?.nextInitiative");
    expect(viewSource).toContain("Game 2 initiative: going");
  });

  it("frames each scenario as a minigame without inventing a strategic score", () => {
    expect(viewSource).toContain("sideboard-lab-stage-track");
    expect(viewSource).toContain("Scout matchup");
    expect(viewSource).toContain("Build swaps");
    expect(viewSource).toContain("Reveal patterns");
    expect(viewSource).toContain("sideboard-lab-plan-dock");
    expect(viewSource).toContain("Training run");
    expect(viewSource).toContain("sideboard-lab-round-pips");
    expect(viewSource).toContain("Reveal community patterns");
    expect(viewSource).toContain("This is not a whole-plan grade.");
    expect(viewSource).toContain("summarizeSideboardLabPlanFeedback");
    expect(viewSource).toContain("Untouched avoid-signals do not earn automatic credit");
    expect(viewSource).toContain("No-change plan explored");
    expect(viewSource).not.toContain("Strong community alignment");
    expect(viewSource).toContain("SideboardRunComplete");
    expect(viewSource).toContain("Practice run complete");
    expect(viewSource).toContain("Start another run");
    expect(viewSource).toContain("SIDEBOARD_LAB_TRAINING_STORAGE_KEY");
    expect(viewSource).toContain("recordSideboardLabTrainingAnswer");
    expect(viewSource).toContain("stored on this device");
    expect(viewSource).toContain("Review items");
    expect(viewSource).toContain("sideboardLabReviewAnswerIds");
    expect(viewSource).toContain('(mode === "review" && Boolean(reviewAnswer))');
    expect(viewSource).toContain("result = exactReviews.slice(0, 5)");
    expect(viewSource).not.toContain("exactReviews.length ? exactReviews : rankSideboardLabDailyDrills");
    expect(viewSource).toContain("RiftLite will not substitute a different drill and call it a review.");
    expect(viewSource).toContain("activeRunKey === runKey");
    expect(viewSource).toContain("How confident are you in this plan?");
    expect(viewSource).toContain('"certain", "unsure", "guess"');
    expect(viewSource).toContain("rankSideboardLabDailyDrills");
    expect(viewSource).toContain("Explore data · no robust move signal");
    expect(viewSource).toContain("Objective plan shape");
    expect(viewSource).toContain("Printed registered-card mix · descriptive, not graded");
    expect(viewSource).toContain("addPlanToMatchupPrep");
    expect(viewSource).toContain("Added from Sideboard Lab");
    expect(viewSource).toContain("Add plan to prep");
    expect(viewSource).toContain("Champion option");
    expect(viewSource).toContain("Plan-size context");
    expect(viewSource).toContain("Community median");
    expect(viewSource).toContain("Common supported plans");
    expect(viewSource).toContain("Quantity is descriptive and is not graded independently.");
    expect(viewSource).toContain("Current-season pattern");
    expect(viewSource).toContain("Exact active-deck exercises");
    expect(viewSource).toContain("Full-corpus matchup exercises");
    expect(viewSource).toContain("Legend-wide fallback exercises");
    expect(viewSource).toContain("SideboardCardZoom");
    expect(viewSource).toContain("Official packaged card artwork");
    expect(viewSource).toContain('aria-label={`Enlarge ${card.name}`}');
    expect(viewSource).not.toContain("accuracy score");
  });

  it("reveals contributor-balanced, card-level descriptive evidence without a whole-plan verdict", () => {
    expect(viewSource).toContain("Contributor-balanced pattern");
    expect(viewSource).toContain("same Game 1 result");
    expect(viewSource).toContain("Win rate · selected");
    expect(viewSource).toContain("Patterns, not prescriptions");
    expect(viewSource).toContain("This is not a whole-plan grade.");
    expect(viewSource).toContain("sampled player's exact plan is never used as the answer");
    expect(viewSource).toContain("All available pre-season and current-season history indexed.");
    expect(viewSource).toContain("Historical observations are structurally validated because their rules epoch is unknown.");
  });

  it("ships a first-use accessible guide and responsive, reduced-motion styles", () => {
    expect(viewSource).toContain("SIDEBOARD_LAB_INTRO_LOCAL_STORAGE_KEY");
    expect(viewSource).toContain("parseSideboardLabIntroState");
    expect(introSource).toContain('role="dialog"');
    expect(introSource).toContain('aria-modal="true"');
    expect(introSource).toContain('event.key === "Escape"');
    expect(introSource).toContain("previousFocus.focus");
    expect(introSource).toContain("choosing no swaps is valid too");
    expect(introSource).toContain("press − to take a copy out and + to restore it");
    expect(introSource).toContain("Sideboard starts at zero: press + to bring a copy in");
    expect(stylesSource).toContain(".sideboard-lab-card-columns");
    expect(stylesSource).toContain(".sideboard-lab-decision-bar");
    expect(stylesSource).toContain(".sideboard-lab-plan-dock");
    expect(stylesSource).toContain(".sideboard-lab-stage-track");
    expect(stylesSource).toContain("@media (max-width: 820px)");
    expect(stylesSource).toContain("prefers-reduced-motion: reduce");
  });
});
