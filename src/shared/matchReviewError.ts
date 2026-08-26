const SQL_RUNTIME_FAILURE = /memory access out of bounds|null function or function signature mismatch|table index is out of bounds|bad parameter or other api misuse/i;

const SAFE_REVIEW_DETAIL = [
  /^This match's local database row is unreadable\./i,
  /^This captured match was deleted while its review was open\./i,
  /^This saved match is no longer in local history\./i,
  /^The captured match did not match the requested deletion\./i,
  /^RiftLite data changed (?:while|before) a database operation/i
];

function reviewErrorText(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (message || fallback)
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function recoveryAction(fallback: string): string {
  if (/^Delete\b/i.test(fallback)) {
    return "restart RiftLite, then try Delete capture again";
  }
  if (/^Review later\b/i.test(fallback)) {
    return "restart RiftLite, then try Review later again";
  }
  if (/^The match editor\b/i.test(fallback)) {
    return "restart RiftLite, then try Cancel again";
  }
  return "restart RiftLite, then try Save match again";
}

/**
 * Converts main-process persistence failures into bounded review copy.
 * Arbitrary exception text can contain file paths, stacks, or captured payload
 * keys, so only explicitly controlled lifecycle messages are shown verbatim.
 */
export function matchReviewErrorMessage(error: unknown, fallback: string): string {
  const raw = reviewErrorText(error, fallback);
  const action = recoveryAction(fallback);
  if (SQL_RUNTIME_FAILURE.test(raw)) {
    return `${fallback} RiftLite's local database runtime stopped responding. This review is still open; ${action}.`;
  }
  if (raw !== fallback && raw.length <= 220 && SAFE_REVIEW_DETAIL.some((pattern) => pattern.test(raw))) {
    return `${fallback} ${raw}`;
  }
  return `${fallback} RiftLite could not update local match storage. This review is still open; ${action}.`;
}
