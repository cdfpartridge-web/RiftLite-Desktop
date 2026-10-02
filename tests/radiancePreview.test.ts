import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import registry from "../resources/riftbound_card_registry.json";
import { TcgaResolver } from "../src/main/services/tcgaResolver";
import { canonicalLegendName } from "../src/shared/legendNames";
import { legendFromImageUrl, legendImageUrl } from "../src/shared/legendImages";
import { resolveBundledCardImage, resolveCardArtwork } from "../src/renderer/cardArtwork";
import { homeDeckThemeForLegend } from "../src/shared/homeDeckTheme";

const cards = registry.cards.filter(card => card.setCode === "RAD");

describe("Radiance preview capture and artwork", () => {
  it("resolves every revealed print from collector codes and available Riot image hashes", async () => {
    const resolver = new TcgaResolver(resolve("resources/tcga_card_lookup.json"));
    expect(cards).toHaveLength(110);
    for (const card of cards) {
      await expect(resolver.resolveCard(card.printId)).resolves.toBe(card.name);
      if (card.imageHash) await expect(resolver.resolveCard(card.imageHash)).resolves.toBe(card.name);
      expect(resolveBundledCardImage(card.printId), card.printId).toBe(card.imageUrl);
      await expect(resolver.resolveCard(`${card.imageUrl}${card.imageUrl.includes("?") ? "&" : "?"}width=400`)).resolves.toBe(card.name);
      if (card.type === "Legend") {
        expect(canonicalLegendName(card.name)).toBe(card.champion);
        expect(canonicalLegendName(card.name.split(", ")[1])).toBe(card.champion);
        expect(legendFromImageUrl(`https://cdn.piltoverarchive.com/cards/${card.printId}.webp`)).toBe(card.champion);
        expect(legendImageUrl(card.champion!)).toMatch(/^https:/);
        await expect(resolver.resolveLegend(card.imageUrl)).resolves.toBe(card.champion);
      }
      if (card.type === "Battlefield") await expect(resolver.resolveBattlefield(card.imageUrl)).resolves.toBe(card.name);
    }
  });

  it("uses printed types and costs where gallery metadata is incomplete or incorrect", () => {
    const card = (id: string) => cards.find(c => c.printId === id);
    for (const id of ["RAD-012", "RAD-035", "RAD-046", "RAD-069", "RAD-136"]) {
      expect(card(id)?.type, id).toBe("Gear");
    }
    for (const id of ["RAD-033", "RAD-034", "RAD-056", "RAD-059", "RAD-127"]) {
      expect(card(id)?.type, id).toBe("Spell");
    }
    expect(card("RAD-090A")).toMatchObject({ name: "Evelynn, Consuming", costEnergy: 5, costPower: 1 });
    expect(card("RAD-T02")).toMatchObject({ name: "Bomb", type: "Gear", supertype: "Token" });
    expect(card("RAD-132")?.champion).toBe("Heimerdinger");
  });

  it("retains distinct alternate, signed, rune and promo artwork", () => {
    for (const [base, variant] of [["RAD-023", "RAD-023A"], ["RAD-169", "RAD-169*"], ["RAD-R02", "RAD-R02A"], ["RAD-063", "RAD-SP4"]]) {
      expect(resolveBundledCardImage(base)).not.toBe(resolveBundledCardImage(variant));
    }
    expect(resolveBundledCardImage("RAD-168")).not.toBe(resolveBundledCardImage("RAD-168*"));
    expect(resolveBundledCardImage("RAD-R04A")).not.toBe(resolveBundledCardImage("OGN-126"));
    expect(registry.stats.bySet.RAD.uniquePrints).toBe(110);
  });

  it("supports newly revealed champion costs, setup cards and the corrected printed title", () => {
    const card = (id: string) => cards.find(c => c.printId === id);
    expect(card("RAD-015")).toMatchObject({ name: "Akali, Brash", supertype: "Champion", costEnergy: 5, costPower: 1 });
    expect(card("RAD-085")).toMatchObject({ name: "Graves, Blasting Through", supertype: "Champion", costEnergy: 5, costPower: 1 });
    expect(card("RAD-SP3")).toMatchObject({ name: "Evelynn, In Control", supertype: "Champion", costEnergy: 4, costPower: 1 });
    expect(card("RAD-013")).toMatchObject({ name: "Lost to the Sands", aliases: ["Lost to the Sand"] });
    expect(card("RAD-152")).toMatchObject({ name: "Encore", type: "Spell", supertype: "Signature", costEnergy: 3, costPower: 1 });
    expect(legendFromImageUrl(`${legendImageUrl("Mordekaiser")}?width=400`)).toBe("Mordekaiser");
    expect(homeDeckThemeForLegend("Mordekaiser, Iron Revenant")?.domains).toEqual(["Fury", "Order"]);
  });

  it("recognises preview images with no collector code in their filename", async () => {
    const resolver = new TcgaResolver(resolve("resources/tcga_card_lookup.json"));
    const promo = "https://cdn.piltoverarchive.com/temporary/1790379856360-1cbp857fr3y.jpg";
    await expect(resolver.resolveCard(`${promo}?width=400`)).resolves.toBe("Ahri, Confident");
    expect(resolveCardArtwork("RAD-038", promo)).toBe(promo);
    expect(resolveCardArtwork("RAD-023", promo)).not.toBe(promo);
  });
});
