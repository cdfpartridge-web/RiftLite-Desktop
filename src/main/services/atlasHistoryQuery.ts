const ATLAS_HISTORY_ORIGIN = "https://play.riftatlas.com";
// Atlas's public CONVEX_URL, verified in its current client on 2026-09-11.
const ATLAS_HISTORY_CONVEX = "https://wary-sturgeon-712.convex.cloud";

/** Runs in Atlas's own main world. Credentials never cross the guest boundary. */
export function atlasHistoryQueryScript(
  path: "gameHistory:list" | "gameHistory:decks",
  args: Record<string, unknown>,
): string {
  // Bound Clerk's token lookup as well as the network read. A timed-out lookup
  // cannot hold the per-match refresh lock indefinitely.
  return `(async () => {
    let timer;
    try {
      return await Promise.race([
        (${queryAtlasHistoryInPage.toString()})(${JSON.stringify({ origin: ATLAS_HISTORY_ORIGIN, endpoint: ATLAS_HISTORY_CONVEX, path, args })}),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Atlas history timed out. Please try again.")), 18000); })
      ]);
    } finally { clearTimeout(timer); }
  })()`;
}

async function queryAtlasHistoryInPage(input: {
  origin: string;
  endpoint: string;
  path: string;
  args: Record<string, unknown>;
}): Promise<unknown> {
  if (location.origin !== input.origin || !["gameHistory:list", "gameHistory:decks"].includes(input.path))
    throw new Error("Open Atlas Play and sign in before refreshing decks.");
  const clerk = (
    window as unknown as {
      Clerk?: {
        session?: { id: string; getToken: (options?: { template: string }) => Promise<string | null> };
      };
    }
  ).Clerk;
  const session = clerk?.session;
  if (!session) throw new Error("Sign in to Atlas Play before refreshing match decks.");
  const sessionId = session.id;
  let token = await session.getToken();
  let nativeConvex = false;
  try {
    const claims = JSON.parse(atob((token || "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    nativeConvex = claims.aud === "convex" || (Array.isArray(claims.aud) && claims.aud.includes("convex"));
  } catch {
    /* Try Atlas's supported Convex JWT template. */
  }
  if (!nativeConvex) token = await session.getToken({ template: "convex" });
  if (!token || clerk?.session?.id !== sessionId)
    throw new Error("Atlas sign-in changed. Refresh match decks again.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${input.endpoint}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path: input.path, args: input.args, format: "json" }),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error("Atlas history is unavailable. Retry from Match details after signing in to Atlas.");
    if (Number(response.headers.get("content-length")) > 512_000)
      throw new Error("Atlas history response was too large.");
    const body = await response.text();
    if (body.length > 512_000) throw new Error("Atlas history response was too large.");
    const result = JSON.parse(body);
    if (clerk?.session?.id !== sessionId || result.status !== "success")
      throw new Error("Atlas history could not be read. Retry after signing in.");
    return { sessionId, value: result.value };
  } finally {
    clearTimeout(timeout);
    token = null;
  }
}
