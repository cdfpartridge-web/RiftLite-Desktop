import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, Mail, RefreshCw, Shield, Users } from "lucide-react";
import type { HubActionResult, UserSettings } from "../shared/types";
import { groupsAccountScope, type YourGroupsTab } from "../shared/yourGroups";
import { GroupInvitationsController } from "./groupInvitationsController";
import "./styles/your-groups.css";

export interface YourGroupsViewProps {
  settings: UserSettings;
  initialTab?: YourGroupsTab;
  onOpenAccount: () => void;
  onHubJoined: (result: HubActionResult) => Promise<void>;
  onRefreshMemberships: () => Promise<void>;
  renderTeams: (options: { hideInvitationInbox: true; initialTeamId?: string }) => ReactNode;
  renderHubs: (options: { hideInvitationInbox: true; initialHubId?: string }) => ReactNode;
}

export function YourGroupsView(props: YourGroupsViewProps) {
  const scope = groupsAccountScope(props.settings);
  return <ScopedYourGroups key={scope || "local"} {...props} accountScope={scope} />;
}

function ScopedYourGroups(props: YourGroupsViewProps & { accountScope: string }) {
  const { settings, initialTab = "teams", accountScope } = props;
  const [tab, setTab] = useState<YourGroupsTab>(initialTab);
  const [teamId, setTeamId] = useState<string>();
  const [hubId, setHubId] = useState<string>();
  const [membershipRevision, setMembershipRevision] = useState(0);
  const propsRef = useRef(props);
  propsRef.current = props;
  const mounted = useRef(true);
  const [controller] = useState(() => new GroupInvitationsController(window.riftlite, accountScope,
    async (result) => {
      await propsRef.current.onRefreshMemberships();
      if (!mounted.current) return;
      setTeamId(result.team.id); setMembershipRevision((value) => value + 1); setTab("teams");
    },
    async (result, acceptedHubId) => {
      if (result) await propsRef.current.onHubJoined(result);
      else await propsRef.current.onRefreshMemberships();
      if (!mounted.current) return;
      setHubId(acceptedHubId); setMembershipRevision((value) => value + 1); setTab("hubs");
    }));
  const inbox = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    mounted.current = true; controller.activate();
    if (accountScope) void controller.load();
    return () => { mounted.current = false; controller.dispose(); };
  }, [controller, accountScope]);
  useEffect(() => { setTab(initialTab); }, [initialTab]);
  const pending = inbox.items.filter((item) => item.status === "open");
  const recent = inbox.items.filter((item) => item.status !== "open").slice(0, 8);
  const blocked = inbox.loading || Boolean(inbox.busyKey);
  const accountReady = Boolean(accountScope && settings.accountHandle);

  return <section className="your-groups-page dashboard-page" data-your-groups-page>
    <header className="your-groups-header">
      <div><span className="eyebrow">Community</span><h2>Your groups</h2><p>Teams, private testing hubs and invitations in one place.</p></div>
    </header>
    <nav className="your-groups-tabs" aria-label="Your groups sections">
      <button type="button" aria-current={tab === "teams" ? "page" : undefined} data-active={tab === "teams"} onClick={() => setTab("teams")}><Users size={16} /> Teams</button>
      <button type="button" aria-current={tab === "hubs" ? "page" : undefined} data-active={tab === "hubs"} onClick={() => setTab("hubs")}><Shield size={16} /> Private hubs</button>
      <button type="button" aria-current={tab === "invitations" ? "page" : undefined} data-active={tab === "invitations"} onClick={() => setTab("invitations")}><Mail size={16} /> Invitations{accountReady && pending.length ? <span className="your-groups-count">{pending.length}</span> : null}</button>
    </nav>
    {tab === "teams" ? <div className="your-groups-content" key={`teams:${membershipRevision}`}>
      <p className="your-groups-context">Teams have their own members, profiles and shared matches. Open a team to invite members or manage applications.</p>
      {accountReady ? props.renderTeams({ hideInvitationInbox: true, initialTeamId: teamId }) : <AccountPrompt connected={Boolean(accountScope)} onOpenAccount={props.onOpenAccount} purpose="join teams and manage invitations" />}
    </div> : null}
    {tab === "hubs" ? <div className="your-groups-content" key={`hubs:${membershipRevision}`}>
      <p className="your-groups-context">Private hubs are separate testing groups with their own members, match sharing and Discord connection.</p>
      {props.renderHubs({ hideInvitationInbox: true, initialHubId: hubId })}
    </div> : null}
    {tab === "invitations" ? <section className="your-groups-invitations rail-card stack" aria-label="Group invitations">
      <div className="section-row"><div><h2>Invitations</h2><p className="muted">Joining adds you to the team or private hub shown on the invitation.</p></div>
        {accountReady ? <button type="button" className="secondary" disabled={blocked} onClick={() => void controller.load()}><RefreshCw size={15} /> Refresh</button> : null}</div>
      {!accountReady ? <AccountPrompt connected={Boolean(accountScope)} onOpenAccount={props.onOpenAccount} purpose="receive invitations addressed to your RiftLite account" /> : <>
        {inbox.loading ? <p role="status" className="muted">Loading team and private hub invitations…</p> : null}
        {inbox.errors.map((error) => <p role="alert" className="your-groups-error" key={error}>{error}</p>)}
        {inbox.message ? <p role="status" className="your-groups-message"><Check size={16} /> {inbox.message}</p> : null}
        {!inbox.loading && !pending.length && !inbox.errors.length ? <div className="your-groups-empty"><Mail size={25} /><h3>No invitations waiting</h3><p>Ask a team or hub admin to invite @{settings.accountHandle}. You can also open a private invite link they send you.</p></div> : null}
        <div className="your-groups-invite-list">{pending.map((invite) => <article className="your-groups-invite" key={invite.key}>
          <div className="your-groups-invite-icon">{invite.kind === "team" ? <Users size={21} /> : <Shield size={21} />}</div>
          <div className="your-groups-invite-copy"><span className="your-groups-kind">{invite.kind === "team" ? "Team" : "Private hub"}</span><h3>{invite.groupName}</h3><p>{invite.senderName || "A group admin"} invited you.</p><small>Expires {new Date(invite.expiresAt).toLocaleDateString()}</small></div>
          <div className="row-actions"><button type="button" className="primary" disabled={blocked} onClick={() => void controller.respond(invite.key, "join")}>{inbox.busyKey === invite.key ? "Working…" : invite.kind === "team" ? "Join team" : "Join hub"}</button><button type="button" className="secondary" disabled={blocked} onClick={() => void controller.respond(invite.key, "decline")}>Decline</button></div>
        </article>)}</div>
        {recent.length ? <details className="your-groups-invite-history"><summary>Recent invitations ({recent.length})</summary>{recent.map((invite) => <div key={invite.key}><span><strong>{invite.groupName}</strong><small>{invite.kind === "team" ? "Team" : "Private hub"}</small></span><span>{invite.status}</span></div>)}</details> : null}
        <p className="muted your-groups-invite-help">To invite someone, open your team’s Members tab or your private hub’s member controls. Team admins can also revoke pending invitations there.</p>
      </>}
    </section> : null}
  </section>;
}

function AccountPrompt({ connected, onOpenAccount, purpose }: { connected: boolean; onOpenAccount: () => void; purpose: string }) {
  return <div className="your-groups-account"><Shield size={24} /><div><h3>{connected ? "Finish your RiftLite profile" : "Connect your RiftLite account"}</h3><p>{connected ? "Choose your player name and handle" : "Connect your account"} to {purpose}.</p><button type="button" className="primary" onClick={onOpenAccount}>{connected ? "Finish account" : "Connect account"}</button></div></div>;
}
