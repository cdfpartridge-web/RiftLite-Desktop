import React, { useEffect, useRef, useState } from "react";
import { BookOpen, RefreshCw, X } from "lucide-react";

import { RIFTLITE_RULES_WEBVIEW_PARTITION } from "../shared/embeddedContentSecurity";

export const RIFTJUDGE_RULES_URL = "https://app.riftjudge.com/";
export const RULES_SEARCH_DRAWER_ID = "riftjudge-rules-search-drawer";

type RulesSearchLoadState =
  | { status: "loading"; message: string }
  | { status: "ready"; message: string }
  | { status: "error"; message: string };

type WebviewLoadFailureEvent = Event & {
  errorCode?: number;
  errorDescription?: string;
  isMainFrame?: boolean;
};

type WebviewInputEvent = Event & {
  input?: {
    key?: string;
    type?: string;
  };
};

export function RulesSearchDrawer({ onClose }: { onClose: () => void }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [loadState, setLoadState] = useState<RulesSearchLoadState>({
    status: "loading",
    message: "Loading RiftJudge..."
  });
  const webviewRef = useRef<HTMLElement | null>(null);
  const RulesWebview = "webview" as unknown as React.ElementType;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [onClose]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const markLoading = () => {
      setLoadState({ status: "loading", message: "Loading RiftJudge..." });
    };
    const markReady = () => {
      setLoadState({ status: "ready", message: "RiftJudge is ready." });
    };
    const markFailed = (event: Event) => {
      const failure = event as WebviewLoadFailureEvent;
      if (failure.errorCode === -3 || failure.isMainFrame === false) return;
      setLoadState({
        status: "error",
        message: failure.errorDescription
          ? `RiftJudge could not load: ${failure.errorDescription}`
          : "RiftJudge could not load. Check your connection and try again."
      });
    };
    const closeOnGuestEscape = (event: Event) => {
      const input = (event as WebviewInputEvent).input;
      if (input?.type !== "keyDown" || input.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };

    webview.addEventListener("did-start-loading", markLoading);
    webview.addEventListener("dom-ready", markReady);
    webview.addEventListener("did-stop-loading", markReady);
    webview.addEventListener("did-fail-load", markFailed);
    webview.addEventListener("before-input-event", closeOnGuestEscape);
    return () => {
      webview.removeEventListener("did-start-loading", markLoading);
      webview.removeEventListener("dom-ready", markReady);
      webview.removeEventListener("did-stop-loading", markReady);
      webview.removeEventListener("did-fail-load", markFailed);
      webview.removeEventListener("before-input-event", closeOnGuestEscape);
    };
  }, [onClose, reloadKey]);

  const reload = () => {
    setLoadState({ status: "loading", message: "Reloading RiftJudge..." });
    setReloadKey((current) => current + 1);
  };

  return (
    <aside
      id={RULES_SEARCH_DRAWER_ID}
      className="rules-search-drawer"
      role="dialog"
      aria-modal="false"
      aria-labelledby="rules-search-drawer-title"
      aria-describedby="rules-search-drawer-description"
      aria-busy={loadState.status === "loading"}
    >
      <header className="rules-search-drawer__header">
        <div className="rules-search-drawer__identity">
          <span className="rules-search-drawer__mark" aria-hidden="true"><BookOpen size={18} /></span>
          <div>
            <strong id="rules-search-drawer-title">Search Rules</strong>
            <span id="rules-search-drawer-description">RiftJudge community rulings</span>
          </div>
        </div>
        <div className="rules-search-drawer__actions">
          <button
            type="button"
            className="rules-search-drawer__icon-button"
            onClick={reload}
            aria-label="Reload RiftJudge"
            title="Reload RiftJudge"
          >
            <RefreshCw size={16} />
          </button>
          <button
            type="button"
            className="rules-search-drawer__icon-button"
            onClick={onClose}
            aria-label="Close rules search"
            title="Close rules search"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="rules-search-drawer__body">
        <RulesWebview
          ref={webviewRef}
          key={reloadKey}
          className="rules-search-webview"
          src={RIFTJUDGE_RULES_URL}
          partition={RIFTLITE_RULES_WEBVIEW_PARTITION}
          webpreferences="backgroundThrottling=false"
        />
        {loadState.status !== "ready" ? (
          <div className="rules-search-drawer__status" role="status" data-state={loadState.status}>
            {loadState.status === "loading" ? <RefreshCw className="rules-search-drawer__spinner" size={22} /> : <BookOpen size={22} />}
            <span>{loadState.message}</span>
            {loadState.status === "error" ? (
              <button type="button" className="secondary" onClick={reload}>Try again</button>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className="rules-search-drawer__footer">
        Community-sourced answers. Confirm tournament decisions with your head judge.
      </footer>
    </aside>
  );
}
