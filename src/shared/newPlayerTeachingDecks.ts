import { NEW_PLAYER_DECKS } from "./newPlayerDecks.js";

export interface NewPlayerTeachingDeckEntry {
  readonly cardId: string;
  readonly quantity: number;
}
export interface NewPlayerTeachingDeck {
  readonly id: string;
  readonly title: string;
  readonly kind: "published" | "teaching";
  readonly legendId: string;
  readonly championId: string;
  readonly domains: readonly string[];
  /** All 40 Main Deck cards, including the one chosen champion placed in its zone. */
  readonly main: readonly NewPlayerTeachingDeckEntry[];
  readonly runes: readonly NewPlayerTeachingDeckEntry[];
  readonly battlefields: readonly NewPlayerTeachingDeckEntry[];
  readonly sideboard: readonly NewPlayerTeachingDeckEntry[];
  readonly sourceUrl?: string;
  readonly author?: string;
  readonly sourceUpdatedAt?: string;
  readonly reviewedAt: string;
  readonly notes: string;
  /** Token identities are generated during play; they are never Main Deck cards. */
  readonly tokenSources?: Readonly<Record<string, readonly string[]>>;
}
export interface NewPlayerTeachingCardFacts {
  readonly name: string;
  readonly type: string;
  readonly domains: readonly string[];
  readonly supertype?: string;
  readonly tags?: readonly string[];
  readonly maxCopies: number;
}

const entries = (cards: readonly { registryPrintId: string; quantity: number }[]): NewPlayerTeachingDeckEntry[] =>
  cards.map(card => ({ cardId: card.registryPrintId, quantity: card.quantity }));
const publishedDecks: readonly NewPlayerTeachingDeck[] = NEW_PLAYER_DECKS.map(deck => ({
  id: deck.id, title: deck.sourceTitle, kind: "published", legendId: deck.cards.legend[0].registryPrintId,
  championId: deck.cards.champion[0].registryPrintId, domains: deck.domains,
  main: entries([...deck.cards.champion, ...deck.cards.mainDeck]), runes: entries(deck.cards.runes),
  battlefields: entries(deck.cards.battlefields), sideboard: entries(deck.cards.sideboard),
  sourceUrl: deck.sourceUrl, author: deck.author, sourceUpdatedAt: deck.sourceUpdatedAt, reviewedAt: deck.reviewedAt,
  notes: "An unchanged dated Piltover Archive list. The lesson uses a prepared position from these cards; it is not a recorded game."
}));

// BEGIN VERIFIED DATA
const extraPublishedDecks: readonly NewPlayerTeachingDeck[] = [
  {
    "id": "pa-practice-ornn",
    "title": "ornn",
    "kind": "published",
    "legendId": "SFD-189",
    "championId": "SFD-085",
    "domains": [
      "Calm",
      "Mind"
    ],
    "main": [
      {
        "cardId": "SFD-085",
        "quantity": 3
      },
      {
        "cardId": "OGN-120",
        "quantity": 3
      },
      {
        "cardId": "OGN-081",
        "quantity": 3
      },
      {
        "cardId": "SFD-046",
        "quantity": 3
      },
      {
        "cardId": "SFD-043",
        "quantity": 1
      },
      {
        "cardId": "OGN-096",
        "quantity": 3
      },
      {
        "cardId": "OGN-044",
        "quantity": 3
      },
      {
        "cardId": "SFD-045",
        "quantity": 2
      },
      {
        "cardId": "OGN-087",
        "quantity": 2
      },
      {
        "cardId": "SFD-083",
        "quantity": 2
      },
      {
        "cardId": "SFD-056",
        "quantity": 3
      },
      {
        "cardId": "SFD-072",
        "quantity": 3
      },
      {
        "cardId": "SFD-192",
        "quantity": 1
      },
      {
        "cardId": "SFD-190",
        "quantity": 1
      },
      {
        "cardId": "SFD-191",
        "quantity": 1
      },
      {
        "cardId": "OGN-114",
        "quantity": 3
      },
      {
        "cardId": "OGN-116",
        "quantity": 2
      },
      {
        "cardId": "OGN-122",
        "quantity": 1
      }
    ],
    "runes": [
      {
        "cardId": "OGN-042A",
        "quantity": 7
      },
      {
        "cardId": "OGN-089A",
        "quantity": 5
      }
    ],
    "battlefields": [
      {
        "cardId": "SFD-213",
        "quantity": 1
      },
      {
        "cardId": "SFD-218",
        "quantity": 1
      },
      {
        "cardId": "OGN-297",
        "quantity": 1
      }
    ],
    "sideboard": [
      {
        "cardId": "OGN-045",
        "quantity": 1
      },
      {
        "cardId": "SFD-032",
        "quantity": 3
      },
      {
        "cardId": "OGN-064",
        "quantity": 3
      },
      {
        "cardId": "OGN-080",
        "quantity": 1
      }
    ],
    "sourceUrl": "https://piltoverarchive.com/decks/view/39a67a63-f7ae-44d9-9037-e9fd71dfec8d",
    "author": "Jude Biwer",
    "sourceUpdatedAt": "2025-12-16T16:10:41.250Z",
    "reviewedAt": "2026-11-11",
    "notes": "An unchanged published Piltover Archive card list, checked 11 November 2026. One copy of the named chosen champion starts in its zone; other copies remain in the Main Deck. The lesson is a prepared practice position, not a recorded game."
  },
  {
    "id": "pa-practice-viktor",
    "title": "Viktor",
    "kind": "published",
    "legendId": "OGN-265",
    "championId": "OGN-246A",
    "domains": [
      "Order",
      "Mind"
    ],
    "main": [
      {
        "cardId": "OGN-246A",
        "quantity": 1
      },
      {
        "cardId": "OGN-245",
        "quantity": 1
      },
      {
        "cardId": "OGN-095",
        "quantity": 3
      },
      {
        "cardId": "OGN-216",
        "quantity": 3
      },
      {
        "cardId": "OGN-096",
        "quantity": 3
      },
      {
        "cardId": "OGN-213",
        "quantity": 3
      },
      {
        "cardId": "OGN-093",
        "quantity": 2
      },
      {
        "cardId": "OGN-209",
        "quantity": 3
      },
      {
        "cardId": "OGN-211",
        "quantity": 3
      },
      {
        "cardId": "OGN-222",
        "quantity": 3
      },
      {
        "cardId": "OGN-218",
        "quantity": 3
      },
      {
        "cardId": "OGN-083",
        "quantity": 2
      },
      {
        "cardId": "OGN-233",
        "quantity": 3
      },
      {
        "cardId": "OGN-246",
        "quantity": 2
      },
      {
        "cardId": "VEN-067",
        "quantity": 1
      },
      {
        "cardId": "SFD-179",
        "quantity": 1
      },
      {
        "cardId": "OGN-116",
        "quantity": 2
      },
      {
        "cardId": "OGN-266",
        "quantity": 1
      }
    ],
    "runes": [
      {
        "cardId": "OGN-214",
        "quantity": 6
      },
      {
        "cardId": "OGN-089",
        "quantity": 6
      }
    ],
    "battlefields": [
      {
        "cardId": "OGN-275",
        "quantity": 1
      },
      {
        "cardId": "OGN-293",
        "quantity": 1
      },
      {
        "cardId": "OGN-294",
        "quantity": 1
      }
    ],
    "sideboard": [],
    "sourceUrl": "https://piltoverarchive.com/decks/view/3aeb7e88-ceb0-44e1-8688-b3489b92de06",
    "author": "17th",
    "sourceUpdatedAt": "2026-10-25T20:12:53.491Z",
    "reviewedAt": "2026-11-11",
    "notes": "An unchanged published Piltover Archive card list, checked 11 November 2026. One copy of the named chosen champion starts in its zone; other copies remain in the Main Deck. The lesson is a prepared practice position, not a recorded game."
  }
];
const teachingDecks: readonly NewPlayerTeachingDeck[] = [
  {
    "id": "teaching-kaisa",
    "title": "Kai'Sa — keyword teaching deck",
    "kind": "teaching",
    "legendId": "OGN-247",
    "championId": "OGN-039",
    "domains": [
      "Fury",
      "Mind"
    ],
    "main": [
      {
        "cardId": "OGN-039",
        "quantity": 1
      },
      {
        "cardId": "OGN-010",
        "quantity": 3
      },
      {
        "cardId": "OGN-004",
        "quantity": 3
      },
      {
        "cardId": "OGN-096",
        "quantity": 3
      },
      {
        "cardId": "OGN-013",
        "quantity": 3
      },
      {
        "cardId": "OGN-036",
        "quantity": 3
      },
      {
        "cardId": "OGN-012",
        "quantity": 3
      },
      {
        "cardId": "SFD-022",
        "quantity": 3
      },
      {
        "cardId": "SFD-003",
        "quantity": 2
      },
      {
        "cardId": "SFD-002",
        "quantity": 2
      },
      {
        "cardId": "UNL-002",
        "quantity": 2
      },
      {
        "cardId": "UNL-016",
        "quantity": 2
      },
      {
        "cardId": "VEN-001",
        "quantity": 2
      },
      {
        "cardId": "VEN-049",
        "quantity": 2
      },
      {
        "cardId": "RAD-002",
        "quantity": 2
      },
      {
        "cardId": "RAD-050",
        "quantity": 2
      },
      {
        "cardId": "UNL-078",
        "quantity": 2
      }
    ],
    "runes": [
      {
        "cardId": "OGN-007",
        "quantity": 6
      },
      {
        "cardId": "OGN-089",
        "quantity": 6
      }
    ],
    "battlefields": [
      {
        "cardId": "OGN-282",
        "quantity": 1
      },
      {
        "cardId": "SFD-216",
        "quantity": 1
      },
      {
        "cardId": "OGN-293",
        "quantity": 1
      }
    ],
    "sideboard": [],
    "reviewedAt": "2026-11-11",
    "notes": "A complete legal RiftLite teaching list built to support these keyword examples. It is not a published or recommended competitive list. Prepared positions show only the cards relevant to the lesson; ordinary card and battlefield rules still apply.",
    "tokenSources": {
      "UNL-T07": [
        "UNL-078"
      ]
    }
  },
  {
    "id": "teaching-darius",
    "title": "Darius — keyword teaching deck",
    "kind": "teaching",
    "legendId": "OGN-253",
    "championId": "OGN-027",
    "domains": [
      "Fury",
      "Order"
    ],
    "main": [
      {
        "cardId": "OGN-027",
        "quantity": 1
      },
      {
        "cardId": "OGN-010",
        "quantity": 3
      },
      {
        "cardId": "OGN-004",
        "quantity": 3
      },
      {
        "cardId": "OGN-215",
        "quantity": 3
      },
      {
        "cardId": "OGN-013",
        "quantity": 3
      },
      {
        "cardId": "OGN-036",
        "quantity": 3
      },
      {
        "cardId": "OGN-213",
        "quantity": 3
      },
      {
        "cardId": "OGN-012",
        "quantity": 3
      },
      {
        "cardId": "SFD-022",
        "quantity": 3
      },
      {
        "cardId": "SFD-003",
        "quantity": 3
      },
      {
        "cardId": "SFD-002",
        "quantity": 3
      },
      {
        "cardId": "UNL-002",
        "quantity": 3
      },
      {
        "cardId": "UNL-016",
        "quantity": 2
      },
      {
        "cardId": "VEN-001",
        "quantity": 2
      },
      {
        "cardId": "RAD-002",
        "quantity": 2
      }
    ],
    "runes": [
      {
        "cardId": "OGN-007",
        "quantity": 6
      },
      {
        "cardId": "OGN-214",
        "quantity": 6
      }
    ],
    "battlefields": [
      {
        "cardId": "OGN-282",
        "quantity": 1
      },
      {
        "cardId": "SFD-216",
        "quantity": 1
      },
      {
        "cardId": "OGN-293",
        "quantity": 1
      }
    ],
    "sideboard": [],
    "reviewedAt": "2026-11-11",
    "notes": "A complete legal RiftLite teaching list built to support these keyword examples. It is not a published or recommended competitive list. Prepared positions show only the cards relevant to the lesson; ordinary card and battlefield rules still apply."
  },
  {
    "id": "teaching-renekton",
    "title": "Renekton — keyword teaching deck",
    "kind": "teaching",
    "legendId": "VEN-141",
    "championId": "VEN-092",
    "domains": [
      "Fury",
      "Body"
    ],
    "main": [
      {
        "cardId": "VEN-092",
        "quantity": 1
      },
      {
        "cardId": "OGN-010",
        "quantity": 3
      },
      {
        "cardId": "OGN-004",
        "quantity": 3
      },
      {
        "cardId": "OGN-013",
        "quantity": 3
      },
      {
        "cardId": "OGN-036",
        "quantity": 3
      },
      {
        "cardId": "OGN-012",
        "quantity": 3
      },
      {
        "cardId": "SFD-022",
        "quantity": 3
      },
      {
        "cardId": "SFD-003",
        "quantity": 3
      },
      {
        "cardId": "SFD-002",
        "quantity": 3
      },
      {
        "cardId": "UNL-002",
        "quantity": 3
      },
      {
        "cardId": "UNL-016",
        "quantity": 3
      },
      {
        "cardId": "VEN-001",
        "quantity": 3
      },
      {
        "cardId": "RAD-002",
        "quantity": 3
      },
      {
        "cardId": "RAD-082",
        "quantity": 3
      }
    ],
    "runes": [
      {
        "cardId": "OGN-007",
        "quantity": 6
      },
      {
        "cardId": "OGN-126",
        "quantity": 6
      }
    ],
    "battlefields": [
      {
        "cardId": "OGN-282",
        "quantity": 1
      },
      {
        "cardId": "SFD-216",
        "quantity": 1
      },
      {
        "cardId": "OGN-293",
        "quantity": 1
      }
    ],
    "sideboard": [],
    "reviewedAt": "2026-11-11",
    "notes": "A complete legal RiftLite teaching list built to support these keyword examples. It is not a published or recommended competitive list. Prepared positions show only the cards relevant to the lesson; ordinary card and battlefield rules still apply."
  },
  {
    "id": "teaching-teemo",
    "title": "Teemo — keyword teaching deck",
    "kind": "teaching",
    "legendId": "OGN-263",
    "championId": "OGN-197",
    "domains": [
      "Chaos",
      "Mind"
    ],
    "main": [
      {
        "cardId": "OGN-197",
        "quantity": 1
      },
      {
        "cardId": "OGN-096",
        "quantity": 3
      },
      {
        "cardId": "OGN-171",
        "quantity": 3
      },
      {
        "cardId": "VEN-049",
        "quantity": 3
      },
      {
        "cardId": "RAD-050",
        "quantity": 3
      },
      {
        "cardId": "UNL-078",
        "quantity": 3
      },
      {
        "cardId": "OGN-204",
        "quantity": 3
      },
      {
        "cardId": "OGN-120",
        "quantity": 3
      },
      {
        "cardId": "SFD-080",
        "quantity": 3
      },
      {
        "cardId": "VEN-061",
        "quantity": 3
      },
      {
        "cardId": "UNL-134",
        "quantity": 3
      },
      {
        "cardId": "OGN-169",
        "quantity": 3
      },
      {
        "cardId": "OGN-095",
        "quantity": 3
      },
      {
        "cardId": "UNL-131",
        "quantity": 3
      }
    ],
    "runes": [
      {
        "cardId": "OGN-166",
        "quantity": 6
      },
      {
        "cardId": "OGN-089",
        "quantity": 6
      }
    ],
    "battlefields": [
      {
        "cardId": "OGN-282",
        "quantity": 1
      },
      {
        "cardId": "SFD-216",
        "quantity": 1
      },
      {
        "cardId": "OGN-293",
        "quantity": 1
      }
    ],
    "sideboard": [],
    "reviewedAt": "2026-11-11",
    "notes": "A complete legal RiftLite teaching list built to support these keyword examples. It is not a published or recommended competitive list. Prepared positions show only the cards relevant to the lesson; ordinary card and battlefield rules still apply.",
    "tokenSources": {
      "UNL-T07": [
        "UNL-078"
      ]
    }
  },
  {
    "id": "teaching-ornn",
    "title": "Ornn — keyword teaching deck",
    "kind": "teaching",
    "legendId": "SFD-189",
    "championId": "SFD-058",
    "domains": [
      "Calm",
      "Mind"
    ],
    "main": [
      {
        "cardId": "SFD-058",
        "quantity": 1
      },
      {
        "cardId": "OGN-096",
        "quantity": 3
      },
      {
        "cardId": "OGN-058",
        "quantity": 3
      },
      {
        "cardId": "OGN-054",
        "quantity": 3
      },
      {
        "cardId": "SFD-190",
        "quantity": 1
      },
      {
        "cardId": "UNL-043",
        "quantity": 3
      },
      {
        "cardId": "VEN-049",
        "quantity": 3
      },
      {
        "cardId": "RAD-050",
        "quantity": 3
      },
      {
        "cardId": "UNL-078",
        "quantity": 3
      },
      {
        "cardId": "OGN-081",
        "quantity": 3
      },
      {
        "cardId": "OGN-120",
        "quantity": 3
      },
      {
        "cardId": "SFD-080",
        "quantity": 3
      },
      {
        "cardId": "OGN-043",
        "quantity": 3
      },
      {
        "cardId": "VEN-040",
        "quantity": 3
      },
      {
        "cardId": "VEN-061",
        "quantity": 2
      }
    ],
    "runes": [
      {
        "cardId": "OGN-042",
        "quantity": 6
      },
      {
        "cardId": "OGN-089",
        "quantity": 6
      }
    ],
    "battlefields": [
      {
        "cardId": "OGN-282",
        "quantity": 1
      },
      {
        "cardId": "SFD-216",
        "quantity": 1
      },
      {
        "cardId": "OGN-293",
        "quantity": 1
      }
    ],
    "sideboard": [],
    "reviewedAt": "2026-11-11",
    "notes": "A complete legal RiftLite teaching list built to support these keyword examples. It is not a published or recommended competitive list. Prepared positions show only the cards relevant to the lesson; ordinary card and battlefield rules still apply.",
    "tokenSources": {
      "UNL-T07": [
        "UNL-078"
      ]
    }
  },
  {
    "id": "teaching-shen",
    "title": "Shen — keyword teaching deck",
    "kind": "teaching",
    "legendId": "VEN-147",
    "championId": "OGN-241",
    "domains": [
      "Calm",
      "Order"
    ],
    "main": [
      {
        "cardId": "OGN-241",
        "quantity": 1
      },
      {
        "cardId": "OGN-215",
        "quantity": 3
      },
      {
        "cardId": "OGN-213",
        "quantity": 3
      },
      {
        "cardId": "OGN-058",
        "quantity": 3
      },
      {
        "cardId": "OGN-054",
        "quantity": 3
      },
      {
        "cardId": "UNL-043",
        "quantity": 3
      },
      {
        "cardId": "OGN-081",
        "quantity": 3
      },
      {
        "cardId": "OGN-245",
        "quantity": 3
      },
      {
        "cardId": "OGN-043",
        "quantity": 3
      },
      {
        "cardId": "RAD-116",
        "quantity": 3
      },
      {
        "cardId": "VEN-040",
        "quantity": 3
      },
      {
        "cardId": "OGN-045",
        "quantity": 3
      },
      {
        "cardId": "RAD-041",
        "quantity": 3
      },
      {
        "cardId": "SFD-046",
        "quantity": 3
      }
    ],
    "runes": [
      {
        "cardId": "OGN-042",
        "quantity": 6
      },
      {
        "cardId": "OGN-214",
        "quantity": 6
      }
    ],
    "battlefields": [
      {
        "cardId": "OGN-282",
        "quantity": 1
      },
      {
        "cardId": "SFD-216",
        "quantity": 1
      },
      {
        "cardId": "OGN-293",
        "quantity": 1
      }
    ],
    "sideboard": [],
    "reviewedAt": "2026-11-11",
    "notes": "A complete legal RiftLite teaching list built to support these keyword examples. It is not a published or recommended competitive list. Prepared positions show only the cards relevant to the lesson; ordinary card and battlefield rules still apply."
  },
  {
    "id": "teaching-viktor",
    "title": "Viktor — keyword teaching deck",
    "kind": "teaching",
    "legendId": "OGN-265",
    "championId": "OGN-117",
    "domains": [
      "Mind",
      "Order"
    ],
    "main": [
      {
        "cardId": "OGN-117",
        "quantity": 1
      },
      {
        "cardId": "OGN-215",
        "quantity": 3
      },
      {
        "cardId": "OGN-096",
        "quantity": 3
      },
      {
        "cardId": "OGN-213",
        "quantity": 3
      },
      {
        "cardId": "VEN-049",
        "quantity": 3
      },
      {
        "cardId": "RAD-050",
        "quantity": 3
      },
      {
        "cardId": "UNL-078",
        "quantity": 3
      },
      {
        "cardId": "OGN-120",
        "quantity": 3
      },
      {
        "cardId": "OGN-245",
        "quantity": 3
      },
      {
        "cardId": "SFD-080",
        "quantity": 3
      },
      {
        "cardId": "RAD-116",
        "quantity": 3
      },
      {
        "cardId": "VEN-061",
        "quantity": 3
      },
      {
        "cardId": "OGN-095",
        "quantity": 3
      },
      {
        "cardId": "UNL-153",
        "quantity": 3
      }
    ],
    "runes": [
      {
        "cardId": "OGN-089",
        "quantity": 6
      },
      {
        "cardId": "OGN-214",
        "quantity": 6
      }
    ],
    "battlefields": [
      {
        "cardId": "OGN-282",
        "quantity": 1
      },
      {
        "cardId": "SFD-216",
        "quantity": 1
      },
      {
        "cardId": "OGN-293",
        "quantity": 1
      }
    ],
    "sideboard": [],
    "reviewedAt": "2026-11-11",
    "notes": "A complete legal RiftLite teaching list built to support these keyword examples. It is not a published or recommended competitive list. Prepared positions show only the cards relevant to the lesson; ordinary card and battlefield rules still apply.",
    "tokenSources": {
      "UNL-T07": [
        "UNL-078"
      ]
    }
  }
];
export const NEW_PLAYER_TEACHING_CARD_FACTS: Readonly<Record<string, NewPlayerTeachingCardFacts>> = {
  "SFD-073": {"name": "Experimental Hexplate", "type": "Gear", "domains": ["Mind"], "tags": ["Equipment"], "maxCopies": 3},
  "OGN-063": {"name": "Spirit's Refuge", "type": "Gear", "domains": ["Calm"], "tags": [], "maxCopies": 3},
  // First-game additions: registry identity and current Riot artwork checked 13 November 2026.
  "OGN-050": { name: "Rune Prison", type: "Spell", domains: ["Calm"], tags: [], maxCopies: 3 },
  "OGN-065": { name: "Wizened Elder", type: "Unit", domains: ["Calm"], tags: ["Ionia"], maxCopies: 3 },
  "OGN-255": { name: "Ahri, Nine-Tailed Fox", type: "Legend", domains: ["Calm", "Mind"], supertype: "Champion", tags: ["Ahri"], maxCopies: 3 },
  "OGN-119": { name: "Ahri, Inquisitive", type: "Unit", domains: ["Mind"], supertype: "Champion", tags: ["Ahri", "Ionia"], maxCopies: 3 },
  "RAD-145": { name: "Orianna, Lady of Clockwork", type: "Legend", domains: ["Calm", "Mind"], tags: ["Orianna"], maxCopies: 3 },
  "RAD-068": { name: "Orianna, Mechanical Marvel", type: "Unit", domains: ["Mind"], supertype: "Champion", tags: ["Orianna", "Piltover"], maxCopies: 3 },
  "OGN-004": {
    "name": "Cleave",
    "type": "Spell",
    "domains": [
      "Fury"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-007": {
    "name": "Fury Rune",
    "type": "Rune",
    "domains": [
      "Fury"
    ],
    "supertype": "Basic",
    "tags": [],
    "maxCopies": 3
  },
  "OGN-009": {
    "name": "Hextech Ray",
    "type": "Spell",
    "domains": [
      "Fury"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-010": {
    "name": "Legion Rearguard",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "tags": [
      "Trifarian",
      "Noxus"
    ],
    "maxCopies": 3
  },
  "OGN-012": {
    "name": "Noxus Hopeful",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "tags": [
      "Trifarian",
      "Noxus"
    ],
    "maxCopies": 3
  },
  "OGN-013": {
    "name": "Pouty Poro",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "tags": [
      "Poro"
    ],
    "maxCopies": 3
  },
  "OGN-026": {
    "name": "Brynhir Thundersong",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "tags": [
      "Freljord"
    ],
    "maxCopies": 3
  },
  "OGN-027": {
    "name": "Darius, Trifarian",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "supertype": "Champion",
    "tags": [
      "Trifarian",
      "Darius",
      "Noxus"
    ],
    "maxCopies": 3
  },
  "OGN-029": {
    "name": "Falling Star",
    "type": "Spell",
    "domains": [
      "Fury"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-036": {
    "name": "Vi, Destructive",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "supertype": "Champion",
    "tags": [
      "Vi",
      "Piltover"
    ],
    "maxCopies": 3
  },
  "OGN-039": {
    "name": "Kai'Sa, Survivor",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "supertype": "Champion",
    "tags": [
      "Kai'Sa",
      "The Void"
    ],
    "maxCopies": 3
  },
  "OGN-040": {
    "name": "Seal of Rage",
    "type": "Gear",
    "domains": [
      "Fury"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-042": {
    "name": "Calm Rune",
    "type": "Rune",
    "domains": [
      "Calm"
    ],
    "supertype": "Basic",
    "tags": [],
    "maxCopies": 3
  },
  "OGN-042A": {
    "name": "Calm Rune",
    "type": "Rune",
    "domains": [
      "Calm"
    ],
    "supertype": "Basic",
    "tags": [],
    "maxCopies": 3
  },
  "OGN-043": {
    "name": "Charm",
    "type": "Spell",
    "domains": [
      "Calm"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-044": {
    "name": "Clockwork Keeper",
    "type": "Unit",
    "domains": [
      "Calm"
    ],
    "tags": [
      "Shurima"
    ],
    "maxCopies": 3
  },
  "OGN-045": {
    "name": "Defy",
    "type": "Spell",
    "domains": [
      "Calm"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-052": {
    "name": "Stalwart Poro",
    "type": "Unit",
    "domains": [
      "Calm"
    ],
    "tags": [
      "Poro"
    ],
    "maxCopies": 3
  },
  "OGN-054": {
    "name": "Sunlit Guardian",
    "type": "Unit",
    "domains": [
      "Calm"
    ],
    "tags": [
      "Shurima"
    ],
    "maxCopies": 3
  },
  "OGN-057": {
    "name": "Block",
    "type": "Spell",
    "domains": [
      "Calm"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-058": {
    "name": "Discipline",
    "type": "Spell",
    "domains": [
      "Calm"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-064": {
    "name": "Wind Wall",
    "type": "Spell",
    "domains": [
      "Calm"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-080": {
    "name": "Mystic Reversal",
    "type": "Spell",
    "domains": [
      "Calm"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-081": {
    "name": "Seal of Focus",
    "type": "Gear",
    "domains": [
      "Calm"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-083": {
    "name": "Consult the Past",
    "type": "Spell",
    "domains": [
      "Mind"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-087": {
    "name": "Lecturing Yordle",
    "type": "Unit",
    "domains": [
      "Mind"
    ],
    "tags": [
      "Yordle",
      "Bandle City"
    ],
    "maxCopies": 3
  },
  "OGN-089": {
    "name": "Mind Rune",
    "type": "Rune",
    "domains": [
      "Mind"
    ],
    "supertype": "Basic",
    "tags": [],
    "maxCopies": 3
  },
  "OGN-089A": {
    "name": "Mind Rune",
    "type": "Rune",
    "domains": [
      "Mind"
    ],
    "supertype": "Basic",
    "tags": [],
    "maxCopies": 3
  },
  "OGN-093": {
    "name": "Smoke Screen",
    "type": "Spell",
    "domains": [
      "Mind"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-095": {
    "name": "Stupefy",
    "type": "Spell",
    "domains": [
      "Mind"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-096": {
    "name": "Watchful Sentry",
    "type": "Unit",
    "domains": [
      "Mind"
    ],
    "tags": [
      "Freljord"
    ],
    "maxCopies": 3
  },
  "OGN-114": {
    "name": "Progress Day",
    "type": "Spell",
    "domains": [
      "Mind"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-116": {
    "name": "Thousand-Tailed Watcher",
    "type": "Unit",
    "domains": [
      "Mind"
    ],
    "tags": [
      "Ionia"
    ],
    "maxCopies": 3
  },
  "OGN-117": {
    "name": "Viktor, Innovator",
    "type": "Unit",
    "domains": [
      "Mind"
    ],
    "supertype": "Champion",
    "tags": [
      "Viktor",
      "Zaun"
    ],
    "maxCopies": 3
  },
  "OGN-120": {
    "name": "Seal of Insight",
    "type": "Gear",
    "domains": [
      "Mind"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-122": {
    "name": "Time Warp",
    "type": "Spell",
    "domains": [
      "Mind"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-126": {
    "name": "Body Rune",
    "type": "Rune",
    "domains": [
      "Body"
    ],
    "supertype": "Basic",
    "tags": [],
    "maxCopies": 3
  },
  "OGN-132": {
    "name": "First Mate",
    "type": "Unit",
    "domains": [
      "Body"
    ],
    "tags": [
      "Pirate",
      "Bilgewater"
    ],
    "maxCopies": 3
  },
  "OGN-136": {
    "name": "Pit Rookie",
    "type": "Unit",
    "domains": [
      "Body"
    ],
    "tags": [
      "Bilgewater"
    ],
    "maxCopies": 3
  },
  "OGN-145": {
    "name": "Unyielding Spirit",
    "type": "Spell",
    "domains": [
      "Body"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-155": {
    "name": "Qiyana, Victorious",
    "type": "Unit",
    "domains": [
      "Body"
    ],
    "supertype": "Champion",
    "tags": [
      "Qiyana",
      "Ixtal"
    ],
    "maxCopies": 3
  },
  "OGN-156": {
    "name": "Sabotage",
    "type": "Spell",
    "domains": [
      "Body"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-166": {
    "name": "Chaos Rune",
    "type": "Rune",
    "domains": [
      "Chaos"
    ],
    "supertype": "Basic",
    "tags": [],
    "maxCopies": 3
  },
  "OGN-169": {
    "name": "Gust",
    "type": "Spell",
    "domains": [
      "Chaos"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-171": {
    "name": "Mystic Poro",
    "type": "Unit",
    "domains": [
      "Chaos"
    ],
    "tags": [
      "Poro"
    ],
    "maxCopies": 3
  },
  "OGN-172": {
    "name": "Rebuke",
    "type": "Spell",
    "domains": [
      "Chaos"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-173": {
    "name": "Ride The Wind",
    "type": "Spell",
    "domains": [
      "Chaos"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-185": {
    "name": "Traveling Merchant",
    "type": "Unit",
    "domains": [
      "Chaos"
    ],
    "tags": [
      "Bilgewater"
    ],
    "maxCopies": 3
  },
  "OGN-194": {
    "name": "Nocturne, Horrifying",
    "type": "Unit",
    "domains": [
      "Chaos"
    ],
    "supertype": "Champion",
    "tags": [
      "Nocturne"
    ],
    "maxCopies": 3
  },
  "OGN-195": {
    "name": "Rhasa the Sunderer",
    "type": "Unit",
    "domains": [
      "Chaos"
    ],
    "tags": [
      "Spirit",
      "Shadow Isles"
    ],
    "maxCopies": 3
  },
  "OGN-197": {
    "name": "Teemo, Scout",
    "type": "Unit",
    "domains": [
      "Chaos"
    ],
    "supertype": "Champion",
    "tags": [
      "Yordle",
      "Teemo",
      "Bandle City"
    ],
    "maxCopies": 3
  },
  "OGN-204": {
    "name": "Seal of Discord",
    "type": "Gear",
    "domains": [
      "Chaos"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-207": {
    "name": "Call to Glory",
    "type": "Spell",
    "domains": [
      "Order"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-209": {
    "name": "Cull the Weak",
    "type": "Spell",
    "domains": [
      "Order"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-211": {
    "name": "Faithful Manufactor",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "tags": [
      "Piltover"
    ],
    "maxCopies": 3
  },
  "OGN-213": {
    "name": "Hidden Blade",
    "type": "Spell",
    "domains": [
      "Order"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-214": {
    "name": "Order Rune",
    "type": "Rune",
    "domains": [
      "Order"
    ],
    "supertype": "Basic",
    "tags": [],
    "maxCopies": 3
  },
  "OGN-215": {
    "name": "Petty Officer",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "tags": [
      "Pirate",
      "Bilgewater"
    ],
    "maxCopies": 3
  },
  "OGN-216": {
    "name": "Soaring Scout",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "tags": [
      "Bird",
      "Freljord"
    ],
    "maxCopies": 3
  },
  "OGN-218": {
    "name": "Vanguard Captain",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "tags": [
      "Elite",
      "Demacia"
    ],
    "maxCopies": 3
  },
  "OGN-222": {
    "name": "Noxian Drummer",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "tags": [
      "Trifarian",
      "Noxus"
    ],
    "maxCopies": 3
  },
  "OGN-224": {
    "name": "Salvage",
    "type": "Spell",
    "domains": [
      "Order"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-233": {
    "name": "Grand Strategem",
    "type": "Spell",
    "domains": [
      "Order"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-241": {
    "name": "Shen, Kinkou",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "supertype": "Champion",
    "tags": [
      "Shen",
      "Ionia"
    ],
    "maxCopies": 3
  },
  "OGN-245": {
    "name": "Seal of Unity",
    "type": "Gear",
    "domains": [
      "Order"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-246": {
    "name": "Viktor, Leader",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "supertype": "Champion",
    "tags": [
      "Viktor",
      "Zaun"
    ],
    "maxCopies": 3
  },
  "OGN-246A": {
    "name": "Viktor, Leader",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "supertype": "Champion",
    "tags": [
      "Viktor",
      "Zaun"
    ],
    "maxCopies": 3
  },
  "OGN-247": {
    "name": "Kai'Sa, Daughter of the Void",
    "type": "Legend",
    "domains": [
      "Fury",
      "Mind"
    ],
    "supertype": "Champion",
    "tags": [
      "Kai'Sa"
    ],
    "maxCopies": 3
  },
  "OGN-248": {
    "name": "Icathian Rain",
    "type": "Spell",
    "domains": [
      "Fury",
      "Mind"
    ],
    "supertype": "Signature",
    "tags": [
      "Kai'Sa"
    ],
    "maxCopies": 3
  },
  "OGN-253": {
    "name": "Darius, Hand of Noxus",
    "type": "Legend",
    "domains": [
      "Fury",
      "Order"
    ],
    "tags": [
      "Darius"
    ],
    "maxCopies": 3
  },
  "OGN-263": {
    "name": "Teemo, Swift Scout",
    "type": "Legend",
    "domains": [
      "Chaos",
      "Mind"
    ],
    "tags": [
      "Teemo"
    ],
    "maxCopies": 3
  },
  "OGN-265": {
    "name": "Viktor, Herald of the Arcane",
    "type": "Legend",
    "domains": [
      "Mind",
      "Order"
    ],
    "tags": [
      "Viktor"
    ],
    "maxCopies": 3
  },
  "OGN-266": {
    "name": "Siphon Power",
    "type": "Spell",
    "domains": [
      "Order",
      "Mind"
    ],
    "supertype": "Signature",
    "tags": [
      "Viktor"
    ],
    "maxCopies": 3
  },
  "OGN-275": {
    "name": "Altar to Unity",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-279": {
    "name": "Fortified Position",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-282": {
    "name": "Monastery of Hirana",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-291": {
    "name": "The Candlelit Sanctum",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-293": {
    "name": "The Grand Plaza",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-294": {
    "name": "Trifarian War Camp",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-296": {
    "name": "Void Gate",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-297": {
    "name": "Windswept Hillock",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "OGN-298": {
    "name": "Zaun Warrens",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "OGS-011": {
    "name": "Flash",
    "type": "Spell",
    "domains": [
      "Chaos"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "RAD-002": {
    "name": "Banner of Conquest",
    "type": "Gear",
    "domains": [
      "Fury"
    ],
    "tags": [
      "Device"
    ],
    "maxCopies": 3
  },
  "RAD-003": {
    "name": "Bilgewater Tracker",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "tags": [
      "Bilgewater"
    ],
    "maxCopies": 3
  },
  "RAD-012": {
    "name": "Runeblade Anvil",
    "type": "Gear",
    "domains": [
      "Fury"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "RAD-020": {
    "name": "Mordekaiser, Twice Slain",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "supertype": "Champion",
    "tags": [
      "Mordekaiser",
      "Noxus",
      "Spirit"
    ],
    "maxCopies": 3
  },
  "RAD-031": {
    "name": "Stoic Ferryman",
    "type": "Unit",
    "domains": [
      "Calm"
    ],
    "tags": [
      "Bilgewater",
      "Sentinel"
    ],
    "maxCopies": 3
  },
  "RAD-041": {
    "name": "Hush",
    "type": "Spell",
    "domains": [
      "Calm"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "RAD-045A": {
    "name": "K'Sante, Dauntless",
    "type": "Unit",
    "domains": [
      "Calm"
    ],
    "supertype": "Champion",
    "tags": [
      "K'Sante",
      "Shurima"
    ],
    "maxCopies": 3
  },
  "RAD-050": {
    "name": "Mysterious Chronomancer",
    "type": "Unit",
    "domains": [
      "Mind"
    ],
    "tags": [
      "Shurima"
    ],
    "maxCopies": 3
  },
  "RAD-060": {
    "name": "The Empyrean",
    "type": "Unit",
    "domains": [
      "Mind"
    ],
    "tags": [
      "Ionia",
      "Dragon"
    ],
    "maxCopies": 3
  },
  "RAD-071": {
    "name": "Nazuman Ntofo",
    "type": "Gear",
    "domains": [
      "Body"
    ],
    "tags": [
      "Equipment"
    ],
    "maxCopies": 3
  },
  "RAD-073": {
    "name": "Pillaged Armory",
    "type": "Gear",
    "domains": [
      "Body"
    ],
    "tags": [
      "Device"
    ],
    "maxCopies": 3
  },
  "RAD-075": {
    "name": "Skystrike Squadron",
    "type": "Unit",
    "domains": [
      "Body"
    ],
    "tags": [
      "Demacia",
      "Elite",
      "Bird"
    ],
    "maxCopies": 3
  },
  "RAD-082": {
    "name": "Primordial Roar",
    "type": "Spell",
    "domains": [
      "Body"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "RAD-085": {
    "name": "Graves, Blasting Through",
    "type": "Unit",
    "domains": [
      "Body"
    ],
    "supertype": "Champion",
    "tags": [
      "Graves",
      "Bilgewater"
    ],
    "maxCopies": 3
  },
  "RAD-087": {
    "name": "Portable Portal",
    "type": "Gear",
    "domains": [
      "Body"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "RAD-091": {
    "name": "Jarvan IV, Martial Paragon",
    "type": "Unit",
    "domains": [
      "Body"
    ],
    "supertype": "Champion",
    "tags": [
      "Jarvan IV",
      "Demacia"
    ],
    "maxCopies": 3
  },
  "RAD-101": {
    "name": "An Offer You Can't Refuse",
    "type": "Spell",
    "domains": [
      "Chaos"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "RAD-107": {
    "name": "Bedeviling Stranger",
    "type": "Unit",
    "domains": [
      "Chaos"
    ],
    "tags": [
      "Shadow Isles",
      "Demon"
    ],
    "maxCopies": 3
  },
  "RAD-116": {
    "name": "Concert Poster",
    "type": "Gear",
    "domains": [
      "Order"
    ],
    "tags": [
      "Device"
    ],
    "maxCopies": 3
  },
  "RAD-123": {
    "name": "Protector's Shield",
    "type": "Gear",
    "domains": [
      "Order"
    ],
    "tags": [
      "Equipment"
    ],
    "maxCopies": 3
  },
  "RAD-129": {
    "name": "Trifarian Captain",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "tags": [
      "Noxus",
      "Trifarian"
    ],
    "maxCopies": 3
  },
  "RAD-136": {
    "name": "Dockside Lock-Up",
    "type": "Gear",
    "domains": [
      "Order"
    ],
    "tags": [
      "Device"
    ],
    "maxCopies": 3
  },
  "RAD-137": {
    "name": "Mordekaiser, Dominating",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "supertype": "Champion",
    "tags": [
      "Mordekaiser",
      "Noxus",
      "Spirit"
    ],
    "maxCopies": 3
  },
  "RAD-143": {
    "name": "Mordekaiser, Iron Revenant",
    "type": "Legend",
    "domains": [
      "Fury",
      "Order"
    ],
    "tags": [
      "Mordekaiser"
    ],
    "maxCopies": 3
  },
  "RAD-144": {
    "name": "Realm of Death",
    "type": "Spell",
    "domains": [
      "Fury",
      "Order"
    ],
    "supertype": "Signature",
    "tags": [
      "Mordekaiser"
    ],
    "maxCopies": 3
  },
  "RAD-148": {
    "name": "Ntofo Strikes",
    "type": "Spell",
    "domains": [
      "Body",
      "Calm"
    ],
    "supertype": "Signature",
    "tags": [
      "K'Sante"
    ],
    "maxCopies": 3
  },
  "RAD-156": {
    "name": "Demacian Standard",
    "type": "Gear",
    "domains": [
      "Body",
      "Order"
    ],
    "supertype": "Signature",
    "tags": [
      "Jarvan IV"
    ],
    "maxCopies": 3
  },
  "RAD-159": {
    "name": "Black Rose Sanctum",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "RAD-163": {
    "name": "Hunters' Circle",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "RAD-172": {
    "name": "K'Sante, Pride of Nazumah",
    "type": "Legend",
    "domains": [
      "Body",
      "Calm"
    ],
    "tags": [
      "K'Sante"
    ],
    "maxCopies": 3
  },
  "RAD-176": {
    "name": "Jarvan IV, Exemplar of Demacia",
    "type": "Legend",
    "domains": [
      "Body",
      "Order"
    ],
    "tags": [
      "Jarvan IV"
    ],
    "maxCopies": 3
  },
  "SFD-002": {
    "name": "Armed Assailant",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "tags": [
      "Noxus"
    ],
    "maxCopies": 3
  },
  "SFD-003": {
    "name": "Blood Rush",
    "type": "Spell",
    "domains": [
      "Fury"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-005": {
    "name": "Detonate",
    "type": "Spell",
    "domains": [
      "Fury"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-014": {
    "name": "Minotaur Reckoner",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "tags": [
      "Noxus"
    ],
    "maxCopies": 3
  },
  "SFD-021": {
    "name": "Ferrous Forerunner",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "tags": [
      "Mech",
      "Yordle",
      "Bandle City"
    ],
    "maxCopies": 3
  },
  "SFD-022": {
    "name": "Long Sword",
    "type": "Gear",
    "domains": [
      "Fury"
    ],
    "tags": [
      "Equipment"
    ],
    "maxCopies": 3
  },
  "SFD-032": {
    "name": "Disarming Rake",
    "type": "Unit",
    "domains": [
      "Calm"
    ],
    "tags": [
      "Demacia"
    ],
    "maxCopies": 3
  },
  "SFD-043": {
    "name": "Emperor's Divide",
    "type": "Spell",
    "domains": [
      "Calm"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-045": {
    "name": "Not So Fast",
    "type": "Spell",
    "domains": [
      "Calm"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-046": {
    "name": "Poro Snax",
    "type": "Gear",
    "domains": [
      "Calm"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-056": {
    "name": "Sterak's Gage",
    "type": "Gear",
    "domains": [
      "Calm"
    ],
    "tags": [
      "Equipment"
    ],
    "maxCopies": 3
  },
  "SFD-058": {
    "name": "Ornn, Blacksmith",
    "type": "Unit",
    "domains": [
      "Calm"
    ],
    "supertype": "Champion",
    "tags": [
      "Ornn",
      "Freljord"
    ],
    "maxCopies": 3
  },
  "SFD-069": {
    "name": "Plundering Poro",
    "type": "Unit",
    "domains": [
      "Mind"
    ],
    "tags": [
      "Poro",
      "Pirate",
      "Bilgewater"
    ],
    "maxCopies": 3
  },
  "SFD-072": {
    "name": "Dropboarder",
    "type": "Unit",
    "domains": [
      "Mind"
    ],
    "tags": [
      "Zaun"
    ],
    "maxCopies": 3
  },
  "SFD-074": {
    "name": "Pickpocket",
    "type": "Unit",
    "domains": [
      "Mind"
    ],
    "tags": [
      "Zaun"
    ],
    "maxCopies": 3
  },
  "SFD-080": {
    "name": "Bellows Breath",
    "type": "Spell",
    "domains": [
      "Mind"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-083": {
    "name": "Hextech Anomaly",
    "type": "Gear",
    "domains": [
      "Mind"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-085": {
    "name": "Ornn, Forge God",
    "type": "Unit",
    "domains": [
      "Mind"
    ],
    "supertype": "Champion",
    "tags": [
      "Ornn",
      "Freljord"
    ],
    "maxCopies": 3
  },
  "SFD-097": {
    "name": "Punch First",
    "type": "Spell",
    "domains": [
      "Body"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-105": {
    "name": "Ruin Runner",
    "type": "Unit",
    "domains": [
      "Body"
    ],
    "tags": [
      "Shurima"
    ],
    "maxCopies": 3
  },
  "SFD-109": {
    "name": "Akshan, Mischievous",
    "type": "Unit",
    "domains": [
      "Body"
    ],
    "supertype": "Champion",
    "tags": [
      "Akshan",
      "Shurima",
      "Sentinel"
    ],
    "maxCopies": 3
  },
  "SFD-136": {
    "name": "Hard Bargain",
    "type": "Spell",
    "domains": [
      "Chaos"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-140": {
    "name": "Fizz, Trickster",
    "type": "Unit",
    "domains": [
      "Chaos"
    ],
    "supertype": "Champion",
    "tags": [
      "Yordle",
      "Fizz",
      "Bilgewater"
    ],
    "maxCopies": 3
  },
  "SFD-145": {
    "name": "Switcheroo",
    "type": "Spell",
    "domains": [
      "Chaos"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-150": {
    "name": "Last Rites",
    "type": "Gear",
    "domains": [
      "Chaos"
    ],
    "tags": [
      "Equipment"
    ],
    "maxCopies": 3
  },
  "SFD-155": {
    "name": "Honest Broker",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "tags": [
      "Ionia"
    ],
    "maxCopies": 3
  },
  "SFD-160": {
    "name": "Zaun Punk",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "tags": [
      "Zaun"
    ],
    "maxCopies": 3
  },
  "SFD-163": {
    "name": "Deathgrip",
    "type": "Spell",
    "domains": [
      "Order"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-179": {
    "name": "Corina Veraza",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "tags": [
      "Zaun"
    ],
    "maxCopies": 3
  },
  "SFD-189": {
    "name": "Ornn, Fire Below the Mountain",
    "type": "Legend",
    "domains": [
      "Calm",
      "Mind"
    ],
    "tags": [
      "Ornn"
    ],
    "maxCopies": 3
  },
  "SFD-190": {
    "name": "Forgefire Cape",
    "type": "Gear",
    "domains": [
      "Calm",
      "Mind"
    ],
    "supertype": "Signature",
    "tags": [
      "Ornn",
      "Equipment"
    ],
    "maxCopies": 1
  },
  "SFD-191": {
    "name": "Rabadon's Deathcrown",
    "type": "Gear",
    "domains": [
      "Calm",
      "Mind"
    ],
    "supertype": "Signature",
    "tags": [
      "Ornn",
      "Equipment"
    ],
    "maxCopies": 1
  },
  "SFD-192": {
    "name": "Shurelya's Requiem",
    "type": "Gear",
    "domains": [
      "Calm",
      "Mind"
    ],
    "supertype": "Signature",
    "tags": [
      "Ornn",
      "Equipment"
    ],
    "maxCopies": 1
  },
  "SFD-212": {
    "name": "Minefield",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-213": {
    "name": "Ornn's Forge",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-216": {
    "name": "Rockfall Path",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-218": {
    "name": "Sunken Temple",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "SFD-219": {
    "name": "The Papertree",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "UNL-002": {
    "name": "Inferna",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "tags": [
      "Bilgewater"
    ],
    "maxCopies": 3
  },
  "UNL-016": {
    "name": "Scorchclaw",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "tags": [
      "Dog",
      "Noxus"
    ],
    "maxCopies": 3
  },
  "UNL-022": {
    "name": "Jhin, Murderous Artist",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "supertype": "Champion",
    "tags": [
      "Jhin",
      "Ionia"
    ],
    "maxCopies": 3
  },
  "UNL-036": {
    "name": "Mutated Mouser",
    "type": "Unit",
    "domains": [
      "Calm"
    ],
    "tags": [
      "Cat",
      "Bilgewater"
    ],
    "maxCopies": 3
  },
  "UNL-043": {
    "name": "Enthusiastic Promoter",
    "type": "Unit",
    "domains": [
      "Calm"
    ],
    "tags": [
      "Yordle",
      "Bandle City"
    ],
    "maxCopies": 3
  },
  "UNL-053": {
    "name": "Scuttle Crab",
    "type": "Unit",
    "domains": [
      "Calm"
    ],
    "tags": [
      "Bilgewater"
    ],
    "maxCopies": 3
  },
  "UNL-078": {
    "name": "Sprite Fountain",
    "type": "Gear",
    "domains": [
      "Mind"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "UNL-097": {
    "name": "Kinkou Initiate",
    "type": "Unit",
    "domains": [
      "Body"
    ],
    "tags": [
      "Ionia"
    ],
    "maxCopies": 3
  },
  "UNL-106": {
    "name": "Repulse",
    "type": "Spell",
    "domains": [
      "Body"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "UNL-120": {
    "name": "Rengar, Trophy Hunter",
    "type": "Unit",
    "domains": [
      "Body"
    ],
    "supertype": "Champion",
    "tags": [
      "Cat",
      "Rengar",
      "Ixtal"
    ],
    "maxCopies": 3
  },
  "UNL-120A": {
    "name": "Rengar, Trophy Hunter",
    "type": "Unit",
    "domains": [
      "Body"
    ],
    "supertype": "Champion",
    "tags": [
      "Cat",
      "Rengar",
      "Ixtal"
    ],
    "maxCopies": 3
  },
  "UNL-128": {
    "name": "Star-Crossed",
    "type": "Spell",
    "domains": [
      "Chaos"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "UNL-131": {
    "name": "Abandon",
    "type": "Spell",
    "domains": [
      "Chaos"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "UNL-134": {
    "name": "Existential Dread",
    "type": "Spell",
    "domains": [
      "Chaos"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "UNL-153": {
    "name": "Carrion Dredger",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "tags": [
      "Mech",
      "Zaun"
    ],
    "maxCopies": 3
  },
  "UNL-176": {
    "name": "Vi, Peacekeeper",
    "type": "Unit",
    "domains": [
      "Order"
    ],
    "supertype": "Champion",
    "tags": [
      "Vi",
      "Piltover"
    ],
    "maxCopies": 3
  },
  "UNL-212": {
    "name": "Frozen Fortress",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-001": {
    "name": "Baccai Sandspinner",
    "type": "Unit",
    "domains": [
      "Fury"
    ],
    "tags": [
      "Shurima"
    ],
    "maxCopies": 3
  },
  "VEN-003": {
    "name": "Brittle Steel",
    "type": "Spell",
    "domains": [
      "Fury"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-015": {
    "name": "Decree of Rage",
    "type": "Spell",
    "domains": [
      "Fury"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-040": {
    "name": "Decree of Focus",
    "type": "Spell",
    "domains": [
      "Calm"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-049": {
    "name": "Dredge Up",
    "type": "Spell",
    "domains": [
      "Mind"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-061": {
    "name": "Decree of Insight",
    "type": "Spell",
    "domains": [
      "Mind"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-066": {
    "name": "Temporal Breach",
    "type": "Spell",
    "domains": [
      "Mind"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-067": {
    "name": "Bottled Constellation",
    "type": "Gear",
    "domains": [
      "Mind"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-081": {
    "name": "Onslaught",
    "type": "Spell",
    "domains": [
      "Body"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-083": {
    "name": "Rampage",
    "type": "Spell",
    "domains": [
      "Body"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-084A": {
    "name": "Ambessa, The Wolf",
    "type": "Unit",
    "domains": [
      "Body"
    ],
    "supertype": "Champion",
    "tags": [
      "Ambessa"
    ],
    "maxCopies": 3
  },
  "VEN-085": {
    "name": "Decree of Strength",
    "type": "Spell",
    "domains": [
      "Body"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-092": {
    "name": "Renekton, Brute",
    "type": "Unit",
    "domains": [
      "Body"
    ],
    "supertype": "Champion",
    "tags": [
      "Shurima",
      "Renekton"
    ],
    "maxCopies": 3
  },
  "VEN-095": {
    "name": "Shadow Order Disciple",
    "type": "Unit",
    "domains": [
      "Chaos"
    ],
    "tags": [
      "Ionia"
    ],
    "maxCopies": 3
  },
  "VEN-100": {
    "name": "Up from the Deep",
    "type": "Spell",
    "domains": [
      "Chaos"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-102": {
    "name": "Ravenbloom Prefect",
    "type": "Unit",
    "domains": [
      "Chaos"
    ],
    "tags": [
      "Noxus"
    ],
    "maxCopies": 3
  },
  "VEN-103": {
    "name": "Shadows of the Past",
    "type": "Spell",
    "domains": [
      "Chaos"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-113A": {
    "name": "Kennen, Storm of Shuriken",
    "type": "Unit",
    "domains": [
      "Chaos"
    ],
    "supertype": "Champion",
    "tags": [
      "Yordle",
      "Ionia",
      "Kennen"
    ],
    "maxCopies": 3
  },
  "VEN-131": {
    "name": "Decree of Unity",
    "type": "Spell",
    "domains": [
      "Order"
    ],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-141": {
    "name": "Renekton, Butcher of the Sands",
    "type": "Legend",
    "domains": [
      "Fury",
      "Body"
    ],
    "tags": [
      "Renekton"
    ],
    "maxCopies": 3
  },
  "VEN-147": {
    "name": "Shen, Eye of Twilight",
    "type": "Legend",
    "domains": [
      "Calm",
      "Order"
    ],
    "tags": [
      "Shen"
    ],
    "maxCopies": 3
  },
  "VEN-155": {
    "name": "Kennen, Heart of the Tempest",
    "type": "Legend",
    "domains": [
      "Order",
      "Chaos"
    ],
    "tags": [
      "Yordle",
      "Kennen"
    ],
    "maxCopies": 3
  },
  "VEN-156": {
    "name": "Lightning Rush",
    "type": "Spell",
    "domains": [
      "Order",
      "Chaos"
    ],
    "supertype": "Signature",
    "tags": [
      "Kennen"
    ],
    "maxCopies": 3
  },
  "VEN-164": {
    "name": "Sandswept Tomb",
    "type": "Battlefield",
    "domains": [],
    "tags": [],
    "maxCopies": 3
  },
  "VEN-R04": {
    "name": "Body Rune",
    "type": "Rune",
    "domains": [
      "Body"
    ],
    "supertype": "Basic",
    "tags": [],
    "maxCopies": 3
  },
  "VEN-R06": {
    "name": "Order Rune",
    "type": "Rune",
    "domains": [
      "Order"
    ],
    "supertype": "Basic",
    "tags": [],
    "maxCopies": 3
  },
  "VEN-SP5": {
    "name": "Ezreal, Prodigy",
    "type": "Unit",
    "domains": [
      "Chaos"
    ],
    "supertype": "Champion",
    "tags": [
      "Ezreal",
      "Piltover"
    ],
    "maxCopies": 3
  }
};
export const DEFAULT_TEACHING_DECK_BY_LEGEND: Readonly<Record<string, string>> = {
  "OGN-247": "teaching-kaisa",
  "OGN-253": "teaching-darius",
  "VEN-141": "teaching-renekton",
  "OGN-263": "teaching-teemo",
  "SFD-189": "teaching-ornn",
  "VEN-147": "teaching-shen",
  "OGN-265": "teaching-viktor"
};
// END VERIFIED DATA

export const FIRST_GAME_TEACHING_DECK_IDS = ["teaching-first-game-ahri", "teaching-first-game-orianna"] as const;

// These are new learning lists, not edits to any published or keyword-practice list above.
// Each includes the chosen champion in its 40-card count; one copy starts in its zone.
const firstGameTeachingDecks: readonly NewPlayerTeachingDeck[] = [
  { id: FIRST_GAME_TEACHING_DECK_IDS[0], name: "Ahri", legendId: "OGN-255", championId: "OGN-119" },
  { id: FIRST_GAME_TEACHING_DECK_IDS[1], name: "Orianna", legendId: "RAD-145", championId: "RAD-068" }
].map<NewPlayerTeachingDeck>(({ id, name, legendId, championId }) => ({
  id, title: `${name} — first-game teaching deck`, kind: "teaching", legendId, championId,
  domains: ["Calm", "Mind"],
  main: [
    { cardId: championId, quantity: 3 },
    { cardId: "OGN-096", quantity: 3 }, // Watchful Sentry
    { cardId: "OGN-058", quantity: 3 }, // Discipline
    { cardId: "OGN-045", quantity: 3 }, // Defy
    { cardId: "OGN-050", quantity: 3 }, // Rune Prison
    { cardId: "OGN-044", quantity: 3 }, // Clockwork Keeper
    { cardId: "SFD-074", quantity: 3 }, // Pickpocket
    { cardId: "OGN-065", quantity: 3 }, // Wizened Elder
    { cardId: "OGN-054", quantity: 3 }, // Sunlit Guardian
    { cardId: "OGN-052", quantity: 3 }, // Stalwart Poro
    { cardId: "SFD-032", quantity: 3 }, // Disarming Rake
    { cardId: "SFD-072", quantity: 3 }, // Dropboarder
    { cardId: "RAD-050", quantity: 2 }, // Mysterious Chronomancer
    { cardId: "OGN-116", quantity: 2 }  // Thousand-Tailed Watcher
  ],
  runes: [{ cardId: "OGN-042", quantity: 6 }, { cardId: "OGN-089", quantity: 6 }],
  battlefields: [{ cardId: "OGN-282", quantity: 1 }, { cardId: "SFD-216", quantity: 1 }, { cardId: "OGN-293", quantity: 1 }],
  sideboard: [], reviewedAt: "2026-11-13",
  notes: "A complete legal RiftLite teaching list for the first-game exercises, not a published or recommended competitive list. Prepared positions use these real cards; they are not recorded games. The resource exercise uses Orianna as the learner so Ahri’s defensive ability does not alter its comparison."
}));

export const PLAY_EFFECTS_TEACHING_DECK_ID = "teaching-play-effects-teemo";
const playEffectsTeemoBase = teachingDecks.find(deck => deck.id === "teaching-teemo")!;
const playEffectsTeachingDeck: NewPlayerTeachingDeck = {
  ...playEffectsTeemoBase,
  id: PLAY_EFFECTS_TEACHING_DECK_ID,
  title: "Teemo — unit-play effects teaching deck",
  main: [
    ...playEffectsTeemoBase.main.map(entry => entry.cardId === "UNL-131" ? { ...entry, quantity: entry.quantity - 1 } : entry),
    { cardId: "UNL-128", quantity: 1 }
  ],
  reviewedAt: "2026-11-14",
  notes: "A complete legal RiftLite teaching list for practising what happens when a unit is played. It is not a published or recommended competitive list. One Abandon is replaced by Star-Crossed; the separate examples reset rather than using extra copies from outside this list."
};

export const FOUNDATION_TEACHING_DECK_IDS=["teaching-buffs-ahri","teaching-champion-viktor"] as const;
const buffBase=firstGameTeachingDecks.find(d=>d.id==="teaching-first-game-ahri")!;
const championBase=teachingDecks.find(d=>d.id==="teaching-viktor")!;
const foundationTeachingDecks:NewPlayerTeachingDeck[]=[
  {...buffBase,id:FOUNDATION_TEACHING_DECK_IDS[0],title:"Ahri — Buff and Equipment teaching deck",main:[...buffBase.main.filter(e=>!["OGN-116","RAD-050"].includes(e.cardId)),{cardId:"OGN-063",quantity:2},{cardId:"SFD-073",quantity:2}],reviewedAt:"2026-11-14",notes:"Complete legal teaching variant, not a published or recommended competitive list. Two Watchers and two Chronomancers are replaced by two Spirit’s Refuge and two Experimental Hexplate; all earlier lists are unchanged."},
  {...championBase,id:FOUNDATION_TEACHING_DECK_IDS[1],title:"Viktor — champion destinations teaching deck",main:championBase.main.map(e=>e.cardId==="OGN-117"?{...e,quantity:3}:e.cardId==="OGN-120"?{...e,quantity:1}:e),reviewedAt:"2026-11-14",notes:"Complete legal teaching variant with three Innovators, including its chosen champion. Two replacement main-deck slots come from two copies of the existing OGN-120 entry. It is not a published or recommended competitive list."}
];

export const NEW_PLAYER_TEACHING_DECKS: Readonly<Record<string, NewPlayerTeachingDeck>> =
  Object.fromEntries([...publishedDecks, ...extraPublishedDecks, ...teachingDecks, ...firstGameTeachingDecks, playEffectsTeachingDeck, ...foundationTeachingDecks].map(deck => [deck.id, deck]));

export function getNewPlayerTeachingDeck(id: string | null | undefined): NewPlayerTeachingDeck | undefined {
  return id ? NEW_PLAYER_TEACHING_DECKS[id] : undefined;
}

/** Dated Constructed checks for the complete lists, not just the visible practice cards. */
export function validateNewPlayerTeachingDeck(deck: NewPlayerTeachingDeck): string[] {
  const issues: string[] = [];
  const normal = (value: string) => value.normalize("NFKC").replace(/[’‘]/g, "'").toLowerCase();
  const banned = new Set(["Called Shot", "Ekko, Recurrent", "Draven, Vanquisher", "Fight or Flight", "Scrapheap", "Stealthy Pursuer", "Stacked Deck", "The Arena's Greatest", "Aspirant's Climb", "Dreaming Tree", "The Dreaming Tree", "Obelisk of Power", "Reaver's Row"].map(normal));
  const total = (items: readonly NewPlayerTeachingDeckEntry[]) => items.reduce((sum, item) => sum + item.quantity, 0);
  const legend = NEW_PLAYER_TEACHING_CARD_FACTS[deck.legendId];
  const chosen = NEW_PLAYER_TEACHING_CARD_FACTS[deck.championId];
  if (!legend || legend.type !== "Legend") issues.push("Missing valid legend.");
  if (legend && (legend.domains.length !== deck.domains.length || legend.domains.some(domain => !deck.domains.includes(domain)))) issues.push("Deck domains differ from the legend.");
  if (!chosen || chosen.type !== "Unit" || chosen.supertype !== "Champion" || !chosen.tags?.includes(legend?.name.split(",")[0] ?? "")) issues.push("Chosen champion does not match the legend.");
  if (!deck.main.some(card => card.cardId === deck.championId && card.quantity >= 1)) issues.push("Chosen champion is missing from the 40-card Main Deck.");
  if (total(deck.main) !== 40) issues.push("Main Deck must contain 40 cards including the chosen champion.");
  if (total(deck.runes) !== 12) issues.push("Rune Deck must contain 12 runes.");
  if (total(deck.battlefields) !== 3 || new Set(deck.battlefields.map(card => NEW_PLAYER_TEACHING_CARD_FACTS[card.cardId]?.name)).size !== 3) issues.push("Choose three different battlefields.");
  if (total(deck.sideboard) > 10) issues.push("Sideboard exceeds 10 cards.");
  const copies = new Map<string, number>();
  let signatures = 0;
  for (const [section, cards] of Object.entries({ main: deck.main, runes: deck.runes, battlefields: deck.battlefields, sideboard: deck.sideboard })) {
    for (const card of cards) {
      const fact = NEW_PLAYER_TEACHING_CARD_FACTS[card.cardId];
      if (!Number.isInteger(card.quantity) || card.quantity < 1) issues.push(`Invalid quantity: ${card.cardId}.`);
      if (!fact) { issues.push(`Unknown card: ${card.cardId}.`); continue; }
      if (banned.has(normal(fact.name))) issues.push(`Banned card: ${fact.name}.`);
      if (fact.domains.some(domain => !deck.domains.includes(domain))) issues.push(`Out-of-domain card: ${fact.name}.`);
      const expectedTypes = section === "runes" ? ["Rune"] : section === "battlefields" ? ["Battlefield"] : ["Unit", "Spell", "Gear"];
      if (!expectedTypes.includes(fact.type)) issues.push(`Wrong section for ${fact.name}.`);
      if (section === "main" || section === "sideboard") {
        const key = normal(fact.name), count = (copies.get(key) ?? 0) + card.quantity;
        copies.set(key, count);
        if (count > fact.maxCopies) issues.push(`Copy limit exceeded: ${fact.name}.`);
        if (fact.supertype === "Signature") {
          signatures += card.quantity;
          if (!fact.tags?.includes(legend?.name.split(",")[0] ?? "")) issues.push(`Signature does not match the legend: ${fact.name}.`);
        }
      }
    }
  }
  if (signatures > 3) issues.push("More than three Signature cards.");
  for (const sources of Object.values(deck.tokenSources ?? {})) if (!sources.some(id => deck.main.some(card => card.cardId === id))) issues.push("Token generator is missing from the complete deck.");
  if (deck.kind === "published" && (!deck.sourceUrl?.startsWith("https://piltoverarchive.com/decks/view/") || !deck.author)) issues.push("Published list needs its original source and author.");
  if (deck.kind === "teaching" && deck.sourceUrl) issues.push("A teaching list must not claim a published-list source.");
  return issues;
}
