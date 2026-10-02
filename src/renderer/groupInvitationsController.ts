import type { HubActionResult, RiftLiteApi, SocialTeamInviteAcceptance } from "../shared/types";
import { groupsAccountScope, selectGroupInvitations, type GroupInvitation } from "../shared/yourGroups";

type GroupInvitationsApi = Pick<RiftLiteApi, "getSettings" | "getMySocialTeamInvites" | "getHubInbox" |
  "acceptSocialTeamInvite" | "declineSocialTeamInvite" | "acceptHubInvite" | "declineHubInvite">;
export interface GroupInvitationsState {
  items: GroupInvitation[];
  loading: boolean;
  busyKey: string;
  errors: string[];
  message: string;
}

/** A mounted account scope owns its requests. Neither late inbox reads nor late
 * join responses can update or navigate a subsequently selected account. */
export class GroupInvitationsController {
  private state: GroupInvitationsState = { items: [], loading: true, busyKey: "", errors: [], message: "" };
  private listeners = new Set<() => void>();
  private revision = 0;
  private disposed = false;

  constructor(private readonly api: GroupInvitationsApi, private readonly scope: string,
    private readonly onTeamJoined: (result: SocialTeamInviteAcceptance) => Promise<void>,
    private readonly onHubJoined: (result: HubActionResult | null, groupId: string) => Promise<void>) {}

  getSnapshot = (): GroupInvitationsState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  activate(): void { this.disposed = false; }
  dispose(): void { this.disposed = true; this.revision++; }
  private current(revision: number): boolean { return !this.disposed && revision === this.revision; }
  private update(patch: Partial<GroupInvitationsState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private async sameAccount(revision: number): Promise<boolean> {
    if (!this.current(revision) || !this.scope) return false;
    const settings = await this.api.getSettings();
    if (!this.current(revision)) return false;
    if (groupsAccountScope(settings) !== this.scope) {
      this.update({ items: [], loading: false, busyKey: "", errors: ["Your account changed. Reopen Your groups to refresh invitations."] });
      return false;
    }
    return true;
  }

  async load(): Promise<void> {
    if (this.disposed || this.state.busyKey) return;
    const revision = ++this.revision;
    this.update({ loading: true, errors: [] });
    try {
      if (!await this.sameAccount(revision)) return;
      const [teams, hubs] = await Promise.allSettled([this.api.getMySocialTeamInvites(), this.api.getHubInbox()]);
      if (!await this.sameAccount(revision)) return;
      this.update({ items: selectGroupInvitations(teams.status === "fulfilled" ? teams.value : [], hubs.status === "fulfilled" ? hubs.value : []),
        errors: [teams.status === "rejected" ? `Team invitations: ${message(teams.reason)}` : "",
          hubs.status === "rejected" ? `Private hub invitations: ${message(hubs.reason)}` : ""].filter(Boolean) });
    } catch (error) { if (this.current(revision)) this.update({ errors: [message(error)] }); }
    finally { if (this.current(revision)) this.update({ loading: false }); }
  }

  async respond(key: string, action: "join" | "decline"): Promise<void> {
    if (this.disposed || this.state.loading || this.state.busyKey) return;
    const invite = this.state.items.find((item) => item.key === key && item.status === "open");
    if (!invite) return;
    if (!(invite.expiresAt > Date.now())) {
      this.update({ items: this.state.items.map((item) => item.key === key ? { ...item, status: "expired" } : item),
        message: "This invitation has expired. Ask a group admin for a new invitation." });
      return;
    }
    const revision = ++this.revision;
    this.update({ busyKey: key, errors: [], message: "" });
    try {
      if (!await this.sameAccount(revision)) return;
      if (action === "decline") {
        if (invite.kind === "team") await this.api.declineSocialTeamInvite(invite.inviteId);
        else await this.api.declineHubInvite(invite.inviteId);
        if (!await this.sameAccount(revision)) return;
        this.complete(invite, "declined", `Invitation to ${invite.groupName} declined.`);
      } else if (invite.kind === "team") {
        const result = await this.api.acceptSocialTeamInvite(invite.inviteId);
        if (!await this.sameAccount(revision)) return;
        if (result.team.id !== invite.groupId) throw new Error("The invitation response did not match this team. Refresh invitations.");
        this.complete(invite, "accepted", result.alreadyMember ? `You already belong to ${result.team.name}.` : `Joined ${result.team.name}.`);
        await this.afterJoin(revision, () => this.onTeamJoined(result));
      } else {
        const result = await this.api.acceptHubInvite(invite.inviteId);
        if (!await this.sameAccount(revision)) return;
        if (result && result.hub.id !== invite.groupId) throw new Error("The invitation response did not match this private hub. Refresh invitations.");
        if (result && groupsAccountScope(result.settings) !== this.scope) throw new Error("The invitation response belongs to another account session. Reopen Your groups.");
        this.complete(invite, "accepted", `Joined ${result?.hub.name || invite.groupName}.`);
        await this.afterJoin(revision, () => this.onHubJoined(result, invite.groupId));
      }
    } catch (error) { if (this.current(revision)) this.update({ errors: [message(error)] }); }
    finally { if (this.current(revision)) this.update({ busyKey: "" }); }
  }
  private complete(invite: GroupInvitation, status: "accepted" | "declined", message: string): void {
    this.update({ items: this.state.items.map((item) => item.key === invite.key ? { ...item, status } : item), message });
  }
  private async afterJoin(revision: number, callback: () => Promise<void>): Promise<void> {
    try { await callback(); }
    catch { if (this.current(revision)) this.update({ errors: ["Your membership is saved. Open the group tab and refresh to see it."] }); }
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : "Could not load or update invitations. Try Refresh."; }
