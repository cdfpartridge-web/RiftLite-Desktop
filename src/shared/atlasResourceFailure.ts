import type { AtlasResourceFailureDiagnostic } from "./types.js";

export const ATLAS_RECOVERY_CACHE_MISS_WINDOW_MS = 15_000;

interface AtlasResourceFailurePresentationContext {
  failure: AtlasResourceFailureDiagnostic;
  requestUrl: string;
  observedAt: number;
  recoveryCompletedAt?: number;
}

const passiveResourceTypes = new Set(["font", "image", "media"]);

/**
 * Cache clearing can cancel a passive static request while the replacement
 * Atlas guest is mounting. Keep that event in the raw diagnostic stream, but
 * do not present it as though the embedded page itself failed.
 */
export function isExpectedAtlasRecoveryCacheMiss(
  context: AtlasResourceFailurePresentationContext
): boolean {
  const { failure, requestUrl, observedAt, recoveryCompletedAt } = context;
  if (
    failure.reason !== "network-error" ||
    failure.error?.trim().toLowerCase() !== "net::err_cache_miss" ||
    !passiveResourceTypes.has(failure.resourceType.trim().toLowerCase()) ||
    !Number.isFinite(observedAt) ||
    typeof recoveryCompletedAt !== "number" ||
    !Number.isFinite(recoveryCompletedAt)
  ) {
    return false;
  }

  const elapsed = observedAt - recoveryCompletedAt;
  if (elapsed < 0 || elapsed > ATLAS_RECOVERY_CACHE_MISS_WINDOW_MS) return false;

  try {
    const request = new URL(requestUrl);
    const failureOrigin = new URL(failure.origin);
    if (request.origin !== failureOrigin.origin) return false;
    if (request.hostname === "assets.riftatlas-workers.com") return true;
    return request.hostname === "play.riftatlas.com" &&
      (/^\/_next\/static\//.test(request.pathname) || /^\/npm\//.test(request.pathname));
  } catch {
    return false;
  }
}

export function shouldPresentAtlasResourceFailure(
  context: AtlasResourceFailurePresentationContext
): boolean {
  return !isExpectedAtlasRecoveryCacheMiss(context);
}
