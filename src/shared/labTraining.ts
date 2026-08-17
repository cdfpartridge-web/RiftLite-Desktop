export type LabDecisionConfidence = "certain" | "unsure" | "guess";
export type LabEvidenceTier = "challenge" | "guided" | "explore";

export interface LabReviewProgress {
  dueAt: string;
  intervalDays: number;
  successfulReviews: number;
}

export interface LabReviewAttempt {
  answeredAt: string;
  evidenceTier: LabEvidenceTier;
  confidence: LabDecisionConfidence | null;
  needsReview: boolean;
  reviewing: boolean;
  previous?: LabReviewProgress | null;
}

export interface LabConfidenceInterval {
  lower: number;
  upper: number;
}

/** 95% Wilson score interval for honest small-sample percentage display. */
export function labWilsonInterval(successes: number, total: number): LabConfidenceInterval | null {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total < 1 || successes < 0 || successes > total) return null;
  const z = 1.959963984540054;
  const rate = successes / total;
  const denominator = 1 + z * z / total;
  const centre = (rate + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((rate * (1 - rate) + z * z / (4 * total)) / total) / denominator;
  return { lower: Math.max(0, centre - margin), upper: Math.min(1, centre + margin) };
}

const SUCCESS_INTERVAL_DAYS = [3, 7, 14, 30] as const;

/**
 * Builds the next device-local review date without treating weak evidence as
 * a mistake. Only contextual Challenges can create a correction review on
 * their own; Guided decisions return when the player explicitly felt unsure.
 */
export function nextLabReviewProgress(attempt: LabReviewAttempt): LabReviewProgress | null {
  const answeredAt = new Date(attempt.answeredAt);
  if (!Number.isFinite(answeredAt.getTime()) || attempt.evidenceTier === "explore") return null;

  if (attempt.needsReview && attempt.evidenceTier === "challenge") {
    return reviewAfter(answeredAt, 1, 0);
  }

  if (attempt.reviewing && !attempt.needsReview) {
    const successfulReviews = Math.min(4, (attempt.previous?.successfulReviews ?? 0) + 1);
    const intervalDays = SUCCESS_INTERVAL_DAYS[Math.min(successfulReviews - 1, SUCCESS_INTERVAL_DAYS.length - 1)];
    return reviewAfter(answeredAt, intervalDays, successfulReviews);
  }

  if (attempt.confidence !== "certain") {
    return reviewAfter(answeredAt, attempt.evidenceTier === "challenge" ? 2 : 3, 0);
  }

  return null;
}

export function isLabReviewDue(progress: LabReviewProgress | null | undefined, now = new Date()): boolean {
  if (!progress || !Number.isFinite(now.getTime())) return false;
  const due = Date.parse(progress.dueAt);
  return Number.isFinite(due) && due <= now.getTime();
}

export function labReviewDueLabel(progress: LabReviewProgress | null | undefined, now = new Date()): string {
  if (!progress) return "No review scheduled";
  const due = Date.parse(progress.dueAt);
  if (!Number.isFinite(due) || !Number.isFinite(now.getTime())) return "Review date unavailable";
  const days = Math.ceil((due - now.getTime()) / 86_400_000);
  if (days <= 0) return "Review due";
  if (days === 1) return "Review tomorrow";
  return `Review in ${days} days`;
}

function reviewAfter(answeredAt: Date, intervalDays: number, successfulReviews: number): LabReviewProgress {
  return {
    dueAt: new Date(answeredAt.getTime() + intervalDays * 86_400_000).toISOString(),
    intervalDays,
    successfulReviews,
  };
}
