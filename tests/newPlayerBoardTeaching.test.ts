import { describe, expect, it } from "vitest";
import { applyTutorialAction, createLessonState, getTutorialStep, type TutorialState, type TutorialStep } from "../src/shared/newPlayerTutorial";
import { getTutorialPaymentTeaching, getTutorialScoringTeaching } from "../src/renderer/new-player/atlasBoardTeaching";

function atStep(lesson: string, target: string | ((step: TutorialStep, state: TutorialState) => boolean)) {
  let state = createLessonState(lesson);
  for (let count = 0; count < 400; count++) {
    const step = getTutorialStep(state);
    if (!step) throw new Error(`Missing step in ${lesson}`);
    if (typeof target === "string" ? step.id === target : target(step, state)) return state;
    const next = applyTutorialAction(state, step.expectedAction);
    if (next.actions.length !== state.actions.length + 1) throw new Error(`Invalid fixture at ${step.id}: ${next.feedback}`);
    state = next;
  }
  throw new Error("Fixture exceeded the course length");
}
const payment = (state: TutorialState) => getTutorialPaymentTeaching(state, getTutorialStep(state) ?? undefined);
const scoring = (state: TutorialState) => getTutorialScoringTeaching(state, getTutorialStep(state) ?? undefined);

describe("board payment teaching", () => {
  it("connects both Sentry energy steps to its real printed cost without changing the board", () => {
    const state = atStep("play-first-unit", "energy-1"), saved = JSON.stringify(state);
    const view = payment(state)!;
    expect(view.card.name).toBe("Watchful Sentry");
    expect(view.energy).toBe(2); expect(view.card.energyCost).toBe(2);
    expect(view.power).toEqual([]); expect(view.availableEnergy).toBe(0);
    expect(view.runeGesture).toBe("exhaust");
    expect(JSON.stringify(state)).toBe(saved);
    expect(payment(applyTutorialAction(state, getTutorialStep(state)!.expectedAction))!.availableEnergy).toBe(1);
  });
  it("shows matching Mind power alongside energy while recycling the exhausted rune", () => {
    const view = payment(atStep("power-and-champion", "recycle-mind"))!;
    expect(view.card.name).toBe("Ahri, Inquisitive");
    expect(view.energy).toBe(3); expect(view.availableEnergy).toBe(3);
    expect(view.power.map(item => [item.domain, item.amount, item.available])).toEqual([["Mind", 1, 0]]);
    expect(view.printedPowerRune?.domain).toBe("Mind"); expect(view.nextRune?.ready).toBe(false);
    expect(view.runeGesture).toBe("recycle");
  });
  it("separates the printed cost from Legion’s discounted payment", () => {
    const state = atStep("keyword-growth", (step, state) => {
      const action = step.boardAction ?? step.expectedAction;
      return step.keywordScenarioId?.includes("legion") === true && action.type === "play" && state.board.cards.find(card => card.instanceId === action.cardId)?.cardId === "OGN-012";
    });
    const view = payment(state)!;
    expect(view.card.energyCost).toBe(4); expect(view.energy).toBe(2); expect(view.alteredCost).toBe(true);
  });
  it("does not charge a hidden card’s printed cost a second time", () => {
    const view = payment(atStep("hidden-cards", "hidden-play"))!;
    expect(view.hidden).toBe(true); expect(view.energy).toBe(0); expect(view.power).toEqual([]); expect(view.alteredCost).toBe(true);
  });
});

describe("board scoring teaching", () => {
  it("shows a holding point as one use of that battlefield’s scoring allowance", () => {
    const before = atStep("scoring-once-per-turn", "limit-first-hold");
    expect(scoring(before)).toMatchObject({pending:true,method:"hold",beforeScore:1,afterScore:2,result:"point"});
    const after = applyTutorialAction(before, getTutorialStep(before)!.expectedAction);
    expect(scoring(after)).toMatchObject({pending:false,beforeScore:1,afterScore:2,result:"point"});
  });
  it("explicitly distinguishes regaining control from another point", () => {
    const before = atStep("scoring-once-per-turn", "limit-regain-control");
    const after = applyTutorialAction(before, getTutorialStep(before)!.expectedAction);
    expect(scoring(after)).toMatchObject({pending:false,method:"regain",alreadyScored:true,beforeScore:2,afterScore:2,result:"already-scored"});
  });
  it("shows the seven-point draw as a used score, not a gained point", () => {
    const before = atStep("win-the-game", step => step.expectedAction.type === "score");
    expect(scoring(before)).toMatchObject({pending:true,result:"draw",beforeScore:7,afterScore:7});
  });
});
