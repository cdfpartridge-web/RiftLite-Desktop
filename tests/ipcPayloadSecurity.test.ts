import { describe, expect, it } from "vitest";
import {
  RawCaptureIngressLimiter,
  validatedCaptureEvent,
  validatedRawCaptureFrame
} from "../src/shared/ipcPayloadSecurity.js";

describe("IPC payload security", () => {
  it("accepts a bounded capture event from its expected provider", () => {
    const event = validatedCaptureEvent({
      id: "atlas-1",
      platform: "atlas",
      kind: "match-start",
      capturedAt: "2026-07-19T12:00:00.000Z",
      url: "https://play.riftatlas.com/game/room",
      payload: { active: true }
    }, "atlas");

    expect(event).toMatchObject({ platform: "atlas", kind: "match-start" });
  });

  it("rejects platform spoofing, substring hosts, and malformed event schemas", () => {
    const base = {
      id: "atlas-1",
      platform: "atlas",
      kind: "match-start",
      capturedAt: "2026-07-19T12:00:00.000Z",
      url: "https://play.riftatlas.com/",
      payload: {}
    };
    expect(validatedCaptureEvent(base, "tcga")).toBeNull();
    expect(validatedCaptureEvent({ ...base, url: "https://evil.example/?riftatlas=1" }, "atlas")).toBeNull();
    expect(validatedCaptureEvent({ ...base, kind: "execute-shell" }, "atlas")).toBeNull();
    expect(validatedCaptureEvent({ ...base, unexpected: true }, "atlas")).toBeNull();
  });

  it("accepts only bounded Atlas frames from trusted websocket origins", () => {
    const payload = {
      platform: "atlas",
      requestUrl: "wss://realtime.riftatlas-workers.com/socket",
      frame: { seq: 2, ts: 1234, dir: "in", socketId: "socket-1", raw: "{\"type\":\"game\"}" }
    };
    expect(validatedRawCaptureFrame(payload)).toEqual(payload);
    expect(validatedRawCaptureFrame({ platform: payload.platform, frame: payload.frame })).toBeNull();
    expect(validatedRawCaptureFrame({ ...payload, requestUrl: "wss://evil.example/socket" })).toBeNull();
    expect(validatedRawCaptureFrame({ ...payload, requestUrl: "wss://realtime.riftatlas-workers.com:8443/socket" })).toBeNull();
    expect(validatedRawCaptureFrame({ ...payload, platform: "tcga" })).toBeNull();
    expect(validatedRawCaptureFrame({ ...payload, frame: { ...payload.frame, raw: "x".repeat(1_500_001) } })).toBeNull();
    expect(validatedRawCaptureFrame({ ...payload, frame: { ...payload.frame, raw: "not-json" } })).toBeNull();
    expect(validatedRawCaptureFrame({
      ...payload,
      frame: { ...payload.frame, raw: JSON.stringify({ type: "game", text: "é".repeat(750_000) }) }
    })).toBeNull();
  });

  it("rejects excessively deep raw JSON", () => {
    let nested: Record<string, unknown> = { type: "game" };
    for (let depth = 0; depth < 70; depth += 1) {
      nested = { child: nested };
    }
    expect(validatedRawCaptureFrame({
      platform: "atlas",
      requestUrl: "wss://realtime.riftatlas-workers.com/socket",
      frame: { seq: 2, ts: 1234, dir: "in", raw: JSON.stringify(nested) }
    })).toBeNull();
  });

  it("rate-limits raw frame count and bytes per guest", () => {
    const limiter = new RawCaptureIngressLimiter();
    const value = { frame: { raw: "x".repeat(1024 * 1024) } };
    for (let index = 0; index < 16; index += 1) {
      expect(limiter.allow(7, value, 1_000)).toBe(true);
    }
    expect(limiter.allow(7, value, 1_000)).toBe(false);
    expect(limiter.allow(8, value, 1_000)).toBe(true);
    expect(limiter.allow(7, value, 11_001)).toBe(true);
  });
});
