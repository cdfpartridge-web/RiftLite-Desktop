import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EnhancedInsightsIntro } from "../src/renderer/EnhancedInsightsIntro";
import { InsightsHubView } from "../src/renderer/InsightsHubView";

const componentSource = readFileSync(new URL("../src/renderer/EnhancedInsightsIntro.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/renderer/styles/enhancedInsightsIntro.css", import.meta.url), "utf8");
const hubSource = readFileSync(new URL("../src/renderer/InsightsHubView.tsx", import.meta.url), "utf8");

describe("EnhancedInsightsIntro", () => {
  it("explains the opt-in evidence and the deeper coaching it enables", () => {
    const markup = renderToStaticMarkup(
      <EnhancedInsightsIntro onEnable={vi.fn()} onDismiss={vi.fn()} />
    );

    expect(markup).toContain('data-testid="enhanced-insights-intro"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("See the decisions behind the result");
    expect(markup).toContain("What RiftLite remembers");
    expect(markup).toContain("turns, active player, action order and score path");
    expect(markup).toContain("runes, card movement, battlefields and combat when available");
    expect(markup).toContain("review markers, notes, sideboard changes and a match-time snapshot of the relevant Deck Notebook plan");
    expect(markup).toContain("Score paths &amp; lethal windows");
    expect(markup).toContain("Rune use &amp; information timing");
    expect(markup).toContain("Battlefield commitment");
    expect(markup).toContain("Combat &amp; tempo swings");
    expect(markup).toContain("Sideboard follow-through");
    expect(markup).toContain("Missing capture stays labelled unknown instead of being guessed.");
  });

  it("makes the local-only boundary and both choices explicit", () => {
    const markup = renderToStaticMarkup(
      <EnhancedInsightsIntro onEnable={vi.fn()} onDismiss={vi.fn()} />
    );

    expect(markup).toContain("Private and local by default");
    expect(markup).toContain("does not upload replays");
    expect(markup).toContain("record video or enable diagnostics");
    expect(markup).toContain("stay on this device");
    expect(markup).toContain("Replay Coach can use a local semantic replay record when it returns");
    expect(markup).toContain("opt a match out during review");
    expect(markup).toContain("Deck Notebook itself still follows your existing RiftLite account-backup setting");
    expect(markup).toContain('role="switch"');
    expect(markup).toContain("Ask one quick question after relevant games");
    expect(markup).toContain("Enable Enhanced Insights");
    expect(markup).toContain("Not now");
    expect(markup).toContain('aria-label="Dismiss Enhanced Insights introduction"');
  });

  it("defaults the optional question on, supports opting out, and exposes a busy state", () => {
    const defaultMarkup = renderToStaticMarkup(
      <EnhancedInsightsIntro onEnable={vi.fn()} onDismiss={vi.fn()} />
    );
    const optedOutMarkup = renderToStaticMarkup(
      <EnhancedInsightsIntro defaultAskPostGameQuestion={false} busy onEnable={vi.fn()} onDismiss={vi.fn()} />
    );

    expect(defaultMarkup).toContain('role="switch" checked=""');
    expect(optedOutMarkup).toContain('role="switch" disabled=""');
    expect(optedOutMarkup).not.toContain('role="switch" checked=""');
    expect(optedOutMarkup).toContain("Enabling…");
    expect(componentSource).toContain("onEnable({ askPostGameQuestion })");
    expect(componentSource).toContain("setAskPostGameQuestion(event.currentTarget.checked)");
  });

  it("ships focus handling and responsive presentation for a true splash screen", () => {
    expect(componentSource).toContain('document.body.style.overflow = "hidden"');
    expect(componentSource).toContain('event.key === "Escape"');
    expect(componentSource).toContain("FOCUSABLE_SELECTOR");
    expect(styleSource).toContain(".enhanced-insights-intro-layer");
    expect(styleSource).toContain("position: fixed");
    expect(styleSource).toContain("backdrop-filter: blur");
    expect(styleSource).toContain("@media (max-width: 760px)");
    expect(styleSource).toContain("@media (max-width: 500px)");
    expect(styleSource).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("opens automatically until answered and remains available from the Insights header", () => {
    expect(hubSource).toContain("useState(() => !enhancedInsightsIntroSeen)");
    expect(hubSource).toContain("if (!enhancedInsightsIntroSeen) setEnhancedIntroOpen(true)");
    expect(hubSource).toContain('className="enhanced-insights-hub-control"');
    expect(hubSource).toContain("Enhanced Insights on");
    expect(hubSource).toContain("Enable Enhanced Insights");
    expect(hubSource).toContain("Private evidence · View guide");
    expect(hubSource).toContain("<EnhancedInsightsIntro");
    expect(hubSource).toContain("defaultAskPostGameQuestion={enhancedInsightsPostGamePromptEnabled}");
  });

  it("renders the unseen splash and preserves an enabled revisit control after it has been seen", () => {
    const commonProps = {
      replays: [],
      matches: [],
      decks: [],
      activeDeckId: "",
      enhancedInsightsPostGamePromptEnabled: true,
      onOpenReplay: vi.fn(),
      onNavigate: vi.fn(),
      onSaveEnhancedInsights: vi.fn(async () => undefined)
    };
    const unseenMarkup = renderToStaticMarkup(
      <InsightsHubView
        {...commonProps}
        enhancedInsightsEnabled={false}
        enhancedInsightsIntroSeen={false}
      />
    );
    const enabledMarkup = renderToStaticMarkup(
      <InsightsHubView
        {...commonProps}
        enhancedInsightsEnabled
        enhancedInsightsIntroSeen
      />
    );

    expect(unseenMarkup).toContain('data-testid="enhanced-insights-intro"');
    expect(unseenMarkup).toContain('data-state="disabled"');
    expect(unseenMarkup).toContain("Enable Enhanced Insights");
    expect(enabledMarkup).not.toContain('data-testid="enhanced-insights-intro"');
    expect(enabledMarkup).toContain('data-state="enabled"');
    expect(enabledMarkup).toContain("Enhanced Insights on");
  });

  it("persists enable and dismiss choices with guarded async feedback", () => {
    expect(hubSource).toContain("enhancedSaveInFlightRef.current");
    expect(hubSource).toContain("enhancedInsightsEnabled: true");
    expect(hubSource).toContain("enhancedInsightsIntroSeen: true");
    expect(hubSource).toContain("enhancedInsightsPostGamePromptEnabled: selection.askPostGameQuestion");
    expect(hubSource).toContain("await onSaveEnhancedInsights({ enhancedInsightsIntroSeen: true })");
    expect(hubSource).toContain("Nothing changed — please try again.");
    expect(hubSource).toContain('role="alert"');
    expect(hubSource).toContain('busy={enhancedIntroBusy}');
  });
});
