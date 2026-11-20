/** A diagnostic check-in, never a condition for accessing lessons, videos or decks. */
export interface NewPlayerQuizQuestion {
  id: string;
  topic: string;
  prompt: string;
  options: ReadonlyArray<{ id: string; text: string }>;
  correctId: string;
  explanation: string;
  lessonId: string;
  topicId: string;
  reviewStepId?: string;
  reviewTopicId?: string;
  board?: { caption: string; zones: Array<{ label: string; note?: string; cards: Array<{ cardId: string; name: string; might?: number; ready?: boolean }> }> };
}
const REVIEW_STEPS: Readonly<Record<string, string>> = {
  "one-score-per-battlefield":"limit-same-turn",
  "opponent-scoring-allowance":"limit-opponent",
  "score-reset-next-turn":"limit-end-turn",
  "move-as-a-group": "group-move",
  "damage-is-not-might": "damage-test",
  "buff-or-bonus": "buff-test",
  "gear-after-bearer": "gear-cleanup",
  "champion-after-death": "champion-attack",
  "reaction-can-start": "reaction-start",
  "priority-is-not-end-turn": "priority-question",
  "save-runes-not-energy": "reserve-expired",
  "exhausted-can-defend": "reserve-attack"
};
function question(id: string, topic: string, prompt: string, choices: [string, string, string], correct: number, explanation: string, lessonId: string, topicId: string): NewPlayerQuizQuestion {
  const reviewStepId = REVIEW_STEPS[id] ?? (["ganking", "unique", "legion", "empowered", "flow"].includes(id) ? `keyword-${id}-intro` : undefined);
  return { id, topic, prompt, options: choices.map((text, index) => ({ id: String(index), text })), correctId: String(correct), explanation, lessonId, topicId, ...(reviewStepId ? { reviewStepId } : {}) };
}
export const NEW_PLAYER_QUIZ: readonly NewPlayerQuizQuestion[] = [
  { ...question("draw-or-play", "Cards in your hand", "You draw Watchful Sentry. What has changed?", ["It is now a unit in your base", "You have another option in your hand; you still need to play and pay for it", "You immediately earn a point"], 1, "Drawing moves a card from your main deck into your hand. The card gives you another option. To put Sentry on the table, play it at a legal time and pay its two-energy cost. Drawing does not pay that cost or score a battlefield.", "play-first-unit", "board-layout"), board: { caption: "A card has just moved from your main deck to your hand.", zones: [{label:"Your hand",cards:[{cardId:"OGN-096",name:"Watchful Sentry"}]},{label:"Your base",note:"No unit has been played here yet.",cards:[]}] } },
  { ...question("mulligan-plan", "Choosing an opening hand", "You already have an affordable early unit. Must you return the more expensive Wizened Elder?", ["Yes. Every expensive card is a bad opening card", "No. Having an early play can let you keep a useful card for a later turn", "No, because keeping it makes it free"], 1, "A mulligan helps you build an opening plan. Sentry costs two energy and can give you an early play; Elder costs four and can be a later play. Keeping Elder is a reasonable choice here, not a rule for every hand. Returning cards searches for different options but does not guarantee better replacements.", "mulligan-practice", "build-a-deck"), board: { caption: "Part of an opening hand, going first. Your first Channel will provide two runes.", zones: [{label:"An early play · 2 energy",cards:[{cardId:"OGN-096",name:"Watchful Sentry"}]},{label:"A later play · 4 energy",cards:[{cardId:"OGN-065",name:"Wizened Elder"}]}] } },
  { ...question("predict-survivor", "Read the fight", "Without spells, buffs or other modifiers, what happens when your 4-Might Elder fights this 3-Might Pickpocket?", ["Both units die because they fought", "Pickpocket hits first and stops Elder dealing damage", "Elder survives with three damage; Pickpocket takes four and dies"], 2, "Both sides deal damage at the same time. Elder’s four damage is enough to kill the three-Might Pickpocket. Pickpocket still deals its three damage, which is less than Elder’s four Might. The surviving Elder’s damage is then cleared during combat cleanup; control and scoring happen through the remaining combat process.", "simple-combat", "turns-and-scoring"), board: { caption: "One battlefield, before combat damage. No buffs, spells, gear or legend effects change these numbers.", zones: [{label:"Your attacker",cards:[{cardId:"OGN-065",name:"Wizened Elder",might:4,ready:false}]},{label:"Their defender",cards:[{cardId:"SFD-074",name:"Pickpocket",might:3,ready:true}]}] } },
  { ...question("reserve-a-response", "Plan your resources", "Why might you keep your two ready runes instead of playing Clockwork Keeper now?", ["To keep enough energy to respond with Discipline if the opponent attacks", "Because playing a second unit in a turn is forbidden", "Because unused runes automatically score points"], 0, "Keeper and Discipline each cost two energy. Spending both runes on Keeper gives you another unit, but leaves that energy unavailable for Discipline during the next turn. Reserving the runes gives you a response option. Developing a unit can also be legal and useful; choose according to the battlefield you want to protect and the next turn you want to set up.", "resource-decisions", "domains"), board: { caption: "Your open Main phase with two ready runes and no available energy yet. These two cards are in your hand.", zones: [{label:"Develop another unit · 2 energy",cards:[{cardId:"OGN-044",name:"Clockwork Keeper",might:2}]},{label:"Keep a response · 2 energy",cards:[{cardId:"OGN-058",name:"Discipline"}]}] } },
  { ...question("recover-a-point", "After losing control of a battlefield", "Your opponent controls the left battlefield. What can your ready Keeper do to work towards your next point?", ["Move the opponent’s Elder away", "Move to the empty right battlefield, then let the showdown settle", "Score from your base because the other battlefield is empty"], 1, "Losing control of one battlefield does not end your options. During your open Main phase, your ready Keeper can exhaust to move from base to the empty battlefield. Both players still get the relevant response opportunity before you conquer the battlefield and score it. You cannot move an opposing unit as your normal move, and a unit in base does not score a battlefield.", "recovery-practice", "turns-and-scoring"), board: { caption: "Your open Main phase. No other effects restrict movement. The right battlefield has no units.", zones: [{label:"Your base",cards:[{cardId:"OGN-044",name:"Clockwork Keeper",might:2,ready:true}]},{label:"Left battlefield · opponent controls",cards:[{cardId:"OGN-065",name:"Wizened Elder",might:4,ready:false}]},{label:"Right battlefield · uncontrolled",note:"An available place to contest.",cards:[]}]} },
  question("identity", "Getting set up", "Your legend shows Calm and Mind. Which cards can normally go in this deck?", ["Any card, as long as I can pay for it", "Cards whose domains fit Calm/Mind, plus eligible domainless cards", "Only cards showing both Calm and Mind"], 1, "Your legend sets your deck’s domain identity. A card’s domains must fit that identity; being able to pay for a card does not make it legal. Other deckbuilding restrictions still apply.", "table-setup", "legend-and-champion"),
  question("chosen-champion", "Getting set up", "Your chosen champion is face up in the champion zone. Can you use it as a unit on the board yet?", ["Yes, revealing it put it into play", "Yes, but only on turn two", "No. Play it at a legal time and pay its cost first"], 2, "The champion zone gives you access to that card. It is not your base. You still play the champion and pay its costs before it joins your units in play.", "power-and-champion", "legend-and-champion"),
  question("mulligan", "Your opening turn", "You don’t love your opening four. What does the normal mulligan let you do?", ["Replace up to two cards, once", "Replace all four until the hand looks right", "Keep all four and draw two extra"], 0, "Choose up to two, set them aside, draw that many replacements, then recycle the cards you set aside. You get one mulligan, not a second try if the replacements miss.", "opening-hand", "build-a-deck"),
  question("abcd", "Your opening turn", "You’re starting a turn. Which order is right?", ["Draw → Channel → Beginning → Awaken", "Awaken → Beginning → Channel → Draw", "Channel → Draw → Awaken → Beginning"], 1, "ABCD: ready your board in Awaken, handle Beginning effects and holding, channel runes, then draw. Your Main phase follows.", "first-or-second", "turns-and-scoring"),
  question("second-player", "Your opening turn", "In the standard two-player game taught here, what does going second change on your first turn?", ["You skip your draw", "You start with an extra point", "You channel three runes instead of two"], 2, "Going second gives you one extra rune in your first Channel phase. Both players draw on their first turn. Later Channel phases normally give two runes each.", "first-or-second", "turns-and-scoring"),
  question("energy", "Energy and power", "A card asks for 2 energy. Does that energy have to come from runes matching the card’s domain?", ["No. Energy from any basic rune can pay the number", "Yes. All costs need matching-domain runes", "No, because energy costs are optional"], 0, "Energy is the numeric part of the cost. Domain power is a different resource. The power symbols still need the right domain unless the cost allows any power.", "read-a-card", "card-anatomy"),
  question("exhausted-power", "Energy and power", "You’ve exhausted a Mind rune for 1 energy. Can that same exhausted rune now make Mind power?", ["No, wait until it readies next turn", "Yes. Recycle it for 1 Mind power", "Yes, exhaust it a second time"], 1, "Yes — tapped does not mean used up for everything. You can exhaust a rune for energy, then recycle that same exhausted rune for power. Recycling returns it to your rune deck.", "power-and-champion", "domains"),
  question("recycle-location", "Energy and power", "After you recycle a rune for power, where is that rune?", ["In your rune area, ready again", "In your trash for the rest of the game", "In your rune deck; it must be channelled again to return"], 2, "The rune goes back to the bottom of your rune deck. It is no longer in your rune area to ready next turn. Recycling gets power now, but gives up that rune in play until you channel it again.", "power-and-champion", "domains"),
  question("unit-entry", "Playing your units", "You play an ordinary unit from hand. How does it normally enter?", ["Exhausted, unless a rule or effect says otherwise", "Ready, because you paid for it", "Ready if you play it to your base"], 0, "Units normally enter exhausted. Playing to your base does not change that. Only a card or rule that specifically says otherwise changes how it enters; there is no general extra payment to make any unit ready.", "play-first-unit", "card-anatomy"),
  question("battlefield-play", "Playing your units", "You control Monastery of Hirana and have enough resources. Can you play a unit from hand straight onto it?", ["No. Every unit must visit the base first", "Yes, at a legal time; it normally enters exhausted", "Yes, and that automatically gives another point for conquering"], 1, "Your base and battlefields you control are normal unit destinations. That is playing, not moving, and it does not score another point by itself. Check the battlefield’s text: Rockfall Path forbids playing units there.", "holding", "board-layout"),
  question("timing", "Timing and the chain", "A spell is already waiting on the chain. Which printed keyword allows a spell to be played as a response?", ["Action by itself", "Hidden by itself, regardless of where the card is", "Reaction, if its other requirements are met"], 2, "Reaction allows a response on the chain. Action permits play in an open showdown but does not, by itself, let a spell respond on a closed chain. Costs, targets and other restrictions still matter.", "the-chain", "timing"),
  question("chain-order", "Timing and the chain", "Your opponent plays a spell. You respond with a Reaction. You both pass. Which resolves next?", ["Your Reaction, the newest item", "Their spell, because it was played first", "Both effects at the same time"], 0, "The newest chain item resolves first. Players get another response window before the next item resolves. Passing once does not automatically resolve the entire chain.", "the-chain", "timing"),
  question("counter-effect", "Countering spells", "Defy successfully counters an eligible spell on the chain. What happens to that spell?", ["It resolves with half its effect", "It leaves the chain without resolving and goes to its owner’s trash", "It returns to its owner’s hand for free"], 1, "Countering stops that spell from resolving. Its effect does not happen. Defy has limits: the target spell must cost no more than 4 energy and 1 power. Read your counterspell’s actual text.", "countering-spells", "timing"),
  question("counter-costs", "Countering spells", "Your opponent paid for a spell, then you countered it. Do they get those resources back?", ["Yes, all of them", "Only the power", "No. Countering does not refund costs already paid"], 2, "They paid to play the spell. Countering stops its resolution; it does not rewind that payment. Your counterspell can also be responded to before it resolves.", "countering-spells", "timing"),
  { ...question("waiting-play-effect", "Units and their abilities", "Thousand-Tailed Watcher’s on-play ability is waiting on the chain. Star-Crossed returns Watcher to your hand. What happens to its waiting ability?", ["It disappears because Watcher left the table", "It still resolves after both players pass; returning Watcher did not counter it", "It resolves twice because Watcher entered your hand"], 1, "The unit and its queued ability are separate. Returning Watcher to hand leaves its on-play ability waiting. After both players pass, enemy units still on the table get −3 Might this turn, to a minimum of 1. Removing the source is not the same as countering its ability.", "unit-play-effects", "timing"), board: {caption:"Star-Crossed has finished. Watcher is back in your hand, with its ability still waiting.",zones:[{label:"Your hand",cards:[{cardId:"OGN-116",name:"Thousand-Tailed Watcher"}]},{label:"Enemy base",note:"Still 4 Might until the waiting ability resolves.",cards:[{cardId:"RAD-050",name:"Mysterious Chronomancer",might:4}]}]} },
  { ...question("departed-target", "When a target leaves", "Discipline targets your Sentry. Before it resolves, Star-Crossed returns Sentry to your hand. What does Discipline do now?", ["Choose a different unit for its Might bonus", "Nothing at all, including no draw", "Give no Might bonus to the departed Sentry, but still draw one card"], 2, "Discipline cannot give its bonus to the unit that left the table, and you do not choose a replacement target. Its separate Draw 1 instruction still happens. Sentry was returned, not killed, so its Deathknell does not trigger. The draw comes from Discipline, and its paid costs stay spent.", "unit-play-effects", "timing"), reviewStepId:"target-reset", board:{caption:"Sentry has returned to your hand. Discipline remains on the chain.",zones:[{label:"Your hand",cards:[{cardId:"OGN-096",name:"Watchful Sentry"}]},{label:"Waiting on the chain",cards:[{cardId:"OGN-058",name:"Discipline"}]}]} },
  question("lethal-first", "Combat damage", "You have 8 combat damage to assign to two ordinary 2-Might defenders. Which assignment is legal?", ["2 to one, then the remaining 6 to the other", "4 to each because it looks fair", "1 to one and 7 to the other"], 0, "Assign lethal to one unit before moving to the next. Here, 2 is lethal, and the final defender takes the excess 6. Tank must be dealt with first; Backline comes after units without Backline, subject to the full ordering rules.", "combat-damage", "turns-and-scoring"),
  question("simultaneous", "Combat damage", "Your attacking unit will kill the defender with combat damage. Does that stop the defender dealing its combat damage back?", ["Yes, the attacker always hits first", "No. Both sides deal their assigned combat damage simultaneously", "Only if the attacker cost more energy"], 1, "Damage assignment and damage dealing are different steps. Once assignments are ready, both sides deal combat damage at the same time. A unit dying from that damage still dealt its damage in that exchange.", "combat-damage", "turns-and-scoring"),
  question("holding", "Scoring and winning", "You still control a battlefield when your next turn begins. When do you normally get its holding point?", ["As soon as your opponent ends their turn", "After drawing your card", "In Beginning, after Beginning effects are handled"], 2, "Holding scores in your Beginning phase, not at the end of your opponent’s turn. The battlefield must still be yours when you reach scoring. This is why keeping a unit alive there matters.", "holding", "turns-and-scoring"),
  question("one-score-per-battlefield", "Scoring and winning", "You held the left battlefield in Beginning. Later in the same turn, you leave it and regain control with another unit. What happens?", ["You get another point because it is a different unit", "You regain control without another point; the unscored right battlefield can still score for you", "You draw a card instead whenever a battlefield was already scored"], 1, "Your holding point used the left battlefield’s score for this turn. Leaving, changing units or regaining control does not refresh it. There is no new conquer or conquer trigger, and no replacement draw for repeating a score. The right battlefield has its own allowance. Each new turn resets both players’ records.", "scoring-once-per-turn", "turns-and-scoring"),
  question("opponent-scoring-allowance", "Scoring and winning", "You already scored a battlefield this turn. The guide has not. If the guide legally gains control of it later in this same turn, can it score?", ["No, because somebody already scored it", "Only if it gives your point back first", "Yes. Each player has their own allowance for each battlefield"], 2, "Check the player as well as the battlefield and turn. Your scored marker does not use the guide’s allowance. This does not give the guide a free move: it still needs a legal way to gain control and must finish the relevant contest. Its own scored marker would prevent a repeat score.", "scoring-once-per-turn", "turns-and-scoring"),
  question("score-reset-next-turn", "Scoring and winning", "When do both players’ scored-this-turn records reset?", ["Whenever a unit leaves a battlefield", "At the start of each new turn, including the opponent’s turn", "Only after both players have taken a turn"], 1, "Every new turn starts fresh scored records for both players. The reset does not itself award points or ready your cards. Holding is checked during your own Beginning phase; conquering still needs a legal change of control. A phase change inside the same turn does not reset the record.", "scoring-once-per-turn", "turns-and-scoring"),
  question("final-point", "Scoring and winning", "You’re on 7 points and haven’t scored either battlefield this turn. You conquer one. What happens?", ["You draw instead; scoring the other battlefield that turn can then give the winning point", "You immediately win", "You can never win by conquering"], 0, "To win by conquering, you must have scored every battlefield that turn. Conquering the first battlefield draws a card instead and still counts as scoring it. Holding one battlefield in Beginning is another way to win from 7.", "win-the-game", "turns-and-scoring"),
  question("hidden", "Hidden and delayed effects", "You hide a card at your controlled battlefield. Can you immediately play it from hiding in that same turn?", ["Yes, hiding makes it free immediately", "No. Wait until a subsequent turn, and meet the play requirements", "Yes, if you hide a second card first"], 1, "Hidden prepares a later play. A card cannot be played from hiding on the turn it was hidden. You also need the legal location and conditions described by Hidden and the card.", "hidden-cards", "timing"),
  question("ganking", "Keyword movement", "Your ready unit has Ganking. What extra standard move does that keyword allow?", ["Move without exhausting", "Move any opponent’s unit", "Move directly from one battlefield to another"], 2, "Ganking adds battlefield-to-battlefield movement. It does not remove the normal requirement to exhaust for a standard move, or bypass other restrictions.", "keyword-equipment", "board-layout"),
  question("unique", "Gear and deckbuilding", "You’re building a deck with a card that has Unique. How many copies of that card can the deck contain?", ["One", "Three, as long as only one is in play", "Any number if it is gear"], 0, "Unique is a deckbuilding restriction: one copy of that card. It is not a rule that lets you pack three and keep only one on the board.", "keyword-new-tools", "build-a-deck"),
  question("legion", "Keyword conditions", "A card has a Legion effect. What turns that condition on?", ["You control two battlefields", "You’ve played another card earlier this turn", "Your opponent played a card last turn"], 1, "Legion checks whether you have already played another card this turn. Read the rest of the effect to see what the payoff is. The current card is not its own earlier card.", "keyword-growth", "card-anatomy"),
  question("empowered", "Keyword conditions", "Why would you pay a unit’s Empower cost?", ["It makes every card in your hand free", "It automatically wins the combat", "It makes that unit Empowered, switching on its Empowered text"], 2, "Empower is an activated ability you pay to use. Empowered is the resulting status, which switches on that card’s Empowered text. Read that specific card’s benefit — it is not a universal Might bonus.", "keyword-surprises", "card-anatomy"),
  question("flow", "Using your trash", "You play a spell from your trash using Flow and it finishes resolving. Where does it normally go?", ["Banishment", "Back to your hand", "Back to trash so you can repeat it endlessly"], 0, "Flow lets you use that spell from trash by paying its Flow cost, then banishes it as described by the keyword. Normal timing still matters; Flow alone does not grant Reaction.", "keyword-equipment", "timing"),
  { ...question("move-as-a-group", "Moving units together", "Sentry and Keeper are ready in your base. During your open Main phase, can you move them together to the same battlefield?", ["Yes. Exhaust both and move them together, then handle any showdown this starts", "No. The first unit must finish a fight before the second can arrive", "Yes, but first pay both units’ printed play costs again"], 0, "Several ready units can make one standard move together to a shared legal destination. Each exhausts for the move; you do not pay their play costs again. If enemy units are there, moving together lets your units contribute their Might to the same combat. Moving one alone and finishing its fight first can leave a different result.", "group-movement", "board-layout"), board: {caption:"Your open Main phase. Both units are ready in base; no effect prevents this move.",zones:[{label:"Your base",cards:[{cardId:"OGN-096",name:"Watchful Sentry",might:1,ready:true},{cardId:"OGN-044",name:"Clockwork Keeper",might:2,ready:true}]},{label:"The battlefield you want to contest",note:"Choose one shared destination for this group move.",cards:[]}]} },
  { ...question("damage-is-not-might", "Damage and Might", "Elder has 4 Might and 2 marked damage during a showdown. With no other changes, how much combat damage will it deal?", ["2, because damage is subtracted from Might", "4. Damage and Might are separate values", "6, because damage makes it stronger"], 1, "Marked damage does not reduce Might. This Elder still contributes 4 combat damage, but another 2 damage would reach its current Might and be lethal. Healing removes marked damage; it does not add Might. Increasing Might changes strength and the lethal threshold, rather than erasing the damage already marked.", "damage-and-might", "card-anatomy"), board:{caption:"Before combat damage: Elder has already taken 2 damage from an effect.",zones:[{label:"Your unit",note:"2 damage marked; current Might remains 4.",cards:[{cardId:"OGN-065",name:"Wizened Elder",might:4}]},{label:"Combat damage still to happen",note:"Use current Might, not Might minus damage.",cards:[]}]} },
  question("buff-or-bonus", "Buffs and other bonuses", "A unit has Discipline’s +2 Might this turn but no buff counter. Can that +2 pay Monastery’s “spend a buff” cost?", ["Yes, any extra Might is a buff", "Yes, remove one of the two extra Might", "No. The cost needs an actual buff counter"], 2, "A buff is a specific counter that normally gives +1 Might. Discipline’s temporary +2 and Equipment’s Might bonus are different effects, so neither becomes a buff to spend. Check the actual marker and effect, rather than treating every higher Might number as the same thing.", "buffs-and-bonuses", "card-anatomy"),
  question("gear-after-bearer", "Equipment after its unit leaves", "Your unit dies with Long Sword attached. No other effect changes the result. What happens to the sword?", ["It detaches and returns to your base; you can use Equip again at a legal time", "It is automatically killed with the unit", "It stays attached to the unit in the trash"], 0, "The unit leaving the board makes its Equipment detach. Long Sword returns to its controller’s base instead of following the unit into the trash. Its bonus no longer applies to that unit. To attach it to another unit, use its Equip ability again at a legal time and pay that ability’s cost.", "equipment-lifecycle", "card-anatomy"),
  question("champion-after-death", "Your chosen champion after play", "You paid for your chosen Ahri and played her. Later she dies. Where does she normally go?", ["Back to the champion zone, ready to play for free", "To your trash, just like another unit that dies", "Back to the legend zone"], 1, "The champion zone is a starting place, not a place that automatically refills. Once played, the chosen champion follows the normal unit rules. Dying sends it to the trash; an effect returning it to hand sends it to hand. Playing another available copy still needs its normal cost and timing; there is no general one-champion-unit-on-the-board rule.", "champion-destinations", "legend-and-champion"),
  question("reaction-can-start", "Starting a chain", "The showdown’s chain is empty and you have focus and priority. Must you wait for an enemy spell before playing Discipline?", ["Yes. Reaction only means responding to a spell", "Yes. Only Action cards can start a chain", "No. Reaction also allows you to start a legal play in this window"], 2, "Reaction includes the permissions of Action and also allows responses to waiting effects. It does not require an older spell to exist. With the appropriate focus, priority, resources and target, you can play Discipline into an empty showdown and give the other player a chance to respond.", "passing-decisions", "timing"),
  question("priority-is-not-end-turn", "Passing the right opportunity", "Discipline is waiting on the chain and you pass priority. What have you done?", ["Declined to add a response right now; the other player gets their chance", "Ended your entire turn", "Resolved every spell and ability on the chain at once"], 0, "Passing priority gives up this chance to respond. It does not itself end the turn, pass showdown focus or resolve every waiting item. After the necessary passes, only the next item resolves. Passing focus in an empty showdown and choosing End turn in your Main phase are different decisions.", "passing-decisions", "timing"),
  question("save-runes-not-energy", "Keeping a response available", "You want to pay for Discipline on the opponent’s turn. What is the useful thing to keep?", ["Two unspent energy made before you end your turn", "Two ready runes, so you can make the energy when needed", "Two exhausted runes, because the opponent’s Awaken readies them"], 1, "Both players lose unspent energy and power when the turn ends and when Main begins. Keep two runes ready, then exhaust them for energy when you want to play Discipline. Your opponent’s Awaken only readies their cards.", "ready-runes-and-defenders", "domains"),
  { ...question("exhausted-can-defend", "Exhausted units in combat", "You play Keeper onto your controlled battlefield. It enters exhausted. Can it defend there if the opponent attacks next turn?", ["No, it must be ready to deal combat damage", "No, newly played units cannot defend", "Yes. Exhausted does not stop it defending or dealing combat damage"], 2, "Entering exhausted stops Keeper making a standard move straight away. It does not remove Keeper from a fight at its battlefield. The exhausted unit still contributes its current Might and can take damage. A separate effect such as Stun can change its combat contribution; exhaustion alone does not.", "ready-runes-and-defenders", "board-layout"), board:{caption:"Keeper was played directly onto a battlefield you control and is still exhausted.",zones:[{label:"Your battlefield",cards:[{cardId:"OGN-044",name:"Clockwork Keeper",might:2,ready:false}]},{label:"Opponent’s turn",note:"An enemy unit is about to attack this battlefield.",cards:[]}]} },
  { ...question("empty-main-deck", "When a deck runs out", "Your main deck is empty, your trash has cards, and you must draw one. What normally happens in this two-player game?", ["Burn Out: recycle the trash in random order, your opponent gains 1 point, then finish drawing", "Skip the draw with no other result", "Shuffle the rune deck into the main deck"], 0, "Burn Out replaces the missing supply of main-deck cards. Recycle your trash into your main deck in random order, give your opponent one point, then complete the required draw. That point can end the game. This rule concerns the main deck; an empty rune deck has a different result.", "first-or-second", "first-real-game"), reviewTopicId:"first-real-game" },
  { ...question("empty-rune-deck", "When a deck runs out", "You should channel two runes, but your rune deck has only one. What happens?", ["Your opponent gains a point for Burn Out", "Channel the one remaining rune, with no penalty point", "Take a main-deck card and use it as the second rune"], 1, "Channel as many runes as remain. With one left you channel one; with none you channel none. Burn Out is a main-deck rule and does not apply to an empty rune deck. Runes recycled for power return to the rune deck and may be channelled again later.", "first-or-second", "first-real-game"), reviewTopicId:"first-real-game" },
  { ...question("hand-and-unit-limits", "Limits at the table", "You have eight cards in hand and several units at one battlefield. Which normal rule applies?", ["Discard down to four cards and keep only one unit there", "Discard down to seven cards at the end of your turn", "There is no normal hand-size or battlefield unit limit"], 2, "Four cards is your opening hand, not a maximum. You can keep a larger hand and have several units at a battlefield. Cards can still create specific instructions or restrictions, and the facedown space used by Hidden has its own limit. A larger hand does not make its cards free to play.", "table-setup", "first-real-game"), reviewTopicId:"first-real-game" },
  { ...question("several-actions", "Making a turn", "You finish a fight and its effects, and return to your open Main phase with resources and another ready unit. Can you do more?", ["Yes, you can make more legal plays or moves before ending the turn", "No. A turn allows only one fight", "No. Playing one card uses your whole turn"], 0, "Your Main phase has no general one-card or one-fight limit. Once the previous contest and its effects have finished, you can make more legal actions. Each still needs the right timing, readiness and costs. The separate once-per-turn rule for scoring each battlefield still applies.", "plan-your-main", "first-real-game"), reviewTopicId:"first-real-game" },
  { ...question("word-may", "Reading the small words", "Monastery says you may spend a buff to draw when you conquer there. You have a buff. Must you spend it?", ["Yes, every part of a triggered ability is compulsory", "No. You may keep the buff and decline this optional draw", "No, but declining also removes your point for conquering"], 1, "May makes that part a choice. You can keep the buff instead of paying for the optional card draw. Declining the extra ability does not undo the point already earned for conquering. When you do choose the benefit, you must pay the stated buff cost; may does not mean free.", "buffs-and-bonuses", "first-real-game"), reviewTopicId:"first-real-game" },
  { ...question("word-another", "Reading the small words", "A unit’s ability asks you to choose another friendly unit. Can it choose itself?", ["Yes, because it is friendly", "Yes, if it is the only unit you control", "No. Another means a different unit"], 2, "Another excludes the unit being referred to. Friendly tells you whose unit is allowed; another adds a further restriction. If there is no other eligible unit, you cannot replace that instruction with choosing the source itself. Read all the restrictions together.", "unit-play-effects", "first-real-game"), reviewTopicId:"first-real-game" },
  { ...question("word-here", "Reading the small words", "An ability on a battlefield refers to units here. Which units is it talking about?", ["Units at that battlefield, subject to any other wording", "Every unit on the table", "Only units in your base"], 0, "Here gives the effect a location. On a battlefield it means that battlefield, not the whole board. Other words still matter: friendly units here is narrower than units here. Check the source and its wording before choosing or counting units.", "table-setup", "first-real-game"), reviewTopicId:"first-real-game" },
  { ...question("word-up-to", "Reading the small words", "An effect lets you choose up to two units. There are two legal choices available. Must you choose both?", ["Yes, always choose the largest possible number", "No. You may choose zero, one or two", "You must choose exactly one"], 1, "Up to sets a maximum, not a required number. You may choose fewer, including zero. Any unit you do choose must still satisfy the effect’s other restrictions. This gives you a choice; it does not let you pick something that the card otherwise forbids.", "unit-play-effects", "first-real-game"), reviewTopicId:"first-real-game" }
];

export const NEW_PLAYER_QUIZ_KEY = "riftlite.new-player.quiz.v1";
type QuizAnswers = Record<string, { first: string; latest: string; firstWasUnseen?: true; firstLearned?: string }>;
export interface NewPlayerQuizProgress {
  version: 1;
  view: "intro" | "questions" | "results";
  currentId: string;
  /** Optional additions keep existing v1 answers and review positions compatible. */
  scope?: "learned" | "all";
  checkInIds?: string[];
  checkInAnswers?: QuizAnswers;
  answers: QuizAnswers;
}
export function initialQuizProgress(): NewPlayerQuizProgress {
  return { version: 1, view: "intro", currentId: NEW_PLAYER_QUIZ[0].id, answers: {} };
}
export function parseQuizProgress(raw: string | null | undefined): NewPlayerQuizProgress {
  const clean = initialQuizProgress();
  if (!raw || raw.length > 50_000) return clean;
  try {
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== "object" || Array.isArray(input)) return clean;
    const value = input as Record<string, unknown>;
    if (value.version !== 1) return clean;
    if (value.scope === "learned" || value.scope === "all") clean.scope = value.scope;
    if (Array.isArray(value.checkInIds)) clean.checkInIds = [...new Set(value.checkInIds.filter((id): id is string => typeof id === "string" && NEW_PLAYER_QUIZ.some(q => q.id === id)))].slice(0, NEW_PLAYER_QUIZ.length);
    if (value.view === "intro" || value.view === "questions" || value.view === "results") clean.view = value.view;
    if (typeof value.currentId === "string" && NEW_PLAYER_QUIZ.some(q => q.id === value.currentId)) clean.currentId = value.currentId;
    clean.answers = parseAnswers(value.answers, NEW_PLAYER_QUIZ);
    const checkInIds = clean.checkInIds;
    if (checkInIds?.length && Object.hasOwn(value, "checkInAnswers")) {
      clean.checkInAnswers = parseAnswers(value.checkInAnswers, NEW_PLAYER_QUIZ.filter(q => checkInIds.includes(q.id) && clean.answers[q.id]));
    }
    return clean;
  } catch { return clean; }
}
function parseAnswers(value: unknown, questions: readonly NewPlayerQuizQuestion[]): QuizAnswers {
  const answers: QuizAnswers = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return answers;
  for (const q of questions) {
    const answer = (value as Record<string, unknown>)[q.id];
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) continue;
    const { first, latest, firstWasUnseen, firstLearned } = answer as Record<string, unknown>;
    const valid = (option: unknown): option is string => q.options.some(o => o.id === option);
    if (!valid(first) || !valid(latest)) continue;
    answers[q.id] = { first, latest, ...(firstWasUnseen === true ? {firstWasUnseen: true as const} : {}),
      ...(firstWasUnseen === true && valid(firstLearned) ? {firstLearned} : {}) };
  }
  return answers;
}
export function answerQuizQuestion(progress: NewPlayerQuizProgress, id: string, option: string, context?: QuizLearningContext): NewPlayerQuizProgress {
  const q = NEW_PLAYER_QUIZ.find(q => q.id === id);
  if (!q?.options.some(o => o.id === option)) return progress;
  const learned = context && isQuizQuestionLearned(q, context);
  function recordAttempt(answers: QuizAnswers): QuizAnswers {
    const previous = answers[id];
    const firstWasUnseen = previous?.firstWasUnseen || (!previous && learned === false);
    const firstLearned = previous?.firstLearned ?? (firstWasUnseen && learned ? option : undefined);
    return { ...answers, [id]: { first: previous?.first ?? option, latest: option,
      ...(firstWasUnseen ? { firstWasUnseen: true as const } : {}), ...(firstLearned ? { firstLearned } : {}) } };
  }
  const next = { ...progress, answers: recordAttempt(progress.answers) };
  if (progress.scope !== "all" && progress.checkInIds?.includes(id) && progress.checkInAnswers) {
    next.checkInAnswers = recordAttempt(progress.checkInAnswers);
  }
  return next;
}
export function quizSummary(progress: NewPlayerQuizProgress, questions: readonly NewPlayerQuizQuestion[] = NEW_PLAYER_QUIZ, context?: QuizLearningContext) {
  const attempted = (q: NewPlayerQuizQuestion) => Boolean(progress.answers[q.id]) && !(context && isQuizQuestionLearned(q, context) && needsLearnedAttempt(progress, q.id));
  const firstLearned = (q: NewPlayerQuizQuestion) => progress.answers[q.id].firstWasUnseen ? progress.answers[q.id].firstLearned : progress.answers[q.id].first;
  const answered = questions.filter(attempted);
  return {
    answered: answered.length,
    firstTime: answered.filter(q => firstLearned(q) === q.correctId).length,
    revisits: answered.filter(q => firstLearned(q) !== undefined && firstLearned(q) !== q.correctId),
    unanswered: questions.filter(q => !attempted(q))
  };
}


export interface QuizLearningContext {
  completedLessonIds: readonly string[];
  readTopicIds: readonly string[];
}

// A broad topic label is a review destination, not proof that its advanced rules
// have been taught. Only these explicit Basics explanations can substitute for
// completing the associated board lesson.
const QUIZ_BASICS_PREREQUISITES: Readonly<Record<string, readonly string[]>> = {
  "draw-or-play": ["board-layout"],
  identity: ["legend-and-champion", "build-a-deck"],
  "chosen-champion": ["legend-and-champion"],
  mulligan: ["ready-to-play"],
  abcd: ["turns-and-scoring"],
  "second-player": ["turns-and-scoring"],
  energy: ["card-anatomy", "domains"],
  "exhausted-power": ["card-anatomy"],
  "recycle-location": ["card-anatomy"],
  "unit-entry": ["board-layout"],
  "battlefield-play": ["board-layout"],
  timing: ["timing"],
  "chain-order": ["timing"],
  holding: ["turns-and-scoring"],
  "final-point": ["turns-and-scoring"]
};

export function isQuizQuestionLearned(question: NewPlayerQuizQuestion, context: QuizLearningContext): boolean {
  // The FAQ is taught in Basics, not in its fallback board review destination.
  if (question.reviewTopicId) return context.readTopicIds.includes(question.reviewTopicId);
  return context.completedLessonIds.includes(question.lessonId) ||
    (QUIZ_BASICS_PREREQUISITES[question.id] ?? []).some(id => context.readTopicIds.includes(id));
}

export function learnedQuizQuestions(context: QuizLearningContext): NewPlayerQuizQuestion[] {
  return NEW_PLAYER_QUIZ.filter(question => isQuizQuestionLearned(question, context));
}

/** A stable, saved short round, with untouched questions first and varied topics. */
export function makeQuizCheckIn(progress: NewPlayerQuizProgress, context: QuizLearningContext, size = 10): string[] {
  const learned = learnedQuizQuestions(context);
  const untried = learned.filter(question => !progress.answers[question.id] || needsLearnedAttempt(progress, question.id));
  const available = untried.length ? untried : learned;
  const topics = new Map<string, NewPlayerQuizQuestion[]>();
  for (const question of available) topics.set(question.topic, [...(topics.get(question.topic) ?? []), question]);
  const selected: string[] = [];
  while (selected.length < Math.max(0, size) && [...topics.values()].some(group => group.length)) {
    for (const group of topics.values()) {
      const question = group.shift();
      if (question) selected.push(question.id);
      if (selected.length >= Math.max(0, size)) break;
    }
  }
  return selected;
}

export function quizCheckInQuestions(progress: NewPlayerQuizProgress, context: QuizLearningContext): NewPlayerQuizQuestion[] {
  const ids = progress.checkInIds?.length ? progress.checkInIds : makeQuizCheckIn(progress, context);
  return ids.flatMap(id => {
    const question = NEW_PLAYER_QUIZ.find(item => item.id === id);
    return question && isQuizQuestionLearned(question, context) ? [question] : [];
  });
}

export function startQuizCheckIn(progress: NewPlayerQuizProgress, context: QuizLearningContext): NewPlayerQuizProgress {
  const checkInIds = makeQuizCheckIn(progress, context);
  return { ...progress, scope: "learned", checkInIds, checkInAnswers: {},
    currentId: checkInIds[0] ?? progress.currentId, view: checkInIds.length ? "questions" : "intro" };
}

/** An early guess is preserved, but is not the first assessment after learning. */
export function needsLearnedAttempt(progress: NewPlayerQuizProgress, id: string): boolean {
  const answer = progress.answers[id];
  return answer?.firstWasUnseen === true && answer.firstLearned === undefined;
}
