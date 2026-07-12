import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TcgaResolver } from "../src/main/services/tcgaResolver";

describe("TcgaResolver", () => {
  it("resolves Vendetta legends from TCGA Riot image hashes", async () => {
    const resolver = new TcgaResolver(resolve(process.cwd(), "resources/tcga_card_lookup.json"));

    await expect(resolver.resolveLegend("https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0d53b477ed43fb9bbed84858443a606b2b51a2b5-744x1039.png?accountingTag=RB&auto=format&fit=fill&q=80&w=444")).resolves.toBe("Akali");
    await expect(resolver.resolveLegend("https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0eab83392b310417d2630d50a3bfee3dd02b31c4-744x1039.png?accountingTag=RB&auto=format&fit=fill&q=80&w=444")).resolves.toBe("Kennen");
  });
});
