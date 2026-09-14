import { describe, expect, it, vi } from "vitest";

import {
  addWebReplayWarningDismissal,
  keepWebReplayUploadsLocalOnly,
  parseWebReplayWarningDismissals,
  webReplayKeepLocalCandidates,
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

describe("Web Replay bulk keep local", () => {
  function pendingItem(patch: Partial<WebReplayUploadQueueItem> = {}): WebReplayUploadQueueItem {
    return queueItem({ stage: "failed", uploadStatus: "failed", processingStatus: "failed", recommendedAction: "remove-from-queue", ...patch });
  }

  it("includes eligible captures beyond the six visible rows, once per capture", async () => {
    const queue = Array.from({ length: 16 }, (_, index) => pendingItem({ captureSessionId: `capture-${index}` }));
    queue.push({ ...queue[0] });
    const candidates = webReplayKeepLocalCandidates(queue);
    const remove = vi.fn().mockResolvedValue(undefined);

    expect(candidates).toHaveLength(16);
    expect(await keepWebReplayUploadsLocalOnly(candidates, remove)).toEqual({ keptCount: 16, failures: [] });
    expect(remove).toHaveBeenCalledTimes(16);
    expect(remove).toHaveBeenLastCalledWith("capture-15");
  });

  it.each(["captured", "queued", "failed", "paused"] as const)("includes locally available %s captures", (stage) => {
    expect(webReplayKeepLocalCandidates([pendingItem({ stage, recommendedAction: "wait" })])).toHaveLength(1);
  });

  it.each(["authenticating", "initializing", "uploading", "completing", "processing", "ready"] as const)("excludes %s captures even with a stale removal recommendation", (stage) => {
    expect(webReplayKeepLocalCandidates([pendingItem({ stage })])).toEqual([]);
  });

  it("excludes online replays and captures without a keep-local action", () => {
    expect(webReplayKeepLocalCandidates([
      pendingItem({ processingStatus: "ready" }),
      pendingItem({ captureSessionId: "unavailable", locallyAvailable: false, recommendedAction: "wait" })
    ])).toEqual([]);
  });

  it("excludes a whole capture when an alias is already online or active", () => {
    expect(webReplayKeepLocalCandidates([
      pendingItem(),
      queueItem(),
      pendingItem({ captureSessionId: "active" }),
      pendingItem({ captureSessionId: "active", stage: "uploading" })
    ])).toEqual([]);
  });

  it("continues after a service rejection, reports failures and progresses serially", async () => {
    const candidates = webReplayKeepLocalCandidates(["first", "became-ready", "last"].map((captureSessionId) => pendingItem({ captureSessionId })));
    let active = 0;
    let maxActive = 0;
    const remove = vi.fn(async (id: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      if (id === "became-ready") throw new Error("This Web Replay already exists online.");
    });
    const progress = vi.fn();

    const result = await keepWebReplayUploadsLocalOnly(candidates, remove, progress);

    expect(result.keptCount).toBe(2);
    expect(result.failures).toEqual([{ ...candidates[1], error: "This Web Replay already exists online." }]);
    expect(remove.mock.calls.map(([id]) => id)).toEqual(["first", "became-ready", "last"]);
    expect(maxActive).toBe(1);
    expect(progress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it("uses only the confirmed snapshot if the queue changes during removal", async () => {
    const candidates = webReplayKeepLocalCandidates(["first", "second"].map((captureSessionId) => pendingItem({ captureSessionId })));
    const remove = vi.fn(async (id: string) => {
      if (id === "first") {
        candidates[1].captureSessionId = "changed-after-confirmation";
        candidates.push({ captureSessionId: "new-arrival", title: "New game" });
      }
    });

    expect(await keepWebReplayUploadsLocalOnly(candidates, remove)).toEqual({ keptCount: 2, failures: [] });
    expect(remove.mock.calls.map(([id]) => id)).toEqual(["first", "second"]);
  });

  it("does nothing for an empty selection and does not overcount duplicate selections", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    expect(await keepWebReplayUploadsLocalOnly([], remove)).toEqual({ keptCount: 0, failures: [] });
    expect(remove).not.toHaveBeenCalled();
    const [candidate] = webReplayKeepLocalCandidates([pendingItem()]);
    expect(await keepWebReplayUploadsLocalOnly([candidate, candidate], remove)).toEqual({ keptCount: 1, failures: [] });
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
