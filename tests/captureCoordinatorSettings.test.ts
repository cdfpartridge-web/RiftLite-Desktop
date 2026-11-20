import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureCoordinator } from "../src/main/services/captureCoordinator";
import type { CaptureEvent, GamePlatform, MatchDraft, ReplayRecord, ReplayScreenshotFrame, UserSettings } from "../src/shared/types";

vi.mock("electron", () => ({ BrowserWindow: class {}, Notification: class { static isSupported() { return false; } } }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

const startedAt = "2026-11-07T12:00:00.000Z";
const frame = (name: string): ReplayScreenshotFrame => ({ path: `/isolated/${name}.jpg`, url: `file:///isolated/${name}.jpg`, label: name, capturedAt: startedAt, source: "timed-replay" });
function harness() {
  let settings = { username: "Me", replayCaptureEnabled: true, replayKeyframesEnabled: true, replayVideoEnabled: false, replayFramePreset: "standard", activeDeckId: "", activeHubs: [] } as unknown as UserSettings;
  const getSettings = vi.fn(async () => settings);
  const draft = {
    id: "settings-match", platform: "atlas", status: "saved", capturedAt: startedAt, updatedAt: startedAt,
    format: "Bo1", result: "Win", score: "1-0", myName: "Me", opponentName: "Opponent",
    myChampion: "Riven", opponentChampion: "Riven", myBattlefield: "", opponentBattlefield: "",
    deckName: "", deckSourceId: "", flags: "", notes: "", games: [], rawEvidence: [],
    sync: { community: "pending", hubs: {}, teams: {} }
  } as MatchDraft;
  const saveReplay = vi.fn(async (replay: ReplayRecord) => replay);
  const capture = vi.fn(async (): Promise<ReplayScreenshotFrame | null> => frame("before-disable"));
  const diagnostic = vi.fn(async () => undefined);
  const deckTracker = { ingestCaptureEvent: vi.fn(async () => undefined) };
  const coordinator = new CaptureCoordinator(
    { getSettings, getMatches: vi.fn(async () => [draft]), getSavedDecks: vi.fn(async () => []), saveReplayIfMatchActive: saveReplay } as never,
    () => null, {} as never, {} as never, { record: diagnostic } as never, capture, deckTracker as never
  );
  const internals = coordinator as unknown as {
    ensureTimedReplayCapture(platform: GamePlatform, settings: UserSettings | null): void;
    stopTimedReplayCapture(platform: GamePlatform, captureFinal: boolean): Promise<ReplayScreenshotFrame[]>;
    persistPreparedReplayFinalization(prepared: { draft: MatchDraft; endEvent: CaptureEvent; resolvedReplayEvents: []; visualFrames: ReplayScreenshotFrame[]; settings: UserSettings; deckTrackerSnapshots: [] }): Promise<void>;
  };
  const startEvent: CaptureEvent = { id: "settings-match-start", platform: "atlas", kind: "match-start", capturedAt: startedAt, url: "https://play.riftatlas.com/game", payload: { active: true, myName: "Me", opponentName: "Opponent", myChampion: "Riven", opponentChampion: "Riven", roomCode: "ROOM1" } };
  return { coordinator, internals, getSettings, capture, diagnostic, deckTracker, saveReplay, draft, startEvent,
    get settings() { return settings; },
    update(patch: Partial<UserSettings>) { settings = { ...settings, ...patch }; coordinator.updateReplayCaptureSettings(settings); }
  };
}

describe("active timed screenshot settings", () => {
  it.each([{ replayKeyframesEnabled: false }, { replayCaptureEnabled: false }, { replayVideoEnabled: true }])("immediately stops active Atlas and TCGA screenshots for %j, preserving existing frames", async patch => {
    vi.useFakeTimers();
    const h = harness();
    for (const platform of ["atlas", "tcga"] as const) h.internals.ensureTimedReplayCapture(platform, h.settings);
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.capture).toHaveBeenCalledTimes(2);
    h.update(patch);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.capture).toHaveBeenCalledTimes(2);
    for (const platform of ["atlas", "tcga"] as const) {
      expect(await h.internals.stopTimedReplayCapture(platform, true)).toEqual([frame("before-disable")]);
    }
    expect(h.capture).toHaveBeenCalledTimes(2);
  });

  it("retains a capture already in flight when disabled and resumes without losing earlier frames", async () => {
    vi.useFakeTimers();
    const h = harness();
    let complete!: (value: ReplayScreenshotFrame) => void;
    h.capture.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    h.internals.ensureTimedReplayCapture("atlas", h.settings);
    await vi.advanceTimersByTimeAsync(4000);
    h.update({ replayKeyframesEnabled: false });
    complete(frame("admitted-before-disable"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.capture).toHaveBeenCalledOnce();
    h.update({ replayKeyframesEnabled: true });
    h.capture.mockResolvedValue(frame("after-reenable"));
    // A slow admitted capture may retain its existing cooldown; it must still resume.
    await vi.advanceTimersByTimeAsync(24_000);
    h.update({ replayKeyframesEnabled: false });
    const retained = await h.internals.stopTimedReplayCapture("atlas", true);
    expect(retained[0]).toEqual(frame("admitted-before-disable"));
    expect(retained.slice(1)).toContainEqual(frame("after-reenable"));
  });

  it("does not let an event carrying stale settings restart screenshots after disable", async () => {
    vi.useFakeTimers();
    const h = harness();
    let release!: () => void;
    let entered!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    h.deckTracker.ingestCaptureEvent.mockImplementationOnce(async () => { entered(); await blocked; });
    const processing = h.coordinator.handleEvent(h.startEvent);
    await reading;
    h.update({ replayKeyframesEnabled: false });
    release(); await processing;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.capture).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not resume a paused timer if reading settings fails", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.internals.ensureTimedReplayCapture("atlas", h.settings);
    h.update({ replayKeyframesEnabled: false });
    h.internals.ensureTimedReplayCapture("atlas", null);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("keeps previously saved frames in their local replay when the master switch is later disabled", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.internals.ensureTimedReplayCapture("atlas", h.settings);
    await vi.advanceTimersByTimeAsync(4000);
    h.update({ replayCaptureEnabled: false });
    const visualFrames = await h.internals.stopTimedReplayCapture("atlas", true);
    await h.internals.persistPreparedReplayFinalization({ draft: h.draft, endEvent: { ...h.startEvent, kind: "match-end" }, resolvedReplayEvents: [], visualFrames, settings: h.settings, deckTrackerSnapshots: [] });
    expect(h.saveReplay).toHaveBeenCalledWith(expect.objectContaining({ visualFrames: [frame("before-disable")] }));
    expect(h.capture).toHaveBeenCalledOnce();
  });

  it("drains an admitted capture when disabled immediately before replay finalization", async () => {
    vi.useFakeTimers();
    const h = harness();
    let complete!: (value: ReplayScreenshotFrame) => void;
    h.capture.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    h.internals.ensureTimedReplayCapture("atlas", h.settings);
    await vi.advanceTimersByTimeAsync(4000);
    h.update({ replayCaptureEnabled: false });
    let stopped = false;
    const stopping = h.internals.stopTimedReplayCapture("atlas", true).then(frames => { stopped = true; return frames; });
    await vi.advanceTimersByTimeAsync(100);
    expect(stopped).toBe(false);
    complete(frame("admitted-before-disable"));
    const visualFrames = await stopping;
    expect(visualFrames).toEqual([frame("admitted-before-disable")]);
    await h.internals.persistPreparedReplayFinalization({ draft: h.draft, endEvent: { ...h.startEvent, kind: "match-end" }, resolvedReplayEvents: [], visualFrames, settings: h.settings, deckTrackerSnapshots: [] });
    expect(h.saveReplay).toHaveBeenCalledWith(expect.objectContaining({ visualFrames }));
    expect(h.capture).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honours disabling screenshots while finalization is draining an admitted frame", async () => {
    vi.useFakeTimers();
    const h = harness();
    let complete!: (value: ReplayScreenshotFrame) => void;
    h.capture.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    h.internals.ensureTimedReplayCapture("atlas", h.settings);
    await vi.advanceTimersByTimeAsync(4000);
    const stopping = h.internals.stopTimedReplayCapture("atlas", true);
    h.update({ replayKeyframesEnabled: false });
    complete(frame("admitted-before-disable"));
    expect(await stopping).toEqual([frame("admitted-before-disable")]);
    expect(h.capture).toHaveBeenCalledOnce();
  });

  it("bounds a hung capture drain and preserves a late artifact without adding it to a new match", async () => {
    vi.useFakeTimers();
    const h = harness();
    let complete!: (value: ReplayScreenshotFrame) => void;
    h.capture.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    h.internals.ensureTimedReplayCapture("atlas", h.settings);
    await vi.advanceTimersByTimeAsync(4000);
    h.update({ replayKeyframesEnabled: false });
    const stopping = h.internals.stopTimedReplayCapture("atlas", true);
    await vi.advanceTimersByTimeAsync(2500);
    const completedFrames = await stopping;
    expect(completedFrames).toEqual([]);
    expect(h.capture).toHaveBeenCalledOnce();
    h.update({ replayKeyframesEnabled: true });
    h.internals.ensureTimedReplayCapture("atlas", h.settings);
    complete(frame("late-old-match"));
    await vi.advanceTimersByTimeAsync(0);
    expect(completedFrames).toEqual([]);
    expect(h.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ reason: "replay-frame-late-preserved" }) }));
    h.capture.mockResolvedValue(frame("new-match"));
    await vi.advanceTimersByTimeAsync(4000);
    h.update({ replayKeyframesEnabled: false });
    expect(await h.internals.stopTimedReplayCapture("atlas", true)).toEqual([frame("new-match")]);
  });

  it("uses one deadline for an admitted capture and optional final frame", async () => {
    vi.useFakeTimers();
    const h = harness();
    let complete!: (value: ReplayScreenshotFrame) => void;
    let completeFinal!: (value: ReplayScreenshotFrame) => void;
    h.capture.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    h.internals.ensureTimedReplayCapture("atlas", h.settings);
    await vi.advanceTimersByTimeAsync(4000);
    const stopping = h.internals.stopTimedReplayCapture("atlas", true);
    h.capture.mockImplementationOnce(() => new Promise(resolve => { completeFinal = resolve; }));
    await vi.advanceTimersByTimeAsync(2000);
    complete(frame("drained"));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.capture).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    const completedFrames = await stopping;
    expect(completedFrames).toEqual([frame("drained")]);
    completeFinal(frame("late-final"));
    await vi.advanceTimersByTimeAsync(0);
    expect(completedFrames).toEqual([frame("drained")]);
    expect(h.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ reason: "replay-frame-late-preserved", captureFinal: true }) }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not take an old session's final screenshot after a new timed session starts", async () => {
    vi.useFakeTimers();
    const h = harness();
    let complete!: (value: ReplayScreenshotFrame) => void;
    h.capture.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    h.internals.ensureTimedReplayCapture("atlas", h.settings);
    await vi.advanceTimersByTimeAsync(4000);
    const stopping = h.internals.stopTimedReplayCapture("atlas", true);
    h.internals.ensureTimedReplayCapture("atlas", h.settings);
    complete(frame("old-session"));
    expect(await stopping).toEqual([frame("old-session")]);
    expect(h.capture).toHaveBeenCalledOnce();
    h.capture.mockResolvedValue(frame("new-session"));
    await vi.advanceTimersByTimeAsync(4000);
    h.update({ replayKeyframesEnabled: false });
    expect(await h.internals.stopTimedReplayCapture("atlas", true)).toEqual([frame("new-session")]);
  });
});
