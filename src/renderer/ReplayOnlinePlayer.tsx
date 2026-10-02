import { useEffect, useRef, useState, type ElementType } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import type { ReplayEmbedSessionResult } from "../shared/types";
import "./GameReplayAssets.css";

/** Uses the same account-scoped Electron partition as the online library. */
export function ReplayOnlinePlayer({ url, accountUid, onClose }: { url: string; accountUid: string; onClose: () => void }) {
  const [session, setSession] = useState<ReplayEmbedSessionResult | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const Webview = "webview" as ElementType;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let current = true;
    setSession(null); setError("");
    let id = "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || !["www.riftlite.com", "riftlite.com"].includes(parsed.hostname)) throw new Error();
      id = /^\/replays\/([A-Za-z0-9_-]{1,128})\/?$/.exec(parsed.pathname)?.[1] || "";
      if (!id) throw new Error();
    } catch { setError("This replay link is not valid."); return; }
    void window.riftlite.prepareReplayEmbed(id).then((result) => { if (current) setSession(result); })
      .catch(() => { if (current) setError("The replay could not be opened. Check your account connection or try again."); });
    return () => { current = false; };
  }, [url, accountUid, retry]);
  return <dialog className="replay-online-player" ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-label="Interactive replay">
    <header><strong>Interactive replay</strong><div className="row-actions">
      <button type="button" className="secondary" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={15} />Reload</button>
      <button type="button" className="secondary" onClick={() => void window.riftlite.openExternalResource(url)}><ExternalLink size={15} />Open in browser</button>
      <button type="button" className="primary" onClick={onClose}><X size={15} />Back to game</button>
    </div></header>
    {error ? <p role="alert">{error}</p> : session ? <Webview src={session.url} partition="persist:riftlite-replay" className="replay-online-webview" /> : <p role="status">Opening your replay…</p>}
  </dialog>;
}
