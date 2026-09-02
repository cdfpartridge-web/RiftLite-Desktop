import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../src/preload/appPreload.ts", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");
const overlaySource = readFileSync(new URL("../src/main/services/overlayServer.ts", import.meta.url), "utf8");

function functionSource(name: string, nextName: string): string {
  const start = appSource.indexOf(`function ${name}`);
  const end = appSource.indexOf(`function ${nextName}`, start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return appSource.slice(start, end);
}

describe("match review lifecycle integration", () => {
  it("updates saved Scorepad matches directly without unrelated capture or seat requirements", () => {
    const confirm = functionSource("confirmDraft", "openNextQueuedReview");
    const modal = functionSource("MatchReviewModal", "healthLabel");

    expect(confirm).toContain('draft.status === "saved" && (draft.source === "scorepad" || draft.source === "manual")');
    expect(confirm).toContain("window.riftlite.saveMatchDraft(preparedDraft)");
    expect(confirm).toContain('draft.status === "saved" ? draft : attachTestingSessionToDraft(draft)');
    expect(modal).toContain("const editingSavedManualMatch = isScorepadDraft && isSavedDraft");
    expect(modal).toContain("const missingSeatGames = editingSavedManualMatch ? [] : missingSeatGameNumbers(normalizedGames)");
    expect(modal).toContain('<LegendInput label="My legend"');
    expect(modal).toContain('<LegendInput label="Opponent legend"');
  });

  it("parks Review later durably before replay finalization continues in the background", () => {
    const dismiss = functionSource("dismissReviewDraft", "chooseGamePlatform");

    expect(preloadSource).toContain('dismissMatchReview: () => ipcRenderer.invoke("capture:dismiss-review")');
    expect(preloadSource).toContain('deferMatchReview: (draft) => ipcRenderer.invoke("matches:defer-review", draft)');
    expect(mainSource).toContain('handleTrustedAppIpc("capture:dismiss-review", () => capture.dismissMatchReview())');
    expect(mainSource).toContain('handleTrustedAppIpc("matches:defer-review"');
    const deferHandlerAt = mainSource.indexOf('handleTrustedAppIpc("matches:defer-review"');
    const nextHandlerAt = mainSource.indexOf('handleTrustedAppIpc("matches:confirm"', deferHandlerAt);
    const deferHandler = mainSource.slice(deferHandlerAt, nextHandlerAt);
    const durableDeferAt = deferHandler.indexOf("await store.deferMatchReview(draft)");
    const deferReplayGuardAt = deferHandler.indexOf('if (deferred.status !== "saved")');
    const backgroundMarkerAt = deferHandler.indexOf("capture.markDeferredReviewReplayFinalizationBackgrounded(deferred.id)");
    const deferReplayAt = deferHandler.indexOf(".then(() => capture.waitForReplayFinalization(deferred.id))");
    const completionMarkerAt = deferHandler.indexOf("capture.markDeferredReviewReplayFinalizationComplete(deferred.id)");
    const latestReadAt = deferHandler.indexOf("await store.getMatches()");
    const deferReturnAt = deferHandler.indexOf("return latest");
    expect(durableDeferAt).toBeGreaterThan(-1);
    expect(deferReplayGuardAt).toBeGreaterThan(durableDeferAt);
    expect(backgroundMarkerAt).toBeGreaterThan(deferReplayGuardAt);
    expect(deferReplayAt).toBeGreaterThan(backgroundMarkerAt);
    expect(completionMarkerAt).toBeGreaterThan(deferReplayAt);
    expect(latestReadAt).toBeGreaterThan(completionMarkerAt);
    expect(deferReturnAt).toBeGreaterThan(latestReadAt);
    expect(deferHandler).not.toContain("await capture.waitForReplayFinalization");
    const persistAt = dismiss.indexOf("await window.riftlite.deferMatchReview");
    const updateHistoryAt = dismiss.indexOf("setMatches(");
    const dismissMarkerAt = dismiss.indexOf("markReviewDismissed(deferred)");
    const releaseAt = dismiss.indexOf("await window.riftlite.dismissMatchReview()");
    const advanceAt = dismiss.lastIndexOf("openNextQueuedReview()");
    expect(persistAt).toBeGreaterThan(-1);
    expect(updateHistoryAt).toBeGreaterThan(persistAt);
    expect(dismissMarkerAt).toBeGreaterThan(updateHistoryAt);
    expect(advanceAt).toBeGreaterThan(dismissMarkerAt);
    expect(releaseAt).toBeGreaterThan(dismissMarkerAt);
    expect(advanceAt).toBeGreaterThan(releaseAt);
    expect(dismiss).toContain("if (!queuedReviewDraftsRef.current.length)");
    expect(dismiss).toContain('if (draft.status === "saved")');
  });

  it("keeps a failed review deletion visible and retryable", () => {
    const remove = functionSource("deleteReviewDraft", "prepareDraftForReview");
    const deleteAt = remove.indexOf("await window.riftlite.deleteMatch(draft.id, draft)");
    const dismissAt = remove.indexOf("markReviewDismissed(draft)");
    const advanceAt = remove.indexOf("openNextQueuedReview()");

    expect(deleteAt).toBeGreaterThan(-1);
    expect(dismissAt).toBeGreaterThan(deleteAt);
    expect(advanceAt).toBeGreaterThan(deleteAt);
    expect(remove).toContain("Promise.allSettled");
    const deleteHandlerAt = mainSource.indexOf('handleTrustedAppIpc("matches:delete"');
    const durableDeleteAt = mainSource.indexOf("await enqueueEnhancedInsightsDataMutation(() => store.deleteMatch(id, fallbackDraft))", deleteHandlerAt);
    const discardAt = mainSource.indexOf("capture.discardMatchReview(id)", deleteHandlerAt);
    expect(durableDeleteAt).toBeGreaterThan(deleteHandlerAt);
    expect(discardAt).toBeGreaterThan(durableDeleteAt);
  });

  it("uses a non-blocking in-app delete confirmation so Atlas input focus can recover", () => {
    const modal = functionSource("MatchReviewModal", "healthLabel");

    expect(modal).not.toContain("window.confirm");
    expect(modal).toContain("const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false)");
    expect(modal).toContain("deleteCancelButtonRef.current?.focus({ preventScroll: true })");
    expect(modal).toContain("if (!deleteConfirmationOpen)");
    expect(modal).toContain("Delete this captured match?");
    expect(modal).toContain("Keep reviewing");
    expect(modal).toContain("Delete capture now");
    expect(styleSource).toContain('.review-modal footer[data-delete-confirmation="true"]');
    expect(appSource).toContain("shouldRestoreGameWebviewFocus(");
    expect(appSource).toContain("const timers = [0, 100, 350].map");
  });

  it("keeps manual Stop recoverable when capture cleanup cannot finish promptly", () => {
    const force = functionSource("forceCaptureReview", "dismissReviewDraft");

    expect(force).toContain("try {");
    expect(force).toContain("await window.riftlite.forceCaptureReview(activePlatform)");
    expect(force).toContain("catch (error)");
    expect(force).toContain("The capture is preserved; try Stop again shortly.");
  });

  it("shows accessible staged feedback while a durable match save is running", () => {
    const modal = functionSource("MatchReviewModal", "healthLabel");

    expect(modal).toContain('className="review-save-progress"');
    expect(modal).toContain('role="status"');
    expect(modal).toContain('role="progressbar"');
    expect(modal).toContain('aria-valuetext={saveProgressTitle}');
    expect(modal).toContain("Saving the result and replay artifact locally.");
    expect(modal).toContain("Save result");
    expect(modal).toContain("Secure replay");
    expect(modal).toContain("Start delivery");
    expect(styleSource).toContain("@keyframes review-save-progress-pulse");
    expect(styleSource).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps Review later single-flight and visible when durable persistence fails", () => {
    const modal = functionSource("MatchReviewModal", "healthLabel");

    expect(modal).toContain("const [isDeferring, setIsDeferring] = useState(false)");
    expect(modal).toContain("await deckNotebookRefreshPromiseRef.current");
    expect(modal).toContain("await onReviewLater(normalizeReviewDraft(draftRef.current))");
    expect(modal).toContain("The review is still open.");
    expect(modal).toContain("setIsDeferring(false)");
    expect(modal).toContain('aria-label={isSavedDraft ? "Cancel editing" : "Review later"}');
    expect(modal).toContain('isSavedDraft ? "Cancel" : "Review later"');
    expect(appSource).toContain("key={reviewDraft.id}");
  });

  it("keeps internal save details out of the review and contains long errors", () => {
    const modal = functionSource("MatchReviewModal", "healthLabel");

    expect(modal).toContain('setSaveError(matchReviewErrorMessage(error, "Save did not complete."))');
    expect(appSource).not.toContain("raw.slice(0, 280)");
    expect(modal).toContain("Resolve the issue above, then try again.");
    expect(styleSource).toContain(".review-form-alert > span");
    expect(styleSource).toContain("overflow-wrap: anywhere");
    expect(styleSource).toContain("min-width: 0");
  });

  it("keeps durable pending reviews out of local aggregate statistics", () => {
    expect(appSource).toContain("for (const match of localMatchesEligibleForStats(matches))");
    expect(appSource).toContain("validAnalytics(localMatchesEligibleForStats(matches).map(localToAnalytics))");
    expect(overlaySource).toContain("const statsMatches = localMatchesEligibleForStats(matches)");
    expect(overlaySource).toContain("const latest = statsMatches[0]");
  });
});
