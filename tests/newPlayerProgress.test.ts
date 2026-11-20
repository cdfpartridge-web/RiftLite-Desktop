import { describe, expect, it } from "vitest";
import { applyTutorialAction, createLessonState, getTutorialStep, type TutorialAction, LESSONS } from "../src/shared/newPlayerTutorial.js";
import { initialNewPlayerProgress, NEW_PLAYER_COURSE_VERSION, NEW_PLAYER_MIGRATION_NOTICE, NEW_PLAYER_UPGRADE_NOTICE, parseNewPlayerProgress, resumeLessonState, saveLessonProgress, serializeNewPlayerProgress } from "../src/shared/newPlayerProgress.js";

describe("device-local new player checkpoints", () => {
  it("selectively upgrades v9, preserving unchanged completion and prefixes while restarting automatic own turns",()=>{
    const read=LESSONS.find(l=>l.id==="read-a-card")!.steps.map(s=>s.expectedAction);
    const previousFirst=LESSONS.find(l=>l.id==="first-or-second")!.steps.map(s=>s.expectedAction.type==="check-beginning"?{type:"continue"}:s.expectedAction);
    const records={"read-a-card":{actions:read,completed:true},"opening-hand":{actions:[{type:"continue"}],completed:false},"first-or-second":{actions:previousFirst,completed:true},"power-and-champion":{actions:[{type:"continue"},{type:"guide",eventId:"next-awaken"}],completed:false},"game-overview":{actions:[{type:"continue"},{type:"guide",eventId:"overview-move"}],completed:false}};
    const upgraded=parseNewPlayerProgress(JSON.stringify({version:1,courseVersion:9,readTopicIds:["domains","timing"],lastLessonId:"power-and-champion",lessons:records}));
    expect(upgraded.courseVersion).toBe(NEW_PLAYER_COURSE_VERSION);expect(upgraded.completedLessonIds).toEqual(["read-a-card"]);expect(upgraded.lessons["read-a-card"]).toEqual(records["read-a-card"]);expect(upgraded.lessons["opening-hand"]).toEqual(records["opening-hand"]);
    for(const id of ["first-or-second","power-and-champion"])expect(upgraded.lessons[id]).toEqual({actions:[],completed:false});
    expect(upgraded.lessons["game-overview"]).toBeUndefined();
    expect(upgraded.readTopicIds).toEqual(["domains","timing"]);expect(upgraded.lastLessonId).toBe("power-and-champion");expect(upgraded.migrationNotice).toBe(NEW_PLAYER_UPGRADE_NOTICE);
    expect(parseNewPlayerProgress(serializeNewPlayerProgress(upgraded))).toEqual(upgraded);
  });
  it("keeps compatible v8 introductions but restarts an old automatic learner-turn checkpoint",()=>{
    const old={version:1,courseVersion:8,readTopicIds:["timing","domains"],lastLessonId:"keyword-timing",lessons:{
      "read-a-card":{actions:[{type:"continue"},{type:"inspect",cardId:"p-sentry"}],completed:false},
      "keyword-timing":{actions:[{type:"continue"},{type:"continue"},{type:"inspect",cardId:"player-OGN-004"}],completed:false},
      "practice-first-point":{actions:[{type:"continue"},{type:"guide",eventId:"practice-first-channel"}],completed:false}
    }};
    const migrated=parseNewPlayerProgress(JSON.stringify(old));
    for(const id of ["read-a-card","keyword-timing"] as const)expect(migrated.lessons[id]).toEqual(old.lessons[id]);
    expect(migrated.lessons["practice-first-point"]).toEqual({actions:[],completed:false});
    expect(migrated.readTopicIds).toEqual(old.readTopicIds);expect(migrated.lastLessonId).toBe(old.lastLessonId);
    expect(migrated.lessons["resource-decisions"]).toBeUndefined();expect(migrated.lessons["game-overview"]).toBeUndefined();
    expect(migrated.completedLessonIds).toEqual([]);expect(migrated.migrationNotice).toBe(NEW_PLAYER_UPGRADE_NOTICE);
  });
  it.each(["reserve","develop"])("saves the actual %s choice, restores its branch and resumes without replacing it with the default",plan=>{
    let state=createLessonState("resource-decisions");state=applyTutorialAction(state,getTutorialStep(state)!.expectedAction);
    state=applyTutorialAction(state,{type:"choose",optionId:plan});
    for(let n=0;n<3;n++)state=applyTutorialAction(state,getTutorialStep(state)!.expectedAction);
    const raw=serializeNewPlayerProgress(saveLessonProgress(initialNewPlayerProgress(),state));
    const restored=resumeLessonState(parseNewPlayerProgress(raw),state.lessonId);expect(restored).toEqual(state);
    while(!state.completed){const next=applyTutorialAction(state,getTutorialStep(state)!.expectedAction);expect(next.feedback).toBeNull();state=next;}
    const saved=saveLessonProgress(parseNewPlayerProgress(raw),state);expect(resumeLessonState(parseNewPlayerProgress(serializeNewPlayerProgress(saved)),state.lessonId)).toEqual(state);
    expect(saved.completedLessonIds).toContain(state.lessonId);
  });
  it("round-trips each lesson midway and on completion", () => {
    let progress = initialNewPlayerProgress();
    for (const lesson of LESSONS) {
      let state = createLessonState(lesson.id);
      while (!state.completed) {
        state = applyTutorialAction(state, getTutorialStep(state)!.expectedAction);
        expect(state.feedback).toBeNull();
        progress = parseNewPlayerProgress(serializeNewPlayerProgress(saveLessonProgress(progress, state)));
        expect(resumeLessonState(progress, lesson.id)).toEqual(state);
      }
    }
    expect(progress.completedLessonIds).toHaveLength(LESSONS.length);
  }, 30000);
  it("does not trust forged completion flags, boards or invalid saved actions", () => {
    const progress = parseNewPlayerProgress(JSON.stringify({ version: 1, courseVersion: NEW_PLAYER_COURSE_VERSION, lastLessonId: "not-a-lesson", completedLessonIds: LESSONS.map((l) => l.id), lessons: {
      "win-the-game": { completed: true, board: { score: 8 }, actions: [{ type: "score" }] },
      "power-and-champion": { completed: true, actions: [{ type: "inspect", cardId: "p-champion" }, { type: "exhaust", cardId: "o-rune-1" }] }
    } }));
    expect(progress.completedLessonIds).toEqual([]); expect(progress.lastLessonId).toBeNull();
    expect(resumeLessonState(progress, "power-and-champion").stepIndex).toBe(0);
    expect(resumeLessonState(progress, "win-the-game").board.players.player.score).toBe(7);
  });
  it.each([null, "", "not json", "[]", '{"version":2}', "x".repeat(500_001)])("fails closed for malformed input", (raw) => {
    expect(parseNewPlayerProgress(raw)).toEqual(initialNewPlayerProgress());
  });
  it("preserves read topics without accepting unbounded or executable content", () => {
    const p = parseNewPlayerProgress('{"version":1,"readTopicIds":["domains","domains","<script>",42]}');
    expect(p.readTopicIds).toEqual(["domains"]);
  });
  it.each([undefined, 2])("migrates previous course %s without replaying incompatible actions or claiming completion", (courseVersion) => {
    const p = parseNewPlayerProgress(JSON.stringify({ version: 1, courseVersion, lastLessonId: "opening-hand", readTopicIds: ["domains", "board-layout"], completedLessonIds: LESSONS.map((l) => l.id), lessons: {
      "meet-the-board": { completed: true, actions: [{ type: "inspect", cardId: "p-legend" }] },
      "opening-hand": { completed: true, actions: [{ type: "inspect", cardId: "p-discipline" }, { type: "mulligan", cardIds: ["p-discipline"] }] }
    } }));
    expect(p.courseVersion).toBe(NEW_PLAYER_COURSE_VERSION);
    expect(p.migrationNotice).toBe(NEW_PLAYER_MIGRATION_NOTICE);
    expect(p.readTopicIds).toEqual(["domains", "board-layout"]);
    expect(p.completedLessonIds).toEqual([]); expect(p.lessons).toEqual({}); expect(p.lastLessonId).toBeNull();
    expect(resumeLessonState(p, "opening-hand").stepIndex).toBe(0);
    expect(parseNewPlayerProgress(serializeNewPlayerProgress(p))).toEqual(p);
    const dismissed = { ...p, migrationNotice: null };
    expect(parseNewPlayerProgress(serializeNewPlayerProgress(dismissed))).toEqual(dismissed);
  });
  it("replays native keyword gestures and keeps validated cache records isolated from caller mutation", () => {
    const initial=createLessonState("keyword-timing"), action=getTutorialStep(initial)!.expectedAction;
    const played=applyTutorialAction(initial,action);
    expect(played.feedback).toBeNull();
    const raw=serializeNewPlayerProgress(saveLessonProgress(initialNewPlayerProgress(),played));
    const parsed=parseNewPlayerProgress(raw);
    expect(resumeLessonState(parsed,"keyword-timing")).toEqual(played);
    parsed.lessons["keyword-timing"].actions.length=0;
    expect(parseNewPlayerProgress(raw).lessons["keyword-timing"].actions).toEqual([action]);
  });

  it.each([3,4,5,6,7])("preserves compatible course %s records and restarts only changed action sequences", (courseVersion) => {
    const openingActions=LESSONS.find(l=>l.id==="opening-hand")!.steps.map(s=>s.expectedAction);
    const readActions=LESSONS.find(l=>l.id==="read-a-card")!.steps.map(s=>s.expectedAction);
    const upgraded=parseNewPlayerProgress(JSON.stringify({version:1,courseVersion,lastLessonId:"keyword-timing",readTopicIds:["domains","card-anatomy"],lessons:{
      "opening-hand":{actions:openingActions,completed:true},"read-a-card":{actions:readActions,completed:true},
      "power-and-champion":{actions:[{type:"inspect",cardId:"p-champion"},{type:"exhaust",cardId:"p-rune-1"}],completed:false},
      "keyword-timing":{actions:[{type:"demonstrate-keyword",scenarioId:"keyword-accelerate"},{type:"continue"}],completed:false}
    }}));
    expect(upgraded.courseVersion).toBe(NEW_PLAYER_COURSE_VERSION);
    expect(upgraded.completedLessonIds).toEqual(["opening-hand"]);
    expect(upgraded.lessons["opening-hand"].actions).toEqual(openingActions);
    expect(upgraded.lessons["read-a-card"]).toEqual({actions:[],completed:false});
    expect(upgraded.lessons["power-and-champion"].actions).toEqual([]);
    expect(upgraded.lessons["keyword-timing"].actions).toEqual([]);
    expect(upgraded.readTopicIds).toEqual(["domains","card-anatomy"]);
    expect(upgraded.migrationNotice).toBe(NEW_PLAYER_UPGRADE_NOTICE);
    expect(parseNewPlayerProgress(serializeNewPlayerProgress(upgraded))).toEqual(upgraded);
    expect(parseNewPlayerProgress(serializeNewPlayerProgress({...upgraded,migrationNotice:null})).migrationNotice).toBeNull();
  });
  it("keeps an unchanged legacy partial checkpoint and rejects old fabricated guide events",()=>{
    const p=parseNewPlayerProgress(JSON.stringify({version:1,courseVersion:4,lessons:{"first-or-second":{actions:[{type:"continue"}],completed:false},"the-chain":{actions:[{type:"guide",eventId:"invented"}],completed:true}}}));
    expect(resumeLessonState(p,"first-or-second").stepIndex).toBe(1);
    expect(p.lessons["the-chain"]).toEqual({actions:[],completed:false});
  });

  it("does not reuse a legacy partial cache record for a contradictory completed claim",()=>{
    const raw=(completed:boolean)=>JSON.stringify({version:1,courseVersion:4,lessons:{"first-or-second":{actions:[{type:"continue"}],completed}}});
    expect(parseNewPlayerProgress(raw(false)).lessons["first-or-second"].actions).toHaveLength(1);
    expect(parseNewPlayerProgress(raw(true)).lessons["first-or-second"]).toEqual({actions:[],completed:false});
    expect(parseNewPlayerProgress(raw(false)).lessons["first-or-second"].actions).toHaveLength(1);
  });

  it("upgrades old opening action shapes without treating newly ordered keywords as compatible", () => {
    const keyword = LESSONS.find(l => l.id === "keyword-combat")!;
    const old = { version: 1, courseVersion: 6, readTopicIds: ["board-layout", "card-anatomy"], lastLessonId: "opening-hand", lessons: {
      "table-setup": { completed: true, actions: [
        { type: "setup", item: "legend" }, { type: "setup", item: "champion" },
        { type: "setup", item: "battlefields", cardId: "OGN-282" }, { type: "setup", item: "decks" },
        { type: "setup", item: "turn-order", choice: "first" }, { type: "setup", item: "opening-hand" },
        { type: "inspect", cardId: "battlefield-right" }
      ] },
      "opening-hand": { completed: true, actions: [{ type: "inspect", cardId: "p-discipline" }, { type: "mulligan", cardIds: ["p-discipline"] }, { type: "inspect", cardId: "p-replacement" }] },
      "first-or-second": { completed: true, actions: [{ type: "continue" }, { type: "ready" }, { type: "continue" }, { type: "channel", ready: true }, { type: "draw" }] },
      "keyword-combat": { completed: true, actions: keyword.steps.map(s => s.expectedAction) },
      "countering-spells": { completed: false, actions: [{ type: "inspect", cardId: "o-rune-prison" }, { type: "exhaust", cardId: "p-rune-2" }] }
    } };
    const result = parseNewPlayerProgress(JSON.stringify(old));
    expect(result.courseVersion).toBe(NEW_PLAYER_COURSE_VERSION);
    expect(result.readTopicIds).toEqual(old.readTopicIds);
    for (const id of ["table-setup", "opening-hand", "first-or-second"]) expect(result.lessons[id]).toEqual({ actions: [], completed: false });
    expect(result.completedLessonIds).toEqual([]);
    expect(result.lessons["keyword-combat"]).toEqual({actions:[],completed:false});
    expect(result.lessons["countering-spells"]).toEqual({actions:[],completed:false});
    expect(result.migrationNotice).toBe(NEW_PLAYER_UPGRADE_NOTICE);
    expect(parseNewPlayerProgress(serializeNewPlayerProgress(result))).toEqual(result);
  });

  it("preserves the unchanged v7 opening and final routes while restarting changed intros and keyword order",()=>{
    const saved={version:1,courseVersion:7,readTopicIds:["domains","timing"],lastLessonId:"the-chain",lessons:{
      ...Object.fromEntries(["table-setup","opening-hand","first-or-second","win-the-game"].map(id=>[id,{completed:true,actions:LESSONS.find(l=>l.id===id)!.steps.map(s=>s.expectedAction)}])),
      "read-a-card":{completed:false,actions:[{type:"inspect",cardId:"p-sentry"}]},
      "play-first-unit":{completed:false,actions:[{type:"exhaust",cardId:"p-rune-1"},{type:"exhaust",cardId:"p-rune-2"}]},
      "keyword-timing":{completed:false,actions:[{type:"continue"},{type:"exhaust",cardId:"p-rune-1"}]}
    }};
    const parsed=parseNewPlayerProgress(JSON.stringify(saved));expect(parsed.courseVersion).toBe(NEW_PLAYER_COURSE_VERSION);
    expect(parsed.completedLessonIds).toEqual(["table-setup","opening-hand","first-or-second","win-the-game"]);
    for(const id of ["read-a-card","play-first-unit","keyword-timing"])expect(parsed.lessons[id]).toEqual({actions:[],completed:false});
    expect(parsed.readTopicIds).toEqual(saved.readTopicIds);expect(parsed.migrationNotice).toBe(NEW_PLAYER_UPGRADE_NOTICE);
    expect(parseNewPlayerProgress(serializeNewPlayerProgress(parsed))).toEqual(parsed);
  });

  it("does not reinterpret a lone old keyword Continue as the new group introduction",()=>{
    const saved={version:1,courseVersion:7,lessons:{"keyword-timing":{actions:[{type:"continue"}],completed:false},"opening-hand":{actions:[{type:"continue"}],completed:false}}};
    const parsed=parseNewPlayerProgress(JSON.stringify(saved));expect(parsed.lessons["keyword-timing"]).toEqual({actions:[],completed:false});expect(parsed.lessons["opening-hand"].actions).toHaveLength(1);
  });

});


describe("v11 Hidden course migration",()=>{
  for(const completed of [false,true])it(`keeps compatible v10 ${completed?"complete":"partial"} checkpoints and restarts only the two Hidden lessons`,()=>{
    const records:Record<string,{actions:TutorialAction[];completed:boolean}>={};
    for(const lesson of LESSONS.filter(l=>l.id!=="unit-play-effects")){
      let state=createLessonState(lesson.id);const count=completed?lesson.steps.length:Math.max(1,Math.floor(lesson.steps.length/2));
      for(let i=0;i<count;i++){state=applyTutorialAction(state,getTutorialStep(state)!.expectedAction);expect(state.feedback).toBeNull();}
      records[lesson.id]={actions:state.actions,completed:state.completed};
    }
    const old={version:1,courseVersion:10,readTopicIds:["timing","board-layout"],lastLessonId:"hidden-cards",lessons:records};
    const result=parseNewPlayerProgress(JSON.stringify(old));expect(result.courseVersion).toBe(NEW_PLAYER_COURSE_VERSION);expect(result.lastLessonId).toBe("hidden-cards");expect(result.readTopicIds).toEqual(old.readTopicIds);
    for(const [id,record] of Object.entries(records))expect(result.lessons[id],id).toEqual(["hidden-cards","keyword-equipment"].includes(id)?{actions:[],completed:false}:record);
    expect(result.lessons["unit-play-effects"]).toBeUndefined();expect(result.migrationNotice).toBe(NEW_PLAYER_UPGRADE_NOTICE);
    expect(parseNewPlayerProgress(serializeNewPlayerProgress({...result,migrationNotice:null})).migrationNotice).toBeNull();
  });
});


describe("additive foundation course upgrade",()=>{
  const added=new Set(["group-movement","damage-and-might","ready-runes-and-defenders","buffs-and-bonuses","equipment-lifecycle","champion-destinations","passing-decisions"]);
  it.each(["completed","halfway"])("preserves every compatible v11 %s record and leaves all seven additions unstarted",mode=>{
    const previous=LESSONS.filter(l=>!added.has(l.id)&&!["choose-your-plan","scoring-once-per-turn"].includes(l.id));expect(previous).toHaveLength(31);
    const lessons:Record<string,{actions:TutorialAction[];completed:boolean}>={};
    for(const lesson of previous){let state=createLessonState(lesson.id);const count=mode==="completed"?lesson.steps.length:Math.floor(lesson.steps.length/2);
      for(let n=0;n<count;n++){state=applyTutorialAction(state,getTutorialStep(state)!.expectedAction);expect(state.feedback).toBeNull();}
      lessons[lesson.id]={actions:state.actions,completed:state.completed};
    }
    const raw=JSON.stringify({version:1,courseVersion:11,readTopicIds:["domains","first-real-game"],lastLessonId:"hidden-cards",lessons});
    const migrated=parseNewPlayerProgress(raw);expect(migrated.courseVersion).toBe(NEW_PLAYER_COURSE_VERSION);expect(migrated.lessons).toEqual(lessons);expect(migrated.readTopicIds).toEqual(["domains","first-real-game"]);expect(migrated.lastLessonId).toBe("hidden-cards");
    for(const id of added)expect(migrated.lessons[id]).toBeUndefined();expect(migrated.completedLessonIds).toHaveLength(mode==="completed"?31:0);
    const dismissed={...migrated,migrationNotice:null};expect(parseNewPlayerProgress(serializeNewPlayerProgress(dismissed))).toEqual(dismissed);
  });
  it("retains reverse grouped-move selection exactly through save, resume and Back",()=>{
    let state=createLessonState("group-movement");while(getTutorialStep(state)?.id!=="group-move")state=applyTutorialAction(state,getTutorialStep(state)!.expectedAction);
    const before=state;state=applyTutorialAction(state,{type:"move-units",cardIds:["p-two","p-one"],destination:"battlefield-left"});expect(state.feedback).toBeNull();
    const saved=parseNewPlayerProgress(serializeNewPlayerProgress(saveLessonProgress(initialNewPlayerProgress(),state)));
    expect(resumeLessonState(saved,state.lessonId)).toEqual(state);expect(saved.lessons[state.lessonId].actions.at(-1)).toEqual({type:"move-units",cardIds:["p-two","p-one"],destination:"battlefield-left"});expect(state.actions.slice(0,-1)).toEqual(before.actions);
  });
});


describe("course v13 continuity and decision challenge",()=>{
  it.each(["completed","halfway"])("retains compatible v12 %s records after reordering and adding a challenge",mode=>{
    const records:Record<string,{actions:TutorialAction[];completed:boolean}>={};
    for(const lesson of LESSONS.filter(l=>!["choose-your-plan","scoring-once-per-turn"].includes(l.id))){
      let state=createLessonState(lesson.id);const count=mode==="completed"?lesson.steps.length:Math.floor(lesson.steps.length/2);
      for(let i=0;i<count;i++){state=applyTutorialAction(state,getTutorialStep(state)!.expectedAction);expect(state.feedback).toBeNull();}
      records[lesson.id]={actions:state.actions,completed:state.completed};
    }
    const parsed=parseNewPlayerProgress(JSON.stringify({version:1,courseVersion:12,lastLessonId:"ready-runes-and-defenders",readTopicIds:["domains","first-real-game"],lessons:records}));
    expect(parsed.lessons).toEqual(records);expect(parsed.courseVersion).toBe(NEW_PLAYER_COURSE_VERSION);expect(parsed.lastLessonId).toBe("ready-runes-and-defenders");expect(parsed.readTopicIds).toEqual(["domains","first-real-game"]);expect(parsed.lessons["choose-your-plan"]).toBeUndefined();
  });
  it.each(["spread","reinforce"])("restores the selected %s capstone branch midway and on completion",plan=>{
    let state=createLessonState("choose-your-plan");state=applyTutorialAction(state,getTutorialStep(state)!.expectedAction);state=applyTutorialAction(state,{type:"choose",optionId:plan});
    for(let i=0;i<4;i++)state=applyTutorialAction(state,getTutorialStep(state)!.expectedAction);
    const roundTrip=()=>resumeLessonState(parseNewPlayerProgress(serializeNewPlayerProgress(saveLessonProgress(initialNewPlayerProgress(),state))),state.lessonId);
    expect(roundTrip()).toEqual(state);
    while(!state.completed){state=applyTutorialAction(state,getTutorialStep(state)!.expectedAction);expect(state.feedback).toBeNull();}
    expect(roundTrip()).toEqual(state);expect(state.board.decisions?.["capstone-plan"]).toBe(plan);
  });
});

describe("course v14 additive scoring lesson",()=>{
  it.each(["completed","halfway"])("preserves all 39 compatible v13 %s lesson records and leaves the scoring addition unstarted",mode=>{
    const previous=LESSONS.filter(l=>l.id!=="scoring-once-per-turn");expect(previous).toHaveLength(39);
    const records:Record<string,{actions:TutorialAction[];completed:boolean}>={};
    for(const lesson of previous){let state=createLessonState(lesson.id);const count=mode==="completed"?lesson.steps.length:Math.floor(lesson.steps.length/2);
      for(let n=0;n<count;n++){state=applyTutorialAction(state,getTutorialStep(state)!.expectedAction);expect(state.feedback).toBeNull();}
      records[lesson.id]={actions:state.actions,completed:state.completed};
    }
    const parsed=parseNewPlayerProgress(JSON.stringify({version:1,courseVersion:13,lastLessonId:"holding",readTopicIds:["turns-and-scoring"],lessons:records}));
    expect(parsed.courseVersion).toBe(14);expect(parsed.lessons).toEqual(records);expect(parsed.completedLessonIds).toHaveLength(mode==="completed"?39:0);expect(parsed.lessons["scoring-once-per-turn"]).toBeUndefined();
    expect(parsed.lastLessonId).toBe("holding");expect(parsed.readTopicIds).toEqual(["turns-and-scoring"]);expect(parsed.migrationNotice).toBe(NEW_PLAYER_UPGRADE_NOTICE);
    expect(parseNewPlayerProgress(serializeNewPlayerProgress({...parsed,migrationNotice:null}))).toEqual({...parsed,migrationNotice:null});
  });
  it("resumes the scoring lesson between turns with its exact control and scored records",()=>{
    let state=createLessonState("scoring-once-per-turn");
    while(!state.completed){state=applyTutorialAction(state,getTutorialStep(state)!.expectedAction);expect(state.feedback).toBeNull();
      const saved=parseNewPlayerProgress(serializeNewPlayerProgress(saveLessonProgress(initialNewPlayerProgress(),state)));
      expect(resumeLessonState(saved,state.lessonId)).toEqual(state);
    }
  });
});
