import { describe, expect, it } from "vitest";
import { readTcgaProfileName } from "../src/shared/tcgaIdentity";

describe("readTcgaProfileName", () => {
  it("prefers the TCGA pseudo over saved Riftbound game labels", () => {
    expect(readTcgaProfileName({
      games: [
        {
          name: "Riftbound",
          image: "https://tcg-arena.fr/assets/games/riftbound.jpg",
          url: "/games/riftbound"
        }
      ],
      preferences: {
        pseudo: "NotNewGenesis"
      }
    })).toBe("NotNewGenesis");
  });

  it("still reads opponent peer names from direct opponent objects", () => {
    expect(readTcgaProfileName({
      id: "peer-1",
      name: "BMU",
      date: 177711
    })).toBe("BMU");
  });
});
