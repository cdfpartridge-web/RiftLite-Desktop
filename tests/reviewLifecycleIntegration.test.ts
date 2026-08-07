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
  it("releases main-process review state only after the last queued review closes", () => {
    const dismiss = functionSource("dismissReviewDraft", "chooseGamePlatform");

    expect(preloadSource).toContain('dismissMatchReview: () => ipcRenderer.invoke("capture:dismiss-review")');
    expect(preloadSource).toContain('deferMatchReview: (draft) => ipcRenderer.invoke("matches:defer-review", draft)');
    expect(mainSource).toContain('handleTrustedAppIpc("capture:dismiss-review", () => capture.dismissMatchReview())');
    expect(mainSource).toContain('handleTrustedAppIpc("matches:defer-review"');
    const deferHandlerAt = mainSource.indexOf('handleTrustedAppIpc("matches:defer-review"');
    const deferReplayGuardAt = mainSource.indexOf('if (draft.status !== "saved")', deferHandlerAt);
    const deferReplayAt = mainSource.indexOf("await capture.waitForReplayFinalization(deferred.id)", deferHandlerAt);
    const deferReturnAt = mainSource.indexOf("return latest", deferHandlerAt);
    expect(deferReplayGuardAt).toBeGreaterThan(deferHandlerAt);
    expect(deferReplayAt).toBeGreaterThan(deferReplayGuardAt);
    expect(deferReturnAt).toBeGreaterThan(deferReplayAt);
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
    const durableDeleteAt = mainSource.indexOf("await store.deleteMatch(id, fallbackDraft)", deleteHandlerAt);
    const discardAt = mainSource.indexOf("capture.discardMatchReview(id)", deleteHandlerAt);
    expect(durableDeleteAt).toBeGreaterThan(deleteHandlerAt);
    expect(discardAt).toBeGreaterThan(durableDeleteAt);
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
    expect(modal).toContain("await onReviewLater(normalizeReviewDraft(draft))");
    expect(modal).toContain("The review is still open.");
    expect(modal).toContain("setIsDeferring(false)");
    expect(modal).toContain('aria-label={isSavedDraft ? "Cancel editing" : "Review later"}');
    expect(modal).toContain('isSavedDraft ? "Cancel" : "Review later"');
    expect(appSource).toContain("key={reviewDraft.id}");
  });

  it("shows a bounded underlying error instead of hiding every save failure", () => {
    const modal = functionSource("MatchReviewModal", "healthLabel");

    expect(modal).toContain('setSaveError(matchReviewErrorMessage(error, "Save did not complete."))');
    expect(appSource).toContain("raw.slice(0, 280)");
  });

  it("keeps durable pending reviews out of local aggregate statistics", () => {
    expect(appSource).toContain("for (const match of localMatchesEligibleForStats(matches))");
    expect(appSource).toContain("validAnalytics(localMatchesEligibleForStats(matches).map(localToAnalytics))");
    expect(overlaySource).toContain("const statsMatches = localMatchesEligibleForStats(matches)");
    expect(overlaySource).toContain("const latest = statsMatches[0]");
  });
});
