import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getVersion: () => "0.9.0-test" }
}));

import { FirebaseSyncService } from "../src/main/services/firebaseSync";
import type { RiftLiteStore } from "../src/main/services/store";
import type { MatchDraft, ReplayRecord, UserSettings } from "../src/shared/types";

function settings(): UserSettings {
  return {
    accountUid: "account-1",
    firebaseUid: "account-1",
    firebaseRefreshToken: "refresh",
    firebaseCredentialGeneration: "credential-account-1",
    activeHubs: [
      { id: "member-hub", name: "Member hub", sync: true, role: "member", claimed: true },
      { id: "admin-hub", name: "Admin hub", sync: true, role: "admin", claimed: true },
      { id: "owner-hub", name: "Owner hub", sync: true, role: "owner", claimed: true }
    ],
    rawCapture: {
      enabled: true,
      uploadEnabled: false,
      webReplayAutoUploadEnabled: true,
      webReplayAutoUploadAccountUid: "account-1",
      webReplayDiscordShareEnabled: true,
      webReplayDiscordShareAccountUid: "account-1",
      webReplayDiscordShareHubIds: ["member-hub", "owner-hub"],
      endpoint: "",
      apiKey: "",
      visibility: "unlisted"
    }
  } as UserSettings;
}

function harness(matches: MatchDraft[] = [], replays: ReplayRecord[] = []) {
  let current = settings();
  const store = {
    getSettings: vi.fn(async () => current),
    saveSettings: vi.fn(async (patch: Partial<UserSettings>) => {
      current = { ...current, ...patch };
      return current;
    }),
    updateSettings: vi.fn(async (mutation: (settings: Readonly<UserSettings>) => Partial<UserSettings>) => {
      current = { ...current, ...mutation(current) };
      return current;
    }),
    getMatches: vi.fn(async () => matches),
    saveMatch: vi.fn(async (match: MatchDraft) => {
      matches = [match, ...matches.filter((candidate) => candidate.id !== match.id)];
      return match;
    }),
    attachWebReplayToActiveMatch: vi.fn(async (
      matchId: string,
      webReplayId: string,
      accountUid: string,
      localReplayId: string,
      guard: () => boolean
    ) => {
      const match = matches.find((candidate) => candidate.id === matchId && !candidate.deletedAt);
      if (!match || !guard()) return null;
      const next = {
        ...match,
        webReplayId,
        webReplayAccountUid: accountUid,
        webReplayLocalReplayId: localReplayId || undefined
      };
      matches = [next, ...matches.filter((candidate) => candidate.id !== matchId)];
      return next;
    }),
    getReplays: vi.fn(async () => replays.filter((replay) => !replay.deletedAt)),
    getDeletedReplays: vi.fn(async () => replays.filter((replay) => Boolean(replay.deletedAt))),
    hasActiveRawCaptureParent: vi.fn(async (replayId: string | undefined, matchId: string) => (
      matches.some((match) => match.id === matchId && !match.deletedAt) && (
        !replayId || replays.some((replay) => replay.id === replayId && replay.matchId === matchId && !replay.deletedAt)
      )
    ))
  } as unknown as RiftLiteStore;
  const service = new FirebaseSyncService(store, () => null);
  const websiteRequest = vi.fn(async () => ({ ok: true }));
  Object.assign(service, {
    authenticatedWebsiteRequest: websiteRequest,
    websiteRequestWithIdToken: websiteRequest,
    auth: {
      uid: "account-1",
      idToken: "id-token",
      refreshToken: "refresh",
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    }
  });
  return { service, store, websiteRequest, current: () => current, matches: () => matches };
}

function uploadedReplay(matchId = "match-1", id = "local-replay-1", uploadId = "rl2_private_123"): ReplayRecord {
  return {
    id,
    matchId,
    platform: "atlas",
    capturedAt: "2026-07-19T12:00:00.000Z",
    title: "Uploaded replay",
    players: { me: "Player", opponent: "Opponent" },
    events: [],
    rawCapture: {
      provider: "riftlite-v2",
      captureSessionId: `capture-${id}`,
      messageCount: 10,
      uploadStatus: "uploaded",
      uploadId,
      webReplayAutoUploadAccountUid: "account-1"
    }
  } as ReplayRecord;
}

describe("FirebaseSyncService private hub lifecycle", () => {
  it("leaves a member hub and cleans local destinations", async () => {
    const { service, websiteRequest, current } = harness();

    const next = await service.leaveHub("member-hub");

    expect(websiteRequest).toHaveBeenCalledWith("/api/hubs/member-hub/membership", { method: "DELETE" });
    expect(next.activeHubs.some((hub) => hub.id === "member-hub")).toBe(false);
    expect(current().rawCapture.webReplayDiscordShareHubIds).toEqual(["owner-hub"]);
  });

  it("does not let the primary owner use leave", async () => {
    const { service, websiteRequest } = harness();

    await expect(service.leaveHub("owner-hub")).rejects.toThrow("cannot leave");
    expect(websiteRequest).not.toHaveBeenCalled();
  });

  it("deletes only for an owner with an exact confirmation", async () => {
    const { service, websiteRequest } = harness();

    await expect(service.deleteHub("owner-hub", "wrong-hub")).rejects.toThrow("did not match");
    await expect(service.deleteHub("admin-hub", "admin-hub")).rejects.toThrow("primary owner");
    const next = await service.deleteHub("owner-hub", "owner-hub");

    expect(websiteRequest).toHaveBeenCalledWith("/api/hubs/owner-hub", {
      method: "DELETE",
      body: { confirmation: "owner-hub" }
    });
    expect(next.activeHubs.some((hub) => hub.id === "owner-hub")).toBe(false);
  });

  it("backfills replay grants only to active hubs already synced for that local match", async () => {
    const match = {
      id: "match-1",
      myName: "Player",
      sync: {
        community: "disabled",
        hubs: { "member-hub": "synced", "former-hub": "synced", "owner-hub": "pending" },
        teams: {}
      }
    } as MatchDraft;
    const { service, websiteRequest } = harness([match], [uploadedReplay()]);

    await expect(service.attachWebReplayToSyncedHubMatches("match-1", "rl2_private_123", "account-1")).resolves.toBe(1);

    expect(websiteRequest).toHaveBeenCalledOnce();
    expect(websiteRequest).toHaveBeenCalledWith(
      "/api/hubs/member-hub/matches/match-1/web-replay",
      { method: "PUT", body: { replayId: "rl2_private_123" } },
      "id-token"
    );
    await expect(service.attachWebReplayToSyncedHubMatches("match-1", "../../account", "account-1")).resolves.toBe(0);
  });

  it("durably associates a TCGA Web Replay even when no local ReplayRecord was kept", async () => {
    const match = {
      id: "tcga-no-local-replay",
      platform: "tcga",
      myName: "Player",
      sync: { community: "disabled", hubs: { "member-hub": "pending" }, teams: {} }
    } as MatchDraft;
    const firstLaunch = harness([match], []);

    // Publication happens before match reporting, so there is no synced hub to
    // update yet. The remote identity must nevertheless survive that ordering.
    await expect(firstLaunch.service.attachWebReplayToSyncedHubMatches(match.id, "rl2_tcga_no_local", "account-1"))
      .resolves.toBe(0);
    expect(firstLaunch.websiteRequest).not.toHaveBeenCalled();
    expect(firstLaunch.matches()[0]).toMatchObject({
      webReplayId: "rl2_tcga_no_local",
      webReplayAccountUid: "account-1"
    });
    expect(firstLaunch.matches()[0].webReplayLocalReplayId).toBeUndefined();

    // Simulate the hub match completing and a fresh app launch. Backfill must
    // use the match association rather than requiring a ReplayRecord.
    const persisted = {
      ...firstLaunch.matches()[0],
      sync: { community: "disabled", hubs: { "member-hub": "synced" }, teams: {} }
    } as MatchDraft;
    const restarted = harness([persisted], []);
    await expect(restarted.service.backfillPrivateHubWebReplayIds()).resolves.toBe(1);
    expect(restarted.websiteRequest).toHaveBeenCalledWith(
      "/api/hubs/member-hub/matches/tcga-no-local-replay/web-replay",
      { method: "PUT", body: { replayId: "rl2_tcga_no_local" } },
      "id-token"
    );
  });

  it("retains the association after a transient grant failure so startup backfill can retry it", async () => {
    const match = {
      id: "transient-association",
      platform: "tcga",
      myName: "Player",
      sync: { community: "disabled", hubs: { "member-hub": "synced" }, teams: {} }
    } as MatchDraft;
    const firstLaunch = harness([match], []);
    firstLaunch.websiteRequest.mockRejectedValueOnce(new Error("temporary website failure"));

    await expect(firstLaunch.service.attachWebReplayToSyncedHubMatches(match.id, "rl2_transient_assoc", "account-1"))
      .resolves.toBe(0);
    expect(firstLaunch.matches()[0]).toMatchObject({
      webReplayId: "rl2_transient_assoc",
      webReplayAccountUid: "account-1"
    });

    const restarted = harness(firstLaunch.matches(), []);
    await expect(restarted.service.backfillPrivateHubWebReplayIds()).resolves.toBe(1);
    expect(restarted.websiteRequest).toHaveBeenCalledWith(
      "/api/hubs/member-hub/matches/transient-association/web-replay",
      { method: "PUT", body: { replayId: "rl2_transient_assoc" } },
      "id-token"
    );
  });

  it.each([
    ["ReplayRecord", [uploadedReplay("owner-race", "owner-race-replay", "rl2_owner_race")]],
    ["manifest-only publication", []]
  ] as const)("rejects an account A publication after switching to account B (%s)", async (_label, replays) => {
    const match = {
      id: "owner-race",
      platform: "tcga",
      myName: "Player",
      sync: { community: "disabled", hubs: { "member-hub": "synced" }, teams: {} }
    } as MatchDraft;
    const { service, store, websiteRequest, matches } = harness([match], [...replays]);
    await store.saveSettings({
      accountUid: "account-2",
      firebaseUid: "account-2",
      firebaseRefreshToken: "refresh-2",
      firebaseCredentialGeneration: "credential-account-2"
    });

    await expect(service.attachWebReplayToSyncedHubMatches(match.id, "rl2_owner_race", "account-1"))
      .resolves.toBe(0);
    expect(store.attachWebReplayToActiveMatch).not.toHaveBeenCalled();
    expect(matches()[0].webReplayId).toBeUndefined();
    expect(websiteRequest).not.toHaveBeenCalled();
  });

  it("does not revive a durable grant after its named local replay was deleted", async () => {
    const match = {
      id: "deleted-local-replay-parent",
      myName: "Player",
      webReplayId: "rl2_deleted_local_parent",
      webReplayAccountUid: "account-1",
      webReplayLocalReplayId: "local-deleted-parent",
      sync: { community: "disabled", hubs: { "member-hub": "synced" }, teams: {} }
    } as MatchDraft;
    const deletedReplay = {
      ...uploadedReplay(match.id, "local-deleted-parent", "rl2_deleted_local_parent"),
      deletedAt: "2026-07-21T12:00:00.000Z"
    };
    const { service, websiteRequest } = harness([match], [deletedReplay]);

    await expect(service.backfillPrivateHubWebReplayIds()).resolves.toBe(0);
    expect(websiteRequest).not.toHaveBeenCalled();
  });

  it("discovers uploaded historical replays and grants them to their synced private hubs", async () => {
    const match = {
      id: "match-1",
      myName: "Player",
      sync: {
        community: "disabled",
        hubs: { "member-hub": "synced" },
        teams: {}
      }
    } as MatchDraft;
    const replay = {
      id: "local-replay-1",
      matchId: "match-1",
      platform: "atlas",
      capturedAt: "2026-07-19T12:00:00.000Z",
      title: "Historical upload",
      players: { me: "Player", opponent: "Opponent" },
      events: [],
      rawCapture: {
        provider: "riftlite-v2",
        captureSessionId: "capture-1",
        messageCount: 10,
        uploadStatus: "uploaded",
        uploadId: "rl2_historical_123"
      }
    } as ReplayRecord;
    const { service, websiteRequest } = harness([match], [replay]);

    await expect(service.backfillPrivateHubWebReplayIds()).resolves.toBe(1);

    expect(websiteRequest).toHaveBeenCalledWith(
      "/api/hubs/member-hub/matches/match-1/web-replay",
      { method: "PUT", body: { replayId: "rl2_historical_123" } },
      "id-token"
    );

    websiteRequest.mockClear();
    await expect(service.backfillPrivateHubWebReplayIds()).resolves.toBe(0);
    expect(websiteRequest).not.toHaveBeenCalled();
  });

  it("revokes a grant and records no completion when replay deletion wins a deferred PUT", async () => {
    const match = {
      id: "match-race-delete",
      myName: "Player",
      sync: { community: "disabled", hubs: { "member-hub": "synced" }, teams: {} }
    } as MatchDraft;
    const replay = uploadedReplay("match-race-delete", "local-replay-race-delete", "rl2_race_delete");
    const { service, store, websiteRequest, current } = harness([match], [replay]);
    let releasePut!: () => void;
    websiteRequest
      .mockImplementationOnce(() => new Promise<Record<string, unknown>>((resolve) => {
        releasePut = () => resolve({ ok: true });
      }))
      .mockResolvedValueOnce({ ok: true });
    vi.mocked(store.hasActiveRawCaptureParent)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    const pending = service.attachWebReplayToSyncedHubMatches(match.id, "rl2_race_delete", "account-1");
    await vi.waitFor(() => expect(websiteRequest).toHaveBeenCalledOnce());
    releasePut();

    await expect(pending).resolves.toBe(0);
    expect(websiteRequest).toHaveBeenNthCalledWith(
      1,
      "/api/hubs/member-hub/matches/match-race-delete/web-replay",
      { method: "PUT", body: { replayId: "rl2_race_delete" } },
      "id-token"
    );
    expect(websiteRequest).toHaveBeenNthCalledWith(
      2,
      "/api/hubs/member-hub/matches/match-race-delete/web-replay",
      { method: "DELETE" },
      "id-token"
    );
    expect(current().privateHubWebReplayGrantKeys ?? []).toEqual([]);
  });

  it("retries only failed historical replay grants", async () => {
    const matches = ["match-1", "match-2"].map((id) => ({
      id,
      myName: "Player",
      sync: { community: "disabled", hubs: { "member-hub": "synced" }, teams: {} }
    })) as MatchDraft[];
    const replays = matches.map((match, index) => ({
      id: `local-replay-${index + 1}`,
      matchId: match.id,
      platform: "atlas",
      capturedAt: "2026-07-19T12:00:00.000Z",
      title: "Historical upload",
      players: { me: "Player", opponent: "Opponent" },
      events: [],
      rawCapture: {
        provider: "riftlite-v2",
        captureSessionId: `capture-${index + 1}`,
        messageCount: 10,
        uploadStatus: "uploaded",
        uploadId: `rl2_historical_${index + 1}`
      }
    })) as ReplayRecord[];
    const { service, websiteRequest } = harness(matches, replays);
    websiteRequest.mockRejectedValueOnce(new Error("temporary failure"));

    await expect(service.backfillPrivateHubWebReplayIds()).resolves.toBe(1);
    websiteRequest.mockClear();
    await expect(service.backfillPrivateHubWebReplayIds()).resolves.toBe(1);

    expect(websiteRequest).toHaveBeenCalledOnce();
    expect(websiteRequest).toHaveBeenCalledWith(
      "/api/hubs/member-hub/matches/match-1/web-replay",
      { method: "PUT", body: { replayId: "rl2_historical_1" } },
      "id-token"
    );
  });

  it("never finishes a historical replay grant after the linked account changes", async () => {
    const match = {
      id: "match-race",
      myName: "Player",
      sync: { community: "disabled", hubs: { "member-hub": "synced" }, teams: {} }
    } as MatchDraft;
    const replay = {
      id: "local-replay-race",
      matchId: match.id,
      platform: "atlas",
      capturedAt: "2026-07-19T12:00:00.000Z",
      title: "Historical upload",
      players: { me: "Player", opponent: "Opponent" },
      events: [],
      rawCapture: {
        provider: "riftlite-v2",
        captureSessionId: "capture-race",
        messageCount: 10,
        uploadStatus: "uploaded",
        uploadId: "rl2_historical_race"
      }
    } as ReplayRecord;
    const { service, store, websiteRequest, current } = harness([match], [replay]);
    let releaseRequest!: () => void;
    websiteRequest.mockImplementationOnce(() => new Promise<Record<string, unknown>>((resolve) => {
      releaseRequest = () => resolve({ ok: true });
    }));

    const pending = service.backfillPrivateHubWebReplayIds();
    await vi.waitFor(() => expect(websiteRequest).toHaveBeenCalledOnce());
    await store.saveSettings({
      accountUid: "account-2",
      firebaseUid: "account-2",
      firebaseRefreshToken: "refresh-2",
      firebaseCredentialGeneration: "credential-account-2",
      activeHubs: [],
      privateHubWebReplayGrantKeys: []
    });
    releaseRequest();

    await expect(pending).rejects.toThrow("account changed");
    expect(current().privateHubWebReplayGrantKeys).toEqual([]);
    expect(websiteRequest).toHaveBeenCalledWith(
      "/api/hubs/member-hub/matches/match-race/web-replay",
      { method: "PUT", body: { replayId: "rl2_historical_race" } },
      "id-token"
    );
  });
});
