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
});
