import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FirstRunSetup, type FirstRunSetupProps } from "../src/renderer/FirstRunSetup";
import { createDefaultSettings } from "../src/shared/settingsDefaults";
import type { SavedDeck } from "../src/shared/types";

function render(overrides: Partial<FirstRunSetupProps> = {}) {
  return renderToStaticMarkup(<FirstRunSetup settings={createDefaultSettings()} decks={[]} step="player" accountVerified={false} onStepChange={vi.fn()} onSave={vi.fn(async () => undefined)} onOpenDestination={vi.fn()} onOpenWebsite={vi.fn(async () => undefined)} onFinish={vi.fn(async () => undefined)} onSkip={vi.fn(async () => undefined)} {...overrides} />);
}

describe("first install setup", () => {
  it("starts with an optional simulator identity and respects the saved simulator", () => {
    const settings = { ...createDefaultSettings(), username: "River Player", defaultGamePlatform: "atlas" as const };
    const html = render({ settings });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-setup-step="player"');
    expect(html).toContain('value="River Player"');
    expect(html).toContain('checked="" value="atlas"');
    expect(html).toContain("separate from your RiftLite account handle");
    expect(html).toContain("Optional");
    expect(html).toContain('data-setup-action="skip"');
  });

  it("never calls a saved but unverified account connected", () => {
    const settings = { ...createDefaultSettings(), accountUid: "saved-account", accountHandle: "river" };
    const unverified = render({ step: "account", settings, accountVerified: false });
    expect(unverified).toContain("Reconnect your RiftLite account");
    expect(unverified).toContain("Continue without account");
    expect(unverified).not.toContain("Your account is connected");
    expect(render({ step: "account", accountVerified: true })).not.toContain("Your account is connected");
    const verified = render({ step: "account", settings, accountVerified: true });
    expect(verified).toContain("Your account is connected");
    expect(verified).toContain("@river");
  });

  it("keeps microphone off by default and explains separate online consent", () => {
    const html = render({ step: "replays" });
    const microphone = html.match(/<label[^>]*>[^]*?Include my microphone[^]*?<\/label>/)?.[0]?.split("<label").pop() ?? "";
    expect(microphone).toContain('role="switch"');
    expect(microphone).not.toContain('checked=""');
    expect(html).toContain("Interactive replay data stays here until you choose to upload");
    expect(html).toContain("If you didn’t connect a RiftLite account in the previous step");
    expect(html).toContain("Local recordings still work");
    expect(html).not.toContain("Set up online replays");
  });

  it("keeps online setup inside the wizard with explicit opt-in and Public for a new profile", () => {
    const settings = { ...createDefaultSettings(), accountUid: "player-one" };
    const html = render({ step: "replays", settings, accountVerified: true });
    expect(html).toContain("Upload Atlas replays");
    expect(html).toContain("Upload TCG Arena replays");
    expect(html).toContain('<option value="public" selected="">');
    expect(html).toContain("Your existing online replays keep their current visibility");
    for (const title of ["Upload Atlas replays", "Upload TCG Arena replays"]) {
      const toggle = html.slice(html.indexOf(title)).split("</label>")[0];
      expect(toggle).not.toContain('disabled=""');
      expect(toggle).not.toContain('checked=""');
    }
  });

  it("blocks new uploads without an account but allows turning off old consent", () => {
    const html = render({ step: "replays" });
    for (const title of ["Upload Atlas replays", "Upload TCG Arena replays"]) {
      expect(html.slice(html.indexOf(title)).split("</label>")[0]).toContain('disabled=""');
    }
    const settings = createDefaultSettings();
    settings.accountUid = "player-one";
    settings.rawCapture.webReplayAutoUploadEnabled = true;
    settings.rawCapture.webReplayAutoUploadAccountUid = "player-one";
    const unverified = render({ step: "replays", settings });
    const atlasToggle = unverified.slice(unverified.indexOf("Upload Atlas replays")).split("</label>")[0];
    expect(atlasToggle).toContain('checked=""');
    expect(atlasToggle).not.toContain('disabled=""');
    expect(unverified).toContain("Reconnect and verify");
  });

  it("preserves existing visibility and explains automatic Discord destinations", () => {
    const settings = createDefaultSettings();
    settings.firstRunComplete = true;
    settings.rawCapture.visibility = "private";
    expect(render({ step: "replays", settings })).toContain('<option value="private" selected="">');
    settings.accountUid = "player-one";
    Object.assign(settings.rawCapture, { webReplayAutoUploadEnabled: true, webReplayAutoUploadAccountUid: "player-one", webReplayDiscordShareEnabled: true, webReplayDiscordShareAccountUid: "player-one", webReplayDiscordShareHubIds: ["hub-one"] });
    const html = render({ step: "replays", settings, accountVerified: true });
    expect(html).toContain('<option value="unlisted" selected="">');
    expect(html).toContain("automatic Discord destinations use Unlisted");
    expect(html).toContain('id="first-run-visibility" disabled=""');
  });

  it("does not promise local-only interactive capture when existing uploads are configured", () => {
    const settings = createDefaultSettings();
    settings.rawCapture.webReplayAutoUploadEnabled = true;
    const html = render({ step: "replays", settings });
    expect(html).toContain("Your existing upload preferences still apply");
    expect(html).not.toContain("Interactive replay data stays here until you choose to upload");
  });

  it("distinguishes a real selected deck from an empty or missing deck", () => {
    const deck: SavedDeck = { id: "deck-1", title: "Ahri Tempo", legend: "Ahri", sourceUrl: "", sourceKey: "", snapshotJson: "{}", lastImportedAt: "", lastRefreshStatus: "", lastRefreshError: "" };
    const settings = { ...createDefaultSettings(), activeDeckId: "deck-1" };
    expect(render({ step: "deck" })).toContain("Choose a deck later");
    expect(render({ step: "deck" })).toContain("public Piltover Archive deck link");
    expect(render({ step: "deck", settings, decks: [deck] })).toContain("public Piltover Archive link");
    expect(render({ step: "deck", settings, decks: [deck] })).toContain('aria-label="Deck selected"');
    const missing = render({ step: "ready", settings });
    expect(missing).toContain("Choose later");
    expect(missing).not.toContain("Deck selected");
  });

  it("offers the live feature map without presenting parked labs as available", () => {
    const html = render({ step: "ready" });
    for (const name of ["Play", "Review", "Prepare", "Community", "Insights", "Overlay", "Settings"]) expect(html).toContain(`<strong>${name}</strong>`);
    expect(html).toContain("Open Play");
    expect(html).toContain("Go to Home");
    expect(html).toContain("Online uploads off");
    expect(html).toContain("choose Save match");
    expect(html).toContain("Visit RiftLite.com/replays");
    expect(html).not.toContain("Opening Turns Lab");
    expect(html).not.toContain("Replay Coach");
    expect(html).toContain('data-setup-action="finish"');
  });

  it("shows enabled uploads only for verified matching account consent", () => {
    const settings = createDefaultSettings();
    settings.accountUid = "player-one";
    settings.rawCapture.enabled = true;
    settings.rawCapture.webReplayAutoUploadEnabled = true;
    settings.rawCapture.webReplayAutoUploadAccountUid = "player-one";
    expect(render({ step: "ready", settings, accountVerified: true })).toContain("Atlas uploads on");
    expect(render({ step: "ready", settings, accountVerified: false })).toContain("Online uploads need verification");
    settings.rawCapture.webReplayAutoUploadAccountUid = "player-two";
    expect(render({ step: "ready", settings, accountVerified: true })).toContain("Online uploads: check settings");
    settings.rawCapture.enabled = false;
    expect(render({ step: "ready", settings, accountVerified: true })).toContain("Online uploads paused");
  });

  it("explains automatic results when confirmation is disabled", () => {
    const settings = { ...createDefaultSettings(), confirmationEnabled: false };
    const html = render({ step: "ready", settings });
    expect(html).toContain("Captured results save automatically");
    expect(html).not.toContain("choose Save match");
  });
});
