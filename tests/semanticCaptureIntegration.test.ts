import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gamePreloadSource = readFileSync(new URL("../src/game-preload/gamePreload.ts", import.meta.url), "utf8");
const trackerSource = readFileSync(new URL("../src/main/services/matchSessionTracker.ts", import.meta.url), "utf8");

describe("Atlas semantic capture integration", () => {
  it("includes retained log rows in the snapshot signature", () => {
    expect(gamePreloadSource).toContain("replayRows: replayRowsSnapshotSignature(data.rows)");
    expect(gamePreloadSource).toContain("function replayRowsSnapshotSignature(value: unknown)");
  });

  it("treats character-data changes inside match-log rows as meaningful mutations", () => {
    expect(gamePreloadSource).toContain("rawTarget instanceof Element ? rawTarget : rawTarget.parentElement");
    expect(gamePreloadSource).toContain("const logTarget = targetElement?.closest");
    expect(gamePreloadSource).toContain("meaningfulTarget?.getAttribute(\"role\")");
    expect(gamePreloadSource).toContain("meaningfulTarget?.className");
    expect(gamePreloadSource).toContain("node.textContent ?? \"\"");
  });

  it("retains explicit actor evidence exposed by Atlas log-row attributes", () => {
    expect(gamePreloadSource).toContain("data-player-side");
    expect(gamePreloadSource).toContain("data-player-name");
    expect(gamePreloadSource).toContain("...(row.side ? { side: row.side.slice(0, 48) } : {})");
    expect(gamePreloadSource).toContain("...(row.actor ? { actor: row.actor.slice(0, 80) } : {})");
  });

  it("retains room-scoped first-observed times for stable semantic log-row identities", () => {
    expect(gamePreloadSource).toContain("const logRows = readAtlasLogRows(roomCode)");
    expect(gamePreloadSource).toContain("const atlasLogRowObservationTracker = new AtlasLogRowObservationTracker()");
    expect(gamePreloadSource).toContain("atlasLogRowObservationTracker.observe(");
    expect(gamePreloadSource).toContain("fingerprint: row.semanticRow");
    expect(gamePreloadSource).toContain("instanceHint: row.instanceHint");
    expect(gamePreloadSource).toContain("observedAt: observations[index].observedAt");
    expect(trackerSource).toContain("readString(record.observedAt)");
    expect(trackerSource).toContain('stableRowKey.startsWith("riftlite-log:")');
  });
});

describe("Enhanced Insights evidence envelopes", () => {
  it("numbers retained replay events and carries exact turn context separately from inferred evidence", () => {
    expect(trackerSource).toContain("replayNextSequence: number");
    expect(trackerSource).toContain("replayTurnNumberByGame: Map<number, number>");
    expect(trackerSource).toContain("sequence: event.sequence ?? session.replayNextSequence");
    expect(trackerSource).toContain("event.turnNumber == null && turnNumber > 0 ? { turnNumber } : {}");
    expect(trackerSource).toContain('? "game-log"');
    expect(trackerSource).toContain('confidence: source === "game-data" || source === "game-log" ? "confirmed" : "reconstructed"');
  });
});
