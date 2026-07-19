import type { CaptureEvent, MatchDraft, ReplayRecord, ReplayStructuredEvent } from "./types.js";

export type ReplaySide = "me" | "opponent" | "system" | "unknown";

export type ReplayEventType =
  | "setup"
  | "mulligan"
  | "turn-start"
  | "turn-end"
  | "play"
  | "move"
  | "draw"
  | "score"
  | "combat"
  | "result"
  | "action"
  | "scoreboard"
  | "battlefield";

export interface ReplayScreenshotKeyframe {
  path: string;
  url: string;
  label: string;
  capturedAt: string;
  source: string;
}

export interface ReplayCardReference {
  name: string;
  destination: string;
  side: ReplaySide;
}

export interface ReplayBattlefieldReference {
  side: ReplaySide;
  name: string;
  code: string;
  image: string;
}

export interface ReplayTimelineEvent {
  id: string;
  capturedAt: string;
  gameNumber?: number;
  labelTime: string;
  type: ReplayEventType;
  side: ReplaySide;
  text: string;
  cardName: string;
  cardId?: string;
  cardCount?: number;
  destination: string;
  fromZone?: string;
  toZone?: string;
  visibility?: ReplayStructuredEvent["visibility"];
  actionId?: string;
  undoOf?: string;
  battlefield: string;
  battlefields?: ReplayBattlefieldReference[];
  score?: {
    me?: number;
    opponent?: number;
  };
  pointsScored?: number;
  scoreReason?: ReplayStructuredEvent["scoreReason"];
  resource?: ReplayStructuredEvent["resource"];
  counter?: ReplayStructuredEvent["counter"];
  token?: ReplayStructuredEvent["token"];
  combat?: ReplayStructuredEvent["combat"];
  snapshot?: ReplayStructuredEvent["snapshot"];
  screenshot?: ReplayScreenshotKeyframe;
}

export interface ReplayTurnView {
  id: string;
  label: string;
  side: ReplaySide;
  startedAt: string;
  endedAt: string;
  score?: {
    me?: number;
    opponent?: number;
  };
  events: ReplayTimelineEvent[];
  cards: ReplayCardReference[];
  pointEvents: ReplayTimelineEvent[];
  screenshots: ReplayScreenshotKeyframe[];
}

export interface AtlasReplayViewModel {
  replay: ReplayRecord;
  match?: MatchDraft;
  title: string;
  platformLabel: string;
  capturedAt: string;
  players: {
    me: string;
    opponent: string;
  };
  evidenceCount: number;
  rowCount: number;
  scoreLabel: string;
  formatLabel: string;
  resultLabel: string;
  turns: ReplayTurnView[];
  events: ReplayTimelineEvent[];
  screenshots: ReplayScreenshotKeyframe[];
  battlefields: ReplayBattlefieldReference[];
  isAtlas: boolean;
}

type OrderedReplayTimelineEvent = ReplayTimelineEvent & {
  replayOrder: number;
};

type RawReplayRow = {
  key: string;
  text: string;
  capturedAt: string;
  snapshotScore?: {
    me?: number;
    opponent?: number;
  };
  sourceEventId: string;
  sequence: number;
};

type SnapshotCard = {
  text: string;
  code: string;
  image: string;
  zone: string;
  zoneOwner: string;
  classes: string;
};

const CHAT_ROW_PATTERN = /\bat\s+\d{1,2}:\d{2}\s*:/i;
const TURN_OWNER_PATTERN = /^(.{1,48}?)['\u2019]s turn\b/i;
const CARD_CODE_PATTERN = /^(?:OGN|OGS|SFD|UNL)-\d+[A-Z]?$/i;

export function buildAtlasReplay(replay: ReplayRecord, match?: MatchDraft): AtlasReplayViewModel {
  const structuredEvents = replay.structuredEvents ?? [];
  const baseEvents = structuredEvents.length
    ? buildStructuredEvents(structuredEvents, match, replay.platform)
    : replay.platform === "atlas"
      ? buildAtlasEvents(replay.events, replay.players)
      : buildGenericEvents(replay.events);
  const evidenceScreenshots = collectScreenshots(replay.events);
  const visualFrames = collectVisualReplayFrames(replay);
  const screenshots = [...evidenceScreenshots, ...collectTimelineScreenshots(baseEvents), ...visualFrames];
  const initialTurns = buildTurns(baseEvents, screenshots, replay.players, replay.platform);
  const holdEvents = inferHoldScoreEvents(initialTurns, replay.players);
  const events = holdEvents.length ? mergeInferredHoldEvents(baseEvents, holdEvents) : baseEvents;
  const turns = buildTurns(events, screenshots, replay.players, replay.platform);
  const battlefields = collectBattlefieldReferences(replay.events, match, structuredEvents);
  const latestScore = latestEventScore(events);
  return {
    replay,
    match,
    title: replay.title || titleFromMatch(match) || "Captured replay",
    platformLabel: replayPlatformLabel(replay.platform),
    capturedAt: replay.capturedAt,
    players: replay.players,
    evidenceCount: replay.events.length,
    rowCount: structuredEvents.length || collectReplayRows(replay.events).length,
    scoreLabel: matchRecordLabel(match) || scoreLabel(latestScore) || "Score pending",
    formatLabel: match?.format && match.format !== "Auto" ? match.format : "Auto",
    resultLabel: match?.result ?? "",
    turns,
    events,
    screenshots,
    battlefields,
    isAtlas: replay.platform === "atlas"
  };
}

function replayPlatformLabel(platform: ReplayRecord["platform"]): string {
  if (platform === "atlas") {
    return "RiftAtlas";
  }
  if (platform === "sim") {
    return "Riftbound Sim";
  }
  return "TCGA";
}

function mergeInferredHoldEvents(
  baseEvents: ReplayTimelineEvent[],
  holdEvents: ReplayTimelineEvent[]
): ReplayTimelineEvent[] {
  const remaining = [...holdEvents];
  const merged: ReplayTimelineEvent[] = [];
  for (const event of baseEvents) {
    if (event.type === "scoreboard") {
      const matching = remaining.filter(
        (hold) => hold.capturedAt === event.capturedAt && hold.labelTime === event.labelTime
      );
      if (matching.length) {
        merged.push(...matching);
        for (const hold of matching) {
          remaining.splice(remaining.indexOf(hold), 1);
        }
      }
    }
    merged.push(event);
  }
  return [...merged, ...remaining];
}

function buildStructuredEvents(
  events: ReplayStructuredEvent[],
  match?: MatchDraft,
  platform?: ReplayRecord["platform"]
): ReplayTimelineEvent[] {
  const sorted = events
    .map((event, replayOrder) => ({
      id: event.id,
      capturedAt: event.capturedAt,
      gameNumber: event.gameNumber,
      labelTime: event.labelTime || timeLabel(event.capturedAt),
      type: normalizeStructuredReplayType(event.type, event.text),
      side: event.side,
      text: event.text,
      cardName: event.cardName,
      cardId: event.cardId,
      cardCount: event.cardCount,
      destination: event.destination,
      fromZone: event.fromZone,
      toZone: event.toZone,
      visibility: event.visibility,
      actionId: event.actionId,
      undoOf: event.undoOf,
      battlefield: event.battlefield,
      battlefields: event.battlefields,
      pointsScored: event.pointsScored,
      scoreReason: event.scoreReason,
      resource: event.resource,
      counter: event.counter,
      token: event.token,
      combat: event.combat,
      snapshot: event.snapshot,
      score: event.score,
      screenshot: event.screenshot,
      replayOrder
    }))
    .filter((event) => !isReplayNoiseText(event.text))
    .map((event) => enrichStructuredBattlefieldEvent(event, match))
    .sort(compareReplayEventsWithReplayOrder);

  return filterStructuredEventNoise(sorted, platform)
    .map(({ replayOrder: _replayOrder, ...event }) => event);
}

function filterStructuredEventNoise(
  events: OrderedReplayTimelineEvent[],
  platform?: ReplayRecord["platform"]
): OrderedReplayTimelineEvent[] {
  const withoutBattlefieldNoise = events.filter((event) => !isNoiseBattlefieldEvent(event));
  if (platform !== "tcga") {
    return withoutBattlefieldNoise;
  }
  const filtered: OrderedReplayTimelineEvent[] = [];
  const lastScoreByGame = new Map<number, { me: number; opponent: number }>();
  let lastTurnKey = "";
  let lastTurnAt = 0;

  for (const event of withoutBattlefieldNoise) {
    if (platform === "tcga" && isNoisyTcgaCardEvent(event)) {
      continue;
    }

    if (event.type === "turn-start") {
      const key = normalizeName(event.text);
      const capturedAt = new Date(event.capturedAt).getTime();
      if (
        key &&
        key === lastTurnKey &&
        Number.isFinite(capturedAt) &&
        Number.isFinite(lastTurnAt) &&
        capturedAt >= lastTurnAt &&
        capturedAt - lastTurnAt <= 45_000
      ) {
        continue;
      }
      lastTurnKey = key;
      lastTurnAt = Number.isFinite(capturedAt) ? capturedAt : 0;
    }

    if (event.type === "scoreboard") {
      const score = event.score ?? scoreFromText(event.text);
      if (typeof score?.me === "number" && typeof score.opponent === "number") {
        const concreteScore = { me: score.me, opponent: score.opponent };
        const gameNumber = event.gameNumber ?? 1;
        const previous = lastScoreByGame.get(gameNumber);
        if (previous && concreteScore.me === previous.me && concreteScore.opponent === previous.opponent) {
          continue;
        }
        if (previous && concreteScore.me + concreteScore.opponent < previous.me + previous.opponent) {
          continue;
        }
        lastScoreByGame.set(gameNumber, concreteScore);
      }
    }

    filtered.push(event);
  }

  return filtered;
}

function buildAtlasEvents(events: CaptureEvent[], players: ReplayRecord["players"]): ReplayTimelineEvent[] {
  const rowEvents = collectReplayRows(events)
    .filter((row) => !CHAT_ROW_PATTERN.test(row.text))
    .map((row) => eventFromRow(row, players))
    .filter((event): event is ReplayTimelineEvent => Boolean(event));
  const scoreEvents = collectScoreEvents(events);
  return [...rowEvents, ...scoreEvents].sort(compareReplayEvents);
}

function buildGenericEvents(events: CaptureEvent[]): ReplayTimelineEvent[] {
  return events
    .filter((event) => event.kind === "match-snapshot" || event.kind === "match-start" || event.kind === "match-end")
    .map((event, index) => {
      const score = readScore(event.payload.score);
      const text = event.kind === "match-end"
        ? readString(event.payload.endText) || "Match ended"
        : event.kind === "match-start"
          ? "Match started"
          : scoreLabel(score) || readString(event.payload.reason) || "Capture snapshot";
      return {
        id: `${event.id}:generic:${index}`,
        capturedAt: event.capturedAt,
        labelTime: timeLabel(event.capturedAt),
        type: event.kind === "match-end" ? "result" : score ? "scoreboard" : "action",
        side: "system",
        text,
        cardName: "",
        destination: "",
        battlefield: "",
        score
      } satisfies ReplayTimelineEvent;
    });
}

function collectReplayRows(events: CaptureEvent[]): RawReplayRow[] {
  const rows: RawReplayRow[] = [];
  const seen = new Set<string>();
  let sequence = 0;
  for (const event of [...events].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) {
    const payloadRows = Array.isArray(event.payload.rows) ? event.payload.rows : [];
    const snapshotScore = readScore(event.payload.score);
    const occurrenceCounts = new Map<string, number>();
    const chronologicalRows = chronologicalReplayRows(payloadRows);
    for (let index = 0; index < chronologicalRows.length; index += 1) {
      const row = chronologicalRows[index];
      const record = asRecord(row);
      const text = cleanLogText(readString(record.text));
      if (!text) {
        continue;
      }
      const parsed = parseLogRow(text);
      if (isReplayNoiseText(parsed.text)) {
        continue;
      }
      const occurrenceKey = normalizeRowSignature(`${parsed.time}|${parsed.text}`);
      const occurrence = (occurrenceCounts.get(occurrenceKey) ?? 0) + 1;
      occurrenceCounts.set(occurrenceKey, occurrence);
      const signature = normalizeRowSignature(`${parsed.time}|${parsed.text}|${occurrence}`);
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      sequence += 1;
      rows.push({
        key: readString(record.key) || signature,
        text,
        capturedAt: replayRowCapturedAt(event.capturedAt, parsed.time, index),
        snapshotScore,
        sourceEventId: event.id,
        sequence
      });
    }
  }
  return rows;
}

function eventFromRow(row: RawReplayRow, players: ReplayRecord["players"]): ReplayTimelineEvent | null {
  const parsed = parseLogRow(row.text);
  if (!parsed.text) {
    return null;
  }
  const type = classifyReplayText(parsed.text);
  const card = extractCard(parsed.text);
  const battlefield = type === "setup" ? "" : extractBattlefield(parsed.text);
  const score = type === "score" ? row.snapshotScore : undefined;
  return {
    id: `${row.sourceEventId}:row:${row.sequence}`,
    capturedAt: row.capturedAt,
    labelTime: parsed.time || timeLabel(row.capturedAt),
    type,
    side: sideFromText(parsed.text, players),
    text: parsed.text,
    cardName: card.name,
    destination: card.destination,
    battlefield,
    score,
    pointsScored: extractPointsScored(parsed.text)
  };
}

function collectScoreEvents(events: CaptureEvent[]): ReplayTimelineEvent[] {
  const result: ReplayTimelineEvent[] = [];
  let previous = "";
  events.forEach((event, index) => {
    if (event.kind === "debug") {
      return;
    }
    const score = readScore(event.payload.score);
    const label = scoreLabel(score);
    if (!score || !label || label === previous) {
      return;
    }
    previous = label;
    result.push({
      id: `${event.id}:score:${index}`,
      capturedAt: event.capturedAt,
      labelTime: timeLabel(event.capturedAt),
      type: "scoreboard",
      side: "system",
      text: `Score ${label}`,
      cardName: "",
      destination: "",
      battlefield: "",
      score
    });
  });
  return result;
}

function buildTurns(
  events: ReplayTimelineEvent[],
  screenshots: ReplayScreenshotKeyframe[],
  players: ReplayRecord["players"],
  platform?: ReplayRecord["platform"]
): ReplayTurnView[] {
  const turns: ReplayTurnView[] = [];
  if (!events.length) {
    return [];
  }
  const firstGameNumber = events[0]?.gameNumber ?? 1;
  let currentGameNumber = firstGameNumber;
  let currentGameEvents = events.filter((event) => (event.gameNumber ?? 1) === currentGameNumber);
  let turnNumber = 1;
  let fallbackSide: ReplaySide = startingSideFromEvents(currentGameEvents, players) || fallbackSideFromTurn(1);
  let setupOpen = currentGameEvents.some(isSetupEvent);
  let lastScore: ReplayTimelineEvent["score"] | undefined;
  let current = setupOpen
    ? createTurn(0, currentGameNumber > 1 ? `Game ${currentGameNumber} setup` : "Setup", "system", events[0].capturedAt)
    : createTurn(turnNumber, turnLabel(turnNumber, fallbackSide, players), fallbackSide, events[0].capturedAt);

  for (const event of events) {
    if (event.gameNumber && event.gameNumber !== currentGameNumber && current.events.length) {
      finishTurn(current, turns);
      currentGameNumber = event.gameNumber;
      currentGameEvents = events.filter((item) => (item.gameNumber ?? 1) === currentGameNumber);
      turnNumber = 1;
      fallbackSide = startingSideFromEvents(currentGameEvents, players) || fallbackSideFromTurn(1);
      setupOpen = isSetupEvent(event);
      current = setupOpen
        ? createTurn(0, `Game ${event.gameNumber} setup`, "system", event.capturedAt)
        : createTurn(turnNumber, turnLabel(turnNumber, fallbackSide, players), fallbackSide, event.capturedAt);
    } else if (event.gameNumber) {
      currentGameNumber = event.gameNumber;
    }

    if (setupOpen) {
      if (platform === "tcga" && event.type === "turn-start") {
        if (current.events.length) {
          finishTurn(current, turns);
        }
        setupOpen = false;
        current = createTurn(turnNumber, turnLabel(turnNumber, fallbackSide, players), fallbackSide, event.capturedAt);
      } else {
        addEventToTurnIfNew(current, event);
        if (event.score) {
          lastScore = event.score;
        }
        if (isSetupCompleteEvent(event)) {
          finishTurn(current, turns);
          current = createTurn(turnNumber, turnLabel(turnNumber, fallbackSide, players), fallbackSide, event.capturedAt);
          setupOpen = false;
        }
        continue;
      }
    }

    if (event.type === "setup" || event.type === "battlefield") {
      const setupTurn = findSetupTurn(turns, currentGameNumber);
      if (setupTurn && (event.type === "setup" || eventOccursDuringTurn(event, setupTurn))) {
        addEventToTurnIfNew(setupTurn, event);
        continue;
      }
    }

    if (event.type === "turn-start") {
      if (current.events.length) {
        finishTurn(current, turns);
        turnNumber += 1;
      }
      const owner = turnOwner(event.text);
      const side = sideFromTurnStartText(event.text) || sideFromPlayer(owner, players) || fallbackSide || fallbackSideFromTurn(turnNumber);
      fallbackSide = side;
      current = createTurn(turnNumber, owner ? `${owner}'s turn` : turnLabel(turnNumber, side, players), side, event.capturedAt);
    }

    if (platform === "tcga" && shouldStartTcgaSideTurn(current, event)) {
      finishTurn(current, turns);
      turnNumber += 1;
      fallbackSide = event.side;
      current = createTurn(turnNumber, turnLabel(turnNumber, event.side, players), event.side, event.capturedAt);
    }

    if (isEmptyFreshTurnEnd(current, event)) {
      continue;
    }

    const inferredScoreSide = platform === "tcga" && event.type === "scoreboard"
      ? scoreIncreaseSide(lastScore, event.score)
      : "";
    let startedInferredScoreTurn = false;
    if (inferredScoreSide && current.side !== inferredScoreSide && current.events.length) {
      finishTurn(current, turns);
      turnNumber += 1;
      fallbackSide = inferredScoreSide;
      current = createTurn(turnNumber, turnLabel(turnNumber, inferredScoreSide, players), inferredScoreSide, event.capturedAt);
      startedInferredScoreTurn = true;
    }

    if (event.type === "scoreboard" && !startedInferredScoreTurn && !current.events.length && turns.length && !isSetupTurnView(turns[turns.length - 1])) {
      addEventToTurn(turns[turns.length - 1], event);
      if (event.score) {
        lastScore = event.score;
      }
      continue;
    }

    addEventToTurn(current, event);
    if (event.score) {
      lastScore = event.score;
    }

    if (event.type === "turn-end") {
      finishTurn(current, turns);
      turnNumber += 1;
      fallbackSide = oppositeSide(current.side) || oppositeSide(fallbackSide) || fallbackSideFromTurn(turnNumber);
      current = createTurn(turnNumber, turnLabel(turnNumber, fallbackSide, players), fallbackSide, event.capturedAt);
    }
  }

  if (current.events.length) {
    finishTurn(current, turns);
  }

  const screenshotTurns = attachScreenshotsToTurns(turns, screenshots);
  return screenshotTurns.length ? screenshotTurns : turns;
}

function isEmptyFreshTurnEnd(turn: ReplayTurnView, event: ReplayTimelineEvent): boolean {
  if (event.type !== "turn-end" || turn.events.length) {
    return false;
  }
  const turnStartedAt = new Date(turn.startedAt).getTime();
  const eventAt = new Date(event.capturedAt).getTime();
  return Number.isFinite(turnStartedAt) && Number.isFinite(eventAt) && Math.abs(eventAt - turnStartedAt) <= 1000;
}

function isSetupTurnView(turn: ReplayTurnView | undefined): boolean {
  return Boolean(turn && (turn.side === "system" || turn.id === "turn-0") && /setup/i.test(turn.label));
}

function shouldStartTcgaSideTurn(turn: ReplayTurnView, event: ReplayTimelineEvent): boolean {
  return (event.type === "play" || event.type === "move" || event.type === "combat") &&
    (event.side === "me" || event.side === "opponent") &&
    turn.side !== event.side &&
    turn.events.length > 0;
}

function eventOccursDuringTurn(event: ReplayTimelineEvent, turn: ReplayTurnView): boolean {
  const eventAt = new Date(event.capturedAt).getTime();
  const startedAt = new Date(turn.startedAt).getTime();
  const endedAt = new Date(turn.endedAt).getTime();
  return (
    Number.isFinite(eventAt) &&
    Number.isFinite(startedAt) &&
    Number.isFinite(endedAt) &&
    eventAt >= startedAt &&
    eventAt <= endedAt
  );
}

function isSetupEvent(event: ReplayTimelineEvent): boolean {
  return event.type === "setup" || isSetupCompleteEvent(event);
}

function isSetupCompleteEvent(event: ReplayTimelineEvent): boolean {
  return /after mulligan|both mulligans? (?:are )?complete|starting the game/i.test(event.text);
}

function normalizeStructuredReplayType(type: ReplayEventType, text: string): ReplayEventType {
  const classified = classifyReplayText(text);
  if (classified === "setup") {
    return "setup";
  }
  return type;
}

function isReplayNoiseText(value: string): boolean {
  return /^Rolled a d20\.?$/i.test(value) ||
    /^Exhausted\s+\d+\s*[A-Za-z]*\s*runes?\.?$/i.test(value) ||
    /^Recycled\s+\d+\s*[A-Za-z]*\s*runes?\.?$/i.test(value);
}

function isNoisyTcgaCardEvent(event: ReplayTimelineEvent): boolean {
  if (event.type !== "play" && event.type !== "move") {
    return false;
  }
  const card = normalizeName(event.cardName || event.text);
  return !card ||
    /^unknown card$/.test(card) ||
    /^(?:tap|untap|ping|target|group with|error|error tap|error ping|error error tap)$/.test(card) ||
    /^(?:ogn|ogs|sfd|unl)-\d+[a-z]?$/i.test(event.cardName.trim());
}

function startingSideFromEvents(events: ReplayTimelineEvent[], players: ReplayRecord["players"]): ReplaySide | "" {
  const player = startingPlayerFromEvents(events);
  return sideFromPlayer(player, players);
}

function startingPlayerFromEvents(events: ReplayTimelineEvent[]): string {
  for (const event of events) {
    const chosen = event.text.match(/\bChose\s+(.+?)\s+to\s+take\s+the\s+first\s+turn/i)?.[1] ?? "";
    if (chosen) {
      return cleanDestination(chosen);
    }
  }
  return "";
}

function turnLabel(turnNumber: number, side: ReplaySide, players: ReplayRecord["players"]): string {
  const player = side === "me" ? players.me : side === "opponent" ? players.opponent : "";
  return player ? `${player}'s turn` : `Turn ${turnNumber}`;
}

function oppositeSide(side: ReplaySide): ReplaySide | "" {
  if (side === "me") {
    return "opponent";
  }
  if (side === "opponent") {
    return "me";
  }
  return "";
}

function createTurn(index: number, label: string, side: ReplaySide, startedAt: string): ReplayTurnView {
  return {
    id: `turn-${index}`,
    label,
    side,
    startedAt,
    endedAt: startedAt,
    events: [],
    cards: [],
    pointEvents: [],
    screenshots: []
  };
}

function addEventToTurn(turn: ReplayTurnView, event: ReplayTimelineEvent): void {
  turn.events.push(event);
  turn.endedAt = event.capturedAt;
  if (event.score) {
    turn.score = event.score;
  }
  if (event.cardName) {
    const key = `${event.cardName}|${event.destination}|${event.side}`;
    if (!turn.cards.some((card) => `${card.name}|${card.destination}|${card.side}` === key)) {
      turn.cards.push({ name: event.cardName, destination: event.destination, side: event.side });
    }
  }
  if (event.type === "score" || event.type === "result" || event.pointsScored) {
    turn.pointEvents.push(event);
  }
  if (event.screenshot) {
    addScreenshotToList(turn.screenshots, event.screenshot);
  }
}

function addEventToTurnIfNew(turn: ReplayTurnView, event: ReplayTimelineEvent): void {
  const key = `${event.type}|${event.labelTime}|${event.text}`;
  if (turn.events.some((item) => `${item.type}|${item.labelTime}|${item.text}` === key)) {
    return;
  }
  addEventToTurn(turn, event);
}

function finishTurn(turn: ReplayTurnView, turns: ReplayTurnView[]): void {
  const score = latestEventScore(turn.events);
  if (score) {
    turn.score = score;
  }
  turns.push(turn);
}

function findSetupTurn(turns: ReplayTurnView[], gameNumber: number): ReplayTurnView | undefined {
  const label = gameNumber > 1 ? `Game ${gameNumber} setup` : "Setup";
  return turns.find((turn) => turn.label === label);
}

function inferHoldScoreEvents(turns: ReplayTurnView[], players: ReplayRecord["players"]): ReplayTimelineEvent[] {
  const inferred: ReplayTimelineEvent[] = [];
  const control = new Map<string, { side: ReplaySide; name: string }>();
  let lastScore: { me?: number; opponent?: number } | undefined;

  for (const turn of turns) {
    const scoredThisTurn = new Set<string>();
    let scoreEventSeenThisTurn = false;

    for (const event of turn.events) {
      if (event.score) {
        if (canInferHoldScore(turn, event, scoreEventSeenThisTurn)) {
          const delta = scoreDeltaForSide(lastScore, event.score, turn.side);
          const battlefields = heldBattlefieldsForSide(control, turn.side, scoredThisTurn, delta);
          battlefields.forEach((battlefield, index) => {
            scoredThisTurn.add(normalizeName(battlefield));
            inferred.push({
              id: `inferred-hold:${turn.id}:${event.id}:${index}`,
              capturedAt: event.capturedAt,
              gameNumber: event.gameNumber,
              labelTime: event.labelTime,
              type: "score",
              side: turn.side,
              text: `${playerLabel(turn.side, players)} held ${battlefield} and scored 1.`,
              cardName: "",
              destination: "",
              battlefield,
              pointsScored: 1
            });
          });
        }
        lastScore = event.score;
        scoreEventSeenThisTurn = true;
      }

      const conquered = conqueredBattlefieldName(event);
      if (conquered && turn.side !== "system" && turn.side !== "unknown") {
        control.set(normalizeName(conquered), { side: turn.side, name: conquered });
        scoredThisTurn.add(normalizeName(conquered));
      }
    }
  }

  return inferred;
}

function canInferHoldScore(turn: ReplayTurnView, event: ReplayTimelineEvent, scoreEventSeenThisTurn: boolean): boolean {
  if (scoreEventSeenThisTurn || event.type !== "scoreboard" || turn.side !== "me" && turn.side !== "opponent") {
    return false;
  }
  const eventIndex = turn.events.findIndex((item) => item.id === event.id);
  const prior = eventIndex >= 0 ? turn.events.slice(0, eventIndex) : [];
  return prior.every((item) => item.type === "turn-start" || item.type === "scoreboard" || item.type === "draw");
}

function scoreDeltaForSide(
  previous: { me?: number; opponent?: number } | undefined,
  next: { me?: number; opponent?: number },
  side: ReplaySide
): number {
  if (!previous || side !== "me" && side !== "opponent") {
    return 0;
  }
  const key = side === "me" ? "me" : "opponent";
  const before = previous[key];
  const after = next[key];
  if (typeof before !== "number" || typeof after !== "number") {
    return 0;
  }
  const delta = after - before;
  return delta > 0 && delta <= 2 ? delta : 0;
}

function scoreIncreaseSide(
  previous: { me?: number; opponent?: number } | undefined,
  next: { me?: number; opponent?: number } | undefined
): ReplaySide | "" {
  if (
    typeof previous?.me !== "number" ||
    typeof previous?.opponent !== "number" ||
    typeof next?.me !== "number" ||
    typeof next?.opponent !== "number"
  ) {
    return "";
  }
  const myDelta = next.me - previous.me;
  const opponentDelta = next.opponent - previous.opponent;
  if (myDelta > 0 && opponentDelta <= 0) {
    return "me";
  }
  if (opponentDelta > 0 && myDelta <= 0) {
    return "opponent";
  }
  return "";
}

function heldBattlefieldsForSide(
  control: Map<string, { side: ReplaySide; name: string }>,
  side: ReplaySide,
  scoredThisTurn: Set<string>,
  delta: number
): string[] {
  if (!delta || side !== "me" && side !== "opponent") {
    return [];
  }
  return [...control.entries()]
    .filter(([battlefield, value]) => value.side === side && !scoredThisTurn.has(battlefield))
    .map(([_battlefield, value]) => value.name)
    .slice(0, delta);
}

function conqueredBattlefieldName(event: ReplayTimelineEvent): string {
  if (event.type !== "score") {
    return "";
  }
  const conquered = event.text.match(/\bConquered\s+(.+?)\s+and\s+scored\b/i)?.[1] ?? "";
  return cleanDestination(conquered || event.battlefield);
}

function playerLabel(side: ReplaySide, players: ReplayRecord["players"]): string {
  if (side === "me") {
    return players.me || "You";
  }
  if (side === "opponent") {
    return players.opponent || "Opponent";
  }
  return "Player";
}

function attachScreenshotsToTurns(turns: ReplayTurnView[], screenshots: ReplayScreenshotKeyframe[]): ReplayTurnView[] {
  if (!screenshots.length || !turns.length) {
    return turns;
  }
  const next = turns.map((turn) => ({ ...turn, screenshots: [...turn.screenshots] }));
  for (const screenshot of screenshots) {
    const index = nearestTurnIndex(next, screenshot.capturedAt);
    const turn = next[index];
    if (turn) {
      addScreenshotToList(turn.screenshots, screenshot);
    }
  }
  return next;
}

function addScreenshotToList(list: ReplayScreenshotKeyframe[], screenshot: ReplayScreenshotKeyframe): void {
  const location = screenshot.path || screenshot.url;
  if (location && list.some((item) => (item.path || item.url) === location)) {
    return;
  }
  if (/^Game \d+ battlefields$/i.test(screenshot.label) && list.some((item) => item.label === screenshot.label)) {
    return;
  }
  list.push(screenshot);
}

function nearestTurnIndex(turns: ReplayTurnView[], capturedAt: string): number {
  const target = new Date(capturedAt).getTime();
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  turns.forEach((turn, index) => {
    const start = new Date(turn.startedAt || turn.endedAt).getTime();
    const end = new Date(turn.endedAt || turn.startedAt).getTime();
    const distance = target >= start && target <= end ? 0 : Math.min(Math.abs(target - start), Math.abs(target - end));
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

function collectBattlefieldReferences(events: CaptureEvent[], match?: MatchDraft, structuredEvents: ReplayStructuredEvent[] = []): ReplayBattlefieldReference[] {
  const refs = new Map<string, ReplayBattlefieldReference>();
  if (match) {
    addBattlefieldRef(refs, "me", match.myBattlefield, "", "");
    addBattlefieldRef(refs, "opponent", match.opponentBattlefield, "", "");
    for (const game of match.games) {
      addBattlefieldRef(refs, "me", game.myBattlefield ?? "", game.myBattlefieldCode ?? "", game.myBattlefieldImage ?? "");
      addBattlefieldRef(refs, "opponent", game.oppBattlefield ?? "", game.oppBattlefieldCode ?? "", game.oppBattlefieldImage ?? "");
    }
  }
  for (const event of events) {
    const candidates = Array.isArray(event.payload.battlefieldCandidates) ? event.payload.battlefieldCandidates : [];
    for (const candidate of candidates) {
      const record = asRecord(candidate);
      const side = readSide(record.side);
      addBattlefieldRef(refs, side, readString(record.text), readString(record.code), readString(record.image));
    }
  }
  for (const event of structuredEvents) {
    for (const battlefield of event.battlefields ?? []) {
      addBattlefieldRef(refs, readSide(battlefield.side), battlefield.name, battlefield.code, battlefield.image);
    }
  }
  return cleanBattlefieldReferences([...refs.values()]);
}

function enrichStructuredBattlefieldEvent(event: OrderedReplayTimelineEvent, match?: MatchDraft): OrderedReplayTimelineEvent {
  if (event.type !== "battlefield" || !event.battlefields?.length) {
    return event;
  }
  const game = match?.games.find((item) => item.gameNumber === event.gameNumber) ?? match?.games[0];
  const battlefields = event.battlefields.map((battlefield) => {
    const explicitName = cleanBattlefieldReferenceName(battlefield.name);
    const fallbackName = battlefield.side === "me"
      ? game?.myBattlefield || match?.myBattlefield || ""
      : battlefield.side === "opponent"
        ? game?.oppBattlefield || match?.opponentBattlefield || ""
        : "";
    return {
      ...battlefield,
      name: explicitName || cleanBattlefieldReferenceName(fallbackName)
    };
  }).filter((battlefield) => battlefield.name && !isNoiseBattlefieldReference(battlefield));
  if (!battlefields.length) {
    return {
      ...event,
      battlefields,
      battlefield: "",
      text: ""
    };
  }
  const label = battlefields
    .map((battlefield) => `${battlefield.side === "me" ? "My" : battlefield.side === "opponent" ? "Opponent" : "Board"} ${battlefield.name || battlefield.code || "battlefield"}`)
    .join(" / ");
  return {
    ...event,
    battlefields,
    battlefield: label,
    text: label ? `Battlefields updated: ${label}` : event.text
  };
}

function addBattlefieldRef(refs: Map<string, ReplayBattlefieldReference>, side: ReplaySide, name: string, code: string, image: string): void {
  const cleanName = cleanBattlefieldReferenceName(name);
  const cleanCode = code.trim();
  const cleanImage = image.trim();
  if (cleanName && isNoiseBattlefieldName(cleanName)) {
    return;
  }
  if (!cleanName && !cleanCode && !cleanImage) {
    return;
  }
  const key = `${side}|${cleanName || cleanCode || cleanImage}`;
  if (!refs.has(key)) {
    refs.set(key, { side, name: cleanName, code: cleanCode, image: cleanImage });
    return;
  }
  const existing = refs.get(key);
  if (existing) {
    refs.set(key, {
      side,
      name: existing.name || cleanName,
      code: existing.code || cleanCode,
      image: existing.image || cleanImage
    });
  }
}

function cleanBattlefieldReferences(references: ReplayBattlefieldReference[]): ReplayBattlefieldReference[] {
  const cleaned = references
    .map((reference) => ({
      ...reference,
      name: cleanBattlefieldReferenceName(reference.name),
      code: reference.code.trim(),
      image: reference.image.trim()
    }))
    .filter((reference) => reference.name || reference.code || reference.image)
    .filter((reference) => !reference.name || !isNoiseBattlefieldName(reference.name));

  const namedImageKeys = new Set(
    cleaned
      .filter((reference) => reference.name && reference.image)
      .map((reference) => `${reference.side}|${normalizeAssetKey(reference.image)}`)
  );
  const namedCodeKeys = new Set(
    cleaned
      .filter((reference) => reference.name && reference.code)
      .map((reference) => `${reference.side}|${reference.code.toUpperCase()}`)
  );
  const sidesWithNamedReferences = new Set(
    cleaned
      .filter((reference) => reference.name)
      .map((reference) => reference.side)
  );
  const merged = new Map<string, ReplayBattlefieldReference>();

  for (const reference of cleaned) {
    const imageKey = normalizeAssetKey(reference.image);
    const codeKey = reference.code.toUpperCase();
    if (!reference.name && sidesWithNamedReferences.has(reference.side)) {
      continue;
    }
    if (
      !reference.name &&
      ((imageKey && namedImageKeys.has(`${reference.side}|${imageKey}`)) ||
        (codeKey && namedCodeKeys.has(`${reference.side}|${codeKey}`)))
    ) {
      continue;
    }
    const key = `${reference.side}|${reference.name ? normalizeName(reference.name) : imageKey || codeKey}`;
    if (!key || key.endsWith("|")) {
      continue;
    }
    const existing = merged.get(key);
    merged.set(key, {
      side: reference.side,
      name: existing?.name || reference.name,
      code: existing?.code || reference.code,
      image: existing?.image || reference.image
    });
  }

  return [...merged.values()].filter((reference) => reference.name || reference.code || reference.image);
}

function cleanBattlefieldReferenceName(value: string): string {
  const clean = value.trim();
  if (!clean || CARD_CODE_PATTERN.test(clean)) {
    return "";
  }
  return clean;
}

function collectScreenshots(events: CaptureEvent[]): ReplayScreenshotKeyframe[] {
  const screenshots: ReplayScreenshotKeyframe[] = [];
  for (const event of events) {
    const payload = event.payload;
    const direct = screenshotFromRecord(payload, event.capturedAt);
    if (direct) {
      screenshots.push(direct);
    }
    const list = Array.isArray(payload.screenshots) ? payload.screenshots : [];
    for (const item of list) {
      const screenshot = screenshotFromRecord(asRecord(item), event.capturedAt);
      if (screenshot) {
        screenshots.push(screenshot);
      }
    }
  }
  return screenshots;
}

function collectVisualReplayFrames(replay: ReplayRecord): ReplayScreenshotKeyframe[] {
  return (replay.visualFrames ?? [])
    .filter((frame) => frame.path || frame.url)
    .map((frame) => ({
      path: frame.path,
      url: frame.url,
      label: frame.label || "Replay frame",
      capturedAt: frame.capturedAt,
      source: frame.source || "timed-replay"
    }));
}

function collectTimelineScreenshots(events: ReplayTimelineEvent[]): ReplayScreenshotKeyframe[] {
  const seenBattlefieldLabels = new Set<string>();
  const screenshots: ReplayScreenshotKeyframe[] = [];
  for (const event of events) {
    const screenshot = event.screenshot;
    if (!screenshot?.path && !screenshot?.url) {
      continue;
    }
    if (/^Game \d+ battlefields$/i.test(screenshot.label)) {
      if (seenBattlefieldLabels.has(screenshot.label)) {
        continue;
      }
      seenBattlefieldLabels.add(screenshot.label);
    }
    screenshots.push(screenshot);
  }
  return screenshots;
}

function screenshotFromRecord(record: Record<string, unknown>, fallbackCapturedAt: string): ReplayScreenshotKeyframe | null {
  const explicitPath = readString(record.screenshotPath);
  const explicitUrl = readString(record.screenshotUrl);
  const path = explicitPath || readString(record.path);
  const url = explicitUrl || readString(record.url);
  if (!path && !url) {
    return null;
  }
  const label = readString(record.label);
  const source = readString(record.source);
  if (!explicitPath && !explicitUrl && !label && !source && !looksLikeScreenshotLocation(path || url)) {
    return null;
  }
  return {
    path,
    url,
    label: label || "Keyframe",
    capturedAt: readString(record.capturedAt) || fallbackCapturedAt,
    source: source || "capture"
  };
}

function looksLikeScreenshotLocation(value: string): boolean {
  return /^data:image\//i.test(value) || /\.(?:png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(value);
}

function parseLogRow(value: string): { time: string; text: string } {
  const withoutUndo = value.replace(/[\u21ba\u21bb]/g, "").trim();
  const prefixed = withoutUndo.match(/^(\d{1,2}:\d{2})(.+)$/);
  if (prefixed) {
    return { time: prefixed[1], text: prefixed[2].trim() };
  }
  return { time: "", text: withoutUndo };
}

function chronologicalReplayRows(rows: unknown[]): unknown[] {
  return rows
    .map((row, index) => {
      const record = asRecord(row);
      const text = cleanLogText(readString(record.text));
      return {
        row,
        index,
        minute: replayRowMinute(row) ?? Number.POSITIVE_INFINITY,
        priority: sameMinuteReplayRowPriority(parseLogRow(text).text)
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
  const record = asRecord(row);
  const time = parseLogRow(cleanLogText(readString(record.text))).time;
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

function classifyReplayText(value: string): ReplayEventType {
  if (/starting turn|started turn|['\u2019]s turn\b/i.test(value)) {
    return "turn-start";
  }
  if (/(?:ended|ends|passed|passes) (?:their|the|your|opponent'?s)?\s*turn|turn (?:ended|passed)/i.test(value)) {
    return "turn-end";
  }
  if (/conquered|scored \d+|score(?:d)? point/i.test(value)) {
    return "score";
  }
  if (/combat|showdown|attack|block|defend/i.test(value)) {
    return "combat";
  }
  if (/played\b/i.test(value)) {
    return "play";
  }
  if (/moved\b/i.test(value)) {
    return "move";
  }
  if (/mulligan|sideboards? are locked|battlefields? are locked|locked in sideboarding|locked in a battlefield|rolled|initiative|choose who starts|take the first turn/i.test(value)) {
    return "setup";
  }
  if (/drew|draws|draw \d+/i.test(value)) {
    return "draw";
  }
  if (/wins!|winner|victory|defeat|you win|you lose|won the game|lost the game/i.test(value)) {
    return "result";
  }
  return "action";
}

function extractCard(value: string): { name: string; destination: string } {
  const played = value.match(/\bPlayed\s+(.+?)(?:\s+to\s+(.+?))?\.?$/i);
  if (played) {
    return { name: cleanCardName(played[1]), destination: cleanDestination(played[2] ?? "") };
  }
  const moved = value.match(/\bMoved\s+(.+?)\s+to\s+(.+?)(?:\.|$)/i);
  if (moved) {
    return { name: cleanCardName(moved[1]), destination: cleanDestination(moved[2]) };
  }
  const revealed = value.match(/\bRevealed\s+(.+?)(?:\.|$)/i);
  if (revealed) {
    return { name: cleanCardName(revealed[1]), destination: "" };
  }
  return { name: "", destination: "" };
}

function extractBattlefield(value: string): string {
  const conquered = value.match(/\bConquered\s+(.+?)\s+and\s+scored/i);
  if (conquered) {
    return cleanDestination(conquered[1]);
  }
  const destination = value.match(/\b(?:to|at)\s+(.+?)(?:\.|$)/i)?.[1] ?? "";
  return /base|trash|deck|hand|rune/i.test(destination) ? "" : cleanDestination(destination);
}

function extractPointsScored(value: string): number | undefined {
  const match = value.match(/\bscored\s+(\d+)\b/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function turnOwner(value: string): string {
  return value.match(TURN_OWNER_PATTERN)?.[1]?.trim() ?? "";
}

function sideFromText(value: string, players: ReplayRecord["players"]): ReplaySide {
  if (/^you\b/i.test(value)) {
    return "me";
  }
  if (/^opponent\b/i.test(value)) {
    return "opponent";
  }
  const owner = turnOwner(value);
  return sideFromPlayer(owner, players) || "system";
}

function sideFromPlayer(value: string, players: ReplayRecord["players"]): ReplaySide | "" {
  const key = normalizeName(value);
  if (!key) {
    return "";
  }
  if (normalizeName(players.me) && key === normalizeName(players.me)) {
    return "me";
  }
  if (normalizeName(players.opponent) && key === normalizeName(players.opponent)) {
    return "opponent";
  }
  return "";
}

function sideFromTurnStartText(value: string): ReplaySide | "" {
  if (/^your turn$/i.test(value)) {
    return "me";
  }
  if (/^opponent['\u2019]?s turn$/i.test(value)) {
    return "opponent";
  }
  return "";
}

function fallbackSideFromTurn(turnNumber: number): ReplaySide {
  return turnNumber % 2 === 1 ? "me" : "opponent";
}

function cleanLogText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanCardName(value: string): string {
  return value.replace(/^a card from\s+/i, "a card from ").replace(/\s+/g, " ").trim();
}

function cleanDestination(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\.$/, "").trim();
}

function normalizeRowSignature(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function readScore(value: unknown): { me?: number; opponent?: number } | undefined {
  const record = asRecord(value);
  const me = readNumber(record.me);
  const opponent = readNumber(record.opp ?? record.opponent);
  if (typeof me !== "number" && typeof opponent !== "number") {
    return undefined;
  }
  return { me, opponent };
}

function latestEventScore(events: ReplayTimelineEvent[]): { me?: number; opponent?: number } | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].score) {
      return events[index].score;
    }
  }
  return undefined;
}

function scoreLabel(score: { me?: number; opponent?: number } | undefined): string {
  if (!score || typeof score.me !== "number" || typeof score.opponent !== "number") {
    return "";
  }
  return `${score.me}-${score.opponent}`;
}

function scoreFromText(value: string): { me: number; opponent: number } | undefined {
  const match = value.match(/\bscore\s+(\d+)\s*-\s*(\d+)\b/i);
  if (!match) {
    return undefined;
  }
  return {
    me: Number.parseInt(match[1], 10),
    opponent: Number.parseInt(match[2], 10)
  };
}

function isNoiseBattlefieldEvent(event: ReplayTimelineEvent): boolean {
  return event.type === "battlefield" &&
    Boolean(event.battlefields) &&
    (!event.battlefields?.length || event.battlefields.every(isNoiseBattlefieldReference));
}

function isNoiseBattlefieldReference(reference: ReplayBattlefieldReference): boolean {
  return isNoiseBattlefieldName(reference.name);
}

function isNoiseBattlefieldName(value: string): boolean {
  const key = normalizeName(value).replace(/[^a-z0-9]/g, "");
  return /^(?:ping|tap|untap|target|groupwith|error|errortap|errorping|errortarget|errorerrortap|errorerrorping|errorerrortarget|choose|cancel|confirm|continue|ok|pass|attack|block|move|play|draw|thearenasgreatest)$/.test(key) ||
    /^error+(?:tap|ping|target)$/.test(key);
}

function matchRecordLabel(match: MatchDraft | undefined): string {
  if (!match) {
    return "";
  }
  const wins = match.games.filter((game) => game.result === "Win").length;
  const losses = match.games.filter((game) => game.result === "Loss").length;
  const draws = match.games.filter((game) => game.result === "Draw").length;
  if (wins || losses || draws) {
    return `${wins}-${losses}${draws ? `-${draws}` : ""}`;
  }
  return match.score;
}

function titleFromMatch(match: MatchDraft | undefined): string {
  return match ? `${match.myChampion || "Unknown"} vs ${match.opponentChampion || "Unknown"}` : "";
}

function collectSnapshotCards(events: CaptureEvent[]): SnapshotCard[] {
  const cards = new Map<string, SnapshotCard>();
  for (const event of events) {
    const payloadCards = Array.isArray(event.payload.cards) ? event.payload.cards : [];
    for (const item of payloadCards) {
      const record = asRecord(item);
      const card: SnapshotCard = {
        text: readString(record.text),
        code: readString(record.code),
        image: readString(record.image),
        zone: readString(record.zone),
        zoneOwner: readString(record.zoneOwner),
        classes: readString(record.classes)
      };
      const key = `${card.zoneOwner}|${card.zone}|${card.code || card.image || card.text}`;
      if ((card.code || card.image || card.text) && !cards.has(key)) {
        cards.set(key, card);
      }
    }
  }
  return [...cards.values()];
}

export function replaySnapshotCardCount(replay: ReplayRecord): number {
  return collectSnapshotCards(replay.events).length;
}

function readSide(value: unknown): ReplaySide {
  return value === "me" || value === "opponent" || value === "system" || value === "unknown" ? value : "unknown";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^\d{1,3}$/.test(trimmed)) {
    return undefined;
  }
  return Number.parseInt(trimmed, 10);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeAssetKey(value: string): string {
  return value.trim().toLowerCase().replace(/[?#].*$/, "");
}

function timeLabel(value: string): string {
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

function compareReplayEvents(a: ReplayTimelineEvent, b: ReplayTimelineEvent): number {
  const byTime = new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime();
  if (byTime) {
    return byTime;
  }
  const byPriority = replayEventSortPriority(a) - replayEventSortPriority(b);
  if (byPriority) {
    return byPriority;
  }
  if (a.type === "scoreboard" && b.type !== "scoreboard") {
    return 1;
  }
  if (a.type !== "scoreboard" && b.type === "scoreboard") {
    return -1;
  }
  return a.id.localeCompare(b.id);
}

function replayEventSortPriority(event: ReplayTimelineEvent): number {
  if (event.type === "turn-start") {
    return 0;
  }
  if (event.id.startsWith("inferred-hold:")) {
    return 1;
  }
  if (event.type === "scoreboard") {
    return 9;
  }
  return 5;
}

function compareReplayEventsWithReplayOrder(a: OrderedReplayTimelineEvent, b: OrderedReplayTimelineEvent): number {
  const byTime = new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime();
  if (byTime) {
    return byTime;
  }
  return a.replayOrder - b.replayOrder;
}
