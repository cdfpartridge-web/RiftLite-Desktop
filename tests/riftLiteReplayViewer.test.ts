import { describe, expect, it } from "vitest";
import { resolveBundledReplayCardImage } from "../src/renderer/RiftLiteReplayViewer";

describe("RiftLiteReplayViewer card artwork", () => {
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
});
