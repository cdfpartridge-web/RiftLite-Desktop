import { describe, expect, it } from "vitest";
import {
  advanceEnhancedInsightLiveSession,
  isAtlasIntermediateGameEnd
} from "../src/shared/enhancedInsightLiveSession";
import type { CaptureEvent } from "../src/shared/types";

function capture(
  kind: CaptureEvent["kind"],
  capturedAt: string,
  payload: Record<string, unknown> = {},
  platform: CaptureEvent["platform"] = "atlas"
): CaptureEvent {
  return { id: `${kind}-${capturedAt}`, platform, kind, capturedAt, url: "https://play.riftatlas.com/game", payload };
}

describe("Enhanced Insights live session boundaries", () => {
  it("preserves the series clock and advances the game across an Atlas BO3 boundary", () => {
    const gameOneStart = capture("match-start", "2026-09-01T18:00:00.000Z", { atlasBo3GameNumber: 1 });
    const gameOneEnd = capture("match-end", "2026-09-01T18:12:00.000Z", {
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: "You win"
    });
    const gameTwoStart = capture("match-start", "2026-09-01T18:15:00.000Z", { atlasBo3GameNumber: 2 });

    const opened = advanceEnhancedInsightLiveSession(null, gameOneStart, true);
    const betweenGames = advanceEnhancedInsightLiveSession(opened, gameOneEnd, false);
    const continued = advanceEnhancedInsightLiveSession(betweenGames, gameTwoStart, false);

    expect(isAtlasIntermediateGameEnd(gameOneEnd)).toBe(true);
    expect(betweenGames).toMatchObject({
      enabledAtStart: true,
      gameNumber: 1,
      awaitingNextGame: true
    });
    expect(continued).toMatchObject({
      enabledAtStart: true,
      gameNumber: 2,
      awaitingNextGame: false
    });
    expect(continued?.startEvent.capturedAt).toBe(gameOneStart.capturedAt);
  });

  it("infers the next game only after an intermediate boundary and ignores duplicate starts", () => {
    const start = capture("match-start", "2026-09-01T18:00:00.000Z");
    const duplicate = capture("match-start", "2026-09-01T18:00:02.000Z");
    const boundary = capture("match-end", "2026-09-01T18:10:00.000Z", {
      reason: "result-text-detected",
      atlasResultKind: "game-result"
    });
    const next = capture("match-start", "2026-09-01T18:12:00.000Z");

    const opened = advanceEnhancedInsightLiveSession(null, start, true);
    const afterDuplicate = advanceEnhancedInsightLiveSession(opened, duplicate, true);
    const afterBoundary = advanceEnhancedInsightLiveSession(afterDuplicate, boundary, true);
    const continued = advanceEnhancedInsightLiveSession(afterBoundary, next, true);

    expect(afterDuplicate?.gameNumber).toBe(1);
    expect(continued?.gameNumber).toBe(2);
    expect(continued?.startEvent.capturedAt).toBe(start.capturedAt);
  });

  it("closes on a terminal result and pins the original opt-in choice", () => {
    const start = capture("match-start", "2026-09-01T18:00:00.000Z");
    const terminal = capture("match-end", "2026-09-01T18:20:00.000Z", {
      reason: "result-text-detected",
      atlasResultKind: "match-terminal"
    });
    const opened = advanceEnhancedInsightLiveSession(null, start, false);
    const duplicate = advanceEnhancedInsightLiveSession(opened, capture("match-start", "2026-09-01T18:00:02.000Z"), true);

    expect(duplicate?.enabledAtStart).toBe(false);
    expect(isAtlasIntermediateGameEnd(terminal)).toBe(false);
    expect(advanceEnhancedInsightLiveSession(duplicate, terminal, true)).toBeNull();
  });

  it("starts fresh when main reports a new same-platform session after an abandoned game", () => {
    const first = capture("match-start", "2026-09-01T18:00:00.000Z", {
      enhancedInsightsSessionStartedAt: "2026-09-01T18:00:00.000Z",
      enhancedInsightsEnabledAtStart: true
    });
    const abandoned = advanceEnhancedInsightLiveSession(null, first, true);
    const next = capture("match-start", "2026-09-01T19:00:00.000Z", {
      enhancedInsightsSessionStartedAt: "2026-09-01T19:00:00.000Z",
      enhancedInsightsEnabledAtStart: false
    });

    const restarted = advanceEnhancedInsightLiveSession(abandoned, next, false);
    expect(restarted).toMatchObject({
      sessionStartedAt: "2026-09-01T19:00:00.000Z",
      enabledAtStart: false,
      gameNumber: 1
    });
    expect(restarted?.startEvent.capturedAt).toBe("2026-09-01T19:00:00.000Z");
  });
});
