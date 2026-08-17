import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import type { HomeLiveTakeover } from "./homeCreatorVideos.js";
import {
  createLiveTakeoverWatchSession,
  type LiveTakeoverWatchSession,
} from "./liveTakeoverWatchSession.js";

const ANALYTICS_CHECKPOINT_MS = 10 * 60 * 1_000;

export type HomeLiveTakeoverPlayerHandle = {
  dismiss(): void;
};

type HomeLiveTakeoverPlayerProps = {
  takeover: HomeLiveTakeover;
};

function sessionId(): string {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 18)}`;
}

export const HomeLiveTakeoverPlayer = forwardRef<
  HomeLiveTakeoverPlayerHandle,
  HomeLiveTakeoverPlayerProps
>(function HomeLiveTakeoverPlayer({ takeover }, forwardedRef) {
  const webviewRef = useRef<HTMLElement | null>(null);
  const sessionRef = useRef<LiveTakeoverWatchSession | null>(null);
  const EmbedWebview = "webview" as unknown as React.ElementType;

  useImperativeHandle(forwardedRef, () => ({
    dismiss() {
      sessionRef.current?.finish("dismissed");
    },
  }), []);

  useEffect(() => {
    const webview = webviewRef.current;
    const watchSession = createLiveTakeoverWatchSession({
      takeover,
      sessionId: sessionId(),
      emit: (payload) => {
        void window.riftlite.trackLiveTakeover(payload).catch(() => {
          // Anonymous analytics must never affect playback.
        });
      },
    });
    sessionRef.current = watchSession;
    if (!webview || !watchSession) {
      return () => {
        if (sessionRef.current === watchSession) sessionRef.current = null;
      };
    }

    const isAvailable = () => document.visibilityState === "visible" && document.hasFocus();
    const handleMediaStarted = () => watchSession.mediaStarted(isAvailable());
    const handleMediaPaused = () => watchSession.mediaPaused();
    const handleAvailability = () => watchSession.availabilityChanged(isAvailable());
    watchSession.start();
    webview.addEventListener("media-started-playing", handleMediaStarted);
    webview.addEventListener("media-paused", handleMediaPaused);
    document.addEventListener("visibilitychange", handleAvailability);
    window.addEventListener("focus", handleAvailability);
    window.addEventListener("blur", handleAvailability);
    const checkpoint = window.setInterval(() => watchSession.checkpoint(), ANALYTICS_CHECKPOINT_MS);

    return () => {
      window.clearInterval(checkpoint);
      webview.removeEventListener("media-started-playing", handleMediaStarted);
      webview.removeEventListener("media-paused", handleMediaPaused);
      document.removeEventListener("visibilitychange", handleAvailability);
      window.removeEventListener("focus", handleAvailability);
      window.removeEventListener("blur", handleAvailability);
      watchSession.finish();
      if (sessionRef.current === watchSession) sessionRef.current = null;
    };
  }, [takeover.analytics?.runId, takeover.channelLogin]);

  return (
    <EmbedWebview
      ref={webviewRef}
      className="home-embed-webview"
      src={takeover.embedUrl}
      allow="autoplay; fullscreen; picture-in-picture"
      allowpopups="true"
      httpreferrer="https://www.riftlite.com/"
      partition={`riftlite-home-live-twitch-${takeover.channelLogin}`}
      webpreferences="backgroundThrottling=false"
    />
  );
});
