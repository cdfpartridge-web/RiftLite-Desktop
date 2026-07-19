import { describe, expect, it, vi } from "vitest";

import {
  invalidateAccountRestoreCommunityCaches,
  loadAccountRestoreLocalData,
  type AccountRestoreRefreshApi
} from "../src/renderer/accountRestoreRefresh";
import type {
  DeckNotebook,
  DeckTrackerState,
  MatchDraft,
  ReplayRecord,
  SavedDeck,
  UserSettings
} from "../src/shared/types";

function restoreApi(activeDeckId = "deck-1") {
  const settings = { activeDeckId } as UserSettings;
  const matches = [{ id: "match-1" }] as MatchDraft[];
  const deletedMatches = [{ id: "deleted-match" }] as MatchDraft[];
  const replays = [{ id: "replay-1" }] as ReplayRecord[];
  const deletedReplays = [{ id: "deleted-replay" }] as ReplayRecord[];
  const decks = [{ id: "deck-1", title: "Restored deck" }] as SavedDeck[];
  const notebook = { deckId: "deck-1" } as DeckNotebook;
  const tracker = { deckId: "deck-1" } as DeckTrackerState;
  const api = {
    getSettings: vi.fn(async () => settings),
    getMatches: vi.fn(async () => matches),
    getDeletedMatches: vi.fn(async () => deletedMatches),
    getReplays: vi.fn(async () => replays),
    getDeletedReplays: vi.fn(async () => deletedReplays),
    getDecks: vi.fn(async () => decks),
    getDeckNotebook: vi.fn(async () => notebook),
    getDeckTrackerState: vi.fn(async () => tracker)
  } satisfies AccountRestoreRefreshApi;
  return { api, settings, matches, deletedMatches, replays, deletedReplays, decks, notebook, tracker };
}

describe("account restore renderer refresh", () => {
  it("invalidates account-scoped community caches after restored settings land", () => {
    const communityLoadedRef = { current: true };
    const communityMatchesLoadedForTrackerRef = { current: true };
    const clearHubMatches = vi.fn();
    const clearTeamMatches = vi.fn();

    invalidateAccountRestoreCommunityCaches({
      communityLoadedRef,
      communityMatchesLoadedForTrackerRef,
      clearHubMatches,
      clearTeamMatches
    });

    expect(communityLoadedRef.current).toBe(false);
    expect(communityMatchesLoadedForTrackerRef.current).toBe(false);
    expect(clearHubMatches).toHaveBeenCalledOnce();
    expect(clearTeamMatches).toHaveBeenCalledOnce();
  });

  it("reloads all restored collections plus active-deck prep and tracker state", async () => {
    const values = restoreApi();

    await expect(loadAccountRestoreLocalData(values.api)).resolves.toEqual({
      settings: values.settings,
      matches: values.matches,
      deletedMatches: values.deletedMatches,
      replays: values.replays,
      deletedReplays: values.deletedReplays,
      decks: values.decks,
      activeDeckNotebook: values.notebook,
      deckTrackerState: values.tracker
    });
    expect(values.api.getDeckNotebook).toHaveBeenCalledWith("deck-1");
    expect(values.api.getDeckTrackerState).toHaveBeenCalledOnce();
  });

  it("does not read prep for a stale restored active-deck id", async () => {
    const values = restoreApi("missing-deck");

    const result = await loadAccountRestoreLocalData(values.api);

    expect(result.activeDeckNotebook).toBeNull();
    expect(values.api.getDeckNotebook).not.toHaveBeenCalled();
    expect(result.matches).toBe(values.matches);
    expect(result.decks).toBe(values.decks);
  });

  it("keeps core restored data visible when optional prep helpers fail", async () => {
    const values = restoreApi();
    values.api.getDeckNotebook.mockRejectedValueOnce(new Error("notebook unavailable"));
    values.api.getDeckTrackerState.mockRejectedValueOnce(new Error("tracker unavailable"));

    const result = await loadAccountRestoreLocalData(values.api);

    expect(result.activeDeckNotebook).toBeNull();
    expect(result.deckTrackerState).toBeNull();
    expect(result.matches).toBe(values.matches);
    expect(result.decks).toBe(values.decks);
  });
});
