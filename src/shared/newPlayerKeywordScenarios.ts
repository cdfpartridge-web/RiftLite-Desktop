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
    definition: "When you play a unit with Accelerate, you can pay 1 extra energy and 1 extra power to have it enter ready. A single-domain unit needs matching power, while a unit with several domains or none can use any domain for that power.",
    instruction: "There’s an empty battlefield we could take this turn, if we can get somebody there. Rearguard would usually come in sideways, so I’d pay for Accelerate as I play it, 3 energy and 1 Fury power altogether, then it’s ready to move straight away.",
    actionLabel: 'Pay 3 energy + 1 Fury power',
    before: position([card('OGN-010', 'hand', { might: 2 })], { energy: 3, power: 1, handCount: 1 }, 'Your Main Phase, with an empty chain. Your available power is Fury.'),
    after: position([card('OGN-010', 'base', { might: 2, ready: true, annotation: 'Entered ready: Accelerate was paid.' })], { energy: 0, power: 0, handCount: 0 }),
    explanation: "That extra payment bought us a point this turn, because Rearguard got to move and conquer before our opponent could take the empty battlefield. It’s sideways now from moving, and we can’t pay again to ready it. Accelerate is a choice you make as you play a unit that actually has it.", rulesReference: 'Core Rules 143.4, 805; Radiance FAQ, 26 October 2026',
  },
  {
    id: 'keyword-action', keyword: 'Action', groupId: "keyword-timing", title: 'Act in a showdown',
    definition: "If you have focus in a showdown and the chain is empty, an Action card gives you a play you can make before the battlefield is settled. You can also play it in your own open Main phase.",
    instruction: "Rearguard’s got 2 Might and their Hopeful’s got 4, so if we let the fight go ahead as it is, we lose our unit. Move in and, when you have focus in the showdown, play Cleave on Rearguard. The extra 3 Might while it’s attacking will get it past Hopeful.", actionLabel: 'Play Cleave for 1 energy',
    before: position([card('OGN-004', 'hand'), card('OGN-010', 'base', { might: 2, ready: true, annotation: 'Ready to move; Cleave can be played now or saved for the showdown.' }), card('OGN-096', 'battlefield-left', { owner: 'opponent', might: 1, annotation: 'Defender' })], { energy: 1, handCount: 1 }, 'Your Main phase: the chain is empty. Read Cleave before moving to the battlefield.'),
    after: position([card('OGN-004', 'trash'), card('OGN-010', 'battlefield-left', { might: 5, annotation: 'Attacker: 2 base + Assault 3.' }), card('OGN-096', 'battlefield-left', { owner: 'opponent', might: 1 })], { energy: 0, handCount: 0 }, 'Both players pass on the spell. Cleave resolves; combat damage has not happened yet.'),
    explanation: "Rearguard hit for 5 and took 4 back, so it survived to conquer. Cleave’s Action let us play it in an open showdown, even one on the other player’s turn. If they’d already put a spell or ability on the chain, we’d need Reaction to answer it.", rulesReference: 'Core Rules 806, 807',
  },
  {
    id: 'keyword-reaction', keyword: 'Reaction', groupId: "keyword-timing", title: 'Respond before a spell resolves',
    definition: "Reaction lets you answer a spell or ability when you have priority, which means it’s your chance to act. You can also play a Reaction on an empty chain in your open Main phase or when you have focus in an open showdown.",
    instruction: "Have a look at Cleave on the chain. If it resolves, their attacker will go up to 5 Might, and our Guardian’s only got 4 while defending. Play Discipline on Guardian now, because it’ll resolve before Cleave once both players pass, and it gives us another card as well as the extra 2 Might.", actionLabel: 'React with Discipline',
    before: position([card('OGN-058', 'hand'), card('OGN-096', 'battlefield-left', { might: 1 }), card('OGN-004', 'chain', { owner: 'opponent', annotation: 'Targets the opponent’s attacker; waiting to resolve.' }), card('OGN-010', 'battlefield-left', { owner: 'opponent', might: 2, annotation: 'Attacker' })], { energy: 2, handCount: 2 }, 'You have priority on the chain.'),
    after: position([card('OGN-058', 'trash'), card('OGN-045', 'hand', { annotation: 'Drawn by Discipline; can respond to the still-waiting Cleave.' }), card('OGN-096', 'battlefield-left', { might: 3, annotation: '+2 Might this turn from Discipline.' }), card('OGN-004', 'chain', { owner: 'opponent', annotation: 'Still waiting below Discipline.' }), card('OGN-010', 'battlefield-left', { owner: 'opponent', might: 2 })], { energy: 0, handCount: 2 }, 'Discipline resolves first: +2 Might and draw Defy. Cleave is still waiting, with a fresh chance to respond.'),
    explanation: "The card Discipline drew was Defy, and Cleave was still waiting, so we could pass or use that new card to counter it. Defy sent Cleave to the trash, its cost stayed spent, and Guardian only had to fight a 2-Might attacker. We’ve kept the battlefield, so the next point to look for is holding in our Beginning phase.", rulesReference: 'Core Rules 359, 813',
  },
  {
    id: 'keyword-ganking', keyword: 'Ganking', groupId: "keyword-equipment", title: 'Move between battlefields',
    definition: "A ready unit with Ganking can make a standard move straight from one battlefield to another, exhausting to move just as it would if it were coming from base.",
    instruction: "Vi’s already earned us a holding point on the left, so what would keeping her there do for our score this turn? We can’t score the left again, but Ganking gives her a route straight across to contest the right, provided we leave her ready to move.", actionLabel: 'Move Vi to the right battlefield',
    before: position([card('OGN-036', 'battlefield-left', { might: 3, ready: false }), card('OGN-096', 'battlefield-right', { might: 1, ready: true }), card('OGN-004', 'trash', { instanceId: 'vi-cost-one', annotation: 'First used card available to recycle for Vi’s ability.' }), card('OGN-004', 'trash', { instanceId: 'vi-cost-two', annotation: 'Second used card available for a second activation.' })], { score: 1 }, 'Your turn starts. Awaken Vi, score holding in Beginning, then Channel and Draw before making Main-phase plays.'),
    after: position([card('OGN-036', 'battlefield-right', { might: 5, annotation: 'Two resolved ability uses give +2 Might this turn; exhausted for the move.' }), card('OGN-096', 'battlefield-right', { might: 1, ready: true }), card('OGN-004', 'deck', { instanceId: 'vi-cost-one', annotation: 'Recycled from Trash to pay the first ability cost.' }), card('OGN-004', 'deck', { instanceId: 'vi-cost-two', annotation: 'Recycled from Trash to pay the second ability cost.' })], { score: 2 }, 'You scored for holding the left battlefield. Vi used her ability twice during Main, then moved across to fight for the other battlefield.'),
    explanation: "Vi readied in Awaken and held for a point in Beginning. In Main we used her ability twice, paying with a different card from the trash and letting each chain resolve. There’s no exhaust cost or once-per-turn limit on that ability, so she could still move across and conquer for a second point, and her +2 Might lasts through the rest of the turn.", rulesReference: 'Core Rules 144–145, 377, 381.1, 810',
  },
  {
    id: 'keyword-ambush', keyword: 'Ambush', groupId: "keyword-combat", title: 'Bring help into a fight',
    definition: "Ambush lets you play this unit as a Reaction straight to a battlefield where you already have a friendly unit, even with a spell or ability waiting on the chain.",
    instruction: "Their Discipline is waiting to make the defending Sentry stronger, and our Sentry won’t win that fight alone. We’ve got a unit there, though, so play Inferna at that battlefield while Discipline’s still waiting. That’s the part Ambush allows, even though the battlefield belongs to them.", actionLabel: 'Ambush with Inferna for 2 energy',
    before: position([card('UNL-002', 'hand', { might: 1 }), card('OGN-096', 'battlefield-left', { might: 1, annotation: 'Your attacker is already here.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true, annotation: 'Defender; opponent controls this battlefield.' })], { energy: 2, handCount: 1 }, 'This battlefield has no rule forbidding unit plays.'),
    after: position([card('UNL-002', 'battlefield-left', { might: 3, annotation: 'Entered exhausted; joins your attack. 1 base + Assault 2.' }), card('OGN-096', 'battlefield-left', { might: 1 }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })], { energy: 0, handCount: 0 }, 'Inferna resolves and joins your side of this combat. Combat damage is still ahead.'),
    explanation: "Inferna came in exhausted and could fight straight away, then their Discipline resolved. Our two units dealt 4 together and Inferna died, leaving our Sentry to conquer. The friendly unit already there made Ambush legal, though a battlefield that forbids playing units there would still stop it.", rulesReference: 'Core Rules 143.4, 465, 822',
  },
  {
    id: 'keyword-assault', keyword: 'Assault', groupId: "keyword-combat", title: 'More Might when attacking',
    definition: "A unit with Assault gets extra Might while it’s attacking. That changes both how much combat damage it deals and how much damage it takes to kill it.",
    instruction: "Both Petty Officers have 5 Might printed on them, so at first glance this looks like we’ll trade units. Move ours in and look again, because Assault gives the attacking Officer 1 extra Might, enough to survive the 5 coming back.", actionLabel: 'Attack with Petty Officer',
    before: position([card('OGN-215', 'base', { might: 5, ready: true }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })]),
    after: position([card('OGN-215', 'battlefield-left', { might: 6, annotation: 'Attacker: 5 base + Assault 1.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })], {}, 'The combat showdown has begun. No damage has been dealt yet.'),
    explanation: "Our Officer got to 6 Might and survived to score. If the card just says Assault, read it as Assault 1, and apply it as soon as the unit’s attacking, with nothing to resolve on the chain. It keeps that Might through damage cleanup, conquering and any resulting effects, then goes back to 5 when combat ends.", rulesReference: 'Core Rules 468.1–468.7, 807',
  },
  {
    id: 'keyword-shield', keyword: 'Shield', groupId: "keyword-growth", title: 'More Might when defending',
    definition: "A unit with Shield gains Might while it’s defending, so it can hit harder as well as survive a bigger hit back.",
    instruction: "Look at the two Guardians, they’ve each got 3 Might before the fight. End the turn and let the guide come to us, because ours gets Shield while defending. Watch which Guardian goes up to 4 when the fight starts.", actionLabel: 'End turn and let the guide attack',
    before: position([card('OGN-054', 'battlefield-left', { might: 3, ready: true }), card('OGN-012', 'base', { owner: 'opponent', might: 4, ready: true })]),
    after: position([card('OGN-054', 'battlefield-left', { might: 4, ready: true, annotation: 'Defender: 3 base + Shield 1.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, annotation: 'Attacker' })], {}, 'Combat has started; the showdown happens before damage.'),
    explanation: "Our Guardian took the full 3 damage and dealt 4 back, because Shield added Might rather than absorbing damage. The bonus applies automatically and lasts through the combat result and any resulting effects, then Guardian goes back to 3. We kept control, so if we still have it at our next Beginning check, we can score for holding.", rulesReference: 'Core Rules 468.1–468.7, 814',
  },
  {
    id: 'keyword-tank', keyword: 'Tank', groupId: "keyword-new-tools", title: 'Assign lethal to the Tank first',
    definition: "When you assign combat damage, enemy units with Tank have to receive lethal damage before you can assign any to their allies without Tank. Lethal means enough damage to kill the unit.",
    instruction: "Our attacker’s got 4 damage and there’s a little Sentry we’d like to reach, but Guardian has Tank and it’s got 4 Might while defending. Assign the whole 4 to Guardian first, then see how much we’ve got left for Sentry.", actionLabel: 'Assign all 4 to the Tank',
    before: position([card('OGN-012', 'battlefield-left', { might: 4, annotation: 'Attacker: 4 damage to assign.' }), card('OGN-054', 'battlefield-left', { owner: 'opponent', might: 4, annotation: 'Tank; defending with Shield.' }), card('OGN-096', 'battlefield-left', { owner: 'opponent', might: 1 })], {}, 'The showdown has ended. We are only showing the assignment step.'),
    after: position([card('OGN-012', 'battlefield-left', { might: 4 }), card('OGN-054', 'battlefield-left', { owner: 'opponent', might: 4, annotation: '4 assigned: lethal. Damage not dealt yet.' }), card('OGN-096', 'battlefield-left', { owner: 'opponent', might: 1, annotation: '0 assigned: no damage remains.' })]),
    explanation: "Guardian needed all 4 to receive lethal, so Sentry took none. Once that assignment was made, both sides dealt damage together, killing Guardian and our attacker. Their Sentry survived, so they kept the battlefield and can check for holding on their own turn.", rulesReference: 'Core Rules 467, 815',
  },
  {
    id: 'keyword-backline', keyword: 'Backline', groupId: "keyword-combat", title: 'Reach the Backline last',
    definition: "When you assign combat damage to enemy units, you reach their Backline units after you’ve assigned lethal damage to the other units. Lethal means enough damage to kill them.",
    instruction: "We’ve got 4 damage to assign, and their Promoter’s got Backline. Give Sentry the 1 it takes to kill it first, then put the remaining 3 on Promoter, the last unit in line.", actionLabel: 'Assign 1 to Sentry, then 3',
    before: position([card('OGN-012', 'battlefield-left', { might: 4 }), card('OGN-096', 'battlefield-left', { owner: 'opponent', might: 1 }), card('UNL-043', 'battlefield-left', { owner: 'opponent', might: 2, annotation: 'Backline' })], {}, 'Combat damage assignment; no damage has been dealt yet.'),
    after: position([card('OGN-012', 'battlefield-left', { might: 4 }), card('OGN-096', 'battlefield-left', { owner: 'opponent', might: 1, annotation: '1 assigned first: lethal.' }), card('UNL-043', 'battlefield-left', { owner: 'opponent', might: 2, annotation: '3 assigned last: all remaining damage.' })]),
    explanation: "Promoter took all 3 that were left, even though 2 would have killed it. Both defenders still dealt their combined 3 damage, which our 4-Might attacker survived. Backline changes the order for assigning combat damage, so a spell that can legally target Promoter can still choose it.", rulesReference: 'Core Rules 467, 826',
  },
  {
    id: 'keyword-deflect', keyword: 'Deflect', groupId: "keyword-surprises", title: 'Budget for the targeting cost',
    definition: "If your opponent wants to target this card with a spell or ability, they have to pay extra power. Targeting means their effect actually chooses this card.",
    instruction: "Hidden Blade costs 2 energy and 1 Order power, but have a look at the Pouty Poro we want to target. It has Deflect, so before we play Blade we need another 1 power, and that extra power can be from any domain.", actionLabel: 'Pay the cost including Deflect',
    before: position([card('OGN-213', 'hand'), card('OGN-013', 'battlefield-left', { owner: 'opponent', might: 2, ready: true })], { energy: 2, power: 2 }, 'Your Main Phase, empty chain. Available power: 1 Order and 1 of any domain.'),
    after: position([card('OGN-213', 'chain', { annotation: 'Target chosen and costs paid; waiting for responses.' }), card('OGN-013', 'battlefield-left', { owner: 'opponent', might: 2, ready: true })], { energy: 0, power: 0 }, 'We stop before the spell resolves. The Poro has not been killed yet.'),
    explanation: "We could target Poro because we’d set aside enough for its Deflect payment, then Blade could resolve and remove it normally. Deflect doesn’t reduce damage, so it won’t help against combat, and an effect that never chooses Poro as a target doesn’t owe that extra power.", rulesReference: 'Core Rules 809',
  },
  {
    id: 'keyword-disarm', keyword: 'Disarm', groupId: "keyword-surprises", title: 'Reduce an enemy’s Might on attack',
    definition: "When this unit attacks, Disarm puts an ability on the chain that can lower an enemy unit’s Might at that battlefield for the turn. Both players get a chance to respond to it.",
    instruction: "Our Chronomancer and their Hopeful each have 4 Might, which usually means losing both. Attack with Chronomancer and choose Hopeful for Disarm 2, then give both players their chance to respond. If the ability resolves, Hopeful will only hit for 2.", actionLabel: 'Resolve Disarm 2',
    before: position([card('RAD-050', 'battlefield-left', { might: 4, annotation: 'Attacker; play-time Predict has already resolved.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })], {}, 'The attack trigger is on the chain. Both players pass on it.'),
    after: position([card('RAD-050', 'battlefield-left', { might: 4 }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 2, ready: true, annotation: '4 base − 2 this turn.' })]),
    explanation: "Once we’d both passed, Hopeful lost 2 Might for the turn, so Chronomancer survived the hit back and conquered. Disarm on its own means Disarm 1, and it’s the Might that changes, so the unit keeps its Equipment and its readiness. Unlike Assault or Shield, this attack ability goes on the chain.", rulesReference: 'Core Rules 831',
  },
  {
    id: 'keyword-hidden', keyword: 'Hidden', groupId: "keyword-equipment", title: 'Use a card prepared on an earlier turn',
    definition: "You can pay 1 power to hide this card facedown at a battlefield you control. On a later turn you can play it there as a Reaction, skipping its normal base cost.",
    instruction: "Hide Blade at our battlefield now. On the next turn the guide will pay for Discipline and send in a stronger Sentry, and if we’re going to lose ours anyway, I’d use Blade on our own Sentry to draw cards. Then we’ll go back and try their attack on the other battlefield to see what Blade can reach.", actionLabel: 'Reveal and play Hidden Blade',
    before: position([card('OGN-213', 'hidden', { faceDown: true, hiddenAt: 'battlefield-left', annotation: 'Your facedown card, hidden on a previous turn.' }), card('OGN-096', 'battlefield-left', { might: 1 }), card('OGN-096', 'battlefield-left', { owner: 'opponent', might: 3, annotation: 'Printed 1 + Discipline 2 this turn.' }), card('OGN-058', 'hand', { owner: 'opponent' })], { energy: 0, power: 0 }, 'You still control this contested battlefield. No extra costs apply.', { handCount: 3 }),
    after: position([card('OGN-213', 'hidden', { faceDown: true, hiddenAt: 'battlefield-left' }), card('OGN-096', 'battlefield-left', { might: 1 }), card('OGN-096', 'battlefield-right', { owner: 'opponent', might: 3, annotation: 'Separate reset example: Discipline resolved before moving here.' }), card('OGN-058', 'trash', { owner: 'opponent' })], { energy: 0, power: 0 }, 'Separate reset example: the guide chose the other battlefield. Blade remains hidden beside your Sentry.', { handCount: 4 }),
    explanation: "Blade gave us two cards for killing our own Sentry, then Sentry’s Deathknell drew one more. We’d hidden Blade on an earlier turn in our battlefield’s empty facedown space, so we could skip its base cost, although any extra costs still apply. When the attack went right, Blade on the left could still choose our Sentry on the left, but couldn’t reach across. If we lose control with Blade still hidden, it goes to the trash in cleanup.", rulesReference: 'Core Rules 811',
  },
  {
    id: 'keyword-deathknell', keyword: 'Deathknell', groupId: "keyword-combat", title: 'Get the effect when a unit dies',
    definition: "When a card with Deathknell is killed, its ability goes on the chain. Both players can respond before you follow the instructions after Deathknell.",
    instruction: "Our Sentry can’t survive this fight, so watch what happens after it goes to the trash. Its Deathknell should still be on the chain, and if we both pass, we’ll draw a card even though we’ve lost the unit.", actionLabel: 'Resolve Sentry’s Deathknell',
    before: position([card('OGN-096', 'trash', { annotation: 'Just died; Deathknell is waiting on the chain.' })], { handCount: 2 }),
    after: position([card('OGN-096', 'trash', { annotation: 'Deathknell resolved; the unit stays in the trash.' })], { handCount: 3 }),
    explanation: "Sentry was already in the trash when its Deathknell resolved and its controller drew the card. If somebody had returned Sentry to hand or base instead, that wouldn’t have killed it, so we wouldn’t have got the Deathknell.", rulesReference: 'Core Rules 808',
  },
  {
    id: 'keyword-temporary', keyword: 'Temporary', groupId: "keyword-new-tools", title: 'Check before holding',
    definition: "At the start of its controller’s Beginning phase, a card with Temporary triggers an ability that kills it before holding is checked. Players can respond to that ability.",
    instruction: "Sprite’s the only unit we’ve got at this battlefield, so would you count on it for a holding point? Start the turn and watch the order, because after Awaken its Temporary ability goes on the chain in Beginning, before we check who holds.", actionLabel: 'Resolve Temporary before scoring',
    before: position([card('UNL-T07', 'battlefield-left', { might: 3, ready: true, annotation: 'Your only unit here.' })], { score: 6 }, 'Awaken has finished; Beginning is starting.'),
    after: position([], { score: 6 }, 'The Sprite dies, and its token ceases to exist after leaving the board. You have no unit here, so there is no holding point.'),
    explanation: "By the time we checked for holding, Sprite had died and we had nobody left to hold the battlefield. Sprite’s a token, a unit an effect made, so it stops existing when it leaves the board. A Temporary unit can help conquer now, but if you’re counting on a point next turn I’d want another unit there too.", rulesReference: 'Core Rules 315, 816',
  },
  {
    id: 'keyword-vision', keyword: 'Vision', groupId: "keyword-new-tools", title: 'Check your next draw',
    definition: "When you play a card with Vision, its ability lets you Predict. Have a private look at the top card of your main deck and choose whether to leave it there or put it on the bottom.",
    instruction: "Play Mystic Poro and have a look at what we’re due to draw next. It’s another Sentry, and we’ve already got a small unit, so I’d put this one on the bottom and look for a bigger attacker. You could keep it on top if it suited your hand.", actionLabel: 'Play Poro and recycle the top card',
    before: position([card('OGN-171', 'hand', { might: 2 })], { energy: 2, handCount: 1 }),
    after: position([card('OGN-171', 'base', { might: 2 }), card('OGN-096', 'deck', { annotation: 'Recycled to the bottom after you inspected it.' })], { energy: 0, handCount: 0 }, 'The inspected card is shown for this demonstration. Your opponent does not get to see it.'),
    explanation: "Only we saw the card when Poro’s Vision resolved, and Predict let us leave it on top or move it to the bottom. Putting Sentry on the bottom meant our next actual draw was Mysterious Chronomancer, a bigger attacker with Disarm. We had to wait for that draw to get it into our hand.", rulesReference: 'Core Rules 817; Predict game action',
  },
  {
    id: 'keyword-equip', keyword: 'Equip', groupId: "keyword-equipment", title: 'Attach gear already on your board',
    definition: "Equipment already on your board has an Equip cost you can pay to attach it to one of your units, which then gets whatever benefit the Equipment describes.",
    instruction: "We’ve already paid to play Long Sword, but it’s sitting in base and both Rearguards are still on 2 Might. Pay the sword’s Equip cost of 1 Fury power and choose our Rearguard, because the extra 2 Might will turn that trade into a fight we can win.", actionLabel: 'Equip Long Sword',
    before: position([card('SFD-022', 'base', { ready: true, annotation: 'Already played; unattached.' }), card('OGN-010', 'base', { might: 2, ready: true })], { power: 1 }, 'Your Main Phase, empty chain. Your available power is Fury.'),
    after: position([card('SFD-022', 'base', { ready: true, annotation: 'Attached to Legion Rearguard.' }), card('OGN-010', 'base', { might: 4, ready: true, annotation: '2 base + 2 from Long Sword.' })], { power: 0 }),
    explanation: "Equip went on the chain first, so either player could respond before the sword attached. Our Rearguard stayed ready, moved with its sword and fought at 4 Might against their 2. It keeps the bonus after combat for as long as the sword stays attached.", rulesReference: 'Core Rules 716–719, 818',
  },
  {
    id: 'keyword-quick-draw', keyword: 'Quick-Draw', groupId: "keyword-growth", title: 'Play and attach in a response window',
    definition: "You can play this Equipment as a Reaction, and when you play it you get a separate ability that can attach it to your unit without paying its Equip cost.",
    instruction: "Their 2-Might Rearguard’s already attacking our 1-Might Sentry, so an ordinary Equip would be too late. Play Long Sword with Quick-Draw for 2 energy and 1 Fury power. It goes to base, then its ability can attach it to Sentry in time for this fight.", actionLabel: 'Play Long Sword with Quick-Draw',
    before: position([card('SFD-022', 'hand'), card('OGN-096', 'battlefield-left', { might: 1 }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, annotation: 'Attacker' })], { energy: 2, power: 1, handCount: 1 }, 'You have priority. Available power is Fury; your Sentry is defending.'),
    after: position([card('SFD-022', 'battlefield-left', { ready: true, annotation: 'Attached to Watchful Sentry after its play trigger resolves.' }), card('OGN-096', 'battlefield-left', { might: 3, annotation: '1 base + 2 from Long Sword.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, annotation: 'Attacker' })], { energy: 0, power: 0, handCount: 0 }),
    explanation: "The sword went straight into base, but the attachment went on the chain, so the opponent could respond before Sentry got the extra 2 Might. We didn’t need another power for Equip, and at 3 Might Sentry survived to keep the battlefield for our next holding check. If you Equip again later, the usual Equip timing still applies.", rulesReference: 'Core Rules 818, 819',
  },
  {
    id: 'keyword-weaponmaster', keyword: 'Weaponmaster', groupId: "keyword-new-tools", title: 'Use the discounted attachment',
    definition: "When you play this unit, Weaponmaster can attach Equipment you already control to it. Take 1 power off that Equipment’s Equip cost and pay whatever’s left.",
    instruction: "We’ve got Long Sword in base, so I’d play Armed Assailant and give it that sword. Weaponmaster knocks 1 power off a cost of 1 power, which makes this attachment free, though Assailant still comes in sideways and needs to ready before it can move.", actionLabel: 'Play Assailant and attach the sword',
    before: position([card('SFD-002', 'hand', { might: 6 }), card('SFD-022', 'base', { ready: true, annotation: 'Unattached Equipment you already control.' })], { energy: 6, power: 1, handCount: 1 }, 'Your Main Phase, empty chain. The 1 available power is Fury.'),
    after: position([card('SFD-002', 'base', { might: 8, annotation: 'Entered exhausted; 6 base + 2 from Long Sword.' }), card('SFD-022', 'base', { ready: true, annotation: 'Attached through Weaponmaster; no extra Equip payment.' })], { energy: 0, power: 0, handCount: 0 }),
    explanation: "That sword took Assailant from 6 to 8 Might, enough to survive the fight once Awaken had readied it on our next turn. We got a free attachment here because the sword’s Equip cost was exactly 1 power, so if another Equipment had energy or more power in its cost, we’d still owe the rest.", rulesReference: 'Core Rules 821',
  },
  {
    id: 'keyword-unique', keyword: 'Unique', groupId: "keyword-new-tools", title: 'Keep one copy when building',
    definition: "When you build your deck, Unique means you can include one copy of a card with that name. You check it on the decklist before you play.",
    instruction: "Have a look through this Ornn list, it’s got 41 main-deck cards including the chosen champion. Both Forgefire Capes fit Ornn’s deck, but Cape has Unique, so take one copy out and check the count again.", actionLabel: 'Remove the second copy',
    before: position([card('SFD-190', 'deck', { instanceId: 'cape-first', annotation: 'First copy in the proposed deck.' }), card('SFD-190', 'deck', { instanceId: 'cape-second', annotation: 'Second copy: not allowed by Unique.' })], {}, 'Assume all the deck’s other restrictions are satisfied.'),
    after: position([card('SFD-190', 'deck', { instanceId: 'cape-first', annotation: 'One copy: satisfies Unique.' })], {}, 'The extra copy is removed from this draft, not sent to an in-game trash.'),
    explanation: "We’ve got a legal 40-card list with one Cape, and the spare copy is out of the deck, so nothing went to the trash during a game. Unique limits copies on the list even if you’d only put one into play, and you still check the separate Signature limit for cards tied to a champion.", rulesReference: 'Core Rules 825',
  },
  {
    id: 'keyword-legion', keyword: 'Legion', groupId: "keyword-growth", title: 'Play another card first',
    definition: "Look at whether you’ve played another card this turn. If you have, you get the Legion text on this card, and the card tells you what the benefit is.",
    instruction: "Four energy won’t normally buy a 2-energy Rearguard and a 4-energy Hopeful, so which one would you play first? Start with Rearguard, because playing it turns on Hopeful’s Legion discount, leaving you exactly the 2 energy you need for Hopeful.", actionLabel: 'Play Hopeful for 2 energy',
    before: position([card('OGN-010', 'base', { might: 2, annotation: 'Played earlier this turn without Accelerate.' }), card('OGN-012', 'hand', { might: 4 })], { energy: 2, handCount: 1 }),
    after: position([card('OGN-010', 'base', { might: 2 }), card('OGN-012', 'base', { might: 4, annotation: 'Legion active: paid 2 energy; entered exhausted.' })], { energy: 0, handCount: 0 }),
    explanation: "The order let us get both units out for 4 energy, because we’d already played Rearguard when we checked Hopeful’s Legion. Other Legion cards can do something different, and hiding a card or using a legend ability doesn’t count as playing one. Check again from scratch on the next turn.", rulesReference: 'Core Rules 727, 812',
  },
  {
    id: 'keyword-hunt', keyword: 'Hunt', groupId: "keyword-equipment", title: 'Earn XP when this unit scores',
    definition: "When this unit conquers or holds, its Hunt ability gives you experience points, usually written XP. Keep those separate from the points on the scoreboard.",
    instruction: "Scorchclaw’s about to conquer, so take the game point first, then handle the Hunt 2 ability on the chain. We’ve already got 1 XP, and getting 2 more will bring us up to the 3 we need for Scorchclaw’s Level ability.", actionLabel: 'Conquer and gain 2 XP',
    before: position([card('UNL-016', 'battlefield-left', { might: 3, annotation: 'Showdown finishing; this battlefield has not scored for you this turn.' })], { score: 2, xp: 0 }),
    after: position([card('UNL-016', 'battlefield-left', { might: 3 })], { score: 3, xp: 2 }, 'Conquering gives 1 point; Hunt gives 2 XP after its trigger resolves.'),
    explanation: "We got one point towards winning, then two XP from Hunt, which turned on Scorchclaw’s extra Might. It was already on the board, so gaining Level didn’t make it enter ready all over again. Hunt with no number gives 1 XP, and it’s this unit that has to conquer or hold to earn it.", rulesReference: 'Core Rules 728–733, 823',
  },
  {
    id: 'keyword-level', keyword: 'Level', groupId: "keyword-growth", title: 'Have enough experience points',
    definition: "The number after Level tells you how much XP you need for that text to apply. You just check the total you’ve earned, so you keep the XP when you use the benefit.",
    instruction: "We’ve already earned 3 XP here, so what changes if we play Scorchclaw now? Its Level 3 text means it comes in ready at 4 Might, and I’d use that to move straight onto the empty battlefield rather than wait another turn.", actionLabel: 'Play Scorchclaw at Level 3',
    before: position([card('UNL-016', 'hand', { might: 3, annotation: 'Printed Might 3; Level 3 condition is met.' })], { energy: 3, power: 1, xp: 3, handCount: 1 }, 'Your available power is Fury.'),
    after: position([card('UNL-016', 'base', { might: 4, ready: true, annotation: 'Level 3: +1 Might and enters ready.' })], { energy: 0, power: 0, xp: 3, handCount: 0 }),
    explanation: "Scorchclaw got to conquer the turn we played it and then earned more XP through Hunt. We kept the 3 XP we started with, although an ongoing bonus would switch off if our total fell below its Level. If you only reach Level after a unit’s on the table, you don’t repeat what happens when it enters.", rulesReference: 'Core Rules 727, 824',
  },
  {
    id: 'keyword-empower', keyword: 'Empower', groupId: "keyword-surprises", title: 'Pay to become Empowered',
    definition: "You can activate Empower by paying its cost, and once that ability resolves the card becomes Empowered. That’s when you start using its Empowered text.",
    instruction: "Sandspinner’s printed Empower cost is 5 energy, but count our runes before paying it. We control four or fewer, so this card knocks 3 off its own cost and we only owe 2. Pay that and let the ability resolve, because we’re going to need the attack bonus in this fight.", actionLabel: 'Empower Sandspinner for 2 energy',
    before: position([card('VEN-001', 'base', { might: 6, ready: true, annotation: 'Not Empowered. You control exactly four runes.' })], { energy: 2 }, 'Your Main Phase, empty chain. The four runes remain under your control even if exhausted.'),
    after: position([card('VEN-001', 'base', { might: 6, ready: true, annotation: 'Empowered: Deflect and Assault 2 are now active.' })], { energy: 0 }),
    explanation: "Sandspinner stayed upright because Empower only asked us for energy. Once it was Empowered it had Assault 2, so it attacked for 8 and survived the 6 coming back. That benefit comes from Sandspinner’s own text, and you normally can’t use Empower again while the card is already Empowered.", rulesReference: 'Core Rules 442, 827',
  },
  {
    id: 'keyword-empowered', keyword: 'Empowered', groupId: "keyword-surprises", title: 'Use the text switched on by Empowered',
    definition: "If a card is Empowered, the text marked Empowered is active. One way to get that status is to pay for its Empower ability, and each card tells you what benefit it gets.",
    instruction: "This Sandspinner’s already Empowered, so we can use the Assault 2 on its card without paying for Empower again. Move it in against the 6-Might defender and check its Might as it attacks, because that’s when our printed 6 goes up to 8.", actionLabel: 'Attack with Empowered Sandspinner',
    before: position([card('VEN-001', 'base', { might: 6, ready: true, annotation: 'Empowered: Deflect and Assault 2 active.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })]),
    after: position([card('VEN-001', 'battlefield-left', { might: 8, annotation: 'Empowered attacker: 6 base + Assault 2; Deflect active.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })]),
    explanation: "At 6 against 6 we’d have lost both units, but the extra Might left Sandspinner alive to conquer. When the attack is over it loses the Assault bonus and stays Empowered, so it can get the bonus the next time it attacks. Losing the Empowered status itself would switch off that printed text.", rulesReference: 'Core Rules 727, 828',
  },
  {
    id: 'keyword-repeat', keyword: 'Repeat', groupId: "keyword-growth", title: 'Pay once more for a second effect',
    definition: "As you play the spell, you can pay its Repeat cost once to do the instructions one extra time when it resolves. Each Repeat cost on a card can be paid once.",
    instruction: "One Blood Rush gets our Rearguard to 4 Might, which would leave both units dead. I’d spend the extra 1 energy for Repeat, making 2 energy altogether, and choose Rearguard both times so it’s big enough to survive the hit back.", actionLabel: 'Pay 2 energy and repeat Blood Rush',
    before: position([card('SFD-003', 'hand', { annotation: 'Current errata: Assault lasts this turn.' }), card('OGN-010', 'battlefield-left', { might: 2, annotation: 'Attacker' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })], { energy: 2, handCount: 1 }, 'You have focus and the showdown chain is empty.'),
    after: position([card('SFD-003', 'trash'), card('OGN-010', 'battlefield-left', { might: 6, annotation: '2 base + Assault 2 + Assault 2 = 6 as an attacker.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })], { energy: 0, handCount: 0 }, 'The one chain item resolves its instructions twice.'),
    explanation: "We played one spell, and when it resolved we got Assault 2 twice, taking Rearguard all the way to 6 Might while attacking. It survived the 4 damage and conquered. Those bonuses last this turn, and repeating the instructions still counts as playing just one card.", rulesReference: 'Core Rules 807, 820; Spiritforged Errata, Blood Rush',
  },
  {
    id: 'keyword-flow', keyword: 'Flow', groupId: "keyword-equipment", title: 'Use a spell from your trash',
    definition: "A spell with Flow can be played from your trash by paying its Flow cost, then it goes to banishment once it’s finished. Banishment is a separate area outside play.",
    instruction: "Dredge Up’s already in the trash, but I’d quite like another card in hand and we’ve got 2 energy for its Flow cost. Play it from there during our open Main phase, because Flow gives us somewhere else to play it from and we still need its usual timing.", actionLabel: 'Play Dredge Up with Flow',
    before: position([card('VEN-049', 'trash')], { energy: 2, handCount: 2 }),
    after: position([card('VEN-049', 'banishment', { annotation: 'Banished after resolving from Flow.' })], { energy: 0, handCount: 3 }),
    explanation: "Dredge Up drew us a card and went to banishment, so there’s no Dredge Up left in the trash to play a third time. Flow let us use it from that pile, but it didn’t give it Action or Reaction, and a spell needs permission like this to be played from the trash.", rulesReference: 'Core Rules 829',
  },
  {
    id: 'keyword-deploy', keyword: 'Deploy', groupId: "keyword-surprises", title: 'Put gear at a battlefield',
    definition: "Gear with Deploy goes straight to a battlefield, even one your opponent controls. If an opponent later holds that battlefield, the gear is killed.",
    instruction: "Our Hopeful’s about to fight their Hopeful, and at 4 Might each we’d lose ours. Play Banner of Conquest at their battlefield first. Deploy lets us put the Banner there, so our unit can pick up the attack bonus when it arrives.", actionLabel: 'Deploy Banner of Conquest',
    before: position([card('RAD-002', 'hand'), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })], { energy: 1, power: 1, handCount: 1 }, 'Your Main Phase, empty chain. Your available power is Fury.'),
    after: position([card('RAD-002', 'battlefield-left', { ready: true, annotation: 'Your gear; the opponent still controls the battlefield.' }), card('OGN-012', 'battlefield-left', { owner: 'opponent', might: 4, ready: true })], { energy: 0, power: 0, handCount: 0 }),
    explanation: "The Banner gave our arriving Hopeful Assault 1, so it attacked for 5 and survived their 4 damage to conquer. We needed the unit there to take the battlefield, because the Banner couldn’t do it on its own. Deploy gear goes to a battlefield, and if the opponent later holds it in Beginning, the Banner dies.", rulesReference: 'Core Rules 830',
  },
  {
    id: 'keyword-show-off', keyword: 'Show Off', groupId: "keyword-new-tools", title: 'Show a card without spending it',
    definition: "Read what the card wants you to show off. You can reveal a matching card from your hand or choose a matching friendly card on the board as you play it.",
    instruction: "Roar needs to deal 4 damage to kill their Hopeful, and we’ve got a Hopeful with 4 Might in hand. Show ours as you play Roar and see where it ends up, because we’re going to want that unit for a later turn.", actionLabel: 'Show Hopeful and resolve Roar',
    before: position([card('RAD-082', 'hand'), card('OGN-012', 'hand', { might: 4, annotation: 'The card you will reveal.' }), card('OGN-010', 'battlefield-left', { owner: 'opponent', might: 2, ready: true })], { energy: 4, power: 2, handCount: 2 }, 'Your Main Phase, empty chain. Both available power are Body.'),
    after: position([card('RAD-082', 'trash'), card('OGN-012', 'hand', { might: 4, annotation: 'Shown to the opponent, but still in your hand.' }), card('OGN-010', 'trash', { owner: 'opponent', annotation: 'Killed by 4 damage.' })], { energy: 0, power: 0, handCount: 1 }),
    explanation: "Roar recorded the 4 Might we showed and dealt 4 to their Hopeful, while ours stayed in hand ready to play later. Showing the card didn’t play or discard it, and changing its Might afterwards wouldn’t change the number Roar already recorded. Another Show Off card may ask you to show something different.", rulesReference: 'Core Rules 832; Radiance Patch Notes',
  },
];

export const NEW_PLAYER_KEYWORD_GROUPS: KeywordScenarioGroup[] = [
  {
    "id": "keyword-timing",
    "title": "Action and Reaction",
    "description": "Try Cleave before combat damage, then see what changes when you’ve got a Reaction and there’s already a spell waiting.",
    "minutes": 8,
    "scenarioIds": [
      "keyword-action",
      "keyword-reaction"
    ]
  },
  {
    "id": "keyword-combat",
    "title": "Accelerate to Deathknell",
    "description": "Reach a battlefield with Accelerate, bring in help with Ambush, then see how Assault, Backline and Deathknell change a fight and what you keep.",
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
    "description": "Work out what it costs to get past Deflect, where to Deploy your Banner, and what Disarm or an Empowered attacker can do to the fight.",
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
    "description": "Try attaching Equipment, playing a spell from the trash and moving straight between battlefields, then set up a Hidden card and earn XP with Hunt.",
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
    "description": "See why the order matters for Legion, what 3 XP gets you with Level, and how Quick-Draw, Repeat and Shield can change a fight.",
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
    "description": "Try Show Off from hand, assign damage to a Tank and see whether a Temporary token can hold, then check a Unique decklist, your next draw and a Weaponmaster attachment.",
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
  s.followThrough={...s.followThrough,combat:{sourceIds:[source],targetAssignments:[{cardId:enemy,amount:damage,order:1,label:`Your side assigns ${damage}.`}],returnAssignments:[{cardId:source,amount:returned,order:1,label:`The opposing side assigns ${returned}.`}],explanation:'Have a look at the damage on each side before you resolve it. The counters show who’s going to take the hit, and both sides deal the damage together, so even a unit that dies still gets its damage in.'},...(conquer?{conquer:field}:{})};
};
{
  const s=scenarioFor('Assault');replaceCard(s,'OGN-012','OGN-215','opponent',5);
  
  finishFight(s,'player-OGN-215','opponent-OGN-215',6,5);
  s.objective={goal:'Attack with the Officer that can survive this fight.',without:'Two Officers hitting each other for 5 would both die.',with:'Ours attacks for 6, so it kills their Officer and survives the 5 coming back.'};
  
}
{
  const s=scenarioFor('Shield');replaceCard(s,'OGN-012','OGN-054','opponent',3);
  
  finishFight(s,'player-OGN-054','opponent-OGN-054',4,3,false);
  s.objective={goal:'Keep Guardian on its battlefield through the attack.',without:'At 3 Might each, neither Guardian would survive.',with:'Ours defends at 4, enough to keep the battlefield and give us a chance to hold next turn.'};
  
}
{
  const s=scenarioFor('Action');replaceCard(s,'OGN-096','OGN-012','opponent',4);
  finishFight(s,'player-OGN-010','opponent-OGN-012',5,4);
  s.objective={goal:'Get Rearguard through a fight it would normally lose.',without:'At 2 Might, it won’t survive a hit from their 4-Might Hopeful.',with:'Play Cleave in the open showdown and it’ll attack at 5, enough to conquer and stay alive.'};
  
}
{
  const s=scenarioFor('Reaction');replaceCard(s,'OGN-096','OGN-054','player',4);
  s.after.cards.find(c=>c.instanceId==='player-OGN-054')!.might=6;
  nativeActions[s.id]={type:'play',cardId:'player-OGN-058',targetId:'player-OGN-054'};
  
  finishFight(s,'player-OGN-054','opponent-OGN-010',6,2,false);
  s.objective={goal:'Try using a card you’ve just drawn while their spell is still waiting.',without:'If Cleave resolves, their attacker will have 5 Might.',with:'Discipline strengthens Guardian and draws Defy, then there’s a chance to use that Defy before Cleave resolves.'};
  
}
{
  const s=scenarioFor('Ganking');replaceCard(s,'OGN-096','OGN-010','player',2);
  for(const snap of [s.before,s.after]){const c=snap.cards.find(c=>c.cardId==='OGN-010')!;c.owner='opponent';c.instanceId='opponent-OGN-010';}
  nativePositions[s.id]=[{phase:'Awaken',controllers:['player','opponent'],scoredBy:{}},{controllers:[null,'opponent'],scoredBy:{'battlefield-left':['player']}}];
  s.before.player.score=1;s.after.player.score=2;
  finishFight(s,'player-OGN-036','opponent-OGN-010',5,2,true,'battlefield-right');
  
  s.objective={goal:'Hold one battlefield with Vi, then see if she can take the other.',without:'A standard move usually takes a unit back to base before it can reach the other battlefield.',with:'Use Vi’s ability twice in your open Main phase, paying with a different trash card each time. She stays ready to go straight across and fight for another point.'};
  
}
{
  const s=scenarioFor('Accelerate');s.followThrough={move:{cardId:'player-OGN-010',destination:'battlefield-left'},conquer:'battlefield-left'};
  s.objective={goal:'Take the empty battlefield before they get there.',without:'Rearguard usually enters exhausted, so it would have to wait for Awaken before it could move.',with:'Pay for Accelerate as you play it and it comes in ready, so it can move and score this turn.'};
  
}
{
  const s=scenarioFor('Equip');addEnemy(s,'OGN-010',2);s.followThrough={move:{cardId:'player-OGN-010',destination:'battlefield-left'}};finishFight(s,'player-OGN-010','opponent-OGN-010',4,2);
  s.objective={goal:'Give your Rearguard the better of a 2-Might fight.',without:'If both Rearguards go in at 2 Might, we lose both of them.',with:'Long Sword adds 2 to ours, then moves with it, so ours survives to conquer.'};
  
}
{
  const s=scenarioFor('Quick-Draw');replaceCard(s,'OGN-012','OGN-010','opponent',2);finishFight(s,'player-OGN-096','opponent-OGN-010',3,2,false);
  s.objective={goal:'Help Sentry now that the attack’s already under way.',without:'Their 2-Might Rearguard has enough damage to kill our 1-Might Sentry.',with:'Bring in the sword during the showdown. Once it attaches, Sentry’s got 3 Might and can keep the battlefield for a holding check.'};
  
}
{
  const s=scenarioFor('Weaponmaster');addEnemy(s,'SFD-002',6);s.followThrough={waitForNextTurn:true,move:{cardId:'player-SFD-002',destination:'battlefield-left'}};finishFight(s,'player-SFD-002','opponent-SFD-002',8,6);
  s.objective={goal:'Give Assailant the sword you’ve already paid to play.',without:'With both Assailants at 6 Might, attacking would cost us ours too.',with:'Weaponmaster covers the sword’s 1-power Equip cost. When ours readies next turn it can attack for 8 and survive to conquer.'};
  
}
for(const keyword of ['Empower','Empowered']){
  const s=scenarioFor(keyword);
  if(keyword==='Empower'){addEnemy(s,'SFD-002',6);s.followThrough={move:{cardId:'player-VEN-001',destination:'battlefield-left'}};}
  else replaceCard(s,'OGN-012','SFD-002','opponent',6);
  finishFight(s,'player-VEN-001','opponent-SFD-002',8,6);
  s.objective={goal:'Attack the 6-Might defender and keep Sandspinner alive.',without:'With 6 printed Might on each unit, they’d take each other out.',with:'Once Sandspinner’s Empowered, its Assault 2 gets it to 8 while attacking, enough to survive and conquer.'};
  
}
{
  const s=scenarioFor('Disarm');finishFight(s,'player-RAD-050','opponent-OGN-012',4,2);
  s.objective={goal:'Find a way for Chronomancer to win an even fight.',without:'Both units have 4 Might printed, enough to kill each other.',with:'The attack triggers Disarm 2, so Hopeful only hits back for 2 and Chronomancer survives to conquer.'};
  
}
{
  const s=scenarioFor('Repeat');finishFight(s,'player-OGN-010','opponent-OGN-012',6,4);
  s.objective={goal:'Give Rearguard enough Might to come out of this fight alive.',without:'One Blood Rush brings it up to 4, which would only trade with their 4-Might defender.',with:'Pay Repeat to get Assault 2 twice, and Rearguard can attack for 6 and survive to conquer.'};
  
}
{
  const s=scenarioFor('Level');s.followThrough={move:{cardId:'player-UNL-016',destination:'battlefield-left'},conquer:'battlefield-left'};
  s.objective={goal:'Use your 3 XP to get onto the battlefield this turn.',without:'If we were below Level 3, Scorchclaw would enter exhausted with 3 Might.',with:'It comes in ready with 4 Might, so we can move straight away and still keep the XP we earned.'};
  
}
{
  const s=scenarioFor('Hunt');s.before.player.xp=1;s.after.player.xp=3;s.after.cards[0].might=4;
  s.objective={goal:'See what a point for Scorchclaw does to your XP.',without:'We’ve got 1 XP, so Scorchclaw is below Level 3 and still has 3 Might.',with:'Conquer for a point and then resolve Hunt 2. That takes us to 3 XP and gives Scorchclaw its extra Might.'};
  
}
{
  const s=scenarioFor('Deploy');for(const snap of [s.before,s.after])snap.cards.push(card('OGN-012','base',{might:4,ready:true}));
  s.followThrough={move:{cardId:'player-OGN-012',destination:'battlefield-left'}};finishFight(s,'player-OGN-012','opponent-OGN-012',5,4);
  s.objective={goal:'Get the Banner in place before you send Hopeful in.',without:'Both Hopefuls have 4 Might, so ordinarily you’d lose yours as well.',with:'Deploy the Banner at their battlefield first, and the Assault 1 it gives your attacker will get it through the fight.'};
  
}
{
  const s=scenarioFor('Show Off');replaceCard(s,'OGN-010','OGN-012','opponent',4);nativeActions[s.id]={type:'play',cardId:'player-RAD-082',targetId:'opponent-OGN-012'};
  s.objective={goal:'Use the Might on a card in your hand to remove their Hopeful.',without:'Our Hopeful can’t fight from hand, so its printed 4 Might isn’t doing us much good there on its own.',with:'Show it for Roar and the spell records that 4 as its damage, enough to kill their Hopeful while ours stays in hand.'};
  
}
const remainingObjectives:Record<string,[string,string,string]>={
  Tank:['See which defender survives behind Guardian.','Given the choice, the attacker could assign 1 lethal damage to Sentry first.','Guardian needs all 4 damage, so the attacker can’t reach Sentry. The defender keeps the battlefield for a later holding check.'],
  Backline:['See whether your attacker can reach the unit at the back.','Promoter has Backline, so it can’t take the first hit while Sentry still needs lethal damage.','Assign 1 to Sentry and all 3 left over to Promoter, then your attacker survives their damage and can conquer.'],
  Deflect:['Work out what it really costs to remove Pouty Poro.','If we only pay what’s printed on Hidden Blade, we haven’t paid enough to choose Poro.','Leave an extra power for Deflect and Blade can remove Poro, which leaves the battlefield empty.'],
  Hidden:['Try Blade with the fight here, then with the fight at the other battlefield.','Their Discipline makes their Sentry 3 Might, and ours has only 1.','Blade can turn our Sentry into extra cards here, but if the guide moves to the other battlefield we can’t use it to target the unit over there.'],
  Deathknell:['See what Sentry leaves you when it dies.','We’ll lose the fight and a defender without a draw ability would leave us a card down.','Sentry still dies, but its ability stays on the chain and draws us a replacement once it resolves.'],
  Temporary:['Work out whether Sprite will still be here when you score.','If we still controlled the battlefield at the holding check, we’d get a point.','Sprite dies to Temporary before we check for holding, and it was our last unit there.'],
  Vision:['Use Poro to look for a bigger unit for next turn.','If we leave Sentry on top, that’s another small unit coming into our hand.','Move it to the bottom with Predict and our next draw is Chronomancer, whose Disarm can help it survive an attack.'],
  Unique:['Get this Ornn list down to a legal 40 cards.','The domains fit and Forgefire Cape is Ornn’s Signature, but the extra Cape breaks Unique.','Take one Cape out and you’ve got 40 main-deck cards including the chosen champion, with one legal copy of Cape.'],
  Legion:['Get both of these units onto the table with 4 energy.','Rearguard costs 2 and Hopeful usually costs 4, so we’d need 6.','If Rearguard comes out first, Legion brings Hopeful down to 2 and we can afford them both.'],
  Flow:['Get a draw out of Dredge Up after you’ve used it once.','You usually can’t play a spell that’s sitting in your trash.','Pay 2 energy for Flow to draw again, then Dredge Up goes to banishment, so the spell’s no longer in the trash.'],
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
    scenario.combatDemonstration={sourceIds:['player-OGN-012'],targetAssignments:tank?[{cardId:'opponent-OGN-054',amount:4,order:1,label:'Guardian takes all 4, so there’s none left for Sentry.'}]:[{cardId:'opponent-OGN-096',amount:1,order:1,label:'Start with Sentry, it only needs 1 for lethal.'},{cardId:'opponent-UNL-043',amount:3,order:2,label:'Promoter is last, so it gets all 3 that are left.'}],returnAssignments:[{cardId:'player-OGN-012',amount:tank?5:3,order:1,label:'Add the defenders’ Might together for the damage coming back.'}],explanation:scenario.explanation};
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
 s.objective={goal:'Bring in help after the fight’s already started.',without:'Their Discipline would leave our 1-Might Sentry facing a 3-Might defender.',with:'Inferna adds 3 Might to the attack, so together they can deal 4 and leave Sentry alive to conquer.'};
 s.followThrough={combat:{sourceIds:['player-OGN-096','player-UNL-002'],targetAssignments:[{cardId:'opponent-OGN-096',amount:4,order:1}],returnAssignments:[{cardId:'player-UNL-002',amount:3,order:1,label:'Their 3 goes to Inferna, so your Sentry gets through.'}],explanation:'You’ve got 4 going their way and 3 coming back at Inferna, all dealt together. That kills Inferna and their Sentry, leaving your original Sentry there to conquer.'},deathknells:['opponent-OGN-096'],conquer:'battlefield-left'};
 
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
