import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LESSONS, applyTutorialAction, createLessonState, createKeywordTutorialBoard, getTutorialStep, getTutorialSteps, getTutorialStepCount, undoTutorialAction, validateTutorialDamageAssignment, finishTutorialCombat, getTutorialActionBattlefield, getTutorialLessonContext, type TutorialState } from "../src/shared/newPlayerTutorial.js";
import { NEW_PLAYER_KEYWORD_GROUPS, NEW_PLAYER_KEYWORD_SCENARIOS, KEYWORD_LEGEND_PAIRS, OFFICIAL_KEYWORDS } from "../src/shared/newPlayerKeywordScenarios.js";
import { getNewPlayerTeachingDeck } from "../src/shared/newPlayerTeachingDecks.js";
import { NEW_PLAYER_BASICS, NEW_PLAYER_GLOSSARY } from "../src/shared/newPlayerCurriculum.js";

function advance(state: TutorialState, count = 1): TutorialState {
  for (let i = 0; i < count; i++) {
    const step = getTutorialStep(state)!;
    const next = applyTutorialAction(state, step.expectedAction);
    expect(next.feedback, `${state.lessonId} / ${step.id}`).toBeNull();
    expect(next.stepIndex).toBe(state.stepIndex + 1);
    state = next;
  }
  return state;
}
function finish(id: string) { return advance(createLessonState(id), LESSONS.find((l) => l.id === id)!.steps.length); }

function until(state: TutorialState, stepId: string): TutorialState {
  for(let n=0;n<500 && getTutorialStep(state)?.id!==stepId;n++) {
    if(state.completed) throw new Error(`Missing step ${state.lessonId}/${stepId}`);
    state=advance(state);
  }
  expect(getTutorialStep(state)?.id).toBe(stepId); return state;
}
const atStep=(lessonId:string,stepId:string)=>until(createLessonState(stepId.startsWith("keyword-") ? LESSONS.find(l=>l.steps.some(s=>s.id===stepId))?.id ?? lessonId : lessonId),stepId);
const afterStep=(lessonId:string,stepId:string)=>advance(atStep(lessonId,stepId));

describe("guided new-player scenarios", () => {
  it("reserves the guide actor for opponent actions and separates mandatory rules from learner phases",()=>{
    const steps=LESSONS.flatMap(l=>[...l.steps,...Object.values(l.branch?.variants??{}).flat()]);
    for(const s of steps.filter(s=>s.actor==="guide")){
      const e=s.guideEffect!;expect(e,s.id).toBeTruthy();
      if("side" in e&&e.type!=="start-turn")expect(e.side,s.id).toBe("opponent");
      if("cardId" in e)expect((e.cardId.startsWith("o-")||e.cardId.startsWith("opponent-")),s.id).toBe(true);
      if(e.type==="phase"&&e.phase==="Channel")expect(e.priority,s.id).toBe("opponent");
      expect(["assign","trigger","hidden-loss","resolve-ahri"],s.id).not.toContain(e.type);
      if(e.type==="keyword")expect(["ready-player","begin-player","channel-player","draw-player","trigger","follow-assign","follow-cleanup","deathknell-trigger","temporary-trigger","level-hunt"],s.id).not.toContain(e.operation);
    }
    for(const s of steps.filter(s=>["ready","check-beginning","channel","draw","choose-trigger"].includes(s.expectedAction.type)))expect(["guide","rules"],s.id).not.toContain(s.actor);
    expect(getTutorialStep(atStep("start-combat","ahri-trigger-resolve"))).toMatchObject({actor:"player",expectedAction:{type:"resolve"}});

  });
  it("validates learner phase order before running an authored phase effect",()=>{
    for(const [lesson,id]of [["power-and-champion","next-awaken"],["practice-first-point","practice-first-beginning"],["keyword-equipment","keyword-ganking-channel"],["keyword-new-tools","keyword-vision-vision-next-draw"]]){
      const before=atStep(lesson,id),broken=structuredClone(before);broken.board.phase="Main";
      const denied=applyTutorialAction(broken,getTutorialStep(broken)!.expectedAction);expect(denied.feedback,id).toBeTruthy();expect(denied.board).toBe(broken.board);expect(denied.actions).toEqual(broken.actions);
    }
  });
  it.each([["start-combat","ahri-trigger"],["keyword-surprises","keyword-disarm-trigger"],["keyword-growth","keyword-quick-draw-trigger"],["keyword-new-tools","keyword-weaponmaster-trigger"]])("waits for the learner's target before creating %s/%s",(lesson,id)=>{
    const before=atStep(lesson,`${id}-choose`),action=getTutorialStep(before)!.expectedAction;
    expect(action.type).toBe("choose-trigger");if(action.type!=="choose-trigger")throw new Error("Missing target choice");
    const wrong=applyTutorialAction(before,{...action,targetId:action.cardId});expect(wrong.feedback).toBeTruthy();expect(wrong.board).toBe(before.board);
    const chosen=advance(before);expect(chosen.board.chain).toEqual(before.board.chain);expect(chosen.board.decisions?.[`trigger:${action.cardId}`]).toBe(action.targetId);expect(undoTutorialAction(chosen)).toEqual(before);
    expect(getTutorialStep(chosen)?.actor).toBe("rules");const pending=advance(chosen);expect(pending.board.chain.at(-1)?.targetId).toBe(action.targetId);expect(pending.board.decisions?.[`trigger:${action.cardId}`]).toBeUndefined();
    expect(pending.board.cards.map(c=>({id:c.instanceId,might:c.might,zone:c.zone,attachedTo:c.attachedTo}))).toEqual(before.board.cards.map(c=>({id:c.instanceId,might:c.might,zone:c.zone,attachedTo:c.attachedTo})));
    let replay=createLessonState(before.lessonId);for(const saved of pending.actions)replay=applyTutorialAction(replay,saved);expect(replay).toEqual(pending);
  });
  it("gives every lesson a route and ends the first game before optional decision practice and all keywords",()=>{
    expect(LESSONS.every(l=>["first-game","practice","keywords"].includes(l.path!))).toBe(true);
    expect(LESSONS.slice(0,3).map(l=>l.id)).toEqual(["table-setup","opening-hand","first-or-second"]);
    const end=LESSONS.findIndex(l=>l.id==="practice-final-point");
    expect(LESSONS.slice(0,end+1).every(l=>l.path==="first-game")).toBe(true);
    expect(LESSONS.slice(end+1).every(l=>l.path!=="first-game")).toBe(true);
    expect(LESSONS.findIndex(l=>l.id==="simple-combat")).toBeLessThan(LESSONS.findIndex(l=>l.id==="start-combat"));
  });
  it("asks for a combat prediction without changing damage and then demonstrates the predicted survivors",()=>{
    const before=atStep("simple-combat","predict-fight");
    const wrong=applyTutorialAction(before,{type:"choose",optionId:"first"});
    expect(wrong.feedback).toContain("together");expect(wrong.board).toBe(before.board);expect(wrong.actions).toEqual(before.actions);
    const accepted=advance(before);expect(accepted.board.cards.map(c=>[c.instanceId,c.zone,c.might,c.damage])).toEqual(before.board.cards.map(c=>[c.instanceId,c.zone,c.might,c.damage]));
    const done=finish("simple-combat");expect(done.board.cards.find(c=>c.instanceId==="p-planner")?.zone).toBe("battlefield-left");expect(done.board.cards.find(c=>c.instanceId==="o-keeper")?.zone).toBe("trash");expect(done.board.players.player.score).toBe(2);expect(done.board.chain).toEqual([]);
  });
  it("keeps four cards for zero-card and two-card mulligans, with actual replacement identities and no cost",()=>{
    const kept=afterStep("mulligan-practice","keep-four");
    expect(kept.board.cards.filter(c=>c.owner==="player"&&c.zone==="hand")).toHaveLength(4);
    const before=atStep("mulligan-practice","replace-two"),after=advance(before);
    expect(after.board.players).toEqual(before.board.players);
    expect(after.board.cards.filter(c=>c.owner==="player"&&c.zone==="hand")).toHaveLength(4);
    for(const id of ["m-elder-one","m-elder-two"])expect(after.board.cards.find(c=>c.instanceId===id)?.zone).toBe("deck");
    expect(after.board.cards.filter(c=>c.zone==="trash")).toHaveLength(0);
    expect(after.board.cards.filter(c=>c.instanceId.startsWith("m-new-")).map(c=>c.cardId)).toEqual(["OGN-044","OGN-096"]);
    expect(undoTutorialAction(after)).toEqual(before);
  });
  it("recovery earns a different field without pretending the stronger enemy was defeated",()=>{
    const done=finish("recovery-practice");
    expect(done.board.players.player.score).toBe(3);expect(done.board.players.opponent.score).toBe(4);
    expect(done.board.cards.find(c=>c.instanceId==="o-elder")?.zone).toBe("battlefield-left");
    expect(done.board.battlefields.map(f=>f.controller)).toEqual(["opponent","player"]);
  });
  it.each(["reserve","develop"])("carries the %s resource plan through actual native actions, distinct consequences, exact replay and rewind",plan=>{
    const start=atStep("resource-decisions","budget-plan");
    let state=applyTutorialAction(start,{type:"choose",optionId:plan});expect(state.feedback).toBeNull();
    expect(state.board.decisions?.["budget-plan"]).toBe(plan);expect(undoTutorialAction(state)).toEqual(start);
    const count=getTutorialStepCount(state);expect(getTutorialSteps(state)).toHaveLength(count);
    while(!state.completed)state=advance(state);
    expect(state.actions).toHaveLength(count);expect(state.board.players.player.score).toBe(2);
    expect(state.board.battlefields[0].controller).toBe("player");expect(state.board.combat).toBeNull();expect(state.board.chain).toEqual([]);
    const pick=state.board.cards.find(c=>c.instanceId==="p-planner")!,keeper=state.board.cards.find(c=>c.instanceId==="p-keeper")!,discipline=state.board.cards.find(c=>c.instanceId==="p-discipline")!;
    expect(pick.zone).toBe(plan==="reserve"?"battlefield-left":"trash");expect(keeper.zone).toBe(plan==="reserve"?"hand":"battlefield-left");expect(discipline.zone).toBe(plan==="reserve"?"trash":"hand");
    expect(pick.might).toBe(3);expect(pick.damage).toBe(0);expect(keeper.damage).toBe(0);
    expect(state.board.cards.find(c=>c.instanceId==="o-elder")?.zone).toBe("trash");
    expect(state.board.cards.filter(c=>c.owner==="player"&&c.type==="rune").every(c=>!c.ready)).toBe(true);
    expect(state.board.players.player.deckCount).toBe(start.board.players.player.deckCount-(plan==="reserve"?1:0));
    expect(state.board.phase).toBe("Awaken");expect(state.board.turnPlayer).toBe("player");
    let replay=createLessonState(state.lessonId);for(const action of state.actions)replay=applyTutorialAction(replay,action);expect(replay).toEqual(state);
  });
  it("does not confuse a real rules violation with an action outside the scripted plan",()=>{
    const start=atStep("practice-first-point","energy-1"),first=advance(start);
    const tapped=applyTutorialAction(first,{type:"exhaust",cardId:"p-rune-1"});expect(tapped.feedback).toContain("Rule check:");expect(tapped.feedback).toContain("ready rune");expect(tapped.board).toBe(first.board);
    const outside=applyTutorialAction(start,{type:"inspect",cardId:"p-sentry"});expect(outside.feedback).toContain("exercise");expect(outside.feedback).not.toContain("Rule check:");expect(outside.board).toBe(start.board);
    expect(getTutorialStep(start)?.practiceHint).toBeTruthy();expect(getTutorialStep(start)?.practiceHint).not.toBe(getTutorialStep(start)?.instruction);
  });
  it("starts every lesson with a deliberate what-do-why introduction that rewinds without a board change",()=>{
    for(const lesson of LESSONS){
      const state=createLessonState(lesson.id),step=getTutorialStep(state)!;
      expect(step.lessonIntro,lesson.id).toEqual(lesson.intro);
      expect(["lesson-intro","mulligan-intro","turn-start"]).toContain(step.presentation);
      expect(step.expectedAction).toEqual({type:"continue"});expect(step.actor).not.toBe("guide");
      for(const part of Object.values(step.lessonIntro!))expect(part.length).toBeGreaterThan(20);
      const next=advance(state);expect(next.board.players).toEqual(state.board.players);expect(next.board.cards.map(({mightModifiers,...c})=>c)).toEqual(state.board.cards.map(({mightModifiers,...c})=>c));expect(undoTutorialAction(next)).toEqual(state);
    }
  });
  it.each([["play-first-unit","guide-pay-sentry"],["the-chain","opponent-pay-discipline"]])("prepares the guide's two-rune payment atomically in %s",(lesson,id)=>{
    const before=atStep(lesson,id),step=getTutorialStep(before)!;
    expect(step.guideEffect).toEqual({type:"exhaust-runes",cardIds:["o-rune-1","o-rune-2"]});
    const oldEnergy=before.board.players.opponent.energy;
    const after=advance(before);
    expect(after.board.players.opponent.energy).toBe(oldEnergy+2);
    expect(after.board.cards.filter(c=>["o-rune-1","o-rune-2"].includes(c.instanceId)).every(c=>!c.ready&&c.zone==="runes")).toBe(true);
    expect(after.board.players.opponent.runeDeckCount).toBe(before.board.players.opponent.runeDeckCount);
    expect(after.actions).toHaveLength(before.actions.length+1);expect(undoTutorialAction(after)).toEqual(before);
    const invalid=structuredClone(before);invalid.board.cards.find(c=>c.instanceId==="o-rune-2")!.ready=false;
    const rejected=applyTutorialAction(invalid,step.expectedAction);
    expect(rejected.feedback).toContain("different ready runes");expect(rejected.board).toBe(invalid.board);
    expect(rejected.board.cards.find(c=>c.instanceId==="o-rune-1")?.ready).toBe(true);expect(rejected.board.players.opponent.energy).toBe(oldEnergy);
  });
  it("keeps the core Poro's Assault through damage and conquest, then removes it when combat ends",()=>{
    const damage=afterStep("keywords-in-combat","keyword-resolution");
    expect(damage.board.cards.find(c=>c.instanceId==="p-poro")).toMatchObject({might:3,damage:0,mightModifiers:[{label:"Assault",amount:1}]});
    expect(damage.board.combat).not.toBeNull();
    const scored=advance(damage);expect(scored.board.cards.find(c=>c.instanceId==="p-poro")).toMatchObject({might:2,damage:0,mightModifiers:[]});expect(scored.board.combat).toBeNull();
  });
  it("retains attacking Might through queued conquest triggers and their nonempty chain",()=>{
    const board=structuredClone(afterStep("keyword-combat","keyword-assault-finish-cleanup").board);
    // A legal Hunt unit beside the survivor creates a conquest trigger before combat can end.
    const hunt=structuredClone(createKeywordTutorialBoard("keyword-level","after").cards.find(c=>c.cardId==="UNL-016")!);
    hunt.zone="battlefield-left";board.cards.push(hunt);board.players.player.score=1;board.battlefields[0].controller="player";
    board.combat!.pendingEnd=true;board.combat!.pendingTriggers=[hunt.instanceId];
    expect(finishTutorialCombat(board)).toBe(false);expect(board.cards.find(c=>c.instanceId==="player-OGN-215")?.might).toBe(6);
    board.combat!.pendingTriggers=[];board.chain.push({id:`${hunt.instanceId}:trigger`,cardId:hunt.cardId,controller:"player",label:"Hunt 2"});
    expect(finishTutorialCombat(board)).toBe(false);expect(board.cards.find(c=>c.instanceId==="player-OGN-215")?.might).toBe(6);
    board.chain.pop();board.players.player.xp=2;
    expect(finishTutorialCombat(board)).toBe(true);expect(board.combat).toBeNull();expect(board.cards.find(c=>c.instanceId==="player-OGN-215")?.might).toBe(5);
  });
  it("starts Action in Main, reads both windows, then moves before paying for Cleave",()=>{
    const start=atStep("keyword-timing","keyword-action-read-action");
    expect(start.board.phase).toBe("Main");expect(start.board.cards.find(c=>c.instanceId==="player-OGN-010")).toMatchObject({zone:"base",ready:true,might:2});
    const read=advance(start);expect(read.board.cards).toEqual(start.board.cards);
    const attack=advance(read);expect(attack.board.cards.find(c=>c.instanceId==="player-OGN-010")).toMatchObject({zone:"battlefield-left",ready:false,might:2});
    expect(attack.board.phase).toBe("Combat showdown");expect(attack.board.players.player.energy).toBe(0);
    expect(afterStep("keyword-timing","keyword-action-effect-resolve").board.cards.find(c=>c.instanceId==="player-OGN-010")?.might).toBe(5);
  });
  it("draws a real Defy from Discipline and counters the original Cleave in the next response window",()=>{
    const before=atStep("keyword-timing","keyword-reaction-effect-resolve");expect(before.board.cards.some(c=>c.instanceId==="player-OGN-045")).toBe(false);
    const drawn=advance(before);expect(drawn.board.cards.find(c=>c.instanceId==="player-OGN-045")).toMatchObject({cardId:"OGN-045",zone:"hand",faceDown:false});
    expect(drawn.board.players.player.deckCount).toBe(before.board.players.player.deckCount-1);expect(drawn.board.players.player.handCount).toBe(before.board.players.player.handCount!+1);
    expect(drawn.board.chain.map(c=>c.id)).toEqual(["opponent-OGN-004"]);expect(drawn.board.priority).toBe("opponent");
    const played=afterStep("keyword-timing","keyword-reaction-counter-play");expect(played.board.chain.map(c=>c.id)).toEqual(["opponent-OGN-004","player-OGN-045"]);
    const enemyResources=structuredClone(played.board.players.opponent);
    const resolved=afterStep("keyword-timing","keyword-reaction-counter-resolve");expect(resolved.board.chain).toEqual([]);
    for(const id of ["opponent-OGN-004","player-OGN-045"])expect(resolved.board.cards.find(c=>c.instanceId===id)?.zone).toBe("trash");
    expect(resolved.board.cards.find(c=>c.instanceId==="opponent-OGN-010")?.might).toBe(2);expect(resolved.board.cards.find(c=>c.instanceId==="player-OGN-054")?.might).toBe(6);
    expect(resolved.board.players.opponent).toEqual(enemyResources);expect(resolved.board.players.player.energy).toBe(0);expect(resolved.board.players.player.power.Calm).toBe(0);
    expect(undoTutorialAction(resolved)).toEqual(atStep("keyword-timing","keyword-reaction-counter-resolve"));
  });



  it("places three cumulative practice missions after their teaching segments",()=>{
    for(const [source,id] of [["first-conquest","practice-first-point"],["combat-damage","practice-reactions"],["win-the-game","practice-final-point"]]){
      expect(LESSONS[LESSONS.findIndex(l=>l.id===source)+1]?.id).toBe(id);
      const lesson=LESSONS.find(l=>l.id===id)!;expect(lesson.practice?.goal).toBeTruthy();expect(lesson.steps[0].presentation).toBe("lesson-intro");
      for(const step of lesson.steps.slice(1))expect(step.guidance).toBe(["guide","rules"].includes(step.actor??"")||["ready","check-beginning","channel","draw"].includes(step.expectedAction.type)?undefined:"practice");
      expect(finish(id).completed).toBe(true);
    }
    expect(finish("practice-first-point").board.players.player.score).toBe(1);
    expect(finish("practice-reactions").board.battlefields[1].controller).toBe("player");
    expect(finish("practice-final-point").board).toMatchObject({phase:"Victory",players:{player:{score:8}}});
  });
  it("requires all four native turn-start steps on both practice turns, without advancing on old automatic events",()=>{
    const start=createLessonState("practice-first-point");expect(start.board.cards.filter(c=>c.owner==="player"&&c.zone==="runes")).toHaveLength(0);expect(start.board.cards.filter(c=>c.owner==="player"&&c.zone==="hand")).toHaveLength(4);
    expect(start.board.log).toHaveLength(1);expect(start.board.log[0]).toContain("You will complete Awaken");
    const intro=advance(start);expect(getTutorialStep(intro)?.actor).toBe("player");expect(intro.board.phase).toBe("Awaken");
    const wrong=applyTutorialAction(intro,{type:"guide",eventId:"practice-first-channel"});expect(wrong.board).toBe(intro.board);expect(wrong.stepIndex).toBe(intro.stepIndex);
    const awakened=advance(intro);expect(awakened.board.phase).toBe("Beginning");
    const beginning=advance(awakened);expect(beginning.board.phase).toBe("Channel");
    const channelled=advance(beginning);expect(channelled.board.cards.filter(c=>c.owner==="player"&&c.zone==="runes"&&c.ready)).toHaveLength(2);expect(channelled.board.players.player.runeDeckCount).toBe(10);expect(channelled.board.players.player.deckCount).toBe(35);
    const drawn=advance(channelled);expect(drawn.board.cards.find(c=>c.instanceId==="p-sentry")).toMatchObject({zone:"hand",faceDown:false});expect(drawn.board.players.player.deckCount).toBe(34);expect(drawn.board.phase).toBe("Main");expect(getTutorialStep(drawn)?.guidance).toBe("practice");expect(undoTutorialAction(drawn)).toEqual(channelled);
    const second=atStep("practice-first-point","practice-awaken");expect(second.board.phase).toBe("Awaken");expect(second.board.cards.find(c=>c.instanceId==="p-sentry")).toMatchObject({ready:false,zone:"base"});
    expect(second.board.cards.filter(c=>c.owner==="opponent"&&c.type==="rune")).toHaveLength(3);
    let next=second;
    for(const type of ["ready","check-beginning","channel","draw"]){expect(getTutorialStep(next)?.expectedAction.type).toBe(type);expect(getTutorialStep(next)?.actor).toBe("player");const before=next;next=advance(next);expect(undoTutorialAction(next)).toEqual(before);}
    expect(next.board.phase).toBe("Main");expect(next.board.cards.find(c=>c.instanceId==="p-sentry")?.ready).toBe(true);expect(next.board.cards.filter(c=>c.owner==="player"&&c.zone==="runes")).toHaveLength(4);expect(next.board.players.player.deckCount).toBe(33);
    expect(getTutorialStep(next)?.practiceGoal).toContain("Turn two");expect(getTutorialStep(drawn)?.practiceGoal).toContain("Turn one");
    const end=getTutorialStep(atStep("practice-first-point","end-first"))!;expect(end.practiceGoal).toBe(end.instruction);expect(end.practiceGoal).toContain("End your turn");
  });
  it("executes either real rune tap order in practice, then reaches the same paid board with exact replay",()=>{
    const initial=atStep("practice-first-point","energy-1");
    expect(initial.board.cards.filter(c=>c.owner==="player"&&c.zone==="hand"&&c.cardId==="OGN-096")).toHaveLength(1);
    const a=applyTutorialAction(initial,{type:"exhaust",cardId:"p-rune-1"}),b=applyTutorialAction(initial,{type:"exhaust",cardId:"p-rune-2"});
    expect(a.feedback).toBeNull();expect(b.feedback).toBeNull();
    expect(a.board.cards.find(c=>c.instanceId==="p-rune-1")?.ready).toBe(false);expect(a.board.cards.find(c=>c.instanceId==="p-rune-2")?.ready).toBe(true);
    expect(b.board.cards.find(c=>c.instanceId==="p-rune-1")?.ready).toBe(true);expect(b.board.cards.find(c=>c.instanceId==="p-rune-2")?.ready).toBe(false);
    expect(undoTutorialAction(b)).toEqual(initial);expect(getTutorialStep(b)?.expectedAction).toEqual({type:"exhaust",cardId:"p-rune-1"});expect(getTutorialStep(b)?.focusIds).toEqual(["p-rune-1"]);
    const twice=applyTutorialAction(b,{type:"exhaust",cardId:"p-rune-2"});expect(twice.feedback).toBeTruthy();expect(twice.board).toBe(b.board);
    const aPaid=advance(applyTutorialAction(a,{type:"exhaust",cardId:"p-rune-2"}));
    const bPaid=advance(applyTutorialAction(b,{type:"exhaust",cardId:"p-rune-1"}));
    expect({...bPaid.board,log:[]}).toEqual({...aPaid.board,log:[]});expect(bPaid.board.players.player.energy).toBe(0);expect(bPaid.board.cards.find(c=>c.instanceId==="p-sentry")).toMatchObject({zone:"base",ready:false});
    let replay=createLessonState("practice-first-point");for(const action of bPaid.actions)replay=applyTutorialAction(replay,action);expect(replay).toEqual(bPaid);
  });
  it.each(["p-sentry","p-sentry-2"].flatMap(cardId=>["battlefield-left","battlefield-right"].map(destination=>({cardId,destination}))))("accepts either Sentry and field first in the final-point mission: $cardId / $destination",({cardId,destination})=>{
    const start=advance(createLessonState("practice-final-point"));
    const moved=applyTutorialAction(start,{type:"move",cardId,destination:destination as "battlefield-left"|"battlefield-right"});expect(moved.feedback).toBeNull();expect(moved.board.cards.find(c=>c.instanceId===cardId)?.zone).toBe(destination);expect(undoTutorialAction(moved)).toEqual(start);
    const first=advance(until(moved,"not-yet"));expect(first.board.players.player.score).toBe(7);expect(first.board.battlefields.find(f=>f.id===destination)?.scoredBy).toContain("player");
    const next=getTutorialStep(first)!;expect(next.expectedAction).toEqual({type:"move",cardId:cardId==="p-sentry"?"p-sentry-2":"p-sentry",destination:destination==="battlefield-left"?"battlefield-right":"battlefield-left"});
    const wrong=applyTutorialAction(first,{type:"move",cardId:cardId==="p-sentry"?"p-sentry-2":"p-sentry",destination:destination as "battlefield-left"|"battlefield-right"});expect(wrong.feedback).toBeTruthy();expect(wrong.board).toBe(first.board);
    let won=first;while(!won.completed)won=advance(won);expect(won.board.players.player.score).toBe(8);expect(won.board.phase).toBe("Victory");
    let replay=createLessonState("practice-final-point");for(const action of won.actions)replay=applyTutorialAction(replay,action);expect(replay).toEqual(won);
  });
  it("allows the first-point practice to conquer either empty field",()=>{
    const before=atStep("practice-first-point","move-sentry");const moved=applyTutorialAction(before,{type:"move",cardId:"p-sentry",destination:"battlefield-right"});expect(moved.feedback).toBeNull();
    let result=moved;while(!result.completed)result=advance(result);expect(result.board.players.player.score).toBe(1);expect(result.board.battlefields[1].controller).toBe("player");
  });
  it("keeps practice feedback goal-based without leaking the next exact action",()=>{
    const state=atStep("practice-first-point","energy-1");const wrong=applyTutorialAction(state,{type:"score"});
    expect(wrong.feedback).toContain("Help");expect(wrong.feedback).not.toContain(getTutorialStep(state)!.instruction);expect(wrong.board).toBe(state.board);
  });
  it("gives every current official keyword an authored scenario and keeps the first victory before the keyword library", () => {
    expect(OFFICIAL_KEYWORDS).toHaveLength(28);
    expect(new Set(NEW_PLAYER_KEYWORD_SCENARIOS.map((s) => s.keyword))).toEqual(new Set(OFFICIAL_KEYWORDS));
    const grouped = NEW_PLAYER_KEYWORD_GROUPS.flatMap((g) => g.scenarioIds);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set(NEW_PLAYER_KEYWORD_SCENARIOS.map((s) => s.id)));
    const steps = LESSONS.flatMap((l) => l.steps).filter((s) => s.presentation === "keyword-intro" || s.presentation === "lesson-intro" && s.keywordScenarioId && s.id.endsWith("-intro"));
    expect(new Set(steps.map((s) => s.keywordScenarioId))).toEqual(new Set(grouped));
    for (const keyword of OFFICIAL_KEYWORDS) expect(NEW_PLAYER_GLOSSARY.filter((entry) => entry.term === keyword)).toHaveLength(1);
    expect(LESSONS.filter(l=>l.path==="first-game").at(-2)?.id).toBe("win-the-game");expect(LESSONS.filter(l=>l.path==="first-game").at(-1)?.id).toBe("practice-final-point");expect(LESSONS.findIndex(l=>l.id==="win-the-game")).toBeLessThan(LESSONS.findIndex(l=>l.path==="keywords"));
  });

  it("uses real registry cards and meaningful before/after states in every keyword practice", () => {
    const registry = JSON.parse(readFileSync(new URL("../resources/riftbound_card_registry.json", import.meta.url), "utf8"));
    const cards = new Map<string, { name: string; imageUrl: string }>(registry.cards.map((c: { printId: string }) => [c.printId, c]));
    for (const scenario of NEW_PLAYER_KEYWORD_SCENARIOS) {
      expect(scenario.after, scenario.keyword).not.toEqual(scenario.before);
      expect(scenario.rulesReference).toBeTruthy();
      for (const snapshot of [scenario.before, scenario.after]) {
        expect(new Set(snapshot.cards.map((c) => c.instanceId)).size, scenario.keyword).toBe(snapshot.cards.length);
        for (const card of snapshot.cards) {
          expect(cards.get(card.cardId)?.name, scenario.keyword).toBe(card.name);
          expect(cards.get(card.cardId)?.imageUrl, scenario.keyword).toBe(card.imageUrl);
        }
        for (const value of [...Object.values(snapshot.player), ...Object.values(snapshot.opponent ?? {})]) expect(Number.isFinite(value) && value >= 0, scenario.keyword).toBe(true);
      }
    }
  });

  it("introduces each keyword without mutating its board and changes scenes only after the outcome", () => {
    for(const group of NEW_PLAYER_KEYWORD_GROUPS) {
      const groupStart=createLessonState(group.id), first=group.scenarioIds[0];
      expect(getTutorialStep(groupStart)?.presentation).toBe("lesson-intro");
      const start=advance(groupStart);
      expect(getTutorialStep(start)?.presentation).toBe(group.id==="keyword-timing"?"lesson-intro":"keyword-intro");
      const intro=advance(start); expect(intro.board.cards).toEqual(start.board.cards);expect(intro.board.players).toEqual(start.board.players);
      expect(undoTutorialAction(intro)).toEqual(start);
      const outcome=until(intro,`${first}-outcome`);expect(outcome.board.keywordScenario?.id).toBe(first);
      const next=advance(outcome);expect(next.board.keywordScenario?.id).toBe(group.scenarioIds[1]);
      expect(getTutorialStep(next)?.presentation).toBe(group.id==="keyword-timing"?"lesson-intro":"keyword-intro");
    }
  });

  it("offers richer optional Basics rules without losing saved topic identifiers", () => {
    expect(NEW_PLAYER_BASICS.map((t) => t.id)).toEqual(["what-is-riftbound", "legend-and-champion", "domains", "board-layout", "card-anatomy", "timing", "turns-and-scoring", "build-a-deck", "first-real-game", "ready-to-play"]);
    for (const topic of NEW_PLAYER_BASICS) { expect(topic.examples?.length).toBeGreaterThanOrEqual(2); expect(topic.rules!.length).toBeGreaterThanOrEqual(3); }
    expect(NEW_PLAYER_BASICS.at(-1)?.title).toBe("Ready for your guided game");
  });
  it.each(LESSONS.map((lesson) => [lesson.id]))("completes every authored action in %s without negative resources", (id) => {
    let state = createLessonState(id);
    while (!state.completed) {
      const before = structuredClone(state);
      state = advance(state);
      expect(before.stepIndex).toBe(state.stepIndex - 1);
      for (const side of Object.values(state.board.players)) {
        expect(side.energy).toBeGreaterThanOrEqual(0);
        expect(side.runeDeckCount).toBeGreaterThanOrEqual(0);
        expect(side.deckCount).toBeGreaterThanOrEqual(0);
        for (const amount of Object.values(side.power)) expect(amount).toBeGreaterThanOrEqual(0);
      }
    }
    expect(state.actions).toHaveLength(LESSONS.find((l) => l.id === id)!.steps.length);
  });

  it("binds every displayed card to a real registry identity and printed cost", () => {
    const registry = JSON.parse(readFileSync(new URL("../resources/riftbound_card_registry.json", import.meta.url), "utf8"));
    const cards = new Map<string, { name: string; costEnergy: number | null; costPower: number | null }>(registry.cards.map((c: { printId: string }) => [c.printId, c]));
    for (const lesson of LESSONS) {
      let state = createLessonState(lesson.id);
      do {
        for (const card of state.board.cards) {
          const registered = cards.get(card.cardId);
          expect(registered?.name).toBe(card.name);
          expect(card.energyCost).toBe(registered?.costEnergy ?? 0);
          expect(card.powerCost).toBe(registered?.costPower ?? 0);
          if (card.owner === "opponent" && card.zone === "hand") expect(card.faceDown).toBe(true);
        }
        if (state.completed) break;
        state = advance(state);
      } while (true);
    }
  });

  it("rejects a wrong move without changing the board, checkpoint or input state", () => {
    const state = createLessonState("play-first-unit");
    const before = structuredClone(state);
    const bad = applyTutorialAction(state, { type: "play", cardId: "p-sentry", destination: "base" });
    expect(bad.feedback).toBeTruthy(); expect(bad.board).toBe(state.board);
    expect(bad.actions).toEqual([]); expect(state).toEqual(before);
  });

  it("requires actual resources even when the requested action is the authored next action", () => {
    const state = atStep("play-first-unit", "play-sentry");
    state.board.players.player.energy = 1;
    const next = applyTutorialAction(state, getTutorialStep(state)!.expectedAction);
    expect(next.feedback).toContain("enough energy"); expect(next.board).toBe(state.board);
  });

  it("rejects a normal unit play inside a showdown even with enough resources", () => {
    const state = atStep("play-first-unit", "play-sentry");
    state.board.phase = "Showdown";
    const next = applyTutorialAction(state, getTutorialStep(state)!.expectedAction);
    expect(next.feedback).toContain("cannot be played during a showdown");
    expect(next.board).toBe(state.board);
  });

  it("distinguishes the first-player draw from the second-player extra rune", () => {
    const first = finish("first-or-second"); const second = finish("play-first-unit");
    expect(first.board.cards.filter((c) => c.owner === "player" && c.zone === "runes")).toHaveLength(2);
    expect(second.board.cards.filter((c) => c.owner === "opponent" && c.zone === "runes")).toHaveLength(3);
    expect(first.board.players.player.deckCount).toBe(34); expect(second.board.players.opponent.deckCount).toBe(34);
    const state = advance(createLessonState("first-or-second"), 3);
    expect(applyTutorialAction(state, { type: "channel", ready: false }).stepIndex).toBe(state.stepIndex);
  });

  it("shows ABCD after the kept hand without performing turn actions behind the splash", () => {
    const state = createLessonState("first-or-second");
    expect(getTutorialStep(state)).toMatchObject({ presentation: "turn-start", expectedAction: { type: "continue" } });
    expect(state.board.cards).toEqual(finish("opening-hand").board.cards);
    expect(advance(state).board).toEqual(state.board);
    expect(getTutorialStep(advance(state))?.expectedAction).toEqual({ type: "ready" });
  });

  it("plays an exhausted reinforcement onto a controlled field without scoring or starting combat", () => {
    const state = atStep("holding", "reinforce-field");
    expect(getTutorialStep(state)?.expectedAction).toEqual({ type: "play", cardId: "p-sentry-2", destination: "battlefield-left" });
    const next = advance(state);
    expect(next.board.cards.find((c) => c.instanceId === "p-sentry-2")).toMatchObject({ zone: "battlefield-left", ready: false });
    expect(next.board.players.player.score).toBe(state.board.players.player.score);
    expect(next.board.players.player.energy).toBe(0); expect(next.board.combat).toBeNull(); expect(next.board.phase).toBe("Main");
    expect(next.board.cards.find((c) => c.instanceId === "p-rune-1")?.ready).toBe(true);
    for (const restriction of ["uncontrolled", "Rockfall", "showdown"]) {
      const altered = structuredClone(state);
      if (restriction === "uncontrolled") altered.board.battlefields[0].controller = null;
      if (restriction === "Rockfall") altered.board.battlefields[0].cardId = "SFD-216";
      if (restriction === "showdown") altered.board.phase = "Showdown";
      const rejected = applyTutorialAction(altered, getTutorialStep(altered)!.expectedAction);
      expect(rejected.feedback, restriction).toBeTruthy(); expect(rejected.board).toBe(altered.board);
    }
  });

  it("sets up physical best-of-three pieces in official order before drawing or mulligans", () => {
    let state = createLessonState("table-setup");
    expect(state.board.players.player.deckCount).toBe(40);
    expect(state.board.cards.filter((c) => c.zone === "hand")).toHaveLength(0);
    const early = applyTutorialAction(state, { type: "setup", item: "turn-order", choice: "first" });
    expect(early.board).toBe(state.board); expect(early.feedback).toBeTruthy();
    state = afterStep("table-setup", "place-legend");
    expect(state.board.cards.find((c) => c.instanceId === "p-legend")?.zone).toBe("legend");
    state = advance(state);
    expect(state.board.players.player.deckCount).toBe(39);
    expect(state.board.cards.find((c) => c.instanceId === "p-champion")?.zone).toBe("champion");
    expect(state.board.setup?.battlefieldOptions).toHaveLength(3);
    expect(new Set(state.board.setup?.battlefieldOptions.map((f) => f.cardId)).size).toBe(3);
    const wrongField = applyTutorialAction(state, { type: "setup", item: "battlefields", cardId: "SFD-218", destination: "battlefield-left" });
    expect(wrongField.board).toBe(state.board);
    state = until(state, "choose-first");
    expect(state.board.setup?.completedItems).toEqual(["legend", "champion", "battlefields", "main-deck", "rune-deck"]);
    expect(state.board.cards.filter((c) => c.zone === "hand")).toHaveLength(0);
    state = advance(state);
    expect(state.board.firstPlayer).toBe("player");
    expect(state.board.cards.filter((c) => c.zone === "hand")).toHaveLength(0);
    state = advance(state);
    expect(state.board.players.player.deckCount).toBe(35);
    expect(state.board.cards.filter((c) => c.owner === "player" && c.zone === "hand")).toHaveLength(4);
    expect(state.board.setup?.stage).toBe("complete");
    expect(state.board.setup?.completedItems).toEqual(["legend", "champion", "battlefields", "main-deck", "rune-deck", "turn-order", "opening-hand"]);
    expect(state.board.battlefields.map((f) => f.cardId)).toEqual(["OGN-282", "SFD-216"]);
  });

  it("uses a different matching opposing legend and champion without applying Ahri's enemy debuff", () => {
    const state = afterStep("start-combat", "attack");
    expect(state.board.cards.find((c) => c.instanceId === "o-legend")?.cardId).toBe("RAD-145");
    expect(state.board.cards.find((c) => c.instanceId === "o-champion")?.cardId).toBe("RAD-068");
    expect(state.board.cards.find((c) => c.instanceId === "p-champion")?.might).toBe(3);
    expect(state.board.cards.find((c) => c.instanceId === "o-sentry")?.might).toBe(1);
  });

  it("validates every physical setup destination and makes Back restore the unplaced piece", () => {
    for (const stepId of ["place-legend", "place-champion", "choose-battlefield", "place-main-deck", "place-rune-deck"]) {
      const state = atStep("table-setup", stepId);
      const action = getTutorialStep(state)!.expectedAction;
      expect(action.type).toBe("setup");
      if (action.type !== "setup") throw new Error("Expected setup placement");
      for (const destination of ["base", "hand", "trash", "legend", "champion", "deck", "rune-deck", "battlefield-left", "battlefield-right"] as const) {
        if (destination === action.destination) continue;
        const rejected = applyTutorialAction(state, { ...action, destination });
        expect(rejected.feedback, `${stepId} → ${destination}`).toBeTruthy();
        expect(rejected.board).toBe(state.board);
        expect(rejected.actions).toEqual(state.actions);
      }
      expect(undoTutorialAction(advance(state))).toEqual(state);
    }
  });

  it("explores empty spaces without drawing, scoring or placing a game piece", () => {
    for (const id of ["player:base", "player:hand", "player:trash"]) {
      const state = atStep("table-setup", `inspect-${id}`);
      const result = advance(state);
      expect(result.board.cards).toEqual(state.board.cards);
      expect(result.board.players).toEqual(state.board.players);
      expect(result.board.setup).toEqual(state.board.setup);
      expect(result.board.battlefields).toEqual(state.board.battlefields);
    }
  });

  it("mulligans an unaffordable extra champion while retaining a first-turn unit and the chosen copy", () => {
    const before = atStep("opening-hand", "mulligan-one");
    const expensive = before.board.cards.find(c => c.instanceId === "p-opening-ahri")!;
    const early = before.board.cards.find(c => c.instanceId === "p-sentry")!;
    expect(expensive).toMatchObject({ zone: "hand", energyCost: 3, powerCost: 1, domain: "Mind" });
    expect(early).toMatchObject({ zone: "hand", energyCost: 2, powerCost: 0 });
    const after = advance(before);
    expect(after.board.cards.filter(c => c.owner === "player" && c.zone === "hand")).toHaveLength(4);
    expect(after.board.cards.filter(c => c.zone === "trash")).toHaveLength(0);
    expect(after.board.players).toEqual(before.board.players);
    expect(after.board.cards.find(c => c.instanceId === "p-replacement")?.cardId).toBe("OGN-096");
    expect(after.board.cards.find(c => c.instanceId === "p-champion")?.zone).toBe("champion");
  });

  it("recycling alone makes matching power without silently tapping for energy", () => {
    const state = atStep("power-and-champion", "recycle-mind");
    const ready = structuredClone(state);
    ready.board.cards.find(c => c.instanceId === "p-rune-3")!.ready = true;
    const after = advance(ready);
    expect(after.board.players.player.energy).toBe(ready.board.players.player.energy);
    expect(after.board.players.player.power.Mind).toBe(1);
    expect(after.board.players.player.power.Calm ?? 0).toBe(0);
    expect(after.board.cards.find(c => c.instanceId === "p-rune-3")?.zone).toBe("rune-deck");
    const nextAwaken = afterStep("holding", "ready-held");
    expect(nextAwaken.board.cards.find(c => c.instanceId === "p-rune-3")?.zone).toBe("rune-deck");
    expect(nextAwaken.board.cards.filter(c => c.zone === "runes" && c.owner === "player")).toHaveLength(3);
  });

  it("keeps every matchup distinct and every shown card inside its legend's domains", () => {
    const identities: Record<string, string[]> = { "OGN-255": ["Calm", "Mind"], "RAD-145": ["Calm", "Mind"], "OGN-269": ["Body", "Order"], "OGN-261": ["Calm", "Order"] };
    for (const lesson of LESSONS) {
      const state = createLessonState(lesson.id);
      const legends = state.board.cards.filter((c) => c.type === "legend");
      expect(new Set(legends.map((c) => c.cardId)).size).toBe(2);
      for (const side of ["player", "opponent"] as const) {
        const legend = legends.find((c) => c.owner === side)!;
        for (const card of state.board.cards.filter((c) => c.owner === side)) for (const domain of card.domains ?? [card.domain]) expect(legend.domains ?? identities[legend.cardId]).toContain(domain);
      }
    }
    const drill = createLessonState("keywords-in-combat");
    expect(drill.board.cards.find((c) => c.instanceId === "o-champion")).toMatchObject({ cardId: "OGN-238", zone: "champion" });
    expect(drill.board.cards.filter((c) => c.owner === "opponent" && c.type === "rune").map((c) => c.domain)).toEqual(["Order", "Calm", "Order", "Calm"]);
  });

  it("recycles an already-exhausted rune without losing its energy and pays both costs", () => {
    const state = atStep("power-and-champion", "recycle-mind");
    expect(state.board.players.player.energy).toBe(3);
    expect(state.board.cards.find((c) => c.instanceId === "p-rune-3")?.ready).toBe(false);
    const recycled = advance(state);
    expect(recycled.board.players.player.energy).toBe(3);
    expect(recycled.board.players.player.power.Mind).toBe(1);
    expect(recycled.board.players.player.runeDeckCount).toBe(state.board.players.player.runeDeckCount + 1);
    const played = advance(until(recycled, "play-champion"));
    expect(played.board.players.player.energy).toBe(0); expect(played.board.players.player.power.Mind).toBe(0);
    expect(played.board.cards.find((c) => c.instanceId === "p-champion")).toMatchObject({ zone: "base", ready: false });
  });

  it("mulligans after setting aside, retains counts and never redraws the set-aside copy", () => {
    const state = finish("opening-hand");
    expect(state.board.players.player.deckCount).toBe(35);
    expect(state.board.cards.filter((c) => c.owner === "player" && c.zone === "hand")).toHaveLength(4);
    expect(state.board.cards.find((c) => c.instanceId === "p-opening-ahri")).toMatchObject({ zone: "deck", cardId: "OGN-119" });
    expect(state.board.cards.find((c) => c.instanceId === "p-champion")).toMatchObject({ zone: "champion", cardId: "OGN-119" });
    expect(state.board.cards.find((c) => c.instanceId === "p-replacement")?.cardId).toBe("OGN-096");
  });

  it("resolves the newest chain item first with each spell's draw effect", () => {
    let state = afterStep("the-chain", "react");
    expect(state.board.chain.map((v) => v.id)).toEqual(["o-discipline", "p-discipline-2"]);
    const premature = applyTutorialAction(state, { type: "resolve" });
    expect(premature.board).toBe(state.board);
    state = advance(until(state,"resolve-own"));
    expect(state.board.chain.map((v) => v.id)).toEqual(["o-discipline"]);
    expect(state.board.cards.find((v) => v.instanceId === "p-champion")?.might).toBe(5);
    expect(state.board.cards.find((v) => v.instanceId === "o-sentry")?.might).toBe(1);
    expect(state.board.players.player.deckCount).toBe(31);
    state = advance(until(state,"resolve-enemy"));
    expect(state.board.chain).toEqual([]);
    expect(state.board.cards.find((v) => v.instanceId === "o-sentry")?.might).toBe(3);
    expect(state.board.players.opponent.deckCount).toBe(32);
  });

  it("deals combat damage simultaneously and applies Deathknell", () => {
    const state = finish("combat-damage");
    expect(state.board.cards.find((c) => c.instanceId === "p-champion")).toMatchObject({ zone: "battlefield-right", damage: 0 });
    expect(state.board.cards.find((c) => c.instanceId === "o-sentry")?.zone).toBe("trash");
    expect(state.board.players.opponent.deckCount).toBe(31);
    expect(state.board.battlefields[1].controller).toBe("player");
    expect(state.board.players.player.score).toBe(3);
  });

  it("never awards a conquest when simultaneous damage kills every unit", () => {
    let state=atStep("combat-damage","assign");
    state.board.cards.find(c=>c.instanceId==="o-sentry")!.might=5;
    state=advance(state); state=advance(state);
    state=until(state,"combat-point");
    const result=applyTutorialAction(state,getTutorialStep(state)!.expectedAction);
    expect(result.feedback).toContain("uncontested control");expect(result.board.players.player.score).toBe(2);
    expect(result.board.cards.filter(c=>c.zone==="battlefield-right")).toHaveLength(0);
  });

  it("accepts different lethal damage distributions and rejects nonlethal/foreign allocations", () => {
    const state = atStep("keywords-in-combat", "keyword-damage");
    expect(validateTutorialDamageAssignment(state.board, { "o-sentry": 6, "o-sentry-2": 2 })).toBeNull();
    for (const assignments of [{ "o-sentry": 4, "o-sentry-2": 4 }, { "o-sentry": 1, "o-sentry-2": 7 }, { "o-sentry": 4, "p-champion": 4 }, { "o-sentry": 4, "o-sentry-2": -4 }]) {
      expect(validateTutorialDamageAssignment(state.board, assignments)).toBeTruthy();
    }
    const result = finish("keywords-in-combat");
    expect(result.board.cards.find((c) => c.instanceId === "p-poro")).toMatchObject({ might: 2, zone: "battlefield-left" });
    expect(result.board.cards.find((c) => c.instanceId === "p-champion")?.zone).toBe("battlefield-left");
    expect(result.board.log.some((s) => s.includes("Tank first"))).toBe(true);
  });

  it("demonstrates legal damage without accepting a manual allocation or dealing it early", () => {
    for (const id of ["combat-damage", "keywords-in-combat"]) {
      const state = atStep(id, id === "combat-damage" ? "assign" : "keyword-damage");
      const step = getTutorialStep(state)!;
      expect(step.expectedAction.type).toBe("guide");expect(step.actor).toBe("rules");
      const assignments = Object.fromEntries(step.combatDemonstration!.targetAssignments.map((entry) => [entry.cardId, entry.amount]));
      expect(validateTutorialDamageAssignment(state.board, assignments)).toBeNull();
      const rejected = applyTutorialAction(state, { type: "assign-damage", assignments });
      expect(rejected.board).toBe(state.board); expect(rejected.feedback).toBeTruthy();
      const shown = advance(state);
      expect(shown.board.combat?.assignments).toEqual(assignments);
      expect(shown.board.cards).toEqual(state.board.cards);
      const totalIncoming = state.board.cards.filter((c) => c.owner === "opponent" && c.zone === state.board.combat?.battlefieldId).reduce((sum, c) => sum + c.might, 0);
      expect(step.combatDemonstration!.returnAssignments!.reduce((sum, entry) => sum + entry.amount, 0)).toBe(totalIncoming);
    }
  });

  it("requires a later turn and exact battlefield for a hidden response", () => {
    const beforePlay = atStep("hidden-cards", "hidden-play");
    expect(beforePlay.board.cards.filter((c) => c.owner === "opponent" && c.zone === "runes")).toHaveLength(6);
    expect(beforePlay.board.players.opponent.deckCount).toBe(33);
    const hidden = beforePlay.board.cards.find((c) => c.instanceId === "p-hidden")!;
    expect(hidden).toMatchObject({ zone: "hidden", faceDown: true, hiddenAt: "battlefield-left" });
    const sameTurn = structuredClone(beforePlay); sameTurn.board.turn = hidden.hiddenOnTurn!;
    expect(applyTutorialAction(sameTurn, getTutorialStep(sameTurn)!.expectedAction).feedback).toContain("subsequent turn");
    const lostControl = structuredClone(beforePlay); lostControl.board.battlefields[0].controller = "opponent";
    expect(applyTutorialAction(lostControl, getTutorialStep(lostControl)!.expectedAction).feedback).toContain("still control");
    const wrongField = structuredClone(beforePlay); wrongField.board.cards.find((c) => c.instanceId === "o-sentry")!.zone = "battlefield-right";
    expect(applyTutorialAction(wrongField, getTutorialStep(wrongField)!.expectedAction).feedback).toContain("own battlefield");
    const final = atStep("hidden-cards", "hidden-other-reset");
    expect(final.board.cards.find((c) => c.instanceId === "p-hidden")).toMatchObject({ zone: "trash", faceDown: false });
    expect(final.board.players.opponent.deckCount).toBe(30);
  });

  it("infers a native hidden-card click from its own space while refusing an invented destination", () => {
    const state = atStep("hidden-cards", "hidden-play");
    const result = applyTutorialAction(state, { type: "play", cardId: "p-hidden", targetId: "o-sentry" });
    expect(result.feedback).toBeNull();
    expect(result.actions.at(-1)).toEqual({ type: "play", cardId: "p-hidden", targetId: "o-sentry", destination: "battlefield-left" });
    const wrong = applyTutorialAction(state, { type: "play", cardId: "p-hidden", targetId: "o-sentry", destination: "battlefield-right" });
    expect(wrong.board).toBe(state.board); expect(wrong.feedback).toBeTruthy();
  });

  it("wins by a second conquest, then loads an explicit separate position to win by holding", () => {
    const afterConquest = afterStep("win-the-game", "not-yet");
    expect(afterConquest.board.players.player.score).toBe(7);
    expect(afterConquest.board.players.player.deckCount).toBe(30);
    const conquestWin = advance(until(afterConquest,"conquest-victory"));
    expect(conquestWin.board.players.player.score).toBe(8); expect(conquestWin.board.phase).toBe("Victory");
    expect(conquestWin.board.battlefields.every((f) => f.scoredBy.includes("player"))).toBe(true);
    expect(getTutorialStep(conquestWin)?.expectedAction.type).toBe("alternate-win-route");
    const alternate = advance(conquestWin);
    expect(alternate.board.players.player.score).toBe(7); expect(alternate.board.phase).toBe("Awaken");
    expect(alternate.board.battlefields.every((f) => f.scoredBy.length === 0)).toBe(true);
    expect(alternate.board.log.at(-1)).toContain("Separate holding example");
    expect(undoTutorialAction(alternate)).toEqual(conquestWin);
    const final = finish("win-the-game");
    expect(final.board.players.player.score).toBe(8); expect(final.board.phase).toBe("Victory");
    expect(final.board.battlefields[1].scoredBy).toEqual([]);
  });

  it("allows the final conquest after every battlefield was scored, and blocks double scoring", () => {
    const state = atStep("win-the-game", "not-yet");
    state.board.battlefields[1].scoredBy = ["player"];
    const won = advance(state); expect(won.board.players.player.score).toBe(8);
    const duplicate = atStep("first-conquest","first-point"); duplicate.board.battlefields[0].scoredBy = ["player"];
    expect(applyTutorialAction(duplicate, getTutorialStep(duplicate)!.expectedAction).feedback).toContain("already been scored");
  });

  it("undo restores a complete deterministic checkpoint including resources", () => {
    const before = atStep("power-and-champion", "recycle-mind");
    const after = advance(before); const undone = undoTutorialAction(after);
    expect(undone).toEqual(before);
  });

  it("preserves main-course board state across chapter boundaries", () => {

    const opening = createLessonState("opening-hand");

    expect(opening.board.players.player.score).toBe(0);
    expect(opening.board.cards.filter(c=>c.type==="rune"&&c.zone==="runes")).toHaveLength(0);
    expect(opening.board.cards.filter(c=>c.type==="unit"&&["base","battlefield-left","battlefield-right"].includes(c.zone))).toHaveLength(0);
    for (const [from, to] of [["table-setup", "opening-hand"], ["first-or-second", "read-a-card"], ["read-a-card", "play-first-unit"], ["power-and-champion", "move-to-battlefield"], ["move-to-battlefield", "first-conquest"], ["first-conquest", "holding"], ["holding", "start-combat"], ["the-chain", "combat-damage"]]) {
      expect(createLessonState(to).board, `${from} → ${to}`).toEqual(finish(from).board);
    }
    const mulligan = finish("opening-hand"); const turn = createLessonState("first-or-second");
    expect(turn.board.cards).toEqual(mulligan.board.cards);
    expect(turn.board.players).toEqual(mulligan.board.players);
  });

  it("conserves 40 main-deck cards and 12 runes without exceeding known copy limits", () => {
    for (const lesson of LESSONS) {
      let state = createLessonState(lesson.id);
      do {
        for (const side of ["player", "opponent"] as const) {
          const main = state.board.cards.filter((c) => c.owner === side && c.type !== "rune" && c.type !== "legend" && !c.token);
          const knownHand = main.filter((c) => c.zone === "hand").length;
          const otherHandCards = Math.max(0, (state.board.players[side].handCount ?? knownHand) - knownHand);
          expect(state.board.players[side].deckCount + main.filter((c) => c.zone !== "deck").length + otherHandCards, `${lesson.id}: ${side} main count`).toBe(state.board.practice?.mode === "deck-check" && state.board.practice.stage === "before" && side === "player" ? 41 : 40);
          expect(state.board.players[side].runeDeckCount + state.board.cards.filter((c) => c.owner === side && c.type === "rune" && c.zone === "runes").length).toBe(12);
          const knownCopies = new Map<string, number>();
          for (const c of main) knownCopies.set(c.cardId, (knownCopies.get(c.cardId) ?? 0) + 1);
          for (const [code, copies] of knownCopies) expect(copies, `${lesson.id}: ${side} ${code}`).toBeLessThanOrEqual(3);
        }
        if (state.completed) break;
        state = advance(state);
      } while (true);
    }
  });
  it.each(NEW_PLAYER_KEYWORD_SCENARIOS.map(s => [s.id]))("performs a complete native sequence in %s with exact rewind", (id) => {
    const scenario=NEW_PLAYER_KEYWORD_SCENARIOS.find(s=>s.id===id)!;
    let state=atStep(scenario.groupId,`${id}-intro`);let nativeInputs=0;
    while(getTutorialStep(state)?.id!==`${id}-outcome`) {
      const current=getTutorialStep(state)!;
      const wrong=applyTutorialAction(state,{type:"demonstrate-keyword",scenarioId:id});
      expect(wrong.board).toBe(state.board);expect(wrong.feedback).toBeTruthy();
      const next=advance(state);expect(undoTutorialAction(next)).toEqual(state);
      if(current.actor!=="guide"&&!["continue","inspect"].includes(current.expectedAction.type))nativeInputs++;
      state=next;
    }
    expect(nativeInputs,scenario.keyword).toBeGreaterThan(0);
    expect(state.actions.some(a=>a.type==="demonstrate-keyword")).toBe(false);
    const tampered=atStep(scenario.groupId,`${id}-intro`);tampered.board.players.player.energy++;
    expect(applyTutorialAction(tampered,getTutorialStep(tampered)!.expectedAction).feedback).toContain("position has changed");
  });

  it("hydrates legal domains, supporting attackers, matching champions and real chain objects in every keyword scene", () => {
    const registry = JSON.parse(readFileSync(new URL("../resources/riftbound_card_registry.json", import.meta.url), "utf8"));
    const registered = new Map<string, {champion:string|null}>(registry.cards.map((c:{printId:string})=>[c.printId,c]));
    for (const pair of KEYWORD_LEGEND_PAIRS) expect(registered.get(pair.champion.cardId)?.champion).toBe(registered.get(pair.legend.cardId)?.champion);
    for (const scene of NEW_PLAYER_KEYWORD_SCENARIOS) for (const stage of ["before","after"] as const) {
      const b = createKeywordTutorialBoard(scene.id,stage);
      expect(new Set(b.cards.filter(c=>c.type==="legend").map(c=>c.cardId)).size).toBe(2);
      for (const side of ["player","opponent"] as const) {
        const legend = b.cards.find(c=>c.type==="legend"&&c.owner===side)!;
        expect(b.cards.find(c=>c.owner===side&&c.champion)?.zone).toBe("champion");
        for (const c of b.cards.filter(c=>c.owner===side)) for (const domain of c.domains??[]) expect(legend.domains).toContain(domain);
      }
      if (b.combat) for (const side of ["player","opponent"] as const) expect(b.cards.some(c=>c.owner===side&&c.type==="unit"&&c.zone===b.combat!.battlefieldId),scene.id).toBe(true);
      for (const item of b.chain) {
        expect(b.cards.some(c=>c.instanceId===item.id&&c.cardId===item.cardId),scene.id).toBe(true);
        if (item.targetId) expect(b.cards.some(c=>c.instanceId===item.targetId),scene.id).toBe(true);
      }
    }
  });

  it("uses board counters and locations for equipment, XP, hidden cards and temporary cleanup", () => {
    const equip = createKeywordTutorialBoard("keyword-equip","after");
    expect(equip.cards.find(c=>c.cardId==="SFD-022")).toMatchObject({zone:"base",attachedTo:"player-OGN-010"});
    expect(equip.cards.find(c=>c.cardId==="OGN-010")).toMatchObject({might:4,ready:true});
    expect(equip.players.player.power).toEqual({});
    const hidden = afterStep("keyword-surprises","keyword-hidden-hide").board;
    expect(hidden.cards.find(c=>c.cardId==="OGN-213")).toMatchObject({zone:"hidden",faceDown:true,hiddenAt:"battlefield-left",hiddenOnTurn:5});
    expect(hidden.battlefields[0].controller).toBe("player");
    const hunt = createKeywordTutorialBoard("keyword-hunt","after");
    expect(hunt.players.player).toMatchObject({score:3,xp:3});
    expect(hunt.battlefields[0]).toMatchObject({controller:"player",scoredBy:["player"]});
    const temp = createKeywordTutorialBoard("keyword-temporary","after");
    expect(temp.cards.some(c=>c.cardId==="UNL-T07")).toBe(false); expect(temp.players.player.score).toBe(6); expect(temp.battlefields[0].controller).toBeNull();
    const ganking = createKeywordTutorialBoard("keyword-ganking","after");
    expect(ganking.battlefields.map(f=>f.controller)).toEqual([null,"opponent"]);
    const shield = createKeywordTutorialBoard("keyword-shield","after");
    expect(shield.turnPlayer).toBe("opponent"); expect(shield.cards.filter(c=>c.owner==="opponent"&&c.zone==="runes")).toHaveLength(6);
    expect(shield.players.opponent.handCount).toBe(1);
  });

  it("places assignment counters without dealing keyword demonstration damage early", () => {
    const tank = createKeywordTutorialBoard("keyword-tank","after"), backline = createKeywordTutorialBoard("keyword-backline","after");
    expect(tank.combat?.assignments).toEqual({"opponent-OGN-054":4});
    expect(backline.combat?.assignments).toEqual({"opponent-OGN-096":1,"opponent-UNL-043":3});
    for (const b of [tank,backline]) expect(b.cards.every(c=>c.damage===0)).toBe(true);
    const deflect = createKeywordTutorialBoard("keyword-deflect","after");
    expect(deflect.players.player.energy).toBe(0); expect(deflect.players.player.power).toEqual({});
    expect(deflect.chain).toHaveLength(1); expect(deflect.cards.find(c=>c.cardId==="OGN-013")?.zone).toBe("battlefield-left");
  });

  it("keeps Unique as an Ornn deck-building edit, removes exactly one draft card and updates deck count", () => {
    const before = createKeywordTutorialBoard("keyword-unique"), after = createKeywordTutorialBoard("keyword-unique","after");
    expect(before.practice?.mode).toBe("deck-check");
    expect(before.cards.find(c=>c.instanceId==="p-legend")?.cardId).toBe("SFD-189");
    expect(before.cards.filter(c=>c.cardId==="SFD-190")).toHaveLength(2);
    expect(after.cards.filter(c=>c.cardId==="SFD-190")).toHaveLength(1);
    expect(after.cards.some(c=>c.zone==="trash")).toBe(false);
    expect(before.players.player.deckCount-after.players.player.deckCount).toBe(1);
    expect(after.players.player.deckCount).toBe(39);
    expect(before.cards.some(c=>c.zone==="runes")).toBe(false);
    before.cards[0].might=999;
    expect(createKeywordTutorialBoard("keyword-unique").cards[0].might).not.toBe(999);
  });

  it("counters a waiting spell newest-first, using the same tapped rune for energy and power without refunds", () => {
    const start = createLessonState("countering-spells");
    const afterTap = afterStep("countering-spells", "counter-energy");
    expect(afterTap.board.cards.find(c=>c.instanceId==="p-rune-2")).toMatchObject({ready:false,zone:"runes"});
    expect(afterTap.board.players.player.energy).toBe(1);
    const afterRecycle = advance(afterTap);
    expect(afterRecycle.board.players.player).toMatchObject({energy:1,power:{Calm:1}});
    expect(afterRecycle.board.cards.find(c=>c.instanceId==="p-rune-2")?.zone).toBe("rune-deck");
    const played = advance(afterRecycle);
    expect(played.board.chain.map(c=>c.id)).toEqual(["o-rune-prison","p-defy"]);
    expect(played.board.players.player.energy).toBe(0); expect(played.board.players.player.power.Calm).toBe(0);
    expect(played.board.cards.find(c=>c.instanceId==="p-sentry")?.stunned).not.toBe(true);
    expect(applyTutorialAction(played,{type:"resolve"}).board).toBe(played.board);
    const resolved = advance(until(played,"counter-resolve"));
    expect(resolved.board.chain).toEqual([]);
    for (const id of ["p-defy","o-rune-prison"]) expect(resolved.board.cards.find(c=>c.instanceId===id)?.zone).toBe("trash");
    expect(resolved.board.cards.find(c=>c.instanceId==="p-sentry")?.stunned).not.toBe(true);
    expect(resolved.board.players.player.energy).toBe(0); expect(resolved.board.players.opponent.energy).toBe(0);
    expect(resolved.board.players.opponent.power).toEqual({});
    expect(createLessonState("combat-damage").board).toEqual(finish("the-chain").board);
  });

  it("enforces both printed Defy cost limits and requires a spell still waiting on the chain", () => {
    const legal = atStep("countering-spells", "counter-play");
    for (const field of ["energyCost","powerCost"] as const) {
      const tooExpensive=structuredClone(legal); tooExpensive.board.cards.find(c=>c.instanceId==="o-rune-prison")![field]=field==="energyCost"?5:2;
      const result=applyTutorialAction(tooExpensive,getTutorialStep(tooExpensive)!.expectedAction);
      expect(result.feedback).toContain("BOTH printed costs"); expect(result.board).toBe(tooExpensive.board);
    }
    const ability=structuredClone(legal); ability.board.cards.find(c=>c.instanceId==="o-rune-prison")!.type="unit";
    expect(applyTutorialAction(ability,getTutorialStep(ability)!.expectedAction).feedback).toContain("not a unit or an ability");
    const alreadyResolved=structuredClone(legal); alreadyResolved.board.chain=[]; alreadyResolved.board.cards.find(c=>c.instanceId==="o-rune-prison")!.zone="trash";
    expect(applyTutorialAction(alreadyResolved,getTutorialStep(alreadyResolved)!.expectedAction).feedback).toContain("waiting on the chain");
  });

  it("saves atomic guide moves and never runs an opposing turn inside End turn",()=>{
    const before=atStep("play-first-unit","end-first"),ended=advance(before);
    expect(ended.board.turnPlayer).toBe("opponent");expect(ended.board.phase).toBe("Awaken");
    expect(ended.board.cards.filter(c=>c.owner==="opponent"&&c.type==="rune")).toHaveLength(0);
    expect(ended.board.cards.find(c=>c.instanceId==="o-sentry")?.zone).toBe("hand");
    expect(getTutorialStep(ended)?.actor).toBe("guide");
    const wrong=applyTutorialAction(ended,{type:"guide",eventId:"end-first-channel"});expect(wrong.board).toBe(ended.board);
    const after=advance(ended);expect(undoTutorialAction(after)).toEqual(ended);
    const channel=afterStep("play-first-unit","end-first-channel");
    expect(channel.board.cards.filter(c=>c.owner==="opponent"&&c.zone==="runes")).toHaveLength(3);
    expect(channel.board.players.opponent.deckCount).toBe(before.board.players.opponent.deckCount);
    expect(afterStep("play-first-unit","end-first-draw").board.players.opponent.deckCount).toBe(channel.board.players.opponent.deckCount-1);
  });
  it("plays Ambush immediately as a Reaction and resolves only the older spell after two passes",()=>{
    const paid=atStep("keyword-timing","keyword-ambush-native");expect(paid.board.players.player.energy).toBe(2);
    const entered=advance(paid),inferna=entered.board.cards.find(c=>c.cardId==="UNL-002")!;
    expect(inferna).toMatchObject({zone:"battlefield-left",ready:false,might:3});
    expect(entered.board.battlefields[0].controller).toBe("opponent");
    expect(entered.board.chain.map(c=>c.id)).toEqual(["opponent-OGN-058"]);
    expect(entered.board.priority).toBe("opponent");expect(entered.board.players.player.energy).toBe(0);
    const guidePassed=advance(entered);expect(guidePassed.board.priority).toBe("player");expect(guidePassed.board.passedBy).toEqual(["opponent"]);
    const bothPassed=advance(guidePassed);expect(bothPassed.board.priority).toBeNull();expect(bothPassed.board.passedBy).toEqual(["opponent","player"]);
    const resolved=advance(bothPassed);expect(resolved.board.chain).toEqual([]);expect(resolved.board.cards.find(c=>c.instanceId==="opponent-OGN-096")?.might).toBe(3);
  });
  it("separates immediate gear entry, its trigger and the attachment location",()=>{
    const played=afterStep("keyword-equipment","keyword-quick-draw-native");
    expect(played.board.cards.find(c=>c.cardId==="SFD-022")).toMatchObject({zone:"base",ready:true});
    expect(played.board.cards.find(c=>c.cardId==="SFD-022")?.attachedTo).toBeUndefined();
    expect(played.board.chain).toEqual([]);expect(played.board.cards.find(c=>c.instanceId==="player-OGN-096")?.might).toBe(1);
    const chosen=advance(played);expect(chosen.board.chain).toEqual([]);expect(getTutorialStep(chosen)?.actor).toBe("rules");
    const trigger=advance(chosen);expect(trigger.board.chain).toHaveLength(1);expect(trigger.board.chain[0].id).toContain(":trigger");
    const attached=afterStep("keyword-equipment","keyword-quick-draw-effect-resolve");
    expect(attached.board.cards.find(c=>c.cardId==="SFD-022")).toMatchObject({zone:"battlefield-left",attachedTo:"player-OGN-096",ready:true});
    expect(attached.board.cards.find(c=>c.instanceId==="player-OGN-096")?.might).toBe(3);
  });
  it("keeps tapped energy when Equip spends only power and attaches only on resolution",()=>{
    const activated=afterStep("keyword-equipment","keyword-equip-native");
    expect(activated.board.players.player.energy).toBe(1);expect(activated.board.players.player.power.Fury).toBe(0);
    expect(activated.board.cards.find(c=>c.instanceId==="player-OGN-010")?.might).toBe(2);
    expect(activated.board.cards.find(c=>c.cardId==="SFD-022")?.attachedTo).toBeUndefined();
    expect(afterStep("keyword-equipment","keyword-equip-effect-resolve").board.cards.find(c=>c.instanceId==="player-OGN-010")?.might).toBe(4);
  });
  it("does not mutate Predict ordering on inspection and requires an explicit recycle choice",()=>{
    const before=atStep("keyword-surprises","keyword-vision-inspect-top");
    const inspected=advance(before);expect(inspected.board.cards).toEqual(before.board.cards);expect(inspected.board.players).toEqual(before.board.players);
    expect(getTutorialStep(inspected)?.expectedAction).toEqual({type:"predict",cardId:"player-OGN-096",choice:"recycle"});
    expect(applyTutorialAction(inspected,{type:"inspect",cardId:"player-OGN-096"}).board).toBe(inspected.board);
    const chosen=advance(inspected);expect(chosen.board.players).toEqual(before.board.players);expect(chosen.board.cards.find(c=>c.instanceId==="player-OGN-096")).toMatchObject({zone:"deck",faceDown:true,annotation:expect.stringContaining("recycled it to the bottom")});
  });
  it("shows Hidden's floating energy, friendly target and separate Deathknell draw",()=>{
    const hidden=afterStep("keyword-surprises","keyword-hidden-hide");expect(hidden.board.players.player.energy).toBe(1);expect(Object.values(hidden.board.players.player.power).reduce((a,b)=>a+(b??0),0)).toBe(0);
    const before=atStep("keyword-surprises","keyword-hidden-play");expect(before.board.turn).toBeGreaterThan(before.board.cards.find(c=>c.cardId==="OGN-213")!.hiddenOnTurn!);
    expect(getTutorialStep(before)?.expectedAction).toMatchObject({targetId:"player-OGN-096"});
    const after=afterStep("keyword-surprises","keyword-hidden-hidden-resolve");
    expect(after.board.cards.find(c=>c.instanceId==="player-OGN-096")?.zone).toBe("trash");
    expect(after.board.players.player.handCount).toBe(before.board.players.player.handCount!+2);
    const death=afterStep("keyword-surprises","keyword-hidden-deathknell-resolve");expect(death.board.players.player.handCount).toBe(after.board.players.player.handCount!+1);
  });
  it("reveals and trashes a still-hidden card at cleanup after losing control, with exact Back",()=>{
    const before=atStep("hidden-cards","hidden-loss-cleanup");expect(before.board.battlefields[0].controller).toBeNull();expect(before.board.cards.find(c=>c.instanceId==="p-hidden")?.zone).toBe("hidden");
    const after=advance(before);expect(after.board.cards.find(c=>c.instanceId==="p-hidden")).toMatchObject({zone:"trash",faceDown:false});expect(undoTutorialAction(after)).toEqual(before);
  });
  it("uses Deploy’s attack bonus to win an equal fight and keeps the gear with the conquered field", () => {
    const before=atStep("keyword-new-tools","keyword-deploy-finish-damage");
    expect(before.board.cards.find(c=>c.instanceId==="player-OGN-012")?.might).toBe(5);
    const result=afterStep("keyword-new-tools","keyword-deploy-finish-score");
    expect(result.board.cards.find(c=>c.instanceId==="player-RAD-002")?.zone).toBe("battlefield-left");
    expect(result.board.cards.find(c=>c.instanceId==="opponent-OGN-012")?.zone).toBe("trash");
    expect(result.board.cards.find(c=>c.instanceId==="player-OGN-012")).toMatchObject({zone:"battlefield-left",might:4,damage:0});
    expect(result.board.players.player.score).toBe(1);
  });

});


describe("keyword consequences and complete deck provenance",()=>{
  it("ties all 28 situations to a practical goal and complete matching decks",()=>{
    for(const example of NEW_PLAYER_KEYWORD_SCENARIOS){
      expect(example.objective,example.keyword).toEqual({goal:expect.any(String),without:expect.any(String),with:expect.any(String)});
      const board=createKeywordTutorialBoard(example.id);
      for(const [index,side] of (["player","opponent"] as const).entries()){
        const deck=getNewPlayerTeachingDeck(board.players[side].teachingDeckId)!;
        expect(deck,example.keyword+side).toBeTruthy();
        expect(deck.main.reduce((n,c)=>n+c.quantity,0)).toBe(40);
        expect(deck.runes.reduce((n,c)=>n+c.quantity,0)).toBe(12);
        expect(deck.battlefields).toHaveLength(3);
        expect(board.cards.find(c=>c.owner===side&&c.zone==="champion")?.cardId).toBe(deck.championId);
        expect(board.cards.find(c=>c.owner===side&&c.zone==="legend")?.cardId).toBe(deck.legendId);
        expect(deck.battlefields.some(c=>c.cardId===board.battlefields[index].cardId),example.keyword+" field").toBe(true);
      }
    }
  });
  it("keeps every known card and rune within the declared full list throughout all keyword sequences",()=>{
    for(const group of NEW_PLAYER_KEYWORD_GROUPS){let state=createLessonState(group.id);
      for(const step of LESSONS.find(l=>l.id===group.id)!.steps){
        for(const side of ["player","opponent"] as const){
          const deck=getNewPlayerTeachingDeck(state.board.players[side].teachingDeckId)!;
          const counts=new Map<string,number>();
          for(const c of state.board.cards.filter(c=>c.owner===side&&!c.token&&c.type!=="legend"))counts.set(c.cardId,(counts.get(c.cardId)??0)+1);
          for(const [id,count] of counts){
            const listed=[...deck.main,...deck.runes].find(c=>c.cardId===id)?.quantity??0;
            const draftExtra=state.board.practice?.keyword==="Unique"&&state.board.cards.some(c=>c.instanceId==="cape-second")&&id==="SFD-190"?1:0;
            expect(count,`${step.id}/${side}/${id}`).toBeLessThanOrEqual(listed+draftExtra);
          }
        }
        state=advance(state);
      }
    }
  },15000);
  it("makes equal printed-Might Assault units fight, clears damage before losing Assault, then scores",()=>{
    const before=atStep("keyword-combat","keyword-assault-native");
    expect(before.board.cards.filter(c=>c.cardId==="OGN-215").map(c=>c.might)).toEqual([5,5]);
    const attack=advance(before);expect(attack.board.cards.find(c=>c.instanceId==="player-OGN-215")).toMatchObject({might:6,mightModifiers:[{label:"Assault",amount:1}]});
    const damage=afterStep("keyword-combat","keyword-assault-finish-damage");
    expect(damage.board.cards.find(c=>c.instanceId==="player-OGN-215")).toMatchObject({might:6,damage:5,zone:"battlefield-left"});
    expect(damage.board.cards.find(c=>c.instanceId==="opponent-OGN-215")).toMatchObject({might:5,damage:6});
    const cleanup=advance(damage);expect(cleanup.board.cards.find(c=>c.instanceId==="player-OGN-215")).toMatchObject({might:6,damage:0,zone:"battlefield-left",mightModifiers:[{label:"Assault",amount:1}]});
    expect(cleanup.board.cards.find(c=>c.instanceId==="opponent-OGN-215")?.zone).toBe("trash");
    const scored=advance(cleanup);expect(scored.board.cards.find(c=>c.instanceId==="player-OGN-215")).toMatchObject({might:5,damage:0,mightModifiers:[]});expect(scored.board.players.player.score).toBe(1);expect(scored.board.battlefields[0].controller).toBe("player");
  });
  it.each([
    ["keyword-combat","keyword-shield","player-OGN-054",3,"opponent-OGN-054"],
    ["keyword-timing","keyword-reaction","player-OGN-054",5,"opponent-OGN-010"],
    ["keyword-equipment","keyword-quick-draw","player-OGN-096",3,"opponent-OGN-010"],
    ["keyword-growth","keyword-empowered","player-VEN-001",6,"opponent-SFD-002"],
    ["keyword-new-tools","keyword-repeat","player-OGN-010",2,"opponent-OGN-012"],
  ])("%s / %s finishes a fight with the intended survivor",(group,scenario,survivor,might,dead)=>{
    const state=afterStep(group as string,`${scenario}-${scenario==="keyword-empowered"||scenario==="keyword-repeat"?"finish-score":"finish-cleanup"}`);
    expect(state.board.cards.find(c=>c.instanceId===survivor)).toMatchObject({zone:"battlefield-left",might,damage:0});
    expect(state.board.cards.find(c=>c.instanceId===dead)?.zone).toBe("trash");
    expect(state.board.combat).toBeNull();
  });
  it("uses Accelerate and Level for real immediate conquests, with Level XP unspent",()=>{
    const accelerate=afterStep("keyword-timing","keyword-accelerate-finish-score");
    expect(accelerate.board.cards.find(c=>c.instanceId==="player-OGN-010")).toMatchObject({zone:"battlefield-left",ready:false});expect(accelerate.board.players.player.score).toBe(1);
    const level=afterStep("keyword-growth","keyword-level-finish-hunt-resolve");
    expect(level.board.players.player).toMatchObject({score:1,xp:5});
  });
  it("reaches Level through Hunt without replaying ready entry",()=>{
    const state=afterStep("keyword-growth","keyword-hunt-effect-resolve");
    expect(state.board.players.player).toMatchObject({score:3,xp:3});
    expect(state.board.cards.find(c=>c.instanceId==="player-UNL-016")).toMatchObject({might:4,ready:false});
  });
  it("readies and holds before reusing Vi’s ordinary ability twice with separate real trash costs",()=>{
    const start=atStep("keyword-equipment","keyword-ganking-awaken");expect(start.board.phase).toBe("Awaken");expect(start.board.players.player.score).toBe(1);expect(start.board.cards.find(c=>c.instanceId==="player-OGN-036")?.ready).toBe(false);
    const held=afterStep("keyword-equipment","keyword-ganking-hold-left");expect(held.board.players.player.score).toBe(2);expect(held.board.battlefields[0].scoredBy).toEqual(["player"]);
    const before=atStep("keyword-equipment","keyword-ganking-ability-1"),deck=before.board.players.player.deckCount;
    const paid=advance(before);expect(paid.board.cards.find(c=>c.instanceId==="vi-cost-one")).toMatchObject({zone:"deck",faceDown:true});expect(paid.board.players.player.deckCount).toBe(deck+1);expect(paid.board.cards.find(c=>c.instanceId==="player-OGN-036")).toMatchObject({ready:true,might:3});
    const first=afterStep("keyword-equipment","keyword-ganking-ability-1-resolve");expect(first.board.cards.find(c=>c.instanceId==="player-OGN-036")).toMatchObject({ready:true,might:4});
    const second=afterStep("keyword-equipment","keyword-ganking-ability-2-resolve");expect(second.board.cards.find(c=>c.instanceId==="player-OGN-036")).toMatchObject({ready:true,might:5});expect(second.board.players.player.deckCount).toBe(deck+2);expect(second.board.players.player.energy).toBe(0);expect(second.board.chain).toEqual([]);
    const moved=afterStep("keyword-equipment","keyword-ganking-native");expect(moved.board.cards.find(c=>c.instanceId==="player-OGN-036")).toMatchObject({zone:"battlefield-right",ready:false,might:5});expect(moved.board.players.player.score).toBe(2);
  });
  it("uses Ganking to add a second field score without undoing the first",()=>{
    const before=atStep("keyword-timing","keyword-ganking-native");
    expect(before.board.players.player.score).toBe(2);
    expect(before.board.battlefields[0].scoredBy).toContain("player");
    const won=afterStep("keyword-timing","keyword-ganking-finish-score");
    expect(won.board.players.player.score).toBe(3);
    expect(won.board.battlefields.map(f=>f.scoredBy)).toEqual([["player"],["player"]]);
    expect(won.board.battlefields.map(f=>f.controller)).toEqual([null,"player"]);
  });
  it("keeps the sword attached across the opponent turn and uses its Might next turn",()=>{
    const state=afterStep("keyword-equipment","keyword-weaponmaster-finish-score");
    expect(state.board.cards.find(c=>c.instanceId==="player-SFD-002")).toMatchObject({zone:"battlefield-left",might:8,damage:0});
    expect(state.board.cards.find(c=>c.instanceId==="player-SFD-022")).toMatchObject({zone:"battlefield-left",attachedTo:"player-SFD-002"});
  });
  it("lets Vision change the next ordinary draw without making Predict a draw",()=>{
    const predicted=afterStep("keyword-surprises","keyword-vision-predict");expect(predicted.board.players.player.handCount).toBe(0);
    const drawn=afterStep("keyword-surprises","keyword-vision-vision-next-draw");expect(drawn.board.players.player.handCount).toBe(1);
    expect(drawn.board.cards.find(c=>c.instanceId==="vision-next")).toMatchObject({cardId:"RAD-050",zone:"hand",faceDown:false});
    expect(drawn.board.cards.find(c=>c.instanceId==="player-OGN-096")?.zone).toBe("deck");
  });
  it("shows actual damage and score deltas, and drops effects between separate examples",()=>{
    const dealt=afterStep("keyword-combat","keyword-assault-finish-damage");
    expect(dealt.board.impact?.changes).toContainEqual(expect.objectContaining({kind:"damage",cardId:"player-OGN-215",before:0,after:5}));
    const score=afterStep("keyword-combat","keyword-assault-finish-score");
    expect(score.board.impact?.changes).toContainEqual({side:"player",kind:"score",before:0,after:1});
    const next=advance(score);expect(next.board.keywordScenario?.id).toBe("keyword-backline");expect(next.board.impact).toBeUndefined();
  });
});


describe("showdown focus after completed keyword chains",()=>{
  it.each([["keyword-timing","keyword-action"],["keyword-equipment","keyword-quick-draw"],["keyword-new-tools","keyword-repeat"]])("passes focus after %s / %s card-started chain",(group,id)=>{
    const effect=afterStep(group,`${id}-effect-resolve`);expect(effect.board.chain).toHaveLength(0);expect(effect.board.priority).toBe("opponent");
    expect(getTutorialStep(effect)?.id).toBe(`${id}-finish-guide-pass`);
    const guide=advance(effect);expect(guide.board.priority).toBe("player");expect(getTutorialStep(guide)?.id).toBe(`${id}-finish-pass`);
    expect(advance(guide).board.priority).toBeNull();
  });
  it("keeps guide focus through Hidden Blade’s following Deathknell-only chain",()=>{
    const blade=afterStep("keyword-surprises","keyword-hidden-hidden-resolve");expect(blade.board.priority).toBe("opponent");
    const death=afterStep("keyword-surprises","keyword-hidden-deathknell-resolve");expect(death.board.priority).toBe("opponent");expect(getTutorialStep(death)?.id).toBe("keyword-hidden-hidden-finish-guide-pass");
  });
  it("keeps learner focus after a Disarm trigger-only chain and an opponent-started older spell",()=>{
    expect(afterStep("keyword-combat","keyword-disarm-effect-resolve").board.priority).toBe("player");
    expect(afterStep("keyword-timing","keyword-ambush-older-resolve").board.priority).toBe("player");
    expect(afterStep("keyword-timing","keyword-reaction-counter-resolve").board.priority).toBe("player");
  });
});


describe("Hidden response preparation and explicit alternate positions",()=>{
  for(const [lesson,energy,play,resolveStep,move,enemy] of [
    ["hidden-cards","hidden-buff-energy","hidden-buff-play","hidden-buff-resolve","wait-hidden-move","o-sentry"],
    ["keyword-equipment","keyword-hidden-buff-energy","keyword-hidden-buff-play","keyword-hidden-buff-resolve","keyword-hidden-attack","opponent-OGN-096"]
  ])it(`pays and resolves Discipline before the ${lesson} attack`,()=>{
    const before=atStep(lesson,energy),paid=advance(before);expect(paid.board.players.opponent.energy).toBe(2);
    expect(paid.board.cards.filter(c=>["o-rune-1","o-rune-2"].includes(c.instanceId)).every(c=>!c.ready)).toBe(true);
    const queued=afterStep(lesson,play);expect(queued.board.players.opponent.energy).toBe(0);expect(queued.board.cards.find(c=>c.instanceId===enemy)).toMatchObject({might:1,zone:"base",ready:true});
    const waiting=atStep(lesson,resolveStep),resolved=advance(waiting);expect(resolved.board.players.opponent.deckCount).toBe(waiting.board.players.opponent.deckCount-1);
    expect(resolved.board.cards.find(c=>c.instanceId===enemy)).toMatchObject({might:3,zone:"base",ready:true});
    const moved=afterStep(lesson,move);expect(moved.board.cards.find(c=>c.instanceId===enemy)).toMatchObject({might:3,zone:"battlefield-left",ready:false});
    expect(undoTutorialAction(resolved)).toEqual(waiting);
  });
  for(const [lesson,reset,passStep,blade,enemy,friendly] of [
    ["hidden-cards","hidden-other-reset","hidden-other-pass","p-hidden","o-sentry","p-poro"],
    ["keyword-equipment","keyword-hidden-other-reset","keyword-hidden-other-pass","player-OGN-213","opponent-OGN-096","player-OGN-096"]
  ])it(`labels and rewinds the ${lesson} reset, and rejects cross-battlefield targets`,()=>{
    const before=atStep(lesson,reset);expect(getTutorialStep(before)).toMatchObject({presentation:"lesson-intro",expectedAction:{type:"continue"}});expect(getTutorialStep(before)?.title).toMatch(/Reset/);
    const after=advance(before);expect(undoTutorialAction(after)).toEqual(before);expect(after.board.passedBy).toEqual([]);
    const window=atStep(lesson,passStep);expect(window.board.cards.find(c=>c.instanceId===enemy)?.zone).toBe("battlefield-right");
    expect(window.board.cards.find(c=>c.instanceId===blade)).toMatchObject({zone:"hidden",hiddenAt:"battlefield-left",faceDown:true});
    const bad=applyTutorialAction(window,{type:"play",cardId:blade,targetId:enemy});expect(bad.feedback).toContain("own battlefield");expect(bad.board).toBe(window.board);expect(bad.actions).toEqual(window.actions);
    const local=applyTutorialAction(window,{type:"play",cardId:blade,targetId:friendly});expect(local.feedback).toContain("exercise restriction");expect(local.feedback).not.toContain("own battlefield");
    const passed=advance(window);expect(passed.board.priority).toBeNull();
  });
});

describe("unit entry, queued play abilities and missing targets",()=>{
  it("enters Watcher exhausted immediately, then preserves its untargeted ability after both bounce targets leave",()=>{
    const start=atStep("unit-play-effects","watcher-play"),entered=advance(start);
    expect(entered.board.cards.find(c=>c.instanceId==="p-watcher")).toMatchObject({zone:"base",ready:false,might:7});expect(entered.board.chain).toEqual([]);
    expect(entered.board.players.player.energy).toBe(0);expect(entered.board.players.player.power.Mind).toBe(0);
    const queued=afterStep("unit-play-effects","watcher-trigger");expect(queued.board.chain.at(-1)).toMatchObject({id:"p-watcher:trigger"});expect(queued.board.chain.at(-1)?.targetId).toBeUndefined();
    const response=afterStep("unit-play-effects","watcher-response-play");expect(response.board.chain.at(-1)?.targetIds).toEqual(["o-mystic-poro","p-watcher"]);expect(response.board.players.opponent).toMatchObject({energy:0,power:{Chaos:0}});
    const returned=afterStep("unit-play-effects","watcher-response-resolve");expect(returned.board.cards.find(c=>c.instanceId==="p-watcher")?.zone).toBe("hand");expect(returned.board.cards.find(c=>c.instanceId==="o-mystic-poro")?.zone).toBe("hand");expect(returned.board.chain.map(c=>c.id)).toEqual(["p-watcher:trigger"]);expect(returned.board.priority).toBe("player");
    const before=atStep("unit-play-effects","watcher-ability-resolve"),done=advance(before);expect(done.board.cards.find(c=>c.instanceId==="o-chronomancer")?.might).toBe(1);expect(done.board.cards.find(c=>c.instanceId==="o-mystic-poro")?.might).toBe(2);expect(done.board.cards.find(c=>c.instanceId==="p-watcher")?.zone).toBe("hand");expect(done.board.chain).toEqual([]);expect(undoTutorialAction(done)).toEqual(before);expect(getTutorialStep(done)?.id).toBe("watcher-result");expect(getTutorialStep(done)?.presentation).not.toBe("lesson-intro");
  });
  it("still draws for Discipline after its target returns, without Deathknell or resource refunds",()=>{
    const reset=atStep("unit-play-effects","target-reset");expect(getTutorialStep(reset)?.presentation).toBe("lesson-intro");expect(undoTutorialAction(advance(reset))).toEqual(reset);
    const bounced=afterStep("unit-play-effects","target-response-resolve");expect(bounced.board.cards.find(c=>c.instanceId==="p-sentry")).toMatchObject({zone:"hand",might:1});expect(bounced.board.chain.map(c=>c.id)).toEqual(["p-discipline"]);
    const before=atStep("unit-play-effects","target-discipline-resolve"),after=advance(before);expect(after.board.players.player.deckCount).toBe(before.board.players.player.deckCount-1);expect(after.board.cards.filter(c=>c.owner==="player"&&c.zone==="hand")).toHaveLength(before.board.cards.filter(c=>c.owner==="player"&&c.zone==="hand").length+1);
    expect(after.board.cards.find(c=>c.instanceId==="p-sentry")).toMatchObject({zone:"hand",might:1});expect(after.board.players.player.energy).toBe(0);expect(after.board.players.opponent).toMatchObject({energy:0,power:{Chaos:0}});expect(after.board.chain).toEqual([]);expect(undoTutorialAction(after)).toEqual(before);
  });
  it("requires both valid Star-Crossed targets before paying and permits no premature resolution",()=>{
    const before=atStep("unit-play-effects","watcher-response-play"),invalid=structuredClone(before);invalid.board.cards.find(c=>c.instanceId==="o-mystic-poro")!.zone="trash";
    const denied=applyTutorialAction(invalid,getTutorialStep(invalid)!.expectedAction);expect(denied.feedback).toBeTruthy();expect(denied.board).toBe(invalid.board);expect(denied.board.players.opponent.energy).toBe(3);
    const waiting=afterStep("unit-play-effects","watcher-response-play");const early=applyTutorialAction(waiting,{type:"resolve"});expect(early.feedback).toBeTruthy();expect(early.board).toBe(waiting.board);
  });
});


describe("new board foundations",()=>{
  const card=(state:TutorialState,id:string)=>state.board.cards.find(c=>c.instanceId===id)!;
  const ids=["group-movement","damage-and-might","ready-runes-and-defenders","buffs-and-bonuses","equipment-lifecycle","champion-destinations","passing-decisions"];

  it("moves the whole selected group atomically, records either selection order and rejects a partial or illegal group",()=>{
    const before=atStep("group-movement","group-move"),action={type:"move-units" as const,cardIds:["p-two","p-one"],destination:"battlefield-left" as const};
    const reverse=applyTutorialAction(before,action),normal=advance(before);
    expect(reverse.feedback).toBeNull();expect(reverse.board).toEqual(normal.board);expect(reverse.actions.at(-1)).toEqual(action);
    expect(reverse.board.combat).toMatchObject({battlefieldId:"battlefield-left",attacker:"player"});
    for(const id of action.cardIds)expect(card(reverse,id)).toMatchObject({zone:"battlefield-left",ready:false});
    expect(undoTutorialAction(reverse)).toEqual(before);
    let replay=createLessonState(before.lessonId);for(const recorded of reverse.actions)replay=applyTutorialAction(replay,recorded);expect(replay).toEqual(reverse);
    for(const invalid of [{...action,cardIds:["p-one"]},{...action,cardIds:["p-one","p-one"]},{...action,destination:"battlefield-right" as const}]){
      const denied=applyTutorialAction(before,invalid);expect(denied.feedback).toBeTruthy();expect(denied.board).toBe(before.board);expect(denied.actions).toEqual(before.actions);
    }
    const exhausted=structuredClone(before);card(exhausted,"p-two").ready=false;
    const denied=applyTutorialAction(exhausted,action);expect(denied.feedback).toBeTruthy();expect(denied.board).toBe(exhausted.board);
    const damaged=afterStep("group-movement","group-damage");expect(card(damaged,"p-one").zone).toBe("trash");expect(card(damaged,"o-one").zone).toBe("trash");expect(card(damaged,"p-two")).toMatchObject({zone:"battlefield-left",might:2,damage:1});
    const done=finish("group-movement");expect(done.board.players.player.score).toBe(3);expect(done.board.combat).toBeNull();expect(card(done,"p-two").damage).toBe(0);
  });

  it("keeps marked damage separate from Might, heals all units after combat, and does not heal on ordinary bounce cleanup",()=>{
    const damaged=afterStep("damage-and-might","damage-damage");expect(card(damaged,"p-one")).toMatchObject({might:4,damage:3,zone:"battlefield-left"});expect(card(damaged,"o-one").zone).toBe("trash");
    const before=atStep("damage-and-might","damage-cleanup");card(before,"p-champion").zone="base";card(before,"p-champion").damage=1;
    const healed=advance(before);expect(card(healed,"p-one")).toMatchObject({might:4,damage:0});expect(card(healed,"p-champion").damage).toBe(0);
    const ordinary=atStep("equipment-lifecycle","gear-bounce-cleanup");card(ordinary,"p-two").damage=1;expect(ordinary.board.combat).toBeNull();
    const cleaned=advance(ordinary);expect(card(cleaned,"p-two").damage).toBe(1);expect(card(cleaned,"p-gear").zone).toBe("base");expect(cleaned.board.battlefields[0].controller).toBeNull();
  });

  it("tracks a physical Buff separately through spell, Equipment, paid trigger and turn expiry",()=>{
    const stages:[[string,number,number],...[string,number,number][]]=[["buff-resolve",4,1],["buff-discipline-resolve",6,1],["buff-equip-resolve",7,1],["buff-spend",6,0],["buff-end",4,0]];
    for(const [step,might,buffCount]of stages)expect(card(afterStep("buffs-and-bonuses",step),"p-one"),step).toMatchObject({might,buffCount});
    const moved=afterStep("buffs-and-bonuses","buff-move");expect(card(moved,"p-gear")).toMatchObject({zone:"battlefield-left",attachedTo:"p-one"});
    const before=atStep("buffs-and-bonuses","buff-spend"),spent=advance(before);expect(spent.board.players.player.deckCount).toBe(before.board.players.player.deckCount);
    expect(spent.board.chain.at(-1)).toMatchObject({cardId:"OGN-282",controller:"player"});expect(spent.board.priority).toBe("player");expect(getTutorialActionBattlefield(spent)).toBe("battlefield-left");
    expect(card(spent,"p-one").mightModifiers).toEqual([{label:"Experimental Hexplate",amount:1},{label:"Discipline · this turn",amount:2}]);
    expect(card(spent,"p-one").keywords).not.toContain("Deflect");expect(undoTutorialAction(spent)).toEqual(before);
    const noCounter=structuredClone(before);card(noCounter,"p-one").buffCount=0;
    const denied=applyTutorialAction(noCounter,getTutorialStep(noCounter)!.expectedAction);expect(denied.feedback).toBeTruthy();expect(denied.board).toBe(noCounter.board);
    const resolved=afterStep("buffs-and-bonuses","monastery-resolve");expect(resolved.board.players.player.deckCount).toBe(spent.board.players.player.deckCount-1);expect(resolved.board.combat).toBeNull();expect(resolved.board.chain).toEqual([]);
    expect(card(finish("buffs-and-bonuses"),"p-gear")).toMatchObject({attachedTo:"p-one",zone:"battlefield-left"});
  });

  it("detaches Equipment at the departed unit's location, preserves its readiness and pays to reuse it",()=>{
    const move=afterStep("equipment-lifecycle","gear-move");expect(card(move,"p-gear")).toMatchObject({zone:"battlefield-left",attachedTo:"p-one",ready:true});
    const dead=afterStep("equipment-lifecycle","gear-damage");expect(card(dead,"p-one").zone).toBe("trash");expect(card(dead,"p-gear")).toMatchObject({zone:"battlefield-left",ready:true});expect(card(dead,"p-gear").attachedTo).toBeUndefined();
    const cleaned=afterStep("equipment-lifecycle","gear-cleanup");expect(card(cleaned,"p-gear")).toMatchObject({zone:"base",ready:true});
    const paid=afterStep("equipment-lifecycle","gear-reattach");expect(paid.board.players.player.power.Fury).toBe(0);expect(card(paid,"p-gear").attachedTo).toBeUndefined();expect(paid.board.chain.at(-1)?.targetId).toBe("p-two");
    const attached=afterStep("equipment-lifecycle","gear-reattach-resolve");expect(card(attached,"p-two").might).toBe(4);expect(card(attached,"p-gear").attachedTo).toBe("p-two");
    const bounced=afterStep("equipment-lifecycle","gear-bounce-resolve");expect(card(bounced,"p-one").zone).toBe("hand");expect(card(bounced,"o-mystic-poro").zone).toBe("hand");expect(card(bounced,"p-gear").zone).toBe("battlefield-left");expect(card(bounced,"p-gear").attachedTo).toBeUndefined();
    expect(card(finish("equipment-lifecycle"),"p-gear")).toMatchObject({zone:"base",ready:true});
  });

  it("ends the guide's combat after conquering, keeps the champion zone empty and allows two fully paid champion copies",()=>{
    const scored=afterStep("champion-destinations","champion-guide-score");expect(scored.board).toMatchObject({phase:"Main",combat:null});expect(scored.board.players.opponent.score).toBe(3);expect(card(scored,"p-champion").zone).toBe("trash");expect(scored.board.cards.filter(c=>c.owner==="player"&&c.zone==="champion")).toEqual([]);
    const returned=afterStep("champion-destinations","champion-bounce-resolve");expect(card(returned,"p-champion").zone).toBe("hand");expect(returned.board.cards.filter(c=>c.owner==="player"&&c.zone==="champion")).toEqual([]);
    const replayed=afterStep("champion-destinations","champion-replay");expect(replayed.board.players.player).toMatchObject({energy:4,power:{Mind:1}});
    const two=afterStep("champion-destinations","champion-second-copy");expect(two.board.players.player).toMatchObject({energy:0,power:{Mind:0}});for(const id of ["p-champion","p-copy"])expect(card(two,id)).toMatchObject({zone:"base",ready:false});
    expect(two.board.cards.filter(c=>c.owner==="player"&&c.cardId==="OGN-117")).toHaveLength(2);
  });

  it.each([
    ["first-or-second", "draw-first"],
    ["ready-runes-and-defenders", "reserve-guide-draw"],
  ])("empties both players' rune pools at the start of Main in %s", (lessonId, drawStep) => {
    const state = atStep(lessonId, drawStep);
    expect(state.board.phase).toBe("Draw");
    for (const player of Object.values(state.board.players)) {
      player.energy = 2;
      player.power = { Mind: 1 };
    }
    const next = advance(state);
    expect(next.board.phase).toBe("Main");
    for (const player of Object.values(next.board.players)) {
      expect(player.energy).toBe(0);
      expect(player.power).toEqual({});
    }
  });

  it("expires floating resources while retaining ready runes, lets an exhausted unit defend, then readies only on its own Awaken",()=>{
    const floating=afterStep("ready-runes-and-defenders","reserve-power");expect(floating.board.players.player).toMatchObject({energy:1,power:{Calm:1}});
    const ended=afterStep("ready-runes-and-defenders","reserve-end");expect(ended.board.players.player.energy).toBe(0);expect(Object.values(ended.board.players.player.power).every(n=>n===0)).toBe(true);expect(ended.board.cards.filter(c=>c.owner==="player"&&c.zone==="runes"&&c.ready)).toHaveLength(3);expect(card(ended,"p-one").ready).toBe(false);
    const opponentAwaken=afterStep("ready-runes-and-defenders","reserve-guide-awaken");expect(card(opponentAwaken,"p-one").ready).toBe(false);
    const defended=afterStep("ready-runes-and-defenders","reserve-cleanup");expect(card(defended,"p-one")).toMatchObject({zone:"battlefield-left",ready:false,might:4,damage:0});expect(card(defended,"o-one").zone).toBe("trash");expect(defended.board.players.player.score).toBe(2);expect(defended.board.battlefields[0].controller).toBe("player");expect(defended.board.cards.filter(c=>c.owner==="player"&&c.zone==="runes"&&c.ready)).toHaveLength(1);
    const own=afterStep("ready-runes-and-defenders","reserve-awaken");expect(card(own,"p-one")).toMatchObject({ready:true,might:2});expect(card(own,"p-rune-1").zone).toBe("rune-deck");expect(own.board.cards.filter(c=>c.owner==="player"&&c.zone==="runes"&&c.ready)).toHaveLength(3);
  });

  it("starts a new chain with Reaction and distinguishes passing priority/focus from ending the turn",()=>{
    const before=atStep("passing-decisions","passing-play");expect(before.board.chain).toEqual([]);expect(before.board.phase).toBe("Combat showdown");
    const played=advance(before);expect(played.board.chain).toHaveLength(1);expect(card(played,"p-one").might).toBe(2);
    const passed=afterStep("passing-decisions","passing-spell-pass");expect(passed.board.turn).toBe(before.board.turn);expect(passed.board.turnPlayer).toBe("player");expect(passed.board.priority).toBe("opponent");expect(passed.board.chain).toHaveLength(1);expect(passed.board.log).toContain("You pass priority.");
    const resolved=afterStep("passing-decisions","passing-spell-resolve");expect(card(resolved,"p-one").might).toBe(4);expect(resolved.board.chain).toEqual([]);expect(resolved.board.priority).toBe("opponent");
    const focus=afterStep("passing-decisions","passing-focus");expect(focus.board.turn).toBe(before.board.turn);expect(focus.board.combat).not.toBeNull();expect(focus.board.log.at(-1)).toBe("You pass focus.");
    const end=afterStep("passing-decisions","passing-end");expect(end.board.turn).toBe(before.board.turn+1);expect(end.board.turnPlayer).toBe("opponent");expect(end.board.combat).toBeNull();
  });

  it("preserves legal complete-deck membership and physical card/rune totals at every new lesson prefix",()=>{
    for(const id of ids){let state=createLessonState(id);for(let n=0;n<=LESSONS.find(l=>l.id===id)!.steps.length;n++){
      for(const side of ["player","opponent"] as const){const player=state.board.players[side],deck=getNewPlayerTeachingDeck(player.teachingDeckId!)!;
        const known=state.board.cards.filter(c=>c.owner===side&&!["legend","rune"].includes(c.type)&&c.zone!=="deck");expect(player.deckCount+known.length,`${id}/${n}/${side} main`).toBe(40);
        const counts=new Map<string,number>();for(const c of known)counts.set(c.cardId,(counts.get(c.cardId)??0)+1);for(const [code,amount]of counts)expect(deck.main.find(e=>e.cardId===code)?.quantity??0,`${id}/${n}/${side}/${code}`).toBeGreaterThanOrEqual(amount);
        expect(player.runeDeckCount+state.board.cards.filter(c=>c.owner===side&&c.type==="rune"&&c.zone==="runes").length,`${id}/${n}/${side} runes`).toBe(12);expect(player.energy).toBeGreaterThanOrEqual(0);for(const amount of Object.values(player.power))expect(amount).toBeGreaterThanOrEqual(0);
      }
      for(const gear of state.board.cards.filter(c=>c.attachedTo)){const host=card(state,gear.attachedTo!);expect(gear.zone,`${id}/${n}/${gear.instanceId}`).toBe(host.zone);expect(["base","battlefield-left","battlefield-right"]).toContain(host.zone);}
      if(!state.completed)state=advance(state);
    }}
  });
});


describe("beginner continuity and independent transfer",()=>{
  it("labels prepared positions and returns to the actual main-game score and legend",()=>{
    for(const lesson of LESSONS){const context=getTutorialLessonContext(createLessonState(lesson.id));expect(context.title).toBeTruthy();expect(context.explanation).toBeTruthy();expect(context.position).toContain("Points ");}
    for(const id of ["group-movement","damage-and-might","ready-runes-and-defenders","choose-your-plan"]){expect(getTutorialLessonContext(createLessonState(id)).kind).toBe("separate-exercise");}
    const back=getTutorialLessonContext(createLessonState("start-combat"));expect(back.kind).toBe("return-to-main");expect(back.position).toContain("You: Ahri");expect(back.position).toContain("Turn 5");expect(back.position).toContain("Points 2–1");
    const practice=getTutorialLessonContext(createLessonState("ready-runes-and-defenders"));expect(practice.position).toContain("You: Orianna");expect(practice.explanation).toContain("separate");
    expect(getTutorialLessonContext(createLessonState("combat-damage")).kind).toBe("return-to-main");
  });
  it("introduces the chain before requiring the exhausted-defender response",()=>{
    const index=(id:string)=>LESSONS.findIndex(l=>l.id===id);
    expect(index("ready-runes-and-defenders")).toBeGreaterThan(index("the-chain"));
    expect(index("ready-runes-and-defenders")).toBeLessThan(index("combat-damage"));
    expect(NEW_PLAYER_KEYWORD_SCENARIOS.map(s=>s.keyword).sort()).toEqual([...OFFICIAL_KEYWORDS].sort());
  });
  it.each(["spread","reinforce"])("accepts the %s plan and carries out its distinct consequences",plan=>{
    let state=atStep("choose-your-plan","capstone-plan"),before=state;
    state=applyTutorialAction(state,{type:"choose",optionId:plan});expect(state.feedback).toBeNull();expect(undoTutorialAction(state)).toEqual(before);
    while(!state.completed){
      const step=getTutorialStep(state)!;
      if(step.guidance==="practice")expect(step.practiceHint,step.id).toBeTruthy();
      state=advance(state);
      for(const side of ["player","opponent"] as const){
        expect(state.board.players[side].energy).toBeGreaterThanOrEqual(0);
        expect(state.board.players[side].runeDeckCount+state.board.cards.filter(c=>c.owner===side&&c.type==="rune"&&c.zone==="runes").length).toBe(12);
        const main=state.board.cards.filter(c=>c.owner===side&&c.type!=="rune"&&c.type!=="legend"&&c.zone!=="deck").length;expect(main+state.board.players[side].deckCount).toBe(40);
      }
    }
    const card=(id:string)=>state.board.cards.find(c=>c.instanceId===id)!;
    expect(card("o-elder").zone).toBe("trash");expect(state.board.phase).toBe("Awaken");expect(state.board.players.opponent.score).toBe(3);
    if(plan==="spread"){
      expect(state.board.players.player.score).toBe(4);expect(card("p-keeper").zone).toBe("battlefield-right");expect(card("p-planner").zone).toBe("battlefield-left");expect(card("p-discipline").zone).toBe("trash");expect(state.board.battlefields.map(f=>f.controller)).toEqual(["player","player"]);expect(state.board.cards.filter(c=>c.owner==="player"&&c.zone==="runes"&&c.ready)).toHaveLength(0);
    }else{
      expect(state.board.players.player.score).toBe(3);expect(card("p-keeper").zone).toBe("battlefield-left");expect(card("p-planner").zone).toBe("trash");expect(card("p-discipline").zone).toBe("hand");expect(state.board.battlefields.map(f=>f.controller)).toEqual(["player",null]);expect(state.board.cards.filter(c=>c.owner==="player"&&c.zone==="runes"&&c.ready)).toHaveLength(2);
    }
  });
  it("reinforcing the controlled battlefield spends readiness without a new showdown, score or energy",()=>{
    let state=atStep("choose-your-plan","capstone-plan");state=applyTutorialAction(state,{type:"choose",optionId:"reinforce"});const before=state;state=advance(state);
    expect(state.board.phase).toBe("Main");expect(state.board.combat).toBeNull();expect(state.board.players).toEqual(before.board.players);expect(state.board.cards.find(c=>c.instanceId==="p-keeper")).toMatchObject({zone:"battlefield-left",ready:false});
    const altered=structuredClone(before);altered.board.cards.find(c=>c.instanceId==="p-keeper")!.ready=false;expect(applyTutorialAction(altered,getTutorialStep(altered)!.expectedAction).feedback).toContain("ready unit");
  });
  it("allows either ready rune first in the capstone response and can rewind the payment",()=>{
    const state=atStep("choose-your-plan","capstone-energy-1");const alternative=applyTutorialAction(state,{type:"exhaust",cardId:"p-rune-2"});expect(alternative.feedback).toBeNull();expect(undoTutorialAction(alternative)).toEqual(state);expect(getTutorialStep(alternative)?.expectedAction).toEqual({type:"exhaust",cardId:"p-rune-1"});
    let complete=alternative;while(!complete.completed)complete=advance(complete);expect(complete.board.players.player.score).toBe(4);
  });
});

describe("one score per battlefield, per player, per turn",()=>{
  const id="scoring-once-per-turn";
  it("follows holding in a clearly separate real-card exercise without removing any earlier lesson or keyword",()=>{
    expect(LESSONS).toHaveLength(40);
    expect(LESSONS[LESSONS.findIndex(l=>l.id==="holding")+1].id).toBe(id);
    expect(getTutorialLessonContext(createLessonState(id)).kind).toBe("separate-exercise");
    expect(NEW_PLAYER_KEYWORD_SCENARIOS.map(s=>s.keyword).sort()).toEqual([...OFFICIAL_KEYWORDS].sort());
    expect(createLessonState(id).board.cards.filter(c=>["p-one","p-two","p-three"].includes(c.instanceId)).map(c=>c.cardId)).toEqual(["OGN-044","OGN-065","SFD-074"]);
  });
  it("shares the holding allowance with regaining control, regardless of which unit returns",()=>{
    const held=afterStep(id,"limit-first-hold");
    expect(held.board.players.player.score).toBe(2);expect(held.board.battlefields[0].scoredBy).toEqual(["player"]);
    const left=afterStep(id,"limit-leave");expect(left.board.battlefields[0]).toMatchObject({controller:null,scoredBy:["player"]});
    expect(left.board.cards.find(c=>c.instanceId==="p-one")).toMatchObject({zone:"base",ready:false});
    const returned=afterStep(id,"limit-return");expect(returned.board.cards.find(c=>c.instanceId==="p-two")).toMatchObject({zone:"battlefield-left",ready:false});
    expect(returned.board.battlefields[0].scoredBy).toEqual(["player"]);expect(returned.board.phase).toBe("Showdown");
    const before=atStep(id,"limit-regain-control"),after=advance(before);
    expect(after.board.battlefields[0]).toMatchObject({controller:"player",scoredBy:["player"]});expect(after.board.players).toEqual(before.board.players);
    expect(after.board.chain).toEqual([]);expect(after.board.combat).toBeNull();expect(after.board.phase).toBe("Main");
    expect(after.board.log.some(line=>line.includes("no new conquer"))).toBe(true);expect(undoTutorialAction(after)).toEqual(before);
  });
  it("scores the other battlefield independently and directs its native score button to the right",()=>{
    const before=atStep(id,"limit-other-score");expect(getTutorialActionBattlefield(before)).toBe("battlefield-right");
    const after=advance(before);expect(after.board.players.player.score).toBe(3);
    expect(after.board.battlefields.map(f=>({controller:f.controller,scoredBy:f.scoredBy}))).toEqual([{controller:"player",scoredBy:["player"]},{controller:"player",scoredBy:["player"]}]);
  });
  it("keeps each player's scoring allowance independent even within the same turn",()=>{
    const before=structuredClone(atStep(id,"limit-first-hold"));before.board.battlefields[0].scoredBy=["opponent"];
    const after=advance(before);expect(after.board.players.player.score).toBe(2);expect(after.board.players.opponent.score).toBe(before.board.players.opponent.score);
    expect(after.board.battlefields[0].scoredBy).toEqual(["opponent","player"]);
    const repeated=structuredClone(before);repeated.board.battlefields[0].scoredBy.push("player");
    const denied=applyTutorialAction(repeated,getTutorialStep(repeated)!.expectedAction);expect(denied.feedback).toBeTruthy();expect(denied.board).toBe(repeated.board);expect(denied.actions).toEqual(repeated.actions);
  });
  it("resets both players at each new turn without awarding points or readying the other player's cards",()=>{
    const before=structuredClone(atStep(id,"limit-end-turn"));for(const field of before.board.battlefields)field.scoredBy.push("opponent");
    const after=advance(before);expect(after.board.turnPlayer).toBe("opponent");expect(after.board.turn).toBe(before.board.turn+1);expect(after.board.battlefields.every(f=>f.scoredBy.length===0)).toBe(true);
    expect(after.board.players.player.score).toBe(before.board.players.player.score);expect(after.board.players.opponent.score).toBe(before.board.players.opponent.score);
    for(const unit of after.board.cards.filter(c=>["p-one","p-two","p-three"].includes(c.instanceId)))expect(unit.ready).toBe(false);
    const guideEnd=structuredClone(atStep(id,"limit-guide-end"));for(const field of guideEnd.board.battlefields)field.scoredBy=["player","opponent"];
    const next=advance(guideEnd);expect(next.board.turnPlayer).toBe("player");expect(next.board.phase).toBe("Awaken");expect(next.board.battlefields.every(f=>f.scoredBy.length===0)).toBe(true);expect(next.board.players.player.score).toBe(3);
    const ready=afterStep(id,"limit-next-awaken");expect(ready.board.cards.filter(c=>["p-one","p-two","p-three"].includes(c.instanceId)).every(c=>c.ready)).toBe(true);
    const first=afterStep(id,"limit-next-hold-left");expect(first.board.players.player.score).toBe(4);expect(first.board.phase).toBe("Beginning");expect(first.board.battlefields.map(f=>f.scoredBy)).toEqual([["player"],[]]);
    const right=atStep(id,"limit-next-hold-right");expect(getTutorialActionBattlefield(right)).toBe("battlefield-right");const done=advance(right);expect(done.board.players.player.score).toBe(5);expect(done.board.battlefields.map(f=>f.scoredBy)).toEqual([["player"],["player"]]);
  });
  it.each(["limit-same-turn","limit-opponent","limit-other-choice"])("explains an incorrect %s prediction without mutating the board",stepId=>{
    const before=atStep(id,stepId),after=applyTutorialAction(before,{type:"choose",optionId:"incorrect"});expect(after.feedback).toBeTruthy();expect(after.board).toBe(before.board);expect(after.actions).toEqual(before.actions);expect(after.stepIndex).toBe(before.stepIndex);
  });
  it("cannot skip the response window or claim a repeat-score result for an unscored battlefield",()=>{
    for(const change of ["priority","unscored","enemy"]){
      const before=structuredClone(atStep(id,"limit-regain-control"));
      if(change==="priority")before.board.priority="opponent";
      if(change==="unscored")before.board.battlefields[0].scoredBy=[];
      if(change==="enemy")before.board.cards.push({...before.board.cards.find(c=>c.instanceId==="p-two")!,instanceId:"o-blocker",owner:"opponent"});
      const after=applyTutorialAction(before,getTutorialStep(before)!.expectedAction);expect(after.feedback,change).toBeTruthy();expect(after.board).toBe(before.board);expect(after.actions).toEqual(before.actions);
    }
  });
  it("replays and rewinds every action while conserving both complete decks",()=>{
    let state=createLessonState(id);
    while(!state.completed){const before=state;state=advance(state);expect(undoTutorialAction(state)).toEqual(before);
      for(const side of ["player","opponent"] as const){
        expect(state.board.players[side].runeDeckCount+state.board.cards.filter(c=>c.owner===side&&c.type==="rune"&&c.zone==="runes").length).toBe(12);
        expect(state.board.players[side].deckCount+state.board.cards.filter(c=>c.owner===side&&c.type!=="rune"&&c.type!=="legend"&&c.zone!=="deck").length).toBe(40);
      }
    }
    let replay=createLessonState(id);for(const action of state.actions)replay=applyTutorialAction(replay,action);expect(replay).toEqual(state);
  });
});
