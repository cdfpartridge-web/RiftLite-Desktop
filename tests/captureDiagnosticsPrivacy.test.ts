import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  it("clears both current and rotated event logs before accepting new diagnostics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-diagnostics-clear-test-"));
    temporaryDirectories.push(directory);
    const eventPath = join(directory, "events.jsonl");
    const diagnostics = new CaptureDiagnostics(eventPath);
    await diagnostics.record({
      id: "enhanced-row",
      platform: "atlas",
      kind: "log-row",
      capturedAt: "2026-09-01T10:00:00.000Z",
      url: "https://play.riftatlas.com/game",
      payload: { rows: [{ key: "private", text: "enhanced-private-row" }] }
    });
    await writeFile(`${eventPath}.old`, "rotated-enhanced-private-row\n", "utf8");

    await diagnostics.clearStoredEvents();

    expect(await readFile(eventPath, "utf8")).toBe("");
    await expect(readFile(`${eventPath}.old`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await diagnostics.record({
      id: "post-clear",
      platform: "atlas",
      kind: "debug",
      capturedAt: "2026-09-01T10:01:00.000Z",
      url: "",
      payload: { reason: "post-clear" }
    });
    expect(await readFile(eventPath, "utf8")).toContain("post-clear");
    expect(await readFile(eventPath, "utf8")).not.toContain("enhanced-private-row");
  });

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
        reason: "atlas-resource-failure",
        routeKind: "sign-in",
        errorCode: -105,
        errorDescription: "Failed https://assets.riftatlas-workers.com/chunk.js?token=asset-secret",
        resourceOrigin: "https://assets.riftatlas-workers.com",
        resourceType: "script",
        statusCode: 503,
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
    expect(redacted).not.toContain("asset-secret");
    expect(redacted).toContain("atlas-resource-failure");
    expect(redacted).toContain("assets.riftatlas-workers.com");
    expect(redacted).toContain('"errorCode": -105');
    expect(redacted).toContain('"statusCode": 503');

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
    expect(sensitive).toContain("asset-secret");
  });
});
