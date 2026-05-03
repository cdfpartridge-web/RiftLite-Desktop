import type { CaptureEvent, GamePlatform, MatchDraft, MatchGame, ReplayStructuredEvent, UserSettings } from "../../shared/types.js";
import { normalizeLegendName } from "../../shared/legendNames.js";
import { privateHubSyncEnabled, publicCommunitySyncEnabled } from "../../shared/syncPolicy.js";
import { readTcgaLocalPlayerName, readTcgaProfileName } from "../../shared/tcgaIdentity.js";

export interface ResolvedSnapshot {
  myChampion?: string;
  opponentChampion?: string;
  myBattlefield?: string;
  opponentBattlefield?: string;
}

interface GameDraftState {
  gameNumber: number;
  myPoints?: number;
  oppPoints?: number;
  result?: MatchGame["result"];
  myBattlefield: string;
  opponentBattlefield: string;
  myBattlefieldImage: string;
  opponentBattlefieldImage: string;
  wentFirst: "1st" | "2nd" | "undecided" | "";
}

interface ReplayCardState {
  key: string;
  name: string;
  code: string;
  image: string;
  zone: string;
  side: ReplayStructuredEvent["side"];
}

interface SessionState {
  platform: GamePlatform;
  startedAt: string;
  updatedAt: string;
  evidence: CaptureEvent[];
  replayEvents: ReplayStructuredEvent[];
  replaySeenRows: Set<string>;
  replayVisibleCards: Map<string, ReplayCardState>;
  replayCardBaselineReady: boolean;
  replayLastScore: string;
  replayLastBattlefields: string;
  replayLastTurnText: string;
  replayLastTurnAt: number;
  sticky: Record<string, unknown>;
  currentGame: GameDraftState;
  completedGames: MatchGame[];
  atlasHeldResultSignature?: string;
}

export class MatchSessionTracker {
  private readonly sessions = new Map<GamePlatform, SessionState>();

  ingest(event: CaptureEvent): SessionState | undefined {
    if (event.kind === "capture-ready") {
      return this.sessions.get(event.platform);
    }
    let session = this.sessions.get(event.platform);
    const active = readBoolean(event.payload.active);
    if (event.kind.startsWith("network") && !session) {
      return undefined;
    }
    if (!session && (event.kind === "match-start" || active)) {
      session = createSession(event);
      this.sessions.set(event.platform, session);
    }
    if (!session) {
      return undefined;
    }
    if (shouldStartFreshSession(session, event)) {
      session = createSession(event);
      this.sessions.set(event.platform, session);
    }
    session.updatedAt = event.capturedAt;
    session.evidence.push(event);
    if (session.evidence.length > 160) {
      session.evidence = session.evidence.slice(-160);
    }
    mergeSticky(session.sticky, event.payload);
    updateCurrentGame(session, event.payload);
    updateReplayStream(session, event);
    return session;
  }

  shouldHoldForBo3(platform: GamePlatform, endEvent: CaptureEvent): boolean {
    const session = this.sessions.get(platform);
    const reason = readString(endEvent.payload.reason);
    if (!session || (reason !== "inactive-debounce" && !isAtlasBetweenGameEnd(platform, endEvent.payload))) {
      return false;
    }
    const games = previewGames(session);
    if (shouldReleaseUnfinishedBo3(session, reason, games)) {
      return false;
    }
    if (isAtlasGameResultHold(session, endEvent.payload)) {
      return !isBo3Complete(games);
    }
    const rawFormat = readString(session.sticky.format).toLowerCase();
    const hasExplicitBo3 = rawFormat.includes("bo3") || rawFormat.includes("best of 3");
    const hasMultipleGames = session.completedGames.length > 1 || games.filter(gameHasNonZeroScore).length > 1;
    const hasStartedNextGame = session.completedGames.length > 0 && gameStateHasNonZeroScore(session.currentGame);
    const isBo3 = hasExplicitBo3 || hasMultipleGames || hasStartedNextGame;
    return isBo3 && !isBo3Complete(games);
  }

  holdCurrentGame(platform: GamePlatform, endEvent?: CaptureEvent): void {
    const session = this.sessions.get(platform);
    if (!session) {
      return;
    }
    const heldSignature = session.platform === "atlas"
      ? endEvent
        ? atlasPayloadResultSignature(endEvent.payload)
        : atlasGameResultSignature(finishCurrentGame(session.currentGame))
      : "";
    completeCurrentGame(session);
    if (heldSignature) {
      session.atlasHeldResultSignature = heldSignature;
    }
  }

  clear(platform: GamePlatform): void {
    this.sessions.delete(platform);
  }

  get(platform: GamePlatform): SessionState | undefined {
    return this.sessions.get(platform);
  }

  getReplayEvents(platform: GamePlatform): ReplayStructuredEvent[] {
    return [...(this.sessions.get(platform)?.replayEvents ?? [])];
  }

  getLiveOverlayMatch(): Record<string, unknown> | null {
    const session = [...this.sessions.values()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    if (!session) {
      return null;
    }
    const score = scoreTextFromGameState(session.currentGame);
    const myChampion = normalizeLegendName(readString(session.sticky.myChampion));
    const opponentChampion = normalizeLegendName(readString(session.sticky.opponentChampion));
    const opponentName = readString(session.sticky.opponentName);
    const myBattlefield = readString(session.currentGame.myBattlefield) || readString(session.sticky.myBattlefield);
    const opponentBattlefield = readString(session.currentGame.opponentBattlefield) || readString(session.sticky.opponentBattlefield);
    const hasLiveIdentity = Boolean(myChampion || opponentChampion || opponentName || score || myBattlefield || opponentBattlefield);
    if (!hasLiveIdentity) {
      return null;
    }
    return {
      platform: session.platform,
      updatedAt: session.updatedAt,
      gameNumber: session.currentGame.gameNumber,
      myChampion,
      opponentChampion,
      opponentName,
      score,
      myBattlefield,
      opponentBattlefield,
      format: inferFormat(session.sticky, previewGames(session))
    };
  }

  attachReplayScreenshot(platform: GamePlatform, eventId: string, screenshot: NonNullable<ReplayStructuredEvent["screenshot"]>): void {
    const event = this.sessions.get(platform)?.replayEvents.find((item) => item.id === eventId);
    if (event) {
      event.screenshot = screenshot;
    }
  }

  buildDraft(
    platform: GamePlatform,
    endEvent: CaptureEvent,
    settings: UserSettings,
    resolved: ResolvedSnapshot = {}
  ): MatchDraft {
    const session = this.sessions.get(platform) ?? createSession(endEvent);
    mergeSticky(session.sticky, endEvent.payload);
    updateCurrentGame(session, endEvent.payload);
    const hasTerminalResult = Boolean(resultFromText(session.sticky.endText));
    const finalGame = normalizeAmbiguousInactiveGame(finishCurrentGame(session.currentGame), hasTerminalResult);
    const keptGames = [...session.completedGames, finalGame].filter(isWorthKeeping);
    const rawGames = keptGames.length ? keptGames : [finalGame];
    const format = inferFormat(session.sticky, rawGames);
    const games = format === "Bo3" ? applyBo3BattlefieldConfidenceGuard(rawGames) : rawGames;
    const primaryGame = games[0];
    const result = resultFromText(session.sticky.endText) ?? unfinishedBo3Result(format, games) ?? resultFromGames(games);
    const now = new Date().toISOString();
    const status = result === "Incomplete" ? "incomplete" : "pending-review";
    const myName = readMyName(session.sticky, settings.username);
    const opponentName = readOpponentName(session.sticky, myName, settings.username);
    return {
      id: crypto.randomUUID(),
      platform,
      status,
      capturedAt: session.startedAt,
      updatedAt: now,
      result,
      format,
      score: scoreFromGames(games),
      myName,
      opponentName,
      myChampion: normalizeLegendName(readString(resolved.myChampion) || readString(session.sticky.myChampion)),
      opponentChampion: normalizeLegendName(readString(resolved.opponentChampion) || readString(session.sticky.opponentChampion)),
      myBattlefield: primaryGame?.myBattlefield || readString(session.sticky.myBattlefield) || readString(resolved.myBattlefield),
      opponentBattlefield: primaryGame?.oppBattlefield || readString(session.sticky.opponentBattlefield) || readString(resolved.opponentBattlefield),
      deckName: readDeckName(session.sticky),
      deckSourceId: readDeckSourceId(session.sticky),
      deckSourceKey: readDeckSourceId(session.sticky),
      deckSourceUrl: readDeckSourceUrl(session.sticky),
      deckSnapshotJson: "",
      flags: "",
      notes: status === "incomplete" ? "Incomplete capture. Please review details." : "",
      games,
      rawEvidence: [...session.evidence, endEvent].slice(-160),
      sync: {
        community: publicCommunitySyncEnabled(settings) ? "pending" : "disabled",
        hubs: privateHubSyncEnabled(settings)
          ? Object.fromEntries(settings.activeHubs.filter((hub) => hub.sync).map((hub) => [hub.id, "pending"]))
          : {}
      }
    };
  }
}

function createSession(event: CaptureEvent): SessionState {
  const sticky: Record<string, unknown> = {};
  mergeSticky(sticky, event.payload);
  return {
    platform: event.platform,
    startedAt: event.capturedAt,
    updatedAt: event.capturedAt,
    evidence: [event],
    replayEvents: [],
    replaySeenRows: new Set<string>(),
    replayVisibleCards: new Map<string, ReplayCardState>(),
    replayCardBaselineReady: false,
    replayLastScore: "",
    replayLastBattlefields: "",
    replayLastTurnText: "",
    replayLastTurnAt: 0,
    sticky,
    currentGame: createGameState(1),
    completedGames: []
  };
}

function shouldStartFreshSession(session: SessionState, event: CaptureEvent): boolean {
  if (!readBoolean(event.payload.active)) {
    return false;
  }
  const existingOpponent = normalizeNameKey(readString(session.sticky.opponentName));
  const nextOpponent = normalizeNameKey(readString(event.payload.opponentName));
  if (!existingOpponent || !nextOpponent || existingOpponent === nextOpponent) {
    return false;
  }
  const nextScore = readScore(event.payload);
  const nextScoreTotal = (nextScore.me ?? 0) + (nextScore.opp ?? 0);
  const currentScoreTotal = (session.currentGame.myPoints ?? 0) + (session.currentGame.oppPoints ?? 0);
  const previousGameTotals = session.completedGames.map((game) => (game.myPoints ?? 0) + (game.oppPoints ?? 0));
  const previousLooksPlayed = currentScoreTotal >= 6 || previousGameTotals.some((total) => total >= 6);
  const nextLooksFresh = event.kind === "match-start" || nextScoreTotal <= 1 || nextScoreTotal <= currentScoreTotal - 4;
  return previousLooksPlayed && nextLooksFresh;
}

function mergeSticky(target: Record<string, unknown>, source: Record<string, unknown>): void {
  const keys = [
    "myName",
    "opponentName",
    "myChampion",
    "opponentChampion",
    "myChampionImage",
    "opponentChampionImage",
    "myBattlefield",
    "opponentBattlefield",
    "myBattlefieldImage",
    "opponentBattlefieldImage",
    "battlefieldCandidates",
    "deckName",
    "deckSourceId",
    "selectedDeck",
    "playerData",
    "roomCode",
    "cards",
    "counterPlayers",
    "localPlayerName",
    "configuredUsername",
    "format",
    "endText"
  ];
  for (const key of keys) {
    const value = source[key];
    if ((key === "myBattlefield" || key === "opponentBattlefield") && isGeneratedBattlefieldName(readString(value))) {
      continue;
    }
    if ((key === "myBattlefieldImage" || key === "opponentBattlefieldImage") && isGeneratedBattlefieldImage(readString(value))) {
      continue;
    }
    if (hasValue(value)) {
      target[key] = value;
    }
  }
}

function updateCurrentGame(session: SessionState, payload: Record<string, unknown>): void {
  if (isAtlasHeldResultEcho(session, payload)) {
    return;
  }
  if (isAtlasTerminalEchoAfterHeldGame(session, payload)) {
    return;
  }
  if (session.platform === "atlas" && session.atlasHeldResultSignature && readString(payload.atlasResultKind) !== "game-result") {
    session.atlasHeldResultSignature = "";
  }
  if (readString(payload.reason) === "active-returned") {
    completeCurrentGame(session);
  }
  const score = readScore(payload);
  if (shouldStartNextGame(session, score, payload)) {
    completeCurrentGame(session);
  }
  const exactScore = shouldUseExactAtlasResultScore(session, payload);
  if (typeof score.me === "number") {
    session.currentGame.myPoints = exactScore ? score.me : Math.max(session.currentGame.myPoints ?? score.me, score.me);
  }
  if (typeof score.opp === "number") {
    session.currentGame.oppPoints = exactScore ? score.opp : Math.max(session.currentGame.oppPoints ?? score.opp, score.opp);
  }
  const myBattlefield = readString(payload.myBattlefield);
  const opponentBattlefield = readString(payload.opponentBattlefield);
  const myBattlefieldImage = readBattlefieldImage(payload, "me");
  const opponentBattlefieldImage = readBattlefieldImage(payload, "opponent");
  if (myBattlefield && !isGeneratedBattlefieldName(myBattlefield)) {
    session.currentGame.myBattlefield = myBattlefield;
  }
  if (opponentBattlefield && !isGeneratedBattlefieldName(opponentBattlefield)) {
    session.currentGame.opponentBattlefield = opponentBattlefield;
  }
  if (myBattlefieldImage && !isGeneratedBattlefieldImage(myBattlefieldImage)) {
    session.currentGame.myBattlefieldImage = myBattlefieldImage;
  }
  if (opponentBattlefieldImage && !isGeneratedBattlefieldImage(opponentBattlefieldImage)) {
    session.currentGame.opponentBattlefieldImage = opponentBattlefieldImage;
  }
  const result = resultFromText(payload.endText);
  if (result && result !== "Incomplete") {
    session.currentGame.result = result;
  }
  const wentFirst = readWentFirst(payload.wentFirst);
  if (wentFirst) {
    session.currentGame.wentFirst = wentFirst;
  }
}

function updateReplayStream(session: SessionState, event: CaptureEvent): void {
  const score = readScore(event.payload);
  if (session.platform === "atlas") {
    addReplayScoreEvent(session, event, score);
    addReplayBattlefieldEvent(session, event);
    addReplayRows(session, event, score);
    addReplayResultEvent(session, event, score);
  } else {
    addTcgaSetupEvents(session, event, score);
    addReplayBattlefieldEvent(session, event);
    addTcgaTurnEvent(session, event);
    addTcgaCardMovementEvents(session, event);
    addReplayScoreEvent(session, event, score);
    addReplayResultEvent(session, event, score);
  }
  if (session.replayEvents.length > 420) {
    session.replayEvents = session.replayEvents.slice(-420);
  }
}

function addTcgaSetupEvents(session: SessionState, event: CaptureEvent, score: { me?: number; opp?: number }): void {
  if (!readBoolean(event.payload.active)) {
    return;
  }
  const beforeKey = `tcga:${session.currentGame.gameNumber}:before-mulligan`;
  const afterKey = `tcga:${session.currentGame.gameNumber}:after-mulligan`;
  const hadBefore = session.replaySeenRows.has(beforeKey);
  const phase = readString(event.payload.tcgaPhase);
  if (!hadBefore && !hasNonZeroScore(score)) {
    session.replaySeenRows.add(beforeKey);
    pushReplayEvent(session, {
      id: `${event.id}:tcga-before:${session.replayEvents.length + 1}`,
      sourceEventId: event.id,
      gameNumber: session.currentGame.gameNumber,
      capturedAt: event.capturedAt,
      labelTime: replayTimeLabel(event.capturedAt),
      type: "setup",
      side: "system",
      text: "Before mulligan.",
      cardName: "",
      destination: "",
      battlefield: "",
      score: replayScore(score)
    });
    return;
  }
  const afterEvidence = phase === "playing" || hasNonZeroScore(score) || hasBattlefieldEvidence(event.payload);
  if (hadBefore && afterEvidence && !session.replaySeenRows.has(afterKey)) {
    session.replaySeenRows.add(afterKey);
    pushReplayEvent(session, {
      id: `${event.id}:tcga-after:${session.replayEvents.length + 1}`,
      sourceEventId: event.id,
      gameNumber: session.currentGame.gameNumber,
      capturedAt: event.capturedAt,
      labelTime: replayTimeLabel(event.capturedAt),
      type: "setup",
      side: "system",
      text: "After mulligan.",
      cardName: "",
      destination: "",
      battlefield: "",
      score: replayScore(score)
    });
  }
}

function addTcgaTurnEvent(session: SessionState, event: CaptureEvent): void {
  const turnText = readString(event.payload.turnText);
  if (!turnText) {
    return;
  }
  const label = normalizeTcgaTurnText(turnText);
  const capturedAt = new Date(event.capturedAt).getTime();
  const isSameTurnLabel = normalizeNameKey(label) === normalizeNameKey(session.replayLastTurnText);
  if (
    !label ||
    (isSameTurnLabel &&
      Number.isFinite(capturedAt) &&
      Number.isFinite(session.replayLastTurnAt) &&
      capturedAt >= session.replayLastTurnAt &&
      capturedAt - session.replayLastTurnAt <= 45_000)
  ) {
    return;
  }
  session.replayLastTurnText = label;
  session.replayLastTurnAt = Number.isFinite(capturedAt) ? capturedAt : 0;
  pushReplayEvent(session, {
    id: `${event.id}:tcga-turn:${session.replayEvents.length + 1}`,
    sourceEventId: event.id,
    gameNumber: session.currentGame.gameNumber,
    capturedAt: event.capturedAt,
    labelTime: replayTimeLabel(event.capturedAt),
    type: "turn-start",
    side: /^your turn$/i.test(label) ? "me" : /^opponent/i.test(label) ? "opponent" : "system",
    text: label,
    cardName: "",
    destination: "",
    battlefield: ""
  });
}

function addTcgaCardMovementEvents(session: SessionState, event: CaptureEvent): void {
  if (!readBoolean(event.payload.active)) {
    return;
  }
  if (readString(event.payload.tcgaPhase) !== "playing") {
    return;
  }
  const cards = collectTcgaReplayCards(event.payload);
  const nextVisible = new Map(cards.map((card) => [card.key, card]));
  if (!session.replayCardBaselineReady) {
    session.replayVisibleCards = nextVisible;
    session.replayCardBaselineReady = true;
    return;
  }

  for (const card of cards) {
    const previous = session.replayVisibleCards.get(card.key);
    if (previous && previous.zone === card.zone && previous.side === card.side) {
      continue;
    }
    const signature = replayRowSignature(`tcga-card|${session.currentGame.gameNumber}|${card.key}|${card.side}|${card.zone}`);
    if (session.replaySeenRows.has(signature)) {
      continue;
    }
    session.replaySeenRows.add(signature);
    const type: ReplayStructuredEvent["type"] = previous ? "move" : "play";
    const destination = tcgaReplayDestinationLabel(card.zone);
    const text = previous
      ? `Moved ${card.name} to ${destination}.`
      : `Played ${card.name} to ${destination}.`;
    pushReplayEvent(session, {
      id: `${event.id}:tcga-card:${session.replayEvents.length + 1}`,
      sourceEventId: event.id,
      gameNumber: session.currentGame.gameNumber,
      capturedAt: event.capturedAt,
      labelTime: replayTimeLabel(event.capturedAt),
      type,
      side: card.side,
      text,
      cardName: card.name,
      destination,
      battlefield: ""
    });
  }

  session.replayVisibleCards = nextVisible;
}

function addReplayRows(session: SessionState, event: CaptureEvent, score: { me?: number; opp?: number }): void {
  const rows = Array.isArray(event.payload.rows) ? event.payload.rows : [];
  const occurrenceCounts = new Map<string, number>();
  const chronologicalRows = chronologicalReplayRows(rows);
  for (let index = 0; index < chronologicalRows.length; index += 1) {
    const row = chronologicalRows[index];
    const record = isRecord(row) ? row : {};
    const rawText = cleanReplayText(readString(record.text));
    const parsed = parseReplayLogRow(rawText);
    if (!parsed.text || isReplayChatRow(rawText) || isReplayNoiseRow(parsed.text)) {
      continue;
    }
    const occurrenceKey = replayRowSignature(`${parsed.time}|${parsed.text}`);
    const occurrence = (occurrenceCounts.get(occurrenceKey) ?? 0) + 1;
    occurrenceCounts.set(occurrenceKey, occurrence);
    const signature = replayRowSignature(`${parsed.time}|${parsed.text}|${occurrence}`);
    if (session.replaySeenRows.has(signature)) {
      continue;
    }
    session.replaySeenRows.add(signature);
    const type = classifyReplayText(parsed.text);
    const card = replayCardFromText(parsed.text);
    const battlefield = type === "setup" ? "" : replayBattlefieldFromText(parsed.text);
    const capturedAt = replayRowCapturedAt(event.capturedAt, parsed.time, index);
    pushReplayEvent(session, {
      id: `${event.id}:row:${session.replayEvents.length + 1}`,
      sourceEventId: event.id,
      gameNumber: session.currentGame.gameNumber,
      capturedAt,
      labelTime: parsed.time || replayTimeLabel(event.capturedAt),
      type,
      side: replaySideFromText(parsed.text, event.payload),
      text: parsed.text,
      cardName: card.name,
      destination: card.destination,
      battlefield,
      pointsScored: replayPointsScored(parsed.text),
      score: type === "score" ? replayScore(score) : undefined
    });
  }
}

function addReplayScoreEvent(session: SessionState, event: CaptureEvent, score: { me?: number; opp?: number }): void {
  const label = replayScoreLabel(score);
  if (!label || label === session.replayLastScore) {
    return;
  }
  if (session.platform === "tcga" && scoreTotal(score) < scoreTotal(parseScoreLabel(session.replayLastScore))) {
    return;
  }
  session.replayLastScore = label;
  pushReplayEvent(session, {
    id: `${event.id}:score:${session.replayEvents.length + 1}`,
    sourceEventId: event.id,
    gameNumber: session.currentGame.gameNumber,
    capturedAt: event.capturedAt,
    labelTime: replayTimeLabel(event.capturedAt),
    type: "scoreboard",
    side: "system",
    text: `Score ${label}`,
    cardName: "",
    destination: "",
    battlefield: "",
    score: replayScore(score)
  });
}

function addReplayBattlefieldEvent(session: SessionState, event: CaptureEvent): void {
  const battlefields = replayBattlefieldCandidates(event.payload);
  if (!battlefields.length) {
    return;
  }
  const signature = battlefields
    .map((battlefield) => `${battlefield.side}:${battlefield.name || battlefield.code || battlefield.image}`)
    .join("|");
  if (!signature || signature === session.replayLastBattlefields) {
    return;
  }
  session.replayLastBattlefields = signature;
  const label = battlefields
    .map((battlefield) => `${battlefield.side === "me" ? "My" : battlefield.side === "opponent" ? "Opponent" : "Board"} ${battlefield.name || battlefield.code || "battlefield"}`)
    .join(" / ");
  pushReplayEvent(session, {
    id: `${event.id}:battlefield:${session.replayEvents.length + 1}`,
    sourceEventId: event.id,
    gameNumber: session.currentGame.gameNumber,
    capturedAt: event.capturedAt,
    labelTime: replayTimeLabel(event.capturedAt),
    type: "battlefield",
    side: "system",
    text: `Battlefields updated: ${label}`,
    cardName: "",
    destination: "",
    battlefield: label,
    battlefields
  });
}

function addReplayResultEvent(session: SessionState, event: CaptureEvent, score: { me?: number; opp?: number }): void {
  if (event.kind !== "match-end") {
    return;
  }
  const endText = cleanReplayText(readString(event.payload.endText));
  if (!endText) {
    return;
  }
  const signature = replayRowSignature(`result:${endText}`);
  if (session.replaySeenRows.has(signature)) {
    return;
  }
  session.replaySeenRows.add(signature);
  pushReplayEvent(session, {
    id: `${event.id}:result:${session.replayEvents.length + 1}`,
    sourceEventId: event.id,
    gameNumber: session.currentGame.gameNumber,
    capturedAt: event.capturedAt,
    labelTime: replayTimeLabel(event.capturedAt),
    type: "result",
    side: "system",
    text: endText,
    cardName: "",
    destination: "",
    battlefield: "",
    score: replayScore(score)
  });
}

function pushReplayEvent(session: SessionState, event: ReplayStructuredEvent): void {
  session.replayEvents.push(event);
}

function collectTcgaReplayCards(payload: Record<string, unknown>): ReplayCardState[] {
  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  const result: ReplayCardState[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    if (!isRecord(card)) {
      continue;
    }
    const replayCard = tcgaReplayCardFromRecord(card);
    if (!replayCard || seen.has(replayCard.key)) {
      continue;
    }
    seen.add(replayCard.key);
    result.push(replayCard);
  }
  return result;
}

function tcgaReplayCardFromRecord(card: Record<string, unknown>): ReplayCardState | null {
  const classes = readString(card.classes);
  const zone = normalizeTcgaCardZone(readString(card.zone), classes);
  const side = tcgaCardSide(readString(card.zoneOwner), classes);
  const image = readString(card.image);
  const code = readString(card.code) || cardCodeFromValue(image);
  const rawText = readString(card.text);
  const name = cleanTcgaCardName(rawText, code);
  const cardId = readString(card.cardId);
  const key = cardId || code || normalizeAssetKey(image) || normalizeNameKey(name);
  if (
    !key ||
    !zone ||
    !name ||
    side === "unknown" ||
    isIgnoredTcgaReplayCard({ classes, zone, image, name })
  ) {
    return null;
  }
  return { key, name, code, image, zone, side };
}

function isIgnoredTcgaReplayCard(card: { classes: string; zone: string; image: string; name: string }): boolean {
  return /(?:^|\s)(?:Legend|Battlefields|Runes?|Mana|Sideboard|Chosen_Champion|Hand|Discard|Trash|ExileHidden)(?:\s|$)/i.test(card.classes) ||
    /card-hidden-yes|ExileHidden/i.test(card.classes) ||
    isCardBackImage(card.image) ||
    /(?:^|[-_\s])(?:hand|deck|rune|sideboard|discard|trash|removed|hidden)(?:$|[-_\s])/i.test(card.zone) ||
    isTcgaInteractionLabel(card.name);
}

function normalizeTcgaCardZone(zone: string, classes: string): string {
  const raw = `${zone} ${classes}`.toLowerCase();
  if (/sideboard|discard|trash|mana|runes?|hand|exilehidden|chosen_champion|legend|battlefields/.test(raw)) {
    return "";
  }
  if (/\bbase\b/.test(raw)) {
    return "base";
  }
  if (/\bb[1-3]\b/.test(raw)) {
    return "battlefield";
  }
  if (/\bstack\b/.test(raw)) {
    return "stack";
  }
  if (/battlefield/.test(raw)) {
    return "battlefield";
  }
  if (/bench|board|unit|attached|attachment/.test(raw)) {
    return "board";
  }
  return "";
}

function tcgaCardSide(zoneOwner: string, classes: string): ReplayStructuredEvent["side"] {
  const raw = `${zoneOwner} ${classes}`.toLowerCase();
  if (/opponent|enemy|remote/.test(raw)) {
    return "opponent";
  }
  if (/self|player|local|mine|me/.test(raw) || !/opponent/.test(raw)) {
    return "me";
  }
  return "unknown";
}

function cleanTcgaCardName(text: string, code: string): string {
  const withoutCode = text
    .replace(/\b[A-Z]{2,5}-\d{1,4}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const firstChunk = withoutCode
    .split(/(?:\s{2,}|[-•|])/)
    .map((part) => part.trim())
    .find((part) => part && !/^\d+$/.test(part) && !isTcgaInteractionLabel(part));
  return (firstChunk || code || "Unknown card").slice(0, 80);
}

function tcgaReplayDestinationLabel(zone: string): string {
  if (zone === "battlefield") {
    return "battlefield";
  }
  if (zone === "stack") {
    return "stack";
  }
  if (zone === "board") {
    return "board";
  }
  return "base";
}

function isTcgaInteractionLabel(value: string): boolean {
  return /^(?:ping|tap|untap|target|group with|error|error\s*tap|error\s*ping|error\s*error\s*tap)$/i.test(normalizeNameKey(value));
}

function cardCodeFromValue(value: string): string {
  const match = value.match(/\b([A-Z]{2,5}-\d{1,4})\b/i);
  return match?.[1]?.toUpperCase() ?? "";
}

function replayBattlefieldCandidates(payload: Record<string, unknown>): NonNullable<ReplayStructuredEvent["battlefields"]> {
  const candidates = Array.isArray(payload.battlefieldCandidates) ? payload.battlefieldCandidates : [];
  return candidates
    .filter((candidate): candidate is Record<string, unknown> => isRecord(candidate))
    .map((candidate) => ({
      side: replayBattlefieldSide(candidate.side),
      name: readString(candidate.text),
      code: readString(candidate.code),
      image: readString(candidate.image)
    }))
    .filter((candidate) => !isNoiseBattlefieldCandidate(candidate))
    .filter((candidate) => candidate.name || candidate.code || candidate.image);
}

function isNoiseBattlefieldCandidate(candidate: { name: string; code: string; image: string }): boolean {
  return /^(?:ping|tap|untap|target|group\s+with|error|error\s*tap|error\s*ping|error\s*target)$/i.test(normalizeNameKey(candidate.name));
}

function hasBattlefieldEvidence(payload: Record<string, unknown>): boolean {
  return Boolean(
    readString(payload.myBattlefield) ||
      readString(payload.opponentBattlefield) ||
      readBattlefieldImage(payload, "me") ||
      readBattlefieldImage(payload, "opponent") ||
      replayBattlefieldCandidates(payload).length
  );
}

function hasNonZeroScore(score: { me?: number; opp?: number }): boolean {
  return Boolean((score.me ?? 0) > 0 || (score.opp ?? 0) > 0);
}

function normalizeTcgaTurnText(value: string): string {
  const matched = value.match(/your turn|opponent['\u2019]?s turn|.{1,48}['\u2019]s turn/i)?.[0]?.trim() ?? value.trim();
  const cleaned = matched.replace(/\s+/g, " ");
  if (/^your turn$/i.test(cleaned)) {
    return "Your turn";
  }
  if (/^opponent['\u2019]?s turn$/i.test(cleaned)) {
    return "Opponent's turn";
  }
  return cleaned;
}

function chronologicalReplayRows(rows: unknown[]): unknown[] {
  return rows
    .map((row, index) => {
      const record = isRecord(row) ? row : {};
      const text = cleanReplayText(readString(record.text));
      return {
        row,
        index,
        minute: replayRowMinute(row) ?? Number.POSITIVE_INFINITY,
        priority: sameMinuteReplayRowPriority(parseReplayLogRow(text).text)
      };
    })
    .sort((a, b) => {
      if (a.minute !== b.minute) {
        return a.minute - b.minute;
      }
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.index - b.index;
    })
    .map((item) => item.row);
}

function replayRowMinute(row: unknown): number | undefined {
  const record = isRecord(row) ? row : {};
  const text = cleanReplayText(readString(record.text));
  const time = parseReplayLogRow(text).time;
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10) : undefined;
}

function sameMinuteReplayRowPriority(text: string): number {
  const type = classifyReplayText(text);
  if (type === "setup") return setupReplayRowPriority(text);
  if (type === "turn-start") return 1;
  if (type === "draw") return 2;
  if (type === "play" || type === "move" || type === "combat" || type === "score") return 5;
  if (type === "turn-end") return 9;
  if (type === "result") return 10;
  return 6;
}

function setupReplayRowPriority(text: string): number {
  if (/must choose who starts/i.test(text)) return 0;
  if (/chose .+ to take the first turn/i.test(text)) return 0.1;
  if (/rolled|initiative|decides who plays first/i.test(text)) return 0.2;
  if (/sideboard|battlefield/i.test(text)) return 0.3;
  if (/finalized mulligan/i.test(text)) return 0.4;
  if (/both mulligans? (?:are )?complete|starting the game/i.test(text)) return 0.9;
  return 0.5;
}

function replayBattlefieldSide(value: unknown): "me" | "opponent" | "unknown" {
  return value === "me" || value === "opponent" ? value : "unknown";
}

function parseReplayLogRow(value: string): { time: string; text: string } {
  const withoutUndo = value.replace(/[\u21ba\u21bb]/g, "").trim();
  const prefixed = withoutUndo.match(/^(\d{1,2}:\d{2})(.+)$/);
  if (prefixed) {
    return { time: prefixed[1], text: prefixed[2].trim() };
  }
  return { time: "", text: withoutUndo };
}

function classifyReplayText(value: string): ReplayStructuredEvent["type"] {
  if (/starting turn|started turn|['\u2019]s turn\b/i.test(value)) return "turn-start";
  if (/(?:ended|ends|passed|passes) (?:their|the|your|opponent'?s)?\s*turn|turn (?:ended|passed)/i.test(value)) return "turn-end";
  if (/conquered|scored \d+|score(?:d)? point/i.test(value)) return "score";
  if (/combat|showdown|attack|block|defend/i.test(value)) return "combat";
  if (/played\b/i.test(value)) return "play";
  if (/moved\b/i.test(value)) return "move";
  if (/mulligan|sideboards? are locked|battlefields? are locked|locked in sideboarding|locked in a battlefield|rolled|initiative|choose who starts|take the first turn/i.test(value)) return "setup";
  if (/drew|draws|draw \d+/i.test(value)) return "draw";
  if (/wins!|winner|victory|defeat|you win|you lose|won the game|lost the game/i.test(value)) return "result";
  return "action";
}

function replayCardFromText(value: string): { name: string; destination: string } {
  const played = value.match(/\bPlayed\s+(.+?)(?:\s+to\s+(.+?))?\.?$/i);
  if (played) {
    return { name: cleanReplayDestination(played[1]), destination: cleanReplayDestination(played[2] ?? "") };
  }
  const moved = value.match(/\bMoved\s+(.+?)\s+to\s+(.+?)(?:\.|$)/i);
  if (moved) {
    return { name: cleanReplayDestination(moved[1]), destination: cleanReplayDestination(moved[2]) };
  }
  const revealed = value.match(/\bRevealed\s+(.+?)(?:\.|$)/i);
  if (revealed) {
    return { name: cleanReplayDestination(revealed[1]), destination: "" };
  }
  return { name: "", destination: "" };
}

function replayBattlefieldFromText(value: string): string {
  const conquered = value.match(/\bConquered\s+(.+?)\s+and\s+scored/i);
  if (conquered) {
    return cleanReplayDestination(conquered[1]);
  }
  const destination = value.match(/\b(?:to|at)\s+(.+?)(?:\.|$)/i)?.[1] ?? "";
  return /base|trash|deck|hand|rune/i.test(destination) ? "" : cleanReplayDestination(destination);
}

function replayPointsScored(value: string): number | undefined {
  const match = value.match(/\bscored\s+(\d+)\b/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function replaySideFromText(value: string, payload: Record<string, unknown>): ReplayStructuredEvent["side"] {
  if (/^you\b/i.test(value)) return "me";
  if (/^opponent\b/i.test(value)) return "opponent";
  const owner = value.match(/^(.{1,48}?)['\u2019]s turn\b/i)?.[1] ?? "";
  const ownerKey = normalizeNameKey(owner);
  const myKey = normalizeNameKey(readString(payload.configuredUsername) || readString(payload.myName));
  const oppKey = normalizeNameKey(readString(payload.opponentName));
  if (ownerKey && myKey && ownerKey === myKey) return "me";
  if (ownerKey && oppKey && ownerKey === oppKey) return "opponent";
  return "system";
}

function replayScore(score: { me?: number; opp?: number }): ReplayStructuredEvent["score"] {
  if (typeof score.me !== "number" && typeof score.opp !== "number") {
    return undefined;
  }
  return { me: score.me, opponent: score.opp };
}

function replayScoreLabel(score: { me?: number; opp?: number }): string {
  if (typeof score.me !== "number" || typeof score.opp !== "number") {
    return "";
  }
  return `${score.me}-${score.opp}`;
}

function parseScoreLabel(value: string): { me?: number; opp?: number } {
  const match = value.match(/^(\d+)-(\d+)$/);
  if (!match) {
    return {};
  }
  return {
    me: Number.parseInt(match[1], 10),
    opp: Number.parseInt(match[2], 10)
  };
}

function scoreTotal(score: { me?: number; opp?: number }): number {
  if (typeof score.me !== "number" || typeof score.opp !== "number") {
    return -1;
  }
  return score.me + score.opp;
}

function cleanReplayText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanReplayDestination(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\.$/, "").trim();
}

function replayRowSignature(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isReplayChatRow(value: string): boolean {
  return /\bat\s+\d{1,2}:\d{2}\s*:/i.test(value);
}

function isReplayNoiseRow(value: string): boolean {
  return /^Rolled a d20\.?$/i.test(value) ||
    /^Exhausted\s+\d+\s*[A-Za-z]*\s*runes?\.?$/i.test(value) ||
    /^Recycled\s+\d+\s*[A-Za-z]*\s*runes?\.?$/i.test(value);
}

function replayTimeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function replayRowCapturedAt(baseIso: string, time: string, order: number): string {
  const date = new Date(baseIso);
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number.isNaN(date.getTime())) {
    return baseIso;
  }
  date.setHours(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10), 0, Math.min(order, 999));
  const baseTime = new Date(baseIso).getTime();
  if (date.getTime() - baseTime > 12 * 60 * 60 * 1000) {
    date.setDate(date.getDate() - 1);
  }
  return date.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function completeCurrentGame(session: SessionState): void {
  const finished = finishCurrentGame(session.currentGame);
  if (isWorthKeeping(finished)) {
    session.completedGames.push(finished);
  }
  session.currentGame = createGameState(session.completedGames.length + 1);
  session.replayLastScore = "";
  session.replayLastBattlefields = "";
  session.replayLastTurnText = "";
  session.replayLastTurnAt = 0;
  session.replayVisibleCards = new Map<string, ReplayCardState>();
  session.replayCardBaselineReady = false;
}

function createGameState(gameNumber: number): GameDraftState {
  return {
    gameNumber,
    myBattlefield: "",
    opponentBattlefield: "",
    myBattlefieldImage: "",
    opponentBattlefieldImage: "",
    wentFirst: ""
  };
}

function shouldStartNextGame(session: SessionState, score: { me?: number; opp?: number }, payload: Record<string, unknown>): boolean {
  if (session.completedGames.length >= 2) {
    return false;
  }
  const current = session.currentGame;
  const currentHasNonZeroScore = gameStateHasNonZeroScore(current);
  const nextScoreTotal = (score.me ?? 0) + (score.opp ?? 0);
  const nextHasNonZeroScore = nextScoreTotal > 0;
  const looksMultiGame = sessionLooksMultiGame(session, payload);
  if (typeof score.me !== "number" && typeof score.opp !== "number") {
    return currentHasNonZeroScore && looksMultiGame && (
      battlefieldChanged(current.myBattlefield, payload.myBattlefield) ||
      battlefieldChanged(current.opponentBattlefield, payload.opponentBattlefield) ||
      battlefieldImageChanged(current.myBattlefieldImage, readBattlefieldImage(payload, "me")) ||
      battlefieldImageChanged(current.opponentBattlefieldImage, readBattlefieldImage(payload, "opponent"))
    ) && isWorthKeeping(finishCurrentGame(current));
  }
  const currentMe = current.myPoints ?? 0;
  const currentOpp = current.oppPoints ?? 0;
  const nextMe = score.me ?? currentMe;
  const nextOpp = score.opp ?? currentOpp;
  const currentTotal = currentMe + currentOpp;
  const nextTotal = nextMe + nextOpp;
  const scoreDropped = nextMe < currentMe || nextOpp < currentOpp;
  const hasNumericReset = typeof score.me === "number" && typeof score.opp === "number" && nextTotal === 0;
  if (scoreDropped && currentTotal >= 6 && nextTotal <= currentTotal - 2) {
    return hasNumericReset || nextTotal > 0 || looksMultiGame;
  }
  return currentHasNonZeroScore && (nextHasNonZeroScore || looksMultiGame) && (
    battlefieldChanged(current.myBattlefield, payload.myBattlefield) ||
    battlefieldChanged(current.opponentBattlefield, payload.opponentBattlefield) ||
    battlefieldImageChanged(current.myBattlefieldImage, readBattlefieldImage(payload, "me")) ||
    battlefieldImageChanged(current.opponentBattlefieldImage, readBattlefieldImage(payload, "opponent"))
  ) && isWorthKeeping(finishCurrentGame(current));
}

function isWorthKeeping(game: MatchGame): boolean {
  const hasScore = typeof game.myPoints === "number" || typeof game.oppPoints === "number";
  if (hasScore && !gameHasNonZeroScore(game) && game.result === "Incomplete") {
    return false;
  }
  return gameHasNonZeroScore(game) ||
    game.result !== "Incomplete" ||
    Boolean(game.myBattlefield || game.oppBattlefield || game.myBattlefieldImage || game.oppBattlefieldImage || game.wentFirst);
}

function gameHasNonZeroScore(game: MatchGame): boolean {
  return (game.myPoints ?? 0) > 0 || (game.oppPoints ?? 0) > 0;
}

function gameStateHasNonZeroScore(game: GameDraftState): boolean {
  return (game.myPoints ?? 0) > 0 || (game.oppPoints ?? 0) > 0;
}

function sessionLooksMultiGame(session: SessionState, payload: Record<string, unknown>): boolean {
  const raw = `${readString(session.sticky.format)} ${readString(payload.format)}`.toLowerCase();
  return session.completedGames.length > 0 || raw.includes("bo3") || raw.includes("best of 3");
}

function finishCurrentGame(game: GameDraftState): MatchGame {
  const result = game.result ?? inferResult(game.myPoints, game.oppPoints);
  return {
    gameNumber: game.gameNumber,
    result,
    myPoints: game.myPoints,
    oppPoints: game.oppPoints,
    myBattlefield: game.myBattlefield,
    oppBattlefield: game.opponentBattlefield,
    myBattlefieldImage: game.myBattlefieldImage,
    oppBattlefieldImage: game.opponentBattlefieldImage,
    wentFirst: game.wentFirst
  };
}

function normalizeAmbiguousInactiveGame(game: MatchGame, hasTerminalResult: boolean): MatchGame {
  if (
    hasTerminalResult ||
    game.result !== "Draw" ||
    typeof game.myPoints !== "number" ||
    typeof game.oppPoints !== "number" ||
    game.myPoints !== game.oppPoints
  ) {
    return game;
  }
  return { ...game, result: "Incomplete" };
}

function applyBo3BattlefieldConfidenceGuard(games: MatchGame[]): MatchGame[] {
  if (games.length < 2) {
    return games;
  }
  return games.map((game, index) => {
    if (index === 0) {
      return game;
    }
    const previous = games[index - 1];
    if (!hasBattlefieldPair(game) || !hasBattlefieldPair(previous)) {
      return game;
    }
    if (!sameBattlefieldPair(previous, game) || !differentGameOutcome(previous, game)) {
      return game;
    }
    return {
      ...game,
      myBattlefield: "",
      oppBattlefield: "",
      myBattlefieldImage: "",
      oppBattlefieldImage: ""
    };
  });
}

function hasBattlefieldPair(game: MatchGame): boolean {
  return Boolean(battlefieldIdentity(game, "me") && battlefieldIdentity(game, "opponent"));
}

function sameBattlefieldPair(a: MatchGame, b: MatchGame): boolean {
  return battlefieldIdentity(a, "me") === battlefieldIdentity(b, "me") &&
    battlefieldIdentity(a, "opponent") === battlefieldIdentity(b, "opponent");
}

function battlefieldIdentity(game: MatchGame, side: "me" | "opponent"): string {
  const name = side === "me" ? game.myBattlefield : game.oppBattlefield;
  const image = side === "me" ? game.myBattlefieldImage : game.oppBattlefieldImage;
  return normalizeNameKey(readString(name)) || normalizeAssetKey(readString(image));
}

function differentGameOutcome(a: MatchGame, b: MatchGame): boolean {
  return a.result !== b.result || gamePointKey(a) !== gamePointKey(b);
}

function gamePointKey(game: MatchGame): string {
  return `${typeof game.myPoints === "number" ? game.myPoints : ""}-${typeof game.oppPoints === "number" ? game.oppPoints : ""}`;
}

function resultFromGames(games: MatchGame[]): MatchDraft["result"] {
  const playable = games.filter((game) => game.result !== "Incomplete");
  if (!playable.length) {
    return "Incomplete";
  }
  const wins = playable.filter((game) => game.result === "Win").length;
  const losses = playable.filter((game) => game.result === "Loss").length;
  if (wins > losses) {
    return "Win";
  }
  if (losses > wins) {
    return "Loss";
  }
  return "Draw";
}

function resultFromText(value: unknown): MatchDraft["result"] | null {
  const raw = readString(value).toLowerCase();
  if (!raw) {
    return null;
  }
  if (/confirm\s+game\s+\d+\s+winner/.test(raw)) {
    return null;
  }
  if (/you win|victory|winner|won/.test(raw) && !/opponent.*win|you lose/.test(raw)) {
    return "Win";
  }
  if (/opponent.*left|opponent.*disconnect/.test(raw)) {
    return "Win";
  }
  if (/you lose|defeat|opponent.*win|lost/.test(raw)) {
    return "Loss";
  }
  if (/you.*left|you.*disconnect/.test(raw)) {
    return "Loss";
  }
  if (/draw|tie/.test(raw)) {
    return "Draw";
  }
  return null;
}

function scoreFromGames(games: MatchGame[]): string {
  const wins = games.filter((game) => game.result === "Win").length;
  const losses = games.filter((game) => game.result === "Loss").length;
  const draws = games.filter((game) => game.result === "Draw").length;
  if (!wins && !losses && !draws) {
    return "";
  }
  return `${wins}-${losses}${draws ? `-${draws}` : ""}`;
}

function scoreTextFromGameState(game: GameDraftState): string {
  if (typeof game.myPoints !== "number" || typeof game.oppPoints !== "number") {
    return "";
  }
  return `${game.myPoints}-${game.oppPoints}`;
}

function inferFormat(sticky: Record<string, unknown>, games: MatchGame[]): MatchDraft["format"] {
  const raw = readString(sticky.format).toLowerCase();
  if (raw.includes("bo3") || raw.includes("best of 3")) {
    return "Bo3";
  }
  if (raw.includes("bo1") || raw.includes("best of 1")) {
    return "Bo1";
  }
  return games.length > 1 ? "Bo3" : "Bo1";
}

function inferResult(me: number | undefined, opp: number | undefined): MatchGame["result"] {
  if (typeof me !== "number" || typeof opp !== "number") {
    return "Incomplete";
  }
  if (me === 0 && opp === 0) {
    return "Incomplete";
  }
  if (me > opp) {
    return "Win";
  }
  if (opp > me) {
    return "Loss";
  }
  return "Draw";
}

function readScore(payload: Record<string, unknown>): { me?: number; opp?: number } {
  const counterScore = readScoreFromCounterPlayers(payload);
  if (typeof counterScore.me === "number" || typeof counterScore.opp === "number") {
    return counterScore;
  }
  const score = payload.score;
  if (score && typeof score === "object") {
    const raw = score as Record<string, unknown>;
    const me = readOptionalNumber(raw.me);
    const opp = readOptionalNumber(raw.opp);
    const source = readString(raw.source);
    if (source.startsWith("tcga-counter") && (typeof me !== "number" || typeof opp !== "number")) {
      return {};
    }
    return { me, opp };
  }
  return { me: readOptionalNumber(payload.myPoints), opp: readOptionalNumber(payload.oppPoints) };
}

function readScoreFromCounterPlayers(payload: Record<string, unknown>): { me?: number; opp?: number } {
  const players = Array.isArray(payload.counterPlayers) ? payload.counterPlayers : [];
  if (!players.length) {
    return {};
  }
  const normalizedPlayers = players
    .filter((player): player is Record<string, unknown> => Boolean(player && typeof player === "object" && !Array.isArray(player)))
    .map((player) => ({
      name: readString(player.name),
      score: readOptionalNumber(player.score)
    }));
  const candidates = [
    readString(payload.configuredUsername),
    readTcgaLocalPlayerName(payload.playerData),
    readString(payload.localPlayerName),
    readString(payload.myName)
  ].map(normalizeNameKey).filter(Boolean);
  for (const localKey of candidates) {
    const meRow = normalizedPlayers.find((player) => normalizeNameKey(player.name) === localKey);
    if (typeof meRow?.score !== "number") {
      continue;
    }
    const opp = normalizedPlayers.find((player) => normalizeNameKey(player.name) !== localKey && typeof player.score === "number")?.score;
    return { me: meRow.score, opp };
  }
  if (!candidates.length) {
    const scored = normalizedPlayers.filter((player) => typeof player.score === "number");
    if (scored.length >= 2) {
      return { me: scored[0].score, opp: scored[1].score };
    }
  }
  return {};
}

function readDeckName(sticky: Record<string, unknown>): string {
  const direct = readString(sticky.deckName);
  if (direct) {
    return direct;
  }
  const selectedDeck = sticky.selectedDeck;
  if (selectedDeck && typeof selectedDeck === "object") {
    return readString((selectedDeck as Record<string, unknown>).selected_label);
  }
  return "";
}

function readDeckSourceId(sticky: Record<string, unknown>): string {
  const direct = readString(sticky.deckSourceId);
  if (direct) {
    return direct;
  }
  const selectedDeck = sticky.selectedDeck;
  if (selectedDeck && typeof selectedDeck === "object") {
    return readString((selectedDeck as Record<string, unknown>).selected_uuid);
  }
  return "";
}

function readDeckSourceUrl(sticky: Record<string, unknown>): string {
  const selectedDeck = sticky.selectedDeck;
  if (selectedDeck && typeof selectedDeck === "object") {
    return readString((selectedDeck as Record<string, unknown>).source_url);
  }
  return "";
}

function readMyName(sticky: Record<string, unknown>, settingsUsername: string): string {
  return readString(settingsUsername) || readTcgaLocalPlayerName(sticky.playerData) || readString(sticky.localPlayerName) || readString(sticky.myName);
}

function readOpponentName(sticky: Record<string, unknown>, myName: string, settingsUsername: string): string {
  const excluded = [myName, settingsUsername].filter(Boolean);
  const direct = readString(sticky.opponentName);
  if (isDistinctName(direct, excluded)) {
    return direct;
  }
  return readOpponentNameFromPlayerData(sticky.playerData, excluded) || readOpponentNameFromCounterPlayers(sticky.counterPlayers, excluded);
}

function readOpponentNameFromPlayerData(value: unknown, excluded: string[]): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const direct = value as Record<string, unknown>;
  for (const key of ["lastOpponentPeerData", "opponentPeerData", "opponent", "opponentData", "enemy", "rival"]) {
    const match = readTcgaProfileName(direct[key]);
    if (isDistinctName(match, excluded)) {
      return match;
    }
  }
  for (const [key, nested] of Object.entries(direct)) {
    if (/opponent|enemy|rival/i.test(key)) {
      const match = readTcgaProfileName(nested);
      if (isDistinctName(match, excluded)) {
        return match;
      }
    }
  }
  return "";
}

function readOpponentNameFromCounterPlayers(value: unknown, excluded: string[]): string {
  if (!Array.isArray(value)) {
    return "";
  }
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const name = readString((item as Record<string, unknown>).name);
    if (isDistinctName(name, excluded)) {
      return name;
    }
  }
  return "";
}

function previewGames(session: SessionState): MatchGame[] {
  const finalGame = finishCurrentGame(session.currentGame);
  return isWorthKeeping(finalGame) ? [...session.completedGames, finalGame] : [...session.completedGames];
}

function shouldReleaseUnfinishedBo3(session: SessionState, reason: string, games: MatchGame[]): boolean {
  if (reason !== "inactive-debounce" || session.completedGames.length < 2 || isBo3Complete(games)) {
    return false;
  }
  return !isWorthKeeping(finishCurrentGame(session.currentGame));
}

function isBo3Complete(games: MatchGame[]): boolean {
  const wins = games.filter((game) => game.result === "Win").length;
  const losses = games.filter((game) => game.result === "Loss").length;
  return wins >= 2 || losses >= 2 || games.length >= 3;
}

function unfinishedBo3Result(format: MatchDraft["format"], games: MatchGame[]): MatchDraft["result"] | null {
  return format === "Bo3" && games.length >= 2 && !isBo3Complete(games) ? "Incomplete" : null;
}

function isAtlasBetweenGameEnd(platform: GamePlatform, payload: Record<string, unknown>): boolean {
  if (platform !== "atlas" || readString(payload.reason) !== "result-text-detected") {
    return false;
  }
  const kind = readString(payload.atlasResultKind);
  if (kind === "match-terminal") {
    return false;
  }
  return kind === "game-result" || /you win|you lose|you won|you lost|victory|defeat|wins!|winner/i.test(readString(payload.endText));
}

function isAtlasGameResultHold(session: SessionState, payload: Record<string, unknown>): boolean {
  if (session.platform !== "atlas" || readString(payload.reason) !== "result-text-detected") {
    return false;
  }
  if (readString(payload.atlasResultKind) !== "game-result") {
    return false;
  }
  const raw = `${readString(session.sticky.format)} ${readString(payload.format)} ${readString(payload.endText)}`.toLowerCase();
  return raw.includes("bo3") || raw.includes("best of 3") || /confirm\s+game\s+\d+\s+winner/.test(raw);
}

function shouldUseExactAtlasResultScore(session: SessionState, payload: Record<string, unknown>): boolean {
  if (session.platform !== "atlas") {
    return false;
  }
  const kind = readString(payload.atlasResultKind);
  const text = readString(payload.endText);
  return kind === "game-result" || kind === "match-terminal" || /confirm\s+game\s+\d+\s+winner/i.test(text);
}

function isAtlasHeldResultEcho(session: SessionState, payload: Record<string, unknown>): boolean {
  if (session.platform !== "atlas" || !session.atlasHeldResultSignature) {
    return false;
  }
  const kind = readString(payload.atlasResultKind);
  const text = readString(payload.endText);
  if (kind !== "game-result" && !/confirm\s+game\s+\d+\s+winner/i.test(text)) {
    return false;
  }
  return atlasPayloadResultSignature(payload) === session.atlasHeldResultSignature;
}

function isAtlasTerminalEchoAfterHeldGame(session: SessionState, payload: Record<string, unknown>): boolean {
  return session.platform === "atlas" &&
    readString(payload.atlasResultKind) === "match-terminal" &&
    session.completedGames.length > 0 &&
    !isWorthKeeping(finishCurrentGame(session.currentGame));
}

function atlasPayloadResultSignature(payload: Record<string, unknown>): string {
  const score = readScore(payload);
  return [
    readString(payload.atlasResultKind).toLowerCase(),
    normalizeNameKey(readString(payload.endText)),
    score.me ?? "",
    score.opp ?? "",
    normalizeNameKey(readString(payload.myBattlefield)),
    normalizeNameKey(readString(payload.opponentBattlefield)),
    normalizeAssetKey(readBattlefieldImage(payload, "me")),
    normalizeAssetKey(readBattlefieldImage(payload, "opponent"))
  ].join("|");
}

function atlasGameResultSignature(game: MatchGame): string {
  return [
    "",
    "",
    game.myPoints ?? "",
    game.oppPoints ?? "",
    normalizeNameKey(game.myBattlefield ?? ""),
    normalizeNameKey(game.oppBattlefield ?? ""),
    normalizeAssetKey(game.myBattlefieldImage ?? ""),
    normalizeAssetKey(game.oppBattlefieldImage ?? "")
  ].join("|");
}

function isDistinctName(candidate: string, excluded: string[]): boolean {
  const normalized = normalizeNameKey(candidate);
  return Boolean(normalized) && !excluded.some((name) => normalizeNameKey(name) === normalized);
}

function normalizeNameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function battlefieldChanged(current: string, nextValue: unknown): boolean {
  const next = readString(nextValue);
  if (isGeneratedBattlefieldName(current) || isGeneratedBattlefieldName(next)) {
    return false;
  }
  return Boolean(current && next && normalizeNameKey(current) !== normalizeNameKey(next));
}

function battlefieldImageChanged(current: string, nextValue: unknown): boolean {
  const next = normalizeAssetKey(readString(nextValue));
  if (isGeneratedBattlefieldImage(current) || isGeneratedBattlefieldImage(next)) {
    return false;
  }
  return Boolean(current && next && normalizeAssetKey(current) !== next);
}

function readBattlefieldImage(payload: Record<string, unknown>, side: "me" | "opponent"): string {
  const direct = readString(side === "me" ? payload.myBattlefieldImage : payload.opponentBattlefieldImage);
  if (direct && !isCardBackImage(direct) && !isGeneratedBattlefieldImage(direct)) {
    return direct;
  }
  const candidates = Array.isArray(payload.battlefieldCandidates) ? payload.battlefieldCandidates : [];
  const usable: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const image = readString(record.image);
    if (readString(record.side) === side && record.hidden !== true && image && !isCardBackImage(image) && !isGeneratedBattlefieldCandidate(record)) {
      usable.push(image);
    }
  }
  const unique = Array.from(new Map(usable.map((image) => [normalizeAssetKey(image), image])).values());
  if (side === "me" && unique.length !== 1) {
    return "";
  }
  if (unique[0]) {
    return unique[0];
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const image = readString(record.image);
    if (readString(record.side) === side && image && !isCardBackImage(image) && !isGeneratedBattlefieldCandidate(record)) {
      return image;
    }
  }
  return "";
}

function isGeneratedBattlefieldCandidate(candidate: Record<string, unknown>): boolean {
  return isGeneratedBattlefieldName(readString(candidate.text) || readString(candidate.name) || readString(candidate.code)) ||
    isGeneratedBattlefieldImage(readString(candidate.image));
}

function isGeneratedBattlefieldName(value: string): boolean {
  return /\bbaron\s+pit\b/i.test(value);
}

function isGeneratedBattlefieldImage(value: string): boolean {
  return /baron[-_\s]?pit|e44f173629322a4e0c32d3f8902c294d4482ef42/i.test(value);
}

function isCardBackImage(value: string): boolean {
  return /cardback|card-back|back-black|back\.png/i.test(value);
}

function normalizeAssetKey(value: string): string {
  return value.trim().toLowerCase().replace(/[?#].*$/, "");
}

function readWentFirst(value: unknown): "1st" | "2nd" | "undecided" | "" {
  const raw = readString(value);
  return raw === "1st" || raw === "2nd" || raw === "undecided" ? raw : "";
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
  }
  return undefined;
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value && typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return typeof value === "number" || typeof value === "boolean";
}
