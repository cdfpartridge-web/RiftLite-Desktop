import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  CoachQuestCard,
  type CoachQuestViewModel
} from "../src/renderer/CoachQuestCard";

function quest(overrides: Partial<CoachQuestViewModel> = {}): CoachQuestViewModel {
  return {
    id: "turn-two-discipline",
    category: "sequencing",
    title: "Spend turn two developing the board",
    status: "active",
    when: "You have a two-cost unit in your opening hand",
    rule: "Play it before holding mana for a lower-impact trick",
    why: "You developed on turn two in only two of your last five eligible games.",
    metric: {
      label: "Turn-two development",
      numerator: 2,
      denominator: 5,
      tone: "negative",
      comparator: {
        label: "Your usual rate",
        numerator: 7,
        denominator: 10
      }
    },
    art: {
      card: { name: "Charm", url: "riftlite://card/charm.webp" },
      legend: { name: "Rengar" },
      battlefield: { name: "Brush" }
    },
    evidenceActions: [{
      id: "game-2-turn-2",
      label: "Watch the missed turn-two window",
      detail: "Game 2 · 03:14",
      tone: "warning"
    }],
    challenge: {
      games: [
        { state: "success", label: "Rule followed" },
        { state: "missed", label: "Rule missed" },
        { state: "active", label: "Current game" }
      ]
    },
    shareCaption: "Rengar vs Kennen",
    ...overrides
  };
}

describe("CoachQuestCard", () => {
  it("renders the visual metric and comparison as accessible charts", () => {
    const markup = renderToStaticMarkup(<CoachQuestCard quest={quest()} />);

    expect(markup).toContain('class="coach-quest-metric"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('class="coach-quest-sr-only">Turn-two development</span>');
    expect(markup).toContain("2 out of 5, or 40 percent.");
    expect(markup).toMatch(/role="img" aria-labelledby="coach-quest-chart-title-[^"]+ coach-quest-chart-description-[^"]+"/);
    expect(markup).toContain('class="coach-quest-metric__bar-primary" style="width:40%"');
    expect(markup).toContain('class="coach-quest-metric__marker" style="left:70%"');
    expect(markup).toContain("-30 percentage points from the comparison");
    expect(markup).not.toContain("<circle");
  });

  it("describes all three challenge games independently of their visual runes", () => {
    const markup = renderToStaticMarkup(<CoachQuestCard quest={quest()} />);

    expect(markup).toContain('aria-label="Three-game challenge progress"');
    expect(markup).toContain('data-state="success"');
    expect(markup).toContain('data-state="missed"');
    expect(markup).toContain('data-state="active"');
    expect(markup).toContain("Game 1: Rule followed");
    expect(markup).toContain("Game 2: Rule missed");
    expect(markup).toContain("Game 3: Current game");
    expect(markup).toContain("1 followed · 2 reviewed");
  });

  it("turns the quest into an inert branded social card in share-preview mode", () => {
    const markup = renderToStaticMarkup(
      <CoachQuestCard
        quest={quest()}
        mode="share-preview"
        onStart={vi.fn()}
        onReview={vi.fn()}
        onLab={vi.fn()}
        onContext={vi.fn()}
        onShare={vi.fn()}
      />
    );

    expect(markup).toContain('data-mode="share-preview"');
    expect(markup).toContain("Rengar vs Kennen");
    expect(markup).toContain("RiftLite <i>Coach</i>");
    expect(markup).not.toContain("Start 3-game challenge");
    expect(markup).not.toContain("Continue challenge");
    expect(markup).not.toContain("Practise in Lab");
    expect(markup).not.toContain('aria-label="Share coaching quest"');
    expect(markup).not.toContain("See the full context");
    expect(markup).not.toContain("<button");
  });

  it("uses one deliberate fallback instead of inventing missing art tiles", () => {
    const markup = renderToStaticMarkup(
      <CoachQuestCard
        quest={quest({
          art: {
            card: { name: "Charm" },
            legend: { name: "Rengar" },
            battlefield: { name: "Brush" }
          }
        })}
      />
    );

    expect(markup).toContain('role="img" aria-label="Charm artwork unavailable"');
    expect(markup).not.toContain('aria-label="Rengar artwork unavailable"');
    expect(markup).not.toContain('aria-label="Brush artwork unavailable"');
    expect(markup).toContain('<span aria-hidden="true">S</span>');
    expect(markup.match(/coach-quest-art__fallback/g)).toHaveLength(1);
  });
});
