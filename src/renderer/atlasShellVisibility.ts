export type AtlasShellVisibility = "inactive" | "covered" | "ready";

export type AtlasShellVisibilityEvent =
  | "atlas-entered"
  | "atlas-shell-ready"
  | "webview-load-started"
  | "empty-shell-recovery-started"
  | "atlas-left";

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
      return current === "covered" ? "ready" : current;
    case "webview-load-started":
      return current;
    case "empty-shell-recovery-started":
      return "covered";
    case "atlas-left":
      return "inactive";
  }
}

export function shouldCoverAtlasShell(visibility: AtlasShellVisibility): boolean {
  return visibility === "covered";
}
