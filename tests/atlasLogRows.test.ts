import { describe, expect, it } from "vitest";
import { isAtlasGameLogText } from "../src/shared/atlasLogRows";

describe("Atlas game-log row text", () => {
  it.each([
    "", "  ", "Play Riftbound online with private room codes…", "13:37 Play Riftbound online with private room codes…",
    "Earlier activity…", "Earlier activity...", "13:37 Earlier activity (50 entries)", "↻ Earlier   activity…",
    "Bob at 13:37: hello",
  ])("rejects non-action text: %s", (text) => {
    expect(isAtlasGameLogText(text)).toBe(false);
  });

  it.each([
    "13:37 Paid 1 Energy.", "Turn 17 • Rereta", "Conceded. Rereta wins.", "13:36 Moved Qiyana, Victorious to trash.",
    "A new action type with no recognised verb.", "Played a card after earlier activity.",
  ])("preserves action text without a verb allowlist: %s", (text) => {
    expect(isAtlasGameLogText(text)).toBe(true);
  });
});
