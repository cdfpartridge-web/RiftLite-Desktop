import { useEffect, useRef, useState, type ElementType } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import type { ReplayEmbedSessionResult } from "../shared/types";
import { parseReplayOnlineTarget } from "../shared/replayVisibilityNavigation";
import "./GameReplayAssets.css";

/** Uses the same account-scoped Electron partition as the online library. */
export function ReplayOnlinePlayer({ url, accountUid, onClose }: { url: string; accountUid: string; onClose: () => void }) {
  const [session, setSession] = useState<ReplayEmbedSessionResult | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const Webview = "webview" as ElementType;
  const manageVisibility = parseReplayOnlineTarget(url)?.manageVisibility === true;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let current = true;
    setSession(null); setError("");
    const target = parseReplayOnlineTarget(url);
    if (!target) { setError("This replay link is not valid."); return; }
    void window.riftlite.prepareReplayEmbed(target.replayId).then((result) => {
      if (!current) return;
      const destination = new URL(result.url);
      if (target.manageVisibility) destination.searchParams.set("manage", "visibility");
      setSession({ ...result, url: destination.toString() });
    })
      .catch(() => { if (current) setError("The replay could not be opened. Check your account connection or try again."); });
    return () => { current = false; };
  }, [url, accountUid, retry]);
  return <dialog className="replay-online-player" ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-label={manageVisibility ? "Replay visibility" : "Interactive replay"}>
    <header><strong>{manageVisibility ? "Replay visibility" : "Interactive replay"}</strong><div className="row-actions">
      <button type="button" className="secondary" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={15} />Reload</button>
      <button type="button" className="secondary" onClick={() => void window.riftlite.openExternalResource(url)}><ExternalLink size={15} />Open in browser</button>
      <button type="button" className="primary" onClick={onClose}><X size={15} />Back to game</button>
    </div></header>
    {error ? <p role="alert">{error}</p> : session ? <Webview src={session.url} partition="persist:riftlite-replay" className="replay-online-webview" /> : <p role="status">Opening your replay…</p>}
  </dialog>;
}
