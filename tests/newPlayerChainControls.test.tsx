import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtlasTutorialBoard } from "../src/renderer/new-player/AtlasTutorialBoard";
import { applyTutorialAction, createLessonState, getTutorialStep } from "../src/shared/newPlayerTutorial";

function renderStep(lessonId: string, stepNumber: number, practiceHelpLevel: 0 | 1 | 2 = 0) {
  let state = createLessonState(lessonId);
  for (let number = 1; number < stepNumber; number++) {
    state = applyTutorialAction(state, getTutorialStep(state)!.expectedAction);
  }
  const step = getTutorialStep(state)!;
  const board = renderToStaticMarkup(
    <AtlasTutorialBoard state={state} step={step} practiceHelpLevel={practiceHelpLevel} onAction={() => undefined} />
  );
  const list = board.match(/<ol\b[^>]*class="atb-chain-items"[^>]*>([\s\S]*?)<\/ol>/)?.[1];
  expect(list, "The learner should see the waiting chain").toBeDefined();
  const buttons = list!.match(/<button\b[^>]*data-chain-card-id="[^"]+"[^>]*>/g) ?? [];
  return { step, board, list, buttons };
}

describe("guided game chain controls", () => {
  it.each([
    ["the-chain", 6, "o-discipline", "Discipline"],
    ["countering-spells", 2, "o-rune-prison", "Rune Prison"],
  ] as const)("guides inspection to the waiting spell in %s", (lessonId, stepNumber, instanceId, name) => {
    const { step, board, buttons } = renderStep(lessonId, stepNumber);
    expect(step.expectedAction).toEqual({ type: "inspect", cardId: instanceId });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toContain(`data-chain-card-id="${instanceId}"`);
    expect(buttons[0]).toContain(`aria-label="Inspect ${name} → Watchful Sentry on the chain"`);
    expect(buttons[0]).toContain('data-guide-target="true"');
    expect(buttons[0]).not.toContain("disabled");
    expect(board.match(/data-guide-target="true"/g)).toHaveLength(1);
  });

  it("keeps the practice spell available before the learner requests the next move", () => {
    for (const level of [0, 1, 2] as const) {
      const { buttons } = renderStep("practice-reactions", 6, level);
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toContain('data-chain-card-id="o-discipline"');
      expect(buttons[0]).not.toContain("disabled");
      expect(buttons[0].includes('data-guide-target="true"')).toBe(level === 2);
    }
  });

  it("keeps the two copies of Discipline separately addressable in resolution order", () => {
    const { buttons } = renderStep("the-chain", 10);
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain('data-chain-card-id="p-discipline-2"');
    expect(buttons[1]).toContain('data-chain-card-id="o-discipline"');
  });

  it("distinguishes a waiting spell from the ability underneath it", () => {
    const { buttons, list } = renderStep("unit-play-effects", 9);
    expect(list).toContain("Thousand-Tailed Watcher");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toContain('data-chain-card-id="o-star-crossed"');
  });
});
