import { describe, expect, it } from "vitest";
import { initialNewPlayerProgress, mergeCourseProgress, saveLessonProgress } from "../src/shared/newPlayerProgress.js";
import { applyTutorialAction, createLessonState, getTutorialStep, undoTutorialAction, type TutorialState } from "../src/shared/newPlayerTutorial.js";

function advance(state: TutorialState) {
  return applyTutorialAction(state, getTutorialStep(state)!.expectedAction);
}

describe("course progress from two open lessons", () => {
  const empty = initialNewPlayerProgress();
  const opening = createLessonState("opening-hand");
  const reading = createLessonState("read-a-card");
  it("keeps two topics and both lesson checkpoints when writes overlap", () => {
    const one = { ...saveLessonProgress(empty, advance(opening)), readTopicIds: ["what-is-riftbound"] };
    const two = { ...saveLessonProgress(empty, advance(reading)), readTopicIds: ["board-layout"] };
    const merged = mergeCourseProgress(empty, two, one);
    expect(merged.readTopicIds).toEqual(["what-is-riftbound", "board-layout"]);
    expect(merged.lessons).toEqual({ ...one.lessons, ...two.lessons });
    expect(merged.lastLessonId).toBe("read-a-card");
  });
  it("keeps a newer checkpoint or completion when an older tab advances", () => {
    const one = advance(reading);
    const two = advance(one);
    const saved = saveLessonProgress(empty, two);
    expect(mergeCourseProgress(empty, saveLessonProgress(empty, one), saved).lessons).toEqual(saved.lessons);
    let completed = two;
    while (!completed.completed) completed = advance(completed);
    const finished = saveLessonProgress(empty, completed);
    expect(mergeCourseProgress(empty, saveLessonProgress(empty, one), finished).completedLessonIds).toEqual(["read-a-card"]);
  });
  it("saves an intentional Back and Restart alongside another tab's unrelated edits", () => {
    const two = advance(advance(reading));
    const base = saveLessonProgress(empty, two);
    const other = saveLessonProgress(base, advance(opening));
    for (const state of [undoTutorialAction(two), createLessonState("read-a-card")]) {
      const merged = mergeCourseProgress(base, saveLessonProgress(base, state), other);
      expect(merged.lessons["read-a-card"].actions).toEqual(state.actions);
      expect(merged.lessons["opening-hand"]).toEqual(other.lessons["opening-hand"]);
    }
  });
});
