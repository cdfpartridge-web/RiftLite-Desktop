import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { copyFile, link, lstat, mkdir, open, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

export interface StagedReplayVideo {
  stagingPath: string;
  destinationPath: string;
}

export interface PublishedReplayVideo {
  path: string;
  /** Publication succeeded even if removing the original copy was denied. */
  sourceRetained: boolean;
  retainedTemporaryPath?: string;
}

type PublicationFileIdentity = {
  device: string;
  inode: string;
  size: string;
  birthtimeNs: string;
  mtimeNs: string;
};

type ReplayVideoPublicationMarker = {
  version: 1;
  destinationPath: string;
  sourceIdentity: PublicationFileIdentity;
  destinationIdentity: PublicationFileIdentity;
};

const PUBLICATION_MARKER_SUFFIX = ".riftlite-publication.json";

export function replayVideoPublicationMarkerPath(stagingPath: string): string {
  return `${stagingPath}${PUBLICATION_MARKER_SUFFIX}`;
}

export function replayVideoDiscardMarkerPath(stagingPath: string): string {
  return `${stagingPath}.riftlite-discarded.json`;
}

/** The caller supplies a local app-data root, never the synced replay folder. */
export async function createStagedReplayVideo(
  stagingDirectory: string,
  destinationDirectory: string,
  filename: string
): Promise<StagedReplayVideo> {
  if (!isAbsolute(stagingDirectory) || !isAbsolute(destinationDirectory)) {
    throw new Error("Replay recording storage requires absolute directories.");
  }
  if (!filename || basename(filename) !== filename || /[\\/]/.test(filename) || !/\.(webm|mp4)$/i.test(filename)) {
    throw new Error("Replay recording filename is invalid.");
  }
  const extension = extname(filename);
  const stagingName = `${filename.slice(0, -extension.length)}-${randomUUID()}${extension}`;
  const stagingPath = join(stagingDirectory, stagingName);
  await mkdir(stagingDirectory, { recursive: true });
  await writeFile(stagingPath, Buffer.alloc(0), { flag: "wx" });
  return { stagingPath, destinationPath: join(destinationDirectory, filename) };
}

/**
 * Publish only after the recorder has stopped and its container is finalized.
 * A hard link publishes a complete file atomically without replacing a file
 * another capture or process already created. For a different volume, copy to
 * a unique temporary name on that volume before publishing the final link.
 * Failure before publication leaves the original recording untouched.
 */
export async function publishStagedReplayVideo(
  stagingPath: string,
  destinationPath: string
): Promise<PublishedReplayVideo> {
  if (!isAbsolute(stagingPath) || !isAbsolute(destinationPath) || samePath(stagingPath, destinationPath)) {
    throw new Error("Replay recording publication paths are invalid.");
  }
  const original = await lstat(stagingPath, { bigint: true });
  if (!original.isFile() || original.size <= 0n) {
    throw new Error("Replay recording is empty or is not a regular file.");
  }
  await mkdir(dirname(destinationPath), { recursive: true });
  const markerPath = replayVideoPublicationMarkerPath(stagingPath);
  const publishCompleteFile = async (completePath: string): Promise<void> => {
    const [current, destination] = await Promise.all([
      lstat(stagingPath, { bigint: true }), lstat(completePath, { bigint: true })
    ]);
    if (!sameIdentity(current, fileIdentity(original)) || !destination.isFile() || destination.size !== original.size) {
      throw new Error("Replay recording changed during publication; its local copy was retained.");
    }
    const marker: ReplayVideoPublicationMarker = {
      version: 1,
      destinationPath,
      sourceIdentity: fileIdentity(original),
      destinationIdentity: fileIdentity(destination)
    };
    // This exists before the final filename can appear. A crash after linking
    // therefore cannot make recovery import both names as separate recordings.
    await writeFile(markerPath, JSON.stringify(marker), { flag: "wx" });
    try {
      await link(completePath, destinationPath);
    } catch (error) {
      await unlink(markerPath).catch(() => undefined);
      throw error;
    }
  };
  let temporaryPath: string | undefined;
  let retainedTemporaryPath: string | undefined;
  try {
    try {
      await publishCompleteFile(stagingPath);
    } catch (error) {
      // EEXIST is deliberately never retried by renaming over the destination.
      // EPERM/ENOTSUP may describe linking between differing filesystems; the
      // destination-volume link below must still succeed or we retain source.
      if (!["EXDEV", "EPERM", "ENOTSUP", "EOPNOTSUPP"].includes(errorCode(error))) throw error;
      temporaryPath = join(dirname(destinationPath), `.riftlite-publish-${randomUUID()}.tmp`);
      try {
        await copyFile(stagingPath, temporaryPath, constants.COPYFILE_EXCL);
      } catch (copyError) {
        // Even an improbable temporary-name collision belongs to somebody
        // else. Do not let failure cleanup remove that pre-existing file.
        if (errorCode(copyError) === "EEXIST") temporaryPath = undefined;
        throw copyError;
      }
      await publishCompleteFile(temporaryPath);
    }
  } finally {
    if (temporaryPath) {
      try {
        await unlink(temporaryPath);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") retainedTemporaryPath = temporaryPath;
      }
    }
  }

  let sourceRetained = false;
  try {
    await unlink(stagingPath);
  } catch (error) {
    sourceRetained = errorCode(error) !== "ENOENT";
  }
  if (!sourceRetained) await unlink(markerPath).catch(() => undefined);
  return {
    path: destinationPath,
    sourceRetained,
    ...(retainedTemporaryPath ? { retainedTemporaryPath } : {})
  };
}

/**
 * Read-only recovery redirect. A marker is just a hint until both file
 * identities match. A collision, edited file, replaced destination, failed
 * publication, invalid marker or unsupported identity leaves source eligible
 * for normal recovery instead of hiding a potentially unique recording.
 */
export async function verifiedPublishedReplayVideoPath(stagingPath: string): Promise<string | null> {
  return (await verifiedReplayVideoPublication(stagingPath))?.destinationPath ?? null;
}

async function verifiedReplayVideoPublication(stagingPath: string): Promise<ReplayVideoPublicationMarker | null> {
  try {
    const markerPath = replayVideoPublicationMarkerPath(stagingPath);
    const markerStats = await lstat(markerPath);
    if (!markerStats.isFile() || markerStats.size > 8_192) return null;
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as Partial<ReplayVideoPublicationMarker>;
    if (marker.version !== 1 || typeof marker.destinationPath !== "string" ||
      !isAbsolute(marker.destinationPath) || samePath(stagingPath, marker.destinationPath)) return null;
    const [source, destination] = await Promise.all([
      lstat(stagingPath, { bigint: true }), lstat(marker.destinationPath, { bigint: true })
    ]);
    return sameIdentity(source, marker.sourceIdentity) && sameIdentity(destination, marker.destinationIdentity)
      ? marker as ReplayVideoPublicationMarker
      : null;
  } catch {
    return null;
  }
}

/** Record explicit discard intent before the caller removes a published file. */
export async function discardPublishedReplayVideoSources(
  stagingDirectory: string,
  destinationPath: string
): Promise<number> {
  const entries = await readdir(stagingDirectory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  let marked = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(PUBLICATION_MARKER_SUFFIX)) continue;
    const stagingPath = join(stagingDirectory, entry.name.slice(0, -PUBLICATION_MARKER_SUFFIX.length));
    const publication = await verifiedReplayVideoPublication(stagingPath);
    if (!publication || !samePath(publication.destinationPath, destinationPath)) continue;
    const source = await lstat(stagingPath, { bigint: true });
    const identity = publication.sourceIdentity;
    if (!sameIdentity(source, identity)) continue;
    const discardPath = replayVideoDiscardMarkerPath(stagingPath);
    if (!await isDiscardedStagedReplayVideo(stagingPath)) {
      // A locked source can outlive deletion of its final copy. Persist and
      // flush intent first, so startup never restores the discarded recording.
      const file = await open(discardPath, "wx");
      try {
        await file.writeFile(JSON.stringify({ version: 1, sourceIdentity: identity }));
        await file.sync();
      } finally {
        await file.close();
      }
    }
    marked += 1;
    try {
      if (!sameIdentity(await lstat(stagingPath, { bigint: true }), identity)) continue;
      await unlink(stagingPath);
      await Promise.all([
        discardPath, replayVideoPublicationMarkerPath(stagingPath),
        `${stagingPath}.riftlite-recording.json`, `${stagingPath}.seekable`
      ].map((filePath) => unlink(filePath).catch(() => undefined)));
    } catch {
      // The identity-bound tombstone remains while source is locked. A file
      // subsequently placed at the same path will not match that identity.
    }
  }
  return marked;
}

export async function isDiscardedStagedReplayVideo(stagingPath: string): Promise<boolean> {
  try {
    const markerPath = replayVideoDiscardMarkerPath(stagingPath);
    const markerStats = await lstat(markerPath);
    if (!markerStats.isFile() || markerStats.size > 8_192) return false;
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as { version?: unknown; sourceIdentity?: unknown };
    return marker.version === 1 && sameIdentity(await lstat(stagingPath, { bigint: true }), marker.sourceIdentity);
  } catch {
    return false;
  }
}

function fileIdentity(stats: BigIntStats): PublicationFileIdentity {
  return {
    device: String(stats.dev), inode: String(stats.ino), size: String(stats.size),
    birthtimeNs: String(stats.birthtimeNs), mtimeNs: String(stats.mtimeNs)
  };
}

function sameIdentity(stats: BigIntStats, identity: unknown): boolean {
  if (!stats.isFile() || stats.ino === 0n || !identity || typeof identity !== "object") return false;
  const expected = identity as Partial<PublicationFileIdentity>;
  const actual = fileIdentity(stats);
  return (Object.keys(actual) as Array<keyof PublicationFileIdentity>).every((key) => actual[key] === expected[key]);
}

function samePath(left: string, right: string): boolean {
  const a = resolve(left), b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}
