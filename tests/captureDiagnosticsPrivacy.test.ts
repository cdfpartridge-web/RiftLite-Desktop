import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("electron", () => ({ app: { getPath: () => tmpdir() } }));

import { CaptureDiagnostics } from "../src/main/services/captureDiagnostics.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("CaptureDiagnostics privacy exports", () => {
  it("writes a redacted file by default and requires explicit approval for sensitive data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-diagnostics-test-"));
    temporaryDirectories.push(directory);
    const diagnostics = new CaptureDiagnostics(join(directory, "events.jsonl"));
    await diagnostics.record({
      id: "atlas-privacy-test",
      platform: "atlas",
      kind: "debug",
      capturedAt: "2026-07-19T12:00:00.000Z",
      url: "https://play.riftatlas.com/game/ROOM-1?token=url-secret",
      payload: {
        myName: "Private Player",
        roomCode: "ROOM-1",
        raw: "raw-secret"
      }
    });

    const redactedPath = await diagnostics.createBundle();
    const redacted = await readFile(redactedPath, "utf8");
    expect(redactedPath).toContain("-redacted-");
    expect(redacted).not.toContain("Private Player");
    expect(redacted).not.toContain("ROOM-1");
    expect(redacted).not.toContain("raw-secret");

    await expect(diagnostics.createBundle({ includeSensitiveData: true }))
      .rejects.toThrow("explicit confirmation");

    const sensitivePath = await diagnostics.createBundle({
      includeSensitiveData: true,
      confirmSensitiveDataExport: true
    });
    const sensitive = await readFile(sensitivePath, "utf8");
    expect(sensitivePath).toContain("-SENSITIVE-");
    expect(sensitive).toContain("Private Player");
    expect(sensitive).toContain("ROOM-1");
    expect(sensitive).toContain("raw-secret");
  });
});
