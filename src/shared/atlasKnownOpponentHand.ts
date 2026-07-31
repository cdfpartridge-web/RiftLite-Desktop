import { deckTrackerCardKey } from "./deckTracker.js";
import type {
  AtlasKnownOpponentHandCard,
  AtlasKnownOpponentHandState,
  RawCaptureAppendFramePayload
} from "./types.js";

type JsonRecord = Record<string, unknown>;

type BoardRevealDirective = {
  playerId: string;
  revealed: boolean;
};

type PatchAnalysis = {
  directives: BoardRevealDirective[];
  handResetPlayers: Set<string>;
  handInsertCountByPlayer: Map<string, number>;
  handRemoveCountByPlayer: Map<string, number>;
  fullHandCardsByPlayer: Map<string, AtlasKnownOpponentHandCard[]>;
};

const PUBLIC_OPPONENT_ZONES = new Set([
  "base",
  "battlefield",
  "battlefielda",
  "battlefieldb",
  "battlefieldtoken",
  "banished",
  "board",
  "chain",
  "discard",
  "exile",
  "graveyard",
  "stack",
  "trash",
  "units"
]);

const MAX_SEEN_FRAMES = 512;

export class AtlasKnownOpponentHandTracker {
  private state: AtlasKnownOpponentHandState = immutableState(emptyState());
  private localPlayerId = "";
  private readonly knownIdentityByInstance = new Map<string, AtlasKnownOpponentHandCard>();
  private readonly knownSourceByChainEntry = new Map<string, string>();
  private readonly seenFrames = new Set<string>();

  ingest(payload: RawCaptureAppendFramePayload): boolean {
    if (payload.platform !== "atlas") {
      return false;
    }
    const packet = parseJsonRecord(payload.frame.raw);
    if (!packet) {
      return false;
    }

    const frameKey = rawFrameKey(payload, packet);
    if (frameKey && this.seenFrames.has(frameKey)) {
      return false;
    }
    if (frameKey) {
      this.rememberFrame(frameKey);
    }

    const capturedAt = frameCapturedAt(payload);
    const frameType = readString(packet.type);
    if (frameType === "room_shell_leave") {
      return this.resetContext(capturedAt);
    }

    const boundaryChanged = this.applyBoundary(packet, payload.requestUrl ?? "", capturedAt);
    const viewerChanged = this.learnLocalPlayerId(packet, payload, capturedAt);
    if (
      payload.frame.dir !== "in"
      || frameType !== "authoritative_patch_commit"
      || !this.localPlayerId
    ) {
      return boundaryChanged || viewerChanged;
    }

    const patch = readObject(packet.patch);
    const operations = readArray(patch?.operations)
      .map(readObject)
      .filter((operation): operation is JsonRecord => Boolean(operation));
    if (!operations.length) {
      return boundaryChanged || viewerChanged;
    }

    const patchChanged = this.applyAuthoritativePatch(operations, capturedAt);
    return boundaryChanged || viewerChanged || patchChanged;
  }

  getState(): AtlasKnownOpponentHandState {
    return this.state;
  }

  dismiss(instanceId: string): boolean {
    const exactInstanceId = readString(instanceId);
    if (!exactInstanceId || !this.state.cards.some((card) => card.instanceId === exactInstanceId)) {
      return false;
    }
    return this.commit({
      ...this.state,
      cards: this.state.cards.filter((card) => card.instanceId !== exactInstanceId)
    }, currentTimestamp());
  }

  clear(): boolean {
    if (!this.state.cards.length) {
      return false;
    }
    return this.commit({
      ...this.state,
      revealedAt: this.state.activeReveal ? this.state.revealedAt : "",
      cards: []
    }, currentTimestamp());
  }

  reset(): boolean {
    return this.resetContext(currentTimestamp());
  }

  private applyAuthoritativePatch(operations: JsonRecord[], capturedAt: string): boolean {
    const analysis = analyzePatch(operations, capturedAt);
    const positivePlayers = uniqueStrings(
      analysis.directives
        .filter((directive) => directive.revealed && directive.playerId !== this.localPlayerId)
        .map((directive) => directive.playerId)
    );
    const ambiguousPositiveReveal = positivePlayers.length > 1;

    let next = this.state;
    let usedHandReplacement = false;

    // A reveal is accepted only when the same authoritative patch both enables
    // the opponent-facing reveal and supplies an authoritative hand replacement.
    if (positivePlayers.length === 1) {
      const opponentPlayerId = positivePlayers[0]!;
      const cards = dedupeCardsByInstance(analysis.fullHandCardsByPlayer.get(opponentPlayerId) ?? []);
      const handInsertCount = analysis.handInsertCountByPlayer.get(opponentPlayerId) ?? 0;
      const hasExactCards = cards.length > 0;
      const hasAuthoritativeEmptyHand = handInsertCount === 0 && (
        analysis.handResetPlayers.has(opponentPlayerId)
        || (
          !this.state.activeReveal
          && this.state.opponentPlayerId === opponentPlayerId
          && this.state.opponentHandCount === 0
        )
      );
      if (hasExactCards || hasAuthoritativeEmptyHand) {
        this.rememberKnownIdentities(cards);
        next = {
          ...next,
          opponentPlayerId,
          activeReveal: true,
          opponentHandCount: handInsertCount,
          revealedAt: capturedAt,
          cards
        };
        usedHandReplacement = true;
      }
    }

    const falseDirective = analysis.directives.find((directive) => (
      !directive.revealed
      && directive.playerId !== this.localPlayerId
      && directive.playerId === next.opponentPlayerId
    ));
    if (falseDirective) {
      const replacementCount = analysis.handInsertCountByPlayer.get(falseDirective.playerId);
      next = {
        ...next,
        activeReveal: false,
        opponentHandCount: replacementCount === undefined
          ? next.opponentHandCount
          : replacementCount
      };
      usedHandReplacement = true;
    }

    if (!next.opponentPlayerId) {
      return this.commit(next, capturedAt);
    }

    const opponentPlayerId = next.opponentPlayerId;
    this.rememberKnownChainSources(operations, opponentPlayerId);
    const departedInstanceIds = knownDepartures(
      operations,
      opponentPlayerId,
      new Set(next.cards.map((card) => card.instanceId)),
      !usedHandReplacement && !falseDirective
    );
    const cardsByInstance = new Map(
      next.cards
        .filter((card) => !departedInstanceIds.has(card.instanceId))
        .map((card) => [card.instanceId, card])
    );

    if (
      next.activeReveal
      && !usedHandReplacement
      && !ambiguousPositiveReveal
      && !analysis.directives.some((directive) => (
        directive.playerId === opponentPlayerId && !directive.revealed
      ))
    ) {
      const activeRevealCards = analysis.fullHandCardsByPlayer.get(opponentPlayerId) ?? [];
      if (activeRevealCards.length) {
        this.rememberKnownIdentities(activeRevealCards);
        for (const card of activeRevealCards) {
          if (!cardsByInstance.has(card.instanceId)) {
            cardsByInstance.set(card.instanceId, card);
          }
        }
      }
    }

    for (const card of knownArrivals(
      operations,
      opponentPlayerId,
      this.knownIdentityByInstance,
      this.knownSourceByChainEntry,
      next.activeReveal,
      capturedAt
    )) {
      cardsByInstance.set(card.instanceId, card);
    }
    next = {
      ...next,
      cards: [...cardsByInstance.values()]
    };

    if (!usedHandReplacement) {
      const handInserts = analysis.handInsertCountByPlayer.get(opponentPlayerId) ?? 0;
      const explicitHandRemovals = analysis.handRemoveCountByPlayer.get(opponentPlayerId) ?? 0;
      const fallbackPublicDepartures = Math.max(0, departedInstanceIds.size - explicitHandRemovals);
      if (
        next.opponentHandCount !== null
        && (handInserts || explicitHandRemovals || fallbackPublicDepartures)
      ) {
        next = {
          ...next,
          opponentHandCount: Math.max(
            0,
            next.opponentHandCount + handInserts - explicitHandRemovals - fallbackPublicDepartures
          )
        };
      }
    }

    return this.commit(next, capturedAt);
  }

  private applyBoundary(packet: JsonRecord, requestUrl: string, capturedAt: string): boolean {
    const incomingRoomCode = readRoomCode(packet, requestUrl);
    const incomingGameNumber = readGameNumber(packet);
    const roomChanged = Boolean(
      incomingRoomCode
      && this.state.roomCode
      && incomingRoomCode !== this.state.roomCode
    );
    const gameChanged = Boolean(
      incomingGameNumber !== undefined
      && this.state.gameNumber !== undefined
      && incomingGameNumber !== this.state.gameNumber
    );

    if (roomChanged || gameChanged) {
      this.knownIdentityByInstance.clear();
      this.knownSourceByChainEntry.clear();
      this.localPlayerId = "";
      return this.commit({
        ...emptyState(),
        roomCode: incomingRoomCode || this.state.roomCode,
        gameNumber: incomingGameNumber
      }, capturedAt);
    }

    const nextRoomCode = incomingRoomCode || this.state.roomCode;
    const nextGameNumber = incomingGameNumber ?? this.state.gameNumber;
    if (nextRoomCode === this.state.roomCode && nextGameNumber === this.state.gameNumber) {
      return false;
    }
    return this.commit({
      ...this.state,
      roomCode: nextRoomCode,
      gameNumber: nextGameNumber
    }, capturedAt);
  }

  private learnLocalPlayerId(
    packet: JsonRecord,
    payload: RawCaptureAppendFramePayload,
    capturedAt: string
  ): boolean {
    const sessionDoc = readSessionDoc(packet);
    const viewer = readObject(sessionDoc?.viewer);
    const selfPlayer = readObject(sessionDoc?.selfPlayer);
    const viewerRole = readString(viewer?.role).toLowerCase();
    const urlIdentity = readPlayerIdentityFromUrl(payload.requestUrl ?? "");

    const explicitSessionSpectator = [viewer?.playerId, selfPlayer?.id]
      .some((value) => readString(value).toLowerCase() === "spectator");
    if (urlIdentity.explicitSpectator || viewerRole === "spectator" || explicitSessionSpectator) {
      this.localPlayerId = "";
      return this.resetForViewerTransition(capturedAt);
    }

    const strongCandidates = uniqueStrings([
      urlIdentity.playerId,
      readRealPlayerId(viewer?.playerId),
      readRealPlayerId(selfPlayer?.id)
    ]);
    if (strongCandidates.length === 1) {
      const nextLocalPlayerId = strongCandidates[0]!;
      const stateChanged = this.localPlayerId && this.localPlayerId !== nextLocalPlayerId
        ? this.resetForViewerTransition(capturedAt)
        : false;
      this.localPlayerId = nextLocalPlayerId;
      return stateChanged;
    }
    if (strongCandidates.length > 1) {
      // Conflicting viewer evidence is not safe enough to identify a local seat.
      this.localPlayerId = "";
      return this.resetForViewerTransition(capturedAt);
    }

    if (payload.frame.dir !== "out") {
      return false;
    }
    const action = readObject(packet.action);
    const actor = readObject(action?.actor);
    const actionActor = [
      action?.actorPlayerId,
      action?.byPlayerId,
      action?.playerId,
      typeof action?.actor === "string" ? action.actor : "",
      actor?.playerId,
      actor?.id,
      packet.actorPlayerId,
      packet.byPlayerId,
      packet.playerId
    ].map(readRealPlayerId).find(Boolean) ?? "";
    if (actionActor) {
      const stateChanged = this.localPlayerId && this.localPlayerId !== actionActor
        ? this.resetForViewerTransition(capturedAt)
        : false;
      this.localPlayerId = actionActor;
      return stateChanged;
    }
    return false;
  }

  private resetContext(capturedAt: string): boolean {
    this.seenFrames.clear();
    this.knownIdentityByInstance.clear();
    this.knownSourceByChainEntry.clear();
    this.localPlayerId = "";
    if (isEmptyState(this.state)) {
      return false;
    }
    return this.commit(emptyState(), capturedAt);
  }

  private resetForViewerTransition(capturedAt: string): boolean {
    this.knownIdentityByInstance.clear();
    this.knownSourceByChainEntry.clear();
    return this.commit({
      ...emptyState(),
      roomCode: this.state.roomCode,
      ...(this.state.gameNumber === undefined ? {} : { gameNumber: this.state.gameNumber })
    }, capturedAt);
  }

  private commit(candidate: AtlasKnownOpponentHandState, updatedAt: string): boolean {
    const normalized = stateWithoutUpdatedAt(candidate);
    if (sameStateContent(this.state, normalized)) {
      return false;
    }
    this.state = immutableState({
      ...normalized,
      updatedAt
    });
    return true;
  }

  private rememberFrame(frameKey: string): void {
    this.seenFrames.add(frameKey);
    while (this.seenFrames.size > MAX_SEEN_FRAMES) {
      const oldest = this.seenFrames.values().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.seenFrames.delete(oldest);
    }
  }

  private rememberKnownIdentities(cards: AtlasKnownOpponentHandCard[]): void {
    for (const card of cards) {
      this.knownIdentityByInstance.set(card.instanceId, card);
    }
  }

  private rememberKnownChainSources(operations: JsonRecord[], opponentPlayerId: string): void {
    for (const operation of operations) {
      if (readString(operation.op) !== "chain_insert") {
        continue;
      }
      for (const entryValue of readArray(operation.entries)) {
        const entry = readObject(entryValue);
        const entryId = readExactInstanceId(entry?.id);
        const sourceInstanceId = readExactInstanceId(entry?.sourceCardId);
        const ownerPlayerId = readRealPlayerId(entry?.byPlayerId)
          || readRealPlayerId(readObject(entry?.card)?.ownerPlayerId);
        if (
          entryId
          && sourceInstanceId
          && ownerPlayerId === opponentPlayerId
          && this.knownIdentityByInstance.has(sourceInstanceId)
        ) {
          this.knownSourceByChainEntry.set(entryId, sourceInstanceId);
        }
      }
    }
  }
}

function analyzePatch(operations: JsonRecord[], capturedAt: string): PatchAnalysis {
  const directives: BoardRevealDirective[] = [];
  const handResetPlayers = new Set<string>();
  const handInsertCountByPlayer = new Map<string, number>();
  const handRemoveCountByPlayer = new Map<string, number>();
  const fullHandCardsByPlayer = new Map<string, AtlasKnownOpponentHandCard[]>();

  for (const operation of operations) {
    const op = readString(operation.op);
    if (op === "set_board_fields") {
      const playerId = readRealPlayerId(operation.playerId);
      const fields = readObject(operation.fields);
      const revealValue = fields?.handRevealToOpponent;
      if (playerId && (revealValue === true || revealValue === false)) {
        directives.push({ playerId, revealed: revealValue });
      }
      continue;
    }

    if (op === "zone_insert" && isHandZone(operation.zone)) {
      const playerId = readRealPlayerId(operation.playerId);
      if (!playerId) {
        continue;
      }
      const values = readArray(operation.cards);
      handInsertCountByPlayer.set(
        playerId,
        (handInsertCountByPlayer.get(playerId) ?? 0) + values.length
      );
      const cards = values
        .map((value) => fullRevealedCard(value, capturedAt))
        .filter((card): card is AtlasKnownOpponentHandCard => Boolean(card));
      if (cards.length) {
        fullHandCardsByPlayer.set(
          playerId,
          [...(fullHandCardsByPlayer.get(playerId) ?? []), ...cards]
        );
      }
      continue;
    }

    if (op === "zone_remove" && isHandZone(operation.zone)) {
      const playerId = readRealPlayerId(operation.playerId);
      if (playerId) {
        handResetPlayers.add(playerId);
        handRemoveCountByPlayer.set(
          playerId,
          (handRemoveCountByPlayer.get(playerId) ?? 0) + operationCardCount(operation)
        );
      }
      continue;
    }

    if (op === "zone_move") {
      const from = readObject(operation.from);
      const to = readObject(operation.to);
      const fromHand = isHandZone(from?.zone);
      const toHand = isHandZone(to?.zone);
      if (fromHand === toHand) {
        continue;
      }
      if (fromHand) {
        const playerId = readRealPlayerId(from?.playerId)
          || readRealPlayerId(readObject(operation.card)?.ownerPlayerId);
        if (!playerId) {
          continue;
        }
        handRemoveCountByPlayer.set(
          playerId,
          (handRemoveCountByPlayer.get(playerId) ?? 0) + 1
        );
      } else {
        const playerId = readRealPlayerId(to?.playerId)
          || readRealPlayerId(readObject(operation.card)?.ownerPlayerId);
        if (!playerId) {
          continue;
        }
        handInsertCountByPlayer.set(
          playerId,
          (handInsertCountByPlayer.get(playerId) ?? 0) + 1
        );
      }
    }
  }

  return {
    directives,
    handResetPlayers,
    handInsertCountByPlayer,
    handRemoveCountByPlayer,
    fullHandCardsByPlayer
  };
}

function knownDepartures(
  operations: JsonRecord[],
  opponentPlayerId: string,
  knownInstanceIds: Set<string>,
  allowDirectHandRemovals: boolean
): Set<string> {
  const departed = new Set<string>();

  for (const operation of operations) {
    const op = readString(operation.op);
    if (op === "zone_remove") {
      if (
        !allowDirectHandRemovals
        || readRealPlayerId(operation.playerId) !== opponentPlayerId
        || !isHandZone(operation.zone)
      ) {
        continue;
      }
      const values = [
        operation.card,
        operation.cardId,
        ...readArray(operation.cards),
        ...readArray(operation.cardIds)
      ];
      for (const value of values) {
        const instanceId = exactCardInstanceId(value) || readExactInstanceId(value);
        if (instanceId && knownInstanceIds.has(instanceId)) {
          departed.add(instanceId);
        }
      }
      continue;
    }

    if (op === "zone_move") {
      const from = readObject(operation.from);
      const ownerPlayerId = readRealPlayerId(from?.playerId)
        || readRealPlayerId(readObject(operation.card)?.ownerPlayerId);
      if (
        ownerPlayerId !== opponentPlayerId
        || !isHandZone(from?.zone)
      ) {
        continue;
      }
      const instanceId = exactCardInstanceId(operation.card)
        || readExactInstanceId(operation.cardId);
      if (instanceId && knownInstanceIds.has(instanceId)) {
        departed.add(instanceId);
      }
      continue;
    }

    if (op === "zone_insert") {
      const ownerPlayerId = readRealPlayerId(operation.playerId);
      if (ownerPlayerId !== opponentPlayerId || !isPublicOpponentZone(operation.zone)) {
        continue;
      }
      for (const cardValue of readArray(operation.cards)) {
        const instanceId = exactCardInstanceId(cardValue);
        if (instanceId && knownInstanceIds.has(instanceId)) {
          departed.add(instanceId);
        }
      }
      continue;
    }

    if (op === "chain_insert") {
      for (const entryValue of readArray(operation.entries)) {
        const entry = readObject(entryValue);
        if (!entry) {
          continue;
        }
        const card = readObject(entry.card);
        const ownerPlayerId = readRealPlayerId(entry.byPlayerId)
          || readRealPlayerId(card?.ownerPlayerId);
        if (ownerPlayerId !== opponentPlayerId) {
          continue;
        }
        const instanceId = readExactInstanceId(entry.sourceCardId)
          || exactCardInstanceId(entry.card);
        if (instanceId && knownInstanceIds.has(instanceId)) {
          departed.add(instanceId);
        }
      }
    }
  }
  return departed;
}

function knownArrivals(
  operations: JsonRecord[],
  opponentPlayerId: string,
  knownIdentityByInstance: Map<string, AtlasKnownOpponentHandCard>,
  knownSourceByChainEntry: Map<string, string>,
  acceptNewExactCards: boolean,
  capturedAt: string
): AtlasKnownOpponentHandCard[] {
  const arrivals = new Map<string, AtlasKnownOpponentHandCard>();
  const possibleAnonymousReturns = new Set<string>();
  const publicDestinationIds = new Set<string>();
  let anonymousHandInsertCount = 0;

  const accept = (value: unknown, fallbackId: unknown = "") => {
    let card = acceptNewExactCards ? fullRevealedCard(value, capturedAt) : null;
    const instanceId = card?.instanceId
      || exactCardInstanceId(value)
      || readExactInstanceId(fallbackId)
      || readExactInstanceId(value);
    if (!instanceId) {
      return;
    }
    if (card) {
      knownIdentityByInstance.set(instanceId, card);
    } else {
      card = knownIdentityByInstance.get(instanceId) ?? null;
    }
    if (card) {
      arrivals.set(instanceId, card);
    }
  };

  for (const operation of operations) {
    const op = readString(operation.op);
    if (op === "zone_insert") {
      const values = readArray(operation.cards);
      if (
        isHandZone(operation.zone)
        && readRealPlayerId(operation.playerId) === opponentPlayerId
      ) {
        for (const value of values) {
          if (exactCardInstanceId(value)) {
            accept(value);
          } else {
            anonymousHandInsertCount += 1;
          }
        }
      } else if (isPublicOpponentZone(operation.zone)) {
        for (const value of values) {
          const instanceId = exactCardInstanceId(value);
          if (instanceId) {
            publicDestinationIds.add(instanceId);
          }
        }
      }
      continue;
    }

    if (op === "zone_move") {
      const from = readObject(operation.from);
      const to = readObject(operation.to);
      const instanceId = exactCardInstanceId(operation.card)
        || readExactInstanceId(operation.cardId);
      if (!isHandZone(to?.zone)) {
        if (instanceId && isPublicOpponentZone(to?.zone)) {
          publicDestinationIds.add(instanceId);
        }
        continue;
      }
      if (isHandZone(from?.zone) || readRealPlayerId(to?.playerId) !== opponentPlayerId) {
        continue;
      }
      accept(operation.card, operation.cardId);
      continue;
    }

    if (
      op === "zone_remove"
      && isPublicOpponentZone(operation.zone)
      && readRealPlayerId(operation.playerId) === opponentPlayerId
    ) {
      for (const value of readArray(operation.cardIds)) {
        const instanceId = readExactInstanceId(value);
        if (instanceId && knownIdentityByInstance.has(instanceId)) {
          possibleAnonymousReturns.add(instanceId);
        }
      }
      continue;
    }

    if (op === "chain_remove") {
      for (const value of readArray(operation.entryIds)) {
        const entryId = readExactInstanceId(value);
        const sourceInstanceId = entryId
          ? knownSourceByChainEntry.get(entryId) ?? ""
          : "";
        if (entryId) {
          knownSourceByChainEntry.delete(entryId);
        }
        if (sourceInstanceId && knownIdentityByInstance.has(sourceInstanceId)) {
          possibleAnonymousReturns.add(sourceInstanceId);
        }
      }
    }
  }

  const anonymousReturnIds = [...possibleAnonymousReturns]
    .filter((instanceId) => !publicDestinationIds.has(instanceId));
  if (
    anonymousHandInsertCount > 0
    && anonymousReturnIds.length === anonymousHandInsertCount
  ) {
    for (const instanceId of anonymousReturnIds) {
      const card = knownIdentityByInstance.get(instanceId);
      if (card) {
        arrivals.set(instanceId, card);
      }
    }
  }

  return [...arrivals.values()];
}

function fullRevealedCard(value: unknown, revealedAt: string): AtlasKnownOpponentHandCard | null {
  const card = readObject(value);
  if (!card || card.isPlaceholder === true) {
    return null;
  }
  const instanceId = exactCardInstanceId(card);
  const code = readString(card.cardCode) || readString(card.code);
  const name = readString(card.name) || readString(card.title);
  if (!instanceId || !code || !name) {
    return null;
  }
  const cardId = readString(card.definitionId) || readString(card.cardId) || code;
  const cardKey = deckTrackerCardKey({ cardId, code, name });
  if (!cardKey) {
    return null;
  }
  return {
    instanceId,
    cardKey,
    name,
    code,
    cardId,
    revealedAt
  };
}

function exactCardInstanceId(value: unknown): string {
  const card = readObject(value);
  return readExactInstanceId(card?.id) || readExactInstanceId(card?.instanceId);
}

function readExactInstanceId(value: unknown): string {
  const instanceId = readString(value);
  if (!instanceId) {
    return "";
  }
  const normalized = instanceId.toLowerCase();
  if (
    normalized.startsWith("__hidden_zone__:")
    || normalized === "placeholder"
    || normalized === "hidden"
    || normalized === "unknown"
  ) {
    return "";
  }
  return instanceId;
}

function dedupeCardsByInstance(cards: AtlasKnownOpponentHandCard[]): AtlasKnownOpponentHandCard[] {
  const byInstance = new Map<string, AtlasKnownOpponentHandCard>();
  for (const card of cards) {
    if (!byInstance.has(card.instanceId)) {
      byInstance.set(card.instanceId, card);
    }
  }
  return [...byInstance.values()];
}

function operationCardCount(operation: JsonRecord): number {
  const cardIds = readArray(operation.cardIds);
  if (cardIds.length) {
    return cardIds.length;
  }
  const cards = readArray(operation.cards);
  if (cards.length) {
    return cards.length;
  }
  const count = Number(operation.count);
  if (Number.isFinite(count) && count > 0) {
    return Math.max(1, Math.trunc(count));
  }
  return 1;
}

function readRoomCode(packet: JsonRecord, requestUrl: string): string {
  const sessionDoc = readSessionDoc(packet);
  const fromUrl = readRoomCodeFromUrl(requestUrl);
  return readString(packet.roomCode)
    || readString(sessionDoc?.roomCode)
    || fromUrl
    || readString(packet.gameInstanceId)
    || readString(sessionDoc?.gameInstanceId);
}

function readGameNumber(packet: JsonRecord): number | undefined {
  const sessionDoc = readSessionDoc(packet);
  const snapshot = readObject(packet.snapshot);
  const direct = firstGameNumber([
    packet.gameNumber,
    packet.game_number,
    packet.game,
    sessionDoc?.gameNumber,
    sessionDoc?.game_number,
    sessionDoc?.game,
    snapshot?.gameNumber,
    snapshot?.game_number,
    snapshot?.game
  ]);
  if (direct !== undefined) {
    return direct;
  }
  const patch = readObject(packet.patch);
  for (const operationValue of readArray(patch?.operations)) {
    const operation = readObject(operationValue);
    const op = readString(operation?.op);
    if (op !== "set_room_fields" && op !== "set_game_fields") {
      continue;
    }
    const fields = readObject(operation?.fields);
    const gameNumber = firstGameNumber([
      fields?.gameNumber,
      fields?.game_number,
      fields?.game
    ]);
    if (gameNumber !== undefined) {
      return gameNumber;
    }
  }
  return undefined;
}

function firstGameNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 1) {
      return Math.trunc(number);
    }
  }
  return undefined;
}

function readSessionDoc(packet: JsonRecord): JsonRecord | null {
  const payload = readObject(packet.payload);
  return readObject(packet.sessionDoc)
    ?? readObject(payload?.sessionDoc)
    ?? readObject(packet.snapshot);
}

function readPlayerIdentityFromUrl(requestUrl: string): {
  playerId: string;
  explicitSpectator: boolean;
} {
  try {
    const url = new URL(requestUrl);
    const raw = url.searchParams.get("playerId")
      || url.searchParams.get("player_id")
      || url.searchParams.get("viewerPlayerId")
      || "";
    return {
      playerId: readRealPlayerId(raw),
      explicitSpectator: raw.trim().toLowerCase() === "spectator"
    };
  } catch {
    return { playerId: "", explicitSpectator: false };
  }
}

function readRoomCodeFromUrl(requestUrl: string): string {
  try {
    const url = new URL(requestUrl);
    const queryRoom = url.searchParams.get("roomCode") || url.searchParams.get("room") || "";
    if (queryRoom.trim()) {
      return queryRoom.trim();
    }
    const match = url.pathname.match(/\/parties\/match\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]).trim() : "";
  } catch {
    return "";
  }
}

function readRealPlayerId(value: unknown): string {
  const playerId = readString(value);
  if (!playerId || playerId.length > 256 || /[\u0000-\u001f]/.test(playerId)) {
    return "";
  }
  const normalized = playerId.toLowerCase();
  if (
    normalized === "spectator"
    || normalized === "unknown"
    || normalized === "undefined"
    || normalized === "null"
  ) {
    return "";
  }
  return playerId;
}

function isHandZone(value: unknown): boolean {
  return normalizeZone(value) === "hand";
}

function isPublicOpponentZone(value: unknown): boolean {
  return PUBLIC_OPPONENT_ZONES.has(normalizeZone(value));
}

function normalizeZone(value: unknown): string {
  return readString(value).toLowerCase().replace(/[^a-z]/g, "");
}

function rawFrameKey(payload: RawCaptureAppendFramePayload, packet: JsonRecord): string {
  const authoritativeSequence = Number(packet.sequence);
  if (Number.isFinite(authoritativeSequence)) {
    return [
      "authoritative",
      readString(packet.gameInstanceId) || readRoomCodeFromUrl(payload.requestUrl ?? ""),
      readGameNumber(packet) ?? "",
      readString(payload.frame.socketId),
      readString(packet.type),
      Math.trunc(authoritativeSequence),
      payload.frame.dir
    ].join(":");
  }
  const socketId = readString(payload.frame.socketId);
  const sequence = Number(payload.frame.seq);
  const timestamp = Number(payload.frame.ts);
  const rawHash = hashText(payload.frame.raw);
  if (!socketId && !Number.isFinite(sequence) && !Number.isFinite(timestamp)) {
    return "";
  }
  return [
    socketId,
    readRoomCodeFromUrl(payload.requestUrl ?? ""),
    Number.isFinite(sequence) ? sequence : "",
    Number.isFinite(timestamp) ? timestamp : "",
    payload.frame.dir,
    rawHash
  ].join(":");
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function frameCapturedAt(payload: RawCaptureAppendFramePayload): string {
  const timestamp = Number(payload.frame.ts);
  if (Number.isFinite(timestamp)) {
    const date = new Date(timestamp);
    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
  }
  return currentTimestamp();
}

function currentTimestamp(): string {
  return new Date().toISOString();
}

function parseJsonRecord(raw: string): JsonRecord | null {
  try {
    return readObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readObject(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function emptyState(): AtlasKnownOpponentHandState {
  return {
    roomCode: "",
    opponentPlayerId: "",
    activeReveal: false,
    opponentHandCount: null,
    revealedAt: "",
    updatedAt: "",
    cards: []
  };
}

function stateWithoutUpdatedAt(state: AtlasKnownOpponentHandState): AtlasKnownOpponentHandState {
  return {
    roomCode: state.roomCode,
    ...(state.gameNumber === undefined ? {} : { gameNumber: state.gameNumber }),
    opponentPlayerId: state.opponentPlayerId,
    activeReveal: state.activeReveal,
    opponentHandCount: state.opponentHandCount,
    revealedAt: state.revealedAt,
    updatedAt: "",
    cards: state.cards.map((card) => ({ ...card }))
  };
}

function immutableState(state: AtlasKnownOpponentHandState): AtlasKnownOpponentHandState {
  const cards = Object.freeze(
    state.cards.map((card) => Object.freeze({ ...card }))
  ) as unknown as AtlasKnownOpponentHandCard[];
  return Object.freeze({
    ...state,
    cards
  });
}

function sameStateContent(
  current: AtlasKnownOpponentHandState,
  candidate: AtlasKnownOpponentHandState
): boolean {
  return current.roomCode === candidate.roomCode
    && current.gameNumber === candidate.gameNumber
    && current.opponentPlayerId === candidate.opponentPlayerId
    && current.activeReveal === candidate.activeReveal
    && current.opponentHandCount === candidate.opponentHandCount
    && current.revealedAt === candidate.revealedAt
    && JSON.stringify(current.cards) === JSON.stringify(candidate.cards);
}

function isEmptyState(state: AtlasKnownOpponentHandState): boolean {
  return !state.roomCode
    && state.gameNumber === undefined
    && !state.opponentPlayerId
    && !state.activeReveal
    && state.opponentHandCount === null
    && !state.revealedAt
    && state.cards.length === 0;
}
