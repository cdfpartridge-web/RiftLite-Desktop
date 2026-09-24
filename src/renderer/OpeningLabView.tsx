import React, { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  isAllowedOpeningLabUrl,
  RIFTLITE_OPENING_LAB_URL,
  RIFTLITE_TRAINING_WEBVIEW_PARTITION,
} from "../shared/embeddedContentSecurity";
import "./styles/opening-lab.css";

export function OpeningLabView() {
  const [reload, setReload] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const frame = useRef<HTMLElement | null>(null);
  const environment = (
    import.meta as ImportMeta & {
      env?: { DEV?: boolean; VITE_OPENING_LAB_URL?: string };
    }
  ).env;
  const requested = environment?.DEV
    ? environment.VITE_OPENING_LAB_URL
    : undefined;
  const url =
    requested && isAllowedOpeningLabUrl(requested, true)
      ? requested
      : RIFTLITE_OPENING_LAB_URL;
  const TrainingWebview = "webview" as unknown as React.ElementType;

  useEffect(() => {
    const webview = frame.current;
    if (!webview) return;
    const ready = () => setStatus("ready");
    const fail = (event: Event) => {
      const failure = event as Event & {
        isMainFrame?: boolean;
        errorCode?: number;
      };
      if (failure.isMainFrame === false || failure.errorCode === -3) return;
      setStatus("error");
    };
    const crashed = () => setStatus("error");
    webview.addEventListener("dom-ready", ready);
    webview.addEventListener("did-fail-load", fail);
    webview.addEventListener("render-process-gone", crashed);
    return () => {
      webview.removeEventListener("dom-ready", ready);
      webview.removeEventListener("did-fail-load", fail);
      webview.removeEventListener("render-process-gone", crashed);
    };
  }, [reload]);

  return (
    <section className="opening-lab-desktop" aria-label="Opening Turns Lab">
      <div className="opening-lab-desktop-toolbar">
        <span>Real openings · anonymous public and unlisted games</span>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setStatus("loading");
            setReload((v) => v + 1);
          }}
        >
          <RefreshCw size={14} />
          Reload practice
        </button>
      </div>
      {status !== "ready" && (
        <div
          className="opening-lab-desktop-status"
          role={status === "error" ? "alert" : "status"}
        >
          {status === "loading"
            ? "Loading Opening Turns Lab…"
            : "Opening practice could not load. Check your connection, then reload practice."}
        </div>
      )}
      <TrainingWebview
        key={reload}
        ref={frame}
        src={url}
        partition={RIFTLITE_TRAINING_WEBVIEW_PARTITION}
        className="opening-lab-desktop-frame"
        aria-label="Interactive opening practice board"
      />
    </section>
  );
}
