import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");

describe("Prep/Notes widget integration", () => {
  it("uses the compact Prep/Notes label without changing the widget dimensions", () => {
    expect(appSource.match(/<span>Prep\/Notes<\/span>/g)).toHaveLength(2);
    expect(appSource).toContain('`Prep/Notes vs ${targetLegend}`');
    const pillStart = stylesSource.indexOf(".matchup-prep-pill {");
    const pillEnd = stylesSource.indexOf("}", pillStart);
    const pillStyles = stylesSource.slice(pillStart, pillEnd);
    expect(pillStart).toBeGreaterThan(-1);
    expect(pillStyles).toContain("width: 54px;");
    expect(pillStyles).toContain("min-height: 104px;");
  });

  it("gates the shared Atlas and TCGA play widget behind a default-on setting", () => {
    expect(appSource).toContain("settings.matchupPrepWidgetEnabled && playActiveDeck && prepNotebook");
    expect(appSource).toContain("checked={settings.matchupPrepWidgetEnabled}");
    expect(appSource).toContain("onSave({ matchupPrepWidgetEnabled: event.target.checked })");
    expect(appSource).toContain("over both Atlas and TCGA");
  });

  it("defaults every launcher to the bottom-left and lets it remember a dragged position", () => {
    expect(appSource).toContain("y: Math.max(72, window.innerHeight - 132)");
    expect(appSource).toContain('const MATCHUP_PREP_POSITION_KEY = "riftlite-matchup-prep-position-v1";');
    expect(appSource).toContain("saveMatchupPrepPosition(next);");
    expect(appSource).toContain("}, [hidden, open]);");

    const restoreStart = appSource.indexOf('className="matchup-prep-overlay matchup-prep-restore-wrap"');
    const restoreMarkup = appSource.slice(restoreStart, restoreStart + 1_200);
    expect(restoreStart).toBeGreaterThan(-1);
    expect(restoreMarkup).toContain("ref={overlayRef}");
    expect(restoreMarkup).toContain("style={{ left: position.x, top: position.y }}");
    expect(restoreMarkup).toContain("onPointerDown={startDrag}");
    expect(restoreMarkup).toContain('title="Show or drag matchup prep and notes"');

    const restoreStylesStart = stylesSource.indexOf(".matchup-prep-restore-wrap {");
    const restoreStylesEnd = stylesSource.indexOf("}", restoreStylesStart);
    const restoreStyles = stylesSource.slice(restoreStylesStart, restoreStylesEnd);
    expect(restoreStyles).not.toContain("right:");
    expect(restoreStyles).not.toContain("bottom:");
    expect(stylesSource).toContain('.matchup-prep-overlay[data-dragging="true"] .matchup-prep-restore');
  });
});
