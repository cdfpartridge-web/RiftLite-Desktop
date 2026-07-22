import { describe, expect, it, vi } from "vitest";
import {
  confirmedMatchNeedsReportRetry,
  confirmedMatchSupportsBackgroundDelivery,
  confirmMatchLocalFirst,
  deliverConfirmedMatchInBackground,
  selectConfirmedMatchReportRetries
} from "../src/main/services/localFirstMatchConfirmation.js";

type SavedMatch = {
  id: string;
  platform: "atlas" | "tcga" | "sim";
  source?: "capture" | "manual" | "scorepad";
  durable: boolean;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("local-first match confirmation", () => {
  it("does not respond or queue automatic delivery until the durable local save completes", async () => {
    const localSave = deferred<SavedMatch>();
    const queueBackgroundDelivery = vi.fn();
    const confirmation = confirmMatchLocalFirst(
      { id: "atlas-1" },
      {
        saveLocally: () => localSave.promise,
        shouldDeliverInBackground: confirmedMatchSupportsBackgroundDelivery,
        queueBackgroundDelivery,
        deliverBeforeResponse: vi.fn()
      }
    );
    let responded = false;
    void confirmation.then(() => {
      responded = true;
    });

    await Promise.resolve();
    expect(responded).toBe(false);
    expect(queueBackgroundDelivery).not.toHaveBeenCalled();

    const saved: SavedMatch = { id: "atlas-1", platform: "atlas", source: "capture", durable: true };
    localSave.resolve(saved);

    await expect(confirmation).resolves.toBe(saved);
    expect(queueBackgroundDelivery).toHaveBeenCalledOnce();
    expect(queueBackgroundDelivery).toHaveBeenCalledWith(saved);
  });

  it("returns a durable Atlas save without waiting for queued replay finalization or network delivery", async () => {
    const remoteDelivery = deferred<void>();
    const saved: SavedMatch = { id: "atlas-2", platform: "atlas", source: "capture", durable: true };
    const deliverBeforeResponse = vi.fn();
    const queueBackgroundDelivery = vi.fn(() => {
      void remoteDelivery.promise;
    });

    await expect(confirmMatchLocalFirst(
      { id: "atlas-2" },
      {
        saveLocally: async () => saved,
        shouldDeliverInBackground: confirmedMatchSupportsBackgroundDelivery,
        queueBackgroundDelivery,
        deliverBeforeResponse
      }
    )).resolves.toBe(saved);
    expect(queueBackgroundDelivery).toHaveBeenCalledWith(saved);
    expect(deliverBeforeResponse).not.toHaveBeenCalled();
  });

  it("preserves synchronous delivery for providers that have not opted in", async () => {
    const saved: SavedMatch = { id: "sim-1", platform: "sim", durable: true };
    const delivered = { ...saved, id: "sim-1-synced" };
    const queueBackgroundDelivery = vi.fn();
    const deliverBeforeResponse = vi.fn(async () => delivered);

    await expect(confirmMatchLocalFirst(
      { id: "sim-1" },
      {
        saveLocally: async () => saved,
        shouldDeliverInBackground: confirmedMatchSupportsBackgroundDelivery,
        queueBackgroundDelivery,
        deliverBeforeResponse
      }
    )).resolves.toBe(delivered);
    expect(deliverBeforeResponse).toHaveBeenCalledWith(saved);
    expect(queueBackgroundDelivery).not.toHaveBeenCalled();
  });

  it("keeps manual and Scorepad Atlas entries out of automatic background delivery", () => {
    expect(confirmedMatchSupportsBackgroundDelivery({ platform: "atlas", source: "capture" })).toBe(true);
    expect(confirmedMatchSupportsBackgroundDelivery({ platform: "tcga", source: "capture" })).toBe(true);
    expect(confirmedMatchSupportsBackgroundDelivery({ platform: "atlas", source: "manual" })).toBe(false);
    expect(confirmedMatchSupportsBackgroundDelivery({ platform: "atlas", source: "scorepad" })).toBe(false);
    expect(confirmedMatchSupportsBackgroundDelivery({ platform: "sim", source: "capture" })).toBe(false);
  });

  it("retries pending and failed reports for saved automatic Atlas and TCGA matches", () => {
    const candidate = (platform: string, community: string, source = "capture", index = 0) => ({
      id: `${platform}-${index}`,
      platform,
      source,
      status: "saved",
      capturedAt: new Date(Date.UTC(2026, 6, index + 1)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 6, index + 1, 1)).toISOString(),
      sync: { community, hubs: {}, teams: {} }
    });

    expect(confirmedMatchNeedsReportRetry(candidate("atlas", "pending"))).toBe(true);
    expect(confirmedMatchNeedsReportRetry(candidate("tcga", "failed"))).toBe(true);
    expect(confirmedMatchNeedsReportRetry({
      ...candidate("atlas", "synced"),
      sync: { community: "synced", hubs: { teamuk: "failed" }, teams: {} }
    })).toBe(true);
    expect(confirmedMatchNeedsReportRetry(candidate("atlas", "synced"))).toBe(false);
    expect(confirmedMatchNeedsReportRetry(candidate("atlas", "pending", "scorepad"))).toBe(false);
    expect(confirmedMatchNeedsReportRetry({ ...candidate("atlas", "pending"), status: "pending-review" })).toBe(false);
  });

  it("bounds report retries while reserving capacity for new and least-recently-attempted matches", () => {
    const candidates = Array.from({ length: 20 }, (_, index) => ({
      id: `match-${index + 1}`,
      platform: index % 2 ? "tcga" : "atlas",
      source: "capture",
      status: "saved",
      capturedAt: new Date(Date.UTC(2026, 6, index + 1)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 5, index + 1)).toISOString(),
      sync: { community: "failed", hubs: {}, teams: {} }
    }));

    const selected = selectConfirmedMatchReportRetries(candidates, 10).matches.map((match) => match.id);

    expect(selected).toHaveLength(10);
    expect(selected.slice(0, 5)).toEqual([
      "match-20",
      "match-19",
      "match-18",
      "match-17",
      "match-16"
    ]);
    expect(selected.slice(5)).toEqual([
      "match-1",
      "match-2",
      "match-3",
      "match-4",
      "match-5"
    ]);

    const attempted = new Set(selected.slice(5));
    const afterAttempt = candidates.map((match) => (
      attempted.has(match.id)
        ? { ...match, updatedAt: "2026-09-01T00:00:00.000Z" }
        : match
    ));
    expect(selectConfirmedMatchReportRetries(afterAttempt, 10).matches.slice(5).map((match) => match.id)).toEqual([
      "match-6",
      "match-7",
      "match-8",
      "match-9",
      "match-10"
    ]);
  });

  it("waits for replay finalization before loading and syncing the latest match", async () => {
    const finalization = deferred<"sync-required" | "sync-complete">();
    const saved: SavedMatch = { id: "atlas-order", platform: "atlas", source: "capture", durable: true };
    const latest = { ...saved, id: "atlas-order-latest" };
    const calls: string[] = [];
    const delivery = deliverConfirmedMatchInBackground(saved, {
      finalizeReplay: async () => {
        calls.push("finalize:start");
        const result = await finalization.promise;
        calls.push("finalize:end");
        return result;
      },
      loadLatest: async () => {
        calls.push("load");
        return latest;
      },
      syncMatch: async (match) => {
        calls.push(`sync:${match.id}`);
      }
    });

    await Promise.resolve();
    expect(calls).toEqual(["finalize:start"]);
    finalization.resolve("sync-required");
    await delivery;
    expect(calls).toEqual(["finalize:start", "finalize:end", "load", "sync:atlas-order-latest"]);
  });

  it("does not duplicate match sync when replay publication already completed it", async () => {
    const loadLatest = vi.fn(async (saved: SavedMatch) => saved);
    const syncMatch = vi.fn(async () => undefined);
    await deliverConfirmedMatchInBackground(
      { id: "tcga-published", platform: "tcga", source: "capture", durable: true },
      {
        finalizeReplay: async () => "sync-complete",
        loadLatest,
        syncMatch
      }
    );
    expect(loadLatest).not.toHaveBeenCalled();
    expect(syncMatch).not.toHaveBeenCalled();
  });
});
