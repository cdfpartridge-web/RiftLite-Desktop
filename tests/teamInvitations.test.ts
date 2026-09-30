import { describe, expect, it, vi } from "vitest";
import { TeamInvitationsController, type TeamInvitationApi } from "../src/renderer/teamInvitationController";
import type { SocialTeamInvite } from "../src/shared/types";

const invite = (overrides: Partial<SocialTeamInvite> = {}): SocialTeamInvite => ({
  inviteId: "invite-00000001", teamId: "team-one", teamName: "Example Team", senderName: "Example Owner",
  targetHandle: "player-one", status: "open", expiresAt: Date.now() + 86_400_000, createdAt: Date.now(), ...overrides
});
function api() {
  return {
    getSocialTeamInvites: vi.fn(async () => [invite()]),
    createSocialTeamInvite: vi.fn(async (_teamId: string, targetHandle?: string) => ({ invite: invite({ targetHandle: targetHandle ?? "" }), inviteUrl: "https://www.riftlite.com/teams/invite/invite-00000001" })),
    revokeSocialTeamInvite: vi.fn(async () => undefined),
    getMySocialTeamInvites: vi.fn(async () => [invite()]),
    acceptSocialTeamInvite: vi.fn(async () => ({ alreadyMember: false, team: { id: "team-one", name: "Example Team", slug: "example-team", role: "member" as const } })),
    declineSocialTeamInvite: vi.fn(async () => undefined)
  } satisfies TeamInvitationApi;
}

describe("desktop team invitations", () => {
  it("loads only current-team open invitations and never creates one on load", async () => {
    const calls = api();
    calls.getSocialTeamInvites.mockResolvedValue([
      invite(), invite({ inviteId: "invite-00000002", teamId: "other-team" }),
      invite({ inviteId: "invite-00000003", expiresAt: 1 }), invite({ inviteId: "invite-00000004", status: "revoked" })
    ]);
    const controller = new TeamInvitationsController(calls, "team-one");
    await controller.load();
    expect(controller.getSnapshot().invites.map((value) => value.inviteId)).toEqual(["invite-00000001"]);
    expect(calls.createSocialTeamInvite).not.toHaveBeenCalled();
  });

  it("creates targeted or single-use links only on action, validates handles, and clears a revoked link", async () => {
    const calls = api();
    const controller = new TeamInvitationsController(calls, "team-one");
    await controller.load();
    await controller.create("bad handle!");
    expect(calls.createSocialTeamInvite).not.toHaveBeenCalled();
    await controller.create(" @player-one ");
    expect(calls.createSocialTeamInvite).toHaveBeenLastCalledWith("team-one", "player-one");
    expect(controller.getSnapshot().created?.inviteUrl).toContain("/teams/invite/");
    await controller.create("");
    expect(calls.createSocialTeamInvite).toHaveBeenLastCalledWith("team-one", "");
    expect(controller.getSnapshot().message).toContain("one person");
    await controller.revoke("unlisted-foreign-invite");
    expect(calls.revokeSocialTeamInvite).not.toHaveBeenCalled();
    await controller.revoke("invite-00000001");
    expect(calls.revokeSocialTeamInvite).toHaveBeenCalledWith("team-one", "invite-00000001");
    expect(controller.getSnapshot().created).toBeNull();
    expect(controller.getSnapshot().invites).toEqual([]);
  });

  it("prevents double-create while the request is pending and keeps server errors retryable", async () => {
    const calls = api();
    const response = deferred<Awaited<ReturnType<typeof calls.createSocialTeamInvite>>>();
    calls.createSocialTeamInvite.mockReturnValueOnce(response.promise);
    const controller = new TeamInvitationsController(calls, "team-one");
    await controller.load();
    const first = controller.create("");
    await controller.create("");
    expect(calls.createSocialTeamInvite).toHaveBeenCalledTimes(1);
    response.reject(new Error("No profile found for that handle."));
    await first;
    expect(controller.getSnapshot()).toMatchObject({ busy: false, error: "No profile found for that handle." });
    await controller.create("");
    expect(calls.createSocialTeamInvite).toHaveBeenCalledTimes(2);
  });

  it("ignores late list results after a newer refresh or leaving the account/team scope", async () => {
    const calls = api();
    const oldList = deferred<SocialTeamInvite[]>();
    calls.getSocialTeamInvites.mockReturnValueOnce(oldList.promise);
    const controller = new TeamInvitationsController(calls, "team-one");
    const first = controller.load();
    calls.getSocialTeamInvites.mockResolvedValueOnce([invite({ inviteId: "invite-new00001" })]);
    await controller.load();
    oldList.resolve([invite()]);
    await first;
    expect(controller.getSnapshot().invites[0]?.inviteId).toBe("invite-new00001");
    const created = deferred<Awaited<ReturnType<typeof calls.createSocialTeamInvite>>>();
    calls.createSocialTeamInvite.mockReturnValueOnce(created.promise);
    const action = controller.create("");
    controller.dispose();
    created.resolve({ invite: invite(), inviteUrl: "private-old-scope-link" });
    await action;
    expect(controller.getSnapshot().created).toBeNull();
  });

  it("joins only on explicit action and opens the accepted team after updating the inbox", async () => {
    const calls = api();
    const joined = vi.fn(async () => undefined);
    const controller = new TeamInvitationsController(calls, undefined, joined);
    calls.getMySocialTeamInvites.mockResolvedValue([invite(), invite({ inviteId: "invite-generic1", targetHandle: "" })]);
    await controller.load();
    expect(calls.acceptSocialTeamInvite).not.toHaveBeenCalled();
    expect(controller.getSnapshot().invites).toHaveLength(1);
    await controller.respond("invite-00000001", "join");
    expect(calls.acceptSocialTeamInvite).toHaveBeenCalledWith("invite-00000001");
    expect(controller.getSnapshot().invites).toEqual([]);
    expect(joined).toHaveBeenCalledWith(expect.objectContaining({ team: expect.objectContaining({ id: "team-one" }) }));
  });

  it("does not open a team after leaving the inbox for another account or team while acceptance is pending", async () => {
    const calls = api();
    const joined = vi.fn(async () => undefined);
    const response = deferred<Awaited<ReturnType<typeof calls.acceptSocialTeamInvite>>>();
    calls.acceptSocialTeamInvite.mockReturnValueOnce(response.promise);
    const controller = new TeamInvitationsController(calls, undefined, joined);
    await controller.load();
    const pending = controller.respond("invite-00000001", "join");
    controller.dispose();
    response.resolve({ alreadyMember: true, team: { id: "team-one", name: "Example Team", slug: "example-team", role: "member" } });
    await pending;
    expect(joined).not.toHaveBeenCalled();
  });

  it("refuses to navigate to a different team if an acceptance response is mismatched", async () => {
    const calls = api();
    calls.acceptSocialTeamInvite.mockResolvedValueOnce({ alreadyMember: false, team: { id: "another-team", name: "Other Team", slug: "other-team", role: "member" } });
    const joined = vi.fn(async () => undefined);
    const controller = new TeamInvitationsController(calls, undefined, joined);
    await controller.load();
    await controller.respond("invite-00000001", "join");
    expect(joined).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toContain("did not match this team");
  });

  it("declines without joining, and retains errors without dropping the invitation", async () => {
    const calls = api();
    calls.declineSocialTeamInvite.mockRejectedValueOnce(new Error("Connection lost"));
    const controller = new TeamInvitationsController(calls);
    await controller.load();
    await controller.respond("invite-00000001", "decline");
    expect(controller.getSnapshot()).toMatchObject({ error: "Connection lost", busy: false });
    expect(controller.getSnapshot().invites).toHaveLength(1);
    await controller.respond("invite-00000001", "decline");
    expect(controller.getSnapshot().invites).toEqual([]);
    expect(calls.acceptSocialTeamInvite).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
