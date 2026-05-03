import { describe, expect, it } from "vitest";
import { buildAtlasReplay, replaySnapshotCardCount } from "../src/shared/atlasReplay";
import type { CaptureEvent, MatchDraft, ReplayRecord } from "../src/shared/types";

function event(kind: CaptureEvent["kind"], capturedAt: string, payload: Record<string, unknown>): CaptureEvent {
  return {
    id: `${kind}-${capturedAt}`,
    platform: "atlas",
    kind,
    capturedAt,
    url: "https://play.riftatlas.com/game",
    payload
  };
}

function replay(events: CaptureEvent[]): ReplayRecord {
  return {
    id: "replay-1",
    matchId: "match-1",
    platform: "atlas",
    capturedAt: "2026-04-26T12:00:00.000Z",
    title: "Vex vs Kai'Sa",
    players: {
      me: "BMU",
      opponent: "Nova"
    },
    events
  };
}

function match(): MatchDraft {
  return {
    id: "match-1",
    platform: "atlas",
    status: "saved",
    capturedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:20:00.000Z",
    result: "Win",
    format: "Bo1",
    score: "1-0",
    myName: "BMU",
    opponentName: "Nova",
    myChampion: "Vex",
    opponentChampion: "Kai'Sa",
    myBattlefield: "Grove of the God-Willow",
    opponentBattlefield: "Dusk Rose Lab",
    deckName: "",
    deckSourceId: "",
    deckSourceUrl: "",
    deckSourceKey: "",
    deckSnapshotJson: "",
    flags: "",
    notes: "",
    games: [
      {
        gameNumber: 1,
        result: "Win",
        myPoints: 8,
        oppPoints: 6,
        myBattlefield: "Grove of the God-Willow",
        oppBattlefield: "Dusk Rose Lab",
        wentFirst: "1st"
      }
    ],
    rawEvidence: [],
    sync: { community: "disabled", hubs: {} }
  };
}

describe("atlas replay builder", () => {
  it("deduplicates Atlas log snapshots and groups events into turns", () => {
    const snapshotRows = [
      { key: "0", text: "12:01BMU's turn" },
      { key: "1", text: "12:01Played Mask of Foresight to base.\u21ba" },
      { key: "2", text: "12:02Moved Vex, Apathetic to Grove of the God-Willow.\u21ba" },
      { key: "3", text: "12:03Conquered Grove of the God-Willow and scored 1.\u21ba" },
      { key: "4", text: "12:04Ended their turn.\u21ba" }
    ];
    const model = buildAtlasReplay(replay([
      event("match-snapshot", "2026-04-26T12:04:00.000Z", {
        active: true,
        score: { me: "1", opp: "0" },
        rows: snapshotRows
      }),
      event("match-snapshot", "2026-04-26T12:04:02.000Z", {
        active: true,
        score: { me: "1", opp: "0" },
        rows: snapshotRows
      })
    ]), match());

    expect(model.rowCount).toBe(5);
    expect(model.turns).toHaveLength(1);
    expect(model.turns[0].label).toBe("BMU's turn");
    expect(model.turns[0].cards.map((card) => card.name)).toContain("Mask of Foresight");
    expect(model.turns[0].pointEvents[0].battlefield).toBe("Grove of the God-Willow");
    expect(model.scoreLabel).toBe("1-0");
  });

  it("keeps scoreboard events when Atlas exposes score changes but no clean action row", () => {
    const model = buildAtlasReplay(replay([
      event("match-snapshot", "2026-04-26T12:00:00.000Z", { active: true, score: { me: "0", opp: "0" }, rows: [] }),
      event("match-snapshot", "2026-04-26T12:05:00.000Z", { active: true, score: { me: "2", opp: "1" }, rows: [] })
    ]));

    expect(model.events.map((item) => item.text)).toEqual(["Score 0-0", "Score 2-1"]);
    expect(model.turns[0].score).toEqual({ me: 2, opponent: 1 });
  });

  it("uses Atlas setup completion and repeated end-turn rows to split turns", () => {
    const model = buildAtlasReplay(replay([
      event("match-snapshot", "2026-04-26T19:40:00.000Z", {
        active: true,
        rows: [
          { text: "20:36Moved Stalwart Poro to The Papertree.\u21ba" },
          { text: "20:35Ended their turn.\u21ba" },
          { text: "20:35Played Stalwart Poro to base.\u21ba" },
          { text: "20:35Both mulligans are complete. Starting the game.\u21ba" },
          { text: "20:35Finalized mulligan (0 recycled, 0 redrawn).\u21ba" },
          { text: "20:35Chose BMU to take the first turn. Both players now mulligan up to 2 cards.\u21ba" },
          { text: "20:35Must choose who starts. Both players draw 4 cards once mulligan begins.\u21ba" }
        ]
      }),
      event("match-snapshot", "2026-04-26T19:42:00.000Z", {
        active: true,
        rows: [
          { text: "20:38Drew 1 card.\u21ba" },
          { text: "20:37Ended their turn.\u21ba" }
        ]
      })
    ]), match());

    expect(model.turns.map((turn) => turn.label)).toEqual(["Setup", "BMU's turn", "Nova's turn", "BMU's turn"]);
    expect(model.turns[1].events.map((item) => item.text)).toContain("Ended their turn.");
    expect(model.turns[2].events.map((item) => item.text)).toContain("Ended their turn.");
  });

  it("keeps same-minute raw Atlas rows in a playable turn order", () => {
    const model = buildAtlasReplay(replay([
      event("match-snapshot", "2026-04-26T19:35:30.000Z", {
        active: true,
        rows: [
          { text: "20:35Ended their turn.\u21ba" },
          { text: "20:35Conquered Grove of the God-Willow and scored 1.\u21ba" },
          { text: "20:35Played Watchful Sentry to base.\u21ba" },
          { text: "20:35BMU's turn\u21ba" }
        ]
      })
    ]), match());

    expect(model.events.map((item) => item.text)).toEqual([
      "BMU's turn",
      "Conquered Grove of the God-Willow and scored 1.",
      "Played Watchful Sentry to base.",
      "Ended their turn."
    ]);
    expect(model.turns[0].events.map((item) => item.text)).toEqual([
      "BMU's turn",
      "Conquered Grove of the God-Willow and scored 1.",
      "Played Watchful Sentry to base.",
      "Ended their turn."
    ]);
  });

  it("collects battlefield images and future screenshot keyframes from evidence", () => {
    const model = buildAtlasReplay(replay([
      event("match-snapshot", "2026-04-26T12:00:00.000Z", {
        active: true,
        score: { me: "0", opp: "0" },
        rows: [{ key: "0", text: "12:00Drew 1 card.\u21ba" }],
        battlefieldCandidates: [
          { side: "me", code: "OGN-295", image: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-295.webp", text: "" },
          { side: "opponent", code: "UNL-209", image: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-209.webp", text: "" }
        ],
        cards: [
          { zoneOwner: "self", zone: "legend", code: "OGN-001", image: "legend.webp" }
        ],
        screenshots: [{ path: "C:\\Screens\\keyframe.png", label: "Score change" }]
      })
    ]));

    expect(model.battlefields.map((battlefield) => battlefield.code)).toEqual(["OGN-295", "UNL-209"]);
    expect(model.screenshots[0].path).toBe("C:\\Screens\\keyframe.png");
    expect(replaySnapshotCardCount(model.replay)).toBe(1);
  });

  it("filters battlefield interaction labels from replay metadata", () => {
    const model = buildAtlasReplay(replay([
      event("match-snapshot", "2026-04-26T12:00:00.000Z", {
        active: true,
        battlefieldCandidates: [
          { side: "me", text: "Zaun Warrens", image: "zaun.webp" },
          { side: "me", text: "Tap", image: "zaun.webp" },
          { side: "me", text: "Target", image: "zaun.webp" },
          { side: "opponent", text: "Vaults of Helia", image: "helia.webp" },
          { side: "opponent", text: "Ping", image: "helia.webp" },
          { side: "opponent", text: "ErrorErrorTap", image: "helia.webp" }
        ]
      })
    ]));

    expect(model.battlefields.map((battlefield) => battlefield.name)).toEqual(["Zaun Warrens", "Vaults of Helia"]);
  });

  it("collapses raw battlefield card-code duplicates in replay metadata", () => {
    const model = buildAtlasReplay(replay([
      event("match-snapshot", "2026-04-26T12:00:00.000Z", {
        active: true,
        battlefieldCandidates: [
          { side: "me", text: "The Papertree", code: "SFD-219", image: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-219.webp" },
          { side: "me", text: "SFD-219", code: "SFD-219", image: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-219.webp" },
          { side: "opponent", text: "Ripper's Bay", code: "UNL-214", image: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-214.webp" },
          { side: "opponent", text: "UNL-214", code: "UNL-214", image: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-214.webp" }
        ]
      })
    ]));

    expect(model.battlefields.map((battlefield) => battlefield.name)).toEqual(["The Papertree", "Ripper's Bay"]);
    expect(model.battlefields.map((battlefield) => battlefield.code)).toEqual(["SFD-219", "UNL-214"]);
  });

  it("keeps replay battlefield metadata to named battlefield candidates when code-only noise is retained", () => {
    const model = buildAtlasReplay(replay([
      event("match-snapshot", "2026-04-26T12:00:00.000Z", {
        active: true,
        battlefieldCandidates: [
          { side: "me", text: "Zaun Warrens", code: "OGN-290", image: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-290.webp" },
          { side: "me", text: "OGN-291", code: "OGN-291", image: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-291.webp" },
          { side: "opponent", text: "The Arena's Greatest", code: "OGN-298", image: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-298.webp" },
          { side: "opponent", text: "Treasure Hoard", code: "SFD-220", image: "https://assets.riftatlas-workers.com/riftbound/cards/original/SFD-220.webp" }
        ]
      })
    ]));

    expect(model.battlefields.map((battlefield) => battlefield.name)).toEqual(["Zaun Warrens", "Treasure Hoard"]);
    expect(model.battlefields.map((battlefield) => battlefield.code)).toEqual(["OGN-290", "SFD-220"]);
  });

  it("prefers structured Atlas replay events over noisy retained rows", () => {
    const model = buildAtlasReplay({
      ...replay([
        event("match-snapshot", "2026-04-26T12:00:00.000Z", {
          rows: [
            { key: "chat", text: "BMU at 12:00: table talk" },
            { key: "old", text: "12:00Old noisy retained row.\u21ba" }
          ]
        })
      ]),
      schemaVersion: 2,
      structuredEvents: [
        {
          id: "structured-1",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:01:00.000Z",
          labelTime: "12:01",
          type: "turn-start",
          side: "me",
          text: "BMU's turn",
          cardName: "",
          destination: "",
          battlefield: ""
        },
        {
          id: "structured-2",
          sourceEventId: "source-2",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:02:00.000Z",
          labelTime: "12:02",
          type: "score",
          side: "system",
          text: "Conquered Grove of the God-Willow and scored 1.",
          cardName: "",
          destination: "",
          battlefield: "Grove of the God-Willow",
          pointsScored: 1,
          score: { me: 1, opponent: 0 },
          screenshot: {
            path: "C:\\Screens\\RiftLite_score.jpg",
            url: "file:///C:/Screens/RiftLite_score.jpg",
            label: "Score 1-0",
            capturedAt: "2026-04-26T12:02:00.000Z",
            source: "replay-keyframe"
          }
        }
      ]
    }, match());

    expect(model.rowCount).toBe(2);
    expect(model.events.map((item) => item.text)).toEqual([
      "BMU's turn",
      "Conquered Grove of the God-Willow and scored 1."
    ]);
    expect(model.turns[0].pointEvents[0].pointsScored).toBe(1);
    expect(model.screenshots[0].label).toBe("Score 1-0");
    expect(model.turns[0].screenshots[0].url).toBe("file:///C:/Screens/RiftLite_score.jpg");
  });

  it("uses structured TCGA replay keyframes when present", () => {
    const model = buildAtlasReplay({
      ...replay([
        event("debug", "2026-04-26T12:00:10.000Z", { path: "/play" })
      ]),
      platform: "tcga",
      schemaVersion: 2,
      structuredEvents: [
        {
          id: "tcga-before",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:00:00.000Z",
          labelTime: "12:00",
          type: "setup",
          side: "system",
          text: "Before mulligan.",
          cardName: "",
          destination: "",
          battlefield: "",
          screenshot: {
            path: "C:\\Screens\\RiftLite_before.jpg",
            url: "file:///C:/Screens/RiftLite_before.jpg",
            label: "Game 1 before mulligan",
            capturedAt: "2026-04-26T12:00:00.000Z",
            source: "replay-keyframe"
          }
        },
        {
          id: "tcga-after",
          sourceEventId: "source-2",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:00:10.000Z",
          labelTime: "12:00",
          type: "setup",
          side: "system",
          text: "After mulligan.",
          cardName: "",
          destination: "",
          battlefield: "",
          screenshot: {
            path: "C:\\Screens\\RiftLite_after.jpg",
            url: "file:///C:/Screens/RiftLite_after.jpg",
            label: "Game 1 after mulligan",
            capturedAt: "2026-04-26T12:00:10.000Z",
            source: "replay-keyframe"
          }
        },
        {
          id: "tcga-turn",
          sourceEventId: "source-3",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:00:15.000Z",
          labelTime: "12:00",
          type: "turn-start",
          side: "me",
          text: "Your turn",
          cardName: "",
          destination: "",
          battlefield: ""
        },
        {
          id: "tcga-turn-duplicate",
          sourceEventId: "source-4",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:00:25.000Z",
          labelTime: "12:00",
          type: "turn-start",
          side: "me",
          text: "Your turn",
          cardName: "",
          destination: "",
          battlefield: ""
        },
        {
          id: "tcga-noisy-battlefield",
          sourceEventId: "source-5",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:01:00.000Z",
          labelTime: "12:01",
          type: "battlefield",
          side: "system",
          text: "Battlefields updated: Opponent Ping / My ErrorTap",
          cardName: "",
          destination: "",
          battlefield: "Opponent Ping / My ErrorTap",
          battlefields: [
            { side: "opponent", name: "Ping", code: "", image: "" },
            { side: "me", name: "ErrorTap", code: "", image: "" }
          ]
        },
        {
          id: "tcga-score-one",
          sourceEventId: "source-6",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:02:00.000Z",
          labelTime: "12:02",
          type: "scoreboard",
          side: "system",
          text: "Score 1-0",
          cardName: "",
          destination: "",
          battlefield: "",
          score: { me: 1, opponent: 0 }
        },
        {
          id: "tcga-score-flicker",
          sourceEventId: "source-7",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:02:05.000Z",
          labelTime: "12:02",
          type: "scoreboard",
          side: "system",
          text: "Score 0-0",
          cardName: "",
          destination: "",
          battlefield: "",
          score: { me: 0, opponent: 0 }
        },
        {
          id: "tcga-score",
          sourceEventId: "source-8",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:05:00.000Z",
          labelTime: "12:05",
          type: "scoreboard",
          side: "system",
          text: "Score 4-1",
          cardName: "",
          destination: "",
          battlefield: "",
          score: { me: 4, opponent: 1 }
        }
      ]
    }, match());

    expect(model.platformLabel).toBe("TCGA");
    expect(model.events.map((item) => item.text)).toEqual([
      "Before mulligan.",
      "After mulligan.",
      "Your turn",
      "Score 1-0",
      "Score 4-1"
    ]);
    expect(model.screenshots[0].label).toBe("Game 1 before mulligan");
    expect(model.screenshots.some((screenshot) => screenshot.path === "/play")).toBe(false);
    expect(model.turns.map((turn) => turn.label)).toContain("Setup");
    expect(model.turns[0].events.map((item) => item.text)).toEqual(["Before mulligan.", "After mulligan."]);
    expect(model.turns[1].events.map((item) => item.text)).toContain("Your turn");
  });

  it("filters noisy TCGA card diffs and splits inferred card turns by side", () => {
    const model = buildAtlasReplay({
      ...replay([]),
      platform: "tcga",
      schemaVersion: 2,
      structuredEvents: [
        {
          id: "turn-me",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:11:00.000Z",
          labelTime: "20:11",
          type: "turn-start",
          side: "me",
          text: "Your turn",
          cardName: "",
          destination: "",
          battlefield: ""
        },
        {
          id: "raw-code-noise",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:11:01.000Z",
          labelTime: "20:11",
          type: "play",
          side: "me",
          text: "Played OGN-028 to board.",
          cardName: "OGN-028",
          destination: "board",
          battlefield: ""
        },
        {
          id: "unknown-noise",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:11:02.000Z",
          labelTime: "20:11",
          type: "play",
          side: "me",
          text: "Played Unknown card to board.",
          cardName: "Unknown card",
          destination: "board",
          battlefield: ""
        },
        {
          id: "real-me",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:11:03.000Z",
          labelTime: "20:11",
          type: "play",
          side: "me",
          text: "Played Watchful Sentry to base.",
          cardName: "Watchful Sentry",
          destination: "base",
          battlefield: ""
        },
        {
          id: "real-opp",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:12:00.000Z",
          labelTime: "20:12",
          type: "play",
          side: "opponent",
          text: "Played Sneaky Deckhand to base.",
          cardName: "Sneaky Deckhand",
          destination: "base",
          battlefield: ""
        }
      ]
    }, match());

    expect(model.events.map((item) => item.text)).toEqual([
      "Your turn",
      "Played Watchful Sentry to base.",
      "Played Sneaky Deckhand to base."
    ]);
    expect(model.turns.map((turn) => turn.side)).toEqual(["me", "opponent"]);
  });

  it("keeps TCGA scoreboards out of setup when turn text arrives before after-mulligan", () => {
    const model = buildAtlasReplay({
      ...replay([]),
      platform: "tcga",
      schemaVersion: 2,
      structuredEvents: [
        {
          id: "before",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:10:56.000Z",
          labelTime: "20:10",
          type: "setup",
          side: "system",
          text: "Before mulligan.",
          cardName: "",
          destination: "",
          battlefield: ""
        },
        {
          id: "turn",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:11:07.000Z",
          labelTime: "20:11",
          type: "turn-start",
          side: "me",
          text: "Your turn",
          cardName: "",
          destination: "",
          battlefield: ""
        },
        {
          id: "after",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:11:08.000Z",
          labelTime: "20:11",
          type: "setup",
          side: "system",
          text: "After mulligan.",
          cardName: "",
          destination: "",
          battlefield: "",
          score: { me: 0, opponent: 0 }
        },
        {
          id: "score-0",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:11:08.000Z",
          labelTime: "20:11",
          type: "scoreboard",
          side: "system",
          text: "Score 0-0",
          cardName: "",
          destination: "",
          battlefield: "",
          score: { me: 0, opponent: 0 }
        },
        {
          id: "score-1",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:12:00.000Z",
          labelTime: "20:12",
          type: "scoreboard",
          side: "system",
          text: "Score 1-0",
          cardName: "",
          destination: "",
          battlefield: "",
          score: { me: 1, opponent: 0 }
        }
      ]
    }, match());

    expect(model.turns[0].label).toBe("Setup");
    expect(model.turns[0].events.map((item) => item.text)).toEqual(["Before mulligan.", "After mulligan."]);
    expect(model.turns[1].events.map((item) => item.text)).toEqual(["Your turn", "Score 0-0", "Score 1-0"]);
  });

  it("keeps same-minute Atlas setup rows in setup and resolves battlefield names", () => {
    const model = buildAtlasReplay({
      ...replay([]),
      schemaVersion: 2,
      structuredEvents: [
        {
          id: "z-setup-start",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:07:00.000Z",
          labelTime: "21:07",
          type: "setup",
          side: "system",
          text: "Must choose who starts. Both players draw 4 cards once mulligan begins.",
          cardName: "",
          destination: "",
          battlefield: "take the first turn"
        },
        {
          id: "z-setup-complete",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:07:00.000Z",
          labelTime: "21:07",
          type: "setup",
          side: "system",
          text: "Both mulligans are complete. Starting the game.",
          cardName: "",
          destination: "",
          battlefield: ""
        },
        {
          id: "empty-end-after-setup",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:07:00.000Z",
          labelTime: "21:07",
          type: "turn-end",
          side: "system",
          text: "Ended their turn.",
          cardName: "",
          destination: "",
          battlefield: ""
        },
        {
          id: "a-play-would-sort-before-setup-by-id",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:07:00.000Z",
          labelTime: "21:07",
          type: "play",
          side: "system",
          text: "Played Watchful Sentry to base.",
          cardName: "Watchful Sentry",
          destination: "base",
          battlefield: ""
        },
        {
          id: "noise-rune",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:07:00.001Z",
          labelTime: "21:07",
          type: "action",
          side: "system",
          text: "Exhausted 2runes.",
          cardName: "",
          destination: "",
          battlefield: ""
        },
        {
          id: "battlefield-codes",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T20:07:23.580Z",
          labelTime: "21:07",
          type: "battlefield",
          side: "system",
          text: "Battlefields updated: My UNL-209 / Opponent OGN-295",
          cardName: "",
          destination: "",
          battlefield: "My UNL-209 / Opponent OGN-295",
          battlefields: [
            { side: "me", name: "", code: "UNL-209", image: "https://assets.riftatlas-workers.com/riftbound/cards/original/UNL-209.webp" },
            { side: "opponent", name: "", code: "OGN-295", image: "https://assets.riftatlas-workers.com/riftbound/cards/original/OGN-295.webp" }
          ]
        }
      ]
    }, {
      ...match(),
      myBattlefield: "Dusk Rose Lab",
      opponentBattlefield: "Vilemaw's Lair",
      games: [{
        gameNumber: 1,
        result: "Loss",
        myPoints: 7,
        oppPoints: 8,
        myBattlefield: "Dusk Rose Lab",
        oppBattlefield: "Vilemaw's Lair",
        wentFirst: "2nd"
      }]
    });

    expect(model.events.map((item) => item.text)).not.toContain("Exhausted 2runes.");
    expect(model.events.find((item) => item.type === "battlefield")?.text).toBe("Battlefields updated: My Dusk Rose Lab / Opponent Vilemaw's Lair");
    expect(model.turns[0].label).toBe("Setup");
    expect(model.turns[0].events.map((item) => item.text)).not.toContain("Played Watchful Sentry to base.");
    expect(model.turns[1].events.map((item) => item.text)).not.toContain("Ended their turn.");
    expect(model.turns[1].events.map((item) => item.text)).toContain("Played Watchful Sentry to base.");
  });

  it("infers held battlefield scores from start-of-turn score increases", () => {
    const model = buildAtlasReplay({
      ...replay([]),
      schemaVersion: 2,
      structuredEvents: [
        {
          id: "score-0",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:00:00.000Z",
          labelTime: "12:00",
          type: "scoreboard",
          side: "system",
          text: "Score 0-0",
          cardName: "",
          destination: "",
          battlefield: "",
          score: { me: 0, opponent: 0 }
        },
        {
          id: "turn-bmu-1",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:01:00.000Z",
          labelTime: "12:01",
          type: "turn-start",
          side: "me",
          text: "BMU's turn",
          cardName: "",
          destination: "",
          battlefield: ""
        },
        {
          id: "conquer-1",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:02:00.000Z",
          labelTime: "12:02",
          type: "score",
          side: "system",
          text: "Conquered Grove of the God-Willow and scored 1.",
          cardName: "",
          destination: "",
          battlefield: "Grove of the God-Willow",
          pointsScored: 1,
          score: { me: 1, opponent: 0 }
        },
        {
          id: "end-bmu-1",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:03:00.000Z",
          labelTime: "12:03",
          type: "turn-end",
          side: "system",
          text: "Ended their turn.",
          cardName: "",
          destination: "",
          battlefield: ""
        },
        {
          id: "turn-nova-1",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:04:00.000Z",
          labelTime: "12:04",
          type: "turn-start",
          side: "opponent",
          text: "Nova's turn",
          cardName: "",
          destination: "",
          battlefield: ""
        },
        {
          id: "end-nova-1",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:04:30.000Z",
          labelTime: "12:04",
          type: "turn-end",
          side: "system",
          text: "Ended their turn.",
          cardName: "",
          destination: "",
          battlefield: ""
        },
        {
          id: "turn-bmu-2",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:05:00.000Z",
          labelTime: "12:05",
          type: "turn-start",
          side: "me",
          text: "BMU's turn",
          cardName: "",
          destination: "",
          battlefield: ""
        },
        {
          id: "score-hold",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:05:00.000Z",
          labelTime: "12:05",
          type: "scoreboard",
          side: "system",
          text: "Score 2-0",
          cardName: "",
          destination: "",
          battlefield: "",
          score: { me: 2, opponent: 0 }
        },
        {
          id: "draw-after-hold",
          sourceEventId: "source-1",
          gameNumber: 1,
          capturedAt: "2026-04-26T12:05:01.000Z",
          labelTime: "12:05",
          type: "draw",
          side: "system",
          text: "Drew 1 card.",
          cardName: "",
          destination: "",
          battlefield: ""
        }
      ]
    }, match());

    const holdEvent = model.events.find((item) => item.text === "BMU held Grove of the God-Willow and scored 1.");
    expect(holdEvent).toBeTruthy();
    expect(holdEvent?.type).toBe("score");
    expect(holdEvent?.pointsScored).toBe(1);
    expect(model.turns.find((turn) => turn.label === "BMU's turn" && turn.startedAt === "2026-04-26T12:05:00.000Z")?.events.map((item) => item.text)).toEqual([
      "BMU's turn",
      "BMU held Grove of the God-Willow and scored 1.",
      "Score 2-0",
      "Drew 1 card."
    ]);
  });
});
