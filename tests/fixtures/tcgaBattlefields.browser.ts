import { battlefieldCodeFor, battlefieldImageFor, collectTcgaBattlefieldCandidates } from "../../src/game-preload/tcgaBattlefields";

// Browser fixture for TCGA's public zone/ownership markup. Bundle with esbuild
// and run runTcgaBattlefieldBrowserChecks() in a browser; no account is needed.
export function runTcgaBattlefieldBrowserChecks(): string[] {
  const passed: string[] = [];
  const fixture = document.createElement("div");
  document.body.append(fixture);
  function card(classes: string, code: string, style = "") {
    return `<div class="game-card ${classes}" style="width:180px;height:120px;${style}"><img class="card-front" src="./cards/${code}.webp"></div>`;
  }
  function capture(markup: string) {
    fixture.innerHTML = markup;
    return collectTcgaBattlefieldCandidates(fixture, "2026-09-07T17:00:00.000Z");
  }
  function equal(actual: unknown, expected: unknown, label: string) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    }
  }
  function test(name: string, run: () => void) {
    run();
    passed.push(name);
  }
  try {
    test("Classic host: shared slots capture both original fields", () => {
      const candidates = capture(card("myBF1 card-hidden-no index-1 reversed-index-2", "UNL-210") + card("myBF2 opponent-card card-hidden-no", "OGN-291"));
      equal(battlefieldCodeFor(candidates, "me", true), "UNL-210", "host field");
      equal(battlefieldCodeFor(candidates, "opponent"), "OGN-291", "guest field");
      equal(candidates[0].index, 1, "diagnostic index");
      equal(candidates[0].reversedIndex, 2, "diagnostic reversed index");
      equal(candidates.length, 2, "candidate count");
    });
    test("Classic guest: ownership follows opponent-card, not slot number", () => {
      const candidates = capture(card("myBF1 opponent-card card-hidden-no", "UNL-210") + card("myBF2 card-hidden-no", "OGN-291"));
      equal(battlefieldCodeFor(candidates, "me", true), "OGN-291", "guest local field");
      equal(battlefieldCodeFor(candidates, "opponent"), "UNL-210", "host opponent field");
    });
    test("Old visible battlefield zones still capture; unrelated zones do not", () => {
      const candidates = capture(card("Battlefields card-hidden-no", "UNL-210") + card("Battlefields opponent-card card-hidden-no", "OGN-291") +
        card("Hand", "UNL-214") + card("BFUnits1Upper", "SFD-216") + card("ExileHidden", "OGN-297") + card("Stack", "UNL-T03"));
      equal(candidates.length, 2, "legacy candidates only");
      equal(battlefieldCodeFor(candidates, "me", true), "UNL-210", "legacy local field");
      equal(battlefieldCodeFor(candidates, "opponent"), "OGN-291", "legacy opponent field");
    });
    test("Current invisible staging and leftover choices never compete with the board", () => {
      equal(capture(card("Battlefields", "UNL-214", "transform:scale(0)")).length, 0, "zero-size staging");
      const candidates = capture(card("Battlefields", "UNL-214") + card("myBF1", "UNL-210") + card("myBF2 opponent-card", "OGN-291"));
      equal(candidates.length, 2, "exclude leftover setup card");
      equal(battlefieldCodeFor(candidates, "me", true), "UNL-210", "selected board field");
    });
    test("Empty Classic slots exclude separately rendered staging cards before selection completes", () => {
      const candidates = capture('<div id="section-Battlefields" style="transform:scale(0)"></div>' +
        '<div id="section-myBF1"></div><div id="section-myBF2"></div>' +
        `<div class="visible-cards">${card("Battlefields", "UNL-210")}</div>`);
      equal(candidates.length, 0, "staging card must not be captured despite its nonzero size");
    });
    test("Brush and Baron Pit are evidence, never selected battlefield identities", () => {
      const candidates = capture(card("myBF1", "UNL-210") + card("myBF1", "UNL-T03") + card("myBF2 opponent-card", "OGN-291") + card("myBF3", "UNL-T01"));
      equal(candidates.length, 4, "retain token evidence");
      equal(battlefieldCodeFor(candidates, "me", true), "UNL-210", "ignore both token codes");
      equal(battlefieldImageFor(candidates, "me", true).endsWith("/UNL-210.webp"), true, "original artwork remains unique");
      const replaced = capture(card("myBF1 card-hidden-yes", "card-back") + card("myBF1", "UNL-T03") + card("myBF2 opponent-card", "OGN-291"));
      equal(battlefieldCodeFor(replaced, "me", true), "", "replacement must not overwrite retained original");
      equal(battlefieldImageFor(replaced, "me", true), "", "replacement artwork not selected");
      equal(battlefieldCodeFor(replaced, "opponent"), "OGN-291", "opponent field retained");
    });
    test("Hidden cards and cardbacks cannot identify a chosen battlefield", () => {
      const candidates = capture(card("myBF1 card-hidden-yes", "UNL-210") + card("myBF2 opponent-card card-hidden-no", "card-back"));
      equal(battlefieldCodeFor(candidates, "me", true), "", "hidden local card");
      equal(battlefieldImageFor(candidates, "opponent"), "", "visible cardback");
    });
    test("Multiple unused legacy choices stay ambiguous", () => {
      const candidates = capture(card("Battlefields", "UNL-210") + card("Battlefields", "UNL-214"));
      equal(battlefieldCodeFor(candidates, "me", true), "", "ambiguous code");
      equal(battlefieldImageFor(candidates, "me", true), "", "ambiguous image");
    });
    test("Numbered FFA battlefield zones remain discoverable without including unit zones", () => {
      const candidates = capture(["Battlefields", "Battlefields2", "Battlefields3", "Battlefields4", "Battlefields5"]
        .map((zone) => card(zone, "UNL-210")).join("") + card("BFUnits5Upper", "SFD-216"));
      equal(candidates.length, 5, "known battlefield zones");
    });
    return passed;
  } finally {
    fixture.remove();
  }
}
