import { describe, expect, it } from "vitest";

import {
  ACTIVE_VIEWS,
  COMMUNITY_NAVIGATION_ITEMS,
  NAVIGATION_DISCLOSURES,
  PREPARE_NAVIGATION_ITEMS,
  PRIMARY_NAVIGATION,
  REVIEW_NAVIGATION_ITEMS,
  UTILITY_NAVIGATION_ITEMS,
  allNavigationItems,
  navigationOwner,
  owningNavigationDisclosure,
  type NavigationContext
} from "../src/shared/navigationModel.js";

describe("desktop navigation model", () => {
  it("makes every existing ActiveView reachable", () => {
    const reachableViews = new Set(allNavigationItems().map((item) => item.target.view));

    expect([...reachableViews].sort()).toEqual([...ACTIVE_VIEWS].sort());
    for (const view of ACTIVE_VIEWS) {
      expect(reachableViews.has(view), `${view} should be reachable`).toBe(true);
    }
  });

  it("defines Home and Play followed by the three approved disclosures", () => {
    expect(PRIMARY_NAVIGATION.map((entry) => [entry.kind, entry.id, entry.label])).toEqual([
      ["route", "home", "Home"],
      ["route", "play", "Play"],
      ["disclosure", "review", "Review"],
      ["disclosure", "prepare", "Prepare"],
      ["disclosure", "community", "Community"]
    ]);
  });

  it("keeps the approved Review children and targets", () => {
    expect(REVIEW_NAVIGATION_ITEMS).toEqual([
      { id: "match-history", label: "Matches", target: { view: "matches" } },
      { id: "local-replays", label: "Replays", target: { view: "replays" } },
      { id: "web-replays", label: "RiftLite web replay", target: { view: "web-replay" } },
      { id: "my-stats", label: "Stats", target: { view: "stats" } }
    ]);
  });

  it("keeps the approved Prepare children and deck focus targets", () => {
    expect(PREPARE_NAVIGATION_ITEMS).toEqual([
      { id: "deck-library", label: "Deck Library", target: { view: "decks", deckFocus: "library" } },
      { id: "matchup-prep", label: "Matchup Prep", target: { view: "decks", deckFocus: "prep" } },
      { id: "matchup-lab", label: "Matchup Lab", target: { view: "matchup-lab" } }
    ]);
  });

  it("keeps the approved Community children with Scorepad last", () => {
    expect(COMMUNITY_NAVIGATION_ITEMS).toEqual([
      { id: "community-decks", label: "Community Decks", target: { view: "community", communityTab: "community-decks" } },
      { id: "meta-matrix", label: "Meta & Matrix", target: { view: "community", communityTab: "legend-meta" } },
      { id: "spotlight", label: "Spotlight", target: { view: "spotlight" } },
      { id: "find-match-teams", label: "Find Match & Teams", target: { view: "social" } },
      { id: "private-hubs", label: "Private Hubs", target: { view: "hubs" } },
      { id: "scorepad", label: "Scorepad", target: { view: "scorepad" } }
    ]);
  });

  it("places Scorepad only inside Community", () => {
    const scorepadPlacements = [
      ...PRIMARY_NAVIGATION.flatMap((entry) => entry.kind === "route"
        ? [{ area: "primary", parent: entry.id, item: entry }]
        : entry.children.map((item) => ({ area: "disclosure", parent: entry.id, item }))),
      ...UTILITY_NAVIGATION_ITEMS.map((item) => ({ area: "utility", parent: "utilities", item }))
    ].filter(({ item }) => item.target.view === "scorepad");

    expect(scorepadPlacements.map(({ area, parent, item }) => ({ area, parent, itemId: item.id }))).toEqual([
      { area: "disclosure", parent: "community", itemId: "scorepad" }
    ]);
  });

  it("keeps Overlay, Account and Settings as utilities", () => {
    expect(UTILITY_NAVIGATION_ITEMS).toEqual([
      { id: "overlay", label: "Overlay", target: { view: "stream" } },
      { id: "account-integrations", label: "Account & integrations", target: { view: "account" } },
      { id: "settings", label: "Settings", target: { view: "settings" } }
    ]);
  });

  it.each([
    [{ view: "matches" }, "review", "match-history"],
    [{ view: "replays" }, "review", "local-replays"],
    [{ view: "web-replay" }, "review", "web-replays"],
    [{ view: "stats" }, "review", "my-stats"],
    [{ view: "decks", deckFocus: "library" }, "prepare", "deck-library"],
    [{ view: "decks", deckFocus: "prep" }, "prepare", "matchup-prep"],
    [{ view: "decks", deckFocus: "notebook" }, "prepare", "deck-library"],
    [{ view: "decks", deckFocus: "performance" }, "prepare", "deck-library"],
    [{ view: "matchup-lab" }, "prepare", "matchup-lab"],
    [{ view: "community", communityTab: "community-decks" }, "community", "community-decks"],
    [{ view: "community", communityTab: "legend-meta" }, "community", "meta-matrix"],
    [{ view: "community", communityTab: "match-matrix" }, "community", "meta-matrix"],
    [{ view: "community", communityTab: "recent-matches" }, "community", "meta-matrix"],
    [{ view: "spotlight" }, "community", "spotlight"],
    [{ view: "social" }, "community", "find-match-teams"],
    [{ view: "hubs" }, "community", "private-hubs"],
    [{ view: "scorepad" }, "community", "scorepad"]
  ] satisfies ReadonlyArray<readonly [NavigationContext, string, string]>) (
    "resolves $0 to the owning $1 disclosure",
    (context, disclosureId, itemId) => {
      expect(navigationOwner(context)).toEqual({ kind: "disclosure", disclosureId, itemId });
      expect(owningNavigationDisclosure(context)?.id).toBe(disclosureId);
    }
  );

  it("does not assign primary routes or utilities to a disclosure", () => {
    for (const view of ["home", "play", "stream", "account", "settings"] as const) {
      expect(owningNavigationDisclosure({ view })).toBeNull();
    }
  });

  it("uses the audited defaults for disclosures", () => {
    expect(NAVIGATION_DISCLOSURES.review.defaultTarget).toEqual({ view: "matches" });
    expect(NAVIGATION_DISCLOSURES.prepare.defaultTarget).toEqual({ view: "decks", deckFocus: "library" });
    expect(NAVIGATION_DISCLOSURES.community.defaultTarget).toEqual({ view: "community", communityTab: "legend-meta" });
  });
});
