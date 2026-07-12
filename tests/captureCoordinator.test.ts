import { describe, expect, it, vi } from "vitest";
import { CaptureCoordinator, shouldOpenMatchCapturePopup } from "../src/main/services/captureCoordinator";
import type { CaptureEvent, GamePlatform, MatchDraft, UserSettings } from "../src/shared/types";

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

function event(
  kind: CaptureEvent["kind"],
  payload: Record<string, unknown>,
  capturedAt: string,
  platform: GamePlatform = "tcga",
  url?: string
): CaptureEvent {
  return {
    id: `${kind}-${capturedAt}`,
    platform,
    kind,
    capturedAt,
    url: url ?? (platform === "atlas"
      ? "https://play.riftatlas.com/game"
      : kind === "match-end" ? "https://tcg-arena.fr/" : "https://tcg-arena.fr/play"),
    payload
  };
}

function atlasMatchComplete(payload: Record<string, unknown>, capturedAt: string): CaptureEvent {
  return event("match-end", {
    ...payload,
    active: false,
    reason: "result-text-detected",
    atlasResultKind: "match-terminal",
    endText: "Match Complete"
  }, capturedAt, "atlas");
}

function draft(overrides: Partial<MatchDraft> = {}): MatchDraft {
  const capturedAt = overrides.capturedAt ?? "2026-05-20T10:00:00.000Z";
  return {
    id: "test-match",
    platform: "tcga",
    status: "pending-review",
    capturedAt,
    updatedAt: capturedAt,
    result: "Win",
    format: "Bo1",
    score: "1-0",
    myName: "BMU",
    opponentName: "Opponent",
    myChampion: "Diana",
    opponentChampion: "Draven",
    myBattlefield: "Zaun Warrens",
    opponentBattlefield: "Dusk Rose Lab",
    deckName: "",
    deckSourceId: "",
    flags: "",
    notes: "",
    games: [],
    rawEvidence: [],
    sync: {
      community: "pending",
      hubs: {},
      teams: {}
    },
    ...overrides
  };
}

function coordinatorHarness(options: {
  failSave?: boolean;
  finalizeRawCaptureForMatch?: ReturnType<typeof vi.fn>;
} = {}): {
  coordinator: CaptureCoordinator;
  saved: MatchDraft[];
  sent: Array<{ channel: string; payload: unknown }>;
  syncService: { syncMatch: ReturnType<typeof vi.fn> };
  diagnostics: { record: ReturnType<typeof vi.fn> };
  resolver: {
    resolveLegend: ReturnType<typeof vi.fn>;
    resolveBattlefield: ReturnType<typeof vi.fn>;
    resolveCard: ReturnType<typeof vi.fn>;
  };
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
      diagnostics as never,
      undefined,
      undefined,
      options.finalizeRawCaptureForMatch as never
    ),
    saved,
    sent,
    syncService,
    diagnostics,
    resolver
  };
}

describe("CaptureCoordinator", () => {
  it("keeps BO3 popup decisions closed during sideboarding and in-progress games", () => {
    expect(shouldOpenMatchCapturePopup({
      format: "bo3",
      currentGameNumber: 1,
      playerGameWins: 1,
      opponentGameWins: 0,
      gameResults: ["Win"],
      lastDetectedGameWinner: "player",
      isSideboarding: true,
      isMatchComplete: false
    })).toEqual({
      shouldOpen: false,
      reason: "BO3_IN_PROGRESS_SIDEBOARDING"
    });

    expect(shouldOpenMatchCapturePopup({
      format: "bo3",
      currentGameNumber: 2,
      playerGameWins: 1,
      opponentGameWins: 1,
      gameResults: ["Win", "Loss"],
      lastDetectedGameWinner: "opponent",
      isSideboarding: false,
      isMatchComplete: false
    })).toEqual({
      shouldOpen: false,
      reason: "BO3_MATCH_NOT_COMPLETE"
    });

    expect(shouldOpenMatchCapturePopup({
      format: "bo3",
      currentGameNumber: 3,
      playerGameWins: 2,
      opponentGameWins: 1,
      gameResults: ["Win", "Loss", "Win"],
      lastDetectedGameWinner: "player",
      isSideboarding: false,
      isMatchComplete: true
    })).toEqual({
      shouldOpen: true,
      reason: "BO3_MATCH_COMPLETE"
    });

    expect(shouldOpenMatchCapturePopup({
      format: "bo1",
      currentGameNumber: 1,
      playerGameWins: 1,
      opponentGameWins: 0,
      gameResults: ["Win"],
      lastDetectedGameWinner: "player",
      isSideboarding: false,
      isMatchComplete: true
    })).toEqual({
      shouldOpen: true,
      reason: "BO1_GAME_COMPLETE"
    });
  });

  it("suppresses RiftAtlas child-game review and logs the BO3 popup decision", async () => {
    const { coordinator, saved, sent, diagnostics } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "AtlasRival",
      myChampion: "Master Yi, Wuju Bladesman",
      opponentChampion: "LeBlanc"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-07T18:00:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      score: score("6", "7")
    }, "2026-06-07T18:08:00.000Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: "debug",
      payload: expect.objectContaining({
        reason: "capture-popup-decision",
        action: "hold",
        decision: "BO3_MATCH_NOT_COMPLETE",
        currentGameNumber: 1,
        playerGameWins: 0,
        opponentGameWins: 1,
        reasonCapturePopupSuppressed: "BO3_MATCH_NOT_COMPLETE"
      })
    }));

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-07T18:08:04.000Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);
  });

  it("syncs confirmed matches quietly so background sync does not reopen review", async () => {
    const { coordinator, saved, sent, syncService } = coordinatorHarness();
    const match = draft();

    const result = await coordinator.confirmMatch(match);

    expect(result.status).toBe("saved");
    expect(saved[0]?.status).toBe("saved");
    expect(syncService.syncMatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: match.id, status: "saved" }),
      { quiet: true }
    );
    expect(sent.some((item) => item.channel === "match:draft")).toBe(false);
  });

  it("ignores TCGA pre-game inactive blips before opponent and legend evidence exists", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();

    await coordinator.handleEvent(event("match-start", {
      active: true,
      myName: "FynalBoss",
      localPlayerName: "FynalBoss",
      score: { me: "3", opp: "", source: "tcga-counter-player" },
      counterPlayers: [
        { name: "FynalBoss", score: "3" }
      ]
    }, "2026-05-20T10:00:00.000Z"));
    await coordinator.handleEvent(event("match-end", {
      active: false,
      reason: "inactive-debounce",
      score: { me: "", opp: "", source: "none" },
      counterPlayers: []
    }, "2026-05-20T10:00:05.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.some((item) => item.channel === "match:draft")).toBe(false);

    await coordinator.handleEvent(event("match-start", {
      active: true,
      myName: "FynalBoss",
      opponentName: "ChickenBanana",
      myChampion: "Annie",
      opponentChampion: "Kai'Sa",
      score: { me: "0", opp: "0", source: "tcga-counter-paired" }
    }, "2026-05-20T10:00:12.000Z"));
    await coordinator.handleEvent(event("match-snapshot", {
      active: true,
      myName: "FynalBoss",
      opponentName: "ChickenBanana",
      myChampion: "Annie",
      opponentChampion: "Kai'Sa",
      score: { me: "7", opp: "3", source: "tcga-counter-paired" }
    }, "2026-05-20T10:08:12.000Z"));
    await coordinator.handleEvent(event("match-end", {
      active: false,
      reason: "inactive-debounce",
      score: { me: "", opp: "", source: "none" }
    }, "2026-05-20T10:08:18.000Z"));

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "tcga",
      opponentName: "ChickenBanana",
      result: "Win",
      score: "1-0"
    });
  });

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

  it("finalizes the raw match when video replay capture is disabled", async () => {
    const finalizeRawCaptureForMatch = vi.fn(async () => null);
    const { coordinator } = coordinatorHarness({ finalizeRawCaptureForMatch });

    await coordinator.handleEvent(event("match-start", {
      active: true,
      myName: "BMU",
      opponentName: "Atlas Rival",
      myChampion: "Annie",
      opponentChampion: "Jinx",
      seriesId: "series-without-video",
      matchId: "atlas-game-1",
      roomCode: "RAWROOM",
      score: { me: "1", opp: "0", source: "atlas-score-track" }
    }, "2026-07-09T20:00:00.000Z", "atlas"));

    const captured = await coordinator.forceReview("atlas");
    expect(captured).not.toBeNull();
    await vi.waitFor(() => expect(finalizeRawCaptureForMatch).toHaveBeenCalledOnce());
    expect(finalizeRawCaptureForMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "atlas",
        seriesId: "series-without-video",
        matchId: "atlas-game-1",
        roomCodes: ["RAWROOM"],
        localMatchId: expect.any(String),
        capturedAt: "2026-07-09T20:00:00.000Z",
        completedAt: expect.any(String),
        match: {
          format: "bo1",
          result: "win",
          score: { perspective: 1, opponent: 0 },
          games: expect.any(Array)
        }
      }),
      undefined
    );
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

  it("ignores RiftAtlas deck builder pages that expose card-like DOM as active", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();

    await coordinator.handleEvent(event("match-start", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "Graham Cooper",
      score: { me: "", opp: "", source: "none" },
      atlasPlayerCandidates: [
        { name: "Graham Cooper", side: "opponent", source: "title", score: 4 },
        { name: "Sort Main", side: "opponent", source: "aria-label", score: 4 }
      ]
    }, "2026-05-23T15:02:13.734Z", "atlas", "https://riftatlas.com/decks/new"));
    await coordinator.handleEvent(event("match-snapshot", {
      active: false,
      format: "Auto",
      myName: "BMU",
      score: { me: "", opp: "", source: "none" }
    }, "2026-05-23T15:02:27.355Z", "atlas", "https://riftatlas.com/decks/new"));
    await coordinator.handleEvent(event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Auto",
      myName: "BMU",
      score: { me: "", opp: "", source: "none" }
    }, "2026-05-23T15:02:29.160Z", "atlas", "https://riftatlas.com/decks/new"));

    expect(saved).toHaveLength(0);
    expect(sent.some((item) => item.channel === "match:draft")).toBe(false);
  });

  it("keeps a two-game RiftAtlas BO3 sweep as two distinct games", async () => {
    const { coordinator, saved } = coordinatorHarness();

    await coordinator.handleEvent(event("match-start", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "Drekayr",
      score: { me: "0", opp: "0", source: "atlas-score-track" },
      myBattlefield: "The Arena's Greatest",
      opponentBattlefield: "Ornn's Forge",
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp"
    }, "2026-05-11T09:17:37.769Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "Drekayr",
      score: { me: "7", opp: "5", source: "atlas-score-track" },
      myBattlefield: "The Arena's Greatest",
      opponentBattlefield: "Ornn's Forge",
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp"
    }, "2026-05-11T09:33:09.941Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      active: true,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      format: "Auto",
      myName: "BMU",
      opponentName: "Drekayr",
      score: { me: "7", opp: "5", source: "atlas-score-track" },
      myBattlefield: "The Arena's Greatest",
      opponentBattlefield: "Ornn's Forge",
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp"
    }, "2026-05-11T09:33:30.575Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      active: false,
      format: "Auto",
      myName: "BMU",
      score: { me: "", opp: "", source: "none" }
    }, "2026-05-11T09:33:34.747Z", "atlas"));
    await coordinator.handleEvent(event("match-start", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "Drekayr",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-05-11T09:33:35.751Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "Drekayr",
      score: { me: "0", opp: "0", source: "atlas-score-track" },
      myBattlefield: "Ornn's Forge",
      opponentBattlefield: "Ripper's Bay",
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-215.webp"
    }, "2026-05-11T09:34:13.653Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "Drekayr",
      score: { me: "7", opp: "3", source: "atlas-score-track" },
      myBattlefield: "Ornn's Forge",
      opponentBattlefield: "Ripper's Bay",
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-215.webp"
    }, "2026-05-11T09:49:47.054Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Bo1",
      myName: "BMU",
      score: { me: "", opp: "", source: "none" }
    }, "2026-05-11T09:51:21.196Z", "atlas", "https://play.riftatlas.com/"));

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      result: "Win",
      score: "2-0"
    });
    expect(saved[0].games).toHaveLength(2);
    expect(saved[0].games[0]).toMatchObject({
      gameNumber: 1,
      result: "Win",
      myPoints: 7,
      oppPoints: 5,
      myBattlefield: "The Arena's Greatest",
      oppBattlefield: "Ornn's Forge"
    });
    expect(saved[0].games[1]).toMatchObject({
      gameNumber: 2,
      result: "Win",
      myPoints: 7,
      oppPoints: 3,
      myBattlefield: "Ornn's Forge",
      oppBattlefield: "Ripper's Bay"
    });
  });

  it("holds a RiftAtlas Confirm Game 1 Winner screen even when the next game starts immediately", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "Panguin",
      myChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-193.webp",
      opponentChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-248.webp"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefieldImages = (me: string, opp: string) => ({
      myBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${me}.webp`,
      opponentBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${opp}.webp`
    });

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefieldImages("UNL-207", "UNL-216")
    }, "2026-05-27T20:43:11.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "6"),
      ...battlefieldImages("UNL-207", "UNL-216")
    }, "2026-05-27T20:53:41.853Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      score: score("7", "6"),
      ...battlefieldImages("UNL-207", "UNL-216")
    }, "2026-05-27T20:54:45.911Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefieldImages("OGN-288", "OGN-298")
    }, "2026-05-27T20:54:51.249Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "4"),
      ...battlefieldImages("OGN-288", "OGN-298")
    }, "2026-05-27T21:05:43.488Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Bo1",
      myName: "BMU",
      score: { me: "", opp: "", source: "none" }
    }, "2026-05-27T21:05:54.845Z", "atlas", "https://play.riftatlas.com/"));

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      result: "Win",
      score: "2-0"
    });
    expect(saved[0].games).toHaveLength(2);
    expect(saved[0].games.map((game) => [game.myPoints, game.oppPoints])).toEqual([
      [7, 6],
      [6, 4]
    ]);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
  });

  it("keeps a sparse RiftAtlas first-game end pending long enough for a delayed BO3 next game", async () => {
    vi.useFakeTimers();
    try {
      const { coordinator, saved, sent } = coordinatorHarness();
      const base = {
        active: true,
        format: "Auto",
        myName: "BMU",
        opponentName: "A1ex",
        myChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/small-v2/UNL-193.webp",
        opponentChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/small-v2/SFD-185.webp"
      };
      const score = (me: string, opp: string) => ({
        me,
        opp,
        source: "atlas-score-track",
        raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
      });
      const battlefields = (me: string, opp: string) => ({
        myBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${me}.webp`,
        opponentBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${opp}.webp`
      });
      const sparseLandingEnd = (at: string) => event("match-end", {
        active: false,
        reason: "inactive-debounce",
        format: "Auto",
        myName: "BMU",
        opponentName: "",
        score: { me: "", opp: "", source: "none" },
        endText: "",
        atlasResultKind: ""
      }, at, "atlas", "https://play.riftatlas.com/");

      await coordinator.handleEvent(event("match-start", {
        ...base,
        score: score("0", "0"),
        ...battlefields("OGN-289", "SFD-220")
      }, "2026-05-28T10:17:58.394Z", "atlas"));
      await coordinator.handleEvent(event("match-snapshot", {
        ...base,
        score: score("7", "4"),
        ...battlefields("OGN-289", "SFD-220")
      }, "2026-05-28T10:27:46.685Z", "atlas"));
      await coordinator.handleEvent(sparseLandingEnd("2026-05-28T10:28:13.515Z"));

      expect(saved).toHaveLength(0);
      expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(saved).toHaveLength(0);

      await coordinator.handleEvent(event("match-start", {
        ...base,
        score: score("0", "0"),
        ...battlefields("UNL-215", "OGN-298")
      }, "2026-05-28T10:28:36.000Z", "atlas"));
      await coordinator.handleEvent(event("match-snapshot", {
        ...base,
        score: score("7", "5"),
        ...battlefields("UNL-215", "OGN-298")
      }, "2026-05-28T10:39:18.000Z", "atlas"));
      await coordinator.handleEvent(sparseLandingEnd("2026-05-28T10:39:31.000Z"));

      expect(saved).toHaveLength(1);
      expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        platform: "atlas",
        format: "Bo3",
        result: "Win",
        score: "2-0"
      });
      expect(saved[0].games.map((game) => [game.myPoints, game.oppPoints])).toEqual([
        [7, 4],
        [7, 5]
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not split a three-game RiftAtlas BO3 across confirm-game result screens", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "Sinister",
      opponentName: "KevinSS",
      myChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-203.webp",
      opponentChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-235.webp"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const withBattlefields = (me: string, opp: string) => ({
      myBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${me}.webp`,
      opponentBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${opp}.webp`
    });
    const result = (game: number, me: string, opp: string, mine: string, theirs: string) => ({
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...withBattlefields(mine, theirs)
    });

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-05-26T06:53:57.188Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "7"),
      ...withBattlefields("UNL-215", "UNL-213")
    }, "2026-05-26T07:02:20.000Z", "atlas"));
    await coordinator.handleEvent(event("match-end", result(1, "6", "7", "UNL-215", "UNL-213"), "2026-05-26T07:02:31.835Z", "atlas"));
    expect(saved).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-05-26T07:02:35.998Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("8", "8"),
      ...withBattlefields("OGN-276", "OGN-290")
    }, "2026-05-26T07:11:50.000Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      ...result(2, "8", "8", "OGN-276", "OGN-290"),
      atlasResultKind: ""
    }, "2026-05-26T07:11:59.929Z", "atlas"));
    expect(saved).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-05-26T07:12:03.858Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "8"),
      ...withBattlefields("OGN-297", "OGN-298")
    }, "2026-05-26T07:23:20.000Z", "atlas"));
    await coordinator.handleEvent(event("match-end", result(3, "7", "8", "OGN-297", "OGN-298"), "2026-05-26T07:23:38.687Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(atlasMatchComplete({
      ...base,
      score: score("7", "8")
    }, "2026-05-26T07:23:44.000Z"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3"
    });
    expect(saved[0].games).toHaveLength(3);
    expect(saved[0].games.map((game) => [game.myPoints, game.oppPoints])).toEqual([
      [6, 7],
      [8, 8],
      [7, 8]
    ]);
    expect(saved[0].games.map((game) => [game.myBattlefieldImage, game.oppBattlefieldImage])).toEqual([
      [
        "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp",
        "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-213.webp"
      ],
      [
        "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-276.webp",
        "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-290.webp"
      ],
      [
        "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-297.webp",
        "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp"
      ]
    ]);
  });

  it("uses Atlas BO3 queue winner screens as between-game evidence", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "QueueFriend",
      myChampion: "Vex",
      opponentChampion: "Draven"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const queueResult = (game: number, me: string, opp: string, text: string, at: string) => event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      atlasBo3Queue: game < 3,
      atlasBo3GameNumber: game,
      pageText: `Best of 3 Queue ${text} Sideboarding Next game`,
      endText: text,
      score: score(me, opp)
    }, at, "atlas");

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-06T18:00:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "5")
    }, "2026-06-06T18:10:00.000Z", "atlas"));
    await coordinator.handleEvent(queueResult(1, "7", "5", "Choose the winner for Game 1", "2026-06-06T18:10:05.000Z"));
    expect(saved).toHaveLength(0);

    await coordinator.handleEvent(event("match-end", {
      ...base,
      active: false,
      reason: "inactive-debounce",
      atlasSideboarding: true,
      pageText: "Sideboarding - lock in sideboard - Best of 3",
      score: { me: "", opp: "", source: "none" }
    }, "2026-06-06T18:10:08.000Z", "atlas"));
    expect(saved).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-06T18:11:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("3", "7")
    }, "2026-06-06T18:21:00.000Z", "atlas"));
    await coordinator.handleEvent(queueResult(2, "3", "7", "Select the winner for game 2", "2026-06-06T18:21:05.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-06T18:22:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("8", "6")
    }, "2026-06-06T18:32:00.000Z", "atlas"));
    await coordinator.handleEvent(queueResult(3, "8", "6", "Confirm Game 3 Winner", "2026-06-06T18:32:05.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(atlasMatchComplete({
      ...base,
      score: score("8", "6")
    }, "2026-06-06T18:32:10.000Z"));

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      result: "Win",
      score: "2-1"
    });
    expect(saved[0].games.map((game) => [game.result, game.myPoints, game.oppPoints])).toEqual([
      ["Win", 7, 5],
      ["Loss", 3, 7],
      ["Win", 8, 6]
    ]);
  });

  it("does not duplicate held Atlas BO3 games when result-screen echoes are followed by a fresh 0-0 next game", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "Bregue",
      myChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-199.webp",
      opponentChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-265.webp"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefields = (me: string, opp: string) => ({
      myBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${me}.webp`,
      opponentBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${opp}.webp`
    });
    const confirm = (game: number, me: string, opp: string, mine: string, theirs: string, at: string) => event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...battlefields(mine, theirs)
    }, at, "atlas");
    const confirmEcho = (game: number, me: string, opp: string, mine: string, theirs: string, at: string) => event("match-snapshot", {
      ...base,
      reason: "mutation",
      atlasResultKind: "game-result",
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...battlefields(mine, theirs)
    }, at, "atlas");
    const nextGameStart = (at: string, mine: string, theirs: string, text: string) => event("match-start", {
      ...base,
      score: score("0", "0"),
      rows: [
        { text: "Both sideboards are locked. Each player should now choose one unused battlefield." },
        { text }
      ],
      ...battlefields(mine, theirs)
    }, at, "atlas");

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-20T13:46:03.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "7"),
      ...battlefields("OGN-291", "UNL-215")
    }, "2026-06-20T14:04:50.000Z", "atlas"));
    await coordinator.handleEvent(confirm(1, "6", "7", "OGN-291", "UNL-215", "2026-06-20T14:04:52.000Z"));
    await coordinator.handleEvent(confirmEcho(1, "6", "7", "OGN-291", "UNL-215", "2026-06-20T14:04:52.500Z"));
    expect(saved).toHaveLength(0);

    await coordinator.handleEvent(nextGameStart("2026-06-20T14:05:01.000Z", "OGN-294", "OGN-297", "Locked in sideboarding."));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "5"),
      ...battlefields("OGN-294", "OGN-297")
    }, "2026-06-20T14:17:40.000Z", "atlas"));
    await coordinator.handleEvent(confirm(2, "6", "5", "OGN-294", "OGN-297", "2026-06-20T14:17:45.000Z"));
    await coordinator.handleEvent(confirmEcho(2, "6", "5", "OGN-294", "OGN-297", "2026-06-20T14:17:45.500Z"));
    expect(saved).toHaveLength(0);

    await coordinator.handleEvent(nextGameStart("2026-06-20T14:17:49.000Z", "OGN-290", "OGN-276", "Auto-selected the last remaining battlefield."));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "9"),
      ...battlefields("OGN-290", "OGN-276")
    }, "2026-06-20T14:33:09.000Z", "atlas"));
    await coordinator.handleEvent(confirm(3, "7", "9", "OGN-290", "OGN-276", "2026-06-20T14:33:12.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(atlasMatchComplete({
      ...base,
      score: score("7", "9")
    }, "2026-06-20T14:33:18.000Z"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      score: "1-2",
      result: "Loss"
    });
    expect(saved[0].games.map((game) => [game.gameNumber, game.result, game.myPoints, game.oppPoints])).toEqual([
      [1, "Loss", 6, 7],
      [2, "Win", 6, 5],
      [3, "Loss", 7, 9]
    ]);
    expect(saved[0].games.map((game) => [game.myBattlefieldImage, game.oppBattlefieldImage])).toEqual([
      [
        "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-291.webp",
        "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp"
      ],
      [
        "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-294.webp",
        "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-297.webp"
      ],
      [
        "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-290.webp",
        "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-276.webp"
      ]
    ]);
  });

  it("keeps ambiguous Atlas game-result screens pending until sideboard or next game evidence arrives", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "AtlasFriend",
      myChampion: "Vex",
      opponentChampion: "Pyke",
      roomCode: "ABCD"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const ambiguousResult = (me: string, opp: string, text: string, at: string) => event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: text,
      score: score(me, opp)
    }, at, "atlas");

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-06T20:00:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "5")
    }, "2026-06-06T20:10:00.000Z", "atlas"));
    await coordinator.handleEvent(ambiguousResult("7", "5", "You win", "2026-06-06T20:10:05.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-end", {
      ...base,
      active: false,
      reason: "inactive-debounce",
      atlasSideboarding: true,
      pageText: "Sideboarding - Game 2 - lock in sideboard",
      score: { me: "", opp: "", source: "none" }
    }, "2026-06-06T20:10:08.000Z", "atlas"));
    expect(saved).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", {
      ...base,
      pageText: "Game 2",
      score: score("0", "0")
    }, "2026-06-06T20:11:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("4", "7")
    }, "2026-06-06T20:21:00.000Z", "atlas"));
    await coordinator.handleEvent(ambiguousResult("4", "7", "You lose", "2026-06-06T20:21:05.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", {
      ...base,
      pageText: "Game 3",
      score: score("0", "0")
    }, "2026-06-06T20:22:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("8", "6")
    }, "2026-06-06T20:32:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "match-terminal",
      endText: "Match Complete",
      score: score("8", "6")
    }, "2026-06-06T20:32:05.000Z", "atlas"));

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      result: "Win",
      score: "2-1"
    });
    expect(saved[0].games.map((game) => [game.result, game.myPoints, game.oppPoints])).toEqual([
      ["Win", 7, 5],
      ["Loss", 4, 7],
      ["Win", 8, 6]
    ]);
  });

  it("does not flush a pending Atlas BO3 review when the next screen reports sideboard text as the opponent", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "Clowkllr",
      myChampion: "Rengar",
      opponentChampion: "Viktor"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-06T13:20:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "4")
    }, "2026-06-06T13:34:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      ...base,
      reason: "inactive-debounce",
      atlasSideboarding: true,
      pageText: "Best of 3 - sideboarding - waiting for both players to lock in sideboard",
      rows: [{ text: "Locked in sideboarding." }],
      score: { me: "", opp: "", source: "none" }
    }, "2026-06-06T13:34:05.000Z", "atlas"));

    await coordinator.handleEvent(event("match-start", {
      ...base,
      opponentName: "34Locked in a sideboard choice",
      pageText: "Best of 3 - Next game",
      score: score("0", "0")
    }, "2026-06-06T13:34:10.000Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "5")
    }, "2026-06-06T13:45:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: "Confirm Game 2 Winner",
      atlasBo3Queue: true,
      atlasBo3GameNumber: 2,
      score: score("7", "5")
    }, "2026-06-06T13:45:05.000Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);
  });

  it("keeps Atlas BO3 pending through a blank inactive game-two transition when game three starts", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "Clowkllr",
      myChampion: "Rengar",
      opponentChampion: "Viktor"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-06T13:25:16.395Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "4")
    }, "2026-06-06T13:34:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      atlasBo3Queue: true,
      atlasBo3GameNumber: 1,
      endText: "Confirm Game 1 Winner",
      score: score("6", "4")
    }, "2026-06-06T13:34:06.275Z", "atlas"));

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-06T13:34:10.059Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      opponentName: "34Chose Clowkllr to take the first",
      score: score("0", "0")
    }, "2026-06-06T13:34:52.815Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "6")
    }, "2026-06-06T13:45:13.072Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Auto",
      myName: "BMU",
      opponentName: "",
      score: { me: "", opp: "", source: "none" }
    }, "2026-06-06T13:47:28.251Z", "atlas"));

    await coordinator.handleEvent(event("match-start", {
      ...base,
      opponentName: "38Locked in sideboarding",
      pageText: "Best of 3 - next game",
      score: score("0", "0")
    }, "2026-06-06T13:48:00.000Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);
  });

  it("keeps RiftAtlas BO3 together when game two looks complete but the same opponent continues", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "Tao",
      myChampion: "Vex",
      opponentChampion: "Lillia",
      myChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-193.webp",
      opponentChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-189.webp"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefields = (me: string, opp: string) => ({
      myBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${me}.webp`,
      opponentBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${opp}.webp`
    });
    const confirmGame = (game: number, me: string, opp: string, mine: string, theirs: string) => event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...battlefields(mine, theirs)
    }, `2026-05-30T20:${String(10 + game).padStart(2, "0")}:00.000Z`, "atlas");
    const sideboardEnd = (at: string) => event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Auto",
      myName: "BMU",
      opponentName: "Tao",
      myChampion: "Vex",
      opponentChampion: "Lillia",
      atlasSideboarding: true,
      rows: [{ text: "Locked in sideboarding." }],
      score: { me: "", opp: "", source: "none" }
    }, at, "atlas", "https://play.riftatlas.com/game");

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("OGN-298", "SFD-219")
    }, "2026-05-30T20:00:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "7"),
      ...battlefields("OGN-298", "SFD-219")
    }, "2026-05-30T20:10:00.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(1, "6", "7", "OGN-298", "SFD-219"));
    await coordinator.handleEvent(sideboardEnd("2026-05-30T20:11:02.000Z"));

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("UNL-215", "OGN-295")
    }, "2026-05-30T20:12:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "7"),
      ...battlefields("UNL-215", "OGN-295")
    }, "2026-05-30T20:22:00.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(2, "6", "7", "UNL-215", "OGN-295"));
    await coordinator.handleEvent(sideboardEnd("2026-05-30T20:23:02.000Z"));

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("SFD-218", "OGN-290")
    }, "2026-05-30T20:24:00.000Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "capture:event" && (item.payload as { kind?: string }).kind === "match-end")).toHaveLength(0);

    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("4", "8"),
      ...battlefields("SFD-218", "OGN-290")
    }, "2026-05-30T20:34:00.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(3, "4", "8", "SFD-218", "OGN-290"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(atlasMatchComplete({
      ...base,
      score: score("4", "8"),
      ...battlefields("SFD-218", "OGN-290")
    }, "2026-05-30T20:34:08.000Z"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "capture:event" && (item.payload as { kind?: string }).kind === "match-end")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      result: "Loss",
      score: "0-3"
    });
    expect(saved[0].games).toHaveLength(3);
    expect(saved[0].games.map((game) => [game.myPoints, game.oppPoints])).toEqual([
      [6, 7],
      [6, 7],
      [4, 8]
    ]);
  });

  it("commits an ambiguous Atlas game two before a surprise game three", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Bo3",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "ViktorPilot",
      myChampionImage: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/8bd4006c34aa020211e501e3cb7ee14ab5b4c41f-744x1039.png?auto=format&fit=fill&q=80&w=744",
      opponentChampion: "Viktor",
      opponentChampionImage: "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-265/full-desktop-2x.avif"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefields = (me: string, opp: string) => ({
      myBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${me}.webp`,
      opponentBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${opp}.webp`
    });
    const explicitConfirm = (game: number, me: string, opp: string, mine: string, theirs: string, at: string) => event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      atlasBo3GameNumber: game,
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...battlefields(mine, theirs)
    }, at, "atlas");
    const ambiguousConfirm = (me: string, opp: string, mine: string, theirs: string, at: string) => event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: "Confirm winner",
      score: score(me, opp),
      ...battlefields(mine, theirs)
    }, at, "atlas");

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("OGN-298", "SFD-219")
    }, "2026-06-11T20:00:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "5"),
      ...battlefields("OGN-298", "SFD-219")
    }, "2026-06-11T20:10:00.000Z", "atlas"));
    await coordinator.handleEvent(explicitConfirm(1, "7", "5", "OGN-298", "SFD-219", "2026-06-11T20:11:00.000Z"));

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("UNL-215", "OGN-295")
    }, "2026-06-11T20:12:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "5"),
      ...battlefields("UNL-215", "OGN-295")
    }, "2026-06-11T20:22:00.000Z", "atlas"));
    await coordinator.handleEvent(ambiguousConfirm("7", "5", "UNL-215", "OGN-295", "2026-06-11T20:23:00.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("SFD-218", "OGN-290")
    }, "2026-06-11T20:24:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "5"),
      ...battlefields("SFD-218", "OGN-290")
    }, "2026-06-11T20:34:00.000Z", "atlas"));
    await coordinator.handleEvent(explicitConfirm(3, "7", "5", "SFD-218", "OGN-290", "2026-06-11T20:35:00.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(atlasMatchComplete({
      ...base,
      score: score("7", "5"),
      ...battlefields("SFD-218", "OGN-290")
    }, "2026-06-11T20:35:06.000Z"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      myChampion: "Diana",
      opponentChampion: "Viktor"
    });
    expect(saved[0].games).toHaveLength(3);
    expect(saved[0].games.map((game) => [game.myPoints, game.oppPoints])).toEqual([
      [7, 5],
      [7, 5],
      [7, 5]
    ]);
    expect(saved[0].games.map((game) => [game.myBattlefieldImage, game.oppBattlefieldImage])).toEqual([
      [
        "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
        "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-219.webp"
      ],
      [
        "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp",
        "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-295.webp"
      ],
      [
        "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-218.webp",
        "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-290.webp"
      ]
    ]);
  });

  it("preserves image-only Atlas game three battlefields when a duplicate bridge row appears", async () => {
    const { coordinator, saved, sent, resolver } = coordinatorHarness();
    const battlefieldNames: Record<string, string> = {
      "SFD-210": "Hall of Legends",
      "UNL-215": "Star Spring",
      "SFD-213": "Ornn's Forge",
      "OGN-276": "Aspirant's Climb",
      "OGN-294": "Trifarian War Camp",
      "OGN-297": "Windswept Hillock"
    };
    resolver.resolveBattlefield.mockImplementation(async (value: unknown) => {
      const raw = String(value ?? "");
      const code = Object.keys(battlefieldNames).find((item) => raw.includes(item));
      return code ? battlefieldNames[code] : "";
    });
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "Midnight",
      myChampion: "LeBlanc",
      opponentChampion: "Azir"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefields = (me: string, opp: string) => ({
      myBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${me}.webp`,
      opponentBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${opp}.webp`
    });
    const confirmGame = (game: number, me: string, opp: string, mine: string, theirs: string, at: string) => event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...battlefields(mine, theirs)
    }, at, "atlas");

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("SFD-210", "UNL-215")
    }, "2026-06-23T10:27:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "5"),
      ...battlefields("SFD-210", "UNL-215")
    }, "2026-06-23T10:38:00.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(1, "6", "5", "SFD-210", "UNL-215", "2026-06-23T10:39:00.000Z"));

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("SFD-213", "OGN-276")
    }, "2026-06-23T10:41:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("2", "7"),
      ...battlefields("SFD-213", "OGN-276")
    }, "2026-06-23T10:52:00.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(2, "2", "7", "SFD-213", "OGN-276", "2026-06-23T10:53:00.000Z"));

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("OGN-294", "OGN-297")
    }, "2026-06-23T10:55:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("5", "5"),
      ...battlefields("OGN-294", "OGN-297")
    }, "2026-06-23T11:12:00.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(3, "5", "5", "OGN-294", "OGN-297", "2026-06-23T11:13:00.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(atlasMatchComplete({
      ...base,
      score: score("5", "5"),
      ...battlefields("OGN-294", "OGN-297")
    }, "2026-06-23T11:13:05.000Z"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      myChampion: "LeBlanc",
      opponentChampion: "Azir"
    });
    expect(saved[0].games.map((game) => [
      game.myPoints,
      game.oppPoints,
      game.myBattlefield,
      game.oppBattlefield
    ])).toEqual([
      [6, 5, "Hall of Legends", "Star Spring"],
      [2, 7, "Ornn's Forge", "Aspirant's Climb"],
      [5, 5, "Trifarian War Camp", "Windswept Hillock"]
    ]);
  });

  it("suppresses duplicate Atlas Match Complete echoes after terminal BO3 review", async () => {
    const { coordinator, saved, sent, diagnostics } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "Zerigatoni",
      myChampion: "Diana",
      opponentChampion: "Viktor"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefields = (me: string, opp: string) => ({
      myBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${me}.webp`,
      opponentBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${opp}.webp`
    });
    const confirmGame = (game: number, me: string, opp: string, mine: string, theirs: string, at: string) => event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...battlefields(mine, theirs)
    }, at, "atlas");

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("OGN-298", "SFD-219")
    }, "2026-06-11T15:00:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("4", "7"),
      ...battlefields("OGN-298", "SFD-219")
    }, "2026-06-11T15:08:00.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(1, "4", "7", "OGN-298", "SFD-219", "2026-06-11T15:08:10.373Z"));

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("UNL-215", "OGN-295")
    }, "2026-06-11T15:08:13.215Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "4"),
      ...battlefields("UNL-215", "OGN-295")
    }, "2026-06-11T15:18:40.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(2, "7", "4", "UNL-215", "OGN-295", "2026-06-11T15:18:53.838Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("SFD-218", "OGN-290")
    }, "2026-06-11T15:18:56.876Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "5"),
      ...battlefields("SFD-218", "OGN-290")
    }, "2026-06-11T15:24:55.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(3, "7", "5", "SFD-218", "OGN-290", "2026-06-11T15:25:02.955Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(atlasMatchComplete({
      ...base,
      score: score("7", "5"),
      ...battlefields("SFD-218", "OGN-290")
    }, "2026-06-11T15:25:03.166Z"));

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      result: "Win",
      score: "2-1",
      myChampion: "Diana",
      opponentChampion: "Viktor"
    });
    expect(saved[0].games.map((game) => `${game.myPoints}-${game.oppPoints}`)).toEqual(["4-7", "7-4", "7-5"]);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);

    await coordinator.handleEvent(event("match-end", {
      ...base,
      active: false,
      reason: "result-text-detected",
      atlasResultKind: "match-terminal",
      endText: "Match Complete",
      score: score("7", "5")
    }, "2026-06-11T15:25:13.166Z", "atlas"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: "debug",
      payload: expect.objectContaining({
        reason: "match-draft-final-guard",
        guardReason: "FINAL_GUARD_ATLAS_TERMINAL_OR_NO_BO3_HOLD",
        emittedToRenderer: true,
        draftScore: "2-1",
        draftGameCount: 3
      })
    }));
  });

  it("keeps RiftAtlas BO3 together when Atlas blanks after game two before game three starts", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "ComboMAN",
      configuredUsername: "ComboMAN",
      opponentName: "Capitalism",
      myChampion: "Poppy",
      opponentChampion: "LeBlanc"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefields = (me: string, opp: string) => ({
      myBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${me}.webp`,
      opponentBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${opp}.webp`
    });
    const confirmGame = (game: number, me: string, opp: string, mine: string, theirs: string, at: string) => event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...battlefields(mine, theirs)
    }, at, "atlas");
    const blankTransition = (at: string) => event("match-snapshot", {
      active: false,
      reason: "mutation",
      format: "Auto",
      configuredUsername: "ComboMAN",
      myName: "ComboMAN",
      opponentName: "",
      atlasResultKind: "",
      endText: "",
      score: { me: "", opp: "", source: "none", raw: [] }
    }, at, "atlas");

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("OGN-298", "UNL-208")
    }, "2026-06-04T09:19:44.309Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("0", "5"),
      ...battlefields("OGN-298", "UNL-208")
    }, "2026-06-04T09:24:55.156Z", "atlas"));
    await coordinator.handleEvent(confirmGame(1, "0", "5", "OGN-298", "UNL-208", "2026-06-04T09:31:22.384Z"));
    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("UNL-215", "OGN-290")
    }, "2026-06-04T09:31:26.468Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("1", "7"),
      ...battlefields("UNL-215", "OGN-290")
    }, "2026-06-04T09:41:21.565Z", "atlas"));
    await coordinator.handleEvent(confirmGame(2, "1", "7", "UNL-215", "OGN-290", "2026-06-04T09:42:19.859Z"));
    await coordinator.handleEvent(blankTransition("2026-06-04T09:42:22.274Z"));
    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("SFD-218", "OGN-297")
    }, "2026-06-04T09:42:22.724Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "8"),
      ...battlefields("SFD-218", "OGN-297")
    }, "2026-06-04T10:05:53.930Z", "atlas"));
    await coordinator.handleEvent(confirmGame(3, "6", "8", "SFD-218", "OGN-297", "2026-06-04T10:10:19.544Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(atlasMatchComplete({
      ...base,
      score: score("6", "8"),
      ...battlefields("SFD-218", "OGN-297")
    }, "2026-06-04T10:10:25.000Z"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      result: "Loss",
      score: "0-3"
    });
    expect(saved[0].games.map((game) => `${game.myPoints}-${game.oppPoints}`)).toEqual(["0-5", "1-7", "6-8"]);
  });

  it("does not finalize RiftAtlas BO3 when a blank inactive page follows Confirm Game 2", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "LilliaTester",
      myChampion: "Vex",
      opponentChampion: "Lillia"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefields = (me: string, opp: string) => ({
      myBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${me}.webp`,
      opponentBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${opp}.webp`
    });
    const confirmGame = (game: number, me: string, opp: string, mine: string, theirs: string, at: string) => event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...battlefields(mine, theirs)
    }, at, "atlas");
    const blankInactiveEnd = (at: string) => event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Bo1",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "",
      score: { me: "", opp: "", source: "none", raw: [] }
    }, at, "atlas", "https://play.riftatlas.com/game");

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("OGN-298", "SFD-219")
    }, "2026-06-05T20:00:00.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(1, "6", "7", "OGN-298", "SFD-219", "2026-06-05T20:10:00.000Z"));
    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("UNL-215", "OGN-295")
    }, "2026-06-05T20:10:04.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(2, "6", "7", "UNL-215", "OGN-295", "2026-06-05T20:21:00.000Z"));
    await coordinator.handleEvent(blankInactiveEnd("2026-06-05T20:21:02.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("SFD-218", "OGN-290")
    }, "2026-06-05T20:21:05.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(3, "7", "4", "SFD-218", "OGN-290", "2026-06-05T20:31:00.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(atlasMatchComplete({
      ...base,
      score: score("7", "4"),
      ...battlefields("SFD-218", "OGN-290")
    }, "2026-06-05T20:31:06.000Z"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3"
    });
    expect(saved[0].games.map((game) => `${game.myPoints}-${game.oppPoints}`)).toEqual(["6-7", "6-7", "7-4"]);
  });

  it("keeps RiftAtlas BO3 together through disconnect suffixes and setup text in opponent fields", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "xypo321",
      myChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/small-v2/UNL-193.webp",
      opponentChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/small-v2/UNL-228.webp"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefields = (me: string, opp: string) => ({
      myBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${me}.webp`,
      opponentBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${opp}.webp`
    });
    const blankInactive = (at: string) => event("match-snapshot", {
      active: false,
      reason: "mutation",
      format: "Auto",
      atlasResultKind: "",
      endText: "",
      configuredUsername: "BMU",
      myName: "BMU",
      opponentName: "",
      score: { me: "", opp: "", source: "none", raw: [] }
    }, at, "atlas");
    const confirmGame = (game: number, me: string, opp: string, mine: string, theirs: string) => ({
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...battlefields(mine, theirs)
    });

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("OGN-288", "UNL-214")
    }, "2026-05-28T21:07:57.295Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "4"),
      ...battlefields("OGN-288", "UNL-214")
    }, "2026-05-28T21:21:11.889Z", "atlas"));
    await coordinator.handleEvent(event("match-end", confirmGame(1, "6", "4", "OGN-288", "UNL-214"), "2026-05-28T21:21:16.020Z", "atlas"));
    await coordinator.handleEvent(blankInactive("2026-05-28T21:21:18.224Z"));
    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-05-28T21:21:19.128Z", "atlas"));

    expect(saved).toHaveLength(0);

    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      opponentName: "xypo321Disconnected11s",
      score: score("6", "4"),
      ...battlefields("UNL-207", "SFD-220")
    }, "2026-05-28T21:30:26.430Z", "atlas"));

    expect(saved).toHaveLength(0);

    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "6"),
      ...battlefields("UNL-207", "SFD-220")
    }, "2026-05-28T21:31:01.519Z", "atlas"));
    await coordinator.handleEvent(event("match-end", confirmGame(2, "6", "6", "UNL-207", "SFD-220"), "2026-05-28T21:31:47.792Z", "atlas"));
    await coordinator.handleEvent(blankInactive("2026-05-28T21:31:51.644Z"));
    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-05-28T21:31:52.619Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      opponentName: "32Auto-selected the last remaining",
      score: score("0", "0"),
      ...battlefields("OGN-289", "SFD-210")
    }, "2026-05-28T21:32:13.296Z", "atlas"));

    expect(saved).toHaveLength(0);

    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "4"),
      ...battlefields("OGN-289", "SFD-210")
    }, "2026-05-28T21:41:10.016Z", "atlas"));
    await coordinator.handleEvent(event("match-end", confirmGame(3, "7", "4", "OGN-289", "SFD-210"), "2026-05-28T21:41:15.030Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(atlasMatchComplete({
      ...base,
      score: score("7", "4"),
      ...battlefields("OGN-289", "SFD-210")
    }, "2026-05-28T21:41:21.000Z"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      result: "Win",
      score: "2-0",
      opponentName: "xypo321"
    });
    expect(saved[0].games.map((game) => [game.gameNumber, game.result, game.myPoints, game.oppPoints])).toEqual([
      [1, "Win", 6, 4],
      [2, "Incomplete", 6, 6],
      [3, "Win", 7, 4]
    ]);
  });

  it("does not roll a held RiftAtlas game one into a review when the same Rengar mirror continues", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "MindGames",
      myChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/small-v2/UNL-183.webp",
      opponentChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/small-v2/UNL-183.webp"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefieldImages = {
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-207.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-207.webp"
    };

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefieldImages
    }, "2026-06-07T14:29:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("4", "8"),
      ...battlefieldImages
    }, "2026-06-07T14:34:01.000Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      atlasBo3GameNumber: 1,
      endText: "Confirm Game 1 Winner",
      score: score("4", "8"),
      ...battlefieldImages
    }, "2026-06-07T14:34:02.015Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefieldImages
    }, "2026-06-07T14:34:04.818Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "capture:event" && (item.payload as { kind?: string }).kind === "match-end")).toHaveLength(0);
  });

  it("guards the actual renderer draft event when Atlas root landing follows BO3 game one", async () => {
    const { coordinator, saved, sent, diagnostics } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "TigerClaw18",
      myChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/small-v2/UNL-183.webp",
      opponentChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/small-v2/SFD-249.webp"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefieldImages = (me: string, opp: string) => ({
      myBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${me}.webp`,
      opponentBattlefieldImage: `https://assets.riftatlas-workers.com/riftbound/cards/original/${opp}.webp`
    });
    const confirmGame = (game: number, me: string, opp: string, at: string) => event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      atlasBo3GameNumber: game,
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...battlefieldImages("SFD-207", "SFD-220")
    }, at, "atlas");
    const rootLanding = (at: string) => event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Bo1",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "",
      score: { me: "", opp: "", source: "none", raw: [] },
      endText: "",
      atlasResultKind: ""
    }, at, "atlas", "https://play.riftatlas.com/");

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefieldImages("SFD-207", "SFD-220")
    }, "2026-06-07T21:20:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "2"),
      ...battlefieldImages("SFD-207", "SFD-220")
    }, "2026-06-07T21:25:00.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(1, "6", "2", "2026-06-07T21:25:10.000Z"));
    await coordinator.handleEvent(rootLanding("2026-06-07T21:25:12.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: "debug",
      payload: expect.objectContaining({
        reason: "capture-popup-decision",
        action: "hold",
        decision: "BO3_MATCH_NOT_COMPLETE",
        reasonCapturePopupSuppressed: "BO3_MATCH_NOT_COMPLETE"
      })
    }));

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefieldImages("UNL-215", "SFD-207")
    }, "2026-06-07T21:25:30.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "5"),
      ...battlefieldImages("UNL-215", "SFD-207")
    }, "2026-06-07T21:35:00.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(2, "7", "5", "2026-06-07T21:35:10.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(rootLanding("2026-06-07T21:35:12.000Z"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      result: "Win",
      score: "2-0"
    });
    expect(saved[0].games.map((game) => [game.gameNumber, game.result, game.myPoints, game.oppPoints])).toEqual([
      [1, "Win", 6, 2],
      [2, "Win", 7, 5]
    ]);
  });

  it("opens an Atlas BO1 review promptly when a single game exits to the root landing page", async () => {
    const { coordinator, saved, sent, diagnostics } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "Trollkien",
      myChampion: "Diana",
      opponentChampion: "Pyke",
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-205.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-214.webp"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const rootLanding = event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Bo1",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "",
      score: { me: "", opp: "", source: "none", raw: [] },
      endText: "",
      atlasResultKind: ""
    }, "2026-06-10T16:38:49.623Z", "atlas", "https://play.riftatlas.com/");

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-10T16:30:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "7")
    }, "2026-06-10T16:38:30.352Z", "atlas"));
    await coordinator.handleEvent(rootLanding);

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo1",
      result: "Incomplete",
      opponentName: "Trollkien"
    });
    expect(saved[0].games.map((game) => [game.gameNumber, game.result, game.myPoints, game.oppPoints])).toEqual([
      [1, "Incomplete", 7, 7]
    ]);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: "debug",
      payload: expect.objectContaining({
        reason: "match-draft-final-guard",
        channel: "match:draft",
        guardReason: "FINAL_GUARD_ATLAS_NO_BO3_EVIDENCE",
        emittedToRenderer: true
      })
    }));
  });

  it("releases a held Atlas BO1 confirm when a settled root snapshot follows without duplicating the game", async () => {
    const { coordinator, saved, sent, diagnostics } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "Theta",
      myChampion: "Diana",
      opponentChampion: "Pyke"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-10T18:05:31.639Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "7")
    }, "2026-06-10T18:21:15.564Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      atlasBo3GameNumber: 1,
      endText: "Confirm Game 1 Winner",
      score: score("7", "7")
    }, "2026-06-10T18:25:43.187Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-snapshot", {
      active: false,
      reason: "mutation",
      format: "Bo1",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "",
      score: { me: "", opp: "", source: "none", raw: [] },
      endText: "",
      atlasResultKind: ""
    }, "2026-06-10T18:26:02.299Z", "atlas", "https://play.riftatlas.com/"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo1",
      opponentName: "Theta"
    });
    expect(saved[0].games.map((game) => [game.gameNumber, game.result, game.myPoints, game.oppPoints])).toEqual([
      [1, "Incomplete", 7, 7]
    ]);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: "debug",
      payload: expect.objectContaining({
        reason: "match-draft-final-guard",
        channel: "match:draft",
        guardReason: "FINAL_GUARD_ATLAS_FINAL_LANDING_RELEASE",
        emittedToRenderer: true
      })
    }));
  });

  it("suppresses the delayed Atlas Match Complete echo after a BO3 review is already emitted", async () => {
    const { coordinator, saved, sent, diagnostics } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "Lucian",
      myChampion: "Master Yi, Wuju Bladesman",
      opponentChampion: "Fiora"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-12T13:57:49.350Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "6")
    }, "2026-06-12T14:05:53.395Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      atlasBo3GameNumber: 1,
      endText: "Confirm Game 1 Winner",
      score: score("7", "6")
    }, "2026-06-12T14:06:00.774Z", "atlas"));

    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-12T14:06:06.013Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("6", "7")
    }, "2026-06-12T14:15:20.930Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      atlasBo3GameNumber: 2,
      endText: "Confirm Game 2 Winner",
      score: score("6", "7")
    }, "2026-06-12T14:16:17.020Z", "atlas"));

    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-12T14:16:20.504Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("7", "5")
    }, "2026-06-12T14:25:28.399Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      atlasBo3GameNumber: 3,
      endText: "Confirm Game 3 Winner",
      score: score("7", "5")
    }, "2026-06-12T14:25:58.928Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(atlasMatchComplete({
      ...base,
      score: score("7", "5")
    }, "2026-06-12T14:26:28.409Z"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      result: "Win",
      score: "2-1",
      opponentName: "Lucian"
    });

    await coordinator.handleEvent(event("match-end", {
      ...base,
      opponentName: "LucianDisconnected17s",
      reason: "result-text-detected",
      atlasResultKind: "match-terminal",
      endText: "Match Complete",
      score: score("7", "5")
    }, "2026-06-12T14:26:38.409Z", "atlas"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: "debug",
      payload: expect.objectContaining({
        reason: "match-draft-final-guard-suppressed",
        guardReason: "FINAL_GUARD_ATLAS_DUPLICATE_TERMINAL_ECHO",
        emittedToRenderer: false
      })
    }));
  });

  it("releases an incomplete RiftAtlas BO3 review quickly when the user exits to the landing page", async () => {
    const { coordinator, saved, sent, diagnostics } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "Fieric",
      myChampion: "Pyke",
      opponentChampion: "Vex"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefields = (me: string, opp: string) => ({
      myBattlefield: me,
      opponentBattlefield: opp
    });
    const rootLanding = (at: string) => event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Bo1",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "",
      score: { me: "", opp: "", source: "none", raw: [] },
      endText: "",
      atlasResultKind: ""
    }, at, "atlas", "https://play.riftatlas.com/");

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("Emperor's Dais", "Void Gate")
    }, "2026-06-07T21:26:08.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("3", "2"),
      ...battlefields("Emperor's Dais", "Void Gate")
    }, "2026-06-07T21:31:15.000Z", "atlas"));
    await coordinator.handleEvent(event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      atlasBo3GameNumber: 1,
      endText: "Confirm Game 1 Winner",
      score: score("3", "2"),
      ...battlefields("Emperor's Dais", "Void Gate")
    }, "2026-06-07T21:31:16.782Z", "atlas"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("The Arena's Greatest", "Ripper's Bay")
    }, "2026-06-07T21:31:19.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", {
      ...base,
      score: score("4", "5"),
      ...battlefields("The Arena's Greatest", "Ripper's Bay")
    }, "2026-06-07T21:39:00.000Z", "atlas"));
    await coordinator.handleEvent(rootLanding("2026-06-07T21:40:13.000Z"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      result: "Incomplete",
      score: "1-1",
      opponentName: "Fieric"
    });
    expect(saved[0].games.map((game) => [game.gameNumber, game.result, game.myPoints, game.oppPoints])).toEqual([
      [1, "Win", 3, 2],
      [2, "Loss", 4, 5]
    ]);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: "debug",
      payload: expect.objectContaining({
        reason: "match-draft-final-guard",
        channel: "match:draft",
        callSite: "atlas-final-landing",
        guardReason: "FINAL_GUARD_ATLAS_FINAL_LANDING_RELEASE",
        emittedToRenderer: true
      })
    }));
  });

  it("keeps Atlas BO3 sideboarding after a tied game two from emitting a renderer draft until game three", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "Explos1on",
      myChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/small-v2/UNL-183.webp",
      opponentChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/small-v2/SFD-246.webp"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefieldImages = {
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-290.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-218.webp"
    };
    const confirmGame = (game: number, me: string, opp: string, at: string) => event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      atlasBo3GameNumber: game,
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...battlefieldImages
    }, at, "atlas");
    const sideboard = (at: string) => event("match-snapshot", {
      ...base,
      score: score("0", "0"),
      atlasSideboarding: true,
      rows: [
        { text: "Both sideboards are locked. Each player should now choose one unused battlefield." },
        { text: "Locked in sideboarding." }
      ],
      ...battlefieldImages
    }, at, "atlas");

    await coordinator.handleEvent(event("match-start", { ...base, score: score("0", "0"), ...battlefieldImages }, "2026-06-07T22:00:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", { ...base, score: score("7", "5"), ...battlefieldImages }, "2026-06-07T22:06:00.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(1, "7", "5", "2026-06-07T22:06:05.000Z"));
    await coordinator.handleEvent(sideboard("2026-06-07T22:06:10.000Z"));
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", { ...base, score: score("0", "0"), ...battlefieldImages }, "2026-06-07T22:07:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", { ...base, score: score("4", "8"), ...battlefieldImages }, "2026-06-07T22:14:00.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(2, "4", "8", "2026-06-07T22:14:05.000Z"));
    await coordinator.handleEvent(sideboard("2026-06-07T22:14:10.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-start", { ...base, score: score("0", "0"), ...battlefieldImages }, "2026-06-07T22:15:00.000Z", "atlas"));
    await coordinator.handleEvent(event("match-snapshot", { ...base, score: score("8", "6"), ...battlefieldImages }, "2026-06-07T22:22:00.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(3, "8", "6", "2026-06-07T22:22:05.000Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(atlasMatchComplete({
      ...base,
      score: score("8", "6"),
      ...battlefieldImages
    }, "2026-06-07T22:22:10.000Z"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      result: "Win",
      score: "2-1"
    });
    expect(saved[0].games.map((game) => [game.gameNumber, game.result, game.myPoints, game.oppPoints])).toEqual([
      [1, "Win", 7, 5],
      [2, "Loss", 4, 8],
      [3, "Win", 8, 6]
    ]);
  });

  it("keeps a noisy RiftAtlas BO3 together when Atlas reports scores as opponent names", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      myChampion: "",
      opponentChampion: ""
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefieldImages = {
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-210.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp"
    };
    const activeEvent = (
      kind: CaptureEvent["kind"],
      opponentName: string,
      me: string,
      opp: string,
      at: string
    ) => event(kind, {
      ...base,
      opponentName,
      score: score(me, opp),
      ...battlefieldImages
    }, at, "atlas");
    const confirmGame = (
      game: number,
      opponentName: string,
      me: string,
      opp: string,
      at: string
    ) => event("match-end", {
      ...base,
      opponentName,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...battlefieldImages
    }, at, "atlas");

    await coordinator.handleEvent(activeEvent("match-start", "0/0", "0", "0", "2026-06-07T15:52:22.732Z"));
    await coordinator.handleEvent(activeEvent("match-snapshot", "6/7", "5", "6", "2026-06-07T15:59:17.000Z"));
    await coordinator.handleEvent(confirmGame(1, "6/7", "5", "6", "2026-06-07T15:59:18.362Z"));
    expect(saved).toHaveLength(0);

    await coordinator.handleEvent(activeEvent("match-start", "0/0", "0", "0", "2026-06-07T15:59:22.898Z"));
    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(activeEvent("match-snapshot", "1/4", "7", "5", "2026-06-07T16:07:09.000Z"));
    await coordinator.handleEvent(confirmGame(2, "1/4", "7", "5", "2026-06-07T16:07:10.559Z"));
    expect(saved).toHaveLength(0);

    await coordinator.handleEvent(activeEvent("match-start", "0/0", "0", "0", "2026-06-07T16:07:15.657Z"));
    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(activeEvent("match-snapshot", "1/6", "8", "4", "2026-06-07T16:14:02.233Z"));
    await coordinator.handleEvent(event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Bo1",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "",
      score: { me: "", opp: "", source: "none", raw: [] }
    }, "2026-06-07T16:14:11.879Z", "atlas", "https://play.riftatlas.com/"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      result: "Win",
      score: "2-1"
    });
    expect(saved[0].games.map((game) => [game.gameNumber, game.result, game.myPoints, game.oppPoints])).toEqual([
      [1, "Loss", 5, 6],
      [2, "Win", 7, 5],
      [3, "Win", 8, 4]
    ]);
  });

  it("finalizes RiftAtlas game two as one Bo3 when the second confirm is followed by a real match exit", async () => {
    const { coordinator, saved, sent } = coordinatorHarness();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "MindGames",
      myChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/small-v2/UNL-183.webp",
      opponentChampionImage: "https://assets.riftatlas-workers.com/riftbound/cards/small-v2/UNL-183.webp"
    };
    const score = (me: string, opp: string) => ({
      me,
      opp,
      source: "atlas-score-track",
      raw: [`me:active:${me}:Set your score to ${me}`, `unknown:active:${opp}:${opp}`]
    });
    const battlefieldImages = {
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-207.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-207.webp"
    };
    const confirmGame = (game: number, me: string, opp: string, at: string) => event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      atlasBo3GameNumber: game,
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...battlefieldImages
    }, at, "atlas");

    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefieldImages
    }, "2026-06-07T14:29:00.000Z", "atlas"));
    await coordinator.handleEvent(confirmGame(1, "4", "8", "2026-06-07T14:34:02.015Z"));
    await coordinator.handleEvent(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefieldImages
    }, "2026-06-07T14:34:04.818Z", "atlas"));

    expect(saved).toHaveLength(0);

    await coordinator.handleEvent(confirmGame(2, "5", "8", "2026-06-07T14:46:02.015Z"));

    expect(saved).toHaveLength(0);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(0);

    await coordinator.handleEvent(event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "",
      score: { me: "", opp: "", source: "none", raw: [] }
    }, "2026-06-07T14:46:07.923Z", "atlas", "https://play.riftatlas.com/"));

    expect(saved).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "match:draft")).toHaveLength(1);
    expect(sent.filter((item) => item.channel === "capture:event" && (item.payload as { kind?: string }).kind === "match-end")).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      platform: "atlas",
      format: "Bo3",
      result: "Loss",
      score: "0-2",
      opponentName: "MindGames"
    });
    expect(saved[0].games.map((game) => [game.gameNumber, game.result, game.myPoints, game.oppPoints])).toEqual([
      [1, "Loss", 4, 8],
      [2, "Loss", 5, 8]
    ]);
  });
});
