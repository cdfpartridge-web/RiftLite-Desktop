import type { CaptureEvent, GamePlatform, MatchDraft, MatchGame, ReplayStructuredEvent, RiftboundSimEvent, UserSettings } from "../../shared/types.js";
import { riftboundCardCodeFromValue } from "../../shared/cardIdentity.js";
import { legendFromImageUrl } from "../../shared/legendImages.js";
import { isCanonicalLegendName, normalizeLegendName } from "../../shared/legendNames.js";
import { privateHubSyncEnabled, publicCommunitySyncEnabled, teamSyncEnabled } from "../../shared/syncPolicy.js";
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
  myBattlefieldCode: string;
  opponentBattlefieldCode: string;
  myBattlefieldImage: string;
  opponentBattlefieldImage: string;
  wentFirst: "1st" | "2nd" | "undecided" | "";
  atlasStartedAt?: string;
  atlasLastObservedAt?: string;
  atlasResultEvent?: AtlasResultEventIdentity;
}

interface AtlasResultEventIdentity {
  id: string;
  capturedAt: string;
  gameNumber: number;
  signature: string;
}

interface AtlasGameIdentity {
  sessionId: string;
  ordinal: number;
  explicitGameNumber: number;
  resultEventId: string;
  startedAt: string;
  completedAt: string;
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
  id: string;
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
  atlasCompletedGameIdentities: AtlasGameIdentity[];
  atlasHeldResult?: AtlasResultEventIdentity;
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
    updateCurrentGame(session, event);
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
    if (shouldReleaseUnfinishedBo3(session, endEvent, games)) {
      return false;
    }
    if (isAtlasGameResultHold(session, endEvent.payload)) {
      return shouldHoldAtlasGameResult(session, endEvent.payload, games);
    }
    const rawFormat = readString(session.sticky.format).toLowerCase();
    const hasExplicitBo3 = rawFormat.includes("bo3") || rawFormat.includes("best of 3");
    const hasMultipleGames = session.completedGames.length > 1 || games.filter(gameHasNonZeroScore).length > 1;
    const hasStartedNextGame = session.completedGames.length > 0 && gameStateHasNonZeroScore(session.currentGame);
    const isBo3 = hasExplicitBo3 || hasMultipleGames || hasStartedNextGame;
    return isBo3 && !isBo3Complete(games);
  }

  shouldWaitForAtlasContinuation(platform: GamePlatform, endEvent: CaptureEvent): boolean {
    const session = this.sessions.get(platform);
    if (!session || platform !== "atlas" || endEvent.platform !== "atlas") {
      return false;
    }
    if (isAtlasAmbiguousGameResultContinuationCandidate(session, endEvent)) {
      return true;
    }
    if (readString(endEvent.payload.reason) !== "inactive-debounce") {
      return false;
    }
    if (isAtlasBetweenGameEnd(platform, endEvent.payload) || readString(endEvent.payload.atlasResultKind) === "match-terminal") {
      return false;
    }
    if (isAtlasSideboardingPayload(endEvent.payload)) {
      return previewGames(session).some(gameHasNonZeroScore);
    }
    if (isAtlasRetainedBetweenGameResult(session, endEvent)) {
      return true;
    }
    if (isAtlasContinuationAfterHeldGame(session, endEvent)) {
      return true;
    }
    const games = previewGames(session);
    if (isBo3Complete(games)) {
      return false;
    }
    const playedGames = games.filter(gameHasNonZeroScore);
    if (playedGames.length !== 1) {
      return false;
    }
    const onlyGame = playedGames[0];
    const total = (onlyGame.myPoints ?? 0) + (onlyGame.oppPoints ?? 0);
    if (isAtlasRootLandingBo1Exit(session, endEvent, games)) {
      return false;
    }
    return total >= 6 && !resultFromText(readString(session.sticky.endText));
  }

  shouldFinalizeBeforeNewSession(event: CaptureEvent): boolean {
    const session = this.sessions.get(event.platform);
    return Boolean(
      session &&
      shouldStartFreshSession(session, event) &&
      sessionHasMeaningfulGameplay(session)
    );
  }

  holdCurrentGame(platform: GamePlatform, endEvent?: CaptureEvent): void {
    const session = this.sessions.get(platform);
    if (!session) {
      return;
    }
    const heldResult = session.platform === "atlas"
      ? endEvent
        ? atlasResultEventIdentity(endEvent) ?? atlasFallbackResultIdentity(endEvent, session.currentGame)
        : atlasFallbackResultIdentity(undefined, session.currentGame, session.updatedAt)
      : undefined;
    completeCurrentGame(session, Boolean(endEvent && resultFromText(readString(endEvent.payload.endText))), endEvent);
    if (heldResult) {
      session.atlasHeldResult = heldResult;
    }
  }

  clear(platform: GamePlatform): void {
    this.sessions.delete(platform);
  }

  get(platform: GamePlatform): SessionState | undefined {
    return this.sessions.get(platform);
  }

  getLatestSessionPlatform(preferred?: GamePlatform): GamePlatform | undefined {
    if (preferred && this.sessions.has(preferred)) {
      return preferred;
    }
    return [...this.sessions.values()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]?.platform;
  }

  getReplayEvents(platform: GamePlatform): ReplayStructuredEvent[] {
    return [...(this.sessions.get(platform)?.replayEvents ?? [])];
  }

  previewGames(platform: GamePlatform): MatchGame[] {
    const session = this.sessions.get(platform);
    return session ? previewGames(session) : [];
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
    updateCurrentGame(session, endEvent);
    const hasTerminalResult = Boolean(resultFromText(session.sticky.endText));
    const finalGame = finishCurrentGameForSession(session, endEvent, hasTerminalResult);
    const shouldSkipFinalGame = shouldSkipDuplicateAtlasFinalGame(session, endEvent, finalGame);
    const keptGames = [
      ...session.completedGames,
      ...(shouldSkipFinalGame ? [] : [finalGame])
    ].filter(isWorthKeeping);
    const atlasRepaired = session.platform === "atlas"
      ? applyAtlasConfirmedGameEvidence(keptGames, [...session.evidence, endEvent])
      : { games: keptGames, confirmedGameNumbers: new Set<number>() };
    const capturedGames = session.platform === "atlas"
      ? collapseAtlasDuplicateBridgeGames(atlasRepaired.games, atlasRepaired.confirmedGameNumbers)
      : keptGames;
    const rawGames = capturedGames.length ? capturedGames : [finalGame];
    const format = inferFormat(session.sticky, rawGames);
    const games = format === "Bo3" ? applyBo3BattlefieldConfidenceGuard(rawGames) : rawGames;
    const primaryGame = games[0];
    const result = resultFromText(session.sticky.endText) ?? unfinishedBo3Result(format, games) ?? resultFromGames(games);
    const now = new Date().toISOString();
    const status = result === "Incomplete" ? "incomplete" : "pending-review";
    const myName = readMyName(session.sticky, settings.username);
    const opponentName = readOpponentName(session.sticky, myName, settings.username);
    const myChampion = normalizeLegendName(
      readString(resolved.myChampion) ||
      readLegendText(session.sticky.myChampion) ||
      legendFromImageUrl(session.sticky.myChampionImage)
    );
    const opponentChampion = normalizeLegendName(
      readString(resolved.opponentChampion) ||
      readLegendText(session.sticky.opponentChampion) ||
      legendFromImageUrl(session.sticky.opponentChampionImage)
    );
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
      myChampion,
      opponentChampion,
      myBattlefield: primaryGame?.myBattlefield || readString(session.sticky.myBattlefield) || readString(resolved.myBattlefield),
      opponentBattlefield: primaryGame?.oppBattlefield || readString(session.sticky.opponentBattlefield) || readString(resolved.opponentBattlefield),
      deckName: readDeckName(session.sticky),
      deckSourceId: readDeckSourceId(session.sticky),
      deckSourceKey: readDeckSourceId(session.sticky),
      deckSourceUrl: readDeckSourceUrl(session.sticky),
      deckSnapshotJson: "",
      flags: "",
      notes: "",
      games,
      rawEvidence: [...session.evidence, endEvent].slice(-160),
      sync: {
        community: publicCommunitySyncEnabled(settings) ? "pending" : "disabled",
        hubs: privateHubSyncEnabled(settings)
          ? Object.fromEntries(settings.activeHubs.filter((hub) => hub.sync).map((hub) => [hub.id, "pending"]))
          : {},
        teams: teamSyncEnabled(settings)
          ? Object.fromEntries((settings.activeTeams ?? []).filter((team) => team.sync).map((team) => [team.id, "pending"]))
          : {}
      }
    };
  }
}

function createSession(event: CaptureEvent): SessionState {
  const sticky: Record<string, unknown> = {};
  mergeSticky(sticky, event.payload);
  return {
    id: event.id,
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
    completedGames: [],
    atlasCompletedGameIdentities: []
  };
}

function shouldStartFreshSession(session: SessionState, event: CaptureEvent): boolean {
  if (!readBoolean(event.payload.active)) {
    return false;
  }
  if (isAtlasContinuationAfterHeldGame(session, event)) {
    return false;
  }
  if (isAtlasSameOpponentBo3ContinuationCandidate(session, event)) {
    return false;
  }
  if (isFreshAtlasMatchAfterCompletedSession(session, event)) {
    return true;
  }
  const existingOpponent = normalizePlayerNameKey(readString(session.sticky.opponentName));
  const nextOpponent = normalizePlayerNameKey(readString(event.payload.opponentName));
  const existingOpponentIsNoise = isLikelyAtlasActionText(existingOpponent) || isLikelyAtlasPlayerNameNoise(existingOpponent);
  const nextOpponentIsNoise = isLikelyAtlasActionText(nextOpponent) || isLikelyAtlasPlayerNameNoise(nextOpponent);
  if (event.platform === "atlas" && (existingOpponentIsNoise || nextOpponentIsNoise)) {
    return false;
  }
  if (!existingOpponent || !nextOpponent || existingOpponent === nextOpponent) {
    return false;
  }
  const nextScore = readScore(event.payload);
  const nextScoreTotal = (nextScore.me ?? 0) + (nextScore.opp ?? 0);
  const currentScoreTotal = (session.currentGame.myPoints ?? 0) + (session.currentGame.oppPoints ?? 0);
  const previousGameTotals = session.completedGames.map((game) => (game.myPoints ?? 0) + (game.oppPoints ?? 0));
  const previousLooksPlayed = currentScoreTotal >= 6 || previousGameTotals.some((total) => total >= 6);
  const nextLooksFresh = event.kind === "match-start" || nextScoreTotal <= 1 || nextScoreTotal <= currentScoreTotal - 4;
  if (!previousLooksPlayed) {
    // A reliable opponent change still starts a new identity boundary even
    // when the abandoned lobby never accumulated a meaningful score. The
    // coordinator separately decides whether the old session is worth a
    // review, so a quick disconnect cannot contaminate the next match.
    return nextLooksFresh;
  }
  if (session.completedGames.length > 0) {
    return true;
  }
  return nextLooksFresh;
}

function isAtlasSameOpponentBo3ContinuationCandidate(session: SessionState, event: CaptureEvent): boolean {
  if (session.platform !== "atlas" || event.platform !== "atlas") {
    return false;
  }
  const existingGames = previewGames(session);
  if (!session.completedGames.length || existingGames.length >= 3) {
    return false;
  }
  const previousGameNumber = atlasConfirmGameNumber(session.sticky);
  const previousWasGameConfirm = readString(session.sticky.atlasResultKind) === "game-result" ||
    isAtlasBo3QueuePayload(session.sticky) ||
    previousGameNumber > 0 ||
    atlasGameWinnerPattern().test(readString(session.sticky.endText));
  const currentIsCommittedAtlasChildGame = previousWasGameConfirm && previousGameNumber > 0 && previousGameNumber < 3;
  if (isWorthKeeping(finishCurrentGame(session.currentGame)) && gameStateHasNonZeroScore(session.currentGame) && !currentIsCommittedAtlasChildGame) {
    return false;
  }
  const continuationMarker = isAtlasSideboardingPayload(event.payload) || isAtlasBo3QueuePayload(event.payload);
  if ((readString(event.payload.atlasResultKind) || readString(event.payload.endText)) && !continuationMarker) {
    return false;
  }
  const existingOpponent = normalizePlayerNameKey(readString(session.sticky.opponentName));
  const nextOpponent = normalizePlayerNameKey(readString(event.payload.opponentName));
  const existingOpponentIsNoise = isLikelyAtlasActionText(existingOpponent) || isLikelyAtlasPlayerNameNoise(existingOpponent);
  const nextOpponentIsNoise = isLikelyAtlasActionText(nextOpponent) || isLikelyAtlasPlayerNameNoise(nextOpponent);
  if (existingOpponent && nextOpponent && existingOpponent !== nextOpponent && !existingOpponentIsNoise && !nextOpponentIsNoise) {
    return false;
  }
  const existingMyLegend = normalizeNameKey(readString(session.sticky.myChampion));
  const nextMyLegend = normalizeNameKey(readString(event.payload.myChampion));
  if (existingMyLegend && nextMyLegend && existingMyLegend !== nextMyLegend) {
    return false;
  }
  const existingOppLegend = normalizeNameKey(readString(session.sticky.opponentChampion));
  const nextOppLegend = normalizeNameKey(readString(event.payload.opponentChampion));
  if (existingOppLegend && nextOppLegend && existingOppLegend !== nextOppLegend) {
    return false;
  }
  const eventAt = new Date(event.capturedAt).getTime();
  const sessionAt = new Date(session.updatedAt).getTime();
  if (Number.isFinite(eventAt) && Number.isFinite(sessionAt) && eventAt - sessionAt > 120_000) {
    return false;
  }
  const score = readScore(event.payload);
  const scoreTotal = (score.me ?? 0) + (score.opp ?? 0);
  return event.kind === "match-start" ||
    readString(event.payload.reason) === "active-returned" ||
    isAtlasBo3QueuePayload(event.payload) ||
    isAtlasSideboardingPayload(event.payload) ||
    scoreTotal <= 1;
}

function isAtlasContinuationAfterHeldGame(session: SessionState, event: CaptureEvent): boolean {
  if (session.platform !== "atlas" || event.platform !== "atlas") {
    return false;
  }
  if (!session.completedGames.length) {
    return false;
  }
  const continuationMarker = isAtlasSideboardingPayload(event.payload) || isAtlasBo3QueuePayload(event.payload);
  if ((readString(event.payload.atlasResultKind) || readString(event.payload.endText)) && !continuationMarker) {
    return false;
  }
  const previousResultText = readString(session.sticky.endText);
  const previousGameNumber = atlasConfirmGameNumber(session.sticky);
  if (previousGameNumber >= 3) {
    return false;
  }
  const previousWasGameConfirm = readString(session.sticky.atlasResultKind) === "game-result" ||
    isAtlasBo3QueuePayload(session.sticky) ||
    atlasConfirmGameNumber(session.sticky) > 0 ||
    atlasGameWinnerPattern().test(previousResultText);
  if (!previousWasGameConfirm) {
    return false;
  }
  const currentIsCommittedAtlasChildGame = previousGameNumber > 0 && previousGameNumber < 3;
  if (isWorthKeeping(finishCurrentGame(session.currentGame)) && gameStateHasNonZeroScore(session.currentGame) && !currentIsCommittedAtlasChildGame) {
    return false;
  }
  const eventAt = new Date(event.capturedAt).getTime();
  const sessionAt = new Date(session.updatedAt).getTime();
  if (Number.isFinite(eventAt) && Number.isFinite(sessionAt) && eventAt - sessionAt > 120_000) {
    return false;
  }
  const existingOpponent = normalizePlayerNameKey(readString(session.sticky.opponentName));
  const nextOpponent = normalizePlayerNameKey(readString(event.payload.opponentName));
  const existingOpponentIsNoise = isLikelyAtlasActionText(existingOpponent) || isLikelyAtlasPlayerNameNoise(existingOpponent);
  const nextOpponentIsNoise = isLikelyAtlasActionText(nextOpponent) || isLikelyAtlasPlayerNameNoise(nextOpponent);
  if (existingOpponent && nextOpponent && existingOpponent !== nextOpponent && !existingOpponentIsNoise && !nextOpponentIsNoise) {
    return false;
  }
  const score = readScore(event.payload);
  const scoreTotal = (score.me ?? 0) + (score.opp ?? 0);
  return event.kind === "match-start" ||
    readString(event.payload.reason) === "active-returned" ||
    isAtlasBo3QueuePayload(event.payload) ||
    isAtlasSideboardingPayload(event.payload) ||
    scoreTotal <= 1;
}

function isFreshAtlasMatchAfterCompletedSession(session: SessionState, event: CaptureEvent): boolean {
  if (session.platform !== "atlas" || event.platform !== "atlas") {
    return false;
  }
  if (readString(event.payload.atlasResultKind) || readString(event.payload.endText)) {
    return false;
  }
  const existingGames = previewGames(session);
  const terminalComplete = readString(session.sticky.atlasResultKind) === "match-terminal" ||
    /match complete/i.test(readString(session.sticky.endText));
  const sessionComplete = isBo3Complete(existingGames) || terminalComplete;
  if (!sessionComplete) {
    return false;
  }
  if (!terminalComplete && isBo3Complete(existingGames) && highestAtlasConfirmedGameNumber(session) < 2) {
    return false;
  }
  const score = readScore(event.payload);
  const scoreTotal = (score.me ?? 0) + (score.opp ?? 0);
  return event.kind === "match-start" && scoreTotal <= 1;
}

function mergeSticky(target: Record<string, unknown>, source: Record<string, unknown>): void {
  const sourceHasAtlasResult = hasValue(source.atlasResultKind) || hasValue(source.endText);
  const sourceIsActiveAtlasGame = readBoolean(source.active) && !isAtlasSideboardingPayload(source);
  if (sourceIsActiveAtlasGame && !sourceHasAtlasResult) {
    delete target.atlasResultKind;
    delete target.endText;
    delete target.atlasBo3GameNumber;
    delete target.atlasSideboarding;
  }
  const keys = [
    "myName",
    "opponentName",
    "myChampion",
    "opponentChampion",
    "myChampionCode",
    "opponentChampionCode",
    "myChampionImage",
    "opponentChampionImage",
    "myBattlefield",
    "opponentBattlefield",
    "myBattlefieldCode",
    "opponentBattlefieldCode",
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
    "atlasBo3Queue",
    "atlasBo3GameNumber",
    "atlasSideboarding",
    "atlasResultKind",
    "endText"
  ];
  for (const key of keys) {
    const value = source[key];
    if ((key === "atlasResultKind" || key === "endText") && typeof value === "string") {
      if (hasValue(value)) {
        target[key] = value;
      }
      continue;
    }
    if (key === "opponentName") {
      const rawOpponentName = readString(value);
      if (isLikelyAtlasActionText(rawOpponentName) || isLikelyAtlasPlayerNameNoise(rawOpponentName)) {
        continue;
      }
      const cleanedOpponentName = cleanPlayerName(rawOpponentName);
      if (hasValue(cleanedOpponentName)) {
        target[key] = cleanedOpponentName;
      }
      continue;
    }
    if ((key === "myChampion" || key === "opponentChampion") && isLikelyTcgaLegendNoise(readString(value))) {
      continue;
    }
    if ((key === "myBattlefield" || key === "opponentBattlefield") && isGeneratedBattlefieldName(readString(value))) {
      continue;
    }
    if ((key === "myBattlefieldCode" || key === "opponentBattlefieldCode") && isGeneratedBattlefieldCode(readString(value))) {
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

function updateCurrentGame(session: SessionState, event: CaptureEvent): void {
  const payload = event.payload;
  if (isAtlasHeldResultEcho(session, event)) {
    return;
  }
  if (isAtlasCurrentResultEcho(session, event)) {
    return;
  }
  if (isAtlasTerminalEchoAfterHeldGame(session, payload)) {
    return;
  }
  if (
    session.platform === "atlas" &&
    session.atlasHeldResult &&
    readString(payload.atlasResultKind) !== "game-result" &&
    shouldClearAtlasHeldResultSignature(payload)
  ) {
    session.atlasHeldResult = undefined;
  }
  if (shouldCommitAtlasResultBeforeEvent(session, event)) {
    completeCurrentGame(session, true, event);
  }
  if (readString(payload.reason) === "active-returned") {
    completeCurrentGame(session, false, event);
  }
  const score = readScore(payload);
  if (shouldStartNextGame(session, score, payload)) {
    completeCurrentGame(session, false, event);
  }
  if (session.platform === "atlas") {
    session.currentGame.atlasStartedAt ||= event.capturedAt;
    session.currentGame.atlasLastObservedAt = event.capturedAt;
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
  const myBattlefieldCode = readBattlefieldCode(payload, "me");
  const opponentBattlefieldCode = readBattlefieldCode(payload, "opponent");
  const myBattlefieldImage = readBattlefieldImage(payload, "me");
  const opponentBattlefieldImage = readBattlefieldImage(payload, "opponent");
  if (myBattlefield && !isGeneratedBattlefieldName(myBattlefield)) {
    session.currentGame.myBattlefield = myBattlefield;
  }
  if (opponentBattlefield && !isGeneratedBattlefieldName(opponentBattlefield)) {
    session.currentGame.opponentBattlefield = opponentBattlefield;
  }
  if (myBattlefieldCode) {
    session.currentGame.myBattlefieldCode = myBattlefieldCode;
  }
  if (opponentBattlefieldCode) {
    session.currentGame.opponentBattlefieldCode = opponentBattlefieldCode;
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
  const atlasResultEvent = atlasResultEventIdentity(event);
  if (atlasResultEvent) {
    session.currentGame.atlasResultEvent = atlasResultEvent;
  }
  const wentFirst = readWentFirst(payload.wentFirst);
  if (wentFirst) {
    session.currentGame.wentFirst = wentFirst;
  }
}

function updateReplayStream(session: SessionState, event: CaptureEvent): void {
  const score = readScore(event.payload);
  if (session.platform === "sim") {
    addSimReplayEvent(session, event);
  } else if (session.platform === "atlas") {
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

function addSimReplayEvent(session: SessionState, event: CaptureEvent): void {
  const simEvent = readSimEvent(event.payload.simEvent);
  if (!simEvent) {
    return;
  }
  const signature = replayRowSignature(`sim:${simEvent.id}`);
  if (session.replaySeenRows.has(signature)) {
    return;
  }
  session.replaySeenRows.add(signature);
  const score = simEvent.score ? { me: simEvent.score.me, opponent: simEvent.score.opponent } : undefined;
  const visibleCard = simEvent.visibility === "hidden" || simEvent.visibility === "private-opponent" ? undefined : simEvent.card ?? simEvent.cards?.[0];
  pushReplayEvent(session, {
    id: simEvent.id,
    sourceEventId: event.id,
    gameNumber: simEvent.gameNumber,
    capturedAt: simEvent.emittedAt || event.capturedAt,
    labelTime: replayTimeLabel(simEvent.emittedAt || event.capturedAt),
    type: simReplayType(simEvent.type),
    side: simReplaySide(simEvent.actor),
    text: cleanReplayText(simEvent.text),
    cardName: visibleCard?.name ?? "",
    cardId: visibleCard?.id,
    cardCount: simEvent.cardCount,
    destination: simEvent.destination || simEvent.toZone || "",
    fromZone: simEvent.fromZone,
    toZone: simEvent.toZone,
    visibility: simEvent.visibility,
    actionId: simEvent.actionId,
    undoOf: simEvent.undoOf,
    battlefield: simEvent.battlefield ?? "",
    pointsScored: simEvent.pointsScored,
    scoreReason: simEvent.scoreReason,
    score,
    mulligan: simEvent.visibility === "hidden" || simEvent.visibility === "private-opponent" ? undefined : simEvent.mulligan,
    resource: simEvent.resource,
    counter: simEvent.counter,
    token: simEvent.token,
    combat: simEvent.combat,
    snapshot: simEvent.snapshot
  });
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
  return riftboundCardCodeFromValue(value);
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
      riftboundCardCodeFromValue(readString(payload.myBattlefieldCode)) ||
      riftboundCardCodeFromValue(readString(payload.opponentBattlefieldCode)) ||
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
  const oppKey = normalizePlayerNameKey(readString(payload.opponentName));
  if (ownerKey && myKey && ownerKey === myKey) return "me";
  if (ownerKey && oppKey && ownerKey === oppKey) return "opponent";
  return "system";
}

function readSimEvent(value: unknown): RiftboundSimEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const type = readString(value.type);
  const id = readString(value.id);
  const matchId = readString(value.matchId);
  if (!type || !id || !matchId) {
    return null;
  }
  return value as unknown as RiftboundSimEvent;
}

function simReplayType(type: RiftboundSimEvent["type"]): ReplayStructuredEvent["type"] {
  if (type === "turn-start") return "turn-start";
  if (type === "turn-end") return "turn-end";
  if (type === "draw") return "draw";
  if (type === "play" || type === "token-create") return "play";
  if (type === "move" || type === "recycle") return "move";
  if (type === "score") return "score";
  if (type === "combat") return "combat";
  if (type === "match-end") return "result";
  if (type === "match-start" || type === "game-start" || type === "setup") {
    return "setup";
  }
  if (type === "mulligan-options" || type === "mulligan-choice" || type === "mulligan-redraw") return "mulligan";
  return "action";
}

function simReplaySide(side: RiftboundSimEvent["actor"]): ReplayStructuredEvent["side"] {
  return side === "me" || side === "opponent" || side === "system" ? side : "unknown";
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

function completeCurrentGame(session: SessionState, hasTerminalResult = false, sourceEvent?: CaptureEvent): void {
  const currentGame = session.currentGame;
  const finished = finishCurrentGameForSession(session, sourceEvent, hasTerminalResult);
  if (isWorthKeeping(finished)) {
    appendCompletedGame(session, finished, atlasGameIdentity(session, currentGame, sourceEvent));
  }
  session.currentGame = createGameState(session.completedGames.length + 1);
  session.replayLastScore = "";
  session.replayLastBattlefields = "";
  session.replayLastTurnText = "";
  session.replayLastTurnAt = 0;
  session.replayVisibleCards = new Map<string, ReplayCardState>();
  session.replayCardBaselineReady = false;
}

function finishCurrentGameForSession(
  session: SessionState,
  sourceEvent: CaptureEvent | undefined,
  hasTerminalResult = false
): MatchGame {
  const finished = finishCurrentGame(session.currentGame);
  const atlasResultEvent = session.currentGame.atlasResultEvent ?? (sourceEvent ? atlasResultEventIdentity(sourceEvent) : undefined);
  const atlasGameNumber = session.platform === "atlas" ? atlasResultEvent?.gameNumber ?? 0 : 0;
  const withAtlasNumber = atlasGameNumber ? { ...finished, gameNumber: atlasGameNumber } : finished;
  return normalizeAmbiguousInactiveGame(withAtlasNumber, hasTerminalResult);
}

function appendCompletedGame(session: SessionState, game: MatchGame, identity?: AtlasGameIdentity): void {
  if (session.platform !== "atlas") {
    session.completedGames.push(game);
    return;
  }

  const atlasIdentity = identity ?? atlasGameIdentity(session, session.currentGame);
  const normalized = normalizeAtlasCompletedGameNumber(session, game, atlasIdentity);
  const sameIdentityIndex = session.atlasCompletedGameIdentities.findIndex((existing) => sameAtlasGameIdentity(existing, atlasIdentity));
  if (sameIdentityIndex >= 0) {
    session.completedGames[sameIdentityIndex] = mergeAtlasGameDetails(normalized, session.completedGames[sameIdentityIndex]);
    session.atlasCompletedGameIdentities[sameIdentityIndex] = preferAtlasGameIdentity(atlasIdentity, session.atlasCompletedGameIdentities[sameIdentityIndex]);
    return;
  }

  const slotIndex = atlasIdentity.explicitGameNumber >= 1 && atlasIdentity.explicitGameNumber <= session.completedGames.length
    ? atlasIdentity.explicitGameNumber - 1
    : -1;
  if (slotIndex >= 0 && session.completedGames[slotIndex]) {
    session.completedGames[slotIndex] = mergeAtlasGameDetails(normalized, session.completedGames[slotIndex]);
    session.atlasCompletedGameIdentities[slotIndex] = preferAtlasGameIdentity(atlasIdentity, session.atlasCompletedGameIdentities[slotIndex]);
    return;
  }

  const lastIndex = session.completedGames.length - 1;
  const lastCompleted = session.completedGames[lastIndex];
  const lastIdentity = session.atlasCompletedGameIdentities[lastIndex];
  if (lastCompleted && lastIdentity && isTransientAtlasBridgeEcho(lastCompleted, lastIdentity, normalized, atlasIdentity)) {
    session.completedGames[lastIndex] = mergeAtlasGameDetails({ ...normalized, gameNumber: lastCompleted.gameNumber }, lastCompleted);
    return;
  }

  if (session.completedGames.length >= 3) {
    if (lastCompleted) {
      session.completedGames[lastIndex] = mergeAtlasGameDetails(normalized, lastCompleted);
    }
    return;
  }

  session.completedGames.push(normalized);
  session.atlasCompletedGameIdentities.push(atlasIdentity);
}

function normalizeAtlasCompletedGameNumber(session: SessionState, game: MatchGame, identity: AtlasGameIdentity): MatchGame {
  const rawGameNumber = identity.explicitGameNumber || (typeof game.gameNumber === "number" ? game.gameNumber : 0);
  if (rawGameNumber > 3) {
    return { ...game, gameNumber: 3 };
  }
  if (rawGameNumber >= 1) {
    return game;
  }
  return { ...game, gameNumber: Math.min(3, session.completedGames.length + 1) };
}

function atlasGameIdentity(session: SessionState, game: GameDraftState, sourceEvent?: CaptureEvent): AtlasGameIdentity {
  const resultEvent = game.atlasResultEvent ?? (sourceEvent ? atlasResultEventIdentity(sourceEvent) : undefined);
  return {
    sessionId: session.id,
    ordinal: game.gameNumber,
    explicitGameNumber: resultEvent?.gameNumber ?? 0,
    resultEventId: resultEvent?.id ?? "",
    startedAt: game.atlasStartedAt ?? "",
    completedAt: sourceEvent?.capturedAt ?? resultEvent?.capturedAt ?? game.atlasLastObservedAt ?? ""
  };
}

function sameAtlasGameIdentity(a: AtlasGameIdentity, b: AtlasGameIdentity): boolean {
  if (a.sessionId !== b.sessionId) {
    return false;
  }
  if (a.resultEventId && b.resultEventId && a.resultEventId === b.resultEventId) {
    return true;
  }
  if (a.explicitGameNumber || b.explicitGameNumber) {
    return Boolean(a.explicitGameNumber && b.explicitGameNumber && a.explicitGameNumber === b.explicitGameNumber);
  }
  return a.ordinal === b.ordinal;
}

function preferAtlasGameIdentity(primary: AtlasGameIdentity, fallback: AtlasGameIdentity): AtlasGameIdentity {
  if (primary.resultEventId || primary.explicitGameNumber) {
    return primary;
  }
  return fallback;
}

function isTransientAtlasBridgeEcho(
  previousGame: MatchGame,
  previousIdentity: AtlasGameIdentity,
  candidateGame: MatchGame,
  candidateIdentity: AtlasGameIdentity
): boolean {
  if (
    previousIdentity.sessionId !== candidateIdentity.sessionId ||
    candidateIdentity.resultEventId ||
    candidateIdentity.explicitGameNumber ||
    candidateIdentity.ordinal !== previousIdentity.ordinal + 1
  ) {
    return false;
  }
  const startedAt = new Date(candidateIdentity.startedAt).getTime();
  const completedAt = new Date(candidateIdentity.completedAt).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt || completedAt - startedAt > 5_000) {
    return false;
  }
  return sameAtlasBridgeCapture(previousGame, candidateGame);
}

function createGameState(gameNumber: number): GameDraftState {
  return {
    gameNumber,
    myBattlefield: "",
    opponentBattlefield: "",
    myBattlefieldCode: "",
    opponentBattlefieldCode: "",
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
    if (session.platform === "atlas") {
      return false;
    }
    return currentHasNonZeroScore && looksMultiGame && (
      battlefieldChanged(current.myBattlefield, payload.myBattlefield) ||
      battlefieldChanged(current.opponentBattlefield, payload.opponentBattlefield) ||
      battlefieldCodeChanged(current.myBattlefieldCode, readBattlefieldCode(payload, "me")) ||
      battlefieldCodeChanged(current.opponentBattlefieldCode, readBattlefieldCode(payload, "opponent")) ||
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
  const leadingScore = Math.max(currentMe, currentOpp);
  if (session.platform === "atlas") {
    return scoreDropped &&
      currentTotal >= 6 &&
      (hasNumericReset || (looksMultiGame && nextTotal > 0 && nextTotal <= 2)) &&
      isWorthKeeping(finishCurrentGame(current));
  }
  const explicitBo3LowScoreReset = looksMultiGame && leadingScore >= 4;
  if (scoreDropped && hasNumericReset && (leadingScore >= 5 || explicitBo3LowScoreReset)) {
    return isWorthKeeping(normalizeAmbiguousInactiveGame(finishCurrentGame(current), false));
  }
  if (scoreDropped && currentTotal >= 6 && nextTotal <= currentTotal - 2) {
    return hasNumericReset || nextTotal > 0 || looksMultiGame;
  }
  return currentHasNonZeroScore && (nextHasNonZeroScore || looksMultiGame) && (
    battlefieldChanged(current.myBattlefield, payload.myBattlefield) ||
    battlefieldChanged(current.opponentBattlefield, payload.opponentBattlefield) ||
    battlefieldCodeChanged(current.myBattlefieldCode, readBattlefieldCode(payload, "me")) ||
    battlefieldCodeChanged(current.opponentBattlefieldCode, readBattlefieldCode(payload, "opponent")) ||
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
    Boolean(
      game.myBattlefield ||
      game.oppBattlefield ||
      game.myBattlefieldCode ||
      game.oppBattlefieldCode ||
      game.myBattlefieldImage ||
      game.oppBattlefieldImage ||
      game.wentFirst
    );
}

function sessionHasMeaningfulGameplay(session: SessionState): boolean {
  if (previewGames(session).some((game) => (
    game.result !== "Incomplete" ||
    (game.myPoints ?? 0) > 0 ||
    (game.oppPoints ?? 0) > 0
  ))) {
    return true;
  }
  return session.evidence.some((event) => {
    if (resultFromText(readString(event.payload.endText))) return true;
    const rows = Array.isArray(event.payload.rows) ? event.payload.rows : [];
    return rows.some((row) => {
      const text = row && typeof row === "object" && !Array.isArray(row)
        ? readString((row as Record<string, unknown>).text)
        : readString(row);
      return /starting turn|mulligan|played|combat|attack|block|wins!|opponent.*left|left the game/i.test(text);
    });
  });
}

function gameHasNonZeroScore(game: MatchGame): boolean {
  return (game.myPoints ?? 0) > 0 || (game.oppPoints ?? 0) > 0;
}

function isAtlasRootLandingBo1Exit(session: SessionState, endEvent: CaptureEvent, games: MatchGame[]): boolean {
  const eventFormat = readString(endEvent.payload.format).toLowerCase();
  if (!isAtlasRootLandingUrl(endEvent.url) || !eventFormat.includes("bo1")) {
    return false;
  }
  return !hasAtlasBo3ContinuationEvidence(session, endEvent, games);
}

function hasAtlasBo3ContinuationEvidence(session: SessionState, endEvent: CaptureEvent, games: MatchGame[]): boolean {
  const rawFormat = `${readString(session.sticky.format)} ${readString(endEvent.payload.format)}`.toLowerCase();
  const rawBo3QueueText = `${atlasBo3QueueText(session.sticky)} ${atlasBo3QueueText(endEvent.payload)}`.toLowerCase();
  return session.completedGames.length > 0 ||
    games.length > 1 ||
    rawFormat.includes("bo3") ||
    rawFormat.includes("best of 3") ||
    rawBo3QueueText.includes("bo3") ||
    rawBo3QueueText.includes("best of 3") ||
    readString(session.sticky.atlasResultKind) === "game-result" ||
    readString(endEvent.payload.atlasResultKind) === "game-result" ||
    atlasConfirmGameNumber(session.sticky) > 0 ||
    atlasConfirmGameNumber(endEvent.payload) > 0 ||
    isAtlasBo3QueuePayload(session.sticky) ||
    isAtlasBo3QueuePayload(endEvent.payload) ||
    isAtlasSideboardingPayload(session.sticky) ||
    isAtlasSideboardingPayload(endEvent.payload) ||
    atlasGameWinnerPattern().test(readString(session.sticky.endText)) ||
    atlasGameWinnerPattern().test(readString(endEvent.payload.endText));
}

function isAtlasRootLandingUrl(value: string): boolean {
  const raw = readString(value).trim();
  if (!raw) {
    return false;
  }
  try {
    const parsed = new URL(raw);
    return parsed.hostname === "play.riftatlas.com" && (parsed.pathname === "/" || parsed.pathname === "");
  } catch {
    return /^https:\/\/play\.riftatlas\.com\/?$/i.test(raw);
  }
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
    myBattlefieldCode: game.myBattlefieldCode,
    oppBattlefieldCode: game.opponentBattlefieldCode,
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
      myBattlefieldCode: "",
      oppBattlefieldCode: "",
      myBattlefieldImage: "",
      oppBattlefieldImage: ""
    };
  });
}

function applyAtlasConfirmedGameEvidence(
  games: MatchGame[],
  evidence: CaptureEvent[]
): { games: MatchGame[]; confirmedGameNumbers: Set<number> } {
  const confirmed = new Map<number, MatchGame>();
  for (const event of evidence) {
    if (event.platform !== "atlas") {
      continue;
    }
    const gameNumber = atlasConfirmGameNumber(event.payload);
    if (gameNumber < 1 || gameNumber > 3) {
      continue;
    }
    const kind = readString(event.payload.atlasResultKind);
    if (kind !== "game-result" && !atlasGameWinnerPattern().test(readString(event.payload.endText))) {
      continue;
    }
    const game = atlasConfirmedPayloadToGame(event.payload, gameNumber);
    if (!isWorthKeeping(game)) {
      continue;
    }
    const previous = confirmed.get(gameNumber);
    confirmed.set(gameNumber, previous ? mergeAtlasGameDetails(game, previous) : game);
  }
  if (!confirmed.size) {
    return { games, confirmedGameNumbers: new Set<number>() };
  }
  const confirmedGameNumbers = new Set(confirmed.keys());
  const highestConfirmedGameNumber = Math.max(...confirmedGameNumbers);
  const lastExistingGame = games[games.length - 1];
  const highestConfirmedGame = confirmed.get(highestConfirmedGameNumber);
  const hasTrailingUnconfirmedGame =
    Boolean(lastExistingGame && highestConfirmedGame && games.length <= highestConfirmedGameNumber && !sameAtlasGameSlot(lastExistingGame, highestConfirmedGame));
  const maxSlots = Math.max(games.length, highestConfirmedGameNumber + (hasTrailingUnconfirmedGame ? 1 : 0));
  const repaired: MatchGame[] = [];
  for (let gameNumber = 1; gameNumber <= maxSlots; gameNumber += 1) {
    const existing = games[gameNumber - 1];
    const confirmedGame = confirmed.get(gameNumber);
    if (confirmedGame) {
      repaired.push(mergeAtlasGameDetails(confirmedGame, existing));
    } else if (existing) {
      repaired.push({ ...existing, gameNumber });
    } else if (hasTrailingUnconfirmedGame && gameNumber === highestConfirmedGameNumber + 1 && lastExistingGame) {
      repaired.push({ ...lastExistingGame, gameNumber });
    }
  }
  return { games: repaired.filter(isWorthKeeping), confirmedGameNumbers };
}

function atlasConfirmedPayloadToGame(payload: Record<string, unknown>, gameNumber: number): MatchGame {
  const score = readScore(payload);
  const textResult = resultFromText(payload.endText);
  return normalizeAmbiguousInactiveGame({
    gameNumber,
    result: textResult ?? inferResult(score.me, score.opp),
    myPoints: score.me,
    oppPoints: score.opp,
    myBattlefield: readString(payload.myBattlefield),
    oppBattlefield: readString(payload.opponentBattlefield),
    myBattlefieldCode: readBattlefieldCode(payload, "me"),
    oppBattlefieldCode: readBattlefieldCode(payload, "opponent"),
    myBattlefieldImage: readBattlefieldImage(payload, "me"),
    oppBattlefieldImage: readBattlefieldImage(payload, "opponent"),
    wentFirst: readWentFirst(payload.wentFirst)
  }, Boolean(textResult));
}

function mergeAtlasGameDetails(primary: MatchGame, fallback?: MatchGame): MatchGame {
  if (!fallback) {
    return primary;
  }
  return {
    ...fallback,
    ...primary,
    result: primary.result !== "Incomplete" ? primary.result : fallback.result,
    myPoints: typeof primary.myPoints === "number" ? primary.myPoints : fallback.myPoints,
    oppPoints: typeof primary.oppPoints === "number" ? primary.oppPoints : fallback.oppPoints,
    myBattlefield: primary.myBattlefield || fallback.myBattlefield,
    oppBattlefield: primary.oppBattlefield || fallback.oppBattlefield,
    myBattlefieldCode: primary.myBattlefieldCode || fallback.myBattlefieldCode,
    oppBattlefieldCode: primary.oppBattlefieldCode || fallback.oppBattlefieldCode,
    myBattlefieldImage: primary.myBattlefieldImage || fallback.myBattlefieldImage,
    oppBattlefieldImage: primary.oppBattlefieldImage || fallback.oppBattlefieldImage,
    wentFirst: primary.wentFirst || fallback.wentFirst
  };
}

function collapseAtlasDuplicateBridgeGames(games: MatchGame[], protectedGameNumbers = new Set<number>()): MatchGame[] {
  if (games.length < 3) {
    return games;
  }
  const collapsed: MatchGame[] = [];
  for (let index = 0; index < games.length; index += 1) {
    const game = games[index];
    const previous = collapsed[collapsed.length - 1];
    if (previous && sameAtlasGameSlot(previous, game)) {
      collapsed[collapsed.length - 1] = mergeAtlasGameDetails(game, previous);
      continue;
    }
    collapsed.push(game);
  }

  if (collapsed.length > 3 && protectedGameNumbers.size) {
    const confirmedSlots = [1, 2, 3]
      .map((gameNumber) => collapsed.find((game) => game.gameNumber === gameNumber && isWorthKeeping(game)))
      .filter((game): game is MatchGame => Boolean(game));
    if (confirmedSlots.length === 3) {
      return confirmedSlots.map((game, index) => ({ ...game, gameNumber: index + 1 }));
    }
  }

  if (collapsed.length <= 3) {
    return collapsed.map((game, index) => ({ ...game, gameNumber: index + 1 }));
  }

  const renumbered = collapsed.map((game, index) => ({ ...game, gameNumber: index + 1 }));
  return [
    renumbered[0],
    renumbered[1],
    renumbered[renumbered.length - 1]
  ].map((game, index) => ({ ...game, gameNumber: index + 1 }));
}

function sameAtlasGameSlot(a: MatchGame, b: MatchGame): boolean {
  return typeof a.gameNumber === "number" &&
    typeof b.gameNumber === "number" &&
    a.gameNumber > 0 &&
    a.gameNumber === b.gameNumber;
}

function sameAtlasBridgeCapture(a: MatchGame, b: MatchGame): boolean {
  return a.result === b.result &&
    gamePointKey(a) === gamePointKey(b) &&
    compatibleBattlefieldPair(a, b);
}

function hasBattlefieldPair(game: MatchGame): boolean {
  return Boolean(battlefieldIdentity(game, "me") && battlefieldIdentity(game, "opponent"));
}

function sameBattlefieldPair(a: MatchGame, b: MatchGame): boolean {
  return battlefieldIdentity(a, "me") === battlefieldIdentity(b, "me") &&
    battlefieldIdentity(a, "opponent") === battlefieldIdentity(b, "opponent");
}

function compatibleBattlefieldPair(a: MatchGame, b: MatchGame): boolean {
  return compatibleBattlefieldIdentity(a, b, "me") &&
    compatibleBattlefieldIdentity(a, b, "opponent");
}

function compatibleBattlefieldIdentity(a: MatchGame, b: MatchGame, side: "me" | "opponent"): boolean {
  const aIdentity = battlefieldIdentity(a, side);
  const bIdentity = battlefieldIdentity(b, side);
  return !aIdentity || !bIdentity || aIdentity === bIdentity;
}

function battlefieldIdentity(game: MatchGame, side: "me" | "opponent"): string {
  const code = side === "me" ? game.myBattlefieldCode : game.oppBattlefieldCode;
  const name = side === "me" ? game.myBattlefield : game.oppBattlefield;
  const image = side === "me" ? game.myBattlefieldImage : game.oppBattlefieldImage;
  return riftboundCardCodeFromValue(readString(code)) || normalizeNameKey(readString(name)) || normalizeAssetKey(readString(image));
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
  if (/(?:confirm|choose|select|report)\s+game\s+\d+\s+winner|(?:confirm|choose|select|report)\s+(?:the\s+)?winner\s+(?:for|of)\s+game\s+\d+|game\s+\d+.{0,48}(?:winner|choose|select|confirm|report)/.test(raw)) {
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
  if (games.length > 1) {
    return "Bo3";
  }
  if (raw.includes("bo1") || raw.includes("best of 1")) {
    return "Bo1";
  }
  return "Bo1";
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
  if (isMeaningfulDeckValue(direct)) {
    return direct;
  }
  const selectedDeck = sticky.selectedDeck;
  if (selectedDeck && typeof selectedDeck === "object") {
    const selectedLabel = readString((selectedDeck as Record<string, unknown>).selected_label);
    return isMeaningfulDeckValue(selectedLabel) ? selectedLabel : "";
  }
  return "";
}

function readDeckSourceId(sticky: Record<string, unknown>): string {
  const direct = readString(sticky.deckSourceId);
  if (isMeaningfulDeckValue(direct)) {
    return direct;
  }
  const selectedDeck = sticky.selectedDeck;
  if (selectedDeck && typeof selectedDeck === "object") {
    const selectedUuid = readString((selectedDeck as Record<string, unknown>).selected_uuid);
    return isMeaningfulDeckValue(selectedUuid) ? selectedUuid : "";
  }
  return "";
}

function readDeckSourceUrl(sticky: Record<string, unknown>): string {
  const selectedDeck = sticky.selectedDeck;
  if (selectedDeck && typeof selectedDeck === "object") {
    const record = selectedDeck as Record<string, unknown>;
    const sourceUrl = readString(record.source_url);
    const selectedUuid = readString(record.selected_uuid);
    return sourceUrl && isMeaningfulDeckValue(selectedUuid || sourceUrl.replace(/^tcga:\/\/deck\//i, "")) ? sourceUrl : "";
  }
  return "";
}

function isMeaningfulDeckValue(value: unknown): boolean {
  const cleaned = readString(value).toLowerCase().replace(/^tcga:/, "").replace(/\s+/g, " ");
  return Boolean(cleaned) && !/^(riftbound|tcga deck|deck pending|no deck|no deck logged|unknown)$/.test(cleaned);
}

function readMyName(sticky: Record<string, unknown>, settingsUsername: string): string {
  return readString(settingsUsername) || readTcgaLocalPlayerName(sticky.playerData) || readString(sticky.localPlayerName) || readString(sticky.myName);
}

function readOpponentName(sticky: Record<string, unknown>, myName: string, settingsUsername: string): string {
  const excluded = [myName, settingsUsername].filter(Boolean);
  const direct = cleanPlayerName(readString(sticky.opponentName));
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

function readLegendText(value: unknown): string {
  const raw = readString(value);
  return raw && !isLikelyTcgaLegendNoise(raw) && isCanonicalLegendName(raw) ? raw : "";
}

function isLikelyTcgaLegendNoise(value: string): boolean {
  const cleaned = value
    .replace(/[+\-]\d+/g, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!cleaned) {
    return false;
  }
  return /^(tap|untap|ping|target|primary|secondary|group with|auto pay|energy|power|empowered|quick attack|barrier|stun|deflect|hidden|overwhelm|assault|deathknell|temporary|gear|unit|spell|battlefield|rune|gold|ready|exhaust|body|mind|order|chaos|calm|fury|error|unknown card|no card)$/.test(cleaned);
}

function previewGames(session: SessionState): MatchGame[] {
  const finalGame = finishCurrentGame(session.currentGame);
  return isWorthKeeping(finalGame) ? [...session.completedGames, finalGame] : [...session.completedGames];
}

function shouldReleaseUnfinishedBo3(session: SessionState, endEvent: CaptureEvent, games: MatchGame[]): boolean {
  const reason = readString(endEvent.payload.reason);
  if (reason !== "inactive-debounce" || isBo3Complete(games)) {
    return false;
  }
  const playedGames = games.filter(gameHasNonZeroScore);
  if (!playedGames.length) {
    return false;
  }
  if (!isGameSurfaceUrl(session.platform, endEvent.url)) {
    return true;
  }
  if (session.completedGames.length < 2) {
    return false;
  }
  return !isWorthKeeping(finishCurrentGame(session.currentGame));
}

function isGameSurfaceUrl(platform: GamePlatform, value: string): boolean {
  if (!value) {
    return true;
  }
  try {
    const url = new URL(value);
    if (platform === "tcga") {
      return url.pathname.startsWith("/play");
    }
    if (platform === "atlas") {
      return /\/(?:play|game|room|lobby)\b/i.test(url.pathname);
    }
  } catch {
    return true;
  }
  return true;
}

function isBo3Complete(games: MatchGame[]): boolean {
  const wins = games.filter((game) => game.result === "Win").length;
  const losses = games.filter((game) => game.result === "Loss").length;
  return wins >= 2 || losses >= 2 || games.length >= 3;
}

function unfinishedBo3Result(format: MatchDraft["format"], games: MatchGame[]): MatchDraft["result"] | null {
  return format === "Bo3" && games.length > 0 && !isBo3Complete(games) ? "Incomplete" : null;
}

function shouldHoldAtlasGameResult(session: SessionState, payload: Record<string, unknown>, games: MatchGame[]): boolean {
  const gameNumber = atlasConfirmGameNumber(payload);
  if (gameNumber > 0) {
    return gameNumber < 3;
  }
  return !isBo3Complete(games);
}

function isAtlasRetainedBetweenGameResult(session: SessionState, event: CaptureEvent): boolean {
  const payload = event.payload;
  if (session.platform !== "atlas" || event.platform !== "atlas" || readString(payload.reason) !== "inactive-debounce") {
    return false;
  }
  if (!isAtlasContinuationSurfaceUrl(event.url)) {
    return false;
  }
  const kind = readString(payload.atlasResultKind);
  if (kind !== "game-result" && !isAtlasBo3QueuePayload(payload)) {
    return false;
  }
  const gameNumber = atlasConfirmGameNumber(payload);
  if (gameNumber >= 3) {
    return false;
  }
  return session.completedGames.length > 0;
}

function isAtlasContinuationSurfaceUrl(value: string): boolean {
  if (!value) {
    return true;
  }
  try {
    const url = new URL(value);
    return /\/(?:play|game|room|lobby)\b/i.test(url.pathname);
  } catch {
    return true;
  }
}

function atlasConfirmGameNumber(payload: Record<string, unknown>): number {
  const direct = readOptionalNumber(payload.atlasBo3GameNumber);
  if (direct && direct >= 1 && direct <= 3) {
    return direct;
  }
  const text = atlasBo3QueueText(payload);
  const patterns = [
    /(?:confirm|choose|select|report)\s+game\s+([123])\s+winner/i,
    /(?:confirm|choose|select|report)\s+(?:the\s+)?winner\s+(?:for|of)\s+game\s+([123])/i,
    /game\s+([123])\s+(?:winner|of\s+3)/i,
    /game\s+([123]).{0,48}(?:confirm|choose|select|report).{0,24}winner/i,
    /(?:confirm|choose|select|report).{0,24}winner.{0,48}game\s+([123])/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }
  return 0;
}

function highestAtlasConfirmedGameNumber(session: SessionState): number {
  let highest = atlasConfirmGameNumber(session.sticky);
  for (const event of session.evidence) {
    if (event.platform !== "atlas") {
      continue;
    }
    if (readString(event.payload.atlasResultKind) !== "game-result" && !atlasGameWinnerPattern().test(readString(event.payload.endText))) {
      continue;
    }
    highest = Math.max(highest, atlasConfirmGameNumber(event.payload));
  }
  return highest;
}

function isAtlasBetweenGameEnd(platform: GamePlatform, payload: Record<string, unknown>): boolean {
  if (platform !== "atlas" || readString(payload.reason) !== "result-text-detected") {
    return false;
  }
  const kind = readString(payload.atlasResultKind);
  if (kind === "match-terminal") {
    return false;
  }
  return kind === "game-result" || atlasGameWinnerPattern().test(readString(payload.endText));
}

function isAtlasAmbiguousGameResultContinuationCandidate(session: SessionState, endEvent: CaptureEvent): boolean {
  if (session.platform !== "atlas" || endEvent.platform !== "atlas") {
    return false;
  }
  if (readString(endEvent.payload.reason) !== "result-text-detected") {
    return false;
  }
  if (readString(endEvent.payload.atlasResultKind) === "match-terminal") {
    return false;
  }
  if (atlasConfirmGameNumber(endEvent.payload) > 0 || isAtlasBo3QueuePayload(endEvent.payload)) {
    return false;
  }
  const text = atlasBo3QueueText(endEvent.payload);
  const looksLikeGameResult = readString(endEvent.payload.atlasResultKind) === "game-result" ||
    atlasGameWinnerPattern().test(text);
  if (!looksLikeGameResult) {
    return false;
  }
  const games = previewGames(session);
  if (games.length >= 3) {
    return false;
  }
  return games.some(isWorthKeeping);
}

function isAtlasBo3QueuePayload(payload: Record<string, unknown>): boolean {
  if (readBoolean(payload.atlasBo3Queue)) {
    return true;
  }
  const gameNumber = atlasConfirmGameNumber(payload);
  if (gameNumber > 0 && gameNumber < 3) {
    return true;
  }
  const text = atlasBo3QueueText(payload);
  const hasBetweenGameText = /sideboarding|lock in sideboard|locked in sideboarding|waiting for .*lock in sideboard|next game|start game|continue/i.test(text);
  if (hasBetweenGameText && /\bgame\s+[23]\b/i.test(text)) {
    return true;
  }
  return /(?:best\s+of\s+3|bo3)/i.test(text) &&
    /sideboarding|lock in sideboard|locked in sideboarding|waiting for .*lock in sideboard|next game|game\s+[12]\s+of\s+3/i.test(text);
}

function atlasBo3QueueText(payload: Record<string, unknown>): string {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const rowText = rows.map((row) => {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      return readString((row as Record<string, unknown>).text);
    }
    return readString(row);
  }).join(" ");
  return [
    readString(payload.endText),
    readString(payload.pageText),
    readString(payload.statusText),
    rowText
  ].join(" ");
}

function atlasGameWinnerPattern(): RegExp {
  return /(?:confirm|choose|select|report)\s+game\s+\d+\s+winner|(?:confirm|choose|select|report)\s+(?:the\s+)?winner\s+(?:for|of)\s+game\s+\d+|game\s+\d+.{0,48}(?:winner|choose|select|confirm|report)|you win|you lose|you won|you lost|victory|defeat|wins!|winner/i;
}

function isAtlasSideboardingPayload(payload: Record<string, unknown>): boolean {
  if (readBoolean(payload.atlasSideboarding)) {
    return true;
  }
  const text = [
    readString(payload.endText),
    readString(payload.pageText),
    readString(payload.statusText)
  ].join(" ");
  if (/sideboard|sideboarding|sideboards are locked|locked in sideboarding/i.test(text)) {
    return true;
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  return rows.some((row) => {
    const rowText = row && typeof row === "object" && !Array.isArray(row)
      ? readString((row as Record<string, unknown>).text)
      : readString(row);
    return /sideboard|sideboarding|sideboards are locked|locked in sideboarding/i.test(rowText);
  });
}

function isAtlasGameResultHold(session: SessionState, payload: Record<string, unknown>): boolean {
  if (session.platform !== "atlas" || readString(payload.reason) !== "result-text-detected") {
    return false;
  }
  if (readString(payload.atlasResultKind) !== "game-result" && !isAtlasBo3QueuePayload(payload)) {
    return false;
  }
  const raw = `${readString(session.sticky.format)} ${readString(payload.format)} ${atlasBo3QueueText(payload)}`.toLowerCase();
  return raw.includes("bo3") || raw.includes("best of 3") || isAtlasBo3QueuePayload(payload);
}

function shouldSkipDuplicateAtlasFinalGame(session: SessionState, endEvent: CaptureEvent, finalGame: MatchGame): boolean {
  if (session.platform !== "atlas" || !session.completedGames.length || !isWorthKeeping(finalGame)) {
    return false;
  }
  if (
    finalGame.result === "Incomplete" &&
    !gameHasNonZeroScore(finalGame) &&
    readString(endEvent.payload.reason) === "inactive-debounce" &&
    isAtlasRootLandingUrl(endEvent.url)
  ) {
    return true;
  }
  const resultEvent = atlasResultEventIdentity(endEvent);
  if (!resultEvent) {
    return false;
  }
  if (session.atlasCompletedGameIdentities.some((identity) => atlasResultMatchesGameIdentity(resultEvent, identity))) {
    return true;
  }
  return Boolean(session.atlasHeldResult && sameAtlasResultEvent(session.atlasHeldResult, resultEvent));
}

function shouldUseExactAtlasResultScore(session: SessionState, payload: Record<string, unknown>): boolean {
  if (session.platform !== "atlas") {
    return false;
  }
  const kind = readString(payload.atlasResultKind);
  return kind === "game-result" || kind === "match-terminal" || isAtlasBo3QueuePayload(payload);
}

function shouldClearAtlasHeldResultSignature(payload: Record<string, unknown>): boolean {
  const score = readScore(payload);
  return typeof score.me === "number" ||
    typeof score.opp === "number" ||
    Boolean(
      readString(payload.myBattlefield) ||
      readString(payload.opponentBattlefield) ||
      readBattlefieldCode(payload, "me") ||
      readBattlefieldCode(payload, "opponent") ||
      readBattlefieldImage(payload, "me") ||
      readBattlefieldImage(payload, "opponent") ||
      readString(payload.myChampion) ||
      readString(payload.opponentChampion) ||
      readString(payload.myChampionImage) ||
      readString(payload.opponentChampionImage) ||
      readString(payload.opponentName) ||
      readString(payload.myName)
    );
}

function isAtlasHeldResultEcho(session: SessionState, event: CaptureEvent): boolean {
  if (session.platform !== "atlas" || event.platform !== "atlas" || !session.atlasHeldResult) {
    return false;
  }
  const payload = event.payload;
  const resultEvent = atlasResultEventIdentity(event);
  if (resultEvent) {
    if (session.atlasCompletedGameIdentities.some((identity) => atlasResultMatchesGameIdentity(resultEvent, identity))) {
      return true;
    }
    return sameAtlasResultEvent(session.atlasHeldResult, resultEvent);
  }
  const kind = readString(payload.atlasResultKind);
  if (kind === "game-result" || isAtlasBo3QueuePayload(payload)) {
    return false;
  }
  if (kind || readString(payload.endText) || gameStateHasNonZeroScore(session.currentGame)) {
    return false;
  }
  if (!withinAtlasEchoWindow(session.atlasHeldResult.capturedAt, event.capturedAt)) {
    return false;
  }
  const lastCompleted = session.completedGames[session.completedGames.length - 1];
  return Boolean(lastCompleted && atlasPayloadMatchesCompletedGameEcho(payload, lastCompleted));
}

function isAtlasCurrentResultEcho(session: SessionState, event: CaptureEvent): boolean {
  if (session.platform !== "atlas" || event.platform !== "atlas" || !session.currentGame.atlasResultEvent) {
    return false;
  }
  const currentResult = session.currentGame.atlasResultEvent;
  const nextResult = atlasResultEventIdentity(event);
  if (nextResult) {
    return sameAtlasResultEvent(currentResult, nextResult);
  }
  if (!withinAtlasEchoWindow(currentResult.capturedAt, event.capturedAt)) {
    return false;
  }
  return atlasPayloadMatchesCompletedGameEcho(event.payload, finishCurrentGame(session.currentGame));
}

function shouldCommitAtlasResultBeforeEvent(session: SessionState, event: CaptureEvent): boolean {
  const currentResult = session.currentGame.atlasResultEvent;
  if (session.platform !== "atlas" || event.platform !== "atlas" || !currentResult) {
    return false;
  }
  const nextResult = atlasResultEventIdentity(event);
  if (nextResult) {
    return !sameAtlasResultEvent(currentResult, nextResult);
  }
  if (event.kind === "match-start" || readString(event.payload.reason) === "active-returned") {
    return true;
  }
  if (withinAtlasEchoWindow(currentResult.capturedAt, event.capturedAt)) {
    return false;
  }
  const score = readScore(event.payload);
  return typeof score.me === "number" ||
    typeof score.opp === "number" ||
    Boolean(
      readString(event.payload.myBattlefield) ||
      readString(event.payload.opponentBattlefield) ||
      readBattlefieldCode(event.payload, "me") ||
      readBattlefieldCode(event.payload, "opponent") ||
      readBattlefieldImage(event.payload, "me") ||
      readBattlefieldImage(event.payload, "opponent")
    );
}

function atlasResultEventIdentity(event: CaptureEvent): AtlasResultEventIdentity | undefined {
  if (event.platform !== "atlas") {
    return undefined;
  }
  const kind = readString(event.payload.atlasResultKind);
  const endText = readString(event.payload.endText);
  if (kind !== "game-result" && kind !== "match-terminal" && !atlasGameWinnerPattern().test(endText)) {
    return undefined;
  }
  return {
    id: event.id,
    capturedAt: event.capturedAt,
    gameNumber: atlasConfirmGameNumber(event.payload),
    signature: atlasPayloadResultSignature(event.payload)
  };
}

function atlasFallbackResultIdentity(event: CaptureEvent | undefined, game: GameDraftState, capturedAt = ""): AtlasResultEventIdentity {
  return {
    id: event?.id ?? "",
    capturedAt: event?.capturedAt ?? (capturedAt || game.atlasLastObservedAt || game.atlasStartedAt || ""),
    gameNumber: event ? atlasConfirmGameNumber(event.payload) : 0,
    signature: event ? atlasPayloadResultSignature(event.payload) : atlasGameResultSignature(finishCurrentGame(game))
  };
}

function sameAtlasResultEvent(a: AtlasResultEventIdentity, b: AtlasResultEventIdentity): boolean {
  if (a.id && b.id && a.id === b.id) {
    return true;
  }
  if (a.gameNumber && b.gameNumber) {
    return a.gameNumber === b.gameNumber;
  }
  return a.signature === b.signature && withinAtlasEchoWindow(a.capturedAt, b.capturedAt);
}

function atlasResultMatchesGameIdentity(resultEvent: AtlasResultEventIdentity, game: AtlasGameIdentity): boolean {
  if (resultEvent.id && game.resultEventId && resultEvent.id === game.resultEventId) {
    return true;
  }
  return Boolean(resultEvent.gameNumber && game.explicitGameNumber && resultEvent.gameNumber === game.explicitGameNumber);
}

function withinAtlasEchoWindow(a: string, b: string): boolean {
  const aTime = new Date(a).getTime();
  const bTime = new Date(b).getTime();
  return Number.isFinite(aTime) && Number.isFinite(bTime) && Math.abs(bTime - aTime) <= 15_000;
}

function atlasPayloadMatchesCompletedGameEcho(payload: Record<string, unknown>, game: MatchGame): boolean {
  const score = readScore(payload);
  if (typeof score.me !== "number" || typeof score.opp !== "number") {
    return false;
  }
  if (score.me !== game.myPoints || score.opp !== game.oppPoints) {
    return false;
  }
  const payloadGame: MatchGame = {
    gameNumber: game.gameNumber,
    result: game.result,
    myPoints: score.me,
    oppPoints: score.opp,
    myBattlefield: readString(payload.myBattlefield),
    oppBattlefield: readString(payload.opponentBattlefield),
    myBattlefieldCode: readBattlefieldCode(payload, "me"),
    oppBattlefieldCode: readBattlefieldCode(payload, "opponent"),
    myBattlefieldImage: readBattlefieldImage(payload, "me"),
    oppBattlefieldImage: readBattlefieldImage(payload, "opponent")
  };
  const payloadHasBattlefield = hasBattlefieldPair(payloadGame);
  return !payloadHasBattlefield || compatibleBattlefieldPair(payloadGame, game);
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
    readBattlefieldCode(payload, "me"),
    readBattlefieldCode(payload, "opponent"),
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
    riftboundCardCodeFromValue(game.myBattlefieldCode ?? ""),
    riftboundCardCodeFromValue(game.oppBattlefieldCode ?? ""),
    normalizeNameKey(game.myBattlefield ?? ""),
    normalizeNameKey(game.oppBattlefield ?? ""),
    normalizeAssetKey(game.myBattlefieldImage ?? ""),
    normalizeAssetKey(game.oppBattlefieldImage ?? "")
  ].join("|");
}

function isDistinctName(candidate: string, excluded: string[]): boolean {
  const normalized = normalizePlayerNameKey(candidate);
  return Boolean(normalized) && !excluded.some((name) => normalizePlayerNameKey(name) === normalized);
}

function normalizeNameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePlayerNameKey(value: string): string {
  return normalizeNameKey(cleanPlayerName(value));
}

function cleanPlayerName(value: string): string {
  let cleaned = value.trim().replace(/\s+/g, " ");
  cleaned = cleaned.replace(/\s*(?:[-:]\s*)?(?:disconnected|reconnecting|reconnected|connection lost|offline)\s*\d*\s*s?$/i, "").trim();
  cleaned = cleaned.replace(/\s*(?:[-:]\s*)?(?:disconnected|reconnecting|reconnected|connection lost|offline)\d+\s*s$/i, "").trim();
  return cleaned;
}

function isLikelyAtlasActionText(value: string): boolean {
  const normalized = normalizeNameKey(value);
  const withoutClockPrefix = normalized.replace(/^[\d\s:.-]+/, "");
  if (!withoutClockPrefix) {
    return false;
  }
  return /^(locked|chose|auto[-\s]?selected|selected|must choose|both players|finalized|rolled|(?:wins?|won) initiative|played|moved|drew|ended|conquered|scored|set your score)\b/.test(withoutClockPrefix) ||
    (/^\d/.test(normalized) && /^must\b/.test(withoutClockPrefix)) ||
    /\b(take the first|decides who plays first|locked in|locked a battlefield|mulligan|sideboarding|sideboard|their turn|your turn)\b/.test(withoutClockPrefix);
}

function isLikelyAtlasPlayerNameNoise(value: string): boolean {
  const normalized = normalizeNameKey(value);
  if (!normalized) {
    return false;
  }
  return /^\d+\s*\/\s*\d+$/.test(normalized) ||
    /^\d+\s*locked\b/.test(normalized) ||
    /^\d+\s*must\b/.test(normalized) ||
    /^\d+\s*(?:cards?|runes?|energy|power)\b/.test(normalized);
}

function battlefieldChanged(current: string, nextValue: unknown): boolean {
  const next = readString(nextValue);
  if (isGeneratedBattlefieldName(current) || isGeneratedBattlefieldName(next)) {
    return false;
  }
  return Boolean(current && next && normalizeNameKey(current) !== normalizeNameKey(next));
}

function battlefieldCodeChanged(current: string, nextValue: unknown): boolean {
  const currentCode = riftboundCardCodeFromValue(current);
  const nextCode = riftboundCardCodeFromValue(readString(nextValue));
  if (isGeneratedBattlefieldCode(currentCode) || isGeneratedBattlefieldCode(nextCode)) {
    return false;
  }
  return Boolean(currentCode && nextCode && currentCode !== nextCode);
}

function battlefieldImageChanged(current: string, nextValue: unknown): boolean {
  const next = normalizeAssetKey(readString(nextValue));
  if (isGeneratedBattlefieldImage(current) || isGeneratedBattlefieldImage(next)) {
    return false;
  }
  return Boolean(current && next && normalizeAssetKey(current) !== next);
}

function readBattlefieldCode(payload: Record<string, unknown>, side: "me" | "opponent"): string {
  const direct = riftboundCardCodeFromValue(readString(side === "me" ? payload.myBattlefieldCode : payload.opponentBattlefieldCode));
  if (direct && !isGeneratedBattlefieldCode(direct)) {
    return direct;
  }
  const candidates = Array.isArray(payload.battlefieldCandidates) ? payload.battlefieldCandidates : [];
  const usable: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const code = riftboundCardCodeFromValue(readString(record.code) || readString(record.image));
    if (
      readString(record.side) === side &&
      record.hidden !== true &&
      code &&
      !isGeneratedBattlefieldCode(code) &&
      !isGeneratedBattlefieldCandidate(record)
    ) {
      usable.push(code);
    }
  }
  const unique = [...new Set(usable)];
  return unique.length === 1 ? unique[0] : "";
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
    isGeneratedBattlefieldCode(readString(candidate.code)) ||
    isGeneratedBattlefieldImage(readString(candidate.image));
}

function isGeneratedBattlefieldName(value: string): boolean {
  return /\bbaron\s+pit\b/i.test(value);
}

function isGeneratedBattlefieldCode(value: string): boolean {
  return riftboundCardCodeFromValue(value) === "UNL-T01";
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
