import { describe, expect, it } from "vitest";
import {
  ATLAS_CONFIRMED_FORMAT_LANDING_GRACE_MS,
  ATLAS_INACTIVE_END_GRACE_MS,
  atlasInactiveEndGraceMs,
  isAtlasActiveRoomBoundary,
  isAtlasGameRouteUrl,
  isAtlasRootLandingUrl,
  isAtlasTransientOverlayDescriptor
} from "../src/shared/atlasCaptureLifecycle";

describe("Atlas capture lifecycle", () => {
  it("allows transient Atlas UI navigation to settle before ending a recording", () => {
    expect(ATLAS_INACTIVE_END_GRACE_MS).toBe(30_000);
  });

  it("ends a confirmed BO1 or BO3 promptly after Atlas returns to its root landing page", () => {
    expect(ATLAS_CONFIRMED_FORMAT_LANDING_GRACE_MS).toBe(2_000);
    expect(atlasInactiveEndGraceMs("https://play.riftatlas.com/", "Bo1")).toBe(2_000);
    expect(atlasInactiveEndGraceMs("https://play.riftatlas.com/?from=game", "bo1")).toBe(2_000);
    expect(atlasInactiveEndGraceMs("https://play.riftatlas.com/", "Bo3")).toBe(2_000);
  });

  it("keeps the long overlay grace in-game or when the match format is not confirmed", () => {
    expect(atlasInactiveEndGraceMs("https://play.riftatlas.com/game", "Bo1")).toBe(30_000);
    expect(atlasInactiveEndGraceMs("https://play.riftatlas.com/game/room", "Bo3")).toBe(30_000);
    expect(atlasInactiveEndGraceMs("https://play.riftatlas.com/", "Auto")).toBe(30_000);
    expect(atlasInactiveEndGraceMs("not a URL", "Bo1")).toBe(30_000);
  });

  it("distinguishes Atlas's real game route from the root lobby", () => {
    expect(isAtlasRootLandingUrl("https://play.riftatlas.com/")).toBe(true);
    expect(isAtlasRootLandingUrl("https://play.riftatlas.com/?from=game")).toBe(true);
    expect(isAtlasRootLandingUrl("https://play.riftatlas.com/game")).toBe(false);
    expect(isAtlasGameRouteUrl("https://play.riftatlas.com/game")).toBe(true);
    expect(isAtlasGameRouteUrl("https://play.riftatlas.com/game/ROOM1")).toBe(true);
    expect(isAtlasGameRouteUrl("https://play.riftatlas.com/")).toBe(false);
  });

  it("recognizes label pickers and common accessible overlays", () => {
    expect(isAtlasTransientOverlayDescriptor({ classes: "label-picker popover", text: "Select label" })).toBe(true);
    expect(isAtlasTransientOverlayDescriptor({ role: "listbox", ariaLabel: "Choose a label" })).toBe(true);
    expect(isAtlasTransientOverlayDescriptor({ ariaModal: "true", classes: "drawer" })).toBe(true);
  });

  it("does not retain terminal results or ordinary labelled controls as overlays", () => {
    expect(isAtlasTransientOverlayDescriptor({ role: "dialog", text: "Victory — return to lobby" })).toBe(false);
    expect(isAtlasTransientOverlayDescriptor({ classes: "card-label", text: "Stunned" })).toBe(false);
    expect(isAtlasTransientOverlayDescriptor({ ariaLabel: "Set your score to 5" })).toBe(false);
  });

  it("treats a reliable room change as a new start even before inactive debounce finishes", () => {
    expect(isAtlasActiveRoomBoundary(true, "94FTN", true, "BZRJM")).toBe(true);
  });

  it("does not create a boundary for the same room or incomplete room evidence", () => {
    expect(isAtlasActiveRoomBoundary(true, "bzrjm", true, "BZRJM")).toBe(false);
    expect(isAtlasActiveRoomBoundary(true, "", true, "BZRJM")).toBe(false);
    expect(isAtlasActiveRoomBoundary(true, "94FTN", true, "")).toBe(false);
    expect(isAtlasActiveRoomBoundary(false, "94FTN", true, "BZRJM")).toBe(false);
  });
});
