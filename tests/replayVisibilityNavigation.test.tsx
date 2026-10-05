import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameReplayAssets, type GameReplayAssetsProps } from "../src/renderer/GameReplayAssets";
import { parseReplayOnlineTarget, replayVisibilityManagementUrl } from "../src/shared/replayVisibilityNavigation";

describe("past replay visibility navigation", () => {
  it("opens the exact replay without forwarding capture or arbitrary URL parameters", () => {
    const destination = replayVisibilityManagementUrl("https://riftlite.com/replays/rl2_test-1/?t=12&redirect=https://example.com#card");
    expect(destination).toBe("https://www.riftlite.com/replays/rl2_test-1?manage=visibility");
    expect(parseReplayOnlineTarget(destination!)).toEqual({ replayId: "rl2_test-1", manageVisibility: true });
    expect(parseReplayOnlineTarget("https://www.riftlite.com/replays/rl2_test-1?t=12")).toEqual({ replayId: "rl2_test-1", manageVisibility: false });
  });

  it.each([
    "https://www.riftlite.com.evil.example/replays/rl2_one",
    "https://www.riftlite.com:8443/replays/rl2_one",
    "https://account@www.riftlite.com/replays/rl2_one",
    "http://www.riftlite.com/replays/rl2_one",
    "https://www.riftlite.com/replays/rl2_one/other",
    "https://www.riftlite.com/replays/rl2_one%2Fother",
    "javascript:alert(1)"
  ])("does not send unsupported links to the authenticated replay surface: %s", (url) => {
    expect(parseReplayOnlineTarget(url)).toBeNull();
    expect(replayVisibilityManagementUrl(url)).toBeNull();
  });

  const props: GameReplayAssetsProps = {
    accountReady: true, webCaptureEnabled: false, videoRecordingEnabled: false, gameLogAvailable: false,
    cloudReplay: { id: "rl2_cloud", url: "https://www.riftlite.com/replays/rl2_cloud", status: "ready" },
    onWatchWebReplay: () => undefined
  };

  it("offers management for a past cloud replay without local capture or future uploads enabled", () => {
    const markup = renderToStaticMarkup(<GameReplayAssets {...props} />);
    expect(markup).toContain("Watch replay");
    expect(markup).toContain("Change visibility");
  });

  it("keeps watching available but hides management until the account is connected", () => {
    const markup = renderToStaticMarkup(<GameReplayAssets {...props} accountReady={false} />);
    expect(markup).toContain("Watch replay");
    expect(markup).not.toContain("Change visibility");
  });

  it("does not offer a past-replay control for a game that has never been uploaded", () => {
    expect(renderToStaticMarkup(<GameReplayAssets {...props} cloudReplay={undefined} />)).not.toContain("Change visibility");
  });
});
