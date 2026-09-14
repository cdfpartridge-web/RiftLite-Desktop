import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as generatedBattlefields from "../src/shared/generatedBattlefields";
import type { CaptureEvent, MatchDraft, MatchGame } from "../src/shared/types";

// Exercise the real review reconstruction without mounting the desktop app.
// Only its referenced top-level declarations are transpiled; imported token
// predicates remain the real shared functions, rather than test substitutes.
function loadReviewGamesFromEvidence(): (draft: Pick<MatchDraft, "rawEvidence">) => MatchGame[] {
  const text = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map<string, ts.Statement>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, statement);
      }
    }
  }
  const included = new Set<ts.Statement>();
  function include(name: string): void {
    const declaration = declarations.get(name);
    if (!declaration || included.has(declaration)) return;
    included.add(declaration);
    function visit(node: ts.Node): void {
      if (ts.isIdentifier(node)) include(node.text);
      ts.forEachChild(node, visit);
    }
    visit(declaration);
  }
  include("reviewGamesFromEvidence");
  const code = source.statements.filter((statement) => included.has(statement))
    .map((statement) => statement.getText(source)).join("\n");
  const compiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  return runInNewContext(`${compiled}\nreviewGamesFromEvidence;`, { ...generatedBattlefields }, { timeout: 1_000 });
}

const reviewGamesFromEvidence = loadReviewGamesFromEvidence();
const brushImage = "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/fad09d6bd9bf38e376f430ecb0b400762420d061-1039x744.png?w=744";
const myFieldImage = "https://example.test/cards/OGN-268.png";
const opponentFieldImage = "https://example.test/cards/OGN-269.png";

function event(index: number, payload: Record<string, unknown>, kind: CaptureEvent["kind"] = "match-snapshot"): CaptureEvent {
  return {
    id: `event-${index}`,
    platform: "tcga",
    kind,
    capturedAt: new Date(Date.UTC(2026, 8, 7, 12, index)).toISOString(),
    url: "https://tcg-arena.fr/play",
    payload
  };
}

describe("review battlefield reconstruction", () => {
  it("keeps the original battlefields and one game when Brush appears before the ending score", () => {
    const games = reviewGamesFromEvidence({ rawEvidence: [
      event(0, {
        myBattlefield: "Grand Plaza", opponentBattlefield: "Reaver's Row",
        myBattlefieldImage: myFieldImage, opponentBattlefieldImage: opponentFieldImage,
        score: { me: 2, opp: 1 }
      }, "match-start"),
      event(1, {
        myBattlefield: "Brush", myBattlefieldImage: brushImage,
        battlefieldCandidates: [{ side: "opponent", text: "Tap", code: "UNL-T03", image: "https://example.test/token.png" }],
        score: { me: 4, opp: 3 }
      }),
      event(2, { myBattlefield: "Brush", myBattlefieldImage: brushImage, score: { me: 8, opp: 5 } }, "match-end")
    ] });

    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      gameNumber: 1, result: "Win", myPoints: 8, oppPoints: 5,
      myBattlefield: "Grand Plaza", oppBattlefield: "Reaver's Row",
      myBattlefieldImage: myFieldImage, oppBattlefieldImage: opponentFieldImage
    });
  });

  it.each(["me", "opponent"] as const)("uses a normal %s candidate when the direct image is Brush", (side) => {
    const games = reviewGamesFromEvidence({ rawEvidence: [event(0, {
      myBattlefieldImage: side === "me" ? brushImage : "",
      opponentBattlefieldImage: side === "opponent" ? brushImage : "",
      battlefieldCandidates: [
        { side, text: "Tap", code: "UNL-T03", image: "https://example.test/token.png" },
        { side, text: "Grand Plaza", image: myFieldImage, hidden: false }
      ],
      score: { me: 8, opp: 5 }
    }, "match-end")] });

    expect(games).toHaveLength(1);
    expect(side === "me" ? games[0].myBattlefieldImage : games[0].oppBattlefieldImage).toBe(myFieldImage);
  });

  it("still separates a new game with different selected battlefields and reset scores", () => {
    const games = reviewGamesFromEvidence({ rawEvidence: [
      event(0, { myBattlefield: "Grand Plaza", score: { me: 8, opp: 5 } }, "match-end"),
      event(1, { myBattlefield: "Reaver's Row", score: { me: 0, opp: 0 } }, "match-start"),
      event(2, { myBattlefield: "Reaver's Row", score: { me: 3, opp: 8 } }, "match-end")
    ] });

    expect(games).toHaveLength(2);
    expect(games.map((game) => [game.gameNumber, game.myBattlefield, game.result])).toEqual([
      [1, "Grand Plaza", "Win"], [2, "Reaver's Row", "Loss"]
    ]);
  });
});
