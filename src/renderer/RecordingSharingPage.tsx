import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, ChevronDown, Copy, ExternalLink, Layers, MessageCircle, RefreshCw, Shield, Video } from "lucide-react";
import { hasVerifiedRiftLiteAccount } from "../shared/accountIdentity";
import { activeDiscordReplayHubIds } from "../shared/replaySharing";
import { discordDestinationReadiness, discordReportsChannelUrl } from "../shared/recordingSharingReadiness";
import type { HubHealthStatus, RiftLiteApi, UserSettings, WebReplayUploadDiagnostics } from "../shared/types";
import "./styles/recording-sharing.css";

export type RecordingSharingSection = "replays" | "video" | "discord";
export type RecordingSharingApi = Pick<RiftLiteApi, "getHubHealth" | "setWebReplayDiscordShareHub" | "openExternalResource">;
export type RecordingSharingPageProps = {
  settings: UserSettings;
  diagnostics: WebReplayUploadDiagnostics | null;
  replayControls: ReactNode;
  videoControls: ReactNode;
  advancedControls?: ReactNode;
  onOpenAccount: () => void;
  onOpenHubs: (hubId?: string) => void;
  onOpenLibrary: () => void;
  onSettingsChanged: (settings: UserSettings) => void;
  onRefreshDiagnostics?: () => void | Promise<unknown>;
  initialSection?: RecordingSharingSection;
  api?: RecordingSharingApi;
};

const RESULTS_BOT_INSTALL_URL = "https://discord.com/oauth2/authorize?client_id=1524708623790510241";

export function RecordingSharingPage({ settings, diagnostics, replayControls, videoControls, advancedControls,
  onOpenAccount, onOpenHubs, onOpenLibrary, onSettingsChanged, onRefreshDiagnostics, initialSection, api = window.riftlite
}: RecordingSharingPageProps) {
  const [expanded, setExpanded] = useState<RecordingSharingSection | null>(initialSection ?? null);
  const currentAccount = useRef(settings.accountUid);
  currentAccount.current = settings.accountUid;
  useEffect(() => { if (initialSection) setExpanded(initialSection); }, [initialSection]);
  const verified = hasVerifiedRiftLiteAccount(settings) && diagnostics?.accountVerified !== false;
  const atlas = settings.rawCapture.webReplayAutoUploadEnabled && settings.rawCapture.webReplayAutoUploadAccountUid === settings.accountUid;
  const tcga = settings.rawCapture.tcgaWebReplayAutoUploadEnabled && settings.rawCapture.tcgaWebReplayAutoUploadAccountUid === settings.accountUid;
  const platforms = [atlas ? "Atlas" : "", tcga ? "TCGA" : ""].filter(Boolean).join(" and ");
  const destinations = activeDiscordReplayHubIds(settings);
  const videoOn = settings.replayCaptureEnabled && settings.replayVideoEnabled;
  const attention = diagnostics?.queue.filter((item) => item.stage === "failed" || item.stage === "paused" || item.canUploadAnyway || item.recommendedAction === "review-result" || item.discordShareStatus === "failed" || item.discordShareStatus === "partial").length ?? 0;
  const replaySummary = platforms
    ? `${platforms} · ${settings.rawCapture.visibility === "unlisted" ? "Unlisted links" : settings.rawCapture.visibility === "public" ? "Public" : "Private"}${!verified ? " · Account needs attention" : !settings.rawCapture.enabled ? " · Capture is off" : ""}`
    : "Automatic uploads off";

  function section(id: RecordingSharingSection, title: string, description: string, summary: string, icon: ReactNode, content: ReactNode) {
    const open = expanded === id;
    return <section className="recording-sharing-card" aria-labelledby={`recording-sharing-${id}-title`}>
      <div className="recording-sharing-card-heading">
        <span className="recording-sharing-icon" aria-hidden="true">{icon}</span>
        <div className="recording-sharing-copy"><h3 id={`recording-sharing-${id}-title`}>{title}</h3><p>{description}</p><span className="recording-sharing-summary">{summary}</span></div>
        <button className="secondary" type="button" aria-expanded={open} aria-controls={`recording-sharing-${id}-controls`} onClick={() => setExpanded(open ? null : id)}>
          {open ? "Close" : id === "discord" && !destinations.length ? "Set up" : "Manage"}<ChevronDown size={15} className={open ? "recording-sharing-chevron-open" : ""} />
        </button>
      </div>
      <div className="recording-sharing-controls" id={`recording-sharing-${id}-controls`} hidden={!open}>{content}</div>
    </section>;
  }

  return <section className="dashboard-page recording-sharing-page">
    <header className="recording-sharing-heading"><div><span className="eyebrow">Set up once</span><h2>Recording &amp; sharing</h2><p>Choose what to save and where to share it. Your library is where you watch and manage each game.</p></div><button className="secondary" type="button" onClick={onOpenLibrary}>Open replay library<ArrowRight size={16} /></button></header>
    <div className="recording-sharing-account" data-ready={verified}>
      <Shield size={18} aria-hidden="true" /><div><strong>{verified ? `Connected as ${settings.accountHandle ? `@${settings.accountHandle}` : settings.accountDisplayName || "your RiftLite account"}` : "Connect your RiftLite account for online replays"}</strong><span>{verified ? "Interactive replay uploads use this account. Videos stay on this computer." : "You can still record videos locally. Sign in to upload interactive replays and share them."}</span></div>
      <button className="secondary" type="button" onClick={onOpenAccount}>{verified ? "Account" : "Connect account"}</button>
    </div>
    <div className="recording-sharing-sections">
      {section("replays", "Interactive replays", "Revisit the board and each turn online.", replaySummary, <Layers size={22} />, <>{replayControls}<p className="muted recording-sharing-footnote">These choices apply to future games. Existing online replays keep their current visibility.</p></>)}
      {section("video", "Video recordings", "Save a video of your game on this computer.", videoOn ? `Recording enabled · ${settings.replayMicAudioEnabled ? "Microphone on" : "Microphone off"}` : "Video recording off", <Video size={22} />, videoControls)}
      {section("discord", "Discord", "Post interactive replay links to your server.", destinations.length ? `${destinations.length} automatic sharing destination${destinations.length === 1 ? "" : "s"} selected` : "Optional · Automatic sharing off", <MessageCircle size={22} />, <DiscordSetup key={settings.accountUid || "local"} settings={settings} accountVerified={verified} uploadEnabled={Boolean(settings.rawCapture.enabled && (atlas || tcga))} api={api} onOpenAccount={onOpenAccount} onOpenHubs={onOpenHubs} onOpenReplaySetup={() => setExpanded("replays")} onSettingsChanged={(next) => { if (currentAccount.current === next.accountUid) onSettingsChanged(next); }} onRefreshDiagnostics={onRefreshDiagnostics} />)}
    </div>
    {attention > 0 ? <div className="recording-sharing-attention"><div><strong>{attention} replay{attention === 1 ? " needs" : "s need"} attention</strong><p>Review the affected games and their next steps in your replay library.</p></div><button className="secondary" type="button" onClick={onOpenLibrary}>Review games<ArrowRight size={15} /></button></div> : null}
    {advancedControls ? <details className="recording-sharing-advanced"><summary>Advanced settings &amp; diagnostics</summary><div>{advancedControls}</div></details> : null}
  </section>;
}

type DiscordSetupProps = Pick<RecordingSharingPageProps, "settings" | "onOpenAccount" | "onOpenHubs" | "onSettingsChanged" | "onRefreshDiagnostics"> & {
  api: RecordingSharingApi;
  accountVerified: boolean;
  uploadEnabled: boolean;
  onOpenReplaySetup: () => void;
};
type HealthEntry = { status: "loading" | "loaded" | "error"; health?: HubHealthStatus; error?: string };

function DiscordSetup({ settings, accountVerified, uploadEnabled, api, onOpenAccount, onOpenHubs, onOpenReplaySetup, onSettingsChanged, onRefreshDiagnostics }: DiscordSetupProps) {
  const [journey, setJourney] = useState<"member" | "admin">("member");
  const [selectedHubId, setSelectedHubId] = useState(settings.activeHubs[0]?.id || "");
  const [healthByHub, setHealthByHub] = useState<Record<string, HealthEntry>>({});
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const selectedHub = settings.activeHubs.find((hub) => hub.id === selectedHubId) ?? settings.activeHubs[0];
  const hubId = selectedHub?.id || "";
  useEffect(() => {
    if (!hubId || !accountVerified) return;
    let cancelled = false;
    setHealthByHub((current) => ({ ...current, [hubId]: { status: "loading" } }));
    void api.getHubHealth(hubId).then((health) => {
      if (!cancelled) setHealthByHub((current) => ({ ...current, [hubId]: { status: "loaded", health } }));
    }).catch((cause) => {
      if (!cancelled) setHealthByHub((current) => ({ ...current, [hubId]: { status: "error", error: errorMessage(cause, "Could not check this hub. Try again, or open Private Hubs to check your membership.") } }));
    });
    return () => { cancelled = true; };
  }, [api, hubId, accountVerified, refresh]);
  const entry = healthByHub[hubId];
  const health = entry?.status === "loaded" ? entry.health : undefined;
  const readiness = discordDestinationReadiness({ accountUid: settings.accountUid, accountVerified, hubId, health, error: entry?.error });
  const channelUrl = readiness.state === "configured" ? discordReportsChannelUrl(health) : null;
  const selectedIds = activeDiscordReplayHubIds(settings);
  const sharing = selectedIds.includes(hubId);
  const admin = health?.hub.capabilities.includes("manage_discord") ?? (selectedHub?.role === "owner" || selectedHub?.role === "admin");
  const guild = health?.discord.guilds.length === 1 ? health.discord.guilds[0] : undefined;

  async function openExternal(url: string) {
    try { await api.openExternalResource(url); } catch (cause) { if (active.current) setError(errorMessage(cause, "Could not open the link.")); }
  }
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); if (active.current) { setError(""); setNotice(`${label} copied.`); } }
    catch { if (active.current) setError("Could not copy. Select and copy the text shown below."); }
  }
  async function setSharing(enabled: boolean) {
    if (!hubId || busy || (enabled && (!readiness.canEnableAutomaticSharing || !uploadEnabled))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await api.setWebReplayDiscordShareHub(hubId, enabled);
      if (!active.current) return;
      if (next.accountUid !== settings.accountUid) throw new Error("The signed-in account changed. Check the connection before changing sharing.");
      onSettingsChanged(next);
      if (activeDiscordReplayHubIds(next).includes(hubId) !== enabled) throw new Error("The sharing choice could not be applied. Check your account and interactive replay settings, then try again.");
      setNotice(enabled ? "Automatic sharing is enabled for future completed replays. Links will be Unlisted; existing games are unchanged." : "Automatic sharing is off for this hub. Previously posted links are unchanged.");
      void Promise.resolve(onRefreshDiagnostics?.()).catch(() => undefined);
    } catch (cause) { if (active.current) setError(errorMessage(cause, "Could not update automatic sharing.")); }
    finally { if (active.current) setBusy(false); }
  }

  return <div className="recording-sharing-discord">
    <div className="recording-sharing-journeys" aria-label="Discord setup choices"><button type="button" className="segmented" data-active={journey === "member"} aria-pressed={journey === "member"} onClick={() => setJourney("member")}>Share my games</button><button type="button" className="segmented" data-active={journey === "admin"} aria-pressed={journey === "admin"} onClick={() => setJourney("admin")}>Set up my server</button></div>
    {!accountVerified ? <div className="recording-sharing-next"><div><strong>Connect your RiftLite account first</strong><p>Use the account that belongs to your private testing hub.</p></div><button className="primary" type="button" onClick={onOpenAccount}>Connect account</button></div> : null}
    {settings.activeHubs.length ? <label className="recording-sharing-hub-picker">Private testing hub<select value={hubId} disabled={busy} onChange={(event) => { setSelectedHubId(event.target.value); setNotice(""); setError(""); }}>{settings.activeHubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label> : <div className="recording-sharing-next"><div><strong>{journey === "admin" ? "Choose or create a private hub" : "Join your server's private hub"}</strong><p>{journey === "admin" ? "Your server uses a private hub for shared results and member access." : "Ask a hub admin for an invitation, then accept it with this RiftLite account."}</p></div><button className="primary" type="button" onClick={() => onOpenHubs()}>Open Private Hubs</button></div>}
    {selectedHub ? <div className="recording-sharing-destination" data-state={readiness.state}>
      <div className="recording-sharing-destination-heading"><div><strong>{entry?.status === "loading" ? "Checking this hub…" : readiness.label}</strong><p>{readiness.detail}</p></div><button className="secondary" type="button" disabled={!accountVerified || entry?.status === "loading"} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14} />Check connection</button></div>
      {health && readiness.state !== "unknown" ? <div className="recording-sharing-checks"><span><Check size={14} />Hub membership confirmed</span><span>{guild?.reportsChannelConfigured ? "Reports channel configured" : "Reports channel not configured"}</span></div> : null}
      {channelUrl ? <button className="secondary" type="button" onClick={() => void openExternal(channelUrl)}><ExternalLink size={14} />Open reports channel</button> : null}
      {readiness.state === "profile" ? <button className="primary" type="button" onClick={onOpenAccount}>Finish profile</button> : null}
      {entry?.error ? <button className="secondary" type="button" onClick={() => onOpenHubs(hubId)}>Check hub membership</button> : null}
      {(readiness.state === "server" || readiness.state === "channel") && journey === "member" ? <p className="muted">{admin ? <button className="recording-sharing-inline-button" type="button" onClick={() => setJourney("admin")}>Finish this server's setup</button> : "Ask a hub owner or co-owner with Discord Manage Server permission to finish server setup."}</p> : null}
    </div> : null}
    {journey === "member" ? <>
      {selectedHub ? <div className="recording-sharing-opt-in"><label className="toggle-row"><span><strong>Automatically share future replay links</strong><small>Post completed interactive replays to this hub's reports channel.</small></span><input type="checkbox" checked={sharing} disabled={busy || (!sharing && (!readiness.canEnableAutomaticSharing || !uploadEnabled))} onChange={(event) => void setSharing(event.target.checked)} /></label><p className="muted">Shared replays use Unlisted links. Anyone with a link can watch. This does not upload video recordings.</p>{!uploadEnabled ? <button className="secondary" type="button" onClick={onOpenReplaySetup}>Set up interactive replays</button> : null}</div> : null}
      <p className="muted">To share one existing game, use Share in your replay library. You do not need to enable automatic sharing.</p>
      <details className="recording-sharing-help"><summary>Using Discord results commands?</summary><p>Run <code>/verify</code> in the connected Discord server and sign in with this RiftLite account. You must also be a current member of its private hub. Verification is for bot commands; it is not required to post your replay links.</p><p>A Discord verification role is optional. Joining a private team does not also join a private hub.</p><button className="secondary" type="button" onClick={() => onOpenHubs(hubId || undefined)}>Open Private Hubs</button></details>
    </> : <div className="recording-sharing-admin">
      <p className="muted">You need owner or co-owner access to the hub and Manage Server permission in Discord.</p>
      {selectedHub && !admin ? <div className="recording-sharing-next"><p>Ask a hub owner or co-owner to complete these steps. Selecting a team does not grant hub administration access.</p><button className="secondary" type="button" onClick={() => onOpenHubs(hubId)}>Open hub</button></div> : null}
      <ol className="recording-sharing-steps">
        <li><div><strong>Choose an account-managed private hub</strong><p>Open Private Hubs to create one, invite players, or claim an older password-only hub.</p></div><button className="secondary" type="button" onClick={() => onOpenHubs(hubId || undefined)}>Open Private Hubs</button></li>
        <li><div><strong>Add the RiftLite Results Bot</strong><p>Choose the Discord server you want to connect.</p></div><button className="secondary" type="button" onClick={() => void openExternal(RESULTS_BOT_INSTALL_URL)}><ExternalLink size={14} />Add bot to server</button></li>
        <li><div><strong>Verify your account in that server</strong><p>Run <code>/verify</code> and open its private link. Use the same RiftLite account shown above.</p>{guild?.verifiedForAccount ? <span className="recording-sharing-positive">Your Discord account is verified in this server.</span> : null}</div><button className="secondary" type="button" onClick={() => void copy("/verify", "Verify command")}><Copy size={14} />Copy command</button></li>
        <li><div><strong>Connect the hub and choose a reports channel</strong><p>In Discord, run <code>/setup</code>, paste the hub ID into <code>hub_id</code>, then select your channel for <code>reports_channel</code>. Choose the channel in Discord's command picker.</p>{selectedHub ? <code className="recording-sharing-hub-id">{hubId}</code> : null}<p>One private hub connects to one Discord server. The <code>verified_role</code> option is optional.</p></div>{selectedHub ? <button className="secondary" type="button" onClick={() => void copy(hubId, "Hub ID")}><Copy size={14} />Copy hub ID</button> : null}</li>
        <li><div><strong>Check the connection and invite your players</strong><p>Return here to check the reports destination. Players accept their own hub invitation and choose whether to share their games.</p></div><button className="secondary" type="button" disabled={!hubId || !accountVerified || entry?.status === "loading"} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14} />Check connection</button></li>
      </ol>
      <details className="recording-sharing-help"><summary>Roles, reports and connection help</summary><p>An automatic member role is optional. If you use it, the bot needs Manage Roles and its role must sit above that member role. This role does not grant private hub membership.</p><p>Run <code>/status</code> to inspect the connection. <code>/weekly-report</code> gives a private report; an authorised admin can use <code>/weekly-report post:true</code> to post it. Reports are not scheduled automatically.</p><p>Run <code>/disconnect</code> to stop the server connection. This leaves previous posts and shared replay links in place.</p></details>
    </div>}
    {selectedIds.length > 0 ? <p className="recording-sharing-selected">Automatic sharing selected for: {selectedIds.map((id) => settings.activeHubs.find((hub) => hub.id === id)?.name || "A previously selected hub").join(", ")}</p> : null}
    {notice ? <p className="recording-sharing-notice" role="status">{notice}</p> : null}
    {error ? <p className="recording-sharing-error" role="alert">{error}</p> : null}
  </div>;
}

function errorMessage(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }
