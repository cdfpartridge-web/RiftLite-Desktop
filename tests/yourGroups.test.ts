import { afterEach, describe, expect, it, vi } from "vitest";
import { selectGroupInvitations, selectGroupTeams, groupsAccountScope } from "../src/shared/yourGroups";
import { GroupInvitationsController } from "../src/renderer/groupInvitationsController";
import { createDefaultSettings } from "../src/shared/settingsDefaults";
import type { HubInboxItem, RiftLiteApi, SocialTeamInvite, SocialTeamProfile } from "../src/shared/types";

const future = Date.parse("2099-01-01T00:00:00Z");
afterEach(() => vi.restoreAllMocks());
function teamInvite(patch: Partial<SocialTeamInvite> = {}): SocialTeamInvite {
  return { inviteId: "same-invite", teamId: "same-group", teamName: "Practice circle", senderName: "Team admin",
    targetHandle: "member", status: "open", createdAt: 100, expiresAt: future, ...patch };
}
function hubInvite(patch: Partial<HubInboxItem> = {}): HubInboxItem {
  return { id: "inbox-item", type: "hub-invite", inviteId: "same-invite", hubId: "same-group", hubName: "Practice circle",
    senderUid: "admin", senderHandle: "hub-admin", senderDisplayName: "Hub admin", targetHandle: "member", status: "open",
    createdAt: 200, expiresAt: future, readAt: 0, ...patch };
}
function team(id: string, visibility: "public" | "private" = "public"): SocialTeamProfile {
  return { id, visibility, name: "Same name" } as SocialTeamProfile;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  let settings = { ...createDefaultSettings(), accountUid: "account-a", firebaseUid: "account-a", firebaseCredentialGeneration: "generation-1", firebaseRefreshToken: "fixture-only" };
  const api = {
    getSettings: vi.fn(async () => settings), getMySocialTeamInvites: vi.fn(async () => [teamInvite()]), getHubInbox: vi.fn(async () => [hubInvite()]),
    acceptSocialTeamInvite: vi.fn(async () => ({ alreadyMember: false, team: { id: "same-group", name: "Practice circle", slug: "practice", role: "member" as const } })),
    declineSocialTeamInvite: vi.fn(async () => undefined),
    acceptHubInvite: vi.fn(async () => ({ hub: { id: "same-group", name: "Practice circle", sync: false }, settings })),
    declineHubInvite: vi.fn(async () => undefined),
  };
  const onTeamJoined = vi.fn(async () => undefined); const onHubJoined = vi.fn(async () => undefined);
  const controller = new GroupInvitationsController(api, groupsAccountScope(settings), onTeamJoined, onHubJoined);
  return { api, controller, onTeamJoined, onHubJoined, switchAccount: () => { settings = { ...settings, accountUid: "account-b", firebaseUid: "account-b" }; },
    changeCredentials: () => { settings = { ...settings, firebaseCredentialGeneration: "generation-2" }; } };
}

describe("Your groups selection", () => {
  it("keeps same-name and same-ID team/hub invitations distinct", () => {
    const selected = selectGroupInvitations([teamInvite()], [hubInvite()], 1000);
    expect(selected.map((item) => item.key)).toEqual(["hub:same-invite", "team:same-invite"]);
    expect(selected.map((item) => item.kind)).toEqual(["hub", "team"]);
  });
  it("retains history, removes expired actions and excludes unaddressed team links", () => {
    const rows = selectGroupInvitations([teamInvite({ expiresAt: 999 }), teamInvite({ inviteId: "link", targetHandle: "" })],
      [hubInvite({ status: "accepted" })], 1000);
    expect(rows).toHaveLength(2);
    expect(rows.find((item) => item.kind === "team")?.status).toBe("expired");
    expect(rows.find((item) => item.kind === "hub")?.status).toBe("accepted");
    expect(rows.every((item) => item.status !== "open")).toBe(true);
  });
  it("does not resurrect a closed duplicate or accept an invalid expiry", () => {
    const rows = selectGroupInvitations([teamInvite(), teamInvite({ status: "declined" }), teamInvite({ inviteId: "bad", expiresAt: NaN })], [], 1000);
    expect(rows).toHaveLength(2);
    expect(rows.find((item) => item.inviteId === "same-invite")?.status).toBe("declined");
    expect(rows.find((item) => item.inviteId === "bad")?.status).toBe("expired");
  });
  it("shows public and private memberships once, with public discovery kept separate", () => {
    const result = selectGroupTeams([team("mine"), team("discover"), team("private-leak", "private")], [team("mine"), team("private", "private"), team("mine")]);
    expect(result.joined.map((row) => row.id)).toEqual(["mine", "private"]);
    expect(result.discover.map((row) => row.id)).toEqual(["discover"]);
  });
  it("does not infer membership from a shared name", () => {
    const result = selectGroupTeams([team("public")], [team("private", "private")]);
    expect(result.joined[0].id).toBe("private"); expect(result.discover[0].id).toBe("public");
  });
});

describe("Your groups invitation actions", () => {
  it("routes a team join only to the team API, preserving the matching hub invitation", async () => {
    const f = fixture(); await f.controller.load(); await f.controller.respond("team:same-invite", "join");
    expect(f.api.acceptSocialTeamInvite).toHaveBeenCalledWith("same-invite"); expect(f.api.acceptHubInvite).not.toHaveBeenCalled();
    expect(f.onTeamJoined).toHaveBeenCalledOnce(); expect(f.onHubJoined).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().items.find((row) => row.kind === "hub")?.status).toBe("open");
  });
  it("routes hub joins and declines independently", async () => {
    const f = fixture(); await f.controller.load(); await f.controller.respond("hub:same-invite", "join");
    expect(f.api.acceptHubInvite).toHaveBeenCalledWith("same-invite"); expect(f.onHubJoined).toHaveBeenCalledOnce();
    await f.controller.respond("team:same-invite", "decline");
    expect(f.api.declineSocialTeamInvite).toHaveBeenCalledWith("same-invite"); expect(f.api.declineHubInvite).not.toHaveBeenCalled();
  });
  it("does not apply hub settings returned for another account", async () => {
    const f = fixture(); await f.controller.load(); const wrongSettings = { ...await f.api.getSettings(), accountUid: "other-account" };
    f.api.acceptHubInvite.mockResolvedValue({ hub: { id: "same-group", name: "Practice circle", sync: false }, settings: wrongSettings });
    await f.controller.respond("hub:same-invite", "join");
    expect(f.onHubJoined).not.toHaveBeenCalled(); expect(f.controller.getSnapshot().errors[0]).toContain("another account");
  });
  it("keeps successful inbox data when the other group service fails", async () => {
    const f = fixture(); f.api.getHubInbox.mockRejectedValue(new Error("Temporarily offline")); await f.controller.load();
    expect(f.controller.getSnapshot().items.map((row) => row.kind)).toEqual(["team"]);
    expect(f.controller.getSnapshot().errors).toEqual(["Private hub invitations: Temporarily offline"]);
  });
  it("does not fetch or respond using a changed account or credential generation", async () => {
    const f = fixture(); f.switchAccount(); await f.controller.load();
    expect(f.api.getMySocialTeamInvites).not.toHaveBeenCalled(); expect(f.controller.getSnapshot().items).toEqual([]);
    const g = fixture(); await g.controller.load(); g.changeCredentials(); await g.controller.respond("team:same-invite", "join");
    expect(g.api.acceptSocialTeamInvite).not.toHaveBeenCalled(); expect(g.controller.getSnapshot().items).toEqual([]);
  });
  it("discards inbox responses when the account changes while loading", async () => {
    const f = fixture(); const wait = deferred<SocialTeamInvite[]>(); f.api.getMySocialTeamInvites.mockReturnValue(wait.promise);
    const load = f.controller.load(); await vi.waitFor(() => expect(f.api.getMySocialTeamInvites).toHaveBeenCalled());
    f.switchAccount(); wait.resolve([teamInvite()]); await load;
    expect(f.controller.getSnapshot().items).toEqual([]);
  });
  it("suppresses navigation and settings callbacks after disposal or an account switch during acceptance", async () => {
    for (const end of ["dispose", "switch"] as const) {
      const f = fixture(); await f.controller.load(); const wait = deferred<Awaited<ReturnType<RiftLiteApi["acceptSocialTeamInvite"]>>>();
      f.api.acceptSocialTeamInvite.mockReturnValue(wait.promise); const respond = f.controller.respond("team:same-invite", "join");
      await vi.waitFor(() => expect(f.api.acceptSocialTeamInvite).toHaveBeenCalled());
      if (end === "dispose") f.controller.dispose(); else f.switchAccount();
      wait.resolve({ alreadyMember: false, team: { id: "same-group", name: "Joined", slug: "joined", role: "member" } }); await respond;
      expect(f.onTeamJoined).not.toHaveBeenCalled(); expect(f.onHubJoined).not.toHaveBeenCalled();
    }
  });
  it("expires an invitation that was left open and explains why it cannot be joined", async () => {
    const f = fixture(); await f.controller.load();
    vi.spyOn(Date, "now").mockReturnValue(future + 1);
    await f.controller.respond("team:same-invite", "join");
    expect(f.api.acceptSocialTeamInvite).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().items.find((item) => item.kind === "team")?.status).toBe("expired");
    expect(f.controller.getSnapshot().message).toContain("has expired");
  });
  it("rejects mismatched acceptance results and ignores unknown invitation actions", async () => {
    const f = fixture(); await f.controller.load();
    f.api.acceptSocialTeamInvite.mockResolvedValue({ alreadyMember: false, team: { id: "wrong-team", name: "Other", slug: "other", role: "member" } });
    await f.controller.respond("team:same-invite", "join"); expect(f.onTeamJoined).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().errors[0]).toContain("did not match");
    await f.controller.respond("team:missing", "join"); expect(f.api.acceptSocialTeamInvite).toHaveBeenCalledTimes(1);
  });
});
