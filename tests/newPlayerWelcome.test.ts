import { describe, expect, it } from "vitest";
import { newPlayerFirstRunEntry, parseNewPlayerWelcomeChoice, serializeNewPlayerWelcomeChoice } from "../src/shared/newPlayerWelcome";
import { initialFirstRunSetupState } from "../src/shared/firstRunSetup";

const newSettings = { firstRunComplete: false, username: "", accountUid: "" };
describe("new player welcome and deferred setup", () => {
  it("offers the choice to a genuinely new user", () => {
    expect(newPlayerFirstRunEntry(newSettings, { hasLocalData: false }, null)).toBe("welcome");
  });
  it("resumes learning after a deck import without marking setup complete", () => {
    expect(newPlayerFirstRunEntry(newSettings, { hasLocalData: true }, "learn")).toBe("new-player");
    expect(newSettings.firstRunComplete).toBe(false);
  });
  it("does not interrupt established profiles", () => {
    expect(newPlayerFirstRunEntry({ ...newSettings, firstRunComplete: true }, { hasLocalData: true }, "learn")).toBeNull();
    expect(newPlayerFirstRunEntry({ ...newSettings, username: "Existing" }, { hasLocalData: false }, null)).toBeNull();
    expect(newPlayerFirstRunEntry(newSettings, { hasLocalData: true }, null)).toBeNull();
    expect(newPlayerFirstRunEntry(newSettings, { hasLocalData: false, legacyTourState: { persistenceVersion: 1, tourVersion: 1, status: "skipped", currentStepId: "home" } }, null)).toBeNull();
  });
  it("resumes an already active setup and honours explicit completion", () => {
    expect(newPlayerFirstRunEntry(newSettings, { hasLocalData: false, setupState: initialFirstRunSetupState() }, null)).toBe("setup");
    expect(newPlayerFirstRunEntry(newSettings, { hasLocalData: false }, "setup")).toBe("setup");
    expect(newPlayerFirstRunEntry(newSettings, { hasLocalData: false, setupState: { ...initialFirstRunSetupState(), status: "dismissed" } }, null)).toBeNull();
  });
  it("validates persisted choices without admitting unexpected values", () => {
    expect(parseNewPlayerWelcomeChoice(serializeNewPlayerWelcomeChoice("learn"))).toBe("learn");
    for (const raw of ["bad", "null", "[]", '{"version":2,"choice":"learn"}', '{"version":1,"choice":"completed"}']) expect(parseNewPlayerWelcomeChoice(raw)).toBeNull();
  });
});
