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
    getMatches: vi.fn(async () => matches),
    saveMatch: vi.fn(async (match: MatchDraft) => match),
    getReplays: vi.fn(async () => replays)
  } as unknown as RiftLiteStore;
  const service = new FirebaseSyncService(store, () => null);
  const websiteRequest = vi.fn(async () => ({ ok: true }));
  Object.assign(service, { authenticatedWebsiteRequest: websiteRequest });
  return { service, store, websiteRequest, current: () => current };
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
    const { service, websiteRequest } = harness([match]);

    await expect(service.attachWebReplayToSyncedHubMatches("match-1", "rl2_private_123")).resolves.toBe(1);

    expect(websiteRequest).toHaveBeenCalledOnce();
    expect(websiteRequest).toHaveBeenCalledWith(
      "/api/hubs/member-hub/matches/match-1/web-replay",
      { method: "PUT", body: { replayId: "rl2_private_123" } }
    );
    await expect(service.attachWebReplayToSyncedHubMatches("match-1", "../../account")).resolves.toBe(0);
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
      { method: "PUT", body: { replayId: "rl2_historical_123" } }
    );

    websiteRequest.mockClear();
    await expect(service.backfillPrivateHubWebReplayIds()).resolves.toBe(0);
    expect(websiteRequest).not.toHaveBeenCalled();
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
      { method: "PUT", body: { replayId: "rl2_historical_1" } }
    );
  });
});
