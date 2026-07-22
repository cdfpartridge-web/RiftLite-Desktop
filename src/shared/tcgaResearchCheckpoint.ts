export interface TcgaResearchCheckpointDecision {
  reason: string;
  currentTime: number;
  lastCheckpointAt: number;
  interactionPending: boolean;
  minimumIntervalMs: number;
}

export function shouldCaptureTcgaResearchCheckpoint(
  decision: TcgaResearchCheckpointDecision
): boolean {
  return decision.interactionPending ||
    decision.reason === "initial" ||
    decision.reason === "tcga-replay-research-enabled" ||
    decision.currentTime - decision.lastCheckpointAt >= decision.minimumIntervalMs;
}
