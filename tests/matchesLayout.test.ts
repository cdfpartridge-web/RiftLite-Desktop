import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const baseStyles = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");
const modernStyles = readFileSync(new URL("../src/renderer/styles/ui-dev-modern.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");

function declarationsForSelector(css: string, selector: string): string {
  return Array.from(css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) => match[1].split(",").some((candidate) => candidate.trim() === selector))
    .map((match) => match[2])
    .join("\n");
}

function mediaBlocksForQuery(css: string, query: string): string {
  const blocks: string[] = [];
  const pattern = new RegExp(`@media\\s*${query}\\s*\\{`, "g");
  for (const match of css.matchAll(pattern)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    while (end < css.length && depth > 0) {
      if (css[end] === "{") depth += 1;
      if (css[end] === "}") depth -= 1;
      end += 1;
    }
    if (depth === 0) blocks.push(css.slice(start, end - 1));
  }
  return blocks.join("\n");
}

function mediaBlocksAtMaxWidth(css: string, width: number): string {
  return mediaBlocksForQuery(css, `\\(max-width\\s*:\\s*${width}px\\)`);
}

describe("Matches scroll layout", () => {
  // Static guards complement browser scroll tests: skipped rows must not size
  // the page's implicit grid column when their real content becomes visible.
  it.each([".matches-page", ".matches-page .local-match-table"])(
    "bounds the single grid column for %s",
    (selector) => {
      const declarations = declarationsForSelector(baseStyles, selector);
      expect(declarations).toMatch(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s*;/);
      expect(declarations).toMatch(/min-width\s*:\s*0\s*;/);
      expect(declarations).not.toMatch(/overflow(?:-x)?\s*:\s*(?:hidden|clip)\b/);
    }
  );

  it("lets Matches rows shrink and keeps their margins inside the grid", () => {
    const declarations = declarationsForSelector(baseStyles, ".matches-page .match-row");
    expect(declarations).toMatch(/min-width\s*:\s*0\s*;/);
    expect(declarations).toMatch(/(?:^|[;\n])\s*width\s*:\s*auto\s*;/);
    expect(declarations).not.toMatch(/(?:grid-template|grid|overflow(?:-x)?)\s*:/);
    const scopedColumns = declarations.match(/grid-template-columns\s*:[^;]+;/g) ?? [];
    expect(scopedColumns).toHaveLength(1);
    expect(scopedColumns[0])
      .toMatch(/grid-template-columns\s*:\s*30px\s+132px\s+minmax\(220px,\s*1fr\)\s+minmax\(180px,\s*1fr\)\s*;/);
  });

  it("keeps the width guard scoped to the existing Matches page and local table", () => {
    expect(appSource).toContain('className="dashboard-page matches-page"');
    expect(appSource).toContain('className="match-table local-match-table"');
    expect(declarationsForSelector(baseStyles, ".match-table"))
      .not.toMatch(/grid-template-columns\s*:/);
    expect(declarationsForSelector(baseStyles, ".dashboard-page"))
      .not.toMatch(/grid-template-columns\s*:/);
  });

  it("preserves the seven-cell order used by the responsive row placement", () => {
    const source = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const view = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "MatchesView");
    expect(view).toBeDefined();
    const rows: ts.JsxElement[] = [];
    function visit(node: ts.Node): void {
      if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((attribute) => (
        ts.isJsxAttribute(attribute)
        && attribute.name.getText(source) === "className"
        && attribute.initializer !== undefined
        && ts.isStringLiteral(attribute.initializer)
        && attribute.initializer.text === "match-row interactive-row"
      ))) rows.push(node);
      ts.forEachChild(node, visit);
    }
    visit(view!);
    expect(rows).toHaveLength(1);
    const cells = rows[0].children.filter((child) => (
      !ts.isJsxText(child) && !(ts.isJsxExpression(child) && !child.expression)
    ));
    expect(cells.map((cell) => ts.isJsxElement(cell)
      ? cell.openingElement.tagName.getText(source)
      : ts.isJsxSelfClosingElement(cell) ? cell.tagName.getText(source) : cell.kind))
      .toEqual(["label", "div", "div", "div", "div", "SyncPill", "div"]);
    expect(cells[0].getText(source)).toContain('className="match-select-cell"');
    expect(cells[1].getText(source)).toContain('className="match-result-block"');
    expect(cells[2].getText(source)).toContain('className="match-legend-cell"');
    expect(cells[3].getText(source)).toContain("match.opponentName");
    expect(cells[4].getText(source)).toContain("match.deckName");
    expect(cells[6].getText(source)).toContain('className="row-actions"');
  });

  it("preserves lazy rendering for match rows and dashboard cards", () => {
    for (const selector of [".match-row", ".dashboard-page > .rail-card"]) {
      const declarations = declarationsForSelector(baseStyles, selector);
      expect(declarations).toMatch(/content-visibility\s*:\s*auto\s*;/);
      expect(declarations).toMatch(/contain-intrinsic-size\s*:\s*auto\s+140px\s*;/);
    }
    for (const selector of [".matches-page", ".matches-page .local-match-table", ".matches-page .match-row"]) {
      expect(declarationsForSelector(baseStyles, selector))
        .not.toMatch(/(?:content-visibility|contain-intrinsic-size)\s*:/);
    }
  });

  it("retains the desktop and compact row layouts", () => {
    expect(declarationsForSelector(baseStyles, ".match-row"))
      .toMatch(/grid-template-columns\s*:\s*30px\s+138px\s+minmax\(210px,\s*1\.2fr\)\s+minmax\(160px,\s*1fr\)\s+minmax\(170px,\s*1fr\)\s+92px\s+150px\s*;/);
    expect(declarationsForSelector(mediaBlocksAtMaxWidth(baseStyles, 1180), ".match-row"))
      .toMatch(/grid-template-columns\s*:\s*30px\s+132px\s+minmax\(220px,\s*1fr\)\s+minmax\(180px,\s*1fr\)\s*;/);
    expect(declarationsForSelector(mediaBlocksAtMaxWidth(baseStyles, 900), ".match-row"))
      .toMatch(/grid-template-columns\s*:\s*30px\s+minmax\(0,\s*1fr\)\s*;/);
    expect(declarationsForSelector(baseStyles, ".row-actions"))
      .toMatch(/flex-wrap\s*:\s*wrap\s*;/);
    expect(declarationsForSelector(mediaBlocksAtMaxWidth(baseStyles, 900), ".match-row .row-actions"))
      .toMatch(/justify-content\s*:\s*flex-start\s*;/);
  });

  it("switches only Matches to four columns before desktop row actions would clip", () => {
    const compactStyles = mediaBlocksForQuery(
      baseStyles,
      "\\(min-width\\s*:\\s*901px\\)\\s+and\\s+\\(max-width\\s*:\\s*1340px\\)"
    );
    expect(declarationsForSelector(compactStyles, ".matches-page .match-row"))
      .toMatch(/grid-template-columns\s*:\s*30px\s+132px\s+minmax\(220px,\s*1fr\)\s+minmax\(180px,\s*1fr\)\s*;/);
    expect(declarationsForSelector(compactStyles, ".match-row"))
      .not.toMatch(/grid-template-columns\s*:/);
    expect(declarationsForSelector(compactStyles, ".matches-page .match-row > :nth-child(5)"))
      .toMatch(/grid-column\s*:\s*2\s*;/);
  });

  it("keeps narrow-screen Matches actions out of the checkbox-only column", () => {
    const narrowStyles = mediaBlocksAtMaxWidth(baseStyles, 900);
    expect(declarationsForSelector(narrowStyles, ".matches-page .match-row > :nth-child(n + 3)"))
      .toMatch(/grid-column\s*:\s*2\s*;/);
    expect(declarationsForSelector(narrowStyles, ".matches-page .match-row .row-actions"))
      .toMatch(/grid-column\s*:\s*1\s*\/\s*-1\s*;/);
    expect(declarationsForSelector(baseStyles, ".row-actions"))
      .not.toMatch(/grid-column\s*:/);
  });

  it("does not let the modern theme override the bounded grid or lazy row sizing", () => {
    for (const selector of [".ui-dev-modern .matches-page", ".ui-dev-modern .match-table", ".ui-dev-modern .match-row"]) {
      expect(declarationsForSelector(modernStyles, selector))
        .not.toMatch(/(?:grid-template-columns|grid-template|grid|min-width|content-visibility|contain-intrinsic-size)\s*:/);
    }
  });
});
