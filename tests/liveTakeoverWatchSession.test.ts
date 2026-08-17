import { describe, expect, it, vi } from "vitest";

import { createLiveTakeoverWatchSession } from "../src/renderer/liveTakeoverWatchSession.js";
import type { LiveTakeoverTelemetryPayload } from "../src/shared/types.js";

describe("live takeover watch session", () => {
  it("counts only visible focused playback and emits a final anonymous duration", () => {
    let now = Date.parse("2026-08-15T12:00:00.000Z");
    const emitted: LiveTakeoverTelemetryPayload[] = [];
    const session = createLiveTakeoverWatchSession({
      takeover: {
        provider: "twitch",
        channelLogin: "stresscasts",
        title: "Live",
        embedUrl: "https://player.twitch.tv/?channel=stresscasts",
        channelUrl: "https://www.twitch.tv/stresscasts",
        status: "live",
        analytics: { runId: "run_1234567890123456", token: "token".repeat(10) },
      },
      sessionId: "session_1234567890123456",
      emit: (payload) => emitted.push(payload),
      now: () => now,
    })!;

    session.start();
    session.mediaStarted(true);
    now += 5 * 60_000;
    session.availabilityChanged(false);
    now += 10 * 60_000;
    session.availabilityChanged(true);
    now += 5 * 60_000;
    session.checkpoint();
    now += 2 * 60_000;
    session.finish();

    expect(emitted.map((event) => event.event)).toEqual([
      "impression",
      "playing",
      "paused",
      "playing",
      "checkpoint",
      "stopped",
    ]);
    expect(emitted.at(-1)).toMatchObject({
      hasPlayed: true,
      watchedSeconds: 720,
      runId: "run_1234567890123456",
      channelLogin: "stresscasts",
    });
    expect(emitted.at(-1)).not.toHaveProperty("installId");
  });

  it("does not emit after a dismissal and never counts an impression as playback", () => {
    const emit = vi.fn();
    const session = createLiveTakeoverWatchSession({
      takeover: {
        provider: "twitch",
        channelLogin: "stresscasts",
        title: "Live",
        embedUrl: "https://player.twitch.tv/?channel=stresscasts",
        channelUrl: "https://www.twitch.tv/stresscasts",
        status: "live",
        analytics: { runId: "run_1234567890123456", token: "token".repeat(10) },
      },
      sessionId: "session_1234567890123456",
      emit,
    })!;

    session.start();
    session.finish("dismissed");
    session.mediaStarted(true);
    session.checkpoint();

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0]?.[0]).toMatchObject({ event: "impression", hasPlayed: false, watchedSeconds: 0 });
    expect(emit.mock.calls[1]?.[0]).toMatchObject({ event: "dismissed", hasPlayed: false, watchedSeconds: 0 });
  });

  it("fails closed when the public takeover has no signed analytics access", () => {
    expect(createLiveTakeoverWatchSession({
      takeover: {
        provider: "twitch",
        channelLogin: "stresscasts",
        title: "Live",
        embedUrl: "https://player.twitch.tv/?channel=stresscasts",
        channelUrl: "https://www.twitch.tv/stresscasts",
        status: "live",
      },
      sessionId: "session_1234567890123456",
      emit: vi.fn(),
    })).toBeNull();
  });
});
