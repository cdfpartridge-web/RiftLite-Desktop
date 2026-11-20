import { describe, expect, it } from "vitest";
import { LESSONS } from "../src/shared/newPlayerTutorial";
import { newPlayerMilestoneProgress } from "../src/shared/newPlayerMilestones";

describe("beginner capability milestones", () => {
  it("covers every first-game lesson exactly once, including the reordered chain prerequisite", () => {
    const milestones = newPlayerMilestoneProgress([]);
    expect(milestones.flatMap(item => item.lessons.map(lesson => lesson.id))).toEqual(LESSONS.filter(lesson => (lesson.path ?? "first-game") === "first-game").map(lesson => lesson.id));
    expect(milestones.every(item => item.lessons.length > 0 && !item.complete)).toBe(true);
  });
  it("keeps the scoring limit inside the conquer-and-hold milestone", () => {
    const milestone = newPlayerMilestoneProgress([]).find(item => item.id === "conquer-and-hold")!;
    expect(milestone.lessons.at(-1)?.id).toBe("scoring-once-per-turn");
    expect(milestone.lessons.some(lesson => lesson.id === "holding")).toBe(true);
    const priorLessons = milestone.lessons.filter(lesson => lesson.id !== "scoring-once-per-turn").map(lesson => lesson.id);
    const incomplete = newPlayerMilestoneProgress(priorLessons).find(item => item.id === "conquer-and-hold")!;
    expect(incomplete.complete).toBe(false);
    expect(incomplete.nextLesson?.id).toBe("scoring-once-per-turn");
  });
  it("does not award a capability for jumping to the final lesson; resume finds the missing prerequisite", () => {
    const milestone = newPlayerMilestoneProgress(["power-and-champion"])[0];
    expect(milestone.complete).toBe(false);
    expect(milestone.nextLesson?.id).toBe("table-setup");
    const completed = newPlayerMilestoneProgress(milestone.lessons.map(lesson => lesson.id))[0];
    expect(completed.complete).toBe(true);
    expect(completed.nextLesson).toBeUndefined();
  });
});
