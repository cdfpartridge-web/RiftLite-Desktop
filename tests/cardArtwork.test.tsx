import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import cardRegistryData from "../resources/riftbound_card_registry.json";
import { CardArtworkImage } from "../src/renderer/CardArtworkImage";
import { resolveBundledCardImage, resolveCardArtwork, resolveDeckCardArtwork } from "../src/renderer/cardArtwork";
import { mainDeckTrackerCards, observationCountsForDeck } from "../src/shared/deckTracker";
import type { DeckTrackerObservation, SavedDeck } from "../src/shared/types";

const images = new Map([
  ["VEN-189", "base.webp"],
  ["VEN-189*", "signed.webp"],
  ["UNL-089", "base-unit.webp"],
  ["UNL-089A", "alternate-unit.webp"],
  ["OGN-089", "canonical-rune.webp"]
]);

describe("card artwork presentation", () => {
  it.each(["VEN-189*", "VEN-189-star", "VEN-189%2A", "VEN-189S", "ven-189s", "VEN-189*/180"])(
    "uses the registered signed image for %s ahead of an imported base image",
    (code) => {
      expect(resolveCardArtwork(code, "imported-base.webp", images)).toBe("signed.webp");
      expect(resolveBundledCardImage(code, images)).toBe("signed.webp");
    }
  );

  it("honours a literal exact S print before the signed compatibility spelling", () => {
    const literalImages = new Map([...images, ["VEN-189S", "literal-s.webp"]]);
    expect(resolveCardArtwork("VEN-189S", "captured.webp", literalImages)).toBe("literal-s.webp");
  });

  it("does not invent an S-to-signed image when no signed row exists", () => {
    const baseOnly = new Map([["VEN-189", "base.webp"]]);
    expect(resolveCardArtwork("VEN-189S", "captured-s.webp", baseOnly)).toBe("captured-s.webp");
    expect(resolveBundledCardImage("VEN-189S", baseOnly)).toBe("base.webp");
    expect(resolveBundledCardImage("VEN-190S", baseOnly)).toBe("");
  });

  it("preserves a source image when the exact print is absent, before unsigned or rune fallback", () => {
    expect(resolveCardArtwork("VEN-189*", "captured-signed.webp", new Map([["VEN-189", "base.webp"]])))
      .toBe("captured-signed.webp");
    expect(resolveCardArtwork("UNL-R03A", "captured-rune.webp", images)).toBe("captured-rune.webp");
    expect(resolveCardArtwork("UNL-R03A", "", images)).toBe("canonical-rune.webp");
  });

  it("preserves alternate and ordinary base prints without alias-map collisions", () => {
    expect(resolveCardArtwork("UNL-089A", "", images)).toBe("alternate-unit.webp");
    expect(resolveCardArtwork("UNL-089", "", images)).toBe("base-unit.webp");
    expect(resolveCardArtwork("VEN-189", "", images)).toBe("base.webp");
  });

  it("resolves a collector code supplied only by an image URL and keeps unknown source images", () => {
    expect(resolveCardArtwork("", "https://cards.test/VEN-189S.webp", images)).toBe("signed.webp");
    expect(resolveCardArtwork("", "https://cards.test/unknown-image.png", images)).toBe("https://cards.test/unknown-image.png");
    expect(resolveCardArtwork("bad-code", "", images)).toBe("");
  });

  it("uses actual packaged alternate artwork for tracker cards without changing their identity or counts", () => {
    const deck: SavedDeck = {
      id: "art-deck", sourceUrl: "", sourceKey: "", title: "Print test", legend: "Jhin",
      snapshotJson: JSON.stringify({ mainDeck: [{ qty: 2, name: "Jhin, Meticulous Killer", cardId: "UNL-089A" }] }),
      lastImportedAt: "", lastRefreshStatus: "ok", lastRefreshError: ""
    };
    const cards = mainDeckTrackerCards(deck);
    const before = structuredClone(cards);
    const observation: DeckTrackerObservation = {
      cardKey: "", name: "", code: "UNL-089", cardId: "", imageUrl: "", zone: "hand",
      count: 1, platform: "atlas", confidence: "tracked", capturedAt: "2026-09-05T08:00:00.000Z"
    };
    const expectedImage = cardRegistryData.cards.find((card) => card.printId === "UNL-089A")!.imageUrl;
    expect(resolveDeckCardArtwork(cards[0])).toBe(expectedImage);
    const markup = renderToStaticMarkup(<CardArtworkImage card={cards[0]} alt="Jhin" loading="lazy" fallback={<span>No image</span>} />);
    expect(markup).toContain(`src="${expectedImage}"`);
    expect(markup).toContain('alt="Jhin"');
    expect(markup).toContain('loading="lazy"');
    expect(observationCountsForDeck([observation], cards).counts.get(cards[0].cardKey)).toBe(1);
    expect(cards).toEqual(before);
  });

  it("renders signed notebook/prep references using the packaged print instead of their old base image", () => {
    const card = Object.freeze({ cardId: "UNL-226S", imageUrl: "https://cdn.piltoverarchive.com/cards/UNL-226.webp" });
    const signed = cardRegistryData.cards.find((entry) => entry.printId === "UNL-226*")!.imageUrl;
    expect(renderToStaticMarkup(<CardArtworkImage card={card} alt="" draggable={false} fallback={<span>No image</span>} />))
      .toContain(`src="${signed}"`);
    expect(card.imageUrl).toBe("https://cdn.piltoverarchive.com/cards/UNL-226.webp");
  });

  it("preserves an explicitly selected imported image even when the import has a base card ID", () => {
    const alternate = "https://cdn.piltoverarchive.com/cards/UNL-089A.webp";
    expect(resolveDeckCardArtwork({ cardId: "UNL-089", imageUrl: alternate })).toBe(alternate);
    const custom = "https://cards.test/selected-alternate.png";
    expect(resolveDeckCardArtwork({ cardId: "UNL-089", imageUrl: custom })).toBe(custom);
  });

  it("preserves registered alternate-image aliases with capture sizing parameters", () => {
    const promo = "https://cdn.piltoverarchive.com/temporary/1790379856360-1cbp857fr3y.jpg?width=400&quality=85#card";
    expect(resolveCardArtwork("RAD-038", promo)).toBe(promo);
    // An image alias never authorizes substituting another card's artwork.
    expect(resolveCardArtwork("RAD-023", promo)).not.toBe(promo);
  });

  it("allows a valid code to supply missing art when the card ID is an opaque provider ID", () => {
    const signed = cardRegistryData.cards.find((entry) => entry.printId === "UNL-226*")!.imageUrl;
    expect(resolveDeckCardArtwork({ cardId: "d5f17dc1-3cc1-478c-8c83-fdc081e2b377", code: "UNL-226S" }))
      .toBe(signed);
  });

  it("retains the existing canonical CDN and placeholder fallbacks when no image is available", () => {
    expect(resolveDeckCardArtwork({ cardId: "ZZZ-001A" })).toBe("https://cdn.piltoverarchive.com/cards/ZZZ-001.webp");
    expect(renderToStaticMarkup(<CardArtworkImage card={{}} alt="" fallback={<span className="existing-placeholder">?</span>} />))
      .toBe('<span class="existing-placeholder">?</span>');
  });
});
