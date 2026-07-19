import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type BattlefieldCatalogEntry = {
  name: string;
  aliases?: string[];
  is_active?: boolean;
};

const catalog = JSON.parse(
  readFileSync(new URL("../resources/battlefield_catalog.json", import.meta.url), "utf8")
) as BattlefieldCatalogEntry[];
const gamePreloadSource = readFileSync(new URL("../src/game-preload/gamePreload.ts", import.meta.url), "utf8");

const newlySupportedBattlefields = [
  "Trapping Grounds",
  "Valley of Idols",
  "Dragon Roost",
  "Heisho, Shell of the World",
  "Kinkou Temple",
  "Mystic Vortex",
  "Piltovan Forge",
  "Protective Sands",
  "Risen Altar",
  "Sandswept Tomb",
  "Shadow Temple",
  "Threshold of the Gray"
] as const;

describe("battlefield catalog", () => {
  it("contains each released Unleashed and previewed Vendetta battlefield exactly once", () => {
    for (const name of newlySupportedBattlefields) {
      const matches = catalog.filter((entry) => entry.name === name);
      expect(matches, name).toHaveLength(1);
      expect(matches[0]?.is_active, name).not.toBe(false);
    }
  });

  it("has unique canonical names", () => {
    const names = catalog.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps the TCGA text matcher in sync with the canonical additions", () => {
    for (const name of newlySupportedBattlefields) {
      expect(gamePreloadSource, name).toContain(`canonical: "${name}"`);
    }
  });
});
