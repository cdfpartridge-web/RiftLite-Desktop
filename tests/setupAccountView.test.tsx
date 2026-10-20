import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { AccountView } from "../src/renderer/App";
import { createDefaultSettings } from "../src/shared/settingsDefaults";
import type { UserSettings } from "../src/shared/types";

// App.tsx is also the renderer entry point; prevent mounting its unrelated
// application shell when exercising the shared account view server-side.
vi.hoisted(() => vi.stubGlobal("document", { getElementById: () => ({}) }));
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: vi.fn() }) }));
vi.mock("../src/renderer/rendererCrashLogging", () => ({ installRendererCrashLogging: vi.fn(), reportRendererCrash: vi.fn() }));
afterAll(() => vi.unstubAllGlobals());

function render(settings: UserSettings = createDefaultSettings()) {
  const onOpenWebReplays = vi.fn();
  const html = renderToStaticMarkup(<AccountView variant="setup" settings={settings}
    matches={[]} decks={[]} webReplayDiagnostics={null} onSettingsChanged={vi.fn()}
    onRefreshWebReplayDiagnostics={vi.fn(async () => null)} onOpenWebReplays={onOpenWebReplays}
    onAccountDataRestored={vi.fn(async () => undefined)} />);
  return { html, onOpenWebReplays };
}

describe("account setup inside the welcome screen", () => {
  it("offers each supported sign-in method without navigating to account settings", () => {
    const { html, onOpenWebReplays } = render();
    expect(html).toContain('data-setup-account-state="local"');
    for (const provider of ["Google", "email", "Discord"]) expect(html).toContain(`Continue with ${provider}`);
    expect(html).toContain("then return to this setup");
    expect(html).not.toContain("dashboard-page account-page");
    expect(onOpenWebReplays).not.toHaveBeenCalled();
  });

  it("allows a new linked account to finish its name without a nested form or cloud action", () => {
    const settings = { ...createDefaultSettings(), accountUid: "new-account", firebaseRefreshToken: "test-token", accountHandle: "", accountDisplayName: "" };
    const { html } = render(settings);
    expect(html).toContain('data-setup-account-state="needs-profile"');
    expect(html).toContain('id="setup-account-display-name"');
    expect(html).toContain('id="setup-account-handle"');
    expect(html).toContain("Save account name");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Restore cloud and enable backups");
    expect(html).not.toContain("Keep local and replace cloud");
    expect(html).toContain("does not restore or replace your data");
  });

  it("requires verification instead of presenting a saved credential as connected", () => {
    const settings = { ...createDefaultSettings(), accountUid: "existing-account", accountHandle: "river", accountDisplayName: "River", firebaseRefreshToken: "test-token", accountCloudSyncEnabled: true };
    const { html } = render(settings);
    expect(html).toContain("Check connection");
    expect(html).not.toContain("Your account is connected");
    expect(html).toContain("Your existing cloud backup preference stays on");
  });
});
