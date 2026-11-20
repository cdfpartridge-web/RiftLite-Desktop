import { applyTutorialAction, getTutorialActionBattlefield, getTutorialStep, type TutorialBoard, type TutorialCard, type TutorialDomain, type TutorialSide, type TutorialState, type TutorialStep } from "../../shared/newPlayerTutorial";

const DOMAINS: TutorialDomain[] = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];
const isIntroduction = (step: TutorialStep) => step.presentation && step.presentation !== "keyword-scenario";

export interface TutorialPaymentTeaching {
  card: TutorialCard;
  energy: number;
  power: Array<{ domain: TutorialDomain; amount: number; available: number; rune?: TutorialCard }>;
  availableEnergy: number;
  printedPowerRune?: TutorialCard;
  alteredCost: boolean;
  hidden: boolean;
  nextRune?: TutorialCard;
  runeGesture?: "exhaust" | "recycle";
}

/** Read-only replay keeps the visual tied to the authored payment, including discounts.
 * Stop at decisions, other plays and turn boundaries; never predict a hidden guide card. */
export function getTutorialPaymentTeaching(state: TutorialState, step?: TutorialStep): TutorialPaymentTeaching | null {
  if (!step || isIntroduction(step) || step.actor === "guide" || step.actor === "rules") return null;
  const first = step.boardAction ?? step.expectedAction;
  if (!["exhaust", "recycle", "play", "continue", "inspect"].includes(first.type)) return null;
  let cursor = state;
  for (let index = 0; index < 12; index++) {
    const current = getTutorialStep(cursor);
    if (!current || isIntroduction(current) || current.actor === "guide" || current.actor === "rules") return null;
    const action = current.boardAction ?? current.expectedAction;
    if (action.type === "play") {
      const card = state.board.cards.find(item => item.instanceId === action.cardId);
      if (!card || card.owner !== "player" || !["hand", "champion", "hidden"].includes(card.zone)) return null;
      const paid = applyTutorialAction(cursor, current.expectedAction);
      if (paid.actions.length !== cursor.actions.length + 1) return null;
      const before = cursor.board.players.player, after = paid.board.players.player;
      const energy = Math.max(0, before.energy - after.energy);
      const power = DOMAINS.flatMap(domain => {
        const amount = (before.power[domain] ?? 0) - (after.power[domain] ?? 0);
        return amount > 0 ? [{ domain, amount, available: state.board.players.player.power[domain] ?? 0,
          rune: state.board.cards.find(item => item.owner === "player" && item.type === "rune" && item.domain === domain) }] : [];
      });
      const nextRune = "cardId" in first ? state.board.cards.find(item => item.instanceId === first.cardId && item.type === "rune") : undefined;
      return { card, energy, power, availableEnergy: state.board.players.player.energy,
        printedPowerRune: state.board.cards.find(item => item.owner === "player" && item.type === "rune" && item.domain === card.domain),
        alteredCost: energy !== card.energyCost || power.reduce((total, item) => total + item.amount, 0) !== card.powerCost || power.some(item => item.domain !== card.domain),
        hidden: card.zone === "hidden", nextRune,
        runeGesture: first.type === "exhaust" || first.type === "recycle" ? first.type : undefined };
    }
    if (!["exhaust", "recycle", "continue", "inspect"].includes(action.type)) return null;
    const next = applyTutorialAction(cursor, current.expectedAction);
    if (next.actions.length !== cursor.actions.length + 1) return null;
    cursor = next;
  }
  return null;
}

export interface TutorialScoringTeaching {
  field: TutorialBoard["battlefields"][number];
  side: TutorialSide;
  pending: boolean;
  beforeScore: number;
  afterScore: number;
  alreadyScored: boolean;
  result: "point" | "draw" | "already-scored";
  method: "hold" | "conquer" | "regain";
}

function scoringChange(before: TutorialBoard, after: TutorialBoard, pending: boolean): TutorialScoringTeaching | null {
  if (before.turn !== after.turn || before.keywordScenario?.id !== after.keywordScenario?.id) return null;
  for (const field of after.battlefields) {
    const old = before.battlefields.find(item => item.id === field.id);
    if (!old) continue;
    const side = field.scoredBy.find(item => !old.scoredBy.includes(item));
    if (side) {
      const beforeScore = before.players[side].score, afterScore = after.players[side].score;
      if (afterScore > beforeScore || after.players[side].deckCount < before.players[side].deckCount) {
        return { field, side, pending, beforeScore, afterScore, alreadyScored: false,
          result: afterScore > beforeScore ? "point" : "draw", method: before.phase === "Beginning" ? "hold" : "conquer" };
      }
    }
    if (before.phase === "Conquer" && field.controller && field.controller !== old.controller && old.scoredBy.includes(field.controller)) {
      const owner = field.controller;
      return { field, side: owner, pending, beforeScore: before.players[owner].score, afterScore: after.players[owner].score,
        alreadyScored: true, result: "already-scored", method: "regain" };
    }
  }
  return null;
}

export function getTutorialScoringTeaching(state: TutorialState, step?: TutorialStep): TutorialScoringTeaching | null {
  if (step && isIntroduction(step)) return null;
  const action = step?.boardAction ?? step?.expectedAction;
  if (action?.type === "score" && step) {
    const next = applyTutorialAction(state, step.expectedAction);
    if (next.actions.length === state.actions.length + 1 && getTutorialActionBattlefield(state, step)) return scoringChange(state.board, next.board, true);
  }
  const before = state.history.at(-1);
  return before ? scoringChange(before, state.board, false) : null;
}
