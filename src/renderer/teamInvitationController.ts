import type { RiftLiteApi, SocialTeamInvite, SocialTeamInviteAcceptance } from "../shared/types";

export type TeamInvitationApi = Pick<RiftLiteApi,
  "getSocialTeamInvites" | "createSocialTeamInvite" | "revokeSocialTeamInvite" |
  "getMySocialTeamInvites" | "acceptSocialTeamInvite" | "declineSocialTeamInvite">;

export interface TeamInvitationState {
  invites: SocialTeamInvite[];
  loading: boolean;
  busy: boolean;
  message: string;
  error: string;
  created: { invite: SocialTeamInvite; inviteUrl: string } | null;
}

export const teamInviteIsOpen = (invite: SocialTeamInvite, now = Date.now()): boolean => invite.status === "open" && invite.expiresAt > now;

/** One controller belongs to one mounted account/team scope. In-flight work from
 * a previous scope cannot publish links or navigate the newly selected account. */
export class TeamInvitationsController {
  private state: TeamInvitationState = { invites: [], loading: true, busy: false, message: "", error: "", created: null };
  private listeners = new Set<() => void>();
  private revision = 0;
  private disposed = false;

  constructor(
    private readonly api: TeamInvitationApi,
    private readonly teamId?: string,
    private readonly onJoined?: (result: SocialTeamInviteAcceptance) => Promise<void>
  ) {}

  getSnapshot = (): TeamInvitationState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  activate(): void { this.disposed = false; }
  dispose(): void { this.disposed = true; this.revision += 1; }
  private current(revision: number): boolean { return !this.disposed && revision === this.revision; }
  private update(patch: Partial<TeamInvitationState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  async load(): Promise<void> {
    if (this.disposed || this.state.busy) return;
    const revision = ++this.revision;
    this.update({ loading: true, error: "" });
    try {
      const invites = this.teamId ? await this.api.getSocialTeamInvites(this.teamId) : await this.api.getMySocialTeamInvites();
      if (!this.current(revision)) return;
      const pending = invites.filter((invite) => teamInviteIsOpen(invite) && (this.teamId ? invite.teamId === this.teamId : Boolean(invite.targetHandle)));
      this.update({
        invites: pending,
        created: pending.some((invite) => invite.inviteId === this.state.created?.invite.inviteId) ? this.state.created : null
      });
    } catch (error) {
      if (this.current(revision)) this.update({ error: message(error, "Could not load invitations. Try Refresh.") });
    } finally {
      if (this.current(revision)) this.update({ loading: false });
    }
  }

  async create(targetHandle: string): Promise<void> {
    if (!this.teamId) return;
    const handle = targetHandle.trim().replace(/^@+/, "");
    if (handle && !/^[a-zA-Z0-9_][a-zA-Z0-9_-]{2,23}$/.test(handle)) {
      this.update({ error: "Enter a RiftLite handle with 3–24 letters, numbers, underscores or hyphens." });
      return;
    }
    await this.run(async (revision) => {
      const result = await this.api.createSocialTeamInvite(this.teamId!, handle);
      if (!this.current(revision)) return;
      if (result.invite.teamId !== this.teamId) throw new Error("This invitation belongs to another team. Refresh and try again.");
      this.update({
        created: result,
        invites: [result.invite, ...this.state.invites.filter((invite) => invite.inviteId !== result.invite.inviteId)],
        message: handle ? `Invitation sent to @${handle} in RiftLite.` : "Invite link ready. Share it with one person."
      });
    });
  }

  async revoke(inviteId: string): Promise<void> {
    if (!this.teamId || !this.state.invites.some((invite) => invite.inviteId === inviteId && invite.teamId === this.teamId)) return;
    await this.run(async (revision) => {
      await this.api.revokeSocialTeamInvite(this.teamId!, inviteId);
      if (!this.current(revision)) return;
      this.update({
        invites: this.state.invites.filter((invite) => invite.inviteId !== inviteId),
        created: this.state.created?.invite.inviteId === inviteId ? null : this.state.created,
        message: "Invitation revoked."
      });
    });
  }

  async respond(inviteId: string, action: "join" | "decline"): Promise<void> {
    const invite = this.state.invites.find((candidate) => candidate.inviteId === inviteId && teamInviteIsOpen(candidate));
    if (this.teamId || !invite) return;
    await this.run(async (revision) => {
      if (action === "decline") {
        await this.api.declineSocialTeamInvite(inviteId);
        if (this.current(revision)) this.update({ invites: this.state.invites.filter((item) => item.inviteId !== inviteId), message: "Invitation declined." });
        return;
      }
      const result = await this.api.acceptSocialTeamInvite(inviteId);
      if (!this.current(revision)) return;
      if (result.team.id !== invite.teamId) throw new Error("The invitation response did not match this team. Refresh your teams.");
      this.update({ invites: this.state.invites.filter((item) => item.inviteId !== inviteId), message: result.alreadyMember ? `You already belong to ${result.team.name}.` : `Joined ${result.team.name}.` });
      try {
        await this.onJoined?.(result);
      } catch {
        if (this.current(revision)) this.update({ error: "Your membership is saved. Refresh your teams to open it." });
      }
    });
  }

  private async run(action: (revision: number) => Promise<void>): Promise<void> {
    if (this.disposed || this.state.busy || this.state.loading) return;
    const revision = ++this.revision;
    this.update({ busy: true, error: "", message: "" });
    try { await action(revision); }
    catch (error) { if (this.current(revision)) this.update({ error: message(error, "Could not complete the invitation action. Try again.") }); }
    finally { if (this.current(revision)) this.update({ busy: false }); }
  }
}

function message(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }
