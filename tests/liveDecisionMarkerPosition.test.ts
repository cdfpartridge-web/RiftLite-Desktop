import { describe, expect, it } from "vitest";
import { DEFAULT_MARKER_POSITION, markerPixels, markerPositionAt, parseMarkerPosition } from "../src/renderer/liveDecisionMarkerPosition";

const bounds = { width: 1000, height: 600, buttonWidth: 180, buttonHeight: 38 };
describe("live decision marker positioning", () => {
  it("starts at the original top-right inset", () => {
    expect(markerPixels(DEFAULT_MARKER_POSITION, bounds)).toEqual({ x: 808, y: 12 });
  });
  it("clamps a drag beyond every edge", () => {
    expect(markerPositionAt({ x: -100, y: 5000 }, bounds)).toEqual({ x: 0, y: 1 });
    expect(markerPositionAt({ x: 5000, y: -100 }, bounds)).toEqual({ x: 1, y: 0 });
  });
  it("preserves relative position when the game frame resizes", () => {
    const position = markerPositionAt({ x: 410, y: 281 }, bounds);
    expect(position).toEqual({ x: .5, y: .5 });
    expect(markerPixels(position, { ...bounds, width: 600, height: 300 })).toEqual({ x: 210, y: 131 });
  });
  it("keeps a marker reachable when there is less room than its normal inset", () => {
    expect(markerPixels({ x: 1, y: 1 }, { ...bounds, width: 190, height: 42 })).toEqual({ x: 5, y: 2 });
    expect(markerPixels({ x: 1, y: 1 }, { ...bounds, width: 100, height: 20 })).toEqual({ x: 0, y: 0 });
  });
  it("restores a finite preference and safely recovers damaged stored values", () => {
    expect(parseMarkerPosition('{"x":0.2,"y":0.7}')).toEqual({ x: .2, y: .7 });
    expect(parseMarkerPosition('{"x":-8,"y":5}')).toEqual({ x: 0, y: 1 });
    for (const raw of [null, "{broken", "null", "[]", '{"x":"1","y":0}', '{"x":1e400,"y":0}']) {
      expect(parseMarkerPosition(raw)).toEqual(DEFAULT_MARKER_POSITION);
    }
  });
});
