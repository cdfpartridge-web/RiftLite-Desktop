import { describe, expect, it } from "vitest";
import {
  chooseAtlasOpponentIdentityName,
  compareAtlasPlayerIdentityCandidates,
  isAtlasPlayerIdentityUiControlCandidate,
  isAtlasPlayerIdentityUiControlValue
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

  it("never selects the current Atlas room code as the opponent identity", () => {
    const roomCodeCandidate = {
      name: "UV9VG",
      side: "opponent" as const,
      source: "opponent-dom",
      score: 8
    };

    expect(chooseAtlasOpponentIdentityName([roomCodeCandidate], "BMU", ["UV9VG"])).toBe("");
    expect(chooseAtlasOpponentIdentityName([roomCodeCandidate, realOpponent], "BMU", ["UV9VG"]))
      .toBe("Tsaysana");
  });

  it("sorts reliable identity candidates before generic DOM candidates", () => {
    expect([deckSearchCard, realOpponent].sort(compareAtlasPlayerIdentityCandidates).map((item) => item.name))
      .toEqual(["Tsaysana", "Stacked"]);
  });

  it.each([
    "Hide PopoverDeck PeekLook at more",
    "Hide PopoverTrash CardsUse",
    "Look at",
    "Rewind the last action",
    "undo your last Rewind",
    "Next Game?"
  ])("rejects Atlas UI control text as an opponent identity: %s", (name) => {
    const controlCandidate = {
      name,
      side: "opponent" as const,
      source: "aria-label",
      score: 8,
      top: 8,
      left: 300
    };

    expect(isAtlasPlayerIdentityUiControlValue(name)).toBe(true);
    expect(isAtlasPlayerIdentityUiControlCandidate(controlCandidate)).toBe(true);
    expect(chooseAtlasOpponentIdentityName([controlCandidate], "Bunana", ["ZYBSB"])).toBe("");
  });

  it.each(["R", "Starts"])("rejects an ambiguous low-trust control without rejecting an authoritative identity: %s", (name) => {
    const rewindHotkey = {
      name,
      side: "opponent" as const,
      source: "aria-label",
      score: 4
    };
    const authoritativeR = {
      ...rewindHotkey,
      source: "identity-dom"
    };

    expect(isAtlasPlayerIdentityUiControlCandidate(rewindHotkey)).toBe(true);
    expect(isAtlasPlayerIdentityUiControlCandidate(authoritativeR)).toBe(false);
    expect(chooseAtlasOpponentIdentityName([rewindHotkey], "Bunana")).toBe("");
    expect(chooseAtlasOpponentIdentityName([authoritativeR], "Bunana")).toBe(name);
  });

  it("rejects a structurally impossible popover label even when its DOM class looks authoritative", () => {
    const popover = {
      name: "Hide PopoverDeck PeekLook at more",
      side: "opponent" as const,
      source: "opponent-dom",
      score: 8
    };

    expect(isAtlasPlayerIdentityUiControlCandidate(popover)).toBe(true);
    expect(chooseAtlasOpponentIdentityName([popover], "Bunana")).toBe("");
  });
});
