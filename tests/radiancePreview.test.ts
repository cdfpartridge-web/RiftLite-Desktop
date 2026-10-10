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
    expect(cards).toHaveLength(218);
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
    expect(registry.stats.bySet.RAD.uniquePrints).toBe(218);
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
    expect(homeDeckThemeForLegend("Evelynn, Agony's Embrace")?.domains).toEqual(["Body", "Chaos"]);
    expect(card("RAD-153")).toMatchObject({ name: "Evelynn, Agony's Embrace", type: "Legend", champion: "Evelynn" });
    expect(card("RAD-175")).toMatchObject({ name: "Evelynn, Agony's Embrace", variants: { overnumbered: true } });
    expect(card("RAD-170*")).toMatchObject({ name: "Mordekaiser, Iron Revenant", variants: { signature: true } });
    expect(resolveBundledCardImage("RAD-170*")).not.toBe(resolveBundledCardImage("RAD-170"));
    expect(resolveBundledCardImage("RAD-175")).not.toBe(resolveBundledCardImage("RAD-153"));
    expect(resolveBundledCardImage("RAD-184")).not.toBe(resolveBundledCardImage("RAD-165"));
    expect(card("RAD-163")).toMatchObject({ name: "Hunters' Circle", aliases: ["Hunter's Circle"] });
  });

  it("preserves October 8 preview costs, champion identities and previous Chinese name aliases", () => {
    const card = (id: string) => cards.find(c => c.printId === id);
    expect(card("RAD-020")).toMatchObject({ name: "Mordekaiser, Twice Slain", supertype: "Champion", costEnergy: 7, costPower: 1 });
    expect(card("RAD-042")).toMatchObject({ name: "Orianna, Exquisite", costEnergy: 3, costPower: 0 });
    expect(card("RAD-039")).toMatchObject({ name: "Ephemeral Ward", type: "Gear", costEnergy: 4, costPower: 2 });
    expect(card("RAD-114")).toMatchObject({ name: "Riven, Deserter", champion: "Riven", costEnergy: 5, costPower: 1 });
    expect(card("RAD-030")).toMatchObject({ name: "Sanctum Conservator", aliases: ["圣所保管员"], costEnergy: 5, costPower: 0 });
    expect(canonicalLegendName("Riven, The Exile")).toBe("Riven");
    expect(canonicalLegendName("The Exile")).toBe("Riven");
    expect(homeDeckThemeForLegend("Riven")?.domains).toEqual(["Calm", "Chaos"]);
    for (const [base, alternate] of [["RAD-020", "RAD-020A"], ["RAD-042", "RAD-042A"], ["RAD-112", "RAD-112A"], ["RAD-114", "RAD-114A"]]) {
      expect(card(base)?.name).toBe(card(alternate)?.name);
      expect(resolveBundledCardImage(base)).not.toBe(resolveBundledCardImage(alternate));
    }
  });

  it("uses verified October 10 print costs and keeps Seraphine's standard and alternate identities distinct", () => {
    const card = (id: string) => cards.find(c => c.printId === id);
    expect(card("RAD-009")).toMatchObject({ name: "Antagonistic Apparatus", type: "Unit", costEnergy: 6, costPower: 1 });
    expect(card("RAD-065")).toMatchObject({ name: "Seraphine, Inspiring", supertype: "Champion", champion: "Seraphine", costEnergy: 4, costPower: 1 });
    expect(card("RAD-123")).toMatchObject({ name: "Protector's Shield", type: "Gear", costEnergy: 2, costPower: 1 });
    expect(card("RAD-135")).toMatchObject({ name: "Remember the Fallen", type: "Spell", costEnergy: 8, costPower: 2 });
    expect(card("RAD-149")).toMatchObject({ name: "Riven, The Exile", type: "Legend", champion: "Riven" });
    expect(legendImageUrl("Riven")).toBe(card("RAD-149")?.imageUrl);
    expect(resolveBundledCardImage("RAD-065")).not.toBe(resolveBundledCardImage("RAD-065A"));
    expect(resolveCardArtwork("RAD-065", resolveBundledCardImage("RAD-065A"))).toBe(card("RAD-065")?.imageUrl);
  });

  it("recognises previous Chinese names and Atlas URLs after the English preview refresh", async () => {
    const resolver = new TcgaResolver(resolve("resources/tcga_card_lookup.json"));
    for (const [id, oldName, name] of [
      ["RAD-030", "圣所保管员", "Sanctum Conservator"],
      ["RAD-052", "资源开采器", "Resource Extractor"],
      ["RAD-077", "弗雷尔卓德之怒", "Wrath of the Freljord"],
      ["RAD-108", "伏击陷阱", "Bushwhack Trap"],
    ]) {
      const card = cards.find(c => c.printId === id);
      expect(card?.name).toBe(name);
      expect(card?.aliases).toContain(oldName);
      await expect(resolver.resolveCard(`https://assets.riftatlas-workers.com/riftbound/cards/original/${id}.webp`)).resolves.toBe(name);
    }
  });

  it("recognises stamped Atlas promo artwork under the existing printed collector identity", async () => {
    const resolver = new TcgaResolver(resolve("resources/tcga_card_lookup.json"));
    for (const promo of ["RAD-015C", "RAD-015P", "RAD-038C", "RAD-038P", "RAD-085P", "RAD-110P"]) {
      const base = promo.slice(0, -1), card = cards.find(c => c.printId === base);
      const url = `https://assets.riftatlas-workers.com/riftbound/cards/original/${promo}.webp`;
      expect(cards.some(c => c.printId === promo)).toBe(false);
      await expect(resolver.resolveCard(url)).resolves.toBe(card?.name);
      expect(resolveCardArtwork(base, url)).toBe(url);
    }
  });

  it("recognises preview images with no collector code in their filename", async () => {
    const resolver = new TcgaResolver(resolve("resources/tcga_card_lookup.json"));
    const promo = "https://cdn.piltoverarchive.com/temporary/1790379856360-1cbp857fr3y.jpg";
    await expect(resolver.resolveCard(`${promo}?width=400`)).resolves.toBe("Ahri, Confident");
    expect(resolveCardArtwork("RAD-038", promo)).toBe(promo);
    expect(resolveCardArtwork("RAD-023", promo)).not.toBe(promo);
  });
});
