import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NEW_PLAYER_DECKS } from "../src/shared/newPlayerDecks";
import { DEFAULT_TEACHING_DECK_BY_LEGEND, FIRST_GAME_TEACHING_DECK_IDS, PLAY_EFFECTS_TEACHING_DECK_ID, FOUNDATION_TEACHING_DECK_IDS, NEW_PLAYER_TEACHING_CARD_FACTS, NEW_PLAYER_TEACHING_DECKS, getNewPlayerTeachingDeck, validateNewPlayerTeachingDeck } from "../src/shared/newPlayerTeachingDecks";
import { NEW_PLAYER_KEYWORD_GROUPS } from "../src/shared/newPlayerKeywordScenarios";
import { applyTutorialAction, createLessonState, getTutorialStep, type TutorialBoard } from "../src/shared/newPlayerTutorial";

const registry = JSON.parse(readFileSync("resources/riftbound_card_registry.json", "utf8")) as { cards: Array<{printId:string;name:string;type:string;supertype?:string;tags?:string[]}> };
const byId = new Map(registry.cards.map(card => [card.printId, card]));
const decks = Object.values(NEW_PLAYER_TEACHING_DECKS);
const quantities = (cards: readonly {cardId:string;quantity:number}[]) => cards.reduce<Record<string,number>>((result,card) => { result[card.cardId]=(result[card.cardId]??0)+card.quantity; return result; },{});

describe("complete decks behind keyword practice", () => {
  it("labels seven exact published lists separately from the twelve teaching lists", () => {
    expect(decks.filter(deck=>deck.kind==="published")).toHaveLength(7);
    expect(decks.filter(deck=>deck.kind==="teaching")).toHaveLength(12);
    expect(Object.keys(DEFAULT_TEACHING_DECK_BY_LEGEND)).toHaveLength(7);
    for(const deck of decks) {
      expect(validateNewPlayerTeachingDeck(deck),deck.id).toEqual([]);
      expect(deck.reviewedAt).toBe((deck.id === PLAY_EFFECTS_TEACHING_DECK_ID || (FOUNDATION_TEACHING_DECK_IDS as readonly string[]).includes(deck.id)) ? "2026-11-14" : (FIRST_GAME_TEACHING_DECK_IDS as readonly string[]).includes(deck.id) ? "2026-11-13" : "2026-11-11");
      if(deck.kind==="teaching") { expect(deck.title).toContain("teaching deck");expect(deck.sourceUrl).toBeUndefined();expect(deck.notes).toContain("not a published"); }
      else { expect(deck.sourceUrl).toMatch(/^https:\/\/piltoverarchive\.com\/decks\/view\/[a-f0-9-]{36}$/);expect(deck.author).toBeTruthy(); }
    }
    expect(getNewPlayerTeachingDeck("unknown")).toBeUndefined();
  });

  it("retains the five existing Piltover snapshots without changing cards or provenance", () => {
    for(const prior of NEW_PLAYER_DECKS) {
      const deck=getNewPlayerTeachingDeck(prior.id)!;
      const convert=(cards:readonly {registryPrintId:string;quantity:number}[])=>cards.map(card=>({cardId:card.registryPrintId,quantity:card.quantity}));
      expect(quantities(deck.main)).toEqual(quantities(convert([...prior.cards.champion,...prior.cards.mainDeck])));
      for(const section of ["runes","battlefields","sideboard"] as const) expect(deck[section]).toEqual(convert(prior.cards[section]));
      expect(deck.sourceUrl).toBe(prior.sourceUrl);expect(deck.author).toBe(prior.author);
    }
  });

  it("adds the unit-play example as a separate legal Teemo list with only one card replaced", () => {
    const original=getNewPlayerTeachingDeck("teaching-teemo")!,variant=getNewPlayerTeachingDeck(PLAY_EFFECTS_TEACHING_DECK_ID)!;
    expect(validateNewPlayerTeachingDeck(variant)).toEqual([]);
    expect(variant.kind).toBe("teaching");expect(variant.sourceUrl).toBeUndefined();
    expect(variant.legendId).toBe(original.legendId);expect(variant.championId).toBe(original.championId);
    expect(quantities(variant.main)).toEqual({...quantities(original.main),"UNL-131":2,"UNL-128":1});
    expect(quantities(original.main)["UNL-131"]).toBe(3);expect(quantities(original.main)["UNL-128"]).toBeUndefined();
    for(const id of ["OGN-171","RAD-050","OGN-096"])expect(quantities(variant.main)[id],id).toBe(3);
    for(const section of ["runes","battlefields","sideboard","tokenSources"] as const)expect(variant[section]).toEqual(original[section]);
  });

  it.each(decks)("$id uses registered real cards and preserves their type, identity and tags", deck => {
    for(const id of [deck.legendId,deck.championId,...[...deck.main,...deck.runes,...deck.battlefields,...deck.sideboard].map(card=>card.cardId)]) {
      const card=byId.get(id),fact=NEW_PLAYER_TEACHING_CARD_FACTS[id];
      expect(card,id).toBeDefined();expect(fact,id).toBeDefined();expect(fact.name).toBe(card!.name);expect(fact.type).toBe(card!.type);
      expect(fact.supertype??null).toBe(card!.supertype??null);expect(fact.tags??[]).toEqual(card!.tags??[]);
    }
  });

  it("does not put generated Sprite tokens in the deck and includes their actual generator", () => {
    for(const deck of decks) expect(deck.main.some(card=>card.cardId==="UNL-T07")).toBe(false);
    for(const deck of decks.filter(deck=>Object.values(DEFAULT_TEACHING_DECK_BY_LEGEND).includes(deck.id)&&deck.domains.includes("Mind"))) {
      expect(deck.tokenSources?.["UNL-T07"]).toContain("UNL-078");expect(deck.main.some(card=>card.cardId==="UNL-078")).toBe(true);
    }
  });

  it("supplies complete first-game decks for both sides without claiming published provenance", () => {
    const firstGame = FIRST_GAME_TEACHING_DECK_IDS.map(id=>getNewPlayerTeachingDeck(id)!);
    expect(firstGame.map(deck=>[deck.legendId,deck.championId])).toEqual([["OGN-255","OGN-119"],["RAD-145","RAD-068"]]);
    for(const deck of firstGame) {
      expect(validateNewPlayerTeachingDeck(deck),deck.id).toEqual([]);
      expect(deck.kind).toBe("teaching");expect(deck.sourceUrl).toBeUndefined();expect(deck.author).toBeUndefined();
      expect(deck.notes).toContain("not a published");expect(deck.domains).toEqual(["Calm","Mind"]);
      const main=quantities(deck.main);
      // Enough real copies for each choice branch, opening hand and normal draws.
      for(const id of [deck.championId,"OGN-096","OGN-058","OGN-045","OGN-050","OGN-044","SFD-074","OGN-065"]) expect(main[id],`${deck.id}: ${id}`).toBe(3);
      expect(Object.values(main).reduce((sum,n)=>sum+n,0)).toBe(40);
      expect(quantities(deck.runes)).toEqual({"OGN-042":6,"OGN-089":6});
      expect(deck.battlefields.map(card=>card.cardId)).toEqual(["OGN-282","SFD-216","OGN-293"]);
      expect(deck.main.every(card=>!NEW_PLAYER_TEACHING_CARD_FACTS[card.cardId].supertype?.includes("Signature"))).toBe(true);
    }
  });

  it("rejects bad totals, wrong identities, out-of-domain cards and duplicate Unique copies", () => {
    const kaisa=getNewPlayerTeachingDeck("teaching-kaisa")!,ornn=getNewPlayerTeachingDeck("teaching-ornn")!;
    expect(validateNewPlayerTeachingDeck({...kaisa,main:kaisa.main.slice(1)})).toContain("Chosen champion is missing from the 40-card Main Deck.");
    expect(validateNewPlayerTeachingDeck({...kaisa,championId:"OGN-027"})).toContain("Chosen champion does not match the legend.");
    expect(validateNewPlayerTeachingDeck({...kaisa,main:[...kaisa.main,{cardId:"OGN-213",quantity:1}]})).toContain("Out-of-domain card: Hidden Blade.");
    expect(validateNewPlayerTeachingDeck({...ornn,main:ornn.main.map(card=>card.cardId==="SFD-190"?{...card,quantity:2}:card)})).toContain("Copy limit exceeded: Forgefire Cape.");
    expect(validateNewPlayerTeachingDeck({...kaisa,runes:[{cardId:"OGN-007",quantity:11}]})).toContain("Rune Deck must contain 12 runes.");
    expect(validateNewPlayerTeachingDeck({...kaisa,battlefields:[kaisa.battlefields[0],kaisa.battlefields[0],kaisa.battlefields[2]]})).toContain("Choose three different battlefields.");
  });

  it("supports every visible card and token throughout all 28 examples with the declared complete deck", () => {
    const sides=new Map<string,string>();
    const check=(board:TutorialBoard)=>{
      for(const [fieldIndex,side] of (["player","opponent"] as const).entries()) {
        const deck=getNewPlayerTeachingDeck(board.players[side].teachingDeckId)!;
        expect(deck,`${board.keywordScenario?.id}/${side}`).toBeDefined();
        sides.set(`${board.keywordScenario!.id}/${side}`,deck.kind);
        expect(board.cards.find(card=>card.owner===side&&card.type==="legend")!.cardId).toBe(deck.legendId);
        expect(board.cards.find(card=>card.owner===side&&card.zone==="champion")!.cardId).toBe(deck.championId);
        expect(deck.battlefields.some(card=>card.cardId===board.battlefields[fieldIndex].cardId),`${deck.id}: battlefield pool`).toBe(true);
        const available=new Map<string,number>();
        for(const card of [...deck.main,...deck.runes]) {const name=NEW_PLAYER_TEACHING_CARD_FACTS[card.cardId].name;available.set(name,(available.get(name)??0)+card.quantity);}
        const known=new Map<string,number>();
        for(const card of board.cards.filter(card=>card.owner===side&&card.type!=="legend")) {
          expect(byId.get(card.cardId)?.name,card.cardId).toBe(card.name);
          if(card.token) {
            const sources=deck.tokenSources?.[card.cardId];expect(sources,`${deck.id}: generated ${card.name}`).toBeDefined();
            expect(sources!.some(id=>deck.main.some(entry=>entry.cardId===id))).toBe(true);continue;
          }
          if(board.practice?.mode==="deck-check"&&card.instanceId==="cape-second")continue; // Explicit invalid draft, removed before play.
          known.set(card.name,(known.get(card.name)??0)+1);
        }
        for(const [name,count] of known) expect(count,`${board.keywordScenario!.id}/${side}: ${name}`).toBeLessThanOrEqual(available.get(name)??0);
      }
    };
    for(const group of NEW_PLAYER_KEYWORD_GROUPS) {
      let state=createLessonState(group.id);check(state.board);
      while(!state.completed) {state=applyTutorialAction(state,getTutorialStep(state)!.expectedAction);expect(state.feedback,group.id).toBeNull();check(state.board);}
    }
    expect(sides.size).toBe(56);
    expect([...sides.values()].filter(kind=>kind==="published")).toHaveLength(8);
    expect([...sides.values()].filter(kind=>kind==="teaching")).toHaveLength(48);
  });
});


it("adds the two foundation decks without silently replacing their source lists",()=>{
  const buffs=getNewPlayerTeachingDeck("teaching-buffs-ahri")!,base=getNewPlayerTeachingDeck("teaching-first-game-ahri")!,champions=getNewPlayerTeachingDeck("teaching-champion-viktor")!,viktor=getNewPlayerTeachingDeck("teaching-viktor")!;
  const expectedBuffs=quantities(base.main);delete expectedBuffs["OGN-116"];delete expectedBuffs["RAD-050"];expectedBuffs["OGN-063"]=2;expectedBuffs["SFD-073"]=2;
  expect(quantities(buffs.main)).toEqual(expectedBuffs);expect(quantities(base.main)["OGN-116"]).toBe(2);expect(quantities(base.main)["RAD-050"]).toBe(2);
  expect(quantities(champions.main)).toEqual({...quantities(viktor.main),"OGN-117":3,"OGN-120":1});expect(quantities(viktor.main)["OGN-117"]).toBe(1);
  for(const [variant,original]of [[buffs,base],[champions,viktor]]){expect(validateNewPlayerTeachingDeck(variant)).toEqual([]);for(const field of ["legendId","championId","runes","battlefields","sideboard"] as const)expect(variant[field]).toEqual(original[field]);expect(variant.kind).toBe("teaching");expect(variant.sourceUrl).toBeUndefined();}
  expect(NEW_PLAYER_TEACHING_CARD_FACTS["SFD-073"].tags).toEqual(["Equipment"]);
});
