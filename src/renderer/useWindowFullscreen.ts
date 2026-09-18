import { useEffect, useState } from "react";
import type { RiftLiteApi } from "../shared/types";

type FullscreenApi = Pick<RiftLiteApi, "getWindowFullscreen" | "onWindowFullscreenChanged">;

export function observeWindowFullscreen(api: FullscreenApi, update: (fullscreen: boolean) => void): () => void {
  let active = true;
  let receivedNativeEvent = false;
  const unsubscribe = api.onWindowFullscreenChanged((fullscreen) => {
    receivedNativeEvent = true;
    if (active) update(fullscreen);
  });
  // Subscribe first: a transition during the initial query must win over its
  // potentially stale answer, especially during macOS fullscreen animations.
  void api.getWindowFullscreen().then((fullscreen) => {
    if (active && !receivedNativeEvent) update(fullscreen);
  }).catch(() => undefined);
  return () => {
    active = false;
    unsubscribe();
  };
}

export function useWindowFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => observeWindowFullscreen(window.riftlite, setFullscreen), []);
  return fullscreen;
}
