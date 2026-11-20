/** Exact, dated public Piltover Archive lists. Strategy/difficulty copy is RiftLite editorial guidance.
 * Popularity is a snapshot of PA Trending, never a tournament rank or a win-rate claim.
 * Provenance and independent Atlas parser receipts: output/new-player-hub-20261111/decks-*.
 */
export interface NewPlayerDeckCard {
  readonly name: string;
  readonly quantity: number;
  /** Original Piltover printing; alternate art identifiers can differ between providers. */
  readonly printId: string;
  /** Same named card in the local registry; basic rune artwork may use a canonical print. */
  readonly registryPrintId: string;
}
export interface NewPlayerDeckSections {
  readonly legend: readonly NewPlayerDeckCard[];
  readonly champion: readonly NewPlayerDeckCard[];
  /** The other 39 cards; the chosen champion is the 40th Main Deck card. */
  readonly mainDeck: readonly NewPlayerDeckCard[];
  readonly battlefields: readonly NewPlayerDeckCard[];
  readonly runes: readonly NewPlayerDeckCard[];
  readonly sideboard: readonly NewPlayerDeckCard[];
}
export interface NewPlayerDeck {
  readonly id: string;
  readonly title: string;
  readonly champion: string;
  readonly domains: readonly string[];
  readonly difficulty: "Approachable" | "Some practice" | "Advanced";
  readonly difficultyReason: string;
  readonly summary: string;
  readonly gamePlan: readonly string[];
  readonly mulligan: readonly string[];
  readonly firstTurns: readonly string[];
  readonly pitfalls: readonly string[];
  readonly sourceUrl: string;
  readonly sourceTitle: string;
  readonly author: string;
  readonly sourceUpdatedAt: string;
  readonly reviewedAt: string;
  readonly sourceEvidence: {
    readonly provider: "Piltover Archive";
    readonly discoveryUrl: string;
    readonly selection: "Trending";
    readonly views: number;
    readonly likes: number;
    readonly observedAt: string;
    readonly competitiveContext?: { readonly url: string; readonly note: string };
  };
  readonly legalityReview: {
    readonly format: "Standard Constructed";
    readonly rulesUrl: string;
    readonly banListUpdatedAt: string;
    readonly checkedAt: string;
    readonly status: string;
  };
  readonly atlasExportStatus: string;
  readonly cards: NewPlayerDeckSections;
  /** RiftLite's importer expects the chosen champion inside the 40-card Main Deck. */
  readonly deckText: string;
  /** Atlas has an explicit Champion section and 39 other MainDeck cards. */
  readonly atlasDeckText: string;
}

export const NEW_PLAYER_DECKS_REVIEWED_AT = "2026-11-11";
export const NEW_PLAYER_DECKS_RULES_URL = "https://playriftbound.com/en-us/rules-hub/";
export const NEW_PLAYER_DECK_SELECTION_NOTE = "Popular lists from Piltover Archive’s Trending page, checked 11 November 2026 and narrowed for learning. Popularity is not a tournament ranking; difficulty and teaching notes are RiftLite’s assessment. These are dated copies; source lists and legality can change.";

/** Announced 13 November; do not label these cards already banned before the effective date. */
export const NEW_PLAYER_DECK_BAN_UPDATE = {
  announcedAt: "2026-11-13",
  checkedAt: "2026-11-14",
  effectiveAt: "2026-11-23",
  effectiveLabel: "23 November 2026",
  sourceUrl: "https://playriftbound.com/en-us/news/announcements/radiance-ban-list-updates-effective-november-23-2026/",
  cardNames: [
    "Riven, Broken Blade", "Zhonya's Hourglass", "Stellacorn Herder", "Nocturne, Horrifying",
    "Rhasa the Sunderer", "Brynhir Thundersong", "Dazzling Aurora", "Baited Hook", "Emperor's Dais", "Star Spring"
  ],
  regionalNote: "This update covers Standard and 2v2 Constructed. Korea and Traditional Chinese competitive regions have a different timetable; check the official announcement for your event."
} as const;

export interface NewPlayerDeckReadiness {
  readonly status: "dated-snapshot" | "upcoming-change" | "needs-update" | "check-date";
  readonly title: string;
  readonly explanation: string;
  readonly canUseSnapshot: boolean;
  readonly affectedCards: readonly { name: string; quantity: number }[];
  readonly alternativeDeckIds: readonly string[];
}

const normaliseDeckCardName = (name: string) => name.normalize("NFKC").replace(/[’‘]/g, "'").trim().toLocaleLowerCase("en-GB");
const announcedBanNames = new Set<string>(NEW_PLAYER_DECK_BAN_UPDATE.cardNames.map(normaliseDeckCardName));

/** A check against the dated announcement, not a live guarantee of legality in every region. */
export function getNewPlayerDeckReadiness(deck: Pick<NewPlayerDeck, "id" | "cards">, today = new Date()): NewPlayerDeckReadiness {
  const affectedCards = mergeNames(Object.values(deck.cards).flat().filter(card => announcedBanNames.has(normaliseDeckCardName(card.name))));
  const alternatives = NEW_PLAYER_DECKS.filter(candidate => candidate.id !== deck.id && !Object.values(candidate.cards).flat().some(card => announcedBanNames.has(normaliseDeckCardName(card.name)))).map(candidate => candidate.id);
  if (!Number.isFinite(today.getTime())) return {
    status: "check-date", title: "Check your device date", explanation: "We could not check this list against the dated ban announcement. Check your device date and the official rules before importing it.",
    canUseSnapshot: false, affectedCards, alternativeDeckIds: []
  };
  // Use the learner's calendar date; a UTC conversion would change status early/late in some regions.
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (affectedCards.length && date >= NEW_PLAYER_DECK_BAN_UPDATE.effectiveAt) return {
    status: "needs-update", title: "This saved list needs updating", explanation: "The 23 November ban update affects this list in the applicable competitive regions. Its import and copy buttons are paused. Choose K’Sante, Jarvan IV or Mordekaiser on this page, or check the author’s current list on Piltover Archive.",
    canUseSnapshot: false, affectedCards, alternativeDeckIds: alternatives
  };
  if (affectedCards.length && date >= NEW_PLAYER_DECK_BAN_UPDATE.announcedAt) return {
    status: "upcoming-change", title: "Changes from 23 November 2026", explanation: "You can use this dated list before the update takes effect in the applicable regions. The cards below will then be banned. For a first deck without these announced changes, try K’Sante, Jarvan IV or Mordekaiser.",
    canUseSnapshot: true, affectedCards, alternativeDeckIds: alternatives
  };
  return {
    status: "dated-snapshot", title: "Dated list · checked 11 November 2026", explanation: date >= NEW_PLAYER_DECK_BAN_UPDATE.announcedAt
      ? "This copy contains none of the cards in the 23 November ban update. Check the current rules for your event; future updates can still change deck legality."
      : "This is a saved copy of a published list. Check the current rules for your event before using it.",
    canUseSnapshot: true, affectedCards: [], alternativeDeckIds: []
  };
}

type CuratedNewPlayerDeck = Omit<NewPlayerDeck, "deckText" | "atlasDeckText">;
const CURATED_NEW_PLAYER_DECKS = [
  {
    "id": "pa-ksante",
    "title": "K'Sante — defend, then attack",
    "champion": "K'Sante",
    "difficulty": "Approachable",
    "difficultyReason": "Start here if you enjoy keeping your units alive. Shield helps when they defend; spells can help you turn that survival into points.",
    "summary": "Conquer a battlefield, protect your units, then hold it for more points.",
    "gamePlan": [
      "Get an affordable unit onto the table, then move it to a battlefield you can conquer and later hold.",
      "Use Shield and Ntofo Strikes to help units survive a fight. Your legend can then help you attack."
    ],
    "mulligan": [
      "Look for a unit you can play early, such as Mutated Mouser, Stalwart Poro or Scuttle Crab.",
      "An early unit plus something useful for the next turn is a good start. Replace cards that leave you unable to make an early play; you do not have to return every expensive card."
    ],
    "firstTurns": [
      "First turn: play an affordable unit. A unit normally enters sideways, so plan to move it after it readies.",
      "Next turn: check both battlefields. Move where the unit can score and is likely to survive.",
      "Once you control a battlefield: count what a defensive spell needs before spending everything on another unit."
    ],
    "pitfalls": [
      "Shield helps while defending. It does not automatically strengthen your own attack.",
      "Your legend ability and spells still have costs. Count energy and matching power separately."
    ],
    "domains": [
      "Body",
      "Calm"
    ],
    "sourceUrl": "https://piltoverarchive.com/decks/view/586c0291-2dc5-4a47-855a-7c8f66a25cd4",
    "sourceTitle": "K'Sante Midrange (Final Version)",
    "author": "Marshadow",
    "sourceUpdatedAt": "2026-10-29T10:57:34.063Z",
    "reviewedAt": "2026-11-11",
    "sourceEvidence": {
      "provider": "Piltover Archive",
      "discoveryUrl": "https://piltoverarchive.com/decks",
      "selection": "Trending",
      "views": 9230,
      "likes": 54,
      "observedAt": "2026-11-11"
    },
    "legalityReview": {
      "format": "Standard Constructed",
      "rulesUrl": "https://playriftbound.com/en-us/rules-hub/",
      "banListUpdatedAt": "2026-09-18",
      "checkedAt": "2026-11-11",
      "status": "Snapshot checked against the 18 September ban list and Atlas catalogue on 11 November 2026"
    },
    "atlasExportStatus": "Verified with the public Atlas parser on 11 November 2026",
    "cards": {
      "legend": [
        {
          "name": "K'Sante, Pride of Nazumah",
          "quantity": 1,
          "printId": "RAD-172",
          "registryPrintId": "RAD-172"
        }
      ],
      "champion": [
        {
          "name": "K'Sante, Dauntless",
          "quantity": 1,
          "printId": "RAD-045a",
          "registryPrintId": "RAD-045A"
        }
      ],
      "mainDeck": [
        {
          "name": "Defy",
          "quantity": 3,
          "printId": "OGN-045",
          "registryPrintId": "OGN-045"
        },
        {
          "name": "Sabotage",
          "quantity": 2,
          "printId": "OGN-156",
          "registryPrintId": "OGN-156"
        },
        {
          "name": "Punch First",
          "quantity": 3,
          "printId": "SFD-097",
          "registryPrintId": "SFD-097"
        },
        {
          "name": "Block",
          "quantity": 3,
          "printId": "OGN-057",
          "registryPrintId": "OGN-057"
        },
        {
          "name": "Mutated Mouser",
          "quantity": 3,
          "printId": "UNL-036",
          "registryPrintId": "UNL-036"
        },
        {
          "name": "Ntofo Strikes",
          "quantity": 3,
          "printId": "RAD-148",
          "registryPrintId": "RAD-148"
        },
        {
          "name": "Stalwart Poro",
          "quantity": 3,
          "printId": "OGN-052",
          "registryPrintId": "OGN-052"
        },
        {
          "name": "First Mate",
          "quantity": 2,
          "printId": "OGN-132",
          "registryPrintId": "OGN-132"
        },
        {
          "name": "Ruin Runner",
          "quantity": 3,
          "printId": "SFD-105",
          "registryPrintId": "SFD-105"
        },
        {
          "name": "Stoic Ferryman",
          "quantity": 3,
          "printId": "RAD-031",
          "registryPrintId": "RAD-031"
        },
        {
          "name": "Charm",
          "quantity": 1,
          "printId": "OGN-043",
          "registryPrintId": "OGN-043"
        },
        {
          "name": "Emperor's Divide",
          "quantity": 1,
          "printId": "SFD-043",
          "registryPrintId": "SFD-043"
        },
        {
          "name": "Nazuman Ntofo",
          "quantity": 2,
          "printId": "RAD-071",
          "registryPrintId": "RAD-071"
        },
        {
          "name": "Rengar, Trophy Hunter",
          "quantity": 2,
          "printId": "UNL-120",
          "registryPrintId": "UNL-120"
        },
        {
          "name": "Discipline",
          "quantity": 2,
          "printId": "OGN-058",
          "registryPrintId": "OGN-058"
        },
        {
          "name": "Scuttle Crab",
          "quantity": 3,
          "printId": "UNL-053",
          "registryPrintId": "UNL-053"
        }
      ],
      "runes": [
        {
          "name": "Calm Rune",
          "quantity": 7,
          "printId": "OGN-042",
          "registryPrintId": "OGN-042"
        },
        {
          "name": "Body Rune",
          "quantity": 5,
          "printId": "OGN-126",
          "registryPrintId": "OGN-126"
        }
      ],
      "battlefields": [
        {
          "name": "Fortified Position",
          "quantity": 1,
          "printId": "OGN-279",
          "registryPrintId": "OGN-279"
        },
        {
          "name": "The Papertree",
          "quantity": 1,
          "printId": "SFD-219",
          "registryPrintId": "SFD-219"
        },
        {
          "name": "Sandswept Tomb",
          "quantity": 1,
          "printId": "VEN-164",
          "registryPrintId": "VEN-164"
        }
      ],
      "sideboard": [
        {
          "name": "Graves, Blasting Through",
          "quantity": 2,
          "printId": "RAD-085",
          "registryPrintId": "RAD-085"
        },
        {
          "name": "Not So Fast",
          "quantity": 1,
          "printId": "SFD-045",
          "registryPrintId": "SFD-045"
        },
        {
          "name": "Hush",
          "quantity": 1,
          "printId": "RAD-041",
          "registryPrintId": "RAD-041"
        },
        {
          "name": "Disarming Rake",
          "quantity": 2,
          "printId": "SFD-032",
          "registryPrintId": "SFD-032"
        },
        {
          "name": "Decree of Strength",
          "quantity": 1,
          "printId": "VEN-085",
          "registryPrintId": "VEN-085"
        },
        {
          "name": "Decree of Focus",
          "quantity": 1,
          "printId": "VEN-040",
          "registryPrintId": "VEN-040"
        },
        {
          "name": "Onslaught",
          "quantity": 1,
          "printId": "VEN-081",
          "registryPrintId": "VEN-081"
        },
        {
          "name": "Portable Portal",
          "quantity": 1,
          "printId": "RAD-087",
          "registryPrintId": "RAD-087"
        }
      ]
    }
  },
  {
    "id": "pa-jarvan",
    "title": "Jarvan IV — units with battlefield support",
    "champion": "Jarvan IV",
    "difficulty": "Some practice",
    "difficultyReason": "Learn to put gear where your units will fight, then use your legend to help with movement.",
    "summary": "Develop units, support their battlefield with gear, and move into places where you can score.",
    "gamePlan": [
      "Play affordable units before relying on equipment to win a fight.",
      "Deploy gear can support a battlefield. Check where your next unit wants to go before choosing that location."
    ],
    "mulligan": [
      "Look for an early unit such as Honest Broker or Pit Rookie, with gear you can afford later.",
      "A hand full of gear needs units to benefit from it. Replace some of that gear if you have no early unit."
    ],
    "firstTurns": [
      "First turn: put an affordable unit on the table.",
      "Next turn: compare the battlefields and choose where your units could score. Check which gear would actually help there.",
      "Before using your legend to move: count its cost and what you will have left to respond with."
    ],
    "pitfalls": [
      "Deploy gear can be lost when an opponent holds its battlefield. Think about whether you can protect that location.",
      "Call to Glory can spend a buff. Check how much Might that unit will have after losing the buff."
    ],
    "domains": [
      "Body",
      "Order"
    ],
    "sourceUrl": "https://piltoverarchive.com/decks/view/b33fdf40-3259-482e-b106-8fdc371d5ddf",
    "sourceTitle": "【THE BEST JARVAN IV】🟠🟡 DEMACIAAAA (Midrange)",
    "author": "lucaqualunque",
    "sourceUpdatedAt": "2026-10-31T17:42:15.988Z",
    "reviewedAt": "2026-11-11",
    "sourceEvidence": {
      "provider": "Piltover Archive",
      "discoveryUrl": "https://piltoverarchive.com/decks",
      "selection": "Trending",
      "views": 10397,
      "likes": 84,
      "observedAt": "2026-11-11"
    },
    "legalityReview": {
      "format": "Standard Constructed",
      "rulesUrl": "https://playriftbound.com/en-us/rules-hub/",
      "banListUpdatedAt": "2026-09-18",
      "checkedAt": "2026-11-11",
      "status": "Snapshot checked against the 18 September ban list and Atlas catalogue on 11 November 2026"
    },
    "atlasExportStatus": "Verified with the public Atlas parser on 11 November 2026",
    "cards": {
      "legend": [
        {
          "name": "Jarvan IV, Exemplar of Demacia",
          "quantity": 1,
          "printId": "RAD-176",
          "registryPrintId": "RAD-176"
        }
      ],
      "champion": [
        {
          "name": "Jarvan IV, Martial Paragon",
          "quantity": 1,
          "printId": "RAD-091",
          "registryPrintId": "RAD-091"
        }
      ],
      "mainDeck": [
        {
          "name": "Pit Rookie",
          "quantity": 3,
          "printId": "OGN-136",
          "registryPrintId": "OGN-136"
        },
        {
          "name": "Honest Broker",
          "quantity": 3,
          "printId": "SFD-155",
          "registryPrintId": "SFD-155"
        },
        {
          "name": "Ambessa, The Wolf",
          "quantity": 2,
          "printId": "VEN-084a",
          "registryPrintId": "VEN-084A"
        },
        {
          "name": "Pillaged Armory",
          "quantity": 3,
          "printId": "RAD-073",
          "registryPrintId": "RAD-073"
        },
        {
          "name": "Skystrike Squadron",
          "quantity": 2,
          "printId": "RAD-075",
          "registryPrintId": "RAD-075"
        },
        {
          "name": "Sabotage",
          "quantity": 2,
          "printId": "OGN-156",
          "registryPrintId": "OGN-156"
        },
        {
          "name": "Punch First",
          "quantity": 3,
          "printId": "SFD-097",
          "registryPrintId": "SFD-097"
        },
        {
          "name": "Kinkou Initiate",
          "quantity": 3,
          "printId": "UNL-097",
          "registryPrintId": "UNL-097"
        },
        {
          "name": "Rampage",
          "quantity": 3,
          "printId": "VEN-083",
          "registryPrintId": "VEN-083"
        },
        {
          "name": "Concert Poster",
          "quantity": 2,
          "printId": "RAD-116",
          "registryPrintId": "RAD-116"
        },
        {
          "name": "Dockside Lock-Up",
          "quantity": 2,
          "printId": "RAD-136",
          "registryPrintId": "RAD-136"
        },
        {
          "name": "Demacian Standard",
          "quantity": 2,
          "printId": "RAD-156",
          "registryPrintId": "RAD-156"
        },
        {
          "name": "Rengar, Trophy Hunter",
          "quantity": 1,
          "printId": "UNL-120",
          "registryPrintId": "UNL-120"
        },
        {
          "name": "Rengar, Trophy Hunter",
          "quantity": 1,
          "printId": "UNL-120a",
          "registryPrintId": "UNL-120A"
        },
        {
          "name": "Call to Glory",
          "quantity": 3,
          "printId": "OGN-207",
          "registryPrintId": "OGN-207"
        },
        {
          "name": "Qiyana, Victorious",
          "quantity": 3,
          "printId": "OGN-155",
          "registryPrintId": "OGN-155"
        },
        {
          "name": "Akshan, Mischievous",
          "quantity": 1,
          "printId": "SFD-109",
          "registryPrintId": "SFD-109"
        }
      ],
      "runes": [
        {
          "name": "Body Rune",
          "quantity": 7,
          "printId": "SFD-R04a",
          "registryPrintId": "VEN-R04"
        },
        {
          "name": "Order Rune",
          "quantity": 5,
          "printId": "SFD-R06a",
          "registryPrintId": "VEN-R06"
        }
      ],
      "battlefields": [
        {
          "name": "Monastery of Hirana",
          "quantity": 1,
          "printId": "OGN-282",
          "registryPrintId": "OGN-282"
        },
        {
          "name": "Hunters' Circle",
          "quantity": 1,
          "printId": "RAD-163",
          "registryPrintId": "RAD-163"
        },
        {
          "name": "Sunken Temple",
          "quantity": 1,
          "printId": "SFD-218",
          "registryPrintId": "SFD-218"
        }
      ],
      "sideboard": [
        {
          "name": "Salvage",
          "quantity": 2,
          "printId": "OGN-224",
          "registryPrintId": "OGN-224"
        },
        {
          "name": "Decree of Strength",
          "quantity": 2,
          "printId": "VEN-085",
          "registryPrintId": "VEN-085"
        },
        {
          "name": "Ruin Runner",
          "quantity": 2,
          "printId": "SFD-105",
          "registryPrintId": "SFD-105"
        },
        {
          "name": "Akshan, Mischievous",
          "quantity": 1,
          "printId": "SFD-109",
          "registryPrintId": "SFD-109"
        },
        {
          "name": "Ambessa, The Wolf",
          "quantity": 1,
          "printId": "VEN-084a",
          "registryPrintId": "VEN-084A"
        },
        {
          "name": "Repulse",
          "quantity": 1,
          "printId": "UNL-106",
          "registryPrintId": "UNL-106"
        },
        {
          "name": "Unyielding Spirit",
          "quantity": 1,
          "printId": "OGN-145",
          "registryPrintId": "OGN-145"
        }
      ]
    }
  },
  {
    "id": "pa-mordekaiser",
    "title": "Mordekaiser — build with units and gear",
    "champion": "Mordekaiser",
    "difficulty": "Some practice",
    "difficultyReason": "The plan uses units, gear and cards in your trash. Read each ability carefully so you know what it spends and what it gives you.",
    "summary": "Build a battlefield presence, then use the cards and resources your abilities give you to keep playing units.",
    "gamePlan": [
      "Develop affordable units and gear. Cards in your trash can matter to your later abilities.",
      "Use a spell to remove an important enemy, then move a surviving unit into position to score."
    ],
    "mulligan": [
      "Look for an early unit such as Honest Broker or Trifarian Captain, and a card you could use on a later turn.",
      "A hand of expensive units and spells that only remove enemies may leave you with no early way to score. Replace enough to look for a useful opening."
    ],
    "firstTurns": [
      "First turn: play an affordable unit or another card that helps you develop a unit soon.",
      "Next turn: look for a battlefield you can conquer. Decide which unit will do the scoring before spending resources elsewhere.",
      "Before using your champion or legend: choose the cards you will discard or banish, and check what you give up."
    ],
    "pitfalls": [
      "The power made by your legend can pay for units or gear, but not spells.",
      "Hidden Blade kills a unit and gives its controller cards. Check who receives those cards and why that exchange helps you."
    ],
    "domains": [
      "Fury",
      "Order"
    ],
    "sourceUrl": "https://piltoverarchive.com/decks/view/a654069e-06db-46c9-96b5-ef7f1d853e9e",
    "sourceTitle": "BEST MORDEKAISER DECK SO FAR (FULLY TESTED)",
    "author": "SamaBR",
    "sourceUpdatedAt": "2026-11-09T16:23:17.433Z",
    "reviewedAt": "2026-11-11",
    "sourceEvidence": {
      "provider": "Piltover Archive",
      "discoveryUrl": "https://piltoverarchive.com/decks",
      "selection": "Trending",
      "views": 19002,
      "likes": 77,
      "observedAt": "2026-11-11"
    },
    "legalityReview": {
      "format": "Standard Constructed",
      "rulesUrl": "https://playriftbound.com/en-us/rules-hub/",
      "banListUpdatedAt": "2026-09-18",
      "checkedAt": "2026-11-11",
      "status": "Snapshot checked against the 18 September ban list and Atlas catalogue on 11 November 2026"
    },
    "atlasExportStatus": "Verified with the public Atlas parser on 11 November 2026",
    "cards": {
      "legend": [
        {
          "name": "Mordekaiser, Iron Revenant",
          "quantity": 1,
          "printId": "RAD-143",
          "registryPrintId": "RAD-143"
        }
      ],
      "champion": [
        {
          "name": "Mordekaiser, Dominating",
          "quantity": 1,
          "printId": "RAD-137",
          "registryPrintId": "RAD-137"
        }
      ],
      "mainDeck": [
        {
          "name": "Falling Star",
          "quantity": 2,
          "printId": "OGN-029",
          "registryPrintId": "OGN-029"
        },
        {
          "name": "Noxus Hopeful",
          "quantity": 3,
          "printId": "OGN-012",
          "registryPrintId": "OGN-012"
        },
        {
          "name": "Long Sword",
          "quantity": 1,
          "printId": "SFD-022",
          "registryPrintId": "SFD-022"
        },
        {
          "name": "Ferrous Forerunner",
          "quantity": 1,
          "printId": "SFD-021",
          "registryPrintId": "SFD-021"
        },
        {
          "name": "Kai'Sa, Survivor",
          "quantity": 3,
          "printId": "OGN-039",
          "registryPrintId": "OGN-039"
        },
        {
          "name": "Vanguard Captain",
          "quantity": 3,
          "printId": "OGN-218",
          "registryPrintId": "OGN-218"
        },
        {
          "name": "Trifarian Captain",
          "quantity": 3,
          "printId": "RAD-129",
          "registryPrintId": "RAD-129"
        },
        {
          "name": "Runeblade Anvil",
          "quantity": 3,
          "printId": "RAD-012",
          "registryPrintId": "RAD-012"
        },
        {
          "name": "Detonate",
          "quantity": 3,
          "printId": "SFD-005",
          "registryPrintId": "SFD-005"
        },
        {
          "name": "Seal of Rage",
          "quantity": 3,
          "printId": "OGN-040",
          "registryPrintId": "OGN-040"
        },
        {
          "name": "Honest Broker",
          "quantity": 3,
          "printId": "SFD-155",
          "registryPrintId": "SFD-155"
        },
        {
          "name": "Hidden Blade",
          "quantity": 2,
          "printId": "OGN-213",
          "registryPrintId": "OGN-213"
        },
        {
          "name": "Realm of Death",
          "quantity": 3,
          "printId": "RAD-144",
          "registryPrintId": "RAD-144"
        },
        {
          "name": "Protector's Shield",
          "quantity": 1,
          "printId": "RAD-123",
          "registryPrintId": "RAD-123"
        },
        {
          "name": "Carrion Dredger",
          "quantity": 2,
          "printId": "UNL-153",
          "registryPrintId": "UNL-153"
        },
        {
          "name": "Vi, Peacekeeper",
          "quantity": 1,
          "printId": "UNL-176",
          "registryPrintId": "UNL-176"
        },
        {
          "name": "Deathgrip",
          "quantity": 1,
          "printId": "SFD-163",
          "registryPrintId": "SFD-163"
        },
        {
          "name": "Jhin, Murderous Artist",
          "quantity": 1,
          "printId": "UNL-022",
          "registryPrintId": "UNL-022"
        }
      ],
      "runes": [
        {
          "name": "Fury Rune",
          "quantity": 8,
          "printId": "OGN-007",
          "registryPrintId": "OGN-007"
        },
        {
          "name": "Order Rune",
          "quantity": 4,
          "printId": "OGN-214",
          "registryPrintId": "OGN-214"
        }
      ],
      "battlefields": [
        {
          "name": "Zaun Warrens",
          "quantity": 1,
          "printId": "OGN-298",
          "registryPrintId": "OGN-298"
        },
        {
          "name": "The Candlelit Sanctum",
          "quantity": 1,
          "printId": "OGN-291",
          "registryPrintId": "OGN-291"
        },
        {
          "name": "Black Rose Sanctum",
          "quantity": 1,
          "printId": "RAD-159",
          "registryPrintId": "RAD-159"
        }
      ],
      "sideboard": [
        {
          "name": "Ferrous Forerunner",
          "quantity": 1,
          "printId": "SFD-021",
          "registryPrintId": "SFD-021"
        },
        {
          "name": "Falling Star",
          "quantity": 1,
          "printId": "OGN-029",
          "registryPrintId": "OGN-029"
        },
        {
          "name": "Vi, Peacekeeper",
          "quantity": 1,
          "printId": "UNL-176",
          "registryPrintId": "UNL-176"
        },
        {
          "name": "Zaun Punk",
          "quantity": 2,
          "printId": "SFD-160",
          "registryPrintId": "SFD-160"
        },
        {
          "name": "Decree of Unity",
          "quantity": 2,
          "printId": "VEN-131",
          "registryPrintId": "VEN-131"
        },
        {
          "name": "Salvage",
          "quantity": 1,
          "printId": "OGN-224",
          "registryPrintId": "OGN-224"
        },
        {
          "name": "Minotaur Reckoner",
          "quantity": 1,
          "printId": "SFD-014",
          "registryPrintId": "SFD-014"
        },
        {
          "name": "Mordekaiser, Twice Slain",
          "quantity": 1,
          "printId": "RAD-020",
          "registryPrintId": "RAD-020"
        }
      ]
    }
  },
  {
    "id": "pa-kaisa",
    "title": "Kai'Sa — protect your units with spells",
    "champion": "Kai'Sa",
    "difficulty": "Some practice",
    "difficultyReason": "A useful next deck once combat feels familiar. You will choose when to spend spells and when to save resources.",
    "summary": "Keep a few useful units alive with spells, then use them to conquer and hold battlefields.",
    "gamePlan": [
      "Play an affordable unit, then use spells when they help that unit survive or score.",
      "Look for a fight Kai’Sa can win. Drawing more cards gives you new options, but you still need to pay for them."
    ],
    "mulligan": [
      "Look for an early unit such as Watchful Sentry or Plundering Poro, with an affordable spell that supports your plan.",
      "Replace expensive cards when they leave you without a useful early play. Keeping one later card can be fine if the rest of your hand works."
    ],
    "firstTurns": [
      "First turn: establish an affordable unit. You need a unit to conquer and hold a battlefield.",
      "Next turn: inspect the enemy units and decide which fight your spells could change.",
      "Before paying: check the legend’s spell-only power. Save the other resources needed for units and any optional costs."
    ],
    "pitfalls": [
      "The legend’s resource pays for spells. It does not pay for units or their Accelerate costs.",
      "A unit can be too costly to save. Check whether spending several spells here will actually help you score."
    ],
    "domains": [
      "Fury",
      "Mind"
    ],
    "sourceUrl": "https://piltoverarchive.com/decks/view/a378f5db-f239-4993-9591-5ac39d2fe660",
    "sourceTitle": "Kai'Sa - Stuttgart",
    "author": "Takolandia",
    "sourceUpdatedAt": "2026-10-29T16:37:28.768Z",
    "reviewedAt": "2026-11-11",
    "sourceEvidence": {
      "provider": "Piltover Archive",
      "discoveryUrl": "https://piltoverarchive.com/decks",
      "selection": "Trending",
      "views": 9767,
      "likes": 44,
      "observedAt": "2026-11-11"
    },
    "legalityReview": {
      "format": "Standard Constructed",
      "rulesUrl": "https://playriftbound.com/en-us/rules-hub/",
      "banListUpdatedAt": "2026-09-18",
      "checkedAt": "2026-11-11",
      "status": "Snapshot checked against the 18 September ban list and Atlas catalogue on 11 November 2026"
    },
    "atlasExportStatus": "Verified with the public Atlas parser on 11 November 2026",
    "cards": {
      "legend": [
        {
          "name": "Kai'Sa, Daughter of the Void",
          "quantity": 1,
          "printId": "OGN-247",
          "registryPrintId": "OGN-247"
        }
      ],
      "champion": [
        {
          "name": "Kai'Sa, Survivor",
          "quantity": 1,
          "printId": "OGN-039",
          "registryPrintId": "OGN-039"
        }
      ],
      "mainDeck": [
        {
          "name": "Hextech Ray",
          "quantity": 3,
          "printId": "OGN-009",
          "registryPrintId": "OGN-009"
        },
        {
          "name": "Falling Star",
          "quantity": 3,
          "printId": "OGN-029",
          "registryPrintId": "OGN-029"
        },
        {
          "name": "Stupefy",
          "quantity": 3,
          "printId": "OGN-095",
          "registryPrintId": "OGN-095"
        },
        {
          "name": "Time Warp",
          "quantity": 2,
          "printId": "OGN-122",
          "registryPrintId": "OGN-122"
        },
        {
          "name": "Smoke Screen",
          "quantity": 2,
          "printId": "OGN-093",
          "registryPrintId": "OGN-093"
        },
        {
          "name": "Watchful Sentry",
          "quantity": 3,
          "printId": "OGN-096",
          "registryPrintId": "OGN-096"
        },
        {
          "name": "Thousand-Tailed Watcher",
          "quantity": 3,
          "printId": "OGN-116",
          "registryPrintId": "OGN-116"
        },
        {
          "name": "Noxus Hopeful",
          "quantity": 2,
          "printId": "OGN-012",
          "registryPrintId": "OGN-012"
        },
        {
          "name": "Lecturing Yordle",
          "quantity": 3,
          "printId": "OGN-087",
          "registryPrintId": "OGN-087"
        },
        {
          "name": "Brynhir Thundersong",
          "quantity": 3,
          "printId": "OGN-026",
          "registryPrintId": "OGN-026"
        },
        {
          "name": "Temporal Breach",
          "quantity": 3,
          "printId": "VEN-066",
          "registryPrintId": "VEN-066"
        },
        {
          "name": "Plundering Poro",
          "quantity": 3,
          "printId": "SFD-069",
          "registryPrintId": "SFD-069"
        },
        {
          "name": "Bellows Breath",
          "quantity": 2,
          "printId": "SFD-080",
          "registryPrintId": "SFD-080"
        },
        {
          "name": "Bilgewater Tracker",
          "quantity": 2,
          "printId": "RAD-003",
          "registryPrintId": "RAD-003"
        },
        {
          "name": "The Empyrean",
          "quantity": 2,
          "printId": "RAD-060",
          "registryPrintId": "RAD-060"
        }
      ],
      "runes": [
        {
          "name": "Fury Rune",
          "quantity": 6,
          "printId": "OGN-007",
          "registryPrintId": "OGN-007"
        },
        {
          "name": "Mind Rune",
          "quantity": 6,
          "printId": "OGN-089",
          "registryPrintId": "OGN-089"
        }
      ],
      "battlefields": [
        {
          "name": "Void Gate",
          "quantity": 1,
          "printId": "OGN-296",
          "registryPrintId": "OGN-296"
        },
        {
          "name": "Rockfall Path",
          "quantity": 1,
          "printId": "SFD-216",
          "registryPrintId": "SFD-216"
        },
        {
          "name": "Frozen Fortress",
          "quantity": 1,
          "printId": "UNL-212",
          "registryPrintId": "UNL-212"
        }
      ],
      "sideboard": [
        {
          "name": "Ferrous Forerunner",
          "quantity": 2,
          "printId": "SFD-021",
          "registryPrintId": "SFD-021"
        },
        {
          "name": "Decree of Insight",
          "quantity": 1,
          "printId": "VEN-061",
          "registryPrintId": "VEN-061"
        },
        {
          "name": "Decree of Rage",
          "quantity": 2,
          "printId": "VEN-015",
          "registryPrintId": "VEN-015"
        },
        {
          "name": "Brittle Steel",
          "quantity": 2,
          "printId": "VEN-003",
          "registryPrintId": "VEN-003"
        },
        {
          "name": "Pickpocket",
          "quantity": 2,
          "printId": "SFD-074",
          "registryPrintId": "SFD-074"
        },
        {
          "name": "Icathian Rain",
          "quantity": 1,
          "printId": "OGN-248",
          "registryPrintId": "OGN-248"
        }
      ]
    }
  },
  {
    "id": "pa-kennen",
    "title": "Kennen — reuse spells and keep moving",
    "champion": "Kennen",
    "difficulty": "Advanced",
    "difficultyReason": "Try this after your first games. It asks you to track cards in the trash, movement and several separate payments.",
    "summary": "Use specific abilities to play useful spells again, then move your units into fresh scoring opportunities.",
    "gamePlan": [
      "Lightning Rush and your units help prepare cards in your trash for later abilities. Those cards are only usable when a rule permits it.",
      "Conquer with Kennen to reuse a spell. Then look for another attack using movement and the Assault granted by your legend."
    ],
    "mulligan": [
      "Look for an early unit such as Traveling Merchant or Trifarian Captain, with something useful for the next turn.",
      "A hand full of Rhasa and expensive responses can leave you waiting. Look for an affordable way to begin developing your position."
    ],
    "firstTurns": [
      "First turn: develop an affordable unit and keep track of any cards that reach your trash.",
      "Next turn: plan which battlefield your unit can conquer, then check which spell or movement ability could help.",
      "Before using Ride the Wind: decide where the unit should finish and count the resources remaining for a response."
    ],
    "pitfalls": [
      "Flow still has a cost. Follow the spell’s Flow text, including sending it to Banishment after use.",
      "Assault applies while the unit is attacking, through the end of combat. Count energy and matching power before starting a sequence of plays."
    ],
    "domains": [
      "Order",
      "Chaos"
    ],
    "sourceUrl": "https://piltoverarchive.com/decks/view/c67fa64e-e41e-4011-b485-470b4510935e",
    "sourceTitle": "Kennen - Radiance #1 Deck wow!!!",
    "author": "mom sky",
    "sourceUpdatedAt": "2026-10-28T02:53:44.263Z",
    "reviewedAt": "2026-11-11",
    "sourceEvidence": {
      "provider": "Piltover Archive",
      "discoveryUrl": "https://piltoverarchive.com/decks",
      "selection": "Trending",
      "views": 4993,
      "likes": 18,
      "observedAt": "2026-11-11",
      "competitiveContext": {
        "url": "https://piltoverarchive.com/learn",
        "note": "PA currently lists Kennen among key Stuttgart matchups and carries Kennen tournament-preparation guides. This supports the archetype context, not a placing for this exact list."
      }
    },
    "legalityReview": {
      "format": "Standard Constructed",
      "rulesUrl": "https://playriftbound.com/en-us/rules-hub/",
      "banListUpdatedAt": "2026-09-18",
      "checkedAt": "2026-11-11",
      "status": "Snapshot checked against the 18 September ban list and Atlas catalogue on 11 November 2026"
    },
    "atlasExportStatus": "Verified with the public Atlas parser on 11 November 2026",
    "cards": {
      "legend": [
        {
          "name": "Kennen, Heart of the Tempest",
          "quantity": 1,
          "printId": "VEN-155",
          "registryPrintId": "VEN-155"
        }
      ],
      "champion": [
        {
          "name": "Kennen, Storm of Shuriken",
          "quantity": 1,
          "printId": "VEN-113a",
          "registryPrintId": "VEN-113A"
        }
      ],
      "mainDeck": [
        {
          "name": "Gust",
          "quantity": 2,
          "printId": "OGN-169",
          "registryPrintId": "OGN-169"
        },
        {
          "name": "Ride the Wind",
          "quantity": 3,
          "printId": "OGN-173",
          "registryPrintId": "OGN-173"
        },
        {
          "name": "Traveling Merchant",
          "quantity": 3,
          "printId": "OGN-185",
          "registryPrintId": "OGN-185"
        },
        {
          "name": "Rhasa the Sunderer",
          "quantity": 3,
          "printId": "OGN-195",
          "registryPrintId": "OGN-195"
        },
        {
          "name": "Nocturne, Horrifying",
          "quantity": 3,
          "printId": "OGN-194",
          "registryPrintId": "OGN-194"
        },
        {
          "name": "Seal of Discord",
          "quantity": 3,
          "printId": "OGN-204",
          "registryPrintId": "OGN-204"
        },
        {
          "name": "Flash",
          "quantity": 1,
          "printId": "OGS-011",
          "registryPrintId": "OGS-011"
        },
        {
          "name": "Fizz, Trickster",
          "quantity": 1,
          "printId": "SFD-140",
          "registryPrintId": "SFD-140"
        },
        {
          "name": "Switcheroo",
          "quantity": 2,
          "printId": "SFD-145",
          "registryPrintId": "SFD-145"
        },
        {
          "name": "Last Rites",
          "quantity": 2,
          "printId": "SFD-150",
          "registryPrintId": "SFD-150"
        },
        {
          "name": "Star-Crossed",
          "quantity": 1,
          "printId": "UNL-128",
          "registryPrintId": "UNL-128"
        },
        {
          "name": "Lightning Rush",
          "quantity": 3,
          "printId": "VEN-156",
          "registryPrintId": "VEN-156"
        },
        {
          "name": "Trifarian Captain",
          "quantity": 3,
          "printId": "RAD-129",
          "registryPrintId": "RAD-129"
        },
        {
          "name": "Shadow Order Disciple",
          "quantity": 2,
          "printId": "VEN-095",
          "registryPrintId": "VEN-095"
        },
        {
          "name": "Ezreal, Prodigy",
          "quantity": 2,
          "printId": "VEN-SP5",
          "registryPrintId": "VEN-SP5"
        },
        {
          "name": "Hard Bargain",
          "quantity": 1,
          "printId": "SFD-136",
          "registryPrintId": "SFD-136"
        },
        {
          "name": "Existential Dread",
          "quantity": 1,
          "printId": "UNL-134",
          "registryPrintId": "UNL-134"
        },
        {
          "name": "An Offer You Can't Refuse",
          "quantity": 1,
          "printId": "RAD-101",
          "registryPrintId": "RAD-101"
        },
        {
          "name": "Rebuke",
          "quantity": 1,
          "printId": "OGN-172",
          "registryPrintId": "OGN-172"
        },
        {
          "name": "Bedeviling Stranger",
          "quantity": 1,
          "printId": "RAD-107",
          "registryPrintId": "RAD-107"
        }
      ],
      "battlefields": [
        {
          "name": "Zaun Warrens",
          "quantity": 1,
          "printId": "OGN-298",
          "registryPrintId": "OGN-298"
        },
        {
          "name": "Minefield",
          "quantity": 1,
          "printId": "SFD-212",
          "registryPrintId": "SFD-212"
        },
        {
          "name": "Sandswept Tomb",
          "quantity": 1,
          "printId": "VEN-164",
          "registryPrintId": "VEN-164"
        }
      ],
      "runes": [
        {
          "name": "Chaos Rune",
          "quantity": 9,
          "printId": "OGN-166",
          "registryPrintId": "OGN-166"
        },
        {
          "name": "Order Rune",
          "quantity": 3,
          "printId": "OGN-214",
          "registryPrintId": "OGN-214"
        }
      ],
      "sideboard": [
        {
          "name": "Decree of Unity",
          "quantity": 2,
          "printId": "VEN-131",
          "registryPrintId": "VEN-131"
        },
        {
          "name": "Rebuke",
          "quantity": 1,
          "printId": "OGN-172",
          "registryPrintId": "OGN-172"
        },
        {
          "name": "Shadows of the Past",
          "quantity": 1,
          "printId": "VEN-103",
          "registryPrintId": "VEN-103"
        },
        {
          "name": "Star-Crossed",
          "quantity": 1,
          "printId": "UNL-128",
          "registryPrintId": "UNL-128"
        },
        {
          "name": "Abandon",
          "quantity": 1,
          "printId": "UNL-131",
          "registryPrintId": "UNL-131"
        },
        {
          "name": "An Offer You Can't Refuse",
          "quantity": 1,
          "printId": "RAD-101",
          "registryPrintId": "RAD-101"
        },
        {
          "name": "Fizz, Trickster",
          "quantity": 1,
          "printId": "SFD-140",
          "registryPrintId": "SFD-140"
        },
        {
          "name": "Up from the Deep",
          "quantity": 1,
          "printId": "VEN-100",
          "registryPrintId": "VEN-100"
        },
        {
          "name": "Ravenbloom Prefect",
          "quantity": 1,
          "printId": "VEN-102",
          "registryPrintId": "VEN-102"
        }
      ]
    }
  }
] as const satisfies readonly CuratedNewPlayerDeck[];

function mergeNames(cards: readonly NewPlayerDeckCard[]): Array<{ name: string; quantity: number }> {
  const byName = new Map<string, { name: string; quantity: number }>();
  for (const card of cards) {
    const prior = byName.get(card.name);
    if (prior) prior.quantity += card.quantity;
    else byName.set(card.name, { name: card.name, quantity: card.quantity });
  }
  return [...byName.values()];
}

function section(label: string, cards: readonly NewPlayerDeckCard[]): string {
  return [label, ...mergeNames(cards).map(card => `${card.quantity} ${card.name}`)].join("\n");
}

export function formatNewPlayerDeckForRiftLite(deck: Pick<NewPlayerDeck, "title" | "cards">): string {
  return [
    deck.title,
    section("Legend", deck.cards.legend),
    section("Runes", deck.cards.runes),
    section("Battlefields", deck.cards.battlefields),
    section("Main Deck", [...deck.cards.champion, ...deck.cards.mainDeck]),
    section("Sideboard", deck.cards.sideboard)
  ].join("\n\n");
}

/** Named-card exports intentionally omit source printing pins: PA and Atlas use different alternate-print IDs. */
export function newPlayerDeckAtlasText(deck: Pick<NewPlayerDeck, "cards">): string {
  return [
    section("Legend:", deck.cards.legend),
    section("Champion:", deck.cards.champion),
    section("MainDeck:", deck.cards.mainDeck),
    section("Battlefields:", deck.cards.battlefields),
    section("Runes:", deck.cards.runes),
    section("Sideboard:", deck.cards.sideboard)
  ].join("\n\n");
}

export const NEW_PLAYER_DECKS: readonly NewPlayerDeck[] = CURATED_NEW_PLAYER_DECKS.map(deck => ({
  ...deck,
  deckText: formatNewPlayerDeckForRiftLite(deck),
  atlasDeckText: newPlayerDeckAtlasText(deck)
}));

export function getNewPlayerDeck(id: string): NewPlayerDeck | undefined {
  return NEW_PLAYER_DECKS.find(deck => deck.id === id);
}
