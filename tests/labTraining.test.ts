import { describe, expect, it } from "vitest";

import { isLabReviewDue, labReviewDueLabel, labWilsonInterval, nextLabReviewProgress } from "../src/shared/labTraining";

const NOW = "2026-08-16T12:00:00.000Z";

describe("shared Lab review scheduling", () => {
  it("returns a bounded Wilson interval and rejects impossible counts", () => {
    expect(labWilsonInterval(8, 10)).toMatchObject({ lower: expect.any(Number), upper: expect.any(Number) });
    expect(labWilsonInterval(8, 10)?.lower).toBeLessThan(0.8);
    expect(labWilsonInterval(8, 10)?.upper).toBeGreaterThan(0.8);
    expect(labWilsonInterval(11, 10)).toBeNull();
  });
  it("schedules a reliable Challenge disagreement for the next day", () => {
    expect(nextLabReviewProgress({
      answeredAt: NOW,
      evidenceTier: "challenge",
      confidence: "certain",
      needsReview: true,
      reviewing: false,
    })).toEqual({ dueAt: "2026-08-17T12:00:00.000Z", intervalDays: 1, successfulReviews: 0 });
  });

  it("never turns exploratory evidence into a review mistake", () => {
    expect(nextLabReviewProgress({
      answeredAt: NOW,
      evidenceTier: "explore",
      confidence: "guess",
      needsReview: true,
      reviewing: false,
    })).toBeNull();
  });

  it("returns an uncertain Guided decision without calling it wrong", () => {
    expect(nextLabReviewProgress({
      answeredAt: NOW,
      evidenceTier: "guided",
      confidence: "unsure",
      needsReview: false,
      reviewing: false,
    })).toEqual({ dueAt: "2026-08-19T12:00:00.000Z", intervalDays: 3, successfulReviews: 0 });
  });

  it("expands successful review intervals from three to thirty days", () => {
    const first = nextLabReviewProgress({
      answeredAt: NOW,
      evidenceTier: "challenge",
      confidence: "certain",
      needsReview: false,
      reviewing: true,
      previous: { dueAt: NOW, intervalDays: 1, successfulReviews: 0 },
    });
    expect(first).toEqual({ dueAt: "2026-08-19T12:00:00.000Z", intervalDays: 3, successfulReviews: 1 });
    expect(nextLabReviewProgress({
      answeredAt: NOW,
      evidenceTier: "challenge",
      confidence: "certain",
      needsReview: false,
      reviewing: true,
      previous: { dueAt: NOW, intervalDays: 14, successfulReviews: 3 },
    })).toEqual({ dueAt: "2026-09-15T12:00:00.000Z", intervalDays: 30, successfulReviews: 4 });
  });

  it("reports due dates without mutating the schedule", () => {
    const progress = { dueAt: "2026-08-17T12:00:00.000Z", intervalDays: 1, successfulReviews: 0 };
    expect(isLabReviewDue(progress, new Date("2026-08-17T12:00:00.000Z"))).toBe(true);
    expect(isLabReviewDue(progress, new Date(NOW))).toBe(false);
    expect(labReviewDueLabel(progress, new Date(NOW))).toBe("Review tomorrow");
  });
});
