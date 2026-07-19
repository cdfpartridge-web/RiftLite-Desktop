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
  });

  it("leaves only the game debug-status channel on its explicit dual-origin validator", () => {
    const rawChannels = [...registerIpcSource.matchAll(/ipcMain\.handle\("([^"]+)"/g)]
      .map((match) => match[1]);

    expect(rawChannels).toEqual(["capture:debug-enabled"]);
    expect(registerIpcSource).toContain(
      "if (!isTrustedAppIpcSender(event) && !trustedGameIpcPlatform(event))"
    );
  });
});
