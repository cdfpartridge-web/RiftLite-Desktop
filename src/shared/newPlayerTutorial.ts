/** Deterministic teaching scenarios. This is not a general Riftbound rules engine. */
import { NEW_PLAYER_KEYWORD_GROUPS, NEW_PLAYER_KEYWORD_SCENARIOS, KEYWORD_LEGEND_PAIRS, KEYWORD_DECK_IDENTITIES, type KeywordScenarioCard, type KeywordScenario, type KeywordScenarioGroup, type KeywordScenarioSnapshot } from "./newPlayerKeywordScenarios.js";
import { DEFAULT_TEACHING_DECK_BY_LEGEND, getNewPlayerTeachingDeck } from "./newPlayerTeachingDecks.js";
export type TutorialSide = "player" | "opponent";
export type TutorialDomain = "Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order";
export type TutorialBattlefieldId = "battlefield-left" | "battlefield-right";
export type TutorialZone = "setup" | "hand" | "base" | "champion" | "legend" | "runes" | "trash" | "hidden" | "deck" | "rune-deck" | "chain" | "banishment" | TutorialBattlefieldId;
export interface TutorialCard {
  instanceId: string;
  cardId: string;
  name: string;
  imageUrl: string;
  type: "unit" | "spell" | "gear" | "rune" | "legend";
  champion?: boolean;
  owner: TutorialSide;
  zone: TutorialZone;
  ready: boolean;
  faceDown: boolean;
  might: number;
  baseMight: number;
  damage: number;
  energyCost: number;
  powerCost: number;
  domain: TutorialDomain;
  domains?: TutorialDomain[];
  token?: boolean;
  rulesText: string;
  keywords: string[];
  hiddenAt?: TutorialBattlefieldId;
  hiddenOnTurn?: number;
  annotation?: string;
  attachedTo?: string;
  empowered?: boolean;
  stunned?: boolean;
  buffCount?: number;
  mightModifiers?: Array<{ label: string; amount: number }>;
}
export interface TutorialPlayer {
  name: string;
  score: number;
  energy: number;
  power: Partial<Record<TutorialDomain, number>>;
  deckCount: number;
  runeDeckCount: number;
  xp?: number;
  handCount?: number;
  teachingDeckId?: string;
}
export type TutorialSetupItem = "legend" | "champion" | "battlefields" | "main-deck" | "rune-deck" | "turn-order" | "opening-hand";
export interface TutorialSetup {
  stage: TutorialSetupItem | "complete";
  completedItems: TutorialSetupItem[];
  battlefieldOptions: Array<{ cardId: string; name: string; imageUrl: string }>;
  selectedBattlefieldId: string | null;
}
export interface TutorialBoard {
  turn: number;
  firstPlayer: TutorialSide;
  turnPlayer: TutorialSide;
  phase: string;
  priority: TutorialSide | null;
  passedBy?: TutorialSide[];
  players: Record<TutorialSide, TutorialPlayer>;
  cards: TutorialCard[];
  battlefields: Array<{ id: TutorialBattlefieldId; cardId: string; name: string; imageUrl: string; controller: TutorialSide | null; scoredBy: TutorialSide[] }>;
  chain: Array<{ id: string; cardId: string; controller: TutorialSide; label: string; targetId?: string; targetIds?: string[] }>;
  combat: { battlefieldId: TutorialBattlefieldId; attacker: TutorialSide; assignments: Record<string, number>; pendingEnd?: boolean; pendingTriggers?: string[] } | null;
  log: string[];
  setup?: TutorialSetup;
  practiceBattlefieldId?: TutorialBattlefieldId;
  foundation?: {lessonId:string;variant:string};
  decisions?: Record<string, string>;
  practice?: { title: string; note: string; keyword: string; stage: "before" | "after"; mode: "game" | "deck-check" };
  keywordScenario?: { id: string; revealed: boolean; snapshot: KeywordScenarioSnapshot };
  impact?: {
    id: string; label: string; sourceIds?: string[]; targetIds?: string[];
    changes?: Array<{ cardId?: string; side?: TutorialSide; kind: "might" | "damage" | "energy" | "power" | "score" | "zone" | "status"; before: string | number; after: string | number; label?: string }>;
  };
}
export type TutorialAction =
  | { type: "choose"; optionId: string }
  | { type: "guide"; eventId: string }
  | { type: "demonstrate-keyword"; scenarioId: string }
  | { type: "setup"; item: TutorialSetupItem; choice?: "first" | "second"; cardId?: string; destination?: TutorialZone }
  | { type: "inspect"; cardId: string }
  | { type: "mulligan"; cardIds: string[] }
  | { type: "channel"; ready: boolean }
  | { type: "draw" | "pass" | "resolve" | "end-turn" | "continue" | "ready" | "check-beginning" | "score" | "demonstrate-combat" | "alternate-win-route" }
  | { type: "exhaust" | "recycle"; cardId: string }
  | { type: "activate"; cardId: string; targetId?: string; costCardId?: string }
  | { type: "choose-trigger"; cardId: string; targetId: string }
  | { type: "remove-draft-copy"; cardId: string }
  | { type: "predict"; cardId: string; choice: "keep" | "recycle" }
  | { type: "play"; cardId: string; targetId?: string; destination?: TutorialZone }
  | { type: "move"; cardId: string; destination: TutorialZone }
  | { type: "move-units"; cardIds: string[]; destination: TutorialBattlefieldId }
  | { type: "spend-buff"; cardId: string }
  | { type: "assign-damage"; assignments: Record<string, number> }
  | { type: "hide"; cardId: string; battlefieldId: TutorialBattlefieldId };
/** One narrated rules event. The renderer never applies these mutations itself. */
export type TutorialGuideEffect =
  | { type: "foundations"; operation: string }
  | { type: "start-turn"; side: TutorialSide }
  | { type: "ready"; side: TutorialSide }
  | { type: "channel"; side: TutorialSide; count: number }
  | { type: "draw"; side: TutorialSide; count: number }
  | { type: "draw-card"; cardId: string }
  | { type: "phase"; phase: string; priority: TutorialSide | null }
  | { type: "pass"; side: TutorialSide }
  | { type: "exhaust"; cardId: string }
  | { type: "exhaust-runes"; cardIds: string[] }
  | { type: "play"; cardId: string; destination: TutorialZone; targetId?: string }
  | { type: "move"; cardId: string; destination: TutorialBattlefieldId }
  | { type: "score"; side: TutorialSide; battlefieldId: TutorialBattlefieldId }
  | { type: "assign" }
  | { type: "keyword"; scenarioId: string; operation: string }
  | { type: "exercise"; operation: string }
  | { type: "deathknell"; cardId: string }
  | { type: "trigger"; cardId: string; label: string; targetId?: string }
  | { type: "hidden-loss" }
  | { type: "hidden-loss-position" }
  | { type: "hidden-other-position" }
  | { type: "on-play"; operation: "watcher-trigger" | "recycle-chaos" | "star-crossed-play" | "star-crossed-resolve" | "watcher-resolve" | "reset-target" | "discipline-resolve" }
  | { type: "resolve-ahri" }
  | { type: "resolve" };
export interface TutorialStep {
  id: string;
  title: string;
  instruction: string;
  hint: string;
  expectedAction: TutorialAction;
  label: string;
  focusIds: string[];
  presentation?: "turn-start" | "mulligan-intro" | "lesson-intro" | "keyword-scenario" | "keyword-intro";
  lessonIntro?: TutorialLessonIntro;
  guidance?: "practice";
  practiceGoal?: string;
  /** A clue about the rule or goal, before revealing the exact authored move. */
  practiceHint?: string;
  /** A saved prediction or plan. Gameplay itself still uses native board actions. */
  decision?: { prompt: string; options: Array<{ id: string; label: string; explanation: string; accepted: boolean }> };
  allowedCardIds?: string[];
  allowedDestinations?: TutorialBattlefieldId[];
  rulesLessonId?: string;
  actor?: "player" | "guide" | "rules";
  guideEffect?: TutorialGuideEffect;
  /** An authored event attached to a real learner gesture, including phase controls. */
  rulesEffect?: TutorialGuideEffect;
  keywordScenarioId?: string;
  /** A real Atlas gesture accepted for this authored keyword demonstration. */
  boardAction?: TutorialAction;
  combatDemonstration?: {
    sourceIds: string[];
    targetAssignments: Array<{ cardId: string; amount: number; order: number; label?: string }>;
    returnAssignments?: Array<{ cardId: string; amount: number; order?: number; label?: string }>;
    explanation: string;
  };
}
export interface TutorialLessonIntro { see: string; do: string; why: string }
export interface TutorialLessonContext {
  kind: "main-game" | "separate-exercise" | "return-to-main";
  title: string;
  explanation: string;
  /** Current public position, so a changed legend or score is never left implicit. */
  position?: string;
}
export interface TutorialLesson {
  id: string;
  title: string;
  description: string;
  minutes: number;
  chapter: string;
  champion: string;
  scenarioNote: string;
  context?: TutorialLessonContext;
  intro?: TutorialLessonIntro;
  practice?: { goal: string };
  path?: "first-game" | "practice" | "keywords";
  /** One bounded decision lesson can have different authored continuations. */
  branch?: { decisionStepId: string; defaultOptionId: string; variants: Record<string, TutorialStep[]> };
  steps: TutorialStep[];
}
export interface TutorialState {
  version: 1;
  lessonId: string;
  stepIndex: number;
  completed: boolean;
  feedback: string | null;
  board: TutorialBoard;
  /** Accepted inputs are the checkpoint. Restoring replays these through validation. */
  actions: TutorialAction[];
  history: TutorialBoard[];
}

// Registry-bound identities and official artwork; card rules are implemented explicitly below.
const CARD_IDENTITIES = {
  "OGN-063": {"name": "Spirit's Refuge", "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/26d5e54580d1f17ed6c35a66ac6a90ce56c99ec8-744x1039.png?accountingTag=RB", "costEnergy": 2, "costPower": 1},
  "SFD-073": {"name": "Experimental Hexplate", "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/940a5e9796d4ac10a238d9b2612545c04bd9a570-744x1039.png?accountingTag=RB", "costEnergy": 1, "costPower": null},
  "OGN-116": {"name": "Thousand-Tailed Watcher", "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/b20e5644c33924a58e0497dd9f7db19723147003-744x1039.png?accountingTag=RB", "costEnergy": 7, "costPower": 1},
  "UNL-128": {"name": "Star-Crossed", "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0bfa45e6e86dfc256de0163f96273b761e9592fb-744x1039.png?accountingTag=RB", "costEnergy": 3, "costPower": 1},
  "OGN-263": {"name": "Teemo, Swift Scout", "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/9723181e3392bb61c2aabc804a44f7b0558cedf1-744x1039.png?accountingTag=RB", "costEnergy": null, "costPower": null},
  "OGN-197": {"name": "Teemo, Scout", "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/ca8a2e11dd78dd09ad1c9ad3a23e5699254b947e-744x1039.png?accountingTag=RB", "costEnergy": 2, "costPower": null},
  "OGN-171": {"name": "Mystic Poro", "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/11af57d045768e886d05e1c0933b0d57cb1e459d-744x1039.png?accountingTag=RB", "costEnergy": 2, "costPower": null},
  "RAD-050": {"name": "Mysterious Chronomancer", "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/72828b0fe019b2e03069510f781dfa8f5759ac12-744x1039.png?accountingTag=RB", "costEnergy": 5, "costPower": 0},
  "OGN-166": {"name": "Chaos Rune", "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/daf23b0deaa5e1a5a5d310b59e9ad25d1bd70363-744x1039.png?accountingTag=RB", "costEnergy": null, "costPower": null},
  "OGN-044": { name: "Clockwork Keeper", imageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/417e606418349bb25d4b07d460fa043ad85f2778-744x1039.png?accountingTag=RB", costEnergy: 2, costPower: null },
  "OGN-065": { name: "Wizened Elder", imageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/7b98797789ad7e3a6cf52126b82a42ec6f269bb7-744x1039.png?accountingTag=RB", costEnergy: 4, costPower: null },
  "SFD-074": { name: "Pickpocket", imageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/ebf54af997e53079e1a476feb0411d1791b20f7e-744x1039.png?accountingTag=RB", costEnergy: 3, costPower: null },
  "OGN-261": { name: "Leona, Radiant Dawn", imageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/822b8bc7987a47498550708b18ef166b121fd620-744x1039.png?accountingTag=RB", costEnergy: null, costPower: null },
  "OGN-238": { name: "Leona, Determined", imageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/39a1e121031cfb4bdb009b071ed5d70411966cd9-744x1039.png?accountingTag=RB", costEnergy: 4, costPower: 1 },
  "RAD-145": { name: "Orianna, Lady of Clockwork", imageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/d1f940425d4d913d8f56c017254343bc898f4892-744x1039.png?accountingTag=RB", costEnergy: null, costPower: null },
  "RAD-068": { name: "Orianna, Mechanical Marvel", imageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/00f5a081a085e9c3851daf79d9e39bd378f71fe3-744x1039.png?accountingTag=RB", costEnergy: 5, costPower: 0 },
  "SFD-216": { name: "Rockfall Path", imageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/a1bde66bccf2786e7c0b9d44fcdcdaa6b59f0328-1039x744.png?accountingTag=RB", costEnergy: null, costPower: null },
  "OGN-045": { "name": "Defy", "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/4989bfcc4bd7be77051f0c2c349a981ba9c273e0-744x1039.png?accountingTag=RB", "costEnergy": 1, "costPower": 1 },
  "OGN-050": { "name": "Rune Prison", "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/21867baeaced3c22cda5f40f6b6c9a8dad4b7042-744x1039.png?accountingTag=RB", "costEnergy": 2, "costPower": 1 },
  "OGN-042": {
    "name": "Calm Rune",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0a0e8c3d16c2595e2f8efcc2b1466226539b506c-744x1039.png?accountingTag=RB",
    "costEnergy": null,
    "costPower": null
  },
  "OGN-089": {
    "name": "Mind Rune",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/f99aa4874baaebd2e81798c8a3aa01c5900f6d30-744x1039.png",
    "costEnergy": null,
    "costPower": null
  },
  "OGN-096": {
    "name": "Watchful Sentry",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/d84da2c62b1e218a0a74b227c49ce8a953918ebd-744x1039.png?accountingTag=RB",
    "costEnergy": 2,
    "costPower": null
  },
  "OGN-058": {
    "name": "Discipline",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/8b9613970b505e3ad6abe2d51d091778314a7d48-744x1039.png?accountingTag=RB",
    "costEnergy": 2,
    "costPower": null
  },
  "OGN-119": {
    "name": "Ahri, Inquisitive",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/cfa28e1abcac1db780d11e82985e13ee5978290d-744x1039.png?accountingTag=RB",
    "costEnergy": 3,
    "costPower": 1
  },
  "OGN-255": {
    "name": "Ahri, Nine-Tailed Fox",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/fbce641f5e4d8cdf2956e8ead5884b6cd3ccd90d-744x1040.png?accountingTag=RB",
    "costEnergy": null,
    "costPower": null
  },
  "OGN-213": {
    "name": "Hidden Blade",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0437ab8a0b67f43ef5483a103bbae9e57fd05822-744x1039.png?accountingTag=RB",
    "costEnergy": 2,
    "costPower": 1
  },
  "OGN-210": {
    "name": "Daring Poro",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/41dee7ec46124c261352595cfbd8a6d38d32b947-744x1039.png?accountingTag=RB",
    "costEnergy": 2,
    "costPower": null
  },
  "OGN-269": {
    "name": "Sett, The Boss",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/b132becb843b2cf418cb110ead64758f49f51554-744x1039.png?accountingTag=RB",
    "costEnergy": null,
    "costPower": null
  },
  "OGN-240": {
    "name": "Sett, Kingpin",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/bd43f1dcef824b66f1af994b59b961fc3705f9c3-744x1039.png?accountingTag=RB",
    "costEnergy": 4,
    "costPower": 1
  },
  "OGN-126": {
    "name": "Body Rune",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/3b3c3c07626d6180457c849047e0228dc0d19539-744x1039.png?accountingTag=RB",
    "costEnergy": null,
    "costPower": null
  },
  "OGN-214": {
    "name": "Order Rune",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/35ec6fdd2124324bb7052cba31c8c44f2e98f3ae-744x1039.png",
    "costEnergy": null,
    "costPower": null
  },
  "OGN-282": {
    "name": "Monastery of Hirana",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/8767d9ed30e2873d3fa1045f973be229da56175d-1038x744.png?accountingTag=RB",
    "costEnergy": null,
    "costPower": null
  }
} as const;

type CardCode = keyof typeof CARD_IDENTITIES;
const CARD_RULES: Record<CardCode, { type: TutorialCard["type"]; domain: TutorialDomain; might: number; text: string; keywords?: string[]; champion?: boolean }> = {
  "OGN-063": {type:"gear",domain:"Calm",might:0,text:"When played, buff a friendly unit. Buffed friendly units have Deflect."},
  "SFD-073": {type:"gear",domain:"Mind",might:0,text:"Equip 1 Mind power. Attached unit gets +1 Might and is a Mech.",keywords:["Equip"]},
  "OGN-116": {type:"unit",domain:"Mind",might:7,text:"Accelerate. When you play this, give all enemy units -3 Might this turn, to a minimum of 1.",keywords:["Accelerate"]},
  "UNL-128": {type:"spell",domain:"Chaos",might:0,text:"Reaction. Return a friendly unit and an enemy unit to their owners’ hands.",keywords:["Reaction"]},
  "OGN-263": {type:"legend",domain:"Chaos",might:0,text:"You may pay 1 energy instead of power to hide a Hidden card. Pay 1 energy and exhaust to return an owned Teemo unit from the board or Champion Zone to hand."},
  "OGN-197": {type:"unit",domain:"Chaos",might:1,champion:true,text:"Hidden. When played, this unit gets +3 Might for the turn.",keywords:["Hidden"]},
  "OGN-171": {type:"unit",domain:"Chaos",might:2,text:"Vision: when played, Predict 1.",keywords:["Vision"]},
  "RAD-050": {type:"unit",domain:"Mind",might:4,text:"When played, Predict 2. Disarm 2.",keywords:["Disarm"]},
  "OGN-166": {type:"rune",domain:"Chaos",might:0,text:"Exhaust for 1 energy. Recycle for 1 Chaos power."},
  "OGN-044": { type: "unit", domain: "Calm", might: 2, text: "As an additional cost to play this, you may pay 1 Calm power. If you do, draw 1 when you play it." },
  "OGN-065": { type: "unit", domain: "Calm", might: 4, text: "While this is buffed, it has an additional +1 Might." },
  "SFD-074": { type: "unit", domain: "Mind", might: 3, text: "When played, you may kill gear costing at most 1 energy. If you do, create an exhausted Gold." },
  "OGN-261": { type: "legend", domain: "Calm", might: 0, text: "When you stun one or more enemy units, buff a friendly unit if it does not already have a buff." },
  "OGN-238": { type: "unit", domain: "Order", might: 4, champion: true, text: "Shield: +1 Might while defending. When Leona attacks, stun an enemy unit here so it deals no combat damage this turn.", keywords: ["Shield"] },
  "RAD-145": { type: "legend", domain: "Calm", might: 0, text: "At the start of your Main phase, you may pay 1 energy to make a friendly gear a unit gear with Might equal to its energy cost, until you choose another gear with this ability." },
  "RAD-068": { type: "unit", domain: "Mind", might: 5, champion: true, text: "Once each turn while Orianna is at a battlefield, you may pay 1 energy and 1 power less to play a gear." },
  "SFD-216": { type: "gear", domain: "Mind", might: 0, text: "Units cannot be played here. Moving units here is allowed." },
  "OGN-045": { type: "spell", domain: "Calm", might: 0, text: "Reaction. Counter a spell costing at most 4 energy and at most 1 power.", keywords: ["Reaction"] },
  "OGN-050": { type: "spell", domain: "Calm", might: 0, text: "Action. Stun a unit so it deals no combat damage this turn.", keywords: ["Action"] },
  "OGN-042": { type: "rune", domain: "Calm", might: 0, text: "Exhaust for 1 energy. Recycle for 1 Calm power." },
  "OGN-089": { type: "rune", domain: "Mind", might: 0, text: "Exhaust for 1 energy. Recycle for 1 Mind power." },
  "OGN-126": { type: "rune", domain: "Body", might: 0, text: "Exhaust for 1 energy. Recycle for 1 Body power." },
  "OGN-214": { type: "rune", domain: "Order", might: 0, text: "Exhaust for 1 energy. Recycle for 1 Order power." },
  "OGN-096": { type: "unit", domain: "Mind", might: 1, text: "Deathknell: draw 1 when this unit dies.", keywords: ["Deathknell"] },
  "OGN-058": { type: "spell", domain: "Calm", might: 0, text: "Reaction. Give a unit +2 Might this turn, then draw 1.", keywords: ["Reaction"] },
  "OGN-119": { type: "unit", domain: "Mind", might: 3, champion: true, text: "When Ahri attacks or defends, give an enemy unit here -2 Might this turn, to a minimum of 1." },
  "OGN-255": { type: "legend", domain: "Calm", might: 0, text: "When an enemy unit attacks a battlefield you control, give it -1 Might this turn, to a minimum of 1." },
  "OGN-213": { type: "spell", domain: "Order", might: 0, text: "Hidden. Action. Kill a unit at a battlefield; its controller draws 2.", keywords: ["Hidden", "Action"] },
  "OGN-210": { type: "unit", domain: "Order", might: 2, text: "Assault: +1 Might while attacking.", keywords: ["Assault"] },
  "OGN-269": { type: "legend", domain: "Body", might: 0, text: "May spend a buff, Body power and exhaust Sett to recall a buffed friendly unit instead of it dying. Ready Sett when you conquer." },
  "OGN-240": { type: "unit", domain: "Order", might: 5, champion: true, text: "Tank. +1 Might for each buffed friendly unit at this battlefield.", keywords: ["Tank"] },
  // Battlefield is stored separately, never a playable Main Deck card.
  "OGN-282": { type: "gear", domain: "Calm", might: 0, text: "When you conquer here, you may spend a buff to draw 1." }
};

function card(code: CardCode, instanceId: string, owner: TutorialSide, zone: TutorialZone, ready = true): TutorialCard {
  const identity = CARD_IDENTITIES[code];
  const rules = CARD_RULES[code];
  return { instanceId, cardId: code, name: identity.name, imageUrl: identity.imageUrl, type: rules.type,
    champion: rules.champion, owner, zone, ready, faceDown: owner === "opponent" && zone === "hand",
    might: rules.might, baseMight: rules.might, damage: 0, energyCost: identity.costEnergy ?? 0,
    powerCost: identity.costPower ?? 0, domain: rules.domain, rulesText: rules.text, keywords: rules.keywords ?? [] };
}

function step(id: string, title: string, instruction: string, expectedAction: TutorialAction, label: string, hint = instruction): TutorialStep {
  const focusIds = "cardId" in expectedAction && expectedAction.cardId ? [expectedAction.cardId]
    : "cardIds" in expectedAction ? expectedAction.cardIds
    : "assignments" in expectedAction ? Object.keys(expectedAction.assignments) : [];
  return { id, title, instruction, hint, expectedAction, label, focusIds };
}
const inspect = (id: string, title: string, instruction: string) => step(`inspect-${id}`, title, instruction, { type: "inspect", cardId: id }, "Click to inspect");
const exhaust = (n: number, purpose = "play Watchful Sentry") => step(`energy-${n}`, "Make 1 energy", `To ${purpose}, tap this ready rune for 1 energy. It turns sideways, which means it’s exhausted, but it stays on the table and can ready again on a later turn.`, { type: "exhaust", cardId: `p-rune-${n}` }, "Exhaust rune");
const CORE_PASS_COPY: Record<string, string> = {
  "empty-showdown": "Your Sentry’s walked onto an empty battlefield, but I still get a say before you take it. Pass focus, which means you’re giving me the chance to act in this showdown, and if I pass too your Sentry can conquer.",
  "ahri-trigger-pass": "Ahri’s attack ability is on the chain, waiting to happen. You’ve got priority, so you could add a response, but we want the ability to resolve as it is. Pass and I’ll get my chance to respond too.",
  "pass-own": "Your Discipline is on top of mine, so yours is first in line to resolve. Pass priority to let me respond, you’re still in the same turn.",
  "pass-enemy": "My Discipline’s still here, even though yours has finished. I’ve passed on it, so pass as well and we can let it resolve.",
  "counter-passes": "Pass on Defy. Rune Prison’s still waiting underneath it, and I get a chance to respond before your counterspell can stop it.",
  "finish-combat-showdown": "Ahri’s on 5 Might and Sentry’s on 3, so I’d be happy for the fight to go ahead from your side. Pass focus and give me my last chance to do something before damage.",
  "pass-hidden": "We played Hidden Blade from its space without paying its printed base cost, but I still get a chance to respond before it kills Sentry. Pass and see what I do.",
  "last-showdown": "Pass focus at this first battlefield. Nobody’s defending it, but we still have a showdown to finish before Sentry can conquer.",
  "second-final-showdown": "Your other Sentry’s made it to the second battlefield. Pass focus here too, and if I pass we’ll see whether conquering this one earns you point eight."
};
const pass = (id = "pass", instruction = CORE_PASS_COPY[id] ?? "Pass if you’re happy with what’s waiting on the chain. You’re giving the other player a chance to respond, and once you’ve both passed the newest effect can happen. It’s still the same turn.") => step(id, "Pass: add nothing now", instruction, { type: "pass" }, "Pass");
const CORE_RESOLVE_COPY: Record<string, string> = {
  "resolve-own": "We’ve both passed, so resolve your Discipline, the newer of the two spells. Ahri gains 2 Might for the turn and you draw a card, while my Discipline stays on the chain.",
  "counter-resolve": "We’ve both passed, so resolve Defy. Rune Prison goes to the trash without stunning Sentry, but we’ve both still spent the resources we paid to play our spells.",
  "deal-damage": "Deal the 5 damage to Sentry and the 3 to Ahri together. Sentry still hits back for all 3, even though Ahri’s damage is enough to kill it.",
  "resolve-hidden": "Resolve Hidden Blade now we’ve both passed. It kills the attacking Sentry and gives its controller two cards, then Blade goes to the trash. There’s still Sentry’s own draw ability to deal with.",
  "keyword-resolution": "We’ve chosen where the damage goes, so resolve it now. Your side deals 8 at the same time as mine deals 4, and all 4 of mine go to Sett because of Tank, leaving your Poro safe."
};
const resolve = (id = "resolve") => step(id, "Resolve: carry out the effect", CORE_RESOLVE_COPY[id] ?? "We’ve both passed, so resolve the newest effect on the chain and do what it says. Anything underneath stays there, and we’ll each get a chance to respond to it afterwards.", { type: "resolve" }, "Resolve");
const score = (id = "score", instruction = "Record the point here. Each player can score this battlefield once per turn.") => step(id, "Record the score", instruction, { type: "score" }, "Score");
const continueStep = (id: string, instruction: string, title = "Take a moment") => step(id, title, instruction, { type: "continue" }, "Continue");
const mainNote = "You’re playing Ahri and I’ll take the Orianna side, with the board saved between lessons so we can pick up where we left off. We’ve chosen these decks for the plays we want to practise.";
function lesson(id: string, title: string, description: string, minutes: number, chapter: string, steps: TutorialStep[], scenarioNote = mainNote, champion = "Ahri"): TutorialLesson {
  return { id, title, description, minutes, chapter, champion, scenarioNote, intro: LESSON_INTROS[id], steps };
}

function guide(id: string, title: string, instruction: string, guideEffect: TutorialGuideEffect, focusIds: string[] = []): TutorialStep {
  return { ...step(id, title, instruction, { type: "guide", eventId: id }, "Watch the next move"), actor: "guide", guideEffect, focusIds };
}
function keywordIntroPlan(keyword:string):string {
  const plans:Record<string,string>={
    Accelerate:"Pay the extra cost on Rearguard as you play it, then see if you can get it to the empty battlefield this turn.", Action:"Move in with Rearguard, then try Cleave before the units deal combat damage.", Reaction:"Answer their Cleave with Discipline and see which spell is still waiting once you’ve drawn your card.", Ganking:"Take Vi from one battlefield straight to the other and check whether she’s still ready afterwards.", Ambush:"Spend 2 energy on Inferna while their spell’s waiting, then look at the battlefield where you already have a unit.",
    Assault:"Move Petty Officer in and compare its Might with the other Officer’s now that one of them’s attacking.", Shield:"Leave Guardian where it is and let their turn play out, then check which Guardian gets the extra Might.", Tank:"Decide how much damage has to go on the Tank before any of it reaches the other unit.", Backline:"Work out which unit has to take damage before Promoter, then follow the fight through to Sentry’s Deathknell.", Deflect:"Count what you need for Blade, then check what it costs to choose Poro as the target.", Disarm:"Attack with Chronomancer and see when the enemy actually loses Might.",
    Hidden:"Get energy from a rune before you recycle it to hide Blade, then try playing Blade from that battlefield on a later turn.", Deathknell:"Watch Sentry take lethal damage, then see when its controller gets to draw.", Temporary:"Start the next turn with Sprite still on your battlefield and see if it lasts until the holding check.", Vision:"Play Mystic Poro and look at the next card in private, then decide whether you want to draw it next turn.",
    Equip:"Pay Long Sword’s Equip cost and see when your unit actually gets the extra Might.", "Quick-Draw":"Play the sword during the showdown and watch for the attachment ability after it enters base.", Weaponmaster:"Play Assailant with a sword already in your base, and see what it costs to attach it.", Unique:"Check this decklist before playing and find the extra copy of a Unique card.",
    Legion:"Play Rearguard first, then see how much Noxus Hopeful costs with Legion.", Hunt:"Take the point for conquering, then see where Scorchclaw’s XP comes from.", Level:"Look at your XP before you play Scorchclaw, because it changes how the unit enters.", Empower:"Count your runes before you pay for Empower, then see when Sandspinner gets its new ability.", Empowered:"Send in a Sandspinner that’s already Empowered and check its Might while attacking.",
    Repeat:"Pay Repeat as you play Blood Rush, then see how many spells are on the chain and how many times you get the bonus.", Flow:"Play Dredge Up from your trash and follow the card once you’ve finished resolving it.", Deploy:"Put your Banner at their battlefield and see who gets the bonus when your unit moves in.", "Show Off":"Show the Hopeful in your hand, then use its Might to work out how much damage Roar deals."
  };return plans[keyword];
}

function keywordSequence(scenario: KeywordScenario): TutorialStep[] {
  const id = scenario.id, k = scenario.keyword, native = scenario.boardAction!;
  const event = (operation: string): TutorialGuideEffect => ({ type: "keyword", scenarioId: id, operation });
  const player = (suffix: string, title: string, instruction: string, action: TutorialAction, operation?: string): TutorialStep => ({
    ...step(`${id}-${suffix}`, title, instruction, action, title), presentation: "keyword-scenario", keywordScenarioId: id,
    ...(operation ? { rulesEffect: event(operation) } : {})
  });
  const auto = (suffix: string, title: string, instruction: string, operation: string, focus: string[] = []): TutorialStep => ({
    ...guide(`${id}-${suffix}`, title, instruction, event(operation), focus), presentation: "keyword-scenario", keywordScenarioId: id
  });
  const steps: TutorialStep[] = [{ ...player("intro", `${k}: let’s try it`, `${scenario.objective?.goal ?? keywordIntroPlan(k)} ${scenario.objective?.without ?? ""}`, { type: "continue" }, "intro"), presentation: "keyword-intro", label: "Start this example" }];
  if(k==="Action"||k==="Reaction") {
    steps[0].presentation="lesson-intro";
    steps[0].lessonIntro=k==="Action"?{see:"Rearguard is ready in base, Hopeful is defending and you’ve got Cleave in hand.",do:"Move Rearguard in and play Cleave when the showdown opens, before the units hit each other.",why:"You could use Cleave in your open Main phase, but waiting lets you see the fight before spending it."}:{see:"They’ve played Cleave and you’re holding Discipline, so check which unit each spell would help.",do:"Play Discipline, draw Defy, then see whether there’s still time to use that card on Cleave.",why:"You get another chance to respond after each effect resolves, which matters when the response itself draws a card."};
  }
  const payment = (energy: number, power: number, suffix = "cost", alreadyUsed: number[] = []) => {
    const pair = KEYWORD_LEGEND_PAIRS.find(p => p.legend.cardId === scenario.board!.playerLegendId)!;
    const domain = scenario.board!.powerDomain;
    const all = Array.from({ length: Math.max(scenario.board!.runeCount, energy + alreadyUsed.length, power * 2) }, (_, i) => i + 1).filter(n => !alreadyUsed.includes(n));
    const powerRunes = all.filter(n => pair.domains[(n - 1) % pair.domains.length] === domain).slice(0, power);
    const selected = [...new Set([...powerRunes, ...all])].slice(0, Math.max(energy, power));
    const purposes: Record<string,string> = { Accelerate:"play Rearguard ready and move it this turn",Action:"add Cleave’s extra Might before combat",Reaction:"help Guardian before their Cleave resolves",Ambush:"bring Inferna into the fight as a response",Deflect:"pay for Blade and cover Poro’s Deflect cost",Hidden:"hide Blade for a later turn",Vision:"play Mystic Poro and check your next draw",Equip:"attach Long Sword to strengthen Rearguard", "Quick-Draw":"play Long Sword during this fight",Weaponmaster:"play Assailant and give it the waiting sword",Legion:suffix==="first"?"play Rearguard as your first card this turn":"play Hopeful at its cheaper Legion cost",Hunt:"earn experience from scoring",Level:"play Scorchclaw with its Level 3 ability",Empower:"activate Empower on Sandspinner",Repeat:"play Blood Rush and pay for Repeat",Flow:"use Dredge Up again from the trash",Deploy:"put the Banner where Hopeful will attack","Show Off":"pay for Roar to remove the enemy Hopeful" };
    const purpose=purposes[k] ?? `use ${k} in this position`;
    for (const [index,n] of selected.entries()) steps.push(player(`${suffix}-energy-${n}`, "Make 1 energy", energy===0 ? `You need power to ${purpose}, but you can get an energy out of this rune before you give it up. Exhaust the ready rune for 1 energy, then we can recycle it and keep that energy for another play.` : `To ${purpose}, we need ${energy} energy. Select the highlighted ready rune to exhaust it for 1, bringing us to ${index+1} of ${energy}. It turns sideways and stays on the table.`, { type: "exhaust", cardId: `p-rune-${n}` }));
    for (const [index,n] of powerRunes.entries()) steps.push(player(`${suffix}-power-${n}`, `Make ${domain} power`, `We need ${k==="Deflect"?"1 Order power plus 1 power of any domain":`${power} power${k==="Hidden"?" of any domain":` matching the ${domain} symbol`}`} to ${purpose}. Open this sideways rune’s menu and choose Recycle for power ${index+1} of ${power}, sending it to the bottom of the rune deck. You keep the energy it made.`, { type: "recycle", cardId: `p-rune-${n}` }));
  };
  const responses = (suffix: string, operation = "resolve", opponentFirst = false) => {
    const effects:Record<string,[string,string]>={Action:["Cleave","give Rearguard Assault 3 this turn, worth 3 extra Might while it’s attacking"],Reaction:["your Discipline","give Guardian 2 extra Might for this turn and draw a card"],Deflect:["Hidden Blade","kill the chosen Poro and give its controller two cards"],Disarm:["Chronomancer’s Disarm ability","reduce the enemy Hopeful from 4 Might to 2 for this turn"],Vision:["Mystic Poro’s Vision ability","let you privately inspect the top card of your deck"],Equip:["Long Sword’s Equip ability","attach the sword to Rearguard and raise it from 2 Might to 4"],"Quick-Draw":["Long Sword’s attachment ability","attach the sword to your Sentry, raising it from 1 Might to 3"],Weaponmaster:["Assailant’s attachment ability","use its discount to attach Long Sword without another payment"],Hunt:["Scorchclaw’s Hunt ability","gain 2 experience points"],Level:["Scorchclaw’s Hunt ability","add 2 experience points to the 3 you already have"],Empower:["Sandspinner’s Empower ability","make Sandspinner Empowered and switch on its Assault 2"],Repeat:["Blood Rush","give Rearguard Assault 2 twice, for 4 extra Might while attacking"],Flow:["Dredge Up","draw a card, then send the spell to Banishment instead of back to the trash"],"Show Off":["Primordial Roar","deal 4 damage to the chosen enemy Hopeful"],Hidden:["Hidden Blade","kill your chosen Sentry and give you two cards"],Temporary:["Sprite’s Temporary ability","kill the Sprite before it can earn a holding point"]};
    const [name,result]=operation==="vi-resolve"?["Vi’s activated ability","give Vi 1 extra Might for this turn without exhausting her"]:operation==="hidden-buff-resolve"?["the guide’s Discipline","give their Sentry 2 extra Might this turn and draw the guide a card before the unit moves"]:operation==="counter-resolve"?["Defy","counter the waiting Cleave so its instructions never happen"]:operation==="older"?["the guide’s Discipline","give their Sentry 2 extra Might this turn and draw the guide a card"]:operation==="deathknell"?["the Sentry’s Deathknell ability",`draw one card for ${opponentFirst?"the guide":"you"}`]:effects[k];
    if(opponentFirst) steps.push(auto(`${suffix}-guide-first`, "The guide offers you a response", `The guide controls the newest thing on the chain, ${name}, and has passed priority to you. This is your chance to respond before it can ${result}.`, "opponent-pass", ["chain"]));
    steps.push(player(`${suffix}-pass`, "Pass: let this effect go ahead", opponentFirst ? `The guide’s passed on ${name}, so pass priority as well if you’re happy to let it ${result}. That’s both players passing on this effect, and the turn carries on.` : `We want ${name} to ${result}, so pass priority and give the guide a chance to answer it. It stays on the chain while you’re waiting for that answer.`, { type: "pass" }));
    if(!opponentFirst) steps.push(auto(`${suffix}-guide-pass`, "The guide lets your effect proceed", `The guide passes on ${name} too, which means it can now ${result}. Anything further down the chain has to wait its turn.`, "pass", ["chain"]));
    steps.push(opponentFirst ? auto(`${suffix}-resolve`, "The guide’s effect happens", `You’ve both passed, so ${name} can resolve and ${result}. Watch that change first, because if there’s something else underneath it you’ll get a fresh chance to respond.`, operation, ["chain"]) : player(`${suffix}-resolve`, "Carry out the waiting effect", `Resolve ${name} now that you’ve both passed, and it will ${result}. If there’s an older effect underneath it, that one gets its own chance for responses.`, { type: "resolve" }, operation));
  };
  if(k === "Ganking") {
    steps.push(player("awaken", "Ready the unit you kept", "Vi’s still on your left battlefield after their turn, so ready her in Awaken. That means she’ll be able to move, but before we decide where she’s going, there’s a holding point to check.", {type:"ready"}, "ready-player"));
    steps.push(player("hold-left", "Earn the holding point first", "You kept the left battlefield through their turn, so score it in Beginning and go from 1 point to 2. Now we’ve got the point, I’d start looking at whether Vi can do something on the other battlefield as well.", {type:"score"}, "gank-hold"));
    steps.push(auto("channel", "Prepare this turn’s runes", "Channel two ready runes from your rune deck. Vi’s ability won’t cost us energy or power, so these can pay for something else if we need them.", "channel-player", ["player:rune-deck","player:runes"]));
    steps.push(auto("draw", "Draw before making Main-phase plays", "Draw your card and you’re into Main, where you can normally move a ready unit or use an ordinary ability while the chain and showdown are clear.", "draw-player", ["player:deck","player:hand"]));
    steps.push(player("read-ability", "Read the cost under Ganking", "Select Vi and read the ability under Ganking. Recycle a card from your trash for +1 Might this turn, in your open Main phase because it has neither Action nor Reaction. It costs no exhaust and there’s no once-per-turn limit, so how many cards are you willing to recycle?", {type:"inspect",cardId:"player-OGN-036"}));
    for(const [number,costId] of [[1,"vi-cost-one"],[2,"vi-cost-two"]] as const){
      steps.push(player(`ability-${number}`, number===1?"Use Vi’s ability once":"Use it again, paying again", number===1?"Use Activate on Vi and recycle the first Cleave from your trash to the bottom of your main deck as payment. That puts the +1 Might ability on the chain, and Vi stays ready because you didn’t have to exhaust her.":"The first ability’s resolved, so you’re back in your open Main phase. Activate Vi again and recycle the other Cleave, because we can pay for a second +1 Might before she moves.", {type:"activate",cardId:"player-OGN-036",costCardId:costId}, `vi-activate:${costId}`));
      responses(`ability-${number}`, "vi-resolve");
    }
  }
  if(k === "Action") {
    steps.push(player("read-action", "Two times you could play Cleave", "Read Cleave’s Action text. You could play it now in your open Main phase, but I’d wait until Rearguard’s attacking and you’ve got focus in the open showdown. An Action on its own can’t answer a spell already on the chain.", {type:"inspect",cardId:"player-OGN-004"}));
    steps.push(player("action-attack", "Move first, then use your spell", "Move Rearguard from base to Hopeful’s battlefield. That exhausts it and opens the fight, and with our 2 Might against their 4, this is why I kept Cleave in hand.", {type:"move",cardId:"player-OGN-010",destination:"battlefield-left"}, "action-attack"));
  }
  if (k === "Unique") {
    steps.push(player("inspect-copy", "Inspect the extra copy", "Select the spare Forgefire Cape and look for Unique. It’s an Ornn Signature, so our legend is fine, but Unique only lets us put one card with that name on the list.", { type: "inspect", cardId: "cape-second" }));
    steps.push(player("remove-copy", "Remove the duplicate", "Take the second Cape off the list before the game. That leaves 40 main-deck cards including the chosen champion, which means 39 to shuffle once you’ve set the champion aside.", native, "native"));
  } else if (k === "Hidden") {
    payment(0, 1, "hide");
    steps.push(player("hide", "Hide Hidden Blade", "Spend 1 power to hide Blade facedown at your battlefield. The energy you made stays available, and Blade stays hidden until a later turn when you can play it, so nothing dies now.", { type: "hide", cardId: "player-OGN-213", battlefieldId: "battlefield-left" }));
    steps.push(player("end-turn", "Wait until a later turn", "End your turn and leave Sentry where it is. Your unspent energy goes away as the turn ends, but the hidden Blade stays here ready for a later turn.", { type: "end-turn" }));
    steps.push(auto("ready", "The guide readies", "It’s the guide’s Awaken, so its sideways runes and unit turn upright, ready to pay for a spell or move in for an attack.", "ready-opponent", ["opponent:runes", "opponent:base"]));
    steps.push(auto("channel", "The guide channels", "The guide channels two more ready runes, which gives it more ways to pay for cards once it actually uses those runes.", "channel-opponent", ["opponent:rune-deck", "opponent:runes"]));
    steps.push(auto("draw", "The guide draws", "The guide draws a card and goes into Main. We hid Blade on our turn, so we can now play it if we get the right chance at this battlefield.", "draw-opponent", ["opponent:deck"]));
    steps.push({...auto("buff-energy","The guide pays to strengthen its attack","They’re exhausting two ready runes for 2 energy before they move, exactly what Discipline costs. There’s no power in that cost, so both runes stay on the table.","intro",["o-rune-1","o-rune-2"]),guideEffect:{type:"exhaust-runes",cardIds:["o-rune-1","o-rune-2"]}});
    steps.push({...auto("buff-play","Strengthen the unit before moving","They spend the 2 energy on Discipline and choose the Sentry that’s still in their base. Check its Might while the spell’s waiting on the chain, it’s still only 1.","intro",["opponent-OGN-058","opponent-OGN-096"]),guideEffect:{type:"play",cardId:"opponent-OGN-058",destination:"chain",targetId:"opponent-OGN-096"}});
    responses("buff","hidden-buff-resolve",true);
    steps.push(auto("attack", "The stronger Sentry attacks", "Discipline’s drawn them a card and their Sentry’s up to 3 Might, so now it exhausts to move in. Our 1-Might Sentry would die here if we just let the fight happen.", "hidden-attack", ["opponent-OGN-096", "battlefield-left"]));
    steps.push(auto("focus", "Your response window", "They’ve passed focus to us. Blade could target either Sentry here, and you could kill their attacker in a real game. For this example I’d like to see how many cards we can get from our own Sentry before we lose it.", "player-priority", ["player-OGN-213", "battlefield-left"]));
    steps.push(player("play", "Play your hidden response", "Play the facedown Blade and choose your own Sentry. You can skip Blade’s printed base cost because it’s Hidden, and killing our Sentry will draw two cards now and give us its Deathknell to resolve afterwards.", native, "native")); responses("hidden");
    steps.push(auto("deathknell", "Your Sentry’s Deathknell", "Sentry’s died, which triggers its Deathknell. Look on the chain for the draw it left behind, because both players can respond before we get that third card.", "deathknell-trigger", ["player-OGN-096","chain"])); responses("deathknell", "deathknell");
    steps.push(auto("hidden-finish-guide-pass","The guide passes focus","Blade and Deathknell have both finished, and playing Blade gave focus back to the guide. The guide passes, so we can decide whether we’ve got anything else to add before the battlefield is settled.","pass",["battlefield-left"]));
    steps.push(player("hidden-finish-pass","Finish the contested battlefield","Pass focus to finish the showdown. We’ve picked up three cards, but we’ve also lost the only unit we had here, so their Sentry’s going to take the battlefield.",{type:"pass"}));
    steps.push(auto("hidden-finish","The guide conquers","Their Sentry’s the only unit left, so the guide conquers for a point. We gave up this battlefield for three cards, which is worth remembering when you’re choosing between their attacker and your own Sentry.","hidden-conquer",["opponent-OGN-096","battlefield-left"]));
    const reset=player("other-reset","Reset: the attack goes elsewhere","Let’s try the other move from the same spot. We’re resetting to just after their Discipline resolved, with Blade still hidden on the left and our Sentry beside it. This time the guide will attack the other battlefield.",{type:"continue"},"hidden-other-reset");
    reset.presentation="lesson-intro";reset.label="Start the other-battlefield example";reset.lessonIntro={see:"Blade’s back on the left and their strengthened Sentry is in base again.",do:"Watch where they move this time, then look at who Blade can legally target.",why:"Where you hid Blade still matters even when the fight happens somewhere else."};steps.push(reset);
    steps.push({...auto("other-move","The guide chooses the other battlefield","The guide sends its 3-Might Sentry to the empty battlefield on the right. Blade is still on the left, so look for a legal target there before you try to respond.","intro",["opponent-OGN-096","battlefield-right"]),guideEffect:{type:"move",cardId:"opponent-OGN-096",destination:"battlefield-right"}});
    steps.push(auto("other-guide-pass","You may respond, but check the location","They’ve passed focus, so we could use Blade on our own Sentry on the left, but this time it’s safe. I’d keep Blade hidden, because it can’t reach their Sentry on the right.","pass",["battlefield-right","player-OGN-213"]));
    steps.push(player("other-pass","Keep the hidden response prepared","Pass focus and save Blade for a fight on its own battlefield. We could still choose our friendly Sentry there, but it’s in no danger from this attack.",{type:"pass"}));
    steps.push({...auto("other-score","The guide conquers the other battlefield","Both players passed, so their Sentry conquers the right battlefield and scores. Our Sentry still controls the left, and Blade stays facedown there for later.","intro",["battlefield-right"]),guideEffect:{type:"score",side:"opponent",battlefieldId:"battlefield-right"}});
  } else if (k === "Shield") {
    steps.push(player("end-turn", "Let the guide take its turn", "Leave Guardian here and end your turn. Its card shows 3 Might and that’s what it has while it’s waiting, so watch for when Shield actually takes it to 4.", { type: "end-turn" }));
    steps.push(auto("ready", "Awaken", "The guide readies its sideways cards in Awaken, including the unit that could move and the runes it could spend this turn.", "ready-opponent", ["opponent:runes", "opponent:base"]));
    steps.push(auto("channel", "Channel", "The guide channels two ready runes, so it’s got more runes to use, though it hasn’t made any energy just by channelling them.", "channel-opponent", ["opponent:rune-deck"]));
    steps.push(auto("draw", "Draw", "The guide draws a card from its main deck and reaches Main, where it can play cards or move its ready unit.", "draw-opponent", ["opponent:deck"]));
    steps.push(auto("attack", "A defender gains Shield", "They’ve moved their 3-Might Guardian in, so ours is the defender and Shield takes it to 4. That’s the difference between both Guardians dying and ours staying here.", "native", ["opponent-OGN-054", "player-OGN-054", "battlefield-left"]));
    steps.push(player("inspect", "Check Guardian’s Might", "Select your Guardian and compare its printed 3 with the 4 it’s got while defending. It’ll deal 4 damage and would need to take 4 to die, and the attacker’s only got 3 to give.", { type: "inspect", cardId: "player-OGN-054" }));
  } else if (k === "Tank" || k === "Backline") {
    steps.push({ ...auto("assign", "Watch the assignment", scenario.combatDemonstration!.explanation, "native", scenario.combatDemonstration!.sourceIds), combatDemonstration: scenario.combatDemonstration });
    steps.push(player("damage", "Deal damage together", "Check the counters, then resolve the damage. Those counters show where it’s going, and both sides deal it together, so a unit that dies in this exchange still gets its hit in.", { type: "resolve" }, "combat"));
    if (k === "Backline") {
      steps.push(auto("deathknell", "The Sentry’s Deathknell", "Their Sentry died, so its Deathknell goes on the chain once damage finishes. They’ll draw the card when that ability resolves, which gives you a chance to respond first.", "deathknell-trigger", ["opponent-OGN-096", "chain"])); responses("deathknell", "deathknell", true);
    }
  } else if (k === "Deathknell") {
    steps.push(auto("lethal", "Lethal damage", "Their Rearguard hits Sentry for 2, and our 1-Might Sentry deals 1 back at the same time. Two damage is lethal for a unit with only 1 Might, so look for where Sentry goes after the damage.", "deathknell-damage", ["player-OGN-096"]));
    steps.push(auto("dies", "The Sentry dies", "Sentry’s taken lethal damage and goes face up into the trash, the pile for used and defeated cards. Its Deathknell is now waiting on the chain, so we can still get its draw even though the unit’s already gone.", "deathknell-trigger", ["player-OGN-096", "chain"])); responses("deathknell", "deathknell");
  } else if (k === "Temporary") {
    steps.push(player("awaken", "Start Awaken", "You got through their turn with Sprite still on your battlefield, so ready your board in Awaken. Before you count that holding point, have a look at what Temporary’s going to do in Beginning.", { type: "ready" }, "temporary-awaken"));
    steps.push(auto("trigger", "Beginning: Temporary", "Beginning’s started and Sprite’s Temporary ability is on the chain. We have to deal with the instruction to kill Sprite before checking for holding, so wait to see what’s left on the battlefield.", "temporary-trigger", ["player-UNL-T07", "chain"])); responses("temporary");
    steps.push(player("empty-field", "Check who remains", "Select the battlefield and check who’s left to hold it. Sprite was a token made by an effect, so it stopped existing when it left the board, and with no unit here we lose control and miss the holding point.", { type: "inspect", cardId: "battlefield-left" }));
  } else {
    if (k === "Legion") {
      payment(2, 0, "first");
      steps.push(player("first-card", "Play the first card", "Spend 2 energy to play Rearguard into base, where it comes in exhausted. That was our first card this turn, so keep an eye on the energy cost the next time we look at Hopeful.", { type: "play", cardId: "player-OGN-010", destination: "base" }, "legion-first"));
      payment(2, 0, "second", [1, 2]);
    } else if (!["Ganking", "Assault", "Empowered", "Disarm", "Hunt"].includes(k)) payment(scenario.before.player.energy ?? 0, scenario.before.player.power ?? 0);
    const nativeAction = k === "Disarm" ? { type: "move", cardId: "player-RAD-050", destination: "battlefield-left" } as TutorialAction : native;
    const explanation: Record<string, string> = {
      Accelerate: "Choose Accelerate as you play Rearguard and pay 3 energy plus 1 Fury power altogether. It comes in ready, which means we can move it this turn. We can only buy that ready entry because this unit actually has Accelerate.",
      Ambush: "Play Inferna for 2 energy at the battlefield where your Sentry’s already fighting. Ambush lets it join in while their spell’s waiting, even though they control the battlefield. Inferna comes in sideways straight away and can still fight there.",
      "Quick-Draw": "Play Long Sword during the showdown with Quick-Draw, paying 2 energy and 1 Fury power. The sword goes into base straight away, then its separate ability can attach it to Sentry without another Equip payment.",
      Weaponmaster: "Play Armed Assailant into base for 6 energy and 1 Fury power. It comes in exhausted, but its Weaponmaster ability can give it the sword now, taking 1 power off the Equip cost, so it’ll be ready for the fight we want next turn.",
      Vision: "Pay 2 energy to play Mystic Poro into base, exhausted. Poro’s Vision triggers when you play it, so let that ability go on the chain first, then we’ll see what’s on top of the deck.",
      Equip: "Use Activate on the Long Sword already on the board, choose Rearguard and pay 1 Fury power for Equip. The energy you made stays available, and Rearguard gets the sword’s extra 2 Might once the Equip ability resolves.",
      Empower: "Activate Empower on Sandspinner. Its printed cost is 5 energy, but we’ve got four or fewer runes, so it costs us 3 less and we only pay 2. They still get to respond before Sandspinner becomes Empowered.",
      Repeat: "Play Blood Rush, pay the extra for Repeat and choose Rearguard both times. That’s 2 energy for one spell on the chain, and if it resolves we’ll get two lots of Assault 2 out of it.",
      Flow: "Open the trash and play Dredge Up for its 2-energy Flow cost. It’s our open Main phase, so the timing works, and when it resolves we’ll draw a card. Flow lets us play it from down here, but we’d still need Reaction to answer a waiting spell.",
      Deflect: "Play Hidden Blade on their Pouty Poro. We’ve got the 2 energy and 1 Order power for Blade plus the extra 1 power of any domain for Deflect, so we can choose Poro. It’s still on the board while the spell’s on the chain.",
      "Show Off": "Play Primordial Roar for 4 energy and 2 Body power, choose their Hopeful and show your own 4-Might Hopeful from hand. Roar now has the 4 damage it needs if it resolves, and you’re still holding the unit you showed.",
      Deploy: "Play Banner of Conquest at their battlefield for 1 energy and 1 Fury power. Deploy sends the gear to a battlefield, so base isn’t an option, and we still need to send a unit if we want to conquer there.",
      Level: "Play Scorchclaw for 3 energy and 1 Fury power. Check the 3 XP on your player counter, those experience points let it enter ready at 4 Might through Level 3, and you keep all three.",
      Hunt: "Your unit’s the only one left after the showdown, so take the point for conquering. Scorchclaw’s Hunt triggers from that score, which is why your game point comes first and the XP follows.",
      Disarm: "Move your ready Chronomancer from base to Hopeful’s battlefield. It turns sideways to attack, and that’s what triggers Disarm, giving us a chance to cut Hopeful’s Might before the two units hit each other.",
    };
    steps.push(player("native", scenario.actionLabel, explanation[k] ?? scenario.instruction, nativeAction, "native"));
    if (["Vision", "Quick-Draw", "Weaponmaster", "Hunt", "Disarm"].includes(k)) steps.push(auto("trigger", `${k}: its event has happened`, k === "Hunt" ? "Conquering triggered Scorchclaw’s Hunt 2, so look for the ability on the chain. It gives you 2 XP once it resolves, after both players have had their chance to respond." : k === "Vision" ? "Playing Mystic Poro triggered Vision, so you’ll see its ability on the chain. When it resolves you get to Predict, which means a private look at the top card and a choice of keeping it there or putting it on the bottom." : k === "Disarm" ? "Attacking triggered Chronomancer’s Disarm 2, so the ability’s waiting on the chain with Hopeful as its target. Hopeful still has its full Might until the ability resolves." : k === "Quick-Draw" ? "Long Sword’s already in play, and its Quick-Draw attachment ability is now on the chain with Sentry as the target. The attachment is required and costs nothing extra, but the guide still gets a chance to respond before Sentry gets the sword." : "Assailant’s Weaponmaster ability offers to attach the sword, and taking 1 power off its Equip cost brings it down to zero. I’d take that for the extra 2 Might, though the guide can still respond before the attachment resolves.", "trigger", ["chain"]));
    if (["Action", "Reaction", "Deflect", "Disarm", "Vision", "Equip", "Quick-Draw", "Weaponmaster", "Hunt", "Empower", "Repeat", "Flow", "Show Off"].includes(k)) responses("effect");
    if (k === "Vision") {
      steps.push(player("inspect-top", "Inspect the top card", "Have a look at Sentry on top of your main deck. This is just your private look from Predict, so the guide can’t see the card, it hasn’t moved and it isn’t in your hand yet.", { type: "inspect", cardId: "player-OGN-096" }));
      steps.push(player("predict", "Choose to recycle", "We already have a small unit, so I’d choose Recycle to bottom for this Sentry and give ourselves a chance to draw something bigger. Leaving it on top would also be legal, and neither choice reveals it to the guide.", { type: "predict", cardId: "player-OGN-096", choice: "recycle" }, "predict"));
    }
    if (k === "Reaction") {
      steps.push(player("read-drawn-defy", "Your draw gives you another choice", "Select the Defy we drew from Discipline and check its Counter text. Cleave still fits the cost limit and it’s still waiting, so we could pass, but I’d like to try using the card we’ve just drawn.", {type:"inspect",cardId:"player-OGN-045"}));
      steps.push(auto("counter-window", "The guide offers another response window", "Cleave is back on top of the chain and the guide, who controls it, passes priority to us. We’ve got a fresh chance to play a Reaction before Cleave gives the attacker any Might.", "opponent-pass", ["chain","player-OGN-045"]));
      steps.push(player("counter-energy", "Prepare Defy’s energy", "Exhaust this ready Calm rune for 1 energy first. We want 1 energy and 1 Calm power for the Defy we just drew, and this one rune can help with both.", {type:"exhaust",cardId:"p-rune-3"}));
      steps.push(player("counter-power", "Prepare Defy’s matching power", "Open the same sideways Calm rune’s menu and choose Recycle for 1 Calm power. The rune goes to the bottom of its deck and we keep its energy, so we can pay both parts of Defy now.", {type:"recycle",cardId:"p-rune-3"}));
      steps.push(player("counter-play", "Respond to the original spell", "Play Defy for 1 energy and 1 Calm power and choose Cleave on the chain. Cleave fits the limit of up to 4 printed energy and 1 printed power, so Defy can counter it when it resolves. The guide can still answer Defy before that happens.", {type:"play",cardId:"player-OGN-045",targetId:"opponent-OGN-004"}, "counter-play"));
      responses("counter", "counter-resolve");
    }
    if (k === "Ambush") responses("older", "older", true);
    if (["Ganking", "Assault", "Empowered"].includes(k)) steps.push(player("inspect-result", "Read the new position", k === "Ganking" ? "Select Vi at her new battlefield and look at which way up she is. Ganking let her skip the trip through base, but she’s sideways because that move still cost her readiness and needed a normal chance to move." : "Select your attacker and compare its printed Might with the number showing now. Assault is already helping it hit harder and survive a bigger hit back, even though neither unit has dealt damage yet.", { type: "inspect", cardId: (native as {cardId:string}).cardId }));
  }
  const follow=scenario.followThrough;
  if(follow?.waitForNextTurn){
    steps.push(player("develop-end","End your development turn","End the turn with the sword attached. Assailant came in sideways, so we’ll have to wait for our next Awaken before we can send it into the fight.",{type:"end-turn"}));
    steps.push(auto("develop-guide-ready","The guide readies","The guide readies its sideways cards in Awaken, including the unit that could move and the runes it could spend this turn.","ready-opponent",["opponent:runes"]));
    steps.push(auto("develop-guide-channel","The guide channels","The guide channels two more ready runes, while our Assailant and its attached sword stay where we left them.","channel-opponent",["opponent:rune-deck"]));
    steps.push(auto("develop-guide-draw","The guide draws","The guide draws a card and chooses to leave our Assailant alone this turn, so it’ll still have the sword when we get another chance to move.","draw-opponent",["opponent:deck"]));
    steps.push(auto("develop-guide-end","The guide ends its turn","The guide’s finished its turn and our Assailant still has Long Sword attached. It’s sideways for now, but our Awaken comes next and we won’t have to pay Equip again.","next-player-turn",["player:base"]));
    steps.push(player("develop-awaken","Ready your equipped unit","Choose Ready all in Awaken. Assailant’s upright again and still has the extra 2 Might from the sword, so it’ll be able to move when we get to Main.",{type:"ready"},"ready-player"));
    steps.push(auto("develop-beginning","Beginning","Check for holding in Beginning. Assailant’s still in base, so there’s no point from it here, and we can get on with preparing our turn.","begin-player",["battlefield-left"]));
    steps.push(auto("develop-channel","Channel","Channel two ready runes from your rune deck. They’ll be there if we need resources, and Assailant’s still ready to attack once we reach Main.","channel-player",["player:rune-deck"]));
    steps.push(player("develop-draw","Draw for your turn","Draw a card by selecting your main deck or pressing D. That takes us into Main, where we can finally move Assailant with the sword we attached last turn.",{type:"draw"},"draw-player"));
  }
  if(follow?.move){
    const movement:Record<string,string>={Accelerate:"Move Rearguard from base to the empty battlefield. The extra energy and Fury power we paid for Accelerate are what let it arrive ready, so we can go for a point on the same turn we played it.",Equip:"Move your Rearguard over to theirs, taking the sword with you. Yours exhausts to move, but it keeps the extra Might, so now we’ve got a 4-Might attacker against their 2-Might defender.",Weaponmaster:"Send Assailant in against their Assailant. Ours readied in Awaken and still has the sword, so the attachment we made last turn gives us 8 Might to their 6.",Empower:"Move Sandspinner in now that Empower’s resolved. Watch its Might change as it starts attacking, because its Assault 2 takes it from 6 to 8 against their 6-Might defender.",Level:"Move Scorchclaw from base to the empty battlefield. It’ll exhaust for the move, but because you had the XP for Level 3 it was ready to do this the same turn you played it.",Deploy:"Move your ready Hopeful to the battlefield where you put the Banner. The two Hopefuls both started at 4 Might, but the Banner gives ours Assault 1 when it attacks there."};
    steps.push(player("use-move","Use the new opportunity",movement[k],{type:"move",...follow.move},"follow-move"));
  }
  if(follow?.combat){
    const guideHasFocus=["Action","Quick-Draw","Repeat"].includes(k);
    if(guideHasFocus)steps.push(auto("finish-guide-pass","The guide gets the next chance","The card you played has finished and playing it gave focus back to the guide, who passes. You’ll get one more decision before these units deal damage.","pass",["chain"]));
    steps.push(player("finish-pass","Let the fight reach damage",guideHasFocus?`The guide’s passed and there’s nothing waiting on the chain. We’ve got what we wanted from ${k}, so pass focus too and let the fight go to damage.`:`Pass focus if you’re happy to fight at the numbers you see. The guide still gets a chance to make a play before you find out what ${k} does for the combat result.`,{type:"pass"}));
    if(!guideHasFocus)steps.push(auto("finish-guide-pass","The guide lets the fight continue",`The guide passes as well, so the showdown’s finished. Use the units’ current Might for damage, including the change you just saw from ${k}.`,"pass",["chain"]));
    const unitName=(id:string)=>[...scenario.before.cards,...scenario.after.cards].find(c=>c.instanceId===id)?.name??"the chosen unit";
    const damagePlan=[...follow.combat.targetAssignments.map(a=>`${a.amount} to the guide’s ${unitName(a.cardId)}`),...(follow.combat.returnAssignments??[]).map(a=>`${a.amount} back to your ${unitName(a.cardId)}`)].join("; ");
    steps.push({...auto("finish-assign","Plan the damage before dealing it",`Here’s where the damage will go, ${damagePlan}. Check the assignments on the units before you deal it, because both sides hit at the same time.`,"follow-assign",follow.combat.sourceIds),combatDemonstration:follow.combat});
    steps.push(player("finish-damage","Deal both sides’ damage",`Resolve the combat damage, ${damagePlan}. Both sides deal it together, so anything that dies still deals the damage it assigned.`,{type:"resolve"},"follow-damage"));
    steps.push(auto("finish-cleanup","Check who survives the exchange","Compare each unit’s marked damage with its current Might. Damage equal to or above that Might kills it, then you clear damage on the survivors. Keep the attacking and defending bonuses for now, because the battlefield still has to be settled.","follow-cleanup",[...follow.combat.targetAssignments,...follow.combat.returnAssignments??[]].map(a=>a.cardId)));
    for(const [index,dead] of (follow.deathknells??[]).entries()){
      steps.push(auto(`finish-deathknell-${index}`,"The defeated Sentry still has an ability","The Sentry that died has triggered Deathknell, so its controller gets a draw ability on the chain. That draw comes after the fight’s damage, once both players have had a chance to respond to the ability.",`trigger-death:${dead}`,[dead,"chain"]));
      responses(`finish-deathknell-${index}`,"deathknell",dead.startsWith("opponent"));
    }
  }
  if(follow?.conquer){
    if(!follow.combat&&k!=="Backline"){
      steps.push(player("conquer-pass","Give the guide a chance before scoring",`You got a unit to the empty battlefield with ${k}, but arriving starts a showdown. Pass focus to give them their chance to play something before you claim the point.`,{type:"pass"}));
      steps.push(auto("conquer-guide-pass","The guide leaves your unit alone","The guide leaves the move alone and passes, so the showdown’s finished. Your unit is the only one here, which means you can now conquer and score.","pass",[follow.conquer]));
    }
    steps.push(player("finish-score","Turn the surviving unit into a point",follow.combat||k==="Backline"?"You’ve got a surviving unit and they’ve got nobody left here, so take 1 point for conquering. Keep the attack and defence bonuses through conquering and any resulting chain, then remove them when combat ends.":"You’ve both passed and your unit has this battlefield to itself, so record 1 point for conquering. Getting here was the first part, finishing the showdown is what let you take control and score.",{type:"score"},`score:${follow.conquer}`));
    if(k==="Level"){
      steps.push(auto("finish-hunt","Scoring starts another reward","Conquering with Scorchclaw triggered Hunt 2. You still have all 3 XP you qualified for Level with, so let both players respond to Hunt before adding another 2 XP.","level-hunt",["player-UNL-016","chain"]));responses("finish-hunt","gain-hunt");
    }
  }
  if(k==="Vision"){
    steps.push(player("vision-end","Keep the better next draw","End your turn and let’s see what we actually draw next time. Predict changed the top of your main deck earlier, but it didn’t put a card into your hand.",{type:"end-turn"}));
    steps.push(auto("vision-ready","The guide readies","The guide readies its sideways cards in Awaken, including the unit that could move and the runes it could spend this turn.","ready-opponent",["opponent:runes"]));
    steps.push(auto("vision-channel","The guide channels","The guide channels two ready runes from its rune deck, while the card you chose to recycle stays at the bottom of your main deck.","channel-opponent",["opponent:rune-deck"]));
    steps.push(auto("vision-draw","The guide draws","The guide takes its normal draw and makes no further plays, so the top of your deck stays as you left it.","draw-opponent",["opponent:deck"]));
    steps.push(auto("vision-next","Your next turn","The guide ends its turn, so it’s back to us. The Sentry we saw is on the bottom now, and after our usual turn-start steps we’ll find out what was underneath it.","next-player-turn",["player:deck"]));
    steps.push(auto("vision-awaken","Awaken","Ready your sideways cards in Awaken. Poro’s upright again, but Vision triggered when you played it and readying it won’t trigger another look.","ready-player",["player:base"]));
    steps.push(auto("vision-begin","Beginning","Check Beginning before we go on. We’ve got no battlefield to hold and no Beginning ability waiting, so neither player gains a point here.","begin-player",["battlefield-left"]));
    steps.push(auto("vision-player-channel","Channel","Channel two ready runes from your rune deck. Those can help with whatever you draw, but your next card comes from your main deck.","channel-player",["player:rune-deck"]));
    steps.push(player("vision-next-draw","Draw the card you reached","Select your main deck or press D to draw Mysterious Chronomancer, the card that was underneath Sentry. That’s the bigger attacker we were hoping for, though you’ve still got to pay its cost when you want to play it.",{type:"draw"},"vision-draw"));
  }
  steps.push({ ...player("outcome", `${k}: what changed`, scenario.explanation, { type: "continue" }, "finish"), label: "Continue to the next example" });
  return steps;
}

function keywordLesson(group: KeywordScenarioGroup, index: number): TutorialLesson {
  const steps = group.scenarioIds.flatMap((id): TutorialStep[] => {
    const scenario = NEW_PLAYER_KEYWORD_SCENARIOS.find((item) => item.id === id);
    if (!scenario) throw new Error(`Missing keyword practice: ${id}`);
    return keywordSequence(scenario);
  });
  return lesson(group.id, `${16 + index}. ${group.title}`, group.description, Math.ceil(steps.length * 0.32), "Keyword practice", steps,
    "Each example sets up a fresh position on the Atlas table, with the legend, champion and cards for that play. Your main Ahri game will still be where you left it when you go back.", "Practice");
}

const LESSON_INTROS: Record<string, TutorialLessonIntro> = {
  "table-setup": { see: "There’s nothing on the table yet, so this is a good time to work out where everything goes.", do: "Set out your legend, chosen champion, battlefield and both decks with me.", why: "Once we’ve got our side set up, it’s easier to see where a unit starts and where it needs to go to score." },
  "opening-hand": { see: "You’ve drawn two Watchful Sentries, Discipline and an extra copy of Ahri.", do: "Have a look at what Sentry and Ahri cost, then try swapping the Ahri in your hand.", why: "You’re going first, so the question I’d ask is, what can I actually play with my first two runes?" },
  "first-or-second": { see: "You’ve kept your opening hand, but you haven’t got any runes on the table yet.", do: "Go through Awaken, Beginning, Channel and Draw, then we can get on with playing cards in Main.", why: "By the time you can make your first play, you’ll have runes to pay for it and one more card to choose from." },
  "read-a-card": { see: "You’ve got Watchful Sentry, a rune and a spell called Discipline to look at.", do: "Select each one and see where to find its cost, its Might if it’s a unit, and when you can use it.", why: "You can save yourself a lot of guessing just by knowing where to look on the card." },
  "play-first-unit": { see: "You’ve got two ready runes and a Sentry in hand that costs 2 energy.", do: "Make the energy, play Sentry into base, then see what I do on my turn.", why: "Sentry enters exhausted, so I’d get it down now if you want it out fighting for a point next turn." },
  "power-and-champion": { see: "It’s your turn again and your chosen Ahri is waiting in the champion zone.", do: "Make 3 energy and 1 Mind power, then spend both to play her.", why: "Look at what a Mind rune can do before you recycle it, because you can get energy and matching power from the same rune." },
  "move-to-battlefield": { see: "Sentry’s ready in base and there’s an empty battlefield you could send it to.", do: "Move Sentry out, then see who gets a chance to play something before it can conquer.", why: "You could leave Sentry in base, but it can only earn you a point if it gets to a battlefield." },
  "first-conquest": { see: "Sentry’s at an empty battlefield, but your score hasn’t moved yet.", do: "Pass focus and give me a chance to respond, then record your first point.", why: "You take control after the showdown finishes, so we both have a chance to affect who ends up there." },
  "holding": { see: "Sentry’s still at Monastery, which you now control.", do: "Hold it through my turn, score at Beginning, then play your second Sentry there.", why: "Leaving a unit to defend what you’ve already taken can earn you another point, even if you never move it." },
  "start-combat": { see: "Ahri’s ready in base, but my Sentry’s already defending the right battlefield.", do: "Move Ahri in, see what her attack ability does, then compare the two units.", why: "The numbers you started with can change before anybody deals damage, especially if an attack triggers an ability." },
  "the-chain": { see: "Ahri’s attacking Sentry, and I’ve got a spell that could make my defender stronger.", do: "Play a response of your own, then resolve the two spells starting with the newest.", why: "You can see what I’m trying to do before you decide whether to spend your own spell." },
  "countering-spells": { see: "In this separate fight, Rune Prison’s about to stop your Sentry dealing damage.", do: "Make the resources for Defy and choose the spell you want to counter.", why: "If you wait until Rune Prison has already stunned Sentry, there’s nothing left on the chain for Defy to stop." },
  "combat-damage": { see: "We’re back in Ahri’s fight, she’s on 5 Might and my defender’s on 3.", do: "Finish the responses, assign damage, then see who survives when both sides deal it together.", why: "To see who gets the point, I’d work out who’ll still be standing at the battlefield after damage." },
  "hidden-cards": { see: "Try Sett for this example, with Hidden Blade in hand and a battlefield you control.", do: "Hide Blade, try answering an attack here, then see what changes if I go elsewhere or you leave.", why: "Having a hidden card ready is only useful if you can keep it there and it can reach the unit you want." },
  "keywords-in-combat": { see: "Sett’s attacking alongside a little Poro, and there are two defenders to get past.", do: "Look at Assault and Tank before you decide where each side’s damage has to go.", why: "If you only look at the printed Might, you’ll miss what makes Poro hit harder and what keeps it alive." },
  "keyword-timing": { see: "We’ve set up two fights with spells you might want to play at different times.", do: "Try an Action in an open showdown, then a Reaction while another spell is waiting.", why: "Knowing when you can put your spell on the chain gives you time to change a fight before damage." },
  "keyword-combat": { see: "We’ll look at arriving ready, joining a fight, and what happens when units deal damage or die.", do: "Try Accelerate, Ambush, Assault, Backline and Deathknell with the cards that actually use them.", why: "Look at which unit gets into the fight, which one takes damage first and whether a unit can still do something when it dies." },
  "keyword-surprises": { see: "These five boards give us different costs to pay, gear to place and abilities to turn on.", do: "Try Deflect, Deploy, Disarm, Empower and Empowered, checking what each card asks you to do.", why: "It’s worth checking what a play will really cost before you count on that spell or ability to get you out of trouble." },
  "keyword-equipment": { see: "You’ll see gear on the board, a card in the trash and units trying to reach different battlefields.", do: "Try Equip, Flow, Ganking, Hidden and Hunt, and follow what actually happens to the card each time.", why: "Sometimes a keyword gives you a play you wouldn’t normally have, like going straight from one battlefield to the other." },
  "keyword-growth": { see: "We’ll try five hands where the order of your plays or the side you’re fighting on matters.", do: "Try Legion, Level, Quick-Draw, Repeat and Shield, then check what each one did to your play.", why: "It’s worth asking what you’ve already done this turn before paying for a card, because that can change what you get." },
  "keyword-new-tools": { see: "We’ll reveal a card, protect an ally, lose a Temporary unit and check a few things before the next draw.", do: "Try Show Off, Tank, Temporary, Unique, Vision and Weaponmaster in their own examples.", why: "Watch which card moves, what stays on the board and which choices you actually get once the ability happens." },
  "win-the-game": { see: "You’re on 7 points with two empty battlefields, then we’ll try a separate position where you already hold Monastery.", do: "First try scoring both battlefields in one turn, then go back and win by holding at Beginning.", why: "Conquering at 7 has an extra condition, so I’d look for a holding point if I already had a battlefield I could defend." }
};

export const LESSONS: TutorialLesson[] = [
  lesson("table-setup", "1. Build your board", "Set up your side of the table with me, then we’ll draw our opening hands.", 6, "Set up", [
    { ...continueStep("what-we-are-playing", "We’re trying to reach eight points, and we’ll earn them by conquering and holding battlefields. Before we start chasing points, let’s get your side of the table set up."), title: "Let’s start with an empty table", label: "Find my side of the table" },
    inspect("player:base", "This is your base", "Select your base, the space on your side where you can play a unit before you send it out to fight for a battlefield."),
    inspect("player:hand", "This is your hand", "Select your hand. It’s empty at the moment, but when you draw your opening cards this is where they’ll go, and only you get to see what they are."),
    inspect("player:trash", "This is your trash", "Select your trash. If a unit dies or a spell finishes doing its job, this is usually where you’ll find it, face up so either player can read it."),
    step("place-legend", "Your legend leads the deck", "Drag Ahri to your legend space while I place my legend. She’ll stay here and give you an ability, and those Calm and Mind symbols are her domains, the groups of cards you can use in her deck.", { type: "setup", item: "legend", cardId: "p-legend", destination: "legend" }, "Place your legend"),
    step("place-champion", "Your champion can join the fight", "This Ahri is the one we can actually play as a unit. Drag her to the champion space and I’ll set mine aside too, so we can each play our chosen champion later without having to draw it. We’ll still have to pay for it.", { type: "setup", item: "champion", cardId: "p-champion", destination: "champion" }, "Place your chosen champion"),
    step("choose-battlefield", "Battlefields are where you score", "We’ve each brought three battlefields for our best-of-three match, and we’ll choose one each for this game. Drag Monastery of Hirana to the left, that’s one of the places our units can fight for a point.", { type: "setup", item: "battlefields", cardId: "OGN-282", destination: "battlefield-left" }, "Place Monastery of Hirana"),
    inspect("battlefield-right", "Both battlefields are shared", "We reveal our choices together, and mine is Rockfall Path. You can fight for Rockfall just as you can for Monastery, even though I brought it. Select it and have a look at its rule, it’ll matter when we send a unit there later."),
    step("place-main-deck", "Your main deck holds your cards", "Your main deck holds your units, your spells and your gear. Units can fight, spells do what’s written on them, and gear sticks around to help. We’ve taken our chosen Ahri out of the 40, so shuffle the other 39 and drag them to Main Deck.", { type: "setup", item: "main-deck", destination: "deck" }, "Place your main deck"),
    step("place-rune-deck", "Runes help pay for cards", "Your 12 runes have their own deck, so you can get the resources to play your cards without having to draw a rune from your main deck. Shuffle the runes and drag them to Rune Deck.", { type: "setup", item: "rune-deck", destination: "rune-deck" }, "Place your rune deck"),
    step("choose-first", "Choose who takes the first turn", "In game one we agree on a random way to decide who gets the choice, and this time you’ve won it. Choose to go first, so we get the first chance to put a unit on the table.", { type: "setup", item: "turn-order", choice: "first" }, "Choose to go first", "You can choose either seat at a real table. Go first here and we’ll see what we can do with that opening play."),
    step("draw-opening", "Draw four cards", "Draw the top four cards of your main deck into your hand, and I’ll draw my four too. That’s your opening hand. I can see how many cards you’ve got, but only you can look at their faces.", { type: "setup", item: "opening-hand" }, "Draw four cards"),
    continueStep("table-ready", "Your legend’s in place, Ahri’s waiting in the champion zone, and you’ve got four cards in hand. Now we can have a look at those four and decide what we’d actually like to keep.")
  ], "We’re setting up game one of a best-of-three (BO3) match, so the first player to win two games wins the match. In best-of-one (BO1), this first game decides it. Atlas usually sets up the table for you, but we’ll do it ourselves so you know where to find everything."),
  lesson("opening-hand", "2. Choose what to keep", "Look through your opening four with me and see which card you’d send back before turn one.", 3, "Set up", [
    { ...continueStep("what-is-a-mulligan", "If you’re happy with your opening four, you can keep them all. If there’s a card or two you’d rather swap, you get one chance before the game starts to set them aside and draw the same number back. That’s a mulligan."), title: "What is a mulligan?", label: "Look at my hand", presentation: "mulligan-intro" },
    inspect("p-sentry", "What can we play on turn one?", "Have a look at the 2 in the top left of Watchful Sentry, that’s how much energy it costs to play. I’d keep Sentry here, because our first two runes can give us 1 energy each, so we’ve already got a unit we can play on turn one."),
    inspect("p-opening-ahri", "Would you keep this Ahri?", "Now look at the Ahri in your hand. She costs 3 energy and 1 Mind power, so even if we use both runes for energy, we’re still one short. We’ve already got an Ahri in the champion zone for later, so I’d send this copy back."),
    step("mulligan-one", "Send the extra Ahri back", "Select the Ahri in your hand, then choose Replace 1 card. At the table you’d set her aside, draw your replacement, then recycle Ahri to the bottom of your main deck, so you can’t draw that same copy straight back.", { type: "mulligan", cardIds: ["p-opening-ahri"] }, "Replace 1 card"),
    inspect("p-replacement", "What did we draw?", "Have a look at the card we drew, it’s another Watchful Sentry. That gives us three of them, which is probably more than we wanted, but you only get the one mulligan. We’ve still got four cards, we haven’t spent any energy or power, and nothing went in the trash. Our opponent goes next and keeps all four."),
    continueStep("mulligan-plan", "Next time you draw your opening four, the first thing I’d ask is, what am I actually playing on turn one? If I’ve already got a play I like, I’m happy to hang on to something more expensive for later. It was having another Ahri in the champion zone that made this one easy to send back.", "Would you always send Ahri back?")
  ]),
  lesson("first-or-second", "3. First turn, first runes", "You’re going first, so what do you get, and what will the other player get on their turn?", 3, "First turns", [
    { ...continueStep("turn-start-overview", "We’ve got our hand, so we can start our turn. I remember the order as ABCD, Awaken, Beginning, Channel and Draw, then we’re into Main and we can play cards or move units. Atlas often does those first steps for you, so let’s walk through them once ourselves."), title: "Remember ABCD", label: "Start my first turn", presentation: "turn-start" },
    step("awaken", "A is for Awaken", "Choose Awaken. This is where you turn your exhausted cards upright, or ready them, so you can use them again. Nothing’s sideways on this first turn, but we still go through Awaken.", { type: "ready" }, "Ready your board"),
    continueStep("beginning", "At Beginning we check for abilities that happen now, and whether we’re holding a battlefield we still control. Our units haven’t even left our hand yet, so there’s no point to score this time.", "B is for Beginning"),
    step("channel-two", "C is for Channel", "Channel your first two runes from the rune deck, using Channel ready runes or Ctrl+left-click on the deck. They come out ready, so we can use both when it’s time to pay for a card.", { type: "channel", ready: true }, "Channel 2 runes", "Choose Channel ready runes, or hold Ctrl while you left-click it, to bring out two ready runes."),
    inspect("p-rune-1", "Why does going second give more?", "Look at one of your runes. You get two because you’re going first, and I’ll get three on my first turn to help me catch up. It’s only that first turn that’s different, after that we both channel two."),
    step("draw-first", "D is for Draw", "Draw a card from your main deck, either by selecting the deck or pressing D. We both draw on our first turn in a two-player game, so this one goes into your hand and we’re ready for Main.", { type: "draw" }, "Draw 1")
  ]),
  lesson("read-a-card", "4. Read the card", "Have a look at Sentry, a rune and Discipline, and see what you’d use each one for.", 2, "First turns", [
    inspect("p-sentry", "The number is its energy cost", "Select Watchful Sentry and look at the 2 in the top left, that’s the energy we need to play it. It’s a unit, so once it’s on the table we’ll be able to move it and fight with it."),
    inspect("p-rune-1", "A rune makes energy", "This rune’s upright, which means it’s ready. We can tap it, turning it sideways for 1 energy, and we can use any basic rune for that number on Sentry, whatever domain symbol the rune has."),
    { ...inspect("p-sentry", "Might tells you how it fights", "Sentry’s got 1 Might, so it deals 1 combat damage, and just 1 damage is enough to kill it. There’s a bit of value in it dying though, its Deathknell lets us draw a card."), id: "inspect-sentry-might" },
    inspect("p-discipline-2", "Spells do a different job", "Have a look at Discipline. It’s a spell that makes a unit stronger and draws us a card, and Reaction means we can play it in response to something. I’d hang on to it for now, we need a unit on the table to help first.")
  ]),
  lesson("play-first-unit", "5. Play your first unit", "Put Sentry into your base, ready to fight for a point on a later turn.", 2, "First turns", [
    exhaust(1), exhaust(2),
    step("play-sentry", "Spend your energy on a unit", "We’ve got the 2 energy Sentry needs, so play it from your hand into your base. That uses all our energy, and Sentry comes in sideways, so we’ll have to ready it before it can make a normal move.", { type: "play", cardId: "p-sentry", destination: "base" }, "Play Watchful Sentry"),
    continueStep("where-units-can-start", "Why did we put Sentry in base? A unit can normally go in your base or straight onto a battlefield you control, and we haven’t taken either battlefield yet. Once we’ve got one, we’ll try playing a unit there."),
    step("end-first", "Give the opponent a turn", "That’s our first unit down, so choose End turn or press Space. I’ll take you through my turn, then you’ll get to ready those sideways cards when your turn comes round again.", { type: "end-turn" }, "End turn"),
    continueStep("exhausted-exceptions", "See how Sentry came in exhausted? That’s how units normally enter, so we’ll have to wait for it to ready before we can move it. Some cards have text that changes that, but Sentry doesn’t.")
  ]),
  lesson("power-and-champion", "6. Power and your champion", "We need energy and Mind power for Ahri, and the same rune can help us pay for both.", 3, "First turns", [
    inspect("p-champion", "Ahri has two kinds of cost", "Have a look at Ahri’s cost, there’s a 3 for energy and a Mind symbol for 1 Mind power. We’ll need both to play her. If you’re looking for how hard she fights, that’s her Might, a different number."),
    exhaust(1, "pay Ahri’s 3-energy number cost"), exhaust(2, "pay Ahri’s 3-energy number cost"), exhaust(3, "pay Ahri’s 3-energy number cost"),
    continueStep("why-recycle", "We’ve got the 3 energy, so what’s missing? There’s still a Mind symbol to pay for, and we can get that power by recycling a Mind rune. A Calm rune would give us Calm power, which won’t cover Ahri’s Mind symbol.", "Why Ahri still needs Mind power"),
    step("recycle-mind", "Recycle the Mind rune", "Select that same exhausted Mind rune and choose Recycle, or right-click it to use its recycle ability. It goes to the bottom of the rune deck and gives us 1 Mind power, and we still have the 3 energy we made earlier.", { type: "recycle", cardId: "p-rune-3" }, "Recycle Mind rune"),
    continueStep("recycle-tradeoff", "We’ve got everything Ahri costs, but have a look at where that Mind rune went. It’s on the bottom of the rune deck, so next turn it won’t be there to ready with the others. We can get it back when we channel it again.", "What you paid for power"),
    step("play-champion", "Pay both costs and play Ahri", "Play Ahri from your champion space to your base, paying the 3 energy and 1 Mind power. She enters exhausted just like Sentry, and her space stays empty now we’ve played her.", { type: "play", cardId: "p-champion", destination: "base" }, "Play Ahri")
  ]),
  lesson("move-to-battlefield", "7. Move onto the battlefield", "Your Sentry is ready, so let’s give it somewhere to go.", 2, "Score points", [
    inspect("p-sentry", "A unit ready to leave base", "Select your Sentry, it’s upright and ready for a normal move. We can turn it sideways to move from base to either battlefield, or from a battlefield back to base. If we want a point, we need to get it out of base."),
    step("move-sentry", "Move towards your first point", "Move Sentry from your base to the empty battlefield on the left. We’d like to conquer it for a point, but arriving opens a showdown, so we both get a chance to do something about that first.", { type: "move", cardId: "p-sentry", destination: "battlefield-left" }, "Move to left battlefield"),
    continueStep("showdown-open", "Sentry’s there, so why hasn’t the score changed? Even at an empty battlefield I still get a chance to stop you. We’ll finish the showdown next and see whether Sentry gets the point.")
  ]),
  lesson("first-conquest", "8. Conquer your first battlefield", "Sentry’s at Monastery, let’s finish the showdown and see who gets the point.", 2, "Score points", [
    pass("empty-showdown"),
    score("first-point", "We’ve both passed, and your Sentry’s the only unit at Monastery, so you take control of it. That’s what it means to conquer a battlefield, and you can record your first point towards eight."),
    continueStep("battlefield-ability", "Monastery says you may spend a buff when you conquer here to draw a card. A buff is a +1 Might marker, and Sentry hasn’t got one, so we’ll leave the extra draw. We’ve already earned the point.")
  ]),
  lesson("holding", "9. Hold and reinforce", "Keep hold of Monastery through my turn, then give Sentry some help.", 3, "Score points", [
    step("pass-turn", "Leave your Sentry on the battlefield", "Leave Sentry at the left battlefield and end your turn. If it’s still yours when your next turn comes round, you can earn another point for holding it during Beginning.", { type: "end-turn" }, "End turn"),
    step("ready-held", "Ready without leaving the battlefield", "Choose Ready all for Awaken. Sentry turns upright with your other cards, and because it’s still standing at Monastery we can check for a holding point next.", { type: "ready" }, "Ready your board"),
    score("hold-point", "You held on to Monastery through my turn, so record 1 point for holding it in Beginning. That’s your score for this battlefield this turn, even if you leave and conquer it again, because each player can only score each battlefield once per turn."),
    step("channel-next", "Bring out more resources", "Channel two ready runes from your rune deck, using Channel ready runes or Ctrl+left-click. You can use those to pay for more cards now, and the extra rune for going second only applied on the second player’s first turn.", { type: "channel", ready: true }, "Channel 2 runes"),
    step("draw-next", "Add another choice to your hand", "Select your main deck or press D to draw a card. It’s in your hand now, so we still need to play it and pay for it if we want to use it. Once we reach Main, I’d like to put another defender at Monastery.", { type: "draw" }, "Draw 1"),
    exhaust(5, "add another Sentry directly to your battlefield"), exhaust(6, "add another Sentry directly to your battlefield"),
    step("reinforce-field", "Add another defender", "Spend 2 energy to play your second Sentry from hand straight onto Monastery, because you already control it. Sentry is exhausted, can it still defend? It can, and it’s already where we need it if I attack. Adding it hasn’t earned us another point.", { type: "play", cardId: "p-sentry-2", destination: "battlefield-left" }, "Play Sentry onto Monastery", "Choose Monastery as the destination. It’s your open Main phase, so you can play Sentry straight onto a battlefield you control unless the card says otherwise, as Rockfall Path does."),
    continueStep("controlled-play", "Your second Sentry entered exhausted, just like the one you played in base. You played this one straight onto a battlefield you already controlled, so nobody moved or attacked and there’s no combat to resolve.")
  ]),
  lesson("start-combat", "10. Challenge a defender", "Ahri’s ready to attack Rockfall Path, but there’s a Sentry we’ll have to get past.", 3, "Battle and react", [
    inspect("o-sentry", "The unit guarding this battlefield", "We’re a little further into the game now. Look at my Sentry on the right battlefield, that’s the defender Ahri has to get past if she’s going to take Rockfall Path from me."),
    step("attack", "Send Ahri into the fight", "Move Ahri from base to Rockfall Path. Rockfall stops us playing a unit straight onto it, but Ahri’s already on the table so she can move there. Movement triggers would finish first if we had any, then combat opens and her attack ability goes on the chain before damage.", { type: "move", cardId: "p-champion", destination: "battlefield-right" }, "Attack right battlefield"),
    inspect("p-champion", "Compare the units", "Select Ahri and compare her 3 Might with Sentry’s 1. Might tells us how much combat damage each will deal and how much damage will kill it, but we’ve still got time to play cards before either unit deals that damage."),
    continueStep("combat-window", "We’re in a combat showdown and neither side has dealt damage yet. With the chain empty we can play an Action, and if someone puts a spell on the chain we can answer it with a Reaction. We’ll try that in this very fight.")
  ]),
  lesson("the-chain", "11. Respond on the chain", "We’ve both got Discipline, so whose spell happens first?", 4, "Battle and react", [
    inspect("o-discipline", "A spell waiting to happen", "Select Discipline on the chain, where spells and abilities wait to resolve. I’ve paid 2 energy for it, but see how my Sentry’s still at 1 Might? You’ve got time to play a Reaction before it gets any stronger."),
    exhaust(1, "play Discipline on Ahri before combat damage"), exhaust(2, "play Discipline on Ahri before combat damage"),
    step("react", "Strengthen Ahri before the fight", "Play your own Discipline for 2 energy and choose Ahri as its target, because she’s the unit we want to strengthen. Yours goes above mine on the chain, so once we’ve both passed, your spell will happen first.", { type: "play", cardId: "p-discipline-2", targetId: "p-champion" }, "React with Discipline"),
    pass("pass-own"), resolve("resolve-own"),
    pass("pass-enemy"), resolve("resolve-enemy"),
    continueStep("chain-result", "Look at the two units now, Ahri’s at 5 Might and Sentry’s at 3, and each of us drew a card. Your Discipline went first, but mine was still there waiting, so we’ve both strengthened our units going into damage.")
  ]),
  lesson("countering-spells", "12. Counter a spell", "Your Sentry’s about to be stunned, can you stop the spell in time?", 4, "Battle and react", [
    inspect("o-rune-prison", "Stop a spell before it happens", "Try this separate fight with your Sentry attacking. Select Rune Prison on the chain, it’s waiting to stun Sentry, which would stop it dealing combat damage this turn. We’ve got a counterspell in hand, so we can still do something about it."),
    step("counter-energy", "Make energy for Defy", "Defy costs 1 energy and 1 Calm power. Tap the ready Calm rune for the energy first, because we’re going to use that same rune for the power as well.", { type: "exhaust", cardId: "p-rune-2" }, "Exhaust Calm rune"),
    step("counter-power", "Recycle that same rune", "Recycle that same exhausted Calm rune for 1 Calm power, using its Recycle control or right-click. It goes to the bottom of the rune deck, but we still have the energy it made, so we can pay both parts of Defy’s cost.", { type: "recycle", cardId: "p-rune-2" }, "Recycle exhausted Calm rune"),
    step("counter-play", "Choose the spell you want to stop", "Play Defy for 1 energy and 1 Calm power, then choose Rune Prison on the chain. Defy can counter a spell with at most 4 printed energy and at most 1 printed power, and Rune Prison fits both limits.", { type: "play", cardId: "p-defy", targetId: "o-rune-prison" }, "Defy Rune Prison", "Select Defy, then select Rune Prison itself on the chain. Countering stops a spell while it’s waiting, so we need to do this before Rune Prison resolves."),
    continueStep("counter-window", "Defy’s a Reaction, so we could play it while Rune Prison was waiting. Now Defy’s waiting too, which means I get the same chance to respond above your spell. This time I’ve got nothing to add."),
    pass("counter-passes"),
    resolve("counter-resolve"),
    inspect("p-sentry", "Check what you protected", "Select Sentry again. It can still deal combat damage, because Defy stopped Rune Prison before the stun happened. Both spells are face up in the trash, and we’ve both spent what we paid for them."),
    continueStep("counter-limits", "If we’d let Rune Prison resolve, Defy would have been too late. It needs a spell on the chain that fits both its cost limits, so we couldn’t use it on a unit or an ability either. Next we’ll rejoin Ahri’s fight.")
  ], "We’ve set up a separate Ahri and Orianna fight to try Defy, and we’ll go back to the original fight when we’re done."),
  lesson("combat-damage", "13. Resolve the battle", "Ahri’s at 5 Might and Sentry’s at 3, so who’ll be left to take Rockfall?", 3, "Battle and react", [
    pass("finish-combat-showdown"),
    { ...step("assign", "Plan where each side’s damage goes", "There’s only one unit on each side, so all 5 of Ahri’s damage has to go to Sentry, and all 3 of Sentry’s has to go back to Ahri. Assign those amounts first, then we’ll deal the damage together.", { type: "demonstrate-combat" }, "Show the damage"), combatDemonstration: { sourceIds: ["p-champion"], targetAssignments: [{ cardId: "o-sentry", amount: 5, order: 1, label: "All 5 to the only defender" }], returnAssignments: [{ cardId: "p-champion", amount: 3, order: 1, label: "The Sentry’s 3 goes to Ahri" }], explanation: "We’ve marked 5 going to Sentry and 3 going to Ahri, but neither unit has taken that damage yet." } },
    resolve("deal-damage"),
    inspect("p-champion", "Why Ahri survived", "Look at Ahri, she took 3 damage against 5 Might, so she lived. Damage equal to or greater than a unit’s Might is lethal, which is why Sentry died. Combat cleanup heals Ahri’s damage, and she keeps Discipline’s extra Might for the rest of the turn."),
    score("combat-point", "Ahri’s the only unit left, so she takes Rockfall from me and you can record 1 point for conquering it. If both units had died, you’d have nobody left there to claim the battlefield.")
  ]),
  lesson("hidden-cards", "14. A hidden response", "Get Hidden Blade in place now, then see where I decide to attack.", 4, "Bring it together", [
    inspect("p-hidden", "Prepare a surprise for a later turn", "We’re trying Sett for this one, because his Body and Order domains let us play Hidden Blade. Look at Blade in your hand, we can hide it facedown at a battlefield we control and use it to answer an attack on a later turn."),
    step("hidden-energy", "Keep the energy before recycling", "Tap the Order rune for 1 energy before you recycle it. We’ll still have that energy after the rune goes back to its deck, whereas recycling the rune on its own would only give us power.", { type: "exhaust", cardId: "p-rune-1" }, "Exhaust Order rune"),
    step("hidden-power", "Pay to hide", "Recycle that exhausted Order rune for 1 power. Hiding Blade costs one power of any domain, so Order will do, and you’ve still got the 1 energy you made. We only pay the hiding cost here.", { type: "recycle", cardId: "p-rune-1" }, "Recycle Order rune"),
    step("hide", "Put the surprise where you need it", "Spend 1 power to hide Blade facedown at your left battlefield, keeping the 1 energy available. We haven’t played the spell yet so there’s nothing on the chain, and as long as we hold on to this battlefield, Blade can stay here for later.", { type: "hide", cardId: "p-hidden", battlefieldId: "battlefield-left" }, "Hide at left battlefield"),
    step("wait-hidden", "Wait until it can be used", "End your turn with Blade still facedown. We can’t use it the turn we hide it, but when I attack here on my turn we’ll have it ready.", { type: "end-turn" }, "End turn"),
    step("hidden-play", "Stop the attacker at this battlefield", "Play the hidden Blade and target my attacking Sentry. We ignore Blade’s printed base cost when we play it this way, but the unit we choose has to be here. You could even choose your own unit at this battlefield if you wanted to.", { type: "play", cardId: "p-hidden", targetId: "o-sentry", destination: "battlefield-left" }, "Play Hidden Blade"),
    pass("pass-hidden"), resolve("resolve-hidden"),
    continueStep("hidden-result", "My attacking Sentry dies, so I draw two cards from Blade, then one more from Sentry’s Deathknell. Your unit’s still there and I haven’t conquered, which is why the battlefield stays yours. If you’d lost control while Blade was still hidden, it would’ve been revealed and gone to the trash.")
  ], "We’re using Sett and his Body and Order cards for Hidden Blade. Your main Ahri game is saved while we try this separate fight.", "Sett"),
  lesson("keywords-in-combat", "15. Read keywords in context", "See how Daring Poro and Sett work together once they attack.", 3, "Bring it together", [
    inspect("p-poro", "An attacker gets extra Might", "Look at Daring Poro in this separate fight, it’s one of our attackers. Its printed Might is 2, but Assault adds 1 while it’s attacking, so the little Poro is actually bringing 3 damage to the fight."),
    inspect("p-champion", "Sett takes the damage first", "Select Sett and look at Tank. My units have to assign him enough damage to kill him before they can put any on your Poro. Sett has 5 Might and I’ve only got 4 damage between my defenders, so he can take the lot."),
    { ...step("keyword-damage", "Watch Tank protect your Poro", "Your attackers have 8 damage between them, so choose a defender to take lethal damage first. We’ll put 2 on one Poro, then all 6 that are left on the other. My defenders have 4 damage back, and Sett’s Tank keeps all of it off your Poro.", { type: "demonstrate-combat" }, "Show the damage"), combatDemonstration: { sourceIds: ["p-champion", "p-poro"], targetAssignments: [{ cardId: "o-sentry", amount: 2, order: 1, label: "2 is enough to kill this Poro" }, { cardId: "o-sentry-2", amount: 6, order: 2, label: "The last defender takes the remaining 6" }], returnAssignments: [{ cardId: "p-champion", amount: 4, order: 1, label: "Tank sends all 4 to Sett, protecting your Poro" }], explanation: "You can pick either Poro first, but once you’ve assigned the 2 that would kill it, the other Poro gets the remaining 6. I’ve got to put all 4 of mine on Sett." } },
    resolve("keyword-resolution"),
    score("keyword-conquest", "Sett and Poro both lived, and my defenders are gone, so take the point for conquering. Poro keeps Assault through conquering and any chain it starts, then when combat finishes it goes back to 2 Might."),
    continueStep("keyword-result", "See how only the attacking Poro got the extra Might? My two Poros were defending, so neither got Assault. Yours kept it right through conquering and the resulting abilities, and it wore off when combat ended.")
  ], "This time we’re trying Sett against Leona. Leona hasn’t stunned anything yet, so her legend hasn’t given her a buff, and her chosen champion is still in its zone.", "Sett"),
  ...NEW_PLAYER_KEYWORD_GROUPS.map(keywordLesson),
  lesson("win-the-game", `${16 + NEW_PLAYER_KEYWORD_GROUPS.length}. Two ways to win`, "Try getting that eighth point by conquering, then see what changes if you can hold instead.", 4, "Bring it together", [
    continueStep("seven-points", "We’re back with Ahri on 7 points, both battlefields are open and we’ve got two ready Sentries in base. Let’s see what it takes to win by conquering, then we’ll try a fresh position where we can hold instead.", "Choose how to earn point eight"),
    step("last-attack", "Start the two-battlefield route", "Move one Sentry from base to Monastery. We need to score both battlefields this turn if we’re going to win by conquering, so turn Sentry sideways to move it and we’ll finish this showdown first.", { type: "move", cardId: "p-sentry", destination: "battlefield-left" }, "Move to Monastery"),
    pass("last-showdown"),
    score("not-yet", "That’s Monastery scored, but at 7 points you draw a card when you conquer unless you’ve scored every battlefield this turn. We’re still at 7, so which battlefield do we need next?"),
    step("second-final-field", "Score the battlefield you still need", "Move your other ready Sentry to Rockfall Path. Monastery counted even though we drew a card, so Rockfall’s the one we still need. Its text stops us playing a unit straight onto it, but we can move there from base.", { type: "move", cardId: "p-sentry-2", destination: "battlefield-right" }, "Move to Rockfall Path"),
    pass("second-final-showdown"),
    score("conquest-victory", "This time you get point 8, because you’ve scored both battlefields in the same turn. The rule checks whether you scored each one, so an earlier holding point can count towards this too."),
    step("show-hold-route", "Try the other route", "You’ve won that game, so let’s try a different finish. We’ll go back to 7 points, only this time you’ve held on to Monastery through my turn.", { type: "alternate-win-route" }, "Try winning by holding"),
    step("last-ready", "Ready before checking for holding", "Choose Ready all for Awaken. Your cards turn upright, and Sentry’s still at Monastery where you need it, so at Beginning we can check whether holding it wins the game.", { type: "ready" }, "Ready your board"),
    score("victory", "Record the holding point at Beginning. That takes you from 7 to 8, and because you earned it by holding, it doesn’t matter whether you’ve scored the other battlefield."),
    continueStep("graduate", "If we’re trying to win by conquering, I’m looking at which battlefields we’ve already scored this turn. If we’re holding one on 7 points, the question is whether we can keep it until Beginning. You’ll get to choose a route yourself in the next practice.", "How will you earn the final point?")
  ])
];


// Guide turns are narrated before each atomic move; player inputs never silently
// run a whole opposing turn. Keeping these as steps also makes Back exact.
for (const l of LESSONS) {
  if (l.chapter === "Keyword practice") continue;
  const expanded: TutorialStep[] = [];
  if (l.id === "power-and-champion") expanded.push(
    guide("next-awaken", "Ready Sentry and your runes", "Choose Awaken to ready your Sentry and the two runes you used last turn. That’s why we can use those same runes for energy this turn.", {type:"ready",side:"player"}, ["player:runes","p-sentry"]),
    guide("next-beginning", "Check whether you can score by holding", "Check Beginning. Sentry’s still in base, so there’s no battlefield to score for holding, and we haven’t got a Beginning ability to deal with either.", {type:"phase",phase:"Channel",priority:"player"}),
    guide("next-channel", "Have we got enough for Ahri?", "Channel two more ready runes from your rune deck. That brings us up to four, which is plenty to play Ahri this turn, provided we remember her Mind power as well as her 3 energy.", {type:"channel",side:"player",count:2}, ["player:rune-deck","player:runes"]),
    guide("next-draw", "Draw this turn’s extra card", "Draw the top card of your main deck into your hand. Once we’re into Main we’ll tap three runes for energy, then recycle one of those same runes for the Mind power Ahri needs.", {type:"draw",side:"player",count:1}, ["player:deck"]));
  if (l.id === "the-chain") expanded.push(
    step("offer-showdown-focus","Who gets to play first?","Ahri’s attacking my Sentry and the chain’s empty. You’ve got focus, which means it’s your choice whether to play something in the showdown. Pass it to me this time, and I’ll show you the play I’ve got.",{type:"pass"},"Pass focus"),
    guide("opponent-pay-discipline", "Two energy for Discipline", "Watch my two ready runes turn sideways, that’s 1 energy each. They stay on the table, and I’ve got the 2 energy I need to play Discipline on my defending Sentry.", {type:"exhaust-runes",cardIds:["o-rune-1","o-rune-2"]}, ["o-rune-1","o-rune-2","opponent:resources"]),
    guide("opponent-discipline", "Discipline targets Sentry", "I’ll spend the 2 energy and target Sentry with Discipline, so Sentry’s the unit I’ve chosen to get the effect. The spell goes on the chain to wait, which is why my Sentry hasn’t gained any Might yet.", {type:"play",cardId:"o-discipline",destination:"chain",targetId:"o-sentry"}, ["o-discipline","o-sentry","chain"]),
    guide("opponent-priority", "Would you respond?", "I’ll pass priority to you. That means you get to decide whether to add a response, and while my Discipline’s still on the chain you can put a Reaction above it.", {type:"phase",phase:"Combat showdown",priority:"player"}, ["chain"]));
  for (const original of l.steps) {
    expanded.push(original.expectedAction.type === "demonstrate-combat" ? {...original,actor:"guide",expectedAction:{type:"guide",eventId:original.id},guideEffect:{type:"assign"}} : l.id === "the-chain" && original.id === "resolve-enemy" ? guide(original.id,"Now Sentry gets the extra Might","We’ve both passed on my Discipline, so now Sentry gets its extra 2 Might for the turn and I draw a card. You strengthened Ahri first, but my spell was still here to strengthen Sentry afterwards.",{type:"resolve"},["o-discipline","o-sentry","opponent:deck"]) : original);
    if(l.id==="start-combat"&&original.id==="attack")expanded.push(
      guide("ahri-trigger","Attacking starts Ahri’s ability","Ahri’s attacking, so her attack ability triggers automatically. It targets my defending Sentry and goes on the chain before the open combat showdown. Sentry’s Might stays where it is until the ability resolves, so either of us could still answer with a Reaction.",{type:"trigger",cardId:"p-champion",label:"Ahri — enemy -2 Might, minimum 1",targetId:"o-sentry"},["p-champion","o-sentry","chain"]),
      pass("ahri-trigger-pass"),guide("ahri-trigger-guide-pass","I’ll pass on Ahri’s ability","You’ve passed on Ahri’s ability and I’m passing too, so we can let it resolve before we carry on with the fight.",{type:"pass",side:"opponent"},["chain"]),
      guide("ahri-trigger-resolve","Apply Ahri’s printed limit","Ahri’s ability takes 2 Might off the target for this turn, but the card says it can’t reduce it below 1. My Sentry was already at 1, so it stays there, and neither unit’s dealt any combat damage yet.",{type:"resolve-ahri"},["o-sentry","chain"]));
    if (original.expectedAction.type === "resolve" && l.id === "the-chain" && original.id === "resolve-own") expanded.push(guide("older-spell-guide-pass","My Discipline is still waiting","Your Discipline has finished, so mine’s back on top of the chain and I get priority again. I’ll pass it to you, in case you’ve got anything else to play before mine resolves.",{type:"pass",side:"opponent"},["chain"]));
    if (original.expectedAction.type === "pass" && !(l.id === "the-chain" && original.id === "pass-enemy")) {
      const result=l.id==="the-chain"?"Now your Discipline can strengthen Ahri and draw you a card, while mine stays on the chain.":l.id==="countering-spells"?"Defy can now counter Rune Prison before Sentry gets stunned.":l.id==="hidden-cards"?"Hidden Blade can now kill my attacking Sentry.":l.id==="combat-damage"?"Next we’ll assign damage using Ahri’s 5 Might and Sentry’s 3.":"Your unit’s on its own here, so once the showdown finishes we can check the point for conquering.";
      expanded.push(guide(`${original.id}-guide-pass`, "I’ll pass too", `You’ve passed, and I’m happy to pass too. ${result}`, {type:"pass",side:"opponent"}, ["chain"]));
    }
    if (original.expectedAction.type === "end-turn") {
      const hidden = l.id === "hidden-cards", first = l.id === "play-first-unit";
      expanded.push(
        guide(`${original.id}-awaken`, "My turn to ready up", "Watch my cards during Awaken, anything sideways turns upright again. That means I can use my runes for resources and make a normal move with a unit that’s ready.", {type:"ready",side:"opponent"}, ["opponent:runes","opponent:base"]),
        guide(`${original.id}-beginning`, "My Beginning phase", "I don’t control a battlefield yet, so there’s nothing to score for holding, and I haven’t got a Beginning ability to resolve. We can go straight on to Channel.", {type:"phase",phase:"Channel",priority:"opponent"}),
        guide(`${original.id}-channel`, "How many runes do I get?", first ? "I’m going second, so I get three ready runes from my rune deck on my first turn. That extra rune helps me catch up after you’ve had the first play. After this we both channel two." : "I’ll channel two more ready runes. I only got the extra one for going second on my first turn, so it’s back to two just like yours.", {type:"channel",side:"opponent",count:first?3:2}, ["opponent:rune-deck","opponent:runes"]),
        guide(`${original.id}-draw`, "My draw for the turn", "I’ll draw the top card of my main deck into my hand, and then I’m in Main. We both draw on our first turn in this two-player game, and the card stays private until I play or reveal it.", {type:"draw",side:"opponent",count:1}, ["opponent:deck"]));
      if (first) expanded.push(
        guide("guide-pay-sentry", "Two runes pay for the guide’s Sentry", "I’d like a Watchful Sentry in my base too, so I’m turning two runes sideways for 1 energy each. That’s the 2 energy it costs, and both runes stay on the table to ready later.", {type:"exhaust-runes",cardIds:["o-rune-1","o-rune-2"]}, ["o-rune-1","o-rune-2","opponent:resources"]),
        guide("guide-first-unit", "A Sentry for my side", "I’ll spend those 2 energy to play Watchful Sentry into base. Mine comes in sideways just like yours, so I’ll have to ready it before I can send it out to a battlefield.", {type:"play",cardId:"o-sentry",destination:"base"}, ["o-sentry","opponent:base"]));
      if (hidden || l.id === "holding") {
        const field: TutorialBattlefieldId = hidden ? "battlefield-left" : "battlefield-right";
        expanded.push(guide(`${original.id}-move`, hidden ? "Sentry attacks your battlefield" : "Sentry goes to the empty battlefield", hidden ? "I’m turning my ready Sentry sideways to attack the battlefield you’re defending. This is the attack you hid Blade for, and because it’s a later turn now you can play it before damage." : "I’ll move Sentry to the empty battlefield on the right, turning it sideways. I’d like the point, but this opens a showdown, so you get a chance to stop me before I conquer.", {type:"move",cardId:"o-sentry",destination:field}, ["o-sentry",field]));
        expanded.push(guide(`${original.id}-focus`, "Your chance to respond", hidden ? "I’m passing focus to you. We’re fighting at the battlefield where you hid Blade, so you can use it to deal with my attacker before damage." : "I’ve passed focus, so you get a chance to play something before I can take the right battlefield. You can leave this one to me and keep your Sentries defending the left.", {type:"phase",phase:hidden?"Combat showdown":"Showdown",priority:"player"}, [field]));
        if (!hidden) {
          expanded.push(pass(`${original.id}-learner-pass`,"Pass focus here, we’re leaving the right battlefield to my Sentry and keeping your defenders on the left. I’ve still got to finish the showdown before I can take it."), guide(`${original.id}-other-pass`, "Finish the showdown on the right", "I’ll pass too. We’ve both had our chance and Sentry’s the only unit at the right battlefield, so I can conquer without a fight.", {type:"pass",side:"opponent"}, [field]), guide(`${original.id}-score`, "One point on my side", "I’ve taken the right battlefield and scored 1 point, while you still hold the left. Nothing comes off your score when I earn my own point.", {type:"score",side:"opponent",battlefieldId:field}, [field]));
        }
      }
      if (!hidden) expanded.push(guide(`${original.id}-opponent-ends`, "Back to your turn", "I’m done, so I’ll end my turn. Any energy or power I haven’t spent goes away along with effects that only last this turn, then it’s back to you for Awaken.", {type:"start-turn",side:"player"}, ["player:runes"]));
    }
  }
  l.steps = expanded;
  l.minutes = Math.max(l.minutes, Math.ceil(expanded.length * 0.28));
}

// A paid, resolved buff makes this attack a sensible choice before the hidden response.
{
  const l=LESSONS.find(l=>l.id==="hidden-cards")!;
  const at=l.steps.findIndex(s=>s.id==="wait-hidden-move");
  l.steps.splice(at,0,
    guide("hidden-buff-energy","How can Sentry win this fight?","I’d lose this fight if I sent my 1-Might Sentry straight into your 2-Might Poro, so watch what I do first. I’ll tap two ready runes for the 2 energy Discipline costs.",{type:"exhaust-runes",cardIds:["o-rune-1","o-rune-2"]},["o-rune-1","o-rune-2"]),
    guide("hidden-buff-play","Discipline waits on the chain","I’ll spend those 2 energy on Discipline and choose Sentry in base. When the spell resolves I’ll draw a card and Sentry will gain 2 Might this turn, but right now it’s still on 1.",{type:"play",cardId:"o-discipline",destination:"chain",targetId:"o-sentry"},["o-discipline","o-sentry","chain"]),
    guide("hidden-buff-guide-pass","You can answer the waiting spell","I’ll pass priority. You could play a Reaction, but my Sentry’s still in base, out of reach of your Hidden Blade. We’ll let Discipline resolve first.",{type:"pass",side:"opponent"},["chain"]),
    pass("hidden-buff-pass","Pass on Discipline. Your own Poro is a legal target for Blade on the left, but my Sentry isn’t even at the battlefield yet, so I’d wait until it attacks."),
    guide("hidden-buff-resolve","A stronger attacker is ready","Now we’ve both passed, my Sentry goes from 1 Might to 3 and I draw a card. It’s still ready in base, and suddenly attacking your 2-Might Poro looks a lot better.",{type:"resolve"},["o-sentry","opponent:deck"]));
  const move=l.steps.find(s=>s.id==="wait-hidden-move")!;
  move.instruction="I’ll turn my 3-Might Sentry sideways to attack your 2-Might Poro. Now Sentry’s at the right location for Blade, and because you hid it on a previous turn you can use it when you get priority.";
  move.hint=move.instruction;
}

for (const [lessonId, afterStep] of [["combat-damage","deal-damage"],["hidden-cards","resolve-hidden"]] as const) {
  const l = LESSONS.find(x=>x.id===lessonId)!;
  let at = l.steps.findIndex(x=>x.id===afterStep);
  if (at<0 && lessonId==="combat-damage") at=l.steps.findIndex(x=>x.expectedAction.type==="resolve");
  l.steps.splice(at+1,0,
    guide(`${afterStep}-deathknell`, "A death can start another ability", "Sentry’s died, so its Deathknell triggers. The draw ability goes on the chain after the damage or spell has finished, which means you can still respond before I get the card.", {type:"trigger",cardId:"o-sentry",label:"Watchful Sentry — Deathknell: draw 1"}, ["o-sentry","chain"]),
    guide(`${afterStep}-trigger-guide-pass`, "Would you respond to Deathknell?", "It was my Sentry, so I control its Deathknell and get priority first. I’ll pass to you, in case you want to respond before I draw.", {type:"pass",side:"opponent"}, ["chain"]),
    pass(`${afterStep}-trigger-pass`,"Pass on Sentry’s Deathknell. The unit’s in the trash, but its draw ability is still on the chain, so we’ll finish that before we go back to the battlefield."),
    guide(`${afterStep}-trigger-resolve`, "One card from Deathknell", "We’ve both passed, so I draw one card from my main deck for Deathknell. Sentry stays in the trash, and we’ve now finished its draw separately from the effect that killed it.", {type:"deathknell",cardId:"o-sentry"}, ["opponent:deck","chain"]));
}

{
  const l=LESSONS.find(l=>l.id==="hidden-cards")!;
  l.steps.push(
    {...continueStep("hidden-other-reset","Let’s try that attack again from a fresh position. Your Poro and Blade are back on the left, my Discipline has already resolved, and this time I’m going to take Sentry somewhere else."),title:"Reset: the guide chooses the other battlefield",presentation:"lesson-intro",lessonIntro:{see:"Your Poro and Blade are on the left, and my 3-Might Sentry is still in base.",do:"Watch which battlefield Sentry moves to before you decide whether to play Blade.",why:"Having a chance to respond won’t help if Blade can’t reach the unit you want."},label:"Start the other-battlefield example",rulesEffect:{type:"hidden-other-position"}},
    guide("hidden-other-move","What if I attack on the right?","I know there’s a hidden card on the left, so why take the risk? I’ll move my strengthened Sentry to the empty battlefield on the right and try to score there.",{type:"move",cardId:"o-sentry",destination:"battlefield-right"},["o-sentry","battlefield-right"]),
    guide("hidden-other-guide-pass","Check where the response can reach","I’ve passed focus, so you could play Blade this turn, but have a look at where Sentry went. Blade’s hidden on the left and it can only target a unit there.",{type:"pass",side:"opponent"},["battlefield-right","p-hidden"]),
    pass("hidden-other-pass","Pass focus and keep Blade hidden. You could choose your own Poro on the left, but that wouldn’t stop my Sentry taking the right, so I’d keep Blade for an attack you can actually reach."),
    guide("hidden-other-score","The other battlefield is conquered","We’ve both passed, so I take the right battlefield and its point. You still control the left, which means Blade stays hidden there for a later turn.",{type:"score",side:"opponent",battlefieldId:"battlefield-right"},["battlefield-right"]),
    {...continueStep("hidden-loss-example","Try one last position, with Blade facedown at Monastery and Poro as your only unit there. What happens to Blade if you take Poro away?"),title:"Reset: what if you lose control?",presentation:"lesson-intro",lessonIntro:{see:"Poro’s the only friendly unit at the battlefield where Blade is hidden.",do:"Move Poro back to base and see where Blade ends up.",why:"To keep a card hidden at a battlefield you need to keep control of it."},label:"Try the losing-control example",rulesEffect:{type:"hidden-loss-position"}},
    step("leave-hidden-field","What happens if Poro leaves?","Move Poro back to base. Normally I’d be wary of leaving a hidden card behind like this, because Poro’s our last unit here and we lose control when it leaves.",{type:"move",cardId:"p-poro",destination:"base"},"Move Poro to base"),
    guide("hidden-loss-cleanup","Where did Blade go?","Check Monastery after Poro leaves. Cleanup sees that you’ve lost control, so your hidden Blade is revealed and goes to the trash, even though you never played it.",{type:"hidden-loss"},["p-hidden","battlefield-left","player:trash"]),
    continueStep("hidden-loss-result","Where you hide Blade matters, because you need to keep control until a later turn, and even then Blade can only target a unit at that battlefield. It can be yours or mine."));
}
for(const l of LESSONS){
  const introduction=l.intro!;
  if(["table-setup","win-the-game"].includes(l.id))l.steps[0]={...l.steps[0],presentation:"lesson-intro",lessonIntro:introduction,label:"Start this lesson"};
  else if(["opening-hand","first-or-second"].includes(l.id))l.steps[0]={...l.steps[0],lessonIntro:introduction};
  else l.steps.unshift({...continueStep("lesson-intro",`${introduction.see} ${introduction.do} ${introduction.why}`),title:l.title.replace(/^\d+\.\s*/,""),presentation:"lesson-intro",lessonIntro:introduction,label:"Start this lesson"});
  l.minutes=Math.max(l.minutes,Math.ceil(l.steps.length*0.32));
}

// Cumulative practice uses the same validated rules events, with the explanation
// available on request instead of showing the next answer before each learner move.
const practiceCopy = (sourceId:string, keep:(step:TutorialStep)=>boolean=()=>true):TutorialStep[] => LESSONS.find(l=>l.id===sourceId)!.steps.filter(s=>!s.lessonIntro&&keep(s)).map(s=>({...structuredClone(s),rulesLessonId:sourceId}));
function makePractice(id:string,title:string,intro:TutorialLessonIntro,goal:string,steps:TutorialStep[]):TutorialLesson {
  return {id,title,description:goal,minutes:Math.ceil((steps.length+1)*0.35),chapter:"Use what you learned",champion:"Ahri",scenarioNote:"This is a separate practice board, so you can take the decisions yourself while I play the other side. If you want a hand, use the clue or ask to see the next move.",intro,practice:{goal},steps:[
    {...continueStep("practice-intro",`${intro.see} ${intro.do} ${intro.why}`),title:"Use what you learned",label:"Start this practice",presentation:"lesson-intro",lessonIntro:intro},
    ...steps.map(s=>s.actor==="guide"?s:{...s,guidance:"practice" as const,practiceGoal:goal})
  ]};
}
const firstPointSteps:TutorialStep[]=[
  guide("practice-first-awaken","Turn one: start with Awaken","Choose Awaken, the first part of your turn. Atlas often handles this for you, but check your side for yourself this time. You haven’t used any cards yet, so there’s nothing sideways to ready.",{type:"ready",side:"player"},["player:base","player:runes"]),
  guide("practice-first-beginning","Turn one: check Beginning","Check Beginning. You haven’t got a battlefield to score for holding or an ability that starts here, so once you’ve checked both we can carry on to Channel.",{type:"phase",phase:"Channel",priority:"player"},["battlefield-left","battlefield-right"]),
  guide("practice-first-channel","Turn one: bring out two runes","Channel two ready runes from your rune deck. They can make 1 energy each, enough for the unit we’re about to draw, but they’re still ready until you actually use them.",{type:"channel",side:"player",count:2},["player:rune-deck","player:runes"]),
  guide("practice-first-draw","Draw your first-turn card","Draw your card, it’s Watchful Sentry. Both players get a draw on their first turn in a two-player game, so we can go into Main with a 2-energy unit we can play now and move once it’s ready.",{type:"draw-card",cardId:"p-sentry"},["player:deck","p-sentry"]),
  ...practiceCopy("play-first-unit",s=>s.expectedAction.type!=="continue")
];
for(const s of firstPointSteps)if(s.expectedAction.type==="exhaust")s.allowedCardIds=["p-rune-1","p-rune-2"];
firstPointSteps.push(
  guide("practice-awaken","Your unit is ready for a new turn","Ready Sentry and your runes in Awaken. Sentry went into base sideways last turn, but now it can actually make the move we’ve been setting up.",{type:"ready",side:"player"},["p-sentry","player:runes"]),
  guide("practice-beginning","No battlefield to hold yet","Check Beginning before you look for a move. Sentry’s still in base, so there’s no holding point this turn, but we’ll get a chance to conquer during Main.",{type:"phase",phase:"Channel",priority:"player"}),
  guide("practice-channel","Prepare two more runes","Channel two ready runes. You can leave these open, because moving Sentry will use its readiness and won’t cost you any energy.",{type:"channel",side:"player",count:2},["player:rune-deck","player:runes"]),
  guide("practice-draw","Draw, then make your next choice","Draw a card for the turn and go into Main. Sentry’s ready in base and either battlefield is open, so where would you send it to earn a point? The clue is there if you’d like a hand.",{type:"draw",side:"player",count:1},["player:deck"]),
  ...practiceCopy("move-to-battlefield",s=>s.expectedAction.type==="move"),
  ...practiceCopy("first-conquest",s=>s.expectedAction.type!=="continue")
);
for(const s of firstPointSteps)if(s.expectedAction.type==="move"){
  s.allowedCardIds=["p-sentry"];s.allowedDestinations=["battlefield-left","battlefield-right"];
  s.instruction="Move your ready Sentry from base to either empty battlefield. It turns sideways and opens a showdown wherever you choose. Rockfall Path stops you playing a new unit straight onto it, but this Sentry can move there.";s.hint=s.instruction;
}
const firstPractice=makePractice("practice-first-point","Use what you learned: your first point",{see:"You’ve got four cards in hand and no runes on your side of the table yet.",do:"Play Sentry on turn one, let me take my turn, then try earning your first point on yours.",why:"Getting Sentry down now means it’ll be ready to move when your turn comes round again."},"Get a unit down on your first turn, then ready it and try to conquer on your second.",firstPointSteps);
const firstPracticeEndTurn = firstPractice.steps.find(s => s.id === "end-first")!;
firstPracticeEndTurn.title = "Sentry’s down, what now?";
firstPracticeEndTurn.instruction = "Sentry’s in play, but you’ve spent your energy and it came in exhausted, so it can’t make a normal move yet. End your turn and I’ll take mine, then Awaken will ready your Sentry and you can send it out to try to conquer.";
firstPracticeEndTurn.practiceGoal = firstPracticeEndTurn.instruction;
firstPracticeEndTurn.hint = "Choose End Turn on the board. Your Sentry stays in base, ready to turn upright at your next Awaken.";
firstPracticeEndTurn.practiceHint = firstPracticeEndTurn.hint;
const reactionPractice=makePractice("practice-reactions","Use what you learned: protect your attacker",{see:"Ahri’s attacking my Sentry, and we can both still do something about the fight.",do:"Play your response, finish the fight and see if Ahri can take the right battlefield.",why:"Keeping Ahri alive matters here, because she’s the one who can take the point after the fight."},"Get Ahri through the fight and take the right battlefield with her.",[
  ...practiceCopy("the-chain",s=>s.expectedAction.type!=="continue"),
  ...practiceCopy("combat-damage",s=>s.expectedAction.type!=="continue")
]);
const finalPractice=makePractice("practice-final-point","Use what you learned: earn the last point",{see:"You’re on 7 points with two empty battlefields and two ready Sentries in base.",do:"See if those two Sentries can earn the last point by conquering this turn.",why:"A Sentry arriving won’t win this on its own, so plan for both battlefields before you move the first one."},"You’ve got two ready Sentries, can you win this turn from 7?",practiceCopy("win-the-game",s=>!["show-hold-route","last-ready","victory"].includes(s.id)&&s.expectedAction.type!=="continue"));
for(const s of finalPractice.steps)if(s.expectedAction.type==="move"){
  s.allowedCardIds=["p-sentry","p-sentry-2"];s.allowedDestinations=["battlefield-left","battlefield-right"];
  s.instruction=s.id==="last-attack"?"Move either ready Sentry from base to either empty battlefield, and keep the other ready. We need to score both this turn if we want that eighth point from conquering.":"You’ve scored the first battlefield, so move the Sentry you kept ready to the other one. It doesn’t matter which one you took first, as long as you score both this turn.";s.hint=s.instruction;
}
for(const [after,practice] of [["first-conquest",firstPractice],["combat-damage",reactionPractice],["win-the-game",finalPractice]] as const)LESSONS.splice(LESSONS.findIndex(l=>l.id===after)+1,0,practice);
const decision = (id:string,title:string,prompt:string,options:NonNullable<TutorialStep["decision"]>["options"]):TutorialStep => ({
  ...step(id,title,prompt,{type:"choose",optionId:options.find(o=>o.accepted)!.id},"Choose your answer"),decision:{prompt,options}
});
const exercise = (operation:string):TutorialGuideEffect=>({type:"exercise",operation});
const supported = (s:TutorialStep,goal:string,clue:string):TutorialStep => ({...s,guidance:"practice",practiceGoal:goal,practiceHint:clue});
function addedLesson(id:string,title:string,intro:TutorialLessonIntro,steps:TutorialStep[],path:NonNullable<TutorialLesson["path"]>):TutorialLesson {
  return {id,title,description:intro.why,minutes:Math.ceil((steps.length+1)*0.32),chapter:path==="practice"?"Make your own choices":"Your first game",champion:"Ahri / Orianna",path,intro,
    scenarioNote:"We’re using real cards and legal teaching decks for this separate position, with your main Ahri game saved. Any optional on-play effects are already finished unless you’re asked to choose one here.",
    steps:[{...continueStep("lesson-intro",`${intro.see} ${intro.do} ${intro.why}`),title,label:"Start this lesson",presentation:"lesson-intro",lessonIntro:intro},...steps]};
}
const opponentPass=(id:string)=>guide(id,"The guide adds nothing","I’ll pass too, so we can carry on now we’ve both had the chance to add something.",{type:"pass",side:"opponent"},["chain"]);
const exerciseDamage=(id:string,sourceIds:string[],targetId:string,total:number,returns:NonNullable<TutorialStep["combatDemonstration"]>["returnAssignments"],explanation:string):TutorialStep=>({
  ...step(id,"Check the planned damage",explanation,{type:"demonstrate-combat"},"Show the damage"),combatDemonstration:{sourceIds,targetAssignments:[{cardId:targetId,amount:total,order:1}],returnAssignments:returns,explanation}
});
const planningGoal="Earn a point, then have a look at what you can still afford before you end Main.";
const planning=addedLesson("plan-your-main","Make a plan for Main",{see:"You’ve got a ready unit in base, two unused runes and a 2-energy unit in hand.",do:"Work out where you can score with the unit you’ve got, then see what else you can afford.",why:"You can do more than one thing in Main, so scoring a point doesn’t have to be the last thing you do."},[
  decision("main-plan","What helps the score now?","Both battlefields are empty, so which play gets us a point this turn without having to wait for a new unit to ready?",[
    {id:"move",label:"Use the ready unit already in base",accepted:true,explanation:"Pickpocket can use its readiness to move, which leaves both runes open for whatever you want to play afterwards."},
    {id:"new",label:"Play the new unit and move it immediately",accepted:false,explanation:"A new unit would enter exhausted here, so you’d be waiting a turn to move it. What about the unit you’ve already got ready in base?"},
    {id:"end",label:"End now because I have drawn a card",accepted:false,explanation:"Drawing got us into Main, and we’ve still got a ready unit and two runes. Which of those could we use to go after a point?"}
  ]),
  supported(step("plan-move","Use readiness, not energy","Move your ready Pickpocket to the empty battlefield on the left. Its on-play ability finished earlier, so you’re just turning it sideways to move, and both runes stay ready.",{type:"move",cardId:"p-planner",destination:"battlefield-left"},"Move to the battlefield"),planningGoal,"Which unit could move right now and leave you both runes to spend afterwards?"),
  pass("plan-pass","Pass so we can finish the showdown. You’re giving me a chance to respond here, and you’ll still be in Main afterwards."),opponentPass("plan-guide-pass"),score("plan-point","Record your first point for conquering, then look at those two runes, they’re still ready to spend this Main."),
  decision("main-more","Is the turn used up?","You’ve scored a point, but you’ve still got two ready runes and Clockwork Keeper in hand. What can you do now?",[
    {id:"more",label:"I may make another legal play, or choose to end",accepted:true,explanation:"You’ve still got the runes to play Keeper, and Main stays open after your first move or card. You can end when you’re happy with what you’ve done."},
    {id:"over",label:"Scoring always ends my turn",accepted:false,explanation:"You’ve finished the showdown, but you’re still in Main and those two runes are still ready."}
  ]),
  exhaust(1,"add a unit for a future turn"),exhaust(2,"add a unit for a future turn"),
  step("plan-play","Play Keeper with the runes you saved","Spend 2 energy to play Clockwork Keeper in base. We’ll skip the optional power payment this time, so it enters exhausted without the draw trigger and we can move it on a later turn.",{type:"play",cardId:"p-keeper",destination:"base"},"Play Keeper"),
  step("plan-end","Finish when your plan is done","We’ve moved, scored and played Keeper, all in the same Main phase. I’d end the turn here because we’ve done what we came to do.",{type:"end-turn"},"End turn"),
  continueStep("main-checklist","Before I end a turn, I look at which battlefields I could score or need to defend, which units are ready, and what I could still pay for. Sometimes I want to spend those runes now, and sometimes it’s worth keeping them open for a response.")
],"first-game");
const simpleCombat=addedLesson("simple-combat","Predict a simple fight",{see:"Your ready Pickpocket has 3 Might, and the Clockwork Keeper defending the battlefield has 2.",do:"Call the fight before you go in, then attack and see whether you were right.",why:"There aren’t any attack, death or movement abilities changing this fight, so we can work it out from the Might on the two units."},[
  decision("predict-fight","Before you attack","Neither unit has an ability that changes this fight, so if they deal combat damage together, which unit do you think will still be there?",[
    {id:"survive",label:"Pickpocket survives; Keeper dies",accepted:true,explanation:"Pickpocket deals 3, which is enough to kill the 2-Might Keeper, while Keeper’s 2 damage leaves Pickpocket alive on 3 Might."},
    {id:"first",label:"Only Pickpocket deals damage because it attacks",accepted:false,explanation:"Keeper still gets its 2 damage in, because both sides deal their damage together even when one of them dies."},
    {id:"both",label:"Both die because they both take damage",accepted:false,explanation:"Look at the damage each unit takes alongside its current Might. Is that damage enough to kill both of them?"}
  ]),
  step("simple-attack","Test your prediction","Move Pickpocket to the battlefield Keeper’s defending. Their optional on-play effects are already done, and neither unit has an attack or death trigger to change the fight.",{type:"move",cardId:"p-planner",destination:"battlefield-left"},"Attack"),
  pass("simple-pass","Neither player has a spell to add here, so pass and we’ll see how the fight plays out with their printed Might."),opponentPass("simple-guide-pass"),
  exerciseDamage("simple-assign",["p-planner"],"o-keeper",3,[{cardId:"p-planner",amount:2,order:1}],"Assign 3 damage to Keeper and 2 back to Pickpocket, then deal both together. Attacking hasn’t given Pickpocket the first hit."),
  resolve("simple-resolve"),inspect("p-planner","Check the survivor","Look at Pickpocket after cleanup, its 3 Might was enough to survive 2 damage and the damage has cleared. Keeper’s in the trash, and its on-play ability doesn’t trigger again just because it died."),
  score("simple-score","Pickpocket’s the only unit left, so claim the point for conquering. If both had died, there’d have been nobody there to take the battlefield."),
  decision("equal-fight","Try the same reasoning with equal Might","Say you’d attacked a 3-Might unit with another ordinary 3-Might unit instead. They deal 3 to each other, so who’s left to conquer?",[
    {id:"neither",label:"Neither unit survives, so neither side conquers",accepted:true,explanation:"Each one takes enough damage to kill it, and an empty battlefield leaves nobody to claim the point."},
    {id:"attacker",label:"The attacker survives because it went first",accepted:false,explanation:"They hit at the same time, so the defending unit still deals all 3 of its damage to the attacker."}
  ])
],"first-game");
const mulligans=addedLesson("mulligan-practice","Choose an opening plan",{see:"We’ll try two opening hands from the same deck, with four cards in each.",do:"Look for a first-turn play in each hand, then decide if you’d keep all four or send something back.",why:"An expensive unit is much easier to keep if you’ve already got something you can play while you wait for it."},[
  decision("keep-plan","This hand already has a start","Keeper costs 2, Pickpocket costs 3, Elder costs 4, and we’ve got Discipline to help a unit in a fight. Looking at those first two runes, would you change anything in this hand?",[
    {id:"keep",label:"Keep all four, I can play Keeper first and use the others later.",accepted:true,explanation:"I’d keep Elder here, because Keeper gives us something to play on turn one, so there’s time to get to the 4 energy we’ll need later."},
    {id:"expensive",label:"Send back anything that costs more than 2 energy.",accepted:false,explanation:"You can send back up to two, but which of these cards actually needs to go? Keeper already covers our first turn, so we can afford to hang on to a later play."}
  ]),
  {...step("keep-four","Keep the playable hand","Choose Keep hand. We like these four, so we can keep them all without paying anything or sending a card back.",{type:"mulligan",cardIds:[]},"Keep all"),rulesEffect:exercise("mulligan-keep")},
  {...continueStep("second-hand","Let’s try a fresh opening hand with two Elders, Discipline and Rune Prison. This time Elder’s the cheapest unit we’ve got and it costs 4, so what are we actually playing on turn one? I’d keep the spells and send both Elders back to look for an early unit."),rulesEffect:exercise("mulligan-second")},
  supported({...step("replace-two","Choose two cards to replace","Select both Wizened Elders and replace them. Set them aside, draw two cards, then recycle the Elders to the bottom of your main deck in a random order, and you’ve still got four in hand.",{type:"mulligan",cardIds:["m-elder-one","m-elder-two"]},"Replace two"),rulesEffect:exercise("mulligan-two")},"See if we can find a unit we can afford on our first turn.","Look at which cards are units and what the first two runes can pay for, because a support spell still needs something to support."),
  continueStep("mulligan-outcome","We drew Keeper and Sentry this time, so we’ve found our early play. You won’t know the replacements in a real game and you only get the one mulligan, so I’d judge the decision by what the hand needed when you made it.")
],"practice");
const recoveryGoal="Try earning a point elsewhere, somewhere your smaller unit can actually survive.";
const recovery=addedLesson("recovery-practice","Recover after losing a battlefield",{see:"My 4-Might Elder has taken the battlefield you had, but you’ve still got a ready Keeper in base.",do:"Look at both battlefields and see where your smaller unit can actually earn a point.",why:"If you’ve lost one battlefield, you don’t have to go straight back into the same fight."},[
  decision("recovery-plan","Where can Keeper get a point?","Keeper’s got 2 Might, Elder’s on 4, and the other battlefield’s empty. Where would you send Keeper if you wanted a point this turn?",[
    {id:"other",label:"Conquer the empty battlefield with Keeper",accepted:true,explanation:"We can both use either battlefield, and Keeper’s got a clear route to a point on the other one."},
    {id:"revenge",label:"Attack Elder immediately to conquer that battlefield",accepted:false,explanation:"Keeper would take 4 and deal 2 back, so unless you can change that fight, Elder lives and Keeper dies. Is there somewhere else Keeper could go?"},
    {id:"give-up",label:"The game is over because I lost a battlefield",accepted:false,explanation:"I’ve taken a battlefield, but I haven’t reached eight points. You’ve still got a ready unit in base and somewhere it could score."}
  ]),
  supported(step("recovery-move","Move towards a point for conquering","Move Keeper to the empty Rockfall Path on the right. Its text stops a unit being played straight onto it, but Keeper’s already on the table and can move there.",{type:"move",cardId:"p-keeper",destination:"battlefield-right"},"Move to the empty battlefield"),recoveryGoal,"Look at both battlefields, because a ready unit in base can move to either one."),
  pass("recovery-pass","Pass focus and see if I want to respond. You get a showdown even when the battlefield’s empty, and this time I’ll let you have it."),opponentPass("recovery-guide-pass"),
  {...score("recovery-score","Record the point for conquering the right battlefield with Keeper. We’ve found a point without having to challenge Elder on the other side."),rulesEffect:exercise("score-right")},
  continueStep("recovery-outcome","At a real table I’d look at my opponent’s units, their ready runes and how many cards they’ve got before counting on that point. You can see all of those, but you can’t see their hand. Now you’ve got a battlefield you could defend or reinforce, or you could start planning how to take the other one.")
],"practice");
const resourceGoal="My Elder’s bringing 4 Might to your battlefield, so see if the plan you chose can hold it.";
const resourceSharedTurn=()=>[
  step("budget-end","What have you left open?","End your turn and check your runes. Unspent energy empties, but any runes you left ready are still there to use on my turn. If you’ve exhausted them, my Awaken won’t ready them for you.",{type:"end-turn"},"End turn"),
  guide("budget-guide-ready","The opponent begins","I’ll ready my cards in Awaken, including the Elder I want to attack with. Yours stay as you left them.",{type:"ready",side:"opponent"},["opponent:base"]),
  guide("budget-guide-begin","Check Beginning","I’ve got no battlefield to score for holding and no Beginning ability to deal with, so I can carry on to Channel.",{type:"phase",phase:"Channel",priority:"opponent"}),
  guide("budget-guide-channel","The guide channels two","I’ll channel two ready runes. They’re on my side, so whatever you’re planning to respond with still needs to use your own runes.",{type:"channel",side:"opponent",count:2},["opponent:rune-deck"]),
  guide("budget-guide-draw","The guide draws","I’ll draw one and go into Main. You can’t see what I’ve drawn, but the Elder you’re worried about is already on the table.",{type:"draw",side:"opponent",count:1},["opponent:deck"]),
  guide("budget-attack","Here comes the attack","I’ll move Elder in to attack. It’s got its ordinary 4 Might and your Pickpocket’s on 3, so what else have you brought to this fight?",{type:"move",cardId:"o-elder",destination:"battlefield-left"},["o-elder","battlefield-left"]),
  guide("budget-focus","Your chance to respond","I’ll pass focus, so it’s your chance to act in the showdown. Have a look at those two runes, did you spend them on Keeper or leave them open?",{type:"pass",side:"opponent"},["player:runes"])
];
const developSteps:TutorialStep[]=[
  supported(exhaust(1,"put another defender on your battlefield"),resourceGoal,"You can play Keeper straight onto the battlefield you control. It can still defend even when it comes in exhausted."),
  supported(exhaust(2,"put another defender on your battlefield"),resourceGoal,"Keeper only needs 2 energy here, so make the rest of that cost and leave the runes on the table."),
  supported(step("budget-develop","Play Keeper to defend Monastery","Play Keeper straight onto Monastery for 2 energy and skip its optional power cost. Both runes are exhausted now, and so is Keeper, but being sideways won’t stop it defending here and dealing damage.",{type:"play",cardId:"p-keeper",destination:"battlefield-left"},"Reinforce the battlefield"),resourceGoal,"You already control Monastery, so Keeper can enter there. You only need it to defend where it is, which it can do exhausted."),
  ...resourceSharedTurn(),
  pass("budget-defend-pass","We’ve spent both runes on Keeper, so Discipline’s staying in hand for this fight. Pass focus, because Pickpocket and Keeper give us 3 plus 2 Might between them, enough to kill the 4-Might Elder."),
  exerciseDamage("budget-develop-assign",["p-planner","p-keeper"],"o-elder",5,[{cardId:"p-planner",amount:3,order:1},{cardId:"p-keeper",amount:1,order:2}],"Your two defenders deal 5 to Elder. I’ll put 3 on Pickpocket, enough to kill it, then my remaining 1 on Keeper. Both sides deal this damage together."),
  resolve("budget-develop-damage"),
  guide("budget-develop-result","Keeper retains control","Elder and Pickpocket both died, but Keeper only took 1 against its 2 Might, so it stays and that damage clears. You’ve defended your battlefield, which keeps control without scoring a new conquering point.",exercise("defended"),["p-keeper","battlefield-left"]),
  guide("budget-develop-end","The opponent ends","I’ll end my turn now. Your exhausted runes stay sideways until you get to Awaken on your own turn.",{type:"start-turn",side:"player"},["player:runes"]),
  continueStep("budget-develop-outcome","Keeper’s holding the battlefield for you, and you still have Discipline, but it cost you Pickpocket. Both runes stay exhausted until your Awaken. If you want to see whether Pickpocket could have lived, go Back to the choice or restart and leave those runes open.")
];
const reserveSteps:TutorialStep[]=[
  ...resourceSharedTurn(),
  supported(exhaust(1,"respond before combat damage"),resourceGoal,"You kept both runes ready in your Main, so see what you’ve got in hand that could help Pickpocket survive this attack."),
  supported(exhaust(2,"respond before combat damage"),resourceGoal,"Discipline needs 2 energy and no power, so use the other ready rune for the rest of its cost."),
  supported(step("budget-react","Use what you saved","Spend your 2 energy on Discipline and target Pickpocket. We’ll get the extra Might and draw a card once the spell resolves, but for now it’s still on the chain.",{type:"play",cardId:"p-discipline",targetId:"p-planner"},"Respond"),resourceGoal,"A Reaction can help your defender here, so compare Pickpocket’s Might with Elder’s and look for a way to change it."),
  pass("budget-spell-pass","Pass priority and give me a chance to respond to Discipline. You’ve paid for it, but Pickpocket’s still waiting for that extra Might."),opponentPass("budget-spell-guide-pass"),
  {...resolve("budget-spell-resolve"),rulesEffect:exercise("resolve-response")},
  guide("budget-return-focus","Back to the showdown","Your spell has finished, so the chain’s empty and focus comes back to me. I’ll pass, and now it’s my 4-Might Elder looking across at a 5-Might defender.",{type:"pass",side:"opponent"},["p-planner"]),
  pass("budget-final-pass","Pass focus too. We’ve both had our chance to change the fight, so we can move on to dealing damage."),
  exerciseDamage("budget-reserve-assign",["p-planner"],"o-elder",5,[{cardId:"p-planner",amount:4,order:1}],"Pickpocket deals 5 to Elder at the same time as it takes 4 back. With 5 Might this turn, it can survive that hit."),
  resolve("budget-reserve-damage"),
  guide("budget-reserve-result","Your original unit survives","Elder dies and Pickpocket lives, so its damage clears while Discipline’s extra 2 Might lasts for the rest of the turn. You were already in control, so defending hasn’t earned a new point for conquering.",exercise("defended"),["p-planner","battlefield-left"]),
  guide("budget-reserve-end","The temporary strength ends","I’ll end my turn. Pickpocket’s damage has already cleared, so when Discipline wears off and it goes back to 3 Might, it stays alive. Your Awaken is next.",{type:"start-turn",side:"player"},["p-planner"]),
  continueStep("budget-reserve-outcome","You kept Pickpocket alive, drew a card, and still have Keeper in hand, but you’ve spent Discipline. Both plans held the battlefield against my particular attack, they just leave you with different cards for next turn. An opponent with another response could change either fight.")
];
const resources=addedLesson("resource-decisions","Spend now or keep a response?",{see:"You’re trying Orianna here, with Pickpocket defending and just two ready runes for Keeper or Discipline.",do:"Try playing the extra defender now, or leave the runes ready and use your spell when Elder attacks.",why:"If you’ve got two runes ready, what’s the reason for leaving them open? This is a fight where there’s a good answer."},[
  decision("budget-plan","Choose a real plan","You can see Elder could attack for 4, and you’ve got two ready runes. Would you put Keeper down now, or save those runes for Discipline?",[
    {id:"reserve",label:"Keep both runes ready for a response",accepted:true,explanation:"You’ll have the runes to play Discipline when Elder attacks, so you can spend the spell to try to keep Pickpocket alive."},
    {id:"develop",label:"Play Keeper onto the battlefield now",accepted:true,explanation:"Keeper could hold the battlefield for you even if Pickpocket dies, but once you’ve paid for Keeper, those same runes can’t pay for Discipline."}
  ]),...reserveSteps
],"practice");
resources.branch={decisionStepId:"budget-plan",defaultOptionId:"reserve",variants:{reserve:reserveSteps,develop:developSteps}};
// A new position tests transfer: the same ready unit can earn a point elsewhere
// or reinforce a defence. Both plans are legal, with different lasting costs.
const capstoneGoal="Choose where Keeper’s going, then see if you can hold a battlefield through my turn.";
function capstoneStep(source:TutorialStep):TutorialStep {
  const s=structuredClone(source);s.id=`capstone-${s.id}`;
  if(s.expectedAction.type==="guide")s.expectedAction.eventId=s.id;
  if(s.actor!=="guide"&&s.actor!=="rules"&&!s.decision&&s.expectedAction.type!=="continue"){
    s.guidance="practice";s.practiceGoal=capstoneGoal;
    s.practiceHint=s.expectedAction.type==="move"?"Where could this unit earn a point, and where might you need its Might to defend?":s.expectedAction.type==="exhaust"?"Look at the number on your response and count the ready runes you have to pay it.":s.expectedAction.type==="play"?"Compare the two units’ Might, then check whether you’ve got a Reaction that could change the fight.":s.expectedAction.type==="end-turn"?"Your unit’s moved, so what would you like to leave open for my turn?":s.expectedAction.type==="pass"?"Are you passing on a waiting effect or finishing a showdown? You’re still playing the same turn either way.":s.expectedAction.type==="resolve"?"Have both players passed? If they have, check the newest effect, or the damage if you’ve finished the combat showdown.":"Look at the score, the phase and who’s still at the battlefield, then use Show the next move if you’d like a hand.";
    if(s.expectedAction.type==="exhaust")s.allowedCardIds=["p-rune-1","p-rune-2"];
  }
  return s;
}
const capstoneDebrief=(plan:"spread"|"reinforce"):TutorialStep[]=>[
  continueStep("plan-outcome",plan==="spread"?"You got a point on the other side and kept both units alive. Discipline saved Pickpocket and drew a card, but now it’s in the trash and your two runes stay sideways until Awaken. Both battlefields are yours, so see if you can keep them for Beginning.":"Keeper’s the one still at your battlefield. Your units had 5 Might to kill Elder, but I could put lethal damage on Pickpocket first. You haven’t scored this turn, though you’ve still got Discipline, two ready runes and an empty battlefield on the other side."),
  decision("plan-reflect","What would you check next?","You held on against that attack, so what would you look at before deciding what to do next?",[
    {id:"points",label:"Which battlefield could give me my next point?",accepted:true,explanation:"Who controls each battlefield, and have you scored it on this turn already? A surviving defender can earn a holding point at Beginning."},
    {id:"resources",label:"Which units, cards and ready runes do I still have?",accepted:true,explanation:"See what you’ve actually got left to spend, then look at the units and ready runes across the table. You can use those to judge the risk, even though you can’t see the other player’s hand."}
  ]),
  continueStep("plan-finished","One plan got you a point straight away and used Discipline, the other kept the spell and the runes but cost a unit. Those are the trades you made against this Elder, and another opponent might respond differently. Use Back or restart this exercise if you want to try the other line.")
];
const spreadPlan=[
  step("spread-move","Carry out your scoring plan","Move Keeper from base to the empty right battlefield. That uses its readiness, so it can’t come back to help Pickpocket this turn. Leave your runes open in case Pickpocket needs the spell instead.",{type:"move",cardId:"p-keeper",destination:"battlefield-right"},"Move Keeper"),
  pass("spread-pass","Pass focus at the empty battlefield, because I still get a chance to respond before you take it."),opponentPass("spread-guide-pass"),
  {...score("spread-score","I’ve let Keeper through, so record the point for conquering the right battlefield. It can stay there to try for a holding point on your next turn."),rulesEffect:exercise("score-right")},
  ...resourceSharedTurn(),...reserveSteps.slice(resourceSharedTurn().length,-1),...capstoneDebrief("spread")
].map(capstoneStep);
const reinforceDefence=structuredClone(developSteps.slice(3+resourceSharedTurn().length,-1));
reinforceDefence[0]={...reinforceDefence[0],instruction:"Pickpocket and Keeper have 5 Might between them against Elder’s 4. You could play Discipline, but pass focus if you’d like to save it and the runes, knowing I might be able to kill one of those defenders.",hint:"Do the two defenders already have enough Might to kill Elder? You can choose to pass even when you could afford a spell."};
const reinforceEnd=reinforceDefence.find(s=>s.id==="budget-develop-end")!;
reinforceEnd.instruction="I’ll end my turn. Both of your runes are still ready because you didn’t spend them, but Keeper had to exhaust to move and will ready at your Awaken.";reinforceEnd.hint=reinforceEnd.instruction;
const reinforcePlan=[
  {...step("reinforce-move","Move Keeper over to help","Move Keeper from base to your left battlefield, which uses its readiness and leaves the runes open. You already control it and there’s no enemy there, so moving in doesn’t start a showdown or give you another point.",{type:"move",cardId:"p-keeper",destination:"battlefield-left"},"Reinforce with Keeper"),rulesEffect:exercise("capstone-reinforce")},
  ...resourceSharedTurn(),...reinforceDefence,...capstoneDebrief("reinforce")
].map(capstoneStep);
const capstone=addedLesson("choose-your-plan","Your plan, your next turn",{
  see:"You’ve got Orianna, Pickpocket holding one battlefield and a ready Keeper in base. Across the table is my 4-Might Elder, ready to attack.",
  do:"Choose where to send Keeper, then play out the turn and see which cards and runes you’re left with. You can ask for a clue along the way.",
  why:"I can see a reason to go either way here, so try the one you’d actually play first."
},[
  decision("capstone-plan","Read the board and choose your plan","Keeper can move once, and you’ve got two ready runes and Discipline in hand. Where would you send Keeper?",[
    {id:"spread",label:"Conquer elsewhere, keeping a response for defence",accepted:true,explanation:"Take the empty battlefield with Keeper, then leave your runes ready to help Pickpocket if I go after it."},
    {id:"reinforce",label:"Reinforce the battlefield and keep the spell",accepted:true,explanation:"Bring Keeper over to help Pickpocket, and hang on to Discipline if you’re willing to risk losing one of the defenders."}
  ]),...spreadPlan
],"practice");
capstone.practice={goal:capstoneGoal};
capstone.branch={decisionStepId:"capstone-plan",defaultOptionId:"spread",variants:{spread:spreadPlan,reinforce:reinforcePlan}};
for(const lesson of [planning,simpleCombat,mulligans,recovery,resources])for(const s of lesson.steps)if(s.expectedAction.type==="choose")s.practiceHint="Think about what you’d have left once you made each play, then pick the one that gets you closer to your goal.";

LESSONS.splice(LESSONS.findIndex(l=>l.id==="start-combat"),0,planning,simpleCombat);
const optionalCore=LESSONS.filter(l=>["hidden-cards","keywords-in-combat"].includes(l.id));
const keywords=LESSONS.filter(l=>NEW_PLAYER_KEYWORD_GROUPS.some(g=>g.id===l.id));
const firstGame=LESSONS.filter(l=>!optionalCore.includes(l)&&!keywords.includes(l));
for(const l of firstGame)l.path="first-game";
for(const l of optionalCore)l.path="practice";
for(const l of keywords)l.path="keywords";
const playEffectIntro:TutorialLessonIntro={see:"You’ve got the resources for Thousand-Tailed Watcher, and there are two enemy units sitting in base.",do:"Play Watcher, then see what its ability does after Star-Crossed sends the unit back to your hand.",why:"Once Watcher’s ability is on the chain, sending Watcher away doesn’t take the ability with it."};
const onPlay=(operation:Extract<TutorialGuideEffect,{type:"on-play"}>["operation"]):TutorialGuideEffect=>({type:"on-play",operation});
const starCrossedResponse=(prefix:string,target:string):TutorialStep[]=>[
  guide(`${prefix}-energy`,"Three energy for Star-Crossed","I’ll tap three ready runes for the 3 energy I need for Star-Crossed. It’s a Reaction, which is why I can play it while your effect’s waiting on the chain.",{type:"exhaust-runes",cardIds:["o-rune-1","o-rune-2","o-rune-3"]},["o-rune-1","o-rune-2","o-rune-3"]),
  guide(`${prefix}-power`,"Pay the Chaos symbol too","I’ll recycle one of those exhausted Chaos runes for 1 Chaos power. The 3 energy it helped make is still there, and now I’ve got both parts of the cost.",onPlay("recycle-chaos"),["o-rune-1","opponent:resources"]),
  guide(`${prefix}-play`,"Star-Crossed chooses two units",`I’ll spend 3 energy and 1 Chaos power on Star-Crossed. I have to choose one friendly unit and one enemy unit, so I’ll pick my Mystic Poro and your ${target==="p-watcher"?"Watcher":"Sentry"}. They both stay in base until the spell resolves.`,onPlay("star-crossed-play"),["o-star-crossed","o-mystic-poro",target,"chain"]),
  guide(`${prefix}-guide-pass`,"Your chance to answer Star-Crossed","Star-Crossed’s on top of the chain, and I’ll pass priority. You’ve got a chance to respond before either unit goes back to hand.",{type:"pass",side:"opponent"},["chain"]),
  pass(`${prefix}-pass`,"Pass and let Star-Crossed resolve. Neither unit has moved yet, and your older effect is still waiting underneath my spell."),
  guide(`${prefix}-resolve`,"Both chosen units return to hand","We’ve both passed, so Star-Crossed sends my Mystic Poro and your unit back to our hands, then goes to the trash. Neither unit died, so there’s no Deathknell, and your older effect is still waiting on the chain.",onPlay("star-crossed-resolve"),["o-mystic-poro",target,"chain"])
];
const playEffects:TutorialLesson={id:"unit-play-effects",title:"Units and their play effects",description:"What happens to an ability when its unit leaves, and what happens to a spell when it loses its target?",minutes:8,chapter:"Bring it together",champion:"Ahri",path:"practice",intro:playEffectIntro,scenarioNote:"We’ll try two separate positions with Ahri against Teemo. You can see the two teaching lists in the main-deck drawers, and your main game is saved.",steps:[
  {...continueStep("lesson-intro",`${playEffectIntro.see} ${playEffectIntro.do} ${playEffectIntro.why}`),title:"Units and their play effects",presentation:"lesson-intro",lessonIntro:playEffectIntro,label:"Start this lesson"},
  step("watcher-play","Watcher’s here, what happens next?","Spend the 7 energy and 1 Mind power that are already waiting for Thousand-Tailed Watcher, you can see the runes we used to make them. Play it into base without paying Accelerate, so it comes in exhausted. Its ability still has to happen, and my units haven’t lost any Might yet.",{type:"play",cardId:"p-watcher",destination:"base"},"Play Watcher"),
  {...guide("watcher-trigger","Playing Watcher starts its ability","Watcher’s in base now, and its play ability goes on the chain automatically. It gives every enemy unit −3 Might this turn, down to a minimum of 1, without choosing targets. We can still respond even though the unit’s already on the table.",onPlay("watcher-trigger"),["p-watcher","chain"]),actor:"rules"},
  pass("watcher-pass","Pass priority on Watcher’s ability. I’ve got a chance to play something above it before my units lose any Might."),
  ...starCrossedResponse("watcher-response","p-watcher"),
  pass("watcher-ability-pass","Watcher’s back in your hand, but you can still see its ability on the chain. Pass priority again and give me my chance before you resolve what’s left."),
  guide("watcher-ability-guide-pass","I’ll pass on Watcher’s ability","I’ll pass too. Sending Watcher back didn’t counter its ability, so we’ve both passed on the one effect left on the chain.",{type:"pass",side:"opponent"},["chain"]),
  {...resolve("watcher-ability-resolve"),title:"The ability outlasts its source",instruction:"Resolve Watcher’s ability and check my units. Chronomancer’s still on the board, so it goes from 4 Might to 1 this turn, but Mystic Poro’s already in my hand. Watcher stays in your hand too.",rulesEffect:onPlay("watcher-resolve")},
  {...continueStep("watcher-result","Look at Chronomancer on 1 Might, and Watcher back in your hand. The chain’s empty because the ability finished, even with Watcher gone. Poro had already left the board by then, so it missed the reduction."),title:"What happened to Chronomancer?",label:"Try the target-leaves example"},
  {...continueStep("target-reset","Try a fresh position with Sentry in your base and Discipline in hand. This time we’re going to remove the unit a spell has chosen, so we can see whether the rest of the spell still works."),title:"Reset: what if the target leaves?",presentation:"lesson-intro",lessonIntro:{see:"You’ve got Sentry in base, Discipline in hand and two ready runes.",do:"Play Discipline and let Star-Crossed send its target back to hand, then finish what you can of the spell.",why:"Moving a target won’t counter a whole spell, so it’s worth reading the rest of its instructions."},label:"Try the target-leaves example",rulesEffect:onPlay("reset-target")},
  exhaust(1,"pay for Discipline"),exhaust(2,"pay for Discipline"),
  step("target-discipline","Choose the unit Discipline will help","Spend 2 energy and choose Sentry for Discipline. It says to give the unit +2 Might this turn, then draw a card. While the spell’s on the chain you’re still waiting for both of those things.",{type:"play",cardId:"p-discipline",targetId:"p-sentry"},"Play Discipline"),
  pass("target-spell-pass","Pass priority and give me a chance to respond, while Sentry’s still waiting for the extra Might and you’re still waiting for the card."),
  ...starCrossedResponse("target-response","p-sentry"),
  pass("target-remaining-pass","Sentry’s back in your hand, out of reach of Discipline, but the spell itself is still on the chain. Pass priority on it so we can see how much of its text still works."),
  guide("target-remaining-guide-pass","We can resolve Discipline","I’ll pass as well. Star-Crossed moved the unit you chose, but it didn’t counter Discipline, so we can resolve your spell now.",{type:"pass",side:"opponent"},["chain"]),
  {...resolve("target-discipline-resolve"),title:"Can we still draw the card?",instruction:"Resolve Discipline. Sentry’s gone from the board so it won’t get +2 Might, but you can still follow the next instruction and draw a card. Discipline goes to the trash, and both players have paid for their spells.",rulesEffect:onPlay("discipline-resolve")},
  continueStep("play-effects-result","Watcher left and its ability still worked, then Sentry left and Discipline still drew a card. In the first case it was the source that went away, in the second it was the target. Star-Crossed returned units to hand both times, so it didn’t kill them or counter anything on the chain.")
]};
LESSONS.splice(0,LESSONS.length,...firstGame,mulligans,resources,recovery,playEffects,...optionalCore,capstone,...keywords);

// A learner's turn is never played by the opponent. Keep the same authored
// effects, but require native input for their phases, choices and resolutions.
function requireLearnerAction(s:TutorialStep,action:TutorialAction) {
  s.actor="player";s.expectedAction=action;s.rulesEffect=s.guideEffect;delete s.guideEffect;
  const labels:Partial<Record<TutorialAction["type"],string>>={ready:"Awaken · ready all","check-beginning":"Check Beginning",channel:"Channel ready runes",draw:"Draw 1",pass:"Pass",score:"Conquer · score",resolve:"Resolve",move:"Move your unit"};
  s.label=labels[action.type]??s.label;
  if(["ready","check-beginning","channel","draw"].includes(action.type)){
    delete s.guidance;delete s.practiceHint;
    s.instruction+=` Choose ${s.label} when you’re ready.`;
    s.focusIds=action.type==="channel"?["player:rune-deck"]:action.type==="draw"?["player:deck"]:s.focusIds;
  }
  s.hint=s.instruction;
}
const intrinsicKeywordEvents=new Set(["trigger","deathknell-trigger","temporary-trigger","deathknell-damage","follow-assign","follow-cleanup","level-hunt"]);
const processedSteps=new Set<TutorialStep>();
for(const l of LESSONS)for(const s of [...l.steps,...Object.values(l.branch?.variants??{}).flat()]){
  if(processedSteps.has(s))continue;processedSteps.add(s);
  const e=s.guideEffect;
  if(e){
    if(e.type==="ready"&&e.side==="player")requireLearnerAction(s,{type:"ready"});
    else if(e.type==="channel"&&e.side==="player")requireLearnerAction(s,{type:"channel",ready:true});
    else if(e.type==="draw"&&e.side==="player"||e.type==="draw-card"&&e.cardId.startsWith("p-"))requireLearnerAction(s,{type:"draw"});
    else if(e.type==="phase"&&e.phase==="Channel"&&e.priority==="player")requireLearnerAction(s,{type:"check-beginning"});
    else if(e.type==="pass"&&e.side==="player")requireLearnerAction(s,{type:"pass"});
    else if(e.type==="move"&&e.cardId.startsWith("p-"))requireLearnerAction(s,{type:"move",cardId:e.cardId,destination:e.destination});
    else if(e.type==="score"&&e.side==="player")requireLearnerAction(s,{type:"score"});
    else if(e.type==="resolve-ahri")requireLearnerAction(s,{type:"resolve"});
    else if(e.type==="keyword"){
      const a:Record<string,TutorialAction>={"ready-player":{type:"ready"},"begin-player":{type:"check-beginning"},"channel-player":{type:"channel",ready:true},"draw-player":{type:"draw"}};
      if(a[e.operation])requireLearnerAction(s,a[e.operation]);
      else if(intrinsicKeywordEvents.has(e.operation)||e.operation.startsWith("trigger-death:")||e.operation==="native"&&!!s.combatDemonstration)s.actor="rules";
    }else if(["trigger","assign","hidden-loss"].includes(e.type)||e.type==="exercise"&&e.operation==="defended")s.actor="rules";
    if(s.actor==="rules"){s.label="Next effect";delete s.guidance;}
  }
  if(l.id==="first-or-second"&&s.id==="beginning"){
    s.actor="player";s.expectedAction={type:"check-beginning"};s.label="Check Beginning";
  }
}
const triggerSelections:Record<string,{source:string;target:string;title:string;instruction:string}>={
  "ahri-trigger":{source:"p-champion",target:"o-sentry",title:"Choose Ahri’s target",instruction:"Ahri’s attack triggers her ability, but you choose which enemy gets it. Select the defending Sentry and the ability will go on the chain, ready for both of us to respond before its Might changes."},
  "keyword-disarm-trigger":{source:"player-RAD-050",target:"opponent-OGN-012",title:"Choose the unit to Disarm",instruction:"Attacking with Chronomancer triggers Disarm 2, and you choose the enemy it affects. Select Hopeful, because taking Might off that defender could help your attacker live. The reduction happens when the ability resolves."},
  "keyword-quick-draw-trigger":{source:"player-SFD-022",target:"player-OGN-096",title:"Choose who receives the sword",instruction:"Long Sword’s already on the table and Quick-Draw requires it to attach, but you get to choose the friendly unit. Select Sentry and the attachment will go on the chain, so it hasn’t granted any Might yet."},
  "keyword-weaponmaster-trigger":{source:"player-SFD-002",target:"player-SFD-022",title:"Choose the optional attachment",instruction:"When Assailant enters, Weaponmaster lets you attach gear if you want to. Choose Long Sword for this example, because the discount covers its one-power Equip cost. It attaches when the ability resolves."}
};
for(const l of LESSONS)for(let i=0;i<l.steps.length;i++){
  const s=l.steps[i],choice=triggerSelections[s.id];if(!choice)continue;
  const selected:TutorialStep={...step(`${s.id}-choose`,choice.title,choice.instruction,{type:"choose-trigger",cardId:choice.source,targetId:choice.target},"Choose the target"),actor:"player",focusIds:[choice.target],keywordScenarioId:s.keywordScenarioId,presentation:s.presentation};
  l.steps.splice(i++,0,selected);
  s.instruction=s.id==="ahri-trigger"?"You chose the defending Sentry, so Ahri’s attack ability goes on the chain with its target fixed. We can both still play Reactions before it changes Sentry’s Might.":s.id==="keyword-disarm-trigger"?"Hopeful is your target for Disarm 2, and the attack trigger is now on the chain. We both have a chance to respond before it takes any Might away.":s.id==="keyword-quick-draw-trigger"?"You chose Sentry for Long Sword, so the required Quick-Draw attachment goes on the chain. We can both respond before the sword attaches.":"You’ve chosen to use Weaponmaster on Long Sword. The discount covers its Equip cost, but it stays unattached while the ability waits on the chain.";
  s.hint=s.instruction;
}
// This first cumulative exercise stays more guided than the later decision tasks.
const firstPracticeGoals:Record<string,string>={
  "energy-1":"Turn one, look at the unit you can afford and make the first energy it needs.",
  "energy-2":"Turn one, choose the other ready rune and make the rest of the energy for your unit.",
  "play-sentry":"Turn one, spend that energy to get your unit into base so it can ready on your next turn.",
  "move":"Turn two, Sentry’s ready now, so which empty battlefield could it take for your first point?",
  "pass":"Turn two, give each player a chance to act before you try to claim the battlefield.",
  "conquer":"Turn two, we’ve both finished responding, so record your first point for conquering."
};
for(const s of firstPractice.steps){
  if(s.id==="end-first")continue; // Preserve the explicit end-turn explanation.
  if(s.actor==="guide"||s.actor==="rules"||s.lessonIntro)continue;
  const turn=s.id.startsWith("practice-first-")||["energy-1","energy-2","play-sentry"].includes(s.id)?"Turn one":"Turn two";
  if(!s.title.startsWith("Turn "))s.title=`${turn}: ${s.title.charAt(0).toLowerCase()+s.title.slice(1)}`;
  if(s.guidance==="practice")s.practiceGoal=firstPracticeGoals[s.id]??(s.expectedAction.type==="move"?firstPracticeGoals.move:s.expectedAction.type==="pass"?firstPracticeGoals.pass:s.expectedAction.type==="score"?firstPracticeGoals.conquer:`${turn}: ${s.instruction}`);
}
for(const l of LESSONS)for(const s of l.steps)if(s.guidance==="practice"&&!s.practiceHint){
  s.practiceHint=s.expectedAction.type==="exhaust"?"Look at the number on the card and count your ready runes, each one can give you 1 energy.":s.expectedAction.type==="move"?"Which ready unit could reach a battlefield you want? You can use its readiness to move and keep your energy.":s.expectedAction.type==="play"?"Check when you can play the card and whether you can afford both parts of its cost, then look for somewhere it’ll help.":s.expectedAction.type==="pass"?"Pass if you’re happy for the other player to get a chance, you’re still in the same turn.":s.expectedAction.type==="score"?"Who’s still at the battlefield, and have you already scored it this turn?":s.expectedAction.type==="resolve"?"Have you both passed? Check what’s on top of the chain, or who’s about to deal combat damage if the showdown’s finished.":"Look at what you’ve got on the board and what you want to do, then use Show the next move if you’d like the exact play.";
}
const foundationLessons=createFoundationLessons();
for(const lesson of foundationLessons){
  const after=lesson.id==="scoring-once-per-turn"?"holding":lesson.id==="group-movement"?"simple-combat":lesson.id==="damage-and-might"?"group-movement":lesson.id==="ready-runes-and-defenders"?"the-chain":null;
  LESSONS.splice(after?LESSONS.findIndex(l=>l.id===after)+1:LESSONS.findIndex(l=>l.id==="unit-play-effects"),0,lesson);
}
const mainGameLessonIds=new Set(["table-setup","opening-hand","first-or-second","read-a-card","play-first-unit","power-and-champion","move-to-battlefield","first-conquest","holding","start-combat","the-chain","combat-damage"]);
for(const [index,l] of LESSONS.entries()){
  const main=mainGameLessonIds.has(l.id), returning=main&&index>0&&!mainGameLessonIds.has(LESSONS[index-1].id);
  l.context=main?{
    kind:returning?"return-to-main":"main-game",
    title:returning?"Back to your main game":"Your main game · Ahri against Orianna",
    explanation:returning?"You’re back in your Ahri game, with the same score and units you had when you left it. Have a look at the turn before you make your next play.":"This lesson continues the same Ahri game. Your next move follows the position from the previous main-game lesson."
  }:{
    kind:"separate-exercise",title:l.path==="keywords"?"Separate keyword exercises":"Main game paused · separate exercise",
    explanation:l.path==="keywords"?"Each keyword gets its own board, sometimes with a different legend so that you can use the card we’re looking at. Your main game is saved while we try these separate examples.":"Your main Ahri game is saved while you try this separate exercise. Look at the legends, score and turn below, because we sometimes change decks to give you a chance to try a different card."
  };
  if(l.id==="table-setup")l.context.explanation="You’re playing Ahri and I’m playing Orianna. We’ll set up the table together, then we can draw our opening hands.";
  if(l.id==="win-the-game")l.context.explanation="We’re trying a separate finish with Ahri already on 7 points, so you can play out both ways to win from there.";
}
for(const [index,l] of LESSONS.entries())l.title=`${index+1}. ${l.title.replace(/^\d+\.\s*/,"")}`;

const clone = <T>(value: T): T => structuredClone(value);
function addRunes(board: TutorialBoard, side: TutorialSide, amount: number) {
  const prefix = side === "player" ? "p" : "o";
  if(board.foundation){
    const deck=getNewPlayerTeachingDeck(board.players[side].teachingDeckId)!;const existing=board.cards.filter(c=>c.owner===side&&c.type==="rune").length;
    for(let i=0;i<amount;i++){const domain=deck.domains[(existing+i)%deck.domains.length] as TutorialDomain,rune=PRACTICE_RUNES[domain];board.cards.push(foundationCard(rune.cardId,`${prefix}-rune-${existing+i+1}`,side,"runes"));}board.players[side].runeDeckCount-=amount;return;
  }
  if(board.practice) {
    const legend=board.cards.find(c=>c.owner===side&&c.type==="legend")!;
    const pair=KEYWORD_LEGEND_PAIRS.find(p=>p.legend.cardId===legend.cardId)!;
    const existing=board.cards.filter(c=>c.owner===side&&c.type==="rune").length;
    for(let i=0;i<amount;i++){const n=existing+i+1,domain=pair.domains[(n-1)%pair.domains.length],r=PRACTICE_RUNES[domain];board.cards.push({...card("OGN-089",`${prefix}-rune-${n}`,side,"runes"),...r,domain,domains:[domain],rulesText:`Exhaust for 1 energy. Recycle for 1 ${domain} power.`});}
    board.players[side].runeDeckCount-=amount;return;
  }
  const legend = board.cards.find((c) => c.owner === side && c.type === "legend")?.cardId;
  const pair: [CardCode, CardCode] = legend === "OGN-269" ? ["OGN-214", "OGN-126"]
    : legend === "OGN-263" ? ["OGN-166", "OGN-089"] : legend === "OGN-261" ? ["OGN-214", "OGN-042"] : ["OGN-089", "OGN-042"];
  const existing = board.cards.filter((c) => c.owner === side && c.type === "rune").length;
  for (let i = 0; i < amount; i++) {
    const n = existing + i + 1;
    const code = pair[n % 2 ? 0 : 1];
    board.cards.push(card(code, `${prefix}-rune-${n}`, side, "runes"));
  }
  board.players[side].runeDeckCount -= amount;
}
function initialBoard(physicalSetup = false): TutorialBoard {
  const board: TutorialBoard = { turn: 1, firstPlayer: "player", turnPlayer: "player", phase: "Setup", priority: "player",
    players: { player: { name: "You · Ahri", score: 0, energy: 0, power: {}, deckCount: 35, runeDeckCount: 12 },
      opponent: { name: "Guide · Orianna", score: 0, energy: 0, power: {}, deckCount: 35, runeDeckCount: 12 } },
    cards: [card("OGN-255", "p-legend", "player", "legend"), card("OGN-119", "p-champion", "player", "champion"),
      card("OGN-096", "p-sentry", "player", "hand"), card("OGN-096", "p-sentry-2", "player", "hand"),
      card("OGN-119", "p-opening-ahri", "player", "hand"), card("OGN-058", "p-discipline-2", "player", "hand"),
      card("RAD-145", "o-legend", "opponent", "legend"), card("RAD-068", "o-champion", "opponent", "champion"),
      card("OGN-096", "o-sentry", "opponent", "hand"), card("OGN-096", "o-sentry-2", "opponent", "hand"),
      card("OGN-058", "o-discipline", "opponent", "hand"), card("OGN-058", "o-discipline-2", "opponent", "hand")],
    battlefields: (["OGN-282", "SFD-216"] as const).map((code, index) => ({ id: index === 0 ? "battlefield-left" : "battlefield-right", cardId: code, name: CARD_IDENTITIES[code].name, imageUrl: CARD_IDENTITIES[code].imageUrl, controller: null, scoredBy: [] })),
    chain: [], combat: null, log: ["A scripted learning match. No live Atlas game or account is connected."] };
  if (physicalSetup) {
    board.setup = { stage: "legend", completedItems: [], selectedBattlefieldId: null, battlefieldOptions: [
      { cardId: "OGN-282", name: CARD_IDENTITIES["OGN-282"].name, imageUrl: CARD_IDENTITIES["OGN-282"].imageUrl },
      { cardId: "RAD-163", name: "Hunters' Circle", imageUrl: "https://cdn.piltoverarchive.com/temporary/1790843714259-tcp81yfeqh.webp" },
      { cardId: "SFD-218", name: "Sunken Temple", imageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/06f6d17929d19000006cf281d013ecbe1543af0e-1039x744.png?accountingTag=RB" }
    ] };
    for (const side of Object.values(board.players)) side.deckCount = 40;
    for (const c of board.cards) { c.zone = c.type === "legend" ? "setup" : "deck"; c.faceDown = c.type !== "legend"; }
  }
  return board;
}
function findCard(board: TutorialBoard, id: string) { return board.cards.find((c) => c.instanceId === id); }
function place(board: TutorialBoard, id: string, zone: TutorialZone, ready = true) {
  const c = findCard(board, id)!; c.zone = zone; c.ready = ready; c.faceDown = false;
  if (["trash", "hand", "champion", "deck"].includes(zone)) { c.might = c.baseMight; c.damage = 0; }
  return c;
}
function fieldAt(board: TutorialBoard, id: TutorialBattlefieldId) { return board.battlefields.find((f) => f.id === id)!; }

const PRACTICE_RUNES: Record<TutorialDomain, {cardId:string;name:string;imageUrl:string}> = {
  "Fury": {
    "cardId": "OGN-007",
    "name": "Fury Rune",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/12bcd0cde5d9ff4640e82945001e9fef863530f1-744x1039.png"
  },
  "Calm": {
    "cardId": "OGN-042",
    "name": "Calm Rune",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0a0e8c3d16c2595e2f8efcc2b1466226539b506c-744x1039.png?accountingTag=RB"
  },
  "Mind": {
    "cardId": "OGN-089",
    "name": "Mind Rune",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/f99aa4874baaebd2e81798c8a3aa01c5900f6d30-744x1039.png"
  },
  "Body": {
    "cardId": "OGN-126",
    "name": "Body Rune",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/3b3c3c07626d6180457c849047e0228dc0d19539-744x1039.png?accountingTag=RB"
  },
  "Chaos": {
    "cardId": "OGN-166",
    "name": "Chaos Rune",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/daf23b0deaa5e1a5a5d310b59e9ad25d1bd70363-744x1039.png?accountingTag=RB"
  },
  "Order": {
    "cardId": "OGN-214",
    "name": "Order Rune",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/35ec6fdd2124324bb7052cba31c8c44f2e98f3ae-744x1039.png"
  }
};

const keywordBoardCache = new Map<string, TutorialBoard>();
const keywordPositionSignature = (board: TutorialBoard) => JSON.stringify([board.cards, board.players, board.battlefields, board.chain, board.combat, board.phase, board.turnPlayer, board.priority, board.turn, board.passedBy]);

/** Build an explicit independent practice position on the same board contract as the main game. */
export function createKeywordTutorialBoard(scenarioId: string, stage: "before" | "after" = "before"): TutorialBoard {
  const cached = keywordBoardCache.get(`${scenarioId}:${stage}`);
  if (cached) return clone(cached);
  const scenario = NEW_PLAYER_KEYWORD_SCENARIOS.find((item) => item.id === scenarioId);
  if (!scenario?.board || !scenario.boardAction) throw new Error(`Missing authored keyword board: ${scenarioId}`);
  const snapshot = scenario[stage], context = scenario.board, position = context[stage];
  const playerPair = KEYWORD_LEGEND_PAIRS.find((pair) => pair.legend.cardId === context.playerLegendId)!;
  const opponentPair = KEYWORD_LEGEND_PAIRS.find((pair) => pair.legend.cardId === context.opponentLegendId)!;
  const convert = (source: KeywordScenarioCard): TutorialCard => ({
    instanceId: source.instanceId, cardId: source.cardId, name: source.name, imageUrl: source.imageUrl,
    owner: source.owner, type: source.type ?? "unit", zone: source.zone as TutorialZone,
    ready: source.ready, faceDown: source.faceDown ?? (source.owner === "opponent" && source.zone === "hand"),
    champion: source.zone === "champion", might: source.might ?? source.baseMight ?? 0, baseMight: source.baseMight ?? 0,
    damage: source.damage ?? 0, energyCost: source.energyCost ?? 0, powerCost: source.powerCost ?? 0,
    domain: source.domains?.[0] ?? playerPair.domains[0], domains: source.domains ?? [], token: source.token,
    rulesText: source.text ?? "", keywords: [...source.keywords ?? [], ...(source.empowered ? ["Deflect", "Assault"] : [])],
    annotation: source.annotation, attachedTo: source.attachedTo, empowered: source.empowered,
    ...(source.hiddenAt ? { hiddenAt: source.hiddenAt, hiddenOnTurn: 3 } : {})
  });
  const b = initialBoard();
  b.cards = snapshot.cards.map(convert);
  b.phase = position.phase; b.turn = scenarioId === "keyword-shield" && stage === "after" ? 6 : 5;
  b.turnPlayer = position.turnPlayer; b.priority = position.priority;
  b.chain = clone(position.chain); b.combat = clone(position.combat);
  for (const side of ["player", "opponent"] as const) {
    const pair = side === "player" ? playerPair : opponentPair, resources = side === "player" ? snapshot.player : snapshot.opponent ?? {};
    const prefix = side === "player" ? "p" : "o";
    const teachingDeckId = side === "player" && scenario.keyword === "Unique" ? "pa-practice-ornn" : side === "player" && scenario.keyword === "Hidden" ? "pa-practice-viktor" : (side === "player" && ["Deathknell","Tank","Backline"].includes(scenario.keyword) || side === "opponent" && ["Vision","Unique","Show Off"].includes(scenario.keyword)) ? "pa-kaisa" : DEFAULT_TEACHING_DECK_BY_LEGEND[pair.legend.cardId];
    const deck = getNewPlayerTeachingDeck(teachingDeckId)!;
    const extraChampion=KEYWORD_DECK_IDENTITIES[deck.championId as keyof typeof KEYWORD_DECK_IDENTITIES];
    const chosen:KeywordScenarioCard=extraChampion?{...pair.champion,...extraChampion,type:"unit",domains:[...extraChampion.domains],keywords:[...extraChampion.keywords],cardId:deck.championId}:pair.champion;
    b.cards.push(convert({ ...pair.legend, owner: side, instanceId: `${prefix}-legend` }), convert({ ...chosen, owner: side, instanceId: `${prefix}-champion` }));
    const runeCount = side === "player" ? context.runeCount : scenario.keyword === "Unique" ? 0 : position.opponentRuneCount ?? 4;
    for (let index = 0; index < runeCount; index++) {
      const domain = pair.domains[index % pair.domains.length], rune = PRACTICE_RUNES[domain];
      b.cards.push(convert({ ...rune, instanceId: `${prefix}-rune-${index+1}`, owner: side, zone: "runes", ready: side === "opponent" && Boolean(position.opponentRunesReady), type: "rune", domains: [domain], text: `Exhaust: add 1 energy. Recycle: add 1 ${domain} power.` }));
    }
    const knownHand = b.cards.filter(c => c.owner === side && c.zone === "hand").length;
    const handCount = resources.handCount ?? knownHand;
    const knownOutsideDeck = b.cards.filter(c => c.owner === side && c.type !== "rune" && c.type !== "legend" && !c.token && c.zone !== "deck").length;
    b.players[side] = { teachingDeckId, name: `${side === "player" ? "You" : "Guide"} · ${pair.legend.name.split(",")[0]}`, score: resources.score ?? 0, energy: resources.energy ?? 0,
      power: resources.power ? { [side === "player" ? context.powerDomain : pair.domains[0]]: resources.power } : {},
      handCount, ...(resources.xp !== undefined ? { xp: resources.xp } : {}),
      deckCount: (scenario.keyword === "Unique" && stage === "before" && side === "player" ? 41 : 40) - knownOutsideDeck - Math.max(0, handCount-knownHand), runeDeckCount: 12-runeCount };
  }
  for (let index = 0; index < b.battlefields.length; index++) {
    const field = b.battlefields[index]; field.controller = position.controllers[index]; field.scoredBy = clone(position.scoredBy?.[field.id] ?? []);
  }
  // A displayed battlefield must come from that side’s declared three-card pool.
  for(const [index,side] of (["player","opponent"] as const).entries()){
    const deck=getNewPlayerTeachingDeck(b.players[side].teachingDeckId)!;
    const preferred=index===0?(["Deathknell","Tank","Backline"].includes(scenario.keyword)?"OGN-296":scenario.keyword==="Hidden"?"OGN-293":"OGN-282"):"SFD-216";
    const id=deck.battlefields.some(f=>f.cardId===preferred)?preferred:deck.battlefields[0].cardId;
    const identity=KEYWORD_DECK_IDENTITIES[id as keyof typeof KEYWORD_DECK_IDENTITIES]??CARD_IDENTITIES[id as keyof typeof CARD_IDENTITIES];
    if(identity){b.battlefields[index].cardId=id;b.battlefields[index].name=identity.name;b.battlefields[index].imageUrl=identity.imageUrl;}
    else if(b.practice?.mode!=="deck-check"&&scenario.keyword!=="Unique")throw new Error(`Missing verified battlefield ${id}`);
  }
  b.keywordScenario = { id: scenario.id, revealed: stage === "after", snapshot: clone(snapshot) };
  b.practice = { title: scenario.title, keyword: scenario.keyword, stage, mode: scenario.keyword === "Unique" ? "deck-check" : "game",
    note: `For this separate ${scenario.keyword} example you’re playing ${playerPair.legend.name} into ${opponentPair.legend.name}. ${snapshot.note ?? "You can see the cards we need for this play, and the hand counts include any others."} Open your Main Deck to see the full starting list, or look in About this practice position for both deck sources. We’ve labelled the teaching decks and kept the published lists as they were. We set this board up for the lesson, with both chosen champions in their zones and neither legend ability in use.` };
  b.log = [b.practice.note, ...(stage === "after" ? [scenario.explanation] : [])];
  if (stage === "before") prepareKeywordSequenceBoard(b, scenario);
  refreshMightModifiers(b);
  keywordBoardCache.set(`${scenarioId}:${stage}`, clone(b));
  return b;
}

function prepareKeywordSequenceBoard(b: TutorialBoard, scenario: KeywordScenario) {
  const k=scenario.keyword;
  b.players.player.energy=0; b.players.player.power={};
  for (const c of b.cards) if(c.owner==="player"&&c.type==="rune") c.ready=true;
  b.keywordScenario!.revealed=false;
  if(k==="Ganking") {place(b,"player-OGN-036","battlefield-left",false);b.phase="Awaken";b.priority="player";b.players.player.score=1;fieldAt(b,"battlefield-left").scoredBy=[];b.chain=[];b.combat=null;}
  if(k==="Action") {place(b,"player-OGN-010","base",true);b.phase="Main";b.priority="player";b.chain=[];b.combat=null;}
  if(k==="Disarm") { place(b,"player-RAD-050","base",true); b.phase="Main";b.priority="player";b.chain=[];b.combat=null; }
  if(k==="Legion") { place(b,"player-OGN-010","hand",true); b.players.player.handCount=(b.players.player.handCount??0)+1; }
  if(k==="Hidden") {
    const c=place(b,"player-OGN-213","hand",true);c.faceDown=false;delete c.hiddenAt;delete c.hiddenOnTurn;c.annotation="Hide this during your Main phase, then wait for another turn.";
    b.players.player.handCount=(b.players.player.handCount??0)+1;
    place(b,"opponent-OGN-096","base",true).might=1;b.turnPlayer="player";b.phase="Main";b.priority="player";b.combat=null;b.chain=[];
  }
  if(k==="Temporary") { b.phase="Awaken";b.priority="player";b.chain=[]; }
  if(k==="Deathknell") {
    place(b,"player-OGN-096","battlefield-left",false);b.chain=[];b.phase="Combat damage";b.priority=null;
    b.combat={battlefieldId:"battlefield-left",attacker:"opponent",assignments:{"opponent-OGN-010":1}};fieldAt(b,"battlefield-left").controller="player";
  }
}
function keywordCardFromExample(scenario:KeywordScenario, id:string):TutorialCard {
  const c=[...createKeywordTutorialBoard(scenario.id,"after").cards].find(c=>c.instanceId===id);
  if(!c) throw new Error(`Missing authored card ${id}`);return clone(c);
}
function addTrigger(b:TutorialBoard, cardId:string,label:string,targetId?:string) {
  if(b.combat?.pendingTriggers)b.combat.pendingTriggers=b.combat.pendingTriggers.filter(id=>id!==cardId);
  const c=findCard(b,cardId);if(!c)throw new Error(`Missing trigger source ${cardId}`);
  b.chain.push({id:`${cardId}:trigger`,cardId:c.cardId,controller:c.owner,label,targetId});b.priority=c.owner;b.passedBy=[];
}
function passPriority(b:TutorialBoard,side:TutorialSide) {
  if(b.priority!==side)throw new Error(`It is not ${side}'s priority to pass.`);
  b.passedBy=[...(b.passedBy??[]),side];
  if(new Set(b.passedBy).size===2){b.priority=null;if(!b.chain.length)b.phase=b.combat?"Combat damage":"Conquer";}
  else b.priority=side==="player"?"opponent":"player";
}

function spendKeywordCost(b:TutorialBoard,s:KeywordScenario, energy=s.before.player.energy??0,power=s.before.player.power??0) {
  const p=b.players.player,domain=s.board!.powerDomain;
  if(p.energy<energy||(p.power[domain]??0)<power)throw new Error("Make the full energy and matching power before paying this cost.");
  p.energy-=energy;if(power)p.power[domain]=(p.power[domain]??0)-power;
}
/** Apply one keyword rules event. Resource pools, recycled runes and prior chain
 * items persist; no event replaces the board with an outcome snapshot. */
function checkKeywordDamage(b:TutorialBoard,sourceSide:TutorialSide,entries:Array<{cardId:string;amount:number;order?:number}>){
  const field=b.combat!.battlefieldId;
  const total=b.cards.filter(c=>c.type==="unit"&&c.owner===sourceSide&&c.zone===field).reduce((n,c)=>n+(c.stunned?0:c.might),0);
  const enemies=b.cards.filter(c=>c.type==="unit"&&c.owner!==sourceSide&&c.zone===field);
  const ordered=[...entries].sort((a,z)=>(a.order??0)-(z.order??0));
  if(ordered.reduce((n,a)=>n+a.amount,0)!==total||new Set(ordered.map(a=>a.cardId)).size!==ordered.length)throw new Error("Assign exactly the side’s current Might once across real targets.");
  const assigned=new Map<string,number>();
  for(const [index,a] of ordered.entries()){
    const target=enemies.find(c=>c.instanceId===a.cardId);
    if(!target||!Number.isInteger(a.amount)||a.amount<0)throw new Error("Combat assignments need enemy units at this battlefield.");
    const unfinished=(c:TutorialCard)=>(assigned.get(c.instanceId)??0)<Math.max(0,c.might-c.damage);
    if(!target.keywords.includes("Tank")&&enemies.some(c=>c.keywords.includes("Tank")&&unfinished(c)))throw new Error("Assign lethal to Tank first.");
    if(target.keywords.includes("Backline")&&enemies.some(c=>!c.keywords.includes("Backline")&&unfinished(c)))throw new Error("Reach Backline after the other units.");
    if(index<ordered.length-1&&a.amount!==Math.max(0,target.might-target.damage))throw new Error("Give the first unit enough damage to kill it, then move on. Any extra goes to the last unit.");
    assigned.set(a.cardId,a.amount);
  }
}
/** Combat designations end only after the result, conquest and their pending chains. */
export function finishTutorialCombat(b:TutorialBoard): boolean {
  if(!b.combat)return true;
  if(b.chain.length || b.combat.pendingTriggers?.length)return false;
  for(const unit of b.cards.filter(c=>c.type==="unit"&&c.zone===b.combat!.battlefieldId)){
    if(unit.damage)throw new Error("Clear surviving combat damage before ending combat-only Might.");
    unit.might-=(unit.mightModifiers??[]).filter(m=>/Assault|Shield/.test(m.label)).reduce((n,m)=>n+m.amount,0);
    unit.annotation="Combat’s finished, so the unit keeps the Might it gets from its own card, its gear and any effects still lasting this turn.";
  }
  b.combat=null;
  return true;
}
function settleConqueredCombat(b:TutorialBoard){
  if(!b.combat)return;
  b.combat.pendingEnd=true;
  b.combat.pendingTriggers=b.cards.filter(c=>c.type==="unit"&&c.zone===b.combat!.battlefieldId&&c.owner==="player"&&c.keywords.includes("Hunt")).map(c=>c.instanceId);
  finishTutorialCombat(b);
}
// These authored card-started showdown chains pass focus when they empty.
// Trigger-only chains (Disarm, Deathknell, Hunt) preserve that resulting focus.
function keywordReturnedPriority(b:TutorialBoard,s:KeywordScenario):TutorialSide{
  return /showdown/i.test(b.phase)&&["Action","Quick-Draw","Repeat","Hidden"].includes(s.keyword)?"opponent":"player";
}
function applyKeywordEvent(b:TutorialBoard,s:KeywordScenario,op:string) {
  const k=s.keyword, native=s.boardAction!;
  const id="cardId" in native ? native.cardId : undefined;
  const c=id?findCard(b,id):undefined;
  const target="targetId" in native ? native.targetId : undefined;
  const afterCard=(key:string)=>s.after.cards.find(c=>c.instanceId===key);
  const applyCardOutcome=(key:string)=>{
    const current=findCard(b,key),out=afterCard(key);if(!current||!out)return;
    current.might=out.might??current.might;current.annotation=out.annotation;
    if(out.attachedTo){current.attachedTo=out.attachedTo;current.zone=findCard(b,out.attachedTo)!.zone;}
    if(out.empowered!==undefined){current.empowered=out.empowered;if(out.empowered)current.keywords=[...new Set([...current.keywords,"Deflect","Assault"])];}
  };
  if(op==="gank-hold"){if(b.phase!=="Beginning")throw new Error("Hold during Beginning after Awaken.");scoreField(b,"battlefield-left","hold");b.phase="Channel";return;}
  if(op.startsWith("vi-activate:")){
    const vi=findCard(b,"player-OGN-036")!,paid=findCard(b,op.slice(12));
    if(b.turnPlayer!=="player"||b.phase!=="Main"||b.chain.length||!paid||paid.owner!=="player"||paid.zone!=="trash")throw new Error("Use Vi in your open Main phase and recycle a real card from your trash for each use.");
    paid.zone="deck";paid.faceDown=true;paid.annotation="Recycled to the bottom as Vi’s activation cost.";b.players.player.deckCount++;
    addTrigger(b,vi.instanceId,"Vi — +1 Might this turn");return;
  }
  if(op==="vi-resolve"){
    if(b.priority!==null||b.chain.at(-1)?.cardId!=="OGN-036")throw new Error("Both players must pass before Vi’s ability happens.");
    b.chain.pop();findCard(b,"player-OGN-036")!.might++;b.priority="player";b.passedBy=[];return;
  }
  if(op==="counter-play") {
    const counter=findCard(b,"player-OGN-045")!,target=findCard(b,"opponent-OGN-004")!;
    if(counter.zone!=="hand"||target.zone!=="chain"||target.type!=="spell"||target.energyCost>4||target.powerCost>1||b.priority!=="player")throw new Error("Defy needs priority and an eligible spell still waiting on the chain.");
    spendKeywordCost(b,s,1,1);counter.zone="chain";b.players.player.handCount!--;
    b.chain.push({id:counter.instanceId,cardId:counter.cardId,controller:"player",label:"Defy → Cleave",targetId:target.instanceId});b.priority="player";b.passedBy=[];return;
  }
  if(op==="counter-resolve") {
    if(b.priority!==null)throw new Error("Both players must pass before Defy resolves.");
    const top=b.chain.at(-1);if(top?.cardId!=="OGN-045"||top.targetId!=="opponent-OGN-004")throw new Error("Defy must resolve above its waiting Cleave target.");
    const target=findCard(b,top.targetId)!,counter=findCard(b,top.id)!;
    b.chain=b.chain.filter(item=>item.id!==top.id&&item.id!==target.instanceId);target.zone="trash";counter.zone="trash";
    target.annotation="Countered: no instructions happen and paid costs are not refunded.";counter.annotation="Resolved: the original Cleave was countered.";
    b.priority=b.chain.at(-1)?.controller??keywordReturnedPriority(b,s);b.passedBy=[];return;
  }
  if(op==="action-attack") {
    const unit=findCard(b,"player-OGN-010")!;
    if(!unit.ready||unit.zone!=="base"||b.phase!=="Main"||b.chain.length)throw new Error("Move the ready Rearguard from base during your open Main phase.");
    unit.zone="battlefield-left";unit.ready=false;b.combat={battlefieldId:"battlefield-left",attacker:"player",assignments:{}};b.phase="Combat showdown";b.priority="player";b.passedBy=[];return;
  }
  if(op==="next-player-turn"){newTurn(b,"player");return;}
  if(op==="ready-player"){readySide(b,"player");b.phase="Beginning";return;}
  if(op==="begin-player"){b.phase="Channel";return;}
  if(op==="channel-player"){addRunes(b,"player",2);b.phase="Draw";return;}
  if(op==="draw-player"){draw(b,"player");b.phase="Main";b.priority="player";return;}
  if(op==="vision-draw"){
    const reached=keywordCardFromExample(s,"vision-next");reached.zone="hand";reached.faceDown=false;
    b.cards.push(reached);b.players.player.deckCount--;b.players.player.handCount=(b.players.player.handCount??0)+1;b.phase="Main";b.priority="player";return;
  }
  if(op==="level-hunt"){addTrigger(b,"player-UNL-016","Hunt 2 — gain 2 XP");return;}
  if(op==="gain-hunt"){if(b.priority!==null||!b.chain.pop())throw new Error("Pass before resolving Hunt.");b.players.player.xp=(b.players.player.xp??0)+2;b.priority="player";return;}
  if(op.startsWith("trigger-death:")){addTrigger(b,op.slice(14),"Watchful Sentry — Deathknell: draw 1");return;}
  if(op.startsWith("score:")){scoreField(b,op.slice(6) as TutorialBattlefieldId,"conquer");settleConqueredCombat(b);b.phase="Main";b.priority="player";return;}
  if(op==="follow-move"){
    const move=s.followThrough!.move!,unit=findCard(b,move.cardId)!;
    if(!unit.ready||b.phase!=="Main"||b.chain.length)throw new Error("This move needs a ready unit in your open Main phase.");
    unit.zone=move.destination;unit.ready=false;
    for(const gear of b.cards.filter(c=>c.attachedTo===unit.instanceId))gear.zone=unit.zone;
    const enemy=b.cards.some(c=>c.type==="unit"&&c.owner!==unit.owner&&c.zone===move.destination);
    b.phase=enemy?"Combat showdown":"Showdown";b.priority="player";b.passedBy=[];
    if(enemy)b.combat={battlefieldId:move.destination,attacker:"player",assignments:{}};
    if(k==="Empower")unit.might=8;
    if(k==="Deploy")unit.might=5;
    return;
  }
  if(op==="follow-assign"){
    if(b.priority!==null||b.chain.length||!b.combat)throw new Error("Both sides must finish the showdown first.");
    const demo=s.followThrough!.combat!;
    checkKeywordDamage(b,"player",demo.targetAssignments);checkKeywordDamage(b,"opponent",demo.returnAssignments??[]);
    b.combat.assignments=Object.fromEntries(demo.targetAssignments.map(a=>[a.cardId,a.amount]));return;
  }
  if(op==="follow-damage"){
    if(!b.combat||!Object.keys(b.combat.assignments).length)throw new Error("Assign combat damage first.");
    for(const a of [...s.followThrough!.combat!.targetAssignments,...s.followThrough!.combat!.returnAssignments??[]])findCard(b,a.cardId)!.damage+=a.amount;
    return;
  }
  if(op==="follow-cleanup"){
    if(!b.combat)throw new Error("No combat is waiting for cleanup.");
    const field=b.combat.battlefieldId;
    for(const unit of b.cards.filter(c=>c.type==="unit"&&c.zone===field)){
      if(unit.damage>=unit.might)kill(b,unit,false);
      else {unit.damage=0;unit.annotation="This unit survived, so its damage has cleared. It stays in combat until the result is recorded.";}
    }
    if(!s.followThrough?.conquer)finishTutorialCombat(b);
    b.phase=s.followThrough?.conquer?"Conquer":"Main";b.priority=s.followThrough?.conquer?"player":b.turnPlayer;b.passedBy=[];return;
  }
  if(op==="intro")return;
  if(op==="finish") { b.keywordScenario!.revealed=true;b.practice!.stage="after";b.log.push(s.explanation);return; }
  if(op==="pass"||op==="opponent-pass"){passPriority(b,"opponent");return;}
  if(op==="player-priority"){b.priority="player";return;}
  if(op==="ready-opponent"){readySide(b,"opponent");b.phase="Beginning";return;}
  if(op==="channel-opponent"){addRunes(b,"opponent",2);b.phase="Draw";return;}
  if(op==="draw-opponent"){draw(b,"opponent");b.phase="Main";return;}
  if(op==="hidden-buff-resolve") {
    if(b.priority!==null||b.chain.at(-1)?.cardId!=="OGN-058")throw new Error("Both players must pass on Discipline first.");
    mutate(b,{type:"resolve"},"keyword-equipment","hidden-buff-resolve");b.priority="opponent";return;
  }
  if(op==="hidden-other-reset") {
    const fresh=createKeywordTutorialBoard(s.id);const blade=findCard(fresh,"player-OGN-213")!;
    blade.zone="hidden";blade.faceDown=true;blade.hiddenAt="battlefield-left";blade.hiddenOnTurn=5;fresh.players.player.handCount!--;
    fresh.turn=6;fresh.turnPlayer="opponent";fresh.phase="Main";fresh.priority="opponent";fresh.passedBy=[];
    readySide(fresh,"opponent");addRunes(fresh,"opponent",2);
    findCard(fresh,"opponent-OGN-096")!.might=3;
    const spell=findCard(fresh,"opponent-OGN-058")!;spell.zone="trash";spell.faceDown=false;fresh.players.opponent.handCount!--;
    findCard(fresh,"o-rune-1")!.ready=false;findCard(fresh,"o-rune-2")!.ready=false;draw(fresh,"opponent",2);
    const rune=findCard(fresh,"p-rune-1")!;rune.zone="rune-deck";rune.faceDown=true;rune.ready=false;fresh.players.player.runeDeckCount++;
    fresh.log=["We’re back before Sentry chooses a battlefield, with Discipline already paid for and resolved."];Object.assign(b,fresh);return;
  }
  if(op==="hidden-conquer"){
    const field=fieldAt(b,"battlefield-left");if(b.cards.some(c=>c.type==="unit"&&c.owner==="player"&&c.zone===field.id))throw new Error("The guide cannot conquer a contested battlefield.");
    const attacker=findCard(b,"opponent-OGN-096")!;attacker.damage=0;b.combat=null;field.controller="opponent";field.scoredBy.push("opponent");b.players.opponent.score++;b.phase="Main";b.priority="opponent";return;
  }
  if(op==="hidden-attack") {
    place(b,"opponent-OGN-096","battlefield-left",false);
    b.combat={battlefieldId:"battlefield-left",attacker:"opponent",assignments:{}};b.phase="Combat showdown";b.priority="opponent";return;
  }
  if(op==="deploy-hold"){b.players.opponent.score++;fieldAt(b,"battlefield-left").scoredBy=["opponent"];b.phase="Beginning";return;}
  if(op==="legion-first") {
    spendKeywordCost(b,s,2,0);place(b,"player-OGN-010","base",false);b.players.player.handCount!--;return;
  }
  if(op==="temporary-awaken") {readySide(b,"player");b.phase="Beginning";return;}
  if(op==="temporary-trigger") {addTrigger(b,"player-UNL-T07","Temporary — kill Sprite before holding");return;}
  if(op==="deathknell-damage") {findCard(b,"player-OGN-096")!.damage=2;findCard(b,"opponent-OGN-010")!.damage=1;return;}
  if(op==="deathknell-trigger") {
    const deadId=k==="Backline"?"opponent-OGN-096":"player-OGN-096";
    const dead=findCard(b,deadId)!;if(dead.zone!=="trash")kill(b,dead,false);
    if(k==="Deathknell"){findCard(b,"opponent-OGN-010")!.damage=0;b.combat=null;}
    addTrigger(b,deadId,"Watchful Sentry — Deathknell: draw 1");return;
  }
  if(op==="deathknell") {const top=b.chain.pop();if(!top)throw new Error("No Deathknell trigger is waiting.");draw(b,top.controller);b.priority=keywordReturnedPriority(b,s);b.passedBy=[];return;}
  if(op==="combat") {
    if(!b.combat||!Object.keys(b.combat.assignments).length)throw new Error("Show the legal assignment first.");
    for(const a of s.combatDemonstration!.targetAssignments)findCard(b,a.cardId)!.damage+=a.amount;
    for(const a of s.combatDemonstration!.returnAssignments??[])findCard(b,a.cardId)!.damage+=a.amount;
    for(const unit of b.cards.filter(c=>c.type==="unit"&&c.zone===b.combat!.battlefieldId))if(unit.damage>=unit.might)kill(b,unit,false);else unit.damage=0;
    b.combat=null;b.phase="Conquer";b.priority="player";return;
  }
  if(op==="predict") {const top=findCard(b,"player-OGN-096")!;top.annotation="You looked at the card privately and recycled it to the bottom, without drawing it or showing your opponent.";top.faceDown=true;b.priority="player";return;}
  if(op==="trigger") {
    const sourceId=k==="Disarm"?"player-RAD-050":k==="Hunt"?"player-UNL-016":id!;
    const chosen=k==="Weaponmaster"?"player-SFD-022":k==="Quick-Draw"?"player-OGN-096":k==="Disarm"?"opponent-OGN-012":undefined;
    if(chosen&&b.decisions?.[`trigger:${sourceId}`]!==chosen)throw new Error("Choose this triggered ability’s target first.");
    addTrigger(b,sourceId,`${k} — ${k==="Hunt"?"gain 2 XP":k==="Vision"?"Predict 1":"resolve the chosen effect"}`,chosen);
    if(chosen)delete b.decisions![`trigger:${sourceId}`];return;
  }
  if(op==="native") {
    if(k==="Unique"){if(b.practice?.mode!=="deck-check")throw new Error("This is a pre-game deck check.");b.cards=b.cards.filter(c=>c.instanceId!=="cape-second");b.players.player.deckCount--;b.practice!.stage="after";return;}
    if(k==="Shield") {place(b,"opponent-OGN-054","battlefield-left",false);findCard(b,"player-OGN-054")!.might=4;b.combat={battlefieldId:"battlefield-left",attacker:"opponent",assignments:{}};b.phase="Combat showdown";b.priority="player";return;}
    if(k==="Tank"||k==="Backline"){b.combat!.assignments=Object.fromEntries(s.combatDemonstration!.targetAssignments.map(a=>[a.cardId,a.amount]));return;}
    if(k==="Hunt") {scoreField(b,"battlefield-left","conquer");b.phase="Main";b.priority="player";return;}
    if(k==="Disarm"||native.type==="move") {
      const moving=k==="Disarm"?findCard(b,"player-RAD-050")!:c!;
      const destination=k==="Disarm"?"battlefield-left":(native as {destination:TutorialBattlefieldId}).destination;
      if(!moving.ready||b.phase!=="Main"||b.chain.length)throw new Error("A standard move needs a ready unit in your open Main phase.");
      const old=moving.zone;moving.zone=destination;moving.ready=false;applyCardOutcome(moving.instanceId);
      if(old.startsWith("battlefield")&&!b.cards.some(x=>x.owner==="player"&&x.type==="unit"&&x.zone===old))fieldAt(b,old as TutorialBattlefieldId).controller=null;
      const enemy=b.cards.some(x=>x.owner==="opponent"&&x.type==="unit"&&x.zone===destination);
      if(enemy){b.phase="Combat showdown";b.combat={battlefieldId:destination,attacker:"player",assignments:{}};}else b.phase="Showdown"; b.priority="player";return;
    }
    if(native.type==="activate") {
      spendKeywordCost(b,s);addTrigger(b,id!,`${k} activated ability`,target);return;
    }
    if(native.type!=="play"||!c)throw new Error(`No native keyword play for ${k}`);
    const hidden=c.zone==="hidden";
    if(hidden) {if(c.hiddenOnTurn===undefined||b.turn<=c.hiddenOnTurn||fieldAt(b,c.hiddenAt!).controller!=="player")throw new Error("Hidden needs a subsequent turn and retained control.");}
    else spendKeywordCost(b,s);
    if(c.zone==="hand")b.players.player.handCount!--;
    c.faceDown=false;
    if(c.type==="spell") {
      c.zone="chain";b.chain.push({id:c.instanceId,cardId:c.cardId,controller:"player",label:`${c.name}${target?` → ${findCard(b,target)!.name}`:""}`,targetId:target});b.priority="player";
      c.annotation=k==="Repeat"?"Repeat paid: one spell, two executions on the chosen Rearguard.":k==="Show Off"?"Show Off recorded 4 Might from the Hopeful still in your hand.":"Costs paid; this spell is waiting for responses.";
    } else {
      c.zone=native.destination??"base";c.ready=c.type==="gear"||k==="Accelerate"||k==="Level";
      c.annotation="This card entered play straight away, as units and gear do. A separate ability can still go on the chain.";
      if(["Accelerate","Level","Ambush"].includes(k))applyCardOutcome(c.instanceId);
      b.priority=b.chain.length?b.chain.at(-1)!.controller:k==="Quick-Draw"?"opponent":"player";
      // The optional play trigger is deliberately added in its own next narrated step.
    }
    return;
  }
  if(op==="older") {
    const item=b.chain.pop();if(!item)throw new Error("The older spell is no longer waiting.");
    const source=findCard(b,item.id)!; const targetCard=findCard(b,item.targetId!)!;
    if(source.cardId==="OGN-058"){targetCard.might+=2;draw(b,item.controller);}else if(source.cardId==="OGN-004")targetCard.might+=3;
    source.zone="trash";b.priority=b.chain.at(-1)?.controller??keywordReturnedPriority(b,s);b.passedBy=[];return;
  }
  if(op==="resolve") {
    if(b.priority!==null)throw new Error("Both players must pass before resolving this item.");
    const item=b.chain.pop();if(!item)throw new Error("No spell or ability is waiting to resolve.");
    if(k==="Temporary") {b.cards=b.cards.filter(c=>c.instanceId!=="player-UNL-T07");fieldAt(b,"battlefield-left").controller=null;b.phase="Beginning";}
    else if(k==="Deploy")kill(b,findCard(b,"player-RAD-002")!,false);
    else if(k==="Vision") {const top=keywordCardFromExample(s,"player-OGN-096");top.faceDown=false;top.annotation="Private Predict: top card, not in hand. Choose whether to recycle.";b.cards.push(top);}
    else if(k==="Hunt"){b.players.player.xp=(b.players.player.xp??0)+2;findCard(b,"player-UNL-016")!.might=4;}
    else if(k==="Deflect"||k==="Hidden") {const victim=findCard(b,item.targetId!)!;kill(b,victim,false);draw(b,victim.owner,2);}
    else if(k==="Show Off") {const victim=findCard(b,item.targetId!)!;victim.damage+=4;if(victim.damage>=victim.might)kill(b,victim,false);}
    else if(k==="Flow")draw(b,"player");
    else {
      for(const out of s.after.cards)applyCardOutcome(out.instanceId);
      if(k==="Reaction"){draw(b,"player");b.cards.push(card("OGN-045","player-OGN-045","player","hand"));}
    }
    const source=findCard(b,item.id);
    if(source?.type==="spell"){source.zone=k==="Flow"?"banishment":"trash";source.annotation=k==="Flow"?"Flow banishes this as it leaves the chain.":"Resolved.";}
    b.priority=b.chain.at(-1)?.controller??keywordReturnedPriority(b,s);b.passedBy=[];
    return;
  }
  throw new Error(`Unknown authored keyword event ${s.id}:${op}`);
}
function applyGuideEffect(b:TutorialBoard,e:TutorialGuideEffect,current:TutorialStep,lessonId:string) {
  switch(e.type) {
    case "exercise": {
      if(e.operation==="mulligan-keep")b.log.push("You kept all four cards, which costs you nothing.");
      else if(e.operation==="mulligan-second")Object.assign(b,firstGamePosition("mulligan-second"));
      else if(e.operation==="mulligan-two"){
        for(const id of ["m-elder-one","m-elder-two"]){const old=findCard(b,id);if(!old||old.zone!=="hand")throw new Error("Select the two Elders from this opening hand.");old.zone="deck";old.faceDown=true;}
        b.cards.push(card("OGN-044","m-new-keeper","player","hand"),card("OGN-096","m-new-sentry","player","hand"));
        b.log.push("You set two aside, drew two, then recycled the originals to the bottom. You still have four cards in hand and the same number in your deck.");
      } else if(e.operation==="score-right"){
        if(b.phase!=="Conquer"||b.priority!==null)throw new Error("Finish both response chances before scoring.");
        scoreField(b,"battlefield-right","conquer");settleConqueredCombat(b);b.phase="Main";b.priority="player";
      } else if(e.operation==="capstone-reinforce"){
        const unit=findCard(b,"p-keeper");
        if(lessonId!=="choose-your-plan"||b.phase!=="Main"||b.priority!=="player"||b.chain.length||b.combat||!unit?.ready||unit.zone!=="base"||fieldAt(b,"battlefield-left").controller!=="player"||b.cards.some(c=>c.owner==="opponent"&&c.type==="unit"&&c.zone==="battlefield-left"))throw new Error("Reinforce your own unopposed battlefield with a ready unit during open Main.");
        unit.zone="battlefield-left";unit.ready=false;b.phase="Main";b.priority="player";b.passedBy=[];
        b.log.push("Keeper exhausted to move onto a battlefield you already control, so you haven’t opened another showdown or scored a point.");
      } else if(e.operation==="resolve-response"){
        if(b.priority!==null||b.chain.at(-1)?.id!=="p-discipline")throw new Error("Both players must pass on your Discipline first.");
        mutate(b,{type:"resolve"},lessonId,current.id);b.priority="opponent";b.passedBy=[];
      } else if(e.operation==="defended"){
        if(!b.combat||b.chain.length||b.cards.some(c=>c.owner==="opponent"&&c.type==="unit"&&c.zone===b.combat!.battlefieldId))throw new Error("Finish the attacker’s damage and cleanup first.");
        if(!b.cards.some(c=>c.owner==="player"&&c.type==="unit"&&c.zone===b.combat!.battlefieldId))throw new Error("A surviving defender is needed to retain control of the battlefield.");
        finishTutorialCombat(b);b.phase="Main";b.priority="opponent";b.passedBy=[];
      } else throw new Error(`Unknown first-game exercise: ${e.operation}`);
      break;
    }
    case "resolve":if(b.priority!==null)throw new Error("Both players must pass before resolving this spell.");mutate(b,{type:"resolve"},lessonId,current.id);if(!b.chain.length&&b.phase==="Main")b.priority=b.turnPlayer;break;
    case "keyword": {const s=NEW_PLAYER_KEYWORD_SCENARIOS.find(s=>s.id===e.scenarioId);if(!s||b.keywordScenario?.id!==s.id)throw new Error("This is not the current example.");applyKeywordEvent(b,s,e.operation);break;}
    case "start-turn":newTurn(b,e.side);break;
    case "ready":readySide(b,e.side);b.phase="Beginning";break;
    case "channel":addRunes(b,e.side,e.count);b.phase="Draw";break;
    case "draw":draw(b,e.side,e.count);b.phase="Main";break;
    case "draw-card": {
      const drawn=findCard(b,e.cardId);if(!drawn||drawn.zone!=="deck"||b.players[drawn.owner].deckCount<1)throw new Error("The scripted draw must come from a real card in that player’s main deck.");
      drawn.zone="hand";drawn.faceDown=false;b.players[drawn.owner].deckCount--;if(b.players[drawn.owner].handCount!==undefined)b.players[drawn.owner].handCount!++;
      b.phase="Main";b.priority=drawn.owner;break;
    }
    case "phase":b.phase=e.phase;b.priority=e.priority;break;
    case "pass":passPriority(b,e.side);break;
    case "exhaust": {const c=findCard(b,e.cardId)!;if(!c.ready||c.zone!=="runes")throw new Error("The guide needs a ready rune.");c.ready=false;b.players[c.owner].energy++;break;}
    case "exhaust-runes": {
      const runes=e.cardIds.map(id=>findCard(b,id));
      if(!runes.length||new Set(e.cardIds).size!==runes.length||runes.some(c=>!c||c.type!=="rune"||!c.ready||c.zone!=="runes"||c.owner!==runes[0]!.owner))throw new Error("The guide needs different ready runes from the same player for this payment.");
      for(const rune of runes)rune!.ready=false;
      b.players[runes[0]!.owner].energy+=runes.length;
      break;
    }
    case "play": {const c=findCard(b,e.cardId)!;const p=b.players[c.owner];if(c.zone!=="hand"||p.energy<c.energyCost)throw new Error("The guide cannot pay for this card.");p.energy-=c.energyCost;if(p.handCount!==undefined)p.handCount--;c.faceDown=false;c.zone=e.destination;
      if(c.type==="unit")c.ready=false;else b.chain.push({id:c.instanceId,cardId:c.cardId,controller:c.owner,label:`${c.name} → ${findCard(b,e.targetId!)!.name}`,targetId:e.targetId});b.priority=c.owner;break;}
    case "move": {const c=findCard(b,e.cardId)!;if(!c.ready)throw new Error("The moving unit must be ready.");c.zone=e.destination;c.ready=false;b.phase="Showdown";b.priority=c.owner;
      if(b.cards.some(x=>x.type==="unit"&&x.owner!==c.owner&&x.zone===e.destination)){b.combat={battlefieldId:e.destination,attacker:c.owner,assignments:{}};b.phase="Combat showdown";}break;}
    case "score":fieldAt(b,e.battlefieldId).controller=e.side;fieldAt(b,e.battlefieldId).scoredBy.push(e.side);b.players[e.side].score++;if(b.foundation)finishTutorialCombat(b);b.phase="Main";break;
    case "assign": {const problem=validateTutorialDamageAssignment(b,Object.fromEntries(current.combatDemonstration!.targetAssignments.map(a=>[a.cardId,a.amount])));if(problem)throw new Error(problem);b.combat!.assignments=Object.fromEntries(current.combatDemonstration!.targetAssignments.map(a=>[a.cardId,a.amount]));break;}
    case "resolve-ahri": {const item=b.chain.pop();if(!item||b.priority!==null)throw new Error("Pass on Ahri’s trigger first.");const target=findCard(b,item.targetId!)!;target.might=Math.max(1,target.might-2);b.priority="player";b.passedBy=[];break;}
    case "trigger":
      if(e.targetId&&b.decisions?.[`trigger:${e.cardId}`]!==e.targetId)throw new Error("Choose this triggered ability’s target first.");
      addTrigger(b,e.cardId,e.label,e.targetId);
      if(e.targetId)delete b.decisions![`trigger:${e.cardId}`];break;
    case "deathknell": {const c=findCard(b,e.cardId)!;const top=b.chain.pop();if(!top||!top.id.endsWith(":trigger"))throw new Error("Resolve the pending Deathknell trigger first.");draw(b,c.owner);b.priority="player";break;}
    case "foundations":applyFoundationEffect(b,e.operation,current);break;
    case "on-play": {
      if(e.operation==="reset-target"){Object.assign(b,playEffectBoard(true));break;}
      if(e.operation==="watcher-trigger"){
        const source=findCard(b,"p-watcher");if(source?.zone!=="base"||source.ready||b.chain.length)throw new Error("Play Watcher normally before its play ability starts.");
        addTrigger(b,source.instanceId,"Thousand-Tailed Watcher — all enemy units -3 Might this turn, minimum 1");break;
      }
      if(e.operation==="recycle-chaos"){
        const rune=findCard(b,"o-rune-1")!;if(rune.zone!=="runes"||rune.ready||rune.domain!=="Chaos")throw new Error("Recycle the exhausted Chaos rune after making energy.");
        rune.zone="rune-deck";rune.faceDown=true;b.players.opponent.runeDeckCount++;b.players.opponent.power.Chaos=(b.players.opponent.power.Chaos??0)+1;break;
      }
      if(e.operation==="star-crossed-play"){
        const spell=findCard(b,"o-star-crossed")!,friendly=findCard(b,"o-mystic-poro")!,enemy=findCard(b,findCard(b,"p-watcher")?"p-watcher":"p-sentry")!,payer=b.players.opponent;
        if(b.priority!=="opponent"||spell.zone!=="hand"||friendly.zone!=="base"||enemy.zone!=="base"||payer.energy<3||(payer.power.Chaos??0)<1)throw new Error("Star-Crossed needs priority, both units in play and its full cost.");
        payer.energy-=3;payer.power.Chaos!--;spell.zone="chain";spell.faceDown=false;
        b.chain.push({id:spell.instanceId,cardId:spell.cardId,controller:"opponent",label:`Star-Crossed → friendly ${friendly.name} + enemy ${enemy.name}`,targetId:enemy.instanceId,targetIds:[friendly.instanceId,enemy.instanceId]});b.priority="opponent";b.passedBy=[];break;
      }
      if(e.operation==="star-crossed-resolve"){
        const item=b.chain.at(-1);if(b.priority!==null||item?.cardId!=="UNL-128"||item.targetIds?.length!==2)throw new Error("Both players must pass on the spell with its two chosen units.");
        for(const id of item.targetIds){const unit=findCard(b,id);if(!unit||unit.type!=="unit"||!["base","battlefield-left","battlefield-right"].includes(unit.zone))throw new Error("Both selected units must still be in play for this example.");}
        b.chain.pop();for(const id of item.targetIds){const unit=place(b,id,"hand");unit.faceDown=unit.owner==="opponent";unit.annotation="Returned to hand, not killed. No Deathknell.";}
        findCard(b,item.id)!.zone="trash";b.priority=b.chain.at(-1)?.controller??b.turnPlayer;b.passedBy=[];break;
      }
      const item=b.chain.at(-1);if(b.priority!==null||!item)throw new Error("Both players must pass on the remaining effect.");
      if(e.operation==="watcher-resolve"){
        if(item.id!=="p-watcher:trigger")throw new Error("Resolve the queued Watcher ability, not the unit card.");
        b.chain.pop();for(const unit of b.cards.filter(c=>c.owner==="opponent"&&c.type==="unit"&&["base","battlefield-left","battlefield-right"].includes(c.zone))){unit.might=Math.max(1,unit.might-3);unit.annotation="Watcher’s queued ability: -3 Might this turn, minimum 1.";}
      }else if(e.operation==="discipline-resolve"){
        if(item.id!=="p-discipline")throw new Error("Discipline must be the remaining spell.");b.chain.pop();
        const target=findCard(b,item.targetId!);if(target&&["base","battlefield-left","battlefield-right"].includes(target.zone))target.might+=2;
        draw(b,"player");findCard(b,item.id)!.zone="trash";
      }
      b.priority=b.turnPlayer;b.passedBy=[];break;
    }
    case "hidden-other-position": {
      const fresh=checkpoint("hidden-cards");fresh.turn++;fresh.turnPlayer="opponent";fresh.phase="Main";fresh.priority="opponent";fresh.passedBy=[];
      const hidden=findCard(fresh,"p-hidden")!;hidden.zone="hidden";hidden.faceDown=true;hidden.hiddenAt="battlefield-left";hidden.hiddenOnTurn=fresh.turn-1;
      findCard(fresh,"o-sentry")!.might=3;const spell=findCard(fresh,"o-discipline")!;spell.zone="trash";spell.faceDown=false;
      readySide(fresh,"opponent");addRunes(fresh,"opponent",2);findCard(fresh,"o-rune-1")!.ready=false;findCard(fresh,"o-rune-2")!.ready=false;draw(fresh,"opponent",2);
      const rune=findCard(fresh,"p-rune-1")!;rune.zone="rune-deck";rune.faceDown=true;rune.ready=false;fresh.players.player.runeDeckCount++;
      fresh.log=["We’re starting again just before the attack, with Discipline resolved and Blade hidden since the previous turn."];Object.assign(b,fresh);break;
    }
    case "hidden-loss-position": {
      const fresh=checkpoint("hidden-cards");const hidden=findCard(fresh,"p-hidden")!;hidden.zone="hidden";hidden.faceDown=true;hidden.hiddenAt="battlefield-left";hidden.hiddenOnTurn=fresh.turn-1;fresh.log=["In this separate example Blade’s been hidden since the previous turn, so try moving your last unit away and see what happens in cleanup."];Object.assign(b,fresh);break;
    }
    case "hidden-loss":for(const c of b.cards)if(c.zone==="hidden"&&c.hiddenAt&&fieldAt(b,c.hiddenAt).controller!==c.owner){c.zone="trash";c.faceDown=false;c.annotation="Revealed and trashed at cleanup after losing control.";}break;
  }
  b.log.push(current.instruction);b.log=b.log.slice(-40);
}

function firstGamePosition(id:string):TutorialBoard {
  const b=initialBoard();b.cards=b.cards.filter(c=>c.zone==="legend"||c.zone==="champion");
  b.turn=5;b.turnPlayer="player";b.phase="Main";b.priority="player";b.combat=null;b.chain=[];b.passedBy=[];
  b.players.player.teachingDeckId="teaching-first-game-ahri";b.players.opponent.teachingDeckId="teaching-first-game-orianna";
  for(const side of ["player","opponent"] as const){b.players[side].energy=0;b.players[side].power={};b.players[side].runeDeckCount=12;b.players[side].score=0;delete b.players[side].handCount;}
  for(const f of b.battlefields){f.controller=null;f.scoredBy=[];}
  const put=(code:CardCode,instance:string,owner:TutorialSide,zone:TutorialZone,ready=true)=>b.cards.push(card(code,instance,owner,zone,ready));
  if(id==="mulligan-practice"||id==="mulligan-second"){
    b.turn=1;b.phase="Setup";b.setup={stage:"complete",completedItems:["legend","champion","battlefields","main-deck","rune-deck","turn-order","opening-hand"],selectedBattlefieldId:"OGN-282",battlefieldOptions:[]};
    if(id==="mulligan-second"){
      put("OGN-065","m-elder-one","player","hand");put("OGN-065","m-elder-two","player","hand");put("OGN-058","m-discipline","player","hand");put("OGN-050","m-prison","player","hand");
    }else{
      put("OGN-044","m-keeper","player","hand");put("SFD-074","m-pickpocket","player","hand");put("OGN-065","m-elder","player","hand");put("OGN-058","m-discipline","player","hand");
    }
    for(let i=0;i<4;i++)put(i<3?"OGN-096":"OGN-058",`o-opening-${i}`,"opponent","hand");
  }else{
    put("SFD-074","p-planner","player",["resource-decisions","choose-your-plan"].includes(id)?"battlefield-left":"base");
    put("OGN-044","p-keeper","player",["recovery-practice","choose-your-plan"].includes(id)?"base":"hand");
    addRunes(b,"player",2);addRunes(b,"opponent",2);
    if(id==="simple-combat"){
      put("OGN-044","o-keeper","opponent","battlefield-left");fieldAt(b,"battlefield-left").controller="opponent";b.players.opponent.score=2;b.players.player.score=1;
    }
    if(id==="resource-decisions"||id==="choose-your-plan"){
      // Reverse the main matchup explicitly: Orianna has no mandatory attack penalty.
      b.cards=b.cards.filter(c=>c.zone!=="legend"&&c.zone!=="champion");
      put("RAD-145","p-legend","player","legend");put("RAD-068","p-champion","player","champion");
      put("OGN-255","o-legend","opponent","legend");put("OGN-119","o-champion","opponent","champion");
      b.players.player.name="You · Orianna";b.players.opponent.name="Guide · Ahri";
      b.players.player.teachingDeckId="teaching-first-game-orianna";b.players.opponent.teachingDeckId="teaching-first-game-ahri";
      put("OGN-058","p-discipline","player","hand");put("OGN-065","o-elder","opponent","base");
      fieldAt(b,"battlefield-left").controller="player";b.players.player.score=2;b.players.opponent.score=2;
      if(id==="choose-your-plan"){
        b.turn=7;b.players.player.score=3;b.players.opponent.score=3;
        findCard(b,"p-planner")!.ready=false;
        fieldAt(b,"battlefield-left").scoredBy=["player"];
        b.log.push("This time Beginning, Channel and Draw are already finished. Pickpocket scored for holding this turn, Keeper’s ready in base, and you’ve finished the optional play effects.");
      }
    }
    if(id==="recovery-practice"){
      const planner=findCard(b,"p-planner")!;planner.zone="trash";planner.ready=false;
      put("OGN-065","o-elder","opponent","battlefield-left");fieldAt(b,"battlefield-left").controller="opponent";b.players.opponent.score=4;b.players.player.score=2;
      b.log.push("We’re picking up a separate game after I conquered the left battlefield last turn. You’ve finished the start of your turn and Keeper’s ready in base.");
    }
  }
  for(const c of b.cards){if(c.cardId==="OGN-065")c.annotation="No buff here: printed 4 Might.";if(c.cardId==="SFD-074"&&c.zone!=="hand")c.annotation="Prepared unit: its optional on-play effect has already finished.";}
  for(const side of ["player","opponent"] as const)b.players[side].deckCount=40-b.cards.filter(c=>c.owner===side&&c.type!=="legend"&&c.type!=="rune"&&c.zone!=="deck").length;
  b.log.push("We’ve set up this board for practice, and you can open Main Deck for the full starting lists. We skipped the optional extra payments and targets on earlier plays, and nobody has a buff here.");
  return b;
}

function playEffectBoard(targetExample=false):TutorialBoard {
  const b=initialBoard();b.turn=9;b.phase="Main";b.priority="player";b.turnPlayer="player";b.passedBy=[];b.chain=[];b.combat=null;
  b.cards=b.cards.filter(c=>c.owner==="player"&&(c.zone==="legend"||c.zone==="champion"));
  b.cards.push(card("OGN-263","o-legend","opponent","legend"),card("OGN-197","o-champion","opponent","champion"),card("OGN-171","o-mystic-poro","opponent","base"),card("RAD-050","o-chronomancer","opponent","base"),card("UNL-128","o-star-crossed","opponent","hand"));
  findCard(b,"o-legend")!.domains=["Chaos","Mind"];
  b.players.player={name:"You · Ahri",score:3,energy:0,power:{},deckCount:targetExample?37:38,runeDeckCount:12,teachingDeckId:"teaching-first-game-ahri"};
  b.players.opponent={name:"Guide · Teemo",score:3,energy:0,power:{},deckCount:36,runeDeckCount:12,teachingDeckId:"teaching-play-effects-teemo"};
  if(targetExample)b.cards.push(card("OGN-096","p-sentry","player","base"),card("OGN-058","p-discipline","player","hand"));
  else b.cards.push(card("OGN-116","p-watcher","player","hand"));
  addRunes(b,"player",targetExample?2:7);addRunes(b,"opponent",4);
  if(!targetExample){for(const c of b.cards.filter(c=>c.owner==="player"&&c.type==="rune"))c.ready=false;const recycled=findCard(b,"p-rune-1")!;recycled.zone="rune-deck";recycled.faceDown=true;b.players.player.runeDeckCount++;b.players.player.energy=7;b.players.player.power.Mind=1;}
  b.log=[targetExample?"In this fresh position Mystic Poro and Chronomancer have already finished their play effects, so we can try returning a spell’s target to hand.":"You’ve already made 7 energy and 1 Mind power in this separate example. My units have finished their play effects, and neither of us is using a legend ability."];
  return b;
}

function checkpoint(id: string): TutorialBoard {
  if(FOUNDATION_IDS.includes(id))return foundationBoard(id);
  if(id==="unit-play-effects")return playEffectBoard();
  if(["plan-your-main","simple-combat","mulligan-practice","resource-decisions","recovery-practice","choose-your-plan"].includes(id))return firstGamePosition(id);
  if(id==="practice-first-point"){
    const practice=completedBoard("first-or-second");
    practice.cards=practice.cards.filter(c=>c.owner!=="player"||c.type!=="rune").map(c=>c.instanceId==="p-sentry-2"?card("OGN-119","practice-ahri","player","hand"):c.instanceId==="p-replacement"?card("OGN-050","practice-rune-prison","player","hand"):c);
    const sentry=findCard(practice,"p-sentry")!;sentry.zone="deck";sentry.faceDown=true;practice.players.player.deckCount++;practice.players.player.runeDeckCount=12;practice.phase="Awaken";
    practice.log=["Your four opening cards are in hand and all twelve runes are still in the rune deck for this separate two-turn practice. You will complete Awaken, Beginning, Channel and Draw yourself, and your first draw is Watchful Sentry."];
    return practice;
  }
  if(id==="practice-reactions")return checkpoint("the-chain");
  if(id==="practice-final-point")return finalWinBoard("conquest");
  let b = initialBoard();
  const keywordGroup = NEW_PLAYER_KEYWORD_GROUPS.find((group) => group.id === id);
  if (keywordGroup) {
    const scenario = NEW_PLAYER_KEYWORD_SCENARIOS.find((item) => item.id === keywordGroup.scenarioIds[0]);
    if (!scenario) throw new Error(`Keyword group has no starting position: ${id}`);
    return createKeywordTutorialBoard(scenario.id, "before");
  }
  if (id === "table-setup") return initialBoard(true);
  if (id === "opening-hand") return completedBoard("table-setup");
  if (id === "first-or-second") { b = completedBoard("opening-hand"); b.phase = "Awaken"; return b; }
  if (id === "read-a-card") return completedBoard("first-or-second");
  if (id === "play-first-unit") return completedBoard("read-a-card");
  if (id === "power-and-champion") {
    return completedBoard("play-first-unit");
  }
  if (id === "move-to-battlefield") return completedBoard("power-and-champion");
  if (id === "first-conquest") return completedBoard("move-to-battlefield");
  if (id === "holding") return completedBoard("first-conquest");
  if (id === "start-combat") return completedBoard("holding");
  if (id === "the-chain") return completedBoard("start-combat");
  if (id === "countering-spells") {
    b = initialBoard(); b.turn = 5; b.phase = "Combat showdown";
    b.cards = b.cards.filter((c) => ["legend", "champion"].includes(c.zone));
    b.cards.push(card("OGN-096", "p-sentry", "player", "battlefield-left", false), card("OGN-045", "p-defy", "player", "hand"),
      card("OGN-096", "o-sentry", "opponent", "battlefield-left"), card("OGN-050", "o-rune-prison", "opponent", "chain"));
    addRunes(b, "player", 2); addRunes(b, "opponent", 3);
    // Orianna tapped two runes and recycled an exhausted Calm rune before the checkpoint.
    findCard(b, "o-rune-1")!.ready = false; findCard(b, "o-rune-2")!.ready = false;
    findCard(b, "o-rune-2")!.zone = "rune-deck"; findCard(b, "o-rune-2")!.faceDown = true; b.players.opponent.runeDeckCount++;
    for (const side of ["player", "opponent"] as const) b.players[side].deckCount = 37;
    fieldAt(b, "battlefield-left").controller = "opponent";
    b.combat = { battlefieldId: "battlefield-left", attacker: "player", assignments: {} };
    b.chain = [{ id: "o-rune-prison", cardId: "OGN-050", controller: "opponent", label: "Rune Prison → Watchful Sentry", targetId: "p-sentry" }];
    b.log = ["In this separate fight Orianna’s paid 2 energy and 1 Calm power for Rune Prison, then passed priority, so its target hasn’t been stunned yet."];
    return b;
  }
  if (id === "combat-damage") {
    return completedBoard("the-chain");
  }
  if (id === "hidden-cards" || id === "keywords-in-combat") {
    const s = initialBoard(); s.turn = 5; s.phase = "Main"; s.players.player.name = "You · Sett";
    s.cards = s.cards.filter((c) => c.owner !== "player");
    s.cards.push(card("OGN-269", "p-legend", "player", "legend"), card("OGN-240", "p-champion", "player", "champion"),
      card("OGN-210", "p-poro", "player", "battlefield-left"), card("OGN-213", "p-hidden", "player", "hand"),
      card("OGN-210", "p-poro-2", "player", "hand"), card("OGN-240", "p-champion-2", "player", "hand"));
    addRunes(s, "player", 4); addRunes(s, "opponent", 4);
    fieldAt(s, "battlefield-left").controller = "player"; s.players.player.score = 3;
    place(s, "o-sentry", "base");
    if (id === "keywords-in-combat") {
      fieldAt(s, "battlefield-left").controller = "opponent";
      place(s, "p-champion", "battlefield-left", false); place(s, "p-poro", "battlefield-left", false).might = 3;
      place(s, "o-sentry", "battlefield-left"); place(s, "o-sentry-2", "battlefield-left");
      s.combat = { battlefieldId: "battlefield-left", attacker: "player", assignments: {} };
      s.phase = "Combat damage"; s.priority = null;
      const legendIndex = s.cards.findIndex((c) => c.instanceId === "o-legend");
      s.cards[legendIndex] = card("OGN-261", "o-legend", "opponent", "legend");
      const championIndex = s.cards.findIndex((c) => c.instanceId === "o-champion");
      s.cards[championIndex] = card("OGN-238", "o-champion", "opponent", "champion");
      s.players.opponent.name = "Guide · Leona";
      for (const unitId of ["o-sentry", "o-sentry-2"]) s.cards[s.cards.findIndex((c) => c.instanceId === unitId)] = card("OGN-210", unitId, "opponent", "battlefield-left");
      s.cards = s.cards.filter((c) => c.owner !== "opponent" || c.type !== "rune" && c.zone !== "hand");
      s.cards.push(card("OGN-210", "o-poro-3", "opponent", "hand"), card("OGN-213", "o-hidden", "opponent", "hand"));
      s.players.opponent.runeDeckCount = 12; addRunes(s, "opponent", 4);
    }
    return s;
  }
  return finalWinBoard("conquest");
}

function finalWinBoard(route: "conquest" | "hold"): TutorialBoard {
  const b = completedBoard("combat-damage");
  b.turn = 13; b.phase = route === "hold" ? "Awaken" : "Main"; b.combat = null; b.priority = "player"; b.turnPlayer = "player"; b.players.player.score = 7;
  for (const side of Object.values(b.players)) { side.energy = 0; side.power = {}; }
  for (const c of b.cards) { c.might = c.baseMight; c.damage = 0; c.stunned = false; c.mightModifiers=[]; if((b.practice||b.foundation)&&["base","battlefield-left","battlefield-right"].includes(c.zone)){ c.might+=c.buffCount??0;if(b.cards.some(g=>g.attachedTo===c.instanceId&&g.cardId==="SFD-073"))c.might++;if(b.cards.some(g=>g.attachedTo===c.instanceId&&g.cardId==="SFD-022"))c.might+=2; if(c.cardId==="UNL-016"&&(b.players[c.owner].xp??0)>=3)c.might++; } }
  for (const f of b.battlefields) { f.controller = route === "hold" ? (f.id === "battlefield-left" ? "player" : "opponent") : null; f.scoredBy = []; }
  place(b, "p-sentry", route === "hold" ? "battlefield-left" : "base");
  place(b, "p-sentry-2", "base"); place(b, "p-champion", "trash");
  place(b, "o-sentry-2", route === "hold" ? "battlefield-right" : "base");
  b.log.push(route === "hold" ? "Separate holding example. You’re back at 7 points for Awaken, with Monastery still yours after my turn." : "Try this finish from 7 points, with two empty battlefields and two ready Sentries to score them.");
  return b;
}

const completedBoardCache = new Map<string, TutorialBoard>();
function completedBoard(id: string): TutorialBoard {
  const cached = completedBoardCache.get(id);
  if (cached) return clone(cached);
  let state = createLessonState(id);
  for (const step of LESSONS.find((l) => l.id === id)!.steps) {
    state = applyTutorialAction(state, step.expectedAction);
    if (state.feedback) throw new Error(`Invalid lesson checkpoint ${id}: ${state.feedback}`);
  }
  completedBoardCache.set(id, clone(state.board));
  return clone(state.board);
}

export function createLessonState(id: string): TutorialState {
  if (!LESSONS.some((l) => l.id === id)) throw new Error(`Unknown tutorial lesson: ${id}`);
  return { version: 1, lessonId: id, stepIndex: 0, completed: false, feedback: null, board: checkpoint(id), actions: [], history: [] };
}
export function getTutorialLessonContext(state: Pick<TutorialState,"lessonId"|"board">): TutorialLessonContext {
  const lesson=LESSONS.find(l=>l.id===state.lessonId);
  const context=lesson?.context??{kind:"separate-exercise" as const,title:"Separate exercise",explanation:"This prepared position is separate from your main game."};
  const b=state.board, player=b.players.player.name.replace(/^You\s*·\s*/,""),opponent=b.players.opponent.name.replace(/^Guide\s*·\s*/,"");
  return {...context,position:`You: ${player} · Guide: ${opponent} · Turn ${b.turn} · Points ${b.players.player.score}–${b.players.opponent.score}`};
}
export function getTutorialSteps(state: Pick<TutorialState, "lessonId" | "board">): TutorialStep[] {
  const lesson=LESSONS.find(l=>l.id===state.lessonId);
  if(!lesson)return [];
  if(!lesson.branch)return lesson.steps;
  const branch=lesson.branch, index=lesson.steps.findIndex(s=>s.id===branch.decisionStepId);
  const selected=state.board.decisions?.[branch.decisionStepId]??branch.defaultOptionId;
  return [...lesson.steps.slice(0,index+1),...(branch.variants[selected]??branch.variants[branch.defaultOptionId])];
}
export function getTutorialStepCount(state: Pick<TutorialState, "lessonId" | "board">): number { return getTutorialSteps(state).length; }
export function getTutorialStep(state: TutorialState): TutorialStep | null {
  const current=getTutorialSteps(state)[state.stepIndex] ?? null;
  if(current?.guidance==="practice"&&current.expectedAction.type==="exhaust"&&current.allowedCardIds){
    const authored=findCard(state.board,current.expectedAction.cardId);
    const chosen=authored?.ready&&authored.zone==="runes"?authored:state.board.cards.find(c=>current.allowedCardIds!.includes(c.instanceId)&&c.owner==="player"&&c.zone==="runes"&&c.ready);
    if(chosen)return {...current,expectedAction:{type:"exhaust",cardId:chosen.instanceId},focusIds:[chosen.instanceId]};
  }
  if(current?.guidance==="practice"&&current.expectedAction.type==="move"&&current.allowedCardIds&&current.allowedDestinations){
    const available=state.board.cards.filter(c=>current.allowedCardIds!.includes(c.instanceId)&&c.owner==="player"&&c.zone==="base"&&c.ready);
    const unit=available.find(c=>c.instanceId===(current.expectedAction as {cardId:string}).cardId)??available[0];
    const fields=current.allowedDestinations.filter(id=>!fieldAt(state.board,id).scoredBy.includes("player")&&!state.board.cards.some(c=>c.type==="unit"&&c.zone===id));
    const destination=fields.find(id=>id===(current.expectedAction as {destination:string}).destination)??fields[0];
    if(unit&&destination)return {...current,expectedAction:{type:"move",cardId:unit.instanceId,destination},focusIds:[unit.instanceId,destination]};
  }
  return current;
}

/** Location of the current pass/score control; null keeps a non-battlefield chain beside the chain. */
export function getTutorialActionBattlefield(state: TutorialState, step: TutorialStep | null = getTutorialStep(state)): TutorialBattlefieldId | null {
  const action = step?.boardAction ?? step?.expectedAction;
  if (!step || (action?.type !== "pass" && action?.type !== "score")) return null;
  const board = state.board;
  const battlefield = (zone: string | undefined): TutorialBattlefieldId | null =>
    zone === "battlefield-left" || zone === "battlefield-right" ? zone : null;
  if (action.type === "score") {
    // Match the authored effect used by executeTutorialStep before its ordinary score mutation.
    const effect = step.guideEffect ?? step.rulesEffect;
    if (effect?.type === "score") return effect.battlefieldId;
    if (effect?.type === "keyword") {
      if (effect.operation.startsWith("score:")) return battlefield(effect.operation.slice(6));
      if (effect.operation === "gank-hold" || effect.operation === "native" && effect.scenarioId === "keyword-hunt") return "battlefield-left";
      return null;
    }
    if (effect?.type === "exercise") return effect.operation === "score-right" ? "battlefield-right" : null;
    if (effect?.type === "foundations" && effect.operation.startsWith("scoring-")) return ["scoring-other","scoring-hold-right"].includes(effect.operation)?"battlefield-right":"battlefield-left";
    const rulesLesson = step.rulesLessonId ?? state.lessonId;
    return board.practiceBattlefieldId ?? (rulesLesson === "combat-damage" || step.id === "conquest-victory" ? "battlefield-right" : "battlefield-left");
  }
  if (board.combat) return board.combat.battlefieldId;
  const previousLocation = (instanceId: string): TutorialBattlefieldId | null => {
    for (let index = state.history.length - 1; index >= 0; index--) {
      const previous = state.history[index];
      // Never borrow a familiar card ID from another keyword example or an earlier turn.
      if (previous.turn !== board.turn || previous.keywordScenario?.id !== board.keywordScenario?.id) break;
      const card = previous.cards.find(item => item.instanceId === instanceId);
      if (card && card.zone !== "trash" && card.zone !== "banishment") return battlefield(card.zone);
    }
    return null;
  };
  const chainLocation = (item: TutorialBoard["chain"][number], visited: Set<string>): TutorialBattlefieldId | null => {
    if (visited.has(item.id)) return null;
    visited.add(item.id);
    if (item.targetId) {
      const targetItem = board.chain.find(entry => entry.id === item.targetId);
      if (targetItem) return chainLocation(targetItem, visited);
      const target = board.cards.find(card => card.instanceId === item.targetId);
      return battlefield(target?.zone) ?? (target?.zone === "hidden" ? target.hiddenAt ?? null : null);
    }
    const sourceId = item.id.replace(/:trigger$/, "");
    const source = board.cards.find(card => card.instanceId === sourceId);
    return battlefield(source?.zone) ?? (source?.zone === "hidden" ? source.hiddenAt ?? null : null)
      ?? (!source || source.zone === "trash" || source.zone === "banishment" ? previousLocation(sourceId) : null);
  };
  const newest = board.chain.at(-1);
  if(newest){const battlefieldSource=board.battlefields.find(f=>f.cardId===newest.cardId);if(battlefieldSource)return battlefieldSource.id;}
  if (newest) return chainLocation(newest, new Set());
  if (board.phase !== "Showdown") return null;
  // An empty battlefield opens a showdown without creating a combat object, for either player.
  const occupied = board.battlefields.filter(field => field.controller === null && board.cards.some(card => card.type === "unit" && card.zone === field.id));
  if (board.practiceBattlefieldId && occupied.some(field => field.id === board.practiceBattlefieldId)) return board.practiceBattlefieldId;
  return occupied.length === 1 ? occupied[0].id : null;
}
export function resetLessonState(state: TutorialState): TutorialState { return createLessonState(state.lessonId); }
export function undoTutorialAction(state: TutorialState): TutorialState {
  let restored = createLessonState(state.lessonId);
  for (const action of state.actions.slice(0, -1)) restored = applyTutorialAction(restored, action);
  return restored;
}

function actionMatches(actual: TutorialAction, expected: TutorialAction): boolean {
  if (!actual || typeof actual !== "object" || actual.type !== expected.type) return false;
  if(actual.type==="move-units"&&expected.type==="move-units")return Object.keys(actual).every(k=>["type","cardIds","destination"].includes(k))&&actual.destination===expected.destination&&Array.isArray(actual.cardIds)&&actual.cardIds.length===expected.cardIds.length&&new Set(actual.cardIds).size===actual.cardIds.length&&actual.cardIds.every(id=>expected.cardIds.includes(id));
  if (actual.type === "assign-damage" && expected.type === "assign-damage") return Object.keys(actual).every((key) => key === "type" || key === "assignments");
  for (const key of Object.keys(expected) as Array<keyof TutorialAction>) {
    if (key === "type") continue;
    const a = (actual as unknown as Record<string, unknown>)[key];
    const e = (expected as unknown as Record<string, unknown>)[key];
    if (Array.isArray(e)) { if (!Array.isArray(a) || a.length !== e.length || [...a].sort().some((v, i) => v !== [...e].sort()[i])) return false; }
    else if (e && typeof e === "object") {
      if (!a || typeof a !== "object" || Array.isArray(a)) return false;
      const entries = Object.entries(e); if (Object.keys(a).length !== entries.length || entries.some(([k, v]) => (a as Record<string, unknown>)[k] !== v)) return false;
    } else if (a !== e) return false;
  }
  // Unexpected targets/destinations may never bypass the authored action.
  return Object.keys(actual).every((key) => Object.prototype.hasOwnProperty.call(expected, key));
}

function draw(b: TutorialBoard, owner: TutorialSide, count = 1) {
  if(b.foundation){
    const deck=getNewPlayerTeachingDeck(b.players[owner].teachingDeckId)!;
    for(let i=0;i<count;i++){
      if(b.players[owner].deckCount<1)throw new Error("The teaching deck has no card left to draw.");
      const entry=deck.main.find(e=>b.cards.filter(c=>c.owner===owner&&c.cardId===e.cardId&&c.zone!=="deck").length<e.quantity&&foundationKnownCard(e.cardId));
      if(!entry)throw new Error("No remaining verified card for this scripted draw.");
      const number=b.cards.filter(c=>c.instanceId.startsWith(`${owner}-foundation-draw-`)).length+1;b.cards.push(foundationCard(entry.cardId,`${owner}-foundation-draw-${number}`,owner,"hand"));b.players[owner].deckCount--;
    }return;
  }

  if (b.practice) { if (b.players[owner].deckCount < count) throw new Error("The teaching deck is empty."); b.players[owner].deckCount -= count; b.players[owner].handCount = (b.players[owner].handCount ?? 0) + count; return; }
  for (let n = 0; n < count; n++) {
    if (b.players[owner].deckCount <= 0) throw new Error("The teaching deck is empty.");
    const prefix = owner === "player" ? "p" : "o";
    const id = `${prefix}-draw-${b.cards.filter((c) => c.instanceId.startsWith(`${prefix}-draw-`)).length + 1}`;
    const drawNumber = b.cards.filter((c) => c.instanceId.startsWith(`${prefix}-draw-`)).length;
    const championCode = findCard(b, `${prefix}-champion`)?.cardId === "RAD-068" ? "RAD-068" : "OGN-119";
    // The player's opening mulligan already accounts for a second Ahri copy.
    const pool: CardCode[] = ["OGN-045", "OGN-050", championCode, "OGN-058", owner === "player" ? "OGN-050" : championCode];
    if (drawNumber >= pool.length) throw new Error("This teaching position has reached the end of its scripted draws.");
    const c = card(pool[drawNumber], id, owner, "hand");
    b.cards.push(c); b.players[owner].deckCount--;
  }
}
function kill(b: TutorialBoard, c: TutorialCard, handleDeathknell = true) {
  const from=c.zone;
  if(b.foundation){for(const gear of b.cards.filter(g=>g.attachedTo===c.instanceId))delete gear.attachedTo;c.buffCount=0;}
  c.zone = "trash"; c.faceDown = false; c.damage = 0; c.might = c.baseMight;
  if(from.startsWith("battlefield")&&fieldAt(b,from as TutorialBattlefieldId).controller===c.owner&&!b.cards.some(x=>x.owner===c.owner&&x.type==="unit"&&x.zone===from))fieldAt(b,from as TutorialBattlefieldId).controller=null;
  b.log.push(`${c.name} dies.`);
  if (handleDeathknell && c.keywords.includes("Deathknell")) b.log.push(`${c.name} has a pending Deathknell trigger.`);
}
function emptyRunePools(board: TutorialBoard) {
  for (const player of Object.values(board.players)) {
    player.energy = 0;
    player.power = {};
  }
}
function newTurn(b: TutorialBoard, side: TutorialSide) {
  b.turn++; b.turnPlayer = side; b.phase = "Awaken"; b.priority = side; b.combat = null;b.passedBy=[];
  emptyRunePools(b);
  for (const c of b.cards) { c.might = c.baseMight; c.damage = 0; c.stunned = false; c.mightModifiers=[]; if((b.practice||b.foundation)&&["base","battlefield-left","battlefield-right"].includes(c.zone)){ c.might+=c.buffCount??0;if(b.cards.some(g=>g.attachedTo===c.instanceId&&g.cardId==="SFD-073"))c.might++;if(b.cards.some(g=>g.attachedTo===c.instanceId&&g.cardId==="SFD-022"))c.might+=2; if(c.cardId==="UNL-016"&&(b.players[c.owner].xp??0)>=3)c.might++; } }
  for (const f of b.battlefields) f.scoredBy = [];
}
function readySide(b: TutorialBoard, side: TutorialSide) {
  for (const c of b.cards) if (c.owner === side && ["base", "runes", "legend", "battlefield-left", "battlefield-right"].includes(c.zone)) c.ready = true;
}

const SETUP_DESTINATIONS: Partial<Record<TutorialSetupItem, TutorialZone>> = { legend: "legend", champion: "champion", battlefields: "battlefield-left", "main-deck": "deck", "rune-deck": "rune-deck" };
const INTRO_ZONE_NAMES: Record<string, string> = { "player:base": "your base", "player:hand": "your hand", "player:trash": "your trash" };
function validate(b: TutorialBoard, action: TutorialAction): string | null {
  const c = "cardId" in action && action.cardId ? findCard(b, action.cardId) : undefined;
  if (action.type === "demonstrate-keyword" && (b.phase !== "Keyword practice" || b.keywordScenario?.id !== action.scenarioId || b.keywordScenario.revealed)) return "Try the highlighted play first, so we can see what this keyword does here.";
  if (action.type === "setup") {
    if (b.phase !== "Setup" || !b.setup || b.setup.stage !== action.item) return "Finish the highlighted setup step first.";
    const destination = SETUP_DESTINATIONS[action.item];
    if (destination && action.destination !== destination) return "Look for the highlighted space on the table and place the piece there.";
    if (action.item === "legend" && action.cardId !== "p-legend") return "Choose your legend, Ahri, Nine-Tailed Fox.";
    if (action.item === "champion" && action.cardId !== "p-champion") return "Choose your champion unit, Ahri, Inquisitive.";
    if (action.item === "battlefields" && !b.setup.battlefieldOptions.some((f) => f.cardId === action.cardId)) return "Choose one of the three battlefields you brought for this match.";
    if (action.item === "turn-order" && action.choice !== "first" && action.choice !== "second") return "Decide who’s going first before you draw your opening hand.";
  }
  if (action.type === "inspect") return c || b.battlefields.some((f) => f.id === action.cardId) || (b.phase === "Setup" && Object.hasOwn(INTRO_ZONE_NAMES, action.cardId)) ? null : "That card or space is not in this position.";
  if (action.type === "mulligan") {
    if (b.phase !== "Setup" || b.setup?.stage !== "complete" || !Array.isArray(action.cardIds) || action.cardIds.length > 2 || new Set(action.cardIds).size !== action.cardIds.length) return "Once setup is finished you can mulligan, choosing up to two different cards from your hand.";
    if (action.cardIds.some((id) => { const value = findCard(b, id); return !value || value.owner !== "player" || value.zone !== "hand"; })) return "Choose the cards you want to replace from your own hand.";
  }
  if (["exhaust", "recycle", "play", "move", "hide"].includes(action.type)) {
    if (!c || c.owner !== "player") return "Choose a card you control.";
    if (b.priority !== "player") return "Wait until you have priority.";
  }
  if (action.type === "exhaust" && (!c || c.type !== "rune" || c.zone !== "runes" || !c.ready)) return "Exhaust a ready rune in your rune area.";
  if (action.type === "recycle" && (!c || c.type !== "rune" || c.zone !== "runes")) return "Choose a rune that’s already on your table, it can be ready or exhausted when you recycle it.";
  if (action.type === "channel") {
    const count = b.turn === 2 && b.firstPlayer === "opponent" ? 3 : 2;
    if (!action.ready || b.turnPlayer !== "player" || !["Channel", "Beginning"].includes(b.phase) || b.players.player.runeDeckCount < count) return "Use Channel ready runes during your Channel phase, or hold Ctrl and left-click the rune deck.";
  }
  if (action.type === "draw" && (b.phase !== "Draw" || b.turnPlayer !== "player")) return "This draw belongs to your Draw phase.";
  if (action.type === "ready" && (b.phase !== "Awaken" || b.turnPlayer !== "player")) return "Ready your board in your Awaken phase.";
  if (action.type === "check-beginning" && (b.phase !== "Beginning" || b.turnPlayer !== "player" || b.chain.length || b.battlefields.some(f=>f.controller==="player"&&!f.scoredBy.includes("player")))) return "Finish any Beginning effects and score the battlefields you’re holding, then choose Check Beginning on your turn.";
  if(action.type==="choose-trigger"){
    const target=findCard(b,action.targetId);
    if(!c||c.owner!=="player"||!["base","battlefield-left","battlefield-right"].includes(c.zone)||!target||target.faceDown||!["base","battlefield-left","battlefield-right"].includes(target.zone))return "Choose a unit or gear you can see on the board for this triggered ability.";
  }
  if (action.type === "play") {
    if (!c || !["hand", "champion", "hidden"].includes(c.zone) || !c.cardId) return "Choose a card you can play from your hand, your champion zone or your facedown space.";
    const hidden = c.zone === "hidden";
    if (hidden && (c.hiddenOnTurn === undefined || b.turn <= c.hiddenOnTurn || !c.hiddenAt || fieldAt(b, c.hiddenAt).controller !== "player")) return "You can play the hidden card on a subsequent turn, as long as you still control the battlefield where you hid it.";
    if (b.chain.length && !hidden && !c.keywords.includes("Reaction")) return "There’s already something on the chain, so look for a Reaction if you want to respond.";
    const showdown = /showdown/i.test(b.phase);
    const reaction = hidden || c.keywords.includes("Reaction");
    const actionTiming = reaction || c.keywords.includes("Action");
    if (showdown && !actionTiming) return "This card cannot be played during a showdown.";
    if (!showdown && !b.chain.length && (b.phase !== "Main" || b.turnPlayer !== "player")) return "Look for an open Main phase on your turn, or a response window the card can use.";
    if (!hidden && (b.players.player.energy < c.energyCost || (b.players.player.power[c.domain] ?? 0) < c.powerCost)) return "You need enough energy for the number on the card and matching power for any domain symbols.";
    if (c.type === "unit" && action.destination !== "base") {
      const destination = b.battlefields.find((f) => f.id === action.destination);
      if (!destination || destination.controller !== "player") return "Play a unit to your base or a battlefield you control.";
      if (destination.cardId === "SFD-216") return "Rockfall Path stops you playing a unit straight onto it, even when you control it. You can still move a ready unit there.";
    }
    if (c.type === "spell") {
      const target = findCard(b, action.targetId ?? "");
      if (c.cardId === "OGN-045") {
        if (!target || target.type !== "spell" || target.zone !== "chain" || target.instanceId === c.instanceId || !b.chain.some((item) => item.id === target.instanceId)) return "Defy targets a spell waiting on the chain, not a unit or an ability.";
        if (target.energyCost > 4 || target.powerCost > 1) return "Check BOTH printed costs for Defy. The spell can cost up to 4 energy and up to 1 power.";
      } else if (!target || target.type !== "unit" || !["base", "battlefield-left", "battlefield-right"].includes(target.zone)) return "Choose a unit on the board.";
      if (hidden && target.zone !== c.hiddenAt) return "Choose a unit at the hidden spell’s own battlefield, because it can’t reach across to the other one.";
      if (c.cardId === "OGN-213" && !target.zone.startsWith("battlefield")) return "Hidden Blade needs a unit at a battlefield.";
    }
  }
  if(action.type==="move-units"){
    if(b.turnPlayer!=="player"||b.phase!=="Main"||b.chain.length||b.combat)return "Move the group in your open Main phase, once you’ve finished any showdown or chain.";
    if(!Array.isArray(action.cardIds)||action.cardIds.length<2||new Set(action.cardIds).size!==action.cardIds.length||!b.battlefields.some(f=>f.id===action.destination))return "Pick different units that can all reach the battlefield you want them to move to.";
    for(const id of action.cardIds){const unit=findCard(b,id);if(!unit||unit.owner!=="player"||unit.type!=="unit"||!unit.ready)return "Each unit you move has to be yours and ready, because each one pays for its own move.";if(unit.zone!=="base"&&!(unit.keywords.includes("Ganking")&&unit.zone.startsWith("battlefield")&&unit.zone!==action.destination))return "Check whether every unit you picked can get to the same destination.";}
  }
  if(action.type==="spend-buff"){
    const unit=findCard(b,action.cardId);if(!unit||unit.owner!=="player"||unit.buffCount!==1||!["base","battlefield-left","battlefield-right"].includes(unit.zone))return "Choose a unit you control with a Buff counter to spend, because temporary Might and Equipment don’t give you a counter.";
    if(b.foundation?.lessonId!=="buffs-and-bonuses"||b.phase!=="Conquer triggers"||b.chain.length||b.battlefields[0].controller!=="player")return "Decide whether to spend the Buff while you finalise Monastery’s conquer trigger, before either player responds.";
  }
  if (action.type === "move") {
    if (!c || c.type !== "unit" || !c.ready || b.turnPlayer !== "player" || b.phase !== "Main" || b.chain.length) return "You need a ready unit for a standard move, and an open Main phase on your own turn.";
    if (!((c.zone === "base" && action.destination.startsWith("battlefield")) || (c.zone.startsWith("battlefield") && action.destination === "base"))) return "Standard moves go between your base and a battlefield.";
  }
  if (action.type === "hide") {
    if (!c || !c.keywords.includes("Hidden") || !["hand", "champion"].includes(c.zone) || b.turnPlayer !== "player" || b.chain.length || b.phase !== "Main") return "Choose a card with Hidden during your open Main phase, when there’s nothing on the chain.";
    if (fieldAt(b, action.battlefieldId)?.controller !== "player" || b.cards.some((v) => v.zone === "hidden" && v.hiddenAt === action.battlefieldId)) return "Look for an empty facedown space at a battlefield you already control.";
    if (!Object.values(b.players.player.power).some((amount) => (amount ?? 0) > 0)) return "Hiding costs one power of any domain.";
  }
  if (action.type === "assign-damage") {
    if (!b.combat || b.phase !== "Combat damage") return "Finish the combat showdown before assigning damage.";
    const friends = b.cards.filter((v) => v.owner === "player" && v.type === "unit" && v.zone === b.combat!.battlefieldId);
    const enemies = b.cards.filter((v) => v.owner === "opponent" && v.type === "unit" && v.zone === b.combat!.battlefieldId);
    const total = friends.reduce((sum, v) => sum + v.might, 0);
    if (!action.assignments || typeof action.assignments !== "object" || Array.isArray(action.assignments)) return "Assign your combat damage to enemy units here.";
    const entries = Object.entries(action.assignments);
    if (entries.some(([id, n]) => !enemies.some((v) => v.instanceId === id) || !Number.isInteger(n) || n < 0) || entries.reduce((sum, [, n]) => sum + n, 0) !== total) return "Use all the Might from your side of this fight when you assign damage to the enemy units here.";
    if (enemies.some((v) => (action.assignments[v.instanceId] ?? 0) < v.might - v.damage)) return "You have enough to kill every defender here, so assign lethal to each one before putting the rest on the last unit.";
    if (enemies.filter((v) => (action.assignments[v.instanceId] ?? 0) > v.might - v.damage).length > 1) return "Give each unit just enough damage to kill it as you go down the order, then put any extra damage on the last one.";
    const tank = enemies.find((v) => v.keywords.includes("Tank"));
    if (tank && (action.assignments[tank.instanceId] ?? 0) < Math.min(total, tank.might - tank.damage) && entries.some(([id, n]) => id !== tank.instanceId && n > 0)) return "The unit with Tank has to take lethal damage before you can assign any to the others.";
  }
  if (action.type === "resolve" && b.chain.length && b.priority !== null) return "Both of us need to pass before the newest item on the chain can resolve.";
  if (action.type === "pass" && b.priority !== "player") return "Wait until you have priority to pass.";
  if (action.type === "score" && b.turnPlayer !== "player") return "You’ll be able to record this point on your own turn.";
  if (action.type === "end-turn" && (b.chain.length || b.combat || b.phase.includes("showdown") || b.phase === "Showdown")) return "Finish the current chain or showdown before ending your turn.";
  if (action.type === "alternate-win-route" && (b.phase !== "Victory" || b.players.player.score < 8)) return "Finish the game by conquering first, then we’ll try a fresh position where you can win by holding.";
  return null;
}

/** Kept separate from guided inputs so the demonstration's assignments can be checked independently. */
export function validateTutorialDamageAssignment(board: TutorialBoard, assignments: Record<string, number>): string | null {
  return validate(board, { type: "assign-damage", assignments });
}

function scoreField(b: TutorialBoard, id: TutorialBattlefieldId, method: "hold" | "conquer") {
  const field = fieldAt(b, id);
  if (field.scoredBy.includes("player")) throw new Error("This battlefield has already been scored this turn.");
  const friendly = b.cards.some((c) => c.owner === "player" && c.type === "unit" && c.zone === id);
  const enemy = b.cards.some((c) => c.owner === "opponent" && c.type === "unit" && c.zone === id);
  if (!friendly || enemy || (method === "hold" && field.controller !== "player")) throw new Error("You need uncontested control to score this battlefield.");
  field.controller = "player"; field.scoredBy.push("player");
  if (method === "conquer" && b.players.player.score >= 7 && !b.battlefields.every((f) => f.scoredBy.includes("player"))) {
    draw(b, "player"); b.log.push("You haven’t scored every battlefield this turn, so at 7 points you draw a card for conquering this one.");
  } else { b.players.player.score++; b.log.push(`${method === "hold" ? "Hold" : "Conquer"}: +1 point.`); }
  if (b.players.player.score >= 8) { b.phase = "Victory"; b.log.push("Eight points. You win!"); }
}

function mutate(b: TutorialBoard, action: TutorialAction, lessonId: string, stepId: string, demonstration?: TutorialStep["combatDemonstration"]) {
  const c = "cardId" in action && action.cardId ? findCard(b, action.cardId) : undefined;
  switch (action.type) {
    case "choose": b.decisions={...b.decisions,[stepId]:action.optionId};break;
    case "demonstrate-keyword": {
      throw new Error("Follow the highlighted card actions to play through this example one move at a time.");
    }
    case "setup": {
      const setup = b.setup!;
      if (action.item === "legend") { place(b, "p-legend", "legend"); place(b, "o-legend", "legend"); b.log.push("Both legends are face up: Ahri and Orianna."); }
      if (action.item === "champion") {
        place(b, "p-champion", "champion"); place(b, "o-champion", "champion");
        b.players.player.deckCount--; b.players.opponent.deckCount--;
        b.log.push("Both chosen champions are set aside from their main decks, face up.");
      }
      if (action.item === "battlefields") {
        setup.selectedBattlefieldId = action.cardId!;
        b.log.push("We’ve both revealed our battlefield, Monastery of Hirana on the left and Rockfall Path on the right.");
      }
      if (action.item === "main-deck") b.log.push("We’ve each set aside our chosen champion and shuffled the other 39 into our main deck. In this lesson the draws are fixed so you get to try the same plays.");
      if (action.item === "rune-deck") b.log.push("We’ve each shuffled our separate 12-card rune deck, placed it beside our main deck and presented both decks to each other.");
      if (action.item === "turn-order") { b.firstPlayer = action.choice === "first" ? "player" : "opponent"; b.turnPlayer = b.firstPlayer; b.log.push("You won the choice of who goes first, so you’ve chosen the first turn before either of us draws."); }
      if (action.item === "opening-hand") {
        for (const side of ["player", "opponent"] as const) {
          const prefix = side === "player" ? "p" : "o";
          for (const suffix of ["sentry", "sentry-2", side === "player" ? "opening-ahri" : "discipline", "discipline-2"]) {
            const opening = place(b, `${prefix}-${suffix}`, "hand"); opening.faceDown = side === "opponent";
          }
          b.players[side].deckCount -= 4;
        }
        b.log.push("Both players draw four. Mulligans happen next, in turn order.");
      }
      setup.completedItems.push(action.item);
      const order: TutorialSetupItem[] = ["legend", "champion", "battlefields", "main-deck", "rune-deck", "turn-order", "opening-hand"];
      setup.stage = order[order.indexOf(action.item) + 1] ?? "complete";
      break;
    }
    case "inspect": b.log.push(`Inspected ${c?.name ?? INTRO_ZONE_NAMES[action.cardId] ?? fieldAt(b, action.cardId as TutorialBattlefieldId).name}.`); break;
    case "mulligan":
      for (const id of action.cardIds) { findCard(b, id)!.zone = "deck"; findCard(b, id)!.faceDown = true; }
      b.cards.push(card("OGN-096", "p-replacement", "player", "hand"));
      b.log.push("You set aside the Ahri from your hand, draw a replacement, then recycle that Ahri. Your chosen champion stays in its zone. The opponent keeps all four. Main-deck and hand sizes are unchanged."); break;
    case "ready": readySide(b, "player"); b.phase = "Beginning"; b.log.push("Awaken readies your cards; Beginning comes next."); break;
    case "check-beginning": b.phase="Channel";b.log.push("You’ve checked Beginning and finished any holding points or effects, so it’s time to Channel.");break;
    case "choose-trigger": b.decisions={...b.decisions,[`trigger:${action.cardId}`]:action.targetId};b.log.push(`You chose ${findCard(b,action.targetId)!.name} for ${c!.name}’s triggered ability.`);break;
    case "channel": {
      const count = b.turn === 2 && b.firstPlayer === "opponent" ? 3 : 2;
      addRunes(b, "player", count); b.phase = "Draw"; b.log.push(`Channel ${count} ready runes.`); break;
    }
    case "draw": draw(b, "player"); b.phase = "Main"; b.log.push("Draw 1; begin Main phase. Any unspent earlier resources empty."); break;
    case "exhaust": c!.ready = false; b.players.player.energy++; b.log.push(`${c!.name}: +1 energy.`); break;
    case "recycle": c!.zone = "rune-deck"; c!.faceDown = true; b.players.player.runeDeckCount++; b.players.player.power[c!.domain] = (b.players.player.power[c!.domain] ?? 0) + 1; b.log.push(`${c!.name} returns to the bottom of the rune deck: +1 ${c!.domain} power. Available energy is unchanged.`); break;
    case "play": {
      const wasHidden = c!.zone === "hidden";
      if (!wasHidden) { b.players.player.energy -= c!.energyCost; b.players.player.power[c!.domain] = (b.players.player.power[c!.domain] ?? 0) - c!.powerCost; }
      c!.faceDown = false;
      if (c!.type === "unit") { c!.zone = action.destination!; c!.ready = false; b.log.push(`${c!.name} enters exhausted.`); }
      else { c!.zone = "chain"; b.chain.push({ id: c!.instanceId, cardId: c!.cardId, controller: "player", label: `${c!.name} → ${findCard(b, action.targetId!)!.name}`, targetId: action.targetId }); b.priority = "player"; b.log.push(`${c!.name} is added to the chain.`); }
      break;
    }
    case "move-units": {
      for(const id of action.cardIds){const unit=findCard(b,id)!;unit.zone=action.destination;unit.ready=false;for(const gear of b.cards.filter(c=>c.attachedTo===id))gear.zone=action.destination;}
      b.practiceBattlefieldId=action.destination;b.passedBy=[];b.priority="player";
      const contested=b.cards.some(c=>c.owner==="opponent"&&c.type==="unit"&&c.zone===action.destination);
      b.combat=contested?{battlefieldId:action.destination,attacker:"player",assignments:{}}:null;b.phase=contested?"Combat showdown":"Showdown";
      b.log.push("Your units exhausted to move together, so there’s one move and one showdown at the battlefield they share.");break;
    }
    case "move": {
      const from=c!.zone;
      c!.zone = action.destination;
      if(b.foundation)for(const gear of b.cards.filter(g=>g.attachedTo===c!.instanceId))gear.zone=action.destination;
      if(from.startsWith("battlefield")&&!b.cards.some(x=>x.owner===c!.owner&&x.type==="unit"&&x.zone===from))fieldAt(b,from as TutorialBattlefieldId).controller=null; c!.ready = false;
      const enemy = b.cards.find((v) => v.owner === "opponent" && v.type === "unit" && v.zone === action.destination);
      if (action.destination === "base") { b.log.push(`${c!.name} moves to base.`); break; }
      b.phase = enemy ? "Combat showdown" : "Showdown"; b.priority = "player";
      if (enemy) {
        b.combat = { battlefieldId: action.destination as TutorialBattlefieldId, attacker: "player", assignments: {} };
        if (c!.cardId === "OGN-119") b.log.push("Ahri’s attack trigger is pending.");
        if (fieldAt(b, action.destination as TutorialBattlefieldId).controller === "opponent" && findCard(b, "o-legend")?.cardId === "OGN-255") { c!.might = Math.max(1, c!.might - 1); b.log.push("The opposing Ahri legend resolves: attacker -1 Might, minimum 1."); }
      }
      b.log.push(`${c!.name} contests the battlefield. A showdown opens.`); break;
    }
    case "pass":
      passPriority(b,"player"); b.log.push(b.foundation&&!b.chain.length?"You pass focus.":"You pass priority.");
      break;
    case "resolve": {
      if (b.chain.length) {
        const item = b.chain.pop()!; const spell = findCard(b, item.id)!; const target = findCard(b, item.targetId ?? "");
        if (spell.cardId === "OGN-045" && target?.type === "spell" && target.zone === "chain") {
          b.chain = b.chain.filter((waiting) => waiting.id !== target.instanceId);
          target.zone = "trash"; target.faceDown = false;
          b.log.push(`${spell.name} counters ${target.name}: it goes to the trash without resolving. All paid costs stay spent.`);
        }
        if (target && ["base", "battlefield-left", "battlefield-right"].includes(target.zone)) {
          if (spell.cardId === "OGN-050") { target.stunned = true; b.log.push(`${spell.name}: ${target.name} is stunned and contributes no combat damage this turn.`); }
          if (spell.cardId === "OGN-058") { target.might += 2; draw(b, item.controller); b.log.push(`${spell.name}: ${target.name} gets +2 Might this turn; draw 1.`); }
          if (spell.cardId === "OGN-213") {
            const owner = target.owner; const deathknell = target.keywords.includes("Deathknell");
            kill(b, target, false); draw(b, owner, 2); b.log.push("Hidden Blade: the killed unit's controller draws 2.");
            if (deathknell) b.log.push("The Sentry’s Deathknell is pending after Hidden Blade finishes.");
          }
        }
        spell.zone = "trash"; b.priority = b.chain.at(-1)?.controller ?? "player";b.passedBy=[];
        if (!b.chain.length && b.combat?.attacker === "player") b.log.push("The chain is empty. The combat showdown continues.");
        if (!b.chain.length && lessonId === "hidden-cards") { b.combat = null; b.phase = "Main"; }
      } else if (b.combat) {
        const location = b.combat.battlefieldId;
        const friendly = b.cards.filter((v) => v.owner === "player" && v.type === "unit" && v.zone === location);
        const enemies = b.cards.filter((v) => v.owner === "opponent" && v.type === "unit" && v.zone === location);
        if (!Object.keys(b.combat.assignments).length) throw new Error("Assign combat damage before dealing it.");
        const incoming = enemies.reduce((sum, unit) => sum + unit.might, 0);
        let remaining = incoming;
        const ordered = [...friendly].sort((a, z) => Number(z.keywords.includes("Tank")) - Number(a.keywords.includes("Tank")));
        for (let i = 0; i < ordered.length; i++) {
          const unit = ordered[i]; const assigned = i === ordered.length - 1 ? remaining : Math.min(remaining, unit.might - unit.damage);
          unit.damage += assigned; remaining -= assigned;
        }
        for (const unit of enemies) unit.damage += b.combat.assignments[unit.instanceId] ?? 0;
        const dead = [...friendly, ...enemies].filter((unit) => unit.damage >= unit.might);
        b.log.push(`Combat damage is dealt simultaneously. The guide assigned ${incoming} damage${ordered[0]?.keywords.includes("Tank") ? " to Tank first" : ""}.`);
        for (const unit of dead) kill(b, unit);
        for (const unit of [...friendly, ...enemies]) unit.damage = 0;
        b.phase = "Conquer";
      }
      break;
    }
    case "assign-damage": b.combat!.assignments = { ...action.assignments }; b.log.push("You’ve assigned your damage, and I’ll assign mine before either side deals it."); break;
    case "demonstrate-combat":
      b.combat!.assignments = Object.fromEntries(demonstration!.targetAssignments.map((entry) => [entry.cardId, entry.amount]));
      b.log.push(`Here’s how the damage is assigned. ${demonstration!.explanation}`); break;
    case "alternate-win-route": Object.assign(b, finalWinBoard("hold")); break;
    case "hide": {
      const domain = (Object.keys(b.players.player.power) as TutorialDomain[]).find((key) => (b.players.player.power[key] ?? 0) > 0)!;
      b.players.player.power[domain]!--; if(b.practice&&c!.zone==="hand")b.players.player.handCount!--; c!.zone = "hidden"; c!.faceDown = true; c!.hiddenAt = action.battlefieldId; c!.hiddenOnTurn = b.turn;
      b.log.push("Blade is facedown, so there’s nothing on the chain and you’ll need to wait until a later turn to play it from Hidden."); break;
    }
    case "end-turn": newTurn(b, "opponent"); b.log.push("Your turn ends. The opponent starts Awaken."); break;
    case "score": {
      const holding = b.phase === "Beginning";
      const id = b.practiceBattlefieldId ?? (lessonId === "combat-damage" || stepId === "conquest-victory" ? "battlefield-right" : "battlefield-left");
      if (!holding && b.phase !== "Conquer") throw new Error("Finish the showdown before scoring for conquering.");
      scoreField(b, id, holding ? "hold" : "conquer");
      if (!holding) settleConqueredCombat(b);
      if (b.phase !== "Victory") { b.phase = holding ? "Beginning" : "Main"; b.priority = "player"; }
      break;
    }
    case "continue": {
      if (stepId === "beginning") b.phase = "Channel";

      break;
    }
  }
  b.log = b.log.slice(-40);
}

export function applyTutorialAction(state: TutorialState, action: TutorialAction): TutorialState {
  const current = getTutorialStep(state);
  if (!current || state.completed) return { ...state, feedback: "This lesson is complete. Replay it or choose another lesson." };
  const optionId=action?.type==="choose"?action.optionId:undefined;
  const choice=current.decision&&optionId?current.decision.options.find(option=>option.id===optionId):undefined;
  if(action?.type==="choose"&&(!choice||!choice.accepted||Object.keys(action).some(key=>key!=="type"&&key!=="optionId")))return {...state,feedback:choice?.explanation??"Choose one of the answers shown for this question."};
  // A native card click need not redundantly name the location of the facedown
  // space it came from. Infer only from that actual card, never from a target.
  if (action?.type === "play" && action.destination === undefined && current.expectedAction.type === "play" && current.expectedAction.destination !== undefined) {
    const playedCard = findCard(state.board, action.cardId);
    if (playedCard?.zone === "hidden" && playedCard.hiddenAt) action = { ...action, destination: playedCard.hiddenAt };
    else if (playedCard?.type === "unit") action = { ...action, destination: "base" };
  }
  const equivalentPracticeRune = current.guidance === "practice" && current.allowedCardIds && action?.type === "exhaust" && current.expectedAction.type === "exhaust" && current.allowedCardIds.includes(action.cardId) && actionMatches(action,{...current.expectedAction,cardId:action.cardId});
  const equivalentPracticeMove = current.guidance === "practice" && current.allowedCardIds && current.allowedDestinations && action?.type === "move" && current.expectedAction.type === "move" && current.allowedCardIds.includes(action.cardId) && current.allowedDestinations.includes(action.destination as TutorialBattlefieldId) && !fieldAt(state.board,action.destination as TutorialBattlefieldId).scoredBy.includes("player") && !state.board.cards.some(c=>c.type==="unit"&&c.zone===action.destination) && actionMatches(action,{...current.expectedAction,cardId:action.cardId,destination:action.destination});
  if (!choice && !equivalentPracticeRune && !equivalentPracticeMove && !actionMatches(action, current.expectedAction)) {
    // Special keyword positions have permissions the small core validator does not
    // model generally (Flow, Ganking, Ambush...). Do not call those moves illegal
    // merely because they are outside the authored demonstration.
    const checkable=current.keywordScenarioId?["inspect","exhaust","recycle","ready","check-beginning","channel","draw","choose-trigger"]:["inspect","exhaust","recycle","play","move","move-units","spend-buff","mulligan","channel","draw","ready","check-beginning","choose-trigger","pass","end-turn"];
    const hiddenPlay=action?.type==="play"&&findCard(state.board,action.cardId)?.zone==="hidden";
    const ruleProblem = action && (checkable.includes(action.type)||hiddenPlay) ? validate(state.board,action) : null;
    return {...state,feedback:ruleProblem ? `Rule check: ${ruleProblem}` : current.guidance==="practice" ? "That play might work in another game, but we’re trying something else in this exercise. Have a look at the goal, or open Help for a clue." : "That’s an exercise restriction for the line we’re playing here. Your move can still be legal in a real game, so check the goal or open Help to see the play we want to try."};
  }
  if (current.keywordScenarioId && keywordPositionSignature(state.board) !== keywordPositionSignature(canonicalKeywordPosition(state.lessonId,state.stepIndex))) return { ...state, feedback: "This practice position has changed, so restart this example to get the cards back where you need them." };
  if (action.type === "demonstrate-combat" && !current.combatDemonstration) return { ...state, feedback: "This step has no damage demonstration." };
  const manualPhase=["ready","check-beginning","channel","draw","choose-trigger","move-units","spend-buff"].includes(action.type);
  const problem = (current.guideEffect || current.rulesEffect) && !manualPhase ? null : action.type === "demonstrate-combat"
    ? validateTutorialDamageAssignment(state.board, Object.fromEntries(current.combatDemonstration!.targetAssignments.map((entry) => [entry.cardId, entry.amount])))
    : validate(state.board, action);
  if (problem) return { ...state, feedback: `Rule check: ${problem}` };
  const board = clone(state.board);
  try { executeTutorialStep(board,current,state.lessonId,state.stepIndex,action); }
  catch (error) { return { ...state, feedback: error instanceof Error ? error.message : "That action is not available in this position." }; }
  const stepIndex = state.stepIndex + 1;
  return { ...state, board, stepIndex, completed: stepIndex === getTutorialStepCount({lessonId:state.lessonId,board}),
    feedback: null, actions: [...state.actions, clone(action)], history: [...state.history, clone(state.board)].slice(-30) };
}


/** Named current modifiers are presentation of actual state, never alternate damage. */
function refreshMightModifiers(board:TutorialBoard){
  const k=board.practice?.keyword;
  for(const c of board.cards){
    c.mightModifiers=[];
    if(c.type!=="unit"||!["base","battlefield-left","battlefield-right"].includes(c.zone))continue;
    let remaining=c.might-c.baseMight;
    const add=(label:string,amount:number)=>{if(amount>0&&remaining>=amount){c.mightModifiers!.push({label,amount});remaining-=amount;}};
    if(c.buffCount)add("Buff counter",c.buffCount);
    if(board.cards.some(g=>g.cardId==="SFD-022"&&g.attachedTo===c.instanceId))add("Long Sword",2);
    if(board.cards.some(g=>g.cardId==="SFD-073"&&g.attachedTo===c.instanceId))add("Experimental Hexplate",1);
    if(c.cardId==="UNL-016"&&(board.players[c.owner].xp??0)>=3)add("Level 3",1);
    if(board.combat&&c.zone===board.combat.battlefieldId){
      if(c.owner===board.combat.attacker){
        if(c.cardId==="OGN-215"||c.cardId==="OGN-210")add("Assault",1);
        if(c.cardId==="UNL-002")add("Assault 2",2);
        if(c.cardId==="VEN-001"&&c.empowered)add("Empowered · Assault 2",2);
        if(k==="Action"&&c.owner==="player"||k==="Reaction"&&c.owner==="opponent")add("Cleave · Assault 3",3);
        if(k==="Repeat"&&c.owner==="player")add("Blood Rush ×2 · Assault",4);
        if(board.cards.some(g=>g.cardId==="RAD-002"&&g.owner===c.owner&&g.zone===c.zone))add("Banner · Assault",1);
      } else if(c.cardId==="OGN-054")add("Shield",1);
    }
    if(board.foundation&&c.instanceId==="p-one"&&board.cards.some(spell=>spell.instanceId==="p-discipline"&&spell.zone==="trash"))add("Discipline · this turn",2);
    if(remaining)c.mightModifiers.push({label:remaining<0?(k==="Disarm"?"Disarm 2":"Card effect"):k==="Reaction"||k==="Ambush"?"Discipline":"Card effect",amount:remaining});
  }
}
function recordTutorialImpact(before:TutorialBoard,after:TutorialBoard,current:TutorialStep){
  const changes:NonNullable<NonNullable<TutorialBoard["impact"]>["changes"]>=[];
  for(const c of after.cards){
    const old=before.cards.find(o=>o.instanceId===c.instanceId);
    if(!old){if(!c.faceDown)changes.push({cardId:c.instanceId,kind:"zone",before:"off table",after:c.zone,label:"Entered"});continue;}
    if(c.faceDown&&old.faceDown)continue;
    for(const key of ["might","damage","zone"] as const)if(old[key]!==c[key])changes.push({cardId:c.instanceId,kind:key,before:old[key],after:c[key],label:key==="might"?c.mightModifiers?.map(m=>m.label).join(" + "):undefined});
    if(old.ready!==c.ready&&old.zone===c.zone)changes.push({cardId:c.instanceId,kind:"status",before:old.ready?"ready":"exhausted",after:c.ready?"ready":"exhausted"});
    if((old.buffCount??0)!==(c.buffCount??0))changes.push({cardId:c.instanceId,kind:"status",before:old.buffCount??0,after:c.buffCount??0,label:"Buff counter"});
    if(old.empowered!==c.empowered)changes.push({cardId:c.instanceId,kind:"status",before:old.empowered?"Empowered":"not Empowered",after:c.empowered?"Empowered":"not Empowered"});
    if(old.attachedTo!==c.attachedTo)changes.push({cardId:c.instanceId,kind:"status",before:old.attachedTo?"attached":"unattached",after:c.attachedTo?`attached to ${after.cards.find(u=>u.instanceId===c.attachedTo)?.name??"unit"}`:"unattached"});
  }
  for(const removed of before.cards.filter(c=>!after.cards.some(a=>a.instanceId===c.instanceId)))changes.push({cardId:removed.instanceId,kind:"zone",before:removed.zone,after:removed.token?"ceased to exist":"removed from draft"});
  for(const side of ["player","opponent"] as const){
    const previous=before.players[side],next=after.players[side];
    for(const key of ["energy","score"] as const)if(previous[key]!==next[key])changes.push({side,kind:key,before:previous[key],after:next[key]});
    for(const domain of ["Fury","Calm","Mind","Body","Chaos","Order"] as const)if((previous.power[domain]??0)!==(next.power[domain]??0))changes.push({side,kind:"power",before:previous.power[domain]??0,after:next.power[domain]??0,label:domain});
    if((previous.xp??0)!==(next.xp??0))changes.push({side,kind:"status",before:previous.xp??0,after:next.xp??0,label:"XP"});
  }
  if(changes.length)after.impact={id:current.id,label:current.title,sourceIds:current.focusIds,targetIds:changes.flatMap(c=>c.cardId?[c.cardId]:[]),changes};
}

function executeTutorialStep(board:TutorialBoard,current:TutorialStep,lessonId:string,stepIndex:number,acceptedAction:TutorialAction=current.expectedAction) {
  const previous=clone(board);
  const effect=current.guideEffect??current.rulesEffect;
  const input=acceptedAction;
  const rulesLesson=current.rulesLessonId??lessonId;
  if(current.guidance==="practice"&&acceptedAction.type==="move"&&acceptedAction.destination.startsWith("battlefield"))board.practiceBattlefieldId=acceptedAction.destination as TutorialBattlefieldId;
  if(["exhaust","recycle","play","activate","move","move-units","hide"].includes(input.type))board.passedBy=[];
  if(effect)applyGuideEffect(board,effect,current,rulesLesson);
  else mutate(board,acceptedAction,rulesLesson,current.id,current.combatDemonstration);
  if (previous.phase === "Draw" && board.phase === "Main") emptyRunePools(board);
  if(board.combat?.pendingEnd)finishTutorialCombat(board);
  refreshMightModifiers(board);recordTutorialImpact(previous,board,current);
  const next=getTutorialSteps({lessonId,board})[stepIndex+1];
  if(current.keywordScenarioId&&next?.keywordScenarioId&&next.keywordScenarioId!==current.keywordScenarioId){delete board.impact;Object.assign(board,createKeywordTutorialBoard(next.keywordScenarioId));}
}
const canonicalKeywordCache=new Map<string,TutorialBoard>();
function canonicalKeywordPosition(lessonId:string,index:number):TutorialBoard {
  const key=`${lessonId}:${index}`,cached=canonicalKeywordCache.get(key);if(cached)return cached;
  const board=index===0?checkpoint(lessonId):clone(canonicalKeywordPosition(lessonId,index-1));
  if(index>0)executeTutorialStep(board,LESSONS.find(l=>l.id===lessonId)!.steps[index-1],lessonId,index-1);
  canonicalKeywordCache.set(key,board);return board;
}


// Additional bounded board exercises. Old lesson actions do not use these operations.
const FOUNDATION_IDS=["scoring-once-per-turn","group-movement","damage-and-might","buffs-and-bonuses","equipment-lifecycle","champion-destinations","ready-runes-and-defenders","passing-decisions"];
function foundationKnownCard(id:string){return id in CARD_IDENTITIES||KEYWORD_LEGEND_PAIRS.some(p=>p.legend.cardId===id||p.champion.cardId===id)||NEW_PLAYER_KEYWORD_SCENARIOS.some(s=>[...s.before.cards,...s.after.cards].some(c=>c.cardId===id));}
function foundationCard(id:string,instanceId:string,owner:TutorialSide,zone:TutorialZone,ready=true):TutorialCard{
  if(id in CARD_IDENTITIES)return card(id as CardCode,instanceId,owner,zone,ready);
  const rune=Object.entries(PRACTICE_RUNES).find(([,r])=>r.cardId===id);if(rune)return {instanceId,cardId:id,name:rune[1].name,imageUrl:rune[1].imageUrl,type:"rune",owner,zone,ready,faceDown:false,might:0,baseMight:0,damage:0,energyCost:0,powerCost:0,domain:rune[0] as TutorialDomain,keywords:[],rulesText:`Exhaust for 1 energy. Recycle for 1 ${rune[0]} power.`};

  const source=[...KEYWORD_LEGEND_PAIRS.flatMap(p=>[p.legend,p.champion]),...NEW_PLAYER_KEYWORD_SCENARIOS.flatMap(s=>[...s.before.cards,...s.after.cards])].find(c=>c.cardId===id);
  if(!source)throw new Error(`Missing verified foundation identity ${id}`);
  return {instanceId,cardId:id,name:source.name,imageUrl:source.imageUrl,type:source.type??"unit",owner,zone,ready,faceDown:owner==="opponent"&&zone==="hand",might:source.baseMight??0,baseMight:source.baseMight??0,damage:0,energyCost:source.energyCost??0,powerCost:source.powerCost??0,domain:source.domains?.[0]??"Mind",domains:source.domains,keywords:source.keywords??[],rulesText:source.text??""};
}
function foundationBoard(id:string,variant="start"):TutorialBoard{
  const b=initialBoard();b.foundation={lessonId:id,variant};b.cards=[];b.turn=7;b.phase="Main";b.turnPlayer="player";b.priority="player";b.chain=[];b.combat=null;b.passedBy=[];
  const playerDeck=id==="buffs-and-bonuses"?"teaching-buffs-ahri":id==="equipment-lifecycle"?"teaching-kaisa":id==="champion-destinations"?"teaching-champion-viktor":id==="ready-runes-and-defenders"?"teaching-first-game-orianna":"teaching-first-game-ahri";
  const opponentDeck=(id==="equipment-lifecycle"||id==="champion-destinations")&&variant==="bounce"?"teaching-play-effects-teemo":id==="equipment-lifecycle"?"teaching-darius":id==="ready-runes-and-defenders"?"teaching-first-game-ahri":"teaching-first-game-orianna";
  for(const [side,deckId]of [["player",playerDeck],["opponent",opponentDeck]]as const){const deck=getNewPlayerTeachingDeck(deckId)!;const prefix=side==="player"?"p":"o";const legend=foundationCard(deck.legendId,`${prefix}-legend`,side,"legend");legend.domains=[...deck.domains] as TutorialDomain[];b.cards.push(legend,{...foundationCard(deck.championId,`${prefix}-champion`,side,"champion"),champion:true});b.players[side]={name:`${side==="player"?"You":"Guide"} · ${legend.name.split(",")[0]}`,teachingDeckId:deckId,score:2,energy:0,power:{},deckCount:39,runeDeckCount:12};}
  const put=(code:string,key:string,side:TutorialSide,zone:TutorialZone,ready=true)=>{const c=foundationCard(code,key,side,zone,ready);b.cards.push(c);return c;};
  if(id==="scoring-once-per-turn") {
    put("OGN-044","p-one","player","battlefield-left");put("OGN-065","p-two","player","base");put("SFD-074","p-three","player","base");
    b.battlefields[0].controller="player";b.phase="Beginning";b.turn=5;b.players.player.score=1;b.players.opponent.score=1;
  }
  if(id==="group-movement") {put("SFD-074","p-one","player","base");put("OGN-044","p-two","player","base");put("OGN-065","o-one","opponent","battlefield-left");b.battlefields[0].controller="opponent";}
  if(id==="damage-and-might") {put("OGN-065","p-one","player","base");put("SFD-074","o-one","opponent","battlefield-left");b.battlefields[0].controller="opponent";}
  if(id==="buffs-and-bonuses") {put("SFD-074","p-one","player","base");put("OGN-063","p-refuge","player","hand");put("OGN-058","p-discipline","player","hand");put("SFD-073","p-gear","player","hand");}
  if(id==="equipment-lifecycle") {const host=put("OGN-010","p-one","player",variant==="bounce"?"battlefield-left":"base");host.might=4;put("OGN-010","p-two","player","base");const gear=put("SFD-022","p-gear","player",host.zone);gear.attachedTo=host.instanceId;if(variant!=="bounce"){put("OGN-012","o-one","opponent","battlefield-left");b.battlefields[0].controller="opponent";}else b.battlefields[0].controller="player";}
  if(id==="champion-destinations") {const chosen=findCard(b,"p-champion")!;chosen.zone=variant==="copies"?"hand":"battlefield-left";chosen.ready=false;put("OGN-117","p-copy","player","hand");if(variant==="start"){put("OGN-065","o-one","opponent","base");b.turnPlayer="opponent";b.priority="opponent";}b.battlefields[0].controller=variant==="copies"?null:"player";}
  if(id==="ready-runes-and-defenders") {put("OGN-044","p-one","player","battlefield-left",false);put("OGN-058","p-discipline","player","hand");put("SFD-074","o-one","opponent","base");b.battlefields[0].controller="player";}
  if(id==="passing-decisions") {put("OGN-044","p-one","player","battlefield-left",false);put("SFD-074","o-one","opponent","battlefield-left");put("OGN-058","p-discipline","player","hand");b.battlefields[0].controller="opponent";b.combat={battlefieldId:"battlefield-left",attacker:"player",assignments:{}};b.phase="Combat showdown";}
  if(variant==="bounce"){put("OGN-171","o-mystic-poro","opponent","base");put("UNL-128","o-star-crossed","opponent","hand");b.turnPlayer="opponent";b.priority="opponent";}
  addRunes(b,"player",id==="buffs-and-bonuses"?5:variant==="copies"?8:id==="ready-runes-and-defenders"?4:2);addRunes(b,"opponent",4);
  if(id==="buffs-and-bonuses"||variant==="copies"){
    const count=id==="buffs-and-bonuses"?5:8;b.players.player.energy=count;
    for(const c of b.cards.filter(c=>c.owner==="player"&&c.type==="rune"))c.ready=false;
    for(const n of id==="buffs-and-bonuses"?[1,2]:[1,3]){const rune=findCard(b,`p-rune-${n}`)!;rune.zone="rune-deck";rune.faceDown=true;b.players.player.runeDeckCount++;b.players.player.power[rune.domain]=(b.players.player.power[rune.domain]??0)+1;}
  }
  for(const side of ["player","opponent"]as const)b.players[side].deckCount=40-b.cards.filter(c=>c.owner===side&&!["legend","rune"].includes(c.type)).length;
  b.log=[`This separate practice starts with the earlier unit play effects already finished. We’re leaving the optional legend abilities alone, and you can open either main deck to see the full list.`];return b;
}
function foundationDepart(b:TutorialBoard,unit:TutorialCard,destination:"hand"|"trash"){
  for(const gear of b.cards.filter(c=>c.attachedTo===unit.instanceId))delete gear.attachedTo;
  unit.zone=destination;unit.faceDown=destination==="hand"&&unit.owner==="opponent";unit.might=unit.baseMight;unit.damage=0;unit.buffCount=0;unit.mightModifiers=[];
  // The subsequent cleanup/combat-result step decides control; departure alone does not.
}
function applyFoundationEffect(b:TutorialBoard,op:string,current:TutorialStep){
  if(!b.foundation)throw new Error("This operation needs its own prepared teaching position.");
  const lessonId=b.foundation.lessonId;
  if(op.startsWith("reset:")){Object.assign(b,foundationBoard(lessonId,op.slice(6)));delete b.impact;return;}
  if(op==="scoring-claim-only"){
    const field=fieldAt(b,"battlefield-left");
    if(b.phase!=="Conquer"||b.priority!==null||b.chain.length||!field.scoredBy.includes("player")||!b.cards.some(c=>c.owner==="player"&&c.type==="unit"&&c.zone===field.id)||b.cards.some(c=>c.owner==="opponent"&&c.type==="unit"&&c.zone===field.id))throw new Error("Finish this already-scored battlefield’s showdown before regaining control.");
    field.controller="player";finishTutorialCombat(b);b.phase="Main";b.priority="player";b.passedBy=[];
    b.log.push("You have control again, but you’ve already scored this battlefield this turn, so there’s no new conquer, point or conquer trigger.");return;
  }
  if(op==="scoring-other"||op==="scoring-hold-left"||op==="scoring-hold-right"){
    const holding=op!=="scoring-other",id=op==="scoring-hold-left"?"battlefield-left":"battlefield-right";
    if(b.turnPlayer!=="player"||b.chain.length||holding&&b.phase!=="Beginning"||!holding&&(b.phase!=="Conquer"||b.priority!==null))throw new Error("Reach the appropriate scoring window before scoring this battlefield.");
    scoreField(b,id,holding?"hold":"conquer");if(!holding)finishTutorialCombat(b);b.phase=holding?"Beginning":"Main";b.priority="player";return;
  }
  if(op==="assign"){
    const d=current.combatDemonstration!;if(!b.combat||b.priority!==null)throw new Error("Finish both response chances before assigning damage.");
    checkKeywordDamage(b,"player",d.targetAssignments);checkKeywordDamage(b,"opponent",d.returnAssignments??[]);b.combat.assignments=Object.fromEntries(d.targetAssignments.map(a=>[a.cardId,a.amount]));return;
  }
  if(op==="damage"){
    if(!b.combat||!Object.keys(b.combat.assignments).length)throw new Error("Assign both sides’ combat damage first.");
    const d=current.combatDemonstration!;for(const a of [...d.targetAssignments,...d.returnAssignments??[]])findCard(b,a.cardId)!.damage+=a.amount;
    for(const unit of b.cards.filter(c=>c.type==="unit"&&c.zone===b.combat!.battlefieldId&&c.damage>=c.might))foundationDepart(b,unit,"trash");return;
  }
  if(op==="cleanup"){
    if(b.chain.length)throw new Error("Finish the chain before this cleanup check.");
    for(const c of b.cards){if(c.type==="unit"&&b.combat)c.damage=0;if(c.type==="gear"&&!c.attachedTo&&c.zone.startsWith("battlefield")){c.zone="base";c.annotation="The unattached Equipment went back to base in cleanup, with its readiness unchanged.";}}
    const field=b.combat?.battlefieldId??"battlefield-left",attacker=b.combat?.attacker??"player";
    const friend=b.cards.some(c=>c.type==="unit"&&c.owner==="player"&&c.zone===field),enemy=b.cards.some(c=>c.type==="unit"&&c.owner==="opponent"&&c.zone===field);
    if(attacker==="player"&&friend&&!enemy){b.phase="Conquer";b.priority="player";}else if(attacker==="opponent"&&enemy&&!friend){b.phase="Conquer";b.priority="opponent";}else{finishTutorialCombat(b);b.phase="Main";b.priority=b.turnPlayer;for(const location of b.battlefields)if(!b.cards.some(c=>c.type==="unit"&&c.owner===location.controller&&c.zone===location.id))location.controller=null;}return;
  }
  if(op==="score") {scoreField(b,"battlefield-left","conquer");finishTutorialCombat(b);b.phase="Main";b.priority="player";return;}
  if(op==="buff-conquer"){scoreField(b,"battlefield-left","conquer");b.phase="Conquer triggers";b.priority="player";return;}
  if(op==="buff-spend"){
    const unit=findCard(b,"p-one")!;if(unit.buffCount!==1)throw new Error("Only a real Buff counter can pay this cost.");unit.buffCount=0;unit.might--;unit.keywords=unit.keywords.filter(k=>k!=="Deflect");b.chain.push({id:"monastery:trigger",cardId:"OGN-282",controller:"player",label:"Monastery of Hirana — Buff cost paid; draw 1"});b.priority="player";b.passedBy=[];return;
  }
  if(op==="monastery-resolve"){if(b.priority!==null||b.chain.at(-1)?.cardId!=="OGN-282")throw new Error("Both players must pass on Monastery’s draw.");b.chain.pop();draw(b,"player");finishTutorialCombat(b);b.phase="Main";b.priority="player";b.passedBy=[];return;}
  if(op==="play-gear"){
    const action=current.expectedAction;if(action.type!=="play")throw new Error("Choose the gear being played.");const gear=findCard(b,action.cardId)!,p=b.players.player;
    if(gear.zone!=="hand"||p.energy<gear.energyCost||(p.power[gear.domain]??0)<gear.powerCost)throw new Error("Pay this gear’s normal printed cost.");p.energy-=gear.energyCost;if(gear.powerCost)p.power[gear.domain]!--;gear.zone="base";gear.ready=true;b.priority="player";return;
  }
  if(op==="buff-trigger"){
    if(b.decisions?.["trigger:p-refuge"]!=="p-one")throw new Error("Choose the friendly unit to buff before queuing the play trigger.");delete b.decisions!["trigger:p-refuge"];addTrigger(b,"p-refuge","Spirit’s Refuge — Buff Pickpocket","p-one");return;
  }
  if(op==="buff-resolve") {if(b.priority!==null||b.chain.at(-1)?.cardId!=="OGN-063")throw new Error("Both players must pass on the Buff ability.");b.chain.pop();const unit=findCard(b,"p-one")!;if(!unit.buffCount){unit.buffCount=1;unit.might++;unit.keywords.push("Deflect");}b.priority="player";b.passedBy=[];return;}
  if(op==="equip"){
    const gear=findCard(b,"p-gear")!,unit=findCard(b,lessonId==="equipment-lifecycle"?"p-two":"p-one")!;const domain=gear.domain;
    if((b.players.player.power[domain]??0)<1||gear.attachedTo||gear.zone!=="base"||unit.owner!=="player")throw new Error("Equip needs its matching power and an unattached gear in your base.");b.players.player.power[domain]!--;addTrigger(b,gear.instanceId,`${gear.name} — Equip`,unit.instanceId);return;
  }
  if(op==="equip-resolve"){
    const item=b.chain.at(-1);if(b.priority!==null||item?.id!=="p-gear:trigger")throw new Error("Both players must pass before the Equipment attaches.");b.chain.pop();const gear=findCard(b,"p-gear")!,unit=findCard(b,item.targetId!)!;gear.attachedTo=unit.instanceId;gear.zone=unit.zone;unit.might+=gear.cardId==="SFD-022"?2:1;b.priority="player";b.passedBy=[];return;
  }
  if(op==="resolve-response") {mutate(b,{type:"resolve"},lessonId,current.id);b.priority=b.combat?"opponent":b.turnPlayer;b.passedBy=[];return;}
  if(op==="bounce-power") {const rune=findCard(b,"o-rune-1")!;if(rune.ready||rune.zone!=="runes"||rune.domain!=="Chaos")throw new Error("Recycle the exhausted Chaos rune.");rune.zone="rune-deck";rune.faceDown=true;b.players.opponent.runeDeckCount++;b.players.opponent.power.Chaos=(b.players.opponent.power.Chaos??0)+1;return;}
  if(op==="bounce-play"){
    const enemy=findCard(b,lessonId==="champion-destinations"?"p-champion":"p-one")!,friendly=findCard(b,"o-mystic-poro")!,spell=findCard(b,"o-star-crossed")!,p=b.players.opponent;
    if(p.energy<3||(p.power.Chaos??0)<1||b.priority!=="opponent"||!friendly.zone.startsWith("base")||!["base","battlefield-left","battlefield-right"].includes(enemy.zone))throw new Error("Star-Crossed requires both selected units and its full cost.");p.energy-=3;p.power.Chaos!--;spell.zone="chain";spell.faceDown=false;b.chain.push({id:spell.instanceId,cardId:spell.cardId,controller:"opponent",label:`Star-Crossed → Mystic Poro + ${enemy.name}`,targetId:enemy.instanceId,targetIds:[friendly.instanceId,enemy.instanceId]});b.priority="opponent";b.passedBy=[];return;
  }
  if(op==="bounce-resolve") {const item=b.chain.at(-1);if(b.priority!==null||item?.cardId!=="UNL-128")throw new Error("Both players must pass on Star-Crossed.");b.chain.pop();for(const id of item.targetIds!)foundationDepart(b,findCard(b,id)!,"hand");findCard(b,item.id)!.zone="trash";b.priority=b.turnPlayer;b.passedBy=[];return;}
  throw new Error(`Unknown foundation operation ${op}`);
}

function foundationEffect(operation:string):TutorialGuideEffect{return {type:"foundations",operation};}
function foundationStep(id:string,title:string,instruction:string,action:TutorialAction,operation?:string):TutorialStep{return {...step(id,title,instruction,action,title),...(operation?{rulesEffect:foundationEffect(operation)}:{})};}
function foundationRule(id:string,title:string,instruction:string,operation:string):TutorialStep{return {...guide(id,title,instruction,foundationEffect(operation)),actor:"rules",label:"Next effect"};}
function foundationQuestion(id:string,title:string,prompt:string,right:string,why:string,wrong:string,wrongWhy:string):TutorialStep{return decision(id,title,prompt,[{id:"correct",label:right,explanation:why,accepted:true},{id:"incorrect",label:wrong,explanation:wrongWhy,accepted:false}]);}
function foundationResponses(prefix:string,operation?:string):TutorialStep[]{return [pass(`${prefix}-pass`,"Pass priority here to give the guide a chance to respond. Once you’ve dealt with the chain, there’s still the rest of the turn to play."),guide(`${prefix}-guide-pass`,"The guide passes too","The guide passes as well, so we can go ahead and resolve the newest effect on the chain.",{type:"pass",side:"opponent"},["chain"]),foundationStep(`${prefix}-resolve`,"Resolve the waiting effect","Resolve the newest effect and have a look at what changed. If there’s another effect underneath it, you’ll both get a chance to respond to that one too.",{type:"resolve"},operation)];}
function foundationCombat(prefix:string,sourceIds:string[],targetAssignments:Array<{cardId:string;amount:number;order:number}>,returnAssignments:Array<{cardId:string;amount:number;order:number}>):TutorialStep[]{
 const demonstration={sourceIds,targetAssignments,returnAssignments,explanation:"Add up the current Might on each side and look at where the damage is going, both players assign it before either side takes a hit."};
 return [{...foundationRule(`${prefix}-assign`,"Assign both sides’ damage",demonstration.explanation,"assign"),combatDemonstration:demonstration},{...foundationStep(`${prefix}-damage`,"Deal combat damage together","Deal the combat damage on both sides together. Even if that hit kills a unit, it still deals its own combat damage, and you’ll see the damage it took marked alongside its Might.",{type:"resolve"},"damage"),combatDemonstration:demonstration}];
}
function foundationCleanup(id="cleanup"):TutorialStep{return foundationRule(id,id.includes("bounce")?"What stayed at the battlefield?":"Cleanup heals the survivors",id.includes("bounce")?"Now the chain’s finished, have a look at the battlefield. Any Equipment left there without a bearer is recalled to its controller’s base as it is, even if it’s exhausted. If you’ve got no unit left there you lose control, and ordinary cleanup leaves any marked damage on your other units.":"Any unit that took lethal damage has already died, so now combat cleanup heals all units by clearing their marked damage. Their Might stays the same, and any unattached Equipment at a battlefield goes back to its controller’s base with the same readiness.","cleanup");}
function foundationReset(id:string,title:string,text:string,variant:string):TutorialStep{return {...continueStep(id,text),title,presentation:"lesson-intro",lessonIntro:{see:"We’re setting out a fresh example now, with the previous one finished.",do:text,why:"That gives us a chance to try a different play and see which pieces of the board change this time."},label:"Start this separate example",rulesEffect:foundationEffect(`reset:${variant}`)};}
function foundationBounce(prefix:string,unitId:string):TutorialStep[]{return [
 guide(`${prefix}-energy`,"The guide prepares 3 energy","Star-Crossed costs 3 energy, so watch the guide turn three ready runes sideways. There’s a Chaos symbol on the spell as well, so we still need to see where that power comes from.",{type:"exhaust-runes",cardIds:["o-rune-1","o-rune-2","o-rune-3"]},["o-rune-1","o-rune-2","o-rune-3"]),
 guide(`${prefix}-power`,"Recycle for the Chaos symbol","That Chaos rune is already exhausted, but the guide can still recycle it for 1 Chaos power. The 3 energy it made with those runes is still there, so it can pay both parts of the cost.",foundationEffect("bounce-power"),["o-rune-1"]),
 guide(`${prefix}-play`,"Return one unit from each side","The guide spends 3 energy and 1 Chaos power on Star-Crossed, choosing its own Mystic Poro and your unit. It needs one from each side, and both stay where they are while the spell’s on the chain.",foundationEffect("bounce-play"),["o-star-crossed","o-mystic-poro",unitId]),
 guide(`${prefix}-guide-pass`,"You may respond","The guide passes priority to you. If you wanted to play a Reaction before those two units go back to hand, this would be your chance.",{type:"pass",side:"opponent"},["chain"]),pass(`${prefix}-pass`,"Pass priority and let Star-Crossed resolve. Keep an eye on any Equipment, because the spell returns the unit to hand alive and the Equipment is a separate card."),
 guide(`${prefix}-resolve`,"Both units return to hand","Both players have passed, so each unit goes back to its owner’s hand and Star-Crossed goes in the trash. Anything the unit was wearing detaches and stays where the unit was.",foundationEffect("bounce-resolve"),[unitId,"o-mystic-poro","p-gear"])
];}
function createFoundationLessons():TutorialLesson[]{
 const scoring=addedLesson("scoring-once-per-turn","One battlefield, one score per turn",{
  see:"We’ve just finished Awaken, with Keeper ready on the left battlefield and two more units ready in base.",
  do:"We’ll score for holding the left, move off it and come back, then try the same thing on a battlefield we haven’t scored yet.",
  why:"If you’ve already scored this battlefield by holding it, can you get another point by taking it back? Keep an eye on whose turn it is and who’s scored where."
 },[
  inspect("battlefield-left","Start with this battlefield","Select the left battlefield. Keeper stayed here through the guide’s turn, and now we’re in Beginning with control of a battlefield we haven’t scored yet this turn."),
  foundationStep("limit-first-hold","Take the holding point","Take the point for holding the left battlefield, which puts you on 2. Remember where that point came from, because it still counts when we get to Main.",{type:"score"},"scoring-hold-left"),
  foundationQuestion("limit-same-turn","Does Main give another score?","You’ve held the left battlefield for a point, then you lose it and take it back in Main. It’s still your turn, so would you get a second point here?","No, I’ve already scored this one this turn.","You’ve already had your point here, and neither changing phase, sending a different unit nor losing and regaining control gives you another.","Yes, I’d get one for holding and another for conquering.","You can score by holding or by conquering, but once you’ve scored a particular battlefield you have to wait for a new turn to score that one again."),
  foundationStep("limit-beginning","Finish Beginning","Choose Check Beginning, as that’s the only battlefield you control. Watch the marker on the left, it stays there as you go into the next phase.",{type:"check-beginning"}),
  foundationStep("limit-channel","Channel your runes","Channel your two runes. You’ll be able to use them to pay for cards, but have a look at the left battlefield, its scoring marker hasn’t moved.",{type:"channel",ready:true}),
  foundationStep("limit-draw","Draw before Main","Draw your card and you’re into Main, where you can play cards and move units. It’s still the turn you scored that holding point.",{type:"draw"}),
  foundationStep("limit-leave","Leave to test the rule","Move Keeper back to base, exhausting it for the move. I’d usually want a reason to leave a battlefield empty, but here I want you to see what happens to that scoring marker when Keeper leaves.",{type:"move",cardId:"p-one",destination:"base"}),
  {...inspect("battlefield-left","What happened to the marker?","Select the empty battlefield on the left. You’ve lost control because Keeper left, but the marker still shows you’ve scored here this turn, whoever you might send in next."),id:"limit-inspect-empty"},
  foundationStep("limit-return","Send a different ready unit","Send Elder from base to the empty battlefield on the left, exhausting it to move. Let’s see whether coming back with a different unit does anything to the score.",{type:"move",cardId:"p-two",destination:"battlefield-left"}),
  pass("limit-pass","Pass focus so the guide can respond. Moving into an uncontrolled battlefield still starts a showdown, even when you’ve already had your point here."),
  guide("limit-guide-pass","The guide adds nothing","The guide passes as well, which finishes the showdown, and Elder has the battlefield to itself.",{type:"pass",side:"opponent"},["battlefield-left"]),
  foundationRule("limit-regain-control","Did Elder earn a point?","You’re back in control, but look at your score, it’s still 2. You’ve already scored here this turn, so regaining control doesn’t count as a conquer or trigger any conquer abilities.","scoring-claim-only"),
  foundationQuestion("limit-opponent","Could the guide still score here?","You’ve scored the left battlefield this turn. Say the guide takes control later in that same turn and hasn’t scored it yet, could the guide earn a point here?","Yes, the guide hasn’t scored it yet.","That marker is yours. If the guide takes the battlefield it checks its own marker, so the point you earned earlier doesn’t stop it scoring.","No, I’ve already taken the point for this turn.","Each player tracks their own score at each battlefield for the turn, so the guide can still score one you’ve already scored yourself."),
  foundationQuestion("limit-other-choice","Where would you send Pickpocket?","You’ve had your point on the left, but the right battlefield is empty and you haven’t scored it. Could Pickpocket still get you a point there this turn?","Yes, I haven’t scored the right one.","You can score each of the two battlefields once this turn, so you’ve still got a reason to move on the right.","No, I’ve already scored this turn.","Look at the right battlefield’s marker, you’ve scored on the left but you’ve still got a point to play for here."),
  foundationStep("limit-other-move","Use the other battlefield","Move your ready Pickpocket from base to the battlefield on the right, where there’s a point we can still earn this turn.",{type:"move",cardId:"p-three",destination:"battlefield-right"}),
  pass("limit-other-pass","Pass focus and see if the guide wants to respond. The right battlefield is empty, but you still finish the showdown before you can claim it."),
  guide("limit-other-guide-pass","The showdown finishes","The guide passes and Pickpocket is there on its own, so now we can score the right battlefield.",{type:"pass",side:"opponent"},["battlefield-right"]),
  foundationStep("limit-other-score","Conquer the right battlefield","Confirm the conquer on the right and you go from 2 to 3. You earned one point for holding on the left and one for conquering on the right, so both markers are yours now.",{type:"score"},"scoring-other"),
  foundationStep("limit-end-turn","A new turn resets both records","End your turn and watch both battlefields. Their scoring markers clear for both players as the guide’s turn begins, but your units stay exhausted and nobody scores just for starting a turn.",{type:"end-turn"}),
  guide("limit-guide-awaken","Whose cards ready now?","It’s the guide’s Awaken, so its runes ready. Your units stay exhausted, but they’re still on their battlefields and you still control both.",{type:"ready",side:"opponent"},["opponent:runes"]),
  guide("limit-guide-beginning","The guide has nothing to hold","The guide doesn’t control either battlefield in Beginning, so there’s nothing for it to hold. A clear marker just means it hasn’t scored there yet.",{type:"phase",phase:"Channel",priority:"opponent"},["battlefield-left","battlefield-right"]),
  guide("limit-guide-channel","The guide channels","The guide channels two ready runes, while your units stay where you left them.",{type:"channel",side:"opponent",count:2},["opponent:rune-deck"]),
  guide("limit-guide-draw","The guide draws","The guide draws a card and leaves both battlefields alone this time. In your own games, this is the turn your opponent might try to take one back.",{type:"draw",side:"opponent",count:1},["opponent:deck"]),
  guide("limit-guide-end","Your next turn begins","The guide ends its turn, so both players’ scoring markers clear again. You’ve kept both battlefields, but you still need to get through Awaken to Beginning to score for holding.",{type:"start-turn",side:"player"},["battlefield-left","battlefield-right"]),
  foundationStep("limit-next-awaken","Ready your own cards","Choose Awaken to ready your units and runes. Your units don’t have to go anywhere, so now we can check what you hold in Beginning.",{type:"ready"}),
  foundationStep("limit-next-hold-left","The left can score again now","Take the holding point on the left to go from 3 to 4. Elder stayed there the whole time, and because this is a new turn you can score it again.",{type:"score"},"scoring-hold-left"),
  foundationStep("limit-next-hold-right","Check the right separately","Now hold the right one as well and you’re on 5. That’s two points in the same Beginning, one for each battlefield you kept.",{type:"score"},"scoring-hold-right"),
  continueStep("limit-complete","When you’re unsure about a point, ask yourself, have I scored this battlefield this turn? It doesn’t matter which unit was there or whether you held or conquered it. Check the other battlefield separately, let your opponent track theirs, and clear both players’ markers when the turn changes.")
 ],"first-game");

 const group=addedLesson("group-movement","Move units together",{see:"You’ve got two ready units in base, and there’s a 4-Might Elder guarding the battlefield on the left.",do:"Work out how Pickpocket would get on alone, then try sending Keeper along with it.",why:"Sending the two together puts them in the same showdown, so they can both contribute their Might to the fight."},[
  foundationQuestion("group-predict","Would one unit be enough?","Pickpocket’s got 3 Might and Elder’s got 4, so what do you think happens if you send Pickpocket in on its own?","Pickpocket dies and Elder survives.","Elder can take those 3 damage and survive, because it has 4 Might.","Pickpocket kills Elder because it moves first.","Both units deal their combat damage together, even when one was the unit that moved in."),
  {...foundationStep("group-move","Send both units in one move","Select Pickpocket and Clockwork Keeper, then choose the left battlefield. They both need to be ready, because each exhausts for its own move, but choosing the same destination sends them in together as one action.",{type:"move-units",cardIds:["p-one","p-two"],destination:"battlefield-left"}),allowedCardIds:["p-one","p-two"],allowedDestinations:["battlefield-left"]},
  pass("group-pass","Pass focus so the guide gets its chance to act. Your units arrived together, so if the fight goes ahead they’ll both be in it."),guide("group-guide-pass","The guide accepts the fight","The guide passes focus too. Pickpocket brings 3 Might and Keeper brings 2, which gives you 5 between them against Elder’s 4.",{type:"pass",side:"opponent"}),
  ...foundationCombat("group",["p-one","p-two"],[{cardId:"o-one",amount:5,order:1}],[{cardId:"p-one",amount:3,order:1},{cardId:"p-two",amount:1,order:2}]),
  continueStep("group-result","Have a look at who’s left. The guide assigned 3 to kill Pickpocket and the last 1 to Keeper, while your units dealt enough together to kill Elder. That’s the reason I’d send them together, we’ve still got Keeper at the battlefield."),foundationCleanup("group-cleanup"),
  foundationStep("group-score","The surviving unit conquers","Keeper’s still here after cleanup and the defender’s gone, so confirm the conquer and take the point. Both attackers helped you earn that one point at this battlefield.",{type:"score"},"score"),continueStep("group-complete","If two units are heading to the same battlefield, have a look at what they can do together. Each one still needs a legal move and has to be able to pay for it, even when you send them in as a group.")
 ],"first-game");
 const damage=addedLesson("damage-and-might","Damage is not lost Might",{see:"You’ve got a ready Elder with 4 Might, and the guide’s Pickpocket has 3.",do:"We’ll fight with Elder and look at it before and after cleanup, so you can see exactly what those 3 damage do.",why:"If Elder takes a hit and survives, how much damage could it still deal? The two numbers on the card answer different questions."},[
  foundationStep("damage-move","Attack with the stronger unit","Move Elder to the left battlefield, where it has 4 printed Might against Pickpocket’s 3. Neither unit has an ability that triggers in this fight, so we can follow those two numbers.",{type:"move",cardId:"p-one",destination:"battlefield-left"}),pass("damage-pass"),guide("damage-guide-pass","Both sides let combat happen","The guide passes, so Elder deals 4 and takes 3 at the same time. Pickpocket still gets its damage in, even though it’s going to die.",{type:"pass",side:"opponent"}),...foundationCombat("damage",["p-one"],[{cardId:"o-one",amount:4,order:1}],[{cardId:"p-one",amount:3,order:1}]),
  inspect("p-one","Take a look at Elder","Select Elder and you’ll see 4 Might with 3 damage marked on it. One more damage would kill it, but right now those 3 damage are still below its Might, so it survives."),
  foundationQuestion("damage-test","How hard would Elder hit now?","Elder has 4 Might with 3 damage marked before cleanup, so how much damage would it contribute in combat?","4 damage.","It still has 4 Might. Marked damage tells you how close it is to dying, and you can see that number separately.","1 damage.","One more damage would kill Elder, but that doesn’t leave it with 1 Might. Check the Might number on the card again."),foundationCleanup("damage-cleanup"),
  continueStep("damage-healed","Have another look after cleanup, Elder’s 3 damage has gone and it still has 4 Might. Healing clears damage, and if Elder had taken lethal damage it would already have died before it got this far."),foundationStep("damage-score","Finish conquering","The fight’s finished and Elder’s still at the battlefield, so confirm the conquer and take the point.",{type:"score"},"score")
 ],"first-game");
 const buffs=addedLesson("buffs-and-bonuses","Three different ways to gain Might",{see:"You’ve got Pickpocket, three cards that can make it stronger, and the resources ready to play them.",do:"Try all three ways to increase Pickpocket’s Might, then see which one you can spend for a card at Monastery.",why:"Monastery asks you to spend a Buff, so when Pickpocket’s Might has gone up, how do you tell if you’ve actually got one?"},[
  foundationStep("buff-source","Play Spirit’s Refuge","You’ve already got 5 energy, 1 Calm power and 1 Mind power in your pool, and you can see the runes they came from. Pay 2 energy and 1 Calm power for Spirit’s Refuge. The gear goes straight into base, then its play ability can give a unit a Buff.",{type:"play",cardId:"p-refuge",destination:"base"},"play-gear"),
  foundationStep("buff-target","Choose who gets the counter","Choose Pickpocket for Refuge’s play ability. A Buff gives a unit a physical +1 Might counter, and normally it can only have one. For now you’re choosing who gets it, the counter comes when the ability resolves.",{type:"choose-trigger",cardId:"p-refuge",targetId:"p-one"}),foundationRule("buff-trigger","The Buff ability waits","Refuge’s ability is on the chain with Pickpocket as its target, so either player can respond before the Buff appears. Refuge also gives your buffed units Deflect, though the guide isn’t targeting one here.","buff-trigger"),...foundationResponses("buff","buff-resolve"),
  inspect("p-one","A real Buff counter","Pickpocket’s printed Might is 3, so that +1 Buff counter takes it to 4. You keep the counter past the end of the turn unless you spend it or something removes it, and giving this unit another Buff wouldn’t add a second one."),
  foundationStep("buff-discipline","What does Discipline add?","Play Discipline on Pickpocket for 2 energy. Read how it gives +2 Might for this turn, there’s nothing about a Buff on the card, so you keep the one counter you already had.",{type:"play",cardId:"p-discipline",targetId:"p-one"}),...foundationResponses("buff-discipline","resolve-response"),
  foundationStep("buff-gear","Play Equipment separately","Use your last 1 energy to play Experimental Hexplate into base. You’ve paid for the Equipment, but if you want Pickpocket to wear it you’ll need another payment, 1 Mind power for Equip.",{type:"play",cardId:"p-gear",destination:"base"},"play-gear"),
  foundationStep("buff-equip","Attach the Equipment","Activate Hexplate, choose Pickpocket and pay 1 Mind power for Equip. Once the ability resolves you’ll get +1 Might while Hexplate’s attached, but it won’t put a Buff counter on Pickpocket.",{type:"activate",cardId:"p-gear",targetId:"p-one"},"equip"),...foundationResponses("buff-equip","equip-resolve"),
  foundationQuestion("buff-test","How many Buff counters can we spend?","Pickpocket has gone from 3 Might to 7, with 1 from the Buff, 2 from Discipline and 1 from Hexplate. How many Buff counters does that give you to spend?","One real Buff counter.","You can spend the one +1 Buff counter. The spell and the Equipment are both giving you Might, but neither put a counter on Pickpocket.","Four, one for each extra Might.","Have a look at where each increase came from. Only Refuge actually gave Pickpocket a Buff counter, so that’s the only one you can spend."),
  foundationStep("buff-move","Bring the counter to Monastery","Move Pickpocket onto the empty battlefield on the left, taking its attached Hexplate with it. We’re heading for Monastery because conquering there gives us a reason to spend a Buff.",{type:"move",cardId:"p-one",destination:"battlefield-left"}),pass("buff-showdown-pass"),guide("buff-showdown-guide-pass","Does the guide contest Monastery?","The guide passes, leaving Pickpocket at Monastery on its own, so we can finish the showdown and conquer it.",{type:"pass",side:"opponent"}),foundationStep("buff-score","Take your point at Monastery","Confirm the conquer and take your point, then look at Monastery’s ability. You can spend a Buff to draw a card, and if you want the draw you pay that cost as you put the trigger on the chain, before anyone responds.",{type:"score"},"buff-conquer"),
  foundationStep("buff-spend","Spend the actual counter","Select Pickpocket to spend its Buff. You’ll see its Might drop from 7 to 6 right away, because you’ve paid with the counter and still have the +2 from Discipline and +1 from Hexplate. The ability to draw is on the chain now.",{type:"spend-buff",cardId:"p-one"},"buff-spend"),...foundationResponses("monastery","monastery-resolve"),
  continueStep("buff-after-spend","You’ve drawn your card, and you can still see 6 Might on Pickpocket, its printed 3 plus 2 from Discipline and 1 from Hexplate. The Buff you paid is gone, it doesn’t come back when the response window closes."),
  foundationStep("buff-end","What lasts past the end of the turn?","End your turn and watch Discipline’s +2 wear off. Hexplate’s still attached, and we already spent the Buff at Monastery, so there’s no counter left to remove.",{type:"end-turn"}),continueStep("buff-complete","We’re back to 4 Might, the 3 on Pickpocket and the 1 from the Hexplate it’s still wearing. If you want to know what stays or what you can spend, look at which card gave you the extra Might.")
 ],"practice");
 const equipment=addedLesson("equipment-lifecycle","Equipment after its unit leaves",{see:"One Rearguard is carrying Long Sword, another is in base, and the guide has a 4-Might defender.",do:"We’ll trade the Rearguard that’s wearing the sword and equip it to the other one, then try returning its bearer to hand.",why:"When you lose the unit that’s wearing your Equipment, where does the gear go, and could you use it again?"},[
  foundationStep("gear-move","A deliberate even trade","Move Rearguard and its Long Sword into the enemy Hopeful. They’ve got 4 Might each, so I’m taking the trade here to remove the defender, and I want you to keep an eye on the sword when its bearer dies.",{type:"move",cardId:"p-one",destination:"battlefield-left"}),pass("gear-pass"),guide("gear-guide-pass","The guide accepts the trade","The guide passes, and neither unit has an ability that triggers here, so they’ll both deal their 4 damage at the same time.",{type:"pass",side:"opponent"}),...foundationCombat("gear",["p-one"],[{cardId:"o-one",amount:4,order:1}],[{cardId:"p-one",amount:4,order:1}]),foundationCleanup("gear-cleanup"),
  inspect("p-gear","The sword survived","Look in your base for Long Sword. It detached where Rearguard died, then cleanup recalled the unattached sword from the battlefield to your base, keeping the same readiness it had before."),exhaust(1,"pay the sword’s Equip cost"),foundationStep("gear-power","Make the matching Equip power","Recycle that exhausted Fury rune for 1 Fury power. You keep the energy you already made, but it’s the Fury symbol you need to pay for Equip.",{type:"recycle",cardId:"p-rune-1"}),
  foundationStep("gear-reattach","Who gets the sword now?","Activate Long Sword and choose the Rearguard still in your base, paying 1 Fury power for Equip. You’ll see the sword attach when that ability resolves.",{type:"activate",cardId:"p-gear",targetId:"p-two"},"equip"),...foundationResponses("gear-reattach","equip-resolve"),continueStep("gear-reused","Your other Rearguard is up to 4 Might, and that’s the very same Long Sword. All you had to pay this time was Equip, because the sword was already in play."),
  foundationReset("gear-reset","What if Rearguard goes back to hand?","Let’s try a fresh position with the sword attached at your battlefield again. This time the guide’s going to use Star-Crossed to return its bearer to hand.","bounce"),...foundationBounce("gear-bounce","p-one"),foundationCleanup("gear-bounce-cleanup"),continueStep("gear-bounce-result","Rearguard went back to your hand, and after cleanup the sword is in your base, unattached. It came off because its bearer left the board. If a card had recalled Rearguard to base instead, it would still be on the board, so the sword would go with it and stay attached.")
 ],"practice");
 const champions=addedLesson("champion-destinations","Where champions go",{see:"Your chosen Viktor is exhausted at a battlefield, and you’ve drawn another copy.",do:"We’ll see where Viktor goes when he dies, try returning him to hand, then play two copies and pay for each.",why:"Choosing Viktor as your champion gives you access to that copy at setup, so what happens to it once you’ve played it like any other unit?"},[
  guide("champion-attack","An exhausted Viktor has to defend","You played your chosen Viktor earlier, and now the guide’s ready 4-Might Elder is moving into his battlefield. Viktor’s exhausted, so he can’t make a normal move, but he’s already where he needs to be to defend with his full 3 Might.",{type:"move",cardId:"o-one",destination:"battlefield-left"},["o-one","p-champion"]),guide("champion-guide-pass","The guide passes focus","The guide gives you a chance to respond. There’s nothing in this position you can play, but your exhausted Viktor can still fight.",{type:"pass",side:"opponent"}),pass("champion-pass","Pass focus. Viktor will deal his full 3 damage, but he’s going to take 4 from Elder, and being your chosen champion won’t save him from lethal damage."),...foundationCombat("champion",["p-champion"],[{cardId:"o-one",amount:3,order:1}],[{cardId:"p-champion",amount:4,order:1}]),foundationCleanup("champion-cleanup"),guide("champion-guide-score","Who gets the point?","Elder survives, so the guide conquers the battlefield and takes the point. Viktor goes to the trash like any other non-token unit that dies, leaving the champion zone empty.",{type:"score",side:"opponent",battlefieldId:"battlefield-left"}),inspect("p-champion","Where did your chosen Viktor go?","Look in your trash and you’ll find the Viktor you chose at setup. The champion zone gave you access to that one card at the start of the game, it doesn’t give you another when he dies."),
  foundationReset("champion-reset","What if Viktor goes back to hand?","Let’s put Viktor back at the battlefield for a fresh example. This time the guide’s going to use Star-Crossed, so have a look at where the spell says he goes.","bounce"),...foundationBounce("champion-bounce","p-champion"),foundationCleanup("champion-bounce-cleanup"),continueStep("champion-returned","Viktor’s back in your hand, so you can play that same copy again when you’ve got the resources and the timing is right. His champion zone is still empty."),
  foundationReset("champion-copies","Can we have two Viktors in play?","It’s your turn in this example, and you’ve got two copies of Viktor in hand with 8 energy and 2 Mind power ready. There are three Viktors in the teaching deck altogether, including the one you chose at setup.","copies"),foundationStep("champion-replay","Play the Viktor that came back","Play the returned Viktor from your hand into base, paying 4 energy and 1 Mind power. He enters exhausted, and because you played him from hand there’s still nothing in your champion zone.",{type:"play",cardId:"p-champion",destination:"base"}),foundationStep("champion-second-copy","Pay for the other copy too","Now pay another 4 energy and 1 Mind power for the second Viktor. He doesn’t have Unique and the deck is within its normal copy limit, so what would stop you having both in play?",{type:"play",cardId:"p-copy",destination:"base"}),continueStep("champion-two","You’ve paid for both Viktors, so you’ve got two exhausted copies in base and the champion zone is still empty. Being a champion doesn’t limit you to one in play, and when you do see Unique on a card, that’s a deckbuilding rule.")
 ],"practice");
 const ready=addedLesson("ready-runes-and-defenders","Save runes, and defend while exhausted",{see:"Keeper’s exhausted at your battlefield, you’ve got four ready runes and there’s a Discipline in your hand.",do:"Try making some energy and power before you need it, then see what you’ve actually got left when Keeper has to defend.",why:"If you want Discipline available on your opponent’s turn, what are you leaving open, the energy or the runes? And does Keeper need to be ready to defend?"},[
  exhaust(1,"see what happens to energy you leave unspent"),foundationStep("reserve-power","Make power as well","Recycle the exhausted Calm rune for 1 Calm power. You’ve already got 1 energy, so let’s leave both unspent and keep the other three runes ready, then see which of those you can still use next turn.",{type:"recycle",cardId:"p-rune-1"}),foundationStep("reserve-end","End with the pools unused","End your turn and watch the 1 energy and 1 Calm power disappear. Your three ready runes stay where they are, and Keeper stays exhausted until your own Awaken.",{type:"end-turn"}),continueStep("reserve-expired","You’ve still got three ready runes. Any unspent energy or power also clears for both players when Main begins, so I’d wait until I want to play my Reaction before I use the runes to pay for it."),
  guide("reserve-guide-awaken","Only the guide readies now","It’s the guide’s Awaken, so it’s the guide’s cards that ready. Your Keeper is still sideways and the three runes you saved are still ready to use.",{type:"ready",side:"opponent"}),guide("reserve-guide-begin","Check the guide’s Beginning","The guide hasn’t got a battlefield to hold or an effect to use in Beginning, so its score stays where it is.",{type:"phase",phase:"Channel",priority:"opponent"}),guide("reserve-guide-channel","The guide channels","The guide channels two runes, both ready to use this turn.",{type:"channel",side:"opponent",count:2}),guide("reserve-guide-draw","What carries over into Main?","The guide draws a card and Main begins, clearing any energy or power either of you had left over. Look at the ready runes, they’re still there.",{type:"draw",side:"opponent",count:1}),guide("reserve-attack","Can an exhausted Keeper defend?","The guide moves Pickpocket onto Keeper’s battlefield, so you’ve got a 3-Might attacker against a 2-Might defender. Keeper’s sideways, but it’s already there and can still deal its full damage.",{type:"move",cardId:"o-one",destination:"battlefield-left"}),guide("reserve-guide-focus","You can use your saved runes","The guide passes focus to you. This is why we left runes ready, we can use them now to pay for Discipline and give Keeper a chance to survive.",{type:"pass",side:"opponent"}),
  exhaust(2,"help the exhausted Keeper survive this fight"),exhaust(3,"make the second energy you need for Discipline"),foundationStep("reserve-discipline","Help the defender now","Pay 2 energy for Discipline and choose Keeper. Pickpocket has 3 Might and Keeper could go up to 4, but you’ll only see that +2 once the spell resolves.",{type:"play",cardId:"p-discipline",targetId:"p-one"}),...foundationResponses("reserve-discipline","resolve-response"),guide("reserve-return-focus","The guide passes focus again","You started this chain by playing Discipline in the showdown, so now it’s finished the guide gets focus. It passes that chance back to you.",{type:"pass",side:"opponent"}),pass("reserve-combat-pass","Pass focus as well and let them fight. Keeper’s still exhausted, but with Discipline it now brings the full 4 Might to combat."),...foundationCombat("reserve",["p-one"],[{cardId:"o-one",amount:4,order:1}],[{cardId:"p-one",amount:3,order:1}]),foundationCleanup("reserve-cleanup"),continueStep("reserve-defended","Keeper survived, its 3 damage has healed and you still control the battlefield. Defending successfully doesn’t give you a holding point straight away. Of the three runes you saved, the two you used for Discipline are exhausted and the third is still ready."),guide("reserve-guide-end","The guide ends its turn","The guide ends its turn, so Keeper loses Discipline’s +2 and any unspent energy or power clears. Now it’s your turn to Awaken.",{type:"start-turn",side:"player"}),foundationStep("reserve-awaken","Your own cards ready now","Choose Awaken and watch Keeper and the exhausted runes ready. The Calm rune you recycled is still in the rune deck. In a game you’d check for holding in Beginning next, but we’ll stop here so you can see which runes came back.",{type:"ready"}),continueStep("reserve-complete","Keeper and the runes you exhausted had to wait for your Awaken, and the rune you recycled is still in the rune deck. When I say I’m leaving runes open, I want them ready so I can make the resource when I actually need it.")
 ],"first-game");
 const passing=addedLesson("passing-decisions","Which kind of pass?",{see:"Keeper’s going into a fight against a stronger unit, and right now the chain is empty.",do:"We’ll start a chain with a Reaction, then work out which pass lets a spell resolve and which lets the fight go ahead.",why:"When you pass, what are you actually passing on? It depends whether you’ve got priority on the chain or focus in a showdown."},[
  foundationQuestion("reaction-start","Can we play a Reaction first?","You’d like to play Discipline in this open showdown, but the chain is empty. Can you go ahead and play it yourself?","Yes, I can start the chain with a Reaction.","You can play a Reaction in an open showdown, so you can start the chain yourself. You can also use one to answer something that’s already waiting.","No, I need a spell to respond to.","Reaction tells you when you’re allowed to play the card, and an open showdown is one of those times, even if nobody’s played anything yet."),exhaust(1,"help Keeper get through the fight"),exhaust(2,"make the last energy we need for Discipline"),foundationStep("passing-play","Play the first spell in the showdown","Play Discipline on Keeper. You’ve started the chain yourself, and if you look at Keeper now it’s still on 2 Might, because Discipline hasn’t resolved yet.",{type:"play",cardId:"p-discipline",targetId:"p-one"}),
  foundationQuestion("priority-question","What are you passing on here?","Your Discipline is on the chain, so if you pass priority now, what are you giving up?","My chance to add something else right now.","You’re giving the guide a chance to respond to Discipline. You’ve still got a showdown to finish, and your turn carries on after that.","The rest of my turn, including the fight.","You’re only passing on the chance to add a response here. To finish your whole turn you’d have to choose End Turn."),...foundationResponses("passing-spell","resolve-response"),guide("passing-return-focus","The guide passes focus","Discipline has resolved, so the chain’s empty and the guide gets focus in the showdown. It passes without playing anything, which puts the choice back with you.",{type:"pass",side:"opponent"}),foundationQuestion("focus-question","The chain is empty now","The guide’s passed focus, so what happens if you choose Pass Focus as well?","We’ve both finished making plays in this showdown.","You’ve both passed with the chain empty, so the units can get on with dealing their combat damage.","End my turn immediately.","The guide has passed focus in this showdown. You’re deciding whether there’s anything else to play before damage, and you can still carry on with your turn afterwards."),pass("passing-focus","Pass focus and let combat go to damage, with Keeper now on 4 Might and neither player adding anything else."),...foundationCombat("passing",["p-one"],[{cardId:"o-one",amount:4,order:1}],[{cardId:"p-one",amount:3,order:1}]),foundationCleanup("passing-cleanup"),foundationStep("passing-score","Take the point before you end your turn","Your unit survived, so confirm the conquer and take the point. You’re back in Main after this, so if you’ve still got a play you want to make, this is your chance.",{type:"score"},"score"),foundationQuestion("end-question","How do you give the guide the turn?","The chain’s empty, the fight’s over and you’ve done what you wanted this turn. Which control would you use to give the guide its turn?","End Turn.","End Turn finishes the usual end-of-turn checks and takes you to the guide’s Awaken.","Pass priority on the empty chain.","There’s no spell or ability waiting for a response now. If you’ve finished your plays, the control you want is End Turn."),foundationStep("passing-end","Now end the turn","Choose End Turn now the spell, the fight and the scoring are all finished. That ends the temporary effects for this turn and clears any energy or power you haven’t spent.",{type:"end-turn"}),continueStep("passing-complete","When Discipline was waiting, you passed priority to give the guide a response. When the chain was empty, you passed focus to let the fight happen, and only once you chose End Turn did the guide actually get its turn.")
 ],"practice");
 return [scoring,group,damage,ready,buffs,equipment,champions,passing];
}
