import type { GamePlatform, ReplayVideoCaptureMode } from "../../shared/types.js";

export interface ReplayVideoDisplayTarget {
  platform: GamePlatform;
  mode: ReplayVideoCaptureMode;
  expiresAt: number;
  requesterWebContentsId: number;
}

export interface DisplayMediaRequestEvidence {
  requesterWebContentsId: number | null;
  trustedAppWebContentsIds: readonly number[];
  requesterIsTrustedApp: boolean;
  requesterIsMainFrame: boolean;
  originIsTrusted: boolean;
  videoRequested: boolean;
  audioRequested: boolean;
}

/**
 * Electron's native display-media callback accepts null as an explicit denial,
 * although the public TypeScript declaration currently exposes Streams only.
 */
export function createSingleUseDisplayMediaResponder(
  callback: (streams: Electron.Streams) => void,
  onError: (error: unknown) => void = () => undefined
): (streams: Electron.Streams | null) => boolean {
  let settled = false;
  return (streams) => {
    if (settled) {
      return false;
    }
    settled = true;
    try {
      (callback as (value: Electron.Streams | null) => void)(streams);
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  };
}

export function isTrustedRiftLiteAppOrigin(origin: string, isDevelopment: boolean): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === "file:" && !parsed.hostname) {
      return true;
    }
    return isDevelopment && (
      parsed.origin === "http://127.0.0.1:5173" ||
      parsed.origin === "http://localhost:5173"
    );
  } catch {
    return false;
  }
}

export function displayMediaRequestIsTrusted(evidence: DisplayMediaRequestEvidence): boolean {
  return evidence.requesterWebContentsId !== null &&
    evidence.trustedAppWebContentsIds.includes(evidence.requesterWebContentsId) &&
    evidence.requesterIsTrustedApp &&
    evidence.requesterIsMainFrame &&
    evidence.originIsTrusted &&
    evidence.videoRequested &&
    !evidence.audioRequested;
}

export function preparedDisplayMediaTargetForRequester(
  target: ReplayVideoDisplayTarget | null,
  requesterWebContentsId: number,
  now = Date.now()
): ReplayVideoDisplayTarget | null {
  if (
    !target ||
    target.expiresAt <= now ||
    target.requesterWebContentsId !== requesterWebContentsId
  ) {
    return null;
  }
  return target;
}
