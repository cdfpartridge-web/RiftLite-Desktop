export interface CrashSessionSummary {
  id: string;
  startedAt: string;
  lastEventAt?: string;
  endedAt?: string;
  version: string;
  platform: string;
  arch: string;
  exitState: "running" | "clean" | "faulted";
  unexpectedExitDetectedAt?: string;
  cleanExitReason?: string;
}

export interface CrashDiagnosticsStatus {
  enabled: boolean;
  sessionId: string;
  directory: string;
  previousExit: "none" | "clean" | "unexpected";
  previousSession?: CrashSessionSummary;
  recentUnexpectedSessions: CrashSessionSummary[];
  nativeCrashReportingEnabled: boolean;
  nativeDumpDirectory?: string;
  nativeDumpCount: number;
  lastWriteError?: string;
  eventCount: number;
  latestReportPath?: string;
}

export interface CrashDiagnosticEvent {
  at: string;
  runId: string;
  category: string;
  data?: unknown;
  fatal?: boolean;
}

export interface CrashDumpMetadata {
  filename: string;
  modifiedAt: string;
  bytes: number;
}

export interface CrashDiagnosticsExportResult {
  ok: boolean;
  path?: string;
  error?: string;
}
