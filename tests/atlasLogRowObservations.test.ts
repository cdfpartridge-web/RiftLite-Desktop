import { describe, expect, it } from "vitest";
import {
  AtlasLogRowObservationTracker,
  type AtlasLogRowObservationInput
} from "../src/shared/atlasLogRowObservations.js";

function row(fingerprint: string, instanceHint: string, explicitId?: string): AtlasLogRowObservationInput {
  return { fingerprint, instanceHint, explicitId };
}

function clock(): () => string {
  let offset = 0;
  return () => new Date(Date.UTC(2026, 8, 1, 12, 0, 0, offset++)).toISOString();
}

describe("Atlas log row first-observed identities", () => {
  it("keeps repeated rows distinct and stable through a complete DOM rerender", () => {
    const tracker = new AtlasLogRowObservationTracker();
    const now = clock();
    const initial = tracker.observe("room:alpha", [
      row("same action", "element-1"),
      row("same action", "element-2"),
      row("different action", "element-3")
    ], now);
    const rerendered = tracker.observe("room:alpha", [
      row("same action", "rerender-1"),
      row("same action", "rerender-2"),
      row("different action", "rerender-3")
    ], now);

    expect(new Set(initial.map((item) => item.key)).size).toBe(3);
    expect(new Set(initial.map((item) => item.observedAt)).size).toBe(3);
    expect(rerendered.map((item) => [item.key, item.observedAt])).toEqual(
      initial.map((item) => [item.key, item.observedAt])
    );
  });

  it("right-aligns duplicate rows when Atlas trims the old prefix and appends a new row", () => {
    const tracker = new AtlasLogRowObservationTracker();
    const now = clock();
    const initial = tracker.observe("room:alpha", [
      row("A", "element-a1"),
      row("A", "element-a2"),
      row("B", "element-b"),
      row("C", "element-c")
    ], now);
    const shifted = tracker.observe("room:alpha", [
      row("A", "new-element-a2"),
      row("B", "new-element-b"),
      row("C", "new-element-c"),
      row("D", "new-element-d")
    ], now);

    expect(shifted.slice(0, 3).map((item) => item.key)).toEqual(initial.slice(1).map((item) => item.key));
    expect(shifted.slice(0, 3).map((item) => item.observedAt)).toEqual(initial.slice(1).map((item) => item.observedAt));
    expect(shifted[3].key).not.toBe(initial[0].key);
  });

  it("preserves every overlapping key when the returned 28-row tail advances", () => {
    const tracker = new AtlasLogRowObservationTracker();
    const now = clock();
    const initialRows = Array.from({ length: 29 }, (_item, index) => row(`row-${index}`, `element-${index}`));
    const initialTail = tracker.observe("room:alpha", initialRows, now).slice(-28);
    const nextRows = [...initialRows, row("row-29", "element-29")];
    const nextTail = tracker.observe("room:alpha", nextRows, now).slice(-28);

    expect(nextTail.slice(0, -1).map((item) => item.key)).toEqual(initialTail.slice(1).map((item) => item.key));
    expect(nextTail.slice(0, -1).map((item) => item.observedAt)).toEqual(initialTail.slice(1).map((item) => item.observedAt));
  });

  it("never shares identities across rooms and rejects a recycled explicit DOM id with changed content", () => {
    const tracker = new AtlasLogRowObservationTracker();
    const now = clock();
    const roomA = tracker.observe("room:alpha", [row("A", "element-a", "log-row-1")], now)[0];
    const roomB = tracker.observe("room:beta", [row("A", "element-b", "log-row-1")], now)[0];
    const recycled = tracker.observe("room:beta", [row("B", "element-b", "log-row-1")], now)[0];

    expect(roomB.key).not.toBe(roomA.key);
    expect(roomB.observedAt).not.toBe(roomA.observedAt);
    expect(recycled.key).not.toBe(roomB.key);
    expect(recycled.observedAt).not.toBe(roomB.observedAt);
  });
});
