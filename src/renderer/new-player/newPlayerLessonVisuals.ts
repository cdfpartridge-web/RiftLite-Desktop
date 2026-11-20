import type { TutorialDomain } from "../../shared/newPlayerTutorial";

/** Presentation only: illustrations do not change the lesson or its saved actions. */
export type LessonVisualKind = "setup" | "mulligan" | "turn" | "read" | "pay" | "power" | "move" | "score" | "hold" | "combat" | "chain" | "counter" | "hidden" | "win" | "equipment" | "growth" | "deck";

export interface LessonVisual {
  kind: LessonVisualKind;
  cardId: string;
  secondCardId?: string;
  from: string;
  to: string;
  summary: string;
  completion: string;
}

/** Actual rune card IDs, for the same artwork resolver as the lesson cards. */
export const TUTORIAL_RUNE_ART: Record<TutorialDomain, string> = {
  Fury: "OGN-007",
  Calm: "OGN-042",
  Mind: "OGN-089",
  Body: "OGN-126",
  Chaos: "OGN-166",
  Order: "OGN-214",
};

export const LESSON_VISUALS: Record<string, LessonVisual> = {
  "table-setup": {
    kind: "setup", cardId: "OGN-255", secondCardId: "OGN-119",
    from: "Your legend", to: "Your chosen champion",
    summary: "Put each piece in its place so you know where to look when play begins.",
    completion: "You placed your legend, chosen champion, decks and battlefields, and found the spaces used during a game.",
  },
  "opening-hand": {
    kind: "mulligan", cardId: "OGN-119", secondCardId: "OGN-096",
    from: "A later play", to: "Look for an early play",
    summary: "Replace an expensive opening card for another chance at something you can play early.",
    completion: "You practised a mulligan: setting a card aside, drawing its replacement, then recycling the original.",
  },
  "first-or-second": {
    kind: "turn", cardId: "OGN-089", secondCardId: "OGN-096",
    from: "Awaken · Beginning", to: "Channel · Draw",
    summary: "Follow ABCD to prepare your cards and resources before choosing a play.",
    completion: "You carried out your first turn’s ABCD steps and compared the first and second players’ starting runes.",
  },
  "read-a-card": {
    kind: "read", cardId: "OGN-096", secondCardId: "OGN-058",
    from: "Cost and Might", to: "Rules and timing",
    summary: "Find what a card costs and does before deciding how to use it.",
    completion: "You found Sentry’s energy cost and Might, then checked the timing on Discipline.",
  },
  "play-first-unit": {
    kind: "pay", cardId: "OGN-089", secondCardId: "OGN-096",
    from: "Make 2 energy", to: "Play Sentry in base",
    summary: "Use two runes to pay for a unit that can help you on a later turn.",
    completion: "You made 2 energy, spent it on Watchful Sentry and saw the unit enter base exhausted.",
  },
  "power-and-champion": {
    kind: "power", cardId: "OGN-089", secondCardId: "OGN-119",
    from: "Energy and Mind power", to: "Pay both parts",
    summary: "Take a rune’s energy before recycling it, then pay Ahri’s number and matching symbol.",
    completion: "You recycled a used Mind rune, kept the energy already made and paid both costs to play Ahri.",
  },
  "move-to-battlefield": {
    kind: "move", cardId: "OGN-096", secondCardId: "OGN-282",
    from: "Ready in base", to: "Exhausted at a battlefield",
    summary: "Move a ready unit onto a battlefield to open a showdown and work towards a point.",
    completion: "You moved Sentry from base to a battlefield and opened a showdown; arriving alone did not award a point.",
  },
  "first-conquest": {
    kind: "score", cardId: "OGN-096", secondCardId: "OGN-282",
    from: "Finish the showdown", to: "Conquer for 1 point",
    summary: "Finish both players’ chances to respond before recording your point for conquering.",
    completion: "You finished the showdown, gained control of the battlefield and recorded your first point for conquering.",
  },
  "practice-first-point": {
    kind: "score", cardId: "OGN-096", secondCardId: "OGN-282",
    from: "Prepare and play", to: "Ready, move and score",
    summary: "Connect two turns into one plan: play a unit, then ready it and conquer.",
    completion: "You carried out your turn-start steps, paid for Sentry and used it on a later turn to conquer.",
  },
  holding: {
    kind: "hold", cardId: "OGN-096", secondCardId: "OGN-282",
    from: "Keep control", to: "Score during Beginning",
    summary: "Keep your battlefield through the guide’s turn, then score and add another defender.",
    completion: "You scored for holding during Beginning and played another Sentry directly onto a battlefield you controlled.",
  },
  "scoring-once-per-turn": {
    kind: "score", cardId: "OGN-044", secondCardId: "OGN-282",
    from: "Already scored here", to: "Try the other battlefield",
    summary: "Track each player’s score at each battlefield so changing control does not create an extra point.",
    completion: "You checked separate scoring records for each player and battlefield, including their reset when a new turn begins.",
  },
  "plan-your-main": {
    kind: "move", cardId: "SFD-074", secondCardId: "OGN-044",
    from: "Check your options", to: "Make useful plays",
    summary: "Use readiness and resources to make a plan instead of stopping after one action.",
    completion: "You moved an existing unit, made another useful play and chose when your Main phase was finished.",
  },
  "simple-combat": {
    kind: "combat", cardId: "SFD-074", secondCardId: "OGN-044",
    from: "3 Might attacks", to: "2 Might defends",
    summary: "Compare both units’ Might to predict who survives when they deal damage together.",
    completion: "You predicted and checked simultaneous combat damage, including an even fight where neither unit survived.",
  },
  "group-movement": {
    kind: "move", cardId: "SFD-074", secondCardId: "OGN-044",
    from: "Two ready units", to: "One group move",
    summary: "Move two ready units together so their combined Might can overcome the defender.",
    completion: "You moved Pickpocket and Keeper together, combined their damage and conquered with the surviving Keeper.",
  },
  "damage-and-might": {
    kind: "combat", cardId: "OGN-065", secondCardId: "SFD-074",
    from: "4 Might", to: "4 Might · 3 damage",
    summary: "Keep Might and marked damage separate to see why a damaged unit can still fight at full strength.",
    completion: "You saw Elder keep its 4 Might with 3 damage marked, then remove that damage during cleanup.",
  },
  "start-combat": {
    kind: "combat", cardId: "OGN-119", secondCardId: "OGN-096",
    from: "Challenge a defender", to: "Handle the attack ability",
    summary: "Move Ahri into a defended battlefield and resolve her attack ability before the open showdown.",
    completion: "You attacked with Ahri, chose her ability’s target and handled the trigger before continuing the showdown.",
  },
  "the-chain": {
    kind: "chain", cardId: "OGN-058", secondCardId: "OGN-119",
    from: "An effect is waiting", to: "Your response goes above",
    summary: "Respond before the waiting spell happens, then resolve the newest effect first.",
    completion: "You answered Discipline with your own Reaction and resolved both spells in order, newest first.",
  },
  "ready-runes-and-defenders": {
    kind: "pay", cardId: "OGN-042", secondCardId: "OGN-044",
    from: "Keep runes ready", to: "Help your defender later",
    summary: "Save ready runes for a response and see that an exhausted unit still defends.",
    completion: "You compared expiring resource pools with saved ready runes, then used Discipline to help an exhausted defender survive.",
  },
  "countering-spells": {
    kind: "counter", cardId: "OGN-045", secondCardId: "OGN-050",
    from: "Rune Prison is waiting", to: "Defy stops its effect",
    summary: "Target a waiting spell with Defy so its effect never reaches your unit.",
    completion: "You paid for Defy, countered Rune Prison and checked that neither player received their spent resources back.",
  },
  "combat-damage": {
    kind: "combat", cardId: "OGN-119", secondCardId: "OGN-096",
    from: "Assign both sides’ damage", to: "Survivor can conquer",
    summary: "Deal both sides’ damage and check survivors before deciding who can conquer.",
    completion: "You followed damage assignment, saw why Ahri survived and conquered after the defender died.",
  },
  "practice-reactions": {
    kind: "chain", cardId: "OGN-058", secondCardId: "OGN-119",
    from: "Protect your attacker", to: "Finish the fight",
    summary: "Use a response to help Ahri survive, then carry that advantage through to a point.",
    completion: "You paid for a response, resolved the chain and followed the fight through to conquering with Ahri.",
  },
  "win-the-game": {
    kind: "win", cardId: "OGN-096", secondCardId: "OGN-282",
    from: "7 points", to: "Earn point 8",
    summary: "Compare conquering after scoring both battlefields with winning by holding during Beginning.",
    completion: "You tried both final-point routes: conquering after scoring both battlefields that turn, and holding during Beginning.",
  },
  "practice-final-point": {
    kind: "win", cardId: "OGN-096", secondCardId: "SFD-216",
    from: "Two ready Sentries", to: "Score both battlefields",
    summary: "Use both battlefields to earn the final point from conquering in this turn.",
    completion: "You used two ready Sentries to score both battlefields in the same turn and earn point eight.",
  },
  "mulligan-practice": {
    kind: "mulligan", cardId: "OGN-044", secondCardId: "OGN-065",
    from: "Look for an opening plan", to: "Keep or replace",
    summary: "Compare two opening hands and decide which cards help your first few turns.",
    completion: "You kept a hand with an affordable start, then practised replacing two cards in a separate opening hand.",
  },
  "resource-decisions": {
    kind: "pay", cardId: "OGN-044", secondCardId: "OGN-058",
    from: "Add a defender now", to: "Or save a response",
    summary: "Choose how to use your runes and see which options that choice leaves during the attack.",
    completion: "You chose between another defender and a saved response, then carried your chosen plan through the attack.",
  },
  "recovery-practice": {
    kind: "move", cardId: "OGN-044", secondCardId: "OGN-065",
    from: "One battlefield lost", to: "Another route to a point",
    summary: "Find a useful job for your remaining unit instead of repeating an unfavourable fight.",
    completion: "You checked both battlefields after losing one and used Keeper to conquer the other.",
  },
  "buffs-and-bonuses": {
    kind: "growth", cardId: "SFD-074", secondCardId: "OGN-063",
    from: "Several Might bonuses", to: "One actual Buff counter",
    summary: "Compare a Buff counter, temporary Might and Equipment before paying a cost that needs a Buff.",
    completion: "You tracked three different Might bonuses and spent only the actual Buff counter for Monastery’s ability.",
  },
  "equipment-lifecycle": {
    kind: "equipment", cardId: "SFD-022", secondCardId: "OGN-010",
    from: "The bearer leaves", to: "The Equipment remains",
    summary: "Follow Long Sword when its unit leaves the board so you can see how to use it again.",
    completion: "You followed Equipment through its bearer’s death and a separate return-to-hand example, then practised using the detached sword.",
  },
  "champion-destinations": {
    kind: "move", cardId: "OGN-117", secondCardId: "OGN-117",
    from: "Champion in play", to: "Trash or hand",
    summary: "Follow a champion to its actual destination instead of returning it to the champion zone.",
    completion: "You followed Viktor to the trash and hand in separate examples, then paid to play two copies together.",
  },
  "passing-decisions": {
    kind: "chain", cardId: "OGN-058", secondCardId: "OGN-044",
    from: "A chance to respond", to: "Finish the right window",
    summary: "Distinguish passing priority, passing focus and ending your turn so you know what continues next.",
    completion: "You started a chain with a Reaction and distinguished passing priority, passing focus and End Turn.",
  },
  "unit-play-effects": {
    kind: "chain", cardId: "OGN-116", secondCardId: "UNL-128",
    from: "The unit leaves", to: "Its ability still waits",
    summary: "Separate a unit from its waiting ability, then compare what happens when a spell’s target leaves.",
    completion: "You resolved Watcher’s ability after it left the board, then saw Discipline still draw after losing its target.",
  },
  "hidden-cards": {
    kind: "hidden", cardId: "OGN-213", secondCardId: "OGN-282",
    from: "Hide at this battlefield", to: "Respond on a later turn",
    summary: "Prepare Hidden Blade now and keep control so it can answer a later attack at that battlefield.",
    completion: "You hid and played Blade on a later turn, then checked its battlefield restriction and what losing control does.",
  },
  "keywords-in-combat": {
    kind: "combat", cardId: "OGN-240", secondCardId: "OGN-210",
    from: "Assault adds Might", to: "Tank takes damage first",
    summary: "Use the printed keywords to see why these units contribute and receive different amounts of damage.",
    completion: "You saw Assault increase attacking Might and Tank protect Poro, with the attack bonus lasting through conquering and its pending chain.",
  },
  "choose-your-plan": {
    kind: "move", cardId: "SFD-074", secondCardId: "OGN-044",
    from: "Read this position", to: "Carry out your plan",
    summary: "Choose a scoring plan and use familiar rules to carry it through the opponent’s turn.",
    completion: "You chose a plan, made your own moves and carried the result into your next turn with fewer prompts.",
  },
  "keyword-timing": {
    kind: "chain", cardId: "OGN-004", secondCardId: "OGN-058",
    from: "Action in a showdown", to: "Reaction above a spell",
    summary: "Compare Action and Reaction by playing Cleave and answering a waiting spell.",
    completion: "You practised Action and Reaction, including drawing Defy with Discipline and responding again before Cleave resolved.",
  },
  "keyword-combat": {
    kind: "combat", cardId: "OGN-010", secondCardId: "OGN-096",
    from: "Change entry or combat", to: "Check the resulting effect",
    summary: "Try Accelerate, Ambush, Assault, Backline and Deathknell in separate board situations.",
    completion: "You practised paying Accelerate, responding with Ambush, adding Assault Might, assigning around Backline and resolving Deathknell.",
  },
  "keyword-surprises": {
    kind: "growth", cardId: "OGN-213", secondCardId: "OGN-013",
    from: "Check costs and abilities", to: "Apply the change",
    summary: "Try Deflect, Deploy, Disarm, Empower and Empowered to see how each changes the normal play.",
    completion: "You practised Deflect’s extra cost, Deploy’s destination, Disarm’s attack effect and the difference between Empower and Empowered.",
  },
  "keyword-equipment": {
    kind: "equipment", cardId: "SFD-022", secondCardId: "OGN-010",
    from: "Use a different option", to: "Pay and check the result",
    summary: "Try Equip, Flow, Ganking, Hidden and Hunt as new ways to use cards and score.",
    completion: "You attached Equipment, replayed with Flow, moved with Ganking, used Hidden locally and resolved Hunt after scoring.",
  },
  "keyword-growth": {
    kind: "growth", cardId: "OGN-010", secondCardId: "OGN-012",
    from: "Set up the condition", to: "Use the benefit",
    summary: "Try Legion, Level, Quick-Draw, Repeat and Shield by setting up their costs and conditions.",
    completion: "You practised Legion and Level conditions, Quick-Draw’s attachment, Repeat’s extra use and Shield’s combat protection.",
  },
  "keyword-new-tools": {
    kind: "read", cardId: "RAD-082", secondCardId: "OGN-012",
    from: "Read the special rule", to: "Try it on the board",
    summary: "Try Show Off, Tank, Temporary, Unique, Vision and Weaponmaster in their own examples.",
    completion: "You practised Show Off, Tank, Temporary, Unique deck checks, Vision’s private look and Weaponmaster’s attachment discount.",
  },
};

const FALLBACK_LESSON_VISUAL: LessonVisual = {
  kind: "read",
  cardId: "OGN-096",
  from: "Read the position",
  to: "Try the next action",
  summary: "Check the cards and follow the explanation before making your move.",
  completion: "You practised the actions in this prepared position. You can revisit it whenever you want.",
};

export function getLessonVisual(lessonId: string): LessonVisual {
  return Object.prototype.hasOwnProperty.call(LESSON_VISUALS, lessonId)
    ? LESSON_VISUALS[lessonId]
    : FALLBACK_LESSON_VISUAL;
}
