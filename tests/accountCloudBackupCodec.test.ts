import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_CLOUD_MAX_DECODED_BYTES, ACCOUNT_CLOUD_MAX_ENCODED_BYTES, ACCOUNT_CLOUD_MAX_ENTRIES,
  assertAccountCloudBackupSize, assertAccountCloudBackupStructure, decodeAccountCloudBackup,
} from "../src/main/services/accountCloudBackupCodec.js";

const backup = (settings: object = {}) => ({ format: "riftlite.backup", version: 1, settings,
  matches: [], deletedMatches: [], decks: [], notebooks: [], replays: [], deletedReplays: [] });
const encode = (value: unknown) => deflateRawSync(Buffer.from(JSON.stringify(value))).toString("base64");

describe("bounded account cloud decoder worker", () => {
  it("roundtrips the shared legacy/v2 backup document without a runtime loader or worker file", async () => {
    const value = backup({ username: "Fixture", rawCapture: { enabled: false } });
    expect(await decodeAccountCloudBackup(encode(value))).toEqual(value);
  });
  it("keeps the 33 MiB review example supported while the main event loop continues", async () => {
    const encoded = encode(backup({ padding: "x".repeat(32 * 1024 * 1024) }));
    let beats = 0;
    const heartbeat = setInterval(() => { beats++; }, 1);
    try {
      const result = await decodeAccountCloudBackup(encoded);
      expect((result.settings as unknown as { padding: string }).padding.length).toBe(32 * 1024 * 1024);
      expect(beats).toBeGreaterThan(0);
    } finally { clearInterval(heartbeat); }
  });
  it("rejects expansion past the decoded limit before parsing or returning a backup", async () => {
    const encoded = deflateRawSync(Buffer.alloc(ACCOUNT_CLOUD_MAX_DECODED_BYTES + 1, 32)).toString("base64");
    await expect(decodeAccountCloudBackup(encoded)).rejects.toThrow("64 MiB decoded");
  });
  it("rejects excessive encoded input before spawning a decoder", async () => {
    await expect(decodeAccountCloudBackup("a".repeat(ACCOUNT_CLOUD_MAX_ENCODED_BYTES + 1))).rejects.toThrow("32 MiB encoded");
  });
  it("bounds graph depth in both publication and worker validation", async () => {
    const nested: Record<string, unknown> = {};
    let current = nested;
    for (let index = 0; index < 90; index++) { const child = {}; current.child = child; current = child; }
    expect(() => assertAccountCloudBackupStructure(backup(nested))).toThrow("too complex");
    await expect(decodeAccountCloudBackup(encode(backup(nested)))).rejects.toThrow("too complex");
  });
  it("does not permit publication of a backup outside either supported size limit", () => {
    expect(() => assertAccountCloudBackupSize("x".repeat(ACCOUNT_CLOUD_MAX_DECODED_BYTES + 1))).toThrow("64 MiB decoded");
    expect(() => assertAccountCloudBackupSize("{}", "a".repeat(ACCOUNT_CLOUD_MAX_ENCODED_BYTES + 1))).toThrow("32 MiB encoded");
  });
  it("bounds flat scalar arrays before structured cloning, including publication", async () => {
    const value = backup({ values: Array.from({ length: ACCOUNT_CLOUD_MAX_ENTRIES + 1 }, () => 0) });
    expect(() => assertAccountCloudBackupStructure(value)).toThrow("too complex");
    await expect(decodeAccountCloudBackup(encode(value))).rejects.toThrow("too complex");
  });
  it("terminates cancelled and timed-out workers before another decode begins", async () => {
    const encoded = encode(backup());
    const before = new AbortController(); before.abort();
    await expect(decodeAccountCloudBackup(encoded, { signal: before.signal })).rejects.toThrow("cancelled");
    const controller = new AbortController();
    const pending = decodeAccountCloudBackup(encoded, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    await expect(decodeAccountCloudBackup(encoded, { timeoutMs: 1 })).rejects.toThrow("timed out");
    expect(await decodeAccountCloudBackup(encoded)).toEqual(backup());
  });
  it("reports malformed compressed data and unsupported JSON shape without leaking input", async () => {
    await expect(decodeAccountCloudBackup("invalid")).rejects.toThrow("decoded safely");
    await expect(decodeAccountCloudBackup(encode({ secret: "must-not-return" }))).rejects.toThrow("decoded safely");
  });
});
