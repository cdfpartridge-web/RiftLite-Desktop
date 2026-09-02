import type {
  DeckTrackerCardState,
  DeckTrackerSideboardChange,
  DeckTrackerSnapshot,
  ReplayRecord,
  ReplayStructuredEvent,
  ReplayStructuredResourceState
} from "./types.js";

export type ReplayLearningCapabilityState = "available" | "partial" | "unknown";
export type ReplayLearningResourceCoverageState = "complete" | "partial" | "unknown";

export interface ReplayLearningResourceValues {
  energy: number | null;
  power: number | null;
  xp: number | null;
  runesReady: number | null;
  runesExhausted: number | null;
}

export interface ReplayLearningUnusedResourceObservation {
  eventId: string;
  gameNumber?: number;
  capturedAt: string;
  playerTurnNumber?: number;
  proof: "turn-end-snapshot" | "turn-end-resource-after";
  completeState: boolean;
  unused: {
    energy: number | null;
    power: number | null;
    readyRunes: number | null;
  };
  state: ReplayLearningResourceValues;
}

export interface ReplayLearningResourceCoverage {
  state: ReplayLearningResourceCoverageState;
  capturedPlayerTurnEnds: number;
  provenEndStates: number;
  unknownEndStates: number;
  coveragePercent: number | null;
  observations: ReplayLearningUnusedResourceObservation[];
}

export type ReplayLearningVisibleCountBasis = "deck-tracker-seen-delta" | "named-events" | "unknown";

export interface ReplayLearningSideboardFlowRow {
  key: string;
  cardKey: string;
  cardName: string;
  cardId?: string;
  code?: string;
  imageUrl?: string;
  gameNumber?: number;
  changeIds: string[];
  sources: Array<"atlas" | "manual">;
  firstChangedAt: string;
  lastChangedAt: string;
  boardedInQuantity: number;
  boardedOutQuantity: number;
  subsequentVisibleCount: number | null;
  visibleCountBasis: ReplayLearningVisibleCountBasis;
  subsequentPlayedCount: number | null;
  subsequentRecycledCount: number | null;
}

export interface ReplayLearningBattlefieldConversion {
  eventId: string;
  gameNumber?: number;
  capturedAt: string;
  side: ReplayStructuredEvent["side"];
  battlefield: string;
  reason: NonNullable<ReplayStructuredEvent["scoreReason"]>;
  pointsScored: number | null;
  scoreAfter: {
    me: number | null;
    opponent: number | null;
  };
}

export interface ReplayLearningCapability {
  state: ReplayLearningCapabilityState;
  evidenceCount: number;
  detail: string;
}

export interface ReplayLearningCapabilityReceipt {
  replayId: string;
  openingHand: ReplayLearningCapability;
  cardTiming: ReplayLearningCapability;
  resources: ReplayLearningCapability;
  sideboard: ReplayLearningCapability;
  combat: ReplayLearningCapability;
  battlefield: ReplayLearningCapability;
}

export interface ReplayLearningSignals {
  replayId: string;
  resourceCoverage: ReplayLearningResourceCoverage;
  sideboardFlows: ReplayLearningSideboardFlowRow[];
  battlefieldConversions: ReplayLearningBattlefieldConversion[];
  capabilities: ReplayLearningCapabilityReceipt;
}

const MAX_STRUCTURED_EVENTS = 5_000;
const MAX_TRACKER_SNAPSHOTS = 240;
const MAX_RESOURCE_OBSERVATIONS = 120;
const MAX_SIDEBOARD_CHANGES = 160;
const MAX_SIDEBOARD_ROWS = 80;
const MAX_BATTLEFIELD_CONVERSIONS = 120;

export function extractReplayLearningSignals(replay: ReplayRecord): ReplayLearningSignals {
  const resourceCoverage = replayLearningResourceCoverage(replay);
  const sideboardFlows = replayLearningSideboardFlows(replay);
  const battlefieldConversions = replayLearningBattlefieldConversions(replay);
  return {
    replayId: replay.id,
    resourceCoverage,
    sideboardFlows,
    battlefieldConversions,
    capabilities: replayLearningCapabilityReceipt(replay, {
      resourceCoverage,
      sideboardFlows,
      battlefieldConversions
    })
  };
}

/**
 * Reports remaining resources only when an explicit local turn-end contains a
 * resource after-state or a player resource snapshot. Nearby rows are never
 * assumed to describe the end of that turn.
 */
export function replayLearningResourceCoverage(replay: ReplayRecord): ReplayLearningResourceCoverage {
  const events = boundedEvents(replay);
  const localTurnByGame = new Map<number, number>();
  const observations: ReplayLearningUnusedResourceObservation[] = [];
  let capturedPlayerTurnEnds = 0;
  let provenEndStates = 0;
  for (const event of events) {
    const gameNumber = validOptionalGameNumber(event.gameNumber);
    if (event.type === "turn-start" && event.side === "me" && gameNumber != null) {
      localTurnByGame.set(gameNumber, (localTurnByGame.get(gameNumber) ?? 0) + 1);
    }
    if (event.type !== "turn-end" || event.side !== "me") continue;
    capturedPlayerTurnEnds += 1;
    const snapshotState = event.snapshot?.resources?.me;
    const afterState = event.resource?.after;
    const proof = snapshotState
      ? "turn-end-snapshot" as const
      : afterState
        ? "turn-end-resource-after" as const
        : null;
    const state = proof ? resourceValues(snapshotState ?? afterState) : null;
    if (!proof || !state || !resourceStateHasEvidence(state)) continue;
    provenEndStates += 1;
    const playerTurnNumber = gameNumber != null ? localTurnByGame.get(gameNumber) : undefined;
    if (observations.length < MAX_RESOURCE_OBSERVATIONS) {
      observations.push({
        eventId: event.id,
        ...(gameNumber != null ? { gameNumber } : {}),
        capturedAt: event.capturedAt,
        ...(playerTurnNumber ? { playerTurnNumber } : {}),
        proof,
        completeState: resourceStateIsComplete(state),
        unused: {
          energy: state.energy,
          power: state.power,
          readyRunes: state.runesReady
        },
        state
      });
    }
  }
  const unknownEndStates = Math.max(0, capturedPlayerTurnEnds - provenEndStates);
  const coveragePercent = capturedPlayerTurnEnds
    ? Number((provenEndStates / capturedPlayerTurnEnds * 100).toFixed(1))
    : null;
  const state: ReplayLearningResourceCoverageState = capturedPlayerTurnEnds === 0
    ? "unknown"
    : provenEndStates === capturedPlayerTurnEnds
      ? "complete"
      : provenEndStates > 0
        ? "partial"
        : "unknown";
  return {
    state,
    capturedPlayerTurnEnds,
    provenEndStates,
    unknownEndStates,
    coveragePercent,
    observations
  };
}

/**
 * Builds one neutral flow row per card and target game. Repeated snapshots
 * carry the same sideboard change IDs, so the most recent copy of each ID is
 * retained before quantities are aggregated.
 */
export function replayLearningSideboardFlows(replay: ReplayRecord): ReplayLearningSideboardFlowRow[] {
  const snapshots = boundedSnapshots(replay);
  const events = boundedEvents(replay);
  const changes = uniqueSideboardChanges(snapshots);
  const groups = new Map<string, DeckTrackerSideboardChange[]>();
  for (const change of changes) {
    const identity = cardIdentity(change);
    if (!identity) continue;
    const gameNumber = validOptionalGameNumber(change.gameNumber);
    const key = gameNumber != null
      ? `${identity}|game:${gameNumber}`
      : `${identity}|game:unknown:${change.id}`;
    const group = groups.get(key) ?? [];
    group.push(change);
    groups.set(key, group);
  }
  const rows: ReplayLearningSideboardFlowRow[] = [];
  for (const [key, group] of groups) {
    const sorted = [...group].sort(compareCapturedAt);
    const representative = sorted.find((change) => change.name || change.code || change.cardId) ?? sorted[0];
    if (!representative) continue;
    const gameNumber = validOptionalGameNumber(representative.gameNumber);
    const boardedIn = sorted.filter((change) => change.direction === "in");
    const firstInAt = boardedIn[0]?.capturedAt;
    const eventWindow = firstInAt && gameNumber != null
      ? events.filter((event) => (
          validOptionalGameNumber(event.gameNumber) === gameNumber
          && timestamp(event.capturedAt) >= timestamp(firstInAt)
        ))
      : [];
    const cardEvents = firstInAt
      ? eventWindow.filter((event) => event.side === "me" && eventMatchesCard(event, representative))
      : [];
    const trackerVisible = firstInAt && gameNumber != null
      ? subsequentTrackerVisibleCount(snapshots, representative, firstInAt)
      : null;
    const namedVisible = firstInAt && eventWindow.length
      ? uniqueById(cardEvents.filter(isVisibleCardEvent)).length
      : null;
    const visibleCountBasis: ReplayLearningVisibleCountBasis = trackerVisible != null
      ? "deck-tracker-seen-delta"
      : namedVisible != null
        ? "named-events"
        : "unknown";
    const eventCountsKnown = Boolean(firstInAt && eventWindow.length);
    const sources = [...new Set(sorted.map((change) => change.source))];
    rows.push({
      key,
      cardKey: representative.cardKey,
      cardName: representative.name || representative.code || representative.cardId || representative.cardKey,
      ...(representative.cardId ? { cardId: representative.cardId } : {}),
      ...(representative.code ? { code: representative.code } : {}),
      ...(representative.imageUrl ? { imageUrl: representative.imageUrl } : {}),
      ...(gameNumber != null ? { gameNumber } : {}),
      changeIds: sorted.map((change) => change.id),
      sources,
      firstChangedAt: sorted[0]!.capturedAt,
      lastChangedAt: sorted.at(-1)!.capturedAt,
      boardedInQuantity: sorted.filter((change) => change.direction === "in").reduce((total, change) => total + safeQuantity(change.qty), 0),
      boardedOutQuantity: sorted.filter((change) => change.direction === "out").reduce((total, change) => total + safeQuantity(change.qty), 0),
      subsequentVisibleCount: trackerVisible ?? namedVisible,
      visibleCountBasis,
      subsequentPlayedCount: eventCountsKnown ? uniqueById(cardEvents.filter((event) => event.type === "play")).length : null,
      subsequentRecycledCount: eventCountsKnown ? uniqueById(cardEvents.filter(isRecycleEvent)).length : null
    });
    if (rows.length >= MAX_SIDEBOARD_ROWS) break;
  }
  return rows.sort((left, right) => (
    timestamp(left.firstChangedAt) - timestamp(right.firstChangedAt)
    || left.cardName.localeCompare(right.cardName)
  ));
}

/** Only fully attributed score events become battlefield conversions. */
export function replayLearningBattlefieldConversions(replay: ReplayRecord): ReplayLearningBattlefieldConversion[] {
  return uniqueById(boundedEvents(replay))
    .filter((event) => (
      event.type === "score"
      && Boolean(event.scoreReason)
      && Boolean(event.battlefield?.trim())
    ))
    .slice(0, MAX_BATTLEFIELD_CONVERSIONS)
    .map((event) => ({
      eventId: event.id,
      ...(validOptionalGameNumber(event.gameNumber) != null
        ? { gameNumber: validOptionalGameNumber(event.gameNumber) }
        : {}),
      capturedAt: event.capturedAt,
      side: event.side,
      battlefield: event.battlefield.trim(),
      reason: event.scoreReason!,
      pointsScored: finiteNumber(event.pointsScored),
      scoreAfter: {
        me: finiteNumber(event.score?.me),
        opponent: finiteNumber(event.score?.opponent)
      }
    }));
}

export function replayLearningCapabilityReceipt(
  replay: ReplayRecord,
  prepared?: {
    resourceCoverage?: ReplayLearningResourceCoverage;
    sideboardFlows?: ReplayLearningSideboardFlowRow[];
    battlefieldConversions?: ReplayLearningBattlefieldConversion[];
  }
): ReplayLearningCapabilityReceipt {
  const events = boundedEvents(replay);
  const resourceCoverage = prepared?.resourceCoverage ?? replayLearningResourceCoverage(replay);
  const sideboardFlows = prepared?.sideboardFlows ?? replayLearningSideboardFlows(replay);
  const battlefieldConversions = prepared?.battlefieldConversions ?? replayLearningBattlefieldConversions(replay);

  const mulligans = events.filter((event) => event.type === "mulligan");
  const namedOpeningHands = mulligans.filter((event) => (
    Array.isArray(event.mulligan?.kept)
    || Array.isArray(event.mulligan?.options)
    || Array.isArray(event.mulligan?.redrawn)
  ));
  const namedLocalPlays = events.filter((event) => event.type === "play" && event.side === "me" && Boolean(event.cardName || event.cardId));
  const localTurnStarts = events.filter((event) => event.type === "turn-start" && event.side === "me");
  const timedLocalPlays = namedLocalPlays.filter((play) => {
    const gameNumber = validOptionalGameNumber(play.gameNumber);
    return gameNumber != null && localTurnStarts.some((start) => (
      validOptionalGameNumber(start.gameNumber) === gameNumber
      && timestamp(start.capturedAt) <= timestamp(play.capturedAt)
    ));
  });
  const snapshots = boundedSnapshots(replay);
  const combatEvents = events.filter((event) => event.type === "combat");
  const detailedCombatEvents = combatEvents.filter((event) => Boolean(event.combat));
  const battlefieldEvidence = events.filter((event) => (
    event.type === "battlefield" || event.type === "score" || event.type === "scoreboard"
  ));

  return {
    replayId: replay.id,
    openingHand: namedOpeningHands.length
      ? capability("available", namedOpeningHands.length, "Named opening-hand cards were retained.")
      : mulligans.length
        ? capability("partial", mulligans.length, "A mulligan was retained without named opening-hand cards.")
        : capability("unknown", 0, "No persisted opening-hand event is available."),
    cardTiming: timedLocalPlays.length
      ? capability("available", timedLocalPlays.length, "Named local plays can be placed after an explicit local turn start.")
      : namedLocalPlays.length || localTurnStarts.length
        ? capability("partial", namedLocalPlays.length + localTurnStarts.length, "Only one side of named-play and explicit-turn timing evidence is present.")
        : capability("unknown", 0, "No persisted named local play timing evidence is available."),
    resources: resourceCoverage.provenEndStates
      ? capability(
          resourceCoverage.state === "complete" ? "available" : "partial",
          resourceCoverage.provenEndStates,
          `${resourceCoverage.provenEndStates} of ${resourceCoverage.capturedPlayerTurnEnds} captured local turn ends include a resource after-state.`
        )
      : resourceCoverage.capturedPlayerTurnEnds || events.some((event) => Boolean(event.resource || event.snapshot))
        ? capability("partial", resourceCoverage.capturedPlayerTurnEnds, "Resource evidence exists, but no local turn-end after-state was proven.")
        : capability("unknown", 0, "No persisted local turn-end resource state is available."),
    sideboard: sideboardFlows.length
      ? capability("available", sideboardFlows.length, "Persisted sideboard changes can be grouped by card and target game.")
      : snapshots.length
        ? capability("partial", snapshots.length, "Deck-tracker snapshots exist without a retained sideboard change.")
        : capability("unknown", 0, "No persisted deck-tracker sideboard evidence is available."),
    combat: detailedCombatEvents.length
      ? capability("available", detailedCombatEvents.length, "Explicit combat payloads were retained.")
      : combatEvents.length
        ? capability("partial", combatEvents.length, "Combat rows were retained without structured combat detail.")
        : capability("unknown", 0, "No persisted structured combat evidence is available."),
    battlefield: battlefieldConversions.length
      ? capability("available", battlefieldConversions.length, "Score reason and battlefield were retained together on explicit score events.")
      : battlefieldEvidence.length
        ? capability("partial", battlefieldEvidence.length, "Battlefield or score rows exist without a fully attributed conversion.")
        : capability("unknown", 0, "No persisted battlefield scoring evidence is available.")
  };
}

function capability(
  state: ReplayLearningCapabilityState,
  evidenceCount: number,
  detail: string
): ReplayLearningCapability {
  return { state, evidenceCount, detail };
}

function resourceValues(value: Partial<ReplayStructuredResourceState> | undefined): ReplayLearningResourceValues | null {
  if (!value) return null;
  return {
    energy: finiteNonNegativeNumber(value.energy),
    power: finiteNonNegativeNumber(value.power),
    xp: finiteNonNegativeNumber(value.xp),
    runesReady: finiteNonNegativeNumber(value.runesReady),
    runesExhausted: finiteNonNegativeNumber(value.runesExhausted)
  };
}

function resourceStateHasEvidence(state: ReplayLearningResourceValues): boolean {
  return Object.values(state).some((value) => value != null);
}

function resourceStateIsComplete(state: ReplayLearningResourceValues): boolean {
  return Object.values(state).every((value) => value != null);
}

function uniqueSideboardChanges(snapshots: DeckTrackerSnapshot[]): DeckTrackerSideboardChange[] {
  const byId = new Map<string, DeckTrackerSideboardChange>();
  for (const snapshot of snapshots) {
    for (const change of snapshot.state.sideboard.changes.slice(-MAX_SIDEBOARD_CHANGES)) {
      const id = change.id?.trim();
      if (!id) continue;
      const current = byId.get(id);
      if (!current || timestamp(change.capturedAt) >= timestamp(current.capturedAt)) byId.set(id, { ...change, id });
      if (byId.size >= MAX_SIDEBOARD_CHANGES) break;
    }
  }
  return [...byId.values()].sort(compareCapturedAt);
}

function subsequentTrackerVisibleCount(
  snapshots: DeckTrackerSnapshot[],
  change: DeckTrackerSideboardChange,
  changedAt: string
): number | null {
  const gameNumber = validOptionalGameNumber(change.gameNumber);
  if (gameNumber == null) return null;
  const changedAtMs = timestamp(changedAt);
  const sameGameSnapshots = snapshots.filter((snapshot) => (
    validOptionalGameNumber(snapshot.state.sideboard.gameNumber) === gameNumber
  ));
  const before = [...sameGameSnapshots]
    .filter((snapshot) => timestamp(snapshot.capturedAt) < changedAtMs)
    .sort((left, right) => timestamp(right.capturedAt) - timestamp(left.capturedAt))[0];
  const afterCards = sameGameSnapshots
    .filter((snapshot) => timestamp(snapshot.capturedAt) >= changedAtMs)
    .flatMap((snapshot) => snapshot.state.cards.filter((card) => trackerCardMatchesChange(card, change)));
  if (!afterCards.length) return null;
  const baseline = before?.state.cards.find((card) => trackerCardMatchesChange(card, change))?.seenCount ?? 0;
  const maximumAfter = Math.max(...afterCards.map((card) => safeQuantity(card.seenCount)));
  return Math.max(0, maximumAfter - safeQuantity(baseline));
}

function trackerCardMatchesChange(card: DeckTrackerCardState, change: DeckTrackerSideboardChange): boolean {
  return identitiesOverlap(
    [card.cardKey, card.cardId, card.code, card.name],
    [change.cardKey, change.cardId, change.code, change.name]
  );
}

function eventMatchesCard(event: ReplayStructuredEvent, change: DeckTrackerSideboardChange): boolean {
  return identitiesOverlap(
    [event.cardId, event.cardName],
    [change.cardKey, change.cardId, change.code, change.name]
  );
}

function identitiesOverlap(left: Array<string | undefined>, right: Array<string | undefined>): boolean {
  const rightKeys = new Set(right.map(normalizeIdentity).filter(Boolean));
  return left.some((value) => rightKeys.has(normalizeIdentity(value)));
}

function cardIdentity(change: DeckTrackerSideboardChange): string {
  return normalizeIdentity(change.cardKey || change.cardId || change.code || change.name);
}

function isVisibleCardEvent(event: ReplayStructuredEvent): boolean {
  return event.type === "draw" || event.type === "play" || event.type === "move" || event.type === "action";
}

function isRecycleEvent(event: ReplayStructuredEvent): boolean {
  const destination = normalizeIdentity(event.toZone || event.destination);
  return destination.includes("recycle") || /\brecycl(?:e|ed|ing)\b/i.test(event.text);
}

function boundedEvents(replay: ReplayRecord): ReplayStructuredEvent[] {
  return uniqueById(replay.structuredEvents ?? [])
    .sort(compareCapturedAt)
    .slice(-MAX_STRUCTURED_EVENTS);
}

function boundedSnapshots(replay: ReplayRecord): DeckTrackerSnapshot[] {
  return [...(replay.deckTrackerSnapshots ?? [])]
    .sort(compareCapturedAt)
    .slice(-MAX_TRACKER_SNAPSHOTS);
}

function uniqueById<T extends { id: string }>(values: T[]): T[] {
  const byId = new Map<string, T>();
  for (const value of values) {
    const id = value.id?.trim();
    if (id && !byId.has(id)) byId.set(id, value);
  }
  return [...byId.values()];
}

function compareCapturedAt(left: { capturedAt: string }, right: { capturedAt: string }): number {
  return timestamp(left.capturedAt) - timestamp(right.capturedAt);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validOptionalGameNumber(value: number | undefined): number | undefined {
  return Number.isInteger(value) && value! > 0 ? value : undefined;
}

function safeQuantity(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function finiteNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteNonNegativeNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeIdentity(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
