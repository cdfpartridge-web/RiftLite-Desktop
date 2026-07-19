import type {
  DeckNotebook,
  DeckTrackerState,
  MatchDraft,
  ReplayRecord,
  RiftLiteApi,
  SavedDeck,
  UserSettings
} from "../shared/types";

export type AccountRestoreRefreshApi = Pick<
  RiftLiteApi,
  | "getSettings"
  | "getMatches"
  | "getDeletedMatches"
  | "getReplays"
  | "getDeletedReplays"
  | "getDecks"
  | "getDeckNotebook"
  | "getDeckTrackerState"
>;

export interface AccountRestoreLocalData {
  settings: UserSettings;
  matches: MatchDraft[];
  deletedMatches: MatchDraft[];
  replays: ReplayRecord[];
  deletedReplays: ReplayRecord[];
  decks: SavedDeck[];
  activeDeckNotebook: DeckNotebook | null;
  deckTrackerState: DeckTrackerState | null;
}

export interface AccountRestoreCommunityCaches {
  communityLoadedRef: { current: boolean };
  communityMatchesLoadedForTrackerRef: { current: boolean };
  clearHubMatches: () => void;
  clearTeamMatches: () => void;
}

export function invalidateAccountRestoreCommunityCaches(
  caches: AccountRestoreCommunityCaches
): void {
  caches.communityLoadedRef.current = false;
  caches.communityMatchesLoadedForTrackerRef.current = false;
  caches.clearHubMatches();
  caches.clearTeamMatches();
}

/**
 * Reloads every renderer-owned collection that an account backup can replace.
 * Optional active-deck helpers are isolated so a stale notebook or tracker
 * response cannot hide a successfully restored match/deck library.
 */
export async function loadAccountRestoreLocalData(
  api: AccountRestoreRefreshApi,
  options: { includeDeckTracker?: boolean } = {}
): Promise<AccountRestoreLocalData> {
  const [settings, matches, deletedMatches, replays, deletedReplays, decks] = await Promise.all([
    api.getSettings(),
    api.getMatches(),
    api.getDeletedMatches(),
    api.getReplays(),
    api.getDeletedReplays(),
    api.getDecks()
  ]);
  const activeDeckId = settings.activeDeckId.trim();
  const activeDeckExists = Boolean(activeDeckId && decks.some((deck) => deck.id === activeDeckId));
  const [activeDeckNotebook, deckTrackerState] = await Promise.all([
    activeDeckExists
      ? api.getDeckNotebook(activeDeckId).catch(() => null)
      : Promise.resolve(null),
    options.includeDeckTracker === false
      ? Promise.resolve(null)
      : api.getDeckTrackerState().catch(() => null)
  ]);

  return {
    settings,
    matches,
    deletedMatches,
    replays,
    deletedReplays,
    decks,
    activeDeckNotebook,
    deckTrackerState
  };
}
