import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DeckShareCard,
  DeckShareCardDialog,
  deckShareArtSources,
  deckShareCaption,
  type DeckShareCardViewModel
} from "../src/renderer/DeckShareCard";

function deck(overrides: Partial<DeckShareCardViewModel> = {}): DeckShareCardViewModel {
  return {
    deckTitle: "Wuju Tempo",
    legend: "Master Yi, Wuju Bladesman",
    sourceLabel: "Active deck",
    totalGames: 12,
    decisiveGames: 12,
    winRateLabel: "67%",
    record: "8-4",
    artSources: [
      "https://example.com/master-yi.png",
      "https://example.com/highlander.png",
      "https://example.com/tempered.png",
      "https://example.com/discipline.png"
    ],
    ...overrides
  };
}

describe("deck share card", () => {
  it("builds the requested social caption with correct plural grammar", () => {
    expect(deckShareCaption(deck())).toBe(
      "I'm currently playing Master Yi, Wuju Bladesman and my win rate is 67% after 12 games. Track all of this on RiftLite.com"
    );
    expect(deckShareCaption(deck({ totalGames: 1, decisiveGames: 1, winRateLabel: "100%", record: "1-0" }))).toContain(
      "100% after 1 game."
    );
  });

  it("does not invent a win rate before there is a decisive result", () => {
    expect(deckShareCaption(deck({ totalGames: 1, decisiveGames: 0, winRateLabel: "0%", record: "0-0-1" }))).toBe(
      "I'm currently playing Master Yi, Wuju Bladesman and I've recorded 1 game so far. Track all of this on RiftLite.com"
    );
    expect(deckShareCaption(deck({ totalGames: 0, decisiveGames: 0, winRateLabel: "No data", record: "0-0" }))).toBe(
      "I'm currently playing Master Yi, Wuju Bladesman and tracking my games with RiftLite. Track all of this on RiftLite.com"
    );
  });

  it("deduplicates and bounds the official artwork set", () => {
    expect(deckShareArtSources([
      " https://example.com/legend.png ",
      "https://example.com/legend.png",
      "",
      "https://example.com/card-a.png",
      "https://example.com/card-b.png",
      "https://example.com/card-c.png",
      "https://example.com/card-d.png"
    ])).toEqual([
      "https://example.com/legend.png",
      "https://example.com/card-a.png",
      "https://example.com/card-b.png",
      "https://example.com/card-c.png"
    ]);
    expect(deckShareArtSources([
      "https://example.com/legend.png",
      "https://example.com/card-a.png",
      "https://example.com/card-b.png",
      "https://example.com/card-c.png",
      "https://example.com/card-d.png"
    ], new Set(["https://example.com/legend.png"]))).toEqual([
      "https://example.com/card-a.png",
      "https://example.com/card-b.png",
      "https://example.com/card-c.png",
      "https://example.com/card-d.png"
    ]);
    const sharedHash = "a".repeat(40);
    expect(deckShareArtSources([
      `https://cdn-a.test/${sharedHash}-744x1039.png?size=small`,
      `https://cdn-b.test/${sharedHash}-744x1039.png?size=large`,
      "https://example.com/distinct.png"
    ])).toEqual([
      `https://cdn-a.test/${sharedHash}-744x1039.png?size=small`,
      "https://example.com/distinct.png"
    ]);
  });

  it("renders a fixed social graphic with a layered official-art composition", () => {
    const markup = renderToStaticMarkup(<DeckShareCard deck={deck()} />);

    expect(markup).toContain('data-share-size="1200x675"');
    expect(markup).toContain("I&#x27;m currently playing");
    expect(markup).toContain("Master Yi, Wuju Bladesman");
    expect(markup).toContain("67%");
    expect(markup).toContain("12");
    expect(markup).toContain("RiftLite.com");
    expect(markup).toContain("https://example.com/master-yi.png");
    expect(markup).toContain("https://example.com/highlander.png");
    expect(markup).toContain("https://example.com/tempered.png");
    expect(markup).toContain("https://example.com/discipline.png");
    expect(markup).toContain('data-art-count="4"');
    expect(markup).toContain('data-art-slot="hero"');
    expect(markup).toContain('data-art-slot="left"');
    expect(markup).toContain('data-art-slot="right"');
    expect(markup).toContain("4 artworks featured");
    expect(markup).not.toContain("<button");
  });

  it("keeps a deliberate hero treatment when only one artwork is available", () => {
    const markup = renderToStaticMarkup(<DeckShareCard deck={deck({ artSources: ["https://example.com/legend.png"] })} />);

    expect(markup).toContain('data-art-count="1"');
    expect(markup).toContain('data-art-slot="hero"');
    expect(markup).not.toContain('data-art-slot="left"');
    expect(markup).not.toContain('data-art-slot="right"');
    expect(markup).toContain("1 artwork featured");
  });

  it("renders the legend initials when no artwork can be resolved", () => {
    const markup = renderToStaticMarkup(<DeckShareCard deck={deck({ artSources: [] })} />);

    expect(markup).toContain('data-art-count="0"');
    expect(markup).toContain('data-art-slot="fallback"');
    expect(markup).toContain(">MY</span>");
    expect(markup).toContain("Deck identity");
    expect(markup).not.toContain("deck-share-card__art-backdrop");
  });

  it("offers local image, PNG, and post-text actions in an accessible preview", () => {
    const markup = renderToStaticMarkup(<DeckShareCardDialog deck={deck()} onClose={() => undefined} />);

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Deck card preview");
    expect(markup).toContain("Copy post text");
    expect(markup).toContain("Save PNG");
    expect(markup).toContain("Copy image");
    expect(markup).toContain("rendered and saved locally");
  });
});
