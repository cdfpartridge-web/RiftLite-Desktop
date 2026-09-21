import type { CaptureEvent, MatchDraft, ReplayRecord } from "./types.js";

export interface AtlasGameLogEntry {
  id: string;
  text: string;
  time: string;
  actor?: string;
}

export interface AtlasGameLogGame {
  id: string;
  gameNumber: number;
  entries: AtlasGameLogEntry[];
}

export interface AtlasGameLog {
  games: AtlasGameLogGame[];
  source: "raw" | "captured" | "none";
  partial: boolean;
}

type RecordValue = Record<string, unknown>;
type StoredEntry = AtlasGameLogEntry & { at?: number; order?: number };
type LogState = {
  id: string;
  gameNumber: number;
  entries: StoredEntry[];
  history: Map<string, StoredEntry>;
  players: Map<string, string>;
  rooms: Set<string>;
  series: string;
  synced: boolean;
};

// The capture writer already limits sessions to 12,000 messages. Keep imported
// files bounded too; this reader intentionally never reconstructs the board.
const MAX_MESSAGES = 12_000;
const MAX_ENTRIES = 20_000;
const MAX_TEXT = 8_000;
const PATCH_TYPES = new Set(["authoritative_patch_commit", "patch_commit", "state_patch"]);

export function buildAtlasGameLog({ payload, replay, match }: {
  payload?: unknown;
  replay?: ReplayRecord;
  match?: MatchDraft;
}): AtlasGameLog {
  if ((match?.platform ?? replay?.platform ?? "atlas") !== "atlas" || match?.keepReplay === false) {
    return { games: [], source: "none", partial: false };
  }
  const raw = rawGameLog(payload, replay);
  // A successfully captured empty final log must stay empty: a fallback here
  // could resurrect entries Atlas removed with undo or a replacement snapshot.
  return raw ?? capturedGameLog(replay, match);
}

function rawGameLog(payload: unknown, replay?: ReplayRecord): AtlasGameLog | null {
  const root = record(payload);
  if (!root) return null;
  const capture = record(root.capture);
  const checkpoint = record(root.rawCheckpoint) ?? record(capture?.rawCheckpoint);
  const messages = array(root.messages ?? checkpoint?.retainedMessages);
  if (!messages.length) return null;
  const lifecycleGames = array(record(capture?.lifecycle)?.games).map(record).filter(isRecord);
  const games: LogState[] = [];
  let current: LogState | undefined;
  let partial = messages.length > MAX_MESSAGES || Boolean(root.capped || capture?.capped) || Boolean(replay?.rawCapture?.partialWarnings?.length);
  let sawLog = false;
  let nativeOrder = 0;

  const sorted = messages.slice(0, MAX_MESSAGES).map((value, index) => ({
    message: record(value), index,
  })).sort((a, b) => (number(a.message?.seq) ?? a.index) - (number(b.message?.seq) ?? b.index) || a.index - b.index);

  for (const { message, index } of sorted) {
    if (!message || message.drop === true || /^(?:out|outgoing|sent|send)$/i.test(string(message.dir))) continue;
    const packet = readPacket(message);
    if (!packet) { partial = true; continue; }
    const body = record(packet.payload) ?? packet;
    const type = string(packet.type) || string(message.type);
    const snapshot = record(body.snapshot);
    const shell = record(body.sessionDoc);
    const operations = PATCH_TYPES.has(type) ? patchOperations(body) : [];
    const roomFields = operations.filter((op) => op.op === "set_room_fields").map((op) => record(op.fields)).filter(isRecord);
    const contexts = [snapshot, shell, ...roomFields, body, packet].filter(isRecord);
    const seq = number(message.seq) ?? index;
    const marker = lifecycleGames.find((game) => {
      const source = record(game.source);
      return seq >= (number(source?.fromSeq) ?? Infinity) && seq <= (number(source?.toSeq) ?? -Infinity);
    });
    const gameNumber = contexts.map((item) => positiveInteger(item.gameNumber)).find(Boolean) ?? positiveInteger(marker?.gameNumber);
    const room = contexts.map((item) => string(item.gameInstanceId) || string(item.roomCode)).find(Boolean) ?? "";
    const series = contexts.map((item) => string(item.seriesId) || string(item.matchSeriesId)).find(Boolean) ?? "";
    const isSnapshot = type === "authoritative_snapshot" || type === "snapshot";
    const replacement = isSnapshot ? body.gameplayLog ?? snapshot?.gameplayLog : type === "setup_log_sync" ? body.log : undefined;
    const hasLog = Array.isArray(replacement) || operations.some((op) => op.op === "log_insert" || op.op === "log_remove");
    if (!hasLog && type !== "room_shell_sync" && !isSnapshot && !roomFields.length) continue;

    // Explicit game numbers and raw lifecycle sequence ranges distinguish BO3
    // games even when Atlas reuses a room and log-entry identifiers.
    const activeBeforePacket = current;
    const existing = room ? [...games].reverse().find((game) => game.rooms.has(room)
      && (!gameNumber || game.gameNumber === gameNumber) && (!series || !game.series || game.series === series)) : undefined;
    if (existing) {
      current = existing;
    } else if (!current || (gameNumber && gameNumber !== current.gameNumber)
      || (series && current.series && series !== current.series)
      || (room && !current.rooms.has(room) && current.rooms.size > 0 && !gameNumber)) {
      current = {
        id: `atlas-log-game-${games.length + 1}`,
        gameNumber: gameNumber ?? games.length + 1,
        entries: [], history: new Map(), players: new Map(), rooms: new Set(), series, synced: false,
      };
      games.push(current);
    }
    if (!current) continue;
    if (room) current.rooms.add(room);
    if (series) current.series = series;
    for (const context of contexts) {
      for (const value of array(context.players)) {
        const player = record(value);
        const id = string(player?.id) || string(player?.playerId);
        const name = string(player?.name) || string(player?.playerName);
        if (id && name) current.players.set(id, name);
      }
    }
    if (!hasLog) {
      if (existing && activeBeforePacket && games.indexOf(existing) < games.indexOf(activeBeforePacket)) current = activeBeforePacket;
      continue;
    }
    sawLog = true;
    const normalizeEntries = (value: unknown): StoredEntry[] => {
      const values = array(value);
      if (values.length > MAX_ENTRIES) partial = true;
      return values.slice(0, MAX_ENTRIES).flatMap((entry, position) => {
        const item = record(entry);
        const text = string(item?.text) || string(item?.message);
        if (!text) return [];
        if (text.length > MAX_TEXT) partial = true;
        const actorId = string(item?.authorPlayerId);
        const actor = current!.players.get(actorId) || string(item?.authorName) || string(item?.author);
        const at = timestamp(item?.at);
        const id = string(item?.id) || `anonymous:${seq}:${position}`;
        return [{ id: `${current!.id}:${id}`, text: text.slice(0, MAX_TEXT), time: timeLabel(at), at: at ?? number(message.ts), ...(actor ? { actor } : {}) }];
      });
    };
    if (Array.isArray(replacement)) {
      // Atlas keeps a rolling window of roughly 100 native rows. Preserve rows
      // already observed before a later snapshot drops that old window.
      if (!current.synced && replacement.length >= 99) partial = true;
      current.entries = uniqueEntries(normalizeEntries(replacement));
      if (!replacement.length) current.history.clear();
      for (const entry of current.entries) current.history.set(entry.id, entry);
      current.synced = true;
    }
    for (const operation of operations) {
      if (operation.op === "log_remove") {
        const ids = new Set(array(operation.entryIds).map((id) => `${current!.id}:${string(id)}`));
        const actionType = string(record(body.action)?.type) || string(record(packet.action)?.type);
        const removed = current.entries.filter((entry) => ids.has(entry.id));
        const tailOnly = current.entries.length >= 98 && removed.length > 0
          && current.entries.slice(-removed.length).every((entry) => ids.has(entry.id));
        // Native packets identify rewinds explicitly. Other actions routinely
        // remove the oldest row to maintain the window, even without an insert.
        // Those remain part of the captured transcript after the game.
        const undo = /(?:rewind|undo)/i.test(actionType) || (!actionType && !tailOnly);
        if (undo) for (const id of ids) current.history.delete(id);
        current.entries = current.entries.filter((entry) => !ids.has(entry.id));
      } else if (operation.op === "log_insert") {
        const incoming = uniqueEntries(normalizeEntries(operation.entries));
        for (const entry of incoming) current.history.set(entry.id, entry);
        // Reconnects can repeat an insertion. Stable Atlas ids identify the
        // same event; equal text with distinct ids remains distinct.
        const seen = new Set(current.entries.map((entry) => entry.id));
        const additions = incoming.filter((entry) => !seen.has(entry.id));
        const insertion = number(operation.index);
        const at = insertion === undefined || insertion < 0 ? current.entries.length : Math.min(Math.floor(insertion), current.entries.length);
        current.entries.splice(at, 0, ...additions);
        if (current.entries.length > MAX_ENTRIES) {
          current.entries.length = MAX_ENTRIES;
          partial = true;
        }
      }
    }
    // Atlas's list is newest first, including simultaneous setup messages.
    // Re-rank the retained native window after all operations in a packet so
    // an index-1 insertion correctly precedes an index-0 insertion on a tie.
    for (const entry of [...current.entries].reverse()) {
      const retained = current.history.get(entry.id);
      if (retained) retained.order = nativeOrder++;
    }
    if (current.history.size > MAX_ENTRIES) {
      partial = true;
      const retained = [...current.history.entries()].slice(0, MAX_ENTRIES);
      current.history = new Map(retained);
    }
    // A delayed packet from an earlier room may update that game's log, but
    // must not redirect later packets without an explicit room back to it.
    if (existing && activeBeforePacket && games.indexOf(existing) < games.indexOf(activeBeforePacket)) current = activeBeforePacket;
  }
  if (!sawLog) return null;
  return {
    source: "raw",
    partial: partial || games.some((game) => game.history.size > 0 && !game.synced),
    games: games.filter((game) => game.synced || game.history.size > 0).map((game) => ({
      id: game.id, gameNumber: game.gameNumber,
      entries: publicChronologicalEntries([...game.history.values()]),
    })),
  };
}

function capturedGameLog(replay?: ReplayRecord, match?: MatchDraft): AtlasGameLog {
  const games = new Map<number, Omit<AtlasGameLogGame, "entries"> & { entries: StoredEntry[] }>();
  const seenKeys = new Set<string>();
  const seenCounts = new Map<string, number>();
  let captureOrder = 0;
  const add = (gameNumber: number, entry: StoredEntry) => {
    let game = games.get(gameNumber);
    if (!game) {
      game = { id: `captured-log-game-${gameNumber}`, gameNumber, entries: [] };
      games.set(gameNumber, game);
    }
    if (game.entries.length < MAX_ENTRIES) game.entries.push({ ...entry, order: captureOrder++ });
  };
  const signature = (gameNumber: number, text: string, time: string) => `${gameNumber}\u241f${time}\u241f${text}`;
  const structured = (replay?.structuredEvents ?? []).filter((entry) => entry.evidence?.source === "game-log" || entry.id.includes(":row:"))
    .sort((a, b) => (timestamp(a.capturedAt) ?? 0) - (timestamp(b.capturedAt) ?? 0));
  for (const event of structured) {
    const gameNumber = positiveInteger(event.gameNumber) ?? 1;
    const text = string(event.text);
    if (!text) continue;
    const key = `${gameNumber}:${event.id}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    add(gameNumber, { id: key, text: text.slice(0, MAX_TEXT), time: event.labelTime || "", at: timestamp(event.capturedAt) });
    const sig = signature(gameNumber, text, event.labelTime || "");
    seenCounts.set(sig, (seenCounts.get(sig) ?? 0) + 1);
  }
  const evidence: CaptureEvent[] = [...(replay?.events ?? []), ...(match?.rawEvidence ?? replay?.matchSnapshot?.rawEvidence ?? [])];
  evidence.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  for (const event of evidence.slice(0, MAX_MESSAGES)) {
    if (event.platform !== "atlas") continue;
    const gameNumber = positiveInteger(event.payload.gameNumber) ?? positiveInteger(event.payload.atlasBo3GameNumber) ?? positiveInteger(event.payload.atlasHistoryGameNumber)
      ?? positiveInteger([...structured].reverse().find((item) => item.capturedAt <= event.capturedAt)?.gameNumber) ?? 1;
    const occurrences = new Map<string, number>();
    for (const [index, value] of array(event.payload.rows).slice(0, MAX_ENTRIES).reverse().entries()) {
      const row = record(value);
      const raw = string(row?.text).replace(/[\u21ba\u21bb]/g, "").trim();
      // Chat has a separate surface in Atlas. This feature exposes game logs.
      if (!raw || /\bat\s+\d{1,2}:\d{2}\s*:/i.test(raw)) continue;
      const matchTime = raw.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*(.+)$/);
      const text = matchTime ? matchTime[2] : raw;
      const time = matchTime?.[1] ?? "";
      const sig = signature(gameNumber, text, time);
      const occurrence = (occurrences.get(sig) ?? 0) + 1;
      occurrences.set(sig, occurrence);
      const key = `${gameNumber}:${string(row?.key) || `${sig}:${occurrence}`}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const structuredRemaining = seenCounts.get(sig) ?? 0;
      if (structuredRemaining > 0) {
        seenCounts.set(sig, structuredRemaining - 1);
        continue;
      }
      add(gameNumber, { id: key || `${event.id}:${index}`, text: text.slice(0, MAX_TEXT), time,
        at: capturedRowTimestamp(row?.observedAt, event.capturedAt, time) });
    }
  }
  return {
    games: [...games.values()].sort((a, b) => a.gameNumber - b.gameNumber).map((game) => ({ ...game, entries: publicChronologicalEntries(game.entries) })),
    source: games.size ? "captured" : "none", partial: games.size > 0,
  };
}

function publicChronologicalEntries(entries: StoredEntry[]): AtlasGameLogEntry[] {
  return entries.sort((a, b) => (a.at !== undefined && b.at !== undefined ? a.at - b.at : 0) || (a.order ?? 0) - (b.order ?? 0))
    .map(({ at: _at, order: _order, ...entry }) => entry);
}

function capturedRowTimestamp(observedAt: unknown, capturedAt: string, time: string): number | undefined {
  const anchor = timestamp(observedAt) ?? timestamp(capturedAt);
  const clock = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (anchor === undefined || !clock || Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] ?? 0) > 59) return anchor;
  const date = new Date(anchor);
  date.setHours(Number(clock[1]), Number(clock[2]), Number(clock[3] ?? 0), 0);
  // Clock labels contain no date. Anchor them to when the row was observed,
  // choosing the adjacent date when a captured game straddles midnight.
  const halfDay = 12 * 60 * 60 * 1000;
  if (date.getTime() - anchor > halfDay) date.setDate(date.getDate() - 1);
  else if (anchor - date.getTime() > halfDay) date.setDate(date.getDate() + 1);
  return date.getTime();
}

function uniqueEntries(entries: StoredEntry[]): StoredEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => !seen.has(entry.id) && Boolean(seen.add(entry.id)));
}

function readPacket(message: RecordValue): RecordValue | null {
  const parsed = record(message.parsed) ?? record(message.data);
  if (parsed) return parsed;
  const raw = string(message.raw);
  if (!raw || raw.length > 1_500_000) return null;
  try { return record(JSON.parse(raw)); } catch { return null; }
}

function patchOperations(body: RecordValue): RecordValue[] {
  const patch = record(body.patch);
  return [...array(body.operations), ...array(body.ops), ...array(patch?.operations), ...array(patch?.ops)].map(record).filter(isRecord);
}

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}
function isRecord(value: RecordValue | null): value is RecordValue { return value !== null; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function string(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function positiveInteger(value: unknown): number | undefined { const n = number(value); return n !== undefined && Number.isInteger(n) && n > 0 && n < 100 ? n : undefined; }
function timestamp(value: unknown): number | undefined {
  const at = number(value) ?? (typeof value === "string" ? Date.parse(value) : NaN);
  return Number.isFinite(at) && at > 0 && at < 8_640_000_000_000_000 ? at : undefined;
}
function timeLabel(at: number | undefined): string {
  return at === undefined ? "" : new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
