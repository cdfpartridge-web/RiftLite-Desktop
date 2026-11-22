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
  { ...question("draw-or-play", "Cards in your hand", "You’ve just drawn Watchful Sentry, where is it now?", ["In my base, ready to use", "In my hand, ready for me to play later", "On a battlefield, scoring a point"], 1, "You’ve taken Sentry off the top of your main deck and put it into your hand. When you want it on the table, you’ll need a chance to play a unit and 2 energy to pay for it.", "play-first-unit", "board-layout"), board: { caption: "A card has just moved from your main deck to your hand.", zones: [{label:"Your hand",cards:[{cardId:"OGN-096",name:"Watchful Sentry"}]},{label:"Your base",note:"No unit has been played here yet.",cards:[]}] } },
  { ...question("mulligan-plan", "Choosing an opening hand", "You’re going first with Sentry and Elder in your hand, would you have to send Elder back because it costs 4?", ["Yes, a four-cost unit has to go back", "No, I can play Sentry early and keep Elder for later", "No, keeping Elder lets me play it for free"], 1, "I’d keep Elder in this hand, because Sentry costs 2 energy and gives me something to play on turn one. If my whole hand cost 4, I’d have much more reason to look for a replacement, even though I could still draw another expensive card.", "mulligan-practice", "build-a-deck"), board: { caption: "Part of an opening hand, going first. Your first Channel will provide two runes.", zones: [{label:"An early play · 2 energy",cards:[{cardId:"OGN-096",name:"Watchful Sentry"}]},{label:"A later play · 4 energy",cards:[{cardId:"OGN-065",name:"Wizened Elder"}]}] } },
  { ...question("predict-survivor", "Read the fight", "Your Elder has 4 Might and their Pickpocket has 3, so if nobody plays anything else, who comes out of the fight?", ["Both units die", "Pickpocket hits first and survives", "Elder survives with 3 damage, Pickpocket takes 4 and dies"], 2, "Elder deals 4 and Pickpocket deals 3 at the same time, so Pickpocket still gets its hit in. It takes 4 to kill Elder and that hit only marks 3, so Elder survives, clears the damage during combat cleanup and is still there when you work out control.", "simple-combat", "turns-and-scoring"), board: { caption: "One battlefield, before combat damage. No buffs, spells, gear or legend effects change these numbers.", zones: [{label:"Your attacker",cards:[{cardId:"OGN-065",name:"Wizened Elder",might:4,ready:false}]},{label:"Their defender",cards:[{cardId:"SFD-074",name:"Pickpocket",might:3,ready:true}]}] } },
  { ...question("reserve-a-response", "Plan your resources", "You’ve got two ready runes and could play Clockwork Keeper now, what’s the reason for leaving them open?", ["I can make 2 energy for Discipline if they attack", "I can only play one unit a turn", "The runes will score if I leave them ready"], 0, "I’d look at the battlefield I want to defend. Keeper gives me a unit now, but if I spend both runes on it, I won’t have the 2 energy for Discipline in the fight. If I think an attack’s coming, I can leave those runes ready and decide once I see it.", "resource-decisions", "domains"), board: { caption: "Your open Main phase with two ready runes and no available energy yet. These two cards are in your hand.", zones: [{label:"Develop another unit · 2 energy",cards:[{cardId:"OGN-044",name:"Clockwork Keeper",might:2}]},{label:"Keep a response · 2 energy",cards:[{cardId:"OGN-058",name:"Discipline"}]}] } },
  { ...question("recover-a-point", "After losing control of a battlefield", "Their Elder has taken the left battlefield, but your Keeper is ready in base. Where could you go for your next point?", ["Move their Elder out of the way", "Take Keeper to the empty right battlefield and finish the showdown", "Stay in base and claim the empty battlefield"], 1, "You’ve still got a ready unit and an empty battlefield on the right, so I’d exhaust Keeper to move there in your open Main phase. They get a chance to respond, then if Keeper’s still there on its own, you conquer and score.", "recovery-practice", "turns-and-scoring"), board: { caption: "Your open Main phase. No other effects restrict movement. The right battlefield has no units.", zones: [{label:"Your base",cards:[{cardId:"OGN-044",name:"Clockwork Keeper",might:2,ready:true}]},{label:"Left battlefield · opponent controls",cards:[{cardId:"OGN-065",name:"Wizened Elder",might:4,ready:false}]},{label:"Right battlefield · uncontrolled",note:"An available place to contest.",cards:[]}]} },
  question("identity", "Getting set up", "Your legend has Calm and Mind, which cards could you put in the deck?", ["Anything I can afford to play", "Cards that fit Calm and Mind, plus eligible domainless cards", "Only cards with both symbols on them"], 1, "Start with the domains on your legend. A Calm card fits, a Mind card fits, and a card with both fits as well. Domainless cards can qualify too, but you still need to check the other deckbuilding rules before adding a copy.", "table-setup", "legend-and-champion"),
  question("chosen-champion", "Getting set up", "Ahri’s face up in your champion zone, can she fight for you there?", ["Yes, revealing her puts her into play", "Yes, once I get to my second turn", "No, I need to play her and pay her cost first"], 2, "You know where Ahri is, so you won’t have to draw her, but she’s still waiting in the champion zone. When you can legally play a unit, pay her cost and put her on the board, just as you would with a unit from your hand.", "power-and-champion", "legend-and-champion"),
  question("mulligan", "Your opening turn", "You’ve drawn your opening four and a couple of them look awkward, what can you do before turn one?", ["Swap up to two cards, once", "Keep swapping all four until I like them", "Keep all four and draw another two"], 0, "Pick up to two cards and set them aside, then draw that many replacements before you recycle the originals to the bottom of your main deck. If those new cards are awkward too, you keep them, you’ve had your mulligan.", "opening-hand", "build-a-deck"),
  question("abcd", "Your opening turn", "Your turn’s just started, in what order do you get to your Main phase?", ["Draw → Channel → Beginning → Awaken", "Awaken → Beginning → Channel → Draw", "Channel → Draw → Awaken → Beginning"], 1, "I remember it as ABCD. Awaken readies your cards, Beginning is where you handle Beginning effects and check for holding, then you channel your runes and draw your card before you get to Main.", "first-or-second", "turns-and-scoring"),
  question("second-player", "Your opening turn", "You’re going second in this two-player game, what changes on your first turn?", ["I skip my draw", "I start a point ahead", "I channel 3 runes instead of 2"], 2, "When you get to your first Channel, you’re the second player so you get an extra rune, three in total. You still draw a card, just like the player who went first, and your later Channel phases normally give you two runes.", "first-or-second", "turns-and-scoring"),
  question("energy", "Energy and power", "The number in the top left is 2, do the runes you use for that energy have to match the card’s domain?", ["No, any basic runes can make the energy", "Yes, both runes have to match", "No, I can skip the energy cost"], 0, "For that 2, any two basic runes can give you an energy each. If there’s a domain symbol as well, that’s a separate power cost, and you need to match the symbol unless the card lets you pay any power.", "read-a-card", "card-anatomy"),
  question("exhausted-power", "Energy and power", "You’ve turned your Mind rune sideways for 1 energy, can you still use that rune for Mind power?", ["No, it has to ready first", "Yes, I can recycle it for 1 Mind power", "Yes, I can exhaust it again"], 1, "You can use that same Mind rune twice here, once for energy and once for power. You’ve already exhausted it, so now recycle it to the bottom of your rune deck to get the Mind power.", "power-and-champion", "domains"),
  question("recycle-location", "Energy and power", "You’ve recycled a rune to pay for power, where will you find it now?", ["Back in my rune area, ready", "In my trash for the rest of the game", "On the bottom of my rune deck"], 2, "That rune’s gone back to the bottom of your rune deck, which is the trade you made for the power. When you ready your runes next turn it won’t be there, you’ll need to channel it again to get it back on the table.", "power-and-champion", "domains"),
  question("unit-entry", "Playing your units", "You pay for a unit from your hand and play it in base, which way up does it enter under the normal rule?", ["Exhausted", "Ready, because I paid the full cost", "Ready, because I played it in base"], 0, "Turn it sideways as it comes in, whether you play it in base or at a battlefield you control. Some cards give you a way to enter ready, but you need a rule or effect that actually says so before you can do that.", "play-first-unit", "card-anatomy"),
  question("battlefield-play", "Playing your units", "You control Monastery of Hirana and can afford the unit in your hand, can you play it straight to Monastery?", ["No, I have to play it in base first", "Yes, when I can play a unit, and it normally enters exhausted", "Yes, and I get another point for putting it there"], 1, "Monastery’s yours, so when you can play a unit you can put it straight there, exhausted. You already control it, so you won’t get a point for adding a unit. I’d still read the battlefield first, because Rockfall Path, for example, stops you playing units there.", "holding", "board-layout"),
  question("timing", "Timing and the chain", "There’s already a spell on the chain and you want to answer it, which keyword should you look for on your spell?", ["Action", "Hidden, wherever the card is", "Reaction, provided I can pay and use it here"], 2, "Look for Reaction if you want to play a spell while that first one’s waiting. Action on its own needs an open window, so it can start a play in a showdown with an empty chain, but it can’t answer the spell that’s already there.", "the-chain", "timing"),
  question("chain-order", "Timing and the chain", "They play a spell, you play a Reaction in response and you both pass, which one happens first?", ["My Reaction", "Their original spell", "Both at once"], 0, "Work back from the last card played, so your Reaction resolves first. Their spell is still on the chain afterwards, and you get another chance to respond before it resolves when both players pass.", "the-chain", "timing"),
  question("counter-effect", "Countering spells", "Your Defy counters their spell, where does that spell go?", ["It stays on the chain and does half as much", "Into its owner’s trash without resolving", "Back into its owner’s hand"], 1, "The spell leaves the chain and goes to its owner’s trash, so none of its instructions happen. Before you use Defy, check both parts of the printed cost, because it can only counter a spell costing up to 4 energy and up to 1 power.", "countering-spells", "timing"),
  question("counter-costs", "Countering spells", "Your opponent’s paid for a spell and your counterspell stops it, how much do they get back?", ["All their energy and power", "Just the power", "None of the cost"], 2, "They spent those resources when they played the spell, so they stay spent when you counter it. You still need your counterspell to resolve, and they do get a chance to respond to that as well.", "countering-spells", "timing"),
  { ...question("waiting-play-effect", "Units and their abilities", "Watcher’s on-play ability is waiting, then Star-Crossed puts Thousand-Tailed Watcher back in your hand. What happens to the ability?", ["It disappears when Watcher leaves", "It still resolves after both players pass", "It resolves twice when Watcher reaches my hand"], 1, "Watcher’s already put its ability on the chain, so returning the unit to hand leaves that ability right where it was. Once you both pass, the enemy units still on the table get −3 Might for the turn, down to a minimum of 1.", "unit-play-effects", "timing"), board: {caption:"Star-Crossed has finished. Watcher is back in your hand, with its ability still waiting.",zones:[{label:"Your hand",cards:[{cardId:"OGN-116",name:"Thousand-Tailed Watcher"}]},{label:"Enemy base",note:"Still 4 Might until the waiting ability resolves.",cards:[{cardId:"RAD-050",name:"Mysterious Chronomancer",might:4}]}]} },
  { ...question("departed-target", "When a target leaves", "You’ve played Discipline on Sentry, but Star-Crossed puts Sentry back in your hand before it resolves. What do you get from Discipline?", ["I pick another unit for the bonus", "I lose both the bonus and the draw", "I still draw a card, but Sentry misses the Might bonus"], 2, "Discipline’s lost the Sentry it targeted, so you can’t give that bonus to Sentry or pick someone else. You can still follow the separate instruction to draw 1, and you’ve already paid for Discipline. Sentry went to hand, so its Deathknell never triggered.", "unit-play-effects", "timing"), reviewStepId:"target-reset", board:{caption:"Sentry has returned to your hand. Discipline remains on the chain.",zones:[{label:"Your hand",cards:[{cardId:"OGN-096",name:"Watchful Sentry"}]},{label:"Waiting on the chain",cards:[{cardId:"OGN-058",name:"Discipline"}]}]} },
  question("lethal-first", "Combat damage", "You’ve got 8 combat damage and two ordinary defenders with 2 Might each, how do you divide it?", ["2 to the first, then all 6 left over to the second", "4 to each, an even split", "1 to the first, then 7 to the second"], 0, "Pick the first defender and give it enough damage to kill it, which is 2 here. The second is the last unit in line, so it takes all 6 that are left. If any defenders have Tank, assign lethal to them first. Backline goes after defenders without Backline, so check both keywords before you pick your order.", "combat-damage", "turns-and-scoring"),
  question("simultaneous", "Combat damage", "Your attacker’s about to deal enough damage to kill the defender, does the defender still hit back?", ["No, the attacker hits first", "Yes, both deal their assigned damage at the same time", "Only if the defender cost more energy"], 1, "You work out where the damage is going first, then both sides deal it together. Even if that hit kills their defender, your attacker still takes the damage the defender assigned to it.", "combat-damage", "turns-and-scoring"),
  question("holding", "Scoring and winning", "You’ve kept control of a battlefield through your opponent’s turn, when do you normally get the point for holding it?", ["When they end their turn", "After I draw for the turn", "In my Beginning phase, after Beginning effects"], 2, "Wait until your own Beginning phase and deal with the Beginning effects first. If the battlefield’s still yours when you check holding, that’s when you score, which is why it matters whether your defender is still there.", "holding", "turns-and-scoring"),
  question("one-score-per-battlefield", "Scoring and winning", "You scored the left battlefield for holding, then left it and took it back in the same turn. Can you score it again?", ["Yes, if I used another unit", "No, but I can still score the right battlefield if I haven’t already", "I draw a card instead of getting a second point"], 1, "You get control of the left battlefield back, but you’ve already scored it this turn, so there’s no new conquer, conquer trigger or replacement draw. You can still go for the right one, because each battlefield is tracked separately.", "scoring-once-per-turn", "turns-and-scoring"),
  question("opponent-scoring-allowance", "Scoring and winning", "You’ve scored here this turn, your opponent hasn’t, and they’ve found a legal way to take the battlefield from you. Can they score it?", ["No, my point used it up for everyone", "Only if I give my point back", "Yes, they can still score it this turn"], 2, "The question to ask is who’s already scored this particular battlefield this turn. Your point used your chance, so if your opponent legally takes control and finishes the contest, they can score it once as well.", "scoring-once-per-turn", "turns-and-scoring"),
  question("score-reset-next-turn", "Scoring and winning", "You’ve already scored both battlefields this turn, when do you both get a fresh chance to score them?", ["When a unit leaves", "When the next turn starts, whoever’s turn it is", "When both players have had another turn"], 1, "As soon as either player starts a new turn, both players get a fresh record for each battlefield. You still have to earn the point by conquering or by holding in your own Beginning, and changing phase in the middle of a turn won’t reset anything.", "scoring-once-per-turn", "turns-and-scoring"),
  question("final-point", "Scoring and winning", "You’re on 7, you haven’t scored anywhere this turn and you conquer your first battlefield. What do you get?", ["A draw, and I can still win by scoring the other battlefield this turn", "My eighth point straight away", "A draw, because conquering can never win the game"], 0, "Conquering for your last point means you need to have scored every battlefield that turn. Here the first one gives you a draw and counts as scored, so taking the other one can win it. If you hold a battlefield in Beginning instead, that can give you the eighth point on its own.", "win-the-game", "turns-and-scoring"),
  question("hidden", "Hidden and delayed effects", "You just hid a card at a battlefield you control, can you play it from hiding later this same turn?", ["Yes, as soon as I’ve hidden it", "No, I have to wait for a later turn", "Yes, if I hide another card as well"], 1, "Think of hiding the card as getting it ready for a later turn. When that turn comes, you still need a legal chance to play it, and any location or targeting requirements on the card still matter.", "hidden-cards", "timing"),
  question("ganking", "Keyword movement", "Your unit’s ready at one battlefield, what extra route does Ganking give it?", ["It can move without exhausting", "It can move an opposing unit", "It can go straight to the other battlefield"], 2, "Normally a unit making this trip would have to go back via base. Ganking lets it go straight across, but it’s still making a standard move, so it needs to be ready, exhausts to move and follows any other restrictions.", "keyword-equipment", "board-layout"),
  question("unique", "Gear and deckbuilding", "You want Forgefire Cape in your deck and it has Unique, how many copies can you put on the list?", ["One copy", "Three, if I only play one at a time", "As many as I like because it’s gear"], 0, "Check Unique when you write the decklist, because you’re allowed one copy of a card with that name. Having a plan to play only one at a time won’t make a second copy on the list legal.", "keyword-new-tools", "build-a-deck"),
  question("legion", "Keyword conditions", "You’re about to play a card with Legion, what are you checking about this turn?", ["Whether I control both battlefields", "Whether I’ve already played another card", "Whether my opponent played a card last turn"], 1, "Look back at what you’ve played this turn. If this would be your first card, Legion is off, but if you’ve already played another card, Legion is on and the card tells you what you get.", "keyword-growth", "card-anatomy"),
  question("empowered", "Keyword conditions", "You could spend resources on your unit’s Empower ability, what do you get for paying it?", ["All the cards in my hand cost nothing", "The unit wins its next combat", "The unit becomes Empowered and its Empowered text applies"], 2, "Empower is the ability you activate, and paying for it lets the unit become Empowered when that ability resolves. Read the part of that unit’s card marked Empowered to see what changes, because different units can get different benefits.", "keyword-surprises", "card-anatomy"),
  question("flow", "Using your trash", "You’ve played a spell out of your trash using Flow and it’s finished resolving, where does it go?", ["Into banishment", "Back to my hand", "Back to my trash, ready to use Flow again"], 0, "Flow gives you another chance to play that spell from your trash if you pay its Flow cost. You still need the usual timing to play it, and once it resolves it goes to banishment, so it’s no longer there for another go.", "keyword-equipment", "timing"),
  { ...question("move-as-a-group", "Moving units together", "Sentry and Keeper are both ready in base, can they make one move to the same battlefield in your open Main phase?", ["Yes, exhaust both and move them together", "No, the first unit has to finish fighting before the other can move", "Only if I pay both play costs again"], 0, "If I wanted both units in the same fight, I’d move them together. Exhaust each ready unit, move them both to the same legal destination, then handle the showdown they’ve started there. They’re already in play, so moving them costs none of their printed play cost.", "group-movement", "board-layout"), board: {caption:"Your open Main phase. Both units are ready in base; no effect prevents this move.",zones:[{label:"Your base",cards:[{cardId:"OGN-096",name:"Watchful Sentry",might:1,ready:true},{cardId:"OGN-044",name:"Clockwork Keeper",might:2,ready:true}]},{label:"The battlefield you want to contest",note:"Choose one shared destination for this group move.",cards:[]}]} },
  { ...question("damage-is-not-might", "Damage and Might", "Elder’s got 4 Might and has already taken 2 damage, so if nothing else changes, how much combat damage does it deal?", ["2 damage", "4 damage", "6 damage"], 1, "Elder still hits for its full 4 Might, but with 2 damage already marked it would only take another 2 to kill it. Healing clears marked damage, while gaining Might changes how hard it hits and how much damage it can survive.", "damage-and-might", "card-anatomy"), board:{caption:"Before combat damage: Elder has already taken 2 damage from an effect.",zones:[{label:"Your unit",note:"2 damage marked; current Might remains 4.",cards:[{cardId:"OGN-065",name:"Wizened Elder",might:4}]},{label:"Combat damage still to happen",note:"Use current Might, not Might minus damage.",cards:[]}]} },
  question("buff-or-bonus", "Buffs and other bonuses", "Discipline gave your unit +2 Might this turn, but it has no buff counter. Can you spend that +2 for Monastery’s ability?", ["Yes, any extra Might will do", "Yes, I can spend half the bonus", "No, I need a buff counter to spend"], 2, "Look for an actual buff counter on the unit, the one that normally gives it +1 Might. Discipline and Equipment can both make the Might number bigger, but neither of those bonuses gives you a buff counter to spend at Monastery.", "buffs-and-bonuses", "card-anatomy"),
  question("gear-after-bearer", "Equipment after its unit leaves", "Your unit dies at a battlefield while it’s carrying Long Sword. Once cleanup’s finished, where would you look for the sword?", ["Back to my base, where I can use Equip again later", "Into the trash with the unit", "Still at the battlefield, waiting for my next unit"], 0, "Long Sword comes off where its bearer died, so for a moment it’s still at the battlefield. Cleanup recalls the unattached sword to your base, and when you’ve got another unit for it you can pay Equip again at the usual time.", "equipment-lifecycle", "card-anatomy"),
  question("champion-after-death", "Your chosen champion after play", "You played the Ahri from your champion zone and she’s just died, where does she normally go?", ["Back to the champion zone", "Into my trash", "Into the legend zone"], 1, "Once you’ve played Ahri she follows the normal unit rules, so dying sends her to the trash, and an effect that returns her to hand would put her in your hand. The champion zone doesn’t refill, but you can still play another legal copy at its usual cost, even if you already have a champion unit out.", "champion-destinations", "legend-and-champion"),
  question("reaction-can-start", "Starting a chain", "There’s nothing on the chain and you have focus and priority in a showdown, can you play Discipline first?", ["No, I need an enemy spell to respond to", "No, only Action cards can start a chain", "Yes, I can start with a Reaction here"], 2, "You can start the chain with Discipline here, provided you can pay for it and have a legal unit to target. Reaction gives you the timing you’d get from Action as well as the chance to respond to something already waiting, and your opponent gets to answer your play.", "passing-decisions", "timing"),
  question("priority-is-not-end-turn", "Passing the right opportunity", "Discipline’s on the chain and you pass priority, what are you actually passing up?", ["My chance to add something right now", "The rest of my turn", "Every chance to respond before the whole chain resolves"], 0, "You’re saying you’ve got nothing to add right now. Once both players have passed, only the newest item resolves, and you can have another decision if something’s still waiting. Passing focus in an empty showdown and ending your turn in Main are separate choices.", "passing-decisions", "timing"),
  question("save-runes-not-energy", "Keeping a response available", "You’d like to have Discipline ready for their turn, what should you save?", ["2 energy I’ve already made", "Two ready runes I can use when I need them", "Two exhausted runes for their Awaken phase"], 1, "Leave the runes ready, because both players lose unspent energy and power when the turn ends and when Main begins. Their Awaken only readies their cards, so if you want that 2 energy for Discipline, make it when you have the chance to play it.", "ready-runes-and-defenders", "domains"),
  { ...question("exhausted-can-defend", "Exhausted units in combat", "You’ve played Keeper at your battlefield and it’s still exhausted, can it defend if your opponent attacks there next turn?", ["No, it has to be ready to deal damage", "No, a newly played unit can’t defend", "Yes, it can still defend and deal combat damage"], 2, "Keeper’s already on the battlefield they’re attacking, so it still fights there, deals damage equal to its current Might and can take damage back. Being exhausted stops it making a standard move, while something like Stun would be a separate reason it couldn’t deal combat damage.", "ready-runes-and-defenders", "board-layout"), board:{caption:"Keeper was played directly onto a battlefield you control and is still exhausted.",zones:[{label:"Your battlefield",cards:[{cardId:"OGN-044",name:"Clockwork Keeper",might:2,ready:false}]},{label:"Opponent’s turn",note:"An enemy unit is about to attack this battlefield.",cards:[]}]} },
  { ...question("empty-main-deck", "When a deck runs out", "You’ve got cards in your trash but none in your main deck, and you have to draw one. What happens in this two-player game?", ["Burn Out, recycle my trash in random order, give them 1 point, then finish the draw if the game continues", "I skip the draw", "I shuffle my rune deck into my main deck"], 0, "This is Burn Out. Recycle your trash into your main deck in random order, then your opponent gets a point. If that point wins them the game you stop there, otherwise you finish drawing the card you needed.", "first-or-second", "first-real-game"), reviewTopicId:"first-real-game" },
  { ...question("empty-rune-deck", "When a deck runs out", "You’re meant to channel two runes and there’s only one left, what do you do?", ["Give my opponent a point for Burn Out", "Channel the one that’s left", "Use a card from my main deck for the other rune"], 1, "Channel what you’ve got, so one rune here, or none if the rune deck’s empty. Your opponent doesn’t get a point for that, and any runes you recycle for power can turn up in your rune deck again later.", "first-or-second", "first-real-game"), reviewTopicId:"first-real-game" },
  { ...question("hand-and-unit-limits", "Limits at the table", "You’ve got eight cards in hand and several units at one battlefield, do the normal rules make you clear any away?", ["Yes, keep four cards and one unit", "Yes, discard down to seven at the end of the turn", "No, there’s no normal limit on either"], 2, "Four is how many cards you start with, so drawing up to eight is fine, and you can have several units at the same battlefield. You still pay to play those cards, and individual cards or rules like the one facedown space for Hidden can have limits of their own.", "table-setup", "first-real-game"), reviewTopicId:"first-real-game" },
  { ...question("several-actions", "Making a turn", "You’ve finished a fight and its effects, you’re back in your open Main phase and you’ve got a ready unit and resources left. Can you do more?", ["Yes, I can make another legal play or move", "No, I’ve had my fight for the turn", "No, playing one card ends my turn"], 0, "You can keep going in Main as long as you can make the play or move you want, so check what’s ready, what you can afford and whether the timing works. You could have another fight this turn, though you can still only score each battlefield once yourself.", "plan-your-main", "first-real-game"), reviewTopicId:"first-real-game" },
  { ...question("word-may", "Reading the small words", "Monastery says you may spend a buff to draw when you conquer there, do you have to spend the buff you’ve got?", ["Yes, I have to do everything on the card", "No, I can keep the buff and skip the draw", "No, but then I lose the point I just earned"], 1, "“May” gives you the choice here. If you want the card you’ll need to spend the buff, but if you’d prefer to keep the buff you can leave it there, and either way you keep your point for conquering.", "buffs-and-bonuses", "first-real-game"), reviewTopicId:"first-real-game" },
  { ...question("word-another", "Reading the small words", "Your unit’s ability says to choose another friendly unit, can you choose the unit using the ability?", ["Yes, it’s a friendly unit", "Yes, if it’s my only unit", "No, I need a different friendly unit"], 2, "“Friendly” tells you whose unit to look for, and “another” means it has to be a different one from the unit using the ability. If that’s the only friendly unit you’ve got, you don’t have a unit that fits.", "unit-play-effects", "first-real-game"), reviewTopicId:"first-real-game" },
  { ...question("word-here", "Reading the small words", "A battlefield card refers to units “here”, where do you look?", ["At that battlefield, then check any other restrictions", "Anywhere on the table", "In my base"], 0, "Look at the card you’re reading. On a battlefield, “here” means that particular battlefield, so if the rest says “friendly units here”, count your units there and leave the ones at your other battlefield out.", "table-setup", "first-real-game"), reviewTopicId:"first-real-game" },
  { ...question("word-up-to", "Reading the small words", "You can choose up to two units and there are two legal choices, how many do you have to choose?", ["Both of them", "I can choose zero, one or two", "Exactly one"], 1, "Two is the most you can choose, so if you only want one of those units you can stop there, and you can also choose neither. Any unit you do choose still needs to fit the rest of the card’s wording.", "unit-play-effects", "first-real-game"), reviewTopicId:"first-real-game" }
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
