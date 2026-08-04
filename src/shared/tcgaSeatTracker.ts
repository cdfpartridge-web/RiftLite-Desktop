import type { CaptureEvent } from "./types.js";
import {
  TcgaPeerMessageDecoder,
  type TcgaPeerFrame
} from "./tcgaPeerBinaryPack.js";

export type TcgaWentFirst = "1st" | "2nd";

/**
 * Privacy-safe result from the TCGA seat tracker. Player identifiers remain
 * private to the tracker and are never included in this signal.
 */
export interface TcgaSeatSignal {
  channelKey: string;
  capturedAt: string;
  transportSequence: number;
  wentFirst: TcgaWentFirst;
}

interface FirstPlayerEvidence {
  capturedAt: string;
  transportSequence: number;
}

interface ChannelState {
  decoder: TcgaPeerMessageDecoder;
  localPlayerIds: Set<string>;
  opponentPlayerIds: Set<string>;
  firstPlayerEvidence: Map<string, FirstPlayerEvidence>;
  pendingFirstPlayerEvidence: Map<string, FirstPlayerEvidence>;
  emitted: boolean;
  sawCompletedSetup: boolean;
  sawLaterTurn: boolean;
  gameEpoch: string;
}

const TCGA_PLAY_URL = "https://tcg-arena.fr/play";
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_CHANNEL_KEY_LENGTH = 512;
const MAX_DISTINCT_IDENTITIES = 2;
const SEAT_DECODER_LIMITS = {
  maxPendingGroups: 4,
  maxChunksPerGroup: 128,
  maxGroupBytes: 1_000_000
} as const;

/**
 * Infers whether the local TCGA player went first from decoded PeerJS traffic.
 *
 * Identity is deliberately directional: only outbound PLAYER_DATA/GAME_DATA
 * messages establish the local player and only inbound equivalents establish
 * the opponent. A turn-one GAME_DATA message is accepted only after exactly
 * one distinct player has been established on each side.
 */
export class TcgaSeatTracker {
  private readonly channels = new Map<string, ChannelState>();

  push(frame: TcgaPeerFrame): TcgaSeatSignal | null {
    if (!validFrame(frame)) {
      return null;
    }
    let state = this.channels.get(frame.channelKey);
    if (!state) {
      state = createChannelState();
      this.channels.set(frame.channelKey, state);
    }
    const decoded = state.decoder.push(frame);
    for (const message of decoded.messages) {
      observeMessage(state, message.value, message.direction, {
        capturedAt: message.capturedAt,
        transportSequence: message.completedTransportSequence
      });
    }
    return seatSignal(state, frame.channelKey);
  }

  /** Clears identity, evidence, and incomplete PeerJS chunks for one channel. */
  forgetChannel(channelKey: string): void {
    this.channels.delete(channelKey);
  }

  reset(): void {
    this.channels.clear();
  }
}

/** Converts a seat signal into the minimal event consumed by the match logger. */
export function tcgaSeatCaptureEvent(signal: TcgaSeatSignal): CaptureEvent {
  if (
    (signal.wentFirst !== "1st" && signal.wentFirst !== "2nd") ||
    !Number.isSafeInteger(signal.transportSequence) ||
    signal.transportSequence < 0 ||
    !Number.isFinite(Date.parse(signal.capturedAt))
  ) {
    throw new Error("Invalid TCGA seat signal.");
  }
  const capturedAt = new Date(Date.parse(signal.capturedAt)).toISOString();
  const transportSequence = signal.transportSequence;
  const wentFirst = signal.wentFirst;
  return {
    id: `tcga-seat:${Date.parse(capturedAt)}:${transportSequence}:${wentFirst}`,
    platform: "tcga",
    kind: "match-update",
    capturedAt,
    url: TCGA_PLAY_URL,
    payload: {
      active: true,
      reason: "tcga-peer-seat",
      wentFirst
    }
  };
}

function createChannelState(): ChannelState {
  return {
    decoder: new TcgaPeerMessageDecoder(SEAT_DECODER_LIMITS),
    localPlayerIds: new Set(),
    opponentPlayerIds: new Set(),
    firstPlayerEvidence: new Map(),
    pendingFirstPlayerEvidence: new Map(),
    emitted: false,
    sawCompletedSetup: false,
    sawLaterTurn: false,
    gameEpoch: ""
  };
}

function observeMessage(
  state: ChannelState,
  value: unknown,
  direction: TcgaPeerFrame["direction"],
  evidence: FirstPlayerEvidence
): void {
  const message = readRecord(value);
  const type = readString(message?.type);
  if (!message || (type !== "PLAYER_DATA" && type !== "GAME_DATA")) {
    return;
  }
  const payload = readRecord(message.payload);
  const epoch = type === "GAME_DATA" ? gameEpoch(payload) : "";
  if (epoch) {
    if (state.gameEpoch && epoch !== state.gameEpoch && state.emitted) {
      beginNextGame(state, true);
    }
    state.gameEpoch = epoch;
  }
  const playerData = type === "PLAYER_DATA" ? payload : readRecord(payload?.playerData);
  const setupStep = readNonNegativeInteger(playerData?.setupStep);
  if (state.emitted && state.sawCompletedSetup && setupStep !== null && setupStep <= 1) {
    beginNextGame(state, true);
  }
  const senderId = readIdentifier(message.gameId);
  if (senderId) {
    const identities = direction === "out" ? state.localPlayerIds : state.opponentPlayerIds;
    rememberBoundedIdentity(identities, senderId);
  }
  if (setupStep !== null && setupStep >= 10) {
    state.sawCompletedSetup = true;
  }
  if (type !== "GAME_DATA") {
    return;
  }
  const turnCount = readNonNegativeInteger(payload?.turnCount);
  if (turnCount !== null && turnCount >= 2) {
    if (state.emitted) {
      state.sawLaterTurn = true;
      state.pendingFirstPlayerEvidence.clear();
    }
    return;
  }
  if (!payload || turnCount !== 1) {
    return;
  }
  const firstPlayerId = readIdentifier(payload.currentPlayer);
  if (state.emitted) {
    if (state.sawLaterTurn && firstPlayerId) {
      rememberBoundedEvidence(state.pendingFirstPlayerEvidence, firstPlayerId, evidence);
    }
    return;
  }
  if (
    !firstPlayerId
  ) {
    return;
  }
  rememberBoundedEvidence(state.firstPlayerEvidence, firstPlayerId, evidence);
}

function beginNextGame(state: ChannelState, promotePendingEvidence: boolean): void {
  state.firstPlayerEvidence = promotePendingEvidence
    ? new Map(state.pendingFirstPlayerEvidence)
    : new Map();
  state.pendingFirstPlayerEvidence.clear();
  state.emitted = false;
  state.sawCompletedSetup = false;
  state.sawLaterTurn = false;
}

function rememberBoundedIdentity(identities: Set<string>, identifier: string): void {
  if (identities.has(identifier) || identities.size < MAX_DISTINCT_IDENTITIES) {
    identities.add(identifier);
  }
}

function rememberBoundedEvidence(
  evidenceByPlayer: Map<string, FirstPlayerEvidence>,
  playerId: string,
  evidence: FirstPlayerEvidence
): void {
  if (evidenceByPlayer.has(playerId) || evidenceByPlayer.size >= MAX_DISTINCT_IDENTITIES) {
    return;
  }
  evidenceByPlayer.set(playerId, evidence);
}

function gameEpoch(payload: Record<string, unknown> | null): string {
  const options = readRecord(payload?.gameOptions);
  const version = readEpochPart(options?.version);
  const senderId = readIdentifier(options?.senderId);
  // startingPlayer describes TCGA's chooser/random-selection state and can
  // disagree with who actually takes turn one; it is never seat evidence.
  return version && senderId ? `${version}\u0000${senderId}` : "";
}

function seatSignal(state: ChannelState, channelKey: string): TcgaSeatSignal | null {
  if (
    state.emitted ||
    state.localPlayerIds.size !== 1 ||
    state.opponentPlayerIds.size !== 1 ||
    state.firstPlayerEvidence.size !== 1
  ) {
    return null;
  }
  const localPlayerId = firstValue(state.localPlayerIds);
  const opponentPlayerId = firstValue(state.opponentPlayerIds);
  const firstPlayerId = firstValue(state.firstPlayerEvidence.keys());
  if (
    !localPlayerId ||
    !opponentPlayerId ||
    !firstPlayerId ||
    localPlayerId === opponentPlayerId ||
    (firstPlayerId !== localPlayerId && firstPlayerId !== opponentPlayerId)
  ) {
    return null;
  }
  const evidence = state.firstPlayerEvidence.get(firstPlayerId);
  if (!evidence) {
    return null;
  }
  state.emitted = true;
  return {
    channelKey,
    capturedAt: evidence.capturedAt,
    transportSequence: evidence.transportSequence,
    wentFirst: firstPlayerId === localPlayerId ? "1st" : "2nd"
  };
}

function validFrame(value: unknown): value is TcgaPeerFrame {
  const frame = readRecord(value);
  return Boolean(
    frame &&
    (frame.direction === "in" || frame.direction === "out") &&
    typeof frame.channelKey === "string" &&
    frame.channelKey.length > 0 &&
    frame.channelKey.length <= MAX_CHANNEL_KEY_LENGTH &&
    typeof frame.capturedAt === "string" &&
    Number.isFinite(Date.parse(frame.capturedAt)) &&
    Number.isSafeInteger(frame.recordSeq) &&
    Number(frame.recordSeq) >= 0 &&
    Number.isSafeInteger(frame.transportSequence) &&
    Number(frame.transportSequence) >= 0 &&
    frame.bytes instanceof Uint8Array
  );
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readIdentifier(value: unknown): string {
  const identifier = readString(value);
  return identifier.length > 0 && identifier.length <= MAX_IDENTIFIER_LENGTH
    ? identifier
    : "";
}

function readNonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function readEpochPart(value: unknown): string {
  if (typeof value === "string") {
    const clean = value.trim();
    return clean.length > 0 && clean.length <= MAX_IDENTIFIER_LENGTH ? clean : "";
  }
  return Number.isSafeInteger(value) && Number(value) >= 0 ? String(value) : "";
}

function firstValue<T>(values: Iterable<T>): T | undefined {
  return values[Symbol.iterator]().next().value as T | undefined;
}
