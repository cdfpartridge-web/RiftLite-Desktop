import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("IPC registration boundary", () => {
  const source = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
  const registerIpcSource = source.slice(source.indexOf("function registerIpc(): void"));

  it("registers every app-only invoke channel behind the trusted renderer guard", () => {
    const guardedChannels = [...registerIpcSource.matchAll(/handleTrustedAppIpc\("([^"]+)"/g)]
      .map((match) => match[1]);

    expect(guardedChannels.length).toBeGreaterThan(150);
    expect(guardedChannels).toContain("settings:get");
    expect(guardedChannels).toContain("matches:get");
    expect(guardedChannels).toContain("hubs:create");
    expect(guardedChannels).toContain("account:cloud-sync:restore");
    expect(guardedChannels).toContain("backup:restore");
    expect(guardedChannels).toContain("diagnostics:bundle");
    expect(guardedChannels).toContain("game-webview:focus");
  });

  it("keeps game-facing invoke channels on explicit sender validators", () => {
    const rawChannels = [...registerIpcSource.matchAll(/ipcMain\.handle\("([^"]+)"/g)]
      .map((match) => match[1]);

    expect(rawChannels).toEqual([
      "capture:debug-enabled",
      "capture:tcga-replay-research-active"
    ]);
    expect(registerIpcSource).toContain(
      "if (!isTrustedAppIpcSender(event) && !trustedGameIpcPlatform(event))"
    );
    expect(registerIpcSource).toContain(
      "if (trustedGameIpcPlatform(event) !== \"tcga\")"
    );
  });

  it("keeps TCGA research checkpoints on their dedicated local recorder path", () => {
    const start = registerIpcSource.indexOf('ipcMain.on("capture:tcga-research-event"');
    const end = registerIpcSource.indexOf('ipcMain.on("capture:event"', start);
    const handler = registerIpcSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(handler).toContain('trustedGameIpcPlatform(ipcEvent) !== "tcga"');
    expect(handler).toContain("validatedTcgaResearchEvent(value)");
    expect(handler).toContain("recordTcgaReplayResearch");
    expect(handler).not.toContain("capture.handleEvent");
  });
});
