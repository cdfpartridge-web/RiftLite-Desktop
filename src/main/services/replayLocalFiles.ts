import { extname, isAbsolute, relative, resolve } from "node:path";

import type { ReplayLocalAssetKind, ReplayRecord } from "../../shared/types.js";

export type ReplayLocalFileCandidate = {
  kind: ReplayLocalAssetKind;
  path: string;
};

export type ReplayLocalFileRoots = Record<ReplayLocalAssetKind, readonly string[]>;

const REPLAY_LOCAL_FILE_EXTENSIONS: Record<ReplayLocalAssetKind, ReadonlySet<string>> = {
  video: new Set([".mp4", ".webm"]),
  "raw-capture": new Set([".json", ".gz", ".jsonl"]),
  "replay-bundle": new Set([".riftreplay"]),
  frame: new Set([".jpg", ".jpeg", ".png", ".webp"])
};

function candidatePath(kind: ReplayLocalAssetKind, value: string | undefined): ReplayLocalFileCandidate | null {
  const path = value?.trim() ?? "";
  return path ? { kind, path } : null;
}

/**
 * Returns the useful on-disk assets for a replay in user-facing priority order.
 * The renderer only sends a replay ID; these paths always come from the stored
 * replay record and are validated again in the main process before being shown.
 */
export function replayLocalFileCandidates(
  replay: ReplayRecord,
  preferredKind?: ReplayLocalAssetKind
): ReplayLocalFileCandidate[] {
  const candidates: Array<ReplayLocalFileCandidate | null> = [
    candidatePath("video", replay.video?.path),
    candidatePath("raw-capture", replay.rawCapture?.localPath),
    replay.importedFrom?.toLowerCase().endsWith(".riftreplay")
      ? candidatePath("replay-bundle", replay.importedFrom)
      : null,
    ...(replay.visualFrames ?? []).map((frame) => candidatePath("frame", frame.path)),
    ...(replay.structuredEvents ?? []).map((event) => candidatePath("frame", event.screenshot?.path)),
    ...(replay.flags ?? []).map((flag) => candidatePath("frame", flag.thumbnailPath))
  ];
  const seen = new Set<string>();
  const unique = candidates.filter((candidate): candidate is ReplayLocalFileCandidate => {
    if (!candidate || (preferredKind && candidate.kind !== preferredKind)) {
      return false;
    }
    const key = `${candidate.kind}:${resolve(candidate.path).toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return unique;
}

export function replayLocalFilePathAllowed(
  candidate: ReplayLocalFileCandidate,
  roots: ReplayLocalFileRoots
): boolean {
  if (!isAbsolute(candidate.path)) {
    return false;
  }
  const allowedExtensions = REPLAY_LOCAL_FILE_EXTENSIONS[candidate.kind];
  if (!allowedExtensions.has(extname(candidate.path).toLowerCase())) {
    return false;
  }
  const resolvedPath = resolve(candidate.path);
  return roots[candidate.kind].some((root) => {
    if (!root.trim() || !isAbsolute(root)) {
      return false;
    }
    const pathBetween = relative(resolve(root), resolvedPath);
    return pathBetween === "" || Boolean(pathBetween && !pathBetween.startsWith("..") && !isAbsolute(pathBetween));
  });
}
