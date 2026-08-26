import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReplayAnnotationTextDialog } from "../src/renderer/ReplayAnnotationTextDialog";
import {
  createReplayTextAnnotation,
  type PendingReplayTextAnnotation
} from "../src/renderer/replayAnnotationText";

const pendingVideoAnnotation: PendingReplayTextAnnotation = {
  targetType: "video-time",
  targetId: "video-1",
  targetLabel: "Game 1 at 03:14",
  capturedAt: "2026-08-25T10:00:00.000Z",
  timeMs: 194_000,
  tool: "text",
  layerId: "coach-layer",
  clipId: "voice-note-1",
  offsetMs: 2_750,
  color: "#28d7ff",
  width: 2,
  points: [{ x: 0.42, y: 0.27 }]
};

describe("ReplayAnnotationTextDialog", () => {
  it("renders an accessible in-app editor and blocks blank text", () => {
    const markup = renderToStaticMarkup(
      <ReplayAnnotationTextDialog
        targetLabel="Game 1 at 03:14"
        value="   "
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Add text annotation");
    expect(markup).toContain("Game 1 at 03:14");
    expect(markup).toContain('id="replay-annotation-text"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('disabled=""');
  });

  it("enables submission when the annotation has visible text", () => {
    const markup = renderToStaticMarkup(
      <ReplayAnnotationTextDialog
        targetLabel="Opening hand"
        value="Hold removal here"
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(markup).toMatch(/<button type="submit" class="primary">Add annotation<\/button>/);
  });

  it("trims text while preserving the click-time target, point, layer and voice offset", () => {
    const annotation = createReplayTextAnnotation(
      pendingVideoAnnotation,
      "  Hold removal here  ",
      "annotation-1",
      "2026-08-25T10:05:00.000Z"
    );

    expect(annotation).toEqual({
      ...pendingVideoAnnotation,
      id: "annotation-1",
      text: "Hold removal here",
      createdAt: "2026-08-25T10:05:00.000Z"
    });
    expect(createReplayTextAnnotation(pendingVideoAnnotation, " \n\t ", "unused", "unused")).toBeNull();
  });

  it("replaces Electron's unsupported prompt and portals above the replay whiteboard", () => {
    const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const dialogSource = readFileSync(new URL("../src/renderer/ReplayAnnotationTextDialog.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");

    expect(appSource).not.toContain("window.prompt(");
    expect(appSource).toContain("setPendingTextAnnotation({");
    expect(appSource).toContain("...clipFields(),");
    expect(appSource).toContain("<ReplayAnnotationTextDialog");
    expect(appSource).toContain("createReplayTextAnnotation(");
    expect(appSource).toContain("onAddAnnotation(annotation);");
    expect(dialogSource).toContain("createPortal(dialog, document.body)");
    expect(styles).toMatch(/\.replay-annotation-text-backdrop\s*\{[^}]*z-index:\s*560;[^}]*pointer-events:\s*auto;/s);
  });
});
