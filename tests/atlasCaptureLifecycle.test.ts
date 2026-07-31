import { describe, expect, it } from "vitest";
import { isAtlasActiveRoomBoundary } from "../src/shared/atlasCaptureLifecycle";

describe("Atlas capture lifecycle", () => {
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
