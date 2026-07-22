import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { sanitizeTcgaResearchValue } from "../../shared/tcgaResearchPrivacy.js";
import type {
  TcgaReplayResearchAnalysisReport,
  TcgaReplayResearchStatus,
  TcgaReplayResearchWebReplayExportSummary
} from "../../shared/types.js";
import { analyzeTcgaReplayResearchJsonl } from "./tcgaReplayResearchAnalyzer.js";
import {
  exportTcgaReplayResearchBundle,
  type TcgaReplayResearchExportResult
} from "./tcgaReplayResearchExporter.js";

const gzipAsync = promisify(gzip);

const FILE_PREFIX = "tcga-replay-research-";
const ACTIVE_FILE_PREFIX = `${FILE_PREFIX}active-SENSITIVE-`;
const EXPORT_FILE_PREFIX = `${FILE_PREFIX}SENSITIVE-`;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_RECORDS = 12_000;
const DEFAULT_MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const DEFAULT_RETENTION_FILES = 3;
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface TcgaReplayResearchCaptureLimits {
  maxBytes: number;
  maxRecords: number;
  maxDurationMs: number;
  retentionFiles: number;
  retentionMs: number;
  now: () => number;
}

export interface TcgaReplayResearchCaptureDependencies {
  exportWebReplay: (
    sourcePath: string,
    outputDirectory?: string
  ) => Promise<TcgaReplayResearchExportResult>;
}

export type TcgaReplayResearchCaptureStatus = TcgaReplayResearchStatus;

export interface TcgaReplayResearchRecord {
  schema: "riftlite-tcga-research-record";
  version: 1;
  seq: number;
  recordedAt: string;
  writtenAt: string;
  source: string;
  kind: string;
  payload: Record<string, unknown>;
}

type RecordedAt = string | number | Date;

function defaultStatus(directory: string): TcgaReplayResearchCaptureStatus {
  return {
    active: false,
    directory,
    privacy: "SENSITIVE",
    sessionId: "",
    startedAt: "",
    stoppedAt: "",
    stopReason: "",
    workingPath: "",
    exportPath: "",
    summaryPath: "",
    analysisPath: "",
    analysis: null,
    webReplayExports: [],
    webReplayExportError: "",
    recordCount: 0,
    recordKinds: {},
    transportState: "off",
    transportError: "",
    droppedCount: 0,
    byteCount: 0,
    uncompressedBytes: 0,
    compressedBytes: 0,
    capped: false,
    capReason: "",
    sha256: "",
    lastError: "",
    deletedFiles: 0
  };
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.trunc(parsed)) : fallback;
}

function normalizedLimits(options: Partial<TcgaReplayResearchCaptureLimits>): TcgaReplayResearchCaptureLimits {
  return {
    maxBytes: positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES),
    maxRecords: positiveInteger(options.maxRecords, DEFAULT_MAX_RECORDS),
    maxDurationMs: positiveInteger(options.maxDurationMs, DEFAULT_MAX_DURATION_MS),
    retentionFiles: positiveInteger(options.retentionFiles, DEFAULT_RETENTION_FILES),
    retentionMs: positiveInteger(options.retentionMs, DEFAULT_RETENTION_MS),
    now: options.now ?? Date.now
  };
}

function isoTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function safeTimestamp(value: RecordedAt | undefined, fallback: number): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return isoTime(value);
  }
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return value;
  }
  return isoTime(fallback);
}

function safeLabel(value: string, fallback: string): string {
  const clean = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ");
  return (clean || fallback).slice(0, 256);
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function summaryPathForExport(exportPath: string): string {
  return exportPath.endsWith(".jsonl.gz")
    ? `${exportPath.slice(0, -".jsonl.gz".length)}.summary.json`
    : `${exportPath}.summary.json`;
}

function analysisPathForExport(exportPath: string): string {
  return exportPath.endsWith(".jsonl.gz")
    ? `${exportPath.slice(0, -".jsonl.gz".length)}.analysis.json`
    : `${exportPath}.analysis.json`;
}

function webReplayCompanionPrefix(exportPath: string): string {
  const fileName = basename(exportPath);
  const stem = fileName.endsWith(".jsonl.gz")
    ? fileName.slice(0, -".jsonl.gz".length)
    : fileName;
  return `${stem}.game-`;
}

/**
 * A deliberately isolated, local-only evidence recorder. It has no account,
 * HTTP, replay-upload, or Electron dependencies and starts disabled on every
 * process launch.
 */
export class TcgaReplayResearchCapture {
  private readonly limits: TcgaReplayResearchCaptureLimits;
  private readonly exportWebReplay: TcgaReplayResearchCaptureDependencies["exportWebReplay"];
  private status: TcgaReplayResearchCaptureStatus;
  private queue: Promise<unknown> = Promise.resolve();
  private durationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly directory: string,
    private readonly appVersion: string,
    options: Partial<TcgaReplayResearchCaptureLimits> = {},
    dependencies: Partial<TcgaReplayResearchCaptureDependencies> = {}
  ) {
    this.limits = normalizedLimits(options);
    this.exportWebReplay = dependencies.exportWebReplay ?? exportTcgaReplayResearchBundle;
    this.status = defaultStatus(directory);
  }

  start(): Promise<TcgaReplayResearchCaptureStatus> {
    return this.enqueue(() => this.startUnlocked());
  }

  record(
    kind: string,
    payload: Record<string, unknown>,
    recordedAt?: RecordedAt,
    source?: string
  ): Promise<void> {
    return this.enqueue(async () => {
      if (!this.status.active) {
        return;
      }
      const now = this.limits.now();
      if (now - Date.parse(this.status.startedAt) >= this.limits.maxDurationMs) {
        this.status.capped = true;
        this.status.capReason = "duration-limit";
        await this.stopUnlocked("duration-limit");
        return;
      }
      if (this.status.recordCount >= this.limits.maxRecords) {
        this.status.droppedCount += 1;
        this.status.capped = true;
        this.status.capReason = "record-limit";
        await this.stopUnlocked("record-limit");
        return;
      }

      const candidateSource = source || (typeof payload.source === "string" ? payload.source : "tcga");
      const entry: TcgaReplayResearchRecord = {
        schema: "riftlite-tcga-research-record",
        version: 1,
        seq: this.status.recordCount + 1,
        recordedAt: safeTimestamp(recordedAt, now),
        writtenAt: isoTime(now),
        source: safeLabel(candidateSource, "tcga"),
        kind: safeLabel(kind, "unknown"),
        payload: sanitizeTcgaResearchValue(payload)
      };
      const line = jsonLine(entry);
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (this.status.byteCount + lineBytes > this.limits.maxBytes) {
        this.status.droppedCount += 1;
        this.status.capped = true;
        this.status.capReason = "byte-limit";
        await this.stopUnlocked("byte-limit");
        return;
      }

      await appendFile(this.status.workingPath, line, { encoding: "utf8", mode: 0o600 });
      this.status.recordCount += 1;
      this.status.recordKinds[entry.kind] = (this.status.recordKinds[entry.kind] ?? 0) + 1;
      this.status.byteCount += lineBytes;
      if (this.status.recordCount >= this.limits.maxRecords) {
        this.status.capped = true;
        this.status.capReason = "record-limit";
        await this.stopUnlocked("record-limit");
      }
    });
  }

  stop(reason = "user"): Promise<TcgaReplayResearchCaptureStatus> {
    return this.enqueue(() => this.stopUnlocked(safeLabel(reason, "user")));
  }

  deleteAll(): Promise<TcgaReplayResearchCaptureStatus> {
    return this.enqueue(async () => {
      this.clearDurationTimer();
      await mkdir(this.directory, { recursive: true });
      const entries = await readdir(this.directory, { withFileTypes: true });
      const targets = entries
        .filter((entry) => entry.isFile() && (
          entry.name.startsWith(FILE_PREFIX) ||
          (entry.name.startsWith(`.${FILE_PREFIX}`) && entry.name.includes(".tmp-"))
        ))
        .map((entry) => join(this.directory, entry.name));
      await Promise.all(targets.map((path) => unlink(path).catch(() => undefined)));
      this.status = {
        ...defaultStatus(this.directory),
        stopReason: "deleted",
        stoppedAt: isoTime(this.limits.now()),
        deletedFiles: targets.length
      };
      return this.getStatus();
    });
  }

  getStatus(): TcgaReplayResearchCaptureStatus {
    return {
      ...this.status,
      recordKinds: { ...this.status.recordKinds },
      analysis: this.status.analysis ? structuredClone(this.status.analysis) : null,
      webReplayExports: this.status.webReplayExports.map((summary) => ({
        ...summary,
        reasonCodes: [...summary.reasonCodes]
      }))
    };
  }

  setTransportState(
    state: TcgaReplayResearchCaptureStatus["transportState"],
    error = ""
  ): TcgaReplayResearchCaptureStatus {
    this.status.transportState = state;
    this.status.transportError = safeLabel(error, "").slice(0, 1_000);
    return this.getStatus();
  }

  private async startUnlocked(): Promise<TcgaReplayResearchCaptureStatus> {
    if (this.status.active) {
      return this.getStatus();
    }
    await mkdir(this.directory, { recursive: true });
    await this.pruneRetention();
    const startedMs = this.limits.now();
    const sessionId = randomUUID();
    const stamp = isoTime(startedMs).replace(/[:.]/g, "-");
    const workingPath = join(this.directory, `${ACTIVE_FILE_PREFIX}${stamp}-${sessionId}.jsonl`);
    const header = jsonLine({
      schema: "riftlite-tcga-research-session",
      version: 1,
      seq: 0,
      recordedAt: isoTime(startedMs),
      writtenAt: isoTime(startedMs),
      source: "riftlite",
      kind: "research-session-start",
      payload: {
        appVersion: safeLabel(this.appVersion, "unknown"),
        privacy: "SENSITIVE",
        notice: "Local-only TCGA replay research. Gameplay evidence may contain player names, chat, hidden cards, decks, and match state.",
        limits: {
          maxBytes: this.limits.maxBytes,
          maxRecords: this.limits.maxRecords,
          maxDurationMs: this.limits.maxDurationMs
        }
      }
    });
    await writeFile(workingPath, header, { encoding: "utf8", mode: 0o600, flag: "wx" });
    this.status = {
      ...defaultStatus(this.directory),
      active: true,
      sessionId,
      startedAt: isoTime(startedMs),
      workingPath,
      transportState: "waiting"
    };
    this.durationTimer = setTimeout(() => {
      void this.enqueue(async () => {
        if (!this.status.active || this.status.sessionId !== sessionId) {
          return;
        }
        this.status.capped = true;
        this.status.capReason = "duration-limit";
        await this.stopUnlocked("duration-limit");
      }).catch(() => undefined);
    }, this.limits.maxDurationMs);
    this.durationTimer.unref?.();
    return this.getStatus();
  }

  private async stopUnlocked(reason: string): Promise<TcgaReplayResearchCaptureStatus> {
    if (!this.status.active) {
      return this.getStatus();
    }
    this.clearDurationTimer();
    const stoppedMs = this.limits.now();
    const snapshot = this.getStatus();
    const footer = jsonLine({
      schema: "riftlite-tcga-research-session",
      version: 1,
      seq: snapshot.recordCount + 1,
      recordedAt: isoTime(stoppedMs),
      writtenAt: isoTime(stoppedMs),
      source: "riftlite",
      kind: "research-session-stop",
      payload: {
        reason,
        recordCount: snapshot.recordCount,
        droppedCount: snapshot.droppedCount,
        byteCount: snapshot.byteCount,
        capped: snapshot.capped,
        capReason: snapshot.capReason
      }
    });

    try {
      await appendFile(snapshot.workingPath, footer, { encoding: "utf8", mode: 0o600 });
      const raw = await readFile(snapshot.workingPath);
      const compressed = await gzipAsync(raw);
      const stamp = isoTime(stoppedMs).replace(/[:.]/g, "-");
      const exportPath = join(
        this.directory,
        `${EXPORT_FILE_PREFIX}${stamp}-${snapshot.sessionId}.jsonl.gz`
      );
      await writeAtomically(exportPath, compressed);
      const sha256 = createHash("sha256").update(compressed).digest("hex");
      const summaryPath = summaryPathForExport(exportPath);
      const candidateAnalysisPath = analysisPathForExport(exportPath);
      let analysis: TcgaReplayResearchAnalysisReport | null = null;
      let analysisPath = "";
      let analysisError = "";
      try {
        analysis = analyzeTcgaReplayResearchJsonl(raw, {
          compressedBytes: compressed.byteLength,
          compressedSha256: sha256,
          expectedCompressedSha256: sha256
        });
        await writeAtomically(
          candidateAnalysisPath,
          Buffer.from(`${JSON.stringify(analysis, null, 2)}\n`, "utf8")
        );
        analysisPath = candidateAnalysisPath;
      } catch {
        analysis = null;
        analysisError = "analysis-failed";
      }
      let webReplayExports: TcgaReplayResearchWebReplayExportSummary[] = [];
      let webReplayExportError = "";
      try {
        const webReplayResult = await this.exportWebReplay(exportPath, this.directory);
        webReplayExports = webReplayResult.channels.map((channel) => ({
          ...channel,
          reasonCodes: [...channel.reasonCodes]
        }));
      } catch {
        // The research bundle remains the source of truth. Companion generation
        // must never turn a successful Stop and save into a failed capture.
        webReplayExportError = "web-replay-export-failed";
      }
      const summary = {
        schema: "riftlite-tcga-research-summary",
        version: 1,
        privacy: {
          sensitiveDataIncluded: true,
          notice: "SENSITIVE local research export. Never post publicly."
        },
        appVersion: safeLabel(this.appVersion, "unknown"),
        sessionId: snapshot.sessionId,
        startedAt: snapshot.startedAt,
        stoppedAt: isoTime(stoppedMs),
        stopReason: reason,
        recordCount: snapshot.recordCount,
        recordKinds: snapshot.recordKinds,
        transportState: snapshot.transportState,
        transportError: snapshot.transportError,
        droppedCount: snapshot.droppedCount,
        capturedBytes: snapshot.byteCount,
        uncompressedBytes: raw.byteLength,
        compressedBytes: compressed.byteLength,
        capped: snapshot.capped,
        capReason: snapshot.capReason,
        sha256,
        exportFile: basename(exportPath),
        analysisFile: analysisPath ? basename(analysisPath) : "",
        analysisError,
        assessment: analysis?.assessment ?? null,
        webReplayExports: webReplayExports.map((channel) => ({
          ...channel,
          exportPath: channel.exportPath ? basename(channel.exportPath) : "",
          reasonCodes: [...channel.reasonCodes]
        })),
        webReplayExportError
      };
      await writeAtomically(summaryPath, Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, "utf8"));
      await unlink(snapshot.workingPath).catch(() => undefined);
      this.status = {
        ...snapshot,
        active: false,
        stoppedAt: isoTime(stoppedMs),
        stopReason: reason,
        workingPath: "",
        exportPath,
        summaryPath,
        analysisPath,
        analysis,
        webReplayExports,
        webReplayExportError,
        uncompressedBytes: raw.byteLength,
        compressedBytes: compressed.byteLength,
        sha256,
        lastError: ""
      };
      await this.pruneRetention();
      return this.getStatus();
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private clearDurationTimer(): void {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
  }

  private async pruneRetention(): Promise<void> {
    const now = this.limits.now();
    const entries = await readdir(this.directory, { withFileTypes: true });
    const exports = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(EXPORT_FILE_PREFIX) && entry.name.endsWith(".jsonl.gz"))
      .map(async (entry) => {
        const path = join(this.directory, entry.name);
        const info = await stat(path);
        return { path, mtimeMs: info.mtimeMs };
      }));
    exports.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const expired = exports.filter((entry, index) => (
      index >= this.limits.retentionFiles || now - entry.mtimeMs > this.limits.retentionMs
    ));
    await Promise.all(expired.flatMap((entry) => {
      const companionPrefix = webReplayCompanionPrefix(entry.path);
      const companions = entries
        .filter((candidate) => (
          candidate.isFile() &&
          candidate.name.startsWith(companionPrefix) &&
          candidate.name.endsWith(".web-replay.json.gz")
        ))
        .map((candidate) => join(this.directory, candidate.name));
      return [
        entry.path,
        summaryPathForExport(entry.path),
        analysisPathForExport(entry.path),
        ...companions
      ].map((path) => unlink(path).catch(() => undefined));
    }));

    const abandoned = await Promise.all(entries
      .filter((entry) => entry.isFile() && (
        entry.name.startsWith(ACTIVE_FILE_PREFIX) ||
        (entry.name.startsWith(`.${FILE_PREFIX}`) && entry.name.includes(".tmp-"))
      ))
      .map(async (entry) => {
        const path = join(this.directory, entry.name);
        const info = await stat(path);
        return { path, mtimeMs: info.mtimeMs };
      }));
    await Promise.all(abandoned
      .filter((entry) => now - entry.mtimeMs > this.limits.retentionMs)
      .map((entry) => unlink(entry.path).catch(() => undefined)));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(task);
    this.queue = next;
    return next;
  }
}

async function writeAtomically(path: string, data: Buffer): Promise<void> {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.tmp-${process.pid}-${randomUUID()}`
  );
  try {
    await writeFile(temporaryPath, data, { mode: 0o600, flag: "wx" });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
