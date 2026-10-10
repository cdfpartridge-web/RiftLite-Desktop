import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveBundledReplayCardImage, RiftLiteReplayViewer } from "../src/renderer/RiftLiteReplayViewer";
import type { RiftLiteReplayCard, RiftLiteReplayModel, RiftLiteReplayPlayer } from "../src/shared/riftLiteReplayEngine";

function modelForCard(patch: Partial<RiftLiteReplayCard>): RiftLiteReplayModel {
  const card: RiftLiteReplayCard = {
    id: "card-1", key: "card-1", name: "Jhin, Virtuoso", code: "", imageUrl: "",
    zone: "hand", ownerId: "local", side: "local", ...patch
  };
  const local: RiftLiteReplayPlayer = {
    id: "local", name: "Player", side: "local", score: 0,
    zones: { hand: { id: "hand", label: "Hand", cards: [card] } }
  };
  const opponent: RiftLiteReplayPlayer = { id: "opponent", name: "Opponent", side: "opponent", score: 0, zones: {} };
  return {
    id: "replay-1", title: "Artwork test", messageCount: 1, diagnostics: [], events: [], players: [local, opponent],
    frames: [{ id: "frame-1", index: 0, stage: "openingHands", label: "Opening hand", local, opponent, chain: [], events: [] }]
  };
}

describe("RiftLiteReplayViewer card artwork", () => {
  it("resolves historical Chinese names to their current English card artwork", () => {
    for (const [name, code] of [["圣所保管员", "RAD-030"], ["资源开采器", "RAD-052"], ["弗雷尔卓德之怒", "RAD-077"], ["伏击陷阱", "RAD-108"]]) {
      const markup = renderToStaticMarkup(createElement(RiftLiteReplayViewer, { model: modelForCard({ name }) }));
      expect(markup).toContain(`src="${resolveBundledReplayCardImage(code)}"`);
    }
    for (const name of ["未知卡牌", "?!"]) {
      const markup = renderToStaticMarkup(createElement(RiftLiteReplayViewer, { model: modelForCard({ name }) }));
      for (const code of ["RAD-030", "RAD-052", "RAD-077", "RAD-108"]) {
        expect(markup).not.toContain(`src="${resolveBundledReplayCardImage(code)}"`);
      }
    }
  });

  it("uses canonical artwork for set-specific Rune identities", () => {
    const images = new Map([
      ["OGN-089", "mind-rune.webp"],
      ["OGN-214", "order-rune.webp"]
    ]);

    expect(resolveBundledReplayCardImage("UNL-R03A", images)).toBe("mind-rune.webp");
    expect(resolveBundledReplayCardImage("SFD-R06B", images)).toBe("order-rune.webp");
  });

  it("preserves an exact signed or variant image before using canonical art", () => {
    const images = new Map([
      ["UNL-R03A*", "signed-mind-rune.webp"],
      ["UNL-R03A", "variant-mind-rune.webp"],
      ["OGN-089", "canonical-mind-rune.webp"]
    ]);

    expect(resolveBundledReplayCardImage("UNL-R03A-star", images)).toBe("signed-mind-rune.webp");
    expect(resolveBundledReplayCardImage("UNL-R03A", images)).toBe("variant-mind-rune.webp");
  });

  it("does not map unrelated collector-code types onto Rune art", () => {
    const images = new Map([
      ["OGN-089", "mind-rune.webp"],
      ["OGN-214", "order-rune.webp"]
    ]);

    expect(resolveBundledReplayCardImage("UNL-089A", images)).toBe("");
    expect(resolveBundledReplayCardImage("SFD-006B", images)).toBe("");
  });

  it("renders the exact signed printing for Atlas S codes, ahead of a captured base image", () => {
    const signed = resolveBundledReplayCardImage("UNL-226*");
    const base = resolveBundledReplayCardImage("UNL-226");
    expect(signed).not.toBe(base);
    const markup = renderToStaticMarkup(createElement(RiftLiteReplayViewer, {
      model: modelForCard({ code: "UNL-226S", imageUrl: base })
    }));
    expect(markup).toContain(`src="${signed}"`);
    expect(markup).not.toContain(`src="${base}"`);
  });

  it("renders captured artwork when only a different bundled printing exists", () => {
    const base = resolveBundledReplayCardImage("UNL-226");
    expect(resolveBundledReplayCardImage("UNL-226B")).toBe(base);
    const source = "https://cards.test/UNL-226B.webp";
    const markup = renderToStaticMarkup(createElement(RiftLiteReplayViewer, {
      model: modelForCard({ code: "UNL-226B", imageUrl: source })
    }));
    expect(markup).toContain(`src="${source}"`);
    expect(markup).not.toContain(`src="${base}"`);
  });

  it("does not use a name-only base match to override a captured image", () => {
    const source = "https://cards.test/custom-signed-image.png";
    const markup = renderToStaticMarkup(createElement(RiftLiteReplayViewer, {
      model: modelForCard({ imageUrl: source })
    }));
    expect(markup).toContain(`src="${source}"`);
  });
});
