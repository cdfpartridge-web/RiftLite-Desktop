import { describe, expect, it } from "vitest";
import { captureEventFromSimEvent, SimEventReceiver } from "../src/main/services/simEventReceiver";
import { MatchSessionTracker } from "../src/main/services/matchSessionTracker";
import type { CaptureEvent, RiftboundSimEvent, UserSettings } from "../src/shared/types";

const settings: UserSettings = {
  username: "Local Player",
  firstRunComplete: true,
  syncMode: "local-only",
  communitySyncEnabled: false,
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
  activeHubs: []
};

function simEvent(patch: Partial<RiftboundSimEvent> = {}): RiftboundSimEvent {
  return {
    id: patch.id ?? "event-1",
    matchId: "match-1",
    gameNumber: 1,
    sequence: patch.sequence ?? 1,
    actionId: patch.actionId ?? "action-1",
    type: patch.type ?? "draw",
    emittedAt: patch.emittedAt ?? "2026-05-05T12:00:00.000Z",
    actor: patch.actor ?? "me",
    visibility: patch.visibility ?? "private-local",
    text: patch.text ?? "Drew 1 card.",
    format: "Bo1",
    players: {
      me: { name: "Local Player", legend: "Vex", deckName: "Vex Control" },
      opponent: { name: "Opponent", legend: "Kai'Sa", deckName: "Opponent Demo" }
    },
    card: patch.card,
    cards: patch.cards,
    cardCount: patch.cardCount,
    fromZone: patch.fromZone,
    toZone: patch.toZone,
    destination: patch.destination,
    battlefield: patch.battlefield,
    pointsScored: patch.pointsScored,
    scoreReason: patch.scoreReason,
    score: patch.score ?? { me: 0, opponent: 0 },
    mulligan: patch.mulligan,
    resource: patch.resource,
    counter: patch.counter,
    token: patch.token,
    combat: patch.combat,
    snapshot: patch.snapshot,
    active: patch.active ?? true,
    result: patch.result
  };
}

describe.sequential("sim event receiver", () => {
  it("requires the per-session token and accepts valid HTTP payloads", async () => {
    const received: unknown[] = [];
    const receiver = new SimEventReceiver((event) => {
      received.push(event);
    }, 17832);
    await receiver.start();
    try {
      const noTokenUrl = new URL(receiver.url);
      noTokenUrl.search = "";
      const unauthorized = await fetch(noTokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(simEvent({ id: "unauthorized" }))
      });
      expect(unauthorized.status).toBe(401);
      expect(received).toHaveLength(0);

      const accepted = await fetch(receiver.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(simEvent({ id: "accepted" }))
      });
      expect(accepted.status).toBe(200);
      expect(received).toHaveLength(1);
    } finally {
      await receiver.stop();
    }
  });

  it("accepts a scripted E2E batch and produces replay-ready rows", async () => {
    const received: CaptureEvent[] = [];
    const tracker = new MatchSessionTracker();
    const receiver = new SimEventReceiver((event) => {
      received.push(event);
      tracker.ingest(event);
    }, 17852);
    const card = { id: "card-1", name: "Watchful Sentry", code: "OGN-116", type: "unit", imageUrl: "" };
    const stream: RiftboundSimEvent[] = [
      simEvent({ id: "batch-start", sequence: 1, type: "match-start", actor: "system", visibility: "public", text: "Batch smoke started." }),
      simEvent({ id: "batch-hidden", sequence: 2, type: "draw", actor: "opponent", visibility: "hidden", text: "Opponent drew 1 card.", cardCount: 1 }),
      simEvent({ id: "batch-draw", sequence: 3, type: "draw", text: "Drew Watchful Sentry.", cards: [card] }),
      simEvent({ id: "batch-play", sequence: 4, type: "play", visibility: "public", text: "Played Watchful Sentry to Base.", card, fromZone: "hand", toZone: "base", destination: "Base" }),
      simEvent({ id: "batch-end", sequence: 5, type: "match-end", actor: "system", visibility: "public", active: false, text: "Batch smoke ended: Win.", result: "Win", score: { me: 8, opponent: 4 } })
    ];

    await receiver.start();
    try {
      for (const event of stream) {
        const accepted = await fetch(receiver.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event)
        });
        expect(accepted.status).toBe(200);
      }
      expect(received).toHaveLength(stream.length);

      const replayEvents = tracker.getReplayEvents("sim");
      expect(replayEvents.map((event) => event.id)).toEqual(stream.map((event) => event.id));
      expect(replayEvents.find((event) => event.id === "batch-hidden")?.cardCount).toBe(1);
      expect(replayEvents.find((event) => event.id === "batch-draw")?.cardName).toBe("Watchful Sentry");

      const draft = tracker.buildDraft("sim", received[received.length - 1], settings);
      expect(draft.result).toBe("Win");
      expect(draft.games[0].myPoints).toBe(8);
    } finally {
      await receiver.stop();
    }
  });

  it("maps simulator events to RiftLite capture events", () => {
    const capture = captureEventFromSimEvent(simEvent({
      type: "play",
      text: "Played Watchful Sentry to Base.",
      card: { id: "card-1", name: "Watchful Sentry", code: "OGN-116", type: "unit", imageUrl: "" },
      fromZone: "hand",
      toZone: "base",
      destination: "Base"
    }));

    expect(capture.platform).toBe("sim");
    expect(capture.kind).toBe("match-snapshot");
    expect(capture.payload.myChampion).toBe("Vex");
    expect(capture.payload.simEvent).toBeTruthy();
  });

  it("creates structured replay events without exposing hidden opponent draws", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(captureEventFromSimEvent(simEvent({ id: "start", type: "match-start", text: "Match started." })));
    tracker.ingest(captureEventFromSimEvent(simEvent({
      id: "hidden-draw",
      sequence: 2,
      type: "draw",
      actor: "opponent",
      visibility: "hidden",
      text: "Opponent drew 1 card.",
      cardCount: 1
    })));
    tracker.ingest(captureEventFromSimEvent(simEvent({
      id: "play-card",
      sequence: 3,
      type: "play",
      visibility: "public",
      text: "Played Watchful Sentry to Base.",
      card: { id: "card-1", name: "Watchful Sentry", code: "OGN-116", type: "unit", imageUrl: "" },
      fromZone: "hand",
      toZone: "base",
      destination: "Base",
      score: { me: 1, opponent: 0 }
    })));
    const end = captureEventFromSimEvent(simEvent({
      id: "end",
      sequence: 4,
      type: "match-end",
      active: false,
      text: "Match ended: Win.",
      result: "Win",
      score: { me: 8, opponent: 4 }
    }));
    tracker.ingest(end);

    const replayEvents = tracker.getReplayEvents("sim");
    const hiddenDraw = replayEvents.find((event) => event.id === "hidden-draw");
    const play = replayEvents.find((event) => event.id === "play-card");
    expect(hiddenDraw?.cardName).toBe("");
    expect(hiddenDraw?.cardCount).toBe(1);
    expect(hiddenDraw?.visibility).toBe("hidden");
    expect(play?.cardName).toBe("Watchful Sentry");
    expect(play?.fromZone).toBe("hand");

    const draft = tracker.buildDraft("sim", end, settings);
    expect(draft.platform).toBe("sim");
    expect(draft.myChampion).toBe("Vex");
    expect(draft.opponentChampion).toBe("Kai'Sa");
    expect(draft.result).toBe("Win");
    expect(draft.games[0].myPoints).toBe(8);
  });

  it("preserves tracker fidelity payloads in replay events", () => {
    const tracker = new MatchSessionTracker();
    tracker.ingest(captureEventFromSimEvent(simEvent({ id: "start-fidelity", type: "match-start", text: "Match started." })));
    tracker.ingest(captureEventFromSimEvent(simEvent({
      id: "paid",
      sequence: 2,
      type: "resource-pay",
      visibility: "public",
      text: "Paid 2 energy and 1 power.",
      resource: { energy: 2, power: 1 }
    })));
    tracker.ingest(captureEventFromSimEvent(simEvent({
      id: "counter",
      sequence: 3,
      type: "counter-change",
      visibility: "public",
      text: "Watchful Sentry buff +1.",
      card: { id: "card-1", name: "Watchful Sentry", code: "OGN-116", type: "unit", imageUrl: "" },
      counter: { name: "buff", delta: 1, value: 1, targetCardId: "card-1" }
    })));
    tracker.ingest(captureEventFromSimEvent(simEvent({
      id: "combat",
      sequence: 4,
      type: "combat",
      actor: "system",
      visibility: "public",
      text: "Combat resolved.",
      battlefield: "Grove of the God-Willow",
      combat: { battlefield: "Grove of the God-Willow", winner: "me" }
    })));
    tracker.ingest(captureEventFromSimEvent(simEvent({
      id: "snapshot",
      sequence: 5,
      type: "state-snapshot",
      actor: "system",
      visibility: "public",
      text: "State snapshot captured.",
      snapshot: {
        resources: {
          me: { energy: 1, power: 0, xp: 2, runesReady: 3, runesExhausted: 1 },
          opponent: { energy: 0, power: 0, xp: 0, runesReady: 0, runesExhausted: 0 }
        },
        zones: {
          me: { hand: 2, deck: 38 },
          opponent: { hand: 4, deck: 36 }
        },
        knownOpponentCards: [{ id: "known-1", name: "Known Card", code: "OGN-001", type: "unit", imageUrl: "" }]
      }
    })));

    const paid = tracker.getReplayEvents("sim").find((event) => event.id === "paid");
    const counter = tracker.getReplayEvents("sim").find((event) => event.id === "counter");
    const combat = tracker.getReplayEvents("sim").find((event) => event.id === "combat");
    const snapshot = tracker.getReplayEvents("sim").find((event) => event.id === "snapshot");
    expect(paid?.type).toBe("action");
    expect(paid?.resource).toMatchObject({ energy: 2, power: 1 });
    expect(counter?.counter).toMatchObject({ name: "buff", value: 1 });
    expect(combat?.type).toBe("combat");
    expect(combat?.combat?.winner).toBe("me");
    expect(snapshot?.snapshot?.knownOpponentCards[0].name).toBe("Known Card");
  });

  it("round-trips a scripted mini-match into structured replay rows", () => {
    const tracker = new MatchSessionTracker();
    const card = { id: "card-1", name: "Watchful Sentry", code: "OGN-116", type: "unit", imageUrl: "" };
    const stream: RiftboundSimEvent[] = [
      simEvent({ id: "script-start", sequence: 1, type: "match-start", actor: "system", visibility: "public", text: "Match started." }),
      simEvent({ id: "script-mulligan", sequence: 2, type: "mulligan-redraw", text: "Redrew 1 mulligan card: Watchful Sentry.", cards: [card], mulligan: { options: [card], redrawn: [card], redrawCount: 1 } }),
      simEvent({ id: "script-draw", sequence: 3, type: "draw", text: "Drew Watchful Sentry.", cards: [card] }),
      simEvent({ id: "script-play", sequence: 4, type: "play", visibility: "public", text: "Played Watchful Sentry to Base.", card, fromZone: "hand", toZone: "base", destination: "Base" }),
      simEvent({ id: "script-move", sequence: 5, type: "move", visibility: "public", text: "Moved Watchful Sentry to Battlefield A.", card, fromZone: "base", toZone: "battlefield-a", destination: "Battlefield A" }),
      simEvent({ id: "script-score", sequence: 6, type: "score", visibility: "public", text: "Local Player scored 1 point.", pointsScored: 1, scoreReason: "hold", battlefield: "Grove of the God-Willow", score: { me: 1, opponent: 0 } }),
      simEvent({ id: "script-end", sequence: 7, type: "match-end", actor: "system", visibility: "public", active: false, text: "Match ended: Win.", result: "Win", score: { me: 8, opponent: 4 } })
    ];

    for (const event of stream) {
      tracker.ingest(captureEventFromSimEvent(event));
    }

    const replayEvents = tracker.getReplayEvents("sim");
    expect(replayEvents.map((event) => event.id)).toEqual(stream.map((event) => event.id));
    expect(replayEvents.find((event) => event.id === "script-mulligan")?.type).toBe("mulligan");
    expect(replayEvents.find((event) => event.id === "script-draw")?.cardName).toBe("Watchful Sentry");
    expect(replayEvents.find((event) => event.id === "script-move")?.toZone).toBe("battlefield-a");
    expect(replayEvents.find((event) => event.id === "script-score")?.scoreReason).toBe("hold");

    const draft = tracker.buildDraft("sim", captureEventFromSimEvent(stream[stream.length - 1]), settings);
    expect(draft.platform).toBe("sim");
    expect(draft.result).toBe("Win");
    expect(draft.games[0].myPoints).toBe(8);
  });

  it("rejects oversized HTTP payloads", async () => {
    const received: unknown[] = [];
    const receiver = new SimEventReceiver((event) => {
      received.push(event);
    }, 17872);
    await receiver.start();
    try {
      const oversized = await fetch(receiver.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...simEvent({ id: "too-large" }), text: "x".repeat(300_000) })
      });
      expect(oversized.status).toBe(400);
      expect(received).toHaveLength(0);
    } finally {
      await receiver.stop();
    }
  });
});
