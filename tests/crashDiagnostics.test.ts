import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { CrashDiagnostics, sanitizeCrashDiagnosticValue } from "../src/main/services/crashDiagnostics.js";

const directories: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "riftlite-crash-tests-")); directories.push(root);
  const directory = join(root, "diagnostics");
  let now = Date.parse("2026-10-01T16:00:00.000Z");
  const service = (options: Partial<ConstructorParameters<typeof CrashDiagnostics>[0]> = {}) => new CrashDiagnostics({
    directory, version: "0.9.79", platform: "win32", arch: "x64", versions: { node: "22.0.0", electron: "39.8.10" },
    now: () => now, ...options,
  });
  return { root, directory, service, advance: (milliseconds = 1_000) => { now += milliseconds; } };
}
function marker(directory: string, id: string) { return JSON.parse(readFileSync(join(directory, `session-${id}.json`), "utf8")); }
function events(directory: string, id: string) {
  return readFileSync(join(directory, `events-${id}.jsonl`), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("automatic local crash diagnostics", () => {
  it("records an interrupted session as an unexpected exit and retains that evidence across a later clean restart", () => {
    const f = fixture(); const first = f.service();
    const firstStatus = first.initialize();
    first.record("renderer-gone", { reason: "crashed", exitCode: -1 });
    expect(marker(f.directory, firstStatus.sessionId).exitState).toBe("running");
    f.advance(); const second = f.service(); const status = second.initialize();
    expect(status.previousExit).toBe("unexpected");
    expect(status.previousSession?.id).toBe(firstStatus.sessionId);
    expect(status.recentUnexpectedSessions.map((session) => session.id)).toContain(firstStatus.sessionId);
    second.markCleanExit("app-quit");
    f.advance(); const third = f.service(); const thirdStatus = third.initialize();
    expect(thirdStatus.previousExit).toBe("clean");
    expect(thirdStatus.recentUnexpectedSessions.map((session) => session.id)).toContain(firstStatus.sessionId);
    const reportPath = join(f.root, "report.json"); expect(third.exportReport(reportPath).ok).toBe(true);
    expect(readFileSync(reportPath, "utf8")).toContain("does not prove a crash");
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const runIds = new Set(report.sessions.map((session: { id: string }) => session.id));
    expect(runIds.size).toBe(3);
    expect(report.events.every((event: { runId: string }) => runIds.has(event.runId))).toBe(true);
    expect(report.events.find((event: { category: string }) => event.category === "renderer-gone").runId).toBe(firstStatus.sessionId);
  });

  it("marks only an actual clean exit and does not treat a recoverable JS exception as a fatal exit", () => {
    const f = fixture(); const service = f.service(); const status = service.initialize();
    service.record("uncaught-exception", { error: new Error("recoverable error") });
    expect(marker(f.directory, status.sessionId).exitState).toBe("running");
    service.markCleanExit("process-exit-0");
    expect(marker(f.directory, status.sessionId)).toMatchObject({ exitState: "clean", cleanExitReason: "process-exit-0", endedAt: expect.any(String) });
    f.advance(); expect(f.service().initialize().previousExit).toBe("clean");
  });

  it("writes fatal evidence synchronously and never overwrites it with a later clean-exit request", () => {
    const f = fixture(); const service = f.service(); const status = service.initialize();
    service.record("fatal-smoke", { error: new Error("fatal marker persists immediately"), exitCode: 77 }, { fatal: true });
    expect(events(f.directory, status.sessionId).at(-1)).toMatchObject({ category: "fatal-smoke", fatal: true, data: { exitCode: 77 } });
    expect(marker(f.directory, status.sessionId).exitState).toBe("faulted");
    service.markCleanExit();
    expect(marker(f.directory, status.sessionId).exitState).toBe("faulted");
    f.advance(); expect(f.service().initialize().previousExit).toBe("unexpected");
  });

  it("redacts secrets, raw packets, URLs, identities and user paths before writing them", () => {
    const f = fixture(); const service = f.service(); const status = service.initialize();
    service.record("privacy-check", {
      refreshToken: "super-secret-token", note: "super-secret-token repeated in a message",
      cookie: "private-cookie", accountUid: "private-account", settings: { password: "settings-secret" },
      packets: [{ raw: "unfiltered packet" }], raw: "raw-state", payload: { message: "packet data" },
      url: "https://name:pass@example.com/game/SECRETROOM?token=private-query#private-fragment",
      socket: "wss://example.com/socket?code=secret-socket",
      error: new Error('Failure Bearer long-secret-value at C:\\Users\\Alice Tester\\AppData\\RiftLite\\thing.js:12\n{"refresh_token":"json-secret"}'),
      stack: "at /home/alice/work/main.js:2", otherPath: "/Users/alice/Library/thing",
      errorText: '{"sessionDoc":{"privateCard":"do-not-save-game-payload"}}',
    });
    const local = readFileSync(join(f.directory, `events-${status.sessionId}.jsonl`), "utf8");
    for (const secret of ["super-secret-token", "private-cookie", "private-account", "settings-secret", "unfiltered packet", "raw-state", "packet data", "private-query", "private-fragment", "secret-socket", "long-secret-value", "json-secret", "Alice Tester", "/home/alice", "/Users/alice", "do-not-save-game-payload"]) expect(local).not.toContain(secret);
    expect(local).toContain("privacy-check"); expect(local).toContain("example.com");
  });

  it("bounds strings, objects, recursion and binary data without invoking accessors", () => {
    const hostile: Record<string, unknown> = { huge: "x".repeat(100_000), values: Array.from({ length: 1000 }, (_, i) => ({ i })), binary: Buffer.from("secret binary") };
    hostile.loop = hostile;
    Object.defineProperty(hostile, "getter", { enumerable: true, get() { throw new Error("must not be invoked"); } });
    let deep: Record<string, unknown> = hostile;
    for (let index = 0; index < 20; index++) { deep.child = {}; deep = deep.child as Record<string, unknown>; }
    const safe = sanitizeCrashDiagnosticValue(hostile);
    const encoded = JSON.stringify(safe);
    expect(encoded.length).toBeLessThan(10_000);
    expect(encoded).toContain("CIRCULAR"); expect(encoded).toContain("MAX_DEPTH");
    expect(encoded).toContain("ACCESSOR_OMITTED"); expect(encoded).toContain("BINARY_DATA_OMITTED");
    expect(encoded).not.toContain("secret binary");
  });

  it("throttles periodic samples but persists every fault event immediately", () => {
    const f = fixture(); const service = f.service(); const status = service.initialize();
    for (let index = 0; index < 10; index++) service.recordSample({ rss: index });
    service.record("fault", { reason: "renderer-gone" }); f.advance(15_000); service.recordSample({ rss: 999 });
    const recorded = events(f.directory, status.sessionId);
    expect(recorded.filter((event) => event.category === "runtime-sample")).toHaveLength(2);
    expect(recorded.filter((event) => event.category === "fault")).toHaveLength(1);
    expect(marker(f.directory, status.sessionId).lastEventAt).toBe("2026-10-01T16:00:15.000Z");
  });

  it("keeps five owned sessions and size-bounded recent events without removing unrelated files", () => {
    const f = fixture(); mkdirSync(f.directory, { recursive: true });
    writeFileSync(join(f.directory, "unrelated.txt"), "keep me");
    writeFileSync(join(f.directory, "session-0000000000000-00000000-0000-0000-0000-000000000000.json"), JSON.stringify({ owner: "someone else" }));
    for (let index = 0; index < 8; index++) {
      const service = f.service({ maxBytes: 64 * 1024 }); service.initialize();
      for (let event = 0; event < 12; event++) service.record("rolling", { index, event, note: "x".repeat(2048) });
      service.markCleanExit(); f.advance();
    }
    const names = readdirSync(f.directory);
    const owned = names.filter((name) => /^(session|events)-/.test(name) && !name.includes("00000000-0000-0000-0000-000000000000"));
    expect(owned.filter((name) => name.startsWith("session-")).length).toBeLessThanOrEqual(5);
    expect(owned.filter((name) => name.startsWith("session-")).length).toBeGreaterThan(1);
    expect(owned.reduce((sum, name) => sum + statSync(join(f.directory, name)).size, 0)).toBeLessThanOrEqual(64 * 1024);
    expect(readFileSync(join(f.directory, "unrelated.txt"), "utf8")).toBe("keep me");
    expect(readFileSync(join(f.directory, "session-0000000000000-00000000-0000-0000-0000-000000000000.json"), "utf8")).toContain("someone else");
  }, 15_000);

  it("exports bounded sanitized events and native dump metadata without reading dump contents", () => {
    const f = fixture(); const dumps = join(f.root, "native"); mkdirSync(join(dumps, "pending"), { recursive: true });
    writeFileSync(join(dumps, "pending", "native-test.dmp"), "SECRET MEMORY DUMP CONTENTS");
    writeFileSync(join(dumps, "not-a-dump.txt"), "ignore");
    const service = f.service({ maxBytes: 64 * 1024, nativeDumpDirectory: dumps, nativeCrashReportingEnabled: true }); const status = service.initialize();
    for (let index = 0; index < 20; index++) service.record("recent-event", { index, note: "y".repeat(2048), password: "export-secret" });
    const path = join(f.root, "export.json"); const result = service.exportReport(path);
    expect(result).toEqual({ ok: true, path }); expect(statSync(path).size).toBeLessThanOrEqual(64 * 1024);
    const report = JSON.parse(readFileSync(path, "utf8"));
    expect(report.privacy).toMatchObject({ sanitized: true, memoryDumpContentsIncluded: false, rawCaptureDataIncluded: false });
    expect(report.nativeDumps).toEqual([{ filename: "native-test.dmp", modifiedAt: expect.any(String), bytes: 27 }]);
    expect(report.runtime).toMatchObject({ platform: "win32", arch: "x64", versions: { electron: "39.8.10" } });
    expect(report.events.at(-1).runId).toBe(report.currentSession.id);
    expect(JSON.stringify(report)).not.toContain("SECRET MEMORY DUMP CONTENTS"); expect(JSON.stringify(report)).not.toContain("export-secret");
    expect(service.getStatus()).toMatchObject({ nativeDumpCount: 1, latestReportPath: path });
    expect(readFileSync(join(dumps, "pending", "native-test.dmp"), "utf8")).toBe("SECRET MEMORY DUMP CONTENTS");
    expect(events(f.directory, status.sessionId).at(-1).data.index).toBe(19);
  });

  it("fails safely for unavailable destinations and never throws recursively from a fault handler", () => {
    const f = fixture(); writeFileSync(f.directory, "not a directory");
    const unavailable = f.service(); expect(() => unavailable.record("uncaught-exception", new Error("first"))).not.toThrow();
    expect(unavailable.getStatus()).toMatchObject({ enabled: false, lastWriteError: expect.any(String) });
    expect(unavailable.exportReport(join(f.root, "failed.json")).ok).toBe(false);
    const service = f.service({ directory: join(f.root, "working") }); const status = service.initialize();
    const log = join(status.directory, `events-${status.sessionId}.jsonl`); rmSync(log); mkdirSync(log);
    expect(() => service.record("fatal-write-failure", { reason: "test" }, { fatal: true })).not.toThrow();
    expect(service.getStatus().lastWriteError).toContain("linked diagnostics log");
    const destination = join(f.root, "directory-export"); mkdirSync(destination);
    expect(service.exportReport(destination)).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it("rejects a symlinked diagnostics directory without modifying its target", () => {
    const f = fixture(); const external = join(f.root, "unrelated-target"); mkdirSync(external); writeFileSync(join(external, "keep.txt"), "unchanged");
    symlinkSync(external, f.directory, process.platform === "win32" ? "junction" : "dir");
    const service = f.service(); expect(service.initialize()).toMatchObject({ enabled: false, lastWriteError: expect.any(String) });
    service.record("fault", new Error("ignored"));
    expect(readdirSync(external)).toEqual(["keep.txt"]); expect(readFileSync(join(external, "keep.txt"), "utf8")).toBe("unchanged");
  });

  it("rejects export into its own managed history, including different Windows path casing", () => {
    const f = fixture(); const service = f.service(); const status = service.initialize();
    const destination = join(f.directory, `session-${status.sessionId}.json`);
    const original = readFileSync(destination, "utf8");
    expect(service.exportReport(destination)).toMatchObject({ ok: false, error: expect.stringContaining("outside") });
    if (process.platform === "win32") expect(service.exportReport(destination.toUpperCase())).toMatchObject({ ok: false, error: expect.stringContaining("outside") });
    expect(readFileSync(destination, "utf8")).toBe(original);
  });
});
