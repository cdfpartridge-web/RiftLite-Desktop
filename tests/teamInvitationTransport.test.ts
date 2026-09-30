import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));
import { FirebaseSyncService } from "../src/main/services/firebaseSync";
import type { RiftLiteStore } from "../src/main/services/store";

const invite = { inviteId: "abcdef0123456789", teamId: "team / one", teamName: "Example Team", senderName: "Example Admin", targetHandle: "player", status: "open", expiresAt: Date.now() + 1_000, createdAt: Date.now() };
function harness() {
  const service = new FirebaseSyncService({} as RiftLiteStore, () => null);
  const request = vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>();
  Object.assign(service, { authenticatedWebsiteRequest: request });
  return { service, request };
}

describe("team invitation desktop transport", () => {
  it("sends handle invitations through authenticated endpoints and supplies a trusted copy link", async () => {
    const { service, request } = harness();
    request.mockResolvedValue({ invite, inviteUrl: "https://untrusted.example/redirect", acceptedBy: "private-uid" });
    expect(await service.createSocialTeamInvite("team / one", " @player ")).toEqual({
      invite, inviteUrl: "https://www.riftlite.com/teams/invite/abcdef0123456789"
    });
    expect(request).toHaveBeenCalledWith("/api/teams/team%20%2F%20one/invites", { method: "POST", body: { targetHandle: "player" } });
    await service.createSocialTeamInvite("team / one");
    expect(request).toHaveBeenLastCalledWith("/api/teams/team%20%2F%20one/invites", { method: "POST", body: { targetHandle: "" } });
  });

  it("filters malformed and foreign-team results without exposing internal identity fields", async () => {
    const { service, request } = harness();
    request.mockResolvedValue({ invites: [
      { ...invite, targetUid: "not-for-ui", acceptedBy: "also-private" },
      { ...invite, teamId: "another-team" }, { ...invite, inviteId: "../bad" }, { ...invite, status: "unknown" }
    ] });
    expect(await service.getSocialTeamInvites("team / one")).toEqual([invite]);
    request.mockResolvedValue({ invite: { ...invite, teamId: "another-team" } });
    await expect(service.createSocialTeamInvite("team / one")).rejects.toThrow("did not match this team");
  });

  it("loads addressed invitations, accepts preserving the returned role, declines and revokes", async () => {
    const { service, request } = harness();
    request.mockResolvedValueOnce({ invites: [invite] });
    expect(await service.getMySocialTeamInvites()).toEqual([invite]);
    expect(request).toHaveBeenLastCalledWith("/api/teams/invites", { method: "GET" });
    request.mockResolvedValueOnce({ ok: true, alreadyMember: true, team: { id: "team / one", name: "Example Team", slug: "example-team", role: "admin" } });
    expect(await service.acceptSocialTeamInvite(invite.inviteId)).toMatchObject({ alreadyMember: true, team: { role: "admin" } });
    expect(request).toHaveBeenLastCalledWith("/api/teams/invites/accept", { method: "POST", body: { inviteId: invite.inviteId } });
    request.mockResolvedValue({ ok: true });
    await service.declineSocialTeamInvite(invite.inviteId);
    expect(request).toHaveBeenLastCalledWith("/api/teams/invites/decline", { method: "POST", body: { inviteId: invite.inviteId } });
    await service.revokeSocialTeamInvite("team / one", invite.inviteId);
    expect(request).toHaveBeenLastCalledWith("/api/teams/team%20%2F%20one/invites/abcdef0123456789", { method: "DELETE" });
    await expect(service.acceptSocialTeamInvite(invite.inviteId)).rejects.toThrow("response was incomplete");
  });
});
