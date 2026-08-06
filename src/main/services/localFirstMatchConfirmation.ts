export type LocalFirstMatchConfirmationOperations<Draft, Saved> = {
  saveLocally: (draft: Draft) => Promise<Saved>;
  shouldDeliverInBackground: (saved: Saved) => boolean;
  queueBackgroundDelivery: (saved: Saved) => void;
  deliverBeforeResponse: (saved: Saved) => Promise<Saved>;
};

type ConfirmedMatchDeliveryCandidate = {
  platform: string;
  source?: string;
};

type ConfirmedMatchReportRetryCandidate = ConfirmedMatchDeliveryCandidate & {
  id: string;
  capturedAt: string;
  updatedAt: string;
  status: string;
  sync: {
    community: string;
    hubs: Record<string, string>;
    teams?: Record<string, string>;
  };
};

export type ConfirmedMatchReportRetrySelection<Saved> = {
  matches: Saved[];
};

export type ConfirmedMatchReportRetryBatchResult<Saved> = {
  processed: Saved[];
  failure: { match: Saved; error: unknown } | null;
};

export type ConfirmedMatchBackgroundDeliveryOperations<Saved> = {
  finalizeReplay: (saved: Saved) => Promise<"sync-required" | "sync-complete">;
  loadLatest: (saved: Saved) => Promise<Saved>;
  syncMatch: (saved: Saved) => Promise<void>;
};

/** Automatic Atlas and TCGA captures can finish replay/report delivery safely in the background. */
export function confirmedMatchSupportsBackgroundDelivery(match: ConfirmedMatchDeliveryCandidate): boolean {
  return (match.platform === "atlas" || match.platform === "tcga") &&
    match.source !== "manual" &&
    match.source !== "scorepad";
}

/** Selects durable automatic matches whose remote report state still needs a retry. */
export function confirmedMatchNeedsReportRetry(match: ConfirmedMatchReportRetryCandidate): boolean {
  if (!confirmedMatchSupportsBackgroundDelivery(match) || match.status !== "saved") {
    return false;
  }
  const retryable = (state: string) => state === "pending" || state === "failed";
  return retryable(match.sync.community) ||
    Object.values(match.sync.hubs).some(retryable) ||
    Object.values(match.sync.teams ?? {}).some(retryable);
}

/**
 * Gives half of each bounded batch to the newest matches and half to the
 * least-recently-attempted remainder. A failed old row therefore cannot keep
 * every newer report outside the retry window, while older work still makes
 * progress as its updatedAt timestamp advances.
 */
export function selectConfirmedMatchReportRetries<Saved extends ConfirmedMatchReportRetryCandidate>(
  matches: Saved[],
  limit = 10
): ConfirmedMatchReportRetrySelection<Saved> {
  const boundedLimit = Math.max(1, Math.trunc(limit));
  const eligible = matches.filter(confirmedMatchNeedsReportRetry);
  if (eligible.length <= boundedLimit) {
    return {
      matches: [...eligible].sort((left, right) => timestamp(right.capturedAt) - timestamp(left.capturedAt))
    };
  }

  const newestCount = Math.max(1, Math.ceil(boundedLimit / 2));
  const newest = [...eligible]
    .sort((left, right) => timestamp(right.capturedAt) - timestamp(left.capturedAt))
    .slice(0, newestCount);
  const newestIds = new Set(newest.map((match) => match.id));
  const fairRemainder = eligible
    .filter((match) => !newestIds.has(match.id))
    .sort((left, right) => {
      const attemptDifference = timestamp(left.updatedAt) - timestamp(right.updatedAt);
      return attemptDifference || timestamp(left.capturedAt) - timestamp(right.capturedAt);
    })
    .slice(0, boundedLimit - newest.length);
  return { matches: [...newest, ...fairRemainder] };
}

/**
 * Stops a background batch when an error escapes the per-match sync layer.
 * Destination-specific failures are represented in the returned match, so a
 * thrown error here indicates shared auth, identity, or storage infrastructure
 * which should not be retried for every row in the same sweep.
 */
export async function runConfirmedMatchReportRetryBatch<Saved>(
  matches: Saved[],
  syncMatch: (match: Saved) => Promise<Saved>
): Promise<ConfirmedMatchReportRetryBatchResult<Saved>> {
  const processed: Saved[] = [];
  for (const match of matches) {
    try {
      processed.push(await syncMatch(match));
    } catch (error) {
      return { processed, failure: { match, error } };
    }
  }
  return { processed, failure: null };
}

/** Coalesces overlapping timer/startup requests without suppressing a later retry. */
export function createSingleFlight<Result>(operation: () => Promise<Result>): () => Promise<Result> {
  let inFlight: Promise<Result> | null = null;
  return () => {
    if (inFlight) {
      return inFlight;
    }
    const run = Promise.resolve().then(operation);
    inFlight = run;
    void run.then(
      () => {
        if (inFlight === run) inFlight = null;
      },
      () => {
        if (inFlight === run) inFlight = null;
      }
    );
    return run;
  };
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Preserves replay-before-report ordering while allowing a provider to report during publication. */
export async function deliverConfirmedMatchInBackground<Saved>(
  saved: Saved,
  operations: ConfirmedMatchBackgroundDeliveryOperations<Saved>
): Promise<void> {
  const finalization = await operations.finalizeReplay(saved);
  if (finalization === "sync-complete") {
    return;
  }
  const latest = await operations.loadLatest(saved);
  await operations.syncMatch(latest);
}

/**
 * Keeps the local database commit as the confirmation boundary for providers
 * whose replay/report delivery can continue independently. Providers that do
 * not opt in retain the existing, synchronous confirmation behaviour.
 */
export async function confirmMatchLocalFirst<Draft, Saved>(
  draft: Draft,
  operations: LocalFirstMatchConfirmationOperations<Draft, Saved>
): Promise<Saved> {
  const saved = await operations.saveLocally(draft);
  if (!operations.shouldDeliverInBackground(saved)) {
    return operations.deliverBeforeResponse(saved);
  }
  operations.queueBackgroundDelivery(saved);
  return saved;
}
