import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import registryData from "../resources/riftbound_card_registry.json";
import { TcgaResolver } from "../src/main/services/tcgaResolver";

type RegistryCard = {
  printId: string;
  name: string;
  type: string;
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

  it("maps Vendetta base and overnumbered legends to the same gameplay identity", async () => {
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
});
