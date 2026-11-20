import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtlasTutorialBoard } from "../src/renderer/new-player/AtlasTutorialBoard";
import { applyTutorialAction, createLessonState, getTutorialStep, type TutorialState } from "../src/shared/newPlayerTutorial";

const renderBoard = (state: TutorialState, mode: "tutorial" | "explore" = "tutorial") => renderToStaticMarkup(<AtlasTutorialBoard state={state} onAction={() => undefined} mode={mode} />);

describe("battlefield scoring status", () => {
  it("shows each player's scoring separately from battlefield control", () => {
    const state = createLessonState("holding");
    const field = state.board.battlefields[0];
    field.controller = "opponent";
    field.scoredBy = ["player"];
    const markup = renderBoard(state);
    expect(markup).toContain(`You have already scored ${field.name} this turn`);
    expect(markup).toContain(`The guide has not scored ${field.name} this turn`);
    expect(markup).toContain(`Controlled by ${state.board.players.opponent.name}`);
    field.scoredBy.push("opponent");
    const both = renderBoard(state);
    expect(both).toContain(`You have already scored ${field.name} this turn`);
    expect(both).toContain(`The guide has already scored ${field.name} this turn`);
    expect(both).not.toContain("point available");
  });
  it("shows both records cleared when the game moves to a new turn", () => {
    let state = createLessonState("play-first-unit");
    while (getTutorialStep(state)?.expectedAction.type !== "end-turn") {
      const step = getTutorialStep(state);
      if (!step) throw new Error("The first unit lesson must teach ending a turn");
      state = applyTutorialAction(state, step.expectedAction);
    }
    state.board.battlefields[0].scoredBy = ["player", "opponent"];
    const next = applyTutorialAction(state, { type: "end-turn" });
    expect(next.board.turn).toBeGreaterThan(state.board.turn);
    const field = next.board.battlefields[0];
    const markup = renderBoard(next);
    expect(markup).toContain(`You have not scored ${field.name} this turn`);
    expect(markup).toContain(`The guide has not scored ${field.name} this turn`);
  });
  it("marks a battlefield scored when the final-point rule draws instead of giving a point", () => {
    let state = createLessonState("win-the-game");
    while (getTutorialStep(state)?.expectedAction.type !== "score") {
      const step = getTutorialStep(state);
      if (!step) throw new Error("The winning lesson must teach scoring");
      state = applyTutorialAction(state, step.expectedAction);
    }
    expect(state.board.players.player.score).toBe(7);
    const next = applyTutorialAction(state, getTutorialStep(state)!.expectedAction);
    expect(next.board.players.player.score).toBe(7);
    const field = next.board.battlefields.find(item => item.scoredBy.includes("player"))!;
    expect(renderBoard(next)).toContain(`You have already scored ${field.name} this turn`);
  });
  it("does not add scoring history to setup or the inspection-only Basics board", () => {
    expect(renderBoard(createLessonState("table-setup"))).not.toContain('class="atb-scored-status"');
    expect(renderBoard(createLessonState("holding"), "explore")).not.toContain('class="atb-scored-status"');
  });
});
