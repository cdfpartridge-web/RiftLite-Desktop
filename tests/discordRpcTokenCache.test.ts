import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readTokenCache,
  writeTokenCache,
  type DiscordRpcTokenEncryption
} from "../src/main/services/discordRpc.js";

class TestEncryption implements DiscordRpcTokenEncryption {
  constructor(
    private readonly available = true,
    private readonly failEncryption = false
  ) {}

  isAvailable(): boolean {
    return this.available;
  }

  encrypt(value: string): Buffer {
    if (this.failEncryption) {
      throw new Error("test encryption failure");
    }
    return Buffer.from(`discord-test:${[...value].reverse().join("")}`, "utf8");
  }

  decrypt(value: Buffer): string {
    const encrypted = value.toString("utf8");
    if (!encrypted.startsWith("discord-test:")) {
      throw new Error("invalid test ciphertext");
    }
    return [...encrypted.slice("discord-test:".length)].reverse().join("");
  }
}

const token = {
  accessToken: "discord-access-secret",
  refreshToken: "discord-refresh-secret",
  expiresAt: 1_900_000_000_000
};

describe("Discord RPC token cache", () => {
  it("migrates a legacy plaintext cache atomically and decrypts it after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-discord-token-migrate-"));
    try {
      const path = join(directory, "discord-rpc-token.json");
      await writeFile(path, JSON.stringify(token), "utf8");
      const encryption = new TestEncryption();

      expect(await readTokenCache(path, encryption)).toEqual(token);
      const migrated = await readFile(path, "utf8");
      expect(migrated).toContain("riftlite.discord-rpc-token");
      expect(migrated).not.toContain(token.accessToken);
      expect(migrated).not.toContain(token.refreshToken);
      expect(await readTokenCache(path, new TestEncryption())).toEqual(token);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes new caches as encrypted ciphertext when OS protection is available", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-discord-token-write-"));
    try {
      const path = join(directory, "nested", "discord-rpc-token.json");
      await writeTokenCache(path, token, new TestEncryption());

      const raw = await readFile(path, "utf8");
      expect(raw).not.toContain(token.accessToken);
      expect(raw).not.toContain(token.refreshToken);
      expect(await readTokenCache(path, new TestEncryption())).toEqual(token);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses plaintext only while encryption is unavailable and migrates it later", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-discord-token-fallback-"));
    try {
      const path = join(directory, "discord-rpc-token.json");
      const unavailable = new TestEncryption(false);
      await writeTokenCache(path, token, unavailable);

      expect(await readTokenCache(path, unavailable)).toEqual(token);
      expect(await readFile(path, "utf8")).toContain(token.refreshToken);

      expect(await readTokenCache(path, new TestEncryption())).toEqual(token);
      const migrated = await readFile(path, "utf8");
      expect(migrated).not.toContain(token.accessToken);
      expect(migrated).not.toContain(token.refreshToken);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not destroy a usable legacy cache when encrypted migration fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-discord-token-failed-migrate-"));
    try {
      const path = join(directory, "discord-rpc-token.json");
      const legacy = JSON.stringify(token);
      await writeFile(path, legacy, "utf8");

      expect(await readTokenCache(path, new TestEncryption(true, true))).toEqual(token);
      expect(await readFile(path, "utf8")).toBe(legacy);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not expose an encrypted cache when OS decryption is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-discord-token-locked-"));
    try {
      const path = join(directory, "discord-rpc-token.json");
      await writeTokenCache(path, token, new TestEncryption());

      expect(await readTokenCache(path, new TestEncryption(false))).toBeNull();
      const raw = await readFile(path, "utf8");
      expect(raw).not.toContain(token.accessToken);
      expect(raw).not.toContain(token.refreshToken);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
