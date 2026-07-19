export const ACTIVE_VIEWS = [
  "home",
  "play",
  "scorepad",
  "matches",
  "stats",
  "matchup-lab",
  "spotlight",
  "community",
  "social",
  "hubs",
  "decks",
  "replays",
  "web-replay",
  "stream",
  "account",
  "settings"
] as const;

export type ActiveView = typeof ACTIVE_VIEWS[number];
export type DeckFocusTarget = "library" | "prep" | "notebook" | "performance";
export type CommunityTab = "legend-meta" | "match-matrix" | "recent-matches" | "community-decks";
export type NavigationDisclosureId = "review" | "prepare" | "community";

export interface NavigationTarget {
  readonly view: ActiveView;
  readonly deckFocus?: DeckFocusTarget;
  readonly communityTab?: CommunityTab;
}

export interface NavigationItem {
  readonly id: string;
  readonly label: string;
  readonly target: NavigationTarget;
}

export interface NavigationDisclosure {
  readonly kind: "disclosure";
  readonly id: NavigationDisclosureId;
  readonly label: string;
  readonly defaultTarget: NavigationTarget;
  readonly children: readonly NavigationItem[];
}

export type PrimaryNavigationEntry =
  | (NavigationItem & { readonly kind: "route" })
  | NavigationDisclosure;

export const REVIEW_NAVIGATION_ITEMS = [
  { id: "match-history", label: "Matches", target: { view: "matches" } },
  { id: "local-replays", label: "Replays", target: { view: "replays" } },
  { id: "web-replays", label: "RiftLite web replay", target: { view: "web-replay" } },
  { id: "my-stats", label: "Stats", target: { view: "stats" } }
] as const satisfies readonly NavigationItem[];

export const PREPARE_NAVIGATION_ITEMS = [
  { id: "deck-library", label: "Deck Library", target: { view: "decks", deckFocus: "library" } },
  { id: "matchup-prep", label: "Matchup Prep", target: { view: "decks", deckFocus: "prep" } },
  { id: "matchup-lab", label: "Matchup Lab", target: { view: "matchup-lab" } }
] as const satisfies readonly NavigationItem[];

export const COMMUNITY_NAVIGATION_ITEMS = [
  { id: "community-decks", label: "Community Decks", target: { view: "community", communityTab: "community-decks" } },
  { id: "meta-matrix", label: "Meta & Matrix", target: { view: "community", communityTab: "legend-meta" } },
  { id: "spotlight", label: "Spotlight", target: { view: "spotlight" } },
  { id: "find-match-teams", label: "Find Match & Teams", target: { view: "social" } },
  { id: "private-hubs", label: "Private Hubs", target: { view: "hubs" } },
  { id: "scorepad", label: "Scorepad", target: { view: "scorepad" } }
] as const satisfies readonly NavigationItem[];

export const NAVIGATION_DISCLOSURES = {
  review: {
    kind: "disclosure",
    id: "review",
    label: "Review",
    defaultTarget: { view: "matches" },
    children: REVIEW_NAVIGATION_ITEMS
  },
  prepare: {
    kind: "disclosure",
    id: "prepare",
    label: "Prepare",
    defaultTarget: { view: "decks", deckFocus: "library" },
    children: PREPARE_NAVIGATION_ITEMS
  },
  community: {
    kind: "disclosure",
    id: "community",
    label: "Community",
    defaultTarget: { view: "community", communityTab: "legend-meta" },
    children: COMMUNITY_NAVIGATION_ITEMS
  }
} as const satisfies Record<NavigationDisclosureId, NavigationDisclosure>;

export const PRIMARY_NAVIGATION = [
  { kind: "route", id: "home", label: "Home", target: { view: "home" } },
  { kind: "route", id: "play", label: "Play", target: { view: "play" } },
  NAVIGATION_DISCLOSURES.review,
  NAVIGATION_DISCLOSURES.prepare,
  NAVIGATION_DISCLOSURES.community
] as const satisfies readonly PrimaryNavigationEntry[];

export const UTILITY_NAVIGATION_ITEMS = [
  { id: "overlay", label: "Overlay", target: { view: "stream" } },
  { id: "account-integrations", label: "Account & integrations", target: { view: "account" } },
  { id: "settings", label: "Settings", target: { view: "settings" } }
] as const satisfies readonly NavigationItem[];

export interface NavigationContext {
  readonly view: ActiveView;
  readonly deckFocus?: DeckFocusTarget;
  readonly communityTab?: CommunityTab;
}

export type NavigationOwner =
  | { readonly kind: "primary"; readonly itemId: "home" | "play" }
  | { readonly kind: "disclosure"; readonly disclosureId: NavigationDisclosureId; readonly itemId: string }
  | { readonly kind: "utility"; readonly itemId: "overlay" | "account-integrations" | "settings" };

export function navigationOwner(context: NavigationContext): NavigationOwner {
  switch (context.view) {
    case "home":
      return { kind: "primary", itemId: "home" };
    case "play":
      return { kind: "primary", itemId: "play" };
    case "matches":
      return disclosureOwner("review", "match-history");
    case "replays":
      return disclosureOwner("review", "local-replays");
    case "web-replay":
      return disclosureOwner("review", "web-replays");
    case "stats":
      return disclosureOwner("review", "my-stats");
    case "decks":
      return disclosureOwner("prepare", context.deckFocus === "prep" ? "matchup-prep" : "deck-library");
    case "matchup-lab":
      return disclosureOwner("prepare", "matchup-lab");
    case "community":
      return disclosureOwner("community", context.communityTab === "community-decks" ? "community-decks" : "meta-matrix");
    case "spotlight":
      return disclosureOwner("community", "spotlight");
    case "social":
      return disclosureOwner("community", "find-match-teams");
    case "hubs":
      return disclosureOwner("community", "private-hubs");
    case "scorepad":
      return disclosureOwner("community", "scorepad");
    case "stream":
      return { kind: "utility", itemId: "overlay" };
    case "account":
      return { kind: "utility", itemId: "account-integrations" };
    case "settings":
      return { kind: "utility", itemId: "settings" };
  }
}

export function owningNavigationDisclosure(context: NavigationContext): NavigationDisclosure | null {
  const owner = navigationOwner(context);
  return owner.kind === "disclosure" ? NAVIGATION_DISCLOSURES[owner.disclosureId] : null;
}

export function allNavigationItems(): readonly NavigationItem[] {
  const primaryRoutes: NavigationItem[] = [];
  for (const entry of PRIMARY_NAVIGATION) {
    if (entry.kind === "route") {
      primaryRoutes.push(entry);
    }
  }
  return [
    ...primaryRoutes,
    ...NAVIGATION_DISCLOSURES.review.children,
    ...NAVIGATION_DISCLOSURES.prepare.children,
    ...NAVIGATION_DISCLOSURES.community.children,
    ...UTILITY_NAVIGATION_ITEMS
  ];
}

function disclosureOwner(disclosureId: NavigationDisclosureId, itemId: string): NavigationOwner {
  return { kind: "disclosure", disclosureId, itemId };
}
