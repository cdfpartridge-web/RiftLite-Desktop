import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Eye, GripHorizontal, Layers3, MessageCircle, RotateCcw, Shield, Sparkles, Zap } from "lucide-react";
import { NEW_PLAYER_KEYWORD_SCENARIOS } from "../../shared/newPlayerKeywordScenarios";
import type { TutorialAction, TutorialLesson, TutorialState, TutorialStep } from "../../shared/newPlayerTutorial";
import { resolveCardArtwork } from "../cardArtwork";
import riftliteLogo from "../../../resources/riftlite-taskbar-icon.png";
import "./KeywordScenario.css";

const zoneNames: Record<string, string> = { base: "Base", hand: "Hand", "battlefield-left": "Left battlefield", "battlefield-right": "Right battlefield", battlefield: "Battlefield", chain: "Chain", trash: "Trash", runes: "Runes", legend: "Legend", champion: "Champion zone", deck: "Main deck", "rune-deck": "Rune deck" };
const zoneOrder = ["legend", "champion", "hand", "base", "battlefield-left", "battlefield", "battlefield-right", "chain", "runes", "trash", "deck", "rune-deck"];

export function KeywordScenario({ state, step, lesson, onAction, onNext, onUndo }: { state: TutorialState; step: TutorialStep | null; lesson: TutorialLesson; onAction: (action: TutorialAction) => void; onNext: () => void; onUndo: () => void }) {
  const current = state.board.keywordScenario;
  const scenario = NEW_PLAYER_KEYWORD_SCENARIOS.find(item => item.id === current?.id);
  const [viewBefore, setViewBefore] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [guidePosition, setGuidePosition] = useState<{ x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const frame = useRef<HTMLElement>(null);
  const guide = useRef<HTMLElement>(null);
  const dragging = useRef<{ pointer: number; startX: number; startY: number; x: number; y: number } | null>(null);
  useEffect(() => { setViewBefore(false); setInspectedId(null); }, [current?.id, current?.revealed]);
  useEffect(() => { setGuidePosition(null); setCollapsed(false); }, [current?.id]);
  useEffect(() => { const resize = () => setGuidePosition(null); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  function moveGuide(x: number, y: number) {
    if (!frame.current || !guide.current) return;
    setGuidePosition({ x: Math.max(12, Math.min(frame.current.clientWidth - guide.current.offsetWidth - 12, x)), y: Math.max(12, Math.min(frame.current.clientHeight - guide.current.offsetHeight - 12, y)) });
  }
  if (!current || !scenario) return null;
  const snapshot = viewBefore ? scenario.before : current.snapshot;
  const isAfter = current.revealed && !viewBefore;
  const cards = snapshot.cards;
  const inspected = cards.find(card => card.instanceId === inspectedId);
  const zones = [...new Set(cards.map(card => card.zone))].sort((a, b) => { const ai = zoneOrder.indexOf(a), bi = zoneOrder.indexOf(b); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi); });
  const groupScenarios = NEW_PLAYER_KEYWORD_SCENARIOS.filter(item => item.groupId === scenario.groupId);
  const changed = (id: string) => isAfter && JSON.stringify(scenario.before.cards.find(card => card.instanceId === id)) !== JSON.stringify(scenario.after.cards.find(card => card.instanceId === id));
  const resourceItems = (side: "player" | "opponent") => {
    const resources = side === "player" ? snapshot.player : snapshot.opponent;
    if (!resources) return null;
    return <div className="nph-keyword-resources"><strong>{side === "player" ? "You" : "Opponent"}</strong>{Object.entries(resources).map(([key, value]) => value === undefined ? null : <span key={key}><b>{value}</b>{({ energy: "Energy", power: "Power", score: "Points", handCount: "Cards in hand", xp: "XP" } as Record<string, string>)[key] ?? key}</span>)}</div>;
  };
  return <section ref={frame} className="nph-keyword-scenario" aria-label={`${scenario.keyword} practice scenario`}>
    <main className="nph-keyword-table"><header className="nph-keyword-heading"><div><span className="nph-eyebrow">KEYWORD PRACTICE · {groupScenarios.indexOf(scenario) + 1} / {groupScenarios.length}</span><h2>{scenario.keyword}</h2><p>{scenario.title}</p></div><button className="nph-text-button" type="button" disabled={!state.history.length} onClick={onUndo}><RotateCcw size={16} />Rewind</button></header>
      <div className="nph-keyword-situation"><span className={isAfter ? "is-after" : ""}>{isAfter ? <Check size={16} /> : <Eye size={16} />}{isAfter ? "After the play" : "Before the play"}</span><p>Separate practice position · only the relevant cards are shown.</p>{current.revealed ? <button type="button" className="nph-text-button" onClick={() => setViewBefore(!viewBefore)}>{viewBefore ? "Show the outcome" : "Compare with before"}</button> : null}</div>
      <div className="nph-keyword-resource-row">{resourceItems("player")}{resourceItems("opponent")}</div>
      <div className="nph-keyword-zones" key={scenario.id} data-after={isAfter}>{zones.map(zone => <section className={`nph-keyword-zone ${zone.startsWith("battlefield") ? "is-field" : ""}`} key={zone} aria-label={zoneNames[zone] ?? zone}><h3><Layers3 size={14} />{zoneNames[zone] ?? zone}</h3><div className="nph-keyword-cards">{cards.filter(card => card.zone === zone).map(card => <figure key={card.instanceId} className="nph-keyword-card" data-changed={changed(card.instanceId)} data-owner={card.owner} data-keyword-card-id={card.instanceId}>
        <div className="nph-keyword-card-owner">{card.owner === "player" ? "Your card" : "Opponent’s card"}</div><button type="button" className="nph-keyword-art" aria-label={`Inspect ${card.name}`} onMouseEnter={() => setInspectedId(card.instanceId)} onMouseLeave={() => setInspectedId(null)} onFocus={() => setInspectedId(card.instanceId)} onBlur={() => setInspectedId(null)} onClick={() => setInspectedId(card.instanceId)}><img src={resolveCardArtwork(card.cardId, card.imageUrl)} alt={card.name} draggable={false} /></button><figcaption><strong>{card.name}</strong><div className="nph-keyword-card-stats">{typeof card.might === "number" ? <span><Shield size={12} />{card.might} Might</span> : null}{typeof card.damage === "number" && card.damage > 0 ? <span className="is-damage">{card.damage} damage</span> : null}{["base", "battlefield-left", "battlefield-right", "battlefield", "runes"].includes(zone) && (card.type === "unit" || card.type === "rune") ? <span>{card.ready ? "Ready" : "Exhausted"}</span> : null}</div>{card.annotation ? <p>{card.annotation}</p> : card.text ? <p>{card.text}</p> : null}</figcaption>
      </figure>)}</div></section>)}</div>
      {snapshot.note ? <p className="nph-keyword-scene-note" role="status"><Sparkles size={17} />{snapshot.note}</p> : null}
      <div className="nph-keyword-brand" aria-hidden="true"><img src={riftliteLogo} alt="" /><span>RIFTLITE · LEARN BY PLAYING</span></div>
    </main>
    <aside ref={guide} className={`nph-keyword-teacher ${collapsed ? "is-collapsed" : ""}`} style={guidePosition ? { left: guidePosition.x, top: guidePosition.y, right: "auto" } : undefined} aria-label="Keyword scenario guide"><div className="nph-keyword-coach-toolbar"><button type="button" aria-label="Move keyword guide; use arrow keys or drag" onPointerDown={event => { if (event.button !== 0 || !guide.current || !frame.current) return; const rect = guide.current.getBoundingClientRect(), parent = frame.current.getBoundingClientRect(); dragging.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: rect.x - parent.x, y: rect.y - parent.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { const drag = dragging.current; if (drag?.pointer === event.pointerId) moveGuide(drag.x + event.clientX - drag.startX, drag.y + event.clientY - drag.startY); }} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }} onKeyDown={event => { const delta: Record<string, number[]> = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }; if (!delta[event.key] || !guide.current || !frame.current) return; event.preventDefault(); event.stopPropagation(); const rect = guide.current.getBoundingClientRect(), parent = frame.current.getBoundingClientRect(); moveGuide(rect.x - parent.x + delta[event.key][0], rect.y - parent.y + delta[event.key][1]); }}><GripHorizontal size={17} /><span>YOUR GUIDE</span></button><button type="button" aria-label={collapsed ? "Show keyword guide" : "Minimise keyword guide"} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <MessageCircle size={15} /> : <ChevronDown size={15} />}</button></div>{!collapsed ? <div className="nph-keyword-teacher-content"><progress value={state.stepIndex} max={lesson.steps.length} aria-label="Lesson progress" /><span className="nph-eyebrow">{state.completed ? "GROUP COMPLETE" : current.revealed ? "WHAT HAPPENED" : "LET’S TRY IT"}</span><h3>{state.completed ? "That’s this group covered." : scenario.title}</h3><p>{state.completed ? "You can revisit any of these examples whenever you need a reminder." : current.revealed ? scenario.explanation : scenario.instruction}</p>{!state.completed && current.revealed ? <div className="nph-keyword-rule"><Zap size={17} /><div><strong>{scenario.keyword}</strong><p>{scenario.definition}</p></div></div> : null}
      {state.completed ? <button type="button" className="nph-primary" onClick={onNext}>Next lesson<ArrowRight size={17} /></button> : step ? <button type="button" className="nph-primary" data-guide-target="true" data-guide-action={step.expectedAction.type} onClick={() => onAction(step.expectedAction)}>{step.expectedAction.type === "demonstrate-keyword" ? scenario.actionLabel : groupScenarios.indexOf(scenario) < groupScenarios.length - 1 ? "Next example" : "Finish this group"}<ArrowRight size={17} /></button> : null}
      {state.feedback ? <p className="nph-feedback" role="status">{state.feedback}</p> : null}<details><summary>Rule reference</summary><p>{scenario.rulesReference}</p></details><div className="nph-keyword-group-list" aria-label="Keywords in this lesson">{groupScenarios.map((item, index) => <span key={item.id} aria-current={item.id === scenario.id ? "step" : undefined} data-complete={state.completed || index < groupScenarios.indexOf(scenario)}>{state.completed || index < groupScenarios.indexOf(scenario) ? <Check size={13} /> : <span>{index + 1}</span>}{item.keyword}</span>)}</div></div> : null}
    </aside>
    {inspected ? <div className="nph-keyword-inspector" aria-hidden="true"><img src={resolveCardArtwork(inspected.cardId, inspected.imageUrl)} alt="" /></div> : null}
    <div className="nph-sr-only" role="status" aria-live="polite">{current.revealed ? scenario.explanation : scenario.instruction}</div>
  </section>;
}
