import React, { useState } from "react";
import { ArrowLeft, ArrowRight, Check, RotateCcw } from "lucide-react";
import { NEW_PLAYER_TABLE_TERMS } from "../../shared/newPlayerCurriculum";
import { resolveCardArtwork } from "../cardArtwork";
import mainBack from "./assets/atlas-cardback-blue.png";
import runeBack from "./assets/atlas-cardback-white.png";
import "./NewPlayerBasicsDemos.css";

const art=(id:string)=>resolveCardArtwork(id);
const ACTIONS=[
 {name:"Draw",zone:"hand",steps:["Sentry is still in your main deck. Draw it to discover an option you could play later.","Sentry is now in your hand. You have another option, but no unit has entered play and nothing has been paid."],buttons:["Draw Sentry"]},
 {name:"Play",zone:"base",steps:["In this example, Sentry is in your hand and you have two ready runes. Its printed 2 is an energy cost.","Both runes are exhausted and you have made 2 energy. Now spend that energy to play Sentry.","Sentry is in your base, exhausted. You paid its cost; it cannot make a normal move until it is ready."],buttons:["Exhaust two runes","Pay 2 · play Sentry"]},
 {name:"Move",zone:"battlefield",steps:["A later position: Sentry is already in your base and ready. A normal move changes the location of a unit already in play.","Sentry exhausted to move onto the battlefield. This did not cost energy. Players still get a showdown before control and any point are settled."],buttons:["Move to the battlefield"]},
 {name:"Recall",zone:"base",steps:["A separate example: a card effect tells you to recall this exhausted Sentry. Follow that instruction to return it to base.","Sentry returns to base and stays exhausted. Recall is not a normal move; it does not ready the unit or trigger abilities that look for moving."],buttons:["Apply the recall effect"]}
] as const;

/** These local pictures never dispatch tutorial actions or save lesson progress. */
export function BasicsActionDemo(){
 const [action,setAction]=useState(0),[stage,setStage]=useState(0),[replay,setReplay]=useState(0);
 const current=ACTIONS[action],finished=stage===current.steps.length-1;
 const zone=action===0?(stage?"hand":"deck"):action===1?(stage===2?"base":"hand"):action===2?(stage?"battlefield":"base"):(stage?"base":"battlefield");
 const exhausted=action===1&&stage===2||action===2&&stage===1||action===3;
 const runeExhausted=action===1&&stage>0,energy=action===1&&stage===1?2:0;
 function change(next:number){setAction(next);setStage(0);setReplay(value=>value+1);}
 return <section className="nph-basics-demo" aria-label="Draw, play, move and recall illustrated">
  <header><div><span className="nph-eyebrow">ONE CARD · DIFFERENT ACTIONS</span><h3>{current.name}: {action===0?"find an option":action===1?"put a card into play":action===2?"change its location":"follow a return effect"}</h3></div><span className="nph-demo-count">{action+1} / 4</span></header>
  <div className="nph-demo-layout">
   <div className="nph-demo-table" data-action={action} data-zone={zone} aria-label={`Watchful Sentry: ${zone}${exhausted?", exhausted":""}`}>
    <div className="nph-demo-field"><img src={art("OGN-282")} alt="Monastery of Hirana battlefield"/><span>BATTLEFIELD</span>{action===2&&stage===1&&<b>Showdown next · no point yet</b>}</div>
    <div className="nph-demo-base"><span>YOUR BASE</span></div><div className="nph-demo-hand"><span>YOUR HAND · your options</span></div>
    <div className="nph-demo-deck"><img src={mainBack} alt="Main deck"/><span>MAIN DECK</span></div>
    <div className="nph-demo-runes" data-exhausted={runeExhausted}><img src={art("OGN-089")} alt={`Mind Rune, ${runeExhausted?"exhausted":"ready"}`}/><img src={art("OGN-042")} alt={`Calm Rune, ${runeExhausted?"exhausted":"ready"}`}/><span>{energy} energy</span></div>
    <div key={`${action}-${replay}`} className="nph-demo-sentry" data-zone={zone} data-exhausted={exhausted}><img src={zone==="deck"?mainBack:art("OGN-096")} alt={zone==="deck"?"A card waiting in the deck":"Watchful Sentry"}/>{zone!=="deck"&&<span>{zone==="hand"?"In your hand":exhausted?"Exhausted":"Ready"}</span>}</div>
   </div>
   <div className="nph-demo-explanation" aria-live="polite"><div className="nph-demo-card-caption"><img src={art("OGN-096")} alt="Watchful Sentry, the unit used in this example"/><p>{current.steps[stage]}</p></div><div className="nph-demo-controls"><button type="button" className="nph-primary" onClick={()=>finished?change((action+1)%4):setStage(value=>value+1)}>{finished?action===3?"Go back to Draw":`Next: ${ACTIONS[action+1].name}`:current.buttons[stage]}<ArrowRight size={15}/></button><button type="button" className="nph-text-button" disabled={stage===0} onClick={()=>{setStage(0);setReplay(value=>value+1);}}><RotateCcw size={14}/>Replay</button>{action>0&&<button type="button" className="nph-text-button" onClick={()=>change(action-1)}><ArrowLeft size={14}/>Previous action</button>}</div><small>Click to see each change. Take as long as you need.</small></div>
  </div>
  <details className="nph-demo-definition"><summary>What does “{current.name.toLowerCase()}” mean?</summary><p>{NEW_PLAYER_TABLE_TERMS[action].explanation}</p><small>{NEW_PLAYER_TABLE_TERMS[action].example}</small></details>
 </section>;
}

export function BasicsCostDemo(){
 const [stage,setStage]=useState(0);
 const captions=["Ahri needs 3 energy AND 1 Mind power. Here you have three ready runes. Start by making the energy.","The three exhausted runes made 3 energy. Energy pays the number; it does not pay the Mind symbol.","You recycled the exhausted Mind rune for 1 Mind power. Your 3 energy stayed available. The rune returned to the rune deck.","You spent 3 energy and 1 Mind power. Ahri enters your base exhausted. The recycled rune is still in the rune deck."];
 return <section className="nph-cost-demo" aria-label="Match Ahri’s cost to your runes"><header><span className="nph-eyebrow">PAY THE NUMBER AND THE SYMBOL</span><h3>One cost. Two different resources.</h3></header><div className="nph-cost-demo-layout">
  <figure className="nph-cost-target" data-played={stage===3}><img src={art("OGN-119")} alt="Ahri, Inquisitive: 3 energy and 1 Mind power"/><figcaption>{stage===3?"In your base · exhausted":"Ahri, Inquisitive · waiting to be played"}</figcaption><span className="nph-cost-target-outline" aria-hidden="true"/></figure>
  <div><div className="nph-resource-match"><span data-paid={stage===3}><b>{stage===3?"3 paid":`${stage>0?3:0} / 3`}</b>Energy<small>{stage===3?"0 energy remaining":"Matches the printed number"}</small></span><span data-paid={stage===3}><b>{stage===3?"1 paid":`${stage===2?1:0} / 1`}</b>Mind power<small>{stage===3?"0 Mind power remaining":"Matches the Mind symbol"}</small></span></div><div className="nph-cost-runes" data-stage={stage}>{["OGN-042","OGN-089","OGN-089"].map((id,index)=><figure key={index} data-recycled={index===2&&stage>=2} data-exhausted={stage>0}><img src={art(id)} alt={`${index===0?"Calm":"Mind"} Rune${index===2&&stage>=2?", recycled":stage>0?", exhausted":", ready"}`}/></figure>)}<figure className="nph-cost-rune-deck"><img src={runeBack} alt="Rune deck"/><figcaption>RUNE DECK</figcaption></figure></div><p aria-live="polite">{captions[stage]}</p><div className="nph-demo-controls"><button type="button" className="nph-primary" onClick={()=>setStage(value=>value===3?0:value+1)}>{["Exhaust three runes","Recycle an exhausted Mind rune","Pay both · play Ahri","Replay the payment"][stage]}{stage===3?<RotateCcw size={15}/>:<ArrowRight size={15}/>}</button>{stage>0&&<button type="button" className="nph-text-button" onClick={()=>setStage(value=>value-1)}><ArrowLeft size={14}/>Back</button>}</div><small>On the guided board, right-click a rune to choose Recycle.</small></div>
 </div></section>;
}

export function BasicsIdentityMap(){
 return <section className="nph-identity-map" aria-label="Ahri’s two cards have different jobs"><div className="nph-identity-pair"><figure><span>LEGEND ZONE</span><img src={art("OGN-255")} alt="Ahri, Nine-Tailed Fox legend"/><figcaption><strong>Ahri, Nine-Tailed Fox</strong><b>AHRI · matching champion tag</b><small>Stays in its zone. Its domains define your deck’s identity.</small></figcaption></figure><div className="nph-identity-link"><Check/><span>Same champion tag</span><small>Different full titles are fine</small></div><figure><span>CHAMPION ZONE</span><img src={art("OGN-119")} alt="Ahri, Inquisitive chosen champion"/><figcaption><strong>Ahri, Inquisitive</strong><b>AHRI · matching champion tag</b><small>A unit waiting to be played. Pay its cost to put it into play.</small></figcaption></figure></div><div className="nph-identity-domains"><span>THIS LEGEND’S DOMAINS</span><img src={art("OGN-042")} alt="Calm Rune symbol"/><b>Calm</b><span>+</span><img src={art("OGN-089")} alt="Mind Rune symbol"/><b>Mind</b><p>Cards and runes must fit this identity. A different champion tag cannot be your chosen champion.</p></div></section>;
}

export function BasicsScoringPictures(){
 return <div className="nph-scoring-pictures">{[{title:"Conquer",when:"After the showdown settles",why:"Gain control of a battlefield you have not scored this turn."},{title:"Hold",when:"Your next Beginning phase",why:"Keep control through the opponent’s turn, then check holding."}].map((item,index)=><section key={item.title} data-holding={index===1}><div className="nph-scoring-picture"><img src={art("OGN-282")} alt="Monastery of Hirana"/><img src={art("OGN-096")} alt="Your Watchful Sentry at the battlefield"/><b>+1</b></div><h3>{item.title}</h3><strong>{item.when}</strong><p>{item.why}</p><small>{index===0?"A move alone has not earned the point.":"The opponent may try to take it away first."}</small></section>)}</div>;
}

export function BasicsSmallWords(){
 const [selected,setSelected]=useState(0);
 const words=[{word:"may",meaning:"You have a choice.",example:"If an instruction says you may draw, you can choose not to."},{word:"another",meaning:"Choose a different thing.",example:"“Another friendly unit” cannot mean the unit creating that effect."},{word:"here",meaning:"Look at the card’s location.",example:"An effect referring to units here is limited to that location."},{word:"up to",meaning:"This is a maximum, not a requirement.",example:"“Up to two” can let you choose zero, one or two, following the rest of the instruction."}];
 return <div className="nph-small-words"><div role="group" aria-label="Small words on cards">{words.map((item,index)=><button type="button" key={item.word} aria-pressed={index===selected} onClick={()=>setSelected(index)}>{item.word}</button>)}</div><p aria-live="polite"><strong>{words[selected].meaning}</strong> {words[selected].example}</p></div>;
}

