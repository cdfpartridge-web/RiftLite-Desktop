import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { CaptureEvent, MatchDraft } from "../src/shared/types";

// Execute the actual renderer callbacks with isolated IPC/timers, so these
// tests cover the async UI boundary without booting Electron or a user profile.
const source = ts.createSourceFile(
  "App.tsx",
  readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const names = [
  "schedulePendingReviewFallback", "clearPendingReviewFallback", "openLatestPendingReview",
  "latestPendingReviewMatch", "confirmDraft", "dismissReviewDraft", "deleteReviewDraft"
];
const declarations = new Map<string, string>();
let captureCallback = "";
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
    declarations.set(node.name.text, node.getText(source));
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "onCaptureEvent") {
    captureCallback = node.arguments[0].getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
if (declarations.size !== names.length || !captureCallback) {
  throw new Error("Could not find pending review callbacks in App.tsx");
}
const compiled = ts.transpileModule(
  `${[...declarations.values()].join("\n")}\nconst receiveCaptureEvent = ${captureCallback};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;

function harness() {
  let resolveMatches!: (matches: MatchDraft[]) => void;
  const pendingMatches = new Promise<MatchDraft[]>((resolve) => { resolveMatches = resolve; });
  const stalledOperation = new Promise<never>(() => undefined);
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const settings = { confirmationEnabled: true };
  const getMatches = vi.fn(() => pendingMatches);
  const dismissMatchReview = vi.fn();
  const setSettings = vi.fn();
  const setMatches = vi.fn();
  let review: MatchDraft | null = null;
  const setReviewDraft = vi.fn((update: (current: MatchDraft | null) => MatchDraft | null) => {
    review = update(review);
  });
  const healthRef = { current: { state: "review-needed" } };
  const environment = {
    window: {
      setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
      clearTimeout: (id: number) => timers.delete(id),
      riftlite: {
        getSettings: async () => settings,
        getMatches,
        dismissMatchReview,
        deleteMatch: vi.fn(() => stalledOperation)
      }
    },
    pendingReviewFallbackTimerRef: { current: undefined },
    pendingReviewFallbackGenerationRef: { current: 0 },
    healthRef, setSettings, setMatches, setReviewDraft,
    prepareDraftForReview: (draft: MatchDraft) => draft,
    isReviewDismissed: () => false,
    normalizeReviewDraft: (draft: MatchDraft) => draft,
    attachTestingSessionToDraft: (draft: MatchDraft) => draft,
    finalizeEnhancedInsightNotebookSnapshot: () => stalledOperation,
    settingsRef: { current: {} },
    enhancedInsightLiveSessionRef: { current: null },
    enhancedInsightStartEventRef: { current: null },
    enhancedInsightMatchOpenRef: { current: false },
    enhancedInsightCurrentGameNumberRef: { current: 1 },
    enhancedInsightSessionActiveRef: { current: false },
    advanceEnhancedInsightLiveSession: () => null,
    setEnhancedInsightSessionActive: vi.fn(),
    maybeStartReplayVideo: vi.fn(),
    updatePrepFromCaptureEvent: vi.fn(),
    DECK_TRACKER_FEATURE_ENABLED: false,
    scheduleDiagnosticsRefresh: vi.fn()
  };
  const api = new Function(
    ...Object.keys(environment),
    `${compiled}\nreturn {${names.join(",")}, receiveCaptureEvent};`
  )(...Object.values(environment)) as {
    schedulePendingReviewFallback(): void;
    clearPendingReviewFallback(): void;
    openLatestPendingReview(): Promise<boolean>;
    confirmDraft(draft: MatchDraft): Promise<void>;
    dismissReviewDraft(draft: MatchDraft): Promise<void>;
    deleteReviewDraft(draft: MatchDraft): Promise<void>;
    receiveCaptureEvent(event: CaptureEvent): void;
  };
  return {
    ...api, healthRef, settings, getMatches, dismissMatchReview, setSettings, setMatches, setReviewDraft,
    get review() { return review; },
    runTimer() {
      const timer = timers.entries().next().value;
      if (!timer) return;
      timers.delete(timer[0]);
      timer[1]();
    },
    async completeRead(matches: MatchDraft[]) {
      resolveMatches(matches);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
}

const pending = {
  id: "previous-game", status: "pending-review", capturedAt: "2026-10-13T18:00:00Z"
} as MatchDraft;
const start = { kind: "match-start", platform: "atlas", payload: {} } as CaptureEvent;

describe("automatic pending review fallback", () => {
  it("opens a current pending review after its IPC read finishes", async () => {
    const h = harness();
    h.schedulePendingReviewFallback();
    h.runTimer();
    await h.completeRead([pending]);
    expect(h.review?.id).toBe(pending.id);
    expect(h.setSettings).toHaveBeenCalledWith(h.settings);
    expect(h.setMatches).toHaveBeenCalledWith([pending]);
    expect(h.dismissMatchReview).not.toHaveBeenCalled();
  });

  it("does not restore a cancelled read even if health still says review-needed", async () => {
    const h = harness();
    h.schedulePendingReviewFallback();
    h.runTimer();
    h.clearPendingReviewFallback();
    await h.completeRead([pending]);
    expect(h.setSettings).not.toHaveBeenCalled();
    expect(h.setMatches).not.toHaveBeenCalled();
    expect(h.setReviewDraft).not.toHaveBeenCalled();
    expect(h.dismissMatchReview).not.toHaveBeenCalled();
  });

  it("does not open or dismiss reviews if capture has moved on during the IPC read", async () => {
    const h = harness();
    h.schedulePendingReviewFallback();
    h.runTimer();
    h.healthRef.current.state = "match-detected";
    await h.completeRead([pending]);
    expect(h.setSettings).not.toHaveBeenCalled();
    expect(h.setMatches).not.toHaveBeenCalled();
    expect(h.setReviewDraft).not.toHaveBeenCalled();
    expect(h.dismissMatchReview).not.toHaveBeenCalled();
  });

  it("cancels the scheduled fallback when a new game starts", async () => {
    const h = harness();
    h.schedulePendingReviewFallback();
    h.receiveCaptureEvent(start);
    h.runTimer();
    await h.completeRead([pending]);
    expect(h.getMatches).not.toHaveBeenCalled();
    expect(h.setReviewDraft).not.toHaveBeenCalled();
  });

  it("invalidates an already-running fallback when a new game starts", async () => {
    const h = harness();
    h.schedulePendingReviewFallback();
    h.runTimer();
    h.receiveCaptureEvent(start);
    await h.completeRead([pending]);
    expect(h.setMatches).not.toHaveBeenCalled();
    expect(h.setReviewDraft).not.toHaveBeenCalled();
    expect(h.dismissMatchReview).not.toHaveBeenCalled();
  });

  it.each(["confirmDraft", "dismissReviewDraft", "deleteReviewDraft"] as const)(
    "%s invalidates an old read before awaiting its own persistence",
    async (action) => {
      const h = harness();
      h.schedulePendingReviewFallback();
      h.runTimer();
      void h[action](pending);
      await h.completeRead([pending]);
      expect(h.setSettings).not.toHaveBeenCalled();
      expect(h.setMatches).not.toHaveBeenCalled();
      expect(h.setReviewDraft).not.toHaveBeenCalled();
      expect(h.dismissMatchReview).not.toHaveBeenCalled();
    }
  );

  it("keeps explicit review opening available after automatic fallback cancellation", async () => {
    const h = harness();
    h.schedulePendingReviewFallback();
    h.receiveCaptureEvent(start);
    h.healthRef.current.state = "match-detected";
    const result = h.openLatestPendingReview();
    await h.completeRead([pending]);
    expect(await result).toBe(true);
    expect(h.review?.id).toBe(pending.id);
  });

  it("dismisses a current empty review state when no pending match exists", async () => {
    const h = harness();
    h.schedulePendingReviewFallback();
    h.runTimer();
    await h.completeRead([]);
    expect(h.setReviewDraft).not.toHaveBeenCalled();
    expect(h.dismissMatchReview).toHaveBeenCalledOnce();
  });
});
