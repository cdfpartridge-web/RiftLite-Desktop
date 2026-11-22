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
    summary: "Where does everything go before we draw a card? We’ll lay out our legend, chosen champion and decks together.",
    completion: "Your two decks are in place and you’ve picked a battlefield, so we can draw an opening hand and see what you’ve got.",
  },
  "opening-hand": {
    kind: "mulligan", cardId: "OGN-119", secondCardId: "OGN-096",
    from: "A later play", to: "Look for an early play",
    summary: "You’ve drawn an extra Ahri, would you keep her when you’ve already got one in the champion zone?",
    completion: "You kept Sentry for turn one and sent the spare Ahri back, so you’ve still got your chosen champion for later.",
  },
  "first-or-second": {
    kind: "turn", cardId: "OGN-089", secondCardId: "OGN-096",
    from: "Awaken · Beginning", to: "Channel · Draw",
    summary: "We’re going first, so how many runes do we get and do we still draw a card?",
    completion: "You’ve followed Awaken, Beginning, Channel and Draw. Both players draw, and the player going second gets an extra rune on their first Channel.",
  },
  "read-a-card": {
    kind: "read", cardId: "OGN-096", secondCardId: "OGN-058",
    from: "Cost and Might", to: "Rules and timing",
    summary: "What does that 2 on Sentry mean, and when can we actually play Discipline?",
    completion: "You’ve found what Sentry costs, how much Might it has and the word on Discipline that lets you respond during a fight.",
  },
  "play-first-unit": {
    kind: "pay", cardId: "OGN-089", secondCardId: "OGN-096",
    from: "Make 2 energy", to: "Play Sentry in base",
    summary: "We’ve got two ready runes and Sentry costs 2, so let’s get a unit down now for next turn.",
    completion: "Sentry’s in your base. Both runes paid for it and it came in exhausted, so we’ll give it a turn before we move it.",
  },
  "power-and-champion": {
    kind: "power", cardId: "OGN-089", secondCardId: "OGN-119",
    from: "Energy and Mind power", to: "Pay both parts",
    summary: "Ahri needs energy and Mind power, can the same Mind rune help us pay for both?",
    completion: "You took the energy first and recycled the sideways Mind rune for its power, which covered the last symbol on Ahri.",
  },
  "move-to-battlefield": {
    kind: "move", cardId: "OGN-096", secondCardId: "OGN-282",
    from: "Ready in base", to: "Exhausted at a battlefield",
    summary: "Sentry’s ready, so which battlefield can we send it to and when do we get the point?",
    completion: "Sentry made it to the battlefield, and now the showdown gives your opponent a chance to act before you score.",
  },
  "first-conquest": {
    kind: "score", cardId: "OGN-096", secondCardId: "OGN-282",
    from: "Finish the showdown", to: "Conquer for 1 point",
    summary: "Sentry’s there on its own, so what are we waiting for before we claim the point?",
    completion: "You both had your chance to respond, and once the showdown finished Sentry took control and earned your first point.",
  },
  "practice-first-point": {
    kind: "score", cardId: "OGN-096", secondCardId: "OGN-282",
    from: "Prepare and play", to: "Ready, move and score",
    summary: "Start with Sentry in your hand, how do you get from there to a point over the next two turns?",
    completion: "You paid for Sentry on one turn, then readied it and sent it out on a later turn to conquer.",
  },
  holding: {
    kind: "hold", cardId: "OGN-096", secondCardId: "OGN-282",
    from: "Keep control", to: "Score during Beginning",
    summary: "You’ve already got a battlefield, so how do you get another point out of the unit that’s there?",
    completion: "You held through Beginning for a point, then played the second Sentry straight onto the battlefield you controlled.",
  },
  "scoring-once-per-turn": {
    kind: "score", cardId: "OGN-044", secondCardId: "OGN-282",
    from: "Already scored here", to: "Try the other battlefield",
    summary: "If we lose a battlefield and take it back, can we score it twice in the same turn?",
    completion: "You followed who scored each battlefield and when. A change of control didn’t refresh that allowance, a new turn did.",
  },
  "plan-your-main": {
    kind: "move", cardId: "SFD-074", secondCardId: "OGN-044",
    from: "Check your options", to: "Make useful plays",
    summary: "You’ve made a good move, but what else could you play before you give your opponent the turn?",
    completion: "You moved a unit, found another play with what you had left and ended Main when you were ready.",
  },
  "simple-combat": {
    kind: "combat", cardId: "SFD-074", secondCardId: "OGN-044",
    from: "3 Might attacks", to: "2 Might defends",
    summary: "Before the damage happens, look at the Might on both units and see who you think will survive.",
    completion: "Both units dealt their damage together, and when you tried it with two equal units they took each other out.",
  },
  "group-movement": {
    kind: "move", cardId: "SFD-074", secondCardId: "OGN-044",
    from: "Two ready units", to: "One group move",
    summary: "Neither unit fancies this fight alone, so can you send Pickpocket and Keeper in together?",
    completion: "Their combined damage was enough to kill the defender, and Keeper survived to conquer the battlefield.",
  },
  "damage-and-might": {
    kind: "combat", cardId: "OGN-065", secondCardId: "SFD-074",
    from: "4 Might", to: "4 Might · 3 damage",
    summary: "Elder’s taken 3 damage, how much is it actually going to deal back with 4 Might?",
    completion: "Elder still had 4 Might with 3 damage marked on it, and once it survived the fight that damage cleared during cleanup.",
  },
  "start-combat": {
    kind: "combat", cardId: "OGN-119", secondCardId: "OGN-096",
    from: "Challenge a defender", to: "Handle the attack ability",
    summary: "Ahri’s heading into a defended battlefield, so let’s see what her attack ability does before the fight continues.",
    completion: "You chose the target for Ahri’s attack ability and dealt with it before carrying on with the showdown.",
  },
  "the-chain": {
    kind: "chain", cardId: "OGN-058", secondCardId: "OGN-119",
    from: "An effect is waiting", to: "Your response goes above",
    summary: "Their Discipline is waiting to happen, so when do we get a chance to use ours?",
    completion: "Your Discipline went on the chain last and resolved first, then you dealt with theirs before carrying on with the fight.",
  },
  "ready-runes-and-defenders": {
    kind: "pay", cardId: "OGN-042", secondCardId: "OGN-044",
    from: "Keep runes ready", to: "Help your defender later",
    summary: "Sentry is exhausted, can it still defend? Think about what you’d want to leave open for that fight.",
    completion: "Saving the runes gave you the energy for Discipline during the attack, and your exhausted Sentry could still defend.",
  },
  "countering-spells": {
    kind: "counter", cardId: "OGN-045", secondCardId: "OGN-050",
    from: "Rune Prison is waiting", to: "Defy stops its effect",
    summary: "Rune Prison’s about to stun Sentry, so which card do you need to target with Defy?",
    completion: "Defy stopped Rune Prison before it could stun Sentry, and both players still paid for the spells they used.",
  },
  "combat-damage": {
    kind: "combat", cardId: "OGN-119", secondCardId: "OGN-096",
    from: "Assign both sides’ damage", to: "Survivor can conquer",
    summary: "Once both sides have dealt their damage, which unit is left to claim the battlefield?",
    completion: "You assigned the damage, saw why Ahri survived the defender and took the battlefield with her.",
  },
  "practice-reactions": {
    kind: "chain", cardId: "OGN-058", secondCardId: "OGN-119",
    from: "Protect your attacker", to: "Finish the fight",
    summary: "Can you keep Ahri alive through the fight and still come away with the point?",
    completion: "You found the resources for a response, resolved the spells in order and conquered with Ahri.",
  },
  "win-the-game": {
    kind: "win", cardId: "OGN-096", secondCardId: "OGN-282",
    from: "7 points", to: "Earn point 8",
    summary: "We’re on seven, would you go for both battlefields now or try to hold one into Beginning?",
    completion: "You’ve won from seven in two ways, by conquering after scoring both battlefields that turn and by holding during Beginning.",
  },
  "practice-final-point": {
    kind: "win", cardId: "OGN-096", secondCardId: "SFD-216",
    from: "Two ready Sentries", to: "Score both battlefields",
    summary: "You’ve got two ready Sentries, what do we need from each battlefield to get point eight?",
    completion: "Both Sentries scored a battlefield in the same turn, so the second conquest gave you the winning point.",
  },
  "mulligan-practice": {
    kind: "mulligan", cardId: "OGN-044", secondCardId: "OGN-065",
    from: "Look for an opening plan", to: "Keep or replace",
    summary: "Which cards would you send back if you already had a turn-one unit, and what if you didn’t?",
    completion: "You kept the first four because you had an early play, then tried sending two cards back with a different hand.",
  },
  "resource-decisions": {
    kind: "pay", cardId: "OGN-044", secondCardId: "OGN-058",
    from: "Add a defender now", to: "Or save a response",
    summary: "If you can play another defender now, what’s the reason for leaving those runes open?",
    completion: "You saw what your choice left you for the attack, whether you put the extra defender down or saved the response.",
  },
  "recovery-practice": {
    kind: "move", cardId: "OGN-044", secondCardId: "OGN-065",
    from: "One battlefield lost", to: "Another route to a point",
    summary: "You’ve lost a battlefield, but Keeper’s still ready. What’s happening on the other side?",
    completion: "You checked the other battlefield and conquered it with Keeper, even after losing the first fight.",
  },
  "buffs-and-bonuses": {
    kind: "growth", cardId: "SFD-074", secondCardId: "OGN-063",
    from: "Several Might bonuses", to: "One actual Buff counter",
    summary: "Your unit has extra Might, but which bonus can you actually spend on Monastery’s ability?",
    completion: "You had three ways of gaining Might, and the one Monastery let you spend was the actual Buff counter.",
  },
  "equipment-lifecycle": {
    kind: "equipment", cardId: "SFD-022", secondCardId: "OGN-010",
    from: "The bearer leaves", to: "The Equipment remains",
    summary: "The unit carrying Long Sword is about to leave, so where’s the sword going to end up?",
    completion: "You followed the sword when its bearer died and when another bearer returned to hand, then used the detached Equipment again.",
  },
  "champion-destinations": {
    kind: "move", cardId: "OGN-117", secondCardId: "OGN-117",
    from: "Champion in play", to: "Trash or hand",
    summary: "Once Viktor leaves the table, do we get him back in the champion zone?",
    completion: "You followed Viktor to the trash and to hand in separate examples, then paid for two copies and had both on the table together.",
  },
  "passing-decisions": {
    kind: "chain", cardId: "OGN-058", secondCardId: "OGN-044",
    from: "A chance to respond", to: "Finish the right window",
    summary: "If you pass here, are you handing over the turn, letting a spell resolve, or giving up the next play in a showdown?",
    completion: "You started a chain with a Reaction, then saw what passing priority, passing focus and ending the turn each handed over.",
  },
  "unit-play-effects": {
    kind: "chain", cardId: "OGN-116", secondCardId: "UNL-128",
    from: "The unit leaves", to: "Its ability still waits",
    summary: "Watcher’s already triggered, so what happens to its ability if the unit leaves before it resolves?",
    completion: "Watcher’s ability still happened after Watcher left, and Discipline still drew a card even after it lost its target.",
  },
  "hidden-cards": {
    kind: "hidden", cardId: "OGN-213", secondCardId: "OGN-282",
    from: "Hide at this battlefield", to: "Respond on a later turn",
    summary: "We can hide Blade at this battlefield now, but where can we use it if the attack goes somewhere else?",
    completion: "You played Blade at its own battlefield on a later turn, then saw what happened when the attack went elsewhere or you lost control.",
  },
  "keywords-in-combat": {
    kind: "combat", cardId: "OGN-240", secondCardId: "OGN-210",
    from: "Assault adds Might", to: "Tank takes damage first",
    summary: "Before you assign the damage, check what Assault does for the attacker and who Tank protects here.",
    completion: "Assault kept its extra Might through conquering and the waiting chain, and Tank drew damage away from Poro.",
  },
  "choose-your-plan": {
    kind: "move", cardId: "SFD-074", secondCardId: "OGN-044",
    from: "Read this position", to: "Carry out your plan",
    summary: "Have a look at both battlefields, what play would you make now and what’s it leaving you for their turn?",
    completion: "You picked a plan, played it through the attack and saw which units and resources you still had next turn.",
  },
  "keyword-timing": {
    kind: "chain", cardId: "OGN-004", secondCardId: "OGN-058",
    from: "Action in a showdown", to: "Reaction above a spell",
    summary: "We’ve got Cleave and Discipline, which can start the play and which can answer a spell that’s already waiting?",
    completion: "You used Action and Reaction, then drew Defy with Discipline in time to answer Cleave before it resolved.",
  },
  "keyword-combat": {
    kind: "combat", cardId: "OGN-010", secondCardId: "OGN-096",
    from: "Change entry or combat", to: "Check the resulting effect",
    summary: "Let’s take Accelerate, Ambush, Assault, Backline and Deathknell into a fight and see when each matters.",
    completion: "You paid for Accelerate, used Ambush as a response and counted Assault in combat, then worked through Backline damage and a Deathknell after a unit died.",
  },
  "keyword-surprises": {
    kind: "growth", cardId: "OGN-213", secondCardId: "OGN-013",
    from: "Check costs and abilities", to: "Apply the change",
    summary: "What changes when a card says Deflect, Deploy, Disarm, Empower or Empowered? Try each one on its own board.",
    completion: "You paid the extra for Deflect, chose where to Deploy and handled Disarm on attack, then compared Empower with Empowered.",
  },
  "keyword-equipment": {
    kind: "equipment", cardId: "SFD-022", secondCardId: "OGN-010",
    from: "Use a different option", to: "Pay and check the result",
    summary: "Equip, Flow, Ganking, Hidden and Hunt all change a different part of a turn, so we’ll give each its own example.",
    completion: "You attached Equipment, played again with Flow, moved between battlefields with Ganking, played a Hidden card locally and resolved Hunt after scoring.",
  },
  "keyword-growth": {
    kind: "growth", cardId: "OGN-010", secondCardId: "OGN-012",
    from: "Set up the condition", to: "Use the benefit",
    summary: "With Legion, Level, Quick-Draw, Repeat and Shield, the first thing I’d check is what has to be true for the keyword to help.",
    completion: "You checked Legion and Level, attached with Quick-Draw, got another use from Repeat and saw how Shield helped a defender.",
  },
  "keyword-new-tools": {
    kind: "read", cardId: "RAD-082", secondCardId: "OGN-012",
    from: "Read the special rule", to: "Try it on the board",
    summary: "Let’s try Show Off, Tank, Temporary, Unique, Vision and Weaponmaster, with a fresh board for each one.",
    completion: "You worked through Show Off, Tank and Temporary, checked Unique during deckbuilding, looked privately with Vision and used Weaponmaster’s attachment discount.",
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
