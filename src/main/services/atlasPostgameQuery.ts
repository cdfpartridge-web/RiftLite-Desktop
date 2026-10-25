export interface AtlasPostgameQueryTarget {
  roomCode: string;
  roomCreatedAt: number;
  gameNumber: number;
  gameHistoryStartedAt: number;
  gameHistoryEndedAt?: number;
  completionCheck?: "atlas";
  completionMatchFormat?: "bo3";
  completionSeriesStartedAt?: number;
  localPlayerId: string;
  expectedPageUrl: string;
}

export type AtlasPostgameQueryResult = {
  status: "deferred";
  gameKey: string;
  accountId?: never;
  sessionId?: never;
  replay?: never;
} | {
  status: "ready" | "pending" | "restricted" | "expired" | "unavailable";
  gameKey: string;
  accountId: string;
  sessionId: string;
  replay?: { format: "riftatlas-replay"; version: 2; nodes: unknown[]; root: { r: number } };
};

/** Run only after the caller's authoritative idle/completed-game fence. No polling occurs in the guest. */
export function atlasPostgameQueryScript(target: AtlasPostgameQueryTarget): string {
  return `(${queryAtlasPostgameInPage.toString()})(${JSON.stringify(target)})`;
}

/** Main calls this when a new game begins, the guest changes, or the collection job is cancelled. */
export function atlasPostgameCancelScript(): string {
  return `(() => { const key = Symbol.for("riftlite.atlas.postgame.request"); window[key]?.abort(); })()`;
}

async function queryAtlasPostgameInPage(target: AtlasPostgameQueryTarget): Promise<AtlasPostgameQueryResult> {
  // Kept self-contained because Electron executes the emitted function in Atlas's main world.
  const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value);
  const verifyCompletion = target.completionCheck === "atlas";
  const verifyBo3 = verifyCompletion && target.completionMatchFormat === "bo3";
  if (!identifier(target.roomCode) || !identifier(target.localPlayerId) || !integer(target.roomCreatedAt) || !integer(target.gameHistoryStartedAt)
    || (target.completionCheck !== undefined && !verifyCompletion)
    || (target.completionMatchFormat !== undefined && !verifyBo3)
    || (verifyBo3 ? !integer(target.completionSeriesStartedAt) || target.completionSeriesStartedAt > target.gameHistoryStartedAt
      : target.completionSeriesStartedAt !== undefined)
    || (target.gameHistoryEndedAt === undefined ? !verifyCompletion : !integer(target.gameHistoryEndedAt) || target.gameHistoryEndedAt < target.gameHistoryStartedAt)
    || !integer(target.gameNumber) || target.gameNumber > 3
    || (verifyCompletion && ((!verifyBo3 && target.gameNumber !== 1) || target.roomCreatedAt > target.gameHistoryStartedAt || target.gameHistoryStartedAt > Date.now() + 60_000))) throw new Error("Invalid completed Atlas game.");
  const gameKey = `${target.roomCode}:${target.roomCreatedAt}:${target.gameNumber}:${target.gameHistoryStartedAt}`;
  const expectedUrl = new URL(target.expectedPageUrl);
  const path = expectedUrl.pathname.replace(/^\/(?:en|zh-CN|fr|ko)(?=\/|$)/, "") || "/";
  // Atlas's Watch replay action leaves /game for this completed game's viewer.
  // Bind that route to the queued game, rather than accepting arbitrary replay pages.
  const replayRoute = /^[A-Z0-9]{3,16}$/.test(target.roomCode)
    && target.roomCreatedAt > 1_500_000_000_000 && target.roomCreatedAt < 4_000_000_000_000
    && target.gameHistoryStartedAt >= target.roomCreatedAt && target.gameHistoryStartedAt < 4_000_000_000_000
    && path === `/replays/${encodeURIComponent(gameKey)}`;
  if (expectedUrl.origin !== "https://play.riftatlas.com" || !(["/", "/game", "/game/", "/lobby", "/lobby/"].includes(path) || replayRoute) || expectedUrl.username || expectedUrl.password || (expectedUrl.searchParams.has("room") && expectedUrl.searchParams.get("room") !== target.roomCode)) throw new Error("Atlas replay collection requires its completed game, replay or lobby.");
  if (location.origin !== expectedUrl.origin || location.href !== expectedUrl.href) throw new Error("Atlas replay collection was cancelled because the game or account changed.");
  // Without a captured ending, even a quiet game page is not proof that play
  // finished. Defer before reading auth or doing any network work.
  if (verifyCompletion && (path === "/game" || path === "/game/" || (!replayRoute && expectedUrl.searchParams.has("room")))) return { status: "deferred", gameKey };
  const slot = Symbol.for("riftlite.atlas.postgame.request");
  const guest = window as unknown as Record<symbol, AbortController | undefined>;
  guest[slot]?.abort();
  const controller = new AbortController(); guest[slot] = controller;
  const check = () => {
    if (controller.signal.aborted || location.origin !== expectedUrl.origin || location.href !== expectedUrl.href || guest[slot] !== controller) throw new Error("Atlas replay collection was cancelled because the game or account changed.");
  };
  let accountChannel: BroadcastChannel | undefined;
  if (typeof BroadcastChannel !== "undefined") {
    accountChannel = new BroadcastChannel("riftatlas-account");
    accountChannel.onmessage = () => controller.abort();
  }
  const onPageHide = () => controller.abort();
  window.addEventListener("pagehide", onPageHide, { once: true });
  let token: string | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  const encoder = new TextEncoder();
  async function read(response: Response, maxBytes: number): Promise<unknown> {
    if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new Error("Atlas replay response exceeded its safe size limit."); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Atlas replay response was empty.");
    let size = 0, text = "";
    const decoder = new TextDecoder();
    try {
      for (;;) {
        check(); const chunk = await reader.read(); check(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new Error("Atlas replay response exceeded its safe size limit."); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      try { return JSON.parse(text); } catch { throw new Error("Atlas returned an invalid replay response."); }
    } finally { reader.releaseLock(); }
  }
  async function fetchJson(url: string, init: RequestInit, maximum: number) {
    check();
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store", redirect: "error" });
    check();
    if (response.redirected) throw new Error("Atlas replay request unexpectedly redirected.");
    if (!response.ok) { await response.body?.cancel(); return { status: response.status, value: null }; }
    return { status: response.status, value: await read(response, maximum) };
  }
  async function auth(kind: "get-session" | "token") {
    const init: RequestInit = { method: kind === "token" ? "POST" : "GET", credentials: "include" };
    let response;
    try { response = await fetchJson(`https://auth.riftatlas.com/api/auth/${kind}`, init, 64 * 1024); }
    catch (error) {
      check();
      // Match Atlas's first-party network fallback, never retry an authentication rejection.
      if (!(error instanceof TypeError)) throw error;
      response = await fetchJson(`https://play.riftatlas.com/api/auth/${kind}`, { ...init, credentials: "same-origin", headers: { "x-account-auth-fallback": "1", "x-account-auth-fallback-reason": "via=retry;error=TypeError" } }, 64 * 1024);
    }
    if (response.status !== 200) throw new Error("Atlas sign-in is unavailable. Sign in to Atlas before collecting the replay.");
    return response.value;
  }
  function sessionIdentity(value: unknown): { accountId: string; sessionId: string } {
    const identity = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 512 && !/[\u0000-\u0020]/.test(id);
    if (!record(value) || !record(value.user) || !identity(value.user.id) || !record(value.session) || !identity(value.session.id)) throw new Error("Sign in to Atlas before collecting the replay.");
    return { accountId: value.user.id, sessionId: value.session.id };
  }
  async function safeReplay(body: unknown, expectedFinalFrameIndex?: number): Promise<NonNullable<AtlasPostgameQueryResult["replay"]>> {
    const forbidden = new Set(["__proto__", "prototype", "constructor"]);
    const primitive = (value: unknown): value is string | number | boolean | null => value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);
    let view: unknown = body, yieldedAt = Date.now();
    const yieldIfNeeded = async () => {
      if (Date.now() - yieldedAt < 8) return;
      await new Promise<void>(resolve => setTimeout(resolve, 0)); check(); yieldedAt = Date.now();
    };
    if (record(body) && body.format === "riftatlas-replay" && body.version === 2) {
      if (!Array.isArray(body.nodes) || !body.nodes.length || body.nodes.length > 100_000) throw new Error("Atlas replay has too many nodes.");
      const values: unknown[] = [], costs: number[] = [], depths: number[] = [];
      let entries = 0;
      for (const [index, node] of body.nodes.entries()) {
        if (!Array.isArray(node) || node.length !== 2 || !["a", "o"].includes(node[0]) || !Array.isArray(node[1])) throw new Error("Atlas replay has invalid nodes.");
        entries += node[1].length; if (entries > 1_000_000) throw new Error("Atlas replay has too many entries.");
        let cost = 2, depth = 1;
        const resolve = (value: unknown) => {
          if (primitive(value)) { cost += encoder.encode(JSON.stringify(value)).length + 1; return value; }
          if (!record(value) || Object.keys(value).length !== 1 || !Number.isSafeInteger(value.r) || (value.r as number) < 0 || (value.r as number) >= index) throw new Error("Atlas replay has invalid references.");
          const ref = value.r as number; cost += costs[ref] + 1; depth = Math.max(depth, depths[ref] + 1); return values[ref];
        };
        let value: unknown;
        if (node[0] === "a") value = node[1].map(resolve);
        else {
          const object: Record<string, unknown> = Object.create(null);
          for (const entry of node[1]) {
            if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || entry[0].length > 512 || forbidden.has(entry[0]) || Object.hasOwn(object, entry[0])) throw new Error("Atlas replay has an invalid property.");
            cost += encoder.encode(JSON.stringify(entry[0])).length + 1; object[entry[0]] = resolve(entry[1]);
          }
          value = object;
        }
        if (cost > 512 * 1024 * 1024 || depth > 48) throw new Error("Atlas replay exceeds safe expansion limits.");
        values.push(value); costs.push(cost); depths.push(depth);
        if (index % 128 === 127) await yieldIfNeeded();
      }
      if (!record(body.root) || Object.keys(body.root).length !== 1 || body.root.r !== values.length - 1) throw new Error("Atlas replay has an invalid root.");
      view = values[values.length - 1];
    } else if (record(body) && body.format === "riftatlas-replay" && body.version === 1) view = body.replay;
    if (!record(view) || view.replayId !== gameKey || view.viewerPlayerId !== target.localPlayerId || view.canSwitchPerspective !== true || view.canFork !== true || view.forkBlockedReason != null || (view.privateDeckPlayerIds !== undefined && (!Array.isArray(view.privateDeckPlayerIds) || view.privateDeckPlayerIds.length > 0)) || !Array.isArray(view.frames) || view.frames.length < 2 || view.frames.length > 10_000) throw new Error("Atlas returned a restricted or mismatched replay.");
    const last = view.frames[view.frames.length - 1];
    if (!record(last) || !record(last.state)) throw new Error("Atlas replay has no completed ending.");
    const state = last.state;
    if (state.roomCode !== target.roomCode || state.createdAt !== target.roomCreatedAt || state.gameHistoryStartedAt !== target.gameHistoryStartedAt || (state.gameNumber ?? 1) !== target.gameNumber || state.gameVariant !== "duel" || !Array.isArray(state.players) || state.players.length !== 2 || !record(state.gameOutcome) || !Array.isArray(state.gameOutcome.winnerPlayerIds) || state.gameOutcome.winnerPlayerIds.length !== 1) throw new Error("Atlas replay does not match this completed duel.");
    if (verifyCompletion) {
      // Atlas's ready metadata supplies finalFrameIndex, not completedAt. The
      // full export must independently prove completion for that exact frame.
      const ids = Array.isArray(view.players) ? view.players.map(player => record(player) && identifier(player.id) ? player.id : "") : [];
      const completedAt = view.completedAt;
      if (view.createdAt !== target.gameHistoryStartedAt || !integer(completedAt) || completedAt < target.gameHistoryStartedAt || completedAt > Date.now() + 60_000
        || ids.length !== 2 || new Set(ids).size !== 2 || ids.includes("") || !ids.includes(target.localPlayerId)
        || expectedFinalFrameIndex !== view.frames.length - 1 || last.index !== expectedFinalFrameIndex
        || !["score", "concession"].includes(String(state.gameOutcome.reason)) || typeof state.gameOutcome.winnerPlayerIds[0] !== "string" || !ids.includes(state.gameOutcome.winnerPlayerIds[0])
        || (state.gameHistoryEndedAt !== undefined && state.gameHistoryEndedAt !== completedAt)) throw new Error("Atlas replay completion could not be confirmed.");
      let previousSequence = -1, previousElapsed = -1;
      for (const [index, frame] of view.frames.entries()) {
        if (!record(frame) || !record(frame.state) || frame.index !== index || !Number.isSafeInteger(frame.sequence) || (frame.sequence as number) < 0 || (frame.sequence as number) < previousSequence
          || typeof frame.elapsedMs !== "number" || !Number.isFinite(frame.elapsedMs) || frame.elapsedMs < previousElapsed || frame.elapsedMs < 0 || frame.elapsedMs > completedAt - target.gameHistoryStartedAt + 1000
          || frame.state.roomCode !== target.roomCode || frame.state.createdAt !== target.roomCreatedAt || frame.state.gameHistoryStartedAt !== target.gameHistoryStartedAt
          || (frame.state.gameNumber ?? 1) !== target.gameNumber || frame.state.matchFormat !== (verifyBo3 ? "bo3" : "bo1")
          || (verifyBo3 && frame.state.seriesStartedAt !== target.completionSeriesStartedAt)
          || frame.state.gameVariant !== "duel" || frame.state.testMode !== false || frame.state.rewindProtocolVersion !== 5
          || !Array.isArray(frame.state.players) || frame.state.players.length !== 2
          || new Set(frame.state.players.map(player => record(player) ? player.id : undefined)).size !== 2
          || frame.state.players.some(player => !record(player) || typeof player.id !== "string" || !ids.includes(player.id))) throw new Error("Atlas replay completion could not be confirmed.");
        previousSequence = frame.sequence as number; previousElapsed = frame.elapsedMs;
        if (index % 128 === 127) await yieldIfNeeded();
      }
      if (Math.abs(previousElapsed - (completedAt - target.gameHistoryStartedAt)) > 1000) throw new Error("Atlas replay completion could not be confirmed.");
    }
    const keys = (words: string) => new Set(words.split(" "));
    const allowed: Record<string, Set<string>> = {
      view: keys("replayId viewerPlayerId players canFork forkBlockedReason privateDeckPlayerIds canSwitchPerspective canExtend createdAt completedAt expiresAt frames"), metaPlayer: keys("id name seat"),
      frame: keys("index sequence elapsedMs actionType actorPlayerId turnNumber activePlayerId state"),
      state: keys("roomCode createdAt updatedAt phase rewindProtocolVersion testMode gameVariant roomMode teamIdByPlayerId playMode deckRulesMode matchFormat gameNumber seriesStartedAt winsByPlayerId gameHistoryStartedAt gameHistoryEndedAt firstPlayerId activeTurnPlayerId activeTurnStep turnNumber playerTurnCounts players log chainEntries chainResolveVotes gameOutcome bo3CompletedGames targetArrowsByPlayer mulliganPlaybackByPlayerId"),
      player: keys("id seat name joinedAt leftAt leftReason selectedBattlefield board"),
      board: keys("score floatingEnergy floatingPower legendXp deck hand base trash discard banished battlefieldA battlefieldB battlefieldC battlefieldToken champion legend additionalLegends runeDeck runeArea sideboard removed recycledDeckBottomCount handRevealToOpponent handRevealedToPlayerIds deckPeek"),
      card: keys("id name source exhausted createdAt ownerPlayerId isDuplicate hidden revealedToPlayerIds revealedToOpponent oriannaAnimation neekoSourceCardId attachedToCardId banishedByCardId banishedUntilEndingPlayerId empowerTriggerUsed cardCode hasWhenYouPlayMe type domains text energyCost powerCost might temporaryMightBuff whiteCounter redCounter customLabels rarity set keywords subtypes isPlaceholder"),
      chain: keys("id card addedAt fromZone sourceCardId byPlayerId byPlayerName repeatEnabled flowEnabled passesShowdownFocusOnResolution"), log: keys("id at text authorPlayerId turnNumber turnPlayerId actionKind"), outcome: keys("winnerPlayerIds reason decidedAtTurnNumber"), peek: keys("zone cardIds revealedCardIds autoRevealNewCards revision"), arrow: keys("sourceCardId targetCardId sourceAnchor targetAnchor"), animation: keys("legendId type might whiteCounter"), completedGame: keys("gameNumber scoresByPlayerId actionClockMsByPlayerId durationMs"),
      mulligan: keys("redrawCount draws"), mulliganDraw: keys("id cardId handCountBeforeDraw kind"),
    };
    function kindFor(kind: string, key: string) {
      if (kind.endsWith("[]")) return kind.slice(0, -2);
      if (kind === "view" && key === "players") return "metaPlayer[]";
      if (kind === "view" && key === "frames") return "frame[]";
      if (kind === "frame" && key === "state") return "state";
      if (kind === "state" && key === "players") return "player[]";
      if (kind === "state" && key === "chainEntries") return "chain[]";
      if (kind === "state" && key === "log") return "log[]";
      if (kind === "state" && key === "gameOutcome") return "outcome";
      if (kind === "state" && key === "targetArrowsByPlayer") return "arrowMap";
      if (kind === "arrowMap") return "arrow[]";
      if (kind === "state" && key === "mulliganPlaybackByPlayerId") return "mulliganMap";
      if (kind === "mulliganMap") return "mulligan";
      if (kind === "mulligan" && key === "draws") return "mulliganDraw[]";
      if (kind === "state" && ["teamIdByPlayerId", "winsByPlayerId", "playerTurnCounts"].includes(key)) return "scalarMap";
      if (kind === "state" && key === "bo3CompletedGames") return "completedGame[]";
      if (kind === "completedGame" && ["scoresByPlayerId", "actionClockMsByPlayerId"].includes(key)) return "scalarMap";
      if (kind === "player" && key === "board") return "board";
      if (kind === "chain" && key === "card") return "card";
      if (kind === "card" && key === "oriannaAnimation") return "animation";
      if (kind === "board" && key === "deckPeek") return "peek";
      if (kind === "board" && !["score", "floatingEnergy", "floatingPower", "legendXp", "recycledDeckBottomCount", "handRevealToOpponent", "handRevealedToPlayerIds"].includes(key)) return "card[]";
      return "json";
    }
    const nodes: unknown[] = [], memo = new WeakMap<object, Map<string, number>>(), active = new WeakSet<object>();
    const participantIds = new Set(state.players.flatMap(player => record(player) && typeof player.id === "string" ? [player.id] : []));
    const boundedCount = (value: unknown, maximum: number) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
    const playbackId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\u0000-\u0020]/.test(value);
    const playbackValidation = new WeakMap<object, boolean>();
    function validMulliganPlayback(value: unknown): boolean {
      if (!record(value)) return false;
      const cached = playbackValidation.get(value); if (cached !== undefined) return cached;
      const playerIds = Object.keys(value);
      const valid = participantIds.size === 2 && playerIds.length === 2 && playerIds.every(playerId => {
        const playback = value[playerId];
        return participantIds.has(playerId) && record(playback) && boundedCount(playback.redrawCount, 4)
          && Array.isArray(playback.draws) && playback.draws.length <= 5 && playback.draws.every(draw =>
            record(draw) && playbackId(draw.id) && playbackId(draw.cardId)
            && boundedCount(draw.handCountBeforeDraw, 4) && (draw.kind === "refill" || draw.kind === "opening"));
      });
      playbackValidation.set(value, valid);
      return valid;
    }
    let entries = 0;
    async function encode(value: unknown, kind: string, depth: number): Promise<unknown> {
      if (primitive(value)) return value;
      if (!value || typeof value !== "object" || depth > 48 || active.has(value) || kind === "json" && !Array.isArray(value)) throw new Error("Atlas replay has invalid nested data.");
      const previous = memo.get(value)?.get(kind); if (previous !== undefined) return { r: previous };
      active.add(value);
      const children: unknown[] = [];
      for (const [key, child] of Object.entries(value)) {
        if (++entries > 1_000_000 || forbidden.has(key) || key.length > 512) throw new Error("Atlas replay exceeds safe import limits.");
        if (!Array.isArray(value) && allowed[kind] && !allowed[kind].has(key)) continue;
        // Invalid optional playback must not block the ordinary completed
        // replay or turn this into an arbitrary per-player payload channel.
        if (kind === "state" && key === "mulliganPlaybackByPlayerId" && !validMulliganPlayback(child)) continue;
        if (/^(?:authorization|authentication|auth|token|(?:access|refresh|identity|id|api|bearer|session|auth|csrf)[_-]?token|cookies?|password|secret|credentials?)$/i.test(key)) continue;
        const encoded = await encode(child, kindFor(kind, key), depth + 1);
        children.push(Array.isArray(value) ? encoded : [key, encoded]);
      }
      active.delete(value);
      const index = nodes.length; if (index >= 100_000) throw new Error("Atlas replay exceeds safe import limits.");
      nodes.push([Array.isArray(value) ? "a" : "o", children]);
      const kinds = memo.get(value) ?? new Map<string, number>(); kinds.set(kind, index); memo.set(value, kinds);
      if (index % 128 === 127) await yieldIfNeeded();
      return { r: index };
    }
    const root = await encode(view, "view", 0) as { r: number };
    const result = { format: "riftatlas-replay" as const, version: 2 as const, nodes, root };
    if (encoder.encode(JSON.stringify(result)).length > 3_900_000) throw new Error("Atlas replay is too large to attach safely.");
    return result;
  }
  try {
    return await Promise.race([
      (async (): Promise<AtlasPostgameQueryResult> => {
        check(); const initial = sessionIdentity(await auth("get-session")); check();
        const tokenValue = await auth("token");
        if (!record(tokenValue) || typeof tokenValue.token !== "string" || tokenValue.token.length > 20_000) throw new Error("Atlas account token is unavailable.");
        token = tokenValue.token;
        let claims: Record<string, unknown>;
        try { claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { throw new Error("Atlas account token is invalid."); }
        if (!record(claims) || claims.sub !== initial.accountId || typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) throw new Error("Atlas account changed during replay collection.");
        const api = `https://realtime.riftatlas-workers.com/api/replays/${encodeURIComponent(gameKey)}`;
        const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.riftatlas.replay+json;version=2" };
        const metadataResponse = await fetchJson(`${api}/metadata`, { headers, credentials: "omit" }, 64 * 1024);
        const base = { gameKey, ...initial };
        if ([202, 404, 409].includes(metadataResponse.status)) return { ...base, status: "pending" };
        if (metadataResponse.status === 410) return { ...base, status: "expired" };
        if (metadataResponse.status === 429 || metadataResponse.status >= 500) throw new Error("Atlas replay is temporarily unavailable. Retry collection later.");
        if (metadataResponse.status !== 200) return { ...base, status: "unavailable" };
        const metadata = metadataResponse.value;
        if (!record(metadata) || metadata.gameKey !== gameKey) throw new Error("Atlas replay metadata did not match the completed game.");
        if (metadata.status === "pending") return { ...base, status: "pending" };
        if (metadata.status === "expired" || typeof metadata.expiresAt === "number" && metadata.expiresAt <= Date.now()) return { ...base, status: "expired" };
        if (metadata.status !== "ready") return { ...base, status: "unavailable" };
        if (metadata.canFork !== true || metadata.forkBlockedReason != null) return { ...base, status: "restricted" };
        if (!Array.isArray(metadata.ownPlayerIds) || !metadata.ownPlayerIds.includes(target.localPlayerId)) throw new Error("The signed-in Atlas account does not own this replay.");
        if (verifyCompletion && (typeof metadata.gameId !== "string" || !metadata.gameId || metadata.gameId.length > 512
          || typeof metadata.expiresAt !== "number" || !Number.isFinite(metadata.expiresAt)
          || !metadata.ownPlayerIds.every(id => typeof id === "string") || !Number.isSafeInteger(metadata.finalFrameIndex)
          || (metadata.finalFrameIndex as number) < 1 || (metadata.finalFrameIndex as number) >= 10_000)) return { ...base, status: "pending" };
        const full = await fetchJson(api, { headers, credentials: "omit" }, 4 * 1024 * 1024);
        if ([202, 404, 409].includes(full.status)) return { ...base, status: "pending" };
        if (full.status === 410) return { ...base, status: "expired" };
        if (full.status === 429 || full.status >= 500) throw new Error("Atlas replay is temporarily unavailable. Retry collection later.");
        if (full.status !== 200) return { ...base, status: "unavailable" };
        check(); const replay = await safeReplay(full.value, verifyCompletion ? metadata.finalFrameIndex as number : undefined);
        const final = sessionIdentity(await auth("get-session")); check();
        if (final.accountId !== initial.accountId || final.sessionId !== initial.sessionId) throw new Error("Atlas account changed during replay collection.");
        return { ...base, status: "ready", replay };
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Atlas replay collection timed out.")); }, 30_000); }),
    ]);
  } finally {
    token = null; controller.abort(); clearTimeout(timer); accountChannel?.close(); window.removeEventListener("pagehide", onPageHide);
    if (guest[slot] === controller) delete guest[slot];
  }
}
