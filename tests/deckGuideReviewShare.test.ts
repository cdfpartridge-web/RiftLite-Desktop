import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { emptyDeckMatchupGuide, normalizeDeckGuideReviewBaseline } from "../src/shared/deckNotebook";
import type { DeckMatchupGuide } from "../src/shared/types";

// Execute the real compact sharing boundary without starting Electron.
const text = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const source = ts.createSourceFile("main.ts", text, ts.ScriptTarget.Latest, true);
const names = new Set(["compactDeckGuide", "compactDeckGuideSection", "compactDeckGuideCard", "expandCompactDeckGuide", "expandCompactDeckSection", "plainText"]);
const declarations = source.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text));
if (declarations.length !== names.size) throw new Error("The deck sharing functions moved; update this integration harness.");
const code = ts.transpileModule(declarations.map((node) => node.getText(source)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;
const share = runInNewContext(`${code}\n({compactDeckGuide, expandCompactDeckGuide});`, {
  randomUUID, emptyDeckMatchupGuide, normalizeDeckGuideReviewBaseline
}, { timeout: 1_000 }) as {
  compactDeckGuide: (guide: DeckMatchupGuide) => unknown;
  expandCompactDeckGuide: (guide: unknown, legend: string) => DeckMatchupGuide;
};

describe("guide review compact sharing", () => {
  it("round-trips the baseline and stale reference notes through actual compact export/import", () => {
    const guide = emptyDeckMatchupGuide("Jax");
    guide.reviewBaseline = {
      version: 1, snapshotHash: "previous-exact-snapshot", reviewedAt: "2026-09-08T07:00:00.000Z",
      cards: [{ key: "rebuke", name: "Rebuke", mainDeck: 0, sideboard: 2, battlefields: 0 }]
    };
    guide.sideboard.in = { cards: [{ id: "old-card", cardKey: "rebuke", cardName: "Rebuke", qty: 2, note: "Keep this explanation", groupName: "Answers", groupNote: "Alternative to removal" }], note: "Plan before the deck changed" };
    const restored = share.expandCompactDeckGuide(JSON.parse(JSON.stringify(share.compactDeckGuide(guide))), "Jax");
    expect(restored.reviewBaseline).toEqual(guide.reviewBaseline);
    expect(restored.sideboard.in.note).toBe(guide.sideboard.in.note);
    expect(restored.sideboard.in.cards[0]).toMatchObject({ cardName: "Rebuke", qty: 2, note: "Keep this explanation", groupName: "Answers", groupNote: "Alternative to removal" });
  });

  it("continues accepting legacy compact guides without inventing a reviewed baseline", () => {
    const restored = share.expandCompactDeckGuide({ m: { k: { n: "Keep early pressure" } } }, "");
    expect(restored.reviewBaseline).toBeUndefined();
    expect(restored.mulligan.keep.note).toBe("Keep early pressure");
  });
});
