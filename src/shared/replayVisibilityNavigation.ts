/** Keep replay management navigation inside the authenticated RiftLite surface. */
export function parseReplayOnlineTarget(url: string): { replayId: string; manageVisibility: boolean } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !["www.riftlite.com", "riftlite.com"].includes(parsed.hostname) ||
        parsed.port || parsed.username || parsed.password) return null;
    const replayId = /^\/replays\/([A-Za-z0-9_-]{1,128})\/?$/.exec(parsed.pathname)?.[1];
    return replayId ? { replayId, manageVisibility: parsed.searchParams.get("manage") === "visibility" } : null;
  } catch {
    return null;
  }
}

export function replayVisibilityManagementUrl(url: string): string | null {
  const target = parseReplayOnlineTarget(url);
  return target ? `https://www.riftlite.com/replays/${target.replayId}?manage=visibility` : null;
}
