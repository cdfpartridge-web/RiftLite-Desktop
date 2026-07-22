import { describe, expect, it } from "vitest";
import {
  dedupeCards,
  mergeRegistryOverlay,
  normalizePrintId,
  normalizeSourceCard,
  validateRegistry,
} from "../scripts/riftbound-registry-lib.mjs";

function sourceCard(overrides: Record<string, unknown> = {}) {
  return {
    id: "source-1",
    name: "Defender of Tomorrow",
    riftbound_id: "ven-194-166",
    classification: { type: "Legend", supertype: null },
    set: { set_id: "VEN", label: "Vendetta" },
    media: {
      image_url: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/f527eb9b02ce62d808ec82e12ac28af5a6bd75fb-744x1039.png?accountingTag=RB",
      artist: "Artist",
    },
    tags: ["Jayce"],
    metadata: {
      alternate_art: false,
      overnumbered: false,
      signature: false,
      updated_on: "2026-07-14T21:35:28.184407+00:00",
    },
    ...overrides,
  };
}

describe("RiftCodex registry generator", () => {
  it("preserves signed, art-suffix, rune, token, and promo print identities", () => {
    expect(normalizePrintId("unl-226*-219")).toMatchObject({
      printId: "UNL-226*",
      basePrintId: "UNL-226",
      signature: true,
    });
    expect(normalizePrintId("ogn-089a-298")).toMatchObject({
      printId: "OGN-089A",
      basePrintId: "OGN-089",
      alternateArtSuffix: "A",
    });
    expect(normalizePrintId("abc-12b-999").printId).toBe("ABC-012B");
    expect(normalizePrintId("ven-r1").printId).toBe("VEN-R01");
    expect(normalizePrintId("sfd-t3").printId).toBe("SFD-T03");
    expect(normalizePrintId("ven-sp1-006").printId).toBe("VEN-SP1");
  });

  it("derives a canonical legend identity and overnumber status from the print id", () => {
    const normalized = normalizeSourceCard(sourceCard(), "VEN");
    expect(normalized).toMatchObject({
      printId: "VEN-194",
      basePrintId: "VEN-194",
      name: "Jayce, Defender of Tomorrow",
      champion: "Jayce",
      imageHash: "f527eb9b02ce62d808ec82e12ac28af5a6bd75fb",
      variants: {
        alternateArt: false,
        overnumbered: true,
        signature: false,
      },
    });
  });

  it("retains champion identity on alternate-art Champion units", () => {
    const normalized = normalizeSourceCard(sourceCard({
      name: "Jhin - Meticulous Killer (Alternate Art)",
      riftbound_id: "unl-089a-219",
      classification: { type: "Unit", supertype: "Champion" },
      set: { set_id: "UNL", label: "Unleashed" },
      tags: ["Jhin", "Ionia"],
      metadata: {
        alternate_art: true,
        overnumbered: false,
        signature: false,
        updated_on: "2026-07-10T22:45:00Z",
      },
    }), "UNL");

    expect(normalized).toMatchObject({
      printId: "UNL-089A",
      name: "Jhin, Meticulous Killer",
      supertype: "Champion",
      champion: "Jhin",
      variants: { alternateArt: true },
    });
  });

  it("deduplicates repeated source rows without losing aliases or source ids", () => {
    const first = normalizeSourceCard(sourceCard(), "VEN");
    const second = normalizeSourceCard(sourceCard({
      id: "source-2",
      name: "Jayce - Defender of Tomorrow",
      metadata: {
        alternate_art: false,
        overnumbered: true,
        signature: false,
        updated_on: "2026-07-17T20:38:11.320231+00:00",
      },
    }), "VEN");

    const result = dedupeCards([first, second]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Jayce, Defender of Tomorrow");
    expect(result[0].sourceIds).toEqual(["source-1", "source-2"]);
    expect(result[0].variants.overnumbered).toBe(true);
  });

  it("fails closed when one complete print id points at two different images", () => {
    const first = normalizeSourceCard(sourceCard(), "VEN");
    const second = {
      ...first,
      imageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-744x1039.png",
      imageHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    expect(() => dedupeCards([first, second])).toThrow(/multiple images/i);
  });

  it("keeps observed TCGA alternate artwork hashes attached to their exact print", () => {
    const card = normalizeSourceCard(sourceCard({
      name: "Risen Altar",
      riftbound_id: "ven-163-166",
      classification: { type: "Battlefield", supertype: null },
    }), "VEN");
    const alternateHash = "e41bc5d29f91f652d553bef56e2c84e95010ef1a";
    const merged = mergeRegistryOverlay([card], {
      imageHashAliasesByPrintId: { "VEN-163": [alternateHash] },
    });

    expect(merged.cards[0].imageHashAliases).toEqual([alternateHash]);
    expect(validateRegistry(merged.cards).uniqueImageHashes).toBe(2);
  });

  it("enforces required codes and per-set count floors", () => {
    const card = normalizeSourceCard(sourceCard(), "VEN");
    expect(validateRegistry([card], {
      sets: {
        VEN: {
          minUniquePrints: 1,
          minTypeCounts: { Legend: 1 },
          minVariantCounts: { overnumbered: 1 },
          requiredPrintIds: ["VEN-194"],
        },
      },
    })).toMatchObject({ uniquePrints: 1, bySet: { VEN: 1 } });

    expect(() => validateRegistry([card], {
      sets: { VEN: { minUniquePrints: 2, requiredPrintIds: ["VEN-195"] } },
    })).toThrow(/VEN has 1 unique prints[\s\S]*VEN-195/i);
  });
});
