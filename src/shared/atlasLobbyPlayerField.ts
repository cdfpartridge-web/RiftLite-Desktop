export type AtlasLobbyPlayerFieldState = "ready" | "collapsed" | "unavailable" | "blocked";

/**
 * Reads layout only. Keep this function self-contained: the main process also
 * serializes it into Atlas's guest, without this module or any imported helper.
 * Never inspect the player's name, browser storage, or authentication state.
 */
export function readAtlasLobbyPlayerField(): AtlasLobbyPlayerFieldState {
  try {
    const url = new URL(location.href);
    const pathname = url.pathname
      .replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/i, "")
      .replace(/\/+$/, "") || "/";
    if (url.origin !== "https://play.riftatlas.com" || (pathname !== "/" && pathname !== "/lobby")) {
      return "unavailable";
    }
    if (document.readyState === "loading") return "unavailable";
    if (document.visibilityState === "hidden") return "blocked";

    function intentionallyHidden(element: Element): boolean {
      if (element.closest("[hidden], [inert], [aria-hidden='true'], .sr-only")) return true;
      for (let current: Element | null = element; current; current = current.parentElement) {
        const style = window.getComputedStyle(current);
        const opacity = Number.parseFloat(style.opacity);
        const contentVisibility = style.getPropertyValue("content-visibility");
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          contentVisibility === "hidden" ||
          (Number.isFinite(opacity) && opacity <= 0.01)
        ) return true;
      }
      return false;
    }

    function hasUsableBounds(element: Element): boolean {
      const bounds = element.getBoundingClientRect();
      return Number.isFinite(bounds.width) && Number.isFinite(bounds.height) &&
        bounds.width > 1 && bounds.height > 1;
    }

    function visible(element: Element): boolean {
      // checkVisibility() may return false for the very 0x0 layout defect this
      // probe detects. Explicit CSS/attribute hiding is checked separately.
      return !intentionallyHidden(element) && hasUsableBounds(element);
    }

    const field = document.querySelector<HTMLInputElement>("#right-rail-player-name");
    const panel = field?.closest(".lobby-entry-panel");
    if (!field || field.tagName !== "INPUT" || field.type !== "text" || !panel) return "unavailable";
    if (
      intentionallyHidden(field) || field.disabled || field.readOnly || field.matches(":disabled") ||
      field.closest("[aria-busy='true'], [aria-disabled='true']")
    ) return "blocked";

    const blockingSurfaces = document.querySelectorAll(
      "[role='dialog'], dialog[open], .cl-modalBackdrop, .cl-modalContent, .cl-signIn-root, .cl-signUp-root, " +
      "[data-clerk-component='SignIn'], [data-clerk-component='SignUp'], .gb-board, .lobby-room-console"
    );
    for (const surface of Array.from(blockingSurfaces)) {
      if (visible(surface)) return "blocked";
    }
    if (!hasUsableBounds(panel)) return "unavailable";

    const playButtons = panel.querySelectorAll<HTMLButtonElement>(
      ".lobby-quick-match-actions button, .lobby-private-play-actions button, .lobby-room-code-actions button"
    );
    let visiblePlayButtons = 0;
    for (const button of Array.from(playButtons)) {
      if (!visible(button)) continue;
      if (button.disabled || button.matches(":disabled") || button.closest("[aria-busy='true'], [aria-disabled='true']")) {
        return "blocked";
      }
      visiblePlayButtons += 1;
    }
    if (visiblePlayButtons < 2) return "unavailable";

    const bounds = field.getBoundingClientRect();
    if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return "unavailable";
    return hasUsableBounds(field) ? "ready" : "collapsed";
  } catch {
    // A navigation or unknown DOM revision must never trigger speculative repair.
    return "unavailable";
  }
}

export const ATLAS_LOBBY_PLAYER_FIELD_PROBE = `(${readAtlasLobbyPlayerField.toString()})()`;
