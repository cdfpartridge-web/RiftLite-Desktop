import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import registry from "../resources/riftbound_card_registry.json";
import { generatedLegendPrintsSource } from "../scripts/generate-legend-prints.mjs";
import { LEGEND_PRINTS } from "../src/shared/generatedLegendPrints";
import { parseAtlasDeckTrackerFrame } from "../src/shared/atlasEventDeckTracker";
import { legendFromImageUrl } from "../src/shared/legendImages";
import { canonicalLegendName } from "../src/shared/legendNames";

describe("legend print image identification", () => {
  it("keeps the lightweight preload lookup synchronized with every packaged legend print and source alias", () => {
    expect(readFileSync(new URL("../src/shared/generatedLegendPrints.ts", import.meta.url), "utf8"))
      .toBe(generatedLegendPrintsSource(registry));
  });

  it("identifies every base, alternate and signed legend from its exact image URL, hash and collector code", () => {
    for (const [printId, name, urls, hashes] of LEGEND_PRINTS) {
      const legend = canonicalLegendName(name);
      expect(legend, printId).not.toBe("");
      for (const value of [printId, ...urls, ...hashes]) {
        expect(legendFromImageUrl(value), `${printId}: ${value}`).toBe(legend);
      }
      for (const url of urls) {
        expect(legendFromImageUrl(`${url}${url.includes("?") ? "&" : "?"}width=400`), printId).toBe(legend);
        expect(legendFromImageUrl(encodeURIComponent(url)), printId).toBe(legend);
      }
      if (printId.endsWith("*")) {
        for (const suffix of ["S", "-star", "%2A"]) {
          expect(legendFromImageUrl(`https://cards.example/${printId.slice(0, -1)}${suffix}.webp`), printId).toBe(legend);
        }
      }
    }
  });

  it("retains the distinct Wuju Bladesman and Wuju Master gameplay identities", () => {
    expect(legendFromImageUrl("OGS-019")).toBe("Master Yi, Wuju Bladesman");
    expect(legendFromImageUrl("UNL-191")).toBe("Master Yi, Wuju Master");
    expect(legendFromImageUrl("UNL-231S")).toBe("Master Yi, Wuju Master");
  });

  it("recognizes an opponent from alternate legend artwork in an Atlas room without a name or code", () => {
    const art = registry.cards.find(card => card.printId === "RAD-168*")!.imageUrl;
    const result = parseAtlasDeckTrackerFrame({
      platform: "atlas",
      frame: {
        seq: 1, ts: 1791198000000, dir: "in", socketId: "legend-test",
        raw: JSON.stringify({
          type: "room_shell_sync",
          sessionDoc: {
            viewer: { role: "player", playerId: "local" },
            players: [{ id: "local" }, { id: "opponent", legend: { imageUrl: art } }],
          },
        }),
      },
    });
    expect(result.opponentLegend).toBe("Ekko");
  });

  it("does not treat champion units or unknown artwork as a legend", () => {
    const championUnit = registry.cards.find(card => card.printId === "RAD-015")!;
    expect(legendFromImageUrl(championUnit.imageUrl)).toBe("");
    expect(legendFromImageUrl(championUnit.printId)).toBe("");
    expect(legendFromImageUrl("https://cdn.piltoverarchive.com/temporary/unknown-legend.webp")).toBe("");
  });
});
