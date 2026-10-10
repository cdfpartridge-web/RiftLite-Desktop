import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import registryData from "../resources/riftbound_card_registry.json";
import { TcgaResolver } from "../src/main/services/tcgaResolver";
import { resolveBundledCardImage } from "../src/renderer/cardArtwork";

type RegistryCard = {
  printId: string;
  name: string;
  type: string;
  supertype?: string | null;
  costEnergy?: number | null;
  costPower?: number | null;
  champion?: string | null;
  imageUrl?: string | null;
  variants: {
    alternateArt: boolean;
    overnumbered: boolean;
    signature: boolean;
  };
};

const cards = registryData.cards as RegistryCard[];

function resolver(): TcgaResolver {
  return new TcgaResolver(resolve(process.cwd(), "resources/tcga_card_lookup.json"));
}

describe("packaged Riftbound registry", () => {
  it("resolves the additional Atlas promo and alternate prints without inventing source-only collector ids", async () => {
    const cardResolver = resolver();
    for (const id of ["OGN-036A", "OGN-068A", "OGN-111A", "OGN-159A", "OGN-202B", "OGN-246B", "OGN-303A", "SFD-195A", "SGN-001", "SGN-002", "VEN-069B", "VEN-155A"]) {
      const card = cards.find(c => c.printId === id)!;
      expect(card, id).toBeDefined();
      await expect(cardResolver.resolveCard(id)).resolves.toBe(card.name);
      await expect(cardResolver.resolveCard(card.imageUrl)).resolves.toBe(card.name);
      expect(resolveBundledCardImage(id)).toBe(card.imageUrl);
    }
    expect(cards.some(c => c.printId === "VEN-041P" || c.printId === "OGN-999")).toBe(false);
    await expect(cardResolver.resolveLegend("SGN-001")).resolves.toBe("Lillia");
    await expect(cardResolver.resolveLegend("SGN-002")).resolves.toBe("Ivern");
    expect(cards.find(c => c.printId === "OGN-303A")).toMatchObject({
      name: "Ahri, Nine-Tailed Fox", artist: "Allen Song", variants: { alternateArt: true, signature: true }
    });
  });

  it("recognizes the newly audited historical promos, alternate runes and tokens without replacing their exact artwork", async () => {
    const cardResolver = resolver();
    const printIds = [
      "ARC-001", "ARC-002", "ARC-003", "ARC-004", "ARC-005", "ARC-006",
      "OGN-007B", "OGN-042B", "OGN-089B", "OGN-126B", "OGN-166B", "OGN-214B", "OGN-151B", "OGN-197B",
      "UNL-R01A", "UNL-R02A", "UNL-R03A", "UNL-R04A", "UNL-R05A", "UNL-R06A",
      "SFD-T01", "SFD-T02", "VEN-041A", "VEN-T01", "VEN-T05", "VEN-T06"
    ];
    for (const printId of printIds) {
      const card = cards.find(card => card.printId === printId);
      expect(card, printId).toBeDefined();
      await expect(cardResolver.resolveCard(printId)).resolves.toBe(card?.name);
      expect(resolveBundledCardImage(printId), printId).toBe(card?.imageUrl);
    }
    expect(resolveBundledCardImage("UNL-R01A")).not.toBe(resolveBundledCardImage("OGN-007A"));
    expect(resolveBundledCardImage("OGN-151B")).not.toBe(resolveBundledCardImage("OGN-151A"));
  });

  it("resolves every catalogued Legend and collectible Battlefield by exact print id", async () => {
    const cardResolver = resolver();
    const legends = cards.filter((card) => card.type.toLowerCase() === "legend");
    const battlefields = cards.filter((card) => card.type.toLowerCase() === "battlefield");

    for (const card of legends) {
      expect(await cardResolver.resolveLegend(card.printId), card.printId).not.toBe("");
    }
    for (const card of battlefields) {
      expect(await cardResolver.resolveBattlefield(card.printId), card.printId).toBe(card.name);
    }
  });

  it("maps Vendetta base, overnumbered and signed artwork to the same gameplay identity", async () => {
    const cardResolver = resolver();
    const pairs = [
      ["VEN-139", "VEN-189", "Akali"],
      ["VEN-141", "VEN-190", "Renekton"],
      ["VEN-143", "VEN-191", "Zed"],
      ["VEN-145", "VEN-192", "Nasus"],
      ["VEN-147", "VEN-193", "Shen"],
      ["VEN-149", "VEN-194", "Jayce"],
      ["VEN-151", "VEN-195", "Mel"],
      ["VEN-153", "VEN-196", "Ambessa"],
      ["VEN-155", "VEN-197", "Kennen"]
    ] as const;

    for (const [base, overnumbered, identity] of pairs) {
      await expect(cardResolver.resolveLegend(base)).resolves.toBe(identity);
      await expect(cardResolver.resolveLegend(overnumbered)).resolves.toBe(identity);
      const signed = cards.find((card) => card.printId === `${overnumbered}*`);
      const unsigned = cards.find((card) => card.printId === overnumbered);
      expect(signed, `${identity} signed print must be packaged`).toBeDefined();
      expect(signed?.variants.signature).toBe(true);
      expect(signed?.imageUrl).not.toBe(unsigned?.imageUrl);
      await expect(cardResolver.resolveLegend(`${overnumbered}*/166`)).resolves.toBe(identity);
      await expect(cardResolver.resolveLegend(`${overnumbered}-star-166`)).resolves.toBe(identity);
      // TCGA can supply only a Riot image hash, without a collector code/name.
      await expect(cardResolver.resolveLegend(signed?.imageUrl)).resolves.toBe(identity);
    }
  });

  it("recognizes both the original and corrected Shadowblade Lurker artwork", async () => {
    const cardResolver = resolver();
    const currentHash = "f42e9286c968db8cd37fb2911617b8c78de7d516";
    const originalHash = "2874318b39f1dd9d1bf2ed21203795688b788413";
    expect(cards.find((card) => card.printId === "VEN-096")?.imageUrl).toContain(currentHash);
    for (const hash of [currentHash, originalHash]) {
      await expect(cardResolver.resolveCard(hash)).resolves.toBe("Shadowblade Lurker");
      await expect(cardResolver.resolveLegend(hash)).resolves.toBe("");
    }
  });

  it("preserves signed and alternate-art spellings instead of collapsing the exact print", async () => {
    const cardResolver = resolver();

    await expect(cardResolver.resolveLegend("UNL-226*/219")).resolves.toBe("Jhin");
    await expect(cardResolver.resolveLegend("https://cards.example/UNL-226-star-219.webp")).resolves.toBe("Jhin");
    await expect(cardResolver.resolveLegend("https://cards.example/UNL-089A.webp")).resolves.toBe("Jhin");
    await expect(cardResolver.resolveLegend("UNL-001")).resolves.toBe("");
  });

  it("contains Riot artwork for every non-local setup card", () => {
    const setupCards = cards.filter((card) => ["legend", "battlefield", "rune"].includes(card.type.toLowerCase()));
    for (const card of setupCards) {
      expect(card.imageUrl, card.printId).toMatch(/^https:\/\//);
    }
  });

  it("contains validated printed costs for every collectible main-deck card", () => {
    const mainDeckCards = cards.filter((card) =>
      ["unit", "spell", "gear"].includes(card.type.toLowerCase())
      && card.supertype?.toLowerCase() !== "token"
    );

    expect(mainDeckCards.length).toBeGreaterThan(900);
    for (const card of mainDeckCards) {
      expect(Number.isInteger(card.costEnergy), `${card.printId} Energy cost`).toBe(true);
      expect(card.costEnergy ?? -1, `${card.printId} Energy cost`).toBeGreaterThanOrEqual(0);
      expect(
        card.costPower === null
          || (typeof card.costPower === "number" && Number.isInteger(card.costPower) && card.costPower >= 0),
        `${card.printId} Power cost`,
      ).toBe(true);
    }
  });

  it("identifies a known two-Energy Unit even when it has a Power cost", () => {
    expect(cards.find((card) => card.printId === "OGN-036")).toMatchObject({
      name: "Vi, Destructive",
      type: "Unit",
      costEnergy: 2,
      costPower: 1,
    });
  });
});
