import { readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { GamePlatform, ReplayVideoMimeType, ReplayVideoQuality, ReplayVideoSession } from "../../shared/types.js";

const RECOVERY_SIDECAR_SUFFIX = ".riftlite-recording.json";
const RIFTLITE_RECORDING_FILENAME = /^RiftLite_(?:atlas|tcga)-(?:compact|balanced|sharp|sharp30|youtube)-.+\.(?:webm|mp4)$/i;
const RECOVERY_MIN_AGE_MS = 15_000;
const RECOVERY_MIN_BYTES = 32 * 1024;
const RECOVERY_MAX_FILES = 20;

export interface ReplayVideoRecoverySidecar {
  version: 1;
  session: ReplayVideoSession;
  platform: GamePlatform;
  quality: ReplayVideoQuality;
  mimeType: ReplayVideoMimeType;
  title: string;
  createdAt: string;
}

export function replayVideoRecoverySidecarPath(filePath: string): string {
  return `${filePath}${RECOVERY_SIDECAR_SUFFIX}`;
}

export async function writeReplayVideoRecoverySidecar(
  filePath: string,
  sidecar: ReplayVideoRecoverySidecar
): Promise<void> {
  await writeFile(replayVideoRecoverySidecarPath(filePath), JSON.stringify(sidecar), "utf8");
}

export async function clearReplayVideoRecoverySidecar(filePath: string): Promise<void> {
  await unlink(replayVideoRecoverySidecarPath(filePath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

export async function interruptedReplayVideoCandidates(
  directory: string,
  knownVideoPaths: Iterable<string>,
  nowMs = Date.now()
): Promise<string[]> {
  const known = new Set(Array.from(knownVideoPaths, normalizedPath));
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const entryNames = new Set(entries.map((entry) => entry.name));
  const candidates: Array<{ path: string; modifiedAt: number }> = [];

  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:webm|mp4)$/i.test(entry.name)) {
      continue;
    }
    const filePath = join(directory, entry.name);
    if (known.has(normalizedPath(filePath))) {
      continue;
    }
    const hasSidecar = entryNames.has(`${entry.name}${RECOVERY_SIDECAR_SUFFIX}`);
    if (!hasSidecar && !RIFTLITE_RECORDING_FILENAME.test(entry.name)) {
      continue;
    }
    const fileStats = await stat(filePath).catch(() => null);
    if (!fileStats?.isFile() || fileStats.size < RECOVERY_MIN_BYTES || nowMs - fileStats.mtimeMs < RECOVERY_MIN_AGE_MS) {
      continue;
    }
    candidates.push({ path: filePath, modifiedAt: fileStats.mtimeMs });
  }

  return candidates
    .sort((left, right) => left.modifiedAt - right.modifiedAt)
    .slice(0, RECOVERY_MAX_FILES)
    .map((candidate) => candidate.path);
}

function normalizedPath(filePath: string): string {
  const normalized = resolve(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
