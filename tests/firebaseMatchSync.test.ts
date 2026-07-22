import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getVersion: () => "0.9.10-test" }
}));

import { FirebaseSyncService } from "../src/main/services/firebaseSync";
import type { RiftLiteStore } from "../src/main/services/store";
import { restoreCombinedOriginal } from "../src/shared/matchCombine";
import type { MatchDraft, UserSettings } from "../src/shared/types";

function settings(): UserSettings {
  return {
    username: "Sync player",
    communitySyncEnabled: true,
    syncMode: "community-and-hubs",
    accountUid: "account-1",
    firebaseUid: "account-1",
    firebaseRefreshToken: "refresh-1",
    activeHubs: [],
    activeTeams: [],
    rawCapture: {
      enabled: false,
      webReplayAutoUploadEnabled: false,
      webReplayAutoUploadAccountUid: "",
      tcgaWebReplayAutoUploadEnabled: false,
      tcgaWebReplayAutoUploadAccountUid: "",
      webReplayDiscordShareEnabled: false,
      webReplayDiscordShareAccountUid: "",
      webReplayDiscordShareHubIds: [],
      uploadEnabled: false,
      endpoint: "https://riftreplay.com/api/v1/replays",
      apiKey: "",
      visibility: "private"
    }
  } as UserSettings;
}

function match(): MatchDraft {
  return {
    id: "local-match-1",
    platform: "atlas",
    status: "saved",
    capturedAt: "2026-07-21T12:00:00.000Z",
    updatedAt: "2026-07-21T12:01:00.000Z",
    result: "Win",
    format: "Bo1",
    score: "1-0",
    myName: "Sync player",
    opponentName: "Opponent",
    myChampion: "Akali",
    opponentChampion: "Kennen",
    myBattlefield: "The Arena's Greatest",
    opponentBattlefield: "Sacred Springs",
    deckName: "",
    deckSourceId: "",
    flags: "",
    notes: "original note",
    games: [],
    rawEvidence: [],
    sync: { community: "pending", hubs: {}, teams: {} }
  };
}

function harness() {
  let active = [match()];
  let deleted: MatchDraft[] = [];
  let beforeConditionalSave: (() => void) | null = null;
  const currentSettings = settings();
  const store = {
    getSettings: vi.fn(async () => currentSettings),
    getMatches: vi.fn(async () => active),
    getDeletedMatches: vi.fn(async () => deleted),
    getReplays: vi.fn(async () => []),
    saveMatch: vi.fn(async (next: MatchDraft) => {
      active = [next];
      return next;
    }),
    saveMatchIf: vi.fn(async (next: MatchDraft, guard: () => boolean) => {
      if (!guard()) return null;
      const beforeSave = beforeConditionalSave;
      beforeConditionalSave = null;
      beforeSave?.();
      const current = active.find((candidate) => candidate.id === next.id && !candidate.deletedAt);
      if (!current) return null;
      const merged: MatchDraft = {
        ...current,
        sync: {
          community: current.sync.community === "disabled" ? "disabled" : next.sync.community,
          hubs: Object.fromEntries(Object.entries(current.sync.hubs).map(([hubId, state]) => [
            hubId,
            Object.prototype.hasOwnProperty.call(next.sync.hubs, hubId) ? next.sync.hubs[hubId] : state
          ])),
          teams: Object.fromEntries(Object.entries(current.sync.teams ?? {}).map(([teamId, state]) => [
            teamId,
            Object.prototype.hasOwnProperty.call(next.sync.teams ?? {}, teamId) ? next.sync.teams?.[teamId] ?? state : state
          ]))
        }
      };
      active = active.map((candidate) => candidate.id === merged.id ? merged : candidate);
      return merged;
    })
  } as unknown as RiftLiteStore;
  const service = new FirebaseSyncService(store, () => null);
  Object.assign(service, {
    auth: {
      uid: "account-1",
      idToken: "id-token-1",
      refreshToken: "refresh-1",
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    }
  });
  return {
    service,
    store,
    getActive: () => active,
    editActive: (patch: Partial<MatchDraft>) => {
      active = [{ ...active[0], ...patch }];
    },
    deleteActive: () => {
      deleted = [{ ...active[0], deletedAt: "2026-07-21T12:02:00.000Z" }];
      active = [];
    },
    deleteOnNextConditionalSave: () => {
      beforeConditionalSave = () => {
        deleted = [{ ...active[0], deletedAt: "2026-07-21T12:03:00.000Z" }];
        active = [];
      };
    },
    settings: currentSettings
  };
}

function combinedMatch(sync: MatchDraft["sync"] = {
  community: "pending",
  hubs: { "hub-1": "pending" },
  teams: { "team-1": "pending" }
}): MatchDraft {
  return {
    ...match(),
    id: "combined-match",
    manualRepair: true,
    combinedFromMatchIds: ["original-match"],
    sync
  };
}

function combinedUndoHarness(combined = combinedMatch(), originalPatch: Partial<MatchDraft> = {}) {
  const currentSettings = settings();
  const original: MatchDraft = {
    ...match(),
    id: "original-match",
    mergedIntoMatchId: combined.id,
    hiddenFromStats: true,
    hiddenFromHistory: true,
    sync: {
      community: "synced",
      hubs: { "hub-1": "synced" },
      teams: { "team-1": "synced" }
    },
    ...originalPatch
  };
  let active = [combined, original];
  const undoCombinedMatch = vi.fn(async (
    combinedMatchId: string,
    guard: (draft: Readonly<MatchDraft>) => boolean
  ) => {
    const current = active.find((candidate) => candidate.id === combinedMatchId);
    if (!current || !guard(current)) throw new Error("undo guard rejected");
    const restored = restoreCombinedOriginal(original, "2026-07-21T13:00:00.000Z");
    active = [restored];
    return [restored];
  });
  const saveMatchIf = vi.fn(async (next: MatchDraft, guard: () => boolean) => {
    if (!guard()) return null;
    const current = active.find((candidate) => candidate.id === next.id && !candidate.deletedAt);
    if (!current) return null;
    const saved = { ...current, sync: next.sync };
    active = active.map((candidate) => candidate.id === saved.id ? saved : candidate);
    return saved;
  });
  const store = {
    getSettings: vi.fn(async () => currentSettings),
    getMatches: vi.fn(async () => active),
    getDeletedMatches: vi.fn(async () => []),
    getReplays: vi.fn(async () => []),
    undoCombinedMatch,
    saveMatchIf
  } as unknown as RiftLiteStore;
  const service = new FirebaseSyncService(store, () => null);
  Object.assign(service, {
    auth: {
      uid: "account-1",
      idToken: "id-token-1",
      refreshToken: "refresh-1",
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    }
  });
  return {
    service,
    store,
    settings: currentSettings,
    undoCombinedMatch,
    saveMatchIf,
    getActive: () => active
  };
}

describe("FirebaseSyncService match synchronization", () => {
  it("serializes concurrent syncs for one match and uploads it once", async () => {
    const { service, getActive } = harness();
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const uploadPublicMatch = vi.fn(async () => {
      await uploadGate;
      return "remote-match";
    });
    Object.assign(service, { uploadPublicMatch });

    const first = service.syncMatch(getActive()[0], { quiet: true });
    await vi.waitFor(() => expect(uploadPublicMatch).toHaveBeenCalledOnce());
    const second = service.syncMatch(getActive()[0], { quiet: true });
    releaseUpload();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(uploadPublicMatch).toHaveBeenCalledOnce();
    expect(firstResult.sync.community).toBe("synced");
    expect(secondResult.sync.community).toBe("synced");
  });

  it("merges sync state into the latest local edit instead of overwriting it", async () => {
    const { service, getActive, editActive } = harness();
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    Object.assign(service, {
      uploadPublicMatch: vi.fn(async () => {
        await uploadGate;
        return "remote-match";
      })
    });

    const pending = service.syncMatch(getActive()[0], { quiet: true });
    await Promise.resolve();
    editActive({ notes: "edited while syncing", opponentName: "Corrected opponent" });
    releaseUpload();

    await expect(pending).resolves.toMatchObject({
      notes: "edited while syncing",
      opponentName: "Corrected opponent",
      sync: { community: "synced" }
    });
  });

  it("does not resurrect a match deleted while its remote upload is running", async () => {
    const { service, store, getActive, deleteActive } = harness();
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const uploadPublicMatch = vi.fn(async () => {
      await uploadGate;
      return "remote-match";
    });
    Object.assign(service, { uploadPublicMatch });

    const pending = service.syncMatch(getActive()[0], { quiet: true });
    await vi.waitFor(() => expect(uploadPublicMatch).toHaveBeenCalledOnce());
    deleteActive();
    releaseUpload();

    await expect(pending).resolves.toMatchObject({ deletedAt: expect.any(String) });
    expect(store.saveMatch).not.toHaveBeenCalled();
  });

  it("does not resurrect a match deleted after the final latest-row read", async () => {
    const { service, store, getActive, deleteOnNextConditionalSave } = harness();
    Object.assign(service, {
      uploadPublicMatch: vi.fn(async () => "remote-match")
    });
    deleteOnNextConditionalSave();

    await expect(service.syncMatch(getActive()[0], { quiet: true })).resolves.toMatchObject({
      deletedAt: expect.any(String)
    });
    expect(store.saveMatchIf).toHaveBeenCalledOnce();
    expect(store.saveMatch).not.toHaveBeenCalled();
  });

  it("uses lifecycle-safe conditional persistence even when no remote identity is needed", async () => {
    const { service, store, getActive, editActive } = harness();
    editActive({ sync: { community: "synced", hubs: {}, teams: {} } });

    await expect(service.syncMatch(getActive()[0], { quiet: true })).resolves.toMatchObject({
      sync: { community: "synced" }
    });
    expect(store.saveMatchIf).toHaveBeenCalledOnce();
    expect(store.saveMatch).not.toHaveBeenCalled();
  });

  it("does not save another account's sync result when the linked account changes mid-upload", async () => {
    const { service, store, getActive, settings: currentSettings } = harness();
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const uploadPublicMatch = vi.fn(async () => {
      await uploadGate;
      return "remote-match-for-account-1";
    });
    Object.assign(service, { uploadPublicMatch });

    const pending = service.syncMatch(getActive()[0], { quiet: true });
    await vi.waitFor(() => expect(uploadPublicMatch).toHaveBeenCalledOnce());

    service.invalidateLinkedAccountAuth();
    Object.assign(currentSettings, {
      accountUid: "account-2",
      firebaseUid: "account-2",
      firebaseRefreshToken: "refresh-2"
    });
    releaseUpload();

    await expect(pending).resolves.toMatchObject({
      id: "local-match-1",
      sync: { community: "pending" }
    });
    expect(store.saveMatch).not.toHaveBeenCalled();
    expect(store.saveMatchIf).not.toHaveBeenCalled();
    expect(uploadPublicMatch.mock.calls[0]?.[2]).toMatchObject({
      uid: "account-1",
      idToken: "id-token-1"
    });
  });

  it("uses the same deterministic Firestore document for concurrent-device retries", async () => {
    const { service, settings: currentSettings } = harness();
    const firestoreRequest = vi.fn(async (path: string) => ({ name: `projects/test/databases/(default)/documents/${path}` }));
    Object.assign(service, {
      findPublicMatchDocId: vi.fn(async () => ""),
      firestoreRequest,
      appendCommunityAggregate: vi.fn(async () => undefined)
    });
    const uploadPublicMatch = (service as unknown as {
      uploadPublicMatch: (draft: MatchDraft, userSettings: UserSettings) => Promise<string>;
    }).uploadPublicMatch.bind(service);

    const [first, second] = await Promise.all([
      uploadPublicMatch(match(), currentSettings),
      uploadPublicMatch(match(), currentSettings)
    ]);

    expect(first).toBe(second);
    expect(first).toMatch(/^riftlite-[a-f0-9]{40}$/);
    expect(firestoreRequest).toHaveBeenCalledTimes(2);
    expect(firestoreRequest.mock.calls.map(([path]) => path)).toEqual([
      `matches/${first}`,
      `matches/${first}`
    ]);
    expect(firestoreRequest.mock.calls.every(([, , options]) => options.method === "PATCH")).toBe(true);
  });

  it("undoes a local-only combine without requiring a remote account", async () => {
    const localCombined = combinedMatch({ community: "disabled", hubs: {}, teams: {} });
    const { service, undoCombinedMatch } = combinedUndoHarness(localCombined, {
      sync: { community: "disabled", hubs: {}, teams: {} }
    });
    const hideCombinedMatchRemotely = vi.fn();
    Object.assign(service, { hideCombinedMatchRemotely });

    await expect(service.undoCombinedMatch(localCombined.id)).resolves.toHaveLength(1);

    expect(hideCombinedMatchRemotely).not.toHaveBeenCalled();
    expect(undoCombinedMatch).toHaveBeenCalledOnce();
  });

  it("aborts local undo when any remote hide step fails", async () => {
    const { service, undoCombinedMatch, getActive } = combinedUndoHarness();
    Object.assign(service, {
      hideCombinedMatchRemotely: vi.fn(async () => {
        throw new Error("Private hub aggregate 503");
      })
    });

    await expect(service.undoCombinedMatch("combined-match")).rejects.toThrow("Private hub aggregate 503");

    expect(undoCombinedMatch).not.toHaveBeenCalled();
    expect(getActive().some((candidate) => candidate.id === "combined-match")).toBe(true);
  });

  it("aborts local undo when the linked account changes during remote hide", async () => {
    const { service, settings: currentSettings, undoCombinedMatch } = combinedUndoHarness();
    Object.assign(service, {
      hideCombinedMatchRemotely: vi.fn(async () => {
        service.invalidateLinkedAccountAuth();
        Object.assign(currentSettings, {
          accountUid: "account-2",
          firebaseUid: "account-2",
          firebaseRefreshToken: "refresh-2"
        });
      })
    });

    await expect(service.undoCombinedMatch("combined-match")).rejects.toThrow(
      "The RiftLite account changed while this match was being reported."
    );
    expect(undoCombinedMatch).not.toHaveBeenCalled();
  });

  it("persists each restored original scope independently after a partial re-upload failure", async () => {
    const { service, saveMatchIf } = combinedUndoHarness();
    Object.assign(service, {
      hideCombinedMatchRemotely: vi.fn(async () => undefined),
      uploadPublicMatch: vi.fn(async () => "public-original"),
      uploadHubMatch: vi.fn(async () => {
        throw new Error("hub unavailable");
      }),
      uploadTeamMatch: vi.fn(async () => "original-match")
    });

    const [restored] = await service.undoCombinedMatch("combined-match");

    expect(restored.sync).toEqual({
      community: "synced",
      hubs: { "hub-1": "failed" },
      teams: { "team-1": "synced" }
    });
    expect(saveMatchIf).toHaveBeenCalledOnce();
  });

  it("retries already-completed hide steps idempotently before committing local undo", async () => {
    const retryCombined = combinedMatch({ community: "pending", hubs: { "hub-1": "pending" }, teams: {} });
    const { service, undoCombinedMatch } = combinedUndoHarness(retryCombined, {
      sync: { community: "disabled", hubs: {}, teams: {} }
    });
    const patchFirestoreDocumentIfPresent = vi.fn(async () => undefined);
    const appendCommunityAggregate = vi.fn(async () => undefined);
    const updatePrivateHubAggregate = vi.fn()
      .mockRejectedValueOnce(new Error("aggregate unavailable"))
      .mockResolvedValue(undefined);
    Object.assign(service, {
      findPublicMatchDocId: vi.fn(async () => "remote-combined"),
      patchFirestoreDocumentIfPresent,
      appendCommunityAggregate,
      updatePrivateHubAggregate
    });

    await expect(service.undoCombinedMatch(retryCombined.id)).rejects.toThrow("aggregate unavailable");
    await expect(service.undoCombinedMatch(retryCombined.id)).resolves.toHaveLength(1);

    expect(appendCommunityAggregate).toHaveBeenCalledTimes(2);
    expect(updatePrivateHubAggregate).toHaveBeenCalledTimes(2);
    expect(patchFirestoreDocumentIfPresent).toHaveBeenCalledTimes(4);
    expect(undoCombinedMatch).toHaveBeenCalledOnce();
  });
});
