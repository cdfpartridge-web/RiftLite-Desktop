import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CaptureCoordinator } from "../src/main/services/captureCoordinator";
import type { CaptureEvent, MatchDraft, UserSettings } from "../src/shared/types";

vi.mock("electron", () => ({
  BrowserWindow: class {},
  Notification: class { static isSupported(): boolean { return false; } }
}));

const settings = {
  username: "Local Player", replayCaptureEnabled: false, enhancedInsightsEnabled: false,
  confirmationEnabled: true, communitySyncEnabled: false, syncMode: "local-only",
  activeHubs: [], activeTeams: [], activeDeckId: ""
} as unknown as UserSettings;

function harness() {
  const saved: MatchDraft[] = [];
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const diagnostics = { record: vi.fn(async (_event: CaptureEvent) => undefined) };
  const store = {
    getSettings: vi.fn(async () => settings),
    getMatches: vi.fn(async () => saved),
    getSavedDecks: vi.fn(async () => []),
    saveMatch: vi.fn(async (draft: MatchDraft) => {
      const index = saved.findIndex((match) => match.id === draft.id);
      if (index >= 0) saved[index] = draft;
      else saved.push(draft);
      return draft;
    }),
    saveReplay: vi.fn(async () => undefined),
    saveReplayIfMatchActive: vi.fn(async (replay: unknown) => replay),
    deleteReplayByMatch: vi.fn(async () => undefined)
  };
  const coordinator = new CaptureCoordinator(
    store as never,
    () => ({ webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }) as never,
    { resolveLegend: async () => "", resolveBattlefield: async () => "", resolveCard: async () => "" } as never,
    { syncMatch: async (draft: MatchDraft) => draft } as never,
    diagnostics as never
  );
  return { coordinator, saved, sent, diagnostics, drafts: () => sent.filter((item) => item.channel === "match:draft") };
}

const yi = {
  active: true, format: "Bo3", roomCode: "OLDROOM", myName: "Local Player",
  opponentName: "Yi Rival", myChampion: "Akali", opponentChampion: "Master Yi",
  myBattlefield: "Star Spring", opponentBattlefield: "Star Spring"
};

function event(kind: CaptureEvent["kind"], seconds: number, payload: Record<string, unknown>): CaptureEvent {
  const capturedAt = new Date(Date.UTC(2026, 8, 11, 11, 20) + seconds * 1_000).toISOString();
  return { id: `${kind}-${seconds}`, kind, platform: "atlas", capturedAt, url: "https://play.riftatlas.com/game", payload };
}

function complete(seconds: number, payload: Record<string, unknown> = yi): CaptureEvent {
  return event("match-end", seconds, {
    ...payload, reason: "result-text-detected", atlasResultKind: "match-terminal",
    endText: "Match Complete", score: { me: "6", opp: "3", source: "atlas-score-track" }
  });
}

async function finishYi(test: ReturnType<typeof harness>, format = "Bo3") {
  await test.coordinator.handleEvent(event("match-start", 0, {
    ...yi, format, score: { me: "0", opp: "0", source: "atlas-score-track" }
  }));
  await test.coordinator.handleEvent(complete(100, { ...yi, format }));
  expect(test.saved).toHaveLength(1);
  expect(test.saved[0].games).toHaveLength(1);
  expect(test.coordinator.hasActiveCaptureSession("atlas")).toBe(false);
}

afterEach(() => vi.useRealTimers());

describe("Atlas completed single-game echoes", () => {
  it("does not reopen a finished match through the debug heartbeat recorded before the Akali join", async () => {
    const test = harness();
    await finishYi(test);
    // Sept 13: the terminal result was followed by a diagnostic containing
    // active=true but no room or result. The lobby then retained the old score.
    // Include diagnostics: filtering them out of the recording hides this bug.
    const heartbeat = event("debug", 100.002, {
      reason: "snapshot-signature-changed", active: true, myName: "Local Player"
    });
    await test.coordinator.handleEvent(heartbeat);
    expect(test.diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ id: heartbeat.id, kind: "debug" }));
    expect(test.coordinator.hasActiveCaptureSession("atlas")).toBe(false);
    await test.coordinator.handleEvent({ ...complete(100.002), kind: "match-snapshot" });
    await test.coordinator.handleEvent({
      ...event("match-snapshot", 116, {
        ...yi, active: false, endText: "", atlasResultKind: "",
        score: { me: "6", opp: "3", source: "atlas-score-track" }
      }), url: "https://play.riftatlas.com/"
    });
    await test.coordinator.handleEvent(event("match-start", 685, {
      ...yi, roomCode: "AKALIROOM", opponentName: "Akali Rival", opponentChampion: "Akali",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }));
    expect(test.saved).toHaveLength(1);
    expect(test.drafts()).toHaveLength(1);
    expect(test.coordinator.getLiveOverlayMatch()).toMatchObject({ opponentName: "Akali Rival", gameNumber: 1, score: "0-0" });
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it("keeps diagnostics from rolling over or changing an active game's identity and score", async () => {
    const test = harness();
    await test.coordinator.handleEvent(event("match-start", 0, {
      ...yi, score: { me: "3", opp: "2", source: "atlas-score-track" }
    }));
    await test.coordinator.handleEvent(event("debug", 180, {
      active: true, reason: "debug-heartbeat", roomCode: "OTHERROOM", opponentName: "Other Rival",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }));
    expect(test.saved).toHaveLength(0);
    expect(test.drafts()).toHaveLength(0);
    expect(test.coordinator.getLiveOverlayMatch()).toMatchObject({ opponentName: "Yi Rival", gameNumber: 1, score: "3-2" });
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it("replays the recorded Yi exit and Irelia join without creating a second Yi review", async () => {
    const test = harness();
    const recording = JSON.parse(readFileSync(new URL("./fixtures/atlas-terminal-yi-to-irelia.json", import.meta.url), "utf8")) as CaptureEvent[];
    for (const captured of recording) {
      await test.coordinator.handleEvent(captured);
      if (captured.kind === "match-end") {
        expect(test.saved).toHaveLength(1);
        await test.coordinator.confirmMatch({ ...test.saved[0], status: "saved", format: "Bo1" });
      }
    }
    expect(test.saved).toHaveLength(1);
    expect(test.saved[0]).toMatchObject({ opponentName: "Yi Opponent", format: "Bo1", status: "saved" });
    expect(test.saved[0].games.map((game) => [game.gameNumber, game.myPoints, game.oppPoints])).toEqual([[1, 6, 3]]);
    expect(test.drafts()).toHaveLength(1);
    expect(test.coordinator.getLiveOverlayMatch()).toMatchObject({ opponentName: "Irelia Opponent", gameNumber: 1, score: "0-0" });
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it.each(["Bo3", "Bo1"])("does not recreate a completed %s session from delayed result snapshots", async (format) => {
    const test = harness();
    await finishYi(test, format);
    // The original review may be corrected to BO1 after an opponent leaves early.
    await test.coordinator.confirmMatch({ ...test.saved[0], format: "Bo1", status: "saved" });
    const echo = complete(103, { ...yi, format });
    await test.coordinator.handleEvent({ ...echo, kind: "match-snapshot", id: "terminal-snapshot" });
    expect(test.coordinator.hasActiveCaptureSession("atlas")).toBe(false);
    await test.coordinator.handleEvent(complete(105, { ...yi, format }));
    await test.coordinator.handleEvent(event("match-start", 136, {
      ...yi, roomCode: "NEWROOM", opponentName: "Irelia Rival", opponentChampion: "Irelia",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }));
    expect(test.saved).toHaveLength(1);
    expect(test.drafts()).toHaveLength(1);
    expect(test.coordinator.getLiveOverlayMatch()).toMatchObject({ opponentName: "Irelia Rival", gameNumber: 1, score: "0-0" });
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it.each(["OLDROOM", "NEWROOM"])("captures a real same-opponent rematch in %s", async (roomCode) => {
    const test = harness();
    await finishYi(test);
    const rematch = { ...yi, roomCode };
    await test.coordinator.handleEvent(event("match-start", 110, {
      ...rematch, score: { me: "0", opp: "0", source: "atlas-score-track" }
    }));
    await test.coordinator.handleEvent(complete(115, rematch));
    expect(test.saved).toHaveLength(2);
    expect(test.drafts()).toHaveLength(2);
    expect(test.saved[1].capturedAt).toBe(event("match-start", 110, {}).capturedAt);
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it.each(["match-start", "match-snapshot", "match-update"] as const)("does not recreate the saved match when its result dialog closes and emits %s", async (kind) => {
    const test = harness();
    await finishYi(test);
    await test.coordinator.confirmMatch({ ...test.saved[0], status: "saved" });
    // Closing Atlas's result dialog leaves the finished board visible. Its
    // preload may call this a new start because the terminal result reset its
    // active flag, but neither the room nor the actual game score changed.
    await test.coordinator.handleEvent(event(kind, 103, {
      ...yi, atlasResultKind: "", endText: "",
      score: { me: "6", opp: "3", source: "atlas-score-track" }
    }));
    expect(test.coordinator.hasActiveCaptureSession("atlas")).toBe(false);
    await test.coordinator.handleEvent(event("match-start", 136, {
      ...yi, roomCode: "NEWROOM", opponentName: "New Rival",
      score: { me: "0", opp: "0", source: "atlas-score-track" }
    }));
    expect(test.saved).toHaveLength(1);
    expect(test.drafts()).toHaveLength(1);
    expect(test.coordinator.getLiveOverlayMatch()).toMatchObject({ opponentName: "New Rival", score: "0-0" });
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it("keeps a finished board closed through later snapshots, then captures a snapshot-only same-room score reset", async () => {
    const test = harness();
    await finishYi(test);
    for (const seconds of [103, 200, 300]) {
      await test.coordinator.handleEvent(event("match-snapshot", seconds, {
        ...yi, score: { me: "6", opp: "3" }
      }));
      expect(test.coordinator.hasActiveCaptureSession("atlas")).toBe(false);
    }
    await test.coordinator.handleEvent(event("match-snapshot", 305, {
      ...yi, score: { me: "0", opp: "0" }
    }));
    await test.coordinator.handleEvent(complete(310));
    expect(test.saved).toHaveLength(2);
    expect(test.drafts()).toHaveLength(2);
    expect(test.saved[1].capturedAt).toBe(event("match-snapshot", 305, {}).capturedAt);
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it.each(["atlasGameInstanceId", "atlasHistoryStartedAt"] as const)("captures a genuine missed start when %s changes despite the same room and score", async (identity) => {
    const test = harness();
    const previous = { ...yi, [identity]: identity === "atlasHistoryStartedAt" ? 1_000 : "previous-game" };
    const next = { ...yi, [identity]: identity === "atlasHistoryStartedAt" ? 2_000 : "next-game" };
    await test.coordinator.handleEvent(event("match-start", 0, { ...previous, score: { me: "0", opp: "0" } }));
    await test.coordinator.handleEvent(complete(100, previous));
    await test.coordinator.handleEvent(event("match-snapshot", 110, { ...next, score: { me: "6", opp: "3" } }));
    await test.coordinator.handleEvent(complete(115, next));
    expect(test.saved).toHaveLength(2);
    expect(test.saved[1].capturedAt).toBe(event("match-snapshot", 110, {}).capturedAt);
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it("captures the first observed active board even when no match-start was received", async () => {
    const test = harness();
    await test.coordinator.handleEvent(event("match-snapshot", 90, { ...yi, score: { me: "6", opp: "3" } }));
    await test.coordinator.handleEvent(complete(100));
    expect(test.saved).toHaveLength(1);
    expect(test.saved[0].capturedAt).toBe(event("match-snapshot", 90, {}).capturedAt);
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it("does not recreate a completed automatic BO1 victory after its result dialog closes", async () => {
    const test = harness();
    const bo1 = { ...yi, format: "Bo1" };
    await test.coordinator.handleEvent(event("match-start", 0, { ...bo1, score: { me: "0", opp: "0" } }));
    await test.coordinator.handleEvent(event("match-end", 100, {
      ...bo1, atlasResultKind: "game-result", endText: "Victory", score: { me: "8", opp: "3" }
    }));
    expect(test.saved).toHaveLength(1);
    await test.coordinator.confirmMatch({ ...test.saved[0], status: "saved" });
    await test.coordinator.handleEvent(event("match-snapshot", 102, {
      ...bo1, atlasResultKind: "game-result", endText: "Victory", score: { me: "8", opp: "3" }
    }));
    expect(test.coordinator.hasActiveCaptureSession("atlas")).toBe(false);
    await test.coordinator.handleEvent(event("match-start", 103, { ...bo1, score: { me: "8", opp: "3" } }));
    expect(test.coordinator.hasActiveCaptureSession("atlas")).toBe(false);
    await test.coordinator.handleEvent(event("match-start", 110, { ...bo1, score: { me: "0", opp: "0" } }));
    await test.coordinator.handleEvent(complete(115, bo1));
    expect(test.saved).toHaveLength(2);
    expect(test.drafts()).toHaveLength(2);
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it("does not recreate a three-game landing-page finish when the old board starts again after 148 seconds of silence", async () => {
    const test = harness();
    for (const [gameNumber, me, opp] of [[1, "8", "4"], [2, "4", "8"], [3, "7", "6"]] as const) {
      await test.coordinator.handleEvent(event("match-start", (gameNumber - 1) * 30, {
        ...yi, score: { me: "0", opp: "0" }
      }));
      await test.coordinator.handleEvent(event("match-snapshot", gameNumber * 30 - 5, {
        ...yi, score: { me, opp }
      }));
      if (gameNumber < 3) {
        await test.coordinator.handleEvent(event("match-end", gameNumber * 30 - 1, {
          ...yi, atlasResultKind: "game-result", atlasBo3GameNumber: gameNumber,
          endText: `Confirm Game ${gameNumber} Winner`, score: { me, opp }
        }));
      }
    }
    await test.coordinator.handleEvent({
      ...event("match-end", 100, {
        ...yi, active: false, reason: "inactive-debounce", atlasResultKind: "", endText: "",
        score: { me: "7", opp: "6" }
      }), url: "https://play.riftatlas.com/"
    });
    expect(test.saved).toHaveLength(1);
    expect(test.saved[0].games).toHaveLength(3);
    await test.coordinator.confirmMatch({ ...test.saved[0], status: "saved" });
    // Oct 13 sequence, with synthetic players/rooms and the observed delays.
    await test.coordinator.handleEvent(event("match-start", 248.141, {
      ...yi, reason: "interaction-settled", atlasResultKind: "", endText: "", score: { me: "7", opp: "6" }
    }));
    expect(test.coordinator.hasActiveCaptureSession("atlas")).toBe(false);
    await test.coordinator.handleEvent(event("match-start", 249.791, {
      ...yi, roomCode: "NEWROOM", opponentName: "New Rival", score: { me: "0", opp: "0" }
    }));
    expect(test.saved).toHaveLength(1);
    expect(test.drafts()).toHaveLength(1);
    expect(test.coordinator.getLiveOverlayMatch()).toMatchObject({ opponentName: "New Rival", gameNumber: 1, score: "0-0" });
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it("does not recreate an early terminal match through an old-board start, inactive end and next opponent", async () => {
    vi.useFakeTimers();
    const test = harness();
    await test.coordinator.handleEvent(event("match-start", 0, { ...yi, score: { me: "0", opp: "0" } }));
    await test.coordinator.handleEvent({ ...complete(100), payload: { ...complete(100).payload, score: { me: "4", opp: "2" } } });
    await test.coordinator.confirmMatch({ ...test.saved[0], status: "saved" });
    await test.coordinator.handleEvent(event("match-start", 112.063, {
      ...yi, atlasResultKind: "", endText: "", score: { me: "4", opp: "2" }
    }));
    await test.coordinator.handleEvent(event("match-end", 115.124, {
      ...yi, active: false, reason: "inactive-debounce", atlasResultKind: "", endText: "", score: { me: "4", opp: "2" }
    }));
    await test.coordinator.handleEvent(event("match-start", 159.744, {
      ...yi, roomCode: "NEWROOM", opponentName: "New Rival", score: { me: "0", opp: "0" }
    }));
    await vi.advanceTimersByTimeAsync(46_000);
    expect(test.saved).toHaveLength(1);
    expect(test.drafts()).toHaveLength(1);
    expect(test.coordinator.getLiveOverlayMatch()).toMatchObject({ opponentName: "New Rival", score: "0-0" });
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it("accepts a same-room snapshot with different nonzero points when a genuine game's start was missed", async () => {
    const test = harness();
    await finishYi(test);
    await test.coordinator.handleEvent(event("match-snapshot", 110, { ...yi, score: { me: "2", opp: "1" } }));
    expect(test.coordinator.hasActiveCaptureSession("atlas")).toBe(true);
    await test.coordinator.handleEvent(complete(120));
    expect(test.saved).toHaveLength(2);
    expect(test.saved[1].capturedAt).toBe(event("match-snapshot", 110, {}).capturedAt);
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it("keeps a known-room terminal screen closed while it continues emitting, then accepts a rematch", async () => {
    const test = harness();
    await finishYi(test);
    for (const at of [200, 300, 400]) {
      await test.coordinator.handleEvent({ ...complete(at), kind: "match-snapshot" });
      expect(test.coordinator.hasActiveCaptureSession("atlas")).toBe(false);
    }
    expect(test.drafts()).toHaveLength(1);
    await test.coordinator.handleEvent(event("match-start", 405, {
      ...yi, score: { me: "0", opp: "0", source: "atlas-score-track" }
    }));
    await test.coordinator.handleEvent(complete(410));
    expect(test.saved).toHaveLength(2);
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it.each([false, true])("expires after silence without allowing anonymous echoes to renew it (anonymous=%s)", async (anonymous) => {
    const test = harness();
    await finishYi(test);
    if (anonymous) {
      await test.coordinator.handleEvent({
        ...complete(200, { active: true }), kind: "match-snapshot"
      });
      expect(test.coordinator.hasActiveCaptureSession("atlas")).toBe(false);
    }
    // The initial start of a later match may be missed; a stale marker must
    // not indefinitely prevent capturing another terminal result.
    await test.coordinator.handleEvent(complete(225));
    expect(test.saved).toHaveLength(2);
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it("keeps child results pending and captures both games before a terminal result", async () => {
    vi.useFakeTimers();
    const test = harness();
    await test.coordinator.handleEvent(event("match-start", 0, {
      ...yi, score: { me: "0", opp: "0", source: "atlas-score-track" }
    }));
    await test.coordinator.handleEvent(event("match-end", 100, {
      ...yi, reason: "result-text-detected", atlasResultKind: "game-result", atlasBo3GameNumber: 1,
      endText: "Confirm Game 1 Winner", score: { me: "6", opp: "3", source: "atlas-score-track" }
    }));
    expect(test.saved).toHaveLength(0);
    await test.coordinator.handleEvent(event("match-start", 105, {
      ...yi, score: { me: "0", opp: "0", source: "atlas-score-track" }
    }));
    await test.coordinator.handleEvent(event("match-snapshot", 180, {
      ...yi, score: { me: "8", opp: "4", source: "atlas-score-track" }
    }));
    await test.coordinator.handleEvent({ ...complete(185), payload: {
      ...complete(185).payload, score: { me: "8", opp: "4", source: "atlas-score-track" }
    } });
    expect(test.saved).toHaveLength(1);
    expect(test.saved[0].games.map((game) => [game.myPoints, game.oppPoints])).toEqual([[6, 3], [8, 4]]);
    expect(test.drafts()).toHaveLength(1);
    await test.coordinator.waitForAllReplayFinalizations();
  });

  it("does not suppress a later genuine result after a manual partial BO1 review", async () => {
    const test = harness();
    await test.coordinator.handleEvent(event("match-start", 0, {
      ...yi, format: "Bo1", score: { me: "2", opp: "1", source: "atlas-score-track" }
    }));
    await test.coordinator.forceReview("atlas");
    await test.coordinator.handleEvent(complete(100, { ...yi, format: "Bo1" }));
    expect(test.saved).toHaveLength(2);
    expect(test.drafts()).toHaveLength(2);
    await test.coordinator.waitForAllReplayFinalizations();
  });
});
