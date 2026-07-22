import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import {
  TcgaPeerMessageDecoder,
  type TcgaDecodedGameMessage,
  type TcgaPeerDirection
} from "../../shared/tcgaPeerBinaryPack.js";
import type { TcgaReplayResearchAnalysisReport } from "../../shared/types.js";

const gunzipAsync = promisify(gunzip);

const MAX_COMPRESSED_BUNDLE_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BUNDLE_BYTES = 256 * 1024 * 1024;
const MAX_JSONL_LINE_BYTES = 6 * 1024 * 1024;
const MAX_RECORDS = 100_000;
const MAX_RTC_FRAME_BYTES = 2 * 1024 * 1024;

interface AnalyzeOptions {
  compressedBytes?: number;
  compressedSha256?: string;
  expectedCompressedSha256?: string;
}

interface AnalysisAccumulator {
  messageTypes: TcgaReplayResearchAnalysisReport["messageTypes"];
  coverage: TcgaReplayResearchAnalysisReport["coverage"];
  perspectivePlayerIds: Set<string>;
  hiddenCardIdentityObserved: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function fixedDirection(value: unknown): TcgaPeerDirection | null {
  return value === "in" || value === "out" ? value : null;
}

function exactBytes(value: Uint8Array): Uint8Array {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

function strictBase64Bytes(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_RTC_FRAME_BYTES * 2) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    return null;
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength < 1 || decoded.byteLength > MAX_RTC_FRAME_BYTES) {
    return null;
  }
  return exactBytes(decoded);
}

function scanCard(value: unknown, accumulator: AnalysisAccumulator): void {
  const card = asRecord(value);
  if (!card) return;
  const hiddenTo = asRecord(card.hiddenTo);
  const hiddenStatus = safeString(hiddenTo?.status).toLowerCase();
  const cardData = asRecord(card.cardData);
  if (
    hiddenTo &&
    hiddenStatus !== "no" &&
    cardData &&
    (typeof cardData.id === "string" || typeof cardData.name === "string" || asRecord(cardData.name))
  ) {
    accumulator.hiddenCardIdentityObserved = true;
  }
}

function scanCards(value: unknown, accumulator: AnalysisAccumulator): void {
  if (!Array.isArray(value)) return;
  for (const card of value) scanCard(card, accumulator);
}

function observePlayerData(
  value: unknown,
  playerId: unknown,
  accumulator: AnalysisAccumulator,
  countSnapshot = true
): void {
  const playerData = asRecord(value);
  if (!playerData) return;
  accumulator.coverage.playerState = true;
  if (countSnapshot) accumulator.coverage.stateSnapshots += 1;
  if (typeof playerId === "string" && playerId) accumulator.perspectivePlayerIds.add(playerId);

  const setupStep = finiteInteger(playerData.setupStep, -1);
  if (setupStep >= 0 && setupStep < 10) accumulator.coverage.setup = true;
  if (setupStep > 0 && setupStep < 10) accumulator.coverage.mulligan = true;
  if (playerData.isEliminated === true) accumulator.coverage.terminal = true;
  scanCards(playerData.visibleCards, accumulator);
  scanCards(playerData.deck, accumulator);
}

function observeHistory(value: unknown, accumulator: AnalysisAccumulator): void {
  const history = asRecord(value);
  if (!history) return;
  accumulator.coverage.history = true;
  accumulator.coverage.historyEvents += 1;
  const text = safeString(history.text);
  if (/mulligan/i.test(text)) accumulator.coverage.mulligan = true;
  if (/turnStarted/i.test(text)) accumulator.coverage.turns = true;
  if (/(?:conced|victor|defeat|winner|eliminat|game(?:\.|_|-)?end|match(?:\.|_|-)?end)/i.test(text)) {
    accumulator.coverage.terminal = true;
  }
  const params = asRecord(history.params);
  scanCard(params?.card, accumulator);
  scanCards(params?.cards, accumulator);
}

function observeTerminalPayload(payload: Record<string, unknown>, accumulator: AnalysisAccumulator): void {
  for (const key of [
    "winner",
    "result",
    "gameResult",
    "matchResult",
    "gameEnded",
    "matchEnded",
    "endGame"
  ]) {
    const value = payload[key];
    if (value === true || (typeof value === "string" && value.trim())) {
      accumulator.coverage.terminal = true;
    }
  }
}

function observeLogicalMessage(
  message: TcgaDecodedGameMessage,
  accumulator: AnalysisAccumulator
): void {
  const value = asRecord(message.value);
  if (!value) {
    accumulator.messageTypes.other += 1;
    return;
  }
  const type = safeString(value.type);
  const payload = asRecord(value.payload);
  const playerId = value.gameId;
  switch (type) {
    case "GAME_DATA": {
      accumulator.messageTypes.gameData += 1;
      if (!payload) return;
      observeTerminalPayload(payload, accumulator);
      if ("playerData" in payload) {
        observePlayerData(payload.playerData, playerId, accumulator);
      }
      if ("newToHistory" in payload) observeHistory(payload.newToHistory, accumulator);
      if ("gameOptions" in payload) accumulator.coverage.setup = true;
      if ("decklist" in payload) accumulator.coverage.decklists += 1;
      if ("stackOrder" in payload) {
        accumulator.coverage.stack = true;
        accumulator.coverage.stackUpdates += 1;
      }
      if ("revealed" in payload) {
        accumulator.coverage.reveal = true;
        accumulator.coverage.revealUpdates += 1;
        const revealed = asRecord(payload.revealed);
        scanCards(revealed?.cards, accumulator);
      }
      if ("turnCount" in payload || "currentPlayer" in payload) {
        accumulator.coverage.turns = true;
      }
      if ("turnCount" in payload) {
        accumulator.coverage.turnTransitions += 1;
        accumulator.coverage.maxTurnCount = Math.max(
          accumulator.coverage.maxTurnCount,
          finiteInteger(payload.turnCount)
        );
      }
      return;
    }
    case "PLAYER_DATA":
      accumulator.messageTypes.playerData += 1;
      if (finiteInteger(payload?.setupStep, -1) >= 0 && finiteInteger(payload?.setupStep, -1) < 10) {
        accumulator.coverage.initialState = true;
      }
      observePlayerData(payload, playerId, accumulator, false);
      return;
    case "NEWCOMMER_GAMEDATA": {
      accumulator.messageTypes.newcomerGameData += 1;
      const players = asRecord(payload?.players);
      const newcomerTurn = finiteInteger(asRecord(payload?.general)?.turnCount, -1);
      const hasSetupPlayer = Object.values(players ?? {}).some((player) => {
        const setupStep = finiteInteger(asRecord(player)?.setupStep, -1);
        return setupStep >= 0 && setupStep < 10;
      });
      if (newcomerTurn >= 0 && newcomerTurn <= 1 && hasSetupPlayer) {
        accumulator.coverage.initialState = true;
      }
      for (const [id, player] of Object.entries(players ?? {})) {
        observePlayerData(player, id, accumulator, false);
      }
      const general = asRecord(payload?.general);
      const turnCount = finiteInteger(general?.turnCount);
      if (turnCount > 0) {
        accumulator.coverage.turns = true;
        accumulator.coverage.maxTurnCount = Math.max(accumulator.coverage.maxTurnCount, turnCount);
      }
      return;
    }
    case "GAMEDATA_REQUEST":
      accumulator.messageTypes.gameDataRequest += 1;
      return;
    case "ping":
      accumulator.messageTypes.ping += 1;
      return;
    case "pong":
      accumulator.messageTypes.pong += 1;
      return;
    default:
      accumulator.messageTypes.other += 1;
  }
}

function researchEventPayload(record: Record<string, unknown>): Record<string, unknown> | null {
  const outer = asRecord(record.payload);
  return asRecord(outer?.payload);
}

function observeNonRtcRecord(
  record: Record<string, unknown>,
  accumulator: AnalysisAccumulator
): void {
  const kind = safeString(record.kind);
  if (kind !== "preload-dom-checkpoint" && kind !== "capture-match-end") return;
  if (kind === "preload-dom-checkpoint") accumulator.coverage.domCheckpoints += 1;
  const payload = researchEventPayload(record);
  const matchSnapshot = asRecord(payload?.matchSnapshot) ?? payload;
  const terminalAfterGameplay = accumulator.coverage.playerState &&
    (accumulator.coverage.turns || accumulator.coverage.history);
  const explicitResult = safeString(matchSnapshot?.endText).trim() ||
    safeString(matchSnapshot?.result).trim() ||
    safeString(matchSnapshot?.winner).trim() ||
    safeString(matchSnapshot?.reason) === "result-text-detected";
  if (terminalAfterGameplay && explicitResult) {
    accumulator.coverage.terminal = true;
  }
}

function reasonCodes(
  source: TcgaReplayResearchAnalysisReport["sourceIntegrity"],
  transport: TcgaReplayResearchAnalysisReport["transport"],
  coverage: TcgaReplayResearchAnalysisReport["coverage"]
): string[] {
  const reasons = new Set<string>();
  if (!source.headerPresent) reasons.add("missing-session-header");
  if (!source.footerPresent) reasons.add("missing-session-footer");
  if (source.invalidJsonLines > 0) reasons.add("invalid-json-lines");
  if (source.compressedSha256Matches === false) reasons.add("checksum-mismatch");
  if (!source.contiguousSequence || !source.declaredRecordCountMatches) reasons.add("record-sequence-gap");
  if (source.capped) reasons.add("capture-capped");
  if (source.droppedRecords > 0) reasons.add("records-dropped");
  if (transport.frames < 1) reasons.add("no-rtc-frames");
  if (transport.truncatedFrames > 0) reasons.add("truncated-rtc-frame");
  if (transport.unavailableFrames > 0) reasons.add("unavailable-rtc-frame");
  if (transport.decodeFailures > 0) reasons.add("rtc-decode-failures");
  if (transport.incompleteChunkGroups > 0) reasons.add("incomplete-chunk-groups");
  if (!coverage.initialState) reasons.add("missing-initial-state");
  if (!coverage.playerState) reasons.add("missing-player-state");
  if (!coverage.terminal) reasons.add("missing-terminal-evidence");
  if (!coverage.turns || !coverage.history) reasons.add("insufficient-gameplay-coverage");
  return [...reasons];
}

function assessment(
  source: TcgaReplayResearchAnalysisReport["sourceIntegrity"],
  transport: TcgaReplayResearchAnalysisReport["transport"],
  messageTypes: TcgaReplayResearchAnalysisReport["messageTypes"],
  coverage: TcgaReplayResearchAnalysisReport["coverage"]
): TcgaReplayResearchAnalysisReport["assessment"] {
  const decodedRatio = transport.frames > 0 ? transport.decodedFrames / transport.frames : 0;
  const decoderFixture = transport.frames > 0 &&
    decodedRatio >= 0.95 &&
    messageTypes.gameData > 0 &&
    coverage.playerState
    ? "usable"
    : transport.decodedFrames > 0 && transport.logicalMessages > 0
      ? "degraded"
      : "unusable";
  const complete = decoderFixture === "usable" &&
    source.headerPresent &&
    source.footerPresent &&
    source.invalidJsonLines === 0 &&
    source.compressedSha256Matches !== false &&
    source.contiguousSequence &&
    source.declaredRecordCountMatches &&
    !source.capped &&
    source.droppedRecords === 0 &&
    transport.decodeFailures === 0 &&
    transport.truncatedFrames === 0 &&
    transport.unavailableFrames === 0 &&
    transport.incompleteChunkGroups === 0 &&
    coverage.initialState &&
    coverage.playerState &&
    coverage.setup &&
    coverage.turns &&
    coverage.history &&
    coverage.terminal;
  const replayTimeline = complete
    ? "complete"
    : decoderFixture !== "unusable" && coverage.playerState && coverage.history
      ? "partial"
      : "unusable";
  return {
    decoderFixture,
    replayTimeline,
    reasonCodes: reasonCodes(source, transport, coverage)
  };
}

export function analyzeTcgaReplayResearchJsonl(
  input: Uint8Array,
  options: AnalyzeOptions = {}
): TcgaReplayResearchAnalysisReport {
  if (input.byteLength > MAX_EXPANDED_BUNDLE_BYTES) {
    throw new Error("TCGA research capture exceeds the expanded analysis limit.");
  }
  const text = Buffer.from(input).toString("utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const decoder = new TcgaPeerMessageDecoder();
  const accumulator: AnalysisAccumulator = {
    messageTypes: {
      gameData: 0,
      playerData: 0,
      newcomerGameData: 0,
      gameDataRequest: 0,
      ping: 0,
      pong: 0,
      other: 0
    },
    coverage: {
      initialState: false,
      playerState: false,
      setup: false,
      mulligan: false,
      turns: false,
      history: false,
      stack: false,
      reveal: false,
      terminal: false,
      perspectivePlayers: 0,
      stateSnapshots: 0,
      historyEvents: 0,
      turnTransitions: 0,
      maxTurnCount: 0,
      stackUpdates: 0,
      revealUpdates: 0,
      decklists: 0,
      domCheckpoints: 0
    },
    perspectivePlayerIds: new Set(),
    hiddenCardIdentityObserved: false
  };

  let validJsonLines = 0;
  let invalidJsonLines = 0;
  let expectedSequence = 0;
  let contiguousSequence = true;
  let headerPresent = false;
  let footerPresent = false;
  let declaredRecordCount = -1;
  let capped = false;
  let droppedRecords = 0;
  let records = 0;
  let frames = 0;
  let decodedFrames = 0;
  let truncatedFrames = 0;
  let unavailableFrames = 0;
  let chunkFrames = 0;
  let logicalMessages = 0;
  const directions = { in: 0, out: 0 };

  for (const line of lines.slice(0, MAX_RECORDS + 2)) {
    if (Buffer.byteLength(line, "utf8") > MAX_JSONL_LINE_BYTES) {
      invalidJsonLines += 1;
      contiguousSequence = false;
      continue;
    }
    let record: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      const candidate = asRecord(parsed);
      if (!candidate) throw new Error("not-object");
      record = candidate;
      validJsonLines += 1;
    } catch {
      invalidJsonLines += 1;
      contiguousSequence = false;
      continue;
    }

    const sequence = finiteInteger(record.seq, -1);
    if (sequence !== expectedSequence) contiguousSequence = false;
    expectedSequence = Math.max(expectedSequence + 1, sequence + 1);
    const schema = safeString(record.schema);
    const kind = safeString(record.kind);
    if (
      schema === "riftlite-tcga-research-session" &&
      record.version === 1 &&
      kind === "research-session-start"
    ) {
      headerPresent = true;
      continue;
    }
    if (
      schema === "riftlite-tcga-research-session" &&
      record.version === 1 &&
      kind === "research-session-stop"
    ) {
      footerPresent = true;
      const footer = asRecord(record.payload);
      declaredRecordCount = finiteInteger(footer?.recordCount, -1);
      capped = footer?.capped === true;
      droppedRecords = Math.max(0, finiteInteger(footer?.droppedCount));
      continue;
    }
    if (schema !== "riftlite-tcga-research-record" || record.version !== 1) continue;
    records += 1;
    observeNonRtcRecord(record, accumulator);
    if (kind !== "page-rtc-data") continue;

    frames += 1;
    const wrapper = asRecord(record.payload);
    const rtc = asRecord(wrapper?.payload);
    const direction = fixedDirection(rtc?.direction);
    const data = asRecord(rtc?.data);
    if (!rtc || !direction || !data || data.encoding !== "base64") {
      unavailableFrames += 1;
      continue;
    }
    directions[direction] += 1;
    if (data.truncated === true) truncatedFrames += 1;
    if (data.unavailable === true) unavailableFrames += 1;
    const bytes = strictBase64Bytes(data.data);
    if (!bytes || (Number.isFinite(Number(data.byteLength)) && Number(data.byteLength) !== bytes.byteLength)) {
      unavailableFrames += 1;
      continue;
    }
    const channel = asRecord(rtc.channel);
    const captureChannelId = safeString(channel?.captureChannelId);
    const channelId = Number.isFinite(Number(channel?.id)) ? Math.trunc(Number(channel?.id)) : -1;
    const result = decoder.push({
      recordSeq: sequence,
      transportSequence: finiteInteger(rtc.transportSequence, sequence),
      capturedAt: safeString(rtc.transportCapturedAt) || safeString(record.recordedAt),
      direction,
      channelKey: /^channel-\d{1,12}$/.test(captureChannelId)
        ? captureChannelId
        : channelId >= 0
          ? `game:${channelId}`
          : "game",
      bytes
    });
    if (result.decodedFrame) decodedFrames += 1;
    if (result.chunkFrame) chunkFrames += 1;
    logicalMessages += result.messages.length;
    for (const message of result.messages) observeLogicalMessage(message, accumulator);
  }
  if (lines.length > MAX_RECORDS + 2) {
    invalidJsonLines += lines.length - (MAX_RECORDS + 2);
    contiguousSequence = false;
  }

  const finalization = decoder.finish();
  const decodeFailures = Object.values(finalization.issues).reduce((total, count) => total + count, 0);
  accumulator.coverage.perspectivePlayers = accumulator.perspectivePlayerIds.size;
  const expectedSha256 = safeString(options.expectedCompressedSha256).toLowerCase();
  const actualSha256 = safeString(options.compressedSha256).toLowerCase();
  const sourceIntegrity: TcgaReplayResearchAnalysisReport["sourceIntegrity"] = {
    headerPresent,
    footerPresent,
    validJsonLines,
    invalidJsonLines,
    contiguousSequence,
    declaredRecordCountMatches: footerPresent && declaredRecordCount === records,
    compressedSha256Matches: expectedSha256 && actualSha256
      ? expectedSha256 === actualSha256
      : null,
    records,
    expandedBytes: input.byteLength,
    compressedBytes: Math.max(0, finiteInteger(options.compressedBytes)),
    capped,
    droppedRecords
  };
  const transport: TcgaReplayResearchAnalysisReport["transport"] = {
    frames,
    decodedFrames,
    truncatedFrames,
    unavailableFrames,
    chunkFrames,
    chunkGroups: finalization.chunkGroups,
    completeChunkGroups: finalization.completeChunkGroups,
    incompleteChunkGroups: finalization.incompleteChunkGroups,
    incompleteChunkCount: finalization.incompleteChunkCount,
    duplicateChunks: finalization.duplicateChunks,
    logicalMessages,
    decodeFailures,
    directions,
    issueCounts: finalization.issues
  };
  return {
    schema: "riftlite-tcga-research-analysis",
    version: 1,
    sourceIntegrity,
    transport,
    messageTypes: accumulator.messageTypes,
    coverage: accumulator.coverage,
    assessment: assessment(sourceIntegrity, transport, accumulator.messageTypes, accumulator.coverage),
    privacy: {
      rawInput: "SENSITIVE",
      hiddenCardIdentityObserved: accumulator.hiddenCardIdentityObserved,
      safeAggregateOnly: true,
      includesDecodedPayloads: false,
      includesPlayerIdentifiers: false,
      includesCardIdentities: false
    }
  };
}

function companionSummaryPath(exportPath: string): string {
  return exportPath.endsWith(".jsonl.gz")
    ? `${exportPath.slice(0, -".jsonl.gz".length)}.summary.json`
    : `${exportPath}.summary.json`;
}

export async function analyzeTcgaReplayResearchBundle(
  exportPath: string,
  summaryPath = companionSummaryPath(exportPath)
): Promise<TcgaReplayResearchAnalysisReport> {
  const compressed = await readFile(exportPath);
  if (compressed.byteLength > MAX_COMPRESSED_BUNDLE_BYTES) {
    throw new Error("TCGA research bundle exceeds the compressed analysis limit.");
  }
  const compressedSha256 = createHash("sha256").update(compressed).digest("hex");
  let expectedCompressedSha256 = "";
  try {
    const summary = JSON.parse(await readFile(summaryPath, "utf8")) as Record<string, unknown>;
    expectedCompressedSha256 = safeString(summary.sha256);
  } catch {
    // A missing/malformed companion is reported as an unavailable hash check.
  }
  let expanded: Buffer;
  try {
    expanded = await gunzipAsync(compressed, { maxOutputLength: MAX_EXPANDED_BUNDLE_BYTES });
  } catch {
    throw new Error("TCGA research bundle could not be decompressed.");
  }
  return analyzeTcgaReplayResearchJsonl(expanded, {
    compressedBytes: compressed.byteLength,
    compressedSha256,
    expectedCompressedSha256
  });
}
