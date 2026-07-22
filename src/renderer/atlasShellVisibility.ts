export type AtlasShellVisibility = "inactive" | "covered" | "recovering" | "ready" | "fallback-visible";

export type AtlasShellVisibilityEvent =
  | "atlas-entered"
  | "atlas-shell-ready"
  | "webview-load-started"
  | "empty-shell-recovery-started"
  | "shell-ready-timeout"
  | "atlas-left";

export const ATLAS_SHELL_COVER_TIMEOUT_MS = 12_000;

export const INITIAL_ATLAS_SHELL_VISIBILITY: AtlasShellVisibility = "inactive";

/**
 * Controls only RiftLite's cover over the embedded Atlas page. A normal Atlas
 * navigation (including sign-in) must not hide a page that has already proved
 * it can render. Only a new Atlas visit or an explicit recovery waits for the
 * shell-ready signal again.
 */
export function updateAtlasShellVisibility(
  current: AtlasShellVisibility,
  event: AtlasShellVisibilityEvent
): AtlasShellVisibility {
  switch (event) {
    case "atlas-entered":
      return current === "inactive" ? "covered" : current;
    case "atlas-shell-ready":
      return current === "covered" || current === "recovering" || current === "fallback-visible" ? "ready" : current;
    case "webview-load-started":
      return current;
    case "empty-shell-recovery-started":
      return "recovering";
    case "shell-ready-timeout":
      return current === "covered" || current === "recovering" ? "fallback-visible" : current;
    case "atlas-left":
      return "inactive";
  }
}

export function shouldCoverAtlasShell(visibility: AtlasShellVisibility): boolean {
  return visibility === "covered" || visibility === "recovering";
}
