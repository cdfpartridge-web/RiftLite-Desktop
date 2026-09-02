import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const drawerSource = readFileSync(new URL("../src/renderer/RulesSearchDrawer.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");

describe("RiftJudge rules search integration", () => {
  it("keeps the Search Rules implementation behind a disabled release flag", () => {
    const sidebarStart = appSource.indexOf('<nav className="sidebar-nav"');
    const utilityStart = appSource.indexOf('<nav className="sidebar-utility-nav"', sidebarStart);
    const sidebarSource = appSource.slice(sidebarStart, utilityStart);
    const gatedRulesActionStart = sidebarSource.indexOf("{RULES_SEARCH_FEATURE_VISIBLE ? (");
    const rulesActionStart = sidebarSource.indexOf("active={rulesSearchOpen}");
    const rulesAction = sidebarSource.slice(rulesActionStart, sidebarSource.indexOf("/>", rulesActionStart));

    expect(appSource).toContain("const RULES_SEARCH_FEATURE_VISIBLE = false;");
    expect(sidebarStart).toBeGreaterThan(-1);
    expect(gatedRulesActionStart).toBeGreaterThan(sidebarSource.indexOf("PRIMARY_NAVIGATION.map"));
    expect(rulesActionStart).toBeGreaterThan(gatedRulesActionStart);
    expect(rulesAction).toContain('title="Search Rules"');
    expect(rulesAction).toContain("setRulesSearchOpen((current) => !current)");
    expect(rulesAction).toContain("ariaControls={RULES_SEARCH_DRAWER_ID}");
    expect(rulesAction).toContain("ariaExpanded={rulesSearchOpen}");
    expect(rulesAction).not.toContain("openNavigationTarget");
    expect(rulesAction).not.toContain("setActiveView");
    expect(appSource).toContain("{RULES_SEARCH_FEATURE_VISIBLE && rulesSearchOpen ? (");
  });

  it("supports host and embedded Escape while preventing Atlas focus recovery from stealing rules input", () => {
    expect(drawerSource).toContain('window.addEventListener("keydown", closeOnEscape, true)');
    expect(drawerSource).toContain('webview.addEventListener("before-input-event", closeOnGuestEscape)');
    expect(drawerSource).toContain('input?.type !== "keyDown" || input.key !== "Escape"');
    expect(appSource).toContain("Boolean(reviewDraft || rulesSearchOpen)");
    const focusHelpers = appSource.slice(
      appSource.indexOf("function focusNativeGameWebview"),
      appSource.indexOf("async function setGameZoom")
    );
    expect(focusHelpers.match(/rulesSearchOpen \|\|/g)?.length).toBe(2);
    expect(appSource).toContain("gameHostInputWasBlockedRef.current = hostInputBlocked");
  });

  it("uses a hardened, permission-free Electron guest and externalizes off-origin navigation", () => {
    expect(mainSource).toContain('policy: Extract<EmbeddedWebviewPolicy, { kind: "rules" }>');
    expect(mainSource).toContain("installRestrictedEmbeddedPermissions(webContents, policy, new Set())");
    expect(mainSource).toContain('if (policy.kind === "rules")');
    expect(mainSource).toContain("secureRulesWebContents(webContents, policy)");
    expect(mainSource).toContain("isAllowedEmbeddedNavigation(policy, url)");
    expect(mainSource).toContain("openExternalResource(url)");
    expect(drawerSource).toContain("RIFTLITE_RULES_WEBVIEW_PARTITION");
    expect(drawerSource).not.toContain("allowpopups");
  });

  it("keeps the drawer on the left half of wide screens and expands it on narrow screens", () => {
    expect(styles).toMatch(/\.rules-search-drawer\s*\{[^}]*position:\s*fixed;[^}]*left:\s*12px;[^}]*width:\s*min\(860px, calc\(50vw - 6px\)\);/s);
    expect(styles).toMatch(/@media \(max-width:\s*760px\)\s*\{\s*\.rules-search-drawer\s*\{[^}]*left:\s*8px;[^}]*right:\s*8px;[^}]*width:\s*auto;/s);
    expect(styles).toMatch(/\.rules-search-webview\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
  });
});
