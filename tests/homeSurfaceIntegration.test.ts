import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");

const artStart = appSource.indexOf("function homeOfficialDeckArtSources");
const artEnd = appSource.indexOf("function HomeOfficialArtStack", artStart);
const artSource = appSource.slice(artStart, artEnd);
const homeStart = appSource.indexOf("function HomeView");
const homeEnd = appSource.indexOf("type DeckComparisonSourceKind", homeStart);
const homeSource = appSource.slice(homeStart, homeEnd);

describe("Home launchpad", () => {
  it("promotes real deck, replay, community, and play destinations", () => {
    expect(homeSource).toContain("Your deck at a glance");
    expect(homeSource).toContain("View deck stats");
    expect(homeSource).toContain("Open my decks");
    expect(homeSource).toContain("Community decks");
    expect(homeSource).toContain("Explore decks");
    expect(homeSource).toContain("View my replays");
    expect(homeSource).toContain("Where are you playing?");
    expect(homeSource).toContain('onNavigate("replays")');
    expect(homeSource).toContain('onNavigate("community", { communityTab: "community-decks" })');
  });

  it("selects recent saved-deck performance and uses only verified card artwork", () => {
    expect(homeSource).toContain("mostRecentlyPlayedPerformance?.deck ?? activeDeck ?? mostRecentlyImportedDeck");
    expect(homeSource).toContain("featuredDeckPerformance?.completedMatches");
    expect(artStart).toBeGreaterThan(-1);
    expect(artSource).toContain("resolveBundledReplayCardImage(card.cardId || \"\") || resolveBundledReplayCardImage(card.imageUrl || \"\")");
    expect(artSource).toContain("legendImageUrl(legend)");
    expect(artSource).not.toContain("snapshot?.legendEntry?.imageUrl");
  });

  it("persists the default provider while preserving capture-safe platform switching", () => {
    expect(appSource).toContain('nextHealth.state === "match-detected" || nextHealth.state === "review-needed"');
    expect(appSource).toContain('nextView === "play" && healthRef.current.state === "review-needed"');
    expect(appSource).toContain('openPlay && healthRef.current.state === "review-needed"');
    expect(appSource).toContain("defaultPlatformSaveQueueRef");
    expect(appSource).toContain("window.riftlite.saveSettings({ defaultGamePlatform: platform })");
    expect(appSource).toContain("const persistedSettings = await window.riftlite.getSettings()");
    expect(appSource).toContain("chooseGamePlatform(settings.defaultGamePlatform, true)");
    expect(homeSource).toContain('data-platform={platform}');
    expect(homeSource).toContain("onSetDefaultGamePlatform(platform)");
    expect(mainSource).toContain(".home-platform-option[data-platform=");
  });

  it("ships responsive styles for the new launchpad surfaces", () => {
    for (const className of [
      ".modern-home-feature-row",
      ".modern-deck-glance",
      ".modern-deck-destinations",
      ".modern-play-now-card",
      ".modern-replay-action",
      ".modern-activity-summary"
    ]) {
      expect(stylesSource).toContain(className);
    }
  });
});
