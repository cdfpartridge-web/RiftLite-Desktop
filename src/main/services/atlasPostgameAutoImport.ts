import { atlasPlayerIdFromUrl, atlasRoomCodeFromUrl } from "../../shared/atlasSeatTracker.js";
import type { AutomaticAtlasPostgameCapture } from "./rawCaptureService.js";
import type { AtlasPostgameQueryResult, AtlasPostgameQueryTarget } from "./atlasPostgameQuery.js";

export type AtlasPostgameTarget = Omit<AtlasPostgameQueryTarget, "expectedPageUrl">;
const MAX_AGE_MS = 6 * 60 * 60_000;
const RETRY_DELAYS = [15_000, 30_000, 60_000, 120_000, 300_000];
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string => typeof value === "string" && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f]/.test(value) ? value : "";
const timestamp = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value > 1_500_000_000_000 && value < 4_000_000_000_000 ? value : 0;
const roomCode = (value: unknown): string => typeof value === "string" && /^[A-Z0-9]{3,16}$/.test(value) ? value : "";
const number = (value: unknown): number => value === 1 || value === 2 || value === 3 ? value : 0;
export const atlasPostgameGameKey = (target: AtlasPostgameTarget): string => `${target.roomCode}:${target.roomCreatedAt}:${target.gameNumber}:${target.gameHistoryStartedAt}`;

type Room = {
  fields: Record<string, unknown>; localPlayerId: string; participantIds: string[];
  capturedSnapshot: boolean; sequence?: number; blocked: boolean;
  fallbackSequenceValid: boolean; fallbackIdentityChanged: boolean;
};
type Found = { target: AtlasPostgameTarget; format: "bo1" | "bo3"; winner: string; seriesComplete: boolean };
const ROOM_FIELDS = ["roomCode", "createdAt", "gameNumber", "matchFormat", "gameVariant", "roomMode", "testMode", "gameHistoryStartedAt", "gameHistoryEndedAt", "gameOutcome", "winsByPlayerId", "phase", "rewindProtocolVersion"];

/** Read only already-persisted authoritative evidence. Never infer identities from labels or a browser route. */
export async function extractAtlasPostgameTargets(input: unknown, canContinue: () => boolean = () => true): Promise<AtlasPostgameTarget[]> {
  const raw = record(input);
  if (raw?.schema !== "riftreplay-raw-capture" || raw.version !== 1 || !Array.isArray(raw.messages) || raw.messages.length > 50_000) return [];
  const sockets = new Map<string, { room: string; player: string }>();
  for (const value of (Array.isArray(raw.sockets) ? raw.sockets.slice(0, 128) : [])) {
    const socket = record(value);
    try {
      const url = new URL(String(socket?.url || ""));
      if (url.protocol !== "wss:" || url.hostname !== "realtime.riftatlas-workers.com" || !url.pathname.startsWith("/parties/match/")) continue;
      const player = text(atlasPlayerIdFromUrl(url.href)), room = roomCode(atlasRoomCodeFromUrl(url.href));
      if (player && room && text(socket?.socketId)) sockets.set(String(socket!.socketId), { room, player });
    } catch { /* Unsupported socket metadata is not evidence. */ }
  }
  const rooms = new Map<string, Room>(), found = new Map<string, Found>();
  let bytes = 0;
  for (let index = 0; index < raw.messages.length; index++) {
    if (index % 64 === 0) {
      if (!canContinue()) throw new Error("Atlas post-game import deferred while a game is active.");
      if (index) await new Promise<void>(resolve => setImmediate(resolve));
      if (!canContinue()) throw new Error("Atlas post-game import deferred while a game is active.");
    }
    const message = record(raw.messages[index]);
    if (!message || message.dir !== "in" || message.drop === true) continue;
    let packet: Record<string, unknown> | null = null;
    try {
      if (typeof message.raw === "string") {
        bytes += Buffer.byteLength(message.raw);
        if (bytes > 12 * 1024 * 1024 || message.raw.length > 2 * 1024 * 1024) return [];
        packet = record(JSON.parse(message.raw));
      } else packet = record(message.parsed ?? message.raw);
    } catch { continue; }
    if (!packet || !["room_shell_sync", "authoritative_snapshot", "authoritative_patch_commit"].includes(String(packet.type))) continue;
    const payload = record(packet.payload), shell = record(packet.sessionDoc ?? payload?.sessionDoc), snapshot = record(packet.snapshot ?? payload?.snapshot);
    const socket = sockets.get(text(message.socketId));
    const code = roomCode(packet.gameInstanceId) || roomCode(packet.roomCode) || roomCode(snapshot?.roomCode) || roomCode(shell?.roomCode) || socket?.room || "";
    if (!code || socket && socket.room !== code) continue;
    if (rooms.size >= 6 && !rooms.has(code)) return [];
    const state = rooms.get(code) ?? { fields: {}, localPlayerId: "", participantIds: [], capturedSnapshot: false, blocked: false, fallbackSequenceValid: false, fallbackIdentityChanged: false };
    rooms.set(code, state);
    const viewer = record(shell?.viewer ?? snapshot?.viewer), self = record(shell?.selfPlayer ?? snapshot?.selfPlayer);
    const ids = [socket?.player, text(packet.viewerPlayerId), text(viewer?.playerId), text(self?.id ?? self?.playerId)].filter((value): value is string => Boolean(value));
    if (new Set(ids).size > 1 || viewer?.role !== undefined && viewer.role !== "player" || state.localPlayerId && ids.some(id => id !== state.localPlayerId)) { state.blocked = true; continue; }
    if (ids[0]) state.localPlayerId = ids[0];
    const apply = (fields: Record<string, unknown>) => {
      const nextNumber = number(fields.gameNumber), nextStart = timestamp(fields.gameHistoryStartedAt), nextCreated = timestamp(fields.createdAt);
      if (nextCreated && timestamp(state.fields.createdAt) && nextCreated !== state.fields.createdAt || nextNumber && number(state.fields.gameNumber) && nextNumber !== state.fields.gameNumber || nextStart && timestamp(state.fields.gameHistoryStartedAt) && nextStart !== state.fields.gameHistoryStartedAt) {
        for (const key of ["gameHistoryStartedAt", "gameHistoryEndedAt", "gameOutcome"]) delete state.fields[key];
        state.capturedSnapshot = false;
        state.fallbackSequenceValid = false;
        state.fallbackIdentityChanged = true;
      }
      for (const key of ROOM_FIELDS) if (Object.hasOwn(fields, key)) state.fields[key] = fields[key];
    };
    if (shell) apply(shell);
    if (snapshot && packet.type === "authoritative_snapshot") {
      apply(snapshot);
      const players = Array.isArray(snapshot.players) ? snapshot.players.map(record).map(player => text(player?.id)) : [];
      if (players.length !== 2 || new Set(players).size !== 2 || players.some(id => !id)) { state.blocked = true; continue; }
      if (state.participantIds.length && players.some(id => !state.participantIds.includes(id))) state.fallbackIdentityChanged = true;
      state.participantIds = players; state.capturedSnapshot = true;
      if (Number.isSafeInteger(packet.sequence)) state.sequence = Number(packet.sequence);
      state.fallbackSequenceValid = Number.isSafeInteger(packet.sequence) && Number(packet.sequence) >= 0;
    }
    if (packet.type === "authoritative_patch_commit") {
      const patch = record(packet.patch ?? payload?.patch);
      if (!Array.isArray(patch?.operations) || patch.operations.length > 512) { state.fallbackSequenceValid = false; continue; }
      if (!Number.isSafeInteger(packet.baseSequence) || !Number.isSafeInteger(packet.sequence) || packet.baseSequence !== state.sequence || Number(packet.sequence) !== Number(packet.baseSequence) + 1) state.fallbackSequenceValid = false;
      if (Number.isSafeInteger(packet.baseSequence) && state.sequence !== packet.baseSequence) { state.capturedSnapshot = false; continue; }
      if (Number.isSafeInteger(packet.sequence) && state.sequence !== undefined && Number(packet.sequence) < state.sequence) continue;
      for (const operation of patch.operations) {
        const op = record(operation), fields = record(op?.fields);
        if (op?.op === "unset_room_fields" && (!Array.isArray(op.fields) || op.fields.some(key => ROOM_FIELDS.includes(String(key))))) state.fallbackIdentityChanged = true;
        if (op?.op === "set_room_fields" && !fields) state.fallbackSequenceValid = false;
        if (op?.op === "set_room_fields" && fields) apply(fields);
      }
      if (Number.isSafeInteger(packet.sequence)) state.sequence = Number(packet.sequence);
    }
    const fields = state.fields, startedAt = timestamp(fields.gameHistoryStartedAt), endedAt = timestamp(fields.gameHistoryEndedAt), createdAt = timestamp(fields.createdAt);
    const gameNumber = number(fields.gameNumber) || (fields.matchFormat === "bo1" ? 1 : 0);
    const outcome = record(fields.gameOutcome), winners = outcome?.winnerPlayerIds;
    if (state.blocked || !state.capturedSnapshot || !state.participantIds.includes(state.localPlayerId) || !createdAt || !startedAt || !endedAt || endedAt < startedAt || createdAt > startedAt || !gameNumber || !["bo1", "bo3"].includes(String(fields.matchFormat)) || fields.roomMode !== "multiplayer" || fields.gameVariant !== "duel" || fields.testMode !== false || fields.rewindProtocolVersion !== 5 || !["score", "concession"].includes(String(outcome?.reason)) || !Array.isArray(winners) || winners.length !== 1 || !state.participantIds.includes(String(winners[0]))) continue;
    const wins = record(fields.winsByPlayerId);
    const seriesComplete = fields.matchFormat === "bo1" || state.participantIds.some(id => wins?.[id] === 2);
    const target = { roomCode: code, roomCreatedAt: createdAt, gameNumber, gameHistoryStartedAt: startedAt, gameHistoryEndedAt: endedAt, localPlayerId: state.localPlayerId };
    found.set(atlasPostgameGameKey(target), { target, format: fields.matchFormat as "bo1" | "bo3", winner: String(winners[0]), seriesComplete });
  }
  if (!canContinue()) throw new Error("Atlas post-game import deferred while a game is active.");
  const entries = [...found.values()].filter(entry => !rooms.get(entry.target.roomCode)?.blocked).sort((a, b) => a.target.gameNumber - b.target.gameNumber);
  // Some completed BO1s contain the exact game identity but never receive
  // Atlas's terminal room fields. This is only a request to check Atlas after
  // leaving gameplay: its ready/ownership/completed-export gates remain the
  // authority. Never turn a captured score into a winner or an end timestamp.
  if (found.size === 0 && rooms.size === 1) {
    const [code, state] = [...rooms][0], fields = state.fields;
    const createdAt = timestamp(fields.createdAt), startedAt = timestamp(fields.gameHistoryStartedAt);
    const gameNumber = fields.gameNumber === undefined ? 1 : number(fields.gameNumber);
    if (!state.blocked && state.capturedSnapshot && state.fallbackSequenceValid && !state.fallbackIdentityChanged
      && state.participantIds.length === 2 && state.participantIds.includes(state.localPlayerId)
      && createdAt && startedAt && createdAt <= startedAt && gameNumber === 1 && fields.matchFormat === "bo1"
      && fields.roomMode === "multiplayer" && fields.gameVariant === "duel" && fields.testMode === false && fields.rewindProtocolVersion === 5
      && fields.gameHistoryEndedAt === undefined && fields.gameOutcome === undefined) {
      return [{ roomCode: code, roomCreatedAt: createdAt, gameNumber, gameHistoryStartedAt: startedAt, localPlayerId: state.localPlayerId, completionCheck: "atlas" }];
    }
  }
  if (!entries.length || entries.length > 3 || new Set(entries.map(item => item.target.gameNumber)).size !== entries.length || new Set(entries.map(item => item.format)).size !== 1 || new Set(entries.map(item => item.target.localPlayerId)).size !== 1) return [];
  const wins = new Map<string, number>();
  for (const entry of entries) wins.set(entry.winner, (wins.get(entry.winner) ?? 0) + 1);
  if (entries[0].format === "bo3" && !entries.some(entry => entry.seriesComplete) && ![...wins.values()].some(count => count >= 2)) return [];
  return entries.map(entry => entry.target);
}

type Attempt = { count: number; nextAt: number; done: boolean };
type Job = { completedAt: number; targets?: AtlasPostgameTarget[]; read: Attempt; games: Map<string, Attempt> };
/** Fixed enums/counts only: never include capture/game/account IDs, payloads or exception text. */
export type AtlasPostgameDiagnostic = {
  stage: "discovery" | "capture" | "query" | "attachment";
  outcome: "ready" | "attached" | "exists" | "pending" | "restricted" | "expired" | "unavailable" | "retry" | "exhausted";
  attempt: number;
};
export class AtlasPostgameAutoImport {
  private pending?: Promise<void>;
  private disposed = false;
  private discoveryFailureReported = false;
  private readonly jobs = new Map<string, Job>();
  constructor(private readonly deps: {
    listCaptures(): Promise<AutomaticAtlasPostgameCapture[]>;
    readCapture(captureSessionId: string): Promise<unknown>;
    query(target: AtlasPostgameTarget): Promise<AtlasPostgameQueryResult>;
    deliver(captureSessionId: string, gameNumber: number, envelope: unknown): Promise<"attached" | "exists">;
    ready(): boolean;
    now?: () => number;
    report?: (captureSessionId: string, state: "attached" | "exists" | "waiting" | "unavailable") => void;
    diagnostic?: (event: AtlasPostgameDiagnostic) => void;
  }) {}
  private diagnose(stage: AtlasPostgameDiagnostic["stage"], outcome: AtlasPostgameDiagnostic["outcome"], attempt: number): void {
    // Optional observability must not change collection or its retry budget.
    try { this.deps.diagnostic?.({ stage, outcome, attempt }); } catch { /* Diagnostic sink unavailable. */ }
  }
  dispose(): void { this.disposed = true; this.jobs.clear(); }
  private ready(): boolean { return !this.disposed && this.deps.ready(); }
  private async current(capture: AutomaticAtlasPostgameCapture): Promise<boolean> {
    if (!this.ready()) return false;
    const latest = await this.deps.listCaptures();
    return this.ready() && latest.some(item => item.captureSessionId === capture.captureSessionId && item.accountUid === capture.accountUid && item.remoteReplayId === capture.remoteReplayId && item.completedAt === capture.completedAt);
  }
  run(): Promise<void> {
    if (this.pending) return this.pending;
    if (!this.ready()) return Promise.resolve();
    const task = this.runNow().catch(() => {
      if (!this.discoveryFailureReported) this.diagnose("discovery", "retry", 0);
      this.discoveryFailureReported = true;
    }).finally(() => { this.pending = undefined; });
    this.pending = task; return task;
  }
  private retry(attempt: Attempt, now: number): void {
    attempt.nextAt = now + (RETRY_DELAYS[attempt.count - 1] ?? Infinity);
    if (attempt.count > RETRY_DELAYS.length) attempt.done = true;
  }
  private async runNow(): Promise<void> {
    const now = (this.deps.now ?? Date.now)();
    for (const [key, job] of this.jobs) if (now - job.completedAt > MAX_AGE_MS) this.jobs.delete(key);
    const captures = (await this.deps.listCaptures()).filter(item => Number.isFinite(item.completedAt) && item.completedAt > 0 && item.completedAt <= now + 60_000 && now - item.completedAt <= MAX_AGE_MS).sort((a, b) => b.completedAt - a.completedAt).slice(0, 10);
    this.discoveryFailureReported = false;
    if (!this.ready()) return;
    let requests = 0, reads = 0;
    for (const capture of captures) {
      if (!this.ready() || requests >= 3 || reads >= 3) break;
      const key = JSON.stringify([capture.captureSessionId, capture.remoteReplayId, capture.accountUid, capture.completedAt]);
      let job = this.jobs.get(key);
      if (!job) { job = { completedAt: capture.completedAt, read: { count: 0, nextAt: 0, done: false }, games: new Map() }; this.jobs.set(key, job); }
      if (!job.targets) {
        if (job.read.done || now < job.read.nextAt) continue;
        job.read.count++; reads++;
        try {
          if (!await this.current(capture)) { job.read.count--; return; }
          const raw = await this.deps.readCapture(capture.captureSessionId);
          if (!this.ready()) { job.read.count--; return; }
          job.targets = await extractAtlasPostgameTargets(raw, () => this.ready());
          this.diagnose("capture", job.targets.length ? "ready" : "unavailable", job.read.count);
          if (!job.targets.length) { job.read.done = true; this.deps.report?.(capture.captureSessionId, "unavailable"); }
        } catch {
          if (!this.ready()) { job.read.count--; return; }
          this.retry(job.read, now);
          this.diagnose("capture", job.read.done ? "exhausted" : "retry", job.read.count); continue;
        }
      }
      for (const target of job.targets ?? []) {
        if (!this.ready() || requests >= 3) return;
        const gameKey = atlasPostgameGameKey(target), attempt = job.games.get(gameKey) ?? { count: 0, nextAt: 0, done: false };
        if (attempt.done || now < attempt.nextAt) continue;
        job.games.set(gameKey, attempt); attempt.count++; requests++;
        let stage: "query" | "attachment" = "query";
        try {
          if (!await this.current(capture)) { attempt.count--; return; }
          const result = await this.deps.query(target);
          if (result.status === "deferred" && result.gameKey === gameKey) {
            // A fallback candidate cannot query while Atlas is still on /game.
            // Recheck on a later idle pass without spending its network retry
            // budget or repeatedly writing waiting diagnostics.
            attempt.count--; attempt.nextAt = now + RETRY_DELAYS[0];
            if (!this.ready()) return;
            continue;
          }
          if (!this.ready()) { this.retry(attempt, now); return; }
          if (result.gameKey !== gameKey) throw new Error("Atlas returned a different game.");
          if (result.status === "ready" && result.replay) {
            if (!await this.current(capture)) { this.retry(attempt, now); return; }
            stage = "attachment";
            const delivered = await this.deps.deliver(capture.captureSessionId, target.gameNumber, result.replay);
            if (!this.ready()) { this.retry(attempt, now); return; }
            attempt.done = true; this.diagnose("attachment", delivered, attempt.count); this.deps.report?.(capture.captureSessionId, delivered);
          } else if (result.status === "pending") { this.retry(attempt, now); this.diagnose("query", attempt.done ? "exhausted" : "pending", attempt.count); this.deps.report?.(capture.captureSessionId, "waiting"); }
          else { attempt.done = true; this.diagnose("query", result.status === "restricted" ? "restricted" : result.status === "expired" ? "expired" : "unavailable", attempt.count); this.deps.report?.(capture.captureSessionId, "unavailable"); }
        } catch { this.retry(attempt, now); this.diagnose(stage, attempt.done ? "exhausted" : "retry", attempt.count); }
      }
    }
    // Finite recent-history cache, containing only small identifiers and retry budgets.
    while (this.jobs.size > 30) { const oldest = [...this.jobs].sort((a, b) => a[1].completedAt - b[1].completedAt)[0]; this.jobs.delete(oldest[0]); }
  }
}
