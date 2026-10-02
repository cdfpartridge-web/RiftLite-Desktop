import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, RefreshCw, X } from "lucide-react";
import { hasVerifiedRiftLiteAccount } from "../shared/accountIdentity";
import { discordDestinationReadiness, replayDiscordResultNeedsReview } from "../shared/recordingSharingReadiness";
import type { HubHealthStatus, MatchDraft, ReplayRecord, RiftLiteApi, UserSettings } from "../shared/types";
import "./styles/recording-sharing.css";

export type ReplayDiscordShareDialogApi = Pick<RiftLiteApi, "getHubHealth" | "shareRawCaptureToDiscord" | "getReplays">;
export type ReplayDiscordShareDialogProps = {
  replay: ReplayRecord;
  match?: MatchDraft;
  settings: UserSettings;
  onClose: () => void;
  onShared: (updated: ReplayRecord) => void | Promise<void>;
  onOpenSetup?: () => void;
  onReviewResult?: () => void;
  api?: ReplayDiscordShareDialogApi;
};

export function ReplayDiscordShareDialog(props: ReplayDiscordShareDialogProps) {
  return <ShareDialog key={`${props.settings.accountUid}:${props.replay.id}`} {...props} />;
}

type HubEntry = { health?: HubHealthStatus; error?: string; loading: boolean };
function ShareDialog({ replay, match, settings, onClose, onShared, onOpenSetup, onReviewResult, api = window.riftlite }: ReplayDiscordShareDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [entries, setEntries] = useState<Record<string, HubEntry>>({});
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const active = useRef(true);
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLFormElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  busyRef.current = busy;
  const verified = hasVerifiedRiftLiteAccount(settings);
  const hubKey = settings.activeHubs.map((hub) => hub.id).sort().join("\0");
  const pendingResult = replayDiscordResultNeedsReview(replay, match);
  const supported = (replay.platform === "atlas" || replay.platform === "tcga") && Boolean(replay.rawCapture?.localPath);

  useEffect(() => {
    active.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("button, input")?.focus());
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busyRef.current) closeRef.current(); };
    window.addEventListener("keydown", escape);
    return () => { active.current = false; window.cancelAnimationFrame(frame); window.removeEventListener("keydown", escape); document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { if (busy) dialogRef.current?.focus(); }, [busy]);
  useEffect(() => {
    let cancelled = false;
    setEntries({});
    if (!verified) return;
    const ids = hubKey ? hubKey.split("\0") : [];
    setEntries(Object.fromEntries(ids.map((id) => [id, { loading: true }])));
    for (const id of ids) {
      void api.getHubHealth(id).then((health) => {
        if (!cancelled) setEntries((current) => ({ ...current, [id]: { loading: false, health } }));
      }).catch((cause) => {
        if (!cancelled) setEntries((current) => ({ ...current, [id]: { loading: false, error: cause instanceof Error ? cause.message : "Could not check this hub." } }));
      });
    }
    return () => { cancelled = true; };
  }, [api, hubKey, verified, refresh]);

  const readiness = (id: string) => discordDestinationReadiness({ accountUid: settings.accountUid, accountVerified: verified, hubId: id, health: entries[id]?.health, error: entries[id]?.error });
  const eligible = selected.filter((id) => settings.activeHubs.some((hub) => hub.id === id) && readiness(id).state === "configured" && !posted.includes(id));
  const allPosted = posted.length > 0 && selected.every((id) => posted.includes(id));
  async function share() {
    if (busyRef.current || !eligible.length || pendingResult || !supported) return;
    busyRef.current = true;
    setBusy(true); setError(""); setNotice("Preparing this replay and posting its link…");
    try {
      // Explicit per-game destinations; never call a settings or auto-sharing API.
      const result = await api.shareRawCaptureToDiscord(replay.id, eligible);
      if (!active.current) return;
      setPosted((current) => [...new Set([...current, ...result.sharedHubIds])]);
      setNotice(result.status === "shared" ? "Replay posted to the selected Discord destination. Its link is Unlisted; future sharing preferences are unchanged."
        : result.status === "partial" ? "The replay reached some destinations. You can retry the remaining ones." : "The replay has not been posted.");
      if (result.status !== "shared") setError(result.error || "Check the selected server's reports channel and try again.");
      try {
        const saved = (await api.getReplays()).find((item) => item.id === replay.id);
        if (active.current && saved) await onShared(saved);
        else if (active.current) setError("Could not refresh the local replay details. Reopen the replay library to check its current status.");
      } catch (cause) { if (active.current) setError(`The delivery attempt finished, but the library could not be refreshed. ${cause instanceof Error ? cause.message : "Reopen the replay library."}`); }
    } catch (cause) {
      if (active.current) { setNotice(""); setError(cause instanceof Error ? cause.message : "The replay could not be shared. Your automatic sharing choices are unchanged."); }
    } finally { if (active.current) { busyRef.current = false; setBusy(false); } }
  }

  return createPortal(<div className="modal-backdrop hub-lifecycle-backdrop replay-discord-backdrop" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <form className="hub-lifecycle-modal replay-discord-dialog" ref={dialogRef} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="replay-discord-title" aria-describedby="replay-discord-description" aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void share(); }} onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[href],[tabindex]:not([tabindex="-1"])') ?? [])];
      if (!controls.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header><div><span className="eyebrow">Share this game</span><h2 id="replay-discord-title"><MessageCircle size={20} />Post replay to Discord</h2><p>{replay.title || "Your replay"}</p></div><button className="icon-button" type="button" title="Close" aria-label="Close sharing dialog" disabled={busy} onClick={onClose}><X size={19} /></button></header>
      <div className="replay-discord-dialog-body" role="region" aria-label="Replay sharing options" tabIndex={0}>
      <p id="replay-discord-description">Choose where to post this interactive replay. It will use an Unlisted link that anyone with the link can watch. Your automatic sharing preferences stay as they are.</p>
      {!verified ? <p className="settings-note warning">Connect and verify your RiftLite account before sharing this game.</p> : null}
      {!supported ? <p className="settings-note warning">This game does not have an Atlas or TCGA interactive capture available to share.</p> : null}
      {pendingResult ? <div className="settings-note warning"><p>Review and save this match result before posting its replay.</p>{onReviewResult ? <button className="secondary" type="button" disabled={busy} onClick={onReviewResult}>Review result</button> : <p>Close this dialog and choose Review result on the game.</p>}</div> : null}
      <fieldset className="replay-discord-destinations" disabled={busy}><legend>Private hub destinations</legend>
        {settings.activeHubs.map((hub) => { const status = readiness(hub.id); const alreadyPosted = posted.includes(hub.id); return <label className="replay-discord-destination" key={hub.id}>
          <input type="checkbox" checked={selected.includes(hub.id)} disabled={alreadyPosted || status.state !== "configured"} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, hub.id])] : current.filter((id) => id !== hub.id))} />
          <span><strong>{hub.name}</strong><small>{alreadyPosted ? "Posted" : entries[hub.id]?.loading ? "Checking destination…" : status.label}</small>{status.state !== "configured" && !entries[hub.id]?.loading ? <small>{status.detail}</small> : null}</span>
        </label>; })}
        {!settings.activeHubs.length ? <p className="muted">Join your server's private hub to see it here. Private team membership is separate.</p> : null}
      </fieldset>
      <div className="row-actions"><button type="button" className="secondary" disabled={busy || !verified} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14} />Check destinations</button>{onOpenSetup ? <button className="secondary" type="button" disabled={busy} onClick={onOpenSetup}>Recording &amp; sharing setup</button> : null}</div>
      <p className="muted">A Discord role and per-server verification are not required for replay posting. The server needs a configured reports channel and your current private hub membership.</p>
      {notice ? <p className="recording-sharing-notice" role="status">{notice}</p> : null}
      {error ? <p className="recording-sharing-error" role="alert">{error}</p> : null}
      </div>
      <footer><button type="button" className="secondary" disabled={busy} onClick={onClose}>{posted.length ? "Done" : "Cancel"}</button><button className="primary" type="submit" disabled={busy || !verified || !supported || pendingResult || !eligible.length}>{busy ? "Posting…" : allPosted ? "Posted" : posted.length ? "Post to remaining destinations" : "Post replay link"}</button></footer>
    </form>
  </div>, document.body);
}
