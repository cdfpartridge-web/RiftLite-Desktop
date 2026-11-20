import { describe, expect, it } from "vitest";
import { initialNewPlayerProgress, nextGuidedLesson, parseNewPlayerProgress, saveLessonProgress, serializeNewPlayerProgress } from "../src/shared/newPlayerProgress.js";
import { applyTutorialAction, createLessonState, getTutorialStep, LESSONS } from "../src/shared/newPlayerTutorial.js";

function playLesson(id: string, moves = Infinity) {
  let state = createLessonState(id);
  while (!state.completed && state.actions.length < moves) {
    state = applyTutorialAction(state, getTutorialStep(state)!.expectedAction);
  }
  return state;
}

describe("the next guided lesson", () => {
  it("keeps a learner on their saved step even while Basics is unfinished", () => {
    const saved = saveLessonProgress(initialNewPlayerProgress(), playLesson("opening-hand", 2));
    const restored = parseNewPlayerProgress(serializeNewPlayerProgress(saved));
    expect(restored.readTopicIds).toEqual([]);
    expect(nextGuidedLesson(restored)?.id).toBe("opening-hand");
    expect(restored.lessons["opening-hand"].actions).toHaveLength(2);
  });

  it("skips a completed neighbour when continuing and after reopening", () => {
    const withSecondDone = saveLessonProgress(initialNewPlayerProgress(), playLesson(LESSONS[1].id));
    const bothDone = saveLessonProgress(withSecondDone, playLesson(LESSONS[0].id));
    expect(nextGuidedLesson(bothDone)?.id).toBe(LESSONS[2].id);
    expect(nextGuidedLesson(parseNewPlayerProgress(serializeNewPlayerProgress(bothDone)))?.id).toBe(LESSONS[2].id);
  });

  it("continues decision practice past a completed first practice", () => {
    const firstGame = LESSONS.filter(lesson => (lesson.path ?? "first-game") === "first-game");
    const practice = LESSONS.filter(lesson => lesson.path === "practice");
    const progress = initialNewPlayerProgress();
    progress.completedLessonIds = [...firstGame.map(lesson => lesson.id), practice[0].id];
    progress.lastLessonId = firstGame.at(-1)!.id;
    expect(nextGuidedLesson(progress)?.id).toBe(practice[1].id);
  });

  it("returns to a skipped lesson in the same path and ends after every lesson is done", () => {
    const firstGame = LESSONS.filter(lesson => (lesson.path ?? "first-game") === "first-game");
    const progress = initialNewPlayerProgress();
    progress.completedLessonIds = firstGame.slice(1).map(lesson => lesson.id);
    progress.lastLessonId = firstGame.at(-1)!.id;
    expect(nextGuidedLesson(progress)?.id).toBe(firstGame[0].id);
    progress.completedLessonIds = LESSONS.map(lesson => lesson.id);
    expect(nextGuidedLesson(progress)).toBeUndefined();
  });
});
