import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const helperSource = readFileSync(new URL("../src/shared/labTrainingHandoff.ts", import.meta.url), "utf8");
const sideboardSource = readFileSync(new URL("../src/renderer/SideboardLabView.tsx", import.meta.url), "utf8");
const mulliganStart = appSource.indexOf("function MulliganLabView");
const mulliganEnd = appSource.indexOf("function MatchupLabView", mulliganStart);
const mulliganSource = appSource.slice(mulliganStart, mulliganEnd);
const matchesStart = appSource.indexOf("function MatchesView");
const matchesEnd = appSource.indexOf("function isPrivateHubSyncableMatch", matchesStart);
const matchesSource = appSource.slice(matchesStart, matchesEnd);

describe("post-match lab training bridge", () => {
  it("offers packaged-registry-confirmed matchup practice from local match detail", () => {
    expect(appSource).toContain("labTrainingContextFromMatch(selectedMatch, decks)");
    expect(appSource).toContain("LAB_TRAINING_LEGEND_NAMES.has(playerLegend)");
    expect(matchesSource).toContain('openLabTrainingFromMatch("mulligan")');
    expect(matchesSource).toContain("Train mulligan");
    expect(matchesSource).toContain("Train sideboarding");
    expect(matchesSource).toContain("selectedLabTrainingContext?.sideboardEligible");
    expect(appSource).toContain('match.format === "Bo3" || match.games.length > 1');
  });

  it("passes only filters through a short-lived versioned local handoff", () => {
    expect(helperSource).toContain('LAB_TRAINING_HANDOFF_VERSION = 1');
    expect(helperSource).toContain("LAB_TRAINING_HANDOFF_MAX_AGE_MS");
    expect(helperSource).toContain("another lab cannot steal it");
    expect(helperSource).toContain("durable key first, then exact URL");
    expect(helperSource).not.toContain("answers");
    expect(helperSource).not.toContain("sessions");
    expect(matchesSource).toContain('source: "match-detail"');
    expect(matchesSource).not.toContain("recordMulliganLabTrainingAnswer");
  });

  it("consumes matchup and deck context once when Mulligan Lab mounts", () => {
    expect(mulliganSource).toContain('consumeLabTrainingHandoff(window.localStorage, "mulligan")');
    expect(mulliganSource).toContain('handoffDeck && activeDeckFingerprint ? "active-deck" : "matchup"');
    expect(mulliganSource).toContain("LAB_TRAINING_LEGEND_NAME_BY_CANONICAL.get(normalizeLegendName(trainingHandoff?.playerLegend");
    expect(mulliganSource).toContain("LAB_TRAINING_LEGEND_NAME_BY_CANONICAL.get(normalizeLegendName(trainingHandoff?.opponentLegend");
    expect(mulliganSource).toContain('trainingHandoff?.wentFirst ?? "all"');
    expect(mulliganSource).toContain("Match context loaded");
  });

  it("can continue a targeted Mulligan run into Sideboard Lab without copying training results", () => {
    expect(mulliganSource).toContain("function continueToSideboardLab");
    expect(mulliganSource).toContain('destination: "sideboard"');
    expect(mulliganSource).toContain('source: "mulligan-complete"');
    expect(mulliganSource).toContain("normalizeLegendName(activeDeck.legend) === normalizeLegendName(context.playerLegend.name)");
    expect(mulliganSource).toContain("deckId: contextualDeckId");
    expect(mulliganSource).toContain("Continue to Sideboard Lab");
    expect(mulliganSource).toContain('onNavigate("sideboard-lab")');
  });

  it("consumes match context in Sideboard Lab and can continue the matchup into Mulligan Lab", () => {
    expect(sideboardSource).toContain('consumeLabTrainingHandoff(window.localStorage, "sideboard")');
    expect(sideboardSource).toContain('trainingHandoff ? handoffDeckFingerprint ? "active-deck" : "matchup" : "daily"');
    expect(sideboardSource).toContain("normalizeLegendName(card.name) === normalizeLegendName(playerLegend)");
    expect(sideboardSource).toContain("trainingHandoff?.priorGameResult ?? \"all\"");
    expect(sideboardSource).toContain("Match context loaded");
    expect(sideboardSource).toContain("function continueToMulliganLab");
    expect(sideboardSource).toContain('destination: "mulligan"');
    expect(sideboardSource).toContain('source: "sideboard-complete"');
    expect(sideboardSource).toContain("Practice this mulligan");
    expect(sideboardSource).toContain('onNavigate("mulligan-lab")');
  });
});
