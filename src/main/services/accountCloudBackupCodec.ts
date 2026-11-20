import { Worker } from "node:worker_threads";
import type { RiftLiteBackupFile } from "../../shared/types.js";

// Keep these protocol limits aligned with website account-cloud-backup-codec.ts.
export const ACCOUNT_CLOUD_MAX_ENCODED_BYTES = 32 * 1024 * 1024;
export const ACCOUNT_CLOUD_MAX_DECODED_BYTES = 64 * 1024 * 1024;
export const ACCOUNT_CLOUD_MAX_CONTAINER_NODES = 250_000;
export const ACCOUNT_CLOUD_MAX_ENTRIES = 1_000_000;
export const ACCOUNT_CLOUD_MAX_DEPTH = 80;
const DECODE_TIMEOUT_MS = 30_000;

/** Also used before publication so this client cannot create an unrestorable backup. */
export function assertAccountCloudBackupSize(json: string, encoded?: string): void {
  if (Buffer.byteLength(json, "utf8") > ACCOUNT_CLOUD_MAX_DECODED_BYTES) {
    throw new Error("Account cloud backup exceeds the supported 64 MiB decoded size. Export a manual backup instead.");
  }
  if (encoded !== undefined && Buffer.byteLength(encoded, "utf8") > ACCOUNT_CLOUD_MAX_ENCODED_BYTES) {
    throw new Error("Account cloud backup exceeds the supported 32 MiB encoded size. Export a manual backup instead.");
  }
}

/** Bound the graph copied back from the worker as well as its serialized size. */
export function assertAccountCloudBackupStructure(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  let entries = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (!current.value || typeof current.value !== "object") continue;
    if (++nodes > ACCOUNT_CLOUD_MAX_CONTAINER_NODES || current.depth > ACCOUNT_CLOUD_MAX_DEPTH) {
      throw new Error("Account cloud backup is too complex to restore safely. Export a manual backup instead.");
    }
    if (Array.isArray(current.value) && current.value.length > ACCOUNT_CLOUD_MAX_ENTRIES - entries) {
      throw new Error("Account cloud backup is too complex to restore safely. Export a manual backup instead.");
    }
    for (const key in current.value) {
      if (!Object.hasOwn(current.value, key)) continue;
      if (++entries > ACCOUNT_CLOUD_MAX_ENTRIES) {
        throw new Error("Account cloud backup is too complex to restore safely. Export a manual backup instead.");
      }
      const child = (current.value as Record<string, unknown>)[key];
      if (child && typeof child === "object") {
        if (nodes + pending.length >= ACCOUNT_CLOUD_MAX_CONTAINER_NODES) {
          throw new Error("Account cloud backup is too complex to restore safely. Export a manual backup instead.");
        }
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
}

// Static, builtins-only worker source is embedded in the compiled main module.
// No runtime TypeScript loader, generated files, app paths or ASAR unpacking.
const DECODE_WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { inflateRawSync } = require("node:zlib");
try {
  const bytes = inflateRawSync(Buffer.from(workerData.encoded, "base64"), { maxOutputLength: workerData.maxBytes });
  const backup = JSON.parse(bytes.toString("utf8"));
  const pending = [{ value: backup, depth: 0 }];
  let nodes = 0;
  let entries = 0;
  while (pending.length) {
    const current = pending.pop();
    if (!current.value || typeof current.value !== "object") continue;
    if (++nodes > workerData.maxNodes || current.depth > workerData.maxDepth) throw new Error("complexity");
    if (Array.isArray(current.value) && current.value.length > workerData.maxEntries - entries) throw new Error("complexity");
    for (const key in current.value) {
      if (!Object.hasOwn(current.value, key)) continue;
      if (++entries > workerData.maxEntries) throw new Error("complexity");
      const child = current.value[key];
      if (child && typeof child === "object") {
        if (nodes + pending.length >= workerData.maxNodes) throw new Error("complexity");
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  if (!backup || backup.format !== "riftlite.backup" || backup.version !== 1 ||
      !backup.settings || typeof backup.settings !== "object" || Array.isArray(backup.settings) ||
      !["matches", "deletedMatches", "decks", "notebooks", "replays", "deletedReplays"].every(key => Array.isArray(backup[key]))) {
    throw new Error("format");
  }
  parentPort.postMessage({ ok: true, backup });
} catch (error) {
  parentPort.postMessage({ ok: false, code: error && error.code === "ERR_BUFFER_TOO_LARGE" ? "size" :
    error && error.message === "complexity" ? "complexity" : "invalid" });
}
`;

/** Both inflation and JSON parsing run off Electron's main thread. */
export function decodeAccountCloudBackup(
  encoded: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RiftLiteBackupFile> {
  if (!encoded || Buffer.byteLength(encoded, "utf8") > ACCOUNT_CLOUD_MAX_ENCODED_BYTES) {
    return Promise.reject(new Error("Account cloud backup exceeds the supported 32 MiB encoded size."));
  }
  if (options.signal?.aborted) return Promise.reject(new Error("Account cloud backup decoding was cancelled because the account changed."));
  return new Promise((resolve, reject) => {
    const worker = new Worker(DECODE_WORKER_SOURCE, {
      eval: true,
      workerData: { encoded, maxBytes: ACCOUNT_CLOUD_MAX_DECODED_BYTES, maxNodes: ACCOUNT_CLOUD_MAX_CONTAINER_NODES, maxEntries: ACCOUNT_CLOUD_MAX_ENTRIES, maxDepth: ACCOUNT_CLOUD_MAX_DEPTH },
      resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (error?: Error, backup?: RiftLiteBackupFile) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancelled);
      worker.removeAllListeners();
      worker.on("error", () => undefined);
      // Wait for exit before releasing the restore lane or beginning another decode.
      void worker.terminate().catch(() => undefined).then(() => error ? reject(error) : resolve(backup!));
    };
    const cancelled = () => finish(new Error("Account cloud backup decoding was cancelled because the account changed."));
    const timer = setTimeout(() => finish(new Error("Account cloud backup decoding timed out. The saved backup was left unchanged.")),
      Math.max(1, Math.min(DECODE_TIMEOUT_MS, options.timeoutMs ?? DECODE_TIMEOUT_MS)));
    options.signal?.addEventListener("abort", cancelled, { once: true });
    worker.once("error", () => finish(new Error("Account cloud backup could not be decoded within its safety limits.")));
    worker.once("exit", () => finish(new Error("Account cloud backup decoder stopped before completing.")));
    worker.once("message", (message: { ok?: boolean; code?: string; backup?: RiftLiteBackupFile }) => {
      if (message?.ok === true && message.backup) finish(undefined, message.backup);
      else finish(new Error(message?.code === "size"
        ? "Account cloud backup exceeds the supported 64 MiB decoded size."
        : message?.code === "complexity" ? "Account cloud backup is too complex to restore safely."
          : "Account cloud backup could not be decoded safely."));
    });
  });
}
