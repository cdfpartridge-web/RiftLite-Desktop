import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUIDE_SETTLE_MS, guideNarrationDelay, guideNarrationPages, guideMoveOutcome, scheduleGuideNarration, parseGuideNarrationMode } from "../src/shared/newPlayerNarration.js";
import { LESSONS, applyTutorialAction, createLessonState, getTutorialStep } from "../src/shared/newPlayerTutorial.js";

describe("paced guide narration", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("retains every word of every automatic explanation in short reading parts", () => {
    for (const lesson of LESSONS) for (const step of lesson.steps) {
      if (step.actor !== "guide" && step.actor !== "rules") continue;
      const pages = guideNarrationPages(step.instruction);
      expect(pages.join(" "), `${lesson.id}:${step.id}`).toBe(step.instruction.trim().replace(/\s+/g, " "));
      expect(pages.every(page => page.split(/\s+/).length <= 32)).toBe(true);
    }
  });
  it("shows actual outcomes without changing the model or exposing concealed guide cards", () => {
    let state = createLessonState("first-conquest");
    while (!state.completed) {
      const step = getTutorialStep(state)!;
      const before = structuredClone(state.board);
      const next = applyTutorialAction(state, step.expectedAction);
      if (step.actor === "guide" || step.actor === "rules") {
        const pages = guideMoveOutcome(before, next.board);
        expect(pages.every(page => page.split(/\s+/).length <= 32)).toBe(true);
        expect(state.board).toEqual(before);
      }
      expect(next.actions.length).toBeGreaterThan(state.actions.length);
      state = next;
    }
    const before = structuredClone(state.board), after = structuredClone(state.board);
    const hidden = after.cards.find(card => card.owner === "opponent")!;
    const old = before.cards.find(card => card.instanceId === hidden.instanceId)!;
    old.zone = "deck"; hidden.zone = "hand"; hidden.faceDown = true;
    const text = guideMoveOutcome(before, after).join(" ");
    expect(text).toContain("A face-down card");
    expect(text).not.toContain(hidden.name);
    const drawn = structuredClone(hidden); drawn.instanceId = "new-concealed-draw"; drawn.name = "Secret card"; drawn.faceDown = false;
    after.cards.push(drawn);
    const drawnText = guideMoveOutcome(before, after).join(" ");
    expect(drawnText).toContain("1 new card is now in the guide’s hand");
    expect(drawnText).not.toContain("Secret card");
  });
  it("gives every guide move the requested six-second reading pause", () => {
    expect(guideNarrationDelay("Draw one card.")).toBe(6_000);
    expect(guideNarrationDelay("The guide exhausts a Calm rune for one energy. Watch the rune turn sideways and the available energy increase.")).toBe(6_000);
    expect(guideNarrationDelay("word ".repeat(100))).toBe(6_000);
    expect(guideNarrationDelay("")).toBe(6_000);
    expect(GUIDE_SETTLE_MS).toBeLessThan(1_000);
  });
  it("never applies a guide move early and only applies it once", () => {
    const advance = vi.fn();
    scheduleGuideNarration(4_000, () => true, advance);
    vi.advanceTimersByTime(3_999); expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(advance).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000); expect(advance).toHaveBeenCalledTimes(1);
  });
  it("gives longer explanations more reading time without changing the six-second default", () => {
    expect(guideNarrationDelay("Draw one card.", "reading")).toBe(10_000);
    expect(guideNarrationDelay("word ".repeat(65), "reading")).toBe(31_250);
    expect(guideNarrationDelay("word ".repeat(65))).toBe(6_000);
    expect(guideNarrationDelay("Watch the board.", "manual")).toBeNull();
  });
  it("restores only supported device preferences", () => {
    expect(parseGuideNarrationMode("manual")).toBe("manual");
    expect(parseGuideNarrationMode("reading")).toBe("reading");
    expect(parseGuideNarrationMode(null)).toBe("automatic");
    expect(parseGuideNarrationMode("unexpected")).toBe("automatic");
  });
  it("cancels a queued move when paused, rewound or navigated away", () => {
    const advance = vi.fn(), cancel = scheduleGuideNarration(4_000, () => true, advance);
    vi.advanceTimersByTime(2_000); cancel(); vi.advanceTimersByTime(20_000);
    expect(advance).not.toHaveBeenCalled();
  });
  it("rechecks the current checkpoint even if a timer survives an unrelated state change", () => {
    let checkpoint = "lesson-a:4"; const advance = vi.fn();
    scheduleGuideNarration(4_000, () => checkpoint === "lesson-a:4", advance);
    checkpoint = "lesson-b:0"; vi.advanceTimersByTime(4_000);
    expect(advance).not.toHaveBeenCalled();
  });
  it("restarting the same checkpoint uses a fresh reading interval", () => {
    const advance = vi.fn();
    const cancel = scheduleGuideNarration(4_000, () => true, advance);
    vi.advanceTimersByTime(3_000); cancel();
    scheduleGuideNarration(4_000, () => true, advance);
    vi.advanceTimersByTime(3_999); expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(advance).toHaveBeenCalledTimes(1);
  });
});
