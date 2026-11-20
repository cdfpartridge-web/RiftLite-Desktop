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
const exhaust = (n: number, purpose = "play Watchful Sentry") => step(`energy-${n}`, "Make 1 energy", `We need energy to ${purpose}. Select this ready rune to use its energy ability. Exhausting it means turning it sideways. It adds 1 energy towards that number cost, while the rune stays on the table to ready on a later turn.`, { type: "exhaust", cardId: `p-rune-${n}` }, "Exhaust rune");
const CORE_PASS_COPY: Record<string, string> = {
  "empty-showdown": "Your Sentry has reached an empty battlefield. A showdown is the chance for both players to act before control is decided. Pass means you add nothing now. Pass focus to give the guide its chance; if it also passes, your Sentry can conquer the battlefield.",
  "ahri-trigger-pass": "Ahri’s attack ability is waiting on the chain: the list of effects waiting to happen. You have priority, meaning you may add a response now. Pass because we want that ability to happen without adding another card. The guide gets a chance before it resolves.",
  "pass-own": "Your Discipline is the newest spell on the chain, so it will happen first. Pass priority: you are choosing not to add another response. The guide still gets its chance; passing does not end your turn.",
  "pass-enemy": "Your spell has finished, but the guide’s Discipline is still waiting. The guide has passed on it. Pass too so that spell can now happen; an older spell is not cancelled just because you responded above it.",
  "counter-passes": "Defy is waiting to stop Rune Prison. Pass because you want your counterspell to happen. The guide can still respond before both players have passed; Defy has not removed anything yet.",
  "finish-combat-showdown": "Ahri is now 5 Might against the Sentry’s 3. We are ready for the fight. Pass focus, your chance to act in this showdown, so the guide can make its final choice before damage is dealt.",
  "pass-hidden": "Hidden Blade is waiting to kill the attacking Sentry. Pass to let the guide respond before the spell happens. The hidden card was free to play from its space, but it still uses the normal response process.",
  "last-showdown": "Your Sentry has arrived at the first battlefield. Pass focus so the guide has a chance to interfere before you conquer it. An empty battlefield still needs this showdown to finish.",
  "second-final-showdown": "Your second Sentry has reached the other battlefield. Pass focus to finish this battlefield’s showdown. Once the guide also passes, you can score it and check whether that earns the winning point."
};
const pass = (id = "pass", instruction = CORE_PASS_COPY[id] ?? "The effect is waiting for both players to finish responding. Pass means you add nothing now; it does not end your turn. This lets the next player respond, or lets the waiting effect happen after both have passed.") => step(id, "Pass: add nothing now", instruction, { type: "pass" }, "Pass");
const CORE_RESOLVE_COPY: Record<string, string> = {
  "resolve-own": "Both players have passed. Resolve means carry out the waiting instructions. Resolve your newer Discipline first: Ahri gains 2 Might for this turn and you draw one card. The guide’s older spell keeps waiting.",
  "counter-resolve": "Both players have passed on Defy. Resolve it now: carry out its instruction to counter Rune Prison. Countering sends that waiting spell to the trash without its stun happening. The resources paid for both spells stay spent.",
  "deal-damage": "The assignments are ready: 5 damage to the Sentry and 3 to Ahri. Resolve combat damage so both happen together. A unit deals its damage even when the same exchange will kill it.",
  "resolve-hidden": "Both players have passed. Resolve Hidden Blade to kill the chosen attacking Sentry and give its controller two cards. The spell then goes to the trash. The Sentry’s own draw ability is a separate effect we will handle next.",
  "keyword-resolution": "The numbers show where damage will go, not damage already dealt. Resolve now: your side deals 8 while the other side deals 4 at the same time. Sett takes their damage first, so Tank protects your Poro."
};
const resolve = (id = "resolve") => step(id, "Resolve: carry out the effect", CORE_RESOLVE_COPY[id] ?? "Both players have finished responding. Resolve now to carry out the newest waiting effect. This is the moment its instructions change the game; older effects keep waiting for their own chance.", { type: "resolve" }, "Resolve");
const score = (id = "score", instruction = "Confirm this battlefield's score. A player can score each battlefield only once per turn.") => step(id, "Record the score", instruction, { type: "score" }, "Score");
const continueStep = (id: string, instruction: string, title = "Take a moment") => step(id, title, instruction, { type: "continue" }, "Continue");
const mainNote = "You are playing Ahri against Orianna. We save the board between lessons and guide the opponent's plays. These are teaching decks, not complete competitive deck recommendations.";
function lesson(id: string, title: string, description: string, minutes: number, chapter: string, steps: TutorialStep[], scenarioNote = mainNote, champion = "Ahri"): TutorialLesson {
  return { id, title, description, minutes, chapter, champion, scenarioNote, intro: LESSON_INTROS[id], steps };
}

function guide(id: string, title: string, instruction: string, guideEffect: TutorialGuideEffect, focusIds: string[] = []): TutorialStep {
  return { ...step(id, title, instruction, { type: "guide", eventId: id }, "Watch the next move"), actor: "guide", guideEffect, focusIds };
}
function keywordIntroPlan(keyword:string):string {
  const plans:Record<string,string>={
    Accelerate:"We’ll make the resources, choose the extra play cost and see the unit enter ready immediately.", Action:"We’ll play a spell in an open showdown, pass priority and resolve it before combat damage.", Reaction:"We’ll respond above a waiting spell, resolve our response first, then return to the older spell.", Ganking:"We’ll move a ready unit directly between battlefields and see what that move costs.", Ambush:"We’ll make 2 energy and play Inferna as a Reaction while another spell waits. Watch it enter immediately at a battlefield where you have a unit.",
    Assault:"We’ll move a ready unit into a real attack and check how its Might changes.", Shield:"We’ll end our turn and watch the guide ready, channel, draw and attack. Then check the defender’s Might.", Tank:"We’ll show the required damage assignment first, then deal both sides’ damage together.", Backline:"We’ll assign lethal to the other defender before reaching Backline, then resolve the combat and its death trigger.", Deflect:"We’ll budget for a targeted spell’s normal cost plus the extra power, then resolve the spell.", Disarm:"We’ll attack, put the attack trigger on the chain and resolve the temporary Might reduction.",
    Hidden:"We’ll tap a rune, recycle it for power and hide a card while keeping the energy. On a later turn, we’ll play the hidden response at that same battlefield.", Deathknell:"We’ll watch lethal combat damage and the death as separate events, then resolve the resulting draw trigger.", Temporary:"We’ll start the next turn and resolve the required kill trigger before checking whether anyone remains to hold.", Vision:"We’ll play Mystic Poro, resolve its trigger and privately inspect the top card before choosing to recycle it.",
    Equip:"We’ll generate power, activate the Equipment’s ability and attach it only after the ability resolves.", "Quick-Draw":"We’ll play gear during a showdown. It enters immediately; a separate trigger will attach it without another payment.", Weaponmaster:"We’ll pay for the unit and let it enter exhausted. Its separate trigger will attach the sword using the Equip discount.", Unique:"We’ll inspect a proposed deck before a game and remove one extra Unique copy. This is a deck check, not an in-game action.",
    Legion:"We’ll pay for a first card this turn, then use that fact to play Noxus Hopeful at its discounted cost.", Hunt:"We’ll score a battlefield, then resolve the separate trigger that gives XP.", Level:"We’ll check the XP you already have, then play a unit whose Level text is active as it enters.", Empower:"We’ll calculate the discounted activation cost, pay it and resolve the ability before the unit becomes Empowered.", Empowered:"We’ll use a unit whose Empower status is already active, then attack to see the text that condition enables.",
    Repeat:"We’ll pay an optional extra cost while playing one spell, then execute its instructions twice when that single item resolves.", Flow:"We’ll play a spell from the trash at normal timing, resolve it and see why it ends up banished.", Deploy:"We’ll pay for gear and choose a battlefield as its play location, even though the opponent controls that battlefield.", "Show Off":"We’ll show a unit without playing it, record its Might, then pay for and resolve the spell using that number."
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
    steps[0].lessonIntro=k==="Action"?{see:"Your ready unit in base, an enemy defender and Cleave in hand.",do:"Move into a fight, then play an Action spell before combat damage.",why:"Action works in your open Main phase or a showdown; waiting can make its purpose clearer."}:{see:"An enemy Cleave waiting on the chain and Discipline in your hand.",do:"Respond with Discipline, draw Defy, then counter the older spell before it happens.",why:"Reaction lets you respond while effects wait. Each resolved effect opens another response chance."};
  }
  const payment = (energy: number, power: number, suffix = "cost", alreadyUsed: number[] = []) => {
    const pair = KEYWORD_LEGEND_PAIRS.find(p => p.legend.cardId === scenario.board!.playerLegendId)!;
    const domain = scenario.board!.powerDomain;
    const all = Array.from({ length: Math.max(scenario.board!.runeCount, energy + alreadyUsed.length, power * 2) }, (_, i) => i + 1).filter(n => !alreadyUsed.includes(n));
    const powerRunes = all.filter(n => pair.domains[(n - 1) % pair.domains.length] === domain).slice(0, power);
    const selected = [...new Set([...powerRunes, ...all])].slice(0, Math.max(energy, power));
    const purposes: Record<string,string> = { Accelerate:"play Rearguard ready so it can move this turn",Action:"add Cleave’s extra Might before combat",Reaction:"protect Guardian with Discipline before the older spell happens",Ambush:"bring Inferna into the fight as a response",Deflect:"pay for Hidden Blade, including Poro’s extra targeting cost",Hidden:"hide Blade for a later turn",Vision:"play Mystic Poro and check your next draw",Equip:"attach Long Sword to strengthen Rearguard", "Quick-Draw":"play Long Sword during this fight",Weaponmaster:"play Assailant and give it the waiting sword",Legion:suffix==="first"?"play Rearguard as your first card this turn":"play Hopeful at its cheaper Legion cost",Hunt:"earn experience from scoring",Level:"play Scorchclaw while its experience bonus is active",Empower:"use Sandspinner’s ability to strengthen this unit",Repeat:"pay for Blood Rush and its optional second use",Flow:"use Dredge Up again from the trash",Deploy:"place Banner where it can strengthen your next attacker","Show Off":"pay for Roar to remove the enemy Hopeful" };
    const purpose=purposes[k] ?? `use ${k} in this position`;
    for (const [index,n] of selected.entries()) steps.push(player(`${suffix}-energy-${n}`, "Make 1 energy", energy===0 ? `We want to ${purpose}, which needs power. First left-click this ready rune to tap it for 1 energy. Taking its energy before recycling keeps that energy available for another play.` : `We want to ${purpose}. Its number cost needs ${energy} energy. Left-click this ready rune to turn it sideways and make energy ${index+1} of ${energy}; the rune stays on the table.`, { type: "exhaust", cardId: `p-rune-${n}` }));
    for (const [index,n] of powerRunes.entries()) steps.push(player(`${suffix}-power-${n}`, `Make ${domain} power`, `To ${purpose}, we also need ${k==="Deflect"?"1 Order power plus 1 power of any domain":`${power} power${k==="Hidden"?" of any domain":` with the ${domain} symbol`}`}. Right-click this sideways rune to recycle it for power ${index+1} of ${power}. It returns to the bottom of its deck; the energy already made stays available.`, { type: "recycle", cardId: `p-rune-${n}` }));
  };
  const responses = (suffix: string, operation = "resolve", opponentFirst = false) => {
    const effects:Record<string,[string,string]>={Action:["Cleave","give your Rearguard Assault 3 this turn: 3 extra Might while attacking"],Reaction:["your Discipline","give Guardian 2 extra Might for this turn and draw a card"],Deflect:["Hidden Blade","kill the chosen Poro and give its controller two cards"],Disarm:["Chronomancer’s Disarm ability","reduce the enemy Hopeful from 4 Might to 2 for this turn"],Vision:["Mystic Poro’s Vision ability","let you privately inspect the top card of your deck"],Equip:["Long Sword’s Equip ability","attach the sword to Rearguard and raise it from 2 Might to 4"],"Quick-Draw":["Long Sword’s attachment ability","attach the sword to your Sentry, raising it from 1 Might to 3"],Weaponmaster:["Assailant’s attachment ability","use its discount to attach Long Sword without another payment"],Hunt:["Scorchclaw’s Hunt ability","gain 2 experience points"],Level:["Scorchclaw’s Hunt ability","add 2 experience points to the 3 you already have"],Empower:["Sandspinner’s Empower ability","make it Empowered so its extra abilities become available"],Repeat:["Blood Rush","give Rearguard Assault 2 twice, for 4 extra Might while attacking"],Flow:["Dredge Up","draw a card, then send the spell to Banishment instead of back to the trash"],"Show Off":["Primordial Roar","deal 4 damage to the chosen enemy Hopeful"],Hidden:["Hidden Blade","kill your chosen Sentry and give you two cards"],Temporary:["Sprite’s Temporary ability","kill the Sprite before it can earn a holding point"]};
    const [name,result]=operation==="vi-resolve"?["Vi’s activated ability","give Vi 1 extra Might for this turn without exhausting her"]:operation==="hidden-buff-resolve"?["the guide’s Discipline","give its Sentry 2 extra Might this turn and draw it a card before it moves"]:operation==="counter-resolve"?["Defy","counter the waiting Cleave so its instructions never happen"]:operation==="older"?["the guide’s Discipline","give its Sentry 2 extra Might for this turn and draw it a card"]:operation==="deathknell"?["the Sentry’s Deathknell ability",`draw one card for ${opponentFirst?"the guide":"you"}`]:effects[k];
    if(opponentFirst) steps.push(auto(`${suffix}-guide-first`, "The guide offers you a response", `${name} is the newest effect waiting on the chain. The guide controls it and passes priority: it adds nothing else. You now have a chance to respond before it can ${result}.`, "opponent-pass", ["chain"]));
    steps.push(player(`${suffix}-pass`, "Pass: let this effect go ahead", opponentFirst ? `The guide has already passed on ${name}. Pass too because we are letting it ${result}. Passing means you add nothing now; it does not end your turn. Both passes let this waiting effect happen.` : `${name} is on the chain, the list of effects waiting to happen. It will ${result}. Pass priority, your chance to add a response, because we want to let it proceed. The guide still gets a chance to answer.`, { type: "pass" }));
    if(!opponentFirst) steps.push(auto(`${suffix}-guide-pass`, "The guide lets your effect proceed", `The guide chooses not to answer ${name} and passes. Both players have now declined to add anything, so this newest effect can ${result}. Other effects on the chain, if any, keep waiting.`, "pass", ["chain"]));
    steps.push(opponentFirst ? auto(`${suffix}-resolve`, "The guide’s effect happens", `Both players passed. Resolving means carrying out the waiting instructions: ${name} will ${result}. Watch that change now. If an older effect remains, both players get another chance to respond before that one happens.`, operation, ["chain"]) : player(`${suffix}-resolve`, "Carry out the waiting effect", `Both players have passed on ${name}. Resolve it now to ${result}. Resolve means carry out its instructions. This finishes only this effect; any older effect still waiting gets a fresh chance for responses.`, { type: "resolve" }, operation));
  };
  if(k === "Ganking") {
    steps.push(player("awaken", "Ready the unit you kept", "Vi stayed on your left battlefield through the guide’s turn. Start your turn by readying her in Awaken. Upright means she can pay the exhaust cost of a normal move later; first we check whether holding this battlefield earns a point.", {type:"ready"}, "ready-player"));
    steps.push(player("hold-left", "Earn the holding point first", "Vi is still here and you retained control through the opponent’s turn. Score the battlefield during Beginning, going from 1 point to 2. Holding scores a battlefield you still control during Beginning; after recording this point, we can consider sending Vi somewhere else.", {type:"score"}, "gank-hold"));
    steps.push(auto("channel", "Prepare this turn’s runes", "Beginning is finished. Channel two runes from your rune deck so they are available for this turn. Vi’s own ability will not need energy or power, but other plays could use these runes.", "channel-player", ["player:rune-deck","player:runes"]));
    steps.push(auto("draw", "Draw before making Main-phase plays", "Draw one card into your hand, then enter Main. This is the part of your own turn where you can use ordinary abilities and move ready units when no showdown or effect is waiting.", "draw-player", ["player:deck","player:hand"]));
    steps.push(player("read-ability", "Read the cost under Ganking", "Click Vi to read her other ability: recycle one card from your trash to give her +1 Might this turn. It has no Action or Reaction permission, so use it in your own open Main phase. There is no exhaust cost or once-per-turn limit; every use still needs its own recycled card.", {type:"inspect",cardId:"player-OGN-036"}));
    for(const [number,costId] of [[1,"vi-cost-one"],[2,"vi-cost-two"]] as const){
      steps.push(player(`ability-${number}`, number===1?"Use Vi’s ability once":"Use it again, paying again", number===1?"Shift-click Vi to activate her ability. For this practice, recycle the first Cleave from your trash to the bottom of your main deck as its cost. The ability joins the chain to give +1 Might. Vi stays ready because this cost does not ask you to exhaust her.":"The first ability finished, so Main is open again. Shift-click Vi a second time, recycling the other Cleave from your trash as a new payment. Nothing on this ability limits it to once a turn. We are choosing a second use to make Vi stronger before she moves.", {type:"activate",cardId:"player-OGN-036",costCardId:costId}, `vi-activate:${costId}`));
      responses(`ability-${number}`, "vi-resolve");
    }
  }
  if(k === "Action") {
    steps.push(player("read-action", "Two times you could play Cleave", "Click Cleave to read Action. You may play it now in your own Main phase, when no effect is waiting, or later in an open showdown when you have focus. We will wait until Rearguard attacks, then strengthen it before damage. Action alone cannot answer a waiting spell.", {type:"inspect",cardId:"player-OGN-004"}));
    steps.push(player("action-attack", "Move first, then use your spell", "Move your ready Rearguard from base onto the enemy Hopeful’s battlefield. It turns sideways and starts a fight. Rearguard has only 2 Might against Hopeful’s 4, so it needs help. The open showdown will give you the chance to play Cleave before combat damage.", {type:"move",cardId:"player-OGN-010",destination:"battlefield-left"}, "action-attack"));
  }
  if (k === "Unique") {
    steps.push(player("inspect-copy", "Inspect the extra copy", "We are checking a deck before a game begins. Click the extra Forgefire Cape to read Unique: you may include only one copy of this card. It is an Ornn signature card, meaning it belongs with Ornn’s legend. Our legend matches; the extra copy is the problem.", { type: "inspect", cardId: "cape-second" }));
    steps.push(player("remove-copy", "Remove the duplicate", "Remove the extra Cape so the deck follows Unique’s one-copy limit. This fixes the proposed list before a game; it does not kill or discard a card during play. You will have 39 cards to shuffle plus the chosen champion: 40 main-deck cards in total.", native, "native"));
  } else if (k === "Hidden") {
    payment(0, 1, "hide");
    steps.push(player("hide", "Hide Hidden Blade", "Spend 1 power to place Blade facedown at the battlefield you control. We are preparing a response for a later turn, not playing the spell yet. Its effect does not happen now, and it cannot be played from Hidden this turn. Your energy stays available.", { type: "hide", cardId: "player-OGN-213", battlefieldId: "battlefield-left" }));
    steps.push(player("end-turn", "Wait until a later turn", "End your turn so your hidden card can become available on a later turn. The energy you did not spend empties at the end of the turn. We will keep the Sentry on this battlefield and see how the hidden card can help when the guide attacks.", { type: "end-turn" }));
    steps.push(auto("ready", "The guide readies", "The guide begins its turn with Awaken, turning its sideways cards upright. Ready cards can be used again. This prepares its runes for making resources and its unit for the coming attack.", "ready-opponent", ["opponent:runes", "opponent:base"]));
    steps.push(auto("channel", "The guide channels", "Channel brings two more ready runes from the guide’s rune deck onto the table. More runes give it resources for future plays; channelling brings those runes to the table ready to use.", "channel-opponent", ["opponent:rune-deck", "opponent:runes"]));
    steps.push(auto("draw", "The guide draws", "The guide takes a card from its main deck into its hand, then reaches Main. This is a later turn than the one when you hid Blade. The hidden card can now be played as a response when you get a chance to act.", "draw-opponent", ["opponent:deck"]));
    steps.push({...auto("buff-energy","The guide pays to strengthen its attack","Before moving, the guide taps two ready runes together for 2 energy. Discipline costs 2 energy and no power; strengthening the Sentry makes attacking your defended battlefield worthwhile.","intro",["o-rune-1","o-rune-2"]),guideEffect:{type:"exhaust-runes",cardIds:["o-rune-1","o-rune-2"]}});
    steps.push({...auto("buff-play","Strengthen the unit before moving","The guide spends 2 energy on Discipline, targeting its Sentry in base. The spell waits on the chain; the Sentry is still 1 Might until it resolves.","intro",["opponent-OGN-058","opponent-OGN-096"]),guideEffect:{type:"play",cardId:"opponent-OGN-058",destination:"chain",targetId:"opponent-OGN-096"}});
    responses("buff","hidden-buff-resolve",true);
    steps.push(auto("attack", "The stronger Sentry attacks", "Discipline made the guide’s Sentry 3 Might and drew it a card. It now moves from base to your battlefield, turning sideways. Your 1-Might Sentry cannot survive that attack without help; the guide is making a credible attempt to conquer.", "hidden-attack", ["opponent-OGN-096", "battlefield-left"]));
    steps.push(auto("focus", "Your response window", "The guide passes focus so you can respond. Hidden Blade may target either unit at its own battlefield. In this example, choose your friendly Sentry to draw extra cards from a unit you would otherwise lose; removing the attacker would also be a legal choice in a real game.", "player-priority", ["player-OGN-213", "battlefield-left"]));
    steps.push(player("play", "Play your hidden response", "Play the facedown Blade and click your own Sentry as its target: the unit it will affect. You do not pay Blade’s printed base cost for this Hidden play. Killing your doomed Sentry gives you two cards, and its own Deathknell will offer another afterwards.", native, "native")); responses("hidden");
    steps.push(auto("deathknell", "Your Sentry’s Deathknell", "Blade finished and your Sentry died. A trigger is an ability that starts when its named event happens. Deathknell starts when this Sentry dies. Its extra draw now joins the chain, so it must wait for responses before giving you another card.", "deathknell-trigger", ["player-OGN-096","chain"])); responses("deathknell", "deathknell");
    steps.push(auto("hidden-finish-guide-pass","The guide passes focus","The spell and the Sentry’s draw are finished. The guide gets the next chance to act in this showdown because your played spell handed focus back to it. It passes rather than adding another play, so you can finish deciding who conquers the battlefield.","pass",["battlefield-left"]));
    steps.push(player("hidden-finish-pass","Finish the contested battlefield","The guide has passed and your Sentry is gone. You gained three cards, but have no unit left to retain control of this battlefield. Pass focus to finish the showdown: this accepts losing the battlefield in exchange for those cards, rather than pretending the spell won the fight.",{type:"pass"}));
    steps.push(auto("hidden-finish","The guide conquers","Only the guide’s strengthened Sentry remains. It gains control and scores a point for conquering. Your hidden play did not save this battlefield; it turned a unit that was about to die into three cards you can use later. That was the choice this example explored.","hidden-conquer",["opponent-OGN-096","battlefield-left"]));
    const reset=player("other-reset","Reset: the attack goes elsewhere","The first example is finished. Reset to a separate position just before the move: Blade is still hidden on the left, your Sentry is still there, and the guide has already resolved Discipline. This time it will choose the other battlefield.",{type:"continue"},"hidden-other-reset");
    reset.presentation="lesson-intro";reset.label="Start the other-battlefield example";reset.lessonIntro={see:"A reset position: Hidden Blade left, a strengthened enemy Sentry in base.",do:"Watch the guide move to the right, then decide whether your hidden card can reach it.",why:"A hidden card belongs to its own battlefield, even when the action happens elsewhere."};steps.push(reset);
    steps.push({...auto("other-move","The guide chooses the other battlefield","The guide moves its 3-Might Sentry to the empty right battlefield. Your hidden Blade remains on the left: its response permission does not let it choose a unit across the table.","intro",["opponent-OGN-096","battlefield-right"]),guideEffect:{type:"move",cardId:"opponent-OGN-096",destination:"battlefield-right"}});
    steps.push(auto("other-guide-pass","You may respond, but check the location","The guide passes focus. Blade could still target your own Sentry on the left, but cannot target the enemy on the right. We will leave the hidden card prepared instead of sacrificing a safe unit for cards.","pass",["battlefield-right","player-OGN-213"]));
    steps.push(player("other-pass","Keep the hidden response prepared","Pass focus. Your hidden Blade cannot stop this move because its enemy target is at a different battlefield. Your friendly Sentry remains a legal local target, but this example saves the hidden card for a later threat.",{type:"pass"}));
    steps.push({...auto("other-score","The guide conquers the other battlefield","Both players passed. The guide’s Sentry is alone on the right, so it conquers and scores there. You still control the left, and its hidden Blade stays facedown and available for a later local response.","intro",["battlefield-right"]),guideEffect:{type:"score",side:"opponent",battlefieldId:"battlefield-right"}});
  } else if (k === "Shield") {
    steps.push(player("end-turn", "Let the guide take its turn", "Your Guardian is guarding this battlefield with 3 printed Might. End your turn and leave it there so we can see Shield work when the guide attacks. Shield gives its extra Might while defending, not while waiting without a fight.", { type: "end-turn" }));
    steps.push(auto("ready", "Awaken", "Awaken turns the guide’s sideways cards upright so they can be used again. Watch its unit and runes become ready before it makes this turn’s choices.", "ready-opponent", ["opponent:runes", "opponent:base"]));
    steps.push(auto("channel", "Channel", "The guide brings two ready runes from its rune deck onto the table. These increase the resources it can make this turn; they do not give energy until used.", "channel-opponent", ["opponent:rune-deck"]));
    steps.push(auto("draw", "Draw", "The guide takes the top card of its main deck into its hand for another option. It then reaches Main, the part of the turn where it can normally play cards and move units.", "draw-opponent", ["opponent:deck"]));
    steps.push(auto("attack", "A defender gains Shield", "The guide moves its 3-Might Guardian in to attack. Yours is already here, so yours becomes a defender. Shield adds 1 Might to your Guardian while defending: it will be 4 against 3. That extra strength can let it survive this otherwise equal fight.", "native", ["opponent-OGN-054", "player-OGN-054", "battlefield-left"]));
    steps.push(player("inspect", "Check Guardian’s Might", "Click your Guardian to check its 4 Might: printed 3 plus Shield’s 1 while defending. It will deal 4 damage and need 4 damage to die. This matters because the enemy only contributes 3. Neither side has dealt damage yet.", { type: "inspect", cardId: "player-OGN-054" }));
  } else if (k === "Tank" || k === "Backline") {
    steps.push({ ...auto("assign", "Watch the assignment", scenario.combatDemonstration!.explanation, "native", scenario.combatDemonstration!.sourceIds), combatDemonstration: scenario.combatDemonstration });
    steps.push(player("damage", "Deal damage together", "The counters show where the damage is planned to go. Resolve now to deal both sides’ damage together. This lets us see the real result of the assignment rule; a unit still deals its damage even if the same exchange kills it.", { type: "resolve" }, "combat"));
    if (k === "Backline") {
      steps.push(auto("deathknell", "The Sentry’s Deathknell", "The defeated Sentry has Deathknell: an ability that starts when it dies. Its draw joins the chain after the damage finishes. The guide does not draw yet, because you still get a chance to respond to this separate ability.", "deathknell-trigger", ["opponent-OGN-096", "chain"])); responses("deathknell", "deathknell", true);
    }
  } else if (k === "Deathknell") {
    steps.push(auto("lethal", "Lethal damage", "This fight is ready for damage. The enemy Rearguard will deal 2 to your 1-Might Sentry, while the Sentry deals 1 back. Damage equal to or greater than Might is lethal: enough to kill. Watch both amounts happen together before we handle the Sentry’s death.", "deathknell-damage", ["player-OGN-096"]));
    steps.push(auto("dies", "The Sentry dies", "The Sentry has enough damage to die, so it goes face up to the trash, where used and defeated cards are kept. Deathknell now starts its draw ability. That ability waits on the chain; the card being in the trash does not stop its death ability.", "deathknell-trigger", ["player-OGN-096", "chain"])); responses("deathknell", "deathknell");
  } else if (k === "Temporary") {
    steps.push(player("awaken", "Start Awaken", "You kept a Temporary Sprite on the battlefield through the guide’s turn. Start Awaken by readying your board. We must check its Temporary ability in the next phase before scoring; keeping a unit here does not guarantee it will last long enough to earn a holding point.", { type: "ready" }, "temporary-awaken"));
    steps.push(auto("trigger", "Beginning: Temporary", "Beginning starts, so Sprite’s Temporary ability starts automatically. It tells you to kill the Sprite and joins the chain before holding is checked. We must handle this required effect first; we cannot take the point and ignore the unit’s expiry.", "temporary-trigger", ["player-UNL-T07", "chain"])); responses("temporary");
    steps.push(player("empty-field", "Check who remains", "Click the battlefield to check what remains: your Sprite is gone. A token is a unit created by an effect, and it ceases to exist after leaving the board. With no friendly unit here, you no longer control this battlefield and cannot earn a holding point.", { type: "inspect", cardId: "battlefield-left" }));
  } else {
    if (k === "Legion") {
      payment(2, 0, "first");
      steps.push(player("first-card", "Play the first card", "Spend 2 energy to play Rearguard into your base. It enters sideways. Playing this first card matters: Hopeful’s Legion text rewards you for having already played another card this turn, so our next unit can cost less.", { type: "play", cardId: "player-OGN-010", destination: "base" }, "legion-first"));
      payment(2, 0, "second", [1, 2]);
    } else if (!["Ganking", "Assault", "Empowered", "Disarm", "Hunt"].includes(k)) payment(scenario.before.player.energy ?? 0, scenario.before.player.power ?? 0);
    const nativeAction = k === "Disarm" ? { type: "move", cardId: "player-RAD-050", destination: "battlefield-left" } as TutorialAction : native;
    const explanation: Record<string, string> = {
      Accelerate: "This Rearguard has Accelerate printed on it, so it offers an extra play cost. Choose that cost and pay 3 energy plus 1 Fury power in total. It enters upright and ready, letting us move it this turn. A unit without this permission cannot simply pay extra to ready itself.",
      Ambush: "Your Sentry is already fighting here. Play Inferna at that battlefield for 2 energy while the guide’s spell waits. Inferna’s Ambush permits this response because you have a unit there, even though the guide controls the battlefield. Inferna enters sideways immediately and adds another unit before the spell happens.",
      "Quick-Draw": "We want the sword’s extra Might in this fight. Quick-Draw lets you play it now, during the showdown. Pay 2 energy and 1 Fury power: Long Sword enters base immediately. Its separate attachment ability will then join the chain to give a unit the sword without another cost.",
      Weaponmaster: "Spend 6 energy and 1 Fury power to play Armed Assailant into base. We are choosing its normal sideways entry. Its Weaponmaster ability starts when it is played and can attach the waiting sword with a discount of 1 power. We will handle that ability separately, then use the stronger unit next turn.",
      Vision: "Spend 2 energy to play Mystic Poro into base. It enters sideways. We want its Vision ability because it lets us check the next card we would draw and decide whether to keep it on top. Playing the unit starts that separate ability; it has not looked at the deck yet.",
      Equip: "Long Sword is already in play, but is not helping a unit yet. Shift-click it and choose Rearguard to use Equip. Pay 1 Fury power. The ability waits on the chain before attaching the sword and adding 2 Might; the energy you made stays available.",
      Empower: "Use Sandspinner’s printed Empower ability to unlock its extra abilities. You have at most four runes, so its 5-energy cost is reduced by 3: pay 2. The ability joins the chain and can be answered. Sandspinner is not Empowered until that ability happens.",
      Repeat: "Your Rearguard needs more strength for this fight. Play Blood Rush and choose its optional Repeat cost, paying 2 energy total. Choose Rearguard for both uses. One spell joins the chain, but when it happens its instructions will run twice, giving two Assault bonuses.",
      Flow: "Dredge Up is in the trash because it was used earlier. Its Flow text lets you play it from there again. Spend 2 energy now in your Main phase, with no other effect waiting. It joins the chain to draw a card; Flow does not give permission to respond at any time.",
      Deflect: "Play Hidden Blade and choose the enemy Pouty Poro to remove it. Deflect makes choosing this enemy as a target cost extra. Pay Blade’s 2 energy and 1 Order power, plus 1 more power of any domain. We prepared both. The spell waits on the chain; the Poro has not died yet.",
      "Show Off": "Play Primordial Roar and choose the enemy 4-Might Hopeful. Show your own 4-Might Hopeful from hand to set the spell’s damage at 4, enough to kill that enemy. Your shown unit stays in hand. Pay Roar’s 4 energy and 2 Body power; the spell now waits to happen.",
      Deploy: "Play Banner of Conquest at the enemy-controlled battlefield for 1 energy and 1 Fury power. Its Deploy text lets it enter that battlefield and says it cannot enter base. The gear alone cannot conquer the battlefield; we are placing it there to strengthen the attacker we send next.",
      Level: "You already have 3 XP: experience points kept on your player counter. Spend 3 energy and 1 Fury power to play Scorchclaw. Its Level 3 text checks that XP and lets it enter ready with 4 Might. You keep the XP; it is a condition, not a cost.",
      Hunt: "Your unit is the only one remaining after the showdown. Record the point for conquering this battlefield. Scorchclaw’s Hunt ability starts when you score and will give experience points, or XP. We will handle that separate ability next; scoring the point does not immediately add the XP.",
      Disarm: "Move your ready Chronomancer from base to attack the enemy Hopeful. The move turns it sideways. Its Disarm ability starts when it attacks and can reduce that enemy’s Might before damage, helping turn this equal-strength fight in your favour.",
    };
    steps.push(player("native", scenario.actionLabel, explanation[k] ?? scenario.instruction, nativeAction, "native"));
    if (["Vision", "Quick-Draw", "Weaponmaster", "Hunt", "Disarm"].includes(k)) steps.push(auto("trigger", `${k}: its event has happened`, k === "Hunt" ? "You scored, so Hunt 2 starts automatically. An ability that starts when its named event happens is a trigger. This one joins the chain and will give you 2 XP after both players have had a chance to respond." : k === "Vision" ? "You played Mystic Poro, so its Vision ability starts. That automatic start is called a trigger. It joins the chain to let you Predict: privately look at the top card and choose whether to leave it or put it on the bottom." : k === "Disarm" ? "Chronomancer attacked, so Disarm 2 starts automatically and chooses Hopeful here. This is a trigger, an ability started by a named event. It joins the chain to reduce the enemy’s Might by 2; the number has not changed yet." : k === "Quick-Draw" ? "Long Sword has entered. Quick-Draw now starts a separate attachment ability and chooses your Sentry to receive it. This ability joins the chain, giving the guide a response chance before the sword attaches. The free attachment is required, not a second gear play." : "Assailant has entered. Its Weaponmaster ability starts and offers to attach Long Sword with a discount of 1 power. That reduces this sword’s Equip cost to zero. We choose the attachment to add 2 Might, but the guide may respond before the waiting ability happens.", "trigger", ["chain"]));
    if (["Action", "Reaction", "Deflect", "Disarm", "Vision", "Equip", "Quick-Draw", "Weaponmaster", "Hunt", "Empower", "Repeat", "Flow", "Show Off"].includes(k)) responses("effect");
    if (k === "Vision") {
      steps.push(player("inspect-top", "Inspect the top card", "Click to privately inspect the Sentry on top of your main deck. Vision gave you this look so you can decide whether you want it as your next draw. Looking does not put it in your hand, change the deck order, or show it to the guide.", { type: "inspect", cardId: "player-OGN-096" }));
      steps.push(player("predict", "Choose to recycle", "You already have a small unit, so this practice looks for a larger future attacker. Choose Recycle to bottom for the inspected Sentry. Predict also allows leaving it on top; our choice moves past this card without drawing it or revealing it to the guide.", { type: "predict", cardId: "player-OGN-096", choice: "recycle" }, "predict"));
    }
    if (k === "Reaction") {
      steps.push(player("read-drawn-defy", "Your draw gives you another choice", "Discipline finished and drew this Defy into your hand. Click it to read Counter: it can stop a waiting spell within its cost limit. Cleave is still waiting, so you still have a chance to respond. In a real game you could pass; this practice will use Defy.", {type:"inspect",cardId:"player-OGN-045"}));
      steps.push(auto("counter-window", "The guide offers another response window", "Cleave is now the newest waiting spell again. Its controller, the guide, gets priority first and passes. You may add another Reaction before Cleave happens; resolving Discipline did not force the older spell to happen immediately.", "opponent-pass", ["chain","player-OGN-045"]));
      steps.push(player("counter-energy", "Prepare Defy’s energy", "Defy needs 1 energy and 1 Calm power. Tap this ready Calm rune for the energy first. We are preparing a second response to the same waiting Cleave, using the new card that Discipline drew.", {type:"exhaust",cardId:"p-rune-3"}));
      steps.push(player("counter-power", "Prepare Defy’s matching power", "Right-click that same sideways Calm rune for 1 Calm power. It goes to the bottom of the rune deck, while the energy it just made stays available. We can now pay both of Defy’s costs without undoing Discipline’s earlier payment.", {type:"recycle",cardId:"p-rune-3"}));
      steps.push(player("counter-play", "Respond to the original spell", "Play Defy and choose Cleave on the chain. Cleave’s printed cost fits Defy’s limit of at most 4 energy and 1 power. Defy pays 1 energy and 1 Calm power, then waits above Cleave. It can still be responded to; the enemy spell has not been stopped yet.", {type:"play",cardId:"player-OGN-045",targetId:"opponent-OGN-004"}, "counter-play"));
      responses("counter", "counter-resolve");
    }
    if (k === "Ambush") responses("older", "older", true);
    if (["Ganking", "Assault", "Empowered"].includes(k)) steps.push(player("inspect-result", "Read the new position", k === "Ganking" ? "Click Vi to check the move you made. She is sideways because the move used her readiness. Ganking let her go directly from one battlefield to another, reaching a new place to score; it did not make the move free or allow it at any time." : "Click your attacking unit to compare its printed Might with the higher current number. Assault adds Might while it attacks, so it can change both damage dealt and survival in this fight. The bonus is active now, but no combat damage has happened yet.", { type: "inspect", cardId: (native as {cardId:string}).cardId }));
  }
  const follow=scenario.followThrough;
  if(follow?.waitForNextTurn){
    steps.push(player("develop-end","End your development turn","Assailant entered sideways, so it cannot make a normal move yet. End the turn and leave the sword attached. We will wait until your next Awaken phase readies the unit, then use its extra Might in a real attack.",{type:"end-turn"}));
    steps.push(auto("develop-guide-ready","The guide readies","Awaken turns the guide’s sideways cards upright so they can be used again. Watch its unit and runes become ready before it makes this turn’s choices.","ready-opponent",["opponent:runes"]));
    steps.push(auto("develop-guide-channel","The guide channels","During Channel, the guide brings two more runes onto the table ready. It is preparing resources for its turn even though this practice keeps its plays simple so we can follow your equipped unit.","channel-opponent",["opponent:rune-deck"]));
    steps.push(auto("develop-guide-draw","The guide draws","The guide draws one card into its hand for its normal turn draw. In this example it chooses not to attack, leaving your equipped Assailant available for the next turn we are preparing.","draw-opponent",["opponent:deck"]));
    steps.push(auto("develop-guide-end","The guide ends its turn","The guide ends its turn without disturbing your unit. Your turn begins, but Assailant is still sideways until Awaken readies it. Equipment stays attached between turns; you will not need to pay Equip again just to keep the sword.","next-player-turn",["player:base"]));
    steps.push(player("develop-awaken","Ready your equipped unit","Click Ready all to turn Assailant upright during Awaken. It can now pay the readiness cost of a normal move. Long Sword is still attached, so its extra 2 Might will help when we send the unit into the fight.",{type:"ready"},"ready-player"));
    steps.push(auto("develop-beginning","Beginning","Beginning checks whether you retained control of a battlefield. Your equipped unit is in base, so it earns no holding point here. We move on to getting resources before the attack.","begin-player",["battlefield-left"]));
    steps.push(auto("develop-channel","Channel","Bring two ready runes from your rune deck onto the table for this Channel phase. This gives you more resources for possible plays while your equipped unit prepares to attack.","channel-player",["player:rune-deck"]));
    steps.push(player("develop-draw","Draw for your turn","Press D or click the Main Deck to draw one card for another option. You then reach Main, the normal time to move a ready unit. We can now use Assailant and its attached sword to challenge the enemy.",{type:"draw"},"draw-player"));
  }
  if(follow?.move){
    const movement:Record<string,string>={Accelerate:"Rearguard entered ready because you paid the extra energy and Fury power for Accelerate. Move it from base to the empty battlefield now. Normally a new unit would still be sideways; this extra cost lets you threaten a point on the same turn you played it.",Equip:"Your ready Rearguard now has 4 Might with its sword, while the enemy Rearguard has 2. Move yours from base to that battlefield. The move turns it sideways, but the attached sword goes with it and helps it win a fight it would otherwise only tie.",Weaponmaster:"Assailant is ready after Awaken and still has its sword. Move it to attack the enemy Assailant. Your equipped unit has 8 Might against their 6, so we can now see the benefit of preparing the attachment on the previous turn.",Empower:"Sandspinner’s Empower ability has finished. Move the ready unit from base to attack. Its new Assault 2 becomes active while attacking, raising its 6 Might to 8 against the enemy’s 6. We will finish the fight to see why that mattered.",Level:"Scorchclaw entered ready because you already met its Level 3 condition. Move it from base to the empty battlefield. This uses its readiness but lets it threaten a point immediately, rather than waiting until another turn.",Deploy:"The Banner is already at this enemy-controlled battlefield. Move your ready Hopeful there to attack. The Banner’s Assault bonus will give it 5 Might against the enemy Hopeful’s 4, so placing that gear here can change who wins the fight."};
    steps.push(player("use-move","Use the new opportunity",movement[k],{type:"move",...follow.move},"follow-move"));
  }
  if(follow?.combat){
    const guideHasFocus=["Action","Quick-Draw","Repeat"].includes(k);
    if(guideHasFocus)steps.push(auto("finish-guide-pass","The guide gets the next chance","Your card’s effects are finished. Playing it passed focus to the guide: it gets the next chance to act in this showdown. It chooses to pass, leaving the changed Might in place for the coming fight.","pass",["chain"]));
    steps.push(player("finish-pass","Let the fight reach damage",guideHasFocus?`The guide has passed. Your ${k} play has made its change, and no effect is waiting. Pass focus too, meaning you add no further play in this showdown, so we can deal damage and see the result.`:`Your ${k} example has reached the fight we prepared. Pass focus: choose not to add another play now. The guide gets one last chance to act before the showdown ends and the units deal combat damage.`,{type:"pass"}));
    if(!guideHasFocus)steps.push(auto("finish-guide-pass","The guide lets the fight continue",`The guide passes rather than changing this ${k} example again. Both sides have finished acting in the showdown. We can now use the Might actually shown on the units to decide their combat damage.`,"pass",["chain"]));
    const unitName=(id:string)=>[...scenario.before.cards,...scenario.after.cards].find(c=>c.instanceId===id)?.name??"the chosen unit";
    const damagePlan=[...follow.combat.targetAssignments.map(a=>`${a.amount} to the guide’s ${unitName(a.cardId)}`),...(follow.combat.returnAssignments??[]).map(a=>`${a.amount} back to your ${unitName(a.cardId)}`)].join("; ");
    steps.push({...auto("finish-assign","Plan the damage before dealing it",`${damagePlan}. These are assignments: planned amounts, not damage already dealt. We will mark them on the units so you can check how ${k} changed this fight. Both sides will deal their damage together.`,"follow-assign",follow.combat.sourceIds),combatDemonstration:follow.combat});
    steps.push(player("finish-damage","Deal both sides’ damage",`Resolve combat damage now: ${damagePlan}. Both sides deal it at the same time. A unit still deals its damage even if this exchange will kill it; the keyword’s benefit must survive the enemy’s return damage too.`,{type:"resolve"},"follow-damage"));
    steps.push(auto("finish-cleanup","Check who survives the exchange","Damage equal to or greater than a unit’s current Might is lethal, meaning enough to kill it. Those units go to the trash first; damage on survivors then clears. Attacker and defender Might bonuses stay until the battlefield’s result is settled, so we check survival before removing them.","follow-cleanup",[...follow.combat.targetAssignments,...follow.combat.returnAssignments??[]].map(a=>a.cardId)));
    for(const [index,dead] of (follow.deathknells??[]).entries()){
      steps.push(auto(`finish-deathknell-${index}`,"The defeated Sentry still has an ability","The Sentry died, starting its Deathknell ability. That automatic start is called a trigger. The draw is separate from combat damage and joins the chain, so the player who controlled the Sentry must wait for responses before drawing.",`trigger-death:${dead}`,[dead,"chain"]));
      responses(`finish-deathknell-${index}`,"deathknell",dead.startsWith("opponent"));
    }
  }
  if(follow?.conquer){
    if(!follow.combat&&k!=="Backline"){
      steps.push(player("conquer-pass","Give the guide a chance before scoring",`Your ${k} play let a unit reach this empty battlefield. Arriving starts a showdown, a chance for both players to act before control is decided. Pass focus to offer the guide that chance. You cannot claim the point just by arriving.`,{type:"pass"}));
      steps.push(auto("conquer-guide-pass","The guide leaves your unit alone","The guide adds no card or ability to stop your move and passes. Both sides have now finished the showdown. Your unit is still alone here, so you can conquer the battlefield and score it.","pass",[follow.conquer]));
    }
    steps.push(player("finish-score","Turn the surviving unit into a point",follow.combat||k==="Backline"?`Your unit survived and no enemy remains here. Record 1 point for conquering: taking control after the fight. This is the practical result of ${k} in this position. Attacker and defender bonuses stay through conquering and any resulting chain; they end only when combat finishes.`:"Your unit is alone here after both players passed. Record 1 point for conquering this battlefield. The keyword helped it arrive in time; the unit and the finished showdown are what let you claim the point.",{type:"score"},`score:${follow.conquer}`));
    if(k==="Level"){
      steps.push(auto("finish-hunt","Scoring starts another reward","Scorchclaw also has Hunt 2, which starts when you score. It creates a separate ability on the chain to add 2 XP, or experience points. You did not spend your earlier 3 XP on Level, so the reward can add to that total.","level-hunt",["player-UNL-016","chain"]));responses("finish-hunt","gain-hunt");
    }
  }
  if(k==="Vision"){
    steps.push(player("vision-end","Keep the better next draw","End the turn to reach a later draw. Predict did not give you a card immediately; it changed which card is next. We will follow the turn order so you can see how that earlier choice improves your hand.",{type:"end-turn"}));
    steps.push(auto("vision-ready","The guide readies","Awaken turns the guide’s sideways cards upright so they can be used again. Watch its unit and runes become ready before it makes this turn’s choices.","ready-opponent",["opponent:runes"]));
    steps.push(auto("vision-channel","The guide channels","The guide brings two ready runes from its rune deck onto the table. It follows the normal turn order while we wait to see the result of changing your next draw.","channel-opponent",["opponent:rune-deck"]));
    steps.push(auto("vision-draw","The guide draws","The guide takes its normal card from the main deck into its hand. It chooses no further plays in this example, so your planned next draw stays undisturbed.","draw-opponent",["opponent:deck"]));
    steps.push(auto("vision-next","Your next turn","The guide ends its turn and yours begins. The Sentry you inspected is at the bottom of your deck, so a different card is waiting on top. We still finish the normal turn-start phases before drawing it.","next-player-turn",["player:deck"]));
    steps.push(auto("vision-awaken","Awaken","Awaken turns your sideways cards upright so you can use them this turn. Readying the Poro does not trigger Vision again; that ability happened when you played it.","ready-player",["player:base"]));
    steps.push(auto("vision-begin","Beginning","Beginning checks holding and abilities that start now. You control no battlefield and have no such effect to handle in this position, so we move on without gaining a point.","begin-player",["battlefield-left"]));
    steps.push(auto("vision-player-channel","Channel","Channel brings two more ready runes onto your table. Those runes will help pay for cards you draw; they are separate from the main-deck card you are about to take.","channel-player",["player:rune-deck"]));
    steps.push(player("vision-next-draw","Draw the card you reached","Press D or click the Main Deck to draw Mysterious Chronomancer, which was below the Sentry you recycled. Your earlier choice reached a larger attacker for a future fight. Drawing adds it to your hand; you would still pay its cost to play it.",{type:"draw"},"vision-draw"));
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
    "These are separate practice positions on the same Atlas table. Each uses a matching legend, champion and real cards. Changing examples resets the position; it does not continue the Ahri match.", "Practice");
}

const LESSON_INTROS: Record<string, TutorialLessonIntro> = {
  "table-setup": { see: "An empty table and the pieces you need to build your first board.", do: "Learn each piece’s job, then place your legend, champion, battlefield and two decks.", why: "Knowing where each piece belongs prepares you to play cards and score by conquering and holding." },
  "opening-hand": { see: "Four opening cards, including a second Ahri you cannot afford on your first turn.", do: "Learn what a mulligan means, then replace that extra Ahri and check the new hand.", why: "An affordable early unit gives you something useful to do while expensive cards must wait." },
  "first-or-second": { see: "Your chosen opening hand and a board with no runes in play yet.", do: "Follow Awaken, Beginning, Channel and Draw, then reach the part of the turn where you play cards.", why: "Following this order gives you the cards and resources you need before making your first play." },
  "read-a-card": { see: "A Sentry unit, a rune and the Discipline spell in your position.", do: "Click each card to find its cost, Might and job before trying to use it.", why: "Reading what a card needs and does helps you choose a play you can actually make." },
  "play-first-unit": { see: "Two ready runes and a Sentry costing two energy in your hand.", do: "Make energy, play the Sentry in base, then watch the guide make its own first play.", why: "A unit on the table prepares you to fight for points on a later turn." },
  "power-and-champion": { see: "Your next turn, with Ahri waiting in the champion space.", do: "Prepare three energy and one matching Mind power, then pay both costs to play Ahri.", why: "Energy pays number costs; matching power pays symbols. One rune can help with both before leaving the table." },
  "move-to-battlefield": { see: "Your ready Sentry in base and an empty battlefield.", do: "Move the Sentry onto the battlefield and learn why both players get a chance to respond.", why: "Units in base cannot score a battlefield. Moving puts one where it can try to earn a point." },
  "first-conquest": { see: "Your Sentry at the empty battlefield, waiting for the showdown to finish.", do: "Pass the chance to act, let the guide answer, then record your first point for conquering.", why: "Conquering gives you control and a point after the showdown finishes, not simply by arriving." },
  "holding": { see: "A battlefield you control with a Sentry already on it.", do: "Retain control through the guide’s turn, score for holding, then play a second unit directly there.", why: "Protecting a battlefield can earn another point and make it harder for the opponent to conquer it." },
  "start-combat": { see: "Your ready Ahri in base and an enemy Sentry guarding the right battlefield.", do: "Move Ahri in to attack, handle her ability, and compare the units before damage.", why: "A defended battlefield needs a fight. Abilities can change that fight before either unit deals combat damage." },
  "the-chain": { see: "Ahri fighting a Sentry, with the guide preparing a spell to strengthen its defender.", do: "Add your own response, then carry out the waiting effects in newest-first order.", why: "The chain gives both players chances to respond before a spell’s instructions happen." },
  "countering-spells": { see: "A separate position where Rune Prison is waiting to stop your Sentry dealing combat damage.", do: "Make Defy’s resources and use it to stop the waiting spell before it happens.", why: "A counterspell can protect a unit from an effect, but cannot undo one that already happened." },
  "combat-damage": { see: "The main Ahri fight again: your unit has five Might and the defender has three.", do: "Finish responses, plan damage, deal both sides’ damage together, and score with the survivor.", why: "Comparing current Might explains who dies, who survives and who can conquer the battlefield." },
  "hidden-cards": { see: "A separate Sett position with Hidden Blade and a battlefield you control.", do: "Answer a strengthened attacker, reset to an attack elsewhere, then test losing control.", why: "Hidden rewards preparation, but your card depends on where it is and whether you retain control." },
  "keywords-in-combat": { see: "A prepared Sett fight with a small Poro beside him and two enemy defenders.", do: "Read Assault and Tank, watch the damage assignment, then finish the fight.", why: "Short keyword text can change both a unit’s damage and which of your units survives." },
  "keyword-timing": { see: "Two separate fights with spells that can be played at different times.", do: "Try Action and Reaction first, paying their costs and resolving responses in order.", why: "Knowing when a card is allowed helps you respond before a fight is decided." },
  "keyword-combat": { see: "Five positions covering ready entry, surprise units, attacking strength, damage order and a defeated unit’s ability.", do: "Try Accelerate, Ambush, Assault, Backline and Deathknell, following each one to its result.", why: "These abilities change when units arrive, how fights end and what happens when a unit dies." },
  "keyword-surprises": { see: "Five positions where extra targeting costs, battlefield gear or a paid ability change your choices.", do: "Try Deflect, Deploy, Disarm, Empower and Empowered with the conditions shown on the board.", why: "Check costs and conditions before relying on an ability to protect or strengthen a unit." },
  "keyword-equipment": { see: "Five positions involving gear, the trash, movement between battlefields, hidden preparation and experience points.", do: "Try Equip, Flow, Ganking, Hidden and Hunt using each card’s permitted actions.", why: "A card’s special permission can create a useful play while its other rules still apply." },
  "keyword-growth": { see: "Five positions involving earlier plays, experience, attachment, repeated spell effects and defending strength.", do: "Try Legion, Level, Quick-Draw, Repeat and Shield, then see what changes in play.", why: "The order of your plays and the conditions you meet can change a card’s cost or result." },
  "keyword-new-tools": { see: "Six positions covering revealed cards, protected allies, expiring units, deck limits, future draws and equipment.", do: "Try Show Off, Tank, Temporary, Unique, Vision and Weaponmaster in separate examples.", why: "Read the exact ability to understand what you gain, what it costs and what still cannot happen." },
  "win-the-game": { see: "Ahri at seven points with two open battlefields, followed by a separate holding position.", do: "First score both battlefields in one turn; then try winning by holding one battlefield during Beginning.", why: "The final point from conquering has an extra condition. Holding offers a different route to point eight." }
};

export const LESSONS: TutorialLesson[] = [
  lesson("table-setup", "1. Build your board", "Find each space, then put your cards where they belong.", 6, "Set up", [
    { ...continueStep("what-we-are-playing", "Your aim is to reach eight points by conquering and holding battlefields. We’ll learn how together. First, let’s find the spaces on your side of the table and put each piece in its place."), title: "Let’s start with an empty table", label: "Find my side of the table" },
    inspect("player:base", "This is your base", "Your base is your side of the table. Units are cards that can fight; you can play them here before sending them to a battlefield. Select your base to find it."),
    inspect("player:hand", "This is your hand", "Your hand holds cards you can choose to play. Only you see their faces. It is empty for now. Select the hand area; we’ll put your first cards here soon."),
    inspect("player:trash", "This is your trash", "Used spells and units that die usually go here, face up. Both players can read them. It is a card pile, not a delete button. Select the trash space."),
    step("place-legend", "Your legend leads the deck", "This Ahri is your legend. She stays beside the game and gives you an ability. Domains are card groups: her Calm and Mind symbols tell you which groups your deck uses. Drag her to the legend space; the guide places its legend too.", { type: "setup", item: "legend", cardId: "p-legend", destination: "legend" }, "Place your legend"),
    step("place-champion", "Your champion can join the fight", "This other Ahri is a unit: your chosen champion. Set her aside so you can play her later without needing to draw her. Drag her to the champion space; the guide sets its champion aside too. Both still cost resources to play.", { type: "setup", item: "champion", cardId: "p-champion", destination: "champion" }, "Place your chosen champion"),
    step("choose-battlefield", "Battlefields are where you score", "A battlefield is a place your units fight over to earn points. Each player brings three choices for a best-of-three match. Drag Monastery of Hirana to the left battlefield space for this game.", { type: "setup", item: "battlefields", cardId: "OGN-282", destination: "battlefield-left" }, "Place Monastery of Hirana"),
    inspect("battlefield-right", "Both battlefields are shared", "Both players reveal their choice together. The guide chose Rockfall Path. You can fight for either battlefield, even the one your opponent brought. Select Rockfall to see its special rule; we’ll practise that later."),
    step("place-main-deck", "Your main deck holds your cards", "Units fight, spells do a one-off job, and gear stays to help. These cards go in your main deck. Your chosen Ahri came from its 40 cards, leaving 39 to shuffle. Drag that pile to the Main Deck space.", { type: "setup", item: "main-deck", destination: "deck" }, "Place your main deck"),
    step("place-rune-deck", "Runes help pay for cards", "Runes make the resources you spend to play cards. Their 12-card deck is separate, so you can get runes without using your normal card draw. Shuffle it and drag it to the Rune Deck space.", { type: "setup", item: "rune-deck", destination: "rune-deck" }, "Place your rune deck"),
    step("choose-first", "Choose who takes the first turn", "For game one, an agreed random method chooses who decides. You won that choice in this example. Choose to go first, so you get the first chance to play a unit.", { type: "setup", item: "turn-order", choice: "first" }, "Choose to go first", "While you are learning, we recommend choosing first so you can practise making the opening play. Either choice is allowed; later you can try both with your deck."),
    step("draw-opening", "Draw four cards", "Drawing means taking the top card of your main deck into your hand. Both players draw four now. These are your first choices, called your opening hand. The guide sees how many cards you hold, but not their faces.", { type: "setup", item: "opening-hand" }, "Draw four cards"),
    continueStep("table-ready", "Your table is ready. Your legend stays in its space, your chosen champion waits to be played, and your hand gives you more choices. Next we’ll check whether those choices help you get started.")
  ], "A game ends when someone wins; a match can contain several games. We’re setting up game one of best-of-three (BO3): the first player to win two games wins the match. Best-of-one (BO1) is a one-game match. Atlas normally prepares the table; here you place the pieces yourself to learn their jobs."),
  lesson("opening-hand", "2. Choose what to keep", "Learn what a mulligan is and why you might replace a card.", 3, "Set up", [
    { ...continueStep("what-is-a-mulligan", "A mulligan is your chance to swap up to two cards from your opening hand, once, before play starts. You get the same number back. Use it to look for cards you can play early; you may also keep all four."), title: "What is a mulligan?", label: "Look at my hand", presentation: "mulligan-intro" },
    inspect("p-sentry", "Keep something you can play soon", "Watchful Sentry costs 2 energy: see the number at the top left. Your first two runes can make 2 energy. Keeping this unit means you can put something on the table on your first turn."),
    inspect("p-opening-ahri", "Why replace this Ahri?", "This Ahri needs 3 energy and 1 Mind power. You cannot afford her with your first two runes. You already have an Ahri waiting in the champion space, so we’ll swap this extra copy for another early option."),
    step("mulligan-one", "Swap the expensive card", "For this practice, replace this one Ahri from your hand. Select her and confirm. Set her aside, draw one replacement, then put her on the bottom of your main deck. Drawing first stops you getting the same copy straight back.", { type: "mulligan", cardIds: ["p-opening-ahri"] }, "Replace selected card"),
    inspect("p-replacement", "You still have four cards", "Your replacement is another Watchful Sentry. The swap cost no resources and put nothing in the trash. The guide takes its mulligan after you and keeps all four cards."),
    continueStep("mulligan-plan", "Expensive cards can be useful later. The aim is to keep enough cards you can use now, rather than spend your first turns waiting. Your exact choices will depend on your deck and opponent.")
  ]),
  lesson("first-or-second", "3. First turn, first runes", "See what going first and second changes.", 3, "First turns", [
    { ...continueStep("turn-start-overview", "Your hand is ready. Each turn starts with ABCD: Awaken, Beginning, Channel, then Draw. Online simulators often handle these steps automatically. Here you will do each one yourself so you learn the order. Then Main begins, when you can play cards and move units."), title: "Remember ABCD", label: "Start my first turn", presentation: "turn-start" },
    step("awaken", "A is for Awaken", "Ready means upright and available to use. Exhausted means sideways after use. Awaken turns your cards upright again at the start of your turn. Nothing needs turning yet; choose Awaken to confirm this step.", { type: "ready" }, "Ready your board"),
    continueStep("beginning", "B is for Beginning. This is when you check cards with beginning effects and score for holding a battlefield you still control. You do not control a battlefield yet, so there is nothing to score. Next we bring out your runes.", "B is for Beginning"),
    step("channel-two", "C is for Channel", "Channel means bring runes from your rune deck onto the table. They enter ready to help pay for cards. Ctrl+left-click the rune deck to bring out your first two runes.", { type: "channel", ready: true }, "Channel 2 runes", "Hold Ctrl while left-clicking the rune deck. These runes must enter ready."),
    inspect("p-rune-1", "Why does going second give more?", "You chose first and get to act first. The second player gets one extra rune on their first turn to help them catch up: three instead of two. Later, both players channel two. Inspect your rune, then we’ll draw."),
    step("draw-first", "D is for Draw", "Draw one card to give yourself another choice. Both players draw on their first turn in this two-player game. Press D or click your Main Deck. After this comes Main, where you can begin playing your cards.", { type: "draw" }, "Draw 1")
  ]),
  lesson("read-a-card", "4. Read the card", "Find a card’s cost, strength and timing.", 2, "First turns", [
    inspect("p-sentry", "The number is its energy cost", "Watchful Sentry is a unit: it can move and fight. Its top-left 2 tells you to spend 2 energy to play it. Think of that number as its price. Let’s look at where the energy comes from."),
    inspect("p-rune-1", "A rune makes energy", "This rune is upright, so it is ready. Tapping it turns it sideways and gives you 1 energy. Any basic rune can make energy for a number cost, regardless of its domain symbol."),
    { ...inspect("p-sentry", "Might tells you how it fights", "The Sentry’s 1 Might means it deals 1 combat damage. It also dies when it has damage equal to its Might. Its Deathknell text says to draw a card when it dies; we’ll see that happen later."), id: "inspect-sentry-might" },
    inspect("p-discipline-2", "Spells do a different job", "Discipline is a spell, not a unit. It can make a unit stronger, then draw you a card. Reaction means it can be used in response to something. For now, keep it in hand; first we need a unit to help.")
  ]),
  lesson("play-first-unit", "5. Play your first unit", "Make energy, pay a cost and develop your base.", 2, "First turns", [
    exhaust(1), exhaust(2),
    step("play-sentry", "Spend your energy on a unit", "You now have 2 energy available. Play Watchful Sentry from your hand to your base. Its price uses both energy, so your total returns to zero. The unit enters sideways: it must ready before making a normal move.", { type: "play", cardId: "p-sentry", destination: "base" }, "Play Watchful Sentry"),
    continueStep("where-units-can-start", "Your base is always a normal place to play a unit. A battlefield you control can also be a place to play one directly. You do not control either battlefield yet, so we used the base. We’ll try the other option after conquering a battlefield."),
    step("end-first", "Give the opponent a turn", "You have played your first unit. End your turn with Space or End turn. The guide will show its own turn one move at a time; then your sideways cards get to ready again.", { type: "end-turn" }, "End turn"),
    continueStep("exhausted-exceptions", "Units normally enter exhausted, just like your Sentry did. That means they cannot make a normal move straight away. Only a card or rule that specifically says otherwise changes this. Your Sentry must wait until it readies.")
  ]),
  lesson("power-and-champion", "6. Power and your champion", "Use one rune for energy and then for power.", 3, "First turns", [
    inspect("p-champion", "Ahri has two kinds of cost", "Ahri’s number is 3 energy. The Mind symbol beneath it also asks for 1 Mind power. Power pays a symbol cost; Might is a unit’s fighting strength. You need both energy and power to play this Ahri."),
    exhaust(1, "pay Ahri’s 3-energy number cost"), exhaust(2, "pay Ahri’s 3-energy number cost"), exhaust(3, "pay Ahri’s 3-energy number cost"),
    continueStep("why-recycle", "You have 3 energy available, but energy cannot pay Ahri’s Mind symbol. Recycling a Mind rune makes Mind power. Its symbol matches hers. A Calm rune would make Calm power instead, which would not pay this cost.", "Why Ahri still needs Mind power"),
    step("recycle-mind", "Recycle the Mind rune", "Select that same sideways Mind rune and choose Recycle, or right-click it. Recycling returns it to the bottom of the rune deck and makes 1 Mind power. It works even though the rune is exhausted. The 3 energy you already made is still available.", { type: "recycle", cardId: "p-rune-3" }, "Recycle Mind rune"),
    continueStep("recycle-tradeoff", "You now have 3 energy and 1 Mind power ready to spend. The recycled rune has left the table, so it will not ready with your other runes next turn. It can return when you channel it again. That is the trade for getting power now.", "What you paid for power"),
    step("play-champion", "Pay both costs and play Ahri", "Play Ahri from the champion space to your base. Spend 3 energy and 1 Mind power. She joins your units, exhausted. The champion space is now empty; it does not give you another free copy.", { type: "play", cardId: "p-champion", destination: "base" }, "Play Ahri")
  ]),
  lesson("move-to-battlefield", "7. Move onto the battlefield", "Use a ready unit to contest a battlefield.", 2, "Score points", [
    inspect("p-sentry", "A unit ready to leave base", "Your Sentry is upright, so it is ready. It cannot score from base; it needs to reach a battlefield. A normal move turns it sideways and takes it from base to either battlefield, or from a battlefield back to base. Inspect it before choosing where to go."),
    step("move-sentry", "Move towards your first point", "Drag your Sentry from base to the left battlefield. We are trying to conquer this empty battlefield for a point. Arriving starts a showdown: both players get a chance to act before anyone conquers the battlefield.", { type: "move", cardId: "p-sentry", destination: "battlefield-left" }, "Move to left battlefield"),
    continueStep("showdown-open", "Your Sentry has arrived, but the point is not yours yet. A showdown gives the opponent a chance to stop you, even at an empty battlefield. In the next lesson you will finish that chance to respond and conquer the battlefield.")
  ]),
  lesson("first-conquest", "8. Conquer your first battlefield", "Finish the showdown and score the battlefield.", 2, "Score points", [
    pass("empty-showdown"),
    score("first-point", "Both players have passed and your Sentry is the only unit here. You gain control of the battlefield. This is conquering: gaining control of a battlefield after its showdown. Record 1 point towards the 8 you need to win."),
    continueStep("battlefield-ability", "The battlefield has its own text too: Monastery offers an extra card if you spend a buff when you conquer. A buff is a special +1 Might marker; you have none to spend. You still keep the point for conquering without using this optional ability.")
  ]),
  lesson("holding", "9. Hold and reinforce", "Score by holding a battlefield, then play a unit straight onto it.", 3, "Score points", [
    step("pass-turn", "Leave your Sentry on the battlefield", "You control the left battlefield because your Sentry is there. End your turn and leave it in place. If you still control this battlefield at the start of your next turn, you can score again during Beginning by holding it.", { type: "end-turn" }, "End turn"),
    step("ready-held", "Ready without leaving the battlefield", "Your next turn has arrived. Click Ready all to turn your cards upright in Awaken. Your Sentry stays on its battlefield; readying does not move it. This prepares your cards for use before the holding check.", { type: "ready" }, "Ready your board"),
    score("hold-point", "You retained control of the left battlefield through the guide’s turn. During Beginning, record 1 point for holding it. Each player can score a battlefield only once per turn, so leaving and conquering it again now would not give you another point."),
    step("channel-next", "Bring out more resources", "Ctrl+left-click your Rune Deck to channel two ready runes. Having more runes gives you more resources for cards. The second player’s extra first-turn rune is a one-time bonus, so it does not apply here.", { type: "channel", ready: true }, "Channel 2 runes"),
    step("draw-next", "Add another choice to your hand", "Press D or click your Main Deck to draw one card. Drawing puts it in your hand; it does not play it for free. You then reach Main, where we will add another unit to protect your battlefield.", { type: "draw" }, "Draw 1"),
    exhaust(5, "add another Sentry directly to your battlefield"), exhaust(6, "add another Sentry directly to your battlefield"),
    step("reinforce-field", "Add another defender", "You control Monastery, so you may play a unit straight onto it. Spend 2 energy to play your second Sentry there from hand. It enters sideways, but is already at the battlefield to help defend it. Adding a unit does not itself score another point.", { type: "play", cardId: "p-sentry-2", destination: "battlefield-left" }, "Play Sentry onto Monastery", "Choose the highlighted battlefield as the play destination. This is your Main phase with no waiting effects. Rockfall Path’s special text would forbid this direct play, even if you controlled that battlefield."),
    continueStep("controlled-play", "Your base is always an option; a battlefield you control can be an option too. Playing a unit there is different from moving one there. This new Sentry did not attack or start combat, and it still entered exhausted.")
  ]),
  lesson("start-combat", "10. Challenge a defender", "Attack a controlled battlefield and read the combat state.", 3, "Battle and react", [
    inspect("o-sentry", "The unit guarding this battlefield", "We are at a later turn. The guide’s Sentry controls the right battlefield; your Ahri is ready in base. To conquer this battlefield, you must get past that unit. Inspect the Sentry: it will be the defender when your unit arrives to attack."),
    step("attack", "Send Ahri into the fight", "Move Ahri onto Rockfall Path; moving is allowed even though this battlefield forbids playing new units here. When movement starts a new fight, any movement-triggered abilities finish first. None start here. Combat then opens: Ahri attacks, Sentry defends, and Ahri’s attack ability gets a response window before damage.", { type: "move", cardId: "p-champion", destination: "battlefield-right" }, "Attack right battlefield"),
    inspect("p-champion", "Compare the units", "Ahri has 3 Might and the Sentry still has 1. Might tells you how much combat damage each deals and how much damage kills it. Inspect Ahri to compare them. No combat damage has happened yet; both sides may still use cards to change this fight."),
    continueStep("combat-window", "The combat showdown is the chance to act before damage. An Action can start a spell here when nothing is waiting; a Reaction can also answer a waiting spell. The next lesson shows those responses while this same fight is still paused.")
  ]),
  lesson("the-chain", "11. Respond on the chain", "Pay for a Reaction and resolve the newest item first.", 4, "Battle and react", [
    inspect("o-discipline", "A spell waiting to happen", "The guide paid 2 energy for Discipline to strengthen its Sentry. The chain is the list of spells and abilities waiting to happen. Inspect Discipline: it is on that list, so its effect has not happened yet. You can answer with a Reaction."),
    exhaust(1, "play Discipline on Ahri before combat damage"), exhaust(2, "play Discipline on Ahri before combat damage"),
    step("react", "Strengthen Ahri before the fight", "Play your Discipline and choose Ahri as its target: the unit the spell will affect. Spend 2 energy. Reaction lets you answer the waiting spell. Yours joins above it on the chain, so yours will happen first after both players pass.", { type: "play", cardId: "p-discipline-2", targetId: "p-champion" }, "React with Discipline"),
    pass("pass-own"), resolve("resolve-own"),
    pass("pass-enemy"), resolve("resolve-enemy"),
    continueStep("chain-result", "Both spells happened, newest first. Ahri is now 5 Might and the Sentry is 3; each player also drew a card. Responding did not stop the older spell. It made your own change before that spell happened. We can now finish this fight.")
  ]),
  lesson("countering-spells", "12. Counter a spell", "Stop a spell before it resolves and keep the costs clear.", 4, "Battle and react", [
    inspect("o-rune-prison", "Stop a spell before it happens", "Separate practice: your Sentry is attacking. Rune Prison is on the chain, the list of effects waiting to happen, and would stun it, which would stop it dealing combat damage this turn. Inspect that spell. We will use a counterspell to stop it before its effect happens."),
    step("counter-energy", "Make energy for Defy", "Defy is the spell we will use to stop Rune Prison. It costs 1 energy and 1 Calm power. First, left-click this ready Calm rune to tap it for 1 energy. We will use this same rune for the matching power next.", { type: "exhaust", cardId: "p-rune-2" }, "Exhaust Calm rune"),
    step("counter-power", "Recycle that same rune", "Right-click the SAME exhausted Calm rune for 1 Calm power. It returns to the bottom of your rune deck. You still have the energy it made. Defy needs both resources.", { type: "recycle", cardId: "p-rune-2" }, "Recycle exhausted Calm rune"),
    step("counter-play", "Choose the spell you want to stop", "Play Defy for 1 energy and 1 Calm power, choosing Rune Prison on the chain as its target. Defy can stop a spell costing at most 4 printed energy and at most 1 printed power. Rune Prison meets both limits; your target is the spell, not the Sentry.", { type: "play", cardId: "p-defy", targetId: "o-rune-prison" }, "Defy Rune Prison", "Select Defy, then the waiting Rune Prison in the chain. Counter means stop that waiting spell from happening. You cannot counter an effect that has already happened."),
    continueStep("counter-window", "Defy is a Reaction, so you could add it while another spell waited. It is a spell too: the opponent gets a chance to respond. In this example they have no response. Newer responses would sit above Defy."),
    pass("counter-passes"),
    resolve("counter-resolve"),
    inspect("p-sentry", "Check what you protected", "Inspect your Sentry: it is not stunned and can still deal combat damage. Defy stopped Rune Prison, and both spells are now face up in the trash. Stopping a spell does not refund what either player paid for it."),
    continueStep("counter-limits", "A counter stops the targeted spell’s effect; it does not undo something that already resolved. Defy cannot target a unit or an ability, and its two printed-cost limits both matter. The next lesson returns to the Ahri combat position from before this separate example.")
  ], "Separate Ahri-versus-Orianna practice position for counterspells. It does not change the main combat checkpoint; the next lesson resumes that earlier battle."),
  lesson("combat-damage", "13. Resolve the battle", "Watch the damage, handle deaths and conquer.", 3, "Battle and react", [
    pass("finish-combat-showdown"),
    { ...step("assign", "Plan where each side’s damage goes", "Ahri has 5 Might, so she will deal 5 damage. The Sentry has 3, so it will deal 3 back. Assigning damage means deciding where it will go before dealing it. There is only one enemy on each side here; we’ll mark those amounts now.", { type: "demonstrate-combat" }, "Show the damage"), combatDemonstration: { sourceIds: ["p-champion"], targetAssignments: [{ cardId: "o-sentry", amount: 5, order: 1, label: "All 5 to the only defender" }], returnAssignments: [{ cardId: "p-champion", amount: 3, order: 1, label: "The Sentry’s 3 goes to Ahri" }], explanation: "Ahri will deal 5 to the Sentry. The Sentry will deal 3 back. These are planned amounts; neither side has dealt damage yet." } },
    resolve("deal-damage"),
    inspect("p-champion", "Why Ahri survived", "Inspect Ahri: she took 3 damage while she had 5 Might, so she survived. Damage equal to or greater than a unit’s Might is lethal, meaning enough to kill it. The Sentry took lethal damage and died. Surviving damage clears; Ahri keeps Discipline’s extra Might for this turn."),
    score("combat-point", "Only Ahri remains on this battlefield. You now take control from the guide and conquer it. Record 1 point: winning the fight lets your surviving unit conquer the battlefield. You could not claim it if neither side had a unit left.")
  ]),
  lesson("hidden-cards", "14. A hidden response", "Hide now, then react on a subsequent turn.", 4, "Bring it together", [
    inspect("p-hidden", "Prepare a surprise for a later turn", "This separate lesson uses Sett, whose Body and Order domains allow Hidden Blade. Hidden lets you prepare a card facedown at a battlefield you control. Inspect it: we will hide it now to answer an attack on a later turn. It cannot be used from Hidden on this same turn."),
    step("hidden-energy", "Keep the energy before recycling", "Hiding needs power. First tap this Order rune for 1 energy, so we get its energy before returning the rune to its deck. That energy remains available after we recycle; recycling by itself would not make energy.", { type: "exhaust", cardId: "p-rune-1" }, "Exhaust Order rune"),
    step("hidden-power", "Pay to hide", "Right-click that exhausted Order rune to recycle it for power. You still have 1 energy available. Hidden's hiding cost is one power of any domain; it is not the spell's printed energy and power cost.", { type: "recycle", cardId: "p-rune-1" }, "Recycle Order rune"),
    step("hide", "Put the surprise where you need it", "Spend 1 power to put Hidden Blade facedown at your left battlefield. This prepares it for a later turn; it does not play the spell or start a response chain now. Your 1 energy remains available. Retain control of this battlefield so the hidden card can stay here.", { type: "hide", cardId: "p-hidden", battlefieldId: "battlefield-left" }, "Hide at left battlefield"),
    step("wait-hidden", "Wait until it can be used", "End your turn. Hidden requires a later turn before you can play the facedown card. The guide will take its turn and attack this battlefield; then our prepared card will be available to protect it.", { type: "end-turn" }, "End turn"),
    step("hidden-play", "Stop the attacker at this battlefield", "Play the hidden Blade and choose the attacking Sentry at this same battlefield. A target is the card you choose for a spell to affect. This play ignores Blade’s printed base cost. It can choose a friendly unit too, but it cannot reach a unit at the other battlefield.", { type: "play", cardId: "p-hidden", targetId: "o-sentry", destination: "battlefield-left" }, "Play Hidden Blade"),
    pass("pass-hidden"), resolve("resolve-hidden"),
    continueStep("hidden-result", "The attacker dies. Hidden Blade makes its controller draw two; the Sentry's Deathknell draws one more. Your unit remains, so the opponent does not conquer. Losing control would instead send your hidden card to the trash, revealed.")
  ], "Explicit practice swap: Sett (Body/Order) replaces Ahri so Hidden Blade is in-domain. This is a separate position; it does not change your main-match checkpoint.", "Sett"),
  lesson("keywords-in-combat", "15. Read keywords in context", "Put Assault and Tank into a real damage assignment.", 3, "Bring it together", [
    inspect("p-poro", "An attacker gets extra Might", "This separate Sett example is already in a fight. Your units moved in, so they are attackers. Inspect Daring Poro: Assault adds 1 to its printed 2 Might while attacking. That gives your side 3 damage from this little unit instead of 2."),
    inspect("p-champion", "Sett takes the damage first", "Inspect Sett’s Tank text. When the opponent decides where combat damage goes, it must put enough on Sett to kill him before reaching your unprotected Poro. That amount is called lethal damage. Sett has 5 Might here, so the enemy’s 4 damage cannot get past him."),
    { ...step("keyword-damage", "Watch Tank protect your Poro", "Your attackers contribute 8 damage. With several enemies, you choose the order and assign enough to kill one before moving on. We’ll use 2 on one defending Poro and the remaining 6 on the other. The opponent’s 4 must go to Sett first because he has Tank.", { type: "demonstrate-combat" }, "Show the damage"), combatDemonstration: { sourceIds: ["p-champion", "p-poro"], targetAssignments: [{ cardId: "o-sentry", amount: 2, order: 1, label: "2 is enough to kill this Poro" }, { cardId: "o-sentry-2", amount: 6, order: 2, label: "The last defender takes the remaining 6" }], returnAssignments: [{ cardId: "p-champion", amount: 4, order: 1, label: "Tank sends all 4 to Sett, protecting your Poro" }], explanation: "Either Poro can be first. You cannot split the excess as 4 and 4. The opponent assigns all 4 to Sett; Tank protects your Poro." } },
    resolve("keyword-resolution"),
    score("keyword-conquest", "Your two attackers survived and the enemies are gone. Confirm the point for conquering and gaining control. Assault remains active through conquering and any resulting chain; after those finish, combat ends and your Poro returns to 2 Might."),
    continueStep("keyword-result", "Both defenders died. Sett and your Poro survived and conquered. Assault stays active through conquering and any abilities waiting on the chain; only after those finish does combat end and the bonus go away. The defending Poros never gained Assault because they were not attackers.")
  ], "A separate Sett-versus-Leona practice position for Assault and Tank. Leona has not stunned anything, so her legend has not made a buff. Her chosen champion stays in its zone. This separate practice follows your first-game path.", "Sett"),
  ...NEW_PLAYER_KEYWORD_GROUPS.map(keywordLesson),
  lesson("win-the-game", `${16 + NEW_PLAYER_KEYWORD_GROUPS.length}. Two ways to win`, "Try winning by conquering, then a separate holding example.", 4, "Bring it together", [
    continueStep("seven-points", "Back with Ahri, this later teaching position has you on 7 points. Both battlefields are open and you have two ready Sentries in base. First we’ll win by scoring both battlefields this turn. Then we’ll reset to a separate example of winning by holding.", "Choose how to earn point eight"),
    step("last-attack", "Start the two-battlefield route", "You need to score both battlefields this turn for conquering to earn point 8. Move your first Sentry from base to Monastery. Moving turns it sideways and opens a showdown; we will finish that before checking the score.", { type: "move", cardId: "p-sentry", destination: "battlefield-left" }, "Move to Monastery"),
    pass("last-showdown"),
    score("not-yet", "You have only scored one of the two battlefields this turn. At 7 points, conquering draws a card instead of giving the final point. It still counts as scoring this battlefield."),
    step("second-final-field", "Score the battlefield you still need", "Monastery has counted as scored this turn, even though it gave a card instead of point 8. Move your other ready Sentry to Rockfall so you can score the second battlefield too. Rockfall forbids playing units directly there, but allows this move.", { type: "move", cardId: "p-sentry-2", destination: "battlefield-right" }, "Move to Rockfall Path"),
    pass("second-final-showdown"),
    score("conquest-victory", "Now you have scored both battlefields in the same turn. Conquering now gives point 8: you win. The rule checks that every battlefield was scored this turn; those earlier scores can come from holding as well as conquering."),
    step("show-hold-route", "Try the other route", "That game is finished. Let’s load a separate example: you have 7 points and retained control of Monastery through the opponent’s turn. This is an alternative position, not another turn after your win.", { type: "alternate-win-route" }, "Try winning by holding"),
    step("last-ready", "Ready before checking for holding", "This separate example starts your turn at 7 points with Monastery still yours. Click Ready all for Awaken: turn your cards upright without moving them. Beginning comes next, when holding this battlefield can give you the winning point.", { type: "ready" }, "Ready your board"),
    score("victory", "During Beginning, score by holding the battlefield you still control. Holding gives point 8 without needing to score the other battlefield. You win this example too."),
    continueStep("graduate", "You’ve seen both routes: a final point from conquering after scoring every battlefield that turn, or a holding point. In the next practice, you’ll decide how to earn the winning point yourself.", "How will you earn the final point?")
  ])
];


// Guide turns are narrated before each atomic move; player inputs never silently
// run a whole opposing turn. Keeping these as steps also makes Back exact.
for (const l of LESSONS) {
  if (l.chapter === "Keyword practice") continue;
  const expanded: TutorialStep[] = [];
  if (l.id === "power-and-champion") expanded.push(
    guide("next-awaken", "Your used cards become available again", "Your first Sentry is in base and your two runes are sideways from last turn. Awaken now readies them: it turns them upright so you can use them again. This is why tapping a rune for energy did not use it up forever.", {type:"ready",side:"player"}, ["player:runes","p-sentry"]),
    guide("next-beginning", "Check whether you can score by holding", "Beginning is the part of the turn that checks holding and beginning effects. Your Sentry is still in base, so you control no battlefield and get no holding point. We can move to Channel without scoring.", {type:"phase",phase:"Channel",priority:"player"}),
    guide("next-channel", "More runes make a bigger play possible", "Channel brings two more ready runes from your rune deck onto the table. You will have four runes available. That is enough to prepare Ahri’s 3 energy and Mind power cost, so we can play your chosen champion this turn.", {type:"channel",side:"player",count:2}, ["player:rune-deck","player:runes"]),
    guide("next-draw", "Draw this turn’s extra card", "Draw puts the next card from your main deck into your hand, giving you another option. Then Main begins, when you can play cards normally. Our plan is to use three runes for energy and recycle one of them for Ahri’s Mind power.", {type:"draw",side:"player",count:1}, ["player:deck"]));
  if (l.id === "the-chain") expanded.push(
    step("offer-showdown-focus","Give the guide a chance to act","Ahri is attacking the Sentry, and no effect is waiting right now. Focus is your chance to act in this showdown. Pass it to the guide so it can make a play. Passing gives up this chance to act, not your entire turn.",{type:"pass"},"Pass focus"),
    guide("opponent-pay-discipline", "The guide prepares both energy together", "The guide wants to strengthen its defending Sentry with Discipline, which costs 2 energy. It will tap these two ready runes together. Each adds 1 energy, so its available total becomes 2 while both runes turn sideways and stay on the table.", {type:"exhaust-runes",cardIds:["o-rune-1","o-rune-2"]}, ["o-rune-1","o-rune-2","opponent:resources"]),
    guide("opponent-discipline", "The guide chooses which unit to help", "The guide spends 2 energy on Discipline and targets its Sentry: it chooses that unit to receive the effect. The spell joins the chain, the list of effects waiting to happen. The Sentry has not gained Might yet, so you still have time to respond.", {type:"play",cardId:"o-discipline",destination:"chain",targetId:"o-sentry"}, ["o-discipline","o-sentry","chain"]),
    guide("opponent-priority", "You may answer the waiting spell", "The guide passes priority to you. Priority is permission to add a response right now. Because Discipline is still waiting, you may play a Reaction above it on the chain before the guide’s spell happens.", {type:"phase",phase:"Combat showdown",priority:"player"}, ["chain"]));
  for (const original of l.steps) {
    expanded.push(original.expectedAction.type === "demonstrate-combat" ? {...original,actor:"guide",expectedAction:{type:"guide",eventId:original.id},guideEffect:{type:"assign"}} : l.id === "the-chain" && original.id === "resolve-enemy" ? guide(original.id,"The guide’s older spell happens","Both players have passed on the guide’s Discipline. Resolving means carrying out its instructions: the Sentry gains 2 Might for this turn and the guide draws one card. Your response did not cancel this spell, so both sides now have their stronger unit.",{type:"resolve"},["o-discipline","o-sentry","opponent:deck"]) : original);
    if(l.id==="start-combat"&&original.id==="attack")expanded.push(
      guide("ahri-trigger","Attacking starts Ahri’s ability","Ahri has become an attacker, so her printed attack ability starts automatically. This is called a trigger. It chooses the defending Sentry and joins the chain before the open combat showdown. The Sentry’s Might has not changed yet; players can answer the waiting ability with Reactions.",{type:"trigger",cardId:"p-champion",label:"Ahri — enemy -2 Might, minimum 1",targetId:"o-sentry"},["p-champion","o-sentry","chain"]),
      pass("ahri-trigger-pass"),guide("ahri-trigger-guide-pass","The guide allows Ahri’s ability","You passed on Ahri’s waiting attack ability. The guide adds no response and passes too. Both players have now had their chance, so this ability can change the Sentry before the normal combat showdown continues.",{type:"pass",side:"opponent"},["chain"]),
      guide("ahri-trigger-resolve","Apply Ahri’s printed limit","Ahri’s ability now happens. It subtracts 2 Might from the enemy this turn, but says it cannot take that unit below 1. The Sentry already has 1, so it stays at 1. Reading the limit prevents us inventing a zero-Might result. No combat damage has happened yet.",{type:"resolve-ahri"},["o-sentry","chain"]));
    if (original.expectedAction.type === "resolve" && l.id === "the-chain" && original.id === "resolve-own") expanded.push(guide("older-spell-guide-pass","Return to the older waiting spell","Your Discipline is finished. The guide’s older Discipline is now the newest waiting effect, and its controller gets priority again. The guide passes rather than adding another response, giving you a chance before its spell happens.",{type:"pass",side:"opponent"},["chain"]));
    if (original.expectedAction.type === "pass" && !(l.id === "the-chain" && original.id === "pass-enemy")) {
      const result=l.id==="the-chain"?"Your newer Discipline can now strengthen Ahri and draw you a card; the guide’s older spell keeps waiting.":l.id==="countering-spells"?"Defy can now stop Rune Prison before it stuns your Sentry.":l.id==="hidden-cards"?"Hidden Blade can now remove the chosen attacking Sentry.":l.id==="combat-damage"?"The showdown can finish, so we can use Ahri’s 5 Might and the Sentry’s 3 to work out combat damage.":"The showdown can finish. Your unit is alone on this battlefield, so you can now check whether conquering scores a point.";
      expanded.push(guide(`${original.id}-guide-pass`, "The guide declines to add a response", `You chose to pass. The guide also passes, meaning it adds nothing now. ${result} Passing makes room for that next step; it does not itself pay a cost or deal damage.`, {type:"pass",side:"opponent"}, ["chain"]));
    }
    if (original.expectedAction.type === "end-turn") {
      const hidden = l.id === "hidden-cards", first = l.id === "play-first-unit";
      expanded.push(
        guide(`${original.id}-awaken`, "The guide prepares its used cards", "The guide starts its turn with Awaken. Its sideways cards turn upright so they can be used again. This gets its runes ready to make resources and any units ready for a normal move.", {type:"ready",side:"opponent"}, ["opponent:runes","opponent:base"]),
        guide(`${original.id}-beginning`, "Check the guide’s start-of-turn effects", "Beginning checks holding and abilities that start now. The guide controls no battlefield and has no required Beginning effect in this position, so it earns no holding point and can move on to Channel.", {type:"phase",phase:"Channel",priority:"opponent"}),
        guide(`${original.id}-channel`, "The guide brings out more runes", first ? "Because it went second, the guide channels three ready runes on this first turn instead of two. They come from the separate rune deck and can pay for cards once used. This extra rune helps the second player catch up; later turns add two." : "The guide channels two ready runes from its rune deck. These increase its available options for paying card costs. The extra rune for going second only happens on its first turn, so it does not get that bonus again.", {type:"channel",side:"opponent",count:first?3:2}, ["opponent:rune-deck","opponent:runes"]),
        guide(`${original.id}-draw`, "The guide gets another card choice", "The guide draws the top card of its main deck into its private hand, then reaches Main. Both players draw even on their first turn in this two-player game. Drawing supplies a choice; it does not put that card into play.", {type:"draw",side:"opponent",count:1}, ["opponent:deck"]));
      if (first) expanded.push(
        guide("guide-pay-sentry", "Two runes pay for the guide’s Sentry", "The guide wants a Watchful Sentry in base, which costs 2 energy. It taps two ready runes together. Each makes 1 energy, so the available total becomes 2 as both runes turn sideways. They stay on the table for later turns.", {type:"exhaust-runes",cardIds:["o-rune-1","o-rune-2"]}, ["o-rune-1","o-rune-2","opponent:resources"]),
        guide("guide-first-unit", "The guide builds its own position", "The guide spends the 2 energy it prepared to play Watchful Sentry into base. The unit enters sideways, just like yours did, so it cannot make a normal move straight away. Both players are preparing units that can fight for battlefields later.", {type:"play",cardId:"o-sentry",destination:"base"}, ["o-sentry","opponent:base"]));
      if (hidden || l.id === "holding") {
        const field: TutorialBattlefieldId = hidden ? "battlefield-left" : "battlefield-right";
        expanded.push(guide(`${original.id}-move`, hidden ? "The guide tries to conquer your battlefield" : "The guide tries the other battlefield", hidden ? "The guide moves its ready Sentry from base to attack your battlefield, turning it sideways. Your unit becomes the defender. We hid Blade on a previous turn, so it is now available as a response before this fight deals damage." : "The guide moves its ready Sentry to the empty right battlefield and turns it sideways. It wants to score a point by conquering. Arriving opens a showdown, so you still get a chance to act before it can claim that point.", {type:"move",cardId:"o-sentry",destination:field}, ["o-sentry",field]));
        expanded.push(guide(`${original.id}-focus`, "The guide gives you a chance to act", hidden ? "The guide passes focus, its chance to act in this showdown. You may now use a legal response. Our hidden Blade can remove the attacker before damage, which is why we prepared it at this battlefield earlier." : "The guide passes focus to you. Focus is the chance to act during this showdown. You could interfere with its attempt to conquer the right battlefield; for this practice we will leave it alone and keep our Sentries protecting the left.", {type:"phase",phase:hidden?"Combat showdown":"Showdown",priority:"player"}, [field]));
        if (!hidden) {
          expanded.push(pass(`${original.id}-learner-pass`,"The guide is trying to conquer the right battlefield. Pass focus because this practice keeps your units protecting the left instead of stopping that move. Passing adds no card or ability now; the guide still must finish the showdown before it scores."), guide(`${original.id}-other-pass`, "Finish the guide’s empty-battlefield showdown", "You chose not to interfere. The guide also passes, so both sides have finished acting. Its Sentry is alone at the right battlefield, letting it conquer without combat damage.", {type:"pass",side:"opponent"}, [field]), guide(`${original.id}-score`, "The guide scores by conquering", "The guide conquers the right battlefield, gaining control and recording 1 point. Your left battlefield remains yours because your units are still there. One player can score a battlefield without taking away the other player’s already earned points.", {type:"score",side:"opponent",battlefieldId:field}, [field]));
        }
      }
      if (!hidden) expanded.push(guide(`${original.id}-opponent-ends`, "The guide hands the turn back", "The guide has finished its plays and ends its turn. Any unspent energy and power empty, and effects lasting only that turn end. Your turn begins with Awaken, when your sideways cards can become ready to use again.", {type:"start-turn",side:"player"}, ["player:runes"]));
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
    guide("hidden-buff-energy","The guide pays before attacking","A 1-Might Sentry would lose to your 2-Might Poro. The guide first taps two ready runes together for 2 energy to pay for Discipline. It wants a stronger attacker before risking the move.",{type:"exhaust-runes",cardIds:["o-rune-1","o-rune-2"]},["o-rune-1","o-rune-2"]),
    guide("hidden-buff-play","Discipline waits on the chain","The guide spends 2 energy on Discipline and targets its Sentry in base. The spell gives +2 Might this turn and draws a card, but only when it resolves. The Sentry is still 1 Might for now.",{type:"play",cardId:"o-discipline",destination:"chain",targetId:"o-sentry"},["o-discipline","o-sentry","chain"]),
    guide("hidden-buff-guide-pass","You can answer the waiting spell","The guide passes priority. You could add a legal Reaction, but the Sentry is still in base, so your Hidden Blade cannot target it. This exercise lets Discipline resolve before the move.",{type:"pass",side:"opponent"},["chain"]),
    pass("hidden-buff-pass","Pass priority to let Discipline happen. Hidden Blade can only choose a unit at the battlefield where it is hidden; this Sentry is still in base. Your Poro on the left is a legal friendly target, but we are saving Blade for the attack."),
    guide("hidden-buff-resolve","A stronger attacker is ready","Both players passed. Discipline gives the Sentry +2 Might, making 3 for this turn, and draws the guide a card. The Sentry is still ready in base. It can now threaten your 2-Might defender.",{type:"resolve"},["o-sentry","opponent:deck"]));
  const move=l.steps.find(s=>s.id==="wait-hidden-move")!;
  move.instruction="The guide moves its strengthened 3-Might Sentry from base to attack your 2-Might Poro, turning it sideways. It is now a dangerous attack. Blade was hidden on a previous turn and can target this Sentry once you get priority.";
  move.hint=move.instruction;
}

for (const [lessonId, afterStep] of [["combat-damage","deal-damage"],["hidden-cards","resolve-hidden"]] as const) {
  const l = LESSONS.find(x=>x.id===lessonId)!;
  let at = l.steps.findIndex(x=>x.id===afterStep);
  if (at<0 && lessonId==="combat-damage") at=l.steps.findIndex(x=>x.expectedAction.type==="resolve");
  l.steps.splice(at+1,0,
    guide(`${afterStep}-deathknell`, "A death can start another ability", "The enemy Sentry died. Deathknell is its ability that starts when it dies; this automatic start is called a trigger. Its draw joins the chain after the damage or spell has finished. The guide does not draw immediately, because you can still respond to that ability.", {type:"trigger",cardId:"o-sentry",label:"Watchful Sentry — Deathknell: draw 1"}, ["o-sentry","chain"]),
    guide(`${afterStep}-trigger-guide-pass`, "The guide offers you a response", "The guide controlled the Sentry, so it controls this draw ability and gets priority first. It adds nothing else and passes to you. You now have a chance to respond before Deathknell gives it a card.", {type:"pass",side:"opponent"}, ["chain"]),
    pass(`${afterStep}-trigger-pass`,"The guide has passed on its Sentry’s Deathknell draw. Pass too so the ability can happen. A dead unit’s trigger can still give its controller a card; passing here lets that separate effect finish before we return to the battlefield."),
    guide(`${afterStep}-trigger-resolve`, "The defeated unit gives its last card", "Both players have passed. Deathknell now resolves: its instruction gives the Sentry’s controller one card from the main deck. The Sentry stays in the trash. This draw is a separate benefit from its text, not part of dealing combat damage.", {type:"deathknell",cardId:"o-sentry"}, ["opponent:deck","chain"]));
}

{
  const l=LESSONS.find(l=>l.id==="hidden-cards")!;
  l.steps.push(
    {...continueStep("hidden-other-reset","The first example is finished. Reset to a separate position before the attack: your Poro and hidden Blade are back on the left, and the guide has already paid for and resolved Discipline. This time it will move to the other battlefield."),title:"Reset: the guide chooses the other battlefield",presentation:"lesson-intro",lessonIntro:{see:"A reset position: your hidden card left and the guide’s 3-Might Sentry in base.",do:"Watch the Sentry move right, then keep Blade prepared for a local response.",why:"Hidden cannot reach across battlefields, even when you have a chance to respond."},label:"Start the other-battlefield example",rulesEffect:{type:"hidden-other-position"}},
    guide("hidden-other-move","The guide moves away from the hidden card","The guide sends its strengthened Sentry to the empty right battlefield. Your Poro and Blade stay on the left. The guide can try to conquer elsewhere instead of challenging a prepared hidden response.",{type:"move",cardId:"o-sentry",destination:"battlefield-right"},["o-sentry","battlefield-right"]),
    guide("hidden-other-guide-pass","Check where the response can reach","The guide passes focus. Blade is available on this later turn, but its target must be at the left battlefield where it is hidden. The enemy Sentry on the right is not a legal target.",{type:"pass",side:"opponent"},["battlefield-right","p-hidden"]),
    pass("hidden-other-pass","Pass focus and leave Blade hidden. You could target your own Poro on the left, but cannot target the Sentry on the right. Saving the card protects against a later threat to its own battlefield; it does not stop this attempt elsewhere."),
    guide("hidden-other-score","The other battlefield is conquered","Both players passed. The guide’s Sentry conquers the right battlefield and scores there. You still control the left, so its hidden card remains prepared. A response window does not remove a hidden card’s location restriction.",{type:"score",side:"opponent",battlefieldId:"battlefield-right"},["battlefield-right"]),
    {...continueStep("hidden-loss-example","Reset again to a separate position. Hidden Blade is still facedown, and your Poro is the only friendly unit at Monastery. Moving that last unit away will make you lose control."),title:"Reset: what if you lose control?",presentation:"lesson-intro",lessonIntro:{see:"A fresh position with Blade still hidden and one friendly Poro protecting its battlefield.",do:"Move that last unit back to base and watch the hidden card go to the trash.",why:"Losing control removes a prepared hidden card before you can save it for another attack."},label:"Try the losing-control example",rulesEffect:{type:"hidden-loss-position"}},
    step("leave-hidden-field","See the cost of abandoning the battlefield","Move your ready Poro back to base. It is your last unit here, so leaving means you lose control. We are trying this deliberately to see why a hidden card needs you to keep a unit protecting its battlefield.",{type:"move",cardId:"p-poro",destination:"base"},"Move Poro to base"),
    guide("hidden-loss-cleanup","The abandoned hidden card cannot stay","Cleanup is the game’s check after a change. With no friendly unit left, you lost control, so the check sends facedown Hidden Blade to the trash and reveals it. You cannot leave the surprise behind for a future attack once the battlefield is no longer yours.",{type:"hidden-loss"},["p-hidden","battlefield-left","player:trash"]),
    continueStep("hidden-loss-result","Preparing a hidden card is useful only while you retain control. When you do play it on a subsequent turn, a Hidden Blade can target a friendly or enemy unit at that same battlefield."));
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
  return {id,title,description:goal,minutes:Math.ceil((steps.length+1)*0.35),chapter:"Use what you learned",champion:"Ahri",scenarioNote:"A separate saved practice position. The guide handles its own moves; your moves need your input. Help can reveal the explanation when you want it.",intro,practice:{goal},steps:[
    {...continueStep("practice-intro",`${intro.see} ${intro.do} ${intro.why}`),title:"Use what you learned",label:"Start this practice",presentation:"lesson-intro",lessonIntro:intro},
    ...steps.map(s=>s.actor==="guide"?s:{...s,guidance:"practice" as const,practiceGoal:goal})
  ]};
}
const firstPointSteps:TutorialStep[]=[
  guide("practice-first-awaken","Turn one: start with Awaken","Online simulators often handle turn-start steps automatically. Here you will do them yourself to learn the order. Choose Awaken to ready your cards. You have no used cards yet, so nothing needs turning upright this first time.",{type:"ready",side:"player"},["player:base","player:runes"]),
  guide("practice-first-beginning","Turn one: check Beginning","Check whether you control a battlefield or have an ability that starts at Beginning. You have neither in this opening position, so there is no holding point or effect to handle. Confirm the check to reach Channel.",{type:"phase",phase:"Channel",priority:"player"},["battlefield-left","battlefield-right"]),
  guide("practice-first-channel","Turn one: bring out two runes","Channel two ready runes from your rune deck onto the table. Each can make 1 energy, enough together for the unit you are about to draw. These runes are your payment options; channelling them does not spend them.",{type:"channel",side:"player",count:2},["player:rune-deck","player:runes"]),
  guide("practice-first-draw","Draw your first-turn card","Both players draw on their first turn in a two-player game. Watchful Sentry comes into your hand now. Main begins, and your goal is to use this 2-energy unit to earn a point after it has time to ready.",{type:"draw-card",cardId:"p-sentry"},["player:deck","p-sentry"]),
  ...practiceCopy("play-first-unit",s=>s.expectedAction.type!=="continue")
];
for(const s of firstPointSteps)if(s.expectedAction.type==="exhaust")s.allowedCardIds=["p-rune-1","p-rune-2"];
firstPointSteps.push(
  guide("practice-awaken","Your unit is ready for a new turn","Awaken readies your Sentry and runes. Your unit could not move when it entered sideways last turn; now it has a chance to leave base and work towards a point.",{type:"ready",side:"player"},["p-sentry","player:runes"]),
  guide("practice-beginning","No battlefield to hold yet","Beginning checks which battlefields you still control for holding. Your Sentry is still in base, so there is no holding point. Your goal is to conquer your first battlefield during Main.",{type:"phase",phase:"Channel",priority:"player"}),
  guide("practice-channel","Prepare two more runes","Channel adds two ready runes. You do not have to spend them just because they are available: a normal unit move uses the unit’s readiness, not energy.",{type:"channel",side:"player",count:2},["player:rune-deck","player:runes"]),
  guide("practice-draw","Draw, then make your next choice","Draw one card and enter Main. Your Sentry is ready in base and both battlefields are open. It is your turn to turn that unit into a point; ask for Help if you want the next move explained.",{type:"draw",side:"player",count:1},["player:deck"]),
  ...practiceCopy("move-to-battlefield",s=>s.expectedAction.type==="move"),
  ...practiceCopy("first-conquest",s=>s.expectedAction.type!=="continue")
);
for(const s of firstPointSteps)if(s.expectedAction.type==="move"){
  s.allowedCardIds=["p-sentry"];s.allowedDestinations=["battlefield-left","battlefield-right"];
  s.instruction="Move your ready Sentry from base to either empty battlefield. The move turns it sideways and opens a showdown. Either battlefield can earn the first point; moving to Rockfall is allowed even though playing a new unit directly there is not.";s.hint=s.instruction;
}
const firstPractice=makePractice("practice-first-point","Use what you learned: your first point",{see:"Turn one with four opening cards and no runes on your table yet.",do:"Complete your turn-start steps, play Sentry, let the guide take its turn, then earn your first point.",why:"Doing both turns yourself connects resources, readiness, movement and scoring into a plan."},"Turn one: prepare your resources and play a unit. Turn two: ready it and try to conquer a battlefield.",firstPointSteps);
const firstPracticeEndTurn = firstPractice.steps.find(s => s.id === "end-first")!;
firstPracticeEndTurn.title = "Great, your Sentry is in play";
firstPracticeEndTurn.instruction = "Great, your Sentry is in play. You’ve spent your energy for this turn, and your Sentry is exhausted, so it cannot make a normal move yet. End your turn and let the guide play. On your next turn, Awaken will ready your Sentry; you can then move it to a battlefield and try to conquer it.";
firstPracticeEndTurn.practiceGoal = firstPracticeEndTurn.instruction;
firstPracticeEndTurn.hint = "Choose End Turn on the right of the board. Your Sentry stays in base until it readies on your next turn.";
firstPracticeEndTurn.practiceHint = firstPracticeEndTurn.hint;
const reactionPractice=makePractice("practice-reactions","Use what you learned: protect your attacker",{see:"Ahri attacking the guide’s Sentry, with both players able to change the fight.",do:"Use your response to help Ahri survive, then finish the fight and conquer the right battlefield.",why:"The right response matters only if you carry it through to a surviving unit and a point."},"Keep your attacker alive, finish the fight and conquer the right battlefield.",[
  ...practiceCopy("the-chain",s=>s.expectedAction.type!=="continue"),
  ...practiceCopy("combat-damage",s=>s.expectedAction.type!=="continue")
]);
const finalPractice=makePractice("practice-final-point","Use what you learned: earn the last point",{see:"Seven points, two empty battlefields and two ready Sentries in base.",do:"Use your units to earn the final point this turn, remembering the special final-point rule for conquering.",why:"Winning needs the correct scoring route, not just a unit arriving at a battlefield."},"Win this turn from seven points using your two ready Sentries.",practiceCopy("win-the-game",s=>!["show-hold-route","last-ready","victory"].includes(s.id)&&s.expectedAction.type!=="continue"));
for(const s of finalPractice.steps)if(s.expectedAction.type==="move"){
  s.allowedCardIds=["p-sentry","p-sentry-2"];s.allowedDestinations=["battlefield-left","battlefield-right"];
  s.instruction=s.id==="last-attack"?"Move either ready Sentry from base to either empty battlefield. You need to score both battlefields this turn to earn point eight by conquering, so keep the other Sentry ready for the second battlefield.":"Your first battlefield has counted as scored this turn. Move the remaining ready Sentry to the other, unscored battlefield. Either unit and battlefield could have gone first; what matters is scoring both battlefields in this turn.";s.hint=s.instruction;
}
for(const [after,practice] of [["first-conquest",firstPractice],["combat-damage",reactionPractice],["win-the-game",finalPractice]] as const)LESSONS.splice(LESSONS.findIndex(l=>l.id===after)+1,0,practice);
const decision = (id:string,title:string,prompt:string,options:NonNullable<TutorialStep["decision"]>["options"]):TutorialStep => ({
  ...step(id,title,prompt,{type:"choose",optionId:options.find(o=>o.accepted)!.id},"Choose your answer"),decision:{prompt,options}
});
const exercise = (operation:string):TutorialGuideEffect=>({type:"exercise",operation});
const supported = (s:TutorialStep,goal:string,clue:string):TutorialStep => ({...s,guidance:"practice",practiceGoal:goal,practiceHint:clue});
function addedLesson(id:string,title:string,intro:TutorialLessonIntro,steps:TutorialStep[],path:NonNullable<TutorialLesson["path"]>):TutorialLesson {
  return {id,title,description:intro.why,minutes:Math.ceil((steps.length+1)*0.32),chapter:path==="practice"?"Make your own choices":"Your first game",champion:"Ahri / Orianna",path,intro,
    scenarioNote:"A clearly labelled teaching position with real cards and complete legal teaching decks. It does not overwrite the main Ahri game. Optional on-play effects already finished unless a step explicitly offers them.",
    steps:[{...continueStep("lesson-intro",`${intro.see} ${intro.do} ${intro.why}`),title,label:"Start this lesson",presentation:"lesson-intro",lessonIntro:intro},...steps]};
}
const opponentPass=(id:string)=>guide(id,"The guide adds nothing","The guide passes too. With both chances finished, we can carry out the next part of this contest.",{type:"pass",side:"opponent"},["chain"]);
const exerciseDamage=(id:string,sourceIds:string[],targetId:string,total:number,returns:NonNullable<TutorialStep["combatDemonstration"]>["returnAssignments"],explanation:string):TutorialStep=>({
  ...step(id,"Check the planned damage",explanation,{type:"demonstrate-combat"},"Show the damage"),combatDemonstration:{sourceIds,targetAssignments:[{cardId:targetId,amount:total,order:1}],returnAssignments:returns,explanation}
});
const planningGoal="Earn a point, then decide what your remaining resources can do before ending Main.";
const planning=addedLesson("plan-your-main","Make a plan for Main",{see:"Separate example: a ready unit in base, two unused runes and a two-energy unit in hand.",do:"Check the score, the available moves and your budget; then make more than one useful play.",why:"A turn is not limited to one card. Your plan decides when you have finished."},[
  decision("main-plan","What helps the score now?","Both battlefields are empty. Which plan can earn a point this turn without waiting for a new unit to ready?",[
    {id:"move",label:"Use the ready unit already in base",accepted:true,explanation:"Its readiness pays the move. Your runes remain available for another play."},
    {id:"new",label:"Play the new unit and move it immediately",accepted:false,explanation:"A new ordinary unit enters exhausted. It cannot make a standard move immediately; your existing ready unit can."},
    {id:"end",label:"End now because I have drawn a card",accepted:false,explanation:"Drawing starts your Main choices; it does not use up a one-action allowance. You still have a ready unit and resources."}
  ]),
  supported(step("plan-move","Use readiness, not energy","Move your ready Pickpocket to the empty left battlefield. Its earlier on-play effect has finished. This move turns it sideways and leaves both runes ready.",{type:"move",cardId:"p-planner",destination:"battlefield-left"},"Move to the battlefield"),planningGoal,"A unit already on the table may use its readiness. A move does not cost energy."),
  pass("plan-pass","Pass to finish this empty-battlefield contest. You are passing a response chance, not ending your Main phase."),opponentPass("plan-guide-pass"),score("plan-point","Record your first point for conquering. Main continues after this contest; your two runes are still ready."),
  decision("main-more","Is the turn used up?","You have scored, and still have two ready runes and Clockwork Keeper in hand. What is true?",[
    {id:"more",label:"I may make another legal play, or choose to end",accepted:true,explanation:"There is no one-card or one-move allowance. Costs, timing and readiness limit each action."},
    {id:"over",label:"Scoring always ends my turn",accepted:false,explanation:"Scoring finishes this contest. It does not automatically end Main."}
  ]),
  exhaust(1,"add a unit for a future turn"),exhaust(2,"add a unit for a future turn"),
  step("plan-play","Use the rest of this plan","Play Clockwork Keeper in base for 2 energy. We decline its optional extra power payment, so there is no draw trigger. It enters exhausted and prepares a future move.",{type:"play",cardId:"p-keeper",destination:"base"},"Play Keeper"),
  step("plan-end","Finish when your plan is done","You moved, scored and played a card in one Main phase. End now because we have finished this plan, not because a fixed action limit ran out.",{type:"end-turn"},"End turn"),
  continueStep("main-checklist","Reuse this check: What points can I earn or protect? Which units are ready? What can my runes pay? Should I keep a response available? Only then decide whether to end. The resource-decisions practice compares spending now with saving a response.")
],"first-game");
const simpleCombat=addedLesson("simple-combat","Predict a simple fight",{see:"Separate example: your ready 3-Might Pickpocket faces a 2-Might Clockwork Keeper guarding a battlefield.",do:"Predict the result, then attack and check both sides’ damage before scoring.",why:"First learn the basic fight without attack, death or movement abilities changing the numbers."},[
  decision("predict-fight","Before you attack","Neither unit has a relevant combat effect here. If these units deal combat damage together, what happens?",[
    {id:"survive",label:"Pickpocket survives; Keeper dies",accepted:true,explanation:"Three damage kills the 2-Might Keeper. Two damage is less than Pickpocket’s 3 Might."},
    {id:"first",label:"Only Pickpocket deals damage because it attacks",accepted:false,explanation:"Both sides deal damage together. The defender still deals its 2 even when the same exchange kills it."},
    {id:"both",label:"Both die because they both take damage",accepted:false,explanation:"Taking some damage is not enough to kill a unit. Compare the amount with its current Might."}
  ]),
  step("simple-attack","Test your prediction","Move Pickpocket onto Keeper’s battlefield. Pickpocket attacks and Keeper defends. Their optional on-play effects are already finished; no attack or death trigger changes this fight.",{type:"move",cardId:"p-planner",destination:"battlefield-left"},"Attack"),
  pass("simple-pass","The example gives neither side a spell to add. Pass the response chance so we can test the printed Might numbers."),opponentPass("simple-guide-pass"),
  exerciseDamage("simple-assign",["p-planner"],"o-keeper",3,[{cardId:"p-planner",amount:2,order:1}],"Plan 3 damage to Keeper and 2 back to Pickpocket. These amounts happen together, not attacker first."),
  resolve("simple-resolve"),inspect("p-planner","Check the survivor","Pickpocket survived because 2 damage was below its 3 Might. Surviving damage clears. Keeper is in the trash; its earlier on-play ability does not trigger when it dies."),
  score("simple-score","Your unit is the only one left, so conquer the battlefield and score. If both units had died, neither side would have a surviving unit to conquer."),
  decision("equal-fight","Try the same reasoning with equal Might","In another fight, two ordinary 3-Might units deal 3 damage to each other. Who remains to conquer the battlefield?",[
    {id:"neither",label:"Neither unit survives, so neither side conquers",accepted:true,explanation:"Both take damage equal to their Might. There is no surviving unit to establish control."},
    {id:"attacker",label:"The attacker survives because it went first",accepted:false,explanation:"Combat damage is simultaneous; being the attacker does not make its hit happen first."}
  ])
],"first-game");
const mulligans=addedLesson("mulligan-practice","Choose an opening plan",{see:"Two separate four-card opening hands for the same legal teaching deck.",do:"Keep an affordable start in one hand, then replace two cards that cannot help the other start.",why:"Mulligans improve a plan; they are not a rule to throw away every expensive card."},[
  decision("keep-plan","This hand already has a start","Clockwork Keeper costs 2 energy. Pickpocket costs 3, Elder costs 4 and Discipline can support a unit. What would you try?",[
    {id:"keep",label:"Keep the hand: Keeper starts, other cards have later jobs",accepted:true,explanation:"An early unit makes the hand playable. You do not need every card to cost two or less."},
    {id:"expensive",label:"Every card costing more than two must be replaced",accepted:false,explanation:"Later cards can belong in a good opening plan. Mulligan at most two cards; think about what your early unit enables."}
  ]),
  {...step("keep-four","Keep the playable hand","Confirm Keep all. A mulligan is optional; keeping a hand is a real choice. Your four cards stay in hand and no resources are paid.",{type:"mulligan",cardIds:[]},"Keep all"),rulesEffect:exercise("mulligan-keep")},
  {...continueStep("second-hand","Separate example: restart setup with two Elders, Discipline and Rune Prison. None is an affordable unit for your first two runes. We keep the two useful spells and try replacing both Elders for early units."),rulesEffect:exercise("mulligan-second")},
  supported({...step("replace-two","Choose two cards to replace","Select both Wizened Elders and replace them. Set them aside, draw two replacements, then recycle the original cards to the bottom in random relative order. Your hand stays at four.",{type:"mulligan",cardIds:["m-elder-one","m-elder-two"]},"Replace two"),rulesEffect:exercise("mulligan-two")},"Give this hand an affordable unit for the first turn.","Compare each card’s type and number cost with the two runes you will channel. A support spell needs something to support."),
  continueStep("mulligan-outcome","The replacements are Keeper and Sentry in this scripted example. Real replacements are unknown and may miss: you cannot keep swapping. Keeping an early play, useful support and a later card is a plan—not a guarantee of winning.")
],"practice");
const recoveryGoal="Earn a point elsewhere without sending your smaller unit into a fight it cannot win.";
const recovery=addedLesson("recovery-practice","Recover after losing a battlefield",{see:"Separate recovery example: an enemy 4-Might Elder conquered your battlefield. Your ready Keeper remains in base.",do:"Read both battlefields, choose a useful place for your smaller unit and earn your next point.",why:"Losing one contest does not end the game. A different battlefield can give your remaining unit a job."},[
  decision("recovery-plan","You are behind, not finished","Keeper has 2 Might, Elder has 4, and the other battlefield is empty. Which plan earns a point without a losing fight?",[
    {id:"other",label:"Conquer the empty battlefield with Keeper",accepted:true,explanation:"Both battlefields are shared. You can make progress without immediately winning back the same place."},
    {id:"revenge",label:"Attack Elder immediately to conquer that battlefield",accepted:false,explanation:"Without another effect, Keeper would die and Elder would survive. Recovering does not require repeating an unfavourable fight."},
    {id:"give-up",label:"The game is over because I lost a battlefield",accepted:false,explanation:"The opponent has not reached eight points. You still have a ready unit and a route to score."}
  ]),
  supported(step("recovery-move","Move towards a point for conquering","Move Keeper to the empty right battlefield. Rockfall forbids playing a new unit there, but this is a move by a unit already on the table.",{type:"move",cardId:"p-keeper",destination:"battlefield-right"},"Move to the empty battlefield"),recoveryGoal,"Compare both battlefields before choosing. A ready unit can reach either battlefield from base."),
  pass("recovery-pass","Pass focus to give the opponent its response chance. An empty battlefield is still contested through a showdown; the example’s guide chooses not to interfere."),opponentPass("recovery-guide-pass"),
  {...score("recovery-score","Keeper survives at the right battlefield. Record one point for conquering it. You made progress even while the opponent still controls the other battlefield."),rulesEffect:exercise("score-right")},
  continueStep("recovery-outcome","In a real game, check the opponent’s public units, ready runes and hand count before committing. Their card faces are unknown; do not assume no response just because this guide passed. Your next plan might defend this battlefield, reinforce it, or prepare to conquer the other.")
],"practice");
const resourceGoal="Defend your battlefield against the coming 4-Might attack using the plan you chose.";
const resourceSharedTurn=()=>[
  step("budget-end","Keep the chosen resources available","End your turn. Any floating energy empties, but ready runes stay ready; the guide’s Awaken does not ready your exhausted runes. Your chosen plan must work with what remains.",{type:"end-turn"},"End turn"),
  guide("budget-guide-ready","The opponent begins","The guide readies its own cards. Its Elder is ready to move; your cards do not ready on the opponent’s turn.",{type:"ready",side:"opponent"},["opponent:base"]),
  guide("budget-guide-begin","Check Beginning","No opponent-controlled battlefield or Beginning effect scores here. The guide proceeds to Channel.",{type:"phase",phase:"Channel",priority:"opponent"}),
  guide("budget-guide-channel","The guide channels two","Two runes enter ready for the guide’s turn. These belong to the guide, not your response budget.",{type:"channel",side:"opponent",count:2},["opponent:rune-deck"]),
  guide("budget-guide-draw","The guide draws","The guide draws one card and reaches Main. Its hand remains private; this scripted attack is the one we will test.",{type:"draw",side:"opponent",count:1},["opponent:deck"]),
  guide("budget-attack","Here comes the attack","The guide moves its unbuffed Elder onto your battlefield. It has 4 Might. Your Pickpocket has 3; read the rest of your board and hand before responding.",{type:"move",cardId:"o-elder",destination:"battlefield-left"},["o-elder","battlefield-left"]),
  guide("budget-focus","Your chance to respond","The attacker passes focus. You now have your showdown chance. The plan you chose determines whether your two runes are still available.",{type:"pass",side:"opponent"},["player:runes"])
];
const developSteps:TutorialStep[]=[
  supported(exhaust(1,"put another defender on your battlefield"),resourceGoal,"Your two-energy unit can enter the battlefield you already control. Readiness is not needed to defend."),
  supported(exhaust(2,"put another defender on your battlefield"),resourceGoal,"Finish the number cost without recycling a rune; this play needs no power."),
  supported(step("budget-develop","Commit to the extra body","Play Keeper directly onto Monastery for 2 energy. Decline its optional extra power cost. It enters exhausted, but can still defend and deal combat damage. Both runes are now exhausted.",{type:"play",cardId:"p-keeper",destination:"battlefield-left"},"Reinforce the battlefield"),resourceGoal,"A controlled battlefield is a legal unit destination. Entering exhausted stops a standard move, not defending."),
  ...resourceSharedTurn(),
  pass("budget-defend-pass","You spent both ready runes on Keeper. Discipline is still in hand but cannot be paid for now. Your two defenders have 3 + 2 = 5 Might together, enough to kill Elder. Pass and use the board you developed."),
  exerciseDamage("budget-develop-assign",["p-planner","p-keeper"],"o-elder",5,[{cardId:"p-planner",amount:3,order:1},{cardId:"p-keeper",amount:1,order:2}],"Your side deals 5. The guide chooses to put lethal 3 on Pickpocket, then its remaining 1 on Keeper. Both sides’ damage is simultaneous."),
  resolve("budget-develop-damage"),
  guide("budget-develop-result","Keeper retains control","Pickpocket and Elder died. Keeper took only 1 against its 2 Might and survives; that damage clears. You retain control, but defending does not award a new point for conquering.",exercise("defended"),["p-keeper","battlefield-left"]),
  guide("budget-develop-end","The opponent ends","The guide finishes its Main phase and ends the turn. Your turn starts with Awaken next; only then will your own exhausted runes ready.",{type:"start-turn",side:"player"},["player:runes"]),
  continueStep("budget-develop-outcome","You retained control of the battlefield with Keeper and still have Discipline in hand, but lost Pickpocket. Both runes stay exhausted until your own Awaken. Saving the runes instead would let Discipline protect Pickpocket; rewind to the plan question or restart to try that different line.")
];
const reserveSteps:TutorialStep[]=[
  ...resourceSharedTurn(),
  supported(exhaust(1,"respond before combat damage"),resourceGoal,"Your runes are still ready because you did not spend them in your Main. Find a spell that can strengthen the defender now."),
  supported(exhaust(2,"respond before combat damage"),resourceGoal,"Prepare the full number cost. The response needs two energy and no power."),
  supported(step("budget-react","Use what you saved","Play Discipline targeting Pickpocket. It costs the two energy you just made and waits on the chain. The increase and card draw happen only when it resolves.",{type:"play",cardId:"p-discipline",targetId:"p-planner"},"Respond"),resourceGoal,"A Reaction can be used in this window. Strengthening the existing defender can change who survives."),
  pass("budget-spell-pass","Pass priority so the guide can respond to Discipline. Paying for it has not raised Pickpocket’s Might yet."),opponentPass("budget-spell-guide-pass"),
  {...resolve("budget-spell-resolve"),rulesEffect:exercise("resolve-response")},
  guide("budget-return-focus","The guide gets focus again","Your card-started chain is empty. Focus passes to the guide, which adds nothing and passes. Your 5-Might defender is now stronger than the 4-Might attacker.",{type:"pass",side:"opponent"},["p-planner"]),
  pass("budget-final-pass","Pass focus too. The guide has finished its response chance, so both sides can now deal combat damage."),
  exerciseDamage("budget-reserve-assign",["p-planner"],"o-elder",5,[{cardId:"p-planner",amount:4,order:1}],"Pickpocket deals 5 to Elder and takes 4 back. Five current Might lets it survive the simultaneous exchange."),
  resolve("budget-reserve-damage"),
  guide("budget-reserve-result","Your original unit survives","Elder died. Pickpocket survived and its damage clears; its +2 Might lasts for this turn. You still control this battlefield, so this defence does not score a new point for conquering.",exercise("defended"),["p-planner","battlefield-left"]),
  guide("budget-reserve-end","The temporary strength ends","The guide ends its turn. Discipline’s +2 Might ends now, after surviving damage has cleared. Pickpocket returns to printed 3 Might and remains alive; your Awaken comes next.",{type:"start-turn",side:"player"},["p-planner"]),
  continueStep("budget-reserve-outcome","You kept Pickpocket, drew a card from Discipline and still have Keeper in hand. You spent the response spell instead of developing the extra unit earlier. Both plans worked against this scripted attack, but left different cards and units for the next turn. Real hidden responses can change either result.")
];
const resources=addedLesson("resource-decisions","Spend now or keep a response?",{see:"Separate example: you are Orianna, with Pickpocket defending, two ready runes, Keeper and Discipline in hand.",do:"Choose between another defender now and saving a response, then carry out that plan through the attack.",why:"Unused ready runes are an option for later. Spending them changes what you can do on the opponent’s turn."},[
  decision("budget-plan","Choose a real plan","The visible Elder can attack for 4. You have only two ready runes. Which way would you like to try defending your battlefield?",[
    {id:"reserve",label:"Keep both runes ready for a response",accepted:true,explanation:"You will use Discipline during the attack, preserving Pickpocket but spending the spell."},
    {id:"develop",label:"Play Keeper onto the battlefield now",accepted:true,explanation:"The extra defender can retain control of the battlefield even if Pickpocket dies. Your two exhausted runes cannot also pay for Discipline."}
  ]),...reserveSteps
],"practice");
resources.branch={decisionStepId:"budget-plan",defaultOptionId:"reserve",variants:{reserve:reserveSteps,develop:developSteps}};
// A new position tests transfer: the same ready unit can earn a point elsewhere
// or reinforce a defence. Both plans are legal, with different lasting costs.
const capstoneGoal="Choose a plan for your ready Keeper, then protect a useful battlefield through the guide’s turn.";
function capstoneStep(source:TutorialStep):TutorialStep {
  const s=structuredClone(source);s.id=`capstone-${s.id}`;
  if(s.expectedAction.type==="guide")s.expectedAction.eventId=s.id;
  if(s.actor!=="guide"&&s.actor!=="rules"&&!s.decision&&s.expectedAction.type!=="continue"){
    s.guidance="practice";s.practiceGoal=capstoneGoal;
    s.practiceHint=s.expectedAction.type==="move"?"Compare where a ready unit could earn a point with where its Might could help a defence.":s.expectedAction.type==="exhaust"?"Read the number cost of your response and compare it with your ready runes.":s.expectedAction.type==="play"?"Compare the defender’s current Might with the attacker. A Reaction can change the fight before damage.":s.expectedAction.type==="end-turn"?"Your unit’s move is used. Decide what to keep available for the guide’s turn.":s.expectedAction.type==="pass"?"Check whether you are allowing an effect to resolve or finishing a showdown. Neither action ends the whole turn.":s.expectedAction.type==="resolve"?"Both players must finish their response chances before the newest effect or combat damage happens.":"Read the score, the current phase and what remains at the battlefield. Ask for the exact move only if needed.";
    if(s.expectedAction.type==="exhaust")s.allowedCardIds=["p-rune-1","p-rune-2"];
  }
  return s;
}
const capstoneDebrief=(plan:"spread"|"reinforce"):TutorialStep[]=>[
  continueStep("plan-outcome",plan==="spread"?"You earned a point at the other battlefield and kept both units alive. Discipline protected Pickpocket and drew a card, but that response is now in the trash. Your two runes are exhausted until your Awaken. You now control both battlefields; neither scores for holding until its Beginning check.":"Keeper reinforced your controlled battlefield. Your combined 5 Might killed Elder, but the guide assigned lethal damage to Pickpocket, so Keeper is your survivor. You gained no point this turn. You kept Discipline and both runes ready for other responses; the other battlefield remains empty."),
  decision("plan-reflect","What would you check next?","Your plan worked against this prepared attack. Which question will help you choose your next move?",[
    {id:"points",label:"Which battlefield could give me my next point?",accepted:true,explanation:"Check control, the current turn and whether each battlefield has already scored. A surviving defender can set up a later holding point."},
    {id:"resources",label:"Which units, cards and ready runes do I still have?",accepted:true,explanation:"Your future options depend on what your plan spent. Public opposing units and ready runes help you judge risk; their hand remains unknown."}
  ]),
  continueStep("plan-finished","Both plans are sensible. One gains a point now and spends a response; the other keeps that spell and ready runes but loses a unit. A real opponent may respond differently. Use Back to revisit your choices, or restart this separate exercise to compare the other plan.")
];
const spreadPlan=[
  step("spread-move","Carry out your scoring plan","Move your ready Keeper from base to the empty right battlefield. Moving spends its readiness, so it cannot also reinforce the other battlefield this turn. Keep your runes ready for the threatened defence.",{type:"move",cardId:"p-keeper",destination:"battlefield-right"},"Move Keeper"),
  pass("spread-pass","Pass focus to give the guide a chance to respond at the empty battlefield. Arriving alone does not skip that chance."),opponentPass("spread-guide-pass"),
  {...score("spread-score","The guide added nothing. Confirm conquering the right battlefield to earn a point; Keeper now stays there to threaten holding next turn."),rulesEffect:exercise("score-right")},
  ...resourceSharedTurn(),...reserveSteps.slice(resourceSharedTurn().length,-1),...capstoneDebrief("spread")
].map(capstoneStep);
const reinforceDefence=structuredClone(developSteps.slice(3+resourceSharedTurn().length,-1));
reinforceDefence[0]={...reinforceDefence[0],instruction:"Your two defenders have 3 + 2 = 5 Might against Elder’s 4. You could use Discipline, but this plan keeps the spell and both runes available. Pass focus to accept the possible loss of one defender and retain control with the survivor.",hint:"Combined Might can win this fight without spending your response. Passing is a choice, even with ready runes."};
const reinforceEnd=reinforceDefence.find(s=>s.id==="budget-develop-end")!;
reinforceEnd.instruction="The guide ends its turn. Your two runes stayed ready because this plan spent neither. Your surviving Keeper is still exhausted; your own Awaken is next.";reinforceEnd.hint=reinforceEnd.instruction;
const reinforcePlan=[
  {...step("reinforce-move","Carry out your defensive plan","Move Keeper from base to your controlled left battlefield. Its readiness pays for the move; no energy is spent. With no enemy there, moving into your own battlefield does not start a showdown or score another point.",{type:"move",cardId:"p-keeper",destination:"battlefield-left"},"Reinforce with Keeper"),rulesEffect:exercise("capstone-reinforce")},
  ...resourceSharedTurn(),...reinforceDefence,...capstoneDebrief("reinforce")
].map(capstoneStep);
const capstone=addedLesson("choose-your-plan","Your plan, your next turn",{
  see:"A new Orianna position: Pickpocket controls one battlefield, Keeper is ready in base, and the guide’s 4-Might Elder threatens an attack.",
  do:"Choose a scoring or defensive plan, carry it out on the board, and compare what you kept and spent. Help stays available if you need it.",
  why:"Recognising a useful move in a different position is how familiar rules become your own decisions. This exercise accepts both plans."
},[
  decision("capstone-plan","Read the board and choose your plan","You have two ready runes and Discipline in hand. Keeper can move once. Which plan would you like to try?",[
    {id:"spread",label:"Conquer elsewhere, keeping a response for defence",accepted:true,explanation:"Use Keeper to gain ground and keep your runes ready to help Pickpocket if the guide attacks it."},
    {id:"reinforce",label:"Reinforce the battlefield and keep the spell",accepted:true,explanation:"Use Keeper’s Might alongside Pickpocket, accepting that combat may cost a unit while preserving your response."}
  ]),...spreadPlan
],"practice");
capstone.practice={goal:capstoneGoal};
capstone.branch={decisionStepId:"capstone-plan",defaultOptionId:"spread",variants:{spread:spreadPlan,reinforce:reinforcePlan}};
for(const lesson of [planning,simpleCombat,mulligans,recovery,resources])for(const s of lesson.steps)if(s.expectedAction.type==="choose")s.practiceHint="Read the current board and the goal. Compare what each answer would leave available after the action.";

LESSONS.splice(LESSONS.findIndex(l=>l.id==="start-combat"),0,planning,simpleCombat);
const optionalCore=LESSONS.filter(l=>["hidden-cards","keywords-in-combat"].includes(l.id));
const keywords=LESSONS.filter(l=>NEW_PLAYER_KEYWORD_GROUPS.some(g=>g.id===l.id));
const firstGame=LESSONS.filter(l=>!optionalCore.includes(l)&&!keywords.includes(l));
for(const l of firstGame)l.path="first-game";
for(const l of optionalCore)l.path="practice";
for(const l of keywords)l.path="keywords";
const playEffectIntro:TutorialLessonIntro={see:"A later position with resources prepared for Thousand-Tailed Watcher and two enemy units in base.",do:"Play the unit, then resolve its ability after Star-Crossed returns it to your hand.",why:"A unit entering and its play ability resolving are separate events. Removing the source does not erase the ability."};
const onPlay=(operation:Extract<TutorialGuideEffect,{type:"on-play"}>["operation"]):TutorialGuideEffect=>({type:"on-play",operation});
const starCrossedResponse=(prefix:string,target:string):TutorialStep[]=>[
  guide(`${prefix}-energy`,"The guide prepares a response","The guide taps three ready runes together for 3 energy. Star-Crossed is a Reaction, so it can be played while your effect is waiting on the chain.",{type:"exhaust-runes",cardIds:["o-rune-1","o-rune-2","o-rune-3"]},["o-rune-1","o-rune-2","o-rune-3"]),
  guide(`${prefix}-power`,"Pay the Chaos symbol too","The guide recycles one of those exhausted Chaos runes for 1 Chaos power. Its 3 energy stays available. Star-Crossed requires both costs; recycling alone adds power, not energy.",onPlay("recycle-chaos"),["o-rune-1","opponent:resources"]),
  guide(`${prefix}-play`,"Star-Crossed chooses two units",`The guide spends 3 energy and 1 Chaos power. Star-Crossed must choose a friendly unit AND an enemy unit: its own Mystic Poro and your ${target==="p-watcher"?"Watcher":"Sentry"}. Both still remain in base until this spell resolves.`,onPlay("star-crossed-play"),["o-star-crossed","o-mystic-poro",target,"chain"]),
  guide(`${prefix}-guide-pass`,"The guide passes on its response","Star-Crossed is the newest waiting effect. The guide passes priority, giving you a chance to respond before either chosen unit returns to hand.",{type:"pass",side:"opponent"},["chain"]),
  pass(`${prefix}-pass`,"Pass priority to let Star-Crossed happen. Passing means adding no response; neither unit has left the board yet. Your older effect remains underneath this spell and will wait for its own resolution."),
  guide(`${prefix}-resolve`,"Both chosen units return to hand","Both players passed, so Star-Crossed resolves first. It returns the guide’s Mystic Poro and your chosen unit to their owners’ hands, then goes to the trash. Returning a unit is not killing it, so it does not start Deathknell. Your older effect is still waiting.",onPlay("star-crossed-resolve"),["o-mystic-poro",target,"chain"])
];
const playEffects:TutorialLesson={id:"unit-play-effects",title:"Units and their play effects",description:"A unit can leave while its ability keeps waiting. Then try a spell whose target leaves.",minutes:8,chapter:"Bring it together",champion:"Ahri",path:"practice",intro:playEffectIntro,scenarioNote:"Two explicit prepared Ahri-versus-Teemo positions. Complete labelled teaching lists are available from the main-deck drawers. Neither example is a continuation of the main game.",steps:[
  {...continueStep("lesson-intro",`${playEffectIntro.see} ${playEffectIntro.do} ${playEffectIntro.why}`),title:"Units and their play effects",presentation:"lesson-intro",lessonIntro:playEffectIntro,label:"Start this lesson"},
  step("watcher-play","The unit enters now; its ability comes next","The table already has 7 energy and 1 Mind power prepared, with the used runes visible. Spend them to play Thousand-Tailed Watcher into base. We are not paying Accelerate: it enters exhausted immediately. Its play ability is a separate effect; enemy Might has not changed yet.",{type:"play",cardId:"p-watcher",destination:"base"},"Play Watcher"),
  {...guide("watcher-trigger","Playing Watcher starts its ability","Watcher is now a unit in base. Its play ability automatically joins the chain: give every enemy unit -3 Might this turn, to a minimum of 1. It does not choose targets. Players can respond to this ability, although the unit has already entered.",onPlay("watcher-trigger"),["p-watcher","chain"]),actor:"rules"},
  pass("watcher-pass","Pass priority on Watcher’s waiting ability so the guide gets a response chance. The enemy units still have their current Might. A response happens above this ability, before its instructions take effect."),
  ...starCrossedResponse("watcher-response","p-watcher"),
  pass("watcher-ability-pass","Watcher is back in your hand, but its already queued ability is still on the chain. You get a fresh response chance. Pass priority so the guide can answer before you carry out that remaining ability."),
  guide("watcher-ability-guide-pass","The guide lets the ability happen","The guide passes too. Removing Watcher did not counter its ability or remove the chain item. Both players have now passed on the remaining ability.",{type:"pass",side:"opponent"},["chain"]),
  {...resolve("watcher-ability-resolve"),title:"The ability outlasts its source",instruction:"Resolve Watcher’s ability. It affects the enemies still on the board: Chronomancer goes from 4 Might to 1 this turn. Mystic Poro is already in hand, so it is unaffected. Watcher remains in your hand; resolving its ability does not play the unit again.",rulesEffect:onPlay("watcher-resolve")},
  {...continueStep("watcher-result","Look at the result before moving on: Chronomancer is now 1 Might, Watcher is back in your hand, and the chain is empty. The play ability finished even though its source had left. Mystic Poro in hand was not an enemy unit on the board for this effect."),title:"The queued ability still happened",label:"Try the target-leaves example"},
  {...continueStep("target-reset","Reset to a separate position. This time your Sentry is in base and you have Discipline in hand. We will respond to a spell that has chosen a target, then see which instructions remain possible after that target leaves."),title:"Reset: what if the target leaves?",presentation:"lesson-intro",lessonIntro:{see:"A fresh position with your Sentry, Discipline and two ready runes.",do:"Play Discipline, let Star-Crossed return its target, then resolve the remaining instructions.",why:"Losing a target is different from countering a whole spell. Independent instructions can still happen."},label:"Try the target-leaves example",rulesEffect:onPlay("reset-target")},
  exhaust(1,"pay for Discipline"),exhaust(2,"pay for Discipline"),
  step("target-discipline","Choose the unit Discipline will help","Spend 2 energy on Discipline and choose your Sentry. Discipline says to give that unit +2 Might this turn, then draw a card. Neither instruction has happened while the spell waits on the chain.",{type:"play",cardId:"p-discipline",targetId:"p-sentry"},"Play Discipline"),
  pass("target-spell-pass","Pass priority on Discipline. The guide can respond before its chosen Sentry gains Might or you draw. Both of the spell’s instructions are still waiting."),
  ...starCrossedResponse("target-response","p-sentry"),
  pass("target-remaining-pass","Your Sentry has returned to hand, so it is no longer the unit Discipline can strengthen. Discipline itself is still on the chain. Pass priority on that older spell so you can find out which instructions it can still perform."),
  guide("target-remaining-guide-pass","The guide passes on Discipline","The guide adds no further response. Both players passed, so the waiting Discipline can resolve. Star-Crossed moved its target; it did not counter the spell.",{type:"pass",side:"opponent"},["chain"]),
  {...resolve("target-discipline-resolve"),title:"Skip the impossible part; draw the card",instruction:"Resolve Discipline. Its original unit is gone, so the +2 Might instruction cannot affect it in hand. The separate draw instruction still happens: draw one card. Discipline then goes to the trash. Neither player gets their spent resources back.",rulesEffect:onPlay("discipline-resolve")},
  continueStep("play-effects-result","You saw two different reasons an effect survives a response. Watcher’s queued ability remained after its source returned to hand. Discipline remained after its target left and still drew a card. A counter effect explicitly stops a waiting effect; returning a unit to hand does not do that, and does not count as a death.")
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
    s.instruction+=` Choose ${s.label} to do this step yourself.`;
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
  "ahri-trigger":{source:"p-champion",target:"o-sentry",title:"Choose Ahri’s target",instruction:"Ahri’s attack starts her ability, but you choose the enemy it affects. Click the defending Sentry to target it. The ability will then wait on the chain; selecting its target does not reduce Might yet."},
  "keyword-disarm-trigger":{source:"player-RAD-050",target:"opponent-OGN-012",title:"Choose the unit to Disarm",instruction:"Chronomancer’s attack starts Disarm 2. You choose which enemy unit will lose Might. Click Hopeful as this ability’s target; reducing that defender will help your attacker survive. The change still waits for the ability to resolve."},
  "keyword-quick-draw-trigger":{source:"player-SFD-022",target:"player-OGN-096",title:"Choose who receives the sword",instruction:"Long Sword entered immediately. Its Quick-Draw attachment is required, but you choose a friendly unit to receive it. Click your Sentry to confirm the recipient. The attachment then waits on the chain; the extra Might has not arrived yet."},
  "keyword-weaponmaster-trigger":{source:"player-SFD-002",target:"player-SFD-022",title:"Choose the optional attachment",instruction:"Weaponmaster offers to attach a gear when Assailant enters. You may decline in a real game; for this example, click Long Sword to choose the attachment. Its one-power Equip cost is reduced to zero. The sword attaches only when the ability resolves."}
};
for(const l of LESSONS)for(let i=0;i<l.steps.length;i++){
  const s=l.steps[i],choice=triggerSelections[s.id];if(!choice)continue;
  const selected:TutorialStep={...step(`${s.id}-choose`,choice.title,choice.instruction,{type:"choose-trigger",cardId:choice.source,targetId:choice.target},"Choose the target"),actor:"player",focusIds:[choice.target],keywordScenarioId:s.keywordScenarioId,presentation:s.presentation};
  l.steps.splice(i++,0,selected);
  s.instruction=s.id==="ahri-trigger"?"You chose the defending Sentry for Ahri’s attack ability. That trigger now joins the chain automatically. Its target is fixed, but the Sentry’s Might has not changed. Both players may respond with Reactions before you resolve the ability.":s.id==="keyword-disarm-trigger"?"You chose Hopeful for Disarm 2. The attack trigger now joins the chain automatically with that target. Its Might has not changed yet; both players may respond before you resolve it.":s.id==="keyword-quick-draw-trigger"?"You chose your Sentry to receive Long Sword. The required Quick-Draw attachment now joins the chain automatically. Both players may respond before you resolve it and attach the sword.":"You chose Weaponmaster’s optional attachment and selected Long Sword. The ability now joins the chain automatically. Its discount covers this sword’s Equip cost, but the gear stays unattached until you resolve the ability.";
  s.hint=s.instruction;
}
// This first cumulative exercise stays more guided than the later decision tasks.
const firstPracticeGoals:Record<string,string>={
  "energy-1":"Turn one: make enough energy to pay for the affordable unit in your hand.",
  "energy-2":"Turn one: finish preparing the unit’s energy cost. Either unused rune can provide it.",
  "play-sentry":"Turn one: spend the energy you made to put your unit in base. It will be ready to move next turn.",
  "move":"Turn two: your Sentry is ready now. Move it to an empty battlefield to try to earn your first point.",
  "pass":"Turn two: finish both players’ response chances before claiming the battlefield.",
  "conquer":"Turn two: the response chances are finished. Confirm conquering to earn your first point."
};
for(const s of firstPractice.steps){
  if(s.id==="end-first")continue; // Preserve the explicit end-turn explanation.
  if(s.actor==="guide"||s.actor==="rules"||s.lessonIntro)continue;
  const turn=s.id.startsWith("practice-first-")||["energy-1","energy-2","play-sentry"].includes(s.id)?"Turn one":"Turn two";
  if(!s.title.startsWith("Turn "))s.title=`${turn}: ${s.title.charAt(0).toLowerCase()+s.title.slice(1)}`;
  if(s.guidance==="practice")s.practiceGoal=firstPracticeGoals[s.id]??(s.expectedAction.type==="move"?firstPracticeGoals.move:s.expectedAction.type==="pass"?firstPracticeGoals.pass:s.expectedAction.type==="score"?firstPracticeGoals.conquer:`${turn}: ${s.instruction}`);
}
for(const l of LESSONS)for(const s of l.steps)if(s.guidance==="practice"&&!s.practiceHint){
  s.practiceHint=s.expectedAction.type==="exhaust"?"Compare the number cost with your ready runes; each can supply one energy.":s.expectedAction.type==="move"?"Look for a ready unit and a battlefield that advances the score. Moving uses readiness, not energy.":s.expectedAction.type==="play"?"Check card type, timing and both kinds of cost before choosing a useful target or destination.":s.expectedAction.type==="pass"?"Passing gives the other player a response chance; it does not end your turn.":s.expectedAction.type==="score"?"Check who remains at the battlefield and whether you have already scored it this turn.":s.expectedAction.type==="resolve"?"Check that both response chances are finished, then consider the newest waiting effect or the combat damage.":"Read the current position and the goal before asking for the exact move.";
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
    explanation:returning?"This is your main Ahri position again. Points and cards from separate exercises stay in those exercises. Check the turn, score and units before continuing.":"This lesson continues the same Ahri game. Your next move follows the position from the previous main-game lesson."
  }:{
    kind:"separate-exercise",title:l.path==="keywords"?"Separate keyword exercises":"Main game paused · separate exercise",
    explanation:l.path==="keywords"?"Each keyword uses a prepared position, sometimes with a different legend. These examples have their own scores and cards; they do not change your main game.":"This separate exercise has its own turn, score and cards. Your main Ahri game stays where you left it. Check your legend below: some examples use a different champion to make the rule easier to see."
  };
  if(l.id==="table-setup")l.context.explanation="This starts your main Ahri game against Orianna. We will place each part of the board before drawing cards or taking a turn.";
  if(l.id==="win-the-game")l.context.explanation="We are jumping to a prepared seven-point position to try both winning routes. You have not lost or gained points between lessons; this is a separate example.";
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
    note: `Separate ${scenario.keyword} practice: ${playerPair.legend.name} versus ${opponentPair.legend.name}. ${snapshot.note ?? "Only relevant card identities are shown; hand counters include any other cards."} Right-click your Main Deck for its full starting list; About this practice position shows both deck sources. Published lists are unchanged; teaching decks are labelled. These are prepared positions, not recorded games. Legend abilities stay unused and chosen champions stay in their zones.` };
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
    if(index<ordered.length-1&&a.amount!==Math.max(0,target.might-target.damage))throw new Error("Assign lethal before the next unit; excess belongs to the last recipient.");
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
    unit.annotation="Combat ended. The unit keeps its ordinary, equipment and remaining turn effects.";
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
      else {unit.damage=0;unit.annotation="Survived. Damage has cleared; combat designation remains until the result is recorded.";}
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
    fresh.log=["Reset: a separate later-turn position after the guide paid for and resolved Discipline, before choosing a battlefield."];Object.assign(b,fresh);return;
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
  if(op==="predict") {const top=findCard(b,"player-OGN-096")!;top.annotation="Privately inspected, then recycled to the bottom. Not drawn or publicly revealed.";top.faceDown=true;b.priority="player";return;}
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
      c.annotation="Entered immediately. Units and gear do not remain as waiting spell items.";
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
      if(e.operation==="mulligan-keep")b.log.push("Keep all four. Mulligan is optional and costs no resources.");
      else if(e.operation==="mulligan-second")Object.assign(b,firstGamePosition("mulligan-second"));
      else if(e.operation==="mulligan-two"){
        for(const id of ["m-elder-one","m-elder-two"]){const old=findCard(b,id);if(!old||old.zone!=="hand")throw new Error("Select the two Elders from this opening hand.");old.zone="deck";old.faceDown=true;}
        b.cards.push(card("OGN-044","m-new-keeper","player","hand"),card("OGN-096","m-new-sentry","player","hand"));
        b.log.push("Set aside two, draw two replacements first, then return the originals to the main-deck bottom. Hand and deck sizes are unchanged.");
      } else if(e.operation==="score-right"){
        if(b.phase!=="Conquer"||b.priority!==null)throw new Error("Finish both response chances before scoring.");
        scoreField(b,"battlefield-right","conquer");settleConqueredCombat(b);b.phase="Main";b.priority="player";
      } else if(e.operation==="capstone-reinforce"){
        const unit=findCard(b,"p-keeper");
        if(lessonId!=="choose-your-plan"||b.phase!=="Main"||b.priority!=="player"||b.chain.length||b.combat||!unit?.ready||unit.zone!=="base"||fieldAt(b,"battlefield-left").controller!=="player"||b.cards.some(c=>c.owner==="opponent"&&c.type==="unit"&&c.zone==="battlefield-left"))throw new Error("Reinforce your own unopposed battlefield with a ready unit during open Main.");
        unit.zone="battlefield-left";unit.ready=false;b.phase="Main";b.priority="player";b.passedBy=[];
        b.log.push("Keeper moved to your controlled battlefield. Its readiness paid for the move; there is no new showdown or point.");
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
      fresh.log=["Reset: separate position after Discipline resolved and before the guide chooses a battlefield. Hidden Blade was prepared on a previous turn."];Object.assign(b,fresh);break;
    }
    case "hidden-loss-position": {
      const fresh=checkpoint("hidden-cards");const hidden=findCard(fresh,"p-hidden")!;hidden.zone="hidden";hidden.faceDown=true;hidden.hiddenAt="battlefield-left";hidden.hiddenOnTurn=fresh.turn-1;fresh.log=["Separate losing-control example: the hidden card was prepared on a previous turn. Move your last unit away and watch cleanup."];Object.assign(b,fresh);break;
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
        b.log.push("Separate decision challenge: Beginning, Channel and Draw have finished. Pickpocket already scored for holding this turn; Keeper is ready in base. Your earlier optional play effects have finished.");
      }
    }
    if(id==="recovery-practice"){
      const planner=findCard(b,"p-planner")!;planner.zone="trash";planner.ready=false;
      put("OGN-065","o-elder","opponent","battlefield-left");fieldAt(b,"battlefield-left").controller="opponent";b.players.opponent.score=4;b.players.player.score=2;
      b.log.push("Separate recovery position: the guide conquered the left battlefield on its previous turn. Your normal turn-start phases have finished; Keeper is ready in base.");
    }
  }
  for(const c of b.cards){if(c.cardId==="OGN-065")c.annotation="No buff here: printed 4 Might.";if(c.cardId==="SFD-074"&&c.zone!=="hand")c.annotation="Prepared unit: its optional on-play effect has already finished.";}
  for(const side of ["player","opponent"] as const)b.players[side].deckCount=40-b.cards.filter(c=>c.owner===side&&c.type!=="legend"&&c.type!=="rune"&&c.zone!=="deck").length;
  b.log.push("Prepared teaching position, not a recorded game. The full starting lists are available from the Main Deck; optional earlier on-play effects have finished without extra payments or targets. No unit here is buffed.");
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
  b.log=[targetExample?"Reset: separate target-leaves position. Mystic Poro and Chronomancer’s earlier play effects have already finished.":"Separate later-turn position. You already prepared 7 energy and 1 Mind power. The guide’s earlier unit play effects have finished; neither legend ability is in use."];
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
    practice.log=["Separate two-turn practice: your four opening cards are in hand and all twelve runes are in the rune deck. You will complete Awaken, Beginning, Channel and Draw yourself; this practice’s first draw is Watchful Sentry."];
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
    b.log = ["Separate counterspell position: Orianna paid 2 energy and 1 Calm power for Rune Prison, then passed priority. Its target is not stunned yet."];
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
  b.log.push(route === "hold" ? "Separate holding example: return to 7 points at Awaken, having retained control of Monastery through the opponent’s turn. This is not a continuation after victory." : "Later teaching position: 7 points, two open battlefields and two ready Sentries. Try scoring both battlefields this turn.");
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
  if (action.type === "demonstrate-keyword" && (b.phase !== "Keyword practice" || b.keywordScenario?.id !== action.scenarioId || b.keywordScenario.revealed)) return "Use the highlighted action for this keyword’s practice position.";
  if (action.type === "setup") {
    if (b.phase !== "Setup" || !b.setup || b.setup.stage !== action.item) return "Finish the highlighted setup step first.";
    const destination = SETUP_DESTINATIONS[action.item];
    if (destination && action.destination !== destination) return "That piece belongs in the highlighted space. Try placing it there.";
    if (action.item === "legend" && action.cardId !== "p-legend") return "Choose your legend, Ahri, Nine-Tailed Fox.";
    if (action.item === "champion" && action.cardId !== "p-champion") return "Choose your champion unit, Ahri, Inquisitive.";
    if (action.item === "battlefields" && !b.setup.battlefieldOptions.some((f) => f.cardId === action.cardId)) return "Choose a battlefield from your three-card pool.";
    if (action.item === "turn-order" && action.choice !== "first" && action.choice !== "second") return "Choose who goes first before drawing your hand.";
  }
  if (action.type === "inspect") return c || b.battlefields.some((f) => f.id === action.cardId) || (b.phase === "Setup" && Object.hasOwn(INTRO_ZONE_NAMES, action.cardId)) ? null : "That card or space is not in this position.";
  if (action.type === "mulligan") {
    if (b.phase !== "Setup" || b.setup?.stage !== "complete" || !Array.isArray(action.cardIds) || action.cardIds.length > 2 || new Set(action.cardIds).size !== action.cardIds.length) return "Finish setup, then mulligan up to two different cards.";
    if (action.cardIds.some((id) => { const value = findCard(b, id); return !value || value.owner !== "player" || value.zone !== "hand"; })) return "Only your own hand cards can be replaced.";
  }
  if (["exhaust", "recycle", "play", "move", "hide"].includes(action.type)) {
    if (!c || c.owner !== "player") return "Choose a card you control.";
    if (b.priority !== "player") return "Wait until you have priority.";
  }
  if (action.type === "exhaust" && (!c || c.type !== "rune" || c.zone !== "runes" || !c.ready)) return "Exhaust a ready rune in your rune area.";
  if (action.type === "recycle" && (!c || c.type !== "rune" || c.zone !== "runes")) return "Recycle a rune you have in play, ready or exhausted.";
  if (action.type === "channel") {
    const count = b.turn === 2 && b.firstPlayer === "opponent" ? 3 : 2;
    if (!action.ready || b.turnPlayer !== "player" || !["Channel", "Beginning"].includes(b.phase) || b.players.player.runeDeckCount < count) return "Channel ready runes during your Channel phase, using Ctrl+left-click on the rune deck.";
  }
  if (action.type === "draw" && (b.phase !== "Draw" || b.turnPlayer !== "player")) return "This draw belongs to your Draw phase.";
  if (action.type === "ready" && (b.phase !== "Awaken" || b.turnPlayer !== "player")) return "Ready your board in your Awaken phase.";
  if (action.type === "check-beginning" && (b.phase !== "Beginning" || b.turnPlayer !== "player" || b.chain.length || b.battlefields.some(f=>f.controller==="player"&&!f.scoredBy.includes("player")))) return "Check Beginning on your turn after resolving its effects and scoring any battlefield you are holding.";
  if(action.type==="choose-trigger"){
    const target=findCard(b,action.targetId);
    if(!c||c.owner!=="player"||!["base","battlefield-left","battlefield-right"].includes(c.zone)||!target||target.faceDown||!["base","battlefield-left","battlefield-right"].includes(target.zone))return "Choose a visible unit or gear on the board for your triggered ability.";
  }
  if (action.type === "play") {
    if (!c || !["hand", "champion", "hidden"].includes(c.zone) || !c.cardId) return "Play a known card from your hand, champion zone or facedown space.";
    const hidden = c.zone === "hidden";
    if (hidden && (c.hiddenOnTurn === undefined || b.turn <= c.hiddenOnTurn || !c.hiddenAt || fieldAt(b, c.hiddenAt).controller !== "player")) return "A hidden card needs a subsequent turn and a battlefield you still control.";
    if (b.chain.length && !hidden && !c.keywords.includes("Reaction")) return "Only a Reaction can respond while a chain exists.";
    const showdown = /showdown/i.test(b.phase);
    const reaction = hidden || c.keywords.includes("Reaction");
    const actionTiming = reaction || c.keywords.includes("Action");
    if (showdown && !actionTiming) return "This card cannot be played during a showdown.";
    if (!showdown && !b.chain.length && (b.phase !== "Main" || b.turnPlayer !== "player")) return "Play this card in an appropriate Main-phase or response window.";
    if (!hidden && (b.players.player.energy < c.energyCost || (b.players.player.power[c.domain] ?? 0) < c.powerCost)) return "Make enough energy and matching power before playing this card.";
    if (c.type === "unit" && action.destination !== "base") {
      const destination = b.battlefields.find((f) => f.id === action.destination);
      if (!destination || destination.controller !== "player") return "Play a unit to your base or a battlefield you control.";
      if (destination.cardId === "SFD-216") return "Rockfall Path forbids playing units here, even when you control it. Moving here is different.";
    }
    if (c.type === "spell") {
      const target = findCard(b, action.targetId ?? "");
      if (c.cardId === "OGN-045") {
        if (!target || target.type !== "spell" || target.zone !== "chain" || target.instanceId === c.instanceId || !b.chain.some((item) => item.id === target.instanceId)) return "Defy targets a spell waiting on the chain, not a unit or an ability.";
        if (target.energyCost > 4 || target.powerCost > 1) return "Defy needs BOTH printed costs within its limits: at most 4 energy and at most 1 power.";
      } else if (!target || target.type !== "unit" || !["base", "battlefield-left", "battlefield-right"].includes(target.zone)) return "Choose a unit on the board.";
      if (hidden && target.zone !== c.hiddenAt) return "This hidden spell must target a unit at its own battlefield.";
      if (c.cardId === "OGN-213" && !target.zone.startsWith("battlefield")) return "Hidden Blade needs a unit at a battlefield.";
    }
  }
  if(action.type==="move-units"){
    if(b.turnPlayer!=="player"||b.phase!=="Main"||b.chain.length||b.combat)return "Group moves need your open Main phase, outside showdowns and chains.";
    if(!Array.isArray(action.cardIds)||action.cardIds.length<2||new Set(action.cardIds).size!==action.cardIds.length||!b.battlefields.some(f=>f.id===action.destination))return "Choose different units and one battlefield for the whole group.";
    for(const id of action.cardIds){const unit=findCard(b,id);if(!unit||unit.owner!=="player"||unit.type!=="unit"||!unit.ready)return "Every selected unit must be yours and ready to pay its own move cost.";if(unit.zone!=="base"&&!(unit.keywords.includes("Ganking")&&unit.zone.startsWith("battlefield")&&unit.zone!==action.destination))return "Each unit must have a legal route to the same destination.";}
  }
  if(action.type==="spend-buff"){
    const unit=findCard(b,action.cardId);if(!unit||unit.owner!=="player"||unit.buffCount!==1||!["base","battlefield-left","battlefield-right"].includes(unit.zone))return "Spend a real Buff counter from a unit you control; temporary Might and Equipment are not counters.";
    if(b.foundation?.lessonId!=="buffs-and-bonuses"||b.phase!=="Conquer triggers"||b.chain.length||b.battlefields[0].controller!=="player")return "Choose whether to pay Monastery’s Buff cost when its conquer trigger is being finalised, before responses.";
  }
  if (action.type === "move") {
    if (!c || c.type !== "unit" || !c.ready || b.turnPlayer !== "player" || b.phase !== "Main" || b.chain.length) return "A standard move needs your ready unit during your Main phase, outside combat and chains.";
    if (!((c.zone === "base" && action.destination.startsWith("battlefield")) || (c.zone.startsWith("battlefield") && action.destination === "base"))) return "Standard moves go between your base and a battlefield.";
  }
  if (action.type === "hide") {
    if (!c || !c.keywords.includes("Hidden") || !["hand", "champion"].includes(c.zone) || b.turnPlayer !== "player" || b.chain.length || b.phase !== "Main") return "Hide an eligible card in your Main phase with no chain.";
    if (fieldAt(b, action.battlefieldId)?.controller !== "player" || b.cards.some((v) => v.zone === "hidden" && v.hiddenAt === action.battlefieldId)) return "You need an empty facedown space at a battlefield you control.";
    if (!Object.values(b.players.player.power).some((amount) => (amount ?? 0) > 0)) return "Hiding costs one power of any domain.";
  }
  if (action.type === "assign-damage") {
    if (!b.combat || b.phase !== "Combat damage") return "Finish the combat showdown before assigning damage.";
    const friends = b.cards.filter((v) => v.owner === "player" && v.type === "unit" && v.zone === b.combat!.battlefieldId);
    const enemies = b.cards.filter((v) => v.owner === "opponent" && v.type === "unit" && v.zone === b.combat!.battlefieldId);
    const total = friends.reduce((sum, v) => sum + v.might, 0);
    if (!action.assignments || typeof action.assignments !== "object" || Array.isArray(action.assignments)) return "Assign your combat damage to enemy units here.";
    const entries = Object.entries(action.assignments);
    if (entries.some(([id, n]) => !enemies.some((v) => v.instanceId === id) || !Number.isInteger(n) || n < 0) || entries.reduce((sum, [, n]) => sum + n, 0) !== total) return "Assign exactly your total Might to enemy units in this combat.";
    if (enemies.some((v) => (action.assignments[v.instanceId] ?? 0) < v.might - v.damage)) return "In this lesson, assign lethal damage to every defender before placing the remaining damage.";
    if (enemies.filter((v) => (action.assignments[v.instanceId] ?? 0) > v.might - v.damage).length > 1) return "Assign only the damage needed to kill each unit until the last one. Only that final unit receives the excess damage.";
    const tank = enemies.find((v) => v.keywords.includes("Tank"));
    if (tank && (action.assignments[tank.instanceId] ?? 0) < Math.min(total, tank.might - tank.damage) && entries.some(([id, n]) => id !== tank.instanceId && n > 0)) return "Assign lethal damage to Tank before other units.";
  }
  if (action.type === "resolve" && b.chain.length && b.priority !== null) return "Both players must pass before this chain item resolves.";
  if (action.type === "pass" && b.priority !== "player") return "Wait until you have priority to pass.";
  if (action.type === "score" && b.turnPlayer !== "player") return "This teaching score belongs to your turn.";
  if (action.type === "end-turn" && (b.chain.length || b.combat || b.phase.includes("showdown") || b.phase === "Showdown")) return "Finish the current chain or showdown before ending your turn.";
  if (action.type === "alternate-win-route" && (b.phase !== "Victory" || b.players.player.score < 8)) return "Finish the conquering example before loading the separate holding example.";
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
    draw(b, "player"); b.log.push("Final-point restriction: draw 1 instead; not every battlefield was scored this turn.");
  } else { b.players.player.score++; b.log.push(`${method === "hold" ? "Hold" : "Conquer"}: +1 point.`); }
  if (b.players.player.score >= 8) { b.phase = "Victory"; b.log.push("Eight points. You win!"); }
}

function mutate(b: TutorialBoard, action: TutorialAction, lessonId: string, stepId: string, demonstration?: TutorialStep["combatDemonstration"]) {
  const c = "cardId" in action && action.cardId ? findCard(b, action.cardId) : undefined;
  switch (action.type) {
    case "choose": b.decisions={...b.decisions,[stepId]:action.optionId};break;
    case "demonstrate-keyword": {
      throw new Error("Use this example’s guided card actions; the old one-step demonstration has been retired.");
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
        b.log.push("Both players reveal their battlefield together: Monastery of Hirana and Rockfall Path.");
      }
      if (action.item === "main-deck") b.log.push("Both main decks are shuffled and placed in their deck spaces. Each has 39 cards after setting aside the chosen champion. The tutorial uses a fixed draw order.");
      if (action.item === "rune-deck") b.log.push("Both 12-rune decks are shuffled separately and placed beside the main decks. Each player presents both decks to the opponent.");
      if (action.item === "turn-order") { b.firstPlayer = action.choice === "first" ? "player" : "opponent"; b.turnPlayer = b.firstPlayer; b.log.push("The agreed random result gives you the choice. You choose to go first before either player draws."); }
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
    case "check-beginning": b.phase="Channel";b.log.push("You checked Beginning; no holding score or beginning effect remains. Channel comes next.");break;
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
      b.log.push("The selected units moved together in one action. Each exhausted; only one showdown opened at their shared destination.");break;
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
    case "assign-damage": b.combat!.assignments = { ...action.assignments }; b.log.push("Your damage is assigned. The guide assigns its damage before either side deals it."); break;
    case "demonstrate-combat":
      b.combat!.assignments = Object.fromEntries(demonstration!.targetAssignments.map((entry) => [entry.cardId, entry.amount]));
      b.log.push(`The tutorial shows a legal assignment: ${demonstration!.explanation}`); break;
    case "alternate-win-route": Object.assign(b, finalWinBoard("hold")); break;
    case "hide": {
      const domain = (Object.keys(b.players.player.power) as TutorialDomain[]).find((key) => (b.players.player.power[key] ?? 0) > 0)!;
      b.players.player.power[domain]!--; if(b.practice&&c!.zone==="hand")b.players.player.handCount!--; c!.zone = "hidden"; c!.faceDown = true; c!.hiddenAt = action.battlefieldId; c!.hiddenOnTurn = b.turn;
      b.log.push("Hidden Blade is hidden; no chain opens. It cannot be played from Hidden this turn."); break;
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
    return {...state,feedback:ruleProblem ? `Rule check: ${ruleProblem}` : current.guidance==="practice" ? "That is outside this exercise’s current step; it does not mean the action is always illegal. Check the goal, or open Help for a clue before revealing the next move." : "This guided example is following a particular plan. That action is outside this step; this is an exercise restriction, not a new game rule. Read the current goal or open Help."};
  }
  if (current.keywordScenarioId && keywordPositionSignature(state.board) !== keywordPositionSignature(canonicalKeywordPosition(state.lessonId,state.stepIndex))) return { ...state, feedback: "This practice position has changed. Restart this example before making the highlighted move." };
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
  b.log=[`Separate ${id} teaching position. Earlier unit play effects have finished. Optional legend abilities are not used. Complete teaching lists are available from the main decks.`];return b;
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
    b.log.push("You regain control. You already scored this battlefield this turn: no new conquer, no point and no conquer trigger.");return;
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
    for(const c of b.cards){if(c.type==="unit"&&b.combat)c.damage=0;if(c.type==="gear"&&!c.attachedTo&&c.zone.startsWith("battlefield")){c.zone="base";c.annotation="Unattached Equipment recalled to base during cleanup; readiness is unchanged.";}}
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
function foundationResponses(prefix:string,operation?:string):TutorialStep[]{return [pass(`${prefix}-pass`,"Your newest effect is waiting on the chain. Pass priority so the guide can respond before its instructions happen; this does not end your turn."),guide(`${prefix}-guide-pass`,"The guide passes too","The guide adds nothing to the chain and passes. Both players have now had a chance to respond, so the newest waiting effect can happen.",{type:"pass",side:"opponent"},["chain"]),foundationStep(`${prefix}-resolve`,"Resolve the waiting effect","Both players passed. Carry out the newest effect now, then check the changed board. An older item, if any, still gets its own response window.",{type:"resolve"},operation)];}
function foundationCombat(prefix:string,sourceIds:string[],targetAssignments:Array<{cardId:string;amount:number;order:number}>,returnAssignments:Array<{cardId:string;amount:number;order:number}>):TutorialStep[]{
 const demonstration={sourceIds,targetAssignments,returnAssignments,explanation:"Each side assigns its total current Might. Assigned damage is not yet dealt; both sides will deal it simultaneously."};
 return [{...foundationRule(`${prefix}-assign`,"Assign both sides’ damage",demonstration.explanation,"assign"),combatDemonstration:demonstration},{...foundationStep(`${prefix}-damage`,"Deal combat damage together","Resolve combat damage. Both sides deal their full assigned amount, including units that will die in the exchange. Damage is marked separately from Might.",{type:"resolve"},"damage"),combatDemonstration:demonstration}];
}
function foundationCleanup(id="cleanup"):TutorialStep{return foundationRule(id,id.includes("bounce")?"Check the board after the return":"Cleanup heals the survivors",id.includes("bounce")?"The return spell and its chain have finished. Ordinary cleanup recalls unattached Equipment from a battlefield to its controller’s base, without readying it. A player with no unit left there loses control. This ordinary cleanup does not heal damage.":"Lethal units have left the board. Combat’s special cleanup heals all units: remove marked damage, without reducing their Might. Unattached Equipment left at a battlefield is recalled to its controller’s base; it keeps its readiness.","cleanup");}
function foundationReset(id:string,title:string,text:string,variant:string):TutorialStep{return {...continueStep(id,text),title,presentation:"lesson-intro",lessonIntro:{see:"A separate prepared position; the previous example has finished.",do:text,why:"Resetting lets you compare the rule without pretending the previous result was undone in a real game."},label:"Start this separate example",rulesEffect:foundationEffect(`reset:${variant}`)};}
function foundationBounce(prefix:string,unitId:string):TutorialStep[]{return [
 guide(`${prefix}-energy`,"The guide prepares 3 energy","The guide taps three ready runes together to make Star-Crossed’s 3 energy cost. The spell also needs Chaos power.",{type:"exhaust-runes",cardIds:["o-rune-1","o-rune-2","o-rune-3"]},["o-rune-1","o-rune-2","o-rune-3"]),
 guide(`${prefix}-power`,"Recycle for the Chaos symbol","The guide recycles its exhausted Chaos rune for 1 Chaos power. Its 3 energy stays available, so both costs can now be paid.",foundationEffect("bounce-power"),["o-rune-1"]),
 guide(`${prefix}-play`,"Return one unit from each side","The guide pays 3 energy and 1 Chaos power for Star-Crossed. It chooses its friendly Mystic Poro and your unit. These are the spell’s two required targets; neither returns to hand until it resolves.",foundationEffect("bounce-play"),["o-star-crossed","o-mystic-poro",unitId]),
 guide(`${prefix}-guide-pass`,"You may respond","The guide passes priority on Star-Crossed. You now have a chance to add a Reaction before the two units return to hand.",{type:"pass",side:"opponent"},["chain"]),pass(`${prefix}-pass`,"Pass priority to let this response happen. Returning a unit to hand is not killing it, and any attached Equipment is a separate card."),
 guide(`${prefix}-resolve`,"Both units return to hand","Both players passed. Star-Crossed returns its two chosen units to their owners’ hands. Equipment detaches at the bearer’s former location; it is not returned with that unit. The spell then goes to the trash.",foundationEffect("bounce-resolve"),[unitId,"o-mystic-poro","p-gear"])
];}
function createFoundationLessons():TutorialLesson[]{
 const scoring=addedLesson("scoring-once-per-turn","One battlefield, one score per turn",{
  see:"A separate position just after Awaken: Keeper is ready on the left battlefield, with two other ready units in base.",
  do:"Score for holding, leave and regain control, then use the other battlefield. Watch what resets when the turn changes.",
  why:"Holding and conquering share one scoring allowance for each battlefield, for each player, in each turn. Counting it correctly stops accidental extra points."
 },[
  inspect("battlefield-left","Start with this battlefield","You kept Keeper here through the guide’s previous turn. Awaken has already readied your cards; we are now in Beginning. Click the left battlefield: you control it and have not scored it this turn."),
  foundationStep("limit-first-hold","Take the holding point","Confirm holding the left battlefield. Your score rises from 1 to 2. This uses your score for this battlefield for the whole current turn, including Main.",{type:"score"},"scoring-hold-left"),
  foundationQuestion("limit-same-turn","Does Main give another score?","You scored the left battlefield by holding it. Later in this same turn, you lose it and regain control. Would that give another point?","No. I already scored this battlefield this turn.","Holding and conquering use the same allowance. A new phase, a different unit or a change of control does not reset it.","Yes. Holding and conquering each give a point.","They are two ways to score, not two separate allowances. The same battlefield can score for you only once in the same turn."),
  foundationStep("limit-beginning","Finish Beginning","You have scored the only battlefield you control. Choose Check Beginning to finish that phase. Its scored marker stays as we move towards Main.",{type:"check-beginning"}),
  foundationStep("limit-channel","Channel your runes","Channel two runes yourself. They give you resources for later choices; getting resources does not refresh a battlefield’s score.",{type:"channel",ready:true}),
  foundationStep("limit-draw","Draw before Main","Draw one card. Main then begins, where you can make plays and moves. Your holding point still belongs to this same turn.",{type:"draw"}),
  foundationStep("limit-leave","Leave to test the rule","Move Keeper from the left battlefield back to base. It is ready, so it can exhaust to make this normal move. We are deliberately leaving the battlefield empty to see whether leaving resets its score.",{type:"move",cardId:"p-one",destination:"base"}),
  {...inspect("battlefield-left","Control changed; the marker stays","Click the empty left battlefield. With no unit left there, you lost control. Your scored marker stays: it belongs to the battlefield and player, not the unit."),id:"limit-inspect-empty"},
  foundationStep("limit-return","Send a different ready unit","Move Elder from base to the empty left battlefield. Elder exhausts to move. A different unit can help you regain control, but cannot give this battlefield a second score in the same turn.",{type:"move",cardId:"p-two",destination:"battlefield-left"}),
  pass("limit-pass","Pass focus to offer the guide its response chance. A showdown still happens when you enter an uncontrolled battlefield, even if you cannot score it again."),
  guide("limit-guide-pass","The guide adds nothing","The guide passes too. Both players have finished this showdown. Your Elder is the only unit there, so you will regain control.",{type:"pass",side:"opponent"},["battlefield-left"]),
  foundationRule("limit-regain-control","Control again, without another point","You regain control. Your score stays at 2 because you already scored this battlefield this turn. This is not a new conquer, so it does not start conquer abilities either.","scoring-claim-only"),
  foundationQuestion("limit-opponent","Does your score use the guide’s allowance?","Your marker says you scored the left battlefield this turn. If the guide legally gains control later in this same turn, and has not scored it yet, may it score?","Yes. Each player has their own allowance.","Your marker belongs to you. The guide checks its own marker; your point does not lock the battlefield against the opponent.","No. Only one player may score it during a turn.","The limit is once per player, per battlefield, per turn. Each player checks their own record."),
  foundationQuestion("limit-other-choice","Where can your remaining ready unit help?","You have scored the left battlefield. The right is empty and you have not scored it. Can Pickpocket help you score there this turn?","Yes. The other battlefield has its own allowance.","The limit is not one point for your whole turn. Each of this duel’s two battlefields can score for you once per turn.","No. Scoring once ends all scoring for my turn.","Check each battlefield separately. You have used the left battlefield’s score, but not the right battlefield’s."),
  foundationStep("limit-other-move","Use the other battlefield","Move your ready Pickpocket from base to the empty right battlefield. It has its own scoring record, so this move can work towards another point this turn.",{type:"move",cardId:"p-three",destination:"battlefield-right"}),
  pass("limit-other-pass","Pass focus so the guide has a response chance before you claim the other battlefield. Its empty scored marker does not skip the showdown."),
  guide("limit-other-guide-pass","The showdown finishes","The guide adds nothing and passes. Pickpocket remains alone at the right battlefield. You have not scored this one yet this turn.",{type:"pass",side:"opponent"},["battlefield-right"]),
  foundationStep("limit-other-score","Conquer the unscored battlefield","Confirm conquering the right battlefield. Your score goes from 2 to 3: one point from holding the left, and one from conquering the right. Both have now scored for you this turn.",{type:"score"},"scoring-other"),
  foundationStep("limit-end-turn","A new turn resets both records","End your turn. As the guide’s turn starts, every battlefield’s scored markers reset for both players. This reset gives no points by itself and does not ready your cards.",{type:"end-turn"}),
  guide("limit-guide-awaken","The guide readies its own cards","The guide’s Awaken readies its own runes. Your units remain exhausted on their battlefields, keeping control while they are there.",{type:"ready",side:"opponent"},["opponent:runes"]),
  guide("limit-guide-beginning","The guide has nothing to hold","The guide controls no battlefield, so it gets no holding point in Beginning. An unscored marker means the allowance is unused; it does not mean a free point.",{type:"phase",phase:"Channel",priority:"opponent"},["battlefield-left","battlefield-right"]),
  guide("limit-guide-channel","The guide channels","The guide channels two runes ready. We keep its turn simple so you can follow the scoring records across a turn change.",{type:"channel",side:"opponent",count:2},["opponent:rune-deck"]),
  guide("limit-guide-draw","The guide draws","The guide draws one card. It chooses not to contest either battlefield here. A real opponent may try to take one away before your next Beginning.",{type:"draw",side:"opponent",count:1},["opponent:deck"]),
  guide("limit-guide-end","Your next turn begins","The guide ends its turn. The scored records reset for both players again. Your next step is Awaken; you have not earned holding points yet.",{type:"start-turn",side:"player"},["battlefield-left","battlefield-right"]),
  foundationStep("limit-next-awaken","Ready your own cards","Choose Awaken to ready your units and runes. Your units stay on their battlefields. Now Beginning can check whether you still control them.",{type:"ready"}),
  foundationStep("limit-next-hold-left","The left can score again now","Hold the left battlefield in this new turn’s Beginning. Your score goes from 3 to 4. The old marker expired; you did not need to leave and return to score again.",{type:"score"},"scoring-hold-left"),
  foundationStep("limit-next-hold-right","Check the right separately","Hold the right battlefield too, going from 4 to 5. Both have now scored for you in this new turn. Two holding points are allowed because they came from two different battlefields.",{type:"score"},"scoring-hold-right"),
  continueStep("limit-complete","Check three things before a point: which battlefield, which player, and which turn? Holding and conquering share that battlefield’s allowance. Leaving, changing units or regaining control does not refresh it. Each new turn clears both players’ records; the other battlefield has its own record.")
 ],"first-game");

 const group=addedLesson("group-movement","Move units together",{see:"Two ready units in your base and a 4-Might defender at the left battlefield.",do:"Compare one weak attack with moving both units together in one action.",why:"A group arrives together, so all its units participate in the same showdown and combat."},[
  foundationQuestion("group-predict","Would one unit be enough?","Pickpocket has 3 Might; the enemy Elder has 4. What would a lone Pickpocket achieve here?","It would die without killing Elder.","Three damage is not enough to kill a 4-Might unit.","It would defeat Elder because it moves first.","Moving first does not give first damage; normal combat damage is simultaneous."),
  {...foundationStep("group-move","Send both units in one move","Select Pickpocket and Clockwork Keeper, then choose the left battlefield. Both must be ready and pay their own exhaust cost. They move simultaneously to one destination; this is one action, not two separate attacks.",{type:"move-units",cardIds:["p-one","p-two"],destination:"battlefield-left"}),allowedCardIds:["p-one","p-two"],allowedDestinations:["battlefield-left"]},
  pass("group-pass","Both units arrived in the same showdown. Pass focus to give the guide its chance; every unit here will participate if combat proceeds."),guide("group-guide-pass","The guide accepts the fight","The guide passes focus too. Your units have 3 + 2 = 5 Might together against Elder’s 4. Each will deal its part of that total.",{type:"pass",side:"opponent"}),
  ...foundationCombat("group",["p-one","p-two"],[{cardId:"o-one",amount:5,order:1}],[{cardId:"p-one",amount:3,order:1},{cardId:"p-two",amount:1,order:2}]),
  continueStep("group-result","Both attackers contributed. Pickpocket and Elder died; Keeper survived with 1 damage marked. The guide assigned lethal to Pickpocket first, then the remaining 1 to Keeper. Sending the group made a surviving unit possible."),foundationCleanup("group-cleanup"),
  foundationStep("group-score","The surviving unit conquers","Keeper remains after cleanup and the defender is gone. Confirm conquering to gain control and score. The group move created one showdown and one opportunity to score this battlefield.",{type:"score"},"score"),continueStep("group-complete","You exhausted two ready units, moved them together and used their combined Might. A group needs one destination, but each unit must still have a legal route and be able to pay its move cost.")
 ],"first-game");
 const damage=addedLesson("damage-and-might","Damage is not lost Might",{see:"A ready 4-Might Elder and a 3-Might enemy Pickpocket.",do:"Resolve a fight, inspect the survivor’s damage and predict what cleanup removes.",why:"Damage marks how close a unit is to dying; it does not subtract from the Might it contributes."},[
  foundationStep("damage-move","Attack with the stronger unit","Move your ready Elder to the left battlefield. Its printed 4 Might exceeds Pickpocket’s 3. Neither has a relevant combat trigger in this prepared position.",{type:"move",cardId:"p-one",destination:"battlefield-left"}),pass("damage-pass"),guide("damage-guide-pass","Both sides let combat happen","The guide passes. Elder will deal 4 and take 3 at the same time; Pickpocket still deals its damage even though it will die.",{type:"pass",side:"opponent"}),...foundationCombat("damage",["p-one"],[{cardId:"o-one",amount:4,order:1}],[{cardId:"p-one",amount:3,order:1}]),
  inspect("p-one","Read Might and damage separately","Elder has 4 Might and 3 damage marked. The damage did not turn it into a 1-Might unit. It survives because the marked damage is below its current Might."),
  foundationQuestion("damage-test","How strong is this damaged Elder?","Before cleanup, Elder shows 4 Might and 3 damage. How much combat damage would its Might contribute?","4 damage.","Its current Might is still 4; marked damage is a separate number.","1 damage.","Subtracting damage from Might treats it like a remaining-health value. Riftbound keeps those values separate."),foundationCleanup("damage-cleanup"),
  continueStep("damage-healed","Cleanup removed the 3 damage. Elder is still 4 Might: healing removes damage, it does not add Might. Lethal damage would have killed the unit before this healing step."),foundationStep("damage-score","Finish conquering","Your surviving Elder can now conquer the cleared battlefield. Confirm its point after the response and damage steps have finished.",{type:"score"},"score")
 ],"first-game");
 const buffs=addedLesson("buffs-and-bonuses","Three different ways to gain Might",{see:"Pickpocket, three support cards and their prepared resources in a separate position.",do:"Add a real Buff counter, temporary Might and Equipment; then spend only the real counter at Monastery.",why:"An increase in Might is not automatically a Buff counter that another card can spend."},[
  foundationStep("buff-source","Play the card that grants a Buff","The prepared pool covers this exercise: 5 energy, 1 Calm power and 1 Mind power, with those used runes visible. Spend 2 energy and 1 Calm power on Spirit’s Refuge. The gear enters your base immediately; its separate play ability will grant a real Buff counter.",{type:"play",cardId:"p-refuge",destination:"base"},"play-gear"),
  foundationStep("buff-target","Choose who gets the counter","Click Pickpocket for Refuge’s play ability. A Buff is a physical +1 Might counter, normally with at most one on a unit. Choosing the recipient does not give it the counter until the ability resolves.",{type:"choose-trigger",cardId:"p-refuge",targetId:"p-one"}),foundationRule("buff-trigger","The Buff ability waits","You chose Pickpocket. Refuge’s play ability now joins the chain. Both players can respond before the counter appears. Refuge also gives buffed friendly units Deflect; no enemy targeting is used in this example.","buff-trigger"),...foundationResponses("buff","buff-resolve"),
  inspect("p-one","A real Buff counter","Pickpocket went from printed 3 to 4 Might. The visible +1 Buff counter is the reason, and it stays past the end of the turn unless spent or otherwise removed. Another Buff would not add a second counter."),
  foundationStep("buff-discipline","Add a different kind of increase","Spend 2 energy on Discipline targeting Pickpocket. Its +2 Might lasts for this turn; the card does not say Buff, so it does not add a second counter.",{type:"play",cardId:"p-discipline",targetId:"p-one"}),...foundationResponses("buff-discipline","resolve-response"),
  foundationStep("buff-gear","Play Equipment separately","Spend the remaining 1 energy on Experimental Hexplate. It enters your base; merely playing Equipment does not attach it. Its Equip ability costs 1 Mind power.",{type:"play",cardId:"p-gear",destination:"base"},"play-gear"),
  foundationStep("buff-equip","Attach the Equipment","Activate Hexplate and choose Pickpocket. Spend 1 Mind power on Equip; the attachment waits on the chain. The Equipment will supply +1 Might while attached, not a Buff counter.",{type:"activate",cardId:"p-gear",targetId:"p-one"},"equip"),...foundationResponses("buff-equip","equip-resolve"),
  foundationQuestion("buff-test","How many Buff counters are here?","Pickpocket now has 7 Might: printed 3 + real Buff 1 + Discipline 2 + Hexplate 1. How many Buff counters can it spend?","One real Buff counter.","Only the physical +1 Buff is a counter. The spell and Equipment provide different increases.","Four counters, one for every extra Might.","Extra Might is not interchangeable with Buff counters; read the effect that produced it."),
  foundationStep("buff-move","Bring the counter to Monastery","Move the ready Pickpocket to the empty left battlefield. Its attached Hexplate moves with it. We will conquer Monastery to see a rule that spends the actual Buff counter.",{type:"move",cardId:"p-one",destination:"battlefield-left"}),pass("buff-showdown-pass"),guide("buff-showdown-guide-pass","The guide leaves the battlefield alone","The guide passes. Pickpocket is alone, so the showdown can finish and Monastery can be conquered.",{type:"pass",side:"opponent"}),foundationStep("buff-score","Conquer before using its ability","Confirm conquering and score the point. Monastery’s conquer ability offers to spend a Buff for a draw. That optional cost is paid as the trigger is finalised, before anyone responds.",{type:"score"},"buff-conquer"),
  foundationStep("buff-spend","Spend the actual counter","Click Pickpocket to pay Monastery’s optional Buff cost. The physical counter is removed now: 7 Might becomes 6. Discipline’s +2 and Hexplate’s +1 stay. The paid draw ability then goes on the chain; drawing is not immediate.",{type:"spend-buff",cardId:"p-one"},"buff-spend"),...foundationResponses("monastery","monastery-resolve"),
  continueStep("buff-after-spend","The counter is gone and you drew one card. Pickpocket is still 6 Might from printed 3, Discipline’s temporary 2 and Hexplate’s attached 1. The spent counter is not refunded by the response window."),
  foundationStep("buff-end","Watch only the temporary effect expire","End your turn. Discipline’s +2 expires at the end of the turn; the attached Equipment stays. The real Buff was already spent, so there is no counter to remove now.",{type:"end-turn"}),continueStep("buff-complete","Pickpocket is now 4 Might: printed 3 plus Hexplate’s 1. A real Buff, a this-turn increase and Equipment each follow their own rules; their numbers are not interchangeable.")
 ],"practice");
 const equipment=addedLesson("equipment-lifecycle","Equipment after its unit leaves",{see:"A Rearguard carrying Long Sword, another Rearguard in base and an equal 4-Might defender.",do:"Trade the equipped unit, reuse its sword, then reset and return the bearer to hand.",why:"Equipment is a separate card. It detaches when its bearer leaves the board, so it can be used again."},[
  foundationStep("gear-move","A deliberate even trade","Move your equipped 4-Might Rearguard into the enemy 4-Might Hopeful. Both will die if neither side responds. This deliberate trade removes the defender while letting us follow the separate Equipment card.",{type:"move",cardId:"p-one",destination:"battlefield-left"}),pass("gear-pass"),guide("gear-guide-pass","The guide accepts the trade","The guide passes. Neither unit has a relevant combat trigger here, so both will deal 4 damage together.",{type:"pass",side:"opponent"}),...foundationCombat("gear",["p-one"],[{cardId:"o-one",amount:4,order:1}],[{cardId:"p-one",amount:4,order:1}]),foundationCleanup("gear-cleanup"),
  inspect("p-gear","The sword survived","Long Sword detached when Rearguard died. It was left at the battlefield, then recalled to your base by cleanup because it was unattached. It was not killed with its bearer, and its readiness did not change."),exhaust(1,"pay the sword’s Equip cost"),foundationStep("gear-power","Make the matching Equip power","Recycle that exhausted Fury rune for 1 Fury power. The energy you already made stays available; Equip needs the power symbol here, not energy.",{type:"recycle",cardId:"p-rune-1"}),
  foundationStep("gear-reattach","Give the surviving gear a new bearer","Activate Long Sword and choose your other Rearguard in base. Spend 1 Fury power on Equip. The gear stays unattached until this ability resolves.",{type:"activate",cardId:"p-gear",targetId:"p-two"},"equip"),...foundationResponses("gear-reattach","equip-resolve"),continueStep("gear-reused","The other Rearguard is now 4 Might and carries the same Long Sword. You did not redraw or replay the gear; you paid its Equip ability to reuse it."),
  foundationReset("gear-reset","Reset: return the bearer to hand","The sword is attached at your battlefield in this separate position. The guide will use Star-Crossed to return the bearer to hand.","bounce"),...foundationBounce("gear-bounce","p-one"),foundationCleanup("gear-bounce-cleanup"),continueStep("gear-bounce-result","Rearguard is in your hand, but Long Sword is unattached in your base. Returning the bearer to hand detached the gear, just as leaving for the trash did. A recall that only moves a unit to base keeps it on the board and is different: attached gear follows it still attached.")
 ],"practice");
 const champions=addedLesson("champion-destinations","Where champions go",{see:"Your chosen Viktor already in play, exhausted at a battlefield, with another copy in hand.",do:"Follow it to the trash, reset for a return to hand, then play two paid copies together.",why:"Chosen is a setup role, not a rule that returns a defeated champion to its zone or limits the board to one copy."},[
  guide("champion-attack","The guide attacks the exhausted champion","In this prepared position, your chosen Viktor was played earlier and is exhausted. The guide moves its ready 4-Might Elder in to challenge him. Viktor cannot make a normal move now, but still defends with his full 3 Might.",{type:"move",cardId:"o-one",destination:"battlefield-left"},["o-one","p-champion"]),guide("champion-guide-pass","The guide passes focus","The guide offers you a response. No response is available in this authored example; an exhausted unit still participates in combat.",{type:"pass",side:"opponent"}),pass("champion-pass","Pass focus. Viktor deals his 3 Might despite being exhausted, while Elder’s 4 will be enough to kill him. Being a chosen champion does not protect him from normal lethal damage."),...foundationCombat("champion",["p-champion"],[{cardId:"o-one",amount:3,order:1}],[{cardId:"p-champion",amount:4,order:1}]),foundationCleanup("champion-cleanup"),guide("champion-guide-score","The guide conquers after the fight","Elder survived and your champion is gone, so the guide conquers and scores. Your champion zone stays empty: a killed champion goes to the trash like another non-token unit.",{type:"score",side:"opponent",battlefieldId:"battlefield-left"}),inspect("p-champion","Chosen does not mean respawning","Your chosen Viktor is in the trash, not back in its champion zone. That zone gave you access to one chosen card at setup; it is not a respawn space or an extra supply of copies."),
  foundationReset("champion-reset","Reset: return a champion to hand","In this separate position Viktor is back on the battlefield. Star-Crossed will return him to hand, showing that a return effect follows its stated destination.","bounce"),...foundationBounce("champion-bounce","p-champion"),foundationCleanup("champion-bounce-cleanup"),continueStep("champion-returned","Viktor is now in your hand, not in the champion zone. To play him again you must pay his normal costs and follow normal timing. Returning him did not create a new copy."),
  foundationReset("champion-copies","Reset: two copies can be in play","This separate own-turn position has two real Viktor copies in hand and their full 8 energy plus 2 Mind power prepared. The complete teaching deck contains three copies, including the chosen card.","copies"),foundationStep("champion-replay","Pay to replay the returned card","Play the returned Viktor from your hand into base for 4 energy and 1 Mind power. It enters exhausted. The champion zone remains empty because this play came from your hand.",{type:"play",cardId:"p-champion",destination:"base"}),foundationStep("champion-second-copy","Pay for the other copy too","Play the second Viktor for another 4 energy and 1 Mind power. Champion status does not impose a one-on-board rule. This card has no Unique restriction, and the deck’s ordinary copy limit still applies.",{type:"play",cardId:"p-copy",destination:"base"}),continueStep("champion-two","Both paid copies are now exhausted in your base. Neither replaces the other or refills the champion zone. Unique is a deckbuilding restriction, not an on-board copy limit. Champion status itself does not restrict the board to one copy.")
 ],"practice");
 const ready=addedLesson("ready-runes-and-defenders","Save runes, and defend while exhausted",{see:"An exhausted Keeper defending your battlefield, four ready runes and Discipline in hand.",do:"Compare unused floating resources with ready runes, then defend and ready on your next turn.",why:"Floating resources expire; ready runes remain usable. Exhaustion restricts moves and costs, not a unit’s combat contribution."},[
  exhaust(1,"see what an unused resource pool does at turn end"),foundationStep("reserve-power","Make power as well","Recycle that exhausted Calm rune for 1 Calm power. The 1 energy remains floating too. We deliberately will not spend either pool, so you can see their expiry; the other three runes remain ready.",{type:"recycle",cardId:"p-rune-1"}),foundationStep("reserve-end","End with the pools unused","End your turn. You lose the unspent 1 energy and 1 Calm power. Your other runes do not disappear or exhaust just because you ended the turn, and Keeper stays exhausted until your own Awaken.",{type:"end-turn"}),continueStep("reserve-expired","You still have three ready runes. Both players also lose unspent energy and power when Main begins. Wait until you want to play a Reaction, then exhaust the runes to pay for it."),
  guide("reserve-guide-awaken","Only the guide readies now","The guide’s Awaken readies its own cards, not yours. Your Keeper remains sideways and your saved ready runes remain available.",{type:"ready",side:"opponent"}),guide("reserve-guide-begin","Check the guide’s Beginning","The guide controls no battlefield here and has no Beginning effect, so it has no holding point to record.",{type:"phase",phase:"Channel",priority:"opponent"}),guide("reserve-guide-channel","The guide channels","The guide brings out two ready runes for this turn.",{type:"channel",side:"opponent",count:2}),guide("reserve-guide-draw","The guide draws, then reaches Main","The guide draws a card. Main begins and any earlier floating pools empty; its ready runes are still on the table.",{type:"draw",side:"opponent",count:1}),guide("reserve-attack","The guide challenges your exhausted defender","The guide moves its 3-Might Pickpocket onto your Keeper’s battlefield. Keeper is exhausted but still defends with 2 Might. Exhaustion does not switch off combat damage.",{type:"move",cardId:"o-one",destination:"battlefield-left"}),guide("reserve-guide-focus","You can use your saved runes","The guide passes focus. Your floating resources expired, but your ready runes can now pay for Discipline to help Keeper survive.",{type:"pass",side:"opponent"}),
  exhaust(2,"strengthen the exhausted defender with Discipline"),exhaust(3,"finish Discipline’s 2-energy cost"),foundationStep("reserve-discipline","Help the defender now","Spend 2 energy on Discipline targeting Keeper. Its +2 Might can make the exhausted defender 4 against the attacker’s 3, but the increase waits for resolution.",{type:"play",cardId:"p-discipline",targetId:"p-one"}),...foundationResponses("reserve-discipline","resolve-response"),guide("reserve-return-focus","The guide passes focus again","Your spell finished, so this card-started showdown chain passes focus to the guide. It adds nothing and passes back to you.",{type:"pass",side:"opponent"}),pass("reserve-combat-pass","Pass focus too. Keeper is still exhausted, but its current 4 Might contributes fully to this fight."),...foundationCombat("reserve",["p-one"],[{cardId:"o-one",amount:4,order:1}],[{cardId:"p-one",amount:3,order:1}]),foundationCleanup("reserve-cleanup"),continueStep("reserve-defended","Keeper survived, healed its 3 damage and retained control. A successful defence does not immediately score a holding point. One saved rune is still ready; the two used for Discipline are exhausted."),guide("reserve-guide-end","The guide ends its turn","The guide ends its turn. Discipline’s temporary +2 expires, and all unused resource pools empty. Your own Awaken comes next.",{type:"start-turn",side:"player"}),foundationStep("reserve-awaken","Your own cards ready now","Choose Awaken to ready Keeper and your exhausted runes. The rune recycled for power remains in the rune deck. Next would be Beginning’s holding check; this example stops at the readiness comparison.",{type:"ready"}),continueStep("reserve-complete","Your unit and used runes readied only at your own Awaken. The rune you recycled is still absent. Saving a ready rune and saving an unspent floating resource are different decisions.")
 ],"first-game");
 const passing=addedLesson("passing-decisions","Which kind of pass?",{see:"An open combat showdown: your Keeper is weaker than the enemy, and no chain item is waiting.",do:"Start a chain with a Reaction, then distinguish passing priority, passing focus and ending the turn.",why:"Passing gives up a particular chance to act. It does not always mean the whole turn is finished."},[
  foundationQuestion("reaction-start","Does Reaction need an existing spell?","Discipline is a Reaction, but the chain is empty. Can you play it in this open showdown?","Yes: a Reaction can start a chain.","Reaction permission includes open showdowns as well as responding to a waiting item.","No: it can only answer another spell.","Reaction is a timing permission, not a requirement that someone else already played a spell."),exhaust(1,"strengthen Keeper before combat"),exhaust(2,"pay Discipline’s full energy cost"),foundationStep("passing-play","Start the response chain yourself","Play Discipline targeting Keeper. It starts a new chain in the showdown; you did not need an opposing spell to react to. Keeper remains 2 Might until the spell resolves.",{type:"play",cardId:"p-discipline",targetId:"p-one"}),
  foundationQuestion("priority-question","What does passing priority mean here?","Your Discipline is on the chain. What are you giving up by passing now?","My current chance to add another response.","The opponent gets a response chance; your turn and the showdown are not over.","My whole turn, including this fight.","Passing priority is only about this response window. End Turn is a separate action."),...foundationResponses("passing-spell","resolve-response"),guide("passing-return-focus","The guide passes focus","The spell resolved and the chain is empty. Focus passes to the guide in this showdown. It adds nothing and passes back.",{type:"pass",side:"opponent"}),foundationQuestion("focus-question","The chain is empty now","The guide has passed focus. What does your next Pass Focus do?","Finish both players’ chances in this showdown.","With both passing and no waiting chain, the fight can proceed to damage.","End my turn immediately.","This is the showdown’s focus window, not the End Turn control."),pass("passing-focus","Pass focus to finish this showdown. Keeper is now 4 Might; both sides are done adding plays before damage."),...foundationCombat("passing",["p-one"],[{cardId:"o-one",amount:4,order:1}],[{cardId:"p-one",amount:3,order:1}]),foundationCleanup("passing-cleanup"),foundationStep("passing-score","Conquer before considering the turn finished","Confirm conquering after your unit survived. Main can continue after this battlefield’s result; finishing a showdown did not automatically end your turn.",{type:"score"},"score"),foundationQuestion("end-question","Which control ends the whole turn?","The chain and combat are finished, and you have completed this example’s plan. Which action hands the turn to the guide?","End Turn.","End Turn moves to the opponent’s Awaken after the normal end-of-turn checks.","Pass priority on the empty chain.","There is no waiting chain to pass priority on. Use the separate End Turn action."),foundationStep("passing-end","Now end the turn","Choose End Turn now that the response chain, combat and score have finished. Temporary effects and unused resource pools expire as the turn ends.",{type:"end-turn"}),continueStep("passing-complete","Pass priority handled an effect on the chain. Pass focus handled the open showdown. End Turn handed over the whole turn. The same words never let you skip a pending effect or combat.")
 ],"practice");
 return [scoring,group,damage,ready,buffs,equipment,champions,passing];
}
