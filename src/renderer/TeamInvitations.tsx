import { useEffect, useState, useSyncExternalStore } from "react";
import { Copy, Mail, RefreshCw } from "lucide-react";
import type { SocialTeamInviteAcceptance } from "../shared/types";
import { TeamInvitationsController, teamInviteIsOpen } from "./teamInvitationController";

function useInvitations(teamId?: string, onJoined?: (result: SocialTeamInviteAcceptance) => Promise<void>) {
  const [controller] = useState(() => new TeamInvitationsController(window.riftlite, teamId, onJoined));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    controller.activate();
    void controller.load();
    return () => controller.dispose();
  }, [controller]);
  return { controller, state };
}

/** Mount with an account/team key: links must never carry into another scope. */
export function TeamInvitationManager({ teamId, teamName }: { teamId: string; teamName: string }) {
  const { controller, state } = useInvitations(teamId);
  const [handle, setHandle] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const blocked = state.loading || state.busy;
  const handleReady = Boolean(handle.trim().replace(/^@+/, ""));
  async function copy() {
    if (!state.created) return;
    try {
      const copied = await window.riftlite.writeClipboardText(state.created.inviteUrl);
      setCopyMessage(copied ? "Link copied." : "Could not copy. Select the link and copy it manually.");
    } catch { setCopyMessage("Could not copy. Select the link and copy it manually."); }
  }
  return (
    <section className="rail-card stack" aria-label={`Invite members to ${teamName}`}>
      <div className="section-row">
        <div><h2>Invite member</h2><p className="muted">Invite by RiftLite handle, or create a link for one person. Invitations expire after 14 days.</p></div>
        <button type="button" className="secondary" disabled={blocked} onClick={() => void controller.load()}><RefreshCw size={15} /> Refresh invitations</button>
      </div>
      <form className="inline-actions" onSubmit={(event) => { event.preventDefault(); setCopyMessage(""); if (handleReady) void controller.create(handle); }}>
        <label>RiftLite handle<input value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="@player-handle" autoComplete="off" maxLength={25} disabled={blocked} /></label>
        <button type="submit" className="primary" disabled={blocked || !handleReady}><Mail size={15} /> Send invite</button>
        <button type="button" className="secondary" disabled={blocked} onClick={() => { setCopyMessage(""); void controller.create(""); }}>Create invite link</button>
      </form>
      {state.created ? <div className="panel-card stack">
        <label>Invite link<input readOnly value={state.created.inviteUrl} onFocus={(event) => event.currentTarget.select()} /></label>
        <div className="inline-actions"><button type="button" className="secondary" onClick={() => void copy()}><Copy size={15} /> Copy link</button><span className="muted">One new member per link · expires {new Date(state.created.invite.expiresAt).toLocaleDateString()}</span></div>
        {copyMessage ? <p role="status" className="muted">{copyMessage}</p> : null}
      </div> : null}
      {state.message ? <p role="status" className="muted">{state.message}</p> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
      <h3>Pending invitations</h3>
      {state.loading ? <p className="muted">Loading invitations…</p> : !state.invites.length && !state.error ? <p className="muted">No pending invitations.</p> : null}
      {state.invites.map((invite) => <div className="social-row" key={invite.inviteId}>
        <span>{invite.targetHandle ? `@${invite.targetHandle}` : "Single-use invite link"}<small> · expires {new Date(invite.expiresAt).toLocaleDateString()}</small></span>
        <button type="button" className="danger-lite" disabled={blocked || !teamInviteIsOpen(invite)} onClick={() => void controller.revoke(invite.inviteId)}>Revoke</button>
      </div>)}
    </section>
  );
}

/** Mount with an account key so late inbox responses cannot navigate a new account. */
export function TeamInvitationInbox({ onJoined }: { onJoined: (result: SocialTeamInviteAcceptance) => Promise<void> }) {
  const { controller, state } = useInvitations(undefined, onJoined);
  const blocked = state.loading || state.busy;
  return (
    <section className="panel-card stack" aria-label="Team invitations">
      <div className="section-row"><h2>Team invitations</h2><button type="button" className="secondary" disabled={blocked} onClick={() => void controller.load()}><RefreshCw size={15} /> Refresh invitations</button></div>
      <p className="muted">Invitations addressed to your RiftLite account. Choose Join to accept.</p>
      {state.loading ? <p className="muted">Loading invitations…</p> : !state.invites.length && !state.error ? <p className="muted">No pending invitations.</p> : null}
      {state.invites.map((invite) => <article className="social-listing" key={invite.inviteId}>
        <div><strong>{invite.teamName}</strong><span>{invite.senderName} invited you · expires {new Date(invite.expiresAt).toLocaleDateString()}</span></div>
        <div className="inline-actions"><button type="button" className="primary" disabled={blocked || !teamInviteIsOpen(invite)} onClick={() => void controller.respond(invite.inviteId, "join")}>Join</button><button type="button" className="secondary" disabled={blocked || !teamInviteIsOpen(invite)} onClick={() => void controller.respond(invite.inviteId, "decline")}>Decline</button></div>
      </article>)}
      {state.message ? <p role="status" className="muted">{state.message}</p> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
    </section>
  );
}
