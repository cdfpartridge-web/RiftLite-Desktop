import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RawCaptureService } from "../src/main/services/rawCaptureService";
import type { RiftLiteStore } from "../src/main/services/store";
import type { MatchDraft, RawCaptureAppendFramePayload, ReplayRecord, UserSettings } from "../src/shared/types";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function settings(rawCapture: Partial<UserSettings["rawCapture"]>, replayDirectory: string): UserSettings {
  return {
    rawCapture: {
      enabled: false,
      webReplayAutoUploadEnabled: false,
      webReplayAutoUploadAccountUid: "",
      webReplayDiscordShareEnabled: false,
      webReplayDiscordShareAccountUid: "",
      webReplayDiscordShareHubIds: [],
      uploadEnabled: false,
      endpoint: "https://riftreplay.com/api/v1/replays",
      apiKey: "",
      visibility: "private",
      ...rawCapture
    },
    replayDirectory
  } as UserSettings;
}

function replay(id = "replay-1", roomCode = "ABCDE", platform: ReplayRecord["platform"] = "atlas"): ReplayRecord {
  return {
    id,
    matchId: "match-1",
    platform,
    capturedAt: "2026-06-29T10:00:00.000Z",
    title: "Ahri vs Vex",
    players: {
      me: "BMU",
      opponent: "Tester"
    },
    events: roomCode
      ? [{
          id: `event-${id}`,
          platform,
          kind: "match-end",
          capturedAt: "2026-06-29T10:00:00.000Z",
          url: "https://riftatlas.com/game",
          payload: { roomCode }
        }]
      : []
  };
}

function twoGameBo3Replay(id = "bo3-result-replay", roomCode = "ROOM2"): ReplayRecord {
  const base = replay(id, roomCode);
  return {
    ...base,
    matchSnapshot: {
      id: base.matchId,
      platform: "atlas",
      status: "saved",
      capturedAt: base.capturedAt,
      updatedAt: "2026-06-29T10:30:00.000Z",
      result: "Loss",
      format: "Bo3",
      score: "0-2",
      myName: "Private Perspective Player",
      opponentName: "Private Opponent",
      myChampion: "Akali",
      opponentChampion: "Akali",
      myBattlefield: "Stored Battlefield Must Not Upload",
      opponentBattlefield: "Stored Opponent Battlefield Must Not Upload",
      deckName: "Private Deck Name",
      deckSourceId: "private-deck-id",
      flags: "private flags",
      notes: "private notes",
      games: [{
        gameNumber: 1,
        result: "Loss",
        myPoints: 5,
        oppPoints: 8,
        myBattlefield: "Stored Game One Battlefield Must Not Upload",
        oppBattlefield: "Stored Game One Opponent Battlefield Must Not Upload"
      }, {
        gameNumber: 2,
        result: "Loss",
        myPoints: 4,
        oppPoints: 5,
        myBattlefield: "Stored Game Two Battlefield Must Not Upload",
        oppBattlefield: "Stored Game Two Opponent Battlefield Must Not Upload"
      }],
      rawEvidence: [{
        id: "private-evidence-id",
        platform: "atlas",
        kind: "match-end",
        capturedAt: "2026-06-29T10:30:00.000Z",
        url: "https://private.example/PRIVATE_ROOM",
        payload: { secret: "PRIVATE_RAW_EVIDENCE" }
      }],
      sync: {
        community: "disabled",
        hubs: {},
        teams: {}
      }
    }
  };
}

function oneGameBo1Replay(
  id = "bo1-result-replay",
  roomCode = "ROOM1",
  result: "Win" | "Loss" | "Draw" | "Incomplete" = "Win"
): ReplayRecord {
  const base = replay(id, roomCode);
  const resolved = result !== "Incomplete";
  return {
    ...base,
    matchSnapshot: {
      id: base.matchId,
      platform: "atlas",
      status: resolved ? "saved" : "incomplete",
      capturedAt: base.capturedAt,
      updatedAt: base.capturedAt,
      result,
      format: "Bo1",
      score: result === "Win" ? "1-0" : result === "Loss" ? "0-1" : result === "Draw" ? "0-0" : "",
      myName: "BMU",
      opponentName: "Tester",
      myChampion: "Akali",
      opponentChampion: "Lee Sin",
      myBattlefield: "",
      opponentBattlefield: "",
      deckName: "",
      deckSourceId: "",
      flags: "",
      notes: "",
      games: [{
        gameNumber: 1,
        result,
        myPoints: 4,
        oppPoints: 4,
        myBattlefield: "",
        oppBattlefield: ""
      }],
      rawEvidence: [],
      sync: { community: "disabled", hubs: {}, teams: {} }
    }
  };
}

function atlasFrame(
  raw: string,
  options: { ts?: number; requestUrl?: string; socketId?: string } = {}
): RawCaptureAppendFramePayload {
  return {
    platform: "atlas",
    requestUrl: options.requestUrl ?? "wss://riftatlas.example/room",
    frame: {
      seq: 99,
      ts: options.ts ?? 1781360000000,
      dir: "in",
      socketId: options.socketId,
      raw
    }
  };
}

async function tempReplayDirectory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "riftlite-raw-capture-"));
  tempDirs.push(dir);
  return dir;
}

function fakeStore(initialSettings: UserSettings): RiftLiteStore {
  let currentSettings = initialSettings;
  let replays: ReplayRecord[] = [];
  let matches: MatchDraft[] = [];
  return {
    getSettings: async () => currentSettings,
    saveReplay: async (next: ReplayRecord) => {
      replays = [next, ...replays.filter((item) => item.id !== next.id)];
      return next;
    },
    getReplays: async () => replays,
    getDeletedReplays: async () => [],
    getMatches: async () => matches,
    saveMatch: async (next: MatchDraft) => {
      matches = [next, ...matches.filter((item) => item.id !== next.id)];
      return next;
    },
    saveSettings: async (patch: Partial<UserSettings>) => {
      currentSettings = { ...currentSettings, ...patch };
      return currentSettings;
    }
  } as unknown as RiftLiteStore;
}

describe("RawCaptureService", () => {
  it("stays idle when the feature is disabled", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore(settings({ enabled: false }, replayDirectory));
    const service = new RawCaptureService(store);

    await service.appendFrame(atlasFrame(JSON.stringify({ type: "room_shell_sync" })));

    expect(await service.getStatus()).toMatchObject({
      enabled: false,
      active: false,
      messageCount: 0
    });
  });

  it("ignores TCGA frames even when raw capture is enabled", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore(settings({ enabled: true }, replayDirectory));
    const service = new RawCaptureService(store);

    await service.appendFrame({
      platform: "tcga",
      frame: {
        seq: 0,
        ts: 1781360000000,
        dir: "in",
        raw: JSON.stringify({ type: "room_shell_sync", roomCode: "ABCDE" })
      }
    });

    expect(await service.getStatus()).toMatchObject({
      enabled: true,
      active: false,
      messageCount: 0
    });
  });

  it("persists Atlas raw frames in the RiftReplay payload shape", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore(settings({ enabled: true, visibility: "unlisted" }, replayDirectory));
    const service = new RawCaptureService(store);

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: {
        roomCode: "ABCDE",
        phase: "in_game",
        gameNumber: 1
      }
    })));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "authoritative_snapshot", body: { x: 1 } })));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "chat_message", text: "not replay relevant" })));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "presence_update", hover: { x: 1 } })));

    const saved = await service.finishForReplay(replay());

    expect(saved.rawCapture).toMatchObject({
      provider: "riftlite-v2",
      messageCount: 3,
      roomCode: "ABCDE",
      uploadStatus: "not-uploaded",
      visibility: "unlisted"
    });
    expect(saved.rawCapture?.error).toBeUndefined();
    expect(saved.rawCapture?.localPath).toBeTruthy();

    const rawPayload = JSON.parse(await readFile(saved.rawCapture!.localPath!, "utf8")) as {
      schema: string;
      version: number;
      exportedAt: string;
      capture: {
        identity: { roomCode?: string | null };
        lifecycle: { lastPhase?: string | null; lastGameNumber?: number | null; boundaries: Array<{ reason: string }> };
      };
      script: { name: string; version: string };
      sockets: Array<{ socketId: string; url: string }>;
      filter: { keptCount: number; droppedCount: number; byType: Record<string, { kept: number; dropped: number }> };
      messages: Array<{ seq: number; raw: string; type?: string | null; drop?: boolean; dropReason?: string | null }>;
    };
    expect(rawPayload.schema).toBe("riftreplay-raw-capture");
    expect(rawPayload.version).toBe(1);
    expect(rawPayload.capture.identity.roomCode).toBe("ABCDE");
    expect(rawPayload.capture.lifecycle.lastPhase).toBe("in_game");
    expect(rawPayload.capture.lifecycle.lastGameNumber).toBe(1);
    expect(rawPayload.capture.lifecycle.boundaries.some((item) => item.reason === "session-start")).toBe(true);
    expect(rawPayload.script.name).toBe("RiftLite Raw Capture");
    expect(rawPayload.sockets.length).toBeGreaterThan(0);
    expect(rawPayload.messages.map((message) => message.seq)).toEqual([0, 1, 2, 3]);
    expect(rawPayload.filter.keptCount).toBe(3);
    expect(rawPayload.filter.droppedCount).toBe(1);
    expect(rawPayload.filter.byType.presence_update.dropped).toBe(1);
    expect(rawPayload.messages.at(-1)).toMatchObject({
      type: "presence_update",
      drop: true,
      dropReason: "drop_type:presence_update"
    });
  });

  it("embeds only a perspective-safe two-game BO3 result summary in raw captures and retry manifests", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore(settings({ enabled: true }, replayDirectory));
    const service = new RawCaptureService(store);

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      gameInstanceId: "ROOM1",
      sessionDoc: {
        roomCode: "ROOM1",
        seriesId: "series-bo3-result",
        matchFormat: "bo3",
        phase: "in_game",
        gameNumber: 1
      }
    })));
    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      gameInstanceId: "ROOM2",
      sessionDoc: {
        roomCode: "ROOM2",
        previousRoomCode: "ROOM1",
        seriesId: "series-bo3-result",
        matchFormat: "bo3",
        phase: "sideboarding",
        gameNumber: 2
      }
    })));

    const saved = await service.finishForReplay(
      twoGameBo3Replay(),
      { seriesId: "series-bo3-result" }
    );
    const rawPayload = JSON.parse(await readFile(saved.rawCapture!.localPath!, "utf8")) as {
      capture: { match?: unknown };
    };
    const manifest = JSON.parse(await readFile(
      `${saved.rawCapture!.localPath!}.riftlite-index.json`,
      "utf8"
    )) as { match?: unknown; identity?: Record<string, unknown> };
    const expectedMatch = {
      format: "bo3",
      result: "loss",
      score: { perspective: 0, opponent: 2 },
      games: [{
        gameNumber: 1,
        result: "loss",
        perspectivePoints: 5,
        opponentPoints: 8
      }, {
        gameNumber: 2,
        result: "loss",
        perspectivePoints: 4,
        opponentPoints: 5
      }]
    };

    expect(rawPayload.capture.match).toEqual(expectedMatch);
    expect(manifest.match).toEqual(expectedMatch);
    expect(manifest.identity).not.toHaveProperty("match");
    const serializedMatch = JSON.stringify(rawPayload.capture.match);
    expect(serializedMatch).not.toContain("Private Perspective Player");
    expect(serializedMatch).not.toContain("Private Opponent");
    expect(serializedMatch).not.toContain("Battlefield Must Not Upload");
    expect(serializedMatch).not.toContain("Private Deck Name");
    expect(serializedMatch).not.toContain("PRIVATE_RAW_EVIDENCE");
  });

  it("never uploads when legacy capture is enabled without explicit upload consent", async () => {
    const replayDirectory = await tempReplayDirectory();
    const legacySettings = {
      ...settings({ enabled: true, apiKey: "legacy-api-key", visibility: "public" }, replayDirectory),
      firebaseRefreshToken: "legacy-refresh-token"
    } as UserSettings;
    delete (legacySettings.rawCapture as Partial<UserSettings["rawCapture"]>).uploadEnabled;
    const store = fakeStore(legacySettings);
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "LEGACY", phase: "in_game", gameNumber: 1 }
    })));
    const saved = await service.finishForReplay(replay("legacy-replay", "LEGACY"));
    const manualAttempt = await service.uploadRawCapture(saved.id);
    const pendingCount = await service.uploadPendingRawCaptures();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(saved.rawCapture).toMatchObject({
      uploadStatus: "not-uploaded",
      visibility: "public"
    });
    expect(manualAttempt?.rawCapture).toMatchObject({
      uploadStatus: "disabled",
      error: "Raw replay upload is disabled."
    });
    expect(pendingCount).toBe(0);
  });

  it("does not auto-upload captures after the linked account changes", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore({
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-a"
      }, replayDirectory),
      accountUid: "account-b",
      firebaseRefreshToken: "refresh-token-b"
    } as UserSettings);
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "ACCOUNT-BOUND", phase: "in_game", gameNumber: 1 }
    })));
    const saved = await service.finishForReplay(replay("account-bound", "ACCOUNT-BOUND"));

    expect(saved.rawCapture?.uploadStatus).toBe("not-uploaded");
    expect(await service.uploadPendingRawCaptures()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("persists account-bound auto-upload eligibility and retries an eligible failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore({
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        visibility: "private"
      }, replayDirectory),
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token"
    } as UserSettings);
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired token" }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "id-token", user_id: "account-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "eligible_retry", status: "pending", visibility: "private" },
        uploadRequired: false,
        completeEndpoint: "/api/v2/replays/eligible_retry/complete",
        playerPath: "/replays/eligible_retry"
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "eligible_retry", status: "ready", visibility: "private" },
        playerPath: "/replays/eligible_retry"
      }), { status: 200 }));

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "ELIGIBLE", phase: "in_game", gameNumber: 1 }
    })));
    const initiallyFailed = await service.finishForReplay(replay("eligible-retry", "ELIGIBLE"));

    expect(initiallyFailed.rawCapture).toMatchObject({
      uploadStatus: "failed",
      webReplayAutoUploadEligible: true,
      webReplayAutoUploadAccountUid: "account-1",
      lastUploadAttemptAt: expect.any(String)
    });
    expect(await service.uploadPendingRawCaptures()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-07-10T12:01:59.999Z"));
    expect(await service.uploadPendingRawCaptures()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-07-10T12:02:00.000Z"));
    expect(await service.uploadPendingRawCaptures()).toBe(1);
    const uploaded = (await store.getReplays()).find((item) => item.id === "eligible-retry");
    expect(uploaded?.rawCapture).toMatchObject({
      uploadStatus: "uploaded",
      uploadUrl: "https://www.riftlite.com/replays/eligible_retry",
      webReplayAutoUploadEligible: true,
      webReplayAutoUploadAccountUid: "account-1"
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("prefers never-attempted eligible captures over recent permanent failures in a limited batch", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore({
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        visibility: "private"
      }, replayDirectory),
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token"
    } as UserSettings);
    const service = new RawCaptureService(store);
    const rawDirectory = join(replayDirectory, "Raw Capture");
    await mkdir(rawDirectory, { recursive: true });
    const recentFailurePath = join(rawDirectory, "recent-failure.json");
    const neverAttemptedPath = join(rawDirectory, "never-attempted.json");
    const payload = JSON.stringify({ schema: "riftreplay-raw-capture", version: 1, messages: [] });
    await writeFile(recentFailurePath, payload, "utf8");
    await writeFile(neverAttemptedPath, payload, "utf8");
    await store.saveReplay({
      ...replay("recent-permanent-failure", "RECENT"),
      capturedAt: "2026-07-10T18:00:00.000Z",
      rawCapture: {
        provider: "riftlite-v2",
        captureSessionId: "recent-permanent-capture",
        messageCount: 1,
        uploadStatus: "failed",
        localPath: recentFailurePath,
        visibility: "private",
        webReplayAutoUploadEligible: true,
        webReplayAutoUploadAccountUid: "account-1",
        lastUploadAttemptAt: "2026-07-10T18:05:00.000Z"
      }
    });
    await store.saveReplay({
      ...replay("never-attempted-eligible", "NEVER"),
      capturedAt: "2026-07-09T18:00:00.000Z",
      rawCapture: {
        provider: "riftlite-v2",
        captureSessionId: "never-attempted-capture",
        messageCount: 1,
        uploadStatus: "not-uploaded",
        localPath: neverAttemptedPath,
        visibility: "private",
        webReplayAutoUploadEligible: true,
        webReplayAutoUploadAccountUid: "account-1"
      }
    });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "id-token", user_id: "account-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "never_attempted", status: "pending", visibility: "private" },
        uploadRequired: false,
        completeEndpoint: "/api/v2/replays/never_attempted/complete",
        playerPath: "/replays/never_attempted"
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "never_attempted", status: "ready", visibility: "private" },
        playerPath: "/replays/never_attempted"
      }), { status: 200 }));

    expect(await service.uploadPendingRawCaptures(1)).toBe(1);
    const initBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as { localReplayId?: string };
    expect(initBody.localReplayId).toBe("never-attempted-eligible");
    expect((await store.getReplays()).find((item) => item.id === "recent-permanent-failure")?.rawCapture?.uploadStatus)
      .toBe("failed");
  });

  it("does not make a capture eligible when opt-in starts after its first frame, but allows manual upload", async () => {
    const replayDirectory = await tempReplayDirectory();
    const initialSettings = settings({ enabled: true, visibility: "private" }, replayDirectory);
    const store = fakeStore(initialSettings);
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "PROSPECTIVE", phase: "in_game", gameNumber: 1 }
    })));
    await store.saveSettings({
      rawCapture: {
        ...initialSettings.rawCapture,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1"
      },
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token"
    });
    const saved = await service.finishForReplay({
      ...replay("prospective-opt-in", "PROSPECTIVE"),
      capturedAt: "invalid-capture-time"
    });

    expect(saved.rawCapture).toMatchObject({
      uploadStatus: "not-uploaded",
      webReplayAutoUploadEligible: false
    });
    expect(saved.rawCapture?.webReplayAutoUploadAccountUid).toBeUndefined();
    expect(await service.uploadPendingRawCaptures()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "id-token", user_id: "account-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "manual_prospective", status: "pending", visibility: "private" },
        uploadRequired: false,
        completeEndpoint: "/api/v2/replays/manual_prospective/complete",
        playerPath: "/replays/manual_prospective"
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "manual_prospective", status: "ready", visibility: "private" },
        playerPath: "/replays/manual_prospective"
      }), { status: 200 }));

    await expect(service.uploadRawCaptureToRiftLite(saved.id, "private")).resolves.toMatchObject({
      replayId: "manual_prospective",
      visibility: "private"
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const initBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as { capturedAt?: string };
    expect(initBody.capturedAt).toBe(new Date(1781360000000).toISOString());
  });

  it("does not transfer a session's automatic-upload eligibility to a different account", async () => {
    const replayDirectory = await tempReplayDirectory();
    const accountASettings = {
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-a"
      }, replayDirectory),
      accountUid: "account-a",
      firebaseRefreshToken: "refresh-token-a"
    } as UserSettings;
    const store = fakeStore(accountASettings);
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "ACCOUNT-SWITCH", phase: "in_game", gameNumber: 1 }
    })));
    await store.saveSettings({
      rawCapture: {
        ...accountASettings.rawCapture,
        webReplayAutoUploadAccountUid: "account-b"
      },
      accountUid: "account-b",
      firebaseRefreshToken: "refresh-token-b"
    });

    const saved = await service.finishForReplay(replay("account-switch-session", "ACCOUNT-SWITCH"));
    expect(saved.rawCapture).toMatchObject({
      uploadStatus: "not-uploaded",
      webReplayAutoUploadEligible: false
    });
    expect(saved.rawCapture?.webReplayAutoUploadAccountUid).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a case-only Firebase UID change as a different consenting account", async () => {
    const replayDirectory = await tempReplayDirectory();
    const originalSettings = {
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "FirebaseUserA"
      }, replayDirectory),
      accountUid: "FirebaseUserA",
      firebaseRefreshToken: "refresh-token-a"
    } as UserSettings;
    const store = fakeStore(originalSettings);
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "CASE-SWITCH", phase: "in_game", gameNumber: 1 }
    })));
    await store.saveSettings({
      rawCapture: {
        ...originalSettings.rawCapture,
        webReplayAutoUploadAccountUid: "firebaseusera"
      },
      accountUid: "firebaseusera",
      firebaseRefreshToken: "refresh-token-lowercase"
    });

    const saved = await service.finishForReplay(replay("case-only-account-switch", "CASE-SWITCH"));
    expect(saved.rawCapture).toMatchObject({
      uploadStatus: "not-uploaded",
      webReplayAutoUploadEligible: false
    });
    expect(saved.rawCapture?.webReplayAutoUploadAccountUid).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses private visibility when an incomplete legacy setting has no visibility", async () => {
    const replayDirectory = await tempReplayDirectory();
    const currentSettings = settings({ enabled: true }, replayDirectory);
    delete (currentSettings.rawCapture as Partial<UserSettings["rawCapture"]>).visibility;
    const service = new RawCaptureService(fakeStore(currentSettings));

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "PRIVATE", phase: "in_game", gameNumber: 1 }
    })));
    const saved = await service.finishForReplay(replay("private-default", "PRIVATE"));

    expect(saved.rawCapture?.visibility).toBe("private");
    expect(saved.rawCapture?.uploadStatus).toBe("not-uploaded");
  });

  it("uploads V2 gzip bytes with a checksum and idempotently retries init", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore({
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        visibility: "public"
      }, replayDirectory),
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token"
    } as UserSettings);
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "id-token", user_id: "account-1" }), { status: 200 }))
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "rlr_123", captureId: "capture-123", status: "pending", visibility: "public" },
        uploadRequired: true,
        upload: {
          method: "PUT",
          endpoint: "/api/v2/replays/rlr_123/raw",
          contentType: "application/gzip",
          headers: {}
        },
        completeEndpoint: "/api/v2/replays/rlr_123/complete",
        canonicalEndpoint: "/api/v2/replays/rlr_123",
        playerPath: "/replays/rlr_123"
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "rlr_123", status: "ready", visibility: "public" },
        playerPath: "/replays/rlr_123"
      }), { status: 200 }));

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "ABCDE", phase: "in_game", gameNumber: 1 }
    })));
    const saved = await service.finishForReplay(replay("riftlite-upload-replay"));

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0][0]).toContain("securetoken.googleapis.com");
    expect(fetchMock.mock.calls[1][0]).toBe("https://www.riftlite.com/api/v2/replays/init");
    expect(fetchMock.mock.calls[2][0]).toBe("https://www.riftlite.com/api/v2/replays/init");
    const [, init] = fetchMock.mock.calls[2];
    expect(init?.headers).toMatchObject({
      "Authorization": "Bearer id-token",
      "Content-Type": "application/json"
    });
    expect(init?.redirect).toBe("error");
    const body = JSON.parse(String(init?.body)) as {
      visibility: string;
      captureId: string;
      sha256: string;
      bytes: number;
      localReplayId: string;
      roomCode?: string;
      capturedAt?: string;
    };
    expect(body.visibility).toBe("public");
    expect(body).toMatchObject({
      localReplayId: "riftlite-upload-replay",
      roomCode: "ABCDE",
      capturedAt: "2026-06-29T10:00:00.000Z"
    });
    expect(body.sha256).toMatch(/^[a-f0-9]{64}$/);
    const [, put] = fetchMock.mock.calls[3];
    const gzip = put?.body as Buffer;
    expect(gzip).toBeInstanceOf(Buffer);
    expect(body.bytes).toBe(gzip.byteLength);
    expect(body.sha256).toBe(createHash("sha256").update(gzip).digest("hex"));
    expect(put?.headers).toMatchObject({
      "Authorization": "Bearer id-token",
      "Content-Type": "application/gzip",
      "X-Replay-SHA256": body.sha256,
      "X-Replay-Bytes": String(body.bytes)
    });
    expect(put?.redirect).toBe("error");
    expect(fetchMock.mock.calls[4][1]?.redirect).toBe("error");
    expect(saved.rawCapture?.uploadStatus).toBe("uploaded");
    expect(saved.rawCapture?.processingStatus).toBe("ready");
    expect(saved.rawCapture?.uploadUrl).toBe("https://www.riftlite.com/replays/rlr_123");
    expect(saved.rawCapture?.uploadId).toBe("rlr_123");

    fetchMock.mockRestore();
  });

  it("requires a linked account and rejects an anonymous or mismatched Firebase owner", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore({
      ...settings({ enabled: true, uploadEnabled: true }, replayDirectory),
      firebaseRefreshToken: "anonymous-refresh-token"
    } as UserSettings);
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "OWNER", phase: "in_game", gameNumber: 1 }
    })));
    const saved = await service.finishForReplay(replay("owner-replay", "OWNER"));

    expect(fetchMock).not.toHaveBeenCalled();
    await expect(service.uploadRawCaptureToRiftLite(saved.id))
      .rejects.toThrow("Link your RiftLite account");

    await store.saveSettings({
      accountUid: "linked-account",
      firebaseRefreshToken: "linked-refresh-token"
    });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      id_token: "wrong-owner-token",
      user_id: "different-account"
    }), { status: 200 }));

    await expect(service.uploadRawCaptureToRiftLite(saved.id))
      .rejects.toThrow("Could not refresh RiftLite account token");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uploads opted-in hub replays as unlisted and posts the link to Discord", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore({
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        webReplayDiscordShareEnabled: true,
        webReplayDiscordShareAccountUid: "account-1",
        webReplayDiscordShareHubIds: ["hub-1"],
        visibility: "private"
      }, replayDirectory),
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token",
      activeHubs: [{ id: "hub-1", name: "Team UK", sync: true, role: "member" }]
    } as UserSettings);
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "id-token", user_id: "account-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "rl2_discord", status: "uploading", visibility: "unlisted" },
        uploadRequired: true,
        upload: { endpoint: "/api/v2/replays/rl2_discord/raw" },
        completeEndpoint: "/api/v2/replays/rl2_discord/complete",
        playerPath: "/replays/rl2_discord"
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "rl2_discord", status: "ready", visibility: "unlisted" },
        playerPath: "/replays/rl2_discord"
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        visibility: "unlisted",
        results: [{ hubId: "hub-1", status: "shared" }]
      }), { status: 200 }));

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "DISCORD", phase: "in_game", gameNumber: 1 }
    })));
    const saved = await service.finishForReplay(oneGameBo1Replay("discord-share", "DISCORD"));

    const initBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as { visibility: string };
    expect(initBody.visibility).toBe("unlisted");
    expect(fetchMock.mock.calls[4][0]).toBe("https://www.riftlite.com/api/v2/replays/rl2_discord/share-discord");
    expect(JSON.parse(String(fetchMock.mock.calls[4][1]?.body))).toEqual({ hubIds: ["hub-1"] });
    expect(saved.rawCapture).toMatchObject({
      uploadStatus: "uploaded",
      visibility: "unlisted",
      discordShareStatus: "shared",
      discordSharedHubIds: ["hub-1"]
    });
  });

  it("waits for a finalized local score before creating and sharing an automatic Discord replay", async () => {
    vi.useFakeTimers();
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore({
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        webReplayDiscordShareEnabled: true,
        webReplayDiscordShareAccountUid: "account-1",
        webReplayDiscordShareHubIds: ["hub-1"],
        visibility: "private"
      }, replayDirectory),
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token",
      activeHubs: [{ id: "hub-1", name: "Team UK", sync: true, role: "member" }]
    } as UserSettings);
    const service = new RawCaptureService(store);
    const incomplete = oneGameBo1Replay("delayed-discord-score", "DELAYED", "Incomplete");
    await store.saveMatch(incomplete.matchSnapshot!);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "id-token", user_id: "account-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "rl2_delayed", status: "uploading", visibility: "unlisted" },
        uploadRequired: true,
        upload: { endpoint: "/api/v2/replays/rl2_delayed/raw" },
        completeEndpoint: "/api/v2/replays/rl2_delayed/complete",
        playerPath: "/replays/rl2_delayed"
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "rl2_delayed", status: "ready", visibility: "unlisted" },
        playerPath: "/replays/rl2_delayed"
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        visibility: "unlisted",
        results: [{ hubId: "hub-1", status: "shared" }]
      }), { status: 200 }));

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "DELAYED", phase: "in_game", gameNumber: 1 }
    })));
    setTimeout(() => {
      void store.saveMatch(oneGameBo1Replay("delayed-discord-score", "DELAYED", "Win").matchSnapshot!);
    }, 17_000);
    const finishPromise = service.finishForReplay(incomplete);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_501);
    const saved = await finishPromise;

    const uploaded = gunzipSync(Buffer.from(fetchMock.mock.calls[2][1]?.body as Uint8Array)).toString("utf8");
    expect(JSON.parse(uploaded).capture.match).toEqual({
      format: "bo1",
      result: "win",
      score: { perspective: 1, opponent: 0 },
      games: [{ gameNumber: 1, result: "win", perspectivePoints: 4, opponentPoints: 4 }]
    });
    expect(fetchMock.mock.calls[4][0]).toBe("https://www.riftlite.com/api/v2/replays/rl2_delayed/share-discord");
    expect(saved.rawCapture).toMatchObject({
      uploadStatus: "uploaded",
      processingStatus: "ready",
      discordShareStatus: "shared"
    });
  });

  it("explicitly converts an existing private replay to Unlisted and posts it to the selected hub", async () => {
    const replayDirectory = await tempReplayDirectory();
    const initialSettings = {
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        visibility: "private"
      }, replayDirectory),
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token",
      activeHubs: [{ id: "teamuk", name: "TeamUK", sync: true, role: "member" }]
    } as UserSettings;
    const store = fakeStore(initialSettings);
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "id-token", user_id: "account-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "rl2_existing_private", status: "uploading", visibility: "private" },
        uploadRequired: false,
        completeEndpoint: "/api/v2/replays/rl2_existing_private/complete",
        playerPath: "/replays/rl2_existing_private"
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "rl2_existing_private", status: "ready", visibility: "private" },
        playerPath: "/replays/rl2_existing_private"
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "id-token", user_id: "account-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        visibility: "unlisted",
        results: [{ hubId: "teamuk", status: "shared" }]
      }), { status: 200 }));

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "MANUAL-SHARE", phase: "in_game", gameNumber: 1 }
    })));
    const saved = await service.finishForReplay(replay("manual-discord-share", "MANUAL-SHARE"));
    expect(saved.rawCapture).toMatchObject({
      visibility: "private",
      uploadId: "rl2_existing_private",
      webReplayDiscordShareEligible: false
    });

    await store.saveSettings({
      ...initialSettings,
      rawCapture: {
        ...initialSettings.rawCapture,
        webReplayDiscordShareEnabled: true,
        webReplayDiscordShareAccountUid: "account-1",
        webReplayDiscordShareHubIds: ["teamuk"],
        visibility: "unlisted"
      }
    });
    await expect(service.shareRawCaptureToDiscord(saved.id)).resolves.toMatchObject({
      replayId: "rl2_existing_private",
      visibility: "unlisted",
      status: "shared",
      sharedHubIds: ["teamuk"]
    });

    expect(fetchMock.mock.calls[4][0]).toBe(
      "https://www.riftlite.com/api/v2/replays/rl2_existing_private/share-discord"
    );
    expect(JSON.parse(String(fetchMock.mock.calls[4][1]?.body))).toEqual({ hubIds: ["teamuk"] });
    expect((await store.getReplays()).find((item) => item.id === saved.id)?.rawCapture).toMatchObject({
      visibility: "unlisted",
      webReplayDiscordShareEligible: true,
      webReplayDiscordShareHubIds: ["teamuk"],
      discordShareStatus: "shared",
      discordSharedHubIds: ["teamuk"]
    });
  });

  it("reconciles an existing server replay to the newly requested private visibility", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore({
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        visibility: "private"
      }, replayDirectory),
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token"
    } as UserSettings);
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "id-token", user_id: "account-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "rl2_existing", status: "uploading", visibility: "public" },
        uploadRequired: false,
        completeEndpoint: "/api/v2/replays/rl2_existing/complete",
        playerPath: "/replays/rl2_existing"
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "rl2_existing", status: "uploading", visibility: "private" }
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "rl2_existing", status: "ready", visibility: "private" },
        playerPath: "/replays/rl2_existing"
      }), { status: 200 }));

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "VISIBILITY", phase: "in_game", gameNumber: 1 }
    })));
    const saved = await service.finishForReplay(replay("visibility-retry", "VISIBILITY"));

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2][0]).toBe("https://www.riftlite.com/api/v2/replays/rl2_existing");
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "PATCH", redirect: "error" });
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ visibility: "private" });
    expect(saved.rawCapture).toMatchObject({ visibility: "private", uploadStatus: "uploaded" });
  });

  it("stops a first-party upload when the linked account changes after init", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore({
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        visibility: "public"
      }, replayDirectory),
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token-1"
    } as UserSettings);
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id_token: "id-token-1",
        user_id: "account-1"
      }), { status: 200 }))
      .mockImplementationOnce(async () => {
        await store.saveSettings({
          accountUid: "account-2",
          firebaseRefreshToken: "refresh-token-2"
        });
        return new Response(JSON.stringify({
          replay: { replayId: "rl2_account_race", status: "uploading", visibility: "public" },
          uploadRequired: true,
          upload: { endpoint: "/api/v2/replays/rl2_account_race/raw" },
          completeEndpoint: "/api/v2/replays/rl2_account_race/complete"
        }), { status: 200 });
      });

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "ACCOUNT-RACE", phase: "in_game", gameNumber: 1 }
    })));
    const saved = await service.finishForReplay(replay("account-race", "ACCOUNT-RACE"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(saved.rawCapture).toMatchObject({
      uploadStatus: "failed",
      processingStatus: "failed"
    });
    expect(saved.rawCapture?.error).toContain("linked RiftLite account changed");
  });

  it("stops an automatic upload when opt-in is disabled after init", async () => {
    const replayDirectory = await tempReplayDirectory();
    const initialSettings = {
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        visibility: "private"
      }, replayDirectory),
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token"
    } as UserSettings;
    const store = fakeStore(initialSettings);
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id_token: "id-token",
        user_id: "account-1"
      }), { status: 200 }))
      .mockImplementationOnce(async () => {
        await store.saveSettings({
          rawCapture: {
            ...initialSettings.rawCapture,
            webReplayAutoUploadEnabled: false
          }
        });
        return new Response(JSON.stringify({
          replay: { replayId: "rl2_disabled_race", status: "pending", visibility: "private" },
          uploadRequired: false,
          completeEndpoint: "/api/v2/replays/rl2_disabled_race/complete",
          playerPath: "/replays/rl2_disabled_race"
        }), { status: 200 });
      });

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "DISABLE-RACE", phase: "in_game", gameNumber: 1 }
    })));
    const saved = await service.finishForReplay(replay("disable-race", "DISABLE-RACE"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(saved.rawCapture).toMatchObject({
      uploadStatus: "failed",
      webReplayAutoUploadEligible: true,
      webReplayAutoUploadAccountUid: "account-1"
    });
    expect(saved.rawCapture?.error).toContain("automatic upload was disabled");
  });

  it("marks captures over the website gzip limit as too large and never retries them", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore({
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1"
      }, replayDirectory),
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token"
    } as UserSettings);
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "OVERSIZE", phase: "in_game", gameNumber: 1 }
    })));
    for (let index = 0; index < 5; index += 1) {
      await service.appendFrame(atlasFrame(JSON.stringify({
        type: "authoritative_patch_commit",
        payload: randomBytes(1_000_000).toString("base64")
      })));
    }

    const saved = await service.finishForReplay(replay("oversize-replay", "OVERSIZE"));

    expect(saved.rawCapture).toMatchObject({
      uploadStatus: "too-large",
      processingStatus: "failed"
    });
    expect(saved.rawCapture?.compressedBytes).toBeGreaterThan(4 * 1024 * 1024);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await service.uploadPendingRawCaptures()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps one Atlas BO3 raw session across per-game room code changes", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore(settings({ enabled: true }, replayDirectory));
    const service = new RawCaptureService(store);

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      gameInstanceId: "ROOM1",
      sessionDoc: {
        roomCode: "ROOM1",
        seriesId: "series-abc",
        matchId: "atlas-game-1",
        captureSessionId: "atlas-capture-1",
        phase: "in_game",
        matchFormat: "bo3",
        gameNumber: 1
      }
    })));
    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "authoritative_patch_commit",
      gameInstanceId: "ROOM1",
      patch: { operations: [{ op: "log_insert", entries: [{ text: "Game 1 action." }] }] }
    })));
    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      gameInstanceId: "ROOM2",
      sessionDoc: {
        roomCode: "ROOM2",
        previousRoomCode: "ROOM1",
        seriesId: "series-abc",
        matchId: "atlas-game-2",
        captureSessionId: "atlas-capture-2",
        phase: "sideboarding",
        matchFormat: "bo3",
        gameNumber: 2
      }
    })));
    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      gameInstanceId: "ROOM3",
      sessionDoc: {
        roomCode: "ROOM3",
        previousRoomCode: "ROOM2",
        seriesId: "series-abc",
        matchId: "atlas-game-3",
        captureSessionId: "atlas-capture-3",
        phase: "in_game",
        matchFormat: "bo3",
        gameNumber: 3
      }
    })));

    const saved = await service.finishForReplay(replay("bo3-replay", "ROOM3"));

    expect(saved.rawCapture?.messageCount).toBe(4);
    expect(saved.rawCapture?.roomCode).toBe("ROOM1");
    expect(saved.rawCapture?.roomCodes).toEqual(["ROOM1", "ROOM2", "ROOM3"]);
    expect(saved.rawCapture?.seriesId).toBe("series-abc");
    expect(saved.rawCapture?.matchIds).toEqual(["atlas-game-1", "atlas-game-2", "atlas-game-3"]);

    const rawPayload = JSON.parse(await readFile(saved.rawCapture!.localPath!, "utf8")) as {
      capture: {
        identity: { roomCode?: string | null; roomCodes?: string[]; seriesId?: string | null };
        lifecycle: {
          boundaries: Array<{ reason: string }>;
          phases: Array<{ phase: string; gameNumber: number | null; source: { fromSeq: number; toSeq: number } }>;
          games: Array<{
            gameNumber: number;
            matchIds: string[];
            source: { fromSeq: number; toSeq: number };
            phases: Array<{ phase: string }>;
          }>;
        };
      };
      messages: Array<{ type?: string | null }>;
    };
    expect(rawPayload.capture.identity.roomCode).toBe("ROOM1");
    expect(rawPayload.capture.identity.roomCodes).toEqual(["ROOM1", "ROOM2", "ROOM3"]);
    expect(rawPayload.capture.identity.seriesId).toBe("series-abc");
    expect(rawPayload.capture.lifecycle.boundaries.map((item) => item.reason)).toContain("room-code-change:ROOM1->ROOM2");
    expect(rawPayload.capture.lifecycle.boundaries.map((item) => item.reason)).toContain("room-code-change:ROOM2->ROOM3");
    expect(rawPayload.capture.lifecycle.phases).toEqual([
      expect.objectContaining({ phase: "in_game", gameNumber: 1, source: { fromSeq: 0, toSeq: 1 } }),
      expect.objectContaining({ phase: "sideboarding", gameNumber: 2, source: { fromSeq: 2, toSeq: 2 } }),
      expect.objectContaining({ phase: "in_game", gameNumber: 3, source: { fromSeq: 3, toSeq: 3 } })
    ]);
    expect(rawPayload.capture.lifecycle.games.map((game) => ({
      gameNumber: game.gameNumber,
      matchIds: game.matchIds,
      source: game.source,
      phases: game.phases.map((phase) => phase.phase)
    }))).toEqual([
      { gameNumber: 1, matchIds: ["atlas-game-1"], source: { fromSeq: 0, toSeq: 1 }, phases: ["in_game"] },
      { gameNumber: 2, matchIds: ["atlas-game-2"], source: { fromSeq: 2, toSeq: 2 }, phases: ["sideboarding"] },
      { gameNumber: 3, matchIds: ["atlas-game-3"], source: { fromSeq: 3, toSeq: 3 }, phases: ["in_game"] }
    ]);
    expect(rawPayload.messages).toHaveLength(4);
  });

  it("merges identity-free BO3 prelude frames when authoritative series identity arrives", async () => {
    const replayDirectory = await tempReplayDirectory();
    const service = new RawCaptureService(fakeStore(settings({ enabled: true }, replayDirectory)));

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      gameInstanceId: "ROOM1",
      sessionDoc: {
        roomCode: "ROOM1",
        seriesId: "series-continuation",
        matchFormat: "bo3",
        phase: "in_game",
        gameNumber: 1
      }
    })));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "room_shell_leave", gameInstanceId: "ROOM1" })));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "search", playMode: "constructed" })));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "searching", roomCode: "ROOM2" })));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "matched", roomCode: "ROOM2", matchFormat: "bo3" })));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "join_shell", gameInstanceId: "ROOM2" })));
    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      gameInstanceId: "ROOM2",
      sessionDoc: {
        roomCode: "ROOM2",
        seriesId: "series-continuation",
        matchFormat: "bo3",
        phase: "sideboarding",
        gameNumber: 2
      }
    })));

    const saved = await service.finishForReplay(
      replay("bo3-prelude", "ROOM2"),
      { seriesId: "series-continuation" }
    );
    const payload = await service.getRawCapturePayload(saved.id) as {
      capture: { identity: { roomCodes: string[] }; lifecycle: { boundaries: Array<{ reason: string }> } };
      messages: Array<{ type: string }>;
    };

    expect(payload.messages.map((frame) => frame.type)).toEqual([
      "room_shell_sync",
      "room_shell_leave",
      "search",
      "searching",
      "matched",
      "join_shell",
      "room_shell_sync"
    ]);
    expect(payload.capture.identity.roomCodes).toEqual(["ROOM1", "ROOM2"]);
    expect(payload.capture.lifecycle.boundaries.map((item) => item.reason)).toContain(
      "room-code-change:ROOM1->ROOM2"
    );
    expect(await service.getStatus()).toMatchObject({ active: false });
  });

  it("starts identity-free matchmaking frames in a new capture instead of the prior match", async () => {
    const replayDirectory = await tempReplayDirectory();
    const service = new RawCaptureService(fakeStore(settings({ enabled: true }, replayDirectory)));

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      gameInstanceId: "OLD",
      sessionDoc: { roomCode: "OLD", seriesId: "series-old", matchFormat: "bo1", phase: "in_game", gameNumber: 1 }
    })));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "room_shell_leave", gameInstanceId: "OLD" })));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "search", playMode: "constructed" })));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "searching", roomCode: "NEW" })));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "matched", roomCode: "NEW", matchFormat: "bo1" })));
    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      gameInstanceId: "NEW",
      sessionDoc: { roomCode: "NEW", seriesId: "series-new", matchFormat: "bo1", phase: "in_game", gameNumber: 1 }
    })));

    const savedOld = await service.finishForReplay(replay("old-replay", "OLD"), { seriesId: "series-old" });
    const oldPayload = await service.getRawCapturePayload(savedOld.id) as { messages: Array<{ type: string }> };
    expect(oldPayload.messages.map((frame) => frame.type)).toEqual(["room_shell_sync", "room_shell_leave"]);

    const savedNew = await service.finishForReplay(replay("new-replay", "NEW"), { seriesId: "series-new" });
    const newPayload = await service.getRawCapturePayload(savedNew.id) as { messages: Array<{ type: string }> };
    expect(newPayload.messages.map((frame) => frame.type)).toEqual([
      "search",
      "searching",
      "matched",
      "room_shell_sync"
    ]);
  });

  it("uniquely attaches an identity-free current-protocol session by its match time window", async () => {
    const replayDirectory = await tempReplayDirectory();
    const service = new RawCaptureService(fakeStore(settings({ enabled: true }, replayDirectory)));
    const startedAt = Date.parse("2026-07-10T14:44:18.133Z");
    const completedAt = Date.parse("2026-07-10T15:03:31.286Z");

    await service.appendFrame(atlasFrame(JSON.stringify({ type: "search" }), { ts: startedAt - 20_000 }));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "searching" }), { ts: startedAt - 5_000 }));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "matched" }), { ts: startedAt + 1_000 }));
    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "authoritative_patch_commit",
      patch: { operations: [] }
    }), { ts: completedAt - 10_000 }));
    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "authoritative_snapshot",
      snapshot: { turn: 12 }
    }), { ts: completedAt - 1_000 }));

    const saved = await service.finishCapture({
      platform: "atlas",
      localMatchId: "local-current-protocol-match",
      localReplayId: "identity-free-current-protocol",
      capturedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString()
    }, {
      ...replay("identity-free-current-protocol", ""),
      matchId: "local-current-protocol-match",
      capturedAt: new Date(startedAt).toISOString()
    });

    expect(saved?.rawCapture).toMatchObject({
      messageCount: 5,
      uploadStatus: "not-uploaded"
    });
    expect(saved?.rawCapture?.roomCode).toBeUndefined();
    const payload = await service.getRawCapturePayload("identity-free-current-protocol") as {
      messages: Array<{ type: string }>;
    };
    expect(payload.messages.map((frame) => frame.type)).toEqual([
      "search",
      "searching",
      "matched",
      "authoritative_patch_commit",
      "authoritative_snapshot"
    ]);
    expect(await service.getStatus()).toMatchObject({ active: false });
  });

  it("attaches the unique room-backed Atlas session when DOM finish evidence has no remote identity", async () => {
    const replayDirectory = await tempReplayDirectory();
    const service = new RawCaptureService(fakeStore(settings({ enabled: true }, replayDirectory)));
    const startedAt = Date.parse("2026-07-10T17:22:00.000Z");
    const completedAt = Date.parse("2026-07-10T17:37:00.000Z");

    await service.appendFrame(atlasFrame(JSON.stringify({ type: "search" }), { ts: startedAt - 20_000 }));
    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "matched",
      roomCode: "BLD4G",
      matchFormat: "bo1"
    }), { ts: startedAt - 5_000 }));
    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      gameInstanceId: "BLD4G",
      sessionDoc: { roomCode: "BLD4G", phase: "in_game", gameNumber: 1 }
    }), { ts: startedAt + 1_000 }));
    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "authoritative_patch_commit",
      patch: { operations: [] }
    }), { ts: completedAt - 1_000 }));

    const saved = await service.finishCapture({
      platform: "atlas",
      localMatchId: "local-akali-mirror",
      localReplayId: "akali-mirror-replay",
      capturedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString()
    }, {
      ...replay("akali-mirror-replay", ""),
      matchId: "local-akali-mirror",
      capturedAt: new Date(startedAt).toISOString()
    });

    expect(saved?.rawCapture).toMatchObject({
      roomCode: "BLD4G",
      messageCount: 4,
      uploadStatus: "not-uploaded"
    });
    const payload = await service.getRawCapturePayload("akali-mirror-replay") as {
      messages: Array<{ type: string }>;
    };
    expect(payload.messages.map((frame) => frame.type)).toEqual([
      "search",
      "matched",
      "room_shell_sync",
      "authoritative_patch_commit"
    ]);
    expect(await service.getStatus()).toMatchObject({ active: false, lastError: undefined });
  });

  it("refuses an ambiguous temporal match between two room-backed sessions", async () => {
    const replayDirectory = await tempReplayDirectory();
    const service = new RawCaptureService(fakeStore(settings({ enabled: true }, replayDirectory)));
    const startedAt = Date.parse("2026-07-10T16:00:00.000Z");
    const completedAt = Date.parse("2026-07-10T16:20:00.000Z");

    await service.appendFrame(atlasFrame(JSON.stringify({ type: "matched", roomCode: "ROOM-A" }), {
      ts: startedAt + 1_000,
      requestUrl: "wss://riftatlas.example/session-a",
      socketId: "session-a"
    }));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "authoritative_snapshot" }), {
      ts: completedAt - 1_000,
      requestUrl: "wss://riftatlas.example/session-a",
      socketId: "session-a"
    }));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "matched", roomCode: "ROOM-B" }), {
      ts: startedAt + 2_000,
      requestUrl: "wss://riftatlas.example/session-b",
      socketId: "session-b"
    }));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "authoritative_snapshot" }), {
      ts: completedAt - 2_000,
      requestUrl: "wss://riftatlas.example/session-b",
      socketId: "session-b"
    }));

    const saved = await service.finishCapture({
      platform: "atlas",
      localMatchId: "ambiguous-local-match",
      capturedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString()
    }, {
      ...replay("ambiguous-temporal-replay", ""),
      matchId: "ambiguous-local-match",
      capturedAt: new Date(startedAt).toISOString()
    });

    expect(saved?.rawCapture).toBeUndefined();
    expect(await service.getStatus()).toMatchObject({
      active: true,
      lastError: "Raw capture was not attached because no unique active session matched the replay identity and time window."
    });
  });

  it("refuses a stale room-backed session outside the final match window", async () => {
    const replayDirectory = await tempReplayDirectory();
    const service = new RawCaptureService(fakeStore(settings({ enabled: true }, replayDirectory)));
    const startedAt = Date.parse("2026-07-10T18:00:00.000Z");
    const completedAt = Date.parse("2026-07-10T18:20:00.000Z");

    await service.appendFrame(atlasFrame(JSON.stringify({ type: "matched", roomCode: "STALE" }), {
      ts: startedAt - 30 * 60_000
    }));
    await service.appendFrame(atlasFrame(JSON.stringify({ type: "authoritative_snapshot" }), {
      ts: startedAt - 20 * 60_000
    }));

    const saved = await service.finishCapture({
      platform: "atlas",
      localMatchId: "stale-local-match",
      capturedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString()
    }, {
      ...replay("stale-temporal-replay", ""),
      matchId: "stale-local-match",
      capturedAt: new Date(startedAt).toISOString()
    });

    expect(saved?.rawCapture).toBeUndefined();
    expect(await service.getStatus()).toMatchObject({ active: true, messageCount: 2 });
  });

  it("finalizes raw capture without a video replay and attaches its persistent index later", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore(settings({ enabled: true }, replayDirectory));
    const service = new RawCaptureService(store);

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: {
        roomCode: "RAW-ONLY",
        seriesId: "series-raw-only",
        matchId: "atlas-game-raw-only",
        phase: "in_game",
        gameNumber: 1
      }
    })));

    const finalized = await service.finishCapture({
      platform: "atlas",
      seriesId: "series-raw-only",
      matchId: "atlas-game-raw-only",
      localMatchId: "local-match-raw-only",
      title: "Raw only match",
      match: {
        format: "bo1",
        result: "win",
        score: { perspective: 1, opponent: 0 },
        games: [{ gameNumber: 1, result: "win", perspectivePoints: 8, opponentPoints: 5 }]
      }
    });

    expect(finalized).toBeNull();
    expect(await store.getReplays()).toEqual([]);
    const rawDirectory = join(replayDirectory, "Raw Capture");
    const rawFiles = await readdir(rawDirectory);
    expect(rawFiles.some((name) => name.endsWith(".riftlite-index.json"))).toBe(true);
    const rawPayloadPath = join(rawDirectory, rawFiles.find((name) => (
      name.endsWith(".json") && !name.endsWith(".riftlite-index.json")
    ))!);
    const rawPayload = JSON.parse(await readFile(rawPayloadPath, "utf8")) as {
      capture: { match?: unknown };
    };
    expect(rawPayload.capture.match).toEqual({
      format: "bo1",
      result: "win",
      score: { perspective: 1, opponent: 0 },
      games: [{ gameNumber: 1, result: "win", perspectivePoints: 8, opponentPoints: 5 }]
    });

    const attached = await service.finishForReplay({
      ...replay("replay-raw-only", "RAW-ONLY"),
      matchId: "local-match-raw-only"
    }, { seriesId: "series-raw-only" });

    expect(attached.rawCapture).toMatchObject({
      captureSessionId: expect.any(String),
      seriesId: "series-raw-only",
      matchIds: ["atlas-game-raw-only"],
      uploadStatus: "not-uploaded"
    });
    expect(await store.getReplays()).toHaveLength(1);
  });

  it("does not backfill match metadata into an artifact that is already uploaded", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore(settings({ enabled: true }, replayDirectory));
    const service = new RawCaptureService(store);

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: {
        roomCode: "IMMUTABLE",
        seriesId: "series-immutable",
        phase: "in_game",
        gameNumber: 1
      }
    })));
    await service.finishCapture({
      platform: "atlas",
      seriesId: "series-immutable",
      localMatchId: "match-1",
      title: "Already uploaded"
    });

    const rawDirectory = join(replayDirectory, "Raw Capture");
    const files = await readdir(rawDirectory);
    const rawPath = join(rawDirectory, files.find((name) => (
      name.endsWith(".json") && !name.endsWith(".riftlite-index.json")
    ))!);
    const indexPath = `${rawPath}.riftlite-index.json`;
    const before = await readFile(rawPath, "utf8");
    const manifest = JSON.parse(await readFile(indexPath, "utf8")) as {
      metadata: Record<string, unknown>;
    };
    manifest.metadata.uploadStatus = "uploaded";
    manifest.metadata.processingStatus = "ready";
    await writeFile(indexPath, JSON.stringify(manifest), "utf8");

    const attached = await service.finishForReplay(
      twoGameBo3Replay("immutable-replay", "IMMUTABLE"),
      { seriesId: "series-immutable" }
    );

    expect(attached.rawCapture?.uploadStatus).toBe("uploaded");
    expect(await readFile(rawPath, "utf8")).toBe(before);
    const payload = JSON.parse(before) as { capture: { match?: unknown } };
    expect(payload.capture.match).toBeUndefined();
    const updatedManifest = JSON.parse(await readFile(indexPath, "utf8")) as { match?: unknown };
    expect(updatedManifest.match).toBeUndefined();
  });

  it("retains the live session when atomic persistence fails and can retry safely", async () => {
    const replayDirectory = await tempReplayDirectory();
    const blockedReplayDirectory = join(replayDirectory, "not-a-directory");
    await writeFile(blockedReplayDirectory, "blocked", "utf8");
    const store = fakeStore(settings({ enabled: true }, blockedReplayDirectory));
    const service = new RawCaptureService(store);

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "RETRY", seriesId: "series-retry", phase: "in_game", gameNumber: 1 }
    })));
    await expect(service.finishForReplay(replay("retry-persist", "RETRY"), { seriesId: "series-retry" }))
      .rejects.toThrow();
    expect(await service.getStatus()).toMatchObject({ active: true, messageCount: 1 });

    const validReplayDirectory = join(replayDirectory, "valid");
    await store.saveSettings({ replayDirectory: validReplayDirectory });
    const saved = await service.finishForReplay(
      replay("retry-persist", "RETRY"),
      { seriesId: "series-retry" }
    );
    expect(saved.rawCapture?.localPath).toContain(validReplayDirectory);
    const files = await readdir(join(validReplayDirectory, "Raw Capture"));
    expect(files.some((name) => name.endsWith(".tmp"))).toBe(false);
    expect(await service.getStatus()).toMatchObject({ active: false });
  });

  it("keeps captures bound to their match across delayed and out-of-order replay finalization", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore(settings({ enabled: true }, replayDirectory));
    const service = new RawCaptureService(store);

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "ROOM-A", matchId: "atlas-match-a", phase: "in_game", gameNumber: 1 }
    })));
    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "authoritative_patch_commit",
      roomCode: "ROOM-A",
      matchId: "atlas-match-a",
      patch: { label: "A-only" }
    })));
    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "ROOM-B", matchId: "atlas-match-b", phase: "in_game", gameNumber: 1 }
    })));
    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "authoritative_patch_commit",
      roomCode: "ROOM-B",
      matchId: "atlas-match-b",
      patch: { label: "B-only" }
    })));

    const unrelated = await service.finishForReplay(replay("unrelated", "ROOM-X"));
    expect(unrelated.rawCapture).toBeUndefined();

    const savedA = await service.finishForReplay(
      replay("delayed-a", ""),
      { matchId: "atlas-match-a" }
    );
    expect(savedA.rawCapture).toMatchObject({ roomCode: "ROOM-A", messageCount: 2 });
    expect(await service.getStatus()).toMatchObject({ active: true, messageCount: 2 });

    const payloadA = await service.getRawCapturePayload(savedA.id) as {
      capture: { identity: { matchId?: string | null } };
      messages: Array<{ raw: string }>;
    };
    expect(payloadA.capture.identity.matchId).toBe("atlas-match-a");
    expect(payloadA.messages.every((frame) => frame.raw.includes("ROOM-A"))).toBe(true);
    expect(payloadA.messages.some((frame) => frame.raw.includes("ROOM-B"))).toBe(false);

    const savedB = await service.finishForReplay(
      replay("delayed-b", ""),
      { matchId: "atlas-match-b" }
    );
    expect(savedB.rawCapture).toMatchObject({ roomCode: "ROOM-B", messageCount: 2 });
    expect(await service.getStatus()).toMatchObject({ active: false, messageCount: 0 });

    const payloadB = await service.getRawCapturePayload(savedB.id) as {
      messages: Array<{ raw: string }>;
    };
    expect(payloadB.messages.every((frame) => frame.raw.includes("ROOM-B"))).toBe(true);
    expect(payloadB.messages.some((frame) => frame.raw.includes("ROOM-A"))).toBe(false);
  });

  it("marks manual upload as not uploaded when the API key is missing", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore(settings({ enabled: true, uploadEnabled: true }, replayDirectory));
    const service = new RawCaptureService(store);

    await service.appendFrame(atlasFrame(JSON.stringify({ type: "room_shell_sync", roomCode: "ABCDE" })));
    const saved = await service.finishForReplay(replay());
    const uploaded = await service.uploadRawCapture(saved.id);

    expect(uploaded?.rawCapture?.uploadStatus).toBe("not-uploaded");
    expect(uploaded?.rawCapture?.error).toBe("RiftReplay API key is missing.");
  });

  it("uploads the RiftReplay payload as gzip with the expected headers", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore(settings({ enabled: true, uploadEnabled: true, apiKey: "rr-secret" }, replayDirectory));
    const service = new RawCaptureService(store);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      replayId: "rp_123",
      url: "https://test.riftreplay.com/rl/rp_123"
    }), { status: 201 }));

    await service.appendFrame(atlasFrame(JSON.stringify({
      type: "room_shell_sync",
      sessionDoc: { roomCode: "ABCDE", phase: "lobby", gameNumber: 1 }
    })));
    const saved = await service.finishForReplay(replay());

    expect(saved.rawCapture?.uploadStatus).toBe("uploaded");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      "Authorization": "Bearer rr-secret",
      "Content-Type": "application/json",
      "Content-Encoding": "gzip"
    });
    const body = init?.body;
    expect(body).toBeInstanceOf(Buffer);
    const payload = JSON.parse(gunzipSync(body as Buffer).toString("utf8")) as { schema: string; messages: unknown[] };
    expect(payload.schema).toBe("riftreplay-raw-capture");
    expect(payload.messages.length).toBe(1);

    fetchMock.mockRestore();
  });

  it("retries pending RiftReplay uploads for saved raw sidecars", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore(settings({ enabled: true, uploadEnabled: true, apiKey: "rr-secret" }, replayDirectory));
    const service = new RawCaptureService(store);
    const rawPath = join(replayDirectory, "pending-sidecar.json");
    await writeFile(rawPath, JSON.stringify({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "pending-capture",
        identity: { roomCode: "PEND1", firstSeenAt: 1781360000000, lastSeenAt: 1781360001000 },
        lifecycle: { lastPhase: "in_game", lastGameNumber: 1, boundaries: [] }
      },
      messages: [atlasFrame(JSON.stringify({ type: "room_shell_sync", roomCode: "PEND1" })).frame],
      meta: { visibility: "private" }
    }), "utf8");
    await store.saveReplay({
      ...replay("pending-replay"),
      rawCapture: {
        provider: "riftreplay",
        captureSessionId: "pending-capture",
        messageCount: 1,
        firstSeenAt: 1781360000000,
        lastSeenAt: 1781360001000,
        roomCode: "PEND1",
        uploadStatus: "not-uploaded",
        localPath: rawPath,
        visibility: "private"
      }
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      replayId: "rp_pending",
      url: "https://test.riftreplay.com/rl/rp_pending"
    }), { status: 201 }));

    const uploaded = await service.uploadPendingRawCaptures();
    const saved = (await store.getReplays()).find((item) => item.id === "pending-replay");

    expect(uploaded).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(saved?.rawCapture?.uploadStatus).toBe("uploaded");
    expect(saved?.rawCapture?.uploadUrl).toBe("https://test.riftreplay.com/rl/rp_pending");

    fetchMock.mockRestore();
  });

  it("does not auto-migrate legacy replay or orphan sidecars with undefined eligibility", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore({
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        visibility: "private"
      }, replayDirectory),
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token"
    } as UserSettings);
    const service = new RawCaptureService(store);
    const rawDirectory = join(replayDirectory, "Raw Capture");
    await mkdir(rawDirectory, { recursive: true });
    const replayRawPath = join(rawDirectory, "legacy-replay-sidecar.json");
    const orphanRawPath = join(rawDirectory, "legacy-orphan-sidecar.json");
    const rawPayload = JSON.stringify({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "legacy-capture",
        identity: { roomCode: "LEGACY", firstSeenAt: 1781360000000, lastSeenAt: 1781360001000 },
        lifecycle: { lastPhase: "in_game", lastGameNumber: 1, boundaries: [] }
      },
      messages: []
    });
    await writeFile(replayRawPath, rawPayload, "utf8");
    await writeFile(orphanRawPath, rawPayload, "utf8");
    await store.saveReplay({
      ...replay("legacy-undefined-replay", "LEGACY"),
      rawCapture: {
        provider: "riftreplay",
        captureSessionId: "legacy-replay-capture",
        messageCount: 1,
        firstSeenAt: 1781360000000,
        lastSeenAt: 1781360001000,
        roomCode: "LEGACY",
        uploadStatus: "not-uploaded",
        localPath: replayRawPath,
        visibility: "public"
      }
    });
    const orphanIndexPath = `${orphanRawPath}.riftlite-index.json`;
    await writeFile(orphanIndexPath, JSON.stringify({
      schema: "riftlite-raw-capture-index",
      version: 1,
      updatedAt: "2026-07-01T00:00:00.000Z",
      platform: "atlas",
      localPath: orphanRawPath,
      indexPath: orphanIndexPath,
      identity: {
        platform: "atlas",
        captureSessionId: "legacy-orphan-capture",
        capturedAt: "2026-07-01T00:00:00.000Z"
      },
      metadata: {
        provider: "riftreplay",
        captureSessionId: "legacy-orphan-capture",
        messageCount: 1,
        firstSeenAt: 1781360000000,
        lastSeenAt: 1781360001000,
        uploadStatus: "not-uploaded",
        localPath: orphanRawPath,
        visibility: "public"
      }
    }), "utf8");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    expect(await service.uploadPendingRawCaptures()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await store.getReplays())[0].rawCapture?.uploadStatus).toBe("not-uploaded");
  });

  it("applies the automatic retry cooldown to eligible orphan manifests", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T14:00:00.000Z"));
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore({
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        visibility: "private"
      }, replayDirectory),
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token"
    } as UserSettings);
    const service = new RawCaptureService(store);
    const rawDirectory = join(replayDirectory, "Raw Capture");
    await mkdir(rawDirectory, { recursive: true });
    const rawPath = join(rawDirectory, "cooldown-orphan.json");
    const indexPath = `${rawPath}.riftlite-index.json`;
    await writeFile(rawPath, JSON.stringify({
      schema: "riftreplay-raw-capture",
      version: 1,
      messages: []
    }), "utf8");
    await writeFile(indexPath, JSON.stringify({
      schema: "riftlite-raw-capture-index",
      version: 1,
      updatedAt: "2026-07-10T14:00:00.000Z",
      platform: "atlas",
      localPath: rawPath,
      indexPath,
      identity: {
        platform: "atlas",
        captureSessionId: "cooldown-orphan-capture",
        capturedAt: "2026-07-10T13:30:00.000Z"
      },
      metadata: {
        provider: "riftlite-v2",
        captureSessionId: "cooldown-orphan-capture",
        messageCount: 1,
        firstSeenAt: Date.parse("2026-07-10T13:30:00.000Z"),
        lastSeenAt: Date.parse("2026-07-10T13:55:00.000Z"),
        uploadStatus: "failed",
        processingStatus: "failed",
        localPath: rawPath,
        visibility: "private",
        webReplayAutoUploadEligible: true,
        webReplayAutoUploadAccountUid: "account-1",
        lastUploadAttemptAt: "2026-07-10T14:00:00.000Z"
      }
    }), "utf8");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "id-token", user_id: "account-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "cooldown_orphan", status: "pending", visibility: "private" },
        uploadRequired: false,
        completeEndpoint: "/api/v2/replays/cooldown_orphan/complete",
        playerPath: "/replays/cooldown_orphan"
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "cooldown_orphan", status: "ready", visibility: "private" },
        playerPath: "/replays/cooldown_orphan"
      }), { status: 200 }));

    expect(await service.uploadPendingRawCaptures()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-07-10T14:02:00.000Z"));
    expect(await service.uploadPendingRawCaptures()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses the current private setting for pending uploads with legacy public metadata", async () => {
    const replayDirectory = await tempReplayDirectory();
    const store = fakeStore({
      ...settings({
        enabled: true,
        webReplayAutoUploadEnabled: true,
        webReplayAutoUploadAccountUid: "account-1",
        visibility: "private"
      }, replayDirectory),
      accountUid: "account-1",
      firebaseRefreshToken: "refresh-token"
    } as UserSettings);
    const service = new RawCaptureService(store);
    const rawPath = join(replayDirectory, "legacy-public-sidecar.json");
    await writeFile(rawPath, JSON.stringify({
      schema: "riftreplay-raw-capture",
      version: 1,
      capture: {
        captureSessionId: "legacy-public-capture",
        identity: { roomCode: "LEGACY-PUBLIC", firstSeenAt: 1, lastSeenAt: 2 },
        lifecycle: { lastPhase: "in_game", lastGameNumber: 1, boundaries: [] }
      },
      messages: []
    }), "utf8");
    await store.saveReplay({
      ...replay("legacy-public-replay", "LEGACY-PUBLIC"),
      rawCapture: {
        provider: "riftreplay",
        captureSessionId: "legacy-public-capture",
        messageCount: 1,
        uploadStatus: "not-uploaded",
        localPath: rawPath,
        visibility: "public",
        webReplayAutoUploadEligible: true,
        webReplayAutoUploadAccountUid: "account-1"
      }
    });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "id-token", user_id: "account-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "private_pending", captureId: "legacy-public-capture", status: "pending", visibility: "private" },
        uploadRequired: false,
        completeEndpoint: "/api/v2/replays/private_pending/complete",
        canonicalEndpoint: "/api/v2/replays/private_pending",
        playerPath: "/replays/private_pending"
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replay: { replayId: "private_pending", status: "ready", visibility: "private" },
        playerPath: "/replays/private_pending"
      }), { status: 200 }));

    expect(await service.uploadPendingRawCaptures()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as { visibility: string };
    expect(body.visibility).toBe("private");
  });
});
