/**
 * Atlas's account sign-in now returns from OAuth to its main site's auth
 * routes. Keep those callbacks in the game's cookie jar; opening them in the
 * system browser loses the state cookie and Atlas rejects the sign-in.
 * This permits navigation only, never game capture or desktop IPC access.
 */
export function isAtlasAuthNavigationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === "https://riftatlas.com" && !url.username && !url.password &&
      /^\/(?:api\/auth|auth)(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}
