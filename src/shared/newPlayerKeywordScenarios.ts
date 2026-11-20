/** Independent Atlas-board positions checked against current official rules and artwork. */
import type { TutorialAction, TutorialBattlefieldId, TutorialBoard, TutorialDomain, TutorialSide, TutorialStep } from "./newPlayerTutorial.js";
export interface KeywordScenarioCard {
  instanceId: string;
  cardId: string;
  name: string;
  imageUrl: string;
  zone: string;
  owner: 'player' | 'opponent';
  ready: boolean;
  type?: 'unit' | 'spell' | 'gear' | 'rune' | 'legend';
  might?: number;
  damage?: number;
  text?: string;
  annotation?: string;
  domains?: TutorialDomain[];
  energyCost?: number;
  powerCost?: number;
  baseMight?: number;
  keywords?: string[];
  attachedTo?: string;
  empowered?: boolean;
  faceDown?: boolean;
  hiddenAt?: TutorialBattlefieldId;
  token?: boolean;
}

export interface KeywordScenarioPlayer {
  energy?: number;
  power?: number;
  score?: number;
  handCount?: number;
  xp?: number;
}

export interface KeywordScenarioSnapshot {
  cards: KeywordScenarioCard[];
  player: KeywordScenarioPlayer;
  opponent?: KeywordScenarioPlayer;
  note?: string;
}

export interface KeywordScenario {
  id: string;
  keyword: string;
  definition?: string;
  groupId: string;
  title: string;
  instruction: string;
  actionLabel: string;
  before: KeywordScenarioSnapshot;
  after: KeywordScenarioSnapshot;
  explanation: string;
  rulesReference: string;
  boardAction?: TutorialAction;
  board?: KeywordBoardContext;
  combatDemonstration?: TutorialStep["combatDemonstration"];
  /** The practical reason for this separate, fully playable position. */
  objective?: { goal: string; without: string; with: string };
  followThrough?: {
    move?: { cardId: string; destination: TutorialBattlefieldId };
    waitForNextTurn?: boolean;
    combat?: NonNullable<TutorialStep["combatDemonstration"]>;
    deathknells?: string[];
    conquer?: TutorialBattlefieldId;
  };
}

export interface KeywordBoardPosition {
  phase: string;
  turnPlayer: TutorialSide;
  priority: TutorialSide | null;
  controllers: [TutorialSide | null, TutorialSide | null];
  chain: TutorialBoard["chain"];
  combat: TutorialBoard["combat"];
  scoredBy?: Partial<Record<TutorialBattlefieldId, TutorialSide[]>>;
  opponentRuneCount?: number;
  opponentRunesReady?: boolean;
}
export interface KeywordBoardContext {
  playerLegendId: string;
  opponentLegendId: string;
  powerDomain: TutorialDomain;
  runeCount: number;
  before: KeywordBoardPosition;
  after: KeywordBoardPosition;
}
export interface KeywordLegendPair {
  domains: TutorialDomain[];
  legend: KeywordScenarioCard;
  champion: KeywordScenarioCard;
}

export interface KeywordScenarioGroup {
  id: string;
  title: string;
  description: string;
  minutes: number;
  scenarioIds: string[];
}

export const OFFICIAL_KEYWORDS: string[] = [
  'Accelerate', 'Action', 'Assault', 'Deathknell', 'Deflect', 'Ganking', 'Hidden',
  'Legion', 'Reaction', 'Shield', 'Tank', 'Temporary', 'Vision', 'Equip', 'Quick-Draw',
  'Repeat', 'Weaponmaster', 'Ambush', 'Hunt', 'Level', 'Unique', 'Backline', 'Empower',
  'Empowered', 'Flow', 'Deploy', 'Disarm', 'Show Off',
];

const CARDS: Record<string, Partial<KeywordScenarioCard> & Pick<KeywordScenarioCard, "name" | "imageUrl">> = {
  "OGN-045": {
    name: "Defy",
    imageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/4989bfcc4bd7be77051f0c2c349a981ba9c273e0-744x1039.png?accountingTag=RB",
    type: "spell", domains: ["Calm"], energyCost: 1, powerCost: 1,
    text: "Reaction. Counter a spell that costs no more than 4 energy and 1 power.",
    keywords: ["Reaction"]
  },
  "OGN-010": {
    "name": "Legion Rearguard",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/aedece01c7792c689050460db1670e6b9b15b61f-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Fury"
    ],
    "energyCost": 2,
    "powerCost": 0,
    "baseMight": 2,
    "text": "Accelerate: pay 1 extra energy and 1 Fury power while playing this unit to have it enter ready.",
    "keywords": [
      "Accelerate"
    ]
  },
  "OGN-004": {
    "name": "Cleave",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/95d476a1e88ff547fb846149619177bc7e3cea9f-744x1039.png?accountingTag=RB",
    "type": "spell",
    "domains": [
      "Fury"
    ],
    "energyCost": 1,
    "powerCost": 0,
    "baseMight": 0,
    "text": "Action. Give a unit Assault 3 for this turn.",
    "keywords": [
      "Action"
    ]
  },
  "OGN-215": {
    "name": "Petty Officer",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/29e062c4a38c0be12056568a2f8563557e2611c6-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Order"
    ],
    "energyCost": 5,
    "powerCost": 0,
    "baseMight": 5,
    "text": "Assault: +1 Might while attacking.",
    "keywords": [
      "Assault"
    ]
  },
  "OGN-096": {
    "name": "Watchful Sentry",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/d84da2c62b1e218a0a74b227c49ce8a953918ebd-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Mind"
    ],
    "energyCost": 2,
    "powerCost": 0,
    "baseMight": 1,
    "text": "Deathknell: draw 1 when this unit dies.",
    "keywords": [
      "Deathknell"
    ]
  },
  "OGN-013": {
    "name": "Pouty Poro",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/d541bf3bcb5aa3ad0d48d87f5753569b72ac426f-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Fury"
    ],
    "energyCost": 2,
    "powerCost": 0,
    "baseMight": 2,
    "text": "Deflect: opponents pay 1 additional power of any domain to choose this unit with a spell or ability.",
    "keywords": [
      "Deflect"
    ]
  },
  "OGN-036": {
    "name": "Vi, Destructive",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/7ab52254ac49b8853fc7ae65b03aaee3f8c5994a-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Fury"
    ],
    "energyCost": 2,
    "powerCost": 1,
    "baseMight": 3,
    "text": "Ganking permits standard movement between battlefields. Recycle 1 from your trash to give Vi +1 Might this turn.",
    "keywords": [
      "Ganking"
    ]
  },
  "OGN-213": {
    "name": "Hidden Blade",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0437ab8a0b67f43ef5483a103bbae9e57fd05822-744x1039.png?accountingTag=RB",
    "type": "spell",
    "domains": [
      "Order"
    ],
    "energyCost": 2,
    "powerCost": 1,
    "baseMight": 0,
    "text": "Hidden and Action. Kill a unit at a battlefield; its controller draws 2.",
    "keywords": [
      "Hidden",
      "Action"
    ]
  },
  "OGN-012": {
    "name": "Noxus Hopeful",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/c3bb6f4cb58feeb50e396d12ec9865c5434025af-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Fury"
    ],
    "energyCost": 4,
    "powerCost": 0,
    "baseMight": 4,
    "text": "Legion: this unit costs 2 energy less if you have played another card this turn.",
    "keywords": [
      "Legion"
    ]
  },
  "OGN-058": {
    "name": "Discipline",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/8b9613970b505e3ad6abe2d51d091778314a7d48-744x1039.png?accountingTag=RB",
    "type": "spell",
    "domains": [
      "Calm"
    ],
    "energyCost": 2,
    "powerCost": 0,
    "baseMight": 0,
    "text": "Reaction. Give a unit +2 Might for this turn, then draw 1.",
    "keywords": [
      "Reaction"
    ]
  },
  "OGN-054": {
    "name": "Sunlit Guardian",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/28bce7a662b9008f65565300f828d98790a641e1-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Calm"
    ],
    "energyCost": 3,
    "powerCost": 0,
    "baseMight": 3,
    "text": "Shield adds 1 Might while defending. Tank requires lethal combat damage to this unit before friendly units without Tank.",
    "keywords": [
      "Shield",
      "Tank"
    ]
  },
  "UNL-T07": {
    "name": "Sprite",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/1a90578f055e01515ebfb069dc3dbdba08d24da0-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [],
    "energyCost": 0,
    "powerCost": 0,
    "baseMight": 3,
    "text": "Temporary: kill this token at the start of your Beginning phase, before scoring.",
    "keywords": [
      "Temporary"
    ],
    "token": true
  },
  "OGN-171": {
    "name": "Mystic Poro",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/11af57d045768e886d05e1c0933b0d57cb1e459d-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Chaos"
    ],
    "energyCost": 2,
    "powerCost": 0,
    "baseMight": 2,
    "text": "Vision: when played, privately inspect the top card of your Main Deck; you may recycle it.",
    "keywords": [
      "Vision"
    ]
  },
  "SFD-022": {
    "name": "Long Sword",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/48d798bf93afd1ef139dcafc6cd8705742b93169-744x1039.png?accountingTag=RB",
    "type": "gear",
    "domains": [
      "Fury"
    ],
    "energyCost": 2,
    "powerCost": 1,
    "baseMight": 0,
    "text": "Quick-Draw grants Reaction and an attachment trigger when played. Equip costs 1 Fury power. The attached unit has +2 Might.",
    "keywords": [
      "Quick-Draw",
      "Equip"
    ]
  },
  "SFD-003": {
    "name": "Blood Rush",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/931b77b9ab56c3abc85686be4d2452c450f9b3e0-744x1039.png?accountingTag=RB",
    "type": "spell",
    "domains": [
      "Fury"
    ],
    "energyCost": 1,
    "powerCost": 0,
    "baseMight": 0,
    "text": "Action. Optional Repeat cost: 1 energy. Give a unit Assault 2 for this turn.",
    "keywords": [
      "Action",
      "Repeat"
    ]
  },
  "SFD-002": {
    "name": "Armed Assailant",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/1debdef1d45f7b2a452951db39674aeb01a8dc2b-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Fury"
    ],
    "energyCost": 6,
    "powerCost": 1,
    "baseMight": 6,
    "text": "Accelerate. When played, Weaponmaster lets you attach one of your Equipment to this unit, paying that Equip cost with a 1-power discount.",
    "keywords": [
      "Accelerate",
      "Weaponmaster"
    ]
  },
  "UNL-002": {
    "name": "Inferna",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/5db9d66fc22887e8686a13ffdfe480106cbd3b35-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Fury"
    ],
    "energyCost": 2,
    "powerCost": 0,
    "baseMight": 1,
    "text": "Ambush permits Reaction play to a battlefield where you have units. Assault 2 adds 2 Might while attacking.",
    "keywords": [
      "Ambush",
      "Assault"
    ]
  },
  "UNL-016": {
    "name": "Scorchclaw",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/f69940824f8ce62a479df28988dcbdf6ea6d3960-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Fury"
    ],
    "energyCost": 3,
    "powerCost": 1,
    "baseMight": 3,
    "text": "Hunt 2 grants 2 XP when this unit conquers or holds. At Level 3 it has +1 Might and enters ready; XP is checked, not spent.",
    "keywords": [
      "Hunt",
      "Level"
    ]
  },
  "SFD-190": {
    "name": "Forgefire Cape",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/9bc49433a6ec5a8f4f1b44351094523d51b6bc11-744x1039.png?accountingTag=RB",
    "type": "gear",
    "domains": [
      "Calm",
      "Mind"
    ],
    "energyCost": 4,
    "powerCost": 2,
    "baseMight": 0,
    "text": "Unique: only one copy may be included in the deck. Equip costs 1 power of any domain. The attached unit has +3 Might and deals 2 damage to every enemy unit here when it attacks or defends.",
    "keywords": [
      "Unique",
      "Equip"
    ]
  },
  "UNL-043": {
    "name": "Enthusiastic Promoter",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/c03bdc371440cbf6de773b0b39010808bfdecea1-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Calm"
    ],
    "energyCost": 3,
    "powerCost": 0,
    "baseMight": 2,
    "text": "Backline receives lethal combat damage after friendly units without Backline. When this unit holds, buff all units at its battlefield.",
    "keywords": [
      "Backline"
    ]
  },
  "VEN-001": {
    "name": "Baccai Sandspinner",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/d8abab7f0df7c8ec9fff8c8dfa71c732e1ce2e6a-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Fury"
    ],
    "energyCost": 6,
    "powerCost": 0,
    "baseMight": 6,
    "text": "Empower costs 5 energy, reduced by 3 while you control four or fewer runes. While Empowered, this unit has Deflect and Assault 2.",
    "keywords": [
      "Empower",
      "Empowered"
    ]
  },
  "VEN-049": {
    "name": "Dredge Up",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/cf561c8a0f8debde66b66d3e74ce861d0ce388ae-744x1039.png?accountingTag=RB",
    "type": "spell",
    "domains": [
      "Mind"
    ],
    "energyCost": 2,
    "powerCost": 0,
    "baseMight": 0,
    "text": "Draw 1. Flow permits playing it from your trash for 2 energy, then banishes it. It retains normal spell timing.",
    "keywords": [
      "Flow"
    ]
  },
  "RAD-002": {
    "name": "Banner of Conquest",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/1e2a4e0a8cf533c82e9c3f4d507dd7eb63ece943-744x1039.png?accountingTag=RB",
    "type": "gear",
    "domains": [
      "Fury"
    ],
    "energyCost": 1,
    "powerCost": 1,
    "baseMight": 0,
    "text": "Deploy places this gear at a battlefield and kills it when an opponent holds there. Friendly units at its battlefield have Assault.",
    "keywords": [
      "Deploy"
    ]
  },
  "RAD-050": {
    "name": "Mysterious Chronomancer",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/72828b0fe019b2e03069510f781dfa8f5759ac12-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Mind"
    ],
    "energyCost": 5,
    "powerCost": 0,
    "baseMight": 4,
    "text": "When played, Predict 2. When this unit attacks, Disarm 2 gives an enemy unit at its battlefield -2 Might this turn.",
    "keywords": [
      "Disarm"
    ]
  },
  "RAD-082": {
    "name": "Primordial Roar",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/945633b0c2ed7f303245c917ffbcdb80dcfb524e-744x1039.png?accountingTag=RB",
    "type": "spell",
    "domains": [
      "Body"
    ],
    "energyCost": 4,
    "powerCost": 2,
    "baseMight": 0,
    "text": "Optionally show off a unit while playing this spell. If you do, deal damage equal to that unit's recorded Might to a unit.",
    "keywords": [
      "Show Off"
    ]
  }
};

function card(cardId: string, zone: string, options: Partial<KeywordScenarioCard> = {}): KeywordScenarioCard {
  return { ...CARDS[cardId], instanceId: `${options.owner ?? 'player'}-${cardId}`, cardId, zone, owner: 'player', ready: false, ...options };
}
function position(cards: KeywordScenarioCard[], player: KeywordScenarioPlayer = {}, note?: string, opponent?: KeywordScenarioPlayer): KeywordScenarioSnapshot {
  return { cards, player, ...(note ? { note } : {}), ...(opponent ? { opponent } : {}) };
}

export const NEW_PLAYER_KEYWORD_SCENARIOS: KeywordScenario[] = [
  {
    id: 'keyword-accelerate', keyword: 'Accelerate', groupId: "keyword-combat", title: 'Pay extra to enter ready',
    definition: "As you play a unit with Accelerate, you can pay 1 extra energy and 1 extra power so it enters ready. Use matching power for a single-domain unit such as this Fury Rearguard. A unit with several domains or none can use power of any domain.",
    instruction: "We want to reach the empty battlefield this turn. Legion Rearguard has Accelerate on its card, so we can pay extra to have it enter ready. Pay 3 energy and 1 Fury power in total; then it will be able to move. Units without this permission cannot buy ready entry.",
    actionLabel: 'Pay 3 energy + 1 Fury power',
    before: position([card('OGN-010', 'hand', { might: 2 })], { energy: 3, power: 1, handCount: 1 }, 'Your Main Phase, with an empty chain. Your available power is Fury.'),
    after: position([card('OGN-010', 'base', { might: 2, ready: true, annotation: 'Entered ready: Accelerate was paid.' })], { energy: 0, power: 0, handCount: 0 }),
    explanation: "The extra payment let Rearguard move and earn a point by conquering on the turn it was played. Moving turned it sideways, so it cannot keep moving for free. Accelerate is only an option on a card that has it, and you choose it while playing that card. It cannot ready a unit already on the board.", rulesReference: 'Core Rules 143.4, 805; Radiance FAQ, 26 October 2026',
  },
  {
    id: 'keyword-action', keyword: 'Action', groupId: "keyword-timing", title: 'Act in a showdown',
    definition: "Action lets you play this card during a showdown: the chance to make plays before a battlefield is settled. It must be your chance to act, with no spell or ability waiting on the chain.",
    instruction: "Our 2-Might Rearguard would lose to the 4-Might Hopeful. Before combat damage happens, the showdown gives us a chance to help it. We have focus, meaning it is our chance to make a play. Play Cleave on Rearguard to give it 3 extra Might while attacking, enough to win and survive.", actionLabel: 'Play Cleave for 1 energy',
    before: position([card('OGN-004', 'hand'), card('OGN-010', 'base', { might: 2, ready: true, annotation: 'Ready to move; Cleave can be played now or saved for the showdown.' }), card('OGN-096', 'battlefield-left', { owner: 'opponent', might: 1, annotation: 'Defender' })], { energy: 1, handCount: 1 }, 'Your Main phase: the chain is empty. Read Cleave before moving to the battlefield.'),
    after: position([card('OGN-004', 'trash'), card('OGN-010', 'battlefield-left', { might: 5, annotation: 'Attacker: 2 base + Assault 3.' }), card('OGN-096', 'battlefield-left', { owner: 'opponent', might: 1 })], { energy: 0, handCount: 0 }, 'Both players pass on the spell. Cleave resolves; combat damage has not happened yet.'),
    explanation: "Cleave changed the fight before damage: Rearguard reached 5 Might, survived the enemy's 4 damage, and conquered the battlefield. Action allows this showdown play on either player's turn. It does not let you respond while another effect is waiting on the chain; that needs Reaction. You can also play an Action card during your own normal Main phase.", rulesReference: 'Core Rules 806, 807',
  },
  {
    id: 'keyword-reaction', keyword: 'Reaction', groupId: "keyword-timing", title: 'Respond before a spell resolves',
    definition: "Reaction lets you act when you have priority, your chance to play. You can start a play in your own open Main phase or when you have focus in an open showdown. You can also answer a waiting spell or ability. Your response resolves first once both players pass.",
    instruction: "The enemy's Cleave is waiting to make its attacker 5 Might. Our Guardian is only 4 while defending, so it needs help to survive. We have priority, our chance to respond. Play Discipline on Guardian now: its 2 extra Might will take effect before Cleave because the newest waiting effect happens first.", actionLabel: 'React with Discipline',
    before: position([card('OGN-058', 'hand'), card('OGN-096', 'battlefield-left', { might: 1 }), card('OGN-004', 'chain', { owner: 'opponent', annotation: 'Targets the opponent’s attacker; waiting to resolve.' }), card('OGN-010', 'battlefield-left', { owner: 'opponent', might: 2, annotation: 'Attacker' })], { energy: 2, handCount: 2 }, 'You have priority on the chain.'),
    after: position([card('OGN-058', 'trash'), card('OGN-045', 'hand', { annotation: 'Drawn by Discipline; can respond to the still-waiting Cleave.' }), card('OGN-096', 'battlefield-left', { might: 3, annotation: '+2 Might this turn from Discipline.' }), card('OGN-004', 'chain', { owner: 'opponent', annotation: 'Still waiting below Discipline.' }), card('OGN-010', 'battlefield-left', { owner: 'opponent', might: 2 })], { energy: 0, handCount: 2 }, 'Discipline resolves first: +2 Might and draw Defy. Cleave is still waiting, with a fresh chance to respond.'),
    explanation: "Discipline strengthened Guardian and drew Defy. Cleave was still waiting, so we had another chance to respond with the card just drawn. Defy countered it: Cleave went to Trash without giving its bonus, and its cost was not refunded. Guardian fought the 2-Might attacker, and you retained control of the battlefield. Defending successfully does not immediately score a point; holding is checked in your next Beginning phase. You could pass in a real game; this exercise used Defy to show the fresh response window.", rulesReference: 'Core Rules 359, 813',
  },
  {
    id: 'keyword-ganking', keyword: 'Ganking', groupId: "keyword-equipment", title: 'Move between battlefields',
    definition: "A ready unit with Ganking can use its normal move to go directly from one battlefield to another. A normal move turns the unit sideways.",
    instruction: "Vi has already helped score the left battlefield this turn; it cannot score for us again this turn. Move her directly to the enemy's right battlefield to fight for another point. Ganking allows this direct route. Without it, her normal move would have to return her to base first.", actionLabel: 'Move Vi to the right battlefield',
    before: position([card('OGN-036', 'battlefield-left', { might: 3, ready: false }), card('OGN-096', 'battlefield-right', { might: 1, ready: true }), card('OGN-004', 'trash', { instanceId: 'vi-cost-one', annotation: 'First used card available to recycle for Vi’s ability.' }), card('OGN-004', 'trash', { instanceId: 'vi-cost-two', annotation: 'Second used card available for a second activation.' })], { score: 1 }, 'Your turn starts. Awaken Vi, score holding in Beginning, then Channel and Draw before making Main-phase plays.'),
    after: position([card('OGN-036', 'battlefield-right', { might: 5, annotation: 'Two resolved ability uses give +2 Might this turn; exhausted for the move.' }), card('OGN-096', 'battlefield-right', { might: 1, ready: true }), card('OGN-004', 'deck', { instanceId: 'vi-cost-one', annotation: 'Recycled from Trash to pay the first ability cost.' }), card('OGN-004', 'deck', { instanceId: 'vi-cost-two', annotation: 'Recycled from Trash to pay the second ability cost.' })], { score: 2 }, 'You scored for holding the left battlefield. Vi used her ability twice during Main, then moved across to fight for the other battlefield.'),
    explanation: "Awaken made Vi ready, and holding earned a point before Main. In Main we used her ability twice, each time paying a different Trash card and resolving a separate chain. It has no exhaust cost or once-per-turn limit, so she stayed ready to move. Ganking then let her move directly to the other battlefield and conquer it for another point. Her +2 Might lasts this turn; it does not end with combat.", rulesReference: 'Core Rules 144–145, 377, 381.1, 810',
  },
  {
    id: 'keyword-ambush', keyword: 'Ambush', groupId: "keyword-combat", title: 'Bring help into a fight',
    definition: "Ambush lets you play this unit as a Reaction directly to a battlefield containing one of your units. You can bring help while a spell or ability is still waiting.",
    instruction: "Our Sentry cannot win this fight alone. The enemy's Discipline is waiting to strengthen its defender. Play Inferna to the same battlefield now: Ambush allows this response because our Sentry is already there, even though we do not control the battlefield. Inferna adds enough fighting strength to change the result.", actionLabel: 'Ambush with Inferna for 2 energy',
    before: position([card('UNL-002', 'hand', { might: 1 }), card('OGN-096', 'battlefield-left', { might: 1, annotation: 'Your attacker is already here.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true, annotation: 'Defender; opponent controls this battlefield.' })], { energy: 2, handCount: 1 }, 'This battlefield has no rule forbidding unit plays.'),
    after: position([card('UNL-002', 'battlefield-left', { might: 3, annotation: 'Entered exhausted; joins your attack. 1 base + Assault 2.' }), card('OGN-096', 'battlefield-left', { might: 1 }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })], { energy: 0, handCount: 0 }, 'Inferna resolves and joins your side of this combat. Combat damage is still ahead.'),
    explanation: "Inferna entered sideways immediately; exhausted units still fight. The enemy's waiting Discipline happened separately afterwards. Our two units then dealt 4 damage together. Inferna died, but the original Sentry survived to conquer the battlefield. Ambush needs a friendly unit at its destination, not control of that battlefield. It cannot override a battlefield rule that forbids playing units there.", rulesReference: 'Core Rules 143.4, 465, 822',
  },
  {
    id: 'keyword-assault', keyword: 'Assault', groupId: "keyword-combat", title: 'More Might when attacking',
    definition: "Assault adds to a unit's Might while it is attacking. Might is its fighting strength: the damage it deals in combat and the damage needed to kill it.",
    instruction: "Both Petty Officers have 5 Might printed on their cards. Normally they would kill each other. Move ours into the enemy's battlefield to attack. Its Assault adds 1 Might while attacking, taking it to 6 so it can beat the defender and survive the 5 damage coming back.", actionLabel: 'Attack with Petty Officer',
    before: position([card('OGN-215', 'base', { might: 5, ready: true }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })]),
    after: position([card('OGN-215', 'battlefield-left', { might: 6, annotation: 'Attacker: 5 base + Assault 1.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })], {}, 'The combat showdown has begun. No damage has been dealt yet.'),
    explanation: "Your attacker survived and scored because Assault made it 6 Might during the fight. Assault with no number means Assault 1. Its bonus applies automatically, without a chain item. Keep the bonus through conquering and resolving any resulting waiting effects. Only then does combat end and Petty Officer return to printed 5 Might. Clearing damage does not end the bonus early.", rulesReference: 'Core Rules 468.1–468.7, 807',
  },
  {
    id: 'keyword-shield', keyword: 'Shield', groupId: "keyword-growth", title: 'More Might when defending',
    definition: "Shield adds to a unit's Might while it is defending a battlefield. It makes the defender hit harder and need more damage to be killed.",
    instruction: "Both Guardians have 3 Might printed on their cards. End your turn so the guide can attack our battlefield. Our Guardian will be the defender, so its Shield adds 1 Might. Watch it become 4: that is enough to survive the attack and retain control of the battlefield.", actionLabel: 'End turn and let the guide attack',
    before: position([card('OGN-054', 'battlefield-left', { might: 3, ready: true }), card('OGN-012', 'base', { owner: 'opponent', might: 4, ready: true })]),
    after: position([card('OGN-054', 'battlefield-left', { might: 4, ready: true, annotation: 'Defender: 3 base + Shield 1.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, annotation: 'Attacker' })], {}, 'Combat has started; the showdown happens before damage.'),
    explanation: "Our Guardian dealt 4 damage and survived the attacker's 3. Shield is extra Might, not a separate barrier that absorbs a hit. It applies automatically. Keep the bonus through the combat result, conquering if any, and the resulting waiting effects. When combat finally ends, Guardian returns to 3 Might. A successful defence retains control without immediately scoring. Holding is checked in your next Beginning phase.", rulesReference: 'Core Rules 468.1–468.7, 814',
  },
  {
    id: 'keyword-tank', keyword: 'Tank', groupId: "keyword-new-tools", title: 'Assign lethal to the Tank first',
    definition: "When assigning combat damage, give enemy Tank units enough damage to kill them before putting damage on their allies without Tank. That amount is called lethal damage.",
    instruction: "Our attacker has 4 damage to divide between the enemy Guardian and Sentry. Guardian has Tank and 4 Might while defending. It needs all 4 damage before Sentry can receive any, so the smaller Sentry is protected. Watch the assignment first; damage has not happened yet.", actionLabel: 'Assign all 4 to the Tank',
    before: position([card('OGN-012', 'battlefield-left', { might: 4, annotation: 'Attacker: 4 damage to assign.' }), card('OGN-054', 'battlefield-left', { owner: 'opponent', might: 4, annotation: 'Tank; defending with Shield.' }), card('OGN-096', 'battlefield-left', { owner: 'opponent', might: 1 })], {}, 'The showdown has ended. We are only showing the assignment step.'),
    after: position([card('OGN-012', 'battlefield-left', { might: 4 }), card('OGN-054', 'battlefield-left', { owner: 'opponent', might: 4, annotation: '4 assigned: lethal. Damage not dealt yet.' }), card('OGN-096', 'battlefield-left', { owner: 'opponent', might: 1, annotation: '0 assigned: no damage remains.' })]),
    explanation: "We must assign all 4 damage to Guardian because Tank requires enough to kill it before reaching Sentry. Both sides then deal their damage at the same time; the defender does not get to hit first just because it has Tank. Guardian and our attacker die, while Sentry survives, so the defending player retains control of the battlefield. Defending does not immediately score a holding point. Assignment chooses where damage will go; dealing damage is the next step.", rulesReference: 'Core Rules 467, 815',
  },
  {
    id: 'keyword-backline', keyword: 'Backline', groupId: "keyword-combat", title: 'Reach the Backline last',
    definition: "When assigning combat damage, give the enemy's other units enough damage to kill them before reaching its Backline units. That amount is called lethal damage.",
    instruction: "Our attacker has 4 damage to divide. The enemy's 1-Might Sentry must receive enough to kill it before we can reach Promoter, which has Backline. Assign 1 to Sentry, then the remaining 3 to Promoter. This removes both defenders while following the protection rule.", actionLabel: 'Assign 1 to Sentry, then 3',
    before: position([card('OGN-012', 'battlefield-left', { might: 4 }), card('OGN-096', 'battlefield-left', { owner: 'opponent', might: 1 }), card('UNL-043', 'battlefield-left', { owner: 'opponent', might: 2, annotation: 'Backline' })], {}, 'Combat damage assignment; no damage has been dealt yet.'),
    after: position([card('OGN-012', 'battlefield-left', { might: 4 }), card('OGN-096', 'battlefield-left', { owner: 'opponent', might: 1, annotation: '1 assigned first: lethal.' }), card('UNL-043', 'battlefield-left', { owner: 'opponent', might: 2, annotation: '3 assigned last: all remaining damage.' })]),
    explanation: "Sentry must receive its lethal 1 first. Promoter is the last unit in the assignment order, so all 3 remaining damage goes there, including the extra. Both sides deal damage together: our 4-Might attacker survives their combined 3. Backline protects the combat assignment order; it does not stop a spell choosing that unit as a target.", rulesReference: 'Core Rules 467, 826',
  },
  {
    id: 'keyword-deflect', keyword: 'Deflect', groupId: "keyword-surprises", title: 'Budget for the targeting cost',
    definition: "An opponent must pay extra power when their spell or ability chooses this card as a target. A target is the specific card or object an effect is aimed at.",
    instruction: "We want Hidden Blade to remove the enemy Pouty Poro. Poro has Deflect, so choosing it as our target costs extra: pay Hidden Blade's 2 energy and 1 Order power, plus 1 more power of any domain. Prepare that extra power before trying to play the spell.", actionLabel: 'Pay the cost including Deflect',
    before: position([card('OGN-213', 'hand'), card('OGN-013', 'battlefield-left', { owner: 'opponent', might: 2, ready: true })], { energy: 2, power: 2 }, 'Your Main Phase, empty chain. Available power: 1 Order and 1 of any domain.'),
    after: position([card('OGN-213', 'chain', { annotation: 'Target chosen and costs paid; waiting for responses.' }), card('OGN-013', 'battlefield-left', { owner: 'opponent', might: 2, ready: true })], { energy: 0, power: 0 }, 'We stop before the spell resolves. The Poro has not been killed yet.'),
    explanation: "The extra payment let us target and remove Poro. Deflect adds a cost; it does not reduce damage or cancel a spell after it is paid for. It does not protect against combat damage, or effects that never choose Poro as a target. Without enough power for the extra cost, we could not make this play.", rulesReference: 'Core Rules 809',
  },
  {
    id: 'keyword-disarm', keyword: 'Disarm', groupId: "keyword-surprises", title: 'Reduce an enemy’s Might on attack',
    definition: "When this unit attacks, Disarm creates an ability that can lower an enemy unit's Might at the same battlefield for this turn. That ability waits on the chain and can be responded to.",
    instruction: "Our Chronomancer and the enemy Hopeful both have 4 Might, so they would normally kill each other. Attack with Chronomancer to create its Disarm 2 ability. We will aim it at Hopeful, then give both players a chance to respond before it lowers Hopeful to 2 Might.", actionLabel: 'Resolve Disarm 2',
    before: position([card('RAD-050', 'battlefield-left', { might: 4, annotation: 'Attacker; play-time Predict has already resolved.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })], {}, 'The attack trigger is on the chain. Both players pass on it.'),
    after: position([card('RAD-050', 'battlefield-left', { might: 4 }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 2, ready: true, annotation: '4 base − 2 this turn.' })]),
    explanation: "After both players passed, Disarm lowered Hopeful's Might before combat damage. Chronomancer survived the weaker return hit and conquered the battlefield. Disarm with no number means 1. It reduces Might for the turn; it does not turn a unit sideways or remove its Equipment. Unlike Assault or Shield, this attack-triggered ability waits on the chain and allows Reactions.", rulesReference: 'Core Rules 831',
  },
  {
    id: 'keyword-hidden', keyword: 'Hidden', groupId: "keyword-equipment", title: 'Use a card prepared on an earlier turn',
    definition: "Pay 1 power to prepare this card facedown at a battlefield you control. From a later turn, you may play it there as a Reaction without paying its normal base cost.",
    instruction: "We will prepare Hidden Blade now so it can help on a later turn. The guide will pay for Discipline before moving its strengthened Sentry into the attack. When the hidden card becomes usable, we will target that friendly Sentry to draw extra cards before losing the battlefield. Then we will explicitly reset: the guide moves to the other battlefield, which the hidden card cannot reach.", actionLabel: 'Reveal and play Hidden Blade',
    before: position([card('OGN-213', 'hidden', { faceDown: true, hiddenAt: 'battlefield-left', annotation: 'Your facedown card, hidden on a previous turn.' }), card('OGN-096', 'battlefield-left', { might: 1 }), card('OGN-096', 'battlefield-left', { owner: 'opponent', might: 3, annotation: 'Printed 1 + Discipline 2 this turn.' }), card('OGN-058', 'hand', { owner: 'opponent' })], { energy: 0, power: 0 }, 'You still control this contested battlefield. No extra costs apply.', { handCount: 3 }),
    after: position([card('OGN-213', 'hidden', { faceDown: true, hiddenAt: 'battlefield-left' }), card('OGN-096', 'battlefield-left', { might: 1 }), card('OGN-096', 'battlefield-right', { owner: 'opponent', might: 3, annotation: 'Separate reset example: Discipline resolved before moving here.' }), card('OGN-058', 'trash', { owner: 'opponent' })], { energy: 0, power: 0 }, 'Separate reset example: the guide chose the other battlefield. Blade remains hidden beside your Sentry.', { handCount: 4 }),
    explanation: "In the first position, Hidden Blade drew two cards because we chose our own Sentry. Sentry's separate Deathknell then drew one more. Hiding had to happen on an earlier turn, at a battlefield we controlled with no other facedown card. Playing from Hidden ignores the base cost, but extra costs still apply and targets normally stay at that battlefield. The reset showed the limit: Blade on the left cannot choose a unit on the right. It can still choose a friendly unit on the left. If we lose control while a card is still hidden, cleanup sends it to Trash.", rulesReference: 'Core Rules 811',
  },
  {
    id: 'keyword-deathknell', keyword: 'Deathknell', groupId: "keyword-combat", title: 'Get the effect when a unit dies',
    definition: "When this card is killed, its Deathknell ability is put on the chain. Players can respond before that ability does what its text says.",
    instruction: "Our Sentry is too small to survive this fight. Watch it die, then look for its Deathknell on the chain. That ability will draw us a replacement card after both players have had a chance to respond, so losing the unit still gives us something for our next turn.", actionLabel: 'Resolve Sentry’s Deathknell',
    before: position([card('OGN-096', 'trash', { annotation: 'Just died; Deathknell is waiting on the chain.' })], { handCount: 2 }),
    after: position([card('OGN-096', 'trash', { annotation: 'Deathknell resolved; the unit stays in the trash.' })], { handCount: 3 }),
    explanation: "Sentry went to Trash, the pile for used or destroyed cards, and its Deathknell drew a card for its controller. The draw happened when the separate ability resolved, not at the instant Sentry died. Returning a unit to hand or base is not killing it, so that alone would not activate Deathknell.", rulesReference: 'Core Rules 808',
  },
  {
    id: 'keyword-temporary', keyword: 'Temporary', groupId: "keyword-new-tools", title: 'Check before holding',
    definition: "At the start of its controller's Beginning phase, Temporary creates an ability that kills this card. This happens before checking for holding points.",
    instruction: "Sprite is our only unit on this battlefield. It helped you control the battlefield, but it is Temporary, so we cannot rely on it for a holding point next turn. Start Awaken, then watch its Beginning ability happen before the holding check. Players still get a chance to react to that ability.", actionLabel: 'Resolve Temporary before scoring',
    before: position([card('UNL-T07', 'battlefield-left', { might: 3, ready: true, annotation: 'Your only unit here.' })], { score: 6 }, 'Awaken has finished; Beginning is starting.'),
    after: position([], { score: 6 }, 'The Sprite dies, and its token ceases to exist after leaving the board. You have no unit here, so there is no holding point.'),
    explanation: "Temporary killed Sprite before holding was checked, leaving no unit to retain control and score. Sprite is a token: a unit created by an effect rather than a card from the deck. A token stops existing after it leaves the board. Temporary units can help conquer a battlefield now. If their Temporary ability resolves and no other unit remains, you cannot score for holding at that Beginning check.", rulesReference: 'Core Rules 315, 816',
  },
  {
    id: 'keyword-vision', keyword: 'Vision', groupId: "keyword-new-tools", title: 'Check your next draw',
    definition: "When you play this card, Vision creates an ability to Predict: privately look at your deck's top card, then keep it there or put it on the bottom.",
    instruction: "Play Mystic Poro to put a unit on the board and check what we would draw next. Its Vision will show another small Sentry on top. We will move that card to the bottom because this example wants a larger attacker for a later fight. Keeping it on top would also be allowed.", actionLabel: 'Play Poro and recycle the top card',
    before: position([card('OGN-171', 'hand', { might: 2 })], { energy: 2, handCount: 1 }),
    after: position([card('OGN-171', 'base', { might: 2 }), card('OGN-096', 'deck', { annotation: 'Recycled to the bottom after you inspected it.' })], { energy: 0, handCount: 0 }, 'The inspected card is shown for this demonstration. Your opponent does not get to see it.'),
    explanation: "Predict changed the next draw without drawing anything itself. Moving the duplicate Sentry to the bottom let our next ordinary draw reach Mysterious Chronomancer, a larger attacker with Disarm. Only we saw the inspected card. Vision is the ability created by playing Poro; Predict is the look-and-choose action that ability performs when it resolves.", rulesReference: 'Core Rules 817; Predict game action',
  },
  {
    id: 'keyword-equip', keyword: 'Equip', groupId: "keyword-equipment", title: 'Attach gear already on your board',
    definition: "Pay an Equipment card's Equip cost to attach it to one of your units. The attached gear then helps that unit in the way its text describes.",
    instruction: "Our Long Sword is already on the board, but it is not helping anyone yet. Use its Equip ability and choose Rearguard to give that unit 2 extra Might. Pay the sword's 1 Fury power Equip cost. This is a separate ability, so we are not paying its original play cost again.", actionLabel: 'Equip Long Sword',
    before: position([card('SFD-022', 'base', { ready: true, annotation: 'Already played; unattached.' }), card('OGN-010', 'base', { might: 2, ready: true })], { power: 1 }, 'Your Main Phase, empty chain. Your available power is Fury.'),
    after: position([card('SFD-022', 'base', { ready: true, annotation: 'Attached to Legion Rearguard.' }), card('OGN-010', 'base', { might: 4, ready: true, annotation: '2 base + 2 from Long Sword.' })], { power: 0 }),
    explanation: "The sword turned a 2-against-2 fight into a win for our 4-Might Rearguard. Equip waited on the chain before attaching, giving players a chance to respond. Attaching did not turn Rearguard sideways. The sword moved with its unit and kept giving 2 extra Might after the fight. Playing gear and attaching gear are separate actions with separate costs.", rulesReference: 'Core Rules 716–719, 818',
  },
  {
    id: 'keyword-quick-draw', keyword: 'Quick-Draw', groupId: "keyword-growth", title: 'Play and attach in a response window',
    definition: "This Equipment can be played as a Reaction. Playing it also creates an ability to attach it to one of your units without paying an Equip cost.",
    instruction: "Our 1-Might Sentry is already being attacked by a 2-Might unit. Play Long Sword now to help it survive. Quick-Draw allows this response. Pay the normal play cost, 2 energy and 1 Fury power; the sword enters the base, then its separate attachment ability will give Sentry 2 extra Might.", actionLabel: 'Play Long Sword with Quick-Draw',
    before: position([card('SFD-022', 'hand'), card('OGN-096', 'battlefield-left', { might: 1 }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, annotation: 'Attacker' })], { energy: 2, power: 1, handCount: 1 }, 'You have priority. Available power is Fury; your Sentry is defending.'),
    after: position([card('SFD-022', 'battlefield-left', { ready: true, annotation: 'Attached to Watchful Sentry after its play trigger resolves.' }), card('OGN-096', 'battlefield-left', { might: 3, annotation: '1 base + 2 from Long Sword.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, annotation: 'Attacker' })], { energy: 0, power: 0, handCount: 0 }),
    explanation: "Sentry reached 3 Might before damage and survived with its sword. You retained control of the battlefield; holding is checked in your next Beginning phase. The gear entered immediately, but its attachment waited on the chain and could be responded to. Quick-Draw did not charge an extra Equip cost. Using the sword's ordinary Equip ability later still follows that ability's normal timing.", rulesReference: 'Core Rules 818, 819',
  },
  {
    id: 'keyword-weaponmaster', keyword: 'Weaponmaster', groupId: "keyword-new-tools", title: 'Use the discounted attachment',
    definition: "When you play this unit, Weaponmaster creates an ability to attach Equipment you already control to it. Pay that Equipment's Equip cost with a discount of 1 power.",
    instruction: "Play Armed Assailant so we can give it the Long Sword already in our base. Weaponmaster reduces the sword's 1-power Equip cost to zero, saving a resource. Assailant still enters sideways; we will wait until its next turn before moving the stronger unit into a fight.", actionLabel: 'Play Assailant and attach the sword',
    before: position([card('SFD-002', 'hand', { might: 6 }), card('SFD-022', 'base', { ready: true, annotation: 'Unattached Equipment you already control.' })], { energy: 6, power: 1, handCount: 1 }, 'Your Main Phase, empty chain. The 1 available power is Fury.'),
    after: position([card('SFD-002', 'base', { might: 8, annotation: 'Entered exhausted; 6 base + 2 from Long Sword.' }), card('SFD-022', 'base', { ready: true, annotation: 'Attached through Weaponmaster; no extra Equip payment.' })], { energy: 0, power: 0, handCount: 0 }),
    explanation: "The free attachment made Assailant 8 Might instead of 6, enough to survive the later fight. It had to wait for Awaken, the step that readies units, before moving. Weaponmaster discounts 1 power, not every possible cost: any energy or remaining power in the Equip cost would still need paying. The Equipment must already be yours and attaches to the Weaponmaster unit.", rulesReference: 'Core Rules 821',
  },
  {
    id: 'keyword-unique', keyword: 'Unique', groupId: "keyword-new-tools", title: 'Keep one copy when building',
    definition: "When building your deck, you may include only one card with this name. Unique is a deck-building rule, not an extra action during a game.",
    instruction: "Before playing, we need a legal deck. This proposed Ornn deck has 41 Main Deck cards including its chosen champion, with two Forgefire Capes. Cape has Unique, so only one is allowed. Remove the extra copy to leave 40 cards and fix the duplicate.", actionLabel: 'Remove the second copy',
    before: position([card('SFD-190', 'deck', { instanceId: 'cape-first', annotation: 'First copy in the proposed deck.' }), card('SFD-190', 'deck', { instanceId: 'cape-second', annotation: 'Second copy: not allowed by Unique.' })], {}, 'Assume all the deck’s other restrictions are satisfied.'),
    after: position([card('SFD-190', 'deck', { instanceId: 'cape-first', annotation: 'One copy: satisfies Unique.' })], {}, 'The extra copy is removed from this draft, not sent to an in-game trash.'),
    explanation: "The extra Cape was removed from the proposed deck, not killed or put into an in-game Trash pile. Unique limits copies in deck building; it does not itself limit how many could be on the board. Signature cards, cards tied to a particular champion, also follow their separate deck-building limit. We kept one legal Cape in Ornn's deck.", rulesReference: 'Core Rules 825',
  },
  {
    id: 'keyword-legion', keyword: 'Legion', groupId: "keyword-growth", title: 'Play another card first',
    definition: "The text after Legion applies if you have already played another card this turn. Each Legion card tells you its own benefit.",
    instruction: "We have 4 energy to spend, but these units normally cost 6 together. Play the 2-energy Rearguard first. That makes Hopeful's Legion condition true, reducing Hopeful from 4 energy to 2. This order lets us put both units on the board this turn.", actionLabel: 'Play Hopeful for 2 energy',
    before: position([card('OGN-010', 'base', { might: 2, annotation: 'Played earlier this turn without Accelerate.' }), card('OGN-012', 'hand', { might: 4 })], { energy: 2, handCount: 1 }),
    after: position([card('OGN-010', 'base', { might: 2 }), card('OGN-012', 'base', { might: 4, annotation: 'Legion active: paid 2 energy; entered exhausted.' })], { energy: 0, handCount: 0 }),
    explanation: "Rearguard first, then Hopeful, gave us two units for 4 energy. Legion is a condition to check, not always the same discount; read the words after it on each card. Hiding a card or using a legend's ability does not count as playing another card. At the start of a new turn, you need to meet the condition again.", rulesReference: 'Core Rules 727, 812',
  },
  {
    id: 'keyword-hunt', keyword: 'Hunt', groupId: "keyword-equipment", title: 'Earn XP when this unit scores',
    definition: "When this unit conquers or holds a battlefield, Hunt creates an ability that gives its controller XP, meaning experience points. XP is separate from the points needed to win the game.",
    instruction: "Scorchclaw is about to conquer this battlefield. Record the point for conquering first, then respond to and resolve its Hunt 2 ability. The 2 XP will take us from 1 to 3, enough to switch on Scorchclaw's Level 3 bonus. The game point and the XP are two different rewards.", actionLabel: 'Conquer and gain 2 XP',
    before: position([card('UNL-016', 'battlefield-left', { might: 3, annotation: 'Showdown finishing; this battlefield has not scored for you this turn.' })], { score: 2, xp: 0 }),
    after: position([card('UNL-016', 'battlefield-left', { might: 3 })], { score: 3, xp: 2 }, 'Conquering gives 1 point; Hunt gives 2 XP after its trigger resolves.'),
    explanation: "Conquering added one game point; Hunt then added two experience points. Reaching 3 XP turned on Scorchclaw's extra Might. It did not ready the unit already on the board: an 'enters ready' rule only applies when it enters. Hunt without a number gives 1 XP, and triggers when this unit conquers or holds, not another unit scoring elsewhere.", rulesReference: 'Core Rules 728–733, 823',
  },
  {
    id: 'keyword-level', keyword: 'Level', groupId: "keyword-growth", title: 'Have enough experience points',
    definition: "The text after Level applies while you have at least that much XP, or experience points. You check your XP total; you do not spend it.",
    instruction: "This practice position starts with 3 XP already earned. Play Scorchclaw now: its Level 3 text lets it enter ready with 4 Might instead of entering sideways with 3. That gives us a unit we can move straight away to conquer an empty battlefield. Our XP stays at 3.", actionLabel: 'Play Scorchclaw at Level 3',
    before: position([card('UNL-016', 'hand', { might: 3, annotation: 'Printed Might 3; Level 3 condition is met.' })], { energy: 3, power: 1, xp: 3, handCount: 1 }, 'Your available power is Fury.'),
    after: position([card('UNL-016', 'base', { might: 4, ready: true, annotation: 'Level 3: +1 Might and enters ready.' })], { energy: 0, power: 0, xp: 3, handCount: 0 }),
    explanation: "Having enough XP let Scorchclaw move on the turn it entered and earn a point by conquering. Its Hunt then earned more XP separately. Level does not spend XP. If your XP falls below the required total, an ongoing bonus stops applying. Reaching Level later does not repeat an entry effect for a unit already on the board.", rulesReference: 'Core Rules 727, 824',
  },
  {
    id: 'keyword-empower', keyword: 'Empower', groupId: "keyword-surprises", title: 'Pay to become Empowered',
    definition: "Pay this ability's cost to give the card the Empowered status. That switches on the abilities written after Empowered on that card.",
    instruction: "Our Sandspinner needs its attack bonus to survive an evenly matched fight. Use Empower to switch that bonus on. Its printed cost is 5 energy, but this card reduces it by 3 while we control at most four runes. Pay 2 energy; the ability must resolve before the bonus is active.", actionLabel: 'Empower Sandspinner for 2 energy',
    before: position([card('VEN-001', 'base', { might: 6, ready: true, annotation: 'Not Empowered. You control exactly four runes.' })], { energy: 2 }, 'Your Main Phase, empty chain. The four runes remain under your control even if exhausted.'),
    after: position([card('VEN-001', 'base', { might: 6, ready: true, annotation: 'Empowered: Deflect and Assault 2 are now active.' })], { energy: 0 }),
    explanation: "Empower switched on Sandspinner's Assault 2, letting it attack at 8 Might and survive the enemy's 6 damage. The unit stayed upright because this ability did not ask us to exhaust it. Empowered is a status, not a generic extra Might counter. You normally cannot use Empower again while the card is already Empowered.", rulesReference: 'Core Rules 442, 827',
  },
  {
    id: 'keyword-empowered', keyword: 'Empowered', groupId: "keyword-surprises", title: 'Use the text switched on by Empowered',
    definition: "The text after Empowered works while this card has that status. The Empower ability is one way to gain the status; the benefits depend on the card.",
    instruction: "This Sandspinner is already Empowered, so its printed text now gives it Assault 2. Move it to attack the 6-Might defender. Its own printed 6 becomes 8 while attacking, enough to survive this fight. We are using the benefit already switched on, not paying to Empower it again.", actionLabel: 'Attack with Empowered Sandspinner',
    before: position([card('VEN-001', 'base', { might: 6, ready: true, annotation: 'Empowered: Deflect and Assault 2 active.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })]),
    after: position([card('VEN-001', 'battlefield-left', { might: 8, annotation: 'Empowered attacker: 6 base + Assault 2; Deflect active.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })]),
    explanation: "The attack bonus changed a fight where both units would die into a surviving attacker and a point. Sandspinner stays Empowered after combat, but Assault's extra Might only applies while attacking. If it loses the Empowered status, the abilities granted by that text stop applying. Empower names the ability; Empowered names the resulting status.", rulesReference: 'Core Rules 727, 828',
  },
  {
    id: 'keyword-repeat', keyword: 'Repeat', groupId: "keyword-growth", title: 'Pay once more for a second effect',
    definition: "While playing this spell, you may pay its Repeat cost to do its instructions one extra time when it resolves. Each Repeat cost can be paid once.",
    instruction: "One Blood Rush would make our Rearguard 4 Might, so it would still die fighting the 4-Might defender. Pay the extra 1 energy for Repeat, 2 energy in total, and choose Rearguard for both effects. Doing the instructions twice gives it enough attack strength to survive and conquer the battlefield.", actionLabel: 'Pay 2 energy and repeat Blood Rush',
    before: position([card('SFD-003', 'hand', { annotation: 'Current errata: Assault lasts this turn.' }), card('OGN-010', 'battlefield-left', { might: 2, annotation: 'Attacker' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })], { energy: 2, handCount: 1 }, 'You have focus and the showdown chain is empty.'),
    after: position([card('SFD-003', 'trash'), card('OGN-010', 'battlefield-left', { might: 6, annotation: '2 base + Assault 2 + Assault 2 = 6 as an attacker.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })], { energy: 0, handCount: 0 }, 'The one chain item resolves its instructions twice.'),
    explanation: "Blood Rush gave Assault 2 twice, making Rearguard 6 Might while attacking. One use would have left both units dead; Repeat left us a survivor and a point. Only one spell went on the chain, and its instructions happened twice when it resolved. Repeat did not count as playing a second card. These Assault bonuses last only this turn.", rulesReference: 'Core Rules 807, 820; Spiritforged Errata, Blood Rush',
  },
  {
    id: 'keyword-flow', keyword: 'Flow', groupId: "keyword-equipment", title: 'Use a spell from your trash',
    definition: "Flow lets you play this spell from Trash, the used-card pile, by paying its Flow cost. Afterwards it goes to banishment, a separate out-of-play area.",
    instruction: "Dredge Up is in Trash because it has already been used. We want another card in hand, so pay its 2-energy Flow cost to use it again. Do this during our Main phase while no effect is waiting on the chain. Flow changes where we play it from, not when we may play it.", actionLabel: 'Play Dredge Up with Flow',
    before: position([card('VEN-049', 'trash')], { energy: 2, handCount: 2 }),
    after: position([card('VEN-049', 'banishment', { annotation: 'Banished after resolving from Flow.' })], { energy: 0, handCount: 3 }),
    explanation: "Dredge Up drew a useful extra card, then went to banishment instead of returning to Trash. That stops us using Flow on it repeatedly from the same pile. Flow does not give Action or Reaction permission: this card still needs its normal play timing. A spell without a rule such as Flow cannot simply be played from Trash.", rulesReference: 'Core Rules 829',
  },
  {
    id: 'keyword-deploy', keyword: 'Deploy', groupId: "keyword-surprises", title: 'Put gear at a battlefield',
    definition: "This gear must be played directly to a battlefield, including one the opponent controls. It is killed if an opponent later holds that battlefield.",
    instruction: "Our Hopeful needs extra Might to survive attacking the enemy Hopeful. Play Banner of Conquest at that enemy battlefield first. Deploy allows that location even though we do not control it. Its attack bonus will help our unit when it arrives; the Banner by itself cannot conquer.", actionLabel: 'Deploy Banner of Conquest',
    before: position([card('RAD-002', 'hand'), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })], { energy: 1, power: 1, handCount: 1 }, 'Your Main Phase, empty chain. Your available power is Fury.'),
    after: position([card('RAD-002', 'battlefield-left', { ready: true, annotation: 'Your gear; the opponent still controls the battlefield.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })], { energy: 0, power: 0, handCount: 0 }),
    explanation: "Banner gave our arriving Hopeful Assault 1, turning a 4-against-4 fight into a surviving 5-Might attacker and a point. Deploy gear goes to a battlefield, never the base. You still need a unit to conquer. If the opponent later holds this battlefield during their Beginning phase, the Banner is killed.", rulesReference: 'Core Rules 830',
  },
  {
    id: 'keyword-show-off', keyword: 'Show Off', groupId: "keyword-new-tools", title: 'Show a card without spending it',
    definition: "When playing this card, you may show the kind of card it asks for from your hand, or choose a matching friendly card on the board. Follow the card's exact requirement.",
    instruction: "We want Roar to deal enough damage to remove the enemy 4-Might Hopeful. Show our own 4-Might Hopeful from hand to set Roar's damage to 4. Our shown unit stays in hand, so we can still play it later; we are only showing its strength to power this spell's effect.", actionLabel: 'Show Hopeful and resolve Roar',
    before: position([card('RAD-082', 'hand'), card('OGN-012', 'hand', { might: 4, annotation: 'The card you will reveal.' }), card('OGN-010', 'battlefield-left', { owner: 'opponent', might: 2, ready: true })], { energy: 4, power: 2, handCount: 2 }, 'Your Main Phase, empty chain. Both available power are Body.'),
    after: position([card('RAD-082', 'trash'), card('OGN-012', 'hand', { might: 4, annotation: 'Shown to the opponent, but still in your hand.' }), card('OGN-010', 'trash', { owner: 'opponent', annotation: 'Killed by 4 damage.' })], { energy: 0, power: 0, handCount: 1 }),
    explanation: "Roar recorded the shown 4 Might and used it to kill the enemy. Our Hopeful stayed in hand. Showing off is not playing, discarding, or spending the revealed card. Later changes to that unit do not change the number already recorded for this Roar. Other Show Off cards may ask for something different, so read their own text.", rulesReference: 'Core Rules 832; Radiance Patch Notes',
  },
];

export const NEW_PLAYER_KEYWORD_GROUPS: KeywordScenarioGroup[] = [
  {
    "id": "keyword-timing",
    "title": "Action and Reaction",
    "description": "Start with when you can play: Action, then Reaction.",
    "minutes": 8,
    "scenarioIds": [
      "keyword-action",
      "keyword-reaction"
    ]
  },
  {
    "id": "keyword-combat",
    "title": "Accelerate to Deathknell",
    "description": "Accelerate, Ambush, Assault, Backline and Deathknell, one example at a time.",
    "minutes": 10,
    "scenarioIds": [
      "keyword-accelerate",
      "keyword-ambush",
      "keyword-assault",
      "keyword-backline",
      "keyword-deathknell"
    ]
  },
  {
    "id": "keyword-surprises",
    "title": "Deflect to Empowered",
    "description": "Deflect, Deploy, Disarm, Empower and Empowered: costs, attack effects and abilities to switch on.",
    "minutes": 7,
    "scenarioIds": [
      "keyword-deflect",
      "keyword-deploy",
      "keyword-disarm",
      "keyword-empower",
      "keyword-empowered"
    ]
  },
  {
    "id": "keyword-equipment",
    "title": "Equip to Hunt",
    "description": "Equip, Flow, Ganking, Hidden and Hunt: use your cards in new ways.",
    "minutes": 7,
    "scenarioIds": [
      "keyword-equip",
      "keyword-flow",
      "keyword-ganking",
      "keyword-hidden",
      "keyword-hunt"
    ]
  },
  {
    "id": "keyword-growth",
    "title": "Legion to Shield",
    "description": "Legion, Level, Quick-Draw, Repeat and Shield: set up benefits and use them in a fight.",
    "minutes": 8,
    "scenarioIds": [
      "keyword-legion",
      "keyword-level",
      "keyword-quick-draw",
      "keyword-repeat",
      "keyword-shield"
    ]
  },
  {
    "id": "keyword-new-tools",
    "title": "Show Off to Weaponmaster",
    "description": "Show Off, Tank, Temporary, Unique, Vision and Weaponmaster complete the alphabet.",
    "minutes": 7,
    "scenarioIds": [
      "keyword-show-off",
      "keyword-tank",
      "keyword-temporary",
      "keyword-unique",
      "keyword-vision",
      "keyword-weaponmaster"
    ]
  }
];


/** Optional legend abilities stay unused; chosen champions remain in their zones. */
export const KEYWORD_LEGEND_PAIRS: KeywordLegendPair[] = [
  {
    "domains": [
      "Fury",
      "Mind"
    ],
    "legend": {
      "instanceId": "p-legend",
      "cardId": "OGN-247",
      "name": "Kai'Sa, Daughter of the Void",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/a576472c7bb00f475882ac814e1d8f9be233b402-744x1040.png?accountingTag=RB",
      "type": "legend",
      "zone": "legend",
      "owner": "player",
      "ready": true,
      "domains": [
        "Fury",
        "Mind"
      ],
      "energyCost": 0,
      "powerCost": 0,
      "baseMight": 0,
      "text": "Exhaust as a Reaction to add 1 power of any domain, restricted to playing spells.",
      "keywords": []
    },
    "champion": {
      "instanceId": "p-champion",
      "cardId": "OGN-039",
      "name": "Kai'Sa, Survivor",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/3d942c02ad4e96a36dba14d663c5105bb6614500-744x1039.png?accountingTag=RB",
      "type": "unit",
      "zone": "champion",
      "owner": "player",
      "ready": true,
      "domains": [
        "Fury"
      ],
      "energyCost": 4,
      "powerCost": 0,
      "baseMight": 4,
      "text": "Accelerate. Draw 1 when this unit conquers.",
      "keywords": [
        "Accelerate"
      ]
    }
  },
  {
    "domains": [
      "Fury",
      "Order"
    ],
    "legend": {
      "instanceId": "p-legend",
      "cardId": "OGN-253",
      "name": "Darius, Hand of Noxus",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/5b9a904048b7fb936377844ec2d31564b7fedf81-744x1039.png?accountingTag=RB",
      "type": "legend",
      "zone": "legend",
      "owner": "player",
      "ready": true,
      "domains": [
        "Fury",
        "Order"
      ],
      "energyCost": 0,
      "powerCost": 0,
      "baseMight": 0,
      "text": "Exhaust as a Reaction to add 1 energy if Legion is active.",
      "keywords": []
    },
    "champion": {
      "instanceId": "p-champion",
      "cardId": "OGN-027",
      "name": "Darius, Trifarian",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/bf7a4900fd2296972c1305a4707c23860bb0522e-744x1039.png?accountingTag=RB",
      "type": "unit",
      "zone": "champion",
      "owner": "player",
      "ready": true,
      "domains": [
        "Fury"
      ],
      "energyCost": 5,
      "powerCost": 1,
      "baseMight": 5,
      "text": "When you play your second card in a turn, ready this unit and give it +2 Might for the turn.",
      "keywords": []
    }
  },
  {
    "domains": [
      "Fury",
      "Body"
    ],
    "legend": {
      "instanceId": "p-legend",
      "cardId": "VEN-141",
      "name": "Renekton, Butcher of the Sands",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/7620595b36b40a0c3d05c4c5469b016d1c18c6f2-744x1039.png?accountingTag=RB",
      "type": "legend",
      "zone": "legend",
      "owner": "player",
      "ready": true,
      "domains": [
        "Fury",
        "Body"
      ],
      "energyCost": 0,
      "powerCost": 0,
      "baseMight": 0,
      "text": "Pay 2 power of any domain and exhaust as a Reaction to add 2 energy, restricted to units and unit activated abilities.",
      "keywords": []
    },
    "champion": {
      "instanceId": "p-champion",
      "cardId": "VEN-092",
      "name": "Renekton, Brute",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0b4340e30e46f1784b31b9a110903825b7428a94-744x1039.png?accountingTag=RB",
      "type": "unit",
      "zone": "champion",
      "owner": "player",
      "ready": true,
      "domains": [
        "Body"
      ],
      "energyCost": 5,
      "powerCost": 0,
      "baseMight": 4,
      "text": "Pay 1 energy to gain +1 Might for the turn. When this unit reaches 10 Might, empower it. While Empowered, it has Deflect and Ganking.",
      "keywords": [
        "Empowered"
      ]
    }
  },
  {
    "domains": [
      "Chaos",
      "Mind"
    ],
    "legend": {
      "instanceId": "p-legend",
      "cardId": "OGN-263",
      "name": "Teemo, Swift Scout",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/9723181e3392bb61c2aabc804a44f7b0558cedf1-744x1039.png?accountingTag=RB",
      "type": "legend",
      "zone": "legend",
      "owner": "player",
      "ready": true,
      "domains": [
        "Chaos",
        "Mind"
      ],
      "energyCost": 0,
      "powerCost": 0,
      "baseMight": 0,
      "text": "You may pay 1 energy instead of power to hide a Hidden card. Pay 1 energy and exhaust to return an owned Teemo unit from the board or Champion Zone to hand.",
      "keywords": []
    },
    "champion": {
      "instanceId": "p-champion",
      "cardId": "OGN-197",
      "name": "Teemo, Scout",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/ca8a2e11dd78dd09ad1c9ad3a23e5699254b947e-744x1039.png?accountingTag=RB",
      "type": "unit",
      "zone": "champion",
      "owner": "player",
      "ready": true,
      "domains": [
        "Chaos"
      ],
      "energyCost": 2,
      "powerCost": 0,
      "baseMight": 1,
      "text": "Hidden. When played, this unit gets +3 Might for the turn.",
      "keywords": [
        "Hidden"
      ]
    }
  },
  {
    "domains": [
      "Calm",
      "Mind"
    ],
    "legend": {
      "instanceId": "p-legend",
      "cardId": "SFD-189",
      "name": "Ornn, Fire Below the Mountain",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/ed58d654034d545e54c85d836f3a6552772dd75b-744x1039.png?accountingTag=RB",
      "type": "legend",
      "zone": "legend",
      "owner": "player",
      "ready": true,
      "domains": [
        "Calm",
        "Mind"
      ],
      "energyCost": 0,
      "powerCost": 0,
      "baseMight": 0,
      "text": "Exhaust as a Reaction to add 1 power of any domain, restricted to playing gear or using gear abilities.",
      "keywords": []
    },
    "champion": {
      "instanceId": "p-champion",
      "cardId": "SFD-058",
      "name": "Ornn, Blacksmith",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/77b48a28f48f26714f4bcf860379945a2d7186aa-744x1039.png?accountingTag=RB",
      "type": "unit",
      "zone": "champion",
      "owner": "player",
      "ready": true,
      "domains": [
        "Calm"
      ],
      "energyCost": 5,
      "powerCost": 1,
      "baseMight": 5,
      "text": "When played or when this unit holds, inspect the top 4 Main Deck cards. You may reveal and draw one gear; recycle the rest.",
      "keywords": []
    }
  },
  {
    "domains": [
      "Calm",
      "Order"
    ],
    "legend": {
      "instanceId": "p-legend",
      "cardId": "VEN-147",
      "name": "Shen, Eye of Twilight",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/54388a3124b7e1f0331e5970f952778db5f24500-744x1039.png?accountingTag=RB",
      "type": "legend",
      "zone": "legend",
      "owner": "player",
      "ready": true,
      "domains": [
        "Calm",
        "Order"
      ],
      "energyCost": 0,
      "powerCost": 0,
      "baseMight": 0,
      "text": "Exhaust with Action timing to give a friendly unit Tank for the turn.",
      "keywords": []
    },
    "champion": {
      "instanceId": "p-champion",
      "cardId": "OGN-241",
      "name": "Shen, Kinkou",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/25f3a9fa33201278ebf475b2d02dae8c0c0cb20c-744x1039.png?accountingTag=RB",
      "type": "unit",
      "zone": "champion",
      "owner": "player",
      "ready": true,
      "domains": [
        "Order"
      ],
      "energyCost": 3,
      "powerCost": 1,
      "baseMight": 3,
      "text": "Reaction. Shield 2. Tank.",
      "keywords": [
        "Reaction",
        "Shield",
        "Tank"
      ]
    }
  },
  {
    "domains": [
      "Mind",
      "Order"
    ],
    "legend": {
      "instanceId": "p-legend",
      "cardId": "OGN-265",
      "name": "Viktor, Herald of the Arcane",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/913236dabf1e4f71650bbba46870fff8163e2eff-744x1039.png?accountingTag=RB",
      "type": "legend",
      "zone": "legend",
      "owner": "player",
      "ready": true,
      "domains": [
        "Mind",
        "Order"
      ],
      "energyCost": 0,
      "powerCost": 0,
      "baseMight": 0,
      "text": "Pay 1 energy and exhaust to play a 1-Might Recruit unit token.",
      "keywords": []
    },
    "champion": {
      "instanceId": "p-champion",
      "cardId": "OGN-117",
      "name": "Viktor, Innovator",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/35be0b10f13611b4f5d828f2a79001036ab57ba1-744x1039.png?accountingTag=RB",
      "type": "unit",
      "zone": "champion",
      "owner": "player",
      "ready": true,
      "domains": [
        "Mind"
      ],
      "energyCost": 4,
      "powerCost": 1,
      "baseMight": 3,
      "text": "When you play a card on an opponent turn, play a 1-Might Recruit token in your base.",
      "keywords": []
    }
  }
];

const nativeActions: Record<string, TutorialAction> = {
  'keyword-accelerate': { type:'play', cardId:'player-OGN-010', destination:'base' },
  'keyword-action': { type:'play', cardId:'player-OGN-004', targetId:'player-OGN-010' },
  'keyword-reaction': { type:'play', cardId:'player-OGN-058', targetId:'player-OGN-096' },
  'keyword-ganking': { type:'move', cardId:'player-OGN-036', destination:'battlefield-right' },
  'keyword-ambush': { type:'play', cardId:'player-UNL-002', destination:'battlefield-left' },
  'keyword-assault': { type:'move', cardId:'player-OGN-215', destination:'battlefield-left' },
  'keyword-shield': { type:'end-turn' },
  'keyword-tank': { type:'demonstrate-combat' },
  'keyword-backline': { type:'demonstrate-combat' },
  'keyword-deflect': { type:'play', cardId:'player-OGN-213', targetId:'opponent-OGN-013' },
  'keyword-disarm': { type:'resolve' },
  'keyword-hidden': { type:'play', cardId:'player-OGN-213', targetId:'opponent-OGN-215', destination:'battlefield-left' },
  'keyword-deathknell': { type:'resolve' },
  'keyword-temporary': { type:'resolve' },
  'keyword-vision': { type:'play', cardId:'player-OGN-171', destination:'base' },
  'keyword-equip': { type:'activate', cardId:'player-SFD-022', targetId:'player-OGN-010' },
  'keyword-quick-draw': { type:'play', cardId:'player-SFD-022', targetId:'player-OGN-096' },
  'keyword-weaponmaster': { type:'play', cardId:'player-SFD-002', destination:'base' },
  'keyword-unique': { type:'remove-draft-copy', cardId:'cape-second' },
  'keyword-legion': { type:'play', cardId:'player-OGN-012', destination:'base' },
  'keyword-hunt': { type:'score' },
  'keyword-level': { type:'play', cardId:'player-UNL-016', destination:'base' },
  'keyword-empower': { type:'activate', cardId:'player-VEN-001' },
  'keyword-empowered': { type:'move', cardId:'player-VEN-001', destination:'battlefield-left' },
  'keyword-repeat': { type:'play', cardId:'player-SFD-003', targetId:'player-OGN-010' },
  'keyword-flow': { type:'play', cardId:'player-VEN-049' },
  'keyword-deploy': { type:'play', cardId:'player-RAD-002', destination:'battlefield-left' },
  'keyword-show-off': { type:'play', cardId:'player-RAD-082', targetId:'opponent-OGN-010' },
};
const boardPosition = (changes: Partial<KeywordBoardPosition> = {}): KeywordBoardPosition => ({ phase:'Main', turnPlayer:'player', priority:'player', controllers:[null,null], chain:[], combat:null, ...changes });
const battle = (attacker: TutorialSide, assignments: Record<string, number> = {}): NonNullable<TutorialBoard['combat']> => ({ battlefieldId:'battlefield-left', attacker, assignments });
const chainItem = (id:string, cardId:string, controller:TutorialSide, label:string, targetId?:string): TutorialBoard['chain'][number] => ({ id, cardId, controller, label, ...(targetId ? {targetId} : {}) });
const nativePositions: Record<string, [Partial<KeywordBoardPosition>, Partial<KeywordBoardPosition>]> = {
  'keyword-action': [{phase:'Main',controllers:['opponent',null],combat:null},{phase:'Combat showdown',controllers:['opponent',null],combat:battle('player')}],
  'keyword-reaction': [{phase:'Combat showdown',turnPlayer:'opponent',controllers:['player',null],combat:battle('opponent'),chain:[chainItem('opponent-OGN-004','OGN-004','opponent','Cleave → Legion Rearguard','opponent-OGN-010')]},{phase:'Combat showdown',turnPlayer:'opponent',controllers:['player',null],combat:battle('opponent'),chain:[chainItem('opponent-OGN-004','OGN-004','opponent','Cleave still waiting → Legion Rearguard','opponent-OGN-010')]}],
  'keyword-ganking': [{controllers:['player','player']},{controllers:[null,'player']}],
  'keyword-ambush': [{phase:'Combat showdown',controllers:['opponent',null],combat:battle('player')},{phase:'Combat showdown',controllers:['opponent',null],combat:battle('player')}],
  'keyword-assault': [{controllers:['opponent',null]},{phase:'Combat showdown',controllers:['opponent',null],combat:battle('player')}],
  'keyword-shield': [{controllers:['player',null]},{phase:'Combat showdown',turnPlayer:'opponent',controllers:['player',null],combat:battle('opponent'),opponentRuneCount:6,opponentRunesReady:true}],
  'keyword-tank': [{phase:'Combat damage',priority:null,controllers:['opponent',null],combat:battle('player')},{phase:'Combat damage',priority:null,controllers:['opponent',null],combat:battle('player',{'opponent-OGN-054':4})}],
  'keyword-backline': [{phase:'Combat damage',priority:null,controllers:['opponent',null],combat:battle('player')},{phase:'Combat damage',priority:null,controllers:['opponent',null],combat:battle('player',{'opponent-OGN-096':1,'opponent-UNL-043':3})}],
  'keyword-deflect': [{controllers:['opponent',null]},{priority:'opponent',controllers:['opponent',null],chain:[chainItem('player-OGN-213','OGN-213','player','Hidden Blade → Pouty Poro; costs including Deflect paid','opponent-OGN-013')]}],
  'keyword-disarm': [{phase:'Combat showdown',priority:null,controllers:['opponent',null],combat:battle('player'),chain:[chainItem('player-RAD-050','RAD-050','player','Disarm 2 → Noxus Hopeful','opponent-OGN-012')]},{phase:'Combat showdown',controllers:['opponent',null],combat:battle('player')}],
  'keyword-hidden': [{phase:'Combat showdown',turnPlayer:'opponent',controllers:['player',null],combat:battle('opponent')},{turnPlayer:'opponent',priority:'opponent',controllers:['player','opponent'],scoredBy:{'battlefield-right':['opponent']}}],
  'keyword-deathknell': [{priority:null,chain:[chainItem('player-OGN-096','OGN-096','player','Watchful Sentry — Deathknell: draw 1')]},{}],
  'keyword-temporary': [{phase:'Beginning',priority:null,controllers:['player',null],chain:[chainItem('player-UNL-T07','UNL-T07','player','Sprite — Temporary: kill this before holding')]},{phase:'Beginning',controllers:[null,null]}],
  'keyword-quick-draw': [{phase:'Combat showdown',turnPlayer:'opponent',controllers:['player',null],combat:battle('opponent')},{phase:'Combat showdown',turnPlayer:'opponent',controllers:['player',null],combat:battle('opponent')}],
  'keyword-unique': [{phase:'Deck check',priority:null},{phase:'Deck check',priority:null}],
  'keyword-hunt': [{phase:'Conquer'},{controllers:['player',null],scoredBy:{'battlefield-left':['player']}}],
  'keyword-empowered': [{controllers:['opponent',null]},{phase:'Combat showdown',controllers:['opponent',null],combat:battle('player')}],
  'keyword-repeat': [{phase:'Combat showdown',controllers:['opponent',null],combat:battle('player')},{phase:'Combat showdown',controllers:['opponent',null],combat:battle('player')}],
  'keyword-deploy': [{controllers:['opponent',null]},{controllers:['opponent',null]}],
  'keyword-show-off': [{controllers:['opponent',null]},{}],
};

// Consequential positions: printed numbers establish the problem, and the
// sequence carries the keyword through to its real result on this table.
const scenarioFor = (keyword:string) => NEW_PLAYER_KEYWORD_SCENARIOS.find(s=>s.keyword===keyword)!;
const replaceCard = (s:KeywordScenario, oldId:string, newId:string, owner:TutorialSide, might:number) => {
  for(const snapshot of [s.before,s.after]) snapshot.cards=snapshot.cards.map(c=>c.cardId===oldId&&c.owner===owner?card(newId,c.zone,{owner,ready:c.ready,might}):c);
};
const addEnemy = (s:KeywordScenario, id:string, might:number, zone='battlefield-left') => {
  for(const snapshot of [s.before,s.after])snapshot.cards.push(card(id,zone,{owner:'opponent',might,ready:true}));
  nativePositions[s.id]=[{controllers:['opponent',null]}, {controllers:['opponent',null]}];
};
const finishFight = (s:KeywordScenario, source:string, enemy:string, damage:number, returned:number, conquer=true, field:TutorialBattlefieldId='battlefield-left') => {
  s.followThrough={...s.followThrough,combat:{sourceIds:[source],targetAssignments:[{cardId:enemy,amount:damage,order:1,label:`Your side assigns ${damage}.`}],returnAssignments:[{cardId:source,amount:returned,order:1,label:`The opposing side assigns ${returned}.`}],explanation:'Might is each unit’s fighting strength. These counters show where the damage will go; it has not happened yet. Both sides will deal their damage at the same time when you resolve, so a killed unit still deals its assigned damage.'},...(conquer?{conquer:field}:{})};
};
{
  const s=scenarioFor('Assault');replaceCard(s,'OGN-012','OGN-215','opponent',5);
  
  finishFight(s,'player-OGN-215','opponent-OGN-215',6,5);
  s.objective={goal:'Win an otherwise even fight and conquer the battlefield.',without:'At 5 against 5, both units would die.',with:'Your attacker is 6: it kills the defender, survives 5 damage, then conquers.'};
  
}
{
  const s=scenarioFor('Shield');replaceCard(s,'OGN-012','OGN-054','opponent',3);
  
  finishFight(s,'player-OGN-054','opponent-OGN-054',4,3,false);
  s.objective={goal:'Defend your battlefield and retain control through an evenly matched attack.',without:'Two 3-Might units would kill each other.',with:'Your defender becomes 4, survives the attacker’s 3, and retains control for a later holding check.'};
  
}
{
  const s=scenarioFor('Action');replaceCard(s,'OGN-096','OGN-012','opponent',4);
  finishFight(s,'player-OGN-010','opponent-OGN-012',5,4);
  s.objective={goal:'Strengthen your attacker before damage so it can survive and conquer.',without:'Your 2-Might Rearguard cannot beat a 4-Might Hopeful.',with:'Action lets Cleave resolve in the showdown: 5 beats 4 and survives.'};
  
}
{
  const s=scenarioFor('Reaction');replaceCard(s,'OGN-096','OGN-054','player',4);
  s.after.cards.find(c=>c.instanceId==='player-OGN-054')!.might=6;
  nativeActions[s.id]={type:'play',cardId:'player-OGN-058',targetId:'player-OGN-054'};
  
  finishFight(s,'player-OGN-054','opponent-OGN-010',6,2,false);
  s.objective={goal:'Help your defender, then use the card you draw before the older spell happens.',without:'An unanswered Cleave would make the enemy attacker 5 Might.',with:'Discipline strengthens Guardian and draws Defy. A fresh response window lets Defy counter the still-waiting Cleave.'};
  
}
{
  const s=scenarioFor('Ganking');replaceCard(s,'OGN-096','OGN-010','player',2);
  for(const snap of [s.before,s.after]){const c=snap.cards.find(c=>c.cardId==='OGN-010')!;c.owner='opponent';c.instanceId='opponent-OGN-010';}
  nativePositions[s.id]=[{phase:'Awaken',controllers:['player','opponent'],scoredBy:{}},{controllers:[null,'opponent'],scoredBy:{'battlefield-left':['player']}}];
  s.before.player.score=1;s.after.player.score=2;
  finishFight(s,'player-OGN-036','opponent-OGN-010',5,2,true,'battlefield-right');
  
  s.objective={goal:'Ready Vi, earn a holding point, then prepare her to conquer the other battlefield.',without:'A unit without Ganking must return to base before its next normal move can reach another battlefield.',with:'Use Vi’s ability twice in your open Main phase, paying a Trash card each time. She stays ready to Gank across and earn another point.'};
  
}
{
  const s=scenarioFor('Accelerate');s.followThrough={move:{cardId:'player-OGN-010',destination:'battlefield-left'},conquer:'battlefield-left'};
  s.objective={goal:'Conquer an empty battlefield on the turn you play a unit.',without:'An exhausted Rearguard would have to wait for Awaken before moving.',with:'Paying Accelerate lets it enter ready, move now and conquer for a point.'};
  
}
{
  const s=scenarioFor('Equip');addEnemy(s,'OGN-010',2);s.followThrough={move:{cardId:'player-OGN-010',destination:'battlefield-left'}};finishFight(s,'player-OGN-010','opponent-OGN-010',4,2);
  s.objective={goal:'Turn equal 2-Might units into a fight your unit survives.',without:'The two Rearguards would kill each other.',with:'Equip gives yours +2. It moves with its sword, survives and conquers the battlefield.'};
  
}
{
  const s=scenarioFor('Quick-Draw');replaceCard(s,'OGN-012','OGN-010','opponent',2);finishFight(s,'player-OGN-096','opponent-OGN-010',3,2,false);
  s.objective={goal:'Save a small defender when the attack has already started.',without:'Your 1-Might Sentry would die to the 2-Might Rearguard.',with:'Quick-Draw plays and attaches the sword during the showdown. Sentry becomes 3 and survives, so you retain control for a later holding check.'};
  
}
{
  const s=scenarioFor('Weaponmaster');addEnemy(s,'SFD-002',6);s.followThrough={waitForNextTurn:true,move:{cardId:'player-SFD-002',destination:'battlefield-left'}};finishFight(s,'player-SFD-002','opponent-SFD-002',8,6);
  s.objective={goal:'Give your new unit a sword without another power payment, then win its next attack.',without:'Two 6-Might Assailants without Equipment would kill each other.',with:'Weaponmaster attaches the existing sword for zero. Next turn your 8-Might attacker survives and conquers the battlefield.'};
  
}
for(const keyword of ['Empower','Empowered']){
  const s=scenarioFor(keyword);
  if(keyword==='Empower'){addEnemy(s,'SFD-002',6);s.followThrough={move:{cardId:'player-VEN-001',destination:'battlefield-left'}};}
  else replaceCard(s,'OGN-012','SFD-002','opponent',6);
  finishFight(s,'player-VEN-001','opponent-SFD-002',8,6);
  s.objective={goal:'Switch on the attack bonus and beat an equal-sized defender.',without:'At printed 6 against 6, both units would die.',with:'Empowered text grants Assault 2: your 8-Might attacker survives 6 damage and conquers.'};
  
}
{
  const s=scenarioFor('Disarm');finishFight(s,'player-RAD-050','opponent-OGN-012',4,2);
  s.objective={goal:'Win a fight between units with the same printed Might.',without:'Your 4-Might Chronomancer and the 4-Might Hopeful would kill each other.',with:'The attack trigger reduces Hopeful to 2. Chronomancer survives and conquers the battlefield.'};
  
}
{
  const s=scenarioFor('Repeat');finishFight(s,'player-OGN-010','opponent-OGN-012',6,4);
  s.objective={goal:'Keep your attacker alive while conquering the battlefield.',without:'One Blood Rush gives 4 Might: your Rearguard and the 4-Might defender would kill each other.',with:'Paying Repeat gives two Assault 2 effects: at 6 your attacker survives and conquers the battlefield.'};
  
}
{
  const s=scenarioFor('Level');s.followThrough={move:{cardId:'player-UNL-016',destination:'battlefield-left'},conquer:'battlefield-left'};
  s.objective={goal:'Use earned experience points to play a ready unit and conquer a battlefield now.',without:'Below Level 3, Scorchclaw would enter exhausted at 3 Might.',with:'At 3 XP it enters ready at 4, moves immediately and conquers the battlefield. XP is not spent.'};
  
}
{
  const s=scenarioFor('Hunt');s.before.player.xp=1;s.after.player.xp=3;s.after.cards[0].might=4;
  s.objective={goal:'Score with Scorchclaw to earn enough experience points for its Level ability.',without:'Your existing 1 XP is below Level 3, so Scorchclaw has 3 Might.',with:'Conquering scores a point; the separate Hunt 2 trigger brings you to 3 XP and activates +1 Might.'};
  
}
{
  const s=scenarioFor('Deploy');for(const snap of [s.before,s.after])snap.cards.push(card('OGN-012','base',{might:4,ready:true}));
  s.followThrough={move:{cardId:'player-OGN-012',destination:'battlefield-left'}};finishFight(s,'player-OGN-012','opponent-OGN-012',5,4);
  s.objective={goal:'Prepare an enemy battlefield so your next attacker can conquer it.',without:'The two 4-Might Hopefuls would kill each other.',with:'Deploy puts the Banner at the enemy battlefield first. Your arriving Hopeful gains Assault 1, survives and conquers the battlefield.'};
  
}
{
  const s=scenarioFor('Show Off');replaceCard(s,'OGN-010','OGN-012','opponent',4);nativeActions[s.id]={type:'play',cardId:'player-RAD-082',targetId:'opponent-OGN-012'};
  s.objective={goal:'Remove a 4-Might enemy without spending the unit you reveal.',without:'The revealed Hopeful is still only a card in hand; it cannot deal combat damage from there.',with:'Show Off records its 4 Might for Roar. The spell kills the enemy while Hopeful stays available to play later.'};
  
}
const remainingObjectives:Record<string,[string,string,string]>={
  Tank:['Protect the smaller ally behind the Tank.','Without Tank, the attacker could choose lethal on Sentry first.','Tank requires all 4 damage on Guardian. Sentry survives and the defending side retains control of the battlefield until a later holding check.'],
  Backline:['Finish a fight while respecting the protected unit’s order.','Promoter cannot be selected for lethal first while its ordinary ally remains unassigned.','Allocate 1 to Sentry before the remaining 3 to Promoter; your attacker survives and can conquer.'],
  Deflect:['Budget enough power to remove a protected threat.','The ordinary spell cost is insufficient when targeting this enemy.','Pay the extra power, remove Pouty Poro and leave its battlefield empty.'],
  Hidden:['Use a local hidden response, then compare an attack at the other battlefield.','After a paid Discipline, the enemy Sentry has 3 Might against your Sentry’s 1.','Blade can turn your local Sentry into extra cards. It cannot target the enemy if the guide instead moves to the other battlefield.'],
  Deathknell:['Draw a replacement after your small unit loses a fight.','An ordinary defender would die without drawing a card to replace it.','The Sentry dies, but its separate ability draws a replacement card.'],
  Temporary:['Check whether a token can really hold next turn.','If you still control this battlefield at the Beginning holding check, you normally score a point.','Temporary kills this token before holding, so the apparently safe point is unavailable.'],
  Vision:['Look for a stronger next draw after playing your small unit.','Leaving another small Sentry on top would give you another small unit on your next draw.','Predict moves that duplicate to the bottom; your next draw reaches Mysterious Chronomancer, a larger unit whose Disarm can help win a future attack.'],
  Unique:['Turn a proposed 41-card draft into a legal 40-card main deck.','The extra Forgefire Cape violates Unique even though its domains and Signature match Ornn.','Remove only the extra copy; the complete listed deck now has one Cape and 40 cards including its chosen champion.'],
  Legion:['Play two units with only four available energy.','Their ordinary costs total 6: Rearguard 2 plus Hopeful 4.','Play Rearguard first; Hopeful’s Legion reduces its cost to 2, so you can afford both this turn.'],
  Flow:['Get another useful card from a spell you have already used.','A normal spell in the trash cannot simply be played again.','Flow lets you spend 2 energy to draw a new card, then puts Dredge Up in banishment so it cannot be used from Trash again.'],
};
for(const [keyword,[goal,without,withEffect]] of Object.entries(remainingObjectives))scenarioFor(keyword).objective={goal,without,with:withEffect};

// These are authored before/after examples, not a general-purpose rules solver.
// Each uses actual cards, legal domain identities and a real board gesture.
for (const scenario of NEW_PLAYER_KEYWORD_SCENARIOS) {
  const domainsFor = (owner:TutorialSide) => [...new Set([...scenario.before.cards,...scenario.after.cards].filter(c=>c.owner===owner).flatMap(c=>c.domains??[]))];
  const fits = (pair:KeywordLegendPair, domains:TutorialDomain[]) => domains.every(domain=>pair.domains.includes(domain));
  const player = scenario.keyword==='Unique' ? KEYWORD_LEGEND_PAIRS.find(pair=>pair.legend.cardId==='SFD-189')! : scenario.keyword==='Reaction' ? KEYWORD_LEGEND_PAIRS.find(pair=>pair.legend.cardId==='VEN-147')! : KEYWORD_LEGEND_PAIRS.find(pair=>fits(pair,domainsFor('player')))!;
  const opponent = KEYWORD_LEGEND_PAIRS.find(pair=>pair.legend.cardId!==player.legend.cardId&&fits(pair,domainsFor('opponent')))!;
  if (!player || !opponent) throw new Error(`No legal keyword identity for ${scenario.id}`);
  const positions = nativePositions[scenario.id] ?? [{},{}];
  scenario.boardAction = nativeActions[scenario.id];
  scenario.board = {playerLegendId:player.legend.cardId,opponentLegendId:opponent.legend.cardId,powerDomain:scenario.before.cards.find(c=>c.owner==='player'&&(c.powerCost??0)>0)?.domains?.[0]??player.domains[0],runeCount:scenario.keyword==='Unique'?0:Math.max(4,scenario.before.player.energy??0),before:boardPosition(positions[0]),after:boardPosition(positions[1])};
  if (scenario.id==='keyword-shield') scenario.after.opponent={handCount:1};
  if (scenario.id==='keyword-equip') scenario.after.cards.find(c=>c.cardId==='SFD-022')!.attachedTo='player-OGN-010';
  if (scenario.id==='keyword-quick-draw') scenario.after.cards.find(c=>c.cardId==='SFD-022')!.attachedTo='player-OGN-096';
  if (scenario.id==='keyword-weaponmaster') scenario.after.cards.find(c=>c.cardId==='SFD-022')!.attachedTo='player-SFD-002';
  if (scenario.id==='keyword-empower'||scenario.id==='keyword-empowered') {
    scenario.before.cards.find(c=>c.cardId==='VEN-001')!.empowered=scenario.id==='keyword-empowered';
    scenario.after.cards.find(c=>c.cardId==='VEN-001')!.empowered=true;
  }
  if (scenario.id==='keyword-tank'||scenario.id==='keyword-backline') {
    const tank=scenario.id==='keyword-tank';
    scenario.combatDemonstration={sourceIds:['player-OGN-012'],targetAssignments:tank?[{cardId:'opponent-OGN-054',amount:4,order:1,label:'Tank receives all 4; nothing remains for Sentry.'}]:[{cardId:'opponent-OGN-096',amount:1,order:1,label:'First, 1 lethal damage to the non-Backline Sentry.'},{cardId:'opponent-UNL-043',amount:3,order:2,label:'Then all remaining 3 to the Backline Promoter.'}],returnAssignments:[{cardId:'player-OGN-012',amount:tank?5:3,order:1,label:'The defenders assign their combined Might back.'}],explanation:scenario.explanation};
  }
}


// These examples now start before the relevant actions, so learners perform the
// sequence instead of jumping between two completed illustrations.
{
  const ambush = NEW_PLAYER_KEYWORD_SCENARIOS.find(s => s.keyword === 'Ambush')!;
  ambush.before.cards = [card('UNL-002','hand',{might:1}),card('OGN-096','battlefield-left',{might:1,annotation:'Your attacker'}),card('OGN-096','battlefield-left',{owner:'opponent',might:1,ready:true}),card('OGN-058','chain',{owner:'opponent',annotation:'Discipline is waiting: target the defending Sentry.'})];
  ambush.after.cards = [card('UNL-002','battlefield-left',{might:3,annotation:'Entered exhausted; attacker with Assault 2.'}),card('OGN-096','battlefield-left',{might:1}),card('OGN-096','battlefield-left',{owner:'opponent',might:3,ready:true}),card('OGN-058','trash',{owner:'opponent'})];
  ambush.board!.opponentLegendId='SFD-189';
  ambush.board!.before.chain=[chainItem('opponent-OGN-058','OGN-058','opponent','Discipline → defending Sentry','opponent-OGN-096')];
  
  
  const death = NEW_PLAYER_KEYWORD_SCENARIOS.find(s => s.keyword === 'Deathknell')!;
  death.before.cards.push(card('OGN-010','battlefield-left',{owner:'opponent',might:2,ready:false,annotation:'Opponent’s attacker: 2 damage.'}));
  death.after.cards.push(card('OGN-010','battlefield-left',{owner:'opponent',might:2,ready:false}));
}

{
  const hidden=NEW_PLAYER_KEYWORD_SCENARIOS.find(s=>s.keyword==='Hidden')!;
  hidden.boardAction={type:'play',cardId:'player-OGN-213',targetId:'player-OGN-096',destination:'battlefield-left'};
  
}

{
 const s=scenarioFor('Ambush');
 s.objective={goal:'Bring enough damage to win a fight that your small attacker would lose.',without:'After Discipline, the 3-Might defender defeats your 1-Might Sentry.',with:'Inferna adds 3 attacking Might immediately. Together your units deal 4, remove the defender and leave Sentry to conquer.'};
 s.followThrough={combat:{sourceIds:['player-OGN-096','player-UNL-002'],targetAssignments:[{cardId:'opponent-OGN-096',amount:4,order:1}],returnAssignments:[{cardId:'player-UNL-002',amount:3,order:1,label:'The guide assigns its 3 to Inferna; your Sentry survives.'}],explanation:'Your side has 4 Might against the defender’s 3. Damage is simultaneous. Inferna and the enemy Sentry will die; your original Sentry remains.'},deathknells:['opponent-OGN-096'],conquer:'battlefield-left'};
 
 const backline=scenarioFor('Backline');backline.followThrough={conquer:'battlefield-left'};
}

{
 const s=scenarioFor('Vision');s.after.cards.push(card('RAD-050','hand',{instanceId:'vision-next',might:4,annotation:'Drawn next turn after recycling the Sentry.'}));s.after.player.handCount=1;
 
}

/** Additional published-deck identities, verified against registry and official artwork. */
export const KEYWORD_DECK_IDENTITIES = {
  "SFD-213": {"name": "Ornn's Forge", "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e228948bc7a6d8ee858fbc0bed3d93a53f467097-1039x744.png?accountingTag=RB", "type": "battlefield", "domains": [], "energyCost": 0, "powerCost": 0, "baseMight": 0, "text": "While you control this battlefield, the first friendly non–token gear played each turn costs [1] less.", "keywords": []},
  "SFD-085": {
    "name": "Ornn, Forge God",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/f33c4ea9010ea5f440d4470554845c0ecae2c893-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Mind"
    ],
    "energyCost": 6,
    "powerCost": 0,
    "baseMight": 4,
    "text": "[Deflect 2] (Opponents must pay [Rune][Rune] to choose me with a spell or ability.)\n[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for [Rune] less, even if it's already attached.)\nI have +1 [Might] for each friendly gear.",
    "keywords": []
  },
  "OGN-246A": {
    "name": "Viktor, Leader",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/19b66f8eccd6d6e9d41048f73e44660f1cf77068-744x1039.png?accountingTag=RB",
    "type": "unit",
    "domains": [
      "Order"
    ],
    "energyCost": 4,
    "powerCost": 1,
    "baseMight": 4,
    "text": "When another non-Recruit unit you control dies, play a 1-Might Recruit token into your base.",
    "keywords": []
  },
  "OGN-296": {
    "name": "Void Gate",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/14a52a367fd41fd84745e050e62d1f281f733467-1038x744.png?accountingTag=RB",
    "type": "battlefield",
    "domains": [],
    "energyCost": 0,
    "powerCost": 0,
    "baseMight": 0,
    "text": "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 – 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nSpells and abilities deal 1 Bonus Damage to units here.\n(Each instance of damage the spell deals to a unit here is\nincreased by 1.)",
    "keywords": []
  },
  "OGN-293": {
    "name": "The Grand Plaza",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/f9ca8d04cb269ad99bca7e6dae874cad1bec336a-1038x744.png?accountingTag=RB",
    "type": "battlefield",
    "domains": [],
    "energyCost": 0,
    "powerCost": 0,
    "baseMight": 0,
    "text": "When you hold here, if you have 7+ units here, you win the game.",
    "keywords": []
  },
  "UNL-078": {
    "name": "Sprite Fountain",
    "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/fcb3ea3e8f829b8dc845fbf49080552d635bb47b-744x1039.png?accountingTag=RB",
    "type": "gear",
    "domains": [
      "Mind"
    ],
    "energyCost": 2,
    "powerCost": 1,
    "baseMight": 0,
    "text": "[Temporary] (Kill this at the start of its controller's Beginning Phase, before scoring.)\nWhen you play this, play a ready 3 [Might] Sprite unit token with [Temporary] to your base.\n[Deathknell] Repeat this gear's play effect. (When this dies, get the effect.)",
    "keywords": [
      "Temporary",
      "Deathknell"
    ]
  }
} as const;

{
 const s=scenarioFor('Temporary');
 for(const snapshot of [s.before,s.after])snapshot.cards.push({ ...KEYWORD_DECK_IDENTITIES['UNL-078'],domains:[...KEYWORD_DECK_IDENTITIES['UNL-078'].domains],keywords:[...KEYWORD_DECK_IDENTITIES['UNL-078'].keywords],instanceId:'sprite-source',cardId:'UNL-078',owner:'player',zone:'trash',ready:false,annotation:'Its Deathknell made this Sprite during your previous Beginning. The Sprite then moved here and now reaches its next Beginning.'});
 s.before.note='The Sprite was created by Sprite Fountain’s Deathknell during your previous Beginning. Fountain is already in the trash; the token moved here that turn. Now the token reaches its next Beginning.';
}
