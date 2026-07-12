import { describe, expect, it } from "vitest";
import { AtlasFrameDeduper } from "../src/main/services/atlasFrameDeduper.js";
import type { RawCaptureAppendFramePayload } from "../src/shared/types.js";

function frame(raw: string): RawCaptureAppendFramePayload {
  return {
    platform: "atlas",
    requestUrl: "wss://realtime.riftatlas-workers.com/game",
    frame: {
      seq: 1,
      ts: 1,
      dir: "in",
      socketId: "socket-1",
      raw
    }
  };
}

describe("AtlasFrameDeduper", () => {
  it("uses debugger traffic only while the game preload is silent", () => {
    const deduper = new AtlasFrameDeduper(2_000, 15_000);

    expect(deduper.shouldIngest("game-preload", "contents-1", frame('{"type":"score"}'), 10_000)).toBe(true);
    expect(deduper.shouldIngest("main-debugger", "contents-1", frame('{"type":"different"}'), 24_999)).toBe(false);
    expect(deduper.shouldIngest("main-debugger", "contents-1", frame('{"type":"fallback"}'), 25_001)).toBe(true);
  });

  it("deduplicates the same frame when both sources race", () => {
    const deduper = new AtlasFrameDeduper(2_000, 15_000);
    const payload = frame('{"type":"gameAction","id":"event-1"}');

    expect(deduper.shouldIngest("main-debugger", "contents-1", payload, 1_000)).toBe(true);
    expect(deduper.shouldIngest("game-preload", "contents-1", payload, 1_001)).toBe(false);
  });

  it("preserves repeated frames from one authoritative source and isolates streams", () => {
    const deduper = new AtlasFrameDeduper();
    const payload = frame('{"type":"gameAction","id":"event-2"}');

    expect(deduper.shouldIngest("game-preload", "contents-1", payload, 1_000)).toBe(true);
    expect(deduper.shouldIngest("game-preload", "contents-1", payload, 1_001)).toBe(true);
    expect(deduper.shouldIngest("main-debugger", "contents-2", payload, 1_001)).toBe(true);
  });
});
