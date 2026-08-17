import { describe, expect, it } from "vitest";

import type { MulliganLabRegistry, MulliganLabRegistryCard } from "../src/shared/mulliganLab.js";
import {
  adjustSideboardLabCardDisplayQuantity,
  adjustSideboardLabPlan,
  adjustSideboardLabSelection,
  parseSideboardLabApiResponse,
  parseSideboardLabTargetPackResponse,
  sideboardLabCardDisplayQuantity,
  sideboardLabChoiceFeedback,
  sideboardLabDeckFingerprint,
  sideboardLabDeckFingerprintFromSnapshot,
  sideboardLabPlanBalance,
  sideboardLabPlanShape,
  rankSideboardLabDailyDrills,
  sideboardLabScenarioUsefulness,
  sideboardLabVisibleChoiceFeedback,
  summarizeSideboardLabPlanFeedback,
  type SideboardLabApiParseResult,
  type SideboardLabCardEvidence,
  type SideboardLabTargetPackParseResult
} from "../src/shared/sideboardLab.js";

const officialImage = (code: string) => `https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/${code.toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(40, "a")}-744x1039.png?accountingTag=RB`;

function card(code: string, name: string, type = "Unit"): MulliganLabRegistryCard {
  return { code, name, type, imageUrl: officialImage(code), costEnergy: 2, costPower: 0 };
}

function registryFixture(): MulliganLabRegistry {
  const cards = [
    card("UNL-191", "Master Yi, Wuju Master", "Legend"),
    card("VEN-145", "Nasus, Curator of the Sands", "Legend"),
    card("SFD-191", "Draven, Glorious Executioner", "Legend"),
    card("OGN-001A", "Main Card 1 Alternate"),
    ...Array.from({ length: 14 }, (_, index) => ({
      ...card(`OGN-${String(index + 1).padStart(3, "0")}`, `Main Card ${index + 1}`),
      ...(index === 13 ? { supertype: "Champion" } : {})
    })),
    ...Array.from({ length: 10 }, (_, index) => card(`OGN-${String(index + 20).padStart(3, "0")}`, `Side Card ${index + 1}`, "Spell"))
  ];
  return { byCode: new Map(cards.map((entry) => [entry.code, entry])) };
}

function mainDeck() {
  return Array.from({ length: 14 }, (_, index) => ({
    cardCode: `OGN-${String(index + 1).padStart(3, "0")}`,
    name: `Main Card ${index + 1}`,
    count: index < 13 ? 3 : 1
  }));
}

function sideboard() {
  return Array.from({ length: 10 }, (_, index) => ({
    cardCode: `OGN-${String(index + 20).padStart(3, "0")}`,
    name: `Side Card ${index + 1}`,
    count: 1
  }));
}

function evidenceFor(cardCode: string, name: string, direction: "in" | "out") {
  const selectedWinRate = 9 / 15;
  const notSelectedWinRate = 6 / 15;
  return {
    cardCode,
    identityCode: cardCode,
    name,
    direction,
    scope: "matchup",
    scopeDecisions: 30,
    scopePlayers: 12,
    opportunities: 30,
    players: 10,
    selected: 15,
    selectedPlayers: 7,
    selectedCopies: 15,
    selectedWins: 9,
    notSelectedWins: 6,
    selectionRate: 15 / 30,
    baselineSelectionRate: 0.5,
    guidancePlayers: 10,
    guidanceSelected: 6,
    guidanceSelectionRate: 6 / 10,
    selectedWinRate,
    notSelectedWinRate,
    winRateDelta: selectedWinRate - notSelectedWinRate,
    guidance: "select",
    evidenceStatus: "robust",
    outcomeStatus: "comparable"
  };
}

function readyResponse() {
  const main = mainDeck();
  const side = sideboard();
  return {
    schema: "riftlite-sideboard-lab",
    version: 1,
    status: "ready",
    generatedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    source: {
      kind: "precomputed-observed-replays",
      corpus: "anonymized-canonical-web-replays",
      minimumDecisions: 25,
      minimumPlayers: 10,
      observedFrom: null,
      observedThrough: null,
      includedFacts: 50,
      coverageTruncated: false,
      coveragePolicy: "all-available-history",
      includedPeriods: ["preseason", "current-season"],
      backfillComplete: true,
      seasonCoverage: {
        currentSeasonStartedOn: "2026-07-31",
        preseasonFacts: 20,
        currentSeasonFacts: 30
      }
    },
    drills: [{
      id: `sl1_${"1".repeat(32)}`,
      matchup: {
        playerLegend: { cardCode: "UNL-191", name: "Master Yi, Wuju Master" },
        opponentLegend: { cardCode: "VEN-145", name: "Nasus, Curator of the Sands" }
      },
      priorGameResult: "loss",
      deck: {
        fingerprint: sideboardLabDeckFingerprint(main, side),
        chosenChampionCode: "OGN-014",
        mainDeck: main,
        sideboard: side
      },
      evidence: {
        status: "sufficient",
        scope: "matchup",
        deckScope: "all-observed-decks",
        guidanceBasis: "community-selection-rate",
        outcomeInterpretation: "descriptive-not-causal",
        playerLegendIdentityCode: "UNL-191",
        opponentLegendIdentityCode: "VEN-145",
        decisions: 30,
        players: 12
      },
      cardEvidence: [
        ...main.map((entry) => evidenceFor(entry.cardCode, entry.name, "out")),
        ...side.map((entry) => evidenceFor(entry.cardCode, entry.name, "in"))
      ]
    }]
  };
}

function unavailableResponse() {
  return {
    schema: "riftlite-sideboard-lab",
    version: 1,
    status: "unavailable",
    generatedAt: null,
    expiresAt: null,
    source: {
      kind: "precomputed-observed-replays",
      corpus: "anonymized-canonical-web-replays",
      minimumDecisions: 25,
      minimumPlayers: 10,
      observedFrom: null,
      observedThrough: null,
      includedFacts: 0,
      coverageTruncated: false,
      coveragePolicy: "all-available-history",
      includedPeriods: [],
      backfillComplete: false,
      seasonCoverage: { currentSeasonStartedOn: "2026-07-31", preseasonFacts: 0, currentSeasonFacts: 0 }
    },
    drills: [],
    reason: "data_unavailable"
  };
}

function targetedResponse() {
  const legacy = readyResponse();
  const fingerprint = legacy.drills[0].deck.fingerprint;
  const slice = {
    opportunities: 20,
    players: 8,
    selected: 10,
    selectedCopies: 10,
    guidancePlayers: 8,
    guidanceSelected: 5,
    guidanceSelectionRate: 5 / 8,
    guidance: "mixed",
    evidenceStatus: "developing"
  };
  return {
    ...legacy,
    schema: "riftlite-sideboard-lab-pack",
    query: {
      requested: {
        playerLegend: "UNL-191",
        opponentLegend: "VEN-145",
        deckFingerprint: fingerprint,
        priorGameResult: "loss"
      },
      resolved: {
        scope: "exact-deck",
        deckFingerprint: fingerprint,
        sharedCards: 40,
        totalCards: 40
      },
      fallbackReason: null
    },
    source: {
      ...legacy.source,
      cardRegistryGeneratedAt: new Date(Date.now() - 120_000).toISOString(),
      cardRegistryPrints: registryFixture().byCode.size,
      formatPolicy: {
        format: "bo3",
        observedRulesEpoch: "unknown",
        currentReference: {
          mainDeckCards: 40,
          sideboardMaximum: 10,
          swaps: "one-for-one",
          championChangesAllowed: true,
          fixedSections: ["legend", "runes", "battlefields"]
        },
        historicalValidation: "structural-only-no-retroactive-rules"
      }
    },
    drills: legacy.drills.map((drill) => ({
      ...drill,
      context: {
        nextInitiative: "unknown",
        format: "bo3",
        provider: "atlas",
        targetGameNumber: 2
      },
      decisionEvidence: {
        decisions: 30,
        players: 12,
        noChangeDecisions: 3,
        noChangePlayers: 3,
        noChangeRate: 3 / 30,
        swapCountHistogram: [
          { copies: 0, decisions: 3, players: 3 },
          { copies: 2, decisions: 27, players: 11 }
        ],
        medianCopiesMoved: 2
      },
      packages: [{
        cardsIn: [{ cardCode: "OGN-020", name: "Side Card 1", count: 1 }],
        cardsOut: [{ cardCode: "OGN-001", name: "Main Card 1", count: 1 }],
        decisions: 10,
        players: 5,
        selectionRate: 10 / 30,
        evidenceStatus: "developing"
      }],
      pairs: [{
        cardIn: { cardCode: "OGN-020", name: "Side Card 1" },
        cardOut: { cardCode: "OGN-001", name: "Main Card 1" },
        decisions: 12,
        players: 6,
        selectionRate: 12 / 30,
        evidenceStatus: "developing"
      }],
      cardEvidence: drill.cardEvidence.map((entry) => ({
        ...entry,
        quantity: {
          histogram: [
            { copies: 0, decisions: 15, players: 8 },
            { copies: 1, decisions: 15, players: 7 }
          ],
          selectedMedianCopies: 1,
          status: "robust"
        },
        periods: {
          preseason: { ...slice },
          currentSeason: null
        }
      }))
    }))
  };
}

function targetedUnavailableResponse() {
  const ready = targetedResponse();
  return {
    schema: "riftlite-sideboard-lab-pack",
    version: 1,
    status: "unavailable",
    generatedAt: null,
    expiresAt: null,
    query: ready.query,
    source: null,
    drills: [],
    reason: "matchup_not_observed"
  };
}

function acceptsBaseParseResult(_result: SideboardLabApiParseResult) {
  // Compile-time assertion: targeted results remain usable by existing UI state.
}

describe("Sideboard Lab decisions", () => {
  it("accepts no swaps and equal swaps, but blocks an unbalanced plan", () => {
    expect(sideboardLabPlanBalance({ in: {}, out: {} })).toMatchObject({ status: "empty", legal: true, cardsIn: 0, cardsOut: 0 });
    expect(sideboardLabPlanBalance({ in: { "OGN-020": 2 }, out: { "OGN-001": 2 } })).toMatchObject({ status: "balanced", legal: true });
    expect(sideboardLabPlanBalance({ in: { "OGN-020": 1 }, out: { "OGN-001": 2 } })).toMatchObject({ status: "needs-in", legal: false, difference: -1 });
  });

  it("clamps selected copies to the exact registered quantity", () => {
    expect(adjustSideboardLabSelection({}, "ogn-020", 1, 2)).toEqual({ "OGN-020": 1 });
    expect(adjustSideboardLabSelection({ "OGN-020": 1 }, "OGN-020", 5, 2)).toEqual({ "OGN-020": 2 });
    expect(adjustSideboardLabSelection({ "OGN-020": 1 }, "OGN-020", -1, 2)).toEqual({});
  });

  it("shows main-deck copies as remaining quantities and subtracts them into the OUT plan", () => {
    let plan = { in: {}, out: {} };
    expect(sideboardLabCardDisplayQuantity("out", 3, plan.out["OGN-001"] ?? 0)).toBe(3);

    plan = adjustSideboardLabCardDisplayQuantity(plan, "out", "OGN-001", -1, 3);
    expect(plan).toEqual({ in: {}, out: { "OGN-001": 1 } });
    expect(sideboardLabCardDisplayQuantity("out", 3, plan.out["OGN-001"] ?? 0)).toBe(2);

    plan = adjustSideboardLabCardDisplayQuantity(plan, "out", "OGN-001", -5, 3);
    expect(plan.out).toEqual({ "OGN-001": 3 });
    expect(sideboardLabCardDisplayQuantity("out", 3, plan.out["OGN-001"])).toBe(0);

    plan = adjustSideboardLabCardDisplayQuantity(plan, "out", "OGN-001", 1, 3);
    expect(plan.out).toEqual({ "OGN-001": 2 });
    expect(sideboardLabCardDisplayQuantity("out", 3, plan.out["OGN-001"])).toBe(1);
  });

  it("shows sideboard copies as planned IN quantities and adds or removes them directly", () => {
    let plan = { in: {}, out: {} };
    expect(sideboardLabCardDisplayQuantity("in", 2, plan.in["OGN-020"] ?? 0)).toBe(0);

    plan = adjustSideboardLabCardDisplayQuantity(plan, "in", "OGN-020", 1, 2);
    expect(plan).toEqual({ in: { "OGN-020": 1 }, out: {} });
    expect(sideboardLabCardDisplayQuantity("in", 2, plan.in["OGN-020"])).toBe(1);

    plan = adjustSideboardLabCardDisplayQuantity(plan, "in", "OGN-020", -1, 2);
    expect(plan).toEqual({ in: {}, out: {} });
    expect(sideboardLabCardDisplayQuantity("in", 2, plan.in["OGN-020"] ?? 0)).toBe(0);
  });

  it("keeps display-oriented changes identity-safe and balance-compatible", () => {
    const identities = new Map([
      ["OGN-001A", "OGN-001"],
      ["OGN-020", "OGN-001"]
    ]);
    let plan = adjustSideboardLabCardDisplayQuantity(
      { in: { "OGN-020": 1 }, out: {} },
      "out",
      "OGN-001A",
      -1,
      2,
      identities
    );
    expect(plan).toEqual({ in: {}, out: { "OGN-001A": 1 } });

    plan = adjustSideboardLabCardDisplayQuantity(plan, "in", "OGN-020", 1, 2, identities);
    expect(plan).toEqual({ in: { "OGN-020": 1 }, out: {} });

    plan = adjustSideboardLabCardDisplayQuantity(plan, "out", "OGN-002", -1, 3, identities);
    expect(sideboardLabPlanBalance(plan, identities)).toMatchObject({
      cardsIn: 1,
      cardsOut: 1,
      status: "balanced",
      legal: true
    });
  });

  it("clears the same exact card from the opposite direction when it is added", () => {
    expect(adjustSideboardLabPlan(
      { in: {}, out: { "OGN-001": 1 } },
      "in",
      "OGN-001",
      1,
      2
    )).toEqual({ in: { "OGN-001": 1 }, out: {} });
  });

  it("clears every opposite alternate print sharing the selected base identity", () => {
    expect(adjustSideboardLabPlan(
      { in: {}, out: { "OGN-001A": 1, "OGN-001*": 1, "OGN-002": 1 } },
      "in",
      "OGN-001",
      1,
      2
    )).toEqual({ in: { "OGN-001": 1 }, out: { "OGN-002": 1 } });
  });

  it("defensively marks exact and alternate-print identity overlap illegal", () => {
    expect(sideboardLabPlanBalance({ in: { "OGN-001": 1 }, out: { "OGN-001": 1 } })).toMatchObject({
      status: "overlap",
      legal: false,
      overlappingIdentityCodes: ["OGN-001"]
    });
    expect(sideboardLabPlanBalance({ in: { "OGN-001A": 1 }, out: { "OGN-001*": 1 } })).toMatchObject({
      status: "overlap",
      legal: false,
      overlappingIdentityCodes: ["OGN-001"]
    });
  });

  it("uses authoritative evidence identity mappings when supplied", () => {
    const identities = new Map([["OGN-020", "OGN-999"], ["OGN-021", "OGN-999"]]);
    expect(sideboardLabPlanBalance({ in: { "OGN-020": 1 }, out: { "OGN-021": 1 } }, identities)).toMatchObject({
      status: "overlap",
      legal: false,
      overlappingIdentityCodes: ["OGN-999"]
    });
  });

  it("grades only robust directional tendencies", () => {
    const robust = evidenceFor("OGN-020", "Side Card 1", "in") as SideboardLabCardEvidence;
    expect(sideboardLabChoiceFeedback(robust, true)).toBe("aligned");
    expect(sideboardLabChoiceFeedback(robust, false)).toBe("conflicts");
    expect(sideboardLabChoiceFeedback({ ...robust, evidenceStatus: "developing" }, true)).toBe("developing");
    expect(sideboardLabChoiceFeedback({ ...robust, guidance: "mixed" }, true)).toBe("unclear");
  });

  it("does not award alignment for untouched avoid signals", () => {
    const selects = evidenceFor("OGN-020", "Side Card 1", "in") as SideboardLabCardEvidence;
    const avoids = { ...evidenceFor("OGN-001", "Main Card 1", "out"), guidance: "strong_avoid" } as SideboardLabCardEvidence;
    expect(sideboardLabVisibleChoiceFeedback(avoids, false)).toBe("not-evaluated");
    expect(sideboardLabVisibleChoiceFeedback(selects, false)).toBe("missed");
    expect(sideboardLabVisibleChoiceFeedback(selects, true)).toBe("aligned");
  });

  it("summarizes deliberate moves and robust alternatives without rewarding an empty plan", () => {
    const selectIn = evidenceFor("OGN-020", "Side Card 1", "in") as SideboardLabCardEvidence;
    const avoidOut = { ...evidenceFor("OGN-001", "Main Card 1", "out"), guidance: "strong_avoid" } as SideboardLabCardEvidence;
    const empty = summarizeSideboardLabPlanFeedback([selectIn, avoidOut], { in: {}, out: {} });
    expect(empty).toEqual({
      movedCards: 0,
      aligned: 0,
      different: 0,
      ungraded: 0,
      notableAlternatives: 1,
      noChanges: true,
      result: "no-changes"
    });

    const deliberate = summarizeSideboardLabPlanFeedback(
      [selectIn, avoidOut],
      { in: { "OGN-020": 1 }, out: { "OGN-001": 1 } }
    );
    expect(deliberate).toMatchObject({
      movedCards: 2,
      aligned: 1,
      different: 1,
      notableAlternatives: 0,
      noChanges: false,
      result: "mixed"
    });
  });

  it("ranks actionable exact-matchup scenarios ahead of broad and exploratory data", () => {
    const parsed = parseSideboardLabApiResponse(readyResponse(), registryFixture());
    expect(parsed.status).toBe("ready");
    if (parsed.status !== "ready") return;
    const base = parsed.drills[0]!;
    const exact = { ...base, id: "exact", cardEvidence: base.cardEvidence.map((item, index) => ({ ...item, scope: "matchup" as const, guidance: index === 0 ? "select" as const : "avoid" as const })) };
    const broad = { ...base, id: "broad", cardEvidence: base.cardEvidence.map((item, index) => ({ ...item, scope: "player-legend" as const, guidance: index === 0 ? "select" as const : "avoid" as const })) };
    const explore = { ...base, id: "explore", cardEvidence: base.cardEvidence.map((item) => ({ ...item, guidance: "avoid" as const })) };
    expect(sideboardLabScenarioUsefulness(exact).kind).toBe("challenge");
    expect(sideboardLabScenarioUsefulness(broad).kind).toBe("guided");
    expect(sideboardLabScenarioUsefulness(explore).kind).toBe("explore");
    expect(rankSideboardLabDailyDrills([explore, broad, exact], 3).map((item) => item.id)).toEqual(["exact", "broad", "explore"]);
  });

  it("describes objective registered-deck shape without turning it into a grade", () => {
    const parsed = parseSideboardLabApiResponse(readyResponse(), registryFixture());
    expect(parsed.status).toBe("ready");
    if (parsed.status !== "ready") return;
    const shape = sideboardLabPlanShape(parsed.drills[0]!.deck, {
      in: { "OGN-020": 1 },
      out: { "OGN-001": 1 }
    });
    expect(shape.before.units - shape.after.units).toBe(1);
    expect(shape.after.spells - shape.before.spells).toBe(1);
    expect(shape.before.earlyUnits - shape.after.earlyUnits).toBe(1);
    expect(shape.before.averageEnergy).toBe(2);
    expect(shape.after.averageEnergy).toBe(2);
  });
});

describe("Sideboard Lab registered-deck fingerprints", () => {
  it("matches the backend cross-module SHA-256 fixture", () => {
    expect(sideboardLabDeckFingerprint(
      [{ cardCode: "OGN-002", count: 1 }, { cardCode: "OGN-001", count: 3 }],
      [{ cardCode: "OGN-050", count: 2 }]
    )).toBe("16908d2ae724f3a742c4ce57bdabf497151186cb433457387d7573bd63c9030f");
  });

  it("matches both a 40-card snapshot and Atlas 39 plus chosen champion, with a 10-card sideboard", () => {
    const registry = registryFixture();
    const main = mainDeck();
    const side = sideboard();
    const flattened = JSON.stringify({ mainDeck: main, sideboard: side });
    const atlas = JSON.stringify({
      mainDeck: main.slice(0, -1),
      champion: [{ cardCode: "OGN-014", name: "Main Card 14", count: 1 }],
      sideboard: side
    });
    const expected = sideboardLabDeckFingerprint(main, side);
    expect(sideboardLabDeckFingerprintFromSnapshot(flattened, registry)).toBe(expected);
    expect(sideboardLabDeckFingerprintFromSnapshot(atlas, registry)).toBe(expected);
    expect(sideboardLabDeckFingerprintFromSnapshot(JSON.stringify({ mainDeck: main.slice(0, -1), sideboard: side }), registry)).toBe("");
  });

  it("enforces the three-copy combined limit across alternate prints while hashing exact prints", () => {
    const main = mainDeck();
    const alternateSideboard = [{ cardCode: "OGN-001A", name: "Main Card 1 Alternate", count: 1 }];
    expect(sideboardLabDeckFingerprint(main, alternateSideboard)).not.toBe(sideboardLabDeckFingerprint(main, [{ cardCode: "OGN-001", name: "Main Card 1", count: 1 }]));
    expect(sideboardLabDeckFingerprintFromSnapshot(JSON.stringify({ mainDeck: main, sideboard: alternateSideboard }), registryFixture())).toBe("");
  });
});

describe("Sideboard Lab API contract", () => {
  it("accepts a strict ready pack with all-history coverage and a 10-card registered sideboard", () => {
    const parsed = parseSideboardLabApiResponse(readyResponse(), registryFixture());
    expect(parsed.status).toBe("ready");
    if (parsed.status !== "ready") return;
    expect(parsed).toMatchObject({ accepted: 1, rejected: 0, observedFrom: null, observedThrough: null, backfillComplete: true });
    expect(parsed.drills[0]).toMatchObject({ source: "community", priorGameResult: "loss" });
    expect(parsed.drills[0].deck.mainDeck.reduce((sum, entry) => sum + entry.count, 0)).toBe(40);
    expect(parsed.drills[0].deck.sideboard).toHaveLength(10);
  });

  it("accepts a truthful unavailable response without inventing fallback drills", () => {
    expect(parseSideboardLabApiResponse(unavailableResponse(), registryFixture())).toMatchObject({
      status: "unavailable",
      reason: "data_unavailable",
      drills: [],
      accepted: 0,
      rejected: 0
    });
  });

  it.each([
    ["unknown payload fields", (payload: ReturnType<typeof readyResponse>) => Object.assign(payload.drills[0], { sampledPlan: [] })],
    ["missing selected copy counts", (payload: ReturnType<typeof readyResponse>) => { delete (payload.drills[0].cardEvidence[0] as Partial<Record<string, unknown>>).selectedCopies; }],
    ["a fingerprint for different registered zones", (payload: ReturnType<typeof readyResponse>) => { payload.drills[0].deck.fingerprint = "0".repeat(64); }],
    ["rates which do not equal their raw counts", (payload: ReturnType<typeof readyResponse>) => { payload.drills[0].cardEvidence[0].selectionRate = 0.9; }],
    ["evidence with the wrong available-zone direction", (payload: ReturnType<typeof readyResponse>) => { payload.drills[0].cardEvidence[0].direction = "in"; }]
  ])("rejects %s", (_label, mutate) => {
    const payload = readyResponse();
    mutate(payload);
    const parsed = parseSideboardLabApiResponse(payload, registryFixture());
    expect(parsed.status).toBe("invalid");
    expect(parsed.issues.length).toBeGreaterThan(0);
  });
});

describe("Sideboard Lab targeted-pack v2 contract", () => {
  it("accepts the strict targeted pack and exposes all additive training evidence", () => {
    const parsed: SideboardLabTargetPackParseResult = parseSideboardLabTargetPackResponse(targetedResponse(), registryFixture());
    acceptsBaseParseResult(parsed);
    expect(parsed.status).toBe("ready");
    if (parsed.status !== "ready") return;
    expect(parsed).toMatchObject({
      accepted: 1,
      rejected: 0,
      includedFacts: 50,
      targetQuery: {
        requested: { playerLegend: "UNL-191", opponentLegend: "VEN-145", priorGameResult: "loss" },
        resolved: { scope: "exact-deck", sharedCards: 40, totalCards: 40 },
        fallbackReason: null
      },
      formatPolicy: {
        format: "bo3",
        observedRulesEpoch: "unknown",
        historicalValidation: "structural-only-no-retroactive-rules"
      }
    });
    expect(parsed.drills[0]).toMatchObject({
      context: { nextInitiative: "unknown", format: "bo3", provider: "atlas", targetGameNumber: 2 },
      decisionEvidence: { decisions: 30, noChangeDecisions: 3, noChangeRate: 0.1 },
      packages: [{ decisions: 10, players: 5, evidenceStatus: "developing" }],
      pairs: [{ decisions: 12, players: 6, evidenceStatus: "developing" }]
    });
    expect(parsed.drills[0].cardEvidence[0]).toMatchObject({
      quantity: { selectedMedianCopies: 1, status: "robust" },
      periods: { preseason: { opportunities: 20, guidancePlayers: 8 }, currentSeason: null }
    });
  });

  it("keeps the legacy parser strict while accepting a truthful targeted unavailable response", () => {
    expect(parseSideboardLabApiResponse(targetedResponse(), registryFixture()).status).toBe("invalid");
    const unavailable = parseSideboardLabTargetPackResponse(targetedUnavailableResponse(), registryFixture());
    acceptsBaseParseResult(unavailable);
    expect(unavailable).toMatchObject({
      status: "unavailable",
      reason: "matchup_not_observed",
      targetQuery: { requested: { playerLegend: "UNL-191" } },
      drills: [],
      formatPolicy: null
    });
  });

  it("accepts other opponents only when a missing matchup truthfully resolves to player-Legend fallback", () => {
    const payload = targetedResponse();
    Object.assign(payload.query.requested, { deckFingerprint: null });
    Object.assign(payload.query.resolved, { scope: "player-legend", deckFingerprint: null, sharedCards: null, totalCards: null });
    payload.query.fallbackReason = "matchup-not-observed";
    payload.drills[0].matchup.opponentLegend = { cardCode: "SFD-191", name: "Draven, Glorious Executioner" };
    payload.drills[0].evidence.opponentLegendIdentityCode = "SFD-191";
    const parsed = parseSideboardLabTargetPackResponse(payload, registryFixture());
    expect(parsed.status).toBe("ready");
    if (parsed.status !== "ready") return;
    expect(parsed.targetQuery.resolved.scope).toBe("player-legend");
    expect(parsed.drills[0].opponentLegend.code).toBe("SFD-191");
  });

  it.each([
    ["a missing quantity distribution", (payload: ReturnType<typeof targetedResponse>) => {
      delete (payload.drills[0].cardEvidence[0] as Partial<typeof payload.drills[0]["cardEvidence"][number]>).quantity;
    }],
    ["an unknown query field", (payload: ReturnType<typeof targetedResponse>) => {
      Object.assign(payload.query.requested, { userHandle: "not-allowed" });
    }],
    ["an unregistered Legend selector", (payload: ReturnType<typeof targetedResponse>) => {
      payload.query.requested.playerLegend = "OGN-001";
    }],
    ["a retroactively asserted rules epoch", (payload: ReturnType<typeof targetedResponse>) => {
      payload.source.formatPolicy.observedRulesEpoch = "2026-season";
    }],
    ["a source privacy threshold below the desktop floor", (payload: ReturnType<typeof targetedResponse>) => {
      payload.source.minimumPlayers = 9;
    }],
    ["a stale packaged-registry count", (payload: ReturnType<typeof targetedResponse>) => {
      payload.source.cardRegistryPrints += 1;
    }],
    ["an exact-deck resolution that is not 40 of 40", (payload: ReturnType<typeof targetedResponse>) => {
      payload.query.resolved.sharedCards = 39;
    }],
    ["a matchup resolution without a requested opponent", (payload: ReturnType<typeof targetedResponse>) => {
      Object.assign(payload.query.requested, { opponentLegend: null, deckFingerprint: null });
      Object.assign(payload.query.resolved, { scope: "matchup", deckFingerprint: null, sharedCards: null, totalCards: null });
    }],
    ["a player-Legend fallback that does not disclose the missed matchup", (payload: ReturnType<typeof targetedResponse>) => {
      Object.assign(payload.query.requested, { deckFingerprint: null });
      Object.assign(payload.query.resolved, { scope: "player-legend", deckFingerprint: null, sharedCards: null, totalCards: null });
    }],
    ["a drill for a different requested player Legend", (payload: ReturnType<typeof targetedResponse>) => {
      payload.query.requested.playerLegend = "VEN-145";
    }],
    ["a drill for a different requested Game 1 result", (payload: ReturnType<typeof targetedResponse>) => {
      payload.query.requested.priorGameResult = "win";
    }],
    ["a derived no-change rate that disagrees with its counts", (payload: ReturnType<typeof targetedResponse>) => {
      payload.drills[0].decisionEvidence.noChangeRate = 0.9;
    }],
    ["a decision histogram that does not cover its denominator", (payload: ReturnType<typeof targetedResponse>) => {
      payload.drills[0].decisionEvidence.swapCountHistogram[1].decisions = 26;
    }],
    ["a package that brings a Main Deck-only identity in", (payload: ReturnType<typeof targetedResponse>) => {
      payload.drills[0].packages[0].cardsIn = [{ cardCode: "OGN-001", name: "Main Card 1", count: 1 }];
    }],
    ["an unbalanced package", (payload: ReturnType<typeof targetedResponse>) => {
      payload.drills[0].packages[0].cardsOut[0].count = 2;
    }],
    ["a quantity histogram that does not cover all card opportunities", (payload: ReturnType<typeof targetedResponse>) => {
      payload.drills[0].cardEvidence[0].quantity.histogram[0].decisions = 14;
    }],
    ["a null selected-copy median despite observed selections", (payload: ReturnType<typeof targetedResponse>) => {
      (payload.drills[0].cardEvidence[0].quantity as { selectedMedianCopies: number | null }).selectedMedianCopies = null;
    }],
    ["a period slice rate that disagrees with its contributor counts", (payload: ReturnType<typeof targetedResponse>) => {
      payload.drills[0].cardEvidence[0].periods.preseason!.guidanceSelectionRate = 0.9;
    }]
  ])("rejects %s", (_label, mutate) => {
    const payload = targetedResponse();
    mutate(payload);
    const parsed = parseSideboardLabTargetPackResponse(payload, registryFixture());
    expect(parsed.status).toBe("invalid");
    expect(parsed.issues.length).toBeGreaterThan(0);
  });
});
