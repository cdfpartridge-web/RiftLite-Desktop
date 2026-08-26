import { describe, expect, it } from "vitest";
import { buildReplayIntelligence, replayWithIntelligence } from "../src/shared/replayIntelligence.js";
import type { ReplayIntelligenceCorrection, ReplayRecord, ReplayStructuredEvent } from "../src/shared/types.js";

const STARTED_AT = "2026-08-24T12:00:00.000Z";

function structuredEvent(
  id: string,
  seconds: number,
  type: ReplayStructuredEvent["type"],
  patch: Partial<ReplayStructuredEvent> = {}
): ReplayStructuredEvent {
  const capturedAt = new Date(Date.parse(STARTED_AT) + seconds * 1000).toISOString();
  return {
    id,
    sourceEventId: `source:${id}`,
    gameNumber: 1,
    capturedAt,
    labelTime: `12:${String(Math.floor(seconds / 60)).padStart(2, "0")}`,
    type,
    side: "me",
    text: type,
    cardName: "",
    destination: "",
    battlefield: "",
    ...patch
  };
}

function replay(platform: ReplayRecord["platform"] = "sim"): ReplayRecord {
  return {
    id: "replay-intelligence-test",
    matchId: "match-intelligence-test",
    platform,
    capturedAt: STARTED_AT,
    title: "Kai'Sa vs Jinx",
    players: { me: "Player", opponent: "Opponent" },
    events: [],
    structuredEvents: [
      structuredEvent("mulligan", 3, "mulligan", { side: "system", text: "Player completed mulligan" }),
      structuredEvent("turn", 5, "turn-start", { text: "Player's turn" }),
      structuredEvent("draw", 10, "draw", {
        text: "Player drew Kai'Sa's follower",
        cardName: "Kai'Sa's follower",
        cardId: "OGN-123",
        fromZone: "deck",
        toZone: "hand"
      }),
      structuredEvent("play", 70, "play", {
        text: "Player played Kai'Sa's follower",
        cardName: "Kai'Sa's follower",
        cardId: "OGN-123",
        fromZone: "hand",
        toZone: "battlefield",
        destination: "My battlefield"
      }),
      structuredEvent("score", 90, "score", {
        text: "Player scored 1 point",
        pointsScored: 1,
        score: { me: 1, opponent: 0 }
      })
    ],
    video: {
      id: "video",
      path: "C:/replays/test.webm",
      url: "riftlite-video://test",
      filename: "test.webm",
      directory: "C:/replays",
      mimeType: "video/webm",
      source: "game-frame-direct",
      platform,
      startedAt: STARTED_AT,
      endedAt: new Date(Date.parse(STARTED_AT) + 120_000).toISOString(),
      durationMs: 120_000,
      sizeBytes: 1_024,
      width: 1920,
      height: 1080,
      fps: 30,
      captureIntervalMs: 33,
      bitrateKbps: 6_000,
      codec: "vp9",
      quality: "balanced",
      hasAudio: false,
      containerFinalized: true
    }
  };
}

describe("Replay Intelligence", () => {
  it("builds a confirmed simulator story, video alignment and card journey", () => {
    const result = buildReplayIntelligence(replay());

    expect(result.summary.coverage.grade).toBe("medium");
    expect(result.summary.coverage.confirmed).toBe(result.events.length);
    expect(result.summary.stats.draws).toBe(1);
    expect(result.summary.stats.plays).toBe(1);
    expect(result.summary.stats.scoringEvents).toBe(1);
    expect(result.events.find((event) => event.id === "play")?.videoTimeMs).toBe(70_000);
    expect(result.summary.cardJourneys).toHaveLength(1);
    expect(result.summary.cardJourneys[0]).toMatchObject({
      cardName: "Kai'Sa's follower",
      knownHandTimeMs: 60_000,
      outcomes: ["drawn", "played"]
    });
    expect(result.summary.moments.some((moment) => moment.title === "Opening-hand decision")).toBe(true);
    expect(result.summary.moments.some((moment) => moment.kind === "swing")).toBe(true);
  });

  it("labels TCGA visible-state reconstruction honestly", () => {
    const tcgaReplay = replay("tcga");
    const result = buildReplayIntelligence(tcgaReplay);

    expect(result.summary.coverage.reconstructed).toBe(result.events.length);
    expect(result.summary.coverage.confirmed).toBe(0);
    expect(result.events.find((event) => event.type === "play")).toMatchObject({
      source: "state-diff",
      confidence: "reconstructed"
    });
    expect(result.summary.limitations.join(" ")).toContain("visible state changes");
  });

  it("applies a manual correction without changing captured source evidence", () => {
    const source = replay();
    const correction: ReplayIntelligenceCorrection = {
      id: "correction-1",
      eventId: "play",
      updatedAt: "2026-08-24T13:00:00.000Z",
      type: "move",
      text: "Player moved the follower to base",
      fromZone: "battlefield",
      toZone: "base",
      note: "Reviewed against the video."
    };
    const result = buildReplayIntelligence(source, undefined, [correction]);
    const corrected = result.events.find((event) => event.id === "play");

    expect(corrected).toMatchObject({
      type: "move",
      confidence: "manual",
      source: "manual",
      corrected: true,
      correctionNote: "Reviewed against the video."
    });
    expect(source.structuredEvents?.find((event) => event.id === "play")?.type).toBe("play");
    expect(result.summary.corrections).toEqual([correction]);
  });

  it("dismisses only the intelligence event while preserving it in the replay", () => {
    const source = replay();
    const correction: ReplayIntelligenceCorrection = {
      id: "dismiss-1",
      eventId: "draw",
      updatedAt: "2026-08-24T13:00:00.000Z",
      dismissed: true
    };
    const result = buildReplayIntelligence(source, undefined, [correction]);

    expect(result.events.some((event) => event.id === "draw")).toBe(false);
    expect(source.structuredEvents?.some((event) => event.id === "draw")).toBe(true);
    expect(result.summary.corrections).toEqual([correction]);
  });

  it("persists schema v5 summaries for export and later local review", () => {
    const next = replayWithIntelligence(replay());

    expect(next.schemaVersion).toBe(5);
    expect(next.intelligence?.version).toBe(1);
    expect(next.intelligence?.sourceEventCount).toBeGreaterThan(0);
    expect(next.intelligence?.story.length).toBeGreaterThan(0);
    expect(next.intelligence?.cardJourneys[0]?.events.length).toBe(2);
  });
});
