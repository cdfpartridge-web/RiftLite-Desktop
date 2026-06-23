import { describe, expect, it } from "vitest";
import { buildVisionDeckTrackerObservations, emptyVisionDeckTrackerStatus } from "../src/shared/visionDeckTracker";
import type { SavedDeck, VisionRenderedCardObservation } from "../src/shared/types";

const deck: SavedDeck = {
  id: "deck-vision",
  sourceUrl: "local:text",
  sourceKey: "deck:vex",
  title: "Vex testing",
  legend: "Vex",
  snapshotJson: JSON.stringify({
    legendEntry: { qty: 1, name: "Vex", cardId: "SFD-001", imageUrl: "https://cards.test/SFD-001.webp" },
    mainDeck: [
      { qty: 3, name: "Watchful Sentry", cardId: "OGN-028", imageUrl: "https://cards.test/OGN-028.webp" },
      { qty: 2, name: "Thermo Beam", imageUrl: "https://cards.test/OGN-176.webp" },
      { qty: 1, name: "Long Sword", imageUrl: "https://cards.test/SFD-186.webp" }
    ],
    sideboard: [
      { qty: 2, name: "Rebuke", cardId: "OGN-172", imageUrl: "https://cards.test/OGN-172.webp" }
    ],
    battlefields: [{ qty: 1, name: "Zaun Warrens", cardId: "OGN-298" }]
  }),
  lastImportedAt: "2026-05-25T10:00:00.000Z",
  lastRefreshStatus: "ok",
  lastRefreshError: ""
};

function rendered(patch: Partial<VisionRenderedCardObservation>): VisionRenderedCardObservation {
  return {
    name: patch.name ?? "",
    code: patch.code ?? "",
    cardId: patch.cardId ?? "",
    imageUrl: patch.imageUrl ?? "",
    zone: patch.zone ?? "hand",
    platform: patch.platform ?? "tcga",
    confidenceScore: patch.confidenceScore ?? 0.94,
    zoneRect: patch.zoneRect ?? { x: 10, y: 20, width: 80, height: 120 }
  };
}

describe("vision deck tracker", () => {
  it("matches high-confidence visible cards from the active deck", () => {
    const result = buildVisionDeckTrackerObservations(
      deck,
      "tcga",
      [rendered({ imageUrl: "https://cdn.test/cards/OGN-028-full.webp", zone: "hand" })],
      "2026-05-25T10:01:00.000Z",
      "frame-1"
    );

    expect(result.observations).toHaveLength(1);
    expect(result.suggestions).toHaveLength(0);
    expect(result.observations[0]).toMatchObject({
      name: "Watchful Sentry",
      source: "vision",
      frameId: "frame-1",
      zone: "hand",
      confidence: "tracked"
    });
  });

  it("turns medium-confidence partial name matches into suggestions", () => {
    const result = buildVisionDeckTrackerObservations(
      deck,
      "atlas",
      [rendered({ name: "Watchful", confidenceScore: 0.8 })],
      "2026-05-25T10:02:00.000Z",
      "frame-2"
    );

    expect(result.observations).toHaveLength(0);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      name: "Watchful Sentry",
      platform: "atlas",
      frameId: "frame-2"
    });
  });

  it("ignores cards outside the active main deck", () => {
    const result = buildVisionDeckTrackerObservations(
      deck,
      "tcga",
      [
        rendered({ cardId: "OGN-172", name: "Rebuke" }),
        rendered({ cardId: "OGN-999", name: "Not In Deck" })
      ],
      "2026-05-25T10:03:00.000Z",
      "frame-3"
    );

    expect(result.observations).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
  });

  it("recognises the legend without subtracting it from the deck", () => {
    const result = buildVisionDeckTrackerObservations(
      deck,
      "tcga",
      [rendered({ cardId: "SFD-001", name: "Vex", zone: "board" })],
      "2026-05-25T10:03:30.000Z",
      "frame-legend"
    );

    expect(result.observations).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
    expect(result.ignoredMatches).toEqual([
      expect.objectContaining({ name: "Vex", role: "legend" })
    ]);
    expect(result.message).toContain("legend");
  });

  it("returns a safe waiting message when no active deck exists", () => {
    const result = buildVisionDeckTrackerObservations(
      null,
      "tcga",
      [rendered({ cardId: "OGN-028" })],
      "2026-05-25T10:04:00.000Z",
      "frame-4"
    );

    expect(result.observations).toEqual([]);
    expect(result.message).toContain("Set an active deck");
  });

  it("builds disabled status by default for the opt-in beta", () => {
    expect(emptyVisionDeckTrackerStatus(false, "none")).toMatchObject({
      enabled: false,
      active: false,
      state: "disabled"
    });
  });
});
