import { describe, expect, it } from "vitest";
import {
  buildCommunityDeckMeta,
  communityBattlefieldStatsForLegend,
  communityCardStatsForLegend,
  communityDeckGroupsForLegend
} from "../src/shared/communityDecks";
import type { CommunityMatch, DeckSnapshot } from "../src/shared/types";

function snapshot(patch: Partial<DeckSnapshot> = {}): DeckSnapshot {
  return {
    title: "Diana Tempo",
    legend: "Diana",
    legendKey: "diana",
    sourceUrl: "https://piltoverarchive.com/decks/view/diana",
    sourceKey: "diana-source",
    runes: [{ qty: 6, name: "Mind Rune", cardId: "OGN-001" }],
    battlefields: [
      { qty: 1, name: "Targon's Peak", cardId: "OGN-289" },
      { qty: 1, name: "Star Spring", cardId: "UNL-215" }
    ],
    mainDeck: [
      { qty: 3, name: "Falling Star", cardId: "SFD-001" },
      { qty: 2, name: "Rebuke", cardId: "OGN-172" }
    ],
    sideboard: [{ qty: 2, name: "Hard Bargain", cardId: "SFD-136" }],
    ...patch
  };
}

function communityMatch(patch: Partial<CommunityMatch> = {}): CommunityMatch {
  const id = patch.id ?? `match-${Math.random()}`;
  return {
    id,
    uid: "uid",
    username: "Player",
    date: patch.date ?? "2026-05-01T12:00:00.000Z",
    result: patch.result ?? "Win",
    myChampion: patch.myChampion ?? "Diana",
    opponentChampion: patch.opponentChampion ?? "Vex",
    opponentName: "Opponent",
    format: patch.format ?? "Bo1",
    score: patch.score ?? "1-0",
    wentFirst: patch.wentFirst ?? "1st",
    myBattlefield: patch.myBattlefield ?? "Targon's Peak",
    opponentBattlefield: patch.opponentBattlefield ?? "Sunken Temple",
    flags: "",
    gamesJson: patch.gamesJson ?? JSON.stringify([{ gameNumber: 1, result: patch.result ?? "Win", myPoints: 7, oppPoints: 4, wentFirst: "1st", myBattlefield: "Targon's Peak", oppBattlefield: "Sunken Temple" }]),
    deckName: patch.deckName ?? "Diana Tempo",
    deckSourceUrl: patch.deckSourceUrl ?? "https://piltoverarchive.com/decks/view/diana",
    deckSourceKey: patch.deckSourceKey ?? "diana-source",
    deckSnapshotJson: patch.deckSnapshotJson ?? JSON.stringify(snapshot()),
    createdAt: 1_777_777_777,
    scope: patch.scope ?? "community",
    ...patch
  };
}

describe("community deck analytics", () => {
  it("counts duplicate matches using one deck once for inclusion percentages while match stats stay match weighted", () => {
    const meta = buildCommunityDeckMeta([
      communityMatch({ id: "a", result: "Win" }),
      communityMatch({ id: "b", result: "Loss" })
    ]);

    expect(meta.totalDecks).toBe(1);
    const summary = meta.legends.find((legend) => legend.legend === "Diana");
    expect(summary?.deckCount).toBe(1);
    expect(summary?.matchCount).toBe(2);
    expect(summary?.record).toBe("1-1");

    const fallingStar = communityCardStatsForLegend(meta, "Diana", "mainDeck").find((stat) => stat.name === "Falling Star");
    expect(fallingStar?.deckCount).toBe(1);
    expect(fallingStar?.inclusionRate).toBe(100);
    expect(fallingStar?.total).toBe(2);
    expect(fallingStar?.record).toBe("1-1");
  });

  it("groups by source key before snapshot hash", () => {
    const changedSnapshot = snapshot({
      mainDeck: [{ qty: 3, name: "Different Card", cardId: "SFD-999" }]
    });
    const meta = buildCommunityDeckMeta([
      communityMatch({ id: "a", deckSourceKey: "same-source" }),
      communityMatch({ id: "b", deckSourceKey: "same-source", deckSnapshotJson: JSON.stringify(changedSnapshot) })
    ]);

    expect(meta.totalDecks).toBe(1);
    expect(meta.groups[0]?.matchIds.sort()).toEqual(["a", "b"]);
  });

  it("falls back to snapshot hash when source key is missing", () => {
    const shared = JSON.stringify(snapshot({ sourceKey: "" }));
    const changed = JSON.stringify(snapshot({
      sourceKey: "",
      mainDeck: [{ qty: 3, name: "Different Card", cardId: "SFD-999" }]
    }));
    const meta = buildCommunityDeckMeta([
      communityMatch({ id: "a", deckSourceKey: "", deckSnapshotJson: shared }),
      communityMatch({ id: "b", deckSourceKey: "", deckSnapshotJson: shared }),
      communityMatch({ id: "c", deckSourceKey: "", deckSnapshotJson: changed })
    ]);

    expect(meta.totalDecks).toBe(2);
    expect(communityDeckGroupsForLegend(meta, "Diana").map((group) => group.matchIds.length).sort()).toEqual([1, 2]);
  });

  it("ignores private/team/local style data and survives invalid snapshots", () => {
    const meta = buildCommunityDeckMeta([
      communityMatch({ id: "public-invalid", deckSnapshotJson: "{nope", deckName: "Diana mystery" }),
      communityMatch({ id: "hub", scope: "hub" }),
      communityMatch({ id: "team", scope: "team" })
    ]);

    expect(meta.totalDecks).toBe(1);
    expect(meta.snapshotDecks).toBe(0);
    expect(communityCardStatsForLegend(meta, "Diana", "mainDeck")).toEqual([]);
  });

  it("combines alternate arts by card name and keeps the best available image", () => {
    const first = snapshot({
      mainDeck: [{ qty: 3, name: "Rebuke", cardId: "OGN-172", imageUrl: "https://cdn.piltoverarchive.com/cards/OGN-172.webp" }],
      sourceKey: "one"
    });
    const second = snapshot({ mainDeck: [{ qty: 2, name: "Rebuke", cardId: "ALT-172", imageUrl: "" }], sourceKey: "two" });
    const meta = buildCommunityDeckMeta([
      communityMatch({ id: "a", deckSourceKey: "one", deckSnapshotJson: JSON.stringify(first) }),
      communityMatch({ id: "b", deckSourceKey: "two", deckSnapshotJson: JSON.stringify(second) })
    ]);

    const stats = communityCardStatsForLegend(meta, "Diana", "mainDeck").filter((stat) => stat.name === "Rebuke");
    expect(stats).toHaveLength(1);
    expect(stats[0]?.deckCount).toBe(2);
    expect(stats[0]?.imageUrl).toContain("OGN-172.webp");
    expect(stats[0]?.copyDistribution).toEqual([
      { copies: 3, decks: 1, rate: 50 },
      { copies: 2, decks: 1, rate: 50 }
    ]);
  });

  it("combines rune alternate arts by rune type", () => {
    const first = snapshot({
      sourceKey: "",
      runes: [
        { qty: 4, name: "Chaos Rune", cardId: "OGN-166" },
        { qty: 2, name: "Chaos Rune alternate art", cardId: "ALT-166" }
      ]
    });
    const second = snapshot({
      sourceKey: "",
      runes: [{ qty: 6, name: "Chaos Rune", cardId: "SIGNED-166" }]
    });
    const meta = buildCommunityDeckMeta([
      communityMatch({ id: "a", deckSourceKey: "", deckSnapshotJson: JSON.stringify(first) }),
      communityMatch({ id: "b", deckSourceKey: "", deckSnapshotJson: JSON.stringify(second) })
    ]);

    expect(meta.totalDecks).toBe(1);
    const chaosRunes = communityCardStatsForLegend(meta, "Diana", "runes").filter((stat) => stat.name === "Chaos Rune");
    expect(chaosRunes).toHaveLength(1);
    expect(chaosRunes[0]?.deckCount).toBe(1);
    expect(chaosRunes[0]?.commonCopies).toBe(6);
    expect(chaosRunes[0]?.total).toBe(2);
  });

  it("shows one chosen deck champion card instead of the leader card", () => {
    const dianaSnapshot = snapshot({
      legendEntry: { qty: 1, name: "Diana, Scorn of the Moon", cardId: "OGS-012" },
      mainDeck: [
        { qty: 1, name: "Diana, Scorn of the Moon", cardId: "OGS-012" },
        { qty: 2, name: "Diana, No Longer Human", cardId: "OGN-040" },
        { qty: 1, name: "Diana, Lunari", cardId: "UNL-040" },
        { qty: 2, name: "Vex, Apathetic", cardId: "UNL-150" }
      ]
    });
    const meta = buildCommunityDeckMeta([communityMatch({ id: "a", deckSnapshotJson: JSON.stringify(dianaSnapshot) })]);

    const stats = communityCardStatsForLegend(meta, "Diana", "champions").map((stat) => stat.name);
    expect(stats).toEqual(["Diana, No Longer Human"]);
    expect(stats).not.toContain("Diana, Scorn of the Moon");
    expect(stats).not.toContain("Vex, Apathetic");
  });

  it("normalizes champion choice percentages across detected champion cards", () => {
    const knownChampion = snapshot({
      sourceKey: "known",
      mainDeck: [
        { qty: 1, name: "Diana, Lunari", cardId: "UNL-079" },
        { qty: 3, name: "Falling Star", cardId: "SFD-001" }
      ]
    });
    const missingChampion = snapshot({
      sourceKey: "missing",
      mainDeck: [{ qty: 3, name: "Falling Star", cardId: "SFD-001" }]
    });
    const meta = buildCommunityDeckMeta([
      communityMatch({ id: "a", deckSourceKey: "known", deckSnapshotJson: JSON.stringify(knownChampion) }),
      communityMatch({ id: "b", deckSourceKey: "missing", deckSnapshotJson: JSON.stringify(missingChampion) })
    ]);

    const stats = communityCardStatsForLegend(meta, "Diana", "champions");
    expect(stats.map((stat) => [stat.name, stat.inclusionRate])).toEqual([["Diana, Lunari", 100]]);
    expect(stats.reduce((sum, stat) => sum + stat.inclusionRate, 0)).toBe(100);
  });

  it("fills missing card images from the wider community deck cache", () => {
    const textOnlyDiana = snapshot({
      sourceKey: "diana-text",
      sideboard: [{ qty: 1, name: "Acceptable Losses", cardId: "", imageUrl: "" }]
    });
    const imageSourceVex = snapshot({
      legend: "Vex",
      legendKey: "vex",
      sourceKey: "vex-image",
      sideboard: [{ qty: 2, name: "Acceptable Losses", cardId: "OGN-179", imageUrl: "https://cdn.piltoverarchive.com/cards/OGN-179.webp" }]
    });
    const meta = buildCommunityDeckMeta([
      communityMatch({ id: "a", deckSourceKey: "diana-text", deckSnapshotJson: JSON.stringify(textOnlyDiana) }),
      communityMatch({ id: "b", myChampion: "Vex", deckName: "Vex", deckSourceKey: "vex-image", deckSnapshotJson: JSON.stringify(imageSourceVex) })
    ]);

    const stat = communityCardStatsForLegend(meta, "Diana", "sideboard").find((item) => item.name === "Acceptable Losses");
    expect(stat?.imageUrl).toContain("OGN-179.webp");
  });

  it("keeps rune entries out of battlefield stats when snapshots misfile them", () => {
    const dirtySnapshot = snapshot({
      battlefields: [
        { qty: 1, name: "Targon's Peak", cardId: "OGN-289" },
        { qty: 6, name: "Chaos Rune", cardId: "OGN-166" },
        { qty: 6, name: "Mind Rune alternate art", cardId: "ALT-001" }
      ]
    });
    const meta = buildCommunityDeckMeta([communityMatch({ id: "a", deckSnapshotJson: JSON.stringify(dirtySnapshot) })]);

    const stats = communityBattlefieldStatsForLegend(meta, "Diana").map((stat) => stat.name);
    expect(stats).toContain("Targon's Peak");
    expect(stats).not.toContain("Chaos Rune");
    expect(stats).not.toContain("Mind Rune");
  });

  it("separates battlefield inclusion from battlefield chosen rate", () => {
    const meta = buildCommunityDeckMeta([
      communityMatch({ id: "a", myBattlefield: "Targon's Peak" }),
      communityMatch({
        id: "b",
        result: "Loss",
        myBattlefield: "Star Spring",
        gamesJson: JSON.stringify([{ gameNumber: 1, result: "Loss", wentFirst: "2nd", myBattlefield: "Star Spring", oppBattlefield: "Sunken Temple" }])
      })
    ]);
    const stats = communityBattlefieldStatsForLegend(meta, "Diana");
    const targonsPeak = stats.find((stat) => stat.name === "Targon's Peak");
    const starSpring = stats.find((stat) => stat.name === "Star Spring");

    expect(targonsPeak?.inclusionRate).toBe(100);
    expect(starSpring?.inclusionRate).toBe(100);
    expect(targonsPeak?.chosenRate).toBe(50);
    expect(starSpring?.chosenRate).toBe(50);
    expect(starSpring?.secondChosenMatches).toBe(1);
  });
});
