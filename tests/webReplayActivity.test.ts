import { describe, expect, it } from "vitest";

import {
  addWebReplayWarningDismissal,
  parseWebReplayWarningDismissals,
  webReplayReadyWarningDismissalKey,
  webReplayReadyWarningIsDismissed
} from "../src/shared/webReplayActivity.js";
import type { WebReplayUploadQueueItem } from "../src/shared/types.js";

function queueItem(patch: Partial<WebReplayUploadQueueItem> = {}): WebReplayUploadQueueItem {
  return {
    platform: "atlas",
    captureSessionId: "capture-warning",
    title: "Kennen vs Ambessa",
    capturedAt: "2026-08-03T14:42:55.000Z",
    stage: "ready",
    uploadStatus: "uploaded",
    processingStatus: "ready",
    visibility: "private",
    locallyAvailable: true,
    attemptCount: 1,
    recommendedAction: "open-replay",
    canUploadAnyway: false,
    partialWarnings: ["The replay did not capture the opening mulligan."],
    ...patch
  };
}

describe("Web Replay completed-warning activity", () => {
  it("creates a dismissal key only for completed replays with warnings", () => {
    const item = queueItem();
    const key = webReplayReadyWarningDismissalKey(item);

    expect(key).toContain("capture-warning");
    expect(webReplayReadyWarningDismissalKey(queueItem({ stage: "processing" }))).toBe("");
    expect(webReplayReadyWarningDismissalKey(queueItem({ partialWarnings: [] }))).toBe("");
    expect(webReplayReadyWarningIsDismissed(item, [key])).toBe(true);
  });

  it("shows the activity again if the completed replay receives a different warning", () => {
    const original = queueItem();
    const dismissed = [webReplayReadyWarningDismissalKey(original)];
    const changed = queueItem({ partialWarnings: ["A later section could not be reconstructed."] });

    expect(webReplayReadyWarningIsDismissed(original, dismissed)).toBe(true);
    expect(webReplayReadyWarningIsDismissed(changed, dismissed)).toBe(false);
  });

  it("parses bounded durable dismissals and retains the most recent 200", () => {
    expect(parseWebReplayWarningDismissals("not-json")).toEqual([]);
    expect(parseWebReplayWarningDismissals(JSON.stringify(["one", "one", 2, "two"]))).toEqual(["one", "two"]);

    let dismissals: string[] = [];
    for (let index = 0; index < 205; index += 1) {
      dismissals = addWebReplayWarningDismissal(dismissals, `warning-${index}`);
    }
    expect(dismissals).toHaveLength(200);
    expect(dismissals[0]).toBe("warning-5");
    expect(dismissals.at(-1)).toBe("warning-204");
  });
});
