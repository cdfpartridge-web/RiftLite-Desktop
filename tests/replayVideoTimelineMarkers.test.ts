import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ReplayIntelligenceEvent } from "../src/shared/replayIntelligence.js";
import {
  REPLAY_VIDEO_TIMELINE_MARKERS_STORAGE_KEY,
  readReplayVideoTimelineMarkersEnabled,
  replayVideoTimelineMarkerSide,
  replayVideoTimelineMarkers,
  replayVideoTimelineScoreLabel,
  writeReplayVideoTimelineMarkersEnabled
} from "../src/shared/replayVideoTimelineMarkers.js";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");

function event(
  id: string,
  videoTimeMs: number,
  type: ReplayIntelligenceEvent["type"],
  patch: Partial<ReplayIntelligenceEvent> = {}
): ReplayIntelligenceEvent {
  return {
    id,
    capturedAt: new Date(Date.UTC(2026, 8, 1, 12, 0, 0) + videoTimeMs).toISOString(),
    gameNumber: 1,
    labelTime: "12:00",
    type,
    side: "me",
    text: `${id} event`,
    cardName: "",
    destination: "",
    battlefield: "",
    source: "game-data",
    confidence: "confirmed",
    confidenceReason: "Reported by the game.",
    videoTimeMs,
    turnLabel: "Turn 1",
    corrected: false,
    correctionNote: "",
    ...patch
  };
}

describe("replay video timeline markers", () => {
  it("keeps the automatic marker overlay off by default and safely remembers an explicit device choice", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    expect(readReplayVideoTimelineMarkersEnabled(storage)).toBe(false);
    writeReplayVideoTimelineMarkersEnabled(storage, true);
    expect(values.get(REPLAY_VIDEO_TIMELINE_MARKERS_STORAGE_KEY)).toBe("1");
    expect(readReplayVideoTimelineMarkersEnabled(storage)).toBe(true);
    writeReplayVideoTimelineMarkersEnabled(storage, false);
    expect(values.get(REPLAY_VIDEO_TIMELINE_MARKERS_STORAGE_KEY)).toBe("0");
    expect(readReplayVideoTimelineMarkersEnabled(storage)).toBe(false);

    values.set(REPLAY_VIDEO_TIMELINE_MARKERS_STORAGE_KEY, "true");
    expect(readReplayVideoTimelineMarkersEnabled(storage)).toBe(false);
    expect(readReplayVideoTimelineMarkersEnabled({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); }
    })).toBe(false);
    expect(() => writeReplayVideoTimelineMarkersEnabled({
      getItem: () => null,
      setItem: () => { throw new Error("quota"); }
    }, true)).not.toThrow();
  });

  it("maps explicit player ownership without dropping a near-simultaneous opponent event", () => {
    const markers = replayVideoTimelineMarkers([
      event("player-play", 1_000, "play", { side: "me" }),
      event("opponent-play", 1_000, "play", { side: "opponent" }),
      event("duplicate-player-play", 1_200, "play", { side: "me" }),
      event("next-game-player-play", 1_250, "play", { side: "me", gameNumber: 2 }),
      event("system-result", 3_000, "result", { side: "system" }),
      event("unknown-combat", 4_000, "combat", { side: "unknown" })
    ]);

    expect(markers.map((marker) => [marker.event.id, marker.side])).toEqual([
      ["player-play", "player"],
      ["opponent-play", "opponent"],
      ["next-game-player-play", "player"],
      ["system-result", "neutral"],
      ["unknown-combat", "neutral"]
    ]);
    expect(markers[0]?.accessibleLabel).toContain("Player play at 0:01");
    expect(markers[1]?.accessibleLabel).toContain("Opponent play at 0:01");
    expect(replayVideoTimelineMarkerSide("system")).toBe("neutral");
  });

  it("omits inferred evidence from automatic pins while retaining stronger and manually corrected events", () => {
    const markers = replayVideoTimelineMarkers([
      event("inferred-harnessed-dragon", 168_911, "play", {
        side: "system",
        text: "Played Harnessed Dragon from hand to base.",
        source: "game-log",
        confidence: "inferred"
      }),
      event("reconstructed-play", 170_000, "play", {
        source: "game-log",
        confidence: "reconstructed"
      }),
      event("confirmed-score", 172_000, "score", {
        pointsScored: 1,
        score: { me: 1, opponent: 0 }
      }),
      event("manual-note", 174_000, "combat", {
        source: "manual",
        confidence: "manual"
      })
    ]);

    expect(markers.map((marker) => marker.event.id)).toEqual([
      "reconstructed-play",
      "confirmed-score",
      "manual-note"
    ]);
  });

  it("does not attribute an inferred score delta to a conflicting explicit side", () => {
    const markers = replayVideoTimelineMarkers([
      event("baseline", 0, "scoreboard", { side: "system", score: { me: 0, opponent: 0 } }),
      event("conflicting-score", 2_000, "score", {
        side: "opponent",
        pointsScored: undefined,
        score: { me: 1, opponent: 0 }
      })
    ]);

    expect(markers[1]).toMatchObject({ side: "opponent", scoreDelta: undefined, scoreLabel: "1–0" });
    expect(markers[1]?.accessibleLabel).toContain("Opponent score update, total 1–0");
    expect(markers[1]?.accessibleLabel).not.toContain("Opponent scored 1 point");
  });

  it("shows captured score totals while retaining the scored-points detail", () => {
    const [player, opponent] = replayVideoTimelineMarkers([
      event("player-score", 2_000, "score", {
        side: "me",
        pointsScored: 2,
        score: { me: 4, opponent: 2 },
        text: "Player scored from two battlefields"
      }),
      event("opponent-score", 4_000, "score", {
        side: "opponent",
        pointsScored: 1,
        score: { me: 4, opponent: 3 },
        text: "Opponent held a battlefield"
      })
    ]);

    expect(player).toMatchObject({ side: "player", isScore: true, scoreLabel: "4–2", scoreDelta: 2 });
    expect(player?.accessibleLabel).toContain("Player scored 2 points, total 4–2 at 0:02");
    expect(opponent).toMatchObject({ side: "opponent", isScore: true, scoreLabel: "4–3", scoreDelta: 1 });
    expect(opponent?.accessibleLabel).toContain("Opponent scored 1 point, total 4–3 at 0:04");
    expect(replayVideoTimelineScoreLabel(event("delta-only", 0, "score", { pointsScored: 2 }))).toBe("+2");
  });

  it("infers scoreboard-only ownership only from an unambiguous same-game increase", () => {
    const markers = replayVideoTimelineMarkers([
      event("baseline", 0, "scoreboard", { side: "system", score: { me: 0, opponent: 0 } }),
      event("opponent-up", 2_000, "scoreboard", { side: "system", score: { me: 0, opponent: 1 } }),
      event("player-up", 4_000, "scoreboard", { side: "system", score: { me: 2, opponent: 1 } }),
      event("both-up", 6_000, "scoreboard", { side: "system", score: { me: 3, opponent: 2 } }),
      event("reset", 8_000, "scoreboard", { side: "system", score: { me: 0, opponent: 0 } }),
      event("partial", 10_000, "scoreboard", { side: "system", score: { me: 1 } }),
      event("after-partial", 11_000, "scoreboard", { side: "system", score: { me: 2, opponent: 0 } }),
      event("unknown-baseline", 12_000, "scoreboard", { side: "system", gameNumber: undefined, score: { me: 0, opponent: 0 } }),
      event("unknown-up", 14_000, "scoreboard", { side: "system", gameNumber: undefined, score: { me: 0, opponent: 1 } })
    ]);

    expect(markers.map((marker) => [marker.event.id, marker.side, marker.scoreDelta, marker.scoreLabel])).toEqual([
      ["baseline", "neutral", undefined, "0–0"],
      ["opponent-up", "opponent", 1, "0–1"],
      ["player-up", "player", 2, "2–1"],
      ["both-up", "neutral", undefined, "3–2"],
      ["reset", "neutral", undefined, "0–0"],
      ["partial", "neutral", undefined, "Score"],
      ["after-partial", "neutral", undefined, "2–0"],
      ["unknown-baseline", "neutral", undefined, "0–0"],
      ["unknown-up", "neutral", undefined, "0–1"]
    ]);
  });

  it("collapses a scoreboard snapshot paired with an explicit scoring event", () => {
    const markers = replayVideoTimelineMarkers([
      event("scoreboard", 3_000, "scoreboard", { side: "system", score: { me: 1, opponent: 0 } }),
      event("explicit-score", 3_500, "score", {
        side: "me",
        pointsScored: 1,
        score: { me: 1, opponent: 0 }
      }),
      event("manual-opponent", 6_000, "score", {
        side: "opponent",
        confidence: "manual",
        pointsScored: 1,
        score: { me: 1, opponent: 1 }
      })
    ]);

    expect(markers.map((marker) => marker.event.id)).toEqual(["explicit-score", "manual-opponent"]);
    expect(markers[1]).toMatchObject({ side: "opponent", scoreLabel: "1–1" });
    expect(markers[1]?.accessibleLabel).toContain("Manual evidence");
  });

  it("transfers a companion scoreboard total to a score event that lacks one", () => {
    const markers = replayVideoTimelineMarkers([
      event("baseline", 0, "scoreboard", { side: "system", score: { me: 0, opponent: 0 } }),
      event("scoreboard", 3_000, "scoreboard", { side: "system", score: { me: 1, opponent: 0 } }),
      event("inferred-hold", 3_000, "score", {
        side: "me",
        pointsScored: 1,
        score: undefined,
        confidence: "reconstructed"
      })
    ]);

    expect(markers.map((marker) => marker.event.id)).toEqual(["baseline", "inferred-hold"]);
    expect(markers[1]).toMatchObject({ side: "player", scoreDelta: 1, scoreLabel: "1–0" });
    expect(markers[1]?.event.score).toEqual({ me: 1, opponent: 0 });
  });

  it("keeps nearby mismatched score totals as separate markers", () => {
    const markers = replayVideoTimelineMarkers([
      event("baseline", 0, "scoreboard", { side: "system", score: { me: 0, opponent: 0 } }),
      event("scoreboard", 3_000, "scoreboard", { side: "system", score: { me: 1, opponent: 0 } }),
      event("different-total", 3_100, "score", {
        side: "me",
        pointsScored: 1,
        score: { me: 2, opponent: 0 }
      })
    ]);

    expect(markers.map((marker) => [marker.event.id, marker.scoreLabel])).toEqual([
      ["baseline", "0–0"],
      ["scoreboard", "1–0"],
      ["different-total", "2–0"]
    ]);
  });

  it("does not pair through an incomplete scoreboard interval", () => {
    const markers = replayVideoTimelineMarkers([
      event("baseline", 0, "scoreboard", { side: "system", score: { me: 0, opponent: 0 } }),
      event("partial", 2_000, "scoreboard", { side: "system", score: { me: 1 } }),
      event("later-total", 4_000, "scoreboard", { side: "system", score: { me: 2, opponent: 0 } }),
      event("nearby-score", 4_000, "score", { side: "me", pointsScored: 1, score: undefined })
    ]);

    expect(markers.map((marker) => [marker.event.id, marker.side, marker.scoreLabel])).toEqual([
      ["baseline", "neutral", "0–0"],
      ["partial", "neutral", "Score"],
      ["later-total", "neutral", "2–0"],
      ["nearby-score", "player", "+1"]
    ]);
  });

  it("wires side, score and non-colour labels into the replay surface", () => {
    expect(appSource).toContain("replayVideoTimelineMarkers(intelligenceEvents)");
    expect(appSource).toContain("data-side={marker.side}");
    expect(appSource).toContain("data-marker-lane={marker.side}");
    expect(appSource).toContain("data-score-marker={marker.isScore || undefined}");
    expect(appSource).toContain("aria-label={marker.accessibleLabel}");
    expect(appSource).toMatch(/className="replay-marker-rail"[\s\S]*?<span className="replay-marker-progress"[^>]*\/>\s*<\/div>\s*<div className="replay-marker-overlay" role="group"/);
    expect(appSource).toContain("Player</span>");
    expect(appSource).toContain("Opponent</span>");
    expect(appSource).toContain("Score badges show the captured total");
    expect(appSource).toContain("const [automaticMarkersEnabled, setAutomaticMarkersEnabled] = useState(readAutomaticReplayTimelineMarkers)");
    expect(appSource).toContain("automaticMarkersEnabled ? intelligencePins.map((marker) =>");
    expect(appSource).toContain("Show automatic events &amp; scores");
    expect(appSource).toContain("writeAutomaticReplayTimelineMarkers(enabled)");
    expect(appSource).toMatch(/automaticMarkersEnabled \? intelligencePins\.map[\s\S]*?\) : null\}\s*\{sortedFlags\.map/);
    expect(appSource).toMatch(/\{automaticMarkersEnabled \? \([\s\S]*?className="replay-timeline-legend"[\s\S]*?\) : null\}/);
    expect(styleSource).toContain("--replay-timeline-player: #63dfa5");
    expect(styleSource).toContain("--replay-timeline-opponent: #ff667d");
    expect(styleSource).toContain('.replay-intelligence-marker-pin[data-score-marker="true"]');
    expect(styleSource).toContain("border: 2px solid var(--replay-timeline-score)");
    expect(styleSource).toContain('.replay-intelligence-marker-pin[data-marker-lane="player"] { top: 10px; }');
    expect(styleSource).toContain('.replay-intelligence-marker-pin[data-marker-lane="opponent"] { top: calc(100% - 10px); }');
    expect(styleSource).toMatch(/\.replay-marker-pin \{[\s\S]*?z-index: 5;/);
    expect(styleSource).toMatch(/\.replay-intelligence-marker-pin\[data-score-marker="true"\] \{[\s\S]*?z-index: 2;/);
    expect(styleSource).toContain(".replay-timeline-marker-toggle");
  });
});
