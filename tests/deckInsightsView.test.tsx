import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  copyDeckInsightSummary,
  deckInsightStageScopeLabel,
  DeckInsightsView,
  effectiveDeckInsightGameStage
} from "../src/renderer/DeckInsightsView";
import type { SavedDeck } from "../src/shared/types";

const deck: SavedDeck = {
  id: "deck-1",
  sourceUrl: "",
  sourceKey: "local:deck-1",
  title: "Akali Tempo",
  legend: "Akali",
  snapshotJson: JSON.stringify({
    title: "Akali Tempo",
    legend: "Akali",
    mainDeck: [
      { qty: 3, name: "Discipline", cardId: "OGS-175" },
      { qty: 3, name: "Charm", cardId: "OGS-176" }
    ],
    sideboard: [{ qty: 2, name: "Disarming Rake", cardId: "OGS-177" }],
    battlefields: [{ qty: 1, name: "Back-Alley Bar", cardId: "OGS-178" }]
  }),
  lastImportedAt: "2026-08-29T10:00:00.000Z",
  lastRefreshStatus: "ok",
  lastRefreshError: ""
};

describe("DeckInsightsView", () => {
  it("copies reports through the trusted Electron clipboard bridge", async () => {
    const bridge = { writeClipboardText: vi.fn(async () => true) };

    await expect(copyDeckInsightSummary("Deck report", bridge)).resolves.toBe(true);
    expect(bridge.writeClipboardText).toHaveBeenCalledWith("Deck report");
  });

  it("reports bridge refusal and rejection as copy failures", async () => {
    const refusedBridge = { writeClipboardText: vi.fn(async () => false) };
    await expect(copyDeckInsightSummary("Deck report", refusedBridge)).resolves.toBe(false);

    const rejectedBridge = { writeClipboardText: vi.fn(async () => { throw new Error("IPC unavailable"); }) };
    await expect(copyDeckInsightSummary("Deck report", rejectedBridge)).resolves.toBe(false);
  });

  it("limits game-stage filtering to Card Review and disables stage claims for combined evidence", () => {
    expect(effectiveDeckInsightGameStage("cards", "postboard", false)).toBe("postboard");
    expect(effectiveDeckInsightGameStage("overview", "postboard", false)).toBe("all");
    expect(effectiveDeckInsightGameStage("matchups", "preboard", false)).toBe("all");
    expect(effectiveDeckInsightGameStage("cards", "preboard", true)).toBe("all");
    expect(deckInsightStageScopeLabel("preboard", false)).toBe("Game 1 only");
    expect(deckInsightStageScopeLabel("postboard", false)).toBe("Post-board only");
    expect(deckInsightStageScopeLabel("all", true)).toBe("All games, stage unverified");
  });

  it("renders a visual overview with progressive Deck Insights sections and honest empty evidence", () => {
    const markup = renderToStaticMarkup(
      <DeckInsightsView
        decks={[deck]}
        matches={[]}
        replays={[]}
        activeDeckId={deck.id}
        onNavigate={() => undefined}
        onOpenReplay={() => undefined}
      />
    );

    expect(markup).toContain("Visual deck report");
    expect(markup).toContain("Deck Insights sections");
    expect(markup).toContain("Overview");
    expect(markup).toContain("Card review");
    expect(markup).toContain("Matchups");
    expect(markup).toContain("Energy curve");
    expect(markup).toContain("Card types");
    expect(markup).toContain("Recent form");
    expect(markup).toContain("No completed matches in this scope");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain("What your cards actually do in games");
  });

  it("offers a clear deck-library action when no deck has been imported", () => {
    const markup = renderToStaticMarkup(
      <DeckInsightsView
        decks={[]}
        matches={[]}
        replays={[]}
        activeDeckId=""
        onNavigate={() => undefined}
        onOpenReplay={() => undefined}
      />
    );

    expect(markup).toContain("Add a deck to unlock Deck Insights");
    expect(markup).toContain("Open deck library");
  });
});
