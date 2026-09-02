import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const hub = readFileSync(new URL("../src/renderer/InsightsHubView.tsx", import.meta.url), "utf8");
const learning = readFileSync(new URL("../src/renderer/LearningInsightsView.tsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("../src/preload/appPreload.ts", import.meta.url), "utf8");
const capture = readFileSync(new URL("../src/main/services/captureCoordinator.ts", import.meta.url), "utf8");
const backup = readFileSync(new URL("../src/main/services/backupSanitizer.ts", import.meta.url), "utf8");
const tracker = readFileSync(new URL("../src/main/services/matchSessionTracker.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/main/services/store.ts", import.meta.url), "utf8");
const payloadStore = readFileSync(new URL("../src/main/services/replayPayloadStore.ts", import.meta.url), "utf8");

describe("Enhanced Insights product integration", () => {
  it("keeps opt-in capture separate from video, Web Replays, diagnostics, and upload controls", () => {
    expect(app).toContain("Enhanced Insights Beta");
    expect(app).toContain("This does not enable uploads, Web Replays, video recording, microphone access, or anonymous diagnostics.");
    expect(app).toContain("enhancedInsightsEnabled: event.target.checked");
    expect(hub).toContain("<EnhancedInsightsIntro");
    expect(hub).toContain("enhancedInsightsIntroSeen: true");
    expect(main).not.toContain('(settings.replayVideoEnabled || settings.enhancedInsightsEnabled === true)');
    expect(main).toContain("settings.replayQuickFlagHotkeyEnabled");
    expect(tracker).toContain("enhancedInsightsEnabledAtStart");
    expect(tracker).toContain("session.enhancedInsightsEnabledAtStart");
    expect(capture).toContain("enhancedInsightsEnabled: settings?.enhancedInsightsEnabled === true");
  });

  it("supports a visible live marker without requiring an active video recorder", () => {
    expect(app).toContain('className="enhanced-insights-live-marker"');
    expect(app).toContain("{enhancedInsightSessionActive ? (");
    expect(app).not.toContain("settings.enhancedInsightsEnabled && enhancedInsightSessionActive");
    expect(app).toContain("pendingEnhancedInsightMarkersRef");
    expect(app).toContain("Decision marked at");
    expect(app).toContain("if (!runtime)");
    expect(app).toContain('source: "live-flag"');
    expect(app).toContain("You can add context after the match.");
    expect(app).toContain("enhancedInsightMatchOpenRef");
    expect(app).toContain("advanceEnhancedInsightLiveSession");
    expect(app).toContain("readPendingEnhancedInsightMarkers");
    expect(app).toContain("normalizePendingEnhancedInsightMarkers");
    expect(app).toContain("writePendingEnhancedInsightMarkers");
    expect(app).toContain("enhancedInsightsEnabledAtStart");
    expect(app).toContain("gameNumber: enhancedInsightCurrentGameNumberRef.current");
    expect(app).toContain("replayFlagId: `enhanced-insight-${decisionId}`");
  });

  it("collects post-game intent and feeds conservative review questions with evidence receipts", () => {
    expect(app).toContain("Add the context capture cannot see");
    expect(app).toContain("How did this game relate to your current testing plan?");
    expect(app).toContain("How did the sideboard plan play out?");
    expect(app).toContain("What were you considering?");
    expect(app).toContain("Decision detail");
    expect(app).toContain("Testing goal");
    expect(app).toContain("Add strategic context (optional)");
    expect(app).toContain("Intended plan");
    expect(app).toContain("Constraint or trigger");
    expect(app).toContain("Alternative considered");
    expect(app).toContain("Keep local replay evidence for Coach");
    expect(app).toContain("This local semantic record can support Replay Coach when it returns.");
    expect(app).toContain("enhancedInsightDecisionsForDraft");
    expect(app).toContain("consumePersistedEnhancedInsightMarkers(saved.insightContext)");
    expect(app).toContain("notebookSnapshot");
    expect(app).toContain("buildInsightNotebookSnapshot");
    expect(app).toContain("finalizeEnhancedInsightNotebookSnapshot");
    expect(app).toContain("deckNotebookLoadRequestRef.current !== requestId");
    expect(app).toContain("deckNotebookRefreshPromiseRef");
    expect(app).toContain("isDeckNotebookLoading");
    expect(app).toContain("await deckNotebookRefreshPromiseRef.current");
    expect(app).toContain("getDeckNotebook(deck.id)");
    expect(app).toContain("activeGoalIds: [...goalIds]");
    expect(app).toContain("clearSingleGameSideboardPlanOutcome");
    expect(app).toContain("sideboardPlanOutcome: _sideboardPlanOutcome");
    expect(learning).toContain("buildEnhancedInsightsContext");
    expect(learning).toContain("Enhanced review queue");
    expect(learning).toContain("Evidence receipt");
    expect(learning).toContain("onOpenReplay(evidence.replayId, evidence.videoTimeMs, evidence.eventId)");
    expect(learning).toContain("Unknown means RiftLite did not capture it—not that it did not happen.");
    expect(learning).toContain("Turn end · game unknown");
  });

  it("persists, clears, and protects local-only evidence across process boundaries", () => {
    const clearWrapperStart = app.indexOf("onClearEnhancedInsightsData={async () => {");
    const clearWrapper = app.slice(clearWrapperStart, clearWrapperStart + 600);
    expect(preload).toContain('ipcRenderer.invoke("insights:clear-data")');
    expect(main).toContain('handleTrustedAppIpc("insights:clear-data"');
    expect(main).toContain("await diagnostics.clearStoredEvents()");
    expect(main).toContain('handleTrustedAppIpc("replays:save"');
    expect(main).toContain("saveReplayWithEnhancedInsightsDataMutation(replay)");
    expect(main).toContain("enqueueEnhancedInsightsDataMutation(() => store.saveReplay(replay))");
    expect(capture).toContain("enhancedInsightReplayMetadata");
    expect(capture).toContain("enhancedInsightReplayFlags");
    expect(backup).toContain("insightContext: _insightContext");
    expect(backup).toContain("hasEnhancedInsightData ? { structuredEvents: [] }");
    expect(backup).toContain("hasEnhancedInsightData");
    expect(backup).toContain("? []");
    expect(backup).toContain('!flag.id.startsWith("enhanced-insight-")');
    expect(store).toContain("rawEvidence: []");
    expect(store).toContain("events: []");
    expect(store).toContain("replayPayloadStore.remove(committed.previousReference)");
    expect(store).toContain("removeUnreferencedReplayPayloads");
    expect(store).toContain("replaceRecoveryBackupsAfterEnhancedInsightsClear");
    expect(store).toContain("await this.listRecoveryBackupCandidates()");
    expect(store).toContain('createLastKnownGoodBackup("post-insights-clear", true)');
    expect(payloadStore).toContain("async remove(reference: ReplayPayloadReference)");
    expect(clearWrapperStart).toBeGreaterThanOrEqual(0);
    expect(clearWrapper).toContain("pendingEnhancedInsightMarkersRef.current = []");
    expect(clearWrapper).toContain("writePendingEnhancedInsightMarkers([])");
    expect(clearWrapper).toContain("window.localStorage.removeItem(INSIGHT_ANALYSIS_CACHE_STORAGE_KEY)");
    expect(clearWrapper.indexOf("writePendingEnhancedInsightMarkers([])"))
      .toBeLessThan(clearWrapper.indexOf("window.riftlite.clearEnhancedInsightsData()"));
    expect(clearWrapper.indexOf("window.localStorage.removeItem(INSIGHT_ANALYSIS_CACHE_STORAGE_KEY)"))
      .toBeLessThan(clearWrapper.indexOf("window.riftlite.clearEnhancedInsightsData()"));
  });
});
