import { describe, expect, it } from "vitest";
import {
  enhancedInsightDecisionsForDraft,
  normalizePendingEnhancedInsightMarkers,
  removePersistedEnhancedInsightMarkers,
  type PendingEnhancedInsightMarker
} from "../src/shared/enhancedInsightPendingMarkers";
import type { MatchDraft } from "../src/shared/types";

function marker(sessionStartedAt = "2026-09-01T18:00:00.000Z"): PendingEnhancedInsightMarker {
  return {
    platform: "atlas",
    sessionStartedAt,
    decision: {
      id: "decision-1",
      capturedAt: "2026-09-01T18:04:00.000Z",
      family: "mulligan",
      source: "live-flag",
      createdAt: "2026-09-01T18:04:00.000Z"
    }
  };
}

function draft(capturedAt = "2026-09-01T18:00:00.000Z"): Pick<MatchDraft, "platform" | "capturedAt" | "updatedAt" | "insightContext"> {
  return {
    platform: "atlas",
    capturedAt,
    updatedAt: "2026-09-01T18:10:00.000Z"
  };
}

describe("pending Enhanced Insight markers", () => {
  it("keeps a matched marker retryable until its context is durably persisted", () => {
    const pending = [marker()];
    const firstAttempt = enhancedInsightDecisionsForDraft(pending, draft());

    expect(firstAttempt.map((decision) => decision.id)).toEqual(["decision-1"]);
    // A rejected save does not call the commit-removal helper.
    expect(enhancedInsightDecisionsForDraft(pending, draft()).map((decision) => decision.id)).toEqual(["decision-1"]);

    const persistedContext: NonNullable<MatchDraft["insightContext"]> = {
      version: 1,
      capturedWithEnhancedInsights: true,
      activeGoalIds: [],
      decisions: firstAttempt,
      updatedAt: "2026-09-01T18:11:00.000Z"
    };
    expect(removePersistedEnhancedInsightMarkers(pending, persistedContext)).toEqual([]);
  });

  it("does not attach or discard an older session marker when a later session draft arrives", () => {
    const pending = [marker()];
    const laterDraft = draft("2026-09-01T19:00:00.000Z");

    expect(enhancedInsightDecisionsForDraft(pending, laterDraft)).toEqual([]);
    expect(removePersistedEnhancedInsightMarkers(pending, laterDraft.insightContext)).toEqual(pending);
  });

  it("normalizes malformed persisted decision fields before Match Review can render them", () => {
    const normalized = normalizePendingEnhancedInsightMarkers([{
      platform: "atlas",
      sessionStartedAt: "2026-09-01T18:00:00.000Z",
      decision: {
        id: " persisted-decision ",
        capturedAt: "not-a-date",
        family: "not-a-family",
        decision: "mulligan-keep",
        assessment: "definitely-correct",
        source: "live-flag",
        createdAt: "2026-09-01T18:04:00.000Z"
      }
    }], {
      nowMs: Date.parse("2026-09-01T18:05:00.000Z"),
      maxAgeMs: 12 * 60 * 60 * 1_000,
      maxMarkers: 64
    });

    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.decision).toMatchObject({
      id: "persisted-decision",
      capturedAt: "2026-09-01T18:04:00.000Z",
      family: "other",
      assessment: "unsure",
      source: "live-flag"
    });
    expect(normalized[0]?.decision).not.toHaveProperty("decision");
  });

  it("rejects expired or non-live persisted marker records", () => {
    const stale = marker("2026-09-01T05:00:00.000Z");
    const wrongSource = {
      ...marker(),
      decision: { ...marker().decision, source: "post-game" }
    };
    expect(normalizePendingEnhancedInsightMarkers([stale, wrongSource], {
      nowMs: Date.parse("2026-09-01T18:05:00.000Z"),
      maxAgeMs: 12 * 60 * 60 * 1_000
    })).toEqual([]);
  });
});
