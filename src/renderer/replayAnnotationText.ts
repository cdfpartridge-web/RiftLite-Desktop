import type { ReplayAnnotation } from "../shared/types";

export type PendingReplayTextAnnotation = Omit<
  ReplayAnnotation,
  "id" | "text" | "createdAt" | "updatedAt"
> & { tool: "text" };

export function createReplayTextAnnotation(
  pending: PendingReplayTextAnnotation,
  rawText: string,
  id: string,
  createdAt: string
): ReplayAnnotation | null {
  const text = rawText.trim();
  if (!text) {
    return null;
  }
  return {
    ...pending,
    id,
    text,
    createdAt
  };
}
