import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, opendirSync,
  readFileSync, readSync, renameSync, unlinkSync, writeFileSync, writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { availableParallelism, release, totalmem, type } from "node:os";
import { redactDiagnosticValue, sanitizeDiagnosticUrl } from "../../shared/diagnosticPrivacy.js";
import type {
  CrashDiagnosticEvent, CrashDiagnosticsExportResult, CrashDiagnosticsStatus,
  CrashDumpMetadata, CrashSessionSummary,
} from "../../shared/crashDiagnostics.js";

const SESSION_SCHEMA = "riftlite-crash-session";
const SESSION_FILE = /^session-(\d{13}-[a-f0-9-]{36})\.json$/;
const MAX_STRING = 2_048;
const MAX_EVENT_BYTES = 16_384;
const MAX_MARKER_BYTES = 16_384;
const MAX_DIRECTORY_ENTRIES = 1_024;
const REDACTED = "[REDACTED]";

type SessionRecord = CrashSessionSummary & { schema: typeof SESSION_SCHEMA; schemaVersion: 1 };
type StoredSession = { markerPath: string; eventPath: string; session: SessionRecord };

export interface CrashDiagnosticsOptions {
  directory: string;
  version: string;
  platform: string;
  arch: string;
  versions?: Record<string, string | undefined>;
  nativeDumpDirectory?: string;
  nativeCrashReportingEnabled?: boolean;
  maxSessions?: number;
  maxBytes?: number;
  sampleIntervalMs?: number;
  now?: () => number;
}

/** Local-only diagnostics. All fault writes are synchronous and failure-isolated. */
export class CrashDiagnostics {
  private readonly directory: string;
  private readonly maxSessions: number;
  private readonly maxBytes: number;
  private readonly sampleIntervalMs: number;
  private readonly now: () => number;
  private initialized = false;
  private enabled = false;
  private current?: SessionRecord;
  private previous?: SessionRecord;
  private history: SessionRecord[] = [];
  private lastWriteError?: string;
  private latestReportPath?: string;
  private eventCount = 0;
  private lastSampleAt = -Infinity;

  constructor(private readonly options: CrashDiagnosticsOptions) {
    this.directory = resolve(options.directory);
    this.maxSessions = boundedInteger(options.maxSessions, 5, 1, 5);
    this.maxBytes = boundedInteger(options.maxBytes, 5 * 1024 * 1024, 32_768, 5 * 1024 * 1024);
    this.sampleIntervalMs = boundedInteger(options.sampleIntervalMs, 15_000, 1_000, 300_000);
    this.now = options.now ?? Date.now;
  }

  initialize(): CrashDiagnosticsStatus {
    if (this.initialized) return this.getStatus();
    this.initialized = true;
    try {
      this.ensureDirectory();
      const existing = this.readSessions();
      this.previous = existing[0]?.session;
      if (this.previous && this.previous.exitState !== "clean" && !this.previous.unexpectedExitDetectedAt) {
        this.previous = { ...this.previous, unexpectedExitDetectedAt: this.timestamp() };
        this.atomicWrite(existing[0].markerPath, JSON.stringify(this.previous));
      }
      const now = this.now();
      this.current = {
        schema: SESSION_SCHEMA, schemaVersion: 1,
        id: `${Math.max(0, Math.trunc(now)).toString().padStart(13, "0")}-${randomUUID()}`,
        startedAt: new Date(now).toISOString(), version: safeText(this.options.version),
        platform: safeText(this.options.platform), arch: safeText(this.options.arch), exitState: "running",
      };
      this.writeMarker();
      this.enabled = true;
      this.record("session-start", {
        previousExit: this.previous ? this.previous.exitState === "clean" ? "clean" : "unexpected" : "none",
        runtime: this.runtimeSnapshot(),
      });
      this.enforceRetention();
    } catch (error) {
      this.enabled = false;
      this.captureWriteFailure(error);
    }
    return this.getStatus();
  }

  record(category: string, data?: unknown, options: { fatal?: boolean } = {}): void {
    if (!this.initialized) this.initialize();
    if (!this.enabled || !this.current) return;
    if (options.fatal) this.current = { ...this.current, exitState: "faulted" };
    try {
      this.ensureDirectory();
      const at = this.timestamp();
      const event: CrashDiagnosticEvent = {
        at, runId: this.current.id, category: safeText(category).slice(0, 120),
        ...(data === undefined ? {} : { data: sanitizeCrashDiagnosticValue(data) }),
        ...(options.fatal ? { fatal: true } : {}),
      };
      let line = JSON.stringify(event);
      if (Buffer.byteLength(line) > MAX_EVENT_BYTES) {
        line = JSON.stringify({ ...event, data: { truncated: true, detail: safeText(line).slice(0, 4_096) } });
      }
      this.appendEvent(`${line}\n`);
      this.eventCount += 1;
      this.current = { ...this.current, lastEventAt: at, ...(options.fatal ? { exitState: "faulted" as const } : {}) };
      this.writeMarker();
      this.enforceRetention();
      this.lastWriteError = undefined;
    } catch (error) {
      this.captureWriteFailure(error);
    }
  }

  recordSample(data: unknown): void {
    try {
      const now = this.now();
      if (now - this.lastSampleAt < this.sampleIntervalMs) return;
      this.lastSampleAt = now;
      this.record("runtime-sample", data);
    } catch (error) {
      this.captureWriteFailure(error);
    }
  }

  /** Call only from the actual process/app exit event, never from before-quit. */
  markCleanExit(reason = "normal-exit"): void {
    if (!this.enabled || !this.current || this.current.exitState === "faulted" || this.current.exitState === "clean") return;
    const previous = this.current;
    try {
      this.record("session-clean-exit", { reason });
      this.current = { ...this.current, exitState: "clean", endedAt: this.timestamp(), cleanExitReason: safeText(reason).slice(0, 120) };
      this.writeMarker();
    } catch (error) {
      this.current = previous;
      this.captureWriteFailure(error);
    }
  }

  getStatus(): CrashDiagnosticsStatus {
    const dumps = this.dumpMetadata();
    return {
      enabled: this.enabled, sessionId: this.current?.id ?? "", directory: this.directory,
      previousExit: this.previous ? this.previous.exitState === "clean" ? "clean" : "unexpected" : "none",
      previousSession: this.previous ? sessionSummary(this.previous) : undefined,
      recentUnexpectedSessions: this.history.filter((session) => session.unexpectedExitDetectedAt)
        .map(sessionSummary),
      nativeCrashReportingEnabled: Boolean(this.options.nativeCrashReportingEnabled),
      nativeDumpDirectory: this.options.nativeDumpDirectory ? resolve(this.options.nativeDumpDirectory) : undefined,
      nativeDumpCount: dumps.length, lastWriteError: this.lastWriteError,
      eventCount: this.eventCount, latestReportPath: this.latestReportPath,
    };
  }

  exportReport(destinationPath: string): CrashDiagnosticsExportResult {
    try {
      if (!this.initialized) this.initialize();
      if (!this.enabled) return { ok: false, error: this.lastWriteError || "Local crash diagnostics are unavailable." };
      const destination = resolve(destinationPath);
      const destinationKey = process.platform === "win32" ? destination.toLowerCase() : destination;
      const directoryKey = process.platform === "win32" ? this.directory.toLowerCase() : this.directory;
      const relativeDestination = relative(directoryKey, destinationKey);
      if (!relativeDestination || (relativeDestination !== ".." && !relativeDestination.startsWith(`..${sep}`) && !isAbsolute(relativeDestination))) {
        throw new Error("Choose an export location outside the automatic diagnostics folder.");
      }
      const sessions = this.readSessions().slice(0, this.maxSessions);
      const events: CrashDiagnosticEvent[] = [];
      let eventBytes = 0;
      const reportEventBudget = Math.max(4_096, this.maxBytes - 24_576);
      for (const stored of sessions) {
        const contents = this.readTail(stored.eventPath, Math.min(this.maxBytes, reportEventBudget));
        for (const line of contents.trimEnd().split("\n").reverse()) {
          if (!line || Buffer.byteLength(line) > MAX_EVENT_BYTES) continue;
          try {
            const parsed = JSON.parse(line) as Partial<CrashDiagnosticEvent>;
            if (parsed.runId !== stored.session.id || typeof parsed.at !== "string" || typeof parsed.category !== "string") continue;
            const event = sanitizeCrashDiagnosticValue(parsed) as CrashDiagnosticEvent;
            const bytes = Buffer.byteLength(JSON.stringify(event)) + 1;
            if (eventBytes + bytes > reportEventBudget) break;
            events.push(event); eventBytes += bytes;
          } catch { /* A partially written final line must not block the report. */ }
        }
      }
      const report = {
        schema: "riftlite-crash-diagnostics", version: 1, exportedAt: this.timestamp(),
        privacy: { sanitized: true, memoryDumpContentsIncluded: false, rawCaptureDataIncluded: false,
          notice: "An unexpected exit means the prior process did not record a clean exit; it does not prove a crash." },
        currentSession: this.current ? sessionSummary(this.current) : undefined,
        previousSession: this.previous ? sessionSummary(this.previous) : undefined,
        sessions: sessions.map((stored) => sessionSummary(stored.session)),
        runtime: this.runtimeSnapshot(), nativeCrashReportingEnabled: Boolean(this.options.nativeCrashReportingEnabled),
        nativeDumps: this.dumpMetadata(), events: events.reverse(), lastWriteError: this.lastWriteError,
      };
      const encoded = JSON.stringify(sanitizeCrashDiagnosticValue(report, { exportEnvelope: true }));
      if (Buffer.byteLength(encoded) > this.maxBytes) throw new Error("The diagnostic report exceeds its local size limit.");
      this.atomicWrite(destination, encoded);
      this.latestReportPath = destination;
      return { ok: true, path: destination };
    } catch (error) {
      return { ok: false, error: safeError(error) };
    }
  }

  private timestamp(): string { return new Date(this.now()).toISOString(); }

  private ensureDirectory(): void {
    mkdirSync(this.directory, { recursive: true });
    const info = lstatSync(this.directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("The diagnostics location is not a regular local directory.");
  }

  private writeMarker(): void {
    if (this.current) this.atomicWrite(join(this.directory, `session-${this.current.id}.json`), JSON.stringify(this.current));
  }

  private atomicWrite(path: string, contents: string): void {
    try {
      const info = lstatSync(path);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error("Refusing to replace a linked or non-file diagnostics destination.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
      renameSync(temporary, path);
    } finally {
      try { unlinkSync(temporary); } catch { /* May already have been renamed. */ }
    }
  }

  private appendEvent(line: string): void {
    const path = join(this.directory, `events-${this.current!.id}.jsonl`);
    const limit = Math.max(MAX_EVENT_BYTES, Math.floor((this.maxBytes - this.maxSessions * MAX_MARKER_BYTES) / this.maxSessions));
    let size = 0;
    try {
      const info = lstatSync(path);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error("Refusing a linked diagnostics log.");
      size = info.size;
    } catch (error) { if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error; }
    if (size + Buffer.byteLength(line) > limit) {
      const tail = this.readTail(path, Math.max(0, limit - Buffer.byteLength(line)));
      this.atomicWrite(path, `${tail}${line}`);
      return;
    }
    const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      if (!fstatSync(fd).isFile()) throw new Error("The diagnostics log is not a regular file.");
      writeSync(fd, line, undefined, "utf8");
    } finally { closeSync(fd); }
  }

  private readSessions(): StoredSession[] {
    const sessions: StoredSession[] = [];
    for (const name of boundedDirectoryNames(this.directory)) {
      const match = SESSION_FILE.exec(name);
      if (!match) continue;
      const markerPath = join(this.directory, name);
      try {
        const info = lstatSync(markerPath);
        if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_MARKER_BYTES) continue;
        const parsed = JSON.parse(readFileSync(markerPath, "utf8")) as SessionRecord;
        if (parsed.schema !== SESSION_SCHEMA || parsed.schemaVersion !== 1 || parsed.id !== match[1] ||
          !["running", "clean", "faulted"].includes(parsed.exitState) || typeof parsed.startedAt !== "string" ||
          !Number.isFinite(Date.parse(parsed.startedAt)) ||
          [parsed.version, parsed.platform, parsed.arch].some((value) => typeof value !== "string") ||
          [parsed.lastEventAt, parsed.endedAt, parsed.unexpectedExitDetectedAt].some((value) => value !== undefined &&
            (typeof value !== "string" || !Number.isFinite(Date.parse(value)))) ||
          (parsed.cleanExitReason !== undefined && typeof parsed.cleanExitReason !== "string")) continue;
        const summary = sanitizeCrashDiagnosticValue(sessionSummary(parsed)) as CrashSessionSummary;
        sessions.push({ markerPath, eventPath: join(this.directory, `events-${parsed.id}.jsonl`),
          session: { schema: SESSION_SCHEMA, schemaVersion: 1, ...summary } });
      } catch { /* Ignore corrupt or foreign records without deleting them. */ }
    }
    return sessions.sort((left, right) => Date.parse(right.session.startedAt) - Date.parse(left.session.startedAt));
  }

  private enforceRetention(): void {
    const sessions = this.readSessions();
    const ordered = [
      ...sessions.filter((stored) => stored.session.id === this.current?.id),
      ...sessions.filter((stored) => stored.session.id !== this.current?.id),
    ];
    let bytes = 0;
    const retained: SessionRecord[] = [];
    for (const stored of ordered) {
      const size = regularFileSize(stored.markerPath) + regularFileSize(stored.eventPath);
      if (retained.length && (retained.length >= this.maxSessions || bytes + size > this.maxBytes)) {
        this.removeOwnedFile(stored.eventPath);
        this.removeOwnedFile(stored.markerPath);
      } else {
        bytes += size; retained.push(stored.session);
      }
    }
    this.history = retained;
  }

  private removeOwnedFile(path: string): void {
    try { const info = lstatSync(path); if (info.isFile() && !info.isSymbolicLink()) unlinkSync(path); }
    catch (error) { if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error; }
  }

  private readTail(path: string, maxBytes: number): string {
    if (maxBytes <= 0) return "";
    let fd: number | undefined;
    try {
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink()) return "";
      fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const size = fstatSync(fd).size;
      const offset = Math.max(0, size - maxBytes);
      const buffer = Buffer.alloc(Math.min(size, maxBytes));
      const read = readSync(fd, buffer, 0, buffer.length, offset);
      const text = buffer.subarray(0, read).toString("utf8");
      return offset ? text.slice(text.indexOf("\n") + 1) : text;
    } catch { return ""; }
    finally { if (fd !== undefined) closeSync(fd); }
  }

  private dumpMetadata(): CrashDumpMetadata[] {
    if (!this.options.nativeDumpDirectory) return [];
    const directory = resolve(this.options.nativeDumpDirectory);
    const dumps: CrashDumpMetadata[] = [];
    for (const subdirectory of ["", "pending", "completed", "reports"]) {
      const folder = subdirectory ? join(directory, subdirectory) : directory;
      try { const info = lstatSync(folder); if (info.isSymbolicLink() || !info.isDirectory()) continue; }
      catch { continue; }
      for (const filename of boundedDirectoryNames(folder, 128)) {
        if (!/\.dmp$/i.test(filename)) continue;
        try {
          const info = lstatSync(join(folder, filename));
          if (info.isFile() && !info.isSymbolicLink()) dumps.push({ filename: safeText(filename).slice(0, 120), modifiedAt: info.mtime.toISOString(), bytes: info.size });
        } catch { /* Native reporter may finish or remove a dump concurrently. */ }
      }
    }
    return dumps.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt)).slice(0, 20);
  }

  private runtimeSnapshot(): unknown {
    return sanitizeCrashDiagnosticValue({
      version: this.options.version, platform: this.options.platform, arch: this.options.arch,
      versions: this.options.versions ?? { node: process.versions.node },
      os: { type: type(), release: release(), totalMemoryBytes: totalmem(), cpuCount: availableParallelism() },
      process: { uptimeSeconds: Math.round(process.uptime()), memory: process.memoryUsage() },
    });
  }

  private captureWriteFailure(error: unknown): void { this.lastWriteError = safeError(error); }
}

function sessionSummary(session: CrashSessionSummary): CrashSessionSummary {
  return { id: session.id, startedAt: session.startedAt, lastEventAt: session.lastEventAt,
    endedAt: session.endedAt, version: session.version, platform: session.platform, arch: session.arch,
    exitState: session.exitState, unexpectedExitDetectedAt: session.unexpectedExitDetectedAt, cleanExitReason: session.cleanExitReason };
}

function regularFileSize(path: string): number {
  try { const info = lstatSync(path); return info.isFile() && !info.isSymbolicLink() ? info.size : 0; }
  catch { return 0; }
}

function boundedDirectoryNames(path: string, limit = MAX_DIRECTORY_ENTRIES): string[] {
  try {
    const directory = opendirSync(path); const names: string[] = [];
    try { for (let count = 0; count < limit; count++) { const entry = directory.readSync(); if (!entry) break; names.push(entry.name); } }
    finally { directory.closeSync(); }
    return names;
  } catch { return []; }
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.trunc(value!))) : fallback;
}

function safeError(error: unknown): string {
  try { return safeText(error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 600); }
  catch { return "Local diagnostics could not be written."; }
}

function safeText(value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (/"(?:messages|packets|frames|sessionDoc|rawEvidence)"\s*:|"schema"\s*:\s*"(?:riftreplay-raw-capture|riftlite-tcga)/i.test(text.slice(0, MAX_STRING))) {
    return "[RAW_CAPTURE_DATA_OMITTED]";
  }
  return String(redactDiagnosticValue(text.slice(0, MAX_STRING)))
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, REDACTED)
    .replace(/["']?(?:access_?token|refresh_?token|id_?token|api_?key|password|secret|authorization)["']?\s*[:=]\s*["']?[^\s,;"'}]+/gi, "secret=[REDACTED]")
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi, (url) => sanitizeDiagnosticUrl(url))
    .replace(/\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\r\n]+(?:[\\/][^\r\n"'<>]*)?/gi, "[USER_PATH]")
    .replace(/\/(?:Users|home)\/[^\s/]+(?:\/[^\s"'<>]*)?/g, "[USER_PATH]");
}

/** Bounded before applying the existing diagnostic privacy rules; cyclic inputs are safe. */
export function sanitizeCrashDiagnosticValue(value: unknown, options: { exportEnvelope?: boolean } = {}): unknown {
  const seen = new WeakSet<object>();
  const sensitiveStrings = new Set<string>();
  let nodes = 0;
  const walk = (candidate: unknown, depth: number, key = ""): unknown => {
    if (++nodes > (options.exportEnvelope ? 100_000 : 256)) return "[TRUNCATED]";
    if (/token|password|secret|credential|authorization|cookie|apikey|email|username|accountuid|firebaseuid/i.test(key.replace(/[^a-z0-9]/gi, ""))) {
      if (typeof candidate === "string" && candidate.length >= 4) sensitiveStrings.add(candidate.slice(0, MAX_STRING));
      return REDACTED;
    }
    if (/^(raw|payload|packets|frames|messages|settings|environment|env|headers|rawevidence|memorydump|dumpcontents)$/i.test(key)) return "[RAW_DATA_OMITTED]";
    if (candidate === null || candidate === undefined || typeof candidate === "boolean") return candidate;
    if (typeof candidate === "number") return Number.isFinite(candidate) ? candidate : String(candidate);
    if (typeof candidate === "bigint") return candidate.toString().slice(0, 40);
    if (typeof candidate === "string") return safeText(candidate);
    if (typeof candidate !== "object") return `[${typeof candidate}]`;
    if (depth > (options.exportEnvelope ? 12 : 5)) return "[MAX_DEPTH]";
    if (seen.has(candidate)) return "[CIRCULAR]";
    seen.add(candidate);
    if (candidate instanceof Error) return walk({ name: candidate.name, message: candidate.message, stack: candidate.stack, cause: candidate.cause }, depth + 1);
    if (candidate instanceof Date) return Number.isFinite(candidate.getTime()) ? candidate.toISOString() : "Invalid Date";
    if (ArrayBuffer.isView(candidate) || candidate instanceof ArrayBuffer) return "[BINARY_DATA_OMITTED]";
    if (Array.isArray(candidate)) return candidate.slice(0, options.exportEnvelope ? 10_000 : 24).map((item) => walk(item, depth + 1));
    const output: Record<string, unknown> = {};
    let descriptors: PropertyDescriptorMap;
    try { descriptors = Object.getOwnPropertyDescriptors(candidate); } catch { return "[UNREADABLE_OBJECT]"; }
    for (const [childKey, descriptor] of Object.entries(descriptors).slice(0, 40)) {
      output[safeText(childKey).slice(0, 100)] = "value" in descriptor ? walk(descriptor.value, depth + 1, childKey) : "[ACCESSOR_OMITTED]";
    }
    return output;
  };
  try {
    const safe = redactDiagnosticValue(walk(value, 0));
    if (!sensitiveStrings.size) return safe;
    const replace = (item: unknown): unknown => {
      if (typeof item === "string") {
        for (const secret of sensitiveStrings) item = (item as string).split(secret).join(REDACTED);
        return item;
      }
      if (Array.isArray(item)) return item.map(replace);
      if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, replace(child)]));
      return item;
    };
    return replace(safe);
  } catch { return "[DIAGNOSTIC_DATA_UNAVAILABLE]"; }
}
