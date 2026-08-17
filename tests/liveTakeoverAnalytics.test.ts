import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isPackaged: true,
  getVersion: vi.fn(() => "0.9.43"),
}));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged;
    },
    getVersion: mocks.getVersion,
  },
}));

import { sendLiveTakeoverTelemetry } from "../src/main/services/liveTakeoverAnalytics.js";

const payload = {
  runId: "run_1234567890123456",
  token: "signed-token-".repeat(5),
  sessionId: "session_1234567890123456",
  channelLogin: "stresscasts",
  event: "checkpoint" as const,
  hasPlayed: true,
  watchedSeconds: 600,
  startedAt: "2026-08-15T12:00:00.000Z",
  occurredAt: "2026-08-15T12:10:00.000Z",
};

describe("desktop live takeover analytics transport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.isPackaged = true;
  });

  it("honors anonymous diagnostics and sends the install id only to the hashing endpoint", async () => {
    const getSettings = vi.fn().mockResolvedValue({
      anonymousDiagnosticsEnabled: true,
      anonymousInstallId: "install-id-1234567890",
      anonymousInstallCreatedAt: "2026-08-01T00:00:00.000Z",
    });
    const saveSettings = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);

    await expect(sendLiveTakeoverTelemetry({ getSettings, saveSettings } as never, payload)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://www.riftlite.com/api/app/live-takeover/analytics");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      ...payload,
      installId: "install-id-1234567890",
      appVersion: "0.9.43",
      platform: process.platform,
    });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("creates an anonymous install id when consent is enabled", async () => {
    const getSettings = vi.fn().mockResolvedValue({
      anonymousDiagnosticsEnabled: true,
      anonymousInstallId: "",
      anonymousInstallCreatedAt: "",
    });
    const saveSettings = vi.fn().mockImplementation(async (patch) => ({
      anonymousDiagnosticsEnabled: true,
      anonymousInstallCreatedAt: patch.anonymousInstallCreatedAt,
      anonymousInstallId: patch.anonymousInstallId,
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);

    await sendLiveTakeoverTelemetry({ getSettings, saveSettings } as never, payload);
    expect(saveSettings).toHaveBeenCalledWith({
      anonymousInstallId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      anonymousInstallCreatedAt: expect.any(String),
    });
  });

  it("does nothing when anonymous diagnostics are disabled", async () => {
    const getSettings = vi.fn().mockResolvedValue({
      anonymousDiagnosticsEnabled: false,
      anonymousInstallId: "install-id-1234567890",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(sendLiveTakeoverTelemetry({ getSettings } as never, payload)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
