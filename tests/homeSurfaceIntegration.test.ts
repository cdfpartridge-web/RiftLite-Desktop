import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");
const livePlayerSource = readFileSync(new URL("../src/renderer/HomeLiveTakeoverPlayer.tsx", import.meta.url), "utf8");

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
    expect(homeSource).toContain("Train sideboarding");
    expect(homeSource).toContain("Where are you playing?");
    expect(homeSource).toContain('onNavigate("replays")');
    expect(homeSource).toContain('onNavigate("community", { communityTab: "community-decks" })');
    expect(homeSource).toContain('onNavigate("sideboard-lab")');
  });

  it("keeps the active deck's artwork and performance in sync, with sensible fallbacks", () => {
    expect(homeSource).toContain("activeDeck ?? mostRecentlyPlayedPerformance?.deck ?? mostRecentlyImportedDeck");
    expect(homeSource).not.toContain("mostRecentlyPlayedPerformance?.deck ?? activeDeck ?? mostRecentlyImportedDeck");
    expect(homeSource.indexOf('activeDeck?.id === featuredDeck?.id')).toBeLessThan(
      homeSource.indexOf('mostRecentlyPlayedPerformance?.deck.id === featuredDeck?.id')
    );
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
    expect(appSource).toContain('className="segmented home-default-platform"');
    expect(appSource).toContain('saveDefaultGamePlatform(settings.defaultGamePlatform === "atlas" ? "tcga" : "atlas")');
    expect(appSource).toContain("Switch default game to");
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

  it("applies optional active-deck colour themes without recolouring semantic results", () => {
    expect(appSource).toContain("settings?.homeDeckThemeEnabled && activeView === \"home\"");
    expect(appSource).toContain("homeDeckThemeForLegend(playActiveDeck?.legend)");
    expect(appSource).toContain("data-home-deck-theme={activeHomeDeckTheme?.id}");
    expect(appSource).toContain("Theme Home from active deck");
    expect(appSource).toContain("Available for every currently recognised legend");
    expect(appSource).toContain("HOME_DECK_DOMAIN_COLORS");
    expect(stylesSource).toContain(".app-shell[data-home-deck-theme] .modern-home");
    expect(stylesSource).toContain("--home-theme-primary-rgb");
    expect(stylesSource).not.toContain("[data-home-deck-theme] .modern-match-result");
    expect(stylesSource).not.toContain("[data-home-deck-theme] .modern-result-icon");
  });

  it("introduces Home themes once as an explicit opt-in", () => {
    expect(appSource).toContain("HOME_THEME_INTRO_LOCAL_STORAGE_KEY");
    expect(appSource).toContain('homeThemeIntroState?.status === "pending"');
    expect(appSource).toContain('activeView === "home"');
    expect(appSource).toContain("!settings.homeDeckThemeEnabled");
    expect(appSource).toContain("!releaseNotesOpen");
    expect(appSource).toContain('guidedTourState?.status !== "active"');
    expect(appSource).toContain("!showUpdatePrompt");
    expect(appSource).toContain("!reviewDraft");
    expect(appSource).toContain("saveSettings({ homeDeckThemeEnabled: true })");
    expect(stylesSource).toContain(".home-theme-intro-card");
  });

  it("uses a remotely controlled, muted Twitch takeover without polling the full video feed", () => {
    expect(homeSource).toContain("HOME_LIVE_TAKEOVER_URL");
    expect(homeSource).toContain("homeLiveTakeoverRefreshMs");
    expect(homeSource).toContain("homeLiveTakeoverFromConfig(payload.liveTakeover)");
    expect(homeSource).toContain("requestController.abort(), 12_000");
    expect(homeSource).toContain('document.addEventListener("visibilitychange"');
    expect(homeSource).toContain('window.addEventListener("focus"');
    expect(homeSource).toContain('window.addEventListener("online"');
    expect(homeSource).toContain('cache: "default"');
    expect(homeSource).toContain("previousLiveTakeover?.channelLogin !== nextLiveTakeover.channelLogin");
    expect(homeSource).not.toContain("setLiveTakeover(nextFeed.liveTakeover)");
    expect(livePlayerSource).toContain("riftlite-home-live-twitch-");
    expect(livePlayerSource).toContain('"media-started-playing"');
    expect(livePlayerSource).toContain('"media-paused"');
    expect(livePlayerSource).toContain("trackLiveTakeover");
    expect(homeSource).toContain("Starts muted.");
    expect(mainSource).toContain('webContents.setAudioMuted(true)');
    expect(mainSource).toContain('webContents.setAudioMuted(false)');
    expect(mainSource).toContain('webPreferences.autoplayPolicy = "document-user-activation-required"');
    expect(stylesSource).toContain('.modern-creator-video-card[data-live="true"]');
    expect(stylesSource).toContain("min-width: 420px");
    expect(stylesSource).toContain("min-height: 315px");
  });

  it("tracks creator-video plays and outbound carousel links by creator", () => {
    expect(homeSource).toContain('source: "home-creator-video-carousel"');
    expect(homeSource).toContain('trackHomeCreatorVideo("youtube-play")');
    expect(homeSource).toContain('openHomeCreatorVideoLink(featuredVideo.channelUrl!, "youtube-channel")');
    expect(homeSource).toContain('openHomeCreatorVideoLink(featuredVideo.url, "youtube-video")');
    expect(homeSource).toContain("spotlightId: featuredVideo.creatorId");
  });
});
