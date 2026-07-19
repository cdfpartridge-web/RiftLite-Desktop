import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getVersion: () => "0.9.0-test" }
}));

import { FirebaseSyncService } from "../src/main/services/firebaseSync";
import type { RiftLiteStore } from "../src/main/services/store";
import type { CommunityMatch, UserSettings } from "../src/shared/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function settings(): UserSettings {
  return {
    accountUid: "account-1",
    firebaseUid: "account-1",
    username: "Player",
    accountHandle: "player",
    accountDisplayName: "Player One"
  } as UserSettings;
}

function communityMatch(id: string): CommunityMatch {
  return {
    id,
    uid: "another-account",
    username: "Opponent",
    date: "2026-07-19T12:00:00.000Z",
    result: "Win",
    myChampion: "Ahri",
    opponentChampion: "Jinx",
    opponentName: "Opponent",
    format: "Bo1",
    score: "1-0",
    wentFirst: "Yes",
    myBattlefield: "",
    opponentBattlefield: "",
    flags: "",
    gamesJson: "[]",
    deckName: "",
    deckSourceUrl: "",
    deckSourceKey: "",
    deckSnapshotJson: "",
    createdAt: 1,
    manualRepair: false,
    combinedFromMatchIds: [],
    mergedIntoMatchId: "",
    superseded: false,
    supersededAt: "",
    scope: "community"
  };
}

function harness() {
  const store = {
    getSettings: vi.fn(async () => settings())
  } as unknown as RiftLiteStore;
  return new FirebaseSyncService(store, () => null);
}

describe("FirebaseSyncService community match request cache", () => {
  it("coalesces overlapping raw Firestore fallback loads", async () => {
    const service = harness();
    const query = deferred<Record<string, unknown>[]>();
    const firestoreRunQuery = vi.fn(() => query.promise);
    Object.assign(service, {
      getCommunityMatchesFromWebsite: vi.fn(async () => null),
      getCanonicalOrAnonymousAuth: vi.fn(async () => ({
        uid: "account-1",
        idToken: "token",
        refreshToken: "refresh",
        expiresAt: Number.MAX_SAFE_INTEGER
      })),
      firestoreRunQuery
    });

    const first = service.getCommunityMatches();
    const second = service.getCommunityMatches();
    await vi.waitFor(() => expect(firestoreRunQuery).toHaveBeenCalledTimes(1));
    query.resolve([]);

    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
    expect(firestoreRunQuery).toHaveBeenCalledTimes(1);
  });

  it("reuses a recent success but lets an explicit refresh bypass the cache", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
    try {
      const service = harness();
      const getCommunityMatchesFromWebsite = vi.fn(async (forceRefresh: boolean) => [
        communityMatch(forceRefresh ? "forced" : "cached")
      ]);
      Object.assign(service, { getCommunityMatchesFromWebsite });

      await expect(service.getCommunityMatches()).resolves.toMatchObject([{ id: "cached" }]);
      await expect(service.getCommunityMatches()).resolves.toMatchObject([{ id: "cached" }]);
      expect(getCommunityMatchesFromWebsite).toHaveBeenCalledTimes(1);

      await expect(service.getCommunityMatches(true)).resolves.toMatchObject([{ id: "forced" }]);
      await expect(service.getCommunityMatches()).resolves.toMatchObject([{ id: "forced" }]);
      expect(getCommunityMatchesFromWebsite).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(30_001);
      await service.getCommunityMatches();
      expect(getCommunityMatchesFromWebsite).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("queues a forced refresh behind a normal load instead of overlapping it", async () => {
    const service = harness();
    const normal = deferred<CommunityMatch[] | null>();
    const forced = deferred<CommunityMatch[] | null>();
    const getCommunityMatchesFromWebsite = vi.fn((forceRefresh: boolean) => forceRefresh ? forced.promise : normal.promise);
    Object.assign(service, { getCommunityMatchesFromWebsite });

    const normalRequest = service.getCommunityMatches();
    const forcedRequest = service.getCommunityMatches(true);
    await vi.waitFor(() => expect(getCommunityMatchesFromWebsite).toHaveBeenCalledTimes(1));
    expect(getCommunityMatchesFromWebsite).toHaveBeenLastCalledWith(false);

    normal.resolve([communityMatch("normal")]);
    await expect(normalRequest).resolves.toMatchObject([{ id: "normal" }]);
    await vi.waitFor(() => expect(getCommunityMatchesFromWebsite).toHaveBeenCalledTimes(2));
    expect(getCommunityMatchesFromWebsite).toHaveBeenLastCalledWith(true);

    forced.resolve([communityMatch("forced")]);
    await expect(forcedRequest).resolves.toMatchObject([{ id: "forced" }]);
  });
});
