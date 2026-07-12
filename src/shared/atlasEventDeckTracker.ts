import {
  deckTrackerCardKey,
  deckTrackerCodeFromImage,
  normalizeDeckTrackerKey
} from "./deckTracker.js";
import { legendFromImageUrl } from "./legendImages.js";
import { canonicalLegendName } from "./legendNames.js";
import type {
  DeckTrackerSideboardChange,
  DeckTrackerObservation,
  DeckTrackerZone,
  GamePlatform,
  RawCaptureAppendFramePayload
} from "./types.js";

export type AtlasDeckTrackerDebugEvent = {
  type: string;
  action: string;
  zone: DeckTrackerZone;
  ownerPlayerId: string;
  cardKey: string;
  name: string;
  code: string;
  sourceId: string;
  ignoredReason?: string;
};

export type AtlasDeckTrackerFrameResult = {
  frameType: string;
  roomCode: string;
  phase: string;
  gameNumber?: number;
  opponentLegend: string;
  localPlayerIdHint: string;
  observations: DeckTrackerObservation[];
  opponentObservations: DeckTrackerObservation[];
  sideboardChanges: DeckTrackerSideboardChange[];
  debugEvents: AtlasDeckTrackerDebugEvent[];
  ignoredCount: number;
};

type ParserOptions = {
  localPlayerId?: string;
};

type CardRecord = {
  sourceId: string;
  name: string;
  code: string;
  cardId: string;
  imageUrl: string;
};

type ZoneEventInput = {
  type: string;
  action: string;
  ownerPlayerId: string;
  zone: string;
  cards: CardRecord[];
};

const TRACKED_FRAME_TYPES = new Set(["room_shell_sync", "authoritative_snapshot", "authoritative_patch_commit"]);

export function parseAtlasDeckTrackerFrame(
  payload: RawCaptureAppendFramePayload,
  options: ParserOptions = {}
): AtlasDeckTrackerFrameResult {
  const raw = payload.frame.raw;
  const packet = parseJsonRecord(raw);
  if (!packet) {
    return emptyResult();
  }
  const frameType = readString(packet.type);
  if (frameType && !TRACKED_FRAME_TYPES.has(frameType)) {
    return {
      ...emptyResult(),
      frameType,
      roomCode: readRoomCode(packet, payload.requestUrl),
      opponentLegend: readOpponentLegend(packet, readLocalPlayerIdHint(packet, payload)),
      localPlayerIdHint: readLocalPlayerIdHint(packet, payload)
    };
  }
  const capturedAt = new Date(Number.isFinite(payload.frame.ts) ? payload.frame.ts : Date.now()).toISOString();
  const roomCode = readRoomCode(packet, payload.requestUrl);
  const phase = readPhase(packet);
  const gameNumber = readGameNumber(packet);
  const localPlayerIdHint = readLocalPlayerIdHint(packet, payload);
  const localPlayerId = options.localPlayerId || localPlayerIdHint;
  const opponentLegend = readOpponentLegend(packet, localPlayerId);
  const debugEvents: AtlasDeckTrackerDebugEvent[] = [];
  const observations: DeckTrackerObservation[] = [];
  const opponentObservations: DeckTrackerObservation[] = [];
  const sideboardChanges: DeckTrackerSideboardChange[] = [];
  let ignoredCount = 0;

  for (const input of zoneEventsFromPacket(packet, frameType)) {
    if (input.type === "sideboard_move") {
      for (const card of input.cards) {
        const shouldIgnoreOwner = localPlayerId && input.ownerPlayerId && input.ownerPlayerId !== localPlayerId;
        const shouldIgnoreAmbiguousOwner = !localPlayerId || !input.ownerPlayerId;
        const direction = sideboardDirectionFromAction(input.action);
        const baseDebug = debugEventFromCard(input, "unknown", card);
        if (!direction) {
          ignoredCount += 1;
          debugEvents.push({ ...baseDebug, ignoredReason: "not-sideboard-deck-move" });
          continue;
        }
        if (shouldIgnoreOwner) {
          ignoredCount += 1;
          debugEvents.push({ ...baseDebug, ignoredReason: "opponent-owner" });
          continue;
        }
        if (shouldIgnoreAmbiguousOwner) {
          ignoredCount += 1;
          debugEvents.push({ ...baseDebug, ignoredReason: "waiting-for-local-player-id" });
          continue;
        }
        const cardKey = deckTrackerCardKey({
          cardId: card.cardId,
          imageUrl: card.imageUrl,
          name: card.name,
          code: card.code
        });
        if (!cardKey) {
          ignoredCount += 1;
          debugEvents.push({ ...baseDebug, ignoredReason: "missing-card-identity" });
          continue;
        }
        sideboardChanges.push({
          id: `atlas-sideboard:${direction}:${card.sourceId || card.cardId || card.code || card.name || payload.frame.seq}`,
          cardKey,
          name: card.name,
          code: card.code,
          cardId: card.cardId,
          imageUrl: card.imageUrl,
          qty: 1,
          direction,
          source: "atlas",
          gameNumber,
          capturedAt
        });
        debugEvents.push({ ...baseDebug, action: `sideboard-${direction}` });
      }
      continue;
    }
    const zone = coerceAtlasZone(input.zone);
    const setupOnlyZone = isAtlasSetupOnlyZone(input.zone);
    const shouldIgnoreHidden = zone === "unknown" || input.zone === "deck" || input.zone === "runeDeck" || setupOnlyZone;
    const isOpponentOwner = Boolean(localPlayerId && input.ownerPlayerId && input.ownerPlayerId !== localPlayerId);
    const shouldIgnoreAmbiguousOwner = !localPlayerId || !input.ownerPlayerId;
    for (const card of input.cards) {
      const baseDebug = debugEventFromCard(input, zone, card);
      if (shouldIgnoreHidden) {
        ignoredCount += 1;
        debugEvents.push({ ...baseDebug, ignoredReason: setupOnlyZone ? "setup-zone" : "hidden-or-unknown-zone" });
        continue;
      }
      if (isOpponentOwner) {
        if (!isPublicOpponentZone(zone)) {
          ignoredCount += 1;
          debugEvents.push({ ...baseDebug, ignoredReason: "opponent-hidden-zone" });
          continue;
        }
        const opponentObservation = observationFromAtlasCard(card, zone, capturedAt, payload, input.ownerPlayerId, "atlas-opponent");
        if (!opponentObservation) {
          ignoredCount += 1;
          debugEvents.push({ ...baseDebug, ignoredReason: "missing-card-identity" });
          continue;
        }
        opponentObservations.push(opponentObservation);
        debugEvents.push({ ...baseDebug, action: `${baseDebug.action}:opponent-seen` });
        continue;
      }
      if (shouldIgnoreAmbiguousOwner) {
        ignoredCount += 1;
        debugEvents.push({ ...baseDebug, ignoredReason: "waiting-for-local-player-id" });
        continue;
      }
      const observation = observationFromAtlasCard(card, zone, capturedAt, payload, input.ownerPlayerId, "atlas-event");
      if (!observation) {
        ignoredCount += 1;
        debugEvents.push({ ...baseDebug, ignoredReason: "missing-card-identity" });
        continue;
      }
      observations.push(observation);
      debugEvents.push(baseDebug);
    }
  }

  return {
    frameType,
    roomCode,
    phase,
    gameNumber,
    opponentLegend,
    localPlayerIdHint,
    observations: dedupeObservations(observations),
    opponentObservations: dedupeObservations(opponentObservations),
    sideboardChanges: dedupeSideboardChanges(sideboardChanges),
    debugEvents: debugEvents.slice(-24),
    ignoredCount
  };
}

function zoneEventsFromPacket(packet: Record<string, unknown>, frameType: string): ZoneEventInput[] {
  if (frameType === "authoritative_snapshot") {
    return zoneEventsFromSnapshot(packet);
  }
  if (frameType === "authoritative_patch_commit") {
    return zoneEventsFromPatchCommit(packet);
  }
  if (frameType === "room_shell_sync") {
    const sessionDoc = readObject(packet.sessionDoc) ?? readObject(readObject(packet.payload)?.sessionDoc);
    return sessionDoc ? zoneEventsFromSnapshot({ snapshot: sessionDoc }) : [];
  }
  return [];
}

function zoneEventsFromSnapshot(packet: Record<string, unknown>): ZoneEventInput[] {
  const snapshot = readObject(packet.snapshot) ?? packet;
  const players = readArray(snapshot.players);
  const events: ZoneEventInput[] = [];
  for (const player of players) {
    const playerRecord = readObject(player);
    const ownerPlayerId = readString(playerRecord?.id);
    const board = readObject(playerRecord?.board);
    if (!ownerPlayerId || !board) {
      continue;
    }
    for (const [zone, value] of Object.entries(board)) {
      const cards = readArray(value)
        .map(readCardRecord)
        .filter((card): card is CardRecord => Boolean(card && !isPlaceholderCard(card)));
      if (cards.length) {
        events.push({ type: "snapshot", action: "zone-snapshot", ownerPlayerId, zone, cards });
      }
    }
  }
  return events;
}

function zoneEventsFromPatchCommit(packet: Record<string, unknown>): ZoneEventInput[] {
  const patch = readObject(packet.patch);
  const operations = readArray(patch?.operations);
  const events: ZoneEventInput[] = [];
  for (const value of operations) {
    const op = readObject(value);
    if (!op) {
      continue;
    }
    const opKind = readString(op.op);
    if (opKind === "zone_insert") {
      const ownerPlayerId = readString(op.playerId);
      const zone = readString(op.zone);
      const cards = readArray(op.cards)
        .map(readCardRecord)
        .filter((card): card is CardRecord => Boolean(card && !isPlaceholderCard(card)));
      if (ownerPlayerId && zone && cards.length) {
        events.push({ type: opKind, action: "insert", ownerPlayerId, zone, cards });
      }
    } else if (opKind === "zone_move") {
      const to = readObject(op.to);
      const from = readObject(op.from);
      const ownerPlayerId = readString(to?.playerId) || readString(from?.playerId) || readString(readObject(op.card)?.ownerPlayerId);
      const zone = readString(to?.zone) || readString(from?.zone);
      const card = readCardRecord(op.card) ?? placeholderCardFromId(readString(op.cardId));
      const fromZone = readString(from?.zone);
      const toZone = readString(to?.zone);
      const sideboardAction = sideboardMoveAction(fromZone, toZone);
      if (ownerPlayerId && sideboardAction && card && !isPlaceholderCard(card)) {
        events.push({ type: "sideboard_move", action: sideboardAction, ownerPlayerId, zone: toZone || fromZone, cards: [card] });
        continue;
      }
      if (ownerPlayerId && zone && card && !isPlaceholderCard(card)) {
        events.push({ type: opKind, action: "move", ownerPlayerId, zone, cards: [card] });
      }
    } else if (opKind === "chain_insert") {
      for (const entryValue of readArray(op.entries)) {
        const entry = readObject(entryValue);
        const ownerPlayerId = readString(entry?.byPlayerId) || readString(readObject(entry?.card)?.ownerPlayerId);
        const card = readCardRecord(entry?.card);
        const sourceCardId = readString(entry?.sourceCardId);
        if (card && sourceCardId) {
          card.sourceId = sourceCardId;
        }
        if (ownerPlayerId && card && !isPlaceholderCard(card)) {
          events.push({ type: opKind, action: "chain", ownerPlayerId, zone: "stack", cards: [card] });
        }
      }
    }
  }
  return events;
}

function readLocalPlayerIdHint(packet: Record<string, unknown>, payload: RawCaptureAppendFramePayload): string {
  const action = readObject(packet.action);
  const sessionDoc = readObject(packet.sessionDoc) ?? readObject(readObject(packet.payload)?.sessionDoc);
  const viewer = readObject(sessionDoc?.viewer);
  const selfPlayer = readObject(sessionDoc?.selfPlayer);
  return readString(packet.actorPlayerId)
    || readString(packet.playerId)
    || readString(packet.byPlayerId)
    || readString(action?.playerId)
    || readString(action?.byPlayerId)
    || readString(action?.actorPlayerId)
    || readString(viewer?.playerId)
    || readString(selfPlayer?.id)
    || readPlayerIdFromUrl(payload.requestUrl || "");
}

function readRoomCode(packet: Record<string, unknown>, requestUrl = ""): string {
  const sessionDoc = readObject(packet.sessionDoc) ?? readObject(readObject(packet.payload)?.sessionDoc) ?? readObject(packet.snapshot);
  return readString(packet.roomCode)
    || readString(packet.gameInstanceId)
    || readString(sessionDoc?.roomCode)
    || readString(sessionDoc?.gameInstanceId)
    || readRoomCodeFromUrl(requestUrl);
}

function readPhase(packet: Record<string, unknown>): string {
  const sessionDoc = readObject(packet.sessionDoc) ?? readObject(readObject(packet.payload)?.sessionDoc) ?? readObject(packet.snapshot);
  return readString(sessionDoc?.phase) || readString(sessionDoc?.state) || readString(sessionDoc?.status);
}

function readGameNumber(packet: Record<string, unknown>): number | undefined {
  const sessionDoc = readObject(packet.sessionDoc) ?? readObject(readObject(packet.payload)?.sessionDoc) ?? readObject(packet.snapshot);
  const value = Number(sessionDoc?.gameNumber ?? sessionDoc?.game_number ?? sessionDoc?.game);
  return Number.isFinite(value) ? value : undefined;
}

function readOpponentLegend(packet: Record<string, unknown>, localPlayerId: string): string {
  const payload = readObject(packet.payload);
  const sessionDoc = readObject(packet.sessionDoc) ?? readObject(payload?.sessionDoc);
  const snapshot = readObject(packet.snapshot) ?? sessionDoc ?? payload ?? packet;
  const direct = firstCanonicalLegend([
    packet.opponentLegend,
    packet.opponentChampion,
    packet.oppLegend,
    packet.oppChampion,
    payload?.opponentLegend,
    payload?.opponentChampion,
    sessionDoc?.opponentLegend,
    sessionDoc?.opponentChampion,
    sessionDoc?.enemyLegend,
    sessionDoc?.enemyChampion,
    snapshot?.opponentLegend,
    snapshot?.opponentChampion
  ]);
  if (direct) {
    return direct;
  }
  const directImage = firstLegendFromImage([
    packet.opponentLegendImage,
    packet.opponentChampionImage,
    payload?.opponentLegendImage,
    payload?.opponentChampionImage,
    sessionDoc?.opponentLegendImage,
    sessionDoc?.opponentChampionImage,
    snapshot?.opponentLegendImage,
    snapshot?.opponentChampionImage
  ]);
  if (directImage) {
    return directImage;
  }
  return readOpponentLegendFromPlayers(snapshot, localPlayerId)
    || readOpponentLegendFromPlayers(sessionDoc, localPlayerId)
    || "";
}

function readOpponentLegendFromPlayers(container: Record<string, unknown> | null, localPlayerId: string): string {
  if (!container || !localPlayerId) {
    return "";
  }
  for (const playerValue of readPlayerRecords(container.players)) {
    const player = readObject(playerValue);
    if (!player) {
      continue;
    }
    const playerId = readString(player.id) || readString(player.playerId) || readString(player.userId);
    if (playerId && playerId === localPlayerId) {
      continue;
    }
    const legend = readLegendFromPlayer(player);
    if (legend) {
      return legend;
    }
  }
  return "";
}

function readLegendFromPlayer(player: Record<string, unknown>): string {
  const direct = firstCanonicalLegend([
    player.legend,
    player.champion,
    player.leader,
    player.selectedLegend,
    player.selectedChampion,
    player.legendName,
    player.championName,
    player.leaderName,
    nestedValue(player, ["legend", "name"]),
    nestedValue(player, ["legend", "title"]),
    nestedValue(player, ["champion", "name"]),
    nestedValue(player, ["champion", "title"]),
    nestedValue(player, ["leader", "name"]),
    nestedValue(player, ["leader", "title"]),
    nestedValue(player, ["selectedLegend", "name"]),
    nestedValue(player, ["selectedChampion", "name"])
  ]);
  if (direct) {
    return direct;
  }
  return firstLegendFromImage([
    player.legendImage,
    player.championImage,
    player.leaderImage,
    player.legendImageUrl,
    player.championImageUrl,
    player.leaderImageUrl,
    nestedValue(player, ["legend", "imageUrl"]),
    nestedValue(player, ["legend", "image_url"]),
    nestedValue(player, ["champion", "imageUrl"]),
    nestedValue(player, ["champion", "image_url"]),
    nestedValue(player, ["leader", "imageUrl"]),
    nestedValue(player, ["leader", "image_url"])
  ]);
}

function readCardRecord(value: unknown): CardRecord | null {
  const record = readObject(value);
  if (!record) {
    return null;
  }
  const sourceId = readString(record.id) || readString(record.cardId);
  const cardId = readString(record.cardCode) || readString(record.cardId) || readString(record.definitionId);
  const imageUrl = readString(record.imageUrl) || readString(record.image_url) || readString(record.artUrl);
  const code = readString(record.cardCode) || deckTrackerCodeFromImage(imageUrl) || deckTrackerCodeFromImage(cardId);
  const name = readString(record.name) || readString(record.title);
  return { sourceId, name, code, cardId, imageUrl };
}

function placeholderCardFromId(sourceId: string): CardRecord | null {
  return sourceId ? { sourceId, name: "", code: "", cardId: "", imageUrl: "" } : null;
}

function isPlaceholderCard(card: CardRecord): boolean {
  return Boolean(card.sourceId && !card.name && !card.code && !card.cardId && !card.imageUrl);
}

function debugEventFromCard(input: ZoneEventInput, zone: DeckTrackerZone, card: CardRecord): AtlasDeckTrackerDebugEvent {
  const code = card.code || deckTrackerCodeFromImage(card.imageUrl) || deckTrackerCodeFromImage(card.cardId);
  return {
    type: input.type,
    action: input.action,
    zone,
    ownerPlayerId: input.ownerPlayerId,
    cardKey: normalizeDeckTrackerKey(card.cardId || code || card.name || card.sourceId),
    name: card.name || code || card.cardId || card.sourceId || "Unknown card",
    code,
    sourceId: card.sourceId
  };
}

function observationFromAtlasCard(
  card: CardRecord,
  zone: DeckTrackerZone,
  capturedAt: string,
  payload: RawCaptureAppendFramePayload,
  ownerPlayerId: string,
  framePrefix: string
): DeckTrackerObservation | null {
  const cardKey = deckTrackerCardKey({
    cardId: card.cardId,
    imageUrl: card.imageUrl,
    name: card.name,
    code: card.code
  });
  if (!cardKey) {
    return null;
  }
  const instanceId = normalizeDeckTrackerKey(card.sourceId || `${ownerPlayerId}:${cardKey}:${zone}`);
  return {
    cardKey,
    name: card.name,
    code: card.code,
    cardId: card.cardId,
    imageUrl: card.imageUrl,
    zone,
    count: 1,
    platform: "atlas",
    confidence: card.code || card.cardId || card.name ? "tracked" : "estimated",
    capturedAt,
    source: "event",
    confidenceScore: card.code || card.cardId ? 0.98 : 0.82,
    frameId: `${framePrefix}:${card.sourceId || card.cardId || card.code || card.name || payload.frame.seq}`,
    instanceId,
    ownerPlayerId
  };
}

function coerceAtlasZone(value: string): DeckTrackerZone {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  if (lower === "hand") {
    return "hand";
  }
  if (lower === "base") {
    return "base";
  }
  if (
    lower === "battlefield"
    || lower === "battlefielda"
    || lower === "battlefieldb"
    || lower === "battlefieldtoken"
    || lower === "board"
    || lower === "units"
  ) {
    return "board";
  }
  if (lower === "stack" || lower === "chain") {
    return "stack";
  }
  if (lower === "trash" || lower === "discard" || lower === "graveyard" || lower === "banished") {
    return "trash";
  }
  return "unknown";
}

function isAtlasSetupOnlyZone(value: string): boolean {
  const normalized = normalizeZoneName(value);
  return normalized === "champion"
    || normalized === "championzone"
    || normalized === "legend"
    || normalized === "legendzone"
    || normalized === "leader"
    || normalized === "leaderzone"
    || normalized === "selectedchampion"
    || normalized === "selectedlegend";
}

function isPublicOpponentZone(zone: DeckTrackerZone): boolean {
  return zone === "board" || zone === "base" || zone === "stack" || zone === "trash" || zone === "discard";
}

function sideboardMoveAction(fromZone: string, toZone: string): string {
  const from = normalizeZoneName(fromZone);
  const to = normalizeZoneName(toZone);
  if (from === "sideboard" && isDeckZone(to)) {
    return "sideboard-in";
  }
  if (isDeckZone(from) && to === "sideboard") {
    return "sideboard-out";
  }
  return "";
}

function isDeckZone(value: string): boolean {
  return value === "deck"
    || value === "main"
    || value === "maindeck"
    || value === "library"
    || value === "drawdeck"
    || value === "deckzone";
}

function sideboardDirectionFromAction(action: string): DeckTrackerSideboardChange["direction"] | "" {
  if (action === "sideboard-in") {
    return "in";
  }
  if (action === "sideboard-out") {
    return "out";
  }
  return "";
}

function normalizeZoneName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function dedupeObservations(observations: DeckTrackerObservation[]): DeckTrackerObservation[] {
  const seen = new Set<string>();
  const deduped: DeckTrackerObservation[] = [];
  for (const observation of observations) {
    const key = [
      observation.cardKey,
      observation.cardId,
      observation.code,
      observation.name,
      observation.zone,
      observation.frameId
    ].map((part) => normalizeDeckTrackerKey(part || "")).join(":");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(observation);
  }
  return deduped;
}

function dedupeSideboardChanges(changes: DeckTrackerSideboardChange[]): DeckTrackerSideboardChange[] {
  const seen = new Set<string>();
  const deduped: DeckTrackerSideboardChange[] = [];
  for (const change of changes) {
    const key = [
      change.id,
      change.direction,
      change.cardKey,
      change.cardId,
      change.code,
      change.name
    ].map((part) => normalizeDeckTrackerKey(part || "")).join(":");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(change);
  }
  return deduped;
}

function emptyResult(): AtlasDeckTrackerFrameResult {
  return {
    frameType: "",
    roomCode: "",
    phase: "",
    opponentLegend: "",
    localPlayerIdHint: "",
    observations: [],
    opponentObservations: [],
    sideboardChanges: [],
    debugEvents: [],
    ignoredCount: 0
  };
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return readObject(parsed);
  } catch {
    return null;
  }
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readPlayerRecords(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const record = readObject(value);
  return record ? Object.values(record) : [];
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstCanonicalLegend(values: unknown[]): string {
  for (const value of values) {
    const legend = canonicalLegendName(value);
    if (legend) {
      return legend;
    }
  }
  return "";
}

function firstLegendFromImage(values: unknown[]): string {
  for (const value of values) {
    const legend = canonicalLegendName(legendFromImageUrl(value));
    if (legend) {
      return legend;
    }
  }
  return "";
}

function nestedValue(record: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function readPlayerIdFromUrl(value: string): string {
  return readQueryParam(value, "playerId");
}

function readRoomCodeFromUrl(value: string): string {
  return readQueryParam(value, "roomCode");
}

function readQueryParam(value: string, key: string): string {
  if (!value) {
    return "";
  }
  try {
    const parsed = new URL(value);
    return parsed.searchParams.get(key)?.trim() || "";
  } catch {
    const match = new RegExp(`[?&]${key}=([^&]+)`).exec(value);
    return match ? decodeURIComponent(match[1] || "").trim() : "";
  }
}
