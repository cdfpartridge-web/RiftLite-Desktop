import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");

describe("Enhanced Insights replay mutation serialization", () => {
  it("orders replay saves and Enhanced Insights deletion on the same resilient queue", () => {
    expect(main).toContain("enhancedInsightsDataMutationQueue.then(operation, operation)");
    expect(main).toContain("enhancedInsightsDataMutationQueue = result.then(() => undefined, () => undefined)");
    expect(main).toMatch(
      /function saveReplayWithEnhancedInsightsDataMutation[\s\S]{0,240}enqueueEnhancedInsightsDataMutation\(\(\) => store\.saveReplay\(replay\)\)/
    );
    expect(main).toMatch(
      /handleTrustedAppIpc\("insights:clear-data"[\s\S]{0,240}enqueueEnhancedInsightsDataMutation/
    );
    expect(main).toMatch(
      /handleTrustedAppIpc\("replays:save"[\s\S]{0,180}saveReplayWithEnhancedInsightsDataMutation\(replay\)/
    );

    // Main-process import and recovery paths must not bypass the same barrier.
    expect(main.match(/store\.saveReplay\(/g)).toHaveLength(1);
    expect(main.match(/saveReplayWithEnhancedInsightsDataMutation\(/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps replay restore and replay-preserving video mutations out of the clear window", () => {
    for (const channel of [
      "replays:delete",
      "replays:delete-many",
      "replays:restore",
      "replays:purge",
      "replays:video:attach",
      "replays:video:delete-by-match"
    ]) {
      const escapedChannel = channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(main).toMatch(new RegExp(
        `handleTrustedAppIpc\\("${escapedChannel}"[\\s\\S]{0,220}enqueueEnhancedInsightsDataMutation`
      ));
    }
  });

  it("serializes every match mutation that can retain or restore stale decision context", () => {
    for (const channel of [
      "matches:combine-save",
      "matches:combine-undo",
      "matches:delete",
      "matches:restore",
      "matches:purge"
    ]) {
      const escapedChannel = channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(main).toMatch(new RegExp(
        `handleTrustedAppIpc\\("${escapedChannel}"[\\s\\S]{0,420}enqueueEnhancedInsightsDataMutation`
      ));
    }
  });
});
