import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../src/preload/appPreload.ts", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");

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
    expect(mainSource).toContain('handleTrustedAppIpc("capture:dismiss-review", () => capture.dismissMatchReview())');
    expect(dismiss).toContain("const next = openNextQueuedReview()");
    expect(dismiss).toContain("if (!next)");
    expect(dismiss).toContain("await window.riftlite.dismissMatchReview()");
  });

  it("keeps a failed review deletion visible and retryable", () => {
    const remove = functionSource("deleteReviewDraft", "prepareDraftForReview");
    const deleteAt = remove.indexOf("await window.riftlite.deleteMatch(draft.id)");
    const dismissAt = remove.indexOf("markReviewDismissed(draft)");
    const advanceAt = remove.indexOf("openNextQueuedReview()");

    expect(deleteAt).toBeGreaterThan(-1);
    expect(dismissAt).toBeGreaterThan(deleteAt);
    expect(advanceAt).toBeGreaterThan(deleteAt);
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
});
