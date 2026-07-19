import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TcgaResolver } from "../src/main/services/tcgaResolver";
import { canonicalLegendName, normalizeLegendName } from "../src/shared/legendNames";

describe("TcgaResolver", () => {
  it("resolves Vendetta legends from TCGA Riot image hashes", async () => {
    const resolver = new TcgaResolver(resolve(process.cwd(), "resources/tcga_card_lookup.json"));

    await expect(resolver.resolveLegend("https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0d53b477ed43fb9bbed84858443a606b2b51a2b5-744x1039.png?accountingTag=RB&auto=format&fit=fill&q=80&w=444")).resolves.toBe("Akali");
    await expect(resolver.resolveLegend("https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0eab83392b310417d2630d50a3bfee3dd02b31c4-744x1039.png?accountingTag=RB&auto=format&fit=fill&q=80&w=444")).resolves.toBe("Kennen");
  });

  it("recognizes signed and overnumbered legend print codes", async () => {
    const resolver = new TcgaResolver(resolve(process.cwd(), "resources/tcga_card_lookup.json"));

    await expect(resolver.resolveLegend("https://cards.test/UNL-089A.webp")).resolves.toBe("Jhin");
    await expect(resolver.resolveLegend("https://cards.test/UNL-226.webp")).resolves.toBe("Jhin");
  });

  it("resolves every supported collector-code shape from the typed offline registry", async () => {
    await withRegistry([
      registryCard("VEN-139", "Rogue Assassin", "Legend", { champion: "Akali" }),
      registryCard("VEN-R01", "Fury Rune", "Rune"),
      registryCard("UNL-T01", "Baron Pit", "Token", { supertype: "Battlefield" }),
      registryCard("OGN-SP003", "Promotional Spell", "Spell"),
      registryCard("UNL-226*", "Virtuoso", "Legend", { champion: "Jhin" })
    ], async (resolver) => {
      const cases: Array<[string, string]> = [
        ["https://cards.test/VEN-139A.webp", "Rogue Assassin"],
        ["https://cards.test/VEN-139B.webp", "Rogue Assassin"],
        ["VEN-R01/006", "Fury Rune"],
        ["board-slot-UNL-T01", "Baron Pit"],
        ["https://cards.test/OGN-SP003.webp", "Promotional Spell"],
        ["UNL-226*/219", "Virtuoso"],
        ["https://cards.test/UNL-226-star.webp", "Virtuoso"],
        ["https://cards.test/UNL-226%2A.webp", "Virtuoso"]
      ];
      for (const [value, expected] of cases) {
        await expect(resolver.resolveCard(value)).resolves.toBe(expected);
      }
    });
  });

  it("falls back from set-specific Rune prints to canonical Rune identities", async () => {
    await withRegistry([
      registryCard("OGN-089", "Mind Rune", "Rune"),
      registryCard("OGN-214", "Order Rune", "Rune")
    ], async (resolver) => {
      await expect(resolver.resolveCard("UNL-R03A")).resolves.toBe("Mind Rune");
      await expect(resolver.resolveCard("SFD-R06B")).resolves.toBe("Order Rune");
      await expect(resolver.resolveLegend("UNL-R03A")).resolves.toBe("");
      await expect(resolver.resolveBattlefield("SFD-R06B")).resolves.toBe("");
    });
  });

  it("keeps exact Rune variants ahead of canonical art and rejects a non-Rune target", async () => {
    await withRegistry([
      registryCard("UNL-R03A", "Mind Rune Showcase", "Rune"),
      registryCard("OGN-089", "Mind Rune", "Rune"),
      registryCard("OGN-214", "Not a Rune", "Unit")
    ], async (resolver) => {
      await expect(resolver.resolveCard("UNL-R03A")).resolves.toBe("Mind Rune Showcase");
      await expect(resolver.resolveCard("UNL-R03A-star")).resolves.toBe("Mind Rune Showcase");
      await expect(resolver.resolveCard("SFD-R06B")).resolves.toBe("");
      await expect(resolver.resolveLegend("SFD-R06B")).resolves.toBe("");
      await expect(resolver.resolveBattlefield("SFD-R06B")).resolves.toBe("");
    });
  });

  it("keeps canonical Rune fallback available to legacy-only installs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-legacy-rune-test-"));
    const legacyPath = join(directory, "tcga_card_lookup.json");
    try {
      await writeFile(legacyPath, JSON.stringify({
        codeMap: {
          "OGN-089": "Mind Rune",
          "OGN-214": "Order Rune"
        }
      }), "utf8");
      const resolver = new TcgaResolver(legacyPath);

      await expect(resolver.resolveCard("UNL-R03A")).resolves.toBe("Mind Rune");
      await expect(resolver.resolveCard("SFD-R06B")).resolves.toBe("Order Rune");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses registry types so cards cannot cross legend and battlefield contexts", async () => {
    await withRegistry([
      registryCard("VEN-139", "Rogue Assassin", "Legend", { champion: "Akali" }),
      registryCard("VEN-141", "Butcher of the Sands", "Legend", { champion: "Renekton" }),
      registryCard("VEN-151", "Soul's Reflection", "Legend", { champion: "Mel" }),
      registryCard("VEN-157", "Dragon Roost", "Battlefield"),
      registryCard("UNL-T01", "Baron Pit", "Token", { supertype: "Battlefield" }),
      registryCard("UNL-089A", "Jhin, Meticulous Killer", "Unit", { supertype: "Champion", tags: ["Jhin"] }),
      registryCard("TST-002", "Ordinary Unit", "Unit", { tags: ["Elite"] })
    ], async (resolver) => {
      await expect(resolver.resolveLegend("VEN-139A")).resolves.toBe("Akali");
      await expect(resolver.resolveLegend("VEN-141")).resolves.toBe("Renekton");
      await expect(resolver.resolveLegend("VEN-151")).resolves.toBe("Mel");
      await expect(resolver.resolveLegend("UNL-089A")).resolves.toBe("Jhin");
      await expect(resolver.resolveBattlefield("VEN-157")).resolves.toBe("Dragon Roost");
      await expect(resolver.resolveBattlefield("UNL-T01")).resolves.toBe("Baron Pit");

      await expect(resolver.resolveLegend("VEN-157")).resolves.toBe("");
      await expect(resolver.resolveLegend("UNL-T01")).resolves.toBe("");
      await expect(resolver.resolveLegend("TST-002")).resolves.toBe("");
      await expect(resolver.resolveBattlefield("VEN-139")).resolves.toBe("");
    });
  });

  it("auto-loads the registry beside the legacy path used by existing app wiring", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-registry-sibling-test-"));
    const legacyPath = join(directory, "tcga_card_lookup.json");
    const registryPath = join(directory, "riftbound_card_registry.json");
    try {
      await writeFile(legacyPath, JSON.stringify({ codeMap: { "VEN-157": "Stale legacy value" } }), "utf8");
      await writeFile(registryPath, JSON.stringify({
        schemaVersion: 1,
        cards: [registryCard("VEN-157", "Dragon Roost", "Battlefield")]
      }), "utf8");

      const resolver = new TcgaResolver(legacyPath);
      await expect(resolver.resolveBattlefield("VEN-157")).resolves.toBe("Dragon Roost");
      await expect(resolver.resolveLegend("VEN-157")).resolves.toBe("");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("makes concurrent first resolutions await the same registry load", async () => {
    await withRegistry([
      registryCard("VEN-139", "Rogue Assassin", "Legend", { champion: "Akali" }),
      registryCard("VEN-157", "Dragon Roost", "Battlefield"),
      registryCard("VEN-R01", "Fury Rune", "Rune"),
      registryCard("OGN-SP003", "Promotional Spell", "Spell")
    ], async (resolver) => {
      await expect(Promise.all([
        resolver.resolveLegend("VEN-139"),
        resolver.resolveBattlefield("VEN-157"),
        resolver.resolveCard("VEN-R01"),
        resolver.resolveCard("OGN-SP003")
      ])).resolves.toEqual(["Akali", "Dragon Roost", "Fury Rune", "Promotional Spell"]);
    });
  });

  it("resolves typed records by current image hash", async () => {
    const imageHash = "1234567890abcdef1234567890abcdef12345678";
    await withRegistry([
      registryCard("VEN-166", "Threshold of the Gray", "Battlefield", {
        imageHash,
        imageUrl: `https://cmsassets.test/${imageHash}-744x1039.png`
      })
    ], async (resolver) => {
      await expect(resolver.resolveBattlefield(`https://cmsassets.test/${imageHash}-744x1039.png`))
        .resolves.toBe("Threshold of the Gray");
    });
  });

  it("prefers exact prints but refuses an ambiguous fuzzy alias or image hash", async () => {
    const sharedHash = "abcdef1234567890abcdef1234567890abcdef12";
    await withRegistry([
      registryCard("TST-001A", "Alpha Card", "Unit", { basePrintId: "TST-001", imageHash: sharedHash }),
      registryCard("TST-001B", "Beta Card", "Unit", { basePrintId: "TST-001", imageHash: sharedHash })
    ], async (resolver) => {
      await expect(resolver.resolveCard("TST-001A")).resolves.toBe("Alpha Card");
      await expect(resolver.resolveCard("TST-001B")).resolves.toBe("Beta Card");
      await expect(resolver.resolveCard("TST-001C")).resolves.toBe("");
      await expect(resolver.resolveCard(`https://cards.test/${sharedHash}.webp`)).resolves.toBe("");
      await expect(resolver.resolveCard("TST-001garbage")).resolves.toBe("");
    });
  });

  it("resolves every packaged registry print and enforces every packaged card type", async () => {
    const registryPath = resolve(process.cwd(), "resources/riftbound_card_registry.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8")) as {
      cards: Array<TestRegistryCard & { setCode: string }>;
    };
    const resolver = new TcgaResolver(resolve(process.cwd(), "resources/tcga_card_lookup.json"));
    const failures: string[] = [];

    for (const card of registry.cards) {
      const resolvedCard = await resolver.resolveCard(card.printId);
      if (resolvedCard !== card.name) {
        failures.push(`${card.printId}: card resolved as ${JSON.stringify(resolvedCard)} instead of ${JSON.stringify(card.name)}`);
      }

      if (card.imageHash) {
        const resolvedHash = await resolver.resolveCard(`https://cmsassets.test/${card.imageHash}-card.webp`);
        if (resolvedHash !== card.name) {
          failures.push(`${card.printId}: image hash resolved as ${JSON.stringify(resolvedHash)}`);
        }
      }

      const resolvedLegend = await resolver.resolveLegend(card.printId);
      const resolvedBattlefield = await resolver.resolveBattlefield(card.printId);
      if (card.type === "Legend") {
        const expectedLegend = normalizeLegendName(card.name);
        if (resolvedLegend !== expectedLegend) {
          failures.push(`${card.printId}: legend resolved as ${JSON.stringify(resolvedLegend)} instead of ${JSON.stringify(expectedLegend)}`);
        }
        if (resolvedBattlefield) {
          failures.push(`${card.printId}: Legend crossed into battlefield resolver as ${JSON.stringify(resolvedBattlefield)}`);
        }
      } else if (card.type === "Battlefield") {
        if (resolvedBattlefield !== card.name) {
          failures.push(`${card.printId}: battlefield resolved as ${JSON.stringify(resolvedBattlefield)}`);
        }
        if (resolvedLegend) {
          failures.push(`${card.printId}: Battlefield crossed into legend resolver as ${JSON.stringify(resolvedLegend)}`);
        }
      } else {
        const championIdentity = card.type === "Unit" && card.supertype === "Champion"
          ? canonicalLegendName(card.champion)
          : "";
        if (championIdentity) {
          if (resolvedLegend !== championIdentity) {
            failures.push(`${card.printId}: champion-tagged ${card.type} resolved as ${JSON.stringify(resolvedLegend)}`);
          }
        } else if (resolvedLegend) {
          failures.push(`${card.printId}: ${card.type} crossed into legend resolver as ${JSON.stringify(resolvedLegend)}`);
        }
        if (resolvedBattlefield) {
          failures.push(`${card.printId}: ${card.type} crossed into battlefield resolver as ${JSON.stringify(resolvedBattlefield)}`);
        }
      }
    }

    const vendettaBattlefields = registry.cards.filter((card) => card.setCode === "VEN" && card.type === "Battlefield");
    const vendettaLegends = registry.cards.filter((card) => card.setCode === "VEN" && card.type === "Legend");
    const vendettaRunes = registry.cards.filter((card) => card.setCode === "VEN" && card.type === "Rune");
    expect(vendettaBattlefields).toHaveLength(10);
    expect(vendettaLegends).toHaveLength(18);
    expect(vendettaRunes).toHaveLength(6);
    expect(failures).toEqual([]);
  });

  it("maps every packaged signed slug to the same card as its literal-star print", async () => {
    const registryPath = resolve(process.cwd(), "resources/riftbound_card_registry.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8")) as { cards: TestRegistryCard[] };
    const signedCards = registry.cards.filter((card) => card.printId.endsWith("*"));
    const resolver = new TcgaResolver(registryPath);

    expect(signedCards.length).toBeGreaterThan(0);
    for (const card of signedCards) {
      const starSlug = `${card.printId.slice(0, -1)}-star-card.webp`;
      await expect(resolver.resolveCard(starSlug)).resolves.toBe(card.name);
      if (card.type === "Legend") {
        await expect(resolver.resolveLegend(starSlug)).resolves.toBe(normalizeLegendName(card.name));
      }
    }
  });
});

interface TestRegistryCard {
  printId: string;
  basePrintId: string;
  name: string;
  type: string;
  supertype: string | null;
  champion: string | null;
  imageUrl: string | null;
  imageHash: string | null;
  tags: string[];
}

function registryCard(
  printId: string,
  name: string,
  type: string,
  overrides: Partial<TestRegistryCard> = {}
): TestRegistryCard {
  return {
    printId,
    basePrintId: printId.replace(/\*$/, "").replace(/[A-B]$/, ""),
    name,
    type,
    supertype: null,
    champion: null,
    imageUrl: null,
    imageHash: null,
    tags: [],
    ...overrides
  };
}

async function withRegistry(
  cards: TestRegistryCard[],
  run: (resolver: TcgaResolver) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "riftlite-registry-test-"));
  const registryPath = join(directory, "riftbound_card_registry.json");
  try {
    await writeFile(registryPath, JSON.stringify({ schemaVersion: 1, cards }), "utf8");
    await run(new TcgaResolver(registryPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
