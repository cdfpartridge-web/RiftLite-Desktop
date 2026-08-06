import { describe, expect, it } from "vitest";
import {
  chooseAtlasOpponentIdentityName,
  compareAtlasPlayerIdentityCandidates
} from "../src/shared/atlasPlayerIdentity";

describe("Atlas player identity ranking", () => {
  const realOpponent = {
    name: "Tsaysana",
    side: "opponent" as const,
    source: "identity-dom",
    score: 8,
    top: 17,
    left: 1592
  };
  const deckSearchCard = {
    name: "Stacked",
    side: "opponent" as const,
    source: "dom",
    score: 8,
    top: 81,
    left: 1636
  };

  it("prefers the real identity over a tied deck-search card regardless of DOM order", () => {
    expect(chooseAtlasOpponentIdentityName([deckSearchCard, realOpponent], "BMU")).toBe("Tsaysana");
    expect(chooseAtlasOpponentIdentityName([realOpponent, deckSearchCard], "BMU")).toBe("Tsaysana");
  });

  it("sorts reliable identity candidates before generic DOM candidates", () => {
    expect([deckSearchCard, realOpponent].sort(compareAtlasPlayerIdentityCandidates).map((item) => item.name))
      .toEqual(["Tsaysana", "Stacked"]);
  });
});
