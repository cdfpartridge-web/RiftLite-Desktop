export type RiftLiteReplayStage = "matchup" | "battlefields" | "initiative" | "mulligan" | "openingHands" | "board";
export type RiftLiteReplaySide = "local" | "opponent";

export interface RiftLiteReplayInitiativeState {
  localRoll?: number;
  opponentRoll?: number;
  firstPlayerName?: string;
  choosingPlayerName?: string;
  message?: string;
}

export interface RiftLiteReplayMulliganState {
  localCardsSeen?: number;
  opponentCardsSeen?: number;
  localOriginalHand?: RiftLiteReplayCard[];
  localFinalHand?: RiftLiteReplayCard[];
  localMulliganedCards?: RiftLiteReplayCard[];
  localAddedCards?: RiftLiteReplayCard[];
  opponentOriginalHandCount?: number;
  opponentFinalHandCount?: number;
  localMulligans?: number;
  opponentMulligans?: number;
  localKept?: boolean;
  opponentKept?: boolean;
  message?: string;
}

export interface RiftLiteReplayCard {
  id: string;
  key: string;
  name: string;
  code: string;
  imageUrl: string;
  zone: string;
  ownerId: string;
  side: RiftLiteReplaySide;
  battlefieldZone?: string;
  faceDown?: boolean;
  exhausted?: boolean;
  count?: number;
}

export interface RiftLiteReplayZone {
  id: string;
  label: string;
  cards: RiftLiteReplayCard[];
  count?: number;
}

export interface RiftLiteReplayPlayer {
  id: string;
  name: string;
  side: RiftLiteReplaySide;
  legend?: RiftLiteReplayCard;
  champion?: RiftLiteReplayCard;
  selectedBattlefield?: RiftLiteReplayCard;
  score: number;
  maxScore?: number;
  deckCount?: number;
  runeCount?: number;
  zones: Record<string, RiftLiteReplayZone>;
}

export interface RiftLiteReplayEvent {
  id: string;
  frameIndex: number;
  ts?: number;
  timeLabel: string;
  label: string;
  detail?: string;
  type: string;
  playerId?: string;
  playerName?: string;
  card?: RiftLiteReplayCard;
}

export interface RiftLiteReplayFrame {
  id: string;
  index: number;
  stage: RiftLiteReplayStage;
  ts?: number;
  label: string;
  headline?: string;
  subline?: string;
  badges?: string[];
  initiative?: RiftLiteReplayInitiativeState;
  mulligan?: RiftLiteReplayMulliganState;
  turn?: number;
  gameNumber?: number;
  focusedCard?: RiftLiteReplayCard;
  local: RiftLiteReplayPlayer;
  opponent: RiftLiteReplayPlayer;
  chain: RiftLiteReplayCard[];
  events: RiftLiteReplayEvent[];
}

export interface RiftLiteReplayModel {
  id: string;
  title: string;
  roomCode?: string;
  captureSessionId?: string;
  startedAt?: number;
  endedAt?: number;
  matchFormat?: string;
  messageCount: number;
  diagnostics: string[];
  frames: RiftLiteReplayFrame[];
  events: RiftLiteReplayEvent[];
  players: RiftLiteReplayPlayer[];
}

export interface RiftLiteReplayBuildFallback {
  id?: string;
  title?: string;
  localName?: string;
  opponentName?: string;
  localLegend?: string;
  opponentLegend?: string;
  format?: string;
}

interface RawReplayMessage {
  seq?: number;
  ts?: number;
  dir?: string;
  type?: string;
  raw?: string;
  parsed?: unknown;
  data?: unknown;
}

interface PacketContext {
  index: number;
  message: RawReplayMessage;
  packet: Record<string, unknown>;
  type: string;
}

interface MutableCard extends RiftLiteReplayCard {}

interface MutablePlayer {
  id: string;
  name: string;
  side: RiftLiteReplaySide;
  legend?: MutableCard;
  champion?: MutableCard;
  selectedBattlefield?: MutableCard;
  knownCards: MutableCard[];
  score: number;
  maxScore?: number;
  deckCount?: number;
  runeCount?: number;
  zones: Record<string, RiftLiteReplayZone>;
}

interface ReplayState {
  localId: string;
  opponentId: string;
  players: Map<string, MutablePlayer>;
  events: RiftLiteReplayEvent[];
  frames: RiftLiteReplayFrame[];
  chain: MutableCard[];
  turn?: number;
  gameNumber?: number;
  roomCode: string;
  format: string;
  focusedCard?: MutableCard;
  diagnostics: string[];
  shellStateHydrated: boolean;
  localRoll?: number;
  opponentRoll?: number;
  firstPlayerName?: string;
}

interface IntroInsights {
  initiative: RiftLiteReplayInitiativeState;
  mulligan: RiftLiteReplayMulliganState;
}

const CARD_IMAGE_BASE = "https://cdn.piltoverarchive.com/cards/";
const DEFAULT_LOCAL_ID = "local";
const DEFAULT_OPPONENT_ID = "opponent";

const ZONE_LABELS: Record<string, string> = {
  base: "Base",
  bases: "Base",
  battlefield: "Battlefield",
  battlefields: "Battlefield",
  board: "Board",
  champion: "Champion",
  champions: "Champion",
  chain: "Chain",
  deck: "Deck",
  discard: "Trash",
  hand: "Hand",
  legend: "Legend",
  legends: "Legend",
  mainDeck: "Deck",
  opponentBattlefield: "Opponent battlefield",
  played: "Played",
  removed: "Removed",
  rune: "Runes",
  runes: "Runes",
  runeDeck: "Runes",
  sideboard: "Sideboard",
  stack: "Chain",
  trash: "Trash"
};

export function buildRiftLiteReplayModelFromText(input: string, fallback: RiftLiteReplayBuildFallback = {}): RiftLiteReplayModel {
  return buildRiftLiteReplayModel(JSON.parse(input) as unknown, fallback);
}

export function buildRiftLiteReplayModel(payload: unknown, fallback: RiftLiteReplayBuildFallback = {}): RiftLiteReplayModel {
  const root = asRecord(payload);
  if (!root) {
    throw new Error("Replay payload must be a JSON object.");
  }
  const messages = extractRawMessages(root);
  if (!messages.length) {
    throw new Error("No raw Atlas WebSocket frames were found in this replay.");
  }

  const capture = asRecord(root.capture);
  const identity = asRecord(capture?.identity);
  const lifecycle = asRecord(capture?.lifecycle);
  const sorted = messages
    .map((message, index) => ({ ...message, seq: typeof message.seq === "number" ? message.seq : index }))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  const state: ReplayState = {
    localId: DEFAULT_LOCAL_ID,
    opponentId: DEFAULT_OPPONENT_ID,
    players: new Map(),
    events: [],
    frames: [],
    chain: [],
    roomCode: readString(identity?.roomCode),
    format: readString(lifecycle?.matchFormat) || fallback.format || "",
    diagnostics: [],
    shellStateHydrated: false
  };
  ensurePlayer(state, DEFAULT_LOCAL_ID, fallback.localName || "You", "local");
  ensurePlayer(state, DEFAULT_OPPONENT_ID, fallback.opponentName || "Opponent", "opponent");
  if (fallback.localLegend) {
    ensurePlayer(state, DEFAULT_LOCAL_ID, fallback.localName || "You", "local").legend = cardFromLoose(
      { name: fallback.localLegend },
      DEFAULT_LOCAL_ID,
      "legend",
      "local"
    );
  }
  if (fallback.opponentLegend) {
    ensurePlayer(state, DEFAULT_OPPONENT_ID, fallback.opponentName || "Opponent", "opponent").legend = cardFromLoose(
      { name: fallback.opponentLegend },
      DEFAULT_OPPONENT_ID,
      "legend",
      "opponent"
    );
  }

  const replayMessages = sorted.filter(isReplayTimelineMessage);
  const messagesToParse = replayMessages.length ? replayMessages : sorted;

  for (let index = 0; index < messagesToParse.length; index += 1) {
    const message = messagesToParse[index];
    const parsed = parseMessagePacket(message);
    if (!parsed) {
      state.diagnostics.push(`Skipped unreadable frame ${index}.`);
      continue;
    }
    const type = readString(parsed.type) || readString(parsed.t) || "unknown";
    const context: PacketContext = { index, message, packet: parsed, type };
    if (type === "room_shell_sync") {
      applyRoomShellSync(state, context);
      continue;
    }
    if (type === "authoritative_snapshot" || type === "snapshot") {
      applySnapshot(state, context);
      continue;
    }
    if (type === "authoritative_patch_commit" || type === "patch_commit") {
      applyPatchCommit(state, context);
      continue;
    }
    if (type === "chat_append" || type === "chat_message") {
      pushChatEvent(state, context);
      continue;
    }
  }

  if (!state.frames.length) {
    pushFrame(state, "board", "Replay loaded", undefined, messagesToParse[0]?.ts ?? sorted[0]?.ts);
  }

  const liveFrames = state.frames.map((frame, index) => ({ ...frame, index }));
  const introBase = introBaseFrame(liveFrames);
  const playableLiveFrames = liveFramesAfterIntro(liveFrames, introBase);
  const introFrames = buildIntroFrames(state, introBase, liveFrames[0]?.ts ?? messagesToParse[0]?.ts ?? sorted[0]?.ts);
  const frameIndexMap = buildPlayableFrameIndexMap(playableLiveFrames, introFrames.length);
  const frames = [...introFrames, ...playableLiveFrames].map((frame, index) => ({
    ...frame,
    index,
    id: `frame-${index}`,
    events: frame.events.map((event) => remapReplayEventFrameIndex(event, frameIndexMap, introFrames.length))
  }));
  const events = state.events.map((event) => remapReplayEventFrameIndex(event, frameIndexMap, introFrames.length));
  const players = [clonePlayer(getPlayer(state, state.opponentId, "opponent")), clonePlayer(getPlayer(state, state.localId, "local"))];
  const title = fallback.title || buildTitle(players, state.roomCode);
  return {
    id: fallback.id || readString(capture?.captureSessionId) || `riftlite-replay-${Date.now()}`,
    title,
    roomCode: state.roomCode || readString(identity?.roomCode) || undefined,
    captureSessionId: readString(capture?.captureSessionId) || undefined,
    startedAt: readNumber(identity?.firstSeenAt) ?? sorted[0]?.ts,
    endedAt: readNumber(identity?.lastSeenAt) ?? sorted[sorted.length - 1]?.ts,
    matchFormat: state.format || fallback.format || undefined,
    messageCount: sorted.length,
    diagnostics: state.diagnostics,
    frames,
    events,
    players
  };
}

function applyRoomShellSync(state: ReplayState, context: PacketContext): void {
  const payload = asRecord(context.packet.payload);
  const sessionDoc = asRecord(context.packet.sessionDoc) ?? asRecord(payload?.sessionDoc) ?? context.packet;
  const roomCode = readStringDeep(sessionDoc, ["roomCode", "room_code", "gameInstanceId"]) || readStringDeep(context.packet, ["roomCode", "room_code"]);
  state.roomCode = roomCode || state.roomCode;
  state.format = readStringDeep(sessionDoc, ["matchFormat", "format", "queueType", "queue"]) || state.format;
  state.gameNumber = readNumberDeep(sessionDoc, ["gameNumber", "game_number", "game"]) ?? state.gameNumber;
  state.turn = readNumberDeep(sessionDoc, ["turn", "turnNumber", "round"]) ?? state.turn;
  if (!state.shellStateHydrated) {
    seedSessionPlayers(state, sessionDoc, true);
    collectPlayers(state, sessionDoc);
    collectLooseZones(state, sessionDoc);
    state.shellStateHydrated = true;
  } else {
    seedSessionPlayers(state, sessionDoc, false);
  }
  pushEvent(state, context, "Room update", roomDetail(sessionDoc), undefined);
  pushFrame(state, "board", phaseLabel(sessionDoc, state), undefined, context.message.ts);
}

function applySnapshot(state: ReplayState, context: PacketContext): void {
  const snapshot = asRecord(context.packet.snapshot) ?? asRecord(context.packet.state) ?? asRecord(context.packet.payload) ?? context.packet;
  collectPlayers(state, snapshot);
  collectLooseZones(state, snapshot);
  collectBoardObjects(state, snapshot);
  pushEvent(state, context, "Board snapshot", snapshotSummary(snapshot), undefined);
  pushFrame(state, "board", "Board snapshot", state.focusedCard, context.message.ts);
}

function applyPatchCommit(state: ReplayState, context: PacketContext): void {
  const patchRoots = [
    context.packet.patch,
    context.packet.patches,
    context.packet.ops,
    context.packet.operations,
    asRecord(context.packet.patch)?.operations,
    asRecord(context.packet.patch)?.ops,
    asRecord(context.packet.payload)?.patches,
    asRecord(context.packet.payload)?.ops,
    asRecord(asRecord(context.packet.payload)?.patch)?.operations
  ];
  let applied = false;
  for (const root of patchRoots) {
    const ops = flattenRecords(root);
    for (const op of ops) {
      if (applyPatchOperation(state, op, context)) {
        applied = true;
      }
    }
  }
  collectPlayers(state, context.packet);
  collectLooseZones(state, context.packet);
  collectBoardObjects(state, context.packet);
  if (!applied) {
    const card = findFirstCard(context.packet, getPlayer(state, state.localId, "local").id, "played", "local");
    if (card) {
      state.focusedCard = card;
      pushEvent(state, context, "Card update", card.name || card.code || "Card moved", card);
    } else {
      pushEvent(state, context, "Game update", prettifyType(context.type), undefined);
    }
  }
  pushFrame(state, "board", state.events[state.events.length - 1]?.label || "Game update", state.focusedCard, context.message.ts);
}

function applyPatchOperation(state: ReplayState, op: Record<string, unknown>, context: PacketContext): boolean {
  const action = readStringDeep(op, ["op", "type", "action", "kind"]);
  const lowerAction = action.toLowerCase();
  if (lowerAction === "set_room_fields") {
    return applyRoomFields(state, asRecord(op.fields), context);
  }
  if (lowerAction === "set_player_fields") {
    return applyPlayerFields(state, op, context);
  }
  if (lowerAction === "set_board_fields") {
    return applyBoardFields(state, op, context);
  }
  if (lowerAction === "zone_remove") {
    return applyZoneRemove(state, op, context);
  }
  if (lowerAction === "zone_insert") {
    return applyZoneInsert(state, op, context);
  }
  if (lowerAction === "zone_move") {
    return applyZoneMove(state, op, context);
  }
  if (lowerAction === "patch_card_fields") {
    return applyCardPatch(state, op, context);
  }
  if (lowerAction === "chain_insert" || lowerAction === "chain_replace") {
    return applyChainSet(state, op, context, lowerAction === "chain_replace");
  }
  if (lowerAction === "chain_remove") {
    return applyChainRemove(state, op, context);
  }
  if (lowerAction === "log_insert") {
    return applyLogInsert(state, op, context);
  }
  const toRecord = asRecord(op.to);
  const rawZone = readStringDeep(toRecord ?? op, ["zone", "toZone", "targetZone", "zoneName", "path"]);
  const zone = normalizeZone(rawZone);
  const ownerId = resolveOwnerId(state, op);
  const side = ownerId === state.opponentId ? "opponent" : "local";
  const score = readNumberDeep(op, ["score", "points", "value"]);
  if (Number.isFinite(score) && lowerAction.includes("score")) {
    getPlayer(state, ownerId, side).score = Number(score);
    pushEvent(state, context, "Score update", `${getPlayer(state, ownerId, side).name}: ${score}`, undefined);
    return true;
  }
  const card = findFirstCard(op, ownerId, zone || "played", side);
  if (!card) {
    return false;
  }
  state.focusedCard = card;
  if (zone === "chain" || lowerAction.includes("chain")) {
    upsertCardList(state.chain, card);
  } else {
    addCardToPlayerZone(getPlayer(state, ownerId, side), zone || card.zone || "played", card);
  }
  applyCountHintForMove(getPlayer(state, ownerId, side), op, zone || card.zone || "played", card.count);
  pushEvent(state, context, eventLabelForZone(zone || card.zone), `${getPlayer(state, ownerId, side).name} ${card.name}`, card);
  return true;
}

function seedSessionPlayers(state: ReplayState, root: Record<string, unknown>, hydrateZones: boolean): void {
  const self = asRecord(root.selfPlayer) ?? asRecord(root.viewer);
  const opponent = asRecord(root.opponentPlayer) ?? asRecord(root.opponent);
  if (self) {
    const id = readStringDeep(self, ["id", "playerId", "uid", "userId"]) || state.localId;
    const name = readStringDeep(self, ["name", "displayName", "username", "handle", "playerName"]) || "You";
    const player = ensurePlayer(state, id, name, "local");
    player.name = cleanPlayerName(name, player.name);
    const board = asRecord(self.board);
    if (hydrateZones && board) collectLooseZonesForPlayer(player, board, "local");
    collectDeckSectionsForPlayer(player, self, "local");
  }
  if (opponent) {
    const id = readStringDeep(opponent, ["id", "playerId", "uid", "userId"]) || state.opponentId;
    const name = readStringDeep(opponent, ["name", "displayName", "username", "handle", "playerName"]) || "Opponent";
    const player = ensurePlayer(state, id, name, "opponent");
    player.name = cleanPlayerName(name, player.name);
    const board = asRecord(opponent.board);
    if (hydrateZones && board) collectLooseZonesForPlayer(player, board, "opponent");
    collectDeckSectionsForPlayer(player, opponent, "opponent");
  }
}

function applyRoomFields(state: ReplayState, fields: Record<string, unknown> | null, context: PacketContext): boolean {
  if (!fields) return false;
  state.turn = readNumberDeep(fields, ["turnNumber", "turn", "round"]) ?? state.turn;
  state.gameNumber = readNumberDeep(fields, ["gameNumber", "game_number", "game"]) ?? state.gameNumber;
  state.format = readStringDeep(fields, ["matchFormat", "format", "queueType", "queue"]) || state.format;
  const phase = readStringDeep(fields, ["phase", "state", "status"]);
  captureInitiativeFields(state, fields, context);
  pushEvent(state, context, "Room update", phase ? `Phase ${phase}` : "Room state updated", undefined);
  return true;
}

function captureInitiativeFields(state: ReplayState, fields: Record<string, unknown>, context: PacketContext): void {
  const initiative = asRecord(fields.initiative) || asRecord(fields.initiativeState);
  const rollSources = [
    fields.initiativeRolls,
    fields.rolls,
    fields.diceRolls,
    fields.d20Rolls,
    initiative?.rolls,
    initiative?.initiativeRolls
  ];
  for (const source of rollSources) {
    for (const entry of rollEntries(source)) {
      const value = rollValueFromUnknown(entry.value);
      if (!Number.isFinite(value)) continue;
      const player = resolveRollPlayer(state, entry.key, asRecord(entry.value));
      if (!player) continue;
      if (player.side === "local") {
        state.localRoll = value;
      } else if (player.side === "opponent") {
        state.opponentRoll = value;
      }
      pushEvent(state, context, "Initiative roll", `${player.name} rolled ${value}`, undefined, player.id);
    }
  }

  const firstPlayerKey = readStringDeep(fields, [
    "firstPlayerId",
    "startingPlayerId",
    "firstPlayer",
    "startingPlayer",
    "goesFirstPlayerId",
    "firstPlayerName",
    "startingPlayerName"
  ]);
  const firstPlayer = resolveRollPlayer(state, firstPlayerKey, fields);
  if (firstPlayer) {
    state.firstPlayerName = firstPlayer.name;
  } else if (firstPlayerKey) {
    state.firstPlayerName = firstPlayerKey;
  }
}

function rollEntries(source: unknown): Array<{ key: string; value: unknown }> {
  if (Array.isArray(source)) {
    return source.map((value, index) => ({ key: String(index), value }));
  }
  const record = asRecord(source);
  return record ? Object.entries(record).map(([key, value]) => ({ key, value })) : [];
}

function rollValueFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  const record = asRecord(value);
  if (!record) return undefined;
  return readNumberDeep(record, ["roll", "value", "result", "total", "d20", "dice"]);
}

function resolveRollPlayer(state: ReplayState, key: string, value?: Record<string, unknown> | null): MutablePlayer | undefined {
  const candidates = [
    key,
    readStringDeep(value, ["playerId", "ownerPlayerId", "userId", "uid", "id"]),
    readStringDeep(value, ["playerName", "name", "displayName", "username", "handle"]),
    readStringDeep(value, ["side", "role"])
  ].filter(Boolean);
  for (const candidate of candidates) {
    const exact = state.players.get(candidate);
    if (exact) return exact;
    const normalized = normalizeText(candidate);
    if (["local", "self", "you", "me", "player"].includes(normalized)) return getPlayer(state, state.localId, "local");
    if (["opponent", "opp", "enemy"].includes(normalized)) return getPlayer(state, state.opponentId, "opponent");
    for (const player of state.players.values()) {
      if (normalizeText(player.id) === normalized || normalizeText(player.name) === normalized) {
        return player;
      }
    }
  }
  return undefined;
}

function applyPlayerFields(state: ReplayState, op: Record<string, unknown>, context: PacketContext): boolean {
  const fields = asRecord(op.fields);
  const ownerId = readStringDeep(op, ["playerId", "ownerPlayerId", "userId"]) || resolveOwnerId(state, op);
  const player = getPlayer(state, ownerId, ownerId === state.opponentId ? "opponent" : "local");
  if (!fields) return false;
  const score = readNumberDeep(fields, ["score", "points", "victoryPoints"]);
  if (Number.isFinite(score)) player.score = Number(score);
  const selectedBattlefield = selectedBattlefieldFromFields(fields, player);
  if (selectedBattlefield) {
    setSelectedBattlefield(player, selectedBattlefield);
    pushEvent(state, context, "Battlefield selected", `${player.name}: ${selectedBattlefield.name}`, selectedBattlefield, player.id);
  }
  const board = asRecord(fields.board);
  if (board) collectLooseZonesForPlayer(player, board, player.side);
  collectDeckSectionsForPlayer(player, fields, player.side);
  pushEvent(state, context, "Player update", `${player.name} updated`, undefined, player.id);
  return true;
}

function applyBoardFields(state: ReplayState, op: Record<string, unknown>, context: PacketContext): boolean {
  const fields = asRecord(op.fields);
  const ownerId = readStringDeep(op, ["playerId", "ownerPlayerId", "userId"]) || resolveOwnerId(state, op);
  const player = getPlayer(state, ownerId, ownerId === state.opponentId ? "opponent" : "local");
  if (!fields) return false;
  player.score = readNumberDeep(fields, ["score", "points", "victoryPoints"]) ?? player.score;
  collectLooseZonesForPlayer(player, fields, player.side);
  pushEvent(state, context, "Board update", `${player.name}: ${player.score}/${player.maxScore ?? 8}`, undefined, player.id);
  return true;
}

function applyZoneRemove(state: ReplayState, op: Record<string, unknown>, context: PacketContext): boolean {
  const ownerId = readStringDeep(op, ["playerId", "ownerPlayerId", "userId"]) || resolveOwnerId(state, op);
  const player = getPlayer(state, ownerId, ownerId === state.opponentId ? "opponent" : "local");
  const zoneId = normalizeZone(readStringDeep(op, ["zone", "fromZone", "sourceZone"]));
  const cardIds = readStringArray(op.cardIds);
  if (!zoneId || !cardIds.length) return false;
  removeCardsFromPlayerZone(player, zoneId, cardIds);
  pushEvent(state, context, "Zone update", `${player.name} ${ZONE_LABELS[zoneId] || prettifyType(zoneId)} -${cardIds.length}`, undefined, player.id);
  return true;
}

function applyZoneInsert(state: ReplayState, op: Record<string, unknown>, context: PacketContext): boolean {
  const ownerId = readStringDeep(op, ["playerId", "ownerPlayerId", "userId"]) || resolveOwnerId(state, op);
  const player = getPlayer(state, ownerId, ownerId === state.opponentId ? "opponent" : "local");
  const rawZone = readStringDeep(op, ["zone", "toZone", "targetZone"]);
  const zoneId = normalizeZone(rawZone);
  const cards = flattenCards(op.cards, player.id, rawZone || zoneId || "played", player.side);
  if (!zoneId || !cards.length) return false;
  for (const card of cards) {
    addCardToPlayerZone(player, zoneId, card);
    if (zoneId === "legend" && isKnownCard(card)) {
      player.legend = card;
    }
    if (zoneId === "champion" && isKnownCard(card)) {
      player.champion = card;
    }
    if (!card.faceDown && isKnownCard(card)) {
      state.focusedCard = card;
    }
  }
  pushEvent(state, context, eventLabelForZone(zoneId), `${player.name} ${cards[0]?.name || ZONE_LABELS[zoneId] || "cards"}`, cards.find((card) => !card.faceDown) ?? cards[0], player.id);
  return true;
}

function applyZoneMove(state: ReplayState, op: Record<string, unknown>, context: PacketContext): boolean {
  const from = asRecord(op.from);
  const to = asRecord(op.to);
  const fromOwnerId = readStringDeep(from ?? op, ["playerId", "ownerPlayerId", "userId"]) || resolveOwnerId(state, op);
  const toOwnerId = readStringDeep(to ?? op, ["playerId", "ownerPlayerId", "userId"]) || fromOwnerId;
  const fromPlayer = getPlayer(state, fromOwnerId, fromOwnerId === state.opponentId ? "opponent" : "local");
  const toPlayer = getPlayer(state, toOwnerId, toOwnerId === state.opponentId ? "opponent" : "local");
  const rawFromZone = readStringDeep(from ?? op, ["zone", "fromZone", "sourceZone"]);
  const rawToZone = readStringDeep(to ?? op, ["zone", "toZone", "targetZone"]);
  const fromZone = normalizeZone(rawFromZone);
  const toZone = normalizeZone(rawToZone);
  const cardId = readStringDeep(op, ["cardId", "id", "instanceId"]);
  if (fromZone && cardId) removeCardsFromPlayerZone(fromPlayer, fromZone, [cardId]);
  const card = cardFromLoose(asRecord(op.card) ?? op, toPlayer.id, rawToZone || toZone || "played", toPlayer.side);
  if (toZone && isKnownCard(card)) {
    addCardToPlayerZone(toPlayer, toZone, card);
    state.focusedCard = card;
    pushEvent(state, context, eventLabelForZone(toZone), `${toPlayer.name} ${card.name}`, card, toPlayer.id);
    return true;
  }
  pushEvent(state, context, "Zone move", `${toPlayer.name} moved a card`, undefined, toPlayer.id);
  return Boolean(fromZone || toZone);
}

function applyCardPatch(state: ReplayState, op: Record<string, unknown>, context: PacketContext): boolean {
  const ownerId = readStringDeep(op, ["playerId", "ownerPlayerId", "userId"]) || resolveOwnerId(state, op);
  const player = getPlayer(state, ownerId, ownerId === state.opponentId ? "opponent" : "local");
  const zoneId = normalizeZone(readStringDeep(op, ["zone", "zoneName"]));
  const cardId = readStringDeep(op, ["cardId", "id", "instanceId"]);
  const fields = asRecord(op.fields);
  const card = zoneId && cardId ? findCardInPlayerZone(player, zoneId, cardId) : findCardById(player, cardId);
  if (card && fields) {
    card.exhausted = typeof fields.exhausted === "boolean" ? fields.exhausted : card.exhausted;
    state.focusedCard = card;
    pushEvent(state, context, "Card update", `${player.name} ${card.name}`, card, player.id);
    return true;
  }
  return false;
}

function applyChainSet(state: ReplayState, op: Record<string, unknown>, context: PacketContext, replace: boolean): boolean {
  const entries = flattenRecords(op.entries);
  if (replace) state.chain = [];
  for (const entry of entries) {
    const ownerId = readStringDeep(entry, ["byPlayerId", "ownerPlayerId", "playerId"]) || resolveOwnerId(state, entry);
    const side = ownerId === state.opponentId ? "opponent" : "local";
    const card = cardFromLoose(asRecord(entry.card) ?? entry, ownerId, "chain", side);
    if (isKnownCard(card)) {
      upsertCardList(state.chain, card);
      state.focusedCard = card;
      pushEvent(state, context, "Chain update", `${getPlayer(state, ownerId, side).name} ${card.name}`, card, ownerId);
    }
  }
  return entries.length > 0;
}

function applyChainRemove(state: ReplayState, op: Record<string, unknown>, context: PacketContext): boolean {
  const ids = readStringArray(op.entryIds);
  if (!ids.length) return false;
  state.chain = state.chain.filter((card) => !ids.includes(card.id));
  pushEvent(state, context, "Chain update", `Chain -${ids.length}`, undefined);
  return true;
}

function applyLogInsert(state: ReplayState, op: Record<string, unknown>, context: PacketContext): boolean {
  const entries = flattenRecords(op.entries);
  for (const entry of entries) {
    const playerId = readStringDeep(entry, ["authorPlayerId", "playerId", "ownerPlayerId"]);
    const text = readStringDeep(entry, ["text", "message", "body", "content"]);
    if (text) {
      pushEvent(state, context, "Chat", text, undefined, playerId || undefined);
    }
  }
  return entries.length > 0;
}

function pushChatEvent(state: ReplayState, context: PacketContext): void {
  const entry = firstRecord(context.packet.entries) ?? asRecord(context.packet.entry) ?? asRecord(context.packet.message) ?? context.packet;
  const playerId = resolveOwnerId(state, entry);
  const message = readStringDeep(entry, ["message", "text", "body", "content"]) || "Chat update";
  pushEvent(state, context, "Chat", message, undefined, playerId);
  pushFrame(state, "board", "Chat", undefined, context.message.ts);
}

function collectPlayers(state: ReplayState, root: Record<string, unknown>): void {
  const candidates = flattenRecords([
    root.players,
    root.playerStates,
    root.participants,
    root.users,
    root.roomPlayers,
    root.selfPlayer,
    root.opponentPlayer,
    asRecord(root.sessionDoc)?.players,
    asRecord(root.sessionDoc)?.selfPlayer,
    asRecord(root.sessionDoc)?.opponentPlayer
  ]);
  for (const item of candidates) {
    const id = readStringDeep(item, ["id", "playerId", "uid", "userId", "seatId"]) || inferPlayerId(state, item);
    const name = readStringDeep(item, ["name", "displayName", "username", "handle", "playerName"]) || id;
    const side = inferSide(state, item, id, name);
    const player = ensurePlayer(state, id, name, side);
    player.name = cleanPlayerName(name, player.name);
    const board = asRecord(item.board);
    player.score = readNumberDeep(item, ["score", "points", "victoryPoints"]) ?? readNumberDeep(board, ["score", "points", "victoryPoints"]) ?? player.score;
    player.maxScore = readNumberDeep(item, ["maxScore", "scoreCap"]) ?? readNumberDeep(board, ["maxScore", "scoreCap"]) ?? player.maxScore;
    const legend = cardFromLoose(
      readObjectDeep(item, ["legend", "leader", "legendCard"]) ?? readObjectDeep(board, ["legend", "leader", "legendCard"]) ?? item.legendCard,
      id,
      "legend",
      side
    );
    const champion = cardFromLoose(
      readObjectDeep(item, ["champion", "championCard", "selectedChampion"]) ?? readObjectDeep(board, ["champion", "championCard", "selectedChampion"]) ?? item.championCard,
      id,
      "champion",
      side
    );
    if (isKnownCard(legend)) {
      player.legend = legend;
    }
    if (isKnownCard(champion)) {
      player.champion = champion;
    }
    collectLooseZonesForPlayer(player, item, side);
    if (board) {
      collectLooseZonesForPlayer(player, board, side);
    }
    collectDeckSectionsForPlayer(player, item, side);
  }
}

function collectLooseZones(state: ReplayState, root: Record<string, unknown>): void {
  const local = getPlayer(state, state.localId, "local");
  const opponent = getPlayer(state, state.opponentId, "opponent");
  collectLooseZonesForPlayer(local, root, "local");
  collectLooseZonesForPlayer(opponent, root, "opponent");
}

function collectLooseZonesForPlayer(player: MutablePlayer, root: Record<string, unknown>, side: RiftLiteReplaySide): void {
  const zoneKeys = [
    "hand", "runes", "runeDeck", "base", "battlefield", "battlefields", "trash", "discard", "deck",
    "mainDeck", "removed", "sideboard", "chain", "runeArea", "battlefieldA", "battlefieldB", "battlefieldToken", "banished"
  ];
  for (const key of zoneKeys) {
    const value = root[key];
    if (value === undefined) {
      continue;
    }
    const zone = normalizeZone(key);
    if (typeof value === "number") {
      ensureZone(player, zone).count = value;
      if (zone === "deck") player.deckCount = value;
      if (zone === "runes") player.runeCount = value;
      if (zone === "runeDeck" && player.runeCount === undefined) player.runeCount = value;
      continue;
    }
    const record = asRecord(value);
    const explicitCount = readNumberDeep(record, ["count", "size", "remaining", "total", "length", "deckCount", "runeCount"]);
    if (Number.isFinite(explicitCount)) {
      ensureZone(player, zone).count = explicitCount;
      if (zone === "deck") player.deckCount = explicitCount;
      if (zone === "runes") player.runeCount = explicitCount;
      if (zone === "runeDeck" && player.runeCount === undefined) player.runeCount = explicitCount;
    }
    const cards = flattenCards(value, player.id, zone, side);
    if (cards.length) {
      mergeCardsIntoZone(player, zone, cards);
    }
  }
}

function collectDeckSectionsForPlayer(player: MutablePlayer, root: Record<string, unknown>, side: RiftLiteReplaySide): void {
  const sections = asRecord(asRecord(root.deck)?.sections) ?? asRecord(asRecord(asRecord(root.fields)?.deck)?.sections);
  if (!sections) return;
  const legend = flattenCards(sections.legend, player.id, "legend", side).find(isKnownCard);
  const champion = flattenCards(sections.champion, player.id, "champion", side).find(isKnownCard);
  if (legend) player.legend = legend;
  if (champion) player.champion = champion;
  collectKnownDeckCards(player, sections, side);
  const mainDeckCount = totalCardQuantity(sections.mainDeck);
  const runeCount = totalCardQuantity(sections.runes);
  if (mainDeckCount > 0 && player.deckCount === undefined) {
    player.deckCount = mainDeckCount;
    ensureZone(player, "deck").count = mainDeckCount;
  }
  if (runeCount > 0) {
    ensureZone(player, "runeDeck").count = Math.max(ensureZone(player, "runeDeck").count ?? 0, runeCount);
  }
}

function collectKnownDeckCards(player: MutablePlayer, sections: Record<string, unknown>, side: RiftLiteReplaySide): void {
  for (const [section, value] of Object.entries(sections)) {
    const zone = section.toLowerCase().includes("battlefield")
      ? "battlefield"
      : section.toLowerCase().includes("rune")
        ? "runeDeck"
        : normalizeZone(section) || "deck";
    for (const card of flattenCards(value, player.id, zone, side)) {
      if (isKnownCard(card)) {
        upsertCardList(player.knownCards, card);
      }
    }
  }
}

function enrichCardFromKnownCards(player: MutablePlayer, card: MutableCard): MutableCard {
  const cardKey = normalizeCardKey(card.name || card.code || card.id);
  const known = player.knownCards.find((item) => {
    const knownName = normalizeCardKey(item.name);
    const knownCode = normalizeCardKey(item.code);
    return Boolean(cardKey && (knownName === cardKey || knownCode === cardKey));
  });
  if (!known) return card;
  return {
    ...known,
    ...card,
    code: card.code || known.code,
    imageUrl: card.imageUrl || known.imageUrl,
    key: card.key || known.key,
    name: card.name && card.name !== "Unknown card" ? card.name : known.name
  };
}

function selectedBattlefieldFromFields(fields: Record<string, unknown>, player: MutablePlayer): MutableCard | undefined {
  const value = fields.selectedBattlefield ?? fields.battlefield;
  if (typeof value === "string" && value.trim()) {
    const loose = cardFromLoose({ name: value.trim() }, player.id, "battlefield", player.side);
    return enrichCardFromKnownCards(player, loose);
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const card = cardFromLoose(record, player.id, "battlefield", player.side);
  return isKnownCard(card) ? enrichCardFromKnownCards(player, card) : undefined;
}

function setSelectedBattlefield(player: MutablePlayer, card: MutableCard): void {
  const enriched = enrichCardFromKnownCards(player, card);
  const selected: MutableCard = {
    ...enriched,
    id: `selected-battlefield-${player.id}-${normalizeCardKey(enriched.code || enriched.name || enriched.id) || "card"}`,
    zone: "battlefield"
  };
  const previousId = player.selectedBattlefield?.id;
  player.selectedBattlefield = selected;
  const zone = ensureZone(player, "battlefield");
  zone.cards = [
    selected,
    ...zone.cards.filter((item) => item.id !== selected.id && item.id !== previousId && !item.id.startsWith("selected-battlefield-"))
  ];
  zone.count = Math.max(zone.count ?? 0, zone.cards.length);
}

function collectBoardObjects(state: ReplayState, root: Record<string, unknown>): void {
  const records = flattenRecords([root.board, root.objects, root.entities, root.cards, root.zones]);
  for (const record of records) {
    const ownerId = resolveOwnerId(state, record);
    const side = ownerId === state.opponentId ? "opponent" : "local";
    const rawZone = readStringDeep(record, ["zone", "zoneName", "dropZone", "location", "area"]);
    const zone = normalizeZone(rawZone) || "board";
    const card = cardFromLoose(record, ownerId, rawZone || zone, side);
    if (card.name || card.code || card.imageUrl) {
      addCardToPlayerZone(getPlayer(state, ownerId, side), zone, card);
      state.focusedCard = state.focusedCard ?? card;
    }
  }
}

function pushEvent(
  state: ReplayState,
  context: PacketContext,
  label: string,
  detail?: string,
  card?: MutableCard,
  playerId?: string
): void {
  const id = `event-${state.events.length}`;
  const resolvedPlayerId = playerId || card?.ownerId;
  const player = resolvedPlayerId ? state.players.get(resolvedPlayerId) : undefined;
  state.events.push({
    id,
    frameIndex: Math.max(0, state.frames.length),
    ts: context.message.ts,
    timeLabel: formatTimeOffset(context.message.ts, state.events[0]?.ts),
    label,
    detail,
    type: context.type,
    playerId: resolvedPlayerId,
    playerName: player?.name,
    card: card ? cloneCard(card) : undefined
  });
}

function pushFrame(state: ReplayState, stage: RiftLiteReplayStage, label: string, focusedCard?: MutableCard, ts?: number): void {
  state.frames.push({
    id: `frame-${state.frames.length}`,
    index: state.frames.length,
    stage,
    ts,
    label,
    turn: state.turn,
    gameNumber: state.gameNumber,
    focusedCard: focusedCard ? cloneCard(focusedCard) : state.focusedCard ? cloneCard(state.focusedCard) : undefined,
    local: clonePlayer(getPlayer(state, state.localId, "local")),
    opponent: clonePlayer(getPlayer(state, state.opponentId, "opponent")),
    chain: state.chain.map(cloneCard),
    events: state.events.slice(-80)
  });
}

function buildIntroFrames(state: ReplayState, firstFrame: RiftLiteReplayFrame | undefined, ts?: number): RiftLiteReplayFrame[] {
  const local = firstFrame?.local ? cloneReplayPlayer(firstFrame.local) : clonePlayer(getPlayer(state, state.localId, "local"));
  const opponent = firstFrame?.opponent ? cloneReplayPlayer(firstFrame.opponent) : clonePlayer(getPlayer(state, state.opponentId, "opponent"));
  const insights = buildIntroInsights(state.events, local, opponent, state.frames, {
    firstPlayerName: state.firstPlayerName,
    localRoll: state.localRoll,
    opponentRoll: state.opponentRoll
  });
  const baseSource: RiftLiteReplayFrame = firstFrame ?? {
    id: "frame-intro-base",
    index: 0,
    stage: "board" as const,
    ts,
    label: "Replay",
    local,
    opponent,
    chain: [],
    events: []
  };
  const base: RiftLiteReplayFrame = {
    ...baseSource,
    local,
    opponent,
    events: []
  };
  return [
    {
      ...base,
      id: "frame-intro-matchup",
      stage: "matchup",
      label: "THE MATCHUP",
      headline: `${opponent.legend?.name || opponent.name} vs ${local.legend?.name || local.name}`,
      subline: state.roomCode ? `Room ${state.roomCode}` : undefined,
      focusedCard: opponent.legend || local.legend || base.focusedCard,
      events: []
    },
    {
      ...base,
      id: "frame-intro-battlefields",
      stage: "battlefields",
      label: "BATTLEFIELDS",
      headline: "Battlefields",
      subline: "Chosen battlefield package",
      focusedCard: zoneCards(opponent, "battlefield")[0] || zoneCards(local, "battlefield")[0] || base.focusedCard,
      events: []
    },
    {
      ...base,
      id: "frame-intro-initiative",
      stage: "initiative",
      label: "INITIATIVE",
      headline: "Initiative",
      subline: insights.initiative.message || "Opening rolls and first-player decision",
      initiative: insights.initiative,
      events: []
    },
    {
      ...base,
      id: "frame-intro-mulligan",
      stage: "mulligan",
      label: "MULLIGAN",
      headline: "Mulligan",
      subline: insights.mulligan.message || "Opening hand decisions",
      mulligan: insights.mulligan,
      events: []
    },
    {
      ...base,
      id: "frame-intro-opening",
      stage: "openingHands",
      label: "OPENING HANDS",
      headline: "Opening hands",
      subline: "Final hands before game start",
      mulligan: insights.mulligan,
      events: []
    }
  ];
}

function introBaseFrame(frames: RiftLiteReplayFrame[]): RiftLiteReplayFrame | undefined {
  if (!frames.length) {
    return undefined;
  }
  const withOpeningHand = frames.find((frame) => {
    const localHand = zoneCards(frame.local, "hand").length;
    const opponentHand = zoneCards(frame.opponent, "hand").length;
    return localHand > 0 || opponentHand > 0;
  });
  if (withOpeningHand) {
    return withOpeningHand;
  }
  const withBattlefields = frames.find((frame) => {
    return Boolean(
      frame.local.selectedBattlefield ||
      frame.opponent.selectedBattlefield ||
      zoneCards(frame.local, "battlefield").length ||
      zoneCards(frame.opponent, "battlefield").length
    );
  });
  if (withBattlefields) {
    return withBattlefields;
  }
  const withMatchup = frames.find((frame) => frame.local.legend || frame.opponent.legend || frame.local.champion || frame.opponent.champion);
  return withMatchup ?? frames[0];
}

function liveFramesAfterIntro(frames: RiftLiteReplayFrame[], introBase: RiftLiteReplayFrame | undefined): RiftLiteReplayFrame[] {
  if (!frames.length || !introBase) {
    return frames;
  }
  const startIndex = frames.findIndex((frame) => frame.index === introBase.index);
  if (startIndex <= 0) {
    return frames;
  }
  return frames.slice(startIndex);
}

function buildPlayableFrameIndexMap(frames: RiftLiteReplayFrame[], introFrameCount: number): Map<number, number> {
  const map = new Map<number, number>();
  frames.forEach((frame, index) => {
    map.set(frame.index, introFrameCount + index);
  });
  return map;
}

function remapReplayEventFrameIndex(
  event: RiftLiteReplayEvent,
  frameIndexMap: Map<number, number>,
  defaultFrameIndex: number
): RiftLiteReplayEvent {
  return {
    ...event,
    frameIndex: frameIndexMap.get(event.frameIndex) ?? defaultFrameIndex
  };
}

function buildIntroInsights(
  events: RiftLiteReplayEvent[],
  local: RiftLiteReplayPlayer,
  opponent: RiftLiteReplayPlayer,
  frames: RiftLiteReplayFrame[] = [],
  knownInitiative: Partial<RiftLiteReplayInitiativeState> = {}
): IntroInsights {
  const lines = events.map((event) => `${event.playerName || ""} ${event.label || ""} ${event.detail || ""}`).filter(Boolean);
  const text = lines.join("\n");
  const handFlow = buildMulliganHandFlow(frames, local, opponent);
  const firstPlayerName = knownInitiative.firstPlayerName || findFirstPlayer(text, [local.name, opponent.name]);
  const rollPair = findRollPair(text, local.name, opponent.name, firstPlayerName);
  const localRoll = knownInitiative.localRoll ?? findRollFromEvents(events, local.name) ?? findRoll(text, local.name) ?? rollPair.localRoll;
  const opponentRoll = knownInitiative.opponentRoll ?? findRollFromEvents(events, opponent.name) ?? findRoll(text, opponent.name) ?? rollPair.opponentRoll;
  const choosingPlayerName = findChoosingPlayer(text, [local.name, opponent.name]);
  const localMulligans = findMulliganCount(text, local.name);
  const opponentMulligans = findMulliganCount(text, opponent.name);
  const mulliganDone = /mulligans?\s+(?:complete|completed|done)/i.test(text);
  return {
    initiative: {
      localRoll,
      opponentRoll,
      firstPlayerName,
      choosingPlayerName,
      message: firstPlayerName
        ? `${firstPlayerName} goes first`
        : localRoll || opponentRoll
          ? "Opening rolls captured"
          : undefined
    },
    mulligan: {
      localCardsSeen: handFlow.localFinalHand.length || zoneCards(local, "hand").length || undefined,
      opponentCardsSeen: handFlow.opponentFinalHandCount || zoneCards(opponent, "hand").length || undefined,
      localOriginalHand: handFlow.localOriginalHand,
      localFinalHand: handFlow.localFinalHand,
      localMulliganedCards: handFlow.localMulliganedCards,
      localAddedCards: handFlow.localAddedCards,
      opponentOriginalHandCount: handFlow.opponentOriginalHandCount,
      opponentFinalHandCount: handFlow.opponentFinalHandCount,
      localMulligans,
      opponentMulligans,
      localKept: mulliganDone || /keep hand/i.test(text),
      opponentKept: mulliganDone || /keep hand/i.test(text),
      message: mulliganDone ? "Mulligans complete" : undefined
    }
  };
}

interface MulliganHandFlow {
  localOriginalHand: RiftLiteReplayCard[];
  localFinalHand: RiftLiteReplayCard[];
  localMulliganedCards: RiftLiteReplayCard[];
  localAddedCards: RiftLiteReplayCard[];
  opponentOriginalHandCount?: number;
  opponentFinalHandCount?: number;
}

function buildMulliganHandFlow(
  frames: RiftLiteReplayFrame[],
  local: RiftLiteReplayPlayer,
  opponent: RiftLiteReplayPlayer
): MulliganHandFlow {
  const gameStartIndex = frames.findIndex((frame) => {
    const text = frame.events.map((event) => `${event.label || ""} ${event.detail || ""}`).join("\n");
    return /(?:mulligans?\s+(?:complete|completed|done)|game\s+start)/i.test(text);
  });
  const sampleLimit = gameStartIndex >= 0 ? gameStartIndex + 1 : Math.min(frames.length, 18);
  const candidates = frames.slice(0, sampleLimit || frames.length);
  const localHands = candidates.map((frame) => zoneCards(frame.local.id === local.id ? frame.local : local, "hand")).filter((cards) => cards.length);
  const opponentHands = candidates.map((frame) => zoneCards(frame.opponent.id === opponent.id ? frame.opponent : opponent, "hand")).filter((cards) => cards.length);
  const localOriginalHand = cloneUniqueCards(localHands[0] ?? zoneCards(local, "hand"));
  const localFinalHand = cloneUniqueCards(firstMeaningfullyDifferentHand(localHands, localOriginalHand) ?? localHands.at(-1) ?? localOriginalHand);
  const localOriginalKeys = cardIdentityCounts(localOriginalHand);
  const localFinalKeys = cardIdentityCounts(localFinalHand);
  return {
    localOriginalHand,
    localFinalHand,
    localMulliganedCards: cardsMissingFromCounts(localOriginalHand, localFinalKeys),
    localAddedCards: cardsMissingFromCounts(localFinalHand, localOriginalKeys),
    opponentOriginalHandCount: opponentHands[0]?.length || zoneCards(opponent, "hand").length || undefined,
    opponentFinalHandCount: opponentHands.at(-1)?.length || opponentHands[0]?.length || zoneCards(opponent, "hand").length || undefined
  };
}

function firstMeaningfullyDifferentHand(
  hands: RiftLiteReplayCard[][],
  original: RiftLiteReplayCard[]
): RiftLiteReplayCard[] | undefined {
  const originalKey = cardsIdentitySignature(original);
  return hands.find((cards, index) => index > 0 && cardsIdentitySignature(cards) !== originalKey);
}

function cloneUniqueCards(cards: RiftLiteReplayCard[]): RiftLiteReplayCard[] {
  const seen = new Set<string>();
  const result: RiftLiteReplayCard[] = [];
  for (const card of cards) {
    const key = cardIdentity(card);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cloneCard(card));
  }
  return result;
}

function cardsIdentitySignature(cards: RiftLiteReplayCard[]): string {
  return cards.map(cardIdentity).sort().join("|");
}

function cardIdentityCounts(cards: RiftLiteReplayCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const key = cardIdentity(card);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function cardsMissingFromCounts(cards: RiftLiteReplayCard[], targetCounts: Map<string, number>): RiftLiteReplayCard[] {
  const seen = new Map<string, number>();
  const result: RiftLiteReplayCard[] = [];
  for (const card of cards) {
    const key = cardIdentity(card);
    const used = seen.get(key) ?? 0;
    const available = targetCounts.get(key) ?? 0;
    if (used >= available) {
      result.push(cloneCard(card));
    }
    seen.set(key, used + 1);
  }
  return result;
}

function cardIdentity(card: RiftLiteReplayCard): string {
  return card.id || card.key || normalizeCardKey(card.code || card.name);
}

function findRoll(text: string, playerName: string): number | undefined {
  if (!playerName) return undefined;
  for (const candidate of rollCandidatesFromText(text)) {
    if (nameMatches(candidate.name, playerName)) return candidate.value;
  }
  const exact = new RegExp(`${escapeRegExp(playerName)}[^\\n]{0,48}roll(?:ed|s)?(?:\\s+a)?(?:\\s+d20)?[^\\d\\n]{0,12}(\\d{1,2})`, "i").exec(text);
  if (exact?.[1]) return Number(exact[1]);
  const fuzzyName = playerName.split(/\s+/)[0] || playerName;
  const fuzzy = new RegExp(`${escapeRegExp(fuzzyName)}[^\\n]{0,48}roll(?:ed|s)?(?:\\s+a)?(?:\\s+d20)?[^\\d\\n]{0,12}(\\d{1,2})`, "i").exec(text);
  return fuzzy?.[1] ? Number(fuzzy[1]) : undefined;
}

function findRollFromEvents(events: RiftLiteReplayEvent[], playerName: string): number | undefined {
  if (!playerName) return undefined;
  const normalizedPlayer = normalizeCardKey(playerName);
  const firstName = normalizeCardKey(playerName.split(/\s+/)[0] || playerName);
  for (const event of events) {
    const playerMatches = normalizeCardKey(event.playerName || "") === normalizedPlayer;
    const detail = `${event.label || ""} ${event.detail || ""}`;
    const candidate = rollCandidatesFromText(`${event.playerName || ""} ${detail}`).find((entry) => nameMatches(entry.name, playerName));
    if (candidate) return candidate.value;
    const namedDetailRoll = findRoll(detail, playerName);
    if (typeof namedDetailRoll === "number") return namedDetailRoll;
    if (hasExplicitNamedRoll(detail)) continue;
    const line = `${event.playerName || ""} ${detail}`;
    const normalizedLine = normalizeCardKey(line);
    if (!playerMatches && !normalizedLine.includes(normalizedPlayer) && !normalizedLine.includes(firstName)) {
      continue;
    }
    const roll = playerMatches ? rollValueFromText(detail) : findRoll(line, playerName);
    if (typeof roll === "number") return roll;
  }
  return undefined;
}

function rollCandidatesFromText(text: string): Array<{ name: string; value: number }> {
  const results: Array<{ name: string; value: number }> = [];
  const patterns = [
    /([A-Za-z0-9_][A-Za-z0-9_\-\s.'[\]]{0,44}?)\s+roll(?:ed|s)?(?:\s+a)?(?:\s+d20)?[^\d\n]{0,18}(\d{1,2})/gi,
    /([A-Za-z0-9_][A-Za-z0-9_\-\s.'[\]]{0,44}?)\s+rolled\s+(\d{1,2})/gi
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const value = Number(match[2]);
      if (Number.isFinite(value) && value >= 1 && value <= 20) {
        results.push({
          name: match[1].replace(/\b(?:chat|initiative|roll)\b/gi, "").trim(),
          value
        });
      }
    }
  }
  return results;
}

function findRollPair(
  text: string,
  localName: string,
  opponentName: string,
  firstPlayerName?: string
): { localRoll?: number; opponentRoll?: number } {
  const namedPair = /roll(?:ed|s)?(?:\s+a)?(?:\s+d20)?[^\d\n]{0,12}(\d{1,2})\s*[.。]\s*([^\n.。]{2,64}?)\s+roll(?:ed|s)?(?:\s+a)?(?:\s+d20)?[^\d\n]{0,12}(\d{1,2})/i.exec(text);
  if (namedPair?.[1] && namedPair[2] && namedPair[3]) {
    const first = Number(namedPair[1]);
    const second = Number(namedPair[3]);
    const named = namedPair[2];
    if (nameMatches(named, localName)) {
      return { localRoll: second, opponentRoll: first };
    }
    if (nameMatches(named, opponentName)) {
      return { localRoll: first, opponentRoll: second };
    }
  }

  const initiativePair = /wins?\s+initiative\s*\(\s*(\d{1,2})\s+vs\.?\s+(\d{1,2})\s*\)/i.exec(text);
  if (initiativePair?.[1] && initiativePair[2]) {
    const winnerRoll = Number(initiativePair[1]);
    const loserRoll = Number(initiativePair[2]);
    if (firstPlayerName && nameMatches(firstPlayerName, localName)) {
      return { localRoll: winnerRoll, opponentRoll: loserRoll };
    }
    if (firstPlayerName && nameMatches(firstPlayerName, opponentName)) {
      return { localRoll: loserRoll, opponentRoll: winnerRoll };
    }
  }
  return {};
}

function nameMatches(value: string, name: string): boolean {
  if (!value || !name) return false;
  const left = normalizeText(value).replace(/[^\w'-]+/g, "");
  const right = normalizeText(name).replace(/[^\w'-]+/g, "");
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

function hasExplicitNamedRoll(text: string): boolean {
  const roll = /\broll(?:ed|s)?\b/i.exec(text);
  if (!roll) return false;
  const prefix = text
    .slice(0, roll.index)
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\bchat\b/gi, " ")
    .replace(/[^\w\s'-]/g, " ")
    .trim();
  return /[a-z0-9_]{2,}/i.test(prefix);
}

function rollValueFromText(text: string): number | undefined {
  const match = /roll(?:ed|s)?(?:\s+a)?(?:\s+d20)?[^\d\n]{0,16}(\d{1,2})/i.exec(text);
  const value = match?.[1] ? Number(match[1]) : undefined;
  return typeof value === "number" && value >= 1 && value <= 20 ? value : undefined;
}

function findFirstPlayer(text: string, names: string[]): string | undefined {
  for (const name of names.filter(Boolean)) {
    const escaped = escapeRegExp(name);
    if (new RegExp(`${escaped}[^\\n]{0,40}(?:chose|chooses|will|is going)\\s+to\\s+go\\s+first`, "i").test(text)) {
      return name;
    }
    if (new RegExp(`chose\\s+${escaped}\\s+to\\s+(?:take\\s+the\\s+first(?:\\s+turn)?|go\\s+first)`, "i").test(text)) {
      return name;
    }
  }
  const choseNamed = /chose\s+([^\n.]+?)\s+to\s+(?:take\s+the\s+first(?:\s+turn)?|go\s+first)/i.exec(text);
  if (choseNamed?.[1]) {
    const choice = choseNamed[1].trim();
    const known = names.find((name) => nameMatches(choice, name));
    return known || choice;
  }
  const generic = /([^\n.]+?)\s+(?:chose|chooses|will|is going)\s+to\s+go\s+first/i.exec(text);
  return generic?.[1]?.trim();
}

function findChoosingPlayer(text: string, names: string[]): string | undefined {
  for (const name of names.filter(Boolean)) {
    const escaped = escapeRegExp(name);
    if (new RegExp(`${escaped}[^\\n]{0,40}(?:choosing|selecting|deciding)`, "i").test(text)) {
      return name;
    }
  }
  return undefined;
}

function findMulliganCount(text: string, playerName: string): number | undefined {
  if (!playerName) return undefined;
  const exact = new RegExp(`${escapeRegExp(playerName)}[^\\n]{0,60}mulligan(?:ed|s)?\\s*(\\d+)?`, "i").exec(text);
  if (exact) return exact[1] ? Number(exact[1]) : 1;
  return undefined;
}

function zoneCards(player: RiftLiteReplayPlayer, zoneId: string): RiftLiteReplayCard[] {
  return player.zones[zoneId]?.cards ?? [];
}

function applyCountHintForMove(player: MutablePlayer, op: Record<string, unknown>, toZone: string, count = 1): void {
  const fromZone = normalizeZone(readStringDeep(op, ["fromZone", "sourceZone", "from", "oldZone", "previousZone", "source"]));
  const quantity = Math.max(1, count || readNumberDeep(op, ["count", "qty", "quantity"]) || 1);
  if (fromZone === "deck" && toZone !== "deck" && typeof player.deckCount === "number") {
    player.deckCount = Math.max(0, player.deckCount - quantity);
    ensureZone(player, "deck").count = player.deckCount;
  }
  if (fromZone === "runes" && toZone !== "runes" && typeof player.runeCount === "number") {
    player.runeCount = Math.max(0, player.runeCount - quantity);
    ensureZone(player, "runes").count = player.runeCount;
  }
}

function ensurePlayer(state: ReplayState, id: string, name: string, side: RiftLiteReplaySide): MutablePlayer {
  const normalizedId = id || (side === "local" ? DEFAULT_LOCAL_ID : DEFAULT_OPPONENT_ID);
  const existing = state.players.get(normalizedId);
  if (existing) {
    existing.knownCards ??= [];
    if (name && existing.name === normalizedId) {
      existing.name = name;
    }
    existing.side = side;
    if (side === "local") state.localId = normalizedId;
    if (side === "opponent") state.opponentId = normalizedId;
    return existing;
  }
  const player: MutablePlayer = {
    id: normalizedId,
    name: name || normalizedId,
    side,
    knownCards: [],
    score: 0,
    maxScore: 8,
    deckCount: undefined,
    runeCount: undefined,
    zones: {}
  };
  state.players.set(normalizedId, player);
  if (side === "local") state.localId = normalizedId;
  if (side === "opponent") state.opponentId = normalizedId;
  return player;
}

function getPlayer(state: ReplayState, id: string, side: RiftLiteReplaySide): MutablePlayer {
  return state.players.get(id) ?? ensurePlayer(state, id, side === "local" ? "You" : "Opponent", side);
}

function ensureZone(player: MutablePlayer, zoneId: string): RiftLiteReplayZone {
  const id = normalizeZone(zoneId) || "board";
  player.zones[id] ??= { id, label: ZONE_LABELS[id] || prettifyType(id), cards: [] };
  return player.zones[id];
}

function addCardToPlayerZone(player: MutablePlayer, zoneId: string, card: MutableCard): void {
  const zone = ensureZone(player, zoneId);
  upsertCardList(zone.cards, { ...card, zone: zone.id });
  zone.count = Math.max(zone.count ?? 0, zone.cards.length);
  if (zone.id === "deck") {
    player.deckCount = zone.count;
  }
  if (zone.id === "runes") {
    player.runeCount = zone.count;
  }
}

function mergeCardsIntoZone(player: MutablePlayer, zoneId: string, cards: MutableCard[]): void {
  const zone = ensureZone(player, zoneId);
  for (const card of cards) {
    upsertCardList(zone.cards, { ...card, zone: zone.id });
  }
  zone.count = Math.max(zone.count ?? 0, zone.cards.length);
  if (zone.id === "deck") player.deckCount = zone.count;
  if (zone.id === "runes") player.runeCount = zone.count;
}

function removeCardsFromPlayerZone(player: MutablePlayer, zoneId: string, cardIds: string[]): void {
  const zone = ensureZone(player, zoneId);
  const before = zone.cards.length;
  zone.cards = zone.cards.filter((card) => !cardIds.includes(card.id));
  const removedVisible = Math.max(0, before - zone.cards.length);
  const removed = removedVisible || cardIds.length;
  zone.count = Math.max(0, (zone.count ?? before) - removed);
  if (zone.id === "deck") player.deckCount = zone.count;
  if (zone.id === "runes") player.runeCount = zone.count;
}

function findCardInPlayerZone(player: MutablePlayer, zoneId: string, cardId: string): MutableCard | undefined {
  return ensureZone(player, zoneId).cards.find((card) => card.id === cardId);
}

function findCardById(player: MutablePlayer, cardId: string): MutableCard | undefined {
  if (!cardId) return undefined;
  for (const zone of Object.values(player.zones)) {
    const card = zone.cards.find((item) => item.id === cardId);
    if (card) return card;
  }
  return undefined;
}

function totalCardQuantity(value: unknown): number {
  return flattenRecords(value).reduce((total, record) => total + Math.max(1, readNumberDeep(record, ["count", "qty", "quantity"]) ?? 1), 0);
}

function upsertCardList(cards: RiftLiteReplayCard[], card: RiftLiteReplayCard): void {
  const index = cards.findIndex((item) => item.id === card.id || (card.key && item.key === card.key && item.zone === card.zone));
  if (index >= 0) {
    cards[index] = { ...cards[index], ...card };
    return;
  }
  cards.push(card);
}

function flattenCards(value: unknown, ownerId: string, zone: string, side: RiftLiteReplaySide): MutableCard[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenCards(item, ownerId, zone, side));
  }
  const record = asRecord(value);
  if (!record) return [];
  if (record.cards !== undefined) {
    return flattenCards(record.cards, ownerId, zone, side);
  }
  if (record.items !== undefined) {
    return flattenCards(record.items, ownerId, zone, side);
  }
  const card = cardFromLoose(record, ownerId, zone, side);
  return card.name || card.code || card.imageUrl ? [card] : [];
}

function cardFromLoose(value: unknown, ownerId: string, zone: string, side: RiftLiteReplaySide): MutableCard {
  const record = asRecord(value) ?? {};
  const nested = asRecord(record.card) ?? asRecord(record.cardDef) ?? asRecord(record.definition) ?? asRecord(record.template) ?? record;
  const normalizedZone = normalizeZone(zone) || zone || "board";
  const code = readStringDeep(nested, ["cardCode", "code", "cardId", "card_id", "imageCode", "printId", "oracleId"]) ||
    codeFromImage(readStringDeep(nested, ["imageUrl", "image_url", "image", "src"]));
  const name = readStringDeep(nested, ["name", "cardName", "title", "displayName", "label"]);
  const id = readStringDeep(record, ["id", "instanceId", "cardInstanceId", "sourceId", "entityId"]) || `${ownerId}-${normalizedZone}-${normalizeCardKey(code || name)}`;
  const imageUrl = readStringDeep(nested, ["imageUrl", "image_url", "image", "src"]) || imageUrlForCode(code);
  const faceDown = Boolean(record.faceDown || record.hidden || record.isFaceDown || record.isPlaceholder || !name);
  return {
    id,
    key: normalizeCardKey(code || name || id),
    name: name || prettifyCode(code) || "Unknown card",
    code,
    imageUrl,
    zone: normalizedZone,
    ownerId,
    side,
    battlefieldZone: battlefieldZoneKey(zone),
    faceDown,
    exhausted: Boolean(record.exhausted || record.tapped),
    count: readNumberDeep(record, ["count", "qty", "quantity"])
  };
}

function findFirstCard(root: unknown, ownerId: string, zone: string, side: RiftLiteReplaySide): MutableCard | undefined {
  const records = flattenRecords(root);
  for (const record of records) {
    const card = cardFromLoose(record, ownerId, zone, side);
    if (card.name !== "Unknown card" || card.code || card.imageUrl) {
      return card;
    }
  }
  return undefined;
}

function clonePlayer(player: MutablePlayer): RiftLiteReplayPlayer {
  const { knownCards: _knownCards, ...publicPlayer } = player;
  const zones: Record<string, RiftLiteReplayZone> = {};
  for (const [key, zone] of Object.entries(player.zones)) {
    zones[key] = {
      ...zone,
      cards: zone.cards.map(cloneCard)
    };
  }
  return {
    ...publicPlayer,
    legend: player.legend ? cloneCard(player.legend) : undefined,
    champion: player.champion ? cloneCard(player.champion) : undefined,
    selectedBattlefield: player.selectedBattlefield ? cloneCard(player.selectedBattlefield) : undefined,
    zones
  };
}

function cloneReplayPlayer(player: RiftLiteReplayPlayer): RiftLiteReplayPlayer {
  const zones: Record<string, RiftLiteReplayZone> = {};
  for (const [key, zone] of Object.entries(player.zones)) {
    zones[key] = {
      ...zone,
      cards: zone.cards.map(cloneCard)
    };
  }
  return {
    ...player,
    legend: player.legend ? cloneCard(player.legend) : undefined,
    champion: player.champion ? cloneCard(player.champion) : undefined,
    selectedBattlefield: player.selectedBattlefield ? cloneCard(player.selectedBattlefield) : undefined,
    zones
  };
}

function cloneCard(card: RiftLiteReplayCard): RiftLiteReplayCard {
  return { ...card };
}

function isKnownCard(card: RiftLiteReplayCard): boolean {
  return Boolean(card.code || card.imageUrl || (card.name && card.name !== "Unknown card"));
}

function extractRawMessages(root: Record<string, unknown>): RawReplayMessage[] {
  if (Array.isArray(root.messages)) {
    return root.messages.map(normalizeMessage).filter(isMessage);
  }
  const rawCheckpoint = asRecord(root.rawCheckpoint);
  if (Array.isArray(rawCheckpoint?.retainedMessages)) {
    return rawCheckpoint.retainedMessages.map(normalizeMessage).filter(isMessage);
  }
  const capture = asRecord(root.capture);
  const checkpoint = asRecord(capture?.rawCheckpoint);
  if (Array.isArray(checkpoint?.retainedMessages)) {
    return checkpoint.retainedMessages.map(normalizeMessage).filter(isMessage);
  }
  return [];
}

function normalizeMessage(value: unknown): RawReplayMessage | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    seq: readNumber(record.seq),
    ts: readNumber(record.ts),
    dir: readString(record.dir),
    type: readString(record.type),
    raw: readString(record.raw),
    parsed: record.parsed,
    data: record.data
  };
}

function isMessage(value: RawReplayMessage | null): value is RawReplayMessage {
  return Boolean(value);
}

function parseMessagePacket(message: RawReplayMessage): Record<string, unknown> | null {
  const parsed = asRecord(message.parsed) ?? asRecord(message.data);
  if (parsed) return parsed;
  if (!message.raw) return null;
  try {
    return asRecord(JSON.parse(message.raw));
  } catch {
    return null;
  }
}

function isReplayTimelineMessage(message: RawReplayMessage): boolean {
  const explicitType = message.type || "";
  const type = explicitType || readString(parseMessagePacket(message)?.type) || "";
  return [
    "room_shell_sync",
    "authoritative_snapshot",
    "snapshot",
    "authoritative_patch_commit",
    "patch_commit",
    "chat_append",
    "chat_message"
  ].includes(type);
}

function flattenRecords(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap(flattenRecords);
  }
  const record = asRecord(value);
  if (!record) return [];
  const direct = [record];
  if (record.value || record.card || record.object || record.payload || record.data) {
    return direct.concat(flattenRecords(record.value), flattenRecords(record.card), flattenRecords(record.object), flattenRecords(record.payload), flattenRecords(record.data));
  }
  return direct;
}

function resolveOwnerId(state: ReplayState, root: Record<string, unknown>): string {
  const id = readStringDeep(root, ["ownerId", "ownerPlayerId", "byPlayerId", "authorPlayerId", "owner", "playerId", "controllerId", "userId", "seatId"]);
  if (id && state.players.has(id)) return id;
  const name = readStringDeep(root, ["ownerName", "playerName", "name"]);
  if (name) {
    for (const player of state.players.values()) {
      if (normalizeText(player.name) === normalizeText(name)) return player.id;
    }
  }
  const side = readStringDeep(root, ["side", "zoneOwner", "controller", "perspective"]).toLowerCase();
  if (side.includes("opp") || side.includes("enemy")) return state.opponentId;
  return id || state.localId;
}

function inferPlayerId(state: ReplayState, root: Record<string, unknown>): string {
  const side = readStringDeep(root, ["side", "role", "seat"]);
  if (side.toLowerCase().includes("opp")) return state.opponentId;
  if (side.toLowerCase().includes("local") || side.toLowerCase().includes("self")) return state.localId;
  const name = readStringDeep(root, ["name", "displayName", "username", "handle", "playerName"]);
  if (name) return normalizeCardKey(name) || name;
  return state.players.size <= 1 ? state.localId : state.opponentId;
}

function inferSide(state: ReplayState, root: Record<string, unknown>, id: string, name: string): RiftLiteReplaySide {
  const side = readStringDeep(root, ["side", "role", "perspective", "zoneOwner"]).toLowerCase();
  if (side.includes("opp") || side.includes("enemy")) return "opponent";
  if (side.includes("local") || side.includes("self") || side.includes("me")) return "local";
  if (id === state.localId || normalizeText(name) === normalizeText("BMU")) return "local";
  if (id === state.opponentId) return "opponent";
  if (state.players.size <= 1) return "local";
  return "opponent";
}

function normalizeZone(value: string): string {
  const text = normalizeText(value);
  if (!text) return "";
  if (text === "runedeck") return "runeDeck";
  if (text === "runearea" || text === "runes") return "runes";
  if (text === "battlefielda" || text === "battlefieldb" || text === "battlefieldtoken") return "battlefield";
  if (text.includes("opponent") && text.includes("battlefield")) return "opponentBattlefield";
  if (text.includes("battlefield")) return "battlefield";
  if (text.includes("trash") || text.includes("discard")) return "trash";
  if (text.includes("rune")) return "runes";
  if (text.includes("deck")) return "deck";
  if (text.includes("hand")) return "hand";
  if (text.includes("base")) return "base";
  if (text.includes("chain") || text.includes("stack")) return "chain";
  if (text.includes("legend")) return "legend";
  if (text.includes("champion")) return "champion";
  if (text.includes("sideboard")) return "sideboard";
  if (text.includes("removed") || text.includes("exile")) return "removed";
  return text.replace(/[^a-z0-9]+/g, "");
}

function battlefieldZoneKey(value: string): string | undefined {
  const text = normalizeText(value);
  if (text === "battlefielda" || text === "battlefieldb" || text === "battlefieldtoken") return text;
  return undefined;
}

function eventLabelForZone(zone: string): string {
  if (zone === "trash") return "Moved to trash";
  if (zone === "hand") return "Hand update";
  if (zone === "chain") return "Chain update";
  if (zone === "battlefield" || zone === "base") return "Played card";
  return "Card update";
}

function phaseLabel(sessionDoc: Record<string, unknown>, state: ReplayState): string {
  const phase = readStringDeep(sessionDoc, ["phase", "state", "status"]);
  const game = readNumberDeep(sessionDoc, ["gameNumber", "game_number", "game"]) ?? state.gameNumber;
  if (game) return `${prettifyType(phase || "game")} - game ${game}`;
  return prettifyType(phase || "Game update");
}

function roomDetail(sessionDoc: Record<string, unknown>): string {
  const room = readStringDeep(sessionDoc, ["roomCode", "room_code", "gameInstanceId"]);
  const phase = readStringDeep(sessionDoc, ["phase", "state", "status"]);
  return [room ? `Room ${room}` : "", phase ? `Phase ${phase}` : ""].filter(Boolean).join(" - ");
}

function snapshotSummary(snapshot: Record<string, unknown>): string {
  const zones = flattenRecords(snapshot.zones).length || Object.keys(snapshot).filter((key) => key.toLowerCase().includes("zone")).length;
  const players = flattenRecords(snapshot.players).length;
  return [players ? `${players} players` : "", zones ? `${zones} zones` : ""].filter(Boolean).join(" - ") || "Board state updated";
}

function buildTitle(players: RiftLiteReplayPlayer[], roomCode: string): string {
  const local = players.find((player) => player.side === "local") ?? players[1];
  const opponent = players.find((player) => player.side === "opponent") ?? players[0];
  const matchup = `${local?.name || "Player"} vs ${opponent?.name || "Opponent"}`;
  return roomCode ? `${matchup} - ${roomCode}` : matchup;
}

function formatTimeOffset(ts?: number, first?: number): string {
  if (!ts || !first) return "00:00";
  const seconds = Math.max(0, Math.floor((ts - first) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function imageUrlForCode(code: string): string {
  if (!code) return "";
  return `${CARD_IMAGE_BASE}${encodeURIComponent(code.toUpperCase())}.webp`;
}

function codeFromImage(url: string): string {
  const match = /\/cards\/([^/?#]+)\.(?:webp|png|jpg|jpeg)/i.exec(url);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function normalizeCardKey(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function prettifyCode(code: string): string {
  return code ? code.toUpperCase() : "";
}

function prettifyType(value: string): string {
  return (value || "Update")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanPlayerName(next: string, fallback: string): string {
  if (!next || next.toLowerCase() === "unknown") return fallback;
  return next;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return value.map(asRecord).find(Boolean) ?? null;
  }
  return asRecord(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === "string" ? item : typeof item === "number" ? String(item) : "").filter(Boolean);
}

function readStringDeep(root: unknown, keys: string[]): string {
  const value = readDeep(root, keys);
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function readNumberDeep(root: unknown, keys: string[]): number | undefined {
  const value = readDeep(root, keys);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function readObjectDeep(root: unknown, keys: string[]): Record<string, unknown> | null {
  return asRecord(readDeep(root, keys));
}

function readDeep(root: unknown, keys: string[]): unknown {
  const record = asRecord(root);
  if (!record) return undefined;
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  for (const value of Object.values(record)) {
    const nested = asRecord(value);
    if (!nested) continue;
    const found = readDeep(nested, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}
