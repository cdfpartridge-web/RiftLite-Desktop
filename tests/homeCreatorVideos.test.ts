import { describe, expect, it } from "vitest";

import {
  DEFAULT_HOME_CONFIG_URL,
  DEFAULT_HOME_LIVE_TAKEOVER_URL,
  HOME_FEED_REFRESH_MS,
  HOME_LIVE_TAKEOVER_BACKGROUND_REFRESH_MS,
  HOME_LIVE_TAKEOVER_FAILURE_MAX_REFRESH_MS,
  HOME_LIVE_TAKEOVER_IDLE_REFRESH_MS,
  HOME_LIVE_TAKEOVER_REFRESH_MS,
  homeCreatorVideoDateLabel,
  homeCreatorVideoFeedFromConfig,
  homeLiveTakeoverFromConfig,
  homeLiveTakeoverRefreshMs,
  nextHomeCreatorVideoIndex,
  resolveHomeConfigUrl,
  resolveHomeLiveTakeoverUrl,
  shouldAutoAdvanceHomeCreatorVideo
} from "../src/renderer/homeCreatorVideos.js";

describe("Home creator video feed", () => {
  it("prefers creator videos, preserves attribution, deduplicates, and respects maxItems", () => {
    const feed = homeCreatorVideoFeedFromConfig({
      creatorVideoCarousel: { enabled: true, rotationSeconds: 9, maxItems: 2 },
      creatorVideosUpdatedAt: "2026-08-04T09:30:00.000Z",
      creatorVideos: [
        creatorVideo("abcdefghijk", "Riftlab one"),
        creatorVideo("abcdefghijk", "Duplicate"),
        creatorVideo("lmnopqrstuv", "Riftlab two"),
        creatorVideo("zyxwvutsrqp", "Ignored by max")
      ],
      featuredVideos: [creatorVideo("4n0x_t-wprg", "Legacy")]
    });

    expect(feed.source).toBe("creator");
    expect(feed.updatedAt).toBe("2026-08-04T09:30:00.000Z");
    expect(feed.carousel).toEqual({ enabled: true, rotationSeconds: 9, maxItems: 2 });
    expect(feed.videos.map((video) => video.videoId)).toEqual(["abcdefghijk", "lmnopqrstuv"]);
    expect(feed.videos[0]).toMatchObject({
      creatorId: "riftlab",
      creatorName: "Riftlab",
      channelUrl: "https://www.youtube.com/@RiftlabTCG",
      publishedAt: "2026-08-04T08:00:00.000Z",
      url: "https://www.youtube.com/watch?v=abcdefghijk"
    });
    expect(feed.videos[0].embedUrl).toContain("youtube.com/embed/abcdefghijk");
  });

  it("falls back to legacy videos when the creator feed is unavailable or disabled", () => {
    const legacy = creatorVideo("4n0x_t-wprg", "Legacy video");

    expect(homeCreatorVideoFeedFromConfig({ featuredVideos: [legacy] })).toMatchObject({
      source: "legacy",
      videos: [{ videoId: "4n0x_t-wprg", title: "Legacy video" }]
    });
    expect(homeCreatorVideoFeedFromConfig({
      creatorVideoCarousel: { enabled: false },
      creatorVideos: [creatorVideo("abcdefghijk", "Creator")],
      featuredVideo: legacy
    })).toMatchObject({
      source: "legacy",
      carousel: { enabled: false },
      videos: [{ videoId: "4n0x_t-wprg" }]
    });
  });

  it("uses bundled defaults when both remote feeds are malformed", () => {
    const feed = homeCreatorVideoFeedFromConfig({
      creatorVideos: [{ videoId: "bad" }],
      featuredVideos: [{ url: "javascript:alert(1)" }]
    });

    expect(feed.source).toBe("legacy");
    expect(feed.videos).toHaveLength(2);
    expect(feed.videos.every((video) => video.url.startsWith("https://www.youtube.com/watch"))).toBe(true);
  });

  it("bounds remote carousel settings", () => {
    expect(homeCreatorVideoFeedFromConfig({
      creatorVideoCarousel: { rotationSeconds: 1, maxItems: 500 }
    }).carousel).toEqual({ enabled: true, rotationSeconds: 5, maxItems: 50 });
  });

  it("accepts only an enabled, server-confirmed Twitch takeover and rebuilds its URLs", () => {
    const takeover = homeLiveTakeoverFromConfig({
      enabled: true,
      active: true,
      provider: "twitch",
      status: "live",
      channelLogin: "BMUCasts",
      title: "  Sunday   Riftbound live  ",
      embedUrl: "https://evil.example/player",
      channelUrl: "https://evil.example/channel",
      updatedAt: 1234,
      analytics: {
        runId: "run_1234567890123456",
        token: "signed-token-".repeat(5)
      }
    });

    expect(takeover).toEqual({
      provider: "twitch",
      channelLogin: "bmucasts",
      title: "Sunday Riftbound live",
      embedUrl: "https://player.twitch.tv/?channel=bmucasts&parent=www.riftlite.com&autoplay=true&muted=true",
      channelUrl: "https://www.twitch.tv/bmucasts",
      status: "live",
      updatedAt: 1234,
      analytics: {
        runId: "run_1234567890123456",
        token: "signed-token-".repeat(5)
      }
    });
  });

  it.each([
    { enabled: false, active: true, provider: "twitch", status: "live", channelLogin: "bmucasts" },
    { enabled: true, active: false, provider: "twitch", status: "live", channelLogin: "bmucasts" },
    { enabled: true, active: true, provider: "youtube", status: "live", channelLogin: "bmucasts" },
    { enabled: true, active: true, provider: "twitch", status: "offline", channelLogin: "bmucasts" },
    { enabled: true, active: true, provider: "twitch", status: "live", channelLogin: "bad/channel" }
  ])("fails closed for an invalid or unconfirmed takeover", (value) => {
    expect(homeLiveTakeoverFromConfig(value)).toBeNull();
  });
});

describe("Home creator video carousel behavior", () => {
  it("wraps manual and automatic indexes", () => {
    expect(nextHomeCreatorVideoIndex(0, -1, 14)).toBe(13);
    expect(nextHomeCreatorVideoIndex(13, 1, 14)).toBe(0);
    expect(nextHomeCreatorVideoIndex(4, 1, 0)).toBe(0);
  });

  it("advances only when motion and interaction state allow it", () => {
    const ready = {
      enabled: true,
      explicitlyPaused: false,
      interacting: false,
      playing: false,
      motionAllowed: true,
      itemCount: 14
    };
    expect(shouldAutoAdvanceHomeCreatorVideo(ready)).toBe(true);
    for (const patch of [
      { enabled: false },
      { explicitlyPaused: true },
      { interacting: true },
      { playing: true },
      { motionAllowed: false },
      { itemCount: 1 }
    ]) {
      expect(shouldAutoAdvanceHomeCreatorVideo({ ...ready, ...patch })).toBe(false);
    }
  });

  it("labels recent publication dates without requiring a date", () => {
    const now = new Date("2026-08-04T12:00:00.000Z");
    expect(homeCreatorVideoDateLabel("2026-08-04T08:00:00.000Z", now)).toBe("Today");
    expect(homeCreatorVideoDateLabel("2026-08-03T20:00:00.000Z", now)).toBe("Yesterday");
    expect(homeCreatorVideoDateLabel(undefined, now)).toBe("Featured video");
  });
});

describe("Home config URL override", () => {
  it("accepts HTTPS and local HTTP endpoints only", () => {
    expect(resolveHomeConfigUrl("https://preview.riftlite.com/api/app/home")).toBe("https://preview.riftlite.com/api/app/home");
    expect(resolveHomeConfigUrl("http://127.0.0.1:3000/api/app/home")).toBe("http://127.0.0.1:3000/api/app/home");
    expect(resolveHomeConfigUrl("http://localhost:3000/api/app/home")).toBe("http://localhost:3000/api/app/home");
    expect(resolveHomeConfigUrl("http://example.com/api/app/home")).toBe(DEFAULT_HOME_CONFIG_URL);
    expect(resolveHomeConfigUrl("file:///tmp/home.json")).toBe(DEFAULT_HOME_CONFIG_URL);
  });

  it("derives the lightweight live endpoint without changing the full-feed cadence", () => {
    expect(resolveHomeLiveTakeoverUrl("https://preview.riftlite.com/api/app/home"))
      .toBe("https://preview.riftlite.com/api/app/live-takeover");
    expect(resolveHomeLiveTakeoverUrl("not a URL")).toBe(DEFAULT_HOME_LIVE_TAKEOVER_URL);
    expect(HOME_FEED_REFRESH_MS).toBe(30 * 60 * 1_000);
    expect(HOME_LIVE_TAKEOVER_REFRESH_MS).toBe(60 * 1_000);
  });

  it("slows live checks when offline, unfocused, hidden, or repeatedly failing", () => {
    const foreground = {
      visible: true,
      focused: true,
      online: true,
      live: true,
      consecutiveFailures: 0
    };
    expect(homeLiveTakeoverRefreshMs(foreground)).toBe(HOME_LIVE_TAKEOVER_REFRESH_MS);
    expect(homeLiveTakeoverRefreshMs({ ...foreground, live: false })).toBe(HOME_LIVE_TAKEOVER_IDLE_REFRESH_MS);
    expect(homeLiveTakeoverRefreshMs({ ...foreground, visible: false })).toBe(HOME_LIVE_TAKEOVER_BACKGROUND_REFRESH_MS);
    expect(homeLiveTakeoverRefreshMs({ ...foreground, focused: false })).toBe(HOME_LIVE_TAKEOVER_BACKGROUND_REFRESH_MS);
    expect(homeLiveTakeoverRefreshMs({ ...foreground, online: false })).toBe(HOME_LIVE_TAKEOVER_BACKGROUND_REFRESH_MS);
    expect(homeLiveTakeoverRefreshMs({ ...foreground, live: false, consecutiveFailures: 5 }))
      .toBe(HOME_LIVE_TAKEOVER_FAILURE_MAX_REFRESH_MS);
  });
});

function creatorVideo(videoId: string, title: string) {
  return {
    videoId,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    creatorId: "riftlab",
    creatorName: "Riftlab",
    channelUrl: "https://www.youtube.com/@RiftlabTCG",
    publishedAt: "2026-08-04T08:00:00.000Z"
  };
}
