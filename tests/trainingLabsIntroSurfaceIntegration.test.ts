import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const appSource = fs.readFileSync(path.join(projectRoot, "src/renderer/App.tsx"), "utf8");
const introSource = fs.readFileSync(path.join(projectRoot, "src/renderer/TrainingLabsIntro.tsx"), "utf8");
const stylesSource = fs.readFileSync(path.join(projectRoot, "src/renderer/styles/app.css"), "utf8");

describe("Training Labs splash surface", () => {
  it("is one-time, safely persisted, and permanently reopenable from Home", () => {
    expect(appSource).toContain("TRAINING_LABS_INTRO_LOCAL_STORAGE_KEY");
    expect(appSource).toContain("parseTrainingLabsIntroState");
    expect(appSource).toContain("const next = seenTrainingLabsIntroState()");
    expect(appSource).toContain("writeTrainingLabsIntroState(next)");
    expect(appSource).toContain('aria-controls="training-labs-intro-dialog"');
    expect(appSource).toContain('title="Training Labs guide"');
    expect(appSource).toContain("reopenTrainingLabsIntro");
  });

  it("does not compete with higher-priority startup dialogs", () => {
    expect(appSource).toContain('trainingLabsIntroState?.status === "pending"');
    expect(appSource).toContain('activeView === "home"');
    expect(appSource).toContain('guidedTourState?.status !== "active"');
    expect(appSource).toContain("!showUpdatePrompt");
    expect(appSource).toContain("!reviewDraft");
    expect(appSource).toContain("!atlasRecoverySuggested");
  });

  it("opens either lab and retains each lab's detailed in-page guide", () => {
    expect(appSource).toContain('openTrainingLabFromIntro("mulligan-lab")');
    expect(appSource).toContain('openTrainingLabFromIntro("sideboard-lab")');
    expect(introSource).toContain("Try Mulligan Lab");
    expect(introSource).toContain("Try Sideboard Lab");
    expect(introSource).toContain("Main: take out");
    expect(introSource).toContain("Sideboard: bring in");
  });

  it("is an accessible, keyboard-contained dialog with truthful evidence copy", () => {
    expect(introSource).toContain('role="dialog"');
    expect(introSource).toContain('aria-modal="true"');
    expect(introSource).toContain('aria-describedby="training-labs-intro-description"');
    expect(introSource).toContain('event.key === "Escape"');
    expect(introSource).toContain('event.key !== "Tab"');
    expect(introSource).toContain("previousFocus?.isConnected");
    expect(introSource).toContain("anonymised community Web Replays");
    expect(introSource).toContain("not a prescribed answer");
    expect(introSource).toContain("Outcome rates are descriptive");
  });

  it("has responsive and reduced-motion styling", () => {
    expect(stylesSource).toContain(".training-labs-intro-layer");
    expect(stylesSource).toContain(".training-labs-intro-options");
    expect(stylesSource).toContain("@media (max-width: 720px)");
    expect(stylesSource).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
