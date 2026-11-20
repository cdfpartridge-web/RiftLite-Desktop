import React, { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  RIFTLITE_LOCAL_REPLAY_TEST_PARTITION,
  RIFTLITE_LOCAL_REPLAY_TEST_URL,
} from "../shared/embeddedContentSecurity";
import "./styles/local-replay-test.css";

type CapabilityApi = { getLocalReplayTestCapability?: () => Promise<unknown> };

/** Missing/older preload bridges and failed capability checks keep the normal viewer. */
export async function readLocalReplayTestCapability(api: CapabilityApi): Promise<boolean> {
  try {
    const capability = await api.getLocalReplayTestCapability?.();
    return Boolean(capability && typeof capability === "object" && "enabled" in capability && capability.enabled === true);
  } catch { return false; }
}

export function LocalReplayTestView({ enabled }: { enabled: boolean }) {
  const [reload, setReload] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const frame = useRef<HTMLElement | null>(null);
  const TestWebview = "webview" as unknown as React.ElementType;

  useEffect(() => {
    const webview = frame.current;
    if (!enabled || !webview) return;
    let loadFailed = false;
    const ready = () => { window.clearTimeout(timeout); if (!loadFailed) setStatus("ready"); };
    const fail = (event: Event) => {
      const failure = event as Event & { isMainFrame?: boolean; errorCode?: number };
      if (failure.isMainFrame === false || failure.errorCode === -3) return;
      loadFailed = true;
      window.clearTimeout(timeout); setStatus("error");
    };
    const crashed = () => { loadFailed = true; window.clearTimeout(timeout); setStatus("error"); };
    const timeout = window.setTimeout(() => setStatus("error"), 15_000);
    webview.addEventListener("dom-ready", ready);
    webview.addEventListener("did-fail-load", fail);
    webview.addEventListener("render-process-gone", crashed);
    return () => {
      window.clearTimeout(timeout);
      webview.removeEventListener("dom-ready", ready);
      webview.removeEventListener("did-fail-load", fail);
      webview.removeEventListener("render-process-gone", crashed);
    };
  }, [enabled, reload]);

  return <section className="local-replay-test" aria-label="Local interactive replay test">
    <div className="local-replay-test-toolbar">
      <div><strong>Interactive replays <span>LOCAL TEST</span></strong><p>This test stays on this computer. Your normal app and saved matches are separate.</p></div>
      <button type="button" className="secondary" disabled={!enabled} onClick={() => { setStatus("loading"); setReload(value => value + 1); }}><RefreshCw size={14} /> Reload test</button>
    </div>
    {!enabled ? <p className="local-replay-test-status" role="alert">Local replay testing is not enabled for this app session.</p> : <>
      {status !== "ready" ? <div className="local-replay-test-status" role={status === "error" ? "alert" : "status"}>
        {status === "loading" ? "Loading the local replay test…" : <>The local replay test could not load at <code>{RIFTLITE_LOCAL_REPLAY_TEST_URL}</code>. Start the local replay test server, then select Reload test.</>}
      </div> : null}
      <TestWebview key={reload} ref={frame} src={RIFTLITE_LOCAL_REPLAY_TEST_URL} partition={RIFTLITE_LOCAL_REPLAY_TEST_PARTITION} className="local-replay-test-frame" aria-label="Local Atlas replay test board" />
    </>}
  </section>;
}
