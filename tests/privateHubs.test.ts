import { describe, expect, it } from "vitest";
import {
  PRIVATE_HUB_DELETE_COUNTDOWN_SECONDS,
  canDeletePrivateHub,
  canLeavePrivateHub,
  normalizePrivateHubWebReplayId,
  privateHubMembershipsEqual,
  privateHubWebReplayUrl,
  settingsPatchAfterPrivateHubRemoval,
  webReplayIdForLocalMatch
} from "../src/shared/privateHubs";
import type { ReplayRecord, UserSettings } from "../src/shared/types";

function uploadedReplay(overrides: Partial<ReplayRecord> = {}): ReplayRecord {
  return {
    id: "local-replay-1",
    matchId: "match-1",
    platform: "atlas",
    capturedAt: "2026-07-19T12:00:00.000Z",
    title: "Test replay",
    players: { me: "Player", opponent: "Opponent" },
    events: [],
    rawCapture: {
      provider: "riftlite-v2",
      captureSessionId: "capture-1",
      messageCount: 10,
      uploadStatus: "uploaded",
      uploadId: "rl2_private_123"
    },
    ...overrides
  };
}

function rawCaptureSettings(): UserSettings["rawCapture"] {
  return {
    enabled: true,
    uploadEnabled: false,
    webReplayAutoUploadEnabled: true,
    webReplayAutoUploadAccountUid: "account-1",
    webReplayDiscordShareEnabled: true,
    webReplayDiscordShareAccountUid: "account-1",
    webReplayDiscordShareHubIds: ["hub-one", "hub-two"],
    endpoint: "",
    apiKey: "",
    visibility: "unlisted"
  };
}

describe("private hub UI policy", () => {
  it("lets members and co-owners leave while reserving delete for the primary owner", () => {
    expect(canLeavePrivateHub({ role: "member", claimed: true })).toBe(true);
    expect(canLeavePrivateHub({ role: "admin", claimed: true })).toBe(true);
    expect(canLeavePrivateHub({ role: "owner", claimed: true })).toBe(false);
    expect(canDeletePrivateHub({ role: "owner", claimed: true })).toBe(true);
    expect(canDeletePrivateHub({ role: "admin", claimed: true })).toBe(false);
    expect(canLeavePrivateHub({ role: "member", claimed: false })).toBe(false);
    expect(canDeletePrivateHub({ role: "owner" })).toBe(false);
    expect(PRIVATE_HUB_DELETE_COUNTDOWN_SECONDS).toBeGreaterThan(0);
  });

  it("recognizes an unchanged refreshed membership list without relying on object identity", () => {
    const current = [{
      id: "hub-one",
      name: "One",
      sync: true,
      role: "member" as const,
      joinedAt: "2026-07-19T12:00:00.000Z",
      imageDataUrl: "data:image/png;base64,abc",
      imageUpdatedAt: "2026-07-19T12:05:00.000Z"
    }];
    const refreshed = [{
      imageUpdatedAt: "2026-07-19T12:05:00.000Z",
      imageDataUrl: "data:image/png;base64,abc",
      joinedAt: "2026-07-19T12:00:00.000Z",
      role: "member" as const,
      sync: true,
      name: "One",
      id: "hub-one",
      claimed: false
    }];

    expect(privateHubMembershipsEqual(current, refreshed)).toBe(true);
  });

  it("detects membership, preference, and ordering changes", () => {
    const current = [
      { id: "hub-one", name: "One", sync: true, role: "member" as const },
      { id: "hub-two", name: "Two", sync: false, role: "admin" as const }
    ];

    expect(privateHubMembershipsEqual(current, current.map((hub) => ({ ...hub })))).toBe(true);
    expect(privateHubMembershipsEqual(current, [
      current[0],
      { ...current[1], role: "owner" as const }
    ])).toBe(false);
    expect(privateHubMembershipsEqual(current, [
      current[0],
      { ...current[1], sync: true }
    ])).toBe(false);
    expect(privateHubMembershipsEqual(current, [...current].reverse())).toBe(false);
  });

  it("constructs replay links only for private-hub rows with conservative replay IDs", () => {
    expect(privateHubWebReplayUrl("hub", "rl2_private_123"))
      .toBe("https://www.riftlite.com/replays/rl2_private_123");
    expect(privateHubWebReplayUrl("community", "rl2_private_123")).toBe("");
    expect(privateHubWebReplayUrl("team", "rl2_private_123")).toBe("");
    expect(privateHubWebReplayUrl("hub", "../../account")).toBe("");
    expect(normalizePrivateHubWebReplayId("javascript:alert(1)")).toBe("");
  });

  it("uses only uploaded RiftLite Web Replays as a local match fallback", () => {
    expect(webReplayIdForLocalMatch([uploadedReplay()], "match-1")).toBe("rl2_private_123");
    expect(webReplayIdForLocalMatch([uploadedReplay({
      rawCapture: {
        ...uploadedReplay().rawCapture!,
        provider: "riftreplay"
      }
    })], "match-1")).toBe("");
    expect(webReplayIdForLocalMatch([uploadedReplay({
      rawCapture: {
        ...uploadedReplay().rawCapture!,
        uploadStatus: "not-uploaded"
      }
    })], "match-1")).toBe("");
  });

  it("removes a departed hub from local sync and Discord replay destinations", () => {
    const settings = {
      activeHubs: [
        { id: "hub-one", name: "One", sync: true, role: "member" as const },
        { id: "hub-two", name: "Two", sync: true, role: "admin" as const }
      ],
      rawCapture: rawCaptureSettings()
    };
    const first = settingsPatchAfterPrivateHubRemoval(settings, "hub-one");
    expect(first.activeHubs.map((hub) => hub.id)).toEqual(["hub-two"]);
    expect(first.rawCapture.webReplayDiscordShareHubIds).toEqual(["hub-two"]);
    expect(first.rawCapture.webReplayDiscordShareEnabled).toBe(true);

    const last = settingsPatchAfterPrivateHubRemoval(first, "hub-two");
    expect(last.rawCapture.webReplayDiscordShareHubIds).toEqual([]);
    expect(last.rawCapture.webReplayDiscordShareEnabled).toBe(false);
    expect(last.rawCapture.webReplayDiscordShareAccountUid).toBe("");
  });
});
