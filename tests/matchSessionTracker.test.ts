import { describe, expect, it } from "vitest";
import { MatchSessionTracker } from "../src/main/services/matchSessionTracker";
import type { CaptureEvent, UserSettings } from "../src/shared/types";

const settings: UserSettings = {
  username: "ConfiguredUser",
  firstRunComplete: true,
  syncMode: "community-and-hubs",
  communitySyncEnabled: true,
  firebaseUid: "",
  firebaseRefreshToken: "",
  debugMode: false,
  confirmationEnabled: true,
  replayCaptureEnabled: true,
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
  activeHubs: [{ id: "test-hub", name: "Test Hub", sync: true }]
};

function event(kind: CaptureEvent["kind"], payload: Record<string, unknown>, at = "2026-04-24T10:00:00.000Z", platform: CaptureEvent["platform"] = "tcga"): CaptureEvent {
  return {
    id: `${kind}-${at}`,
    platform,
    kind,
    capturedAt: at,
    url: platform === "atlas" ? "https://play.riftatlas.com" : "https://tcg-arena.fr",
    payload
  };
}

describe("MatchSessionTracker", () => {
  it("keeps sticky identity when final inactive payload is sparse", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      myName: "ConfiguredUser",
      opponentName: "Rival",
      myChampion: "Jinx",
      opponentChampion: "Ahri",
      score: { me: "8", opp: "3" }
    }));
    tracker.ingest(event("match-snapshot", {
      active: true,
      score: { me: "10", opp: "4" },
      selectedDeck: { selected_uuid: "tcga-deck-1", selected_label: "Jinx Burn" }
    }, "2026-04-24T10:02:00.000Z"));

    const end = event("match-end", { active: false, score: { me: "", opp: "" } }, "2026-04-24T10:04:00.000Z");
    const draft = tracker.buildDraft("tcga", end, settings);

    expect(draft.result).toBe("Win");
    expect(draft.score).toBe("1-0");
    expect(draft.opponentName).toBe("Rival");
    expect(draft.myChampion).toBe("Jinx");
    expect(draft.opponentChampion).toBe("Ahri");
    expect(draft.deckName).toBe("Jinx Burn");
    expect(draft.deckSourceId).toBe("tcga-deck-1");
    expect(draft.games[0].myPoints).toBe(10);
    expect(draft.games[0].oppPoints).toBe(4);
  });

  it("does not treat TCGA's generic Riftbound deck selector as a logged deck", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      myName: "ConfiguredUser",
      opponentName: "Rival",
      myChampion: "Azir",
      opponentChampion: "Irelia",
      selectedDeck: { selected_uuid: "Riftbound", selected_label: "Riftbound" },
      score: { me: "8", opp: "3" }
    }));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }, "2026-04-24T10:04:00.000Z"), settings);

    expect(draft.deckName).toBe("");
    expect(draft.deckSourceId).toBe("");
    expect(draft.deckSourceKey).toBe("");
  });

  it("marks blank captures incomplete and keeps sync intent", () => {
    const tracker = new MatchSessionTracker();
    const end = event("match-end", { active: false }, "2026-04-24T11:00:00.000Z");
    const draft = tracker.buildDraft("tcga", end, settings);

    expect(draft.status).toBe("incomplete");
    expect(draft.result).toBe("Incomplete");
    expect(draft.notes).toBe("");
    expect(draft.sync.community).toBe("pending");
    expect(draft.sync.hubs["test-hub"]).toBe("pending");
  });

  it("keeps private hub sync away from public community sync", () => {
    const tracker = new MatchSessionTracker();
    const privateSettings = {
      ...settings,
      syncMode: "private-hubs-only" as const,
      communitySyncEnabled: false
    };
    const end = event("match-end", { active: false }, "2026-04-24T11:10:00.000Z");
    const draft = tracker.buildDraft("tcga", end, privateSettings);

    expect(draft.sync.community).toBe("disabled");
    expect(draft.sync.hubs["test-hub"]).toBe("pending");
  });

  it("applies resolved TCGA image evidence when text fields are absent", () => {
    const tracker = new MatchSessionTracker();
    const start = event("match-start", {
      active: true,
      opponentName: "Rival",
      score: { me: "4", opp: "10" },
      myChampionImage: "https://cdn.example/cards/OGN-001/card.png"
    });
    tracker.ingest(start);
    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }), settings, {
      myChampion: "Jinx",
      opponentChampion: "Ahri",
      myBattlefield: "Minefield",
      opponentBattlefield: "Sunken Temple"
    });

    expect(draft.result).toBe("Loss");
    expect(draft.myChampion).toBe("Jinx");
    expect(draft.opponentChampion).toBe("Ahri");
    expect(draft.myBattlefield).toBe("Minefield");
    expect(draft.opponentBattlefield).toBe("Sunken Temple");
  });

  it("uses configured RiftLite username as the local player", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      playerData: { profile: { pseudo: "LocalTcgaName" } },
      opponentName: "Rival",
      score: { me: "7", opp: "2" }
    }));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }), settings);

    expect(draft.myName).toBe("ConfiguredUser");
    expect(draft.result).toBe("Win");
  });

  it("starts a fresh TCGA session when a new opponent appears after a played game", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      opponentName: "First Opponent",
      score: { me: "8", opp: "5" }
    }, "2026-04-24T10:00:00.000Z"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      opponentName: "Next Opponent",
      score: { me: "0", opp: "0" }
    }, "2026-04-24T10:05:00.000Z"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      opponentName: "Next Opponent",
      score: { me: "8", opp: "3" }
    }, "2026-04-24T10:12:00.000Z"));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }, "2026-04-24T10:13:00.000Z"), settings);

    expect(draft.opponentName).toBe("Next Opponent");
    expect(draft.format).toBe("Bo1");
    expect(draft.score).toBe("1-0");
    expect(draft.games).toHaveLength(1);
    expect(draft.games[0].myPoints).toBe(8);
    expect(draft.games[0].oppPoints).toBe(3);
  });

  it("uses score updates captured from network events during an active match", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      opponentName: "Rival",
      myChampion: "Vex, Gloomist",
      opponentChampion: "Ahri"
    }));
    tracker.ingest(event("network-websocket", {
      requestUrl: "wss://example.test/live",
      score: { me: "8", opp: "0", source: "network-json" }
    }, "2026-04-24T10:02:00.000Z"));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }, "2026-04-24T10:03:00.000Z"), settings);

    expect(draft.result).toBe("Win");
    expect(draft.score).toBe("1-0");
    expect(draft.games[0].myPoints).toBe(8);
    expect(draft.games[0].oppPoints).toBe(0);
    expect(draft.myChampion).toBe("Vex");
  });

  it("normalizes subtitle-only legend names from capture payloads", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      opponentName: "Rival",
      myChampion: "Gloomist",
      opponentChampion: "Bloodharbor Ripper",
      score: { me: "4", opp: "2" }
    }));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }), settings);

    expect(draft.myChampion).toBe("Vex");
    expect(draft.opponentChampion).toBe("Pyke");
  });

  it("uses Atlas legend card text for Vendetta preview legends", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      opponentName: "Rival",
      myChampion: "Akali, Hidden Weapon",
      opponentChampion: "Zed, Master of Shadows",
      score: { me: "7", opp: "4" }
    }, "2026-07-09T10:00:00.000Z", "atlas"));

    const draft = tracker.buildDraft("atlas", event("match-end", { active: false }, "2026-07-09T10:03:00.000Z", "atlas"), settings);

    expect(draft.myChampion).toBe("Akali");
    expect(draft.opponentChampion).toBe("Zed");
  });

  it("uses TCGA legend card text for Vendetta preview legends", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      opponentName: "Rival",
      myChampion: "Akali, Hidden Weapon",
      opponentChampion: "Zed, Master of Shadows",
      score: { me: "7", opp: "4" }
    }, "2026-07-09T10:00:00.000Z", "tcga"));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }, "2026-07-09T10:03:00.000Z", "tcga"), settings);

    expect(draft.myChampion).toBe("Akali");
    expect(draft.opponentChampion).toBe("Zed");
  });

  it("ignores TCGA action labels when resolving Vendetta legends from card art", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      opponentName: "Rival",
      myChampion: "Tap",
      opponentChampion: "Ping",
      myChampionImage: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0d53b477ed43fb9bbed84858443a606b2b51a2b5-744x1039.png?accountingTag=RB&auto=format&fit=fill&q=80&w=444",
      opponentChampionImage: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/7620595b36b40a0c3d05c4c5469b016d1c18c6f2-744x1039.png?accountingTag=RB&auto=format&fit=fill&q=80&w=444",
      score: { me: "4", opp: "5" }
    }, "2026-07-09T16:12:46.919Z", "tcga"));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }, "2026-07-09T16:22:11.332Z", "tcga"), settings);

    expect(draft.myChampion).toBe("Akali");
    expect(draft.opponentChampion).toBe("Renekton");
  });

  it("resolves TCGA Kennen from hashed Riot card art when legend text is missing", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      opponentName: "Gavro",
      myChampion: "",
      opponentChampion: "",
      myChampionImage: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0d53b477ed43fb9bbed84858443a606b2b51a2b5-744x1039.png?accountingTag=RB&auto=format&fit=fill&q=80&w=444",
      opponentChampionImage: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0eab83392b310417d2630d50a3bfee3dd02b31c4-744x1039.png?accountingTag=RB&auto=format&fit=fill&q=80&w=444",
      score: { me: "7", opp: "5" }
    }, "2026-07-09T18:24:11.655Z", "tcga"));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }, "2026-07-09T18:26:28.209Z", "tcga"), settings);

    expect(draft.myChampion).toBe("Akali");
    expect(draft.opponentChampion).toBe("Kennen");
  });

  it("resolves TCGA opponent and score from named counter players", () => {
    const tracker = new MatchSessionTracker();
    const bmuSettings = { ...settings, username: "BMU" };
    tracker.ingest(event("match-start", {
      active: true,
      myName: "Bubba",
      opponentName: "BMU",
      localPlayerName: "BMU",
      counterPlayers: [
        { name: "Bubba", score: "5" },
        { name: "BMU", score: "7" }
      ],
      playerData: { lastOpponentPeerData: { name: "Bubba" } },
      score: { me: "5", opp: "7", source: "tcga-counter-order" }
    }));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }), bmuSettings);

    expect(draft.myName).toBe("BMU");
    expect(draft.opponentName).toBe("Bubba");
    expect(draft.result).toBe("Win");
    expect(draft.games[0].myPoints).toBe(7);
    expect(draft.games[0].oppPoints).toBe(5);
  });

  it("uses TCGA pseudo instead of the saved game name when pairing scores", () => {
    const tracker = new MatchSessionTracker();
    const noConfiguredName = { ...settings, username: "" };
    tracker.ingest(event("match-start", {
      active: true,
      localPlayerName: "Riftbound",
      playerData: {
        games: [
          {
            name: "Riftbound",
            image: "https://tcg-arena.fr/assets/games/riftbound.jpg",
            url: "/games/riftbound"
          }
        ],
        preferences: { pseudo: "NotNewGenesis" },
        lastOpponentPeerData: { name: "BMU" }
      },
      counterPlayers: [
        { name: "BMU", score: "6" },
        { name: "NotNewGenesis", score: "7" }
      ],
      score: { me: "", opp: "6", source: "tcga-counter-player" }
    }));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }), noConfiguredName);

    expect(draft.myName).toBe("NotNewGenesis");
    expect(draft.opponentName).toBe("BMU");
    expect(draft.result).toBe("Win");
    expect(draft.games[0].myPoints).toBe(7);
    expect(draft.games[0].oppPoints).toBe(6);
  });

  it("ignores TCGA zero-zero setup snapshots before a scored BO1", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      myName: "NotNewGenesis",
      opponentName: "Demonmik",
      score: { me: "0", opp: "0", source: "tcga-counter-player" },
      myBattlefieldImage: "https://cdn.example/OGN-001-setup.png",
      opponentBattlefieldImage: "https://cdn.example/OGN-002-setup.png"
    }));
    tracker.ingest(event("match-snapshot", {
      active: true,
      myName: "NotNewGenesis",
      opponentName: "Demonmik",
      score: { me: "0", opp: "0", source: "tcga-counter-player" },
      myBattlefieldImage: "https://cdn.example/OGN-296-void-gate.png",
      opponentBattlefieldImage: "https://cdn.example/OGN-297-forge.png"
    }, "2026-04-24T10:01:00.000Z"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      myName: "NotNewGenesis",
      opponentName: "Demonmik",
      score: { me: "8", opp: "7", source: "tcga-counter-player" },
      myBattlefieldImage: "https://cdn.example/OGN-296-void-gate.png",
      opponentBattlefieldImage: "https://cdn.example/OGN-297-forge.png"
    }, "2026-04-24T10:02:00.000Z"));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false, score: { me: "", opp: "", source: "none" } }, "2026-04-24T10:03:00.000Z"), { ...settings, username: "NotNewGenesis" });

    expect(draft.format).toBe("Bo1");
    expect(draft.result).toBe("Win");
    expect(draft.score).toBe("1-0");
    expect(draft.games).toHaveLength(1);
    expect(draft.games[0].myPoints).toBe(8);
    expect(draft.games[0].oppPoints).toBe(7);
    expect(draft.games[0].myBattlefieldImage).toContain("void-gate");
  });

  it("does not turn a post-game zero reset into an extra BO3 game", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      opponentName: "Rival",
      score: { me: "8", opp: "7", source: "tcga-counter-player" },
      myBattlefieldImage: "https://cdn.example/OGN-296-void-gate.png",
      opponentBattlefieldImage: "https://cdn.example/OGN-297-forge.png"
    }));
    tracker.ingest(event("match-snapshot", {
      active: true,
      score: { me: "0", opp: "0", source: "tcga-counter-player" },
      myBattlefieldImage: "https://cdn.example/OGN-294-lobby.png",
      opponentBattlefieldImage: "https://cdn.example/OGN-295-lobby.png"
    }, "2026-04-24T10:03:00.000Z"));

    const end = event("match-end", { active: false, reason: "inactive-debounce" }, "2026-04-24T10:04:00.000Z");
    tracker.ingest(end);
    expect(tracker.shouldHoldForBo3("tcga", end)).toBe(false);
    const draft = tracker.buildDraft("tcga", end, settings);

    expect(draft.format).toBe("Bo1");
    expect(draft.score).toBe("1-0");
    expect(draft.games).toHaveLength(1);
    expect(draft.games[0].myPoints).toBe(8);
    expect(draft.games[0].oppPoints).toBe(7);
  });

  it("preserves a low-score TCGA BO3 loss when counters reset to zero", () => {
    const tracker = new MatchSessionTracker();
    const maskedSwanSettings = { ...settings, username: "MaskedSwan" };

    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      configuredUsername: "MaskedSwan",
      playerData: { preferences: { pseudo: "MaskedSwan" } },
      counterPlayers: [
        { name: "Rayomax", score: "5" },
        { name: "MaskedSwan", score: "0" }
      ],
      myBattlefield: "The Academy",
      opponentBattlefield: "Sunken Temple"
    }, "2026-05-13T20:00:00.000Z"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Bo3",
      configuredUsername: "MaskedSwan",
      counterPlayers: [
        { name: "Rayomax", score: "0" },
        { name: "MaskedSwan", score: "0" }
      ]
    }, "2026-05-13T20:08:00.000Z"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Bo3",
      configuredUsername: "MaskedSwan",
      counterPlayers: [
        { name: "Rayomax", score: "6" },
        { name: "MaskedSwan", score: "6" }
      ],
      myBattlefield: "Ripper's Bay",
      opponentBattlefield: "Vilemaw's Lair"
    }, "2026-05-13T20:18:00.000Z"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Bo3",
      configuredUsername: "MaskedSwan",
      counterPlayers: [
        { name: "Rayomax", score: "0" },
        { name: "MaskedSwan", score: "0" }
      ]
    }, "2026-05-13T20:19:00.000Z"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Bo3",
      configuredUsername: "MaskedSwan",
      counterPlayers: [
        { name: "Rayomax", score: "6" },
        { name: "MaskedSwan", score: "0" }
      ],
      myBattlefield: "The Papertree",
      opponentBattlefield: "Valley of Idols"
    }, "2026-05-13T20:28:00.000Z"));

    const draft = tracker.buildDraft("tcga", event("match-end", {
      active: false,
      reason: "inactive-debounce"
    }, "2026-05-13T20:30:00.000Z"), maskedSwanSettings);

    expect(draft.format).toBe("Bo3");
    expect(draft.score).toBe("0-2");
    expect(draft.games).toHaveLength(3);
    expect(draft.games[0].result).toBe("Loss");
    expect(draft.games[0].myPoints).toBe(0);
    expect(draft.games[0].oppPoints).toBe(5);
    expect(draft.games[0].myBattlefield).toBe("The Academy");
    expect(draft.games[1].result).toBe("Incomplete");
    expect(draft.games[1].myPoints).toBe(6);
    expect(draft.games[1].oppPoints).toBe(6);
    expect(draft.games[2].result).toBe("Loss");
    expect(draft.games[2].myPoints).toBe(0);
    expect(draft.games[2].oppPoints).toBe(6);
  });

  it("preserves an explicit TCGA BO3 quick 4 point game when counters reset to zero", () => {
    const tracker = new MatchSessionTracker();
    const bmuSettings = { ...settings, username: "BMU" };

    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      configuredUsername: "BMU",
      playerData: { preferences: { pseudo: "BMU" } },
      counterPlayers: [
        { name: "Opponent", score: "0" },
        { name: "BMU", score: "4" }
      ],
      myBattlefield: "Zaun Warrens",
      opponentBattlefield: "Dusk Rose Lab"
    }, "2026-05-23T20:00:00.000Z"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Bo3",
      configuredUsername: "BMU",
      counterPlayers: [
        { name: "Opponent", score: "0" },
        { name: "BMU", score: "0" }
      ]
    }, "2026-05-23T20:05:00.000Z"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Bo3",
      configuredUsername: "BMU",
      counterPlayers: [
        { name: "Opponent", score: "1" },
        { name: "BMU", score: "5" }
      ],
      myBattlefield: "The Papertree",
      opponentBattlefield: "Sunken Temple"
    }, "2026-05-23T20:14:00.000Z"));

    const draft = tracker.buildDraft("tcga", event("match-end", {
      active: false,
      reason: "inactive-debounce"
    }, "2026-05-23T20:15:00.000Z"), bmuSettings);

    expect(draft.format).toBe("Bo3");
    expect(draft.score).toBe("2-0");
    expect(draft.games).toHaveLength(2);
    expect(draft.games[0].result).toBe("Win");
    expect(draft.games[0].myPoints).toBe(4);
    expect(draft.games[0].oppPoints).toBe(0);
    expect(draft.games[0].myBattlefield).toBe("Zaun Warrens");
    expect(draft.games[0].oppBattlefield).toBe("Dusk Rose Lab");
    expect(draft.games[1].result).toBe("Win");
    expect(draft.games[1].myPoints).toBe(5);
    expect(draft.games[1].oppPoints).toBe(1);
  });

  it("does not accept partial TCGA counter scores when the local row cannot be matched", () => {
    const tracker = new MatchSessionTracker();
    const noConfiguredName = { ...settings, username: "" };
    tracker.ingest(event("match-start", {
      active: true,
      localPlayerName: "UnknownLocal",
      counterPlayers: [
        { name: "BMU", score: "6" },
        { name: "NotNewGenesis", score: "7" }
      ],
      score: { me: "", opp: "6", source: "tcga-counter-player" }
    }));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }), noConfiguredName);

    expect(draft.result).toBe("Incomplete");
    expect(draft.games[0].myPoints).toBeUndefined();
    expect(draft.games[0].oppPoints).toBeUndefined();
  });

  it("marks equal-score TCGA concedes incomplete when no result screen is captured", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      myName: "Coufil",
      opponentName: "magoshin",
      counterPlayers: [
        { name: "magoshin", score: "7" },
        { name: "Coufil", score: "7" }
      ],
      playerData: { preferences: { pseudo: "Coufil" } },
      score: { me: "7", opp: "7", source: "tcga-counter-player" }
    }));

    const draft = tracker.buildDraft("tcga", event("match-end", {
      active: false,
      reason: "inactive-debounce",
      score: { me: "", opp: "", source: "none" }
    }, "2026-04-24T10:08:00.000Z"), { ...settings, username: "Coufil" });

    expect(draft.status).toBe("incomplete");
    expect(draft.result).toBe("Incomplete");
    expect(draft.opponentName).toBe("magoshin");
    expect(draft.games[0].myPoints).toBe(7);
    expect(draft.games[0].oppPoints).toBe(7);
    expect(draft.games[0].result).toBe("Incomplete");
  });

  it("does not start ghost sessions from inactive menu snapshots", () => {
    const tracker = new MatchSessionTracker();
    const session = tracker.ingest(event("match-snapshot", {
      active: false,
      myName: "Coufil",
      score: { me: "", opp: "", source: "none" }
    }));

    expect(session).toBeUndefined();
    expect(tracker.get("tcga")).toBeUndefined();
  });

  it("holds TCGA BO3 inactive gaps until the match is complete", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      opponentName: "Rival",
      score: { me: "7", opp: "5" },
      myBattlefield: "Grove of the God-Willow",
      opponentBattlefield: "Hall of Legends"
    }, "2026-04-24T12:00:00.000Z"));

    const gameOneEnd = event("match-end", { active: false, reason: "inactive-debounce" }, "2026-04-24T12:08:00.000Z");
    gameOneEnd.url = "https://tcg-arena.fr/play";
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("tcga", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("tcga");

    tracker.ingest(event("match-update", {
      active: true,
      reason: "active-returned",
      format: "Bo3",
      score: { me: "3", opp: "8" },
      myBattlefield: "Minefield",
      opponentBattlefield: "Sunken Temple"
    }, "2026-04-24T12:10:00.000Z"));
    const gameTwoEnd = event("match-end", { active: false, reason: "inactive-debounce" }, "2026-04-24T12:18:00.000Z");
    gameTwoEnd.url = "https://tcg-arena.fr/play";
    tracker.ingest(gameTwoEnd);
    expect(tracker.shouldHoldForBo3("tcga", gameTwoEnd)).toBe(true);
    tracker.holdCurrentGame("tcga");

    tracker.ingest(event("match-update", {
      active: true,
      reason: "active-returned",
      format: "Bo3",
      score: { me: "10", opp: "4" },
      myBattlefield: "Back-Alley Bar",
      opponentBattlefield: "Power Nexus"
    }, "2026-04-24T12:20:00.000Z"));
    const finalEnd = event("match-end", { active: false, reason: "inactive-debounce" }, "2026-04-24T12:29:00.000Z");
    tracker.ingest(finalEnd);

    expect(tracker.shouldHoldForBo3("tcga", finalEnd)).toBe(false);
    const draft = tracker.buildDraft("tcga", finalEnd, settings);
    expect(draft.format).toBe("Bo3");
    expect(draft.result).toBe("Win");
    expect(draft.score).toBe("2-1");
    expect(draft.games).toHaveLength(3);
    expect(draft.games[0].myBattlefield).toBe("Grove of the God-Willow");
    expect(draft.games[1].oppPoints).toBe(8);
    expect(draft.games[2].myPoints).toBe(10);
  });

  it("releases an unfinished 1-1 BO3 when no third game starts", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      opponentName: "Rival",
      score: { me: "7", opp: "5" },
      myBattlefield: "The Papertree",
      opponentBattlefield: "Sunken Temple"
    }, "2026-04-24T12:00:00.000Z"));

    const gameOneEnd = event("match-end", { active: false, reason: "inactive-debounce" }, "2026-04-24T12:08:00.000Z");
    gameOneEnd.url = "https://tcg-arena.fr/play";
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("tcga", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("tcga");

    tracker.ingest(event("match-update", {
      active: true,
      reason: "active-returned",
      format: "Bo3",
      score: { me: "4", opp: "8" },
      myBattlefield: "Grove of the God-Willow",
      opponentBattlefield: "Valley of Idols"
    }, "2026-04-24T12:10:00.000Z"));
    const gameTwoEnd = event("match-end", { active: false, reason: "inactive-debounce" }, "2026-04-24T12:18:00.000Z");
    gameTwoEnd.url = "https://tcg-arena.fr/play";
    tracker.ingest(gameTwoEnd);
    expect(tracker.shouldHoldForBo3("tcga", gameTwoEnd)).toBe(true);
    tracker.holdCurrentGame("tcga");

    const abandonedEnd = event("match-end", { active: false, reason: "inactive-debounce" }, "2026-04-24T12:28:00.000Z");
    tracker.ingest(abandonedEnd);

    expect(tracker.shouldHoldForBo3("tcga", abandonedEnd)).toBe(false);
    const draft = tracker.buildDraft("tcga", abandonedEnd, settings);
    expect(draft.format).toBe("Bo3");
    expect(draft.result).toBe("Incomplete");
    expect(draft.status).toBe("incomplete");
    expect(draft.score).toBe("1-1");
    expect(draft.games).toHaveLength(2);
  });

  it("releases an unfinished TCGA BO3 when game two ends and the player leaves play", () => {
    const tracker = new MatchSessionTracker();
    const coufilSettings = { ...settings, username: "Coufil" };
    tracker.ingest(event("match-start", {
      active: true,
      myName: "Coufil",
      opponentName: "Truitemorte",
      counterPlayers: [
        { name: "Truitemorte", score: "8" },
        { name: "Coufil", score: "7" }
      ],
      score: { me: "7", opp: "8", source: "tcga-counter-player" }
    }, "2026-05-05T13:14:51.000Z"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      myName: "Coufil",
      opponentName: "Truitemorte",
      counterPlayers: [
        { name: "Truitemorte", score: "0" },
        { name: "Coufil", score: "0" }
      ],
      score: { me: "0", opp: "0", source: "tcga-counter-player" }
    }, "2026-05-05T13:14:54.000Z"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      myName: "Coufil",
      opponentName: "Truitemorte",
      counterPlayers: [
        { name: "Truitemorte", score: "3" },
        { name: "Coufil", score: "8" }
      ],
      score: { me: "8", opp: "3", source: "tcga-counter-player" }
    }, "2026-05-05T13:49:58.000Z"));

    const leavePlayEnd = event("match-end", {
      active: false,
      reason: "inactive-debounce",
      score: { me: "", opp: "", source: "none" }
    }, "2026-05-05T13:50:04.000Z");
    leavePlayEnd.url = "https://tcg-arena.fr/";
    tracker.ingest(leavePlayEnd);

    expect(tracker.shouldHoldForBo3("tcga", leavePlayEnd)).toBe(false);
    const draft = tracker.buildDraft("tcga", leavePlayEnd, coufilSettings);
    expect(draft.format).toBe("Bo3");
    expect(draft.result).toBe("Incomplete");
    expect(draft.status).toBe("incomplete");
    expect(draft.score).toBe("1-1");
    expect(draft.games).toHaveLength(2);
    expect(draft.games[0].result).toBe("Loss");
    expect(draft.games[1].result).toBe("Win");
  });

  it("starts a new TCGA game when battlefield evidence changes even if format text is absent", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      opponentName: "Rival",
      score: { me: "6", opp: "3" },
      myBattlefieldImage: "https://cdn.example/cards/OGN-101/game-one.png",
      opponentBattlefieldImage: "https://cdn.example/cards/OGN-102/game-one-opp.png"
    }, "2026-04-24T13:00:00.000Z"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      score: { me: "2", opp: "7" },
      myBattlefieldImage: "https://cdn.example/cards/OGN-201/game-two.png",
      opponentBattlefieldImage: "https://cdn.example/cards/OGN-202/game-two-opp.png"
    }, "2026-04-24T13:12:00.000Z"));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }, "2026-04-24T13:20:00.000Z"), settings);

    expect(draft.format).toBe("Bo3");
    expect(draft.score).toBe("1-1");
    expect(draft.games).toHaveLength(2);
    expect(draft.games[0].myBattlefieldImage).toContain("OGN-101");
    expect(draft.games[1].myBattlefieldImage).toContain("OGN-201");
  });

  it("ignores Baron Pit generated battlefield evidence during a live game", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      opponentName: "Rival",
      score: { me: "5", opp: "2" },
      myBattlefield: "The Papertree",
      opponentBattlefield: "Sunken Temple",
      battlefieldCandidates: [
        { side: "me", text: "The Papertree", image: "https://cdn.example/OGN-294-papertree.png", hidden: false },
        { side: "opponent", text: "Sunken Temple", image: "https://cdn.example/OGN-289-sunken-temple.png", hidden: false }
      ]
    }, "2026-04-24T13:30:00.000Z"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      score: { me: "6", opp: "2" },
      myBattlefield: "Baron Pit",
      battlefieldCandidates: [
        { side: "me", text: "The Papertree", image: "https://cdn.example/OGN-294-papertree.png", hidden: false },
        { side: "me", text: "Baron Pit", image: "https://cdn.example/e44f173629322a4e0c32d3f8902c294d4482ef42-baron-pit.png", hidden: false },
        { side: "opponent", text: "Sunken Temple", image: "https://cdn.example/OGN-289-sunken-temple.png", hidden: false }
      ]
    }, "2026-04-24T13:34:00.000Z"));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }, "2026-04-24T13:38:00.000Z"), settings);

    expect(draft.format).toBe("Bo1");
    expect(draft.games).toHaveLength(1);
    expect(draft.games[0].myPoints).toBe(6);
    expect(draft.games[0].myBattlefield).toBe("The Papertree");
    expect(draft.games[0].oppBattlefield).toBe("Sunken Temple");
    expect(draft.games[0].myBattlefieldImage).toContain("papertree");
    expect(draft.games[0].myBattlefieldImage).not.toContain("baron");
  });

  it("preserves per-game battlefield candidate images across BO3 score resets", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      counterPlayers: [
        { name: "BMU", score: "8" },
        { name: "NotNewGenesis", score: "6" }
      ],
      configuredUsername: "BMU",
      battlefieldCandidates: [
        { side: "me", image: "https://cdn.example/OGN-294-papertree.png", hidden: false },
        { side: "opponent", image: "https://cdn.example/OGN-289-targon.png", hidden: false }
      ]
    }, "2026-04-24T14:00:00.000Z"));
    tracker.ingest(event("match-update", {
      active: true,
      format: "Bo3",
      counterPlayers: [
        { name: "BMU", score: "2" },
        { name: "NotNewGenesis", score: "7" }
      ],
      configuredUsername: "BMU",
      battlefieldCandidates: [
        { side: "me", image: "https://cdn.example/OGN-292-grove.png", hidden: false },
        { side: "opponent", image: "https://cdn.example/OGN-293-sunspire.png", hidden: false }
      ]
    }, "2026-04-24T14:09:00.000Z"));
    tracker.ingest(event("match-update", {
      active: true,
      format: "Bo3",
      counterPlayers: [
        { name: "BMU", score: "7" },
        { name: "NotNewGenesis", score: "5" }
      ],
      configuredUsername: "BMU",
      battlefieldCandidates: [
        { side: "me", image: "https://cdn.example/OGN-295-vilemaw.png", hidden: false },
        { side: "opponent", image: "https://cdn.example/OGN-289-targon.png", hidden: false }
      ]
    }, "2026-04-24T14:18:00.000Z"));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }, "2026-04-24T14:25:00.000Z"), { ...settings, username: "BMU" });

    expect(draft.format).toBe("Bo3");
    expect(draft.score).toBe("2-1");
    expect(draft.games).toHaveLength(3);
    expect(draft.games[0].myBattlefieldImage).toContain("papertree");
    expect(draft.games[1].myBattlefieldImage).toContain("grove");
    expect(draft.games[2].myBattlefieldImage).toContain("vilemaw");
    expect(draft.games[1].oppBattlefieldImage).toContain("sunspire");
  });

  it("freezes TCGA game battlefields before the first BO3 zero reset can overwrite them", () => {
    const tracker = new MatchSessionTracker();
    const bmuSettings = { ...settings, username: "BMU" };

    tracker.ingest(event("match-start", {
      active: true,
      counterPlayers: [
        { name: "BMU", score: "7" },
        { name: "TinoDLuffy", score: "3" }
      ],
      configuredUsername: "BMU",
      battlefieldCandidates: [
        { side: "me", image: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/c395b94a4f78b4e8b0590b56787c33600b18e358-1039x744.png", hidden: false },
        { side: "opponent", image: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/06f6d17929d19000006cf281d013ecbe1543af0e-1039x744.png", hidden: false }
      ]
    }, "2026-04-27T12:25:00.000Z"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      counterPlayers: [
        { name: "BMU", score: "0" },
        { name: "TinoDLuffy", score: "0" }
      ],
      configuredUsername: "BMU",
      battlefieldCandidates: [
        { side: "me", image: "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-295/full-desktop-2x.avif", hidden: false },
        { side: "opponent", image: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0497a44ab302ea055b6f1f0d00a36c8023ed2344-1039x744.png", hidden: false }
      ]
    }, "2026-04-27T12:37:20.000Z"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      counterPlayers: [
        { name: "BMU", score: "4" },
        { name: "TinoDLuffy", score: "5" }
      ],
      configuredUsername: "BMU",
      battlefieldCandidates: [
        { side: "me", image: "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-295/full-desktop-2x.avif", hidden: false },
        { side: "opponent", image: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0497a44ab302ea055b6f1f0d00a36c8023ed2344-1039x744.png", hidden: false }
      ]
    }, "2026-04-27T12:40:30.000Z"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      counterPlayers: [
        { name: "BMU", score: "0" },
        { name: "TinoDLuffy", score: "0" }
      ],
      configuredUsername: "BMU",
      battlefieldCandidates: [
        { side: "me", image: "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-280/full-desktop-2x.avif", hidden: false },
        { side: "opponent", image: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/4191aa2fda9e754a7f5421edc94bd829f5795650-1039x744.png", hidden: false }
      ]
    }, "2026-04-27T12:48:36.000Z"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      counterPlayers: [
        { name: "BMU", score: "8" },
        { name: "TinoDLuffy", score: "4" }
      ],
      configuredUsername: "BMU",
      battlefieldCandidates: [
        { side: "me", image: "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-280/full-desktop-2x.avif", hidden: false },
        { side: "opponent", image: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/4191aa2fda9e754a7f5421edc94bd829f5795650-1039x744.png", hidden: false }
      ]
    }, "2026-04-27T12:59:00.000Z"));

    const draft = tracker.buildDraft("tcga", event("match-end", { active: false }, "2026-04-27T13:00:00.000Z"), bmuSettings);

    expect(draft.format).toBe("Bo3");
    expect(draft.score).toBe("2-1");
    expect(draft.games).toHaveLength(3);
    expect(draft.games[0].myBattlefieldImage).toContain("c395b94a4f78b4e8b0590b56787c33600b18e358");
    expect(draft.games[0].oppBattlefieldImage).toContain("06f6d17929d19000006cf281d013ecbe1543af0e");
    expect(draft.games[1].myBattlefieldImage).toContain("OGN-295");
    expect(draft.games[1].oppBattlefieldImage).toContain("0497a44ab302ea055b6f1f0d00a36c8023ed2344");
    expect(draft.games[2].myBattlefieldImage).toContain("OGN-280");
    expect(draft.games[2].oppBattlefieldImage).toContain("4191aa2fda9e754a7f5421edc94bd829f5795650");
  });

  it("creates a conservative TCGA visual replay stream from board evidence", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      tcgaPhase: "mulligan",
      score: { me: "0", opp: "0", source: "tcga-counter-player" },
      battlefieldCandidates: [
        { side: "me", code: "OGN-296", image: "https://cdn.example/void-gate.png", hidden: false },
        { side: "opponent", code: "OGN-297", image: "https://cdn.example/forge.png", hidden: false }
      ]
    }, "2026-04-24T14:30:00.000Z"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      tcgaPhase: "playing",
      turnText: "Your turn",
      score: { me: "0", opp: "0", source: "tcga-counter-player" },
      battlefieldCandidates: [
        { side: "me", code: "OGN-296", image: "https://cdn.example/void-gate.png", hidden: false },
        { side: "opponent", code: "OGN-297", image: "https://cdn.example/forge.png", hidden: false }
      ]
    }, "2026-04-24T14:31:00.000Z"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      tcgaPhase: "playing",
      turnText: "Your turn",
      score: { me: "0", opp: "0", source: "tcga-counter-player" },
      battlefieldCandidates: [
        { side: "me", text: "ErrorTap" },
        { side: "opponent", text: "Ping" }
      ]
    }, "2026-04-24T14:31:10.000Z"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      tcgaPhase: "playing",
      score: { me: "3", opp: "1", source: "tcga-counter-player" }
    }, "2026-04-24T14:33:00.000Z"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      tcgaPhase: "playing",
      score: { me: "0", opp: "0", source: "tcga-counter-player" }
    }, "2026-04-24T14:33:10.000Z"));
    tracker.ingest(event("match-end", {
      active: false,
      endText: "You win",
      score: { me: "8", opp: "5", source: "tcga-counter-player" }
    }, "2026-04-24T14:40:00.000Z"));

    const replayEvents = tracker.getReplayEvents("tcga");

    expect(replayEvents.map((item) => item.type)).toEqual([
      "setup",
      "battlefield",
      "scoreboard",
      "setup",
      "turn-start",
      "scoreboard",
      "scoreboard",
      "result"
    ]);
    expect(replayEvents[0].text).toBe("Before mulligan.");
    expect(replayEvents.find((item) => item.text === "After mulligan.")).toBeTruthy();
    expect(replayEvents.filter((item) => item.type === "turn-start")).toHaveLength(1);
    expect(replayEvents.filter((item) => item.text === "Score 0-0")).toHaveLength(1);
    expect(replayEvents.some((item) => /Ping|ErrorTap/.test(item.text))).toBe(false);
    expect(replayEvents.find((item) => item.type === "battlefield")?.battlefields?.map((battlefield) => battlefield.code)).toEqual(["OGN-296", "OGN-297"]);
    expect(replayEvents.at(-1)?.text).toBe("You win");
  });

  it("infers TCGA card plays and moves from visible card snapshot changes", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      tcgaPhase: "playing",
      turnText: "Your turn",
      score: { me: "0", opp: "0", source: "tcga-counter-player" },
      cards: [
        { cardId: "legend", text: "Vex", code: "OGN-001", zone: "legend", classes: "game-card Legend" },
        { cardId: "hidden", text: "", code: "", zone: "hand", classes: "game-card card-hidden-yes" }
      ]
    }, "2026-04-24T14:30:00.000Z"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      tcgaPhase: "playing",
      turnText: "Your turn",
      score: { me: "0", opp: "0", source: "tcga-counter-player" },
      cards: [
        { cardId: "legend", text: "Vex", code: "OGN-001", zone: "legend", classes: "game-card Legend" },
        { cardId: "unit-1", text: "Watchful Sentry", code: "OGN-123", zone: "base", zoneOwner: "self", classes: "game-card Unit" }
      ]
    }, "2026-04-24T14:31:00.000Z"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      tcgaPhase: "playing",
      turnText: "Your turn",
      score: { me: "0", opp: "0", source: "tcga-counter-player" },
      cards: [
        { cardId: "unit-1", text: "Watchful Sentry", code: "OGN-123", zone: "B1", zoneOwner: "self", classes: "game-card Unit B1" },
        { cardId: "opp-1", text: "Sneaky Deckhand", code: "OGN-124", zone: "base", zoneOwner: "opponent", classes: "game-card Unit opponent-card" },
        { cardId: "side-1", text: "Tap", code: "OGN-028", zone: "", zoneOwner: "self", classes: "game-card Sideboard card-hidden-no" },
        { cardId: "mana-1", text: "Untap", code: "OGN-166", zone: "", zoneOwner: "self", classes: "game-card Mana card-hidden-no" }
      ]
    }, "2026-04-24T14:32:00.000Z"));

    const cardEvents = tracker.getReplayEvents("tcga").filter((item) => item.type === "play" || item.type === "move");

    expect(cardEvents.map((item) => item.text)).toEqual([
      "Played Watchful Sentry to base.",
      "Moved Watchful Sentry to battlefield.",
      "Played Sneaky Deckhand to base."
    ]);
    expect(cardEvents.map((item) => item.side)).toEqual(["me", "me", "opponent"]);
  });

  it("holds Atlas BO3 game result screens until the match is complete", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "Rival",
      score: { me: "7", opp: "5" },
      myBattlefield: "The Papertree"
    }, "2026-04-24T15:00:00.000Z", "atlas"));
    tracker.ingest(event("match-update", {
      active: true,
      reason: "atlas-websocket-seat",
      roomCode: "GAME1",
      atlasGameInstanceId: "INSTANCE1",
      wentFirst: "2nd"
    }, "2026-04-24T15:00:01.000Z", "atlas"));

    const gameOneEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      score: { me: "7", opp: "5" },
      myBattlefield: "The Papertree"
    }, "2026-04-24T15:08:00.000Z", "atlas");
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameOneEnd);
    tracker.ingest(event("match-snapshot", {
      active: true,
      reason: "safety-heartbeat",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      score: { me: "7", opp: "5" },
      myBattlefield: "The Papertree"
    }, "2026-04-24T15:08:02.000Z", "atlas"));

    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      myName: "BMU",
      opponentName: "Rival",
      score: { me: "4", opp: "8" },
      myBattlefield: "Grove of the God-Willow"
    }, "2026-04-24T15:10:00.000Z", "atlas"));
    tracker.ingest(event("match-update", {
      active: true,
      reason: "atlas-websocket-seat",
      roomCode: "GAME2",
      atlasGameInstanceId: "INSTANCE2",
      wentFirst: "1st"
    }, "2026-04-24T15:10:01.000Z", "atlas"));
    const gameTwoEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Bo3",
      atlasResultKind: "game-result",
      endText: "You lose 4-8",
      score: { me: "4", opp: "8" },
      myBattlefield: "Grove of the God-Willow"
    }, "2026-04-24T15:18:00.000Z", "atlas");
    tracker.ingest(gameTwoEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameTwoEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameTwoEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      myName: "BMU",
      opponentName: "Rival",
      score: { me: "9", opp: "6" },
      myBattlefield: "Vilemaw's Lair"
    }, "2026-04-24T15:20:00.000Z", "atlas"));
    tracker.ingest(event("match-update", {
      active: true,
      reason: "atlas-websocket-seat",
      roomCode: "GAME3",
      atlasGameInstanceId: "INSTANCE3",
      wentFirst: "2nd"
    }, "2026-04-24T15:20:01.000Z", "atlas"));
    const finalEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Bo3",
      atlasResultKind: "game-result",
      endText: "Confirm Game 3 Winner",
      score: { me: "9", opp: "6" },
      myBattlefield: "Vilemaw's Lair"
    }, "2026-04-24T15:28:00.000Z", "atlas");
    tracker.ingest(finalEnd);

    expect(tracker.shouldHoldForBo3("atlas", finalEnd)).toBe(false);

    const draft = tracker.buildDraft("atlas", finalEnd, { ...settings, username: "BMU" });
    expect(draft.format).toBe("Bo3");
    expect(draft.score).toBe("2-1");
    expect(draft.games).toHaveLength(3);
    expect(draft.games[0].myBattlefield).toBe("The Papertree");
    expect(draft.games[1].myBattlefield).toBe("Grove of the God-Willow");
    expect(draft.games[2].myBattlefield).toBe("Vilemaw's Lair");
    expect(draft.games.map((game) => game.wentFirst)).toEqual(["2nd", "1st", "2nd"]);
  });

  it("does not duplicate a held Atlas game on the 0-0 bridge before the next game", () => {
    const tracker = new MatchSessionTracker();

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "talman",
      score: { me: "7", opp: "6", source: "atlas-score-track" },
      myBattlefield: "Zaun Warrens",
      opponentBattlefield: "Windswept Hillock"
    }, "2026-06-08T20:43:35.000Z", "atlas"));

    const gameOneEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      opponentName: "talman",
      score: { me: "7", opp: "6", source: "atlas-score-track" },
      myBattlefield: "Zaun Warrens",
      opponentBattlefield: "Windswept Hillock"
    }, "2026-06-08T20:44:46.000Z", "atlas");
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameOneEnd);

    tracker.ingest(event("match-start", {
      active: true,
      reason: "safety-heartbeat",
      format: "Auto",
      myName: "BMU",
      opponentName: "talman",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-06-08T20:44:48.000Z", "atlas"));

    expect(tracker.previewGames("atlas")).toHaveLength(1);

    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "talman",
      score: { me: "6", opp: "3", source: "atlas-score-track" },
      myBattlefield: "The Arena's Greatest",
      opponentBattlefield: "Aspirant's Climb"
    }, "2026-06-08T20:52:52.000Z", "atlas"));

    const gameTwoEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 2 Winner",
      opponentName: "talman",
      score: { me: "6", opp: "3", source: "atlas-score-track" },
      myBattlefield: "The Arena's Greatest",
      opponentBattlefield: "Aspirant's Climb"
    }, "2026-06-08T20:53:01.000Z", "atlas");
    tracker.ingest(gameTwoEnd);

    const preview = tracker.previewGames("atlas");
    expect(preview).toHaveLength(2);
    expect(preview[0].myPoints).toBe(7);
    expect(preview[1].myPoints).toBe(6);
    expect(preview[1].myBattlefield).toBe("The Arena's Greatest");
  });

  it("does not let Atlas debug events clear the held-result echo guard before BO3 continues", () => {
    const tracker = new MatchSessionTracker();
    const bmuSettings = { ...settings, username: "BMU" };
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "greedu071",
      myChampion: "Master Yi, Wuju Bladesman",
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
    const debugSignature = (at: string) => event("debug", {
      active: true,
      reason: "snapshot-signature-changed",
      format: "Auto"
    }, at, "atlas");
    const echoSnapshot = (game: number, me: string, opp: string, mine: string, theirs: string, at: string) => event("match-snapshot", {
      ...base,
      reason: "mutation",
      atlasResultKind: "game-result",
      endText: `Confirm Game ${game} Winner`,
      score: score(me, opp),
      ...battlefields(mine, theirs)
    }, at, "atlas");

    tracker.ingest(event("match-start", {
      ...base,
      score: score("0", "0"),
      ...battlefields("SFD-217", "SFD-210")
    }, "2026-06-22T21:10:52.255Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      ...base,
      score: score("2", "7"),
      ...battlefields("SFD-217", "SFD-210")
    }, "2026-06-22T21:19:18.130Z", "atlas"));
    const gameOneEnd = confirmGame(1, "2", "7", "SFD-217", "SFD-210", "2026-06-22T21:19:30.458Z");
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameOneEnd);
    tracker.ingest(debugSignature("2026-06-22T21:19:30.460Z"));
    tracker.ingest(echoSnapshot(1, "2", "7", "SFD-217", "SFD-210", "2026-06-22T21:19:30.461Z"));
    tracker.ingest(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-22T21:19:33.950Z", "atlas"));
    expect(tracker.previewGames("atlas").map((game) => `${game.myPoints}-${game.oppPoints}`)).toEqual(["2-7"]);

    tracker.ingest(event("match-snapshot", {
      ...base,
      score: score("7", "6"),
      ...battlefields("OGN-290", "OGN-294")
    }, "2026-06-22T21:27:29.000Z", "atlas"));
    const gameTwoEnd = confirmGame(2, "7", "6", "OGN-290", "OGN-294", "2026-06-22T21:27:39.477Z");
    tracker.ingest(gameTwoEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameTwoEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameTwoEnd);
    tracker.ingest(debugSignature("2026-06-22T21:27:39.479Z"));
    tracker.ingest(echoSnapshot(2, "7", "6", "OGN-290", "OGN-294", "2026-06-22T21:27:39.480Z"));
    tracker.ingest(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-06-22T21:27:42.461Z", "atlas"));
    expect(tracker.previewGames("atlas").map((game) => `${game.myPoints}-${game.oppPoints}`)).toEqual(["2-7", "7-6"]);

    tracker.ingest(event("match-snapshot", {
      ...base,
      score: score("5", "7"),
      ...battlefields("SFD-207", "SFD-213")
    }, "2026-06-22T21:41:48.124Z", "atlas"));
    const gameThreeEnd = confirmGame(3, "5", "7", "SFD-207", "SFD-213", "2026-06-22T21:41:58.500Z");
    tracker.ingest(gameThreeEnd);

    const draft = tracker.buildDraft("atlas", gameThreeEnd, bmuSettings);
    expect(draft.format).toBe("Bo3");
    expect(draft.score).toBe("1-2");
    expect(draft.games.map((game) => `${game.myPoints}-${game.oppPoints}`)).toEqual(["2-7", "7-6", "5-7"]);
    expect(draft.games.map((game) => [game.myBattlefieldImage, game.oppBattlefieldImage])).toEqual([
      [
        "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-217.webp",
        "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-210.webp"
      ],
      [
        "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-290.webp",
        "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-294.webp"
      ],
      [
        "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-207.webp",
        "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-213.webp"
      ]
    ]);
  });

  it("repairs a stale Atlas bridge row with the confirmed Game 2 result evidence", () => {
    const tracker = new MatchSessionTracker();

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "talman",
      score: { me: "7", opp: "6", source: "atlas-score-track" },
      myBattlefield: "Zaun Warrens",
      opponentBattlefield: "Windswept Hillock"
    }, "2026-06-08T20:43:35.000Z", "atlas"));

    const gameOneEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      opponentName: "talman",
      score: { me: "7", opp: "6", source: "atlas-score-track" },
      myBattlefield: "Zaun Warrens",
      opponentBattlefield: "Windswept Hillock"
    }, "2026-06-08T20:44:46.000Z", "atlas");
    tracker.ingest(gameOneEnd);
    tracker.holdCurrentGame("atlas", gameOneEnd);

    tracker.ingest(event("match-snapshot", {
      active: true,
      reason: "stale-bridge",
      format: "Auto",
      myName: "BMU",
      opponentName: "talman",
      score: { me: "7", opp: "6", source: "atlas-score-track" },
      myBattlefield: "Zaun Warrens",
      opponentBattlefield: "Windswept Hillock"
    }, "2026-06-08T20:44:47.000Z", "atlas"));
    tracker.ingest(event("match-start", {
      active: true,
      reason: "safety-heartbeat",
      format: "Auto",
      myName: "BMU",
      opponentName: "talman",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-06-08T20:44:48.000Z", "atlas"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "talman",
      score: { me: "6", opp: "3", source: "atlas-score-track" },
      myBattlefield: "The Arena's Greatest",
      opponentBattlefield: "Aspirant's Climb"
    }, "2026-06-08T20:52:52.000Z", "atlas"));

    tracker.ingest(event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 2 Winner",
      opponentName: "talman",
      score: { me: "6", opp: "3", source: "atlas-score-track" },
      myBattlefield: "The Arena's Greatest",
      opponentBattlefield: "Aspirant's Climb"
    }, "2026-06-08T20:53:01.000Z", "atlas"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "talman",
      score: { me: "8", opp: "4", source: "atlas-score-track" },
      myBattlefield: "The Academy",
      opponentBattlefield: "The Papertree"
    }, "2026-06-08T21:06:00.000Z", "atlas"));

    const draft = tracker.buildDraft("atlas", event("match-end", {
      active: false,
      reason: "inactive-debounce"
    }, "2026-06-08T21:08:21.000Z", "atlas"), { ...settings, username: "BMU" });

    expect(draft.games).toHaveLength(3);
    expect(draft.games.map((game) => `${game.myPoints}-${game.oppPoints}`)).toEqual(["7-6", "6-3", "8-4"]);
    expect(draft.games[1].myBattlefield).toBe("The Arena's Greatest");
    expect(draft.games[1].oppBattlefield).toBe("Aspirant's Climb");
  });

  it("does not release an Atlas BO3 on a Confirm Game 2 Winner screen", () => {
    const tracker = new MatchSessionTracker();

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "CurlyNuke",
      score: { me: "8", opp: "3", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-276.webp"
    }, "2026-05-11T13:18:00.000Z", "atlas"));

    const gameOneEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      opponentName: "CurlyNuke",
      score: { me: "8", opp: "3", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-276.webp"
    }, "2026-05-11T13:24:55.490Z", "atlas");
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameOneEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "CurlyNuke",
      score: { me: "0", opp: "0", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-289.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-209.webp"
    }, "2026-05-11T13:24:59.296Z", "atlas"));

    const gameTwoEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 2 Winner",
      opponentName: "CurlyNuke",
      score: { me: "2", opp: "8", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-289.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-209.webp"
    }, "2026-05-11T13:31:06.038Z", "atlas");
    tracker.ingest(gameTwoEnd);

    expect(tracker.shouldHoldForBo3("atlas", gameTwoEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameTwoEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "CurlyNuke",
      score: { me: "0", opp: "0", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-220.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-214.webp"
    }, "2026-05-11T13:31:13.365Z", "atlas"));

    const gameThreeEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 3 Winner",
      opponentName: "CurlyNuke",
      score: { me: "8", opp: "5", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-220.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-214.webp"
    }, "2026-05-11T13:40:00.000Z", "atlas");
    tracker.ingest(gameThreeEnd);

    expect(tracker.shouldHoldForBo3("atlas", gameThreeEnd)).toBe(false);
    const draft = tracker.buildDraft("atlas", gameThreeEnd, { ...settings, username: "BMU" });
    expect(draft.format).toBe("Bo3");
    expect(draft.games).toHaveLength(3);
    expect(draft.games.map((game) => game.myBattlefieldImage)).toEqual([
      "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-289.webp",
      "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-220.webp"
    ]);
  });

  it("keeps Atlas BO3 games together when the opponent slot contains score text between games", () => {
    const tracker = new MatchSessionTracker();
    const bmuSettings = { ...settings, username: "AsuiKitsune" };

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      myName: "AsuiKitsune",
      opponentName: "Rival",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-05-25T04:50:00.000Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Auto",
      myName: "AsuiKitsune",
      opponentName: "6/6",
      score: { me: "6", opp: "4", source: "atlas-score-track" }
    }, "2026-05-25T04:53:06.162Z", "atlas"));
    const gameOneEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      myName: "AsuiKitsune",
      opponentName: "6/6",
      score: { me: "6", opp: "4", source: "atlas-score-track" }
    }, "2026-05-25T04:53:36.438Z", "atlas");
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameOneEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      myName: "AsuiKitsune",
      opponentName: "0/0",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-05-25T04:53:40.347Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Auto",
      myName: "AsuiKitsune",
      opponentName: "0/5",
      score: { me: "1", opp: "5", source: "atlas-score-track" }
    }, "2026-05-25T04:57:03.373Z", "atlas"));
    const gameTwoEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 2 Winner",
      myName: "AsuiKitsune",
      opponentName: "0/5",
      score: { me: "1", opp: "5", source: "atlas-score-track" }
    }, "2026-05-25T04:57:57.819Z", "atlas");
    tracker.ingest(gameTwoEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameTwoEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameTwoEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      myName: "AsuiKitsune",
      opponentName: "0/0",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-05-25T04:58:01.838Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Auto",
      myName: "AsuiKitsune",
      opponentName: "0/5",
      score: { me: "8", opp: "4", source: "atlas-score-track" }
    }, "2026-05-25T05:03:03.243Z", "atlas"));
    const finalEnd = event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Auto",
      myName: "AsuiKitsune",
      score: { me: "", opp: "", source: "none" }
    }, "2026-05-25T05:03:13.181Z", "atlas", "https://play.riftatlas.com/");
    tracker.ingest(finalEnd);

    expect(tracker.shouldHoldForBo3("atlas", finalEnd)).toBe(false);
    const draft = tracker.buildDraft("atlas", finalEnd, bmuSettings);
    expect(draft.format).toBe("Bo3");
    expect(draft.score).toBe("2-1");
    expect(draft.games.map((game) => `${game.myPoints}-${game.oppPoints}`)).toEqual(["6-4", "1-5", "8-4"]);
  });

  it("holds Atlas BO3 game two confirmation even when score inference looks complete", () => {
    const tracker = new MatchSessionTracker();

    const gameOneEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Bo3",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      opponentName: "XD",
      score: { me: "7", opp: "5", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-209.webp"
    }, "2026-05-11T15:11:15.203Z", "atlas");
    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      opponentName: "XD",
      score: { me: "6", opp: "5", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-209.webp"
    }, "2026-05-11T15:07:39.622Z", "atlas"));
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameOneEnd);

    const gameTwoEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Bo3",
      atlasResultKind: "game-result",
      endText: "Confirm Game 2 Winner",
      opponentName: "XD",
      score: { me: "5", opp: "3", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-297.webp"
    }, "2026-05-11T15:18:46.738Z", "atlas");
    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      opponentName: "XD",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-05-11T15:11:18.665Z", "atlas"));
    tracker.ingest(gameTwoEnd);

    expect(tracker.shouldHoldForBo3("atlas", gameTwoEnd)).toBe(true);
  });

  it("does not split one Atlas game when battlefield markers flicker at the same score", () => {
    const tracker = new MatchSessionTracker();

    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      opponentName: "XD",
      score: { me: "6", opp: "5", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-209.webp"
    }, "2026-05-11T15:07:39.622Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Bo3",
      opponentName: "XD",
      score: { me: "7", opp: "5", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp"
    }, "2026-05-11T15:08:45.201Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Bo3",
      opponentName: "XD",
      score: { me: "7", opp: "5", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-209.webp"
    }, "2026-05-11T15:09:05.256Z", "atlas"));
    const gameOneEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Bo3",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      opponentName: "XD",
      score: { me: "7", opp: "5", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-209.webp"
    }, "2026-05-11T15:11:15.203Z", "atlas");
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameOneEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      opponentName: "XD",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-05-11T15:11:18.665Z", "atlas"));
    const finalEnd = event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Bo3",
      opponentName: "XD",
      score: { me: "", opp: "", source: "none" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-297.webp"
    }, "2026-05-11T15:18:46.738Z", "atlas");
    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Bo3",
      opponentName: "XD",
      score: { me: "5", opp: "3", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-297.webp"
    }, "2026-05-11T15:16:11.394Z", "atlas"));
    tracker.ingest(finalEnd);

    const draft = tracker.buildDraft("atlas", finalEnd, { ...settings, username: "BMU" });
    expect(draft.games).toHaveLength(2);
    expect(draft.games.map((game) => `${game.myPoints}-${game.oppPoints}`)).toEqual(["7-5", "5-3"]);
  });

  it("keeps Atlas Auto-format BO3 evidence when setup text looks like an opponent name", () => {
    const tracker = new MatchSessionTracker();
    const bmuSettings = { ...settings, username: "BMU" };

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      myName: "BMU",
      opponentName: "terr",
      score: { me: "0", opp: "0", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-276.webp"
    }, "2026-05-10T07:51:54.922Z", "atlas"));

    const gameOneEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      opponentName: "terr",
      score: { me: "9", opp: "7", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-276.webp"
    }, "2026-05-10T08:06:36.654Z", "atlas");
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameOneEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      opponentName: "07Locked in a BF",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-05-10T08:06:42.156Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Auto",
      opponentName: "07Chose terr to take the first",
      score: { me: "3", opp: "2", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-287.webp"
    }, "2026-05-10T08:10:20.875Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Auto",
      opponentName: "terr",
      score: { me: "7", opp: "2", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-287.webp"
    }, "2026-05-10T08:13:47.887Z", "atlas"));

    const finalEnd = event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Bo1",
      score: { me: "", opp: "", source: "none" }
    }, "2026-05-10T08:14:24.758Z", "atlas");
    tracker.ingest(finalEnd);
    expect(tracker.shouldHoldForBo3("atlas", finalEnd)).toBe(false);

    const draft = tracker.buildDraft("atlas", finalEnd, bmuSettings);
    expect(draft.format).toBe("Bo3");
    expect(draft.score).toBe("2-0");
    expect(draft.opponentName).toBe("terr");
    expect(draft.games.map((game) => `${game.myPoints}-${game.oppPoints}`)).toEqual(["9-7", "7-2"]);
    expect(draft.games.map((game) => game.myBattlefieldImage)).toEqual([
      "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp"
    ]);
  });

  it("freezes Atlas game battlefields before BO3 score resets can overwrite them", () => {
    const tracker = new MatchSessionTracker();
    const bmuSettings = { ...settings, username: "BMU" };

    tracker.ingest(event("match-start", {
      active: true,
      myName: "BMU",
      opponentName: "Rival",
      score: { me: "7", opp: "3" },
      myBattlefield: "The Papertree",
      opponentBattlefield: "Sunken Temple"
    }, "2026-04-24T15:00:00.000Z", "atlas"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      myName: "BMU",
      opponentName: "Rival",
      score: { me: "0", opp: "0" },
      myBattlefield: "Vilemaw's Lair",
      opponentBattlefield: "Gardens of Becoming"
    }, "2026-04-24T15:09:00.000Z", "atlas"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      myName: "BMU",
      opponentName: "Rival",
      score: { me: "4", opp: "5" },
      myBattlefield: "Vilemaw's Lair",
      opponentBattlefield: "Gardens of Becoming"
    }, "2026-04-24T15:16:00.000Z", "atlas"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      myName: "BMU",
      opponentName: "Rival",
      score: { me: "0", opp: "0" },
      myBattlefield: "Grove of the God-Willow",
      opponentBattlefield: "Valley of Idols"
    }, "2026-04-24T15:20:00.000Z", "atlas"));

    tracker.ingest(event("match-snapshot", {
      active: true,
      myName: "BMU",
      opponentName: "Rival",
      score: { me: "8", opp: "4" },
      myBattlefield: "Grove of the God-Willow",
      opponentBattlefield: "Valley of Idols"
    }, "2026-04-24T15:28:00.000Z", "atlas"));

    const draft = tracker.buildDraft("atlas", event("match-end", { active: false }, "2026-04-24T15:30:00.000Z", "atlas"), bmuSettings);

    expect(draft.format).toBe("Bo3");
    expect(draft.score).toBe("2-1");
    expect(draft.games).toHaveLength(3);
    expect(draft.games[0].myBattlefield).toBe("The Papertree");
    expect(draft.games[0].oppBattlefield).toBe("Sunken Temple");
    expect(draft.games[1].myBattlefield).toBe("Vilemaw's Lair");
    expect(draft.games[1].oppBattlefield).toBe("Gardens of Becoming");
    expect(draft.games[2].myBattlefield).toBe("Grove of the God-Willow");
    expect(draft.games[2].oppBattlefield).toBe("Valley of Idols");
  });

  it("clears suspicious duplicated BO3 battlefield pairs instead of trusting copied data", () => {
    const tracker = new MatchSessionTracker();
    const bmuSettings = { ...settings, username: "BMU" };

    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      myName: "BMU",
      opponentName: "Rival",
      score: { me: "7", opp: "3" },
      myBattlefield: "The Papertree",
      opponentBattlefield: "Sunken Temple"
    }, "2026-04-24T15:00:00.000Z", "atlas"));
    const gameOneEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Bo3",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      score: { me: "7", opp: "3" },
      myBattlefield: "The Papertree",
      opponentBattlefield: "Sunken Temple"
    }, "2026-04-24T15:08:00.000Z", "atlas");
    tracker.ingest(gameOneEnd);
    tracker.holdCurrentGame("atlas", gameOneEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      score: { me: "0", opp: "0" }
    }, "2026-04-24T15:09:00.000Z", "atlas"));
    const gameTwoEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Bo3",
      atlasResultKind: "game-result",
      endText: "Confirm Game 2 Winner",
      score: { me: "4", opp: "5" },
      myBattlefield: "The Papertree",
      opponentBattlefield: "Sunken Temple"
    }, "2026-04-24T15:18:00.000Z", "atlas");
    tracker.ingest(gameTwoEnd);
    tracker.holdCurrentGame("atlas", gameTwoEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      score: { me: "0", opp: "0" }
    }, "2026-04-24T15:19:00.000Z", "atlas"));
    const finalEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Bo3",
      atlasResultKind: "game-result",
      endText: "Confirm Game 3 Winner",
      score: { me: "8", opp: "4" },
      myBattlefield: "Grove of the God-Willow",
      opponentBattlefield: "Valley of Idols"
    }, "2026-04-24T15:28:00.000Z", "atlas");
    tracker.ingest(finalEnd);

    const draft = tracker.buildDraft("atlas", finalEnd, bmuSettings);
    expect(draft.score).toBe("2-1");
    expect(draft.games[0].myBattlefield).toBe("The Papertree");
    expect(draft.games[0].oppBattlefield).toBe("Sunken Temple");
    expect(draft.games[1].myBattlefield).toBe("");
    expect(draft.games[1].oppBattlefield).toBe("");
    expect(draft.games[2].myBattlefield).toBe("Grove of the God-Willow");
    expect(draft.games[2].oppBattlefield).toBe("Valley of Idols");
  });

  it("uses Atlas result-screen scores exactly when the score track briefly flickers", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      score: { me: "2", opp: "3" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-208.webp"
    }, "2026-05-02T11:46:18.077Z", "atlas"));

    const gameEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      score: { me: "3", opp: "2" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-208.webp"
    }, "2026-05-02T11:47:03.970Z", "atlas");
    tracker.ingest(gameEnd);

    const draft = tracker.buildDraft("atlas", gameEnd, { ...settings, username: "BMU" });
    expect(draft.games[0].myPoints).toBe(3);
    expect(draft.games[0].oppPoints).toBe(2);
    expect(draft.games[0].result).toBe("Win");
  });

  it("keeps Atlas held-result echoes from shifting BO3 battlefield buckets", () => {
    const tracker = new MatchSessionTracker();
    const bmuSettings = { ...settings, username: "BMU" };
    const gameOneMine = "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp";
    const gameOneOpponent = "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-208.webp";
    const gameTwoMine = "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-289.webp";
    const gameTwoOpponent = "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-290.webp";
    const gameThreeMine = "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-205.webp";
    const gameThreeOpponent = "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp";

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      configuredUsername: "BMU",
      opponentName: "4fun gamer",
      score: { me: "2", opp: "3" },
      myBattlefieldImage: gameOneMine,
      opponentBattlefieldImage: gameOneOpponent
    }, "2026-05-02T11:46:18.077Z", "atlas"));

    const gameOneEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      score: { me: "3", opp: "2" },
      myBattlefieldImage: gameOneMine,
      opponentBattlefieldImage: gameOneOpponent
    }, "2026-05-02T11:47:03.970Z", "atlas");
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameOneEnd);
    tracker.ingest(event("match-snapshot", {
      active: true,
      reason: "mutation",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      score: { me: "3", opp: "2" },
      myBattlefieldImage: gameOneMine,
      opponentBattlefieldImage: gameOneOpponent
    }, "2026-05-02T11:47:03.971Z", "atlas"));

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      score: { me: "0", opp: "0" }
    }, "2026-05-02T11:47:10.615Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Auto",
      score: { me: "5", opp: "8" },
      myBattlefieldImage: gameTwoMine,
      opponentBattlefieldImage: gameTwoOpponent
    }, "2026-05-02T11:57:27.941Z", "atlas"));
    const gameTwoEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 2 Winner",
      score: { me: "5", opp: "8" },
      myBattlefieldImage: gameTwoMine,
      opponentBattlefieldImage: gameTwoOpponent
    }, "2026-05-02T11:57:34.609Z", "atlas");
    tracker.ingest(gameTwoEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameTwoEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameTwoEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      score: { me: "0", opp: "0" }
    }, "2026-05-02T11:57:37.959Z", "atlas"));
    const finalEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 3 Winner",
      opponentName: "4fun gamer",
      score: { me: "6", opp: "7" },
      myBattlefieldImage: gameThreeMine,
      opponentBattlefieldImage: gameThreeOpponent
    }, "2026-05-02T12:11:19.254Z", "atlas");
    tracker.ingest(finalEnd);

    const draft = tracker.buildDraft("atlas", finalEnd, bmuSettings);
    expect(draft.games.map((game) => `${game.myPoints}-${game.oppPoints}`)).toEqual(["3-2", "5-8", "6-7"]);
    expect(draft.games.map((game) => game.myBattlefieldImage)).toEqual([gameOneMine, gameTwoMine, gameThreeMine]);
    expect(draft.games.map((game) => game.oppBattlefieldImage)).toEqual([gameOneOpponent, gameTwoOpponent, gameThreeOpponent]);
  });

  it("keeps Atlas result echoes from pushing the real third BO3 game out of the draft", () => {
    const tracker = new MatchSessionTracker();
    const bmuSettings = { ...settings, username: "BMU" };

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      configuredUsername: "BMU",
      myName: "BMU",
      opponentName: "JaeSinister",
      score: { me: "4", opp: "4", source: "atlas-score-track" }
    }, "2026-06-23T07:30:06.034Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Auto",
      score: { me: "6", opp: "8", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp"
    }, "2026-06-23T07:44:57.831Z", "atlas"));
    const gameOneEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      score: { me: "6", opp: "8", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp"
    }, "2026-06-23T07:45:04.595Z", "atlas");
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameOneEnd);

    tracker.ingest(event("match-snapshot", {
      active: true,
      reason: "mutation",
      format: "Auto",
      score: { me: "6", opp: "8", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp"
    }, "2026-06-23T07:45:04.611Z", "atlas"));
    expect(tracker.previewGames("atlas").map((game) => `${game.myPoints}-${game.oppPoints}`)).toEqual(["6-8"]);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-06-23T07:45:07.302Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Auto",
      score: { me: "8", opp: "5", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-208.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-297.webp"
    }, "2026-06-23T07:55:43.540Z", "atlas"));
    const gameTwoEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 2 Winner",
      score: { me: "8", opp: "5", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-208.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-297.webp"
    }, "2026-06-23T07:55:52.734Z", "atlas");
    tracker.ingest(gameTwoEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameTwoEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameTwoEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-06-23T07:55:55.735Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Auto",
      score: { me: "8", opp: "7", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-218.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-276.webp"
    }, "2026-06-23T08:03:20.690Z", "atlas"));

    const finalLanding = event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Bo1",
      score: { me: "", opp: "", source: "atlas-score-track" },
      myName: "BMU",
      opponentName: "JaeSinister"
    }, "2026-06-23T08:06:01.626Z", "atlas");
    finalLanding.url = "https://play.riftatlas.com/";
    const draft = tracker.buildDraft("atlas", finalLanding, bmuSettings);

    expect(draft.format).toBe("Bo3");
    expect(draft.games.map((game) => `${game.myPoints}-${game.oppPoints}`)).toEqual(["6-8", "8-5", "8-7"]);
    expect(draft.score).toBe("2-1");
    expect(draft.result).toBe("Win");
  });

  it("keeps explicitly numbered Atlas BO3 games with identical scores and missing battlefields distinct", () => {
    const tracker = new MatchSessionTracker();
    const base = {
      active: true,
      format: "Bo3",
      myName: "BMU",
      opponentName: "Rival"
    };
    const result = (gameNumber: number, kind: CaptureEvent["kind"], at: string) => event(kind, {
      ...base,
      reason: kind === "match-end" ? "result-text-detected" : "mutation",
      atlasResultKind: "game-result",
      atlasBo3GameNumber: gameNumber,
      endText: `Confirm Game ${gameNumber} Winner`,
      score: { me: "7", opp: "5", source: "atlas-score-track" }
    }, at, "atlas");

    tracker.ingest(event("match-start", {
      ...base,
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-07-09T19:00:00.000Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      ...base,
      score: { me: "7", opp: "5", source: "atlas-score-track" }
    }, "2026-07-09T19:08:00.000Z", "atlas"));
    const gameOneEnd = result(1, "match-end", "2026-07-09T19:08:02.000Z");
    tracker.ingest(gameOneEnd);
    tracker.holdCurrentGame("atlas", gameOneEnd);
    tracker.ingest(result(1, "match-snapshot", "2026-07-09T19:08:03.000Z"));

    tracker.ingest(event("match-start", {
      ...base,
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-07-09T19:10:00.000Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      ...base,
      score: { me: "7", opp: "5", source: "atlas-score-track" }
    }, "2026-07-09T19:18:00.000Z", "atlas"));
    const gameTwoEnd = result(2, "match-end", "2026-07-09T19:18:02.000Z");
    tracker.ingest(gameTwoEnd);
    tracker.holdCurrentGame("atlas", gameTwoEnd);
    tracker.ingest(result(2, "match-snapshot", "2026-07-09T19:18:03.000Z"));

    const terminal = event("match-end", {
      active: false,
      format: "Bo3",
      atlasResultKind: "match-terminal",
      endText: "Match complete"
    }, "2026-07-09T19:18:04.000Z", "atlas");
    const draft = tracker.buildDraft("atlas", terminal, { ...settings, username: "BMU" });

    expect(draft.games.map((game) => `${game.gameNumber}:${game.result}:${game.myPoints}-${game.oppPoints}`))
      .toEqual(["1:Win:7-5", "2:Win:7-5"]);
    expect(draft.score).toBe("2-0");
  });

  it("uses Atlas result-event identity to keep unnumbered identical BO3 games distinct while suppressing echoes", () => {
    const tracker = new MatchSessionTracker();
    const base = {
      active: true,
      format: "Bo3",
      myName: "BMU",
      opponentName: "Rival"
    };
    const unnumberedResult = (kind: CaptureEvent["kind"], at: string) => event(kind, {
      ...base,
      reason: kind === "match-end" ? "result-text-detected" : "mutation",
      atlasResultKind: "game-result",
      endText: "You win",
      score: { me: "7", opp: "5", source: "atlas-score-track" }
    }, at, "atlas");

    tracker.ingest(event("match-start", {
      ...base,
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-07-09T20:00:00.000Z", "atlas"));
    const gameOneEnd = unnumberedResult("match-end", "2026-07-09T20:08:00.000Z");
    tracker.ingest(gameOneEnd);
    tracker.holdCurrentGame("atlas", gameOneEnd);
    tracker.ingest(unnumberedResult("match-snapshot", "2026-07-09T20:08:01.000Z"));
    expect(tracker.previewGames("atlas")).toHaveLength(1);

    tracker.ingest(event("match-start", {
      ...base,
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-07-09T20:10:00.000Z", "atlas"));
    const gameTwoEnd = unnumberedResult("match-end", "2026-07-09T20:18:00.000Z");
    tracker.ingest(gameTwoEnd);
    const draft = tracker.buildDraft("atlas", gameTwoEnd, { ...settings, username: "BMU" });

    expect(draft.games.map((game) => `${game.gameNumber}:${game.result}:${game.myPoints}-${game.oppPoints}`))
      .toEqual(["1:Win:7-5", "2:Win:7-5"]);
    expect(draft.score).toBe("2-0");
  });

  it("merges late Atlas result score echoes back into the confirmed child game", () => {
    const tracker = new MatchSessionTracker();
    const base = {
      active: true,
      format: "Auto",
      myName: "BMU",
      configuredUsername: "BMU",
      opponentName: "SivirPlayer",
      myChampion: "LeBlanc",
      opponentChampion: "Sivir"
    };
    const score = (me: string, opp: string) => ({ me, opp, source: "atlas-score-track" });

    tracker.ingest(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-07-01T11:02:00.000Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      ...base,
      score: score("3", "10"),
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-276.webp"
    }, "2026-07-01T11:12:00.000Z", "atlas"));
    const gameOneEnd = event("match-end", {
      ...base,
      reason: "result-text-detected",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      score: score("3", "10"),
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-276.webp"
    }, "2026-07-01T11:12:20.000Z", "atlas");
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameOneEnd);

    tracker.ingest(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-07-01T11:12:40.000Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      ...base,
      score: score("3", "10"),
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-276.webp"
    }, "2026-07-01T11:12:41.000Z", "atlas"));
    tracker.ingest(event("match-start", {
      ...base,
      score: score("0", "0")
    }, "2026-07-01T11:12:42.000Z", "atlas"));

    expect(tracker.previewGames("atlas").map((game) => `${game.gameNumber}:${game.result}:${game.myPoints}-${game.oppPoints}`))
      .toEqual(["1:Loss:3-10"]);
  });

  it("asks the coordinator to review a held Atlas BO3 before a different opponent is absorbed", () => {
    const tracker = new MatchSessionTracker();

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      opponentName: "Bliss",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-05-06T19:22:11.537Z", "atlas"));
    const gameOneEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      opponentName: "Bliss",
      score: { me: "7", opp: "5", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-215.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-295.webp"
    }, "2026-05-06T19:36:24.422Z", "atlas");
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameOneEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      opponentName: "Bliss",
      score: { me: "5", opp: "6", source: "atlas-score-track" },
      myBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-218.webp",
      opponentBattlefieldImage: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-297.webp"
    }, "2026-05-06T19:52:31.519Z", "atlas"));

    const nextOpponentEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      opponentName: "CurlyNuke",
      score: { me: "6", opp: "5", source: "atlas-score-track" }
    }, "2026-05-06T20:50:19.019Z", "atlas");

    expect(tracker.shouldFinalizeBeforeNewSession(nextOpponentEnd)).toBe(true);
  });

  it("asks the coordinator to review a completed Atlas BO3 before the same opponent starts another match", () => {
    const tracker = new MatchSessionTracker();

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      opponentName: "Azir",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-05-13T04:02:14.393Z", "atlas"));

    const gameOneEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 1 Winner",
      opponentName: "Azir",
      score: { me: "6", opp: "7", source: "atlas-score-track" }
    }, "2026-05-13T04:26:37.128Z", "atlas");
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameOneEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      opponentName: "Azir",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-05-13T04:26:41.337Z", "atlas"));
    const gameTwoEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 2 Winner",
      opponentName: "Azir",
      score: { me: "8", opp: "6", source: "atlas-score-track" }
    }, "2026-05-13T04:45:28.983Z", "atlas");
    tracker.ingest(gameTwoEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameTwoEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameTwoEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      opponentName: "Azir",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-05-13T04:58:43.966Z", "atlas"));
    const gameThreeEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Auto",
      atlasResultKind: "game-result",
      endText: "Confirm Game 3 Winner",
      opponentName: "Azir",
      score: { me: "7", opp: "6", source: "atlas-score-track" }
    }, "2026-05-13T05:49:12.215Z", "atlas");
    tracker.ingest(gameThreeEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameThreeEnd)).toBe(false);

    const nextMatchStart = event("match-start", {
      active: true,
      format: "Auto",
      opponentName: "Azir",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-05-13T05:53:04.779Z", "atlas");

    expect(tracker.shouldFinalizeBeforeNewSession(nextMatchStart)).toBe(true);
  });

  it("waits briefly after a single Atlas game so a manual BO3 can continue", () => {
    const tracker = new MatchSessionTracker();

    tracker.ingest(event("match-start", {
      active: true,
      format: "Auto",
      myName: "DUNC",
      opponentName: "Sultan",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }, "2026-05-18T14:57:47.918Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      format: "Auto",
      myName: "DUNC",
      opponentName: "Sultan",
      score: { me: "7", opp: "5", source: "atlas-score-track" }
    }, "2026-05-18T15:14:24.719Z", "atlas"));

    const gameEnd = event("match-end", {
      active: false,
      reason: "inactive-debounce",
      format: "Auto",
      myName: "DUNC"
    }, "2026-05-18T15:14:28.719Z", "atlas");
    tracker.ingest(gameEnd);

    expect(tracker.shouldWaitForAtlasContinuation("atlas", gameEnd)).toBe(true);
  });

  it("keeps Atlas BO3 game results even when score is blank", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      myName: "BMU",
      opponentName: "Rival",
      myBattlefieldImage: "https://cdn.example/cards/SFD-219-papertree.png"
    }, "2026-04-24T17:00:00.000Z", "atlas"));

    const gameOneEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Bo3",
      atlasResultKind: "game-result",
      endText: "You win"
    }, "2026-04-24T17:08:00.000Z", "atlas");
    tracker.ingest(gameOneEnd);
    expect(tracker.shouldHoldForBo3("atlas", gameOneEnd)).toBe(true);
    tracker.holdCurrentGame("atlas", gameOneEnd);

    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      myName: "BMU",
      opponentName: "Rival",
      myBattlefieldImage: "https://cdn.example/cards/UNL-210-waste.png"
    }, "2026-04-24T17:10:00.000Z", "atlas"));
    const gameTwoEnd = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Bo3",
      atlasResultKind: "game-result",
      endText: "You win"
    }, "2026-04-24T17:18:00.000Z", "atlas");
    tracker.ingest(gameTwoEnd);

    expect(tracker.shouldHoldForBo3("atlas", gameTwoEnd)).toBe(false);
    const draft = tracker.buildDraft("atlas", gameTwoEnd, { ...settings, username: "BMU" });
    expect(draft.format).toBe("Bo3");
    expect(draft.result).toBe("Win");
    expect(draft.score).toBe("2-0");
    expect(draft.games).toHaveLength(2);
    expect(draft.games[0].result).toBe("Win");
    expect(draft.games[0].myPoints).toBeUndefined();
    expect(draft.games[1].myBattlefieldImage).toContain("waste");
  });

  it("does not hold Atlas terminal match-end screens", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo3",
      score: { me: "7", opp: "3" }
    }, "2026-04-24T16:00:00.000Z", "atlas"));
    const end = event("match-end", {
      active: true,
      reason: "result-text-detected",
      format: "Bo3",
      atlasResultKind: "match-terminal",
      endText: "Opponent left the game"
    }, "2026-04-24T16:06:00.000Z", "atlas");
    tracker.ingest(end);

    expect(tracker.shouldHoldForBo3("atlas", end)).toBe(false);
  });

  it("resolves Atlas Vendetta legends from image URLs when text is keyword noise", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      format: "Bo1",
      myName: "BMU",
      opponentName: "Mindow",
      myChampion: "Tap",
      myChampionImage: "https://assets.riftatlas-workers.com/cdn-cgi/image/width=192/riftbound/cards/small-v2/VEN-139.webp",
      opponentChampion: "Empowered",
      opponentChampionImage: "https://assets.riftatlas-workers.com/cdn-cgi/image/width=192/riftbound/cards/small-v2/VEN-153.webp",
      score: { me: "0", opp: "0" }
    }, "2026-07-09T18:00:00.000Z", "atlas"));

    const end = event("match-end", {
      active: false,
      format: "Bo1",
      endText: "You win",
      score: { me: "8", opp: "4" }
    }, "2026-07-09T18:08:00.000Z", "atlas");
    const draft = tracker.buildDraft("atlas", end, { ...settings, username: "BMU" });

    expect(draft.myChampion).toBe("Akali");
    expect(draft.opponentChampion).toBe("Ambessa");
  });

  it("creates a structured Atlas replay stream from new log rows and score changes", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      configuredUsername: "BMU",
      opponentName: "Nova",
      score: { me: "0", opp: "0" },
      rows: [
        { key: "chat", text: "BMU at 12:00: testing" },
        { key: "turn", text: "12:01BMU's turn" }
      ],
      battlefieldCandidates: [
        { side: "me", code: "OGN-295", image: "https://cdn.example/OGN-295.webp" },
        { side: "opponent", code: "UNL-209", image: "https://cdn.example/UNL-209.webp" }
      ]
    }, "2026-04-24T18:00:00.000Z", "atlas"));
    tracker.ingest(event("match-snapshot", {
      active: true,
      configuredUsername: "BMU",
      opponentName: "Nova",
      score: { me: "1", opp: "0" },
      rows: [
        { key: "turn", text: "12:01BMU's turn" },
        { key: "score", text: "12:04Conquered Grove of the God-Willow and scored 1.\u21ba" }
      ]
    }, "2026-04-24T18:04:00.000Z", "atlas"));

    const replayEvents = tracker.getReplayEvents("atlas");
    expect(replayEvents.map((item) => item.type)).toEqual(["scoreboard", "battlefield", "turn-start", "scoreboard", "score"]);
    expect(replayEvents.some((item) => /testing/.test(item.text))).toBe(false);
    expect(replayEvents.at(-1)?.battlefield).toBe("Grove of the God-Willow");
    expect(replayEvents.find((item) => item.type === "battlefield")?.battlefields?.map((battlefield) => battlefield.code)).toEqual(["OGN-295", "UNL-209"]);

    const scoreEvent = replayEvents.find((item) => item.type === "score");
    expect(scoreEvent).toBeTruthy();
    tracker.attachReplayScreenshot("atlas", scoreEvent?.id ?? "", {
      path: "C:\\Screens\\RiftLite_score.jpg",
      url: "file:///C:/Screens/RiftLite_score.jpg",
      label: "Score 1-0",
      capturedAt: "2026-04-24T18:04:00.000Z",
      source: "replay-keyframe"
    });
    expect(tracker.getReplayEvents("atlas").find((item) => item.id === scoreEvent?.id)?.screenshot?.label).toBe("Score 1-0");
  });

  it("keeps repeated Atlas turn-end rows as separate replay events", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      configuredUsername: "BMU",
      opponentName: "Nova",
      rows: [
        { text: "20:38Drew 1 card.\u21ba" },
        { text: "20:37Ended their turn.\u21ba" },
        { text: "20:36Played Stalwart Poro to base.\u21ba" },
        { text: "20:35Ended their turn.\u21ba" },
        { text: "20:35Both mulligans are complete. Starting the game.\u21ba" },
        { text: "20:35Chose BMU to take the first turn. Both players now mulligan up to 2 cards.\u21ba" }
      ]
    }, "2026-04-24T19:38:00.000Z", "atlas"));

    const replayEvents = tracker.getReplayEvents("atlas");
    expect(replayEvents.filter((item) => item.type === "turn-end")).toHaveLength(2);
    expect(replayEvents[0].text).toContain("Chose BMU");
    expect(replayEvents.at(-1)?.text).toBe("Drew 1 card.");
  });

  it("orders same-minute Atlas rows so actions stay before the turn end", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      configuredUsername: "BMU",
      opponentName: "Nova",
      rows: [
        { text: "20:35Ended their turn.\u21ba" },
        { text: "20:35Conquered Grove of the God-Willow and scored 1.\u21ba" },
        { text: "20:35Played Watchful Sentry to base.\u21ba" },
        { text: "20:35BMU's turn\u21ba" }
      ]
    }, "2026-04-24T19:35:30.000Z", "atlas"));

    expect(tracker.getReplayEvents("atlas").map((item) => item.text)).toEqual([
      "BMU's turn",
      "Conquered Grove of the God-Willow and scored 1.",
      "Played Watchful Sentry to base.",
      "Ended their turn."
    ]);
  });

  it("filters low-value Atlas replay noise and treats setup draw text as setup", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      rows: [
        { text: "20:35Must choose who starts. Both players draw 4 cards once mulligan begins.\u21ba" },
        { text: "20:35Rolled a d20.\u21ba" },
        { text: "20:36Exhausted 2runes.\u21ba" },
        { text: "20:36Recycled 1Order rune.\u21ba" },
        { text: "20:37Played Watchful Sentry to base.\u21ba" }
      ]
    }, "2026-04-24T19:38:00.000Z", "atlas"));

    const replayEvents = tracker.getReplayEvents("atlas");
    expect(replayEvents.map((item) => item.text)).toEqual([
      "Must choose who starts. Both players draw 4 cards once mulligan begins.",
      "Played Watchful Sentry to base."
    ]);
    expect(replayEvents[0].type).toBe("setup");
    expect(replayEvents[1].type).toBe("play");
  });

  it("retains exact signed and overnumbered setup codes for offline resolution", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(event("match-start", {
      active: true,
      opponentName: "Rival",
      myChampionCode: "UNL-226*",
      opponentChampionCode: "VEN-194",
      myBattlefieldCode: "VEN-157",
      opponentBattlefieldCode: "UNL-218",
      score: { me: "1", opp: "0" }
    }, "2026-07-18T20:00:00.000Z", "atlas"));

    expect(tracker.get("atlas")?.sticky).toMatchObject({
      myChampionCode: "UNL-226*",
      opponentChampionCode: "VEN-194",
      myBattlefieldCode: "VEN-157",
      opponentBattlefieldCode: "UNL-218"
    });
  });

  it.each(["tcga", "atlas"] as const)("preserves code-only battlefield pairs in every %s BO3 game", (platform) => {
    const tracker = new MatchSessionTracker();
    const base = {
      active: true,
      format: "Bo3",
      myName: "ConfiguredUser",
      opponentName: "Code Rival",
      myChampion: "Akali",
      opponentChampion: "Jayce"
    };
    const pair = (myBattlefieldCode: string, opponentBattlefieldCode: string) => ({
      myBattlefieldCode,
      opponentBattlefieldCode
    });

    tracker.ingest(event("match-start", {
      ...base,
      score: { me: "0", opp: "0" },
      ...pair("VEN-157", "UNL-218")
    }, "2026-07-18T21:00:00.000Z", platform));
    tracker.ingest(event("match-snapshot", {
      ...base,
      score: { me: "7", opp: "4" },
      ...pair("VEN-157", "UNL-218")
    }, "2026-07-18T21:10:00.000Z", platform));
    tracker.ingest(event("match-snapshot", {
      ...base,
      score: { me: "0", opp: "0" },
      ...pair("VEN-158", "UNL-217")
    }, "2026-07-18T21:11:00.000Z", platform));
    tracker.ingest(event("match-snapshot", {
      ...base,
      score: { me: "4", opp: "7" },
      ...pair("VEN-158", "UNL-217")
    }, "2026-07-18T21:21:00.000Z", platform));
    tracker.ingest(event("match-snapshot", {
      ...base,
      score: { me: "0", opp: "0" },
      ...pair("VEN-159", "VEN-160")
    }, "2026-07-18T21:22:00.000Z", platform));
    tracker.ingest(event("match-snapshot", {
      ...base,
      score: { me: "7", opp: "2" },
      ...pair("VEN-159", "VEN-160")
    }, "2026-07-18T21:32:00.000Z", platform));

    const end = event("match-end", {
      ...base,
      active: false,
      endText: "You win",
      score: { me: "7", opp: "2" },
      ...pair("VEN-159", "VEN-160")
    }, "2026-07-18T21:33:00.000Z", platform);
    const draft = tracker.buildDraft(platform, end, settings);

    expect(draft.games.map((game) => [game.myBattlefieldCode, game.oppBattlefieldCode])).toEqual([
      ["VEN-157", "UNL-218"],
      ["VEN-158", "UNL-217"],
      ["VEN-159", "VEN-160"]
    ]);
    expect(draft.games.every((game) => !game.myBattlefield && !game.oppBattlefield && !game.myBattlefieldImage && !game.oppBattlefieldImage)).toBe(true);
  });
});
