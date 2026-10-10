import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../src/shared/settingsDefaults.js";
import {
  FIRST_RUN_SETUP_LOCAL_STORAGE_KEY,
  FIRST_RUN_SETUP_STEPS,
  completeFirstRunSetup,
  dismissFirstRunSetup,
  initialFirstRunSetupState,
  nextFirstRunSetupStep,
  parseFirstRunSetupState,
  previousFirstRunSetupStep,
  serializeFirstRunSetupState,
  shouldStartFirstRunSetup,
  type FirstRunSetupState
} from "../src/shared/firstRunSetup.js";

const legacyTour = (status: "active" | "skipped" | "completed") => ({
  persistenceVersion: 1,
  tourVersion: 1,
  status,
  currentStepId: "play"
});

describe("first-install setup eligibility", () => {
  it("opens for a new profile even after boot stamps the current version", () => {
    const settings = createDefaultSettings();
    expect(shouldStartFirstRunSetup(settings, { hasLocalData: false })).toBe(true);
    settings.lastSeenVersion = "0.9.81";
    expect(shouldStartFirstRunSetup(settings, { hasLocalData: false })).toBe(true);
  });

  it("does not reopen for a profile that completed setup, even with stale active progress", () => {
    const settings = { ...createDefaultSettings(), firstRunComplete: true };
    expect(shouldStartFirstRunSetup(settings, { hasLocalData: false })).toBe(false);
    expect(shouldStartFirstRunSetup(settings, {
      hasLocalData: false, setupState: initialFirstRunSetupState()
    })).toBe(false);
  });

  it.each(["active", "skipped", "completed"] as const)("leaves existing %s legacy tours alone", (status) => {
    expect(shouldStartFirstRunSetup(createDefaultSettings(), {
      hasLocalData: false, legacyTourState: JSON.stringify(legacyTour(status))
    })).toBe(false);
  });

  it.each([
    { hasLocalData: true, username: "", accountUid: "" },
    { hasLocalData: false, username: "My simulator name", accountUid: "" },
    { hasLocalData: false, username: "", accountUid: "linked-account" }
  ])("does not interrupt a profile with prior use: %j", ({ hasLocalData, ...patch }) => {
    expect(shouldStartFirstRunSetup({ ...createDefaultSettings(), ...patch }, { hasLocalData })).toBe(false);
  });

  it("does not treat anonymous infrastructure authentication as an existing account", () => {
    const settings = { ...createDefaultSettings(), firebaseUid: "anonymous", firebaseRefreshToken: "infrastructure", username: "  " };
    expect(shouldStartFirstRunSetup(settings, { hasLocalData: false })).toBe(true);
  });

  it("resumes saved new setup after the user adds a name, account, or deck", () => {
    const settings = { ...createDefaultSettings(), username: "New player", accountUid: "newly-linked-account" };
    const setupState: FirstRunSetupState = { version: 1, step: "replays", status: "active" };
    expect(shouldStartFirstRunSetup(settings, {
      hasLocalData: true, legacyTourState: legacyTour("completed"), setupState: serializeFirstRunSetupState(setupState)
    })).toBe(true);
  });

  it.each(["completed", "dismissed"] as const)("respects %s new setup even if the durable completion flag is not yet saved", (status) => {
    expect(shouldStartFirstRunSetup(createDefaultSettings(), {
      hasLocalData: false, setupState: { version: 1, step: "deck", status }
    })).toBe(false);
  });

  it.each([
    null, "", "not-json", {}, [],
    { ...legacyTour("active"), persistenceVersion: 2 },
    { ...legacyTour("active"), tourVersion: 2 },
    { ...legacyTour("active"), status: "unknown" },
    { ...legacyTour("active"), currentStepId: "unknown" }
  ])("does not mistake missing or corrupt legacy progress for prior use: %j", (legacyTourState) => {
    expect(shouldStartFirstRunSetup(createDefaultSettings(), { hasLocalData: false, legacyTourState })).toBe(true);
  });

  it("falls back to actual profile evidence when new progress is corrupt", () => {
    expect(shouldStartFirstRunSetup(createDefaultSettings(), {
      hasLocalData: false, setupState: "not-json"
    })).toBe(true);
    expect(shouldStartFirstRunSetup(createDefaultSettings(), {
      hasLocalData: true, setupState: "not-json"
    })).toBe(false);
  });

  it("never changes recording, upload, microphone, cloud sync, or Discord consent", () => {
    const settings = createDefaultSettings();
    const original = structuredClone(settings);
    shouldStartFirstRunSetup(settings, { hasLocalData: false });
    completeFirstRunSetup(initialFirstRunSetupState());
    dismissFirstRunSetup(initialFirstRunSetupState());
    expect(settings).toEqual(original);
    expect(settings.rawCapture.webReplayAutoUploadEnabled).toBe(false);
    expect(settings.rawCapture.tcgaWebReplayAutoUploadEnabled).toBe(false);
    expect(settings.rawCapture.webReplayDiscordShareEnabled).toBe(false);
    expect(settings.replayMicAudioEnabled).toBe(false);
    expect(settings.accountCloudSyncEnabled).toBe(false);
  });
});

describe("first-install setup progress", () => {
  it("walks through the five setup pages without finishing implicitly", () => {
    let state = initialFirstRunSetupState();
    expect(state).toEqual({ version: 1, step: "player", status: "active" });
    expect(previousFirstRunSetupStep(state)).toBe(state);
    for (const step of FIRST_RUN_SETUP_STEPS.slice(1)) {
      state = nextFirstRunSetupStep(state);
      expect(state).toEqual({ version: 1, step, status: "active" });
    }
    expect(nextFirstRunSetupStep(state)).toBe(state);
    expect(previousFirstRunSetupStep(state).step).toBe("deck");
    expect(completeFirstRunSetup(state)).toEqual({ version: 1, step: "ready", status: "completed" });
  });

  it("preserves a skipped page and does not advance terminal states", () => {
    const state = dismissFirstRunSetup(nextFirstRunSetupStep(initialFirstRunSetupState()));
    expect(state).toEqual({ version: 1, step: "account", status: "dismissed" });
    expect(nextFirstRunSetupStep(state)).toBe(state);
    expect(previousFirstRunSetupStep(state)).toBe(state);
    expect(completeFirstRunSetup(state)).toBe(state);
    expect(dismissFirstRunSetup(completeFirstRunSetup(initialFirstRunSetupState())).status).toBe("completed");
  });

  it("round-trips only valid setup progress", () => {
    for (const step of FIRST_RUN_SETUP_STEPS) {
      for (const status of ["active", "completed", "dismissed"] as const) {
        const state: FirstRunSetupState = { version: 1, step, status };
        expect(parseFirstRunSetupState(serializeFirstRunSetupState(state))).toEqual(state);
      }
    }
    expect(FIRST_RUN_SETUP_LOCAL_STORAGE_KEY).toBe("riftlite.ui.first-run-setup");
  });

  it.each([
    null, "", "not-json", {}, [],
    { version: 2, step: "player", status: "active" },
    { version: 1, step: "unknown", status: "active" },
    { version: 1, step: "player", status: "unknown" },
    { version: 1, step: "player" }
  ])("rejects malformed setup progress: %j", (value) => {
    expect(parseFirstRunSetupState(value)).toBeNull();
  });
});
