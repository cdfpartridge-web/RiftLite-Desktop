import { describe, expect, it, vi } from "vitest";
import { CaptureCoordinator } from "../src/main/services/captureCoordinator";
import type { CaptureEvent, MatchDraft, UserSettings } from "../src/shared/types";

vi.mock("electron", () => {
  class MockNotification {
    static isSupported(): boolean {
      return false;
    }

    on(): MockNotification {
      return this;
    }

    show(): void {
      // no-op
    }
  }

  return {
    BrowserWindow: class MockBrowserWindow {},
    Notification: MockNotification
  };
});

const settings = {
  username: "BMU",
  firstRunComplete: true,
  syncMode: "community-and-hubs",
  communitySyncEnabled: true,
  firebaseUid: "",
  firebaseRefreshToken: "",
  debugMode: false,
  confirmationEnabled: true,
  replayCaptureEnabled: false,
  replayKeyframesEnabled: true,
  autoSaveAfterSeconds: 45,
  overlaySessionStartedAt: "",
  overlayDisplay: {
    profile: "grind",
    showBranding: true,
    showWebsite: true,
    showSession: true,
    showLatestMatch: true,
    showResult: true,
    showOpponentName: true,
    showScore: true,
    showPlatform: true,
    showDeck: true,
    showLegendWinRate: true,
    showMatchupWinRate: true,
    showActiveDeckStats: true,
    showDeckSessionStats: true,
    showDeckMatchups: true,
    showFooter: true
  },
  screenshotDirectory: "",
  screenshotHotkey: "F9",
  screenshotHotkeyEnabled: true,
  activeDeckId: "",
  activeHubs: []
} as UserSettings;

function event(kind: CaptureEvent["kind"], payload: Record<string, unknown>, capturedAt: string): CaptureEvent {
  return {
    id: `${kind}-${capturedAt}`,
    platform: "tcga",
    kind,
    capturedAt,
    url: kind === "match-end" ? "https://tcg-arena.fr/" : "https://tcg-arena.fr/play",
    payload
  };
}

function coordinatorHarness(options: { failSave?: boolean } = {}): {
  coordinator: CaptureCoordinator;
  saved: MatchDraft[];
  sent: Array<{ channel: string; payload: unknown }>;
} {
  const saved: MatchDraft[] = [];
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const store = {
    getSettings: vi.fn(async () => settings),
    getMatches: vi.fn(async () => saved),
    saveMatch: vi.fn(async (draft: MatchDraft) => {
      if (options.failSave) {
        throw new Error("database disk image is malformed");
      }
      const index = saved.findIndex((item) => item.id === draft.id);
      if (index >= 0) {
        saved[index] = draft;
      } else {
        saved.unshift(draft);
      }
      return draft;
    }),
    saveReplay: vi.fn(async () => undefined),
    deleteReplayByMatch: vi.fn(async () => undefined),
    getSavedDecks: vi.fn(async () => [])
  };
  const resolver = {
    resolveLegend: vi.fn(async () => ""),
    resolveBattlefield: vi.fn(async () => ""),
    resolveCard: vi.fn(async () => "")
  };
  const syncService = {
    syncMatch: vi.fn(async (draft: MatchDraft) => draft)
  };
  const diagnostics = {
    record: vi.fn(async () => undefined)
  };
  const win = {
    webContents: {
      send: vi.fn((channel: string, payload: unknown) => sent.push({ channel, payload }))
    }
  };

  return {
    coordinator: new CaptureCoordinator(
      store as never,
      () => win as never,
      resolver as never,
      syncService as never,
      diagnostics as never
    ),
    saved,
    sent
  };
}

describe("CaptureCoordinator", () => {
  it("opens a review from retained TCGA evidence when the final end event is empty", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();

    await coordinator.handleEvent(event("match-start", {
      active: true,
      myName: "BMU",
      opponentName: "Leman",
      myChampion: "Annie",
      opponentChampion: "Jinx",
      score: { me: "0", opp: "0", source: "tcga-counter-paired" }
    }, "2026-05-08T13:40:00.000Z"));
    await coordinator.handleEvent(event("match-snapshot", {
      active: true,
      myName: "BMU",
      opponentName: "Leman",
      myChampion: "Annie",
      opponentChampion: "Jinx",
      score: { me: "8", opp: "6", source: "tcga-counter-paired" }
    }, "2026-05-08T13:45:40.000Z"));
    await coordinator.handleEvent(event("match-snapshot", {
      active: false,
      score: { me: "", opp: "", source: "none" }
    }, "2026-05-08T13:45:54.000Z"));
    await coordinator.handleEvent(event("match-end", {
      active: false,
      reason: "inactive-debounce",
      score: { me: "", opp: "", source: "none" }
    }, "2026-05-08T13:45:55.000Z"));

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "tcga",
      status: "pending-review",
      result: "Win",
      format: "Bo1",
      score: "1-0",
      myName: "BMU",
      opponentName: "Leman",
      myChampion: "Annie",
      opponentChampion: "Jinx"
    });
    expect(saved[0].games[0]).toMatchObject({
      result: "Win",
      myPoints: 8,
      oppPoints: 6
    });
    expect(sent.some((item) => item.channel === "match:draft")).toBe(true);
  });

  it("force review falls back to the latest active capture platform", async () => {
    const { coordinator, saved } = coordinatorHarness();

    await coordinator.handleEvent(event("match-start", {
      active: true,
      myName: "BMU",
      opponentName: "Leman",
      myChampion: "Annie",
      opponentChampion: "Jinx",
      score: { me: "8", opp: "6", source: "tcga-counter-paired" }
    }, "2026-05-08T13:40:00.000Z"));

    const draft = await coordinator.forceReview("atlas");

    expect(draft).not.toBeNull();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "tcga",
      opponentName: "Leman",
      score: "1-0"
    });
  });

  it("still opens the review popup when local storage fails during capture", async () => {
    const { coordinator, sent } = coordinatorHarness({ failSave: true });

    await coordinator.handleEvent(event("match-start", {
      active: true,
      myName: "BMU",
      opponentName: "Spade",
      myChampion: "Viktor",
      opponentChampion: "LeBlanc",
      score: { me: "7", opp: "7", source: "tcga-counter-paired" }
    }, "2026-05-08T14:29:56.000Z"));
    await coordinator.handleEvent(event("match-end", {
      active: false,
      reason: "inactive-debounce",
      score: { me: "", opp: "", source: "none" }
    }, "2026-05-08T14:30:04.000Z"));

    const popup = sent.find((item) => item.channel === "match:draft")?.payload as MatchDraft | undefined;
    expect(popup).toMatchObject({
      platform: "tcga",
      opponentName: "Spade",
      result: "Incomplete",
      score: "",
      games: [
        expect.objectContaining({
          myPoints: 7,
          oppPoints: 7
        })
      ]
    });
  });
});
