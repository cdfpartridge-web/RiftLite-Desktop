import { describe, expect, it } from "vitest";
import { shouldCaptureTcgaResearchCheckpoint } from "../src/shared/tcgaResearchCheckpoint";

describe("TCGA research DOM checkpoint cadence", () => {
  const base = {
    reason: "safety-heartbeat",
    currentTime: 15_000,
    lastCheckpointAt: 10_000,
    interactionPending: false,
    minimumIntervalMs: 10_000
  };

  it("does not turn the ordinary five-second heartbeat into a full DOM dump", () => {
    expect(shouldCaptureTcgaResearchCheckpoint(base)).toBe(false);
  });

  it("allows a periodic checkpoint once the research interval elapses", () => {
    expect(shouldCaptureTcgaResearchCheckpoint({ ...base, currentTime: 20_000 })).toBe(true);
  });

  it.each(["initial", "tcga-replay-research-enabled"])("always captures %s", (reason) => {
    expect(shouldCaptureTcgaResearchCheckpoint({ ...base, reason })).toBe(true);
  });

  it("always captures the post-interaction correlation point", () => {
    expect(shouldCaptureTcgaResearchCheckpoint({ ...base, interactionPending: true })).toBe(true);
  });
});
